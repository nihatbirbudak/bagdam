import { Injectable } from '@nestjs/common';
import { utcToIsoDate, type PaymentIssueCounts, type PaymentIssueItem, type PaymentIssueList } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { webUrl } from '../mail/mail.constants';
import type { PaymentIssuesQueryDto } from './dto/payment-issues-query.dto';
import { PaymentsRepository, type PaymentIssueCycleRecord, type PaymentIssueOrderRecord } from './payments.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;

/** Ödeme sorunlu cycle durumları (ekran 18 sol sütun). */
const PROBLEM_CYCLE_STATUSES = ['UNPAID', 'AWAITING_PAYMENT'] as const;

/** Ödeme linki URL'si (müşteriye gönderilen) — `GET /api/v1/pay/:linkToken` ile aynı adres. */
function linkUrl(token: string | null): string | null {
  return token ? webUrl() + '/api/v1/pay/' + token : null;
}

const money = (d: Prisma.Decimal | null | undefined): number => (d ? Number(d.toString()) : 0);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * PaymentIssuesService (F9 — ekran 18 "Ödeme Problemleri"): iki kaynağı tek listede birleştirir
 *  - `PAYMENT_FAILED` siparişler (checkout / DELTA — müşteri ödeyemedi),
 *  - `UNPAID` / `AWAITING_PAYMENT` abonelik cycle'ları (dunning: yeniden çekim ya da ödeme linki bekleyenler).
 * Eylemler ayrı uçlarda: `POST /admin/cycles/:id/charge` (yeniden çek) · `POST /admin/cycles/:id/send-payment-link`
 * (ödeme linki gönder) · `POST /admin/orders/:id/notes` (müşteriye not) — bu servis YALNIZ okur.
 * Prisma yalnız PaymentsRepository'de; PayTR/iyzico dosyalarına dokunmaz.
 */
@Injectable()
export class PaymentIssuesService {
  constructor(private readonly repo: PaymentsRepository) {}

  async list(query: PaymentIssuesQueryDto): Promise<PaymentIssueList> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const orderWhere = this.orderWhere(query.q);
    const cycleWhere = this.cycleWhere(query.q);

    const [failedOrders, unpaidCycles, awaitingPaymentCycles] = await Promise.all([
      this.repo.countFailedOrders(orderWhere),
      this.repo.countProblemCycles({ ...cycleWhere, status: 'UNPAID' }),
      this.repo.countProblemCycles({ ...cycleWhere, status: 'AWAITING_PAYMENT' }),
    ]);
    const counts: PaymentIssueCounts = { failedOrders, unpaidCycles, awaitingPaymentCycles, total: failedOrders + unpaidCycles + awaitingPaymentCycles };

    // Birleşik liste: iki kaynak da tam çekilir, tek dizide sıralanır, sonra sayfalanır. Ekran 18 gün içinde
    // onlarca satır görür (sorunlu ödeme az sayıdadır) — üst sınır yine de sayfa boyutunun 20 katı.
    const cap = limit * 20;
    const wantOrders = query.kind !== 'CYCLE';
    const wantCycles = query.kind !== 'ORDER';
    const [orders, cycles] = await Promise.all([
      wantOrders ? this.repo.findFailedOrders(orderWhere, 0, cap) : Promise.resolve([]),
      wantCycles ? this.repo.findProblemCycles(cycleWhere, 0, cap) : Promise.resolve([]),
    ]);

    const items = [...orders.map((o) => toOrderIssue(o)), ...cycles.map((c) => toCycleIssue(c))].sort(
      (a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso),
    );
    const total = (wantOrders ? failedOrders : 0) + (wantCycles ? unpaidCycles + awaitingPaymentCycles : 0);
    return { items: items.slice((page - 1) * limit, page * limit), total, page, limit, counts };
  }

  private orderWhere(q?: string): Prisma.OrderWhereInput {
    const base: Prisma.OrderWhereInput = { status: 'PAYMENT_FAILED', deletedAt: null };
    if (!q) return base;
    const orderNo = /^\d+$/.test(q) ? Number(q) : null;
    return {
      ...base,
      OR: [
        ...(orderNo !== null ? [{ orderNo }] : []),
        { customerName: { contains: q, mode: 'insensitive' as const } },
        { customerEmail: { contains: q, mode: 'insensitive' as const } },
        { customerPhone: { contains: q } },
      ],
    };
  }

  private cycleWhere(q?: string): Prisma.SubscriptionCycleWhereInput {
    const base: Prisma.SubscriptionCycleWhereInput = { status: { in: [...PROBLEM_CYCLE_STATUSES] } };
    if (!q) return base;
    const orderNo = /^\d+$/.test(q) ? Number(q) : null;
    return {
      ...base,
      OR: [
        ...(orderNo !== null ? [{ order: { orderNo } }, { deltaOrder: { orderNo } }] : []),
        { subscription: { user: { email: { contains: q, mode: 'insensitive' as const } } } },
        { subscription: { user: { name: { contains: q, mode: 'insensitive' as const } } } },
        { subscription: { user: { phone: { contains: q } } } },
      ],
    };
  }
}

