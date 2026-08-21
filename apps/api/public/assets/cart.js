const BahcedenCart = (function () {
  const CART_KEY = "bahceden_cart";
  const PREF_KEY = "bahceden_prefs";

  // F6 auth: ?sifirla=<token> artık parola sıfırlama bağlantısıdır (e-postadaki link:
  // uyelik.html?sifirla=<token>). Token bellekte tutulur ve adres çubuğundan silinir (geçmişe /
  // referer'a düşmesin); yerel kayıtlara dokunulmaz. DEĞERSİZ ?sifirla eski prototip davranışını korur:
  // tüm yerel kayıtlar temizlenir — siteyi ilk kez gelen bir ziyaretçi gibi baştan denemek için.
  let resetToken = null;
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.has("sifirla")) {
      const value = (qs.get("sifirla") || "").trim();
      if (value) {
        resetToken = value;
      } else {
        [
          "bahceden_cart", "bahceden_prefs", "bahceden_sub", "bahceden_address",
          "bahceden_member", "bahceden_session", "bahceden_card",
          "bahceden_orders", "bahceden_retention_offered",
        ].forEach((k) => localStorage.removeItem(k));
      }
      qs.delete("sifirla");
      const rest = qs.toString();
      history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
    }
    // F6 auth: üyelik/oturum/adres artık sunucuda (bootstrap me + /me/address) — eski prototip
    // anahtarları okunmaz da yazılmaz da; kalıntı varsa temizlenir. bahceden_cart/prefs/sub taslağı kalır.
    ["bahceden_member", "bahceden_session", "bahceden_address"].forEach((k) => localStorage.removeItem(k));
    // F8 checkout: kart ve sipariş geçmişi de sunucuda (PaymentMethod / Order: /me/cards, /me/orders) — prototip
    // anahtarları okunmaz/yazılmaz; kalıntı silinir. bahceden_sub taslağı yalnız satın alma tamamlanınca temizlenir.
    ["bahceden_card", "bahceden_orders"].forEach((k) => localStorage.removeItem(k));
    // F9 remote: iptalden caydırma teklifi hakkı da sunucuda (User.retentionOfferUsedAt; teklifin çıkıp çıkmayacağına
    // POST /me/subscription/cancel yanıtındaki `offer` karar verir) — prototip anahtarı okunmaz/yazılmaz, kalıntı silinir.
    // Kalan yerel kayıtlar: bahceden_cart, bahceden_prefs, satın ALINMAMIŞ kutu taslağı (bahceden_sub); ?sifirla korunur.
    ["bahceden_retention_offered", "bahceden_address"].forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* eski tarayıcıda sessizce geç */ }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---- F9 remote: sunucu saati — kesim geri sayımı istemci saatine GÜVENMEZ (BACKEND-PLANI §1.2 [B49]).
  // Bootstrap'a gömülen `serverNow` (ISO) ile yerel saat arasındaki fark sayfa parse anında bir kez ölçülür;
  // sonrası yerel saatin ilerleyişiyle taşınır (sayfa açık kaldıkça sapma büyümez). `serverNow` yoksa fark 0
  // → eski davranış birebir korunur (C uçları gelmeden de çalışır).
  const CLOCK_SKEW_MS = (function () {
    try {
      const iso = typeof __BAGDAM__ !== "undefined" && __BAGDAM__ ? __BAGDAM__.serverNow : null;
      const t = iso ? Date.parse(iso) : NaN;
      return isNaN(t) ? 0 : t - Date.now();
    } catch (e) {
      return 0;
    }
  })();
  /** Sunucuya göre "şimdi" (epoch ms). */
  function nowMs() {
    return Date.now() + CLOCK_SKEW_MS;
  }
  /** Sunucuya göre "şimdi" (Date). */
  function serverNow() {
    return new Date(nowMs());
  }

  function getCart() {
    return readJSON(CART_KEY, []);
  }
  function setCart(items) {
    writeJSON(CART_KEY, items);
    updateBadge();
  }
  function add(id, prefValue) {
    const items = getCart();
    const existing = items.find((i) => i.id === id && i.pref === (prefValue || null));
    if (existing) {
      existing.qty += 1;
    } else {
      items.push({ id: id, qty: 1, pref: prefValue || null });
    }
    setCart(items);
    updateFloatingCart(true, categoryFor(id));
  }
  function remove(index) {
    const items = getCart();
    items.splice(index, 1);
    setCart(items);
  }
  function setQty(index, qty) {
    const items = getCart();
    if (qty <= 0) {
      items.splice(index, 1);
    } else {
      items[index].qty = qty;
    }
    setCart(items);
  }
  function hasActiveSub() {
    const sub = getSub();
    return !!(sub.active && typeof SUB_TIERS !== "undefined" && SUB_TIERS.some((t) => t.id === sub.tierId));
  }
  function count() {
    return getCart().reduce((sum, i) => sum + i.qty, 0) + (hasActiveSub() ? 1 : 0);
  }

  // Site-wide floating shortcut to the cart. Lives outside any page's own
  // markup (appended to <body> on demand) so it shows up the same way on
  // every page — appears once there's anything to check out, and bumps
  // with a little pop whenever something is freshly added.
  // Wraps each letter in its own span with a staggered animation-delay, so
  // the word sinks into the basket one letter after another instead of all
  // at once. Spaces are left bare (nothing to animate).
  function hintLetters(text) {
    return text
      .split("")
      .map((ch, i) => (ch === " " ? " " : '<span class="floating-cart-hint-letter" style="animation-delay:' + (i * 0.07) + 's">' + ch + "</span>"))
      .join("");
  }

  let floatingCartEl = null;
  function ensureFloatingCart() {
    if (floatingCartEl) return floatingCartEl;
    const el = document.createElement("a");
    el.className = "floating-cart";
    el.href = "sepet.html";
    el.setAttribute("aria-label", "Sepet özetini aç");
    el.innerHTML =
      '<span class="floating-cart-hint">' + hintLetters("sepeti doldur") + "</span>" +
      '<div class="floating-cart-fill-row"></div>' +
      '<div class="floating-cart-icon-wrap">' +
        '<img class="floating-cart-icon floating-cart-icon-open" src="assets/icons/sepet-1.png" alt="">' +
        '<img class="floating-cart-icon floating-cart-icon-closed" src="assets/icons/sepet-kapali-1.png" alt="">' +
      '</div>' +
      '<span class="floating-cart-count mono"></span>';
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openCartDrawer();
    });
    // Dokunmatikte tek dokunuşta aç: iOS bazen ilk dokunuşu hover olarak
    // harcar; touchend'de doğrudan açıp ardından gelen click'i yutarız.
    let touchOpened = false, touchStartY = 0, touchStartX = 0;
    el.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (e.changedTouches && e.changedTouches.length > 1) return;
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - touchStartX) > 10 || Math.abs(t.clientY - touchStartY) > 10) return; // kaydırma, dokunuş değil
      e.preventDefault();
      touchOpened = true;
      openCartDrawer();
      setTimeout(() => { touchOpened = false; }, 400);
    }, { passive: false });
    el.addEventListener("click", (e) => { if (touchOpened) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    document.body.appendChild(el);
    floatingCartEl = el;
    setupFloatingCartDock(el);
    return el;
  }

  // Keeps the floating cart from drifting down over the footer as the page
  // scrolls to the very bottom — once its normal fixed spot would sink past
  // the footer logo's height, it docks in place there (absolute, not fixed)
  // instead of continuing to overlap the footer.
  let applyFloatingCartDock = null;
  function setupFloatingCartDock(el) {
    let ticking = false;
    function apply() {
      ticking = false;
      const brand = document.querySelector(".site-foot-brand");
      if (!brand || !el.classList.contains("visible")) return;
      const fixedBottomOffset = window.innerWidth <= 900 ? 16 : 24;
      const cartHeight = el.offsetHeight;
      const brandRect = brand.getBoundingClientRect();
      // Docks so the cart's own bottom edge lines up with the brand block's
      // bottom edge — not just its center resting there — matching the rest
      // of the footer content, which is bottom-aligned to the logo.
      const brandBottomY = brandRect.bottom;
      const fixedBottomY = window.innerHeight - fixedBottomOffset;
      if (fixedBottomY > brandBottomY) {
        // Belge sınırına kelepçe: içerik kısalınca (sekme geçişi) sepet
        // hiçbir zaman footer'ın altına sarkmasın.
        const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const dockY = Math.min(window.scrollY + brandBottomY - cartHeight, docH - cartHeight);
        el.style.position = "absolute";
        el.style.top = dockY + "px";
        el.style.bottom = "auto";
      } else {
        el.style.position = "";
        el.style.top = "";
        el.style.bottom = "";
      }
    }
    function onScrollOrResize() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    }
    window.addEventListener("scroll", onScrollOrResize);
    window.addEventListener("resize", onScrollOrResize);
    // Sayfa yüksekliği kaydırma olmadan da değişebilir (ürünler sayfasında
    // sekme geçişi, açılır SSS, içerik yüklenmesi) — footer yer değiştirir
    // ama dock eski konumda asılı kalırdı. Belge boyutunu izleyip yeniden
    // hesapla.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(onScrollOrResize).observe(document.body);
    }
    applyFloatingCartDock = apply;
    apply();
  }

  function money(n) { return n.toLocaleString("tr-TR"); }

  // Site-wide "half page" cart summary — opens over whatever page the
  // shopper is on so they can see what's in the cart without losing their
  // place; "siparişi tamamla" is the only path from here to sepet.html.
  let cartDrawerEl = null;
  let cartDrawerBackdropEl = null;
  function ensureCartDrawer() {
    if (cartDrawerEl) return cartDrawerEl;

    const backdrop = document.createElement("div");
    backdrop.className = "cart-drawer-backdrop";
    backdrop.addEventListener("click", closeCartDrawer);
    document.body.appendChild(backdrop);
    cartDrawerBackdropEl = backdrop;

    const aside = document.createElement("aside");
    aside.className = "cart-drawer";
    aside.setAttribute("aria-label", "Sepet özeti");
    aside.innerHTML =
      '<div class="cart-drawer-head">' +
        "<h3>Sepetin</h3>" +
        '<button class="cart-drawer-close" type="button" aria-label="Kapat">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        "</button>" +
      "</div>" +
      '<div class="cart-drawer-body" id="cartDrawerBody"></div>' +
      '<div class="cart-drawer-reco">' +
        '<p class="cart-drawer-reco-label mono">Bunları da sevebilirsin</p>' +
        '<div class="cart-drawer-reco-grid" id="cartDrawerReco"></div>' +
      "</div>" +
      '<div class="cart-drawer-foot">' +
        '<div class="cart-drawer-total"><span>Toplam</span><span class="mono" id="cartDrawerTotal"></span></div>' +
        '<a class="cta wide" href="sepet.html">siparişi tamamla</a>' +
      "</div>";
    document.body.appendChild(aside);
    cartDrawerEl = aside;
    aside.querySelector(".cart-drawer-close").addEventListener("click", closeCartDrawer);
    aside.querySelector("#cartDrawerReco").addEventListener("click", (e) => {
      const slot = e.target.closest("[data-add-to-cart]");
      if (!slot) return;
      const id = slot.getAttribute("data-add-to-cart");
      if (e.target.closest(".pref-pop")) return;
      if (e.target.closest(".qty-stepper-add") || e.target.closest(".qty-stepper-inc")) {
        e.stopPropagation();
        if (!addFromSlot(slot, id, renderCartDrawer)) return;
      } else if (e.target.closest(".qty-stepper-dec")) {
        decrementCartProduct(id);
      } else {
        return;
      }
      renderStepper(slot);
      renderCartDrawer();
    });
    aside.querySelector("#cartDrawerBody").addEventListener("click", (e) => {
      if (e.target.closest("[data-sub-remove]")) {
        const s = getSub();
        s.active = false;
        setSub(s);
        renderCartDrawer();
        return;
      }
      const stepBtn = e.target.closest("[data-cart-idx]");
      if (!stepBtn) return;
      const idx = parseInt(stepBtn.getAttribute("data-cart-idx"), 10);
      const dir = parseInt(stepBtn.getAttribute("data-dir"), 10);
      const items = getCart();
      if (!items[idx]) return;
      setQty(idx, items[idx].qty + dir);
      renderCartDrawer();
    });
    return aside;
  }

  function cartDrawerRecoCardHtml(p) {
    return (
      '<div class="cart-drawer-reco-card">' +
        '<a href="urun.html?id=' + p.id + '"><img src="' + p.img + '" alt="' + p.name + '"></a>' +
        '<div class="qty-stepper-slot" data-add-to-cart="' + p.id + '"></div>' +
      "</div>"
    );
  }

  // Box/subscription line — no +/- stepper here (one box per customer), just
  // the same "kutuyu düzenle" / "kaldır" pair sepet.html's own row uses.
  function cartDrawerSubRowHtml(tier, lineTotal, extrasCount) {
    return (
      '<div class="cart-drawer-row">' +
        '<img src="' + tier.img + '" alt="' + tier.label + '">' +
        '<div class="cart-drawer-row-info">' +
          "<h4>" + tier.label + "</h4>" +
          '<p class="mono">' + tier.count + " ürün" + (extrasCount ? " + " + extrasCount + " ekstra" : "") + "</p>" +
          '<div class="qty-row">' +
            '<a class="cart-remove mono" href="kutu.html?tier=' + tier.id + '">kutuyu düzenle</a>' +
            '<button class="cart-remove mono" type="button" data-sub-remove>kaldır</button>' +
          "</div>" +
        "</div>" +
        '<span class="mono">' + money(lineTotal) + " TL</span>" +
      "</div>"
    );
  }

  function cartDrawerProductRowHtml(item, p, lineTotal, idx) {
    const isTrash = item.qty === 1;
    return (
      '<div class="cart-drawer-row">' +
        '<img src="' + p.img + '" alt="' + p.name + '">' +
        '<div class="cart-drawer-row-info">' +
          "<h4>" + p.name + "</h4>" +
          '<div class="qty-stepper-row">' +
            '<button class="qty-stepper-dec' + (isTrash ? " trash" : "") + '" data-cart-idx="' + idx + '" data-dir="-1" type="button" aria-label="' + (isTrash ? "Sepetten kaldır" : "Azalt") + '">' +
              (isTrash ? TRASH_SVG : "−") +
            "</button>" +
            '<span class="qty-stepper-count mono">' + item.qty + "</span>" +
            '<button class="qty-stepper-inc" data-cart-idx="' + idx + '" data-dir="1" type="button" aria-label="Arttır">+</button>' +
          "</div>" +
        "</div>" +
        '<span class="mono">' + money(lineTotal) + " TL</span>" +
      "</div>"
    );
  }

  function renderCartDrawer() {
    const body = document.getElementById("cartDrawerBody");
    const totalEl = document.getElementById("cartDrawerTotal");
    if (!body || !totalEl) return;

    const sub = getSub();
    const tier = sub.active ? subTier() : null;
    let total = 0;
    let rowsHtml = "";

    if (tier) {
      const lineTotal = sub.skipThisWeek ? 0 : tier.price + subExtrasTotal();
      total += lineTotal;
      rowsHtml += cartDrawerSubRowHtml(tier, lineTotal, (sub.extras || []).length);
    }
    getCart().forEach((item, idx) => {
      const p = typeof PRODUCTS !== "undefined" ? PRODUCTS.find((x) => x.id === item.id) : null;
      if (!p) return;
      const lineTotal = p.price * item.qty;
      total += lineTotal;
      rowsHtml += cartDrawerProductRowHtml(item, p, lineTotal, idx);
    });

    body.innerHTML = rowsHtml || '<p class="cart-drawer-empty mono">Sepetin boş.</p>';
    totalEl.textContent = money(total) + " TL";

    const recoEl = document.getElementById("cartDrawerReco");
    if (recoEl && typeof PRODUCTS !== "undefined") {
      const candidates = PRODUCTS.filter((p) => !p.fresh).slice(0, 3);
      recoEl.innerHTML = candidates.map(cartDrawerRecoCardHtml).join("");
      recoEl.querySelectorAll("[data-add-to-cart]").forEach(renderStepper);
    }
  }

  function openCartDrawer() {
    ensureCartDrawer();
    renderCartDrawer();
    cartDrawerEl.classList.add("open");
    cartDrawerBackdropEl.classList.add("open");
  }
  function closeCartDrawer() {
    if (cartDrawerEl) cartDrawerEl.classList.remove("open");
    if (cartDrawerBackdropEl) cartDrawerBackdropEl.classList.remove("open");
  }

  // Maps a product's urunler.html tab to the same category icon shown on
  // its tab button, so the floating cart can show "what kind of thing" is
  // in there, peeking out from behind the basket.
  const CATEGORY_ICON = { pantry: "cellar", dairy: "dairy", firin: "firin" };
  function categoryFor(id) {
    const p = typeof PRODUCTS !== "undefined" ? PRODUCTS.find((x) => x.id === id) : null;
    return (p && CATEGORY_ICON[p.tab]) || null;
  }

  // Every distinct category currently in the cart, in first-added order —
  // this is what decides which icons stay peeking behind the basket.
  // The subscription box counts as its own "boxes" category when active.
  function activeCartCategories() {
    const keys = [];
    if (hasActiveSub()) keys.push("boxes");
    getCart().forEach((i) => {
      const key = categoryFor(i.id);
      if (key && keys.indexOf(key) === -1) keys.push(key);
    });
    return keys;
  }

  // Fills any .floating-cart-fill-row-shaped container with one icon per
  // category actually in the cart — shared by the floating cart and any
  // other basket icon on the page (e.g. sepet.html's own hero icon) so they
  // both "fill up" the same way, using the same fixed overlapping slots.
  function renderCategoryPile(row) {
    if (!row) return;
    const activeKeys = activeCartCategories();
    Array.from(row.children).forEach((child) => {
      if (activeKeys.indexOf(child.getAttribute("data-cat")) === -1) child.remove();
    });
    activeKeys.forEach((key) => {
      if (row.querySelector('[data-cat="' + key + '"]')) return;
      const img = document.createElement("img");
      img.className = "floating-cart-fill-item";
      img.setAttribute("data-cat", key);
      img.alt = "";
      img.src = "assets/icons/" + key + ".png";
      row.appendChild(img);
    });
  }

  // Keeps one small icon per category actually in the cart — added the
  // moment its category first appears, removed only once every item of
  // that category is gone — so the basket visually stays "filled" with
  // whatever's really in it, rather than flashing the latest add only.
  function updateFloatingCart(animate, justAddedCategory) {
    const el = ensureFloatingCart();
    const n = count();
    const countEl = el.querySelector(".floating-cart-count");
    countEl.textContent = n;
    countEl.style.display = n === 0 ? "none" : "flex";
    // Stays put whether the cart has anything in it or not, on every page
    // except sepet.html itself — no point shortcutting to the page you're
    // already on.
    const onCartPage = /(^|\/)sepet\.html$/.test(location.pathname);
    el.classList.toggle("visible", !onCartPage);
    el.querySelector(".floating-cart-hint").classList.toggle("hidden", n > 0);
    if (applyFloatingCartDock) applyFloatingCartDock();

    const row = el.querySelector(".floating-cart-fill-row");
    renderCategoryPile(row);

    if (animate && n > 0) {
      el.classList.remove("bump");
      void el.offsetWidth; // restart the animation even if it's already mid-bump
      el.classList.add("bump");
      // Bump is a one-shot animation — clear it once it's done so it doesn't
      // permanently outrank the ambient "breathing" animation below it.
      setTimeout(() => el.classList.remove("bump"), 450);
      const poppedEl = justAddedCategory ? row.querySelector('[data-cat="' + justAddedCategory + '"]') : null;
      if (poppedEl) {
        poppedEl.classList.remove("pop");
        void poppedEl.offsetWidth;
        poppedEl.classList.add("pop");
      }
    }
  }

  function updateBadge() {
    document.querySelectorAll(".cart .mono").forEach((el) => {
      el.textContent = "(" + count() + ")";
    });
    updateFloatingCart(false);
  }

  function getPrefs() {
    return readJSON(PREF_KEY, {});
  }
  function recordPref(axisLabel, optionValue) {
    const prefs = getPrefs();
    prefs[axisLabel] = optionValue;
    writeJSON(PREF_KEY, prefs);
  }

  // Wires every .toggle-row on the page: click selects it, and if the row
  // sits inside an element carrying data-pref-axis, the choice is remembered.
  function wireToggles(root) {
    (root || document).querySelectorAll(".toggle-row").forEach((row) => {
      const axisHolder = row.closest("[data-pref-axis]");
      const axis = axisHolder ? axisHolder.getAttribute("data-pref-axis") : null;
      row.querySelectorAll(".toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          row.querySelectorAll(".toggle").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          if (axis) recordPref(axis, btn.textContent.trim());
        });
      });
    });
  }

  const TRASH_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  // Total qty of a product in the cart, summed across any preference
  // variants — the card-level stepper shows one number, not one per variant.
  function cartQtyFor(id) {
    return getCart()
      .filter((i) => i.id === id)
      .reduce((sum, i) => sum + i.qty, 0);
  }

  // Decrements (or removes, at qty 1) the plain (no-preference) line for a
  // product if there is one, else falls back to whichever variant it finds.
  function decrementCartProduct(id) {
    const items = getCart();
    let idx = items.findIndex((i) => i.id === id && i.pref === null);
    if (idx === -1) idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    if (items[idx].qty > 1) {
      items[idx].qty -= 1;
      setCart(items);
    } else {
      remove(idx);
    }
  }

  // Renders a card's [data-add-to-cart] slot as either a bare "+" (nothing
  // in the cart yet) or a −/count/+ stepper — the − turns into a trash icon
  // right at qty 1, since going lower there means taking it out entirely.
  function stepperHtml(id) {
    const qty = cartQtyFor(id);
    if (qty === 0) {
      return '<button class="qty-stepper-add" type="button" aria-label="Sepete ekle">+</button>';
    }
    const isTrash = qty === 1;
    return (
      '<div class="qty-stepper-row">' +
        '<button class="qty-stepper-dec' + (isTrash ? " trash" : "") + '" type="button" aria-label="' + (isTrash ? "Sepetten kaldır" : "Azalt") + '">' +
          (isTrash ? TRASH_SVG : "−") +
        "</button>" +
        '<span class="qty-stepper-count mono">' + qty + "</span>" +
        '<button class="qty-stepper-inc" type="button" aria-label="Arttır">+</button>' +
      "</div>"
    );
  }
  function renderStepper(container) {
    const id = container.getAttribute("data-add-to-cart");
    if (id) container.innerHTML = stepperHtml(id);
  }

  // Renders every [data-add-to-cart] slot as a qty stepper (bare "+" at
  // qty 0) and wires it up. Delegated on each container itself rather than
  // globally, so re-rendering one slot's innerHTML never orphans listeners
  // on the others.
  // ---- Hızlı tercih balonu: tercihi olan bir ürüne (yumurta boyutu, zeytin
  // tuzluluğu...) sayfaya girmeden kart üzerinden + basılınca, butonun
  // üstünde 2–3 çipli küçük bir balon açılır; çip seçilince o tercihle
  // eklenir. Sepette zaten varsa (qty>0) ya da kartta kendi toggle'ı
  // varsa (ürün sayfası) sormadan ekler. Tek yerde — data-add-to-cart
  // kullanan her liste (ürünler, ana sayfa, öneriler, sepet çekmecesi,
  // kutu sayfası yan ürünleri) otomatik kazanır.
  let openPrefPop = null;
  function closePrefPop() {
    if (openPrefPop) { openPrefPop.remove(); openPrefPop = null; }
    document.querySelectorAll(".pref-pop-anchor").forEach((el) => el.classList.remove("pref-pop-anchor"));
  }
  function openPrefPopFor(container, p, onPicked) {
    closePrefPop();
    const pop = document.createElement("div");
    pop.className = "pref-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", p.pref.label + " seç");
    pop.innerHTML =
      '<span class="pref-pop-label mono">' + p.pref.label + "</span>" +
      '<div class="toggle-row small pref-pop-row">' +
        p.pref.options.map((opt, i) =>
          '<button class="toggle' + (i === p.pref.def ? " active" : "") + '" type="button" data-pref-value="' + opt + '">' + opt + "</button>"
        ).join("") +
      "</div>";
    container.classList.add("pref-pop-anchor");
    container.appendChild(pop);
    openPrefPop = pop;
    // Ekran kenarına taşıyorsa içeri kaydır (mobilde 3'lü gridin kenar kartları).
    const r = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.right > vw - 8) pop.style.marginRight = Math.round(r.right - (vw - 8)) + "px";
    else if (r.left < 8) pop.style.marginRight = "-" + Math.round(8 - r.left) + "px";
    pop.addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.target.closest("[data-pref-value]");
      if (!btn) return;
      add(p.id, btn.getAttribute("data-pref-value"));
      closePrefPop();
      renderStepper(container);
      if (typeof onPicked === "function") onPicked();
    });
  }

  // Kart/slot üzerinden "+" davranışının tek kapısı: tercih sorulması
  // gerekiyorsa balonu açıp false döner (seçim yapılınca onPicked çağrılır);
  // gerekmiyorsa ekler ve true döner. Sepet çekmecesi ve kutu sayfası yan
  // ürünleri de bunu kullanır — davranış her yerde aynı.
  function addFromSlot(slot, id, onPicked) {
    const p = typeof PRODUCTS !== "undefined" ? PRODUCTS.find((x) => x.id === id) : null;
    if (p && p.pref && cartQtyFor(id) === 0) {
      if (openPrefPop && openPrefPop.parentNode === slot) { closePrefPop(); return false; }
      openPrefPopFor(slot, p, onPicked);
      return false;
    }
    add(id, null);
    return true;
  }
  document.addEventListener("click", (e) => {
    if (openPrefPop && !e.target.closest(".pref-pop") && !e.target.closest(".pref-pop-anchor")) closePrefPop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePrefPop(); });
  // Kişi sayfayı kaydırmaya başladıysa seçimden vazgeçmiş demektir — balon
  // kapanır (dokunmatikte kaydırma "click" üretmez, bu yüzden ayrıca).
  // Balonun kendi içindeki parmak hareketi (çipler arasında) kapatmaz.
  // capture:true — sayfa değil, herhangi bir iç kap (sepet çekmecesi,
  // kaydırmalı liste) kaysa da yakalanır.
  document.addEventListener("scroll", () => { if (openPrefPop) closePrefPop(); }, { passive: true, capture: true });
  document.addEventListener("touchmove", (e) => {
    if (openPrefPop && !e.target.closest(".pref-pop")) closePrefPop();
  }, { passive: true });
  window.addEventListener("resize", () => { if (openPrefPop) closePrefPop(); });

  function wireAddButtons(root) {
    (root || document).querySelectorAll("[data-add-to-cart]").forEach((container) => {
      renderStepper(container);
      container.addEventListener("click", (e) => {
        const id = container.getAttribute("data-add-to-cart");
        if (e.target.closest(".pref-pop")) return; // balon kendi tıklamasını yönetir
        if (e.target.closest(".qty-stepper-add") || e.target.closest(".qty-stepper-inc")) {
          const card = container.closest("[data-pref-axis], .pcard, .product-detail");
          const activeToggle = card ? card.querySelector(".toggle.active") : null;
          if (activeToggle) {
            add(id, activeToggle.textContent.trim()); // ürün sayfası: kendi toggle'ı var
          } else {
            e.stopPropagation();
            if (!addFromSlot(container, id)) return; // balon açıldı, seçim bekleniyor
          }
        } else if (e.target.closest(".qty-stepper-dec")) {
          decrementCartProduct(id);
        } else {
          return;
        }
        renderStepper(container);
      });
    });
  }

  // Renders a small "sana özel" strip into `container` — always shows
  // something. A first-time visitor with no cart/sub/pref history gets a
  // plain default pick; anyone who's already ordered (has items in their
  // cart or a box they've started configuring) or set a taste preference
  // gets picks scored toward that signal instead.
  function renderRecommended(container, excludeIds) {
    if (!container || typeof PRODUCTS === "undefined") return;
    excludeIds = excludeIds || [];
    const prefs = getPrefs();
    const axisLabels = Object.keys(prefs);

    const cartItems = getCart();
    const sub = getSub();
    const subItemIds = sub && sub.tierId ? sub.items || [] : [];
    const signalIds = cartItems.map((i) => i.id).concat(subItemIds);
    const signalCategories = {};
    signalIds.forEach((id) => {
      const sp = PRODUCTS.find((x) => x.id === id);
      if (!sp) return;
      const key = sp.tab || sp.category;
      signalCategories[key] = (signalCategories[key] || 0) + 1;
    });

    // Fresh items are box-only — never recommend them as a standalone add-on.
    const scored = PRODUCTS.filter((p) => !p.fresh && excludeIds.indexOf(p.id) === -1).map((p) => {
      let score = 0;
      if (p.pref && prefs[p.pref.label]) {
        score += p.pref.options.indexOf(prefs[p.pref.label]) !== -1 ? 2 : 1;
      }
      const key = p.tab || p.category;
      if (signalCategories[key]) score += signalCategories[key];
      return { p: p, score: score };
    });
    scored.sort((a, b) => b.score - a.score);
    const picked = scored.slice(0, 3).map((s) => s.p);

    let hintHtml = "";
    if (axisLabels.length > 0) {
      const lastAxis = axisLabels[axisLabels.length - 1];
      const lastVal = prefs[lastAxis];
      hintHtml = '<p class="reco-hint mono">SON SEÇİMİN: ' + lastAxis.toUpperCase() + " — " + lastVal.toUpperCase() + "</p>";
    } else if (signalIds.length > 0) {
      hintHtml = '<p class="reco-hint mono">SEPETİNE GÖRE SEÇTİK</p>';
    }

    // Kart: resim + ad linke gider; altında ürün kartlarındaki yeşil +/−
    // stepper (data-add-to-cart slot'u — wireAddButtons bağlar).
    container.innerHTML =
      hintHtml +
      '<div class="reco-grid">' +
      picked
        .map(
          (p) =>
            '<div class="reco-card">' +
            '<a class="reco-card-link" href="urun.html?id=' + p.id + '">' +
            '<img src="' + p.img + '" alt="' + p.name + '" loading="lazy">' +
            '<span>' + p.name + "</span>" +
            "</a>" +
            '<div class="reco-card-foot">' +
            '<span class="reco-card-price mono">' + p.price + " TL</span>" +
            '<div class="qty-stepper-slot" data-add-to-cart="' + p.id + '"></div>' +
            "</div>" +
            "</div>"
        )
        .join("") +
      "</div>";
  }

  // ---- Subscription (weekly box) ----
  const SUB_KEY = "bahceden_sub";

  // active: kutu sepette, henüz ödenmedi. purchased: ödeme tamamlandı —
  // artık üyelik sayfasındaki "aboneliklerim"de yönetilen canlı abonelik.
  const SUB_DEFAULTS = {
    tierId: null, items: [], skipThisWeek: false, skipUsed: false,
    freq: "1hafta", deliveryDay: null, type: "subscription", itemPrefs: {},
    extras: [], extrasCutoff: null, purchased: false,
  };

  function getSub() {
    // F3 bootstrap: satın alınmış (purchased) abonelik sunucudan (__BAGDAM__.sub); yoksa eski localStorage taslağı.
    if (typeof __BAGDAM__ !== "undefined" && __BAGDAM__.sub) return Object.assign({}, SUB_DEFAULTS, __BAGDAM__.sub);
    // Merge with defaults so subs saved before freq/type existed still work.
    const sub = Object.assign({}, SUB_DEFAULTS, readJSON(SUB_KEY, {}));
    // A sub saved with a since-removed frequency (e.g. "Haftada 3") falls
    // back to the default so the pickers and cutoff math stay valid.
    if (typeof FREQ_OPTIONS !== "undefined" && !FREQ_OPTIONS.some((f) => f.id === sub.freq)) {
      sub.freq = SUB_DEFAULTS.freq;
    }
    // Extras are per-order only: once the week they were added for is past
    // its cutoff, the next order renews as a plain box — drop them silently.
    // (writeJSON, not setSub — updateBadge() calls back into getSub().)
    if (sub.extras.length && sub.extrasCutoff && nowMs() > sub.extrasCutoff) {
      sub.extras = [];
      sub.extrasCutoff = null;
      writeJSON(SUB_KEY, sub);
    }
    return sub;
  }
  function setSub(sub) {
    // F9 remote: satın alınmış abonelik SUNUCUDA yaşar — localStorage'a kopyalanmaz. Canlı bir DTO ile
    // çağrılırsa (eski çağrı yolları) yalnız bootstrap kopyası tazelenir; taslak (satın alınmamış kutu)
    // eskisi gibi yerelde saklanır.
    if (sub && sub.purchased) {
      applyServerSub(sub);
      return;
    }
    writeJSON(SUB_KEY, sub);
    updateBadge();
  }
  /** F9 remote: sunucudan dönen BootstrapSub DTO'sunu bootstrap'a yazar (tek doğruluk kaynağı) ve rozeti tazeler. */
  function applyServerSub(sub) {
    if (typeof window.__BAGDAM__ !== "object" || !window.__BAGDAM__) window.__BAGDAM__ = {};
    window.__BAGDAM__.sub = sub && typeof sub === "object" ? sub : null;
    updateBadge();
    return window.__BAGDAM__.sub;
  }

  // F8 checkout: sipariş geçmişi (bahceden_orders, getOrders/addOrder) ve nextDeliveryDate kalktı — siparişler
  // sunucuda (GET /me/orders), teslimat tarihi DeliveryDate'ten (GET /delivery/dates). Satın alma sonrası
  // kutu taslağı temizlenir (clearSubDraft).
  function clearSubDraft() {
    try { localStorage.removeItem(SUB_KEY); } catch (e) { /* yok say */ }
    updateBadge();
  }

  // ---- F6 auth: API yardımcısı — BahcedenCart.api(path, {method, body}) (BACKEND-PLANI §1.2, F6 sözleşmesi) ----
  // Aynı kaynak /api/v1; çerezli oturum (credentials: include); JSON gövde; mutasyonlarda X-CSRF-Token
  // (csrf_token çerezinden; yoksa GET /auth/csrf). 401 TOKEN_EXPIRED → bir kez POST /auth/refresh + tekrar;
  // diğer 401 → oturum yok: sayfa "çıkış" durumuna döner (sessionLost). 403 CSRF_INVALID → taze CSRF + bir tekrar.
  // Başarı: çözülen JSON (204 → null). Hata: reddedilen {status, code, message (Türkçe), payload}.
  const API_BASE = "/api/v1";
  const CSRF_COOKIE = "csrf_token";
  // Kendi 401'i "oturum düştü" anlamına gelmeyen uçlar (yanlış parola, geçersiz refresh, çıkış...).
  const AUTH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout", "/auth/forgot", "/auth/reset"];
  // Hata zarfı `error` kodu → Türkçe metin (zarf mesajı teknikse/İngilizceyse bunlar önce gelir).
  const API_CODE_MESSAGES = {
    UNAUTHENTICATED: "Oturumun bulunamadı — lütfen giriş yap.",
    TOKEN_EXPIRED: "Oturumun sona erdi — lütfen yeniden giriş yap.",
    REFRESH_INVALID: "Oturumun sona erdi — lütfen yeniden giriş yap.",
    CSRF_INVALID: "Güvenlik doğrulaması başarısız — sayfayı yenileyip tekrar dene.",
    EMAIL_TAKEN: "Bu e-posta zaten kayıtlı — giriş yapmayı dene.",
    KVKK_REQUIRED: "Devam etmek için KVKK aydınlatma metnini onaylaman gerekiyor.",
    RESET_TOKEN_INVALID: "Sıfırlama bağlantısı geçersiz ya da süresi dolmuş — yeni bağlantı iste.",
    CURRENT_PASSWORD_INVALID: "Mevcut parolan hatalı.",
    // F9 remote: abonelik motoru 409/400 kodları (apps/api/src/modules/subscriptions/subscriptions.errors.ts).
    SUBSCRIPTION_EXISTS: "Zaten aktif bir aboneliğin var.",
    NO_SUBSCRIPTION: "Aktif bir aboneliğin görünmüyor — sayfayı yenileyip tekrar dene.",
    NO_CURRENT_CYCLE: "Bu hafta için düzenlenebilir bir kutu yok.",
    CYCLE_LOCKED: "Bu haftanın değişiklik süresi doldu — kutun hazırlanmaya başladı.",
    CYCLE_NOT_EDITABLE: "Bu kutu artık düzenlenemiyor.",
    FIRST_CYCLE_NOT_SKIPPABLE: "İlk kutun atlanamaz.",
    SKIP_LIMIT_REACHED: "Atlama hakkın bu yıllık dönem için doldu.",
    NOT_SKIPPED: "Bu hafta zaten atlanmış değil.",
    DAY_FULL: "Seçtiğin teslimat günü doldu — başka bir gün seç.",
    BOX_ITEM_COUNT: "Kutudaki ürün sayısı değiştirilemez — yalnız değiştokuş yapabilirsin.",
    PRODUCT_NOT_AVAILABLE: "Seçtiğin ürün şu an mevcut değil.",
    PRODUCT_NOT_SWAPPABLE: "Bu ürün kutuda değiştirilemiyor.",
    PREF_INVALID: "Seçtiğin tercih geçersiz.",
    EXTRA_FACTOR_INVALID: "Ekstra miktarı geçersiz.",
    FREQUENCY_INVALID: "Seçtiğin gönderim sıklığı geçersiz.",
    DELIVERY_DAY_INVALID: "Seçtiğin teslimat günü geçersiz.",
    ADDRESS_INVALID: "Adresin geçersiz — teslimat adresini güncelle.",
    PAYMENT_METHOD_INVALID: "Seçtiğin kart geçersiz — başka bir kart seç.",
    CANCEL_ALREADY_REQUESTED: "Zaten açık bir iptal talebin var.",
    NO_OPEN_CANCELLATION: "Açık bir iptal talebin yok.",
    RETENTION_NOT_OFFERED: "Bu iptal akışında kalma teklifi sunulmadı.",
  };
  const API_STATUS_MESSAGES = {
    400: "Girdiğin bilgileri kontrol et.",
    401: "Oturumun bulunamadı — lütfen giriş yap.",
    403: "Bu işlem için yetkin yok.",
    404: "Kayıt bulunamadı.",
    409: "Bu kayıt zaten var.",
    423: "Hesap geçici olarak kilitlendi — biraz sonra tekrar dene.",
    429: "Çok fazla deneme — biraz sonra tekrar dene.",
    500: "Sunucu hatası — biraz sonra tekrar dene.",
    502: "Sunucuya şu an ulaşılamıyor — biraz sonra tekrar dene.",
    503: "Sunucuya şu an ulaşılamıyor — biraz sonra tekrar dene.",
  };
  const API_NETWORK_MESSAGE = "Sunucuya ulaşılamadı — bağlantını kontrol edip tekrar dene.";
  const API_GENERIC_MESSAGE = "Bir şeyler ters gitti — lütfen tekrar dene.";

  function readCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function dropCookie(name) {
    document.cookie = name + "=; Max-Age=0; path=/";
  }

  let csrfPromise = null;
  function ensureCsrf() {
    const existing = readCookie(CSRF_COOKIE);
    if (existing) return Promise.resolve(existing);
    if (!csrfPromise) {
      csrfPromise = fetch(API_BASE + "/auth/csrf", { credentials: "include", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j && j.csrfToken) || readCookie(CSRF_COOKIE) || "")
        .catch(() => "")
        .finally(() => { csrfPromise = null; });
    }
    return csrfPromise;
  }

  // Aynı anda birden çok 401 gelirse tek refresh (paylaşılan promise).
  let refreshPromise = null;
  function tryRefresh() {
    if (!refreshPromise) {
      refreshPromise = fetch(API_BASE + "/auth/refresh", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}",
      })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  function parseApiBody(res) {
    if (res.status === 204) return Promise.resolve(null);
    return res.text().then((text) => {
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) { return { message: text }; }
    });
  }
  function toApiError(status, payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    const code = typeof p.error === "string" ? p.error : "";
    const serverMessage = typeof p.message === "string" ? p.message : "";
    // 429/5xx zarfları İngilizce/teknik olur; 400 doğrulama listesi de kullanıcıya gösterilmez.
    const preferStatus = status === 429 || status >= 500 || !serverMessage;
    const message = API_CODE_MESSAGES[code] || (preferStatus ? API_STATUS_MESSAGES[status] : serverMessage) ||
      serverMessage || API_STATUS_MESSAGES[status] || API_GENERIC_MESSAGE;
    return { status: status, code: code, message: message, payload: payload };
  }

  function apiRequest(url, method, bodyText, csrf, isAuthPath, retried) {
    const headers = { Accept: "application/json" };
    if (bodyText !== undefined) headers["Content-Type"] = "application/json";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return fetch(url, { method: method, headers: headers, body: bodyText, credentials: "include", cache: "no-store" }).then(
      (res) => parseApiBody(res).then((payload) => {
        if (res.ok) return payload;
        const err = toApiError(res.status, payload);
        if (res.status === 403 && err.code === "CSRF_INVALID" && !retried) {
          dropCookie(CSRF_COOKIE);
          return ensureCsrf().then((fresh) => apiRequest(url, method, bodyText, fresh, isAuthPath, true));
        }
        if (res.status !== 401 || isAuthPath) throw err;
        if (err.code === "TOKEN_EXPIRED" && !retried) {
          return tryRefresh().then((ok) => {
            if (ok) return ensureCsrf().then((fresh) => apiRequest(url, method, bodyText, fresh, isAuthPath, true));
            sessionLost();
            throw err;
          });
        }
        sessionLost();
        throw err;
      }),
      () => { throw { status: 0, code: "NETWORK", message: API_NETWORK_MESSAGE, payload: null }; },
    );
  }

  function api(path, opts) {
    opts = opts || {};
    const method = String(opts.method || "GET").toUpperCase();
    const url = path.indexOf("/api/") === 0 ? path : API_BASE + path;
    const apiPath = url.indexOf(API_BASE) === 0 ? url.slice(API_BASE.length) : url;
    const isAuthPath = AUTH_PATHS.some((p) => apiPath === p || apiPath.indexOf(p + "?") === 0);
    const bodyText = opts.body === undefined || opts.body === null ? undefined : JSON.stringify(opts.body);
    const mutating = method !== "GET" && method !== "HEAD";
    const prep = mutating ? ensureCsrf() : Promise.resolve("");
    return prep.then((csrf) => apiRequest(url, method, bodyText, csrf, isAuthPath, false));
  }

  // ---- F6 auth: oturum — tek kaynak bootstrap `__BAGDAM__.me` ({loggedIn,email,name,id} | null). ----
  // Sunucu çerezi görüp `me`'yi gömer (çerezli HTML no-store); localStorage'da oturum/üyelik izi yok.
  function me() {
    if (typeof __BAGDAM__ === "undefined" || !__BAGDAM__ || !__BAGDAM__.me || !__BAGDAM__.me.loggedIn) return null;
    return __BAGDAM__.me;
  }
  function isLoggedIn() {
    return !!me();
  }

  // Satın alınmış abonelik yalnızca sahibi oturumdayken "görünür" —
  // çıkış yapınca kutu/sepet sayfaları misafir görünümüne döner
  // (aboneliğin kaydı durur, ama arayüz onu yokmuş gibi gösterir).
  function hasPurchasedSub() {
    return isLoggedIn() && !!getSub().purchased;
  }

  // Sayfadaki auth kapılarının refresh'leri — oturum durumu değişince (çıkış, oturum düşmesi) hepsi koşar.
  const authRefreshers = [];
  function setSessionUser(user) {
    if (typeof window.__BAGDAM__ !== "object" || !window.__BAGDAM__) window.__BAGDAM__ = {};
    window.__BAGDAM__.me = user ? { loggedIn: true, id: user.id, email: user.email, name: user.name || null } : null;
    if (!user) addressCache = null;
    authRefreshers.forEach((fn) => { try { fn(); } catch (e) { /* sayfa kendi hatasını yönetir */ } });
  }
  // 401 (refresh de tutmadı): çerezleri sunucu sildi; sayfa "çıkış" durumuna döner, giriş kutusunda kısa not.
  function sessionLost() {
    const wasLoggedIn = isLoggedIn();
    dropCookie(CSRF_COOKIE);
    setSessionUser(null);
    const msgEl = document.getElementById("loginMsg");
    if (wasLoggedIn && msgEl) { msgEl.textContent = API_CODE_MESSAGES.TOKEN_EXPIRED; msgEl.hidden = false; msgEl.style.color = ""; }
  }
  function logout() {
    return api("/auth/logout", { method: "POST" })
      .catch(() => null)
      .then(() => { dropCookie(CSRF_COOKIE); setSessionUser(null); });
  }

  // Sayfa anonim render edildi ama csrf çerezi var (daha önce giriş yapılmış): access süresi dolmuş,
  // refresh (30 gün) hâlâ geçerli olabilir → bir kez sessizce POST /auth/refresh; tutarsa sayfa yenilenir
  // (bootstrap `me` dolu gelir), tutmazsa csrf çerezi silinir (bir daha denenmez). Döngü emniyeti:
  // sessionStorage damgası — 5 dk içinde ikinci deneme yok.
  const RECOVER_KEY = "bagdam_session_recover";
  function recoverSession() {
    if (isLoggedIn() || !readCookie(CSRF_COOKIE)) return;
    let last = 0;
    try { last = parseInt(sessionStorage.getItem(RECOVER_KEY) || "0", 10) || 0; } catch (e) { /* yok say */ }
    if (Date.now() - last < 5 * 60 * 1000) return;
    try { sessionStorage.setItem(RECOVER_KEY, String(Date.now())); } catch (e) { /* yok say */ }
    tryRefresh().then((ok) => { if (ok) location.reload(); else dropCookie(CSRF_COOKIE); });
  }
  function getResetToken() {
    return resetToken;
  }

  // ---- F6 auth: adres — GET/PUT /me/address (tek adres MVP); ilçe = teslimat bölgesi (GET /delivery/zones). ----
  // getAddress() senkron sayfa içi önbelleği döner (sayfa önce loadAddress() ile doldurur); setAddress() PUT eder.
  // İstemci şekli {name, phone, line, zoneSlug, district (bölge adı), zip} — sepet'in statik "Urla/Çeşme" select
  // değerleri bölge ADI olduğundan district↔zoneSlug çevirisi bölge listesiyle yapılır.
  const DEFAULT_ZONES = [{ slug: "urla", name: "Urla" }, { slug: "cesme", name: "Çeşme" }];
  let zonesCache = null;
  let addressCache = null;

  function getZones() {
    return zonesCache || DEFAULT_ZONES;
  }
  function loadZones() {
    if (zonesCache) return Promise.resolve(zonesCache);
    return api("/delivery/zones")
      .then((zones) => {
        if (Array.isArray(zones) && zones.length) zonesCache = zones.map((z) => ({ id: z.id, slug: z.slug, name: z.name }));
        return getZones();
      })
      .catch(() => getZones());
  }
  function trSlug(text) {
    return String(text || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase()
      .replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function zoneName(slug) {
    const z = getZones().find((x) => x.slug === slug);
    return z ? z.name : (slug || "");
  }
  function zoneSlugFor(nameOrSlug) {
    const z = getZones().find((x) => x.slug === nameOrSlug || x.name === nameOrSlug);
    return z ? z.slug : trSlug(nameOrSlug);
  }
  function toClientAddress(a) {
    if (!a || typeof a !== "object") return null;
    return {
      id: a.id || null, name: a.fullName || "", phone: a.phone || "", line: a.line || "",
      zoneSlug: a.zoneSlug || "", district: zoneName(a.zoneSlug), zip: a.zip || "",
    };
  }
  function getAddress() {
    return addressCache;
  }
  function loadAddress() {
    if (!isLoggedIn()) { addressCache = null; return Promise.resolve(null); }
    return api("/me/address").then((a) => { addressCache = toClientAddress(a); return addressCache; });
  }
  function setAddress(addr) {
    // zip her zaman gönderilir: boş "" → sunucu null yazar (mevcut posta kodu silinebilsin).
    const body = { fullName: addr.name, phone: addr.phone, line: addr.line, zoneSlug: addr.zoneSlug || zoneSlugFor(addr.district), zip: addr.zip || "" };
    return api("/me/address", { method: "PUT", body: body }).then((a) => {
      addressCache = toClientAddress(a) || Object.assign({ zoneSlug: body.zoneSlug, district: zoneName(body.zoneSlug) }, addr);
      return addressCache;
    });
  }

  // ---- F8 checkout: sepet → sipariş akışı yardımcıları (BACKEND-PLANI §3 checkout/orders/me satırları, ADR-0019) ----
  // Fiyat hesabı istemcide YAPILMAZ (P1): özet POST /checkout/quote'tan; sipariş POST /checkout; sonuç
  // GET /orders/:orderNo/status ile izlenir (PayTR iFrame callback'i sunucuya düşer). Kutu taslağı
  // (bahceden_sub: active && !purchased) ve tekil satırlar (bahceden_cart) tek yükte gönderilir.
  const FREQ_WEEKS_BY_ID = { "1hafta": 1, "2hafta": 2, "4hafta": 4 };
  function freqWeeks(freqId) {
    if (FREQ_WEEKS_BY_ID[freqId]) return FREQ_WEEKS_BY_ID[freqId];
    const m = /^(\d+)hafta$/.exec(String(freqId || ""));
    return m ? parseInt(m[1], 10) : 1;
  }
  // Sepetteki tekil satırlar → {id (slug), qty, pref?} (pref yalnız doluysa gönderilir).
  function checkoutLines() {
    return getCart()
      .filter((item) => item && item.id && item.qty > 0)
      .map((item) => (item.pref ? { id: item.id, qty: item.qty, pref: item.pref } : { id: item.id, qty: item.qty }));
  }
  // Sepetteki kutu taslağı → box yükü; kutu yoksa null. (Satın alınmış abonelik sepette değildir: purchased → null.)
  function checkoutBox() {
    const sub = getSub();
    if (!sub.active || sub.purchased || !sub.tierId) return null;
    if (typeof SUB_TIERS !== "undefined" && !SUB_TIERS.some((t) => t.id === sub.tierId)) return null;
    const box = {
      tier: sub.tierId,
      items: (sub.items || []).slice(),
      extras: (sub.extras || []).map((ex) => ({ id: ex.id, factor: ex.factor, label: ex.label })),
      isOneTime: sub.type === "onetime",
      frequencyWeeks: freqWeeks(sub.freq),
    };
    if (sub.deliveryDay) box.deliveryDay = sub.deliveryDay;
    // Kutu içi ürün tercihleri (kutu.html "nasıl istersin": {slug: etiket}) → cycle#1 CycleItem.pref (B DTO: box.itemPrefs).
    const prefs = sub.itemPrefs && typeof sub.itemPrefs === "object" ? sub.itemPrefs : null;
    if (prefs && Object.keys(prefs).some((k) => prefs[k])) {
      box.itemPrefs = {};
      Object.keys(prefs).forEach((k) => { if (prefs[k]) box.itemPrefs[k] = String(prefs[k]); });
    }
    return box;
  }
  // Teklif/sipariş yükünün ortak parçası: {lines, box?}. Boş sepette {lines:[]}.
  function buildCheckoutPayload() {
    const payload = { lines: checkoutLines() };
    const box = checkoutBox();
    if (box) payload.box = box;
    return payload;
  }
  function hasCheckoutItems() {
    return checkoutLines().length > 0 || !!checkoutBox();
  }
  // POST /checkout/quote (misafir de çağırabilir) → PricingResult + couponStatus.
  function quoteCheckout(extra) {
    return api("/checkout/quote", { method: "POST", body: Object.assign(buildCheckoutPayload(), extra || {}) });
  }
  // POST /checkout (oturumlu) → {orderNo, orderId, status, payment:{provider, checkoutFormContent?, redirectUrl?, token?}}.
  function submitCheckout(fields) {
    return api("/checkout", { method: "POST", body: Object.assign(buildCheckoutPayload(), fields || {}) });
  }
  // GET /orders/:orderNo/status (sahibi) → {status, paymentStatus, paidAt?, subscriptionStatus?, subscriptionId?}.
  function orderStatus(orderNo) {
    return api("/orders/" + encodeURIComponent(orderNo) + "/status");
  }
  // Sipariş durumunu aralıklarla sorar; PAID (ya da sonrası) / kesin başarısızlıkta çözülür, süre dolunca {timedOut:true}.
  // onTick(status) her yanıtta çağrılır. Dönen promise'in stop() yöntemiyle durdurulur (sayfa görünümü değişince).
  function pollOrderStatus(orderNo, opts) {
    opts = opts || {};
    const intervalMs = opts.intervalMs || 2000;
    const timeoutMs = opts.timeoutMs || 120000;
    const startedAt = Date.now();
    let stopped = false;
    let timer = null;
    const promise = new Promise((resolve) => {
      function tick() {
        if (stopped) return;
        orderStatus(orderNo).then(
          (s) => {
            if (stopped) return;
            if (typeof opts.onTick === "function") { try { opts.onTick(s); } catch (e) { /* sayfa kendi hatasını yönetir */ } }
            const st = s && s.status;
            if (st === "PAID" || st === "PREPARING" || st === "OUT_FOR_DELIVERY" || st === "DELIVERED") return resolve({ ok: true, status: s });
            if (st === "PAYMENT_FAILED" || st === "CANCELLED") return resolve({ ok: false, status: s });
            if (Date.now() - startedAt >= timeoutMs) return resolve({ ok: false, timedOut: true, status: s });
            timer = setTimeout(tick, intervalMs);
          },
          (err) => {
            if (stopped) return;
            // Oturum düştüyse ya da sipariş bulunamıyorsa (404: sahibi değil / yok) beklemenin anlamı yok; diğer hatalarda (ağ) denemeye devam.
            if (err && (err.status === 401 || err.status === 404)) return resolve({ ok: false, error: err });
            if (Date.now() - startedAt >= timeoutMs) return resolve({ ok: false, timedOut: true, error: err });
            timer = setTimeout(tick, intervalMs);
          },
        );
      }
      tick();
    });
    promise.stop = function () { stopped = true; if (timer) clearTimeout(timer); };
    return promise;
  }
  // GET /delivery/dates?zone= → [{id?, day, date, cutoffAtIso, locked, full}] (bölge başına 60 s önbellek).
  const deliveryDatesCache = {};
  function loadDeliveryDates(zoneSlug, weeks) {
    const zone = zoneSlug || "urla";
    const key = zone + ":" + (weeks || 4);
    const hit = deliveryDatesCache[key];
    if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.dates);
    return api("/delivery/dates?zone=" + encodeURIComponent(zone) + (weeks ? "&weeks=" + weeks : "")).then((dates) => {
      const list = Array.isArray(dates) ? dates : [];
      deliveryDatesCache[key] = { at: Date.now(), dates: list };
      return list;
    });
  }
  // Checkout'ta onay gerektiren belgeler: sayfaya gömülü __BAGDAM_CHECKOUT__.legal (WebController) ya da GET /legal.
  function loadLegalRequiresAck() {
    const embedded = typeof window.__BAGDAM_CHECKOUT__ === "object" && window.__BAGDAM_CHECKOUT__ && window.__BAGDAM_CHECKOUT__.legal;
    if (Array.isArray(embedded)) return Promise.resolve(embedded);
    return api("/legal").then((docs) =>
      (Array.isArray(docs) ? docs : [])
        .filter((d) => d && d.requiresAck)
        .map((d) => ({ slug: d.slug, kind: d.kind, title: d.title, version: d.version })),
    );
  }
  // Satın alınmış abonelik (GET /me/subscription) → bootstrap sub alanına yazılır; getSub()/hasPurchasedSub() onu okur.
  // F9: bootstrap `sub` alanı sunucudan dolu gelir (WebController); bu çağrı yalnız YEDEK — alan boşsa ya da
  // sayfa yenilenmeden tazeleme gerektiğinde (`force`) kullanılır. Oturum yoksa null.
  function loadSubscription(force) {
    if (!isLoggedIn()) return Promise.resolve(applyServerSub(null));
    if (!force && typeof __BAGDAM__ !== "undefined" && __BAGDAM__ && __BAGDAM__.sub) return Promise.resolve(__BAGDAM__.sub);
    return api("/me/subscription").then(applyServerSub);
  }
  // Saklı kartlar (PaymentMethod): GET /me/cards · DELETE /me/cards/:id · POST /me/cards/add-session (PayTR'de 501: kart ilk ödemede saklanır).
  function listCards() {
    return api("/me/cards").then((cards) => (Array.isArray(cards) ? cards : (cards && Array.isArray(cards.items) ? cards.items : [])));
  }
  function removeCard(id) {
    return api("/me/cards/" + encodeURIComponent(id), { method: "DELETE" });
  }
  function cardAddSession() {
    return api("/me/cards/add-session", { method: "POST", body: {} });
  }
  // Siparişler: GET /me/orders → {items:[OrderSummary], total} · GET /me/orders/:orderNo → Order (satırlar dahil).
  function listOrders() {
    return api("/me/orders").then((res) => (res && Array.isArray(res.items) ? res.items : (Array.isArray(res) ? res : [])));
  }
  function getOrder(orderNo) {
    return api("/me/orders/" + encodeURIComponent(orderNo));
  }
  // Aktif aboneye: sepetteki tekil satırları bu haftaki kutuya taşı (POST /me/subscription/cycles/current/merge-cart).
  function mergeCartIntoBox() {
    const lines = checkoutLines();
    if (!lines.length) return Promise.resolve(null);
    return api("/me/subscription/cycles/current/merge-cart", { method: "POST", body: { lines: lines } }).then((sub) => {
      const applied = applyServerSub(sub);
      setCart([]);
      return applied;
    });
  }

  // ---- F9 remote: CANLI abonelik adaptörü (BACKEND-PLANI §1.2 F9, ADR-0008) ------------------------------
  // Oturum açıksa ve satın alınmış bir abonelik varsa TÜM mutasyonlar API'ye gider; localStorage taslağı yalnız
  // satın ALINMAMIŞ kutu için kalır. Sunucu tek doğruluk kaynağıdır: her uç güncel `BootstrapSub` DTO'sunu döner,
  // DTO bootstrap'a yazılır (`applyServerSub`) ve sayfa ondan yeniden çizilir — OPTIMISTIC güncelleme YOK.
  // Hata → api() reddi ({status, code, message}); çağıran sayfa mesajı kendi kutusunda gösterir ve DTO'yu değiştirmez.
  const remote = {
    /** Canlı mod mu (oturum + satın alınmış abonelik). */
    isLive: hasPurchasedSub,
    /** Güncel DTO (canlı değilse null). */
    current: function () {
      return hasPurchasedSub() ? getSub() : null;
    },
    /** GET /me/subscription — bootstrap `sub` boşsa ya da force ile tazeleme. */
    load: loadSubscription,
    /** Kutu içeriği: swap (`items`) · ürün tercihi (`itemPrefs`) · ekstralar (`extras`) → PATCH …/cycles/current. */
    patchCycle: function (patch) {
      return api("/me/subscription/cycles/current", { method: "PATCH", body: patch || {} }).then(applyServerSub);
    },
    /** "bu haftaki kutuma ekle" (sepetten) → POST …/cycles/current/merge-cart; başarıda sepet boşalır. */
    mergeCart: mergeCartIntoBox,
    /** Bu haftayı atla → POST …/cycles/current/skip. */
    skip: function () {
      return api("/me/subscription/cycles/current/skip", { method: "POST", body: {} }).then(applyServerSub);
    },
    /** Atlamayı geri al (hak iade edilir) → DELETE …/cycles/current/skip. */
    unskip: function () {
      return api("/me/subscription/cycles/current/skip", { method: "DELETE" }).then(applyServerSub);
    },
    /** Frekans / teslimat günü / adres / kart → PATCH /me/subscription (tier ve type YOK — ADR-0008). */
    patchSubscription: function (patch) {
      return api("/me/subscription", { method: "PATCH", body: patch || {} }).then(applyServerSub);
    },
    /** İptal talebi → POST /me/subscription/cancel {reason,note} → `{cancellationId, offer}` (offer null olabilir). */
    cancel: function (reason, note) {
      const body = { reason: reason };
      if (note) body.note = note;
      return api("/me/subscription/cancel", { method: "POST", body: body });
    },
    /** Kalma teklifini kabul → POST …/retention/accept (abonelik ACTIVE'e döner, sonraki kutuda indirim). */
    acceptRetention: function () {
      return api("/me/subscription/retention/accept", { method: "POST", body: {} }).then(applyServerSub);
    },
    /** İptali onayla → POST …/cancel/confirm; sonrasında abonelik müşteriye görünmez (DTO null'lanır). */
    confirmCancel: function () {
      return api("/me/subscription/cancel/confirm", { method: "POST", body: {} }).then((res) => {
        applyServerSub(null);
        return res;
      });
    },
    /** İptalden vazgeç → POST …/cancel/abandon. */
    abandonCancel: function () {
      return api("/me/subscription/cancel/abandon", { method: "POST", body: {} }).then(applyServerSub);
    },
    /** Kart ekleme oturumu (PSP) → POST /me/cards/add-session (PayTR'de 501: kart ilk ödemede saklanır). */
    cardSession: cardAddSession,
  };
  // İptal akışındaki `data-reason` değerleri = shared CancelReason enum'u; etiketler Türkçe.
  const CANCEL_REASONS = [
    { value: "PRICE", label: "Fiyat" },
    { value: "VARIETY", label: "Ürün çeşitliliği" },
    { value: "DELIVERY_DAYS", label: "Teslimat günleri" },
    { value: "OTHER", label: "Diğer" },
  ];

  // Wires the shared login/signup auth-gate markup (#checkoutAuth + its tabs
  // and forms — same ids on every page that uses it) to show `gatedElId`
  // only once logged in. Returns the refresh function so the page can
  // re-run it after its own state changes (e.g. right before its first
  // render). `onLoginChange(loggedIn)` is optional, for pages that need to
  // do more than toggle visibility once auth state flips.
  // F6 auth: giriş/üye ol/parolamı unuttum/sıfırla API'ye bağlı (cookie oturum). Giriş/kayıt/sıfırlama
  // başarılıysa DOM anında güncellenmez, sayfa YENİLENİR: bootstrap `me` (ve F9'da `sub`) sunucudan tek
  // kaynaktan dolu gelir, çerezli yanıt no-store; login yanıtının şekli ile bootstrap'ınki ayrışamaz.
  // Çıkış / oturum düşmesi ise yenilemeden DOM'da "çıkış" durumuna döner (setSessionUser → refresh'ler).
  function wireAuthGate(gatedElId, onLoginChange) {
    const checkoutAuth = document.getElementById("checkoutAuth");
    const gatedEl = document.getElementById(gatedElId);
    if (!checkoutAuth || !gatedEl) return function () {};

    // Yalnızca giriş kutusunun kendi sekmeleri — aynı sınıfı başka yerde
    // kullanan sekme grupları (üyelikteki adres/ödeme/siparişler) buraya
    // bağlanmamalı, yoksa tıklamaları giriş/üye ol formlarını oynatır.
    const authTabs = checkoutAuth.querySelectorAll(".checkout-auth-tab");
    const authFormLogin = document.getElementById("authFormLogin");
    const authFormSignup = document.getElementById("authFormSignup");

    function showAuthMsg(el, text, ok) {
      if (!el) return;
      el.textContent = text || "";
      el.hidden = !text;
      // Başarı notları (bağlantı gönderildi, parola güncellendi) hata renginde görünmesin.
      el.style.color = ok ? "var(--olive-deep)" : "";
    }
    function busy(btn, on) { if (btn) btn.disabled = !!on; }
    function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
    function labelOf(id) { const el = document.getElementById(id); return el ? el.closest("label") : null; }

    function refresh() {
      const loggedIn = isLoggedIn();
      checkoutAuth.hidden = loggedIn;
      gatedEl.hidden = !loggedIn;
      // CSS'in oturum durumuna göre düzen kurabilmesi için (örn. mobil
      // sepette özet yalnızca girişten sonra görünür).
      document.body.classList.toggle("is-logged-in", loggedIn);
      if (onLoginChange) onLoginChange(loggedIn);
    }
    authRefreshers.push(refresh);

    authTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        authTabs.forEach((t) => t.classList.toggle("active", t === tab));
        const mode = tab.getAttribute("data-mode");
        authFormLogin.hidden = mode !== "login";
        authFormSignup.hidden = mode !== "signup";
      });
    });

    // Giriş / kayıt / sıfırlama sonrası: sayfa yenilenir (gerekçe yukarıda).
    function afterSignedIn() { location.reload(); }

    const loginBtn = document.getElementById("loginSubmit");
    const loginMsg = document.getElementById("loginMsg");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => {
        const email = val("loginEmail").trim();
        const password = val("loginPassword");
        if (!email || !password) { showAuthMsg(loginMsg, "E-posta ve parolanı gir."); return; }
        showAuthMsg(loginMsg, "");
        busy(loginBtn, true);
        api("/auth/login", { method: "POST", body: { email: email, password: password } })
          .then(afterSignedIn)
          .catch((err) => {
            busy(loginBtn, false);
            showAuthMsg(loginMsg, err.status === 401 ? "E-posta ya da parola hatalı." : err.message);
          });
      });
      const loginPasswordEl = document.getElementById("loginPassword");
      if (loginPasswordEl) loginPasswordEl.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); });
    }

    const signupBtn = document.getElementById("signupSubmit");
    const signupMsg = document.getElementById("signupMsg");
    if (signupBtn) {
      signupBtn.addEventListener("click", () => {
        const email = val("signupEmail").trim();
        const emailConfirm = val("signupEmailConfirm").trim();
        const password = val("signupPassword");
        const passwordConfirm = val("signupPasswordConfirm");
        // ADR-0003 istisna 2: KVKK aydınlatma onayı (zorunlu) + pazarlama izni (isteğe bağlı) kutucukları.
        const kvkkEl = document.getElementById("signupKvkk");
        const marketingEl = document.getElementById("signupMarketing");
        if (!email || !emailConfirm || !password || !passwordConfirm) { showAuthMsg(signupMsg, "Tüm alanları doldur."); return; }
        if (email !== emailConfirm) { showAuthMsg(signupMsg, "E-posta adresleri eşleşmiyor."); return; }
        if (password !== passwordConfirm) { showAuthMsg(signupMsg, "Parolalar eşleşmiyor."); return; }
        if (password.length < 8) { showAuthMsg(signupMsg, "Parola en az 8 karakter olmalı."); return; }
        if (kvkkEl && !kvkkEl.checked) { showAuthMsg(signupMsg, API_CODE_MESSAGES.KVKK_REQUIRED); return; }
        const consents = [{ kind: "KVKK_ACK", granted: true, documentSlug: "kvkk" }];
        if (marketingEl) consents.push({ kind: "MARKETING_EMAIL", granted: !!marketingEl.checked, documentSlug: "ticari-ileti-izni" });
        showAuthMsg(signupMsg, "");
        busy(signupBtn, true);
        api("/auth/register", { method: "POST", body: { email: email, password: password, consents: consents } })
          .then(afterSignedIn)
          .catch((err) => { busy(signupBtn, false); showAuthMsg(signupMsg, err.message); });
      });
    }

    // ADR-0003 istisna 4: "parolamı unuttum" — POST /auth/forgot (her zaman 200; kullanıcı var/yok sızdırılmaz).
    const forgotLink = document.getElementById("forgotLink");
    if (forgotLink) {
      forgotLink.addEventListener("click", (e) => {
        e.preventDefault();
        const email = val("loginEmail").trim();
        if (!email) {
          showAuthMsg(loginMsg, "Önce e-posta adresini yaz, sonra bağlantıya tıkla.");
          const emailEl = document.getElementById("loginEmail");
          if (emailEl) emailEl.focus();
          return;
        }
        showAuthMsg(loginMsg, "");
        api("/auth/forgot", { method: "POST", body: { email: email } })
          .then(() => showAuthMsg(loginMsg, "Bu e-posta kayıtlıysa sıfırlama bağlantısını gönderdik — gelen kutunu kontrol et.", true))
          .catch((err) => showAuthMsg(loginMsg, err.message));
      });
    }

    // ?sifirla=<token> (e-postadaki bağlantı): giriş formu içinde minimal sıfırlama dalı — e-posta/parola
    // alanları ve "giriş yap" gizlenir, "yeni parola" alanı + "parolamı yenile" açılır (istisna 4 kapsamı).
    const resetBtn = document.getElementById("resetSubmit");
    const resetInput = document.getElementById("resetPassword");
    if (resetBtn && resetInput && resetToken) {
      const loginOnly = [labelOf("loginEmail"), labelOf("loginPassword"), loginBtn, forgotLink ? forgotLink.closest("p") : null];
      function setResetMode(on) {
        loginOnly.forEach((el) => { if (el) el.hidden = on; });
        const resetLabel = resetInput.closest("label");
        if (resetLabel) resetLabel.hidden = !on;
        resetBtn.hidden = !on;
      }
      setResetMode(true);
      showAuthMsg(loginMsg, "Yeni parolanı belirle (en az 8 karakter).", true);
      function submitReset() {
        const password = resetInput.value;
        if (password.length < 8) { showAuthMsg(loginMsg, "Parola en az 8 karakter olmalı."); return; }
        showAuthMsg(loginMsg, "");
        busy(resetBtn, true);
        api("/auth/reset", { method: "POST", body: { token: resetToken, password: password } })
          .then(() => {
            try { sessionStorage.setItem("bagdam_flash", "Parolan güncellendi."); } catch (e2) { /* yok say */ }
            // Sunucu çerezle oturum açtıysa yenile (hesap görünür); açmadıysa giriş formuna dön.
            return api("/auth/me").then(afterSignedIn, () => {
              resetToken = null;
              try { sessionStorage.removeItem("bagdam_flash"); } catch (e2) { /* yok say */ }
              setResetMode(false);
              busy(resetBtn, false);
              showAuthMsg(loginMsg, "Parolan güncellendi — yeni parolanla giriş yapabilirsin.", true);
            });
          })
          .catch((err) => { busy(resetBtn, false); showAuthMsg(loginMsg, err.message); });
      }
      resetBtn.addEventListener("click", submitReset);
      resetInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitReset(); });
    }

    refresh();
    return refresh;
  }

  // F8 checkout: saklı kart (bahceden_card, getCard/setCard) kalktı — kart verisi hiçbir zaman istemcide tutulmaz;
  // PSP token'ı PaymentMethod'da (GET /me/cards). Kart ilk ödemede (PayTR iFrame, store_card) saklanır.

  function freshProducts() {
    if (typeof PRODUCTS === "undefined") return [];
    // F3 bootstrap: kutu havuzu sunucudan (__BAGDAM__.pool slug listesi, PRODUCTS sırasıyla); yoksa eski fresh filtresi.
    const pool = typeof __BAGDAM__ !== "undefined" && __BAGDAM__.pool;
    if (pool && pool.length) return PRODUCTS.filter((p) => pool.indexOf(p.id) !== -1);
    return PRODUCTS.filter((p) => p.fresh);
  }

  // Fills `count` slots, preferring products whose pref axis matches what the
  // shopper has already told us they like (ties the subscription default into
  // the same "sana özel" signal used elsewhere), then pads with the rest.
  function defaultFill(count) {
    const prefs = getPrefs();
    const pool = freshProducts();
    const scored = pool
      .map((p) => ({
        id: p.id,
        score: p.pref && prefs[p.pref.label] ? 1 : 0,
      }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((s) => s.id);
  }

  function subSetTier(tierId) {
    const tier = typeof SUB_TIERS !== "undefined" ? SUB_TIERS.find((t) => t.id === tierId) : null;
    if (!tier) return;
    const sub = getSub();
    sub.tierId = tierId;
    // F3 bootstrap: bu haftanın yayınlanmış şablonu varsa (__BAGDAM__.templates[tierId]) onunla doldur; yoksa eski defaultFill.
    const tpl = typeof __BAGDAM__ !== "undefined" && __BAGDAM__.templates && __BAGDAM__.templates[tierId];
    sub.items = tpl && tpl.length ? tpl.slice() : defaultFill(tier.count);
    setSub(sub);
  }

  function subTier() {
    const sub = getSub();
    return typeof SUB_TIERS !== "undefined" ? SUB_TIERS.find((t) => t.id === sub.tierId) : null;
  }

  // Swaps `outId` for `inId` in the current box (keeps slot count fixed).
  function subSwapItem(outId, inId) {
    const sub = getSub();
    const idx = sub.items.indexOf(outId);
    if (idx === -1) return;
    if (sub.items.indexOf(inId) !== -1) return; // already in the box
    sub.items[idx] = inId;
    setSub(sub);
  }

  // Each subscriber gets exactly one order-skip right. Un-skipping (cancelling
  // a pending skip) is always free; using a fresh skip permanently marks the
  // right as spent.
  function subToggleSkip() {
    const sub = getSub();
    if (!sub.skipThisWeek && sub.skipUsed) return;
    sub.skipThisWeek = !sub.skipThisWeek;
    if (sub.skipThisWeek) sub.skipUsed = true;
    setSub(sub);
  }

  // Records how the shopper wants a specific box item (e.g. bamya: "Küçük").
  // Also feeds the same axis into the global prefs used by defaultFill()/
  // renderRecommended(), so "how you like it" learning stays in one place.
  function subSetItemPref(productId, label, axis) {
    const sub = getSub();
    if (!sub.itemPrefs) sub.itemPrefs = {};
    sub.itemPrefs[productId] = label;
    setSub(sub);
    if (axis) recordPref(axis, label);
  }

  function subCancel() {
    setSub(Object.assign({}, SUB_DEFAULTS, { active: false }));
  }

  // ---- Box extras: unlimited one-off produce add-ons that ride on top of
  // the current box order (subscription or one-time). Amounts are picked in
  // g/kg (or adet/demet for count-priced products); `factor` multiplies the
  // product's own unit price, `label` is what the shopper picked ("500 g").
  function subExtraOptions(p) {
    if (!p) return [];
    if (p.unit === "kg") {
      return [
        { factor: 0.25, label: "250 g" },
        { factor: 0.5, label: "500 g" },
        { factor: 1, label: "1 kg" },
        { factor: 2, label: "2 kg" },
      ];
    }
    if (p.unit === "500 g") {
      return [
        { factor: 1, label: "500 g" },
        { factor: 2, label: "1 kg" },
        { factor: 3, label: "1,5 kg" },
      ];
    }
    // Count-priced products (adet, demet)
    return [1, 2, 3, 4].map((n) => ({ factor: n, label: n + " " + p.unit }));
  }

  function subExtraPrice(extra) {
    const p = typeof PRODUCTS !== "undefined" ? PRODUCTS.find((x) => x.id === extra.id) : null;
    return p ? Math.round(p.price * extra.factor) : 0;
  }

  function subExtrasTotal() {
    return (getSub().extras || []).reduce((sum, ex) => sum + subExtraPrice(ex), 0);
  }

  function subAddExtra(id, factor, label) {
    const sub = getSub();
    // Copy, don't push — a sub saved before extras existed borrows
    // SUB_DEFAULTS' own array via the shallow merge in getSub().
    sub.extras = (sub.extras || []).concat([{ id: id, factor: factor, label: label }]);
    // Stamp with this order's own cutoff so a renewed subscription starts
    // the following week plain (extras only ride on the order they were
    // added to — see getSub()'s expiry).
    sub.extrasCutoff = nextCutoff().getTime();
    setSub(sub);
  }

  function subRemoveExtra(index) {
    const sub = getSub();
    sub.extras = (sub.extras || []).filter((_, i) => i !== index);
    setSub(sub);
  }

  function subSetFreq(freqId) {
    const sub = getSub();
    sub.freq = freqId;
    const freq = typeof FREQ_OPTIONS !== "undefined" ? FREQ_OPTIONS.find((f) => f.id === freqId) : null;
    if (freq && freq.allDays) sub.deliveryDay = null;
    setSub(sub);
  }

  function subSetDeliveryDay(dayId) {
    const sub = getSub();
    sub.deliveryDay = dayId;
    setSub(sub);
  }

  function subSetType(type) {
    const sub = getSub();
    sub.type = type; // "subscription" | "onetime"
    setSub(sub);
  }

  function subDeliveryFee() {
    const sub = getSub();
    return sub.type === "onetime" ? (typeof DELIVERY_FEE !== "undefined" ? DELIVERY_FEE : 0) : 0;
  }

  // ---- F9 remote: kesim ve gün kilidi __BAGDAM__.deliveryDates'ten (DeliveryDate: mutlak `cutoffAtIso`,
  // `locked`, `full`) okunur; istemci saati yerine sunucu saati (serverNow farkı) kullanılır. Bootstrap'ta
  // liste yoksa (eski statik prototip, hata durumu) aşağıdaki YEREL hesaba düşülür — davranış birebir eski gibi.

  // Next occurrence of a given weekday (0 Sun ... 6 Sat) at 23:59. If today
  // already is that weekday past 23:59, rolls to next week.
  function nextWeekdayCutoff(targetDay) {
    const now = serverNow();
    const d = new Date(now);
    const day = d.getDay();
    let daysUntil = (targetDay - day + 7) % 7;
    if (daysUntil === 0 && now.getHours() >= 23 && now.getMinutes() >= 59) daysUntil = 7;
    d.setDate(d.getDate() + daysUntil);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  // Delivery day -> the weekday its own cutoff falls on (2 days before, 23:59).
  const CUTOFF_WEEKDAY = { sali: 0, persembe: 2, cumartesi: 4 }; // Sun, Tue, Thu
  const DELIVERY_DAY_IDS = ["sali", "persembe", "cumartesi"];

  /** Bootstrap teslimat tarihleri (`[{day,date,cutoffAtIso,locked,full}]`, tarihe göre sıralı); yoksa boş dizi. */
  function deliveryDatesList() {
    const list = typeof __BAGDAM__ !== "undefined" && __BAGDAM__ ? __BAGDAM__.deliveryDates : null;
    return Array.isArray(list) ? list : [];
  }
  function cutoffMsOf(row) {
    const t = row && row.cutoffAtIso ? Date.parse(row.cutoffAtIso) : NaN;
    return isNaN(t) ? null : t;
  }
  /** O teslimat gününün listedeki İLK tarihi (= bu haftaki sıradaki teslimat); yoksa null. */
  function firstDeliveryDateOf(dayId) {
    return deliveryDatesList().find((d) => d && d.day === dayId) || null;
  }
  /** O gün için kesimi geçmemiş, kapalı/dolu olmayan ilk tarih; yoksa null. */
  function nextOpenDeliveryDate(dayId) {
    const now = nowMs();
    return (
      deliveryDatesList().find((d) => {
        if (!d || d.day !== dayId || d.locked || d.full) return false;
        const t = cutoffMsOf(d);
        return t !== null && t > now;
      }) || null
    );
  }

  // Next edit cutoff for the current subscription: the chosen delivery day's
  // own cutoff, or — for "Haftada 3" (all three days) — whichever of the
  // three comes soonest. Falls back to Salı's cutoff if no day is set yet.
  function nextCutoff() {
    const sub = getSub();
    // F9 remote: canlı abonelikte kesim SUNUCUDAN — açık cycle'ın mutlak cutoffAt'i (istemci hesabı yok).
    if (sub.purchased) {
      const cycle = sub.currentCycle || sub.inFlightCycle || null;
      const iso = (cycle && cycle.cutoffAtIso) || sub.nextCutoffAtIso || null;
      const t = iso ? Date.parse(iso) : NaN;
      if (!isNaN(t)) return new Date(t);
    }
    const freq = typeof FREQ_OPTIONS !== "undefined" ? FREQ_OPTIONS.find((f) => f.id === sub.freq) : null;
    const allDays = !!(sub.type === "subscription" && freq && freq.allDays);
    // F9 remote: taslakta kesim deliveryDates'ten (seçili gün; "Haftada 3"te üçünün en yakını).
    if (deliveryDatesList().length) {
      const wanted = allDays
        ? DELIVERY_DAY_IDS
        : [sub.deliveryDay && CUTOFF_WEEKDAY.hasOwnProperty(sub.deliveryDay) ? sub.deliveryDay : "sali"];
      const hits = wanted.map(nextOpenDeliveryDate).map(cutoffMsOf).filter((t) => t !== null);
      if (hits.length) return new Date(Math.min.apply(null, hits));
    }
    if (allDays) {
      return Object.keys(CUTOFF_WEEKDAY)
        .map((id) => nextWeekdayCutoff(CUTOFF_WEEKDAY[id]))
        .reduce((soonest, d) => (d < soonest ? d : soonest));
    }
    const dayId = sub.deliveryDay && CUTOFF_WEEKDAY.hasOwnProperty(sub.deliveryDay) ? sub.deliveryDay : "sali";
    return nextWeekdayCutoff(CUTOFF_WEEKDAY[dayId]);
  }

  // Each delivery day locks at noon the day before it and stays locked
  // through the delivery day itself — Monday morning you can still pick
  // Salı, but from Pazartesi 12:00 on it's closed (you can't pick a day
  // that's already today either, let alone one that's passed this week).
  // The other two days still have lead time, so they stay open.
  // F9 remote: deliveryDates varsa kilit kararı ORADAN (kesim/kapasite tek kaynağı DeliveryDate).
  function isDeliveryDayLocked(dayId) {
    if (deliveryDatesList().length) {
      const first = firstDeliveryDateOf(dayId);
      if (!first) return false;
      const t = cutoffMsOf(first);
      return !!first.locked || !!first.full || (t !== null && t <= nowMs());
    }
    return legacyLockedDeliveryDay() === dayId;
  }
  function legacyLockedDeliveryDay() {
    const now = serverNow();
    const day = now.getDay(); // 0 Sun ... 6 Sat
    const afterNoon = now.getHours() >= 12;
    if ((day === 1 && afterNoon) || day === 2) return "sali";       // Pazartesi 12:00 (kesim) & Salı (teslimat günü)
    if ((day === 3 && afterNoon) || day === 4) return "persembe";   // Çarşamba 12:00 (kesim) & Perşembe (teslimat günü)
    if ((day === 5 && afterNoon) || day === 6) return "cumartesi";  // Cuma 12:00 (kesim) & Cumartesi (teslimat günü)
    return null;
  }
  function lockedDeliveryDay() {
    if (!deliveryDatesList().length) return legacyLockedDeliveryDay();
    return DELIVERY_DAY_IDS.find(isDeliveryDayLocked) || null;
  }

  // Kilitli (kesimi geçmiş ya da bugünkü) günü seçmek yasak değil — sadece
  // bu haftaya yetişmez. Seçilen gün kilitliyse, gün seçicilerin altında
  // gösterilecek ortak not metnini üretir; değilse null döner.
  function lockedDayNote(dayId) {
    if (!dayId || !isDeliveryDayLocked(dayId)) return null;
    const d = typeof DELIVERY_DAYS !== "undefined" ? DELIVERY_DAYS.find((x) => x.id === dayId) : null;
    if (!d) return null;
    return "Bu haftanın " + d.label + " kesimi kapandı — teslimatın önümüzdeki hafta " + d.label + " günü yapılır.";
  }

  function formatCountdown(target) {
    const diff = target.getTime() - nowMs();
    if (diff <= 0) return "kilitlendi";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return days + " gün " + hours + " sa";
    const mins = Math.floor((diff % 3600000) / 60000);
    return hours + " sa " + mins + " dk";
  }

  /** `YYYY-MM-DD` → "12 Eylül Cumartesi" (boş/geçersizse null) — teslimat tarihi metinleri tek yerde. */
  function formatDeliveryDate(isoDate) {
    if (!isoDate) return null;
    const d = new Date(String(isoDate) + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    return (
      d.toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) +
      " " +
      d.toLocaleDateString("tr-TR", { weekday: "long" })
    );
  }

  // Footer'daki IG/YT ikon sütununu her zaman yüzen sepetin hemen soluna
  // hizalar: ikonların sağ kenarı = sepetin sol kenarı − küçük boşluk.
  // Sepet ekranın sağına sabit (right:24px / mobilde 16px) olduğundan,
  // ikonların footer içindeki sağ boşluğu buna göre yeniden ölçülür.
  function alignFooterSocial() {
    const social = document.querySelector(".site-foot-social");
    if (!social) return;
    // sepet.html'de yüzen sepet yok — ikonlar en sağda kalır. Mobilde de
    // hizalama yapılmaz: yer dar, ikonlar iletişim satırının yanında durur.
    if (/(^|\/)sepet\.html$/.test(location.pathname) || window.innerWidth <= 900) {
      social.style.marginRight = "0px";
      return;
    }
    const top = document.querySelector(".site-foot-top");
    if (!top) return;
    const cart = ensureFloatingCart();
    const gap = 18; // ikonlar ile sepet arasındaki boşluk
    // Sepet giriş animasyonunda scale(.5) ile başladığından bounding rect
    // yanıltır — sağ boşluğu CSS'ten, genişliği offsetWidth'ten (transform
    // etkilemez) alıp sol kenarı kendimiz hesaplarız. Dock'lu (absolute)
    // durumda da yatay konum aynı kalır.
    // Sağ boşluk .floating-cart CSS'iyle aynı: 24px, mobilde (≤640) 16px.
    const cartRight = window.innerWidth <= 900 ? 16 : 24;
    const cartLeft = window.innerWidth - cartRight - cart.offsetWidth;
    const topRight = top.getBoundingClientRect().right;
    social.style.marginRight = Math.max(0, topRight - cartLeft + gap) + "px";
  }


  // ---- .swap-select için özel açılır liste (mobil + masaüstü): yerel
  // <select>'in açılma yönünü tarayıcı seçer (yukarı açabilir) ve görünümü
  // site diline uymaz. Select'e basınca yerel menü yerine hemen ALTINDA
  // krem bir liste açılır; seçim select.value'ya yazılıp "change"
  // tetiklenir — sayfaların mevcut change dinleyicileri aynen çalışır.
  let openSwapMenu = null;
  function closeSwapMenu() {
    if (openSwapMenu) { openSwapMenu.remove(); openSwapMenu = null; }
  }
  function openSwapMenuFor(sel) {
    closeSwapMenu();
    const menu = document.createElement("div");
    menu.className = "swap-menu";
    menu.setAttribute("role", "listbox");
    menu.innerHTML = Array.from(sel.options).map((o) =>
      '<button type="button" role="option" data-value="' + o.value + '"' +
      (o.value === sel.value ? ' aria-selected="true" class="active"' : "") + ">" + o.textContent + "</button>"
    ).join("");
    // Select'in hemen altına, aynı sol hizada; sayfa akışında (absolute)
    const r = sel.getBoundingClientRect();
    menu.style.top = (window.scrollY + r.bottom + 6) + "px";
    menu.style.left = (window.scrollX + r.left) + "px";
    menu.style.minWidth = Math.max(r.width, 160) + "px";
    document.body.appendChild(menu);
    // Sağdan taşarsa içeri çek
    const mr = menu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (mr.right > vw - 8) menu.style.left = Math.max(8, window.scrollX + vw - 8 - mr.width) + "px";
    openSwapMenu = menu;
    openSwapMenu._openedAt = Date.now();
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-value]");
      if (!btn) return;
      e.stopPropagation();
      if (sel.value !== btn.getAttribute("data-value")) {
        sel.value = btn.getAttribute("data-value");
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      closeSwapMenu();
    });
  }
  function wireSwapSelects() {
    // Yerel menüyü engellemek için mousedown/touchstart'ta preventDefault;
    // klavye kullanımı (Tab + ok) yerel select'te kalır.
    function onPress(e) {
      const sel = e.target.closest(".swap-select");
      if (!sel) return;
      e.preventDefault();
      if (e.type === "touchstart") sel.blur(); // iOS yerel tekerleği açmasın
      if (openSwapMenu && openSwapMenu._for === sel) { closeSwapMenu(); return; }
      openSwapMenuFor(sel);
      openSwapMenu._for = sel;
    }
    document.addEventListener("mousedown", onPress);
    document.addEventListener("touchstart", onPress, { passive: false });
    // Klavyeyle odaklanınca yerel menü açılmasın diye focus'ta da menüyü biz açarız.
    document.addEventListener("focusin", (e) => {
      const sel = e.target.closest && e.target.closest(".swap-select");
      if (sel && !(openSwapMenu && openSwapMenu._for === sel)) { openSwapMenuFor(sel); openSwapMenu._for = sel; }
    });
    document.addEventListener("click", (e) => {
      if (openSwapMenu && !e.target.closest(".swap-menu") && !e.target.closest(".swap-select")) closeSwapMenu();
    });
    // Açılışı izleyen ilk ~350ms'deki kaydırma (odaklanma/scrollIntoView
    // kaynaklı) menüyü kapatmasın; sonrası kullanıcı kaydırmasıdır.
    document.addEventListener("scroll", (e) => {
      if (!openSwapMenu) return;
      // Menünün KENDİ içindeki kaydırma (uzun ürün listesi) kapatmaz —
      // yalnızca sayfa/kapsayıcı kaydırması kapatır.
      if (e.target === openSwapMenu || (e.target.nodeType === 1 && openSwapMenu.contains(e.target))) return;
      if (Date.now() - openSwapMenu._openedAt > 350) closeSwapMenu();
    }, { passive: true, capture: true });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSwapMenu(); });
    window.addEventListener("resize", closeSwapMenu);
  }

  // Mobil hamburger: linkleri aç/kapat; dışarı tıklayınca, Esc ile ya da
  // bir linke gidince kapanır. Masaüstünde buton gizli, linkler hep açık.
  function wireNavBurger() {
    const burger = document.querySelector(".nav-burger");
    const links = document.getElementById("navLinks");
    if (!burger || !links) return;
    function setOpen(open) {
      links.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Menüyü kapat" : "Menü");
    }
    burger.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!links.classList.contains("open"));
    });
    links.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("click", (e) => {
      if (links.classList.contains("open") && !e.target.closest(".nav")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    recoverSession(); // F6 auth: csrf çerezi var ama oturum yoksa bir kez refresh dene
    wireToggles(document);
    wireAddButtons(document);
    wireNavBurger();
    wireSwapSelects();
    alignFooterSocial();
    window.addEventListener("resize", alignFooterSocial);
  });

  return {
    getCart, setCart, add, remove, setQty, count, updateBadge,
    getPrefs, recordPref, wireToggles, wireAddButtons, renderRecommended,
    cartQtyFor, stepperHtml, renderStepper, decrementCartProduct, renderCategoryPile, addFromSlot,
    getSub, setSub, subSetTier, subTier, subSwapItem, subToggleSkip, subCancel, subSetItemPref,
    subSetFreq, subSetDeliveryDay, subSetType, subDeliveryFee,
    subExtraOptions, subExtraPrice, subExtrasTotal, subAddExtra, subRemoveExtra,
    getAddress, setAddress, loadAddress, loadZones, getZones, zoneName, zoneSlugFor,
    // F6 auth: api() sözleşmesi + oturum (me/isLoggedIn bootstrap'tan; logout; getMember/setMember/setLoggedIn kalktı)
    api, me, isLoggedIn, hasPurchasedSub, setSessionUser, logout, getResetToken, wireAuthGate,
    // F8 checkout: getOrders/addOrder/nextDeliveryDate/getCard/setCard kalktı; yerine sunucu uçları
    clearSubDraft, buildCheckoutPayload, hasCheckoutItems, quoteCheckout, submitCheckout, orderStatus, pollOrderStatus,
    loadDeliveryDates, loadLegalRequiresAck, loadSubscription, listCards, removeCard, cardAddSession, listOrders, getOrder, mergeCartIntoBox,
    freshProducts, nextCutoff, formatCountdown, lockedDeliveryDay, lockedDayNote,
    // F9 remote: canlı abonelik adaptörü + sunucu saati + teslimat tarihi yardımcıları
    remote, CANCEL_REASONS, serverNow, applyServerSub,
    isDeliveryDayLocked, firstDeliveryDateOf, nextOpenDeliveryDate, formatDeliveryDate,
  };
})();
