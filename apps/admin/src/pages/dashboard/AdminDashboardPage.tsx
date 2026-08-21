import { Activity, AlertTriangle, Boxes, CalendarClock, CheckCircle2, CreditCard, Gift, History, ImageIcon, Package, Receipt, RefreshCw, Repeat, Tractor, XCircle, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useApi } from '../../hooks/useApi';
import { API_BASE, api, errorMessage } from '../../lib/api';
import type { AdminAuditLog } from '../../lib/adminTypes';
import type { AdminDashboard, HealthResponse, Paginated } from '../../lib/apiTypes';
import { boxTemplatesApi, producersApi } from '../../features/catalog/api';
import { dashboardApi } from '../../features/dashboard/api';
import { cutoffStateText, cutoffTone, dayQuery, summarizeCutoff, weekQuery, weekdayLabel } from '../../features/dashboard/dashboard';
import { subEventLabel } from '../../features/abonelikler/subscriptions';
import { CURRENT_PHASE } from '../../lib/phases';
import { cn, formatDate, formatDateTime, formatTry } from '../../lib/utils';
import { addDays, currentWeekStart } from '../../lib/week';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';

interface Counts {
  products: number | null;
  producers: number | null;
  templates: number | null;
  media: number | null;
}

function Card({ title, icon: Icon, children, className, actions }: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-brand-200 bg-white', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-brand-500" aria-hidden />
          <h2 className="text-sm font-semibold text-brand-800">{title}</h2>
        </span>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatTile({ label, value, to, icon: Icon, hint }: { label: string; value: number | null; to: string; icon: LucideIcon; hint?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg border border-brand-200 bg-white p-4 transition-colors hover:border-accent">
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

function MiniStat({ label, value, to, tone = 'neutral' }: { label: string; value: string | number; to: string; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <Link to={to} className="block rounded-md border border-brand-200 bg-brand-50/60 px-3 py-2 transition-colors hover:border-accent">
      <span className={cn('block text-lg font-semibold tabular-nums', tone === 'good' ? 'text-olive-deep' : tone === 'bad' ? 'text-accent-dark' : 'text-brand-900')}>{value}</span>
      <span className="block text-[11px] text-brand-600">{label}</span>
    </Link>
  );
}

/**
 * Ekran 21 — Özet (F9): bugünkü ve haftalık sipariş + ciro, aktif abonelik sayıları, bu haftanın kesim
 * durumu (teslimat tarihleri), ödeme problemleri sayacı ve son abonelik olayları. Veri `GET /admin/dashboard`
 * ucundan gelir (F9/C DashboardModule); tüm metrikler sunucuda türetilir.
 * Alt bölümde F4'ten gelen katalog sayaçları, API sağlığı ve son denetim kayıtları korunur.
 */
export function AdminDashboardPage() {
  const { user, isAdmin } = useAdminAuth();
  const health = useApi<HealthResponse>('/health');
  const [counts, setCounts] = useState<Counts>({ products: null, producers: null, templates: null, media: null });
  const [countsError, setCountsError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AdminAuditLog[] | null>(null);
  const [summary, setSummary] = useState<AdminDashboard | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
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
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(null);
    dashboardApi
      .summary()
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((e) => {
        if (!cancelled) setSummaryError(errorMessage(e, 'Özet alınamadı'));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

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
  const cutoffDigest = summary ? summarizeCutoff(summary.cutoffs) : null;

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Özet"
        description={
          <>
            Hoş geldiniz{user?.name ? `, ${user.name}` : ''}. Faz <strong>{CURRENT_PHASE}</strong>: sipariş, abonelik ve operasyon
            göstergeleri açık; günlük işi Teslimat Günü ekranından yürütebilirsiniz.
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

      <Card
        title="Bugün ve bu hafta — sipariş, ciro"
        icon={Receipt}
        className="mb-4"
        actions={summary ? <span className="text-[11px] text-brand-400">{formatDate(summary.today)} · sunucu saati {formatDateTime(summary.serverNowIso)}</span> : null}
      >
        {summaryLoading ? (
          <p className="text-xs text-brand-500">Yükleniyor…</p>
        ) : summaryError || !summary ? (
          <p className="text-xs text-accent-dark" role="alert">
            {summaryError ?? 'Özet alınamadı'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Bugünkü sipariş" value={summary.orders.todayCount} to={`/siparisler${dayQuery(summary.today)}`} />
              <MiniStat label="Bugünkü ciro" value={formatTry(summary.orders.todayRevenue)} to={`/siparisler${dayQuery(summary.today)}&status=PAID`} tone="good" />
              <MiniStat label="Haftalık sipariş" value={summary.orders.weekCount} to={`/siparisler${weekQuery(summary.weekStart)}`} />
              <MiniStat label="Haftalık ciro" value={formatTry(summary.orders.weekRevenue)} to={`/siparisler${weekQuery(summary.weekStart)}&status=PAID`} tone="good" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
              <MiniStat label="Ödeme bekleyen sipariş" value={summary.orders.pendingPaymentCount} to="/siparisler?status=PENDING_PAYMENT" />
              <MiniStat label="Bugün teslim edilecek" value={summary.orders.deliveringTodayCount} to={`/operasyon/teslimat-gunu?date=${summary.today}`} />
            </div>
          </>
        )}
      </Card>

      {summary && (
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Abonelikler" icon={Repeat}>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Aktif" value={summary.subscriptions.active} to="/abonelikler?status=ACTIVE" tone="good" />
              <MiniStat
                label="Ödeme gecikmiş"
                value={summary.subscriptions.pastDue}
                to="/abonelikler?status=PAST_DUE"
                tone={summary.subscriptions.pastDue ? 'bad' : 'neutral'}
              />
              <MiniStat label="İptal talebi" value={summary.subscriptions.cancelRequested} to="/abonelikler?status=CANCEL_REQUESTED" />
              <MiniStat label="Tek seferlik (aktif)" value={summary.subscriptions.oneTimeActive} to="/abonelikler?kind=onetime" />
            </div>
            <p className="mt-2 text-[11px] text-brand-500">
              Bu hafta başlayan {summary.subscriptions.newThisWeek} · ödeme bekleyen {summary.subscriptions.pending}
            </p>
          </Card>

          <Card
            title="Ödeme problemleri"
            icon={CreditCard}
            actions={
              summary.paymentIssues.total > 0 ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-dark">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  ilgi gerekiyor
                </span>
              ) : null
            }
          >
            <div className="grid grid-cols-3 gap-3">
              <MiniStat
                label="Tahsil edilemeyen kutu"
                value={summary.paymentIssues.unpaidCycles}
                to="/odeme-problemleri?kind=CYCLE"
                tone={summary.paymentIssues.unpaidCycles ? 'bad' : 'neutral'}
              />
              <MiniStat label="Ödeme linki bekleyen" value={summary.paymentIssues.awaitingPaymentCycles} to="/odeme-problemleri?kind=CYCLE" />
              <MiniStat
                label="Başarısız sipariş"
                value={summary.paymentIssues.failedOrders}
                to="/odeme-problemleri?kind=ORDER"
                tone={summary.paymentIssues.failedOrders ? 'bad' : 'neutral'}
              />
            </div>
          </Card>

          <Card
            title="Bu haftanın kesim durumu"
            icon={CalendarClock}
            actions={cutoffDigest ? <span className="text-[11px] text-brand-500">{cutoffDigest.open} açık · {cutoffDigest.locked} kilitli</span> : null}
          >
            {summary.cutoffs.length === 0 ? (
              <p className="text-xs text-brand-500">Bu hafta için teslimat tarihi yok.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {summary.cutoffs.slice(0, 8).map((c) => {
                  const tone = cutoffTone(c);
                  return (
                    <li key={`${c.date}-${c.zoneSlug}`} className="flex items-center justify-between gap-2 border-b border-brand-100 pb-1 last:border-0">
                      <Link to={`/operasyon/teslimat-gunu?date=${c.date}&zone=${c.zoneSlug}`} className="min-w-0 truncate text-brand-700 hover:text-accent">
                        <strong className="text-brand-900">{weekdayLabel(c.date)}</strong> {formatDate(c.date)} · {c.zoneName}
                        {c.cycleCount ? ` (${c.cycleCount} kutu)` : ''}
                      </Link>
                      <span className={cn('shrink-0 font-medium', tone === 'muted' ? 'text-brand-400' : tone === 'bad' ? 'text-accent-dark' : 'text-olive-deep')}>
                        {cutoffStateText(c)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link to="/ayarlar/teslimat-tarihleri" className="mt-2 inline-block text-xs text-accent hover:underline">
              Teslimat tarihlerini yönet →
            </Link>
          </Card>
        </div>
      )}

      {summary && summary.recentEvents.length > 0 && (
        <Card title="Son abonelik olayları" icon={History} className="mb-4">
          <ul className="space-y-1.5 text-xs">
            {summary.recentEvents.slice(0, 10).map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-brand-100 px-1 font-mono text-[10px] text-brand-600">{e.actor}</span>
                <Link to={`/abonelikler/${e.subscriptionId}`} className="min-w-0 flex-1 truncate text-brand-700 hover:text-accent">
                  <span className="font-medium">{subEventLabel(e.type)}</span>
                  {e.userEmail ? ` · ${e.userEmail}` : ''}
                </Link>
                <span className="shrink-0 text-brand-400">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
              { to: '/operasyon/teslimat-gunu', label: 'Bugünün teslimat listesi' },
              { to: '/odeme-problemleri', label: 'Ödeme problemleri' },
              { to: '/abonelikler', label: 'Abonelikler' },
              { to: '/siparisler', label: 'Siparişler' },
              { to: '/katalog/haftanin-kutusu', label: 'Haftanın kutusunu düzenle' },
              { to: '/ayarlar/teslimat-tarihleri', label: 'Teslimat tarihleri' },
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

