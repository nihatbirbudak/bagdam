import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Setting tablosundaki sırların (mail.pass, sms.pass, payment.iyzico*Key …) AES-256-GCM şifrelemesi (ADR-0014, ADR-0015).
 * UA `common/crypto.util.ts` kalıbından uyarlandı; farklar:
 *  - Anahtar `SETTINGS_ENCRYPTION_KEY` (.env.example: `openssl rand -base64 48`, en az 32 karakter). 64 hex karakterse
 *    doğrudan 32 bayt; değilse sha256 ile 32 bayta indirgenir. Anahtar yok/kısa → HATA (UA'daki "düz metne düş" yok:
 *    sır hiçbir zaman düz metin olarak saklanmaz).
 *  - Çıktı kendini tanımlar: `enc:v1:<iv b64>:<tag b64>:<veri b64>` — `isEncryptedValue` ile düz metinden ayırt edilir;
 *    çözme başarısızsa (anahtar değişti / veri bozuk) istisna fırlatır, çağıran karar verir.
 * Bu modül Prisma/Nest'ten bağımsızdır; SettingsService dışında da (F6 MailModule, F8 iyzico) kullanılabilir.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';
const MIN_KEY_CHARS = 32;
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export class SettingsCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsCryptoError';
  }
}

/** Ham env değerini 32 baytlık anahtara çevirir (64 hex → bayt; aksi hâlde sha256). Yok/kısa → SettingsCryptoError. */
export function deriveSettingsKey(raw: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): Buffer {
  const value = raw?.trim() ?? '';
  if (value.length < MIN_KEY_CHARS) {
    throw new SettingsCryptoError(
      `SETTINGS_ENCRYPTION_KEY tanımlı değil ya da ${MIN_KEY_CHARS} karakterden kısa — sır alanları şifrelenemez (bkz. .env.example)`,
    );
  }
  if (HEX_64.test(value)) return Buffer.from(value, 'hex');
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Değer bu modülle şifrelenmiş mi (`enc:v1:` önekli, 3 parçalı)? */
export function isEncryptedValue(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false;
  return value.slice(PREFIX.length).split(':').length === 3;
}

/** Düz metni şifreler → `enc:v1:<iv>:<tag>:<veri>` (base64). Boş metin de şifrelenir (çağıran boşluğu önceden eler). */
export function encryptSecret(plaintext: string, key: Buffer = deriveSettingsKey()): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/**
 * Şifreli değeri çözer. Önek/biçim yanlışsa ya da doğrulama (GCM tag) tutmuyorsa SettingsCryptoError.
 * Düz metin (şifrelenmemiş eski değer) gelirse de hata: çağıran önce `isEncryptedValue` ile ayırt eder.
 */
export function decryptSecret(encrypted: string, key: Buffer = deriveSettingsKey()): string {
  if (!isEncryptedValue(encrypted)) {
    throw new SettingsCryptoError('Değer şifreli biçimde değil (enc:v1:<iv>:<tag>:<veri> bekleniyor)');
  }
  const [ivB64, tagB64, dataB64] = encrypted.slice(PREFIX.length).split(':') as [string, string, string];
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new SettingsCryptoError('Şifreli değerin iv/tag uzunluğu geçersiz');
    }
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof SettingsCryptoError) throw err;
    throw new SettingsCryptoError(
      `Şifreli değer çözülemedi (anahtar değişmiş ya da veri bozuk): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
