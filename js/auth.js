/* ============================================================
   SCOTS — auth.js
   Login, register, logout, role guards, no-show rules.
   ============================================================ */

const Auth = {
  current() { return DB.getCurrentUser(); },

  login(identifier, password) {
    const idf = String(identifier || "").trim().toLowerCase();
    const user = DB.getUsers().find(u =>
      u.email.toLowerCase() === idf || (u.enrollment || "").toLowerCase() === idf
    );
    if (!user) return { ok: false, error: "No account found for that email or enrollment number." };
    if (user.password !== password) return { ok: false, error: "Incorrect password. Please try again." };
    DB.setCurrentUser(user.id);
    DB.addAudit({ type: "login", message: `${user.name} (${user.role}) signed in` });
    return { ok: true, user };
  },

  quickLogin(role) {
    const user = DB.getUsers().find(u => u.role === role);
    if (!user) return { ok: false, error: "Demo account missing. Try Reset Demo Data." };
    DB.setCurrentUser(user.id);
    DB.addAudit({ type: "login", message: `${user.name} (${user.role}) signed in via demo button` });
    return { ok: true, user };
  },

  register(data) {
    const users = DB.getUsers();
    const email = data.email.trim().toLowerCase();
    if (users.some(u => u.email.toLowerCase() === email)) {
      return { ok: false, error: "An account with this email already exists." };
    }
    if (users.some(u => (u.enrollment || "").toLowerCase() === data.enrollment.trim().toLowerCase())) {
      return { ok: false, error: "This enrollment number is already registered." };
    }
    const user = {
      id: "u-" + Date.now(),
      role: "student",
      name: data.name.trim(),
      enrollment: data.enrollment.trim(),
      email,
      phone: data.phone.trim(),
      password: data.password,
      noShows: 0,
      paymentMode: "normal",
      status: "active",
    };
    users.push(user);
    DB.saveUsers(users);
    DB.addAudit({ type: "register", message: `New customer registered: ${user.name}` });
    return { ok: true, user };
  },

  logout() {
    const u = DB.getCurrentUser();
    if (u) DB.addAudit({ type: "logout", message: `${u.name} signed out` });
    DB.clearCurrentUser();
    sessionStorage.removeItem("scots_buy_now");
    location.href = (document.body.dataset.root || "") + "login.html";
  },

  homeFor(role) {
    const root = document.body.dataset.root || "";
    if (role === "staff") return root + "staff/dashboard.html";
    if (role === "admin") return root + "admin/dashboard.html";
    return root + "menu.html";
  },

  /* Role guard — call at the top of protected pages.
     required: "student" | "staff" | "admin" | "any" (any logged-in) */
  guard(required) {
    const root = document.body.dataset.root || "";
    const user = DB.getCurrentUser();
    if (!user) { location.href = root + "login.html"; return null; }
    if (required !== "any" && user.role !== required) {
      location.href = this.homeFor(user.role);
      return null;
    }
    return user;
  },
};

/* ---------- No-show policy (SRS FR22-FR23) ----------
   Counts non-waived No-Shows inside the lookback window (default 30 days).
   2 -> UPI prepayment only.  3 (while restricted) -> suspended until Admin review. */
const NoShow = {
  count(u) {
    const cutoff = TimeUtil.now().getTime() - Policy.get().lookbackDays * 86400000;
    return (u.noShowEvents || []).filter(e => !e.waived && new Date(e.at).getTime() >= cutoff).length;
  },
  increment(userId) {
    const u = DB.getUserById(userId);
    if (!u) return;
    const events = (u.noShowEvents || []).concat([{ at: TimeUtil.now().toISOString(), waived: false }]);
    const tmp = { ...u, noShowEvents: events };
    const count = this.count(tmp);
    const patch = { noShowEvents: events, noShows: count };
    if (count >= 3) { patch.status = "suspended"; patch.paymentMode = "mandatory_upi"; }
    else if (count >= 2) { patch.paymentMode = "mandatory_upi"; }
    DB.updateUser(userId, patch);
    DB.addAudit({
      type: "no-show",
      message: `No-show #${count} (30-day window) recorded for ${u.name}` +
        (patch.status === "suspended" ? " - account suspended" :
         patch.paymentMode === "mandatory_upi" ? " - UPI prepayment now mandatory" : ""),
    });
    return count;
  },
  /* Admin review: events waived for future counts but kept in history (FR23.3) */
  waiveAll(u) { return (u.noShowEvents || []).map(e => ({ ...e, waived: true })); },
  reinstate(userId) {
    const cur = DB.getUserById(userId);
    const u = DB.updateUser(userId, { status: "active", noShows: 0, paymentMode: "normal", noShowEvents: cur ? this.waiveAll(cur) : [] });
    if (u) DB.addAudit({ type: "reinstate", message: `${u.name} reinstated by admin (No-Shows waived)` });
    return u;
  },
  clearUpiRestriction(userId) {
    const cur = DB.getUserById(userId);
    const u = DB.updateUser(userId, { paymentMode: "normal", noShows: 0, noShowEvents: cur ? this.waiveAll(cur) : [] });
    if (u) DB.addAudit({ type: "upi-clear", message: `UPI-only restriction lifted for ${u.name}` });
    return u;
  },
};

/* ---------- Pending Due (FR22.1) + rapid-cancel block (FR20.4) ---------- */
const Dues = {
  add(userId, amount, orderToken) {
    const u = DB.getUserById(userId);
    if (!u || amount <= 0) return;
    DB.updateUser(userId, { pendingDue: (u.pendingDue || 0) + amount });
    DB.addAudit({ type: "pending-due", message: `Pending Due ${U.rupees(amount)} added to ${u.name} (${orderToken})` });
  },
  settle(userId) {
    const u = DB.getUserById(userId);
    if (!u || !u.pendingDue) return;
    DB.addTransaction({ id: "txn-" + Date.now(), orderId: null, token: "DUE", amount: u.pendingDue, type: "payment", note: "Pending Due settled" });
    DB.updateUser(userId, { pendingDue: 0 });
    DB.addAudit({ type: "pending-due", message: `Pending Due ${U.rupees(u.pendingDue)} settled by ${u.name}` });
  },
  /* Count Received-stage self-cancellations today; at the limit, block 24h */
  recordReceivedCancel(userId) {
    const u = DB.getUserById(userId);
    if (!u) return;
    const now = TimeUtil.now();
    const today = now.toDateString();
    const list = (u.cancelEvents || []).filter(t => new Date(t).toDateString() === today).concat([now.toISOString()]);
    const patch = { cancelEvents: list };
    if (list.length >= Policy.get().rapidCancelLimit) {
      patch.orderBlockUntil = new Date(now.getTime() + 86400000).toISOString();
      DB.addAudit({ type: "cancel-block", message: `${u.name} blocked from ordering for 24h (rapid cancellations)` });
    }
    DB.updateUser(userId, patch);
  },
};
