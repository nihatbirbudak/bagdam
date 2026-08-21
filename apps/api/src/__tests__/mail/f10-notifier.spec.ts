// F10 — bildirim şablonları: motor olayları (SubscriptionNotifier) + sipariş teslimat olayları (OrdersService)
// ADR-0014 şablonlarına BAĞLI mı? Gerçek Nest + gerçek DB; DISABLE_MAIL=true olduğu için her gönderim
// MailLog(SKIPPED) + `logs/mail/<id>.html` önizlemesi üretir — testler içeriği oradan okur.
//
// Kapsam: registry ↔ seed ↔ MAIL_TEMPLATE_SLUGS bütünlüğü · cycle-charged · cycle-payment-failed ·
// cycle-awaiting-payment · cutoff-reminder (cycle başına BİR kez) · subscription-cancelled · subscription-past-due ·
// order-shipped / order-delivered / order-delivery-failed.
import '../helpers/env';
import { MAIL_TEMPLATE_SLUGS, MAIL_PREVIEW_ERROR_PREFIX } from '../../modules/mail/mail.constants';
import { OrdersService } from '../../modules/orders/orders.service';
import { SITE_CONTENT_REGISTRY } from '../../modules/content/site-content.registry';
import { existsSync, readFileSync } from 'fs';
import { createSubsApp, type Fixture, type SubsApp } from '../subscriptions/harness';

jest.setTimeout(300_000);

/** F10'da eklenen şablonlar (F6/F8 şablonları ayrı testlerde). */
const F10_SLUGS = [
  'cycle-charged',
  'cycle-payment-failed',
  'cycle-awaiting-payment',
  'cutoff-reminder',
  'order-shipped',
  'order-delivered',
  'order-delivery-failed',
  'subscription-cancelled',
  'subscription-past-due',
] as const;

interface PreviewRead {
  logId: string;
  status: string;
  subject: string;
  html: string;
  path: string;
}

