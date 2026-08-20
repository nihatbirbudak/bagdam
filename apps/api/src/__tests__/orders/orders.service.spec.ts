// F7/B2 — OrdersService (gerçek DB): createFromQuote snapshot + orderNo ≥ 1001 + DeliveryDate rezerv çağrısı (casus deps) ·
// DAY_FULL / DAY_LOCKED / ZONE_MISMATCH · geçersiz geçiş 409 · PAID→PREPARING→OUT_FOR_DELIVERY→DELIVERED · cancel → release + CANCELLED ·
// createForCycle (BOX + EXTRA satırları, cycle.orderId) · createDeltaForCycle (peşin ekstralar düşülür, deltaOrderId) · listForUser/getForUser.
// Zaman: kesim anları shared computeCutoffAt (UTC instant) — süreç TZ'sinden bağımsız (UTC ve Europe/Istanbul'da aynı).
import '../helpers/env';
import { ConflictException, BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import {
  computeCycleCharge,
  computeQuote,
  OrderKind,
  OrderLineKind,
  OrderStatus,
  roundExtraPrice,
  roundMoney,
  type OrderLineSnapshotInput,
  type PricingResult,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import { cleanupOrdersFixture, createOrdersFixture, createOrdersServiceApp, type OrdersFixture, type OrdersServiceApp } from './orders-harness';

jest.setTimeout(180_000);

const ZONE_RULE = { fee: 49, freeThreshold: 1000 };

interface SeedProduct {
  id: string;
  slug: string;
  name: string;
  unit: string;
  price: number;
  vatRate: number;
  lotCode: string | null;
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = err.getResponse();
  return typeof body === 'object' && body ? (body as { error?: string }).error : undefined;
}

async function expectHttpError(p: Promise<unknown>, ctor: new (...args: never[]) => HttpException, code: string): Promise<void> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ctor);
  expect(errorCode(caught)).toBe(code);
}

/** PricedLine → snapshot satırı (name/unit/lotCode ile). */
function snapshotLines(quote: PricingResult, products: Map<string, SeedProduct>, tierLabel?: string): OrderLineSnapshotInput[] {
  return quote.lines.map((l) => {
    if (l.kind === OrderLineKind.BOX) {
      return { kind: l.kind, tierSlug: l.tierSlug ?? null, name: tierLabel ?? 'Kutu', unit: 'kutu', qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, vatRate: l.vatRate, metadata: { items: [] } };
    }
    const p = products.get(l.productId ?? '')!;
    return { kind: l.kind, productId: p.id, name: p.name, unit: p.unit, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, vatRate: l.vatRate, pref: l.pref ?? null, lotCode: p.lotCode };
  });
}

