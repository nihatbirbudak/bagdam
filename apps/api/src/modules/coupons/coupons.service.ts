import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  COUPON_REJECT_MESSAGES,
  discountAmount,
  formatMoneyTr,
  roundMoney,
  type Coupon as CouponDto,
  type CouponDetail,
  type CouponList,
  type CouponRejectReason,
  type CouponScope,
  type DiscountRounding,
  type Money,
} from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import type { CouponQueryDto, CouponUpsertDto } from './dto/coupon.dto';
import { moneyToDecimal, toCouponDetail, toCouponDto, toCouponListItem } from './coupons.mapper';
import { CouponsRepository, type CouponRecord, type DbClient } from './coupons.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
/** Kupon kodu: boşluklar atılır, büyük harfe çevrilir (citext zaten duyarsız; görünüm tutarlılığı). */
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

/** Kapsama göre indirime esas tutarlar (ilk-kutu/retention indirimi DÜŞÜLMÜŞ satır toplamları). */
export interface CouponEligibleAmounts {
  /** Tüm sepet: subtotal − kutu indirimi. */
  all: Money;
  /** PRODUCT satırları. */
  single: Money;
  /** BOX + EXTRA satırları (kutu indirimi düşülmüş). */
  box: Money;
}

export interface CouponValidateInput {
  code: string;
  /** Oturumlu müşteri; misafirde null (perUserLimit yalnız oturumluda denetlenir — checkout oturum ister). */
  userId: string | null;
  /** İndirim ÖNCESİ ara toplam (Σ lineTotal) — `minSubtotal` bununla karşılaştırılır. */
  subtotal: Money;
  eligible: CouponEligibleAmounts;
  /** İndirim yuvarlaması (Setting commerce.discountRounding — ADR-0018). */
  rounding?: DiscountRounding;
  now?: Date;
}

export type CouponValidation =
  | { ok: true; coupon: CouponRecord; scope: CouponScope; amount: Money; message: string }
  | { ok: false; reason: CouponRejectReason; message: string; coupon: CouponRecord | null };

export function rejectMessage(reason: CouponRejectReason): string {
  return COUPON_REJECT_MESSAGES[reason];
}

/** Kapsam → indirime esas tutar. */
export function eligibleAmountFor(scope: CouponScope, eligible: CouponEligibleAmounts): Money {
  if (scope === 'SINGLE') return eligible.single;
  if (scope === 'BOX') return eligible.box;
  return eligible.all;
}

/**
 * Kupon indirim tutarı (saf): PERCENT → `discountAmount(eligible, value, rounding)` (ADR-0018 yuvarlama);
 * AMOUNT → min(value, eligible) (kuruşa). Negatif/0 esas → 0.
 */
export function computeCouponDiscount(
  coupon: Pick<CouponRecord, 'kind' | 'value'>,
  eligible: Money,
  rounding?: DiscountRounding,
): Money {
  if (!(eligible > 0)) return 0;
  const value = Number(coupon.value.toString());
  if (coupon.kind === 'PERCENT') return discountAmount(eligible, Math.min(100, Math.max(0, value)), rounding);
  return roundMoney(Math.min(value, eligible));
}

