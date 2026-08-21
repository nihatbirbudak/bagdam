import { USER_ROLE_LABELS, type UserRole } from '@bagdam/shared';
import { Home, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ADMIN_ROOT } from '../lib/adminNavConfig';
import { useAdminAuth } from '../contexts/AdminAuthContext';
import type { AuthUser } from '../lib/apiTypes';
import { cn } from '../lib/utils';

interface Props {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

/** `/auth/me` → `{name, email, role}`; ad yoksa e-posta. */
function displayName(user: AuthUser): string {
  return (user.name ?? '').trim() || user.email;
}

function roleLabel(role: AuthUser['role']): string {
  const key = String(role).toUpperCase() as UserRole;
  return USER_ROLE_LABELS[key] ?? String(role);
}

export function AdminTopBar({ sidebarOpen, onToggleSidebar }: Props) {
  const navigate = useNavigate();
  const { user, logout } = useAdminAuth();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const SidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <header className="sticky top-0 z-50 border-b border-brand-200 bg-white shadow-sm print:hidden">
      <div className="flex h-12 items-center gap-3 px-4">
        {/* Sol: marka + yan menü düğmesi (yalnız masaüstü) */}
        <Link
          to={ADMIN_ROOT}
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight text-brand-900"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-light"
            aria-hidden
          >
            B
          </span>
          <span className="hidden sm:inline">
            Bağdam <span className="font-normal text-brand-500">Yönetim</span>
          </span>
        </Link>

        <button
          type="button"
          onClick={onToggleSidebar}
          className="hidden rounded-md p-1.5 text-brand-500 transition-colors hover:bg-brand-100 hover:text-accent lg:inline-flex"
          aria-label={sidebarOpen ? 'Menüyü daralt' : 'Menüyü genişlet'}
        >
          <SidebarIcon size={20} aria-hidden />
        </button>

        {/* Sağ: kullanıcı + aksiyonlar */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {user && (
            <span className="hidden items-center gap-1.5 text-xs text-brand-500 md:inline-flex" title={user.email}>
              <span className="max-w-[14rem] truncate">{displayName(user)}</span>
              <span className="rounded border border-brand-200 bg-brand-50 px-1 text-[10px] font-semibold uppercase tracking-wide text-brand-500">
                {roleLabel(user.role)}
              </span>
            </span>
          )}
          <a
            href="https://bagdam.com"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'hidden items-center gap-2 rounded-md border border-brand-200 px-2.5 py-1.5 text-sm font-medium',
              'text-brand-700 transition-colors hover:border-accent hover:text-accent sm:inline-flex',
            )}
          >
            <Home className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            Siteye dön
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-brand-200 px-2.5 py-1.5 text-sm font-medium',
              'text-brand-700 transition-colors hover:border-accent-dark hover:text-accent-dark',
            )}
            title="Çıkış"
          >
            <LogOut className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </div>
    </header>
  );
}
