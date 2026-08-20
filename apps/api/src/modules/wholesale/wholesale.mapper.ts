import type { WholesaleLead } from '@bagdam/shared';
import type { LeadRecord } from './wholesale.repository';

/** DB satırı → admin DTO (ip istemciye gitmez). */
export function toWholesaleLead(row: LeadRecord): WholesaleLead {
  return {
    id: row.id,
    email: row.email,
    businessName: row.businessName,
    phone: row.phone,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
