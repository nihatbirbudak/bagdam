import { Logger, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { RequestLoggerInterceptor } from './common/interceptors/request-logger.interceptor';
import { TIMEOUT_MS, TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { PrismaModule } from './common/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ContentModule } from './modules/content/content.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { MeModule } from './modules/me/me.module';
import { MediaModule } from './modules/media/media.module';
import { SettingsModule } from './modules/settings/settings.module';
import { WholesaleModule } from './modules/wholesale/wholesale.module';
import { WebModule } from './web/web.module';

// PM2 cluster: cron job'lar yalnız primary instance'ta (0) ve ENABLE_CRON !== 'false' iken çalışır
// (staging ENABLE_CRON=false — ADR-0011).
const instanceId = process.env.NODE_APP_INSTANCE;
const isPrimaryInstance = !instanceId || instanceId === '0';
const cronEnabled = process.env.ENABLE_CRON !== 'false';
const isSchedulerInstance = isPrimaryInstance && cronEnabled;
new Logger('AppModule').log(
  `instance=${instanceId ?? '-'} scheduler=${isSchedulerInstance ? 'ACTIVE' : 'DISABLED'} (ENABLE_CRON=${process.env.ENABLE_CRON ?? 'true'})`,
);

// Guard sırası (ADR-0015): Throttler → JwtAuth → Csrf → Roles (APP_GUARD dizilimi = çalışma sırası).
// Interceptor sırası: Timeout → RequestLogger → AuditLog (audit yalnız @Audited mutasyonlarında yazar).
@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 5 * 60 * 1000, // varsayılan 5 dakika (ms)
      max: 500, // maksimum cache girişi
    }),
    ...(isSchedulerInstance ? [ScheduleModule.forRoot()] : []),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // 1 dakika penceresi
        limit: 100, // IP başına max 100 istek/dk
      },
    ]),
    PrismaModule, // @Global — PrismaService tüm repository'lerde (F2)
    HealthModule,
    AuthModule, // F4: /api/v1/auth/* (csrf, login, refresh, logout, me) + JwtAuthGuard'ın AuthService'i; F6: register/verify/forgot/reset (MailModule Notifier)
    AuditModule, // F4: AuditService (interceptor) + GET /api/v1/admin/audit-logs
    MailModule, // F6: MailService (SiteContent mail.* şablonları → MailLog → SMTP/DISABLE_MAIL önizleme) + NOTIFIER + /admin/mail-logs + /admin/settings/mail/test
    MeModule, // F6: /api/v1/me/* (adres upsert, onaylar, F8 yer tutucu siparişler/kartlar)
    CustomersModule, // F6: /api/v1/admin/customers (ekran 16: liste/detay/PATCH/anonimleştir)
    CatalogModule, // F3: GET /api/v1/bootstrap + public katalog uçları; WebModule aynı servisi kullanır
    MediaModule, // F4: POST/GET/PATCH/DELETE /api/v1/admin/media (ADMIN/STAFF, @Audited('media')); /uploads statik main.ts'te
    ContentModule, // F5: site-content/posts/legal/consents (+ /admin/*) + sitemap.xml/robots.txt; WebModule ContentService'i kullanır
    SettingsModule, // F5: /api/v1/admin/settings (registry şemalı gruplar, sırlar AES-256-GCM); DeliveryModule Setting'i buradan okur
    DeliveryModule, // F5: /api/v1/delivery/* (public) + /admin/delivery/* (bölge CRUD, tarih üretimi); bootstrap cache'i düşürür
    WholesaleModule, // F5: POST /api/v1/wholesale-leads (3/dk/IP) + /admin/wholesale-leads
    WebModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    { provide: TIMEOUT_MS, useValue: 30_000 },
  ],
})
export class AppModule {}
