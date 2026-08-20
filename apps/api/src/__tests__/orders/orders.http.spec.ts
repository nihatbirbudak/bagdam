// F7/B2 — Orders HTTP (gerçek Nest + DB): /me/orders (gerçek veri, geçici kullanıcı) · /me/orders/:orderNo · /orders/:orderNo/status ·
// /orders/:orderNo/cancel (kesimden önce; iptal edilemez 409; kesim geçti 409; CSRF'siz 403) · admin liste filtreleri
// (status/kind/from/to/deliveryOn/q/page) · detay · PATCH status (zincir + 409 geçersiz + 400 nedensiz + audit) · notes · billing · invoice ·
// export.csv başlıkları (BOM + sütun sırası + filtre) · roller (CUSTOMER 403, oturumsuz 401).
import '../helpers/env';
import { computeQuote, OrderKind, OrderLineKind, type AdminOrderList, type Order, type OrderStatusResponse, type OrderSummary } from '@bagdam/shared';
import { CookieJar } from '../auth/cookie-jar';
import { ORDER_CSV_COLUMNS } from '../../modules/orders/orders.constants';
import { OrdersService } from '../../modules/orders/orders.service';
import { cleanupOrdersFixture, createOrdersFixture, createOrdersHttpApp, TEST_PASSWORD, type ErrorBody, type OrdersFixture, type OrdersHttpApp } from './orders-harness';

jest.setTimeout(240_000);

const ME = '/api/v1/me';
const ORDERS = '/api/v1/orders';
const ADMIN = '/api/v1/admin/orders';
const ZONE_RULE = { fee: 49, freeThreshold: 1000 };

interface SeedProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  vatRate: number;
}

