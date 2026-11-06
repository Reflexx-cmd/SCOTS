/* ============================================================
   SCOTS — storage.js
   Central localStorage state layer. Every read/write to
   localStorage goes through here (no scattered raw calls).
   ============================================================ */

const LS_KEYS = {
  USERS: "scots_users",
  CURRENT: "scots_current_user",
  MENU: "scots_menu",
  ORDERS: "scots_orders",
  CART: "scots_cart",
  SLOTS: "scots_slots",
  TXN: "scots_transactions",
  AUDIT: "scots_audit_log",
  APPEALS: "scots_appeals",
  SETTINGS: "scots_settings",
  NOTIFICATIONS: "scots_notifications",
};

const Store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn("SCOTS storage read failed for", key, err);
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn("SCOTS storage write failed for", key, err);
    }
  },
  remove(key) { localStorage.removeItem(key); },
};

/* ---------- Time utilities (supports simulated demo time) ---------- */
const TimeUtil = {
  OPEN_MIN: 9 * 60,        // 09:00
  CLOSE_MIN: 18 * 60,      // 18:00

  now() {
    const s = DB.getSettings();
    if (s.simulate && s.simulate.enabled && typeof s.simulate.minutes === "number") {
      // The server stores an anchor timestamp when the simulated time is applied.
      // Advancing from that anchor keeps every connected device on the same clock
      // instead of freezing the display at the selected time.
      const anchorMs = s.simulate.anchorAt ? new Date(s.simulate.anchorAt).getTime() : Date.now();
      const safeAnchorMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();
      const elapsedMinutes = Math.max(0, Math.floor((Date.now() - safeAnchorMs) / 60000));
      const totalMinutes = ((Number(s.simulate.minutes) + elapsedMinutes) % (24 * 60) + (24 * 60)) % (24 * 60);
      const d = new Date();
      d.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
      return d;
    }
    return new Date();
  },
  minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); },
  nowMinutes() { return this.minutesOfDay(this.now()); },
  isOpen() {
    const m = this.nowMinutes();
    return m >= this.OPEN_MIN && m < this.CLOSE_MIN;
  },
  nextOpeningLabel() {
    const m = this.nowMinutes();
    if (m < this.OPEN_MIN) return "today at 09:00 AM";
    return "tomorrow at 09:00 AM";
  },
  minsToLabel(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ap}`;
  },
  clockLabel(d) {
    return this.minsToLabel(d.getHours() * 60 + d.getMinutes());
  },
  isoToLabel(iso) {
    const d = new Date(iso);
    return this.minsToLabel(d.getHours() * 60 + d.getMinutes());
  },
  dateLabel(d) {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  },
};

/* ---------- Formatting helpers ---------- */
const U = {
  rupees(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); },
  esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },
};

/* ---------- Database-style accessors ---------- */
const DB = {
  getUsers() { return Store.read(LS_KEYS.USERS, []); },
  saveUsers(u) { Store.write(LS_KEYS.USERS, u); },
  getUserById(id) { return this.getUsers().find(u => u.id === id) || null; },
  updateUser(id, patch) {
    const users = this.getUsers();
    const i = users.findIndex(u => u.id === id);
    if (i >= 0) { users[i] = { ...users[i], ...patch }; this.saveUsers(users); }
    return i >= 0 ? users[i] : null;
  },

  getCurrentUser() {
    const id = Store.read(LS_KEYS.CURRENT, null);
    if (!id) return null;
    return this.getUserById(id);
  },
  setCurrentUser(id) { Store.write(LS_KEYS.CURRENT, id); },
  clearCurrentUser() { Store.remove(LS_KEYS.CURRENT); },

  getMenu() { return Store.read(LS_KEYS.MENU, []); },
  saveMenu(m) { Store.write(LS_KEYS.MENU, m); },
  getMenuItem(id) { return this.getMenu().find(m => m.id === id) || null; },

  getOrders() { return Store.read(LS_KEYS.ORDERS, []); },
  saveOrders(o) { Store.write(LS_KEYS.ORDERS, o); },
  getOrder(id) { return this.getOrders().find(o => o.id === id) || null; },
  updateOrder(id, patch) {
    const orders = this.getOrders();
    const i = orders.findIndex(o => o.id === id);
    if (i >= 0) {
      const previous = { ...orders[i] };
      orders[i] = { ...orders[i], ...patch };
      this.saveOrders(orders);
      window.dispatchEvent(new CustomEvent("scots:order-changed", { detail: { previous, order: orders[i] } }));
    }
    return i >= 0 ? orders[i] : null;
  },
  addOrder(order) {
    const orders = this.getOrders();
    orders.push(order);
    this.saveOrders(orders);
    window.dispatchEvent(new CustomEvent("scots:order-created", { detail: order }));
    return order;
  },

  getCart() { return Store.read(LS_KEYS.CART, []); },
  saveCart(c) { Store.write(LS_KEYS.CART, c); },

  getSlots() { return Store.read(LS_KEYS.SLOTS, []); },
  saveSlots(s) { Store.write(LS_KEYS.SLOTS, s); },

  getTransactions() { return Store.read(LS_KEYS.TXN, []); },
  addTransaction(t) {
    const txns = this.getTransactions();
    txns.push(t);
    Store.write(LS_KEYS.TXN, txns);
    return t;
  },

  getAudit() { return Store.read(LS_KEYS.AUDIT, []); },
  addAudit(entry) {
    const log = this.getAudit();
    const a = this.getCurrentUser();
    log.push({ at: TimeUtil.now().toISOString(), actor: a ? `${a.name} (${a.role})` : "system", ...entry });
    Store.write(LS_KEYS.AUDIT, log);
  },

  getAppeals() { return Store.read(LS_KEYS.APPEALS, []); },
  addAppeal(a) {
    const list = this.getAppeals();
    list.push(a);
    Store.write(LS_KEYS.APPEALS, list);
    window.dispatchEvent(new CustomEvent("scots:appeal-created", { detail: a }));
    return a;
  },
  updateAppeal(id, patch) {
    const oldList = this.getAppeals();
    const previous = oldList.find(a => a.id === id) || null;
    const list = oldList.map(a => a.id === id ? { ...a, ...patch } : a);
    Store.write(LS_KEYS.APPEALS, list);
    const appeal = list.find(a => a.id === id) || null;
    if (appeal) window.dispatchEvent(new CustomEvent("scots:appeal-changed", { detail: { previous, appeal } }));
    return appeal;
  },

  getNotifications() { return Store.read(LS_KEYS.NOTIFICATIONS, []); },
  saveNotifications(n) { Store.write(LS_KEYS.NOTIFICATIONS, n); },

  getSettings() {
    return Store.read(LS_KEYS.SETTINGS, {
      demoMode: false,
      serviceFee: 5,
      tokenCounter: 103,
      simulate: { enabled: true, minutes: 12 * 60 + 30 },
    });
  },
  saveSettings(s) { Store.write(LS_KEYS.SETTINGS, s); },

  nextToken() {
    const s = this.getSettings();
    s.tokenCounter = (s.tokenCounter || 103) + 1;
    this.saveSettings(s);
    return "SCOTS-" + s.tokenCounter;
  },
};

/* ---------- Policy settings (SRS v2.3 Appendix B.5, FR24) ---------- */
const POLICY_DEFAULTS = {
  cooks: 2, windowLen: 15, scheduledShare: 2 / 3, maxSlack: 15, delayGrace: 15,
  prepLimit: 12, minLeadMin: 30, noShowForfeitPct: 100, lateCancelPct: 100,
  autoExpiryMin: 20, lookbackDays: 30, pendingDueDays: 3, rapidCancelLimit: 2, etaTolerance: 2,
};
const Policy = {
  get() { return { ...POLICY_DEFAULTS, ...(DB.getSettings().policy || {}) }; },
  set(patch) { const s = DB.getSettings(); s.policy = { ...this.get(), ...patch }; DB.saveSettings(s); },
  /* Scheduled capacity per window = N x W x s  (B.1) -> 2 x 15 x 2/3 = 20 */
  schedCapacity() { const p = this.get(); return Math.round(p.cooks * p.windowLen * p.scheduledShare); },
};

/* Ready-expiry window: policy value (default 20 min), 1 min in DEMO_MODE */
function readyExpiryMinutes() {
  return DB.getSettings().demoMode ? 1 : Policy.get().autoExpiryMin;
}

/* One-time migration to SRS v2.3 capacity (30 -> 20 prep-min per window) */
(function migrateV23() {
  try {
    if (localStorage.getItem("scots_srs_v23")) return;
    const slots = DB.getSlots();
    if (slots.length) DB.saveSlots(slots.map(s => s.capacity === 30 ? { ...s, capacity: Policy.schedCapacity() } : s));
    localStorage.setItem("scots_srs_v23", "1");
  } catch (e) { /* ignore */ }
})();
