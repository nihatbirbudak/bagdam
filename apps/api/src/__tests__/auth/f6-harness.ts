// F6 test iskeleti — gerçek Nest uygulaması (rastgele port), gerçek DB (bagdam_dev), Node fetch + CookieJar.
// Guard zinciri JwtAuth → Csrf → Roles + AuditLogInterceptor (AppModule ile aynı); Throttler bilinçli olarak dışarıda.
// DISABLE_MAIL=true zorlanır: e-posta gönderilmez, MailLog SKIPPED + logs/mail/<id>.html önizlemesi (testler linki buradan okur).
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { readFile, unlink } from 'fs/promises';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogInterceptor } from '../../common/interceptors/audit-log.interceptor';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { CustomersModule } from '../../modules/customers/customers.module';
import { MailModule } from '../../modules/mail/mail.module';
import { MAIL_PREVIEW_ERROR_PREFIX } from '../../modules/mail/mail.constants';
import { MeModule } from '../../modules/me/me.module';
import { requireDatabaseUrl } from '../helpers/env';
import { CookieJar } from './cookie-jar';

process.env.DISABLE_MAIL = 'true';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface CallOptions {
  jar?: CookieJar;
  body?: unknown;
  headers?: Record<string, string>;
  /** false → kavanozda csrf_token olsa da X-CSRF-Token gönderilmez. */
  csrf?: boolean;
}

export interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

export interface SessionUserBody {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export const AUTH = '/api/v1/auth';

export interface F6App {
  app: INestApplication;
  baseUrl: string;
  prisma: PrismaService;
  call(method: Method, path: string, opts?: CallOptions): Promise<Response>;
  login(jar: CookieJar, email: string, password: string): Promise<Response>;
  /** Seed admin ile giriş (SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD) → kavanoz + id. */
  loginSeedAdmin(jar: CookieJar): Promise<string>;
  /** Geçici kullanıcı (bcrypt maliyeti düşük — yalnız test). */
  createUser(input: { email: string; password: string; name?: string | null; role?: 'CUSTOMER' | 'STAFF' | 'ADMIN'; isActive?: boolean }): Promise<string>;
  /** MailLog satırını (templateSlug + entityId) bulur; önizleme HTML'ini okur. */
  readPreview(templateSlug: string, entityId: string): Promise<{ logId: string; status: string; error: string | null; path: string; html: string }>;
  close(): Promise<void>;
}

export function requireSeedAdmin(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD tanımlı değil — testler seed admin ile giriş yapar (apps/api/.env).');
  }
  return { email, password };
}

export async function createF6App(): Promise<F6App> {
  requireDatabaseUrl();
  const moduleRef = await Test.createTestingModule({
    imports: [CacheModule.register({ isGlobal: true }), PrismaModule, AuthModule, AuditModule, MailModule, MeModule, CustomersModule],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: CsrfGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace(/\/$/, '');
  const prisma = app.get(PrismaService);

  const call = async (method: Method, path: string, opts: CallOptions = {}): Promise<Response> => {
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
  };

  const login = async (jar: CookieJar, email: string, password: string): Promise<Response> => {
    await call('GET', `${AUTH}/csrf`, { jar });
    return call('POST', `${AUTH}/login`, { jar, body: { email, password } });
  };

  return {
    app,
    baseUrl,
    prisma,
    call,
    login,
    async loginSeedAdmin(jar) {
      const admin = requireSeedAdmin();
      const res = await login(jar, admin.email, admin.password);
      if (res.status !== 200) throw new Error(`seed admin girişi başarısız: ${res.status}`);
      return ((await res.json()) as { user: SessionUserBody }).user.id;
    },
    async createUser(input) {
      const row = await prisma.user.create({
        data: {
          email: input.email,
          passwordHash: await bcrypt.hash(input.password, 4),
          name: input.name ?? null,
          role: input.role ?? 'CUSTOMER',
          isActive: input.isActive ?? true,
        },
        select: { id: true },
      });
      return row.id;
    },
    async readPreview(templateSlug, entityId) {
      const row = await prisma.mailLog.findUnique({ where: { templateSlug_entityId: { templateSlug, entityId } } });
      if (!row) throw new Error(`MailLog yok: ${templateSlug}/${entityId}`);
      if (!row.error || !row.error.startsWith(MAIL_PREVIEW_ERROR_PREFIX)) {
        throw new Error(`MailLog önizleme yolu yok (${templateSlug}/${entityId}): status=${row.status} error=${row.error ?? '-'}`);
      }
      const path = row.error.slice(MAIL_PREVIEW_ERROR_PREFIX.length);
      const html = await readFile(path, 'utf8');
      return { logId: row.id, status: row.status, error: row.error, path, html };
    },
    async close() {
      await app.close();
    },
  };
}

/**
 * MailLog satırlarını DISABLE_MAIL önizleme dosyalarıyla (`error = preview:<dosya>`, logs/mail/<id>.html) birlikte siler —
 * testler arkalarında yetim .html bırakmasın (dizin gitignore'lu ama birikir). Dosya yoksa sessizce geçer.
 */
export async function deleteMailLogsWithPreviews(prisma: PrismaService, where: Prisma.MailLogWhereInput): Promise<number> {
  const rows = await prisma.mailLog.findMany({ where, select: { id: true, error: true } });
  await Promise.all(
    rows
      .map((r) => (r.error && r.error.startsWith(MAIL_PREVIEW_ERROR_PREFIX) ? r.error.slice(MAIL_PREVIEW_ERROR_PREFIX.length).trim() : ''))
      .filter((p) => p.length > 0)
      .map((p) => unlink(p).catch(() => undefined)),
  );
  const result = await prisma.mailLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return result.count;
}

/** Test verisini temizler: consents (SetNull ilişkisi — önce silinmeli) · addresses (cascade) · mail_logs (+ önizleme dosyaları) · audit (actor/entity) · users. */
export async function cleanupUsers(prisma: PrismaService, userIds: string[], emails: string[], since: Date): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0 && emails.length === 0) return;
  if (ids.length > 0) {
    await prisma.consent.deleteMany({ where: { userId: { in: ids } } });
    await deleteMailLogsWithPreviews(prisma, { entityId: { in: ids } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }], createdAt: { gte: since } } });
  }
  if (emails.length > 0) {
    await deleteMailLogsWithPreviews(prisma, { to: { in: emails } });
  }
  if (ids.length > 0) await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
