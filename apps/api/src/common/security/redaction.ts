/**
 * PII / sır redaksiyonu — tek kaynak (ADR-0015: audit + log + admin listeleri).
 *
 * Üç kullanım:
 *  1. `redactObject`  — AuditLog `oldValues/newValues` anlık görüntüleri (AuditLogInterceptor)
 *     ve WebhookEvent `payload` gibi serbest JSON'lar.
 *  2. `redactUrl`     — log satırlarındaki sorgu dizesi (`?token=…`, `?to=kisi@x`) maskelenir;
 *     PM2/SystemLog dosyalarına ham token/e-posta düşmesin.
 *  3. `maskEmail` / `maskPhone` — gösterilmesi gereken ama tam görünmemesi gereken alanlar
 *     (KVKK: audit satırlarında yaş sınırını geçen PII `[silindi]` olur — o iş `kvkk:purge`'de).
 */

/** Tam ad eşleşmesiyle redakte edilen alanlar. Küçük harfe indirilerek karşılaştırılır. */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  // kimlik / sır
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'refreshtoken',
  'refreshtokenhash',
  'passwordresettoken',
  'accesstoken',
  'csrftoken',
  'secret',
  'apikey',
  'apisecret',
  'authorization',
  'cookie',
  'setcookie',
  // ödeme sağlayıcısı (F8 PayTR): mağaza anahtarı / imza / kart alanları
  'merchantkey',
  'merchant_key',
  'merchantsalt',
  'merchant_salt',
  'paytr_token',
  'hash',
  'cardnumber',
  'cardholder',
  'cardholdername',
  'cvv',
  'cvc',
  'expirymonth',
  'expiryyear',
  // KVKK: kişisel veri
  'email',
  'actoremail',
  'useremail',
  'customeremail',
  'phone',
  'phonenumber',
  'customerphone',
  'fullname',
  'customername',
  'address',
  'addressline',
  'line',
  'addresssnapshot',
  'billingaddress',
  'taxno',
  'taxnumber',
  'identitynumber',
  'tckn',
  'iban',
  'ip',
  'ipaddress',
  'useragent',
]);

/** Anahtar desenleri — parola/sır/token içeren her ad. */
export const SENSITIVE_KEY_PATTERN = /password|secret|token|apikey|api_key|_hash$|^hash$/i;

export const REDACTED = '[redacted]';

const MAX_DEPTH = 8;
const MAX_STRING = 4000;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Derin redaksiyon: hassas anahtarlar `[redacted]`, derinlik/uzunluk sınırlı, Date → ISO, Buffer → özet.
 * Saf fonksiyon (testlerde doğrudan kullanılır).
 */
export function redactObject(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1));
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}B]`;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactObject(v, depth + 1);
  }
  return out;
}

/** `kisi@example.com` → `k***@example.com`; geçersiz/boş → olduğu gibi. */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const at = value.indexOf('@');
  if (at <= 0) return REDACTED;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/** `+90 555 111 22 33` → `+90 *** ** 33` (son 2 hane kalır). */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return REDACTED;
  return `***${digits.slice(-2)}`;
}

/** Sorgu dizesinde değeri maskelenecek parametreler (log satırları). */
const SENSITIVE_QUERY_KEYS: ReadonlySet<string> = new Set([
  'token',
  'sifirla',
  'dogrula',
  'code',
  'to',
  'email',
  'e-posta',
  'phone',
  'search',
  'q',
  'hash',
  'merchant_oid',
  'access_token',
  'refresh_token',
]);

/**
 * Log'a yazılacak URL: yol korunur, hassas sorgu parametrelerinin DEĞERİ `[redacted]` olur.
 * (`/api/v1/auth/reset?token=abc` → `/api/v1/auth/reset?token=[redacted]`)
 * Ayrıştırılamayan URL'de sorgu dizesi tamamen düşürülür.
 */
export function redactUrl(url: string | null | undefined): string {
  if (!url) return '-';
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return url;
  const path = url.slice(0, qIndex);
  const query = url.slice(qIndex + 1);
  if (!query) return path;
  try {
    const params = new URLSearchParams(query);
    const parts: string[] = [];
    for (const [key] of params) {
      parts.push(`${key}=${SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? REDACTED : params.get(key)}`);
    }
    return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
  } catch {
    return path;
  }
}
