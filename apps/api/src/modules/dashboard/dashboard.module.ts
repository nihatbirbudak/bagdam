import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

/**
 * DashboardModule (F9) — ekran 21 "Özet": `GET /api/v1/admin/dashboard` (ADR-0002 dilimi: controller · service · repository).
 * Yalnız türetilmiş sayımlar okur (Order / Subscription / SubscriptionCycle / DeliveryDate / SubscriptionEvent);
 * hiçbir tabloya yazmaz, başka modüle bağımlı değildir (kendi repository'si — döngü yok).
 */
@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
