// F8 — Kuponlar: saf hesap (computeCouponDiscount / applyCouponToQuote) · CouponsService.validate kuralları (PERCENT/AMOUNT · kapsam
// ALL/SINGLE/BOX · minSubtotal · tarih penceresi · usageLimit · perUserLimit · pasif/silinmiş) · kullanım kaydı (reserve/confirm/release)
// · PricingService.quote kupon uygulaması (kargo eşiği yeniden, prepaid kuponsuz) · admin /admin/coupons CRUD (ADMIN; müşteri 403).
import { computeQuote, type PricingContext } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { applyCouponToQuote, couponEligibleAmounts } from '../../modules/pricing/pricing.coupon';
import { computeCouponDiscount, normalizeCode } from '../../modules/coupons/coupons.service';
import { CookieJar } from '../auth/cookie-jar';
import { bodyOf, createCheckoutApp, RUN, type CheckoutApp, type JsonBody } from '../checkout/checkout-harness';

jest.setTimeout(300_000);

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

describe('Kuponlar — saf hesap', () => {
  const ctx: PricingContext = { zone: { fee: 49, freeThreshold: 1000 }, hasActiveSubscription: false, isSubscriptionCheckout: true, firstBoxesLeft: 2, retentionPct: null, vatRateDefault: 1, rules: { freeShippingRule: 'gte', discountRounding: 'kurus', subscriberFreeShipping: true } };

  it('computeCouponDiscount: PERCENT yuvarlama (kurus/tl), AMOUNT kapsamla sınırlı, esas ≤ 0 → 0', () => {
    expect(computeCouponDiscount({ kind: 'PERCENT', value: dec(10) }, 649, 'kurus')).toBe(64.9);
    expect(computeCouponDiscount({ kind: 'PERCENT', value: dec(50) }, 649, 'kurus')).toBe(324.5);
    expect(computeCouponDiscount({ kind: 'PERCENT', value: dec(50) }, 649, 'tl')).toBe(325);
    expect(computeCouponDiscount({ kind: 'AMOUNT', value: dec(100) }, 80, 'kurus')).toBe(80);
    expect(computeCouponDiscount({ kind: 'AMOUNT', value: dec(100) }, 250.5, 'kurus')).toBe(100);
    expect(computeCouponDiscount({ kind: 'AMOUNT', value: dec(100) }, 0, 'kurus')).toBe(0);
    expect(normalizeCode('  yaz10 ')).toBe('YAZ10');
  });

  it('applyCouponToQuote: kapsam ALL/SINGLE/BOX — orantılı dağıtım, kargo eşiği yeniden, KDV satır bazlı, prepaid kuponsuz kalır', () => {
    const base = computeQuote(
      [
        { kind: 'BOX', unitPrice: 600, qty: 1, tierSlug: 't' },
        { kind: 'EXTRA', unitPrice: 100, qty: 1 },
        { kind: 'PRODUCT', unitPrice: 500, qty: 1 },
      ],
      ctx,
    );
    // abonelik: BOX 600 −%50 = 300 · EXTRA 100 · PRODUCT 500 → subtotal 1200, discount 300, kargo 0 (abonelik), grand 900, prepaid 400
    expect(base).toMatchObject({ orderKind: 'SUBSCRIPTION', subtotal: 1200, discountTotal: 300, shippingFee: 0, grandTotal: 900, prepaidAmount: 400 });
    expect(couponEligibleAmounts(base.lines)).toEqual({ all: 900, single: 500, box: 400 });

    const all = applyCouponToQuote(base, 'ALL', 90, ctx);
    expect(all.applied).toBe(90);
    expect(all.quote.discountTotal).toBe(390);
    expect(all.quote.grandTotal).toBe(810);
    expect(all.quote.prepaidAmount).toBe(400);
    const byKind = Object.fromEntries(all.quote.lines.map((l) => [l.kind, l.discount]));
    expect(byKind.BOX + byKind.EXTRA + byKind.PRODUCT).toBe(390);
    expect(byKind.PRODUCT).toBe(50); // 500/900 × 90
    expect(byKind.BOX).toBe(300 + 30); // 300/900 × 90 + ilk-kutu 300
    expect(byKind.EXTRA).toBe(10);

    const single = applyCouponToQuote(base, 'SINGLE', 1000, ctx); // kapsamı aşar → 500 ile sınırlı
    expect(single.applied).toBe(500);
    expect(single.quote.lines.find((l) => l.kind === 'PRODUCT')!.discount).toBe(500);
    expect(single.quote.grandTotal).toBe(400);

    const box = applyCouponToQuote(base, 'BOX', 40, ctx);
    expect(box.applied).toBe(40);
    expect(box.quote.lines.find((l) => l.kind === 'PRODUCT')!.discount).toBe(0);

    // Tek seferlik kutu + ürün: kupon eşiği aşağı çeker → kargo 0'dan 49'a
    const oneCtx: PricingContext = { ...ctx, isSubscriptionCheckout: false, firstBoxesLeft: 0 };
    const oneBase = computeQuote([{ kind: 'BOX', unitPrice: 600, qty: 1, tierSlug: 't' }, { kind: 'PRODUCT', unitPrice: 450, qty: 1 }], oneCtx);
    expect(oneBase).toMatchObject({ orderKind: 'BOX_ONE_TIME', subtotal: 1050, shippingFee: 0 });
    const oneAll = applyCouponToQuote(oneBase, 'ALL', 100, oneCtx);
    expect(oneAll.quote.shippingFee).toBe(49);
    expect(oneAll.quote.grandTotal).toBe(1050 - 100 + 49);
    expect(oneAll.quote.notes.some((n) => n.code === 'SHIPPING_FEE')).toBe(true);
    expect(oneAll.quote.vatTotal).toBeGreaterThan(0);
  });
});

