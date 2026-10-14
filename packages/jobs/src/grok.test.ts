import { describe, expect, it } from 'vitest';
import { AiProviderError, GrokClient } from './grok.js';

const KEY = 'xai-test-key-do-not-leak';
const ok = (content: string, extra: object = {}) =>
  new Response(
    JSON.stringify({
      model: 'test-model-1',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
      ...extra,
    }),
    { status: 200 },
  );

function client(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  timeoutMs = 2000,
) {
  return new GrokClient({
    apiKey: KEY,
    baseUrl: 'https://api.x.ai/v1/',
    model: 'test-model',
    timeoutMs,
    fetch: (async (u: string, i: RequestInit) => handler(u, i)) as typeof fetch,
  });
}
const prompt = { system: 'SYS', user: 'USER-DOCUMENT-TEXT' };
const fail = async (c: GrokClient) => {
  try {
    await c.completeJson(prompt);
  } catch (e) {
    return e as AiProviderError;
  }
  throw new Error('expected failure');
};

describe('GrokClient', () => {
  it('sends an authenticated JSON chat-completions request and returns content and usage', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const c = client((url, init) => ((seen = { url, init }), ok('{"body":"hi"}')));
    const r = await c.completeJson(prompt);
    expect(r).toEqual({
      content: '{"body":"hi"}',
      model: 'test-model-1',
      usage: { promptTokens: 11, completionTokens: 7 },
    });
    expect(seen!.url).toBe('https://api.x.ai/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(seen!.init.body as string);
    expect(body).toMatchObject({
      model: 'test-model',
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it.each([
    [429, 'AI_RATE_LIMITED', true],
    [500, 'AI_PROVIDER_ERROR', true],
    [503, 'AI_PROVIDER_ERROR', true],
    [408, 'AI_PROVIDER_ERROR', true],
    [401, 'AI_AUTH_FAILED', false],
    [403, 'AI_AUTH_FAILED', false],
    [400, 'AI_REQUEST_REJECTED', false],
    [422, 'AI_REQUEST_REJECTED', false],
  ])('classifies HTTP %i as %s (retryable=%s)', async (status, code, retryable) => {
    const e = await fail(
      client(() => new Response(`provider echoed: USER-DOCUMENT-TEXT ${KEY}`, { status })),
    );
    expect(e).toBeInstanceOf(AiProviderError);
    expect({ code: e.code, retryable: e.retryable, status: e.status }).toEqual({
      code,
      retryable,
      status,
    });
    // Error text must never carry the prompt, the response body or the API key.
    expect(e.message).not.toMatch(/USER-DOCUMENT-TEXT|xai-test-key/);
  });

  it('treats network failures and timeouts as retryable', async () => {
    const down = await fail(
      client(() => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(down).toMatchObject({ code: 'AI_PROVIDER_UNREACHABLE', retryable: true });
    const slow = await fail(
      client(
        (_u, init) =>
          new Promise((_, reject) =>
            init.signal!.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
            ),
          ),
        40,
      ),
    );
    expect(slow).toMatchObject({ code: 'AI_PROVIDER_TIMEOUT', retryable: true });
  });

  it('rejects unusable responses', async () => {
    expect(
      await fail(client(() => new Response('<html>oops</html>', { status: 200 }))),
    ).toMatchObject({ code: 'AI_BAD_RESPONSE', retryable: true });
    expect(await fail(client(() => ok('   ')))).toMatchObject({
      code: 'AI_BAD_RESPONSE',
      retryable: true,
    });
    const cut = await fail(
      client(
        () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"bo' }, finish_reason: 'length' }],
            }),
            { status: 200 },
          ),
      ),
    );
    expect(cut).toMatchObject({ code: 'AI_OUTPUT_TRUNCATED', retryable: false });
  });

  it('requires an API key and a model (none is assumed)', () => {
    expect(() => new GrokClient({ apiKey: '', baseUrl: 'x', model: 'm' })).toThrow(/GROK_API_KEY/);
    expect(() => new GrokClient({ apiKey: 'k', baseUrl: 'x', model: '' })).toThrow(/GROK_MODEL/);
  });
});
