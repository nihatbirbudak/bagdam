import { DELIVERY_DATE_STATUS_LABELS, DELIVERY_DAY_LABELS, type DeliveryDateStatus, type DeliveryDay } from '@bagdam/shared';
import { CalendarDays, MapPin, Pencil, Plus, RefreshCw, Save, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Checkbox, Field, FormErrorBanner, Select, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { deliveryAdminApi } from '../../features/ayarlar/api';
import { moneyToInput } from '../../features/catalog/productForm';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminDeliveryDate, AdminDeliveryZone, AdminDeliveryZoneInput } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { addDays } from '../../lib/week';
import { cn, formatDate, formatDateTime, formatTry, mergeFromServer, parseDecimalInput, slugify } from '../../lib/utils';

interface ZoneDraft {
  name: string;
  slug: string;
  slugTouched: boolean;
  fee: string;
  freeThreshold: string;
  capacityPerDay: string;
  sortOrder: string;
  isActive: boolean;
}

function emptyZoneDraft(): ZoneDraft {
  return { name: '', slug: '', slugTouched: false, fee: '49,00', freeThreshold: '1000,00', capacityPerDay: '999', sortOrder: '0', isActive: true };
}

function zoneToDraft(z: AdminDeliveryZone): ZoneDraft {
  return {
    name: z.name,
    slug: z.slug,
    slugTouched: true,
    fee: moneyToInput(z.fee),
    freeThreshold: z.freeThreshold === null || z.freeThreshold === undefined ? '' : moneyToInput(z.freeThreshold),
    capacityPerDay: String(z.capacityPerDay ?? 999),
    sortOrder: String(z.sortOrder ?? 0),
    isActive: z.isActive,
  };
}

export function validateZoneDraft(d: ZoneDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.name.trim()) e.name = 'Ad zorunlu';
  else if (d.name.trim().length > 60) e.name = 'En fazla 60 karakter';
  if (!d.slug.trim()) e.slug = 'Slug zorunlu';
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug.trim())) e.slug = 'Yalnız küçük harf, rakam ve tire (ör. urla, cesme)';
  const fee = parseDecimalInput(d.fee);
  if (fee === null) e.fee = 'Kargo ücreti zorunlu (ör. 49,00)';
  else if (fee < 0) e.fee = 'Negatif olamaz';
  if (d.freeThreshold.trim()) {
    const t = parseDecimalInput(d.freeThreshold);
    if (t === null) e.freeThreshold = 'Geçerli tutar girin ya da boş bırakın (eşik yok)';
    else if (t < 0) e.freeThreshold = 'Negatif olamaz';
  }
  if (!/^\d+$/.test(d.capacityPerDay.trim()) || Number(d.capacityPerDay) < 0) e.capacityPerDay = 'Tam sayı (0 ya da büyük)';
  if (!/^\d+$/.test(d.sortOrder.trim())) e.sortOrder = 'Tam sayı (0 ya da büyük)';
  return e;
}

export function zoneDraftToBody(d: ZoneDraft): AdminDeliveryZoneInput {
  return {
    name: d.name.trim(),
    slug: d.slug.trim(),
    fee: parseDecimalInput(d.fee) ?? 0,
    freeThreshold: d.freeThreshold.trim() ? parseDecimalInput(d.freeThreshold) : null,
    capacityPerDay: Number(d.capacityPerDay),
    isActive: d.isActive,
    sortOrder: Number(d.sortOrder),
  };
}

const DATE_STATUS_STYLE: Record<DeliveryDateStatus, string> = {
  OPEN: 'bg-olive-soft text-olive-deep ring-olive/30',
  LOCKED: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  CLOSED: 'bg-brand-100 text-brand-600 ring-brand-300',
};

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
}

/**
 * Ekran 14a — Ayarlar › Bölgeler: teslimat bölgesi CRUD (ad/slug/ücret/eşik/kapasite/aktif/sıra; kargo-eşik TEK sahibi)
 * + teslimat tarihleri önizleme (salt-okunur; düzenleme F9 ekran 14b) + tarih üretme.
 */
