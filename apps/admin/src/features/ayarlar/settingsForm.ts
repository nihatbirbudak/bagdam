/**
 * Ayarlar grubu: sunucu yanıtı → normalize grup/alan meta → form taslağı → PUT gövdesi (saf fonksiyonlar, test edilir).
 *
 * Sözleşme (B): `GET /admin/settings` → [{group,label,fields:[{key,label,type,options?,help?,default?, value|masked}]}],
 * secret alanlar `'••••••'` + `hasValue:true`; `PUT /admin/settings/:group {field:value}`; secret boş/maske gelirse değişmez.
 * Registry/yanıt şekli farklı gelirse (yalnız değer haritası vb.) alanlar değerden türetilir ki ekran çalışmaya devam etsin.
 */
import {
  CHARGE_STRATEGY_LABELS,
  CHARGE_STRATEGY_VALUES,
  DISCOUNT_ROUNDING_LABELS,
  DISCOUNT_ROUNDING_VALUES,
  FREE_SHIPPING_RULE_LABELS,
  FREE_SHIPPING_RULE_VALUES,
} from '@bagdam/shared';
import type { AdminSettingField, AdminSettingGroup, AdminSettingGroupUpdate, SettingFieldType } from '../../lib/apiTypes';
import { parseDecimalInput } from '../../lib/utils';
import { normalizeOptions, type SelectOption } from '../icerik/schemaForm';

export const SECRET_MASK = '••••••';

/** Grup etiketleri (sunucu `label` vermezse). */
export const SETTINGS_GROUP_LABELS: Record<string, string> = {
  commerce: 'Ticaret / Kampanya',
  site: 'Site',
  seo: 'SEO',
  cookies: 'Çerezler',
  mail: 'E-posta',
  sms: 'SMS',
  payment: 'Ödeme',
};

/** Alan etiketleri (yalnız sunucu meta vermezse; commerce anahtarları BACKEND-PLANI §2). */
export const SETTINGS_FIELD_LABELS: Record<string, Record<string, string>> = {
  commerce: {
    vatRate: 'Varsayılan KDV oranı (%)',
    deliveryDays: 'Teslimat günleri',
    frequencies: 'Abonelik sıklıkları',
    cutoff: 'Kesim kuralı',
    firstBoxDiscount: 'İlk kutu indirimi',
    skipsPerYear: 'Yıllık atlama hakkı',
    firstCycleSkippable: 'İlk kutu atlanabilir',
    retentionOffer: 'Kalma teklifi',
    extraAmountOptions: 'Ekstra miktar seçenekleri',
    deliveryWindow: 'Teslimat saat aralığı',
    deliveryDatesHorizonWeeks: 'Teslimat tarihi ufku (hafta)',
    dunning: 'Tahsilat yeniden deneme',
    chargeStrategy: 'Tahsilat stratejisi',
    paymentLinkHours: 'Ödeme linki süresi (saat)',
    freeShippingRule: 'Ücretsiz kargo eşik kuralı',
    discountRounding: 'İndirim yuvarlama',
    subscriberFreeShipping: 'Aktif aboneye tekil üründe ücretsiz kargo',
  },
  site: { name: 'Site adı', contactEmail: 'İletişim e-postası', contactPhone: 'İletişim telefonu' },
  seo: { description: 'Açıklama', ogImage: 'OG görseli', titles: 'Sayfa başlıkları' },
  cookies: { analyticsEnabled: 'Analitik çerezler', marketingEnabled: 'Pazarlama çerezleri' },
  mail: { provider: 'Sağlayıcı', host: 'SMTP sunucusu', port: 'Port', user: 'Kullanıcı', pass: 'Parola', from: 'Gönderen adres', fromName: 'Gönderen adı' },
  sms: { provider: 'Sağlayıcı', user: 'Kullanıcı', pass: 'Parola', header: 'Başlık (gönderici adı)' },
  payment: {
    provider: 'Sağlayıcı',
    // ADR-0019 (PayTR birincil) — registry alan adları: paytr* + storedCardEnabled + nonThreeDsGranted + maxInstallment
    paytrMerchantId: 'PayTR mağaza no (merchant_id)',
    paytrMerchantKey: 'PayTR merchant key',
    paytrMerchantSalt: 'PayTR merchant salt',
    paytrTestMode: 'PayTR test modu',
    paytrCallbackAllowedIps: 'Callback IP izin listesi',
    storedCardEnabled: 'Kayıtlı kart / tekrarlayan tahsilat açık (PayTR onayı)',
    nonThreeDsGranted: 'NON3D (saklı karttan) yetkisi teyitli',
    maxInstallment: 'En fazla taksit',
    // iyzico P2 (ADR-0010 → ADR-0019); eski kayıtlar için etiketler kalır
    iyzicoApiKey: 'iyzico API anahtarı',
    iyzicoSecretKey: 'iyzico gizli anahtar',
    iyzicoBaseUrl: 'iyzico taban URL',
    enabled: 'Ödeme açık',
  },
};

