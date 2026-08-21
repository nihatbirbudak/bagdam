// F10 güvenlik — env-validator production zorunluları (DB gerekmez; yalnız process.env ile).
// Kural: production'da eksik/zayıf sır, göreli WEB_URL, yarım PayTR yapılandırması, açık job zaman ezmesi → bootstrap durur.
import '../helpers/env';
import { EnvValidationError, validateEnv } from '../../config/env-validator';

/** Testlerin dokunduğu değişkenler — her testten sonra eski değerlere döner. */
const TOUCHED = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SETTINGS_ENCRYPTION_KEY',
  'DATABASE_URL',
  'WEB_URL',
  'ADMIN_URL',
  'SITE_MODE',
  'PAYMENT_PROVIDER',
  'PAYTR_MERCHANT_ID',
  'PAYTR_MERCHANT_KEY',
  'PAYTR_MERCHANT_SALT',
  'PAYTR_TEST_MODE',
  'ALLOW_JOB_TIME_OVERRIDE',
  'DISABLE_MAIL',
  'SMTP_HOST',
  'SMTP_PORT',
  'TZ',
] as const;

const LONG_SECRET = 'a'.repeat(48);

/** Geçerli bir production ortamı kurar (testler bunun üstünde tek tek bozar). */
function validProductionEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    PORT: '5010',
    JWT_SECRET: LONG_SECRET,
    JWT_REFRESH_SECRET: `b${LONG_SECRET}`,
    SETTINGS_ENCRYPTION_KEY: `c${LONG_SECRET}`,
    DATABASE_URL: 'postgresql://bagdam:pw@127.0.0.1:5432/bagdam_db',
    WEB_URL: 'https://bagdam.com',
    ADMIN_URL: 'https://admin.bagdam.com',
    SITE_MODE: 'full',
    PAYMENT_PROVIDER: 'manual',
    PAYTR_MERCHANT_ID: undefined,
    PAYTR_MERCHANT_KEY: undefined,
    PAYTR_MERCHANT_SALT: undefined,
    PAYTR_TEST_MODE: undefined,
    ALLOW_JOB_TIME_OVERRIDE: undefined,
    DISABLE_MAIL: 'true',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    TZ: 'Europe/Istanbul',
  };
}

describe('env-validator — production zorunluları (F10)', () => {
  const backup = new Map<string, string | undefined>();
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    for (const key of TOUCHED) backup.set(key, process.env[key]);
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    apply(validProductionEnv());
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  afterAll(() => {
    for (const [key, value] of backup) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function apply(patch: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  /** Hata mesajlarının tamamı (console.error çağrıları birleştirilmiş). */
  function errorText(): string {
    return errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  }

  it('geçerli production ortamı: hata yok', () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it('JWT_SECRET 32 karakterden kısa → hata', () => {
    apply({ JWT_SECRET: 'kisa' });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('JWT_SECRET');
  });

  it('SETTINGS_ENCRYPTION_KEY eksik → hata (Setting tablosu AES-256-GCM anahtarı)', () => {
    apply({ SETTINGS_ENCRYPTION_KEY: undefined });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('SETTINGS_ENCRYPTION_KEY');
  });

  it('bilinen zayıf/örnek sır (CHANGE_ME) → hata', () => {
    apply({ JWT_SECRET: `CHANGE_ME_${LONG_SECRET}` });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('zayıf/örnek');
  });

  it('WEB_URL göreli/mutlak olmayan → hata; ADMIN_URL aynı kural', () => {
    apply({ WEB_URL: '/bagdam' });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('WEB_URL');

    apply(validProductionEnv());
    errorSpy.mockClear();
    apply({ ADMIN_URL: 'admin.bagdam.com' });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('ADMIN_URL');
  });

  it('PAYMENT_PROVIDER=paytr ama mağaza bilgileri eksik → hata', () => {
    apply({ PAYMENT_PROVIDER: 'paytr' });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    const text = errorText();
    expect(text).toContain('PAYTR_MERCHANT_ID');
    expect(text).toContain('PAYTR_MERCHANT_KEY');
    expect(text).toContain('PAYTR_MERCHANT_SALT');
  });

  it('PAYTR anahtarlarında yer tutucu kalmış → hata; geçerli üçlü + TEST_MODE=0 → hata yok', () => {
    apply({
      PAYMENT_PROVIDER: 'paytr',
      PAYTR_MERCHANT_ID: '123456',
      PAYTR_MERCHANT_KEY: 'CHANGE_ME',
      PAYTR_MERCHANT_SALT: 'salt',
    });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('PAYTR_MERCHANT_KEY');

    apply({ PAYTR_MERCHANT_KEY: 'gercek-anahtar', PAYTR_TEST_MODE: '0' });
    expect(() => validateEnv()).not.toThrow();
  });

  it('PAYTR_TEST_MODE 0/1 dışında → hata', () => {
    apply({
      PAYMENT_PROVIDER: 'paytr',
      PAYTR_MERCHANT_ID: '123456',
      PAYTR_MERCHANT_KEY: 'anahtar',
      PAYTR_MERCHANT_SALT: 'salt',
      PAYTR_TEST_MODE: 'evet',
    });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('PAYTR_TEST_MODE');
  });

  it('ALLOW_JOB_TIME_OVERRIDE=true production\'da yasak', () => {
    apply({ ALLOW_JOB_TIME_OVERRIDE: 'true' });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('ALLOW_JOB_TIME_OVERRIDE');
  });

  it('SITE_MODE yazım hatası her ortamda hata (ADR-0012)', () => {
    apply({ NODE_ENV: 'development', SITE_MODE: 'comingsoon' });
    expect(() => validateEnv()).toThrow(EnvValidationError);
    expect(errorText()).toContain('SITE_MODE');
  });

  it('development: eksik sırlar yalnız uyarı (bootstrap durmaz)', () => {
    apply({ NODE_ENV: 'development', JWT_SECRET: undefined, SETTINGS_ENCRYPTION_KEY: undefined, SITE_MODE: 'full' });
    expect(() => validateEnv()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});
