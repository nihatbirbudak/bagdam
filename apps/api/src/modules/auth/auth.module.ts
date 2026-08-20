import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../common/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ContentModule } from '../content/content.module';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

/**
 * AuthModule (F4/F6) — ADR-0009 kimlik çekirdeği: dto · controller · service · repository · mapper.
 * JwtModule sırsız kaydedilir; access/refresh (ve F6 verify) farklı sır/typ ile AuthService içinde imzalanır/doğrulanır.
 * F6: ContentModule (kayıt onaylarının LegalDocument bağlantısı), MailModule (NOTIFIER: hoş geldin/doğrulama/sıfırlama/
 * parola değişti e-postaları), AuditModule (REGISTER / PASSWORD_RESET satırları controller'dan açıkça yazılır).
 * `AuthService` dışa açılır: JwtAuthGuard (APP_GUARD, AppModule) oturumu bununla çözer.
 */
@Module({
  imports: [PrismaModule, JwtModule.register({}), ContentModule, MailModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService],
  exports: [AuthService],
})
export class AuthModule {}