const TYPE_ALIASES: Record<string, SettingFieldType> = {
  text: 'text',
  string: 'text',
  url: 'text',
  email: 'text',
  number: 'number',
  int: 'number',
  integer: 'number',
  float: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  select: 'select',
  enum: 'select',
  secret: 'secret',
  password: 'secret',
  json: 'json',
  object: 'json',
  array: 'json',
  textarea: 'textarea',
  multiline: 'textarea',
};

export function normalizeSettingFieldType(t: unknown): SettingFieldType {
  if (typeof t !== 'string') return 'text';
  return TYPE_ALIASES[t.trim().toLowerCase()] ?? 'text';
}

export function isMaskedValue(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && /^[•*]+$/.test(v);
}

function inferType(value: unknown): SettingFieldType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return value.length > 120 || value.includes('\n') ? 'textarea' : 'text';
  return 'json';
}

const SECRET_KEY_RE = /(pass|secret|token|apikey|api_key|password)/i;

function normalizeField(group: string, raw: unknown, keyHint?: string): AdminSettingField | null {
  const r = (raw && typeof raw === 'object' ? raw : { value: raw }) as Record<string, unknown>;
  const key = typeof r.key === 'string' && r.key ? r.key : typeof r.name === 'string' && r.name ? r.name : keyHint;
  if (!key) return null;
  const hasMeta = typeof r.type === 'string';
  const type: SettingFieldType = hasMeta ? normalizeSettingFieldType(r.type) : SECRET_KEY_RE.test(key) || isMaskedValue(r.value) ? 'secret' : inferType(r.value);
  const label = typeof r.label === 'string' && r.label ? r.label : (SETTINGS_FIELD_LABELS[group]?.[key] ?? key);
  const value = 'value' in r ? r.value : undefined;
  const out: AdminSettingField = { key, label, type, value };
  if (r.options !== undefined) out.options = Array.isArray(r.options) ? (r.options as AdminSettingField['options']) : undefined;
  if (typeof r.help === 'string' && r.help) out.help = r.help;
  if ('default' in r) out.default = r.default;
  if (r.required === true) out.required = true;
  if (typeof r.min === 'number') out.min = r.min;
  if (typeof r.max === 'number') out.max = r.max;
  if (r.integer === true) out.integer = true;
  if (typeof r.updatedAt === 'string' || r.updatedAt === null) out.updatedAt = r.updatedAt as string | null;
  if (type === 'secret') {
    out.masked = true;
    out.isSecret = true;
    out.hasValue = typeof r.hasValue === 'boolean' ? r.hasValue : isMaskedValue(value) || (typeof value === 'string' && value.length > 0);
  }
  return out;
}

