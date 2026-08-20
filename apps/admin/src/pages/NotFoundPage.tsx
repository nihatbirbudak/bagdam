import { ArrowLeft, SearchX } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

/** 404 — menüde olmayan yol. */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="px-4 py-4">
      <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center rounded-2xl border border-brand-200 bg-white p-8 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-500">
          <SearchX size={22} aria-hidden />
        </span>
        <p className="font-mono text-xs text-brand-400">404</p>
        <h1 className="mt-1 text-lg sm:text-xl">Sayfa bulunamadı</h1>
        <p className="mt-2 max-w-md text-sm text-brand-600">
          <code className="rounded bg-brand-100 px-1.5 py-0.5 text-xs">{pathname}</code> yolu yönetim menüsünde yok.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-md border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={16} aria-hidden />
          Özete dön
        </Link>
      </div>
    </div>
  );
}
