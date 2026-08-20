import { BadRequestException } from '@nestjs/common';
import {
  DELIVERY_DAY_META,
  DELIVERY_DAY_SLUG_VALUES,
  deliveryDayFromSlug,
  SETTINGS_SECRET_MASK,
  type SettingFieldMeta,
} from '@bagdam/shared';

/**
 * Setting alan doğrulama/normalizasyonu — registry şemasına göre (SETTINGS_REGISTRY, shared).
 * Saf fonksiyonlar: HTTP hatası olarak BadRequestException fırlatır (mesaj `<group>.<field>: …`).
 * Secret alanlarda boş metin ya da maske → `SKIP_FIELD` (değer DEĞİŞMEZ; SettingsService atlar).
 */

export const SKIP_FIELD: unique symbol = Symbol('settings:skip-field');
export type SkipField = typeof SKIP_FIELD;

const TEXT_MAX = 2000;
const TEXTAREA_MAX = 20_000;
const SECRET_MAX = 4000;
const JSON_MAX_BYTES = 64 * 1024;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function fail(path: string, message: string): never {
  throw new BadRequestException(`${path}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** "12" / "12.5" gibi sayısal metinleri de kabul eder (admin formu metin gönderebilir). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return null;
}

// ── commerce.* yapılı alanların özel doğrulamaları (COMMERCE_SETTINGS_DEFAULTS şekli) ──────────────────────────

function validateDeliveryDays(path: string, value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'en az bir teslimat günü içeren dizi olmalı');
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) fail(path, 'her öğe {id,label,dow} nesnesi olmalı');
    const id = item.id;
    if (typeof id !== 'string' || !deliveryDayFromSlug(id)) fail(path, `id ${DELIVERY_DAY_SLUG_VALUES.join('|')} olmalı`);
    if (seen.has(id)) fail(path, `tekrarlanan gün: ${id}`);
    seen.add(id);
    if (typeof item.label !== 'string' || item.label.trim() === '') fail(path, `label zorunlu (${id})`);
    const expectedDow = DELIVERY_DAY_META[deliveryDayFromSlug(id)!].dow;
    if (item.dow !== undefined && item.dow !== expectedDow) fail(path, `${id} için dow ${expectedDow} olmalı`);
    item.dow = expectedDow;
  }
  return value;
}

function validateFrequencies(path: string, value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'en az bir sıklık içeren dizi olmalı');
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) fail(path, 'her öğe {id,weeks,label} nesnesi olmalı');
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(item.id)) fail(path, 'id küçük harf/rakam slug olmalı');
    if (seen.has(item.id)) fail(path, `tekrarlanan id: ${item.id}`);
    seen.add(item.id);
    if (!isInt(item.weeks) || item.weeks < 1 || item.weeks > 52) fail(path, `weeks 1–52 tam sayı olmalı (${item.id})`);
    if (typeof item.label !== 'string' || item.label.trim() === '') fail(path, `label zorunlu (${item.id})`);
  }
  return value;
}

function validateCutoff(path: string, value: unknown): unknown {
  if (!isPlainObject(value)) fail(path, '{daysBefore,time} nesnesi olmalı');
  if (!isInt(value.daysBefore) || value.daysBefore < 0 || value.daysBefore > 7) fail(path, 'daysBefore 0–7 tam sayı olmalı');
  if (typeof value.time !== 'string' || !HHMM_RE.test(value.time)) fail(path, "time 'HH:mm' olmalı");
  return { daysBefore: value.daysBefore, time: value.time };
}

function validateDiscount(path: string, value: unknown): unknown {
  if (!isPlainObject(value)) fail(path, '{pct,boxes,perUserOnce} nesnesi olmalı');
  if (!isFiniteNumber(value.pct) || value.pct < 0 || value.pct > 100) fail(path, 'pct 0–100 olmalı');
  if (!isInt(value.boxes) || value.boxes < 0 || value.boxes > 52) fail(path, 'boxes 0–52 tam sayı olmalı');
  if (typeof value.perUserOnce !== 'boolean') fail(path, 'perUserOnce boolean olmalı');
  return { pct: value.pct, boxes: value.boxes, perUserOnce: value.perUserOnce };
}

function validateExtraAmountOptions(path: string, value: unknown): unknown {
  if (!isPlainObject(value)) fail(path, 'birim → çarpan listesi nesnesi olmalı');
  if (!Array.isArray(value.default)) fail(path, "'default' listesi zorunlu");
  for (const [unit, list] of Object.entries(value)) {
    if (!Array.isArray(list) || list.length === 0) fail(path, `${unit}: boş olmayan sayı listesi olmalı`);
    for (const n of list) if (!isFiniteNumber(n) || n <= 0) fail(path, `${unit}: çarpanlar pozitif sayı olmalı`);
  }
  return value;
}

function validateDunning(path: string, value: unknown): unknown {
  if (!isPlainObject(value)) fail(path, '{retryHours,pastDueAfterUnpaid} nesnesi olmalı');
  if (!Array.isArray(value.retryHours) || value.retryHours.length === 0) fail(path, 'retryHours boş olmayan saat listesi olmalı');
  for (const h of value.retryHours) if (!isInt(h) || h <= 0 || h > 24 * 30) fail(path, 'retryHours pozitif tam saat olmalı');
  if (!isInt(value.pastDueAfterUnpaid) || value.pastDueAfterUnpaid < 1 || value.pastDueAfterUnpaid > 12) {
    fail(path, 'pastDueAfterUnpaid 1–12 tam sayı olmalı');
  }
  return { retryHours: value.retryHours, pastDueAfterUnpaid: value.pastDueAfterUnpaid };
}

/** seo.<sayfa>: {title, description?}. */
function validateSeoPage(path: string, value: unknown): unknown {
  if (!isPlainObject(value)) fail(path, '{title, description?} nesnesi olmalı');
  if (typeof value.title !== 'string' || value.title.trim() === '' || value.title.length > 200) fail(path, 'title zorunlu (≤200 karakter)');
  const out: Record<string, unknown> = { title: value.title.trim() };
  if (value.description !== undefined && value.description !== null && value.description !== '') {
    if (typeof value.description !== 'string' || value.description.length > 500) fail(path, 'description metin olmalı (≤500 karakter)');
    out.description = value.description.trim();
  }
  return out;
}

const COMMERCE_JSON_VALIDATORS: Record<string, (path: string, value: unknown) => unknown> = {
  deliveryDays: validateDeliveryDays,
  frequencies: validateFrequencies,
  cutoff: validateCutoff,
  firstBoxDiscount: validateDiscount,
  retentionOffer: validateDiscount,
  extraAmountOptions: validateExtraAmountOptions,
  dunning: validateDunning,
};

function validateJson(group: string, field: SettingFieldMeta, path: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') fail(path, 'JSON nesne ya da dizi olmalı');
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    fail(path, 'JSON serileştirilemedi');
  }
  if (size > JSON_MAX_BYTES) fail(path, `JSON çok büyük (en çok ${JSON_MAX_BYTES / 1024} KB)`);
  if (group === 'commerce') {
    const validator = COMMERCE_JSON_VALIDATORS[field.key];
    if (validator) return validator(path, value);
    // Şekli bilinen varsayılanla aynı tür olmalı (dizi ↔ nesne)
    if (Array.isArray(field.default) !== Array.isArray(value)) fail(path, Array.isArray(field.default) ? 'dizi olmalı' : 'nesne olmalı');
    return value;
  }
  if (group === 'seo' && field.key !== 'description' && field.key !== 'ogImage') return validateSeoPage(path, value);
  return value;
}

/**
 * Alan değerini şemaya göre doğrular ve normalize eder. Dönüş: saklanacak değer ya da `SKIP_FIELD`
 * (secret: boş/maske). Şifreleme burada YAPILMAZ (SettingsService).
 */
export function normalizeSettingValue(group: string, field: SettingFieldMeta, value: unknown): unknown | SkipField {
  const path = `${group}.${field.key}`;
  const required = field.required === true;

  switch (field.type) {
    case 'secret': {
      if (value === null || value === undefined || value === '' || value === SETTINGS_SECRET_MASK) return SKIP_FIELD;
      if (typeof value !== 'string') fail(path, 'metin olmalı');
      if (value.length > SECRET_MAX) fail(path, `çok uzun (en çok ${SECRET_MAX} karakter)`);
      return value;
    }
    case 'text':
    case 'textarea': {
      if (value === null || value === undefined) {
        if (required) fail(path, 'zorunlu');
        return '';
      }
      if (typeof value !== 'string') fail(path, 'metin olmalı');
      const trimmed = value.trim();
      const max = field.type === 'text' ? TEXT_MAX : TEXTAREA_MAX;
      if (trimmed.length > max) fail(path, `çok uzun (en çok ${max} karakter)`);
      if (required && trimmed === '') fail(path, 'zorunlu');
      return trimmed;
    }
    case 'number': {
      // Admin formu tüm alanları gönderir: zorunlu olmayan sayı boş/null gelirse alan DEĞİŞMEZ (ör. mail.port).
      if (!required && (value === null || value === undefined || value === '')) return SKIP_FIELD;
      const n = toNumber(value);
      if (n === null) fail(path, 'sayı olmalı');
      if (field.integer && !Number.isInteger(n)) fail(path, 'tam sayı olmalı');
      if (field.min !== undefined && n < field.min) fail(path, `en az ${field.min} olmalı`);
      if (field.max !== undefined && n > field.max) fail(path, `en çok ${field.max} olmalı`);
      return n;
    }
    case 'boolean': {
      const b = toBoolean(value);
      if (b === null) fail(path, 'true/false olmalı');
      return b;
    }
    case 'select': {
      const options = field.options ?? [];
      if (typeof value !== 'string' || !options.some((o) => o.value === value)) {
        fail(path, `şunlardan biri olmalı: ${options.map((o) => o.value).join(' | ')}`);
      }
      return value;
    }
    case 'json':
      return validateJson(group, field, path, value);
    default:
      return fail(path, `bilinmeyen alan tipi ${String((field as { type: unknown }).type)}`);
  }
}
