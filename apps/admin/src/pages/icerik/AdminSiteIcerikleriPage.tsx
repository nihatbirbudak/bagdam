import { LayoutTemplate, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FormErrorBanner, Select } from '../../components/ui/FormField';
import { SchemaForm } from '../../components/ui/SchemaForm';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { FeaturedPicker } from '../../features/icerik/FeaturedPicker';
import { ImagePathPicker } from '../../features/icerik/ImagePathPicker';
import { siteContentApi } from '../../features/icerik/api';
import {
  fromFormState,
  inferSchemaFromValue,
  normalizeSchema,
  toFormState,
  validateValues,
  type ContentFieldNormalized,
  type FormState,
} from '../../features/icerik/schemaForm';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminSiteContent } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime } from '../../lib/utils';

export type SiteContentMode = 'site' | 'promo-footer';

/** Ekran 10'a giden bloklar: registry `page: 'global'` (promoBar, footer, iletişim); `page` yoksa anahtardan. Kalanı ekran 9. */
export function isPromoFooterKey(key: string, page?: string | null): boolean {
  if (page) return page === 'global';
  return key === 'promoBar' || key === 'footer' || /^(promo|footer|contact|iletisim)[.A-Z]?/.test(key);
}

/**
 * `home.featured` registry'de `list` (type/ref/order) olarak tanımlıdır; admin'de ürün/tier seçici kullanılsın diye
 * `items` alanı `featured` tipine çevrilir (değer şekli aynı: `{items:[{type,ref,order}]}`).
 */
export function applyFeaturedEditor(key: string, fields: ContentFieldNormalized[]): ContentFieldNormalized[] {
  if (key !== 'home.featured') return fields;
  return fields.map((f) => {
    if (f.type !== 'list') return f;
    const names = new Set((f.itemFields ?? []).map((x) => x.name));
    return names.has('type') && names.has('ref') ? { ...f, type: 'featured' } : f;
  });
}

/** Anahtar öneki → grup başlığı (sol liste). */
const GROUP_LABELS: Array<[RegExp, string]> = [
  [/^home\./, 'Ana sayfa'],
  [/^urunler\./, 'Ürünler'],
  [/^kutu\./, 'Kutu'],
  [/^manifesto\./, 'Nasıl seçiyoruz'],
  [/^toptan\./, 'Toptan'],
  [/^gunluk\./, 'Günlük'],
  [/^politikalar\./, 'Politikalar'],
  [/^sepet\./, 'Sepet'],
  [/^uyelik\./, 'Üyelik'],
  [/^nav/, 'Menü'],
  [/^promo/, 'Promosyon'],
  [/^footer/, 'Alt bilgi'],
  [/^(contact|iletisim)/, 'İletişim'],
];
const GROUP_ORDER = ['Promosyon', 'Alt bilgi', 'İletişim', 'Ana sayfa', 'Ürünler', 'Kutu', 'Nasıl seçiyoruz', 'Toptan', 'Günlük', 'Politikalar', 'Sepet', 'Üyelik', 'Menü', 'Diğer'];

export function groupLabelFor(key: string): string {
  for (const [re, label] of GROUP_LABELS) if (re.test(key)) return label;
  return 'Diğer';
}

