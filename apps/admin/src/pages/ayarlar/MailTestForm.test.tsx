import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfForTests } from '../../lib/api';
import { toast, type ToastItem } from '../../lib/toast';
import { MailTestForm } from './AdminAyarlarPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MailTestForm (Ayarlar › E-posta › test gönder)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let response: { body: unknown; status: number };
  let toasts: ToastItem[] = [];
  let unsubscribe: () => void = () => undefined;

  beforeEach(() => {
    resetCsrfForTests();
    toasts = [];
    unsubscribe = toast.subscribe((items) => {
      toasts = items;
    });
    response = { body: { id: 'm1', status: 'SKIPPED', to: 'a@b.co', error: 'preview:apps/api/logs/mail/m1.html' }, status: 200 };
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/csrf')) return Promise.resolve(jsonResponse({ csrfToken: 't' }));
      if (url === '/api/v1/admin/settings/mail/test' && init?.method === 'POST') return Promise.resolve(jsonResponse(response.body, response.status));
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    unsubscribe();
    vi.unstubAllGlobals();
  });

  it('geçersiz adres → istek atılmaz, hata metni', async () => {
    const user = userEvent.setup();
    render(<MailTestForm defaultTo="" />);
    await user.type(screen.getByLabelText('Test alıcısı'), 'gecersiz');
    await user.click(screen.getByRole('button', { name: 'Test e-postası gönder' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Geçerli bir e-posta girin');
    expect(fetchMock.mock.calls.some((c) => String((c as [string])[0]).includes('/mail/test'))).toBe(false);
  });

  it('POST /admin/settings/mail/test {to}; SKIPPED (DISABLE_MAIL) → bilgi toast + önizleme yolu', async () => {
    const user = userEvent.setup();
    render(<MailTestForm defaultTo="a@b.co" />);
    expect(screen.getByLabelText('Test alıcısı')).toHaveValue('a@b.co');
    await user.click(screen.getByRole('button', { name: 'Test e-postası gönder' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String((c as [string])[0]) === '/api/v1/admin/settings/mail/test');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post as [string, RequestInit])[1].body))).toEqual({ to: 'a@b.co' });
    });
    await waitFor(() => expect(toasts.some((t) => t.type === 'info' && /DISABLE_MAIL/.test(t.message) && /m1\.html/.test(t.message))).toBe(true));
  });

  it('SENT → başarı; 501 (MailModule bağlı değil) → bilgi', async () => {
    const user = userEvent.setup();
    response = { body: { status: 'SENT', to: 'a@b.co' }, status: 200 };
    render(<MailTestForm defaultTo="a@b.co" />);
    await user.click(screen.getByRole('button', { name: 'Test e-postası gönder' }));
    await waitFor(() => expect(toasts.some((t) => t.type === 'success' && /gönderildi/i.test(t.message))).toBe(true));

    response = { body: { statusCode: 501, message: 'F6', error: 'NOT_IMPLEMENTED' }, status: 501 };
    await user.click(screen.getByRole('button', { name: 'Test e-postası gönder' }));
    await waitFor(() => expect(toasts.some((t) => t.type === 'info' && /MailModule/.test(t.message))).toBe(true));
  });
});
