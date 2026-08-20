import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { normalizeSchema, toFormState, type FormValues } from '../../features/icerik/schemaForm';
import { SchemaForm } from './SchemaForm';

const FIELDS = normalizeSchema({
  fields: [
    { name: 'eyebrow', label: 'Üst başlık', type: 'text', required: true },
    { name: 'sub', label: 'Alt metin', type: 'textarea' },
    { name: 'enabled', label: 'Göster', type: 'boolean' },
    { name: 'layout', label: 'Düzen', type: 'select', options: [{ value: 'a', label: 'A düzeni' }, { value: 'b', label: 'B düzeni' }] },
    { name: 'img', label: 'Görsel', type: 'image' },
    { name: 'faq', label: 'SSS', type: 'list', itemFields: [{ name: 'q', label: 'Soru', type: 'text' }, { name: 'a', label: 'Cevap', type: 'textarea' }] },
  ],
});

function Harness({ initial, onChange, errors }: { initial: unknown; onChange?: (v: FormValues) => void; errors?: Record<string, string> }) {
  const [state, setState] = useState(() => toFormState(FIELDS, initial));
  return (
    <SchemaForm
      fields={FIELDS}
      values={state.values}
      errors={errors}
      onChange={(values) => {
        setState((s) => ({ ...s, values }));
        onChange?.(values);
      }}
    />
  );
}

describe('SchemaForm', () => {
  it('şemadaki her alan için etiketli giriş üretir; değerleri gösterir', () => {
    render(<Harness initial={{ eyebrow: 'Urla’dan', sub: 'alt', enabled: true, layout: 'b', img: 'assets/images/x.jpg', faq: [{ q: 'S1', a: 'C1' }] }} />);
    expect(screen.getByLabelText(/Üst başlık/)).toHaveValue('Urla’dan');
    expect(screen.getByLabelText('Alt metin')).toHaveValue('alt');
    expect(screen.getByLabelText('Göster')).toBeChecked();
    expect(screen.getByLabelText('Düzen')).toHaveValue('b');
    expect(screen.getByLabelText('Görsel')).toHaveValue('assets/images/x.jpg');
    expect(screen.getByLabelText('Soru')).toHaveValue('S1');
    expect(screen.getByText('S1')).toBeInTheDocument(); // öğe özeti
  });

  it('liste: öğe ekle / sil / sırala değerleri günceller', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ faq: [{ q: 'Birinci', a: '' }] }} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Öğe ekle' }));
    expect(screen.getAllByLabelText('Soru')).toHaveLength(2);
    await user.type(screen.getAllByLabelText('Soru')[1], 'İkinci');
    const last = onChange.mock.calls.at(-1)?.[0] as FormValues;
    expect((last.faq as FormValues[]).map((i) => i.q)).toEqual(['Birinci', 'İkinci']);

    await user.click(screen.getAllByRole('button', { name: 'Yukarı taşı' })[1]);
    const moved = onChange.mock.calls.at(-1)?.[0] as FormValues;
    expect((moved.faq as FormValues[]).map((i) => i.q)).toEqual(['İkinci', 'Birinci']);

    await user.click(screen.getByRole('button', { name: 'Öğe 1 sil' }));
    const removed = onChange.mock.calls.at(-1)?.[0] as FormValues;
    expect((removed.faq as FormValues[]).map((i) => i.q)).toEqual(['Birinci']);
  });

  it('hatalar noktalı yola göre alanın altında görünür', () => {
    render(<Harness initial={{ eyebrow: '', faq: [{ q: '', a: '' }] }} errors={{ eyebrow: 'Zorunlu alan', 'faq.0.q': 'Soru zorunlu' }} />);
    expect(screen.getByText('Zorunlu alan')).toBeInTheDocument();
    const list = screen.getByRole('group', { name: /SSS/ });
    expect(within(list).getByText('Soru zorunlu')).toBeInTheDocument();
    expect(screen.getByLabelText(/Üst başlık/)).toHaveAttribute('aria-invalid', 'true');
  });
});
