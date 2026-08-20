import { BadRequestException } from '@nestjs/common';
import type { ContentField, ContentFieldType, ContentSchema, ContentSelectOption } from '@bagdam/shared';
import { HTML_CONTENT_FIELD_TYPES } from './site-content.registry';

/**
 * SiteContent şema yardımcıları (saf fonksiyonlar — testlerde doğrudan kullanılır):
 * - normalizeContentSchema: DB'deki `schema` JSON'unu ContentSchema'ya çevirir. F3 seed'inin eski biçimini de kabul eder
 *   (`key`→`name`, `item`→`itemFields`, `html`→`richtext`, `featured`→`list`); bilinmeyen tip `text` sayılır.
 * - validateContentValue: `PUT /admin/site-content/:key` gövdesini şemaya göre doğrular — bilinmeyen alan 400,
 *   zorunlu eksik 400, tip uyuşmazlığı 400 (tüm hatalar tek yanıtta, `message: string[]`).
 * - escapeContentValue / toSiteContentTree: WebController için — richtext dışındaki metinler escapeHtml (& < > " —
 *   `'` bilerek kaçışlanmaz, web/featured.ts ile aynı parite kuralı), noktalı anahtarlar ağaca açılır
 *   (`home.hero` → site.home.hero) ki şablon `{{{site.home.hero.title}}}` yazabilsin.
 */

const FIELD_TYPES: ReadonlySet<string> = new Set<ContentFieldType>([
  'text',
  'textarea',
  'richtext',
  'image',
  'url',
  'number',
  'boolean',
  'select',
  'list',
]);

/** F3 seed'inin (SiteContentFieldType) eski tip adları. */
const LEGACY_TYPE_MAP: Readonly<Record<string, ContentFieldType>> = { html: 'richtext', featured: 'list' };

/** Eski `featured` tipi → `list` öğe alanları (home.featured registry'si ile aynı). */
const FEATURED_ITEM_FIELDS: readonly ContentField[] = [
  {
    name: 'type',
    label: 'Tür',
    type: 'select',
    required: true,
    options: [
      { value: 'product', label: 'Ürün' },
      { value: 'tier', label: 'Kutu boyu' },
    ],
  },
  { name: 'ref', label: 'Slug', type: 'text', required: true },
  { name: 'order', label: 'Sıra', type: 'number', required: true },
];

/** Değer sınırları — admin girişi; DoS/yanlış yapıştırma koruması. */
export const CONTENT_LIMITS = {
  text: 1000,
  url: 1000,
  image: 1000,
  textarea: 10_000,
  richtext: 50_000,
  listItems: 200,
  depth: 4,
} as const;

/** Tehlikeli bağlantı şemaları (url/image alanları) — admin girişi olsa da sayfaya ham basıldığından reddedilir. */
const UNSAFE_URL = /^\s*(javascript|data|vbscript):/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isField(f: ContentField | null): f is ContentField {
  return f !== null;
}

function normalizeOptions(raw: unknown): ContentSelectOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ContentSelectOption[] = [];
  for (const o of raw) {
    if (typeof o === 'string') out.push({ value: o, label: o });
    else if (isPlainObject(o) && typeof o.value === 'string') out.push({ value: o.value, label: typeof o.label === 'string' ? o.label : o.value });
  }
  return out;
}

