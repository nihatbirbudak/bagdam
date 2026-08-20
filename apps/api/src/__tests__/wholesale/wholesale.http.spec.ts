// F5 — Wholesale uçları HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch, gerçek DB bagdam_dev).
// ThrottlerGuard DAHİL (3/dk/IP doğrulanır: 4. istek 429); JwtAuth/Roles/Csrf yok. Test verisi `test-lead-<run>@bagdam.test`
// e-postaları; sonda silinir.
import '../helpers/env';
import { CacheModule } from '@nestjs/cache-manager';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { WholesaleLead, WholesaleLeadCreated, WholesaleLeadList } from '@bagdam/shared';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { WholesaleModule } from '../../modules/wholesale/wholesale.module';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const EMAIL_1 = `test-lead-${RUN}-a@bagdam.test`;
const EMAIL_2 = `test-lead-${RUN}-b@bagdam.test`;

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Wholesale HTTP — POST /api/v1/wholesale-leads (3/dk) + /api/v1/admin/wholesale-leads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let firstId = '';

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, body: json, headers: res.headers };
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        PrismaModule,
        WholesaleModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      await prisma.wholesaleLead.deleteMany({ where: { email: { contains: `test-lead-${RUN}` } } });
    } finally {
      await app?.close();
    }
  });

  it('POST /wholesale-leads → 201 {id}; e-posta kırpılıp küçük harfe; ip kaydedilir; boş alanlar null', async () => {
    const res = await api('POST', '/wholesale-leads', { email: `  ${EMAIL_1.toUpperCase()}  `, businessName: '', note: '   ' });
    expect(res.status).toBe(201);
    const body = res.body as WholesaleLeadCreated;
    expect(typeof body.id).toBe('string');
    expect(Object.keys(body)).toEqual(['id']);
    firstId = body.id;

    const row = await prisma.wholesaleLead.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.email).toBe(EMAIL_1);
    expect(row.businessName).toBeNull();
    expect(row.note).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.status).toBe('NEW');
    expect(row.ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('2. istek geçersiz e-posta → 400 (sayaca dahil); 3. istek tam alanlarla 201; 4. istek → 429 (3/dk/IP)', async () => {
    const bad = await api('POST', '/wholesale-leads', { email: 'gecersiz', note: 'x' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify((bad.body as ErrorBody).message)).toMatch(/e-posta/i);

    const ok = await api('POST', '/wholesale-leads', {
      email: EMAIL_2,
      businessName: 'Test Kafe',
      phone: '+90 (530) 000 00 00',
      note: 'Haftada 10 kutu',
    });
    expect(ok.status).toBe(201);
    const row = await prisma.wholesaleLead.findUniqueOrThrow({ where: { id: (ok.body as WholesaleLeadCreated).id } });
    expect(row).toMatchObject({ email: EMAIL_2, businessName: 'Test Kafe', phone: '+90 (530) 000 00 00', note: 'Haftada 10 kutu' });

    const fourth = await api('POST', '/wholesale-leads', { email: `test-lead-${RUN}-c@bagdam.test` });
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('retry-after')).not.toBeNull();
    expect(await prisma.wholesaleLead.count({ where: { email: `test-lead-${RUN}-c@bagdam.test` } })).toBe(0);
  });

  it('POST bilinmeyen alan → 400 (whitelist) — throttle sayacı dolu olsa da guard önce 429 verir; bu yüzden doğrulama ayrı IP gerektirmez, yalnız not', async () => {
    // Sayaç dolu: 429 beklenir (guard pipe'tan önce). Bu, "4. istek 429" kuralının kalıcılığını da doğrular.
    const res = await api('POST', '/wholesale-leads', { email: EMAIL_1, foo: 1 });
    expect(res.status).toBe(429);
  });

  it('GET /admin/wholesale-leads?status=NEW&limit=100 → {items,total,page,limit}; test kayıtları listede; ip gitmez', async () => {
    const res = await api('GET', '/admin/wholesale-leads?status=NEW&limit=100');
    expect(res.status).toBe(200);
    const page = res.body as WholesaleLeadList;
    expect(page.page).toBe(1);
    expect(page.limit).toBe(100);
    expect(page.total).toBeGreaterThanOrEqual(2);
    const mine = page.items.filter((i) => i.email.startsWith(`test-lead-${RUN}`));
    expect(mine.length).toBe(2);
    for (const item of mine) {
      expect(item.status).toBe('NEW');
      expect(Object.keys(item).sort()).toEqual(['businessName', 'createdAt', 'email', 'id', 'note', 'phone', 'status']);
    }
    // En yeni önce
    expect(mine[0]!.email).toBe(EMAIL_2);

    expect((await api('GET', '/admin/wholesale-leads?status=YOK')).status).toBe(400);
    expect((await api('GET', '/admin/wholesale-leads?limit=1000')).status).toBe(400);
  });

  it('PATCH /admin/wholesale-leads/:id {status, note} → güncel; {} → 400; olmayan → 404; GET :id', async () => {
    const res = await api('PATCH', `/admin/wholesale-leads/${firstId}`, { status: 'CONTACTED', note: 'Arandı, teklif gönderildi' });
    expect(res.status).toBe(200);
    const lead = res.body as WholesaleLead;
    expect(lead.status).toBe('CONTACTED');
    expect(lead.note).toBe('Arandı, teklif gönderildi');

    const one = await api('GET', `/admin/wholesale-leads/${firstId}`);
    expect(one.status).toBe(200);
    expect((one.body as WholesaleLead).status).toBe('CONTACTED');

    const cleared = await api('PATCH', `/admin/wholesale-leads/${firstId}`, { note: '' });
    expect((cleared.body as WholesaleLead).note).toBeNull();

    expect((await api('PATCH', `/admin/wholesale-leads/${firstId}`, {})).status).toBe(400);
    expect((await api('PATCH', `/admin/wholesale-leads/${firstId}`, { status: 'YOK' })).status).toBe(400);
    expect((await api('PATCH', '/admin/wholesale-leads/ckolmayan0000000000000000', { status: 'CLOSED' })).status).toBe(404);

    const contacted = (await api('GET', '/admin/wholesale-leads?status=CONTACTED&limit=100')).body as WholesaleLeadList;
    expect(contacted.items.some((i) => i.id === firstId)).toBe(true);
  });
});
