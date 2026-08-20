/**
 * Ayarlar + teslimat admin uçları (`/api/v1/admin/settings`, `/admin/delivery/*`) — F5 sözleşmesi (B).
 * Yalnız ince istemci; şifreleme/maskeleme ve doğrulama API'de.
 */
import { api, buildQuery } from '../../lib/api';
import type {
  AdminDeliveryDate,
  AdminDeliveryDatePatch,
  AdminDeliveryZone,
  AdminDeliveryZoneInput,
  AdminMailSendResult,
  AdminSettingGroup,
  AdminSettingGroupUpdate,
} from '../../lib/apiTypes';
import { unwrapList } from '../catalog/api';
import { normalizeSettingsGroup, normalizeSettingsGroups } from './settingsForm';

export const settingsApi = {
  /** Tüm gruplar; secret alanlar maskeli. */
  list: async (): Promise<AdminSettingGroup[]> => normalizeSettingsGroups(await api.get<unknown>('/admin/settings')),
  get: async (group: string): Promise<AdminSettingGroup | null> =>
    normalizeSettingsGroup(await api.get<unknown>(`/admin/settings/${encodeURIComponent(group)}`), group),
  /** `{field:value}`; secret boş/maske → değişmez. */
  update: (group: string, body: AdminSettingGroupUpdate) => api.put<unknown>(`/admin/settings/${encodeURIComponent(group)}`, body),
  /** F6: `{to}` → MailService.send test şablonu (MailLog satırı / özet döner); DISABLE_MAIL'de SKIPPED + `preview:<dosya>`. */
  testMail: (body: { to: string }) => api.post<AdminMailSendResult>('/admin/settings/mail/test', body),
};

export const deliveryAdminApi = {
  zones: {
    list: async () => unwrapList<AdminDeliveryZone>(await api.get<unknown>('/admin/delivery/zones')),
    create: (body: AdminDeliveryZoneInput) => api.post<AdminDeliveryZone>('/admin/delivery/zones', body),
    update: (id: string, body: AdminDeliveryZoneInput) => api.put<AdminDeliveryZone>(`/admin/delivery/zones/${id}`, body),
    /** `PATCH /admin/delivery/zones/:id/active {isActive}` — silme yok (Address/DeliveryDate FK). */
    setActive: (id: string, isActive: boolean) => api.patch<AdminDeliveryZone>(`/admin/delivery/zones/${id}/active`, { isActive }),
  },
  dates: {
    list: async (params: { zone?: string; from?: string; to?: string }) =>
      unwrapList<AdminDeliveryDate>(await api.get<unknown>(`/admin/delivery/dates${buildQuery(params)}`)),
    patch: (id: string, body: AdminDeliveryDatePatch) => api.patch<AdminDeliveryDate>(`/admin/delivery/dates/${id}`, body),
    /** Zone+tarih upsert; `weeks` hafta ileri (cron F7). */
    generate: (weeks: number) => api.post<unknown>('/admin/delivery/dates/generate', { weeks }),
  },
};