describe('OrdersService — createFromQuote · transition · cancel · createForCycle · createDeltaForCycle (F7/B2)', () => {
  let t: OrdersServiceApp;
  let fx: OrdersFixture;
  const products = new Map<string, SeedProduct>();
  let p: SeedProduct[] = [];
  let tier: { id: string; slug: string; label: string; price: number };
  let firstOrderId = '';
  let firstOrderNo = 0;
  let secondOrderId = '';

  const reservedOf = async (id: string): Promise<number> => (await t.prisma.deliveryDate.findUniqueOrThrow({ where: { id } })).reserved;

  beforeAll(async () => {
    t = await createOrdersServiceApp();
    fx = await createOrdersFixture(t.prisma, 'svc');
    const rows = await t.prisma.product.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      take: 4,
      include: { lots: { where: { isCurrent: true }, take: 1 } },
    });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    p = rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, unit: r.unit, price: Number(r.price.toString()), vatRate: r.vatRate, lotCode: r.lots[0]?.lotCode ?? null }));
    for (const x of p) products.set(x.id, x);
    const tierRow = await t.prisma.boxTier.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    tier = { id: tierRow.id, slug: tierRow.slug, label: tierRow.label, price: Number(tierRow.price.toString()) };
  });

  afterAll(async () => {
    if (t) {
      if (fx) await cleanupOrdersFixture(t.prisma, fx);
      await t.close();
    }
  });

  it('createFromQuote: snapshot (müşteri/adres/teslimat/toplamlar/satırlar), orderNo ≥ 1001, PENDING_PAYMENT, deps.reserve çağrısı + reserved +1', async () => {
    const before = await reservedOf(fx.openDateId);
    const quote = computeQuote(
      [
        { kind: OrderLineKind.PRODUCT, productId: p[0]!.id, unitPrice: p[0]!.price, qty: 2, vatRate: p[0]!.vatRate },
        { kind: OrderLineKind.PRODUCT, productId: p[1]!.id, unitPrice: p[1]!.price, qty: 1, vatRate: p[1]!.vatRate, pref: 'L boy' },
      ],
      { zone: ZONE_RULE, hasActiveSubscription: false, isSubscriptionCheckout: false, firstBoxesLeft: 0, retentionPct: null, vatRateDefault: 1 },
    );
    expect(quote.orderKind).toBe(OrderKind.SINGLE);
    const now = new Date();
    const { order, lines } = await t.orders.createFromQuote({
      quote,
      lines: snapshotLines(quote, products),
      userId: fx.userId,
      customer: { name: 'Sipariş Test', email: fx.email, phone: '+90 555 000 11 22' },
      address: fx.address,
      deliveryDateId: fx.openDateId,
      note: 'kapıya bırakın',
      ipAddress: '127.0.0.1',
      now,
    });
    firstOrderId = order.id;
    firstOrderNo = order.orderNo;

    expect(order.orderNo).toBeGreaterThanOrEqual(1001);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.kind).toBe('SINGLE');
    expect(order.userId).toBe(fx.userId);
    expect(order.subscriptionId).toBeNull();
    expect(order).toMatchObject({ customerName: 'Sipariş Test', customerEmail: fx.email, customerPhone: '+90 555 000 11 22', zoneId: fx.zoneId, deliveryDateId: fx.openDateId, deliveryDay: 'SALI', note: 'kapıya bırakın', ipAddress: '127.0.0.1' });
    expect(order.deliveryOn.toISOString().slice(0, 10)).toBe(fx.openDateIso);
    expect(order.addressSnapshot).toEqual(fx.address);
    expect(Number(order.subtotal)).toBe(quote.subtotal);
    expect(Number(order.discountTotal)).toBe(quote.discountTotal);
    expect(Number(order.shippingFee)).toBe(quote.shippingFee);
    expect(Number(order.vatTotal)).toBe(quote.vatTotal);
    expect(Number(order.grandTotal)).toBe(quote.grandTotal);
    expect(order.paidAt).toBeNull();

    expect(lines).toHaveLength(2);
    const l0 = lines.find((l) => l.productId === p[0]!.id)!;
    expect(l0).toMatchObject({ kind: 'PRODUCT', name: p[0]!.name, unit: p[0]!.unit, vatRate: p[0]!.vatRate, lotCode: p[0]!.lotCode, pref: null });
    expect(Number(l0.qty)).toBe(2);
    expect(Number(l0.unitPrice)).toBe(p[0]!.price);
    expect(Number(l0.lineTotal)).toBe(roundMoney(p[0]!.price * 2));
    const l1 = lines.find((l) => l.productId === p[1]!.id)!;
    expect(l1.pref).toBe('L boy');

    expect(t.deps.reserve).toHaveBeenCalledTimes(1);
    expect(t.deps.reserve.mock.calls[0]![0]).toBe(fx.openDateId);
    expect(t.deps.reserve.mock.calls[0]![1]).toBeDefined(); // tx iletildi
    expect(await reservedOf(fx.openDateId)).toBe(before + 1);
  });

  it('createFromQuote: dolu gün → 409 DAY_FULL (rezerv geri alınır: işlem iptal) · kesimi geçmiş → 409 DAY_LOCKED · bölge uyuşmazlığı → 400 ZONE_MISMATCH · boş satır → 400', async () => {
    const quote = computeQuote(
      [{ kind: OrderLineKind.PRODUCT, productId: p[0]!.id, unitPrice: p[0]!.price, qty: 1, vatRate: 1 }],
      { zone: ZONE_RULE, hasActiveSubscription: false, isSubscriptionCheckout: false, firstBoxesLeft: 0, retentionPct: null, vatRateDefault: 1 },
    );
    const base = { quote, lines: snapshotLines(quote, products), userId: fx.userId, customer: { name: 'X', email: fx.email, phone: '0555' }, address: fx.address };
    const reserveCalls = t.deps.reserve.mock.calls.length;
    await expectHttpError(t.orders.createFromQuote({ ...base, deliveryDateId: fx.fullDateId }), ConflictException, 'DAY_FULL');
    expect(t.deps.reserve.mock.calls.length).toBe(reserveCalls + 1);
    expect(await t.prisma.order.count({ where: { deliveryDateId: fx.fullDateId } })).toBe(0);
    expect(await reservedOf(fx.fullDateId)).toBe(0);

    await expectHttpError(t.orders.createFromQuote({ ...base, deliveryDateId: fx.lockedDateId }), ConflictException, 'DAY_LOCKED');
    const urla = await t.prisma.deliveryZone.findUniqueOrThrow({ where: { slug: 'urla' } });
    await expectHttpError(t.orders.createFromQuote({ ...base, deliveryDateId: fx.openDateId, address: { ...fx.address, zoneId: urla.id } }), BadRequestException, 'ZONE_MISMATCH');
    await expectHttpError(t.orders.createFromQuote({ ...base, lines: [], deliveryDateId: fx.openDateId }), BadRequestException, 'ORDER_EMPTY');
    await expectHttpError(t.orders.createFromQuote({ ...base, deliveryDateId: 'clyokyokyokyokyokyokyokyo' }), NotFoundException, 'DELIVERY_DATE_NOT_FOUND');
    expect(await reservedOf(fx.openDateId)).toBe(1); // yalnız ilk sipariş
  });

  it('transition: geçersiz geçiş 409 ORDER_TRANSITION_INVALID · CANCELLED nedensiz 400 ORDER_REASON_REQUIRED · bilinmeyen sipariş 404', async () => {
    await expectHttpError(t.orders.transition(firstOrderId, OrderStatus.DELIVERED, { actor: 'SYSTEM' }), ConflictException, 'ORDER_TRANSITION_INVALID');
    await expectHttpError(t.orders.transition(firstOrderId, OrderStatus.CANCELLED, { actor: 'ADMIN' }), BadRequestException, 'ORDER_REASON_REQUIRED');
    await expectHttpError(t.orders.transition('clyokyokyokyokyokyokyokyo', OrderStatus.PAID, { actor: 'SYSTEM' }), NotFoundException, 'ORDER_NOT_FOUND');
    const row = await t.prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } });
    expect(row.status).toBe('PENDING_PAYMENT');
  });

  it('transition zinciri: PENDING_PAYMENT → PAID (paidAt) → PREPARING → OUT_FOR_DELIVERY → DELIVERED; DELIVERED → PAID 409; DD iade YOK', async () => {
    const paidAt = new Date('2026-08-20T09:30:00.000Z');
    const paid = await t.orders.transition(firstOrderId, OrderStatus.PAID, { actor: 'PSP', now: paidAt });
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt?.toISOString()).toBe(paidAt.toISOString());
    const preparing = await t.orders.transition(firstOrderId, OrderStatus.PREPARING, { actor: 'OPS' });
    expect(preparing.status).toBe('PREPARING');
    const out = await t.orders.transition(firstOrderId, OrderStatus.OUT_FOR_DELIVERY, { actor: 'OPS' });
    expect(out.status).toBe('OUT_FOR_DELIVERY');
    const delivered = await t.orders.transition(firstOrderId, OrderStatus.DELIVERED, { actor: 'OPS' });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.paidAt?.toISOString()).toBe(paidAt.toISOString()); // değişmez
    await expectHttpError(t.orders.transition(firstOrderId, OrderStatus.PAID, { actor: 'OPS' }), ConflictException, 'ORDER_TRANSITION_INVALID');
    expect(t.deps.release).not.toHaveBeenCalled();
    expect(await reservedOf(fx.openDateId)).toBe(1);
  });

  it('cancel: ikinci sipariş → CANCELLED (cancelledAt, cancelReason) + deps.release + reserved −1; terminalden çıkış yok', async () => {
    const quote = computeQuote(
      [{ kind: OrderLineKind.PRODUCT, productId: p[2]!.id, unitPrice: p[2]!.price, qty: 3, vatRate: p[2]!.vatRate }],
      { zone: ZONE_RULE, hasActiveSubscription: false, isSubscriptionCheckout: false, firstBoxesLeft: 0, retentionPct: null, vatRateDefault: 1 },
    );
    const { order } = await t.orders.createFromQuote({
      quote,
      lines: snapshotLines(quote, products),
      userId: fx.userId,
      customer: { name: 'Sipariş Test', email: fx.email, phone: '+90 555 000 11 22' },
      address: fx.address,
      deliveryDateId: fx.openDateId,
    });
    secondOrderId = order.id;
    expect(order.orderNo).toBe(firstOrderNo + 1);
    expect(await reservedOf(fx.openDateId)).toBe(2);

    const now = new Date('2026-08-21T10:00:00.000Z');
    const cancelled = await t.orders.cancel(order.id, 'Müşteri vazgeçti', 'OPS', null);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Müşteri vazgeçti');
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(t.deps.release).toHaveBeenCalledTimes(1);
    expect(t.deps.release.mock.calls[0]![0]).toBe(fx.openDateId);
    expect(await reservedOf(fx.openDateId)).toBe(1);
    await expectHttpError(t.orders.transition(order.id, OrderStatus.PAID, { actor: 'SYSTEM', now }), ConflictException, 'ORDER_TRANSITION_INVALID');
  });

  it('listForUser / getForUser: iki sipariş (yeni → eski, lineCount); başkasının siparişi 404; getStatusForUser', async () => {
    const list = await t.orders.listForUser(fx.userId);
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.id)).toEqual([secondOrderId, firstOrderId]);
    expect(list.items[1]).toMatchObject({ orderNo: firstOrderNo, kind: 'SINGLE', status: 'DELIVERED', lineCount: 2, deliveryDay: 'SALI', deliveryOn: fx.openDateIso });
    expect(typeof list.items[1]!.grandTotal).toBe('number');
    const detail = await t.orders.getForUser(fx.userId, firstOrderNo);
    expect(detail.lines).toHaveLength(2);
    expect(detail.payments).toBeUndefined();
    expect(detail.addressSnapshot).toEqual(fx.address);
    await expectHttpError(t.orders.getForUser('clbaskasiclbaskasiclbaska', firstOrderNo), NotFoundException, 'ORDER_NOT_FOUND');
    const status = await t.orders.getStatusForUser(fx.userId, firstOrderNo);
    expect(status).toEqual({ orderNo: firstOrderNo, status: 'DELIVERED', paymentStatus: null, subscriptionId: null });
  });

  describe('cycle siparişleri (createForCycle · createDeltaForCycle)', () => {
    let subscriptionId = '';
    let cycle2Id = '';
    let cycle1Id = '';
    let checkoutOrderId = '';

    beforeAll(async () => {
      const sub = await t.prisma.subscription.create({
        data: {
          userId: fx.userId,
          tierId: tier.id,
          status: 'ACTIVE',
          frequencyWeeks: 1,
          deliveryDay: 'SALI',
          zoneId: fx.zoneId,
          addressId: fx.addressId,
          itemPrefs: { [p[1]!.slug]: 'L boy' } as Prisma.InputJsonValue,
          discountBoxesLeft: 0,
          startedAt: new Date(),
        },
      });
      subscriptionId = sub.id;
    });

    it('createForCycle: cycle#2 → Order SUBSCRIPTION (BOX satırı tier fiyatı + metadata.items, EXTRA satırı tam TL), grandTotal = quote.total, cycle.orderId bağlı, rezerv YOK; tekrar → 409', async () => {
      const cycle = await t.prisma.subscriptionCycle.create({
        data: {
          subscriptionId,
          cycleNo: 2,
          deliveryDateId: fx.openDateId,
          status: 'SCHEDULED',
          prepaidAmount: 0,
          items: {
            create: [
              { source: 'TEMPLATE', productId: p[0]!.id, qty: 1, unit: p[0]!.unit, label: '1 kg', lotCode: p[0]!.lotCode, sortOrder: 0 },
              { source: 'SWAP', productId: p[1]!.id, swapOfProductId: p[3]!.id, pref: 'L boy', qty: 1, unit: p[1]!.unit, label: '10 adet', sortOrder: 1 },
              { source: 'EXTRA', productId: p[2]!.id, qty: 0.5, unit: 'kg', label: '500 g', unitPrice: p[2]!.price, sortOrder: 2 },
            ],
          },
        },
      });
      cycle2Id = cycle.id;
      const reserveCalls = t.deps.reserve.mock.calls.length;
      const quote = computeCycleCharge({
        boxPrice: tier.price,
        extras: [{ unitPrice: p[2]!.price, factor: 0.5 }],
        isOneTime: false,
        zone: ZONE_RULE,
        firstBoxesLeft: 0,
        retentionPct: null,
        prepaidAmount: 0,
      });
      expect(quote.shippingFee).toBe(0);
      expect(quote.due).toBe(quote.total);

      const { order, lines } = await t.orders.createForCycle(cycle.id, quote, undefined, { vatRate: 1 });
      expect(order.kind).toBe('SUBSCRIPTION');
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.subscriptionId).toBe(subscriptionId);
      expect(order.userId).toBe(fx.userId);
      expect(order.deliveryDateId).toBe(fx.openDateId);
      expect(order.deliveryOn.toISOString().slice(0, 10)).toBe(fx.openDateIso);
      expect(order).toMatchObject({ customerName: fx.address.fullName, customerEmail: fx.email, customerPhone: fx.address.phone, zoneId: fx.zoneId });
      expect(order.addressSnapshot).toEqual(fx.address);
      expect(Number(order.subtotal)).toBe(roundMoney(tier.price + roundExtraPrice(p[2]!.price, 0.5)));
      expect(Number(order.discountTotal)).toBe(0);
      expect(Number(order.shippingFee)).toBe(0);
      expect(Number(order.grandTotal)).toBe(quote.total);
      expect(Number(order.vatTotal)).toBeGreaterThan(0);

      expect(lines).toHaveLength(2);
      const box = lines.find((l) => l.kind === 'BOX')!;
      expect(box).toMatchObject({ tierSlug: tier.slug, name: tier.label, unit: 'kutu', vatRate: 1 });
      expect(Number(box.unitPrice)).toBe(tier.price);
      expect(Number(box.lineTotal)).toBe(tier.price);
      const meta = box.metadata as { items: Array<{ productId: string; slug: string; name: string; pref: string | null; lotCode: string | null }> };
      expect(meta.items.map((i) => i.productId)).toEqual([p[0]!.id, p[1]!.id]);
      expect(meta.items[1]!.pref).toBe('L boy');
      expect(meta.items[0]!.lotCode).toBe(p[0]!.lotCode);
      const extra = lines.find((l) => l.kind === 'EXTRA')!;
      expect(extra).toMatchObject({ productId: p[2]!.id, unit: 'kg' });
      expect(Number(extra.qty)).toBe(0.5);
      expect(Number(extra.unitPrice)).toBe(p[2]!.price);
      expect(Number(extra.lineTotal)).toBe(roundExtraPrice(p[2]!.price, 0.5));

      const linked = await t.prisma.subscriptionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      expect(linked.orderId).toBe(order.id);
      expect(t.deps.reserve.mock.calls.length).toBe(reserveCalls); // kesimde rezerv yok (ensure yaptı)
      await expectHttpError(t.orders.createForCycle(cycle.id, quote), ConflictException, 'CYCLE_ORDER_EXISTS');
      await expectHttpError(t.orders.createForCycle('clyokyokyokyokyokyokyokyo', quote), NotFoundException, 'CYCLE_NOT_FOUND');
    });

    it('createDeltaForCycle: cycle#1 peşin (checkout Order BOX + EXTRA p3) + yeni EXTRA p4 → DELTA Order yalnız p4, grandTotal = due, deltaOrderId bağlı; tekrar 409; due 0 → 400', async () => {
      // Checkout Order (peşin): BOX + EXTRA p3 ×0.5 — abonelik, indirim yok
      const q1 = computeQuote(
        [
          { kind: OrderLineKind.BOX, tierSlug: tier.slug, unitPrice: tier.price, qty: 1, vatRate: 1 },
          { kind: OrderLineKind.EXTRA, productId: p[2]!.id, unitPrice: p[2]!.price, qty: 0.5, vatRate: p[2]!.vatRate },
        ],
        { zone: ZONE_RULE, hasActiveSubscription: false, isSubscriptionCheckout: true, firstBoxesLeft: 0, retentionPct: null, vatRateDefault: 1 },
      );
      expect(q1.orderKind).toBe(OrderKind.SUBSCRIPTION);
      expect(q1.shippingFee).toBe(0);
      const checkout = await t.orders.createFromQuote({
        quote: q1,
        lines: snapshotLines(q1, products, tier.label),
        userId: fx.userId,
        subscriptionId,
        customer: { name: fx.address.fullName, email: fx.email, phone: fx.address.phone },
        address: fx.address,
        deliveryDateId: fx.soonDateId,
      });
      checkoutOrderId = checkout.order.id;
      const cycle = await t.prisma.subscriptionCycle.create({
        data: {
          subscriptionId,
          cycleNo: 1,
          deliveryDateId: fx.soonDateId,
          status: 'SCHEDULED',
          prepaidAmount: q1.prepaidAmount ?? 0,
          orderId: checkout.order.id,
          items: {
            create: [
              { source: 'TEMPLATE', productId: p[0]!.id, qty: 1, sortOrder: 0 },
              { source: 'TEMPLATE', productId: p[1]!.id, qty: 1, sortOrder: 1 },
              { source: 'EXTRA', productId: p[2]!.id, qty: 0.5, unit: 'kg', unitPrice: p[2]!.price, sortOrder: 2 },
              { source: 'CART_MERGE', productId: p[3]!.id, qty: 2, unit: p[3]!.unit, unitPrice: p[3]!.price, sortOrder: 3 },
            ],
          },
        },
      });
      cycle1Id = cycle.id;
      const quote = computeCycleCharge({
        boxPrice: tier.price,
        extras: [
          { unitPrice: p[2]!.price, factor: 0.5 },
          { unitPrice: p[3]!.price, factor: 2 },
        ],
        isOneTime: false,
        zone: ZONE_RULE,
        firstBoxesLeft: 0,
        retentionPct: null,
        prepaidAmount: q1.prepaidAmount ?? 0,
      });
      const expectedDue = roundExtraPrice(p[3]!.price, 2);
      expect(quote.due).toBe(expectedDue);

      const { order, lines } = await t.orders.createDeltaForCycle(cycle.id, quote);
      expect(order.kind).toBe('SUBSCRIPTION');
      expect(order.subscriptionId).toBe(subscriptionId);
      expect(order.deliveryDateId).toBe(fx.soonDateId);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ kind: 'EXTRA', productId: p[3]!.id });
      expect(Number(lines[0]!.qty)).toBe(2);
      expect(Number(lines[0]!.lineTotal)).toBe(expectedDue);
      expect(Number(order.subtotal)).toBe(expectedDue);
      expect(Number(order.grandTotal)).toBe(expectedDue);
      expect(Number(order.discountTotal)).toBe(0);
      expect(Number(order.shippingFee)).toBe(0);
      expect(order.note).toContain('DELTA');
      const linked = await t.prisma.subscriptionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      expect(linked.deltaOrderId).toBe(order.id);
      expect(linked.orderId).toBe(checkoutOrderId);

      await expectHttpError(t.orders.createDeltaForCycle(cycle.id, quote), ConflictException, 'CYCLE_DELTA_EXISTS');
      // cycle#2: orderId dolu (createForCycle bağladı), deltaOrderId boş, due 0 → 400
      await expectHttpError(t.orders.createDeltaForCycle(cycle2Id, { ...quote, due: 0 }), BadRequestException, 'DELTA_NOTHING_DUE');
      // cycle#1 için createForCycle → 409 (orderId dolu)
      await expectHttpError(t.orders.createForCycle(cycle1Id, quote), ConflictException, 'CYCLE_ORDER_EXISTS');
    });

    it('createDeltaForCycle: orderId olmayan cycle (peşin Order yok) → 409 CYCLE_ORDER_MISSING', async () => {
      const quoteZero = computeCycleCharge({ boxPrice: tier.price, extras: [], isOneTime: false, zone: ZONE_RULE, firstBoxesLeft: 0, retentionPct: null, prepaidAmount: 0 });
      expect(quoteZero.due).toBe(quoteZero.total);
      const other = await t.prisma.subscriptionCycle.create({
        data: { subscriptionId, cycleNo: 3, deliveryDateId: fx.openDateId, status: 'SCHEDULED', prepaidAmount: 0 },
      });
      await expectHttpError(t.orders.createDeltaForCycle(other.id, quoteZero), ConflictException, 'CYCLE_ORDER_MISSING');
      expect(checkoutOrderId).not.toBe('');
    });
  });
});