export function AdminBolgelerPage() {
  const [zones, setZones] = useState<AdminDeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ mode: 'new' } | { mode: 'edit'; row: AdminDeliveryZone } | null>(null);
  const [draft, setDraft] = useState<ZoneDraft>(emptyZoneDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await deliveryAdminApi.zones.list();
      setZones([...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr')));
    } catch (e) {
      setError(errorMessage(e, 'Bölgeler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setPanel({ mode: 'new' });
    setDraft(emptyZoneDraft());
    setErrors({});
    setFormError(null);
  }
  function openEdit(z: AdminDeliveryZone) {
    setPanel({ mode: 'edit', row: z });
    setDraft(zoneToDraft(z));
    setErrors({});
    setFormError(null);
  }
  function closePanel() {
    setPanel(null);
  }
  function patch(p: Partial<ZoneDraft>) {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (p.name !== undefined && !d.slugTouched) next.slug = slugify(p.name).slice(0, 60);
      return next;
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!panel) return;
    const v = validateZoneDraft(draft);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setFormError(null);
    const body = zoneDraftToBody(draft);
    try {
      if (panel.mode === 'new') {
        const created = await deliveryAdminApi.zones.create(body);
        setZones((prev) =>
          [...prev, mergeFromServer<AdminDeliveryZone>({ id: created?.id ?? `tmp-${Date.now()}`, ...body }, created)].sort((a, b) => a.sortOrder - b.sortOrder),
        );
        toast.success('Bölge oluşturuldu');
      } else {
        const updated = await deliveryAdminApi.zones.update(panel.row.id, body);
        setZones((prev) => prev.map((z) => (z.id === panel.row.id ? mergeFromServer<AdminDeliveryZone>({ ...z, ...body }, updated) : z)).sort((a, b) => a.sortOrder - b.sortOrder));
        toast.success('Bölge güncellendi');
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

  async function toggleActive(z: AdminDeliveryZone) {
    setBusyId(z.id);
    try {
      const updated = await deliveryAdminApi.zones.setActive(z.id, !z.isActive);
      setZones((prev) => prev.map((x) => (x.id === z.id ? mergeFromServer<AdminDeliveryZone>({ ...x, isActive: !z.isActive }, updated) : x)));
      toast.success(!z.isActive ? 'Bölge aktif' : 'Bölge pasif');
    } catch (e) {
      toast.error(errorMessage(e, 'Durum değiştirilemedi'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Bölgeler"
        description="Teslimat bölgeleri (Urla, Çeşme — kendi kurye). Kargo ücreti ve ücretsiz eşik yalnız burada tutulur (ADR-0005 [B11]); kapasite varsayılan 999 (fiilen sınırsız), ops düşürür. Değişiklik bootstrap önbelleğini yeniler."
        actions={
          <button type="button" onClick={openNew} className={btn.primary}>
            <Plus className="h-4 w-4" aria-hidden />
            Yeni bölge
          </button>
        }
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : zones.length === 0 ? (
        <AdminEmptyState icon={MapPin} message="Bölge yok." cta={{ label: 'Yeni bölge', onClick: openNew }} />
      ) : (
        <AdminScrollTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={cn(th, 'w-16 text-right')}>Sıra</th>
                <th className={th}>Ad</th>
                <th className={th}>Slug</th>
                <th className={cn(th, 'text-right')}>Kargo</th>
                <th className={cn(th, 'text-right')}>Ücretsiz eşik</th>
                <th className={cn(th, 'text-right')}>Kapasite / gün</th>
                <th className={th}>Aktif</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className={cn(!z.isActive && 'bg-brand-50/60')}>
                  <td className={cn(td, 'text-right')}>{z.sortOrder}</td>
                  <td className={cn(td, 'font-medium text-brand-900')}>{z.name}</td>
                  <td className={cn(td, 'font-mono text-xs')}>{z.slug}</td>
                  <td className={cn(td, 'text-right')}>{formatTry(z.fee)}</td>
                  <td className={cn(td, 'text-right')}>{z.freeThreshold === null || z.freeThreshold === undefined ? <span className="text-brand-400">eşik yok</span> : formatTry(z.freeThreshold)}</td>
                  <td className={cn(td, 'text-right')}>{z.capacityPerDay}</td>
                  <td className={td}>
                    <button type="button" onClick={() => void toggleActive(z)} disabled={busyId === z.id} className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30" title={z.isActive ? 'Pasife al' : 'Aktifleştir'} aria-label={`${z.name} ${z.isActive ? 'pasife al' : 'aktifleştir'}`}>
                      <BoolBadge value={z.isActive} yes="Aktif" no="Pasif" />
                    </button>
                  </td>
                  <td className={td}>
                    <button type="button" onClick={() => openEdit(z)} className={btn.icon} aria-label={`${z.name} düzenle`} title="Düzenle">
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminScrollTable>
      )}

      <DeliveryDatesPreview zones={zones} />

      <Modal
        open={!!panel}
        onClose={closePanel}
        title={panel?.mode === 'edit' ? `Bölge düzenle — ${panel.row.name}` : 'Yeni bölge'}
        footer={
          <>
            <button type="button" onClick={closePanel} className={btn.secondary}>İptal</button>
            <button type="submit" form="zone-form" disabled={saving} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        {panel && (
          <form id="zone-form" onSubmit={handleSave} className="space-y-4" noValidate>
            <FormErrorBanner message={formError} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ad" required error={errors.name}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} />}
              </Field>
              <Field label="Slug" required hint="Adres formundaki ilçe değeri (urla, cesme)." error={errors.slug}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.slug} className="font-mono" onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value, slugTouched: true }))} />}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kargo ücreti (₺)" required error={errors.fee}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={draft.fee} onChange={(e) => patch({ fee: e.target.value })} />}
              </Field>
              <Field label="Ücretsiz kargo eşiği (₺)" hint="Boş = eşik yok. Karşılaştırma kuralı Genel › Ticaret (≥ / >)." error={errors.freeThreshold}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={draft.freeThreshold} onChange={(e) => patch({ freeThreshold: e.target.value })} />}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Günlük kapasite" required hint="Varsayılan 999 (sınırsız); dolunca checkout 409 DAY_FULL." error={errors.capacityPerDay}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.capacityPerDay} onChange={(e) => patch({ capacityPerDay: e.target.value })} />}
              </Field>
              <Field label="Sıra" error={errors.sortOrder}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.sortOrder} onChange={(e) => patch({ sortOrder: e.target.value })} />}
              </Field>
            </div>
            <Checkbox label="Aktif" description="Pasif bölge adres formunda ve teslimat tarihi üretiminde görünmez." checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />
          </form>
        )}
      </Modal>
    </div>
  );
}

