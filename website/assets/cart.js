const BahcedenCart = (function () {
  const CART_KEY = "bahceden_cart";
  const PREF_KEY = "bahceden_prefs";

  // Tasarım prototipi test kolaylığı: herhangi bir sayfanın adresine
  // ?sifirla ekleyince tüm yerel kayıtlar (üyelik, oturum, abonelik, sepet,
  // siparişler, adres, kart, indirim hakkı) temizlenir — siteyi ilk kez
  // gelen bir ziyaretçi gibi baştan denemek için.
  try {
    if (new URLSearchParams(window.location.search).has("sifirla")) {
      [
        "bahceden_cart", "bahceden_prefs", "bahceden_sub", "bahceden_address",
        "bahceden_member", "bahceden_session", "bahceden_card",
        "bahceden_orders", "bahceden_retention_offered",
      ].forEach((k) => localStorage.removeItem(k));
      history.replaceState(null, "", window.location.pathname);
    }
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
    if (sub.extras.length && sub.extrasCutoff && Date.now() > sub.extrasCutoff) {
      sub.extras = [];
      sub.extrasCutoff = null;
      writeJSON(SUB_KEY, sub);
    }
    return sub;
  }
  function setSub(sub) {
    writeJSON(SUB_KEY, sub);
    updateBadge();
  }

  // ---- Sipariş geçmişi — üyelik sayfasındaki "önceki siparişler" alanı
  // buradan beslenir. Her tamamlanan ödeme bir kayıt düşer (en yeni üstte).
  const ORDERS_KEY = "bahceden_orders";

  function getOrders() {
    return readJSON(ORDERS_KEY, []);
  }
  function addOrder(order) {
    const orders = getOrders();
    // Sıralı sipariş numarası — ilk sipariş #1001, sonrakiler artarak.
    order.no = orders.length && orders[0].no ? orders[0].no + 1 : 1001;
    orders.unshift(order);
    writeJSON(ORDERS_KEY, orders);
  }

  // Seçilen teslimat gününün gerçekleşeceği tarih: haftanın bir sonraki o
  // günü; gün kilitliyse (kesim geçti / bugün) bir hafta sonrası.
  const DELIVERY_WEEKDAY = { sali: 2, persembe: 4, cumartesi: 6 };
  function nextDeliveryDate(dayId) {
    const target = DELIVERY_WEEKDAY[dayId];
    if (target === undefined) return null;
    const d = new Date();
    let diff = (target - d.getDay() + 7) % 7;
    if (lockedDeliveryDay() === dayId) diff = diff === 0 ? 7 : diff + 7;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ---- Address (üyelik.html) ----
  const ADDRESS_KEY = "bahceden_address";

  function getAddress() {
    return readJSON(ADDRESS_KEY, null);
  }
  function setAddress(addr) {
    writeJSON(ADDRESS_KEY, addr);
  }

  // ---- Membership + session (checkout login/signup gate) — a design-only
  // stand-in for real auth: the "account" is just an email/password pair
  // sitting in localStorage, and "logged in" is a separate flag so the two
  // can be checked independently.
  const MEMBER_KEY = "bahceden_member";
  const SESSION_KEY = "bahceden_session";

  function getMember() {
    return readJSON(MEMBER_KEY, null);
  }
  // Yeni üyelik = temiz hesap. Bu prototipte tüm kişisel kayıtlar (adres,
  // kart, abonelik, sipariş geçmişi, indirim hakkı) tarayıcıda durduğu
  // için, farklı bir e-postayla üye olunca öncekinin verileri kalmamalı —
  // yoksa yeni üye sepette/üyelikte eski üyenin bilgilerini dolu görür.
  function setMember(member) {
    const previous = getMember();
    if (!previous || previous.email !== member.email) {
      // Anahtarlar açık yazıldı: CARD_KEY bu fonksiyondan sonra tanımlanıyor
      // (const), buradan ada erişmek "önce başlatılmalı" hatası verir.
      ["bahceden_address", "bahceden_card", "bahceden_sub", "bahceden_orders", "bahceden_prefs", "bahceden_retention_offered"]
        .forEach((k) => localStorage.removeItem(k));
    }
    writeJSON(MEMBER_KEY, member);
  }
  function isLoggedIn() {
    return !!readJSON(SESSION_KEY, null);
  }

  // Satın alınmış abonelik yalnızca sahibi oturumdayken "görünür" —
  // çıkış yapınca kutu/sepet sayfaları misafir görünümüne döner
  // (aboneliğin kaydı durur, ama arayüz onu yokmuş gibi gösterir).
  function hasPurchasedSub() {
    return isLoggedIn() && !!getSub().purchased;
  }
  function setLoggedIn(value) {
    writeJSON(SESSION_KEY, value ? { loggedIn: true } : null);
  }

  // Wires the shared login/signup auth-gate markup (#checkoutAuth + its tabs
  // and forms — same ids on every page that uses it) to show `gatedElId`
  // only once logged in. Returns the refresh function so the page can
  // re-run it after its own state changes (e.g. right before its first
  // render). `onLoginChange(loggedIn)` is optional, for pages that need to
  // do more than toggle visibility once auth state flips.
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

    function showAuthMsg(el, text) {
      el.textContent = text;
      el.hidden = false;
    }

    function refresh() {
      const loggedIn = isLoggedIn();
      checkoutAuth.hidden = loggedIn;
      gatedEl.hidden = !loggedIn;
      // CSS'in oturum durumuna göre düzen kurabilmesi için (örn. mobil
      // sepette özet yalnızca girişten sonra görünür).
      document.body.classList.toggle("is-logged-in", loggedIn);
      if (onLoginChange) onLoginChange(loggedIn);
    }

    authTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        authTabs.forEach((t) => t.classList.toggle("active", t === tab));
        const mode = tab.getAttribute("data-mode");
        authFormLogin.hidden = mode !== "login";
        authFormSignup.hidden = mode !== "signup";
      });
    });

    const loginBtn = document.getElementById("loginSubmit");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => {
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;
        const msgEl = document.getElementById("loginMsg");
        if (!email || !password) { showAuthMsg(msgEl, "E-posta ve parolanı gir."); return; }
        const member = getMember();
        if (!member) { showAuthMsg(msgEl, "Bu e-postayla bir hesap bulamadık — üye ol."); return; }
        if (member.email !== email || member.password !== password) { showAuthMsg(msgEl, "E-posta ya da parola hatalı."); return; }
        setLoggedIn(true);
        refresh();
      });
    }

    const signupBtn = document.getElementById("signupSubmit");
    if (signupBtn) {
      signupBtn.addEventListener("click", () => {
        const email = document.getElementById("signupEmail").value.trim();
        const emailConfirm = document.getElementById("signupEmailConfirm").value.trim();
        const password = document.getElementById("signupPassword").value;
        const passwordConfirm = document.getElementById("signupPasswordConfirm").value;
        const msgEl = document.getElementById("signupMsg");
        if (!email || !emailConfirm || !password || !passwordConfirm) { showAuthMsg(msgEl, "Tüm alanları doldur."); return; }
        if (email !== emailConfirm) { showAuthMsg(msgEl, "E-posta adresleri eşleşmiyor."); return; }
        if (password !== passwordConfirm) { showAuthMsg(msgEl, "Parolalar eşleşmiyor."); return; }
        setMember({ email: email, password: password });
        setLoggedIn(true);
        refresh();
      });
    }

    refresh();
    return refresh;
  }

  // ---- Saved card (üyelik.html) ----
  const CARD_KEY = "bahceden_card";

  function getCard() {
    return readJSON(CARD_KEY, null);
  }
  function setCard(card) {
    writeJSON(CARD_KEY, card);
  }

  function freshProducts() {
    return typeof PRODUCTS === "undefined" ? [] : PRODUCTS.filter((p) => p.fresh);
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
    sub.items = defaultFill(tier.count);
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

  // Next occurrence of a given weekday (0 Sun ... 6 Sat) at 23:59. If today
  // already is that weekday past 23:59, rolls to next week.
  function nextWeekdayCutoff(targetDay) {
    const now = new Date();
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

  // Next edit cutoff for the current subscription: the chosen delivery day's
  // own cutoff, or — for "Haftada 3" (all three days) — whichever of the
  // three comes soonest. Falls back to Salı's cutoff if no day is set yet.
  function nextCutoff() {
    const sub = getSub();
    const freq = typeof FREQ_OPTIONS !== "undefined" ? FREQ_OPTIONS.find((f) => f.id === sub.freq) : null;
    const allDays = sub.type === "subscription" && freq && freq.allDays;
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
  function lockedDeliveryDay() {
    const now = new Date();
    const day = now.getDay(); // 0 Sun ... 6 Sat
    const afterNoon = now.getHours() >= 12;
    if ((day === 1 && afterNoon) || day === 2) return "sali";       // Pazartesi 12:00 (kesim) & Salı (teslimat günü)
    if ((day === 3 && afterNoon) || day === 4) return "persembe";   // Çarşamba 12:00 (kesim) & Perşembe (teslimat günü)
    if ((day === 5 && afterNoon) || day === 6) return "cumartesi";  // Cuma 12:00 (kesim) & Cumartesi (teslimat günü)
    return null;
  }

  // Kilitli (kesimi geçmiş ya da bugünkü) günü seçmek yasak değil — sadece
  // bu haftaya yetişmez. Seçilen gün kilitliyse, gün seçicilerin altında
  // gösterilecek ortak not metnini üretir; değilse null döner.
  function lockedDayNote(dayId) {
    if (!dayId || dayId !== lockedDeliveryDay()) return null;
    const d = typeof DELIVERY_DAYS !== "undefined" ? DELIVERY_DAYS.find((x) => x.id === dayId) : null;
    if (!d) return null;
    return "Bu haftanın " + d.label + " kesimi kapandı — teslimatın önümüzdeki hafta " + d.label + " günü yapılır.";
  }

  function formatCountdown(target) {
    const diff = target.getTime() - new Date().getTime();
    if (diff <= 0) return "kilitlendi";
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return days + " gün " + hours + " sa";
    const mins = Math.floor((diff % 3600000) / 60000);
    return hours + " sa " + mins + " dk";
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
    getAddress, setAddress, getOrders, addOrder, nextDeliveryDate,
    getMember, setMember, isLoggedIn, setLoggedIn, hasPurchasedSub, wireAuthGate, getCard, setCard,
    freshProducts, nextCutoff, formatCountdown, lockedDeliveryDay, lockedDayNote,
  };
})();
