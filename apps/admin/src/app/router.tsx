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
import { AdminSiteIcerikleriPage } from '../pages/icerik/AdminSiteIcerikleriPage';
import { AdminGunlukPage } from '../pages/gunluk/AdminGunlukPage';
import { AdminGunlukFormPage } from '../pages/gunluk/AdminGunlukFormPage';
import { AdminYasalMetinlerPage } from '../pages/yasal/AdminYasalMetinlerPage';
import { AdminYasalFormPage } from '../pages/yasal/AdminYasalFormPage';
import { AdminToptanTalepleriPage } from '../pages/toptan/AdminToptanTalepleriPage';
import { AdminAyarlarGenelPage, AdminEpostaPage, AdminOdemePage, AdminSeoPage } from '../pages/ayarlar/AdminAyarlarPage';
import { AdminBolgelerPage } from '../pages/ayarlar/AdminBolgelerPage';
import { AdminMusterilerListePage } from '../pages/musteriler/AdminMusterilerListePage';
import { AdminMusteriDetayPage } from '../pages/musteriler/AdminMusteriDetayPage';
import { AdminMailGunluguPage } from '../pages/sistem/AdminMailGunluguPage';
import { AdminSiparislerListePage } from '../pages/siparisler/AdminSiparislerListePage';
import { AdminSiparisDetayPage } from '../pages/siparisler/AdminSiparisDetayPage';
import { AdminKuponlarPage } from '../pages/kuponlar/AdminKuponlarPage';
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

/** Menüde yer tutucu kalan ekranlar (F9+); F4/F5/F6/F8 ekranları aşağıda gerçek sayfaya bağlı. */
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

        {/* F5 — İçerik */}
        <Route path="/icerik/site" element={<AdminSiteIcerikleriPage mode="site" />} />
        <Route path="/icerik/promo-footer" element={<AdminSiteIcerikleriPage mode="promo-footer" />} />
        <Route path="/icerik/gunluk" element={<AdminGunlukPage />} />
        <Route path="/icerik/gunluk/yeni" element={<AdminGunlukFormPage />} />
        <Route path="/icerik/gunluk/:id" element={<AdminGunlukFormPage />} />
        <Route path="/icerik/yasal-metinler" element={<AdminYasalMetinlerPage />} />
        <Route path="/icerik/yasal-metinler/yeni" element={<AdminYasalFormPage />} />
        <Route path="/icerik/yasal-metinler/:id" element={<AdminYasalFormPage />} />
        <Route path="/toptan-talepleri" element={<AdminToptanTalepleriPage />} />

        {/* F5 — Ayarlar */}
        <Route path="/ayarlar" element={<AdminAyarlarGenelPage />} />
        <Route path="/ayarlar/bolgeler" element={<AdminBolgelerPage />} />
        <Route path="/ayarlar/e-posta" element={<AdminEpostaPage />} />
        <Route path="/ayarlar/odeme" element={<AdminOdemePage />} />
        <Route path="/ayarlar/seo" element={<AdminSeoPage />} />

        {/* F6 — Satış › Müşteriler (ekran 16), Sistem › E-posta günlüğü */}
        <Route path="/musteriler" element={<AdminMusterilerListePage />} />
        <Route path="/musteriler/:id" element={<AdminMusteriDetayPage />} />
        <Route path="/sistem/e-posta-gunlugu" element={<AdminMailGunluguPage />} />

        {/* F8 — Satış › Siparişler (ekran 17), Kuponlar (ekran 23) */}
        <Route path="/siparisler" element={<AdminSiparislerListePage />} />
        <Route path="/siparisler/:id" element={<AdminSiparisDetayPage />} />
        <Route path="/kuponlar" element={<AdminKuponlarPage />} />

        {placeholderLeaves.map((leaf) => (
          <Route key={leaf.to} path={leaf.to} element={<PlaceholderPage />} />
        ))}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
