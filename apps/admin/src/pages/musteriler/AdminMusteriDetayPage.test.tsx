import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthProvider } from '../../contexts/AdminAuthContext';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminMusteriDetayPage } from './AdminMusteriDetayPage';

const USER = {
  id: 'u1', email: 'ayse@example.com', name: 'Ayşe Yılmaz', phone: '0532 000 00 00', role: 'CUSTOMER', isActive: true,
  emailVerifiedAt: null, lastLoginAt: '2026-08-20T11:00:00.000Z', anonymizedAt: null, marketingOptIn: false, createdAt: '2026-08-19T10:00:00.000Z',
};
const DETAIL = {
  ...USER,
  address: { id: 'ad1', fullName: 'Ayşe Yılmaz', phone: '0532 000 00 00', line: 'İskele Mah. 12', zoneId: 'z1', zoneName: 'Urla', zip: '35430', isDefault: true },
  consents: [
    { id: 'c1', kind: 'KVKK_ACK', granted: true, documentId: 'd1', documentTitle: 'KVKK Aydınlatma', documentVersion: 1, source: 'HS_WEB', iysStatus: 'NOT_APPLICABLE', createdAt: '2026-08-19T10:00:00.000Z' },
    { id: 'c2', kind: 'MARKETING_EMAIL', granted: false, documentId: null, source: 'HS_WEB', iysStatus: 'NOT_APPLICABLE', createdAt: '2026-08-19T10:00:00.000Z' },
  ],
  audit: [],
  orders: { items: [], total: 0 },
};
const ANON = { ...DETAIL, email: 'anon+u1@anon.local', name: null, phone: null, isActive: false, anonymizedAt: '2026-08-20T12:00:00.000Z', address: null };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/musteriler/u1']}>
      <AdminAuthProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/musteriler/:id" element={<AdminMusteriDetayPage />} />
          </Routes>
        </ConfirmProvider>
      </AdminAuthProvider>
    </MemoryRouter>,
  );
}

describe('AdminMusteriDetayPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let anonymized = false;

  beforeEach(() => {
    resetCsrfForTests();
    anonymized = false;
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/auth/me')) return Promise.resolve(jsonResponse({ id: 'adm', email: 'admin@bagdam.com', name: 'Admin', role: 'ADMIN' }));
      if (url === '/api/v1/admin/customers/u1/anonymize' && method === 'POST') {
        anonymized = true;
        return Promise.resolve(jsonResponse(ANON));
      }
      if (url === '/api/v1/admin/customers/u1' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(jsonResponse({ ...USER, ...body }));
      }
      if (url === '/api/v1/admin/customers/u1') return Promise.resolve(jsonResponse(anonymized ? ANON : DETAIL));
      if (url.startsWith('/api/v1/admin/audit-logs')) {
        const qs = new URLSearchParams(url.split('?')[1] ?? '');
        const items = qs.get('entityId') === 'u1'
          ? [{ id: 'a1', actorId: null, actorEmail: null, action: 'REGISTER', module: 'auth', entityId: 'u1', summary: 'Kayıt', requestId: null, ipAddress: null, createdAt: '2026-08-19T10:00:00.000Z' }]
          : [];
        return Promise.resolve(jsonResponse({ items, total: items.length, page: 1, limit: 10 }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('profil, adres, onaylar ve audit özeti (ADMIN: /admin/audit-logs?entityId) görünür', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Ad Soyad')).toHaveValue('Ayşe Yılmaz'));
    expect(screen.getByLabelText('E-posta')).toHaveValue('ayse@example.com');
    expect(screen.getByText('İskele Mah. 12')).toBeInTheDocument();
    expect(screen.getByText('Urla')).toBeInTheDocument();
    expect(screen.getByText('KVKK aydınlatma metni onayı')).toBeInTheDocument();
    expect(screen.getByText('KVKK Aydınlatma v1')).toBeInTheDocument();
    expect(screen.getByText('Reddedildi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('auth:REGISTER')).toBeInTheDocument());
    expect(screen.getByText(/F8'de/)).toBeInTheDocument();
  });

  it('ad değişince Kaydet → PATCH yalnız değişen alanla', async () => {
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByLabelText('Ad Soyad');
    await waitFor(() => expect(name).toHaveValue('Ayşe Yılmaz'));
    await user.clear(name);
    await user.type(name, 'Ayşe Y.');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c as [string, RequestInit])[1]?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(String((patch as [string])[0])).toBe('/api/v1/admin/customers/u1');
      expect(JSON.parse(String((patch as [string, RequestInit])[1].body))).toEqual({ name: 'Ayşe Y.' });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled());
  });

  it('Anonimleştir → onay → POST /anonymize → yeniden yükler, uyarı ve Anonim rozeti', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Ad Soyad')).toHaveValue('Ayşe Yılmaz'));
    await user.click(screen.getByRole('button', { name: 'Anonimleştir' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/geri alınamaz/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Anonimleştir' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String((c as [string])[0]) === '/api/v1/admin/customers/u1/anonymize');
      expect(post).toBeTruthy();
      expect((post as [string, RequestInit])[1]?.method).toBe('POST');
    });
    await waitFor(() => expect(screen.getByText(/anonimleştirildi/)).toBeInTheDocument());
    expect(screen.getByText('Anonim')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anonimleştir' })).toBeDisabled();
    expect(screen.getByLabelText('Ad Soyad')).toBeDisabled();
  });
});
