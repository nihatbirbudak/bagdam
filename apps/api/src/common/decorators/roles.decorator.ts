import { SetMetadata } from '@nestjs/common';

/** RolesGuard (F4) için izinli roller: CUSTOMER / STAFF / ADMIN (ADR-0009). */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
