import type { UserRole } from '@bagdam/shared';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import type { TokenType } from '../../config/jwt.config';

/**
 * JWT payload (ADR-0009): `{sub:userId, role, email, typ:'access'|'refresh', jti}`.
 * `typ` iki token türünün yer değiştirmesini önler (ayrı sırlarla da imzalanırlar); `jti` her token'ı
 * benzersiz kılar (refresh rotasyonunda eski/yeni ayrımı).
 */
export interface JwtPayload {
  sub: string;
  role: UserRole;
  email: string;
  typ: TokenType;
  jti: string;
  iat?: number;
  exp?: number;
}

/** Login/refresh sonucu — controller çerezleri yazar, gövdede yalnız `user` döner. */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** Oturum çözümleme sonucu (JwtAuthGuard). `reason` istemciye `error` kodu olarak gider. */
export type SessionResolution =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'expired' | 'invalid' | 'inactive' };
