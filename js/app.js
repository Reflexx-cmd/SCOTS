/* ============================================================
   SCOTS — app.js
   Shared UI layer: navbar, footer, toasts, modals, badges,
   food cards, expiry sweep, scroll reveals.
   ============================================================ */

/* Path prefix: sub-directory pages set <body data-root="../"> */
const ROOT = document.body ? (document.body.dataset.root || "") : "";

/* ---------- Toast system ---------- */
function toast(message, type) {
  let zone = document.querySelector(".toast-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.className = "toast-zone";
    zone.setAttribute("aria-live", "polite");
    document.body.appendChild(zone);
  }
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  const icons = { success: "✓", error: "✕", warn: "!" };
  el.innerHTML = (icons[type] ? `<strong>${icons[type]}</strong>` : "") + `<span>${U.esc(message)}</span>`;
  zone.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

/* ---------- Modal system ---------- */
function openModal(html, opts) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "scots-modal";
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-head">
        <button class="modal-close" aria-label="Close dialog" data-modal-close>✕</button>
      </div>
      ${html}
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlay.classList.add("open"));
  overlay.addEventListener("click", e => {
    if (e.target === overlay || e.target.closest("[data-modal-close]")) {
      if (!opts || !opts.sticky) closeModal();
    }
  });
  document.addEventListener("keydown", escCloseModal);
  const first = overlay.querySelector("button:not([data-modal-close]), input, select");
  if (first) first.focus();
  return overlay;
}
function escCloseModal(e) { if (e.key === "Escape") closeModal(); }
function closeModal() {
  const m = document.getElementById("scots-modal");
  if (m) { m.classList.remove("open"); setTimeout(() => m.remove(), 180); }
  document.body.style.overflow = "";
  document.removeEventListener("keydown", escCloseModal);
}

/* Confirmation dialog returning a Promise<boolean> */
function confirmDialog(title, message, confirmLabel) {
  return new Promise(resolve => {
    const overlay = openModal(`
      <h3>${U.esc(title)}</h3>
      <p class="modal-sub">${U.esc(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-no>Cancel</button>
        <button class="btn btn-primary" data-yes>${U.esc(confirmLabel || "Confirm")}</button>
      </div>`);
    overlay.querySelector("[data-no]").onclick = () => { closeModal(); resolve(false); };
    overlay.querySelector("[data-yes]").onclick = () => { closeModal(); resolve(true); };
  });
}

/* ---------- Status badges ---------- */
const STATUS_LABELS = {
  received: "Received", preparing: "Preparing", ready: "Ready",
  collected: "Collected", completed: "Completed", expired: "Expired", cancelled: "Cancelled",
};
function statusBadge(status, pulse) {
  return `<span class="status-pill status-${status}${pulse ? " pulse" : ""}">${STATUS_LABELS[status] || U.esc(status)}</span>`;
}
function paymentBadge(payment) {
  if (!payment) return "";
  if (payment.status === "paid") return `<span class="pill green">UPI Paid</span>`;
  if (payment.status === "forfeited") return `<span class="pill red">Payment Forfeited</span>`;
  return `<span class="pill">Cash-at-Pickup</span>`;
}

/* ---------- Food card component ---------- */
function foodCardHTML(item, cartQty, buyNowEnabled) {
  const soldOut = item.soldOut || !item.available;
  const img = ROOT + item.image;
  let actions;
  if (soldOut) {
    actions = `<button class="btn btn-ghost" disabled style="flex:1">Sold Out</button>`;
  } else if (cartQty > 0) {
    actions = `
      <div class="qty-stepper" data-item="${item.id}" role="group" aria-label="Quantity for ${U.esc(item.name)}">
        <button data-qty-dec="${item.id}" aria-label="Decrease quantity">−</button>
        <span class="qty-val" data-qty-val="${item.id}">${cartQty}</span>
        <button data-qty-inc="${item.id}" aria-label="Increase quantity">+</button>
      </div>`;
  } else {
    actions = `
      <button class="btn btn-soft btn-sm" data-add-cart="${item.id}">Add to Cart</button>
      <button class="btn btn-primary btn-sm" data-buy-now="${item.id}" ${buyNowEnabled ? "" : "disabled"}>Buy Now</button>`;
  }
  return `
    <article class="food-card${soldOut ? " soldout" : ""}" data-food-card="${item.id}">
      <div class="food-media">
        <img src="${img}" alt="${U.esc(item.name)}" loading="lazy">
        <div class="food-badges">
          ${item.popular ? `<span class="pill orange">Popular</span>` : ""}
          ${soldOut && !item.soldOut ? `<span class="pill dark">Unavailable</span>` : ""}
        </div>
      </div>
      <div class="food-body">
        <div class="food-top">
          <h3 class="food-name">${U.esc(item.name)}</h3>
          <span class="food-price">${U.rupees(item.price)}</span>
        </div>
        <div class="food-meta">
          <span class="rating">★ ${item.rating.toFixed(1)}</span>
          <span>⏱ ${item.prepTime} min</span>
          <span>${U.esc(item.category)}</span>
        </div>
        <p class="food-ingredients">${U.esc(item.ingredients)}</p>
        <div class="food-actions">${actions}</div>
      </div>
    </article>`;
}

