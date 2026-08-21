import { describe, expect, it } from 'vitest';
import type { AdminHealthDetailed, CronLogItem, JobInfo } from '../../lib/apiTypes';
import {
  SYSTEM_TABS,
  cronStatusLabel,
  cronStatusTone,
  formatDuration,
  formatUptime,
  healthTone,
  mergeJobRows,
  normalizeTab,
  prettyJson,
  summarizeLevels,
  summarizeMail,
  systemLevelLabel,
  systemLevelTone,
  webhookStatusLabel,
  webhookStatusTone,
} from './system';

function health(patch: Partial<AdminHealthDetailed>): AdminHealthDetailed {
  return {
    status: 'ok',
    checkedAt: '2026-08-21T09:00:00.000Z',
    version: '0.1.0',
    env: 'development',
    siteMode: 'full',
    nodeVersion: 'v22.0.0',
    uptimeSeconds: 60,
    timezone: { env: 'Europe/Istanbul', resolved: 'Europe/Istanbul' },
    memory: { rssMb: 100, heapUsedMb: 50 },
    db: { status: 'up', latencyMs: 3 },
    scheduler: { enabled: true, instance: null, jobs: [], failedRuns24h: 0 },
    systemLogs24h: {},
    mail24h: {},
    mailDisabled: true,
    webhooks24h: { total: 0, invalidSignature: 0, failed: 0 },
    paymentIssues: { unpaidCycles: 0, failedOrders: 0 },
    jobRunAllowed: true,
    warnings: [],
    ...patch,
  };
}

function cronRow(patch: Partial<CronLogItem>): CronLogItem {
  return {
    id: 'c1',
    name: 'cycles:ensure',
    status: 'SUCCESS',
    itemsProcessed: 3,
    errors: 0,
    details: null,
    startedAt: '2026-08-21T08:00:00.000Z',
    finishedAt: '2026-08-21T08:00:01.000Z',
    durationMs: 1000,
    ...patch,
  };
}

