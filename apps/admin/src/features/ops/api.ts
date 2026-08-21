/**
 * Ops (Teslimat Günü, ekran 20) admin uçları — `/api/v1/admin/ops/*` (F9/C).
 *
 *   GET  /admin/ops/pick-list?date&zone     → PickListRow[]      (ürün bazında toplam, tercih dağılımı, parti)
 *   GET  /admin/ops/packing-list?date&zone  → PackingListEntry[] (müşteri bazında fiş: içerik, tercih, adres, not)
 *   GET  /admin/ops/day-summary?date&zone   → OpsDaySummary      (durum dağılımı, tier kırılımı, ciro, kapasite/kesim)
 *   POST /admin/ops/bulk-status             → OpsBulkStatusResult
 *
 * Yalnız ince istemci: durum makinesi ve yan etkiler API'de (OpsService). Panel toplu durumda satırları
 * kendi makinelerine göre önceden süzer ve `skipInvalid: true` gönderir — araya giren bir durum değişimi
 * tüm partiyi 409'a düşürmesin, sonuç raporunda `skipped` olarak görünsün.
 */
import { api, buildQuery } from '../../lib/api';
import type {
  AdminOpsDateQuery,
  OpsBulkStatusRequest,
  OpsBulkStatusResult,
  OpsDaySummary,
  PackingListEntry,
  PickListRow,
} from '../../lib/apiTypes';
import { unwrapList } from '../catalog/api';

export const opsApi = {
  /** Ürün bazında toplama listesi (yalnız CHARGED/PREPARING/OUT_FOR_DELIVERY cycle'lar). */
  pickList: async (params: AdminOpsDateQuery): Promise<PickListRow[]> =>
    unwrapList<PickListRow>(await api.get<unknown>(`/admin/ops/pick-list${buildQuery(params)}`)),

  /** Müşteri bazında paketleme fişleri. */
  packingList: async (params: AdminOpsDateQuery): Promise<PackingListEntry[]> =>
    unwrapList<PackingListEntry>(await api.get<unknown>(`/admin/ops/packing-list${buildQuery(params)}`)),

  /** Günün özeti (üst şerit + uyarılar). */
  daySummary: (params: AdminOpsDateQuery): Promise<OpsDaySummary> =>
    api.get<OpsDaySummary>(`/admin/ops/day-summary${buildQuery(params)}`),

  /** Toplu durum ilerletme; kısmi başarı `skipped`/`failed` alanlarında raporlanır. */
  bulkStatus: (body: OpsBulkStatusRequest): Promise<OpsBulkStatusResult> =>
    api.post<OpsBulkStatusResult>('/admin/ops/bulk-status', { skipInvalid: true, ...body }),
};
