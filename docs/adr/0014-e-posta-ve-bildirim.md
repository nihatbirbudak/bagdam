# ADR-0014: E-posta/SMS: SMTP sağlayıcı + DB şablonları; dev'de mail kapalı

- **Tarih:** 2026-08-20
- **Durum:** Kabul edildi
- **Karar:** `MailModule` = nodemailer + Handlebars, şablonlar DB'de, `MailLog` (90 gün), SMTP ayarları panelden şifreli (`SETTINGS_ENCRYPTION_KEY`) + `.env` fallback; `DISABLE_MAIL=true` dev varsayılanı; `Notifier` arayüzü (F7'de stub). Sağlayıcı: **Resend veya SES** — F0'da seçilir (açık karar); SPF/DKIM/DMARC F1'de DNS'e. SMS (Netgsm) P1 opsiyonel, WhatsApp P2. Zorunlu şablonlar F10'da: sipariş onayı, haftalık kutu içeriği + kesim hatırlatma, tahsilat ok/başarısız + kart güncelleme/ödeme linki, yola çıktı/teslim, teslimat başarısız/yeniden planlandı, iptal teyidi, sözleşme kopyası.
