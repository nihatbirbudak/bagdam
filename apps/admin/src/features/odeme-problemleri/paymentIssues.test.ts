import { describe, expect, it } from 'vitest';
import {
  canIssueLink,
  canRetryCharge,
  dunningText,
  issueKindLabel,
  issueSeverity,
  normalizePaymentIssues,
  relativeToNow,
  sortIssues,
  summarizeIssues,
  validateIssueNote,
} from './paymentIssues';
import type { PaymentIssueItem } from '../../lib/apiTypes';

function issue(over: Partial<PaymentIssueItem> = {}): PaymentIssueItem {
  return {
    kind: 'CYCLE',
    id: 'c1',
    orderId: 'o1',
    orderNo: 1001,
    cycleId: 'c1',
    cycleNo: 3,
    subscriptionId: 's1',
    status: 'UNPAID',
    customerName: 'Ayşe Yılmaz',
    customerEmail: 'ayse@example.com',
    customerPhone: '05550000000',
    amount: 250,
    deliveryOn: '2026-08-30',
    retryCount: 1,
    nextRetryAtIso: '2026-08-26T21:00:00.000Z',
    paymentDueAtIso: null,
    paymentLinkUrl: null,
    lastFailureCode: 'INSUFFICIENT_FUNDS',
    lastFailureMessage: 'Yetersiz bakiye',
    lastAttemptAtIso: '2026-08-26T09:00:00.000Z',
    hasCard: true,
    subscriptionStatus: 'ACTIVE',
    failedCycles: 1,
    createdAtIso: '2026-08-26T09:00:00.000Z',
    ...over,
  };
}

const ORDER_ISSUE = issue({
  kind: 'ORDER',
  id: 'o9',
  orderId: 'o9',
  orderNo: 1009,
  cycleId: null,
  cycleNo: null,
  subscriptionId: null,
  status: 'PAYMENT_FAILED',
  hasCard: false,
  subscriptionStatus: null,
  failedCycles: 0,
  deliveryOn: '2026-08-29',
});

describe('paymentIssues — yanıt normalizasyonu', () => {
  it('{items,total,page,limit,counts} zarfı olduğu gibi okunur', () => {
    const res = normalizePaymentIssues({
      items: [issue()],
      total: 1,
      page: 1,
      limit: 25,
      counts: { failedOrders: 0, unpaidCycles: 1, awaitingPaymentCycles: 0, total: 1 },
    });
    expect(res.items).toHaveLength(1);
    expect(res.counts).toEqual({ failedOrders: 0, unpaidCycles: 1, awaitingPaymentCycles: 0, total: 1 });
  });

  it('counts yoksa satırlardan hesaplanır; düz dizi de kabul edilir', () => {
    const res = normalizePaymentIssues([issue(), issue({ id: 'c2', status: 'AWAITING_PAYMENT' }), ORDER_ISSUE]);
    expect(res.total).toBe(3);
    expect(res.counts).toEqual({ failedOrders: 1, unpaidCycles: 1, awaitingPaymentCycles: 1, total: 3 });
  });

  it('boş/geçersiz yanıt güvenli varsayılana düşer', () => {
    expect(normalizePaymentIssues(null)).toEqual({ items: [], total: 0, page: 1, limit: 0, counts: { failedOrders: 0, unpaidCycles: 0, awaitingPaymentCycles: 0, total: 0 } });
  });
});

