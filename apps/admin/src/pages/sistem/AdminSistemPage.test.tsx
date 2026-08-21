import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthProvider } from '../../contexts/AdminAuthContext';
import { resetCsrfForTests } from '../../lib/api';
import { AdminSistemPage } from './AdminSistemPage';

const HEALTH = {
  status: 'ok',
  checkedAt: '2026-08-21T06:00:00.000Z',
  version: '0.1.0',
  env: 'development',
  siteMode: 'full',
  nodeVersion: 'v22.14.0',
  uptimeSeconds: 3 * 3600 + 12 * 60,
  timezone: { env: 'Europe/Istanbul', resolved: 'Europe/Istanbul' },
  memory: { rssMb: 142.3, heapUsedMb: 61.7 },
  db: { status: 'up', latencyMs: 4 },
  scheduler: {
    enabled: false,
    instance: null,
    failedRuns24h: 1,
    jobs: [
      { id: 'cl1', name: 'cycles:ensure', status: 'SUCCESS', itemsProcessed: 3, errors: 0, details: null, startedAt: '2026-08-21T05:00:00.000Z', finishedAt: '2026-08-21T05:00:01.000Z', durationMs: 1200 },
      { id: 'cl2', name: 'payments:retry', status: 'FAILED', itemsProcessed: 0, errors: 1, details: { error: 'PSP erişilemedi' }, startedAt: '2026-08-21T04:00:00.000Z', finishedAt: '2026-08-21T04:00:02.000Z', durationMs: 2000 },
    ],
  },
  systemLogs24h: { error: 2, warn: 5 },
  mail24h: { SKIPPED: 4 },
  mailDisabled: true,
  webhooks24h: { total: 2, invalidSignature: 1, failed: 0 },
  paymentIssues: { unpaidCycles: 1, failedOrders: 0 },
  jobRunAllowed: true,
  warnings: ['Son 24 saatte 1 cron koşusu başarısız.'],
};

const SYSTEM_LOGS = {
  items: [
    {
      id: 's1',
      level: 'error',
      module: 'http',
      action: 'POST',
      message: 'Beklenmeyen hata',
      requestId: 'rid-1',
      userId: null,
      metadata: { status: 500, path: '/api/v1/checkout?token=[redacted]' },
      fingerprint: 'abc',
      occurrenceCount: 3,
      firstSeenAt: '2026-08-21T05:00:00.000Z',
      lastSeenAt: '2026-08-21T05:30:00.000Z',
      createdAt: '2026-08-21T05:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

const WEBHOOKS = {
  items: [
    {
      id: 'w1',
      provider: 'PAYTR',
      eventType: 'payment.callback',
      providerRef: 'BGD-1001',
      payload: { status: 'success', hash: '[redacted]' },
      signatureValid: false,
      status: 'FAILED',
      error: 'HASH_INVALID',
      receivedAt: '2026-08-21T04:00:00.000Z',
      processedAt: null,
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(entry = '/sistem') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminAuthProvider>
        <Routes>
          <Route path="*" element={<AdminSistemPage />} />
        </Routes>
      </AdminAuthProvider>
    </MemoryRouter>,
  );
}

describe('AdminSistemPage (ekran 22 Sistem)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetCsrfForTests();
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url.startsWith('/api/v1/auth/me')) return Promise.resolve(jsonResponse({ id: 'u1', email: 'admin@bagdam.com', name: 'Yönetici', role: 'ADMIN' }));
      if (url.startsWith('/api/v1/admin/health/detailed')) return Promise.resolve(jsonResponse(HEALTH));
      if (url.startsWith('/api/v1/admin/jobs')) return Promise.resolve(jsonResponse([], 403));
      if (url.startsWith('/api/v1/admin/system-logs')) return Promise.resolve(jsonResponse(SYSTEM_LOGS));
      if (url.startsWith('/api/v1/admin/webhook-events')) return Promise.resolve(jsonResponse(WEBHOOKS));
      if (url.startsWith('/api/v1/admin/cron-logs')) return Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }));
      if (url.startsWith('/api/v1/admin/audit-logs')) return Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }));
      if (url.startsWith('/api/v1/admin/mail-logs')) return Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }));
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sağlık sekmesi: kart alanları, uyarı listesi ve job tablosu (kayıt defteri 403 olsa da son koşular)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Uyarı var')).toBeInTheDocument());
    expect(screen.getByText('v22.14.0')).toBeInTheDocument();
    expect(screen.getByText('3 sa 12 dk')).toBeInTheDocument();
    expect(screen.getByText('4 ms')).toBeInTheDocument();
    // Uyarılar listelenir
    expect(screen.getByText('Son 24 saatte 1 cron koşusu başarısız.')).toBeInTheDocument();
    // 24 saatlik özetler Türkçeleşir
    expect(screen.getByText('hata 2 · uyarı 5')).toBeInTheDocument();
    expect(screen.getByText('atlandı 4 (DISABLE_MAIL)')).toBeInTheDocument();
    // /admin/jobs 403 → yalnız sağlık kartındaki son koşular listelenir
    const table = within(screen.getByRole('table'));
    expect(table.getByText('cycles:ensure')).toBeInTheDocument();
    expect(table.getByText('payments:retry')).toBeInTheDocument();
    expect(table.getByText('Başarısız')).toBeInTheDocument();
  });

  it('sekme değişimi: Sistem sekmesi listeyi çeker, Detay penceresi redakte metadata gösterir', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Uyarı var')).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: 'Sistem' }));
    await waitFor(() => expect(screen.getByText('Beklenmeyen hata')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String((c as [string])[0]).startsWith('/api/v1/admin/system-logs'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Detay' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('rid-1')).toBeInTheDocument();
    expect(dialog.getByText(/\[redacted\]/)).toBeInTheDocument();
  });

  it('webhook sekmesi: geçersiz imza rozeti ve redakte gövde', async () => {
    const user = userEvent.setup();
    renderPage('/sistem?sekme=webhook');
    await waitFor(() => expect(screen.getByText('BGD-1001')).toBeInTheDocument());
    expect(screen.getByText('geçersiz')).toBeInTheDocument();
    expect(screen.getAllByText('Hata').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Detay' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('HASH_INVALID')).toBeInTheDocument();
    expect(dialog.getByText(/"hash": "\[redacted\]"/)).toBeInTheDocument();
  });
});
