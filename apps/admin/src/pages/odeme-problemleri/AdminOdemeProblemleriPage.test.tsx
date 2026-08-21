import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminOdemeProblemleriPage } from './AdminOdemeProblemleriPage';

const CYCLE_ISSUE = {
  kind: 'CYCLE',
  id: 'c1',
  orderId: 'o1',
  orderNo: 1001,
  cycleId: 'c1',
  cycleNo: 3,
  subscriptionId: 's1',
  status: 'UNPAID',
  customerName: 'Ayşe Yılmaz',
  customerEmail: 'ayse@example.com',
  customerPhone: '05550000000',
  amount: 250,
  deliveryOn: '2026-08-30',
  retryCount: 1,
  nextRetryAtIso: '2026-08-26T21:00:00.000Z',
  paymentDueAtIso: null,
  paymentLinkUrl: null,
  lastFailureCode: 'INSUFFICIENT_FUNDS',
  lastFailureMessage: 'Yetersiz bakiye',
  lastAttemptAtIso: '2026-08-26T09:00:00.000Z',
  hasCard: true,
  subscriptionStatus: 'ACTIVE',
  failedCycles: 1,
  createdAtIso: '2026-08-26T09:00:00.000Z',
};

const ORDER_ISSUE = {
  ...CYCLE_ISSUE,
  kind: 'ORDER',
  id: 'o9',
  orderId: 'o9',
  orderNo: 1009,
  cycleId: null,
  cycleNo: null,
  subscriptionId: null,
  status: 'PAYMENT_FAILED',
  customerName: 'Bora Kaya',
  customerEmail: 'bora@example.com',
  hasCard: false,
  subscriptionStatus: null,
  failedCycles: 0,
  amount: 180,
  deliveryOn: '2026-08-29',
  lastFailureCode: 'DO_NOT_HONOR',
  lastFailureMessage: 'Banka işlemi reddetti',
};

function list(items: unknown[]) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 25,
    counts: {
      failedOrders: items.filter((i) => (i as { kind: string }).kind === 'ORDER').length,
      unpaidCycles: items.filter((i) => (i as { status: string }).status === 'UNPAID').length,
      awaitingPaymentCycles: items.filter((i) => (i as { status: string }).status === 'AWAITING_PAYMENT').length,
      total: items.length,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/odeme-problemleri${search}`]}>
      <ConfirmProvider>
        <Routes>
          <Route path="*" element={<AdminOdemeProblemleriPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('AdminOdemeProblemleriPage (ekran 18)', () => {
  let calls: Array<{ url: string; method: string; body?: unknown }>;

  function install(handler: (url: string, method: string) => Response | null) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      const res = handler(url, method);
      return Promise.resolve(res ?? jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    resetCsrfForTests();
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('birleşik listede kutu ve sipariş satırlarını gösterir', async () => {
    install((url) => (url.startsWith('/api/v1/admin/payment-issues') ? jsonResponse(list([CYCLE_ISSUE, ORDER_ISSUE])) : null));
    renderPage();

    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Bora Kaya')).toBeInTheDocument();
    expect(screen.getByText('Tahsil edilemedi')).toBeInTheDocument();
    expect(screen.getByText('Ödeme başarısız')).toBeInTheDocument();
    expect(screen.getByText(/INSUFFICIENT_FUNDS: Yetersiz bakiye/)).toBeInTheDocument();
    // Sipariş satırında kutu aksiyonları görünmez
    expect(screen.getAllByRole('button', { name: /Yeniden çek/ })).toHaveLength(1);
  });

  it('kaynak filtresi uca kind parametresi gönderir', async () => {
    const fetchMock = install((url) => (url.startsWith('/api/v1/admin/payment-issues') ? jsonResponse(list([CYCLE_ISSUE])) : null));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ayşe Yılmaz');

    await user.click(screen.getByRole('button', { name: 'Siparişler' }));
    await waitFor(() => {
      const last = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/admin/payment-issues')).pop();
      expect(last).toContain('kind=ORDER');
    });
  });

  it('saklı kart yoksa "yeniden çek" gösterilmez, ödeme linki gösterilir', async () => {
    install((url) => (url.startsWith('/api/v1/admin/payment-issues') ? jsonResponse(list([{ ...CYCLE_ISSUE, hasCard: false }])) : null));
    renderPage();

    expect(await screen.findByText('saklı kart yok')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Yeniden çek/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ödeme linki/ })).toBeInTheDocument();
  });

  it('"yeniden çek" onaydan sonra POST /admin/cycles/:id/charge çağırır', async () => {
    const user = userEvent.setup();
    install((url, method) => {
      if (url.startsWith('/api/v1/admin/payment-issues')) return jsonResponse(list([CYCLE_ISSUE]));
      if (url === '/api/v1/admin/cycles/c1/charge' && method === 'POST') return jsonResponse({ id: 'c1', status: 'CHARGED' });
      return null;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Yeniden çek/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Yeniden çek' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/admin/cycles/c1/charge' && c.method === 'POST')).toBe(true));
  });

  it('"ödeme linki" POST /admin/cycles/:id/send-payment-link çağırır', async () => {
    const user = userEvent.setup();
    install((url, method) => {
      if (url.startsWith('/api/v1/admin/payment-issues')) return jsonResponse(list([CYCLE_ISSUE]));
      if (url === '/api/v1/admin/cycles/c1/send-payment-link' && method === 'POST') {
        return jsonResponse({ cycle: { id: 'c1', cycleNo: 3, status: 'AWAITING_PAYMENT', paymentDueAt: null }, linkToken: 'tok', linkExpiresAt: '2026-08-27T09:00:00.000Z' });
      }
      return null;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Ödeme linki/ }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/admin/cycles/c1/send-payment-link' && c.method === 'POST')).toBe(true));
  });

  it('kutu satırından not → PATCH /admin/subscriptions/:id {note}', async () => {
    const user = userEvent.setup();
    install((url, method) => {
      if (url.startsWith('/api/v1/admin/payment-issues')) return jsonResponse(list([CYCLE_ISSUE]));
      if (url === '/api/v1/admin/subscriptions/s1' && method === 'PATCH') return jsonResponse({ id: 's1' });
      return null;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'ayse@example.com için not ekle' }));
    await user.type(await screen.findByLabelText(/Not/), 'Müşteri arandı, kart güncelleyecek');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/v1/admin/subscriptions/s1' && c.method === 'PATCH');
      expect(call?.body).toEqual({ note: 'Müşteri arandı, kart güncelleyecek' });
    });
  });

  it('sipariş satırından not → POST /admin/orders/:id/notes', async () => {
    const user = userEvent.setup();
    install((url, method) => {
      if (url.startsWith('/api/v1/admin/payment-issues')) return jsonResponse(list([ORDER_ISSUE]));
      if (url === '/api/v1/admin/orders/o9/notes' && method === 'POST') return jsonResponse({ id: 'o9' });
      return null;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'bora@example.com için not ekle' }));
    await user.type(await screen.findByLabelText(/Not/), 'Kart reddedildi, arandı');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/v1/admin/orders/o9/notes' && c.method === 'POST');
      expect(call?.body).toEqual({ adminNote: 'Kart reddedildi, arandı' });
    });
  });
});
