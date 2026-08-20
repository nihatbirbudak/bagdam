import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import {
  emptyListItem,
  listItemSummary,
  type ContentFieldNormalized,
  type FormValues,
} from '../../features/icerik/schemaForm';
import { resolveMediaUrl } from '../../lib/api';
import { btn } from '../../lib/buttonStyles';
import { cn, moveItem } from '../../lib/utils';
import { Checkbox, Field, Select, TextArea, TextInput } from './FormField';
import { RichTextLite } from './RichTextLite';

/** `image` alanı için medya seçici düğmesi — sayfa sağlar (MediaPickerModal'ı açar, seçilen yolu verir). */
export type ImagePickerProps = { value: string; onPick: (path: string) => void; disabled?: boolean };

/** `featured` alanı için özel editör (ürün/tier seçici + sıralama) — sayfa sağlar. */
export type FeaturedEditorProps = {
  value: unknown;
  onChange: (items: unknown) => void;
  errors: Record<string, string>;
  /** Hata anahtarlarının öneki (`items`). */
  errorPrefix: string;
  disabled?: boolean;
};

type Props = {
  fields: ContentFieldNormalized[];
  values: FormValues;
  onChange: (next: FormValues) => void;
  /** Noktalı yol → hata metni (`validateValues` çıktısı). */
  errors?: Record<string, string>;
  disabled?: boolean;
  ImagePicker?: ComponentType<ImagePickerProps>;
  FeaturedEditor?: ComponentType<FeaturedEditorProps>;
  /** İç içe listelerde hata yolu öneki. */
  pathPrefix?: string;
  /** Kısa alanlar iki sütun (liste öğeleri). */
  columns?: 1 | 2;
};

const WIDE_TYPES = new Set(['textarea', 'richtext', 'list', 'featured', 'json']);

/**
 * ContentSchema → form. Her alan türü için uygun giriş; `list` öğeleri tekrarlı (ekle/sil/sırala, iç içe şema);
 * `featured` için sayfanın verdiği editör (yoksa tür+ref listesi). Değerler `features/icerik/schemaForm` form biçimindedir.
 */
