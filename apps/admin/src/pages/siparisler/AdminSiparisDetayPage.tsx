import {
  BILLING_PARTY_LABELS,
  BILLING_PARTY_VALUES,
  DELIVERY_DAY_LABELS,
  ORDER_LINE_KIND_LABELS,
  PAYMENT_KIND_LABELS,
  PAYMENT_PROVIDER_LABELS,
  type BillingParty,
  type DeliveryDay,
  type OrderLineBoxMetadata,
  type OrderLineKind,
  type OrderStatus,
  type PaymentKind,
  type PaymentProvider,
} from '@bagdam/shared';
import { ArrowLeft, CreditCard, FileText, ListOrdered, MapPin, MessageSquareText, Repeat, RotateCcw, Save, Undo2, UserRound, Workflow, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Field, FormErrorBanner, Select, TextArea, TextInput } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { BoolBadge } from '../../features/components/StatusBadge';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { ordersApi, paymentsAdminApi } from '../../features/siparisler/api';
import { OrderKindBadge, OrderStatusBadge, PaymentStatusBadge } from '../../features/siparisler/OrderBadges';
import {
  addressText,
  billingToDraft,
  isBillingDirty,
  isOrderTerminal,
  isPaymentRefundable,
  orderTransitionOptions,
  parseAdminNotes,
  refundableAmount,
  refundedTotal,
  toBillingPatch,
  validateBillingDraft,
  validateReason,
  validateRefundDraft,
  type BillingDraft,
  type OrderTransitionOption,
} from '../../features/siparisler/orders';
import { ApiError, errorMessage, extractFieldErrors } from '../../lib/api';
import type { Order, Payment } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime, formatTry, parseDecimalInput } from '../../lib/utils';

const LIST_PATH = '/siparisler';

