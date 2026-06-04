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
import { stripeCardholders, expenses, systemSettings, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "./auth";

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
    console.warn("[revolut] REVOLUT_WEBHOOK_SECRET unset — refusing webhook");
    return false;
  }
  const signatureHeader = req.headers["revolut-signature"];
  const timestamp = req.headers["revolut-request-timestamp"];
  if (typeof signatureHeader !== "string" || typeof timestamp !== "string") return false;

  const tsNum = Number(timestamp);
  if (!isFinite(tsNum)) return false;
  if (Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) return false;

  const rawBuf = (req as any).rawBody;
  const rawBody: string = Buffer.isBuffer(rawBuf) ? rawBuf.toString("utf8") : (typeof rawBuf === "string" ? rawBuf : JSON.stringify(req.body || {}));
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", cfg.webhookSecret).update(signedPayload).digest("hex");

  // Header is "v1=<sig>" or "v1=<sig>,v1=<sig>". Accept if any matches.
  const sigs = signatureHeader.split(",").map(s => s.trim().split("=", 2)).filter(parts => parts[0] === "v1").map(parts => parts[1]);
  return sigs.some(sig => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
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
  const existing = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM expenses WHERE revolut_transaction_id = $1 LIMIT 1`,
    [txn.id],
  );
  if (existing.rows[0]) {
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
        const ctx = await findMeetingContext({ userEmail: email, userId: rows[0]?.user_id, when: txnDate });
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
        const { rows } = await pool.query<{ user_id: string | null }>(
          `SELECT user_id FROM stripe_cardholders WHERE id = $1 LIMIT 1`, [cardholderId],
        );
        const uid = rows[0]?.user_id;
        const amountStr = `£${(amountPence / 100).toFixed(2)}`;
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
    result.assigned++;
  }
  return result;
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
    _migrated = true;
  } catch (err: any) {
    if (err?.code !== "42P01") console.warn("[revolut] migration:", err?.message);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────

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
        action: created?.signing_secret
          ? `Now set REVOLUT_WEBHOOK_SECRET=${created.signing_secret} in env (only chance to see it).`
          : "Webhook created. Capture the signing secret from the Revolut dev portal and set REVOLUT_WEBHOOK_SECRET.",
      });
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
      res.json({ ok: true, cardholderId: created.id, action: "created" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Backfill — pull transactions from a date and upsert as expense rows.
  // Useful for catching anything the webhook missed, and for first-time
  // sync after the integration goes live.
  app.post("/api/revolut/sync-transactions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const from = req.body?.from ? new Date(req.body.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({
        from: from.toISOString(),
        type: "card_payment",
        count: String(Math.min(Number(req.body?.limit) || 500, 1000)),
      });
      const txns = await api<RevolutTransaction[]>(`/transactions?${params.toString()}`);
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const t of txns) {
        const r = await upsertExpenseFromTransaction(t).catch(err => {
          console.warn(`[revolut] upsert failed for txn ${t.id}:`, err?.message);
          return null;
        });
        if (!r) skipped++;
        else if (r.created) created++;
        else updated++;
      }
      res.json({ ok: true, total: txns.length, created, updated, skipped, from: from.toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // The actual webhook — Revolut POSTs transaction events here. No auth
  // middleware; we verify with HMAC instead.
  app.post("/api/revolut/webhook", async (req: Request, res: Response) => {
    try {
      const cfg = getConfig();
      if (!cfg) {
        console.warn("[revolut] webhook ignored: config missing");
        return res.status(503).json({ error: "Revolut config not set" });
      }
      if (!verifyWebhookSignature(req, cfg)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const event = req.body?.event;
      const data = req.body?.data;

      if (event === "TransactionCreated" || event === "TransactionStateChanged") {
        // The data block is the transaction itself for these events.
        const r = await upsertExpenseFromTransaction(data as RevolutTransaction);
        return res.json({ ok: true, action: r?.created ? "created" : r ? "updated" : "ignored" });
      }

      // Other event types (cards, accounts) are no-ops for now.
      res.json({ ok: true, action: "ignored", event });
    } catch (e: any) {
      console.error("[revolut webhook]", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });
}
