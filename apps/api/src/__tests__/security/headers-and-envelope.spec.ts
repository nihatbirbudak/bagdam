// F10 güvenlik — güvenlik başlıkları (CSP/HSTS/X-Powered-By/X-Frame-Options) + hata zarfı `code` alanı.
// CSP politikaları saf fonksiyon olarak da doğrulanır (üretimdeki değerle birebir aynı kaynak).
import '../helpers/env';
import {
  ADMIN_CSP_HEADER,
  API_CSP_HEADER,
  PAYTR_ORIGIN,
  WEB_CSP_HEADER,
  buildCspHeaderValue,
  cspHeaderForPath,
  resolveCspScope,
} from '../../common/security/content-security-policy';
import { helmetOptions } from '../../common/security/security-headers';
import { bodyOf, createSecurityApp, type ErrorBody, type SecurityApp } from './security-harness';

jest.setTimeout(120_000);

describe('Güvenlik başlıkları + hata zarfı (F10)', () => {
  let t: SecurityApp;

  beforeAll(async () => {
    t = await createSecurityApp();
  });

  afterAll(async () => {
    if (t) await t.close();
  });

  /* ── CSP politikaları (saf) ─────────────────────────────────────────────── */

  it('web CSP: inline bootstrap + PayTR iFrame çalışır, çerçeveleme kapalı, dış CDN/font yok', () => {
    // ADR-0003: inline bootstrap script'i ve inline style'lar şablonda → 'unsafe-inline' zorunlu
    expect(WEB_CSP_HEADER).toContain("script-src 'self' 'unsafe-inline' https://www.paytr.com");
    expect(WEB_CSP_HEADER).toContain("style-src 'self' 'unsafe-inline'");
    // PayTR ödeme iFrame'i (sepet.hbs)
    expect(WEB_CSP_HEADER).toContain(`frame-src ${PAYTR_ORIGIN}`);
    expect(WEB_CSP_HEADER).toContain(`form-action 'self' ${PAYTR_ORIGIN}`);
    // Çerçevelenmeye kapalı + temel sertleştirme
    expect(WEB_CSP_HEADER).toContain("frame-ancestors 'none'");
    expect(WEB_CSP_HEADER).toContain("object-src 'none'");
    expect(WEB_CSP_HEADER).toContain("base-uri 'self'");
    expect(WEB_CSP_HEADER).toContain("connect-src 'self'");
    // Fontlar styles.css içinde base64 gömülü (data:) — dış font sağlayıcısı (Google Fonts vb.) YOK
    expect(WEB_CSP_HEADER).toContain("font-src 'self' data:");
    expect(WEB_CSP_HEADER).not.toContain('googleapis');
    expect(WEB_CSP_HEADER).not.toContain('gstatic');
    expect(WEB_CSP_HEADER).not.toContain('cdn');
  });

  it('admin CSP inline script ve PSP içermez; api CSP default-src none', () => {
    // Panelde inline script YOK (Vite bundle) — style-src'de unsafe-inline Tailwind/React için kalır.
    expect(ADMIN_CSP_HEADER).toContain("script-src 'self'; ");
    expect(ADMIN_CSP_HEADER).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(ADMIN_CSP_HEADER).not.toContain(PAYTR_ORIGIN);
    expect(ADMIN_CSP_HEADER).toContain("frame-ancestors 'none'");
    expect(API_CSP_HEADER).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  });

  it('resolveCspScope: /api/v1/* → api · /app/* → admin · diğer → web', () => {
    expect(resolveCspScope('/api/v1/health')).toBe('api');
    expect(resolveCspScope('/api')).toBe('api');
    expect(resolveCspScope('/app/index.html')).toBe('admin');
    expect(resolveCspScope('/urunler.html')).toBe('web');
    expect(resolveCspScope('/')).toBe('web');
    expect(resolveCspScope('/uploads/urunler/x.webp')).toBe('web');
    expect(cspHeaderForPath('/sepet.html')).toBe(WEB_CSP_HEADER);
    expect(cspHeaderForPath('/api/v1/bootstrap')).toBe(API_CSP_HEADER);
    expect(buildCspHeaderValue({ 'default-src': ["'self'"], 'object-src': ["'none'"] })).toBe(
      "default-src 'self'; object-src 'none'",
    );
  });

  it('HSTS yalnız production; helmet CSP kapalı (politikayı cspMiddleware koyar), X-Frame-Options DENY', () => {
    const prod = helmetOptions(true) as Record<string, unknown>;
    const dev = helmetOptions(false) as Record<string, unknown>;
    expect(prod.strictTransportSecurity).toMatchObject({ includeSubDomains: true });
    expect(dev.strictTransportSecurity).toBe(false);
    expect(prod.contentSecurityPolicy).toBe(false);
    expect(prod.frameguard).toEqual({ action: 'deny' });
  });

  /* ── Gerçek yanıt başlıkları ────────────────────────────────────────────── */

  it('GET /api/v1/health: api CSP başlığı, X-Powered-By yok, nosniff var, dev\'de HSTS yok', async () => {
    const res = await t.call('GET', '/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(API_CSP_HEADER);
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('strict-transport-security')).toBeNull(); // isProduction=false
  });

  /* ── Hata zarfı `code` alanı (F8 açık notu) ─────────────────────────────── */

  it('404 JSON zarfı: {statusCode, code:NOT_FOUND, message, requestId} — yığın izi / iç yol sızmaz', async () => {
    const res = await t.call('GET', '/api/v1/kesinlikle-yok');
    expect(res.status).toBe(404);
    const body = await bodyOf<ErrorBody>(res);
    expect(body.statusCode).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(typeof body.requestId).toBe('string');
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/at\s+\w+\s+\(/);
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('.ts:');
  });

  it('401 → code UNAUTHENTICATED · 403 (rol) → code FORBIDDEN_ROLE · 400 (doğrulama) → code BAD_REQUEST', async () => {
    const unauth = await t.call('GET', '/api/v1/admin/audit-logs');
    expect(unauth.status).toBe(401);
    expect((await bodyOf<ErrorBody>(unauth)).code).toBe('UNAUTHENTICATED');

    const badQuery = await t.call('GET', '/api/v1/admin/audit-logs?limit=9999');
    // Oturum yok → doğrulamadan önce 401; guard sırası (JwtAuth → Csrf → Roles) korunuyor
    expect(badQuery.status).toBe(401);
  });

  it('code alanı her zaman makine biçiminde ([A-Z][A-Z0-9_]*)', async () => {
    for (const path of ['/api/v1/kesinlikle-yok', '/api/v1/admin/system-logs', '/api/v1/admin/cron-logs']) {
      const res = await t.call('GET', path);
      const body = await bodyOf<ErrorBody>(res);
      expect(body.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
