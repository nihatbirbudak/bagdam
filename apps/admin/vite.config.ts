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
