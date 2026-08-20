import { PartialType } from '@nestjs/mapped-types';
import { CONTENT_STATUS_VALUES, type ContentStatus } from '@bagdam/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EmptyToNull, ID_RE, TrimString } from '../../catalog/dto/admin/transforms';
import { POSTS_PUBLIC_MAX_LIMIT } from '../content.constants';
import { POST_SLUG_RE } from './content-params.dto';

/** `GET /posts?limit=3&page=1` (public). */
export class PostsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTS_PUBLIC_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

/** `GET /admin/posts?page&limit&status&q`. */
export class AdminPostQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(CONTENT_STATUS_VALUES)
  status?: ContentStatus;

  @IsOptional()
  @TrimString()
  @IsString()
  @MaxLength(120)
  q?: string;
}

/** `POST /admin/posts` — gunluk.html kartı. HTML alanları (titleHtml/bodyHtml) admin zengin metninden gelir. */
export class CreatePostDto {
  @TrimString()
  @Matches(POST_SLUG_RE, { message: 'slug küçük harf/rakam/tire olmalı (1–120)' })
  slug!: string;

  /** Rozet/tür metni: "Söyleşi", "Mevsim" … */
  @TrimString()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  kind!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  readMinutes?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  titleHtml!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  excerpt?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  bodyHtml!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @Matches(ID_RE, { message: 'coverMediaId geçersiz' })
  coverMediaId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(POST_SLUG_RE, { each: true, message: 'relatedSlugs öğeleri slug olmalı' })
  relatedSlugs?: string[];

  @IsOptional()
  @IsIn(CONTENT_STATUS_VALUES)
  status?: ContentStatus;

  /** ISO 8601; verilmezse yayınlama anında dolar. null → temizle. */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  publishedAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

/** `PUT /admin/posts/:id` — kısmi. */
export class UpdatePostDto extends PartialType(CreatePostDto) {}
