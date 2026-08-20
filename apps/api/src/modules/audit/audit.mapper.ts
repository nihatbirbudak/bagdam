import type { AuditLog } from '@prisma/client';

/** `GET /admin/audit-logs` satırı — AuditLog kolonlarının JSON karşılığı (tarihler ISO). */
export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  module: string;
  entityId: string | null;
  summary: string | null;
  oldValues: unknown;
  newValues: unknown;
  requestId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export function toAuditLogDto(row: AuditLog): AuditLogDto {
  return {
    id: row.id,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    action: row.action,
    module: row.module,
    entityId: row.entityId,
    summary: row.summary,
    oldValues: row.oldValues ?? null,
    newValues: row.newValues ?? null,
    requestId: row.requestId,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}
