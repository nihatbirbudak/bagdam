import { describe, expect, it } from 'vitest';
import { addDays, cutoffStateText, cutoffTone, dayQuery, summarizeCutoff, weekQuery, weekdayLabel } from './dashboard';
import type { AdminDashboardCutoff } from '../../lib/apiTypes';

function cutoff(over: Partial<AdminDashboardCutoff> = {}): AdminDashboardCutoff {
  return {
    date: '2026-08-25',
    zoneSlug: 'urla',
    zoneName: 'Urla',
    cutoffAtIso: '2026-08-24T09:00:00.000Z',
    locked: false,
    status: 'OPEN',
    capacity: 100,
    reserved: 12,
    cycleCount: 12,
    ...over,
  };
}

describe('dashboard — kesim panosu', () => {
  it('özet: açık / kilitli / dolu ve toplam kutu', () => {
    const rows = [cutoff(), cutoff({ date: '2026-08-27', locked: true, reserved: 40, capacity: 40, cycleCount: 40 })];
    expect(summarizeCutoff(rows)).toEqual({ total: 2, open: 1, locked: 1, full: 1, cycles: 52 });
  });

  it('satır metni ve vurgusu', () => {
    expect(cutoffStateText(cutoff())).toBe('12/100');
    expect(cutoffTone(cutoff())).toBe('good');
    expect(cutoffStateText(cutoff({ locked: true }))).toBe('kesim geçti');
    expect(cutoffTone(cutoff({ locked: true }))).toBe('muted');
    expect(cutoffStateText(cutoff({ reserved: 100 }))).toBe('dolu');
    expect(cutoffTone(cutoff({ reserved: 100 }))).toBe('bad');
  });
});

describe('dashboard — tarih yardımcıları', () => {
  it('gün ve hafta sorgu dizeleri (Siparişler ekranı filtresi)', () => {
    expect(dayQuery('2026-08-24')).toBe('?from=2026-08-24&to=2026-08-24');
    expect(weekQuery('2026-08-24')).toBe('?from=2026-08-24&to=2026-08-30');
  });

  it('gün ekleme TZ kaymasız', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('gecersiz', 1)).toBe('gecersiz');
  });

  it('Türkçe gün adı', () => {
    expect(weekdayLabel('2026-08-25')).toBe('Salı');
    expect(weekdayLabel('2026-08-27')).toBe('Perşembe');
    expect(weekdayLabel('2026-08-29')).toBe('Cumartesi');
    expect(weekdayLabel('yok')).toBe('');
  });
});
