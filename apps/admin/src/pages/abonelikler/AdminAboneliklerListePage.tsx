import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUS_VALUES, type SubscriptionStatus } from '@bagdam/shared';
import { Eye, Repeat, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Select } from '../../components/ui/FormField';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { subscriptionsAdminApi } from '../../features/abonelikler/api';
import { SubscriptionKindBadge, SubscriptionStatusBadge } from '../../features/abonelikler/SubscriptionBadges';
import {
  applyClientFilter,
  deliveryDayLabel,
  filterFromParams,
  frequencyLabel,
  hasActiveFilter,
  toSubscriptionsQuery,
  type SubscriptionsFilterState,
} from '../../features/abonelikler/subscriptions';
import { errorMessage } from '../../lib/api';
import type { SubscriptionListItem } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { cn, formatDate, formatDateTime } from '../../lib/utils';

const LIMIT_DEFAULT = 25;

/** Hızlı durum filtreleri (PAUSED P2 — listede yalnız tam durum seçicide görünür). */
const QUICK_STATUS: ReadonlyArray<{ key: SubscriptionStatus | ''; label: string }> = [
  { key: '', label: 'Tümü' },
  { key: 'ACTIVE', label: SUBSCRIPTION_STATUS_LABELS.ACTIVE },
  { key: 'PAST_DUE', label: SUBSCRIPTION_STATUS_LABELS.PAST_DUE },
  { key: 'CANCEL_REQUESTED', label: SUBSCRIPTION_STATUS_LABELS.CANCEL_REQUESTED },
  { key: 'COMPLETED', label: SUBSCRIPTION_STATUS_LABELS.COMPLETED },
  { key: 'CANCELLED', label: SUBSCRIPTION_STATUS_LABELS.CANCELLED },
];

const KIND_OPTIONS: ReadonlyArray<{ key: SubscriptionsFilterState['kind']; label: string }> = [
  { key: '', label: 'Tümü' },
  { key: 'subscription', label: 'Abonelik' },
  { key: 'onetime', label: 'Tek seferlik' },
];

/**
 * Ekran 19 — Abonelikler listesi (F9). Tek seferlik kutular da burada (isOneTime, ADR-0008 [B2]).
 * Sütunlar: müşteri · durum · tür · tier · sıklık · gün · sonraki teslimat · dunning (failedCycles).
 * Filtreler URL'de: `?status&q&kind&dunning&page&limit`; `kind` ve `dunning` istemci süzgecidir
 * (uçta parametreleri yok — `GET /admin/subscriptions?status&q&page&limit`).
 */
