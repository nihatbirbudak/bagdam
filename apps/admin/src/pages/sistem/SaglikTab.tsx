import { AlertTriangle, CheckCircle2, Clock, Database, Mail, Play, RefreshCw, Server, Webhook } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { cronLogsApi, jobsApi, systemHealthApi } from '../../features/sistem/api';
import {
  formatDuration,
  formatUptime,
  healthTone,
  mergeJobRows,
  summarizeLevels,
  summarizeMail,
  type JobRow,
} from '../../features/sistem/system';
import { errorMessage } from '../../lib/api';
import type { AdminHealthDetailed, CronLogItem, JobInfo } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime } from '../../lib/utils';
import { CronStatusBadge, ToneBadge } from './SistemBadges';

function Card({ title, icon: Icon, children, actions }: { title: string; icon: typeof Server; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-brand-200 bg-white">
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

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-brand-100 py-1.5 last:border-b-0">
      <span className="text-xs text-brand-500">{label}</span>
      <span className="text-right text-sm text-brand-800">{value}</span>
    </div>
  );
}

/**
 * Ekran 22 › Sağlık — `GET /admin/health/detailed`: DB gecikmesi, süreç/sürüm, zamanlayıcı durumu,
 * son 24 saatin sistem/e-posta/webhook sayımları, açık ödeme problemleri ve uyarı listesi.
 * Alt bölümde job kayıt defteri + son koşular; "Çalıştır" yalnız üretim dışı ortamda ve ADMIN rolünde.
 */
