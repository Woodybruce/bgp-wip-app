import webpush from "web-push";
import { pool } from "./db";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:admin@brucegillinghampollard.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log("[push] Web Push configured");
} else {
  console.warn("[push] VAPID keys not set — push notifications disabled");
}

export async function saveSubscription(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );
}

export async function removeSubscription(endpoint: string) {
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

export async function removeSubscriptionForUser(endpoint: string, userId: string) {
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, userId]);
}

export async function sendPushNotification(userId: string, data: { title: string; body: string; tag?: string; url?: string }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const result = await pool.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId]
  );

  for (const row of result.rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };

    try {
      await webpush.sendNotification(subscription, JSON.stringify(data));
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [row.endpoint]);
      }
    }
  }
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}
