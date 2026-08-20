// F5 — Settings admin uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, gerçek DB bagdam_dev).
// Guard'lar test modülünde YOK (JwtAuth/Roles/Csrf AppModule'de); AuditLogInterceptor DAHİL (sır redaksiyonu doğrulanır).
// Kapsam: GET maskeleme · PUT secret şifreli saklanır (DB'de düz metin yok) + maske/boş gönderilince değişmez ·
// commerce PUT → getCommerce yeni değer + bootstrap cache invalidate · doğrulama 400/404 · mail/test 501.
// Test verisi: mail/commerce gruplarının satırları başta kaydedilir, sonda geri yüklenir.
import '../helpers/env';
import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  COMMERCE_SETTINGS_DEFAULTS,
  SETTING_GROUP_NAMES,
  SETTINGS_REGISTRY,
  SETTINGS_SECRET_MASK,
  type AdminSettingGroup,
} from '@bagdam/shared';
import type { Prisma, Setting } from '@prisma/client';
import type { Cache } from 'cache-manager';
import cookieParser from 'cookie-parser';
import { CACHE_KEYS } from '../../common/cache-keys';
import { decryptSecret, isEncryptedValue } from '../../common/crypto.util';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { AuditLogInterceptor, REDACTED } from '../../common/interceptors/audit-log.interceptor';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { AuditModule } from '../../modules/audit/audit.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { SettingsService } from '../../modules/settings/settings.service';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const SECRET_1 = `test-smtp-parola-${Date.now().toString(36)}-Şğü`;
const SECRET_2 = `${SECRET_1}-yeni`;
const RESTORE_GROUPS = ['mail', 'commerce'] as const;

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Settings admin HTTP — /api/v1/admin/settings (registry · maske · şifreli sır · commerce → bootstrap cache)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settings: SettingsService;
  let cache: Cache;
  let baseUrl: string;
  const startedAt = new Date();
  const snapshot = new Map<string, Setting[]>();

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, body: json };
  };

  const field = (group: AdminSettingGroup, key: string) => {
    const f = group.fields.find((x) => x.key === key);
    if (!f) throw new Error(`alan yok: ${group.group}.${key}`);
    return f;
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, AuditModule, SettingsModule],
      providers: [{ provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
    settings = app.get(SettingsService);
    cache = app.get<Cache>(CACHE_MANAGER);

    for (const group of RESTORE_GROUPS) snapshot.set(group, await prisma.setting.findMany({ where: { group } }));
  });

  afterAll(async () => {
    try {
      for (const group of RESTORE_GROUPS) {
        const original = snapshot.get(group) ?? [];
        const keep = new Set(original.map((r) => r.key));
        await prisma.setting.deleteMany({ where: { group, key: { notIn: [...keep] } } });
        for (const r of original) {
          await prisma.setting.upsert({
            where: { key: r.key },
            create: { key: r.key, group: r.group, value: r.value as Prisma.InputJsonValue, isSecret: r.isSecret },
            update: { value: r.value as Prisma.InputJsonValue, isSecret: r.isSecret, group: r.group },
          });
        }
      }
      // Bu testin ürettiği audit satırları (dev DB temiz kalsın)
      await prisma.auditLog.deleteMany({ where: { module: 'settings', createdAt: { gte: startedAt } } });
      await cache.del(CACHE_KEYS.bootstrapAnonymous);
    } finally {
      await app?.close();
    }
  });

  // ── GET ─────────────────────────────────────────────────────────────────────

  it('GET /admin/settings → registry sırasında 7 grup; şema + değer; secret alan maskeli/boş + hasValue', async () => {
    const res = await api('GET', '/admin/settings');
    expect(res.status).toBe(200);
    const groups = res.body as AdminSettingGroup[];
    expect(groups.map((g) => g.group)).toEqual(SETTINGS_REGISTRY.map((g) => g.group));
    expect(groups.map((g) => g.group).sort()).toEqual([...SETTING_GROUP_NAMES].sort());

    const commerce = groups.find((g) => g.group === 'commerce')!;
    const vat = field(commerce, 'vatRate');
    const vatRow = await prisma.setting.findUnique({ where: { key: 'commerce.vatRate' } });
    expect(vat.type).toBe('number');
    expect(vat.isSecret).toBe(false);
    expect(vat.value).toEqual(vatRow ? vatRow.value : COMMERCE_SETTINGS_DEFAULTS.vatRate);
    expect(field(commerce, 'freeShippingRule').options?.map((o) => o.value)).toEqual(['gte', 'gt']);
    expect(field(commerce, 'discountRounding').type).toBe('select');
    expect(field(commerce, 'subscriberFreeShipping').type).toBe('boolean');

    const mail = groups.find((g) => g.group === 'mail')!;
    const pass = field(mail, 'pass');
    expect(pass.isSecret).toBe(true);
    expect(typeof pass.hasValue).toBe('boolean');
    expect(pass.value === '' || pass.value === SETTINGS_SECRET_MASK).toBe(true);
    // Yanıtın hiçbir yerinde şifreli/düz sır yok
    expect(JSON.stringify(groups)).not.toContain('enc:v1:');
  });

  it('GET /admin/settings/:group → tek grup; bilinmeyen → 404; geçersiz → 400', async () => {
    const ok = await api('GET', '/admin/settings/payment');
    expect(ok.status).toBe(200);
    const payment = ok.body as AdminSettingGroup;
    expect(payment.group).toBe('payment');
    expect(field(payment, 'iyzicoApiKey').isSecret).toBe(true);
    expect(field(payment, 'provider').options?.map((o) => o.value)).toEqual(['iyzico', 'manual']);

    const nope = await api('GET', '/admin/settings/nope');
    expect(nope.status).toBe(404);
    const bad = await api('GET', '/admin/settings/Bad!');
    expect(bad.status).toBe(400);
  });

  it('POST /admin/settings/mail/test → 501 {message:"F6"}', async () => {
    const res = await api('POST', '/admin/settings/mail/test', {});
    expect(res.status).toBe(501);
    expect((res.body as ErrorBody).message).toBe('F6');
  });

  // ── PUT: secret ─────────────────────────────────────────────────────────────

  it('PUT /admin/settings/mail {host, port, pass} → 200 maskeli; DB’de pass şifreli (düz metin yok), isSecret; get() çözer; audit redakte', async () => {
    const res = await api('PUT', '/admin/settings/mail', { host: ' smtp.test.local ', port: 2525, pass: SECRET_1 });
    expect(res.status).toBe(200);
    const mail = res.body as AdminSettingGroup;
    expect(field(mail, 'host').value).toBe('smtp.test.local');
    expect(field(mail, 'port').value).toBe(2525);
    expect(field(mail, 'pass').value).toBe(SETTINGS_SECRET_MASK);
    expect(field(mail, 'pass').hasValue).toBe(true);
    expect(typeof field(mail, 'pass').updatedAt).toBe('string');

    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'mail.pass' } });
    expect(row.isSecret).toBe(true);
    expect(row.group).toBe('mail');
    expect(typeof row.value).toBe('string');
    expect(isEncryptedValue(row.value)).toBe(true);
    expect(row.value as string).not.toContain(SECRET_1);
    expect(JSON.stringify(row.value)).not.toContain('test-smtp-parola');
    expect(decryptSecret(row.value as string)).toBe(SECRET_1);

    const internal = await settings.get('mail');
    expect(internal.pass).toBe(SECRET_1);
    expect(internal.host).toBe('smtp.test.local');
    expect((await settings.getMail()).port).toBe(2525);

    // Audit: newValues.pass redakte, host düz; düz sır hiçbir yerde yok
    const audit = await prisma.auditLog.findFirst({
      where: { module: 'settings', entityId: 'mail', createdAt: { gte: startedAt } },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe('UPDATE');
    const nv = audit!.newValues as Record<string, unknown>;
    expect(nv.pass).toBe(REDACTED);
    expect(nv.host).toBe('smtp.test.local');
    expect(JSON.stringify(audit!.newValues)).not.toContain('test-smtp-parola');
  });

  it('PUT mail {pass: maske} ve {pass: ""} → değişmez (aynı şifreli değer); {pass: yeni} → değişir', async () => {
    const before = await prisma.setting.findUniqueOrThrow({ where: { key: 'mail.pass' } });

    const masked = await api('PUT', '/admin/settings/mail', { pass: SETTINGS_SECRET_MASK, fromName: 'Bağdam Test' });
    expect(masked.status).toBe(200);
    const afterMask = await prisma.setting.findUniqueOrThrow({ where: { key: 'mail.pass' } });
    expect(afterMask.value).toBe(before.value);
    expect(field(masked.body as AdminSettingGroup, 'fromName').value).toBe('Bağdam Test');

    const empty = await api('PUT', '/admin/settings/mail', { pass: '' });
    expect(empty.status).toBe(200);
    const afterEmpty = await prisma.setting.findUniqueOrThrow({ where: { key: 'mail.pass' } });
    expect(afterEmpty.value).toBe(before.value);
    expect(decryptSecret(afterEmpty.value as string)).toBe(SECRET_1);

    const changed = await api('PUT', '/admin/settings/mail', { pass: SECRET_2 });
    expect(changed.status).toBe(200);
    const afterChange = await prisma.setting.findUniqueOrThrow({ where: { key: 'mail.pass' } });
    expect(afterChange.value).not.toBe(before.value);
    expect(decryptSecret(afterChange.value as string)).toBe(SECRET_2);
    expect((await settings.get('mail')).pass).toBe(SECRET_2);
  });

  it('PUT doğrulama: bilinmeyen alan 400 · select dışı 400 · sayı değil 400 · boş gövde 400 · bilinmeyen grup 404', async () => {
    expect((await api('PUT', '/admin/settings/mail', { smtpSifre: 'x' })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/mail', { provider: 'gmail' })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/mail', { port: 'abc' })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/mail', { port: 70000 })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/mail', {})).status).toBe(400);
    expect((await api('PUT', '/admin/settings/nope', { a: 1 })).status).toBe(404);
    // Geçersiz istekler hiçbir şey yazmamış olmalı
    expect((await prisma.setting.findUnique({ where: { key: 'mail.smtpSifre' } }))).toBeNull();
    expect((await settings.get('mail')).provider).toBe('smtp');
  });

  // ── PUT: commerce → getCommerce + bootstrap cache ──────────────────────────

  it('PUT /admin/settings/commerce {vatRate, freeShippingRule} → getCommerce yeni değer; bootstrap cache düşer', async () => {
    await cache.set(CACHE_KEYS.bootstrapAnonymous, { marker: true }, 60_000);
    expect(await cache.get(CACHE_KEYS.bootstrapAnonymous)).toEqual({ marker: true });
    const delSpy = jest.spyOn(cache, 'del');

    const res = await api('PUT', '/admin/settings/commerce', { vatRate: 8, freeShippingRule: 'gt' });
    expect(res.status).toBe(200);
    const commerce = res.body as AdminSettingGroup;
    expect(field(commerce, 'vatRate').value).toBe(8);
    expect(field(commerce, 'freeShippingRule').value).toBe('gt');

    expect(delSpy).toHaveBeenCalledWith(CACHE_KEYS.bootstrapAnonymous);
    expect(await cache.get(CACHE_KEYS.bootstrapAnonymous)).toBeUndefined();
    delSpy.mockRestore();

    const merged = await settings.getCommerce();
    expect(merged.vatRate).toBe(8);
    expect(merged.freeShippingRule).toBe('gt');
    // Diğer alanlar bozulmadı (varsayılan ya da DB)
    expect(merged.deliveryDays.map((d) => d.id)).toEqual(['sali', 'persembe', 'cumartesi']);
    expect(merged.cutoff).toEqual(COMMERCE_SETTINGS_DEFAULTS.cutoff);

    const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'commerce.vatRate' } });
    expect(row.value).toBe(8);
    expect(row.isSecret).toBe(false);
  });

  it('PUT commerce yapılı alan doğrulaması: cutoff saat biçimi · deliveryDays boş/yanlış id · dunning · select → 400; geçerli → 200', async () => {
    expect((await api('PUT', '/admin/settings/commerce', { cutoff: { daysBefore: 1, time: '25:00' } })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/commerce', { deliveryDays: [] })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/commerce', { deliveryDays: [{ id: 'pazar', label: 'Pazar' }] })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/commerce', { dunning: { retryHours: [], pastDueAfterUnpaid: 2 } })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/commerce', { discountRounding: 'lira' })).status).toBe(400);
    expect((await api('PUT', '/admin/settings/commerce', { chargeStrategy: 'X' })).status).toBe(400);

    const ok = await api('PUT', '/admin/settings/commerce', {
      cutoff: { daysBefore: 2, time: '09:30' },
      deliveryDays: [{ id: 'sali', label: 'Salı' }, { id: 'cumartesi', label: 'Cumartesi', dow: 6 }],
      discountRounding: 'tl',
      subscriberFreeShipping: false,
    });
    expect(ok.status).toBe(200);
    const merged = await settings.getCommerce();
    expect(merged.cutoff).toEqual({ daysBefore: 2, time: '09:30' });
    expect(merged.deliveryDays).toEqual([
      { id: 'sali', label: 'Salı', dow: 2 },
      { id: 'cumartesi', label: 'Cumartesi', dow: 6 },
    ]);
    expect(merged.discountRounding).toBe('tl');
    expect(merged.subscriberFreeShipping).toBe(false);
  });

  it('get(): DB satırı olmayan grup varsayılanlarla döner (site/sms); cookies boolean', async () => {
    const sms = await settings.get('sms');
    expect(sms.provider).toBe('netgsm');
    expect(sms.pass).toBe('');
    const cookies = await settings.getCookies();
    expect(typeof cookies.analyticsEnabled).toBe('boolean');
    expect(typeof cookies.marketingEnabled).toBe('boolean');
    const payment = await settings.getPayment();
    expect(typeof payment.enabled).toBe('boolean');
    expect(payment.iyzicoBaseUrl).toMatch(/^https:\/\//);
  });
});
