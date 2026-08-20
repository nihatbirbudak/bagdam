// F6 — Me HTTP: /api/v1/me adres (upsert tek adres, zoneId|zoneSlug, aktif bölge doğrulaması 400 ZONE_INVALID/ZONE_REQUIRED),
// onaylar (tür başına son kayıt; POST pazarlama izni → Consent PENDING + User.marketingOptIn; KVKK değiştirilemez),
// siparişler/kartlar F8 yer tutucu; oturumsuz 401; CSRF'siz PUT 403; audit satırları (adres alanları redakte).
import '../helpers/env';
import { randomUUID } from 'crypto';
import type { MeAddress, MeConsent } from '@bagdam/shared';
import { cleanupUsers, createF6App, type ErrorBody, type F6App } from '../auth/f6-harness';
import { CookieJar } from '../auth/cookie-jar';

jest.setTimeout(180_000);

const suffix = randomUUID().slice(0, 8);
const EMAIL = `test-f6-me-${suffix}@bagdam.test`;
const PASSWORD = 'Me-Parola-123';
const ME = '/api/v1/me';

describe('Me HTTP — /api/v1/me address · consents · orders · cards (F6)', () => {
  let t: F6App;
  const startedAt = new Date();
  const jar = new CookieJar();
  let userId = '';
  let urlaId = '';
  let addressId = '';

  beforeAll(async () => {
    t = await createF6App();
    userId = await t.createUser({ email: EMAIL, password: PASSWORD, name: 'Me Test' });
    const urla = await t.prisma.deliveryZone.findUniqueOrThrow({ where: { slug: 'urla' } });
    urlaId = urla.id;
    const login = await t.login(jar, EMAIL, PASSWORD);
    expect(login.status).toBe(200);
  });

  afterAll(async () => {
    if (t) {
      await cleanupUsers(t.prisma, [userId], [EMAIL], startedAt);
      await t.close();
    }
  });

  it('oturumsuz → 401; GET /me/address başta null; GET /me/orders {items:[],total:0}; GET /me/cards []', async () => {
    expect((await t.call('GET', `${ME}/address`)).status).toBe(401);
    expect((await t.call('GET', `${ME}/consents`)).status).toBe(401);

    const address = await t.call('GET', `${ME}/address`, { jar });
    expect(address.status).toBe(200);
    expect(await address.json()).toBeNull();

    const orders = await t.call('GET', `${ME}/orders`, { jar });
    expect(orders.status).toBe(200);
    expect(await orders.json()).toEqual({ items: [], total: 0 });

    const cards = await t.call('GET', `${ME}/cards`, { jar });
    expect(cards.status).toBe(200);
    expect(await cards.json()).toEqual([]);
  });

  it('PUT /me/address: bölge yok → 400 ZONE_REQUIRED; bilinmeyen zoneId/zoneSlug → 400 ZONE_INVALID; telefon zorunlu → 400; CSRF\'siz → 403', async () => {
    const base = { fullName: 'Me Test', phone: '+90 555 111 22 33', line: 'Kuşçular Mah. 8034 Sk. No:38 Urla' };
    const none = await t.call('PUT', `${ME}/address`, { jar, body: base });
    expect(none.status).toBe(400);
    expect(((await none.json()) as ErrorBody).error).toBe('ZONE_REQUIRED');

    const badId = await t.call('PUT', `${ME}/address`, { jar, body: { ...base, zoneId: 'clxxxxxxxxxxxxxxxxxxxxxxx' } });
    expect(badId.status).toBe(400);
    expect(((await badId.json()) as ErrorBody).error).toBe('ZONE_INVALID');

    const badSlug = await t.call('PUT', `${ME}/address`, { jar, body: { ...base, zoneSlug: `yok-${suffix}` } });
    expect(badSlug.status).toBe(400);
    expect(((await badSlug.json()) as ErrorBody).error).toBe('ZONE_INVALID');

    const noPhone = await t.call('PUT', `${ME}/address`, { jar, body: { fullName: 'Me Test', line: base.line, zoneSlug: 'urla' } });
    expect(noPhone.status).toBe(400);

    const noCsrf = await t.call('PUT', `${ME}/address`, { jar, csrf: false, body: { ...base, zoneSlug: 'urla' } });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as ErrorBody).error).toBe('CSRF_INVALID');

    expect(await t.prisma.address.count({ where: { userId } })).toBe(0);
  });

  it('PUT /me/address (zoneSlug) → 200 {id,fullName,phone,line,zoneId,zoneSlug,zip,isDefault}; tekrar PUT (zoneId) aynı satırı günceller; GET döner; audit redakte', async () => {
    const first = await t.call('PUT', `${ME}/address`, {
      jar,
      body: { fullName: ' Me Test ', phone: '+90 555 111 22 33', line: 'Kuşçular Mah. 8034 Sk. No:38', zoneSlug: 'urla', zip: '35430' },
    });
    expect(first.status).toBe(200);
    const a1 = (await first.json()) as MeAddress;
    expect(a1).toMatchObject({ fullName: 'Me Test', phone: '+90 555 111 22 33', line: 'Kuşçular Mah. 8034 Sk. No:38', zoneId: urlaId, zoneSlug: 'urla', zip: '35430', isDefault: true });
    expect(Object.keys(a1).sort()).toEqual(['fullName', 'id', 'isDefault', 'line', 'phone', 'zip', 'zoneId', 'zoneSlug'].sort());
    addressId = a1.id;

    const cesme = await t.prisma.deliveryZone.findUniqueOrThrow({ where: { slug: 'cesme' } });
    const second = await t.call('PUT', `${ME}/address`, {
      jar,
      body: { fullName: 'Me Test İki', phone: '0555 222 33 44', line: 'Alaçatı Mah. Çeşme', zoneId: cesme.id, zip: '' },
    });
    expect(second.status).toBe(200);
    const a2 = (await second.json()) as MeAddress;
    expect(a2.id).toBe(addressId);
    expect(a2).toMatchObject({ fullName: 'Me Test İki', zoneId: cesme.id, zoneSlug: 'cesme', zip: null });
    expect(await t.prisma.address.count({ where: { userId } })).toBe(1);

    const get = await t.call('GET', `${ME}/address`, { jar });
    expect((await get.json()) as MeAddress).toEqual(a2);

    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'me', action: 'UPDATE', actorId: userId, entityId: addressId }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValues)).not.toContain('Alaçatı');
    expect(JSON.stringify(audit?.newValues)).not.toContain('0555');
  });

  it('GET /me/consents başta []; POST {MARKETING_EMAIL,true} → 201 + Consent PENDING + marketingOptIn true; ret → false; KVKK_ACK → 400; oturumsuz 401', async () => {
    const empty = await t.call('GET', `${ME}/consents`, { jar });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    const grant = await t.call('POST', `${ME}/consents`, { jar, body: { kind: 'MARKETING_EMAIL', granted: true } });
    expect(grant.status).toBe(201);
    const granted = (await grant.json()) as MeConsent;
    expect(granted).toMatchObject({ kind: 'MARKETING_EMAIL', granted: true });
    expect(typeof granted.createdAt).toBe('string');
    let user = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.marketingOptIn).toBe(true);
    const rows = await t.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'MARKETING_EMAIL', granted: true, iysStatus: 'PENDING', source: 'HS_WEB' });
    expect(rows[0]!.ipAddress).toBeTruthy();

    const sms = await t.call('POST', `${ME}/consents`, { jar, body: { kind: 'MARKETING_SMS', granted: true } });
    expect(sms.status).toBe(201);

    const revoke = await t.call('POST', `${ME}/consents`, { jar, body: { kind: 'MARKETING_EMAIL', granted: false } });
    expect(revoke.status).toBe(201);
    user = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.marketingOptIn).toBe(false);

    const list = await t.call('GET', `${ME}/consents`, { jar });
    const items = (await list.json()) as MeConsent[];
    expect(items.map((c) => [c.kind, c.granted])).toEqual([
      ['MARKETING_EMAIL', false],
      ['MARKETING_SMS', true],
    ]);
    expect(await t.prisma.consent.count({ where: { userId } })).toBe(3);

    const kvkk = await t.call('POST', `${ME}/consents`, { jar, body: { kind: 'KVKK_ACK', granted: true } });
    expect(kvkk.status).toBe(400);
    const extra = await t.call('POST', `${ME}/consents`, { jar, body: { kind: 'MARKETING_EMAIL', granted: true, source: 'X' } });
    expect(extra.status).toBe(400);
    expect((await t.call('POST', `${ME}/consents`, { body: { kind: 'MARKETING_EMAIL', granted: true } })).status).toBe(401);
  });
});
