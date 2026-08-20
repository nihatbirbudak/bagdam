// F4 — medya modülü HTTP seviyesinde (gerçek Nest uygulaması, rastgele port, Node fetch + FormData, gerçek DB bagdam_dev).
// Guard'lar test modülünde YOK (A'da). UPLOADS_DIR geçici dizine yönlendirilir (apps/api/uploads kirlenmez).
// sharp kuruluysa: küçük PNG → webp + thumb dosyaları oluşur, liste/patch/delete akışı; kurulu değilse yükleme 503
// (açık mesaj) ve dosya-bağımsız kurallar (400 tür, 409 referans) doğrulanır.
import '../helpers/env';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AdminMediaFile, AdminMediaList } from '@bagdam/shared';
import { deflateSync } from 'zlib';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { PrismaModule } from '../../common/prisma.module';
import { PrismaService } from '../../common/prisma.service';
import { isSharpAvailable } from '../../modules/media/media-image';
import { MediaModule } from '../../modules/media/media.module';
import { toPublicUrl } from '../../modules/media/media.mapper';
import { requireDatabaseUrl } from '../helpers/env';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);

interface ErrorBody {
  statusCode: number;
  message: string | string[];
}

/** CRC32 (PNG chunk'ları için) — harici bağımlılık yok. */
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Geçerli, küçük (w×h, RGBA, düz renk) PNG üretir. */
function makePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) {
    row[1 + x * 4] = 0x8a; // R
    row[2 + x * 4] = 0xb4; // G
    row[3 + x * 4] = 0x5e; // B
    row[4 + x * 4] = 0xff; // A
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

describe('Media HTTP — /api/v1/admin/media (yükleme · liste · düzenleme · silme · referans 409)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let uploadsDir: string;
  const sharpAvailable = isSharpAvailable();
  const createdMediaIds: string[] = [];
  let testProductId: string | undefined;

  const upload = async (file: Blob | null, fields: Record<string, string> = {}, fileName = 'Çiğ Domates.png') => {
    const form = new FormData();
    if (file) form.append('file', file, fileName);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${baseUrl}/api/v1/admin/media`, { method: 'POST', body: form });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
  };

  beforeAll(async () => {
    requireDatabaseUrl();
    uploadsDir = mkdtempSync(join(tmpdir(), 'bagdam-media-test-'));
    process.env.UPLOADS_DIR = uploadsDir;
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, MediaModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace(/\/$/, '');
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (testProductId) await prisma.product.deleteMany({ where: { id: testProductId } });
      if (createdMediaIds.length > 0) await prisma.mediaFile.deleteMany({ where: { id: { in: createdMediaIds } } });
    } finally {
      await app?.close();
      delete process.env.UPLOADS_DIR;
      rmSync(uploadsDir, { recursive: true, force: true });
    }
  });

  it('toPublicUrl: assets/ → /assets/…, diğer → /uploads/…, null → null (tek yer)', () => {
    expect(toPublicUrl('assets/images/incir.jpg')).toBe('/assets/images/incir.jpg');
    expect(toPublicUrl('urunler/x.webp')).toBe('/uploads/urunler/x.webp');
    expect(toPublicUrl('/urunler/x.webp')).toBe('/uploads/urunler/x.webp');
    expect(toPublicUrl(null)).toBeNull();
    expect(toPublicUrl('')).toBeNull();
  });

  it('POST /admin/media dosyasız → 400; desteklenmeyen tür (text/plain) → 400', async () => {
    const none = await upload(null, { folder: 'test' });
    expect(none.status).toBe(400);
    const txt = await upload(new Blob(['merhaba'], { type: 'text/plain' }), {}, 'not.txt');
    expect(txt.status).toBe(400);
    expect(String((txt.body as ErrorBody).message)).toMatch(/Desteklenmeyen/);
  });

  it('GET /admin/media → {items,total,page,limit,folders} (seed görselleri: urunler/sahne)', async () => {
    const res = await api('GET', '/admin/media?page=1&limit=5');
    expect(res.status).toBe(200);
    const body = res.body as AdminMediaList;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(5);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.total).toBeGreaterThanOrEqual(29);
    expect(body.folders).toEqual(expect.arrayContaining(['urunler', 'sahne']));
    for (const item of body.items) {
      expect(item.url.startsWith('/assets/') || item.url.startsWith('/uploads/')).toBe(true);
      expect(typeof item.createdAt).toBe('string');
    }
    const filtered = await api('GET', '/admin/media?folder=sahne&q=steps');
    expect(filtered.status).toBe(200);
    const f = filtered.body as AdminMediaList;
    expect(f.items.every((i) => i.folder === 'sahne' && /steps/i.test(i.path))).toBe(true);
  });

  it('DELETE /admin/media/:id referanslı seed görseli (ProductImage) → 409 {message}; olmayan id → 404', async () => {
    const img = await prisma.productImage.findFirstOrThrow({ select: { mediaId: true } });
    const res = await api('DELETE', `/admin/media/${img.mediaId}`);
    expect(res.status).toBe(409);
    expect(String((res.body as ErrorBody).message)).toMatch(/kullanımda/);
    expect(await prisma.mediaFile.findUnique({ where: { id: img.mediaId } })).not.toBeNull();
    expect((await api('DELETE', '/admin/media/ckolmayan0000000000000000')).status).toBe(404);
  });

  it('PATCH /admin/media/:id geçersiz klasör → 400; alt/folder güncelle → 200 (seed kaydı geri alınır)', async () => {
    const row = await prisma.mediaFile.findFirstOrThrow({ where: { folder: 'urunler' }, orderBy: { createdAt: 'asc' } });
    const bad = await api('PATCH', `/admin/media/${row.id}`, { folder: '!!!' });
    expect(bad.status).toBe(400);
    const ok = await api('PATCH', `/admin/media/${row.id}`, { alt: `test alt ${RUN}`, folder: 'Ürünler' });
    expect(ok.status).toBe(200);
    expect((ok.body as AdminMediaFile).alt).toBe(`test alt ${RUN}`);
    expect((ok.body as AdminMediaFile).folder).toBe('urunler'); // slug'landı
    const back = await api('PATCH', `/admin/media/${row.id}`, { alt: row.alt ?? '' , folder: row.folder });
    expect(back.status).toBe(200);
    expect((back.body as AdminMediaFile).alt).toBe(row.alt);
  });

  if (sharpAvailable) {
    it('POST /admin/media küçük PNG → 201 webp + thumb dosyaları; URL /uploads/<klasör>/…; liste/folders; delete 409 referans → 204 + dosyalar silinir', async () => {
      const png = makePng(64, 48);
      const res = await upload(new Blob([png], { type: 'image/png' }), { folder: 'Test Klasörü', alt: 'domates' });
      expect(res.status).toBe(201);
      const media = res.body as AdminMediaFile;
      createdMediaIds.push(media.id);
      expect(media.folder).toBe('test-klasoru');
      expect(media.mimeType).toBe('image/webp');
      expect(media.url).toMatch(/^\/uploads\/test-klasoru\/cig-domates-[a-z0-9]+-[a-f0-9]{6}\.webp$/);
      expect(media.thumbUrl).toMatch(/-thumb\.webp$/);
      expect(media.path).toMatch(/^test-klasoru\//);
      expect(media.width).toBe(64);
      expect(media.height).toBe(48);
      expect(media.size).toBeGreaterThan(0);
      expect(media.alt).toBe('domates');
      expect(media.originalName).toBe('Çiğ Domates.png');
      expect(existsSync(join(uploadsDir, media.path))).toBe(true);
      expect(existsSync(join(uploadsDir, media.thumbPath!))).toBe(true);

      const list = await api('GET', '/admin/media?folder=test-klasoru');
      const body = list.body as AdminMediaList;
      expect(body.total).toBe(1);
      expect(body.items[0]?.id).toBe(media.id);
      expect(body.folders).toContain('test-klasoru');

      // Referans: geçici ürün + ProductImage → 409
      const category = await prisma.category.findFirstOrThrow({ where: { slug: 'boxes' } });
      const product = await prisma.product.create({
        data: { slug: `test-media-${RUN}`, name: 'Medya Test', categoryId: category.id, price: 1, unit: 'adet', description: 'x', status: 'DRAFT' },
      });
      testProductId = product.id;
      const link = await prisma.productImage.create({ data: { productId: product.id, mediaId: media.id, isCover: true } });
      const conflict = await api('DELETE', `/admin/media/${media.id}`);
      expect(conflict.status).toBe(409);
      await prisma.productImage.delete({ where: { id: link.id } });

      const del = await api('DELETE', `/admin/media/${media.id}`);
      expect(del.status).toBe(204);
      expect(existsSync(join(uploadsDir, media.path))).toBe(false);
      expect(existsSync(join(uploadsDir, media.thumbPath!))).toBe(false);
      expect(await prisma.mediaFile.findUnique({ where: { id: media.id } })).toBeNull();
      createdMediaIds.splice(createdMediaIds.indexOf(media.id), 1);
    });

    it('POST /admin/media bozuk PNG → 400', async () => {
      const res = await upload(new Blob([Buffer.from('89504e470d0a1a0a00000000', 'hex')], { type: 'image/png' }), {}, 'bozuk.png');
      expect(res.status).toBe(400);
    });
  } else {
    it('sharp kurulu değil → POST /admin/media 503 (açık mesaj; pnpm --filter @bagdam/api add sharp)', async () => {
      const res = await upload(new Blob([makePng(8, 8)], { type: 'image/png' }), { folder: 'test' });
      expect(res.status).toBe(503);
      expect(String((res.body as ErrorBody).message)).toMatch(/sharp/);
    });
  }
});
