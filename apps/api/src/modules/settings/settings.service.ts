import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  findSettingGroup,
  SETTINGS_REGISTRY,
  settingGroupDefaults,
  type AdminSettingGroup,
  type CommerceSettings,
  type CookieSettingsFull,
  type MailSettings,
  type PaymentSettings,
  type SettingFieldMeta,
  type SettingGroupMeta,
  type SettingGroupName,
  type SiteSettings,
  type SmsSettings,
} from '@bagdam/shared';
import type { Prisma } from '@prisma/client';
import type { Cache } from 'cache-manager';
import { decryptSecret, encryptSecret, isEncryptedValue } from '../../common/crypto.util';
import { mergeCommerceSettings } from '../catalog/catalog.mapper';
import { invalidateBootstrapCache } from './bootstrap-cache.util';
import { fieldNameOf, toAdminSettingGroup } from './settings.mapper';
import { SettingsRepository, type SettingRecord, type SettingUpsertInput } from './settings.repository';
import { normalizeSettingValue, SKIP_FIELD } from './settings.validation';

/** Grup satırlarının in-process cache süresi (ms) — admin PUT anında düşürür; başka süreç yazarsa en geç bu kadar gecikir. */
const ROWS_CACHE_TTL_MS = 60_000;

/** Eski seed satırı `payment.iyzico = {enabled, nonThreeDsGranted}` — düz `payment.enabled` / `payment.nonThreeDsGranted` yoksa buradan okunur. */
const LEGACY_PAYMENT_KEY = 'payment.iyzico';

export interface SettingsSetResult {
  group: AdminSettingGroup;
  /** Yazılan alan adları (secret'lar dahil; atlananlar yok). */
  changed: string[];
  /** Yazılan NORMALİZE değerler — yalnız secret olmayan alanlar (audit newValues; sırlar buraya girmez). */
  values: Record<string, unknown>;
}

