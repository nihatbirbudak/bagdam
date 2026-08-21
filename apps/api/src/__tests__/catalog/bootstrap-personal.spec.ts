// F9/C — bootstrap kişiselleştirmesi: `serverNow` (kesim geri sayımı [B49]) + oturumlu üyenin `sub` DTO'su.
// Gerçek Nest + WebModule (hbs) + gerçek DB: `/uyelik.html` sayfasındaki gömülü `window.__BAGDAM__` yükü,
// `GET /api/v1/me/subscription` yanıtıyla BİREBİR aynı olmalı (tek doğruluk kaynağı SubscriptionsService.getForUser).
import { CookieJar } from '../auth/cookie-jar';
import { bodyOf, createSubsApp, type JsonBody, type SubsApp } from '../subscriptions/harness';

jest.setTimeout(300_000);

// Sayfa: kutu.html (ADR-0003 istisna sayfası; cart.js sub + kesim geri sayımını burada kullanır).
// NOT: uyelik.hbs şu an Handlebars'ta derlenmiyor (satır 99'daki HTML yorumunda `{{{ }}}` var) → 500;
// bootstrap yükü her sayfada aynı olduğundan test kutu.html üzerinden koşar (bkz. açık sorunlar).
const PAGE = '/kutu.html';

/** Sayfadaki `window.__BAGDAM__ = {...};` atamasını çözer (partials/bootstrap.hbs). */
function readBootstrap(html: string): JsonBody {
  const marker = 'window.__BAGDAM__';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('sayfada window.__BAGDAM__ yok');
  const eq = html.indexOf('=', start);
  const open = html.indexOf('{', eq);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(open, i + 1)) as JsonBody;
    }
  }
  throw new Error('bootstrap JSON kapanışı bulunamadı');
}

describe('Bootstrap kişiselleştirme — serverNow + oturumlu sub (F9)', () => {
  let app: SubsApp;

  beforeAll(async () => {
    app = await createSubsApp({ web: true });
  });

  afterAll(async () => {
    try {
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('anonim sayfa: me/sub null, serverNow taze ve sunucu saatine yakın', async () => {
    const before = Date.now();
    const res = await app.call('GET', PAGE, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    const payload = readBootstrap(await res.text());
    expect(payload.me).toBeNull();
    expect(payload.sub).toBeNull();
    const serverNow = Date.parse(payload.serverNow as string);
    expect(Number.isNaN(serverNow)).toBe(false);
    expect(serverNow).toBeGreaterThanOrEqual(before - 1000);
    expect(serverNow).toBeLessThanOrEqual(Date.now() + 1000);

    // Cache'lenen anonim yükte bile serverNow her istekte tazelenir (60 s cache'e takılmaz)
    await new Promise((r) => setTimeout(r, 1100));
    const second = readBootstrap(await (await app.call('GET', PAGE, { headers: { accept: 'text/html' } })).text());
    expect(Date.parse(second.serverNow as string)).toBeGreaterThan(serverNow);
  });

  it('oturumlu sayfa: __BAGDAM__.sub = GET /me/subscription yanıtı (aynı DTO); me dolu; deliveryDates cutoffAtIso mutlak', async () => {
    const fx = await app.createFixture();
    const jar = new CookieJar();
    expect((await app.login(jar, fx.email, fx.password)).status).toBe(200);

    const page = await app.call('GET', PAGE, { jar, headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store'); // çerezli HTML saklanmaz
    const payload = readBootstrap(await page.text());

    expect(payload.me).toMatchObject({ loggedIn: true, email: fx.email });
    const sub = payload.sub as JsonBody;
    expect(sub).not.toBeNull();
    expect(sub.id).toBe(fx.subscriptionId);
    expect(sub).toMatchObject({ status: 'ACTIVE', purchased: true, active: false, type: 'subscription', deliveryDay: 'sali' });

    // `GET /me/subscription` ile birebir aynı gövde
    const api = await bodyOf<JsonBody>(await app.call('GET', '/api/v1/me/subscription', { jar }));
    expect(sub).toEqual(api);

    // Kesim geri sayımı kaynakları: sub.currentCycle.cutoffAtIso + deliveryDates[].cutoffAtIso mutlak ISO
    const current = sub.currentCycle as JsonBody;
    expect(Number.isNaN(Date.parse(current.cutoffAtIso as string))).toBe(false);
    const dates = payload.deliveryDates as Array<JsonBody>;
    for (const d of dates) expect(Number.isNaN(Date.parse(d.cutoffAtIso as string))).toBe(false);
  });

  it('aboneliği olmayan üye: sub null (cart.js localStorage taslağına düşer)', async () => {
    const email = `nosub-page-${Date.now().toString(36)}@test.local`;
    const password = 'Test-1234!';
    const bcrypt = await import('bcrypt');
    const user = await app.prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 4), name: 'Abonesiz', role: 'CUSTOMER', isActive: true },
      select: { id: true },
    });
    try {
      const jar = new CookieJar();
      expect((await app.login(jar, email, password)).status).toBe(200);
      const payload = readBootstrap(await (await app.call('GET', PAGE, { jar, headers: { accept: 'text/html' } })).text());
      expect(payload.me).toMatchObject({ loggedIn: true, email });
      expect(payload.sub).toBeNull();
      expect(typeof payload.serverNow).toBe('string');
    } finally {
      await app.prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('REST bootstrap: serverNow dolu; oturumlu istekte me dolu, sub null (abonelik /me/subscription ucundan)', async () => {
    const fx = await app.createFixture();
    const jar = new CookieJar();
    await app.login(jar, fx.email, fx.password);
    const anon = await bodyOf<JsonBody>(await app.call('GET', '/api/v1/bootstrap'));
    expect(typeof anon.serverNow).toBe('string');
    expect(anon.me).toBeNull();
    const withSession = await bodyOf<JsonBody>(await app.call('GET', '/api/v1/bootstrap', { jar }));
    expect(withSession.me).toMatchObject({ loggedIn: true, email: fx.email });
    expect(withSession.sub).toBeNull();
  });
});
