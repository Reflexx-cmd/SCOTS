/* ============================================================
   SCOTS — reports.js
   Sales reports with hand-rolled canvas charts (no libraries,
   works fully offline from file://).
   ============================================================ */

const Reports = {
  range: "today", // "today" | "week"

  init() {
    if (!Admin.guardAdmin()) return;
    Admin.opsNav("reports");
    sweepExpiries();
    document.getElementById("range-today").addEventListener("click", () => { this.range = "today"; this.render(); });
    document.getElementById("range-week").addEventListener("click", () => { this.range = "week"; this.render(); });
    this.render();
  },

  /* Orders for the selected range. "week" blends real orders with
     deterministic demo history so charts look alive in class. */
  scopedOrders() {
    const real = DB.getOrders();
    if (this.range === "today") return real;
    const demo = [];
    const menu = DB.getMenu();
    let seed = 42;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let d = 6; d >= 1; d--) {
      const n = 8 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) {
        const item = menu[Math.floor(rnd() * menu.length)];
        const day = new Date(); day.setDate(day.getDate() - d);
        demo.push({
          id: `hist-${d}-${i}`, token: "HIST",
          items: [{ id: item.id, name: item.name, price: item.price, qty: 1 + Math.floor(rnd() * 2) }],
          total: Math.round((item.price * (1 + rnd())) + 5),
          status: rnd() < .82 ? "collected" : (rnd() < .5 ? "expired" : "cancelled"),
          payment: { mode: rnd() < .6 ? "upi" : "counter", status: "paid" },
          placedAt: day.toISOString(),
        });
      }
    }
    return demo.concat(real);
  },

  render() {
    document.getElementById("range-today").classList.toggle("active", this.range === "today");
    document.getElementById("range-week").classList.toggle("active", this.range === "week");

    const orders = this.scopedOrders();
    const valid = orders.filter(o => o.status !== "expired");
    const revenue = valid.reduce((s, o) => s + o.total, 0);

    document.getElementById("report-stats").innerHTML = `
      <div class="stat-card"><small>Total Orders</small><div class="stat-val">${orders.length}</div></div>
      <div class="stat-card accent"><small>Revenue</small><div class="stat-val">${U.rupees(revenue)}</div></div>
      <div class="stat-card"><small>Avg Order Value</small><div class="stat-val">${U.rupees(orders.length ? Math.round(revenue / orders.length) : 0)}</div></div>
      <div class="stat-card"><small>Expired / No-show</small><div class="stat-val">${orders.filter(o => o.status === "expired").length}</div></div>`;

    this.drawDailySales(orders);
    this.renderPopular(orders);
    this.drawDonut("status-chart", this.statusBreakdown(orders));
    this.drawDonut("payment-chart", this.paymentBreakdown(orders));
  },

  /* Daily sales — bar chart for last 7 days */
  drawDailySales(orders) {
    const canvas = document.getElementById("sales-chart");
    const ctx = canvas.getContext("2d");
    const days = [];
    for (let d = 6; d >= 0; d--) {
      const day = new Date(); day.setDate(day.getDate() - d);
      days.push({ label: day.toLocaleDateString("en-IN", { weekday: "short" }), key: day.toDateString(), total: 0 });
    }
    orders.forEach(o => {
      const key = new Date(o.placedAt).toDateString();
      const day = days.find(d => d.key === key);
      if (day && o.status !== "expired") day.total += o.total;
    });

    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = 440;
    const pad = { l: 20, r: 20, t: 30, b: 60 };
    const max = Math.max(100, ...days.map(d => d.total));
    const bw = (W - pad.l - pad.r) / days.length;

    ctx.clearRect(0, 0, W, H);
    ctx.font = "600 20px Poppins, sans-serif";
    days.forEach((d, i) => {
      const h = ((H - pad.t - pad.b) * d.total) / max;
      const x = pad.l + i * bw + bw * 0.18;
      const y = H - pad.b - h;
      const isToday = i === days.length - 1;
      ctx.fillStyle = isToday ? "#F2994A" : "#F5D9B8";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, bw * 0.64, Math.max(4, h), 10);
      else ctx.rect(x, y, bw * 0.64, Math.max(4, h));
      ctx.fill();
      ctx.fillStyle = "#8B7F70";
      ctx.textAlign = "center";
      ctx.fillText(d.label, x + bw * 0.32, H - 24);
      if (d.total > 0) {
        ctx.fillStyle = "#4A4238";
        ctx.fillText("₹" + d.total, x + bw * 0.32, y - 10);
      }
    });
  },

  renderPopular(orders) {
    const counts = {};
    orders.forEach(o => o.items.forEach(i => { counts[i.name] = (counts[i.name] || 0) + i.qty; }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = top.length ? top[0][1] : 1;
    document.getElementById("popular-chart").innerHTML = top.length
      ? top.map(([name, n]) => `
        <div class="bar-row">
          <span>${U.esc(name)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
          <span class="bar-val">${n}</span>
        </div>`).join("")
      : `<p class="text-muted">No data yet.</p>`;
  },

  statusBreakdown(orders) {
    const map = {};
    orders.forEach(o => { const l = STATUS_LABELS[o.status] || o.status; map[l] = (map[l] || 0) + 1; });
    const palette = ["#4E9F6B", "#F2994A", "#5B8DB8", "#D96A57", "#8B7F70", "#FFC96B"];
    return Object.entries(map).map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
  },

  paymentBreakdown(orders) {
    const upi = orders.filter(o => o.payment.mode === "upi").length;
    const counter = orders.length - upi;
    return [
      { label: "UPI", value: upi, color: "#F2994A" },
      { label: "Cash-at-Pickup", value: counter, color: "#4A4238" },
    ].filter(s => s.value > 0);
  },

  drawDonut(canvasId, slices) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = 320;
    ctx.clearRect(0, 0, W, H);
    const total = slices.reduce((s, x) => s + x.value, 0);
    const legendEl = canvas.parentElement.querySelector(".legend");
    if (!total) {
      ctx.fillStyle = "#8B7F70"; ctx.font = "500 22px Poppins, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No data", W / 2, H / 2);
      if (legendEl) legendEl.innerHTML = "";
      return;
    }
    const cx = W / 2, cy = H / 2, r = 100, thick = 42;
    let angle = -Math.PI / 2;
    slices.forEach(s => {
      const sweep = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = thick;
      ctx.arc(cx, cy, r, angle + 0.03, angle + sweep - 0.03);
      ctx.stroke();
      angle += sweep;
    });
    ctx.fillStyle = "#26211B";
    ctx.font = "800 34px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(total, cx, cy + 4);
    ctx.font = "500 18px Poppins, sans-serif";
    ctx.fillStyle = "#8B7F70";
    ctx.fillText("orders", cx, cy + 32);
    if (legendEl) legendEl.innerHTML = slices.map(s => `<span><i style="background:${s.color}"></i>${s.label} (${s.value})</span>`).join("");
  },
};

document.addEventListener("DOMContentLoaded", () => Reports.init());
