import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma.service';
import { APP_VERSION } from '../../config/app-info';

export type DbStatus = 'up' | 'down';

export interface HealthResponse {
  /** db up → ok; db down → degraded (HTTP yine 200; monitör `status`/`db` alanına bakar) */
  status: 'ok' | 'degraded';
  db: DbStatus;
  /** Süreç çalışma süresi (saniye) */
  uptime: number;
  timestamp: string;
  version: string;
  env: string;
  /** Bu isteğin toplam süresi (ms) — DB round-trip dahil */
  responseTimeMs: number;
}

/** DB kontrolü için üst sınır — bağlantı koptuğunda health isteği bu süreden uzun beklemesin. */
const DB_CHECK_TIMEOUT_MS = 3_000;

/**
 * GET /api/v1/health — health-check.sh / CI deploy kapısı / uptime monitör (UA kalıbı).
 * `SELECT 1` ile DB erişimi denenir: db 'up' → status 'ok', 'down' → 'degraded'.
 * Sağlayıcı (SMTP/PSP) kontrolleri yok — onlar ileride admin'e özel uçta (F10).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(): Promise<HealthResponse> {
    const start = Date.now();
    const db = await this.checkDb();
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      env: process.env.NODE_ENV ?? 'development',
      responseTimeMs: Date.now() - start,
    };
  }

  private async checkDb(): Promise<DbStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('db health timeout')), DB_CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
