import { DELIVERY_DAY_LABELS, ORDER_KIND_LABELS, ORDER_KIND_VALUES, ORDER_STATUS_LABELS, ORDER_STATUS_VALUES, type DeliveryDay, type OrderKind, type OrderStatus } from '@bagdam/shared';
import { Download, Eye, Receipt, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Select, TextInput } from '../../components/ui/FormField';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { downloadBlob, ordersApi } from '../../features/siparisler/api';
import { OrderKindBadge, OrderStatusBadge } from '../../features/siparisler/OrderBadges';
import { csvFileName, filterFromParams, hasActiveFilter, toOrdersQuery, type OrdersFilterState } from '../../features/siparisler/orders';
import { errorMessage } from '../../lib/api';
import type { OrderSummary } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime, formatTry } from '../../lib/utils';

const LIMIT_DEFAULT = 25;
type KindFilter = '' | OrderKind;
const KIND_OPTIONS: ReadonlyArray<{ key: KindFilter; label: string }> = [
  { key: '', label: 'Tümü' },
  ...ORDER_KIND_VALUES.map((k) => ({ key: k as KindFilter, label: ORDER_KIND_LABELS[k] })),
];

/** Hızlı filtreler (ops): ödeme problemleri = PAYMENT_FAILED (ekran 18 F9'da; burada yalnız filtre). */
const QUICK_STATUS: ReadonlyArray<{ key: OrderStatus | ''; label: string }> = [
  { key: '', label: 'Tümü' },
  { key: 'PENDING_PAYMENT', label: ORDER_STATUS_LABELS.PENDING_PAYMENT },
  { key: 'PAID', label: ORDER_STATUS_LABELS.PAID },
  { key: 'PREPARING', label: ORDER_STATUS_LABELS.PREPARING },
  { key: 'OUT_FOR_DELIVERY', label: ORDER_STATUS_LABELS.OUT_FOR_DELIVERY },
  { key: 'PAYMENT_FAILED', label: 'Ödeme problemi' },
];

function deliveryDayLabel(day: string): string {
  return (DELIVERY_DAY_LABELS as Record<string, string>)[day as DeliveryDay] ?? day;
}

/**
 * Ekran 17 — Siparişler listesi: durum / tür / tarih (oluşturma from–to, teslimat günü) / arama (#no, ad, e-posta, telefon),
 * sayfalama, CSV dışa aktarım (aynı filtre). Satır → detay. Filtreler URL'de (`?status&kind&from&to&deliveryOn&q&page&limit`).
 */
export function AdminSiparislerListePage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const filter = filterFromParams(params);

  const [items, setItems] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const setParam = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || (k === 'page' && v === 1) || (k === 'limit' && v === LIMIT_DEFAULT)) next.delete(k);
        else next.set(k, String(v));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const queryKey = JSON.stringify(toOrdersQuery(filter, page, limit));
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list(JSON.parse(queryKey));
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'Siparişler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = useCallback((v: string) => setParam({ q: v, page: 1 }), [setParam]);

  function setFilter(patch: Partial<OrdersFilterState>) {
    setParam({ ...patch, page: 1 });
  }

  function clearFilters() {
    setParam({ status: '', kind: '', from: '', to: '', deliveryOn: '', q: '', page: 1 });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await ordersApi.exportCsv(toOrdersQuery(filter));
      downloadBlob(blob, csvFileName(filter));
      toast.success('CSV indirildi');
    } catch (e) {
      toast.error(errorMessage(e, 'CSV dışa aktarılamadı'));
    } finally {
      setExporting(false);
    }
  }

  const active = hasActiveFilter(filter);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Siparişler"
        description="Tekil ürün, tek seferlik kutu ve abonelik siparişleri (ödeme sonrası snapshot). Durum geçişleri, iade, fatura ve notlar detay sayfasında; CSV dışa aktarım geçerli filtreyle."
        actions={
          <button type="button" onClick={() => void exportCsv()} disabled={exporting || loading} className={btn.secondary}>
            <Download className="h-4 w-4" aria-hidden />
            {exporting ? 'Hazırlanıyor…' : 'CSV dışa aktar'}
          </button>
        }
      />

      <AdminToolbar
        className="mb-3"
        searchPlaceholder="Sipariş no (#1001), ad, e-posta ya da telefon ara…"
        searchValue={filter.q}
        onSearchChange={onSearch}
        filters={
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <FilterPills options={QUICK_STATUS} value={QUICK_STATUS.some((o) => o.key === filter.status) ? filter.status : ''} onChange={(v) => setFilter({ status: v })} label="Durum" />
              <label className="flex items-center gap-1.5 text-xs text-brand-600">
                <span className="sr-only">Durum (tümü)</span>
                <Select aria-label="Durum seç" value={filter.status} className="w-auto py-1 text-xs" onChange={(e) => setFilter({ status: e.target.value as OrderStatus | '' })}>
                  <option value="">— Tüm durumlar —</option>
                  {ORDER_STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <FilterPills options={KIND_OPTIONS} value={filter.kind} onChange={(v) => setFilter({ kind: v })} label="Tür" />
              <label className="flex items-center gap-1.5 text-xs text-brand-600">
                Oluşturma
                <TextInput type="date" aria-label="Başlangıç tarihi" value={filter.from} max={filter.to || undefined} className="w-auto py-1 text-xs" onChange={(e) => setFilter({ from: e.target.value })} />
                –
                <TextInput type="date" aria-label="Bitiş tarihi" value={filter.to} min={filter.from || undefined} className="w-auto py-1 text-xs" onChange={(e) => setFilter({ to: e.target.value })} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-brand-600">
                Teslimat günü
                <TextInput type="date" aria-label="Teslimat günü" value={filter.deliveryOn} className="w-auto py-1 text-xs" onChange={(e) => setFilter({ deliveryOn: e.target.value })} />
              </label>
              {active && (
                <button type="button" onClick={clearFilters} className={cn(btn.ghost, btn.sm)}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Filtreleri temizle
                </button>
              )}
            </div>
          </div>
        }
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Receipt} message={active ? 'Filtreye uyan sipariş yok.' : 'Henüz sipariş yok.'} />
      ) : (
        <AdminScrollTable footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Sipariş</th>
                <th className={th}>Müşteri</th>
                <th className={th}>Tür</th>
                <th className={th}>Durum</th>
                <th className={th}>Teslimat</th>
                <th className={cn(th, 'text-right')}>Tutar</th>
                <th className={th}>Satır</th>
                <th className={th}>Ödeme</th>
                <th className={th}>Oluşturma</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className={cn((o.status === 'CANCELLED' || o.status === 'REFUNDED') && 'bg-brand-50/60 text-brand-500')}>
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
                  <td className={cn(td, 'text-xs')}>
                    <span className="block">{deliveryDayLabel(o.deliveryDay)}</span>
                    <span className="text-brand-500">{formatDate(o.deliveryOn)}</span>
                  </td>
                  <td className={cn(td, 'text-right font-medium')}>{formatTry(o.grandTotal)}</td>
                  <td className={td}>{o.lineCount}</td>
                  <td className={cn(td, 'text-xs')}>{o.paidAt ? formatDateTime(o.paidAt) : <span className="text-brand-400">—</span>}</td>
                  <td className={cn(td, 'text-xs')}>{formatDateTime(o.createdAt)}</td>
                  <td className={td}>
                    <Link to={`/siparisler/${o.id}`} className={btn.icon} aria-label={`#${o.orderNo} detay`} title="Detay">
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminScrollTable>
      )}
    </div>
  );
}
