/**
 * SiteContent şeması → form durumu → değer dönüşümleri (saf fonksiyonlar, test edilir).
 *
 * Şema kaynağı A registry (`apps/api/src/modules/content/site-content.registry.ts`):
 *   {fields:[{name,label,type:'text'|'textarea'|'richtext'|'image'|'url'|'number'|'boolean'|'select'|'list',required?,options?,itemFields?,help?}]}
 * Shared/seed biçimi (`SiteContentSchema`): `key` + `item` + `html`/`featured` türleri. Burada ikisi de aynı normalize
 * biçime indirgenir; panel yalnız `ContentFieldNormalized` kullanır.
 *
 * Form durumu: sayısal alanlar metin (kontrollü input) tutulur; `fromFormState` sayıya çevirir. Değerin kök şekli
 * (nesne ya da dizi — `home.featured` / `home.pillars` gibi kökü dizi olan anahtarlar) korunur.
 */
import type { ContentFieldOption, ContentFieldRaw, FeaturedItem } from '../../lib/apiTypes';
import { parseDecimalInput } from '../../lib/utils';

export type NormalizedFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'image'
  | 'url'
  | 'number'
  | 'boolean'
  | 'select'
  | 'list'
  | 'featured'
  /** Yalnız şemasız/yedek durum: serbest JSON metni. */
  | 'json';

export interface SelectOption {
  value: string;
  label: string;
}

export interface ContentFieldNormalized {
  name: string;
  label: string;
  type: NormalizedFieldType;
  required: boolean;
  options?: SelectOption[];
  itemFields?: ContentFieldNormalized[];
  help?: string;
  maxLength?: number;
  /** `list`: en az/en çok öğe · `number`: değer aralığı (A registry `min`/`max`). */
  min?: number;
  max?: number;
}

export type FormValues = Record<string, unknown>;
export type RootShape = 'object' | 'array';

export interface FormState {
  values: FormValues;
  rootShape: RootShape;
  /** Kök dizi ise bu alanın değeri kök olarak yazılır. */
  rootListField: string | null;
}

const TYPE_ALIASES: Record<string, NormalizedFieldType> = {
  text: 'text',
  string: 'text',
  textarea: 'textarea',
  multiline: 'textarea',
  richtext: 'richtext',
  html: 'richtext',
  image: 'image',
  media: 'image',
  url: 'url',
  link: 'url',
  number: 'number',
  int: 'number',
  integer: 'number',
  float: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  select: 'select',
  enum: 'select',
  list: 'list',
  array: 'list',
  featured: 'featured',
  json: 'json',
};

export function normalizeFieldType(type: unknown): NormalizedFieldType {
  if (typeof type !== 'string') return 'text';
  return TYPE_ALIASES[type.trim().toLowerCase()] ?? 'text';
}

export function normalizeOptions(options: unknown): SelectOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const out: SelectOption[] = [];
  for (const o of options as ContentFieldOption[]) {
    if (typeof o === 'string' || typeof o === 'number') out.push({ value: String(o), label: String(o) });
    else if (o && typeof o === 'object' && 'value' in o) {
      const v = String((o as { value: unknown }).value);
      out.push({ value: v, label: typeof (o as { label?: unknown }).label === 'string' ? (o as { label: string }).label : v });
    }
  }
  return out.length ? out : undefined;
}

function normalizeField(raw: unknown): ContentFieldNormalized | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as ContentFieldRaw & Record<string, unknown>;
  const name = typeof f.name === 'string' && f.name ? f.name : typeof f.key === 'string' && f.key ? f.key : null;
  if (!name) return null;
  const type = normalizeFieldType(f.type);
  const itemsRaw = Array.isArray(f.itemFields) ? f.itemFields : Array.isArray(f.item) ? f.item : Array.isArray(f.fields) ? (f.fields as unknown[]) : undefined;
  const itemFields = itemsRaw ? (itemsRaw.map(normalizeField).filter(Boolean) as ContentFieldNormalized[]) : undefined;
  const out: ContentFieldNormalized = {
    name,
    label: typeof f.label === 'string' && f.label ? f.label : name,
    type,
    required: !!f.required,
  };
  const options = normalizeOptions(f.options);
  if (options) out.options = options;
  if (type === 'list') out.itemFields = itemFields ?? [];
  if (typeof f.help === 'string' && f.help) out.help = f.help;
  if (typeof f.maxLength === 'number' && f.maxLength > 0) out.maxLength = f.maxLength;
  if (typeof f.min === 'number') out.min = f.min;
  if (typeof f.max === 'number') out.max = f.max;
  return out;
}

/** `{fields:[…]}` ya da doğrudan dizi; tanınmayan/eksik şema → boş liste (çağıran `inferSchemaFromValue` ile tamamlar). */
export function normalizeSchema(schema: unknown): ContentFieldNormalized[] {
  const list = Array.isArray(schema)
    ? schema
    : schema && typeof schema === 'object' && Array.isArray((schema as { fields?: unknown }).fields)
      ? ((schema as { fields: unknown[] }).fields as unknown[])
      : [];
  return list.map(normalizeField).filter(Boolean) as ContentFieldNormalized[];
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(s);
}

