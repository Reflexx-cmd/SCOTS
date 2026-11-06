/* ============================================================
   SCOTS — checkout.js
   Checkout flow: summary → payment → pickup option → confirm.
   Pickup options:
     • Immediate Order (ASAP) — join the live kitchen line (SRS v2.3 term)
     • Scheduled Pickup    — reserve a 15-minute slot
   The estimated pickup time is always shown BEFORE payment.
   ============================================================ */

const Checkout = {
  source: "cart",           // "cart" | "buynow"
  paymentMode: "upi",
  mode: "asap",             // "asap" | "scheduled"
  slotId: null,
  user: null,

  totals() { return Cart.totals(this.source); },

  init() {
    this.user = Auth.guard("student");
    if (!this.user) return;

    const params = new URLSearchParams(location.search);
    this.source = params.get("mode") === "buynow" ? "buynow" : "cart";

    const { lines, prep } = this.totals();
    if (!lines.length) {
      location.href = ROOT + (this.source === "buynow" ? "menu.html" : "cart.html");
      return;
    }

    /* Hard blocks */
    const blocks = [];
    if (this.user.status === "suspended") {
      blocks.push(`<div class="notice error" role="alert"><span>⛔</span><div><strong>Your account has been temporarily suspended due to repeated pickup no-shows.</strong>You cannot place orders right now. Visit Help to appeal.</div></div>`);
    }
    if ((this.user.pendingDue || 0) > 0) {
      blocks.push(`<div class="notice error" role="alert"><span>💸</span><div><strong>Pending Due: ${U.rupees(this.user.pendingDue)}.</strong>Clear it to place new orders (FR22.1). <button class="btn btn-primary" style="margin-top:8px" data-settle-due>Settle now (demo)</button></div></div>`);
    }
    if (this.user.orderBlockUntil && new Date(this.user.orderBlockUntil) > TimeUtil.now()) {
      blocks.push(`<div class="notice warn" role="alert"><span>⏳</span><div><strong>Ordering paused for 24 hours</strong>Too many cancellations at Received stage in one day (FR20.4). Resumes ${new Date(this.user.orderBlockUntil).toLocaleString("en-IN")}.</div></div>`);
    }
    if (!TimeUtil.isOpen()) {
      blocks.push(`<div class="notice warn" role="alert"><span>🌙</span><div><strong>Ordering is currently closed.</strong>The canteen accepts orders 09:00 AM – 06:00 PM IST and opens again ${TimeUtil.nextOpeningLabel()}.</div></div>`);
    }
    if (TimeUtil.isOpen()
        && !Queue.completesBeforeClose(prep, "asap")
        && !Slots.suggest(prep)) {
      blocks.push(`<div class="notice warn" role="alert"><span>⏰</span><div><strong>Too close to closing time.</strong>This order would not finish before 06:00 PM. Try a smaller order or come back tomorrow.</div></div>`);
    }
    const blocked = blocks.length > 0;
    document.getElementById("checkout-blocks").innerHTML = blocks.join("");
    const settleBtn = document.querySelector("[data-settle-due]");
    if (settleBtn) settleBtn.onclick = () => { Dues.settle(this.user.id); toast("Pending Due cleared", "success"); location.reload(); };

    if (this.user.paymentMode === "mandatory_upi") this.paymentMode = "upi";

    this.renderSummary();
    this.renderPayment();
    this.renderMode();
    this.renderSlots();
    this.updateEstimate();
    this.updatePlaceBtn(blocked);

    document.getElementById("place-order-btn").addEventListener("click", () => this.place());
  },

  renderSummary() {
    const { lines, subtotal, fee, total, prep } = this.totals();
    document.getElementById("summary-lines").innerHTML = lines.map(i => `
      <div class="sum-row">
        <span>${U.esc(i.name)} × ${i.qty}</span><span>${U.rupees(i.price * i.qty)}</span>
      </div>`).join("");
    document.getElementById("summary-subtotal").textContent = U.rupees(subtotal);
    document.getElementById("summary-fee").textContent = U.rupees(fee);
    document.getElementById("summary-total").textContent = U.rupees(total);
    document.getElementById("summary-prep").textContent = "~" + prep + " min prep";

    /* Buy-now quantity stepper */
    const bnZone = document.getElementById("buynow-qty");
    if (this.source === "buynow") {
      const bn = Cart.getBuyNow();
      bnZone.innerHTML = `
        <div class="flex-between mb-16">
          <span class="text-muted" style="font-size:.9rem">Quantity</span>
          <div class="qty-stepper" style="flex:0 0 150px">
            <button data-bn-dec aria-label="Decrease quantity">−</button>
            <span class="qty-val">${bn.qty}</span>
            <button data-bn-inc aria-label="Increase quantity">+</button>
          </div>
        </div>`;
      bnZone.querySelector("[data-bn-dec]").onclick = () => { Cart.setBuyNowQty(bn.qty - 1); this.refreshAll(); };
      bnZone.querySelector("[data-bn-inc]").onclick = () => { Cart.setBuyNowQty(bn.qty + 1); this.refreshAll(); };
    } else {
      bnZone.innerHTML = "";
    }
  },

  renderPayment() {
    const restricted = this.user.paymentMode === "mandatory_upi";
    const locked = restricted || this.mode === "scheduled";
    const wrap = document.getElementById("payment-options");
    wrap.innerHTML = `
      <label class="pay-option ${this.paymentMode === "upi" ? "selected" : ""}">
        <input type="radio" name="pay" value="upi" ${this.paymentMode === "upi" ? "checked" : ""}>
        <div>
          <div class="po-title">UPI</div>
          <div class="po-desc">Pay now with any UPI app (demo gateway). Instant confirmation.</div>
          ${restricted ? `<div class="lock-note">🔒 Locked due to 2+ pickup no-shows</div>` : (this.mode === "scheduled" ? `<div class="lock-note">Scheduled orders are prepaid by UPI only</div>` : "")}
        </div>
      </label>
      <label class="pay-option ${this.paymentMode === "counter" ? "selected" : ""} ${locked ? "disabled" : ""}" ${locked ? "aria-disabled='true'" : ""}>
        <input type="radio" name="pay" value="counter" ${this.paymentMode === "counter" ? "checked" : ""} ${locked ? "disabled" : ""}>
        <div>
          <div class="po-title">Cash-at-Pickup</div>
          <div class="po-desc">Pay cash at the counter when you collect (Immediate Orders only).</div>
          ${restricted ? `<div class="lock-note">Disabled for your account — you can appeal in Help</div>` : (locked ? `<div class="lock-note">Not available for Scheduled Orders</div>` : "")}
        </div>
      </label>`;
    wrap.querySelectorAll("input[name=pay]").forEach(r =>
      r.addEventListener("change", e => {
        if (locked && e.target.value === "counter") return;
        this.paymentMode = e.target.value;
        this.renderPayment();
      }));
  },

  /* Pickup option: Immediate Order vs Scheduled Pickup */
  renderMode() {
    const wrap = document.getElementById("pickup-mode");
    const { prep } = this.totals();
    const asap = Queue.computeETA(prep, "asap");
    wrap.innerHTML = `
      <label class="pay-option ${this.mode === "asap" ? "selected" : ""}">
        <input type="radio" name="pmode" value="asap" ${this.mode === "asap" ? "checked" : ""}>
        <div>
          <div class="po-title">Immediate Order</div>
          <div class="po-desc">Join the live kitchen line now. Ready around <strong>${TimeUtil.clockLabel(asap.etaDate)}</strong> (~${asap.waitMinutes} min wait).</div>
        </div>
      </label>
      <label class="pay-option ${this.mode === "scheduled" ? "selected" : ""}">
        <input type="radio" name="pmode" value="scheduled" ${this.mode === "scheduled" ? "checked" : ""}>
        <div>
          <div class="po-title">Scheduled Pickup</div>
          <div class="po-desc">Reserve a 15-minute window for later today — your food is hot at the start of your slot.</div>
        </div>
      </label>`;
    wrap.querySelectorAll("input[name=pmode]").forEach(r =>
      r.addEventListener("change", e => {
        this.mode = e.target.value;
        if (this.mode === "scheduled") this.paymentMode = "upi";
        this.renderPayment();
        this.renderMode();
        this.renderSlots();
        this.updateEstimate();
        this.updatePlaceBtn(false);
      }));
    document.getElementById("slot-section").classList.toggle("hidden", this.mode !== "scheduled");
  },

  renderSlots() {
    const section = document.getElementById("slot-section");
    if (this.mode !== "scheduled") { section.classList.add("hidden"); return; }
    section.classList.remove("hidden");

    const { prep } = this.totals();
    const grid = document.getElementById("slot-grid");
    const states = Slots.upcoming(prep);

    if (!states.length) {
      grid.innerHTML = `<p class="text-muted" style="grid-column:1/-1">No more pickup slots today. Try Normal Queue, or come back ${TimeUtil.nextOpeningLabel()}.</p>`;
      return;
    }

    /* Auto-suggest nearest slot if nothing valid is selected */
    if (!this.slotId || !states.find(s => s.id === this.slotId && s.usable)) {
      const s = Slots.suggest(prep);
      this.slotId = s ? s.id : null;
    }

    grid.innerHTML = states.map(s => `
      <button class="slot-card ${this.slotId === s.id ? "selected" : ""}"
        data-slot="${s.id}" ${s.usable ? "" : "disabled"}
        aria-pressed="${this.slotId === s.id}">
        <span class="slot-time">${s.label}</span>
        <span class="slot-cap">
          ${s.full ? `<span class="slot-full">FULL</span> · ` : ""}
          ${s.remaining} / ${s.capacity} prep-min left
        </span>
        <span class="slot-meter"><i style="width:${Math.min(100, (s.reserved / s.capacity) * 100)}%"></i></span>
      </button>`).join("");

    grid.querySelectorAll("[data-slot]").forEach(btn =>
      btn.addEventListener("click", () => {
        this.slotId = btn.dataset.slot;
        this.renderSlots();
        this.updateEstimate();
        this.updatePlaceBtn(false);
      }));

    const sug = Slots.suggest(prep);
    document.getElementById("slot-suggestion").innerHTML = sug
      ? `<p class="text-muted mt-16" style="font-size:.85rem">⏱ Nearest available pickup: <strong>${sug.label}</strong> — ready by ${TimeUtil.minsToLabel(sug.startMin)}</p>`
      : "";
  },

  /* The estimate panel the customer sees BEFORE paying */
  updateEstimate() {
    const el = document.getElementById("eta-preview");
    if (!el) return;
    const { prep } = this.totals();
    let inner;
    if (this.mode === "asap") {
      const e = Queue.computeETA(prep, "asap");
      this.shownReady = e.readyMin; /* FR8: ETA the customer is looking at */
      inner = `
        <small>Checkout ETA · Immediate Order</small>
        <strong>${TimeUtil.clockLabel(e.etaDate)}</strong>
        <span class="eta-wait">~${e.waitMinutes} min wait · accounts for orders already in line · locked when you place the order</span>`;
    } else if (this.slotId) {
      const slot = Slots.byId(this.slotId);
      const wait = Math.max(1, slot.startMin - TimeUtil.nowMinutes());
      inner = `
        <small>Estimated pickup · Scheduled ${Slots.label(slot)}</small>
        <strong>${TimeUtil.minsToLabel(slot.startMin)}</strong>
        <span class="eta-wait">~${wait} min from now · locked when you place the order</span>`;
    } else {
      inner = `
        <small>Estimated pickup · Scheduled</small>
        <strong style="font-size:1.05rem;color:#fff">Select a slot below</strong>
        <span class="eta-wait">Your exact pickup time appears here before you pay</span>`;
    }
    el.innerHTML = inner;
  },

  updatePlaceBtn(blocked) {
    const btn = document.getElementById("place-order-btn");
    const { lines, prep } = this.totals();
    let ok = !blocked && lines.length && this.user.status !== "suspended" && TimeUtil.isOpen();
    if (this.mode === "scheduled" && !this.slotId) ok = false;
    if (this.mode === "asap" && !Queue.completesBeforeClose(prep, "asap")) ok = false;
    if (this.mode === "asap" && prep > Policy.get().prepLimit) ok = false; /* FR6.1 */
    if ((this.user.pendingDue || 0) > 0) ok = false;
    if (this.user.orderBlockUntil && new Date(this.user.orderBlockUntil) > TimeUtil.now()) ok = false;
    const note = document.getElementById("prep-limit-note");
    if (note) note.remove();
    if (this.mode === "asap" && prep > Policy.get().prepLimit) {
      btn.insertAdjacentHTML("beforebegin", `<p id="prep-limit-note" class="text-muted" style="color:#A03E2C;font-size:.85rem;margin-bottom:8px">Prep time ${prep} min exceeds the ${Policy.get().prepLimit}-min Immediate Order limit (FR6.1). Reduce the cart or choose Scheduled Pickup.</p>`);
    }
    btn.disabled = !ok;
  },

  refreshAll() {
    this.renderSummary();
    this.renderMode();
    this.renderSlots();
    this.updateEstimate();
    this.updatePlaceBtn(false);
  },

  place() {
    const { lines, prep } = this.totals();
    if (!lines.length) return;

    if (this.mode === "scheduled") {
      if (!this.slotId) { toast("Please pick a pickup slot first.", "warn"); return; }
      const slot = Slots.byId(this.slotId);
      const remaining = slot.capacity - Slots.reservedBySlot(slot.id);
      if (remaining < prep) {
        toast("Slot unavailable — capacity just filled. Please pick another.", "error");
        this.renderSlots();
        this.updateEstimate();
        return;
      }
      if (!Queue.completesBeforeClose(prep, "scheduled", this.slotId)) {
        toast("This slot ends after 6:00 PM closing. Choose an earlier slot.", "error");
        return;
      }
    } else {
      if (!Queue.completesBeforeClose(prep, "asap")) {
        toast("The kitchen queue is too long to finish before 6:00 PM. Try a smaller order.", "error");
        return;
      }
    }

    if (this.mode === "asap") { /* FR8: reconfirm if Ready time moved beyond tolerance */
      const e = Queue.computeETA(prep, "asap");
      if (this.shownReady != null && Math.abs(e.readyMin - this.shownReady) > Policy.get().etaTolerance) {
        this.shownReady = e.readyMin; this.updateEstimate();
        if (!confirm(`Ready time changed to ${TimeUtil.minsToLabel(e.readyMin)}. Continue?`)) return;
      }
    }
    if (this.mode === "asap" && prep > Policy.get().prepLimit) { toast("Cart exceeds Immediate Order prep limit. Choose Scheduled Pickup.", "warn"); return; }
    if (this.mode === "scheduled") this.paymentMode = "upi";
    if (this.paymentMode === "upi") {
      this.runMockUPI(success => { if (success) this.commit("paid"); });
    } else {
      this.commit("pending");
    }
  },

  /* Mock UPI gateway: Processing → Success / Failure */
  runMockUPI(done) {
    const overlay = openModal(`
      <div class="text-center" style="padding:14px 0 4px">
        <div class="spinner" aria-hidden="true"></div>
        <h3>Processing UPI payment…</h3>
        <p class="modal-sub">Do not close this window (demo gateway)</p>
      </div>`, { sticky: true });
    setTimeout(() => {
      const success = Math.random() < 0.9; // 90% success for demo realism
      if (success) {
        overlay.querySelector(".modal-card").innerHTML = `
          <div class="text-center" style="padding:14px 0 4px">
            <div class="success-icon" style="margin-bottom:14px"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
            <h3>Payment successful</h3>
            <p class="modal-sub">Confirming your order…</p>
          </div>`;
        toast("Payment successful", "success");
        setTimeout(() => { closeModal(); done(true); }, 900);
      } else {
        overlay.querySelector(".modal-card").innerHTML = `
          <div class="text-center" style="padding:14px 0 4px">
            <div class="success-icon" style="background:var(--red-soft);color:#A03E2C;margin-bottom:14px"><strong style="font-size:1.6rem">✕</strong></div>
            <h3>Payment failed</h3>
            <p class="modal-sub">The demo bank declined this attempt. No money was charged.</p>
            <div class="modal-actions">
              <button class="btn btn-ghost" data-modal-close>Cancel</button>
              <button class="btn btn-primary" data-retry>Retry Payment</button>
            </div>
          </div>`;
        overlay.querySelector("[data-retry]").onclick = () => { closeModal(); this.runMockUPI(done); };
        overlay.querySelector("[data-modal-close]").onclick = () => closeModal();
        toast("Payment failed. Please retry.", "error");
      }
    }, 1800);
  },

  async syncOrderToServer(order) {
    const endpoint = (window.SCOTS_NOTIFICATION_API_BASE || '/api').replace(/\/$/, '');
    try {
      const res = await fetch(endpoint + '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(order),
      });
      if (!res.ok) throw new Error(`Order sync failed (${res.status})`);
      return await res.json();
    } catch (err) {
      console.warn('SCOTS server order sync failed; keeping local cache as fallback.', err);
      return null;
    }
  },

  async commit(paymentStatus) {
    const { lines, subtotal, fee, total, prep } = this.totals();
    const slot = this.mode === "scheduled" ? Slots.byId(this.slotId) : null;
    const est = Queue.computeETA(prep, this.mode, this.slotId);

    const order = {
      id: "o-" + Date.now(),
      token: DB.nextToken(),
      userId: this.user.id,
      userName: this.user.name,
      items: lines.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, image: i.image, prepTime: i.prepTime })),
      subtotal, serviceFee: fee, total,
      prepMinutes: prep,
      payment: { mode: this.paymentMode, status: paymentStatus },
      mode: this.mode,                                        // "asap" (Immediate) | "scheduled"
      orderType: this.mode === "asap" ? "Immediate" : "Scheduled",
      promisedReleaseMin: slot ? slot.startMin - prep : null, // FR12.5, fixed at placement
      latestStartMin: slot ? slot.startMin - prep + Policy.get().maxSlack : null,
      policy: { delayGrace: Policy.get().delayGrace, noShowForfeitPct: Policy.get().noShowForfeitPct, lateCancelPct: Policy.get().lateCancelPct, autoExpiryMin: Policy.get().autoExpiryMin }, // FR24 snapshot
      slotId: slot ? slot.id : null,
      slotLabel: slot ? Slots.label(slot) : "Immediate",
      placedAt: TimeUtil.now().toISOString(),
      eta: est.etaDate.toISOString(),                         // locked — never recomputed
      waitMinutes: est.waitMinutes,                           // locked
      status: "received",
      readyAt: null,
      statusHistory: [{ status: "received", at: TimeUtil.now().toISOString() }],
    };

    DB.addOrder(order);
    // Persist to the shared server so another device (staff/admin) can see
    // the order. If the server is unreachable, localStorage remains the
    // offline fallback and the customer can continue the demo flow.
    const serverResult = await this.syncOrderToServer(order);
    if (serverResult?.order) {
      DB.saveOrders(DB.getOrders().map(o => o.id === serverResult.order.id ? serverResult.order : o));
    }
    if (paymentStatus === "paid") {
      DB.addTransaction({ id: "txn-" + Date.now(), orderId: order.id, token: order.token, amount: total, type: "payment", note: "UPI payment received" });
    }
    DB.addAudit({ type: "order", message: `${order.token} placed by ${this.user.name} (${U.rupees(total)}, ${order.payment.mode}, ${order.mode === "asap" ? "immediate" : "scheduled"})` });

    if (this.source === "buynow") Cart.clearBuyNow(); else Cart.clear();

    toast("Order confirmed", "success");
    location.href = ROOT + "order-success.html?o=" + encodeURIComponent(order.id);
  },
};

document.addEventListener("DOMContentLoaded", () => Checkout.init());
