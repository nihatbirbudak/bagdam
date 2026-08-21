// F10 güvenlik — yetkisiz erişim matrisi (public / customer / staff / admin) + IDOR + oturum kilidi.
// Gerçek DB: geçici kullanıcılar (kurban · saldırgan · STAFF) + 1 Order yaratılır, sonda silinir.
import '../helpers/env';
import { CookieJar } from '../auth/cookie-jar';
import {
  AUTH,
  PASSWORD,
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

/** İzin matrisi: yol → her rolün beklenen HTTP durumu. 4xx dışı "erişim var" demektir. */
interface MatrixRow {
  path: string;
  anon: number;
  customer: number;
  staff: number[];
  admin: number[];
}

/** Public uçlar herkese açık; admin uçları rol kapısına takılır. */
const MATRIX: MatrixRow[] = [
  // ── Public (anonim erişilebilir)
  { path: '/api/v1/health', anon: 200, customer: 200, staff: [200], admin: [200] },
  { path: '/api/v1/bootstrap', anon: 200, customer: 200, staff: [200], admin: [200] },
  { path: '/api/v1/delivery/zones', anon: 200, customer: 200, staff: [200], admin: [200] },
  // ── Müşteri oturumu gerekli
  { path: '/api/v1/me/address', anon: 401, customer: 200, staff: [200], admin: [200] },
  { path: '/api/v1/me/consents', anon: 401, customer: 200, staff: [200], admin: [200] },
  { path: '/api/v1/me/orders', anon: 401, customer: 200, staff: [200], admin: [200] },
  // ── ADMIN + STAFF
  { path: '/api/v1/admin/system-logs', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/cron-logs', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/webhook-events', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/health/detailed', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/mail-logs', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/customers', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/settings', anon: 401, customer: 403, staff: [200], admin: [200] },
  { path: '/api/v1/admin/dashboard', anon: 401, customer: 403, staff: [200], admin: [200] },
  // ── Yalnız ADMIN (STAFF de 403)
  { path: '/api/v1/admin/audit-logs', anon: 401, customer: 403, staff: [403], admin: [200] },
  { path: '/api/v1/admin/jobs', anon: 401, customer: 403, staff: [403], admin: [200] },
];

describe('Yetkisiz erişim matrisi + IDOR + oturum kilidi (F10)', () => {
  let t: SecurityApp;
  const startedAt = new Date();
  const adminJar = new CookieJar();
  let adminId = '';
  let victim: SecurityActor;
  let attacker: SecurityActor;
  let staff: SecurityActor;
  let victimOrderNo = 0;
  const lockedEmail = `test-f10-lock-${RUN}@bagdam.test`;
  let lockedId = '';

  beforeAll(async () => {
    t = await createSecurityApp();
    adminId = await loginSeedAdmin(t, adminJar);
    victim = await makeActor(t, 'CUSTOMER', 'kurban');
    attacker = await makeActor(t, 'CUSTOMER', 'saldirgan');
    staff = await makeActor(t, 'STAFF', 'staff');
    lockedId = await t.createUser({ email: lockedEmail, password: PASSWORD });

    // IDOR için kurbanın siparişi (checkout motoru çalıştırılmadan doğrudan satır — salt okuma testi)
    const order = await t.prisma.order.create({
      data: {
        kind: 'SINGLE',
        status: 'PAID',
        userId: victim.id,
        customerName: 'F10 Kurban',
        customerEmail: victim.email,
        customerPhone: '+905550000001',
        deliveryDay: 'SALI',
        deliveryOn: new Date('2027-01-05'),
        addressSnapshot: { fullName: 'F10 Kurban', phone: '+905550000001', line: 'Test Sokak 1', zoneName: 'Urla' },
        subtotal: '100.00',
        grandTotal: '100.00',
      },
      select: { orderNo: true },
    });
    victimOrderNo = order.orderNo;
  });

  afterAll(async () => {
    if (!t) return;
    await cleanupSecurityData(
      t,
      [victim?.id, attacker?.id, staff?.id, lockedId].filter(Boolean) as string[],
      [victim?.email, attacker?.email, staff?.email, lockedEmail].filter(Boolean) as string[],
      startedAt,
    );
    await t.prisma.auditLog.deleteMany({ where: { actorId: adminId, createdAt: { gte: startedAt } } });
    await t.close();
  });

  it('erişim matrisi: anonim / müşteri / STAFF / ADMIN — her uç beklenen durumu döner', async () => {
    const failures: string[] = [];
    for (const row of MATRIX) {
      const anon = await t.call('GET', row.path);
      if (anon.status !== row.anon) failures.push(`anon ${row.path}: ${anon.status} ≠ ${row.anon}`);

      const cust = await t.call('GET', row.path, { jar: victim.jar });
      if (cust.status !== row.customer) failures.push(`customer ${row.path}: ${cust.status} ≠ ${row.customer}`);

      const st = await t.call('GET', row.path, { jar: staff.jar });
      if (!row.staff.includes(st.status)) failures.push(`staff ${row.path}: ${st.status} ∉ ${row.staff.join('|')}`);

      const ad = await t.call('GET', row.path, { jar: adminJar });
      if (!row.admin.includes(ad.status)) failures.push(`admin ${row.path}: ${ad.status} ∉ ${row.admin.join('|')}`);
    }
    expect(failures).toEqual([]);
  });

  it('rol yükseltme denemesi: müşteri kendi rolünü PATCH ile ADMIN yapamaz (kütle atama beyaz listesi)', async () => {
    const res = await t.call('PATCH', `${AUTH}/me`, { jar: victim.jar, body: { name: 'Yeni Ad', role: 'ADMIN' } });
    expect(res.status).toBe(400);
    const me = await t.prisma.user.findUniqueOrThrow({ where: { id: victim.id }, select: { role: true } });
    expect(me.role).toBe('CUSTOMER');
  });

  it('IDOR: saldırgan kurbanın siparişini göremez (404); sahibi görebilir', async () => {
    const mine = await t.call('GET', `/api/v1/me/orders/${victimOrderNo}`, { jar: victim.jar });
    expect(mine.status).toBe(200);

    const stolen = await t.call('GET', `/api/v1/me/orders/${victimOrderNo}`, { jar: attacker.jar });
    expect([403, 404]).toContain(stolen.status);

    const status = await t.call('GET', `/api/v1/orders/${victimOrderNo}/status`, { jar: attacker.jar });
    expect([403, 404]).toContain(status.status);

    // Saldırganın kendi sipariş listesi kurbanın siparişini içermez
    const list = await t.call('GET', '/api/v1/me/orders', { jar: attacker.jar });
    expect(list.status).toBe(200);
    const body = await bodyOf<{ items?: Array<{ orderNo: number }> }>(list);
    const items = Array.isArray(body?.items) ? body.items : [];
    expect(items.some((o) => o.orderNo === victimOrderNo)).toBe(false);
  });

  it('IDOR: müşteri başka müşterinin admin detayını çekemez (rol kapısı 403, kimlik sızmaz)', async () => {
    const res = await t.call('GET', `/api/v1/admin/customers/${victim.id}`, { jar: attacker.jar });
    expect(res.status).toBe(403);
    const raw = JSON.stringify(await bodyOf(res));
    expect(raw).not.toContain(victim.email);
  });

  it('oturum kilidi: 5 hatalı parola → 423, sonra doğru parola da girilemez (ADR-0009, 30 dk)', async () => {
    const jar = new CookieJar();
    await t.call('GET', `${AUTH}/csrf`, { jar });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await t.call('POST', `${AUTH}/login`, { jar, body: { email: lockedEmail, password: 'Yanlis-Parola-1' } });
      codes.push(res.status);
    }
    // 1–4. deneme 401, 5. deneme kilit → 423
    expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(codes[4]).toBe(423);

    const afterLock = await t.call('POST', `${AUTH}/login`, { jar, body: { email: lockedEmail, password: PASSWORD } });
    expect(afterLock.status).toBe(423);
    const body = await bodyOf<ErrorBody>(afterLock);
    expect(body.code).toBe('LOCKED');
    // Kilit mesajı parola/hash sızdırmaz
    expect(JSON.stringify(body)).not.toContain(PASSWORD);

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: lockedId }, select: { lockedUntil: true } });
    expect(row.lockedUntil).not.toBeNull();
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('pasif kullanıcı ile giriş yapılamaz (isActive=false)', async () => {
    await t.prisma.user.update({ where: { id: attacker.id }, data: { isActive: false } });
    const jar = new CookieJar();
    const res = await t.login(jar, attacker.email, PASSWORD);
    expect([401, 403]).toContain(res.status);
    // Var olan çerezle de erişemez (guard DB'den aktifliği doğrular)
    const withOldSession = await t.call('GET', '/api/v1/me/address', { jar: attacker.jar });
    expect(withOldSession.status).toBe(401);
    await t.prisma.user.update({ where: { id: attacker.id }, data: { isActive: true } });
  });
});
