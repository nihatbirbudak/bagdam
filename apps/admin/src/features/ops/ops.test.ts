import { describe, expect, it } from 'vitest';
import {
  bulkApplicableIds,
  bulkNeedsConfirm,
  bulkResultMessage,
  bulkStatusOptions,
  daySummaryWarnings,
  groupPackingByZone,
  opsStatusLabel,
  packingItemText,
  prefsText,
  printTitle,
  qtyLabel,
  sortPickList,
  summarizePickList,
} from './ops';
import type { PackingListEntry, PickListRow } from '../../lib/apiTypes';

function pickRow(over: Partial<PickListRow> = {}): PickListRow {
  return {
    productId: 'p1',
    productSlug: 'domates',
    productName: 'Domates',
    unit: 'kg',
    lotCode: 'L-1',
    totalQty: 3,
    boxCount: 2,
    extraCount: 1,
    boxQty: 2,
    extraQty: 1,
    labels: ['1 kg'],
    prefs: [],
    ...over,
  };
}

function packingEntry(over: Partial<PackingListEntry> = {}): PackingListEntry {
  return {
    cycleId: 'c1',
    subscriptionId: 's1',
    orderNo: 1001,
    customerName: 'Ayşe Yılmaz',
    customerPhone: '05550000000',
    addressLine: 'Urla, İzmir',
    zoneName: 'Urla',
    tierSlug: 'small',
    tierLabel: 'Küçük kutu',
    curatorName: 'Zeynep',
    status: 'CHARGED',
    items: [{ productId: 'p1', productSlug: 'domates', name: 'Domates', label: '1 kg', pref: null, source: 'TEMPLATE', lotCode: 'L-1', qty: 1, unit: 'kg' }],
    note: null,
    cycleNo: 2,
    isOneTime: false,
    deliveryOn: '2026-08-25',
    addressZip: '35430',
    itemPrefs: {},
    deliveryDay: 'sali',
    zoneSlug: 'urla',
    customerEmail: 'ayse@example.com',
    orderStatus: 'PAID',
    adminNote: null,
    total: 250,
    boxItemCount: 1,
    extraItemCount: 0,
    ...over,
  };
}

describe('ops — toplu durum (cycle ve sipariş makineleri ayrı ayrı)', () => {
  it('hedefler yalnız geçebilen satırlarla listelenir', () => {
    const sel = {
      cycles: [
        { id: 'c1', status: 'CHARGED' },
        { id: 'c2', status: 'PREPARING' },
      ],
      orders: [
        { id: 'o1', status: 'PAID' },
        { id: 'o2', status: 'PREPARING' },
      ],
    };
    const byStatus = Object.fromEntries(bulkStatusOptions(sel).map((o) => [o.status, o]));
    expect(byStatus.PREPARING).toMatchObject({ cycles: 1, orders: 1, total: 2 });
    expect(byStatus.OUT_FOR_DELIVERY).toMatchObject({ cycles: 1, orders: 1, total: 2 });
    // DELIVERED'a doğrudan geçebilen satır yok (önce OUT_FOR_DELIVERY gerekir)
    expect(byStatus.DELIVERED).toBeUndefined();
  });

  it('DELIVERY_FAILED yalnız siparişte vardır (cycle makinesinde yok → sunucu 409 verir)', () => {
    const options = bulkStatusOptions({ cycles: [{ id: 'c1', status: 'OUT_FOR_DELIVERY' }], orders: [{ id: 'o1', status: 'OUT_FOR_DELIVERY' }] });
    expect(options.find((o) => o.status === 'DELIVERY_FAILED')).toMatchObject({ cycles: 0, orders: 1 });
    expect(bulkApplicableIds({ cycles: [{ id: 'c1', status: 'OUT_FOR_DELIVERY' }], orders: [{ id: 'o1', status: 'OUT_FOR_DELIVERY' }] }, 'DELIVERY_FAILED')).toEqual({
      cycleIds: [],
      orderIds: ['o1'],
    });
  });

  it('hedef listesi yalnız OPS_BULK_STATUS_VALUES içerir (iptal yok)', () => {
    const options = bulkStatusOptions({ cycles: [{ id: 'c1', status: 'SCHEDULED' }], orders: [] });
    expect(options.map((o) => o.status)).not.toContain('CANCELLED');
  });

  it('uygulanabilir kimlikler süzülür; geçemeyen satır gönderilmez', () => {
    const sel = {
      cycles: [
        { id: 'c1', status: 'CHARGED' },
        { id: 'c2', status: 'DELIVERED' },
      ],
      orders: [{ id: 'o1', status: 'PAID' }],
    };
    expect(bulkApplicableIds(sel, 'PREPARING')).toEqual({ cycleIds: ['c1'], orderIds: ['o1'] });
  });

  it('bilinmeyen durum hiçbir hedefe geçmez', () => {
    expect(bulkStatusOptions({ cycles: [{ id: 'c1', status: 'YOK' }], orders: [] })).toEqual([]);
  });

  it('teslim edilemedi onay ister; sonuç metni kısmi başarıyı yazar', () => {
    expect(bulkNeedsConfirm('DELIVERY_FAILED')).toBe(true);
    expect(bulkNeedsConfirm('PREPARING')).toBe(false);
    expect(bulkResultMessage({ updated: 3, failed: 0, skipped: 0 })).toBe('3 kayıt güncellendi');
    expect(bulkResultMessage({ updated: 2, failed: 1, skipped: 1 })).toBe('2 kayıt güncellendi, 1 atlandı, 1 başarısız');
  });

  it('durum etiketi cycle ya da sipariş sözlüğünden gelir', () => {
    expect(opsStatusLabel('PREPARING')).toBe('Hazırlanıyor');
    expect(opsStatusLabel('DELIVERY_FAILED')).toBe('Teslim edilemedi');
    expect(opsStatusLabel('YOK')).toBe('YOK');
  });
});

