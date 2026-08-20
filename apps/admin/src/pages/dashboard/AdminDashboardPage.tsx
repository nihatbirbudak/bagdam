import { Activity, Boxes, CheckCircle2, Gift, History, ImageIcon, Package, Receipt, RefreshCw, Tractor, XCircle, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useApi } from '../../hooks/useApi';
import { API_BASE, api, errorMessage } from '../../lib/api';
import type { AdminAuditLog } from '../../lib/adminTypes';
import type { HealthResponse, Paginated } from '../../lib/apiTypes';
import { boxTemplatesApi, producersApi } from '../../features/catalog/api';
import { ordersApi } from '../../features/siparisler/api';
import { summarizeOrders, todayIsoDate, type OrdersDigest } from '../../features/siparisler/orders';
import { CURRENT_PHASE } from '../../lib/phases';
import { cn, formatDateTime, formatTry } from '../../lib/utils';
import { addDays, currentWeekStart } from '../../lib/week';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';

interface Counts {
  products: number | null;
  producers: number | null;
  templates: number | null;
  media: number | null;
}

function Card({ title, icon: Icon, children, className }: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-brand-200 bg-white', className)}>
      <header className="flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
        <Icon className="h-4 w-4 text-brand-500" aria-hidden />
        <h2 className="text-sm font-semibold text-brand-800">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatTile({ label, value, to, icon: Icon, hint }: { label: string; value: number | null; to: string; icon: LucideIcon; hint?: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-brand-200 bg-white p-4 transition-colors hover:border-accent"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tabular-nums text-brand-900">{value === null ? '—' : value}</span>
        <span className="block text-xs text-brand-600">{label}</span>
        {hint && <span className="block text-[10px] text-brand-400">{hint}</span>}
      </span>
    </Link>
  );
}

interface TodayState {
  day: string;
  /** Bugün oluşturulan sipariş sayısı (sunucu total). */
  total: number;
  /** Bugünün ilk 100 siparişinden türetilen özet (ciro = ödenmiş siparişler). */
  digest: OrdersDigest;
  /** Tüm zamanlar ödeme başarısız (PAYMENT_FAILED) — ekran 18 F9'a kadar buradan izlenir. */
  failedTotal: number | null;
}

function MiniStat({ label, value, to, tone = 'neutral' }: { label: string; value: string | number; to: string; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <Link to={to} className="block rounded-md border border-brand-200 bg-brand-50/60 px-3 py-2 transition-colors hover:border-accent">
      <span className={cn('block text-lg font-semibold tabular-nums', tone === 'good' ? 'text-olive-deep' : tone === 'bad' ? 'text-accent-dark' : 'text-brand-900')}>{value}</span>
      <span className="block text-[11px] text-brand-600">{label}</span>
    </Link>
  );
}

/**
 * F8 — Bugünkü sipariş / ciro kartı: `GET /admin/orders?from=bugün&to=bugün` (Europe/Istanbul takvim günü) → sayı (total) +
 * ilk 100 satırdan ciro/bekleyen; `status=PAYMENT_FAILED` toplamı ayrı. Tıklanınca Siparişler filtreli açılır.
 */
function TodayOrdersCard({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<TodayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const day = todayIsoDate();
    (async () => {
      const [today, failed] = await Promise.allSettled([
        ordersApi.list({ from: day, to: day, page: 1, limit: 100 }),
        ordersApi.list({ status: 'PAYMENT_FAILED', page: 1, limit: 1 }),
      ]);
      if (cancelled) return;
      if (today.status === 'fulfilled') {
        setState({
          day,
          total: today.value.total,
          digest: summarizeOrders(today.value.items),
          failedTotal: failed.status === 'fulfilled' ? failed.value.total : null,
        });
      } else {
        setState(null);
        setError(errorMessage(today.reason, 'Sipariş özeti alınamadı'));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const dayQuery = state ? `?from=${state.day}&to=${state.day}` : '';
  return (
    <Card title="Bugün — sipariş ve ciro" icon={Receipt} className="mb-4">
      {loading ? (
        <p className="text-xs text-brand-500">Yükleniyor…</p>
      ) : error || !state ? (
        <p className="text-xs text-accent-dark" role="alert">
          {error ?? 'Sipariş özeti alınamadı'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Bugünkü sipariş" value={state.total} to={`/siparisler${dayQuery}`} />
          <MiniStat label={`Bugünkü ciro (ödenmiş ${state.digest.paidCount})`} value={formatTry(state.digest.revenue)} to={`/siparisler${dayQuery}&status=PAID`} tone="good" />
          <MiniStat label="Ödeme bekleyen (bugün)" value={state.digest.pendingCount} to={`/siparisler${dayQuery}&status=PENDING_PAYMENT`} />
          <MiniStat label="Ödeme başarısız (tümü)" value={state.failedTotal === null ? '—' : state.failedTotal} to="/siparisler?status=PAYMENT_FAILED" tone={state.failedTotal ? 'bad' : 'neutral'} />
        </div>
      )}
      {state && state.total > 100 && <p className="mt-2 text-[11px] text-brand-400">Ciro ilk 100 siparişten hesaplandı (toplam {state.total}); tam döküm için CSV dışa aktarım.</p>}
    </Card>
  );
}

/** Özet (F4 sürümü): sayılar (GET uçlarının total'ı) + API sağlığı + son audit satırları (ADMIN). */
export function AdminDashboardPage() {
  const { user, isAdmin } = useAdminAuth();
  const health = useApi<HealthResponse>('/health');
  const [counts, setCounts] = useState<Counts>({ products: null, producers: null, templates: null, media: null });
  const [countsError, setCountsError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AdminAuditLog[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadCounts = useCallback(async () => {
    setCountsError(null);
    const week = currentWeekStart();
    const results = await Promise.allSettled([
      api.get<Paginated<unknown>>('/admin/products?page=1&limit=1'),
      producersApi.list(),
      boxTemplatesApi.list({ from: week, to: addDays(week, 6) }),
      api.get<Paginated<unknown>>('/admin/media?page=1&limit=1'),
    ]);
    const [p, pr, t, m] = results;
    setCounts({
      products: p.status === 'fulfilled' ? p.value.total : null,
      producers: pr.status === 'fulfilled' ? pr.value.length : null,
      templates: t.status === 'fulfilled' ? t.value.length : null,
      media: m.status === 'fulfilled' ? m.value.total : null,
    });
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) setCountsError(errorMessage(failed.reason, 'Sayılar alınamadı'));
  }, []);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api
      .get<Paginated<AdminAuditLog>>('/admin/audit-logs?page=1&limit=8')
      .then((res) => {
        if (!cancelled) setAudit(res.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setAudit([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const weekLabel = currentWeekStart();

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Özet"
        description={
          <>
            Hoş geldiniz{user?.name ? `, ${user.name}` : ''}. Faz <strong>{CURRENT_PHASE}</strong>: katalog, içerik, müşteriler, siparişler ve kuponlar açık;
            abonelik/ops göstergeleri F9'da.
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => {
              void loadCounts();
              health.refetch();
              setRefreshKey((k) => k + 1);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 hover:border-accent hover:text-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Yenile
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Ürün" value={counts.products} to="/katalog/urunler" icon={Package} />
        <StatTile label="Üretici" value={counts.producers} to="/katalog/ureticiler" icon={Tractor} />
        <StatTile label="Bu haftanın şablonu" value={counts.templates} to="/katalog/haftanin-kutusu" icon={Gift} hint={`hafta: ${weekLabel}`} />
        <StatTile label="Medya dosyası" value={counts.media} to="/medya" icon={ImageIcon} />
      </div>
      {countsError && (
        <p className="mb-4 text-xs text-accent-dark" role="alert">
          Bazı sayılar alınamadı: {countsError}
        </p>
      )}

      <TodayOrdersCard refreshKey={refreshKey} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="API sağlığı" icon={Activity}>
          <div className="flex items-start gap-3">
            {health.loading ? (
              <RefreshCw className="mt-0.5 h-5 w-5 animate-spin text-brand-400" aria-hidden />
            ) : health.error ? (
              <XCircle className="mt-0.5 h-5 w-5 text-accent-dark" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-olive" aria-hidden />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-brand-900">
                <code className="rounded bg-brand-100 px-1.5 py-0.5 font-mono text-xs">GET {API_BASE}/health</code>
              </p>
              {health.loading && <p className="mt-1 text-brand-500">Kontrol ediliyor…</p>}
              {health.error && <p className="mt-1 text-accent-dark">Ulaşılamadı: {health.error}</p>}
              {health.data && (
                <p className="mt-1 text-brand-600">
                  Durum: <span className="font-semibold text-olive-deep">{String(health.data.status)}</span>
                  {health.data.db ? ` · db: ${String(health.data.db)}` : ''}
                  {health.data.version ? ` · v${health.data.version}` : ''}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Hızlı erişim" icon={Boxes}>
          <ul className="grid grid-cols-1 gap-1 text-sm">
            {[
              { to: '/siparisler', label: 'Siparişler' },
              { to: '/kuponlar', label: 'Kuponlar' },
              { to: '/katalog/urunler/yeni', label: 'Yeni ürün ekle' },
              { to: '/katalog/haftanin-kutusu', label: 'Haftanın kutusunu düzenle' },
              { to: '/medya', label: 'Görsel yükle' },
              { to: '/katalog/kutular', label: 'Kutu boyları ve fiyatlar' },
            ].map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="block rounded-md px-2 py-1.5 text-brand-700 transition-colors hover:bg-brand-50 hover:text-accent">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Son değişiklikler" icon={History}>
          {!isAdmin ? (
            <p className="text-xs text-brand-500">Denetim kaydı yalnız ADMIN rolüne gösterilir.</p>
          ) : audit === null ? (
            <p className="text-xs text-brand-500">Yükleniyor…</p>
          ) : audit.length === 0 ? (
            <p className="text-xs text-brand-500">Henüz kayıt yok.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {audit.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-brand-100 px-1 font-mono text-[10px] text-brand-600">{a.action}</span>
                  <span className="min-w-0 flex-1 truncate text-brand-700" title={a.summary ?? ''}>
                    <span className="font-medium">{a.module}</span>
                    {a.summary ? ` · ${a.summary}` : a.entityId ? ` · ${a.entityId}` : ''}
                  </span>
                  <span className="shrink-0 text-brand-400">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
