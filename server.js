/* SCOTS production/demo server
 * - Serves the frontend
 * - Persists shared orders/notifications in server/data.json
 * - Sends realtime events over Server-Sent Events (SSE)
 * - Sends Web Push when web-push is installed/configured
 *
 * Start: npm install && npm start
 * Local: http://127.0.0.1:8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

let webpush = null;
try { webpush = require('web-push'); } catch (_) { /* optional until npm install */ }

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const clients = new Map(); // userId -> Set(res)

const TYPES = {
  order_ready: { category: 'time', title: 'Order ready', deep: 'order' },
  order_prep: { category: 'info', title: 'Order accepted / preparing', deep: 'order' },
  order_completed: { category: 'success', title: 'Order completed', deep: 'order' },
  order_cancelled: { category: 'closed', title: 'Order cancelled', deep: 'order' },
  token_expired: { category: 'closed', title: 'Token expired', deep: null },
  new_appeal: { category: 'action', title: 'New appeal received', deep: 'appeal' },
  appeal_resolved: { category: 'success', title: 'Appeal resolved', deep: null },
  appeal_rejected: { category: 'closed', title: 'Appeal rejected', deep: null },
  canteen_error: { category: 'action', title: 'Canteen status / error', deep: 'admin-error' },
  system_announcement: { category: 'info', title: 'System announcement', deep: null },
};

