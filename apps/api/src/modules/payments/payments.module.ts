import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { ChargeStrategyResolver, MerchantInitiatedCharge, PaymentLinkCharge } from './charge/charge-strategy';
import { PayController } from './pay.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { ManualProvider } from './providers/manual.provider';
import { PaymentProviderFactory } from './providers/payment-provider.factory';

/**
 * PaymentsModule (F7, ADR-0006/0010) — ödeme altyapısı (UI'siz):
 *  - `PaymentProvider` arayüzü + `ManualProvider` (test/geliştirme) + `PaymentProviderFactory` (Setting `payment.provider` → env → manual; iyzico F8)
 *  - `ChargeStrategy`: `MerchantInitiatedCharge` (saklı kart NON3D) · `PaymentLinkCharge` (3DS link, `linkToken`) · `ChargeStrategyResolver`
 *  - `PaymentsService`: Payment/Refund yaşam döngüsü (state machine), WebhookEvent idempotency, `GET /pay/:linkToken` bilgisi
 *  - `PayController`: public `GET /api/v1/pay/:linkToken` (F7 JSON; F8 CF sayfası)
 * Order/cycle/abonelik geçişleri burada değil (OrdersModule / SubscriptionsModule orkestre eder). F8: iyzico adaptörü + callback/webhook
 * controller'ları + admin `/admin/payments` bu modüle eklenir. CacheModule @Global (AppModule) → SettingsService; testlerde register.
 */
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [PayController],
  providers: [PaymentsRepository, ManualProvider, PaymentProviderFactory, PaymentsService, MerchantInitiatedCharge, PaymentLinkCharge, ChargeStrategyResolver],
  exports: [PaymentsService, PaymentProviderFactory, ManualProvider, MerchantInitiatedCharge, PaymentLinkCharge, ChargeStrategyResolver, PaymentsRepository],
})
export class PaymentsModule {}
