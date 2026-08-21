// F10 güvenlik — CSRF (double-submit), kütle atama beyaz listesi, SQL enjeksiyon denemesi (Prisma parametrik),
// XSS (inline bootstrap JSON kaçışı). Gerçek DB: tek geçici müşteri; sonda silinir.
import '../helpers/env';
import { toScriptJson } from '../../web/bootstrap-json';
import { CookieJar } from '../auth/cookie-jar';
import {
  AUTH,
  RUN,
  bodyOf,
  cleanupSecurityData,
  createSecurityApp,
  loginSeedAdmin,
  makeActor,
  type ErrorBody,
  type SecurityActor,
  type SecurityApp,
} from './security-harness';

jest.setTimeout(240_000);

/** Sorgu/gövde alanlarına basılan klasik SQL enjeksiyon yükleri. */
const SQL_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "1' UNION SELECT email, passwordHash FROM users --",
  "%' OR 1=1 --",
];

describe('CSRF · kütle atama · SQL enjeksiyon · XSS (F10)', () => {
  let t: SecurityApp;
  const startedAt = new Date();
  const adminJar = new CookieJar();
  let adminId = '';
  let customer: SecurityActor;

  beforeAll(async () => {
    t = await createSecurityApp();
    adminId = await loginSeedAdmin(t, adminJar);
    customer = await makeActor(t, 'CUSTOMER', 'csrf');
  });

  afterAll(async () => {
    if (!t) return;
    await cleanupSecurityData(t, [customer?.id].filter(Boolean) as string[], [customer?.email].filter(Boolean) as string[], startedAt);
    await t.prisma.auditLog.deleteMany({ where: { actorId: adminId, createdAt: { gte: startedAt } } });
    await t.close();
  });

  /* ── CSRF (ADR-0009 double-submit) ──────────────────────────────────────── */

  it('CSRF: çerezli mutasyonda X-CSRF-Token yoksa 403 CSRF_INVALID; yanlış token 403; doğru token geçer', async () => {
    const body = { kind: 'MARKETING_EMAIL', granted: true };

    const noToken = await t.call('POST', '/api/v1/me/consents', { jar: customer.jar, csrf: false, body });
    expect(noToken.status).toBe(403);
    const err = await bodyOf<ErrorBody>(noToken);
    expect(err.code).toBe('CSRF_INVALID');

    const wrongToken = await t.call('POST', '/api/v1/me/consents', {
      jar: customer.jar,
      csrf: false,
      headers: { 'x-csrf-token': 'baska-bir-token' },
      body,
    });
    expect(wrongToken.status).toBe(403);

    const ok = await t.call('POST', '/api/v1/me/consents', { jar: customer.jar, body });
    expect(ok.status).toBe(201);
  });

  it('CSRF: GET/HEAD güvenli sayılır; anonim public mutasyon (oturum çerezi yok) token istemez', async () => {
    expect((await t.call('GET', '/api/v1/me/consents', { jar: customer.jar, csrf: false })).status).toBe(200);

    const anon = await t.call('POST', '/api/v1/wholesale-leads', {
      body: { email: `test-f10-toptan-${RUN}@bagdam.test` },
    });
    expect([201, 429]).toContain(anon.status);
    await t.prisma.wholesaleLead.deleteMany({ where: { email: `test-f10-toptan-${RUN}@bagdam.test` } });
  });

  it('CSRF çerezi HttpOnly değil (double-submit için okunmalı), oturum çerezleri HttpOnly + SameSite', async () => {
    const jar = new CookieJar();
    const res = await t.call('GET', `${AUTH}/csrf`, { jar });
    const cookies = res.headers.getSetCookie();
    const csrf = cookies.find((c) => c.startsWith('csrf_token='));
    expect(csrf).toBeDefined();
    expect(csrf!.toLowerCase()).not.toContain('httponly');
    expect(csrf!.toLowerCase()).toContain('samesite');

    const loginRes = await t.login(new CookieJar(), customer.email, 'Guvenlik-Parola-123');
    const access = loginRes.headers.getSetCookie().find((c) => c.startsWith('access_token='));
    expect(access!.toLowerCase()).toContain('httponly');
    expect(access!.toLowerCase()).toContain('samesite');
  });

  /* ── Kütle atama (ValidationPipe whitelist + forbidNonWhitelisted) ───────── */

  it('kütle atama: DTO dışı alan 400 — adres (userId), onay (iysStatus), toptan (status)', async () => {
    const address = await t.call('PUT', '/api/v1/me/address', {
      jar: customer.jar,
      body: {
        fullName: 'F10 Test',
        phone: '+90 555 000 00 02',
        line: 'Test Sokak No 1 Urla',
        zoneSlug: 'urla',
        userId: 'baska-kullanici-id',
      },
    });
    expect(address.status).toBe(400);

    const consent = await t.call('POST', '/api/v1/me/consents', {
      jar: customer.jar,
      body: { kind: 'MARKETING_EMAIL', granted: true, iysStatus: 'APPROVED' },
    });
    expect(consent.status).toBe(400);

    const lead = await t.call('POST', '/api/v1/wholesale-leads', {
      body: { email: `test-f10-mass-${RUN}@bagdam.test`, status: 'CONVERTED' },
    });
    expect(lead.status).toBe(400);
  });

  it('kütle atama: KVKK/sözleşme onayı /me/consents üzerinden değiştirilemez (yalnız pazarlama izinleri)', async () => {
    const res = await t.call('POST', '/api/v1/me/consents', { jar: customer.jar, body: { kind: 'KVKK_ACK', granted: false } });
    expect(res.status).toBe(400);
  });

  /* ── SQL enjeksiyon (Prisma parametrik sorgular) ─────────────────────────── */

  it('SQL enjeksiyon: arama/filtre alanlarındaki yükler 200/400 döner, veri sızmaz, tablo durur', async () => {
    const usersBefore = await t.prisma.user.count();
    for (const payload of SQL_PAYLOADS) {
      const q = encodeURIComponent(payload);
      const customers = await t.call('GET', `/api/v1/admin/customers?search=${q}`, { jar: adminJar });
      expect([200, 400]).toContain(customers.status);
      if (customers.status === 200) {
        const body = await bodyOf<{ items?: unknown[] }>(customers);
        const raw = JSON.stringify(body);
        expect(raw).not.toContain('passwordHash');
        expect(raw).not.toMatch(/\$2[aby]\$/); // bcrypt hash deseni
      }

      const audit = await t.call('GET', `/api/v1/admin/audit-logs?search=${q}`, { jar: adminJar });
      expect([200, 400]).toContain(audit.status);

      const logs = await t.call('GET', `/api/v1/admin/system-logs?search=${q}`, { jar: adminJar });
      expect([200, 400]).toContain(logs.status);
    }
    expect(await t.prisma.user.count()).toBe(usersBefore);
  });

  it('SQL enjeksiyon: yol parametresindeki yük 400/404 verir (slug/id deseni)', async () => {
    for (const payload of SQL_PAYLOADS) {
      const res = await t.call('GET', `/api/v1/products/${encodeURIComponent(payload)}`);
      expect([400, 404]).toContain(res.status);
      const raw = JSON.stringify(await bodyOf(res));
      expect(raw).not.toContain('syntax error');
      expect(raw).not.toContain('prisma');
      expect(raw).not.toContain('PostgreSQL');
    }
  });

  /* ── XSS ─────────────────────────────────────────────────────────────────── */

  it('XSS: inline bootstrap JSON kaçışı — </script>, <!--, U+2028/U+2029 ham geçmez', () => {
    const payload = {
      name: '</script><script>alert(1)</script>',
      note: '<!-- yorum -->',
      sep: `satir${String.fromCharCode(0x2028)}sonu${String.fromCharCode(0x2029)}`,
    };
    const json = toScriptJson(payload);
    expect(json).not.toContain('</script>');
    expect(json).not.toContain('<!--');
    expect(json).not.toContain(String.fromCharCode(0x2028));
    expect(json).not.toContain(String.fromCharCode(0x2029));
    expect(json).toContain('\\u003c');
    expect(json).toContain('\\u2028');
    // Kaçışlı metin yine geçerli JSON ve aynı değeri verir
    expect(JSON.parse(json)).toEqual(payload);
  });

  it('XSS: API yanıtı JSON olarak döner (text/html değil) — tarayıcı içerik olarak yürütemez', async () => {
    const res = await t.call('GET', '/api/v1/admin/system-logs?search=%3Cscript%3Ealert(1)%3C%2Fscript%3E', { jar: adminJar });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
