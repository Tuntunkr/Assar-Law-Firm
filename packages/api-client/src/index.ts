import type {
  ApiErrorBody,
  ErrorCode,
  PortalAiOutput,
  PortalDocument,
  PortalInvoice,
  PortalMatter,
  PortalMe,
  PortalMessage,
} from '@assar/types';

/** A failed API call, with the stable error code and request id from the API's error envelope. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN',
    public readonly requestId?: string,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
  get isUnauthenticated() {
    return this.status === 401 && this.code === 'UNAUTHENTICATED';
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Called when an authenticated request is rejected with 401 (e.g. the session expired). */
  onUnauthenticated?: () => void;
}

export class Http {
  private csrf: string | null = null;
  constructor(private readonly o: ClientOptions) {}

  setCsrf(token: string | null) {
    this.csrf = token;
  }

  /** Absolute URL for a path, for links the browser follows itself (e.g. CSV downloads). */
  url(path: string) {
    return `${this.o.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    o: { auth?: boolean; headers?: Record<string, string> } = { auth: true },
  ): Promise<T> {
    const doFetch = this.o.fetch ?? globalThis.fetch;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf;
    Object.assign(headers, o.headers);
    let res: Response;
    try {
      res = await doFetch(`${this.o.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        credentials: 'include', // the session lives in an httpOnly cookie
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiClientError(
        'Could not reach the server. Check your connection and try again.',
        0,
        'NETWORK',
      );
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const e = (json as ApiErrorBody | undefined)?.error;
      const err = new ApiClientError(
        e?.message ?? 'Something went wrong. Please try again.',
        res.status,
        e?.code ?? 'UNKNOWN',
        e?.requestId,
        e?.details,
      );
      if (o.auth !== false && err.isUnauthenticated) this.o.onUnauthenticated?.();
      throw err;
    }
    return json as T;
  }
}

export interface DownloadLink {
  url: string;
  method: 'GET';
  expiresAt: string;
  filename: string;
}

/** Typed client for the client-portal endpoints (`/v1/portal/*`). */
export function createPortalClient(options: ClientOptions) {
  const http = new Http(options);
  const keep = (me: PortalMe) => (http.setCsrf(me.csrfToken), me);
  return {
    login: (input: { organizationSlug: string; email: string; password: string }) =>
      http.request<PortalMe>('POST', '/v1/portal/auth/login', input, { auth: false }).then(keep),
    acceptInvitation: (input: { token: string; name: string; password: string }) =>
      http.request<{ ok: true }>('POST', '/v1/portal/auth/accept-invitation', input, {
        auth: false,
      }),
    /** Also refreshes the CSRF token, so call it on page load. */
    me: () => http.request<PortalMe>('GET', '/v1/portal/me').then(keep),
    logout: () =>
      http.request<void>('POST', '/v1/portal/auth/logout').finally(() => http.setCsrf(null)),
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      http.request<void>('POST', '/v1/portal/auth/change-password', input),
    listMatters: () => http.request<{ data: PortalMatter[] }>('GET', '/v1/portal/matters'),
    getMatter: (id: string) => http.request<PortalMatter>('GET', `/v1/portal/matters/${id}`),
    listDocuments: (matterId: string) =>
      http.request<{ data: PortalDocument[] }>('GET', `/v1/portal/matters/${matterId}/documents`),
    downloadLink: (documentId: string, version: number) =>
      http.request<DownloadLink>(
        'POST',
        `/v1/portal/documents/${documentId}/versions/${version}/download-link`,
      ),
    listInvoices: (matterId: string) =>
      http.request<{ data: PortalInvoice[] }>('GET', `/v1/portal/matters/${matterId}/invoices`),
    listMessages: (matterId: string) =>
      http.request<{ data: PortalMessage[] }>('GET', `/v1/portal/matters/${matterId}/messages`),
    listAiOutputs: (matterId: string) =>
      http.request<{ data: PortalAiOutput[] }>('GET', `/v1/portal/matters/${matterId}/ai-outputs`),
    getAiOutput: (id: string) => http.request<PortalAiOutput>('GET', `/v1/portal/ai-outputs/${id}`),
  };
}
export type PortalClient = ReturnType<typeof createPortalClient>;

export * from './staff.js';
