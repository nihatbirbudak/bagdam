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
 * - Üretimde SPA `admin.bagdam.com` altında statik servis edilir; `/api/` nginx'ten geçer.
 */
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
  server: {
    port: 4011,
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4010',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4011,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
}));