function Card({ title, icon: Icon, children, className, actions }: { title: string; icon: LucideIcon; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-brand-200 bg-white', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-brand-500" aria-hidden />
          <h2 className="text-sm font-semibold text-brand-800">{title}</h2>
        </span>
        {actions}
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

function lineKindLabel(kind: string): string {
  return (ORDER_LINE_KIND_LABELS as Record<string, string>)[kind as OrderLineKind] ?? kind;
}
function deliveryDayLabel(day: string): string {
  return (DELIVERY_DAY_LABELS as Record<string, string>)[day as DeliveryDay] ?? day;
}
function paymentKindLabel(kind: string): string {
  return (PAYMENT_KIND_LABELS as Record<string, string>)[kind as PaymentKind] ?? kind;
}
function providerLabel(p: string): string {
  return (PAYMENT_PROVIDER_LABELS as Record<string, string>)[p as PaymentProvider] ?? p;
}
function isBoxMetadata(m: unknown): m is OrderLineBoxMetadata {
  return !!m && typeof m === 'object' && Array.isArray((m as { items?: unknown }).items);
}

/**
 * Ekran 17 — Sipariş detayı: satırlar + toplamlar, ödemeler (+iadeler, iade başlat), durum geçişleri (shared makine: yalnız
 * izinli hedefler; iptal/iade için neden), notlar (zaman damgalı ekleme), müşteri/teslimat/adres snapshot'ı, fatura no/PDF,
 * kurumsal fatura alanları.
 */
export function AdminSiparisDetayPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Durum geçişi
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [reasonTarget, setReasonTarget] = useState<OrderTransitionOption | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  // Not
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Fatura
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoicePdfPath, setInvoicePdfPath] = useState('');
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  // Kurumsal fatura
  const [billingInitial, setBillingInitial] = useState<BillingDraft>({ billingParty: 'INDIVIDUAL', billingName: '', billingTaxNo: '', billingTaxOffice: '' });
  const [billing, setBilling] = useState<BillingDraft>(billingInitial);
  const [billingErrors, setBillingErrors] = useState<Record<string, string>>({});
  const [billingFormError, setBillingFormError] = useState<string | null>(null);
  const [billingSaving, setBillingSaving] = useState(false);

  // İade
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundDraft, setRefundDraft] = useState({ amount: '', reason: '' });
  const [refundErrors, setRefundErrors] = useState<Record<string, string>>({});
  const [refundFormError, setRefundFormError] = useState<string | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);

  const applyOrder = useCallback((o: Order) => {
    setOrder(o);
    setInvoiceNo(o.invoiceNo ?? '');
    setInvoicePdfPath(o.invoicePdfPath ?? '');
    const b = billingToDraft(o);
    setBillingInitial(b);
    setBilling(b);
    setBillingErrors({});
    setBillingFormError(null);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      applyOrder(await ordersApi.get(id));
    } catch (e) {
      setLoadError(errorMessage(e, 'Sipariş yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [id, applyOrder]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Durum geçişi ── */

  async function runTransition(opt: OrderTransitionOption, reason?: string) {
    if (!id || !order) return;
    setTransitionBusy(true);
    try {
      const updated = await ordersApi.updateStatus(id, { status: opt.to, ...(reason ? { reason } : {}) });
      applyOrder(updated);
      toast.success(`Durum: ${opt.label}`);
      setReasonTarget(null);
      setReasonDraft('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ORDER_STATE_CHANGED') {
        toast.warning('Sipariş durumu bu arada değişti; yeniden yüklendi.');
        await load();
      } else if (e instanceof ApiError && e.code === 'ORDER_TRANSITION_INVALID') {
        toast.error(errorMessage(e, 'Geçiş geçersiz'));
        await load();
      } else {
        const msg = errorMessage(e, 'Durum değiştirilemedi');
        if (reasonTarget) setReasonError(msg);
        else toast.error(msg);
      }
    } finally {
      setTransitionBusy(false);
    }
  }

  async function onTransitionClick(opt: OrderTransitionOption) {
    if (!order) return;
    if (opt.requiresReason) {
      setReasonTarget(opt);
      setReasonDraft('');
      setReasonError(null);
      return;
    }
    const ok = await confirm({
      title: `Durumu "${opt.label}" yap`,
      description:
        opt.kind === 'payment'
          ? `#${order.orderNo} → ${opt.label}. Bu geçişi normalde ödeme sağlayıcısı / sistem tetikler; yalnız istisnai (manuel ödeme/düzeltme) durumlarda kullanın.`
          : `#${order.orderNo} siparişi "${opt.label}" durumuna geçecek.`,
      confirmLabel: opt.label,
      danger: opt.kind === 'payment',
    });
    if (!ok) return;
    await runTransition(opt);
  }

  function submitReason(e: FormEvent) {
    e.preventDefault();
    if (!reasonTarget) return;
    const err = validateReason(reasonDraft, reasonTarget.requiresReason);
    setReasonError(err);
    if (err) return;
    void runTransition(reasonTarget, reasonDraft.trim());
  }

  /* ── Not ── */

  async function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    const text = noteDraft.trim();
    if (!text) {
      setNoteError('Not boş olamaz');
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      applyOrder(await ordersApi.addNote(id, text));
      setNoteDraft('');
      toast.success('Not eklendi');
    } catch (err) {
      setNoteError(errorMessage(err, 'Not eklenemedi'));
    } finally {
      setNoteSaving(false);
    }
  }

  /* ── Fatura ── */

  const invoiceDirty = !!order && (invoiceNo.trim() !== (order.invoiceNo ?? '') || invoicePdfPath.trim() !== (order.invoicePdfPath ?? ''));

  async function submitInvoice(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setInvoiceSaving(true);
    setInvoiceError(null);
    try {
      applyOrder(await ordersApi.patchInvoice(id, { invoiceNo: invoiceNo.trim() || null, invoicePdfPath: invoicePdfPath.trim() || null }));
      toast.success('Fatura bilgisi kaydedildi');
    } catch (err) {
      setInvoiceError(errorMessage(err, 'Fatura bilgisi kaydedilemedi'));
    } finally {
      setInvoiceSaving(false);
    }
  }

  /* ── Kurumsal fatura ── */

  const billingDirty = isBillingDirty(billingInitial, billing);

  async function submitBilling(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    const v = validateBillingDraft(billing);
    setBillingErrors(v);
    if (Object.keys(v).length) {
      setBillingFormError('Lütfen işaretli alanları düzeltin.');
      return;
    }
    setBillingSaving(true);
    setBillingFormError(null);
    try {
      applyOrder(await ordersApi.patchBilling(id, toBillingPatch(billing)));
      toast.success('Fatura tarafı kaydedildi');
    } catch (err) {
      const fe = extractFieldErrors(err);
      setBillingErrors(fe);
      setBillingFormError(Object.keys(fe).length ? 'Lütfen işaretli alanları düzeltin.' : errorMessage(err, 'Kaydedilemedi'));
    } finally {
      setBillingSaving(false);
    }
  }

  /* ── İade ── */

  function openRefund(p: Payment) {
    setRefundTarget(p);
    setRefundDraft({ amount: String(refundableAmount(p)).replace('.', ','), reason: '' });
    setRefundErrors({});
    setRefundFormError(null);
  }

  async function submitRefund(e: FormEvent) {
    e.preventDefault();
    if (!refundTarget) return;
    const max = refundableAmount(refundTarget);
    const v = validateRefundDraft(refundDraft, max);
    setRefundErrors(v);
    if (Object.keys(v).length) return;
    setRefundSaving(true);
    setRefundFormError(null);
    try {
      const res = await paymentsAdminApi.refund(refundTarget.id, { amount: parseDecimalInput(refundDraft.amount) ?? 0, ...(refundDraft.reason.trim() ? { reason: refundDraft.reason.trim() } : {}) });
      if (res && res.ok === false) {
        setRefundFormError(`Sağlayıcı iadeyi reddetti${res.refund?.reason ? `: ${res.refund.reason}` : ''}.`);
        await load();
        return;
      }
      toast.success(res.orderTransitioned ? 'İade yapıldı; sipariş "İade edildi" durumuna geçti' : 'İade başlatıldı');
      setRefundTarget(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setRefundFormError('İade ucu (POST /admin/payments/:id/refund) henüz API\'de yok — PayTR iade entegrasyonu (F8/A) bağlanınca çalışır.');
      } else {
        setRefundFormError(errorMessage(err, 'İade başlatılamadı'));
      }
    } finally {
      setRefundSaving(false);
    }
  }

  /* ── Render ── */

  if (loading) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Sipariş" crumb="…" />
        <LoadingBlock />
      </div>
    );
  }
  if (loadError || !order) {
    return (
      <div className="px-4 py-4">
        <AdminPageHeader title="Sipariş" actions={<Link to={LIST_PATH} className={btn.secondary}><ArrowLeft className="h-4 w-4" aria-hidden />Listeye dön</Link>} />
        <ErrorBlock message={loadError ?? 'Sipariş bulunamadı'} onRetry={() => void load()} />
      </div>
    );
  }

  const transitions = orderTransitionOptions(order.status as OrderStatus);
  const primary = transitions.filter((t) => t.primary);
  const secondary = transitions.filter((t) => !t.primary);
  const notes = parseAdminNotes(order.adminNote);
  const payments = order.payments ?? [];
  const a = order.addressSnapshot;

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title={`Sipariş #${order.orderNo}`}
        crumb={`#${order.orderNo}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <OrderKindBadge kind={order.kind} />
            <span>Oluşturma: {formatDateTime(order.createdAt)}</span>
            {order.paidAt && <span>· Ödeme: {formatDateTime(order.paidAt)}</span>}
            {order.couponCode && <span>· Kupon: <code className="rounded bg-brand-100 px-1 font-mono text-xs">{order.couponCode}</code></span>}
          </span>
        }
        actions={
          <Link to={LIST_PATH} className={btn.secondary}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Listeye dön
          </Link>
        }
      />

      {order.cancelledAt && (
        <InlineNotice tone="info" className="mb-4">
          {order.status === 'REFUNDED' ? 'İade edildi' : 'İptal edildi'} ({formatDateTime(order.cancelledAt)}){order.cancelReason ? ` — ${order.cancelReason}` : ''}.
        </InlineNotice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Satırlar" icon={ListOrdered}>
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className={th}>Tür</th>
                    <th className={th}>Ürün / kutu</th>
                    <th className={cn(th, 'text-right')}>Adet</th>
                    <th className={cn(th, 'text-right')}>Birim</th>
                    <th className={cn(th, 'text-right')}>Toplam</th>
                    <th className={cn(th, 'text-right')}>KDV</th>
                    <th className={th}>Parti</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => (
                    <tr key={l.id}>
                      <td className={cn(td, 'text-xs')}>{lineKindLabel(l.kind)}</td>
                      <td className={tdText}>
                        <span className="block font-medium text-brand-900">{l.name}</span>
                        {l.pref && <span className="block text-xs text-brand-500">Tercih: {l.pref}</span>}
                        {l.unit && <span className="block text-xs text-brand-500">{l.unit}</span>}
                        {isBoxMetadata(l.metadata) && l.metadata.items.length > 0 && (
                          <ul className="mt-1 list-disc pl-4 text-xs text-brand-600">
                            {l.metadata.items.map((it, i) => (
                              <li key={`${it.productId}-${i}`}>
                                {it.name}
                                {it.boxAmount ? ` · ${it.boxAmount}` : ''}
                                {it.pref ? ` · ${it.pref}` : ''}
                                {it.lotCode ? ` · ${it.lotCode}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className={cn(td, 'text-right')}>{l.qty}</td>
                      <td className={cn(td, 'text-right')}>{formatTry(l.unitPrice)}</td>
                      <td className={cn(td, 'text-right font-medium')}>{formatTry(l.lineTotal)}</td>
                      <td className={cn(td, 'text-right text-xs')}>%{l.vatRate}</td>
                      <td className={cn(td, 'text-xs')}>{l.lotCode ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-3 grid max-w-xs grid-cols-2 gap-y-1 text-sm">
              <dt className="text-brand-500">Ara toplam</dt>
              <dd className="text-right tabular-nums">{formatTry(order.subtotal)}</dd>
              <dt className="text-brand-500">İndirim</dt>
              <dd className="text-right tabular-nums">{order.discountTotal ? `− ${formatTry(order.discountTotal)}` : formatTry(0)}</dd>
              <dt className="text-brand-500">Kargo</dt>
              <dd className="text-right tabular-nums">{formatTry(order.shippingFee)}</dd>
              <dt className="text-brand-500">KDV (dahil)</dt>
              <dd className="text-right tabular-nums">{formatTry(order.vatTotal)}</dd>
              <dt className="border-t border-brand-200 pt-1 font-semibold text-brand-900">Genel toplam</dt>
              <dd className="border-t border-brand-200 pt-1 text-right font-semibold tabular-nums text-brand-900">{formatTry(order.grandTotal)}</dd>
            </dl>
          </Card>

          <Card title="Ödemeler" icon={CreditCard}>
            {payments.length === 0 ? (
              <p className="text-sm text-brand-500">Ödeme kaydı yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th className={th}>Tarih</th>
                      <th className={th}>Tür</th>
                      <th className={th}>Sağlayıcı</th>
                      <th className={cn(th, 'text-right')}>Tutar</th>
                      <th className={th}>Durum</th>
                      <th className={th}>Referans</th>
                      <th className={cn(th, 'w-px')}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => {
                      const refunded = refundedTotal(p);
                      return (
                        <tr key={p.id}>
                          <td className={cn(td, 'text-xs')}>
                            {formatDateTime(p.createdAt)}
                            {p.paidAt && <span className="block text-brand-500">ödendi {formatDateTime(p.paidAt)}</span>}
                          </td>
                          <td className={cn(tdText, 'text-xs')}>
                            {paymentKindLabel(p.kind)}
                            {p.attemptNo > 1 ? ` (#${p.attemptNo})` : ''}
                            {p.isMerchantInitiated ? ' · MIT' : ''}
                            {p.is3ds ? ' · 3DS' : ''}
                          </td>
                          <td className={cn(td, 'text-xs')}>{providerLabel(p.provider)}</td>
                          <td className={cn(td, 'text-right font-medium')}>
                            {formatTry(p.amount)}
                            {refunded > 0 && <span className="block text-xs font-normal text-brand-500">iade {formatTry(refunded)}</span>}
                          </td>
                          <td className={td}>
                            <PaymentStatusBadge status={p.status} />
                            {p.failureMessage && <span className="block max-w-[14rem] truncate text-[11px] text-accent-dark" title={p.failureMessage}>{p.failureCode ? `${p.failureCode}: ` : ''}{p.failureMessage}</span>}
                            {(p.refunds ?? []).length > 0 && (
                              <ul className="mt-1 space-y-0.5 text-[11px] text-brand-600">
                                {(p.refunds ?? []).map((r) => (
                                  <li key={r.id}>
                                    İade {formatTry(r.amount)} · <PaymentStatusBadge status={r.status} className="px-1.5 py-0 text-[10px]" /> · {formatDateTime(r.createdAt)}
                                    {r.reason ? ` — ${r.reason}` : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className={cn(td, 'font-mono text-[11px]')}>
                            <span className="block">{p.conversationId}</span>
                            {p.providerPaymentId && <span className="block text-brand-500">{p.providerPaymentId}</span>}
                          </td>
                          <td className={td}>
                            {isPaymentRefundable(p) && (
                              <button type="button" onClick={() => openRefund(p)} className={cn(btn.outline, btn.sm)} aria-label={`${p.conversationId} iade`}>
                                <Undo2 className="h-3.5 w-3.5" aria-hidden />
                                İade
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Notlar" icon={MessageSquareText}>
            {notes.length === 0 ? (
              <p className="mb-3 text-sm text-brand-500">Henüz not yok. Notlar silinmez; telafi/ayıplı ürün kayıtları da buraya yazılır.</p>
            ) : (
              <ul className="mb-3 divide-y divide-brand-100">
                {notes.map((n, i) => (
                  <li key={`${n.stamp ?? 'x'}-${i}`} className="flex items-start gap-3 py-2 text-sm">
                    <span className="w-28 shrink-0 font-mono text-[11px] text-brand-400">{n.stamp ?? '—'}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap text-brand-800">{n.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submitNote} noValidate className="space-y-2">
              <Field label="Yeni not" error={noteError}>
                {({ id: fid, invalid }) => <TextArea id={fid} invalid={invalid} rows={2} maxLength={2000} value={noteDraft} disabled={noteSaving} onChange={(e) => setNoteDraft(e.target.value)} />}
              </Field>
              <div className="flex justify-end">
                <button type="submit" disabled={noteSaving || !noteDraft.trim()} className={btn.primary}>
                  <Save className="h-4 w-4" aria-hidden />
                  {noteSaving ? 'Ekleniyor…' : 'Not ekle'}
                </button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Durum" icon={Workflow}>
            <div className="mb-3 flex items-center gap-2">
              <OrderStatusBadge status={order.status} />
              {isOrderTerminal(order.status as OrderStatus) && <span className="text-xs text-brand-500">Terminal durum; değiştirilemez.</span>}
            </div>
            {transitions.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {primary.map((t) => (
                    <button
                      key={t.to}
                      type="button"
                      disabled={transitionBusy}
                      onClick={() => void onTransitionClick(t)}
                      className={cn(t.kind === 'cancel' ? btn.danger : btn.primary, btn.sm)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {secondary.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-brand-100 pt-2">
                    <span className="text-[11px] uppercase tracking-wide text-brand-400">İstisnai</span>
                    {secondary.map((t) => (
                      <button key={t.to} type="button" disabled={transitionBusy} onClick={() => void onTransitionClick(t)} className={cn(btn.secondary, btn.sm)}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] leading-snug text-brand-500">
                  Yalnız durum makinesinin izin verdiği geçişler gösterilir. İptal/iade için neden zorunlu; iadeler Ödemeler bölümünden başlatılır.
                </p>
              </div>
            )}
          </Card>

          <Card title="Müşteri" icon={UserRound}>
            <dl className="space-y-2">
              <Meta label="Ad Soyad">{order.customerName}</Meta>
              <Meta label="E-posta">
                <a href={`mailto:${order.customerEmail}`} className="hover:text-accent">{order.customerEmail}</a>
              </Meta>
              <Meta label="Telefon">{order.customerPhone || '—'}</Meta>
              {order.userId && (
                <Meta label="Hesap">
                  <Link to={`/musteriler/${order.userId}`} className="text-accent hover:underline">Müşteri kaydı</Link>
                </Meta>
              )}
              {order.note && <Meta label="Sipariş notu">{order.note}</Meta>}
            </dl>
          </Card>

          <Card title="Teslimat" icon={MapPin}>
            <dl className="space-y-2">
              <Meta label="Gün">{deliveryDayLabel(order.deliveryDay)} · {formatDate(order.deliveryOn)}</Meta>
              <Meta label="Alıcı">{a?.fullName || '—'}{a?.phone ? ` · ${a.phone}` : ''}</Meta>
              <Meta label="Adres">{addressText(a)}</Meta>
            </dl>
          </Card>

          {order.subscriptionId && (
            <Card title="Abonelik" icon={Repeat}>
              <p className="text-sm text-brand-700">
                Bu sipariş bir aboneliğe bağlı: <code className="rounded bg-brand-100 px-1 font-mono text-xs">{order.subscriptionId}</code>
              </p>
              <p className="mt-1 text-xs text-brand-500">Abonelik / cycle yönetimi ekranı (Abonelikler) F9'da; teslimat rezervi motorda.</p>
            </Card>
          )}

          <Card title="Fatura" icon={FileText}>
            <form onSubmit={submitInvoice} noValidate className="space-y-3">
              <FormErrorBanner message={invoiceError} />
              <Field label="Fatura no" hint="Manuel GİB e-Arşiv (ADR-0010); boş bırakılırsa temizlenir.">
                {({ id: fid }) => <TextInput id={fid} value={invoiceNo} maxLength={40} disabled={invoiceSaving} onChange={(e) => setInvoiceNo(e.target.value)} />}
              </Field>
              <Field label="PDF yolu" hint="Sunucudaki/özel depodaki dosya yolu ya da bağlantı.">
                {({ id: fid }) => <TextInput id={fid} value={invoicePdfPath} maxLength={255} disabled={invoiceSaving} onChange={(e) => setInvoicePdfPath(e.target.value)} />}
              </Field>
              <div className="flex justify-end">
                <button type="submit" disabled={!invoiceDirty || invoiceSaving} className={btn.primary}>
                  <Save className="h-4 w-4" aria-hidden />
                  {invoiceSaving ? 'Kaydediliyor…' : 'Faturayı kaydet'}
                </button>
              </div>
            </form>

            <form onSubmit={submitBilling} noValidate className="mt-4 space-y-3 border-t border-brand-100 pt-4">
              <FormErrorBanner message={billingFormError} />
              <Field label="Fatura tarafı">
                {({ id: fid }) => (
                  <Select id={fid} value={billing.billingParty} disabled={billingSaving} onChange={(e) => setBilling((b) => ({ ...b, billingParty: e.target.value as BillingParty }))}>
                    {BILLING_PARTY_VALUES.map((v) => (
                      <option key={v} value={v}>{BILLING_PARTY_LABELS[v]}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Unvan" error={billingErrors.billingName} required={billing.billingParty === 'CORPORATE'}>
                {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} value={billing.billingName} maxLength={200} disabled={billingSaving} onChange={(e) => setBilling((b) => ({ ...b, billingName: e.target.value }))} />}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vergi / TC no" error={billingErrors.billingTaxNo} required={billing.billingParty === 'CORPORATE'} hint="10 haneli VKN ya da 11 haneli TCKN">
                  {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} inputMode="numeric" value={billing.billingTaxNo} maxLength={11} disabled={billingSaving} onChange={(e) => setBilling((b) => ({ ...b, billingTaxNo: e.target.value }))} />}
                </Field>
                <Field label="Vergi dairesi" error={billingErrors.billingTaxOffice}>
                  {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} value={billing.billingTaxOffice} maxLength={100} disabled={billingSaving} onChange={(e) => setBilling((b) => ({ ...b, billingTaxOffice: e.target.value }))} />}
                </Field>
              </div>
              <div className="flex items-center justify-between gap-2">
                <BoolBadge value={order.billingParty === 'CORPORATE'} yes="Kurumsal" no="Bireysel" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setBilling(billingInitial); setBillingErrors({}); setBillingFormError(null); }} disabled={!billingDirty || billingSaving} className={btn.secondary}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Sıfırla
                  </button>
                  <button type="submit" disabled={!billingDirty || billingSaving} className={btn.primary}>
                    <Save className="h-4 w-4" aria-hidden />
                    {billingSaving ? 'Kaydediliyor…' : 'Fatura tarafını kaydet'}
                  </button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      </div>

      {/* Neden modali (CANCELLED / REFUNDED) */}
      <Modal
        open={!!reasonTarget}
        onClose={() => (transitionBusy ? undefined : setReasonTarget(null))}
        title={reasonTarget ? `Durum: ${reasonTarget.label} — neden` : ''}
        size="sm"
        lockBackdrop={transitionBusy}
        footer={
          <>
            <button type="button" onClick={() => setReasonTarget(null)} disabled={transitionBusy} className={btn.secondary}>Vazgeç</button>
            <button type="submit" form="order-reason-form" disabled={transitionBusy} className={reasonTarget?.kind === 'cancel' ? btn.danger : btn.primary}>
              {transitionBusy ? 'Uygulanıyor…' : (reasonTarget?.label ?? 'Uygula')}
            </button>
          </>
        }
      >
        {reasonTarget && (
          <form id="order-reason-form" onSubmit={submitReason} noValidate className="space-y-3">
            <p className="text-sm text-brand-700">
              #{order.orderNo} siparişi <strong>{reasonTarget.label}</strong> olacak.
              {reasonTarget.to === 'CANCELLED' && !order.subscriptionId ? ' Teslimat günü rezervi iade edilir.' : ''}
              {reasonTarget.to === 'REFUNDED' ? ' Para iadesi Ödemeler bölümünden ayrıca başlatılmalıdır.' : ''}
            </p>
            <Field label="Neden" required error={reasonError} hint="Müşteriye görünmez; audit ve sipariş kaydında tutulur (≤ 200 karakter).">
              {({ id: fid, invalid }) => <TextArea id={fid} invalid={invalid} rows={3} maxLength={200} value={reasonDraft} disabled={transitionBusy} onChange={(e) => setReasonDraft(e.target.value)} />}
            </Field>
          </form>
        )}
      </Modal>

      {/* İade modali */}
      <Modal
        open={!!refundTarget}
        onClose={() => (refundSaving ? undefined : setRefundTarget(null))}
        title={refundTarget ? `İade — ${formatTry(refundTarget.amount)} (${providerLabel(refundTarget.provider)})` : ''}
        size="sm"
        lockBackdrop={refundSaving}
        footer={
          <>
            <button type="button" onClick={() => setRefundTarget(null)} disabled={refundSaving} className={btn.secondary}>Vazgeç</button>
            <button type="submit" form="order-refund-form" disabled={refundSaving} className={btn.danger}>
              {refundSaving ? 'Gönderiliyor…' : 'İadeyi başlat'}
            </button>
          </>
        }
      >
        {refundTarget && (
          <form id="order-refund-form" onSubmit={submitRefund} noValidate className="space-y-3">
            <FormErrorBanner message={refundFormError} />
            <p className="text-sm text-brand-700">
              Kalan iade edilebilir tutar: <strong>{formatTry(refundableAmount(refundTarget))}</strong>. Tam iadede sipariş durumu izin veriyorsa (ödendi / teslim edildi / teslim edilemedi) otomatik "İade edildi" olur; aksi hâlde Durum kartından değiştirilir.
            </p>
            <Field label="İade tutarı (₺)" required error={refundErrors.amount}>
              {({ id: fid, invalid }) => <TextInput id={fid} invalid={invalid} inputMode="decimal" value={refundDraft.amount} disabled={refundSaving} onChange={(e) => setRefundDraft((d) => ({ ...d, amount: e.target.value }))} />}
            </Field>
            <Field label="Neden" error={refundErrors.reason} hint="Ayıplı ürün / cayma (≤ 15 gün) vb.">
              {({ id: fid, invalid }) => <TextArea id={fid} invalid={invalid} rows={2} maxLength={200} value={refundDraft.reason} disabled={refundSaving} onChange={(e) => setRefundDraft((d) => ({ ...d, reason: e.target.value }))} />}
            </Field>
          </form>
        )}
      </Modal>

    </div>
  );
}
