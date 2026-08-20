import { AlertTriangle, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Kontrollü onay diyaloğu (bileşen içi kullanım; global akış için useConfirm). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Onayla',
  cancelLabel = 'İptal',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const isDanger = variant === 'danger';

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

        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              isDanger ? 'bg-accent-soft' : 'bg-butter/60',
            )}
          >
            {isDanger ? (
              <Trash2 className="h-4 w-4 text-accent-dark" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 text-butter-deep" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-brand-900">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-brand-600">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              isDanger ? 'bg-accent-dark hover:bg-accent' : 'bg-butter-deep hover:bg-butter-deep/90',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
