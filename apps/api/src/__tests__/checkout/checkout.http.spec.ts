// F8 — Checkout HTTP + orkestrasyon: POST /checkout/quote (misafir/oturumlu, kupon durumu, zorunlu onaylar) · POST /checkout
// (tekil: manual → PAID + CouponRedemption + usedCount + Consent + mail.order-paid SKIPPED önizleme · abonelik: PENDING→ACTIVE,
// cycle#1 prepaid kargo hariç · tek seferlik: Order.shippingFee, DELTA'da kargo yok · DAY_FULL 409 · onay eksik 400 · tek abonelik 409 ·
// eski ödenmemiş taslak temizliği) · GET /orders/:no/status · payments:reconcile (PENDING eski → EXPIRED + DD iade) · /me/cards ·
// E: POST /admin/payments/:id/refund (kısmi → PARTIAL_REFUNDED; tam → Payment REFUNDED + Order REFUNDED + DD iade; 400/403/404/409).
import { readFile } from 'fs/promises';
import { MAIL_PREVIEW_ERROR_PREFIX } from '../../modules/mail/mail.constants';
import { CookieJar } from '../auth/cookie-jar';
import { bodyOf, createCheckoutApp, RUN, type CheckoutApp, type CheckoutFixtureUser, type JsonBody } from './checkout-harness';

jest.setTimeout(300_000);

const CHECKOUT = '/api/v1/checkout';

