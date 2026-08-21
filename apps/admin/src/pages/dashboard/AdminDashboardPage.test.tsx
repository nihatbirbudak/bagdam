import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthProvider } from '../../contexts/AdminAuthContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminDashboardPage } from './AdminDashboardPage';

const DASHBOARD = {
  serverNowIso: '2026-08-24T06:00:00.000Z',
  today: '2026-08-24',
  weekStart: '2026-08-24',
  orders: {
    todayCount: 4,
    todayRevenue: 980.5,
    weekCount: 11,
    weekRevenue: 3120,
    pendingPaymentCount: 2,
    deliveringTodayCount: 3,
  },
  subscriptions: { active: 12, pastDue: 1, cancelRequested: 2, pending: 0, oneTimeActive: 3, newThisWeek: 2 },
  cutoffs: [
    { date: '2026-08-25', zoneSlug: 'urla', zoneName: 'Urla', cutoffAtIso: '2026-08-24T09:00:00.000Z', locked: false, status: 'OPEN', capacity: 100, reserved: 12, cycleCount: 12 },
    { date: '2026-08-27', zoneSlug: 'cesme', zoneName: 'Çeşme', cutoffAtIso: '2026-08-26T09:00:00.000Z', locked: true, status: 'LOCKED', capacity: 40, reserved: 40, cycleCount: 40 },
  ],
  paymentIssues: { failedOrders: 1, unpaidCycles: 2, awaitingPaymentCycles: 0, total: 3 },
  recentEvents: [
    { id: 'e1', type: 'CHARGED', actor: 'SYSTEM', subscriptionId: 's1', cycleId: 'c1', userEmail: 'ayse@example.com', createdAt: '2026-08-24T05:00:00.000Z' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AdminAuthProvider>
        <AdminDashboardPage />
      </AdminAuthProvider>
    </MemoryRouter>,
  );
}

describe('AdminDashboardPage (ekran 21 Özet)', () => {
  beforeEach(() => {
    resetCsrfForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
        if (url.startsWith('/api/v1/admin/dashboard')) return Promise.resolve(jsonResponse(DASHBOARD));
        if (url.startsWith('/api/v1/health')) return Promise.resolve(jsonResponse({ status: 'ok', db: 'up' }));
        if (url.startsWith('/api/v1/auth/me')) return Promise.resolve(jsonResponse({ id: 'u1', email: 'admin@bagdam.com', name: 'Yönetici', role: 'STAFF' }));
        if (url.startsWith('/api/v1/admin/products')) return Promise.resolve(jsonResponse({ items: [], total: 22, page: 1, limit: 1 }));
        if (url.startsWith('/api/v1/admin/media')) return Promise.resolve(jsonResponse({ items: [], total: 85, page: 1, limit: 1 }));
        if (url.startsWith('/api/v1/admin/producers')) return Promise.resolve(jsonResponse([]));
        if (url.startsWith('/api/v1/admin/box-templates')) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sipariş/ciro, abonelik, ödeme problemi ve kesim kartlarını gösterir', async () => {
    renderPage();
    expect(await screen.findByText('Bugünkü sipariş')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Haftalık sipariş')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // aktif abonelik
    expect(screen.getByText(/Bu hafta başlayan 2/)).toBeInTheDocument();
    expect(screen.getByText('Tahsil edilemeyen kutu')).toBeInTheDocument();
    expect(screen.getByText('ilgi gerekiyor')).toBeInTheDocument();
  });

  it('kesim satırları gün adı + doluluk ile listelenir ve ops ekranına bağlanır', async () => {
    renderPage();
    const urla = await screen.findByRole('link', { name: /Salı 25.08.2026 · Urla/ });
    expect(urla).toHaveAttribute('href', '/operasyon/teslimat-gunu?date=2026-08-25&zone=urla');
    expect(screen.getByText('12/100')).toBeInTheDocument();
    expect(screen.getByText('kesim geçti')).toBeInTheDocument();
  });

  it('son abonelik olayları abonelik detayına bağlanır', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /Tahsil edildi · ayse@example.com/ });
    expect(link).toHaveAttribute('href', '/abonelikler/s1');
  });
});
