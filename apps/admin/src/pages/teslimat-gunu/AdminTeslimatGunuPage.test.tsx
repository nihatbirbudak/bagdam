import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminTeslimatGunuPage } from './AdminTeslimatGunuPage';

const ZONES = [{ id: 'z1', name: 'Urla', slug: 'urla', fee: 49, freeThreshold: 500, capacityPerDay: 999, isActive: true, sortOrder: 1 }];

const CYCLES = [
  {
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
    lockedAt: null,
    skippedAt: null,
    paymentDueAt: null,
    retryCount: 0,
    nextRetryAt: null,
    items: [],
    userEmail: 'ayse@example.com',
    userName: 'Ayşe Yılmaz',
    tierSlug: 'small',
    zoneName: 'Urla',
    isOneTime: false,
    subscriptionStatus: 'ACTIVE',
    orderNo: 1001,
    orderStatus: 'PAID',
    deltaOrderNo: null,
  },
  {
    id: 'cy2',
    subscriptionId: 's2',
    cycleNo: 1,
    deliveryDateId: 'dd1',
    deliveryOn: '2026-08-25',
    cutoffAt: '2026-08-24T09:00:00.000Z',
    status: 'UNPAID',
    skipSource: null,
    boxPrice: '250.00',
    extrasTotal: '0',
    discount: null,
    shippingFee: null,
    total: '250.00',
    prepaidAmount: '0',
    orderId: 'o2',
    deltaOrderId: null,
    lockedAt: null,
    skippedAt: null,
    paymentDueAt: null,
    retryCount: 1,
    nextRetryAt: null,
    items: [],
    userEmail: 'bora@example.com',
    userName: 'Bora Kaya',
    tierSlug: 'sezon',
    zoneName: 'Urla',
    isOneTime: true,
    subscriptionStatus: 'ACTIVE',
    orderNo: 1002,
    orderStatus: 'PENDING_PAYMENT',
    deltaOrderNo: null,
  },
];

const ORDERS = [
  {
    id: 'o5',
    orderNo: 1005,
    kind: 'SINGLE',
    status: 'PAID',
    customerName: 'Cem Demir',
    customerEmail: 'cem@example.com',
    deliveryDay: 'SALI',
    deliveryOn: '2026-08-25',
    grandTotal: '120.00',
    lineCount: 2,
    paidAt: '2026-08-23T09:00:00.000Z',
    createdAt: '2026-08-23T08:00:00.000Z',
  },
];

const PICK = [
  { productId: 'p1', productSlug: 'domates', productName: 'Domates', unit: 'kg', lotCode: 'L-1', totalQty: 3, boxCount: 2, extraCount: 1, boxQty: 2, extraQty: 1, labels: ['1 kg'], prefs: [{ pref: 'çekirdeksiz', qty: 2, count: 2 }] },
  { productId: 'p2', productSlug: 'zeytin', productName: 'Zeytin', unit: 'kavanoz', lotCode: null, totalQty: 2, boxCount: 2, extraCount: 0, boxQty: 2, extraQty: 0, labels: [], prefs: [] },
];

