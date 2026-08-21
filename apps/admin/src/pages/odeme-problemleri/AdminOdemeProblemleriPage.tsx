import { CreditCard, Link2, MessageSquareText, RefreshCw, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field, FormErrorBanner, TextArea } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useConfirm } from '../../contexts/ConfirmContext';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { cyclesAdminApi } from '../../features/abonelikler/api';
import { CycleStatusBadge } from '../../features/abonelikler/SubscriptionBadges';
import { subscriptionStatusLabel } from '../../features/abonelikler/subscriptions';
import { paymentIssuesApi } from '../../features/odeme-problemleri/api';
import {
  ISSUE_KIND_STYLE,
  SEVERITY_LABEL,
  SEVERITY_STYLE,
  canIssueLink,
  canRetryCharge,
  dunningText,
  issueKindLabel,
  issueSeverity,
  sortIssues,
  summarizeIssues,
  validateIssueNote,
} from '../../features/odeme-problemleri/paymentIssues';
import { OrderStatusBadge } from '../../features/siparisler/OrderBadges';
import { todayIsoDate } from '../../features/siparisler/orders';
import { errorMessage } from '../../lib/api';
import type { PaymentIssueItem, PaymentIssueList } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDate, formatDateTime, formatTry } from '../../lib/utils';

const LIMIT_DEFAULT = 25;

const KIND_OPTIONS: ReadonlyArray<{ key: '' | 'ORDER' | 'CYCLE'; label: string }> = [
  { key: '', label: 'Tümü' },
  { key: 'CYCLE', label: 'Kutular' },
  { key: 'ORDER', label: 'Siparişler' },
];

/**
 * Ekran 18 — Ödeme Problemleri (F9).
 *
 * `GET /admin/payment-issues` birleşik listesi: ödemesi başarısız siparişler (PAYMENT_FAILED) ve tahsil
 * edilemeyen / ödeme linki bekleyen abonelik kutuları (UNPAID · AWAITING_PAYMENT). Satır aksiyonları:
 * "yeniden çek" (`POST /admin/cycles/:id/charge`), "ödeme linki gönder" (`POST …/send-payment-link`),
 * müşteri kaydına not (sipariş notu ya da abonelik ADMIN_NOTE olayı).
 *
 * Dunning (ADR-0020): denemeler kesimden +2 s / +12 s; son sınır teslimat günü 08:00 — sınır aşılırsa kutu
 * UNPAID → SKIPPED(UNPAID), iki ardışık UNPAID aboneliği PAST_DUE yapar.
 */
