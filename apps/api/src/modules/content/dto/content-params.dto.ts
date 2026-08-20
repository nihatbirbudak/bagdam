import { Type } from 'class-transformer';
import { IsInt, Matches, Min } from 'class-validator';
import { ID_RE } from '../../catalog/dto/admin/transforms';

/** SiteContent.key: `promoBar`, `home.hero`, `urunler.trust` … (harf/rakam/nokta/tire/alt çizgi, ≤ 80). */
export const SITE_CONTENT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
/** Post.slug (≤ 120) ve LegalDocument.slug (≤ 60): küçük harf/rakam/tire. */
export const POST_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
export const LEGAL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** `:id` (cuid). */
export class ContentIdParamDto {
  @Matches(ID_RE, { message: 'id geçersiz' })
  id!: string;
}

/** `:key` — SiteContent anahtarı. */
export class SiteContentKeyParamDto {
  @Matches(SITE_CONTENT_KEY_RE, { message: 'key geçersiz' })
  key!: string;
}

/** `/posts/:slug` */
export class PostSlugParamDto {
  @Matches(POST_SLUG_RE, { message: 'slug küçük harf/rakam/tire olmalı' })
  slug!: string;
}

/** `/legal/:slug` · `/admin/legal/:slug/versions` */
export class LegalSlugParamDto {
  @Matches(LEGAL_SLUG_RE, { message: 'slug küçük harf/rakam/tire olmalı' })
  slug!: string;
}

/** `/legal/:slug/v/:version` */
export class LegalVersionParamsDto extends LegalSlugParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
