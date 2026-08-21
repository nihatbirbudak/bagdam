import { Injectable } from '@nestjs/common';
import {
  addCalendarDays,
  calendarDateIn,
  DEFAULT_TZ,
  isoDateToUtc,
  ORDER_PAID_STATES,
  roundMoney,
  utcToIsoDate,
  weekdayOf,
  type AdminDashboard,
  type AdminDashboardCutoff,
  type AdminDashboardEvent,
  type IsoDate,
} from '@bagdam/shared';
import type { OrderStatus as PrismaOrderStatus } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { DashboardRepository, type DashboardDateRecord, type OrderTotals } from './dashboard.repository';

/** Özet ekranındaki "son olaylar" satır sayısı. */
export const RECENT_EVENT_COUNT = 12;

/** Takvim gününün haftasının Pazartesi'si (ISO hafta; TZ'siz takvim aritmetiği). */
export function weekStartOf(date: IsoDate): IsoDate {
  return addCalendarDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Takvim gününün Europe/Istanbul'daki 00:00 anı (UTC instant). */
function startOfDay(date: IsoDate): Date {
  return fromZonedTime(date + 'T00:00:00', DEFAULT_TZ);
}

const totalsOf = (t: OrderTotals): { count: number; revenue: number } => ({
  count: t.count,
  revenue: roundMoney(t.revenue ? Number(t.revenue.toString()) : 0),
});

/**
 * DashboardService — `GET /api/v1/admin/dashboard` (ekran 21 "Özet"; BACKEND-PLANI §3 dashboard satırı).
 * Türetilmiş metrikler, hepsi salt okuma:
 *  - siparişler: bugün / bu hafta ödenen sipariş adedi + cirosu (paidAt, Europe/Istanbul gün sınırları),
 *    ödemesi bekleyenler, bugün teslim edilecekler;
 *  - abonelikler: ACTIVE / PAST_DUE / CANCEL_REQUESTED / PENDING, aktif tek seferlik kutular, bu hafta başlayanlar;
 *  - kesim durumu: bu haftanın teslimat tarihleri (bölge × gün) — kapasite/rezerv/kesim geçti mi;
 *  - ödeme problemleri sayacı (ekran 18 ile aynı küme: PAYMENT_FAILED sipariş + UNPAID/AWAITING_PAYMENT cycle);
 *  - son abonelik olayları.
 * Zaman: `now` parametre (ADR-0004); takvim günleri Europe/Istanbul, anlar mutlak ISO.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  async get(now: Date = new Date()): Promise<AdminDashboard> {
    const today = calendarDateIn(now, DEFAULT_TZ);
    const weekStart = weekStartOf(today);
    const weekEnd = addCalendarDays(weekStart, 7);
    const todayUtc = isoDateToUtc(today);

    const [todayTotals, weekTotals, pendingPaymentCount, deliveringTodayCount, active, pastDue, cancelRequested, pending, oneTimeActive, newThisWeek, dates, failedOrders, unpaidCycles, awaitingPaymentCycles, events] =
      await Promise.all([
        this.repo.sumPaidOrders(startOfDay(today), startOfDay(addCalendarDays(today, 1))),
        this.repo.sumPaidOrders(startOfDay(weekStart), startOfDay(weekEnd)),
        this.repo.countOrders({ status: 'PENDING_PAYMENT', deletedAt: null }),
        this.repo.countOrdersForDelivery(todayUtc, ORDER_PAID_STATES as readonly PrismaOrderStatus[]),
        this.repo.countSubscriptionsByStatus('ACTIVE'),
        this.repo.countSubscriptionsByStatus('PAST_DUE'),
        this.repo.countSubscriptionsByStatus('CANCEL_REQUESTED'),
        this.repo.countSubscriptionsByStatus('PENDING'),
        this.repo.countSubscriptions({ isOneTime: true, status: { in: ['ACTIVE', 'PAST_DUE'] } }),
        this.repo.countSubscriptions({ startedAt: { gte: startOfDay(weekStart), lt: startOfDay(weekEnd) } }),
        this.repo.findDatesBetween(isoDateToUtc(weekStart), isoDateToUtc(addCalendarDays(weekStart, 6))),
        this.repo.countOrders({ status: 'PAYMENT_FAILED', deletedAt: null }),
        this.repo.countCycles({ status: 'UNPAID' }),
        this.repo.countCycles({ status: 'AWAITING_PAYMENT' }),
        this.repo.findRecentEvents(RECENT_EVENT_COUNT),
      ]);

    const orderTotalsToday = totalsOf(todayTotals);
    const orderTotalsWeek = totalsOf(weekTotals);

    return {
      serverNowIso: now.toISOString(),
      today,
      weekStart,
      orders: {
        todayCount: orderTotalsToday.count,
        todayRevenue: orderTotalsToday.revenue,
        weekCount: orderTotalsWeek.count,
        weekRevenue: orderTotalsWeek.revenue,
        pendingPaymentCount,
        deliveringTodayCount,
      },
      subscriptions: { active, pastDue, cancelRequested, pending, oneTimeActive, newThisWeek },
      cutoffs: dates.map((d) => toCutoff(d, now)),
      paymentIssues: { failedOrders, unpaidCycles, awaitingPaymentCycles, total: failedOrders + unpaidCycles + awaitingPaymentCycles },
      recentEvents: events.map(
        (e): AdminDashboardEvent => ({
          id: e.id,
          type: e.type,
          actor: e.actor,
          subscriptionId: e.subscriptionId,
          cycleId: e.cycleId,
          userEmail: e.subscription?.user?.email ?? null,
          createdAt: e.createdAt.toISOString(),
        }),
      ),
    };
  }
}

/** DeliveryDate → özet satırı; `locked` = kesim geçti ya da gün OPEN değil (ADR-0007). */
export function toCutoff(row: DashboardDateRecord, now: Date): AdminDashboardCutoff {
  return {
    date: utcToIsoDate(row.date),
    zoneSlug: row.zone.slug,
    zoneName: row.zone.name,
    cutoffAtIso: row.cutoffAt.toISOString(),
    locked: row.cutoffAt.getTime() <= now.getTime() || row.status !== 'OPEN',
    status: row.status,
    capacity: row.capacity,
    reserved: row.reserved,
    cycleCount: row._count.cycles,
  };
}
