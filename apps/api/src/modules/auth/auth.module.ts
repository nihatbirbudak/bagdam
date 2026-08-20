import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../common/prisma.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

/**
 * AuthModule (F4) — ADR-0009 kimlik çekirdeği: dto · controller · service · repository · mapper.
 * JwtModule sırsız kaydedilir; access/refresh farklı sırlarla AuthService içinde imzalanır/doğrulanır.
 * `AuthService` dışa açılır: JwtAuthGuard (APP_GUARD, AppModule) oturumu bununla çözer.
 */
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService],
  exports: [AuthService],
})
export class AuthModule {}
