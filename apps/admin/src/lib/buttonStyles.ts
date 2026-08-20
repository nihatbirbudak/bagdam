/** Ortak düğme sınıfları (Bağdam paleti). `cn(btn.primary, 'w-full')` gibi kullanılır. */
const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50';

export const btn = {
  primary: `${base} border border-accent bg-accent px-3.5 py-2 text-white hover:bg-accent-dark hover:border-accent-dark`,
  secondary: `${base} border border-brand-300 bg-white px-3.5 py-2 text-brand-700 hover:border-brand-400 hover:bg-brand-50`,
  outline: `${base} border border-accent bg-white px-3.5 py-2 text-accent hover:bg-accent-light`,
  danger: `${base} border border-accent-dark bg-accent-dark px-3.5 py-2 text-white hover:bg-accent`,
  ghost: `${base} px-2.5 py-1.5 text-brand-600 hover:bg-brand-100 hover:text-brand-900`,
  /** Küçük boy (tablo içi). */
  sm: 'px-2.5 py-1.5 text-xs',
  /** Yalnız ikon (kare). */
  icon: `${base} h-8 w-8 rounded-md border border-brand-200 bg-white text-brand-600 hover:border-accent hover:text-accent`,
  iconDanger: `${base} h-8 w-8 rounded-md border border-brand-200 bg-white text-brand-600 hover:border-accent-dark hover:text-accent-dark`,
} as const;
