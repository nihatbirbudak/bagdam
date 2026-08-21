import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from '../layouts/AdminLayout';
import { AdminLoginPage } from '../pages/auth/AdminLoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { useAdminAuth } from '../contexts/AdminAuthContext';
import { ADMIN_ROOT, getAllNavLeaves } from '../lib/adminNavConfig';

/**
 * F10 (C) — rota bazlı kod bölme.
 *
 * Neden: tek paket 735 kB'a çıkmıştı (Vite 500 kB uyarısı). Panel ekranlarının çoğu (medya,
 * ops, abonelik detayı, sipariş detayı…) ilk açılışta gerekmiyor; her ekran kendi chunk'ına
 * alınınca giriş ekranı + kabuk yalnız ortak paketleri indirir.
 *
 * Nasıl: sayfa modülleri **adlandırılmış** export veriyor (`export function AdminXPage`),
 * `React.lazy` ise `default` bekliyor → her satırda `.then((m) => ({ default: m.X }))`.
 * Kabuk (AdminLayout, login, 404, yer tutucu) eager kalır: her yolda gerekli, ayrı chunk'a
 * alınması yalnız fazladan istek üretir.
 *
 * Not: sayfa birim testleri (vitest) modülleri doğrudan import ettiği için bu değişiklikten
 * etkilenmez; `lazy` yalnız router'da devrededir.
 */

