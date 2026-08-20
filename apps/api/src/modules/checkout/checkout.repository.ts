import { Injectable } from '@nestjs/common';
import { Prisma, type DeliveryDate, type DeliveryZone, type LegalDocument } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** İşlem istemcisi — checkout `$transaction`; alt servisler (Orders/Subscriptions/Payments/Coupons) aynı `tx`'i alır. */
export type Tx = Prisma.TransactionClient;

export const CHECKOUT_PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  unit: true,
  price: true,
  vatRate: true,
  boxAmount: true,
  prefLabel: true,
  prefOptions: true,
  prefDefault: true,
  extraOptions: true,
  isFresh: true,
  status: true,
  stockStatus: true,
  deletedAt: true,
  lots: { where: { isCurrent: true }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, lotCode: true } },
} satisfies Prisma.ProductSelect;
export type CheckoutProductRecord = Prisma.ProductGetPayload<{ select: typeof CHECKOUT_PRODUCT_SELECT }>;

export const CHECKOUT_ADDRESS_INCLUDE = { zone: true } satisfies Prisma.AddressInclude;
export type CheckoutAddressRecord = Prisma.AddressGetPayload<{ include: typeof CHECKOUT_ADDRESS_INCLUDE }>;

export const CHECKOUT_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  isActive: true,
  anonymizedAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;
export type CheckoutUserRecord = Prisma.UserGetPayload<{ select: typeof CHECKOUT_USER_SELECT }>;

/** Kullanıcının ödeme bekleyen (PENDING) aboneliği + cycle#1 + checkout Order'ı (eski taslak temizliği için). */
export const PENDING_SUBSCRIPTION_INCLUDE = {
  cycles: { where: { cycleNo: 1 }, select: { id: true, orderId: true, deliveryDateId: true } },
} satisfies Prisma.SubscriptionInclude;
export type PendingSubscriptionRecord = Prisma.SubscriptionGetPayload<{ include: typeof PENDING_SUBSCRIPTION_INCLUDE }>;

export type TierRecord = Prisma.BoxTierGetPayload<Record<string, never>>;
export type ZoneRecord = DeliveryZone;
export type DeliveryDateRecord = DeliveryDate;
export type LegalDocumentRecord = LegalDocument;

export interface ConsentRowInput {
  userId: string;
  orderId: string;
  kind: 'PREINFO_ACK' | 'CONTRACT_ACK' | 'SUBSCRIPTION_CONTRACT_ACK';
  documentId: string;
  source: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * CheckoutRepository — checkout'un okuduğu komşu tablolar (User/Address/Zone/Product/Tier/DeliveryDate/LegalDocument/Subscription)
 * + Consent yazımı + cycle#1.orderId bağlama; Prisma YALNIZ burada (ADR-0002). Order/Payment/Subscription yazımları ilgili
 * modüllerin servisleri üzerinden (OrdersService/PaymentsService/SubscriptionsService/CouponsService) aynı `tx` ile.
 * Zaman: ham SQL yok; `now` çağırandan (ADR-0004).
 */
@Injectable()
export class CheckoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx | PrismaService {
    return tx ?? this.prisma;
  }

  /** Checkout işlemi (interaktif; sağlayıcı çağrısı DIŞARIDA — kilitler kısa). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
  }

  // ── Kullanıcı / adres / bölge ─────────────────────────────────────────────────────────────────────────────────────

  findUserById(id: string, tx?: Tx): Promise<CheckoutUserRecord | null> {
    return this.db(tx).user.findUnique({ where: { id }, select: CHECKOUT_USER_SELECT });
  }

  findAddressForUser(addressId: string, userId: string, tx?: Tx): Promise<CheckoutAddressRecord | null> {
    return this.db(tx).address.findFirst({ where: { id: addressId, userId, deletedAt: null }, include: CHECKOUT_ADDRESS_INCLUDE });
  }

  findDefaultAddressForUser(userId: string, tx?: Tx): Promise<CheckoutAddressRecord | null> {
    return this.db(tx).address.findFirst({ where: { userId, deletedAt: null, isDefault: true }, orderBy: { createdAt: 'desc' }, include: CHECKOUT_ADDRESS_INCLUDE });
  }

  findActiveZoneBySlug(slug: string, tx?: Tx): Promise<ZoneRecord | null> {
    return this.db(tx).deliveryZone.findFirst({ where: { slug, isActive: true } });
  }

  findActiveZoneById(id: string, tx?: Tx): Promise<ZoneRecord | null> {
    return this.db(tx).deliveryZone.findFirst({ where: { id, isActive: true } });
  }

  findFirstActiveZone(tx?: Tx): Promise<ZoneRecord | null> {
    return this.db(tx).deliveryZone.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  // ── Katalog ───────────────────────────────────────────────────────────────────────────────────────────────────────

  findProductsBySlugs(slugs: readonly string[], tx?: Tx): Promise<CheckoutProductRecord[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.db(tx).product.findMany({ where: { slug: { in: [...slugs] } }, select: CHECKOUT_PRODUCT_SELECT });
  }

  findTierBySlug(slug: string, tx?: Tx): Promise<TierRecord | null> {
    return this.db(tx).boxTier.findUnique({ where: { slug } });
  }

  // ── Teslimat tarihi / yasal ───────────────────────────────────────────────────────────────────────────────────────

  findDeliveryDateById(id: string, tx?: Tx): Promise<DeliveryDateRecord | null> {
    return this.db(tx).deliveryDate.findUnique({ where: { id } });
  }

  /** Yayındaki (isCurrent) ve onay gerektiren yasal belgeler. */
  findCurrentAckDocuments(tx?: Tx): Promise<LegalDocumentRecord[]> {
    return this.db(tx).legalDocument.findMany({ where: { isCurrent: true, requiresAck: true }, orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  // ── Abonelik (yalnız okuma + cycle#1 bağlama) ─────────────────────────────────────────────────────────────────────

  /** Kullanıcının ödeme bekleyen aboneliği (checkout'tan kalmış taslak) — en yenisi. */
  findPendingSubscriptionForUser(userId: string, tx?: Tx): Promise<PendingSubscriptionRecord | null> {
    return this.db(tx).subscription.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: PENDING_SUBSCRIPTION_INCLUDE,
    });
  }

  /** cycle#1 → checkout Order'ı (createFromCheckout'ta orderId henüz yok). */
  async linkCycleOrder(cycleId: string, orderId: string, tx?: Tx): Promise<void> {
    await this.db(tx).subscriptionCycle.update({ where: { id: cycleId }, data: { orderId }, select: { id: true } });
  }

  // ── Consent ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async createConsents(rows: readonly ConsentRowInput[], tx?: Tx): Promise<number> {
    if (rows.length === 0) return 0;
    const r = await this.db(tx).consent.createMany({
      data: rows.map((c) => ({
        userId: c.userId,
        orderId: c.orderId,
        kind: c.kind,
        documentId: c.documentId,
        granted: true,
        source: c.source,
        ipAddress: c.ipAddress,
        userAgent: c.userAgent,
      })),
    });
    return r.count;
  }
}
