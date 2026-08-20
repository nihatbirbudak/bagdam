import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** Tablo sarmalayıcı: mobilde yatay kaydırma, masaüstünde çerçeveli kart. */
export function AdminScrollTable({ children, className, footer }: { children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-brand-200 bg-white', className)}>
      <div className="overflow-x-auto">{children}</div>
      {footer}
    </div>
  );
}
