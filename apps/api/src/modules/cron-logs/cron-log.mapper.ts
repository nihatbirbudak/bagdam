import type { CronLog } from '@prisma/client';
import type { CronLogItem } from '@bagdam/shared';

/** `GET /admin/cron-logs` satırı — CronLog kolonlarının JSON karşılığı (tarihler ISO). */
export function toCronLogItem(row: CronLog): CronLogItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    itemsProcessed: row.itemsProcessed,
    errors: row.errors,
    details: (row.details as Record<string, unknown> | null) ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
  };
}
