/** Kuponlar admin uçları (`/api/v1/admin/coupons`) — F8 sözleşmesi (B). Yalnız ince istemci; kural/hesap PricingService'te. */
import { api, buildQuery } from '../../lib/api';
import type { AdminCouponDetail, AdminCouponListQuery, Coupon, CouponInput, CouponListItem } from '../../lib/apiTypes';
import { unwrapPage } from '../icerik/api';

function couponPath(id: string, suffix = ''): string {
  return `/admin/coupons/${encodeURIComponent(id)}${suffix}`;
}

export const couponsApi = {
  /** `GET /admin/coupons?q&active&page&limit` → `{items,total,page,limit}`. */
  list: async (params: AdminCouponListQuery): Promise<{ items: CouponListItem[]; total: number }> =>
    unwrapPage<CouponListItem>(await api.get<unknown>(`/admin/coupons${buildQuery(params)}`)),
  /** `GET /admin/coupons/:id` → kupon + kullanımlar (redemptions). */
  get: async (id: string): Promise<AdminCouponDetail> => {
    const raw = await api.get<AdminCouponDetail & { redemptions?: unknown }>(couponPath(id));
    const r = raw.redemptions;
    const redemptions = Array.isArray(r) ? r : r && typeof r === 'object' && Array.isArray((r as { items?: unknown }).items) ? (r as { items: AdminCouponDetail['redemptions'] }).items : [];
    return { ...raw, redemptions };
  },
  create: (body: CouponInput) => api.post<Coupon>('/admin/coupons', body),
  update: (id: string, body: CouponInput) => api.put<Coupon>(couponPath(id), body),
  /** Soft delete (deletedAt) — kullanımlar/sipariş snapshot'ı kalır. */
  remove: (id: string) => api.delete<void>(couponPath(id)),
  /** `PATCH /admin/coupons/:id/active {isActive}`. */
  setActive: (id: string, isActive: boolean) => api.patch<Coupon>(couponPath(id, '/active'), { isActive }),
};