describe('Checkout (F8) — quote · checkout · status · reconcile · me/cards', () => {
  let app: CheckoutApp;
  let couponId = '';

  beforeAll(async () => {
    app = await createCheckoutApp();
    // Test kuponu: %10, tüm sepet, min 100 TL, toplam 5 kullanım, üye başına 1
    const coupon = await app.prisma.coupon.create({
      data: { code: `CHK${RUN.toUpperCase()}`, kind: 'PERCENT', value: 10, minSubtotal: 100, appliesTo: 'ALL', usageLimit: 5, perUserLimit: 1, isActive: true, note: 'checkout testi' },
    });
    couponId = coupon.id;
  });

  afterAll(async () => {
    try {
      if (couponId) await app?.prisma.coupon.deleteMany({ where: { id: couponId } });
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  const lineBody = (qty = 2) => [{ id: app.single[0]!.slug, qty }];

  it('POST /checkout/quote (misafir): fiyat katalogdan (istemci fiyat göndermez), bölge + kargo kuralı + requiredConsents; geçersiz kupon → couponStatus.valid=false; misafirde perUser kupon → LOGIN_REQUIRED', async () => {
    const p = app.single[0]!;
    const res = await app.call('POST', `${CHECKOUT}/quote`, { body: { lines: lineBody(2), zoneSlug: app.zoneSlug } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const q = await bodyOf<JsonBody>(res);
    expect(q.orderKind).toBe('SINGLE');
    expect(q.subtotal).toBe(Math.round(p.price * 2 * 100) / 100);
    expect((q.zone as JsonBody).slug).toBe(app.zoneSlug);
    const subtotal = q.subtotal as number;
    expect(q.shippingFee).toBe(subtotal >= 1000 ? 0 : app.zoneFee);
    expect(q.grandTotal).toBe(Math.round((subtotal + (q.shippingFee as number)) * 100) / 100);
    expect(q.couponStatus).toBeNull();
    const required = q.requiredConsents as Array<{ kind: string; documentSlug: string; version: number }>;
    expect(required.map((r) => r.kind).sort()).toEqual(['CONTRACT_ACK', 'PREINFO_ACK']); // abonelik sözleşmesi yalnız abonelikte
    // Bilinmeyen kupon
    const bad = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { body: { lines: lineBody(2), zoneSlug: app.zoneSlug, couponCode: `YOK-${RUN}` } }));
    expect((bad.couponStatus as JsonBody).valid).toBe(false);
    expect((bad.couponStatus as JsonBody).reason).toBe('NOT_FOUND');
    expect(bad.grandTotal).toBe(q.grandTotal);
    // perUserLimit'li kupon misafirde → LOGIN_REQUIRED
    const guestCoupon = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { body: { lines: lineBody(2), zoneSlug: app.zoneSlug, couponCode: `chk${RUN}` } }));
    expect((guestCoupon.couponStatus as JsonBody).reason).toBe('LOGIN_REQUIRED');
    // Boş sepet → 200, EMPTY notu
    const empty = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { body: { lines: [], zoneSlug: app.zoneSlug } }));
    expect(empty.grandTotal).toBe(0);
    expect((empty.notes as Array<{ code: string }>).some((n) => n.code === 'EMPTY')).toBe(true);
    // Geçersiz ürün → 400
    const unknown = await app.call('POST', `${CHECKOUT}/quote`, { body: { lines: [{ id: `yok-${RUN}`, qty: 1 }], zoneSlug: app.zoneSlug } });
    expect(unknown.status).toBe(400);
    expect((await bodyOf(unknown)).error).toBe('PRODUCT_NOT_AVAILABLE');
  });

  it('POST /checkout/quote (oturumlu): kupon (PERCENT, ALL, perUser) uygulanır — discountTotal, grandTotal; abonelik kutusunda ilk-kutu %50 + SUBSCRIPTION_CONTRACT_ACK zorunlu; kupon prepaidAmount\'ı değiştirmez', async () => {
    const c = await app.createCustomer('q');
    const p = app.single[0]!;
    const withCoupon = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { lines: lineBody(3), couponCode: ` chk${RUN} ` } }));
    const subtotal = Math.round(p.price * 3 * 100) / 100;
    const expectedDiscount = Math.round(subtotal * 10) / 100;
    expect((withCoupon.couponStatus as JsonBody).valid).toBe(true);
    expect((withCoupon.couponStatus as JsonBody).discount).toBe(expectedDiscount);
    expect(withCoupon.discountTotal).toBe(expectedDiscount);
    expect((withCoupon.zone as JsonBody).slug).toBe(app.zoneSlug); // adres bölgesi
    const afterDiscount = Math.round((subtotal - expectedDiscount) * 100) / 100;
    const fee = afterDiscount >= 1000 ? 0 : app.zoneFee;
    expect(withCoupon.grandTotal).toBe(Math.round((afterDiscount + fee) * 100) / 100);
    // Abonelik kutusu: BOX 600 → ilk-kutu %50 → 300; kargo 0; prepaid 300 (kuponsuz); kupon ALL → kutu satırına da iner
    const sub = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { box: { tier: app.tierSlug, freq: '1hafta', deliveryDay: 'sali' }, couponCode: `chk${RUN}` } }));
    expect(sub.orderKind).toBe('SUBSCRIPTION');
    expect(sub.shippingFee).toBe(0);
    expect(sub.prepaidAmount).toBe(app.tierPrice / 2);
    expect(sub.discountTotal).toBe(app.tierPrice / 2 + (app.tierPrice / 2) * 0.1);
    expect((sub.requiredConsents as Array<{ kind: string }>).map((r) => r.kind).sort()).toEqual(['CONTRACT_ACK', 'PREINFO_ACK', 'SUBSCRIPTION_CONTRACT_ACK']);
    // Tek seferlik kutu: indirim yok, kargo bölge kuralı (600 < 1000 → 49), prepaid 600 (kargo hariç)
    const one = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { box: { tier: app.tierSlug, isOneTime: true } } }));
    expect(one.orderKind).toBe('BOX_ONE_TIME');
    expect(one.shippingFee).toBe(app.zoneFee);
    expect(one.prepaidAmount).toBe(app.tierPrice);
    expect(one.grandTotal).toBe(app.tierPrice + app.zoneFee);
  });

  describe('POST /checkout — tekil ürün (manual sağlayıcı)', () => {
    let c: CheckoutFixtureUser;
    let orderNo = 0;
    let orderId = '';

    beforeAll(async () => {
      c = await app.createCustomer('single');
    });

    it('oturumsuz 401; onay eksik 400 CONSENT_REQUIRED (missing); eski sürüm 400 CONSENT_DOCUMENT_OUTDATED; teslimat günü yok 400; dolu gün 409 DAY_FULL; kesimi geçmiş 409 DAY_LOCKED', async () => {
      const quote = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { lines: lineBody(2) } }));
      const required = quote.requiredConsents as Array<{ kind: string; documentSlug: string; version: number }>;
      const consents = app.consentsFor(required);
      expect((await app.call('POST', CHECKOUT, { body: { lines: lineBody(2), addressId: c.addressId, deliveryOn: app.openDate.iso, consents } })).status).toBe(401);

      const missing = await app.call('POST', CHECKOUT, { jar: c.jar, body: { lines: lineBody(2), addressId: c.addressId, deliveryOn: app.openDate.iso, consents: [consents[0]] } });
      expect(missing.status).toBe(400);
      const mb = await bodyOf<JsonBody>(missing);
      expect(mb.error).toBe('CONSENT_REQUIRED');
      expect(String(mb.message)).toContain(required[1]!.kind);

      const outdated = await app.call('POST', CHECKOUT, { jar: c.jar, body: { lines: lineBody(2), addressId: c.addressId, deliveryOn: app.openDate.iso, consents: consents.map((x) => ({ ...x, version: x.version + 5 })) } });
      expect(outdated.status).toBe(400);
      expect((await bodyOf(outdated)).error).toBe('CONSENT_DOCUMENT_OUTDATED');

      const noDate = await app.call('POST', CHECKOUT, { jar: c.jar, body: { lines: lineBody(2), addressId: c.addressId, consents } });
      expect(noDate.status).toBe(400);
      expect((await bodyOf(noDate)).error).toBe('DELIVERY_DATE_REQUIRED');

      const full = await app.call('POST', CHECKOUT, { jar: c.jar, body: { lines: lineBody(2), addressId: c.addressId, deliveryDateId: app.fullDate.id, consents } });
      expect(full.status).toBe(409);
      expect((await bodyOf(full)).error).toBe('DAY_FULL');

      const locked = await app.call('POST', CHECKOUT, { jar: c.jar, body: { lines: lineBody(2), addressId: c.addressId, deliveryDateId: app.lockedDate.id, consents } });
      expect(locked.status).toBe(409);
      expect((await bodyOf(locked)).error).toBe('DAY_LOCKED');

      // Hiç sipariş yazılmadı, rezerv değişmedi
      expect(await app.prisma.order.count({ where: { userId: c.userId } })).toBe(0);
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(0);
    });

    it('başarılı checkout: 201 → Order PAID (manual anında), Payment CHECKOUT SUCCEEDED (`ord<no>` + 4), DD rezerv +1, satır snapshot, kupon → CouponRedemption + usedCount++, Consent (orderId), mail.order-paid SKIPPED + önizleme; audit', async () => {
      const quote = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { lines: lineBody(2), couponCode: `chk${RUN}` } }));
      const consents = app.consentsFor(quote.requiredConsents as never[]);
      const before = await app.prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
      const res = await app.call('POST', CHECKOUT, {
        jar: c.jar,
        body: { lines: lineBody(2), addressId: c.addressId, deliveryOn: app.openDate.iso, consents, couponCode: `chk${RUN}`, note: 'kapıya bırakın' },
      });
      expect(res.status).toBe(201);
      const body = await bodyOf<JsonBody>(res);
      expect(body.status).toBe('PAID');
      expect(body.subscriptionId).toBeNull();
      expect(body.grandTotal).toBe(quote.grandTotal);
      const payment = body.payment as JsonBody;
      expect(payment).toMatchObject({ provider: 'MANUAL', providerName: 'manual', status: 'SUCCEEDED', checkoutFormContent: null, redirectUrl: null });
      orderNo = body.orderNo as number;
      orderId = body.orderId as string;
      expect(payment.conversationId).toMatch(new RegExp(`^ord${orderNo}[a-z0-9]{4}$`));

      const order = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, payments: true, consents: true, couponRedemption: true } });
      expect(order).toMatchObject({ kind: 'SINGLE', status: 'PAID', userId: c.userId, couponCode: `CHK${RUN.toUpperCase()}`, note: 'kapıya bırakın', deliveryDateId: app.openDate.id });
      expect(order.paidAt).not.toBeNull();
      expect(Number(order.grandTotal)).toBe(quote.grandTotal);
      expect(Number(order.discountTotal)).toBe(quote.discountTotal);
      expect(order.lines).toHaveLength(1);
      expect(order.lines[0]).toMatchObject({ kind: 'PRODUCT', productId: app.single[0]!.id, name: app.single[0]!.name });
      expect(Number(order.lines[0]!.qty)).toBe(2);
      expect(order.payments).toHaveLength(1);
      expect(order.payments[0]).toMatchObject({ kind: 'CHECKOUT', provider: 'MANUAL', status: 'SUCCEEDED', is3ds: true });
      // Kupon: redemption + usedCount++
      expect(order.couponRedemption).not.toBeNull();
      expect(Number(order.couponRedemption!.amount)).toBe((quote.couponStatus as JsonBody).discount);
      const after = await app.prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
      expect(after.usedCount).toBe(before.usedCount + 1);
      // Onaylar siparişe bağlı
      expect(order.consents.map((x) => x.kind).sort()).toEqual(['CONTRACT_ACK', 'PREINFO_ACK']);
      expect(order.consents.every((x) => x.userId === c.userId && x.documentId !== null && x.source === 'HS_CHECKOUT')).toBe(true);
      // DD rezerv
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(1);
      // mail.order-paid → MailLog SKIPPED + önizleme dosyası (DISABLE_MAIL)
      // Bildirim işlem dışı/asenkron: satır QUEUED → SKIPPED olana kadar bekle (en çok ~3 s)
      let mail = null;
      for (let i = 0; i < 20 && (!mail || mail.status === 'QUEUED'); i++) {
        mail = await app.prisma.mailLog.findFirst({ where: { templateSlug: 'order-paid', entityId: orderId } });
        if (!mail || mail.status === 'QUEUED') await new Promise((r) => setTimeout(r, 150));
      }
      expect(mail).not.toBeNull();
      expect(mail!.status).toBe('SKIPPED');
      expect(mail!.to).toBe(c.email);
      expect(mail!.subject).toContain(`#${orderNo}`);
      expect(mail!.error?.startsWith(MAIL_PREVIEW_ERROR_PREFIX)).toBe(true);
      const html = await readFile(mail!.error!.slice(MAIL_PREVIEW_ERROR_PREFIX.length), 'utf8');
      expect(html).toContain(`#${orderNo}`);
      expect(html).toContain(app.single[0]!.name);
      expect(html).toContain('politikalar.html#');
      // Audit
      const audit = await app.prisma.auditLog.findFirst({ where: { module: 'checkout', actorId: c.userId, entityId: orderId } });
      expect(audit).not.toBeNull();
      // Aynı kupon ikinci kez (perUser 1) → quote geçersiz, checkout 400 COUPON_INVALID
      const again = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { lines: lineBody(2), couponCode: `chk${RUN}` } }));
      expect((again.couponStatus as JsonBody).reason).toBe('PER_USER_LIMIT');
      const res2 = await app.call('POST', CHECKOUT, { jar: c.jar, body: { lines: lineBody(2), addressId: c.addressId, deliveryOn: app.openDate.iso, consents, couponCode: `chk${RUN}` } });
      expect(res2.status).toBe(400);
      expect((await bodyOf(res2)).error).toBe('COUPON_INVALID');
    });

    it('GET /orders/:orderNo/status → {status PAID, paymentStatus SUCCEEDED, paidAt, subscriptionStatus null}; başkası 404; GET /me/orders listeler; müşteri iptali → CANCELLED + kupon kullanımı serbest (usedCount--) + DD iade', async () => {
      const st = await app.call('GET', `/api/v1/orders/${orderNo}/status`, { jar: c.jar });
      expect(st.status).toBe(200);
      const sb = await bodyOf<JsonBody>(st);
      expect(sb).toMatchObject({ orderNo, status: 'PAID', paymentStatus: 'SUCCEEDED', subscriptionId: null, subscriptionStatus: null });
      expect(typeof sb.paidAt).toBe('string');
      const other = await app.createCustomer('other');
      expect((await app.call('GET', `/api/v1/orders/${orderNo}/status`, { jar: other.jar })).status).toBe(404);
      const mine = await bodyOf<JsonBody>(await app.call('GET', '/api/v1/me/orders', { jar: c.jar }));
      expect((mine.items as JsonBody[]).map((o) => o.orderNo)).toContain(orderNo);

      const before = await app.prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
      const cancel = await app.call('POST', `/api/v1/orders/${orderNo}/cancel`, { jar: c.jar, body: { reason: 'vazgeçtim' } });
      expect(cancel.status).toBe(200);
      expect((await bodyOf<JsonBody>(cancel)).status).toBe('CANCELLED');
      expect(await app.prisma.couponRedemption.count({ where: { orderId } })).toBe(0);
      expect((await app.prisma.coupon.findUniqueOrThrow({ where: { id: couponId } })).usedCount).toBe(before.usedCount - 1);
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(0);
    });
  });

  describe('POST /checkout — abonelik / tek seferlik kutu', () => {
    let c: CheckoutFixtureUser;

    beforeAll(async () => {
      c = await app.createCustomer('sub');
    });

    it('abonelik: Subscription PENDING→ACTIVE, cycle#1 SCHEDULED prepaidAmount = kutu − %50 + ekstra (KARGO HARİÇ), Order SUBSCRIPTION shippingFee 0, contractDocId; tek aktif abonelik → ikinci 409 SUBSCRIPTION_EXISTS (rezerv değişmez); status subscriptionStatus ACTIVE', async () => {
      const extra = app.fresh[3] ?? app.fresh[0]!;
      const factor = extra.unit === 'kg' ? 0.25 : 1;
      const box = { tier: app.tierSlug, freq: '1hafta', deliveryDay: 'sali', items: app.fresh.slice(0, 3).map((p) => p.slug), extras: [{ id: extra.slug, factor }] };
      const quote = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: c.jar, body: { box } }));
      expect(quote.orderKind).toBe('SUBSCRIPTION');
      const extraTotal = Math.round(extra.price * factor);
      expect(quote.prepaidAmount).toBe(app.tierPrice / 2 + extraTotal);
      const consents = app.consentsFor(quote.requiredConsents as never[]);
      expect(consents.some((x) => x.kind === 'SUBSCRIPTION_CONTRACT_ACK')).toBe(true);
      const reservedBefore = (await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved;

      // Abonelik sözleşmesi onayı eksik → 400
      const noContract = await app.call('POST', CHECKOUT, { jar: c.jar, body: { box, addressId: c.addressId, deliveryDateId: app.openDate.id, consents: consents.filter((x) => x.kind !== 'SUBSCRIPTION_CONTRACT_ACK') } });
      expect(noContract.status).toBe(400);
      expect(String((await bodyOf<JsonBody>(noContract)).message)).toContain('SUBSCRIPTION_CONTRACT_ACK');
      // Gün uyuşmazlığı (kutu persembe, tarih salı) → 400
      const mismatch = await app.call('POST', CHECKOUT, { jar: c.jar, body: { box: { ...box, deliveryDay: 'persembe' }, addressId: c.addressId, deliveryDateId: app.openDate.id, consents } });
      expect(mismatch.status).toBe(400);
      expect((await bodyOf(mismatch)).error).toBe('DELIVERY_DAY_MISMATCH');

      const res = await app.call('POST', CHECKOUT, { jar: c.jar, body: { box, addressId: c.addressId, deliveryDateId: app.openDate.id, consents } });
      expect(res.status).toBe(201);
      const body = await bodyOf<JsonBody>(res);
      expect(body.status).toBe('PAID');
      expect(typeof body.subscriptionId).toBe('string');
      const sub = await app.prisma.subscription.findUniqueOrThrow({ where: { id: body.subscriptionId as string }, include: { cycles: { orderBy: { cycleNo: 'asc' }, include: { items: true } } } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.isOneTime).toBe(false);
      expect(sub.discountBoxesLeft).toBe(1);
      expect(sub.contractDocId).not.toBeNull();
      expect(sub.startedAt).not.toBeNull();
      const c1 = sub.cycles.find((x) => x.cycleNo === 1)!;
      expect(c1.status).toBe('SCHEDULED');
      expect(c1.orderId).toBe(body.orderId);
      expect(Number(c1.prepaidAmount)).toBe(app.tierPrice / 2 + extraTotal);
      expect(c1.items.filter((i) => i.source === 'TEMPLATE' || i.source === 'SWAP')).toHaveLength(3);
      expect(c1.items.filter((i) => i.source === 'EXTRA')).toHaveLength(1);
      const order = await app.prisma.order.findUniqueOrThrow({ where: { id: body.orderId as string }, include: { lines: true, payments: true } });
      expect(order).toMatchObject({ kind: 'SUBSCRIPTION', status: 'PAID', subscriptionId: sub.id });
      expect(Number(order.shippingFee)).toBe(0);
      expect(Number(order.discountTotal)).toBe(app.tierPrice / 2);
      expect(Number(order.grandTotal)).toBe(app.tierPrice / 2 + extraTotal);
      expect(order.lines.map((l) => l.kind).sort()).toEqual(['BOX', 'EXTRA']);
      expect(order.payments[0]).toMatchObject({ kind: 'CHECKOUT', status: 'SUCCEEDED' });
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore + 1);
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).firstBoxesPromoUsedAt).not.toBeNull();
      // Kesim simülasyonu: cycle#1 quote → due ≤ 0 (peşin ödendi; kargo yeniden hesaplanmaz)
      const charge = await app.pricing.cycleCharge({ cycleId: c1.id });
      expect(charge.shippingFee).toBe(0);
      expect(charge.due).toBeLessThanOrEqual(0);
      // Durum ucu
      const st = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/orders/${body.orderNo}/status`, { jar: c.jar }));
      expect(st).toMatchObject({ status: 'PAID', paymentStatus: 'SUCCEEDED', subscriptionId: sub.id, subscriptionStatus: 'ACTIVE' });
      // /me/subscription canlı
      const me = await bodyOf<JsonBody>(await app.call('GET', '/api/v1/me/subscription', { jar: c.jar }));
      expect(me.status).toBe('ACTIVE');
      // İkinci abonelik → 409 SUBSCRIPTION_EXISTS, rezerv değişmez, yeni sipariş yok
      const again = await app.call('POST', CHECKOUT, { jar: c.jar, body: { box, addressId: c.addressId, deliveryDateId: app.openDate.id, consents } });
      expect(again.status).toBe(409);
      expect((await bodyOf(again)).error).toBe('SUBSCRIPTION_EXISTS');
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore + 1);
      expect(await app.prisma.order.count({ where: { userId: c.userId } })).toBe(1);
    });

    it('tek seferlik kutu (ayrı müşteri): Order BOX_ONE_TIME shippingFee 49 (kargo Order\'da), cycle#1 prepaid 600 (kargo hariç), cycleCharge due ≤ 0 (DELTA\'da kargo yok); abonelik sözleşmesi zorunlu değil', async () => {
      const o = await app.createCustomer('one');
      const box = { tier: app.tierSlug, isOneTime: true, deliveryDay: 'sali' };
      const quote = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: o.jar, body: { box } }));
      expect((quote.requiredConsents as Array<{ kind: string }>).some((x) => x.kind === 'SUBSCRIPTION_CONTRACT_ACK')).toBe(false);
      const res = await app.call('POST', CHECKOUT, { jar: o.jar, body: { box, addressId: o.addressId, deliveryOn: app.openDate.iso, consents: app.consentsFor(quote.requiredConsents as never[]) } });
      expect(res.status).toBe(201);
      const body = await bodyOf<JsonBody>(res);
      const order = await app.prisma.order.findUniqueOrThrow({ where: { id: body.orderId as string } });
      expect(order.kind).toBe('BOX_ONE_TIME');
      expect(Number(order.shippingFee)).toBe(app.zoneFee);
      expect(Number(order.grandTotal)).toBe(app.tierPrice + app.zoneFee);
      const sub = await app.prisma.subscription.findUniqueOrThrow({ where: { id: body.subscriptionId as string }, include: { cycles: true } });
      expect(sub.isOneTime).toBe(true);
      expect(sub.status).toBe('ACTIVE');
      expect(Number(sub.cycles[0]!.prepaidAmount)).toBe(app.tierPrice);
      const charge = await app.pricing.cycleCharge({ cycleId: sub.cycles[0]!.id });
      expect(charge.shippingFee).toBe(0);
      expect(charge.due).toBeLessThanOrEqual(0);
    });

    it('eski ödenmemiş abonelik taslağı (PENDING + açık ödeme > 10 dk) yeni checkout\'ta iptal edilir (cycle CANCELLED + DD iade + Order CANCELLED + Payment EXPIRED); < 10 dk ise 409 CHECKOUT_IN_PROGRESS', async () => {
      const u = await app.createCustomer('stale');
      const box = { tier: app.tierSlug, freq: '1hafta', deliveryDay: 'sali' };
      const quote = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: u.jar, body: { box } }));
      const consents = app.consentsFor(quote.requiredConsents as never[]);
      // Eski taslak: servislerle doğrudan (sağlayıcı sonucu gelmemiş gibi) — Subscription PENDING + Order PENDING_PAYMENT + Payment PENDING
      const reservedBefore = (await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved;
      const now = new Date();
      const stale = await app.prisma.$transaction(async (tx) => {
        const { subscription, cycle } = await app.subscriptions.createFromCheckout(
          { id: u.userId },
          { tierSlug: app.tierSlug, frequencyWeeks: 1, deliveryDay: 'SALI', zoneId: app.zoneId, addressId: u.addressId, isOneTime: false, itemPrefs: {}, deliveryDateId: app.openDate.id, orderId: null, prepaidAmount: 300, now },
          tx,
        );
        const q = await app.pricing.quote({ lines: [{ kind: 'BOX', unitPrice: app.tierPrice, qty: 1, tierSlug: app.tierSlug }], zoneId: app.zoneId, userId: u.userId, isSubscriptionCheckout: true });
        const { order } = await app.orders.createFromQuote(
          {
            quote: q,
            lines: [{ kind: 'BOX', tierSlug: app.tierSlug, name: 'Kutu', qty: 1, unitPrice: app.tierPrice, lineTotal: app.tierPrice, vatRate: 1 }],
            userId: u.userId,
            subscriptionId: subscription.id,
            customer: { name: 'Stale', email: u.email, phone: '+905551112233' },
            address: { fullName: 'Stale', phone: '+905551112233', line: 'x', zoneId: app.zoneId, zoneName: 'z', zip: null },
            deliveryDateId: app.openDate.id,
            now,
          },
          tx,
        );
        await tx.subscriptionCycle.update({ where: { id: cycle.id }, data: { orderId: order.id } });
        const payment = await app.payments.recordPayment({ orderId: order.id, provider: 'MANUAL', kind: 'CHECKOUT', conversationId: `ord${order.orderNo}stal`, amount: 300, is3ds: true, isMerchantInitiated: false }, tx);
        return { subscriptionId: subscription.id, cycleId: cycle.id, orderId: order.id, paymentId: payment.id };
      });
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore + 1);
      // < 10 dk: devam eden ödeme → 409
      const inProgress = await app.call('POST', CHECKOUT, { jar: u.jar, body: { box, addressId: u.addressId, deliveryDateId: app.openDate.id, consents } });
      expect(inProgress.status).toBe(409);
      expect((await bodyOf(inProgress)).error).toBe('CHECKOUT_IN_PROGRESS');
      // Ödemeyi eskit (20 dk) → yeni checkout eski taslağı iptal eder ve başarır
      await app.prisma.payment.update({ where: { id: stale.paymentId }, data: { createdAt: new Date(now.getTime() - 20 * 60_000) } });
      const res = await app.call('POST', CHECKOUT, { jar: u.jar, body: { box, addressId: u.addressId, deliveryDateId: app.openDate.id, consents } });
      expect(res.status).toBe(201);
      const body = await bodyOf<JsonBody>(res);
      expect(body.status).toBe('PAID');
      expect((await app.prisma.subscription.findUniqueOrThrow({ where: { id: stale.subscriptionId } })).status).toBe('CANCELLED');
      expect((await app.prisma.subscriptionCycle.findUniqueOrThrow({ where: { id: stale.cycleId } })).status).toBe('CANCELLED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: stale.orderId } })).status).toBe('CANCELLED');
      expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: stale.paymentId } })).status).toBe('EXPIRED');
      // Rezerv: eski iade (−1) + yeni (+1) = önceki + 1
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore + 1);
      expect((await app.prisma.subscription.findUniqueOrThrow({ where: { id: body.subscriptionId as string } })).status).toBe('ACTIVE');
    });
  });

  describe('payments:reconcile · /me/cards', () => {
    it('reconcile: PENDING checkout ödemesi > 24 s → EXPIRED + Order CANCELLED + DD iade; 1 s eski → stillPending; ödemesiz eski sipariş → iptal', async () => {
      const u = await app.createCustomer('rec');
      const now = new Date();
      const mk = async (ageHours: number, withPayment: boolean) => {
        const q = await app.pricing.quote({ lines: [{ kind: 'PRODUCT', unitPrice: 100, qty: 1 }], zoneId: app.zoneId, userId: u.userId, isSubscriptionCheckout: false });
        const { order } = await app.orders.createFromQuote({
          quote: q,
          lines: [{ kind: 'PRODUCT', name: 'X', qty: 1, unitPrice: 100, lineTotal: 100, vatRate: 1 }],
          userId: u.userId,
          customer: { name: 'Rec', email: u.email, phone: '+905551112233' },
          address: { fullName: 'Rec', phone: '+905551112233', line: 'x', zoneId: app.zoneId, zoneName: 'z', zip: null },
          deliveryDateId: app.openDate.id,
          now,
        });
        const created = new Date(now.getTime() - ageHours * 3_600_000);
        await app.prisma.order.update({ where: { id: order.id }, data: { createdAt: created } });
        let paymentId: string | null = null;
        if (withPayment) {
          const p = await app.payments.recordPayment({ orderId: order.id, provider: 'MANUAL', kind: 'CHECKOUT', conversationId: `ord${order.orderNo}rc${ageHours}`, amount: 149, is3ds: true, isMerchantInitiated: false });
          await app.prisma.payment.update({ where: { id: p.id }, data: { createdAt: created } });
          paymentId = p.id;
        }
        return { orderId: order.id, paymentId };
      };
      const reservedBefore = (await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved;
      const old = await mk(25, true);
      const fresh = await mk(1, true);
      const noPay = await mk(26, false);
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore + 3);

      const result = await app.completion.reconcile(now);
      expect(result.errors).toBe(0);
      expect(result.expired).toBeGreaterThanOrEqual(1);
      expect(result.stillPending).toBeGreaterThanOrEqual(1);
      expect(result.staleOrdersCancelled).toBeGreaterThanOrEqual(1);
      expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: old.paymentId! } })).status).toBe('EXPIRED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: old.orderId } })).status).toBe('CANCELLED');
      expect((await app.prisma.payment.findUniqueOrThrow({ where: { id: fresh.paymentId! } })).status).toBe('PENDING');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: fresh.orderId } })).status).toBe('PENDING_PAYMENT');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: noPay.orderId } })).status).toBe('CANCELLED');
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore + 1);
      // İdempotent: ikinci koşu aynı siparişlere dokunmaz
      const second = await app.completion.reconcile(now);
      expect(second.expired).toBe(0);
      expect(second.staleOrdersCancelled).toBe(0);
    });

    it('GET /me/cards [] → saklı kart (PaymentMethod) listelenir; DELETE pasifleştirir (isActive=false); başkasının kartı 404; POST add-session 501', async () => {
      const u = await app.createCustomer('cards');
      expect(await bodyOf(await app.call('GET', '/api/v1/me/cards', { jar: u.jar }))).toEqual([]);
      const pm = await app.prisma.paymentMethod.create({ data: { userId: u.userId, provider: 'MANUAL', providerCustomerKey: `cus_${RUN}`, providerCardToken: `tok_${RUN}`, last4: '4242', brand: 'VISA', isDefault: true, isActive: true } });
      const list = await bodyOf<JsonBody[]>(await app.call('GET', '/api/v1/me/cards', { jar: u.jar }));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: pm.id, provider: 'MANUAL', last4: '4242', brand: 'VISA', isDefault: true, isActive: true });
      expect(Object.keys(list[0]!)).not.toContain('providerCardToken');
      const other = await app.createCustomer('cards2');
      expect((await app.call('DELETE', `/api/v1/me/cards/${pm.id}`, { jar: other.jar })).status).toBe(404);
      const del = await app.call('DELETE', `/api/v1/me/cards/${pm.id}`, { jar: u.jar });
      expect(del.status).toBe(200);
      expect((await bodyOf<JsonBody>(del)).isActive).toBe(false);
      expect(await bodyOf(await app.call('GET', '/api/v1/me/cards', { jar: u.jar }))).toEqual([]);
      const add = await app.call('POST', '/api/v1/me/cards/add-session', { jar: u.jar, body: {} });
      expect(add.status).toBe(501);
      expect((await bodyOf(add)).error).toBe('NOT_IMPLEMENTED');
    });

    it('POST /admin/payments/:id/refund (ADMIN): kısmi iade → Refund SUCCEEDED + Payment PARTIAL_REFUNDED (Order PAID kalır, detayda refunds) · kalan tam iade → Payment REFUNDED + Order REFUNDED + DD iade · müşteri 403 · bilinmeyen 404 · aşan tutar 400 · tekrar 409', async () => {
      const u = await app.createCustomer('refund');
      const quote = await bodyOf<JsonBody>(await app.call('POST', `${CHECKOUT}/quote`, { jar: u.jar, body: { lines: lineBody(1) } }));
      const consents = app.consentsFor(quote.requiredConsents as never[]);
      const res = await app.call('POST', CHECKOUT, { jar: u.jar, body: { lines: lineBody(1), addressId: u.addressId, deliveryOn: app.openDate.iso, consents } });
      expect(res.status).toBe(201);
      const created = await bodyOf<JsonBody>(res);
      expect(created.status).toBe('PAID');
      const orderId = created.orderId as string;
      const paymentId = (created.payment as JsonBody).paymentId as string;
      const total = created.grandTotal as number;
      const reservedBefore = (await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved;
      const path = `/api/v1/admin/payments/${paymentId}/refund`;
      // Müşteri rolü → 403
      expect((await app.call('POST', path, { jar: u.jar, body: { amount: 1 } })).status).toBe(403);
      const adminJar = new CookieJar();
      const adminId = await app.loginSeedAdmin(adminJar);
      // Bilinmeyen ödeme 404 · aşan tutar 400 · geçersiz tutar 400
      expect((await app.call('POST', `/api/v1/admin/payments/clzz${RUN}yok/refund`, { jar: adminJar, body: { amount: 1 } })).status).toBe(404);
      const exceeds = await app.call('POST', path, { jar: adminJar, body: { amount: total + 1 } });
      expect(exceeds.status).toBe(400);
      expect((await bodyOf(exceeds)).error).toBe('REFUND_AMOUNT_EXCEEDS');
      expect((await app.call('POST', path, { jar: adminJar, body: { amount: 0 } })).status).toBe(400);
      // Kısmi iade → PARTIAL_REFUNDED, sipariş PAID kalır
      const partAmount = Math.round((total / 2) * 100) / 100;
      const part = await app.call('POST', path, { jar: adminJar, body: { amount: partAmount, reason: 'ayıplı ürün' } });
      expect(part.status).toBe(200);
      const partBody = await bodyOf<JsonBody>(part);
      expect(partBody).toMatchObject({ ok: true, refundedTotal: partAmount, orderId, orderStatus: 'PAID', orderTransitioned: false });
      expect(partBody.refund as JsonBody).toMatchObject({ paymentId, status: 'SUCCEEDED', amount: partAmount, reason: 'ayıplı ürün', requestedBy: adminId });
      expect((partBody.payment as JsonBody).status).toBe('PARTIAL_REFUNDED');
      expect((await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('PAID');
      // Admin sipariş detayı: ödeme altında iadeler (ekran 17 Ödemeler kartı)
      const detail = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/admin/orders/${orderId}`, { jar: adminJar }));
      const payments = detail.payments as JsonBody[];
      expect(payments).toHaveLength(1);
      expect((payments[0]!.refunds as JsonBody[]).map((r) => [r.status, r.amount])).toEqual([['SUCCEEDED', partAmount]]);
      // Kalan tam iade → Payment REFUNDED + Order REFUNDED (neden varsayılan) + DD rezerv iade
      const rest = Math.round((total - partAmount) * 100) / 100;
      const full = await bodyOf<JsonBody>(await app.call('POST', path, { jar: adminJar, body: { amount: rest } }));
      expect(full).toMatchObject({ ok: true, refundedTotal: total, orderStatus: 'REFUNDED', orderTransitioned: true });
      expect((full.payment as JsonBody).status).toBe('REFUNDED');
      const order = await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('REFUNDED');
      expect(order.cancelReason).toBe('Tam iade (admin)');
      expect(order.cancelledAt).not.toBeNull();
      expect((await app.prisma.deliveryDate.findUniqueOrThrow({ where: { id: app.openDate.id } })).reserved).toBe(reservedBefore - 1);
      expect(await app.prisma.refund.count({ where: { paymentId, status: 'SUCCEEDED' } })).toBe(2);
      // Tam iade sonrası tekrar → 409 PAYMENT_NOT_REFUNDABLE; müşteri durum ucu REFUNDED
      const again = await app.call('POST', path, { jar: adminJar, body: { amount: 1 } });
      expect(again.status).toBe(409);
      expect((await bodyOf(again)).error).toBe('PAYMENT_NOT_REFUNDABLE');
      const status = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/orders/${created.orderNo as number}/status`, { jar: u.jar }));
      expect(status).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });
      // Audit (payments modülü) → bu testin satırları temizlenir (append-only tabloya test kalıntısı kalmasın)
      const audit = await app.prisma.auditLog.findMany({ where: { module: 'payments', entityId: paymentId } });
      expect(audit.length).toBeGreaterThanOrEqual(2);
      await app.prisma.auditLog.deleteMany({ where: { module: 'payments', entityId: paymentId } });
    });
  });
});
