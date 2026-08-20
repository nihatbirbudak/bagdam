import { IsString, Matches } from 'class-validator';

/** `:slug` yol parametresi — Product.slug / BoxTier.slug: küçük harf, rakam, tire/alt çizgi, ≤ 80 karakter. */
export class SlugParamDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,79}$/, { message: 'slug küçük harf/rakam/tire olmalı' })
  slug!: string;
}
