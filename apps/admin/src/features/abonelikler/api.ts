/**
 * Abonelik / cycle admin uçları (`/api/v1/admin/subscriptions`, `/admin/cycles`) — F7 SubscriptionsModule.
 * Yalnız ince istemci: durum makinesi, dunning, telafi ve teslimat rezervasyonu API'de (CyclesService).
 *
 * İmzalar `apps/api/src/modules/subscriptions/controllers/subscriptions-admin.controller.ts`'ten birebir.
 */
import { api, buildQuery } from '../../lib/api';
import type {
  AdminCycleListItem,
  AdminCycleCompensateBody,
  AdminCyclesQuery,
  AdminPaymentLinkResult,
  AdminSubscriptionPatchBody,
  AdminSubscriptionsQuery,
  Subscription,
  SubscriptionCycle,
  SubscriptionListItem,
} from '../../lib/apiTypes';
import { unwrapList } from '../catalog/api';
import { unwrapPage } from '../icerik/api';

function cyclePath(id: string, suffix = ''): string {
  return `/admin/cycles/${encodeURIComponent(id)}${suffix}`;
}

export const subscriptionsAdminApi = {
  /** `GET /admin/subscriptions?status&q&page&limit` → `{items,total,page,limit}`. */
  list: async (params: AdminSubscriptionsQuery): Promise<{ items: SubscriptionListItem[]; total: number }> =>
    unwrapPage<SubscriptionListItem>(await api.get<unknown>(`/admin/subscriptions${buildQuery(params)}`)),
  /** `GET /admin/subscriptions/:id` → Subscription (+cycles +cancellations +events). */
  get: (id: string) => api.get<Subscription>(`/admin/subscriptions/${encodeURIComponent(id)}`),
  /**
   * `PATCH /admin/subscriptions/:id` — durum / sıklık / gün / adres / kart / strateji / not.
   * `note` tek başına gönderilirse ADMIN_NOTE olayı yazılır (müşteri kaydına not düşme yolu).
   */
  patch: (id: string, body: AdminSubscriptionPatchBody) => api.patch<Subscription>(`/admin/subscriptions/${encodeURIComponent(id)}`, body),
};

export const cyclesAdminApi = {
  /** `GET /admin/cycles?date=YYYY-MM-DD&status=A,B&zone=slug` → AdminCycleListItem[] (`date` zorunlu). */
  listForDate: async (params: AdminCyclesQuery): Promise<AdminCycleListItem[]> =>
    unwrapList<AdminCycleListItem>(await api.get<unknown>(`/admin/cycles${buildQuery(params)}`)),
  /** `PATCH /admin/cycles/:id/status {status,note?}` — 409 geçersiz geçiş; LOCKED/UNPAID/AWAITING_PAYMENT verilemez. */
  setStatus: (id: string, body: { status: string; note?: string }) => api.patch<SubscriptionCycle>(cyclePath(id, '/status'), body),
  /** `POST /admin/cycles/:id/charge` — saklı karttan yeniden çek (409 NO_PAYMENT_METHOD / CHARGE_NOT_APPLICABLE). */
  charge: (id: string) => api.post<SubscriptionCycle>(cyclePath(id, '/charge')),
  /** `POST /admin/cycles/:id/send-payment-link` → {cycle, linkToken, linkExpiresAt}. */
  sendPaymentLink: (id: string) => api.post<AdminPaymentLinkResult>(cyclePath(id, '/send-payment-link')),
  /** `POST /admin/cycles/:id/compensate {productId,qty?,label?,note}` — 0 TL EXTRA satırı [B19]. */
  compensate: (id: string, body: AdminCycleCompensateBody) => api.post<SubscriptionCycle>(cyclePath(id, '/compensate'), body),
};