/** Tek grup yanıtı → normalize grup (fields dizisi, alan haritası ya da salt değer haritası kabul edilir). */
export function normalizeSettingsGroup(raw: unknown, groupHint?: string): AdminSettingGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const group = typeof r.group === 'string' && r.group ? r.group : typeof r.key === 'string' && r.key ? r.key : typeof r.name === 'string' && r.name ? r.name : groupHint;
  if (!group) return null;
  const label = typeof r.label === 'string' && r.label ? r.label : (SETTINGS_GROUP_LABELS[group] ?? group);
  const description = typeof r.description === 'string' ? r.description : undefined;
  let fields: AdminSettingField[];
  if (Array.isArray(r.fields)) {
    fields = r.fields.map((f) => normalizeField(group, f)).filter(Boolean) as AdminSettingField[];
  } else if (r.fields && typeof r.fields === 'object') {
    fields = Object.entries(r.fields as Record<string, unknown>)
      .map(([k, f]) => normalizeField(group, f, k))
      .filter(Boolean) as AdminSettingField[];
  } else {
    // Salt değer haritası: {vatRate: 1, …} (group/label/fields dışındaki anahtarlar)
    const source = r.values && typeof r.values === 'object' ? (r.values as Record<string, unknown>) : r;
    fields = Object.entries(source)
      .filter(([k]) => !['group', 'label', 'description', 'key', 'name', 'updatedAt'].includes(k))
      .map(([k, v]) => normalizeField(group, { value: v }, k))
      .filter(Boolean) as AdminSettingField[];
  }
  return { group, label, description, fields };
}

/** `GET /admin/settings` → grup listesi (dizi, `{items}` ya da `{group:{…}}` haritası). */
export function normalizeSettingsGroups(raw: unknown): AdminSettingGroup[] {
  if (Array.isArray(raw)) return raw.map((g) => normalizeSettingsGroup(g)).filter(Boolean) as AdminSettingGroup[];
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.items)) return normalizeSettingsGroups(r.items);
    if (Array.isArray(r.groups)) return normalizeSettingsGroups(r.groups);
    return Object.entries(r)
      .map(([k, v]) => normalizeSettingsGroup(v, k))
      .filter(Boolean) as AdminSettingGroup[];
  }
  return [];
}

/* ── Form taslağı ─────────────────────────────────────────────────────────── */

/** Alan → form değeri: boolean dışındakiler metin; secret için `undefined` = dokunulmadı. */
export type SettingsDraft = Record<string, string | boolean | undefined>;

