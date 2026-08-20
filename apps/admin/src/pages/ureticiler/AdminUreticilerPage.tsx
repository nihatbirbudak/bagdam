import { Pencil, Plus, Save, Tractor, UserX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Checkbox, Field, FormErrorBanner, TextArea, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { producersApi } from '../../features/catalog/api';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminProducer, AdminProducerBody } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, slugify } from '../../lib/utils';

interface Draft {
  name: string;
  slug: string;
  slugTouched: boolean;
  village: string;
  district: string;
  story: string;
  sortOrder: string;
  isActive: boolean;
}

function emptyDraft(): Draft {
  return { name: '', slug: '', slugTouched: false, village: '', district: 'Urla', story: '', sortOrder: '0', isActive: true };
}

function toDraft(p: AdminProducer): Draft {
  return {
    name: p.name,
    slug: p.slug,
    slugTouched: true,
    village: p.village ?? '',
    district: p.district ?? 'Urla',
    story: p.story ?? '',
    sortOrder: String(p.sortOrder ?? 0),
    isActive: p.isActive,
  };
}

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.name.trim()) e.name = 'Ad zorunlu';
  else if (d.name.trim().length > 120) e.name = 'En fazla 120 karakter';
  if (!d.slug.trim()) e.slug = 'Slug zorunlu';
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug.trim())) e.slug = 'Yalnız küçük harf, rakam ve tire';
  if (d.village.trim().length > 80) e.village = 'En fazla 80 karakter';
  if (!d.district.trim()) e.district = 'İlçe zorunlu';
  else if (d.district.trim().length > 80) e.district = 'En fazla 80 karakter';
  if (!/^\d+$/.test(d.sortOrder.trim())) e.sortOrder = 'Tam sayı (0 ya da büyük)';
  return e;
}

type ActiveFilter = 'all' | 'active' | 'passive';

