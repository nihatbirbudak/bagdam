// =============================================================================
// Bağdam — PM2 yapılandırması (sunucuda /opt/bagdam/ecosystem.config.js; repo'dan gelir)
//
//   bagdam-api          /opt/bagdam/apps/api          :5010  main     ENABLE_CRON=true   SITE_MODE=coming-soon
//   bagdam-api-staging  /opt/bagdam-staging/apps/api  :5011  staging  ENABLE_CRON=false  SITE_MODE=full
//
//   ADR-0001: cluster × 1 instance (zero-downtime reload; cron tek süreçte), 768M, TZ Europe/Istanbul,
//   HOST 127.0.0.1 (yalnız nginx erişir). ADR-0012: apex lansmana kadar coming-soon (SITE_MODE).
//
//   Node 22 (proje bazlı ikili, ADR-0001): F1 sunucu adımında /usr/local/n/versions/node/22/bin/node
//   olarak kurulur (bkz. deploy/README.md). Yoksa 'node' (global Node 20) kullanılır. Farklı bir yol
//   için PM2'yi başlatırken BAGDAM_NODE=/yol/node pm2 start ecosystem.config.js --only bagdam-api.
//   DİKKAT: PM2 cluster modunda 'interpreter' daemon'un Node'u ile değiştirilemeyebilir (worker'lar
//   cluster.fork ile açılır). pm2 show bagdam-api → "node.js version" satırından doğrulayın; 22
//   görünmüyorsa BAGDAM_EXEC_MODE=fork ile başlatın (reload = restart; nginx bakım sayfası kapatır).
//
//   Deploy: pm2 reload ecosystem.config.js --only <ad> --update-env  →  pm2 save   (deploy.sh)
// =============================================================================
'use strict';

const fs = require('fs');

const NODE22 = '/usr/local/n/versions/node/22/bin/node';
const interpreter = process.env.BAGDAM_NODE || (fs.existsSync(NODE22) ? NODE22 : 'node');
const execMode = process.env.BAGDAM_EXEC_MODE === 'fork' ? 'fork' : 'cluster';

/**
 * Ortak uygulama tanımı (prod ve staging aynı şablon, yalnız dizin/port/cron/mod değişir).
 * env_file (.env) sunucuda elle oluşturulur (600); PORT/HOST/TZ değerleri buradakiyle aynı tutulur.
 */
function bagdamApi({ name, dir, port, enableCron, siteMode }) {
  return {
    name,
    cwd: `${dir}/apps/api`,
    script: 'dist/main.js',
    exec_mode: execMode,
    instances: 1,
    interpreter,

    // Ortam değişkenleri (sırlar .env'de; burada yalnız sır olmayanlar)
    env: {
      NODE_ENV: 'production',
      PORT: port,
      HOST: '127.0.0.1',
      TZ: 'Europe/Istanbul',
      ENABLE_CRON: enableCron,
      SITE_MODE: siteMode,
    },
    env_file: `${dir}/apps/api/.env`,

    // Bellek ve stabilite
    max_memory_restart: '768M',
    min_uptime: '30s',        // 30 s içinde ölürse → unstable restart sayılır
    max_restarts: 20,         // ardışık unstable restart limiti
    restart_delay: 2000,      // restart'lar arası 2 s

    // Graceful shutdown / startup
    kill_timeout: 8000,       // SIGTERM → 8 s bekle, sonra SIGKILL (Nest enableShutdownHooks)
    listen_timeout: 15000,    // listen() için 15 s'e kadar bekle (reload'da eski worker bu süre ayakta)

    // Log dosyaları (pm2-logrotate modülü günlük döndürür: 50M / 30 adet / gzip)
    error_file: `${dir}/logs/api-error.log`,
    out_file: `${dir}/logs/api-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  };
}

module.exports = {
  apps: [
    bagdamApi({
      name: 'bagdam-api',
      dir: '/opt/bagdam',
      port: 5010,
      enableCron: 'true',
      siteMode: 'coming-soon',
    }),
    bagdamApi({
      name: 'bagdam-api-staging',
      dir: '/opt/bagdam-staging',
      port: 5011,
      enableCron: 'false',
      siteMode: 'full',
    }),
  ],
};
