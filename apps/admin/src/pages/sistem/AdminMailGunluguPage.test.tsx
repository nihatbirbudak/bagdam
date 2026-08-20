import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfForTests } from '../../lib/api';
import { AdminMailGunluguPage } from './AdminMailGunluguPage';

const LOGS = [
  { id: 'm1', to: 'ayse@example.com', subject: 'Bağdam’a hoş geldin', templateSlug: 'mail.welcome', entityId: 'u1', status: 'SKIPPED', error: 'preview:apps/api/logs/mail/m1.html', messageId: null, createdAt: '2026-08-20T10:00:00.000Z', sentAt: null },
  { id: 'm2', to: 'admin@bagdam.com', subject: 'Yeni toptan talebi', templateSlug: 'mail.wholesale-lead', entityId: 'wl1', status: 'FAILED', error: 'ECONNREFUSED 127.0.0.1:587', messageId: null, createdAt: '2026-08-20T09:00:00.000Z', sentAt: null },
  { id: 'm3', to: 'ayse@example.com', subject: 'Parola sıfırlama', templateSlug: 'mail.reset', entityId: null, status: 'SENT', error: null, messageId: '<abc@bagdam>', createdAt: '2026-08-20T08:00:00.000Z', sentAt: '2026-08-20T08:00:05.000Z' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sistem/e-posta-gunlugu']}>
      <Routes>
        <Route path="*" element={<AdminMailGunluguPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminMailGunluguPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/admin/mail-logs')) {
        const qs = new URLSearchParams(url.split('?')[1] ?? '');
        const status = qs.get('status');
        const to = qs.get('to');
        const items = LOGS.filter((l) => (!status || l.status === status) && (!to || l.to.includes(to)));
        return Promise.resolve(jsonResponse({ items, total: items.length, page: 1, limit: 25 }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listeyi çeker; durum rozetleri, hata metni ve DISABLE_MAIL önizleme yolu (dev) görünür', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Bağdam’a hoş geldin')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String((c as [string])[0]).startsWith('/api/v1/admin/mail-logs'))).toBe(true);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('mail.welcome')).toBeInTheDocument();
    expect(table.getByText('Gönderildi')).toBeInTheDocument();
    expect(table.getByText('Atlandı (DISABLE_MAIL)')).toBeInTheDocument();
    expect(table.getByText('Hata')).toBeInTheDocument();
    expect(table.getByText('ECONNREFUSED 127.0.0.1:587')).toBeInTheDocument();
    // import.meta.env.DEV (vitest) → önizleme dosya adı + kopyala düğmesi
    expect(screen.getByText(/önizleme: m1\.html/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Önizleme yolunu kopyala' })).toHaveAttribute('title', 'apps/api/logs/mail/m1.html');
  });

  it('durum filtresi → ?status=FAILED; alıcı araması → ?to=', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Bağdam’a hoş geldin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Hata' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String((c as [string])[0])).some((u) => u.includes('status=FAILED'))).toBe(true);
      expect(screen.queryByText('Bağdam’a hoş geldin')).not.toBeInTheDocument();
      expect(screen.getByText('Yeni toptan talebi')).toBeInTheDocument();
    });

    await user.type(screen.getByRole('searchbox'), 'ayse');
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => String((c as [string])[0])).some((u) => u.includes('to=ayse'))).toBe(true), { timeout: 2000 });
  });
});
