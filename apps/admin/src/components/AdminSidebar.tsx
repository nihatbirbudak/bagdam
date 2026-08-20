import { useEffect, useState } from 'react';
import { ChevronDown, Pin, PinOff, type LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ADMIN_ROOT,
  adminNavItems,
  isAdminNavGroup,
  isAdminNavGroupActive,
  isNavDivider,
  isNavLeaf,
  navLinkEnd,
  type AdminNavGroup,
  type AdminNavLeaf,
} from '../lib/adminNavConfig';
import { getAdminGroupIcon, getAdminLinkIcon } from '../lib/adminNavIcons';
import { cn } from '../lib/utils';

interface Props {
  open: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
}

const SIDEBAR_W_COLLAPSED = 'w-[60px]';
const SIDEBAR_W_EXPANDED = 'w-[240px]';

/** F1'de yer tutucu ekranlar için küçük faz rozeti. */
export function PhaseBadge({ leaf, className }: { leaf: AdminNavLeaf; className?: string }) {
  if (!leaf.comingSoon || !leaf.phase) return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded border border-brand-200 bg-brand-100 px-1 text-[10px] font-semibold leading-4 text-brand-500',
        className,
      )}
      title={`Bu ekran ${leaf.phase} fazında geliyor`}
    >
      {leaf.phase}
    </span>
  );
}

export function AdminSidebar({ open, pinned, onTogglePin, onHoverEnter, onHoverLeave }: Props) {
  const location = useLocation();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Aktif grubu otomatik aç
  useEffect(() => {
    for (const item of adminNavItems) {
      if (isAdminNavGroup(item) && isAdminNavGroupActive(item, location.pathname)) {
        setExpandedGroup(item.label);
        return;
      }
    }
  }, [location.pathname]);

  function toggleGroup(label: string) {
    setExpandedGroup((prev) => (prev === label ? null : label));
  }

  return (
    <aside
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className={cn(
        'hidden lg:flex flex-col shrink-0 border-r border-brand-200 bg-white transition-all duration-200 overflow-hidden',
        'sticky top-12 h-[calc(100vh-3rem)] z-40',
        open ? SIDEBAR_W_EXPANDED : SIDEBAR_W_COLLAPSED,
      )}
    >
      {/* Sabitle / bırak — yalnız genişken */}
      {open && (
        <div className="flex justify-end px-2 pt-2">
          <button
            type="button"
            onClick={onTogglePin}
            className="rounded p-1 text-brand-400 transition-colors hover:bg-brand-100 hover:text-accent"
            title={pinned ? 'Sabitlemeyi kaldır' : 'Menüyü sabitle'}
          >
            {pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 hide-scrollbar" aria-label="Yan menü">
        {adminNavItems.map((item) => {
          /* ── Leaf (Özet) ── */
          if (!isAdminNavGroup(item)) {
            const LeafIcon = getAdminLinkIcon(item.to);
            const isActive =
              item.to === ADMIN_ROOT
                ? location.pathname === ADMIN_ROOT
                : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={navLinkEnd(item.to)}
                title={!open ? item.label : undefined}
                className={cn(
                  'mx-2 mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent/10 text-accent' : 'text-brand-700 hover:bg-brand-50 hover:text-accent',
                )}
              >
                <LeafIcon className="h-5 w-5 shrink-0" aria-hidden />
                {open && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          }

          /* ── Grup ── */
          return (
            <SidebarGroup
              key={item.label}
              group={item}
              icon={getAdminGroupIcon(item.label)}
              open={open}
              expanded={expandedGroup === item.label}
              onToggle={() => toggleGroup(item.label)}
              pathname={location.pathname}
            />
          );
        })}
      </nav>
    </aside>
  );
}

/* ── Sidebar grubu (akordeon) ─────────────────────────── */

function SidebarGroup({
  group,
  icon: GroupIcon,
  open,
  expanded,
  onToggle,
  pathname,
}: {
  group: AdminNavGroup;
  /** Üst bileşende çözülür (render içinde bileşen üretme — react-hooks/static-components). */
  icon: LucideIcon;
  open: boolean;
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
}) {
  const groupActive = isAdminNavGroupActive(group, pathname);

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        title={!open ? group.label : undefined}
        aria-expanded={open ? expanded : undefined}
        className={cn(
          'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
          groupActive ? 'bg-accent/10 text-accent' : 'text-brand-700 hover:bg-brand-50 hover:text-accent',
        )}
      >
        <GroupIcon className="h-5 w-5 shrink-0" aria-hidden />
        {open && (
          <>
            <span className="flex-1 truncate text-left">{group.label}</span>
            <ChevronDown
              size={14}
              className={cn('shrink-0 opacity-60 transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </>
        )}
      </button>

      {/* Akordeon içeriği */}
      {open && expanded && (
        <div className="ml-4 mr-2 mt-0.5 space-y-px border-l border-brand-200 pl-3">
          {group.children.map((child, i) => {
            if (isNavDivider(child)) {
              return (
                <div
                  key={`d-${i}`}
                  className="pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400"
                >
                  {child.divider}
                </div>
              );
            }
            if (!isNavLeaf(child)) return null;
            const ChildIcon = getAdminLinkIcon(child.to);
            return (
              <NavLink
                key={child.to}
                to={child.to}
                end={navLinkEnd(child.to)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive ? 'font-semibold text-accent' : 'text-brand-700 hover:bg-brand-50 hover:text-accent',
                  )
                }
              >
                <ChildIcon className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
                <span className="flex-1 truncate">{child.label}</span>
                <PhaseBadge leaf={child} />
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
