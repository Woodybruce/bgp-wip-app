// Revolut Business integration — live card-transaction feed + virtual
// card management. Slot-in replacement for the Stripe Issuing webhook
// flow we used to run: every Revolut card transaction lands as a
// `pending_receipt` expense row, then receipts that come in via
// WhatsApp / the dashboard match by amount + date and post to Xero.
//
// Setup (one-time, done by an admin):
//   1. In the Revolut Business app → APIs → create an API certificate.
//      Generate an RSA keypair locally:
//        openssl genrsa -out revolut-private.pem 2048
//        openssl rsa -in revolut-private.pem -pubout -out revolut-public.pem
//      Upload `revolut-public.pem` to Revolut. They'll show you a
//      Client ID + an OAuth authorise URL.
//   2. Set env vars on Railway:
//        REVOLUT_CLIENT_ID=<from Revolut>
//        REVOLUT_JWT_PRIVATE_KEY=<contents of revolut-private.pem, newlines escaped or literal>
//        REVOLUT_JWT_ISSUER=<your public domain, eg bgp.app>
//        REVOLUT_ENV=sandbox | production
//        REVOLUT_WEBHOOK_SECRET=<set when you register the webhook>
//   3. Open the OAuth authorise URL Revolut gave you; on consent you'll
//      be redirected to your callback with `?code=...`. POST that code
//      to /api/revolut/bootstrap once to exchange it for a refresh
//      token. We persist the refresh token in `system_settings`; from
//      then on the integration auto-rotates access tokens itself.
//   4. POST /api/revolut/webhook/register once to subscribe to
//      TransactionCreated / TransactionStateChanged events pointing at
//      /api/revolut/webhook on this host.
//
// After that:
//   - Card swipe → Revolut fires the webhook → we create the expense.
//   - WhatsApp receipt arrives → existing match-to-pending code in
//     expense-receipt-handler.ts links it by amount + date.
//   - Falls back to createExpenseFromReceipt for cash / personal-card
//     spending where no Revolut transaction exists.

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { db, pool } from "./db";
import { stripeCardholders, stripeCards, expenses, systemSettings, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin, requireAuth } from "./auth";

// ─── Config + token storage ──────────────────────────────────────────────

interface RevolutConfig {
  clientId: string;
  privateKeyPem: string;
  issuer: string;
  env: "sandbox" | "production";
  webhookSecret: string | null;
}

function getConfig(): RevolutConfig | null {
  const clientId = process.env.REVOLUT_CLIENT_ID?.trim();
  const privateKey = process.env.REVOLUT_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const issuer = process.env.REVOLUT_JWT_ISSUER?.trim();
  const env = (process.env.REVOLUT_ENV?.trim() === "production" ? "production" : "sandbox") as "sandbox" | "production";
  if (!clientId || !privateKey || !issuer) return null;
  return {
    clientId,
    privateKeyPem: privateKey,
    issuer,
    env,
    webhookSecret: process.env.REVOLUT_WEBHOOK_SECRET?.trim() || null,
  };
}

// Most Business API resources live under /api/1.0 (accounts, transactions,
// cards, auth/token). Webhooks were migrated to /api/2.0 — the old
// /api/1.0/webhooks path now 404s — so callers pass version "2.0" for those.
function baseUrl(env: "sandbox" | "production", version: "1.0" | "2.0" = "1.0"): string {
  const host = env === "production" ? "https://b2b.revolut.com" : "https://sandbox-b2b.revolut.com";
  return `${host}/api/${version}`;
}

const SETTINGS_KEYS = {
  refreshToken: "revolut.refresh_token",
  accessTokenBundle: "revolut.access_token",
} as const;

async function readSetting<T = any>(key: string): Promise<T | null> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return (row?.value as T) ?? null;
}

async function writeSetting(key: string, value: any): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

// ─── JWT client assertion (RS256) ────────────────────────────────────────

function signClientAssertion(cfg: RevolutConfig): string {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: cfg.issuer,
    sub: cfg.clientId,
    aud: "https://revolut.com",
    iat: now,
    exp: now + 3600,
  };
  const b64u = (obj: any) =>
    Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = `${b64u(header)}.${b64u(payload)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(cfg.privateKeyPem).toString("base64")
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${signingInput}.${signature}`;
}

// ─── Token acquisition + auto-refresh ────────────────────────────────────

interface AccessTokenBundle {
  token: string;
  expiresAt: number;     // epoch ms
}

