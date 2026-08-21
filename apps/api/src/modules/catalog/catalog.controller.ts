import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { BootstrapPayload, BoxTemplate, BoxTier, Producer, Product } from '@bagdam/shared';
import type { Request, Response } from 'express';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { SlugParamDto } from './dto/slug-param.dto';
import { TemplateQueryDto } from './dto/template-query.dto';

/** Anonim bootstrap: tarayıcı/ara katman 60 s saklayabilir (servis cache'i ile aynı süre). */
const CACHE_ANONYMOUS = 'public, max-age=60';
/** Çerezli (oturumlu) istek: F6'da me/sub dolacağından kişiselleşir → saklanmaz. */
const CACHE_PRIVATE = 'private, no-store';
/** Oturum çerezi (ADR-0009: access_token path=/). */
const SESSION_COOKIE = 'access_token';

type RequestWithCookies = Request & { cookies?: Record<string, unknown>; user?: SessionUser };

/**
 * CatalogController — public katalog uçları (BACKEND-PLANI §3 catalog satırı), önek /api/v1:
 *   GET /bootstrap · /products · /products/:slug · /tiers · /tiers/:slug/template?week= · /producers
 * İnce katman: doğrulama DTO'larda, kurallar CatalogService'te. Admin CRUD (F4) ayrı controller'da.
 * Yanıtlar @bagdam/shared tipleriyle aynı şekildedir; hatalar AllExceptionsFilter JSON zarfı (404/400).
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /**
   * `window.__BAGDAM__` yükü (products.js şekli). Anonimde `Cache-Control: public, max-age=60`;
   * oturum çerezi varsa `private, no-store`. `me` geçerli çerezden (JwtAuthGuard @Public uçta da `req.user`'ı doldurur).
   * `serverNow` her yanıtta tazedir [B49]. `sub` bu uçta null'dır: sayfaların gömülü bootstrap'ında (WebController)
   * dolar; REST istemcisi aboneliği `GET /me/subscription` ile alır (aynı DTO) — katalog modülü abonelik motoruna
   * bağımlı değildir (ADR-0002 modül sınırı).
   */
  @Public()
  @Get('bootstrap')
  async bootstrap(@Req() req: RequestWithCookies, @Res({ passthrough: true }) res: Response): Promise<BootstrapPayload> {
    const hasSession = Boolean(req.cookies?.[SESSION_COOKIE]);
    res.setHeader('Cache-Control', hasSession ? CACHE_PRIVATE : CACHE_ANONYMOUS);
    const user = req.user;
    return this.catalog.getBootstrap({ me: user ? { loggedIn: true, id: user.id, email: user.email, name: user.name } : null });
  }

  @Public()
  @Get('products')
  listProducts(): Promise<Product[]> {
    return this.catalog.listProducts();
  }

  @Public()
  @Get('products/:slug')
  getProduct(@Param() params: SlugParamDto): Promise<Product> {
    return this.catalog.getProduct(params.slug);
  }

  @Public()
  @Get('tiers')
  listTiers(): Promise<BoxTier[]> {
    return this.catalog.listTiers();
  }

  @Public()
  @Get('tiers/:slug/template')
  getTierTemplate(@Param() params: SlugParamDto, @Query() query: TemplateQueryDto): Promise<BoxTemplate> {
    return this.catalog.getTierTemplate(params.slug, query.week);
  }

  @Public()
  @Get('producers')
  listProducers(): Promise<Producer[]> {
    return this.catalog.listProducers();
  }
}
