import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@bagdam/shared';
import type { Request } from 'express';

/** Kimlik yöntemi — JwtAuthGuard işaretler; CsrfGuard Bearer'lı istekleri atlar (ADR-0009). */
export type AuthMethod = 'cookie' | 'bearer';

/** `req.user` — JwtAuthGuard'ın DB'den doğrulayıp taktığı oturum kullanıcısı (parola/refresh alanları yok). */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/** Guard'lar/interceptor'lar/controller'lar için istek tipi (express Request + kimlik alanları). */
export interface AuthenticatedRequest extends Request {
  user?: SessionUser;
  authMethod?: AuthMethod;
  requestId?: string;
  cookies: Record<string, string | undefined>;
}

/**
 * `@CurrentUser()` → SessionUser (ya da undefined: @Public uçta anonim istek);
 * `@CurrentUser('id')` → tek alan. UA kalıbı.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof SessionUser | undefined, ctx: ExecutionContext): SessionUser | SessionUser[keyof SessionUser] | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
