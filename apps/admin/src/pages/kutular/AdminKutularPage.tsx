import { Boxes, ImagePlus, Pencil, Save, Star, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Checkbox, Field, FormErrorBanner, TextArea, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { tiersApi } from '../../features/catalog/api';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { MediaPickerModal } from '../../features/medya/MediaPickerModal';
import { MediaThumb } from '../../features/medya/MediaThumb';
import { moneyToInput } from '../../features/catalog/productForm';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminMediaFile, AdminTier, AdminTierBody } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn, formatTry, mergeFromServer, parseDecimalInput } from '../../lib/utils';

interface Draft {
  label: string;
  itemCount: string;
  price: string;
  note: string;
  imageMediaId: string | null;
  imageUrl: string | null;
  isRecommended: boolean;
  isActive: boolean;
  sortOrder: string;
}

function toDraft(t: AdminTier): Draft {
  return {
    label: t.label,
    itemCount: String(t.itemCount),
    price: moneyToInput(t.price),
    note: t.note ?? '',
    imageMediaId: t.imageMediaId ?? null,
    imageUrl: t.imageUrl ?? null,
    isRecommended: t.isRecommended,
    isActive: t.isActive,
    sortOrder: String(t.sortOrder ?? 0),
  };
}

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.label.trim()) e.label = 'Etiket zorunlu';
  else if (d.label.trim().length > 80) e.label = 'En fazla 80 karakter';
  if (!/^\d+$/.test(d.itemCount.trim()) || Number(d.itemCount) < 1) e.itemCount = 'Ürün sayısı 1 ya da büyük tam sayı';
  const price = parseDecimalInput(d.price);
  if (price === null) e.price = 'Fiyat zorunlu (ör. 649,00)';
  else if (price < 0) e.price = 'Fiyat negatif olamaz';
  if (d.note.trim().length > 160) e.note = 'En fazla 160 karakter';
  if (!/^\d+$/.test(d.sortOrder.trim())) e.sortOrder = 'Tam sayı (0 ya da büyük)';
  return e;
}

/** Ekran 6 — Kutular (tier): etiket, ürün sayısı, fiyat, not, görsel, önerilen, aktif, sıra. */
export function AdminKutularPage() {
  const [items, setItems] = useState<AdminTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminTier | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await tiersApi.list();
      setItems([...list].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) {
      setError(errorMessage(e, 'Kutular yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(t: AdminTier) {
    setEditing(t);
    setDraft(toDraft(t));
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
    const body: AdminTierBody = {
      label: draft.label.trim(),
      itemCount: Number(draft.itemCount),
      price: parseDecimalInput(draft.price) ?? 0,
      note: draft.note.trim() || null,
      imageMediaId: draft.imageMediaId,
      isRecommended: draft.isRecommended,
      isActive: draft.isActive,
      sortOrder: Number(draft.sortOrder),
    };
    try {
      const updated = await tiersApi.update(editing.id, body);
      setItems((prev) =>
        prev
          .map((t) => {
            if (t.id === editing.id) return mergeFromServer<AdminTier>({ ...t, ...body, imageUrl: draft.imageUrl }, updated);
            // isRecommended=true diğerlerini false yapar (sunucu kuralı) — yerel kopyayı da eşle
            return body.isRecommended ? { ...t, isRecommended: false } : t;
          })
          .sort((a, b) => a.sortOrder - b.sortOrder),
      );
      toast.success('Kutu güncellendi');
      closeEdit();
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  function onPickImage(file: AdminMediaFile) {
    setDraft((d) => (d ? { ...d, imageMediaId: file.id, imageUrl: file.url } : d));
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Kutular"
        description="Kutu boyları (SUB_TIERS): etiket, ürün sayısı, fiyat, not ve görsel. “Önerilen” işareti kutu.html'de varsayılan seçimi belirler; tek kutu önerilebilir."
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Boxes} message="Kutu boyu bulunamadı (seed: small, sezon)." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((t) => (
            <article key={t.id} className={cn('flex flex-col rounded-lg border border-brand-200 bg-white', !t.isActive && 'opacity-70')}>
              <div className="relative">
                <MediaThumb src={t.imageUrl} alt={t.label} className="h-40 w-full rounded-b-none rounded-t-lg border-0 border-b" />
                {t.isRecommended && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Star className="h-3 w-3" aria-hidden /> Önerilen
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-brand-900">{t.label}</h2>
                    <p className="font-mono text-[11px] text-brand-400">{t.slug}</p>
                  </div>
                  <BoolBadge value={t.isActive} yes="Aktif" no="Pasif" />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-brand-500">Ürün sayısı</dt>
                  <dd className="text-right font-medium text-brand-900">{t.itemCount}</dd>
                  <dt className="text-brand-500">Fiyat</dt>
                  <dd className="text-right font-medium text-brand-900">{formatTry(t.price)}</dd>
                  <dt className="text-brand-500">Sıra</dt>
                  <dd className="text-right text-brand-700">{t.sortOrder}</dd>
                </dl>
                {t.note && <p className="text-xs text-brand-600">{t.note}</p>}
                <div className="mt-auto pt-2">
                  <button type="button" onClick={() => openEdit(t)} className={cn(btn.secondary, 'w-full')}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    Düzenle
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!editing && !!draft}
        onClose={closeEdit}
        title={editing ? `Kutu düzenle — ${editing.label}` : ''}
        size="lg"
        footer={
          <>
            <button type="button" onClick={closeEdit} className={btn.secondary}>İptal</button>
            <button type="submit" form="tier-form" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        {draft && (
          <form id="tier-form" onSubmit={handleSave} className="space-y-4" noValidate>
            <FormErrorBanner message={formError} />
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <div>
                <span className="mb-1 block text-xs font-medium text-brand-600">Görsel</span>
                <MediaThumb src={draft.imageUrl} alt={draft.label} className="h-32 w-full" />
                <div className="mt-2 flex gap-1">
                  <button type="button" onClick={() => setPickerOpen(true)} className={cn(btn.secondary, btn.sm, 'flex-1')}>
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                    Seç
                  </button>
                  {draft.imageMediaId && (
                    <button type="button" onClick={() => setDraft({ ...draft, imageMediaId: null, imageUrl: null })} className={cn(btn.iconDanger)} aria-label="Görseli kaldır" title="Kaldır">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <Field label="Etiket" required error={errors.label}>
                  {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Ürün sayısı" required error={errors.itemCount}>
                    {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.itemCount} onChange={(e) => setDraft({ ...draft, itemCount: e.target.value })} />}
                  </Field>
                  <Field label="Fiyat (₺, KDV dahil)" required error={errors.price}>
                    {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />}
                  </Field>
                </div>
                <Field label="Not" hint="Kutu kartındaki kısa açıklama (ör. “2 kişilik haftalık”)." error={errors.note}>
                  {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={2} value={draft.note} maxLength={160} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />}
                </Field>
                <div className="grid grid-cols-2 items-end gap-3">
                  <Field label="Sıra" error={errors.sortOrder}>
                    {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />}
                  </Field>
                  <div className="space-y-2 pb-1">
                    <Checkbox label="Önerilen" description="Diğer kutuların önerisi kaldırılır." checked={draft.isRecommended} onChange={(e) => setDraft({ ...draft, isRecommended: e.target.checked })} />
                    <Checkbox label="Aktif" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                  </div>
                </div>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <MediaPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={onPickImage} title="Kutu görseli seç" defaultFolder="kutular" />
    </div>
  );
}