async function getAccessToken(cfg: RevolutConfig): Promise<string> {
  // Reuse cached token if it has more than 60s left.
  const cached = await readSetting<AccessTokenBundle>(SETTINGS_KEYS.accessTokenBundle);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = await readSetting<string>(SETTINGS_KEYS.refreshToken);
  if (!refreshToken) {
    throw new Error("Revolut not bootstrapped: no refresh_token. Run POST /api/revolut/bootstrap with the OAuth code first.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: signClientAssertion(cfg),
  });
  const res = await fetch(`${baseUrl(cfg.env)}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Revolut token refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
  const bundle: AccessTokenBundle = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,    // 30s safety margin
  };
  await writeSetting(SETTINGS_KEYS.accessTokenBundle, bundle);
  // Revolut may rotate the refresh token on each refresh — persist if so.
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await writeSetting(SETTINGS_KEYS.refreshToken, data.refresh_token);
  }
  return bundle.token;
}

// ─── Thin API client ─────────────────────────────────────────────────────

async function api<T = any>(path: string, init: RequestInit = {}, version: "1.0" | "2.0" = "1.0"): Promise<T> {
  const cfg = getConfig();
  if (!cfg) throw new Error("Revolut config missing — set REVOLUT_CLIENT_ID, REVOLUT_JWT_PRIVATE_KEY, REVOLUT_JWT_ISSUER.");
  const token = await getAccessToken(cfg);
  const res = await fetch(`${baseUrl(cfg.env, version)}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Revolut ${init.method || "GET"} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

// ─── Bootstrap: exchange auth code for refresh token ────────────────────

async function exchangeCodeForToken(code: string): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const cfg = getConfig();
  if (!cfg) throw new Error("Revolut config missing");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: signClientAssertion(cfg),
  });
  const res = await fetch(`${baseUrl(cfg.env)}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Revolut code exchange failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  if (!data.refresh_token) throw new Error("Revolut response missing refresh_token");
  await writeSetting(SETTINGS_KEYS.refreshToken, data.refresh_token);
  await writeSetting(SETTINGS_KEYS.accessTokenBundle, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  } satisfies AccessTokenBundle);
  return { refreshToken: data.refresh_token, accessToken: data.access_token, expiresIn: data.expires_in };
}

// ─── Webhook signature verification ──────────────────────────────────────

// Revolut Business signs webhooks as `Revolut-Signature: v1=<hex>` (one or
// more signatures, comma-separated). The signed payload is
// `<Revolut-Request-Timestamp>.<raw body>`, HMAC-SHA256 with the webhook
// secret. We accept signatures dated within 5 minutes of now to block
// replay attacks.
function verifyWebhookSignature(req: Request, cfg: RevolutConfig): boolean {
  if (!cfg.webhookSecret) {
    console.warn("[revolut webhook verify] FAIL: REVOLUT_WEBHOOK_SECRET unset");
    return false;
  }
  const signatureHeader = req.headers["revolut-signature"];
  const timestamp = req.headers["revolut-request-timestamp"];
  if (typeof signatureHeader !== "string") {
    console.warn(`[revolut webhook verify] FAIL: revolut-signature header missing (got ${typeof signatureHeader})`);
    return false;
  }
  if (typeof timestamp !== "string") {
    console.warn(`[revolut webhook verify] FAIL: revolut-request-timestamp header missing (got ${typeof timestamp})`);
    return false;
  }

  const tsNum = Number(timestamp);
  if (!isFinite(tsNum)) {
    console.warn(`[revolut webhook verify] FAIL: timestamp not a number: "${timestamp}"`);
    return false;
  }
  if (Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) {
    const driftSec = Math.round((Date.now() - tsNum) / 1000);
    console.warn(`[revolut webhook verify] FAIL: timestamp drift ${driftSec}s (>5min). Server clock or stale delivery?`);
    return false;
  }

  const rawBuf = (req as any).rawBody;
  const rawBodySource = Buffer.isBuffer(rawBuf) ? "buffer" : (typeof rawBuf === "string" ? "string" : "FALLBACK_JSON_STRINGIFY");
  if (rawBodySource === "FALLBACK_JSON_STRINGIFY") {
    console.warn(`[revolut webhook verify] WARN: rawBody not captured — HMAC may differ from what Revolut signed`);
  }
  const rawBody: string = Buffer.isBuffer(rawBuf) ? rawBuf.toString("utf8") : (typeof rawBuf === "string" ? rawBuf : JSON.stringify(req.body || {}));
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", cfg.webhookSecret).update(signedPayload).digest("hex");

  // Header is "v1=<sig>" or "v1=<sig>,v1=<sig>". Accept if any matches.
  const sigs = signatureHeader.split(",").map(s => s.trim().split("=", 2)).filter(parts => parts[0] === "v1").map(parts => parts[1]);
  if (sigs.length === 0) {
    console.warn(`[revolut webhook verify] FAIL: no v1= entries in revolut-signature header: "${signatureHeader.slice(0, 60)}"`);
    return false;
  }
  const matched = sigs.some(sig => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!matched) {
    // HMAC mismatch — the only remaining cause is the secret itself.
    // Log the *expected prefix* + *received prefix* so you can spot a
    // copy-paste typo without exposing the full secret in logs.
    console.warn(`[revolut webhook verify] FAIL: HMAC mismatch. Secret length=${cfg.webhookSecret.length} bodySource=${rawBodySource} bodyLen=${rawBody.length} tsDelta=${Math.round((Date.now() - tsNum) / 1000)}s gotSigPrefix=${sigs[0]?.slice(0, 12)}... expectedPrefix=${expected.slice(0, 12)}...`);
    console.warn(`[revolut webhook verify]   → fix: copy the signing secret from Revolut dashboard > webhooks again and paste into REVOLUT_WEBHOOK_SECRET in Railway (watch for trailing whitespace).`);
  }
  return matched;
}

// ─── Transaction → expense row ───────────────────────────────────────────

interface RevolutTransaction {
  id: string;
  type: string;                  // "card_payment", "transfer", "atm", ...
  state: string;                 // "pending", "completed", "declined", "reverted", "failed"
  created_at: string;
  updated_at?: string;
  completed_at?: string;
  amount?: number;               // major units, signed (negative for outflow)
  currency?: string;
  reference?: string;
  merchant?: { name?: string; city?: string; category_code?: string; country?: string };
  card?: { id?: string; card_number?: string };
  legs?: Array<{ amount: number; currency: string; description?: string; counterparty?: any }>;
}

async function upsertExpenseFromTransaction(txn: RevolutTransaction): Promise<{ id: string; created: boolean } | null> {
  // Only card spend creates an expense. Inbound transfers / FX / payouts
  // are ignored — they're not expenses.
  if (txn.type !== "card_payment" && txn.type !== "atm") return null;
  if (txn.state === "declined" || txn.state === "failed") return null;

  // Amount in pence. Revolut returns major units signed; we store
  // absolute value in pence (the existing schema is amount_pence with no
  // sign — direction is implicit from `type`).
  let amount = txn.amount;
  let currency = txn.currency;
  if ((amount === undefined || currency === undefined) && Array.isArray(txn.legs) && txn.legs[0]) {
    amount = txn.legs[0].amount;
    currency = txn.legs[0].currency;
  }
  if (amount === undefined || !currency) return null;
  const amountPence = Math.round(Math.abs(amount) * 100);

  // Resolve cardholder — look up by Revolut card id mapped onto
  // stripe_cardholders.revolut_card_id (added via auto-migrate below).
  let cardholderId: string | null = null;
  if (txn.card?.id) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM stripe_cardholders WHERE revolut_card_id = $1 LIMIT 1`,
      [txn.card.id],
    );
    if (rows[0]) cardholderId = rows[0].id;

    // Self-heal: a brand-new card's first payment won't be mapped yet. Rather
    // than orphan the expense, auto-assign cards to BGP users by matching the
    // Revolut cardholder's email to users.email, then re-resolve. Idempotent
    // and best-effort — if it can't match, the expense is created unowned as
    // before.
    if (!cardholderId) {
      try {
        await autoAssignRevolutCards();
        const retry = await pool.query<{ id: string }>(
          `SELECT id FROM stripe_cardholders WHERE revolut_card_id = $1 LIMIT 1`,
          [txn.card.id],
        );
        if (retry.rows[0]) cardholderId = retry.rows[0].id;
      } catch (e: any) {
        console.warn(`[revolut] auto-assign on txn ${txn.id} failed:`, e?.message);
      }
    }
  }

  // Idempotent: if we already have an expense for this transaction id,
  // update its state but don't insert a duplicate.
  const existing = await pool.query<{ id: string; status: string; cardholder_id: string | null }>(
    `SELECT id, status, cardholder_id FROM expenses WHERE revolut_transaction_id = $1 LIMIT 1`,
    [txn.id],
  );
  if (existing.rows[0]) {
    // Relink orphaned rows: if the row's cardholder_id is NULL but we've
    // since resolved one (auto-assign mapped the card after the original
    // insert), backfill it now. This is why the user's mobile page was
    // empty while desktop admin saw everything: orphan rows existed but
    // couldn't be filtered to the user's cardholder.
    if (!existing.rows[0].cardholder_id && cardholderId) {
      await pool.query(
        `UPDATE expenses SET cardholder_id = $1, updated_at = NOW() WHERE id = $2`,
        [cardholderId, existing.rows[0].id],
      );
      console.log(`[revolut] relinked orphan expense ${existing.rows[0].id} -> cardholder ${cardholderId}`);
    }
    // State transitions — completed → posted_to_xero gate, reverted → mark reversed.
    if (txn.state === "reverted") {
      await pool.query(
        `UPDATE expenses SET status = 'rejected', notes = COALESCE(notes, '') || E'\nReverted by Revolut.', updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].id],
      );
    }
    return { id: existing.rows[0].id, created: false };
  }

  const merchant = txn.merchant?.name || txn.reference || "Card payment";
  const txnDate = new Date(txn.completed_at || txn.created_at || Date.now());

  const [inserted] = await db.insert(expenses).values({
    cardholderId,
    type: "card",
    status: "pending_receipt",
    merchant,
    amountPence,
    currency: currency.toLowerCase(),
    transactionDate: txnDate,
    notes: txn.merchant?.category_code ? `Revolut MCC ${txn.merchant.category_code}` : null,
  } as any).returning({ id: expenses.id });

  // Stash the Revolut transaction id outside the typed insert (the schema
  // type doesn't know about the new column yet — auto-migrate adds it).
  await pool.query(
    `UPDATE expenses SET revolut_transaction_id = $1 WHERE id = $2`,
    [txn.id, inserted.id],
  );

  // Best-effort diary match at swipe time — if the cardholder had a meeting
  // around the transaction time, attach the subject + attendees so the
  // expense arrives pre-contextualised ("Lunch with … re …") before any
  // receipt comes in. Degrades silently if Graph/calendar isn't available.
  if (cardholderId) {
    try {
      const { rows } = await pool.query<{ email: string | null; user_id: string | null }>(
        `SELECT email, user_id FROM stripe_cardholders WHERE id = $1 LIMIT 1`,
        [cardholderId],
      );
      const email = rows[0]?.email;
      if (email) {
        const { findMeetingContext } = await import("./expense-calendar-context");
        // requireContaining: only attach a meeting the spend actually falls
        // within — stops random purchases pulling in an unrelated meeting.
        const ctx = await findMeetingContext({ userEmail: email, userId: rows[0]?.user_id, when: txnDate, requireContaining: true });
        if (ctx) {
          await pool.query(
            `UPDATE expenses
                SET business_purpose = COALESCE(business_purpose, $1),
                    attendees = COALESCE(attendees, $2),
                    calendar_event_id = COALESCE(calendar_event_id, $3),
                    updated_at = NOW()
              WHERE id = $4`,
            [ctx.subject, ctx.attendees || null, ctx.eventId, inserted.id],
          );
        }
      }
    } catch (e: any) {
      console.warn(`[revolut] calendar enrich failed for txn ${txn.id}:`, e?.message);
    }
  }

  // Alert the cardholder on their phone the moment a payment lands, and kick
  // off an immediate email-receipt hunt. Both best-effort + non-blocking so
  // the webhook returns fast. The periodic sweep (sweepPendingEmailReceipts)
  // is the safety net for receipts that email through after the swipe.
  if (cardholderId) {
    void (async () => {
      try {
        // Fetch the full cardholder row — we need .phone for the WhatsApp
        // send, and .user_id for the push subscription lookup. Both come
        // from the same row.
        const { rows } = await pool.query<{ user_id: string | null; phone: string | null; email: string | null; user_name: string | null }>(
          `SELECT user_id, phone, email, user_name FROM stripe_cardholders WHERE id = $1 LIMIT 1`, [cardholderId],
        );
        const uid = rows[0]?.user_id;
        const phone = rows[0]?.phone;
        const amountStr = `£${(amountPence / 100).toFixed(2)}`;

        // WhatsApp prompt — fires alongside the push so non-app users
        // still get a nudge. Loud log lines so 'WhatsApp not working' is
        // diagnosable from Railway: which leg failed (config / phone /
        // send) is now obvious.
        try {
          const { notifyExpensePending } = await import("./expense-notify");
          const { getWhatsAppConfig } = await import("./whatsapp");
          const cfg = getWhatsAppConfig();
          if (!cfg.token || !cfg.phoneNumberId) {
            console.warn(`[revolut notify] WhatsApp SKIPPED for expense ${inserted.id}: env vars missing (token=${!!cfg.token} phoneNumberId=${!!cfg.phoneNumberId})`);
          } else if (!phone) {
            console.warn(`[revolut notify] WhatsApp SKIPPED for expense ${inserted.id}: cardholder ${cardholderId} has no phone number (set it on the Team page)`);
          } else {
            await notifyExpensePending({
              cardholder: { phone } as any,
              merchant,
              amountPence,
              transactionId: txn.id,
            });
            console.log(`[revolut notify] WhatsApp SENT to ${phone} for expense ${inserted.id} (${amountStr} @ ${merchant})`);
          }
        } catch (wErr: any) {
          console.warn(`[revolut notify] WhatsApp FAILED for expense ${inserted.id}: ${wErr?.message}`);
        }

        if (uid) {
          const { sendPushNotification } = await import("./push-notifications");
          await sendPushNotification(uid, {
            title: `Card payment ${amountStr}`,
            body: `${merchant} — finding your receipt…`,
            tag: `expense-${inserted.id}`,
            url: "/my-expenses",
          }).catch(() => {});
        }
        // Immediate attempt (catches receipts already in the inbox).
        const { findEmailReceiptForExpense } = await import("./expense-email-receipt");
        const result = await findEmailReceiptForExpense(inserted.id);
        if (uid && result.found) {
          const { sendPushNotification } = await import("./push-notifications");
          await sendPushNotification(uid, {
            title: `Receipt filed ✓ ${amountStr}`,
            body: `${result.matched?.subject || merchant}${result.posted ? " — posted to Xero" : ""}`,
            tag: `expense-${inserted.id}`,
            url: "/my-expenses",
          }).catch(() => {});
        }
      } catch (e: any) {
        console.warn(`[revolut] notify/auto-receipt failed for ${inserted.id}:`, e?.message);
      }
    })();
  }

  return { id: inserted.id, created: true };
}

// ─── Auto-assign cards to BGP users by email ─────────────────────────────

// Build a holder_id → email map from the Revolut team. The Business API
// endpoint shape varies by tenant, so try the known variants and degrade
// silently.
async function getRevolutTeamEmailById(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const path of ["/team-members", "/team/members"]) {
    try {
      const members = await api<any[]>(path);
      const arr = Array.isArray(members) ? members : (members as any)?.members || [];
      for (const m of arr) {
        const email = (m.email || m.user?.email || "").toString().toLowerCase().trim();
        if (m.id && email) map.set(m.id, email);
      }
      if (map.size > 0) break;
    } catch { /* try next path */ }
  }
  return map;
}

interface AutoAssignResult { assigned: number; alreadyMapped: number; unmatched: Array<{ card: string; reason: string }>; }

// Map every Revolut card to a BGP user by matching the card holder's email
// to users.email. Creates/updates the stripe_cardholders row and stamps
// revolut_card_id so transaction ingestion can resolve the owner. Idempotent.
export async function autoAssignRevolutCards(): Promise<AutoAssignResult> {
  const cards = await api<any[]>(`/cards`).catch(() => []);
  const teamEmail = await getRevolutTeamEmailById();
  const bgpUsers = await db.select().from(users);
  const userByEmail = new Map<string, typeof bgpUsers[number]>();
  for (const u of bgpUsers) {
    if (u.email) userByEmail.set(u.email.toLowerCase().trim(), u);
  }

  const result: AutoAssignResult = { assigned: 0, alreadyMapped: 0, unmatched: [] };

  for (const card of (Array.isArray(cards) ? cards : [])) {
    const cardId = card.id;
    if (!cardId) continue;
    const cardLabel = card.label || cardId.slice(0, 8);

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM stripe_cardholders WHERE revolut_card_id = $1 LIMIT 1`, [cardId],
    );
    if (existing.rows[0]) { result.alreadyMapped++; continue; }

    // Resolve the holder's email: team lookup by holder_id, else any email
    // field on the card, else fuzzy match the card label to a user name.
    const holderEmail = (card.holder_id && teamEmail.get(card.holder_id))
      || (card.holder_email || card.email || "").toString().toLowerCase().trim()
      || null;

    let user = holderEmail ? userByEmail.get(holderEmail) : undefined;
    if (!user && cardLabel) {
      const lbl = String(cardLabel).toLowerCase();
      user = bgpUsers.find(u => u.name && lbl.includes(u.name.toLowerCase()))
          || bgpUsers.find(u => u.email && lbl.includes(u.email.toLowerCase().split("@")[0]));
    }
    if (!user) {
      result.unmatched.push({ card: cardLabel, reason: holderEmail ? `no BGP user with email ${holderEmail}` : "no holder email on card" });
      continue;
    }

    // Create or update this user's cardholder row + stamp the Revolut ids.
    const existingCh = await db.select().from(stripeCardholders).where(eq(stripeCardholders.userId, user.id)).limit(1);
    let cardholderId: string;
    if (existingCh[0]) {
      cardholderId = existingCh[0].id;
    } else {
      const [created] = await db.insert(stripeCardholders).values({
        userId: user.id,
        userName: user.name,
        email: user.email || `${user.username}@brucegillinghampollard.com`,
        phone: user.phone || null,
        stripeCardholderId: null,
        status: "active",
      } as any).returning({ id: stripeCardholders.id });
      cardholderId = created.id;
    }
    await pool.query(
      `UPDATE stripe_cardholders SET revolut_card_id = $1, revolut_holder_id = $2, updated_at = NOW() WHERE id = $3`,
      [cardId, card.holder_id || null, cardholderId],
    );

    // Also upsert a stripe_cards row so the existing /api/expenses/me +
    // mobile card panel pick up last4 + status + expiry + product from
    // there. Revolut field names: `last_digits` (4 chars), `state`
    // (active/blocked/inactive), `expiry` ("MM/YYYY"), `virtual` (bool),
    // `product.code` ("BPD" virtual, "VWE" physical wave).
    const lastDigits: string | null = typeof card.last_digits === "string" ? card.last_digits : null;
    const state: string = card.state === "active" ? "active" : (card.state || "inactive");
    const expiry: string | null = typeof card.expiry === "string" ? card.expiry : null;
    const virtual: boolean | null = typeof card.virtual === "boolean" ? card.virtual : null;
    const productCode: string | null = typeof card?.product?.code === "string" ? card.product.code : null;
    const existingCard = await db.select().from(stripeCards).where(eq(stripeCards.cardholderId, cardholderId)).limit(1);
    if (existingCard[0]) {
      await pool.query(
        `UPDATE stripe_cards SET last4 = $1, status = $2, expiry = $3, virtual = $4, product_code = $5 WHERE id = $6`,
        [lastDigits, state, expiry, virtual, productCode, existingCard[0].id],
      );
    } else {
      await db.insert(stripeCards).values({
        cardholderId,
        stripeCardId: cardId,
        last4: lastDigits || "",
        status: state,
        expiry,
        virtual,
        productCode,
      } as any);
    }

    result.assigned++;
  }
  return result;
}

