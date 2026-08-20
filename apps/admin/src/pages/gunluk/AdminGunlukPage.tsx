import { Newspaper, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ContentStatusBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { postsApi } from '../../features/icerik/api';
import { stripHtml } from '../../features/icerik/postForm';
import { MediaThumb } from '../../features/medya/MediaThumb';
import { errorMessage } from '../../lib/api';
import type { AdminPost, ContentStatusValue } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime, mergeFromServer } from '../../lib/utils';

const LIMIT_DEFAULT = 25;
type StatusFilter = '' | ContentStatusValue;
const STATUS_OPTIONS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: '', label: 'Tümü' },
  { key: 'PUBLISHED', label: 'Yayında' },
  { key: 'DRAFT', label: 'Taslak' },
];

/** Ekran 11 — Günlük: yazı listesi (durum filtresi, sayfalama), yayınla, sil; form ayrı sayfada. */
export function AdminGunlukPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const status = (params.get('status') ?? '') as StatusFilter;

  const [items, setItems] = useState<AdminPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const res = await postsApi.list({ page, limit, status: status || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'Yazılar yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(p: AdminPost) {
    setBusyId(p.id);
    try {
      const updated = await postsApi.publish(p.id);
      setItems((prev) => prev.map((x) => (x.id === p.id ? mergeFromServer<AdminPost>({ ...x, status: 'PUBLISHED', publishedAt: new Date().toISOString() }, updated) : x)));
      toast.success('Yazı yayınlandı');
    } catch (e) {
      toast.error(errorMessage(e, 'Yayınlanamadı'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: AdminPost) {
    const ok = await confirm({
      title: 'Yazıyı sil',
      description: `"${stripHtml(p.titleHtml)}" kalıcı olarak silinecek (geri alınamaz).`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await postsApi.remove(p.id);
      toast.success('Yazı silindi');
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Silinemedi'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Günlük"
        description="gunluk.html yazıları: tür rozeti · okuma süresi · başlık (HTML, <em> serbest) · özet · gövde · kapak · ilgili yazılar. Yalnız yayındakiler sitede; ana sayfada son 3."
        actions={
          <button type="button" onClick={() => navigate('/icerik/gunluk/yeni')} className={btn.primary}>
            <Plus className="h-4 w-4" aria-hidden />
            Yeni yazı
          </button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterPills options={STATUS_OPTIONS} value={status} onChange={(v) => setParam({ status: v, page: 1 })} label="Durum" />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Newspaper} message={status ? 'Bu durumda yazı yok.' : 'Henüz yazı yok.'} cta={{ label: 'Yeni yazı', onClick: () => navigate('/icerik/gunluk/yeni') }} />
      ) : (
        <AdminScrollTable footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={cn(th, 'w-14')}></th>
                <th className={th}>Başlık</th>
                <th className={th}>Tür</th>
                <th className={cn(th, 'text-right')}>Dk</th>
                <th className={th}>Durum</th>
                <th className={th}>Yayın</th>
                <th className={th}>Güncelleme</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className={cn(p.status !== 'PUBLISHED' && 'bg-brand-50/60')}>
                  <td className={td}>
                    <MediaThumb src={p.coverUrl} alt="" className="h-9 w-12" />
                  </td>
                  <td className={cn(td, 'max-w-[28rem]')}>
                    <Link to={`/icerik/gunluk/${p.id}`} className="font-medium text-brand-900 hover:text-accent">
                      {stripHtml(p.titleHtml) || '(başlıksız)'}
                    </Link>
                    <span className="block font-mono text-[11px] text-brand-400">{p.slug}</span>
                  </td>
                  <td className={cn(td, 'uppercase text-xs tracking-wide')}>{p.kind}</td>
                  <td className={cn(td, 'text-right')}>{p.readMinutes}</td>
                  <td className={td}><ContentStatusBadge status={p.status} /></td>
                  <td className={cn(td, 'text-xs')}>{p.publishedAt ? formatDateTime(p.publishedAt) : <span className="text-brand-400">—</span>}</td>
                  <td className={cn(td, 'text-xs')}>{formatDateTime(p.updatedAt)}</td>
                  <td className={td}>
                    <div className="flex items-center gap-1">
                      {p.status !== 'PUBLISHED' && (
                        <button type="button" onClick={() => void publish(p)} disabled={busyId === p.id} className={cn(btn.secondary, btn.sm)} title="Yayınla">
                          <Send className="h-3.5 w-3.5" aria-hidden />
                          Yayınla
                        </button>
                      )}
                      <Link to={`/icerik/gunluk/${p.id}`} className={btn.icon} aria-label="Düzenle" title="Düzenle">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                      <button type="button" onClick={() => void remove(p)} disabled={busyId === p.id} className={btn.iconDanger} aria-label="Sil" title="Sil">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
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
