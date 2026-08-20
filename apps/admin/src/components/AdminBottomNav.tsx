import { useLocation, useNavigate } from 'react-router-dom';
import {
  ADMIN_ROOT,
  BOTTOM_NAV_KEYS,
  adminNavItems,
  isAdminNavGroup,
  isAdminNavGroupActive,
  type AdminNavItem,
} from '../lib/adminNavConfig';
import { getAdminGroupIcon, getAdminLinkIcon, MoreHorizontal } from '../lib/adminNavIcons';
import { cn } from '../lib/utils';

interface Props {
  onOpenDrawer: (groupLabel: string | null) => void;
  activeDrawer: string | null;
}

/** Mobil alt çubuk: 5 sabit öğe + "Daha Fazla" (grid-cols-6). */
export function AdminBottomNav({ onOpenDrawer, activeDrawer }: Props) {
  const location = useLocation();
  const navigate = useNavigate();

  const bottomItems = BOTTOM_NAV_KEYS.map((key) => adminNavItems.find((i) => i.label === key)).filter(
    (i): i is AdminNavItem => !!i,
  );

  function handleTap(item: AdminNavItem) {
    // Leaf (Özet) → doğrudan git
    if (!isAdminNavGroup(item)) {
      onOpenDrawer(null);
      navigate(item.to);
      return;
    }
    // Grup → çekmece aç/kapat
    onOpenDrawer(activeDrawer === item.label ? null : item.label);
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Alt menü"
    >
      <div className="grid h-14 grid-cols-6">
        {bottomItems.map((item) => {
          const label = item.label;
          const Icon = isAdminNavGroup(item) ? getAdminGroupIcon(label) : getAdminLinkIcon(item.to);

          const isActive = isAdminNavGroup(item)
            ? isAdminNavGroupActive(item, location.pathname)
            : item.to === ADMIN_ROOT
              ? location.pathname === ADMIN_ROOT
              : location.pathname === item.to;

          const isDrawerActive = activeDrawer === label;

          return (
            <button
              key={label}
              type="button"
              onClick={() => handleTap(item)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                isActive || isDrawerActive ? 'text-accent' : 'text-brand-500 active:text-accent',
              )}
            >
              {(isActive || isDrawerActive) && <span className="absolute top-0 h-0.5 w-8 rounded-b bg-accent" />}
              <Icon className="h-5 w-5" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          );
        })}

        {/* Daha Fazla */}
        <button
          type="button"
          onClick={() => onOpenDrawer(activeDrawer === '__more__' ? null : '__more__')}
          className={cn(
            'relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            activeDrawer === '__more__' ? 'text-accent' : 'text-brand-500 active:text-accent',
          )}
        >
          {activeDrawer === '__more__' && <span className="absolute top-0 h-0.5 w-8 rounded-b bg-accent" />}
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          <span>Daha Fazla</span>
        </button>
      </div>
    </nav>
  );
}
