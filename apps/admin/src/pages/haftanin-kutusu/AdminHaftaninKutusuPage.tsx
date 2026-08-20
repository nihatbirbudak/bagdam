import { CalendarDays, ChevronLeft, ChevronRight, CopyPlus, Gift, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Checkbox, TextInput, inputCls } from '../../components/ui/FormField';
import { useConfirm } from '../../contexts/ConfirmContext';
import { boxTemplatesApi, normalizeBoxWeek, productsApi, tiersApi } from '../../features/catalog/api';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { ReorderButtons } from '../../features/components/ReorderButtons';
import { ContentStatusBadge, StockStatusBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { ApiError, errorMessage } from '../../lib/api';
import type { AdminBoxTemplate, AdminBoxTemplateItemBody, AdminBoxWeek, AdminPoolProduct } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn, moveItem } from '../../lib/utils';
import { addDays, currentWeekStart, formatWeekRange, isIsoDate, mondayOf } from '../../lib/week';

/* ── Taslak modeli ─────────────────────────────────────────────────────── */

interface DraftItem {
  productId: string;
  productName: string;
  productSlug: string;
  qtyLabel: string;
  isSwappable: boolean;
}

interface TierDraft {
  tierId: string;
  tierSlug: string;
  tierLabel: string;
  itemCount: number;
  /** Sunucudaki şablon (yoksa null → kaydet = POST). */
  template: AdminBoxTemplate | null;
  curatorName: string;
  items: DraftItem[];
  dirty: boolean;
  saving: boolean;
}

function templateToItems(t: AdminBoxTemplate | null): DraftItem[] {
  if (!t) return [];
  return [...t.items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({ productId: i.productId, productName: i.productName, productSlug: i.productSlug, qtyLabel: i.qtyLabel, isSwappable: i.isSwappable }));
}

function toTierDrafts(week: AdminBoxWeek): TierDraft[] {
  return week.tiers.map(({ tier, template }) => ({
    tierId: tier.id,
    tierSlug: tier.slug,
    tierLabel: tier.label,
    itemCount: tier.itemCount,
    template,
    curatorName: template?.curatorName ?? '',
    items: templateToItems(template),
    dirty: false,
    saving: false,
  }));
}

/** box-week ucu yoksa/şekli tanınmazsa: tiers + box-templates + fresh ürünlerden hafta görünümü kurar. */
async function composeWeek(week: string): Promise<AdminBoxWeek> {
  const [tiers, templates, products] = await Promise.all([
    tiersApi.list(),
    boxTemplatesApi.list({ from: week, to: addDays(week, 6) }),
    productsApi.list({ isFresh: true, page: 1, limit: 100 }),
  ]);
  return {
    weekStart: week,
    tiers: tiers
      .filter((t) => t.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        tier: { id: t.id, slug: t.slug, label: t.label, itemCount: t.itemCount, isActive: t.isActive },
        template: templates.find((tpl) => tpl.tierId === t.id && tpl.weekStart.slice(0, 10) === week) ?? null,
      })),
    pool: products.items
      .filter((p) => p.status === 'ACTIVE')
      .map((p) => ({ id: p.id, slug: p.slug, name: p.name, unit: p.unit, boxAmount: null, stockStatus: p.stockStatus, status: p.status, sortOrder: p.sortOrder, coverImageUrl: p.coverImageUrl })),
  };
}

