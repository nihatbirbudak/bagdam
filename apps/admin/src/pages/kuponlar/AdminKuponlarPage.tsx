import { COUPON_KIND_LABELS, COUPON_KIND_VALUES, COUPON_SCOPE_LABELS, COUPON_SCOPE_VALUES, type CouponKind, type CouponScope } from '@bagdam/shared';
import { History, Pencil, Plus, RotateCcw, Save, TicketPercent, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Checkbox, Field, FormErrorBanner, Select, TextArea, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { couponsApi } from '../../features/kuponlar/api';
import {
  COUPON_STATE_LABELS,
  COUPON_STATE_STYLE,
  EMPTY_COUPON_DRAFT,
  couponDiscountLabel,
  couponScopeLabel,
  couponState,
  couponToDraft,
  couponUsageLabel,
  isCouponDraftDirty,
  normalizeCouponCode,
  toCouponBody,
  validateCouponDraft,
  type CouponDraft,
} from '../../features/kuponlar/coupons';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminCouponDetail, CouponListItem } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime, formatTry } from '../../lib/utils';

const LIMIT_DEFAULT = 25;
type ActiveFilter = '' | 'true' | 'false';
const ACTIVE_OPTIONS: ReadonlyArray<{ key: ActiveFilter; label: string }> = [
  { key: '', label: 'Tümü' },
  { key: 'true', label: 'Aktif' },
  { key: 'false', label: 'Pasif' },
];

type PanelState = { mode: 'new' } | { mode: 'edit'; coupon: CouponListItem } | null;

function CouponStateBadge({ coupon }: { coupon: CouponListItem }) {
  const s = couponState(coupon);
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', COUPON_STATE_STYLE[s])}>{COUPON_STATE_LABELS[s]}</span>;
}

/**
 * Ekran 23 — Kuponlar: liste (arama, aktif/pasif, sayfalama), oluştur/düzenle (modal form), aktif-pasif, sil (soft),
 * kullanımlar (CouponRedemption). Hesap ve kurallar PricingService'te; panel yalnız tanımlar.
 */