// ─── Freeze / unfreeze a Revolut card ────────────────────────────────────
//
// Used by the month-end auto-freeze sweep and the admin "freeze card"
// button. Revolut Business exposes POST /cards/{id}/freeze and
// /cards/{id}/unfreeze; both 204 No Content on success and 4xx if the
// token lacks the CARDS_FULL scope. We surface the error verbatim so
// the caller can show a useful banner.

export async function freezeRevolutCard(cardId: string): Promise<void> {
  await api<unknown>(`/cards/${encodeURIComponent(cardId)}/freeze`, { method: "POST" });
}

export async function unfreezeRevolutCard(cardId: string): Promise<void> {
  await api<unknown>(`/cards/${encodeURIComponent(cardId)}/unfreeze`, { method: "POST" });
}

// ─── Card ↔ cardholder resolver ──────────────────────────────────────────
//
// The Revolut card id lives in two places — stripe_cardholders.revolut_card_id
// (written by Auto-assign AND manual map) and stripe_cards.stripe_card_id
// (written by Auto-assign only — the column name is legacy). Show-details and
// the freeze sweep both used to read only from stripe_cards, which meant a
// cardholder mapped via the manual-map endpoint looked like "no card mapped"
// to the dashboard even though their swipes flowed in fine via the
// cardholders.revolut_card_id path. This helper closes that gap: it reads
// cardholders first (source of truth, always populated), falls back to
// stripe_cards, and lazy-writes a stripe_cards row if it's missing — pulling
// last4/expiry/state from Revolut so the UI's card panel renders correctly.

