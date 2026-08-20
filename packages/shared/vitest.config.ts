import { defineConfig } from 'vitest/config';

// packages/shared testleri saf TypeScript'tir (DOM yok) → node ortamı.
// Zaman/TZ'ye bağlı kurallar (pricing kesim hesabı, F2) iki TZ altında koşulur:
//   TZ=UTC pnpm --filter @bagdam/shared test  &&  TZ=Europe/Istanbul pnpm --filter @bagdam/shared test
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
    reporters: 'default',
  },
});
