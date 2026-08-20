import { Injectable } from '@nestjs/common';
import { Prisma, type Coupon, type CouponRedemption } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** İşlem istemcisi — checkout/orders `$transaction` içinden `tx` ya da PrismaService. */
export type DbClient = Prisma.TransactionClient;

export type CouponRecord = Coupon;
export type CouponRedemptionRecord = CouponRedemption;

/** Kupon detayındaki kullanım satırı: sipariş no/durum + müşteri e-postası. */
export const REDEMPTION_DETAIL_INCLUDE = {
  order: { select: { orderNo: true, status: true } },
  user: { select: { email: true } },
  coupon: { select: { code: true } },
} satisfies Prisma.CouponRedemptionInclude;
export type CouponRedemptionDetailRecord = Prisma.CouponRedemptionGetPayload<{ include: typeof REDEMPTION_DETAIL_INCLUDE }>;

export interface CouponListFilter {
  q?: string;
  active?: boolean;
}

export type CouponCreateData = Prisma.CouponUncheckedCreateInput;
export type CouponUpdateData = Prisma.CouponUncheckedUpdateInput;

/**
 * CouponsRepository — Coupon / CouponRedemption; Prisma YALNIZ burada (ADR-0002).
 * `code` citext: büyük/küçük harf duyarsız benzersiz — `findByCode` DB karşılaştırmasına güvenir (uppercase zorunlu değil).
 * Zaman: ham SQL yok; tarih karşılaştırmaları servis katmanında `now` ile (ADR-0004).
 */
@Injectable()
export class CouponsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: DbClient): DbClient | PrismaService {
    return tx ?? this.prisma;
  }

  // ── Coupon ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Koda göre (silinmemiş) kupon — citext sayesinde `abc` ile `ABC` aynı satır. */
  findByCode(code: string, tx?: DbClient): Promise<CouponRecord | null> {
    return this.db(tx).coupon.findFirst({ where: { code, deletedAt: null } });
  }

  findById(id: string, tx?: DbClient): Promise<CouponRecord | null> {
    return this.db(tx).coupon.findUnique({ where: { id } });
  }

  async list(filter: CouponListFilter, skip: number, take: number): Promise<{ rows: CouponRecord[]; total: number }> {
    const where: Prisma.CouponWhereInput = {
      deletedAt: null,
      ...(filter.active !== undefined ? { isActive: filter.active } : {}),
      ...(filter.q ? { OR: [{ code: { contains: filter.q, mode: 'insensitive' } }, { note: { contains: filter.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.coupon.count({ where }),
    ]);
    return { rows, total };
  }

  create(data: CouponCreateData, tx?: DbClient): Promise<CouponRecord> {
    return this.db(tx).coupon.create({ data });
  }

  update(id: string, data: CouponUpdateData, tx?: DbClient): Promise<CouponRecord> {
    return this.db(tx).coupon.update({ where: { id }, data });
  }

  /** usedCount++ (ödeme PAID olunca — aynı işlemde). */
  incrementUsed(id: string, tx?: DbClient): Promise<CouponRecord> {
    return this.db(tx).coupon.update({ where: { id }, data: { usedCount: { increment: 1 } } });
  }

  /** usedCount-- (iptal/iade) — negatife düşmez. */
  async decrementUsed(id: string, tx?: DbClient): Promise<number> {
    const r = await this.db(tx).coupon.updateMany({ where: { id, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
    return r.count;
  }

  // ── CouponRedemption ─────────────────────────────────────────────────────────────────────────────────────────────

  createRedemption(data: Prisma.CouponRedemptionUncheckedCreateInput, tx?: DbClient): Promise<CouponRedemptionRecord> {
    return this.db(tx).couponRedemption.create({ data });
  }

  findRedemptionByOrder(orderId: string, tx?: DbClient): Promise<CouponRedemptionRecord | null> {
    return this.db(tx).couponRedemption.findUnique({ where: { orderId } });
  }

  async deleteRedemption(id: string, tx?: DbClient): Promise<void> {
    await this.db(tx).couponRedemption.delete({ where: { id } });
  }

  /** Kullanıcının bu kuponla kaç kullanımı var (bekleyen + ödenmiş; iptal/iade edilenler silinmiştir). */
  countRedemptionsForUser(couponId: string, userId: string, tx?: DbClient): Promise<number> {
    return this.db(tx).couponRedemption.count({ where: { couponId, userId } });
  }

  findRedemptionsOfCoupon(couponId: string, take = 200): Promise<CouponRedemptionDetailRecord[]> {
    return this.prisma.couponRedemption.findMany({
      where: { couponId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: REDEMPTION_DETAIL_INCLUDE,
    });
  }
}
