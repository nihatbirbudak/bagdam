import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RichTextLite, normalizeEditorHtml, plainTextToHtml } from './RichTextLite';

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (html: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <RichTextLite
      value={value}
      onChange={(html) => {
        setValue(html);
        onChange?.(html);
      }}
      aria-label="Gövde"
    />
  );
}

describe('RichTextLite yardımcıları', () => {
  it('normalizeEditorHtml: yalnız <br>/boş <p> → boş string; içerik korunur', () => {
    expect(normalizeEditorHtml('<br>')).toBe('');
    expect(normalizeEditorHtml('<p><br></p>')).toBe('');
    expect(normalizeEditorHtml('<p>Merhaba</p>')).toBe('<p>Merhaba</p>');
  });

  it('plainTextToHtml: boş satır → paragraf, tek satır → kaçışlı metin, satır sonu → <br>', () => {
    expect(plainTextToHtml('tek <satır>')).toBe('tek &lt;satır&gt;');
    expect(plainTextToHtml('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
    expect(plainTextToHtml('  ')).toBe('');
  });
});

describe('RichTextLite bileşeni', () => {
  it('değeri contenteditable alana basar; araç çubuğu düğmeleri var', () => {
    render(<Harness initial="<p>Merhaba <b>dünya</b></p>" />);
    const box = screen.getByRole('textbox', { name: 'Gövde' });
    expect(box.innerHTML).toBe('<p>Merhaba <b>dünya</b></p>');
    for (const name of ['Kalın', 'İtalik', 'Başlık 2', 'Başlık 3', 'Madde listesi', 'Numaralı liste', 'Bağlantı ekle', 'Biçimi temizle']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('yazınca onChange HTML ile çağrılır', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole('textbox', { name: 'Gövde' });
    box.innerHTML = '<p>Yeni</p>';
    fireEvent.input(box);
    expect(onChange).toHaveBeenLastCalledWith('<p>Yeni</p>');
  });

  it('HTML modu: kaynak düzenlenir ve görünüme dönünce editöre yansır', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="<p>A</p>" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /HTML/ }));
    const ta = screen.getByRole('textbox', { name: 'Gövde (HTML)' });
    expect(ta).toHaveValue('<p>A</p>');
    fireEvent.change(ta, { target: { value: '<h2>B</h2>' } });
    expect(onChange).toHaveBeenLastCalledWith('<h2>B</h2>');
    await user.click(screen.getByRole('button', { name: /HTML/ }));
    expect(screen.getByRole('textbox', { name: 'Gövde' }).innerHTML).toBe('<h2>B</h2>');
  });

  it('yapıştırma düz metni paragraflara çevirir (execCommand yoksa sona ekler)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole('textbox', { name: 'Gövde' });
    fireEvent.paste(box, { clipboardData: { getData: () => 'ilk\n\nikinci' } });
    expect(onChange).toHaveBeenLastCalledWith('<p>ilk</p><p>ikinci</p>');
  });
});