describe('ekran 22 — sekmeler', () => {
  it('normalizeTab bilinmeyen değeri "saglik"a düşürür', () => {
    expect(normalizeTab('cron')).toBe('cron');
    expect(normalizeTab('webhook')).toBe('webhook');
    expect(normalizeTab('yok')).toBe('saglik');
    expect(normalizeTab(null)).toBe('saglik');
    expect(normalizeTab(undefined)).toBe('saglik');
  });

  it('altı sekme benzersiz anahtarlarla tanımlı', () => {
    const keys = SYSTEM_TABS.map((t) => t.key);
    expect(keys).toEqual(['saglik', 'denetim', 'sistem', 'cron', 'eposta', 'webhook']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('ekran 22 — etiket ve tonlar', () => {
  it('seviye etiketleri Türkçe; bilinmeyen ham döner', () => {
    expect(systemLevelLabel('error')).toBe('Hata');
    expect(systemLevelLabel('warn')).toBe('Uyarı');
    expect(systemLevelLabel('trace')).toBe('trace');
    expect(systemLevelLabel(null)).toBe('—');
  });

  it('cron/webhook durum etiketleri', () => {
    expect(cronStatusLabel('SUCCESS')).toBe('Başarılı');
    expect(cronStatusLabel('RUNNING')).toBe('Çalışıyor');
    expect(webhookStatusLabel('IGNORED')).toBe('Yok sayıldı (çift teslim)');
    expect(webhookStatusLabel(undefined)).toBe('—');
  });

  it('tonlar: hata kırmızı, uyarı sarı, başarı yeşil', () => {
    expect(systemLevelTone('fatal')).toBe('bad');
    expect(systemLevelTone('error')).toBe('bad');
    expect(systemLevelTone('warn')).toBe('warn');
    expect(systemLevelTone('info')).toBe('neutral');
    expect(cronStatusTone('SUCCESS')).toBe('good');
    expect(cronStatusTone('FAILED')).toBe('bad');
    expect(cronStatusTone('RUNNING')).toBe('warn');
    expect(webhookStatusTone('PROCESSED')).toBe('good');
    expect(webhookStatusTone('FAILED')).toBe('bad');
    expect(webhookStatusTone('IGNORED')).toBe('warn');
    expect(webhookStatusTone('RECEIVED')).toBe('neutral');
  });

  it('healthTone: db down → bad, uyarı varsa warn, temizse good', () => {
    expect(healthTone(null)).toBe('neutral');
    expect(healthTone(health({}))).toBe('good');
    expect(healthTone(health({ warnings: ['bir şey'] }))).toBe('warn');
    expect(healthTone(health({ status: 'degraded', db: { status: 'down', latencyMs: null } }))).toBe('bad');
  });
});

describe('ekran 22 — biçimlendirme', () => {
  it('formatDuration ms/s ayrımı', () => {
    expect(formatDuration(340)).toBe('340 ms');
    expect(formatDuration(1200)).toBe('1,2 s');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('formatUptime gün/saat/dakika', () => {
    expect(formatUptime(90)).toBe('1 dk');
    expect(formatUptime(3 * 3600 + 12 * 60)).toBe('3 sa 12 dk');
    expect(formatUptime(2 * 86400 + 5 * 3600)).toBe('2 g 5 sa');
    expect(formatUptime(null)).toBe('—');
  });

  it('summarizeLevels ciddiyet sırasına göre özetler', () => {
    expect(summarizeLevels({ warn: 5, error: 2, info: 0 })).toBe('hata 2 · uyarı 5');
    expect(summarizeLevels({})).toBe('kayıt yok');
    expect(summarizeLevels(null)).toBe('kayıt yok');
  });

  it('summarizeMail Türkçe durum sözcükleri', () => {
    expect(summarizeMail({ SENT: 4, SKIPPED: 2, FAILED: 0 })).toBe('gönderildi 4 · atlandı 2');
    expect(summarizeMail({})).toBe('kayıt yok');
  });

  it('prettyJson boş/nesne ayrımı', () => {
    expect(prettyJson(null)).toBeNull();
    expect(prettyJson({})).toBeNull();
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('ekran 22 — mergeJobRows', () => {
  const jobs: JobInfo[] = [
    {
      name: 'cycles:ensure',
      cron: '0 * * * *',
      description: 'Kutu dönemlerini üretir',
      lastRun: {
        name: 'cycles:ensure',
        status: 'SUCCESS',
        itemsProcessed: 1,
        errors: 0,
        details: null,
        startedAt: '2026-08-21T07:00:00.000Z',
        finishedAt: '2026-08-21T07:00:01.000Z',
        durationMs: 900,
        cronLogId: 'x',
      },
    },
  ];

  it('kayıt defteri + son koşuları birleştirir, daha yeni koşu kazanır', () => {
    const rows = mergeJobRows(jobs, [cronRow({ startedAt: '2026-08-21T08:00:00.000Z' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cron).toBe('0 * * * *');
    expect(rows[0].lastRun?.startedAt).toBe('2026-08-21T08:00:00.000Z');
  });

  it('eski koşu kayıt defterindeki daha yeni koşuyu ezmez', () => {
    const rows = mergeJobRows(jobs, [cronRow({ startedAt: '2026-08-20T00:00:00.000Z' })]);
    expect(rows[0].lastRun?.startedAt).toBe('2026-08-21T07:00:00.000Z');
  });

  it('kayıt defterinde olmayan (kaldırılmış) job da listelenir; ada göre sıralı', () => {
    const rows = mergeJobRows(jobs, [cronRow({ id: 'c2', name: 'aaa:eski' })]);
    expect(rows.map((r) => r.name)).toEqual(['aaa:eski', 'cycles:ensure']);
    expect(rows[0].cron).toBeNull();
  });

  it('kayıt defteri erişilemezse (STAFF 403) yalnız sağlık kartı satırları kalır', () => {
    const rows = mergeJobRows(null, [cronRow({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastRun?.status).toBe('SUCCESS');
    expect(mergeJobRows(null, null)).toEqual([]);
  });
});
