import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { MeModule } from '../me/me.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomersAdminController } from './customers-admin.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

/**
 * CustomersModule (F6) — ekran 16 Müşteriler: `/api/v1/admin/customers` (liste · detay · PATCH · anonimleştir).
 * MeModule: detaydaki adres/onay okumaları MeRepository ile (aynı sorgular, tek sahip). AppModule import'u app.module.ts'te.
 */
@Module({
  imports: [PrismaModule, MeModule, OrdersModule], // F8: detayda siparişler (OrdersService.listForUser)
  controllers: [CustomersAdminController],
  providers: [CustomersRepository, CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
