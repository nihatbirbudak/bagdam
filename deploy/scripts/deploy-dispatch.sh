#!/bin/bash
# =============================================================================
# birbudak.com — Bağdam CI için SSH forced-command dağıtıcısı (ADR-0015)
#
#   Kopyala:  /opt/birbudak/scripts/deploy-dispatch.sh   (chown root:root; chmod 750)
#
#   authorized_keys satırı (/root/.ssh/authorized_keys — Bağdam'a özel anahtar; tek satır):
#     command="/opt/birbudak/scripts/deploy-dispatch.sh",restrict ssh-ed25519 AAAA…anahtar… bagdam-github-actions
#   'restrict' = no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc (OpenSSH ≥ 7.2).
#   Anahtar üretimi: ssh-keygen -t ed25519 -C bagdam-github-actions -f ~/.ssh/bagdam_deploy -N ""
#   Özel anahtar → GitHub repo secret SERVER_SSH_KEY; açık anahtar → yukarıdaki satıra.
#
#   Davranış: GitHub Actions (appleboy/ssh-action) `script:` olarak yalnız uygulama adını yollar.
#   OpenSSH bunu SSH_ORIGINAL_COMMAND'a koyar; burada yalnız şu iki değer kabul edilir:
#     bagdam          → bash /opt/bagdam/deploy.sh bagdam
#     bagdam-staging  → bash /opt/bagdam-staging/deploy.sh bagdam-staging
#   Başka her şey (boş, birden çok komut, bilinmeyen ad) → exit 1. Bu anahtarla başka komut çalışmaz.
#   ssh-action betiğin başına "set -e" gibi satırlar ekleyebildiği için o satırlar yok sayılır;
#   komut "bash -s" ise (script stdin'den akar) ilk anlamlı satır stdin'den okunur.
# =============================================================================
set -euo pipefail

LOG="/var/log/birbudak-deploy-dispatch.log"
RAW="${SSH_ORIGINAL_COMMAND:-}"
APP=""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [deploy-dispatch] $*" >> "$LOG" 2>/dev/null || true; }

trim() {  # baş/son boşluk ve CR temizle
  local s="$1"
  s="${s%$'\r'}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

consider_line() {  # tek satırı değerlendir; geçerli ad ise APP'e yaz, geçersizse reddet
  local line; line="$(trim "$1")"
  case "$line" in
    "") return 0 ;;
    "set -e"|"set -eo pipefail"|"set -euo pipefail"|"set -o pipefail"|"set -ex") return 0 ;;  # ssh-action ön-ekleri
    bagdam|bagdam-staging)
      if [ -n "$APP" ] && [ "$APP" != "$line" ]; then
        log "REDDEDİLDİ: birden çok uygulama adı"; echo "deploy-dispatch: reddedildi" >&2; exit 1
      fi
      APP="$line"; return 0 ;;
    *)
      log "REDDEDİLDİ: '${line:0:80}'"; echo "deploy-dispatch: reddedildi" >&2; exit 1 ;;
  esac
}

case "$(trim "$RAW")" in
  ""|"bash -s"|"sh -s"|"bash"|"sh")
    # Komut boş veya betik stdin'den geliyor → en fazla 20 satır, 10 s içinde oku
    n=0
    while [ $n -lt 20 ] && IFS= read -r -t 10 line; do
      n=$((n+1)); consider_line "$line"
    done
    ;;
  *)
    while IFS= read -r line; do consider_line "$line"; done <<< "$RAW"
    ;;
esac

if [ -z "$APP" ]; then
  log "REDDEDİLDİ: uygulama adı yok"; echo "deploy-dispatch: kullanım — bagdam | bagdam-staging" >&2; exit 1
fi

case "$APP" in
  bagdam)         SCRIPT="/opt/bagdam/deploy.sh" ;;
  bagdam-staging) SCRIPT="/opt/bagdam-staging/deploy.sh" ;;
esac

[ -f "$SCRIPT" ] || { log "HATA: $SCRIPT yok"; echo "deploy-dispatch: $SCRIPT yok" >&2; exit 1; }

log "KABUL: $APP → $SCRIPT"
exec /bin/bash "$SCRIPT" "$APP"
