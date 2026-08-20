import { Filter, Search, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { cn } from '../../lib/utils';

type Props = {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** Sağ üst aksiyonlar (Yeni, Yükle…). */
  actions?: ReactNode;
  /** Masaüstünde her zaman; mobilde açılır panelde gösterilir. */
  filters?: ReactNode;
  /** Debounce süresi (ms). 0 ise kapalı. */
  debounceMs?: number;
  className?: string;
};

/** Liste araç çubuğu: arama (debounce) + filtreler + aksiyonlar (UA kalıbı). */
export function AdminToolbar({
  searchPlaceholder = 'Ara…',
  searchValue,
  onSearchChange,
  actions,
  filters,
  debounceMs = 300,
  className,
}: Props) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchValue);
  const searchId = useId();

  useEffect(() => {
    setLocalSearch(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (debounceMs <= 0) return;
    const timer = setTimeout(() => {
      if (localSearch !== searchValue) onSearchChange(localSearch);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [localSearch, debounceMs, searchValue, onSearchChange]);

  function handleChange(val: string) {
    setLocalSearch(val);
    if (debounceMs <= 0) onSearchChange(val);
  }

  function handleClear() {
    setLocalSearch('');
    onSearchChange('');
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 max-w-xl flex-1">
          <label htmlFor={searchId} className="sr-only">Ara</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400" aria-hidden />
          <input
            id={searchId}
            type="search"
            autoComplete="off"
            placeholder={searchPlaceholder}
            value={localSearch}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full rounded-md border border-brand-300 bg-white py-2 pl-9 pr-8 text-sm text-brand-900 placeholder:text-brand-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {localSearch && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-brand-400 hover:text-brand-700"
              aria-label="Aramayı temizle"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters ? (
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-2 text-sm font-medium text-brand-800 lg:hidden',
                mobileFiltersOpen && 'border-accent ring-2 ring-accent/20',
              )}
              aria-expanded={mobileFiltersOpen}
            >
              <Filter className="h-4 w-4" aria-hidden />
              Filtreler
            </button>
          ) : null}
          {actions}
        </div>
      </div>
      {filters ? (
        <div className={cn('rounded-md border border-brand-200 bg-white p-3', !mobileFiltersOpen && 'hidden lg:block')}>
          <div className="flex flex-wrap items-center gap-2">{filters}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Filtre hap grubu (tek seçim). */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {label && <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-brand-400">{label}</span>}
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            value === opt.key
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-brand-300 text-brand-600 hover:border-brand-400 hover:bg-brand-50',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
