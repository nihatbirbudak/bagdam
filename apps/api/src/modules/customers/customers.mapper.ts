import type { AdminCustomerAuditItem, AdminCustomerConsent, AdminCustomerDetail, AdminCustomerListItem, MeAddress, UserRole } from '@bagdam/shared';
import type { AuditLog } from '@prisma/client';
import type { UserRecord } from './customers.repository';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** User → admin liste satırı (parola/refresh/reset alanları asla çıkmaz). */
export function toCustomerListItem(row: UserRecord): AdminCustomerListItem {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: row.role as UserRole,
    isActive: row.isActive,
    emailVerifiedAt: iso(row.emailVerifiedAt),
    lastLoginAt: iso(row.lastLoginAt),
    anonymizedAt: iso(row.anonymizedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCustomerAuditItem(row: AuditLog): AdminCustomerAuditItem {
  return { id: row.id, action: row.action, module: row.module, summary: row.summary, actorEmail: row.actorEmail, createdAt: row.createdAt.toISOString() };
}

export function toCustomerDetail(
  row: UserRecord,
  address: MeAddress | null,
  consents: AdminCustomerConsent[],
  audit: AdminCustomerAuditItem[],
): AdminCustomerDetail {
  return {
    ...toCustomerListItem(row),
    marketingOptIn: row.marketingOptIn,
    updatedAt: row.updatedAt.toISOString(),
    address,
    consents,
    audit,
    orders: [],
    subscription: null,
  };
}
