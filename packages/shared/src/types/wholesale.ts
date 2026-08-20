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

// ── F5 ekleri (WholesaleModule) — yalnız EKLEME ───────────────────────────────

/** `POST /wholesale-leads` → 201. */
export interface WholesaleLeadCreated {
  id: Id;
}

/** Admin `GET /admin/wholesale-leads?status&page&limit`. */
export interface WholesaleLeadListQuery {
  status?: LeadStatus;
  page?: number;
  limit?: number;
}

/** Admin liste yanıtı (`AdminPage` ile aynı zarf). */
export interface WholesaleLeadList {
  items: WholesaleLead[];
  total: number;
  page: number;
  limit: number;
}
