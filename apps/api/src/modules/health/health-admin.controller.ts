import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { AdminHealthDetailed } from '@bagdam/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { HealthDetailedService } from './health-detailed.service';

/**
 * `GET /api/v1/admin/health/detailed` — ekran 22 sağlık kartı (ADMIN/STAFF).
 * Public `/health` ucu monitör içindir ve sızıntı olmaması için sade kalır; ayrıntı burada.
 */
@Controller('admin/health')
@Roles('ADMIN', 'STAFF')
export class HealthAdminController {
  constructor(private readonly health: HealthDetailedService) {}

  @SkipThrottle()
  @Get('detailed')
  detailed(): Promise<AdminHealthDetailed> {
    return this.health.detailed();
  }
}
