import { Body, Controller, HttpCode, Post, type RawBodyRequest, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../../../common/decorators/public.decorator';
import { SkipCsrf } from '../../../../common/decorators/skip-csrf.decorator';
import { PaytrCallbackService } from './paytr-callback.service';
import { normalizeIp } from './paytr.provider';

/** İstemci IP'si: `req.ip` (main.ts trust proxy 1 → X-Forwarded-For'un son güvenilir hop'u); yoksa XFF ilk değer; yoksa soket. */
export function clientIpOf(req: Request): string | null {
  const direct = typeof req.ip === 'string' && req.ip ? req.ip : null;
  if (direct) return normalizeIp(direct, '');
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  if (first) return normalizeIp(first, '');
  return req.socket?.remoteAddress ? normalizeIp(req.socket.remoteAddress, '') : null;
}

/**
 * PaytrCallbackController — `POST /api/v1/payments/paytr/callback` (ADR-0019; PayTR panelinde tanımlanan bildirim URL'si).
 * @Public (oturum yok) · @SkipCsrf (çerez yok, sunucudan sunucuya) · @SkipThrottle (nginx'te de limit dışı; BACKEND-PLANI §5) ·
 * form-urlencoded gövde; yanıt düz metin ("OK" | "PAYTR notification failed: …"). Mantık PaytrCallbackService'te (ince controller).
 */
@Controller('payments/paytr')
export class PaytrCallbackController {
  constructor(private readonly service: PaytrCallbackService) {}

  @Post('callback')
  @Public()
  @SkipCsrf()
  @SkipThrottle()
  @HttpCode(200)
  async callback(@Req() req: RawBodyRequest<Request>, @Res() res: Response, @Body() body: Record<string, unknown>): Promise<void> {
    const result = await this.service.handle({ body: body ?? {}, rawBody: req.rawBody ?? null, ip: clientIpOf(req) });
    res.status(result.httpStatus).setHeader('Cache-Control', 'no-store');
    res.type('text/plain; charset=utf-8').send(result.text);
  }
}
