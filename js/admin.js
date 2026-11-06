/* ============================================================
   SCOTS — admin.js
   Admin dashboard, menu management (CRUD), slot management,
   user management + reinstate, and demo controls.
   ============================================================ */

const Admin = {
  /* ---------- Shared ---------- */
  guardAdmin() { return Auth.guard("admin"); },

  opsNav(active) {
    const mount = document.getElementById("ops-nav");
    if (!mount) return;
    const root = document.body.dataset.root || "";
    const links = [
      ["admin/dashboard.html", "Overview", "dash"],
      ["admin/menu.html", "Menu", "menu"],
      ["admin/slots.html", "Slots", "slots"],
      ["admin/reports.html", "Reports", "reports"],
      ["admin/users.html", "Users", "users"],
      ["admin/appeals.html", "Appeals", "appeals"],
      ["admin/policy.html", "Policy", "policy"],
      ["admin/finance.html", "Refunds & Dues", "finance"],
      ["admin/audit.html", "Audit Log", "audit"],
    ];
    mount.innerHTML = `
      <div class="ops-nav"><div class="container ops-nav-inner">
        ${links.map(([href, label, key]) =>
          `<a href="${root}${href}" class="${active === key ? "active" : ""}"${key === "appeals" ? ` data-notification-section="appeals"` : ""}>${label}</a>`).join("")}
        <span class="ops-role">${document.body.dataset.role === "staff" ? "Canteen Staff Console" : "Canteen Admin Console"}</span>
      </div></div>`;
    if (typeof NotificationEngine !== "undefined") NotificationEngine.updateSectionBadges();
  },

  /* ---------- Dashboard ---------- */
  async initDashboard() {
    const user = this.guardAdmin();
    if (!user) return;
    this.opsNav("dash");
    await Realtime.pullOrders(user.id, user.role);
    window.addEventListener("scots:order-created-remote", () => this.renderDashboard());
    window.addEventListener("scots:order-changed", () => this.renderDashboard());
    this.renderDashboard();
    this.renderDemoControls();
    setInterval(() => {
      sweepExpiries();
      this.renderDashboard();
      const clock = document.getElementById("sim-clock-value");
      if (clock) clock.textContent = TimeUtil.clockLabel(TimeUtil.now());
    }, 1000);
  },

  renderDashboard() {
    const orders = DB.getOrders();
    const active = orders.filter(o => ["received", "preparing", "ready"].includes(o.status));
    const noShows = DB.getUsers().reduce((s, u) => s + (u.noShows || 0), 0);
    const pendingAppeals = DB.getAppeals().filter(a => a.status === "pending").length;
    const revenue = orders.filter(o => o.status !== "expired").reduce((s, o) => s + o.total, 0);
    const aov = orders.length ? Math.round(revenue / orders.length) : 0;

    document.getElementById("admin-stats").innerHTML = `
      <div class="stat-card"><small>Total Orders</small><div class="stat-val">${orders.length}</div></div>
      <div class="stat-card accent"><small>Revenue</small><div class="stat-val">${U.rupees(revenue)}</div></div>
      <div class="stat-card"><small>Avg Order Value</small><div class="stat-val">${U.rupees(aov)}</div></div>
      <div class="stat-card"><small>Active Orders</small><div class="stat-val">${active.length}</div></div>
      <div class="stat-card"><small>No-shows</small><div class="stat-val">${noShows}</div></div>
      <div class="stat-card"><small>Pending Appeals</small><div class="stat-val">${pendingAppeals}</div></div>`;

    /* Popular items bar list */
    const counts = {};
    orders.forEach(o => o.items.forEach(i => { counts[i.name] = (counts[i.name] || 0) + i.qty; }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = top.length ? top[0][1] : 1;
    document.getElementById("admin-popular").innerHTML = top.length
      ? top.map(([name, n]) => `
        <div class="bar-row">
          <span>${U.esc(name)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
          <span class="bar-val">${n}</span>
        </div>`).join("")
      : `<p class="text-muted">No orders yet — seed demo orders from Demo Controls below.</p>`;

    /* Status distribution */
    const byStatus = {};
    orders.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
    document.getElementById("admin-status-dist").innerHTML = orders.length
      ? Object.entries(byStatus).map(([st, n]) => `
        <div class="bar-row">
          <span>${STATUS_LABELS[st] || st}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(n / orders.length) * 100}%"></span></span>
          <span class="bar-val">${n}</span>
        </div>`).join("")
      : `<p class="text-muted">No orders yet.</p>`;

    /* Recent audit log */
    const audit = DB.getAudit().slice(-8).reverse();
    document.getElementById("admin-audit").innerHTML = audit.length
      ? audit.map(a => `
        <div class="sum-row">
          <span>${U.esc(a.message)}</span>
          <span class="text-muted" style="white-space:nowrap">${TimeUtil.isoToLabel(a.at)}</span>
        </div>`).join("")
      : `<p class="text-muted">No events logged yet.</p>`;
  },

  /* ---------- Demo controls ---------- */
  renderDemoControls() {
    const zone = document.getElementById("demo-controls");
    if (!zone) return;
    const s = DB.getSettings();
    zone.innerHTML = `
      <div class="demo-controls">
        <h3>🛠 DEMO CONTROLS</h3>
        <p>Visible to admins only. Use these to run through every scenario during your presentation.</p>
        <div class="dc-grid">
          <button class="btn btn-soft btn-sm" data-dc="seed">Seed Demo Orders</button>
          <button class="btn btn-soft btn-sm" data-dc="demo-mode">DEMO_MODE: ${s.demoMode ? "ON" : "OFF"}</button>
          <button class="btn btn-soft btn-sm" data-dc="noshow">Create Test No-show</button>
          <button class="btn btn-soft btn-sm" data-dc="advance">Advance Test Order Status</button>
          <button class="btn btn-danger btn-sm" data-dc="reset">Reset Demo Data</button>
        </div>
        <div class="dc-grid mt-16" style="align-items:end">
          <div class="field">
            <label for="sim-hour" style="font-size:.78rem">Simulate current time</label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              <div><small class="sim-time-label">HH</small><select id="sim-hour" aria-label="Hour">${Array.from({length:12}, (_,i) => { const h=i+1; const cur=((s.simulate?.minutes ?? 750) / 60) % 12 || 12; return `<option value="${h}" ${h===cur ? "selected" : ""}>${String(h).padStart(2,"0")}</option>`; }).join("")}</select></div>
              <div><small class="sim-time-label">MM</small><select id="sim-minute" aria-label="Minute">${Array.from({length:60}, (_,m) => `<option value="${m}" ${m===((s.simulate?.minutes ?? 750)%60) ? "selected" : ""}>${String(m).padStart(2,"0")}</option>`).join("")}</select></div>
              <div><small class="sim-time-label">AM / PM</small><select id="sim-ampm" aria-label="AM or PM"><option value="AM" ${((s.simulate?.minutes ?? 750) >= 720) ? "" : "selected"}>AM</option><option value="PM" ${((s.simulate?.minutes ?? 750) >= 720) ? "selected" : ""}>PM</option></select></div>
            </div>
            <div class="text-muted" style="font-size:.72rem;margin-top:5px">Shared clock: <span id="sim-clock-value">${TimeUtil.clockLabel(TimeUtil.now())}</span></div>
          </div>
          <button class="btn btn-outline btn-sm" data-dc="sim-on">Apply Simulated Time</button>
          <button class="btn btn-ghost btn-sm" data-dc="sim-off" ${s.simulate?.enabled ? "" : "disabled"}>Use Real Time${s.simulate?.enabled ? " (simulating)" : ""}</button>
        </div>
      </div>`;

    zone.querySelectorAll("[data-dc]").forEach(btn =>
      btn.addEventListener("click", async () => {
        const action = btn.dataset.dc;
        const settings = DB.getSettings();
        if (action === "seed") {
          seedDemoOrders();
          toast("Demo orders seeded", "success");
        } else if (action === "demo-mode") {
          settings.demoMode = !settings.demoMode;
          DB.saveSettings(settings);
          toast("DEMO_MODE " + (settings.demoMode ? "enabled — ready orders expire in 1 minute" : "disabled"), "success");
        } else if (action === "noshow") {
          const count = NoShow.increment("u-student");
          toast(`Test no-show created (customer now has ${count})`, "warn");
        } else if (action === "advance") {
          const target = DB.getOrders().find(o => ["received", "preparing", "ready"].includes(o.status));
          if (!target) { toast("No active order to advance — seed demo orders first.", "warn"); return; }
          const flow = ["received", "preparing", "ready", "collected"];
          const next = flow[flow.indexOf(target.status) + 1];
          const patch = { status: next, statusHistory: (target.statusHistory || []).concat([{ status: next, at: TimeUtil.now().toISOString() }]) };
          if (next === "ready") patch.readyAt = TimeUtil.now().toISOString();
          DB.updateOrder(target.id, patch);
          toast(`${target.token} advanced to ${STATUS_LABELS[next]}`, "success");
        } else if (action === "reset") {
          const ok = await confirmDialog("Reset demo data?", "This restores demo users, menu, slots, orders, transactions, audit log and settings to factory state.", "Reset Everything");
          if (ok) { seedDemoData(true); toast("Demo data reset", "success"); setTimeout(() => location.href = (document.body.dataset.root || "") + "login.html", 900); return; }
        } else if (action === "sim-on") {
          const hour = Number(document.getElementById("sim-hour")?.value || 12);
          const minute = Number(document.getElementById("sim-minute")?.value || 30);
          const ampm = document.getElementById("sim-ampm")?.value || "PM";
          const hour24 = (hour % 12) + (ampm === "PM" ? 12 : 0);
          const minutes = hour24 * 60 + minute;
          settings.simulate = { enabled: true, minutes, anchorAt: new Date().toISOString() };
          DB.saveSettings(settings);
          const remote = await window.Realtime?.updateSettings({ simulate: { enabled: true, minutes } });
          if (remote?.simulate) DB.saveSettings({ ...settings, simulate: remote.simulate });
          toast("Now simulating " + TimeUtil.minsToLabel(minutes) + " for all devices", "success");
        } else if (action === "sim-off") {
          settings.simulate.enabled = false;
          DB.saveSettings(settings);
          await window.Realtime?.updateSettings({ simulate: settings.simulate });
          toast("Back to real time for all devices", "success");
        }
        this.renderDemoControls();
        this.renderDashboard();
      }));
  },

  /* ---------- Menu management ---------- */
  initMenuAdmin() {
    if (!this.guardAdmin()) return;
    this.opsNav("menu");
    this.renderMenuTable();
    document.getElementById("add-item-btn").addEventListener("click", () => this.openItemForm(null));
  },

  renderMenuTable() {
    const wrap = document.getElementById("menu-admin-table");
    const menu = DB.getMenu();
    wrap.innerHTML = `
      <div class="table-wrap"><div class="table-scroll">
      <table class="data">
        <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Prep</th><th>Rating</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${menu.map(m => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:10px">
              <img src="${ROOT}${m.image}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover">
              <strong>${U.esc(m.name)}</strong></div></td>
            <td>${U.esc(m.category)}</td>
            <td>${U.rupees(m.price)}</td>
            <td>${m.prepTime} min</td>
            <td>★ ${m.rating.toFixed(1)}</td>
            <td>${m.soldOut ? `<span class="pill red">Sold Out</span>` : m.available ? `<span class="pill green">Available</span>` : `<span class="pill dark">Hidden</span>`}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-edit="${m.id}">Edit</button>
              <button class="btn btn-soft btn-sm" data-soldout="${m.id}">${m.soldOut ? "Restock" : "Sold Out"}</button>
              <button class="btn btn-ghost btn-sm" data-avail="${m.id}">${m.available ? "Hide" : "Show"}</button>
              <button class="btn btn-danger btn-sm" data-del="${m.id}">Delete</button>
            </td>
          </tr>`).join("")}</tbody>
      </table></div></div>`;

    wrap.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => this.openItemForm(b.dataset.edit));
    wrap.querySelectorAll("[data-soldout]").forEach(b => b.onclick = () => {
      const menu = DB.getMenu().map(m => m.id === b.dataset.soldout ? { ...m, soldOut: !m.soldOut } : m);
      DB.saveMenu(menu);
      const item = DB.getMenuItem(b.dataset.soldout);
      DB.addAudit({ type: "menu", message: `${item.name} marked ${item.soldOut ? "sold out" : "back in stock"}` });
      toast(item.soldOut ? "Marked as sold out" : "Back in stock", "success");
      if (item.soldOut) { const n = cancelOrdersForSoldOut(item.id); if (n) toast(`${n} Received order(s) cancelled and refunded (FR5.1)`, "warn"); }
      this.renderMenuTable();
    });
    wrap.querySelectorAll("[data-avail]").forEach(b => b.onclick = () => {
      const menu = DB.getMenu().map(m => m.id === b.dataset.avail ? { ...m, available: !m.available } : m);
      DB.saveMenu(menu);
      toast("Menu item updated", "success");
      this.renderMenuTable();
    });
    wrap.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const item = DB.getMenuItem(b.dataset.del);
      const ok = await confirmDialog("Delete this item?", `${item.name} will be removed from the menu immediately.`, "Delete Item");
      if (!ok) return;
      DB.saveMenu(DB.getMenu().filter(m => m.id !== b.dataset.del));
      DB.addAudit({ type: "menu", message: `${item.name} deleted from menu` });
      toast("Menu item deleted", "success");
      this.renderMenuTable();
    });
  },

  openItemForm(itemId) {
    const item = itemId ? DB.getMenuItem(itemId) : null;
    const images = ["veg-burger", "cheese-sandwich", "masala-dosa", "paneer-wrap", "veg-pizza", "french-fries", "cold-coffee", "masala-chai", "samosa", "veg-maggi", "hero-platter"];
    const overlay = openModal(`
      <h3>${item ? "Edit Item" : "Add New Item"}</h3>
      <p class="modal-sub">${item ? "Update the details below." : "Fill in the details to add it to today's menu."}</p>
      <form id="item-form" novalidate>
        <div class="form-row">
          <div class="field"><label for="f-name">Name</label><input id="f-name" required value="${item ? U.esc(item.name) : ""}"></div>
          <div class="field"><label for="f-cat">Category</label>
            <select id="f-cat">${["Breakfast", "Snacks", "Meals", "Beverages"].map(c =>
              `<option ${item && item.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="f-price">Price (₹)</label><input id="f-price" type="number" min="1" required value="${item ? item.price : ""}"></div>
          <div class="field"><label for="f-prep">Prep time (min)</label><input id="f-prep" type="number" min="1" max="60" required value="${item ? item.prepTime : ""}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="f-rating">Rating (0–5)</label><input id="f-rating" type="number" min="0" max="5" step="0.1" value="${item ? item.rating : "4.2"}"></div>
          <div class="field"><label for="f-img">Image</label>
            <select id="f-img">${images.map(i =>
              `<option value="assets/food/${i}.jpg" ${item && item.image.includes(i) ? "selected" : ""}>${i.replace(/-/g, " ")}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label for="f-ing">Ingredients</label><input id="f-ing" value="${item ? U.esc(item.ingredients) : ""}" placeholder="e.g. Crispy patty, lettuce, tomato"></div>
        <div class="field"><label for="f-desc">Description</label><textarea id="f-desc">${item ? U.esc(item.description) : ""}</textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${item ? "Save Changes" : "Add Item"}</button>
        </div>
      </form>`);

    overlay.querySelector("#item-form").addEventListener("submit", e => {
      e.preventDefault();
      const g = id => overlay.querySelector(id).value.trim();
      const price = Number(g("#f-price")), prep = Number(g("#f-prep"));
      if (!g("#f-name") || !price || price <= 0 || !prep || prep <= 0) {
        toast("Please fill name, a valid price and prep time.", "error");
        return;
      }
      const menu = DB.getMenu();
      if (item) {
        DB.saveMenu(menu.map(m => m.id === item.id ? {
          ...m, name: g("#f-name"), category: g("#f-cat"), price, prepTime: prep,
          rating: Math.min(5, Math.max(0, Number(g("#f-rating")) || 4)),
          image: g("#f-img"), ingredients: g("#f-ing"), description: g("#f-desc"),
        } : m));
        DB.addAudit({ type: "menu", message: `${g("#f-name")} updated` });
        toast("Menu item updated", "success");
      } else {
        menu.push({
          id: "m-" + Date.now(), name: g("#f-name"), category: g("#f-cat"), price, prepTime: prep,
          rating: Math.min(5, Math.max(0, Number(g("#f-rating")) || 4)),
          image: g("#f-img"), ingredients: g("#f-ing") || "Chef's special", description: g("#f-desc"),
          soldOut: false, available: true, popular: false,
        });
        DB.saveMenu(menu);
        DB.addAudit({ type: "menu", message: `${g("#f-name")} added to menu` });
        toast("Menu item added", "success");
      }
      closeModal();
      this.renderMenuTable();
    });
  },

  /* ---------- Slot management ---------- */
  initSlotsAdmin() {
    if (!this.guardAdmin()) return;
    this.opsNav("slots");
    this.renderSlotsAdmin();
    setInterval(() => this.renderSlotsAdmin(), 5000);
  },

  renderSlotsAdmin() {
    const wrap = document.getElementById("slots-admin-table");
    if (!wrap) return;
    const states = Slots.state(0).filter(s => !s.past);
    wrap.innerHTML = `
      <div class="table-wrap"><div class="table-scroll">
      <table class="data">
        <thead><tr><th>Slot</th><th>Capacity</th><th>Reserved</th><th>Remaining</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${states.map(s => `
          <tr>
            <td><strong>${s.label}</strong></td>
            <td>${s.capacity} min</td>
            <td>${s.reserved} min</td>
            <td>${s.remaining} min</td>
            <td>${!s.enabled ? `<span class="pill dark">Disabled</span>` : s.remaining <= 0 ? `<span class="pill red">Full</span>` : `<span class="pill green">Open</span>`}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-cap="${s.id}">Capacity</button>
              <button class="btn btn-soft btn-sm" data-toggle-slot="${s.id}">${s.enabled ? "Disable" : "Enable"}</button>
            </td>
          </tr>`).join("")}</tbody>
      </table></div></div>`;

    wrap.querySelectorAll("[data-cap]").forEach(b => b.onclick = () => {
      const slot = Slots.byId(b.dataset.cap);
      const overlay = openModal(`
        <h3>Slot capacity</h3>
        <p class="modal-sub">${Slots.label(slot)} — how many prep-minutes can the kitchen take in this window?</p>
        <div class="field"><label for="cap-input">Capacity (prep minutes)</label>
        <input id="cap-input" type="number" min="5" max="120" value="${slot.capacity}"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-modal-close>Cancel</button>
          <button class="btn btn-primary" data-save-cap>Save</button>
        </div>`);
      overlay.querySelector("[data-save-cap]").onclick = () => {
        const v = Number(overlay.querySelector("#cap-input").value);
        if (!v || v < 5) { toast("Capacity must be at least 5 minutes.", "error"); return; }
        Slots.setCapacity(slot.id, v);
        closeModal();
        toast("Slot capacity updated", "success");
        this.renderSlotsAdmin();
      };
    });
    wrap.querySelectorAll("[data-toggle-slot]").forEach(b => b.onclick = () => {
      const slot = Slots.byId(b.dataset.toggleSlot);
      Slots.setEnabled(slot.id, !slot.enabled);
      toast(slot.enabled ? "Slot disabled" : "Slot enabled", "success");
      this.renderSlotsAdmin();
    });
  },

  /* ---------- Users ---------- */
  initUsersAdmin() {
    if (!this.guardAdmin()) return;
    this.opsNav("users");
    this.renderUsers();
  },

  renderUsers() {
    const wrap = document.getElementById("users-table");
    const users = DB.getUsers();
    wrap.innerHTML = `
      <div class="table-wrap"><div class="table-scroll">
      <table class="data">
        <thead><tr><th>Name</th><th>Enrollment</th><th>Email</th><th>Role</th><th>No-shows</th><th>Payment Mode</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td><strong>${U.esc(u.name)}</strong></td>
            <td>${U.esc(u.enrollment)}</td>
            <td>${U.esc(u.email)}</td>
            <td style="text-transform:capitalize">${u.role}</td>
            <td>${u.noShows || 0}</td>
            <td>${u.paymentMode === "mandatory_upi" ? `<span class="pill orange">Mandatory UPI</span>` : `<span class="pill">Normal</span>`}</td>
            <td>${u.status === "suspended" ? `<span class="pill red">Suspended</span>` : `<span class="pill green">Active</span>`}</td>
            <td style="white-space:nowrap">
              ${u.status === "suspended" ? `<button class="btn btn-primary btn-sm" data-reinstate="${u.id}">Reinstate</button>` : ""}
              ${u.paymentMode === "mandatory_upi" && u.status !== "suspended" ? `<button class="btn btn-soft btn-sm" data-clearupi="${u.id}">Restore Normal Pay</button>` : ""}
            </td>
          </tr>`).join("")}</tbody>
      </table></div></div>`;
    wrap.querySelectorAll("[data-reinstate]").forEach(b => b.onclick = async () => {
      const u = DB.getUserById(b.dataset.reinstate);
      const ok = await confirmDialog("Reinstate this account?", `${u.name}'s no-show count will be reset to 0 and normal payment restored.`, "Reinstate");
      if (!ok) return;
      NoShow.reinstate(b.dataset.reinstate);
      toast("Account reinstated", "success");
      this.renderUsers();
    });
    wrap.querySelectorAll("[data-clearupi]").forEach(b => b.onclick = async () => {
      const u = DB.getUserById(b.dataset.clearupi);
      const ok = await confirmDialog("Remove UPI-only restriction?", `${u.name} will be able to pay at the counter again. Their no-show count stays unchanged.`, "Remove Restriction");
      if (!ok) return;
      NoShow.clearUpiRestriction(u.id);
      toast("UPI-only restriction removed", "success");
      this.renderUsers();
    });
  },

  /* ---------- Appeals inbox ---------- */
  initAppeals() {
    if (!this.guardAdmin()) return;
    this.opsNav("appeals");
    this.renderAppeals();
  },

  renderAppeals() {
    const wrap = document.getElementById("appeals-table");
    const appeals = DB.getAppeals().slice().reverse();
    const typeLabel = {
      "upi-restriction": "Remove UPI-only restriction",
      "suspension": "Suspension review",
      "other": "Other",
    };
    if (!appeals.length) {
      wrap.innerHTML = emptyStateHTML("📮", "No appeals yet", "When customers appeal a no-show, suspension or UPI-only restriction, it will appear here.", "");
      return;
    }
    wrap.innerHTML = `
      <div class="table-wrap"><div class="table-scroll">
      <table class="data">
        <thead><tr><th>Customer</th><th>Type</th><th>Message</th><th>No-shows</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${appeals.map(a => {
          const u = a.userId ? DB.getUserById(a.userId) : null;
          const pending = a.status === "pending";
          return `<tr data-appeal-id="${U.esc(a.id)}">
            <td><strong>${U.esc(a.userName)}</strong><br><span class="text-muted" style="font-size:.78rem">${U.esc(a.email || "")}</span></td>
            <td>${U.esc(typeLabel[a.type] || a.type)}</td>
            <td style="max-width:280px">${U.esc(a.message)}</td>
            <td>${u ? (u.noShows || 0) : "—"}</td>
            <td style="white-space:nowrap">${TimeUtil.isoToLabel(a.at)}<br><span class="text-muted" style="font-size:.78rem">${TimeUtil.dateLabel(new Date(a.at))}</span></td>
            <td>${pending ? `<span class="pill orange">Pending</span>` : `<span class="pill green">Resolved</span>`}</td>
            <td style="white-space:nowrap">
              ${pending && u && u.paymentMode === "mandatory_upi" && u.status !== "suspended" ? `<button class="btn btn-primary btn-sm" data-ap-upi="${a.id}" data-uid="${u.id}">Remove UPI Restriction</button>` : ""}
              ${pending && u && u.status === "suspended" ? `<button class="btn btn-primary btn-sm" data-ap-reinstate="${a.id}" data-uid="${u.id}">Reinstate Account</button>` : ""}
              ${pending ? `<button class="btn btn-ghost btn-sm" data-ap-dismiss="${a.id}">Dismiss</button>` : ""}
              ${(() => { const seen = typeof NotificationEngine !== "undefined" && NotificationEngine.mine().some(n => n.entityType === "appeal" && n.entityId === a.id && !n.readAt); return seen ? `<button class="btn btn-soft btn-sm" data-ap-read="${a.id}">Mark as read</button>` : `<span class="text-muted" style="font-size:.78rem">Seen</span>`; })()}
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div></div>`;

    wrap.querySelectorAll("[data-ap-upi]").forEach(b => b.onclick = async () => {
      const u = DB.getUserById(b.dataset.uid);
      const ok = await confirmDialog("Remove UPI-only restriction?", `${u.name} will be able to pay at the counter again. Their no-show count stays unchanged.`, "Remove Restriction");
      if (!ok) return;
      NoShow.clearUpiRestriction(u.id);
      DB.updateAppeal(b.dataset.apUpi, { status: "resolved", resolution: "UPI restriction removed" });
      toast("UPI-only restriction removed", "success");
      this.renderAppeals();
    });
    wrap.querySelectorAll("[data-ap-reinstate]").forEach(b => b.onclick = async () => {
      const u = DB.getUserById(b.dataset.uid);
      const ok = await confirmDialog("Reinstate this account?", `${u.name}'s no-show count resets to 0 and normal payment is restored.`, "Reinstate");
      if (!ok) return;
      NoShow.reinstate(u.id);
      DB.updateAppeal(b.dataset.apReinstate, { status: "resolved", resolution: "Account reinstated" });
      toast("Account reinstated", "success");
      this.renderAppeals();
    });
    wrap.querySelectorAll("[data-ap-dismiss]").forEach(b => b.onclick = () => {
      DB.updateAppeal(b.dataset.apDismiss, { status: "resolved", resolution: "Dismissed by admin" });
      DB.addAudit({ type: "appeal", message: "Appeal dismissed by admin" });
      toast("Appeal dismissed");
      this.renderAppeals();
    });
    wrap.querySelectorAll("[data-ap-read]").forEach(b => b.onclick = () => {
      if (typeof NotificationEngine !== "undefined") NotificationEngine.markByEntity("appeal", b.dataset.apRead, "appeals-explicit");
      toast("Appeal notification marked as read", "success");
      this.renderAppeals();
    });

    // A notification deep-link carries ?appeal=<id>. Do not mark it read
    // here; admins must explicitly mark it read or take an appeal action.
    const targetAppealId = new URLSearchParams(window.location.search).get("appeal");
    if (targetAppealId) {
      const row = wrap.querySelector(`[data-appeal-id="${CSS.escape(targetAppealId)}"]`);
      if (row) {
        row.classList.add("notification-deep-link-target");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => row.classList.remove("notification-deep-link-target"), 3500);
      }
    }
  },
};

window.addEventListener("scots:appeals-synced", () => { if (document.getElementById("appeals-table")) Admin.renderAppeals(); });
window.addEventListener("scots:settings-changed", () => { if (document.getElementById("demo-controls")) { Admin.renderDemoControls(); Admin.renderDashboard(); } });
