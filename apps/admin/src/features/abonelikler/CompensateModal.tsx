import { useEffect, useState } from 'react';
import { Field, FormErrorBanner, Select, TextArea, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { productsApi } from '../catalog/api';
import { errorMessage } from '../../lib/api';
import type { AdminProductListItem } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cyclesAdminApi } from './api';
import { EMPTY_COMPENSATE_DRAFT, toCompensateBody, validateCompensateDraft, type CompensateDraft } from './subscriptions';

type Props = {
  open: boolean;
  /** Telafinin uygulanacağı cycle (sunucu gerekirse aynı aboneliğin açık SCHEDULED cycle'ına taşır). */
  cycleId: string | null;
  /** Başlıkta gösterilecek müşteri/kutu etiketi. */
  label?: string;
  onClose: () => void;
  onDone?: () => void;
};

/**
 * Telafi diyaloğu (ekran 19 ve 20) — `POST /admin/cycles/:id/compensate {productId,qty?,label?,note}`.
 * Sunucu 0 TL'lik bir EXTRA satırı ekler [B19]; kesimi geçmemiş SCHEDULED cycle yoksa 409 döner.
 */
export function CompensateModal({ open, cycleId, label, onClose, onDone }: Props) {
  const [products, setProducts] = useState<AdminProductListItem[] | null>(null);
  const [draft, setDraft] = useState<CompensateDraft>(EMPTY_COMPENSATE_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(EMPTY_COMPENSATE_DRAFT);
    setErrors({});
    setBanner(null);
    let cancelled = false;
    productsApi
      .list({ page: 1, limit: 200, status: 'ACTIVE' })
      .then((res) => {
        if (!cancelled) setProducts(res.items);
      })
      .catch((e) => {
        if (!cancelled) setBanner(errorMessage(e, 'Ürün listesi yüklenemedi'));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function patch(next: Partial<CompensateDraft>) {
    setDraft((prev) => ({ ...prev, ...next }));
    setErrors({});
    setBanner(null);
  }

  async function submit() {
    if (!cycleId) return;
    const found = validateCompensateDraft(draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      await cyclesAdminApi.compensate(cycleId, toCompensateBody(draft));
      toast.success('Telafi eklendi (0 ₺ ekstra satırı)');
      onDone?.();
      onClose();
    } catch (e) {
      setBanner(errorMessage(e, 'Telafi eklenemedi'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Telafi ekle${label ? ` — ${label}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn.secondary} onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className={btn.primary} disabled={saving} onClick={() => void submit()}>
            {saving ? 'Ekleniyor…' : 'Telafiyi ekle'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <FormErrorBanner message={banner} />
        <p className="text-xs text-brand-500">
          Telafi, kesimi geçmemiş ilk planlı kutuya <strong>0 ₺ ekstra satırı</strong> olarak eklenir (ADR-0008 [B19]); müşteriden ek
          tahsilat yapılmaz. Uygun kutu yoksa sunucu 409 döner.
        </p>
        <Field label="Ürün" error={errors.productId} required>
          {({ id }) => (
            <Select id={id} value={draft.productId} invalid={!!errors.productId} onChange={(e) => patch({ productId: e.target.value })}>
              <option value="">— Ürün seçin —</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.unit})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Miktar" hint="Ürün biriminde (ör. 1 = 1 kg)." error={errors.qty} required>
            {({ id }) => <TextInput id={id} inputMode="decimal" value={draft.qty} invalid={!!errors.qty} onChange={(e) => patch({ qty: e.target.value })} />}
          </Field>
          <Field label="Etiket" hint="Fişte görünecek metin; boş bırakılırsa “x birim (telafi)”." error={errors.label}>
            {({ id }) => <TextInput id={id} value={draft.label} invalid={!!errors.label} onChange={(e) => patch({ label: e.target.value })} />}
          </Field>
        </div>
        <Field label="Telafi nedeni" hint="Olay günlüğüne yazılır (ADMIN_NOTE / telafi kaydı)." error={errors.note} required>
          {({ id }) => <TextArea id={id} rows={3} value={draft.note} invalid={!!errors.note} onChange={(e) => patch({ note: e.target.value })} />}
        </Field>
      </div>
    </Modal>
  );
}
