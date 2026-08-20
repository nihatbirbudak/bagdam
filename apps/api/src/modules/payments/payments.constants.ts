import { randomBytes } from 'crypto';

/** Ödeme linki token'ı: 16 rastgele bayt → 32 hex (Payment.linkToken VarChar(64) unique). */
export const LINK_TOKEN_BYTES = 16;
export const LINK_TOKEN_RE = /^[a-f0-9]{32}$/;

/** Public ödeme linki yolu — `GET /api/v1/pay/:linkToken` (BACKEND-PLANI §3 payments satırı; global prefix dahil). */
export const PAY_LINK_PATH = '/api/v1/pay';

/** ManualProvider'ın webhook imzası olarak kabul ettiği sabit (yalnız test/geliştirme). */
export const MANUAL_WEBHOOK_SIGNATURE = 'manual';
/** ManualProvider: bu önekle başlayan saklı kart token'ı her tahsilatta reddedilir (başarısızlık simülasyonu). */
export const MANUAL_FAIL_TOKEN_PREFIX = 'fail:';

// ── Idempotency anahtarları (Payment.conversationId unique, VarChar(80)) — state-machines §8/§9 ─────────────────────
/** Checkout ilk ödemesi (F8): `chk_<orderId>`. */
export function checkoutConversationId(orderId: string): string {
  return `chk_${orderId}`;
}
/** Saklı karttan tahsilat (MIT: CYCLE_CHARGE / DELTA / RETRY): `cyc_<cycleId>_<attemptNo>`. */
export function cycleConversationId(cycleId: string, attemptNo: number): string {
  return `cyc_${cycleId}_${attemptNo}`;
}
/** Ödeme linki (LINK): `lnk_<cycleId>_<attemptNo>` — yeniden gönderilen link yeni deneme sayısı alır. */
export function linkConversationId(cycleId: string, attemptNo: number): string {
  return `lnk_${cycleId}_${attemptNo}`;
}

export function generateLinkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString('hex');
}

/** Müşteriye gönderilen mutlak link: `${WEB_URL}/api/v1/pay/<token>` (WEB_URL yoksa lokal varsayılan). */
export function buildPayLinkUrl(linkToken: string): string {
  const base = (process.env.WEB_URL ?? 'http://127.0.0.1:4010').trim().replace(/\/+$/, '');
  return `${base}${PAY_LINK_PATH}/${linkToken}`;
}
