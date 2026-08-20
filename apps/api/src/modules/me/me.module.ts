import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { MeController } from './me.controller';
import { MeRepository } from './me.repository';
import { MeService } from './me.service';

/**
 * MeModule (F6) — `/api/v1/me/*`: adres (tek, upsert), onaylar (pazarlama izni), siparişler (F7/B2: OrdersService — gerçek veri),
 * kartlar (F8 yer tutucu). ADR-0002 dilimi: dto · controller · service · repository · mapper. `MeRepository` dışa açılır
 * (CustomersModule admin detayında adres/onay okuması için aynı sorguları kullanır). OrdersModule: `GET /me/orders[/:orderNo]`.
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [MeController],
  providers: [MeRepository, MeService],
  exports: [MeService, MeRepository],
})
export class MeModule {}