/** PAYMENT_FAILED sipariş → liste satırı (son başarısız ödeme denemesinin kodu/mesajı ile). */
export function toOrderIssue(order: PaymentIssueOrderRecord): PaymentIssueItem {
  const lastFailed = order.payments.find((p) => p.status === 'FAILED' || p.status === 'EXPIRED') ?? order.payments[0] ?? null;
  const openLink = order.payments.find((p) => p.kind === 'LINK' && (p.status === 'PENDING' || p.status === 'REQUIRES_3DS')) ?? null;
  return {
    kind: 'ORDER',
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    cycleId: null,
    cycleNo: null,
    subscriptionId: order.subscriptionId,
    status: order.status,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    amount: money(order.grandTotal),
    deliveryOn: utcToIsoDate(order.deliveryOn),
    retryCount: Math.max(0, order.payments.length - 1),
    nextRetryAtIso: null,
    paymentDueAtIso: iso(openLink?.linkExpiresAt),
    paymentLinkUrl: linkUrl(openLink?.linkToken ?? null),
    lastFailureCode: lastFailed?.failureCode ?? null,
    lastFailureMessage: lastFailed?.failureMessage ?? null,
    lastAttemptAtIso: iso(lastFailed?.createdAt),
    hasCard: (order.user?.paymentMethods.length ?? 0) > 0,
    subscriptionStatus: order.subscription?.status ?? null,
    failedCycles: order.subscription?.failedCycles ?? 0,
    createdAtIso: order.createdAt.toISOString(),
  };
}

/** UNPAID / AWAITING_PAYMENT cycle → liste satırı (dunning sayaçları + açık ödeme linki). */
export function toCycleIssue(cycle: PaymentIssueCycleRecord): PaymentIssueItem {
  // cycle#1'de tahsil edilecek tutar DELTA siparişindedir (peşin ödenen ana siparişte değil) — ADR-0006.
  const orderRef = cycle.cycleNo === 1 && cycle.deltaOrder ? cycle.deltaOrder : cycle.order;
  const payments = orderRef?.payments ?? [];
  const lastFailed = payments.find((p) => p.status === 'FAILED' || p.status === 'EXPIRED') ?? payments[0] ?? null;
  const openLink = payments.find((p) => p.kind === 'LINK' && (p.status === 'PENDING' || p.status === 'REQUIRES_3DS')) ?? null;
  const user = cycle.subscription.user;
  return {
    kind: 'CYCLE',
    id: cycle.id,
    orderId: orderRef?.id ?? null,
    orderNo: orderRef?.orderNo ?? null,
    cycleId: cycle.id,
    cycleNo: cycle.cycleNo,
    subscriptionId: cycle.subscriptionId,
    status: cycle.status,
    customerName: orderRef?.customerName ?? user.name ?? user.email,
    customerEmail: orderRef?.customerEmail ?? user.email,
    customerPhone: orderRef?.customerPhone ?? user.phone ?? '',
    amount: money(orderRef?.grandTotal ?? cycle.total),
    deliveryOn: utcToIsoDate(cycle.deliveryDate.date),
    retryCount: cycle.retryCount,
    nextRetryAtIso: iso(cycle.nextRetryAt),
    paymentDueAtIso: iso(cycle.paymentDueAt ?? openLink?.linkExpiresAt),
    paymentLinkUrl: linkUrl(openLink?.linkToken ?? null),
    lastFailureCode: lastFailed?.failureCode ?? null,
    lastFailureMessage: lastFailed?.failureMessage ?? null,
    lastAttemptAtIso: iso(lastFailed?.createdAt),
    hasCard: cycle.subscription.paymentMethodId !== null,
    subscriptionStatus: cycle.subscription.status,
    failedCycles: cycle.subscription.failedCycles,
    createdAtIso: (cycle.lockedAt ?? cycle.deliveryDate.cutoffAt).toISOString(),
  };
}
