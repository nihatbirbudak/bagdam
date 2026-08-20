import { IsString, MaxLength, MinLength } from 'class-validator';
import { TrimString } from '../../catalog/dto/admin/transforms';

/** `POST /admin/orders/:id/notes {adminNote}` — nota `[YYYY-MM-DD HH:mm] metin` satırı EKLENİR (silinmez; telafi kaydı [B19]). */
export class OrderNoteDto {
  @TrimString()
  @IsString()
  @MinLength(1, { message: 'Not boş olamaz' })
  @MaxLength(2000)
  adminNote!: string;
}
