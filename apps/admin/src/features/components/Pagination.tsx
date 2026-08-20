import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

type Props = {
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  limitOptions?: number[];
  className?: string;
};

const btnBase =
  'inline-flex items-center justify-center rounded-md border border-brand-300 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';

/** Sayfalama çubuğu: toplam/sayfa bilgisi, önceki/sonraki, sayfa boyutu. */
export function Pagination({ total, page, limit, onPageChange, onLimitChange, limitOptions = [25, 50, 100], className }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 border-t border-brand-200 bg-brand-50/50 px-3 py-2 text-xs text-brand-600', className)}>
      <div>
        {total === 0 ? (
          'Kayıt yok'
        ) : (
          <>
            <strong className="text-brand-800">{from}–{to}</strong> / {total} kayıt · sayfa{' '}
            <strong className="text-brand-800">{page}</strong>/{totalPages}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onLimitChange && (
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="rounded-md border border-brand-300 bg-white px-2 py-1.5 text-xs text-brand-700 focus:border-accent focus:outline-none"
            aria-label="Sayfa başına kayıt"
          >
            {limitOptions.map((n) => (
              <option key={n} value={n}>{n} / sayfa</option>
            ))}
          </select>
        )}
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={btnBase} aria-label="Önceki sayfa">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className={btnBase} aria-label="Sonraki sayfa">
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