describe('Kuponlar — CouponsService.validate / kullanım kaydı / PricingService / admin CRUD', () => {
  let app: CheckoutApp;
  const createdIds: string[] = [];
  const code = (s: string) => `T${RUN.toUpperCase()}${s}`;
  const now = new Date();
  const eligible = { all: 500, single: 200, box: 300 };

  const mk = async (data: Partial<Prisma.CouponUncheckedCreateInput> & { code: string }) => {
    const row = await app.prisma.coupon.create({ data: { kind: 'PERCENT', isActive: true, ...data, value: data.value ?? dec(10) } });
    createdIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    app = await createCheckoutApp();
  });

  afterAll(async () => {
    try {
      await app?.prisma.couponRedemption.deleteMany({ where: { couponId: { in: createdIds } } });
      await app?.prisma.coupon.deleteMany({ where: { OR: [{ id: { in: createdIds } }, { code: { startsWith: `T${RUN.toUpperCase()}` } }] } });
      await app?.prisma.auditLog.deleteMany({ where: { module: 'coupons', createdAt: { gte: now } } });
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('validate: NOT_FOUND · INACTIVE · NOT_STARTED · EXPIRED · USAGE_LIMIT · MIN_SUBTOTAL · SCOPE_MISMATCH · büyük/küçük harf duyarsız · geçerli PERCENT/AMOUNT', async () => {
    const v = (c: string, extra: Partial<Parameters<typeof app.coupons.validate>[0]> = {}) => app.coupons.validate({ code: c, userId: null, subtotal: 500, eligible, rounding: 'kurus', now, ...extra });
    expect((await v(code('YOK'))).ok).toBe(false);
    expect((await v(code('YOK')) as { reason: string }).reason).toBe('NOT_FOUND');
    await mk({ code: code('OFF'), isActive: false });
    expect((await v(code('OFF')) as { reason: string }).reason).toBe('INACTIVE');
    await mk({ code: code('LATER'), startsAt: new Date(now.getTime() + 3_600_000) });
    expect((await v(code('LATER')) as { reason: string }).reason).toBe('NOT_STARTED');
    await mk({ code: code('OLD'), endsAt: new Date(now.getTime() - 1) });
    expect((await v(code('OLD')) as { reason: string }).reason).toBe('EXPIRED');
    await mk({ code: code('FULL'), usageLimit: 2, usedCount: 2 });
    expect((await v(code('FULL')) as { reason: string }).reason).toBe('USAGE_LIMIT');
    await mk({ code: code('MIN'), minSubtotal: dec(600) });
    expect((await v(code('MIN')) as { reason: string }).reason).toBe('MIN_SUBTOTAL');
    await mk({ code: code('BOXONLY'), appliesTo: 'BOX' });
    expect((await v(code('BOXONLY'), { eligible: { all: 200, single: 200, box: 0 } }) as { reason: string }).reason).toBe('SCOPE_MISMATCH');
    const okBox = await v(code('BOXONLY'));
    expect(okBox.ok).toBe(true);
    if (okBox.ok) expect(okBox).toMatchObject({ scope: 'BOX', amount: 30 });
    await mk({ code: code('AMT'), kind: 'AMOUNT', value: dec(75), appliesTo: 'SINGLE' });
    const okAmt = await v(code('amt').toLowerCase()); // citext
    expect(okAmt.ok).toBe(true);
    if (okAmt.ok) expect(okAmt).toMatchObject({ scope: 'SINGLE', amount: 75 });
    const capped = await v(code('AMT'), { eligible: { all: 500, single: 20, box: 480 } });
    if (capped.ok) expect(capped.amount).toBe(20);
    // Silinmiş kupon bulunmaz
    const del = await mk({ code: code('DEL'), deletedAt: now });
    expect((await v(del.code) as { reason: string }).reason).toBe('NOT_FOUND');
  });

  it('perUserLimit: misafir LOGIN_REQUIRED; reserve → sayılır → PER_USER_LIMIT; confirm usedCount++; release (ödenmiş) usedCount--', async () => {
    const u = await app.createCustomer('cpn');
    const coupon = await mk({ code: code('PU'), perUserLimit: 1 });
    const base = { code: coupon.code, subtotal: 500, eligible, now };
    expect(((await app.coupons.validate({ ...base, userId: null })) as { reason: string }).reason).toBe('LOGIN_REQUIRED');
    expect((await app.coupons.validate({ ...base, userId: u.userId })).ok).toBe(true);
    // Kullanım kaydı için sipariş (DD rezerv gerekmez: doğrudan Prisma)
    const order = await app.prisma.order.create({
      data: {
        kind: 'SINGLE',
        status: 'PENDING_PAYMENT',
        userId: u.userId,
        customerName: 'K',
        customerEmail: u.email,
        customerPhone: '+905551112233',
        zoneId: app.zoneId,
        deliveryDay: 'SALI',
        deliveryOn: new Date('2030-01-01T00:00:00.000Z'),
        addressSnapshot: {},
        subtotal: 500,
        discountTotal: 50,
        grandTotal: 499,
        couponCode: coupon.code,
      },
    });
    await app.coupons.reserveRedemption({ couponId: coupon.id, orderId: order.id, userId: u.userId, amount: 50 });
    expect(((await app.coupons.validate({ ...base, userId: u.userId })) as { reason: string }).reason).toBe('PER_USER_LIMIT');
    expect(await app.coupons.confirmRedemption(order.id)).toBe(true);
    expect((await app.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect(await app.coupons.confirmRedemption(`yok-${RUN}`)).toBe(false);
    expect(await app.coupons.releaseRedemption(order.id, { wasPaid: true })).toBe(true);
    expect((await app.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    expect(await app.prisma.couponRedemption.count({ where: { orderId: order.id } })).toBe(0);
    expect((await app.coupons.validate({ ...base, userId: u.userId })).ok).toBe(true);
    await app.prisma.order.delete({ where: { id: order.id } });
  });

  it('PricingService.quote: couponCode uygulanır (discountTotal/grandTotal), quoteWithCoupon kupon durumu döner, geçersiz kod fiyatı değiştirmez', async () => {
    await mk({ code: code('PR'), kind: 'AMOUNT', value: dec(30) });
    const lines = [{ kind: 'PRODUCT' as const, unitPrice: 200, qty: 1 }];
    const plain = await app.pricing.quote({ lines, zoneId: app.zoneId, isSubscriptionCheckout: false });
    const withCoupon = await app.pricing.quoteWithCoupon({ lines, zoneId: app.zoneId, isSubscriptionCheckout: false, couponCode: code('PR') });
    expect(withCoupon.coupon).toMatchObject({ valid: true, discount: 30, scope: 'ALL' });
    expect(withCoupon.quote.discountTotal).toBe(30);
    expect(withCoupon.quote.grandTotal).toBe(plain.grandTotal - 30);
    expect(withCoupon.base.grandTotal).toBe(plain.grandTotal);
    const direct = await app.pricing.quote({ lines, zoneId: app.zoneId, isSubscriptionCheckout: false, couponCode: code('PR') });
    expect(direct.grandTotal).toBe(plain.grandTotal - 30);
    const bad = await app.pricing.quoteWithCoupon({ lines, zoneId: app.zoneId, isSubscriptionCheckout: false, couponCode: code('NOPE') });
    expect(bad.coupon).toMatchObject({ valid: false, reason: 'NOT_FOUND', discount: 0 });
    expect(bad.quote.grandTotal).toBe(plain.grandTotal);
  });

  it('admin CRUD: müşteri 403; POST 201 (kod normalize, varsayılanlar); tekrar kod 409; GET liste (q/active) + detay (redemptions); PUT; PATCH active; DELETE soft (kod arşivlenir, listede yok)', async () => {
    const admin = new CookieJar();
    await app.loginSeedAdmin(admin);
    const customer = await app.createCustomer('adm');
    expect((await app.call('GET', '/api/v1/admin/coupons', { jar: customer.jar })).status).toBe(403);

    const created = await app.call('POST', '/api/v1/admin/coupons', { jar: admin, body: { code: ` ${code('new')} `, kind: 'PERCENT', value: 15, minSubtotal: 250, usageLimit: 10, note: 'yaz kampanyası' } });
    expect(created.status).toBe(201);
    const c = await bodyOf<JsonBody>(created);
    createdIds.push(c.id as string);
    expect(c).toMatchObject({ code: code('NEW'), kind: 'PERCENT', value: 15, minSubtotal: 250, appliesTo: 'ALL', usageLimit: 10, perUserLimit: null, usedCount: 0, isActive: true, note: 'yaz kampanyası' });
    const dup = await app.call('POST', '/api/v1/admin/coupons', { jar: admin, body: { code: code('new').toLowerCase(), kind: 'AMOUNT', value: 5 } });
    expect(dup.status).toBe(409);
    expect((await bodyOf(dup)).error).toBe('COUPON_CODE_TAKEN');
    const badPct = await app.call('POST', '/api/v1/admin/coupons', { jar: admin, body: { code: code('bad'), kind: 'PERCENT', value: 150 } });
    expect(badPct.status).toBe(400);

    const list = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/admin/coupons?q=${code('NEW')}`, { jar: admin }));
    expect((list.items as JsonBody[]).map((i) => i.code)).toEqual([code('NEW')]);
    const inactive = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/admin/coupons?q=T${RUN.toUpperCase()}&active=false`, { jar: admin }));
    expect((inactive.items as JsonBody[]).every((i) => i.isActive === false)).toBe(true);

    const detail = await bodyOf<JsonBody>(await app.call('GET', `/api/v1/admin/coupons/${c.id}`, { jar: admin }));
    expect(detail.redemptions).toEqual([]);

    const put = await app.call('PUT', `/api/v1/admin/coupons/${c.id}`, { jar: admin, body: { code: code('NEW'), kind: 'AMOUNT', value: 40, appliesTo: 'BOX', perUserLimit: 2, endsAt: '2030-12-31T21:00:00.000Z' } });
    expect(put.status).toBe(200);
    expect(await bodyOf<JsonBody>(put)).toMatchObject({ kind: 'AMOUNT', value: 40, appliesTo: 'BOX', perUserLimit: 2, endsAt: '2030-12-31T21:00:00.000Z' });

    const off = await app.call('PATCH', `/api/v1/admin/coupons/${c.id}/active`, { jar: admin, body: { isActive: false } });
    expect((await bodyOf<JsonBody>(off)).isActive).toBe(false);

    const del = await app.call('DELETE', `/api/v1/admin/coupons/${c.id}`, { jar: admin });
    expect(del.status).toBe(200);
    expect((await app.call('GET', `/api/v1/admin/coupons/${c.id}`, { jar: admin })).status).toBe(404);
    const row = await app.prisma.coupon.findUniqueOrThrow({ where: { id: c.id as string } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.code.startsWith(`${code('NEW')}~`)).toBe(true);
    // Kod yeniden kullanılabilir
    const again = await app.call('POST', '/api/v1/admin/coupons', { jar: admin, body: { code: code('NEW'), kind: 'AMOUNT', value: 5 } });
    expect(again.status).toBe(201);
    createdIds.push((await bodyOf<JsonBody>(again)).id as string);
    // Audit
    expect(await app.prisma.auditLog.count({ where: { module: 'coupons', createdAt: { gte: now } } })).toBeGreaterThanOrEqual(4);
  });
});
