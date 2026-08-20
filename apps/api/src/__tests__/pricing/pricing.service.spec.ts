// F7 — PricingService (gerçek Nest modülü, gerçek DB bagdam_dev). Kapsam: quote kuralları Setting'den (freeShippingRule gte/gt,
// discountRounding kurus/tl, subscriberFreeShipping), zone fee/eşik, kullanıcı bağlamı (ilk-kutu hakkı, canlı abone), skip, hata kodları;
// cycleCharge (cycleId ile DB'den ve açık biçim). Test verisi: `test-pz-<run>` bölgeleri + kullanıcılar + abonelik/cycle; sonda silinir.
// Değiştirilen Setting anahtarları başta okunur, sonda geri yazılır. Zamanla ilgili değerler UTC anları (TZ'den bağımsız).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import {
  computeCutoffAt,
  DEFAULT_TZ,
  nextDeliveryDateFor,
  isoDateToUtc,
  roundExtraPrice,
  type CommerceSettings,
  type PricingLineInput,
} from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { PricingModule } from '../../modules/pricing/pricing.module';
import { PricingService } from '../../modules/pricing/pricing.service';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const ZONE_SLUG = `test-pz-${RUN}`;
const ZONE2_SLUG = `test-pz2-${RUN}`;
const RULE_KEYS = ['freeShippingRule', 'discountRounding', 'subscriberFreeShipping'] as const;

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));
const money = (d: Prisma.Decimal) => Number(d.toString());

