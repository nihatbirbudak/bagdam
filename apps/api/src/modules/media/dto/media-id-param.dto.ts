import { Matches } from 'class-validator';

/** `:id` yol parametresi (cuid) — yalnız güvenli karakterler. */
export class MediaIdParamDto {
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, { message: 'id geçersiz' })
  id!: string;
}
