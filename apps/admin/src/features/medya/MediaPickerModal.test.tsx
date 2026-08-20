import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMediaList } from '../../lib/adminTypes';
import { MediaPickerModal } from './MediaPickerModal';

const LIST: AdminMediaList = {
  items: [
    {
      id: 'm1',
      url: '/assets/images/zeytinyagi.jpg',
      thumbUrl: null,
      path: 'assets/images/zeytinyagi.jpg',
      thumbPath: null,
      originalName: 'zeytinyagi.jpg',
      mimeType: 'image/jpeg',
      size: 120_000,
      width: 800,
      height: 600,
      alt: 'Zeytinyağı',
      folder: 'urunler',
      createdAt: '2026-08-20T00:00:00.000Z',
    },
    {
      id: 'm2',
      url: '/uploads/sahne/hasat.webp',
      thumbUrl: '/uploads/sahne/hasat.thumb.webp',
      path: 'sahne/hasat.webp',
      thumbPath: 'sahne/hasat.thumb.webp',
      originalName: 'hasat.jpg',
      mimeType: 'image/webp',
      size: 80_000,
      width: 1200,
      height: 800,
      alt: null,
      folder: 'sahne',
      createdAt: '2026-08-20T00:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 24,
  folders: ['urunler', 'sahne'],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MediaPickerModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/admin/media')) return Promise.resolve(jsonResponse(LIST));
      return Promise.resolve(jsonResponse({ statusCode: 404, message: 'Kaynak bulunamadı' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kapalıyken hiçbir şey render etmez', () => {
    render(<MediaPickerModal open={false} onClose={() => undefined} onSelect={() => undefined} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('açılınca medya listesini çeker, klasörleri ve görselleri gösterir; seçim → onSelect + onClose', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<MediaPickerModal open onClose={onClose} onSelect={onSelect} title="Ürün görseli seç" />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ürün görseli seç' })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('option', { name: /zeytinyagi\.jpg/ })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = String((fetchMock.mock.calls[0] as [string])[0]);
    expect(firstUrl).toMatch(/^\/api\/v1\/admin\/media\?/);
    expect(firstUrl).toContain('limit=24');

    // Klasörler yan sütunda
    expect(screen.getByRole('button', { name: 'sahne' })).toBeInTheDocument();

    // Seç düğmesi seçim olmadan pasif
    const secButton = screen.getByRole('button', { name: 'Seç' });
    expect(secButton).toBeDisabled();

    await user.click(screen.getByRole('option', { name: /hasat\.jpg/ }));
    expect(secButton).toBeEnabled();
    await user.click(secButton);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'm2', url: '/uploads/sahne/hasat.webp' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('klasör seçilince istek folder parametresiyle yenilenir', async () => {
    const user = userEvent.setup();
    render(<MediaPickerModal open onClose={() => undefined} onSelect={() => undefined} />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'sahne' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String((c as [string])[0]));
      expect(urls.some((u) => u.includes('folder=sahne'))).toBe(true);
    });
  });
});
