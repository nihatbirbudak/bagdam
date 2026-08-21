import { CalendarDays, ChevronLeft, ChevronRight, Lock, LockOpen, RefreshCw, Save, Wand2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Field, Select, TextInput } from '../../components/ui/FormField';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { deliveryAdminApi } from '../../features/ayarlar/api';
import {
  DATE_STATUS_STYLE,
  cutoffCountdown,
  dateStatusLabel,
  deliveryDayLabel,
  isCutoffPassed,
  occupancyOf,
  summarizeDates,
  toggleStatusLabel,
  toggleStatusTarget,
  validateCapacity,
  validateWeeks,
  weekWindow,
} from '../../features/teslimat/deliveryDates';
import { errorMessage } from '../../lib/api';
import type { AdminDeliveryDate, AdminDeliveryZone } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime } from '../../lib/utils';
import { formatWeekRange } from '../../lib/week';
import { todayIsoDate } from '../../features/siparisler/orders';

/**
 * Ekran 14b — Ayarlar › Teslimat tarihleri (F9).
 *
 * Bölge + hafta seçici; gün / tarih / kesim / rezerve / kapasite / durum listesi; kapasite düzenleme,
 * günü kapat-aç (`PATCH /admin/delivery/dates/:id`), ileriye dönük tarih üretimi
 * (`POST /admin/delivery/dates/generate`). `LOCKED` sunucunun durumudur (kesim geçti) — panelden verilemez;
 * ops yalnız `OPEN ↔ CLOSED` çevirir. Kesim anı mutlaktır (ADR-0005: teslimattan bir gün önce 12:00).
 *
 * URL durumu: `?zone=<slug>&week=<offset>`.
 */
