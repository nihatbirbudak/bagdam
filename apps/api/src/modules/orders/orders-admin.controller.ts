import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { AdminOrderList, Order } from '@bagdam/shared';
import type { Response } from 'express';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../catalog/dto/admin/id-param.dto';
import { OrderBillingPatchDto } from './dto/order-billing.dto';
import { OrderInvoicePatchDto } from './dto/order-invoice.dto';
import { OrderNoteDto } from './dto/order-notes.dto';
import { OrderStatusPatchDto } from './dto/order-status.dto';
import { AdminOrdersQueryDto } from './dto/orders-query.dto';
import { OrdersService } from './orders.service';

/**
 * OrdersAdminController — `/api/v1/admin/orders` (BACKEND-PLANI §3 orders admin satırı, §4 ekran 17):
 *  GET  /admin/orders?status&kind&from&to&deliveryOn&q&page&limit · GET /admin/orders/export.csv (aynı filtre) · GET /admin/orders/:id
 *  PATCH /admin/orders/:id/status {status,reason?} · POST /admin/orders/:id/notes {adminNote} · PATCH /admin/orders/:id/billing ·
 *  PATCH /admin/orders/:id/invoice {invoiceNo,invoicePdfPath?}
 * Class-level `@Roles('ADMIN','STAFF')` + `@Audited('orders')` (status → UPDATE, notes → CREATE; müşteri alanları interceptor'da redakte).
 * Not: `export.csv` statik rotası `:id`'den ÖNCE tanımlıdır.
 */
@Controller('admin/orders')
@Roles('ADMIN', 'STAFF')
@Audited('orders')
export class OrdersAdminController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: AdminOrdersQueryDto): Promise<AdminOrderList> {
    return this.orders.listAdmin(query);
  }

  /** CSV (UTF-8 BOM, CRLF, virgül) — `Content-Disposition: attachment; filename="siparisler-<tarih>.csv"`. */
  @Get('export.csv')
  async exportCsv(@Query() query: AdminOrdersQueryDto, @Res({ passthrough: true }) res: Response): Promise<string> {
    const csv = await this.orders.exportCsv(query);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="siparisler-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return csv;
  }

  @Get(':id')
  get(@Param() params: IdParamDto): Promise<Order> {
    return this.orders.getAdmin(params.id);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param() params: IdParamDto,
    @Body() dto: OrderStatusPatchDto,
    @CurrentUser('id') actorId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<Order> {
    const result = await this.orders.updateStatusAdmin(params.id, dto.status, dto.reason, actorId);
    setAuditValues(req, {
      entityId: params.id,
      label: `#${result.order.orderNo}`,
      oldValues: { status: result.from },
      newValues: { status: result.to, reason: dto.reason ?? null },
    });
    return result.order;
  }

  @Post(':id/notes')
  @HttpCode(HttpStatus.OK)
  async addNote(@Param() params: IdParamDto, @Body() dto: OrderNoteDto, @Req() req: AuthenticatedRequest): Promise<Order> {
    const order = await this.orders.appendAdminNote(params.id, dto.adminNote);
    setAuditValues(req, { entityId: params.id, label: `#${order.orderNo}`, newValues: { adminNote: dto.adminNote } });
    return order;
  }

  @Patch(':id/billing')
  async patchBilling(@Param() params: IdParamDto, @Body() dto: OrderBillingPatchDto, @Req() req: AuthenticatedRequest): Promise<Order> {
    const order = await this.orders.patchBilling(params.id, dto);
    setAuditValues(req, { entityId: params.id, label: `#${order.orderNo}`, newValues: { billingParty: dto.billingParty } });
    return order;
  }

  @Patch(':id/invoice')
  async patchInvoice(@Param() params: IdParamDto, @Body() dto: OrderInvoicePatchDto, @Req() req: AuthenticatedRequest): Promise<Order> {
    const order = await this.orders.patchInvoice(params.id, dto);
    setAuditValues(req, { entityId: params.id, label: `#${order.orderNo}`, newValues: { invoiceNo: dto.invoiceNo, invoicePdfPath: dto.invoicePdfPath ?? null } });
    return order;
  }
}
