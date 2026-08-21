/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Bağdam admin — Vite yapılandırması (UA iskeletinden uyarlandı).
 *
 * - Dev sunucusu :4011; `/api` istekleri aynı origin üzerinden API'ye (:4010) proxy'lenir.
 *   Böylece httpOnly cookie + CSRF akışı dev'de de same-origin çalışır (ADR-0009).
 * - `/assets` ve `/uploads` da API'ye proxy'lenir: medya URL'leri göreli (`/assets/images/...`, `/uploads/...`)
 *   olduğundan küçük resimler dev/preview'da da görünür (prod'da admin.bagdam.com nginx'inde aynı iki location gerekir).
 * - Proxy hedefi `ADMIN_API_PROXY` env'i ile değiştirilebilir (e2e: geçici API 4033) — varsayılan :4010.
 * - Üretimde SPA `admin.bagdam.com` altında statik servis edilir; `/api/` nginx'ten geçer.
 */
const API_PROXY_TARGET = process.env.ADMIN_API_PROXY?.trim() || 'http://127.0.0.1:4010';
const apiProxy = {
  '/api': { target: API_PROXY_TARGET, changeOrigin: false },
  '/assets': { target: API_PROXY_TARGET, changeOrigin: false },
  '/uploads': { target: API_PROXY_TARGET, changeOrigin: false },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    // Yalnız console.log/info/debug düşürülür; console.error/warn üretimde kalır (kör operasyon olmasın).
    pure: mode === 'production' ? ['console.log', 'console.info', 'console.debug', 'console.trace'] : [],
    drop: mode === 'production' ? ['debugger'] : [],
  },
  build: {
    // Panel paketleri `dist/app/` altına yazılır: `/assets/*` API'nin medya yolu (proxy/nginx) için boş kalır.
    assetsDir: 'app',
    rollupOptions: {
      output: {
        /**
         * F10 (C) — satıcı paketleri ayrı chunk'ta.
         *
         * Rota bazlı bölme (`app/router.tsx` React.lazy) uygulama kodunu ekran başına ayırdı;
         * geriye kalan giriş chunk'ının büyük kısmı React + React Router. Bunlar sürüm
         * yükseltmesi dışında değişmediğinden ayrı dosyaya alınır: panel kodu her deploy'da
         * yeni hash alsa da tarayıcı `vendor-react` dosyasını önbellekten kullanır
         * (nginx `location /app/` 1 yıl immutable — deploy/nginx/admin.bagdam.com.conf).
         *
         * lucide-react ikonları Vite'ın kendi tree-shaking'i ile zaten ikon başına küçük
         * chunk'lara ayrılıyor; elle gruplanmaz (gruplansa hepsi tek dosyada inerdi).
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return 'vendor-router';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 4011,
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: apiProxy,
  },
  preview: {
    port: 4011,
    proxy: apiProxy,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
}));
