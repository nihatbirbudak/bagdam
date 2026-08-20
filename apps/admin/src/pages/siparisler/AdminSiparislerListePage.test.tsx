import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfForTests } from '../../lib/api';
import { AdminSiparislerListePage } from './AdminSiparislerListePage';

const ROWS = [
  { id: 'o1', orderNo: 1001, kind: 'SUBSCRIPTION', status: 'PAID', customerName: 'Ayşe Yılmaz', customerEmail: 'ayse@example.com', deliveryDay: 'SALI', deliveryOn: '2026-08-25', grandTotal: 349.5, lineCount: 3, paidAt: '2026-08-20T10:00:00.000Z', createdAt: '2026-08-20T09:00:00.000Z' },
  { id: 'o2', orderNo: 1002, kind: 'SINGLE', status: 'PAYMENT_FAILED', customerName: 'Mehmet Kaya', customerEmail: 'mehmet@example.com', deliveryDay: 'PERSEMBE', deliveryOn: '2026-08-27', grandTotal: 120, lineCount: 1, paidAt: null, createdAt: '2026-08-20T11:00:00.000Z' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(initial = '/siparisler') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="*" element={<AdminSiparislerListePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminSiparislerListePage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/admin/orders/export.csv')) {
        return Promise.resolve(new Response('﻿orderNo,createdAt\r\n1001,2026-08-20\r\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }));
      }
      if (url.startsWith('/api/v1/admin/orders')) {
        const qs = new URLSearchParams(url.split('?')[1] ?? '');
        const status = qs.get('status');
        const q = qs.get('q');
        let items = ROWS;
        if (status) items = items.filter((r) => r.status === status);
        if (q) items = items.filter((r) => r.customerEmail.includes(q) || String(r.orderNo) === q.replace('#', ''));
        return Promise.resolve(jsonResponse({ items, total: items.length, page: 1, limit: 25 }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const urls = () => fetchMock.mock.calls.map((c) => String((c as [string])[0]));

  it('listeyi çeker; sipariş no, müşteri, tür/durum rozetleri, tutar ve detay bağlantısı', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: '#1001' })).toBeInTheDocument());
    expect(urls().some((u) => u.startsWith('/api/v1/admin/orders?') || u === '/api/v1/admin/orders')).toBe(true);
    expect(screen.getByText('Ayşe Yılmaz')).toBeInTheDocument();
    // tür hem filtre hapı hem rozet olarak görünür
    expect(screen.getAllByText('Abonelik').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Ödendi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ödeme başarısız').length).toBeGreaterThan(0);
    expect(screen.getByText(/349,50/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#1001 detay' })).toHaveAttribute('href', '/siparisler/o1');
  });

  it('durum hızlı filtresi → ?status=PAYMENT_FAILED; arama → ?q=; URL filtresi ilk yüklemede uygulanır', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: '#1001' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Ödeme problemi' }));
    await waitFor(() => {
      expect(urls().some((u) => u.includes('status=PAYMENT_FAILED'))).toBe(true);
      expect(screen.queryByRole('link', { name: '#1001' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '#1002' })).toBeInTheDocument();
    });

    await user.type(screen.getByRole('searchbox'), 'ayse');
    await waitFor(() => expect(urls().some((u) => u.includes('q=ayse'))).toBe(true), { timeout: 2000 });
  });

  it('tarih filtresi URL’den okunur ve sorguya gider; CSV dışa aktar aynı filtreyle export.csv çağırır', async () => {
    const user = userEvent.setup();
    renderPage('/siparisler?from=2026-08-01&to=2026-08-20&kind=SINGLE');
    await waitFor(() => expect(urls().some((u) => u.includes('from=2026-08-01') && u.includes('to=2026-08-20') && u.includes('kind=SINGLE'))).toBe(true));
    expect(screen.getByLabelText('Başlangıç tarihi')).toHaveValue('2026-08-01');

    await user.click(screen.getByRole('button', { name: 'CSV dışa aktar' }));
    await waitFor(() => {
      const exp = urls().find((u) => u.startsWith('/api/v1/admin/orders/export.csv'));
      expect(exp).toBeTruthy();
      expect(exp).toContain('from=2026-08-01');
      expect(exp).toContain('kind=SINGLE');
      expect(exp).not.toContain('page=');
    });
  });
});
