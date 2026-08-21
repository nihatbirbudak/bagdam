import { MAIL_STATUS_LABELS, MAIL_STATUS_VALUES, PAYMENT_PROVIDER_LABELS, WEBHOOK_STATUS_VALUES, CRON_LOG_STATUS_VALUES, SYSTEM_LOG_LEVEL_VALUES } from '@bagdam/shared';
import { FileSearch, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminEmptyState } from '../../features/components/AdminEmptyState';
import { AdminScrollTable } from '../../features/components/AdminScrollTable';
import { AdminToolbar, FilterPills } from '../../features/components/AdminToolbar';
import { Pagination } from '../../features/components/Pagination';
import { ErrorBlock, LoadingBlock } from '../../features/components/StateBlocks';
import {
  cronStatusLabel,
  systemLevelLabel,
  webhookStatusLabel,
} from '../../features/sistem/system';
import { mailStatusLabel, parseMailPreview, mailErrorText } from '../../features/sistem/mailLogs';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import type { AdminAuditLog } from '../../lib/adminTypes';
import type { AdminMailLog, CronLogItem, SystemLogItem, WebhookEventItem } from '../../lib/apiTypes';
import { btn } from '../../lib/buttonStyles';
import { td, tdText, th } from '../../lib/tableStyles';
import { cn, formatDateTime } from '../../lib/utils';
import { LogDetailModal, type DetailField, type DetailJsonBlock } from './LogDetailModal';
import { CronStatusBadge, SystemLevelBadge, ToneBadge, WebhookStatusBadge } from './SistemBadges';

const LIMIT_DEFAULT = 25;

/** Sekme başına URL parametreleri (`page`, `limit`, `q`, `f` filtresi) — sekme değişince sıfırlanır. */
function useLogParams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const limit = Number(params.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT;
  const q = params.get('q') ?? '';
  const f = params.get('f') ?? '';

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

  return { page, limit, q, f, setParam };
}

/** Liste + araç çubuğu + sayfalama iskeleti (beş sekmenin ortak kabuğu). */
function LogShell({
  loading,
  error,
  empty,
  total,
  page,
  limit,
  setParam,
  reload,
  searchPlaceholder,
  q,
  filters,
  children,
  emptyMessage,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  total: number;
  page: number;
  limit: number;
  setParam: (patch: Record<string, string | number | null | undefined>) => void;
  reload: () => void;
  searchPlaceholder: string;
  q: string;
  filters?: React.ReactNode;
  children: React.ReactNode;
  emptyMessage: string;
}) {
  return (
    <div>
      <AdminToolbar
        className="mb-3"
        searchPlaceholder={searchPlaceholder}
        searchValue={q}
        onSearchChange={(v) => setParam({ q: v, page: 1 })}
        filters={filters}
        actions={
          <button type="button" onClick={reload} disabled={loading} className={cn(btn.secondary, btn.sm)}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Yenile
          </button>
        }
      />
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : empty ? (
        <AdminEmptyState icon={FileSearch} message={emptyMessage} />
      ) : (
        <AdminScrollTable
          footer={
            <Pagination
              total={total}
              page={page}
              limit={limit}
              onPageChange={(p) => setParam({ page: p })}
              onLimitChange={(l) => setParam({ limit: l, page: 1 })}
            />
          }
        >
          {children}
        </AdminScrollTable>
      )}
    </div>
  );
}

function DetailButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(btn.secondary, btn.sm)}>
      Detay
    </button>
  );
}

/* ── Denetim (AuditLog) ──────────────────────────────────────────────────── */

