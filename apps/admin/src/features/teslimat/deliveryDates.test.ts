import { describe, expect, it } from 'vitest';
import {
  cutoffCountdown,
  dateStatusLabel,
  deliveryDayLabel,
  isCutoffPassed,
  occupancyOf,
  summarizeDates,
  toggleStatusLabel,
  toggleStatusTarget,
  validateCapacity,
  validateWeeks,
  weekWindow,
} from './deliveryDates';
import type { AdminDeliveryDate } from '../../lib/apiTypes';

function date(over: Partial<AdminDeliveryDate> = {}): AdminDeliveryDate {
  return {
    id: 'd1',
    zoneId: 'z1',
    zoneName: 'Urla',
    day: 'SALI',
    date: '2026-08-25',
    cutoffAt: '2026-08-24T09:00:00.000Z', // 24 Ağu 12:00 Europe/Istanbul
    capacity: 100,
    reserved: 10,
    status: 'OPEN',
    ...over,
  };
}

describe('deliveryDates — etiketler', () => {
  it('gün ve durum etiketleri Türkçe; bilinmeyen değer olduğu gibi döner', () => {
    expect(deliveryDayLabel('SALI')).toBe('Salı');
    expect(deliveryDayLabel('PERSEMBE')).toBe('Perşembe');
    expect(deliveryDayLabel('PAZAR')).toBe('PAZAR');
    expect(dateStatusLabel('OPEN')).toBe('Açık');
    expect(dateStatusLabel('CLOSED')).toBe('Kapalı');
    expect(dateStatusLabel('XXX')).toBe('XXX');
  });
});

describe('deliveryDates — doluluk', () => {
  it('yüzde, dolu ve dolmak üzere hesapları', () => {
    expect(occupancyOf({ reserved: 10, capacity: 100 })).toMatchObject({ pct: 10, full: false, nearlyFull: false, free: 90 });
    expect(occupancyOf({ reserved: 80, capacity: 100 })).toMatchObject({ pct: 80, full: false, nearlyFull: true });
    expect(occupancyOf({ reserved: 100, capacity: 100 })).toMatchObject({ pct: 100, full: true, nearlyFull: false, free: 0 });
    expect(occupancyOf({ reserved: 120, capacity: 100 })).toMatchObject({ pct: 100, full: true, free: 0 });
  });

  it('kapasite 0: rezerve varsa %100 ve dolu', () => {
    expect(occupancyOf({ reserved: 0, capacity: 0 })).toMatchObject({ pct: 0, full: true });
    expect(occupancyOf({ reserved: 3, capacity: 0 })).toMatchObject({ pct: 100, full: true });
  });
});

describe('deliveryDates — kesim', () => {
  const cutoff = '2026-08-24T09:00:00.000Z';

  it('mutlak kesim anı: sunucu değeri now ile karşılaştırılır (istemci saatine güven yok)', () => {
    expect(isCutoffPassed(cutoff, new Date('2026-08-24T08:59:00.000Z'))).toBe(false);
    expect(isCutoffPassed(cutoff, new Date('2026-08-24T09:00:00.000Z'))).toBe(true);
    expect(isCutoffPassed(cutoff, new Date('2026-08-24T09:01:00.000Z'))).toBe(true);
    expect(isCutoffPassed(null)).toBe(false);
  });

  it('geri sayım metni', () => {
    expect(cutoffCountdown(cutoff, new Date('2026-08-24T08:30:00.000Z'))).toBe('30 dk kaldı');
    expect(cutoffCountdown(cutoff, new Date('2026-08-24T06:20:00.000Z'))).toBe('2 sa 40 dk kaldı');
    expect(cutoffCountdown(cutoff, new Date('2026-08-22T09:00:00.000Z'))).toBe('2 gün 0 sa kaldı');
    expect(cutoffCountdown(cutoff, new Date('2026-08-25T09:00:00.000Z'))).toBe('kesim geçti');
    expect(cutoffCountdown(undefined)).toBe('—');
  });
});

describe('deliveryDates — düzenleme kuralları', () => {
  it('ops yalnız OPEN ↔ CLOSED çevirir; LOCKED (kesim geçti) çevrilemez', () => {
    expect(toggleStatusTarget('OPEN')).toBe('CLOSED');
    expect(toggleStatusTarget('CLOSED')).toBe('OPEN');
    expect(toggleStatusTarget('LOCKED')).toBeNull();
    expect(toggleStatusLabel('OPEN')).toBe('Günü kapat');
    expect(toggleStatusLabel('CLOSED')).toBe('Günü aç');
  });

  it('kapasite: tam sayı, 0–100000, rezervenin altına düşmez', () => {
    expect(validateCapacity('120', 10)).toBeNull();
    expect(validateCapacity('10', 10)).toBeNull();
    expect(validateCapacity('', 0)).toMatch(/gerekli/);
    expect(validateCapacity('12,5', 0)).toMatch(/tam sayı/);
    expect(validateCapacity('100001', 0)).toMatch(/100000/);
    expect(validateCapacity('9', 10)).toMatch(/altına düşürülemez/);
  });

  it('hafta sayısı 1–26 tam sayı (GenerateDeliveryDatesDto ile aynı sınır)', () => {
    expect(validateWeeks('8')).toBeNull();
    expect(validateWeeks('0')).toMatch(/1–26/);
    expect(validateWeeks('27')).toMatch(/1–26/);
    expect(validateWeeks('x')).toMatch(/tam sayı/);
  });
});

describe('deliveryDates — hafta penceresi', () => {
  it('perşembe gününden bu hafta pazartesi–pazar; offset hafta kaydırır', () => {
    expect(weekWindow('2026-08-20', 0)).toEqual({ weekStart: '2026-08-17', weekEnd: '2026-08-23' });
    expect(weekWindow('2026-08-20', 1)).toEqual({ weekStart: '2026-08-24', weekEnd: '2026-08-30' });
    expect(weekWindow('2026-08-20', -1)).toEqual({ weekStart: '2026-08-10', weekEnd: '2026-08-16' });
  });

});

describe('deliveryDates — özet', () => {
  it('durum sayaçları ve toplam rezerve/kapasite', () => {
    const rows = [
      date({ id: '1', status: 'OPEN', reserved: 10, capacity: 100 }),
      date({ id: '2', status: 'CLOSED', reserved: 0, capacity: 50 }),
      date({ id: '3', status: 'LOCKED', reserved: 40, capacity: 40 }),
    ];
    expect(summarizeDates(rows)).toEqual({ total: 3, open: 1, closed: 1, locked: 1, full: 1, reserved: 50, capacity: 190 });
  });
});