/** Ekran 7 — Haftanın Kutusu: hafta seçici; tier başına şablon (havuzdan ekle/çıkar, miktar, swap, küratör); Kaydet / Yayınla / Gelecek haftaya kopyala. */
export function AdminHaftaninKutusuPage() {
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week');
  const week = weekParam && isIsoDate(weekParam) ? mondayOf(weekParam) : currentWeekStart();

  const [data, setData] = useState<AdminBoxWeek | null>(null);
  const [drafts, setDrafts] = useState<TierDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poolQ, setPoolQ] = useState('');
  const [activeTierId, setActiveTierId] = useState<string | null>(null);

  const setWeek = useCallback(
    (w: string) => {
      const next = new URLSearchParams(params);
      if (w === currentWeekStart()) next.delete('week');
      else next.set('week', w);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let wk: AdminBoxWeek | null = null;
      try {
        wk = normalizeBoxWeek(await boxTemplatesApi.weekRaw(week), week);
      } catch (e) {
        // 404 (uç yok) ya da 5xx → birleşik kurulum; diğer hatalar (401/403) fırlatılsın
        if (e instanceof ApiError && (e.kind === 'auth' || e.kind === 'forbidden')) throw e;
        wk = null;
      }
      if (!wk) wk = await composeWeek(week);
      setData(wk);
      setDrafts(toTierDrafts(wk));
      setActiveTierId((prev) => (prev && wk!.tiers.some((t) => t.tier.id === prev) ? prev : (wk!.tiers[0]?.tier.id ?? null)));
    } catch (e) {
      setError(errorMessage(e, 'Hafta bilgisi yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    void load();
  }, [load]);

  const pool = useMemo(() => {
    const needle = poolQ.trim().toLocaleLowerCase('tr');
    const list = data?.pool ?? [];
    return needle ? list.filter((p) => p.name.toLocaleLowerCase('tr').includes(needle) || p.slug.includes(needle)) : list;
  }, [data, poolQ]);

  const active = drafts.find((d) => d.tierId === activeTierId) ?? null;

  function patchTier(tierId: string, patch: Partial<TierDraft> | ((d: TierDraft) => Partial<TierDraft>)) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.tierId !== tierId) return d;
        const p = typeof patch === 'function' ? patch(d) : patch;
        return { ...d, ...p };
      }),
    );
  }

  function addToTier(tierId: string, p: AdminPoolProduct) {
    patchTier(tierId, (d) => {
      if (d.items.some((i) => i.productId === p.id)) return {};
      return { items: [...d.items, { productId: p.id, productName: p.name, productSlug: p.slug, qtyLabel: p.boxAmount ?? p.unit ?? '1 adet', isSwappable: true }], dirty: true };
    });
  }

  function removeFromTier(tierId: string, productId: string) {
    patchTier(tierId, (d) => ({ items: d.items.filter((i) => i.productId !== productId), dirty: true }));
  }

  function updateItem(tierId: string, productId: string, patch: Partial<DraftItem>) {
    patchTier(tierId, (d) => ({ items: d.items.map((i) => (i.productId === productId ? { ...i, ...patch } : i)), dirty: true }));
  }

  function moveTierItem(tierId: string, from: number, to: number) {
    patchTier(tierId, (d) => ({ items: moveItem(d.items, from, to), dirty: true }));
  }

  function toBody(d: TierDraft): AdminBoxTemplateItemBody[] {
    return d.items.map((i) => ({ productId: i.productId, qtyLabel: i.qtyLabel.trim() || '1 adet', isSwappable: i.isSwappable }));
  }

  async function saveTier(d: TierDraft): Promise<AdminBoxTemplate | null> {
    if (d.items.length === 0) {
      toast.error(`${d.tierLabel}: en az bir ürün ekleyin`);
      return null;
    }
    if (d.template?.status === 'PUBLISHED' && d.dirty) {
      const ok = await confirm({
        title: 'Yayınlanmış şablon değişecek',
        description: `${d.tierLabel} için bu haftanın şablonu YAYINDA. Değişiklik kutu.html'de ve bu haftaki abonelik içeriklerinde hemen görünür. Devam edilsin mi?`,
        confirmLabel: 'Kaydet',
        danger: true,
      });
      if (!ok) return null;
    }
    patchTier(d.tierId, { saving: true });
    try {
      const saved = d.template
        ? await boxTemplatesApi.update(d.template.id, { curatorName: d.curatorName.trim() || null, items: toBody(d) })
        : await boxTemplatesApi.create({ tierId: d.tierId, weekStart: week, curatorName: d.curatorName.trim() || null, items: toBody(d) });
      patchTier(d.tierId, { template: saved, items: templateToItems(saved).length ? templateToItems(saved) : d.items, curatorName: saved?.curatorName ?? d.curatorName, dirty: false });
      if (saved?.warning) toast.warning(saved.warning);
      toast.success(`${d.tierLabel}: şablon kaydedildi (${saved?.status === 'PUBLISHED' ? 'yayında' : 'taslak'})`);
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'conflict') {
        toast.error(e.message || 'Bu tier + hafta için şablon zaten var; sayfa yenileniyor.');
        void load();
      } else toast.error(errorMessage(e, 'Kaydedilemedi'));
      return null;
    } finally {
      patchTier(d.tierId, { saving: false });
    }
  }

  async function publishTier(d: TierDraft) {
    let tpl = d.template;
    if (!tpl || d.dirty) {
      tpl = await saveTier(d);
      if (!tpl) return;
    }
    const ok = await confirm({
      title: 'Şablonu yayınla',
      description: `${d.tierLabel} — ${formatWeekRange(week)} şablonu yayınlanacak; kutu.html bu içeriği basar. Aynı hafta için başka yayınlanmış şablon varsa taslağa çekilir.`,
      confirmLabel: 'Yayınla',
    });
    if (!ok) return;
    patchTier(d.tierId, { saving: true });
    try {
      const published = await boxTemplatesApi.publish(tpl.id);
      patchTier(d.tierId, { template: published ?? { ...tpl, status: 'PUBLISHED' }, dirty: false });
      toast.success(`${d.tierLabel}: şablon yayınlandı`);
    } catch (e) {
      toast.error(errorMessage(e, 'Yayınlanamadı'));
    } finally {
      patchTier(d.tierId, { saving: false });
    }
  }

  async function cloneNext(d: TierDraft) {
    if (!d.template) {
      toast.error('Önce şablonu kaydedin');
      return;
    }
    if (d.dirty) {
      const ok = await confirm({ title: 'Kaydedilmemiş değişiklik', description: 'Kopya sunucudaki kayıtlı sürümden alınır. Önce kaydetmek ister misiniz? (Vazgeç = kaydetmeden kopyala)', confirmLabel: 'Önce kaydet' });
      if (ok) {
        const saved = await saveTier(d);
        if (!saved) return;
      }
    }
    try {
      const created = await boxTemplatesApi.cloneNextWeek(d.template.id);
      toast.success(`${d.tierLabel}: ${formatWeekRange(addDays(week, 7))} için taslak oluşturuldu`);
      if (created?.weekStart) setWeek(mondayOf(created.weekStart.slice(0, 10)));
      else setWeek(addDays(week, 7));
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'conflict') toast.warning(e.message || 'Gelecek hafta için şablon zaten var.');
      else toast.error(errorMessage(e, 'Kopyalanamadı'));
    }
  }

  const anyDirty = drafts.some((d) => d.dirty);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Haftanın Kutusu"
        description="Hafta → kutu boyu başına içerik. Yayınlanan şablon kutu.html'de basılır ve abonelik cycle içeriğinin tek kaynağıdır."
        actions={
          <div className="flex items-center gap-1 rounded-md border border-brand-300 bg-white p-1">
            <button type="button" onClick={() => setWeek(addDays(week, -7))} className={cn(btn.ghost, 'px-2 py-1')} aria-label="Önceki hafta">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <label className="flex items-center gap-1.5 px-1 text-sm">
              <CalendarDays className="h-4 w-4 text-brand-400" aria-hidden />
              <input
                type="date"
                value={week}
                onChange={(e) => e.target.value && isIsoDate(e.target.value) && setWeek(mondayOf(e.target.value))}
                className="rounded border border-brand-200 px-1.5 py-0.5 text-xs"
                aria-label="Hafta"
              />
              <span className="hidden whitespace-nowrap font-medium text-brand-800 sm:inline">{formatWeekRange(week)}</span>
            </label>
            <button type="button" onClick={() => setWeek(addDays(week, 7))} className={cn(btn.ghost, 'px-2 py-1')} aria-label="Sonraki hafta">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            {week !== currentWeekStart() && (
              <button type="button" onClick={() => setWeek(currentWeekStart())} className={cn(btn.ghost, 'px-2 py-1 text-xs')}>
                Bu hafta
              </button>
            )}
          </div>
        }
      />

      {anyDirty && <InlineNotice tone="warning" className="mb-3">Kaydedilmemiş değişiklikler var. Hafta değiştirmeden önce ilgili kutuyu kaydedin.</InlineNotice>}

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : drafts.length === 0 ? (
        <InlineNotice tone="info">Aktif kutu boyu yok. Önce “Kutular” ekranından bir tier etkinleştirin.</InlineNotice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          {/* Tier şablonları */}
          <div className="space-y-4">
            {drafts.map((d) => {
              const isActiveTier = d.tierId === activeTierId;
              const status = d.template?.status ?? null;
              const over = d.items.length > d.itemCount;
              const under = d.items.length < d.itemCount;
              return (
                <section
                  key={d.tierId}
                  className={cn('rounded-lg border bg-white', isActiveTier ? 'border-accent shadow-sm' : 'border-brand-200')}
                  onClick={() => setActiveTierId(d.tierId)}
                >
                  <header className="flex flex-wrap items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
                    <Gift className="h-4 w-4 text-brand-500" aria-hidden />
                    <h2 className="text-sm font-semibold text-brand-900">{d.tierLabel}</h2>
                    <span className="font-mono text-[11px] text-brand-400">{d.tierSlug}</span>
                    {status ? <ContentStatusBadge status={status} /> : <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-500 ring-1 ring-inset ring-brand-300">Şablon yok</span>}
                    {d.dirty && <span className="text-[11px] font-medium text-butter-deep">• kaydedilmedi</span>}
                    <span className={cn('ml-auto text-xs tabular-nums', over ? 'text-accent-dark' : under ? 'text-butter-deep' : 'text-olive-deep')}>
                      {d.items.length} / {d.itemCount} ürün
                    </span>
                  </header>

                  {status === 'PUBLISHED' && (
                    <InlineNotice tone="warning" className="m-3 mb-0">
                      Bu şablon yayında. Değişiklikler kaydedilince sitede hemen görünür; abonelere haftanın kutusu e-postası gitmiş olabilir.
                    </InlineNotice>
                  )}

                  <div className="space-y-3 p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-brand-600">Küratör</span>
                        <TextInput
                          value={d.curatorName}
                          maxLength={60}
                          placeholder="Packing fişinde görünür (ör. Ayşe)"
                          onChange={(e) => patchTier(d.tierId, { curatorName: e.target.value, dirty: true })}
                        />
                      </label>
                    </div>

                    {d.items.length === 0 ? (
                      <p className="rounded-md border border-dashed border-brand-300 px-3 py-6 text-center text-xs text-brand-500">
                        Henüz ürün yok. Sağdaki havuzdan ekleyin.
                      </p>
                    ) : (
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th className="w-20">Sıra</th>
                            <th>Ürün</th>
                            <th className="w-40">Miktar</th>
                            <th className="w-28">Değiştirilebilir</th>
                            <th className="w-px"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.items.map((item, idx) => (
                            <tr key={item.productId}>
                              <td>
                                <ReorderButtons index={idx} count={d.items.length} onMove={(f, t) => moveTierItem(d.tierId, f, t)} disabled={d.saving} handle={false} />
                              </td>
                              <td>
                                <span className="block font-medium text-brand-900">{item.productName}</span>
                                <span className="block font-mono text-[10px] text-brand-400">{item.productSlug}</span>
                              </td>
                              <td>
                                <input
                                  value={item.qtyLabel}
                                  maxLength={60}
                                  onChange={(e) => updateItem(d.tierId, item.productId, { qtyLabel: e.target.value })}
                                  className={cn(inputCls, 'py-1 text-xs')}
                                  aria-label={`${item.productName} miktar`}
                                />
                              </td>
                              <td>
                                <Checkbox
                                  label={item.isSwappable ? 'Evet' : 'Hayır'}
                                  checked={item.isSwappable}
                                  onChange={(e) => updateItem(d.tierId, item.productId, { isSwappable: e.target.checked })}
                                />
                              </td>
                              <td>
                                <button type="button" onClick={() => removeFromTier(d.tierId, item.productId)} className={cn(btn.iconDanger, 'h-7 w-7')} aria-label={`${item.productName} çıkar`} title="Çıkar">
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t border-brand-100 pt-3">
                      <button type="button" onClick={() => void saveTier(d)} disabled={d.saving || (!d.dirty && !!d.template)} className={btn.outline}>
                        <Save className="h-4 w-4" aria-hidden />
                        {d.saving ? 'Kaydediliyor…' : d.template ? 'Kaydet' : 'Taslak olarak kaydet'}
                      </button>
                      <button type="button" onClick={() => void publishTier(d)} disabled={d.saving || d.items.length === 0 || (status === 'PUBLISHED' && !d.dirty)} className={btn.primary}>
                        <Send className="h-4 w-4" aria-hidden />
                        {status === 'PUBLISHED' && !d.dirty ? 'Yayında' : 'Yayınla'}
                      </button>
                      <button type="button" onClick={() => void cloneNext(d)} disabled={d.saving || !d.template} className={cn(btn.secondary, 'ml-auto')}>
                        <CopyPlus className="h-4 w-4" aria-hidden />
                        Gelecek haftaya kopyala
                      </button>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {/* Havuz */}
          <aside className="h-fit rounded-lg border border-brand-200 bg-white lg:sticky lg:top-16">
            <header className="border-b border-brand-200 bg-brand-50 px-3 py-2.5">
              <h2 className="text-sm font-semibold text-brand-900">Havuz (taze ürünler)</h2>
              <p className="text-[11px] text-brand-500">
                {active ? <>Tıklayınca <strong>{active.tierLabel}</strong> kutusuna eklenir.</> : 'Bir kutu seçin.'}
              </p>
            </header>
            <div className="p-2">
              <input
                type="search"
                value={poolQ}
                onChange={(e) => setPoolQ(e.target.value)}
                placeholder="Ürün ara…"
                aria-label="Havuzda ara"
                className={cn(inputCls, 'mb-2 py-1.5 text-xs')}
              />
              {pool.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-brand-500">Taze (isFresh) ürün yok.</p>
              ) : (
                <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                  {pool.map((p) => {
                    const inTier = active?.items.some((i) => i.productId === p.id) ?? false;
                    const soldOut = p.stockStatus === 'SOLD_OUT' || p.stockStatus === 'OUT_OF_SEASON';
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={!active || inTier}
                          onClick={() => active && addToTier(active.tierId, p)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                            inTier ? 'border-olive/30 bg-olive-soft/50 text-olive-deep' : 'border-brand-200 hover:border-accent hover:bg-accent-light',
                            'disabled:cursor-not-allowed',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-brand-900">{p.name}</span>
                            <span className="block truncate text-[10px] text-brand-400">{p.boxAmount ?? p.unit ?? ''}</span>
                          </span>
                          {p.stockStatus && soldOut && <StockStatusBadge status={p.stockStatus} />}
                          {!inTier && <Plus className="h-3.5 w-3.5 shrink-0 text-brand-400" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
