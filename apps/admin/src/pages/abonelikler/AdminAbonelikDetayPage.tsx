import { CHARGE_STRATEGY_LABELS, CHARGE_STRATEGY_VALUES, DELIVERY_DAY_LABELS, DELIVERY_DAY_VALUES, type ChargeStrategy, type DeliveryDay } from '@bagdam/shared';
import {
  ArrowLeft,
  Boxes,
  ChevronDown,
  ChevronRight,
  Gift,
  History,
  Link2,
  Save,
  ScrollText,
  UserRound,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Field, FormErrorBanner, Select, TextArea } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { ErrorBlock, InlineNotice, LoadingBlock } from '../../features/components/StateBlocks';
import { CompensateModal } from '../../features/abonelikler/CompensateModal';
import { cyclesAdminApi, subscriptionsAdminApi } from '../../features/abonelikler/api';
import { CycleItemSourceBadge, CycleStatusBadge, SubscriptionKindBadge, SubscriptionStatusBadge } from '../../features/abonelikler/SubscriptionBadges';
import {
  canChargeCycle,
  canCompensate,
  canSendPaymentLink,
  cancelOutcomeLabel,
  cancelReasonLabel,
  chargeStrategyLabel,
  cycleStatusOptions,
  deliveryDayLabel,
  eventDataSummary,
  frequencyLabel,
  skipSourceLabel,
  sortCyclesDesc,
  sortEventsDesc,
  subEventLabel,
  subscriptionStatusOptions,
  subscriptionStatusRequiresNote,
  summarizeCycles,
} from '../../features/abonelikler/subscriptions';
import { errorMessage } from '../../lib/api';
import type { Subscription, SubscriptionCycle } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime, formatTry } from '../../lib/utils';

const LIST_PATH = '/abonelikler';

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

/**
 * Ekran 19 detay — Abonelik: künye + düzenleme (`PATCH /admin/subscriptions/:id`), durum geçişleri
 * (shared subscriptionMachine), cycle geçmişi (durum / tutar / sipariş no / içerik), olay günlüğü
 * (SubscriptionEvent), iptal kayıtları (SubscriptionCancellation) ve telafi (`POST /admin/cycles/:id/compensate`).
 *
 * Cycle satırı aksiyonları: "yeniden çek" (`/charge`), "ödeme linki" (`/send-payment-link`) ve ops durum
 * geçişleri (`PATCH /admin/cycles/:id/status`) — makinede izinli olmayan hedef gösterilmez (sunucu ayrıca 409 verir).
 */
