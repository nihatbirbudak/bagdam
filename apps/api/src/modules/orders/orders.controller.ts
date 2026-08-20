import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Order, OrderStatusResponse } from '@bagdam/shared';
import { Audited, setAuditValues } from '../../common/decorators/audit.decorator';
import { AuthenticatedRequest, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { OrderNoParamDto } from './dto/order-no-param.dto';
import { OrdersService } from './orders.service';

/**
 * OrdersController — müşteri uçları `/api/v1/orders/*` (BACKEND-PLANI §3 checkout/orders satırı; oturumlu, @Roles yok):
 *  GET  /orders/:orderNo/status  → {orderNo,status,paymentStatus,subscriptionId} (sepet.html `?siparis=`, F8)
 *  POST /orders/:orderNo/cancel  → Order (yalnız PENDING_PAYMENT | PAID | PAYMENT_FAILED ve kesimden önce; abonelik siparişi 409)
 * Mutasyon CSRF'li + audit'li (`@Audited('orders')` → CANCEL). Sahiplik userId ile; başkasının siparişi 404.
 */
@Controller('orders')
@Audited('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':orderNo/status')
  status(@CurrentUser('id') userId: string, @Param() params: OrderNoParamDto): Promise<OrderStatusResponse> {
    return this.orders.getStatusForUser(userId, params.orderNo);
  }

  @Post(':orderNo/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser('id') userId: string,
    @Param() params: OrderNoParamDto,
    @Body() dto: CancelOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Order> {
    const order = await this.orders.cancelByCustomer(userId, params.orderNo, dto.reason);
    setAuditValues(req, { entityId: order.id, label: `#${order.orderNo}`, newValues: { status: order.status, reason: order.cancelReason } });
    return order;
  }
}
