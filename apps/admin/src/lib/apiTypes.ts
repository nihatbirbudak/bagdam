/**
 * API sözleşmesi tipleri (F1: yalnız çekirdek). Alan tipleri F2'den itibaren
 * `@bagdam/shared` paketinden import edilir; burada yalnız panelin kendi
 * ihtiyaç duyduğu zarflar tutulur.
 */

/** Global hata zarfı (HttpExceptionFilter): `{ statusCode, message, requestId }`. */
export interface ApiErrorEnvelope {
  statusCode: number;
  /** class-validator hatalarında dizi gelebilir. */
  message: string | string[];
  error?: string;
  requestId?: string;
  path?: string;
  timestamp?: string;
}

/** Roller (ADR-0009). Panele yalnız ADMIN ve STAFF girer. */
export type UserRole = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole | string;
}

/** `POST /auth/login` yanıtı (cookie set edilir; gövdede kullanıcı döner). */
export interface LoginResponse {
  user?: AuthUser;
  /** Bearer yalnız testlerde; panel cookie kullanır, bu alan yok sayılır. */
  accessToken?: string;
}

/** `GET /health` (F1 HealthController). */
export interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
  version?: string;
  [key: string]: unknown;
}

/** Ortak sayfalama zarfı (common/pagination). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