/** Ekran 22 › Denetim — `GET /admin/audit-logs` (yalnız ADMIN). Satırlar asla değişmez/silinmez. */
export function DenetimTab() {
  const { page, limit, q, f, setParam } = useLogParams();
  const { items, total, loading, error, reload } = usePaginatedList<AdminAuditLog>('/admin/audit-logs', {
    page,
    limit,
    search: q || undefined,
    module: f || undefined,
  });
  const [selected, setSelected] = useState<AdminAuditLog | null>(null);

  const modules = ['', 'auth', 'me', 'customers', 'catalog', 'content', 'settings', 'orders', 'subscriptions', 'media', 'jobs'];

  return (
    <>
      <LogShell
        loading={loading}
        error={error}
        empty={items.length === 0}
        total={total}
        page={page}
        limit={limit}
        setParam={setParam}
        reload={() => void reload()}
        q={q}
        searchPlaceholder="Özet / e-posta / varlık…"
        emptyMessage="Filtreye uyan denetim kaydı yok."
        filters={
          <FilterPills
            label="Modül"
            options={modules.map((m) => ({ key: m, label: m || 'Tümü' }))}
            value={f}
            onChange={(v) => setParam({ f: v, page: 1 })}
          />
        }
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th className={th}>Zaman</th>
              <th className={th}>Modül</th>
              <th className={th}>Eylem</th>
              <th className={th}>Özet</th>
              <th className={th}>Aktör</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className={cn(td, 'whitespace-nowrap text-xs')}>{formatDateTime(row.createdAt)}</td>
                <td className={cn(td, 'font-mono text-xs')}>{row.module}</td>
                <td className={td}>
                  <ToneBadge tone="neutral">{row.action}</ToneBadge>
                </td>
                <td className={cn(tdText, 'max-w-[24rem]')}>
                  <span className="line-clamp-2">{row.summary ?? <span className="text-brand-400">—</span>}</span>
                </td>
                <td className={cn(tdText, 'text-xs')}>{row.actorEmail ?? <span className="text-brand-400">sistem</span>}</td>
                <td className={td}>
                  <DetailButton onClick={() => setSelected(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LogShell>

      <LogDetailModal
        open={selected !== null}
        title={`Denetim kaydı — ${selected?.module ?? ''} ${selected?.action ?? ''}`}
        onClose={() => setSelected(null)}
        fields={
          selected
            ? ([
                { label: 'Zaman', value: formatDateTime(selected.createdAt) },
                { label: 'Modül', value: selected.module, mono: true },
                { label: 'Eylem', value: selected.action, mono: true },
                { label: 'Özet', value: selected.summary },
                { label: 'Aktör', value: selected.actorEmail ?? 'sistem' },
                { label: 'Varlık', value: selected.entityId, mono: true },
                { label: 'İstek', value: selected.requestId, mono: true },
                { label: 'IP', value: selected.ipAddress, mono: true },
              ] as DetailField[])
            : []
        }
        blocks={
          selected
            ? ([
                { label: 'Önceki değerler', value: selected.oldValues },
                { label: 'Yeni değerler', value: selected.newValues },
              ] as DetailJsonBlock[])
            : []
        }
      />
    </>
  );
}

/* ── Sistem (SystemLog) ──────────────────────────────────────────────────── */

/** Ekran 22 › Sistem — `GET /admin/system-logs`. 5xx hataları parmak izine göre tekilleştirilir (30 gün). */
export function SistemLogTab() {
  const { page, limit, q, f, setParam } = useLogParams();
  const { items, total, loading, error, reload } = usePaginatedList<SystemLogItem>('/admin/system-logs', {
    page,
    limit,
    search: q || undefined,
    level: f || undefined,
  });
  const [selected, setSelected] = useState<SystemLogItem | null>(null);

  return (
    <>
      <LogShell
        loading={loading}
        error={error}
        empty={items.length === 0}
        total={total}
        page={page}
        limit={limit}
        setParam={setParam}
        reload={() => void reload()}
        q={q}
        searchPlaceholder="Mesaj / modül / eylem…"
        emptyMessage="Filtreye uyan sistem kaydı yok."
        filters={
          <FilterPills
            label="Seviye"
            options={[{ key: '', label: 'Tümü' }, ...SYSTEM_LOG_LEVEL_VALUES.map((l) => ({ key: l as string, label: systemLevelLabel(l) }))]}
            value={f}
            onChange={(v) => setParam({ f: v, page: 1 })}
          />
        }
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th className={th}>Son görülme</th>
              <th className={th}>Seviye</th>
              <th className={th}>Modül</th>
              <th className={th}>Mesaj</th>
              <th className={th}>Tekrar</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={cn(row.level === 'error' || row.level === 'fatal' ? 'bg-accent-light/40' : undefined)}>
                <td className={cn(td, 'whitespace-nowrap text-xs')}>{formatDateTime(row.lastSeenAt)}</td>
                <td className={td}>
                  <SystemLevelBadge level={row.level} />
                </td>
                <td className={cn(td, 'font-mono text-xs')}>
                  {row.module}
                  {row.action ? <span className="text-brand-400"> · {row.action}</span> : null}
                </td>
                <td className={cn(tdText, 'max-w-[28rem]')}>
                  <span className="line-clamp-2" title={row.message}>{row.message}</span>
                </td>
                <td className={cn(td, 'text-xs')}>{row.occurrenceCount}</td>
                <td className={td}>
                  <DetailButton onClick={() => setSelected(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LogShell>

      <LogDetailModal
        open={selected !== null}
        title={`Sistem kaydı — ${selected?.module ?? ''}`}
        onClose={() => setSelected(null)}
        fields={
          selected
            ? ([
                { label: 'Seviye', value: systemLevelLabel(selected.level) },
                { label: 'Modül', value: selected.module, mono: true },
                { label: 'Eylem', value: selected.action, mono: true },
                { label: 'Mesaj', value: selected.message, mono: true },
                { label: 'İlk görülme', value: formatDateTime(selected.firstSeenAt) },
                { label: 'Son görülme', value: formatDateTime(selected.lastSeenAt) },
                { label: 'Tekrar', value: selected.occurrenceCount },
                { label: 'İstek', value: selected.requestId, mono: true },
                { label: 'Kullanıcı', value: selected.userId, mono: true },
                { label: 'Parmak izi', value: selected.fingerprint, mono: true },
              ] as DetailField[])
            : []
        }
        blocks={selected ? [{ label: 'Ek veri (redakte)', value: selected.metadata }] : []}
      />
    </>
  );
}

/* ── Cron (CronLog) ──────────────────────────────────────────────────────── */

/** Ekran 22 › Cron — `GET /admin/cron-logs`. Her job koşusu bir satır (90 gün). */
export function CronTab() {
  const { page, limit, q, f, setParam } = useLogParams();
  const { items, total, loading, error, reload } = usePaginatedList<CronLogItem>('/admin/cron-logs', {
    page,
    limit,
    search: q || undefined,
    status: f || undefined,
  });
  const [selected, setSelected] = useState<CronLogItem | null>(null);

  return (
    <>
      <LogShell
        loading={loading}
        error={error}
        empty={items.length === 0}
        total={total}
        page={page}
        limit={limit}
        setParam={setParam}
        reload={() => void reload()}
        q={q}
        searchPlaceholder="İş adı…"
        emptyMessage="Filtreye uyan cron kaydı yok."
        filters={
          <FilterPills
            label="Durum"
            options={[{ key: '', label: 'Tümü' }, ...CRON_LOG_STATUS_VALUES.map((s) => ({ key: s as string, label: cronStatusLabel(s) }))]}
            value={f}
            onChange={(v) => setParam({ f: v, page: 1 })}
          />
        }
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th className={th}>Başlangıç</th>
              <th className={th}>İş</th>
              <th className={th}>Durum</th>
              <th className={th}>Kayıt</th>
              <th className={th}>Hata</th>
              <th className={th}>Süre (ms)</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={cn(row.status === 'FAILED' && 'bg-accent-light/40')}>
                <td className={cn(td, 'whitespace-nowrap text-xs')}>{formatDateTime(row.startedAt)}</td>
                <td className={cn(td, 'font-mono text-xs')}>{row.name}</td>
                <td className={td}>
                  <CronStatusBadge status={row.status} />
                </td>
                <td className={td}>{row.itemsProcessed}</td>
                <td className={cn(td, row.errors > 0 && 'font-semibold text-accent-dark')}>{row.errors}</td>
                <td className={cn(td, 'text-xs')}>{row.durationMs ?? '—'}</td>
                <td className={td}>
                  <DetailButton onClick={() => setSelected(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LogShell>

      <LogDetailModal
        open={selected !== null}
        title={`Cron koşusu — ${selected?.name ?? ''}`}
        onClose={() => setSelected(null)}
        fields={
          selected
            ? ([
                { label: 'İş', value: selected.name, mono: true },
                { label: 'Durum', value: cronStatusLabel(selected.status) },
                { label: 'Başlangıç', value: formatDateTime(selected.startedAt) },
                { label: 'Bitiş', value: formatDateTime(selected.finishedAt) },
                { label: 'Süre', value: selected.durationMs === null ? '—' : `${selected.durationMs} ms` },
                { label: 'İşlenen', value: selected.itemsProcessed },
                { label: 'Hata', value: selected.errors },
              ] as DetailField[])
            : []
        }
        blocks={selected ? [{ label: 'Ayrıntı', value: selected.details }] : []}
      />
    </>
  );
}

/* ── E-posta (MailLog) ───────────────────────────────────────────────────── */

/** Ekran 22 › E-posta — `GET /admin/mail-logs`. Ayrıntılı görünüm Sistem › E-posta Günlüğü ekranındadır. */
export function EpostaTab() {
  const { page, limit, q, f, setParam } = useLogParams();
  const { items, total, loading, error, reload } = usePaginatedList<AdminMailLog>('/admin/mail-logs', {
    page,
    limit,
    to: q || undefined,
    status: f || undefined,
  });
  const [selected, setSelected] = useState<AdminMailLog | null>(null);

  return (
    <>
      <LogShell
        loading={loading}
        error={error}
        empty={items.length === 0}
        total={total}
        page={page}
        limit={limit}
        setParam={setParam}
        reload={() => void reload()}
        q={q}
        searchPlaceholder="Alıcı e-postası…"
        emptyMessage="Filtreye uyan e-posta kaydı yok."
        filters={
          <FilterPills
            label="Durum"
            options={[{ key: '', label: 'Tümü' }, ...MAIL_STATUS_VALUES.map((s) => ({ key: s as string, label: MAIL_STATUS_LABELS[s] }))]}
            value={f}
            onChange={(v) => setParam({ f: v, page: 1 })}
          />
        }
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th className={th}>Oluşturma</th>
              <th className={th}>Alıcı</th>
              <th className={th}>Şablon</th>
              <th className={th}>Konu</th>
              <th className={th}>Durum</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={cn(row.status === 'FAILED' && 'bg-accent-light/40')}>
                <td className={cn(td, 'whitespace-nowrap text-xs')}>{formatDateTime(row.createdAt)}</td>
                <td className={cn(tdText, 'text-xs')}>{row.to}</td>
                <td className={cn(td, 'font-mono text-xs')}>{row.templateSlug || '—'}</td>
                <td className={cn(tdText, 'max-w-[20rem]')}>
                  <span className="line-clamp-2">{row.subject}</span>
                </td>
                <td className={td}>
                  <ToneBadge tone={row.status === 'SENT' ? 'good' : row.status === 'FAILED' ? 'bad' : 'warn'}>
                    {mailStatusLabel(String(row.status))}
                  </ToneBadge>
                </td>
                <td className={td}>
                  <DetailButton onClick={() => setSelected(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LogShell>

      <LogDetailModal
        open={selected !== null}
        title={`E-posta — ${selected?.templateSlug ?? ''}`}
        onClose={() => setSelected(null)}
        fields={
          selected
            ? ([
                { label: 'Alıcı', value: selected.to },
                { label: 'Konu', value: selected.subject },
                { label: 'Şablon', value: selected.templateSlug, mono: true },
                { label: 'Durum', value: mailStatusLabel(String(selected.status)) },
                { label: 'Varlık', value: selected.entityId, mono: true },
                { label: 'Oluşturma', value: formatDateTime(selected.createdAt) },
                { label: 'Gönderim', value: formatDateTime(selected.sentAt) },
                { label: 'Hata', value: mailErrorText(selected.error) },
                { label: 'Önizleme', value: parseMailPreview(selected.error), mono: true },
              ] as DetailField[])
            : []
        }
      />
    </>
  );
}

/* ── Webhook (WebhookEvent) ──────────────────────────────────────────────── */

/** Ekran 22 › Webhook — `GET /admin/webhook-events`. `payload` sunucuda redakte edilir (imza/PII yok). */
export function WebhookTab() {
  const { page, limit, q, f, setParam } = useLogParams();
  const { items, total, loading, error, reload } = usePaginatedList<WebhookEventItem>('/admin/webhook-events', {
    page,
    limit,
    search: q || undefined,
    status: f || undefined,
  });
  const [selected, setSelected] = useState<WebhookEventItem | null>(null);

  return (
    <>
      <LogShell
        loading={loading}
        error={error}
        empty={items.length === 0}
        total={total}
        page={page}
        limit={limit}
        setParam={setParam}
        reload={() => void reload()}
        q={q}
        searchPlaceholder="Sağlayıcı referansı / olay türü…"
        emptyMessage="Filtreye uyan webhook kaydı yok."
        filters={
          <FilterPills
            label="Durum"
            options={[{ key: '', label: 'Tümü' }, ...WEBHOOK_STATUS_VALUES.map((s) => ({ key: s as string, label: webhookStatusLabel(s) }))]}
            value={f}
            onChange={(v) => setParam({ f: v, page: 1 })}
          />
        }
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th className={th}>Alınma</th>
              <th className={th}>Sağlayıcı</th>
              <th className={th}>Olay</th>
              <th className={th}>Referans</th>
              <th className={th}>İmza</th>
              <th className={th}>Durum</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={cn((row.status === 'FAILED' || !row.signatureValid) && 'bg-accent-light/40')}>
                <td className={cn(td, 'whitespace-nowrap text-xs')}>{formatDateTime(row.receivedAt)}</td>
                <td className={cn(td, 'text-xs')}>{PAYMENT_PROVIDER_LABELS[row.provider] ?? row.provider}</td>
                <td className={cn(td, 'font-mono text-xs')}>{row.eventType}</td>
                <td className={cn(td, 'font-mono text-xs')}>{row.providerRef}</td>
                <td className={td}>
                  <ToneBadge tone={row.signatureValid ? 'good' : 'bad'}>{row.signatureValid ? 'geçerli' : 'geçersiz'}</ToneBadge>
                </td>
                <td className={td}>
                  <WebhookStatusBadge status={row.status} />
                </td>
                <td className={td}>
                  <DetailButton onClick={() => setSelected(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LogShell>

      <LogDetailModal
        open={selected !== null}
        title={`Webhook — ${selected?.eventType ?? ''}`}
        onClose={() => setSelected(null)}
        fields={
          selected
            ? ([
                { label: 'Sağlayıcı', value: PAYMENT_PROVIDER_LABELS[selected.provider] ?? selected.provider },
                { label: 'Olay', value: selected.eventType, mono: true },
                { label: 'Referans', value: selected.providerRef, mono: true },
                { label: 'İmza', value: selected.signatureValid ? 'geçerli' : 'geçersiz' },
                { label: 'Durum', value: webhookStatusLabel(selected.status) },
                { label: 'Alınma', value: formatDateTime(selected.receivedAt) },
                { label: 'İşlenme', value: formatDateTime(selected.processedAt) },
                { label: 'Hata', value: selected.error },
              ] as DetailField[])
            : []
        }
        blocks={selected ? [{ label: 'Gövde (redakte)', value: selected.payload }] : []}
      />
    </>
  );
}
