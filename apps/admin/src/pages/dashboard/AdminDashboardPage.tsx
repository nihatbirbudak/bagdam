import { Activity, CheckCircle2, Circle, CircleDot, KeyRound, LayoutGrid, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useApi } from '../../hooks/useApi';
import { API_BASE } from '../../lib/api';
import type { HealthResponse } from '../../lib/apiTypes';
import { getAllNavLeaves, ADMIN_ROOT, type AdminNavLeaf } from '../../lib/adminNavConfig';
import { getAdminLinkIcon } from '../../lib/adminNavIcons';
import { CURRENT_PHASE, PHASES, PHASE_STATUS_LABEL, type PhaseStatus } from '../../lib/phases';
import { cn } from '../../lib/utils';
import { PhaseBadge } from '../../components/AdminSidebar';

const STATUS_STYLE: Record<PhaseStatus, { icon: typeof Circle; cls: string }> = {
  done: { icon: CheckCircle2, cls: 'text-olive' },
  active: { icon: CircleDot, cls: 'text-accent' },
  planned: { icon: Circle, cls: 'text-brand-300' },
};

function Card({ title, icon: Icon, children, className }: { title: string; icon: typeof Circle; children: React.ReactNode; className?: string }) {
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

/** F1 iskelet özeti: faz durumu, API sağlığı, kimlik durumu, ekran listesi. Gerçek Özet ekranı F9'da. */
export function AdminDashboardPage() {
  const { user, isAuthenticated, authDisabled } = useAdminAuth();
  const health = useApi<HealthResponse>('/health');
  const leaves = getAllNavLeaves().filter((l) => l.to !== ADMIN_ROOT);

  // Faz bazında ekran sayıları
  const byPhase = leaves.reduce<Record<string, AdminNavLeaf[]>>((acc, leaf) => {
    const key = leaf.phase ?? '—';
    (acc[key] ??= []).push(leaf);
    return acc;
  }, {});

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-900 sm:text-xl">Bağdam Yönetim — F1 iskelet</h1>
          <p className="text-sm text-brand-600">
            Boş ama canlı kabuk: menü, kimlik bağlamı, API istemcisi ve yer tutucu ekranlar. Gerçek Özet ekranı{' '}
            <strong>F9</strong>’da gelir.
          </p>
        </div>
        <span className="rounded-full border border-accent/30 bg-accent-light px-3 py-1 text-xs font-semibold text-accent-dark">
          Şu anki faz: {CURRENT_PHASE}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── API sağlığı ── */}
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
              {health.error && (
                <p className="mt-1 text-accent-dark">
                  Ulaşılamadı: {health.error}. Dev’de API (:4010) çalışıyor mu? Vite proxy <code>/api</code> → API.
                </p>
              )}
              {health.data && (
                <p className="mt-1 text-brand-600">
                  Durum: <span className="font-semibold text-olive-deep">{String(health.data.status)}</span>
                  {health.data.version ? ` · v${health.data.version}` : ''}
                </p>
              )}
              <button
                type="button"
                onClick={() => health.refetch()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:border-accent hover:text-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Yeniden dene
              </button>
            </div>
          </div>
        </Card>

        {/* ── Kimlik ── */}
        <Card title="Kimlik ve oturum" icon={KeyRound}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-brand-500">Route kapısı</dt>
              <dd className="font-medium text-brand-900">{authDisabled ? 'Kapalı (geliştirme)' : 'Açık'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-brand-500">Oturum</dt>
              <dd className="font-medium text-brand-900">
                {isAuthenticated && user ? `${user.email} (${String(user.role)})` : 'Anonim'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-brand-500">Yöntem</dt>
              <dd className="text-right text-brand-700">httpOnly cookie + CSRF (same-origin)</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-brand-500">
            F4’te AuthModule gelince <code>VITE_AUTH_DISABLED</code> kaldırılır; login sayfası bugünkü haliyle bağlanır.
          </p>
        </Card>

        {/* ── Ekranlar ── */}
        <Card title="Ekranlar (faza göre)" icon={LayoutGrid}>
          <ul className="space-y-1.5 text-sm">
            {Object.entries(byPhase)
              .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
              .map(([phase, items]) => (
                <li key={phase} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-semibold text-brand-700">{phase}</span>
                  <span className="text-brand-600">{items.length} ekran</span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs text-brand-500">Toplam {leaves.length} ekran menüde yer tutucu olarak bağlı.</p>
        </Card>
      </div>

      {/* ── Faz durumu ── */}
      <Card title="Yol haritası — faz durumu" icon={CircleDot}>
        <ol className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {PHASES.map((p) => {
            const { icon: Icon, cls } = STATUS_STYLE[p.status];
            return (
              <li key={p.key} className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-brand-50">
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', cls)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-mono text-xs font-semibold text-brand-700">{p.key}</span>{' '}
                    <span className="font-medium text-brand-900">{p.title}</span>
                    <span className="text-brand-400"> · {p.days} g</span>
                  </p>
                  <p className="text-xs text-brand-500">{p.summary}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    p.status === 'active' && 'bg-accent-light text-accent-dark',
                    p.status === 'done' && 'bg-olive-soft text-olive-deep',
                    p.status === 'planned' && 'bg-brand-100 text-brand-500',
                  )}
                >
                  {PHASE_STATUS_LABEL[p.status]}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* ── Hızlı erişim ── */}
      <Card title="Menü — yer tutucu ekranlar" icon={LayoutGrid}>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {leaves.map((leaf) => {
            const Icon = getAdminLinkIcon(leaf.to);
            return (
              <li key={leaf.to}>
                <Link
                  to={leaf.to}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-brand-700 transition-colors hover:bg-brand-50 hover:text-accent"
                >
                  <Icon className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
                  <span className="flex-1 truncate">{leaf.label}</span>
                  <PhaseBadge leaf={leaf} />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
