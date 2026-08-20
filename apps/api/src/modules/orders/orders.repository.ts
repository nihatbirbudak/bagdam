import { Injectable } from '@nestjs/common';
import { Prisma, type DeliveryDate, type OrderLine, type SubEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { OrderListFilter, Tx } from './orders.types';

// ── Include şekilleri (tek yerde; mapper bunlara göre tiplenir) ──────────────

/** Detay: satırlar (ekleniş sırası ≈ id), ödemeler (yeni → eski), teslimat tarihi (kesim/durum), bölge, satır sayısı. */
export const ORDER_DETAIL_INCLUDE = {
  lines: { orderBy: { id: 'asc' } },
  payments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  deliveryDate: { select: { id: true, cutoffAt: true, status: true, date: true } },
  zone: { select: { id: true, name: true, slug: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.OrderInclude;
export type OrderRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;
export type OrderLineRecord = OrderLine;
export type OrderPaymentRecord = OrderRecord['payments'][number];

/** Liste/CSV satırı: bölge adı + satır sayısı (satırların kendisi çekilmez). */
export const ORDER_SUMMARY_INCLUDE = {
  zone: { select: { name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.OrderInclude;
export type OrderSummaryRecord = Prisma.OrderGetPayload<{ include: typeof ORDER_SUMMARY_INCLUDE }>;

/** Cycle'dan Order üretimi için gereken her şey (C'nin include şekline bağımlı olmamak için burada yüklenir). */
export const CYCLE_FOR_ORDER_INCLUDE = {
  subscription: {
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      tier: { select: { id: true, slug: true, label: true, price: true } },
      address: { include: { zone: { select: { name: true } } } },
      zone: { select: { id: true, name: true } },
    },
  },
  deliveryDate: true,
  items: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      product: { select: { id: true, slug: true, name: true, unit: true, price: true, vatRate: true, boxAmount: true } },
      lot: { select: { lotCode: true } },
    },
  },
  /** cycle#1 checkout Order'ı (DELTA: peşin ödenmiş EXTRA satırlarını ayıklamak için). */
  order: { include: { lines: true } },
} satisfies Prisma.SubscriptionCycleInclude;
export type CycleForOrderRecord = Prisma.SubscriptionCycleGetPayload<{ include: typeof CYCLE_FOR_ORDER_INCLUDE }>;

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export interface SubscriptionEventInput {
  subscriptionId: string;
  cycleId: string | null;
  type: SubEventType;
  actor: string;
  data: Prisma.InputJsonValue;
}

/**
 * OrdersRepository — Order/OrderLine (+ DeliveryDate rezerv/iade SQL'i, cycle okuma/bağlama, SubscriptionEvent yazımı);
 * Prisma YALNIZ burada (ADR-0002). Her yazma `tx?` alır (F8 checkout / C lock-and-charge kendi işlemine katar).
 * Zaman: ham SQL'de now() yok; rezerv/iade yalnız sayaç günceller (ADR-0004).
 */
@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Verilen tx varsa onun içinde; yoksa yeni interaktif işlem (15 s). */
  runInTransaction<T>(fn: (tx: Tx) => Promise<T>, tx?: Tx): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  private db(tx?: Tx): Tx | PrismaService {
    return tx ?? this.prisma;
  }

  // ── DeliveryDate ─────────────────────────────────────────────────────────────

  findDeliveryDate(id: string, tx?: Tx): Promise<DeliveryDate | null> {
    return this.db(tx).deliveryDate.findUnique({ where: { id } });
  }

  /** Atomik rezerv — etkilenen satır sayısı (0 → dolu/kapalı). B1 DeliveryDatesService.reserve ile aynı SQL (ADR-0005). */
  reserveDeliveryDate(id: string, tx?: Tx): Promise<number> {
    return this.db(tx).$executeRaw`UPDATE delivery_dates SET reserved = reserved + 1 WHERE id = ${id} AND reserved < capacity AND status = 'OPEN'`;
  }

  /** İade — negatife düşmez. */
  releaseDeliveryDate(id: string, tx?: Tx): Promise<number> {
    return this.db(tx).$executeRaw`UPDATE delivery_dates SET reserved = GREATEST(reserved - 1, 0) WHERE id = ${id}`;
  }

  // ── Order yazma ──────────────────────────────────────────────────────────────

  createOrder(data: Prisma.OrderUncheckedCreateInput, lines: Prisma.OrderLineCreateManyOrderInput[], tx?: Tx): Promise<OrderRecord> {
    return this.db(tx).order.create({
      data: { ...data, lines: { createMany: { data: lines } } },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  /** Durum güncellemesi yalnız `status = from` ise (iyimser kilit) → etkilenen satır (0 = arada değişmiş). */
  async updateStatusIf(id: string, from: string, data: Prisma.OrderUpdateManyMutationInput, tx?: Tx): Promise<number> {
    const result = await this.db(tx).order.updateMany({
      where: { id, status: from as Prisma.EnumOrderStatusFilter['equals'], deletedAt: null },
      data,
    });
    return result.count;
  }

  update(id: string, data: Prisma.OrderUpdateInput, tx?: Tx): Promise<OrderRecord> {
    return this.db(tx).order.update({ where: { id }, data, include: ORDER_DETAIL_INCLUDE });
  }

  // ── Order okuma ──────────────────────────────────────────────────────────────

  findById(id: string, tx?: Tx): Promise<OrderRecord | null> {
    return this.db(tx).order.findFirst({ where: { id, deletedAt: null }, include: ORDER_DETAIL_INCLUDE });
  }

  findByOrderNo(orderNo: number, tx?: Tx): Promise<OrderRecord | null> {
    return this.db(tx).order.findFirst({ where: { orderNo, deletedAt: null }, include: ORDER_DETAIL_INCLUDE });
  }

  findForUser(userId: string, orderNo: number, tx?: Tx): Promise<OrderRecord | null> {
    return this.db(tx).order.findFirst({ where: { orderNo, userId, deletedAt: null }, include: ORDER_DETAIL_INCLUDE });
  }

  async list(filter: OrderListFilter, skip: number, take: number): Promise<ListResult<OrderSummaryRecord>> {
    const where = buildOrderWhere(filter);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take, include: ORDER_SUMMARY_INCLUDE }),
      this.prisma.order.count({ where }),
    ]);
    return { rows, total };
  }

  /** CSV: sayfalama yok, üst sınır `take`; eski → yeni (muhasebe sırası). */
  listForExport(filter: OrderListFilter, take: number): Promise<OrderSummaryRecord[]> {
    return this.prisma.order.findMany({
      where: buildOrderWhere(filter),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      include: ORDER_SUMMARY_INCLUDE,
    });
  }

  // ── Cycle (C'nin tablosu — yalnız okuma + orderId/deltaOrderId bağlama) ─────

  findCycleForOrder(cycleId: string, tx?: Tx): Promise<CycleForOrderRecord | null> {
    return this.db(tx).subscriptionCycle.findUnique({ where: { id: cycleId }, include: CYCLE_FOR_ORDER_INCLUDE });
  }

  linkCycleOrder(cycleId: string, link: { orderId?: string; deltaOrderId?: string }, tx?: Tx): Promise<void> {
    return this.db(tx)
      .subscriptionCycle.update({ where: { id: cycleId }, data: link, select: { id: true } })
      .then(() => undefined);
  }

  createSubscriptionEvent(input: SubscriptionEventInput, tx?: Tx): Promise<void> {
    return this.db(tx)
      .subscriptionEvent.create({ data: input, select: { id: true } })
      .then(() => undefined);
  }
}

/** Filtre → Prisma where (liste ve CSV aynı kuralı kullanır). */
export function buildOrderWhere(filter: OrderListFilter): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { deletedAt: null };
  if (filter.status) where.status = filter.status as Prisma.EnumOrderStatusFilter['equals'];
  if (filter.kind) where.kind = filter.kind as Prisma.EnumOrderKindFilter['equals'];
  if (filter.userId) where.userId = filter.userId;
  if (filter.createdFrom || filter.createdToExclusive) {
    where.createdAt = {
      ...(filter.createdFrom ? { gte: filter.createdFrom } : {}),
      ...(filter.createdToExclusive ? { lt: filter.createdToExclusive } : {}),
    };
  }
  if (filter.deliveryOn) where.deliveryOn = filter.deliveryOn;
  const q = filter.q?.trim();
  if (q) {
    const numeric = /^#?(\d{1,12})$/.exec(q);
    if (numeric) {
      where.orderNo = Number(numeric[1]);
    } else {
      where.OR = [
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerEmail: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q } },
      ];
    }
  }
  return where;
}