export function SchemaForm({ fields, values, onChange, errors = {}, disabled, ImagePicker, FeaturedEditor, pathPrefix = '', columns = 1 }: Props) {
  function set(name: string, v: unknown) {
    onChange({ ...values, [name]: v });
  }
  if (fields.length === 0) {
    return <p className="text-sm text-brand-500">Bu blok için düzenlenebilir alan tanımlı değil.</p>;
  }
  return (
    <div className={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2')}>
      {fields.map((f) => (
        <div key={f.name} className={cn(columns === 2 && WIDE_TYPES.has(f.type) && 'sm:col-span-2', 'min-w-0')}>
          <SchemaField
            field={f}
            value={values[f.name]}
            onChange={(v) => set(f.name, v)}
            errors={errors}
            path={pathPrefix ? `${pathPrefix}.${f.name}` : f.name}
            disabled={disabled}
            ImagePicker={ImagePicker}
            FeaturedEditor={FeaturedEditor}
          />
        </div>
      ))}
    </div>
  );
}

type FieldProps = {
  field: ContentFieldNormalized;
  value: unknown;
  onChange: (v: unknown) => void;
  errors: Record<string, string>;
  path: string;
  disabled?: boolean;
  ImagePicker?: ComponentType<ImagePickerProps>;
  FeaturedEditor?: ComponentType<FeaturedEditorProps>;
};

function SchemaField({ field, value, onChange, errors, path, disabled, ImagePicker, FeaturedEditor }: FieldProps) {
  const error = errors[path];
  const str = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

  switch (field.type) {
    case 'boolean':
      return (
        <Checkbox
          label={field.label}
          description={field.help}
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          data-field={path}
        />
      );
    case 'textarea':
      return (
        <Field label={field.label} hint={field.help} error={error} required={field.required}>
          {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={3} value={str} disabled={disabled} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case 'richtext':
      return (
        <Field label={field.label} hint={field.help ?? 'HTML olarak kaydedilir; sitede olduğu gibi basılır.'} error={error} required={field.required}>
          {({ id, invalid }) => <RichTextLite id={id} invalid={invalid} value={str} disabled={disabled} minHeight="7rem" onChange={onChange} aria-label={field.label} />}
        </Field>
      );
    case 'number':
      return (
        <Field label={field.label} hint={field.help} error={error} required={field.required}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case 'select':
      return (
        <Field label={field.label} hint={field.help} error={error} required={field.required}>
          {({ id, invalid }) => (
            <Select id={id} invalid={invalid} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
              {!field.required && <option value="">— Seçin —</option>}
              {(field.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          )}
        </Field>
      );
    case 'url':
      return (
        <Field label={field.label} hint={field.help ?? 'Tam adres (https://…) ya da site içi yol (urunler.html, politikalar.html#kvkk).'} error={error} required={field.required}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="text" inputMode="url" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case 'image': {
      const url = str ? resolveMediaUrl(str.startsWith('/') || /^https?:/.test(str) ? str : `/${str}`) : '';
      return (
        <Field label={field.label} hint={field.help ?? 'Site-göreli yol (assets/images/… ya da uploads/…).'} error={error} required={field.required}>
          {({ id, invalid }) => (
            <div className="flex items-start gap-2">
              {url ? (
                <img src={url} alt="" className="h-12 w-12 shrink-0 rounded border border-brand-200 bg-brand-50 object-cover" />
              ) : (
                <span className="h-12 w-12 shrink-0 rounded border border-dashed border-brand-300 bg-brand-50" aria-hidden />
              )}
              <div className="flex min-w-0 flex-1 gap-2">
                <TextInput id={id} invalid={invalid} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
                {ImagePicker && <ImagePicker value={str} onPick={(p) => onChange(p)} disabled={disabled} />}
              </div>
            </div>
          )}
        </Field>
      );
    }
    case 'json':
      return (
        <Field label={field.label} hint={field.help ?? 'JSON (şema tanımsız alan).'} error={error} required={field.required}>
          {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={6} value={str} disabled={disabled} spellCheck={false} className="font-mono text-xs" onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case 'featured': {
      if (FeaturedEditor) {
        return (
          <Field label={field.label} hint={field.help} error={error} required={field.required}>
            <FeaturedEditor value={value} onChange={onChange} errors={errors} errorPrefix={path} disabled={disabled} />
          </Field>
        );
      }
      const fallback: ContentFieldNormalized = {
        ...field,
        type: 'list',
        itemFields: [
          { name: 'type', label: 'Tür', type: 'select', required: true, options: [{ value: 'product', label: 'Ürün' }, { value: 'tier', label: 'Kutu (tier)' }] },
          { name: 'ref', label: 'Slug', type: 'text', required: true },
        ],
      };
      return <ListField field={fallback} value={value} onChange={onChange} errors={errors} path={path} disabled={disabled} ImagePicker={ImagePicker} FeaturedEditor={FeaturedEditor} />;
    }
    case 'list':
      return <ListField field={field} value={value} onChange={onChange} errors={errors} path={path} disabled={disabled} ImagePicker={ImagePicker} FeaturedEditor={FeaturedEditor} />;
    default:
      return (
        <Field label={field.label} hint={field.help} error={error} required={field.required}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={str} disabled={disabled} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
  }
}

/** Tekrarlı öğe listesi: ekle / sil / yukarı-aşağı; öğe alanları iç içe SchemaForm. */
function ListField({ field, value, onChange, errors, path, disabled, ImagePicker, FeaturedEditor }: FieldProps) {
  const items: FormValues[] = Array.isArray(value) ? (value as FormValues[]) : [];
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const listError = errors[path];
  const itemFields = field.itemFields ?? [];

  function setItem(i: number, next: FormValues) {
    onChange(items.map((it, idx) => (idx === i ? next : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function move(from: number, to: number) {
    onChange(moveItem(items, from, to));
  }
  function add() {
    onChange([...items, emptyListItem(field)]);
  }
  function toggle(i: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const itemHasError = (i: number) => Object.keys(errors).some((k) => k.startsWith(`${path}.${i}.`));
  const twoCols = itemFields.length > 1;

  return (
    <fieldset className="min-w-0" data-field={path}>
      <legend className="mb-1 flex w-full items-center justify-between gap-2 text-xs font-medium text-brand-600">
        <span>
          {field.label}
          {field.required && <span className="ml-0.5 text-accent-dark" aria-hidden>*</span>}
          <span className="ml-1.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-500">{items.length}</span>
        </span>
      </legend>
      {field.help && <p className="mb-2 text-[11px] leading-snug text-brand-500">{field.help}</p>}
      {listError && <p role="alert" className="mb-2 text-xs text-accent-dark">{listError}</p>}
      <div className="space-y-2">
        {items.map((item, i) => {
          const isCollapsed = collapsed.has(i);
          const hasErr = itemHasError(i);
          return (
            <div key={i} className={cn('rounded-md border bg-white', hasErr ? 'border-accent-dark/60' : 'border-brand-200')}>
              <div className="flex items-center gap-1 border-b border-brand-100 bg-brand-50/60 px-2 py-1">
                <button type="button" onClick={() => toggle(i)} className="inline-flex h-6 w-6 items-center justify-center rounded text-brand-500 hover:bg-brand-100" aria-label={isCollapsed ? 'Öğeyi aç' : 'Öğeyi daralt'} aria-expanded={!isCollapsed}>
                  {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
                </button>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-brand-800">
                  <span className="mr-1.5 font-mono text-[10px] text-brand-400">#{i + 1}</span>
                  {listItemSummary(field, item, i)}
                  {hasErr && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-dark" aria-label="Bu öğede hata var" />}
                </span>
                <button type="button" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} className="inline-flex h-6 w-6 items-center justify-center rounded text-brand-400 hover:bg-brand-100 hover:text-brand-700 disabled:opacity-30" aria-label="Yukarı taşı">
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" disabled={disabled || i === items.length - 1} onClick={() => move(i, i + 1)} className="inline-flex h-6 w-6 items-center justify-center rounded text-brand-400 hover:bg-brand-100 hover:text-brand-700 disabled:opacity-30" aria-label="Aşağı taşı">
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" disabled={disabled} onClick={() => remove(i)} className="inline-flex h-6 w-6 items-center justify-center rounded text-brand-400 hover:bg-accent-light hover:text-accent-dark disabled:opacity-30" aria-label={`Öğe ${i + 1} sil`} title="Sil">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              {!isCollapsed && (
                <div className="p-3">
                  <SchemaForm
                    fields={itemFields}
                    values={item}
                    onChange={(next) => setItem(i, next)}
                    errors={errors}
                    disabled={disabled}
                    ImagePicker={ImagePicker}
                    FeaturedEditor={FeaturedEditor}
                    pathPrefix={`${path}.${i}`}
                    columns={twoCols ? 2 : 1}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={add} disabled={disabled} className={cn(btn.secondary, btn.sm, 'mt-2')}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Öğe ekle
      </button>
    </fieldset>
  );
}
