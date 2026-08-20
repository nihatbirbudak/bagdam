// ── Ortak tipler: zarflar, sayfalama, ilkel takma adlar ───────────────────────

/** ISO 8601 an (UTC, `Z` sonekli) — `@db.Timestamptz(3)` alanlarının JSON karşılığı. */
export type IsoDateTime = string;
/** Takvim günü `YYYY-MM-DD` — `@db.Date` alanlarının JSON karşılığı (TZ'siz). */
export type IsoDate = string;
/** cuid. */
export type Id = string;

/**
 * Hata zarfı — UA `HttpExceptionFilter` kalıbı. `message` ValidationPipe'ta string[] olabilir.
 * `error`: makine kodu (ör. `DAY_FULL`, `INVALID_TRANSITION`, `CSRF_INVALID`).
 */
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
  requestId?: string;
  timestamp?: IsoDateTime;
  path?: string;
}

/** Liste uçlarının sayfalı yanıtı. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Liste uçlarının ortak sorgu parametreleri (`page` 1 tabanlı). */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  /** Sıralanacak alan (ör. `createdAt`). */
  sort?: string;
  order?: 'asc' | 'desc';
  /** Serbest metin arama. */
  q?: string;
}

/** Varsayılan sayfalama sınırları (api/admin ortak). */
export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 25,
  maxPageSize: 100,
} as const;

/** Basit başarı zarfı (mutasyonlar). */
export interface OkResponse {
  ok: true;
}

/** Kimlik + etiket çifti (select seçenekleri, ilişkili kayıt özeti). */
export interface RefDto {
  id: Id;
  label: string;
}
