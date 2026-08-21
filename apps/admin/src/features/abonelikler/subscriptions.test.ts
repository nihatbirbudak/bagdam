import { describe, expect, it } from 'vitest';
import {
  CYCLE_ADMIN_FORBIDDEN_TARGETS,
  applyClientFilter,
  canChargeCycle,
  canCompensate,
  canSendPaymentLink,
  cycleAmount,
  cycleStatusOptions,
  eventDataSummary,
  filterFromParams,
  frequencyLabel,
  hasActiveFilter,
  sortCyclesDesc,
  sortEventsDesc,
  subscriptionStatusOptions,
  subscriptionStatusRequiresNote,
  summarizeCycles,
  toCompensateBody,
  toSubscriptionsQuery,
  validateCompensateDraft,
  type CompensateDraft,
} from './subscriptions';
import type { CycleStatus } from '@bagdam/shared';

describe('subscriptions — etiketler', () => {
  it('sıklık metni; tek seferlik kutuda sıklık gösterilmez', () => {
    expect(frequencyLabel(1)).toBe('Haftada bir');
    expect(frequencyLabel(2)).toBe('2 haftada bir');
    expect(frequencyLabel(4)).toBe('4 haftada bir');
    expect(frequencyLabel(1, true)).toBe('Tek seferlik');
  });
});

