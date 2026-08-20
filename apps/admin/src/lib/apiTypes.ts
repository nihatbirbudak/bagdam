/**
 * API sözleşmesi zarfları (panelin kendi ihtiyaç duyduğu şekiller). Alan/enum tipleri
 * `@bagdam/shared`'dan; admin DTO şekilleri `lib/adminTypes.ts`'te.
 */
import type { UserRole } from '@bagdam/shared';

/** Global hata zarfı (AllExceptionsFilter): `{ statusCode, message, error, requestId, timestamp, path }`. */
export interface ApiErrorEnvelope {
  statusCode: number;
  /** class-validator hatalarında dizi gelebilir. */
  message: string | string[];
  error?: string;
  requestId?: string;
  path?: string;
  timestamp?: string;
}

export type { UserRole };

/** `POST /auth/login` → `{ user }` ve `GET /auth/me` gövdesi (ADR-0009). */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole | string;
  emailVerifiedAt?: string | null;
  createdAt?: string;
}

/** `POST /auth/login` yanıtı (cookie set edilir; gövdede kullanıcı döner). */
export interface LoginResponse {
  user?: AuthUser;
}

/** `GET /health` (HealthController). */
export interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
  version?: string;
  db?: string;
  [key: string]: unknown;
}

/** Ortak sayfalama zarfı — admin liste uçları `{ items, total, page, limit }` döner. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
