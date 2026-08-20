import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from '../layouts/AdminLayout';
import { AdminLoginPage } from '../pages/auth/AdminLoginPage';
import { AdminDashboardPage } from '../pages/dashboard/AdminDashboardPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { useAdminAuth } from '../contexts/AdminAuthContext';
import { ADMIN_ROOT, getAllNavLeaves } from '../lib/adminNavConfig';

/**
 * Route kapısı. F1: `VITE_AUTH_DISABLED=true` (yalnız dev) iken geçirir;
 * aksi halde oturum yoksa /login'e yönlendirir. F4'te AuthModule ile gerçek kapı.
 */
export function RequireAdminAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, authDisabled } = useAdminAuth();
  const location = useLocation();

  if (authDisabled) return <>{children}</>;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-brand-500">Yükleniyor…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    const next = location.pathname + location.search;
    const to = next && next !== ADMIN_ROOT ? `/login?next=${encodeURIComponent(next)}` : '/login';
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}

/** Menüdeki her ekran F1'de yer tutucu sayfaya bağlanır; gerçek sayfalar fazlarında buraya eklenir. */
const placeholderLeaves = getAllNavLeaves().filter((leaf) => leaf.to !== ADMIN_ROOT);

export function AdminRouter() {
  return (
    <Routes>
      <Route path="/login" element={<AdminLoginPage />} />

      {/* Korumalı rotalar */}
      <Route
        element={
          <RequireAdminAuth>
            <AdminLayout />
          </RequireAdminAuth>
        }
      >
        <Route index element={<AdminDashboardPage />} />

        {placeholderLeaves.map((leaf) => (
          <Route key={leaf.to} path={leaf.to} element={<PlaceholderPage />} />
        ))}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
