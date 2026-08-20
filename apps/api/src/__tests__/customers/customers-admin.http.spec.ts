// F6 — Customers admin HTTP: /api/v1/admin/customers liste (q/role/sayfalama) · detay (profil + adres + onaylar + audit özeti,
// siparişler boş) · PATCH (isActive false → oturumlar düşer; name/phone) · anonimleştir (yalnız ADMIN; e-posta anon+id@anon.local,
// ad/telefon/adres silinir, isActive false, anonymizedAt, refresh null; ikinci kez 409; STAFF 403) · CUSTOMER 403 · audit satırları.
import '../helpers/env';
import { randomUUID } from 'crypto';
import type { AdminCustomerAnonymizeResult, AdminCustomerDetail, AdminCustomerList, AdminCustomerListItem } from '@bagdam/shared';
import { AUTH, cleanupUsers, createF6App, type ErrorBody, type F6App } from '../auth/f6-harness';
import { CookieJar } from '../auth/cookie-jar';

jest.setTimeout(180_000);

const suffix = randomUUID().slice(0, 8);
const CUSTOMER_EMAIL = `test-f6-cust-${suffix}@bagdam.test`;
const STAFF_EMAIL = `test-f6-staff-${suffix}@bagdam.test`;
const PASSWORD = 'Musteri-Parola-123';
const CUSTOMERS = '/api/v1/admin/customers';