export function toSettingsDraft(fields: AdminSettingField[]): SettingsDraft {
  const d: SettingsDraft = {};
  for (const f of fields) {
    const v = f.value ?? f.default;
    switch (f.type) {
      case 'boolean':
        d[f.key] = v === true || v === 'true' || v === 1;
        break;
      case 'number':
        d[f.key] = v === null || v === undefined || v === '' ? '' : String(v).replace('.', ',');
        break;
      case 'json':
        d[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        break;
      case 'secret':
        d[f.key] = undefined;
        break;
      default:
        d[f.key] = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  return d;
}

/** Select seçenekleri: sunucu `options`; yoksa bilinen anahtarlar için shared etiketleri. */
export function selectOptionsFor(group: string, field: AdminSettingField): SelectOption[] {
  const fromMeta = normalizeOptions(field.options);
  if (fromMeta) return fromMeta;
  if (group === 'commerce') {
    if (field.key === 'freeShippingRule') return FREE_SHIPPING_RULE_VALUES.map((v) => ({ value: v, label: FREE_SHIPPING_RULE_LABELS[v] }));
    if (field.key === 'discountRounding') return DISCOUNT_ROUNDING_VALUES.map((v) => ({ value: v, label: DISCOUNT_ROUNDING_LABELS[v] }));
    if (field.key === 'chargeStrategy') return CHARGE_STRATEGY_VALUES.map((v) => ({ value: v, label: CHARGE_STRATEGY_LABELS[v] }));
  }
  if (group === 'mail' && field.key === 'provider') return ['smtp', 'resend', 'ses'].map((v) => ({ value: v, label: v.toUpperCase() }));
  if (group === 'sms' && field.key === 'provider') return [{ value: 'netgsm', label: 'Netgsm' }];
  // ADR-0019: PayTR birincil; manuel yalnız geliştirme/test. iyzico P2 (sunucu options verirse o kazanır).
  if (group === 'payment' && field.key === 'provider') return [
    { value: 'paytr', label: 'PayTR' },
    { value: 'manual', label: 'Manuel (ödeme sağlayıcısı yok — geliştirme/test)' },
  ];
  return [];
}

/** Doğrulama: sayı, JSON, select üyeliği. Anahtar = alan key. */
export function validateSettingsDraft(group: string, fields: AdminSettingField[], draft: SettingsDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = draft[f.key];
    if (f.type === 'number') {
      const s = String(v ?? '').trim();
      if (!s) {
        if (f.required) errors[f.key] = 'Zorunlu sayı';
        continue;
      }
      const n = parseDecimalInput(s);
      if (n === null) errors[f.key] = 'Geçerli bir sayı girin';
      else if (f.integer && !Number.isInteger(n)) errors[f.key] = 'Tam sayı olmalı';
      else if (f.min !== undefined && n < f.min) errors[f.key] = `En az ${f.min}`;
      else if (f.max !== undefined && n > f.max) errors[f.key] = `En çok ${f.max}`;
    } else if (f.type === 'json') {
      const s = String(v ?? '').trim();
      if (s) {
        try {
          JSON.parse(s);
        } catch {
          errors[f.key] = 'Geçerli JSON değil';
        }
      } else if (f.required) errors[f.key] = 'Zorunlu';
    } else if (f.type === 'select') {
      const s = String(v ?? '');
      const opts = selectOptionsFor(group, f);
      if (!s && f.required) errors[f.key] = 'Seçim zorunlu';
      else if (s && opts.length && !opts.some((o) => o.value === s)) errors[f.key] = 'Geçersiz seçenek';
    } else if (f.type === 'text' || f.type === 'textarea') {
      if (f.required && !String(v ?? '').trim()) errors[f.key] = 'Zorunlu alan';
    }
  }
  return errors;
}

/**
 * PUT gövdesi: secret alan yalnız yeni (boş olmayan, maske olmayan) değer girildiyse; number → sayı; json → parse;
 * boolean → boolean; diğerleri metin. Dokunulmamış secret gövdeye girmez (sunucu da boş/maske gelirse değiştirmez).
 */
export function toSettingsBody(fields: AdminSettingField[], draft: SettingsDraft): AdminSettingGroupUpdate {
  const body: AdminSettingGroupUpdate = {};
  for (const f of fields) {
    const v = draft[f.key];
    switch (f.type) {
      case 'secret': {
        if (typeof v === 'string' && v.trim() && !isMaskedValue(v)) body[f.key] = v;
        break;
      }
      case 'boolean':
        body[f.key] = !!v;
        break;
      case 'number': {
        const s = String(v ?? '').trim();
        body[f.key] = s ? parseDecimalInput(s) : null;
        break;
      }
      case 'json': {
        const s = String(v ?? '').trim();
        if (!s) body[f.key] = null;
        else {
          try {
            body[f.key] = JSON.parse(s);
          } catch {
            body[f.key] = s;
          }
        }
        break;
      }
      default:
        body[f.key] = typeof v === 'string' ? v : v === undefined ? '' : String(v);
    }
  }
  return body;
}

/** Değişen alanları sayar (kaydet düğmesi etkinliği). */
export function isSettingsDraftDirty(fields: AdminSettingField[], initial: SettingsDraft, current: SettingsDraft): boolean {
  for (const f of fields) {
    if (f.type === 'secret') {
      if (typeof current[f.key] === 'string' && (current[f.key] as string).length > 0) return true;
      continue;
    }
    if (initial[f.key] !== current[f.key]) return true;
  }
  return false;
}

/* ── Ödeme ayarı uyarıları (Ayarlar › Ödeme, ADR-0019) ────────────────────── */

export interface PaymentModeWarning {
  code: 'REGISTRY_NO_PAYTR' | 'MANUAL_PROVIDER' | 'IYZICO_P2' | 'PAYTR_TEST_MODE' | 'PAYTR_CREDENTIALS_MISSING' | 'STORED_CARD_OFF' | 'PAYMENTS_DISABLED';
  tone: 'warning' | 'info';
  message: string;
}

function fieldBool(f: AdminSettingField | undefined): boolean | undefined {
  if (!f) return undefined;
  const v = f.value ?? f.default;
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return undefined;
}

function fieldHasValue(f: AdminSettingField | undefined): boolean {
  if (!f) return false;
  if (f.type === 'secret') return !!f.hasValue;
  const v = f.value ?? f.default;
  return v !== undefined && v !== null && String(v).trim() !== '';
}

const PAYTR_CREDENTIAL_KEYS = ['paytrMerchantId', 'paytrMerchantKey', 'paytrMerchantSalt'] as const;

/**
 * Ödeme grubu alanlarından operatöre gösterilecek uyarılar (saf): manuel sağlayıcı (gerçek tahsilat yok), PayTR test modu,
 * eksik mağaza bilgileri, kayıtlı kart kapalı (abonelik → ödeme linki), ödeme alma kapalı, registry'de PayTR alanı yok (A).
 */
export function paymentModeWarnings(group: Pick<AdminSettingGroup, 'fields'> | null | undefined): PaymentModeWarning[] {
  if (!group) return [];
  const byKey = new Map(group.fields.map((f) => [f.key, f] as const));
  const providerField = byKey.get('provider');
  const provider = String(providerField?.value ?? providerField?.default ?? '').toLowerCase();
  const out: PaymentModeWarning[] = [];
  const hasPaytrFields = PAYTR_CREDENTIAL_KEYS.some((k) => byKey.has(k));
  if (!hasPaytrFields) {
    out.push({
      code: 'REGISTRY_NO_PAYTR',
      tone: 'info',
      message: 'Ayar kaydında PayTR alanları (paytrMerchantId / paytrMerchantKey / paytrMerchantSalt) henüz yok — settings registry ADR-0019 ile güncellenince burada otomatik görünür.',
    });
  }
  if (provider === 'manual') {
    out.push({
      code: 'MANUAL_PROVIDER',
      tone: 'warning',
      message: 'Sağlayıcı "manuel": gerçek tahsilat yapılmaz, checkout ödemeleri anında başarılı sayılır (yalnız geliştirme/test). Lansman öncesi PayTR seçilmeli.',
    });
  } else if (provider === 'iyzico') {
    out.push({ code: 'IYZICO_P2', tone: 'warning', message: 'iyzico adaptörü P2 (ADR-0019): bu seçimle ödeme alınamaz (503 PAYMENT_PROVIDER_UNAVAILABLE). PayTR seçin.' });
  } else if (provider === 'paytr') {
    if (fieldBool(byKey.get('paytrTestMode')) === true) {
      out.push({
        code: 'PAYTR_TEST_MODE',
        tone: 'warning',
        message: 'PayTR TEST MODU açık: iFrame ödemeleri gerçek kart çekimi yapmaz (test kartları). Canlıya geçerken kapatın ve PayTR panelinde callback URL\'sini doğrulayın.',
      });
    }
    const missing = PAYTR_CREDENTIAL_KEYS.filter((k) => byKey.has(k) && !fieldHasValue(byKey.get(k)));
    if (missing.length) {
      out.push({ code: 'PAYTR_CREDENTIALS_MISSING', tone: 'warning', message: `PayTR mağaza bilgileri eksik: ${missing.join(', ')} — iFrame token alınamaz, callback hash doğrulanamaz.` });
    }
    if (byKey.has('storedCardEnabled') && fieldBool(byKey.get('storedCardEnabled')) === false) {
      out.push({
        code: 'STORED_CARD_OFF',
        tone: 'info',
        message: 'Kayıtlı kart / tekrarlayan tahsilat kapalı: abonelik dönem tahsilatları ödeme linki (PAYMENT_LINK) ile yapılır. PayTR onayı gelince açın.',
      });
    }
  }
  if (byKey.has('enabled') && fieldBool(byKey.get('enabled')) === false) {
    out.push({ code: 'PAYMENTS_DISABLED', tone: 'warning', message: 'Ödeme alma kapalı: checkout bakım metni gösterir, yeni sipariş alınmaz.' });
  }
  return out;
}
