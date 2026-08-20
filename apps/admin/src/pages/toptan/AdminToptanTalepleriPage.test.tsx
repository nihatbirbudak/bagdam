import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfForTests } from '../../lib/api';
import type { AdminWholesaleLead } from '../../lib/apiTypes';
import { AdminToptanTalepleriPage } from './AdminToptanTalepleriPage';

const LEADS: AdminWholesaleLead[] = [
  { id: 'l1', email: 'kafe@example.com', businessName: 'Urla Kafe', phone: null, note: null, status: 'NEW', createdAt: '2026-08-20T10:00:00.000Z' },
  { id: 'l2', email: 'otel@example.com', businessName: null, phone: '+90 555', note: 'aradık', status: 'CONTACTED', createdAt: '2026-08-19T10:00:00.000Z' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AdminToptanTalepleriPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/admin/wholesale-leads/') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Partial<AdminWholesaleLead>;
        return Promise.resolve(jsonResponse({ ...LEADS[0], ...body }));
      }
      if (url.startsWith('/api/v1/admin/wholesale-leads')) return Promise.resolve(jsonResponse({ items: LEADS, total: 2, page: 1, limit: 25 }));
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listeyi çeker, durum etiketlerini gösterir; durum değişince PATCH atar', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/toptan-talepleri']}>
        <Routes>
          <Route path="*" element={<AdminToptanTalepleriPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('kafe@example.com')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String((c as [string])[0]).startsWith('/api/v1/admin/wholesale-leads?'))).toBe(true);
    expect(screen.getAllByText('İletişime geçildi').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('kafe@example.com durumu'), 'CLOSED');
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c as [string, RequestInit])[1]?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(String((patch as [string])[0])).toBe('/api/v1/admin/wholesale-leads/l1');
      expect(JSON.parse(String((patch as [string, RequestInit])[1].body))).toEqual({ status: 'CLOSED' });
    });
  });

  it('not düzenle: modal açılır, kaydet → PATCH {note}', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/toptan-talepleri']}>
        <Routes>
          <Route path="*" element={<AdminToptanTalepleriPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('kafe@example.com')).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: 'Not düzenle' })[0]);
    const ta = screen.getByLabelText('Görüşme notu');
    await user.type(ta, 'Yarın ara');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c as [string, RequestInit])[1]?.method === 'PATCH');
      expect(JSON.parse(String((patch as [string, RequestInit])[1].body))).toEqual({ note: 'Yarın ara' });
    });
  });
});
