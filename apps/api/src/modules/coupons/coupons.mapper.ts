import type { Coupon as CouponDto, CouponDetail, CouponKind, CouponListItem, CouponRedemptionListItem, CouponScope, Money } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import type { CouponRecord, CouponRedemptionDetailRecord } from './coupons.repository';

/** Prisma Decimal(12,2) → number (TL); null → null. */
export function decimalToMoney(value: Prisma.Decimal | number): Money {
  return typeof value === 'number' ? value : Number(value.toString());
}
export function decimalToMoneyOrNull(value: Prisma.Decimal | null | undefined): Money | null {
  return value === null || value === undefined ? null : decimalToMoney(value);
}
export function moneyToDecimal(value: Money): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toCouponDto(row: CouponRecord): CouponDto {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind as CouponKind,
    value: decimalToMoney(row.value),
    minSubtotal: decimalToMoneyOrNull(row.minSubtotal),
    appliesTo: row.appliesTo as CouponScope,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    usageLimit: row.usageLimit,
    perUserLimit: row.perUserLimit,
    usedCount: row.usedCount,
    isActive: row.isActive,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCouponListItem(row: CouponRecord): CouponListItem {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind as CouponKind,
    value: decimalToMoney(row.value),
    appliesTo: row.appliesTo as CouponScope,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    isActive: row.isActive,
  };
}

export function toRedemptionListItem(row: CouponRedemptionDetailRecord): CouponRedemptionListItem {
  return {
    id: row.id,
    couponId: row.couponId,
    couponCode: row.coupon.code,
    orderId: row.orderId,
    orderNo: row.order.orderNo,
    orderStatus: row.order.status,
    userId: row.userId,
    userEmail: row.user?.email ?? null,
    amount: decimalToMoney(row.amount),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCouponDetail(row: CouponRecord, redemptions: CouponRedemptionDetailRecord[]): CouponDetail {
  return { ...toCouponDto(row), deletedAt: iso(row.deletedAt), redemptions: redemptions.map(toRedemptionListItem) };
}
