/**
 * İçerik admin uçları (`/api/v1/admin/site-content`, `/admin/posts`, `/admin/legal`) — F5 sözleşmesi (A).
 * Yalnız ince istemci; doğrulama/mantık API'de.
 */
import { api, buildQuery } from '../../lib/api';
import type {
  AdminLegalDocument,
  AdminLegalNavPatch,
  AdminLegalPublishInput,
  AdminLegalSlug,
  AdminLegalVersionInput,
  AdminLegalVersionUpdate,
  AdminPost,
  AdminPostInput,
  AdminPostListQuery,
  AdminSiteContent,
} from '../../lib/apiTypes';
import { unwrapList } from '../catalog/api';

/** `{items,total}` zarfı ya da düz dizi → `{items,total}`. */
export function unwrapPage<T>(res: unknown): { items: T[]; total: number } {
  if (Array.isArray(res)) return { items: res as T[], total: res.length };
  if (res && typeof res === 'object') {
    const r = res as { items?: unknown; total?: unknown };
    const items = Array.isArray(r.items) ? (r.items as T[]) : [];
    const total = typeof r.total === 'number' ? r.total : items.length;
    return { items, total };
  }
  return { items: [], total: 0 };
}

/* ── SiteContent (ekran 9–10) ─────────────────────────────────────────────── */

export const siteContentApi = {
  list: async () => unwrapList<AdminSiteContent>(await api.get<unknown>('/admin/site-content')),
  get: (key: string) => api.get<AdminSiteContent>(`/admin/site-content/${encodeURIComponent(key)}`),
  /** Şemaya göre doğrulanır; bilinmeyen alan 400. */
  update: (key: string, value: unknown) => api.put<AdminSiteContent>(`/admin/site-content/${encodeURIComponent(key)}`, { value }),
};

/* ── Günlük (ekran 11) ────────────────────────────────────────────────────── */

export const postsApi = {
  list: async (params: AdminPostListQuery) => unwrapPage<AdminPost>(await api.get<unknown>(`/admin/posts${buildQuery(params)}`)),
  get: (id: string) => api.get<AdminPost>(`/admin/posts/${id}`),
  create: (body: AdminPostInput) => api.post<AdminPost>('/admin/posts', body),
  update: (id: string, body: Partial<AdminPostInput>) => api.put<AdminPost>(`/admin/posts/${id}`, body),
  publish: (id: string) => api.post<AdminPost>(`/admin/posts/${id}/publish`),
  /** Kalıcı silme (Post'ta deletedAt yok). */
  remove: (id: string) => api.delete<void>(`/admin/posts/${id}`),
};

/* ── Yasal metinler (ekran 12) ────────────────────────────────────────────── */

export const legalApi = {
  list: async () => unwrapList<AdminLegalSlug>(await api.get<unknown>('/admin/legal')),
  get: (id: string) => api.get<AdminLegalDocument>(`/admin/legal/${id}`),
  /** Yeni taslak sürüm (version=max+1, isCurrent=false). */
  createVersion: (slug: string, body: AdminLegalVersionInput) =>
    api.post<AdminLegalDocument>(`/admin/legal/${encodeURIComponent(slug)}/versions`, body),
  /** Yalnız taslakta; yayındaki sürümde 409. */
  update: (id: string, body: AdminLegalVersionUpdate) => api.put<AdminLegalDocument>(`/admin/legal/${id}`, body),
  /** Aynı slug'taki diğer sürümler isCurrent=false olur. */
  publish: (id: string, body: AdminLegalPublishInput = {}) => api.post<AdminLegalDocument>(`/admin/legal/${id}/publish`, body),
  patchNav: (id: string, body: AdminLegalNavPatch) => api.patch<AdminLegalDocument>(`/admin/legal/${id}/nav`, body),
};
