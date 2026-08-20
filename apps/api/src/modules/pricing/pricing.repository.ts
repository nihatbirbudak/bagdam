import { Injectable } from '@nestjs/common';
import { Prisma, type DeliveryZone, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type ZoneRecord = DeliveryZone;

/** Canlı abonelik durumları — kargo "abone" kuralı ve "tek abonelik" bağlamı (state-machines §2: motorun işlediği durumlar). */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'CANCEL_REQUESTED'];

/** Kullanıcının fiyatlamayı etkileyen alanları (ADR-0007 "üye başına 1 kez"). */
export interface UserPromoState {
  id: string;
  firstBoxesPromoUsedAt: Date | null;
  retentionOfferUsedAt: Date | null;
}

/** Canlı aboneliğin fiyatlamayı etkileyen alanları. */
export interface LiveSubscriptionState {
  id: string;
  status: SubscriptionStatus;
  discountBoxesLeft: number;
  nextBoxDiscountPct: number | null;
}

/** Cycle kilit fiyatlaması için gereken kayıt: abonelik (tier + bölge) + öğeler (ürün fiyatı). */
export const CYCLE_CHARGE_INCLUDE = {
  subscription: { include: { tier: { select: { id: true, slug: true, price: true } }, zone: true } },
  items: { include: { product: { select: { id: true, slug: true, price: true } } }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.SubscriptionCycleInclude;
export type CycleChargeRecord = Prisma.SubscriptionCycleGetPayload<{ include: typeof CYCLE_CHARGE_INCLUDE }>;

/**
 * PricingRepository — fiyatlama için salt okunur sorgular; Prisma YALNIZ burada (ADR-0002).
 * Zaman: ham SQL yok; tüm karşılaştırmalar çağıranın verdiği Date ile (ADR-0004).
 */
@Injectable()
export class PricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveZoneById(id: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findFirst({ where: { id, isActive: true } });
  }

  findActiveZoneBySlug(slug: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findFirst({ where: { slug, isActive: true } });
  }

  findZoneById(id: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findUnique({ where: { id } });
  }

  findZoneBySlug(slug: string): Promise<ZoneRecord | null> {
    return this.prisma.deliveryZone.findUnique({ where: { slug } });
  }

  findUserPromoState(userId: string): Promise<UserPromoState | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstBoxesPromoUsedAt: true, retentionOfferUsedAt: true },
    });
  }

  /** Kullanıcının canlı aboneliği (ACTIVE | PAST_DUE | CANCEL_REQUESTED) — en yenisi. */
  findLiveSubscription(userId: string): Promise<LiveSubscriptionState | null> {
    return this.prisma.subscription.findFirst({
      where: { userId, status: { in: [...LIVE_SUBSCRIPTION_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, discountBoxesLeft: true, nextBoxDiscountPct: true },
    });
  }

  findCycleForCharge(cycleId: string): Promise<CycleChargeRecord | null> {
    return this.prisma.subscriptionCycle.findUnique({ where: { id: cycleId }, include: CYCLE_CHARGE_INCLUDE });
  }
}
