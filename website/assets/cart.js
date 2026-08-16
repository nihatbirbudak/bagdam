const BahcedenCart = (function () {
  const CART_KEY = "bahceden_cart";
  const PREF_KEY = "bahceden_prefs";

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
  function count() {
    return getCart().reduce((sum, i) => sum + i.qty, 0);
  }
  function updateBadge() {
    document.querySelectorAll(".cart .mono").forEach((el) => {
      el.textContent = "(" + count() + ")";
    });
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

  // Wires every [data-add-to-cart] button: reads the active preference (if any)
  // in the same card and adds the product to the cart.
  function wireAddButtons(root) {
    (root || document).querySelectorAll("[data-add-to-cart]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-add-to-cart");
        const card = btn.closest("[data-pref-axis], .pcard, .product-detail");
        const activeToggle = card ? card.querySelector(".toggle.active") : null;
        add(id, activeToggle ? activeToggle.textContent.trim() : null);
        const original = btn.textContent;
        btn.textContent = "sepete eklendi";
        btn.classList.add("added");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("added");
        }, 1200);
      });
    });
  }

  // Renders a small "sana özel" strip into `container` based on stored prefs.
  // Falls back to an honest empty state when there is no interaction data yet.
  function renderRecommended(container, excludeIds) {
    if (!container || typeof PRODUCTS === "undefined") return;
    const prefs = getPrefs();
    const axisLabels = Object.keys(prefs);
    excludeIds = excludeIds || [];

    if (axisLabels.length === 0) {
      container.innerHTML =
        '<p class="reco-empty mono">seçimlerini yaptıkça burada senin için öneriler belirir.</p>';
      return;
    }

    // Fresh items are box-only — never recommend them as a standalone add-on.
    const scored = PRODUCTS.filter((p) => !p.fresh && excludeIds.indexOf(p.id) === -1).map((p) => {
      let score = 0;
      if (p.pref && prefs[p.pref.label]) {
        score += p.pref.options.indexOf(prefs[p.pref.label]) !== -1 ? 2 : 1;
      }
      return { p: p, score: score };
    });
    scored.sort((a, b) => b.score - a.score);
    const picked = scored.slice(0, 3).map((s) => s.p);

    const lastAxis = axisLabels[axisLabels.length - 1];
    const lastVal = prefs[lastAxis];
    container.innerHTML =
      '<p class="reco-hint mono">SON SEÇİMİN: ' + lastAxis.toUpperCase() + " — " + lastVal.toUpperCase() + "</p>" +
      '<div class="reco-grid">' +
      picked
        .map(
          (p) =>
            '<a class="reco-card" href="urun.html?id=' + p.id + '">' +
            '<img src="' + p.img + '" alt="' + p.name + '" loading="lazy">' +
            '<span>' + p.name + "</span>" +
            "</a>"
        )
        .join("") +
      "</div>";
  }

  // ---- Subscription (weekly box) ----
  const SUB_KEY = "bahceden_sub";

  const SUB_DEFAULTS = { tierId: null, items: [], skipThisWeek: false, freq: "1hafta", type: "subscription", itemPrefs: {} };

  function getSub() {
    // Merge with defaults so subs saved before freq/type existed still work.
    return Object.assign({}, SUB_DEFAULTS, readJSON(SUB_KEY, {}));
  }
  function setSub(sub) {
    writeJSON(SUB_KEY, sub);
  }

  // ---- Address (üyelik.html) ----
  const ADDRESS_KEY = "bahceden_address";

  function getAddress() {
    return readJSON(ADDRESS_KEY, null);
  }
  function setAddress(addr) {
    writeJSON(ADDRESS_KEY, addr);
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

  function subToggleSkip() {
    const sub = getSub();
    sub.skipThisWeek = !sub.skipThisWeek;
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

  function subSetFreq(freqId) {
    const sub = getSub();
    sub.freq = freqId;
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

  // Next edit cutoff: the coming Tuesday 23:59 (Thursday harvest / Friday
  // delivery rhythm — edits must land before harvesting starts).
  function nextCutoff() {
    const now = new Date();
    const d = new Date(now);
    const day = d.getDay(); // 0 Sun ... 2 Tue
    let daysUntilTue = (2 - day + 7) % 7;
    if (daysUntilTue === 0 && now.getHours() >= 23 && now.getMinutes() >= 59) daysUntilTue = 7;
    d.setDate(d.getDate() + daysUntilTue);
    d.setHours(23, 59, 0, 0);
    return d;
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

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    wireToggles(document);
    wireAddButtons(document);
  });

  return {
    getCart, setCart, add, remove, setQty, count, updateBadge,
    getPrefs, recordPref, wireToggles, wireAddButtons, renderRecommended,
    getSub, setSub, subSetTier, subTier, subSwapItem, subToggleSkip, subCancel, subSetItemPref,
    subSetFreq, subSetType, subDeliveryFee,
    getAddress, setAddress,
    freshProducts, nextCutoff, formatCountdown,
  };
})();
