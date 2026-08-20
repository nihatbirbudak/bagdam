import { USER_ROLE_LABELS, type UserRole } from '@bagdam/shared';
import type { AdminCustomerListItem } from '../../lib/apiTypes';
import { cn } from '../../lib/utils';
import { isCustomerAnonymized } from './customers';

const base = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';

const ROLE_STYLE: Record<string, string> = {
  CUSTOMER: 'bg-brand-100 text-brand-600 ring-brand-300',
  STAFF: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  ADMIN: 'bg-fig-soft text-fig-deep ring-fig/30',
};

export function roleLabel(role: string): string {
  return (USER_ROLE_LABELS as Record<string, string>)[role as UserRole] ?? role;
}

/** Rol rozeti (CUSTOMER / STAFF / ADMIN — shared etiketleri). */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  return <span className={cn(base, ROLE_STYLE[role] ?? 'bg-brand-100 text-brand-600 ring-brand-300', className)}>{roleLabel(role)}</span>;
}

/** Hesap durumu: Anonim (KVKK) › Pasif › Aktif. */
export function CustomerStateBadge({ customer, className }: { customer: Pick<AdminCustomerListItem, 'isActive' | 'anonymizedAt' | 'email'>; className?: string }) {
  if (isCustomerAnonymized(customer)) {
    return <span className={cn(base, 'bg-accent-soft text-accent-dark ring-accent/30', className)}>Anonim</span>;
  }
  if (!customer.isActive) {
    return <span className={cn(base, 'bg-brand-100 text-brand-500 ring-brand-300', className)}>Pasif</span>;
  }
  return <span className={cn(base, 'bg-olive-soft text-olive-deep ring-olive/30', className)}>Aktif</span>;
}