export function AdminAbonelikDetayPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Düzenleme
  const [freq, setFreq] = useState('');
  const [day, setDay] = useState('');
  const [strategy, setStrategy] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Durum geçişi
  const [statusTarget, setStatusTarget] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Cycle
  const [openCycle, setOpenCycle] = useState<string | null>(null);
  const [cycleBusy, setCycleBusy] = useState<string | null>(null);
  const [compensateCycleId, setCompensateCycleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await subscriptionsAdminApi.get(id);
      setSub(data);
      setFreq(String(data.frequencyWeeks));
      setDay(data.deliveryDay);
      setStrategy(data.chargeStrategy);
      setNote('');
    } catch (e) {
      setLoadError(errorMessage(e, 'Abonelik yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEdits() {
    if (!sub) return;
    const body: Parameters<typeof subscriptionsAdminApi.patch>[1] = {};
    const nextFreq = Number(freq);
    if (!sub.isOneTime && Number.isInteger(nextFreq) && nextFreq !== sub.frequencyWeeks) body.frequencyWeeks = nextFreq;
    if (day && day !== sub.deliveryDay) body.deliveryDay = day as DeliveryDay;
    if (strategy && strategy !== sub.chargeStrategy) body.chargeStrategy = strategy as ChargeStrategy;
    if (note.trim()) body.note = note.trim();
    if (Object.keys(body).length === 0) {
      toast.info('Değişiklik yok');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const updated = await subscriptionsAdminApi.patch(sub.id, body);
      setSub(updated);
      setNote('');
      toast.success('Abonelik güncellendi');
    } catch (e) {
      setFormError(errorMessage(e, 'Abonelik güncellenemedi'));
    } finally {
      setSaving(false);
    }
  }

  async function applyStatus() {
    if (!sub || !statusTarget) return;
    if (subscriptionStatusRequiresNote(statusTarget) && !statusNote.trim()) {
      setStatusError('İptal için neden gerekli');
      return;
    }
    setStatusBusy(true);
    setStatusError(null);
    try {
      const updated = await subscriptionsAdminApi.patch(sub.id, {
        status: statusTarget as Subscription['status'],
        ...(statusNote.trim() ? { note: statusNote.trim() } : {}),
      });
      setSub(updated);
      setStatusTarget(null);
      setStatusNote('');
      toast.success('Abonelik durumu güncellendi');
    } catch (e) {
      setStatusError(errorMessage(e, 'Durum değiştirilemedi'));
    } finally {
      setStatusBusy(false);
    }
  }

  async function cycleAction(cycle: SubscriptionCycle, action: 'charge' | 'link') {
    setCycleBusy(cycle.id);
    try {
      if (action === 'charge') {
        const res = await cyclesAdminApi.charge(cycle.id);
        toast.success(`Tahsilat denendi — yeni durum: ${res.status}`);
      } else {
        const res = await cyclesAdminApi.sendPaymentLink(cycle.id);
        toast.success(`Ödeme linki oluşturuldu — son geçerlilik ${formatDateTime(res.linkExpiresAt)}`);
      }
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'İşlem tamamlanamadı'));
    } finally {
      setCycleBusy(null);
    }
  }

  async function setCycleStatus(cycle: SubscriptionCycle, to: string, danger: boolean) {
    if (danger) {
      const ok = await confirm({
        title: 'Kutu durumunu değiştir',
        description: `#${cycle.cycleNo} kutusu "${to}" durumuna alınacak. İptal geri alınamaz ve teslimat rezervasyonu serbest bırakılır.`,
        confirmLabel: 'Uygula',
        danger: true,
      });
      if (!ok) return;
    }
    setCycleBusy(cycle.id);
    try {
      await cyclesAdminApi.setStatus(cycle.id, { status: to });
      toast.success('Kutu durumu güncellendi');
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Kutu durumu değiştirilemedi'));
    } finally {
      setCycleBusy(null);
    }
  }

  if (loading) return <LoadingBlock className="py-20" />;
  if (loadError || !sub) {
    return (
      <div className="px-4 py-4">
        <ErrorBlock message={loadError ?? 'Abonelik bulunamadı'} onRetry={() => void load()} />
        <Link to={LIST_PATH} className={cn(btn.secondary, 'mt-3')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Listeye dön
        </Link>
      </div>
    );
  }

  const cycles = sortCyclesDesc(sub.cycles ?? []);
  const events = sortEventsDesc(sub.events ?? []);
  const cancellations = sub.cancellations ?? [];
  const digest = summarizeCycles(cycles);
  const statusOptions = subscriptionStatusOptions(sub.status);
  const compensateAvailable = canCompensate(cycles);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {sub.userName ?? sub.userEmail ?? 'Abonelik'}
            <SubscriptionStatusBadge status={sub.status} />
            <SubscriptionKindBadge isOneTime={sub.isOneTime} />
          </span>
        }
        crumb={sub.userEmail ?? sub.id}
        description={`${sub.tierLabel ?? sub.tierSlug} · ${frequencyLabel(sub.frequencyWeeks, sub.isOneTime)} · ${deliveryDayLabel(sub.deliveryDay)}`}
        actions={
          <>
            <Link to={LIST_PATH} className={cn(btn.secondary, btn.sm)}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Liste
            </Link>
            <button
              type="button"
              className={cn(btn.outline, btn.sm)}
              disabled={!compensateAvailable}
              title={compensateAvailable ? 'Kesimi geçmemiş kutuya 0 ₺ telafi satırı ekler' : 'Telafi için kesimi geçmemiş planlı kutu yok'}
              onClick={() => setCompensateCycleId(cycles.find((c) => c.status === 'SCHEDULED')?.id ?? cycles[0]?.id ?? null)}
            >
              <Gift className="h-3.5 w-3.5" aria-hidden />
              Telafi ekle
            </button>
          </>
        }
      />

      {sub.status === 'PAST_DUE' && (
        <InlineNotice tone="warning" className="mb-3">
          Tahsilat gecikmiş (ardışık {sub.failedCycles} başarısız kutu). Kart güncellenene ya da bir tahsilat başarılı olana kadar
          yeni kutular hazırlanmaz — Ödeme Problemleri ekranından yeniden çekebilir ya da ödeme linki gönderebilirsiniz.
        </InlineNotice>
      )}
      {sub.status === 'CANCEL_REQUESTED' && (
        <InlineNotice tone="warning" className="mb-3">
          İptal talebi alındı{sub.cancelRequestedAt ? ` (${formatDateTime(sub.cancelRequestedAt)})` : ''}. Kilitlenmiş kutu varsa teslim edilir (ADR-0007).
        </InlineNotice>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Künye" icon={UserRound} className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meta label="Müşteri">{sub.userName ?? '—'}</Meta>
            <Meta label="E-posta">{sub.userEmail ?? '—'}</Meta>
            <Meta label="Kutu">{sub.tierLabel ?? sub.tierSlug}</Meta>
            <Meta label="Sıklık">{frequencyLabel(sub.frequencyWeeks, sub.isOneTime)}</Meta>
            <Meta label="Teslimat günü">{deliveryDayLabel(sub.deliveryDay)}</Meta>
            <Meta label="Sonraki teslimat">{sub.nextDeliveryOn ? formatDate(sub.nextDeliveryOn) : '—'}</Meta>
            <Meta label="Sonraki kesim">{sub.nextCutoffAt ? formatDateTime(sub.nextCutoffAt) : '—'}</Meta>
            <Meta label="Tahsilat stratejisi">{chargeStrategyLabel(sub.chargeStrategy)}</Meta>
            <Meta label="Saklı kart">{sub.paymentMethodId ? 'Var' : 'Yok'}</Meta>
            <Meta label="Atlama hakkı">{sub.skipsUsed} kullanıldı</Meta>
            <Meta label="İndirimli kutu">{sub.discountBoxesLeft} kaldı</Meta>
            <Meta label="Sonraki kutu indirimi">{sub.nextBoxDiscountPct !== null ? `%${sub.nextBoxDiscountPct}` : '—'}</Meta>
            <Meta label="Başlangıç">{sub.startedAt ? formatDateTime(sub.startedAt) : '—'}</Meta>
            <Meta label="İptal talebi">{sub.cancelRequestedAt ? formatDateTime(sub.cancelRequestedAt) : '—'}</Meta>
            <Meta label="İptal">{sub.cancelledAt ? formatDateTime(sub.cancelledAt) : '—'}</Meta>
            <Meta label="Tamamlandı">{sub.completedAt ? formatDateTime(sub.completedAt) : '—'}</Meta>
          </dl>
          {Object.keys(sub.itemPrefs ?? {}).length > 0 && (
            <div className="mt-3 border-t border-brand-200 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Kalıcı ürün tercihleri</p>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-xs text-brand-700">
                {Object.entries(sub.itemPrefs).map(([slug, pref]) => (
                  <li key={slug} className="rounded-full bg-brand-100 px-2 py-0.5">
                    {slug}: <strong>{pref}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Durum ve düzenleme" icon={Workflow}>
          <div className="space-y-3">
            <FormErrorBanner message={formError} />
            <Field label="Sıklık (hafta)" hint={sub.isOneTime ? 'Tek seferlik kutuda sıklık kullanılmaz.' : 'Değişiklik gelecek kutuları yeniden planlar.'}>
              {({ id }) => (
                <Select id={id} value={freq} disabled={sub.isOneTime} onChange={(e) => setFreq(e.target.value)}>
                  {[1, 2, 4].map((w) => (
                    <option key={w} value={w}>
                      {frequencyLabel(w)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Teslimat günü">
              {({ id }) => (
                <Select id={id} value={day} onChange={(e) => setDay(e.target.value)}>
                  {DELIVERY_DAY_VALUES.map((d) => (
                    <option key={d} value={d}>
                      {DELIVERY_DAY_LABELS[d]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Tahsilat stratejisi" hint="ADR-0019: saklı kart kapalıyken sunucu ödeme linkine düşer.">
              {({ id }) => (
                <Select id={id} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                  {CHARGE_STRATEGY_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {CHARGE_STRATEGY_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Not" hint="Doldurulursa olay günlüğüne ADMIN_NOTE olarak yazılır.">
              {({ id }) => <TextArea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <button type="button" className={cn(btn.primary, 'w-full')} disabled={saving} onClick={() => void saveEdits()}>
              <Save className="h-4 w-4" aria-hidden />
              {saving ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}
            </button>

            {statusOptions.length > 0 && (
              <div className="border-t border-brand-200 pt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-400">Durum geçişi</p>
                <div className="flex flex-wrap gap-2">
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.to}
                      type="button"
                      className={cn(opt.danger ? btn.danger : opt.primary ? btn.outline : btn.secondary, btn.sm)}
                      onClick={() => {
                        setStatusTarget(opt.to);
                        setStatusNote('');
                        setStatusError(null);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card
        title={`Kutu geçmişi (${cycles.length})`}
        icon={Boxes}
        className="mt-4"
        actions={
          <span className="text-[11px] text-brand-500">
            Teslim {digest.delivered} · atlandı {digest.skipped} · tahsil edilemedi {digest.unpaid} · toplam {formatTry(digest.revenue)}
          </span>
        }
      >
        {cycles.length === 0 ? (
          <p className="text-sm text-brand-500">Henüz kutu yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className={cn(th, 'w-px')}></th>
                  <th className={th}>#</th>
                  <th className={th}>Teslimat</th>
                  <th className={th}>Kesim</th>
                  <th className={th}>Durum</th>
                  <th className={cn(th, 'text-right')}>Tutar</th>
                  <th className={cn(th, 'text-right')}>Peşin</th>
                  <th className={th}>Sipariş</th>
                  <th className={cn(th, 'w-px')}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => {
                  const open = openCycle === c.id;
                  const busy = cycleBusy === c.id;
                  const options = cycleStatusOptions(c.status);
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td className={td}>
                          <button
                            type="button"
                            className={btn.icon}
                            aria-expanded={open}
                            aria-label={`#${c.cycleNo} içeriğini ${open ? 'kapat' : 'aç'}`}
                            onClick={() => setOpenCycle(open ? null : c.id)}
                          >
                            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        </td>
                        <td className={cn(td, 'font-semibold text-brand-900')}>{c.cycleNo}</td>
                        <td className={cn(td, 'text-xs')}>{formatDate(c.deliveryOn)}</td>
                        <td className={cn(td, 'text-xs')}>{c.cutoffAt ? formatDateTime(c.cutoffAt) : '—'}</td>
                        <td className={td}>
                          <CycleStatusBadge status={c.status} />
                          {c.skipSource && <span className="ml-1 text-[11px] text-brand-500">({skipSourceLabel(c.skipSource)})</span>}
                        </td>
                        <td className={cn(td, 'text-right')}>{formatTry(c.total)}</td>
                        <td className={cn(td, 'text-right text-xs')}>{formatTry(c.prepaidAmount)}</td>
                        <td className={cn(td, 'text-xs')}>
                          {c.orderId ? (
                            <Link to={`/siparisler/${c.orderId}`} className="text-brand-800 hover:text-accent">
                              sipariş
                            </Link>
                          ) : (
                            <span className="text-brand-400">—</span>
                          )}
                          {c.deltaOrderId && (
                            <>
                              {' · '}
                              <Link to={`/siparisler/${c.deltaOrderId}`} className="text-brand-800 hover:text-accent">
                                delta
                              </Link>
                            </>
                          )}
                        </td>
                        <td className={td}>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {canChargeCycle(c.status) && (
                              <button type="button" disabled={busy} className={cn(btn.secondary, btn.sm)} onClick={() => void cycleAction(c, 'charge')}>
                                <Zap className="h-3.5 w-3.5" aria-hidden />
                                Çek
                              </button>
                            )}
                            {canSendPaymentLink(c.status) && (
                              <button type="button" disabled={busy} className={cn(btn.secondary, btn.sm)} onClick={() => void cycleAction(c, 'link')}>
                                <Link2 className="h-3.5 w-3.5" aria-hidden />
                                Link
                              </button>
                            )}
                            {options.map((opt) => (
                              <button
                                key={opt.to}
                                type="button"
                                disabled={busy}
                                className={cn(opt.danger ? btn.danger : opt.primary ? btn.outline : btn.secondary, btn.sm)}
                                onClick={() => void setCycleStatus(c, opt.to, opt.danger)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td className={tdText} colSpan={9}>
                            {c.items.length === 0 ? (
                              <p className="text-xs text-brand-500">Bu kutuda satır yok.</p>
                            ) : (
                              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                                {[...c.items]
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .map((item) => (
                                    <li key={item.id} className="flex items-center gap-2 rounded-md bg-brand-50 px-2 py-1 text-xs">
                                      <CycleItemSourceBadge source={item.source} />
                                      <span className="min-w-0 flex-1 truncate text-brand-800">
                                        {item.productName ?? item.productSlug}
                                        {item.label ? ` — ${item.label}` : ''}
                                        {item.pref ? ` (${item.pref})` : ''}
                                      </span>
                                      <span className="shrink-0 text-brand-500">
                                        {item.qty}
                                        {item.unit ? ` ${item.unit}` : ''}
                                        {item.unitPrice !== null ? ` · ${formatTry(item.unitPrice)}` : ''}
                                      </span>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Olay günlüğü (${events.length})`} icon={History}>
          {events.length === 0 ? (
            <p className="text-sm text-brand-500">Henüz olay yok.</p>
          ) : (
            <ul className="max-h-96 space-y-1.5 overflow-y-auto text-xs">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-2 border-b border-brand-100 pb-1.5 last:border-0">
                  <span className="shrink-0 rounded bg-brand-100 px-1 font-mono text-[10px] text-brand-600">{e.actor}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-brand-800">{subEventLabel(e.type)}</span>
                    {e.data && <span className="block truncate text-brand-500">{eventDataSummary(e.data)}</span>}
                  </span>
                  <span className="shrink-0 text-brand-400">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`İptal kayıtları (${cancellations.length})`} icon={ScrollText}>
          {cancellations.length === 0 ? (
            <p className="text-sm text-brand-500">İptal talebi yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className={th}>Talep</th>
                    <th className={th}>Neden</th>
                    <th className={th}>Teklif</th>
                    <th className={th}>Sonuç</th>
                    <th className={th}>Yürürlük</th>
                    <th className={cn(th, 'text-right')}>İade</th>
                  </tr>
                </thead>
                <tbody>
                  {cancellations.map((c) => (
                    <tr key={c.id}>
                      <td className={cn(td, 'text-xs')}>{formatDateTime(c.requestedAt)}</td>
                      <td className={cn(td, 'text-xs')}>
                        <span className="block">{cancelReasonLabel(c.reason)}</span>
                        {c.reasonText && <span className="block text-brand-500">{c.reasonText}</span>}
                      </td>
                      <td className={cn(td, 'text-xs')}>{c.retentionOffered ? 'Sunuldu' : '—'}</td>
                      <td className={cn(td, 'text-xs')}>{cancelOutcomeLabel(c.outcome)}</td>
                      <td className={cn(td, 'text-xs')}>{c.effectiveAt ? formatDateTime(c.effectiveAt) : '—'}</td>
                      <td className={cn(td, 'text-right text-xs')}>
                        {c.refundAmount !== null ? formatTry(c.refundAmount) : '—'}
                        {c.refundDueAt && <span className="block text-brand-400">son: {formatDate(c.refundDueAt)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={!!statusTarget}
        title="Abonelik durumunu değiştir"
        onClose={() => setStatusTarget(null)}
        footer={
          <>
            <button type="button" className={btn.secondary} onClick={() => setStatusTarget(null)}>
              Vazgeç
            </button>
            <button type="button" className={statusTarget === 'CANCELLED' ? btn.danger : btn.primary} disabled={statusBusy} onClick={() => void applyStatus()}>
              {statusBusy ? 'Uygulanıyor…' : 'Uygula'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormErrorBanner message={statusError} />
          <p className="text-sm text-brand-700">
            Yeni durum: <strong>{statusTarget}</strong>. İptalde kesimi geçmiş kutu varsa teslim edilir, planlı kutular iptal edilir ve
            teslimat rezervasyonları serbest bırakılır (ADR-0007).
          </p>
          <Field label="Neden / not" required={!!statusTarget && subscriptionStatusRequiresNote(statusTarget)} error={statusError}>
            {({ id }) => <TextArea id={id} rows={3} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />}
          </Field>
        </div>
      </Modal>

      <CompensateModal
        open={!!compensateCycleId}
        cycleId={compensateCycleId}
        label={sub.userEmail}
        onClose={() => setCompensateCycleId(null)}
        onDone={() => void load()}
      />
    </div>
  );
}
