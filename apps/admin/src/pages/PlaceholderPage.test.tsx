import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PlaceholderPage } from './PlaceholderPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<PlaceholderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PlaceholderPage', () => {
  it('menüdeki yer tutucu yol için başlık ve faz metnini gösterir', () => {
    renderAt('/icerik/gunluk');
    expect(screen.getByRole('heading', { level: 1, name: 'Günlük' })).toBeInTheDocument();
    expect(screen.getByText(/fazında geliyor/)).toBeInTheDocument();
    expect(screen.getByText('F5')).toBeInTheDocument();
  });

  it('menüde olmayan yolda 404 gösterir', () => {
    renderAt('/yok-boyle-bir-sayfa');
    expect(screen.getByRole('heading', { level: 1, name: 'Sayfa bulunamadı' })).toBeInTheDocument();
  });
});
