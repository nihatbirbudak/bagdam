import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import { toast, type ToastItem } from '../lib/toast';

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const COLORS = {
  success: 'bg-olive text-white',
  error: 'bg-accent-dark text-white',
  warning: 'bg-butter-deep text-white',
  info: 'bg-brand-700 text-white',
} as const;

/** Sağ altta biriken bildirimler; `toast.success('...')` ile tetiklenir. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const unsub = toast.subscribe(setItems);
    return () => {
      unsub();
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2" aria-live="polite">
      {items.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex min-w-[280px] max-w-[420px] items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg animate-toast-in ${COLORS[t.type]}`}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => toast.remove(t.id)}
              className="ml-1 shrink-0 opacity-70 transition-opacity hover:opacity-100"
              aria-label="Kapat"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
