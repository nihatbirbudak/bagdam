import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { EmptyToNull, ID_RE, TrimString } from './transforms';

/** `POST /admin/products/:id/images {mediaId, alt?, isCover?}` — ProductImage ↔ MediaFile bağı. */
export class CreateProductImageDto {
  @Matches(ID_RE, { message: 'mediaId geçersiz' })
  mediaId!: string;

  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(160)
  alt?: string | null;

  @IsOptional()
  @IsBoolean()
  isCover?: boolean;
}

/** `PATCH /admin/products/:id/images/:imageId {alt?, isCover?, sortOrder?}` */
export class UpdateProductImageDto {
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_, v) => v !== null)
  @TrimString()
  @IsString()
  @MaxLength(160)
  alt?: string | null;

  @IsOptional()
  @IsBoolean()
  isCover?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}
