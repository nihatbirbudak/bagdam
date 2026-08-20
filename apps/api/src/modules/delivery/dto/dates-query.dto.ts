import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { ISO_DATE_RE, SLUG_RE, TrimString } from '../../catalog/dto/admin/transforms';

/** Public `GET /delivery/dates?zone=urla&weeks=4` — zone varsayılan `urla`, weeks 1–12 (varsayılan 4). */
export class PublicDeliveryDatesQueryDto {
  @IsOptional()
  @TrimString()
  @Matches(SLUG_RE, { message: 'zone geçersiz' })
  zone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  weeks?: number;
}

/** Admin `GET /admin/delivery/dates?zone=&from=&to=` — from/to YYYY-MM-DD (takvim geçerliliği serviste). */
export class AdminDeliveryDatesQueryDto {
  @IsOptional()
  @TrimString()
  @Matches(SLUG_RE, { message: 'zone geçersiz' })
  zone?: string;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'from YYYY-MM-DD olmalı' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'to YYYY-MM-DD olmalı' })
  to?: string;
}
