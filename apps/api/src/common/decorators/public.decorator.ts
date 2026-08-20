import { SetMetadata } from '@nestjs/common';

/** JwtAuthGuard (F4) bu işaretli uçları kimlik doğrulamadan geçirir. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
