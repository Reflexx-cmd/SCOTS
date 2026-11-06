/* ============================================================
   SCOTS — token-display.js
   Public canteen TV display. Large type, auto-refresh.
   ============================================================ */

const TokenDisplay = {
  async init() {
    seedDemoData(false);
    window.Realtime?.startPublicDisplay();
    await window.Realtime?.pullOrders("public-display", "staff");
    sweepExpiries();
    this.render();
    window.addEventListener("scots:orders-synced", e => { if (e.detail?.role === "staff") this.render(); });
    window.addEventListener("scots:order-created-remote", () => this.render());
    window.addEventListener("scots:order-changed", () => this.render());
    window.addEventListener("scots:settings-changed", () => this.render());
    window.addEventListener("scots:queue-changed", e => { if (e.detail) this.queue = e.detail; this.render(); });
    await window.LiveQueue?.refresh?.();
    setInterval(() => { sweepExpiries(); this.render(); }, 3000);
  },

  render() {
    const orders = DB.getOrders();
    const serving = orders.filter(o => o.status === "ready");
    const preparing = orders
      .filter(o => ["received", "preparing"].includes(o.status) && !Queue.isHeld(o))
      .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
    const next5 = preparing.slice(0, 5); /* FR17: next 5 tokens in queue order */

    document.getElementById("tv-serving").innerHTML = serving.length
      ? serving.map(o => `<div class="tv-token serving">#${o.token.replace("SCOTS-", "")}</div>`).join("")
      : `<p class="tv-empty">No tokens ready right now</p>`;

    document.getElementById("tv-preparing").innerHTML = next5.length
      ? next5.map(o => `<div class="tv-token prep">#${o.token.replace("SCOTS-", "")}</div>`).join("")
      : `<p class="tv-empty">Kitchen queue is clear</p>`;

    document.getElementById("tv-clock").textContent = TimeUtil.clockLabel(TimeUtil.now());
    const qs = this.queue || Store.read("scots_queue_status", { activeCount: preparing.length, waitMinutes: Queue.activeQueueMinutes() });
    const qel = document.getElementById("tv-queue-wait");
    if (qel) qel.textContent = `${qs.waitMinutes || 0} min`;
    document.getElementById("tv-status").textContent = TimeUtil.isOpen()
      ? "● Canteen Open — orders accepted"
      : "○ Canteen Closed — opens " + TimeUtil.nextOpeningLabel();
    document.getElementById("tv-updated").textContent =
      "Last updated " + TimeUtil.clockLabel(TimeUtil.now());
    document.getElementById("tv-count").textContent =
      `${serving.length} ready · ${preparing.length} in the kitchen`;
  },
};

document.addEventListener("DOMContentLoaded", () => TokenDisplay.init());
