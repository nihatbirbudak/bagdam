import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfForTests } from '../../lib/api';
import { AdminAboneliklerListePage } from './AdminAboneliklerListePage';

const ITEMS = [
  {
    id: 's1',
    userEmail: 'ayse@example.com',
    userName: 'Ayşe Yılmaz',
    tierSlug: 'small',
    isOneTime: false,
    status: 'ACTIVE',
    frequencyWeeks: 1,
    deliveryDay: 'SALI',
    zoneName: 'Urla',
    nextDeliveryOn: '2026-08-25',
    failedCycles: 0,
    startedAt: '2026-07-01T09:00:00.000Z',
  },
  {
    id: 's2',
    userEmail: 'bora@example.com',
    userName: 'Bora Kaya',
    tierSlug: 'sezon',
    isOneTime: true,
    status: 'COMPLETED',
    frequencyWeeks: 1,
    deliveryDay: 'PERSEMBE',
    zoneName: 'Çeşme',
    nextDeliveryOn: null,
    failedCycles: 0,
    startedAt: '2026-08-01T09:00:00.000Z',
  },
  {
    id: 's3',
    userEmail: 'cem@example.com',
    userName: 'Cem Demir',
    tierSlug: 'small',
    isOneTime: false,
    status: 'PAST_DUE',
    frequencyWeeks: 2,
    deliveryDay: 'CUMARTESI',
    zoneName: 'Urla',
    nextDeliveryOn: '2026-08-29',
    failedCycles: 2,
    startedAt: '2026-06-01T09:00:00.000Z',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/abonelikler${search}`]}>
      <Routes>
        <Route path="*" element={<AdminAboneliklerListePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminAboneliklerListePage (ekran 19)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/admin/subscriptions')) {
        const qs = new URLSearchParams(url.split('?')[1] ?? '');
        const status = qs.get('status');
        const items = status ? ITEMS.filter((i) => i.status === status) : ITEMS;
        return Promise.resolve(jsonResponse({ items, total: items.length, page: 1, limit: 25 }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('abonelikleri ve tek seferlik kutuları tek listede gösterir', async () => {
    renderPage();
    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Bora Kaya')).toBeInTheDocument();
    // 'Tek seferlik': tür süzgeci hapı + satır rozeti + sıklık hücresi
    expect(screen.getAllByText('Tek seferlik').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Haftada bir')).toBeInTheDocument();
    expect(screen.getByText('2 haftada bir')).toBeInTheDocument();
    expect(screen.getByText('2 ardışık hata')).toBeInTheDocument();
  });

  it('durum filtresi sunucuya status parametresi gönderir', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ayşe Yılmaz');

    await user.click(screen.getByRole('button', { name: 'Ödeme gecikmiş' }));
    await waitFor(() => {
      const last = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/admin/subscriptions')).pop();
      expect(last).toContain('status=PAST_DUE');
    });
    await waitFor(() => expect(screen.queryByText('Ayşe Yılmaz')).not.toBeInTheDocument());
    expect(screen.getByText('Cem Demir')).toBeInTheDocument();
  });

  it('tür süzgeci istemci tarafındadır (uçta parametresi yok)', async () => {
    renderPage('?kind=onetime');
    expect(await screen.findByText('Bora Kaya')).toBeInTheDocument();
    expect(screen.queryByText('Ayşe Yılmaz')).not.toBeInTheDocument();
    const call = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/admin/subscriptions'));
    expect(call).not.toContain('kind=');
  });

  it('tahsilat sorunu süzgeci yalnız failedCycles>0 / PAST_DUE satırlarını bırakır', async () => {
    renderPage('?dunning=1');
    expect(await screen.findByText('Cem Demir')).toBeInTheDocument();
    expect(screen.queryByText('Ayşe Yılmaz')).not.toBeInTheDocument();
    expect(screen.getByText(/istemci süzgeciyle gizlendi/)).toBeInTheDocument();
  });

  it('satır detay bağlantısı /abonelikler/:id', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Ayşe Yılmaz' });
    expect(link).toHaveAttribute('href', '/abonelikler/s1');
  });
});
