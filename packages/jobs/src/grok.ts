/** Provider failure with an explicit retry decision. Messages are generic: never include response bodies. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface GrokConfig {
  apiKey: string;
  baseUrl: string;
  /** Required: no model is assumed. */
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

export interface Completion {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

/**
 * Backend-only client for the Grok (xAI) chat-completions API (OpenAI-compatible).
 * The API key lives only in the worker's environment. Prompts and completions are never logged.
 */
export class GrokClient {
  readonly model: string;
  private readonly cfg: Required<Omit<GrokConfig, 'fetch'>> & { fetch: typeof fetch };

  constructor(config: GrokConfig) {
    if (!config.apiKey) throw new Error('GROK_API_KEY is required');
    if (!config.model) throw new Error('GROK_MODEL is required');
    this.model = config.model;
    this.cfg = {
      timeoutMs: 120_000,
      maxOutputTokens: 4096,
      fetch: globalThis.fetch,
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
    };
  }

  async completeJson(prompt: { system: string; user: string }): Promise<Completion> {
    let res: Response;
    try {
      res = await this.cfg.fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          temperature: 0.1,
          max_tokens: this.cfg.maxOutputTokens,
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      const timedOut =
        (e as { name?: string }).name === 'TimeoutError' ||
        (e as { name?: string }).name === 'AbortError';
      throw new AiProviderError(
        timedOut ? 'AI provider timed out' : 'AI provider unreachable',
        timedOut ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNREACHABLE',
        true,
      );
    }

    if (!res.ok) throw classifyStatus(res.status);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiProviderError(
        'AI provider returned an unreadable response',
        'AI_BAD_RESPONSE',
        true,
        res.status,
      );
    }
    const b = body as {
      model?: string;
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = b.choices?.[0];
    if (typeof choice?.message?.content !== 'string' || choice.message.content.trim() === '') {
      throw new AiProviderError(
        'AI provider returned no content',
        'AI_BAD_RESPONSE',
        true,
        res.status,
      );
    }
    if (choice.finish_reason === 'length') {
      // Retrying would hit the same limit; the request needs fewer/shorter sources.
      throw new AiProviderError(
        'AI response was cut off (too long)',
        'AI_OUTPUT_TRUNCATED',
        false,
        res.status,
      );
    }
    return {
      content: choice.message.content,
      model: b.model ?? this.cfg.model,
      usage: {
        promptTokens: b.usage?.prompt_tokens ?? 0,
        completionTokens: b.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function classifyStatus(status: number): AiProviderError {
  if (status === 401 || status === 403)
    return new AiProviderError(
      'AI provider rejected the credentials',
      'AI_AUTH_FAILED',
      false,
      status,
    );
  if (status === 429)
    return new AiProviderError('AI provider rate limit reached', 'AI_RATE_LIMITED', true, status);
  if (status === 408 || status >= 500)
    return new AiProviderError('AI provider error', 'AI_PROVIDER_ERROR', true, status);
  return new AiProviderError(
    'AI provider rejected the request',
    'AI_REQUEST_REJECTED',
    false,
    status,
  );
}
