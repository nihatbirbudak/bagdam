/** Müşteriler admin uçları (`/api/v1/admin/customers`) — F6 sözleşmesi (A). Yalnız ince istemci; mantık API'de. */
import { api, buildQuery } from '../../lib/api';
import type { AdminCustomerDetail, AdminCustomerListItem, AdminCustomerListQuery, AdminCustomerPatch } from '../../lib/apiTypes';
import { unwrapPage } from '../icerik/api';
import { normalizeCustomerDetail, normalizeCustomerListItem } from './customers';

export const customersApi = {
  list: async (params: AdminCustomerListQuery): Promise<{ items: AdminCustomerListItem[]; total: number }> => {
    const page = unwrapPage<unknown>(await api.get<unknown>(`/admin/customers${buildQuery(params)}`));
    return {
      items: page.items.map(normalizeCustomerListItem).filter((c): c is AdminCustomerListItem => !!c),
      total: page.total,
    };
  },
  get: async (id: string): Promise<AdminCustomerDetail> => {
    const detail = normalizeCustomerDetail(await api.get<unknown>(`/admin/customers/${encodeURIComponent(id)}`));
    if (!detail) throw new Error('Beklenmeyen sunucu yanıtı (müşteri)');
    return detail;
  },
  /** Kısmi güncelleme; sunucu güncel kaydı (detay ya da kullanıcı) döner — normalize edilemezse null. */
  patch: async (id: string, body: AdminCustomerPatch): Promise<AdminCustomerDetail | null> =>
    normalizeCustomerDetail(await api.patch<unknown>(`/admin/customers/${encodeURIComponent(id)}`, body)),
  /** KVKK anonimleştirme: e-posta anon+id@anon.local, ad/telefon/adres silinir, oturumlar düşer, isActive=false. Geri alınamaz. */
  anonymize: async (id: string): Promise<AdminCustomerDetail | null> =>
    normalizeCustomerDetail(await api.post<unknown>(`/admin/customers/${encodeURIComponent(id)}/anonymize`)),
};
