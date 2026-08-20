import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** GET /api/v1/health — F2'de PrismaModule import edilip DB kontrolü eklenecek. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
