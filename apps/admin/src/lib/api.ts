import type { ApiErrorEnvelope } from './apiTypes';

/* ── Taban ayarları ─────────────────────────────────────────────────────── */

const RAW_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
/** API tabanı; sondaki eğik çizgiler atılır (varsayılan `/api/v1`, same-origin). */
export const API_BASE = RAW_BASE.replace(/\/+$/, '');
/** API kökü (`/api/v1` öneki olmadan) — `/uploads/...` gibi medya yolları için. */
export const API_ORIGIN = API_BASE.replace(/\/api(\/v\d+)?$/, '');

/**
 * F1 geçici kapı: `VITE_AUTH_DISABLED=true` iken route guard atlanır ve 401'de login'e yönlendirilmez.
 * Yalnız production dışı (dev sunucusu) etkilidir; `vite build` çıktısında daima false.
 */
export const AUTH_DISABLED = !import.meta.env.PROD && import.meta.env.VITE_AUTH_DISABLED === 'true';

/** Göreli medya yolunu API köküne göre çözer. */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/* ── Hata sınıflandırma ─────────────────────────────────────────────────── */

export type ApiErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'unknown';

function classifyStatus(status: number): ApiErrorKind {
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limit';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Hata zarfı `{ statusCode, message, requestId }` → istemci hatası. */
export class ApiError extends Error {
  public kind: ApiErrorKind;
  public requestId?: string;
  public details?: unknown;

  constructor(
    public status: number,
    message: string,
    extra?: { requestId?: string; details?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = classifyStatus(status);
    this.requestId = extra?.requestId;
    this.details = extra?.details;
  }
}

/** `message` string | string[] | {message} olabilir; tek satıra indirger. */
export function normalizeMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (Array.isArray(raw)) {
    const parts = raw.map((m) => normalizeMessage(m, '')).filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  if (raw && typeof raw === 'object' && 'message' in raw) {
    return normalizeMessage((raw as { message?: unknown }).message, fallback);
  }
  return fallback;
}

async function toApiError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as Partial<ApiErrorEnvelope> | null;
  const fallback = res.status === 404 ? 'Kaynak bulunamadı' : res.statusText || `HTTP ${res.status}`;
  return new ApiError(res.status, normalizeMessage(data?.message, fallback), {
    requestId: data?.requestId ?? res.headers.get('x-request-id') ?? undefined,
    details: data ?? undefined,
  });
}

/* ── CSRF (double-submit; UA kalıbı: GET /auth/csrf → cookie `csrf_token` + X-CSRF-Token) ── */

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'X-CSRF-Token';

let csrfMemoryToken: string | null = null;
let csrfInflight: Promise<void> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Cookie'deki token; okunamıyorsa (ör. domain farkı) yanıt gövdesinden hatırlanan token. */
export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE) ?? csrfMemoryToken;
}

/** Mutasyon öncesi CSRF token'ı garanti eder; F1'de uç yoksa sessizce geçer. */
export async function ensureCsrf(force = false): Promise<void> {
  if (!force && getCsrfToken()) return;
  if (!csrfInflight) {
    csrfInflight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/csrf`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
          if (data?.csrfToken) csrfMemoryToken = data.csrfToken;
        }
      } catch {
        /* F1: auth modülü henüz yok ya da ağ yok → sessiz */
      }
    })();
  }
  const inflight = csrfInflight;
  try {
    await inflight;
  } finally {
    if (csrfInflight === inflight) csrfInflight = null;
  }
}

/* ── İstek çekirdeği ───────────────────────────────────────────────────── */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_PATH_RE = /^\/auth\//;
let redirecting = false;

/** 401 → login (auth uçları ve F1 kapısı hariç). */
function handleUnauthorized(path: string) {
  if (AUTH_DISABLED || AUTH_PATH_RE.test(path)) return;
  if (typeof window === 'undefined' || redirecting) return;
  if (window.location.pathname === '/login') return;
  redirecting = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const method = options.method ?? 'GET';
  const isMutation = !SAFE_METHODS.has(method);
  if (isMutation) await ensureCsrf();
  const csrf = isMutation ? getCsrfToken() : null;
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (!isForm && options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers[CSRF_HEADER] = csrf;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      signal: options.signal,
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Sunucuya bağlanılamıyor. Lütfen bağlantınızı kontrol edin.');
  }

  if (!res.ok) {
    const err = await toApiError(res);
    // CSRF token'ı eskimiş/eksikse bir kez yenileyip tekrar dene
    if (res.status === 403 && isMutation && !retried && /csrf/i.test(err.message)) {
      await ensureCsrf(true);
      return request<T>(path, options, true);
    }
    if (res.status === 401) handleUnauthorized(path);
    throw err;
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, opts?: { signal?: AbortSignal }) =>
    request<T>(path, { method: 'GET', signal: opts?.signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /** Çok parçalı yükleme (ilerleme ile); cookie + CSRF header'ı XHR üzerinden gider. */
  upload: async <T>(
    path: string,
    formData: FormData,
    opts?: { onProgress?: (pct: number) => void },
  ): Promise<T> => {
    await ensureCsrf();
    const csrf = getCsrfToken();
    const onProgress = opts?.onProgress;
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}${path}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            resolve(undefined as T);
          }
          return;
        }
        let message = `HTTP ${xhr.status}`;
        let requestId: string | undefined;
        try {
          const data = JSON.parse(xhr.responseText) as Partial<ApiErrorEnvelope>;
          message = normalizeMessage(data.message, message);
          requestId = data.requestId;
        } catch {
          /* gövde JSON değil */
        }
        if (xhr.status === 401) handleUnauthorized(path);
        reject(new ApiError(xhr.status, message, { requestId }));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Sunucuya bağlanılamıyor.'));
      xhr.send(formData);
    });
  },
};

/** Kimliği doğrulanmış GET → Blob (görsel önizleme / dosya indirme). */
export async function fetchBlobGet(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}
