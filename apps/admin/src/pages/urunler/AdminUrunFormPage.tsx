import { ArrowLeft, ExternalLink, Save, SaveAll, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FormErrorBanner } from '../../components/ui/FormField';
import { useConfirm } from '../../contexts/ConfirmContext';
import { categoriesApi, producersApi, productsApi } from '../../features/catalog/api';
import { TabFiyat, TabGenel, TabKutu, TabMetinler, TabTercih } from '../../features/catalog/components/ProductFormTabs';
import { TabGorseller } from '../../features/catalog/components/TabGorseller';
import { TabPartiler } from '../../features/catalog/components/TabPartiler';
import {
  PRODUCT_TABS,
  createDefaultProductDraft,
  detailToDraft,
  tabsWithErrors,
  toProductBody,
  validateProductDraft,
  type ProductDraft,
  type ProductDraftErrors,
  type ProductTabKey,
} from '../../features/catalog/productForm';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminTabPanel } from '../../features/components/AdminTabPanel';
import { ProductStatusBadge, StockStatusBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { ApiError, errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminCategory, AdminProducer, AdminProductDetail, AdminProductImage, AdminProductLot } from '../../lib/adminTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

const LIST_PATH = '/katalog/urunler';

/** Ekran 3 — Ürün formu: Genel · Fiyat/KDV · Kutu · Tercih · Metinler · Partiler · Görseller. */
export function AdminUrunFormPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'yeni';
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [draft, setDraft] = useState<ProductDraft>(createDefaultProductDraft);
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [producers, setProducers] = useState<AdminProducer[]>([]);
  const [activeTab, setActiveTab] = useState<ProductTabKey>('genel');
  const [errors, setErrors] = useState<ProductDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [slugTouched, setSlugTouched] = useState(!isNew);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cats, prods] = await Promise.all([categoriesApi.list().catch(() => [] as AdminCategory[]), producersApi.list().catch(() => [] as AdminProducer[])]);
      setCategories([...cats].sort((a, b) => a.sortOrder - b.sortOrder));
      setProducers([...prods].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      if (!isNew && id) {
        const d = await productsApi.get(id);
        setDetail(d);
        setDraft(detailToDraft(d));
        setDirty(false);
      }
    } catch (e) {
      setLoadError(errorMessage(e, 'Ürün yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  // Kaydedilmemiş değişiklikte sekme kapatma uyarısı
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const patch = useCallback((p: Partial<ProductDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  }, []);

  const errorTabs = useMemo(() => tabsWithErrors(errors), [errors]);
  const tabs = PRODUCT_TABS.map((t) => ({ key: t.key, label: t.label, hasError: errorTabs.has(t.key) }));

  async function handleSave(andClose: boolean) {
    const v = validateProductDraft(draft);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      const firstTab = PRODUCT_TABS.find((t) => tabsWithErrors(v).has(t.key));
      if (firstTab) setActiveTab(firstTab.key);
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = toProductBody(draft);
    try {
      if (isNew) {
        const created = await productsApi.create(body);
        toast.success('Ürün oluşturuldu');
        setDirty(false);
        if (andClose) navigate(LIST_PATH);
        else navigate(`${LIST_PATH}/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await productsApi.update(id, body);
        setDetail((prev) => ({ ...(prev ?? updated), ...updated, images: updated.images ?? prev?.images ?? [], lots: updated.lots ?? prev?.lots ?? [] }));
        setDraft(detailToDraft({ ...(detail ?? updated), ...updated }));
        setDirty(false);
        toast.success('Ürün kaydedildi');
        if (andClose) navigate(LIST_PATH);
      }
    } catch (err) {
      const fe = extractFieldErrors(err) as ProductDraftErrors;
      if (err instanceof ApiError && err.kind === 'conflict') {
        fe.slug = err.message || 'Bu slug zaten kullanılıyor';
        setActiveTab('genel');
      }
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
      const firstTab = PRODUCT_TABS.find((t) => tabsWithErrors(fe).has(t.key));
      if (firstTab) setActiveTab(firstTab.key);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !detail) return;
    const ok = await confirm({
      title: 'Ürünü sil',
      description: `"${detail.name}" silinecek (yumuşak silme). Haftanın kutusu şablonlarında ürün varsa önce oradan çıkarın.`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await productsApi.remove(id);
      toast.success('Ürün silindi');
      setDirty(false);
      navigate(LIST_PATH);
    } catch (e) {
      toast.error(errorMessage(e, 'Silinemedi'));
    }
  }

  async function handleBack() {
    if (dirty) {
      const ok = await confirm({ title: 'Kaydedilmemiş değişiklikler', description: 'Değişiklikler kaydedilmeden çıkılsın mı?', confirmLabel: 'Çık', danger: true });
      if (!ok) return;
    }
    navigate(LIST_PATH);
  }

  const title = isNew ? 'Yeni ürün' : detail?.name || 'Ürün düzenle';
  const productId = isNew ? null : (id ?? null);

  const lots: AdminProductLot[] = detail?.lots ?? [];
  const images: AdminProductImage[] = detail?.images ?? [];

  function setLots(next: AdminProductLot[]) {
    setDetail((prev) => (prev ? { ...prev, lots: next, currentLot: next.find((l) => l.isCurrent) ?? null } : prev));
  }
  function setImages(next: AdminProductImage[]) {
    setDetail((prev) => (prev ? { ...prev, images: next } : prev));
  }

  return (
    <div className="px-4 pb-24 pt-4 sm:pb-6">
      <AdminPageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
            {!isNew && detail && (
              <>
                <ProductStatusBadge status={detail.status} />
                <StockStatusBadge status={detail.stockStatus} />
              </>
            )}
          </span>
        }
        crumb={isNew ? 'Yeni' : detail?.name}
        description={
          isNew ? (
            'Önce Genel + Fiyat + Metinler alanlarını doldurup kaydedin; Partiler ve Görseller kaydettikten sonra açılır.'
          ) : detail ? (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono">{detail.slug}</span>
              <a href={`/urun.html?id=${encodeURIComponent(detail.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Sitede gör <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              {dirty && <span className="text-butter-deep">• kaydedilmemiş değişiklik</span>}
            </span>
          ) : null
        }
        actions={
          <>
            <button type="button" onClick={() => void handleBack()} className={btn.secondary}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Geri
            </button>
            {!isNew && detail && (
              <button type="button" onClick={() => void handleDelete()} className={cn(btn.secondary, 'text-accent-dark hover:border-accent-dark')}>
                <Trash2 className="h-4 w-4" aria-hidden /> Sil
              </button>
            )}
            <button type="button" onClick={() => void handleSave(false)} disabled={saving || loading} className={btn.outline}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button type="button" onClick={() => void handleSave(true)} disabled={saving || loading} className={btn.primary}>
              <SaveAll className="h-4 w-4" aria-hidden />
              Kaydet ve kapat
            </button>
          </>
        }
      />

      {loading ? (
        <LoadingBlock label="Ürün yükleniyor…" />
      ) : loadError ? (
        <ErrorBlock message={loadError} onRetry={() => void load()} />
      ) : (
        <div className="rounded-lg border border-brand-200 bg-white p-4">
          <FormErrorBanner message={formError} />
          <div className={cn(formError && 'mt-3')}>
            <AdminTabPanel tabs={tabs} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as ProductTabKey)}>
              {activeTab === 'genel' && (
                <TabGenel draft={draft} patch={patch} errors={errors} categories={categories} producers={producers} slugTouched={slugTouched} setSlugTouched={setSlugTouched} isNew={isNew} />
              )}
              {activeTab === 'fiyat' && (
                <TabFiyat draft={draft} patch={patch} errors={errors} categories={categories} producers={producers} slugTouched={slugTouched} setSlugTouched={setSlugTouched} isNew={isNew} />
              )}
              {activeTab === 'kutu' && (
                <TabKutu draft={draft} patch={patch} errors={errors} categories={categories} producers={producers} slugTouched={slugTouched} setSlugTouched={setSlugTouched} isNew={isNew} />
              )}
              {activeTab === 'tercih' && (
                <TabTercih draft={draft} patch={patch} errors={errors} categories={categories} producers={producers} slugTouched={slugTouched} setSlugTouched={setSlugTouched} isNew={isNew} />
              )}
              {activeTab === 'metinler' && (
                <TabMetinler draft={draft} patch={patch} errors={errors} categories={categories} producers={producers} slugTouched={slugTouched} setSlugTouched={setSlugTouched} isNew={isNew} />
              )}
              {activeTab === 'partiler' && (
                <TabPartiler productId={productId} lots={lots} onChange={setLots} producers={producers} defaultProducerId={draft.producerId} />
              )}
              {activeTab === 'gorseller' && <TabGorseller productId={productId} images={images} onChange={setImages} productName={draft.name} />}
            </AdminTabPanel>
          </div>
        </div>
      )}

      {/* Mobil yapışkan kaydet çubuğu */}
      <div className="fixed inset-x-0 bottom-14 z-30 flex gap-2 border-t border-brand-200 bg-white px-4 py-2 sm:hidden">
        <Link to={LIST_PATH} className={cn(btn.secondary, 'px-3')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <button type="button" onClick={() => void handleSave(false)} disabled={saving || loading} className={cn(btn.outline, 'flex-1')}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        <button type="button" onClick={() => void handleSave(true)} disabled={saving || loading} className={cn(btn.primary, 'flex-1')}>
          Kaydet ve kapat
        </button>
      </div>
    </div>
  );
}
