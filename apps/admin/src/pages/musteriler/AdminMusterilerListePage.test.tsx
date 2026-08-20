import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfForTests } from '../../lib/api';
import { AdminMusterilerListePage } from './AdminMusterilerListePage';

const ROWS = [
  { id: 'u1', email: 'ayse@example.com', name: 'Ayşe Yılmaz', phone: '0532 000 00 00', role: 'CUSTOMER', isActive: true, emailVerifiedAt: '2026-08-20T10:00:00.000Z', lastLoginAt: '2026-08-20T11:00:00.000Z', anonymizedAt: null, createdAt: '2026-08-19T10:00:00.000Z' },
  { id: 'u2', email: 'anon+u2@anon.local', name: null, phone: null, role: 'CUSTOMER', isActive: false, emailVerifiedAt: null, lastLoginAt: null, anonymizedAt: '2026-08-20T12:00:00.000Z', createdAt: '2026-08-18T10:00:00.000Z' },
  { id: 'u3', email: 'mehmet@bagdam.com', name: 'Mehmet', phone: null, role: 'STAFF', isActive: false, emailVerifiedAt: null, lastLoginAt: null, anonymizedAt: null, createdAt: '2026-08-17T10:00:00.000Z' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/musteriler']}>
      <Routes>
        <Route path="*" element={<AdminMusterilerListePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminMusterilerListePage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/admin/customers')) {
        const qs = new URLSearchParams(url.split('?')[1] ?? '');
        const role = qs.get('role');
        const items = role ? ROWS.filter((r) => r.role === role) : ROWS;
        return Promise.resolve(jsonResponse({ items, total: items.length, page: 1, limit: 25 }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listeyi çeker; rol / durum / doğrulama rozetleri ve detay bağlantısı', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('ayse@example.com')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String((c as [string])[0]).startsWith('/api/v1/admin/customers'))).toBe(true);
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Anonim')).toBeInTheDocument();
    expect(screen.getByText('Pasif')).toBeInTheDocument();
    expect(screen.getAllByText('Aktif')).toHaveLength(1);
    expect(screen.getAllByText('Doğrulandı')).toHaveLength(1);
    expect(screen.getAllByText('Bekliyor')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'ayse@example.com detay' })).toHaveAttribute('href', '/musteriler/u1');
  });

  it('rol filtresi → ?role=STAFF; arama → ?q=', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('ayse@example.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Personel' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String((c as [string])[0])).some((u) => u.includes('role=STAFF'))).toBe(true);
      expect(screen.queryByText('ayse@example.com')).not.toBeInTheDocument();
      expect(screen.getByText('mehmet@bagdam.com')).toBeInTheDocument();
    });

    await user.type(screen.getByRole('searchbox'), 'ayse');
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => String((c as [string])[0])).some((u) => u.includes('q=ayse'))).toBe(true), { timeout: 2000 });
  });
});
