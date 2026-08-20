import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_COOKIE } from '../../config/cookie.config';
import { AuthService } from '../../modules/auth/auth.service';
import type { AuthenticatedRequest, AuthMethod } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestContext } from '../request-context';

interface ExtractedToken {
  token: string;
  method: AuthMethod;
}

/**
 * Token kaynağı: `Authorization: Bearer` (açık, testler / ileride mobil) öncelikli; yoksa `access_token` çerezi.
 * Bearer başlığı varsa çereze DÜŞÜLMEZ — geçersiz Bearer ile çerezli oturum kullanılamaz.
 */
export function extractAccessToken(req: AuthenticatedRequest): ExtractedToken | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token ? { token, method: 'bearer' } : null;
  }
  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof cookie === 'string' && cookie.length > 0) {
    return { token: cookie, method: 'cookie' };
  }
  return null;
}

/**
 * JwtAuthGuard (ADR-0009) — global APP_GUARD #2 (Throttler'dan sonra, Csrf/Roles'tan önce).
 * - @Public uçlar: token yoksa/geçersizse anonim geçer; geçerliyse req.user yine dolar (F6: bootstrap `me`).
 * - Diğer uçlar: geçerli access token + DB'de aktif kullanıcı zorunlu → aksi 401
 *   (`error`: TOKEN_EXPIRED → istemci POST /auth/refresh dener; UNAUTHENTICATED → login).
 * Passport yok: @nestjs/jwt ile doğrudan doğrulama (passport-jwt bağımlılığı kurulu değil; gerek de yok).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const extracted = extractAccessToken(req);

    if (!extracted) {
      if (isPublic) return true;
      throw new UnauthorizedException({ message: 'Oturum gerekli', error: 'UNAUTHENTICATED' });
    }

    const session = await this.auth.resolveSession(extracted.token);
    if (session.ok) {
      req.user = session.user;
      req.authMethod = extracted.method;
      const store = RequestContext.get();
      if (store) {
        store.userId = session.user.id;
        store.actorType = session.user.role === 'CUSTOMER' ? 'user' : 'admin';
      }
      return true;
    }

    if (isPublic) return true;
    if (session.reason === 'expired') {
      throw new UnauthorizedException({ message: 'Oturum süresi doldu', error: 'TOKEN_EXPIRED' });
    }
    throw new UnauthorizedException({ message: 'Oturum geçersiz', error: 'UNAUTHENTICATED' });
  }
}
