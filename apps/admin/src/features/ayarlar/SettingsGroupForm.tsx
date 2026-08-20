import { RotateCcw, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Checkbox, Field, FormErrorBanner, Select, TextArea, TextInput } from '../../components/ui/FormField';
import { SecretField } from '../../components/ui/SecretField';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminSettingField, AdminSettingGroup } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { settingsApi } from './api';
import {
  isSettingsDraftDirty,
  selectOptionsFor,
  toSettingsBody,
  toSettingsDraft,
  validateSettingsDraft,
  type SettingsDraft,
} from './settingsForm';

type Props = {
  group: AdminSettingGroup;
  /** Kaydet sonrası sunucudan gelen (ya da yerel birleştirilmiş) grup. */
  onSaved?: (group: AdminSettingGroup) => void;
  /** Alt çubuğa ek aksiyon (ör. test e-postası). */
  footerExtra?: ReactNode;
  /** Üst başlık gizlensin (sekme başlığı zaten var). */
  hideHeader?: boolean;
};

const WIDE = new Set(['json', 'textarea']);

/** Kaydet sonrası sunucu yanıtı alınamazsa yerel kopyayı gövdeyle birleştirir. */
function mergeGroupLocally(group: AdminSettingGroup, body: Record<string, unknown>): AdminSettingGroup {
  return {
    ...group,
    fields: group.fields.map((f) => {
      if (!(f.key in body)) return f;
      if (f.type === 'secret') return { ...f, hasValue: true, value: '••••••' };
      return { ...f, value: body[f.key] };
    }),
  };
}

/**
 * Registry'den üretilen generic ayar grubu formu (UA kalıbı): alan türüne göre giriş, secret alanlar maskeli + “Değiştir”,
 * ADR-0018 select'leri shared etiketleriyle. Kaydet → `PUT /admin/settings/:group` → grup yeniden okunur.
 */
export function SettingsGroupForm({ group, onSaved, footerExtra, hideHeader }: Props) {
  const [initial, setInitial] = useState<SettingsDraft>(() => toSettingsDraft(group.fields));
  const [draft, setDraft] = useState<SettingsDraft>(() => toSettingsDraft(group.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Grup (sunucudan) değişince taslağı sıfırla
  useEffect(() => {
    const d = toSettingsDraft(group.fields);
    setInitial(d);
    setDraft(d);
    setErrors({});
    setFormError(null);
  }, [group]);

  const dirty = isSettingsDraftDirty(group.fields, initial, draft);

  function set(key: string, v: string | boolean | undefined) {
    setDraft((d) => ({ ...d, [key]: v }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validateSettingsDraft(group.group, group.fields, draft);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = toSettingsBody(group.fields, draft);
    try {
      await settingsApi.update(group.group, body);
      let fresh: AdminSettingGroup | null = null;
      try {
        fresh = await settingsApi.get(group.group);
      } catch {
        fresh = null;
      }
      const next = fresh && fresh.fields.length ? fresh : mergeGroupLocally(group, body);
      onSaved?.(next);
      toast.success(`${group.label} ayarları kaydedildi`);
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDraft(initial);
    setErrors({});
    setFormError(null);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-lg border border-brand-200 bg-white">
      {!hideHeader && (
        <header className="border-b border-brand-200 bg-brand-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-brand-800">{group.label}</h2>
          {group.description && <p className="text-xs text-brand-500">{group.description}</p>}
        </header>
      )}
      <div className="space-y-4 p-4">
        <FormErrorBanner message={formError} />
        {group.fields.length === 0 ? (
          <p className="text-sm text-brand-500">Bu grupta alan tanımlı değil.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((f) => (
              <div key={f.key} className={cn('min-w-0', WIDE.has(f.type) && 'sm:col-span-2')}>
                <SettingInput group={group.group} field={f} value={draft[f.key]} error={errors[f.key]} disabled={saving} onChange={(v) => set(f.key, v)} />
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-brand-200 bg-brand-50/60 px-4 py-3">
        {footerExtra && <div className="mr-auto">{footerExtra}</div>}
        <button type="button" onClick={reset} disabled={!dirty || saving} className={btn.secondary}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Sıfırla
        </button>
        <button type="submit" disabled={!dirty || saving} className={btn.primary}>
          <Save className="h-4 w-4" aria-hidden />
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </footer>
    </form>
  );
}

function SettingInput({
  group,
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  group: string;
  field: AdminSettingField;
  value: string | boolean | undefined;
  error?: string;
  disabled?: boolean;
  onChange: (v: string | boolean | undefined) => void;
}) {
  const str = typeof value === 'string' ? value : '';
  const keyHint = <span className="font-mono text-[10px] text-brand-400">{group}.{field.key}</span>;
  const hint = field.help ? (
    <>
      {field.help} {keyHint}
    </>
  ) : (
    keyHint
  );

  switch (field.type) {
    case 'boolean':
      return (
        <Checkbox
          label={field.label}
          description={
            <>
              {field.help ? `${field.help} ` : ''}
              {keyHint}
            </>
          }
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'secret':
      return (
        <Field label={field.label} hint={hint} error={error}>
          {({ id, invalid }) => (
            <SecretField id={id} invalid={invalid} hasValue={!!field.hasValue} value={typeof value === 'string' ? value : undefined} disabled={disabled} onChange={(v) => onChange(v)} />
          )}
        </Field>
      );
    case 'select': {
      const opts = selectOptionsFor(group, field);
      return (
        <Field label={field.label} hint={hint} error={error}>
          {({ id, invalid }) =>
            opts.length ? (
              <Select id={id} invalid={invalid} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
                {!opts.some((o) => o.value === str) && <option value={str}>{str || '— Seçin —'}</option>}
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            ) : (
              <TextInput id={id} invalid={invalid} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
            )
          }
        </Field>
      );
    }
    case 'number':
      return (
        <Field label={field.label} hint={hint} error={error}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case 'json':
      return (
        <Field label={field.label} hint={hint} error={error}>
          {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={5} spellCheck={false} className="font-mono text-xs" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    case 'textarea':
      return (
        <Field label={field.label} hint={hint} error={error}>
          {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={3} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
    default:
      return (
        <Field label={field.label} hint={hint} error={error}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
        </Field>
      );
  }
}