describe('PricingService — quote (Setting kuralları · zone · kullanıcı bağlamı) ve cycleCharge', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let pricing: PricingService;
  let settings: SettingsService;
  let original: Pick<CommerceSettings, (typeof RULE_KEYS)[number]>;
  let commerce: CommerceSettings;
  let zoneId: string;
  let zone2Id: string;
  let userFreshId: string;
  let userPromoUsedId: string;
  let userSubscriberId: string;
  let tier: { id: string; slug: string; price: number };
  let product: { id: string; slug: string; price: number };
  let subscriptionId: string;
  let deliveryDateId: string;
  let cycleId: string;

  const setRules = async (patch: Partial<Record<(typeof RULE_KEYS)[number], unknown>>) => {
    await settings.set('commerce', patch);
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, SettingsModule, PricingModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    pricing = moduleRef.get(PricingService);
    settings = moduleRef.get(SettingsService);
    commerce = await settings.getCommerce();
    original = {
      freeShippingRule: commerce.freeShippingRule,
      discountRounding: commerce.discountRounding,
      subscriberFreeShipping: commerce.subscriberFreeShipping,
    };
    // Testler varsayılan kurallarla başlar (gte / kurus / true)
    await setRules({ freeShippingRule: 'gte', discountRounding: 'kurus', subscriberFreeShipping: true });

    const z1 = await prisma.deliveryZone.create({
      data: { name: 'Pricing Test', slug: ZONE_SLUG, fee: dec(49), freeThreshold: dec(1000), capacityPerDay: 999, isActive: true, sortOrder: 990 },
    });
    zoneId = z1.id;
    const z2 = await prisma.deliveryZone.create({
      data: { name: 'Pricing Test 2', slug: ZONE2_SLUG, fee: dec(59.5), freeThreshold: dec(1500), capacityPerDay: 999, isActive: true, sortOrder: 991 },
    });
    zone2Id = z2.id;

    const u1 = await prisma.user.create({ data: { email: `pricing-fresh-${RUN}@test.local`, passwordHash: 'x', name: 'Fresh' } });
    userFreshId = u1.id;
    const u2 = await prisma.user.create({
      data: { email: `pricing-used-${RUN}@test.local`, passwordHash: 'x', name: 'Used', firstBoxesPromoUsedAt: new Date('2026-01-01T00:00:00Z') },
    });
    userPromoUsedId = u2.id;
    const u3 = await prisma.user.create({ data: { email: `pricing-sub-${RUN}@test.local`, passwordHash: 'x', name: 'Subscriber' } });
    userSubscriberId = u3.id;

    const tierRow = await prisma.boxTier.findFirstOrThrow({ where: { isActive: true }, orderBy: { price: 'asc' } });
    tier = { id: tierRow.id, slug: tierRow.slug, price: money(tierRow.price) };
    const productRow = await prisma.product.findFirstOrThrow({ where: { status: 'ACTIVE', deletedAt: null }, orderBy: { sortOrder: 'asc' } });
    product = { id: productRow.id, slug: productRow.slug, price: money(productRow.price) };

    // Canlı abonelik (ACTIVE) + cycle#2 (SCHEDULED) + öğeler: TEMPLATE + EXTRA(qty 0.5)
    const slot = nextDeliveryDateFor('SALI', new Date(), { tz: DEFAULT_TZ, rule: commerce.cutoff });
    const dd = await prisma.deliveryDate.create({
      data: { zoneId, day: 'SALI', date: isoDateToUtc(slot.date), cutoffAt: computeCutoffAt(slot.date, commerce.cutoff, DEFAULT_TZ), capacity: 999, reserved: 0, status: 'OPEN' },
    });
    deliveryDateId = dd.id;
    const sub = await prisma.subscription.create({
      data: {
        userId: userSubscriberId,
        tierId: tier.id,
        status: 'ACTIVE',
        frequencyWeeks: 1,
        deliveryDay: 'SALI',
        zoneId,
        chargeStrategy: 'MERCHANT_INITIATED',
        discountBoxesLeft: 2,
        startedAt: new Date(),
      },
    });
    subscriptionId = sub.id;
    const cycle = await prisma.subscriptionCycle.create({
      data: {
        subscriptionId,
        cycleNo: 2,
        deliveryDateId,
        status: 'SCHEDULED',
        prepaidAmount: dec(0),
        items: {
          create: [
            { source: 'TEMPLATE', productId: product.id, qty: dec(1), label: 'şablon', sortOrder: 0 },
            { source: 'EXTRA', productId: product.id, qty: new Prisma.Decimal('0.5'), label: 'ekstra', sortOrder: 1 },
          ],
        },
      },
    });
    cycleId = cycle.id;
  });

  afterAll(async () => {
    try {
      await setRules(original);
      if (cycleId) await prisma.subscriptionCycle.deleteMany({ where: { id: cycleId } });
      if (subscriptionId) await prisma.subscription.deleteMany({ where: { id: subscriptionId } });
      if (deliveryDateId) await prisma.deliveryDate.deleteMany({ where: { id: deliveryDateId } });
      await prisma.user.deleteMany({ where: { id: { in: [userFreshId, userPromoUsedId, userSubscriberId].filter(Boolean) } } });
      await prisma.deliveryZone.deleteMany({ where: { slug: { in: [ZONE_SLUG, ZONE2_SLUG] } } });
    } finally {
      await moduleRef?.close();
    }
  });

  const single = (unitPrice: number, qty: number): PricingLineInput => ({ kind: 'PRODUCT', unitPrice, qty, productId: product.id });

  // ── Kargo: eşik kuralı Setting'den (gte / gt) + zone fee/eşik ──────────────────────────────────────────────────────

  it('SINGLE 1000 TL — gte: kargo 0 (eşik ve üzeri) · gt: kargo 49 (eşiği aşmalı) · Setting değişince anında', async () => {
    const gte = await pricing.quote({ lines: [single(500, 2)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false });
    expect(gte.orderKind).toBe('SINGLE');
    expect(gte.subtotal).toBe(1000);
    expect(gte.shippingFee).toBe(0);
    expect(gte.grandTotal).toBe(1000);
    expect(gte.vatTotal).toBe(9.9); // 1000 × 1/101
    expect(gte.prepaidAmount).toBeNull();
    expect(gte.notes.some((n) => n.code === 'FREE_SHIPPING_THRESHOLD' && n.message.includes('ve üzeri'))).toBe(true);

    await setRules({ freeShippingRule: 'gt' });
    try {
      const gt = await pricing.quote({ lines: [single(500, 2)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false });
      expect(gt.shippingFee).toBe(49);
      expect(gt.grandTotal).toBe(1049);
      const over = await pricing.quote({ lines: [single(500.5, 2)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false });
      expect(over.shippingFee).toBe(0);
      expect(over.notes.some((n) => n.code === 'FREE_SHIPPING_THRESHOLD' && n.message.includes('üzeri') && !n.message.includes('ve üzeri'))).toBe(true);
    } finally {
      await setRules({ freeShippingRule: 'gte' });
    }
  });

  it('zone fee/eşik yalnız DeliveryZone’dan: 59,5 TL / 1500 eşik → 1200 TL sepette 59,5; 1500’de 0; zoneId ile de aynı', async () => {
    const below = await pricing.quote({ lines: [single(600, 2)], zoneSlug: ZONE2_SLUG, isSubscriptionCheckout: false });
    expect(below.shippingFee).toBe(59.5);
    expect(below.grandTotal).toBe(1259.5);
    const at = await pricing.quote({ lines: [single(750, 2)], zoneId: zone2Id, isSubscriptionCheckout: false });
    expect(at.shippingFee).toBe(0);
  });

  it('bölge zorunlu: yok → 400 ZONE_REQUIRED; bilinmeyen/pasif → 400 ZONE_INVALID', async () => {
    await expect(pricing.quote({ lines: [single(10, 1)], isSubscriptionCheckout: false })).rejects.toMatchObject({
      response: { error: 'ZONE_REQUIRED' },
    });
    await expect(pricing.quote({ lines: [single(10, 1)], zoneSlug: `yok-${RUN}`, isSubscriptionCheckout: false })).rejects.toBeInstanceOf(BadRequestException);
    await prisma.deliveryZone.update({ where: { id: zone2Id }, data: { isActive: false } });
    try {
      await expect(pricing.quote({ lines: [single(10, 1)], zoneId: zone2Id, isSubscriptionCheckout: false })).rejects.toMatchObject({
        response: { error: 'ZONE_INVALID' },
      });
    } finally {
      await prisma.deliveryZone.update({ where: { id: zone2Id }, data: { isActive: true } });
    }
  });

  // ── İlk-2-kutu indirimi: yuvarlama Setting'den (kurus / tl) + üye başına 1 kez ────────────────────────────────────

  it('abonelik checkout (misafir): BOX 649 → %50 → 324,50 (kurus) · tl → 325; EXTRA tam TL; kargo 0; prepaidAmount = kutu kısmı', async () => {
    const lines: PricingLineInput[] = [
      { kind: 'BOX', unitPrice: 649, qty: 1, tierSlug: 'small' },
      { kind: 'EXTRA', unitPrice: 120, qty: 0.5, productId: product.id },
    ];
    const kurus = await pricing.quote({ lines, zoneSlug: ZONE_SLUG, isSubscriptionCheckout: true });
    expect(kurus.orderKind).toBe('SUBSCRIPTION');
    expect(kurus.discountTotal).toBe(324.5);
    expect(kurus.shippingFee).toBe(0);
    expect(kurus.subtotal).toBe(709); // 649 + 60
    expect(kurus.grandTotal).toBe(384.5);
    expect(kurus.prepaidAmount).toBe(384.5);
    expect(kurus.notes.some((n) => n.code === 'FIRST_BOXES_DISCOUNT' && n.amount === 324.5)).toBe(true);
    expect(kurus.notes.some((n) => n.code === 'FREE_SHIPPING_SUBSCRIBER')).toBe(true);

    await setRules({ discountRounding: 'tl' });
    try {
      const tl = await pricing.quote({ lines, zoneSlug: ZONE_SLUG, isSubscriptionCheckout: true });
      expect(tl.discountTotal).toBe(325);
      expect(tl.grandTotal).toBe(384);
    } finally {
      await setRules({ discountRounding: 'kurus' });
    }
  });

  it('ilk-kutu hakkı: taze üye indirim alır; firstBoxesPromoUsedAt dolu üye almaz; context.firstBoxesLeft=0 ile ezilir', async () => {
    const lines: PricingLineInput[] = [{ kind: 'BOX', unitPrice: 649, qty: 1, tierSlug: 'small' }];
    const fresh = await pricing.quote({ lines, zoneSlug: ZONE_SLUG, isSubscriptionCheckout: true, userId: userFreshId });
    expect(fresh.discountTotal).toBe(324.5);
    const used = await pricing.quote({ lines, zoneSlug: ZONE_SLUG, isSubscriptionCheckout: true, userId: userPromoUsedId });
    expect(used.discountTotal).toBe(0);
    expect(used.grandTotal).toBe(649);
    const overridden = await pricing.quote({ lines, zoneSlug: ZONE_SLUG, isSubscriptionCheckout: true, userId: userFreshId, context: { firstBoxesLeft: 0 } });
    expect(overridden.discountTotal).toBe(0);
    const retention = await pricing.quote({ lines, zoneSlug: ZONE_SLUG, isSubscriptionCheckout: true, context: { firstBoxesLeft: 0, retentionPct: 50 } });
    expect(retention.discountTotal).toBe(324.5);
    expect(retention.notes.some((n) => n.code === 'RETENTION_DISCOUNT')).toBe(true);
  });

  it('tek seferlik kutu (isSubscriptionCheckout=false): indirim yok, kargo zone kuralı (649 < 1000 → 49), kind BOX_ONE_TIME', async () => {
    const q = await pricing.quote({ lines: [{ kind: 'BOX', unitPrice: 649, qty: 1, tierSlug: 'small' }], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false });
    expect(q.orderKind).toBe('BOX_ONE_TIME');
    expect(q.discountTotal).toBe(0);
    expect(q.shippingFee).toBe(49);
    expect(q.grandTotal).toBe(698);
    expect(q.notes.some((n) => n.code === 'NO_BOX_DISCOUNT_ONE_TIME')).toBe(true);
  });

  it('skipThisWeek: BOX + EXTRA 0 TL, indirim yok, tekil ürünler kalır', async () => {
    const q = await pricing.quote({
      lines: [{ kind: 'BOX', unitPrice: 649, qty: 1, tierSlug: 'small' }, { kind: 'EXTRA', unitPrice: 120, qty: 1 }, single(100, 1)],
      zoneSlug: ZONE_SLUG,
      isSubscriptionCheckout: true,
      skipThisWeek: true,
    });
    expect(q.subtotal).toBe(100);
    expect(q.discountTotal).toBe(0);
    expect(q.notes.some((n) => n.code === 'SKIPPED_WEEK')).toBe(true);
  });

  // ── Aktif abone: tekil üründe kargo 0 (Setting subscriberFreeShipping) ─────────────────────────────────────────────

  it('canlı aboneliği olan üye SINGLE 100 TL: kargo 0 (subscriberFreeShipping true) · false → zone kuralı 49; misafir → 49', async () => {
    const sub = await pricing.quote({ lines: [single(100, 1)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false, userId: userSubscriberId });
    expect(sub.shippingFee).toBe(0);
    expect(sub.notes.some((n) => n.code === 'FREE_SHIPPING_SUBSCRIBER')).toBe(true);
    const guest = await pricing.quote({ lines: [single(100, 1)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false });
    expect(guest.shippingFee).toBe(49);

    await setRules({ subscriberFreeShipping: false });
    try {
      const off = await pricing.quote({ lines: [single(100, 1)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false, userId: userSubscriberId });
      expect(off.shippingFee).toBe(49);
      // context ile "abone" bilgisi ezilebilir ama kural kapalıyken yine 49
      const forced = await pricing.quote({ lines: [single(100, 1)], zoneSlug: ZONE_SLUG, isSubscriptionCheckout: false, context: { hasActiveSubscription: true } });
      expect(forced.shippingFee).toBe(49);
    } finally {
      await setRules({ subscriberFreeShipping: true });
    }
  });

  // ── cycleCharge ───────────────────────────────────────────────────────────────────────────────────────────────────

  it('cycleCharge({cycleId}): boxPrice = tier fiyatı, extrasTotal = Σ roundExtraPrice, ilk-kutu indirimi (discountBoxesLeft 2), kargo 0, due = total', async () => {
    const q = await pricing.cycleCharge({ cycleId });
    const extras = roundExtraPrice(product.price, 0.5);
    const discount = Math.round(tier.price * 50) / 100; // kurus
    expect(q.boxPrice).toBe(tier.price);
    expect(q.extrasTotal).toBe(extras);
    expect(q.discount).toBe(discount);
    expect(q.discountKind).toBe('FIRST_BOXES');
    expect(q.shippingFee).toBe(0);
    expect(q.total).toBe(Math.round((tier.price + extras - discount) * 100) / 100);
    expect(q.due).toBe(q.total);

    // cycle#1 gibi: prepaidAmount = kutu kısmı → due = yalnız ekstralar (DELTA)
    await prisma.subscriptionCycle.update({ where: { id: cycleId }, data: { prepaidAmount: dec(tier.price - discount) } });
    try {
      const delta = await pricing.cycleCharge({ cycleId });
      expect(delta.due).toBe(extras);
    } finally {
      await prisma.subscriptionCycle.update({ where: { id: cycleId }, data: { prepaidAmount: dec(0) } });
    }

    // Hak bitti + retention → RETENTION; ikisi de yok → 0
    await prisma.subscription.update({ where: { id: subscriptionId }, data: { discountBoxesLeft: 0, nextBoxDiscountPct: 50 } });
    try {
      const ret = await pricing.cycleCharge({ cycleId });
      expect(ret.discountKind).toBe('RETENTION');
      expect(ret.discount).toBe(discount);
      await prisma.subscription.update({ where: { id: subscriptionId }, data: { nextBoxDiscountPct: null } });
      const none = await pricing.cycleCharge({ cycleId });
      expect(none.discount).toBe(0);
      expect(none.discountKind).toBeNull();
    } finally {
      await prisma.subscription.update({ where: { id: subscriptionId }, data: { discountBoxesLeft: 2, nextBoxDiscountPct: null } });
    }
  });

  it('cycleCharge açık biçim: tek seferlik → indirim yok + zone kargosu; abonelik → zone gerekmez, kargo 0; tek seferlikte zone yoksa 400', async () => {
    const oneTime = await pricing.cycleCharge({
      boxPrice: 649,
      extras: [{ unitPrice: 120, factor: 0.5 }],
      isOneTime: true,
      zoneSlug: ZONE_SLUG,
      firstBoxesLeft: 2,
      retentionPct: 50,
      prepaidAmount: 709,
    });
    expect(oneTime).toMatchObject({ boxPrice: 649, extrasTotal: 60, discount: 0, shippingFee: 49, total: 758, due: 49, discountKind: null });

    const sub = await pricing.cycleCharge({ boxPrice: 649, extras: [], isOneTime: false, firstBoxesLeft: 1, retentionPct: null, prepaidAmount: 0 });
    expect(sub).toMatchObject({ boxPrice: 649, extrasTotal: 0, discount: 324.5, shippingFee: 0, total: 324.5, due: 324.5, discountKind: 'FIRST_BOXES' });

    await expect(
      pricing.cycleCharge({ boxPrice: 649, extras: [], isOneTime: true, firstBoxesLeft: 0, retentionPct: null, prepaidAmount: 0 }),
    ).rejects.toMatchObject({ response: { error: 'ZONE_REQUIRED' } });
    await expect(pricing.cycleCharge({ cycleId: `yok-${RUN}` })).rejects.toBeInstanceOf(NotFoundException);
  });
});