describe('F10 — bildirim olayları → mail.* şablonları', () => {
  let t: SubsApp;
  let fx: Fixture;

  /** MailLog satırını (slug, entityId) bekler — bazı bildirimler fire-and-forget gönderilir. */
  async function waitForMail(templateSlug: string, entityId: string, timeoutMs = 20_000): Promise<PreviewRead> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await t.prisma.mailLog.findUnique({ where: { templateSlug_entityId: { templateSlug, entityId } } });
      if (row && row.status !== 'QUEUED') {
        if (!row.error || !row.error.startsWith(MAIL_PREVIEW_ERROR_PREFIX)) {
          throw new Error(`MailLog önizlemesi yok (${templateSlug}/${entityId}): status=${row.status} error=${row.error ?? '-'}`);
        }
        const path = row.error.slice(MAIL_PREVIEW_ERROR_PREFIX.length).trim();
        return { logId: row.id, status: row.status, subject: row.subject, html: readFileSync(path, 'utf8'), path };
      }
      if (Date.now() > deadline) throw new Error(`MailLog gelmedi: ${templateSlug}/${entityId}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  beforeAll(async () => {
    t = await createSubsApp();
    fx = await t.createFixture();
  });

  afterAll(async () => {
    if (!t) return;
    try {
      // Testin ürettiği MailLog satırları + önizleme dosyaları
      const rows = await t.prisma.mailLog.findMany({ where: { to: fx?.email ?? '__yok__' }, select: { id: true, error: true } });
      for (const r of rows) {
        if (r.error?.startsWith(MAIL_PREVIEW_ERROR_PREFIX)) {
          const p = r.error.slice(MAIL_PREVIEW_ERROR_PREFIX.length).trim();
          try {
            (await import('fs/promises')).unlink(p).catch(() => undefined);
          } catch {
            /* yoksa geç */
          }
        }
      }
      await t.prisma.mailLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      await t.cleanup();
    } finally {
      await t.close();
    }
  });

  it('şablon listesi: MAIL_TEMPLATE_SLUGS ≡ registry `mail.*` ≡ DB satırları (subject+html dolu)', async () => {
    const registryKeys = SITE_CONTENT_REGISTRY.filter((e) => e.page === 'mail').map((e) => e.key).sort();
    const slugKeys = MAIL_TEMPLATE_SLUGS.map((s) => `mail.${s}`).sort();
    expect(registryKeys).toEqual(slugKeys);
    for (const slug of F10_SLUGS) expect(MAIL_TEMPLATE_SLUGS).toContain(slug);

    const rows = await t.prisma.siteContent.findMany({ where: { key: { in: slugKeys } } });
    expect(rows.map((r) => r.key).sort()).toEqual(slugKeys);
    for (const row of rows) {
      const value = row.value as { subject?: string; html?: string };
      expect(typeof value.subject).toBe('string');
      expect((value.subject ?? '').trim().length).toBeGreaterThan(0);
      expect((value.html ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('cycle.charged → mail.cycle-charged (entityId=cycleId): kutu içeriği + teslimat günü + tutar', async () => {
    const cycle = await t.cycle(fx.firstCycleId);
    await t.notifier.emitAndDeliver('cycle.charged', {
      subscriptionId: fx.subscriptionId,
      userId: fx.userId,
      cycleId: fx.firstCycleId,
      data: { amount: 321.5, delta: false },
    });
    const mail = await waitForMail('cycle-charged', fx.firstCycleId);
    expect(mail.status).toBe('SKIPPED');
    expect(existsSync(mail.path)).toBe(true);
    expect(mail.html).toContain('321,50');
    // Kutudaki ürün adları listelenir
    const firstItem = cycle.items[0];
    expect(firstItem).toBeDefined();
    expect(mail.html).toContain(firstItem!.label ?? firstItem!.product.name);
    // Teslimat günü metni (gg.aa.yyyy)
    const iso = cycle.deliveryDate.date.toISOString().slice(0, 10);
    expect(mail.html).toContain(`${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`);
  });

  it('cycle.payment-failed → mail.cycle-payment-failed (entityId=cycleId:deneme) + kart güncelleme bağlantısı', async () => {
    await t.notifier.emitAndDeliver('cycle.payment-failed', {
      subscriptionId: fx.subscriptionId,
      userId: fx.userId,
      cycleId: fx.firstCycleId,
      data: { failure: 'Yetersiz bakiye', expired: false },
    });
    const cycle = await t.cycle(fx.firstCycleId);
    const mail = await waitForMail('cycle-payment-failed', `${fx.firstCycleId}:${cycle.retryCount + 1}`);
    expect(mail.html).toContain('Yetersiz bakiye');
    expect(mail.html).toContain('/uyelik.html');
  });

  it('cycle.awaiting-payment → mail.cycle-awaiting-payment: ödeme linki + son ödeme zamanı', async () => {
    const expires = new Date('2027-03-05T09:00:00.000Z');
    await t.notifier.emitAndDeliver('cycle.awaiting-payment', {
      subscriptionId: fx.subscriptionId,
      userId: fx.userId,
      cycleId: fx.firstCycleId,
      data: { amount: 600, linkToken: 'testtoken1234567890abcdef', linkExpiresAt: expires.toISOString() },
    });
    const cycle = await t.cycle(fx.firstCycleId);
    const mail = await waitForMail('cycle-awaiting-payment', `${fx.firstCycleId}:${cycle.retryCount + 1}`);
    expect(mail.html).toContain('/api/v1/pay/testtoken1234567890abcdef');
    expect(mail.html).toMatch(/05\.03\.2027/);
  });

  it('subscription.cutoff-reminder → mail.cutoff-reminder yalnız BİR kez (MailLog templateSlug+cycleId tekilliği)', async () => {
    const cycle = await t.cycle(fx.firstCycleId);
    const payload = {
      subscriptionId: fx.subscriptionId,
      userId: fx.userId,
      cycleId: fx.firstCycleId,
      data: { cutoffAt: cycle.deliveryDate.cutoffAt.toISOString(), deliveryOn: cycle.deliveryDate.date.toISOString().slice(0, 10) },
    };
    await t.notifier.emitAndDeliver('subscription.cutoff-reminder', payload);
    const first = await waitForMail('cutoff-reminder', fx.firstCycleId);
    expect(first.html).toContain('/kutu.html?tier=');

    await t.notifier.emitAndDeliver('subscription.cutoff-reminder', payload);
    const second = await waitForMail('cutoff-reminder', fx.firstCycleId);
    expect(second.logId).toBe(first.logId); // yeni satır AÇILMADI
    const count = await t.prisma.mailLog.count({ where: { templateSlug: 'cutoff-reminder', entityId: fx.firstCycleId } });
    expect(count).toBe(1);
  });

  it('reminders:cutoff job — kesime 24 s kala gerçek gönderim (CronLog details.sent)', async () => {
    const other = await t.createFixture();
    const cycle = await t.cycle(other.firstCycleId);
    // Kesimden tam 24 saat önce: job penceresi (24 s ± 1 s)
    const now = new Date(cycle.deliveryDate.cutoffAt.getTime() - 24 * 60 * 60 * 1000 + 60_000);
    const run = await t.jobs.runOnce('reminders:cutoff', now);
    expect(run.status).toBe('SUCCESS');
    expect((run.details as { sent?: number }).sent).toBeGreaterThanOrEqual(1);
    const mail = await waitForMail('cutoff-reminder', other.firstCycleId);
    expect(mail.subject).toContain('son 24 saat');

    // İkinci koşu aynı cycle için YENİ satır açmaz
    await t.jobs.runOnce('reminders:cutoff', now);
    expect(await t.prisma.mailLog.count({ where: { templateSlug: 'cutoff-reminder', entityId: other.firstCycleId } })).toBe(1);
    await t.prisma.mailLog.deleteMany({ where: { to: other.email } });
  });

  it('subscription.cancelled / subscription.past-due → iptal teyidi ve askıya alma e-postaları', async () => {
    await t.notifier.emitAndDeliver('subscription.cancelled', {
      subscriptionId: fx.subscriptionId,
      userId: fx.userId,
      data: { effectiveAt: '2027-03-09T21:00:00.000Z', refundAmount: 300, refundDueAt: '2027-03-23T21:00:00.000Z' },
    });
    const cancelled = await waitForMail('subscription-cancelled', fx.subscriptionId);
    expect(cancelled.html).toContain('300 TL'); // formatMoneyTr: küsuratsız tutarda kuruş basılmaz
    expect(cancelled.html).toContain('24.03.2027'); // Europe/Istanbul: 23T21:00Z → 24 Mart

    await t.notifier.emitAndDeliver('subscription.past-due', {
      subscriptionId: fx.subscriptionId,
      userId: fx.userId,
      data: { failedCycles: 2 },
    });
    const pastDue = await waitForMail('subscription-past-due', `${fx.subscriptionId}:2`);
    expect(pastDue.subject).toContain('askıda');
    expect(pastDue.html).toContain('/uyelik.html');
  });

  it('Order geçişleri → order-shipped / order-delivered / order-delivery-failed (entityId=orderId)', async () => {
    const orders = t.app.get(OrdersService, { strict: false });
    await orders.transition(fx.orderId, 'PREPARING', { actor: 'OPS' });
    await orders.transition(fx.orderId, 'OUT_FOR_DELIVERY', { actor: 'OPS' });
    const shipped = await waitForMail('order-shipped', fx.orderId);
    expect(shipped.subject).toContain('yola çıktı');

    await orders.transition(fx.orderId, 'DELIVERY_FAILED', { actor: 'OPS', reason: 'Adreste bulunamadı' });
    const failed = await waitForMail('order-delivery-failed', fx.orderId);
    expect(failed.html).toContain('Adreste bulunamadı');

    await orders.transition(fx.orderId, 'OUT_FOR_DELIVERY', { actor: 'OPS' });
    await orders.transition(fx.orderId, 'DELIVERED', { actor: 'OPS' });
    const delivered = await waitForMail('order-delivered', fx.orderId);
    expect(delivered.subject).toContain('teslim edildi');
  });
});
