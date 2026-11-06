/* ============================================================
   SCOTS — orders.js
   Order history, order detail modal, order-success page,
   live ready-expiry countdown.
   ============================================================ */

const Orders = {
  forCurrentUser() {
    const u = DB.getCurrentUser();
    if (!u) return [];
    return DB.getOrders()
      .filter(o => o.userId === u.id)
      .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
  },

  /* ---------- Order history page ---------- */
  async initHistory() {
    const user = Auth.guard("student");
    if (!user) return;
    await Realtime.pullOrders(user.id, user.role);
    window.addEventListener("scots:order-created-remote", () => this.renderHistory());
    window.addEventListener("scots:order-changed", e => {
      const targetId = new URLSearchParams(location.search).get("o");
      if (!targetId || !e.detail?.order || e.detail.order.id === targetId) this.renderHistory();
      const detailOrder = e.detail?.order;
      if (detailOrder?.id === targetId) this.refreshOpenDetail(detailOrder.id);
    });
    this.renderHistory();
    const targetId = new URLSearchParams(location.search).get("o");
    if (targetId) {
      if (typeof NotificationEngine !== "undefined") NotificationEngine.customerNavigateToOrder(targetId);
      setTimeout(() => this.openDetail(targetId), 80);
    }
    setInterval(() => {
      if (sweepExpiries()) this.renderHistory();
      this.tickCountdowns();
    }, 1000);
  },

  renderHistory() {
    const list = document.getElementById("orders-list");
    if (!list) return;
    const orders = this.forCurrentUser();
    if (!orders.length) {
      list.innerHTML = emptyStateHTML(
        "🧾", "No orders yet",
        "When you place an order, it will appear here with its token and live status.",
        `<a class="btn btn-primary" href="menu.html">Browse the menu</a>`
      );
      return;
    }
    list.innerHTML = orders.map(o => `
      <article class="order-card" data-order="${o.id}" tabindex="0" role="button" aria-label="Order ${o.token} details">
        <div class="order-token"><div><strong>#${o.token.replace("SCOTS-", "")}</strong><small>TOKEN</small></div></div>
        <div>
          <div class="flex-between" style="flex-wrap:nowrap">
            <strong>${U.esc(o.items.map(i => i.name).slice(0, 2).join(", "))}${o.items.length > 2 ? ` +${o.items.length - 2} more` : ""}</strong>
          </div>
          <div class="oc-items">${o.items.map(i => `${i.qty}× ${U.esc(i.name)}`).join(" · ")}</div>
          <div class="oc-meta">
            <span>📅 ${TimeUtil.dateLabel(new Date(o.placedAt))}</span>
            <span>⏱ ETA ${TimeUtil.isoToLabel(o.eta)} (locked)</span>
            <span>${o.slotId ? "🪑 Pickup " + U.esc(o.slotLabel) : "🚶 Normal queue"}</span>
            <span data-countdown-slot="${o.id}"></span>
          </div>
        </div>
        <div class="oc-right">
          <span class="oc-amount">${U.rupees(o.total)}</span>
          ${statusBadge(o.status, ["received", "preparing"].includes(o.status))}
          ${paymentBadge(o.payment)}
        </div>
      </article>`).join("");

    list.querySelectorAll("[data-order]").forEach(card => {
      const open = () => {
        if (typeof NotificationEngine !== "undefined") NotificationEngine.customerNavigateToOrder(card.dataset.order);
        this.openDetail(card.dataset.order);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    this.tickCountdowns();
  },

  tickCountdowns() {
    const windowMs = readyExpiryMinutes() * 60000;
    document.querySelectorAll("[data-countdown-slot]").forEach(el => {
      const o = DB.getOrder(el.dataset.countdownSlot);
      if (!o || o.status !== "ready" || !o.readyAt) { el.innerHTML = ""; return; }
      const left = windowMs - (TimeUtil.now().getTime() - new Date(o.readyAt).getTime());
      if (left <= 0) { el.innerHTML = ""; return; }
      const s = Math.ceil(left / 1000);
      el.innerHTML = `<span class="countdown-chip">⏳ Collect within ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>`;
    });
  },

  refreshOpenDetail(orderId) {
    const modal = document.querySelector('.modal-overlay');
    if (!modal || typeof this.openDetail !== 'function') return;
    // Re-open the same order detail so a status/timeline change received over
    // SSE or the canonical notification event is visible immediately.
    this.openDetail(orderId);
  },

  openDetail(orderId) {
    const o = DB.getOrder(orderId);
    if (!o) return;
    const history = (o.statusHistory || []).map(h =>
      `<div class="sum-row"><span>${STATUS_LABELS[h.status] || h.status}</span><span class="text-muted">${TimeUtil.isoToLabel(h.at)}</span></div>`).join("");
    openModal(`
      <h3>Order ${o.token}</h3>
      <p class="modal-sub">Placed at ${TimeUtil.isoToLabel(o.placedAt)} · ${TimeUtil.dateLabel(new Date(o.placedAt))}</p>
      <div class="mb-16">${statusBadge(o.status)} ${paymentBadge(o.payment)}</div>
      <div class="panel" style="padding:18px;margin-bottom:16px">
        ${o.items.map(i => `<div class="sum-row"><span>${i.qty}× ${U.esc(i.name)}</span><span>${U.rupees(i.price * i.qty)}</span></div>`).join("")}
        <div class="sum-row"><span>Service fee</span><span>${U.rupees(o.serviceFee)}</span></div>
        <div class="sum-row total"><span>Total</span><span>${U.rupees(o.total)}</span></div>
      </div>
      <div class="detail-grid">
        <div class="detail-cell"><small>Locked ETA</small><strong>${TimeUtil.isoToLabel(o.eta)}</strong></div>
        <div class="detail-cell"><small>Pickup</small><strong>${o.slotId ? U.esc(o.slotLabel) : "Immediate"}</strong></div>
      </div>
      <h4 class="mt-24 mb-16">Status timeline</h4>
      ${history}
      <div class="modal-actions">
        ${["received", "preparing"].includes(o.status) ? `<button class="btn btn-ghost" data-cancel-order>Cancel order</button>` : ""}
        <button class="btn btn-primary btn-block" data-modal-close>Done</button>
      </div>`);
    const cbtn = document.querySelector("[data-cancel-order]");
    if (cbtn) cbtn.onclick = () => {
      const late = o.status === "preparing";
      const pct = (o.policy && o.policy.lateCancelPct) ?? Policy.get().lateCancelPct;
      if (!confirm(late ? `Order is already Preparing. A ${pct}% penalty applies. Cancel anyway?` : "Cancel this order?")) return;
      const r = cancelOrderByCustomer(o.id);
      closeModal();
      toast(r.ok ? r.message : r.error, r.ok ? "success" : "error");
      this.render && this.render();
    };
  },

  /* ---------- Order success page ---------- */
  initSuccess() {
    const user = Auth.guard("student");
    if (!user) return;
    const id = new URLSearchParams(location.search).get("o");
    const o = DB.getOrder(id);
    if (!o) { location.href = ROOT + "orders.html"; return; }

    document.getElementById("tk-num").textContent = "#" + o.token.replace("SCOTS-", "");
    document.getElementById("tk-full").textContent = o.token;
    document.getElementById("success-eta").textContent = TimeUtil.isoToLabel(o.eta);
    document.getElementById("success-wait").textContent = "~" + o.waitMinutes + " min";
    document.getElementById("success-pay").textContent = o.payment.status === "paid" ? "UPI Paid" : "Cash-at-Pickup";
    document.getElementById("success-slot").textContent = o.slotLabel;
    document.getElementById("success-status").innerHTML = statusBadge(o.status, true);
    document.getElementById("success-items").innerHTML = o.items
      .map(i => `<div class="sum-row"><span>${i.qty}× ${U.esc(i.name)}</span><span>${U.rupees(i.price * i.qty)}</span></div>`).join("");

    /* Live status + ready countdown */
    const cd = document.getElementById("success-countdown");
    setInterval(() => {
      sweepExpiries();
      const cur = DB.getOrder(o.id);
      if (!cur) return;
      document.getElementById("success-status").innerHTML = statusBadge(cur.status, ["received", "preparing"].includes(cur.status));
      if (cur.status === "ready" && cur.readyAt) {
        const left = readyExpiryMinutes() * 60000 - (TimeUtil.now().getTime() - new Date(cur.readyAt).getTime());
        if (left > 0) {
          const s = Math.ceil(left / 1000);
          cd.innerHTML = `<span class="countdown-chip">⏳ Your food is ready — collect within ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>`;
          return;
        }
      }
      cd.innerHTML = "";
    }, 1000);
  },
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("orders-list")) Orders.initHistory();
  if (document.getElementById("tk-num")) Orders.initSuccess();
});
