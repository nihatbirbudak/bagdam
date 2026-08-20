import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type TabDef = { key: string; label: string; /** Sekmede hata var (kırmızı nokta). */ hasError?: boolean; badge?: ReactNode };

type Props = {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (key: string) => void;
  children: ReactNode;
};

/** Yatay sekme çubuğu + içerik. */
export function AdminTabPanel({ tabs, activeTab, onTabChange, children }: Props) {
  return (
    <div>
      <div className="border-b border-brand-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto px-1 hide-scrollbar" aria-label="Sekmeler" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-brand-500 hover:border-brand-300 hover:text-brand-700',
              )}
            >
              {tab.label}
              {tab.badge}
              {tab.hasError && <span className="h-1.5 w-1.5 rounded-full bg-accent-dark" aria-label="Bu sekmede hata var" />}
            </button>
          ))}
        </nav>
      </div>
      <div className="pt-4">{children}</div>
    </div>
  );
}
