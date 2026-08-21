import { Controller, Get } from '@nestjs/common';
import type { AdminDashboard } from '@bagdam/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

/**
 * DashboardController — `GET /api/v1/admin/dashboard` (ekran 21 "Özet"; F9).
 * Salt okuma (audit yok); ADMIN ve STAFF görebilir.
 */
@Controller('admin/dashboard')
@Roles('ADMIN', 'STAFF')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(): Promise<AdminDashboard> {
    return this.dashboard.get(new Date());
  }
}
