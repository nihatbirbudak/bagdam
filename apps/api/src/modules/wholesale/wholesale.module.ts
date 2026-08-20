import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { WholesaleAdminController } from './wholesale-admin.controller';
import { WholesaleController } from './wholesale.controller';
import { WholesaleRepository } from './wholesale.repository';
import { WholesaleService } from './wholesale.service';

/**
 * WholesaleModule (F5) — toptan talepleri: public form ucu (3/dk/IP) + admin liste/durum (dto · controller · admin.controller ·
 * service · repository · mapper). Bildirim e-postası F6 (Notifier). AppModule import'unu E ekler.
 */
@Module({
  imports: [PrismaModule],
  controllers: [WholesaleController, WholesaleAdminController],
  providers: [WholesaleRepository, WholesaleService],
  exports: [WholesaleService],
})
export class WholesaleModule {}
