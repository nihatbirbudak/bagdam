import type { ApiErrorEnvelope } from './apiTypes';

/* ── Taban ayarları ─────────────────────────────────────────────────────── */

const RAW_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
/** API tabanı; sondaki eğik çizgiler atılır (varsayılan `/api/v1`, same-origin). */
export const API_BASE = RAW_BASE.replace(/\/+$/, '');
/** API kökü (`/api/v1` öneki olmadan) — `/uploads/...` gibi medya yolları için. */
export const API_ORIGIN = API_BASE.replace(/\/api(\/v\d+)?$/, '');

/** Göreli medya yolunu API köküne göre çözer. */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Sorgu dizesi üretir; `undefined`, `null` ve boş string atlanır (yalnız ilkel değerler yazılır).
 * `buildQuery({ page: 2, q: '' })` → `?page=2`
 */
export function buildQuery(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/* ── Hata sınıflandırma ─────────────────────────────────────────────────── */

export type ApiErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'locked'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'unknown';

function classifyStatus(status: number): ApiErrorKind {
  if (status === 0) return 'network';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 423) return 'locked';
  if (status === 429) return 'rate-limit';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Hata zarfı `{ statusCode, message, error, requestId }` → istemci hatası. */
export class ApiError extends Error {
  public kind: ApiErrorKind;
  public requestId?: string;
  /** Sunucunun `error` kodu (ör. `TOKEN_EXPIRED`, `UNAUTHENTICATED`, `CSRF_INVALID`). */
  public code?: string;
  public details?: unknown;

  constructor(
    public status: number,
    message: string,
    extra?: { requestId?: string; code?: string; details?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = classifyStatus(status);
    this.requestId = extra?.requestId;
    this.code = extra?.code;
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

/**
 * 400 zarfından alan hatalarını çıkarır. ValidationPipe mesajları `"<alan> must be …"` biçimindedir;
 * ilk sözcük alan adı kabul edilir. `errors: { alan: mesaj }` ya da `fieldErrors` nesnesi de desteklenir.
 */
export function extractFieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== 'object') return out;
  const d = err.details as { message?: unknown; errors?: unknown; fieldErrors?: unknown };
  const obj = (d.fieldErrors ?? d.errors) as Record<string, unknown> | undefined;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) out[k] = normalizeMessage(v, '');
  }
  if (Array.isArray(d.message)) {
    for (const m of d.message) {
      if (typeof m !== 'string') continue;
      const match = m.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s+(.+)$/);
      if (match && !out[match[1]]) out[match[1]] = m;
    }
  }
  return out;
}

/** Kullanıcıya gösterilecek kısa hata metni. */
export function errorMessage(err: unknown, fallback = 'Beklenmeyen bir hata oluştu'): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

function envelopeCode(data: Partial<ApiErrorEnvelope> | null | undefined): string | undefined {
  const code = data?.error;
  // AllExceptionsFilter `error` alanına ya HTTP adı ("Unauthorized") ya da uygulama kodu ("TOKEN_EXPIRED") yazar.
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

async function toApiError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as Partial<ApiErrorEnvelope> | null;
  const fallback = res.status === 404 ? 'Kaynak bulunamadı' : res.statusText || `HTTP ${res.status}`;
  return new ApiError(res.status, normalizeMessage(data?.message, fallback), {
    requestId: data?.requestId ?? res.headers.get('x-request-id') ?? undefined,
    code: envelopeCode(data),
    details: data ?? undefined,
  });
}

/* ── CSRF (double-submit; ADR-0009: GET /auth/csrf → cookie `csrf_token` + X-CSRF-Token) ── */

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'X-CSRF-Token';

let csrfMemoryToken: string | null = null;
let csrfInflight: Promise<void> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Cookie'deki token; okunamıyorsa yanıt gövdesinden hatırlanan token. */
export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE) ?? csrfMemoryToken;
}

/** Yalnız testler için: bellekteki CSRF/refresh durumunu sıfırlar. */
export function resetCsrfForTests(): void {
  csrfMemoryToken = null;
  csrfInflight = null;
  refreshInflight = null;
  redirecting = false;
}

/** Mutasyon öncesi CSRF token'ı garanti eder; uç yoksa/ağ yoksa sessizce geçer (istek yine gider, sunucu 403 verir). */
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
        /* ağ yok → sessiz; mutasyon isteği kendi hatasını üretir */
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

