import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SECRET_MASK, SecretField } from './SecretField';

function Harness({ hasValue, onChange }: { hasValue: boolean; onChange?: (v: string | undefined) => void }) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <SecretField
      hasValue={hasValue}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('SecretField', () => {
  it('değer varsa maske + “Değiştir”; değiştirilince giriş açılır, “Geri al” eski değeri korur (undefined)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness hasValue onChange={onChange} />);
    expect(screen.getByLabelText('Kayıtlı gizli değer (maskeli)')).toHaveValue(SECRET_MASK);
    await user.click(screen.getByRole('button', { name: 'Değiştir' }));
    const input = screen.getByPlaceholderText(/Yeni değer/);
    await user.type(input, 'abc');
    expect(onChange).toHaveBeenLastCalledWith('abc');
    await user.click(screen.getByRole('button', { name: 'Göster' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText('Kayıtlı gizli değer (maskeli)')).toBeInTheDocument();
  });

  it('değer yoksa doğrudan giriş kutusu; “Geri al” yok', () => {
    render(<Harness hasValue={false} />);
    expect(screen.queryByRole('button', { name: 'Değiştir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Geri al' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Yeni değer')).toBeInTheDocument();
  });
});
