import {
  CONTENT_STATUS_LABELS,
  PRODUCT_STATUS_LABELS,
  STOCK_STATUS_LABELS,
  type ContentStatus,
  type ProductStatus,
  type StockStatus,
} from '@bagdam/shared';
import { cn } from '../../lib/utils';

const base = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

const PRODUCT_STYLE: Record<ProductStatus, string> = {
  ACTIVE: 'bg-olive-soft text-olive-deep ring-olive/30',
  DRAFT: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  HIDDEN: 'bg-brand-100 text-brand-600 ring-brand-300',
};

const STOCK_STYLE: Record<StockStatus, string> = {
  IN_STOCK: 'bg-olive-soft text-olive-deep ring-olive/30',
  LOW: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  SOLD_OUT: 'bg-accent-soft text-accent-dark ring-accent/30',
  OUT_OF_SEASON: 'bg-fig-soft text-fig-deep ring-fig/30',
};

const CONTENT_STYLE: Record<ContentStatus, string> = {
  PUBLISHED: 'bg-olive-soft text-olive-deep ring-olive/30',
  DRAFT: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
};

export function ProductStatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  return <span className={cn(base, PRODUCT_STYLE[status] ?? 'bg-brand-100 text-brand-600 ring-brand-300', className)}>{PRODUCT_STATUS_LABELS[status] ?? status}</span>;
}

export function StockStatusBadge({ status, className }: { status: StockStatus; className?: string }) {
  return <span className={cn(base, STOCK_STYLE[status] ?? 'bg-brand-100 text-brand-600 ring-brand-300', className)}>{STOCK_STATUS_LABELS[status] ?? status}</span>;
}

export function ContentStatusBadge({ status, className }: { status: ContentStatus; className?: string }) {
  return <span className={cn(base, CONTENT_STYLE[status] ?? 'bg-brand-100 text-brand-600 ring-brand-300', className)}>{CONTENT_STATUS_LABELS[status] ?? status}</span>;
}

/** Evet/Hayır tipi küçük rozet. */
export function BoolBadge({ value, yes = 'Evet', no = 'Hayır', className }: { value: boolean; yes?: string; no?: string; className?: string }) {
  return (
    <span className={cn(base, value ? 'bg-olive-soft text-olive-deep ring-olive/30' : 'bg-brand-100 text-brand-500 ring-brand-300', className)}>
      {value ? yes : no}
    </span>
  );
}