// F4 — Katalog + medya
const AdminDashboardPage = lazy(() =>
  import('../pages/dashboard/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
);
const AdminUrunlerListePage = lazy(() =>
  import('../pages/urunler/AdminUrunlerListePage').then((m) => ({ default: m.AdminUrunlerListePage })),
);
const AdminUrunFormPage = lazy(() =>
  import('../pages/urunler/AdminUrunFormPage').then((m) => ({ default: m.AdminUrunFormPage })),
);
const AdminKategorilerPage = lazy(() =>
  import('../pages/kategoriler/AdminKategorilerPage').then((m) => ({ default: m.AdminKategorilerPage })),
);
const AdminUreticilerPage = lazy(() =>
  import('../pages/ureticiler/AdminUreticilerPage').then((m) => ({ default: m.AdminUreticilerPage })),
);
const AdminKutularPage = lazy(() =>
  import('../pages/kutular/AdminKutularPage').then((m) => ({ default: m.AdminKutularPage })),
);
const AdminHaftaninKutusuPage = lazy(() =>
  import('../pages/haftanin-kutusu/AdminHaftaninKutusuPage').then((m) => ({ default: m.AdminHaftaninKutusuPage })),
);
const AdminMedyaPage = lazy(() => import('../pages/medya/AdminMedyaPage').then((m) => ({ default: m.AdminMedyaPage })));

// F5 — İçerik + ayarlar
const AdminSiteIcerikleriPage = lazy(() =>
  import('../pages/icerik/AdminSiteIcerikleriPage').then((m) => ({ default: m.AdminSiteIcerikleriPage })),
);
const AdminGunlukPage = lazy(() =>
  import('../pages/gunluk/AdminGunlukPage').then((m) => ({ default: m.AdminGunlukPage })),
);
const AdminGunlukFormPage = lazy(() =>
  import('../pages/gunluk/AdminGunlukFormPage').then((m) => ({ default: m.AdminGunlukFormPage })),
);
const AdminYasalMetinlerPage = lazy(() =>
  import('../pages/yasal/AdminYasalMetinlerPage').then((m) => ({ default: m.AdminYasalMetinlerPage })),
);
const AdminYasalFormPage = lazy(() =>
  import('../pages/yasal/AdminYasalFormPage').then((m) => ({ default: m.AdminYasalFormPage })),
);
const AdminToptanTalepleriPage = lazy(() =>
  import('../pages/toptan/AdminToptanTalepleriPage').then((m) => ({ default: m.AdminToptanTalepleriPage })),
);
const AdminAyarlarGenelPage = lazy(() =>
  import('../pages/ayarlar/AdminAyarlarPage').then((m) => ({ default: m.AdminAyarlarGenelPage })),
);
const AdminEpostaPage = lazy(() =>
  import('../pages/ayarlar/AdminAyarlarPage').then((m) => ({ default: m.AdminEpostaPage })),
);
const AdminOdemePage = lazy(() =>
  import('../pages/ayarlar/AdminAyarlarPage').then((m) => ({ default: m.AdminOdemePage })),
);
const AdminSeoPage = lazy(() => import('../pages/ayarlar/AdminAyarlarPage').then((m) => ({ default: m.AdminSeoPage })));
const AdminBolgelerPage = lazy(() =>
  import('../pages/ayarlar/AdminBolgelerPage').then((m) => ({ default: m.AdminBolgelerPage })),
);

// F6 — Müşteriler + e-posta günlüğü
const AdminMusterilerListePage = lazy(() =>
  import('../pages/musteriler/AdminMusterilerListePage').then((m) => ({ default: m.AdminMusterilerListePage })),
);
const AdminMusteriDetayPage = lazy(() =>
  import('../pages/musteriler/AdminMusteriDetayPage').then((m) => ({ default: m.AdminMusteriDetayPage })),
);
const AdminMailGunluguPage = lazy(() =>
  import('../pages/sistem/AdminMailGunluguPage').then((m) => ({ default: m.AdminMailGunluguPage })),
);

// F8 — Siparişler + kuponlar
const AdminSiparislerListePage = lazy(() =>
  import('../pages/siparisler/AdminSiparislerListePage').then((m) => ({ default: m.AdminSiparislerListePage })),
);
const AdminSiparisDetayPage = lazy(() =>
  import('../pages/siparisler/AdminSiparisDetayPage').then((m) => ({ default: m.AdminSiparisDetayPage })),
);
const AdminKuponlarPage = lazy(() =>
  import('../pages/kuponlar/AdminKuponlarPage').then((m) => ({ default: m.AdminKuponlarPage })),
);

// F9 — Teslimat tarihleri, ödeme problemleri, abonelikler, teslimat günü
const AdminTeslimatTarihleriPage = lazy(() =>
  import('../pages/ayarlar/AdminTeslimatTarihleriPage').then((m) => ({ default: m.AdminTeslimatTarihleriPage })),
);
const AdminOdemeProblemleriPage = lazy(() =>
  import('../pages/odeme-problemleri/AdminOdemeProblemleriPage').then((m) => ({ default: m.AdminOdemeProblemleriPage })),
);
const AdminAboneliklerListePage = lazy(() =>
  import('../pages/abonelikler/AdminAboneliklerListePage').then((m) => ({ default: m.AdminAboneliklerListePage })),
);
const AdminAbonelikDetayPage = lazy(() =>
  import('../pages/abonelikler/AdminAbonelikDetayPage').then((m) => ({ default: m.AdminAbonelikDetayPage })),
);
const AdminTeslimatGunuPage = lazy(() =>
  import('../pages/teslimat-gunu/AdminTeslimatGunuPage').then((m) => ({ default: m.AdminTeslimatGunuPage })),
);

// F10 — ekran 22 Sistem (sağlık kartı + günlük sekmeleri)
const AdminSistemPage = lazy(() =>
  import('../pages/sistem/AdminSistemPage').then((m) => ({ default: m.AdminSistemPage })),
);

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

/** Lazy chunk inerken gösterilen ara durum — RequireAdminAuth'un bekleme görünümüyle aynı dil. */
function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <span className="text-sm text-brand-500">Yükleniyor…</span>
    </div>
  );
}

/** Menüde yer tutucu kalan ekranlar; F4/F5/F6/F8/F9 ekranları aşağıda gerçek sayfaya bağlı. */
const placeholderLeaves = getAllNavLeaves().filter((leaf) => leaf.to !== ADMIN_ROOT && leaf.comingSoon);

export function AdminRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
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

          {/* F9 — ekran 14b Teslimat tarihleri, 18 Ödeme problemleri, 19 Abonelikler, 20 Teslimat Günü (21 Özet = index) */}
          <Route path="/ayarlar/teslimat-tarihleri" element={<AdminTeslimatTarihleriPage />} />
          <Route path="/odeme-problemleri" element={<AdminOdemeProblemleriPage />} />
          <Route path="/abonelikler" element={<AdminAboneliklerListePage />} />
          <Route path="/abonelikler/:id" element={<AdminAbonelikDetayPage />} />
          <Route path="/operasyon/teslimat-gunu" element={<AdminTeslimatGunuPage />} />

          {/* F10 — ekran 22 Sistem: sağlık kartı + denetim/sistem/cron/e-posta/webhook günlükleri */}
          <Route path="/sistem" element={<AdminSistemPage />} />

          {placeholderLeaves.map((leaf) => (
            <Route key={leaf.to} path={leaf.to} element={<PlaceholderPage />} />
          ))}

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