/* Delegated wiring for food cards inside a container */
function wireFoodCards(container, onChange) {
  container.addEventListener("click", e => {
    const add = e.target.closest("[data-add-cart]");
    const buy = e.target.closest("[data-buy-now]");
    const inc = e.target.closest("[data-qty-inc]");
    const dec = e.target.closest("[data-qty-dec]");
    if (add) { Cart.add(add.dataset.addCart); onChange && onChange(); }
    if (buy) { Cart.buyNow(buy.dataset.buyNow); }
    if (inc) { Cart.changeQty(inc.dataset.qtyInc, +1); onChange && onChange(); }
    if (dec) { Cart.changeQty(dec.dataset.qtyDec, -1); onChange && onChange(); }
  });
}

/* ---------- Empty state component ---------- */
function emptyStateHTML(icon, title, message, ctaHTML) {
  return `
    <div class="empty-state">
      <div class="es-icon" aria-hidden="true">${icon}</div>
      <h3>${U.esc(title)}</h3>
      <p>${U.esc(message)}</p>
      ${ctaHTML || ""}
    </div>`;
}

/* ---------- Navbar ---------- */
function renderNavbar(active) {
  const mount = document.getElementById("navbar");
  if (!mount) return;
  const user = DB.getCurrentUser();
  const count = Cart.count();

  const link = (href, label, key, notificationSection) =>
    `<a href="${ROOT}${href}" class="${active === key ? "active" : ""}"${notificationSection ? ` data-notification-section="${notificationSection}"` : ""}>${label}</a>`;

  let links = "";
  let actions = "";
  if (!user) {
    links = link("index.html", "Home", "home") + link("menu.html", "Menu", "menu") +
            link("index.html#how", "How It Works", "how") + link("token-display.html", "Token Display", "display") + link("help.html", "Help", "help");
    actions = `<a class="btn btn-outline btn-sm" href="${ROOT}login.html">Log In</a>`;
  } else if (user.role === "student") {
    links = link("menu.html", "Menu", "menu") + link("orders.html", "My Orders", "orders", "orders") +
            link("token-display.html", "Token Display", "display") + link("help.html", "Help", "help") + link("profile.html", "Profile", "profile");
    actions = `
      <div id="notification-bell" class="notification-bell"></div>
      <a class="cart-link" href="${ROOT}cart.html" aria-label="Cart with ${count} items">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M2 3h3l2.6 12.5a2 2 0 0 0 2 1.5h8.7a2 2 0 0 0 2-1.6L22 7H6"/></svg>
        <span class="cart-label">Cart</span>
        <span class="cart-count" data-cart-count>${count}</span>
      </a>
      <button class="btn btn-ghost btn-sm" data-logout>Logout</button>`;
  } else {
    const home = user.role === "staff" ? "staff/dashboard.html" : "admin/dashboard.html";
    links = link(home, "Dashboard", "dash") + link("token-display.html", "Token Display", "display") + link("help.html", "Help", "help");
    actions = `${user.role === "admin" ? `<div id="notification-bell" class="notification-bell"></div>` : ""}<button class="btn btn-ghost btn-sm" data-logout>Logout</button>`;
  }

  mount.innerHTML = `
    <nav class="navbar">
      <div class="container navbar-inner">
        <a class="brand" href="${ROOT}index.html" aria-label="SCOTS home">
          <span class="brand-mark"><img src="${ROOT}assets/icons/scots-logo.png" alt="SCOTS logo"></span>
          <span class="brand-name">SCOTS<small>Smart Canteen</small></span>
        </a>
        <div class="nav-links">${links}</div>
        <div class="nav-actions">
          ${actions}
          <button class="hamburger" aria-label="Open menu" aria-expanded="false" data-hamburger>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
        </div>
      </div>
      <div class="mobile-menu" data-mobile-menu>
        ${!user
          ? `<a href="${ROOT}index.html">Home</a><a href="${ROOT}menu.html">Menu</a><a href="${ROOT}token-display.html">Token Display</a><a href="${ROOT}help.html">Help</a><a href="${ROOT}login.html">Log In</a>`
          : user.role === "student"
            ? `<a href="${ROOT}menu.html">Menu</a><a href="${ROOT}orders.html" data-notification-section="orders">My Orders</a><a href="${ROOT}token-display.html">Token Display</a><a href="${ROOT}cart.html">Cart</a><a href="${ROOT}help.html">Help</a><a href="${ROOT}profile.html">Profile</a><a href="#" data-logout>Logout</a>`
            : `<a href="${ROOT}${user.role === "staff" ? "staff/dashboard.html" : "admin/dashboard.html"}">Dashboard</a><a href="${ROOT}token-display.html">Token Display</a><a href="${ROOT}help.html">Help</a><a href="#" data-logout>Logout</a>`
        }
      </div>
    </nav>`;

  const burger = mount.querySelector("[data-hamburger]");
  const menuEl = mount.querySelector("[data-mobile-menu]");
  burger.addEventListener("click", () => {
    const open = menuEl.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
  });
  mount.querySelectorAll("[data-logout]").forEach(b =>
    b.addEventListener("click", e => { e.preventDefault(); Auth.logout(); }));
}

