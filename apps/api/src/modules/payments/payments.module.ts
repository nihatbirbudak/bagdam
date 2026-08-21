import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { ChargeStrategyResolver, MerchantInitiatedCharge, PaymentLinkCharge } from './charge/charge-strategy';
import { PayController } from './pay.controller';
import { PaymentIssuesController } from './payment-issues.controller';
import { PaymentIssuesService } from './payment-issues.service';
import { PaymentsAdminController } from './payments-admin.controller';
import { PaymentsAdminService } from './payments-admin.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { ManualProvider } from './providers/manual.provider';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { PaytrCallbackController } from './providers/paytr/paytr-callback.controller';
import { PaytrCallbackService } from './providers/paytr/paytr-callback.service';
import { PayTrConfigService } from './providers/paytr/paytr.config';
import { FetchPayTrHttp, PAYTR_HTTP } from './providers/paytr/paytr.http';
import { PayTrProvider } from './providers/paytr/paytr.provider';
import { PaymentSettlementService } from './settlement/payment-settlement.service';

/**
 * PaymentsModule (F7/F8, ADR-0006/0010/0019) — ödeme altyapısı:
 *  - `PaymentProvider` arayüzü + `ManualProvider` (test/geliştirme) + `PayTrProvider` (F8: iFrame token, Durum Sorgu, kayıtlı kart/recurring,
 *    İade, Link API; HTTP `PAYTR_HTTP` enjekte — testlerde mock) + `PaymentProviderFactory` (Setting `payment.provider` → env → manual; iyzico P2)
 *  - `ChargeStrategy`: `MerchantInitiatedCharge` (saklı kart NON3D) · `PaymentLinkCharge` (3DS link, `linkToken`) · `ChargeStrategyResolver`
 *    (F8: `resolve/resolveDefault` Setting commerce.chargeStrategy + payment.storedCardEnabled'a bakar → PAYMENT_LINK'e düşer)
 *  - `PaymentsService`: Payment/Refund yaşam döngüsü (state machine), WebhookEvent idempotency, `GET /pay/:linkToken` bilgisi
 *  - `PaymentSettlementService` (F8): sağlayıcı sonucu → Payment SUCCEEDED/FAILED → Order PAID/PAYMENT_FAILED → abonelik ACTIVE / cycle CHARGED
 *    → PaymentMethod upsert — VARSAYILAN PaymentOutcomeListener (B CheckoutCompletionService kayıt olunca devralır)
 *  - `PaytrCallbackController/Service`: `POST /api/v1/payments/paytr/callback` (@Public @SkipCsrf; IP allowlist + hash + WebhookEvent idempotency)
 *  - `PayController`: public `GET /api/v1/pay/:linkToken` (JSON; PayTR link/iframe sayfası B/C)
 *  - `PaymentIssuesController/Service` (F9/C): `GET /api/v1/admin/payment-issues` (ekran 18) — PAYMENT_FAILED siparişler +
 *    UNPAID/AWAITING_PAYMENT cycle'lar tek listede (salt okuma; eylemler cycles/orders uçlarında)
 *  - `PaymentsAdminController/Service` (F8/E): `POST /api/v1/admin/payments/:id/refund` (ADMIN) → PaymentsService.refund + tam iadede Order REFUNDED
 * Bağımlılıklar: OrdersModule (Order geçişleri; PAID → kupon + order.paid e-postası orada). SubscriptionsModule bu modülü import eder → abonelik servisleri
 * settlement'ta ModuleRef ile tembel çözülür (döngü yok). CacheModule @Global (AppModule) → SettingsService; testlerde register.
 */
@Module({
  imports: [PrismaModule, SettingsModule, OrdersModule],
  controllers: [PayController, PaytrCallbackController, PaymentsAdminController, PaymentIssuesController],
  providers: [
    PaymentsRepository,
    ManualProvider,
    PayTrConfigService,
    { provide: PAYTR_HTTP, useClass: FetchPayTrHttp },
    PayTrProvider,
    PaymentProviderFactory,
    PaymentsService,
    PaymentsAdminService,
    PaymentIssuesService,
    PaymentSettlementService,
    PaytrCallbackService,
    MerchantInitiatedCharge,
    PaymentLinkCharge,
    ChargeStrategyResolver,
  ],
  exports: [
    PaymentsService,
    PaymentProviderFactory,
    ManualProvider,
    PayTrProvider,
    PayTrConfigService,
    PAYTR_HTTP,
    PaymentSettlementService,
    PaytrCallbackService,
    MerchantInitiatedCharge,
    PaymentLinkCharge,
    ChargeStrategyResolver,
    PaymentsRepository,
    PaymentIssuesService,
  ],
})
export class PaymentsModule {}
