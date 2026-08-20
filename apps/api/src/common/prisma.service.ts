import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Prisma'nın yayabileceği log olayları (emit: 'event' ile Nest Logger'a yönlendirilir). */
type PrismaLogEvent = 'query' | 'info' | 'warn' | 'error';
const PRISMA_LOG_EVENTS: readonly PrismaLogEvent[] = ['query', 'info', 'warn', 'error'];

function isPrismaLogEvent(value: string): value is PrismaLogEvent {
  return (PRISMA_LOG_EVENTS as readonly string[]).includes(value);
}

/**
 * Log seviyesi ortama göre:
 * - `PRISMA_LOG` env (virgülle: `query,info,warn,error`) verilmişse aynen o
 * - production → warn, error
 * - test       → error
 * - development → info, warn, error (sorgu logu için PRISMA_LOG=query,warn,error)
 */
export function resolvePrismaLogEvents(env: NodeJS.ProcessEnv = process.env): PrismaLogEvent[] {
  const explicit = (env.PRISMA_LOG ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(isPrismaLogEvent);
  if (explicit.length > 0) return Array.from(new Set(explicit));
  switch (env.NODE_ENV) {
    case 'production':
      return ['warn', 'error'];
    case 'test':
      return ['error'];
    default:
      return ['info', 'warn', 'error'];
  }
}

/**
 * PrismaService — Prisma yalnız repository katmanında kullanılır (ADR-0002); bu servis
 * tek PrismaClient örneğini sağlar (PrismaModule @Global).
 *
 * Yaşam döngüsü:
 * - onModuleInit  → $connect (bağlantı hatası bootstrap'ta görünür; lazy-connect sürprizi yok)
 * - onModuleDestroy → $disconnect. `app.enableShutdownHooks()` (main.ts) SIGTERM/SIGINT'te
 *   Nest'in kapanış zincirini çalıştırır → burası tetiklenir. Prisma 5+ ile `$on('beforeExit')`
 *   library engine'de desteklenmediğinden ek kanca gerekmez.
 *
 * Zaman: ADR-0004 — ham SQL'de now()/CURRENT_TIMESTAMP yasak; JS `new Date()` parametre olarak bağlanır.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, PrismaLogEvent>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const events = resolvePrismaLogEvents();
    super({
      log: events.map((level) => ({ level, emit: 'event' as const })),
    });

    // Prisma olaylarını Nest Logger'a yönlendir (stdout'a doğrudan yazmasın; PM2 log biçimi tek olsun)
    if (events.includes('query')) {
      this.$on('query', (e: Prisma.QueryEvent) => {
        this.logger.debug(`${e.query} -- params=${e.params} (${e.duration}ms)`);
      });
    }
    if (events.includes('info')) {
      this.$on('info', (e: Prisma.LogEvent) => this.logger.log(e.message));
    }
    if (events.includes('warn')) {
      this.$on('warn', (e: Prisma.LogEvent) => this.logger.warn(e.message));
    }
    if (events.includes('error')) {
      this.$on('error', (e: Prisma.LogEvent) => this.logger.error(e.message));
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL bağlantısı kuruldu');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('PostgreSQL bağlantısı kapatıldı');
  }
}
