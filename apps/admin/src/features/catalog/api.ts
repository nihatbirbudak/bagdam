/**
 * Katalog admin uçları (`/api/v1/admin/*`) — F4 sözleşmesi. Yalnız ince istemci; mantık API'de.
 */
import { PRODUCT_STATUS_VALUES, STOCK_STATUS_VALUES, type ProductStatus, type StockStatus } from '@bagdam/shared';
import { api, buildQuery } from '../../lib/api';
import type { Paginated } from '../../lib/apiTypes';
import type {
  AdminAuditLog,
  AdminBoxTemplate,
  AdminBoxTemplateCreateBody,
  AdminBoxTemplateUpdateBody,
  AdminBoxWeek,
  AdminCategory,
  AdminCategoryBody,
  AdminLotBody,
  AdminPoolProduct,
  AdminProducer,
  AdminProducerBody,
  AdminProductBody,
  AdminProductDetail,
  AdminProductImage,
  AdminProductImageBody,
  AdminProductListItem,
  AdminProductLot,
  AdminTier,
  AdminTierBody,
} from '../../lib/adminTypes';

/** Dizi ya da `{ items }` zarfı dönebilen liste uçlarını diziye indirger. */
export function unwrapList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && Array.isArray((res as { items?: unknown }).items)) {
    return (res as { items: T[] }).items;
  }
  return [];
}

/* ── Ürünler ─────────────────────────────────────────────────────────────── */

export interface ProductListParams {
  page?: number;
  limit?: number;
  q?: string;
  categoryId?: string;
  status?: ProductStatus | '';
  stockStatus?: StockStatus | '';
  isFresh?: boolean | '';
}

export const productsApi = {
  list: (params: ProductListParams) =>
    api.get<Paginated<AdminProductListItem>>(`/admin/products${buildQuery(params)}`),
  get: (id: string) => api.get<AdminProductDetail>(`/admin/products/${id}`),
  create: (body: AdminProductBody) => api.post<AdminProductDetail>('/admin/products', body),
  update: (id: string, body: Partial<AdminProductBody>) => api.put<AdminProductDetail>(`/admin/products/${id}`, body),
  remove: (id: string) => api.delete<void>(`/admin/products/${id}`),
  setStatus: (id: string, status: ProductStatus) => api.patch<AdminProductDetail>(`/admin/products/${id}/status`, { status }),
  setStock: (id: string, stockStatus: StockStatus) => api.patch<AdminProductDetail>(`/admin/products/${id}/stock`, { stockStatus }),
  setPair: (id: string, pairWithBox: boolean, pairOrder?: number) =>
    api.patch<AdminProductDetail>(`/admin/products/${id}/pair`, pairOrder === undefined ? { pairWithBox } : { pairWithBox, pairOrder }),
  reorder: (ids: string[]) => api.post<void>('/admin/products/reorder', { ids }),

  // Partiler
  addLot: (productId: string, body: AdminLotBody) => api.post<AdminProductLot>(`/admin/products/${productId}/lots`, body),
  updateLot: (productId: string, lotId: string, body: Partial<AdminLotBody>) =>
    api.patch<AdminProductLot>(`/admin/products/${productId}/lots/${lotId}`, body),
  removeLot: (productId: string, lotId: string) => api.delete<void>(`/admin/products/${productId}/lots/${lotId}`),

  // Görseller
  addImage: (productId: string, body: AdminProductImageBody) => api.post<AdminProductImage>(`/admin/products/${productId}/images`, body),
  updateImage: (productId: string, imageId: string, body: { alt?: string | null; isCover?: boolean; sortOrder?: number }) =>
    api.patch<AdminProductImage>(`/admin/products/${productId}/images/${imageId}`, body),
  reorderImages: (productId: string, ids: string[]) => api.post<void>(`/admin/products/${productId}/images/reorder`, { ids }),
  removeImage: (productId: string, imageId: string) => api.delete<void>(`/admin/products/${productId}/images/${imageId}`),
};

/* ── Kategoriler ───────────────────────────────────────────────────────── */

export const categoriesApi = {
  list: async () => unwrapList<AdminCategory>(await api.get<unknown>('/admin/categories')),
  update: (id: string, body: AdminCategoryBody) => api.put<AdminCategory>(`/admin/categories/${id}`, body),
  reorder: (ids: string[]) => api.post<void>('/admin/categories/reorder', { ids }),
};

/* ── Üreticiler ────────────────────────────────────────────────────────── */

