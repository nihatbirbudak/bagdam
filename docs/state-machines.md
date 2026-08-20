# Bağdam — Durum Makineleri ve Abonelik Motoru Algoritmaları (F0 çıktısı, 2026-08-20)

> **Amaç:** Order / Subscription / SubscriptionCycle / Payment / SubscriptionCancellation durum geçişlerini, tetikleyicileri ve yan etkileri tek yerde sabitlemek; `cycles:ensure`, `cycles:lock-and-charge`, dunning, skip/unskip ve iptal akışını adım adım yazmak. F2 şema yazımı ve F7 motoru bu belgeye göre yapılır.
>
> **Kaynaklar:** [BACKEND-PLANI.md](BACKEND-PLANI.md) §2 (şema), §3 (API/jobs), §5 F7; [ADR-0004](adr/0004-zaman-ve-saat-dilimi.md) zaman, [ADR-0005](adr/0005-kesim-teslimat-kapasite.md) kesim/kapasite, [ADR-0006](adr/0006-tahsilat-ani-ve-stratejisi.md) tahsilat, [ADR-0007](adr/0007-indirim-atlama-retention.md) indirim/atlama/retention, [ADR-0008](adr/0008-abonelik-modeli.md) abonelik modeli, [ADR-0010](adr/0010-odeme-saglayicisi.md) ödeme.
>
> **Kod karşılığı (tek kaynak):** `packages/shared/src/state-machines/{order,subscription,cycle,payment,cancellation}.ts` — `X_TRANSITIONS` tabloları + `X_TRANSITION_EVENTS` olay eşlemesi + `canXTransition / assertXTransition`. Bu belgedeki tablolar o dosyalarla **aynı** olmak zorundadır (bkz. §13). `DOĞRULANMADI` etiketi: plan/ADR'de açıkça yazmayan, F7 tasarım spike'ında onaylanacak geçiş/kural.

**Gösterim:** `from → to | tetikleyici (kim/ne) | yan etkiler`. Yan etki kısaltmaları: **E:** e-posta (MailLog), **SE:** `SubscriptionEvent` (type), **O:** Order, **P:** Payment, **DD:** `DeliveryDate.reserved`.

---

## 0. Genel ilkeler