describe('ops — toplama listesi', () => {
  it('özet: farklı ürün, toplam/kutu/ekstra miktarları ve satır sayıları', () => {
    const rows = [pickRow(), pickRow({ productId: 'p2', productName: 'Zeytin', totalQty: 1.5, boxQty: 1.5, extraQty: 0, boxCount: 1, extraCount: 0 })];
    expect(summarizePickList(rows)).toEqual({ products: 2, totalQty: 4.5, boxQty: 3.5, extraQty: 1, boxes: 3, extras: 1 });
  });

  it('ürün adına göre (tr) sıralanır', () => {
    const rows = [pickRow({ productId: 'p1', productName: 'Şeftali' }), pickRow({ productId: 'p2', productName: 'Domates' }), pickRow({ productId: 'p3', productName: 'Incir' })];
    expect(sortPickList(rows).map((r) => r.productName)).toEqual(['Domates', 'Incir', 'Şeftali']);
  });

  it('miktar etiketi birimle; tercih dağılımı okunur metne dönüşür', () => {
    expect(qtyLabel(3, 'kg')).toBe('3 kg');
    expect(qtyLabel(1.25, null)).toBe('1.25');
    expect(prefsText([{ pref: 'çekirdeksiz', qty: 3, count: 3 }, { pref: 'çekirdekli', qty: 1, count: 1 }])).toBe('çekirdeksiz ×3 · çekirdekli ×1');
    expect(prefsText([])).toBe('');
    expect(prefsText(undefined)).toBe('');
  });
});

describe('ops — paketleme listesi', () => {
  it('bölgeye göre gruplar, grup içinde müşteri adına göre sıralar', () => {
    const entries = [
      packingEntry({ cycleId: 'c1', zoneName: 'Çeşme', customerName: 'Zeynep' }),
      packingEntry({ cycleId: 'c2', zoneName: 'Urla', customerName: 'Bora' }),
      packingEntry({ cycleId: 'c3', zoneName: 'Urla', customerName: 'Ayşe' }),
    ];
    const groups = groupPackingByZone(entries);
    expect(groups.map((g) => g.zoneName)).toEqual(['Çeşme', 'Urla']);
    expect(groups[1].entries.map((e) => e.customerName)).toEqual(['Ayşe', 'Bora']);
  });

  it('fiş satırı metni: ad — etiket (tercih)', () => {
    expect(packingItemText({ name: 'Domates', label: '1 kg', pref: 'çekirdeksiz' })).toBe('Domates — 1 kg (çekirdeksiz)');
    expect(packingItemText({ name: 'Zeytin', label: null, pref: null })).toBe('Zeytin');
  });
});

describe('ops — gün özeti uyarıları', () => {
  it('tahsilat sorunu, kesim bekleyen kutu ve dolan bölge uyarısı', () => {
    expect(
      daySummaryWarnings({
        unpaidCount: 1,
        awaitingPaymentCount: 2,
        cycleCountsByStatus: { LOCKED: 1, SCHEDULED: 3 },
        zones: [{ zoneName: 'Urla', capacity: 10, reserved: 10, locked: false }],
      }),
    ).toEqual([
      '1 kutu tahsil edilemedi (UNPAID) — Ödeme Problemleri ekranına bakın.',
      '2 kutu ödeme linki bekliyor.',
      '1 kutu kilitli ama henüz tahsil edilmedi.',
      '3 kutu hâlâ planlandı durumunda (kesim bekliyor).',
      'Urla bölgesi bu gün için dolu (10/10).',
    ]);
  });

  it('sorunsuz gün: uyarı yok', () => {
    expect(daySummaryWarnings({ unpaidCount: 0, awaitingPaymentCount: 0, cycleCountsByStatus: { CHARGED: 5 }, zones: [{ zoneName: 'Urla', capacity: 100, reserved: 5, locked: true }] })).toEqual([]);
  });
});

describe('ops — yazdırma başlığı', () => {
  it('tarih GG.AA.YYYY, bölge varsa eklenir', () => {
    expect(printTitle('pick', '2026-08-25', 'Urla')).toBe('Toplama listesi — 25.08.2026 · Urla');
    expect(printTitle('packing', '2026-08-25', null)).toBe('Paketleme listesi — 25.08.2026');
  });
});
