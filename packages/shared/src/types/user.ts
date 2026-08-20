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

/** Bootstrap `__BAGDAM__.me` — cart.js `isLoggedIn()` bunu okur; null = misafir. F6: `id` eklendi (WebController req.user'dan). */
export interface BootstrapMe {
  loggedIn: true;
  id: Id;
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

// ── F6 ekleri (müşteri auth · Me · Customers admin) — yalnız EKLEME (BACKEND-PLANI §3 auth/me/customers satırları) ──

/** `POST /auth/register` gövdesindeki onay öğesi — KVKK_ACK zorunlu; documentSlug verilmezse yayındaki varsayılan belge bağlanır. */
export interface RegisterConsentInput {
  kind: Extract<ConsentKind, 'KVKK_ACK' | 'MARKETING_EMAIL' | 'MARKETING_SMS'>;
  granted: boolean;
  /** LegalDocument.slug (yayındaki sürüm bağlanır; ör. `kvkk`, `ticari-ileti-izni`). */
  documentSlug?: string;
}

/** `POST /auth/register {email, password(min 8), name?, phone?, consents[]}` → 201 + çerezler (anında giriş). */
export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  consents: RegisterConsentInput[];
}

/** `POST /auth/login` · `/register` · `/refresh` gövdesindeki kullanıcı (token'lar çerezde). */
export interface AuthSessionUser {
  id: Id;
  email: string;
  name: string | null;
  role: UserRole;
}

export interface AuthSessionResponse {
  user: AuthSessionUser;
}

/** `POST /auth/forgot {email}` → her zaman `{ok:true}`. `POST /auth/reset {token,password}` → `{ok:true}` (+ çerezlerle giriş). */
export interface ForgotPasswordInput {
  email: string;
}
export interface ResetPasswordInput {
  token: string;
  password: string;
}

/** `GET /me/address` → MeAddress | null; `PUT /me/address` → MeAddress (tek adres MVP, isDefault true). */
export interface MeAddress {
  id: Id;
  fullName: string;
  phone: string;
  line: string;
  zoneId: Id;
  zoneSlug: string;
  zip: string | null;
  isDefault: boolean;
}

/** `PUT /me/address` — zoneId ya da zoneSlug'dan biri zorunlu (aktif DeliveryZone; değilse 400 `ZONE_INVALID`). */
export interface MeAddressInput {
  fullName: string;
  phone: string;
  line: string;
  zoneId?: Id;
  zoneSlug?: string;
  zip?: string | null;
}

/** `GET /me/consents` öğesi — tür başına en son kayıt. */
export interface MeConsent {
  kind: ConsentKind;
  granted: boolean;
  createdAt: IsoDateTime;
}

/** `POST /me/consents {kind, granted}` — yalnız MARKETING_EMAIL | MARKETING_SMS (İYS: iysStatus PENDING). */
export interface MeConsentInput {
  kind: Extract<ConsentKind, 'MARKETING_EMAIL' | 'MARKETING_SMS'>;
  granted: boolean;
}

/** `GET /me/orders` — F8'e kadar boş zarf. */
export interface MeOrderList {
  items: unknown[];
  total: number;
}

/** Admin `GET /admin/customers?q&role&page&limit` satırı (ekran 16). */
export interface AdminCustomerListItem {
  id: Id;
  email: string;
  name: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  anonymizedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface AdminCustomerListQuery {
  q?: string;
  role?: UserRole;
  page?: number;
  limit?: number;
}

export interface AdminCustomerList {
  items: AdminCustomerListItem[];
  total: number;
  page: number;
  limit: number;
}

/** Müşteri detayındaki onay satırı (tüm geçmiş, yeni → eski). */
export interface AdminCustomerConsent {
  id: Id;
  kind: ConsentKind;
  granted: boolean;
  documentId: Id | null;
  documentSlug: string | null;
  documentVersion: number | null;
  source: string;
  iysStatus: string;
  createdAt: IsoDateTime;
}

/** Müşteri detayındaki audit özeti satırı (aktör = müşteri ya da varlık = müşteri; son 20). */
export interface AdminCustomerAuditItem {
  id: Id;
  action: string;
  module: string;
  summary: string | null;
  actorEmail: string | null;
  createdAt: IsoDateTime;
}

/** Admin `GET /admin/customers/:id` — profil + adres + onaylar + audit özeti; siparişler/abonelik F8/F9'a kadar boş. */
export interface AdminCustomerDetail extends AdminCustomerListItem {
  marketingOptIn: boolean;
  updatedAt: IsoDateTime;
  address: MeAddress | null;
  consents: AdminCustomerConsent[];
  audit: AdminCustomerAuditItem[];
  orders: unknown[];
  subscription: null;
}

/** Admin `PATCH /admin/customers/:id {isActive?, name?, phone?}` — isActive=false oturumları düşürür. */
export interface AdminCustomerPatch {
  isActive?: boolean;
  name?: string;
  phone?: string | null;
}

/** Admin `POST /admin/customers/:id/anonymize` — KVKK: e-posta `anon+<id>@anon.local`, ad/telefon/adres silinir, hesap kapatılır. */
export interface AdminCustomerAnonymizeResult {
  id: Id;
  email: string;
  anonymizedAt: IsoDateTime;
}