describe('Customers admin HTTP — /api/v1/admin/customers (ekran 16, F6)', () => {
  let t: F6App;
  const startedAt = new Date();
  const adminJar = new CookieJar();
  const staffJar = new CookieJar();
  const customerJar = new CookieJar();
  let adminId = '';
  let customerId = '';
  let staffId = '';

  beforeAll(async () => {
    t = await createF6App();
    customerId = await t.createUser({ email: CUSTOMER_EMAIL, password: PASSWORD, name: 'Müşteri Test' });
    staffId = await t.createUser({ email: STAFF_EMAIL, password: PASSWORD, name: 'Personel Test', role: 'STAFF' });
    const urla = await t.prisma.deliveryZone.findUniqueOrThrow({ where: { slug: 'urla' } });
    await t.prisma.user.update({ where: { id: customerId }, data: { phone: '+90 555 999 88 77' } });
    await t.prisma.address.create({ data: { userId: customerId, fullName: 'Müşteri Test', phone: '+90 555 999 88 77', line: 'Test Sk. 1', zoneId: urla.id, isDefault: true } });
    await t.prisma.consent.create({ data: { userId: customerId, kind: 'KVKK_ACK', granted: true, source: 'HS_WEB' } });
    await t.prisma.consent.create({ data: { userId: customerId, kind: 'MARKETING_EMAIL', granted: true, source: 'HS_WEB', iysStatus: 'PENDING' } });
    adminId = await t.loginSeedAdmin(adminJar);
    expect((await t.login(staffJar, STAFF_EMAIL, PASSWORD)).status).toBe(200);
    expect((await t.login(customerJar, CUSTOMER_EMAIL, PASSWORD)).status).toBe(200);
  });

  afterAll(async () => {
    if (t) {
      await cleanupUsers(t.prisma, [customerId, staffId], [CUSTOMER_EMAIL, STAFF_EMAIL], startedAt);
      await t.prisma.auditLog.deleteMany({ where: { module: 'customers', actorId: adminId, createdAt: { gte: startedAt } } });
      await t.close();
    }
  });

  it('GET /admin/customers: CUSTOMER → 403; oturumsuz → 401; ADMIN/STAFF → {items,total,page,limit}; q ve role filtreleri', async () => {
    expect((await t.call('GET', CUSTOMERS, { jar: customerJar })).status).toBe(403);
    expect((await t.call('GET', CUSTOMERS)).status).toBe(401);

    const res = await t.call('GET', `${CUSTOMERS}?q=test-f6-cust-${suffix}&limit=10`, { jar: adminJar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminCustomerList;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.total).toBe(1);
    const item = body.items[0]!;
    expect(item).toMatchObject({ id: customerId, email: CUSTOMER_EMAIL, name: 'Müşteri Test', phone: '+90 555 999 88 77', role: 'CUSTOMER', isActive: true, anonymizedAt: null });
    expect(item).toHaveProperty('emailVerifiedAt');
    expect(item).toHaveProperty('lastLoginAt');
    expect(item).not.toHaveProperty('passwordHash');
    expect(item).not.toHaveProperty('refreshTokenHash');

    const staffList = await t.call('GET', `${CUSTOMERS}?q=${suffix}&role=STAFF`, { jar: staffJar });
    expect(staffList.status).toBe(200);
    const staffBody = (await staffList.json()) as AdminCustomerList;
    expect(staffBody.items.map((i) => i.id)).toEqual([staffId]);

    const byName = await t.call('GET', `${CUSTOMERS}?q=${encodeURIComponent('müşteri test')}&role=CUSTOMER`, { jar: adminJar });
    expect(((await byName.json()) as AdminCustomerList).items.some((i) => i.id === customerId)).toBe(true);

    const badRole = await t.call('GET', `${CUSTOMERS}?role=GOD`, { jar: adminJar });
    expect(badRole.status).toBe(400);
  });

  it('GET /admin/customers/:id → profil + adres + onaylar + audit özeti + orders [] + subscription null; bilinmeyen → 404', async () => {
    const res = await t.call('GET', `${CUSTOMERS}/${customerId}`, { jar: adminJar });
    expect(res.status).toBe(200);
    const d = (await res.json()) as AdminCustomerDetail;
    expect(d).toMatchObject({ id: customerId, email: CUSTOMER_EMAIL, marketingOptIn: false, orders: [], subscription: null });
    expect(d.address).toMatchObject({ fullName: 'Müşteri Test', phone: '+90 555 999 88 77', line: 'Test Sk. 1', zoneSlug: 'urla', isDefault: true });
    expect(d.consents.map((c) => c.kind).sort()).toEqual(['KVKK_ACK', 'MARKETING_EMAIL']);
    expect(d.consents.find((c) => c.kind === 'MARKETING_EMAIL')?.iysStatus).toBe('PENDING');
    expect(Array.isArray(d.audit)).toBe(true);
    // Müşterinin LOGIN audit satırı özetinde
    expect(d.audit.some((a) => a.module === 'auth' && a.action === 'LOGIN')).toBe(true);
    expect(typeof d.updatedAt).toBe('string');

    const missing = await t.call('GET', `${CUSTOMERS}/clxxxxxxxxxxxxxxxxxxxxxxx`, { jar: adminJar });
    expect(missing.status).toBe(404);
  });

  it('PATCH /admin/customers/:id: boş gövde 400; name/phone günceller; isActive=false → refreshTokenHash null + müşteri oturumu düşer; audit UPDATE (telefon redakte)', async () => {
    const empty = await t.call('PATCH', `${CUSTOMERS}/${customerId}`, { jar: adminJar, body: {} });
    expect(empty.status).toBe(400);

    const renamed = await t.call('PATCH', `${CUSTOMERS}/${customerId}`, { jar: adminJar, body: { name: 'Yeni Ad', phone: '' } });
    expect(renamed.status).toBe(200);
    const item = (await renamed.json()) as AdminCustomerListItem;
    expect(item.name).toBe('Yeni Ad');
    expect(item.phone).toBeNull();

    // Müşteri oturumu şu an çalışıyor
    expect((await t.call('GET', `${AUTH}/me`, { jar: customerJar })).status).toBe(200);
    const refreshBefore = customerJar.get('refresh_token')!.value;

    const deactivated = await t.call('PATCH', `${CUSTOMERS}/${customerId}`, { jar: adminJar, body: { isActive: false } });
    expect(deactivated.status).toBe(200);
    expect(((await deactivated.json()) as AdminCustomerListItem).isActive).toBe(false);
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(row.isActive).toBe(false);
    expect(row.refreshTokenHash).toBeNull();
    expect((await t.call('GET', `${AUTH}/me`, { jar: customerJar })).status).toBe(401);
    const refresh = await fetch(`${t.baseUrl}${AUTH}/refresh`, { method: 'POST', headers: { cookie: `refresh_token=${refreshBefore}` } });
    expect(refresh.status).toBe(401);
    const login = await t.call('POST', `${AUTH}/login`, { body: { email: CUSTOMER_EMAIL, password: PASSWORD } });
    expect(login.status).toBe(401);

    // Kendi hesabını kapatamaz
    const self = await t.call('PATCH', `${CUSTOMERS}/${adminId}`, { jar: adminJar, body: { isActive: false } });
    expect(self.status).toBe(400);
    expect(((await self.json()) as ErrorBody).error).toBe('SELF_DEACTIVATE');

    // Yeniden aç (anonimleştirme testi için durum fark etmez ama tutarlı kalsın)
    expect((await t.call('PATCH', `${CUSTOMERS}/${customerId}`, { jar: adminJar, body: { isActive: true } })).status).toBe(200);

    const audits = await t.prisma.auditLog.findMany({ where: { module: 'customers', action: 'UPDATE', entityId: customerId, actorId: adminId } });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    const renameAudit = audits.find((a) => JSON.stringify(a.newValues).includes('Yeni Ad'));
    expect(renameAudit).toBeDefined();
    expect((renameAudit?.newValues as Record<string, unknown>).phone).toBe('[redacted]');
    expect((renameAudit?.oldValues as Record<string, unknown>).name).toBe('Müşteri Test');
  });

  it('POST /admin/customers/:id/anonymize: STAFF → 403; ADMIN → 200; PII silindi (e-posta anon+id@anon.local, ad/telefon null, adres yok, isActive false, refresh null, anonymizedAt); ikinci → 409; audit ANONYMIZE', async () => {
    const staff = await t.call('POST', `${CUSTOMERS}/${customerId}/anonymize`, { jar: staffJar });
    expect(staff.status).toBe(403);

    const notCustomer = await t.call('POST', `${CUSTOMERS}/${staffId}/anonymize`, { jar: adminJar });
    expect(notCustomer.status).toBe(409);
    expect(((await notCustomer.json()) as ErrorBody).error).toBe('NOT_CUSTOMER');

    const res = await t.call('POST', `${CUSTOMERS}/${customerId}/anonymize`, { jar: adminJar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminCustomerAnonymizeResult;
    expect(body.id).toBe(customerId);
    expect(body.email).toBe(`anon+${customerId}@anon.local`);
    expect(typeof body.anonymizedAt).toBe('string');

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(row.email).toBe(`anon+${customerId}@anon.local`);
    expect(row.name).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.isActive).toBe(false);
    expect(row.refreshTokenHash).toBeNull();
    expect(row.passwordResetToken).toBeNull();
    expect(row.marketingOptIn).toBe(false);
    expect(row.anonymizedAt).not.toBeNull();
    expect(await t.prisma.address.count({ where: { userId: customerId } })).toBe(0);
    // Onay kayıtları (hukuki kanıt) kalır; PII kullanıcı satırındaydı
    expect(await t.prisma.consent.count({ where: { userId: customerId } })).toBe(2);

    // Eski parola ile giriş olmaz; eski e-posta artık yok
    const login = await t.call('POST', `${AUTH}/login`, { body: { email: CUSTOMER_EMAIL, password: PASSWORD } });
    expect(login.status).toBe(401);

    const again = await t.call('POST', `${CUSTOMERS}/${customerId}/anonymize`, { jar: adminJar });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).error).toBe('ALREADY_ANONYMIZED');
    const patchAfter = await t.call('PATCH', `${CUSTOMERS}/${customerId}`, { jar: adminJar, body: { name: 'X Y' } });
    expect(patchAfter.status).toBe(409);

    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'customers', action: 'ANONYMIZE', entityId: customerId, actorId: adminId } });
    expect(audit).not.toBeNull();

    // Detay hâlâ okunur; anonim alanlar görünür
    const detail = await t.call('GET', `${CUSTOMERS}/${customerId}`, { jar: adminJar });
    expect(detail.status).toBe(200);
    const d = (await detail.json()) as AdminCustomerDetail;
    expect(d.address).toBeNull();
    expect(d.anonymizedAt).not.toBeNull();
  });
});
