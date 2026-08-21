// F10 — çerez onay şeridi (ADR-0015; ADR-0003 piksel parite istisnası).
// Sözleşme: şerit 10 sayfada basılır, SUNUCUDA GİZLİDİR (`style="display:none"`, `position:fixed`) ve yalnız
// cart.js `// F10 cookie:` bloğu gösterir → maskeli parite koşusunda 0 px. Kapalı kategori (Setting cookies.*)
// markup'a hiç girmez. Karar `POST /api/v1/consents` ile Consent tablosuna da yazılır.
import '../helpers/env';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { API_ROOT } from '../helpers/env';
import { CookieJar } from '../auth/cookie-jar';
import { createSubsApp, type SubsApp } from '../subscriptions/harness';

jest.setTimeout(300_000);

const VIEWS_DIR = resolve(API_ROOT, 'views');
const WEB_PAGES = ['index', 'urunler', 'urun', 'kutu', 'sepet', 'uyelik', 'gunluk', 'toptan', 'politikalar', 'nasil-seciyoruz'];
/** Şablon derlenmeyen uyelik.hbs dışında render edilebilen sayfalar (bkz. bootstrap-personal.spec.ts notu). */
const RENDERABLE = ['/index.html', '/kutu.html?tier=sezon', '/politikalar.html'];

function readView(name: string): string {
  return readFileSync(resolve(VIEWS_DIR, `${name}.hbs`), 'utf8');
}

describe('F10 — çerez onay şeridi', () => {
  let t: SubsApp;
  const guestKey = `test-cookie-${Date.now().toString(36)}`;
  /** Testten önceki `cookies.*` satırları — sonunda BİREBİR geri yüklenir (seed satırı silinmesin). */
  let cookieRowsBefore: Array<{ key: string; value: unknown }> = [];

  beforeAll(async () => {
    t = await createSubsApp({ web: true });
    cookieRowsBefore = (await t.prisma.setting.findMany({ where: { group: 'cookies' }, select: { key: true, value: true } })).map((r) => ({ key: r.key, value: r.value }));
  });

  afterAll(async () => {
    if (!t) return;
    try {
      await t.prisma.consent.deleteMany({ where: { guestKey } });
      // cookies.* satırlarını testten önceki hâline getir (seed satırı silinmez, yeni satır bırakılmaz)
      const keep = new Set(cookieRowsBefore.map((r) => r.key));
      await t.prisma.setting.deleteMany({ where: { group: 'cookies', key: { notIn: [...keep] } } });
      for (const row of cookieRowsBefore) {
        await t.prisma.setting.update({ where: { key: row.key }, data: { value: row.value as never } });
      }
      t.settings.invalidate('cookies');
      await t.cleanup();
    } finally {
      await t.close();
    }
  });

  it('10 sayfa partial\'ı footer\'dan hemen önce çağırır', () => {
    for (const page of WEB_PAGES) {
      const html = readView(page);
      expect(html).toContain('{{> cookie_consent}}');
      const banner = html.indexOf('{{> cookie_consent}}');
      const footer = html.indexOf('{{> site_footer}}');
      expect(footer).toBeGreaterThan(banner);
    }
  });

  it('partial: varsayılan gizli + position:fixed + 3 düğme + politika bağlantıları', () => {
    const partial = readFileSync(resolve(VIEWS_DIR, 'partials', 'cookie-consent.hbs'), 'utf8');
    expect(partial).toContain('id="cookieConsent"');
    expect(partial).toMatch(/style="display:none;[^"]*position:fixed/);
    expect(partial).toContain('id="cookieConsentReject"');
    expect(partial).toContain('id="cookieConsentManageBtn"');
    expect(partial).toContain('id="cookieConsentAccept"');
    expect(partial).toContain('>Reddet<');
    expect(partial).toContain('>Yönet<');
    expect(partial).toContain('>Kabul Et<');
    expect(partial).toContain('politikalar.html#cerez');
    expect(partial).toContain('politikalar.html#kvkk');
    // Zorunlu kategori her zaman; analitik/pazarlama Setting'e bağlı
    expect(partial).toContain('Zorunlu');
    expect(partial).toContain('{{#if cookies.analyticsEnabled}}');
    expect(partial).toContain('{{#if cookies.marketingEnabled}}');
  });

  it('cart.js: `// F10 cookie:` bloğu — localStorage anahtarı, POST /consents, dışa aktarım', () => {
    const cart = readFileSync(resolve(API_ROOT, 'public', 'assets', 'cart.js'), 'utf8');
    expect(cart).toContain('// ---- F10 cookie:');
    expect(cart).toContain('bagdam_cookie_consent');
    expect(cart).toContain('COOKIE_ANALYTICS');
    expect(cart).toContain('COOKIE_MARKETING');
    expect(cart).toContain('api("/consents"');
    expect(cart).toContain('wireCookieConsent(document)');
    expect(cart).toMatch(/getCookieConsent,\s*cookieConsentAllows,\s*wireCookieConsent,/);
  });

  it('render: şerit gizli basılır; kapalı kategoriler markup\'ta YOK', async () => {
    await t.settings.set('cookies', { analyticsEnabled: false, marketingEnabled: false });
    for (const path of RENDERABLE) {
      const res = await t.call('GET', path, { headers: { accept: 'text/html' } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="cookieConsent"');
      expect(html).toMatch(/id="cookieConsent"[\s\S]{0,400}?style="display:none;/);
      expect(html).toContain('data-analytics="0"');
      expect(html).toContain('data-marketing="0"');
      expect(html).not.toContain('id="cookieConsentAnalytics"');
      expect(html).not.toContain('id="cookieConsentMarketing"');
      // Şerit footer'dan ÖNCE ve akış dışında (position:fixed)
      expect(html.indexOf('id="cookieConsent"')).toBeLessThan(html.indexOf('site-foot'));
    }
  });

  it('Setting cookies.analyticsEnabled=true → analitik seçeneği basılır (pazarlama hâlâ yok)', async () => {
    await t.settings.set('cookies', { analyticsEnabled: true, marketingEnabled: false });
    const res = await t.call('GET', '/index.html', { headers: { accept: 'text/html' } });
    const html = await res.text();
    expect(html).toContain('data-analytics="1"');
    expect(html).toContain('id="cookieConsentAnalytics"');
    expect(html).not.toContain('id="cookieConsentMarketing"');
    await t.settings.set('cookies', { analyticsEnabled: false, marketingEnabled: false });
  });

  it('POST /consents: anonim ziyaretçi COOKIE_ANALYTICS/COOKIE_MARKETING kaydı (granted true/false, guestKey + ip/ua)', async () => {
    const jar = new CookieJar();
    const accepted = await t.call('POST', '/api/v1/consents', {
      jar,
      body: { kind: 'COOKIE_ANALYTICS', granted: true, guestKey, source: 'HS_WEB' },
      headers: { 'user-agent': 'jest-cookie-test' },
    });
    expect(accepted.status).toBe(201);
    const rejected = await t.call('POST', '/api/v1/consents', {
      jar,
      body: { kind: 'COOKIE_MARKETING', granted: false, guestKey, source: 'HS_WEB' },
      headers: { 'user-agent': 'jest-cookie-test' },
    });
    expect(rejected.status).toBe(201);

    const rows = await t.prisma.consent.findMany({ where: { guestKey }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => `${r.kind}:${r.granted}`)).toEqual(['COOKIE_ANALYTICS:true', 'COOKIE_MARKETING:false']);
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.userAgent).toBe('jest-cookie-test');
    expect(rows[0]!.ipAddress).toBeTruthy();
  });
});
