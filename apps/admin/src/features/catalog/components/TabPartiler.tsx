import { CheckCircle2, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Checkbox, Field, FormErrorBanner, Select, TextArea, TextInput } from '../../../components/ui/FormField';
import { Modal } from '../../../components/ui/Modal';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { errorMessage, extractFieldErrors } from '../../../lib/api';
import type { AdminLotBody, AdminProducer, AdminProductLot } from '../../../lib/adminTypes';
import { btn } from '../../../lib/buttonStyles';
import { td, th } from '../../../lib/tableStyles';
import { toast } from '../../../lib/toast';
import { cn, formatDate, mergeFromServer } from '../../../lib/utils';
import { productsApi } from '../api';
import { InlineNotice } from '../../components/StateBlocks';

interface LotDraft {
  lotCode: string;
  harvestDate: string;
  bestBefore: string;
  tastingNote: string;
  producerId: string;
  setCurrent: boolean;
}

function emptyLotDraft(defaultProducerId: string, makeCurrent: boolean): LotDraft {
  return { lotCode: '', harvestDate: '', bestBefore: '', tastingNote: '', producerId: defaultProducerId, setCurrent: makeCurrent };
}

function lotToDraft(l: AdminProductLot): LotDraft {
  return {
    lotCode: l.lotCode,
    harvestDate: l.harvestDate ? l.harvestDate.slice(0, 10) : '',
    bestBefore: l.bestBefore ? l.bestBefore.slice(0, 10) : '',
    tastingNote: l.tastingNote ?? '',
    producerId: l.producerId ?? '',
    setCurrent: l.isCurrent,
  };
}

function validate(d: LotDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.lotCode.trim()) e.lotCode = 'Parti kodu zorunlu';
  else if (d.lotCode.trim().length > 40) e.lotCode = 'En fazla 40 karakter';
  if (d.harvestDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.harvestDate)) e.harvestDate = 'Tarih biçimi YYYY-AA-GG';
  if (d.bestBefore && !/^\d{4}-\d{2}-\d{2}$/.test(d.bestBefore)) e.bestBefore = 'Tarih biçimi YYYY-AA-GG';
  if (d.harvestDate && d.bestBefore && d.bestBefore < d.harvestDate) e.bestBefore = 'Son tüketim, hasattan önce olamaz';
  return e;
}

type Props = {
  /** Yeni üründe null → önce kaydet uyarısı. */
  productId: string | null;
  lots: AdminProductLot[];
  onChange: (lots: AdminProductLot[]) => void;
  producers: AdminProducer[];
  /** Ürünün üreticisi — yeni lot varsayılanı. */
  defaultProducerId: string;
};

