import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ADMIN_ROOT, findAdminNavGroup, findAdminNavLeaf } from '../../lib/adminNavConfig';
import { cn } from '../../lib/utils';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Ek kırıntı (ör. ürün adı); menü grubu + leaf otomatik eklenir. */
  crumb?: string;
  className?: string;
};

/** Sayfa başlığı: kırıntı (Özet › Grup › Ekran [› crumb]) + başlık + sağ aksiyonlar. */
export function AdminPageHeader({ title, description, actions, crumb, className }: Props) {
  const { pathname } = useLocation();
  const leaf = findAdminNavLeaf(pathname);
  const group = findAdminNavGroup(pathname);
  // Özet'in kendisinde "Özet › Özet" yazmasın: kök leaf kırıntıda yalnız bir kez görünür.
  const isRoot = leaf?.to === ADMIN_ROOT;
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <nav aria-label="Konum" className="mb-1 text-xs text-brand-500">
          {isRoot && !crumb ? (
            <span className="text-brand-800">Özet</span>
          ) : (
            <Link to={ADMIN_ROOT} className="hover:text-accent">Özet</Link>
          )}
          {group && (
            <>
              <span aria-hidden> › </span>
              <span>{group.label}</span>
            </>
          )}
          {leaf && !isRoot && (
            <>
              <span aria-hidden> › </span>
              {crumb ? <Link to={leaf.to} className="hover:text-accent">{leaf.label}</Link> : <span className="text-brand-800">{leaf.label}</span>}
            </>
          )}
          {crumb && (
            <>
              <span aria-hidden> › </span>
              <span className="text-brand-800">{crumb}</span>
            </>
          )}
        </nav>
        <h1 className="text-lg font-semibold text-brand-900 sm:text-xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-brand-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
