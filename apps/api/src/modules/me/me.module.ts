import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { MeController } from './me.controller';
import { MeRepository } from './me.repository';
import { MeService } from './me.service';

/**
 * MeModule (F6) — `/api/v1/me/*`: adres (tek, upsert), onaylar (pazarlama izni), siparişler/kartlar (F8 yer tutucu).
 * ADR-0002 dilimi: dto · controller · service · repository · mapper. `MeRepository` dışa açılır (CustomersModule
 * admin detayında adres/onay okuması için aynı sorguları kullanır).
 */
@Module({
  imports: [PrismaModule],
  controllers: [MeController],
  providers: [MeRepository, MeService],
  exports: [MeService, MeRepository],
})
export class MeModule {}
