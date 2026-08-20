import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { btn } from '../../lib/buttonStyles';
import { cn } from '../../lib/utils';

/** Yükleniyor bloğu (liste/form içi). */
export function LoadingBlock({ label = 'Yükleniyor…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-brand-500', className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** Hata bloğu + yeniden dene. */
export function ErrorBlock({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-accent/30 bg-accent-light px-4 py-8 text-center', className)} role="alert">
      <AlertTriangle className="h-6 w-6 text-accent-dark" aria-hidden />
      <p className="text-sm text-accent-dark">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cn(btn.secondary, btn.sm)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Yeniden dene
        </button>
      )}
    </div>
  );
}

/** Satır içi küçük uyarı şeridi (ör. yayınlanmış şablon). */
export function InlineNotice({ tone = 'warning', children, className }: { tone?: 'warning' | 'info' | 'success'; children: React.ReactNode; className?: string }) {
  const style =
    tone === 'warning'
      ? 'border-butter-deep/30 bg-butter/40 text-butter-deep'
      : tone === 'success'
        ? 'border-olive/30 bg-olive-soft text-olive-deep'
        : 'border-brand-300 bg-brand-50 text-brand-700';
  return (
    <div className={cn('rounded-md border px-3 py-2 text-xs', style, className)} role={tone === 'warning' ? 'alert' : undefined}>
      {children}
    </div>
  );
}
