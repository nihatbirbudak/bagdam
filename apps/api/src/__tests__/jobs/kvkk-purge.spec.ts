// F10 — `kvkk:purge` (ADR-0015 KVKK saklama matrisi; docs/kvkk-veri-saklama.md).
// Gerçek Nest + gerçek DB. GÜVENLİK NOTU: test "geçmiş dönem" kullanır (now = 2026-01-15) ve tüm sınırlar 2025'e
// düşer — bagdam_dev'deki gerçek satırlar (2026-08+) her zaman sınırlardan YENİ olduğu için silinmez.
//
// Kapsam: MailLog + önizleme dosyası silme · SystemLog · CronLog · AuditLog PII maskeleme (satır KALIR) ·
// yaş sınırından yeni satırların korunması · kapalı adım (süre 0) · pasif müşteri anonimleştirme.
import '../helpers/env';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { MAIL_PREVIEW_DIR, MAIL_PREVIEW_ERROR_PREFIX } from '../../modules/mail/mail.constants';
import { KVKK_PURGED } from '../../modules/jobs/jobs.constants';
import type { KvkkPurgeResult } from '../../modules/jobs/kvkk-purge.service';
import { createSubsApp, type SubsApp } from '../subscriptions/harness';

jest.setTimeout(300_000);

/** Testin "şimdi"si — gerçek verinin (2026-08+) tamamı bu andan ve tüm sınırlardan YENİ. */
const NOW = new Date('2026-01-15T10:00:00.000Z');
/** Silinmesi/maskelenmesi beklenen eski satırların anı. */
const OLD = new Date('2025-01-01T09:00:00.000Z');
/** Korunması beklenen (sınırdan yeni) satırların anı. */
const FRESH = new Date('2026-01-14T09:00:00.000Z');

const TAG = `kvkk-test-${Date.now().toString(36)}`;