1. **Durum yazmadan önce** servis `assertXTransition(from, to)` çağırır; geçersiz geçiş → `InvalidTransitionError` → HTTP 409 `{error:'INVALID_TRANSITION'}`. Admin "durum değiştir" ekranları yalnız `nextStates(from)` seçeneklerini gösterir.
2. **Zaman:** tüm anlar `timestamptz`; job'lar `now = new Date()` alıp SQL'e parametre olarak bağlar (`now()` yasak, ADR-0004). Kesim `DeliveryDate.cutoffAt` = teslimat günü − 1 gün 12:00 Europe/Istanbul (ADR-0005). Karşılaştırmalar hep `cutoffAt <= now`.
3. **Tek yazar:** Cron'lar yalnız `NODE_APP_INSTANCE=0`'da ve `ENABLE_CRON=true` iken koşar (staging'de kapalı). Satır kilidi `SELECT … FOR UPDATE SKIP LOCKED`; ödeme idempotency `Payment.conversationId` (unique) + `WebhookEvent` unique.
4. **Snapshot:** Order ödendikten sonra içerik olarak değişmez; cycle kilitlenince fiyatlar cycle/CycleItem'a kopyalanır. Kesim sonrası eklemeler ayrı **DELTA Order**.
5. **Terminal durumlar** geri alınmaz; düzeltme gerekiyorsa yeni kayıt (yeni Order, yeni iptal akışı, yeni Payment).

---

## 1. Order

### 1.1 Durumlar

| Durum | Anlamı |
|---|---|
| `PENDING_PAYMENT` | Checkout/lock'ta oluşturuldu, ödeme bekliyor (başlangıç) |
| `PAID` | Ödeme alındı (`paidAt`), teslimata hazır |
| `PREPARING` | Teslimat günü pick/packing başladı |
| `OUT_FOR_DELIVERY` | Kurye çıktı |
| `DELIVERED` | Teslim edildi |
| `DELIVERY_FAILED` | Adreste bulunamadı / teslim edilemedi |
| `CANCELLED` | İptal (terminal); iade varsa Payment/Refund'da izlenir |
| `REFUNDED` | Ödeme iade edildi (terminal) |
| `PAYMENT_FAILED` | Ödeme başarısız/süresi doldu; yeniden denenebilir |

### 1.2 Geçişler

| from → to | Tetikleyici | Yan etkiler |
|---|---|---|
| PENDING_PAYMENT → PAID | P: SUCCEEDED (callback / webhook / MIT / link) | `paidAt`; abonelik siparişiyse Subscription PENDING→ACTIVE (SE ACTIVATED) ve cycle → CHARGED; PaymentMethod kaydı (registerCard); **E:** sipariş onayı + yasal belge kopyası; DD rezerv zaten checkout'ta |
| PENDING_PAYMENT → PAYMENT_FAILED | P: FAILED / EXPIRED | abonelik PENDING ise kalır (müşteri tekrar deneyebilir); **E:** yok (CF ekranı hatayı gösterir) |
| PENDING_PAYMENT → CANCELLED | müşteri vazgeçti / sistem (checkout zaman aşımı, dunning tükendi) / ops | DD rezerv iade; Subscription PENDING→CANCELLED (SE CANCELLED) |
| PAYMENT_FAILED → PENDING_PAYMENT | yeni ödeme denemesi (yeni Payment: RETRY/LINK) | — |
| PAYMENT_FAILED → CANCELLED | müşteri / sistem / ops | DD rezerv iade; cycle → SKIPPED(UNPAID) ya da CANCELLED (bkz. §3) |
| PAID → PREPARING | ops (ekran 21 toplu durum) | — |
| PAID → CANCELLED | müşteri (kesimden önce, `POST /orders/:no/cancel`) / ops | DD rezerv iade; P: iade başlatılır (→ REFUNDED olunca Order REFUNDED tercih edilir; CANCELLED yalnız iade gerekmeyen/manuel durumlarda — DOĞRULANMADI); abonelik cycle#1 ise cycle CANCELLED + Subscription CANCELLED; **E:** iptal teyidi |
| PAID → REFUNDED | P: REFUNDED (tam iade) | DD rezerv iade; `cancelledAt/cancelReason`; **E:** iade bilgisi |
| PREPARING → OUT_FOR_DELIVERY | ops | **E:** "yola çıktı" (F10) |
| PREPARING → CANCELLED | ops (istisnai) | DD rezerv iade; iade P tarafında |
| OUT_FOR_DELIVERY → DELIVERED | ops | abonelik cycle'ı → DELIVERED; isOneTime → Subscription COMPLETED (SE COMPLETED); **E:** teslim edildi |
| OUT_FOR_DELIVERY → DELIVERY_FAILED | ops | **E:** teslimat başarısız / yeniden planlandı (F10) |
| DELIVERY_FAILED → OUT_FOR_DELIVERY | ops yeniden dağıtım | — |
| DELIVERY_FAILED → CANCELLED | ops | iade P tarafında |
| DELIVERY_FAILED → REFUNDED | P: REFUNDED | — |
| DELIVERED → REFUNDED | admin `POST /admin/payments/:id/refund` (ayıplı ürün / cayma; ≤15 gün) | `adminNote`; **E:** iade bilgisi |

Terminal: `CANCELLED`, `REFUNDED`. Müşteri iptali yalnız `PENDING_PAYMENT | PAID | PAYMENT_FAILED` **ve** `DeliveryDate.cutoffAt > now` iken.

---

## 2. Subscription

### 2.1 Durumlar

| Durum | Anlamı |
|---|---|
| `PENDING` | Checkout'ta oluşturuldu, cycle#1 ödemesi bekleniyor (başlangıç) |
| `ACTIVE` | Canlı; motor cycle üretir ve tahsil eder |
| `PAST_DUE` | 2 ardışık cycle tahsil edilemedi (`failedCycles >= dunning.pastDueAfterUnpaid`); UI "kartını güncelle" |
| `PAUSED` | Duraklatıldı — **şema-var/UI-yok (P2)**; yalnız admin elle |
| `CANCEL_REQUESTED` | Müşteri iptal akışını başlattı, teklif/onay bekleniyor |
| `CANCELLED` | Fesih (terminal) |
| `COMPLETED` | Tek seferlik kutu teslim edildi (terminal) |

### 2.2 Geçişler

| from → to | Tetikleyici (SE) | Yan etkiler |
|---|---|---|
| PENDING → ACTIVE | checkout Order PAID — **ACTIVATED** | `startedAt=now`, `skipsResetAt=startedAt+1y`, `discountBoxesLeft` (ilk-2-kutu hakkı varsa 2→ cycle#1'de 1'e düşer), `User.firstBoxesPromoUsedAt`; cycle#1 → CHARGED (peşin); `chargeStrategy` = Setting'den kopya; **E:** sipariş onayı + abonelik sözleşmesi kopyası |
| PENDING → CANCELLED | checkout ödemesi başarısız kaldı/süresi doldu ya da müşteri vazgeçti — **CANCELLED** | cycle#1 CANCELLED; DD rezerv iade |
| ACTIVE → PAST_DUE | dunning: ardışık 2. cycle SKIPPED(UNPAID) — **UNPAID** | **E:** "abonelik askıda, kartını güncelle"; admin "Ödeme problemleri" listesine düşer |
| ACTIVE → CANCEL_REQUESTED | `POST /me/subscription/cancel` — **CANCEL_REQUESTED** (+ **RETENTION_OFFERED** teklif sunulduysa) | `cancelRequestedAt`; SubscriptionCancellation(PENDING) satırı |
| ACTIVE → CANCELLED | admin doğrudan iptal (akış dışı) — **CANCELLED** | §11 ile aynı yan etkiler |
| ACTIVE → COMPLETED | isOneTime: cycle#1 DELIVERED — **COMPLETED** | `completedAt`; uyelik'te "tek seferlik sipariş tamamlandı" |
| ACTIVE → PAUSED | admin — **PAUSED** (P2, DOĞRULANMADI) | ensure cycle üretmez; SCHEDULED cycle'lar CANCELLED |
| PAST_DUE → ACTIVE | herhangi bir başarılı tahsilat (retry/kesim/admin charge) — **CHARGED** | `failedCycles=0`; **E:** "tahsilat alındı" |
| PAST_DUE → CANCELLED | admin / müşteri (iptal akışı yok: doğrudan confirm) — **CANCELLED** | §11 |
| PAUSED → ACTIVE | admin — **RESUMED** (P2) | ensure yeniden üretir |
| PAUSED → CANCELLED | admin — **CANCELLED** (P2) | §11 |
| CANCEL_REQUESTED → ACTIVE | `…/retention/accept` — **RETENTION_USED** · `…/cancel/abandon` — **RESUMED** (DOĞRULANMADI; `CANCEL_ABANDONED` eklenebilir) | retention: `nextBoxDiscountPct=50`, `User.retentionOfferUsedAt`; cancellation → RETENTION_ACCEPTED / ABANDONED; `cancelRequestedAt=null` |
| CANCEL_REQUESTED → CANCELLED | `…/cancel/confirm` — **CANCELLED** | §11 |

Terminal: `CANCELLED`, `COMPLETED`. Motor (`cycles:ensure`, `lock-and-charge`) yalnız `ACTIVE | PAST_DUE | CANCEL_REQUESTED` abonelikleri işler. "Aynı anda tek abonelik" kontrolünde sayılan durumlar: `PENDING | ACTIVE | PAST_DUE | PAUSED | CANCEL_REQUESTED`.

---

## 3. SubscriptionCycle

### 3.1 Durumlar

| Durum | Anlamı |
|---|---|
| `SCHEDULED` | Planlandı; kesime kadar müşteri düzenler (swap/pref/extras/merge-cart) (başlangıç) |
| `LOCKED` | Kesim geçti; içerik ve fiyat snapshot'landı; tahsilat başlıyor |
| `AWAITING_PAYMENT` | PAYMENT_LINK stratejisi: 3DS ödeme linki gönderildi, `paymentDueAt`'e kadar bekleniyor |
| `SKIPPED` | Teslim edilmeyecek; `skipSource` USER (üye atladı) / OPS / UNPAID (tahsil edilemedi) |
| `CHARGED` | Tahsil edildi (ya da tahsil edilecek tutar 0); teslimata girer |
| `UNPAID` | Tahsilat başarısız; dunning yeniden deneme sürecinde |
| `PREPARING` | Pick/packing (ops) |
| `OUT_FOR_DELIVERY` | Kurye çıktı |
| `DELIVERED` | Teslim edildi (terminal) |
| `CANCELLED` | Abonelik iptali / ops iptali (terminal) |

### 3.2 Geçişler

| from → to | Tetikleyici (SE) | Yan etkiler |
|---|---|---|
| SCHEDULED → LOCKED | `cycles:lock-and-charge`: `cutoffAt <= now` — **LOCKED** | fiyat snapshot (`boxPrice, extrasTotal, discount, shippingFee, total`, item `unitPrice/lotCode`), `lockedAt`; Order üretimi (§8) |
| SCHEDULED → SKIPPED | üye `POST …/skip` (USER) / ops (OPS) — **SKIP** | `skipSource, skippedAt`; USER: `skipsUsed++`; DD rezerv iade; **E:** "bu hafta atlandı" (opsiyonel) |
| SCHEDULED → CANCELLED | abonelik iptali / tek seferlik iptal (kesimden önce) — **CANCELLED** | DD rezerv iade; cycle#1 ise O REFUNDED (peşin iade) |
| SKIPPED → SCHEDULED | üye `DELETE …/skip` (yalnız `skipSource=USER` ve `cutoffAt > now`) — **UNSKIP** | `skipsUsed--` (hak iade), `skippedAt=null, skipSource=null`; DD yeniden rezerv (dolu → 409 `DAY_FULL`) |
| LOCKED → CHARGED | MIT başarılı **ya da** tahsil edilecek tutar 0 (cycle#1, DELTA yok) — **CHARGED** (DELTA'da **DELTA_CHARGED**) | O PAID; `Subscription.failedCycles=0`, `discountBoxesLeft--` (indirim uygulandıysa), `nextBoxDiscountPct=null` (retention kullanıldıysa); PAST_DUE→ACTIVE; **E:** "tahsilat alındı + haftanın kutusu" |
| LOCKED → AWAITING_PAYMENT | PAYMENT_LINK stratejisi — **AWAITING_PAYMENT** | P(kind LINK, linkToken, linkExpiresAt=now+`paymentLinkHours`); `paymentDueAt`; **E:** ödeme linki |
| LOCKED → UNPAID | MIT başarısız — **PAYMENT_FAILED** | P FAILED; O PAYMENT_FAILED; `retryCount=0, nextRetryAt=lockedAt+retryHours[0]`; **E:** "ödeme alınamadı, kartını güncelle" |
| LOCKED → CANCELLED | ops/admin istisnai — **CANCELLED** (DOĞRULANMADI) | O CANCELLED; DD rezerv iade |
| AWAITING_PAYMENT → CHARGED | link ile 3DS ödeme (callback) — **CHARGED** | LOCKED→CHARGED ile aynı |
| AWAITING_PAYMENT → UNPAID | `cycles:expire-payment-links`: `paymentDueAt <= now` — **PAYMENT_FAILED** | P EXPIRED; O PAYMENT_FAILED; dunning §9 |
| AWAITING_PAYMENT → CANCELLED | abonelik iptali — **CANCELLED** | P EXPIRED; O CANCELLED; DD iade |
| UNPAID → CHARGED | `payments:retry` / admin `POST /admin/cycles/:id/charge` / kart güncellendi → anında retry — **RETRY** + **CHARGED** | LOCKED→CHARGED ile aynı; PAST_DUE→ACTIVE |
| UNPAID → SKIPPED | retry hakkı tükendi — **UNPAID** | `skipSource=UNPAID, skippedAt`; O CANCELLED; DD iade; `failedCycles++` → eşikte Subscription PAST_DUE; **E:** "bu haftaki kutu tahsil edilemedi, atlandı" |
| UNPAID → CANCELLED | abonelik iptali — **CANCELLED** (DOĞRULANMADI) | O CANCELLED; DD iade |
| CHARGED → PREPARING | ops (ekran 21) | O PREPARING (aynı ops eylemi iki kaydı birlikte ilerletir) |
| PREPARING → OUT_FOR_DELIVERY | ops | O OUT_FOR_DELIVERY; **E:** yola çıktı |
| OUT_FOR_DELIVERY → DELIVERED | ops | O DELIVERED; isOneTime → Subscription COMPLETED (**COMPLETED**); **E:** teslim edildi |

Terminal: `DELIVERED`, `CANCELLED`. `SKIPPED(OPS/UNPAID)` fiilen terminaldir (UNSKIP yalnız USER). Ops akışında "teslim edilemedi" cycle'da ayrı durum değildir: O DELIVERY_FAILED'a geçer, cycle OUT_FOR_DELIVERY'de kalır; yeniden dağıtım O üzerinden, telafi §6.

---

## 4. Payment

### 4.1 Durumlar

| Durum | Anlamı |
|---|---|
| `PENDING` | Oluşturuldu; sağlayıcıya gidiyor (başlangıç) |
| `REQUIRES_3DS` | Checkout Form / ödeme linki açıldı, 3DS doğrulaması bekleniyor |
| `SUCCEEDED` | Tahsil edildi (`paidAt`, `providerPaymentId`) |
| `FAILED` | Sağlayıcı reddetti (`failureCode/Message`) (terminal) |
| `EXPIRED` | Link/CF oturumu süresi doldu (terminal) |
| `PARTIAL_REFUNDED` | Kısmi iade yapıldı |
| `REFUNDED` | Tam iade (terminal) |

### 4.2 Geçişler

| from → to | Tetikleyici | Yan etkiler |
|---|---|---|
| PENDING → REQUIRES_3DS | CF init başarılı / `GET /pay/:linkToken` açıldı | `providerToken` |
| PENDING → SUCCEEDED | MIT (NON3D saklı kart) yanıtı başarılı / ManualProvider | O PAID (+ cycle CHARGED) |
| PENDING → FAILED | MIT yanıtı başarısız / CF init hatası | O PAYMENT_FAILED (+ cycle UNPAID) |
| PENDING → EXPIRED | link süresi doldu (link hiç açılmadı) / checkout zaman aşımı | O PAYMENT_FAILED; cycle UNPAID |
| REQUIRES_3DS → SUCCEEDED | callback/webhook `SUCCESS` (idempotent: `conversationId` + `payments_provider_pid_succeeded`) | O PAID; PaymentMethod kaydı |
| REQUIRES_3DS → FAILED | callback/webhook `FAILURE` | O PAYMENT_FAILED |
| REQUIRES_3DS → EXPIRED | `cycles:expire-payment-links` / checkout zaman aşımı | O PAYMENT_FAILED |
| SUCCEEDED → PARTIAL_REFUNDED | admin refund, toplam < amount | Refund satırı; O değişmez (adminNote) |
| SUCCEEDED → REFUNDED | admin refund, toplam = amount | O REFUNDED |
| PARTIAL_REFUNDED → REFUNDED | ek refund ile toplam = amount | O REFUNDED (DOĞRULANMADI: ek kısmi iadeler durumu değiştirmez, yalnız Refund satırı) |

Webhook çift teslimi: `WebhookEvent @@unique(provider,eventType,providerRef)` → ikinci teslim `IGNORED`; durum geçişi uygulanmaz.

---

## 5. SubscriptionCancellation (iptal akışı)

| Durum | Anlamı |
|---|---|
| `PENDING` | Akış açık: teklif gösterildi / onay bekleniyor (başlangıç) |
| `RETENTION_ACCEPTED` | Kalma teklifi kabul edildi (terminal) |
| `CANCELLED` | Fesih onaylandı (terminal) |
| `ABANDONED` | Vazgeçildi / zaman aşımı (terminal) |

| from → to | Tetikleyici | Yan etkiler |
|---|---|---|
| PENDING → RETENTION_ACCEPTED | `POST …/retention/accept` (yalnız `retentionOffered=true`) | Subscription → ACTIVE (SE RETENTION_USED); `nextBoxDiscountPct=50`; `User.retentionOfferUsedAt` |
| PENDING → CANCELLED | `POST …/cancel/confirm` | `confirmedAt, effectiveAt (≤ requestedAt+7g), refundAmount, refundDueAt (≤ effectiveAt+15g)`; Subscription → CANCELLED (§11) |
| PENDING → ABANDONED | `POST …/cancel/abandon` **ya da** 24 s sonra otomatik (DOĞRULANMADI — job yok, öneri: `subscriptions:abandon-stale-cancels` saatlik) | Subscription → ACTIVE (SE RESUMED/—) |

Her akış yeni satır (1:N). Teklif kuralı: `retentionOffered = (User.retentionOfferUsedAt == null)`; sunulduğu anda `retentionOfferUsedAt=now` yazılır (prototipteki `bahceden_retention_offered` davranışı: **ilk akışta işaretlenir, kabul edilmese de ikinci kez çıkmaz** — DOĞRULANMADI: "sunuldu" mu "kullanıldı" mı).

---

## 6. Özel kurallar (tek liste)

| # | Kural | Kaynak | Uygulama noktası |
|---|---|---|---|
| 1 | **cycle#1 atlanamaz** (`firstCycleSkippable=false`) | ADR-0006 | `POST …/skip` guard: `cycleNo>1` |
| 2 | **cycle#1 peşin**: checkout'ta ödenir (`prepaidAmount`); kesimde yalnız fark **DELTA Order** | ADR-0006 | §8 adım 5 |
| 3 | **Kilitlenmiş cycle teslim edilir**: iptal LOCKED+ cycle'ları etkilemez | ADR-0007 | §11 |
| 4 | **UNPAID×2 → PAST_DUE**: ardışık `failedCycles >= dunning.pastDueAfterUnpaid (2)`; başarılı tahsilatta sayaç 0 | ADR-0006 | §9 |
| 5 | **Dunning takvimi** `retryHours [24,72]` (lockedAt'e göre); tükenince SKIPPED(UNPAID) | ADR-0006 | §9 (+ açık soru #1) |
| 6 | **Atlama yılda 1** (`skipsPerYear`), un-skip hak iade eder; sayaç `startedAt` yıl dönümünde sıfırlanır (`skipsResetAt`) | ADR-0007 | §10 |
| 7 | **Retention 1 kez** (üye başına, `User.retentionOfferUsedAt`); %50, 1 kutu | ADR-0007 | §5, §11 |
| 8 | **Fesih ≤ 7 gün, iade ≤ 15 gün** (`effectiveAt`, `refundDueAt`) | ADR-0007 | §11 |
| 9 | **İlk 2 kutu %50** otomatik, üye başına 1 abonelik (`User.firstBoxesPromoUsedAt`, `discountBoxesLeft`); `Order.discountTotal`'a yansır | ADR-0007 | §8 adım 3 |
| 10 | **İçerik = yayınlanmış BoxTemplate**; şablon yoksa cycle üretilmez + ops uyarısı | ADR-0008 | §7 |
| 11 | **Kalıcı olan yalnız `itemPrefs`**; swap/extras/pref o cycle'a | ADR-0008 | `PATCH cycles/current` |
| 12 | **Tek seferlik kutu = Subscription(isOneTime)**, tek cycle; DELIVERED → COMPLETED; ensure yeni cycle üretmez | ADR-0008 | §12 |
| 13 | **Aynı anda tek abonelik** (tek seferlik dahil) | ADR-0008 | checkout guard |
| 14 | **Canlı modda tier/type değişmez**; freq/gün/adres/kart PATCH; değişiklik yalnız SCHEDULED (kesimi geçmemiş) cycle'lara yansır | ADR-0008 | `PATCH /me/subscription` |
| 15 | **Kargo**: abonelik Order'larında 0; tek seferlik kutu/tekil üründe zone kuralı (`fee`, `freeThreshold`) | ADR-0005 | PricingService |
| 16 | **Kapasite**: cycle oluştururken DD atomik rezerv; dolu → cycle üretilmez + uyarı (abone için), checkout'ta 409 `DAY_FULL` | ADR-0005 | §7 adım 5 |
| 17 | **Telafi (ayıplı ürün)** MVP'de manuel: `POST /admin/cycles/:id/compensate` → sonraki SCHEDULED cycle'a EXTRA `unitPrice 0` satırı; ya da iade | ADR-0008 | admin |
| 18 | **DELTA tahsil edilemezse** (cycle#1): ekstralar cycle'dan düşer (SE EXTRA_REMOVED), kutu peşin olduğundan cycle CHARGED, delta Order CANCELLED, **E** bilgi — DOĞRULANMADI | — | §8 adım 6 |
| 19 | **PAST_DUE'de motor durmaz**: ensure cycle üretmeye, lock-and-charge denemeye devam eder (kart güncellenince ilk başarılı tahsilat ACTIVE'e döndürür); otomatik iptal yok (açık soru #3) | — | §9 |

---

## 7. `cycles:ensure` (saatlik)

**Amaç:** Her canlı aboneliğin önünde, yayınlanmış şablonu olan haftalar için ileriye `cyclesAhead` (önerilen 2; Setting `commerce.cyclesAhead` — listede yok, açık soru #5) adet SCHEDULED cycle bulunsun.

```
now = new Date(); stats = {created:0, skippedNoTemplate:0, skippedNoDate:0, skippedFull:0}
subs = SELECT * FROM subscriptions
       WHERE status IN ('ACTIVE','PAST_DUE','CANCEL_REQUESTED') AND is_one_time = false
       ORDER BY id  (200'lük sayfalarla)
for each sub (ayrı $transaction; SELECT … FROM subscriptions WHERE id=$1 FOR UPDATE):
  1. cycles = sub'ın cycle'ları (cycleNo DESC); last = cycles[0]   // cycle#1 checkout'ta yaratıldı, en az 1 var
     openFuture = cycles.filter(c => c.status IN ('SCHEDULED','SKIPPED') AND c.deliveryDate.cutoffAt > now)
  2. while openFuture.length < cyclesAhead:
     a. Hedef hafta: weekStart(last.deliveryDate.date) + frequencyWeeks hafta (ISO hafta, Pazartesi)
        → D = o haftanın sub.deliveryDay günü  (gün değiştiyse yeni gün o haftada uygulanır;
          SKIPPED cycle da bir "hafta" sayılır: atlanan haftanın üstüne frekans eklenir)
        Koruma: cutoffAt(D) <= now ise (gecikmiş üretim) D'yi frekans kadar ileri al ve devam et.
     b. dd = SELECT … FROM delivery_dates WHERE zone_id=sub.zoneId AND date=D
        yoksa → stats.skippedNoDate++, SystemLog WARN 'cycles:ensure' (fingerprint zone+D), break
        (delivery-dates:generate 8 hafta üretir; normalde vardır)
     c. dd.status != OPEN → break (kapalı gün; ops gün açınca sonraki saatte üretilir)
     d. tpl = SELECT … FROM box_templates WHERE tier_id=sub.tierId AND week_start=weekStart(D) AND status='PUBLISHED'
        yoksa → stats.skippedNoTemplate++, SystemLog WARN (fingerprint tier+weekStart, günde 1 digest) , break
        // ADR-0008: şablon yoksa cycle ÜRETİLMEZ + ops uyarısı (admin dashboard "Haftanın kutusu eksik")
     e. Rezerv: UPDATE delivery_dates SET reserved=reserved+1 WHERE id=dd.id AND reserved<capacity  → 0 satır ise
        stats.skippedFull++, SystemLog WARN, break
     f. INSERT subscription_cycles (subscriptionId, cycleNo=last.cycleNo+1, deliveryDateId=dd.id, status=SCHEDULED, prepaidAmount=0)
        INSERT cycle_items: tpl.items sırasıyla → {source:TEMPLATE, productId, lotId=ürünün isCurrent lot'u,
          lotCode, pref = sub.itemPrefs[product.slug] ?? prefOptions[prefDefault] ?? null, qty 1, unit, label=qtyLabel}
        (unique (subscriptionId,cycleNo) → yarışta ikinci ekleme hata verir, yakalanır ve yok sayılır)
     g. last = yeni cycle; openFuture.push(last); stats.created++
        SubscriptionEvent: YOK (cycle satırı kayıttır) — açık soru #6: CYCLE_CREATED eklensin mi
  3. sub.nextDeliveryOn / nextCutoffAt = en erken SCHEDULED|SKIPPED|LOCKED|AWAITING_PAYMENT|UNPAID cycle'ın tarih/kesimi
CronLog(name 'cycles:ensure', itemsProcessed, details=stats)
```

Notlar: Şablon sonradan yayınlanınca bir sonraki saatte cycle üretilir; kesime çok yakın yayınlanan şablon için adım 2a koruması devreye girer (o hafta kaçtıysa bir sonraki hafta). İçerik sonradan değişirse (şablon düzenlendi) SCHEDULED cycle'lar **güncellenmez** (müşteri swap yapmış olabilir) — açık soru #7.

---

## 8. `cycles:lock-and-charge` (5 dk)

```
now = new Date()
loop (en çok 20 tur × 50 satır):
  $transaction:
    rows = SELECT c.id FROM subscription_cycles c JOIN delivery_dates d ON d.id=c.delivery_date_id
           WHERE c.status='SCHEDULED' AND d.cutoff_at <= $1          -- $1 = now (bound Date; now() YASAK)
           ORDER BY d.cutoff_at LIMIT 50 FOR UPDATE OF c SKIP LOCKED
    for each cycle:
      1. sub = cycle.subscription (FOR UPDATE). sub.status ∉ {ACTIVE,PAST_DUE,CANCEL_REQUESTED}
         → cycle CANCELLED (DD iade), continue.   (CANCEL_REQUESTED: kesim normal işler — kilitli cycle teslim edilir)
      2. Snapshot (PricingService.quoteCycle): boxPrice=tier.price (lock anındaki fiyat);
         extrasTotal=Σ roundExtraPrice(product.price, qty) [EXTRA+CART_MERGE];
         discount = discountBoxesLeft>0 ? boxPrice×firstBoxDiscount.pct% : (nextBoxDiscountPct ? boxPrice×pct% : 0)
                    (cycle#1'de indirim checkout quote'unda zaten uygulandı, discountBoxesLeft checkout'ta 2→1 düşmüş olur);
         shippingFee=0 (abonelik; tek seferlik kutu: zone kuralı); total=boxPrice+extrasTotal−discount+shippingFee
         → cycle.{boxPrice,extrasTotal,discount,shippingFee,total,lockedAt=now}, item.{unitPrice,lotCode}; status LOCKED; SE LOCKED
      3. due = total − prepaidAmount   (cycle#1: peşin ödendi → yalnız DELTA; cycle#n: prepaidAmount=0 → tümü)
      4. due <= 0 → cycle CHARGED (SE CHARGED, amount 0); continue   // cycle#1 ekstra yok
      5. Order:
         - cycle#1 (orderId dolu): yeni Order(kind=sub.isOneTime?BOX_ONE_TIME:SUBSCRIPTION, lines=EXTRA satırları, grandTotal=due) → cycle.deltaOrderId; PaymentKind DELTA
         - cycle#n: yeni Order(kind SUBSCRIPTION, BOX satırı [metadata.items snapshot] + EXTRA satırları, discountTotal, shippingFee 0, grandTotal=due,
           addressSnapshot=sub.address, customer*=user, deliveryDateId/deliveryDay/deliveryOn=dd) → cycle.orderId; PaymentKind CYCLE_CHARGE
      6. ChargeStrategy = sub.chargeStrategy:
         MERCHANT_INITIATED (saklı kart var):
            P(kind, conversationId=`cyc_${cycle.id}_1`, isMerchantInitiated=true, is3ds=false, paymentMethodId) → provider.chargeStoredCard
            SUCCEEDED → O PAID, cycle CHARGED (SE CHARGED | DELTA_CHARGED), failedCycles=0, discountBoxesLeft−−/nextBoxDiscountPct=null, PAST_DUE→ACTIVE; E tahsilat+kutu içeriği
            FAILED    → P FAILED, O PAYMENT_FAILED, cycle UNPAID (SE PAYMENT_FAILED), retryCount=0, nextRetryAt=lockedAt+retryHours[0]h; E kartını güncelle
            (saklı kart yoksa → PAYMENT_LINK'e düş — DOĞRULANMADI)
         PAYMENT_LINK:
            P(kind LINK, linkToken=random 32B hex, linkExpiresAt=now+paymentLinkHours h, is3ds=true) → cycle AWAITING_PAYMENT (paymentDueAt=linkExpiresAt), SE AWAITING_PAYMENT; E ödeme linki (/pay/:linkToken)
            callback SUCCESS → P SUCCEEDED, O PAID, cycle CHARGED (+ PaymentMethod kaydı varsa sub.paymentMethodId güncellenir, SE CARD_UPDATED)
            `cycles:expire-payment-links` (5 dk): AWAITING_PAYMENT AND payment_due_at <= $1 → P EXPIRED, O PAYMENT_FAILED, cycle UNPAID (SE PAYMENT_FAILED) → §9
      7. cycle#1 DELTA başarısız → kural #18.
  CronLog('cycles:lock-and-charge', itemsProcessed, errors, details={charged, awaiting, unpaid, cancelled})
```

Çift çalışma koruması: tek instance + `SKIP LOCKED` + `Payment.conversationId` unique (aynı cycle/attempt ikinci kez tahsil edilemez). Sağlayıcı zaman aşımı: P PENDING kalır, `payments:reconcile` (açık soru #8) ya da webhook ile kapanır.

---

## 9. Dunning (`payments:retry`, 15 dk) ve PAST_DUE

```
now = new Date(); cfg = Setting commerce.dunning {retryHours:[24,72], pastDueAfterUnpaid:2}
rows = SELECT … FROM subscription_cycles WHERE status='UNPAID' AND next_retry_at <= $1 FOR UPDATE SKIP LOCKED
for each cycle:
  attempt = cycle.retryCount + 1
  MIT: P(kind RETRY, conversationId=`cyc_${id}_${attempt+1}`, attemptNo=attempt+1) → chargeStoredCard
  LINK (ya da saklı kart yok): now >= teslimat günü 08:00 (sınır, §14 #1) → cycle SKIPPED(UNPAID) (aşağıdaki FAILED/tükendi yolu ile aynı);
        değilse eski açık linkler EXPIRED + yeni P(kind LINK, `lnk_<cycleId>_<n>`) + yeni link e-postası; cycle UNPAID kalır,
        nextRetryAt = min(link süresi, lockedAt + retryHours[i], 08:00 sınırı) (F7 E: uygulandı)
  SE RETRY
  SUCCEEDED → cycle CHARGED (SE CHARGED), O PAID, failedCycles=0, PAST_DUE→ACTIVE; E tahsilat alındı
  FAILED    → retryCount=attempt
              retryCount < retryHours.length VE lockedAt + retryHours[retryCount] h <= teslimat günü 08:00 → nextRetryAt = o an
              else → cycle SKIPPED(skipSource=UNPAID, skippedAt=now) (SE UNPAID), O CANCELLED, DD iade,
                     sub.failedCycles++ ; failedCycles >= pastDueAfterUnpaid → sub PAST_DUE (SE UNPAID); E "kutu atlandı" / "abonelik askıda"
Kart güncellendi (PATCH /me/subscription {paymentMethodId} → SE CARD_UPDATED; F8: POST /me/cards/add-session → PaymentMethod): açık UNPAID cycle varsa nextRetryAt=now (anında retry).
PAST_DUE'de motor çalışmaya devam eder (kural #19); sonraki başarılı tahsilat → ACTIVE.
```

**Teslimat sınırı (KARAR, §14 #1):** kesim teslimat günü−1 12:00 → +24 s = teslimat günü 12:00, +72 s = teslimat günü+2 — varsayılan `[24,72]` ile denemeler teslimat gününü aşar; **ödenmeyen kutu teslim edilmez** ilkesi gereği denemeler teslimat günü **08:00 Europe/Istanbul** ile sınırlandı (`DUNNING_RETRY_DEADLINE_TIME`, `dunningDeadlineFor`): sınırı aşan deneme atlanır, cycle hemen SKIPPED(UNPAID). Varsayılan ayarla kesimdeki ilk başarısız MIT tahsilatı doğrudan SKIPPED(UNPAID) olur (reason `retry_after_deadline`); lansman için admin'den `commerce.dunning.retryHours = [2,12]` (ya da `[2,8]`) önerilir — e2e F7 bu değerle koştu (+2 s ve +12 s denemeleri, ardından SKIPPED). Durum makinesi değişmedi.

---

## 10. Skip / unskip

| Adım | `POST /me/subscription/cycles/current/skip` | `DELETE /me/subscription/cycles/current/skip` |
|---|---|---|
| Ön koşul | cycle SCHEDULED, `cutoffAt > now`, `cycleNo > 1` (kural #1), `skipsUsed < skipsPerYear` (önce yıl sıfırlama: `skipsResetAt <= now` → `skipsUsed=0, skipsResetAt += 1y`) | cycle SKIPPED, `skipSource=USER`, `cutoffAt > now` |
| Geçiş | SCHEDULED → SKIPPED (SE SKIP) | SKIPPED → SCHEDULED (SE UNSKIP) |
| Yan etki | `skipsUsed++`, `skipSource=USER, skippedAt`; DD rezerv iade; sonraki cycle ensure'da zaten var/üretilir; ekstralar cycle'da kalır (atlanan hafta tahsil edilmez) | `skipsUsed--` (hak iade); DD yeniden rezerv → dolu ise 409 `DAY_FULL`; `skippedAt=null, skipSource=null` |
| Frontend | `sub.skipThisWeek=true`, `sub.skipUsed = skipsUsed>=skipsPerYear` | `sub.skipThisWeek=false`, `skipUsed=false` |

Kesimden sonra atlama yok (cycle LOCKED). Atlanan hafta: `lock-and-charge` SKIPPED cycle'a dokunmaz (sorgu yalnız SCHEDULED). Ops atlaması (`PATCH /admin/cycles/:id/status` SKIPPED, `skipSource=OPS`) üyenin hakkını harcamaz.

---

## 11. İptal akışı (confirm yan etkileri)

1. `POST /me/subscription/cancel {reason, note}` — Subscription ACTIVE (PAST_DUE için DOĞRULANMADI; öneri: izin ver, teklif yok) → CANCEL_REQUESTED; Cancellation(PENDING, retentionOffered = `User.retentionOfferUsedAt == null`); SE CANCEL_REQUESTED (+ RETENTION_OFFERED); yanıt `{offer:{pct:50,boxes:1}|null}`.
2. `…/retention/accept` → §5; `…/cancel/abandon` → §5.
3. `…/cancel/confirm`:
   - Cancellation → CANCELLED (`confirmedAt=now`), `effectiveAt = max(now, en geç LOCKED+ cycle'ın teslimat günü)` ≤ `requestedAt+7g` (kilitli cycle teslim edilir — kural #3; haftalık akışta ≤ 6 gün).
   - SCHEDULED ve SKIPPED(USER) gelecek cycle'lar → CANCELLED, DD rezerv iade. LOCKED/AWAITING_PAYMENT/UNPAID/CHARGED/PREPARING/OUT_FOR_DELIVERY cycle'lar **devam eder** (AWAITING_PAYMENT/UNPAID için: link/retry devam; tahsil edilemezse SKIPPED(UNPAID) — DOĞRULANMADI, alternatif: CANCELLED).
   - cycle#1 henüz kesilmemişse (SCHEDULED, peşin ödenmiş): cycle CANCELLED, O PAID→REFUNDED, `refundAmount=prepaidAmount`, `refundDueAt = now+14g` (≤15). Aksi hâlde `refundAmount=0`.
   - Subscription → CANCELLED (`cancelledAt=now`), SE CANCELLED; `nextDeliveryOn/nextCutoffAt=null`; **E:** iptal teyidi (effectiveAt, varsa iade tutarı/tarihi).
   - `User.firstBoxesPromoUsedAt` geri alınmaz (hak tek abonelik için).
4. Admin doğrudan iptal (`PATCH /admin/subscriptions/:id {status:CANCELLED, note}`) aynı yan etkilerle; Cancellation satırı `reason=OTHER, reasonText=note, outcome=CANCELLED` olarak yazılır.

---

## 12. Tek seferlik kutu (`isOneTime`)

- Checkout: Order(kind BOX_ONE_TIME) + Subscription(isOneTime, PENDING, frequencyWeeks=1) + cycle#1 (SCHEDULED, `prepaidAmount=kutu+ekstralar`, `orderId`=checkout Order'ı). Kargo: zone kuralı (tekil ürün gibi).
- Ödeme → ACTIVE; `ensure` bu aboneliğe dokunmaz (`is_one_time=false` filtresi). Kesime kadar swap/pref/extras serbest (aynı uçlar).
- Kesim: §8 (DELTA varsa). Teslimat: cycle DELIVERED → Subscription COMPLETED (SE COMPLETED); uyelik "TEK SEFERLİK SİPARİŞ" kartı teslim bilgisiyle kapanır.
- İptal (kesimden önce): cycle CANCELLED, O REFUNDED, Subscription CANCELLED (iptal akışı/teklif yok — doğrudan `…/cancel/confirm`; DOĞRULANMADI).
- Skip yok (cycle#1). Tamamlanınca yeni tek seferlik/abonelik açılabilir (kural #13: COMPLETED sayılmaz).

---

## 13. Kod ↔ doküman tutarlılığı

- Geçiş tabloları `packages/shared/src/state-machines/*.ts` içindeki `X_TRANSITIONS` ile **aynı**; olay sütunu `X_TRANSITION_EVENTS` ile aynı. Değişiklik iki yerde birlikte yapılır; PR'da `docs/state-machines.md` diff'i beklenir.
- `consistency.test.ts`: her makinenin durum listesi Prisma enum'uyla birebir; her geçişin olayı var; olay anahtarları geçerli; başlangıçtan erişilemeyen durum yok; Subscription/Cycle olayları `SubEventType` ile uyumlu (OPS_*, ABANDON hariç).
- Özet (koddaki sırayla):
  - **Order:** PENDING_PAYMENT→PAID|PAYMENT_FAILED|CANCELLED · PAID→PREPARING|CANCELLED|REFUNDED · PREPARING→OUT_FOR_DELIVERY|CANCELLED · OUT_FOR_DELIVERY→DELIVERED|DELIVERY_FAILED · DELIVERED→REFUNDED · DELIVERY_FAILED→OUT_FOR_DELIVERY|CANCELLED|REFUNDED · PAYMENT_FAILED→PENDING_PAYMENT|CANCELLED
  - **Subscription:** PENDING→ACTIVE|CANCELLED · ACTIVE→PAST_DUE|CANCEL_REQUESTED|CANCELLED|COMPLETED|PAUSED · PAST_DUE→ACTIVE|CANCELLED · PAUSED→ACTIVE|CANCELLED · CANCEL_REQUESTED→ACTIVE|CANCELLED
  - **Cycle:** SCHEDULED→LOCKED|SKIPPED|CANCELLED · LOCKED→CHARGED|AWAITING_PAYMENT|UNPAID|CANCELLED · AWAITING_PAYMENT→CHARGED|UNPAID|CANCELLED · SKIPPED→SCHEDULED · CHARGED→PREPARING · UNPAID→CHARGED|SKIPPED|CANCELLED · PREPARING→OUT_FOR_DELIVERY · OUT_FOR_DELIVERY→DELIVERED
  - **Payment:** PENDING→REQUIRES_3DS|SUCCEEDED|FAILED|EXPIRED · REQUIRES_3DS→SUCCEEDED|FAILED|EXPIRED · SUCCEEDED→REFUNDED|PARTIAL_REFUNDED · PARTIAL_REFUNDED→REFUNDED
  - **Cancellation:** PENDING→RETENTION_ACCEPTED|CANCELLED|ABANDONED
- F7 DoD testleriyle eşleme: "atla→geri al→kesim" (§10), "cycle#1 peşin + DELTA" (§8), "tek seferlik → COMPLETED" (§12), "iptal: kilitli cycle teslim" (§11), "UNPAID×2 → PAST_DUE" (§9), "PAYMENT_LINK süre dolunca UNPAID" (§8/6), "gün dolu → 409" (§10 unskip, checkout).
- **Uygulama haritası (F7, 2026-08-20 — E entegrasyonu):** Order makinesi `modules/orders/orders.service.ts#transition` (409 `ORDER_TRANSITION_INVALID`; abonelik siparişinde DD iadesi kapalı — rezervin sahibi motor) · Subscription/Cycle/Cancellation makineleri `modules/subscriptions/services/{subscriptions,cycles,cancellation}.service.ts` (`assertOr409` → 409 `SUBSCRIPTION|CYCLE|CANCELLATION_TRANSITION_INVALID`) · Payment makinesi `modules/payments/payments.service.ts` (409 `INVALID_TRANSITION`). Motorun dış kapıları (`SUBSCRIPTIONS_DEPS`) `subscriptions-deps.adapter.ts` ile gerçek servislere bağlı: PricingService.cycleCharge · DeliveryDatesService.reserve/release/findOrCreateFor/nextFor/isLocked · OrdersService.createForCycle/createDeltaForCycle/transition · MerchantInitiatedCharge.charge / PaymentLinkCharge.issue / PaymentsService.markExpired (Payment `cyc_<cycleId>_<n>` idempotent: aynı numara SUCCEEDED ise çift tahsilat yok; FAILED ise sonraki boş numara). Checkout (F8) öncesi tek açılış yolu: admin `POST /admin/subscriptions` (`ManualCheckoutService`: quote → Order → MANUAL ödeme → Subscription + cycle#1 → activate — §2 PENDING→ACTIVE aynı yan etkilerle). Job'lar `modules/jobs` (`JobsService.runOnce(name, now)`; admin `POST /admin/jobs/:name/run {now?}` yalnız geliştirme/test). Doğrulama: jest `__tests__/subscriptions/*` + `tools/e2e-admin/run-f7.mjs` (rapor `report-f7.md`).

---

## 14. Açık sorular (F7 1. gün spike'ında kapanacak; karar kuyruğu ≤3 kuralı için önceliklendirildi)

1. **Dunning penceresi vs. teslimat günü — KARAR (F7, 2026-08-20):** Yeniden deneme anları teslimat gününü **aşmaz**: sıradaki deneme `lockedAt + retryHours[i]` teslimat günü **08:00 Europe/Istanbul** (paketleme başlangıcı; `DUNNING_RETRY_DEADLINE_TIME`) sonrasına düşüyorsa o ve sonraki denemeler **atlanır**, cycle hemen **UNPAID → SKIPPED(skipSource=UNPAID)** olur (Order CANCELLED, DD iade, `failedCycles++`; 2 ardışık → PAST_DUE — §9). Setting `commerce.dunning.retryHours` değerleri aynen kalır, yalnız sınır uygulanır; varsayılan `[24,72]` ile kesimdeki ilk başarısız tahsilat doğrudan SKIPPED(UNPAID) demektir → lansman için admin'den `[2,12]` (ya da `[2,8]`) önerilir (ADR-0006'ya not). PAYMENT_LINK dunning'i aynı sınırla: link süresi / takvim / 08:00 hangisi önceyse; **sınır geçildiğinde yeni link üretilmez, cycle SKIPPED(UNPAID)** (F7 E entegrasyonunda uygulandı — öncesinde LINK kolu süresiz yeni link üretiyordu). Durum makinesi değişmedi. Uygulama: `apps/api/src/modules/subscriptions/services/cycles.service.ts#scheduleRetryOrSkip` (MIT) ve `#retryCycle` LINK kolu. Doğrulama: `__tests__/subscriptions/engine.spec.ts` + e2e `tools/e2e-admin/run-f7.mjs` (adım g/h).
2. **PAST_DUE'den iptal:** üye PAST_DUE iken `POST …/cancel` serbest mi (teklifsiz)? Şu an makinede PAST_DUE→CANCEL_REQUESTED yok; öneri: doğrudan `cancel/confirm` izinli (PAST_DUE→CANCELLED).
3. **PAST_DUE otomatik iptal:** N hafta sonra (ör. 4 ardışık UNPAID) otomatik CANCELLED + e-posta? MVP'de yok; admin listesi.
4. **Retention "sunuldu" vs "kullanıldı":** `User.retentionOfferUsedAt` teklif sunulduğunda mı kabul edildiğinde mi yazılacak? Prototip: sunulduğunda (ikinci akışta teklif yok). Alan adı yanıltıcı; öneri: sunulduğunda yaz, dokümante et.
5. **`cyclesAhead`:** kaç cycle ileri üretilsin (önerilen 2) — Setting listesinde yok; `commerce.cyclesAhead` eklenmeli mi?
6. **SubEventType eksikleri:** `CYCLE_CREATED` (ensure), `CANCEL_ABANDONED` (abandon), `SKIPPED_BY_OPS` ayrımı — enum'a eklensin mi yoksa `data` ile mi ayrıştırılsın?
7. **Şablon güncellendi:** BoxTemplate yayınlandıktan sonra düzenlenirse SCHEDULED cycle'lar güncellenmeli mi? Öneri: hayır (müşteri swap'ı bozulur); admin "şablonu cycle'lara uygula" düğmesi P2.
8. **`payments:reconcile`:** sağlayıcı zaman aşımında PENDING kalan Payment'lar için sorgulama job'ı (iyzico retrieve) — jobs listesinde yok; öneri: `cycles:expire-payment-links` içine 30 dk'lık PENDING temizliği.
9. **PAID→CANCELLED vs REFUNDED:** ödenmiş Order iptalinde iade zorunlu; CANCELLED terminal olduğu için iade sonrası REFUNDED'a geçilemiyor. Öneri: müşteri iptali doğrudan `PAID→REFUNDED` (iade başarılı olunca), CANCELLED yalnız MANUAL ödeme/iade gerekmeyen hâller; ya da CANCELLED→REFUNDED eklensin.
10. ~~**MIT stratejisinde saklı kart yoksa:** (kart silindi) PAYMENT_LINK'e otomatik düşülsün mü?~~ → **KARAR (F7): evet** — kesimde/retry'da saklı kart yok ya da pasif ise PAYMENT_LINK'e düşülür + SE ADMIN_NOTE ("Saklı kart yok — PAYMENT_LINK stratejisine düşüldü"); `ChargeStrategyResolver` de aynı kuralla (`fallbackReason: 'NO_STORED_CARD'`). Uygulama: `cycles.service.ts#chargeLocked` / `#retryCycle`.
11. **Abandon zaman aşımı:** CANCEL_REQUESTED 24 s sonra otomatik ABANDONED + ACTIVE (job) — gerekli mi, yoksa kesime kadar CANCEL_REQUESTED kalıp motor normal çalışmaya devam mı etsin (zaten ediyor)?
12. **Ops "teslim edilemedi" cycle tarafında:** Order DELIVERY_FAILED yeterli mi, CycleStatus'e DELIVERY_FAILED eklensin mi? Öneri: eklenmesin (ops Order üzerinden yönetir).
