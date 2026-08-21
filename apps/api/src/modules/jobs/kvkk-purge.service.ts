import { Injectable, Logger } from '@nestjs/common';
import type { PrivacySettings } from '@bagdam/shared';
import { Prisma } from '@prisma/client';
import { isSensitiveKey } from '../../common/security/redaction';
import { CustomersService } from '../customers/customers.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { JobsRepository } from './jobs.repository';
import {
  KVKK_AUDIT_SCAN_BATCH,
  KVKK_AUDIT_SCAN_MAX_ROWS,
  KVKK_INACTIVE_BATCH,
  KVKK_PRIVACY_DEFAULTS,
  KVKK_PURGED,
} from './jobs.constants';
import { KvkkPurgeRepository } from './kvkk-purge.repository';

/** `kvkk:purge` koşusunun ayrıntısı — CronLog `details` alanına yazılır (ekran 22 Sistem › Cron günlüğü). */
export interface KvkkPurgeResult {
  /** Uygulanan saklama süreleri (Setting `privacy.*`). */
  settings: PrivacySettings;
  mailLogsDeleted: number;
  mailPreviewsDeleted: number;
  systemLogsDeleted: number;
  cronLogsDeleted: number;
  auditScanned: number;
  auditMasked: number;
  /** Bir sonraki koşunun tarama penceresinin başlangıcı (ISO) — bu koşuda maskeleme buraya kadar yapıldı. */
  auditMaskedThrough: string | null;
  customersAnonymized: number;
  anonymizeSkipped: number;
  errors: number;
  /** Kapalı (0) olduğu için atlanan temizlikler. */
  disabled: string[];
}

/** E-posta/telefon benzeri serbest metinleri `summary` içinde de maskele (audit özetleri metin). */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+90[\s-]?)?0?\s?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ay → gün yaklaşımı yerine takvim ayı çıkarma (Europe/Istanbul gün sınırı önemli değil; UTC an yeterli). */
export function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** JSON anlık görüntüsündeki PII alanlarını `[silindi]` yapar; değişiklik olduysa `changed:true`. */
export function purgeJsonPii(value: unknown, depth = 0): { value: unknown; changed: boolean } {
  if (value === null || value === undefined || depth > 8) return { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = purgeJsonPii(v, depth + 1);
      changed = changed || r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        if (v !== KVKK_PURGED) changed = true;
        out[key] = KVKK_PURGED;
        continue;
      }
      const r = purgeJsonPii(v, depth + 1);
      changed = changed || r.changed;
      out[key] = r.value;
    }
    return { value: out, changed };
  }
  if (typeof value === 'string') {
    const masked = maskFreeText(value);
    return { value: masked, changed: masked !== value };
  }
  return { value, changed: false };
}

/** Serbest metindeki e-posta/telefon → `[silindi]`. */
export function maskFreeText(value: string): string {
  return value.replace(EMAIL_RE, KVKK_PURGED).replace(PHONE_RE, KVKK_PURGED);
}

/**
 * KvkkPurgeService — `kvkk:purge` cron işi (ADR-0015 KVKK saklama matrisi; docs/kvkk-veri-saklama.md).
 * Sırayla:
 *  1. MailLog + DISABLE_MAIL önizleme dosyaları (`privacy.mailLogDays`, ADR-0014: 90 gün)
 *  2. SystemLog (`privacy.systemLogDays`, 30 gün) — eski `logs:cleanup` işi bunun içinde
 *  3. CronLog (`privacy.cronLogDays`, 90 gün)
 *  4. AuditLog PII maskeleme (`privacy.auditPiiMonths`): satır SİLİNMEZ, PII alanları `[silindi]` olur
 *  5. `privacy.anonymizeInactiveMonths > 0` ise pasif müşteri hesapları CustomersService.anonymize ile anonimleştirilir
 * Her adım bağımsız hata yönetir (biri patlarsa diğerleri sürer, `errors` artar); 0 değeri o adımı KAPATIR.
 */
@Injectable()
export class KvkkPurgeService {
  private readonly logger = new Logger(KvkkPurgeService.name);

