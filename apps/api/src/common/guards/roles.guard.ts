import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard (ADR-0009) — global APP_GUARD #4. `@Roles('ADMIN','STAFF')` handler ya da sınıfta;
 * işaret yoksa geçer. Kullanıcı yoksa 401 (JwtAuthGuard normalde önce yakalar), rol uymuyorsa 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new UnauthorizedException({ message: 'Oturum gerekli', error: 'UNAUTHENTICATED' });
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({ message: 'Bu işlem için yetkiniz yok', error: 'FORBIDDEN_ROLE' });
    }
    return true;
  }
}
