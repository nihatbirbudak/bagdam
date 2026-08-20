import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AdminTopBar } from '../components/AdminTopBar';
import { AdminSidebar } from '../components/AdminSidebar';
import { AdminBottomNav } from '../components/AdminBottomNav';
import { AdminMobileDrawer } from '../components/AdminMobileDrawer';

const LS_KEY = 'bagdam-admin-sidebar-pinned';

/** Üst çubuk + (masaüstü) yan menü + (mobil) alt çubuk/çekmece; içerik `<Outlet />`. */
export function AdminLayout() {
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [hovered, setHovered] = useState(false);
  const sidebarOpen = pinned || hovered;

  // Mobil çekmece durumu
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);

  function togglePin() {
    setPinned((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEY, next ? '1' : '0');
      } catch {
        /* noop */
      }
      return next;
    });
  }

  function handleToggleSidebar() {
    // Masaüstünde sabitleme düğmesi gibi davranır
    togglePin();
  }

  const handleHoverEnter = useCallback(() => setHovered(true), []);
  const handleHoverLeave = useCallback(() => setHovered(false), []);

  // Çekmece açıkken body kaydırmasını kilitle (mobil)
  useEffect(() => {
    if (activeDrawer) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [activeDrawer]);

  return (
    <div className="min-h-screen bg-brand-100 font-admin antialiased">
      <AdminTopBar sidebarOpen={sidebarOpen} onToggleSidebar={handleToggleSidebar} />

      <div className="flex">
        <AdminSidebar
          open={sidebarOpen}
          pinned={pinned}
          onTogglePin={togglePin}
          onHoverEnter={handleHoverEnter}
          onHoverLeave={handleHoverLeave}
        />
        <main className="min-w-0 flex-1 pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobil alt çubuk + çekmece */}
      <AdminBottomNav onOpenDrawer={setActiveDrawer} activeDrawer={activeDrawer} />
      <AdminMobileDrawer activeDrawer={activeDrawer} onClose={() => setActiveDrawer(null)} />
    </div>
  );
}
