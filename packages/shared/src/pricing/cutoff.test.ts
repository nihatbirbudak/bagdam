import { describe, expect, it } from 'vitest';
import { DELIVERY_DAY_META, DeliveryDay } from '../enums';
import {
  DEFAULT_CUTOFF_RULE,
  DEFAULT_TZ,
  addCalendarDays,
  calendarDateIn,
  computeCutoffAt,
  deliveryDayForWeekday,
  isBeforeCutoff,
  isoDateToUtc,
  lockedDeliveryDay,
  lockedDeliveryDays,
  nextDeliveryDateFor,
  nextDeliveryDates,
  utcToIsoDate,
  weekdayOf,
} from './cutoff';

// Bütün "an"lar UTC ISO (Z) ile kurulur; beklentiler de UTC'dir. Böylece testler süreç TZ'sinden (TZ=UTC ya da
// TZ=Europe/Istanbul ya da başka) BAĞIMSIZ aynı sonucu verir — kod yerel getHours/getDay kullanmadığı için.
// Takvim: 2026-08-20 Perşembe → 24 Pzt, 25 Sal, 26 Çar, 27 Per, 28 Cum, 29 Cmt, 30 Paz. İstanbul = UTC+3 (kalıcı).
const ALL_DAYS = [DeliveryDay.SALI, DeliveryDay.PERSEMBE, DeliveryDay.CUMARTESI] as const;
const utc = (iso: string) => new Date(iso);

describe('pricing/cutoff takvim yardımcıları (TZ\'siz)', () => {
  it('ISO gün ↔ UTC gece yarısı, gün ekleme, haftanın günü', () => {
    expect(utcToIsoDate(isoDateToUtc('2026-08-25'))).toBe('2026-08-25');
    expect(addCalendarDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayOf('2026-08-20')).toBe(4); // Perşembe
    expect(weekdayOf('2026-08-25')).toBe(2); // Salı
    expect(deliveryDayForWeekday(6)).toBe(DeliveryDay.CUMARTESI);
    expect(deliveryDayForWeekday(0)).toBeNull();
    expect(() => isoDateToUtc('2026-02-30')).toThrow(RangeError);
    expect(() => isoDateToUtc('25.08.2026')).toThrow(RangeError);
  });

  it('bir anın TZ\'deki takvim günü — gece yarısı sınırı', () => {
    expect(calendarDateIn(utc('2026-08-24T21:30:00Z'))).toBe('2026-08-25'); // İstanbul 00:30
    expect(calendarDateIn(utc('2026-08-24T21:30:00Z'), 'UTC')).toBe('2026-08-24');
    expect(calendarDateIn(utc('2026-08-24T20:59:59Z'))).toBe('2026-08-24'); // İstanbul 23:59:59
  });
});

