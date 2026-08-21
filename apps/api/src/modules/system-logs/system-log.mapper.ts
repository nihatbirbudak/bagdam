import type { SystemLog } from '@prisma/client';
import type { SystemLogItem } from '@bagdam/shared';
import { redactObject } from '../../common/security/redaction';

/**
 * `GET /admin/system-logs` satırı. `metadata` admin'e verilirken redakte edilir
 * (ADR-0015: yol/e-posta/token gibi alanlar panelde de ham görünmesin).
 */
export function toSystemLogItem(row: SystemLog): SystemLogItem {
  return {
    id: row.id,
    level: row.level,
    module: row.module,
    action: row.action,
    message: row.message,
    requestId: row.requestId,
    userId: row.userId,
    metadata: (redactObject(row.metadata ?? null) as Record<string, unknown> | null) ?? null,
    fingerprint: row.fingerprint,
    occurrenceCount: row.occurrenceCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
