/* ============================================================
   SCOTS — notifications.js
   Type 2 in-site notification history + Type 1 Web Push bridge.
   The demo uses localStorage as its database; if a backend endpoint
   is configured, the same state changes are mirrored to it.
   ============================================================ */

const NOTIFICATION_TYPES = {
  NEW_APPEAL: "new_appeal",
  CANTEEN_ERROR: "canteen_error",
  ORDER_READY: "order_ready",
  TOKEN_EXPIRING: "token_expiring",
  ORDER_PLACED: "order_placed",
  ORDER_PREP: "order_prep",
  SYSTEM_ANNOUNCEMENT: "system_announcement",
  ORDER_COMPLETED: "order_completed",
  APPEAL_RESOLVED: "appeal_resolved",
  ORDER_CANCELLED: "order_cancelled",
  TOKEN_EXPIRED: "token_expired",
  APPEAL_REJECTED: "appeal_rejected",
};

const NOTIFICATION_MATRIX = {
  new_appeal: { recipient: "admin", category: "action", deep: "appeal", title: "New appeal received" },
  canteen_error: { recipient: "admin", category: "action", deep: "admin-error", title: "Canteen status / error" },
  order_ready: { recipient: "student", category: "time", deep: "order", title: "Order ready" },
  token_expiring: { recipient: "student", category: "time", deep: null, title: "Token expiring soon" },
  order_placed: { recipient: "student", category: "info", deep: "order", title: "Order placed" },
  order_prep: { recipient: "student", category: "info", deep: "order", title: "Order accepted / preparing" },
  system_announcement: { recipient: "student", category: "info", deep: null, title: "System announcement" },
  order_completed: { recipient: "student", category: "success", deep: "order", title: "Order completed" },
  appeal_resolved: { recipient: "student", category: "success", deep: null, title: "Appeal resolved" },
  order_cancelled: { recipient: "student", category: "closed", deep: "order", title: "Order cancelled" },
  token_expired: { recipient: "student", category: "closed", deep: null, title: "Token expired" },
  appeal_rejected: { recipient: "student", category: "closed", deep: null, title: "Appeal rejected" },
};