export function AdminTeslimatTarihleriPage() {
  const [params, setParams] = useSearchParams();
  const confirm = useConfirm();

  const zoneSlug = params.get('zone') ?? '';
  const weekOffset = Number(params.get('week') ?? 0) || 0;

  const [zones, setZones] = useState<AdminDeliveryZone[] | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [dates, setDates] = useState<AdminDeliveryDate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Kapasite satır içi düzenleme
  const [editId, setEditId] = useState<string | null>(null);
  const [capacityDraft, setCapacityDraft] = useState('');
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Tarih üretimi
  const [weeks, setWeeks] = useState('8');
  const [generating, setGenerating] = useState(false);

  const today = todayIsoDate(now);
  const window = useMemo(() => weekWindow(today, weekOffset), [today, weekOffset]);

  const setParam = useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '' || (k === 'week' && v === 0)) next.delete(k);
        else next.set(k, String(v));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    let cancelled = false;
    deliveryAdminApi.zones
      .list()
      .then((list) => {
        if (!cancelled) setZones(list);
      })
      .catch((e) => {
        if (!cancelled) setZonesError(errorMessage(e, 'Bölgeler yüklenemedi'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await deliveryAdminApi.dates.list({ zone: zoneSlug || undefined, from: window.weekStart, to: window.weekEnd });
      setDates([...list].sort((a, b) => a.date.localeCompare(b.date) || (a.zoneName ?? '').localeCompare(b.zoneName ?? '', 'tr')));
      setNow(new Date());
    } catch (e) {
      setError(errorMessage(e, 'Teslimat tarihleri yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [zoneSlug, window.weekStart, window.weekEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(d: AdminDeliveryDate) {
    setEditId(d.id);
    setCapacityDraft(String(d.capacity));
    setCapacityError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setCapacityDraft('');
    setCapacityError(null);
  }

  async function saveCapacity(d: AdminDeliveryDate) {
    const err = validateCapacity(capacityDraft, d.reserved);
    if (err) {
      setCapacityError(err);
      return;
    }
    setSavingId(d.id);
    try {
      const updated = await deliveryAdminApi.dates.patch(d.id, { capacity: Number(capacityDraft.trim()) });
      setDates((prev) => (prev ?? []).map((row) => (row.id === d.id ? { ...row, ...updated } : row)));
      toast.success(`${formatDate(d.date)} kapasitesi güncellendi`);
      cancelEdit();
    } catch (e) {
      toast.error(errorMessage(e, 'Kapasite kaydedilemedi'));
    } finally {
      setSavingId(null);
    }
  }

  async function toggleStatus(d: AdminDeliveryDate) {
    const target = toggleStatusTarget(d.status);
    if (!target) {
      toast.warning('Kesimi geçmiş gün (kilitli) panelden açılıp kapatılamaz.');
      return;
    }
    if (target === 'CLOSED' && d.reserved > 0) {
      const ok = await confirm({
        title: 'Günü kapat',
        description: `${formatDate(d.date)} için ${d.reserved} rezervasyon var. Gün kapatılınca yeni sipariş alınmaz; mevcut rezervasyonlar iptal edilmez.`,
        confirmLabel: 'Günü kapat',
        danger: true,
      });
      if (!ok) return;
    }
    setSavingId(d.id);
    try {
      const updated = await deliveryAdminApi.dates.patch(d.id, { status: target });
      setDates((prev) => (prev ?? []).map((row) => (row.id === d.id ? { ...row, ...updated } : row)));
      toast.success(target === 'CLOSED' ? 'Gün kapatıldı' : 'Gün açıldı');
    } catch (e) {
      toast.error(errorMessage(e, 'Gün durumu değiştirilemedi'));
    } finally {
      setSavingId(null);
    }
  }

  async function generate() {
    const err = validateWeeks(weeks);
    if (err) {
      toast.error(err);
      return;
    }
    setGenerating(true);
    try {
      const res = await deliveryAdminApi.dates.generate(Number(weeks.trim()));
      toast.success(`Tarihler üretildi — ${res.created} yeni, ${res.updated} güncellendi (${res.zones} bölge).`);
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Tarihler üretilemedi'));
    } finally {
      setGenerating(false);
    }
  }

  const digest = dates ? summarizeDates(dates) : null;
  const zoneName = zones?.find((z) => z.slug === zoneSlug)?.name;

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Teslimat tarihleri"
        description="Salı / Perşembe / Cumartesi teslimat günleri; kesim bir gün önce 12:00 (ADR-0005). Kapasiteyi düşürüp günü kapatabilirsiniz; kesimi geçen günler sunucu tarafından kilitlenir."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={cn(btn.secondary, btn.sm)}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Yenile
          </button>
        }
      />

      {zonesError && <InlineNotice tone="warning" className="mb-3">{zonesError}</InlineNotice>}

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-brand-200 bg-white px-4 py-3">
        <Field label="Bölge" className="w-44">
          {({ id }) => (
            <Select id={id} value={zoneSlug} onChange={(e) => setParam({ zone: e.target.value })}>
              <option value="">Tüm bölgeler</option>
              {(zones ?? []).map((z) => (
                <option key={z.id} value={z.slug}>
                  {z.name}
                  {z.isActive ? '' : ' (pasif)'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex items-end gap-1">
          <button type="button" className={btn.icon} aria-label="Önceki hafta" onClick={() => setParam({ week: weekOffset - 1 })}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="min-w-40 px-2 text-center">
            <span className="block text-[11px] font-medium text-brand-600">Hafta</span>
            <span className="block text-sm font-semibold text-brand-900">{formatWeekRange(window.weekStart)}</span>
          </div>
          <button type="button" className={btn.icon} aria-label="Sonraki hafta" onClick={() => setParam({ week: weekOffset + 1 })}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          {weekOffset !== 0 && (
            <button type="button" onClick={() => setParam({ week: 0 })} className={cn(btn.ghost, btn.sm)}>
              Bu hafta
            </button>
          )}
        </div>

        <div className="ml-auto flex items-end gap-2">
          <Field label="Hafta sayısı" className="w-24" error={null}>
            {({ id }) => <TextInput id={id} inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />}
          </Field>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className={btn.outline}
            title="Aktif bölgeler için ileriye dönük teslimat tarihlerini üretir (idempotent: var olanlar korunur)"
          >
            <Wand2 className="h-4 w-4" aria-hidden />
            {generating ? 'Üretiliyor…' : 'Tarih üret'}
          </button>
        </div>
      </div>

      {digest && digest.total > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Teslimat günü" value={digest.total} />
          <Stat label="Açık" value={digest.open} tone="good" />
          <Stat label="Kilitli (kesim geçti)" value={digest.locked} />
          <Stat label="Kapalı" value={digest.closed} />
          <Stat label="Dolu gün" value={digest.full} tone={digest.full ? 'bad' : 'neutral'} />
        </div>
      )}

      {loading && !dates ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : !dates || dates.length === 0 ? (
        <AdminEmptyState
          icon={CalendarDays}
          message={`${formatWeekRange(window.weekStart)} haftasında${zoneName ? ` ${zoneName} için` : ''} teslimat tarihi yok. “Tarih üret” ile ileriye dönük günleri oluşturabilirsiniz.`}
        />
      ) : (
        <AdminScrollTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Gün</th>
                <th className={th}>Tarih</th>
                {!zoneSlug && <th className={th}>Bölge</th>}
                <th className={th}>Kesim</th>
                <th className={cn(th, 'text-right')}>Rezerve</th>
                <th className={cn(th, 'text-right')}>Kapasite</th>
                <th className={th}>Doluluk</th>
                <th className={th}>Durum</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const o = occupancyOf(d);
                const editing = editId === d.id;
                const busy = savingId === d.id;
                const target = toggleStatusTarget(d.status);
                return (
                  <tr key={d.id} className={cn(d.status !== 'OPEN' && 'bg-brand-50/60')}>
                    <td className={cn(td, 'font-medium text-brand-900')}>{deliveryDayLabel(d.day)}</td>
                    <td className={td}>{formatDate(d.date)}</td>
                    {!zoneSlug && <td className={td}>{d.zoneName ?? '—'}</td>}
                    <td className={cn(td, 'text-xs', isCutoffPassed(d.cutoffAt, now) && 'text-brand-400')}>
                      <span className="block">{formatDateTime(d.cutoffAt)}</span>
                      <span className="text-brand-500">{cutoffCountdown(d.cutoffAt, now)}</span>
                    </td>
                    <td className={cn(td, 'text-right', o.full && 'font-semibold text-accent-dark')}>{o.reserved}</td>
                    <td className={cn(td, 'text-right')}>
                      {editing ? (
                        <span className="inline-flex flex-col items-end gap-1">
                          <TextInput
                            inputMode="numeric"
                            autoFocus
                            aria-label={`${formatDate(d.date)} kapasitesi`}
                            value={capacityDraft}
                            invalid={!!capacityError}
                            className="w-24 py-1 text-right text-xs"
                            onChange={(e) => {
                              setCapacityDraft(e.target.value);
                              setCapacityError(null);
                            }}
                          />
                          {capacityError && (
                            <span role="alert" className="text-[11px] text-accent-dark">
                              {capacityError}
                            </span>
                          )}
                        </span>
                      ) : (
                        <button type="button" className="rounded px-1 tabular-nums hover:bg-brand-100 hover:text-accent" onClick={() => startEdit(d)} title="Kapasiteyi düzenle">
                          {d.capacity}
                        </button>
                      )}
                    </td>
                    <td className={cn(td, 'text-xs')}>
                      <span className={cn('font-medium', o.full ? 'text-accent-dark' : o.nearlyFull ? 'text-butter-deep' : 'text-brand-600')}>
                        %{o.pct}
                        {o.full ? ' · dolu' : o.nearlyFull ? ' · dolmak üzere' : ''}
                      </span>
                    </td>
                    <td className={td}>
                      <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', DATE_STATUS_STYLE[d.status] ?? 'bg-brand-100 text-brand-600 ring-brand-300')}>
                        {dateStatusLabel(d.status)}
                      </span>
                    </td>
                    <td className={td}>
                      <div className="flex items-center justify-end gap-1">
                        {editing ? (
                          <>
                            <button type="button" className={btn.icon} disabled={busy} aria-label="Kapasiteyi kaydet" title="Kaydet" onClick={() => void saveCapacity(d)}>
                              <Save className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            <button type="button" className={btn.icon} disabled={busy} aria-label="Vazgeç" title="Vazgeç" onClick={cancelEdit}>
                              <X className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={btn.icon}
                            disabled={busy || !target}
                            aria-label={`${formatDate(d.date)} — ${toggleStatusLabel(d.status)}`}
                            title={target ? toggleStatusLabel(d.status) : 'Kesimi geçmiş gün kilitlidir'}
                            onClick={() => void toggleStatus(d)}
                          >
                            {d.status === 'CLOSED' ? <LockOpen className="h-3.5 w-3.5" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminScrollTable>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <div className="rounded-md border border-brand-200 bg-white px-3 py-2">
      <span className={cn('block text-lg font-semibold tabular-nums', tone === 'good' ? 'text-olive-deep' : tone === 'bad' ? 'text-accent-dark' : 'text-brand-900')}>{value}</span>
      <span className="block text-[11px] text-brand-600">{label}</span>
    </div>
  );
}
