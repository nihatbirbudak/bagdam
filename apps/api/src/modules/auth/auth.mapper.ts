import type { UserRole } from '@bagdam/shared';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import type { MeRow, SessionUserRow } from './auth.repository';

/** `POST /auth/login` / `/refresh` gövdesindeki `user`. */
export interface AuthUserDto {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/** `GET /auth/me` — sözleşme: {id,email,name,role,emailVerifiedAt,createdAt} (+ phone: PATCH /me round-trip için). */
export interface AuthMeDto extends AuthUserDto {
  phone: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

type UserLike = Pick<SessionUserRow, 'id' | 'email' | 'name' | 'role'>;

export function toSessionUser(row: UserLike): SessionUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function toAuthUser(row: UserLike): AuthUserDto {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function toAuthMe(row: MeRow): AuthMeDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: row.role,
    emailVerifiedAt: row.emailVerifiedAt ? row.emailVerifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
