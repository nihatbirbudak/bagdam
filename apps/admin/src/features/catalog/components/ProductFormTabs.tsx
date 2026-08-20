import { PRODUCT_STATUS_LABELS, PRODUCT_STATUS_VALUES, STOCK_STATUS_LABELS, STOCK_STATUS_VALUES, type ProductStatus, type StockStatus } from '@bagdam/shared';
import { Plus, Trash2 } from 'lucide-react';
import { Checkbox, Field, FormSection, Select, TextArea, TextInput } from '../../../components/ui/FormField';
import type { AdminCategory, AdminProducer } from '../../../lib/adminTypes';
import { btn } from '../../../lib/buttonStyles';
import { cn } from '../../../lib/utils';
import { PRODUCT_GROUP_SUGGESTIONS, UNIT_SUGGESTIONS, VAT_RATE_OPTIONS, parsePrefOptions, suggestSlug, type ProductDraft, type ProductDraftErrors } from '../productForm';

export interface TabProps {
  draft: ProductDraft;
  patch: (p: Partial<ProductDraft>) => void;
  errors: ProductDraftErrors;
  categories: AdminCategory[];
  producers: AdminProducer[];
  /** Slug elle değiştirildi mi (ad → slug türetmeyi durdurur). */
  slugTouched: boolean;
  setSlugTouched: (v: boolean) => void;
  isNew: boolean;
}

/* ── Genel ─────────────────────────────────────────────────────────────── */