describe('F10 — kvkk:purge (KVKK saklama matrisi)', () => {
  let t: SubsApp;
  const createdUserIds: string[] = [];
  const previewFiles: string[] = [];

  async function setPrivacy(values: Record<string, number>): Promise<void> {
    await t.settings.set('privacy', values);
  }

  /** Eski/yeni MailLog satırı + (istenirse) gerçek önizleme dosyası. */
  async function makeMailLog(entityId: string, createdAt: Date, withPreview: boolean): Promise<{ id: string; preview: string | null }> {
    const row = await t.prisma.mailLog.create({
      data: { to: `${TAG}@bagdam.test`, subject: 'kvkk testi', templateSlug: 'test', entityId, status: 'SKIPPED', createdAt },
      select: { id: true },
    });
    if (!withPreview) return { id: row.id, preview: null };
    await mkdir(MAIL_PREVIEW_DIR, { recursive: true });
    const file = resolve(MAIL_PREVIEW_DIR, `${row.id}.html`);
    await writeFile(file, '<!-- kvkk purge testi -->', 'utf8');
    await t.prisma.mailLog.update({ where: { id: row.id }, data: { error: `${MAIL_PREVIEW_ERROR_PREFIX}${file}` } });
    previewFiles.push(file);
    return { id: row.id, preview: file };
  }

  beforeAll(async () => {
    t = await createSubsApp();
  });

  afterAll(async () => {
    if (!t) return;
    try {
      await t.prisma.mailLog.deleteMany({ where: { to: `${TAG}@bagdam.test` } });
      await t.prisma.systemLog.deleteMany({ where: { module: TAG } });
      await t.prisma.auditLog.deleteMany({ where: { module: TAG } });
      await t.prisma.cronLog.deleteMany({ where: { startedAt: { gte: new Date('2024-01-01T00:00:00Z'), lt: new Date('2026-02-01T00:00:00Z') } } });
      if (createdUserIds.length > 0) {
        await t.prisma.consent.deleteMany({ where: { userId: { in: createdUserIds } } });
        await t.prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
        await t.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await t.prisma.setting.deleteMany({ where: { group: 'privacy' } });
      t.settings.invalidate('privacy');
      await t.cleanup();
    } finally {
      await t.close();
    }
  });

  it('günlükleri yaşa göre siler, sınırdan yeni satırlara dokunmaz; MailLog önizleme dosyası da silinir', async () => {
    await setPrivacy({ retentionMonths: 120, mailLogDays: 30, systemLogDays: 30, cronLogDays: 90, auditPiiMonths: 6, anonymizeInactiveMonths: 0 });

    const oldMail = await makeMailLog(`${TAG}-old`, OLD, true);
    const freshMail = await makeMailLog(`${TAG}-fresh`, FRESH, true);
    expect(existsSync(oldMail.preview!)).toBe(true);

    const oldSystem = await t.prisma.systemLog.create({ data: { level: 'ERROR', module: TAG, message: 'eski', createdAt: OLD }, select: { id: true } });
    const freshSystem = await t.prisma.systemLog.create({ data: { level: 'ERROR', module: TAG, message: 'yeni', createdAt: FRESH }, select: { id: true } });
    const oldCron = await t.prisma.cronLog.create({ data: { name: `${TAG}:eski`, status: 'SUCCESS', startedAt: OLD, finishedAt: OLD }, select: { id: true } });
    const freshCron = await t.prisma.cronLog.create({ data: { name: `${TAG}:yeni`, status: 'SUCCESS', startedAt: FRESH, finishedAt: FRESH }, select: { id: true } });

    const run = await t.jobs.runOnce('kvkk:purge', NOW);
    expect(run.status).toBe('SUCCESS');
    const details = run.details as unknown as KvkkPurgeResult;
    expect(details.mailLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(details.mailPreviewsDeleted).toBeGreaterThanOrEqual(1);
    expect(details.systemLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(details.cronLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(details.disabled).toContain('anonymizeInactiveMonths');
    expect(details.settings.mailLogDays).toBe(30);

    expect(await t.prisma.mailLog.findUnique({ where: { id: oldMail.id } })).toBeNull();
    expect(existsSync(oldMail.preview!)).toBe(false);
    expect(await t.prisma.mailLog.findUnique({ where: { id: freshMail.id } })).not.toBeNull();
    expect(existsSync(freshMail.preview!)).toBe(true);
    expect(await t.prisma.systemLog.findUnique({ where: { id: oldSystem.id } })).toBeNull();
    expect(await t.prisma.systemLog.findUnique({ where: { id: freshSystem.id } })).not.toBeNull();
    expect(await t.prisma.cronLog.findUnique({ where: { id: oldCron.id } })).toBeNull();
    expect(await t.prisma.cronLog.findUnique({ where: { id: freshCron.id } })).not.toBeNull();
  });

  it('AuditLog: eski satırda PII `[silindi]` olur, satır SİLİNMEZ; yeni satır dokunulmaz', async () => {
    await setPrivacy({ mailLogDays: 30, systemLogDays: 30, cronLogDays: 90, auditPiiMonths: 6, anonymizeInactiveMonths: 0 });
    // Önceki koşunun penceresini sıfırla (details.auditMaskedThrough) — bu test tam tarama ister
    await t.prisma.cronLog.deleteMany({ where: { name: 'kvkk:purge' } });

    const oldAudit = await t.prisma.auditLog.create({
      data: {
        actorEmail: 'yonetici@bagdam.test',
        action: 'UPDATE',
        module: TAG,
        entityId: 'x1',
        summary: 'musteri@ornek.com güncellendi (0532 111 22 33)',
        oldValues: { name: 'Eski Ad', email: 'musteri@ornek.com', nested: { phone: '+905321112233', note: 'kalsın' } },
        newValues: { name: 'Yeni Ad' },
        ipAddress: '203.0.113.9',
        createdAt: OLD,
      },
      select: { id: true },
    });
    const freshAudit = await t.prisma.auditLog.create({
      data: { actorEmail: 'yonetici@bagdam.test', action: 'UPDATE', module: TAG, entityId: 'x2', summary: 'yeni satır', ipAddress: '203.0.113.9', createdAt: FRESH },
      select: { id: true },
    });

    const run = await t.jobs.runOnce('kvkk:purge', NOW);
    const details = run.details as unknown as KvkkPurgeResult;
    expect(details.auditMasked).toBeGreaterThanOrEqual(1);
    expect(details.auditMaskedThrough).not.toBeNull();

    const masked = await t.prisma.auditLog.findUnique({ where: { id: oldAudit.id } });
    expect(masked).not.toBeNull(); // satır KALIR
    expect(masked!.actorEmail).toBe(KVKK_PURGED);
    expect(masked!.ipAddress).toBe(KVKK_PURGED);
    expect(masked!.summary).not.toContain('musteri@ornek.com');
    expect(masked!.summary).toContain(KVKK_PURGED);
    const oldValues = masked!.oldValues as Record<string, unknown>;
    expect(oldValues.email).toBe(KVKK_PURGED);
    expect((oldValues.nested as Record<string, unknown>).phone).toBe(KVKK_PURGED);
    expect((oldValues.nested as Record<string, unknown>).note).toBe('kalsın'); // PII olmayan alan korunur
    expect(masked!.action).toBe('UPDATE'); // denetim izi bozulmaz

    const untouched = await t.prisma.auditLog.findUnique({ where: { id: freshAudit.id } });
    expect(untouched!.actorEmail).toBe('yonetici@bagdam.test');
    expect(untouched!.ipAddress).toBe('203.0.113.9');
  });

  it('anonymizeInactiveMonths > 0: pasif müşteri anonimleşir, yakın zamanda giriş yapan korunur', async () => {
    await setPrivacy({ mailLogDays: 30, systemLogDays: 30, cronLogDays: 90, auditPiiMonths: 6, anonymizeInactiveMonths: 6 });

    const stale = await t.prisma.user.create({
      data: { email: `${TAG}-stale@bagdam.test`, passwordHash: 'x'.repeat(20), name: 'Pasif Müşteri', phone: '+905321112233', role: 'CUSTOMER', createdAt: OLD, lastLoginAt: null },
      select: { id: true },
    });
    const active = await t.prisma.user.create({
      data: { email: `${TAG}-active@bagdam.test`, passwordHash: 'x'.repeat(20), name: 'Aktif Müşteri', role: 'CUSTOMER', createdAt: OLD, lastLoginAt: FRESH },
      select: { id: true },
    });
    createdUserIds.push(stale.id, active.id);

    const run = await t.jobs.runOnce('kvkk:purge', NOW);
    const details = run.details as unknown as KvkkPurgeResult;
    expect(details.disabled).not.toContain('anonymizeInactiveMonths');
    expect(details.customersAnonymized).toBeGreaterThanOrEqual(1);

    const anonymized = await t.prisma.user.findUniqueOrThrow({ where: { id: stale.id } });
    expect(anonymized.anonymizedAt).not.toBeNull();
    expect(anonymized.email).toBe(`anon+${stale.id}@anon.local`);
    expect(anonymized.name).toBeNull();
    expect(anonymized.phone).toBeNull();
    expect(anonymized.isActive).toBe(false);

    const kept = await t.prisma.user.findUniqueOrThrow({ where: { id: active.id } });
    expect(kept.anonymizedAt).toBeNull();
    expect(kept.email).toBe(`${TAG}-active@bagdam.test`);
  });
});
