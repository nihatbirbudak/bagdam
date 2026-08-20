import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminSiparisDetayPage } from './AdminSiparisDetayPage';

const ORDER = {
  id: 'o1',
  orderNo: 1001,
  kind: 'SUBSCRIPTION',
  status: 'PAID',
  userId: 'u1',
  subscriptionId: 'sub1',
  customerName: 'Ayşe Yılmaz',
  customerEmail: 'ayse@example.com',
  customerPhone: '0532 000 00 00',
  zoneId: 'z1',
  deliveryDateId: 'dd1',
  deliveryDay: 'SALI',
  deliveryOn: '2026-08-25',
  addressSnapshot: { fullName: 'Ayşe Yılmaz', phone: '0532 000 00 00', line: 'İskele Mah. 12', zoneId: 'z1', zoneName: 'Urla', zip: '35430' },
  billingParty: 'INDIVIDUAL',
  billingName: null,
  billingTaxNo: null,
  billingTaxOffice: null,
  subtotal: 300,
  discountTotal: 50,
  shippingFee: 0,
  vatTotal: 2.5,
  grandTotal: 250,
  couponCode: 'HOSGELDIN10',
  paidAt: '2026-08-20T10:00:00.000Z',
  invoiceNo: null,
  invoicePdfPath: null,
  note: 'Kapıya bırakın',
  adminNote: '[2026-08-20 10:05] ilk not',
  cancelledAt: null,
  cancelReason: null,
  lines: [
    { id: 'l1', orderId: 'o1', kind: 'BOX', productId: null, tierSlug: 'orta', name: 'Orta kutu', unit: null, qty: 1, unitPrice: 300, lineTotal: 300, vatRate: 1, pref: null, lotCode: null, metadata: { items: [{ productId: 'p1', name: 'Zeytinyağı', pref: null, boxAmount: '500 ml', lotCode: 'ZY-26' }] } },
  ],
  payments: [
    { id: 'p1', orderId: 'o1', provider: 'MANUAL', kind: 'CHECKOUT', conversationId: 'ord1001abcd', providerPaymentId: 'man_1', paymentMethodId: null, amount: 250, status: 'SUCCEEDED', is3ds: false, isMerchantInitiated: false, linkExpiresAt: null, attemptNo: 1, failureCode: null, failureMessage: null, paidAt: '2026-08-20T10:00:00.000Z', refunds: [], createdAt: '2026-08-20T09:59:00.000Z' },
  ],
  createdAt: '2026-08-20T09:58:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/siparisler/o1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/siparisler/:id" element={<AdminSiparisDetayPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe('AdminSiparisDetayPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  type Loose = Record<string, unknown>;
  let current: Loose;

  beforeEach(() => {
    resetCsrfForTests();
    current = structuredClone(ORDER) as unknown as Loose;
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url === '/api/v1/admin/orders/o1' && method === 'GET') return Promise.resolve(jsonResponse(current));
      if (url === '/api/v1/admin/orders/o1/status' && method === 'PATCH') {
        if (body.status === 'CANCELLED' && !body.reason) return Promise.resolve(jsonResponse({ statusCode: 400, message: 'İptal/iade için neden gerekli', error: 'ORDER_REASON_REQUIRED' }, 400));
        current = { ...current, status: String(body.status), cancelReason: (body.reason as string | undefined) ?? null, cancelledAt: body.status === 'CANCELLED' ? '2026-08-20T12:00:00.000Z' : null };
        return Promise.resolve(jsonResponse(current));
      }
      if (url === '/api/v1/admin/orders/o1/notes' && method === 'POST') {
        current = { ...current, adminNote: `${current.adminNote}\n[2026-08-20 12:00] ${String(body.adminNote)}` };
        return Promise.resolve(jsonResponse(current));
      }
      if (url === '/api/v1/admin/orders/o1/invoice' && method === 'PATCH') {
        current = { ...current, invoiceNo: (body.invoiceNo as string | null) ?? null, invoicePdfPath: (body.invoicePdfPath as string | null) ?? null };
        return Promise.resolve(jsonResponse(current));
      }
      if (url === '/api/v1/admin/orders/o1/billing' && method === 'PATCH') {
        current = { ...current, ...body };
        return Promise.resolve(jsonResponse(current));
      }
      if (url === '/api/v1/admin/payments/p1/refund' && method === 'POST') {
        return Promise.resolve(jsonResponse({ ok: true, refund: { id: 'r1', paymentId: 'p1', amount: body.amount, reason: body.reason ?? null, providerRefundId: 'rf_1', status: 'SUCCEEDED', requestedBy: 'adm', createdAt: '2026-08-20T12:00:00.000Z' }, payment: { ...((current.payments as Loose[])[0] ?? {}), status: 'REFUNDED' }, refundedTotal: body.amount }));
      }
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const calls = () => fetchMock.mock.calls.map((c) => [String((c as [string])[0]), (c as [string, RequestInit | undefined])[1]] as const);

  it('satırlar, toplamlar, ödeme, not, müşteri/teslimat ve izinli geçiş düğmeleri (PAID → Hazırlanıyor / İptal / İade)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sipariş #1001' })).toBeInTheDocument());
    expect(screen.getByText('Orta kutu')).toBeInTheDocument();
    expect(screen.getByText(/Zeytinyağı/)).toBeInTheDocument();
    expect(screen.getByText('Genel toplam')).toBeInTheDocument();
    expect(screen.getByText('ord1001abcd')).toBeInTheDocument();
    expect(screen.getByText('ilk not')).toBeInTheDocument();
    expect(screen.getByText('İskele Mah. 12 · Urla · 35430')).toBeInTheDocument();
    expect(screen.getByText('HOSGELDIN10')).toBeInTheDocument();
    // shared makine: PAID → PREPARING | CANCELLED | REFUNDED
    expect(screen.getByRole('button', { name: 'Hazırlanıyor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İptal edildi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İade edildi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Teslim edildi' })).not.toBeInTheDocument();
  });

  it('Hazırlanıyor → onay → PATCH /status {status:PREPARING}; yeni durumda düğmeler değişir', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Hazırlanıyor' });
    await user.click(screen.getByRole('button', { name: 'Hazırlanıyor' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Hazırlanıyor' }));
    await waitFor(() => {
      const patch = calls().find(([u, i]) => u === '/api/v1/admin/orders/o1/status' && i?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ status: 'PREPARING' });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yolda' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Hazırlanıyor' })).not.toBeInTheDocument();
  });

  it('İptal → neden zorunlu (boş gönderim hata) → PATCH {status:CANCELLED, reason}', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'İptal edildi' });
    await user.click(screen.getByRole('button', { name: 'İptal edildi' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'İptal edildi' }));
    expect(await within(dialog).findByText(/neden gerekli/i)).toBeInTheDocument();
    expect(calls().some(([u, i]) => u === '/api/v1/admin/orders/o1/status' && i?.method === 'PATCH')).toBe(false);
    await user.type(within(dialog).getByLabelText(/Neden/), 'Müşteri vazgeçti');
    await user.click(within(dialog).getByRole('button', { name: 'İptal edildi' }));
    await waitFor(() => {
      const patch = calls().find(([u, i]) => u === '/api/v1/admin/orders/o1/status' && i?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ status: 'CANCELLED', reason: 'Müşteri vazgeçti' });
    });
    await waitFor(() => expect(screen.getByText(/Terminal durum/)).toBeInTheDocument());
  });

  it('not ekle → POST /notes; fatura no → PATCH /invoice; kurumsal fatura doğrulama → PATCH /billing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Sipariş #1001' });

    await user.type(screen.getByLabelText('Yeni not'), 'Telefonla arandı');
    await user.click(screen.getByRole('button', { name: 'Not ekle' }));
    await waitFor(() => {
      const post = calls().find(([u, i]) => u === '/api/v1/admin/orders/o1/notes' && i?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ adminNote: 'Telefonla arandı' });
    });
    await waitFor(() => expect(screen.getByText('Telefonla arandı')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Fatura no'), 'GIB2026000001');
    await user.click(screen.getByRole('button', { name: 'Faturayı kaydet' }));
    await waitFor(() => {
      const patch = calls().find(([u, i]) => u === '/api/v1/admin/orders/o1/invoice' && i?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ invoiceNo: 'GIB2026000001', invoicePdfPath: null });
    });

    await user.selectOptions(screen.getByLabelText('Fatura tarafı'), 'CORPORATE');
    await user.click(screen.getByRole('button', { name: 'Fatura tarafını kaydet' }));
    expect(await screen.findByText(/unvan gerekli/i)).toBeInTheDocument();
    expect(calls().some(([u]) => u === '/api/v1/admin/orders/o1/billing')).toBe(false);
    await user.type(screen.getByLabelText(/^Unvan/), 'Urla Kafe Ltd.');
    await user.type(screen.getByLabelText(/Vergi \/ TC no/), '1234567890');
    await user.type(screen.getByLabelText('Vergi dairesi'), 'Urla');
    await user.click(screen.getByRole('button', { name: 'Fatura tarafını kaydet' }));
    await waitFor(() => {
      const patch = calls().find(([u, i]) => u === '/api/v1/admin/orders/o1/billing' && i?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ billingParty: 'CORPORATE', billingName: 'Urla Kafe Ltd.', billingTaxNo: '1234567890', billingTaxOffice: 'Urla' });
    });
  });

  it('iade: düğme → modal (kalan tutar ön dolu) → POST /admin/payments/:id/refund {amount, reason}', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Sipariş #1001' });
    await user.click(screen.getByRole('button', { name: 'ord1001abcd iade' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/İade tutarı/)).toHaveValue('250');
    await user.type(within(dialog).getByLabelText(/Neden/), 'ayıplı ürün');
    await user.click(within(dialog).getByRole('button', { name: 'İadeyi başlat' }));
    await waitFor(() => {
      const post = calls().find(([u, i]) => u === '/api/v1/admin/payments/p1/refund' && i?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ amount: 250, reason: 'ayıplı ürün' });
    });
  });
});
