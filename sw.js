/* ============================================================
   SCOTS Service Worker — Type 1 Web Push
   Handles push display, collapsing tags, actions and client sync.
   Backend controls TTL/urgency when sending the Web Push message.
   ============================================================ */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: "SCOTS", body: event.data?.text?.() || "You have a new notification." };
  }

  const title = data.title || "SCOTS notification";
  const options = {
    body: data.body || data.message || "You have a new SCOTS update.",
    icon: data.icon || "assets/icons/scots-logo.png",
    badge: data.badge || "assets/icons/scots-logo.png",
    tag: data.tag || data.notificationId || "scots-notification",
    renotify: false,
    requireInteraction: !!data.actionRequired,
    data: {
      notificationId: data.notificationId || data.id || null,
      deepLink: normalizeDeepLink(data.deepLink || null),
      tag: data.tag || null,
      apiBase: data.apiBase || null,
    },
    actions: [
      { action: "mark-read", title: "Mark as read" },
      { action: "open", title: data.deepLink ? "Open" : "Focus" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});


function normalizeDeepLink(target) {
  if (!target) return null;
  try {
    const url = new URL(target, self.registration.scope);
    url.pathname = url.pathname.replace(/\/admin\/admin(?=\/|$)/g, "/admin");
    return url.href;
  } catch (_) {
    return String(target).replace(/\/admin\/admin(?=\/|$)/g, "/admin");
  }
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach(client => client.postMessage(message));
  return clients;
}

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action || "open";

  event.waitUntil((async () => {
    const clients = await notifyClients({
      type: action === "mark-read" ? "push-mark-read" : "push-open",
      notificationId: data.notificationId,
      tag: data.tag,
      deepLink: data.deepLink,
    });

    if (action === "mark-read") {
      // Prefer the authenticated open tab. If no tab is available, the server
      // endpoint embedded in the push payload can acknowledge the notification.
      if (clients.length) return;
      if (data.apiBase && data.notificationId) {
        await fetch(data.apiBase.replace(/\/$/, "") + "/notifications/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId: data.notificationId }),
          credentials: "include",
        }).catch(() => {});
      }
      return;
    }

    let target = normalizeDeepLink(data.deepLink) || self.registration.scope;
    for (const client of clients) {
      if ("focus" in client) {
        await client.focus();
        if (target) client.postMessage({ type: "push-navigate", deepLink: target });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "close-notification" && data.tag) {
    event.waitUntil(self.registration.getNotifications({ tag: data.tag }).then(notifications => {
      notifications.forEach(n => {
        if (!data.notificationId || n.data?.notificationId === data.notificationId) n.close();
      });
    }));
  }
  if (data.type === "refresh-notification" && data.tag) {
    event.waitUntil(self.registration.getNotifications({ tag: data.tag }).then(notifications => {
      // A collapsed notification cannot be partially edited reliably by the SW.
      // Close the old instance; the next backend/client event will re-show the latest aggregate.
      notifications.forEach(n => n.close());
    }));
  }
  if (data.type === "close-all-notifications") {
    event.waitUntil(self.registration.getNotifications().then(notifications => notifications.forEach(n => n.close())));
  }
});
