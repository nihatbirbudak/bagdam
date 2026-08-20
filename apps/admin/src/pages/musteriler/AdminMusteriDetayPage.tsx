import { CONSENT_KIND_LABELS, IYS_STATUS_LABELS, type ConsentKind, type IysStatus } from '@bagdam/shared';
import { ArrowLeft, History, MapPin, RotateCcw, Save, ShieldCheck, ShoppingBag, UserRound, UserX, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Checkbox, Field, FormErrorBanner, TextInput } from '../../components/ui/FormField';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { auditApi } from '../../features/catalog/api';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { customersApi } from '../../features/musteriler/api';
import { ordersApi } from '../../features/siparisler/api';
import { OrderStatusBadge } from '../../features/siparisler/OrderBadges';
import { CustomerStateBadge, RoleBadge } from '../../features/musteriler/CustomerBadges';
import {
  customerDisplayName,
  customerToDraft,
  isCustomerAnonymized,
  isCustomerDraftDirty,
  toCustomerPatch,
  validateCustomerDraft,
  type CustomerProfileDraft,
} from '../../features/musteriler/customers';
import { errorMessage, extractFieldErrors } from '../../lib/api';
import type { AdminCustomerAuditEntry, AdminCustomerDetail, OrderSummary } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime, formatTry } from '../../lib/utils';

const LIST_PATH = '/musteriler';
const EMPTY_DRAFT: CustomerProfileDraft = { name: '', phone: '', isActive: true };

function consentLabel(kind: string): string {
  return (CONSENT_KIND_LABELS as Record<string, string>)[kind as ConsentKind] ?? kind;
}
function iysLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return (IYS_STATUS_LABELS as Record<string, string>)[status as IysStatus] ?? status;
}

function Card({ title, icon: Icon, children, className }: { title: string; icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-brand-200 bg-white', className)}>
      <header className="flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
        <Icon className="h-4 w-4 text-brand-500" aria-hidden />
        <h2 className="text-sm font-semibold text-brand-800">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">{label}</dt>
      <dd className="text-sm text-brand-800">{children}</dd>
    </div>
  );
}

/** PATCH yanıtı eksik bölümler (adres/onay/audit) içermiyorsa yerel kopya korunur. */
function mergeDetail(prev: AdminCustomerDetail, next: AdminCustomerDetail | null, patch: { name?: string | null; phone?: string | null; isActive?: boolean }): AdminCustomerDetail {
  if (!next) {
    return {
      ...prev,
      name: patch.name === undefined ? prev.name : patch.name,
      phone: patch.phone === undefined ? prev.phone : patch.phone,
      isActive: patch.isActive ?? prev.isActive,
    };
  }
  return {
    ...prev,
    ...next,
    address: next.address ?? prev.address,
    consents: next.consents.length ? next.consents : prev.consents,
    audit: next.audit.length ? next.audit : prev.audit,
    orders: next.orders.total || next.orders.items.length ? next.orders : prev.orders,
  };
}