/** Partiler sekmesi: lot listesi, güncel lot + “neden seçtik” (tastingNote), yeni lot, güncel yap, sil. */
export function TabPartiler({ productId, lots, onChange, producers, defaultProducerId }: Props) {
  const confirm = useConfirm();
  const [panel, setPanel] = useState<{ mode: 'new' } | { mode: 'edit'; lot: AdminProductLot } | null>(null);
  const [draft, setDraft] = useState<LotDraft>(() => emptyLotDraft(defaultProducerId, true));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = [...lots].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const current = lots.find((l) => l.isCurrent) ?? null;
  const producerName = (id: string | null) => producers.find((p) => p.id === id)?.name ?? null;

  if (!productId) {
    return <InlineNotice tone="info">Partiler, ürün ilk kez kaydedildikten sonra eklenir. Önce <strong>Kaydet</strong>'e basın.</InlineNotice>;
  }

  function openNew() {
    setPanel({ mode: 'new' });
    setDraft(emptyLotDraft(defaultProducerId, lots.length === 0));
    setErrors({});
    setFormError(null);
  }

  function openEdit(lot: AdminProductLot) {
    setPanel({ mode: 'edit', lot });
    setDraft(lotToDraft(lot));
    setErrors({});
    setFormError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!panel || !productId) return;
    const v = validate(draft);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setFormError(null);
    const base = {
      lotCode: draft.lotCode.trim(),
      harvestDate: draft.harvestDate || null,
      bestBefore: draft.bestBefore || null,
      tastingNote: draft.tastingNote.trim() || null,
      producerId: draft.producerId || null,
    };
    try {
      if (panel.mode === 'new') {
        const body: AdminLotBody = { ...base, setCurrent: draft.setCurrent };
        const created = await productsApi.addLot(productId, body);
        const newLot = mergeFromServer<AdminProductLot>(
          {
            id: `tmp-${Date.now()}`,
            ...base,
            isCurrent: draft.setCurrent,
            producerName: producerName(base.producerId),
            createdAt: new Date().toISOString(),
          },
          created,
        );
        onChange([...(newLot.isCurrent ? lots.map((l) => ({ ...l, isCurrent: false })) : lots), newLot]);
        toast.success('Parti eklendi');
      } else {
        const body: Partial<AdminLotBody> = { ...base, isCurrent: draft.setCurrent };
        const updated = await productsApi.updateLot(productId, panel.lot.id, body);
        const makeCurrent = updated?.isCurrent ?? draft.setCurrent;
        onChange(
          lots.map((l) =>
            l.id === panel.lot.id
              ? mergeFromServer<AdminProductLot>({ ...l, ...base, isCurrent: makeCurrent, producerName: producerName(base.producerId) }, updated)
              : makeCurrent
                ? { ...l, isCurrent: false }
                : l,
          ),
        );
        toast.success('Parti güncellendi');
      }
      setPanel(null);
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function makeCurrent(lot: AdminProductLot) {
    if (!productId || lot.isCurrent) return;
    setBusyId(lot.id);
    try {
      await productsApi.updateLot(productId, lot.id, { isCurrent: true });
      onChange(lots.map((l) => ({ ...l, isCurrent: l.id === lot.id })));
      toast.success(`Güncel parti: ${lot.lotCode}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Güncellenemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(lot: AdminProductLot) {
    if (!productId) return;
    const ok = await confirm({
      title: 'Partiyi sil',
      description: lot.isCurrent
        ? `"${lot.lotCode}" güncel parti. Silerseniz ürünün “neden seçtik” metni ve parti kodu sitede boş kalır; başka bir partiyi güncel yapın.`
        : `"${lot.lotCode}" silinecek.`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    setBusyId(lot.id);
    try {
      await productsApi.removeLot(productId, lot.id);
      onChange(lots.filter((l) => l.id !== lot.id));
      toast.success('Parti silindi');
    } catch (e) {
      toast.error(errorMessage(e, 'Silinemedi'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Güncel lot kartı */}
      <section className={cn('rounded-lg border p-4', current ? 'border-olive/40 bg-olive-soft/40' : 'border-butter-deep/30 bg-butter/30')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-brand-900">
            <Star className="h-4 w-4 text-olive-deep" aria-hidden />
            Güncel parti {current ? <span className="font-mono text-xs text-brand-600">({current.lotCode})</span> : null}
          </h3>
          <button type="button" onClick={openNew} className={cn(btn.primary, btn.sm)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Yeni parti
          </button>
        </div>
        {current ? (
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="text-brand-500">Neden seçtik</dt>
            <dd className="text-brand-800">{current.tastingNote || <span className="text-brand-400">— (sitede “why” boş görünür)</span>}</dd>
            <dt className="text-brand-500">Hasat / Son tüketim</dt>
            <dd className="text-brand-800">{formatDate(current.harvestDate)} / {formatDate(current.bestBefore)}</dd>
            <dt className="text-brand-500">Üretici</dt>
            <dd className="text-brand-800">{current.producerName ?? producerName(current.producerId) ?? <span className="text-brand-400">ürünün üreticisi</span>}</dd>
          </dl>
        ) : (
          <p className="mt-1 text-xs text-butter-deep">Güncel parti yok: ürün kartında parti kodu ve “neden seçtik” metni boş kalır. Yeni parti ekleyin ya da listeden birini güncel yapın.</p>
        )}
      </section>

      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-brand-200">
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Parti kodu</th>
                <th className={th}>Hasat</th>
                <th className={th}>Son tüketim</th>
                <th className={th}>Üretici</th>
                <th className={th}>Neden seçtik</th>
                <th className={th}>Durum</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} className={cn(l.isCurrent && 'bg-olive-soft/30')}>
                  <td className={cn(td, 'font-mono text-xs font-semibold text-brand-900')}>{l.lotCode}</td>
                  <td className={td}>{formatDate(l.harvestDate)}</td>
                  <td className={td}>{formatDate(l.bestBefore)}</td>
                  <td className={td}>{l.producerName ?? producerName(l.producerId) ?? <span className="text-brand-400">—</span>}</td>
                  <td className={cn(td, 'max-w-[24rem]')}><span className="line-clamp-2 text-xs">{l.tastingNote ?? <span className="text-brand-400">—</span>}</span></td>
                  <td className={td}>
                    {l.isCurrent ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-olive-deep"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Güncel</span>
                    ) : (
                      <button type="button" disabled={busyId === l.id} onClick={() => void makeCurrent(l)} className={cn(btn.secondary, btn.sm)}>
                        Güncel yap
                      </button>
                    )}
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openEdit(l)} className={btn.icon} aria-label={`${l.lotCode} düzenle`} title="Düzenle">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" disabled={busyId === l.id} onClick={() => void remove(l)} className={btn.iconDanger} aria-label={`${l.lotCode} sil`} title="Sil">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!panel}
        onClose={() => setPanel(null)}
        title={panel?.mode === 'edit' ? `Parti düzenle — ${panel.lot.lotCode}` : 'Yeni parti'}
        footer={
          <>
            <button type="button" onClick={() => setPanel(null)} className={btn.secondary}>İptal</button>
            <button type="submit" form="lot-form" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        <form id="lot-form" onSubmit={handleSave} className="space-y-4" noValidate>
          <FormErrorBanner message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Parti kodu" required hint="Sitede “Parti: …” (ör. 2026-H1). Ürün içinde benzersiz." error={errors.lotCode}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.lotCode} maxLength={40} className="font-mono" onChange={(e) => setDraft({ ...draft, lotCode: e.target.value })} />}
            </Field>
            <Field label="Üretici" hint="Boşsa ürünün üreticisi." error={errors.producerId}>
              {({ id, invalid }) => (
                <Select id={id} invalid={invalid} value={draft.producerId} onChange={(e) => setDraft({ ...draft, producerId: e.target.value })}>
                  <option value="">— Ürünün üreticisi —</option>
                  {producers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.village ? ` · ${p.village}` : ''}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Hasat tarihi" error={errors.harvestDate}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="date" value={draft.harvestDate} onChange={(e) => setDraft({ ...draft, harvestDate: e.target.value })} />}
            </Field>
            <Field label="Son tüketim" error={errors.bestBefore}>
              {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="date" value={draft.bestBefore} onChange={(e) => setDraft({ ...draft, bestBefore: e.target.value })} />}
            </Field>
          </div>
          <Field label="Neden seçtik (tadım notu)" hint="Ürün sayfasındaki “Neden seçtik” metni — güncel partininki gösterilir." error={errors.tastingNote}>
            {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={4} value={draft.tastingNote} onChange={(e) => setDraft({ ...draft, tastingNote: e.target.value })} />}
          </Field>
          <Checkbox
            label="Güncel parti yap"
            description="Diğer partiler güncel olmaktan çıkar; site bu partinin kodunu ve notunu gösterir."
            checked={draft.setCurrent}
            disabled={panel?.mode === 'edit' && panel.lot.isCurrent}
            onChange={(e) => setDraft({ ...draft, setCurrent: e.target.checked })}
          />
        </form>
      </Modal>
    </div>
  );
}