  constructor(
    private readonly repo: KvkkPurgeRepository,
    private readonly jobs: JobsRepository,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly customers: CustomersService,
  ) {}

  async run(now: Date): Promise<KvkkPurgeResult> {
    const privacy = await this.privacySettings();
    const result: KvkkPurgeResult = {
      settings: privacy,
      mailLogsDeleted: 0,
      mailPreviewsDeleted: 0,
      systemLogsDeleted: 0,
      cronLogsDeleted: 0,
      auditScanned: 0,
      auditMasked: 0,
      auditMaskedThrough: null,
      customersAnonymized: 0,
      anonymizeSkipped: 0,
      errors: 0,
      disabled: [],
    };

    // 1) MailLog (+ önizleme dosyaları)
    await this.step(result, 'mailLogDays', privacy.mailLogDays, async () => {
      const r = await this.mail.purgeLogsOlderThan(daysBefore(now, privacy.mailLogDays));
      result.mailLogsDeleted = r.deleted;
      result.mailPreviewsDeleted = r.previewsDeleted;
    });

    // 2) SystemLog (logs:cleanup)
    await this.step(result, 'systemLogDays', privacy.systemLogDays, async () => {
      result.systemLogsDeleted = await this.repo.deleteSystemLogsBefore(daysBefore(now, privacy.systemLogDays));
    });

    // 3) CronLog
    await this.step(result, 'cronLogDays', privacy.cronLogDays, async () => {
      result.cronLogsDeleted = await this.repo.deleteCronLogsBefore(daysBefore(now, privacy.cronLogDays));
    });

    // 4) AuditLog PII maskeleme
    await this.step(result, 'auditPiiMonths', privacy.auditPiiMonths, async () => {
      const before = monthsBefore(now, privacy.auditPiiMonths);
      const from = await this.lastMaskedThrough();
      const r = await this.maskAuditLogs(before, from);
      result.auditScanned = r.scanned;
      result.auditMasked = r.masked;
      result.auditMaskedThrough = r.completed ? before.toISOString() : (from?.toISOString() ?? null);
    });

    // 5) Pasif müşteri anonimleştirme (varsayılan KAPALI)
    await this.step(result, 'anonymizeInactiveMonths', privacy.anonymizeInactiveMonths, async () => {
      const before = monthsBefore(now, privacy.anonymizeInactiveMonths);
      const candidates = await this.repo.findInactiveCustomers(before, KVKK_INACTIVE_BATCH);
      for (const row of candidates) {
        try {
          await this.customers.anonymize(row.id, undefined);
          result.customersAnonymized++;
        } catch (err) {
          result.anonymizeSkipped++;
          this.logger.warn(`Pasif müşteri anonimleştirilemedi (uid:${row.id}): ${(err as Error).message}`);
        }
      }
    });

    this.logger.log(
      `kvkk:purge — mail ${result.mailLogsDeleted} · system ${result.systemLogsDeleted} · cron ${result.cronLogsDeleted} · ` +
        `audit ${result.auditMasked}/${result.auditScanned} maskelendi · anonim ${result.customersAnonymized}` +
        (result.disabled.length > 0 ? ` · kapalı: ${result.disabled.join(', ')}` : ''),
    );
    return result;
  }

  /** Toplam işlenen satır (CronLog `itemsProcessed`). */
  static itemsProcessed(r: KvkkPurgeResult): number {
    return r.mailLogsDeleted + r.systemLogsDeleted + r.cronLogsDeleted + r.auditMasked + r.customersAnonymized;
  }

  // ── Adımlar ────────────────────────────────────────────────────────────────

  /** Değer 0 ise adım KAPALI (atlanır); hata `errors` sayacına yazılır, koşu sürer. */
  private async step(result: KvkkPurgeResult, name: string, value: number, fn: () => Promise<void>): Promise<void> {
    if (!Number.isFinite(value) || value <= 0) {
      result.disabled.push(name);
      return;
    }
    try {
      await fn();
    } catch (err) {
      result.errors++;
      this.logger.error(`kvkk:purge adımı başarısız (${name}): ${(err as Error).message}`);
    }
  }

