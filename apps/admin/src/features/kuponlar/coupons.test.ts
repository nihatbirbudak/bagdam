import { describe, expect, it } from 'vitest';
import {
  EMPTY_COUPON_DRAFT,
  couponDiscountLabel,
  couponState,
  couponToDraft,
  couponUsageLabel,
  isCouponDraftDirty,
  isoToLocalInput,
  localInputToIso,
  normalizeCouponCode,
  toCouponBody,
  validateCouponDraft,
} from './coupons';

const COUPON = {
  id: 'c1',
  code: 'HOSGELDIN10',
  kind: 'PERCENT' as const,
  value: 10,
  minSubtotal: 250,
  appliesTo: 'ALL' as const,
  startsAt: null,
  endsAt: null,
  usageLimit: 100,
  perUserLimit: 1,
  usedCount: 3,
  isActive: true,
  note: 'lansman',
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

describe('coupons — taslak ↔ gövde', () => {
  it('kupon → taslak → gövde gidiş-dönüş (sayılar tr-TR metin, null → boş)', () => {
    const d = couponToDraft(COUPON);
    expect(d).toMatchObject({ code: 'HOSGELDIN10', kind: 'PERCENT', value: '10', minSubtotal: '250', usageLimit: '100', perUserLimit: '1', isActive: true, note: 'lansman', startsAt: '', endsAt: '' });
    expect(validateCouponDraft(d)).toEqual({});
    expect(toCouponBody(d)).toEqual({
      code: 'HOSGELDIN10',
      kind: 'PERCENT',
      value: 10,
      minSubtotal: 250,
      appliesTo: 'ALL',
      startsAt: null,
      endsAt: null,
      usageLimit: 100,
      perUserLimit: 1,
      isActive: true,
      note: 'lansman',
    });
  });

  it('kod normalize: büyük harf, boşluksuz; doğrulama: biçim, yüzde ≤ 100, tutar > 0, tam sayı sınırlar, tarih sırası', () => {
    expect(normalizeCouponCode(' yaz 2026 ')).toBe('YAZ2026');
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'ab', value: '5' }).code).toMatch(/3–32/);
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ-2026', value: '150' }).value).toMatch(/100/);
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ_2026', kind: 'AMOUNT', value: '150,50' })).toEqual({});
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ2026', value: '0' }).value).toBeTruthy();
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ2026', value: '5', usageLimit: '2,5' }).usageLimit).toBeTruthy();
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ2026', value: '5', perUserLimit: '-1' }).perUserLimit).toBeTruthy();
    expect(validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ2026', value: '5', minSubtotal: 'abc' }).minSubtotal).toBeTruthy();
    const e = validateCouponDraft({ ...EMPTY_COUPON_DRAFT, code: 'YAZ2026', value: '5', startsAt: '2026-09-01T10:00', endsAt: '2026-08-01T10:00' });
    expect(e.endsAt).toMatch(/sonra/);
  });

  it('AMOUNT gövdesi: TL değeri, boş sınırlar null, not kırpılır', () => {
    const body = toCouponBody({ ...EMPTY_COUPON_DRAFT, code: 'kargo', kind: 'AMOUNT', value: '49,90', appliesTo: 'SINGLE', note: '  ilk hafta  ' });
    expect(body).toMatchObject({ code: 'KARGO', kind: 'AMOUNT', value: 49.9, appliesTo: 'SINGLE', minSubtotal: null, usageLimit: null, perUserLimit: null, note: 'ilk hafta' });
  });

  it('datetime-local ↔ ISO gidiş-dönüş; boş → null; bozuk → undefined', () => {
    const iso = '2026-08-20T10:30:00.000Z';
    const local = isoToLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localInputToIso(local)).toBe(new Date(local).toISOString());
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('bozuk')).toBeUndefined();
    expect(isoToLocalInput(null)).toBe('');
  });

  it('dirty: kırpılmış metin farkı ya da boolean/select farkı', () => {
    const d = couponToDraft(COUPON);
    expect(isCouponDraftDirty(d, { ...d })).toBe(false);
    expect(isCouponDraftDirty(d, { ...d, note: 'lansman ' })).toBe(false);
    expect(isCouponDraftDirty(d, { ...d, isActive: false })).toBe(true);
    expect(isCouponDraftDirty(d, { ...d, value: '15' })).toBe(true);
  });
});

describe('coupons — görüntü', () => {
  it('indirim/kullanım etiketleri', () => {
    expect(couponDiscountLabel({ kind: 'PERCENT', value: 10 })).toBe('%10');
    expect(couponDiscountLabel({ kind: 'AMOUNT', value: 50 })).toMatch(/50,00/);
    expect(couponUsageLabel({ usedCount: 3, usageLimit: 100 })).toBe('3 / 100');
    expect(couponUsageLabel({ usedCount: 3, usageLimit: null })).toBe('3 / ∞');
  });

  it('türetilmiş durum: pasif › süresi doldu › tükendi › başlamadı › aktif', () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    expect(couponState(COUPON, now)).toBe('ACTIVE');
    expect(couponState({ ...COUPON, isActive: false }, now)).toBe('PASSIVE');
    expect(couponState({ ...COUPON, endsAt: '2026-08-01T00:00:00.000Z' }, now)).toBe('EXPIRED');
    expect(couponState({ ...COUPON, usedCount: 100 }, now)).toBe('EXHAUSTED');
    expect(couponState({ ...COUPON, startsAt: '2026-09-01T00:00:00.000Z' }, now)).toBe('SCHEDULED');
    expect(couponState({ ...COUPON, isActive: false, endsAt: '2026-08-01T00:00:00.000Z' }, now)).toBe('PASSIVE');
  });
});