export function AdminAboneliklerListePage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const filter = filterFromParams(params);

  const [items, setItems] = useState<SubscriptionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setParam = useCallback(
    (patch: Record<string, string | number | boolean | null | undefined>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || v === false || (k === 'page' && v === 1) || (k === 'limit' && v === LIMIT_DEFAULT)) next.delete(k);
        else next.set(k, v === true ? '1' : String(v));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const queryKey = JSON.stringify(toSubscriptionsQuery(filter, page, limit));
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await subscriptionsAdminApi.list(JSON.parse(queryKey));
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'Abonelikler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = useCallback((v: string) => setParam({ q: v, page: 1 }), [setParam]);
  const rows = applyClientFilter(items, filter);
  const active = hasActiveFilter(filter);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Abonelikler"
        description="Kutu abonelikleri ve tek seferlik kutular (isOneTime). Detayda cycle geçmişi, olay günlüğü, iptal kayıtları, düzenleme ve telafi."
      />

      <AdminToolbar
        className="mb-3"
        searchPlaceholder="Ad, e-posta ya da abonelik no ara…"
        searchValue={filter.q}
        onSearchChange={onSearch}
        filters={
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <FilterPills
                options={QUICK_STATUS}
                value={QUICK_STATUS.some((o) => o.key === filter.status) ? filter.status : ''}
                onChange={(v) => setParam({ status: v, page: 1 })}
                label="Durum"
              />
              <label className="flex items-center gap-1.5 text-xs text-brand-600">
                <span className="sr-only">Durum seç</span>
                <Select aria-label="Durum seç" value={filter.status} className="w-auto py-1 text-xs" onChange={(e) => setParam({ status: e.target.value, page: 1 })}>
                  <option value="">— Tüm durumlar —</option>
                  {SUBSCRIPTION_STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {SUBSCRIPTION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <FilterPills options={KIND_OPTIONS} value={filter.kind} onChange={(v) => setParam({ kind: v, page: 1 })} label="Tür" />
              <label className="flex items-center gap-1.5 text-xs text-brand-600">
                <input type="checkbox" className="h-4 w-4 rounded border-brand-400 accent-accent" checked={filter.dunning} onChange={(e) => setParam({ dunning: e.target.checked, page: 1 })} />
                Yalnız tahsilat sorunu olanlar
              </label>
              {active && (
                <button type="button" onClick={() => setParam({ status: '', q: '', kind: '', dunning: false, page: 1 })} className={cn(btn.ghost, btn.sm)}>
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
      ) : rows.length === 0 ? (
        <AdminEmptyState icon={Repeat} message={active ? 'Filtreye uyan abonelik yok.' : 'Henüz abonelik yok.'} />
      ) : (
        <AdminScrollTable
          footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Müşteri</th>
                <th className={th}>Durum</th>
                <th className={th}>Tür</th>
                <th className={th}>Kutu</th>
                <th className={th}>Sıklık</th>
                <th className={th}>Gün</th>
                <th className={th}>Bölge</th>
                <th className={th}>Sonraki teslimat</th>
                <th className={th}>Tahsilat</th>
                <th className={th}>Başlangıç</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={cn((s.status === 'CANCELLED' || s.status === 'COMPLETED') && 'bg-brand-50/60 text-brand-500')}>
                  <td className={tdText}>
                    <Link to={`/abonelikler/${s.id}`} className="block font-medium text-brand-900 hover:text-accent">
                      {s.userName ?? s.userEmail}
                    </Link>
                    <span className="block text-xs text-brand-500">{s.userEmail}</span>
                  </td>
                  <td className={td}>
                    <SubscriptionStatusBadge status={s.status} />
                  </td>
                  <td className={td}>
                    <SubscriptionKindBadge isOneTime={s.isOneTime} />
                  </td>
                  <td className={cn(td, 'text-xs font-medium text-brand-800')}>{s.tierSlug}</td>
                  <td className={cn(td, 'text-xs')}>{frequencyLabel(s.frequencyWeeks, s.isOneTime)}</td>
                  <td className={cn(td, 'text-xs')}>{deliveryDayLabel(s.deliveryDay)}</td>
                  <td className={cn(td, 'text-xs')}>{s.zoneName}</td>
                  <td className={cn(td, 'text-xs')}>{s.nextDeliveryOn ? formatDate(s.nextDeliveryOn) : <span className="text-brand-400">—</span>}</td>
                  <td className={cn(td, 'text-xs')}>
                    {s.failedCycles > 0 ? (
                      <span className="font-semibold text-accent-dark">{s.failedCycles} ardışık hata</span>
                    ) : (
                      <span className="text-olive-deep">sorunsuz</span>
                    )}
                  </td>
                  <td className={cn(td, 'text-xs')}>{s.startedAt ? formatDateTime(s.startedAt) : '—'}</td>
                  <td className={td}>
                    <Link to={`/abonelikler/${s.id}`} className={btn.icon} aria-label={`${s.userEmail} abonelik detayı`} title="Detay">
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminScrollTable>
      )}

      {!loading && !error && rows.length < items.length && (
        <p className="mt-2 text-[11px] text-brand-400">
          {items.length - rows.length} satır istemci süzgeciyle gizlendi (tür / tahsilat sorunu); sayfalama sunucu toplamına göredir.
        </p>
      )}
    </div>
  );
}