  /**
   * `[from, before)` penceresindeki AuditLog satırlarında PII'yi `[silindi]` yapar. `from` bir önceki başarılı
   * koşunun ulaştığı andır (tam tarama yalnız ilk koşuda). Üst sınır KVKK_AUDIT_SCAN_MAX_ROWS: aşılırsa pencere
   * kapanmaz (`completed:false`) ve bir sonraki koşu aynı yerden devam eder.
   */
  private async maskAuditLogs(before: Date, from: Date | null): Promise<{ scanned: number; masked: number; completed: boolean }> {
    let scanned = 0;
    let masked = 0;
    let cursor: string | null = null;
    for (;;) {
      const rows = await this.repo.findAuditLogsForMasking(before, from, KVKK_AUDIT_SCAN_BATCH, cursor);
      if (rows.length === 0) return { scanned, masked, completed: true };
      for (const row of rows) {
        scanned++;
        const oldV = purgeJsonPii(row.oldValues as unknown);
        const newV = purgeJsonPii(row.newValues as unknown);
        const summary = row.summary ? maskFreeText(row.summary) : null;
        const actorEmail = row.actorEmail ? KVKK_PURGED : null;
        const ipAddress = row.ipAddress ? KVKK_PURGED : null;
        const changed =
          oldV.changed ||
          newV.changed ||
          summary !== row.summary ||
          actorEmail !== row.actorEmail ||
          ipAddress !== row.ipAddress;
        if (!changed) continue;
        await this.repo.updateAuditLogPii(row.id, {
          actorEmail,
          ipAddress,
          summary,
          oldValues: (oldV.value as Prisma.InputJsonValue | null) ?? null,
          newValues: (newV.value as Prisma.InputJsonValue | null) ?? null,
        });
        masked++;
      }
      cursor = rows[rows.length - 1]!.id;
      if (rows.length < KVKK_AUDIT_SCAN_BATCH) return { scanned, masked, completed: true };
      if (scanned >= KVKK_AUDIT_SCAN_MAX_ROWS) {
        this.logger.warn(`kvkk:purge audit taraması üst sınıra ulaştı (${scanned}) — kalanı bir sonraki koşuda`);
        return { scanned, masked, completed: false };
      }
    }
  }

  /** Bir önceki `kvkk:purge` koşusunun `details.auditMaskedThrough` değeri (yoksa null → tam tarama). */
  private async lastMaskedThrough(): Promise<Date | null> {
    try {
      const last = await this.jobs.findLastRun('kvkk:purge');
      const details = (last?.details ?? null) as { auditMaskedThrough?: unknown } | null;
      const raw = typeof details?.auditMaskedThrough === 'string' ? details.auditMaskedThrough : null;
      if (!raw) return null;
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  /** Setting `privacy.*` (okunamazsa güvenli varsayılanlar). */
  private async privacySettings(): Promise<PrivacySettings> {
    try {
      const raw = (await this.settings.get('privacy')) as unknown as PrivacySettings;
      return {
        retentionMonths: numberOr(raw.retentionMonths, KVKK_PRIVACY_DEFAULTS.retentionMonths),
        mailLogDays: numberOr(raw.mailLogDays, KVKK_PRIVACY_DEFAULTS.mailLogDays),
        systemLogDays: numberOr(raw.systemLogDays, KVKK_PRIVACY_DEFAULTS.systemLogDays),
        cronLogDays: numberOr(raw.cronLogDays, KVKK_PRIVACY_DEFAULTS.cronLogDays),
        auditPiiMonths: numberOr(raw.auditPiiMonths, KVKK_PRIVACY_DEFAULTS.auditPiiMonths),
        anonymizeInactiveMonths: numberOr(raw.anonymizeInactiveMonths, KVKK_PRIVACY_DEFAULTS.anonymizeInactiveMonths),
      };
    } catch (err) {
      this.logger.warn(`privacy ayarları okunamadı, varsayılanlar kullanılıyor: ${(err as Error).message}`);
      return { ...KVKK_PRIVACY_DEFAULTS };
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