function inferFieldFromValue(name: string, value: unknown): ContentFieldNormalized {
  const base = { name, label: name, required: false } as const;
  if (typeof value === 'boolean') return { ...base, type: 'boolean' };
  if (typeof value === 'number') return { ...base, type: 'number' };
  if (typeof value === 'string') {
    if (looksLikeHtml(value)) return { ...base, type: 'richtext' };
    if (value.length > 120 || value.includes('\n')) return { ...base, type: 'textarea' };
    return { ...base, type: 'text' };
  }
  if (Array.isArray(value)) {
    const first = value.find((v) => v && typeof v === 'object' && !Array.isArray(v)) as Record<string, unknown> | undefined;
    if (first) {
      const keys = new Set<string>();
      for (const v of value) if (v && typeof v === 'object') for (const k of Object.keys(v as object)) keys.add(k);
      return { ...base, type: 'list', itemFields: Array.from(keys).map((k) => inferFieldFromValue(k, first[k])) };
    }
    return { ...base, type: 'json' };
  }
  return { ...base, type: 'json' };
}

/** Şema yoksa mevcut değerden alan listesi türetir (düzenlenebilir kalsın; A registry geldiğinde gerçek şema kullanılır). */
export function inferSchemaFromValue(value: unknown, key?: string): ContentFieldNormalized[] {
  if (key === 'home.featured' || (Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'type' in (v as object) && 'ref' in (v as object)))) {
    return [{ name: 'items', label: 'Öne çıkanlar', type: 'featured', required: false }];
  }
  if (Array.isArray(value)) return [{ ...inferFieldFromValue('items', value), label: 'Öğeler' }];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => inferFieldFromValue(k, v));
  }
  return [];
}

/** Alanın boş/varsayılan form değeri. */
export function defaultFor(field: ContentFieldNormalized): unknown {
  switch (field.type) {
    case 'boolean':
      return false;
    case 'list':
    case 'featured':
      return [];
    case 'number':
      return '';
    case 'select':
      return field.options?.[0]?.value ?? '';
    case 'json':
      return '';
    default:
      return '';
  }
}

function valueToForm(field: ContentFieldNormalized, value: unknown): unknown {
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' || value === 1;
    case 'number':
      return value === null || value === undefined || value === '' ? '' : String(value).replace('.', ',');
    case 'list': {
      if (!Array.isArray(value)) return [];
      return value.map((item) => {
        const obj = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
        const out: FormValues = {};
        for (const sub of field.itemFields ?? []) out[sub.name] = valueToForm(sub, obj[sub.name]);
        return out;
      });
    }
    case 'featured':
      return normalizeFeatured(value);
    case 'json':
      return value === undefined ? '' : JSON.stringify(value, null, 2);
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/** `home.featured` değeri: `[{type,ref,order}]` ya da `{items:[…]}`; sıraya göre dizilir. */
export function normalizeFeatured(value: unknown): FeaturedItem[] {
  const arr = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  const out: FeaturedItem[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const type = r.type === 'tier' ? 'tier' : 'product';
    const ref = typeof r.ref === 'string' ? r.ref : typeof r.slug === 'string' ? r.slug : '';
    const order = typeof r.order === 'number' ? r.order : Number(r.order ?? out.length + 1) || out.length + 1;
    out.push({ type, ref, order });
  }
  return out.sort((a, b) => a.order - b.order).map((it, i) => ({ ...it, order: i + 1 }));
}

/** Sunucu değeri → form durumu (kök şekli korunur). */
export function toFormState(fields: ContentFieldNormalized[], value: unknown): FormState {
  if (Array.isArray(value)) {
    const listField = fields.find((f) => f.type === 'list' || f.type === 'featured') ?? fields[0];
    const values: FormValues = {};
    for (const f of fields) values[f.name] = f === listField ? valueToForm(f, value) : defaultFor(f);
    return { values, rootShape: 'array', rootListField: listField?.name ?? null };
  }
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const values: FormValues = {};
  for (const f of fields) values[f.name] = f.name in obj ? valueToForm(f, obj[f.name]) : defaultFor(f);
  return { values, rootShape: 'object', rootListField: null };
}

function formToValue(field: ContentFieldNormalized, value: unknown): unknown {
  switch (field.type) {
    case 'boolean':
      return !!value;
    case 'number': {
      const n = parseDecimalInput(String(value ?? ''));
      return n;
    }
    case 'list':
      return (Array.isArray(value) ? value : []).map((item) => {
        const obj = (item ?? {}) as FormValues;
        const out: Record<string, unknown> = {};
        for (const sub of field.itemFields ?? []) out[sub.name] = formToValue(sub, obj[sub.name]);
        return out;
      });
    case 'featured':
      return normalizeFeatured(value).map((it, i) => ({ type: it.type, ref: it.ref, order: i + 1 }));
    case 'json': {
      const s = String(value ?? '').trim();
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    }
    case 'richtext':
      return String(value ?? '');
    default:
      return String(value ?? '').trim();
  }
}

/** Form durumu → PUT gövdesindeki `value` (yalnız şemadaki alanlar; kök şekli korunur). */
export function fromFormState(fields: ContentFieldNormalized[], state: FormState): unknown {
  if (state.rootShape === 'array') {
    const f = fields.find((x) => x.name === state.rootListField) ?? fields.find((x) => x.type === 'list' || x.type === 'featured');
    return f ? formToValue(f, state.values[f.name]) : [];
  }
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.name] = formToValue(f, state.values[f.name]);
  return out;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && !v.trim());
}

