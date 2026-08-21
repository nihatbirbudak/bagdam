/**
 * Ödeme Problemleri (ekran 18) admin uçları (F9/C).
 *
 *   GET   /admin/payment-issues?kind&q&page&limit  → PaymentIssueList (birleşik liste; salt okuma)
 *   POST  /admin/cycles/:id/charge                 → "yeniden çek"
 *   POST  /admin/cycles/:id/send-payment-link      → "ödeme linki gönder"
 *   POST  /admin/orders/:id/notes {adminNote}      → sipariş satırında müşteriye not
 *   PATCH /admin/subscriptions/:id {note}          → cycle satırında ADMIN_NOTE olayı
 */
import { api, buildQuery } from '../../lib/api';
import type { AdminPaymentIssuesQuery, PaymentIssueList } from '../../lib/apiTypes';
import { ordersApi } from '../siparisler/api';
import { subscriptionsAdminApi } from '../abonelikler/api';
import { normalizePaymentIssues } from './paymentIssues';

export const paymentIssuesApi = {
  list: async (params: AdminPaymentIssuesQuery = {}): Promise<PaymentIssueList> =>
    normalizePaymentIssues(await api.get<unknown>(`/admin/payment-issues${buildQuery(params)}`)),

  /** Müşteriye/kayda not: sipariş satırında sipariş notu, cycle satırında abonelik olayı (ADMIN_NOTE). */
  addOrderNote: (orderId: string, note: string) => ordersApi.addNote(orderId, note),
  addSubscriptionNote: (subscriptionId: string, note: string) => subscriptionsAdminApi.patch(subscriptionId, { note }),
};
