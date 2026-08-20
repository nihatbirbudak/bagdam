// F4 — Auth çekirdeği + guard zinciri HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch).
// Gerçek DB (bagdam_dev): seed admin SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD ile; CUSTOMER ve kilit senaryosu için
// geçici kullanıcılar burada oluşturulur ve sonunda silinir. Throttler bilinçli olarak dışarıda (10/dk login limiti
// testi bozmasın); guard sırası JwtAuth → Csrf → Roles main/app.module ile aynı.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { requireDatabaseUrl } from '../helpers/env';
import { CookieJar, type ParsedSetCookie } from './cookie-jar';

jest.setTimeout(120_000);

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

interface AuthUserBody {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface MeBody extends AuthUserBody {
  phone: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface AuditListBody {
  items: Array<{
    id: string;
    actorId: string | null;
    actorEmail: string | null;
    action: string;
    module: string;
    entityId: string | null;
    summary: string | null;
    newValues: Record<string, unknown> | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface CallOptions {
  jar?: CookieJar;
  body?: unknown;
  headers?: Record<string, string>;
  /** false → kavanozda csrf_token olsa da X-CSRF-Token gönderilmez. */
  csrf?: boolean;
}

const AUTH = '/api/v1/auth';
const AUDIT = '/api/v1/admin/audit-logs';
const IS_PROD = process.env.NODE_ENV === 'production';

function requireSeedAdmin(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil — auth testleri seed admin ile giriş yapar (apps/api/.env).');
  }
  return { email, password };
}

function findCookie(list: ParsedSetCookie[], name: string): ParsedSetCookie | undefined {
  return list.find((c) => c.name === name);
}

function isCleared(c: ParsedSetCookie | undefined): boolean {
  if (!c) return false;
  return c.value === '' || (c.maxAge !== null && c.maxAge <= 0) || (c.expires !== null && c.expires.getTime() <= Date.now());
}

describe('Auth HTTP — /api/v1/auth + JwtAuth/Csrf/Roles + audit', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  const startedAt = new Date();

  const seedAdmin = requireSeedAdmin();
  const adminJar = new CookieJar();
  const customerJar = new CookieJar();
  let adminId = '';

  const suffix = randomUUID().slice(0, 8);
  const customer = { id: '', email: `test-customer-${suffix}@bagdam.test`, password: 'Musteri-Parola-123' };
  const lockUser = { id: '', email: `test-lock-${suffix}@bagdam.test`, password: 'Kilit-Parola-123' };

  async function call(method: Method, path: string, opts: CallOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.jar) {
      const cookie = opts.jar.header(path);
      if (cookie) headers.cookie = cookie;
      if (opts.csrf !== false) {
        const csrf = opts.jar.get('csrf_token');
        if (csrf) headers['x-csrf-token'] = csrf.value;
      }
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      redirect: 'manual',
    });
    opts.jar?.absorb(res);
    return res;
  }

