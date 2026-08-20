import { SETTINGS_SECRET_MASK, type AdminSettingField, type AdminSettingGroup, type SettingGroupMeta } from '@bagdam/shared';
import type { SettingRecord } from './settings.repository';

/** DB satırı → alan adı (`commerce.vatRate` → `vatRate`). Grup önekiyle başlamıyorsa tüm anahtar. */
export function fieldNameOf(row: SettingRecord): string {
  const prefix = `${row.group}.`;
  return row.key.startsWith(prefix) ? row.key.slice(prefix.length) : row.key;
}

/** Secret satırda "dolu değer" var mı (şifreli ya da eski düz metin; boş metin = yok). */
export function secretHasValue(row: SettingRecord | undefined): boolean {
  if (!row) return false;
  return typeof row.value === 'string' && row.value.length > 0;
}

/**
 * Registry şeması + DB satırları → admin grup görünümü. Secret alanlar ASLA çözülmez: değer varsa maske,
 * yoksa ''. Satır yoksa `default` ve `updatedAt: null` (admin "varsayılan gösteriliyor" bilir).
 */
export function toAdminSettingGroup(meta: SettingGroupMeta, rows: readonly SettingRecord[]): AdminSettingGroup {
  const byField = new Map<string, SettingRecord>();
  for (const row of rows) byField.set(fieldNameOf(row), row);

  const fields: AdminSettingField[] = meta.fields.map((f) => {
    const row = byField.get(f.key);
    const base: AdminSettingField = {
      ...f,
      isSecret: f.type === 'secret',
      value: f.type === 'secret' ? '' : (row ? row.value : (f.default ?? '')),
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
    if (f.type === 'secret') {
      const hasValue = secretHasValue(row);
      base.hasValue = hasValue;
      base.value = hasValue ? SETTINGS_SECRET_MASK : '';
    }
    return base;
  });

  return { group: meta.group, label: meta.label, ...(meta.description ? { description: meta.description } : {}), fields };
}
