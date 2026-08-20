/** Toptan talepleri admin uçları (`/api/v1/admin/wholesale-leads`) — F5 sözleşmesi (B). */
import { api, buildQuery } from '../../lib/api';
import type { AdminWholesaleLead, AdminWholesaleLeadPatch, AdminWholesaleLeadQuery } from '../../lib/apiTypes';
import { unwrapPage } from '../icerik/api';

export const leadsApi = {
  list: async (params: AdminWholesaleLeadQuery) =>
    unwrapPage<AdminWholesaleLead>(await api.get<unknown>(`/admin/wholesale-leads${buildQuery(params)}`)),
  patch: (id: string, body: AdminWholesaleLeadPatch) => api.patch<AdminWholesaleLead>(`/admin/wholesale-leads/${id}`, body),
};
