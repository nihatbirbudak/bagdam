// F6 — MailModule: POST /admin/settings/mail/test (DISABLE_MAIL → SKIPPED + previewPath; audit) · GET /admin/mail-logs
// (sayfalama, status/to filtreleri, önizleme yolu dev'de) · roller (CUSTOMER 403) · MailService: şablon yok → FAILED
// MAIL_TEMPLATE_MISSING · şablon render (brand + değişkenler, Handlebars kaçışı) · DISABLE_MAIL kapalı + SMTP yok → FAILED.
import '../helpers/env';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import type { MailLogList, MailTestResult } from '@bagdam/shared';
import { AUTH, cleanupUsers, createF6App, deleteMailLogsWithPreviews, type ErrorBody, type F6App } from '../auth/f6-harness';
import { CookieJar } from '../auth/cookie-jar';
import { MAIL_TEMPLATE_SLUGS } from '../../modules/mail/mail.constants';
import { MailService } from '../../modules/mail/mail.service';
import { MailTemplateRenderer } from '../../modules/mail/mail-templates.render';
import { SmtpTransport } from '../../modules/mail/mail.transport';

jest.setTimeout(180_000);

const suffix = randomUUID().slice(0, 8);
const TEST_TO = `test-f6-mail-${suffix}@bagdam.test`;
const CUSTOMER_EMAIL = `test-f6-mailcust-${suffix}@bagdam.test`;
const PASSWORD = 'Mail-Parola-123';

