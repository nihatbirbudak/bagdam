import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import {
  cronStatusLabel,
  cronStatusTone,
  systemLevelLabel,
  systemLevelTone,
  webhookStatusLabel,
  webhookStatusTone,
  type Tone,
} from '../../features/sistem/system';

const TONE_STYLE: Record<Tone, string> = {
  good: 'bg-olive-soft text-olive-deep ring-olive/30',
  bad: 'bg-accent-soft text-accent-dark ring-accent/30',
  warn: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  neutral: 'bg-brand-100 text-brand-600 ring-brand-300',
};

/** Ekran 22 ortak rozeti (seviye / durum). */
export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        TONE_STYLE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SystemLevelBadge({ level }: { level: string }) {
  return <ToneBadge tone={systemLevelTone(level)}>{systemLevelLabel(level)}</ToneBadge>;
}

export function CronStatusBadge({ status }: { status: string }) {
  return <ToneBadge tone={cronStatusTone(status)}>{cronStatusLabel(status)}</ToneBadge>;
}

export function WebhookStatusBadge({ status }: { status: string }) {
  return <ToneBadge tone={webhookStatusTone(status)}>{webhookStatusLabel(status)}</ToneBadge>;
}