export async function resolveRevolutCardIdForCardholder(cardholderId: string): Promise<string | null> {
  // 1. cardholders row (preferred source).
  const r1 = await pool.query<{ revolut_card_id: string | null }>(
    `SELECT revolut_card_id FROM stripe_cardholders WHERE id = $1 LIMIT 1`, [cardholderId],
  );
  const fromHolder = r1.rows[0]?.revolut_card_id || null;

  // 2. stripe_cards row (legacy / Auto-assign).
  const r2 = await pool.query<{ stripe_card_id: string | null }>(
    `SELECT stripe_card_id FROM stripe_cards WHERE cardholder_id = $1 LIMIT 1`, [cardholderId],
  );
  const fromCards = r2.rows[0]?.stripe_card_id || null;

  const cardId = fromHolder || fromCards;
  if (!cardId) return null;

  // Lazy-backfill: if we have the cardholder mapping but no stripe_cards row,
  // pull metadata from Revolut and write one so the card panel + show-details
  // path stop reporting "no card mapped".
  if (fromHolder && !fromCards) {
    await backfillStripeCardsRow(cardholderId, fromHolder).catch((e) =>
      console.warn(`[revolut] lazy-backfill stripe_cards failed for ${cardholderId}:`, e?.message),
    );
  }
  return cardId;
}

