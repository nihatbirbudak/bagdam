import { ArrowLeft, Construction } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { findAdminNavGroup, findAdminNavLeaf } from '../lib/adminNavConfig';
import { getPhase } from '../lib/phases';
import { NotFoundPage } from './NotFoundPage';

/** F1 yer tutucu: menüden gelen başlık + "Bu ekran F? fazında geliyor". */
export function PlaceholderPage() {
  const { pathname } = useLocation();
  const leaf = findAdminNavLeaf(pathname);
  if (!leaf) return <NotFoundPage />;

  const group = findAdminNavGroup(pathname);
  const phase = leaf.phase ? getPhase(leaf.phase) : undefined;

  return (
    <div className="px-4 py-4">
      <nav aria-label="Konum" className="mb-3 text-xs text-brand-500">
        <Link to="/" className="hover:text-accent">
          Özet
        </Link>
        {group && (
          <>
            <span aria-hidden> › </span>
            <span>{group.label}</span>
          </>
        )}
        <span aria-hidden> › </span>
        <span className="text-brand-800">{leaf.label}</span>
      </nav>

      <div
        className="flex min-h-[calc(100vh-10rem)] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/80 p-8 text-center"
        aria-label="Yönetim içerik alanı — henüz içerik yok"
      >
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Construction size={22} aria-hidden />
        </span>
        <h1 className="text-lg sm:text-xl">{leaf.label}</h1>
        <p className="mt-2 text-sm text-brand-700">
          Bu ekran <strong className="text-brand-900">{leaf.phase ?? 'ileriki'}</strong> fazında geliyor.
        </p>
        {phase && (
          <p className="mt-1 max-w-md text-xs text-brand-500">
            {phase.key} — {phase.title}: {phase.summary}
          </p>
        )}
        {leaf.hint && <p className="mt-4 max-w-lg text-sm text-brand-600">{leaf.hint}</p>}
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={16} aria-hidden />
          Özete dön
        </Link>
      </div>
    </div>
  );
}
