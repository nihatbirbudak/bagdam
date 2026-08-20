import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../../config/cookie.config';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * CsrfGuard (ADR-0009 double-submit) — global APP_GUARD #3.
 * Yalnız çerezle kimlik taşıyan mutasyonlarda çalışır:
 *  - GET/HEAD/OPTIONS → geç
 *  - @SkipCsrf (login/csrf/refresh/webhook) → geç
 *  - `Authorization: Bearer` varsa → geç (CSRF yalnız tarayıcı çerezi için anlamlı; Bearer çereze düşmez)
 *  - `access_token` çerezi yoksa → geç (oturum yok; anonim public mutasyon — F5 toptan formu vb.)
 *  - aksi: `csrf_token` çerezi == `X-CSRF-Token` başlığı, yoksa 403 `CSRF_INVALID`
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()]);
    if (skip) return true;

    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return true;

    if (!req.cookies?.[ACCESS_COOKIE]) return true;

    const cookieToken = req.cookies[CSRF_COOKIE];
    const rawHeader = req.headers[CSRF_HEADER];
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!cookieToken || !headerToken || !tokensEqual(cookieToken, headerToken)) {
      throw new ForbiddenException({ message: 'Geçersiz CSRF token', error: 'CSRF_INVALID' });
    }
    return true;
  }
}
