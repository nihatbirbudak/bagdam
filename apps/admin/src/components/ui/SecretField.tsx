import { Eye, EyeOff, KeyRound, Undo2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { btn } from '../../lib/buttonStyles';
import { cn } from '../../lib/utils';
import { inputCls, inputErrorCls } from './FormField';

/** Sunucunun gizli alan için döndürdüğü maske (`'••••••'`). */
export const SECRET_MASK = '••••••';

type Props = {
  id?: string;
  /** Sunucuda değer var mı (maskeli gösterim). */
  hasValue: boolean;
  /** Yeni değer; `undefined` = değiştirilmedi (PUT'a gitmez). */
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

/**
 * Gizli ayar alanı (SMTP parolası, iyzico anahtarı…): değer varsa maske + “Değiştir”; değiştirilince yeni değer
 * girilir, “Geri al” eski (sunucudaki) değeri korur. Değer yoksa doğrudan giriş kutusu. Sunucuya yalnız yeni değer gider.
 */
export function SecretField({ id, hasValue, value, onChange, placeholder = 'Yeni değer', disabled, invalid, className }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [editing, setEditing] = useState(!hasValue || value !== undefined);
  const [show, setShow] = useState(false);

  // Sunucudan yeni veri gelince (kaydet sonrası) düzenleme modunu sıfırla
  useEffect(() => {
    setEditing(!hasValue || value !== undefined);
  }, [hasValue, value]);

  if (!editing) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <input
          id={inputId}
          type="text"
          readOnly
          value={SECRET_MASK}
          aria-label="Kayıtlı gizli değer (maskeli)"
          className={cn(inputCls, 'font-mono tracking-widest text-brand-500')}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setEditing(true);
            onChange('');
          }}
          className={cn(btn.secondary, 'shrink-0')}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Değiştir
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative min-w-0 flex-1">
        <input
          id={inputId}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          value={value ?? ''}
          disabled={disabled}
          placeholder={hasValue ? 'Yeni değer (boş bırakılırsa değişmez)' : placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, 'pr-9 font-mono', invalid && inputErrorCls)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-brand-400 hover:text-brand-700"
          aria-label={show ? 'Gizle' : 'Göster'}
          title={show ? 'Gizle' : 'Göster'}
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {hasValue && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setEditing(false);
            setShow(false);
            onChange(undefined);
          }}
          className={cn(btn.ghost, 'shrink-0')}
          title="Kayıtlı değeri koru"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          Geri al
        </button>
      )}
    </div>
  );
}
