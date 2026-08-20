import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from '../layouts/AdminLayout';
import { AdminLoginPage } from '../pages/auth/AdminLoginPage';
import { AdminDashboardPage } from '../pages/dashboard/AdminDashboardPage';
import { AdminUrunlerListePage } from '../pages/urunler/AdminUrunlerListePage';
import { AdminUrunFormPage } from '../pages/urunler/AdminUrunFormPage';
import { AdminKategorilerPage } from '../pages/kategoriler/AdminKategorilerPage';
import { AdminUreticilerPage } from '../pages/ureticiler/AdminUreticilerPage';
import { AdminKutularPage } from '../pages/kutular/AdminKutularPage';
import { AdminHaftaninKutusuPage } from '../pages/haftanin-kutusu/AdminHaftaninKutusuPage';
import { AdminMedyaPage } from '../pages/medya/AdminMedyaPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { useAdminAuth } from '../contexts/AdminAuthContext';
import { ADMIN_ROOT, getAllNavLeaves } from '../lib/adminNavConfig';

/** Route kapısı: oturum yoksa /login'e (`?next=`); yüklenirken bekletir. */
export function RequireAdminAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAdminAuth();
  const location = useLocation();

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

/** Menüde yer tutucu kalan ekranlar (F5+); F4 ekranları aşağıda gerçek sayfaya bağlı. */
const placeholderLeaves = getAllNavLeaves().filter((leaf) => leaf.to !== ADMIN_ROOT && leaf.comingSoon);

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

        {/* F4 — Katalog */}
        <Route path="/katalog/urunler" element={<AdminUrunlerListePage />} />
        <Route path="/katalog/urunler/yeni" element={<AdminUrunFormPage />} />
        <Route path="/katalog/urunler/:id" element={<AdminUrunFormPage />} />
        <Route path="/katalog/kategoriler" element={<AdminKategorilerPage />} />
        <Route path="/katalog/ureticiler" element={<AdminUreticilerPage />} />
        <Route path="/katalog/kutular" element={<AdminKutularPage />} />
        <Route path="/katalog/haftanin-kutusu" element={<AdminHaftaninKutusuPage />} />
        <Route path="/medya" element={<AdminMedyaPage />} />

        {placeholderLeaves.map((leaf) => (
          <Route key={leaf.to} path={leaf.to} element={<PlaceholderPage />} />
        ))}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
