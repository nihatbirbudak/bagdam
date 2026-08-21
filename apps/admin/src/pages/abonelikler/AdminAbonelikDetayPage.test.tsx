import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminAbonelikDetayPage } from './AdminAbonelikDetayPage';

function cycle(over: Record<string, unknown> = {}) {
  return {
    id: 'cy1',
    subscriptionId: 's1',
    cycleNo: 2,
    deliveryDateId: 'dd1',
    deliveryOn: '2026-08-25',
    cutoffAt: '2026-08-24T09:00:00.000Z',
    status: 'CHARGED',
    skipSource: null,
    boxPrice: '250.00',
    extrasTotal: '0',
    discount: null,
    shippingFee: null,
    total: '250.00',
    prepaidAmount: '0',
    orderId: 'o1',
    deltaOrderId: null,
    lockedAt: '2026-08-24T09:00:00.000Z',
    skippedAt: null,
    paymentDueAt: null,
    retryCount: 0,
    nextRetryAt: null,
    items: [
      { id: 'i1', cycleId: 'cy1', source: 'TEMPLATE', productId: 'p1', productSlug: 'domates', productName: 'Domates', lotId: null, swapOfProductId: null, pref: null, qty: 1, unit: 'kg', label: '1 kg', unitPrice: '40.00', lotCode: 'L-1', sortOrder: 1 },
      { id: 'i2', cycleId: 'cy1', source: 'EXTRA', productId: 'p2', productSlug: 'zeytin', productName: 'Zeytin', lotId: null, swapOfProductId: null, pref: 'çekirdeksiz', qty: 2, unit: 'kavanoz', label: '2 kavanoz', unitPrice: '0', lotCode: null, sortOrder: 2 },
    ],
    ...over,
  };
}

const SUB = {
  id: 's1',
  userId: 'u1',
  userEmail: 'ayse@example.com',
  userName: 'Ayşe Yılmaz',
  tierId: 't1',
  tierSlug: 'small',
  tierLabel: 'Küçük kutu',
  isOneTime: false,
  status: 'PAST_DUE',
  frequencyWeeks: 1,
  deliveryDay: 'SALI',
  zoneId: 'z1',
  addressId: 'a1',
  paymentMethodId: 'pm1',
  itemPrefs: { zeytin: 'çekirdeksiz' },
  chargeStrategy: 'MERCHANT_INITIATED',
  discountBoxesLeft: 1,
  nextBoxDiscountPct: null,
  skipsUsed: 0,
  skipsResetAt: null,
  failedCycles: 2,
  contractDocId: null,
  startedAt: '2026-07-01T09:00:00.000Z',
  nextDeliveryOn: '2026-09-01',
  nextCutoffAt: '2026-08-31T09:00:00.000Z',
  cancelRequestedAt: null,
  cancelledAt: null,
  completedAt: null,
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-08-20T09:00:00.000Z',
  cycles: [cycle(), cycle({ id: 'cy2', cycleNo: 3, status: 'SCHEDULED', total: null, cutoffAt: '2030-01-01T09:00:00.000Z', orderId: null, items: [] })],
  cancellations: [
    {
      id: 'x1',
      subscriptionId: 's1',
      reason: 'PRICE',
      reasonText: 'pahalı geldi',
      retentionOffered: true,
      outcome: 'RETENTION_ACCEPTED',
      requestedAt: '2026-08-10T09:00:00.000Z',
      effectiveAt: null,
      confirmedAt: null,
      refundAmount: null,
      refundDueAt: null,
    },
  ],
  events: [
    { id: 'e1', subscriptionId: 's1', cycleId: null, type: 'CREATED', actor: 'USER', data: null, createdAt: '2026-07-01T09:00:00.000Z' },
    { id: 'e2', subscriptionId: 's1', cycleId: 'cy1', type: 'PAYMENT_FAILED', actor: 'SYSTEM', data: { attemptNo: 2 }, createdAt: '2026-08-24T10:00:00.000Z' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AdminAbonelikDetayPage (ekran 19 detay)', () => {
  let calls: Array<{ url: string; method: string; body?: unknown }>;

  beforeEach(() => {
    resetCsrfForTests();
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
        if (url === '/api/v1/admin/subscriptions/s1' && method === 'GET') return Promise.resolve(jsonResponse(SUB));
        if (url === '/api/v1/admin/subscriptions/s1' && method === 'PATCH') return Promise.resolve(jsonResponse({ ...SUB, frequencyWeeks: 2 }));
        if (url === '/api/v1/admin/cycles/cy1/status' && method === 'PATCH') return Promise.resolve(jsonResponse(cycle({ status: 'PREPARING' })));
        return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/abonelikler/s1']}>
        <ConfirmProvider>
          <Routes>
            <Route path="/abonelikler/:id" element={<AdminAbonelikDetayPage />} />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>,
    );
  }

  it('künye, PAST_DUE uyarısı, kutu geçmişi, olay günlüğü ve iptal kayıtlarını gösterir', async () => {
    renderPage();
    expect(await screen.findByText(/Tahsilat gecikmiş/)).toBeInTheDocument();
    expect(screen.getByText('Küçük kutu')).toBeInTheDocument();
    expect(screen.getByText('Kutu geçmişi (2)')).toBeInTheDocument();
    expect(screen.getByText('Olay günlüğü (2)')).toBeInTheDocument();
    expect(screen.getByText('İptal kayıtları (1)')).toBeInTheDocument();
    expect(screen.getByText('Tahsilat başarısız')).toBeInTheDocument();
    expect(screen.getByText('Teklif kabul edildi')).toBeInTheDocument();
    // Kalıcı ürün tercihleri
    expect(screen.getByText(/zeytin:/)).toBeInTheDocument();
  });

  it('kutu satırı açılınca içerik (kaynak rozetleriyle) listelenir', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Kutu geçmişi (2)');

    await user.click(screen.getByRole('button', { name: '#2 içeriğini aç' }));
    expect(await screen.findByText(/Domates — 1 kg/)).toBeInTheDocument();
    expect(screen.getByText(/Zeytin — 2 kavanoz \(çekirdeksiz\)/)).toBeInTheDocument();
    expect(screen.getByText('Ekstra')).toBeInTheDocument();
  });

  it('ops geçişi yalnız makinede izinli hedefi gösterir ve PATCH gönderir (CHARGED → Hazırlanıyor)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Kutu geçmişi (2)');

    await user.click(screen.getByRole('button', { name: 'Hazırlanıyor' }));
    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/v1/admin/cycles/cy1/status' && c.method === 'PATCH');
      expect(call?.body).toEqual({ status: 'PREPARING' });
    });
  });

  it('sıklık değişikliği PATCH /admin/subscriptions/:id gövdesine yalnız değişeni koyar', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Kutu geçmişi (2)');

    await user.selectOptions(screen.getByLabelText('Sıklık (hafta)'), '2');
    await user.click(screen.getByRole('button', { name: /Değişiklikleri kaydet/ }));

    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/v1/admin/subscriptions/s1' && c.method === 'PATCH');
      expect(call?.body).toEqual({ frequencyWeeks: 2 });
    });
  });

  it('PAST_DUE aboneliğin durum geçişleri: yalnız Aktif ve İptal (PAUSED/PAST_DUE gizli)', async () => {
    renderPage();
    await screen.findByText('Kutu geçmişi (2)');
    const group = screen.getByText('Durum geçişi').parentElement!;
    const labels = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Aktif', 'İptal edildi']);
  });
});
