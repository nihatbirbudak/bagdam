import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ModalProps = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** max-w sınıfı (varsayılan max-w-lg). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Arka plana tıklayınca kapanmasın (yükleme sırasında). */
  lockBackdrop?: boolean;
  className?: string;
};

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
};

/** Genel amaçlı diyalog: Escape ile kapanır, ilk odaklanabilir öğeye odaklanır, body kaydırması kilitlenir. */
export function Modal({ open, title, onClose, children, footer, size = 'md', lockBackdrop, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]), textarea, select, button:not([data-modal-close])',
      );
      el?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-fade-in"
        onClick={lockBackdrop ? undefined : onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-brand-300 bg-white shadow-xl animate-pop-in sm:m-4 sm:rounded-xl',
          SIZE[size],
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-brand-200 px-5 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-brand-900">{title}</h3>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            className="rounded-full p-1 text-brand-400 transition-colors hover:bg-brand-100 hover:text-brand-700"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-brand-200 bg-brand-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