function defaultData() {
  return { notifications: [], orders: [], appeals: [], subscriptions: {}, vapid: null, settings: { simulate: { enabled: true, minutes: 750, anchorAt: new Date().toISOString() } } };
}
function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2));
  try {
    const loaded = { ...defaultData(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
    if (!loaded.settings || !loaded.settings.simulate) loaded.settings = { ...defaultData().settings, ...(loaded.settings || {}) };
    if (typeof loaded.settings.simulate.minutes !== 'number') loaded.settings.simulate.minutes = 750;
    if (typeof loaded.settings.simulate.enabled !== 'boolean') loaded.settings.simulate.enabled = true;
    if (!loaded.settings.simulate.anchorAt) loaded.settings.simulate.anchorAt = new Date().toISOString();
    return loaded;
  } catch (_) { return defaultData(); }
}
let db = loadData();
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

function ensureVapid() {
  if (!webpush) return null;
  if (db.vapid?.publicKey && db.vapid?.privateKey) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:canteen@example.com', db.vapid.publicKey, db.vapid.privateKey);
    return db.vapid;
  }
  const keys = webpush.generateVAPIDKeys();
  db.vapid = keys;
  save();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:canteen@example.com', keys.publicKey, keys.privateKey);
  return keys;
}
const vapid = ensureVapid();

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function send(res, status, body, type='application/json; charset=utf-8', headers={}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function json(res, status, body) { send(res, status, body); }
function body(req) {
  return new Promise((resolve, reject) => {
    let raw=''; req.on('data', c => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function now() { return new Date().toISOString(); }
function id(prefix='n') { return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }
function matrixLink(type, entityId, meta={}) {
  if (type === 'order_ready' || type === 'order_prep' || type === 'order_completed' || type === 'order_cancelled') return `/orders.html?o=${encodeURIComponent(entityId)}`;
  if (type === 'new_appeal') return `/admin/appeals.html?appeal=${encodeURIComponent(entityId)}`;
  if (type === 'canteen_error') return `/admin/dashboard.html?error=${encodeURIComponent(meta.errorId || 'status')}`;
  return null;
}
function createNotification({type, recipientUserId, title, message, entityType, entityId, meta={}, sourceEventKey, tag, notificationId=null}) {
  const m = TYPES[type]; if (!m || !recipientUserId) return null;
  if (sourceEventKey && db.notifications.some(n => n.sourceEventKey === sourceEventKey && n.recipientUserId === recipientUserId)) return db.notifications.find(n => n.sourceEventKey === sourceEventKey && n.recipientUserId === recipientUserId);
  const n = {
    id: notificationId || id('n'), type, recipientUserId, recipientRole: type.startsWith('order_') || type.startsWith('token_') || type.startsWith('appeal_') ? 'student' : (type === 'new_appeal' || type === 'canteen_error' ? 'admin' : null),
    category: m.category, actionRequired: m.category === 'action', title: title || m.title, message: message || '', entityType: entityType || null, entityId: entityId || null,
    meta, deepLink: matrixLink(type, entityId, meta), tag: tag || (type === 'new_appeal' ? 'new-appeals' : `${type}-${entityId || 'global'}`), createdAt: now(), readAt: null, sourceEventKey: sourceEventKey || null,
  };
  db.notifications.push(n); save(); broadcast(recipientUserId, { type: 'notification', notification: n }); sendPush(recipientUserId, n); return n;
}
function broadcast(userId, payload) {
  const set = clients.get(String(userId)); if (!set) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) { try { res.write(msg); } catch (_) {} }
}
function broadcastAll(payload) {
  for (const userId of clients.keys()) broadcast(userId, payload);
}
function getQueueStatus() {
  const activeStatuses = new Set(['received', 'preparing']);
  const active = (db.orders || []).filter(o => activeStatuses.has(o.status));
  const totalPrepMinutes = active.reduce((sum, o) => sum + Number(o.prepMinutes || 0), 0);
  return { activeCount: active.length, waitMinutes: totalPrepMinutes, updatedAt: now() };
}
async function sendPush(userId, n) {
  if (!webpush || !db.subscriptions[userId]) return;
  const payload = JSON.stringify({ title: n.title, body: n.message, tag: n.tag, icon: '/assets/icons/scots-logo.png', badge: '/assets/icons/scots-logo.png', data: { notificationId: n.id, deepLink: n.deepLink, tag: n.tag, apiBase: '/api' } });
  const actions = [{ action: 'mark-read', title: 'Mark as read' }, { action: n.deepLink ? 'open' : 'focus', title: n.deepLink ? 'Open' : 'Focus' }];
  for (const sub of db.subscriptions[userId]) {
    try { await webpush.sendNotification(sub, payload, n.category === 'time' ? { TTL: 120 } : { TTL: 3600 }); }
    catch (e) {
      if ([404, 410].includes(e.statusCode)) db.subscriptions[userId] = db.subscriptions[userId].filter(x => x.endpoint !== sub.endpoint);
    }
  }
  save();
}
function orderNotification(previous, order) {
  if (!previous || !order || previous.status === order.status) return null;
  const map = {
    preparing: ['order_prep', 'Your order has been accepted and is being prepared.'],
    ready: ['order_ready', 'Your food is ready for pickup. Please collect it before the token expires.'],
    collected: ['order_completed', 'Your order has been collected successfully.'],
    completed: ['order_completed', 'Your order is complete. Thanks for using SCOTS.'],
    cancelled: ['order_cancelled', 'Your order was cancelled.'],
    expired: ['token_expired', 'Your pickup token has expired because the order was not collected in time.'],
  };
  const entry = map[order.status]; if (!entry || !order.userId) return null;
  return createNotification({ type: entry[0], recipientUserId: order.userId, entityType: 'order', entityId: order.id,
    title: TYPES[entry[0]].title, message: `${order.token}: ${entry[1]}`,
    meta: { orderId: order.id, status: order.status, order },
    sourceEventKey: `order:${order.id}:status:${order.status}`, tag: `order-${order.id}` });
}

async function api(req, res, url) {
  if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { pushEnabled: !!webpush, vapidPublicKey: vapid?.publicKey || null });
  if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'SCOTS', time: now(), pushEnabled: !!webpush });
  if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, db.settings || defaultData().settings);
  if (url.pathname === '/api/queue-status' && req.method === 'GET') return json(res, 200, getQueueStatus());

  if (url.pathname === '/api/settings' && req.method === 'POST') {
    const b = await body(req);
    db.settings = { ...(db.settings || defaultData().settings), ...b, simulate: { ...(db.settings?.simulate || defaultData().settings.simulate), ...(b.simulate || {}) } };
    db.settings.simulate.minutes = Math.max(0, Math.min(1439, Number(db.settings.simulate.minutes) || 750));
    db.settings.simulate.enabled = !!db.settings.simulate.enabled;
    if (db.settings.simulate.enabled) {
      // Start the shared simulated clock from the server's current timestamp.
      // All connected clients derive the same advancing clock from this anchor.
      db.settings.simulate.anchorAt = new Date().toISOString();
    } else {
      db.settings.simulate.anchorAt = null;
    }
    save();
    broadcastAll({ type: 'settings-changed', settings: db.settings });
    return json(res, 200, { ok: true, settings: db.settings });
  }

  if (url.pathname === '/api/stream' && req.method === 'GET') {
    const userId = url.searchParams.get('userId'); if (!userId) return json(res, 400, { error: 'userId required' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    const key = String(userId);
    if (!clients.has(key)) clients.set(key, new Set());
    const set = clients.get(key);
    set.add(res);

    let heartbeat = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) clients.delete(key);
    };

    heartbeat = setInterval(() => {
      try {
        if (res.destroyed || res.writableEnded) return cleanup();
        res.write(': ping\n\n');
      } catch (_) {
        cleanup();
      }
    }, 20000);

    // `res` is the authoritative lifecycle for the SSE stream. Keep the
    // request close/abort hooks as a compatibility fallback and make cleanup
    // idempotent so a connection can never remain in `clients` after close.
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return;
  }

  if (url.pathname === '/api/notifications' && req.method === 'GET') {
    const userId = url.searchParams.get('userId');
    return json(res, 200, db.notifications.filter(n => n.recipientUserId === userId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
  }

  // Shared order source of truth. Customers only see their own orders;
  // canteen staff/admin can request the full queue (optionally filtered).
  if (url.pathname === '/api/orders' && req.method === 'GET') {
    const userId = url.searchParams.get('userId');
    const role = url.searchParams.get('role') || 'student';
    const status = url.searchParams.get('status');
    let orders = Array.isArray(db.orders) ? db.orders.slice() : [];
    if (!['staff', 'admin'].includes(role)) {
      if (!userId) return json(res, 400, { error: 'userId required for customer orders' });
      orders = orders.filter(o => o.userId === userId);
    }
    if (status) orders = orders.filter(o => o.status === status);
    orders.sort((a,b) => new Date(b.placedAt || 0) - new Date(a.placedAt || 0));
    console.log('[DIAGNOSTIC][GET /api/orders] requested userId=%s role=%s', userId, role);
    orders.forEach(o => {
      console.log('[DIAGNOSTIC][GET /api/orders] returned id=%s userId=%s status=%s', o.id, o.userId, o.status);
    });
    return json(res, 200, orders);
  }

  if (url.pathname === '/api/orders' && req.method === 'POST') {
    const order = await body(req);
    if (!order || !order.id || !order.userId || !order.status) {
      return json(res, 400, { error: 'id, userId and status are required' });
    }
    if (!Array.isArray(order.items)) order.items = [];

    const existing = db.orders.find(o => o.id === order.id);
    if (existing) return json(res, 200, { ok: true, order: existing, duplicate: true });

    db.orders.push(order);
    save();
    // Notify every connected operational dashboard. Each client filters
    // the event according to its role/user before updating its cache.
    broadcastAll({ type: 'order-created', order, queue: getQueueStatus() });
    return json(res, 201, { ok: true, order });
  }
  if (url.pathname === '/api/appeals' && req.method === 'GET') {
    const userId = url.searchParams.get('userId');
    const role = url.searchParams.get('role') || 'student';
    let appeals = Array.isArray(db.appeals) ? db.appeals.slice() : [];
    if (role !== 'admin') appeals = appeals.filter(a => a.userId === userId);
    appeals.sort((a,b) => new Date(b.at || 0) - new Date(a.at || 0));
    return json(res, 200, appeals);
  }

  if (url.pathname === '/api/appeals' && req.method === 'POST') {
    const b = await body(req);
    const appeal = { ...(b.appeal || b) };
    const adminIds = Array.isArray(b.adminIds) ? b.adminIds.filter(Boolean) : [];
    delete appeal.adminIds;
    if (!appeal?.id || !appeal.userId) return json(res, 400, { error: 'id and userId are required' });
    const existing = db.appeals.find(a => a.id === appeal.id);
    if (existing) return json(res, 200, { ok: true, appeal: existing, duplicate: true });
    db.appeals.push(appeal);
    save();
    broadcastAll({ type: 'appeal-created', appeal });
    const targets = adminIds.length ? adminIds : ((process.env.SCOTS_ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
    for (const adminId of targets) createNotification({ type: 'new_appeal', recipientUserId: adminId, entityType: 'appeal', entityId: appeal.id, message: `${appeal.userName} submitted a ${appeal.type || 'general'} appeal. Review it in the Appeals inbox.`, sourceEventKey: `appeal:${appeal.id}:new:${adminId}`, tag: 'new-appeals' });
    return json(res, 201, { ok: true, appeal });
  }

  if (url.pathname === '/api/notifications/create' && req.method === 'POST') {
    const n = await body(req);
    if (!n.recipientUserId || !n.type) return json(res,400,{error:'recipientUserId and type required'});
    const created = createNotification({ type:n.type, recipientUserId:n.recipientUserId, title:n.title, message:n.message, entityType:n.entityType, entityId:n.entityId, meta:n.meta||{}, sourceEventKey:n.sourceEventKey, tag:n.tag, notificationId:n.id });
    return json(res,200,{ok:true,notification:created});
  }
  if (url.pathname === '/api/notifications/mark-read' && req.method === 'POST') {
    const b = await body(req); const n = db.notifications.find(x => x.id === b.notificationId && x.recipientUserId === b.userId);
    if (n && !n.readAt) { n.readAt = now(); n.readReason = b.reason || 'ui'; save(); broadcast(b.userId, { type:'notification-updated', notification:n }); }
    return json(res, 200, { ok:true, notification:n || null });
  }
  if (url.pathname === '/api/notifications/clear-all' && req.method === 'POST') {
    const b = await body(req); db.notifications = db.notifications.filter(n => n.recipientUserId !== b.userId); save(); broadcast(b.userId, { type:'notifications-cleared' }); return json(res, 200, {ok:true});
  }
  if (url.pathname === '/api/notifications/push-subscription' && req.method === 'POST') {
    const b = await body(req); if (!b.userId || !b.subscription) return json(res,400,{error:'userId and subscription required'});
    db.subscriptions[b.userId] = db.subscriptions[b.userId] || [];
    db.subscriptions[b.userId] = db.subscriptions[b.userId].filter(x => x.endpoint !== b.subscription.endpoint); db.subscriptions[b.userId].push(b.subscription); save(); return json(res,200,{ok:true});
  }
  if (url.pathname === '/api/order-status' && req.method === 'POST') {
    const b = await body(req);
    if (!b.order || !b.order.id || !b.previous) return json(res, 400, { error: 'order and previous are required' });
    const current = db.orders.find(o => o.id === b.order.id);
    console.log('[DIAGNOSTIC][POST /api/order-status] incoming id=%s userId=%s current=%s', b.order.id, b.order.userId, current ? JSON.stringify(current) : 'null');
    // Keep the server authoritative while still accepting a first sync from
    // an older local cache that is not present in server-data yet. Merge the
    // incoming patch over the server copy so server-owned fields (userId,
    // token, items, etc.) are not accidentally lost.
    const previous = current ? { ...current } : { ...b.previous };
    const updated = current ? { ...current, ...b.order } : { ...b.order };
    db.orders = db.orders.filter(o => o.id !== b.order.id);
    db.orders.push(updated);
    console.log('[DIAGNOSTIC][POST /api/order-status] final id=%s userId=%s status=%s', updated.id, updated.userId, updated.status);
    save();
    const n = orderNotification(previous, updated);
    broadcastAll({ type: 'order-changed', previous, order: updated, queue: getQueueStatus() });
    return json(res, 200, { ok: true, order: updated, notification: n });
  }
  if (url.pathname === '/api/appeal-created' && req.method === 'POST') {
    const b = await body(req);
    if (!b.appeal?.id || !b.appeal?.userId) return json(res, 400, { error: 'appeal with id and userId required' });
    if (!db.appeals.some(a => a.id === b.appeal.id)) db.appeals.push(b.appeal);
    save();
    broadcastAll({ type: 'appeal-created', appeal: b.appeal });
    const admins = b.adminIds || ['u-admin'];
    for (const adminId of admins) createNotification({ type:'new_appeal', recipientUserId:adminId, entityType:'appeal',entityId:b.appeal.id,message:`${b.appeal.userName} submitted a ${b.appeal.type || 'general'} appeal. Review it in the Appeals inbox.`,sourceEventKey:`appeal:${b.appeal.id}:new:${adminId}`,tag:'new-appeals'});
    return json(res,200,{ok:true, appeal:b.appeal});
  }
  if (url.pathname === '/api/appeal-status' && req.method === 'POST') {
    const b = await body(req); if (!b.appeal) return json(res,400,{error:'appeal required'});
    const i = db.appeals.findIndex(a => a.id === b.appeal.id);
    if (i >= 0) db.appeals[i] = { ...db.appeals[i], ...b.appeal }; else db.appeals.push(b.appeal);
    save();
    broadcastAll({ type:'appeal-changed', previous:null, appeal:db.appeals.find(a => a.id === b.appeal.id) });
    if (['resolved','rejected'].includes(b.appeal.status) && b.appeal.userId) createNotification({type:b.appeal.status === 'resolved' ? 'appeal_resolved' : 'appeal_rejected',recipientUserId:b.appeal.userId,entityType:'appeal',entityId:b.appeal.id,message:b.appeal.resolution ? `Your appeal was resolved: ${b.appeal.resolution}.` : 'Your appeal has been updated by the canteen admin.',sourceEventKey:`appeal:${b.appeal.id}:${b.appeal.status}:${b.appeal.userId}`});
    return json(res,200,{ok:true, appeal:db.appeals.find(a => a.id === b.appeal.id)});
  }
  return false;
}

function serveStatic(req,res,url) {
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/admin\/admin\/appeals\.html$/i.test(pathname)) { res.writeHead(302,{Location:'/admin/appeals.html'+(url.search||'')}); return res.end(); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(path.resolve(ROOT))) return send(res,403,'Forbidden','text/plain');
  fs.stat(file,(err,st)=>{
    if (!err && st.isFile()) return send(res,200,fs.readFileSync(file),mime[path.extname(file).toLowerCase()]||'application/octet-stream',{'Cache-Control': pathname.endsWith('.html')||pathname.endsWith('.js')?'no-cache':'public, max-age=86400'});
    return send(res,404,'Not Found','text/plain; charset=utf-8');
  });
}

const server = http.createServer(async (req,res)=>{
  try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) { const handled = await api(req,res,url); if (handled !== false) return; } serveStatic(req,res,url); }
  catch (e) { console.error(e); if (!res.headersSent) json(res,500,{error:'Server error'}); }
});
server.listen(PORT,HOST,()=>console.log(`SCOTS server running at http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`));