/** Teslimat tarihleri önizleme (salt-okunur; düzenleme F9 14b) + tarih üretme. */
function DeliveryDatesPreview({ zones }: { zones: AdminDeliveryZone[] }) {
  const activeZones = useMemo(() => zones.filter((z) => z.isActive), [zones]);
  const [zone, setZone] = useState('');
  const [from, setFrom] = useState(() => todayIso());
  const [to, setTo] = useState(() => addDays(todayIso(), 28));
  const [dates, setDates] = useState<AdminDeliveryDate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState('8');
  const [generating, setGenerating] = useState(false);

  const zoneSlug = zone || activeZones[0]?.slug || zones[0]?.slug || '';

  const load = useCallback(async () => {
    if (!zoneSlug) return;
    setLoading(true);
    setError(null);
    try {
      const list = await deliveryAdminApi.dates.list({ zone: zoneSlug, from, to });
      setDates([...list].sort((a, b) => a.date.localeCompare(b.date)));
    } catch (e) {
      setError(errorMessage(e, 'Teslimat tarihleri yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [zoneSlug, from, to]);

  useEffect(() => {
    if (zoneSlug) void load();
  }, [load, zoneSlug]);

  async function generate() {
    const w = Number(weeks);
    if (!Number.isInteger(w) || w < 1 || w > 52) {
      toast.error('Hafta sayısı 1–52 arası tam sayı olmalı');
      return;
    }
    setGenerating(true);
    try {
      await deliveryAdminApi.dates.generate(w);
      toast.success(`${w} hafta ileri teslimat tarihleri üretildi`);
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Tarihler üretilemedi'));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-brand-200 bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
        <CalendarDays className="h-4 w-4 text-brand-500" aria-hidden />
        <h2 className="text-sm font-semibold text-brand-800">Teslimat tarihleri (önizleme)</h2>
        <span className="text-xs text-brand-500">Salı / Perşembe / Cumartesi; kesim bir gün önce 12:00 (ADR-0005). Kapasite/kapatma düzenlemesi F9'da.</span>
      </header>
      <div className="flex flex-wrap items-end gap-3 border-b border-brand-200 px-4 py-3">
        <Field label="Bölge" className="w-40">
          {({ id }) => (
            <Select id={id} value={zoneSlug} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.slug}>{z.name}{!z.isActive ? ' (pasif)' : ''}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Başlangıç" className="w-40">
          {({ id }) => <TextInput id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label="Bitiş" className="w-40">
          {({ id }) => <TextInput id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <button type="button" onClick={() => void load()} disabled={loading || !zoneSlug} className={btn.secondary}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          Yenile
        </button>
        <div className="ml-auto flex items-end gap-2">
          <Field label="Hafta" className="w-20">
            {({ id }) => <TextInput id={id} inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />}
          </Field>
          <button type="button" onClick={() => void generate()} disabled={generating} className={btn.outline} title="Aktif bölgeler için ileriye dönük tarihleri üretir (var olanlar korunur)">
            <Wand2 className="h-4 w-4" aria-hidden />
            {generating ? 'Üretiliyor…' : 'Tarih üret'}
          </button>
        </div>
      </div>
      {!zoneSlug ? (
        <p className="px-4 py-6 text-sm text-brand-500">Önce bir bölge ekleyin.</p>
      ) : loading && !dates ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} className="m-4" />
      ) : dates && dates.length === 0 ? (
        <div className="px-4 py-4">
          <InlineNotice tone="info">Bu aralıkta teslimat tarihi yok. “Tarih üret” ile ileriye dönük tarihleri oluşturabilirsiniz.</InlineNotice>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Tarih</th>
                <th className={th}>Gün</th>
                <th className={th}>Kesim</th>
                <th className={cn(th, 'text-right')}>Kapasite</th>
                <th className={cn(th, 'text-right')}>Rezerve</th>
                <th className={th}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {(dates ?? []).map((d) => {
                const full = d.reserved >= d.capacity;
                return (
                  <tr key={d.id} className={cn(d.status !== 'OPEN' && 'bg-brand-50/60')}>
                    <td className={cn(td, 'font-medium text-brand-900')}>{formatDate(d.date)}</td>
                    <td className={td}>{DELIVERY_DAY_LABELS[d.day as DeliveryDay] ?? d.day}</td>
                    <td className={cn(td, 'text-xs')}>{formatDateTime(d.cutoffAt)}</td>
                    <td className={cn(td, 'text-right')}>{d.capacity}</td>
                    <td className={cn(td, 'text-right', full && 'font-semibold text-accent-dark')}>{d.reserved}{full ? ' (dolu)' : ''}</td>
                    <td className={td}>
                      <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', DATE_STATUS_STYLE[d.status as DeliveryDateStatus] ?? 'bg-brand-100 text-brand-600 ring-brand-300')}>
                        {DELIVERY_DATE_STATUS_LABELS[d.status as DeliveryDateStatus] ?? d.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
