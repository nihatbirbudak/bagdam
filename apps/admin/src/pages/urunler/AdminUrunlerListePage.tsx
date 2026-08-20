import { PRODUCT_STATUS_LABELS, STOCK_STATUS_LABELS, STOCK_STATUS_VALUES, type ProductStatus, type StockStatus } from '@bagdam/shared';
import { Leaf, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Select } from '../../components/ui/FormField';
import { useConfirm } from '../../contexts/ConfirmContext';
import { categoriesApi, productsApi } from '../../features/catalog/api';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ReorderButtons } from '../../features/components/ReorderButtons';
import { ProductStatusBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { MediaThumb } from '../../features/medya/MediaThumb';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { errorMessage } from '../../lib/api';
import type { AdminCategory, AdminProductListItem } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { td, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime, formatTry, moveItem } from '../../lib/utils';

const LIMIT_DEFAULT = 50;

type StatusFilter = '' | ProductStatus;
type StockFilter = '' | StockStatus;
type FreshFilter = '' | 'true' | 'false';

/** Ekran 2 — Ürünler listesi: arama, kategori/durum/stok/taze filtreleri, sayfalama, sürükle-sırala, pair toggle, stok select, durum rozetleri. */
export function AdminUrunlerListePage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const q = params.get('q') ?? '';
  const categoryId = params.get('categoryId') ?? '';
  const status = (params.get('status') ?? '') as StatusFilter;
  const stockStatus = (params.get('stockStatus') ?? '') as StockFilter;
  const isFresh = (params.get('isFresh') ?? '') as FreshFilter;

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

  const list = usePaginatedList<AdminProductListItem>('/admin/products', {
    page,
    limit,
    q: q || undefined,
    categoryId: categoryId || undefined,
    status: status || undefined,
    stockStatus: stockStatus || undefined,
    isFresh: isFresh === '' ? undefined : isFresh === 'true',
  });

  const [categories, setCategories] = useState<AdminCategory[]>([]);
  useEffect(() => {
    categoriesApi
      .list()
      .then((c) => setCategories([...c].sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch(() => setCategories([]));
  }, []);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const filtered = !!(q || categoryId || status || stockStatus || isFresh);
  const canReorder = !filtered && !reordering;

  const sortedItems = useMemo(() => list.items, [list.items]);

  async function togglePair(row: AdminProductListItem) {
    setBusyId(row.id);
    try {
      await productsApi.setPair(row.id, !row.pairWithBox);
      list.setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, pairWithBox: !row.pairWithBox } : p)));
      toast.success(!row.pairWithBox ? `${row.name}: kutuya eşlik edecek` : `${row.name}: eşlikten çıkarıldı`);
    } catch (e) {
      toast.error(errorMessage(e, 'Güncellenemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function changeStock(row: AdminProductListItem, next: StockStatus) {
    if (next === row.stockStatus) return;
    setBusyId(row.id);
    try {
      await productsApi.setStock(row.id, next);
      list.setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, stockStatus: next } : p)));
      toast.success(`${row.name}: ${STOCK_STATUS_LABELS[next]}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Güncellenemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function changeStatus(row: AdminProductListItem, next: ProductStatus) {
    if (next === row.status) return;
    setBusyId(row.id);
    try {
      await productsApi.setStatus(row.id, next);
      list.setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, status: next } : p)));
      toast.success(`${row.name}: ${PRODUCT_STATUS_LABELS[next]}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Güncellenemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(row: AdminProductListItem) {
    const ok = await confirm({
      title: 'Ürünü sil',
      description: `"${row.name}" silinecek (yumuşak silme: kayıt deletedAt ile gizlenir; sipariş/parti geçmişi korunur).`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await productsApi.remove(row.id);
      toast.success('Ürün silindi');
      void list.reload();
    } catch (e) {
      toast.error(errorMessage(e, 'Silinemedi'));
    }
  }

  async function persistOrder(next: AdminProductListItem[]) {
    const prev = sortedItems;
    list.setItems(() => next);
    setReordering(true);
    try {
      await productsApi.reorder(next.map((p) => p.id));
      toast.success('Sıra kaydedildi');
    } catch (e) {
      list.setItems(() => prev);
      toast.error(errorMessage(e, 'Sıra kaydedilemedi'));
    } finally {
      setReordering(false);
    }
  }

  function onMove(from: number, to: number) {
    if (!canReorder) return;
    void persistOrder(moveItem(sortedItems, from, to));
  }

  function onDropOn(targetId: string) {
    if (!dragId || dragId === targetId || !canReorder) return;
    const from = sortedItems.findIndex((p) => p.id === dragId);
    const to = sortedItems.findIndex((p) => p.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    void persistOrder(moveItem(sortedItems, from, to));
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Ürünler"
        description="Tekil ürünler ve kutu havuzu (taze). Sıra, urunler.html listesindeki görünüm sırasıdır."
        actions={
          <Link to="/katalog/urunler/yeni" className={btn.primary}>
            <Plus className="h-4 w-4" aria-hidden />
            Yeni ürün
          </Link>
        }
      />

      <AdminToolbar
        searchPlaceholder="Ad, slug, üretici ara…"
        searchValue={q}
        onSearchChange={(v) => setParam({ q: v, page: 1 })}
        filters={
          <>
            <label className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold uppercase tracking-wide text-brand-400">Kategori</span>
              <Select value={categoryId} onChange={(e) => setParam({ categoryId: e.target.value, page: 1 })} className="w-auto py-1 text-xs" aria-label="Kategori filtresi">
                <option value="">Tümü</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            </label>
            <FilterPills<StatusFilter>
              label="Durum"
              value={status}
              onChange={(v) => setParam({ status: v, page: 1 })}
              options={[{ key: '', label: 'Tümü' }, { key: 'ACTIVE', label: 'Yayında' }, { key: 'DRAFT', label: 'Taslak' }, { key: 'HIDDEN', label: 'Gizli' }]}
            />
            <FilterPills<StockFilter>
              label="Stok"
              value={stockStatus}
              onChange={(v) => setParam({ stockStatus: v, page: 1 })}
              options={[{ key: '', label: 'Tümü' }, ...STOCK_STATUS_VALUES.map((s) => ({ key: s, label: STOCK_STATUS_LABELS[s] }))]}
            />
            <FilterPills<FreshFilter>
              label="Taze"
              value={isFresh}
              onChange={(v) => setParam({ isFresh: v, page: 1 })}
              options={[{ key: '', label: 'Tümü' }, { key: 'true', label: 'Kutu havuzu' }, { key: 'false', label: 'Kiler/raf' }]}
            />
          </>
        }
        className="mb-3"
      />

      {filtered && <InlineNotice tone="info" className="mb-3">Filtre etkinken sürükle-sırala kapalıdır; sıra yalnız filtresiz listede değiştirilir.</InlineNotice>}

      {list.loading && list.items.length === 0 ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock message={list.error} onRetry={() => void list.reload()} />
      ) : sortedItems.length === 0 ? (
        <AdminEmptyState
          icon={Package}
          message={filtered ? 'Filtreye uyan ürün yok.' : 'Henüz ürün yok.'}
          cta={filtered ? undefined : { label: 'Yeni ürün', onClick: () => navigate('/katalog/urunler/yeni') }}
        />
      ) : (
        <AdminScrollTable
          footer={
            <Pagination
              total={list.total}
              page={page}
              limit={limit}
              onPageChange={(p) => setParam({ page: p })}
              onLimitChange={(l) => setParam({ limit: l, page: 1 })}
              limitOptions={[25, 50, 100]}
            />
          }
        >
          <table className={cn('admin-table', list.loading && 'opacity-60')}>
            <thead>
              <tr>
                <th className={cn(th, 'w-24')}>Sıra</th>
                <th className={cn(th, 'w-14')}></th>
                <th className={th}>Ürün</th>
                <th className={th}>Kategori</th>
                <th className={th}>Üretici</th>
                <th className={cn(th, 'text-right')}>Fiyat</th>
                <th className={th}>Durum</th>
                <th className={th}>Stok</th>
                <th className={th}>Kutu eşi</th>
                <th className={th}>Güncellendi</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((row, idx) => {
                const busy = busyId === row.id;
                return (
                  <tr
                    key={row.id}
                    draggable={canReorder}
                    onDragStart={() => canReorder && setDragId(row.id)}
                    onDragOver={(e) => canReorder && e.preventDefault()}
                    onDrop={() => onDropOn(row.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn(dragId === row.id && 'opacity-50', row.status !== 'ACTIVE' && 'bg-brand-50/50')}
                  >
                    <td className={td}>
                      <ReorderButtons index={idx} count={sortedItems.length} onMove={onMove} disabled={!canReorder} />
                    </td>
                    <td className={td}>
                      <Link to={`/katalog/urunler/${row.id}`} className="block">
                        <MediaThumb src={row.coverImageUrl} alt={row.name} className="h-10 w-10" />
                      </Link>
                    </td>
                    <td className={td}>
                      <Link to={`/katalog/urunler/${row.id}`} className="font-medium text-brand-900 hover:text-accent">
                        {row.name}
                      </Link>
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-brand-400">
                        {row.slug}
                        {row.isFresh && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-olive-soft px-1 font-sans text-[10px] font-semibold text-olive-deep" title="Kutu havuzu (isFresh)">
                            <Leaf className="h-2.5 w-2.5" aria-hidden /> taze
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={td}>{row.categoryLabel}</td>
                    <td className={td}>{row.producerName ?? <span className="text-brand-400">—</span>}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>
                      {formatTry(row.price)} <span className="text-[10px] text-brand-400">/ {row.unit}</span>
                    </td>
                    <td className={td}>
                      <Select
                        value={row.status}
                        disabled={busy}
                        onChange={(e) => void changeStatus(row, e.target.value as ProductStatus)}
                        className="w-auto py-1 text-xs"
                        aria-label={`${row.name} durumu`}
                      >
                        {(['ACTIVE', 'DRAFT', 'HIDDEN'] as ProductStatus[]).map((s) => (
                          <option key={s} value={s}>{PRODUCT_STATUS_LABELS[s]}</option>
                        ))}
                      </Select>
                    </td>
                    <td className={td}>
                      <Select
                        value={row.stockStatus}
                        disabled={busy}
                        onChange={(e) => void changeStock(row, e.target.value as StockStatus)}
                        className={cn('w-auto py-1 text-xs', row.stockStatus === 'SOLD_OUT' && 'border-accent/50 text-accent-dark', row.stockStatus === 'LOW' && 'border-butter-deep/40 text-butter-deep')}
                        aria-label={`${row.name} stok durumu`}
                      >
                        {STOCK_STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>{STOCK_STATUS_LABELS[s]}</option>
                        ))}
                      </Select>
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.pairWithBox}
                        aria-label={`${row.name} kutuya eşlik`}
                        disabled={busy}
                        onClick={() => void togglePair(row)}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-50',
                          row.pairWithBox ? 'border-olive bg-olive' : 'border-brand-300 bg-brand-200',
                        )}
                        title={row.pairWithBox ? 'kutu.html eşlik listesinde' : 'Eşlik listesinde değil'}
                      >
                        <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', row.pairWithBox ? 'translate-x-4' : 'translate-x-0.5')} />
                      </button>
                    </td>
                    <td className={cn(td, 'whitespace-nowrap text-xs text-brand-500')}>{formatDateTime(row.updatedAt)}</td>
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        <Link to={`/katalog/urunler/${row.id}`} className={btn.icon} aria-label={`${row.name} düzenle`} title="Düzenle">
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                        <button type="button" onClick={() => void handleDelete(row)} className={btn.iconDanger} aria-label={`${row.name} sil`} title="Sil">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminScrollTable>
      )}

      {/* Durum rozetleri açıklaması */}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-brand-500">
        <span>Durum:</span>
        <ProductStatusBadge status="ACTIVE" /> sitede görünür ·
        <ProductStatusBadge status="DRAFT" /> hazırlanıyor ·
        <ProductStatusBadge status="HIDDEN" /> gizli.
        <span className="ml-2">Stok: Tükendi / Sezon dışı ürünler müşteri bootstrap'ına gömülmez.</span>
      </p>
    </div>
  );
}