describe('Mail HTTP + MailService — /admin/settings/mail/test · /admin/mail-logs · şablonlar (F6)', () => {
  let t: F6App;
  const startedAt = new Date();
  const adminJar = new CookieJar();
  const customerJar = new CookieJar();
  let adminId = '';
  let customerId = '';
  let testLogId = '';
  const createdLogIds: string[] = [];

  beforeAll(async () => {
    t = await createF6App();
    customerId = await t.createUser({ email: CUSTOMER_EMAIL, password: PASSWORD });
    adminId = await t.loginSeedAdmin(adminJar);
    expect((await t.login(customerJar, CUSTOMER_EMAIL, PASSWORD)).status).toBe(200);
  });

  afterAll(async () => {
    if (t) {
      await deleteMailLogsWithPreviews(t.prisma, { OR: [{ to: TEST_TO }, { id: { in: createdLogIds } }] });
      await t.prisma.auditLog.deleteMany({ where: { module: 'settings', actorId: adminId, createdAt: { gte: startedAt } } });
      await cleanupUsers(t.prisma, [customerId], [CUSTOMER_EMAIL], startedAt);
      await t.close();
    }
  });

  it('seed: tüm mail.* şablonları SiteContent\'te (registry grup mail)', async () => {
    const rows = await t.prisma.siteContent.findMany({ where: { key: { in: MAIL_TEMPLATE_SLUGS.map((s) => `mail.${s}`) } } });
    expect(rows.map((r) => r.key).sort()).toEqual(MAIL_TEMPLATE_SLUGS.map((s) => `mail.${s}`).sort());
    for (const row of rows) {
      const value = row.value as { subject?: string; html?: string };
      expect(typeof value.subject).toBe('string');
      expect(typeof value.html).toBe('string');
    }
  });

  it('POST /admin/settings/mail/test: CUSTOMER 403 · geçersiz to 400 · ADMIN → 200 {status:SKIPPED, previewPath, logId} (DISABLE_MAIL) + dosya + MailLog + audit', async () => {
    expect((await t.call('POST', '/api/v1/admin/settings/mail/test', { jar: customerJar, body: { to: TEST_TO } })).status).toBe(403);
    expect((await t.call('POST', '/api/v1/admin/settings/mail/test', { jar: adminJar, body: { to: 'eposta-degil' } })).status).toBe(400);
    expect((await t.call('POST', '/api/v1/admin/settings/mail/test', { jar: adminJar, csrf: false, body: { to: TEST_TO } })).status).toBe(403);

    const res = await t.call('POST', '/api/v1/admin/settings/mail/test', { jar: adminJar, body: { to: TEST_TO.toUpperCase() } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MailTestResult;
    expect(body.status).toBe('SKIPPED');
    expect(body.messageId).toBeNull();
    expect(typeof body.logId).toBe('string');
    expect(body.previewPath).toBeTruthy();
    expect(existsSync(body.previewPath!)).toBe(true);
    testLogId = body.logId;
    const html = readFileSync(body.previewPath!, 'utf8');
    expect(html).toContain('test e-postası');
    expect(html).toContain('<!-- bagdam mail preview');

    const row = await t.prisma.mailLog.findUniqueOrThrow({ where: { id: body.logId } });
    expect(row.to).toBe(TEST_TO);
    expect(row.templateSlug).toBe('test');
    expect(row.status).toBe('SKIPPED');
    expect(row.error).toBe(`preview:${body.previewPath}`);
    expect(row.subject).toContain('test');
    expect(row.entityId).toBeNull();

    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'settings', actorId: adminId, entityId: body.logId } });
    expect(audit).not.toBeNull();
  });

  it('GET /admin/mail-logs: CUSTOMER 403; ADMIN → {items,total,page,limit}; to filtresi; status filtresi; previewPath dev\'de dolu; limit>100 → 400', async () => {
    expect((await t.call('GET', '/api/v1/admin/mail-logs', { jar: customerJar })).status).toBe(403);
    expect((await t.call('GET', '/api/v1/admin/mail-logs')).status).toBe(401);

    const res = await t.call('GET', `/api/v1/admin/mail-logs?to=${encodeURIComponent(`test-f6-mail-${suffix}`)}&limit=5`, { jar: adminJar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MailLogList;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(5);
    expect(body.total).toBe(1);
    const item = body.items[0]!;
    expect(item.id).toBe(testLogId);
    expect(item.status).toBe('SKIPPED');
    expect(item.previewPath).toBeTruthy();
    expect(item.templateSlug).toBe('test');
    expect(typeof item.createdAt).toBe('string');

    const sent = await t.call('GET', `/api/v1/admin/mail-logs?to=${encodeURIComponent(`test-f6-mail-${suffix}`)}&status=SENT`, { jar: adminJar });
    expect(((await sent.json()) as MailLogList).total).toBe(0);

    const badStatus = await t.call('GET', '/api/v1/admin/mail-logs?status=LOST', { jar: adminJar });
    expect(badStatus.status).toBe(400);
    const tooBig = await t.call('GET', '/api/v1/admin/mail-logs?limit=500', { jar: adminJar });
    expect(tooBig.status).toBe(400);

    // STAFF/ADMIN dışı roller erişemez; ADMIN genel liste de çalışır
    const all = await t.call('GET', '/api/v1/admin/mail-logs', { jar: adminJar });
    expect(all.status).toBe(200);
    expect(((await all.json()) as MailLogList).items.length).toBeGreaterThan(0);
  });

  it('MailService.send: şablon yok → FAILED MAIL_TEMPLATE_MISSING (MailLog satırı FAILED); entityId ile yeniden gönderim aynı satırı günceller', async () => {
    const mail = t.app.get(MailService);
    const missing = await mail.send({ to: TEST_TO, templateSlug: `yok-${suffix}`, vars: {} });
    expect(missing.status).toBe('FAILED');
    expect(missing.error).toMatch(/MAIL_TEMPLATE_MISSING/);
    expect(missing.previewPath).toBeNull();
    createdLogIds.push(missing.logId);
    const failedRow = await t.prisma.mailLog.findUniqueOrThrow({ where: { id: missing.logId } });
    expect(failedRow.status).toBe('FAILED');
    expect(failedRow.error).toMatch(/MAIL_TEMPLATE_MISSING/);

    const entityId = `test-entity-${suffix}`;
    const first = await mail.send({ to: TEST_TO, templateSlug: 'welcome', entityId, vars: { user: { name: 'Ada', email: TEST_TO } } });
    expect(first.status).toBe('SKIPPED');
    createdLogIds.push(first.logId);
    const second = await mail.send({ to: TEST_TO, templateSlug: 'welcome', entityId, vars: { user: { name: 'Ada', email: TEST_TO } } });
    expect(second.logId).toBe(first.logId);
    expect(await t.prisma.mailLog.count({ where: { templateSlug: 'welcome', entityId } })).toBe(1);
  });

  it('MailTemplateRenderer: brand (site adı, WEB_URL) + değişkenler; {{var}} HTML-kaçışlı; konu tek satır', async () => {
    const renderer = t.app.get(MailTemplateRenderer);
    const rendered = await renderer.render('verify', { user: { name: '<b>Ada</b>', email: TEST_TO }, verifyUrl: 'https://example.test/v?token=abc' });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.subject).not.toContain('\n');
    expect(rendered.html).toContain('https://example.test/v?token=abc');
    expect(rendered.html).not.toContain('<b>Ada</b>');
    const brand = await renderer.brandVars();
    expect(brand.name.length).toBeGreaterThan(0);
    expect(rendered.html).toContain(brand.name);
    if (brand.webUrl) expect(rendered.html).toContain(brand.webUrl);
    await expect(renderer.render(`yok-${suffix}`, {})).rejects.toMatchObject({ code: 'MAIL_TEMPLATE_MISSING' });
  });

  it('DISABLE_MAIL kapalı + SMTP yapılandırması yoksa → FAILED MAIL_CONFIG_MISSING (gönderim denenmez); SMTP tanımlıysa atlanır', async () => {
    const transport = t.app.get(SmtpTransport);
    const cfg = await transport.resolveConfig();
    if (cfg) {
      // Geliştirici DB'sinde/ortamda gerçek SMTP tanımlı olabilir — gerçek gönderim denenmez.
      expect(cfg.host.length).toBeGreaterThan(0);
      return;
    }
    const prev = process.env.DISABLE_MAIL;
    process.env.DISABLE_MAIL = 'false';
    try {
      const mail = t.app.get(MailService);
      const result = await mail.send({ to: TEST_TO, templateSlug: 'test', vars: { sentAt: 'now' } });
      createdLogIds.push(result.logId);
      expect(result.status).toBe('FAILED');
      expect(result.error).toMatch(/MAIL_CONFIG_MISSING/);
      const row = await t.prisma.mailLog.findUniqueOrThrow({ where: { id: result.logId } });
      expect(row.status).toBe('FAILED');
      expect(row.sentAt).toBeNull();
    } finally {
      process.env.DISABLE_MAIL = prev;
    }
  });

  it('parola değişimi (PATCH /auth/me/password) ve login MailLog ÜRETMEZ (yalnız F6 olayları)', async () => {
    const before = await t.prisma.mailLog.count({ where: { to: CUSTOMER_EMAIL } });
    const res = await t.call('PATCH', `${AUTH}/me/password`, { jar: customerJar, body: { currentPassword: PASSWORD, newPassword: 'Mail-Parola-456' } });
    expect(res.status).toBe(204);
    expect(await t.prisma.mailLog.count({ where: { to: CUSTOMER_EMAIL } })).toBe(before);
    const err = (await (await t.call('GET', `${AUTH}/me`, { jar: new CookieJar() })).json()) as ErrorBody;
    expect(err.statusCode).toBe(401);
  });
});
