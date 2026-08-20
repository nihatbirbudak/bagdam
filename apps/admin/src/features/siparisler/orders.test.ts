import { ORDER_TRANSITIONS, type OrderStatus } from '@bagdam/shared';
import { describe, expect, it } from 'vitest';
import {
  addIsoDays,
  addressText,
  billingToDraft,
  csvFileName,
  filterFromParams,
  hasActiveFilter,
  isBillingDirty,
  isOrderTerminal,
  isPaymentRefundable,
  orderTransitionOptions,
  parseAdminNotes,
  refundableAmount,
  requiresReason,
  summarizeOrders,
  toBillingPatch,
  todayIsoDate,
  toOrdersQuery,
  transitionKind,
  validateBillingDraft,
  validateReason,
  validateRefundDraft,
} from './orders';

describe('orders — durum geçişleri (shared Order makinesi tek kaynak)', () => {
  it('her durum için düğmeler = ORDER_TRANSITIONS; terminal durumlarda boş', () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS) as [OrderStatus, readonly OrderStatus[]][]) {
      expect(orderTransitionOptions(from).map((o) => o.to)).toEqual([...targets]);
    }
    expect(orderTransitionOptions('CANCELLED')).toEqual([]);
    expect(isOrderTerminal('REFUNDED')).toBe(true);
    expect(isOrderTerminal('PAID')).toBe(false);
  });

  it('geçiş türü: ops akışı birincil, iptal birincil + neden, iade/ödeme ikincil', () => {
    expect(transitionKind('PAID', 'PREPARING')).toBe('ops');
    expect(transitionKind('PAID', 'CANCELLED')).toBe('cancel');
    expect(transitionKind('PAID', 'REFUNDED')).toBe('refund');
    expect(transitionKind('PENDING_PAYMENT', 'PAID')).toBe('payment');
    expect(transitionKind('PAYMENT_FAILED', 'PENDING_PAYMENT')).toBe('payment');
    const paid = orderTransitionOptions('PAID');
    expect(paid.find((o) => o.to === 'PREPARING')).toMatchObject({ primary: true, requiresReason: false, label: 'Hazırlanıyor' });
    expect(paid.find((o) => o.to === 'CANCELLED')).toMatchObject({ primary: true, requiresReason: true });
    expect(paid.find((o) => o.to === 'REFUNDED')).toMatchObject({ primary: false, requiresReason: true });
    expect(requiresReason('CANCELLED')).toBe(true);
    expect(requiresReason('DELIVERED')).toBe(false);
  });

  it('neden doğrulama: zorunluysa boş olamaz; 200 karakter sınırı', () => {
    expect(validateReason('', true)).toMatch(/neden/i);
    expect(validateReason('  ', false)).toBeNull();
    expect(validateReason('x'.repeat(201), false)).toMatch(/200/);
    expect(validateReason('Müşteri vazgeçti', true)).toBeNull();
  });
});

describe('orders — iade', () => {
  const paid = { status: 'SUCCEEDED' as const, amount: 250, refunds: [] };
  it('kalan iade = tutar − başarılı iadeler; FAILED/PENDING iade edilemez', () => {
    expect(refundableAmount(paid)).toBe(250);
    expect(refundableAmount({ status: 'PARTIAL_REFUNDED', amount: 250, refunds: [{ amount: 100, status: 'SUCCEEDED' }, { amount: 50, status: 'FAILED' }] as never })).toBe(150);
    expect(refundableAmount({ status: 'REFUNDED', amount: 250, refunds: [{ amount: 250, status: 'SUCCEEDED' }] as never })).toBe(0);
    expect(refundableAmount({ status: 'FAILED', amount: 250, refunds: [] })).toBe(0);
    expect(isPaymentRefundable(paid)).toBe(true);
    expect(isPaymentRefundable({ status: 'PENDING', amount: 10, refunds: [] })).toBe(false);
  });

  it('iade formu: tutar aralığı (tr-TR virgül), neden sınırı', () => {
    expect(validateRefundDraft({ amount: '', reason: '' }, 100)).toHaveProperty('amount');
    expect(validateRefundDraft({ amount: '0', reason: '' }, 100)).toHaveProperty('amount');
    expect(validateRefundDraft({ amount: '100,01', reason: '' }, 100).amount).toMatch(/En çok/);
    expect(validateRefundDraft({ amount: '99,50', reason: 'ayıplı ürün' }, 100)).toEqual({});
    expect(validateRefundDraft({ amount: '10', reason: 'x'.repeat(201) }, 100)).toHaveProperty('reason');
  });
});