/** Ekran 5 — Üreticiler: ad, köy, ilçe, aktif, sıra (CRUD; silme = pasife alma). */
export function AdminUreticilerPage() {
  const confirm = useConfirm();
  const [items, setItems] = useState<AdminProducer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');

  const [panel, setPanel] = useState<{ mode: 'new' } | { mode: 'edit'; row: AdminProducer } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await producersApi.list();
      setItems([...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr')));
    } catch (e) {
      setError(errorMessage(e, 'Üreticiler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr');
    return items.filter((p) => {
      if (activeFilter === 'active' && !p.isActive) return false;
      if (activeFilter === 'passive' && p.isActive) return false;
      if (!needle) return true;
      return [p.name, p.village ?? '', p.district, p.slug].some((s) => s.toLocaleLowerCase('tr').includes(needle));
    });
  }, [items, q, activeFilter]);

  function openNew() {
    setPanel({ mode: 'new' });
    setDraft(emptyDraft());
    setErrors({});
    setFormError(null);
  }

  function openEdit(row: AdminProducer) {
    setPanel({ mode: 'edit', row });
    setDraft(toDraft(row));
    setErrors({});
    setFormError(null);
  }

  function closePanel() {
    setPanel(null);
  }

  function patch(p: Partial<Draft>) {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (p.name !== undefined && !d.slugTouched) next.slug = slugify(p.name).slice(0, 120);
      return next;
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!panel) return;
    const v = validate(draft);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setFormError(null);
    const body: AdminProducerBody = {
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      village: draft.village.trim() || null,
      district: draft.district.trim(),
      story: draft.story.trim() || null,
      sortOrder: Number(draft.sortOrder),
      isActive: draft.isActive,
    };
    try {
      if (panel.mode === 'new') {
        const created = await producersApi.create(body);
        toast.success('Üretici eklendi');
        if (created?.id) setItems((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder));
        else await load();
      } else {
        const updated = await producersApi.update(panel.row.id, body);
        toast.success('Üretici güncellendi');
        setItems((prev) => prev.map((p) => (p.id === panel.row.id ? { ...p, ...body, ...(updated ?? {}) } : p)).sort((a, b) => a.sortOrder - b.sortOrder));
      }
      closePanel();
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row: AdminProducer) {
    const ok = await confirm({
      title: 'Üreticiyi pasife al',
      description: `"${row.name}" pasife alınacak (silinmez; ürün ve parti bağları korunur). Devam edilsin mi?`,
      confirmLabel: 'Pasife al',
      danger: true,
    });
    if (!ok) return;
    try {
      await producersApi.remove(row.id);
      setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, isActive: false } : p)));
      toast.success('Üretici pasife alındı');
    } catch (e) {
      toast.error(errorMessage(e, 'İşlem başarısız'));
    }
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Üreticiler"
        description="Ürün meta satırı: “Üretici · Köy · İlçe”. Hikâye ve fotoğraf alanı şemada var, sitede kullanılmaz (üretici sayfası P2)."
        actions={
          <button type="button" onClick={openNew} className={btn.primary}>
            <Plus className="h-4 w-4" aria-hidden />
            Yeni üretici
          </button>
        }
      />

      <AdminToolbar
        searchPlaceholder="Ad, köy, ilçe ara…"
        searchValue={q}
        onSearchChange={setQ}
        filters={
          <FilterPills<ActiveFilter>
            label="Durum"
            value={activeFilter}
            onChange={setActiveFilter}
            options={[
              { key: 'all', label: 'Tümü' },
              { key: 'active', label: 'Aktif' },
              { key: 'passive', label: 'Pasif' },
            ]}
          />
        }
        className="mb-3"
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <AdminEmptyState icon={Tractor} message={items.length ? 'Filtreye uyan üretici yok.' : 'Henüz üretici yok.'} cta={items.length ? undefined : { label: 'Yeni üretici', onClick: openNew }} />
      ) : (
        <AdminScrollTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Ad</th>
                <th className={th}>Köy</th>
                <th className={th}>İlçe</th>
                <th className={th}>Slug</th>
                <th className={cn(th, 'text-right')}>Ürün</th>
                <th className={cn(th, 'text-right')}>Sıra</th>
                <th className={th}>Durum</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className={cn(!p.isActive && 'bg-brand-50/60 text-brand-500')}>
                  <td className={cn(td, 'font-medium text-brand-900')}>{p.name}</td>
                  <td className={td}>{p.village ?? <span className="text-brand-400">—</span>}</td>
                  <td className={td}>{p.district}</td>
                  <td className={cn(td, 'font-mono text-xs')}>{p.slug}</td>
                  <td className={cn(td, 'text-right')}>{p.productCount ?? '—'}</td>
                  <td className={cn(td, 'text-right')}>{p.sortOrder}</td>
                  <td className={td}><BoolBadge value={p.isActive} yes="Aktif" no="Pasif" /></td>
                  <td className={td}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openEdit(p)} className={btn.icon} aria-label={`${p.name} düzenle`} title="Düzenle">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      {p.isActive && (
                        <button type="button" onClick={() => void handleDeactivate(p)} className={btn.iconDanger} aria-label={`${p.name} pasife al`} title="Pasife al">
                          <UserX className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminScrollTable>
      )}

      <Modal
        open={!!panel}
        onClose={closePanel}
        title={panel?.mode === 'edit' ? `Üretici düzenle — ${panel.row.name}` : 'Yeni üretici'}
        footer={
          <>
            <button type="button" onClick={closePanel} className={btn.secondary}>İptal</button>
            <button type="submit" form="producer-form" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        <form id="producer-form" onSubmit={handleSave} className="space-y-4" noValidate>
          <FormErrorBanner message={formError} />
          <Field label="Ad" required error={errors.name}>
            {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} />}
          </Field>
          <Field label="Slug" required hint="Ad yazılırken türetilir; elle değiştirilebilir." error={errors.slug}>
            {({ id, invalid }) => (
              <TextInput id={id} invalid={invalid} value={draft.slug} maxLength={120} onChange={(e) => patch({ slug: e.target.value, slugTouched: true })} className="font-mono" />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Köy" error={errors.village}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.village} maxLength={80} onChange={(e) => patch({ village: e.target.value })} />}
            </Field>
            <Field label="İlçe" required error={errors.district}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.district} maxLength={80} onChange={(e) => patch({ district: e.target.value })} />}
            </Field>
          </div>
          <Field label="Hikâye" hint="Şemada var; sitede şimdilik gösterilmez (P2 üretici sayfası)." error={errors.story}>
            {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={3} value={draft.story} onChange={(e) => patch({ story: e.target.value })} />}
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Sıra" error={errors.sortOrder}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.sortOrder} onChange={(e) => patch({ sortOrder: e.target.value })} />}
            </Field>
            <Checkbox label="Aktif" checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} className="pb-2" />
          </div>
        </form>
      </Modal>
    </div>
  );
}
