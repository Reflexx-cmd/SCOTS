/* SCOTS shared cross-device realtime bridge. Uses SSE for instant updates and
   the same-origin API so the exact frontend can run locally or when hosted. */
const Realtime = {
  base() { return (window.SCOTS_NOTIFICATION_API_BASE || '/api').replace(/\/$/, ''); },
  user() { return typeof DB !== 'undefined' ? DB.getCurrentUser() : null; },
  role() { return this.user()?.role || 'student'; },
  async init() {
    const u = this.user();
    await this.pullSettings();
    await this.pullQueueStatus();
    if (!u) return;
    try {
      const cfg = await fetch(this.base() + '/config', { credentials:'same-origin' }).then(r => r.json());
      if (cfg.vapidPublicKey) window.SCOTS_PUSH_VAPID_PUBLIC_KEY = cfg.vapidPublicKey;
    } catch (_) {}
    this.connect(u.id);
    await this.syncNotificationReads(u.id);
    await this.pull(u.id);
    await this.pullAppeals(u.id, u.role);
  },
  connect(userId) {
    if (!window.EventSource) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connectionGeneration = (this.connectionGeneration || 0) + 1;
    const generation = this.connectionGeneration;

    if (this.es) {
      this.es.close();
      this.es = null;
    }

    const es = new EventSource(this.base() + '/stream?userId=' + encodeURIComponent(userId));
    this.es = es;
    es.onmessage = e => { try { this.handle(JSON.parse(e.data)); } catch (_) {} };
    es.onerror = () => {
      // Ignore stale EventSource callbacks from a connection that was already
      // replaced. Otherwise an old connection can close the current one and
      // schedule duplicate reconnect timers.
      if (this.es !== es || generation !== this.connectionGeneration) return;

      es.close();
      this.es = null;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        if (generation === this.connectionGeneration) this.connect(userId);
      }, 3000);
    };
  },
  async pullSettings() {
    try {
      const settings = await fetch(this.base() + '/settings', { credentials:'same-origin' }).then(r => { if (!r.ok) throw new Error(`Settings fetch failed (${r.status})`); return r.json(); });
      if (settings && typeof DB !== 'undefined') {
        const local = DB.getSettings();
        DB.saveSettings({ ...local, ...settings, simulate: { ...(local.simulate || {}), ...(settings.simulate || {}) } });
        window.dispatchEvent(new CustomEvent('scots:settings-changed', { detail: DB.getSettings() }));
      }
      return settings;
    } catch (err) { console.warn('SCOTS shared settings pull failed; using local cache.', err); return null; }
  },

  async pullQueueStatus() {
    try {
      const status = await fetch(this.base() + '/queue-status', { credentials:'same-origin' }).then(r => {
        if (!r.ok) throw new Error(`Queue status fetch failed (${r.status})`);
        return r.json();
      });
      if (status && typeof Store !== 'undefined') Store.write('scots_queue_status', status);
      window.dispatchEvent(new CustomEvent('scots:queue-changed', { detail: status }));
      return status;
    } catch (err) {
      const fallback = typeof Store !== 'undefined' ? Store.read('scots_queue_status', { activeCount: 0, waitMinutes: 0 }) : { activeCount: 0, waitMinutes: 0 };
      window.dispatchEvent(new CustomEvent('scots:queue-changed', { detail: fallback }));
      return fallback;
    }
  },
  async updateSettings(patch) {
    try {
      const res = await fetch(this.base() + '/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch), credentials:'same-origin' });
      if (!res.ok) throw new Error(`Settings update failed (${res.status})`);
      const data = await res.json();
      if (data.settings && typeof DB !== 'undefined') DB.saveSettings(data.settings);
      return data.settings || null;
    } catch (err) { console.error('SCOTS settings update failed', err); return null; }
  },

  async syncNotificationReads(userId) {
    try {
      const local = typeof DB !== 'undefined' ? DB.getNotifications().filter(n => n.recipientUserId === userId && n.readAt) : [];
      await Promise.all(local.map(n => fetch(this.base() + '/notifications/mark-read', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify({ notificationId:n.id, userId, reason:n.readReason || 'sync' }), keepalive:true }).catch(() => null)));
    } catch (_) {}
  },

  async pullAppeals(userId, role) {
    try {
      const qs = new URLSearchParams({ userId, role });
      const list = await fetch(this.base() + '/appeals?' + qs.toString(), { credentials:'same-origin' }).then(r => { if (!r.ok) throw new Error(`Appeals fetch failed (${r.status})`); return r.json(); });
      if (Array.isArray(list) && typeof DB !== 'undefined') {
        const existing = new Map(DB.getAppeals().map(a => [a.id, a]));
        list.forEach(a => existing.set(a.id, a));
        const merged = [...existing.values()].sort((a,b)=>new Date(b.at || 0)-new Date(a.at || 0));
        Store.write(LS_KEYS.APPEALS, merged);
        window.dispatchEvent(new CustomEvent('scots:appeals-synced', { detail:{ appeals:list, role } }));
      }
      return list;
    } catch (err) { console.warn('SCOTS shared appeals pull failed; using local cache.', err); return []; }
  },

  async pull(userId) {
    try { const list = await fetch(this.base() + '/notifications?userId=' + encodeURIComponent(userId), {credentials:'same-origin'}).then(r => { if (!r.ok) throw new Error(`Notifications fetch failed (${r.status})`); return r.json(); }); this.mergeNotifications(list, true); } catch (_) {}
  },
  async pullOrders(userId = this.user()?.id, role = this.role()) {
    if (!userId) return [];
    try {
      const qs = new URLSearchParams({ userId, role });
      const list = await fetch(this.base() + '/orders?' + qs.toString(), { credentials:'same-origin' })
        .then(r => { if (!r.ok) throw new Error(`Orders fetch failed (${r.status})`); return r.json(); });
      if (Array.isArray(list)) {
        if (role === 'staff' || role === 'admin') DB.saveOrders(list);
        else {
          const mine = new Map(DB.getOrders().map(o => [o.id, o]));
          list.forEach(o => mine.set(o.id, o));
          DB.saveOrders([...mine.values()]);
        }
        window.dispatchEvent(new CustomEvent('scots:orders-synced', { detail: { orders: list, role } }));
      }
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn('SCOTS shared order pull failed; using local cache.', err);
      return [];
    }
  },
  mergeNotifications(list, replaceMine = false) {
    if (!Array.isArray(list) || typeof Store === 'undefined') return;
    const u = this.user();
    const local = DB.getNotifications();
    const byId = new Map(local.map(n => [n.id, n]));
    if (replaceMine && u?.id) {
      const mineServerIds = new Set(list.filter(n => n.recipientUserId === u.id).map(n => n.id));
      local.filter(n => n.recipientUserId === u.id && !mineServerIds.has(n.id)).forEach(n => byId.delete(n.id));
    }
    list.forEach(n => byId.set(n.id, { ...(byId.get(n.id) || {}), ...n }));
    DB.saveNotifications([...byId.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
    window.dispatchEvent(new CustomEvent('scots:notifications-changed'));
    if (typeof NotificationEngine !== 'undefined') NotificationEngine.refresh();
  },
  handle(data) {
    if (data.type === 'queue-changed' && data.queue) {
      if (typeof Store !== 'undefined') Store.write('scots_queue_status', data.queue);
      window.dispatchEvent(new CustomEvent('scots:queue-changed', { detail: data.queue }));
    }
    if (data.queue && (data.type === 'order-created' || data.type === 'order-changed')) {
      if (typeof Store !== 'undefined') Store.write('scots_queue_status', data.queue);
      window.dispatchEvent(new CustomEvent('scots:queue-changed', { detail: data.queue }));
    }
    if (data.type === 'notification' && data.notification) {
      const notification = data.notification;
      const exists = DB.getNotifications().some(n => n.id === notification.id);
      this.mergeNotifications([notification]);

      // Order-status notifications are the canonical customer-facing status
      // update path. The server includes the authoritative order snapshot in
      // notification.meta.order, so the customer's local cache and UI can
      // update from the same Type 2 notification event without inventing a
      // second ad-hoc realtime mechanism.
      const u = this.user();
      const notifiedOrder = notification.entityType === 'order' ? notification.meta?.order : null;
      if (u?.id === notification.recipientUserId && notifiedOrder?.id) {
        const previous = DB.getOrder(notifiedOrder.id) || null;
        DB.saveOrders(DB.getOrders().filter(o => o.id !== notifiedOrder.id).concat([notifiedOrder]));
        window.dispatchEvent(new CustomEvent('scots:order-changed', {
          detail: { previous, order: notifiedOrder, remote: true, viaNotification: true }
        }));
      }

      if (!exists && typeof NotificationEngine !== 'undefined') NotificationEngine.showLocalPush(notification);
    }
    if (data.type === 'notification-updated' && data.notification) this.mergeNotifications([data.notification]);
    if (data.type === 'settings-changed' && data.settings) {
      const local = DB.getSettings();
      DB.saveSettings({ ...local, ...data.settings, simulate: { ...(local.simulate || {}), ...(data.settings.simulate || {}) } });
      window.dispatchEvent(new CustomEvent('scots:settings-changed', { detail: DB.getSettings() }));
    }
    if (data.type === 'appeal-created' && data.appeal) {
      const list = DB.getAppeals();
      if (!list.some(a => a.id === data.appeal.id)) Store.write(LS_KEYS.APPEALS, [...list, data.appeal]);
      window.dispatchEvent(new CustomEvent('scots:appeals-synced', { detail:{ appeal:data.appeal, remote:true } }));
      if (this.user()?.role === 'admin') this.pullAppeals(this.user().id, 'admin');
    }
    if (data.type === 'appeal-changed' && data.appeal) {
      const list = DB.getAppeals();
      Store.write(LS_KEYS.APPEALS, list.map(a => a.id === data.appeal.id ? data.appeal : a));
      window.dispatchEvent(new CustomEvent('scots:appeals-synced', { detail:{ appeal:data.appeal, remote:true } }));
    }
    if (data.type === 'notifications-cleared') { const u=this.user(); if(u){ DB.saveNotifications(DB.getNotifications().filter(n=>n.recipientUserId!==u.id)); if(typeof NotificationEngine!=='undefined') NotificationEngine.refresh(); } }
    if ((data.type === 'order-created' || data.type === 'order-changed') && data.order) {
      const u = this.user();
      const operational = ['staff', 'admin'].includes(u?.role);
      if (this.publicDisplay || operational || data.order.userId === u?.id) {
        const orders = DB.getOrders();
        DB.saveOrders(orders.filter(o => o.id !== data.order.id).concat([data.order]));
        window.dispatchEvent(new CustomEvent(data.type === 'order-created' ? 'scots:order-created-remote' : 'scots:order-changed', {
          detail: { previous: data.previous || null, order: data.order, remote: true }
        }));
      }
    }
  },
  startPublicDisplay() {
    this.publicDisplay = true;
    this.connect('public-display');
    this.pullOrders('public-display', 'staff');
    this.pullQueueStatus();
  },

  async orderStatusChanged(previous, order) {
    const url = this.base() + '/order-status';
    console.log('[SCOTS][orderStatusChanged] sending', {
      url,
      previousStatus: previous?.status,
      orderId: order?.id,
      orderUserId: order?.userId,
      orderStatus: order?.status,
      orderRemote: order?.remote,
    });
    try {
      const res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({previous,order}),
        keepalive:true
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`order-status request failed (${res.status})${text ? `: ${text}` : ''}`);
      }
      console.log('[SCOTS][orderStatusChanged] server accepted update', {
        status: res.status,
        orderId: order?.id,
      });
    } catch (err) {
      console.error('[SCOTS][orderStatusChanged] request failed', err, {
        url,
        orderId: order?.id,
        orderUserId: order?.userId,
        previousStatus: previous?.status,
        orderStatus: order?.status,
      });
    }
  },
  async appealCreated(appeal) {
    try { const admins=DB.getUsers().filter(u=>u.role==='admin').map(u=>u.id); await fetch(this.base()+'/appeal-created',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appeal,adminIds:admins}),keepalive:true}); } catch (_) {}
  },
  async appealStatusChanged(appeal) {
    try { await fetch(this.base()+'/appeal-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appeal}),keepalive:true}); } catch (_) {}
  }
};

// Expose the shared realtime bridge globally. notifications.js and other
// classic (non-module) scripts access it through window.Realtime.
window.Realtime = Realtime;

document.addEventListener('DOMContentLoaded',()=>Realtime.init());