/* ---------- Shared live queue widget ---------- */
const LiveQueue = {
  state: { activeCount: 0, waitMinutes: 0 },
  formatWait(mins) {
    const n = Math.max(0, Math.round(Number(mins) || 0));
    if (n < 60) return `${n} min`;
    const h = Math.floor(n / 60), m = n % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  },
  render() {
    const wait = this.formatWait(this.state.waitMinutes);
    document.querySelectorAll('[data-live-queue-wait]').forEach(el => { el.textContent = wait; });
    document.querySelectorAll('[data-live-queue-count]').forEach(el => { el.textContent = this.state.activeCount; });
    document.querySelectorAll('[data-live-queue-detail]').forEach(el => {
      el.textContent = this.state.waitMinutes > 0
        ? `${this.state.activeCount} order${this.state.activeCount === 1 ? '' : 's'} in kitchen · ${wait} until the active queue clears`
        : 'Kitchen queue is clear';
    });
  },
  async refresh() {
    try {
      const base = (window.SCOTS_NOTIFICATION_API_BASE || '/api').replace(/\/$/, '');
      const res = await fetch(base + '/queue-status', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Queue status failed (${res.status})`);
      this.state = await res.json();
      try { Store.write('scots_queue_status', this.state); } catch (_) {}
    } catch (_) {
      try { this.state = Store.read('scots_queue_status', this.state) || this.state; } catch (_) {}
    }
    this.render();
  },
  init() {
    if (this._started) return;
    this._started = true;
    try { this.state = Store.read('scots_queue_status', this.state) || this.state; } catch (_) {}
    this.render();
    this.refresh();
    window.addEventListener('scots:queue-changed', e => {
      if (e.detail) this.state = e.detail;
      this.render();
    });
    window.addEventListener('scots:order-created-remote', () => this.refresh());
    window.addEventListener('scots:order-changed', () => this.refresh());
    this._timer = setInterval(() => this.refresh(), 60000);
  }
};

window.LiveQueue = LiveQueue;

/* ---------- Password visibility toggles ---------- */
function passwordIconMarkup(visible) {
  return visible
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.8A11.7 11.7 0 0 1 12 4.5c5.8 0 9.5 6 9.5 6a17.4 17.4 0 0 1-4.1 4.6"></path><path d="M6.1 6.1C3.7 7.7 2.5 10.5 2.5 10.5s3.7 6 9.5 6c1 0 2-.1 2.9-.4"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.7-6 9.5-6 9.5 6 9.5 6-3.7 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>';
}

function wirePasswordToggle(input, button) {
  if (!input || !button || button.dataset.bound === '1') return;
  button.dataset.bound = '1';
  const update = () => {
    const visible = input.type === 'text';
    button.innerHTML = passwordIconMarkup(visible);
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('title', visible ? 'Hide password' : 'Show password');
    button.classList.toggle('is-visible', visible);
  };
  update();
  button.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    update();
    input.focus({ preventScroll: true });
  });
}

function initPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    let wrap = input.closest('.password-wrap');
    let button = wrap?.querySelector('.password-toggle');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'password-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'password-toggle';
      wrap.appendChild(button);
    }
    wirePasswordToggle(input, button);
  });
}
function updateCartBadge() {
  document.querySelectorAll("[data-cart-count]").forEach(el => {
    el.textContent = Cart.count();
  });
}

/* ---------- Footer ---------- */
function renderFooter() {
  const mount = document.getElementById("footer");
  if (!mount) return;
  mount.innerHTML = `
    <footer class="footer">
      <div class="container">
        <div class="footer-inner">
          <div>
            <a class="brand" href="${ROOT}index.html" style="margin-bottom:14px">
              <span class="brand-mark"><img src="${ROOT}assets/icons/scots-logo.png" alt="SCOTS logo"></span>
              <span class="brand-name">SCOTS<small style="color:#C9BBA6">Smart Canteen</small></span>
            </a>
            <p>Smart Canteen Ordering &amp; Token System — order ahead, skip the queue, collect with a token.</p>
            <p class="mt-16" style="font-size:.82rem">Operating hours: <strong style="color:#EFE6D8">09:00 AM – 06:00 PM IST</strong></p>
          </div>
          <div>
            <h4>Quick Links</h4>
            <a href="${ROOT}menu.html">Menu</a>
            <a href="${ROOT}orders.html">My Orders</a>
            <a href="${ROOT}help.html">Help &amp; FAQ</a>
            <a href="${ROOT}token-display.html">Token Display</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href="mailto:canteen@example.com">canteen@example.com</a>
            <a href="tel:+910000000000">+91 00000 00000</a>
            <a href="${ROOT}help.html#appeal">Appeal a no-show</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© 2026 SCOTS · Student demo project</span>
          <span class="footer-note">College Demo Edition</span>
        </div>
      </div>
    </footer>`;
}

/* ---------- Expiry sweep (safe to call on every page load) ----------
   Ready orders expire after 20 minutes (1 minute in DEMO_MODE).
   Timestamp-based, so it works even after the browser was closed. */
function sweepExpiries() {
  const orders = DB.getOrders();
  const now = TimeUtil.now().getTime();
  const windowMs = readyExpiryMinutes() * 60000;
  let changed = false;
  orders.forEach(o => {
    if (o.status === "ready" && o.readyAt && now - new Date(o.readyAt).getTime() > windowMs) {
      const previous = { ...o };
      o.status = "expired";
      o.statusHistory = (o.statusHistory || []).concat([{ status: "expired", at: new Date(now).toISOString() }]);
      const pct = ((o.policy && o.policy.noShowForfeitPct) ?? Policy.get().noShowForfeitPct) / 100;
      const kept = Math.round(o.total * pct);
      if (o.payment && o.payment.status === "paid") {
        o.payment.status = "forfeited";
        DB.addTransaction({
          id: "txn-" + Date.now() + "-" + o.token,
          orderId: o.id, token: o.token,
          amount: kept, type: "forfeit",
          note: `Prepaid amount forfeited (${Math.round(pct * 100)}%) - order expired uncollected`,
        });
        if (o.total - kept > 0) DB.addTransaction({ id: "txn-r-" + Date.now() + "-" + o.token, orderId: o.id, token: o.token, amount: o.total - kept, type: "refund", note: "Remainder refunded after No-Show forfeiture" });
      } else if (o.payment && o.payment.mode === "counter") {
        o.payment.status = "due";
        Dues.add(o.userId, kept, o.token); /* FR22: unpaid Cash-at-Pickup -> Pending Due */
      }
      NoShow.increment(o.userId);
      DB.addAudit({ type: "expire", message: `${o.token} expired uncollected (payment ${o.payment.status})` });
      window.dispatchEvent(new CustomEvent("scots:order-changed", { detail: { previous, order: { ...o } } }));
      changed = true;
    }
  });
  if (changed) DB.saveOrders(orders);
  return changed;
}

/* ---------- Customer cancellation (SRS FR20, FR20.1, FR20.2, FR20.4) ---------- */
function cancelOrderByCustomer(orderId) {
  const o = DB.getOrder(orderId);
  const pol = Policy.get();
  if (!o || !["received", "preparing"].includes(o.status)) return { ok: false, error: "Order can no longer be cancelled." };
  const nowIso = TimeUtil.now().toISOString();
  const prepaid = o.payment && o.payment.status === "paid";
  let msg;
  if (o.delayCancelOffered) { /* FR12.7: 100% refund, no penalty, not counted */
    if (prepaid) DB.addTransaction({ id: "txn-" + Date.now(), orderId: o.id, token: o.token, amount: o.total, type: "refund", note: "100% refund - scheduled order delayed beyond Delay Grace" });
    msg = prepaid ? `Cancelled for delay. ${U.rupees(o.total)} refunded in full.` : "Cancelled for delay. No charge.";
  } else if (o.status === "received") {
    if (prepaid) DB.addTransaction({ id: "txn-" + Date.now(), orderId: o.id, token: o.token, amount: o.total, type: "refund", note: "100% refund - cancelled while Received" });
    msg = prepaid ? `Cancelled. ${U.rupees(o.total)} refunded in full.` : "Cancelled. No charge.";
    Dues.recordReceivedCancel(o.userId);
  } else {
    const pct = ((o.policy && o.policy.lateCancelPct) ?? pol.lateCancelPct) / 100;
    const penalty = Math.round(o.total * pct);
    if (prepaid) {
      if (o.total - penalty > 0) DB.addTransaction({ id: "txn-" + Date.now(), orderId: o.id, token: o.token, amount: o.total - penalty, type: "refund", note: "Refund after late-cancellation penalty" });
      msg = `Cancelled while Preparing. Penalty ${U.rupees(penalty)}, refund ${U.rupees(o.total - penalty)}.`;
    } else {
      Dues.add(o.userId, penalty, o.token);
      msg = `Cancelled while Preparing. Penalty ${U.rupees(penalty)} added to your Pending Due.`;
    }
  }
  DB.updateOrder(orderId, { status: "cancelled", statusHistory: (o.statusHistory || []).concat([{ status: "cancelled", at: nowIso }]) });
  DB.addAudit({ type: "cancel", message: `${o.token} cancelled by customer at ${o.status}` });
  return { ok: true, message: msg };
}

/* ---------- Sold Out -> cancel Received orders with that item (FR5.1) ---------- */
function cancelOrdersForSoldOut(itemId) {
  const nowIso = TimeUtil.now().toISOString();
  let n = 0;
  DB.getOrders().filter(o => o.status === "received" && o.items.some(i => i.id === itemId)).forEach(o => {
    if (o.payment && o.payment.status === "paid") {
      DB.addTransaction({ id: "txn-" + Date.now() + "-" + o.token, orderId: o.id, token: o.token, amount: o.total, type: "refund", note: "100% refund - item sold out" });
    }
    DB.updateOrder(o.id, { status: "cancelled", statusHistory: (o.statusHistory || []).concat([{ status: "cancelled", at: nowIso }]) });
    DB.addAudit({ type: "cancel", message: `${o.token} cancelled by system (item sold out); not counted toward FR20.4` });
    n++;
  });
  return n;
}

/* ---------- Scroll reveals ---------- */
function initReveals() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  if (!("IntersectionObserver" in window)) {
    els.forEach(el => el.classList.add("revealed"));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add("revealed"); io.unobserve(en.target); }
    });
  }, { threshold: .08, rootMargin: "0px 0px 160px" });
  els.forEach(el => io.observe(el));
  /* Safety net: content must never stay invisible if the observer
     misses an element (print, odd viewport, restore-scroll, etc.) */
  setTimeout(() => els.forEach(el => el.classList.add("revealed")), 2000);
}

/* ---------- Standard page bootstrap ---------- */
function initPage(active) {
  seedDemoData(false);
  sweepExpiries();
  renderNavbar(active);
  renderFooter();
  initPasswordToggles();
  LiveQueue?.init?.();
  initReveals();
  if (typeof NotificationEngine !== "undefined") NotificationEngine.init();
}

document.addEventListener("DOMContentLoaded", () => {
  seedDemoData(false);
});
