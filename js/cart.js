/* ============================================================
   SCOTS — cart.js
   Persistent cart (localStorage) + Buy Now (sessionStorage)
   + cart page renderer.
   ============================================================ */

const Cart = {
  items() { return DB.getCart(); },

  count() { return this.items().reduce((s, c) => s + c.qty, 0); },

  qtyOf(itemId) {
    const line = this.items().find(c => c.itemId === itemId);
    return line ? line.qty : 0;
  },

  hasItems() { return this.items().length > 0; },

  add(itemId) {
    const item = DB.getMenuItem(itemId);
    if (!item) return;
    if (item.soldOut || !item.available) { toast("Sorry, that item is sold out.", "warn"); return; }
    const cart = this.items();
    const line = cart.find(c => c.itemId === itemId);
    if (line) line.qty += 1; else cart.push({ itemId, qty: 1 });
    DB.saveCart(cart);
    toast("Added to cart", "success");
    updateCartBadge();
  },

  changeQty(itemId, delta) {
    let cart = this.items();
    const line = cart.find(c => c.itemId === itemId);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) {
      cart = cart.filter(c => c.itemId !== itemId);
      toast("Removed from cart");
    }
    DB.saveCart(cart);
    updateCartBadge();
  },

  remove(itemId) {
    DB.saveCart(this.items().filter(c => c.itemId !== itemId));
    toast("Removed from cart");
    updateCartBadge();
  },

  clear() { DB.saveCart([]); updateCartBadge(); },

  /* Buy Now bypasses the persistent cart entirely (sessionStorage) */
  buyNow(itemId) {
    const item = DB.getMenuItem(itemId);
    if (!item) return;
    if (item.soldOut || !item.available) { toast("Sorry, that item is sold out.", "warn"); return; }
    const user = DB.getCurrentUser();
    if (!user) {
      sessionStorage.setItem("scots_buy_now", JSON.stringify({ itemId, qty: 1 }));
      toast("Please log in to place your order", "warn");
      setTimeout(() => location.href = ROOT + "login.html", 700);
      return;
    }
    if (user.role !== "student") { toast("Only customer accounts can place orders.", "warn"); return; }
    sessionStorage.setItem("scots_buy_now", JSON.stringify({ itemId, qty: 1 }));
    location.href = ROOT + "checkout.html?mode=buynow";
  },

  getBuyNow() {
    try { return JSON.parse(sessionStorage.getItem("scots_buy_now")); }
    catch { return null; }
  },
  setBuyNowQty(qty) {
    const bn = this.getBuyNow();
    if (bn) { bn.qty = Math.max(1, qty); sessionStorage.setItem("scots_buy_now", JSON.stringify(bn)); }
  },
  clearBuyNow() { sessionStorage.removeItem("scots_buy_now"); },

  /* Resolves cart/buy-now lines into full item objects */
  resolveLines(source) {
    const lines = source === "buynow"
      ? (this.getBuyNow() ? [this.getBuyNow()] : [])
      : this.items();
    return lines.map(l => {
      const item = DB.getMenuItem(l.itemId);
      return item ? { ...item, qty: l.qty } : null;
    }).filter(Boolean);
  },

  totals(source) {
    const lines = this.resolveLines(source);
    const subtotal = lines.reduce((s, i) => s + i.price * i.qty, 0);
    const fee = lines.length ? DB.getSettings().serviceFee : 0;
    const prep = lines.reduce((s, i) => s + i.prepTime * i.qty, 0);
    return { lines, subtotal, fee, total: subtotal + fee, prep };
  },
};

/* ============================================================
   Cart page renderer (cart.html)
   ============================================================ */
const CartPage = {
  init() {
    const user = Auth.guard("student");
    if (!user) return;
    this.render();
  },

  render() {
    const list = document.getElementById("cart-items");
    const summary = document.getElementById("cart-summary");
    const { lines, subtotal, fee, total, prep } = Cart.totals("cart");

    if (!lines.length) {
      list.innerHTML = emptyStateHTML(
        "🛒",
        "Your cart is waiting for something delicious",
        "Browse the menu and add a few favourites — they will show up here.",
        `<a class="btn btn-primary" href="menu.html">Browse the menu</a>`
      );
      summary.classList.add("hidden");
      return;
    }
    summary.classList.remove("hidden");

    list.innerHTML = lines.map(i => `
      <div class="cart-item">
        <img src="${i.image}" alt="${U.esc(i.name)}">
        <div>
          <div class="ci-name">${U.esc(i.name)}</div>
          <div class="ci-meta">${U.esc(i.category)} · ⏱ ${i.prepTime} min prep</div>
          <div class="ci-price">${U.rupees(i.price)} <span class="text-muted" style="font-weight:400">each</span></div>
        </div>
        <div class="ci-right">
          <div class="qty-stepper" role="group" aria-label="Quantity for ${U.esc(i.name)}">
            <button data-cp-dec="${i.id}" aria-label="Decrease quantity">−</button>
            <span class="qty-val">${i.qty}</span>
            <button data-cp-inc="${i.id}" aria-label="Increase quantity">+</button>
          </div>
          <strong>${U.rupees(i.price * i.qty)}</strong>
          <button class="remove-link" data-cp-rm="${i.id}">Remove</button>
        </div>
      </div>`).join("");

    document.getElementById("cp-subtotal").textContent = U.rupees(subtotal);
    document.getElementById("cp-fee").textContent = U.rupees(fee);
    document.getElementById("cp-total").textContent = U.rupees(total);
    document.getElementById("cp-prep").textContent = "~" + prep + " min total prep";
    const est = Queue.computeETA(prep, "asap");
    document.getElementById("cp-slot").textContent = "Normal queue: ready ~" + TimeUtil.clockLabel(est.etaDate);

    list.querySelectorAll("[data-cp-inc]").forEach(b => b.onclick = () => { Cart.changeQty(b.dataset.cpInc, 1); this.render(); });
    list.querySelectorAll("[data-cp-dec]").forEach(b => b.onclick = () => { Cart.changeQty(b.dataset.cpDec, -1); this.render(); });
    list.querySelectorAll("[data-cp-rm]").forEach(b => b.onclick = () => { Cart.remove(b.dataset.cpRm); this.render(); });

    document.getElementById("proceed-btn").onclick = () => {
      if (!TimeUtil.isOpen()) {
        toast("Ordering is currently closed. We open " + TimeUtil.nextOpeningLabel() + ".", "warn");
        return;
      }
      location.href = "checkout.html";
    };
  },
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("cart-items")) CartPage.init();
});
