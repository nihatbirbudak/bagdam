import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminTeslimatTarihleriPage } from './AdminTeslimatTarihleriPage';

const ZONES = [
  { id: 'z1', name: 'Urla', slug: 'urla', fee: 49, freeThreshold: 500, capacityPerDay: 999, isActive: true, sortOrder: 1 },
  { id: 'z2', name: 'Çeşme', slug: 'cesme', fee: 69, freeThreshold: null, capacityPerDay: 999, isActive: true, sortOrder: 2 },
];

const DATES = [
  { id: 'd1', zoneId: 'z1', zoneName: 'Urla', day: 'SALI', date: '2026-08-25', cutoffAt: '2026-08-24T09:00:00.000Z', capacity: 100, reserved: 10, status: 'OPEN' },
  { id: 'd2', zoneId: 'z1', zoneName: 'Urla', day: 'PERSEMBE', date: '2026-08-27', cutoffAt: '2026-08-26T09:00:00.000Z', capacity: 40, reserved: 40, status: 'OPEN' },
  { id: 'd3', zoneId: 'z1', zoneName: 'Urla', day: 'CUMARTESI', date: '2026-08-29', cutoffAt: '2026-08-28T09:00:00.000Z', capacity: 60, reserved: 0, status: 'CLOSED' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(search = '?zone=urla') {
  return render(
    <MemoryRouter initialEntries={[`/ayarlar/teslimat-tarihleri${search}`]}>
      <ConfirmProvider>
        <Routes>
          <Route path="*" element={<AdminTeslimatTarihleriPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('AdminTeslimatTarihleriPage (ekran 14b)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let patched: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    resetCsrfForTests();
    patched = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'));
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/admin/delivery/zones')) return Promise.resolve(jsonResponse(ZONES));
      if (url.startsWith('/api/v1/admin/delivery/dates/generate') && method === 'POST') {
        return Promise.resolve(jsonResponse({ weeks: 8, from: '2026-08-25', to: '2026-10-17', zones: 2, created: 12, updated: 4 }));
      }
      if (url.startsWith('/api/v1/admin/delivery/dates/') && method === 'PATCH') {
        const id = url.split('/').pop() ?? '';
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patched.push({ url, body });
        const row = DATES.find((d) => d.id === id)!;
        return Promise.resolve(jsonResponse({ ...row, ...body }));
      }
      if (url.startsWith('/api/v1/admin/delivery/dates')) return Promise.resolve(jsonResponse(DATES));
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('bölge + hafta aralığıyla tarihleri listeler; kesim ve doluluk gösterilir', async () => {
    renderPage();
    await screen.findByText('25.08.2026');

    // Hafta penceresi (20 Ağu perşembe → 17–23 Ağu) API sorgusuna gitti
    const datesCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/admin/delivery/dates?'));
    expect(datesCall).toContain('zone=urla');
    expect(datesCall).toContain('from=2026-08-17');
    expect(datesCall).toContain('to=2026-08-23');

    expect(screen.getByText('Salı')).toBeInTheDocument();
    expect(screen.getByText('Perşembe')).toBeInTheDocument();
    // 40/40 → dolu
    expect(screen.getByText('%100 · dolu')).toBeInTheDocument();
    // Kapalı gün rozeti
    expect(screen.getAllByText('Kapalı').length).toBeGreaterThan(1); // özet kartı + satır rozeti
  });

  it('kapasiteyi düzenler ve PATCH gönderir', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await screen.findByText('25.08.2026');

    await user.click(screen.getAllByTitle('Kapasiteyi düzenle')[0]);
    const input = await screen.findByLabelText('25.08.2026 kapasitesi');
    await user.clear(input);
    await user.type(input, '150');
    await user.click(screen.getByRole('button', { name: 'Kapasiteyi kaydet' }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].url).toContain('/admin/delivery/dates/d1');
    expect(patched[0].body).toEqual({ capacity: 150 });
  });

  it('rezervenin altına kapasite girilirse istemci uyarır, istek gitmez', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await screen.findByText('25.08.2026');

    await user.click(screen.getAllByTitle('Kapasiteyi düzenle')[0]);
    const input = await screen.findByLabelText('25.08.2026 kapasitesi');
    await user.clear(input);
    await user.type(input, '5');
    await user.click(screen.getByRole('button', { name: 'Kapasiteyi kaydet' }));

    expect(await screen.findByText(/rezerve edilenin \(10\) altına düşürülemez/)).toBeInTheDocument();
    expect(patched).toHaveLength(0);
  });

  it('kapalı günü açar (PATCH status=OPEN); rezervasyonlu günü kapatmak onay ister', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await screen.findByText('29.08.2026');

    await user.click(screen.getByRole('button', { name: '29.08.2026 — Günü aç' }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0].body).toEqual({ status: 'OPEN' });

    // Rezervasyonu olan açık günü kapatmak onay diyaloğu açar
    await user.click(screen.getByRole('button', { name: '25.08.2026 — Günü kapat' }));
    expect(await screen.findByText(/10 rezervasyon var/)).toBeInTheDocument();
  });
});
