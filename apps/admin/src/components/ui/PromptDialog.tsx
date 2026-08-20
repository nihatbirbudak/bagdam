import { Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

interface PromptDialogProps {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/** Tek alanlı metin giriş diyaloğu (ör. yeniden adlandır). */
export function PromptDialog({
  open,
  title,
  label,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Kaydet',
  cancelLabel = 'İptal',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [open, defaultValue]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onCancel} aria-hidden />
      <div className="relative w-full max-w-sm rounded-lg border border-brand-300 bg-white p-6 shadow-xl animate-pop-in">
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-3 top-3 rounded-full p-1 text-brand-400 transition-colors hover:bg-brand-100 hover:text-brand-600"
          aria-label="Kapat"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10">
            <Pencil className="h-4 w-4 text-accent" aria-hidden />
          </div>
          <h3 className="text-sm font-semibold text-brand-900">{title}</h3>
        </div>

        <form onSubmit={handleSubmit}>
          {label && <label className="mb-1.5 block text-xs font-medium text-brand-600">{label}</label>}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-brand-300 px-3 py-2 text-sm text-brand-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
