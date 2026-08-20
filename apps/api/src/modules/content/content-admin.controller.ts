import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { AdminLegalGroup, AdminPostList, AdminSiteContentItem, LegalDocument, Post as PostDto } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ContentAdminService } from './content-admin.service';
import { ContentIdParamDto, LegalSlugParamDto, SiteContentKeyParamDto } from './dto/content-params.dto';
import { CreateLegalVersionDto, LegalNavPatchDto, PublishLegalDto, UpdateLegalDto } from './dto/legal.dto';
import { AdminPostQueryDto, CreatePostDto, UpdatePostDto } from './dto/post.dto';
import { UpdateSiteContentDto } from './dto/site-content.dto';

/**
 * ContentAdminController — `/api/v1/admin/*` içerik yönetimi (BACKEND-PLANI §3 content admin satırı, §4 ekran 9–12).
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('content')` (mutasyonlar AuditLog'a; site-content PUT'ta entityId=key).
 * İnce katman: doğrulama DTO'larda, kurallar ContentAdminService'te. Yanıt kodları: POST oluşturma 201 · eylem 200 · DELETE 204.
 */
@Controller('admin')
@Roles('ADMIN', 'STAFF')
@Audited('content')
export class ContentAdminController {
  constructor(private readonly service: ContentAdminService) {}

  // ── Site blokları (ekran 9–10) ──────────────────────────────────────────────

  @Get('site-content')
  listSiteContent(): Promise<AdminSiteContentItem[]> {
    return this.service.listSiteContent();
  }

  @Get('site-content/:key')
  getSiteContent(@Param() params: SiteContentKeyParamDto): Promise<AdminSiteContentItem> {
    return this.service.getSiteContent(params.key);
  }

  /** Şemaya göre doğrular (bilinmeyen alan / zorunlu eksik → 400), upsert eder; updatedBy oturum kullanıcısı. */
  @Put('site-content/:key')
  async updateSiteContent(
    @Param() params: SiteContentKeyParamDto,
    @Body() dto: UpdateSiteContentDto,
    @CurrentUser('id') userId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminSiteContentItem> {
    const item = await this.service.updateSiteContent(params.key, dto.value, userId ?? null);
    setAuditValues(req, { entityId: params.key, label: item.label });
    return item;
  }

  // ── Günlük (ekran 11) ───────────────────────────────────────────────────────

  @Get('posts')
  listPosts(@Query() query: AdminPostQueryDto): Promise<AdminPostList> {
    return this.service.listPosts(query);
  }

  @Get('posts/:id')
  getPost(@Param() params: ContentIdParamDto): Promise<PostDto> {
    return this.service.getPost(params.id);
  }

  @Post('posts')
  createPost(@Body() dto: CreatePostDto): Promise<PostDto> {
    return this.service.createPost(dto);
  }

  @Put('posts/:id')
  updatePost(@Param() params: ContentIdParamDto, @Body() dto: UpdatePostDto): Promise<PostDto> {
    return this.service.updatePost(params.id, dto);
  }

  @Post('posts/:id/publish')
  @HttpCode(HttpStatus.OK)
  publishPost(@Param() params: ContentIdParamDto): Promise<PostDto> {
    return this.service.publishPost(params.id);
  }

  /** Hard delete (Post'ta deletedAt yok). */
  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePost(@Param() params: ContentIdParamDto): Promise<void> {
    return this.service.deletePost(params.id);
  }

  // ── Yasal metinler (ekran 12) ───────────────────────────────────────────────

  /** Slug başına sürümler (yayındaki + taslaklar). */
  @Get('legal')
  listLegal(): Promise<AdminLegalGroup[]> {
    return this.service.listLegal();
  }

  @Get('legal/:id')
  getLegal(@Param() params: ContentIdParamDto): Promise<LegalDocument> {
    return this.service.getLegal(params.id);
  }

  /** Yeni taslak sürüm → 201 (version = max+1, isCurrent=false). */
  @Post('legal/:slug/versions')
  createLegalVersion(@Param() params: LegalSlugParamDto, @Body() dto: CreateLegalVersionDto): Promise<LegalDocument> {
    return this.service.createLegalVersion(params.slug, dto);
  }

  /** Yalnız taslakta; yayındaki sürümde 409. */
  @Put('legal/:id')
  updateLegal(@Param() params: ContentIdParamDto, @Body() dto: UpdateLegalDto): Promise<LegalDocument> {
    return this.service.updateLegal(params.id, dto);
  }

  @Post('legal/:id/publish')
  @HttpCode(HttpStatus.OK)
  publishLegal(@Param() params: ContentIdParamDto, @Body() dto: PublishLegalDto): Promise<LegalDocument> {
    return this.service.publishLegal(params.id, dto);
  }

  @Patch('legal/:id/nav')
  patchLegalNav(@Param() params: ContentIdParamDto, @Body() dto: LegalNavPatchDto): Promise<LegalDocument> {
    return this.service.patchLegalNav(params.id, dto);
  }
}
