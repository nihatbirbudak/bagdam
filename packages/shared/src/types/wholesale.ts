// ── Toptan talep DTO'ları ────────────────────────────────────────────────────
import type { LeadStatus } from '../enums';
import type { Id, IsoDateTime } from './common';

/** WholesaleLead — toptan.html formu (MVP'de yalnız e-posta; diğer alanlar şema-var/UI-yok). */
export interface WholesaleLead {
  id: Id;
  email: string;
  businessName: string | null;
  phone: string | null;
  note: string | null;
  status: LeadStatus;
  createdAt: IsoDateTime;
}

/** `POST /wholesale-leads` (3/dk/IP). */
export interface WholesaleLeadInput {
  email: string;
  businessName?: string;
  phone?: string;
  note?: string;
}

/** Admin `PATCH /admin/wholesale-leads/:id`. */
export interface WholesaleLeadPatch {
  status?: LeadStatus;
  note?: string | null;
}
