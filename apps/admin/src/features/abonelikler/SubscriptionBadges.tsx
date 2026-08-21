import type { CycleItemSource, CycleStatus, SubscriptionStatus } from '@bagdam/shared';
import { cn } from '../../lib/utils';
import {
  CYCLE_ITEM_SOURCE_STYLE,
  CYCLE_STATUS_STYLE,
  SUBSCRIPTION_STATUS_STYLE,
  cycleItemSourceLabel,
  cycleStatusLabel,
  subscriptionStatusLabel,
} from './subscriptions';

const base = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset';
const fallback = 'bg-brand-100 text-brand-600 ring-brand-300';

/** Abonelik durumu rozeti (shared SUBSCRIPTION_STATUS_LABELS). */
export function SubscriptionStatusBadge({ status, className }: { status: SubscriptionStatus | string; className?: string }) {
  return <span className={cn(base, SUBSCRIPTION_STATUS_STYLE[status as SubscriptionStatus] ?? fallback, className)}>{subscriptionStatusLabel(status)}</span>;
}

/** Cycle durumu rozeti. */
export function CycleStatusBadge({ status, className }: { status: CycleStatus | string; className?: string }) {
  return <span className={cn(base, CYCLE_STATUS_STYLE[status as CycleStatus] ?? fallback, className)}>{cycleStatusLabel(status)}</span>;
}

/** Kutu içeriği kaynağı rozeti (şablon / değiştirildi / ekstra / sepetten). */
export function CycleItemSourceBadge({ source, className }: { source: CycleItemSource | string; className?: string }) {
  return <span className={cn(base, CYCLE_ITEM_SOURCE_STYLE[source as CycleItemSource] ?? fallback, className)}>{cycleItemSourceLabel(source)}</span>;
}

/** Tek seferlik kutu / abonelik ayrımı [B2]. */
export function SubscriptionKindBadge({ isOneTime, className }: { isOneTime: boolean; className?: string }) {
  return (
    <span className={cn(base, isOneTime ? 'bg-butter/50 text-butter-deep ring-butter-deep/30' : 'bg-olive-soft text-olive-deep ring-olive/30', className)}>
      {isOneTime ? 'Tek seferlik' : 'Abonelik'}
    </span>
  );
}