/* ── Oturum yenileme (access 15 dk → refresh 30 gün rotasyon; ADR-0009) ─────────────────── */

let refreshInflight: Promise<boolean> | null = null;

/**
 * `POST /auth/refresh` — refresh çerezi (path=/api/v1/auth) tarayıcı tarafından otomatik gider.
 * Aynı anda birden çok 401 tek yenileme isteği paylaşır. Başarı → true (yeni çerezler set edildi).
 */
export async function tryRefreshSession(): Promise<boolean> {
  if (!refreshInflight) {
    refreshInflight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        return res.ok;
      } catch {
        return false;
      }
    })();
  }
  const inflight = refreshInflight;
  try {
    return await inflight;
  } finally {
    if (refreshInflight === inflight) refreshInflight = null;
  }
}

/* ── İstek çekirdeği ───────────────────────────────────────────────────── */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_PATH_RE = /^\/auth\//;
/** Bu uçlarda 401 → yenileme denenmez (kendileri oturum kurar/bozar). */
const NO_REFRESH_PATH_RE = /^\/auth\/(login|refresh|logout|csrf)(\/|\?|$)/;
let redirecting = false;

/** 401 → login (auth uçları hariç; `?next=` ile geri dönüş). */
function handleUnauthorized(path: string) {
  if (AUTH_PATH_RE.test(path)) return;
  if (typeof window === 'undefined' || redirecting) return;
  if (window.location.pathname === '/login') return;
  redirecting = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

/** 401'de bir kez sessiz yenileme denenir; başarılıysa çağıran isteği tekrarlar. */
async function recoverUnauthorized(path: string): Promise<boolean> {
  if (NO_REFRESH_PATH_RE.test(path)) return false;
  const ok = await tryRefreshSession();
  if (!ok) handleUnauthorized(path);
  return ok;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface RetryState {
  csrfRetried?: boolean;
  authRetried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}, retry: RetryState = {}): Promise<T> {
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
    if (res.status === 403 && isMutation && !retry.csrfRetried && (err.code === 'CSRF_INVALID' || /csrf/i.test(err.message))) {
      await ensureCsrf(true);
      return request<T>(path, options, { ...retry, csrfRetried: true });
    }
    // Access süresi dolmuş olabilir: bir kez refresh dene, olmazsa /login
    if (res.status === 401) {
      if (!retry.authRetried && (await recoverUnauthorized(path))) {
        return request<T>(path, options, { ...retry, authRetried: true });
      }
      if (retry.authRetried) handleUnauthorized(path);
    }
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
    retry: RetryState = {},
  ): Promise<T> => {
    await ensureCsrf();
    const csrf = getCsrfToken();
    const onProgress = opts?.onProgress;
    const outcome = await new Promise<{ ok: true; value: T } | { ok: false; error: ApiError }>((resolve) => {
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
            resolve({ ok: true, value: JSON.parse(xhr.responseText) as T });
          } catch {
            resolve({ ok: true, value: undefined as T });
          }
          return;
        }
        let message = `HTTP ${xhr.status}`;
        let requestId: string | undefined;
        let code: string | undefined;
        let details: unknown;
        try {
          const data = JSON.parse(xhr.responseText) as Partial<ApiErrorEnvelope>;
          message = normalizeMessage(data.message, message);
          requestId = data.requestId;
          code = envelopeCode(data);
          details = data;
        } catch {
          /* gövde JSON değil */
        }
        resolve({ ok: false, error: new ApiError(xhr.status, message, { requestId, code, details }) });
      };
      xhr.onerror = () => resolve({ ok: false, error: new ApiError(0, 'Sunucuya bağlanılamıyor.') });
      xhr.send(formData);
    });
    if (outcome.ok) return outcome.value;
    const err = outcome.error;
    if (err.status === 403 && !retry.csrfRetried && (err.code === 'CSRF_INVALID' || /csrf/i.test(err.message))) {
      await ensureCsrf(true);
      return api.upload<T>(path, formData, opts, { ...retry, csrfRetried: true });
    }
    if (err.status === 401) {
      if (!retry.authRetried && (await recoverUnauthorized(path))) {
        return api.upload<T>(path, formData, opts, { ...retry, authRetried: true });
      }
      if (retry.authRetried) handleUnauthorized(path);
    }
    throw err;
  },
};

/** Kimliği doğrulanmış GET → Blob (görsel önizleme / dosya indirme). */
export async function fetchBlobGet(path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}
