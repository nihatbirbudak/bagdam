import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EmptyToNull, ID_RE, ISO_DATE_RE, TrimString } from './transforms';

/** Şablon öğesi `{productId, qtyLabel, isSwappable?}` — sıra dizideki sıradır. */
export class BoxTemplateItemDto {
  @Matches(ID_RE, { message: 'productId geçersiz' })
  productId!: string;

  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  qtyLabel!: string;

  @IsOptional()
  @IsBoolean()
  isSwappable?: boolean;
}

/** `POST /admin/box-templates {tierId, weekStart, curatorName?, items}` — weekStart Pazartesi'ye yuvarlanır; tier+hafta unique → 409. */
export class CreateBoxTemplateDto {
  @Matches(ID_RE, { message: 'tierId geçersiz' })
  tierId!: string;

  @Matches(ISO_DATE_RE, { message: 'weekStart YYYY-MM-DD olmalı' })
  weekStart!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(60)
  curatorName?: string | null;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BoxTemplateItemDto)
  items!: BoxTemplateItemDto[];
}

/** `PUT /admin/box-templates/:id {curatorName?, items?}` */
export class UpdateBoxTemplateDto {
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(60)
  curatorName?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BoxTemplateItemDto)
  items?: BoxTemplateItemDto[];
}

/** `GET /admin/box-templates?tierId&from&to` — from/to weekStart aralığı (YYYY-MM-DD, dahil). */
export class BoxTemplateQueryDto {
  @IsOptional()
  @Matches(ID_RE, { message: 'tierId geçersiz' })
  tierId?: string;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'from YYYY-MM-DD olmalı' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'to YYYY-MM-DD olmalı' })
  to?: string;
}

/** `GET /admin/box-week?week=YYYY-MM-DD` — haftanın herhangi bir günü; yoksa bu hafta. */
export class BoxWeekQueryDto {
  @IsOptional()
  @Matches(ISO_DATE_RE, { message: 'week YYYY-MM-DD olmalı' })
  week?: string;
}
