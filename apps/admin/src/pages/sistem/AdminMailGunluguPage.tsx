import { MAIL_STATUS_LABELS, MAIL_STATUS_VALUES, type MailStatus } from '@bagdam/shared';
import { Copy, MailX, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { mailLogsApi } from '../../features/sistem/api';
import { mailErrorText, mailStatusLabel, parseMailPreview } from '../../features/sistem/mailLogs';
import { errorMessage } from '../../lib/api';
import type { AdminMailLog, MailStatusValue } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime } from '../../lib/utils';

const LIMIT_DEFAULT = 25;
type StatusFilter = '' | MailStatusValue;
const STATUS_OPTIONS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: '', label: 'Tümü' },
  ...MAIL_STATUS_VALUES.map((s) => ({ key: s as StatusFilter, label: MAIL_STATUS_LABELS[s as MailStatus] })),
];

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-olive-soft text-olive-deep ring-olive/30',
  FAILED: 'bg-accent-soft text-accent-dark ring-accent/30',
  SKIPPED: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  QUEUED: 'bg-brand-100 text-brand-600 ring-brand-300',
};

/** Önizleme dosyası yolu yalnız dev ortamında gösterilir (dosya `apps/api/logs/mail/<id>.html`, gitignore'lu). */
const SHOW_PREVIEW = import.meta.env.DEV;

export function MailStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', STATUS_STYLE[status] ?? 'bg-brand-100 text-brand-600 ring-brand-300')}>
      {mailStatusLabel(status)}
    </span>
  );
}

/** Yol ayırıcı: `/` ya da ters bölü (Windows dev). */
const PATH_SEP_RE = /[/\\]/;

/** DISABLE_MAIL önizleme yolu: dosya adı + panoya kopyala (tarayıcı yerel dosyayı açamaz). */
function PreviewPath({ path }: { path: string }) {
  const name = path.split(PATH_SEP_RE).pop() ?? path;
  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      toast.success('Önizleme yolu kopyalandı');
    } catch {
      toast.error('Panoya kopyalanamadı');
    }
  }
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1">
      <span className="truncate font-mono text-[11px] text-brand-600" title={path}>
        önizleme: {name}
      </span>
      <button type="button" onClick={() => void copy()} className={cn(btn.icon, 'h-6 w-6')} aria-label="Önizleme yolunu kopyala" title={path}>
        <Copy className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

/** Sistem › E-posta Günlüğü: MailLog listesi (durum filtresi, alıcı araması, sayfalama); hata / DISABLE_MAIL önizleme yolu. */
export function AdminMailGunluguPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const status = (params.get('status') ?? '') as StatusFilter;
  const to = params.get('to') ?? '';

  const [items, setItems] = useState<AdminMailLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mailLogsApi.list({ page, limit, status: status || undefined, to: to || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'E-posta günlüğü yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = useCallback((v: string) => setParam({ to: v, page: 1 }), [setParam]);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="E-posta Günlüğü"
        description="MailLog: gönderilen / atlanan / başarısız e-postalar (90 gün saklanır). DISABLE_MAIL=true (lokal) iken gönderim yapılmaz; şablon render edilip önizleme dosyasına yazılır — yol yalnız dev ortamında görünür."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={btn.secondary}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            Yenile
          </button>
        }
      />

      <AdminToolbar
        className="mb-3"
        searchPlaceholder="Alıcı e-postası…"
        searchValue={to}
        onSearchChange={onSearch}
        filters={<FilterPills options={STATUS_OPTIONS} value={status} onChange={(v) => setParam({ status: v, page: 1 })} label="Durum" />}
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={MailX} message={status || to ? 'Filtreye uyan e-posta kaydı yok.' : 'Henüz e-posta kaydı yok.'} />
      ) : (
        <AdminScrollTable footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Alıcı</th>
                <th className={th}>Konu</th>
                <th className={th}>Şablon</th>
                <th className={th}>Durum</th>
                <th className={th}>Varlık</th>
                <th className={th}>Oluşturma</th>
                <th className={th}>Gönderim</th>
                <th className={th}>Hata / Önizleme</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const preview = parseMailPreview(l.error);
                const err = mailErrorText(l.error);
                return (
                  <tr key={l.id} className={cn(l.status === 'FAILED' && 'bg-accent-light/40')}>
                    <td className={cn(tdText, 'font-medium text-brand-900')}>{l.to}</td>
                    <td className={cn(tdText, 'max-w-[22rem]')}>
                      <span className="line-clamp-2" title={l.subject}>{l.subject || <span className="text-brand-400">—</span>}</span>
                    </td>
                    <td className={cn(td, 'font-mono text-xs')}>{l.templateSlug || '—'}</td>
                    <td className={td}>
                      <MailStatusBadge status={String(l.status)} />
                    </td>
                    <td className={cn(td, 'font-mono text-xs')}>{l.entityId ?? <span className="text-brand-400">—</span>}</td>
                    <td className={cn(td, 'text-xs')}>{formatDateTime(l.createdAt)}</td>
                    <td className={cn(td, 'text-xs')}>{formatDateTime(l.sentAt)}</td>
                    <td className={cn(tdText, 'max-w-[18rem]')}>
                      {err ? (
                        <span className="line-clamp-2 text-xs text-accent-dark" title={err}>{err}</span>
                      ) : preview && SHOW_PREVIEW ? (
                        <PreviewPath path={preview} />
                      ) : preview ? (
                        <span className="text-xs text-brand-400">önizleme (dev)</span>
                      ) : (
                        <span className="text-brand-400">—</span>
                      )}
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
