/**
 * Typed API client used by the dashboard and the app. Each front-end plugs in its own token storage
 * (browser storage vs. Capacitor secure storage) and server URL source.
 *
 * - Short-lived access token + rotating refresh token; refresh is single-flight and a 401 is retried once.
 * - Every request identifies the front-end with the X-EstateFlow-Client header (checked against the token).
 * - `events()` reads /api/events (Server-Sent Events) over fetch so the bearer header works everywhere.
 */
import { CLIENT_HEADER, type ClientKind } from '../constants.js';
import type { AuthSession, RealtimeEvent, User } from '../types.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** True when the request never reached the server (offline, DNS, CORS). */
  get isNetwork() {
    return this.status === 0;
  }
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  remember: boolean;
}

export interface TokenStorage {
  load(): Promise<StoredSession | null> | StoredSession | null;
  save(session: StoredSession): Promise<void> | void;
  clear(): Promise<void> | void;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query) {
  if (!params) return '';
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

export interface ApiClientOptions {
  client: ClientKind;
  /** API origin without /api (empty string = same origin). Read on every request so it can change at runtime. */
  baseUrl: () => string;
  storage: TokenStorage;
  /** Called once when the session can no longer be refreshed (expired, revoked, or wrong client). */
  onSessionExpired?: (reason: string) => void;
  fetch?: typeof fetch;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  blob: Blob;
  fileName: string;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(opts: ApiClientOptions) {
  const doFetch: typeof fetch = (...args) => (opts.fetch ?? globalThis.fetch)(...args);
  let session: StoredSession | null = null;
  let loaded = false;
  let refreshing: Promise<boolean> | null = null;
  let expiredNotified = false;

  const url = (path: string, query?: Query) => `${opts.baseUrl().replace(/\/+$/, '')}/api${path}${qs(query)}`;

  async function ensureLoaded() {
    if (loaded) return;
    session = (await opts.storage.load()) ?? null;
    loaded = true;
  }

  async function setSession(s: StoredSession | null) {
    session = s;
    loaded = true;
    if (s) {
      expiredNotified = false;
      await opts.storage.save(s);
    } else await opts.storage.clear();
  }

  function expire(reason: string) {
    if (expiredNotified) return;
    expiredNotified = true;
    opts.onSessionExpired?.(reason);
  }

  async function parse(res: Response) {
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) return res.json().catch(() => null);
    return null;
  }

  async function toError(res: Response) {
    const data = await parse(res);
    return new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details, data?.requestId ?? res.headers.get('x-request-id') ?? undefined);
  }

  /** Exchanges the refresh token for a new pair. Single-flight: concurrent 401s share one refresh. */
  function refresh(): Promise<boolean> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await ensureLoaded();
      if (!session?.refreshToken) return false;
      let res: Response;
      try {
        res = await doFetch(url('/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CLIENT_HEADER]: opts.client },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
      } catch {
        // Offline: keep the session so queued work can retry later.
        return false;
      }
      if (!res.ok) {
        const err = await toError(res);
        if (res.status === 401 && (err.details as { code?: string } | undefined)?.code === 'refresh_superseded') {
          // Another tab refreshed first and saved the new pair: adopt it instead of signing out.
          const stored = await opts.storage.load();
          if (stored && stored.refreshToken !== session.refreshToken) {
            session = stored;
            return true;
          }
        }
        if (res.status === 401 || res.status === 403) {
          await setSession(null);
          expire(err.message);
        }
        return false;
      }
      const data = (await res.json()) as AuthSession;
      await setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: Date.now() + data.expiresIn * 1000, remember: session.remember });
      return true;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    await ensureLoaded();
    // Refresh a little early so long forms don't fail on submit.
    if (session && session.expiresAt - Date.now() < 30_000) await refresh();
    const h: Record<string, string> = { [CLIENT_HEADER]: opts.client };
    if (session?.accessToken) h.Authorization = `Bearer ${session.accessToken}`;
    return h;
  }

  async function send(method: string, path: string, body?: unknown, query?: Query, retry = true): Promise<Response> {
    const headers = await authHeaders();
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(url(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Unable to reach the server. Check your connection and try again.');
    }
    if (res.status === 401 && retry && !path.startsWith('/auth/login') && session?.refreshToken) {
      if (await refresh()) return send(method, path, body, query, false);
      if (!session) expire('Your session has expired. Please sign in again.');
    } else if (res.status === 401 && !path.startsWith('/auth/')) {
      await setSession(null);
      expire('Your session has expired. Please sign in again.');
    }
    return res;
  }

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const res = await send(method, path, body, query);
    if (!res.ok) throw await toError(res);
    return (await parse(res)) as T;
  }

  function fileNameFrom(res: Response, fallback: string) {
    const cd = res.headers.get('content-disposition') ?? '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (star) return decodeURIComponent(star[1]);
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    return plain?.[1] ?? fallback;
  }

  const api = {
    get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),

    /** Multipart upload; reports progress through XMLHttpRequest where available. */
    async upload<T>(path: string, form: FormData, o: UploadOptions = {}): Promise<T> {
      if (typeof XMLHttpRequest === 'undefined' || !o.onProgress) return request<T>('POST', path, form);
      const attempt = async (): Promise<{ status: number; body: any }> => {
        const headers = await authHeaders();
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url(path));
          for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
          xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress?.(e.loaded / e.total);
          xhr.onload = () => {
            let body: any = null;
            try {
              body = JSON.parse(xhr.responseText);
            } catch {
              /* non-JSON */
            }
            resolve({ status: xhr.status, body });
          };
          xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'));
          o.signal?.addEventListener('abort', () => xhr.abort());
          xhr.send(form);
        });
      };
      let r = await attempt();
      if (r.status === 401 && (await refresh())) r = await attempt();
      if (r.status < 200 || r.status >= 300) throw new ApiError(r.status, r.body?.error || `Upload failed (${r.status})`, r.body?.details);
      o.onProgress?.(1);
      return r.body as T;
    },

    /** Fetches a protected file (receipt PDF, document, CSV export) with the auth header. */
    async download(path: string, fallbackName: string, query?: Query): Promise<DownloadResult> {
      const res = await send('GET', path, undefined, query);
      if (!res.ok) throw await toError(res);
      return { blob: await res.blob(), fileName: fileNameFrom(res, fallbackName) };
    },

    url,
  };

  const auth = {
    async login(email: string, password: string, remember: boolean, device?: string): Promise<User> {
      const res = await doFetch(url('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [CLIENT_HEADER]: opts.client },
        body: JSON.stringify({ email, password, remember, client: opts.client, device }),
      }).catch(() => {
        throw new ApiError(0, 'Unable to reach the server. Check the server address and your connection.');
      });
      if (!res.ok) throw await toError(res);
      const data = (await res.json()) as AuthSession;
      await setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt: Date.now() + data.expiresIn * 1000, remember });
      return data.user;
    },
    async logout() {
      await ensureLoaded();
      const token = session?.refreshToken;
      if (token) {
        await doFetch(url('/auth/logout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CLIENT_HEADER]: opts.client, ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
          body: JSON.stringify({ refreshToken: token }),
        }).catch(() => undefined);
      }
      await setSession(null);
    },
    async hasSession() {
      await ensureLoaded();
      return !!session?.refreshToken;
    },
    refresh,
    /**
     * Changes the password. The server signs out every session (this one included) and returns a
     * fresh session for this device, which is adopted here so the user stays signed in.
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<string> {
      await ensureLoaded();
      const remember = session?.remember ?? false;
      const data = await api.put<{ message: string; session: AuthSession }>('/auth/password', { current_password: currentPassword, new_password: newPassword, remember });
      const s = data.session;
      await setSession({ accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: Date.now() + s.expiresIn * 1000, remember });
      return data.message;
    },
    /** Drops the cached session (e.g. after the storage was wiped elsewhere). */
    async reload() {
      loaded = false;
      await ensureLoaded();
    },
  };

  /**
   * Subscribes to /api/events. Reconnects with backoff; returns an unsubscribe function.
   * `onStatus` reports 'open' | 'closed' so the UI can fall back to polling.
   */
  function events(onEvent: (e: RealtimeEvent) => void, onStatus?: (s: 'open' | 'closed') => void) {
    let stopped = false;
    let controller: AbortController | null = null;
    let delay = 1000;

    const loop = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const headers = await authHeaders();
          if (!headers.Authorization) throw new Error('signed out');
          const res = await doFetch(url('/events'), { headers: { ...headers, Accept: 'text/event-stream' }, signal: controller.signal });
          if (res.status === 401) {
            if (!(await refresh())) throw new Error('unauthorized');
            continue;
          }
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
          onStatus?.('open');
          delay = 1000;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const data = chunk
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trimStart())
                .join('\n');
              if (data) {
                try {
                  onEvent(JSON.parse(data) as RealtimeEvent);
                } catch {
                  /* ignore malformed frame */
                }
              }
            }
          }
        } catch {
          /* reconnect below */
        }
        if (stopped) break;
        onStatus?.('closed');
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void loop();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }

  return { api, auth, events };
}
