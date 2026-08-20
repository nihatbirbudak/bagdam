import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { WholesaleLeadCreated } from '@bagdam/shared';
import type { AuthenticatedRequest } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateWholesaleLeadDto } from './dto/create-lead.dto';
import { WholesaleService } from './wholesale.service';

/** Toptan formu hız sınırı: IP başına 3 istek / dakika (BACKEND-PLANI §3 wholesale "3/dk/IP"); 4. istek 429. */
export const WHOLESALE_THROTTLE = { limit: 3, ttl: 60_000 } as const;

/**
 * WholesaleController — public `POST /api/v1/wholesale-leads` (toptan.hbs formu fetch ile JSON gönderir — C).
 * @Public: anonim; CsrfGuard access çerezi yoksa geçer (oturumlu müşteri F6'da X-CSRF-Token başlığı ekler).
 * 201 {id}. ip = req.ip (nginx arkasında trust proxy — main.ts).
 */
@Controller('wholesale-leads')
@Public()
export class WholesaleController {
  constructor(private readonly wholesale: WholesaleService) {}

  @Post()
  @Throttle({ default: WHOLESALE_THROTTLE })
  create(@Body() dto: CreateWholesaleLeadDto, @Req() req: AuthenticatedRequest): Promise<WholesaleLeadCreated> {
    return this.wholesale.createLead(dto, req.ip ?? req.socket?.remoteAddress ?? null);
  }
}
