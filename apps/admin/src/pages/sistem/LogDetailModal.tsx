import type { ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal';
import { prettyJson } from '../../features/sistem/system';
import { btn } from '../../lib/buttonStyles';

export interface DetailField {
  label: string;
  value: ReactNode;
  /** Uzun/monospace değerler (id, requestId, mesaj). */
  mono?: boolean;
}

export interface DetailJsonBlock {
  label: string;
  value: unknown;
}

/**
 * Ekran 22 günlük detayı — alan listesi + (varsa) JSON blokları (metadata / details / payload /
 * eski-yeni değerler). Salt okunur; günlük satırları panelden değiştirilemez.
 */
export function LogDetailModal({
  open,
  title,
  fields,
  blocks,
  onClose,
}: {
  open: boolean;
  title: string;
  fields: DetailField[];
  blocks?: DetailJsonBlock[];
  onClose: () => void;
}) {
  const rendered = (blocks ?? [])
    .map((b) => ({ label: b.label, text: prettyJson(b.value) }))
    .filter((b): b is { label: string; text: string } => b.text !== null);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="lg"
      footer={
        <button type="button" onClick={onClose} className={btn.secondary} data-modal-close>
          Kapat
        </button>
      }
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
        {fields.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-xs font-semibold uppercase tracking-wide text-brand-500">{f.label}</dt>
            <dd className={f.mono ? 'break-all font-mono text-xs text-brand-800' : 'text-sm text-brand-800'}>
              {f.value ?? <span className="text-brand-400">—</span>}
            </dd>
          </div>
        ))}
      </dl>

      {rendered.map((b) => (
        <div key={b.label} className="mt-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-500">{b.label}</p>
          <pre className="max-h-72 overflow-auto rounded-md border border-brand-200 bg-brand-50 p-3 text-[11px] leading-relaxed text-brand-800">
            {b.text}
          </pre>
        </div>
      ))}
    </Modal>
  );
}