async function backfillStripeCardsRow(cardholderId: string, revolutCardId: string): Promise<void> {
  // Pull the card from Revolut. Failures here are non-fatal — we still
  // have the card id, the UI just won't have last4/expiry yet (next
  // Auto-assign run will fill them in).
  const card = await api<any>(`/cards/${encodeURIComponent(revolutCardId)}`);
  const lastDigits: string | null = typeof card?.last_digits === "string" ? card.last_digits : null;
  const state: string = card?.state === "active" ? "active" : (card?.state || "inactive");
  const expiry: string | null = typeof card?.expiry === "string" ? card.expiry : null;
  const virtual: boolean | null = typeof card?.virtual === "boolean" ? card.virtual : null;
  const productCode: string | null = typeof card?.product?.code === "string" ? card.product.code : null;
  // stripe_card_id is unique; cardholder_id isn't. Upsert on the unique
  // column so re-assigning a card to a different cardholder updates the
  // existing row instead of erroring with a unique-constraint violation.
  await pool.query(
    `INSERT INTO stripe_cards (cardholder_id, stripe_card_id, last4, status, expiry, virtual, product_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (stripe_card_id) DO UPDATE SET
       cardholder_id = EXCLUDED.cardholder_id,
       last4 = EXCLUDED.last4,
       status = EXCLUDED.status,
       expiry = EXCLUDED.expiry,
       virtual = EXCLUDED.virtual,
       product_code = EXCLUDED.product_code`,
    [cardholderId, revolutCardId, lastDigits || "", state, expiry, virtual, productCode],
  );
  console.log(`[revolut] backfilled stripe_cards row for cardholder ${cardholderId} (last4=${lastDigits || "?"})`);
}

// ─── Auto-migration: add the columns we depend on ────────────────────────

let _migrated = false;
async function ensureColumns(): Promise<void> {
  if (_migrated) return;
  try {
    await pool.query(`
      ALTER TABLE stripe_cardholders
        ADD COLUMN IF NOT EXISTS revolut_card_id TEXT,
        ADD COLUMN IF NOT EXISTS revolut_holder_id TEXT
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_cardholders_revolut_card ON stripe_cardholders (revolut_card_id) WHERE revolut_card_id IS NOT NULL`);
    await pool.query(`
      ALTER TABLE expenses
        ADD COLUMN IF NOT EXISTS revolut_transaction_id TEXT
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_revolut_txn ON expenses (revolut_transaction_id) WHERE revolut_transaction_id IS NOT NULL`);
    // Revolut card detail extras — populated by autoAssignRevolutCards
    // from the GET /cards response. Surfaced on the My Card page so the
    // card visual shows expiry + Virtual/Physical alongside last 4.
    await pool.query(`
      ALTER TABLE stripe_cards
        ADD COLUMN IF NOT EXISTS expiry TEXT,
        ADD COLUMN IF NOT EXISTS virtual BOOLEAN,
        ADD COLUMN IF NOT EXISTS product_code TEXT
    `);
    _migrated = true;
  } catch (err: any) {
    if (err?.code !== "42P01") console.warn("[revolut] migration:", err?.message);
  }
}

// Reveal the full PAN + CVV + expiry for a Revolut card. The dedicated
// /cards/{id}/sensitive-details endpoint (documented at
// https://developer.revolut.com/docs/business/get-sensitive-card-details)
// returns the card details that are otherwise app-only. Requires the
// READ_SENSITIVE_CARD_DATA permission on the API certificate; if absent
// Revolut returns 403 and we let the caller render that as a user-facing
// 'enable the scope' message.
//
// Security:
//   - This is the ONE place we ask Revolut for the PAN. Never cache it,
//     never log it, never persist it. Callers are expected to gate on
//     'cardholder owns the logged-in user' (or admin), which the route
//     wrapping this function already does.
//   - Revolut audit-logs every reveal — visible in their Business audit
//     trail. Treat that as the canonical record.
export async function fetchRevolutSensitiveCardDetails(revolutCardId: string): Promise<{
  pan: string;
  cvv: string;
  expiryMonth: number | null;
  expiryYear: number | null;
}> {
  const raw = await api<any>(`/cards/${encodeURIComponent(revolutCardId)}/sensitive-details`);
  // Field names per Revolut docs — defensive fallbacks in case they ever
  // tweak shape (e.g. pan vs card_number, cvv vs cvc).
  const pan: string = raw.pan || raw.card_number || raw.number || "";
  const cvv: string = raw.cvv || raw.cvc || raw.security_code || "";
  // Revolut returns expiry either as a single "MM/YYYY" string OR as
  // separate expiry_month / expiry_year fields. Normalise.
  let expiryMonth: number | null = null;
  let expiryYear: number | null = null;
  if (typeof raw.expiry_month === "number") expiryMonth = raw.expiry_month;
  if (typeof raw.expiry_year === "number") expiryYear = raw.expiry_year;
  if ((!expiryMonth || !expiryYear) && typeof raw.expiry === "string") {
    const m = raw.expiry.match(/^(\d{1,2})\/(\d{4})$/);
    if (m) { expiryMonth = Number(m[1]); expiryYear = Number(m[2]); }
  }
  if (!pan) throw new Error("Revolut sensitive-details response had no PAN field");
  return { pan, cvv, expiryMonth, expiryYear };
}

// ─── Routes ──────────────────────────────────────────────────────────────