export function AdminKuponlarPage() {
  const [params, setParams] = useSearchParams();
  const confirm = useConfirm();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const q = params.get('q') ?? '';
  const active = (params.get('active') ?? '') as ActiveFilter;

  const [items, setItems] = useState<CouponListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [panel, setPanel] = useState<PanelState>(null);
  const [initial, setInitial] = useState<CouponDraft>(EMPTY_COUPON_DRAFT);
  const [draft, setDraft] = useState<CouponDraft>(EMPTY_COUPON_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<{ coupon: CouponListItem; data: AdminCouponDetail | null; error: string | null } | null>(null);

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
      const res = await couponsApi.list({ page, limit, q: q || undefined, active: active || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'Kuponlar yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, q, active]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = useCallback((v: string) => setParam({ q: v, page: 1 }), [setParam]);

  function openNew() {
    setInitial(EMPTY_COUPON_DRAFT);
    setDraft(EMPTY_COUPON_DRAFT);
    setErrors({});
    setFormError(null);
    setPanel({ mode: 'new' });
  }

  async function openEdit(c: CouponListItem) {
    // Liste satırında minSubtotal/perUserLimit/note yok → detayı çek; olmazsa liste verisiyle aç.
    let base: CouponListItem | AdminCouponDetail = c;
    try {
      base = await couponsApi.get(c.id);
    } catch {
      /* liste satırı ile devam */
    }
    const d = couponToDraft(base);
    setInitial(d);
    setDraft(d);
    setErrors({});
    setFormError(null);
    setPanel({ mode: 'edit', coupon: c });
  }

  function patch(p: Partial<CouponDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!panel) return;
    const v = validateCouponDraft(draft);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = toCouponBody(draft);
    try {
      if (panel.mode === 'new') {
        await couponsApi.create(body);
        toast.success(`Kupon oluşturuldu: ${body.code}`);
      } else {
        await couponsApi.update(panel.coupon.id, body);
        toast.success(`Kupon güncellendi: ${body.code}`);
      }
      setPanel(null);
      await load();
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: CouponListItem) {
    setBusyId(c.id);
    const next = !c.isActive;
    const prev = items;
    setItems((list) => list.map((x) => (x.id === c.id ? { ...x, isActive: next } : x)));
    try {
      await couponsApi.setActive(c.id, next);
      toast.success(next ? `${c.code} aktif` : `${c.code} pasif`);
    } catch (e) {
      setItems(prev);
      toast.error(errorMessage(e, 'Durum değiştirilemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: CouponListItem) {
    const ok = await confirm({
      title: 'Kuponu sil',
      description: `${c.code} silinecek (soft delete). Geçmiş kullanımlar ve sipariş kayıtları etkilenmez; kod yeniden kullanılamayabilir.`,
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    setBusyId(c.id);
    try {
      await couponsApi.remove(c.id);
      toast.success(`${c.code} silindi`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Silinemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function openDetail(c: CouponListItem) {
    setDetail({ coupon: c, data: null, error: null });
    try {
      const data = await couponsApi.get(c.id);
      setDetail((d) => (d && d.coupon.id === c.id ? { ...d, data } : d));
    } catch (e) {
      setDetail((d) => (d && d.coupon.id === c.id ? { ...d, error: errorMessage(e, 'Kullanımlar yüklenemedi') } : d));
    }
  }

  const dirty = isCouponDraftDirty(initial, draft);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Kuponlar"
        description="İndirim kuponları: yüzde ya da tutar; tüm sepet / tekil ürün / kutu kapsamı; alt sınır, tarih aralığı, toplam ve üye başına kullanım sınırı. Kod sepette girilir; indirim PricingService'te hesaplanır, ödeme PAID olunca kullanım sayılır."
        actions={
          <button type="button" onClick={openNew} className={btn.primary}>
            <Plus className="h-4 w-4" aria-hidden />
            Yeni kupon
          </button>
        }
      />

      <AdminToolbar
        className="mb-3"
        searchPlaceholder="Kupon kodu ara…"
        searchValue={q}
        onSearchChange={onSearch}
        filters={<FilterPills options={ACTIVE_OPTIONS} value={active} onChange={(v) => setParam({ active: v, page: 1 })} label="Durum" />}
      />

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={TicketPercent} message={q || active ? 'Filtreye uyan kupon yok.' : 'Henüz kupon yok.'} cta={{ label: 'Yeni kupon', onClick: openNew }} />
      ) : (
        <AdminScrollTable footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Kod</th>
                <th className={th}>İndirim</th>
                <th className={th}>Kapsam</th>
                <th className={th}>Geçerlilik</th>
                <th className={th}>Kullanım</th>
                <th className={th}>Durum</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={cn(!c.isActive && 'bg-brand-50/60 text-brand-500')}>
                  <td className={td}>
                    <button type="button" onClick={() => void openEdit(c)} className="font-mono font-semibold text-brand-900 hover:text-accent">
                      {c.code}
                    </button>
                  </td>
                  <td className={td}>
                    <span className="font-medium">{couponDiscountLabel(c)}</span>
                    <span className="block text-[11px] text-brand-500">{(COUPON_KIND_LABELS as Record<string, string>)[c.kind] ?? c.kind}</span>
                  </td>
                  <td className={cn(tdText, 'text-xs')}>{couponScopeLabel(c.appliesTo)}</td>
                  <td className={cn(td, 'text-xs')}>
                    {c.startsAt || c.endsAt ? (
                      <>
                        <span className="block">{c.startsAt ? formatDateTime(c.startsAt) : 'hemen'}</span>
                        <span className="block text-brand-500">→ {c.endsAt ? formatDateTime(c.endsAt) : 'süresiz'}</span>
                      </>
                    ) : (
                      <span className="text-brand-400">süresiz</span>
                    )}
                  </td>
                  <td className={td}>
                    <button type="button" onClick={() => void openDetail(c)} className="inline-flex items-center gap-1 hover:text-accent" aria-label={`${c.code} kullanımları`}>
                      <History className="h-3.5 w-3.5" aria-hidden />
                      {couponUsageLabel(c)}
                    </button>
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <CouponStateBadge coupon={c} />
                      <button
                        type="button"
                        role="switch"
                        aria-checked={c.isActive}
                        aria-label={`${c.code} ${c.isActive ? 'pasife al' : 'aktif et'}`}
                        disabled={busyId === c.id}
                        onClick={() => void toggleActive(c)}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-50',
                          c.isActive ? 'border-olive bg-olive' : 'border-brand-300 bg-brand-200',
                        )}
                      >
                        <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', c.isActive ? 'translate-x-4' : 'translate-x-0.5')} />
                      </button>
                    </div>
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => void openEdit(c)} className={btn.icon} aria-label={`${c.code} düzenle`} title="Düzenle">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button type="button" onClick={() => void remove(c)} disabled={busyId === c.id} className={btn.iconDanger} aria-label={`${c.code} sil`} title="Sil">
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

      {/* Oluştur / düzenle */}
      <Modal
        open={!!panel}
        onClose={() => (saving ? undefined : setPanel(null))}
        title={panel?.mode === 'edit' ? `Kupon düzenle — ${panel.coupon.code}` : 'Yeni kupon'}
        size="lg"
        lockBackdrop={saving}
        footer={
          <>
            <button type="button" onClick={() => { setDraft(initial); setErrors({}); setFormError(null); }} disabled={!dirty || saving} className={btn.secondary}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Sıfırla
            </button>
            <button type="submit" form="coupon-form" disabled={saving || (panel?.mode === 'edit' && !dirty)} className={btn.primary}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : panel?.mode === 'edit' ? 'Kaydet' : 'Oluştur'}
            </button>
          </>
        }
      >
        {panel && (
          <form id="coupon-form" onSubmit={handleSave} noValidate className="space-y-4">
            <FormErrorBanner message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kod" required error={errors.code} hint="Büyük/küçük harf duyarsız; 3–32 karakter (harf, rakam, -, _).">
                {({ id, invalid }) => (
                  <TextInput id={id} invalid={invalid} value={draft.code} maxLength={32} disabled={saving} className="font-mono uppercase" onChange={(e) => patch({ code: e.target.value })} onBlur={(e) => patch({ code: normalizeCouponCode(e.target.value) })} />
                )}
              </Field>
              <Field label="Tür" error={errors.kind}>
                {({ id }) => (
                  <Select id={id} value={draft.kind} disabled={saving} onChange={(e) => patch({ kind: e.target.value as CouponKind })}>
                    {COUPON_KIND_VALUES.map((k) => (
                      <option key={k} value={k}>{COUPON_KIND_LABELS[k]}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={draft.kind === 'PERCENT' ? 'Yüzde (%)' : 'Tutar (₺, KDV dahil)'} required error={errors.value}>
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={draft.value} disabled={saving} onChange={(e) => patch({ value: e.target.value })} />}
              </Field>
              <Field label="Kapsam" error={errors.appliesTo}>
                {({ id }) => (
                  <Select id={id} value={draft.appliesTo} disabled={saving} onChange={(e) => patch({ appliesTo: e.target.value as CouponScope })}>
                    {COUPON_SCOPE_VALUES.map((s) => (
                      <option key={s} value={s}>{COUPON_SCOPE_LABELS[s]}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Alt sınır (₺)" error={errors.minSubtotal} hint="İndirim öncesi ara toplam; boş = sınır yok.">
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="decimal" value={draft.minSubtotal} disabled={saving} onChange={(e) => patch({ minSubtotal: e.target.value })} />}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Toplam sınır" error={errors.usageLimit} hint="Boş = sınırsız">
                  {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.usageLimit} disabled={saving} onChange={(e) => patch({ usageLimit: e.target.value })} />}
                </Field>
                <Field label="Üye başına" error={errors.perUserLimit} hint="Boş = sınırsız">
                  {({ id, invalid }) => <TextInput id={id} invalid={invalid} inputMode="numeric" value={draft.perUserLimit} disabled={saving} onChange={(e) => patch({ perUserLimit: e.target.value })} />}
                </Field>
              </div>
              <Field label="Başlangıç" error={errors.startsAt} hint="Boş = hemen">
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="datetime-local" value={draft.startsAt} disabled={saving} onChange={(e) => patch({ startsAt: e.target.value })} />}
              </Field>
              <Field label="Bitiş" error={errors.endsAt} hint="Boş = süresiz">
                {({ id, invalid }) => <TextInput id={id} invalid={invalid} type="datetime-local" value={draft.endsAt} disabled={saving} onChange={(e) => patch({ endsAt: e.target.value })} />}
              </Field>
            </div>
            <Field label="Not" error={errors.note} hint="Yalnız panelde görünür.">
              {({ id, invalid }) => <TextArea id={id} invalid={invalid} rows={2} maxLength={500} value={draft.note} disabled={saving} onChange={(e) => patch({ note: e.target.value })} />}
            </Field>
            <Checkbox label="Aktif" description="Pasif kupon sepette kabul edilmez." checked={draft.isActive} disabled={saving} onChange={(e) => patch({ isActive: e.target.checked })} />
          </form>
        )}
      </Modal>

      {/* Kullanımlar */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Kullanımlar — ${detail.coupon.code}` : ''} size="lg">
        {detail && (
          <div className="space-y-3">
            <p className="text-sm text-brand-700">
              {couponDiscountLabel(detail.coupon)} · {couponScopeLabel(detail.coupon.appliesTo)} · kullanım {couponUsageLabel(detail.coupon)}
              {detail.data?.minSubtotal ? ` · alt sınır ${formatTry(detail.data.minSubtotal)}` : ''}
              {detail.data?.perUserLimit ? ` · üye başına ${detail.data.perUserLimit}` : ''}
            </p>
            {detail.data?.note && <p className="text-xs text-brand-500">{detail.data.note}</p>}
            {detail.error ? (
              <ErrorBlock message={detail.error} />
            ) : !detail.data ? (
              <LoadingBlock />
            ) : detail.data.redemptions.length === 0 ? (
              <p className="text-sm text-brand-500">Henüz kullanım yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th className={th}>Tarih</th>
                      <th className={th}>Sipariş</th>
                      <th className={th}>Müşteri</th>
                      <th className={cn(th, 'text-right')}>İndirim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.redemptions.map((r) => (
                      <tr key={r.id}>
                        <td className={cn(td, 'text-xs')}>{formatDateTime(r.createdAt)}</td>
                        <td className={td}>
                          <Link to={`/siparisler/${r.orderId}`} className="font-medium text-brand-900 hover:text-accent">
                            {r.orderNo ? `#${r.orderNo}` : r.orderId}
                          </Link>
                        </td>
                        <td className={cn(tdText, 'text-xs')}>{r.customerEmail ?? (r.userId ? <Link to={`/musteriler/${r.userId}`} className="hover:text-accent">Müşteri</Link> : <span className="text-brand-400">misafir</span>)}</td>
                        <td className={cn(td, 'text-right font-medium')}>{formatTry(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
