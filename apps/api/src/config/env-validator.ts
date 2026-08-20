/**
 * Bootstrap-time env doğrulama (UA F34 kalıbı). Eksik/geçersiz env değişkeni
 * için sessiz çalışma-zamanı hatası yerine fail-fast.
 *
 * - production: REQUIRED listesi zorunlu (eksik/kısa → hata, süreç başlamaz)
 * - development/test: yalnız uyarı
 * - SITE_MODE geçersizse her ortamda hata (ADR-0012: apex yanlışlıkla tam site göstermesin)
 *
 * Joi/Zod yerine bağımsız basit validator — yeni bağımlılık yok.
 * Çağırma: main.ts bootstrap() başında, NestFactory.create'den ÖNCE.
 */
import { isSiteMode, SITE_MODES } from './site.config';

interface EnvRule {
  key: string;
  minLength?: number;
  description: string;
}

/** production'da zorunlu; diğer ortamlarda eksikse uyarı. */
const REQUIRED_PRODUCTION_ENV: EnvRule[] = [
  { key: 'NODE_ENV', description: 'Ortam (production/development/test)' },
  { key: 'PORT', description: 'Dinlenecek port (ecosystem.config.js / .env)' },
  { key: 'JWT_SECRET', minLength: 32, description: 'Access JWT imza anahtarı (en az 32 karakter)' },
  { key: 'JWT_REFRESH_SECRET', minLength: 32, description: 'Refresh JWT imza anahtarı (en az 32 karakter)' },
  { key: 'SETTINGS_ENCRYPTION_KEY', minLength: 32, description: 'Setting tablosu AES-256-GCM anahtarı (en az 32 karakter)' },
  { key: 'DATABASE_URL', minLength: 10, description: 'PostgreSQL bağlantı adresi' },
  { key: 'WEB_URL', description: 'Public web URL (CORS allow-list)' },
  { key: 'ADMIN_URL', description: 'Admin URL (CORS allow-list)' },
];

/** Bilinen zayıf/örnek değerler — production'da yasak. */
const WEAK_DEFAULTS: Record<string, string[]> = {
  JWT_SECRET: ['CHANGE_ME', 'change-me', 'secret', 'default', 'dev-secret', 'dev-secret-bagdam'],
  JWT_REFRESH_SECRET: ['CHANGE_ME', 'change-me', 'secret', 'default', 'dev-refresh-secret'],
  SETTINGS_ENCRYPTION_KEY: ['CHANGE_ME', 'change-me', 'secret', 'default'],
};

/** Değerin içinde .env.example yer tutucusu kaldıysa (ör. "CHANGE_ME_32_chars") yakala. */
const PLACEHOLDER_PATTERN = /CHANGE_ME/i;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export function validateEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  for (const rule of REQUIRED_PRODUCTION_ENV) {
    const val = process.env[rule.key];
    const target = isProduction ? errors : warnings;
    const mark = isProduction ? '[HATA]' : '[UYARI]';

    if (!val || val.trim() === '') {
      target.push(`  ${mark} ${rule.key}: EKSİK — ${rule.description}`);
      continue;
    }
    if (rule.minLength && val.length < rule.minLength) {
      target.push(
        `  ${mark} ${rule.key}: çok kısa (en az ${rule.minLength} karakter olmalı, ${val.length} karakter) — ${rule.description}`,
      );
    }
  }

  // PORT sayısal olmalı
  if (process.env.PORT && !/^\d+$/.test(process.env.PORT.trim())) {
    errors.push(`  [HATA] PORT: sayı olmalı ("${process.env.PORT}")`);
  }

  // SITE_MODE — yazım hatası sessizce "full" olmasın (ADR-0012)
  const siteMode = process.env.SITE_MODE?.trim();
  if (siteMode && !isSiteMode(siteMode)) {
    errors.push(`  [HATA] SITE_MODE: geçersiz değer "${siteMode}" — izinli: ${SITE_MODES.join(' | ')}`);
  }

  // E-posta (F6, ADR-0014): DISABLE_MAIL yalnız "true"/"false"; SMTP_PORT sayısal; WEB_URL e-posta bağlantılarının kökü
  // (doğrulama/parola sıfırlama linkleri). SMTP_* boş bırakılabilir: Setting mail.* (panel) önceliklidir, .env yedektir.
  const disableMail = process.env.DISABLE_MAIL?.trim().toLowerCase();
  if (disableMail && disableMail !== 'true' && disableMail !== 'false') {
    warnings.push(`  [UYARI] DISABLE_MAIL: "${process.env.DISABLE_MAIL}" — yalnız true/false; true dışındaki değerler gönderimi AÇIK sayar`);
  }
  if (process.env.SMTP_PORT && !/^\d+$/.test(process.env.SMTP_PORT.trim())) {
    errors.push(`  [HATA] SMTP_PORT: sayı olmalı ("${process.env.SMTP_PORT}")`);
  }
  if (process.env.WEB_URL && !/^https?:\/\//.test(process.env.WEB_URL.trim())) {
    warnings.push(`  [UYARI] WEB_URL: "${process.env.WEB_URL}" — http(s):// ile başlamalı (e-posta bağlantıları buna göre kurulur)`);
  }

  if (isProduction) {
    // Production'da e-posta kapalıysa uyar (parola sıfırlama/doğrulama gitmez); açıkken SMTP panelden ya da .env'den gelmeli
    if (disableMail === 'true') {
      warnings.push('  [UYARI] DISABLE_MAIL=true: production\'da e-posta gönderilmez (yalnız MailLog + önizleme dosyası)');
    } else if (!process.env.SMTP_HOST?.trim()) {
      warnings.push('  [UYARI] SMTP_HOST boş: SMTP Ayarlar › E-posta (Setting mail.*) üzerinden tanımlı olmalı; yoksa gönderimler FAILED');
    }
    // production'da zayıf/örnek sır değerleri yasak
    for (const [key, weak] of Object.entries(WEAK_DEFAULTS)) {
      const val = process.env[key];
      if (!val) continue;
      if (weak.includes(val) || PLACEHOLDER_PATTERN.test(val)) {
        errors.push(`  [HATA] ${key}: PRODUCTION'da bilinen zayıf/örnek değer kullanılamaz`);
      }
    }
    // ADR-0004: PM2 TZ=Europe/Istanbul
    if (process.env.TZ && process.env.TZ !== 'Europe/Istanbul') {
      warnings.push(`  [UYARI] TZ: "${process.env.TZ}" — ADR-0004 gereği Europe/Istanbul bekleniyor`);
    }
  }

  if (warnings.length > 0) {
    console.warn('\n[ENV] Uyarılar:');
    warnings.forEach((w) => console.warn(w));
    console.warn('');
  }

  if (errors.length > 0) {
    console.error('\n[ENV] BOOTSTRAP FAIL — eksik/geçersiz env değişkenleri:\n');
    errors.forEach((e) => console.error(e));
    console.error('\n.env.example dosyasını kontrol edin ve eksik değerleri tamamlayın.\n');
    throw new EnvValidationError(`Env validation failed: ${errors.length} hata`);
  }
}