// Shared backfill — pulls transactions from the last `lookbackMinutes`
// minutes, runs autoAssign to refresh card mappings, then upserts each
// txn. Idempotent. Used by both the manual sync endpoint and the
// background cron so 'how to sync' has one implementation.
export async function backfillRecentRevolutTransactions(opts: { lookbackMinutes?: number; limit?: number } = {}): Promise<{
  total: number; created: number; updated: number; skipped: number;
  cardsAssigned: number; cardsAlreadyMapped: number;
}> {
  const lookbackMinutes = opts.lookbackMinutes ?? 60 * 24 * 30; // default 30d
  const limit = Math.min(opts.limit ?? 500, 1000);

  const assign = await autoAssignRevolutCards().catch(err => {
    console.warn("[revolut backfill] autoAssign failed:", err?.message);
    return null;
  });
  const from = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  const params = new URLSearchParams({
    from: from.toISOString(),
    type: "card_payment",
    count: String(limit),
  });
  const txns = await api<RevolutTransaction[]>(`/transactions?${params.toString()}`);
  let created = 0, updated = 0, skipped = 0;
  for (const t of txns) {
    const r = await upsertExpenseFromTransaction(t).catch(err => {
      console.warn(`[revolut backfill] upsert failed for txn ${t.id}:`, err?.message);
      return null;
    });
    if (!r) skipped++;
    else if (r.created) created++;
    else updated++;
  }
  return {
    total: txns.length, created, updated, skipped,
    cardsAssigned: assign?.assigned || 0,
    cardsAlreadyMapped: assign?.alreadyMapped || 0,
  };
}

