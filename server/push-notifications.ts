import webpush from "web-push";
import { pool } from "./db";

// Normalise VAPID keys: the web-push library requires URL-safe base64 WITHOUT
// padding ("=" or "+" or "/"). Handle common paste mistakes silently.
function normaliseVapidKey(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/=+$/, "")    // strip padding
    .replace(/\+/g, "-")   // base64 → base64url
    .replace(/\//g, "_");
}

const VAPID_PUBLIC_KEY = normaliseVapidKey(process.env.VAPID_PUBLIC_KEY || "");
const VAPID_PRIVATE_KEY = normaliseVapidKey(process.env.VAPID_PRIVATE_KEY || "");

let pushReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      "mailto:admin@brucegillinghampollard.com",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    pushReady = true;
    console.log("[push] Web Push configured");
  } catch (err: any) {
    // Never let a bad VAPID key kill the server — push is optional.
    console.warn("[push] VAPID key rejected — push notifications disabled:", err?.message);
  }
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

export interface PushSendResult {
  configured: boolean;
  subscriptions: number;
  sent: number;
  failed: Array<{ host: string; statusCode: number | null; message: string }>;
}

// Every outcome is logged — deliveries used to fail silently, which made
// "are notifications working?" unanswerable from the Railway logs.
export async function sendPushNotification(userId: string, data: { title: string; body: string; tag?: string; url?: string }): Promise<PushSendResult> {
  if (!pushReady) {
    return { configured: false, subscriptions: 0, sent: 0, failed: [] };
  }

  const result = await pool.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId]
  );
  const out: PushSendResult = { configured: true, subscriptions: result.rows.length, sent: 0, failed: [] };

  for (const row of result.rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    let host = "unknown";
    try { host = new URL(row.endpoint).host; } catch {}

    try {
      await webpush.sendNotification(subscription, JSON.stringify(data), { TTL: 60 * 60 * 24 });
      out.sent++;
      console.log(`[push] sent "${data.title}" → ${host} (user ${userId})`);
    } catch (err: any) {
      const statusCode = typeof err?.statusCode === "number" ? err.statusCode : null;
      const message = String(err?.body || err?.message || err).slice(0, 200);
      out.failed.push({ host, statusCode, message });
      console.warn(`[push] FAILED → ${host} (user ${userId}) status=${statusCode ?? "n/a"}: ${message}`);
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or the user removed the app — forget it.
        await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [row.endpoint]);
      }
    }
  }
  return out;
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}