const PACKING = [
  {
    cycleId: 'cy1',
    subscriptionId: 's1',
    orderNo: 1001,
    customerName: 'Ayşe Yılmaz',
    customerPhone: '05550000000',
    addressLine: 'Urla, İzmir',
    zoneName: 'Urla',
    tierSlug: 'small',
    tierLabel: 'Küçük kutu',
    curatorName: 'Zeynep',
    status: 'CHARGED',
    items: [
      { productId: 'p1', productSlug: 'domates', name: 'Domates', label: '1 kg', pref: null, source: 'TEMPLATE', lotCode: 'L-1', qty: 1, unit: 'kg' },
      { productId: 'p2', productSlug: 'zeytin', name: 'Zeytin', label: '1 kavanoz', pref: 'çekirdeksiz', source: 'EXTRA', lotCode: null, qty: 1, unit: 'kavanoz' },
    ],
    note: 'Kapıda köpek var',
    cycleNo: 2,
    isOneTime: false,
    deliveryOn: '2026-08-25',
    deliveryDay: 'sali',
    zoneSlug: 'urla',
    customerEmail: 'ayse@example.com',
    addressZip: '35430',
    itemPrefs: { zeytin: 'çekirdeksiz' },
    orderStatus: 'PAID',
    adminNote: null,
    total: 250,
    boxItemCount: 1,
    extraItemCount: 1,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(search = '?date=2026-08-25&zone=urla') {
  return render(
    <MemoryRouter initialEntries={[`/operasyon/teslimat-gunu${search}`]}>
      <ConfirmProvider>
        <Routes>
          <Route path="*" element={<AdminTeslimatGunuPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

const DAY_SUMMARY = {
  date: '2026-08-25',
  zone: 'urla',
  serverNowIso: '2026-08-24T06:00:00.000Z',
  cycleCountsByStatus: { CHARGED: 1, UNPAID: 1 },
  cycleCount: 2,
  fulfillableCount: 1,
  deliveredCount: 0,
  skippedCount: 0,
  unpaidCount: 1,
  awaitingPaymentCount: 0,
  boxCountByTier: [{ tierSlug: 'small', tierLabel: 'Küçük kutu', count: 1 }],
  boxItemCount: 1,
  extraItemCount: 1,
  revenue: 250,
  standaloneOrderCount: 1,
  standaloneOrderRevenue: 120,
  zones: [{ zoneId: 'z1', zoneSlug: 'urla', zoneName: 'Urla', deliveryDateId: 'dd1', cutoffAtIso: '2026-08-24T09:00:00.000Z', locked: false, status: 'OPEN', capacity: 100, reserved: 3, cycleCount: 2, fulfillableCount: 1 }],
};

const BULK_RESULT = {
  status: 'PREPARING',
  requested: 1,
  updated: 1,
  failed: 0,
  skipped: 0,
  items: [{ kind: 'cycle', id: 'cy1', ok: true, from: 'CHARGED', to: 'PREPARING' }],
};

describe('AdminTeslimatGunuPage (ekran 20)', () => {
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
        if (url.startsWith('/api/v1/admin/delivery/zones')) return Promise.resolve(jsonResponse(ZONES));
        if (url.startsWith('/api/v1/admin/cycles?')) return Promise.resolve(jsonResponse(CYCLES));
        if (url.startsWith('/api/v1/admin/orders')) return Promise.resolve(jsonResponse({ items: ORDERS, total: 1, page: 1, limit: 200 }));
        if (url.startsWith('/api/v1/admin/ops/pick-list')) return Promise.resolve(jsonResponse(PICK));
        if (url.startsWith('/api/v1/admin/ops/packing-list')) return Promise.resolve(jsonResponse(PACKING));
        if (url.startsWith('/api/v1/admin/ops/day-summary')) return Promise.resolve(jsonResponse(DAY_SUMMARY));
        if (url.startsWith('/api/v1/admin/ops/bulk-status') && method === 'POST') return Promise.resolve(jsonResponse(BULK_RESULT));
        return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gün + bölge ile kutu, sipariş ve özet uçlarını çağırır; uyarıyı gösterir', async () => {
    renderPage();
    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();

    const cyclesCall = calls.map((c) => c.url).find((u) => u.includes('/admin/cycles?'));
    expect(cyclesCall).toContain('date=2026-08-25');
    expect(cyclesCall).toContain('zone=urla');
    expect(calls.map((c) => c.url).find((u) => u.includes('/admin/orders'))).toContain('deliveryOn=2026-08-25');
    expect(calls.map((c) => c.url).find((u) => u.includes('/admin/ops/day-summary'))).toContain('date=2026-08-25');

    expect(screen.getByText(/1 kutu tahsil edilemedi/)).toBeInTheDocument();
    expect(screen.getByText(/Küçük kutu: 1/)).toBeInTheDocument();
  });

  it('toplama listesi sekmesi ürün bazında toplamı ve tercih dağılımını gösterir', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ayşe Yılmaz');

    await user.click(screen.getByRole('tab', { name: 'Toplama listesi' }));
    expect(await screen.findByText('Domates')).toBeInTheDocument();
    expect(screen.getByText('3 kg')).toBeInTheDocument();
    expect(screen.getAllByText('2 kavanoz').length).toBeGreaterThan(0); // toplam + kutu miktarı
    expect(screen.getByText('çekirdeksiz ×2')).toBeInTheDocument();
    expect(screen.getByText(/2 farklı ürün/)).toBeInTheDocument();
  });

  it('paketleme listesi fişleri müşteri bazında, tercih ve notla birlikte basar', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ayşe Yılmaz');

    await user.click(screen.getByRole('tab', { name: 'Paketleme listesi' }));
    expect(await screen.findByText('05550000000 · Urla, İzmir (35430)')).toBeInTheDocument();
    expect(screen.getByText('Zeytin — 1 kavanoz (çekirdeksiz)')).toBeInTheDocument();
    expect(screen.getByText(/küratör: Zeynep/)).toBeInTheDocument();
    expect(screen.getByText('Not: Kapıda köpek var')).toBeInTheDocument();
    expect(screen.getByText(/Kalıcı tercihler:/)).toBeInTheDocument();
  });

  it('toplu durum tek POST /admin/ops/bulk-status gönderir (skipInvalid ile)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ayşe Yılmaz');

    await user.click(screen.getByRole('checkbox', { name: 'ayse@example.com kutusunu seç' }));
    await user.selectOptions(await screen.findByLabelText('Toplu durum hedefi'), 'PREPARING');
    await user.click(screen.getByRole('button', { name: /Uygula/ }));

    await waitFor(() => {
      const call = calls.find((c) => c.url.endsWith('/admin/ops/bulk-status') && c.method === 'POST');
      expect(call?.body).toEqual({ skipInvalid: true, cycleIds: ['cy1'], orderIds: [], status: 'PREPARING' });
    });
  });

  it('UNPAID kutu seçilirse hazırlanıyor hedefi sunulmaz (cycle makinesi izin vermiyor)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bora Kaya');

    await user.click(screen.getByRole('checkbox', { name: 'bora@example.com kutusunu seç' }));
    const select = await screen.findByLabelText('Toplu durum hedefi');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).not.toContain('PREPARING');
  });

  it('sipariş seçiliyken DELIVERY_FAILED yalnız siparişe uygulanır', async () => {
    const user = userEvent.setup();
    renderPage('?date=2026-08-25&zone=urla&sekme=siparisler');
    await screen.findByText('Cem Demir');

    await user.click(screen.getByRole('checkbox', { name: '#1005 siparişini seç' }));
    const select = await screen.findByLabelText('Toplu durum hedefi');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).toContain('PREPARING');
    expect(options).not.toContain('DELIVERY_FAILED'); // PAID → DELIVERY_FAILED geçişi yok
  });
});