describe('orders — fatura (kurumsal alanlar)', () => {
  it('CORPORATE: unvan + 10/11 haneli vergi/TC no zorunlu; INDIVIDUAL serbest', () => {
    const d = billingToDraft({ billingParty: 'CORPORATE', billingName: null, billingTaxNo: null, billingTaxOffice: null });
    expect(validateBillingDraft(d)).toEqual({ billingName: expect.any(String), billingTaxNo: expect.any(String) });
    expect(validateBillingDraft({ ...d, billingName: 'Urla Kafe', billingTaxNo: '12345' })).toEqual({ billingTaxNo: expect.stringMatching(/10 ya da 11/) });
    expect(validateBillingDraft({ ...d, billingName: 'Urla Kafe', billingTaxNo: '1234567890', billingTaxOffice: 'Urla' })).toEqual({});
    expect(validateBillingDraft({ billingParty: 'INDIVIDUAL', billingName: '', billingTaxNo: '', billingTaxOffice: '' })).toEqual({});
    expect(validateBillingDraft({ billingParty: 'INDIVIDUAL', billingName: '', billingTaxNo: 'abc', billingTaxOffice: '' })).toHaveProperty('billingTaxNo');
  });

  it('PATCH gövdesi boş metni null yapar; dirty karşılaştırması kırpılmış', () => {
    const initial = billingToDraft({ billingParty: 'INDIVIDUAL', billingName: null, billingTaxNo: null, billingTaxOffice: null });
    expect(toBillingPatch({ ...initial, billingName: '  ' })).toEqual({ billingParty: 'INDIVIDUAL', billingName: null, billingTaxNo: null, billingTaxOffice: null });
    expect(isBillingDirty(initial, { ...initial, billingName: ' ' })).toBe(false);
    expect(isBillingDirty(initial, { ...initial, billingParty: 'CORPORATE' })).toBe(true);
  });
});

describe('orders — notlar / adres / tarih / filtre / özet', () => {
  it('adminNote satırları: [stamp] metin; eski serbest metin stamp=null', () => {
    expect(parseAdminNotes(null)).toEqual([]);
    expect(parseAdminNotes('[2026-08-20 14:05] Telefonla arandı\nserbest not')).toEqual([
      { stamp: '2026-08-20 14:05', text: 'Telefonla arandı' },
      { stamp: null, text: 'serbest not' },
    ]);
  });

  it('adres metni: satır · bölge · posta kodu', () => {
    expect(addressText({ fullName: 'A', phone: '0', line: 'İskele Mah. 12', zoneId: 'z', zoneName: 'Urla', zip: '35430' })).toBe('İskele Mah. 12 · Urla · 35430');
    expect(addressText({ fullName: 'A', phone: '0', line: 'İskele Mah. 12', zoneId: 'z', zoneName: 'Urla', zip: null })).toBe('İskele Mah. 12 · Urla');
    expect(addressText(null)).toBe('—');
  });

  it('todayIsoDate Europe/Istanbul takvim günü; addIsoDays ay/yıl sınırını aşar', () => {
    // 2026-08-20T22:30Z = 21 Ağustos 01:30 İstanbul
    expect(todayIsoDate(new Date('2026-08-20T22:30:00.000Z'))).toBe('2026-08-21');
    expect(todayIsoDate(new Date('2026-08-20T12:00:00.000Z'))).toBe('2026-08-20');
    expect(addIsoDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addIsoDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('URL → filtre (bilinmeyen durum atılır) → sorgu; CSV adı', () => {
    const f = filterFromParams(new URLSearchParams('status=PAID&kind=NOPE&from=2026-08-01&q=%23100'));
    expect(f).toEqual({ status: 'PAID', kind: '', from: '2026-08-01', to: '', deliveryOn: '', q: '#100' });
    expect(hasActiveFilter(f)).toBe(true);
    expect(hasActiveFilter(filterFromParams(new URLSearchParams('')))).toBe(false);
    expect(toOrdersQuery(f, 2, 50)).toEqual({ status: 'PAID', kind: undefined, from: '2026-08-01', to: undefined, deliveryOn: undefined, q: '#100', page: 2, limit: 50 });
    expect(csvFileName(f, new Date('2026-08-20T12:00:00.000Z'))).toBe('siparisler-2026-08-20-paid-2026-08-01_bugun.csv');
  });

  it('özet: ödenmiş durumlar ciroya girer, bekleyen/başarısız sayılır', () => {
    const d = summarizeOrders([
      { status: 'PAID', grandTotal: 100.5, paidAt: '2026-08-20T10:00:00.000Z' },
      { status: 'DELIVERED', grandTotal: 49.5, paidAt: '2026-08-19T10:00:00.000Z' },
      { status: 'PENDING_PAYMENT', grandTotal: 30, paidAt: null },
      { status: 'PAYMENT_FAILED', grandTotal: 30, paidAt: null },
      { status: 'CANCELLED', grandTotal: 30, paidAt: null },
      { status: 'REFUNDED', grandTotal: 30, paidAt: '2026-08-18T10:00:00.000Z' },
    ]);
    expect(d).toEqual({ count: 6, paidCount: 2, revenue: 150, pendingCount: 1, failedCount: 1 });
  });
});