/** Alan doğrulaması; anahtarlar noktalı yol (`items.0.title`). */
export function validateValues(fields: ContentFieldNormalized[], values: FormValues, prefix = ''): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    const v = values[f.name];
    switch (f.type) {
      case 'number': {
        if (isBlank(v)) {
          if (f.required) errors[path] = 'Zorunlu sayı';
        } else {
          const n = parseDecimalInput(String(v));
          if (n === null) errors[path] = 'Geçerli bir sayı girin';
          else if (f.min !== undefined && n < f.min) errors[path] = `En az ${f.min}`;
          else if (f.max !== undefined && n > f.max) errors[path] = `En çok ${f.max}`;
        }
        break;
      }
      case 'boolean':
        break;
      case 'list': {
        const items = Array.isArray(v) ? v : [];
        if (f.required && items.length === 0) errors[path] = 'En az bir öğe ekleyin';
        else if (f.min !== undefined && items.length > 0 && items.length < f.min) errors[path] = `En az ${f.min} öğe`;
        else if (f.max !== undefined && items.length > f.max) errors[path] = `En çok ${f.max} öğe`;
        items.forEach((item, i) => {
          Object.assign(errors, validateValues(f.itemFields ?? [], (item ?? {}) as FormValues, `${path}.${i}`));
        });
        break;
      }
      case 'featured': {
        const items = normalizeFeatured(v);
        if (f.required && items.length === 0) errors[path] = 'En az bir öğe ekleyin';
        items.forEach((it, i) => {
          if (!it.ref) errors[`${path}.${i}.ref`] = 'Ürün ya da kutu seçin';
        });
        const seen = new Set<string>();
        items.forEach((it, i) => {
          const k = `${it.type}:${it.ref}`;
          if (it.ref && seen.has(k)) errors[`${path}.${i}.ref`] = 'Aynı öğe iki kez seçilmiş';
          seen.add(k);
        });
        break;
      }
      case 'json': {
        const s = String(v ?? '').trim();
        if (s) {
          try {
            JSON.parse(s);
          } catch {
            errors[path] = 'Geçerli JSON değil';
          }
        } else if (f.required) errors[path] = 'Zorunlu';
        break;
      }
      case 'url': {
        const s = String(v ?? '').trim();
        if (!s && f.required) errors[path] = 'Zorunlu';
        else if (s && /\s/.test(s)) errors[path] = 'Bağlantıda boşluk olamaz';
        break;
      }
      case 'select': {
        const s = String(v ?? '');
        if (!s && f.required) errors[path] = 'Seçim zorunlu';
        else if (s && f.options && !f.options.some((o) => o.value === s)) errors[path] = 'Geçersiz seçenek';
        break;
      }
      default: {
        const s = String(v ?? '');
        if (f.required && !s.trim()) errors[path] = 'Zorunlu alan';
        else if (f.maxLength && s.length > f.maxLength) errors[path] = `En fazla ${f.maxLength} karakter`;
      }
    }
  }
  return errors;
}

/** Liste öğesi için boş form değeri. */
export function emptyListItem(field: ContentFieldNormalized): FormValues {
  const out: FormValues = {};
  for (const sub of field.itemFields ?? []) out[sub.name] = defaultFor(sub);
  return out;
}

/** Medya URL'si (`/uploads/x.webp`, `/assets/images/y.jpg`) → site-göreli yol (`uploads/x.webp`; website görselleri gibi). */
export function toSiteMediaPath(url: string): string {
  return url.replace(/^\/+/, '');
}

/** Liste öğesini kısa etiketle göstermek için ilk dolu metin alanı. */
export function listItemSummary(field: ContentFieldNormalized, item: FormValues, index: number): string {
  for (const sub of field.itemFields ?? []) {
    if (sub.type === 'text' || sub.type === 'textarea' || sub.type === 'richtext') {
      const s = String(item[sub.name] ?? '').replace(/<[^>]+>/g, '').trim();
      if (s) return s.length > 60 ? `${s.slice(0, 57)}…` : s;
    }
  }
  return `Öğe ${index + 1}`;
}