function groupBlocks(blocks: AdminSiteContent[]): Array<{ label: string; items: AdminSiteContent[] }> {
  const map = new Map<string, AdminSiteContent[]>();
  for (const b of blocks) {
    const g = groupLabelFor(b.key);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(b);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
}

/**
 * Ekran 9 (Site Blokları) / 10 (Promo-Footer-İletişim): `GET /admin/site-content` → sol liste, sağda seçili anahtarın
 * şemadan üretilen formu (`SchemaForm`); `home.featured` için ürün/tier seçici. Kaydet → `PUT /admin/site-content/:key {value}`.
 */
export function AdminSiteIcerikleriPage({ mode }: { mode: SiteContentMode }) {
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [blocks, setBlocks] = useState<AdminSiteContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await siteContentApi.list();
      setBlocks(list.filter((b) => (mode === 'promo-footer' ? isPromoFooterKey(b.key, b.page) : !isPromoFooterKey(b.key, b.page))));
    } catch (e) {
      setError(errorMessage(e, 'Site içerikleri yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const orderedKeys = useMemo(() => groups.flatMap((g) => g.items.map((b) => b.key)), [groups]);
  const requested = params.get('key');
  const selectedKey = requested && orderedKeys.includes(requested) ? requested : (orderedKeys[0] ?? null);
  const selected = blocks.find((b) => b.key === selectedKey) ?? null;

  async function select(key: string) {
    if (key === selectedKey) return;
    if (dirty) {
      const ok = await confirm({ title: 'Kaydedilmemiş değişiklikler', description: 'Bu bloktaki değişiklikler kaydedilmeden başka bloğa geçilsin mi?', confirmLabel: 'Geç', danger: true });
      if (!ok) return;
    }
    setDirty(false);
    const next = new URLSearchParams(params);
    next.set('key', key);
    setParams(next, { replace: true });
  }

  function onSaved(updated: AdminSiteContent) {
    setBlocks((prev) => prev.map((b) => (b.key === updated.key ? { ...b, ...updated } : b)));
    setDirty(false);
  }

  const title = mode === 'promo-footer' ? 'Promo / Footer / İletişim' : 'Site İçerikleri';
  const description =
    mode === 'promo-footer'
      ? 'Üst promosyon şeridi (promoBar) ile alt bilgi ve iletişim (footer). Kaydedince site anında güncellenir (önbellek ≤ 60 sn).'
      : 'Sayfa blokları (ana sayfa, ürünler, kutu, manifesto, toptan, günlük): şemadan üretilen form; home.featured ürün/kutu karışık sıra. Kaydedince site anında güncellenir (önbellek ≤ 60 sn).';

  return (
    <div className="px-4 py-4">
      <AdminPageHeader title={title} description={description} />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : blocks.length === 0 ? (
        <AdminEmptyState icon={LayoutTemplate} message="İçerik bloğu bulunamadı (içerik seed'i F5 — `pnpm db:seed`)." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          {/* Mobil: açılır liste */}
          <div className="lg:hidden">
            <Select value={selectedKey ?? ''} onChange={(e) => void select(e.target.value)} aria-label="Blok seç">
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((b) => (
                    <option key={b.key} value={b.key}>{b.label}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          {/* Masaüstü: sol liste */}
          <nav className="hidden lg:block" aria-label="İçerik blokları">
            <div className="sticky top-16 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-brand-200 bg-white p-2">
              {groups.map((g) => (
                <div key={g.label} className="mb-2">
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-400">{g.label}</p>
                  {g.items.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => void select(b.key)}
                      aria-current={b.key === selectedKey ? 'page' : undefined}
                      className={cn(
                        'block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        b.key === selectedKey ? 'bg-accent/10 font-semibold text-accent' : 'text-brand-700 hover:bg-brand-50 hover:text-accent',
                      )}
                    >
                      <span className="block truncate">{b.label}</span>
                      <span className="block truncate font-mono text-[10px] text-brand-400">{b.key}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>

          <div className="min-w-0">
            {selected ? <BlockEditor key={selected.key} block={selected} onSaved={onSaved} onDirtyChange={setDirty} /> : <InlineNotice tone="info">Soldan bir blok seçin.</InlineNotice>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tek bloğun formu: şema → SchemaForm; değişiklik takibi; kaydet / sıfırla. */
function BlockEditor({ block, onSaved, onDirtyChange }: { block: AdminSiteContent; onSaved: (b: AdminSiteContent) => void; onDirtyChange: (d: boolean) => void }) {
  const fields = useMemo<ContentFieldNormalized[]>(() => {
    const fromSchema = normalizeSchema(block.schema);
    return applyFeaturedEditor(block.key, fromSchema.length ? fromSchema : inferSchemaFromValue(block.value, block.key));
  }, [block.schema, block.value, block.key]);
  const schemaMissing = normalizeSchema(block.schema).length === 0;
  const [initial, setInitial] = useState<FormState>(() => toFormState(fields, block.value));
  const [state, setState] = useState<FormState>(() => toFormState(fields, block.value));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(state.values) !== JSON.stringify(initial.values);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Kaydedilmemiş değişiklikte sekme kapatma uyarısı
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validateValues(fields, state.values);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const value = fromFormState(fields, state);
    try {
      const updated = await siteContentApi.update(block.key, value);
      const next: AdminSiteContent = { ...block, ...(updated ?? {}), value: updated?.value ?? value };
      const fs = toFormState(fields, next.value);
      setInitial(fs);
      setState(fs);
      onSaved(next);
      toast.success(`“${block.label}” kaydedildi`);
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setState(initial);
    setErrors({});
    setFormError(null);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-lg border border-brand-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-brand-800">{block.label}</h2>
          <p className="font-mono text-[11px] text-brand-500">{block.key}</p>
        </div>
        <p className="text-[11px] text-brand-500">
          Son güncelleme: {formatDateTime(block.updatedAt)}
          {block.updatedBy ? ` · ${block.updatedBy}` : ''}
        </p>
      </header>
      <div className="space-y-4 p-4">
        <FormErrorBanner message={formError} />
        {schemaMissing && (
          <InlineNotice tone="warning">Bu blok için şema tanımlı değil; alanlar mevcut değerden türetildi. Sunucu bilinmeyen alanı reddedebilir (400).</InlineNotice>
        )}
        <SchemaForm fields={fields} values={state.values} onChange={(values) => setState((s) => ({ ...s, values }))} errors={errors} disabled={saving} ImagePicker={ImagePathPicker} FeaturedEditor={FeaturedPicker} columns={2} />
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-brand-200 bg-brand-50/60 px-4 py-3">
        {dirty && <span className="mr-auto text-xs text-butter-deep">Kaydedilmemiş değişiklik var</span>}
        <button type="button" onClick={reset} disabled={!dirty || saving} className={btn.secondary}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Sıfırla
        </button>
        <button type="submit" disabled={!dirty || saving} className={btn.primary}>
          <Save className="h-4 w-4" aria-hidden />
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </footer>
    </form>
  );
}