describe('Orders HTTP — /me/orders · /orders/:orderNo · /admin/orders (F7/B2)', () => {
  let t: OrdersHttpApp;
  let fx: OrdersFixture;
  let orders: OrdersService;
  const customerJar = new CookieJar();
  const adminJar = new CookieJar();
  let adminId = '';
  let p: SeedProduct[] = [];
  let tier: { slug: string; label: string; price: number };
  /** o1 SINGLE (müşteri iptali) · o2 SINGLE PAID (ops zinciri) · o3 BOX_ONE_TIME (kind filtresi) · o4 SINGLE soonDate (kesim geçti). */
  let o1: Order;
  let o2: Order;
  let o3: Order;
  let o4: Order;

  const reservedOf = async (id: string): Promise<number> => (await t.prisma.deliveryDate.findUniqueOrThrow({ where: { id } })).reserved;

  async function createOrder(kind: 'single' | 'box', deliveryDateId: string, qty = 1): Promise<Order> {
    const lines =
      kind === 'single'
        ? [{ kind: OrderLineKind.PRODUCT, productId: p[0]!.id, unitPrice: p[0]!.price, qty, vatRate: p[0]!.vatRate }]
        : [{ kind: OrderLineKind.BOX, tierSlug: tier.slug, unitPrice: tier.price, qty: 1, vatRate: 1 }];
    const quote = computeQuote(lines, { zone: ZONE_RULE, hasActiveSubscription: false, isSubscriptionCheckout: false, firstBoxesLeft: 0, retentionPct: null, vatRateDefault: 1 });
    const { order } = await orders.createFromQuote({
      quote,
      lines: quote.lines.map((l) =>
        l.kind === OrderLineKind.BOX
          ? { kind: l.kind, tierSlug: tier.slug, name: tier.label, unit: 'kutu', qty: 1, unitPrice: l.unitPrice, lineTotal: l.lineTotal, vatRate: l.vatRate, metadata: { items: [] } }
          : { kind: l.kind, productId: p[0]!.id, name: p[0]!.name, unit: p[0]!.unit, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, vatRate: l.vatRate },
      ),
      userId: fx.userId,
      customer: { name: 'Sipariş Test', email: fx.email, phone: '+90 555 000 11 22' },
      address: fx.address,
      deliveryDateId,
    });
    return orders.getForUser(fx.userId, order.orderNo);
  }

  beforeAll(async () => {
    t = await createOrdersHttpApp();
    orders = t.orders;
    fx = await createOrdersFixture(t.prisma, 'http');
    const rows = await t.prisma.product.findMany({ where: { status: 'ACTIVE', deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }], take: 2 });
    p = rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, price: Number(r.price.toString()), vatRate: r.vatRate }));
    const tierRow = await t.prisma.boxTier.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    tier = { slug: tierRow.slug, label: tierRow.label, price: Number(tierRow.price.toString()) };

    o1 = await createOrder('single', fx.openDateId, 2);
    o2 = await createOrder('single', fx.openDateId, 1);
    o3 = await createOrder('box', fx.openDateId);
    o4 = await createOrder('single', fx.soonDateId);
    await orders.transition(o2.id, 'PAID', { actor: 'PSP' });
    // o4: kesim geçti senaryosu — tarihin kesimi geriye çekilir (yalnız bu geçici tarih)
    await t.prisma.deliveryDate.update({ where: { id: fx.soonDateId }, data: { cutoffAt: new Date(Date.now() - 60_000) } });

    expect((await t.login(customerJar, fx.email, TEST_PASSWORD)).status).toBe(200);
    adminId = await t.loginSeedAdmin(adminJar);
  });

  afterAll(async () => {
    if (t) {
      if (fx) await cleanupOrdersFixture(t.prisma, fx);
      await t.close();
    }
  });

  // ── Müşteri ──────────────────────────────────────────────────────────────────

  it('GET /me/orders: oturumsuz 401; müşteri → {items,total} yeni → eski (4 sipariş, OrderSummary alanları); GET /me/orders/:orderNo satırlar + ödemesiz; başkası 404; orderNo sayı değil 400', async () => {
    expect((await t.call('GET', `${ME}/orders`)).status).toBe(401);
    const res = await t.call('GET', `${ME}/orders`, { jar: customerJar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: OrderSummary[]; total: number };
    expect(Object.keys(body).sort()).toEqual(['items', 'total']);
    expect(body.total).toBe(4);
    expect(body.items.map((i) => i.orderNo)).toEqual([o4.orderNo, o3.orderNo, o2.orderNo, o1.orderNo]);
    const item = body.items.find((i) => i.orderNo === o2.orderNo)!;
    expect(item).toMatchObject({ id: o2.id, kind: 'SINGLE', status: 'PAID', deliveryDay: 'SALI', deliveryOn: fx.openDateIso, lineCount: 1 });
    expect(typeof item.grandTotal).toBe('number');
    expect(typeof item.paidAt).toBe('string');
    expect(Object.keys(item).sort()).toEqual(['createdAt', 'customerEmail', 'customerName', 'deliveryDay', 'deliveryOn', 'grandTotal', 'id', 'kind', 'lineCount', 'orderNo', 'paidAt', 'status'].sort());

    const detail = await t.call('GET', `${ME}/orders/${o1.orderNo}`, { jar: customerJar });
    expect(detail.status).toBe(200);
    const order = (await detail.json()) as Order;
    expect(order).toMatchObject({ id: o1.id, orderNo: o1.orderNo, status: 'PENDING_PAYMENT', kind: 'SINGLE', customerEmail: fx.email });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ kind: 'PRODUCT', productId: p[0]!.id, name: p[0]!.name, qty: 2 });
    expect(order.addressSnapshot).toEqual(fx.address);
    expect(order).not.toHaveProperty('payments');
    expect(order).not.toHaveProperty('ipAddress');

    // Admin seed kullanıcısının siparişi yok → başkasının siparişi 404
    const other = await t.call('GET', `${ME}/orders/${o1.orderNo}`, { jar: adminJar });
    expect(other.status).toBe(404);
    expect(((await other.json()) as ErrorBody).error).toBe('ORDER_NOT_FOUND');
    expect((await t.call('GET', `${ME}/orders/abc`, { jar: customerJar })).status).toBe(400);
    expect((await t.call('GET', `${ME}/orders/999999999`, { jar: customerJar })).status).toBe(404);
  });

  it('GET /orders/:orderNo/status → {orderNo,status,paymentStatus:null,paidAt,subscriptionId:null,subscriptionStatus:null} (F8 alanları)', async () => {
    const res = await t.call('GET', `${ORDERS}/${o2.orderNo}/status`, { jar: customerJar });
    expect(res.status).toBe(200);
    expect((await res.json()) as OrderStatusResponse).toEqual({ orderNo: o2.orderNo, status: 'PAID', paymentStatus: null, paidAt: expect.any(String), subscriptionId: null, subscriptionStatus: null });
    expect((await t.call('GET', `${ORDERS}/${o2.orderNo}/status`)).status).toBe(401);
  });

  it('POST /orders/:orderNo/cancel: CSRF\'siz 403 · o1 → 200 CANCELLED + reserved −1 + audit CANCEL · tekrar 409 ORDER_NOT_CANCELLABLE · o4 kesim geçti 409 ORDER_CUTOFF_PASSED · başkası 404', async () => {
    const before = await reservedOf(fx.openDateId);
    const noCsrf = await t.call('POST', `${ORDERS}/${o1.orderNo}/cancel`, { jar: customerJar, csrf: false, body: { reason: 'vazgeçtim' } });
    expect(noCsrf.status).toBe(403);

    const res = await t.call('POST', `${ORDERS}/${o1.orderNo}/cancel`, { jar: customerJar, body: { reason: 'vazgeçtim' } });
    expect(res.status).toBe(200);
    const cancelled = (await res.json()) as Order;
    expect(cancelled).toMatchObject({ id: o1.id, status: 'CANCELLED', cancelReason: 'vazgeçtim' });
    expect(typeof cancelled.cancelledAt).toBe('string');
    expect(await reservedOf(fx.openDateId)).toBe(before - 1);
    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'orders', action: 'CANCEL', actorId: fx.userId, entityId: o1.id }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    expect(audit?.summary).toContain(`#${o1.orderNo}`);

    const again = await t.call('POST', `${ORDERS}/${o1.orderNo}/cancel`, { jar: customerJar, body: {} });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).error).toBe('ORDER_NOT_CANCELLABLE');

    const late = await t.call('POST', `${ORDERS}/${o4.orderNo}/cancel`, { jar: customerJar, body: {} });
    expect(late.status).toBe(409);
    expect(((await late.json()) as ErrorBody).error).toBe('ORDER_CUTOFF_PASSED');

    const foreign = await t.call('POST', `${ORDERS}/${o2.orderNo}/cancel`, { jar: adminJar, body: {} });
    expect(foreign.status).toBe(404);
    expect(await reservedOf(fx.openDateId)).toBe(before - 1);
  });

  // ── Admin ────────────────────────────────────────────────────────────────────

  it('GET /admin/orders: CUSTOMER 403; oturumsuz 401; filtreler q (e-posta / orderNo / #orderNo), status, kind, from/to, deliveryOn, page/limit', async () => {
    expect((await t.call('GET', ADMIN, { jar: customerJar })).status).toBe(403);
    expect((await t.call('GET', ADMIN)).status).toBe(401);

    const all = await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&limit=10`, { jar: adminJar });
    expect(all.status).toBe(200);
    const body = (await all.json()) as AdminOrderList;
    expect(body).toMatchObject({ total: 4, page: 1, limit: 10 });
    expect(body.items.map((i) => i.orderNo)).toEqual([o4.orderNo, o3.orderNo, o2.orderNo, o1.orderNo]);
    expect(body.items[0]).toMatchObject({ customerEmail: fx.email, customerName: 'Sipariş Test' });

    const byNo = (await (await t.call('GET', `${ADMIN}?q=${o2.orderNo}`, { jar: adminJar })).json()) as AdminOrderList;
    expect(byNo.items.map((i) => i.id)).toEqual([o2.id]);
    const byHash = (await (await t.call('GET', `${ADMIN}?q=%23${o3.orderNo}`, { jar: adminJar })).json()) as AdminOrderList;
    expect(byHash.items.map((i) => i.id)).toEqual([o3.id]);

    const paid = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&status=PAID`, { jar: adminJar })).json()) as AdminOrderList;
    expect(paid.items.map((i) => i.id)).toEqual([o2.id]);
    const box = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&kind=BOX_ONE_TIME`, { jar: adminJar })).json()) as AdminOrderList;
    expect(box.items.map((i) => i.id)).toEqual([o3.id]);
    expect(box.items[0]!.kind).toBe(OrderKind.BOX_ONE_TIME);

    const todayTr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const inRange = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&from=${todayTr}&to=${todayTr}`, { jar: adminJar })).json()) as AdminOrderList;
    expect(inRange.total).toBe(4);
    const future = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&from=2099-01-01`, { jar: adminJar })).json()) as AdminOrderList;
    expect(future.total).toBe(0);
    const past = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&to=2000-01-01`, { jar: adminJar })).json()) as AdminOrderList;
    expect(past.total).toBe(0);
    expect((await t.call('GET', `${ADMIN}?from=2026-02-30`, { jar: adminJar })).status).toBe(400);
    expect((await t.call('GET', `${ADMIN}?from=20260101`, { jar: adminJar })).status).toBe(400);
    expect((await t.call('GET', `${ADMIN}?status=YOK`, { jar: adminJar })).status).toBe(400);

    const onDay = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&deliveryOn=${fx.soonDateIso}`, { jar: adminJar })).json()) as AdminOrderList;
    expect(onDay.items.map((i) => i.id)).toEqual([o4.id]);

    const page2 = (await (await t.call('GET', `${ADMIN}?q=${encodeURIComponent(fx.email)}&page=2&limit=3`, { jar: adminJar })).json()) as AdminOrderList;
    expect(page2).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect(page2.items.map((i) => i.id)).toEqual([o1.id]);
  });

  it('GET /admin/orders/:id → satırlar + payments [] + addressSnapshot; bilinmeyen id 404', async () => {
    const res = await t.call('GET', `${ADMIN}/${o2.id}`, { jar: adminJar });
    expect(res.status).toBe(200);
    const order = (await res.json()) as Order;
    expect(order).toMatchObject({ id: o2.id, status: 'PAID', customerEmail: fx.email });
    expect(order.lines).toHaveLength(1);
    expect(order.payments).toEqual([]);
    expect(order.addressSnapshot).toEqual(fx.address);
    expect(typeof order.paidAt).toBe('string');
    expect((await t.call('GET', `${ADMIN}/clyokyokyokyokyokyokyokyo`, { jar: adminJar })).status).toBe(404);
  });

  it('PATCH /admin/orders/:id/status: PAID→PREPARING→OUT_FOR_DELIVERY→DELIVERED (200); DELIVERED→PAID 409 ORDER_TRANSITION_INVALID; CANCELLED nedensiz 400; audit UPDATE old/new; CUSTOMER 403', async () => {
    for (const status of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      const res = await t.call('PATCH', `${ADMIN}/${o2.id}/status`, { jar: adminJar, body: { status } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as Order).status).toBe(status);
    }
    const bad = await t.call('PATCH', `${ADMIN}/${o2.id}/status`, { jar: adminJar, body: { status: 'PAID' } });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as ErrorBody).error).toBe('ORDER_TRANSITION_INVALID');

    const noReason = await t.call('PATCH', `${ADMIN}/${o3.id}/status`, { jar: adminJar, body: { status: 'CANCELLED' } });
    expect(noReason.status).toBe(400);
    expect(((await noReason.json()) as ErrorBody).error).toBe('ORDER_REASON_REQUIRED');
    expect((await t.call('PATCH', `${ADMIN}/${o3.id}/status`, { jar: adminJar, body: { status: 'YOK' } })).status).toBe(400);
    expect((await t.call('PATCH', `${ADMIN}/${o3.id}/status`, { jar: customerJar, body: { status: 'PAID' } })).status).toBe(403);

    const audit = await t.prisma.auditLog.findMany({ where: { module: 'orders', action: 'UPDATE', actorId: adminId, entityId: o2.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit[0]?.oldValues).toEqual({ status: 'PAID' });
    expect(audit[0]?.newValues).toEqual({ status: 'PREPARING', reason: null });
    expect(audit[0]?.summary).toContain(`#${o2.orderNo}`);

    const detail = (await (await t.call('GET', `${ADMIN}/${o2.id}`, { jar: adminJar })).json()) as Order;
    expect(detail.status).toBe('DELIVERED');
  });

  it('POST /admin/orders/:id/notes: zaman damgalı satır eklenir; ikinci not alta; boş 400', async () => {
    const first = await t.call('POST', `${ADMIN}/${o3.id}/notes`, { jar: adminJar, body: { adminNote: 'Telafi: 1 demet roka (0 TL) sonraki kutuya' } });
    expect(first.status).toBe(200);
    const a = (await first.json()) as Order;
    expect(a.adminNote).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] Telafi: 1 demet roka \(0 TL\) sonraki kutuya$/);
    const second = await t.call('POST', `${ADMIN}/${o3.id}/notes`, { jar: adminJar, body: { adminNote: 'Müşteri aradı' } });
    const b = (await second.json()) as Order;
    expect(b.adminNote!.split('\n')).toHaveLength(2);
    expect(b.adminNote!.split('\n')[1]).toMatch(/\] Müşteri aradı$/);
    expect((await t.call('POST', `${ADMIN}/${o3.id}/notes`, { jar: adminJar, body: { adminNote: '   ' } })).status).toBe(400);
    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'orders', action: 'CREATE', actorId: adminId, entityId: o3.id }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
  });

  it('PATCH /admin/orders/:id/billing: CORPORATE unvan/vergi no yoksa 400; dolu → 200; INDIVIDUAL geri; geçersiz vergi no 400', async () => {
    const missing = await t.call('PATCH', `${ADMIN}/${o3.id}/billing`, { jar: adminJar, body: { billingParty: 'CORPORATE', billingName: 'Bağdam Ltd.' } });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as ErrorBody).error).toBe('BILLING_CORPORATE_FIELDS_REQUIRED');
    expect((await t.call('PATCH', `${ADMIN}/${o3.id}/billing`, { jar: adminJar, body: { billingParty: 'CORPORATE', billingName: 'X', billingTaxNo: '12AB' } })).status).toBe(400);

    const ok = await t.call('PATCH', `${ADMIN}/${o3.id}/billing`, { jar: adminJar, body: { billingParty: 'CORPORATE', billingName: 'Bağdam Ltd.', billingTaxNo: '1234567890', billingTaxOffice: 'Urla' } });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as Order).toMatchObject({ billingParty: 'CORPORATE', billingName: 'Bağdam Ltd.', billingTaxNo: '1234567890', billingTaxOffice: 'Urla' });

    const back = await t.call('PATCH', `${ADMIN}/${o3.id}/billing`, { jar: adminJar, body: { billingParty: 'INDIVIDUAL', billingName: '', billingTaxNo: null, billingTaxOffice: '' } });
    expect(back.status).toBe(200);
    expect((await back.json()) as Order).toMatchObject({ billingParty: 'INDIVIDUAL', billingName: null, billingTaxNo: null, billingTaxOffice: null });
  });

  it('PATCH /admin/orders/:id/invoice: invoiceNo + pdf → 200; invoiceNo null temizler; eksik gövde 400', async () => {
    const set = await t.call('PATCH', `${ADMIN}/${o2.id}/invoice`, { jar: adminJar, body: { invoiceNo: 'BGD2026000001', invoicePdfPath: 'uploads/invoices/BGD2026000001.pdf' } });
    expect(set.status).toBe(200);
    expect((await set.json()) as Order).toMatchObject({ invoiceNo: 'BGD2026000001', invoicePdfPath: 'uploads/invoices/BGD2026000001.pdf' });
    const clear = await t.call('PATCH', `${ADMIN}/${o2.id}/invoice`, { jar: adminJar, body: { invoiceNo: null } });
    expect(clear.status).toBe(200);
    const cleared = (await clear.json()) as Order;
    expect(cleared.invoiceNo).toBeNull();
    expect(cleared.invoicePdfPath).toBe('uploads/invoices/BGD2026000001.pdf'); // yalnız gönderilen alan değişir
    expect((await t.call('PATCH', `${ADMIN}/${o2.id}/invoice`, { jar: adminJar, body: {} })).status).toBe(400);
  });

  it('GET /admin/orders/export.csv: text/csv + attachment; BOM; başlık satırı = ORDER_CSV_COLUMNS; filtre uygulanır; satırlar sipariş no içerir; CUSTOMER 403', async () => {
    const res = await t.call('GET', `${ADMIN}/export.csv?q=${encodeURIComponent(fx.email)}`, { jar: adminJar });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="siparisler-\d{4}-\d{2}-\d{2}\.csv"/);
    // fetch Response.text() UTF-8 BOM'u siler → ham baytlardan oku (EF BB BF)
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n').filter((l) => l.length > 0);
    expect(lines[0]).toBe(ORDER_CSV_COLUMNS.join(','));
    expect(lines[0]).toBe('orderNo,createdAt,status,kind,customerName,customerEmail,customerPhone,zone,deliveryDay,deliveryOn,subtotal,discountTotal,shippingFee,vatTotal,grandTotal,paidAt,invoiceNo,couponCode,lineCount');
    expect(lines).toHaveLength(5); // başlık + 4 sipariş (eski → yeni)
    const cols = lines[1]!.split(',');
    expect(cols[0]).toBe(String(o1.orderNo));
    expect(cols[2]).toBe('CANCELLED');
    expect(cols[5]).toBe(fx.email);
    expect(cols[7]).toBe(fx.zoneName);
    expect(cols[9]).toBe(fx.openDateIso);
    expect(cols[14]).toMatch(/^\d+\.\d{2}$/);
    expect(cols[18]).toBe('1');
    const o2Row = lines.find((l) => l.startsWith(`${o2.orderNo},`))!;
    expect(o2Row.split(',')[2]).toBe('DELIVERED');

    const filtered = Buffer.from(await (await t.call('GET', `${ADMIN}/export.csv?q=${encodeURIComponent(fx.email)}&status=DELIVERED`, { jar: adminJar })).arrayBuffer()).toString('utf8');
    expect(filtered.charCodeAt(0)).toBe(0xfeff);
    expect(filtered.slice(1).split('\r\n').filter((l) => l.length > 0)).toHaveLength(2);
    expect((await t.call('GET', `${ADMIN}/export.csv`, { jar: customerJar })).status).toBe(403);
  });
});
