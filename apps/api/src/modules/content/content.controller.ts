import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { ConsentCreated, LegalDocument, PublicPost, PublicPostList } from '@bagdam/shared';
import type { AuthenticatedRequest } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CONSENTS_THROTTLE } from './content.constants';
import { ContentService } from './content.service';
import { CreateConsentDto } from './dto/consent.dto';
import { LegalSlugParamDto, LegalVersionParamsDto, PostSlugParamDto, SiteContentKeyParamDto } from './dto/content-params.dto';
import { PostsQueryDto } from './dto/post.dto';

/**
 * ContentController — public içerik uçları (BACKEND-PLANI §3 content satırı), önek /api/v1:
 *   GET /site-content · /site-content/:key · /posts?limit&page · /posts/:slug · /legal · /legal/:slug · /legal/:slug/v/:version
 *   POST /consents (201 {id})
 * İnce katman: doğrulama DTO'larda, kurallar ContentService'te. Anonim okumalar; consents çerezsizse CSRF'e takılmaz
 * (CsrfGuard access_token yoksa geçer), oturum varsa JwtAuthGuard req.user'ı doldurur → userId kaydedilir.
 */
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  // ── SiteContent ─────────────────────────────────────────────────────────────

  /** Tüm bloklar: `{ key: value }` (ham değerler). */
  @Public()
  @Get('site-content')
  getSiteContentMap(): Promise<Record<string, unknown>> {
    return this.content.getSiteContentMap();
  }

  /** Tek bloğun değeri (ham); yoksa 404. */
  @Public()
  @Get('site-content/:key')
  getSiteContent(@Param() params: SiteContentKeyParamDto): Promise<unknown> {
    return this.content.getSiteContent(params.key);
  }

  // ── Günlük ──────────────────────────────────────────────────────────────────

  /** Yalnız PUBLISHED; publishedAt azalan. */
  @Public()
  @Get('posts')
  listPosts(@Query() query: PostsQueryDto): Promise<PublicPostList> {
    return this.content.getPublishedPosts({ limit: query.limit, page: query.page });
  }

  @Public()
  @Get('posts/:slug')
  getPost(@Param() params: PostSlugParamDto): Promise<PublicPost> {
    return this.content.getPostBySlug(params.slug);
  }

  // ── Yasal ───────────────────────────────────────────────────────────────────

  /** Yayındaki belgeler (isCurrent); `showInNav` alanı nav kararı için dahil; bodyHtml dahil. */
  @Public()
  @Get('legal')
  listLegal(): Promise<LegalDocument[]> {
    return this.content.getCurrentLegalDocuments();
  }

  @Public()
  @Get('legal/:slug')
  getLegal(@Param() params: LegalSlugParamDto): Promise<LegalDocument> {
    return this.content.getLegalBySlug(params.slug);
  }

  @Public()
  @Get('legal/:slug/v/:version')
  getLegalVersion(@Param() params: LegalVersionParamsDto): Promise<LegalDocument> {
    return this.content.getLegalBySlug(params.slug, params.version);
  }

  // ── Onaylar ─────────────────────────────────────────────────────────────────

  /** 201 {id}. ip (trust proxy) + user-agent sunucuda; userId varsa oturumdan. */
  @Public()
  @Throttle({ default: { limit: CONSENTS_THROTTLE.limit, ttl: CONSENTS_THROTTLE.ttl } })
  @Post('consents')
  @HttpCode(HttpStatus.CREATED)
  createConsent(@Body() dto: CreateConsentDto, @Req() req: AuthenticatedRequest): Promise<ConsentCreated> {
    const rawUa = req.headers['user-agent'];
    return this.content.recordConsent(dto, {
      userId: req.user?.id ?? null,
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: Array.isArray(rawUa) ? rawUa[0] ?? null : (rawUa ?? null),
    });
  }
}
