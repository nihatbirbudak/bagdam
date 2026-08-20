// ── Kullanıcı / adres / kimlik DTO'ları ──────────────────────────────────────
import type { ConsentKind, UserRole } from '../enums';
import type { Id, IsoDateTime } from './common';

/** User — parola/refresh/reset alanları ASLA DTO'ya çıkmaz. */
export interface User {
  id: Id;
  email: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: IsoDateTime | null;
  marketingOptIn: boolean;
  /** İlk 2 kutu %50 hakkı kullanıldı mı (üye başına 1 abonelik, ADR-0007). */
  firstBoxesPromoUsedAt: IsoDateTime | null;
  /** Kalma (retention) teklifi sunuldu/kullanıldı (üye başına 1, ADR-0007). */
  retentionOfferUsedAt: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  anonymizedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Admin müşteri listesi satırı (`GET /admin/customers`). */
export interface CustomerListItem {
  id: Id;
  email: string;
  name: string | null;
  phone: string | null;
  isActive: boolean;
  subscriptionStatus: string | null;
  orderCount: number;
  lastOrderAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** Address — MVP'de tek adres (isDefault şema-var/UI-yok). Telefon zorunlu [B10]. */
export interface Address {
  id: Id;
  userId: Id;
  fullName: string;
  phone: string;
  line: string;
  zoneId: Id;
  /** Bölge adı (FE `#custDistrict`: Urla / Çeşme). */
  zoneName?: string;
  zip: string | null;
  isDefault: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `PUT /me/address` gövdesi — uyelik.html `#addressForm` (ilçe text→select, ADR-0003 istisna 5). */
export interface AddressInput {
  fullName: string;
  phone: string;
  line: string;
  zoneId: Id;
  zip?: string | null;
}

/** Order.addressSnapshot — ödendikten sonra değişmez kopya. */
export interface AddressSnapshot {
  fullName: string;
  phone: string;
  line: string;
  zoneId: Id;
  zoneName: string;
  zip: string | null;
}

/** `GET /auth/me` — oturumdaki kullanıcının güvenli projeksiyonu. */
export interface AuthMe {
  id: Id;
  email: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  marketingOptIn: boolean;
  emailVerifiedAt: IsoDateTime | null;
  hasAddress: boolean;
  hasActiveSubscription: boolean;
}

/** Bootstrap `__BAGDAM__.me` — cart.js `isLoggedIn()` bunu okur; null = misafir. */
export interface BootstrapMe {
  loggedIn: true;
  email: string;
  name: string | null;
}

/** Kayıt/checkout'ta kutucukla verilen onay (Consent satırı üretir). */
export interface ConsentInput {
  kind: ConsentKind;
  /** Onaylanan LegalDocument sürümü (requiresAck belgeler için zorunlu). */
  documentId?: Id | null;
  granted: boolean;
}

/** `POST /auth/register` — ADR-0003 istisna 2: KVKK aydınlatma + pazarlama kutucukları. */
export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
  consents: ConsentInput[];
}

/** `POST /auth/login`. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Cookie akışında gövde boş döner; Bearer (test/mobil) akışında token'lar gövdede (ADR-0009). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access JWT ömrü (sn) — 15 dk. */
  expiresIn: number;
}

export interface AuthResponse {
  user: AuthMe;
  tokens?: AuthTokens;
}

/** `POST /auth/forgot` / `POST /auth/reset`. */
export interface ForgotPasswordRequest {
  email: string;
}
export interface ResetPasswordRequest {
  token: string;
  password: string;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
