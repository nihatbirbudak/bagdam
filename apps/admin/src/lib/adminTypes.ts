/**
 * Admin API DTO şekilleri — F4 sözleşmesi (BACKEND-PLANI §3 + görev sözleşmesi).
 * Kaynak `@bagdam/shared` (`types/admin.ts`): api (catalog-admin / media) ile admin aynı tipleri kullanır.
 * Burada yalnız yeniden dışa aktarım + panelin alıştığı kısa takma adlar (…Body) ve shared'da olmayan
 * birkaç panel-yerel şekil (AdminAuditLog, AdminPoolProduct.coverImageUrl) tanımlıdır.
 */
import type {
  AdminBoxPoolProduct,
  AdminBoxTemplateInput,
  AdminBoxTemplateItemInput,
  AdminBoxTemplateUpdate,
  AdminBoxTier,
  AdminBoxTierUpdate,
  AdminCategoryUpdate,
  AdminMediaPatch,
  AdminProducerInput,
  AdminProductImageInput,
  AdminProductInput,
  AdminProductLotInput,
  AdminProductLotPatch,
  Id,
  IsoDateTime,
} from '@bagdam/shared';

/* ── Shared'dan birebir ─────────────────────────────────────────────────── */

export type {
  AdminBoxTemplate,
  AdminBoxTemplateItem,
  AdminBoxTier,
  AdminBoxWeek,
  AdminCategory,
  AdminMediaFile,
  AdminMediaList,
  AdminPage,
  AdminProducer,
  AdminProductDetail,
  AdminProductImage,
  AdminProductListItem,
  AdminProductListQuery,
  AdminProductLot,
} from '@bagdam/shared';

/* ── Gövde takma adları (panel içi kısa adlar) ────────────────────────── */

/** `POST /admin/products` gövdesi; `PUT` için `Partial<AdminProductBody>`. */
export type AdminProductBody = AdminProductInput;

/** Lot formu gövdesi: POST (`setCurrent`) ve PATCH (`isCurrent`) alanlarının birleşimi. */
export type AdminLotBody = AdminProductLotInput & Pick<AdminProductLotPatch, 'isCurrent'>;

export type AdminProductImageBody = AdminProductImageInput;

export type AdminCategoryBody = AdminCategoryUpdate;

export type AdminProducerBody = AdminProducerInput;

/** `GET /admin/tiers` öğesi. */
export type AdminTier = AdminBoxTier;
export type AdminTierBody = AdminBoxTierUpdate;

export type AdminBoxTemplateItemBody = AdminBoxTemplateItemInput;
export type AdminBoxTemplateCreateBody = AdminBoxTemplateInput;
export type AdminBoxTemplateUpdateBody = AdminBoxTemplateUpdate;

/** Havuz ürünü (isFresh). `coverImageUrl` yalnız panelin birleşik (fallback) kurulumunda dolar. */
export type AdminPoolProduct = AdminBoxPoolProduct & { coverImageUrl?: string | null };

export type AdminMediaPatchBody = AdminMediaPatch;

/* ── Audit (shared'da yok — AuditService.list satırı) ──────────────────── */

/** `GET /admin/audit-logs` öğesi (ADMIN). */
export interface AdminAuditLog {
  id: Id;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  module: string;
  entityId: string | null;
  summary: string | null;
  requestId: string | null;
  ipAddress: string | null;
  /** F10 (ekran 22 detay): redakte edilmiş değişiklik anlık görüntüleri. */
  oldValues?: unknown;
  newValues?: unknown;
  createdAt: IsoDateTime;
}
