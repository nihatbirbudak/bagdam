import { AlertTriangle, Boxes, ClipboardList, Gift, Package, Printer, Receipt, RefreshCw, Truck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field, Select, TextInput } from '../../components/ui/FormField';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminTabPanel } from '../../features/components/AdminTabPanel';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { CompensateModal } from '../../features/abonelikler/CompensateModal';
import { CycleItemSourceBadge, CycleStatusBadge } from '../../features/abonelikler/SubscriptionBadges';
import { deliveryAdminApi } from '../../features/ayarlar/api';
import { cyclesAdminApi } from '../../features/abonelikler/api';
import { opsApi } from '../../features/ops/api';
import {
  bulkApplicableIds,
  bulkNeedsConfirm,
  bulkResultMessage,
  bulkStatusOptions,
  daySummaryWarnings,
  groupPackingByZone,
  opsStatusLabel,
  packingItemText,
  prefsText,
  printTitle,
  qtyLabel,
  sortPickList,
  summarizePickList,
} from '../../features/ops/ops';
import { OrderKindBadge, OrderStatusBadge } from '../../features/siparisler/OrderBadges';
import { ordersApi } from '../../features/siparisler/api';
import { todayIsoDate } from '../../features/siparisler/orders';
import { errorMessage } from '../../lib/api';
import type {
  AdminCycleListItem,
  AdminDeliveryZone,
  OpsBulkStatus,
  OpsDaySummary,
  OrderSummary,
  PackingListEntry,
  PickListRow,
} from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime, formatTry } from '../../lib/utils';

type TabKey = 'kutular' | 'siparisler' | 'toplama' | 'paketleme';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'kutular', label: 'Kutular' },
  { key: 'siparisler', label: 'Siparişler' },
  { key: 'toplama', label: 'Toplama listesi' },
  { key: 'paketleme', label: 'Paketleme listesi' },
];

/**
 * Ekran 20 — Teslimat Günü (ops, F9).
 *
 * Tarih + bölge seçici → o günün kutuları (`GET /admin/cycles?date&zone`), siparişleri
 * (`GET /admin/orders?deliveryOn`), ürün bazında **toplama listesi** (`/admin/ops/pick-list`), müşteri bazında
 * **paketleme listesi** (`/admin/ops/packing-list`) ve gün özeti (`/admin/ops/day-summary`).
 * Toplu durum ilerletme (`POST /admin/ops/bulk-status`; hedefler PREPARING → OUT_FOR_DELIVERY → DELIVERED,
 * DELIVERY_FAILED yalnız siparişte) ve telafi kısayolu (`POST /admin/cycles/:id/compensate`).
 *
 * Yazdırma: sayfa kabuğu `print:hidden`; toplama listesi tek tablo, paketleme listesi fiş başına bir sayfa
 * (`.print-sheet`). Çıktı başlığı tarih + bölge (`.print-only`).
 */