/** Müşteriye dair son audit satırları: entity (müşteri kaydı) ya da actor (kendi işlemleri); tekilleştir, yeni → eski. */
function mergeAudit(lists: (AdminCustomerAuditEntry[] | null)[], limit = 10): AdminCustomerAuditEntry[] {
  const seen = new Set<string>();
  const out: AdminCustomerAuditEntry[] = [];
  for (const list of lists) {
    for (const e of list ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, limit);
}

/**
 * F8 — Müşterinin siparişleri: `GET /admin/orders?q=<e-posta>&limit=10` (q e-posta/ad/telefon içerir arar; Order.customerEmail
 * snapshot'ı = User.email). Anonimleştirilmiş müşteride e-posta değiştiğinden sorgu atılmaz. Tümü için Siparişler filtreli bağlantı.
 */
function CustomerOrdersCard({ customer }: { customer: AdminCustomerDetail }) {
  const anonymized = isCustomerAnonymized(customer);
  const email = customer.email;
  const [rows, setRows] = useState<OrderSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (anonymized) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setRows(null);
    setError(null);
    ordersApi
      .list({ q: email, page: 1, limit: 10 })
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setRows([]);
        setError(errorMessage(e, 'Siparişler alınamadı'));
      });
    return () => {
      cancelled = true;
    };
  }, [email, anonymized]);

  const listHref = `/siparisler?q=${encodeURIComponent(email)}`;
  return (
    <Card title="Siparişler" icon={ShoppingBag}>
      {anonymized ? (
        <p className="text-sm text-brand-500">Anonimleştirilmiş müşteri — siparişler e-posta ile eşlenemez; Siparişler ekranında sipariş no ile aranabilir.</p>
      ) : rows === null ? (
        <p className="text-sm text-brand-500">Yükleniyor…</p>
      ) : error ? (
        <p className="text-sm text-accent-dark" role="alert">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-brand-500">Henüz sipariş yok.</p>
      ) : (
        <>
          <ul className="divide-y divide-brand-100">
            {rows.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <Link to={`/siparisler/${o.id}`} className="font-semibold text-brand-900 hover:text-accent">#{o.orderNo}</Link>
                  <span className="block text-[11px] text-brand-500">{formatDate(o.deliveryOn)} · {formatDateTime(o.createdAt)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <OrderStatusBadge status={o.status} />
                  <span className="tabular-nums text-brand-800">{formatTry(o.grandTotal)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-brand-500">
            {total > rows.length ? `${rows.length} / ${total} sipariş gösteriliyor. ` : `${total} sipariş. `}
            <Link to={listHref} className="text-accent hover:underline">Tümünü Siparişler'de aç</Link>
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * Ekran 16 — Müşteri detayı: profil (ad/telefon/aktif → PATCH), adres (salt okunur), onaylar, audit özeti,
 * siparişler (F8: /admin/orders?q=e-posta), KVKK anonimleştir (geri alınamaz).
 */
export function AdminMusteriDetayPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAdminAuth();
  const confirm = useConfirm();

  const [customer, setCustomer] = useState<AdminCustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<CustomerProfileDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<CustomerProfileDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [auditFallback, setAuditFallback] = useState<AdminCustomerAuditEntry[]>([]);

  const applyCustomer = useCallback((c: AdminCustomerDetail) => {
    setCustomer(c);
    const d = customerToDraft(c);
    setInitial(d);
    setDraft(d);
    setErrors({});
    setFormError(null);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      applyCustomer(await customersApi.get(id));
    } catch (e) {
      setLoadError(errorMessage(e, 'Müşteri yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [id, applyCustomer]);

  useEffect(() => {
    void load();
  }, [load]);

  // Detay audit özeti vermiyorsa (ADMIN): GET /admin/audit-logs ile müşteri kaydı / müşterinin kendi işlemleri (son 10).
  useEffect(() => {
    if (!id || !isAdmin || !customer || customer.audit.length > 0) {
      setAuditFallback([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [byEntity, byActor] = await Promise.all([
        auditApi.list({ entityId: id, limit: 10 }).then((r) => r.items).catch(() => null),
        auditApi.list({ actorId: id, limit: 10 }).then((r) => r.items).catch(() => null),
      ]);
      if (cancelled) return;
      const toEntry = (rows: typeof byEntity): AdminCustomerAuditEntry[] | null =>
        rows
          ? rows.map((r) => ({ id: r.id, action: r.action, module: r.module, summary: r.summary, actorEmail: r.actorEmail, createdAt: r.createdAt }))
          : null;
      setAuditFallback(mergeAudit([toEntry(byEntity), toEntry(byActor)]));
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isAdmin, customer]);

  const anonymized = customer ? isCustomerAnonymized(customer) : false;
  const dirty = isCustomerDraftDirty(initial, draft);

  function patchDraft(p: Partial<CustomerProfileDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!id || !customer) return;
    const v = validateCustomerDraft(draft);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }
    const body = toCustomerPatch(initial, draft);
    if (!Object.keys(body).length) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await customersApi.patch(id, body);
      applyCustomer(mergeDetail(customer, updated, body));
      toast.success('Müşteri kaydedildi');
    } catch (err) {
      const fe = extractFieldErrors(err);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDraft(initial);
    setErrors({});
    setFormError(null);
  }

  async function handleAnonymize() {
    if (!id || !customer) return;
    const ok = await confirm({
      title: 'Müşteriyi anonimleştir',
      description: `${customer.email} — e-posta anon+${id}@anon.local olur; ad, telefon ve adres silinir; açık oturumlar düşer; hesap pasife alınır. Bu işlem geri alınamaz (KVKK).`,
      confirmLabel: 'Anonimleştir',
      danger: true,
    });
    if (!ok) return;
    setAnonymizing(true);
    try {
      await customersApi.anonymize(id);
      toast.success('Müşteri anonimleştirildi');
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Anonimleştirilemedi'));
    } finally {
      setAnonymizing(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Müşteri" crumb="…" />
        <LoadingBlock />
      </div>
    );
  }
  if (loadError || !customer) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Müşteri" actions={<Link to={LIST_PATH} className={btn.secondary}><ArrowLeft className="h-4 w-4" aria-hidden />Listeye dön</Link>} />
        <ErrorBlock message={loadError ?? 'Müşteri bulunamadı'} onRetry={() => void load()} />
      </div>
    );
  }

  const auditRows = customer.audit.length ? customer.audit : auditFallback;
  const a = customer.address;

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title={customerDisplayName(customer)}
        crumb={customer.email}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <RoleBadge role={String(customer.role)} />
            <CustomerStateBadge customer={customer} />
            <span>Kayıt: {formatDateTime(customer.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Link to={LIST_PATH} className={btn.secondary}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Listeye dön
            </Link>
            <button type="button" onClick={() => void handleAnonymize()} disabled={anonymized || anonymizing} className={btn.danger}>
              <UserX className="h-4 w-4" aria-hidden />
              {anonymizing ? 'Anonimleştiriliyor…' : 'Anonimleştir'}
            </button>
          </>
        }
      />

      {anonymized && (
        <InlineNotice tone="warning" className="mb-4">
          Bu müşteri KVKK kapsamında anonimleştirildi ({formatDateTime(customer.anonymizedAt)}): kişisel veriler silindi, hesap pasif. Profil düzenlenemez.
        </InlineNotice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Profil" icon={UserRound}>
            <form onSubmit={handleSave} noValidate className="space-y-4">
              <FormErrorBanner message={formError} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="E-posta" hint="Giriş kimliği; panelden değiştirilemez.">
                  {({ id: fid }) => <TextInput id={fid} value={customer.email} disabled readOnly />}
                </Field>
                <Field label="Ad Soyad" error={errors.name}>
                  {({ id: fid, invalid }) => (
                    <TextInput id={fid} invalid={invalid} value={draft.name} maxLength={120} disabled={anonymized || saving} onChange={(e) => patchDraft({ name: e.target.value })} />
                  )}
                </Field>
                <Field label="Telefon" error={errors.phone} hint="Opsiyonel; teslimat telefonu adreste tutulur.">
                  {({ id: fid, invalid }) => (
                    <TextInput id={fid} invalid={invalid} inputMode="tel" value={draft.phone} maxLength={30} disabled={anonymized || saving} onChange={(e) => patchDraft({ phone: e.target.value })} />
                  )}
                </Field>
                <div className="flex items-end pb-1">
                  <Checkbox
                    label="Hesap aktif"
                    description="Pasif hesap giriş yapamaz; veriler silinmez."
                    checked={draft.isActive}
                    disabled={anonymized || saving}
                    onChange={(e) => patchDraft({ isActive: e.target.checked })}
                  />
                </div>
              </div>
              <dl className="grid gap-3 rounded-md border border-brand-200 bg-brand-50/60 p-3 sm:grid-cols-3">
                <Meta label="E-posta doğrulama">
                  <BoolBadge value={!!customer.emailVerifiedAt} yes="Doğrulandı" no="Bekliyor" />
                  {customer.emailVerifiedAt && <span className="ml-1 text-xs text-brand-500">{formatDateTime(customer.emailVerifiedAt)}</span>}
                </Meta>
                <Meta label="Son giriş">{formatDateTime(customer.lastLoginAt)}</Meta>
                <Meta label="Pazarlama izni">{customer.marketingOptIn === undefined ? '—' : <BoolBadge value={customer.marketingOptIn} yes="Var" no="Yok" />}</Meta>
              </dl>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={reset} disabled={!dirty || saving} className={btn.secondary}>
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Sıfırla
                </button>
                <button type="submit" disabled={!dirty || saving || anonymized} className={btn.primary}>
                  <Save className="h-4 w-4" aria-hidden />
                  {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </div>
            </form>
          </Card>

          <Card title="Onaylar" icon={ShieldCheck}>
            {customer.consents.length === 0 ? (
              <p className="text-sm text-brand-500">Kayıtlı onay yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th className={th}>Tür</th>
                      <th className={th}>Durum</th>
                      <th className={th}>Belge</th>
                      <th className={th}>Kaynak</th>
                      <th className={th}>İYS</th>
                      <th className={th}>Tarih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.consents.map((c) => (
                      <tr key={c.id}>
                        <td className={tdText}>{consentLabel(c.kind)}</td>
                        <td className={td}>{c.revokedAt ? <BoolBadge value={false} no="Geri çekildi" /> : <BoolBadge value={c.granted} yes="Verildi" no="Reddedildi" />}</td>
                        <td className={cn(tdText, 'text-xs')}>
                          {c.documentTitle ?? c.documentSlug ?? c.documentId ?? '—'}
                          {c.documentVersion ? ` v${c.documentVersion}` : ''}
                        </td>
                        <td className={cn(td, 'text-xs')}>{c.source ?? '—'}</td>
                        <td className={cn(td, 'text-xs')}>{iysLabel(c.iysStatus)}</td>
                        <td className={cn(td, 'text-xs')}>{formatDateTime(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Adres" icon={MapPin}>
            {a ? (
              <dl className="space-y-2">
                <Meta label="Ad Soyad">{a.fullName || '—'}</Meta>
                <Meta label="Telefon">{a.phone || '—'}</Meta>
                <Meta label="Adres">{a.line || '—'}</Meta>
                <Meta label="İlçe / Bölge">{a.zoneName ?? a.zoneSlug ?? a.zoneId ?? '—'}</Meta>
                {a.zip && <Meta label="Posta kodu">{a.zip}</Meta>}
              </dl>
            ) : (
              <p className="text-sm text-brand-500">Kayıtlı adres yok.</p>
            )}
          </Card>

          <CustomerOrdersCard customer={customer} />

          <Card title="Audit özeti" icon={History}>
            {auditRows.length === 0 ? (
              <p className="text-sm text-brand-500">Kayıt yok{isAdmin ? '' : ' (audit günlüğü yalnız ADMIN)'}.</p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {auditRows.map((row) => (
                  <li key={row.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-brand-800">
                        {row.module ? `${row.module}:` : ''}
                        {row.action}
                      </span>
                      <span className="text-[11px] text-brand-400">{formatDateTime(row.createdAt)}</span>
                    </div>
                    {row.summary && <p className="text-xs text-brand-600">{row.summary}</p>}
                    {row.actorEmail && <p className="text-[11px] text-brand-400">{row.actorEmail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