export function TabGenel({ draft, patch, errors, categories, producers, slugTouched, setSlugTouched, isNew }: TabProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        <Field label="Ürün adı" required error={errors.name}>
          {({ id, invalid }) => (
            <TextInput
              id={id}
              invalid={invalid}
              value={draft.name}
              maxLength={120}
              autoFocus={isNew}
              onChange={(e) => {
                const name = e.target.value;
                patch(slugTouched ? { name } : { name, slug: suggestSlug(name) });
              }}
            />
          )}
        </Field>
        <Field label="Slug" required hint="urun.html?id=<slug> ve sepet anahtarı. Ad yazılırken türetilir; kaydedildikten sonra değiştirmek eski bağlantıları kırar." error={errors.slug}>
          {({ id, invalid }) => (
            <TextInput
              id={id}
              invalid={invalid}
              value={draft.slug}
              maxLength={80}
              className="font-mono"
              onChange={(e) => {
                setSlugTouched(true);
                patch({ slug: e.target.value });
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kategori" required error={errors.categoryId}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} value={draft.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
                <option value="">Seçin…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}{!c.isActive ? ' (pasif)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Grup" hint="Site filtresi (products.js `category`): meyve · sebze · bakliyat · süt ürünleri · fırın." error={errors.group}>
            {({ id, invalid }) => (
              <>
                <TextInput id={id} invalid={invalid} list="product-group-list" value={draft.group} maxLength={40} onChange={(e) => patch({ group: e.target.value })} />
                <datalist id="product-group-list">
                  {PRODUCT_GROUP_SUGGESTIONS.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Üretici" hint="Meta satırı: “Üretici · Köy · İlçe”." error={errors.producerId}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} value={draft.producerId} onChange={(e) => patch({ producerId: e.target.value })}>
                <option value="">— Yok —</option>
                {producers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.village ? ` · ${p.village}` : ''}{!p.isActive ? ' (pasif)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Meta notu" hint="Meta satırının sonuna eklenir (ör. “Erken Hasat”)." error={errors.metaNote}>
            {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.metaNote} maxLength={80} onChange={(e) => patch({ metaNote: e.target.value })} />}
          </Field>
        </div>
      </div>

      <aside className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/60 p-4">
        <Field label="Durum" error={errors.status}>
          {({ id }) => (
            <Select id={id} value={draft.status} onChange={(e) => patch({ status: e.target.value as ProductStatus })}>
              {PRODUCT_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>{PRODUCT_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Stok durumu" hint="Tükendi / Sezon dışı ürünler sitede listelenmez." error={errors.stockStatus}>
          {({ id }) => (
            <Select id={id} value={draft.stockStatus} onChange={(e) => patch({ stockStatus: e.target.value as StockStatus })}>
              {STOCK_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>{STOCK_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Sıra" hint="Listede görünüm sırası (küçük önce); listeden sürükleyerek de değişir." error={errors.sortOrder}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.sortOrder} onChange={(e) => patch({ sortOrder: e.target.value })} />}
        </Field>
      </aside>
    </div>
  );
}

/* ── Fiyat / KDV ───────────────────────────────────────────────────────── */

export function TabFiyat({ draft, patch, errors }: TabProps) {
  function updateExtra(i: number, p: Partial<{ factor: string; label: string }>) {
    patch({ extraOptions: draft.extraOptions.map((o, idx) => (idx === i ? { ...o, ...p } : o)) });
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fiyat (₺, KDV dahil)" required hint="Virgül ondalık: 129,50" error={errors.price}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={draft.price} onChange={(e) => patch({ price: e.target.value })} />}
        </Field>
        <Field label="KDV oranı (%)" hint="Fiyat KDV dahildir; oran fatura/kırılım için." error={errors.vatRate}>
          {({ id, invalid }) => (
            <Select id={id} invalid={invalid} value={String(draft.vatRate)} onChange={(e) => patch({ vatRate: Number(e.target.value) })}>
              {VAT_RATE_OPTIONS.map((v) => (
                <option key={v} value={v}>%{v}</option>
              ))}
              {!VAT_RATE_OPTIONS.includes(draft.vatRate as (typeof VAT_RATE_OPTIONS)[number]) && <option value={draft.vatRate}>%{draft.vatRate}</option>}
            </Select>
          )}
        </Field>
        <Field label="Birim" required hint="Fiyatın birimi: adet · kg · 500 g · demet…" error={errors.unit}>
          {({ id, invalid }) => (
            <>
              <TextInput id={id} invalid={invalid} list="product-unit-list" value={draft.unit} maxLength={40} onChange={(e) => patch({ unit: e.target.value })} />
              <datalist id="product-unit-list">
                {UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </div>

      <FormSection title="Ekstra miktar seçenekleri" description="Abonelik kutusuna “ekstra” eklerken sunulan miktarlar ({çarpan, etiket}). Varsayılan: Ayarlar › commerce.extraAmountOptions.">
        <Checkbox
          label="Varsayılan seçenekleri kullan"
          description="İşaretliyken ürün için özel liste tutulmaz (extraOptions = null)."
          checked={draft.useDefaultExtraOptions}
          onChange={(e) => patch({ useDefaultExtraOptions: e.target.checked, extraOptions: e.target.checked ? draft.extraOptions : draft.extraOptions.length ? draft.extraOptions : [{ factor: '1', label: draft.unit || '1 adet' }] })}
        />
        {!draft.useDefaultExtraOptions && (
          <div className="space-y-2">
            {errors.extraOptions && <p className="text-xs text-accent-dark" role="alert">{errors.extraOptions}</p>}
            {draft.extraOptions.map((o, i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr_auto] items-start gap-2">
                <Field error={errors[`extraOptions.${i}.factor`]}>
                  {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" placeholder="Çarpan (0,25)" value={o.factor} onChange={(e) => updateExtra(i, { factor: e.target.value })} />}
                </Field>
                <Field error={errors[`extraOptions.${i}.label`]}>
                  {({ id, invalid }) => <TextInput id={id} invalid={invalid} placeholder="Etiket (250 g)" value={o.label} onChange={(e) => updateExtra(i, { label: e.target.value })} />}
                </Field>
                <button type="button" onClick={() => patch({ extraOptions: draft.extraOptions.filter((_, idx) => idx !== i) })} className={btn.iconDanger} aria-label="Seçeneği sil">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => patch({ extraOptions: [...draft.extraOptions, { factor: '', label: '' }] })} className={cn(btn.secondary, btn.sm)}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Seçenek ekle
            </button>
          </div>
        )}
      </FormSection>
    </div>
  );
}

/* ── Kutu ──────────────────────────────────────────────────────────────── */

export function TabKutu({ draft, patch, errors }: TabProps) {
  return (
    <div className="space-y-6">
      <FormSection title="Kutu havuzu" description="Taze ürünler haftanın kutusu havuzuna girer (kutu.html `pool`); kiler/raf ürünleri girmez.">
        <Checkbox label="Taze ürün (isFresh)" description="İşaretliyse Haftanın Kutusu ekranındaki havuzda görünür." checked={draft.isFresh} onChange={(e) => patch({ isFresh: e.target.checked })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kutuda miktar" hint="Ürün kartında “kutuda: …” (ör. 1 kg, 1 demet)." error={errors.boxAmount}>
            {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.boxAmount} maxLength={60} onChange={(e) => patch({ boxAmount: e.target.value })} />}
          </Field>
          <Field label="Sezon" hint="Bilgi amaçlı etiket (ör. yaz, sonbahar); sitede rozet." error={errors.season}>
            {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.season} maxLength={40} onChange={(e) => patch({ season: e.target.value })} />}
          </Field>
        </div>
      </FormSection>

      <FormSection title="Kutuya eşlik eden ürün" description="kutu.html “kutuna ekle” listesi (pairIds) — pairOrder sırasıyla.">
        <Checkbox label="Kutuya eşlik etsin (pairWithBox)" checked={draft.pairWithBox} onChange={(e) => patch({ pairWithBox: e.target.checked })} />
        <Field label="Eşlik sırası" hint="Küçük önce." error={errors.pairOrder} className="max-w-xs">
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.pairOrder} disabled={!draft.pairWithBox} onChange={(e) => patch({ pairOrder: e.target.value })} />}
        </Field>
      </FormSection>
    </div>
  );
}

/* ── Tercih ────────────────────────────────────────────────────────────── */

export function TabTercih({ draft, patch, errors }: TabProps) {
  const options = parsePrefOptions(draft.prefOptionsText);
  return (
    <div className="space-y-4">
      <p className="text-xs text-brand-500">
        Ürün sayfasında müşteriye sunulan tek seçimlik tercih (products.js <code>pref: {'{label, options, def}'}</code>). Ör. “Olgunluk: Sert · Orta · Yumuşak”. Boş bırakılırsa tercih yok.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tercih etiketi" error={errors.prefLabel}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.prefLabel} maxLength={40} placeholder="Olgunluk" onChange={(e) => patch({ prefLabel: e.target.value })} />}
        </Field>
        <Field label="Varsayılan seçenek" hint="Seçenek listesindeki sıra (0 tabanlı)." error={errors.prefDefault}>
          {({ id, invalid }) =>
            options.length ? (
              <Select id={id} invalid={invalid} value={draft.prefDefault} onChange={(e) => patch({ prefDefault: e.target.value })}>
                <option value="">— Yok —</option>
                {options.map((o, i) => (
                  <option key={`${o}-${i}`} value={String(i)}>{i} — {o}</option>
                ))}
              </Select>
            ) : (
              <TextInput id={id} invalid={invalid} value={draft.prefDefault} inputMode="numeric" placeholder="0" onChange={(e) => patch({ prefDefault: e.target.value })} />
            )
          }
        </Field>
      </div>
      <Field label="Seçenekler" hint="Her satıra bir seçenek." error={errors.prefOptionsText}>
        {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={5} value={draft.prefOptionsText} placeholder={'Sert\nOrta\nYumuşak'} onChange={(e) => patch({ prefOptionsText: e.target.value })} />}
      </Field>
    </div>
  );
}

/* ── Metinler ──────────────────────────────────────────────────────────── */

export function TabMetinler({ draft, patch, errors }: TabProps) {
  return (
    <div className="space-y-4">
      <Field label="Açıklama" required hint="Ürün sayfasının ana metni." error={errors.description}>
        {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={6} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />}
      </Field>
      <Field label="Saklama" hint="“Nasıl saklanır” bloğu." error={errors.storageText}>
        {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={3} value={draft.storageText} onChange={(e) => patch({ storageText: e.target.value })} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Alerjen" error={errors.allergenText}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.allergenText} maxLength={120} placeholder="Süt ürünü içerir" onChange={(e) => patch({ allergenText: e.target.value })} />}
        </Field>
        <Field label="Tazelik notu" error={errors.freshnessNote}>
          {({ id, invalid }) => <TextInput id={id} invalid={invalid} value={draft.freshnessNote} maxLength={120} placeholder="Hasattan 24 saat içinde" onChange={(e) => patch({ freshnessNote: e.target.value })} />}
        </Field>
      </div>
      <p className="text-[11px] text-brand-500">
        “Neden seçtik” metni parti (lot) bazlıdır → <strong>Partiler</strong> sekmesi (güncel lot'un tadım notu). Meta notu → <strong>Genel</strong>.
      </p>
    </div>
  );
}
