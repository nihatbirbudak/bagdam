import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `POST /admin/media` multipart alanları (`file` dışında): folder?, alt?. Klasör adı serviste slug'lanır. */
export class UploadMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  folder?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;
}