/**
 * CouponsService — kupon doğrulama/uygulama (checkout) + kullanım kaydı (PAID yan etkisi) + admin CRUD (F8; ADR-0016 P2'den alındı).
 *  - `validate(input)`: kod → kupon (silinmemiş) · isActive · tarih penceresi · usageLimit · perUserLimit (oturumlu) · minSubtotal
 *    (indirim öncesi ara toplam) · kapsam (ALL|SINGLE|BOX; esas tutar > 0) → indirim tutarı. Hiçbir şey yazmaz.
 *  - `reserveRedemption` (checkout, Order ile aynı işlemde): CouponRedemption satırı (orderId unique → sipariş başına 1).
 *  - `confirmRedemption` (Order PAID, aynı işlemde): usedCount++. `releaseRedemption` (iptal/iade/süre dolumu): satır silinir,
 *    ödenmişse usedCount--.
 *  - Admin: liste/detay(+kullanımlar)/oluştur/güncelle/soft-delete/aktif-pasif.
 * Prisma yalnız repository'de; zaman `now` parametreyle (ADR-0004).
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(private readonly repo: CouponsRepository) {}

  // ── Doğrulama (checkout/quote) ────────────────────────────────────────────────────────────────────────────────────

  async validate(input: CouponValidateInput, tx?: DbClient): Promise<CouponValidation> {
    const now = input.now ?? new Date();
    const code = normalizeCode(input.code);
    if (!code) return { ok: false, reason: 'NOT_FOUND', message: rejectMessage('NOT_FOUND'), coupon: null };
    const coupon = await this.repo.findByCode(code, tx);
    if (!coupon) return { ok: false, reason: 'NOT_FOUND', message: rejectMessage('NOT_FOUND'), coupon: null };
    const reject = (reason: CouponRejectReason): CouponValidation => ({ ok: false, reason, message: rejectMessage(reason), coupon });
    if (!coupon.isActive) return reject('INACTIVE');
    if (coupon.startsAt && coupon.startsAt.getTime() > now.getTime()) return reject('NOT_STARTED');
    if (coupon.endsAt && coupon.endsAt.getTime() <= now.getTime()) return reject('EXPIRED');
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return reject('USAGE_LIMIT');
    if (coupon.perUserLimit !== null) {
      if (!input.userId) return reject('LOGIN_REQUIRED');
      const used = await this.repo.countRedemptionsForUser(coupon.id, input.userId, tx);
      if (used >= coupon.perUserLimit) return reject('PER_USER_LIMIT');
    }
    if (coupon.minSubtotal !== null && input.subtotal < Number(coupon.minSubtotal.toString())) return reject('MIN_SUBTOTAL');
    const scope = coupon.appliesTo as CouponScope;
    const eligible = eligibleAmountFor(scope, input.eligible);
    if (!(eligible > 0)) return reject('SCOPE_MISMATCH');
    const amount = computeCouponDiscount(coupon, eligible, input.rounding);
    if (!(amount > 0)) return reject('NO_DISCOUNT');
    return { ok: true, coupon, scope, amount, message: `Kupon uygulandı: −${formatMoneyTr(amount)} TL` };
  }

  // ── Kullanım kaydı ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Checkout: Order ile aynı işlemde satır (bekleyen kullanım). Sipariş başına 1 (orderId unique). */
  async reserveRedemption(input: { couponId: string; orderId: string; userId: string | null; amount: Money }, tx?: DbClient): Promise<void> {
    await this.repo.createRedemption({ couponId: input.couponId, orderId: input.orderId, userId: input.userId, amount: moneyToDecimal(input.amount) }, tx);
  }

  /** Order PAID (aynı işlemde): usedCount++. Satır yoksa sessizce geçer (kuponsuz sipariş). */
  async confirmRedemption(orderId: string, tx?: DbClient): Promise<boolean> {
    const row = await this.repo.findRedemptionByOrder(orderId, tx);
    if (!row) return false;
    await this.repo.incrementUsed(row.couponId, tx);
    return true;
  }

  /** İptal/iade/süre dolumu: satır silinir; `wasPaid` ise usedCount-- (negatife düşmez). */
  async releaseRedemption(orderId: string, opts: { wasPaid: boolean }, tx?: DbClient): Promise<boolean> {
    const row = await this.repo.findRedemptionByOrder(orderId, tx);
    if (!row) return false;
    await this.repo.deleteRedemption(row.id, tx);
    if (opts.wasPaid) await this.repo.decrementUsed(row.couponId, tx);
    return true;
  }

  // ── Admin ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async list(query: CouponQueryDto): Promise<CouponList> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total } = await this.repo.list({ q: query.q || undefined, active: query.active }, (page - 1) * limit, limit);
    return { items: rows.map(toCouponListItem), total, page, limit };
  }

  async getDetail(id: string): Promise<CouponDetail> {
    const row = await this.requireCoupon(id);
    const redemptions = await this.repo.findRedemptionsOfCoupon(id);
    return toCouponDetail(row, redemptions);
  }

  async create(dto: CouponUpsertDto): Promise<CouponDto> {
    const data = this.toWriteData(dto, true);
    try {
      const row = await this.repo.create(data as Prisma.CouponUncheckedCreateInput);
      this.logger.log(`Kupon oluşturuldu: ${row.code} (${row.kind} ${row.value.toString()})`);
      return toCouponDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'Bu kupon kodu zaten var', error: 'COUPON_CODE_TAKEN' });
      }
      throw err;
    }
  }

  async update(id: string, dto: CouponUpsertDto): Promise<CouponDto> {
    await this.requireCoupon(id);
    const data = this.toWriteData(dto, false);
    try {
      const row = await this.repo.update(id, data);
      return toCouponDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'Bu kupon kodu zaten var', error: 'COUPON_CODE_TAKEN' });
      }
      throw err;
    }
  }

  /** Soft delete: deletedAt + isActive=false (kod yeniden kullanılabilsin diye kod `<kod>~<zaman>` olarak arşivlenir). */
  async softDelete(id: string, now: Date = new Date()): Promise<CouponDto> {
    const row = await this.requireCoupon(id);
    const archivedCode = `${row.code}~${now.getTime().toString(36)}`.slice(0, 40);
    return toCouponDto(await this.repo.update(id, { deletedAt: now, isActive: false, code: archivedCode }));
  }

  async setActive(id: string, isActive: boolean): Promise<CouponDto> {
    await this.requireCoupon(id);
    return toCouponDto(await this.repo.update(id, { isActive }));
  }

  // ── Yardımcılar ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async requireCoupon(id: string): Promise<CouponRecord> {
    const row = await this.repo.findById(id);
    if (!row || row.deletedAt) throw new NotFoundException({ message: 'Kupon bulunamadı', error: 'COUPON_NOT_FOUND' });
    return row;
  }

  private toWriteData(dto: CouponUpsertDto, isCreate: boolean): Prisma.CouponUncheckedUpdateInput {
    const code = normalizeCode(dto.code);
    if (!CODE_RE.test(code)) {
      throw new BadRequestException({ message: 'Kupon kodu 2–40 karakter; harf/rakam/tire/alt çizgi', error: 'COUPON_CODE_INVALID' });
    }
    if (dto.kind === 'PERCENT' && (dto.value <= 0 || dto.value > 100)) {
      throw new BadRequestException({ message: 'Yüzde indirim 0–100 arasında olmalı', error: 'COUPON_VALUE_INVALID' });
    }
    if (dto.kind === 'AMOUNT' && dto.value <= 0) {
      throw new BadRequestException({ message: 'Tutar indirimi pozitif olmalı', error: 'COUPON_VALUE_INVALID' });
    }
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException({ message: 'Bitiş, başlangıçtan sonra olmalı', error: 'COUPON_DATES_INVALID' });
    }
    return {
      code,
      kind: dto.kind,
      value: moneyToDecimal(dto.value),
      minSubtotal: dto.minSubtotal === undefined || dto.minSubtotal === null ? null : moneyToDecimal(dto.minSubtotal),
      appliesTo: dto.appliesTo ?? (isCreate ? 'ALL' : undefined),
      startsAt,
      endsAt,
      usageLimit: dto.usageLimit ?? null,
      perUserLimit: dto.perUserLimit ?? null,
      isActive: dto.isActive ?? (isCreate ? true : undefined),
      note: dto.note === undefined ? undefined : dto.note || null,
    };
  }
}

/** Kod normalizasyonu: kırp + büyük harf (tr-TR yerine basit ASCII büyütme — kodlar ASCII). */
export function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}
