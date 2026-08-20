import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { APP_VERSION } from '../../config/app-info';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  /** Süreç çalışma süresi (saniye) */
  uptime: number;
  timestamp: string;
  version: string;
  env: string;
}

/**
 * GET /api/v1/health — health-check.sh / CI deploy kapısı / uptime monitör.
 * F2'de PrismaService ile `SELECT 1` kontrolü eklenir (db: up|down → status: ok|degraded).
 */
@Controller('health')
export class HealthController {
  @Public()
  @SkipThrottle()
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      env: process.env.NODE_ENV ?? 'development',
    };
  }
}
