/* ============================================================
   SCOTS — staff.js
   Staff dashboard: stats, live queue, forward-only status
   workflow (Received → Preparing → Ready → Collected).
   ============================================================ */

const STAFF_FLOW = ["received", "preparing", "ready", "collected"];

const StaffPage = {
  init() {
    const user = Auth.guard("staff");
    if (!user) return;
    this.render();
    setInterval(() => { sweepExpiries(); this.render(); }, 3000);
  },

  nextStatus(current) {
    const i = STAFF_FLOW.indexOf(current);
    return i >= 0 && i < STAFF_FLOW.length - 1 ? STAFF_FLOW[i + 1] : null;
  },

  advance(orderId) {
    const o = DB.getOrder(orderId);
    if (!o) return;
    const next = this.nextStatus(o.status);
    if (!next) { toast("This order is already completed.", "warn"); return; }
    /* FR16: confirmation box naming token and new status */
    if (!confirm(`Mark order #${o.token.replace("SCOTS-", "")} as ${STATUS_LABELS[next]}?`)) return;
    /* FR13.1: Collected only when fully paid; record Cash-at-Pickup payment */
    if (next === "collected" && !(o.payment && o.payment.status === "paid")) {
      if (!confirm(`Cash received: ${U.rupees(o.total)} in full?`)) return;
      DB.addTransaction({ id: "txn-" + Date.now(), orderId: o.id, token: o.token, amount: o.total, type: "payment", note: "Cash-at-Pickup received at counter" });
      DB.addAudit({ type: "cash", message: `${o.token} cash ${U.rupees(o.total)} recorded by staff` });
      o.payment = { ...o.payment, status: "paid" };
      DB.updateOrder(orderId, { payment: o.payment });
    }
    const patch = {
      status: next,
      statusHistory: (o.statusHistory || []).concat([{ status: next, at: TimeUtil.now().toISOString() }]),
    };
    if (next === "ready") patch.readyAt = TimeUtil.now().toISOString();
    /* FR12.7: delay = actual start - Promised Release Time */
    if (next === "preparing" && o.mode === "scheduled" && o.promisedReleaseMin != null) {
      const delay = TimeUtil.nowMinutes() - o.promisedReleaseMin;
      if (delay > 0) {
        patch.delayMin = delay;
        const grace = (o.policy && o.policy.delayGrace) ?? Policy.get().delayGrace;
        if (delay > grace) patch.delayCancelOffered = true;
        try {
          NotificationEngine.create({ type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT, recipientUserId: o.userId, entityType: "order", entityId: o.id,
            title: "Order delayed",
            message: `${o.token} started ${delay} min late. New Ready time ${TimeUtil.minsToLabel(TimeUtil.nowMinutes() + o.prepMinutes)}.` + (patch.delayCancelOffered ? " You may cancel for a 100% refund." : "") });
        } catch (e) { /* notification optional */ }
        DB.addAudit({ type: "delay", message: `${o.token} delayed ${delay} min` });
      }
    }
    DB.updateOrder(orderId, patch);
    DB.addAudit({ type: "status", message: `${o.token} moved to ${STATUS_LABELS[next]}` });
    toast(`${o.token} → ${STATUS_LABELS[next]}`, "success");
    this.render();
  },

  /* ---------- Offline (walk-in) Order, FR10 ---------- */
  openOffline() {
    const menu = DB.getMenu().filter(m => m.available && !m.soldOut);
    const qty = {};
    const html = () => {
      const lines = menu.filter(m => qty[m.id] > 0);
      const prep = lines.reduce((s, m) => s + m.prepTime * qty[m.id], 0);
      const total = lines.reduce((s, m) => s + m.price * qty[m.id], 0);
      const eta = prep ? Queue.computeETA(prep, "asap") : null;
      const over = prep > Policy.get().prepLimit;
      return `<h3>Walk-in Order</h3>
        <div style="max-height:260px;overflow:auto">${menu.map(m => `<div class="sum-row"><span>${U.esc(m.name)} · ${U.rupees(m.price)}</span>
          <span><button class="btn btn-ghost btn-sm" data-q="${m.id}:-1">−</button> ${qty[m.id] || 0} <button class="btn btn-ghost btn-sm" data-q="${m.id}:1">+</button></span></div>`).join("")}</div>
        <div class="sum-row total"><span>Total</span><span>${U.rupees(total)}</span></div>
        <p class="modal-sub">${eta ? `ETA ${TimeUtil.clockLabel(eta.etaDate)} (~${eta.waitMinutes} min)` : "Add items"}${over ? ` · <b style="color:#A03E2C">prep ${prep} min > ${Policy.get().prepLimit} limit: split cart</b>` : ""}</p>
        <label>Payment <select id="off-pay"><option value="cash">Cash</option><option value="upi">UPI</option></select></label>
        <div class="modal-actions"><button class="btn btn-ghost" data-modal-close>Close</button>
        <button class="btn btn-primary" data-off-place ${!prep || over ? "disabled" : ""}>Take payment &amp; print token</button></div>`;
    };
    const ov = openModal(html());
    const bind = () => {
      const card = ov.querySelector(".modal-card");
      card.querySelectorAll("[data-q]").forEach(b => b.onclick = () => {
        const [id, d] = b.dataset.q.split(":"); qty[id] = Math.max(0, (qty[id] || 0) + Number(d));
        const pay = card.querySelector("#off-pay").value; card.innerHTML = html(); card.querySelector("#off-pay").value = pay; bind();
      });
      const place = card.querySelector("[data-off-place]");
      if (place) place.onclick = () => this.placeOffline(menu.filter(m => qty[m.id] > 0).map(m => ({ ...m, qty: qty[m.id] })), card.querySelector("#off-pay").value);
      const x = card.querySelector("[data-modal-close]"); if (x) x.onclick = () => closeModal();
    };
    bind();
  },

  placeOffline(lines, payMode) {
    const prep = lines.reduce((s, m) => s + m.prepTime * m.qty, 0);
    const total = lines.reduce((s, m) => s + m.price * m.qty, 0);
    const est = Queue.computeETA(prep, "asap");
    const now = TimeUtil.now().toISOString();
    const pol = Policy.get();
    const order = {
      id: "o-" + Date.now(), token: DB.nextToken(), userId: null, userName: "Walk-in (Offline)",
      items: lines.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, image: i.image, prepTime: i.prepTime })),
      subtotal: total, serviceFee: 0, total, prepMinutes: prep,
      payment: { mode: payMode === "cash" ? "counter" : "upi", status: "paid" },
      mode: "asap", orderType: "Offline", slotId: null, slotLabel: "Immediate",
      placedAt: now, eta: est.etaDate.toISOString(), waitMinutes: est.waitMinutes,
      status: "received", readyAt: null, statusHistory: [{ status: "received", at: now }],
      policy: { noShowForfeitPct: pol.noShowForfeitPct, lateCancelPct: pol.lateCancelPct, autoExpiryMin: pol.autoExpiryMin },
    };
    DB.addOrder(order);
    DB.addTransaction({ id: "txn-" + Date.now(), orderId: order.id, token: order.token, amount: total, type: "payment", note: `Offline order ${payMode.toUpperCase()} recorded by staff` });
    DB.addAudit({ type: "order", message: `${order.token} offline order ${U.rupees(total)} (${payMode}) by staff` });
    const base = (window.SCOTS_NOTIFICATION_API_BASE || "/api").replace(/\/$/, "");
    fetch(base + "/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) }).catch(() => {});
    closeModal();
    this.printReceipt(order);
    this.render();
  },

  /* FR11.2: printed token receipt via browser print dialog */
  printReceipt(o) {
    const w = window.open("", "_blank", "width=380,height=560");
    if (!w) { toast("Allow pop-ups to print the receipt.", "warn"); return; }
    w.document.write(`<html><body style="font-family:monospace;width:300px"><h2 style="text-align:center">SCOTS Canteen</h2>
      <p>Order ${o.id}<br>Token: <b style="font-size:28px">${o.token}</b><br>${TimeUtil.dateLabel(new Date(o.placedAt))} ${TimeUtil.isoToLabel(o.placedAt)}</p><hr>
      ${o.items.map(i => `${i.qty} x ${U.esc(i.name)} .... ${U.rupees(i.price * i.qty)}<br>`).join("")}<hr>
      <b>Total ${U.rupees(o.total)}</b><br>Payment: ${o.payment.mode === "upi" ? "UPI" : "Cash"} (Paid)<br>
      Token ETA: <b>${TimeUtil.isoToLabel(o.eta)}</b><hr>
      <small>Collect within ${(o.policy && o.policy.autoExpiryMin) || 20} min of Ready. The countdown starts when your token shows Ready.</small></body></html>`);
    w.document.close(); w.focus(); w.print();
  },

  render() {
    if (!document.getElementById("offline-btn")) {
      document.getElementById("staff-stats").insertAdjacentHTML("beforebegin", `<button id="offline-btn" class="btn btn-primary mb-16">+ Walk-in Order</button>`);
      document.getElementById("offline-btn").onclick = () => this.openOffline();
    }
    const orders = DB.getOrders();
    const held = orders.filter(o => Queue.isHeld(o));
    const active = orders.filter(o => ["received", "preparing"].includes(o.status) && !Queue.isHeld(o));
    const ready = orders.filter(o => o.status === "ready");
    const done = orders.filter(o => ["collected"].includes(o.status));
    const revenue = orders
      .filter(o => o.status !== "expired")
      .reduce((s, o) => s + o.total, 0);

    const stats = document.getElementById("staff-stats");
    stats.innerHTML = `
      <div class="stat-card"><small>Today's Orders</small><div class="stat-val">${orders.length}</div></div>
      <div class="stat-card"><small>Active Queue</small><div class="stat-val">${active.length}</div><div class="stat-sub">${Queue.activeQueueMinutes()} prep-min · ${held.length} scheduled held</div></div>
      <div class="stat-card"><small>Ready for Pickup</small><div class="stat-val">${ready.length}</div></div>
      <div class="stat-card"><small>Completed</small><div class="stat-val">${done.length}</div></div>
      <div class="stat-card accent"><small>Revenue</small><div class="stat-val">${U.rupees(revenue)}</div><div class="stat-sub">excl. expired</div></div>`;

    /* Live queue: active first, then ready, newest first */
    const queue = [...active, ...ready].sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
    const wrap = document.getElementById("staff-queue");
    if (!queue.length) {
      wrap.innerHTML = emptyStateHTML("🧑‍🍳", "The queue is clear", "New orders will appear here the moment customers place them.", "");
      return;
    }
    wrap.innerHTML = `
      <div class="table-wrap"><div class="table-scroll">
      <table class="data">
        <thead><tr>
          <th>Token</th><th>Customer</th><th>Items</th><th>Prep</th><th>Payment</th><th>Pickup Slot</th><th>Placed</th><th>Status</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${queue.map(o => {
            const next = this.nextStatus(o.status);
            return `<tr>
              <td><strong style="color:var(--orange-dark)">#${o.token.replace("SCOTS-", "")}</strong></td>
              <td>${U.esc(o.userName)}</td>
              <td>${o.items.map(i => `${i.qty}× ${U.esc(i.name)}`).join(", ")}</td>
              <td>${o.prepMinutes} min</td>
              <td>${paymentBadge(o.payment)}</td>
              <td style="white-space:nowrap">${U.esc(o.slotLabel)}</td>
              <td style="white-space:nowrap">${TimeUtil.isoToLabel(o.placedAt)}</td>
              <td>${statusBadge(o.status, ["received", "preparing"].includes(o.status))}</td>
              <td>${next ? `<button class="btn btn-primary btn-sm" data-advance="${o.id}">Mark ${STATUS_LABELS[next]}</button>` : ""}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      </div></div>`;

    wrap.querySelectorAll("[data-advance]").forEach(btn =>
      btn.addEventListener("click", () => this.advance(btn.dataset.advance)));
  },
};

document.addEventListener("DOMContentLoaded", () => StaffPage.init());
