// F5 — common/crypto.util: AES-256-GCM sır şifreleme (SETTINGS_ENCRYPTION_KEY). Saf birim testleri (DB yok).
import { createHash, randomBytes } from 'crypto';
import {
  decryptSecret,
  deriveSettingsKey,
  encryptSecret,
  isEncryptedValue,
  SettingsCryptoError,
} from '../../common/crypto.util';

const HEX_KEY = randomBytes(32).toString('hex');
const TEXT_KEY = 'bu-bir-test-anahtari-en-az-otuz-iki-karakter-uzunlugunda';

describe('crypto.util — deriveSettingsKey', () => {
  it('64 hex karakter → aynı 32 bayt', () => {
    expect(deriveSettingsKey(HEX_KEY)).toEqual(Buffer.from(HEX_KEY, 'hex'));
  });

  it('hex olmayan ≥32 karakter → sha256 (32 bayt, deterministik)', () => {
    const key = deriveSettingsKey(TEXT_KEY);
    expect(key.length).toBe(32);
    expect(key).toEqual(createHash('sha256').update(TEXT_KEY, 'utf8').digest());
  });

  it('yok / kısa anahtar → SettingsCryptoError (düz metne düşme yok)', () => {
    expect(() => deriveSettingsKey(undefined)).toThrow(SettingsCryptoError);
    expect(() => deriveSettingsKey('kisa')).toThrow(SettingsCryptoError);
    expect(() => deriveSettingsKey('')).toThrow(SettingsCryptoError);
  });
});

describe('crypto.util — encryptSecret / decryptSecret', () => {
  const key = deriveSettingsKey(HEX_KEY);

  it('gidiş-dönüş; biçim enc:v1:<iv>:<tag>:<veri>; her şifreleme farklı (rastgele iv)', () => {
    const plain = 'çok gizli şifre — Şğüöçıİ 123 !"#$%&';
    const a = encryptSecret(plain, key);
    const b = encryptSecret(plain, key);
    expect(a.startsWith('enc:v1:')).toBe(true);
    expect(isEncryptedValue(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('gizli');
    expect(decryptSecret(a, key)).toBe(plain);
    expect(decryptSecret(b, key)).toBe(plain);
  });

  it('boş metin de şifrelenip çözülür', () => {
    const enc = encryptSecret('', key);
    expect(isEncryptedValue(enc)).toBe(true);
    expect(decryptSecret(enc, key)).toBe('');
  });

  it('isEncryptedValue: düz metin / bozuk önek / eksik parça → false', () => {
    expect(isEncryptedValue('plain-password')).toBe(false);
    expect(isEncryptedValue('enc:v1:abc')).toBe(false);
    expect(isEncryptedValue('enc:v0:a:b:c')).toBe(false);
    expect(isEncryptedValue(123)).toBe(false);
    expect(isEncryptedValue(null)).toBe(false);
  });

  it('kurcalanmış veri → SettingsCryptoError; yanlış anahtar → SettingsCryptoError; düz metin → SettingsCryptoError', () => {
    const enc = encryptSecret('sir', key);
    const parts = enc.split(':');
    const data = Buffer.from(parts[4]!, 'base64');
    data[0] = data[0]! ^ 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${data.toString('base64')}`;
    expect(() => decryptSecret(tampered, key)).toThrow(SettingsCryptoError);
    expect(() => decryptSecret(enc, deriveSettingsKey(TEXT_KEY))).toThrow(SettingsCryptoError);
    expect(() => decryptSecret('plain-password', key)).toThrow(SettingsCryptoError);
  });

  it('varsayılan anahtar env’den (apps/api/.env SETTINGS_ENCRYPTION_KEY) — gidiş-dönüş', () => {
    // helpers/env yüklemeden de process.env'de olabilir; yoksa testi anlamlı kılmak için geçici değer ver
    const prev = process.env.SETTINGS_ENCRYPTION_KEY;
    if (!prev || prev.length < 32) process.env.SETTINGS_ENCRYPTION_KEY = TEXT_KEY;
    try {
      const enc = encryptSecret('env-key-roundtrip');
      expect(decryptSecret(enc)).toBe('env-key-roundtrip');
    } finally {
      if (prev === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
      else process.env.SETTINGS_ENCRYPTION_KEY = prev;
    }
  });
});