export function SaglikTab() {
  const { isAdmin } = useAdminAuth();
  const [health, setHealth] = useState<AdminHealthDetailed | null>(null);
  const [jobs, setJobs] = useState<JobInfo[] | null>(null);
  const [latestRuns, setLatestRuns] = useState<CronLogItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detailed = await systemHealthApi.detailed();
      setHealth(detailed);
      setLatestRuns(detailed.scheduler.jobs);
      // Kayıt defteri yalnız ADMIN'e açık (STAFF 403) — sağlık kartı yine dolu kalır.
      if (isAdmin) {
        try {
          setJobs(await jobsApi.list());
        } catch {
          setJobs(null);
        }
      } else {
        setJobs(null);
      }
    } catch (e) {
      setError(errorMessage(e, 'Sağlık bilgisi yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const runJob = useCallback(
    async (name: string) => {
      setRunning(name);
      try {
        const result = await jobsApi.run(name);
        toast.success(`${name}: ${result.status} · ${result.itemsProcessed} kayıt · ${formatDuration(result.durationMs)}`);
        // Son koşular tazelensin
        const page = await cronLogsApi.list({ limit: 50 });
        setLatestRuns(page.items);
      } catch (e) {
        toast.error(errorMessage(e, `${name} çalıştırılamadı`));
      } finally {
        setRunning(null);
      }
    },
    [],
  );

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />;
  if (!health) return <ErrorBlock message="Sağlık bilgisi boş döndü" onRetry={() => void load()} />;

  const tone = healthTone(health);
  const jobRows: JobRow[] = mergeJobRows(jobs, latestRuns);
  const canRun = health.jobRunAllowed && isAdmin;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <ToneBadge tone={tone}>
            {tone === 'good' ? 'Sağlıklı' : tone === 'warn' ? 'Uyarı var' : 'Sorunlu'}
          </ToneBadge>
          <span className="text-xs text-brand-500">Son kontrol: {formatDateTime(health.checkedAt)}</span>
        </span>
        <button type="button" onClick={() => void load()} className={cn(btn.secondary, btn.sm)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Yenile
        </button>
      </div>

      {health.warnings.length > 0 && (
        <InlineNotice tone="warning">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Dikkat:</strong>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {health.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </span>
          </span>
        </InlineNotice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Uygulama" icon={Server}>
          <Row label="Sürüm" value={health.version} />
          <Row label="Ortam" value={health.env} />
          <Row label="Site modu" value={health.siteMode} />
          <Row label="Node" value={health.nodeVersion} />
          <Row label="Çalışma süresi" value={formatUptime(health.uptimeSeconds)} />
          <Row label="Saat dilimi" value={`${health.timezone.resolved}${health.timezone.env ? '' : ' (TZ ayarsız)'}`} />
          <Row label="Bellek" value={`${health.memory.rssMb} MB RSS · ${health.memory.heapUsedMb} MB heap`} />
        </Card>

        <Card title="Veritabanı ve işler" icon={Database}>
          <Row
            label="Veritabanı"
            value={
              health.db.status === 'up' ? (
                <span className="inline-flex items-center gap-1 text-olive-deep">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {health.db.latencyMs} ms
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-accent-dark">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> erişilemiyor
                </span>
              )
            }
          />
          <Row label="Zamanlayıcı" value={health.scheduler.enabled ? 'açık' : 'kapalı'} />
          <Row label="PM2 instance" value={health.scheduler.instance ?? 'tek süreç'} />
          <Row label="24 s başarısız koşu" value={health.scheduler.failedRuns24h} />
          <Row label="Açık ödeme problemi" value={`${health.paymentIssues.unpaidCycles} kutu · ${health.paymentIssues.failedOrders} sipariş`} />
        </Card>

        <Card title="Son 24 saat" icon={Clock}>
          <Row label="Sistem günlüğü" value={summarizeLevels(health.systemLogs24h)} />
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" aria-hidden /> E-posta
              </span>
            }
            value={`${summarizeMail(health.mail24h)}${health.mailDisabled ? ' (DISABLE_MAIL)' : ''}`}
          />
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                <Webhook className="h-3 w-3" aria-hidden /> Webhook
              </span>
            }
            value={`${health.webhooks24h.total} bildirim · ${health.webhooks24h.invalidSignature} geçersiz imza · ${health.webhooks24h.failed} hata`}
          />
        </Card>
      </div>

      <Card
        title="Zamanlanmış işler"
        icon={Clock}
        actions={
          canRun ? (
            <span className="text-[11px] text-brand-500">Elle çalıştırma yalnız geliştirme/staging ortamında açıktır.</span>
          ) : (
            <span className="text-[11px] text-brand-400">Elle çalıştırma bu ortamda kapalı.</span>
          )
        }
      >
        {jobRows.length === 0 ? (
          <p className="py-4 text-sm text-brand-500">Kayıtlı iş bulunamadı.</p>
        ) : (
          <AdminScrollTable>
            <table className="admin-table">
              <thead>
                <tr>
                  <th className={th}>İş</th>
                  <th className={th}>Cron</th>
                  <th className={th}>Son koşu</th>
                  <th className={th}>Durum</th>
                  <th className={th}>Kayıt / hata</th>
                  <th className={th}>Süre</th>
                  {canRun && <th className={th}>İşlem</th>}
                </tr>
              </thead>
              <tbody>
                {jobRows.map((job) => (
                  <tr key={job.name}>
                    <td className={cn(tdText, 'font-mono text-xs text-brand-900')} title={job.description ?? undefined}>
                      {job.name}
                    </td>
                    <td className={cn(td, 'font-mono text-[11px] text-brand-600')}>{job.cron ?? '—'}</td>
                    <td className={cn(td, 'text-xs')}>{job.lastRun ? formatDateTime(job.lastRun.startedAt) : '—'}</td>
                    <td className={td}>{job.lastRun ? <CronStatusBadge status={job.lastRun.status} /> : <span className="text-brand-400">—</span>}</td>
                    <td className={cn(td, 'text-xs')}>
                      {job.lastRun ? `${job.lastRun.itemsProcessed} / ${job.lastRun.errors}` : '—'}
                    </td>
                    <td className={cn(td, 'text-xs')}>{job.lastRun ? formatDuration(job.lastRun.durationMs) : '—'}</td>
                    {canRun && (
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => void runJob(job.name)}
                          disabled={running !== null}
                          className={cn(btn.secondary, btn.sm)}
                        >
                          <Play className={cn('h-3.5 w-3.5', running === job.name && 'animate-pulse')} aria-hidden />
                          {running === job.name ? 'Çalışıyor…' : 'Çalıştır'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminScrollTable>
        )}
      </Card>
    </div>
  );
}