const NotificationEngine = {
  CHANNEL_NAME: "scots-notifications",
  SW_PATH: (document.body?.dataset.root || "") + "sw.js",
  _channel: null,
  _outsideBound: false,
  _lastRenderedHash: "",
  _sweepTimer: null,

  init() {
    const user = DB.getCurrentUser();
    if (!user || !["student", "admin"].includes(user.role)) return;
    this.ensureStore();
    this.registerServiceWorker();
    this.bindGlobalEvents();
    this.renderBell();
    this.updateSectionBadges();
    this.sweepTokenWarnings();
    clearInterval(this._sweepTimer);
    this._sweepTimer = setInterval(() => this.sweepTokenWarnings(), 5000);

    if ("BroadcastChannel" in window) {
      this._channel = new BroadcastChannel(this.CHANNEL_NAME);
      this._channel.onmessage = e => {
        if (e.data?.type === "notifications-changed") this.refresh();
      };
    }
  },

  ensureStore() {
    if (!Store.read(LS_KEYS.NOTIFICATIONS, null)) Store.write(LS_KEYS.NOTIFICATIONS, []);
  },

  currentUser() { return DB.getCurrentUser(); },

  all() { return DB.getNotifications(); },

  mine() {
    const u = this.currentUser();
    if (!u) return [];
    return this.all()
      .filter(n => n.recipientUserId === u.id || (!n.recipientUserId && n.recipientRole === u.role))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  unread() { return this.mine().filter(n => !n.readAt); },

  unreadCount() { return this.unread().length; },

  sectionCount(section) {
    const u = this.currentUser();
    if (!u) return 0;
    if (section === "orders" && u.role === "student") {
      return this.unread().filter(n => n.entityType === "order").length;
    }
    if (section === "appeals" && u.role === "admin") {
      return this.unread().filter(n => n.entityType === "appeal").length;
    }
    return 0;
  },

  makeId(type, entityId) {
    return `n-${type}-${entityId || "global"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },

  deepLink(type, entityId, meta) {
    const root = document.body?.dataset.root || "";
    const matrix = NOTIFICATION_MATRIX[type];
    if (!matrix?.deep) return null;

    // Build links from the actual document location instead of blindly
    // prefixing `admin/`. Admin pages already live inside /admin/, so a
    // stored `../admin/...` link can otherwise become /admin/admin/... when
    // the notification is opened from a dashboard or an older stored record.
    let relativePath = null;
    if (matrix.deep === "order") {
      relativePath = `${root}orders.html?o=${encodeURIComponent(entityId)}`;
    } else if (matrix.deep === "appeal") {
      relativePath = root === "../"
        ? `appeals.html?appeal=${encodeURIComponent(entityId)}`
        : `${root}admin/appeals.html?appeal=${encodeURIComponent(entityId)}`;
    } else if (matrix.deep === "admin-error") {
      relativePath = root === "../"
        ? `dashboard.html?error=${encodeURIComponent(meta?.errorId || "status")}`
        : `${root}admin/dashboard.html?error=${encodeURIComponent(meta?.errorId || "status")}`;
    }
    if (!relativePath) return null;

    try {
      // Absolute URLs are safe for both window.location and Service Worker
      // openWindow(), and also repair links persisted by older builds.
      return new URL(relativePath, document.baseURI).href;
    } catch (_) {
      return relativePath;
    }
  },

  normalizeDeepLink(target) {
    if (!target) return null;
    try {
      // Always canonicalize notification URLs before navigation. This also
      // repairs notifications persisted by older builds that accidentally
      // stored /admin/admin/... links.
      const url = new URL(target, window.location.href);
      const pathname = url.pathname.replace(/\/admin\/admin(?=\/|$)/g, "/admin");
      url.pathname = pathname;
      return url.href;
    } catch (_) {
      return String(target).replace(/\/admin\/admin(?=\/|$)/g, "/admin");
    }
  },

  resolvedDeepLink(n) {
    if (!n) return null;
    // Recalculate known deep-links at click time so notifications created by
    // previous routing implementations are repaired automatically. For
    // legacy records, canonicalize the stored URL as a final safety net.
    return this.normalizeDeepLink(this.deepLink(n.type, n.entityId, n.meta) || n.deepLink || null);
  },

  create({ type, recipientUserId = null, recipientRole = null, title, message, entityType = null, entityId = null, meta = {}, tag, deepLink, sourceEventKey = null }) {
    const matrix = NOTIFICATION_MATRIX[type];
    if (!matrix) return null;
    const now = TimeUtil.now().toISOString();
    const list = this.all();
    if (sourceEventKey && list.some(n => n.sourceEventKey === sourceEventKey && n.recipientUserId === recipientUserId)) return null;

    const n = {
      id: this.makeId(type, entityId),
      type,
      recipientUserId,
      recipientRole: recipientRole || matrix.recipient,
      category: matrix.category,
      actionRequired: matrix.category === "action",
      title: title || matrix.title,
      message: message || "",
      entityType,
      entityId,
      meta,
      deepLink: deepLink === undefined ? this.deepLink(type, entityId, meta) : deepLink,
      tag: tag || this.defaultTag(type, entityId),
      createdAt: now,
      readAt: null,
      sourceEventKey,
    };
    list.push(n);
    Store.write(LS_KEYS.NOTIFICATIONS, list);
    this.publishChange();
    this.mirror("create", n);
    this.showLocalPush(n);
    this.refresh();
    return n;
  },

  defaultTag(type, entityId) {
    if (type === NOTIFICATION_TYPES.NEW_APPEAL) return "new-appeals";
    if (entityId) return `${type}-${entityId}`;
    return type;
  },

  markRead(id, reason = "ui") {
    const u = this.currentUser();
    const list = this.all();
    const i = list.findIndex(n => n.id === id && (!u || n.recipientUserId === u.id || n.recipientRole === u.role));
    if (i < 0 || list[i].readAt) return false;
    list[i].readAt = TimeUtil.now().toISOString();
    list[i].readReason = reason;
    Store.write(LS_KEYS.NOTIFICATIONS, list);
    this.publishChange();
    this.mirror("mark-read", list[i]);
    const sameTagUnread = list.some(n => n.tag === list[i].tag && !n.readAt && (n.recipientUserId === u?.id || (!n.recipientUserId && n.recipientRole === u?.role)));
    this.messageServiceWorker({ type: sameTagUnread ? "refresh-notification" : "close-notification", notificationId: id, tag: list[i].tag });
    this.refresh();
    return true;
  },

  markByEntity(entityType, entityId, reason = "entity-action") {
    let changed = 0;
    this.mine().filter(n => n.entityType === entityType && n.entityId === entityId && !n.readAt).forEach(n => {
      if (this.markRead(n.id, reason)) changed++;
    });
    return changed;
  },

  markAllRead() {
    const u = this.currentUser();
    if (!u) return;
    const now = TimeUtil.now().toISOString();
    const list = this.all();
    let changed = 0;
    list.forEach(n => {
      if (!n.readAt && (n.recipientUserId === u.id || (!n.recipientUserId && n.recipientRole === u.role))) {
        n.readAt = now;
        n.readReason = "mark-all";
        changed++;
        this.mirror("mark-read", n);
      }
    });
    if (changed) {
      Store.write(LS_KEYS.NOTIFICATIONS, list);
      this.publishChange();
      this.messageServiceWorker({ type: "close-all-notifications" });
      this.refresh();
    }
  },

  clearAll() {
    const u = this.currentUser();
    if (!u) return;
    const kept = this.all().filter(n => !(n.recipientUserId === u.id || (!n.recipientUserId && n.recipientRole === u.role)));
    Store.write(LS_KEYS.NOTIFICATIONS, kept);
    this.publishChange();
    this.mirror("clear-all", { recipientUserId: u.id, recipientRole: u.role });
    this.messageServiceWorker({ type: "close-all-notifications" });
    this.refresh();
  },

  customerNavigateToOrder(orderId) {
    const u = this.currentUser();
    if (!u || u.role !== "student") return;
    const order = DB.getOrder(orderId);
    if (!order || order.userId !== u.id) return;
    // Customer navigation to a target order is considered an acknowledgement.
    this.markByEntity("order", orderId, "navigation");
  },

  renderBell() {
    const mount = document.getElementById("notification-bell");
    if (!mount) return;
    const count = this.unreadCount();
    mount.innerHTML = `
      <button class="notification-trigger" type="button" aria-label="Notifications${count ? `, ${count} unread` : ""}" aria-expanded="false" data-notification-toggle>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
        <span class="notification-label">Notifications</span>
        ${badgeHTML(count)}
      </button>
      <div class="notification-panel" data-notification-panel hidden></div>`;
    const toggle = mount.querySelector("[data-notification-toggle]");
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      const panel = mount.querySelector("[data-notification-panel]");
      const open = !panel.hidden;
      if (open) this.closePanel(); else this.openPanel();
    });
  },

  openPanel() {
    const mount = document.getElementById("notification-bell");
    if (!mount) return;
    const panel = mount.querySelector("[data-notification-panel]");
    const toggle = mount.querySelector("[data-notification-toggle]");
    this.renderPanel(panel);
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    mount.classList.add("notification-open");
  },

  closePanel() {
    const mount = document.getElementById("notification-bell");
    if (!mount) return;
    const panel = mount.querySelector("[data-notification-panel]");
    const toggle = mount.querySelector("[data-notification-toggle]");
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    mount.classList.remove("notification-open");
  },

  renderPanel(panel) {
    if (!panel) return;
    const notes = this.mine();
    const unread = notes.filter(n => !n.readAt).length;
    panel.innerHTML = `
      <div class="notification-head">
        <div><strong>Notifications</strong><span>${unread ? `${unread} unread` : "All caught up"}</span></div>
        <div class="notification-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-mark-all ${unread ? "" : "disabled"}>Mark all as read</button>
          <button type="button" class="btn btn-ghost btn-sm" data-clear-all ${notes.length ? "" : "disabled"}>Clear all</button>
        </div>
      </div>
      ${notes.length ? `<div class="notification-list">${notes.map(n => this.notificationHTML(n)).join("")}</div>` : emptyStateHTML("🔔", "No notifications", "New order, appeal and system updates will appear here.", "")}
      <div class="notification-foot"><button type="button" class="notification-permission" data-enable-push>Enable browser notifications</button></div>`;

    panel.querySelector("[data-mark-all]")?.addEventListener("click", e => { e.stopPropagation(); this.markAllRead(); });
    panel.querySelector("[data-clear-all]")?.addEventListener("click", async e => {
      e.stopPropagation();
      if (!notes.length) return;
      const ok = await confirmDialog("Clear notification history?", "This removes the notification history for this account. It does not change your orders or appeals.", "Clear all");
      if (ok) this.clearAll();
    });
    panel.querySelectorAll("[data-notification-id]").forEach(row => {
      row.addEventListener("click", e => {
        const button = e.target.closest("button");
        if (button) return;
        const n = notes.find(x => x.id === row.dataset.notificationId);
        if (!n) return;
        const target = this.resolvedDeepLink(n);
        if (target) {
          // Customer order navigation acknowledges the notification.
          // Admin appeal navigation intentionally does NOT: opening the
          // Appeals inbox is not the same as explicitly reading an appeal.
          if (n.entityType === "order" && this.currentUser()?.role === "student") {
            this.markRead(n.id, "deep-link");
          }
          location.href = target;
        } else if (!n.readAt) {
          this.markRead(n.id, "open");
        }
      });
    });
    panel.querySelectorAll("[data-mark-read]").forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      this.markRead(btn.dataset.markRead, "explicit");
    }));
    panel.querySelector("[data-enable-push]")?.addEventListener("click", e => { e.stopPropagation(); this.softAskPush(); });
  },

  notificationHTML(n) {
    const unreadClass = n.readAt ? "read" : "unread";
    const time = this.relativeTime(n.createdAt);
    const categoryLabel = { action: "Action required", time: "Time-sensitive", info: "Informational", success: "Success", closed: "Closed" }[n.category] || "Update";
    return `<article class="notification-item ${unreadClass}" data-notification-id="${U.esc(n.id)}" tabindex="0">
      <div class="notification-dot category-${n.category}" aria-hidden="true"></div>
      <div class="notification-content">
        <div class="notification-title-row"><strong>${U.esc(n.title)}</strong><span>${U.esc(categoryLabel)}</span></div>
        <p>${U.esc(n.message)}</p>
        <small>${U.esc(time)}</small>
        ${this.resolvedDeepLink(n) ? `<span class="notification-target">Open related ${n.entityType === "order" ? "order" : n.entityType === "appeal" ? "appeal" : "item"} →</span>` : ""}
      </div>
      ${!n.readAt ? `<button class="notification-mark-read" type="button" title="Mark as read" aria-label="Mark ${U.esc(n.title)} as read" data-mark-read="${U.esc(n.id)}">✓</button>` : `<span class="notification-read-state" title="Read">✓</span>`}
    </article>`;
  },

  relativeTime(iso) {
    const diff = Math.max(0, TimeUtil.now().getTime() - new Date(iso).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  },

  updateSectionBadges() {
    const orders = this.sectionCount("orders");
    const appeals = this.sectionCount("appeals");
    document.querySelectorAll("[data-notification-section='orders']").forEach(el => this.setBadge(el, orders));
    document.querySelectorAll("[data-notification-section='appeals']").forEach(el => this.setBadge(el, appeals));
  },

  setBadge(el, count) {
    const old = el.querySelector(".section-notification-badge");
    if (old) old.remove();
    if (count <= 0) return;
    el.insertAdjacentHTML("beforeend", badgeHTML(count, "section-notification-badge"));
  },

  refresh() {
    const mount = document.getElementById("notification-bell");
    const open = !!mount?.classList.contains("notification-open");
    if (mount) this.renderBell();
    this.updateSectionBadges();
    if (open) this.openPanel();
  },

  bindGlobalEvents() {
    if (this._outsideBound) return;
    this._outsideBound = true;
    document.addEventListener("click", e => {
      const mount = document.getElementById("notification-bell");
      if (mount && !mount.contains(e.target)) this.closePanel();
    });
    window.addEventListener("storage", e => {
      if (e.key === LS_KEYS.NOTIFICATIONS) this.refresh();
    });
    window.addEventListener("focus", () => this.refresh());
    navigator.serviceWorker?.addEventListener("message", e => {
      const data = e.data || {};
      if (data.type === "push-mark-read" && data.notificationId) this.markRead(data.notificationId, "push-action");
      if (data.type === "push-open") {
        if (data.notificationId) this.markRead(data.notificationId, "push-open");
      }
      if (data.type === "push-navigate" && data.deepLink) {
        location.href = this.normalizeDeepLink(data.deepLink);
      }
    });
  },

  async registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register(this.SW_PATH, { scope: document.body?.dataset.root || "./" });
      this._swRegistration = reg;
    } catch (err) {
      console.warn("SCOTS Service Worker registration failed", err);
    }
  },

  async softAskPush() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast("Browser notifications are not supported here.", "warn");
      return;
    }
    const current = Notification.permission;
    if (current === "granted") {
      toast("Browser notifications are already enabled.", "success");
      return;
    }
    if (current === "denied") {
      toast("Browser notifications are blocked by the browser settings.", "warn");
      return;
    }
    const overlay = openModal(`
      <h3>Stay updated with SCOTS</h3>
      <p class="modal-sub">Get important order and account updates even when the SCOTS tab is in the background. You can turn this off in your browser settings anytime.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-modal-close>Not now</button><button class="btn btn-primary" data-enable-now>Yes, enable</button></div>`);
    overlay.querySelector("[data-enable-now]").onclick = async () => {
      closeModal();
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { toast("Browser notifications were not enabled.", "warn"); return; }
      await this.subscribePush();
      toast("Browser notifications enabled", "success");
    };
  },

  async subscribePush() {
    try {
      const reg = this._swRegistration || await navigator.serviceWorker.ready;
      if (!reg.pushManager) return null;
      // Production: set a real VAPID public key in SCOTS_PUSH_VAPID_PUBLIC_KEY.
      const key = window.SCOTS_PUSH_VAPID_PUBLIC_KEY;
      if (!key) {
        console.info("SCOTS push permission granted. Add SCOTS_PUSH_VAPID_PUBLIC_KEY to create a real push subscription.");
        return null;
      }
      const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.urlBase64ToUint8Array(key) });
      await this.mirror("push-subscription", { subscription: subscription.toJSON(), userId: this.currentUser()?.id });
      return subscription;
    } catch (err) {
      console.warn("SCOTS push subscription failed", err);
      return null;
    }
  },

  urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  },

  messageServiceWorker(message) {
    if (!navigator.serviceWorker?.controller) return;
    navigator.serviceWorker.controller.postMessage(message);
  },

  async showLocalPush(n) {
    // Only show a local OS notification for the currently authenticated recipient.
    const u = this.currentUser();
    if (!u || (n.recipientUserId && n.recipientUserId !== u.id) || (!n.recipientUserId && n.recipientRole !== u.role)) return;
    // Only demonstrate an OS-level notification when permission is already granted.
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const reg = this._swRegistration || await navigator.serviceWorker.ready;
      const collapsedCount = n.tag === "new-appeals" ? this.mine().filter(x => !x.readAt && x.tag === n.tag).length : 1;
      const displayTitle = n.tag === "new-appeals" && collapsedCount > 1 ? `${collapsedCount} New Appeals` : n.title;
      const displayBody = n.tag === "new-appeals" && collapsedCount > 1 ? "Multiple customer appeals are waiting in the Appeals inbox." : n.message;
      reg.showNotification(displayTitle, {
        body: displayBody,
        icon: (document.body?.dataset.root || "") + "assets/icons/push-icon.svg",
        tag: n.tag,
        renotify: false,
        data: { notificationId: n.id, deepLink: this.resolvedDeepLink(n), tag: n.tag, apiBase: DB.getSettings().notificationApiBase || window.SCOTS_NOTIFICATION_API_BASE || null },
        actions: [
          { action: "mark-read", title: "Mark as read" },
          { action: "open", title: n.deepLink ? "Open" : "Focus" },
        ],
      });
    } catch (err) {
      console.warn("SCOTS local push display failed", err);
    }
  },

  publishChange() {
    try { this._channel?.postMessage({ type: "notifications-changed" }); } catch (_) {}
    window.dispatchEvent(new CustomEvent("scots:notifications-changed"));
  },

  async mirror(action, payload) {
    const settings = DB.getSettings();
    const endpoint = settings.notificationApiBase || window.SCOTS_NOTIFICATION_API_BASE || '/api';
    if (!endpoint) return;
    try {
      await fetch(endpoint.replace(/\/$/, "") + "/notifications/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (err) {
      console.warn("SCOTS notification backend sync failed", err);
    }
  },

  handleOrderCreated(order) {
    this.create({
      type: NOTIFICATION_TYPES.ORDER_PLACED,
      recipientUserId: order.userId,
      entityType: "order",
      entityId: order.id,
      title: "Order placed",
      message: `${order.token} has been placed successfully. Your order is now in the canteen queue.`,
      sourceEventKey: `order:${order.id}:placed`,
      tag: `order-${order.id}`,
    });
  },

  handleOrderChange(previous, order) {
    if (!previous || !order || previous.status === order.status) return;
    // Canteen Staff/Admin status changes are authoritative server events. Do not
    // create a fake local customer notification on the operator device; send
    // the change to the shared backend, which creates the notification for
    // the actual customer and broadcasts it to their device.
    const currentUser = this.currentUser();
    console.log('[SCOTS][handleOrderChange] operator check', {
      role: currentUser?.role,
      orderId: order?.id,
      previousStatus: previous?.status,
      orderStatus: order?.status,
      orderRemote: order?.remote,
    });
    if (['staff', 'admin'].includes(currentUser?.role) && !order.remote) {
      if (window.Realtime?.orderStatusChanged) {
        window.Realtime.orderStatusChanged(previous, order);
      } else {
        console.error('[SCOTS][handleOrderChange] Realtime.orderStatusChanged is unavailable');
      }
      return;
    }
    const map = {
      preparing: [NOTIFICATION_TYPES.ORDER_PREP, "Your order has been accepted and is being prepared."],
      ready: [NOTIFICATION_TYPES.ORDER_READY, "Your food is ready for pickup. Please collect it before the token expires."],
      collected: [NOTIFICATION_TYPES.ORDER_COMPLETED, "Your order has been collected successfully."],
      completed: [NOTIFICATION_TYPES.ORDER_COMPLETED, "Your order is complete. Thanks for using SCOTS."],
      cancelled: [NOTIFICATION_TYPES.ORDER_CANCELLED, "Your order was cancelled."],
      expired: [NOTIFICATION_TYPES.TOKEN_EXPIRED, "Your pickup token has expired because the order was not collected in time."],
    };
    const entry = map[order.status];
    if (!entry) return;
    this.create({
      type: entry[0], recipientUserId: order.userId, entityType: "order", entityId: order.id,
      title: NOTIFICATION_MATRIX[entry[0]].title, message: `${order.token}: ${entry[1]}`,
      sourceEventKey: `order:${order.id}:status:${order.status}`,
      tag: `order-${order.id}`,
    });
  },

  handleAppealCreated(appeal) {
    if (this.currentUser()?.role === 'student') window.Realtime?.appealCreated(appeal);
    const admins = DB.getUsers().filter(u => u.role === "admin");
    admins.forEach(admin => this.create({
      type: NOTIFICATION_TYPES.NEW_APPEAL,
      recipientUserId: admin.id,
      entityType: "appeal", entityId: appeal.id,
      title: "New appeal received",
      message: `${appeal.userName} submitted a ${appeal.type || "general"} appeal. Review it in the Appeals inbox.`,
      sourceEventKey: `appeal:${appeal.id}:new:${admin.id}`,
      tag: "new-appeals",
    }));
  },

  handleAppealChange(previous, appeal) {
    if (!previous || !appeal || previous.status === appeal.status) return;
    if (this.currentUser()?.role === 'admin') window.Realtime?.appealStatusChanged(appeal);
    if (["resolved", "rejected"].includes(appeal.status)) {
      this.markByEntity("appeal", appeal.id, "admin-action");
      if (appeal.userId) {
        const type = appeal.status === "resolved" ? NOTIFICATION_TYPES.APPEAL_RESOLVED : NOTIFICATION_TYPES.APPEAL_REJECTED;
        this.create({
          type, recipientUserId: appeal.userId, entityType: "appeal", entityId: appeal.id,
          title: NOTIFICATION_MATRIX[type].title,
          message: appeal.resolution ? `Your appeal was resolved: ${appeal.resolution}.` : "Your appeal has been updated by the canteen admin.",
          sourceEventKey: `appeal:${appeal.id}:${appeal.status}:${appeal.userId}`,
        });
      }
    }
  },

  createSystemAnnouncement(message, title = "System announcement") {
    DB.getUsers().filter(u => u.role === "student").forEach(u => this.create({
      type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT, recipientUserId: u.id,
      title, message, sourceEventKey: `announcement:${Date.now()}:${u.id}`,
    }));
  },

  createCanteenError(message, errorId = "status") {
    DB.getUsers().filter(u => u.role === "admin").forEach(u => this.create({
      type: NOTIFICATION_TYPES.CANTEEN_ERROR, recipientUserId: u.id,
      entityType: "system", entityId: errorId,
      title: "Canteen status / error", message,
      meta: { errorId }, sourceEventKey: `canteen-error:${errorId}:${Date.now()}`,
    }));
  },

  sweepTokenWarnings() {
    const user = this.currentUser();
    if (!user || user.role !== "student") return;
    const windowMs = readyExpiryMinutes() * 60000;
    const warningMs = Math.min(5 * 60000, Math.max(30000, windowMs * 0.25));
    DB.getOrders().filter(o => o.userId === user.id && o.status === "ready" && o.readyAt).forEach(o => {
      const left = windowMs - (TimeUtil.now().getTime() - new Date(o.readyAt).getTime());
      if (left > 0 && left <= warningMs) {
        this.create({
          type: NOTIFICATION_TYPES.TOKEN_EXPIRING, recipientUserId: user.id,
          entityType: "order", entityId: o.id,
          title: "Token expiring soon", message: `${o.token} expires in about ${Math.max(1, Math.ceil(left / 60000))} minute(s). Please collect your food.`,
          deepLink: null, tag: `token-expiring-${o.id}`,
          sourceEventKey: `order:${o.id}:token-warning:${o.readyAt}`,
        });
      }
    });
  },
};

function badgeHTML(count, extraClass = "") {
  if (!count) return "";
  const label = count > 99 ? "99+" : String(count);
  return `<span class="section-notification-badge ${extraClass}" aria-label="${count} unread">${label}</span>`;
}

// Bridge storage-layer events without requiring the storage file to know about UI code.
window.addEventListener("scots:order-created", e => NotificationEngine.handleOrderCreated(e.detail));
window.addEventListener("scots:order-changed", e => NotificationEngine.handleOrderChange(e.detail.previous, e.detail.order));
window.addEventListener("scots:appeal-created", e => NotificationEngine.handleAppealCreated(e.detail));
window.addEventListener("scots:appeal-changed", e => NotificationEngine.handleAppealChange(e.detail.previous, e.detail.appeal));