/**
 * SettingsService — Setting tablosunun tek okuma/yazma noktası (ADR-0002: mantık burada; ADR-0014/0015 sırlar şifreli).
 *  - Şema: shared SETTINGS_REGISTRY (`<group>.<field>`); bilinmeyen grup 404, bilinmeyen alan 400.
 *  - `get(group)` → {field: value} — sırlar ÇÖZÜLMÜŞ (yalnız sunucu içi: MailModule F6, iyzico F8). Controller'a gitmez.
 *  - `getGroup/listGroups` → admin görünümü: sırlar maskeli (`••••••` + hasValue).
 *  - `set(group, patch)` → doğrula → secret'ı şifrele → tek işlemde upsert → cache + bootstrap cache düşür.
 *    Secret boş/maske gelirse alan DEĞİŞMEZ.
 *  - Cache: grup satırları 60 s in-process; `set` anında düşürür. Bootstrap cache'i `CatalogService.invalidateBootstrapCache`
 *    ile aynı anahtardan (bootstrap-cache.util) düşürülür — CatalogModule'e bağımlılık yok (döngü olmasın).
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly rowsCache = new Map<string, { rows: SettingRecord[]; expiresAt: number }>();

  constructor(
    private readonly repo: SettingsRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── Admin görünümü (maskeli) ────────────────────────────────────────────────

  async listGroups(): Promise<AdminSettingGroup[]> {
    const out: AdminSettingGroup[] = [];
    for (const meta of SETTINGS_REGISTRY) out.push(toAdminSettingGroup(meta, await this.getRows(meta.group)));
    return out;
  }

  async getGroup(group: string): Promise<AdminSettingGroup> {
    const meta = this.requireGroup(group);
    return toAdminSettingGroup(meta, await this.getRows(meta.group));
  }

  // ── Sunucu içi okuma (sırlar çözülmüş) ─────────────────────────────────────

  /** Grup değerleri: varsayılanlar üzerine DB satırları; secret alanlar çözülmüş düz metin (çözülemezse '' + log). */
  async get(group: string): Promise<Record<string, unknown>> {
    const meta = this.requireGroup(group);
    const rows = await this.getRows(meta.group);
    const values = settingGroupDefaults(meta.group);
    const byField = new Map<string, SettingRecord>();
    for (const row of rows) byField.set(fieldNameOf(row), row);

    for (const field of meta.fields) {
      const row = byField.get(field.key);
      if (!row) continue;
      values[field.key] = field.type === 'secret' ? this.readSecret(row) : row.value;
    }
    if (meta.group === 'payment') this.applyLegacyPayment(values, rows);
    return values;
  }

  /** Setting `commerce.*` → CommerceSettings (bozuk/eksik alanlar varsayılan; catalog mapper ile aynı birleştirme). */
  async getCommerce(): Promise<CommerceSettings> {
    return mergeCommerceSettings(await this.getRows('commerce'));
  }

  getSite(): Promise<SiteSettings> {
    return this.get('site') as Promise<unknown> as Promise<SiteSettings>;
  }

  getMail(): Promise<MailSettings> {
    return this.get('mail') as Promise<unknown> as Promise<MailSettings>;
  }

  getSms(): Promise<SmsSettings> {
    return this.get('sms') as Promise<unknown> as Promise<SmsSettings>;
  }

  getPayment(): Promise<PaymentSettings> {
    return this.get('payment') as Promise<unknown> as Promise<PaymentSettings>;
  }

  getCookies(): Promise<CookieSettingsFull> {
    return this.get('cookies') as Promise<unknown> as Promise<CookieSettingsFull>;
  }

  // ── Yazma ──────────────────────────────────────────────────────────────────

  /**
   * Kısmi güncelleme: yalnız gönderilen alanlar. Doğrulama registry şemasına göre (400), secret şifrelenir,
   * boş/maske secret atlanır. Sonra settings cache + bootstrap cache düşer.
   */
  async set(group: string, patch: unknown): Promise<SettingsSetResult> {
    const meta = this.requireGroup(group);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new BadRequestException('Gövde alan → değer nesnesi olmalı');
    }
    const entries = Object.entries(patch as Record<string, unknown>);
    if (entries.length === 0) throw new BadRequestException('Güncellenecek alan yok');

    const rows: SettingUpsertInput[] = [];
    const changed: string[] = [];
    const values: Record<string, unknown> = {};
    for (const [fieldName, raw] of entries) {
      const field = this.requireField(meta, fieldName);
      const normalized = normalizeSettingValue(meta.group, field, raw);
      if (normalized === SKIP_FIELD) continue;
      const isSecret = field.type === 'secret';
      const value = isSecret ? encryptSecret(normalized as string) : (normalized as Prisma.InputJsonValue);
      rows.push({ key: `${meta.group}.${field.key}`, group: meta.group, value, isSecret });
      changed.push(field.key);
      if (!isSecret) values[field.key] = normalized;
    }

    if (rows.length > 0) {
      await this.repo.upsertMany(rows);
      this.invalidate(meta.group);
      await invalidateBootstrapCache(this.cache);
      this.logger.log(`Ayar güncellendi: ${meta.group} (${changed.join(', ')})`);
    }
    return { group: await this.getGroup(meta.group), changed, values };
  }

  /** Grup cache'ini düşürür (grup verilmezse hepsi). Başka modüller doğrudan Setting yazarsa çağırır. */
  invalidate(group?: string): void {
    if (group) this.rowsCache.delete(group);
    else this.rowsCache.clear();
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  private requireGroup(group: string): SettingGroupMeta {
    const meta = findSettingGroup(group);
    if (!meta) throw new NotFoundException(`Ayar grubu bulunamadı: ${group}`);
    return meta;
  }

  private requireField(meta: SettingGroupMeta, fieldName: string): SettingFieldMeta {
    const field = meta.fields.find((f) => f.key === fieldName);
    if (!field) throw new BadRequestException(`Bilinmeyen alan: ${meta.group}.${fieldName}`);
    return field;
  }

  private async getRows(group: SettingGroupName | string): Promise<SettingRecord[]> {
    const hit = this.rowsCache.get(group);
    const now = Date.now();
    if (hit && hit.expiresAt > now) return hit.rows;
    const rows = await this.repo.findByGroup(group);
    this.rowsCache.set(group, { rows, expiresAt: now + ROWS_CACHE_TTL_MS });
    return rows;
  }

  /** Secret satır → düz metin. Şifreli değilse (eski düz metin) olduğu gibi; çözülemezse '' + hata logu. */
  private readSecret(row: SettingRecord): string {
    const value = row.value;
    if (typeof value !== 'string' || value.length === 0) return '';
    if (!isEncryptedValue(value)) return value;
    try {
      return decryptSecret(value);
    } catch (err) {
      this.logger.error(`${row.key} çözülemedi — SETTINGS_ENCRYPTION_KEY değişmiş olabilir: ${(err as Error).message}`);
      return '';
    }
  }

  /** `payment.iyzico` (seed v1) → `enabled` / `nonThreeDsGranted` (yalnız düz satır yoksa). */
  private applyLegacyPayment(values: Record<string, unknown>, rows: readonly SettingRecord[]): void {
    const legacy = rows.find((r) => r.key === LEGACY_PAYMENT_KEY);
    if (!legacy || !legacy.value || typeof legacy.value !== 'object' || Array.isArray(legacy.value)) return;
    const obj = legacy.value as Record<string, unknown>;
    const flatKeys = new Set(rows.map((r) => r.key));
    if (!flatKeys.has('payment.enabled') && typeof obj.enabled === 'boolean') values.enabled = obj.enabled;
    if (!flatKeys.has('payment.nonThreeDsGranted') && typeof obj.nonThreeDsGranted === 'boolean') {
      values.nonThreeDsGranted = obj.nonThreeDsGranted;
    }
  }
}
