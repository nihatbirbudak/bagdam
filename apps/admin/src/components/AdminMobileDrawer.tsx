import { useEffect } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BOTTOM_NAV_KEYS,
  adminNavItems,
  isAdminNavGroup,
  isNavDivider,
  isNavLeaf,
  navLinkEnd,
  type AdminNavGroup,
} from '../lib/adminNavConfig';
import { getAdminGroupIcon, getAdminLinkIcon } from '../lib/adminNavIcons';
import { PhaseBadge } from './AdminSidebar';
import { cn } from '../lib/utils';

interface Props {
  activeDrawer: string | null;
  onClose: () => void;
}

const bottomKeys: readonly string[] = BOTTOM_NAV_KEYS;

export function AdminMobileDrawer({ activeDrawer, onClose }: Props) {
  const location = useLocation();

  // Rota değişince kapat
  useEffect(() => {
    onClose();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeDrawer) return null;

  const isMore = activeDrawer === '__more__';

  // "Daha Fazla" → alt çubukta olmayan gruplar
  const moreGroups = isMore
    ? adminNavItems.filter((item): item is AdminNavGroup => isAdminNavGroup(item) && !bottomKeys.includes(item.label))
    : [];

  // Tekil grup çekmecesi
  const singleGroup = !isMore
    ? adminNavItems.find((item): item is AdminNavGroup => isAdminNavGroup(item) && item.label === activeDrawer)
    : undefined;

  return (
    <>
      {/* Arka plan */}
      <div className="fixed inset-0 z-40 bg-black/30 lg:hidden animate-fade-in" onClick={onClose} aria-hidden />

      {/* Çekmece paneli */}
      <div
        className={cn('fixed inset-x-0 bottom-14 top-0 z-50 flex flex-col bg-white lg:hidden', 'animate-slide-up')}
        role="dialog"
        aria-modal
        aria-label={isMore ? 'Daha fazla menü' : activeDrawer}
      >
        <div className="flex items-center justify-between border-b border-brand-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-brand-900">{isMore ? 'Daha Fazla' : activeDrawer}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-brand-500 transition-colors hover:bg-brand-100"
            aria-label="Kapat"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isMore &&
            moreGroups.map((group) => (
              <MoreGroupSection key={group.label} group={group} icon={getAdminGroupIcon(group.label)} />
            ))}
          {singleGroup && <GroupLinks group={singleGroup} />}
        </div>
      </div>
    </>
  );
}

/* ── "Daha Fazla" altındaki her grup ───────────────────── */

function MoreGroupSection({ group, icon: GroupIcon }: { group: AdminNavGroup; icon: LucideIcon }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-400">
        <GroupIcon className="h-4 w-4" aria-hidden />
        {group.label}
      </div>
      <GroupLinks group={group} />
    </div>
  );
}

/* ── Grup alt linkleri + ayraçlar ───────────────────────── */

function GroupLinks({ group }: { group: AdminNavGroup }) {
  return (
    <div className="space-y-px">
      {group.children.map((child, i) => {
        if (isNavDivider(child)) {
          return (
            <div key={`d-${i}`} className="pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
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
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-accent/10 font-semibold text-accent' : 'text-brand-800 hover:bg-brand-50',
              )
            }
          >
            <ChildIcon className="h-5 w-5 shrink-0 text-brand-400" aria-hidden />
            <span className="flex-1">{child.label}</span>
            <PhaseBadge leaf={child} />
          </NavLink>
        );
      })}
    </div>
  );
}
