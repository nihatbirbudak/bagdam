import { Controller, Get, Header, Query } from '@nestjs/common';
import type { DeliveryDate, DeliveryZonePublic } from '@bagdam/shared';
import { Public } from '../../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';
import { PublicDeliveryDatesQueryDto } from './dto/dates-query.dto';

/**
 * DeliveryController — public `/api/v1/delivery/*` (BACKEND-PLANI §3 delivery satırı [B9][B49]).
 *  - GET /delivery/zones               → aktif bölgeler {id,slug,name,fee,freeThreshold}
 *  - GET /delivery/dates?zone=&weeks=  → [{day,date,cutoffAtIso,locked,full}] (bootstrap deliveryDates ile aynı kaynak)
 * Anonim ve kısa cache'li (60 s; kesim anı yaklaşırken `locked` en çok 60 s gecikir — cart.js kesim hesabını cutoffAtIso'dan yapar).
 */
@Controller('delivery')
@Public()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('zones')
  @Header('Cache-Control', 'public, max-age=60')
  zones(): Promise<DeliveryZonePublic[]> {
    return this.delivery.listPublicZones();
  }

  @Get('dates')
  @Header('Cache-Control', 'public, max-age=60')
  dates(@Query() query: PublicDeliveryDatesQueryDto): Promise<DeliveryDate[]> {
    return this.delivery.getDates(query.zone, query.weeks);
  }
}
