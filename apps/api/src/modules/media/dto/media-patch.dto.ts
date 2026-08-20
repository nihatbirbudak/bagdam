import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** `PATCH /admin/media/:id {alt?, folder?}` — alt "" → null (temizle); folder serviste slug'lanır. */
export class MediaPatchDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(160)
  alt?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  folder?: string;
}
