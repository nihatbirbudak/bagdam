import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule — @Global: her özellik modülünün repository'si PrismaService'i
 * import etmeden enjekte edebilir (UA kalıbı). AppModule'de bir kez import edilir.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
