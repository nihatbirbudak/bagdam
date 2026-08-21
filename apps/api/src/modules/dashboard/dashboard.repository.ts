import { Injectable } from '@nestjs/common';
import { Prisma, type OrderStatus, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** Sipariş toplamı (adet + ciro) — `groupBy` yerine tek `aggregate` (Decimal toplamı Prisma'da yapılır). */
export interface OrderTotals {
  count: number;
  revenue: Prisma.Decimal | null;
}

/** Bu haftanın teslimat tarihi + bölgesi + o güne düşen cycle sayısı. */
export const DASHBOARD_DATE_INCLUDE = {
  zone: { select: { slug: true, name: true, sortOrder: true } },
  _count: { select: { cycles: true } },
} satisfies Prisma.DeliveryDateInclude;
export type DashboardDateRecord = Prisma.DeliveryDateGetPayload<{ include: typeof DASHBOARD_DATE_INCLUDE }>;

export const DASHBOARD_EVENT_INCLUDE = {
  subscription: { select: { user: { select: { email: true } } } },
} satisfies Prisma.SubscriptionEventInclude;
export type DashboardEventRecord = Prisma.SubscriptionEventGetPayload<{ include: typeof DASHBOARD_EVENT_INCLUDE }>;

/**
 * DashboardRepository — ekran 21 "Özet" için türetilmiş sayımlar; Prisma YALNIZ burada (ADR-0002).
 * Hiçbir tabloya yazmaz; tüm zaman aralıkları çağırandan gelir (ham SQL'de now() yok — ADR-0004).
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ödemesi alınmış siparişler: `paidAt` aralıkta (adet + grandTotal toplamı). */
  async sumPaidOrders(from: Date, to: Date): Promise<OrderTotals> {
    const res = await this.prisma.order.aggregate({
      where: { paidAt: { gte: from, lt: to }, deletedAt: null, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      _count: { _all: true },
      _sum: { grandTotal: true },
    });
    return { count: res._count._all, revenue: res._sum.grandTotal };
  }

  countOrders(where: Prisma.OrderWhereInput): Promise<number> {
    return this.prisma.order.count({ where });
  }

  /** Teslimat günü verilen tarih olan, ödemesi alınmış siparişler. */
  countOrdersForDelivery(date: Date, statuses: readonly OrderStatus[]): Promise<number> {
    return this.prisma.order.count({ where: { deliveryOn: date, deletedAt: null, status: { in: [...statuses] } } });
  }

  countSubscriptions(where: Prisma.SubscriptionWhereInput): Promise<number> {
    return this.prisma.subscription.count({ where });
  }

  countSubscriptionsByStatus(status: SubscriptionStatus): Promise<number> {
    return this.prisma.subscription.count({ where: { status } });
  }

  /** Hafta aralığındaki teslimat tarihleri (bölge + cycle sayısı ile); tarihe, sonra bölge sırasına göre. */
  findDatesBetween(from: Date, to: Date): Promise<DashboardDateRecord[]> {
    return this.prisma.deliveryDate.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { zone: { sortOrder: 'asc' } }],
      include: DASHBOARD_DATE_INCLUDE,
    });
  }

  countCycles(where: Prisma.SubscriptionCycleWhereInput): Promise<number> {
    return this.prisma.subscriptionCycle.count({ where });
  }

  /** Son abonelik olayları (en yeni önce) — özet ekranının "son olaylar" listesi. */
  findRecentEvents(take: number): Promise<DashboardEventRecord[]> {
    return this.prisma.subscriptionEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: DASHBOARD_EVENT_INCLUDE,
    });
  }
}
