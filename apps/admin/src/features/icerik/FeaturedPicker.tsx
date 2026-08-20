import { AlertTriangle, Boxes, Package, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FeaturedEditorProps } from '../../components/ui/SchemaForm';
import { Select } from '../../components/ui/FormField';
import type { AdminProductListItem, AdminTier } from '../../lib/adminTypes';
import { errorMessage } from '../../lib/api';
import type { FeaturedItem } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { cn, moveItem } from '../../lib/utils';
import { productsApi, tiersApi } from '../catalog/api';
import { ReorderButtons } from '../components/ReorderButtons';
import { MediaThumb } from '../medya/MediaThumb';
import { normalizeFeatured } from './schemaForm';

const PAGE = 100;
const MAX_PAGES = 10;

/** Tüm ürünleri sayfalayarak çeker (liste ucu sayfalı; 1000 üstü katalog MVP'de yok). */
async function loadAllProducts(): Promise<AdminProductListItem[]> {
  const out: AdminProductListItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await productsApi.list({ page, limit: PAGE });
    out.push(...(res.items ?? []));
    if (!res.items || res.items.length < PAGE || out.length >= (res.total ?? 0)) break;
  }
  return out;
}

/**
 * `home.featured` editörü — ürün ve kutu (tier) kartları karışık sırada [B7]: tür + slug seçimi, sıralama, kaldırma.
 * Sitede yalnız bootstrap'ta olan öğeler basılır (SOLD_OUT/HIDDEN ürün, pasif tier atlanır) — bu durumda uyarı gösterilir.
 */
export function FeaturedPicker({ value, onChange, errors, errorPrefix, disabled }: FeaturedEditorProps) {
  const items = useMemo(() => normalizeFeatured(value), [value]);
  const [products, setProducts] = useState<AdminProductListItem[]>([]);
  const [tiers, setTiers] = useState<AdminTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [p, t] = await Promise.all([loadAllProducts(), tiersApi.list()]);
        if (cancelled) return;
        setProducts([...p].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
        setTiers([...t].sort((a, b) => a.sortOrder - b.sortOrder));
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e, 'Ürün/kutu listesi yüklenemedi'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const productBySlug = useMemo(() => new Map(products.map((p) => [p.slug, p] as const)), [products]);
  const tierBySlug = useMemo(() => new Map(tiers.map((t) => [t.slug, t] as const)), [tiers]);

  function update(next: FeaturedItem[]) {
    onChange(next.map((it, i) => ({ type: it.type, ref: it.ref, order: i + 1 })));
  }
  function setItem(i: number, patch: Partial<FeaturedItem>) {
    update(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function add(type: FeaturedItem['type']) {
    update([...items, { type, ref: '', order: items.length + 1 }]);
  }
  function remove(i: number) {
    update(items.filter((_, idx) => idx !== i));
  }
  function move(from: number, to: number) {
    update(moveItem(items, from, to));
  }

  function warningFor(it: FeaturedItem): string | null {
    if (!it.ref) return null;
    if (it.type === 'product') {
      const p = productBySlug.get(it.ref);
      if (!p) return loading ? null : 'Bu slug katalogda yok; sitede atlanır.';
      if (p.status !== 'ACTIVE') return 'Ürün yayında değil; sitede atlanır.';
      if (p.stockStatus === 'SOLD_OUT' || p.stockStatus === 'OUT_OF_SEASON') return 'Stok durumu nedeniyle sitede atlanır.';
      return null;
    }
    const t = tierBySlug.get(it.ref);
    if (!t) return loading ? null : 'Bu kutu tanımlı değil; sitede atlanır.';
    if (!t.isActive) return 'Kutu pasif; sitede atlanır.';
    return null;
  }

  return (
    <div className="space-y-2" data-field={errorPrefix}>
      {loadError && (
        <p role="alert" className="rounded-md border border-accent/30 bg-accent-light px-3 py-2 text-xs text-accent-dark">
          {loadError} — slug'ları elle de yazabilirsiniz.
        </p>
      )}
      {items.length === 0 && <p className="text-xs text-brand-500">Henüz öğe yok. Ürün ya da kutu ekleyin; sıra kartların sitedeki sırasıdır.</p>}
      <ol className="space-y-2">
        {items.map((it, i) => {
          const err = errors[`${errorPrefix}.${i}.ref`];
          const warn = warningFor(it);
          const product = it.type === 'product' ? productBySlug.get(it.ref) : undefined;
          const tier = it.type === 'tier' ? tierBySlug.get(it.ref) : undefined;
          const thumb = product?.coverImageUrl ?? tier?.imageUrl ?? null;
          return (
            <li key={`${i}-${it.type}`} className={cn('flex flex-wrap items-center gap-2 rounded-md border bg-white p-2', err ? 'border-accent-dark/60' : 'border-brand-200')}>
              <span className="w-6 shrink-0 text-center font-mono text-[11px] text-brand-400">{i + 1}</span>
              <MediaThumb src={thumb} alt="" className="h-10 w-10 shrink-0" />
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                  it.type === 'tier' ? 'bg-fig-soft text-fig-deep ring-fig/30' : 'bg-olive-soft text-olive-deep ring-olive/30',
                )}
              >
                {it.type === 'tier' ? <Boxes className="h-3 w-3" aria-hidden /> : <Package className="h-3 w-3" aria-hidden />}
                {it.type === 'tier' ? 'Kutu' : 'Ürün'}
              </span>
              <div className="min-w-[12rem] flex-1">
                <Select value={it.ref} disabled={disabled} invalid={!!err} aria-label={`Öğe ${i + 1} ${it.type === 'tier' ? 'kutu' : 'ürün'}`} onChange={(e) => setItem(i, { ref: e.target.value })}>
                  <option value="">— {it.type === 'tier' ? 'Kutu' : 'Ürün'} seçin —</option>
                  {it.type === 'product'
                    ? products.map((p) => (
                        <option key={p.id} value={p.slug}>
                          {p.name} ({p.slug}){p.status !== 'ACTIVE' ? ' — yayında değil' : ''}
                        </option>
                      ))
                    : tiers.map((t) => (
                        <option key={t.id} value={t.slug}>
                          {t.label} ({t.slug}){!t.isActive ? ' — pasif' : ''}
                        </option>
                      ))}
                  {it.ref && !(it.type === 'product' ? productBySlug.has(it.ref) : tierBySlug.has(it.ref)) && (
                    <option value={it.ref}>{it.ref} (listede yok)</option>
                  )}
                </Select>
                {err ? (
                  <p role="alert" className="mt-1 text-xs text-accent-dark">{err}</p>
                ) : warn ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-butter-deep">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {warn}
                  </p>
                ) : null}
              </div>
              <ReorderButtons index={i} count={items.length} onMove={move} disabled={disabled} handle={false} />
              <button type="button" disabled={disabled} onClick={() => remove(i)} className={btn.iconDanger} aria-label={`Öğe ${i + 1} kaldır`} title="Kaldır">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => add('product')} className={cn(btn.secondary, btn.sm)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Ürün ekle
        </button>
        <button type="button" disabled={disabled} onClick={() => add('tier')} className={cn(btn.secondary, btn.sm)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Kutu ekle
        </button>
        {loading && <span className="self-center text-[11px] text-brand-400">Katalog yükleniyor…</span>}
      </div>
    </div>
  );
}
