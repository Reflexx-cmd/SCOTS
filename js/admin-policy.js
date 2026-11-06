/* SCOTS - admin-policy.js: Policy Settings (FR24) + Audit Log (FR26) */
const AdminPolicy = {
  FIELDS: [
    ["cooks", "Kitchen cook count N (1-5)", "Applies from next operating day"],
    ["windowLen", "Time Window length (min)", ""],
    ["scheduledShare", "Scheduled Order capacity share (0-1)", "Default 0.667 = 2/3"],
    ["maxSlack", "Max Slack (min)", "Not above window length"],
    ["delayGrace", "Delay Grace (min)", "Not above Max Slack"],
    ["prepLimit", "Immediate/Offline prep limit (min)", "Not above Max Slack"],
    ["minLeadMin", "Minimum Scheduled lead time (min)", ""],
    ["noShowForfeitPct", "No-Show forfeiture (%)", ""],
    ["lateCancelPct", "Late-cancellation penalty (%)", ""],
    ["autoExpiryMin", "Auto-expiry window (min)", ""],
    ["lookbackDays", "No-Show lookback (days)", ""],
    ["pendingDueDays", "Pending Due review period (days)", ""],
    ["rapidCancelLimit", "Rapid-cancel threshold (per day)", ""],
  ],
  initPolicy() {
    const user = Auth.guard("admin"); if (!user) return;
    Admin.opsNav("policy");
    const p = Policy.get();
    document.getElementById("policy-form").innerHTML = this.FIELDS.map(([k, label, hint]) =>
      `<label class="sum-row" style="gap:12px"><span>${label}<br><small class="text-muted">${hint}</small></span>
       <input data-k="${k}" type="number" step="any" value="${k === "scheduledShare" ? Number(p[k].toFixed(3)) : p[k]}" style="width:110px"></label>`).join("") +
      `<div class="modal-actions"><button class="btn btn-ghost" id="pol-reset">Reset defaults</button><button class="btn btn-primary" id="pol-save">Save (new orders only)</button></div>`;
    document.getElementById("pol-save").onclick = () => this.save();
    document.getElementById("pol-reset").onclick = () => { const s = DB.getSettings(); delete s.policy; DB.saveSettings(s); location.reload(); };
  },
  save() {
    const v = {};
    document.querySelectorAll("[data-k]").forEach(i => v[i.dataset.k] = Number(i.value));
    const err =
      !(v.scheduledShare > 0 && v.scheduledShare < 1) ? "Capacity share must be strictly between 0 and 1." :
      !(v.cooks >= 1 && v.cooks <= 5 && Number.isInteger(v.cooks)) ? "Cooks must be an integer 1 to 5." :
      !(v.delayGrace <= v.maxSlack && v.maxSlack <= v.windowLen) ? "Need Delay Grace <= Max Slack <= Window length." :
      !(v.prepLimit <= v.maxSlack) ? "Prep limit must not exceed Max Slack." :
      Object.values(v).some(x => !Number.isFinite(x) || x < 0) ? "All values must be valid positive numbers." : null;
    if (err) { toast(err, "error"); return; }
    const before = Policy.get();
    Policy.set(v);
    /* new capacity for slots still at the old default */
    DB.saveSlots(DB.getSlots().map(s => ({ ...s, capacity: Policy.schedCapacity() })));
    const changed = Object.keys(v).filter(k => before[k] !== v[k]).map(k => `${k}: ${before[k]} -> ${v[k]}`).join("; ");
    DB.addAudit({ type: "policy", message: "Policy changed. " + (changed || "no change") });
    toast("Policy saved. Applies to new orders only.", "success");
  },
  initAudit() {
    const user = Auth.guard("admin"); if (!user) return;
    Admin.opsNav("audit");
    const draw = () => {
      const t = document.getElementById("audit-type").value, q = document.getElementById("audit-q").value.toLowerCase();
      const rows = DB.getAudit().slice().reverse().filter(e => (!t || e.type === t) && (!q || (e.message || "").toLowerCase().includes(q)));
      document.getElementById("audit-table").innerHTML = `<div class="table-wrap"><div class="table-scroll"><table class="data"><thead><tr><th>Time</th><th>Actor</th><th>Type</th><th>Event</th></tr></thead><tbody>${
        rows.map(e => `<tr><td style="white-space:nowrap">${TimeUtil.dateLabel(new Date(e.at))} ${TimeUtil.isoToLabel(e.at)}</td><td>${U.esc(e.actor || "-")}</td><td>${U.esc(e.type)}</td><td>${U.esc(e.message)}</td></tr>`).join("") || `<tr><td colspan="4">No entries</td></tr>`}</tbody></table></div></div>`;
    };
    const types = [...new Set(DB.getAudit().map(e => e.type))].sort();
    document.getElementById("audit-type").innerHTML = `<option value="">All actions</option>` + types.map(x => `<option>${U.esc(x)}</option>`).join("");
    document.getElementById("audit-type").onchange = draw; document.getElementById("audit-q").oninput = draw;
    draw();
  },
  /* Refund review (FR14.1) + Pending Due review (FR22.1) */
  initFinance() {
    const user = Auth.guard("admin"); if (!user) return;
    Admin.opsNav("finance");
    const draw = () => {
      const tx = DB.getTransactions().filter(t => ["refund", "forfeit"].includes(t.type)).reverse();
      document.getElementById("refund-table").innerHTML = `<div class="table-wrap"><div class="table-scroll"><table class="data"><thead><tr><th>Token</th><th>Type</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead><tbody>${
        tx.map(t => `<tr><td>${U.esc(t.token)}</td><td>${t.type === "refund" ? "Refund" : "Retained (forfeit)"}</td><td>${U.rupees(t.amount)}</td><td>${t.type === "refund" ? "Succeeded" : "-"}</td><td>${U.esc(t.note)}</td></tr>`).join("") || `<tr><td colspan="5">No refunds yet</td></tr>`}</tbody></table></div></div>`;
      const dues = DB.getUsers().filter(u => (u.pendingDue || 0) > 0);
      document.getElementById("due-table").innerHTML = `<div class="table-wrap"><div class="table-scroll"><table class="data"><thead><tr><th>Customer</th><th>Enrollment</th><th>Pending Due</th><th>Action</th></tr></thead><tbody>${
        dues.map(u => `<tr><td>${U.esc(u.name)}</td><td>${U.esc(u.enrollment)}</td><td>${U.rupees(u.pendingDue)}</td><td><button class="btn btn-primary btn-sm" data-settle="${u.id}">Record counter payment</button></td></tr>`).join("") || `<tr><td colspan="4">No outstanding dues</td></tr>`}</tbody></table></div></div>`;
      document.querySelectorAll("[data-settle]").forEach(b => b.onclick = () => { Dues.settle(b.dataset.settle); toast("Due cleared", "success"); draw(); });
    };
    draw();
  },
};
