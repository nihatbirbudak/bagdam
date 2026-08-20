import { LEAD_STATUS_LABELS, LEAD_STATUS_VALUES, type LeadStatus } from '@bagdam/shared';
import { MessageSquareText, Store } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Field, FormErrorBanner, Select, TextArea } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminPageHeader } from '../../features/components/AdminPageHeader';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import { leadsApi } from '../../features/toptan/api';
import { errorMessage } from '../../lib/api';
import type { AdminWholesaleLead, LeadStatusValue } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { toast } from '../../lib/toast';
import { cn, formatDateTime } from '../../lib/utils';

const LIMIT_DEFAULT = 25;
type StatusFilter = '' | LeadStatusValue;
const STATUS_OPTIONS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: '', label: 'Tümü' },
  ...LEAD_STATUS_VALUES.map((s) => ({ key: s as StatusFilter, label: LEAD_STATUS_LABELS[s] })),
];

const STATUS_STYLE: Record<LeadStatusValue, string> = {
  NEW: 'bg-butter/50 text-butter-deep ring-butter-deep/30',
  CONTACTED: 'bg-olive-soft text-olive-deep ring-olive/30',
  CLOSED: 'bg-brand-100 text-brand-600 ring-brand-300',
};

/** Ekran 13 — Toptan Talepleri: liste (durum filtresi, sayfalama), durum değiştir (satır içi), not düzenle. */
export function AdminToptanTalepleriPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const status = (params.get('status') ?? '') as StatusFilter;

  const [items, setItems] = useState<AdminWholesaleLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<AdminWholesaleLead | null>(null);
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
      const res = await leadsApi.list({ page, limit, status: status || undefined });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e, 'Talepler yüklenemedi'));
    } finally {
      setLoading(false);
    }
  }, [page, limit, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(lead: AdminWholesaleLead, next: LeadStatusValue) {
    if (next === lead.status) return;
    setBusyId(lead.id);
    const prev = items;
    setItems((list) => list.map((l) => (l.id === lead.id ? { ...l, status: next } : l)));
    try {
      const updated = await leadsApi.patch(lead.id, { status: next });
      setItems((list) => list.map((l) => (l.id === lead.id ? { ...l, ...(updated ?? {}), status: updated?.status ?? next } : l)));
      toast.success(`Durum: ${LEAD_STATUS_LABELS[next as LeadStatus] ?? next}`);
    } catch (e) {
      setItems(prev);
      toast.error(errorMessage(e, 'Durum değiştirilemedi'));
    } finally {
      setBusyId(null);
    }
  }

  function openNote(lead: AdminWholesaleLead) {
    setNoteTarget(lead);
    setNoteDraft(lead.note ?? '');
    setNoteError(null);
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault();
    if (!noteTarget) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const note = noteDraft.trim() || null;
      const updated = await leadsApi.patch(noteTarget.id, { note });
      setItems((list) => list.map((l) => (l.id === noteTarget.id ? { ...l, ...(updated ?? {}), note: updated?.note ?? note } : l)));
      toast.success('Not kaydedildi');
      setNoteTarget(null);
    } catch (err) {
      setNoteError(errorMessage(err, 'Not kaydedilemedi'));
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <AdminPageHeader
        title="Toptan Talepleri"
        description="toptan.html formundan gelen talepler (e-posta zorunlu; işletme/telefon/not şema-var-UI-yok). Durumu güncelleyin, görüşme notu ekleyin. Bildirim e-postası F6'da."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterPills options={STATUS_OPTIONS} value={status} onChange={(v) => setParam({ status: v, page: 1 })} label="Durum" />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <AdminEmptyState icon={Store} message={status ? 'Bu durumda talep yok.' : 'Henüz toptan talebi yok.'} />
      ) : (
        <AdminScrollTable footer={<Pagination total={total} page={page} limit={limit} onPageChange={(p) => setParam({ page: p })} onLimitChange={(l) => setParam({ limit: l, page: 1 })} />}>
          <table className="admin-table">
            <thead>
              <tr>
                <th className={th}>E-posta</th>
                <th className={th}>İşletme</th>
                <th className={th}>Telefon</th>
                <th className={th}>Not</th>
                <th className={th}>Durum</th>
                <th className={th}>Tarih</th>
                <th className={cn(th, 'w-px')}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} className={cn(l.status === 'CLOSED' && 'bg-brand-50/60')}>
                  <td className={cn(tdText, 'font-medium text-brand-900')}>
                    <a href={`mailto:${l.email}`} className="hover:text-accent">{l.email}</a>
                  </td>
                  <td className={tdText}>{l.businessName ?? <span className="text-brand-400">—</span>}</td>
                  <td className={td}>{l.phone ?? <span className="text-brand-400">—</span>}</td>
                  <td className={cn(tdText, 'max-w-[20rem]')}>
                    <span className="line-clamp-2 text-xs text-brand-600">{l.note ?? <span className="text-brand-400">—</span>}</span>
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', STATUS_STYLE[l.status] ?? 'bg-brand-100 text-brand-600 ring-brand-300')}>
                        {LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status}
                      </span>
                      <Select
                        value={l.status}
                        disabled={busyId === l.id}
                        aria-label={`${l.email} durumu`}
                        className="w-auto py-1 text-xs"
                        onChange={(e) => void changeStatus(l, e.target.value as LeadStatusValue)}
                      >
                        {LEAD_STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                        ))}
                      </Select>
                    </div>
                  </td>
                  <td className={cn(td, 'text-xs')}>{formatDateTime(l.createdAt)}</td>
                  <td className={td}>
                    <button type="button" onClick={() => openNote(l)} className={btn.icon} aria-label="Not düzenle" title="Not düzenle">
                      <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminScrollTable>
      )}

      <Modal
        open={!!noteTarget}
        onClose={() => setNoteTarget(null)}
        title={noteTarget ? `Not — ${noteTarget.email}` : ''}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setNoteTarget(null)} className={btn.secondary}>İptal</button>
            <button type="submit" form="lead-note-form" disabled={noteSaving} className={btn.primary}>
              {noteSaving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </>
        }
      >
        {noteTarget && (
          <form id="lead-note-form" onSubmit={saveNote} className="space-y-3" noValidate>
            <FormErrorBanner message={noteError} />
            <Field label="Görüşme notu" hint="Yalnız panelde görünür.">
              {({ id }) => <TextArea id={id} rows={5} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />}
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}