export function AdminOdemeProblemleriPage() {
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const kindParam = params.get('kind');
  const kind = kindParam === 'ORDER' || kindParam === 'CYCLE' ? kindParam : '';
  const q = params.get('q') ?? '';

  const [data, setData] = useState<PaymentIssueList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [noteTarget, setNoteTarget] = useState<PaymentIssueItem | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

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
      setData(await paymentIssuesApi.list({ kind: kind || undefined, q: q.trim() || undefined, page, limit }));
      setNow(new Date());
    } catch (e) {
      setError(errorMessage(e, 'Ödeme problemleri yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [kind, q, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retryCharge(item: PaymentIssueItem) {
    if (!item.cycleId) return;
    const ok = await confirm({
      title: 'Tahsilatı yeniden dene',
      description: `${item.customerEmail} · ${item.cycleNo ? `#${item.cycleNo} kutusu` : 'kutu'} için saklı karttan tahsilat yeniden denenecek.`,
      confirmLabel: 'Yeniden çek',
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      const cycle = await cyclesAdminApi.charge(item.cycleId);
      toast.success(`Tahsilat denendi — yeni durum: ${cycle.status}`);
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Tahsilat denenemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function sendLink(item: PaymentIssueItem) {
    if (!item.cycleId) return;
    setBusyId(item.id);
    try {
      const res = await cyclesAdminApi.sendPaymentLink(item.cycleId);
      toast.success(`Ödeme linki oluşturuldu — son geçerlilik ${formatDateTime(res.linkExpiresAt)}`);
      void load();
    } catch (e) {
      toast.error(errorMessage(e, 'Ödeme linki gönderilemedi'));
    } finally {
      setBusyId(null);
    }
  }

  async function saveNote() {
    if (!noteTarget) return;
    const err = validateIssueNote(noteDraft);
    if (err) {
      setNoteError(err);
      return;
    }
    setNoteSaving(true);
    try {
      if (noteTarget.kind === 'ORDER' && noteTarget.orderId) await paymentIssuesApi.addOrderNote(noteTarget.orderId, noteDraft.trim());
      else if (noteTarget.subscriptionId) await paymentIssuesApi.addSubscriptionNote(noteTarget.subscriptionId, noteDraft.trim());
      else throw new Error('Bu satır için not hedefi yok');
      toast.success('Not kaydedildi');
      setNoteTarget(null);
    } catch (e) {
      setNoteError(errorMessage(e, 'Not kaydedilemedi'));
    } finally {
      setNoteSaving(false);
    }
  }

  const today = todayIsoDate(now);
  const digest = data ? summarizeIssues(data, today) : null;
  const rows = useMemo(() => (data ? sortIssues(data.items, today) : []), [data, today]);

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Ödeme Problemleri"
        description="Tahsil edilemeyen kutular (UNPAID), ödeme linki bekleyenler (AWAITING_PAYMENT) ve ödemesi başarısız siparişler tek listede. Yeniden çekme, ödeme linki ve müşteri notu buradan."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className={cn(btn.secondary, btn.sm)}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Yenile
          </button>
        }
      />

      {digest && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Toplam sorun" value={digest.total} tone={digest.total ? 'bad' : 'good'} />
          <Stat label="Tahsil edilemeyen kutu" value={digest.unpaidCycles} tone={digest.unpaidCycles ? 'bad' : 'neutral'} />
          <Stat label="Ödeme linki bekleyen" value={digest.awaitingPaymentCycles} />
          <Stat label="Ödemesi başarısız sipariş" value={digest.failedOrders} tone={digest.failedOrders ? 'bad' : 'neutral'} />
        </div>
      )}

      <AdminToolbar
        className="mb-3"
        searchPlaceholder="Sipariş no, ad, e-posta ya da telefon ara…"
        searchValue={q}
        onSearchChange={(v) => setParam({ q: v, page: 1 })}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <FilterPills options={KIND_OPTIONS} value={kind} onChange={(v) => setParam({ kind: v, page: 1 })} label="Kaynak" />
            {(kind || q) && (
              <button type="button" onClick={() => setParam({ kind: '', q: '', page: 1 })} className={cn(btn.ghost, btn.sm)}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Filtreleri temizle
              </button>
            )}
          </div>
        }
      />

      {loading && !data ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState icon={CreditCard} message={kind || q ? 'Filtreye uyan kayıt yok.' : 'Bekleyen ödeme problemi yok. Tahsilatların tamamı başarılı.'} />
      ) : (
        <AdminScrollTable
          footer={
            <Pagination total={data?.total ?? rows.length} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />
          }
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>Aciliyet</th>
                <th className={th}>Kaynak</th>
                <th className={th}>Müşteri</th>
                <th className={th}>Durum</th>
                <th className={th}>Teslimat</th>
                <th className={th}>Dunning</th>
                <th className={cn(th, 'text-right')}>Tutar</th>
                <th className={cn(th, 'w-px')}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const severity = issueSeverity(item, today);
                const busy = busyId === item.id;
                return (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td className={td}>
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', SEVERITY_STYLE[severity])}>
                        {SEVERITY_LABEL[severity]}
                      </span>
                    </td>
                    <td className={cn(td, 'text-xs')}>
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', ISSUE_KIND_STYLE[item.kind])}>
                        {issueKindLabel(item.kind)}
                      </span>
                      <span className="mt-0.5 block text-brand-500">
                        {item.orderId && item.orderNo ? (
                          <Link to={`/siparisler/${item.orderId}`} className="hover:text-accent">
                            #{item.orderNo}
                          </Link>
                        ) : item.orderNo ? (
                          `#${item.orderNo}`
                        ) : (
                          '—'
                        )}
                        {item.cycleNo ? ` · kutu #${item.cycleNo}` : ''}
                      </span>
                    </td>
                    <td className={tdText}>
                      {item.subscriptionId ? (
                        <Link to={`/abonelikler/${item.subscriptionId}`} className="block font-medium text-brand-900 hover:text-accent">
                          {item.customerName || item.customerEmail}
                        </Link>
                      ) : (
                        <span className="block font-medium text-brand-900">{item.customerName || item.customerEmail}</span>
                      )}
                      <span className="block text-xs text-brand-500">{item.customerEmail}</span>
                      <span className="block text-[11px] text-brand-400">
                        {item.customerPhone}
                        {item.subscriptionStatus ? ` · abonelik: ${subscriptionStatusLabel(item.subscriptionStatus)}` : ''}
                        {item.failedCycles > 0 ? ` · ${item.failedCycles} ardışık hata` : ''}
                      </span>
                    </td>
                    <td className={td}>
                      {item.kind === 'ORDER' ? <OrderStatusBadge status={item.status} /> : <CycleStatusBadge status={item.status} />}
                      {!item.hasCard && item.kind === 'CYCLE' && <span className="mt-0.5 block text-[11px] text-accent-dark">saklı kart yok</span>}
                    </td>
                    <td className={cn(td, 'text-xs')}>{item.deliveryOn ? formatDate(item.deliveryOn) : <span className="text-brand-400">—</span>}</td>
                    <td className={cn(td, 'text-xs')}>
                      <span className="block">{item.retryCount} deneme</span>
                      <span className="block text-brand-500">{dunningText(item, now)}</span>
                      {item.lastFailureMessage && (
                        <span className="block truncate text-[11px] text-accent-dark" title={item.lastFailureMessage}>
                          {item.lastFailureCode ? `${item.lastFailureCode}: ` : ''}
                          {item.lastFailureMessage}
                        </span>
                      )}
                    </td>
                    <td className={cn(td, 'text-right font-medium')}>{formatTry(item.amount)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {canRetryCharge(item) && (
                          <button type="button" disabled={busy} className={cn(btn.secondary, btn.sm)} onClick={() => void retryCharge(item)}>
                            <Zap className="h-3.5 w-3.5" aria-hidden />
                            Yeniden çek
                          </button>
                        )}
                        {canIssueLink(item) && (
                          <button type="button" disabled={busy} className={cn(btn.secondary, btn.sm)} onClick={() => void sendLink(item)}>
                            <Link2 className="h-3.5 w-3.5" aria-hidden />
                            Ödeme linki
                          </button>
                        )}
                        {item.paymentLinkUrl && (
                          <a href={item.paymentLinkUrl} target="_blank" rel="noreferrer" className={btn.icon} title="Açık ödeme linkini aç" aria-label={`${item.customerEmail} ödeme linki`}>
                            <Link2 className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        )}
                        <button
                          type="button"
                          className={btn.icon}
                          aria-label={`${item.customerEmail} için not ekle`}
                          title="Müşteri kaydına not"
                          onClick={() => {
                            setNoteTarget(item);
                            setNoteDraft('');
                            setNoteError(null);
                          }}
                        >
                          <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
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

      <Modal
        open={!!noteTarget}
        title={noteTarget ? `Not — ${noteTarget.customerEmail}` : 'Not'}
        onClose={() => setNoteTarget(null)}
        footer={
          <>
            <button type="button" className={btn.secondary} onClick={() => setNoteTarget(null)}>
              Vazgeç
            </button>
            <button type="button" className={btn.primary} disabled={noteSaving} onClick={() => void saveNote()}>
              {noteSaving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <FormErrorBanner message={noteError} />
          <Field
            label="Not"
            hint={
              noteTarget?.kind === 'ORDER'
                ? 'Sipariş notlarına zaman damgalı satır olarak eklenir (POST /admin/orders/:id/notes).'
                : 'Abonelik olay günlüğüne ADMIN_NOTE olarak yazılır (PATCH /admin/subscriptions/:id).'
            }
            required
          >
            {({ id }) => (
              <TextArea
                id={id}
                rows={4}
                autoFocus
                value={noteDraft}
                invalid={!!noteError}
                onChange={(e) => {
                  setNoteDraft(e.target.value);
                  setNoteError(null);
                }}
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <div className="rounded-md border border-brand-200 bg-white px-3 py-2">
      <span className={cn('block text-lg font-semibold tabular-nums', tone === 'good' ? 'text-olive-deep' : tone === 'bad' ? 'text-accent-dark' : 'text-brand-900')}>{value}</span>
      <span className="block text-[11px] text-brand-600">{label}</span>
    </div>
  );
}
