import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { CouponsModule } from '../coupons/coupons.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CheckoutCompletionService } from './checkout-completion.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';

/**
 * CheckoutModule (F8) — `POST /checkout/quote` + `POST /checkout` (CheckoutService) ve ödeme SONUCU orkestrasyonu
 * (CheckoutCompletionService: PaymentsService'e `PaymentOutcomeListener` olarak kayıt → callback/reconcile → Order PAID/PAYMENT_FAILED,
 * abonelik ACTIVE, saklı kart, kupon, e-posta; `payments:reconcile` → JobsModule).
 * Bağımlılıklar: Pricing (quote+kupon) · Orders (createFromQuote/transition) · Payments (Payment/settle/provider) · Subscriptions
 * (createFromCheckout/activate, CyclesService.cancelSubscription) · Delivery (DeliveryDatesService) · Coupons (redemption) · Settings.
 * Döngü yok: bu modül hepsini import eder, kimse bunu import etmez (JobsModule hariç — Jobs'u kimse import etmez).
 * Sağlayıcı callback'leri (PayTR — A) PaymentsModule'de kalır ve `PaymentsService.settleByConversationId` üzerinden buraya düşer.
 */
@Module({
  imports: [PrismaModule, SettingsModule, PricingModule, OrdersModule, PaymentsModule, SubscriptionsModule, DeliveryModule, CouponsModule],
  controllers: [CheckoutController],
  providers: [CheckoutRepository, CheckoutCompletionService, CheckoutService],
  exports: [CheckoutService, CheckoutCompletionService, CheckoutRepository],
})
export class CheckoutModule {}