describe('paymentIssues — kaynak ve aciliyet', () => {
  const today = '2026-08-26';

  it('kaynak etiketi', () => {
    expect(issueKindLabel('CYCLE')).toBe('Kutu');
    expect(issueKindLabel('ORDER')).toBe('Sipariş');
    expect(issueKindLabel('X')).toBe('X');
  });

  it('PAST_DUE abonelik, teslimatı gelmiş satır ve başarısız sipariş → acil', () => {
    expect(issueSeverity(issue({ subscriptionStatus: 'PAST_DUE' }), today)).toBe('critical');
    expect(issueSeverity(issue({ deliveryOn: '2026-08-26' }), today)).toBe('critical');
    expect(issueSeverity(ORDER_ISSUE, today)).toBe('critical');
  });

  it('ileri tarihli UNPAID takip, ödeme linki bekleyen bilgi', () => {
    expect(issueSeverity(issue({ status: 'UNPAID', deliveryOn: '2026-08-30' }), today)).toBe('warning');
    expect(issueSeverity(issue({ status: 'AWAITING_PAYMENT', deliveryOn: '2026-08-30' }), today)).toBe('info');
  });

  it('sıralama: acil önce, sonra teslimat tarihi', () => {
    const rows = [
      issue({ id: 'a', status: 'AWAITING_PAYMENT', deliveryOn: '2026-09-05' }),
      issue({ id: 'b', deliveryOn: '2026-08-20' }),
      issue({ id: 'c', status: 'UNPAID', deliveryOn: '2026-08-31' }),
    ];
    expect(sortIssues(rows, today).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('paymentIssues — zaman metinleri', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('gelecek/geçmiş ayrımı', () => {
    expect(relativeToNow('2026-08-26T14:30:00.000Z', now)).toBe('2 sa 30 dk sonra');
    expect(relativeToNow('2026-08-26T11:45:00.000Z', now)).toBe('15 dk önce');
    expect(relativeToNow('2026-08-24T12:00:00.000Z', now)).toBe('2 gün 0 sa önce');
    expect(relativeToNow(null, now)).toBe('—');
  });

  it('dunning metni: linkte son geçerlilik, kartta sıradaki deneme', () => {
    expect(dunningText(issue({ status: 'UNPAID', nextRetryAtIso: '2026-08-26T14:00:00.000Z' }), now)).toBe('sonraki deneme: 2 sa 0 dk sonra');
    expect(dunningText(issue({ status: 'AWAITING_PAYMENT', paymentDueAtIso: '2026-08-26T13:00:00.000Z' }), now)).toBe('link: 1 sa 0 dk sonra');
  });
});

describe('paymentIssues — aksiyon uygunluğu ve not', () => {
  it('yeniden çek: yalnız cycle satırı, tahsilat bekleyen durum ve saklı kart varken', () => {
    expect(canRetryCharge(issue({ status: 'UNPAID', hasCard: true }))).toBe(true);
    expect(canRetryCharge(issue({ status: 'UNPAID', hasCard: false }))).toBe(false);
    expect(canRetryCharge(issue({ status: 'CHARGED', hasCard: true }))).toBe(false);
    expect(canRetryCharge(ORDER_ISSUE)).toBe(false);
  });

  it('ödeme linki: cycle satırı ve tahsilat bekleyen durum (kart gerekmez)', () => {
    expect(canIssueLink(issue({ status: 'AWAITING_PAYMENT', hasCard: false }))).toBe(true);
    expect(canIssueLink(ORDER_ISSUE)).toBe(false);
  });

  it('not doğrulaması 2–500 karakter', () => {
    expect(validateIssueNote('Müşteri arandı')).toBeNull();
    expect(validateIssueNote('  ')).toMatch(/boş/);
    expect(validateIssueNote('a')).toMatch(/en az 2/i);
    expect(validateIssueNote('x'.repeat(501))).toMatch(/500/);
  });
});

describe('paymentIssues — özet', () => {
  it('sayaçlar sunucudan, acil sayısı satırlardan', () => {
    const list = normalizePaymentIssues([issue({ deliveryOn: '2026-08-26' }), issue({ id: 'c2', status: 'AWAITING_PAYMENT', deliveryOn: '2026-09-01' }), ORDER_ISSUE]);
    expect(summarizeIssues(list, '2026-08-26')).toEqual({ total: 3, failedOrders: 1, unpaidCycles: 1, awaitingPaymentCycles: 1, critical: 2 });
  });
});