export function AdminTeslimatGunuPage() {
  const [params, setParams] = useSearchParams();
  const confirm = useConfirm();

  const date = params.get('date') || todayIsoDate();
  const zone = params.get('zone') ?? '';
  const tab = (params.get('sekme') as TabKey) || 'kutular';

  const [zones, setZones] = useState<AdminDeliveryZone[]>([]);
  const [cycles, setCycles] = useState<AdminCycleListItem[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [pick, setPick] = useState<PickListRow[]>([]);
  const [packing, setPacking] = useState<PackingListEntry[]>([]);
  const [summary, setSummary] = useState<OpsDaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);

  const [selectedCycles, setSelectedCycles] = useState<string[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [compensateCycleId, setCompensateCycleId] = useState<string | null>(null);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
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
      .catch(() => {
        /* bölge listesi olmasa da ekran çalışır (tüm bölgeler) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPartialError(null);
    setSelectedCycles([]);
    setSelectedOrders([]);
    setBulkTarget('');
    const zoneParam = zone || undefined;
    const [cyclesRes, ordersRes, pickRes, packingRes, summaryRes] = await Promise.allSettled([
      cyclesAdminApi.listForDate({ date, zone: zoneParam }),
      ordersApi.list({ deliveryOn: date, page: 1, limit: 200 }),
      opsApi.pickList({ date, zone: zoneParam }),
      opsApi.packingList({ date, zone: zoneParam }),
      opsApi.daySummary({ date, zone: zoneParam }),
    ]);

    if (cyclesRes.status === 'rejected' && ordersRes.status === 'rejected') {
      setError(errorMessage(cyclesRes.reason, 'Gün verisi yüklenemedi'));
      setLoading(false);
      return;
    }
    setCycles(cyclesRes.status === 'fulfilled' ? cyclesRes.value : []);
    setOrders(ordersRes.status === 'fulfilled' ? ordersRes.value.items : []);
    setPick(pickRes.status === 'fulfilled' ? pickRes.value : []);
    setPacking(packingRes.status === 'fulfilled' ? packingRes.value : []);
    setSummary(summaryRes.status === 'fulfilled' ? summaryRes.value : null);
    const failed = [cyclesRes, ordersRes, pickRes, packingRes, summaryRes].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) setPartialError(errorMessage(failed.reason, 'Bazı listeler yüklenemedi'));
    setLoading(false);
  }, [date, zone]);

  useEffect(() => {
    void load();
  }, [load]);

  const zoneName = zones.find((z) => z.slug === zone)?.name ?? null;

  const selection = useMemo(
    () => ({
      cycles: cycles.filter((c) => selectedCycles.includes(c.id)).map((c) => ({ id: c.id, status: c.status })),
      orders: orders.filter((o) => selectedOrders.includes(o.id)).map((o) => ({ id: o.id, status: o.status })),
    }),
    [cycles, orders, selectedCycles, selectedOrders],
  );
  const bulkOptions = useMemo(() => bulkStatusOptions(selection), [selection]);
  const selectedCount = selectedCycles.length + selectedOrders.length;
  const warnings = useMemo(() => (summary ? daySummaryWarnings(summary) : []), [summary]);

  async function applyBulk() {
    if (!bulkTarget || selectedCount === 0) return;
    const ids = bulkApplicableIds(selection, bulkTarget);
    const applicable = ids.cycleIds.length + ids.orderIds.length;
    if (applicable === 0) {
      toast.warning('Seçili satırların hiçbiri bu duruma geçemiyor.');
      return;
    }
    if (bulkNeedsConfirm(bulkTarget)) {
      const ok = await confirm({
        title: `Toplu durum: ${opsStatusLabel(bulkTarget)}`,
        description: `${applicable} kayıt "${opsStatusLabel(bulkTarget)}" durumuna alınacak. Bu işlem geri alınamaz.`,
        confirmLabel: 'Uygula',
        danger: true,
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const res = await opsApi.bulkStatus({ ...ids, status: bulkTarget as OpsBulkStatus });
      const message = bulkResultMessage(res);
      if (res.failed > 0 || res.skipped > 0) toast.warning(message);
      else toast.success(message);
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Toplu durum uygulanamadı'));
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleCycle(id: string) {
    setSelectedCycles((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleOrder(id: string) {
    setSelectedOrders((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const pickRows = useMemo(() => sortPickList(pick), [pick]);
  const pickDigest = useMemo(() => summarizePickList(pickRows), [pickRows]);
  const packingGroups = useMemo(() => groupPackingByZone(packing), [packing]);

  return (
    <div className="px-4 py-4">
      <div className="no-print">
        <AdminPageHeader
          title="Teslimat Günü"
          description="Seçilen günün kutuları ve siparişleri; ürün bazında toplama, müşteri bazında paketleme listesi. Toplu durum ilerletme ve telafi kısayolu burada."
          actions={
            <>
              <button type="button" onClick={() => void load()} disabled={loading} className={cn(btn.secondary, btn.sm)}>
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
                Yenile
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className={cn(btn.outline, btn.sm)}
                title="Etkin sekmedeki listeyi yazdırır (toplama: tek tablo, paketleme: fiş başına sayfa)"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden />
                Yazdır
              </button>
            </>
          }
        />

        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-brand-200 bg-white px-4 py-3">
          <Field label="Teslimat günü" className="w-44">
            {({ id }) => <TextInput id={id} type="date" value={date} onChange={(e) => setParam({ date: e.target.value })} />}
          </Field>
          <Field label="Bölge" className="w-44">
            {({ id }) => (
              <Select id={id} value={zone} onChange={(e) => setParam({ zone: e.target.value })}>
                <option value="">Tüm bölgeler</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.slug}>
                    {z.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="button" className={cn(btn.ghost, btn.sm)} onClick={() => setParam({ date: todayIsoDate() })}>
            Bugün
          </button>
        </div>

        {partialError && (
          <InlineNotice tone="warning" className="mb-3">
            {partialError}
          </InlineNotice>
        )}

        {summary && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Stat label="Kutu" value={summary.cycleCount} />
              <Stat label="Teslimata giren" value={summary.fulfillableCount} />
              <Stat label="Hazırlanıyor" value={summary.cycleCountsByStatus.PREPARING ?? 0} />
              <Stat label="Yolda" value={summary.cycleCountsByStatus.OUT_FOR_DELIVERY ?? 0} />
              <Stat label="Teslim" value={summary.deliveredCount} tone="good" />
              <Stat label="Tekil sipariş" value={summary.standaloneOrderCount} />
            </div>
            <p className="mb-3 text-xs text-brand-500">
              Kutu cirosu {formatTry(summary.revenue)} · tekil sipariş {formatTry(summary.standaloneOrderRevenue)} · kutu içi satır{' '}
              {summary.boxItemCount} · ekstra satır {summary.extraItemCount}
              {summary.boxCountByTier.length > 0 && <> · {summary.boxCountByTier.map((t) => `${t.tierLabel}: ${t.count}`).join(' · ')}</>}
            </p>
            {warnings.length > 0 && (
              <InlineNotice tone="warning" className="mb-3">
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {warnings.map((w) => (
                      <span key={w} className="block">
                        {w}
                      </span>
                    ))}
                  </span>
                </span>
              </InlineNotice>
            )}
          </>
        )}

        {selectedCount > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-light px-4 py-2.5">
            <span className="text-sm font-medium text-accent-dark">{selectedCount} kayıt seçildi</span>
            <Select aria-label="Toplu durum hedefi" value={bulkTarget} className="w-auto py-1 text-xs" onChange={(e) => setBulkTarget(e.target.value)}>
              <option value="">— Durum seçin —</option>
              {bulkOptions.map((o) => (
                <option key={o.status} value={o.status}>
                  {o.label} ({o.total} kayıt)
                </option>
              ))}
            </Select>
            <button type="button" className={cn(btn.primary, btn.sm)} disabled={!bulkTarget || bulkBusy} onClick={() => void applyBulk()}>
              <Truck className="h-3.5 w-3.5" aria-hidden />
              {bulkBusy ? 'Uygulanıyor…' : 'Uygula'}
            </button>
            <button
              type="button"
              className={cn(btn.ghost, btn.sm)}
              onClick={() => {
                setSelectedCycles([]);
                setSelectedOrders([]);
                setBulkTarget('');
              }}
            >
              Seçimi temizle
            </button>
          </div>
        )}
      </div>

      {/* Yazdırma başlığı — yalnız çıktıda */}
      <h1 className="print-only mb-3 text-base font-semibold">{printTitle(tab === 'paketleme' ? 'packing' : 'pick', date, zoneName)}</h1>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : (
        <AdminTabPanel tabs={TABS} activeTab={tab} onTabChange={(k) => setParam({ sekme: k === 'kutular' ? null : k })}>
          {tab === 'kutular' && (
            <CyclesTable
              cycles={cycles}
              selected={selectedCycles}
              onToggle={toggleCycle}
              onToggleAll={() => setSelectedCycles(selectedCycles.length === cycles.length ? [] : cycles.map((c) => c.id))}
              onCompensate={setCompensateCycleId}
            />
          )}

          {tab === 'siparisler' && (
            <OrdersTable
              orders={orders}
              selected={selectedOrders}
              onToggle={toggleOrder}
              onToggleAll={() => setSelectedOrders(selectedOrders.length === orders.length ? [] : orders.map((o) => o.id))}
            />
          )}

          {tab === 'toplama' &&
            (pickRows.length === 0 ? (
              <AdminEmptyState icon={ClipboardList} message="Bu gün için toplanacak ürün yok (ödemesi alınmış kutu bulunamadı)." />
            ) : (
              <>
                <p className="no-print mb-2 text-xs text-brand-500">
                  {pickDigest.products} farklı ürün · kutu {qtyLabel(pickDigest.boxQty, null)} / ekstra {qtyLabel(pickDigest.extraQty, null)} birim ·{' '}
                  {pickDigest.boxes} kutu satırı, {pickDigest.extras} ekstra satırı
                </p>
                <AdminScrollTable>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th className={th}>Ürün</th>
                        <th className={th}>Parti</th>
                        <th className={cn(th, 'text-right')}>Toplam</th>
                        <th className={cn(th, 'text-right')}>Kutu</th>
                        <th className={cn(th, 'text-right')}>Ekstra</th>
                        <th className={th}>Tercihler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickRows.map((r) => (
                        <tr key={r.productId}>
                          <td className={cn(td, 'font-medium text-brand-900')}>
                            {r.productName}
                            {r.labels.length > 0 && <span className="block text-[11px] font-normal text-brand-500">{r.labels.join(' · ')}</span>}
                          </td>
                          <td className={cn(td, 'text-xs')}>{r.lotCode ?? '—'}</td>
                          <td className={cn(td, 'text-right font-semibold')}>{qtyLabel(r.totalQty, r.unit)}</td>
                          <td className={cn(td, 'text-right text-xs')}>
                            {r.boxCount}
                            <span className="block text-brand-400">{qtyLabel(r.boxQty, r.unit)}</span>
                          </td>
                          <td className={cn(td, 'text-right text-xs')}>
                            {r.extraCount}
                            <span className="block text-brand-400">{qtyLabel(r.extraQty, r.unit)}</span>
                          </td>
                          <td className={cn(td, 'text-xs')}>{prefsText(r.prefs) || <span className="text-brand-400">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminScrollTable>
              </>
            ))}

          {tab === 'paketleme' &&
            (packing.length === 0 ? (
              <AdminEmptyState icon={Package} message="Bu gün için paketlenecek kutu yok." />
            ) : (
              <div className="space-y-4">
                {packingGroups.map((group) => (
                  <section key={group.zoneName}>
                    <h3 className="no-print mb-2 text-sm font-semibold text-brand-800">
                      {group.zoneName} ({group.entries.length} kutu)
                    </h3>
                    <div className="space-y-3">
                      {group.entries.map((e) => (
                        <PackingSheet key={e.cycleId} entry={e} onCompensate={() => setCompensateCycleId(e.cycleId)} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ))}
        </AdminTabPanel>
      )}

      <CompensateModal open={!!compensateCycleId} cycleId={compensateCycleId} onClose={() => setCompensateCycleId(null)} onDone={() => void load()} />
    </div>
  );
}

/* ── Alt bileşenler ───────────────────────────────────────────────────── */

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <div className="rounded-md border border-brand-200 bg-white px-3 py-2">
      <span className={cn('block text-lg font-semibold tabular-nums', tone === 'good' ? 'text-olive-deep' : tone === 'bad' ? 'text-accent-dark' : 'text-brand-900')}>{value}</span>
      <span className="block text-[11px] text-brand-600">{label}</span>
    </div>
  );
}

function CyclesTable({
  cycles,
  selected,
  onToggle,
  onToggleAll,
  onCompensate,
}: {
  cycles: AdminCycleListItem[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onCompensate: (cycleId: string) => void;
}) {
  if (cycles.length === 0) return <AdminEmptyState icon={Boxes} message="Bu gün için kutu yok." />;
  return (
    <AdminScrollTable>
      <table className="admin-table">
        <thead>
          <tr>
            <th className={cn(th, 'w-px no-print')}>
              <input
                type="checkbox"
                aria-label="Tümünü seç"
                className="h-4 w-4 rounded border-brand-400 accent-accent"
                checked={selected.length > 0 && selected.length === cycles.length}
                onChange={onToggleAll}
              />
            </th>
            <th className={th}>Müşteri</th>
            <th className={th}>Kutu</th>
            <th className={th}>Bölge</th>
            <th className={th}>Durum</th>
            <th className={th}>Sipariş</th>
            <th className={cn(th, 'text-right')}>Tutar</th>
            <th className={cn(th, 'w-px no-print')}>İşlem</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((c) => (
            <tr key={c.id}>
              <td className={cn(td, 'no-print')}>
                <input
                  type="checkbox"
                  aria-label={`${c.userEmail} kutusunu seç`}
                  className="h-4 w-4 rounded border-brand-400 accent-accent"
                  checked={selected.includes(c.id)}
                  onChange={() => onToggle(c.id)}
                />
              </td>
              <td className={tdText}>
                <Link to={`/abonelikler/${c.subscriptionId}`} className="block font-medium text-brand-900 hover:text-accent">
                  {c.userName ?? c.userEmail}
                </Link>
                <span className="block text-xs text-brand-500">{c.userEmail}</span>
              </td>
              <td className={cn(td, 'text-xs')}>
                <span className="block font-medium text-brand-800">{c.tierSlug}</span>
                <span className="block text-brand-500">
                  #{c.cycleNo}
                  {c.isOneTime ? ' · tek seferlik' : ''}
                </span>
              </td>
              <td className={cn(td, 'text-xs')}>{c.zoneName}</td>
              <td className={td}>
                <CycleStatusBadge status={c.status} />
              </td>
              <td className={cn(td, 'text-xs')}>
                {c.orderNo ? (
                  c.orderId ? (
                    <Link to={`/siparisler/${c.orderId}`} className="text-brand-800 hover:text-accent">
                      #{c.orderNo}
                    </Link>
                  ) : (
                    `#${c.orderNo}`
                  )
                ) : (
                  <span className="text-brand-400">—</span>
                )}
              </td>
              <td className={cn(td, 'text-right')}>{formatTry(c.total ?? c.prepaidAmount)}</td>
              <td className={cn(td, 'no-print')}>
                <button type="button" className={cn(btn.secondary, btn.sm)} onClick={() => onCompensate(c.id)} title="0 ₺ telafi satırı ekle">
                  <Gift className="h-3.5 w-3.5" aria-hidden />
                  Telafi
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminScrollTable>
  );
}

function OrdersTable({
  orders,
  selected,
  onToggle,
  onToggleAll,
}: {
  orders: OrderSummary[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  if (orders.length === 0) return <AdminEmptyState icon={Receipt} message="Bu teslimat gününe bağlı sipariş yok." />;
  return (
    <AdminScrollTable>
      <table className="admin-table">
        <thead>
          <tr>
            <th className={cn(th, 'w-px no-print')}>
              <input
                type="checkbox"
                aria-label="Tümünü seç"
                className="h-4 w-4 rounded border-brand-400 accent-accent"
                checked={selected.length > 0 && selected.length === orders.length}
                onChange={onToggleAll}
              />
            </th>
            <th className={th}>Sipariş</th>
            <th className={th}>Müşteri</th>
            <th className={th}>Tür</th>
            <th className={th}>Durum</th>
            <th className={cn(th, 'text-right')}>Tutar</th>
            <th className={th}>Ödeme</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className={cn(td, 'no-print')}>
                <input
                  type="checkbox"
                  aria-label={`#${o.orderNo} siparişini seç`}
                  className="h-4 w-4 rounded border-brand-400 accent-accent"
                  checked={selected.includes(o.id)}
                  onChange={() => onToggle(o.id)}
                />
              </td>
              <td className={td}>
                <Link to={`/siparisler/${o.id}`} className="font-semibold text-brand-900 hover:text-accent">
                  #{o.orderNo}
                </Link>
              </td>
              <td className={tdText}>
                <span className="block font-medium text-brand-900">{o.customerName ?? '—'}</span>
                {o.customerEmail && <span className="block text-xs text-brand-500">{o.customerEmail}</span>}
              </td>
              <td className={td}>
                <OrderKindBadge kind={o.kind} />
              </td>
              <td className={td}>
                <OrderStatusBadge status={o.status} />
              </td>
              <td className={cn(td, 'text-right')}>{formatTry(o.grandTotal)}</td>
              <td className={cn(td, 'text-xs')}>{o.paidAt ? formatDateTime(o.paidAt) : <span className="text-brand-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminScrollTable>
  );
}

/** Tek kutu fişi — çıktıda her fiş yeni sayfaya gider (`.print-sheet`). */
function PackingSheet({ entry, onCompensate }: { entry: PackingListEntry; onCompensate: () => void }) {
  return (
    <article className="print-sheet rounded-lg border border-brand-200 bg-white p-4">
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2 border-b border-brand-200 pb-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-brand-900">{entry.customerName}</h4>
          <p className="text-xs text-brand-600">
            {entry.customerPhone} · {entry.addressLine}
            {entry.addressZip ? ` (${entry.addressZip})` : ''}
          </p>
          <p className="text-[11px] text-brand-500">
            {entry.zoneName} · {entry.tierLabel || entry.tierSlug} · teslimat {formatDate(entry.deliveryOn)}
            {entry.orderNo ? ` · sipariş #${entry.orderNo}` : ''}
            {entry.isOneTime ? ' · tek seferlik' : ''}
            {entry.cycleNo ? ` · kutu #${entry.cycleNo}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CycleStatusBadge status={entry.status} />
          <button type="button" className={cn(btn.secondary, btn.sm, 'no-print')} onClick={onCompensate} title="0 ₺ telafi satırı ekle">
            <Gift className="h-3.5 w-3.5" aria-hidden />
            Telafi
          </button>
        </div>
      </header>
      <ol className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {entry.items.map((item, i) => (
          <li key={`${entry.cycleId}-${item.productId}-${i}`} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs text-brand-400">{i + 1}.</span>
            <CycleItemSourceBadge source={item.source} className="no-print" />
            <span className="min-w-0 flex-1 text-brand-800">{packingItemText(item)}</span>
            {item.lotCode && <span className="shrink-0 text-[11px] text-brand-400">{item.lotCode}</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 border-t border-brand-100 pt-2 text-xs text-brand-600">
        {entry.boxItemCount} kutu satırı · {entry.extraItemCount} ekstra
        {entry.curatorName ? ` · küratör: ${entry.curatorName}` : ''}
        {entry.total !== null ? ` · ${formatTry(entry.total)}` : ''}
      </p>
      {Object.keys(entry.itemPrefs).length > 0 && (
        <p className="mt-1 text-xs text-brand-600">
          Kalıcı tercihler:{' '}
          {Object.entries(entry.itemPrefs)
            .map(([slug, pref]) => `${slug}: ${pref}`)
            .join(' · ')}
        </p>
      )}
      {entry.note && <p className="mt-1 text-xs font-medium text-accent-dark">Not: {entry.note}</p>}
      {entry.adminNote && <p className="mt-1 text-xs text-brand-700">Ops notu: {entry.adminNote}</p>}
    </article>
  );
}
