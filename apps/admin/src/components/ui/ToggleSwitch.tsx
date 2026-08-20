import { cn } from '../../lib/utils';

type Props = {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
};

export function ToggleSwitch({ checked, onChange, label, description }: Props) {
  return (
    <label className="group flex cursor-pointer items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/25 focus:ring-offset-1',
          checked ? 'border-olive bg-olive' : 'border-brand-300 bg-brand-200',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
      <div className="select-none">
        <span className="text-sm font-medium text-brand-800 group-hover:text-brand-900">{label}</span>
        {description && <p className="text-[11px] leading-tight text-brand-500">{description}</p>}
      </div>
    </label>
  );
}
