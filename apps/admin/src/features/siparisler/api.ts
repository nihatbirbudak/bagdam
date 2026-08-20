/**
 * Siparişler / ödemeler admin uçları (`/api/v1/admin/orders`, `/api/v1/admin/payments`) — F7 OrdersModule + F8 iade.
 * Yalnız ince istemci; durum makinesi ve yan etkiler API'de (OrdersService.transition).
 */
import { api, buildQuery, fetchBlobGet } from '../../lib/api';
import type {
  AdminOrderList,
  AdminOrderListQuery,
  AdminRefundResult,
  Order,
  OrderBillingPatch,
  OrderInvoicePatch,
  OrderStatusPatch,
  OrderSummary,
  RefundRequest,
} from '../../lib/apiTypes';
import { unwrapPage } from '../icerik/api';

function orderPath(id: string, suffix = ''): string {
  return `/admin/orders/${encodeURIComponent(id)}${suffix}`;
}

export const ordersApi = {
  /** `GET /admin/orders?status&kind&from&to&deliveryOn&q&page&limit` → `{items,total,page,limit}`. */
  list: async (params: AdminOrderListQuery): Promise<{ items: OrderSummary[]; total: number }> =>
    unwrapPage<OrderSummary>(await api.get<AdminOrderList>(`/admin/orders${buildQuery(params)}`)),
  /** `GET /admin/orders/:id` → Order (+lines +payments[+refunds]). */
  get: (id: string) => api.get<Order>(orderPath(id)),
  /** `PATCH /admin/orders/:id/status {status,reason?}` — 409 ORDER_TRANSITION_INVALID · 400 ORDER_REASON_REQUIRED. */
  updateStatus: (id: string, body: OrderStatusPatch) => api.patch<Order>(orderPath(id, '/status'), body),
  /** `POST /admin/orders/:id/notes {adminNote}` — zaman damgalı satır EKLENİR. */
  addNote: (id: string, adminNote: string) => api.post<Order>(orderPath(id, '/notes'), { adminNote }),
  /** `PATCH /admin/orders/:id/billing` — kurumsal fatura alanları. */
  patchBilling: (id: string, body: OrderBillingPatch) => api.patch<Order>(orderPath(id, '/billing'), body),
  /** `PATCH /admin/orders/:id/invoice {invoiceNo, invoicePdfPath?}` — manuel e-Arşiv. */
  patchInvoice: (id: string, body: OrderInvoicePatch) => api.patch<Order>(orderPath(id, '/invoice'), body),
  /** `GET /admin/orders/export.csv?…` (aynı filtre, sayfasız) → Blob (UTF-8 BOM, CRLF). */
  exportCsv: (params: Omit<AdminOrderListQuery, 'page' | 'limit'>) => fetchBlobGet(`/admin/orders/export.csv${buildQuery(params)}`),
};

export const paymentsAdminApi = {
  /** `POST /admin/payments/:id/refund {amount, reason?}` → PaymentsService.refund sonucu (F8; uç yoksa 404). */
  refund: (paymentId: string, body: RefundRequest) => api.post<AdminRefundResult>(`/admin/payments/${encodeURIComponent(paymentId)}/refund`, body),
};

/** Tarayıcıda Blob indirme (CSV). Test ortamında (jsdom) `URL.createObjectURL` yoksa sessizce geçer. */
export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
