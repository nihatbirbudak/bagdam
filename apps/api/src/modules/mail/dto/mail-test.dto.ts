import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/** `POST /admin/settings/mail/test {to}` — test şablonu (`mail.test`) verilen adrese gönderilir. */
export class MailTestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(160)
  to!: string;
}