function normalizeField(raw: unknown, depth: number): ContentField | null {
  if (!isPlainObject(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name : typeof raw.key === 'string' ? raw.key : null;
  if (!name) return null;
  const rawType = typeof raw.type === 'string' ? raw.type : 'text';
  const type: ContentFieldType = FIELD_TYPES.has(rawType) ? (rawType as ContentFieldType) : (LEGACY_TYPE_MAP[rawType] ?? 'text');
  const field: ContentField = { name, label: typeof raw.label === 'string' ? raw.label : name, type };
  if (raw.required === true) field.required = true;
  if (typeof raw.help === 'string') field.help = raw.help;
  if (typeof raw.min === 'number') field.min = raw.min;
  if (typeof raw.max === 'number') field.max = raw.max;
  if (type === 'select') {
    const options = normalizeOptions(raw.options);
    if (options) field.options = options;
  }
  if (type === 'list') {
    const rawItems = Array.isArray(raw.itemFields)
      ? raw.itemFields
      : Array.isArray(raw.item)
        ? raw.item
        : rawType === 'featured'
          ? [...FEATURED_ITEM_FIELDS]
          : undefined;
    if (rawItems && depth < CONTENT_LIMITS.depth) {
      field.itemFields = rawItems.map((x) => normalizeField(x, depth + 1)).filter(isField);
    }
  }
  return field;
}

/** DB `schema` JSON'u → ContentSchema (bozuk/boş → `{fields:[]}`). */
export function normalizeContentSchema(raw: unknown): ContentSchema {
  if (!isPlainObject(raw) || !Array.isArray(raw.fields)) return { fields: [] };
  return { fields: raw.fields.map((f) => normalizeField(f, 0)).filter(isField) };
}

// ── Doğrulama ───────────────────────────────────────────────────────────────────

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function checkString(v: unknown, max: number, path: string, errors: string[]): v is string {
  if (typeof v !== 'string') {
    errors.push(`${path}: metin olmalı`);
    return false;
  }
  if (v.length > max) {
    errors.push(`${path}: en çok ${max} karakter`);
    return false;
  }
  return true;
}

function validateFields(fields: ContentField[], value: unknown, path: string, errors: string[], depth: number): Record<string, unknown> {
  if (!isPlainObject(value)) {
    errors.push(`${path || 'value'}: nesne olmalı`);
    return {};
  }
  const known = new Map(fields.map((f) => [f.name, f] as const));
  for (const key of Object.keys(value)) {
    if (!known.has(key)) errors.push(`${joinPath(path, key)}: bilinmeyen alan`);
  }
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const p = joinPath(path, f.name);
    const v = value[f.name];
    const emptyList = f.type === 'list' && Array.isArray(v) && v.length === 0;
    if (isEmpty(v) || emptyList) {
      if (f.required) errors.push(`${p}: zorunlu`);
      if (v !== undefined) out[f.name] = v;
      continue;
    }
    switch (f.type) {
      case 'text':
        if (checkString(v, CONTENT_LIMITS.text, p, errors)) out[f.name] = v;
        break;
      case 'textarea':
        if (checkString(v, CONTENT_LIMITS.textarea, p, errors)) out[f.name] = v;
        break;
      case 'richtext':
        if (checkString(v, CONTENT_LIMITS.richtext, p, errors)) out[f.name] = v;
        break;
      case 'url':
      case 'image':
        if (checkString(v, CONTENT_LIMITS.url, p, errors)) {
          if (UNSAFE_URL.test(v)) errors.push(`${p}: izin verilmeyen bağlantı şeması`);
          else out[f.name] = v;
        }
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${p}: sayı olmalı`);
        else if (f.min !== undefined && v < f.min) errors.push(`${p}: en az ${f.min}`);
        else if (f.max !== undefined && v > f.max) errors.push(`${p}: en çok ${f.max}`);
        else out[f.name] = v;
        break;
      case 'boolean':
        if (typeof v !== 'boolean') errors.push(`${p}: true/false olmalı`);
        else out[f.name] = v;
        break;
      case 'select':
        if (typeof v !== 'string') errors.push(`${p}: seçenek metni olmalı`);
        else if (f.options && f.options.length > 0 && !f.options.some((o) => o.value === v)) {
          errors.push(`${p}: geçersiz seçenek "${v}" (${f.options.map((o) => o.value).join(' | ')})`);
        } else out[f.name] = v;
        break;
      case 'list': {
        if (!Array.isArray(v)) {
          errors.push(`${p}: liste olmalı`);
          break;
        }
        const max = Math.min(f.max ?? CONTENT_LIMITS.listItems, CONTENT_LIMITS.listItems);
        if (v.length > max) errors.push(`${p}: en çok ${max} öğe`);
        if (f.min !== undefined && v.length < f.min) errors.push(`${p}: en az ${f.min} öğe`);
        if (f.itemFields && f.itemFields.length > 0) {
          if (depth >= CONTENT_LIMITS.depth) {
            errors.push(`${p}: liste derinliği sınırı`);
            break;
          }
          const itemFields = f.itemFields;
          out[f.name] = v.map((item, i) => validateFields(itemFields, item, `${p}[${i}]`, errors, depth + 1));
        } else {
          const items: string[] = [];
          v.forEach((item, i) => {
            if (checkString(item, CONTENT_LIMITS.text, `${p}[${i}]`, errors)) items.push(item);
          });
          out[f.name] = items;
        }
        break;
      }
      default:
        errors.push(`${p}: desteklenmeyen alan tipi`);
    }
  }
  return out;
}

/**
 * Değeri şemaya göre doğrular; hatalarda 400 (`message: string[]`, `error: CONTENT_VALIDATION`).
 * Döner: yalnız şemadaki alanları içeren, aynı değerlerle yeni nesne (bilinmeyen alan zaten hata).
 */
export function validateContentValue(schema: ContentSchema, value: unknown): Record<string, unknown> {
  const errors: string[] = [];
  const out = validateFields(schema.fields, value, '', errors, 0);
  if (errors.length > 0) {
    throw new BadRequestException({ message: errors, error: 'CONTENT_VALIDATION' });
  }
  return out;
}

// ── Görünüm (WebController) yardımcıları ─────────────────────────────────────────

/** Metin düğümü ve çift tırnaklı öznitelik için asgari HTML kaçışı (`'` kaçışlanmaz — piksel parite, web/featured.ts ile aynı). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeDeep(v: unknown): unknown {
  if (typeof v === 'string') return escapeHtml(v);
  if (Array.isArray(v)) return v.map(escapeDeep);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = escapeDeep(x);
    return out;
  }
  return v;
}

function escapeByFields(fields: ContentField[], value: unknown): unknown {
  if (!isPlainObject(value)) return escapeDeep(value);
  const known = new Map(fields.map((f) => [f.name, f] as const));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const f = known.get(k);
    if (!f) {
      out[k] = escapeDeep(v);
    } else if (HTML_CONTENT_FIELD_TYPES.has(f.type)) {
      out[k] = v;
    } else if (f.type === 'list' && Array.isArray(v)) {
      const itemFields = f.itemFields;
      out[k] = itemFields && itemFields.length > 0 ? v.map((item) => escapeByFields(itemFields, item)) : v.map(escapeDeep);
    } else {
      out[k] = escapeDeep(v);
    }
  }
  return out;
}

/**
 * Şablona gidecek değer: richtext alanları ham, diğer metinler escapeHtml (iç içe liste/nesne dahil).
 * `schema` null ise her metin kaçışlanır (bilinmeyen blok HTML basamaz).
 */
export function escapeContentValue(schema: ContentSchema | null, value: unknown): unknown {
  return schema ? escapeByFields(schema.fields, value) : escapeDeep(value);
}

/** `{ 'home.hero': {...}, promoBar: {...} }` → `{ home: { hero: {...} }, promoBar: {...} }`. */
export function toSiteContentTree(flat: Record<string, unknown>): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.').filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const next = node[part];
      if (!isPlainObject(next)) {
        const created: Record<string, unknown> = {};
        node[part] = created;
        node = created;
      } else {
        node = next;
      }
    }
    node[parts[parts.length - 1]!] = value;
  }
  return tree;
}