  async function login(jar: CookieJar, email: string, password: string): Promise<Response> {
    await call('GET', `${AUTH}/csrf`, { jar });
    return call('POST', `${AUTH}/login`, { jar, body: { email, password } });
  }

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register({ isGlobal: true }), PrismaModule, AuthModule, AuditModule],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);

    // Geçici kullanıcılar (bcrypt maliyeti düşük — yalnız test)
    const [customerRow, lockRow] = await Promise.all([
      prisma.user.create({
        data: {
          email: customer.email,
          passwordHash: await bcrypt.hash(customer.password, 4),
          name: 'Test Müşteri',
          role: 'CUSTOMER',
          isActive: true,
        },
        select: { id: true },
      }),
      prisma.user.create({
        data: {
          email: lockUser.email,
          passwordHash: await bcrypt.hash(lockUser.password, 4),
          name: 'Kilit Testi',
          role: 'CUSTOMER',
          isActive: true,
        },
        select: { id: true },
      }),
    ]);
    customer.id = customerRow.id;
    lockUser.id = lockRow.id;
  });

  afterAll(async () => {
    if (prisma) {
      const actorIds = [customer.id, lockUser.id, adminId].filter(Boolean);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: actorIds }, createdAt: { gte: startedAt } } });
      await prisma.user.deleteMany({ where: { id: { in: [customer.id, lockUser.id].filter(Boolean) } } });
    }
    await app?.close();
  });

  it('GET /auth/csrf → 200 {csrfToken} + csrf_token çerezi (JS okur: httpOnly yok; SameSite=Lax; Path=/)', async () => {
    const res = await call('GET', `${AUTH}/csrf`, { jar: adminJar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { csrfToken: string };
    expect(body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    const cookie = adminJar.get('csrf_token');
    expect(cookie?.value).toBe(body.csrfToken);
    const raw = res.headers.getSetCookie().find((c) => c.startsWith('csrf_token='));
    expect(raw).toBeDefined();
    expect(raw).not.toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
    if (!IS_PROD) expect(raw).not.toMatch(/Secure/);
  });

  it('POST /auth/login yanlış parola → 401 "E-posta veya parola hatalı" (çerez yok)', async () => {
    const res = await call('POST', `${AUTH}/login`, { jar: adminJar, body: { email: seedAdmin.email, password: `${seedAdmin.password}-yanlis` } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.message).toBe('E-posta veya parola hatalı');
    expect(adminJar.has('access_token')).toBe(false);
  });

  it('POST /auth/login bilinmeyen e-posta → 401 aynı mesaj; geçersiz gövde → 400', async () => {
    const unknown = await call('POST', `${AUTH}/login`, { body: { email: `yok-${suffix}@bagdam.test`, password: 'herhangi' } });
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as ErrorBody).message).toBe('E-posta veya parola hatalı');
    const invalid = await call('POST', `${AUTH}/login`, { body: { email: 'bu-eposta-degil', password: '' } });
    expect(invalid.status).toBe(400);
  });

  it('POST /auth/login (seed admin) → 200 {user} + access_token (HttpOnly, Path=/, 15 dk) + refresh_token (Path=/api/v1/auth, 30 gün)', async () => {
    const res = await call('POST', `${AUTH}/login`, { jar: adminJar, body: { email: seedAdmin.email, password: seedAdmin.password } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AuthUserBody };
    expect(body.user.email.toLowerCase()).toBe(seedAdmin.email.toLowerCase());
    expect(body.user.role).toBe('ADMIN');
    expect(typeof body.user.id).toBe('string');
    expect(Object.keys(body)).toEqual(['user']);
    adminId = body.user.id;

    const setCookies = adminJar.absorb(res);
    const access = findCookie(setCookies, 'access_token');
    const refresh = findCookie(setCookies, 'refresh_token');
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect(access?.httpOnly).toBe(true);
    expect(access?.path).toBe('/');
    expect(access?.sameSite?.toLowerCase()).toBe('lax');
    expect(access?.maxAge).toBe(15 * 60);
    expect(access?.secure).toBe(IS_PROD);
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe('/api/v1/auth');
    expect(refresh?.maxAge).toBe(30 * 24 * 60 * 60);
    // login taze CSRF çerezi de verir
    expect(findCookie(setCookies, 'csrf_token')).toBeDefined();
    // JWT biçimi (3 parça)
    expect(access?.value.split('.')).toHaveLength(3);
  });

  it('GET /auth/me (çerez) → 200 {id,email,name,role,emailVerifiedAt,createdAt}', async () => {
    const res = await call('GET', `${AUTH}/me`, { jar: adminJar });
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeBody;
    expect(me.id).toBe(adminId);
    expect(me.role).toBe('ADMIN');
    expect(typeof me.createdAt).toBe('string');
    expect(me).toHaveProperty('emailVerifiedAt');
    expect(me).toHaveProperty('name');
    expect(me).not.toHaveProperty('passwordHash');
    expect(me).not.toHaveProperty('refreshTokenHash');
  });

  it('GET /auth/me (Authorization: Bearer) → 200; Bearer varken çereze düşülmez (bozuk Bearer + geçerli çerez → 401)', async () => {
    const token = adminJar.get('access_token')?.value;
    expect(token).toBeDefined();
    const bearer = await fetch(`${baseUrl}${AUTH}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(bearer.status).toBe(200);
    expect(((await bearer.json()) as MeBody).id).toBe(adminId);

    const mixed = await fetch(`${baseUrl}${AUTH}/me`, {
      headers: { authorization: 'Bearer bozuk.token.degeri', cookie: adminJar.header(`${AUTH}/me`) },
    });
    expect(mixed.status).toBe(401);
  });

  it('GET /auth/me oturumsuz → 401 UNAUTHENTICATED; bozuk çerez → 401', async () => {
    const none = await call('GET', `${AUTH}/me`);
    expect(none.status).toBe(401);
    const body = (await none.json()) as ErrorBody;
    expect(body.statusCode).toBe(401);
    const broken = await fetch(`${baseUrl}${AUTH}/me`, { headers: { cookie: 'access_token=abc.def.ghi' } });
    expect(broken.status).toBe(401);
  });

  it('CSRF: çerezli PATCH /auth/me başlıksız → 403 CSRF_INVALID; X-CSRF-Token ile → 200 (CUSTOMER hesabı)', async () => {
    const loginRes = await login(customerJar, customer.email, customer.password);
    expect(loginRes.status).toBe(200);
    expect(((await loginRes.json()) as { user: AuthUserBody }).user.role).toBe('CUSTOMER');

    const noCsrf = await call('PATCH', `${AUTH}/me`, { jar: customerJar, csrf: false, body: { name: 'Adı Değişti' } });
    expect(noCsrf.status).toBe(403);
    const err = (await noCsrf.json()) as ErrorBody;
    expect(err.error).toBe('CSRF_INVALID');
    expect(err.message).toMatch(/csrf/i);

    const wrongCsrf = await call('PATCH', `${AUTH}/me`, {
      jar: customerJar,
      csrf: false,
      headers: { 'x-csrf-token': 'f'.repeat(64) },
      body: { name: 'Adı Değişti' },
    });
    expect(wrongCsrf.status).toBe(403);

    const ok = await call('PATCH', `${AUTH}/me`, { jar: customerJar, body: { name: 'Adı Değişti', phone: '+90 555 111 22 33' } });
    expect(ok.status).toBe(200);
    const me = (await ok.json()) as MeBody;
    expect(me.name).toBe('Adı Değişti');
    expect(me.phone).toBe('+90 555 111 22 33');

    const bad = await call('PATCH', `${AUTH}/me`, { jar: customerJar, body: { phone: 'telefon-degil' } });
    expect(bad.status).toBe(400);
    const extra = await call('PATCH', `${AUTH}/me`, { jar: customerJar, body: { role: 'ADMIN' } });
    expect(extra.status).toBe(400); // forbidNonWhitelisted
  });

  it('POST /auth/refresh → rotasyon: yeni çift, eski refresh tekrar kullanılamaz (401 + çerez temizleme)', async () => {
    const oldAccess = adminJar.get('access_token')?.value;
    const oldRefresh = adminJar.get('refresh_token')?.value;
    expect(oldAccess && oldRefresh).toBeTruthy();

    const res = await call('POST', `${AUTH}/refresh`, { jar: adminJar, csrf: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AuthUserBody };
    expect(body.user.id).toBe(adminId);
    const newAccess = adminJar.get('access_token')?.value;
    const newRefresh = adminJar.get('refresh_token')?.value;
    expect(newAccess).toBeDefined();
    expect(newRefresh).toBeDefined();
    expect(newAccess).not.toBe(oldAccess);
    expect(newRefresh).not.toBe(oldRefresh);

    // Yeni access çalışır
    const me = await call('GET', `${AUTH}/me`, { jar: adminJar });
    expect(me.status).toBe(200);

    // Eski refresh → 401 + access/refresh çerezleri temizlenir
    const replay = await fetch(`${baseUrl}${AUTH}/refresh`, { method: 'POST', headers: { cookie: `refresh_token=${oldRefresh}` } });
    expect(replay.status).toBe(401);
    const replayCookies = replay.headers.getSetCookie();
    const tmp = new CookieJar();
    const parsed = tmp.absorb(replay);
    expect(isCleared(findCookie(parsed, 'access_token'))).toBe(true);
    expect(isCleared(findCookie(parsed, 'refresh_token'))).toBe(true);
    expect(replayCookies.length).toBeGreaterThanOrEqual(2);

    // Refresh çerezi olmadan → 401
    const none = await fetch(`${baseUrl}${AUTH}/refresh`, { method: 'POST' });
    expect(none.status).toBe(401);
  });

  it('POST /auth/logout → 204, çerezler temizlenir, refreshTokenHash null; ardından /auth/me ve refresh 401', async () => {
    const refreshBeforeLogout = adminJar.get('refresh_token')?.value;
    const res = await call('POST', `${AUTH}/logout`, { jar: adminJar });
    expect(res.status).toBe(204);
    const tmp = new CookieJar();
    const parsed = tmp.absorb(res);
    expect(isCleared(findCookie(parsed, 'access_token'))).toBe(true);
    expect(isCleared(findCookie(parsed, 'refresh_token'))).toBe(true);
    expect(adminJar.has('access_token')).toBe(false);
    expect(adminJar.has('refresh_token')).toBe(false);

    const row = await prisma.user.findUnique({ where: { id: adminId }, select: { refreshTokenHash: true } });
    expect(row?.refreshTokenHash).toBeNull();

    const me = await call('GET', `${AUTH}/me`, { jar: adminJar });
    expect(me.status).toBe(401);

    const refresh = await fetch(`${baseUrl}${AUTH}/refresh`, { method: 'POST', headers: { cookie: `refresh_token=${refreshBeforeLogout}` } });
    expect(refresh.status).toBe(401);
  });

  it('5 ardışık hatalı giriş → 423 Locked; kilitliyken doğru parola da 423; DB lockedUntil ileride', async () => {
    for (let i = 1; i <= 4; i += 1) {
      const res = await call('POST', `${AUTH}/login`, { body: { email: lockUser.email, password: 'yanlis-parola' } });
      expect(res.status).toBe(401);
    }
    const fifth = await call('POST', `${AUTH}/login`, { body: { email: lockUser.email, password: 'yanlis-parola' } });
    expect(fifth.status).toBe(423);
    const lockedBody = (await fifth.json()) as ErrorBody;
    expect(lockedBody.statusCode).toBe(423);
    expect(lockedBody.error).toBe('Locked');
    expect(lockedBody.message).toMatch(/kilit/i);

    const correct = await call('POST', `${AUTH}/login`, { body: { email: lockUser.email, password: lockUser.password } });
    expect(correct.status).toBe(423);

    const row = await prisma.user.findUnique({ where: { id: lockUser.id }, select: { lockedUntil: true, failedLoginAttempts: true } });
    expect(row?.lockedUntil).not.toBeNull();
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);
    expect(row?.failedLoginAttempts).toBe(0);
  });

  it('RolesGuard: CUSTOMER → /admin/audit-logs 403; oturumsuz 401; ADMIN → 200 {items,total,page,limit} + auth LOGIN satırı (redakte)', async () => {
    const forbidden = await call('GET', AUDIT, { jar: customerJar });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as ErrorBody).error).toBe('FORBIDDEN_ROLE');

    const anonymous = await call('GET', AUDIT);
    expect(anonymous.status).toBe(401);

    const loginRes = await login(adminJar, seedAdmin.email, seedAdmin.password);
    expect(loginRes.status).toBe(200);

    const res = await call('GET', `${AUDIT}?module=auth&limit=20`, { jar: adminJar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuditListBody;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(typeof body.total).toBe('number');
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.module === 'auth')).toBe(true);

    const loginRow = body.items.find((i) => i.action === 'LOGIN' && i.actorId === adminId);
    expect(loginRow).toBeDefined();
    expect(loginRow?.entityId).toBe(adminId);
    expect(loginRow?.newValues?.email).toBe('[redacted]');
    expect(loginRow?.newValues?.password).toBe('[redacted]');
    expect(loginRow?.actorEmail?.toLowerCase()).toBe(seedAdmin.email.toLowerCase());

    const logoutRow = body.items.find((i) => i.action === 'LOGOUT' && i.actorId === adminId);
    expect(logoutRow).toBeDefined();

    const updateRow = body.items.find((i) => i.action === 'UPDATE' && i.actorId === customer.id);
    expect(updateRow).toBeDefined();
    expect(updateRow?.newValues?.phone).toBe('[redacted]');
    expect(updateRow?.newValues?.name).toBe('Adı Değişti');

    const tooBig = await call('GET', `${AUDIT}?limit=500`, { jar: adminJar });
    expect(tooBig.status).toBe(400);
  });

  it('PATCH /auth/me/password: mevcut parola hatalı → 401; doğru → 204 + yeni çerezler; eski parola ile giriş 401, yeni ile 200', async () => {
    const wrong = await call('PATCH', `${AUTH}/me/password`, { jar: customerJar, body: { currentPassword: 'yanlis', newPassword: 'Yeni-Parola-123' } });
    expect(wrong.status).toBe(401);
    const short = await call('PATCH', `${AUTH}/me/password`, { jar: customerJar, body: { currentPassword: customer.password, newPassword: 'kisa' } });
    expect(short.status).toBe(400);

    const beforeAccess = customerJar.get('access_token')?.value;
    const ok = await call('PATCH', `${AUTH}/me/password`, { jar: customerJar, body: { currentPassword: customer.password, newPassword: 'Yeni-Parola-123' } });
    expect(ok.status).toBe(204);
    expect(customerJar.get('access_token')?.value).not.toBe(beforeAccess);
    const me = await call('GET', `${AUTH}/me`, { jar: customerJar });
    expect(me.status).toBe(200);

    const oldLogin = await call('POST', `${AUTH}/login`, { body: { email: customer.email, password: customer.password } });
    expect(oldLogin.status).toBe(401);
    const newLogin = await call('POST', `${AUTH}/login`, { body: { email: customer.email, password: 'Yeni-Parola-123' } });
    expect(newLogin.status).toBe(200);
  });
});
