import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminKuponlarPage } from './AdminKuponlarPage';

const COUPONS = [
  { id: 'c1', code: 'HOSGELDIN10', kind: 'PERCENT', value: 10, appliesTo: 'ALL', startsAt: null, endsAt: null, usageLimit: 100, usedCount: 3, isActive: true },
  { id: 'c2', code: 'KARGO', kind: 'AMOUNT', value: 49.9, appliesTo: 'SINGLE', startsAt: null, endsAt: '2026-01-01T00:00:00.000Z', usageLimit: null, usedCount: 0, isActive: false },
];
const DETAIL_C1 = {
  ...COUPONS[0],
  minSubtotal: 250,
  perUserLimit: 1,
  note: 'lansman',
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
  redemptions: [{ id: 'r1', couponId: 'c1', orderId: 'o1', orderNo: 1001, userId: 'u1', customerEmail: 'ayse@example.com', amount: 30, createdAt: '2026-08-20T11:00:00.000Z' }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kuponlar']}>
      <ConfirmProvider>
        <Routes>
          <Route path="*" element={<AdminKuponlarPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('AdminKuponlarPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url === '/api/v1/admin/coupons/c1/active' && method === 'PATCH') return Promise.resolve(jsonResponse({ ...DETAIL_C1, isActive: false }));
      if (url === '/api/v1/admin/coupons/c1' && method === 'GET') return Promise.resolve(jsonResponse(DETAIL_C1));
      if (url === '/api/v1/admin/coupons' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(jsonResponse({ id: 'c3', ...body, usedCount: 0, createdAt: 'x', updatedAt: 'x' }, 201));
      }
      if (url.startsWith('/api/v1/admin/coupons') && method === 'GET') {
        const qs = new URLSearchParams(url.split('?')[1] ?? '');
        const active = qs.get('active');
        const items = active ? COUPONS.filter((c) => String(c.isActive) === active) : COUPONS;
        return Promise.resolve(jsonResponse({ items, total: items.length, page: 1, limit: 25 }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const calls = () => fetchMock.mock.calls.map((c) => [String((c as [string])[0]), (c as [string, RequestInit | undefined])[1]] as const);

  it('listeyi çeker: kod, indirim, kapsam, kullanım, türetilmiş durum; pasif filtresi → ?active=false', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'HOSGELDIN10' })).toBeInTheDocument());
    expect(screen.getByText('%10')).toBeInTheDocument();
    expect(screen.getByText('Tüm sepet')).toBeInTheDocument();
    expect(screen.getByText('3 / 100')).toBeInTheDocument();
    expect(screen.getByText('0 / ∞')).toBeInTheDocument();
    expect(screen.getAllByText('Aktif').length).toBeGreaterThan(0);
    // 'Pasif' hem filtre hapı hem KARGO satırının durum rozeti
    expect(screen.getAllByText('Pasif').length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('button', { name: 'Pasif' }));
    await waitFor(() => expect(calls().some(([u]) => u.includes('active=false'))).toBe(true));
  });

  it('aktif/pasif anahtarı → PATCH /:id/active {isActive:false}', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'HOSGELDIN10' });
    await user.click(screen.getByRole('switch', { name: 'HOSGELDIN10 pasife al' }));
    await waitFor(() => {
      const patch = calls().find(([u, i]) => u === '/api/v1/admin/coupons/c1/active' && i?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ isActive: false });
    });
  });

  it('yeni kupon: doğrulama (kod biçimi) → POST /admin/coupons normalize edilmiş gövde', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'HOSGELDIN10' });
    await user.click(screen.getByRole('button', { name: 'Yeni kupon' }));
    const dialog = await screen.findByRole('dialog');
    // Modal ilk alana 30 ms sonra odaklanır; yazmaya başlamadan önce bekle (odak sıçraması olmasın)
    await new Promise((r) => setTimeout(r, 60));
    await user.click(within(dialog).getByRole('button', { name: 'Oluştur' }));
    expect(await within(dialog).findByText('Kod gerekli')).toBeInTheDocument();
    expect(calls().some(([u, i]) => u === '/api/v1/admin/coupons' && i?.method === 'POST')).toBe(false);

    await user.type(within(dialog).getByLabelText(/^Kod/), 'yaz 2026');
    await user.type(within(dialog).getByLabelText(/Yüzde/), '15');
    await user.type(within(dialog).getByLabelText(/Alt sınır/), '200');
    await user.type(within(dialog).getByLabelText(/Üye başına/), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Oluştur' }));
    await waitFor(() => {
      const post = calls().find(([u, i]) => u === '/api/v1/admin/coupons' && i?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        code: 'YAZ2026',
        kind: 'PERCENT',
        value: 15,
        minSubtotal: 200,
        appliesTo: 'ALL',
        startsAt: null,
        endsAt: null,
        usageLimit: null,
        perUserLimit: 1,
        isActive: true,
        note: null,
      });
    });
  });

  it('kullanımlar: GET /admin/coupons/:id → redemption satırı (sipariş bağlantısı)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'HOSGELDIN10' });
    await user.click(screen.getByRole('button', { name: 'HOSGELDIN10 kullanımları' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('link', { name: '#1001' })).toHaveAttribute('href', '/siparisler/o1'));
    expect(within(dialog).getByText('ayse@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText(/30,00/)).toBeInTheDocument();
  });
});
