// F6 — Müşteri auth HTTP: register (KVKK zorunlu 400 · 409 · 201 + çerez + Consent satırları + MailLog welcome/verify SKIPPED
// + önizleme dosyası) · verify bağlantısı → emailVerifiedAt · forgot (yok → 200 sessiz; var → sha256 token + mail) · reset
// (geçersiz 400; geçerli 200 + çerezler + eski refresh düşer + parola değişti maili + audit PASSWORD_RESET).
import '../helpers/env';
import { existsSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { AUTH, cleanupUsers, createF6App, type ErrorBody, type F6App, type SessionUserBody } from './f6-harness';
import { CookieJar } from './cookie-jar';

jest.setTimeout(180_000);

const suffix = randomUUID().slice(0, 8);
const EMAIL = `test-f6-reg-${suffix}@bagdam.test`;
const PASSWORD = 'Kayit-Parola-123';
const NEW_PASSWORD = 'Yeni-Parola-456';

describe('Customer auth HTTP — /api/v1/auth register · verify · forgot · reset (F6)', () => {
  let t: F6App;
  const startedAt = new Date();
  const jar = new CookieJar();
  let userId = '';

  beforeAll(async () => {
    t = await createF6App();
  });

  afterAll(async () => {
    if (t) {
      await cleanupUsers(t.prisma, [userId], [EMAIL], startedAt);
      await t.close();
    }
  });

  it('POST /auth/register KVKK onayı yoksa → 400 KVKK_REQUIRED; gövde hatalı → 400', async () => {
    const noKvkk = await t.call('POST', `${AUTH}/register`, {
      body: { email: EMAIL, password: PASSWORD, consents: [{ kind: 'MARKETING_EMAIL', granted: true }] },
    });
    expect(noKvkk.status).toBe(400);
    expect(((await noKvkk.json()) as ErrorBody).error).toBe('KVKK_REQUIRED');

    const kvkkDenied = await t.call('POST', `${AUTH}/register`, {
      body: { email: EMAIL, password: PASSWORD, consents: [{ kind: 'KVKK_ACK', granted: false }] },
    });
    expect(kvkkDenied.status).toBe(400);
    expect(((await kvkkDenied.json()) as ErrorBody).error).toBe('KVKK_REQUIRED');

    const shortPassword = await t.call('POST', `${AUTH}/register`, {
      body: { email: EMAIL, password: 'kisa', consents: [{ kind: 'KVKK_ACK', granted: true }] },
    });
    expect(shortPassword.status).toBe(400);

    const badKind = await t.call('POST', `${AUTH}/register`, {
      body: { email: EMAIL, password: PASSWORD, consents: [{ kind: 'COOKIE_ANALYTICS', granted: true }] },
    });
    expect(badKind.status).toBe(400);

    const unknownDoc = await t.call('POST', `${AUTH}/register`, {
      body: { email: EMAIL, password: PASSWORD, consents: [{ kind: 'KVKK_ACK', granted: true, documentSlug: `yok-${suffix}` }] },
    });
    expect(unknownDoc.status).toBe(400);
    expect(((await unknownDoc.json()) as ErrorBody).error).toBe('CONSENT_DOCUMENT_NOT_FOUND');

    // Hiçbiri kullanıcı oluşturmadı
    expect(await t.prisma.user.findUnique({ where: { email: EMAIL } })).toBeNull();
  });

  it('POST /auth/register → 201 {user} + access/refresh/csrf çerezleri (anında giriş); Consent satırları (KVKK doc bağlı, MARKETING PENDING); marketingOptIn; lastLoginAt', async () => {
    const res = await t.call('POST', `${AUTH}/register`, {
      jar,
      body: {
        email: ` ${EMAIL.toUpperCase()} `,
        password: PASSWORD,
        name: 'Test Üye',
        phone: '+90 555 000 11 22',
        consents: [
          { kind: 'KVKK_ACK', granted: true, documentSlug: 'kvkk' },
          { kind: 'MARKETING_EMAIL', granted: true },
          { kind: 'MARKETING_SMS', granted: false },
        ],
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: SessionUserBody };
    expect(Object.keys(body)).toEqual(['user']);
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.role).toBe('CUSTOMER');
    expect(body.user.name).toBe('Test Üye');
    userId = body.user.id;
    expect(jar.has('access_token')).toBe(true);
    expect(jar.has('refresh_token')).toBe(true);
    expect(jar.has('csrf_token')).toBe(true);

    // Anında giriş: /auth/me çalışır
    const me = await t.call('GET', `${AUTH}/me`, { jar });
    expect(me.status).toBe(200);

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { consents: { orderBy: { kind: 'asc' } } } });
    expect(row.role).toBe('CUSTOMER');
    expect(row.marketingOptIn).toBe(true);
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.lastLoginAt).not.toBeNull();
    expect(row.refreshTokenHash).not.toBeNull();
    expect(row.phone).toBe('+90 555 000 11 22');
    expect(row.consents.map((c) => [c.kind, c.granted, c.iysStatus, c.source])).toEqual([
      ['KVKK_ACK', true, 'NOT_APPLICABLE', 'HS_WEB'],
      ['MARKETING_EMAIL', true, 'PENDING', 'HS_WEB'],
      ['MARKETING_SMS', false, 'PENDING', 'HS_WEB'],
    ]);
    const kvkkDoc = await t.prisma.legalDocument.findFirst({ where: { slug: 'kvkk', isCurrent: true } });
    expect(row.consents.find((c) => c.kind === 'KVKK_ACK')?.documentId).toBe(kvkkDoc?.id ?? null);
    const marketingDoc = await t.prisma.legalDocument.findFirst({ where: { slug: 'ticari-ileti-izni', isCurrent: true } });
    expect(row.consents.find((c) => c.kind === 'MARKETING_EMAIL')?.documentId).toBe(marketingDoc?.id ?? null);
    expect(row.consents.every((c) => c.ipAddress && c.ipAddress.length > 0)).toBe(true);

    // Audit: auth REGISTER (e-posta redakte)
    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'auth', action: 'REGISTER', actorId: userId } });
    expect(audit).not.toBeNull();
    expect(audit?.entityId).toBe(userId);
    expect(JSON.stringify(audit?.newValues)).not.toContain(EMAIL);
  });

  it('aynı e-posta → 409 EMAIL_TAKEN (büyük/küçük harf duyarsız)', async () => {
    const res = await t.call('POST', `${AUTH}/register`, {
      body: { email: EMAIL.toUpperCase(), password: PASSWORD, consents: [{ kind: 'KVKK_ACK', granted: true }] },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toBe('EMAIL_TAKEN');
    expect(body.message).toBe('Bu e-posta zaten kayıtlı');
  });

  it('MailLog: welcome + verify SKIPPED (DISABLE_MAIL) + error "preview:<dosya>" → dosya var, marka/ad/bağlantı içeriyor', async () => {
    const welcome = await t.readPreview('welcome', userId);
    expect(welcome.status).toBe('SKIPPED');
    expect(existsSync(welcome.path)).toBe(true);
    expect(welcome.html).toContain('Test Üye');
    expect(welcome.html).toContain(EMAIL);

    const verify = await t.readPreview('verify', userId);
    expect(verify.status).toBe('SKIPPED');
    expect(verify.html).toMatch(/\/api\/v1\/auth\/verify\?token=/);

    const logs = await t.prisma.mailLog.findMany({ where: { to: EMAIL } });
    expect(logs.map((l) => l.templateSlug).sort()).toEqual(['verify', 'welcome']);
    expect(logs.every((l) => l.status === 'SKIPPED' && l.subject.length > 0)).toBe(true);
  });

  it('GET /auth/verify?token=<mail linki> → 302 /uyelik.html?dogrulandi=1; emailVerifiedAt dolu; tekrar → yine 1; bozuk token → dogrulandi=0', async () => {
    const verify = await t.readPreview('verify', userId);
    const match = /\/api\/v1\/auth\/verify\?token=([A-Za-z0-9_.%-]+)/.exec(verify.html);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]!);

    const res = await t.call('GET', `${AUTH}/verify?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/uyelik\.html\?dogrulandi=1$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.emailVerifiedAt).not.toBeNull();

    const again = await t.call('GET', `${AUTH}/verify?token=${encodeURIComponent(token)}`);
    expect(again.headers.get('location')).toMatch(/dogrulandi=1$/);

    const broken = await t.call('GET', `${AUTH}/verify?token=${encodeURIComponent(`${token}x`)}`);
    expect(broken.status).toBe(302);
    expect(broken.headers.get('location')).toMatch(/dogrulandi=0$/);

    // access token'ı verify yerine kullanmak olmaz (typ farklı)
    const access = jar.get('access_token')!.value;
    const wrongTyp = await t.call('GET', `${AUTH}/verify?token=${encodeURIComponent(access)}`);
    expect(wrongTyp.headers.get('location')).toMatch(/dogrulandi=0$/);

    const missing = await t.call('GET', `${AUTH}/verify`);
    expect(missing.status).toBe(400);
  });

  it('POST /auth/forgot bilinmeyen e-posta → 200 {ok:true}, MailLog yok; bilinen → 200 + passwordResetToken=sha256(token) + 60 dk + reset maili', async () => {
    const unknownEmail = `yok-${suffix}@bagdam.test`;
    const unknown = await t.call('POST', `${AUTH}/forgot`, { body: { email: unknownEmail } });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: true });
    expect(await t.prisma.mailLog.count({ where: { to: unknownEmail } })).toBe(0);

    const known = await t.call('POST', `${AUTH}/forgot`, { body: { email: EMAIL.toUpperCase() } });
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ ok: true });

    const reset = await t.readPreview('reset', userId);
    expect(reset.status).toBe('SKIPPED');
    const match = /uyelik\.html\?sifirla=([0-9a-f]{64})/.exec(reset.html);
    expect(match).not.toBeNull();
    const token = match![1]!;
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.passwordResetToken).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(row.passwordResetExpires).not.toBeNull();
    const remainingMs = row.passwordResetExpires!.getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(55 * 60_000);
    expect(remainingMs).toBeLessThanOrEqual(60 * 60_000);
    expect(reset.html).toContain('60');

    const invalid = await t.call('POST', `${AUTH}/forgot`, { body: { email: 'eposta-degil' } });
    expect(invalid.status).toBe(400);
  });

  it('POST /auth/reset geçersiz token → 400 RESET_TOKEN_INVALID; geçerli → 200 {ok:true} + çerezler; eski refresh 401; eski parola 401, yeni 200; parola değişti maili; süresi dolmuş → 400', async () => {
    const oldRefresh = jar.get('refresh_token')?.value;
    expect(oldRefresh).toBeDefined();

    const bad = await t.call('POST', `${AUTH}/reset`, { body: { token: 'f'.repeat(64), password: NEW_PASSWORD } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as ErrorBody).error).toBe('RESET_TOKEN_INVALID');

    const reset = await t.readPreview('reset', userId);
    const token = /sifirla=([0-9a-f]{64})/.exec(reset.html)![1]!;
    const short = await t.call('POST', `${AUTH}/reset`, { body: { token, password: 'kisa' } });
    expect(short.status).toBe(400);

    const resetJar = new CookieJar();
    const ok = await t.call('POST', `${AUTH}/reset`, { jar: resetJar, body: { token, password: NEW_PASSWORD } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(resetJar.has('access_token')).toBe(true);
    expect(resetJar.has('refresh_token')).toBe(true);
    const me = await t.call('GET', `${AUTH}/me`, { jar: resetJar });
    expect(me.status).toBe(200);

    // Token temizlendi; aynı token ikinci kez → 400
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.passwordResetToken).toBeNull();
    expect(row.passwordResetExpires).toBeNull();
    const replayToken = await t.call('POST', `${AUTH}/reset`, { body: { token, password: NEW_PASSWORD } });
    expect(replayToken.status).toBe(400);

    // Eski oturumun refresh'i düştü
    const replay = await fetch(`${t.baseUrl}${AUTH}/refresh`, { method: 'POST', headers: { cookie: `refresh_token=${oldRefresh}` } });
    expect(replay.status).toBe(401);

    const oldLogin = await t.call('POST', `${AUTH}/login`, { body: { email: EMAIL, password: PASSWORD } });
    expect(oldLogin.status).toBe(401);
    const newLogin = await t.call('POST', `${AUTH}/login`, { body: { email: EMAIL, password: NEW_PASSWORD } });
    expect(newLogin.status).toBe(200);

    const changed = await t.readPreview('password-changed', userId);
    expect(changed.status).toBe('SKIPPED');
    const audit = await t.prisma.auditLog.findFirst({ where: { module: 'auth', action: 'PASSWORD_RESET', actorId: userId } });
    expect(audit).not.toBeNull();

    // Süresi dolmuş token: DB'ye geçmiş tarihle yaz → 400
    const expiredToken = 'a'.repeat(64);
    await t.prisma.user.update({
      where: { id: userId },
      data: { passwordResetToken: createHash('sha256').update(expiredToken, 'utf8').digest('hex'), passwordResetExpires: new Date(Date.now() - 60_000) },
    });
    const expired = await t.call('POST', `${AUTH}/reset`, { body: { token: expiredToken, password: NEW_PASSWORD } });
    expect(expired.status).toBe(400);
    expect(((await expired.json()) as ErrorBody).error).toBe('RESET_TOKEN_INVALID');
  });
});
