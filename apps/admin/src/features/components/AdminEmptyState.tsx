import { type LucideIcon, SearchX } from 'lucide-react';
import { btn } from '../../lib/buttonStyles';

type Props = {
  icon?: LucideIcon;
  message: string;
  cta?: { label: string; onClick: () => void };
};

/** Boş liste durumu. */
export function AdminEmptyState({ icon: Icon = SearchX, message, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <Icon className="h-10 w-10 text-brand-300" strokeWidth={1.5} aria-hidden />
      <p className="text-sm text-brand-500">{message}</p>
      {cta && (
        <button type="button" onClick={cta.onClick} className={btn.primary}>
          {cta.label}
        </button>
      )}
    </div>
  );
}
