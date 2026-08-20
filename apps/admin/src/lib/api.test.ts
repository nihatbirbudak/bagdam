import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, CSRF_HEADER, api, buildQuery, ensureCsrf, extractFieldErrors, resetCsrfForTests } from './api';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function clearCsrfCookie() {
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}

function calledUrls(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map((c) => String((c as [string])[0]));
}

describe('lib/api — CSRF double-submit', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetCsrfForTests();
    clearCsrfCookie();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfCookie();
  });

  it('GET isteğinde CSRF header ve /auth/csrf çağrısı yok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.get('/health');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/health');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBeUndefined();
  });

  it('mutasyonda önce /auth/csrf alınır, X-CSRF-Token gövdeden hatırlanan token ile eklenir', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'tok-123' })) // GET /auth/csrf
      .mockResolvedValueOnce(jsonResponse({ id: 'x' }, { status: 201 })); // POST
    const res = await api.post<{ id: string }>('/admin/producers', { name: 'Ali' });
    expect(res).toEqual({ id: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [csrfUrl, csrfInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(csrfUrl).toBe('/api/v1/auth/csrf');
    expect(csrfInit.credentials).toBe('include');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/producers');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER]).toBe('tok-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'Ali' }));
  });

  it('csrf_token çerezi varsa /auth/csrf çağrılmaz; header çerezden gelir', async () => {
    document.cookie = 'csrf_token=cookie-tok; path=/';
    fetchMock.mockResolvedValueOnce(jsonResponse(undefined, { status: 204 }));
    await api.delete('/admin/media/abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/media/abc');
    expect((init.headers as Record<string, string>)[CSRF_HEADER]).toBe('cookie-tok');
  });

  it('403 CSRF_INVALID hatasında token yenilenir ve istek bir kez tekrarlanır', async () => {
    document.cookie = 'csrf_token=eski; path=/';
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ statusCode: 403, message: 'Geçersiz CSRF token', error: 'CSRF_INVALID' }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'yeni' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    // Çerez yenilenmediği için bellek token'ı yerine çerez öncelikli okunur; yine de ikinci deneme yapılır.
    const res = await api.patch<{ ok: boolean }>('/admin/categories/1', { label: 'x' });
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calledUrls(fetchMock)[1]).toBe('/api/v1/auth/csrf');
  });

  it('hata zarfı ApiError olur; 400 alan hataları çıkarılır; 423 locked; error kodu taşınır', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { statusCode: 400, message: ['price must be a number', 'slug should not be empty'], requestId: 'r1' },
        { status: 400 },
      ),
    );
    document.cookie = 'csrf_token=t; path=/';
    const err = await api.post('/admin/products', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.kind).toBe('validation');
    expect(apiErr.requestId).toBe('r1');
    expect(apiErr.message).toBe('price must be a number · slug should not be empty');
    expect(extractFieldErrors(apiErr)).toEqual({
      price: 'price must be a number',
      slug: 'slug should not be empty',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ statusCode: 423, message: 'Hesap kilitli', error: 'Locked' }, { status: 423 }));
    const locked = (await api.post('/auth/login', {}).catch((e: unknown) => e)) as ApiError;
    expect(locked.kind).toBe('locked');
    expect(locked.message).toBe('Hesap kilitli');
    expect(locked.code).toBeUndefined(); // "Locked" HTTP adı, uygulama kodu değil

    fetchMock.mockResolvedValueOnce(jsonResponse({ statusCode: 401, message: 'Oturum geçersiz', error: 'UNAUTHENTICATED' }, { status: 401 }));
    const unauth = (await api.post('/auth/login', {}).catch((e: unknown) => e)) as ApiError;
    expect(unauth.kind).toBe('auth');
    expect(unauth.code).toBe('UNAUTHENTICATED');
    // login ucunda refresh denenmez
    expect(calledUrls(fetchMock).filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(0);
  });

  it('ensureCsrf aynı anda tek istek atar', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ csrfToken: 'once' }));
    await Promise.all([ensureCsrf(), ensureCsrf(), ensureCsrf()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('lib/api — 401 → sessiz refresh (ADR-0009 rotasyon)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetCsrfForTests();
    clearCsrfCookie();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Yönlendirme testlerde /login'deyken atlanır (jsdom navigation yok)
    window.history.pushState({}, '', '/login');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCsrfCookie();
    window.history.pushState({}, '', '/');
  });

  it('401 (TOKEN_EXPIRED) → POST /auth/refresh → istek tekrarlanır ve sonuç döner', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ statusCode: 401, message: 'Oturum süresi doldu', error: 'TOKEN_EXPIRED' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1' } })) // POST /auth/refresh
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }));
    const res = await api.get<{ total: number }>('/admin/products?page=1');
    expect(res.total).toBe(0);
    const urls = calledUrls(fetchMock);
    expect(urls).toEqual(['/api/v1/admin/products?page=1', '/api/v1/auth/refresh', '/api/v1/admin/products?page=1']);
    const refreshInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(refreshInit.method).toBe('POST');
    expect(refreshInit.credentials).toBe('include');
  });

  it('refresh da 401 verirse özgün hata fırlatılır, ikinci bir refresh denenmez', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ statusCode: 401, message: 'Oturum gerekli', error: 'UNAUTHENTICATED' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ statusCode: 401, message: 'Oturum bulunamadı', error: 'REFRESH_INVALID' }, { status: 401 }));
    const err = (await api.get('/auth/me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Oturum gerekli');
    expect(calledUrls(fetchMock)).toEqual(['/api/v1/auth/me', '/api/v1/auth/refresh']);
  });

  it('eşzamanlı 401\'ler tek refresh isteği paylaşır', async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse({ user: { id: 'u1' } })), 10));
      }
      // İlk çağrılar 401, yenilemeden sonra 200
      return Promise.resolve(
        refreshCalls === 0
          ? jsonResponse({ statusCode: 401, message: 'Oturum gerekli', error: 'UNAUTHENTICATED' }, { status: 401 })
          : jsonResponse({ ok: true }),
      );
    });
    const [a, b] = await Promise.all([api.get<{ ok: boolean }>('/admin/categories'), api.get<{ ok: boolean }>('/admin/tiers')]);
    expect(a.ok && b.ok).toBe(true);
    expect(refreshCalls).toBe(1);
  });
});

describe('lib/api — buildQuery', () => {
  it('boş/null/undefined atlanır, diğerleri kodlanır; nesne/dizi değerleri yazılmaz', () => {
    expect(buildQuery({ page: 2, q: '', status: undefined, isFresh: true, folder: null })).toBe('?page=2&isFresh=true');
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ q: 'süt ürünleri' })).toBe('?q=s%C3%BCt+%C3%BCr%C3%BCnleri');
    expect(buildQuery({ a: [1, 2], b: { c: 1 }, d: 0, e: false })).toBe('?d=0&e=false');
  });
});