export const producersApi = {
  list: async () => unwrapList<AdminProducer>(await api.get<unknown>('/admin/producers')),
  create: (body: AdminProducerBody) => api.post<AdminProducer>('/admin/producers', body),
  update: (id: string, body: Partial<AdminProducerBody>) => api.put<AdminProducer>(`/admin/producers/${id}`, body),
  /** Soft: Producer'da deletedAt yok → sunucu isActive=false yapar. */
  remove: (id: string) => api.delete<void>(`/admin/producers/${id}`),
};

/* ── Tier'lar ──────────────────────────────────────────────────────────── */

export const tiersApi = {
  list: async () => unwrapList<AdminTier>(await api.get<unknown>('/admin/tiers')),
  update: (id: string, body: AdminTierBody) => api.put<AdminTier>(`/admin/tiers/${id}`, body),
};

/* ── Haftanın kutusu ───────────────────────────────────────────────────── */

export const boxTemplatesApi = {
  list: async (params: { tierId?: string; from?: string; to?: string } = {}) =>
    unwrapList<AdminBoxTemplate>(await api.get<unknown>(`/admin/box-templates${buildQuery(params)}`)),
  create: (body: AdminBoxTemplateCreateBody) => api.post<AdminBoxTemplate>('/admin/box-templates', body),
  update: (id: string, body: AdminBoxTemplateUpdateBody) => api.put<AdminBoxTemplate>(`/admin/box-templates/${id}`, body),
  publish: (id: string) => api.post<AdminBoxTemplate>(`/admin/box-templates/${id}/publish`),
  cloneNextWeek: (id: string) => api.post<AdminBoxTemplate>(`/admin/box-templates/${id}/clone-next-week`),
  /** Ham yanıt; şekil `normalizeBoxWeek` ile toparlanır. */
  weekRaw: (week: string) => api.get<unknown>(`/admin/box-week${buildQuery({ week })}`),
};

/**
 * `GET /admin/box-week` yanıtını tek şekle indirger. Sunucu `tiers[]` öğesinde tier bilgisini
 * `tier:{…}` altında ya da düz (`id/slug/label/itemCount` + `template`) verebilir; ikisi de kabul edilir.
 * Tanınmayan şekilde `null` döner → çağıran, `/admin/tiers` + `/admin/box-templates` + `/admin/products?isFresh=true` ile kurar.
 */
export function normalizeBoxWeek(raw: unknown, week: string): AdminBoxWeek | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tiersRaw = (r.tiers ?? r.items) as unknown;
  if (!Array.isArray(tiersRaw)) return null;
  const tiers: AdminBoxWeek['tiers'] = [];
  for (const entry of tiersRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const t = (e.tier && typeof e.tier === 'object' ? e.tier : e) as Record<string, unknown>;
    if (typeof t.id !== 'string') continue;
    tiers.push({
      tier: {
        id: t.id,
        slug: String(t.slug ?? ''),
        label: String(t.label ?? t.slug ?? ''),
        itemCount: Number(t.itemCount ?? 0),
        isActive: t.isActive === undefined ? true : Boolean(t.isActive),
      },
      template: (e.template as AdminBoxTemplate | null | undefined) ?? null,
    });
  }
  const poolRaw = (r.pool ?? r.freshProducts ?? []) as unknown;
  const pool: AdminPoolProduct[] = Array.isArray(poolRaw)
    ? poolRaw
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).id === 'string')
        .map((p) => ({
          id: p.id as string,
          slug: String(p.slug ?? ''),
          name: String(p.name ?? ''),
          unit: typeof p.unit === 'string' ? p.unit : '',
          boxAmount: typeof p.boxAmount === 'string' ? p.boxAmount : null,
          stockStatus: STOCK_STATUS_VALUES.includes(p.stockStatus as StockStatus) ? (p.stockStatus as StockStatus) : 'IN_STOCK',
          status: PRODUCT_STATUS_VALUES.includes(p.status as ProductStatus) ? (p.status as ProductStatus) : 'ACTIVE',
          sortOrder: Number(p.sortOrder ?? 0),
          coverImageUrl: typeof p.coverImageUrl === 'string' ? p.coverImageUrl : null,
        }))
    : [];
  const weekStart = typeof r.weekStart === 'string' ? r.weekStart : typeof r.week === 'string' ? r.week : week;
  return { weekStart, tiers, pool };
}

/* ── Audit ─────────────────────────────────────────────────────────────── */

export const auditApi = {
  /** `?page&limit&module&action&actorId&entityId&search` (AuditQueryDto) — yalnız ADMIN. */
  list: (params: { page?: number; limit?: number; module?: string; action?: string; actorId?: string; entityId?: string; search?: string }) =>
    api.get<Paginated<AdminAuditLog>>(`/admin/audit-logs${buildQuery(params)}`),
};