export function setupRevolutRoutes(app: Express): void {
  ensureColumns().catch(err => console.warn("[revolut] init:", err?.message));

  // Diagnostics — does the integration have everything it needs?
  app.get("/api/revolut/status", requireAdmin, async (_req: Request, res: Response) => {
    const cfg = getConfig();
    if (!cfg) {
      return res.json({
        configured: false,
        missing: [
          !process.env.REVOLUT_CLIENT_ID && "REVOLUT_CLIENT_ID",
          !process.env.REVOLUT_JWT_PRIVATE_KEY && "REVOLUT_JWT_PRIVATE_KEY",
          !process.env.REVOLUT_JWT_ISSUER && "REVOLUT_JWT_ISSUER",
        ].filter(Boolean),
      });
    }
    const refreshToken = await readSetting<string>(SETTINGS_KEYS.refreshToken);
    const accessBundle = await readSetting<AccessTokenBundle>(SETTINGS_KEYS.accessTokenBundle);
    let probe: { ok: boolean; error?: string; accounts?: number } = { ok: false };
    if (refreshToken) {
      try {
        const accounts = await api<any[]>(`/accounts`);
        probe = { ok: true, accounts: Array.isArray(accounts) ? accounts.length : 0 };
      } catch (e: any) {
        probe = { ok: false, error: e?.message?.slice(0, 200) };
      }
    }
    res.json({
      configured: true,
      env: cfg.env,
      issuer: cfg.issuer,
      clientId: cfg.clientId.slice(0, 6) + "…",
      bootstrapped: !!refreshToken,
      accessTokenExpiresAt: accessBundle?.expiresAt ? new Date(accessBundle.expiresAt).toISOString() : null,
      webhookSecretConfigured: !!cfg.webhookSecret,
      probe,
    });
  });

  // Exchange an OAuth authorisation code for a refresh token. Run this
  // once after consent — the code is single-use.
  // Admin-only: probes the current Revolut access token by calling each
  // scope-gated endpoint we depend on and reports pass/fail per scope.
  // Built for the "card details says 403, what scope is missing?" loop —
  // tells you exactly which of the four scopes the token has so you can
  // re-do the OAuth consent with the missing one.
  app.get("/api/revolut/probe-scopes", requireAdmin, async (_req: Request, res: Response) => {
    const checks: Array<{ scope: string; label: string; ok: boolean; status: number | null; error: string | null }> = [];

    const run = async (scope: string, label: string, path: string, method: "GET" | "POST" = "GET") => {
      try {
        await api<unknown>(path, { method });
        checks.push({ scope, label, ok: true, status: 200, error: null });
      } catch (e: any) {
        const msg = e?.message || String(e);
        const m = msg.match(/(\d{3})/);
        const status = m ? Number(m[1]) : null;
        // 403 → scope missing; 404 → scope OK but the resource doesn't exist
        // (e.g. no cards); anything else surfaces verbatim.
        const ok = !(status === 403 || /forbidden|permission|scope/i.test(msg));
        checks.push({ scope, label, ok, status, error: ok ? null : msg.slice(0, 200) });
      }
    };

    // Read-only probes only — never call freeze/unfreeze here since a
    // failed restore would leave a real card frozen.
    await run("READ", "Read accounts", `/accounts`);
    await run("READ", "List cards", `/cards`);
    try {
      const cards = await api<any[]>(`/cards`).catch(() => [] as any[]);
      const probeCardId = Array.isArray(cards) && cards[0]?.id;
      if (probeCardId) {
        await run("READ_SENSITIVE_CARD_DATA", "Reveal card PAN / CVV / expiry", `/cards/${encodeURIComponent(probeCardId)}/sensitive-details`);
      } else {
        checks.push({ scope: "READ_SENSITIVE_CARD_DATA", label: "Reveal card PAN / CVV / expiry", ok: false, status: null, error: "no card to probe against" });
      }
    } catch (e: any) {
      console.warn("[revolut] scope probe card-lookup failed:", e?.message);
    }

    res.json({ checks, allGranted: checks.every(c => c.ok) });
  });

  // Admin-only: returns the Revolut Business consent URL pre-filled with
  // our client_id + callback redirect_uri. Used by the 'Re-authorise
  // Revolut' button on the mobile admin Payroll tab — once you've
  // enabled the missing scope on the cert in Revolut Business →
  // Settings → APIs, tap the button, approve, and the existing
  // /api/revolut/callback handler swaps the code for a fresh refresh
  // token with the new scope grant.
  //
  // Note: Revolut Business's consent URL has no `scope=` parameter —
  // scopes live on the API certificate, not in the OAuth flow.
  app.get("/api/revolut/consent-url", requireAdmin, async (req: Request, res: Response) => {
    try {
      const cfg = getConfig();
      if (!cfg) return res.status(400).json({ error: "Revolut not configured — set REVOLUT_CLIENT_ID, REVOLUT_JWT_PRIVATE_KEY, REVOLUT_JWT_ISSUER" });
      const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const redirectUri = `${proto}://${host}/api/revolut/callback`;
      const consentUrl = `https://business.revolut.com/app-confirm?client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
      res.json({ consentUrl, redirectUri, clientId: cfg.clientId.slice(0, 6) + "…" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Diagnostic — Revolut's "code invalid/expired" is famously ambiguous.
  // It returns the same message when the auth code legitimately expired
  // (60-120s lifetime), when the JWT issuer doesn't match the cert's
  // configured JWT URL, when the client_id is wrong, when the private
  // key in Railway doesn't match the public cert uploaded to Revolut,
  // and when the env var has its PEM newlines mangled. This endpoint
  // checks each of those without burning an auth code.
  app.get("/api/revolut/diagnose", requireAdmin, async (_req: Request, res: Response) => {
    const out: any = {};
    out.env = {
      REVOLUT_CLIENT_ID: process.env.REVOLUT_CLIENT_ID ? `${process.env.REVOLUT_CLIENT_ID.slice(0, 8)}…${process.env.REVOLUT_CLIENT_ID.slice(-4)}` : null,
      REVOLUT_JWT_ISSUER: process.env.REVOLUT_JWT_ISSUER || null,
      REVOLUT_ENV: process.env.REVOLUT_ENV || "(unset → defaults to sandbox)",
      REVOLUT_JWT_PRIVATE_KEY_set: !!process.env.REVOLUT_JWT_PRIVATE_KEY,
      REVOLUT_JWT_PRIVATE_KEY_len: process.env.REVOLUT_JWT_PRIVATE_KEY?.length || 0,
      // First line of the PEM — instantly tells us whether the wrong
      // file (a CERTIFICATE) was pasted instead of a PRIVATE KEY.
      REVOLUT_JWT_PRIVATE_KEY_firstLine: (process.env.REVOLUT_JWT_PRIVATE_KEY || "").replace(/\\n/g, "\n").split("\n").find(l => l.trim().length > 0) || null,
    };

    const cfg = getConfig();
    if (!cfg) {
      out.config = { ok: false, reason: "getConfig() returned null — one of CLIENT_ID/PRIVATE_KEY/ISSUER missing" };
      return res.json(out);
    }
    out.config = { ok: true, env: cfg.env, issuer: cfg.issuer, clientIdPrefix: cfg.clientId.slice(0, 8) };

    // Private-key sanity: does the PEM parse? If newlines were mangled
    // in Railway (raw "\n" vs actual newlines vs missing header line),
    // node's crypto rejects it before any HTTP call.
    try {
      const k = crypto.createPrivateKey(cfg.privateKeyPem);
      out.privateKey = {
        parses: true,
        type: k.asymmetricKeyType,
        bits: (k as any).asymmetricKeyDetails?.modulusLength || null,
        sha256: crypto.createHash("sha256").update(k.export({ type: "pkcs8", format: "der" })).digest("hex").slice(0, 16) + "…",
      };
    } catch (e: any) {
      out.privateKey = { parses: false, error: e?.message };
    }

    // JWT signing dry-run: build the same JWT the exchange uses and
    // surface the decoded payload so we can eyeball iss/sub/aud.
    try {
      const jwt = signClientAssertion(cfg);
      const [, payloadB64] = jwt.split(".");
      const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
      out.jwt = { signed: true, header: { alg: "RS256", typ: "JWT" }, payload, length: jwt.length };
    } catch (e: any) {
      out.jwt = { signed: false, error: e?.message };
    }

    // Already-bootstrapped probe: if we have a refresh token, try a
    // /accounts call — non-destructive, no code burned. Tells us
    // whether the JWT+cert pair are actually accepted by Revolut.
    const rt = await readSetting<string>(SETTINGS_KEYS.refreshToken);
    if (rt) {
      try {
        const accounts = await api<any[]>(`/accounts`);
        out.liveProbe = { ok: true, accounts: Array.isArray(accounts) ? accounts.length : 0 };
      } catch (e: any) {
        out.liveProbe = { ok: false, error: e?.message };
      }
    } else {
      out.liveProbe = { ok: false, reason: "no refresh_token stored yet — bootstrap not complete" };
    }

    // Outbound IP — Revolut Business requires the cert's Production IP
    // Whitelist to include the egress IP of whatever's calling them.
    // Railway gives different containers different egress IPs; we ask an
    // IP-echo service so the admin can paste the right value into the
    // whitelist on Revolut Business → APIs → cert → Production IP.
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
      const ipJson = await ipRes.json() as { ip?: string };
      out.egressIp = { ip: ipJson.ip || null, note: "Add this IP to Revolut → APIs → cert → Production IP whitelist. Railway egress IPs are dynamic — consider their Static Egress IP add-on if this changes often." };
    } catch (e: any) {
      out.egressIp = { ip: null, error: e?.message };
    }

    res.json(out);
  });

  app.post("/api/revolut/bootstrap", requireAdmin, async (req: Request, res: Response) => {
    try {
      const code = String(req.body?.code || "").trim();
      if (!code) return res.status(400).json({ error: "code required (paste the value from the ?code= query param after consenting)" });
      const result = await exchangeCodeForToken(code);
      res.json({ ok: true, expiresIn: result.expiresIn, refreshTokenSaved: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // OAuth redirect target. Set this URL as the "OAuth redirect URI" on the
  // Revolut certificate. After you authorise, Revolut sends you back here
  // with `?code=...`; we exchange it for a refresh token automatically so
  // there's no manual bootstrap step. The code is single-use and only our
  // private key can redeem it, so this route is safe without auth.
  app.get("/api/revolut/callback", async (req: Request, res: Response) => {
    const code = String(req.query?.code || "").trim();
    const page = (title: string, body: string) =>
      `<!doctype html><meta charset=utf-8><title>${title}</title>` +
      `<body style="font-family:system-ui;max-width:640px;margin:64px auto;padding:0 24px;line-height:1.5">` +
      `<h2>${title}</h2>${body}</body>`;
    if (!code) {
      return res.status(400).send(page("Revolut: no code", "<p>No <code>?code=</code> in the redirect. Start again from the Revolut authorise URL.</p>"));
    }
    try {
      const result = await exchangeCodeForToken(code);
      res.send(page("Revolut connected ✓", `<p>Refresh token saved. Access token valid for ~${Math.round(result.expiresIn / 60)} min and auto-rotates from here.</p><p>Next: register the webhook — <code>POST /api/revolut/webhook/register</code> with the production URL.</p>`));
    } catch (e: any) {
      res.status(500).send(page("Revolut: exchange failed", `<p>${String(e?.message || e).replace(/[<>]/g, "")}</p><p>The code is single-use — re-authorise to get a fresh one.</p>`));
    }
  });

  // Register the webhook with Revolut, pointing at this host. Pass a
  // publicly-routable URL (Railway production domain).
  app.post("/api/revolut/webhook/register", requireAdmin, async (req: Request, res: Response) => {
    try {
      const url = String(req.body?.url || "").trim();
      if (!url || !url.startsWith("https://")) return res.status(400).json({ error: "url required (https://)" });
      if (!/\/api\/revolut\/webhook\/?$/.test(url)) {
        return res.status(400).json({ error: `url should be the webhook endpoint, e.g. https://<host>/api/revolut/webhook — got ${url}` });
      }
      const events = Array.isArray(req.body?.events) && req.body.events.length
        ? req.body.events
        : ["TransactionCreated", "TransactionStateChanged"];
      // Webhooks live under the 2.0 API (1.0/webhooks was retired → 404).
      const created = await api<any>(`/webhooks`, {
        method: "POST",
        body: JSON.stringify({ url, events }),
      }, "2.0");
      // Revolut returns the signing secret on creation — surface it once
      // so the admin can set REVOLUT_WEBHOOK_SECRET on Railway.
      res.json({
        ok: true,
        webhook: created,
        signingSecret: created?.signing_secret || null,
        action: created?.signing_secret
          ? `Now set REVOLUT_WEBHOOK_SECRET=${created.signing_secret} in env (only chance to see it).`
          : "Webhook created. Capture the signing secret from the Revolut dev portal and set REVOLUT_WEBHOOK_SECRET.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // List existing webhooks — useful when the signing secret toast was
  // missed and you need to delete + re-register to get a fresh one.
  app.get("/api/revolut/webhooks", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const list = await api<any[]>(`/webhooks`, {}, "2.0");
      res.json({ webhooks: list });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Delete a webhook by Revolut id. Pair with re-register to recover a
  // lost signing secret (Revolut only shows it once on creation).
  app.delete("/api/revolut/webhooks/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await api<unknown>(`/webhooks/${encodeURIComponent(String(req.params.id))}`, { method: "DELETE" }, "2.0");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // List cards (for mapping to BGP users)
  app.get("/api/revolut/cards", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const cards = await api<any[]>(`/cards`);
      res.json(cards);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Auto-assign every card to a BGP user by matching the holder's email.
  app.post("/api/revolut/cards/auto-assign", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await autoAssignRevolutCards();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Map a Revolut card to a BGP user (creates or updates the
  // stripe_cardholders row — the table name is legacy; it's effectively
  // the "expense submitter" table now).
  app.post("/api/revolut/cardholders/map", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, revolutCardId, revolutHolderId, phone, email, name } = req.body || {};
      if (!userId || !revolutCardId) return res.status(400).json({ error: "userId and revolutCardId required" });

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return res.status(404).json({ error: "user not found" });

      const existing = await db.select().from(stripeCardholders).where(eq(stripeCardholders.userId, userId)).limit(1);
      if (existing[0]) {
        await pool.query(
          `UPDATE stripe_cardholders
              SET revolut_card_id = $1, revolut_holder_id = $2, updated_at = NOW()
            WHERE id = $3`,
          [revolutCardId, revolutHolderId || null, existing[0].id],
        );
        await backfillStripeCardsRow(existing[0].id, revolutCardId).catch((e) =>
          console.warn(`[revolut] map → stripe_cards backfill failed:`, e?.message),
        );
        return res.json({ ok: true, cardholderId: existing[0].id, action: "updated" });
      }

      const [created] = await db.insert(stripeCardholders).values({
        userId,
        userName: name || user.name,
        email: email || user.email || `${user.username}@brucegillinghampollard.com`,
        phone: phone || user.phone || null,
        stripeCardholderId: null,
        status: "active",
      } as any).returning({ id: stripeCardholders.id });
      await pool.query(
        `UPDATE stripe_cardholders SET revolut_card_id = $1, revolut_holder_id = $2 WHERE id = $3`,
        [revolutCardId, revolutHolderId || null, created.id],
      );
      // Mirror to stripe_cards so show-details + the card panel work
      // immediately (without waiting for the next Auto-assign).
      await backfillStripeCardsRow(created.id, revolutCardId).catch((e) =>
        console.warn(`[revolut] map → stripe_cards backfill failed:`, e?.message),
      );
      res.json({ ok: true, cardholderId: created.id, action: "created" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Backfill — pull transactions from a date and upsert as expense rows.
  // Useful for catching anything the webhook missed, and for first-time
  // sync after the integration goes live.
  // requireAuth (not requireAdmin) so staff can hit "Sync now" on their
  // mobile card panel without admin perms. The Revolut API call still
  // goes via the server's own OAuth token (one per org), so this isn't
  // a privilege-escalation risk — just lets users refresh their own
  // feed. Idempotent.
  app.post("/api/revolut/sync-transactions", requireAuth, async (req: Request, res: Response) => {
    try {
      const lookbackMinutes = req.body?.from
        ? Math.max(1, Math.round((Date.now() - new Date(req.body.from).getTime()) / 60_000))
        : 60 * 24 * 30;
      const result = await backfillRecentRevolutTransactions({
        lookbackMinutes,
        limit: Number(req.body?.limit) || 500,
      });
      console.log(`[revolut sync] manual done txns=${result.total} created=${result.created} updated=${result.updated} skipped=${result.skipped}`);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("[revolut sync] crashed:", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // The actual webhook — Revolut POSTs transaction events here. No auth
  // middleware; we verify with HMAC instead.
  app.post("/api/revolut/webhook", async (req: Request, res: Response) => {
    // Loud, unconditional log so we can SEE the webhook firing in
    // production. The previous behaviour (silent unless an error fired)
    // made it impossible to tell whether 'no transactions on the dashboard'
    // meant 'Revolut isn't sending events' or 'we're rejecting them'.
    console.log(`[revolut webhook] HIT event=${req.body?.event || "?"} data_id=${req.body?.data?.id || "?"} type=${req.body?.data?.type || "?"} state=${req.body?.data?.state || "?"}`);
    try {
      const cfg = getConfig();
      if (!cfg) {
        console.warn("[revolut webhook] REJECTED: config missing");
        return res.status(503).json({ error: "Revolut config not set" });
      }
      if (!verifyWebhookSignature(req, cfg)) {
        console.warn("[revolut webhook] REJECTED: invalid signature (check REVOLUT_WEBHOOK_SECRET matches the value in Revolut's dashboard)");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const event = req.body?.event;
      const data = req.body?.data;

      if (event === "TransactionCreated" || event === "TransactionStateChanged") {
        const r = await upsertExpenseFromTransaction(data as RevolutTransaction);
        const action = r?.created ? "created" : r ? "updated" : "ignored";
        console.log(`[revolut webhook] OK event=${event} action=${action} expense_id=${r?.id || "-"}`);
        return res.json({ ok: true, action });
      }

      console.log(`[revolut webhook] OK event=${event} action=ignored (not a transaction event)`);
      res.json({ ok: true, action: "ignored", event });
    } catch (e: any) {
      console.error("[revolut webhook] CRASHED:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });
}