describe('pricing/cutoff computeCutoffAt (ADR-0005: teslimattan 1 gün önce 12:00, Europe/Istanbul)', () => {
  it('Salı 2026-08-25 teslimat → Pazartesi 2026-08-24 12:00 +03 = 09:00Z', () => {
    expect(computeCutoffAt('2026-08-25').toISOString()).toBe('2026-08-24T09:00:00.000Z');
    expect(DEFAULT_TZ).toBe('Europe/Istanbul');
    expect(DEFAULT_CUTOFF_RULE).toEqual({ daysBefore: 1, time: '12:00' });
  });

  it('Türkiye kalıcı +03: kışın da aynı ofset (DST yok)', () => {
    expect(computeCutoffAt('2027-01-12').toISOString()).toBe('2027-01-11T09:00:00.000Z'); // Salı → Pazartesi 12:00 +03
    expect(computeCutoffAt('2026-12-29').toISOString()).toBe('2026-12-28T09:00:00.000Z');
  });

  it('DST\'li bölgede ofset mevsime göre değişir (TZ gerçekten uygulanıyor)', () => {
    expect(computeCutoffAt('2026-08-25', DEFAULT_CUTOFF_RULE, 'Europe/Berlin').toISOString()).toBe('2026-08-24T10:00:00.000Z'); // +02
    expect(computeCutoffAt('2027-01-12', DEFAULT_CUTOFF_RULE, 'Europe/Berlin').toISOString()).toBe('2027-01-11T11:00:00.000Z'); // +01
    expect(computeCutoffAt('2026-08-25', DEFAULT_CUTOFF_RULE, 'UTC').toISOString()).toBe('2026-08-24T12:00:00.000Z');
  });

  it('kural parametrik: eski FE kuralı (2 gün önce 23:59) ve ay/yıl sınırı', () => {
    expect(computeCutoffAt('2026-08-25', { daysBefore: 2, time: '23:59' }).toISOString()).toBe('2026-08-23T20:59:00.000Z');
    expect(computeCutoffAt('2026-09-01').toISOString()).toBe('2026-08-31T09:00:00.000Z');
    expect(computeCutoffAt('2027-01-01', { daysBefore: 1, time: '00:00' }).toISOString()).toBe('2026-12-30T21:00:00.000Z');
    expect(computeCutoffAt('2026-08-25', { daysBefore: 0, time: '08:30' }).toISOString()).toBe('2026-08-25T05:30:00.000Z');
  });

  it('geçersiz girdiler hata', () => {
    expect(() => computeCutoffAt('2026-8-25')).toThrow(RangeError);
    expect(() => computeCutoffAt('2026-08-25', { daysBefore: -1, time: '12:00' })).toThrow(RangeError);
    expect(() => computeCutoffAt('2026-08-25', { daysBefore: 1, time: '12' })).toThrow(RangeError);
    expect(() => computeCutoffAt('2026-08-25', { daysBefore: 1, time: '24:00' })).toThrow(RangeError);
    expect(() => computeCutoffAt('2026-08-25', DEFAULT_CUTOFF_RULE, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('pricing/cutoff isBeforeCutoff — "Salı teslimat için Pazartesi 11:59 kabul / 12:01 red"', () => {
  const cutoff = computeCutoffAt('2026-08-25'); // 2026-08-24T09:00:00Z

  it('11:59 İstanbul (08:59Z) → kabul', () => {
    expect(isBeforeCutoff(utc('2026-08-24T08:59:00Z'), cutoff)).toBe(true);
    expect(isBeforeCutoff(utc('2026-08-24T08:59:59.999Z'), cutoff)).toBe(true);
  });

  it('12:01 İstanbul (09:01Z) → red; tam 12:00 de kilitli (cutoffAt <= now)', () => {
    expect(isBeforeCutoff(utc('2026-08-24T09:01:00Z'), cutoff)).toBe(false);
    expect(isBeforeCutoff(utc('2026-08-24T09:00:00.000Z'), cutoff)).toBe(false);
  });

  it('süreç TZ\'sinden bağımsız: aynı an farklı biçimlerde kurulsa da sonuç aynı', () => {
    const a = new Date(Date.UTC(2026, 7, 24, 8, 59));
    const b = new Date('2026-08-24T11:59:00+03:00');
    expect(isBeforeCutoff(a, cutoff)).toBe(true);
    expect(isBeforeCutoff(b, cutoff)).toBe(true);
    expect(isBeforeCutoff(new Date('2026-08-24T12:01:00+03:00'), cutoff)).toBe(false);
  });
});

describe('pricing/cutoff lockedDeliveryDay (cart.js kuralının tek kaynağı: önceki gün 12:00 → teslimat günü sonu)', () => {
  it('Pazartesi 11:59 → hiçbir gün kilitli değil; 12:00 → Salı kilitli; Salı günü boyunca Salı kilitli', () => {
    expect(lockedDeliveryDay(utc('2026-08-24T08:59:00Z'), ALL_DAYS)).toBeNull();
    expect(lockedDeliveryDay(utc('2026-08-24T09:00:00Z'), ALL_DAYS)).toBe(DeliveryDay.SALI);
    expect(lockedDeliveryDay(utc('2026-08-25T05:00:00Z'), ALL_DAYS)).toBe(DeliveryDay.SALI); // Salı 08:00
    expect(lockedDeliveryDay(utc('2026-08-25T20:59:00Z'), ALL_DAYS)).toBe(DeliveryDay.SALI); // Salı 23:59
  });

  it('Çarşamba 00:00 → yok; Çarşamba 12:00 & Perşembe → Perşembe; Cuma 12:00 & Cumartesi → Cumartesi; Pazar → yok', () => {
    expect(lockedDeliveryDay(utc('2026-08-25T21:00:00Z'), ALL_DAYS)).toBeNull(); // Çar 00:00
    expect(lockedDeliveryDay(utc('2026-08-26T08:59:00Z'), ALL_DAYS)).toBeNull();
    expect(lockedDeliveryDay(utc('2026-08-26T09:00:00Z'), ALL_DAYS)).toBe(DeliveryDay.PERSEMBE);
    expect(lockedDeliveryDay(utc('2026-08-27T15:00:00Z'), ALL_DAYS)).toBe(DeliveryDay.PERSEMBE);
    expect(lockedDeliveryDay(utc('2026-08-28T08:59:00Z'), ALL_DAYS)).toBeNull();
    expect(lockedDeliveryDay(utc('2026-08-28T09:00:00Z'), ALL_DAYS)).toBe(DeliveryDay.CUMARTESI);
    expect(lockedDeliveryDay(utc('2026-08-29T12:00:00Z'), ALL_DAYS)).toBe(DeliveryDay.CUMARTESI);
    expect(lockedDeliveryDay(utc('2026-08-30T12:00:00Z'), ALL_DAYS)).toBeNull(); // Pazar
    expect(lockedDeliveryDays(utc('2026-08-24T09:00:00Z'), ALL_DAYS)).toEqual([DeliveryDay.SALI]);
  });

  it('yalnız istenen günler değerlendirilir', () => {
    expect(lockedDeliveryDay(utc('2026-08-24T09:00:00Z'), [DeliveryDay.PERSEMBE])).toBeNull();
  });
});

describe('pricing/cutoff nextDeliveryDates — 8 haftalık üretim (delivery-dates:generate)', () => {
  const from = utc('2026-08-20T07:00:00Z'); // Perşembe 10:00 İstanbul (bu Perşembe'nin kesimi Çar 12:00 geçti)

  it('includeLocked: 3 gün × 8 hafta = 24 tarih, sıralı, her biri doğru güne ve kesime sahip', () => {
    const slots = nextDeliveryDates(from, ALL_DAYS, 8, { includeLocked: true });
    expect(slots).toHaveLength(24);
    expect(slots[0]).toMatchObject({ day: DeliveryDay.PERSEMBE, date: '2026-08-20', locked: true });
    expect(slots[1]).toMatchObject({ day: DeliveryDay.CUMARTESI, date: '2026-08-22', locked: false });
    expect(slots[2]).toMatchObject({ day: DeliveryDay.SALI, date: '2026-08-25', locked: false });
    expect(slots[23]).toMatchObject({ day: DeliveryDay.SALI, date: '2026-10-13' });
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      expect(weekdayOf(s.date)).toBe(DELIVERY_DAY_META[s.day].dow);
      expect(s.cutoffAt.toISOString()).toBe(`${addCalendarDays(s.date, -1)}T09:00:00.000Z`);
      if (i > 0) expect(s.date > slots[i - 1]!.date).toBe(true);
    }
    expect(slots.filter((s) => s.day === DeliveryDay.SALI)).toHaveLength(8);
    expect(slots.filter((s) => s.locked)).toHaveLength(1);
  });

  it('varsayılan: kilitli tarih dışarıda (23 tarih, ilki Cumartesi 22)', () => {
    const slots = nextDeliveryDates(from, ALL_DAYS, 8);
    expect(slots).toHaveLength(23);
    expect(slots[0]).toMatchObject({ day: DeliveryDay.CUMARTESI, date: '2026-08-22' });
    expect(slots.every((s) => !s.locked && s.cutoffAt.getTime() > from.getTime())).toBe(true);
  });

  it('"2 haftalık takvim": tek gün, 2 hafta → 2 tarih (Salı 25 ve 1 Eylül)', () => {
    expect(nextDeliveryDates(utc('2026-08-24T08:00:00Z'), [DeliveryDay.SALI], 2).map((s) => s.date)).toEqual(['2026-08-25', '2026-09-01']);
    // Pazartesi 12:00'den sonra bu Salı kilitli → yalnız 1 Eylül
    expect(nextDeliveryDates(utc('2026-08-24T09:00:00Z'), [DeliveryDay.SALI], 2).map((s) => s.date)).toEqual(['2026-09-01']);
  });

  it('takvim günü TZ\'ye göre: Cumartesi 21:30Z (= Pazar 00:30 İstanbul) → hafta Pazar\'dan başlar, ilk tarih Salı 1 Eylül', () => {
    const sunMidnightIst = utc('2026-08-29T21:30:00Z');
    const ist = nextDeliveryDates(sunMidnightIst, ALL_DAYS, 1, { includeLocked: true });
    expect(ist.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-03', '2026-09-05']);
    // Aynı an UTC takvimiyle hâlâ Cumartesi 29 → o gün (kilitli) listeye girer
    const utcCal = nextDeliveryDates(sunMidnightIst, ALL_DAYS, 1, { includeLocked: true, tz: 'UTC' });
    expect(utcCal[0]).toMatchObject({ day: DeliveryDay.CUMARTESI, date: '2026-08-29', locked: true });
  });

  it('weeks 0 → boş; negatif/kesirli hata', () => {
    expect(nextDeliveryDates(from, ALL_DAYS, 0)).toEqual([]);
    expect(() => nextDeliveryDates(from, ALL_DAYS, -1)).toThrow(RangeError);
    expect(() => nextDeliveryDates(from, ALL_DAYS, 1.5)).toThrow(RangeError);
  });
});

describe('pricing/cutoff nextDeliveryDateFor (cart.js nextDeliveryDate: kilitliyse bir hafta sonrası)', () => {
  it('Pazartesi 11:59 → bu Salı; 12:00 → gelecek Salı', () => {
    expect(nextDeliveryDateFor(DeliveryDay.SALI, utc('2026-08-24T08:59:00Z')).date).toBe('2026-08-25');
    expect(nextDeliveryDateFor(DeliveryDay.SALI, utc('2026-08-24T09:00:00Z')).date).toBe('2026-09-01');
    // Salı günü (teslimat günü) de kilitli → gelecek Salı
    expect(nextDeliveryDateFor(DeliveryDay.SALI, utc('2026-08-25T06:00:00Z')).date).toBe('2026-09-01');
    // Çarşamba → Perşembe açık (kesim Çar 12:00'den önce)
    expect(nextDeliveryDateFor(DeliveryDay.PERSEMBE, utc('2026-08-26T08:00:00Z')).date).toBe('2026-08-27');
  });
});
