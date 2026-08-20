# ADR-0020: Başarısız tahsilat yeniden deneme penceresi (dunning) teslimat gününü aşamaz

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi — ADR-0006'nın "+24 s, +72 s yeniden deneme" kısmının yerini alır
- **Bağlam:** Kesim = teslimattan 1 gün önce 12:00; teslimat günü sabah 08:00'den sonra tahsil edilen kutu hazırlanamaz. +24 s/+72 s denemeleri bu pencereyi aşar (F7 doğrulamasında: ilk başarısız tahsilat doğrudan UNPAID/atlandı oluyordu).
- **Karar:** Yeniden deneme zamanları Setting `commerce.dunning.retryHours` — **varsayılan `[2, 12]`** (kesimden +2 s ve +12 s); son deneme sınırı teslimat günü **08:00 Europe/Istanbul**; sınırı aşan denemeler atlanır → cycle `UNPAID` + `SKIPPED(skipSource UNPAID)`; 2 ardışık UNPAID → abonelik `PAST_DUE`. Aynı kural `PAYMENT_LINK` stratejisinde de geçerli (süresi dolan link 08:00'den sonra yenilenmez). Değerler admin › Ayarlar › Kampanya/Abonelik'ten değiştirilebilir.
- **Sonuçlar:** `COMMERCE_SETTINGS_DEFAULTS.dunning.retryHours = [2,12]`; mevcut DB değeri güncellenir; e-posta hatırlatmaları (F10) bu zamanlara bağlanır.
