import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { OkResponse } from '@bagdam/shared';
import type { Response } from 'express';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import {
  ACCESS_COOKIE,
  accessCookieOptions,
  clearAccessCookieOptions,
  clearRefreshCookieOptions,
  CSRF_COOKIE,
  csrfCookieOptions,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from '../../config/cookie.config';
import { AuditService } from '../audit/audit.service';
import { webUrl } from '../mail/mail.constants';
import { AuthMeDto, AuthUserDto } from './auth.mapper';
import { AuthService } from './auth.service';
import type { IssuedTokens } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { VerifyQueryDto } from './dto/verify-query.dto';

/** Login/refresh gövdesi — token'lar çerezde, gövdede yalnız kullanıcı (ADR-0009; Bearer yalnız testlerde). */
export interface AuthSessionResponse {
  user: AuthUserDto;
}

export interface CsrfResponse {
  csrfToken: string;
}

/** E-posta doğrulama sonucu yönlendirmesi: `?dogrulandi=1` başarı · `?dogrulandi=0` geçersiz/süresi dolmuş (B: bilgi metni). */
export const VERIFY_REDIRECT_PATH = '/uyelik.html?dogrulandi=';

/**
 * AuthController — önek /api/v1/auth (BACKEND-PLANI §3 auth satırı; F4: admin girişi · F6: register/verify/forgot/reset).
 * - csrf/login/refresh/register/forgot/reset: @Public + @SkipCsrf (çerezi kendisi üretir ya da çerezle kimlik taşımaz)
 * - verify: @Public GET → 302 /uyelik.html?dogrulandi=1|0
 * - logout: @Public (access süresi dolmuşsa da çıkış yapılabilir) ama CSRF'e tabi
 * - me / me(PATCH) / me/password: oturum zorunlu (JwtAuthGuard); mutasyonlar CSRF'li ve audit'li
 * Audit: register/reset satırları AuditService ile açıkça yazılır (interceptor fiil haritası register→CREATE verirdi;
 * sözleşme `auth:REGISTER`); e-posta/parola gövdeye girmez.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ── F6: kayıt · doğrulama · parola unuttum/sıfırla ───────────────────────────

  /** 201 {user} + çerezler (anında giriş); KVKK yoksa 400 KVKK_REQUIRED; e-posta varsa 409 EMAIL_TAKEN; 5 istek/dk/IP. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const { user, tokens, consentKinds } = await this.auth.register(dto, requestMeta(req));
    this.setAuthCookies(res, tokens);
    res.cookie(CSRF_COOKIE, this.auth.createCsrfToken(), csrfCookieOptions());
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    req.authMethod = 'cookie';
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'REGISTER',
      module: 'auth',
      entityId: user.id,
      summary: `auth: REGISTER #${user.id}`,
      newValues: { email: '[redacted]', consents: consentKinds, hasName: Boolean(user.name) },
      requestId: req.requestId ?? null,
      ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
    });
    return { user };
  }

  /** E-postadaki bağlantı: token geçerliyse emailVerifiedAt=now → 302 /uyelik.html?dogrulandi=1; değilse ?dogrulandi=0. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('verify')
  async verify(@Query() query: VerifyQueryDto, @Res() res: Response): Promise<void> {
    const ok = await this.auth.verifyEmail(query.token);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(HttpStatus.FOUND, `${webUrl()}${VERIFY_REDIRECT_PATH}${ok ? '1' : '0'}`);
  }

  /** Her zaman 200 {ok:true} (kullanıcı yoksa da — e-posta keşfi yok); 3 istek/dk/IP. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot')
  async forgot(@Body() dto: ForgotPasswordDto): Promise<OkResponse> {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  /** 200 {ok:true} + çerezlerle giriş; geçersiz/süresi dolmuş → 400 RESET_TOKEN_INVALID; diğer oturumlar düşer. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<OkResponse> {
    const { user, tokens } = await this.auth.resetPassword(dto.token, dto.password);
    this.setAuthCookies(res, tokens);
    res.cookie(CSRF_COOKIE, this.auth.createCsrfToken(), csrfCookieOptions());
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    req.authMethod = 'cookie';
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'PASSWORD_RESET',
      module: 'auth',
      entityId: user.id,
      summary: `auth: PASSWORD_RESET #${user.id}`,
      requestId: req.requestId ?? null,
      ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
    });
    return { ok: true };
  }

  /** Double-submit CSRF: çerez `csrf_token` (httpOnly:false) + gövdede aynı değer. */
  @Public()
  @SkipCsrf()
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response): CsrfResponse {
    const csrfToken = this.auth.createCsrfToken();
    res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
    return { csrfToken };
  }

  /** 401 hatalı bilgi · 423 kilitli (5 hata → 30 dk) · 10 istek/dk/IP (nginx login zone ayrıca). */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @Audited('auth')
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const { user, tokens } = await this.auth.login(dto.email, dto.password);
    this.setAuthCookies(res, tokens);
    // Login çerezle birlikte taze CSRF çerezi de verir (ayrı GET /csrf gerekmez)
    res.cookie(CSRF_COOKIE, this.auth.createCsrfToken(), csrfCookieOptions());
    // Audit/log: bu isteğin aktörü artık giriş yapan kullanıcı; satırın entityId'si de kullanıcı
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    req.authMethod = 'cookie';
    setAuditValues(req, { entityId: user.id });
    return { user };
  }

  /** Refresh çerezi (path=/api/v1/auth) ile yeni çift; 401'de çerezler temizlenir. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const token = req.cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    if (!token) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException({ message: 'Oturum bulunamadı', error: 'REFRESH_INVALID' });
    }
    try {
      const { user, tokens } = await this.auth.refresh(token);
      this.setAuthCookies(res, tokens);
      return { user };
    } catch (err) {
      this.clearAuthCookies(res);
      throw err;
    }
  }

  /** 204; çerezler temizlenir, refresh hash'i silinir. Access süresi dolmuşsa refresh çerezinden kullanıcı bulunur. */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @Audited('auth')
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.user?.id, req.cookies?.[REFRESH_COOKIE]);
    if (req.user) setAuditValues(req, { entityId: req.user.id });
    this.clearAuthCookies(res);
  }

  @Get('me')
  me(@CurrentUser('id') userId: string): Promise<AuthMeDto> {
    return this.auth.getMe(userId);
  }

  @Patch('me')
  @Audited('auth')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateMeDto): Promise<AuthMeDto> {
    return this.auth.updateMe(userId, dto);
  }

  /** 204; yeni token çifti çereze yazılır (eski refresh geçersiz). Mevcut parola hatalı → 401. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('me/password')
  @Audited('auth')
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const tokens = await this.auth.changePassword(userId, dto);
    this.setAuthCookies(res, tokens);
  }

  private setAuthCookies(res: Response, tokens: IssuedTokens): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, accessCookieOptions());
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, clearAccessCookieOptions());
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions());
  }
}

/** Onay satırları için ip (trust proxy) + user-agent. */
function requestMeta(req: AuthenticatedRequest): { ip: string | null; userAgent: string | null } {
  const rawUa = req.headers['user-agent'];
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: Array.isArray(rawUa) ? (rawUa[0] ?? null) : (rawUa ?? null),
  };
}
