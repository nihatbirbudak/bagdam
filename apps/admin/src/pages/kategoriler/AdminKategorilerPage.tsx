import { Layers, Pencil, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Checkbox, Field, FormErrorBanner, TextArea, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { categoriesApi } from '../../features/catalog/api';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { ReorderButtons } from '../../features/components/ReorderButtons';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminCategory, AdminCategoryBody } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, moveItem } from '../../lib/utils';

interface Draft {
  label: string;
  panelNote: string;
  legacyTab: string;
  sortOrder: string;
  isActive: boolean;
}

function toDraft(c: AdminCategory): Draft {
  return { label: c.label, panelNote: c.panelNote ?? '', legacyTab: c.legacyTab ?? '', sortOrder: String(c.sortOrder), isActive: c.isActive };
}

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.label.trim()) e.label = 'Etiket zorunlu';
  else if (d.label.trim().length > 60) e.label = 'En fazla 60 karakter';
  if (d.legacyTab.trim().length > 20) e.legacyTab = 'En fazla 20 karakter';
  if (!/^\d+$/.test(d.sortOrder.trim())) e.sortOrder = 'Tam sayı (0 ya da büyük)';
  return e;
}

/** Ekran 4 — Kategoriler: etiket, panel notu, sıra, aktif (yeni kategori MVP'de yok; ikon statik). */
export function AdminKategorilerPage() {
  const [items, setItems] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await categoriesApi.list();
      setItems([...list].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) {
      setError(errorMessage(e, 'Kategoriler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(c: AdminCategory) {
    setEditing(c);
    setDraft(toDraft(c));
    setErrors({});
    setFormError(null);
  }

  function closeEdit() {
    setEditing(null);
    setDraft(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editing || !draft) return;
    const v = validate(draft);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setFormError(null);
    const body: AdminCategoryBody = {
      label: draft.label.trim(),
      panelNote: draft.panelNote.trim() || null,
      legacyTab: draft.legacyTab.trim() || null,
      sortOrder: Number(draft.sortOrder),
      isActive: draft.isActive,
    };
    try {
      const updated = await categoriesApi.update(editing.id, body);
      setItems((prev) => prev.map((c) => (c.id === editing.id ? { ...c, ...body, ...(updated ?? {}) } : c)).sort((a, b) => a.sortOrder - b.sortOrder));
      toast.success('Kategori güncellendi');
      closeEdit();
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function persistOrder(next: AdminCategory[]) {
    const prev = items;
    setItems(next.map((c, i) => ({ ...c, sortOrder: i })));
    setReordering(true);
    try {
      await categoriesApi.reorder(next.map((c) => c.id));
      toast.success('Sıra kaydedildi');
    } catch (e) {
      setItems(prev);
      toast.error(errorMessage(e, 'Sıra kaydedilemedi'));
    } finally {
      setReordering(false);
    }
  }

  function onMove(from: number, to: number) {
    void persistOrder(moveItem(items, from, to));
  }

  function onDropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = items.findIndex((c) => c.id === dragId);
    const to = items.findIndex((c) => c.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    void persistOrder(moveItem(items, from, to));
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Kategoriler"
        description="urunler.html sekmeleri: etiket, panel notu ve sıra. Kategori ikonu statik (assets/icons/<slug>.png); yeni kategori eklemek MVP'de kapalı."
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Layers} message="Kategori bulunamadı." />
      ) : (
        <AdminScrollTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={cn(th, 'w-24')}>Sıra</th>
                <th className={th}>Etiket</th>
                <th className={th}>Slug</th>
                <th className={th}>Legacy tab</th>
                <th className={th}>Panel notu</th>
                <th className={cn(th, 'text-right')}>Ürün</th>
                <th className={th}>Aktif</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, idx) => (
                <tr
                  key={c.id}
                  draggable={!reordering}
                  onDragStart={() => setDragId(c.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropOn(c.id)}
                  onDragEnd={() => setDragId(null)}
                  className={cn(dragId === c.id && 'opacity-50', !c.isActive && 'bg-brand-50/60')}
                >
                  <td className={td}>
                    <ReorderButtons index={idx} count={items.length} onMove={onMove} disabled={reordering} />
                  </td>
                  <td className={cn(td, 'font-medium text-brand-900')}>{c.label}</td>
                  <td className={cn(td, 'font-mono text-xs')}>{c.slug}</td>
                  <td className={cn(td, 'font-mono text-xs')}>{c.legacyTab ?? <span className="text-brand-400">—</span>}</td>
                  <td className={cn(td, 'max-w-[28rem]')}>
                    <span className="line-clamp-2 text-xs text-brand-600">{c.panelNote ?? <span className="text-brand-400">—</span>}</span>
                  </td>
                  <td className={cn(td, 'text-right')}>{c.productCount ?? '—'}</td>
                  <td className={td}><BoolBadge value={c.isActive} yes="Aktif" no="Pasif" /></td>
                  <td className={td}>
                    <button type="button" onClick={() => openEdit(c)} className={btn.icon} aria-label={`${c.label} düzenle`} title="Düzenle">
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminScrollTable>
      )}

      <Modal
        open={!!editing && !!draft}
        onClose={closeEdit}
        title={editing ? `Kategori düzenle — ${editing.label}` : ''}
        footer={
          <>
            <button type="button" onClick={closeEdit} className={btn.secondary}>İptal</button>
            <button type="submit" form="category-form" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        {draft && (
          <form id="category-form" onSubmit={handleSave} className="space-y-4" noValidate>
            <FormErrorBanner message={formError} />
            <Field label="Etiket" required error={errors.label}>
              {({ id, invalid }) => (
                <TextInput id={id} invalid={invalid} value={draft.label} maxLength={60} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              )}
            </Field>
            <Field label="Panel notu" hint="urunler.html'de sekme altındaki kısa açıklama (tek sahip burası)." error={errors.panelNote}>
              {({ id, invalid }) => (
                <TextArea id={id} invalid={invalid} rows={3} value={draft.panelNote} onChange={(e) => setDraft({ ...draft, panelNote: e.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Legacy tab" hint="Bootstrap product.tab: pantry · dairy · firin (boxes → boş)." error={errors.legacyTab}>
                {({ id, invalid }) => (
                  <TextInput id={id} invalid={invalid} value={draft.legacyTab} maxLength={20} onChange={(e) => setDraft({ ...draft, legacyTab: e.target.value })} />
                )}
              </Field>
              <Field label="Sıra" error={errors.sortOrder}>
                {({ id, invalid }) => (
                  <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />
                )}
              </Field>
            </div>
            <Checkbox label="Aktif" description="Pasif kategori sitede sekme olarak görünmez." checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
          </form>
        )}
      </Modal>
    </div>
  );
}
