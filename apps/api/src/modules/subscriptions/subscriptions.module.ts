import { Module, type DynamicModule, type ModuleMetadata, type Provider } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { MeSubscriptionController } from './controllers/me-subscription.controller';
import { OpsAdminController } from './controllers/ops-admin.controller';
import { SubscriptionsAdminController } from './controllers/subscriptions-admin.controller';
import { CancellationService } from './services/cancellation.service';
import { CyclesService } from './services/cycles.service';
import { ManualCheckoutService } from './services/manual-checkout.service';
import { OpsService } from './services/ops.service';
import { SubscriptionsService } from './services/subscriptions.service';
import { SubscriptionNotifier } from './subscription-notifier';
import { SubscriptionsDepsAdapter } from './subscriptions-deps.adapter';
import { SUBSCRIPTIONS_DEPS } from './subscriptions.deps';
import { SubscriptionsRepository } from './subscriptions.repository';

const CORE_PROVIDERS: Provider[] = [SubscriptionsRepository, SubscriptionNotifier, CyclesService, SubscriptionsService, CancellationService, ManualCheckoutService, OpsService];
const CONTROLLERS = [MeSubscriptionController, SubscriptionsAdminController, OpsAdminController];
const EXPORTS = [SubscriptionsService, CyclesService, CancellationService, ManualCheckoutService, OpsService, SubscriptionNotifier, SubscriptionsRepository, SUBSCRIPTIONS_DEPS];
/** Motorun dış bağımlılıklarını sağlayan modüller (B1 pricing/payments/delivery, B2 orders) — varsayılan adapter bunlara bağlanır. */
const DEPS_MODULES: NonNullable<ModuleMetadata['imports']> = [PricingModule, PaymentsModule, OrdersModule, DeliveryModule];

/**
 * SubscriptionsModule (F7) — abonelik motoru: Subscription / Cycle / CycleItem / Event / Cancellation
 * (dto · controllers (me, admin, ops) · services (subscriptions, cycles, cancellation, manual-checkout) · repository · mapper).
 * Dış bağımlılıklar `SUBSCRIPTIONS_DEPS` kapısından; varsayılan `SubscriptionsDepsAdapter` gerçek F7 servislerine bağlanır:
 *  PricingService (cycleCharge) · DeliveryDatesService (rezerv/iade/tarih) · OrdersService (cycle Order'ları, geçişler) ·
 *  MerchantInitiatedCharge / PaymentLinkCharge / PaymentsService (tahsilat). Tahsilat sağlayıcısı PaymentProviderFactory'den
 *  (Setting payment.provider → env PAYMENT_PROVIDER → manual; iyzico/PayTR F8).
 * `OpsService` (F9): `GET /admin/ops/day-summary` + `POST /admin/ops/bulk-status` (ekran 20/21; toplu geçiş hep-ya-hiç).
 * `ManualCheckoutService`: admin `POST /admin/subscriptions` — ofis/havale siparişi: fiyat (PricingService.quote) → Order (OrdersService) →
 *  MANUAL ödeme (PaymentsService) → Subscription + cycle#1 → aktivasyon (F8 checkout'un sunucu tarafı iskeleti; e2e simülasyonu da bunu kullanır).
 * `withDeps(provider, imports)`: testler/özel kurulumlar için sahte kapı (tek yönlü: kapı imzası `subscriptions.deps.ts`).
 * JobsModule (cron) CyclesService'i kullanır; MeModule'e dokunulmaz (uçlar `/me/subscription*` bu modüldedir).
 */
@Module({
  imports: [PrismaModule, SettingsModule, ...DEPS_MODULES],
  controllers: CONTROLLERS,
  providers: [...CORE_PROVIDERS, SubscriptionsDepsAdapter, { provide: SUBSCRIPTIONS_DEPS, useExisting: SubscriptionsDepsAdapter }],
  exports: [...EXPORTS, SubscriptionsDepsAdapter],
})
export class SubscriptionsModule {
  /** Özel deps sağlayıcısı (ör. test sahtesi) + onun ihtiyaç duyduğu modüller. ManualCheckoutService gerçek servisleri ister → DEPS_MODULES yine import edilir. */
  static withDeps(depsProvider: Provider, imports: ModuleMetadata['imports'] = []): DynamicModule {
    return {
      module: SubscriptionsModule,
      imports: [PrismaModule, SettingsModule, ...DEPS_MODULES, ...imports],
      controllers: CONTROLLERS,
      providers: [...CORE_PROVIDERS, depsProvider],
      exports: EXPORTS,
    };
  }
}