describe('subscriptions — cycle durum geçişleri (shared cycleMachine)', () => {
  it('LOCKED / UNPAID / AWAITING_PAYMENT admin tarafından doğrudan verilemez', () => {
    for (const from of ['SCHEDULED', 'LOCKED', 'AWAITING_PAYMENT', 'UNPAID', 'CHARGED']) {
      const targets = cycleStatusOptions(from).map((o) => o.to);
      for (const forbidden of CYCLE_ADMIN_FORBIDDEN_TARGETS) expect(targets, `${from} → ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('ops akışı: CHARGED → PREPARING → OUT_FOR_DELIVERY → DELIVERED', () => {
    expect(cycleStatusOptions('CHARGED').map((o) => o.to)).toEqual(['PREPARING']);
    expect(cycleStatusOptions('PREPARING').map((o) => o.to)).toEqual(['OUT_FOR_DELIVERY']);
    expect(cycleStatusOptions('OUT_FOR_DELIVERY').map((o) => o.to)).toEqual(['DELIVERED']);
    expect(cycleStatusOptions('DELIVERED')).toEqual([]);
    expect(cycleStatusOptions('BILINMEYEN')).toEqual([]);
  });

  it('SCHEDULED: atla ve iptal; iptal tehlikeli işaretlenir', () => {
    const opts = cycleStatusOptions('SCHEDULED');
    expect(opts.map((o) => o.to).sort()).toEqual(['CANCELLED', 'SKIPPED']);
    expect(opts.find((o) => o.to === 'CANCELLED')?.danger).toBe(true);
  });
});

describe('subscriptions — abonelik durum geçişleri', () => {
  it('PAUSED (P2) ve PAST_DUE (motor durumu) gösterilmez; iptal neden ister', () => {
    expect(subscriptionStatusOptions('ACTIVE').map((o) => o.to).sort()).toEqual(['CANCELLED', 'CANCEL_REQUESTED', 'COMPLETED']);
    expect(subscriptionStatusOptions('PAST_DUE').map((o) => o.to).sort()).toEqual(['ACTIVE', 'CANCELLED']);
    expect(subscriptionStatusOptions('CANCELLED')).toEqual([]);
    expect(subscriptionStatusRequiresNote('CANCELLED')).toBe(true);
    expect(subscriptionStatusRequiresNote('ACTIVE')).toBe(false);
  });
});

describe('subscriptions — tahsilat aksiyonları', () => {
  it('charge / link yalnız LOCKED, AWAITING_PAYMENT, UNPAID durumlarında', () => {
    for (const s of ['LOCKED', 'AWAITING_PAYMENT', 'UNPAID']) {
      expect(canChargeCycle(s), s).toBe(true);
      expect(canSendPaymentLink(s), s).toBe(true);
    }
    for (const s of ['SCHEDULED', 'CHARGED', 'DELIVERED', 'SKIPPED', 'CANCELLED']) {
      expect(canChargeCycle(s), s).toBe(false);
    }
  });

  it('telafi yalnız kesimi geçmemiş SCHEDULED cycle varken', () => {
    const now = new Date('2026-08-24T08:00:00.000Z');
    expect(canCompensate([{ status: 'SCHEDULED' as CycleStatus, cutoffAt: '2026-08-24T09:00:00.000Z' }], now)).toBe(true);
    expect(canCompensate([{ status: 'SCHEDULED' as CycleStatus, cutoffAt: '2026-08-24T07:00:00.000Z' }], now)).toBe(false);
    expect(canCompensate([{ status: 'CHARGED' as CycleStatus, cutoffAt: '2026-08-24T09:00:00.000Z' }], now)).toBe(false);
    expect(canCompensate([], now)).toBe(false);
  });
});

describe('subscriptions — cycle özetleri', () => {
  const cycles: Array<{ status: CycleStatus; total: number | null; prepaidAmount: number }> = [
    { status: 'DELIVERED', total: 250, prepaidAmount: 0 },
    { status: 'CHARGED', total: 250, prepaidAmount: 0 },
    { status: 'SKIPPED', total: null, prepaidAmount: 0 },
    { status: 'UNPAID', total: 250, prepaidAmount: 0 },
    { status: 'SCHEDULED', total: null, prepaidAmount: 0 },
  ];

  it('tutar: total yoksa peşin tutar', () => {
    expect(cycleAmount({ total: 199.9, prepaidAmount: 0 })).toBe(199.9);
    expect(cycleAmount({ total: null, prepaidAmount: 150 })).toBe(150);
    expect(cycleAmount({ total: 0, prepaidAmount: 0 })).toBe(0);
  });

  it('sayaçlar ve ciro (yalnız tahsil edilmiş durumlar)', () => {
    expect(summarizeCycles(cycles)).toEqual({ total: 5, delivered: 1, skipped: 1, unpaid: 1, scheduled: 1, charged: 1, revenue: 500 });
  });

  it('kutular yeni → eski sıralanır', () => {
    expect(sortCyclesDesc([{ cycleNo: 1 }, { cycleNo: 3 }, { cycleNo: 2 }]).map((c) => c.cycleNo)).toEqual([3, 2, 1]);
  });
});

describe('subscriptions — olay günlüğü', () => {
  it('yeni → eski sıralar; eşit anlarda id ile kararlı', () => {
    const events = [
      { id: 'a', createdAt: '2026-08-20T10:00:00.000Z' },
      { id: 'c', createdAt: '2026-08-21T10:00:00.000Z' },
      { id: 'b', createdAt: '2026-08-20T10:00:00.000Z' },
    ];
    expect(sortEventsDesc(events).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('olay verisi tek satıra indirger; boş/nesne alanlar atlanır', () => {
    expect(eventDataSummary({ from: 1, to: 2, note: '', nested: { a: 1 } })).toBe('from: 1 · to: 2 · nested: …');
    expect(eventDataSummary(null)).toBe('');
  });
});

describe('subscriptions — liste filtresi', () => {
  it('URL → filtre; bilinmeyen durum/tür atılır', () => {
    const p = new URLSearchParams('status=ACTIVE&q=ayse&kind=onetime&dunning=1');
    expect(filterFromParams(p)).toEqual({ status: 'ACTIVE', q: 'ayse', kind: 'onetime', dunning: true });
    expect(filterFromParams(new URLSearchParams('status=YOK&kind=yok'))).toEqual({ status: '', q: '', kind: '', dunning: false });
  });

  it('sunucu sorgusunda yalnız status/q gider (kind ve dunning istemci süzgeci)', () => {
    expect(toSubscriptionsQuery({ status: 'ACTIVE', q: ' ayse ', kind: 'onetime', dunning: true }, 2, 50)).toEqual({
      status: 'ACTIVE',
      q: 'ayse',
      page: 2,
      limit: 50,
    });
    expect(toSubscriptionsQuery({ status: '', q: '  ', kind: '', dunning: false })).toEqual({ status: undefined, q: undefined, page: undefined, limit: undefined });
    expect(hasActiveFilter({ status: '', q: '', kind: '', dunning: false })).toBe(false);
    expect(hasActiveFilter({ status: '', q: '', kind: 'onetime', dunning: false })).toBe(true);
  });

  it('istemci süzgeci: tür ve tahsilat sorunu', () => {
    const rows = [
      { id: '1', isOneTime: false, failedCycles: 0, status: 'ACTIVE' },
      { id: '2', isOneTime: true, failedCycles: 0, status: 'COMPLETED' },
      { id: '3', isOneTime: false, failedCycles: 2, status: 'PAST_DUE' },
    ];
    expect(applyClientFilter(rows, { status: '', q: '', kind: 'onetime', dunning: false }).map((r) => r.id)).toEqual(['2']);
    expect(applyClientFilter(rows, { status: '', q: '', kind: 'subscription', dunning: false }).map((r) => r.id)).toEqual(['1', '3']);
    expect(applyClientFilter(rows, { status: '', q: '', kind: '', dunning: true }).map((r) => r.id)).toEqual(['3']);
  });
});

describe('subscriptions — telafi formu', () => {
  const valid: CompensateDraft = { productId: 'p1', qty: '1,5', label: 'domates', note: 'Ezik geldi' };

  it('geçerli taslak → gövde (virgüllü miktar noktaya çevrilir, boş etiket atılır)', () => {
    expect(validateCompensateDraft(valid)).toEqual({});
    expect(toCompensateBody(valid)).toEqual({ productId: 'p1', qty: 1.5, label: 'domates', note: 'Ezik geldi' });
    expect(toCompensateBody({ ...valid, label: '   ' })).toEqual({ productId: 'p1', qty: 1.5, note: 'Ezik geldi' });
  });

  it('CycleCompensateDto sınırları: ürün, miktar 0<x≤100, etiket ≤80, not 2–500', () => {
    expect(validateCompensateDraft({ ...valid, productId: '' }).productId).toBeTruthy();
    expect(validateCompensateDraft({ ...valid, qty: '0' }).qty).toMatch(/sıfırdan büyük/);
    expect(validateCompensateDraft({ ...valid, qty: '101' }).qty).toMatch(/100/);
    expect(validateCompensateDraft({ ...valid, qty: 'abc' }).qty).toMatch(/Geçerli/);
    expect(validateCompensateDraft({ ...valid, label: 'x'.repeat(81) }).label).toMatch(/80/);
    expect(validateCompensateDraft({ ...valid, note: 'a' }).note).toMatch(/en az 2/i);
    expect(validateCompensateDraft({ ...valid, note: 'x'.repeat(501) }).note).toMatch(/500/);
  });
});
