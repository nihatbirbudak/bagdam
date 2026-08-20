import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { HealthController } from './health.controller';

/** GET /api/v1/health — PrismaService ile `SELECT 1` DB kontrolü (PrismaModule @Global; açık import okunabilirlik için). */
@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
