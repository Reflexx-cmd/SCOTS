/*
 * SCOTS Web Push backend reference.
 *
 * This project is currently a browser/localStorage demo, so this file is
 * intentionally an integration example rather than a running server.
 * In production, keep notification records and push subscriptions in the
 * server database and use the authenticated user as the source of truth.
 *
 * Install: npm i web-push express
 * Configure: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */

const webpush = require("web-push");
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

function pushOptions(notification) {
  const timeSensitive = ["order_ready", "token_expiring"].includes(notification.type);
  return {
    TTL: timeSensitive ? 120 : 86400,
    urgency: timeSensitive ? "high" : "normal",
  };
}

async function sendScotsPush(subscription, notification) {
  const payload = JSON.stringify({
    notificationId: notification.id,
    title: notification.title,
    body: notification.message,
    tag: notification.tag,
    actionRequired: notification.actionRequired,
    deepLink: notification.deepLink,
    data: notification.meta || {},
    apiBase: process.env.NOTIFICATION_API_BASE || null,
  });
  return webpush.sendNotification(subscription, payload, pushOptions(notification));
}

module.exports = { sendScotsPush, pushOptions };
