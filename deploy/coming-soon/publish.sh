#!/usr/bin/env bash
# =============================================================================
# Bağdam coming-soon yayınlama — yerelden sunucuya (Git Bash / Linux / macOS)
#
#   Kullanım:  bash deploy/coming-soon/publish.sh [bagdam|bahcedenal|all]   (varsayılan: all)
#   Ortam:     BAGDAM_SSH_HOST (varsayılan `bagdam` — ~/.ssh/config alias'ı), TMPDIR (geçici dizin)
#
#   Ne yapar: ilgili index.html + robots.txt + apps/api/public'ten yalnız gereken dosyalar
#   (styles.css, logo svg'leri, hero-crate.jpg, footer ikonları) → tar|ssh → sunucu dizini.
#   nginx'e dokunmaz (vhost'lar: deploy/coming-soon/nginx/*.conf — elle kopyalanır, README'ye bak).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PUB="$ROOT/apps/api/public"
SSH_HOST="${BAGDAM_SSH_HOST:-bagdam}"
TARGET="${1:-all}"

case "$TARGET" in bagdam|bahcedenal|all) ;; *) echo "kullanım: $0 [bagdam|bahcedenal|all]" >&2; exit 2 ;; esac

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/bagdam-coming-soon.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

shared_assets() { # $1 = hedef dizin — sayfanın kullandığı ortak dosyalar
  mkdir -p "$1/assets/logo" "$1/assets/images" "$1/assets/icons"
  cp "$PUB/styles.css" "$1/styles.css"
  cp "$PUB/assets/logo/logo-horizontal.svg" "$PUB/assets/logo/logo-vertical.svg" \
     "$PUB/assets/logo/logo-icon.svg"       "$PUB/assets/logo/you-medya.png"      "$1/assets/logo/"
  cp "$PUB/assets/images/hero-crate.jpg" "$1/assets/images/"
  cp "$PUB/assets/icons/mutlu-musteri.png" "$PUB/assets/icons/konum.png" "$1/assets/icons/"
}

push() { # $1 = yerel dizin, $2 = sunucu dizini
  tar czf - -C "$1" . | ssh "$SSH_HOST" "mkdir -p '$2' && tar xzf - -C '$2' \
    && chown -R www-data:www-data '$2' \
    && find '$2' -type d -exec chmod 755 {} + && find '$2' -type f -exec chmod 644 {} +"
  echo "✓ $(basename "$1") → $SSH_HOST:$2"
}

if [[ "$TARGET" == bagdam || "$TARGET" == all ]]; then
  mkdir -p "$STAGE/bagdam"
  cp "$HERE/bagdam.com/index.html" "$HERE/bagdam.com/robots.txt" "$STAGE/bagdam/"
  shared_assets "$STAGE/bagdam"
  push "$STAGE/bagdam" /var/www/bagdam-comingsoon
fi

if [[ "$TARGET" == bahcedenal || "$TARGET" == all ]]; then
  mkdir -p "$STAGE/bahcedenal"
  cp "$HERE/bahcedenal.com.tr/index.html" "$HERE/bahcedenal.com.tr/robots.txt" "$STAGE/bahcedenal/"
  shared_assets "$STAGE/bahcedenal"
  push "$STAGE/bahcedenal" /var/www/bahcedenal-comingsoon
fi

echo "Bitti. Doğrula: curl -sI https://bagdam.com/ | head -1 ; curl -sI https://www.bahcedenal.com.tr/ | head -1"
