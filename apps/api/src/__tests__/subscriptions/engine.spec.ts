// F7 DoD — abonelik motoru senaryoları (servis düzeyi, gerçek DB, `now` parametreli; TZ'den bağımsız UTC anları):
// "11:59 ekstra kabul / 12:01 red" · "2 haftalık takvim" · "atla → geri al → kesim (hak iade)" · "cycle#1 peşin + DELTA Order"
// · "tek seferlik → COMPLETED" · "iptal: kilitli cycle teslim" (+ retention kabul) · "UNPAID×2 → PAST_DUE" (dunning [2,12], 08:00 sınırı)
// · "PAYMENT_LINK: süre dolunca UNPAID".
import { COMMERCE_SETTINGS_DEFAULTS, resolveExtraOptions, roundExtraPrice, type ExtraOption } from '@bagdam/shared';
import { afterCutoff, at, BASE_NOW, beforeCutoff, createSubsApp, T, type SubsApp } from './harness';

jest.setTimeout(300_000);

const status = (e: unknown): string | undefined => (e as { getStatus?: () => number; response?: { error?: string } })?.response?.error;
const httpStatus = (e: unknown): number | undefined => (e as { getStatus?: () => number })?.getStatus?.();

describe('Abonelik motoru — F7 DoD senaryoları', () => {
  let app: SubsApp;

  beforeAll(async () => {
    app = await createSubsApp();
  });

  afterAll(async () => {
    try {
      await app?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('11:59 ekstra kabul / 12:01 red (kesim = teslimattan 1 gün önce 12:00 Europe/Istanbul)', async () => {
    const fx = await app.createFixture();
    const options = resolveExtraOptions(app.products.extra.unit, COMMERCE_SETTINGS_DEFAULTS, app.products.extra.extraOptions as ExtraOption[] | null);
    const opt = options[0]!;
    const extras = [{ id: app.products.extra.slug, factor: opt.factor, label: opt.label }];

    const ok = await app.subscriptions.patchCurrentCycle(fx.userId, { extras }, at('2027-03-01', '11:59'));
    expect(ok.extras).toEqual([{ id: app.products.extra.slug, factor: opt.factor, label: opt.label }]);
    expect(ok.currentCycle?.cycleNo).toBe(1);
    expect(ok.currentCycle?.locked).toBe(false);
    // Ekstra unitPrice snapshot'ı eklenme anında yazılır
    const c1 = await app.cycle(fx.firstCycleId);
    const extraItem = c1.items.find((i) => i.source === 'EXTRA');
    expect(Number(extraItem?.unitPrice?.toString())).toBe(app.products.extra.price);

    // 12:00 / 12:01: bu haftanın kutusu (cycleId ile) → 409 CYCLE_LOCKED
    await expect(app.subscriptions.patchCurrentCycle(fx.userId, { cycleId: fx.firstCycleId, extras }, at('2027-03-01', '12:01'))).rejects.toMatchObject({ response: { error: 'CYCLE_LOCKED' } });
    await expect(app.subscriptions.patchCurrentCycle(fx.userId, { cycleId: fx.firstCycleId, extras }, at('2027-03-01', '12:00'))).rejects.toMatchObject({ response: { error: 'CYCLE_LOCKED' } });
    // Sepetten ekleme de aynı kapıdan geçer
    await expect(app.subscriptions.mergeCart(fx.userId, { cycleId: fx.firstCycleId, lines: [{ id: app.products.extra.slug, qty: 1 }] }, at('2027-03-01', '12:01'))).rejects.toMatchObject({ response: { error: 'CYCLE_LOCKED' } });
    const merged = await app.subscriptions.mergeCart(fx.userId, { cycleId: fx.firstCycleId, lines: [{ id: app.products.extra.slug, qty: 2 }] }, at('2027-03-01', '11:59'));
    expect(merged.extras.some((e) => e.id === app.products.extra.slug && e.factor === 2)).toBe(true);
    // cycleId verilmezse kesim sonrası değişiklik SONRAKİ haftanın kutusuna gider; bu haftanın içeriği değişmez
    const next = await app.subscriptions.patchCurrentCycle(fx.userId, { extras: [] }, at('2027-03-01', '12:01'));
    expect(next.currentCycle?.cycleNo).toBe(2);
    expect(next.extras).toEqual([]);
    const c1After = await app.cycle(fx.firstCycleId);
    expect(c1After.items.filter((i) => i.source === 'EXTRA' || i.source === 'CART_MERGE').length).toBe(2);
  });

  it('2 haftalık takvim: frekans 2 → her 2 haftada bir cycle (ufuk içinde, SCHEDULED)', async () => {
    const fx = await app.createFixture({ frequencyWeeks: 2 });
    const cycles = await app.cyclesOf(fx.subscriptionId);
    expect(cycles.map((c) => c.deliveryDate.date.toISOString().slice(0, 10))).toEqual(['2027-03-02', '2027-03-16', '2027-03-30', '2027-04-13']);
    expect(cycles.map((c) => c.cycleNo)).toEqual([1, 2, 3, 4]);
    expect(cycles.every((c) => c.status === 'SCHEDULED')).toBe(true);
    expect(cycles.every((c) => c.items.filter((i) => i.source === 'TEMPLATE').length === 3)).toBe(true);
    // İkinci koşu idempotent
    const again = await app.cycles.ensure(BASE_NOW, { subscriptionId: fx.subscriptionId });
    expect(again.created).toBe(0);
    const sub = await app.sub(fx.subscriptionId);
    expect(sub.nextDeliveryOn?.toISOString().slice(0, 10)).toBe('2027-03-02');
    expect(sub.discountBoxesLeft).toBe(1); // 2 → cycle#1 checkout'ta 1
    expect(sub.status).toBe('ACTIVE');
  });

  it('atla → geri al → kesim: hak iade edilir, atlanan hafta kilitlenmez, sonraki cycle üretilir', async () => {
    const fx = await app.createFixture();
    // cycle#1 kesimi: peşin → CHARGED (tutar 0)
    const lock1 = await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
    expect(lock1.chargedZero).toBeGreaterThanOrEqual(1);
    expect((await app.cycle(fx.firstCycleId)).status).toBe('CHARGED');

    const tue = T('2027-03-02T12:00:00.000Z');
    const skipped = await app.subscriptions.skip(fx.userId, tue);
    expect(skipped.skipThisWeek).toBe(true);
    expect(skipped.skipUsed).toBe(true); // skipsPerYear 1
    expect(skipped.currentCycle?.status).toBe('SKIPPED');
    expect(skipped.currentCycle?.deliveryOn).toBe('2027-03-09');
    await expect(app.subscriptions.skip(fx.userId, tue)).rejects.toMatchObject({ response: { error: 'CYCLE_NOT_EDITABLE' } });

    const restored = await app.subscriptions.unskip(fx.userId, tue);
    expect(restored.skipThisWeek).toBe(false);
    expect(restored.skipUsed).toBe(false); // hak iade
    expect((await app.sub(fx.subscriptionId)).skipsUsed).toBe(0);

    const skippedAgain = await app.subscriptions.skip(fx.userId, tue);
    expect(skippedAgain.skipThisWeek).toBe(true);
    const dd0309 = await app.prisma.deliveryDate.findUnique({ where: { zoneId_date: { zoneId: fx.zoneId, date: new Date('2027-03-09T00:00:00.000Z') } } });
    const reservedAfterSkip = dd0309!.reserved;

    // Kesim: atlanan hafta lock'a girmez; sonraki cycle (03-16) zaten var
    const lock2 = await app.cycles.lockAndCharge(afterCutoff('2027-03-09'));
    const cycles = await app.cyclesOf(fx.subscriptionId);
    const c2 = cycles.find((c) => c.cycleNo === 2)!;
    const c3 = cycles.find((c) => c.cycleNo === 3)!;
    expect(c2.status).toBe('SKIPPED');
    expect(c2.skipSource).toBe('USER');
    expect(c3.deliveryDate.date.toISOString().slice(0, 10)).toBe('2027-03-16');
    expect(c3.status).toBe('SCHEDULED');
    expect(lock2.errors).toBe(0);
    expect((await app.prisma.deliveryDate.findUnique({ where: { id: dd0309!.id } }))!.reserved).toBe(reservedAfterSkip);
    // Kesimden sonra geri alma yok (güncel düzenlenebilir cycle artık #3)
    await expect(app.subscriptions.unskip(fx.userId, afterCutoff('2027-03-09'))).rejects.toMatchObject({ response: { error: 'NOT_SKIPPED' } });
    const types = (await app.events(fx.subscriptionId)).map((e) => e.type);
    expect(types.filter((t) => t === 'SKIP').length).toBe(2);
    expect(types.filter((t) => t === 'UNSKIP').length).toBe(1);
  });

  it('cycle#1 peşin + DELTA Order: kesimde yalnız eklenen ekstralar ayrı siparişle tahsil edilir', async () => {
    const fx = await app.createFixture(); // prepaid 300 = 600 − %50
    const options = resolveExtraOptions(app.products.extra.unit, COMMERCE_SETTINGS_DEFAULTS, app.products.extra.extraOptions as ExtraOption[] | null);
    const opt = options[options.length - 1]!;
    const extraPrice = roundExtraPrice(app.products.extra.price, opt.factor);
    await app.subscriptions.patchCurrentCycle(fx.userId, { extras: [{ id: app.products.extra.slug, factor: opt.factor, label: opt.label }] }, beforeCutoff('2027-03-02'));

    const result = await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
    expect(result.delta).toBeGreaterThanOrEqual(1);
    const c1 = await app.cycle(fx.firstCycleId);
    expect(c1.status).toBe('CHARGED');
    expect(Number(c1.boxPrice)).toBe(app.tierPrice);
    expect(Number(c1.discount)).toBe(app.tierPrice / 2);
    expect(Number(c1.extrasTotal)).toBe(extraPrice);
    expect(Number(c1.total)).toBe(app.tierPrice / 2 + extraPrice);
    expect(c1.deltaOrderId).not.toBeNull();
    expect(c1.orderId).toBe(fx.orderId);
    const delta = await app.prisma.order.findUnique({ where: { id: c1.deltaOrderId! }, include: { lines: true, payments: true } });
    expect(delta?.status).toBe('PAID');
    expect(Number(delta?.grandTotal)).toBe(extraPrice);
    expect(delta?.lines.every((l) => l.kind === 'EXTRA')).toBe(true);
    expect(delta?.payments[0]).toMatchObject({ kind: 'DELTA', status: 'SUCCEEDED', isMerchantInitiated: true, conversationId: `cyc_${c1.id}_1` });
    // Checkout Order'ı DEĞİŞMEZ
    expect((await app.prisma.order.findUnique({ where: { id: fx.orderId } }))?.status).toBe('PAID');
    const types = (await app.events(fx.subscriptionId)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['CREATED', 'ACTIVATED', 'EXTRA_ADDED', 'LOCKED', 'DELTA_CHARGED']));
    expect(app.notifier.recent({ event: 'cycle.charged', subscriptionId: fx.subscriptionId }).length).toBe(1);
  });

  it('tek seferlik → COMPLETED: tek cycle, ensure üretmez, DELIVERED olunca abonelik tamamlanır', async () => {
    const fx = await app.createFixture({ isOneTime: true }); // fixture prepaid 649 = 600 + kargo 49 (checkout Order'ında); F8 KARAR: cycle#1 snapshot'ında kargo 0 (DELTA'da kargo yok)
    expect((await app.cyclesOf(fx.subscriptionId)).length).toBe(1);
    const ensure = await app.cycles.ensure(BASE_NOW, { subscriptionId: fx.subscriptionId });
    expect(ensure.created).toBe(0);
    await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
    let c1 = await app.cycle(fx.firstCycleId);
    expect(c1.status).toBe('CHARGED');
    expect(Number(c1.shippingFee)).toBe(0); // F8: kargo checkout Order.shippingFee'de; cycle#1 kilit snapshot'ında yeniden hesaplanmaz
    expect(Number(c1.discount)).toBe(0);
    expect(Number(c1.total)).toBe(600);
    expect(c1.deltaOrderId).toBeNull();
    expect((await app.cyclesOf(fx.subscriptionId)).length).toBe(1);

    const day = T('2027-03-02T06:00:00.000Z');
    await app.cycles.adminSetStatus(c1.id, 'PREPARING', { actor: 'OPS' }, day);
    await app.cycles.adminSetStatus(c1.id, 'OUT_FOR_DELIVERY', { actor: 'OPS' }, day);
    const delivered = await app.cycles.adminSetStatus(c1.id, 'DELIVERED', { actor: 'OPS', note: 'teslim' }, day);
    expect(delivered.status).toBe('DELIVERED');
    c1 = await app.cycle(fx.firstCycleId);
    const sub = await app.sub(fx.subscriptionId);
    expect(sub.status).toBe('COMPLETED');
    expect(sub.completedAt).not.toBeNull();
    expect((await app.prisma.order.findUnique({ where: { id: fx.orderId } }))?.status).toBe('DELIVERED');
    expect((await app.events(fx.subscriptionId)).map((e) => e.type)).toContain('COMPLETED');
    // Tamamlanan abonelik müşteriye görünmez; yeni abonelik açılabilir
    expect(await app.subscriptions.getForUser(fx.userId, day)).toBeNull();
    await expect(app.cycles.adminSetStatus(c1.id, 'PREPARING', { actor: 'OPS' }, day)).rejects.toMatchObject({ response: { error: 'CYCLE_TRANSITION_INVALID' } });
  });

  it('iptal: kilitli cycle teslim edilir, SCHEDULED olanlar iptal + DD iade, effectiveAt ≤ 7 gün; retention kabul ayrı akış', async () => {
    const fx = await app.createFixture();
    await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
    const reqAt = T('2027-03-01T10:00:00.000Z');
    const req = await app.cancellation.request(fx.userId, { reason: 'PRICE', note: 'pahalı' }, reqAt);
    expect(req.offer).toEqual({ pct: 50, boxes: 1 });
    expect((await app.sub(fx.subscriptionId)).status).toBe('CANCEL_REQUESTED');
    expect((await app.prisma.user.findUnique({ where: { id: fx.userId } }))?.retentionOfferUsedAt).not.toBeNull();
    await expect(app.cancellation.request(fx.userId, { reason: 'PRICE' }, reqAt)).rejects.toMatchObject({ response: { error: 'CANCEL_ALREADY_REQUESTED' } });

    const before = await app.cyclesOf(fx.subscriptionId);
    const scheduledBefore = before.filter((c) => c.status === 'SCHEDULED');
    expect(scheduledBefore.length).toBeGreaterThanOrEqual(1);
    const dd = await app.prisma.deliveryDate.findUnique({ where: { id: scheduledBefore[0]!.deliveryDateId } });

    const confirmAt = T('2027-03-01T10:05:00.000Z');
    const confirmed = await app.cancellation.confirm(fx.userId, confirmAt);
    expect(confirmed.status).toBe('CANCELLED');
    expect(confirmed.cancellation.outcome).toBe('CANCELLED');
    expect(confirmed.cancellation.refundAmount).toBe(0);
    // effectiveAt = kilitli cycle'ın teslimat günü sonu (03-02 → 03-03 00:00 +03 = 03-02T21:00Z) ≤ talep + 7 g
    expect(confirmed.cancellation.effectiveAt).toBe('2027-03-02T21:00:00.000Z');
    const after = await app.cyclesOf(fx.subscriptionId);
    expect(after.find((c) => c.cycleNo === 1)?.status).toBe('CHARGED');
    expect(after.filter((c) => c.cycleNo > 1).every((c) => c.status === 'CANCELLED')).toBe(true);
    expect((await app.prisma.deliveryDate.findUnique({ where: { id: dd!.id } }))!.reserved).toBe(dd!.reserved - 1);
    const sub = await app.sub(fx.subscriptionId);
    expect(sub.status).toBe('CANCELLED');
    expect(sub.nextDeliveryOn).toBeNull();
    expect(await app.subscriptions.getForUser(fx.userId, confirmAt)).toBeNull();
    expect(app.notifier.recent({ event: 'subscription.cancelled', subscriptionId: fx.subscriptionId }).length).toBe(1);

    // Retention kabul: ikinci abone
    const fx2 = await app.createFixture();
    const r2 = await app.cancellation.request(fx2.userId, { reason: 'VARIETY' }, reqAt);
    expect(r2.offer).not.toBeNull();
    const accepted = await app.cancellation.accept(fx2.userId, reqAt);
    expect(accepted.status).toBe('ACTIVE');
    expect(accepted.nextBoxDiscount).toBe(true);
    expect((await app.sub(fx2.subscriptionId)).nextBoxDiscountPct).toBe(50);
    // İkinci akışta teklif yok (üye başına 1)
    const r3 = await app.cancellation.request(fx2.userId, { reason: 'OTHER' }, reqAt);
    expect(r3.offer).toBeNull();
    const abandoned = await app.cancellation.abandon(fx2.userId, reqAt);
    expect(abandoned.status).toBe('ACTIVE');
    await expect(app.cancellation.accept(fx2.userId, reqAt)).rejects.toMatchObject({ response: { error: 'NO_OPEN_CANCELLATION' } });

    // Kesimden önce iptal: cycle#1 peşin iade (REFUNDED) + refundDueAt ≤ 15 g
    const fx3 = await app.createFixture();
    await app.cancellation.request(fx3.userId, { reason: 'PRICE' }, T('2027-03-01T06:00:00.000Z'));
    const c3 = await app.cancellation.confirm(fx3.userId, T('2027-03-01T06:01:00.000Z'));
    expect(c3.cancellation.refundAmount).toBe(app.tierPrice / 2);
    expect(c3.cancellation.refundDueAt).toBe(new Date(T('2027-03-01T06:01:00.000Z').getTime() + 14 * 86_400_000).toISOString());
    expect((await app.prisma.order.findUnique({ where: { id: fx3.orderId } }))?.status).toBe('REFUNDED');
    expect((await app.cycle(fx3.firstCycleId)).status).toBe('CANCELLED');
  });

  it('UNPAID×2 → PAST_DUE: dunning [2,12] (08:00 sınırı), denemeler tükenince SKIPPED(UNPAID); kart güncellenince toparlar', async () => {
    const restore = app.overrideCommerce({ dunning: { retryHours: [2, 12], pastDueAfterUnpaid: 2 } });
    try {
      const fx = await app.createFixture({ cardToken: `fail:${Date.now()}` });
      await app.cycles.lockAndCharge(afterCutoff('2027-03-02')); // #1 peşin → CHARGED(0)

      // cycle#2 (03-09): kesim 03-08 09:00Z → MIT başarısız → UNPAID, nextRetryAt = lockedAt + 2 s
      const lockAt = T('2027-03-08T09:01:00.000Z');
      const r1 = await app.cycles.lockAndCharge(lockAt);
      expect(r1.unpaid).toBe(1);
      let cycles = await app.cyclesOf(fx.subscriptionId);
      let c2 = cycles.find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('UNPAID');
      expect(c2.retryCount).toBe(0);
      expect(c2.nextRetryAt?.toISOString()).toBe('2027-03-08T11:01:00.000Z');
      expect(c2.order?.status).toBe('PAYMENT_FAILED');
      // Henüz zamanı gelmemiş deneme işlenmez
      expect((await app.cycles.retryPayments(T('2027-03-08T10:00:00.000Z'))).itemsProcessed).toBe(0);

      const retry1 = await app.cycles.retryPayments(T('2027-03-08T11:02:00.000Z'));
      expect(retry1.failed).toBe(1);
      c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('UNPAID');
      expect(c2.retryCount).toBe(1);
      expect(c2.nextRetryAt?.toISOString()).toBe('2027-03-08T21:01:00.000Z'); // lockedAt + 12 s ≤ 03-09 05:00Z

      const retry2 = await app.cycles.retryPayments(T('2027-03-08T21:02:00.000Z'));
      expect(retry2.skippedUnpaid).toBe(1);
      c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('SKIPPED');
      expect(c2.skipSource).toBe('UNPAID');
      expect(c2.order?.status).toBe('CANCELLED');
      let sub = await app.sub(fx.subscriptionId);
      expect(sub.failedCycles).toBe(1);
      expect(sub.status).toBe('ACTIVE');
      expect((await app.prisma.payment.count({ where: { orderId: c2.orderId!, status: 'FAILED' } })).valueOf()).toBe(3); // 1 + 2 retry

      // cycle#3 (03-16): aynı yol → 2. ardışık UNPAID → PAST_DUE
      await app.cycles.lockAndCharge(T('2027-03-15T09:01:00.000Z'));
      await app.cycles.retryPayments(T('2027-03-15T11:02:00.000Z'));
      await app.cycles.retryPayments(T('2027-03-15T21:02:00.000Z'));
      cycles = await app.cyclesOf(fx.subscriptionId);
      const c3 = cycles.find((c) => c.cycleNo === 3)!;
      expect(c3.status).toBe('SKIPPED');
      expect(c3.skipSource).toBe('UNPAID');
      sub = await app.sub(fx.subscriptionId);
      expect(sub.status).toBe('PAST_DUE');
      expect(sub.failedCycles).toBe(2);
      const unpaidEvents = (await app.events(fx.subscriptionId)).filter((e) => e.type === 'UNPAID');
      expect(unpaidEvents.length).toBe(2);
      expect((unpaidEvents[1]!.data as { pastDue: boolean }).pastDue).toBe(true);
      // Motor PAST_DUE'de durmaz: cycle#4 var
      expect(cycles.some((c) => c.cycleNo === 4 && c.status === 'SCHEDULED')).toBe(true);
      // Müşteri DTO'sunda dunning bayrağı
      const dto = await app.subscriptions.getForUser(fx.userId, T('2027-03-16T10:00:00.000Z'));
      expect(dto?.status).toBe('PAST_DUE');
      expect(dto?.dunning?.active).toBe(true);

      // Kart güncelle → sonraki kesimde tahsilat → ACTIVE
      const goodPm = await app.prisma.paymentMethod.create({ data: { userId: fx.userId, provider: 'MANUAL', providerCustomerKey: 'cus_ok', providerCardToken: 'ok:new', last4: '0002', isDefault: true, isActive: true } });
      const patched = await app.subscriptions.patchForUser(fx.userId, { paymentMethodId: goodPm.id }, T('2027-03-16T10:00:00.000Z'));
      expect(patched.card?.last4).toBe('0002');
      const r4 = await app.cycles.lockAndCharge(T('2027-03-22T09:01:00.000Z'));
      expect(r4.errors).toBe(0);
      const c4 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 4)!;
      expect(c4.status).toBe('CHARGED');
      expect(c4.order?.status).toBe('PAID');
      sub = await app.sub(fx.subscriptionId);
      expect(sub.status).toBe('ACTIVE');
      expect(sub.failedCycles).toBe(0);
    } finally {
      restore();
    }
  });

  it('dunning [24,72] (ADR-0020 öncesi değer) teslimat günü 08:00 sınırını aşar → kesimdeki ilk başarısız tahsilat doğrudan SKIPPED(UNPAID) (§14 #1 KARAR; varsayılan artık [2,12])', async () => {
    // ADR-0020: varsayılan [2,12] pencere içinde kalır; sınır kuralını eski değerle açıkça test ediyoruz.
    const restore = app.overrideCommerce({ dunning: { retryHours: [24, 72], pastDueAfterUnpaid: 2 } });
    try {
      const fx = await app.createFixture({ cardToken: `fail:${Date.now()}-b` });
      await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
      const r = await app.cycles.lockAndCharge(T('2027-03-08T09:01:00.000Z'));
      expect(r.skippedUnpaid).toBe(1);
      const c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('SKIPPED');
      expect(c2.skipSource).toBe('UNPAID');
      const unpaid = (await app.events(fx.subscriptionId)).find((e) => e.type === 'UNPAID');
      expect((unpaid?.data as { reason: string }).reason).toBe('retry_after_deadline');
    } finally {
      restore();
    }
  });

  it('varsayılan dunning [2,12] (ADR-0020): kesimdeki ilk başarısız tahsilat atlanmaz, yeniden deneme planlanır', async () => {
    const fx = await app.createFixture({ cardToken: `fail:${Date.now()}-c` });
    await app.cycles.lockAndCharge(afterCutoff('2027-03-02'));
    const r = await app.cycles.lockAndCharge(T('2027-03-08T09:01:00.000Z'));
    expect(r.skippedUnpaid).toBe(0);
    const c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
    expect(['UNPAID', 'LOCKED']).toContain(c2.status);
    expect(c2.nextRetryAt).not.toBeNull();
  });

  it('PAYMENT_LINK: kesimde AWAITING_PAYMENT + link; süre dolunca UNPAID (+ dunning yeni link)', async () => {
    const restore = app.overrideCommerce({ paymentLinkHours: 1, dunning: { retryHours: [2, 12], pastDueAfterUnpaid: 2 } });
    try {
      const fx = await app.createFixture({ chargeStrategy: 'PAYMENT_LINK', cardToken: null });
      await app.cycles.lockAndCharge(afterCutoff('2027-03-02')); // #1 peşin → CHARGED(0)
      // cycle#1 teslim edildi (ops) — inFlight artık cycle#2 olsun
      for (const st of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) await app.cycles.adminSetStatus(fx.firstCycleId, st, { actor: 'OPS' }, T('2027-03-02T08:00:00.000Z'));
      const lockAt = T('2027-03-08T09:01:00.000Z');
      const r = await app.cycles.lockAndCharge(lockAt);
      expect(r.awaiting).toBe(1);
      let c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('AWAITING_PAYMENT');
      expect(c2.paymentDueAt?.toISOString()).toBe('2027-03-08T10:01:00.000Z');
      const payments = await app.prisma.payment.findMany({ where: { orderId: c2.orderId! } });
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ kind: 'LINK', status: 'PENDING', is3ds: true });
      expect(payments[0]!.linkToken).toMatch(/^[0-9a-f]{32}$/);
      expect(payments[0]!.linkExpiresAt?.toISOString()).toBe('2027-03-08T10:01:00.000Z');
      const dto = await app.subscriptions.getForUser(fx.userId, T('2027-03-08T09:30:00.000Z'));
      expect(dto?.inFlightCycle?.status).toBe('AWAITING_PAYMENT');
      expect(dto?.inFlightCycle?.paymentLinkUrl).toContain(`/api/v1/pay/${payments[0]!.linkToken}`);
      expect(app.notifier.recent({ event: 'cycle.awaiting-payment', subscriptionId: fx.subscriptionId }).length).toBe(1);

      expect((await app.cycles.expirePaymentLinks(T('2027-03-08T10:00:00.000Z'))).expired).toBe(0);
      const exp = await app.cycles.expirePaymentLinks(T('2027-03-08T10:02:00.000Z'));
      expect(exp.expired).toBe(1);
      c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('UNPAID');
      expect(c2.order?.status).toBe('PAYMENT_FAILED');
      expect(c2.nextRetryAt?.toISOString()).toBe('2027-03-08T11:01:00.000Z');
      expect((await app.prisma.payment.findUnique({ where: { id: payments[0]!.id } }))?.status).toBe('EXPIRED');
      const types = (await app.events(fx.subscriptionId)).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_FAILED']));

      // Dunning LINK stratejisinde: yeni link, cycle UNPAID kalır
      const retry = await app.cycles.retryPayments(T('2027-03-08T11:02:00.000Z'));
      expect(retry.linksIssued).toBe(1);
      c2 = (await app.cyclesOf(fx.subscriptionId)).find((c) => c.cycleNo === 2)!;
      expect(c2.status).toBe('UNPAID');
      expect(c2.retryCount).toBe(1);
      expect(await app.prisma.payment.count({ where: { orderId: c2.orderId!, kind: 'LINK', status: 'PENDING' } })).toBe(1);
      // Link ile ödendi (F8 callback kancası) → CHARGED
      const charged = await app.cycles.completeLinkPayment(c2.id, { paymentId: null }, T('2027-03-08T11:30:00.000Z'));
      expect(charged.status).toBe('CHARGED');
      expect((await app.prisma.order.findUnique({ where: { id: c2.orderId! } }))?.status).toBe('PAID');
    } finally {
      restore();
    }
  });

  it('hatalı geçişler 409 {error}', async () => {
    const fx = await app.createFixture();
    await expect(app.cycles.adminSetStatus(fx.firstCycleId, 'DELIVERED', { actor: 'OPS' }, BASE_NOW)).rejects.toMatchObject({ response: { error: 'CYCLE_TRANSITION_INVALID' } });
    await expect(app.cycles.adminSetStatus(fx.firstCycleId, 'LOCKED', { actor: 'OPS' }, BASE_NOW)).rejects.toMatchObject({ response: { error: 'CHARGE_NOT_APPLICABLE' } });
    await expect(app.cycles.adminSetStatus(fx.firstCycleId, 'UNPAID', { actor: 'OPS' }, BASE_NOW)).rejects.toMatchObject({ response: { error: 'CYCLE_TRANSITION_INVALID' } });
    await expect(app.subscriptions.skip(fx.userId, BASE_NOW)).rejects.toMatchObject({ response: { error: 'FIRST_CYCLE_NOT_SKIPPABLE' } });
    try {
      await app.subscriptions.unskip(fx.userId, BASE_NOW);
      throw new Error('beklenmedi');
    } catch (err) {
      expect(httpStatus(err)).toBe(409);
      expect(status(err)).toBe('NOT_SKIPPED');
    }
  });
});
