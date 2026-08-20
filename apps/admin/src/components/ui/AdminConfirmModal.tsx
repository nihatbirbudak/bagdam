import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
};

/** ConfirmProvider'ın kullandığı onay penceresi (Escape ile kapanır, İptal'e odaklanır). */
export function AdminConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Onayla',
  onConfirm,
  onCancel,
  danger = false,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      aria-modal="true"
      role="dialog"
      aria-labelledby="admin-confirm-title"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-brand-200 bg-white p-6 shadow-xl animate-pop-in">
        <div className="flex items-start gap-3">
          {danger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft">
              <AlertTriangle className="h-5 w-5 text-accent-dark" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <h3 id="admin-confirm-title" className="text-base font-semibold text-brand-900">{title}</h3>
            <p className="mt-1 text-sm text-brand-600">{description}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium text-white',
              danger ? 'bg-accent-dark hover:bg-accent' : 'bg-accent hover:bg-accent-dark',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
