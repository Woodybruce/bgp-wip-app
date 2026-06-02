/**
 * Stripe Issuing — Card Programme for BGP
 * ========================================
 *
 * Handles:
 *   - Cardholder creation (one per staff member)
 *   - Virtual card issuance with per-cardholder spending controls
 *   - Transaction webhooks → expense records
 *   - Receipt attachment (from WhatsApp or dashboard upload)
 *   - Calendar cross-reference for business purpose
 *   - Xero posting via xeroApi()
 *   - Admin routes: list cardholders, update limits, freeze/unfreeze
 *
 * All amounts in pence (Stripe convention).
 */
import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "./auth";
import { db } from "./db";
import { stripeCardholders, stripeCards, expenses, expenseReceipts, expenseAttendees, crmContacts, users as usersTable } from "@shared/schema";
import { eq, desc, and, gte, sql, inArray } from "drizzle-orm";
import crypto from "crypto";
import multer from "multer";
import { saveFile } from "./file-storage";

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string {
  const raw = process.env.STRIPE_SECRET_KEY;
  if (!raw) throw new Error("STRIPE_SECRET_KEY not set");
  // Strip control chars, BOM, zero-width spaces, surrounding quotes, and any KEY= prefix.
  let key = raw.replace(/[\x00-\x1F\x7F\xAD]/g, "").trim();
  key = key.replace(/\uFEFF/g, ""); // BOM
  key = key.replace(/[\u200B-\u200F]/g, ""); // zero-width
  key = key.replace(/^STRIPE_SECRET_KEY\s*=\s*/i, "");
  while (key.startsWith("=") || key.startsWith('"') || key.startsWith("'")) key = key.slice(1).trim();
  while (key.endsWith('"') || key.endsWith("'")) key = key.slice(0, -1).trim();
  if (!/^sk_(test|live)_/.test(key)) {
    const hex = Buffer.from(raw.slice(0, 16)).toString("hex");
    throw new Error(`STRIPE_SECRET_KEY malformed (first 16 bytes hex: ${hex}). Must start with sk_test_ or sk_live_.`);
  }
  return key;
}

async function stripeRequest(method: string, path: string, body?: Record<string, any>): Promise<any> {
  const encoded = body
    ? Object.entries(flattenStripeParams(body))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : undefined;

  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encoded,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path} → ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

function flattenStripeParams(obj: Record<string, any>, prefix = ""): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const itemKey = `${key}[${i}]`;
        if (item !== null && typeof item === "object") {
          Object.assign(out, flattenStripeParams(item, itemKey));
        } else {
          out[itemKey] = item;
        }
      });
    } else if (typeof v === "object") {
      Object.assign(out, flattenStripeParams(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ─── CARD CATEGORY LIMITS ──────────────────────────────────────────────────

const BLOCKED_MCCS = [
  "betting_casino_gambling",
  "automated_cash_disburse",
  "manual_cash_disburse",
];

function spendingControls(opts: { monthlyLimit: number; dailyLimit: number; singleTxLimit: number }) {
  return {
    spending_limits: [
      { amount: opts.singleTxLimit, interval: "per_authorization" },
      { amount: opts.dailyLimit,    interval: "daily" },
      { amount: opts.monthlyLimit,  interval: "monthly" },
    ],
    blocked_categories: BLOCKED_MCCS,
  };
}

// ─── CARDHOLDER ────────────────────────────────────────────────────────────

export async function createCardholder(args: {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  monthlyLimitPence?: number;
  dailyLimitPence?: number;
  singleTxLimitPence?: number;
}) {
  const monthly  = args.monthlyLimitPence  ?? 100_000; // £1,000
  const daily    = args.dailyLimitPence    ?? 25_000;  // £250
  const singleTx = args.singleTxLimitPence ?? 25_000;  // £250

  const cardholder = await stripeRequest("POST", "/issuing/cardholders", {
    type: "individual",
    name: args.name,
    email: args.email,
    phone_number: args.phone || undefined,
    status: "active",
    billing: {
      address: {
        line1: "55 Wells Street",
        city: "London",
        postal_code: "W1T 3PT",
        country: "GB",
      },
    },
    individual: {
      first_name: args.name.split(" ")[0] || args.name,
      last_name: args.name.split(" ").slice(1).join(" ") || args.name,
      card_issuing: {
        user_terms_acceptance: {
          date: Math.floor(Date.now() / 1000),
          ip: "127.0.0.1",
        },
      },
    },
    spending_controls: spendingControls({ monthlyLimit: monthly, dailyLimit: daily, singleTxLimit: singleTx }),
  });

  const [row] = await db.insert(stripeCardholders).values({
    userId: args.userId,
    userName: args.name,
    email: args.email,
    phone: args.phone,
    stripeCardholderId: cardholder.id,
    monthlyLimit: monthly,
    dailyLimit: daily,
    singleTxLimit: singleTx,
  }).returning();

  return row;
}

// ─── CARD ──────────────────────────────────────────────────────────────────

export async function issueVirtualCard(cardholderId: string) {
  const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, cardholderId)).limit(1);
  if (!ch) throw new Error("Cardholder not found");

  const card = await stripeRequest("POST", "/issuing/cards", {
    cardholder: ch.stripeCardholderId,
    currency: "gbp",
    type: "virtual",
    status: "active",
    spending_controls: spendingControls({
      monthlyLimit: ch.monthlyLimit,
      dailyLimit: ch.dailyLimit,
      singleTxLimit: ch.singleTxLimit,
    }),
  });

  const [row] = await db.insert(stripeCards).values({
    cardholderId,
    stripeCardId: card.id,
    last4: card.last4,
    status: "active",
  }).returning();

  return { card: row, stripeCard: card };
}

// ─── UPDATE LIMITS (admin) ─────────────────────────────────────────────────

export async function updateCardholderLimits(args: {
  cardholderId: string;
  monthlyLimit?: number;
  dailyLimit?: number;
  singleTxLimit?: number;
}) {
  const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, args.cardholderId)).limit(1);
  if (!ch) throw new Error("Cardholder not found");

  const newMonthly  = args.monthlyLimit  ?? ch.monthlyLimit;
  const newDaily    = args.dailyLimit    ?? ch.dailyLimit;
  const newSingleTx = args.singleTxLimit ?? ch.singleTxLimit;

  await stripeRequest("POST", `/issuing/cardholders/${ch.stripeCardholderId}`, {
    spending_controls: spendingControls({ monthlyLimit: newMonthly, dailyLimit: newDaily, singleTxLimit: newSingleTx }),
  });

  await db.update(stripeCardholders).set({
    monthlyLimit: newMonthly,
    dailyLimit: newDaily,
    singleTxLimit: newSingleTx,
    updatedAt: new Date(),
  }).where(eq(stripeCardholders.id, args.cardholderId));
}

// ─── FREEZE / UNFREEZE ─────────────────────────────────────────────────────

export async function setCardholderStatus(cardholderId: string, status: "active" | "inactive") {
  const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, cardholderId)).limit(1);
  if (!ch) throw new Error("Cardholder not found");
  await stripeRequest("POST", `/issuing/cardholders/${ch.stripeCardholderId}`, { status });
  await db.update(stripeCardholders).set({ status, updatedAt: new Date() }).where(eq(stripeCardholders.id, cardholderId));
}

// ─── XERO CATEGORY MAPPING ─────────────────────────────────────────────────

export const EXPENSE_CATEGORY_MAP: Record<string, { code: string; name: string }> = {
  "Client Entertainment":           { code: "410", name: "Client Entertainment" },
  "Agent Entertainment (External)": { code: "411", name: "Agent Entertainment (External)" },
  "Staff Entertainment":            { code: "412", name: "Staff Entertainment" },
  "Directors Meetings":             { code: "413", name: "Directors Meetings" },
  "Subsistence":                    { code: "415", name: "Subsistence" },
  "Meals & Drinks":                 { code: "416", name: "Meals & Drinks" },
  "Travel - Train":                 { code: "471", name: "Travel - Train" },
  "Travel - Tube":                  { code: "472", name: "Travel - Tube" },
  "Travel - Taxi":                  { code: "473", name: "Travel - Taxi" },
  "Travel - Flights":               { code: "474", name: "Travel - Flights" },
  "Travel - Hotels":                { code: "475", name: "Travel - Hotels" },
  "Travel - Car Hire":              { code: "476", name: "Travel - Car Hire" },
  "Travel - Parking & Tolls":       { code: "477", name: "Travel - Parking & Tolls" },
  "Travel - TFL Bike":              { code: "478", name: "Travel - TFL Bike" },
  "Mileage Claims (HMRC 45p)":      { code: "479", name: "Mileage Claims (HMRC 45p)" },
  "Marketing & Advertising":        { code: "480", name: "Marketing & Advertising" },
  "PR (Literature & Brochures)":    { code: "481", name: "PR (Literature & Brochures)" },
  "Advertising":                    { code: "482", name: "Advertising" },
  "Office Supplies / Stationery":   { code: "500", name: "Office Supplies / Stationery" },
  "Office Expenses (general)":      { code: "501", name: "Office Expenses (general)" },
  "Printing - Pitch Documents":     { code: "512", name: "Printing - Pitch Documents" },
  "Software (subscriptions)":       { code: "600", name: "Software (subscriptions)" },
  "IT Charges":                     { code: "601", name: "IT Charges" },
  "Mobile Phone":                   { code: "611", name: "Mobile Phone" },
  "Phone & Internet":               { code: "612", name: "Phone & Internet" },
  "Premises Expenses":              { code: "700", name: "Premises Expenses" },
  "RICS Fees":                      { code: "750", name: "RICS Fees" },
  "Training":                       { code: "751", name: "Training" },
  "Subscriptions - Magazines/Memberships": { code: "753", name: "Subscriptions - Magazines/Memberships" },
  "Staff Gifts":                    { code: "780", name: "Staff Gifts" },
  "Client Gifts":                   { code: "781", name: "Client Gifts" },
  "Other Expenses":                 { code: "900", name: "Other Expenses" },
  "Personal (deduct from payroll)": { code: "910", name: "Personal (deduct from payroll)" },
  "Sainsburys / Tesco / Ocado":     { code: "503", name: "Sainsburys / Tesco / Ocado" },
};

// ─── WEBHOOK ───────────────────────────────────────────────────────────────

export async function handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[stripe] STRIPE_WEBHOOK_SECRET not set — skipping signature verification in dev");
  } else {
    verifyStripeSignature(rawBody, signature, secret);
  }

  const event = JSON.parse(rawBody.toString());
  console.log(`[stripe-webhook] ${event.type}`);

  if (event.type === "issuing_transaction.created" || event.type === "issuing_transaction.updated") {
    await handleTransaction(event.data.object);
  }

  if (event.type === "issuing_authorization.request") {
    // Real-time auth — respond quickly (within 2s) to allow/decline
    // For now: allow all (spending_controls handles limits at Stripe level)
    // Future: could check against custom rules here
    console.log(`[stripe-webhook] auth request for ${event.data.object.amount} — auto-approving`);
  }
}

async function handleTransaction(txn: any): Promise<void> {
  const cardholderId = txn.cardholder;
  const [ch] = await db
    .select()
    .from(stripeCardholders)
    .where(eq(stripeCardholders.stripeCardholderId, cardholderId))
    .limit(1);

  if (!ch) {
    console.warn(`[stripe] Transaction for unknown cardholder ${cardholderId}`);
    return;
  }

  const existing = await db
    .select()
    .from(expenses)
    .where(eq(expenses.stripeTransactionId, txn.id))
    .limit(1);

  if (existing[0]) {
    // Update only — don't duplicate
    await db.update(expenses).set({ updatedAt: new Date() }).where(eq(expenses.stripeTransactionId, txn.id));
    return;
  }

  await db.insert(expenses).values({
    cardholderId: ch.id,
    stripeTransactionId: txn.id,
    type: "card",
    status: "pending_receipt",
    merchant: txn.merchant_data?.name || txn.merchant_data?.network_id || "Unknown merchant",
    amountPence: Math.abs(txn.amount),
    currency: txn.currency,
    transactionDate: new Date(txn.created * 1000),
    createdBy: ch.userId,
  });

  // Notify via WhatsApp if the cardholder has a phone
  if (ch.phone) {
    try {
      const { notifyExpensePending } = await import("./expense-notify");
      await notifyExpensePending({ cardholder: ch, merchant: txn.merchant_data?.name, amountPence: Math.abs(txn.amount), transactionId: txn.id });
    } catch (e: any) {
      console.warn(`[stripe] WhatsApp notify failed: ${e?.message}`);
    }
  }
}

function verifyStripeSignature(payload: Buffer, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const expected = parts["v1"];
  const signed = `${timestamp}.${payload.toString()}`;
  const computed = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  if (computed !== expected) throw new Error("Invalid Stripe webhook signature");
}

// ─── ROUTES ────────────────────────────────────────────────────────────────

// Check that the current user owns this expense (or is admin). Returns true if allowed.
async function userCanAccessExpense(req: Request, expenseId: string): Promise<boolean> {
  const userId = (req.session as any)?.userId;
  if (!userId) return false;
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) return false;
  if (exp.createdBy === userId) return true;
  if (exp.cardholderId) {
    const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, exp.cardholderId)).limit(1);
    if (ch?.userId === userId) return true;
  }
  // Admin override — check is_admin or ADMIN_EMAILS
  try {
    const { pool } = await import("./db");
    const r = await pool.query("SELECT is_admin, email FROM users WHERE id = $1", [userId]);
    if (r.rows[0]?.is_admin) return true;
  } catch {}
  return false;
}

export function setupStripeIssuingRoutes(app: Express) {
  // Relax stripe_cardholder_id from NOT NULL on boot so the receipts-only
  // flow can create card-less submitter rows.
  import("./expense-from-receipt").then(({ ensureCardlessCardholderColumn }) =>
    ensureCardlessCardholderColumn().catch(err => console.warn("[stripe-issuing] cardless migration:", err?.message))
  );

  // Startup diagnostic — log every env var name containing "stripe" (case-insensitive)
  // plus length & first/last 4 chars so we can see if the var is reaching the process.
  const allKeys = Object.keys(process.env);
  const stripeMatches = allKeys.filter(k => /stripe/i.test(k));
  console.log(`[stripe-diag] Total env vars: ${allKeys.length}`);
  console.log(`[stripe-diag] Stripe-related keys: ${stripeMatches.length === 0 ? "NONE FOUND" : stripeMatches.map(k => JSON.stringify(k)).join(", ")}`);
  for (const name of stripeMatches) {
    const v = process.env[name] ?? "";
    console.log(`[stripe-diag]   ${JSON.stringify(name)}: length=${v.length}, first4=${JSON.stringify(v.slice(0,4))}, last4=${JSON.stringify(v.slice(-4))}`);
  }

  // List all cardholders (admin)
  app.get("/api/expenses/cardholders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(stripeCardholders).orderBy(stripeCardholders.userName);
      res.json(rows);
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Nominal codes / expense categories sourced from Xero. The dropdown
  // on the expense edit / submit dialogs reads from here; Wendy keeps
  // the list current in Xero rather than asking a dev to edit a map.
  // Falls back to the legacy static map when Xero is unreachable so
  // submissions don't block on connectivity.
  app.get("/api/expenses/nominal-codes", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getExpenseCategories } = await import("./expense-categories");
      const categories = await getExpenseCategories();
      res.json(categories);
    } catch (e: any) {
      console.error("[expenses] nominal-codes error:", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Force a fresh fetch from Xero (Wendy's button after she edits the chart
  // of accounts). Admin-only because it bypasses the 10-min TTL cache.
  app.post("/api/expenses/nominal-codes/refresh", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { getExpenseCategories, invalidateCache } = await import("./expense-categories");
      invalidateCache();
      const categories = await getExpenseCategories({ forceRefresh: true });
      res.json({ ok: true, count: categories.length, categories });
    } catch (e: any) {
      console.error("[expenses] nominal-codes refresh error:", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Create cardholder + issue virtual card
  app.post("/api/expenses/cardholders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, name, email, phone, monthlyLimit, dailyLimit, singleTxLimit } = req.body;
      if (!userId || !name || !email) return res.status(400).json({ error: "userId, name, email required" });
      const ch = await createCardholder({
        userId, name, email, phone,
        monthlyLimitPence:  monthlyLimit  ? monthlyLimit  * 100 : undefined,
        dailyLimitPence:    dailyLimit    ? dailyLimit    * 100 : undefined,
        singleTxLimitPence: singleTxLimit ? singleTxLimit * 100 : undefined,
      });
      const { card } = await issueVirtualCard(ch.id);
      res.json({ cardholder: ch, card });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Update limits (admin)
  app.patch("/api/expenses/cardholders/:id/limits", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { monthlyLimit, dailyLimit, singleTxLimit } = req.body;
      await updateCardholderLimits({
        cardholderId: String(req.params.id),
        monthlyLimit:  monthlyLimit  ? monthlyLimit  * 100 : undefined,
        dailyLimit:    dailyLimit    ? dailyLimit    * 100 : undefined,
        singleTxLimit: singleTxLimit ? singleTxLimit * 100 : undefined,
      });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Delete cardholder + cards + expenses (admin) — removes DB rows.
  // Stripe-side cardholder/card remain (Stripe doesn't allow hard delete via API);
  // cancel them in the Stripe dashboard if needed.
  app.delete("/api/expenses/cardholders/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, id)).limit(1);
      if (!ch) return res.status(404).json({ error: "Cardholder not found" });
      // Cascade: delete receipts → expenses → cards → cardholder
      const expRows = await db.select().from(expenses).where(eq(expenses.cardholderId, id));
      for (const e of expRows) {
        await db.delete(expenseReceipts).where(eq(expenseReceipts.expenseId, e.id));
      }
      await db.delete(expenses).where(eq(expenses.cardholderId, id));
      await db.delete(stripeCards).where(eq(stripeCards.cardholderId, id));
      await db.delete(stripeCardholders).where(eq(stripeCardholders.id, id));
      res.json({ success: true, deletedExpenses: expRows.length });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Freeze / unfreeze
  app.patch("/api/expenses/cardholders/:id/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { status } = req.body;
      if (status !== "active" && status !== "inactive") return res.status(400).json({ error: "status must be active or inactive" });
      await setCardholderStatus(String(req.params.id), status);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // List expenses
  app.get("/api/expenses", requireAdmin, async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(expenses).orderBy(desc(expenses.transactionDate)).limit(200);
      res.json(rows);
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Get single expense (owner or admin)
  app.get("/api/expenses/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!(await userCanAccessExpense(req, id))) return res.status(403).json({ error: "Forbidden" });
      const [row] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // List attendees on an entertainment expense — hydrated with current
  // contact name + company so the picker can show them without an extra
  // round-trip per chip.
  app.get("/api/expenses/:id/attendees", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!(await userCanAccessExpense(req, id))) return res.status(403).json({ error: "Forbidden" });
      const rows = await db
        .select({
          id: expenseAttendees.contactId,
          name: crmContacts.name,
          email: crmContacts.email,
          companyId: crmContacts.companyId,
        })
        .from(expenseAttendees)
        .leftJoin(crmContacts, eq(crmContacts.id, expenseAttendees.contactId))
        .where(eq(expenseAttendees.expenseId, id));
      res.json(rows);
    } catch (e: any) {
      console.error("[expenses] attendees-get error:", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Replace the attendee list. Caller sends { contactIds: string[] };
  // we wipe the existing rows and re-insert. Idempotent.
  app.put("/api/expenses/:id/attendees", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!(await userCanAccessExpense(req, id))) return res.status(403).json({ error: "Forbidden" });
      const contactIds: string[] = Array.isArray(req.body?.contactIds)
        ? req.body.contactIds.filter((x: any) => typeof x === "string" && x.length > 0)
        : [];

      await db.delete(expenseAttendees).where(eq(expenseAttendees.expenseId, id));
      if (contactIds.length > 0) {
        await db.insert(expenseAttendees).values(
          contactIds.map(cid => ({ expenseId: id, contactId: cid }))
        ).onConflictDoNothing();
      }
      // Re-compute flags — adding attendees clears entertainment_no_attendees.
      const { computeFlagReasons } = await import("./expense-approval");
      const reasons = await computeFlagReasons(id);
      await db.update(expenses).set({
        flaggedForReview: reasons.length > 0,
        flagReasons: reasons,
        updatedAt: new Date(),
      }).where(eq(expenses.id, id));
      res.json({ ok: true, count: contactIds.length });
    } catch (e: any) {
      console.error("[expenses] attendees-put error:", e?.message);
      res.status(500).json({ error: e?.message });
    }
  });

  // Update expense (owner or admin)
  app.patch("/api/expenses/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!(await userCanAccessExpense(req, id))) return res.status(403).json({ error: "Forbidden" });
      const allowed = ["merchant", "transactionDate", "category", "xeroAccountCode",
                       "businessPurpose", "attendees", "isPersonal", "isClientRechargeable",
                       "relatedDealId", "notes", "status"];
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const k of allowed) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      // Coerce transactionDate string → Date for the Drizzle timestamp col.
      if (updates.transactionDate && typeof updates.transactionDate === "string") {
        const d = new Date(updates.transactionDate);
        if (!Number.isNaN(d.getTime())) updates.transactionDate = d;
        else delete updates.transactionDate;
      }
      // Once an expense is on Xero, edits to merchant/date/amount shouldn't
      // diverge silently from what Wendy can see in Xero. Block here so the
      // PATCH 200 doesn't lie about persistence.
      const [existing] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
      if (existing?.xeroExpenseId && (updates.merchant !== undefined || updates.transactionDate !== undefined || updates.category !== undefined)) {
        return res.status(409).json({ error: "Expense is already posted to Xero — edit it in Xero instead, or unpost first." });
      }
      if (updates.category) {
        // Prefer the live Xero list (Wendy's source of truth); fall back
        // to the static map for renamed/removed categories so old rows
        // still resolve.
        const { getCategoryCode } = await import("./expense-categories");
        const code = await getCategoryCode(String(updates.category));
        if (code) updates.xeroAccountCode = code;
      }
      await db.update(expenses).set(updates as any).where(eq(expenses.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Smoke test — creates a sandbox cardholder + card, returns details.
  app.post("/api/expenses/smoke-test", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(400).json({ error: "STRIPE_SECRET_KEY not set" });
      }
      const userId = `test-${Date.now()}`;
      const ch = await createCardholder({
        userId,
        name: req.body?.name || "Woody Bruce (Test)",
        email: req.body?.email || "test@bgpllp.co.uk",
        phone: req.body?.phone,
      });
      const { card, stripeCard } = await issueVirtualCard(ch.id);
      res.json({
        cardholder: ch,
        card,
        stripeCard: { id: stripeCard.id, last4: stripeCard.last4, status: stripeCard.status, brand: stripeCard.brand },
        nextSteps: [
          "Cardholder + virtual card created in Stripe sandbox",
          "Now go to https://dashboard.stripe.com/test/issuing/cards/" + stripeCard.id,
          "Click 'Create test transaction' to fire a webhook",
          "Check /api/expenses to see the resulting expense record",
        ],
      });
    } catch (e: any) {
      console.error("[smoke-test] failed:", e);
      res.status(500).json({ error: e?.message });
    }
  });

  // Manually post a finalised expense to Xero (used after receipt parsing if auto-post failed)
  app.post("/api/expenses/:id/post-to-xero", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { postExpenseToXero } = await import("./expense-xero-poster");
      const result = await postExpenseToXero({ session: req.session, expenseId: String(req.params.id) });
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // ─── SELF-SERVICE (per-user) ──────────────────────────────────────────────

  // Get my cardholder + card + expenses + monthly summary
  app.get("/api/expenses/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Not logged in" });

      const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.userId, userId)).limit(1);
      if (!ch) return res.json({ cardholder: null, card: null, expenses: [], summary: null });

      const [card] = await db.select().from(stripeCards).where(eq(stripeCards.cardholderId, ch.id)).limit(1);

      const myExpenses = await db.select().from(expenses).where(eq(expenses.cardholderId, ch.id)).orderBy(desc(expenses.transactionDate)).limit(100);

      // Hydrate attendees from the join table — saves a per-row fetch
      // when the dialog opens.
      const expenseIds = myExpenses.map(e => e.id);
      const attendeeRows = expenseIds.length > 0
        ? await db
            .select({
              expenseId: expenseAttendees.expenseId,
              contactId: expenseAttendees.contactId,
              name: crmContacts.name,
            })
            .from(expenseAttendees)
            .leftJoin(crmContacts, eq(crmContacts.id, expenseAttendees.contactId))
            .where(inArray(expenseAttendees.expenseId, expenseIds))
        : [];
      const attendeesByExpense = new Map<string, { id: string; name: string | null }[]>();
      for (const r of attendeeRows) {
        if (!attendeesByExpense.has(r.expenseId)) attendeesByExpense.set(r.expenseId, []);
        attendeesByExpense.get(r.expenseId)!.push({ id: r.contactId, name: r.name });
      }
      const enriched = myExpenses.map(e => ({
        ...e,
        attendeeContacts: attendeesByExpense.get(e.id) || [],
      }));

      // Month-to-date spend
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const monthly = myExpenses.filter(e => e.transactionDate && new Date(e.transactionDate) >= startOfMonth && !e.isPersonal);
      const monthlySpend = monthly.reduce((sum, e) => sum + (e.amountPence || 0), 0);
      const pendingReceipts = myExpenses.filter(e => e.status === "pending_receipt").length;

      res.json({
        cardholder: ch,
        card: card || null,
        expenses: enriched,
        summary: {
          monthlySpendPence: monthlySpend,
          monthlyLimitPence: ch.monthlyLimit,
          remainingPence: Math.max(0, ch.monthlyLimit - monthlySpend),
          pendingReceipts,
          totalThisMonth: monthly.length,
        },
      });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Admin: reveal full card details for ANY cardholder (test mode reveals number+cvc)
  app.get("/api/expenses/cardholders/:id/card-details", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const [card] = await db.select().from(stripeCards).where(eq(stripeCards.cardholderId, id)).limit(1);
      if (!card) return res.status(404).json({ error: "No card found for this cardholder" });
      const isTest = stripeKey().startsWith("sk_test_");
      const path = isTest
        ? `/issuing/cards/${card.stripeCardId}?expand[]=number&expand[]=cvc`
        : `/issuing/cards/${card.stripeCardId}`;
      const stripeCard = await stripeRequest("GET", path);
      res.json({
        last4: stripeCard.last4,
        brand: stripeCard.brand,
        expMonth: stripeCard.exp_month,
        expYear: stripeCard.exp_year,
        number: isTest ? stripeCard.number : null,
        cvc: isTest ? stripeCard.cvc : null,
        isTestMode: isTest,
      });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Reveal full card details for the logged-in user (test mode only)
  // In live mode this should switch to Stripe Issuing Elements (client-side reveal)
  app.get("/api/expenses/me/card-details", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Not logged in" });
      const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.userId, userId)).limit(1);
      if (!ch) return res.status(404).json({ error: "No card issued for this user" });
      const [card] = await db.select().from(stripeCards).where(eq(stripeCards.cardholderId, ch.id)).limit(1);
      if (!card) return res.status(404).json({ error: "No card found" });

      // Stripe test-mode: ?expand[]=number&expand[]=cvc returns the full PAN
      const isTest = stripeKey().startsWith("sk_test_");
      const path = isTest
        ? `/issuing/cards/${card.stripeCardId}?expand[]=number&expand[]=cvc`
        : `/issuing/cards/${card.stripeCardId}`;
      const stripeCard = await stripeRequest("GET", path);

      res.json({
        last4: stripeCard.last4,
        brand: stripeCard.brand,
        expMonth: stripeCard.exp_month,
        expYear: stripeCard.exp_year,
        number: isTest ? stripeCard.number : null,
        cvc: isTest ? stripeCard.cvc : null,
        isTestMode: isTest,
      });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Submit a receipt that creates a fresh expense — no Stripe transaction
  // required. Used by the team to claim spend on personal cards. Parses
  // the receipt with Claude vision, infers category, posts to Xero
  // automatically when confidence + category line up.
  const submitUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post("/api/expenses/submit", requireAuth, submitUpload.single("receipt"), async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const file = req.file;
      const userId = (req.session as any)?.userId || (req as any).tokenUserId;
      console.log(`[expenses/submit] start userId=${userId} file=${file?.originalname} bytes=${file?.size} mime=${file?.mimetype}`);
      if (!file) return res.status(400).json({ error: "No receipt uploaded — attach the file as 'receipt'." });
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) return res.status(401).json({ error: "User not found" });

      const { createExpenseFromReceipt } = await import("./expense-from-receipt");
      const result = await createExpenseFromReceipt({
        receiptBytes: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
        submitter: {
          userId: user.id,
          email: user.email || undefined,
          phone: user.phone || undefined,
          displayName: user.name,
        },
        caption: typeof req.body?.note === "string" ? req.body.note : undefined,
        source: "dashboard",
        category: typeof req.body?.category === "string" ? req.body.category : undefined,
        businessPurpose: typeof req.body?.businessPurpose === "string" ? req.body.businessPurpose : undefined,
        attendees: typeof req.body?.attendees === "string" ? req.body.attendees : undefined,
        transactionDate: req.body?.transactionDate ? new Date(req.body.transactionDate) : undefined,
      });
      console.log(`[expenses/submit] done in ${Date.now() - t0}ms ok=${result.ok} expenseId=${result.expenseId} error=${result.error || ""}`);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (e: any) {
      console.error(`[expenses/submit] crashed in ${Date.now() - t0}ms:`, e?.message, e?.stack);
      res.status(500).json({ error: e?.message || "Receipt upload failed" });
    }
  });

  // Upload a receipt for an expense from the web (alternative to WhatsApp photo)
  const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post("/api/expenses/:id/receipt", requireAuth, receiptUpload.single("receipt"), async (req: Request, res: Response) => {
    try {
      const expenseId = String(req.params.id);
      if (!(await userCanAccessExpense(req, expenseId))) return res.status(403).json({ error: "Forbidden" });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
      if (!exp) return res.status(404).json({ error: "Expense not found" });

      const storageKey = `expense-receipts/${expenseId}-${Date.now()}-${file.originalname}`;
      await saveFile(storageKey, file.buffer, file.mimetype, file.originalname);

      await db.insert(expenseReceipts).values({
        expenseId,
        storageKey,
        mimeType: file.mimetype,
        filename: file.originalname,
      });

      // Try to parse the receipt and auto-update the expense
      try {
        const { parseReceiptImage } = await import("./expense-receipt-parser");
        const parsed = await parseReceiptImage({ imageBytes: file.buffer, mimeType: file.mimetype });
        const updates: Record<string, any> = {
          receiptFilename: file.originalname,
          receiptUrl: storageKey,
          updatedAt: new Date(),
        };
        if (parsed.merchant && !exp.merchant) updates.merchant = parsed.merchant;
        if (parsed.category && !exp.category) {
          updates.category = parsed.category;
          const { getCategoryCode } = await import("./expense-categories");
          const code = await getCategoryCode(parsed.category);
          if (code) updates.xeroAccountCode = code;
        }
        if (parsed.totalPence && !exp.amountPence) updates.amountPence = parsed.totalPence;
        await db.update(expenses).set(updates).where(eq(expenses.id, expenseId));
        // Transition to pending_approval via the workflow helper — computes
        // flag reasons + resolves the approver from users.managerId.
        const { submitForApproval } = await import("./expense-approval");
        const userIdForSubmit = (req as any).session?.userId || (req as any).tokenUserId || null;
        await submitForApproval(expenseId, userIdForSubmit);

        // Auto-post to Xero if confidence is high
        if (parsed.confidence === "high" && updates.category) {
          try {
            const { withSystemXero } = await import("./xero-system-session");
            const { postExpenseToXero } = await import("./expense-xero-poster");
            await withSystemXero((session) => postExpenseToXero({ session, expenseId }));
          } catch (e: any) {
            console.warn("[receipt-upload] auto-post to Xero failed:", e?.message);
          }
        }

        res.json({ success: true, parsed, autoposted: parsed.confidence === "high" });
      } catch (e: any) {
        // Receipt saved but parsing failed — let user fix manually
        await db.update(expenses).set({
          receiptFilename: file.originalname,
          receiptUrl: storageKey,
          updatedAt: new Date(),
        }).where(eq(expenses.id, expenseId));
        res.json({ success: true, parsed: null, error: `Saved but parsing failed: ${e?.message}` });
      }
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Bulk receipt upload from the dashboard. Agent drops N receipts at
  // once; each gets parsed, matched to a pending_receipt row (by amount
  // ±£1 + date ±2 days), and either attached to that match or turned
  // into a cardless cash claim if nothing matches. Mirrors the WhatsApp
  // inbound matcher in expense-receipt-handler.ts so both surfaces
  // behave identically.
  const bulkReceiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 20 } });
  app.post("/api/expenses/bulk-receipts", requireAuth, bulkReceiptUpload.array("receipts", 20), async (req: Request, res: Response) => {
    try {
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) return res.status(400).json({ error: "No files uploaded" });

      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not signed in" });

      // Resolve the current user's cardholder + pending rows once.
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      const allCh = await db.select().from(stripeCardholders);
      const ch = allCh.find(c => c.userId === userId)
        || (u?.email ? allCh.find(c => (c.email || "").toLowerCase() === u.email!.toLowerCase()) : undefined);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      let pending: typeof expenses.$inferSelect[] = [];
      if (ch) {
        pending = await db
          .select()
          .from(expenses)
          .where(and(
            eq(expenses.cardholderId, ch.id),
            eq(expenses.status, "pending_receipt"),
            gte(expenses.createdAt, sevenDaysAgo),
          ))
          .orderBy(desc(expenses.transactionDate));
      }

      const { parseReceiptImage } = await import("./expense-receipt-parser");
      const { getCategoryCode } = await import("./expense-categories");
      const { createExpenseFromReceipt } = await import("./expense-from-receipt");

      const used = new Set<string>(); // pending row ids already consumed in this batch
      const results: any[] = [];

      for (const file of files) {
        try {
          const parsed = await parseReceiptImage({ imageBytes: file.buffer, mimeType: file.mimetype });

          // Try to match an unused pending row. Same tolerances as the
          // WhatsApp matcher: ±50p on amount, ±2 days on transaction
          // date. Picks the closest amount match first when tied.
          const txnDate = parsed.date ? new Date(parsed.date) : null;
          const candidates = pending
            .filter(p => !used.has(p.id))
            .filter(p => Math.abs(p.amountPence - parsed.totalPence) <= 100)
            .filter(p => {
              if (!txnDate || !p.transactionDate) return true;
              const diffDays = Math.abs((new Date(p.transactionDate).getTime() - txnDate.getTime()) / (1000 * 60 * 60 * 24));
              return diffDays <= 2;
            })
            .sort((a, b) => Math.abs(a.amountPence - parsed.totalPence) - Math.abs(b.amountPence - parsed.totalPence));

          const target = candidates[0];

          if (target) {
            // Attach to existing pending row — same shape as POST /:id/receipt.
            used.add(target.id);
            const storageKey = `expense-receipts/${target.id}-${Date.now()}-${file.originalname}`;
            await saveFile(storageKey, file.buffer, file.mimetype, file.originalname);
            await db.insert(expenseReceipts).values({
              expenseId: target.id,
              storageKey,
              mimeType: file.mimetype,
              filename: file.originalname,
            });

            const updates: Record<string, any> = {
              receiptFilename: file.originalname,
              receiptUrl: storageKey,
              updatedAt: new Date(),
            };
            if (parsed.merchant && !target.merchant) updates.merchant = parsed.merchant;
            if (parsed.category && !target.category) {
              updates.category = parsed.category;
              const code = await getCategoryCode(parsed.category);
              if (code) updates.xeroAccountCode = code;
            }
            await db.update(expenses).set(updates).where(eq(expenses.id, target.id));
            const { submitForApproval } = await import("./expense-approval");
            await submitForApproval(target.id, userId);

            results.push({
              filename: file.originalname,
              outcome: "matched",
              expenseId: target.id,
              merchant: parsed.merchant,
              amountPence: parsed.totalPence,
              confidence: parsed.confidence,
            });
          } else {
            // No pending row matches — create a cardless cash claim.
            const result = await createExpenseFromReceipt({
              receiptBytes: file.buffer,
              mimeType: file.mimetype,
              filename: file.originalname,
              submitter: {
                cardholderId: ch?.id,
                userId,
                phone: u?.phone || undefined,
                email: u?.email || ch?.email,
                displayName: u?.name || ch?.userName,
              },
              caption: "",
              source: "dashboard-bulk",
            });
            if (result.ok) {
              results.push({
                filename: file.originalname,
                outcome: result.duplicateOf ? "duplicate" : "created",
                expenseId: result.expenseId,
                merchant: result.parsed?.merchant,
                amountPence: result.parsed?.totalPence,
              });
            } else {
              results.push({ filename: file.originalname, outcome: "failed", error: result.error });
            }
          }
        } catch (e: any) {
          results.push({ filename: file.originalname, outcome: "failed", error: e?.message });
        }
      }

      const matched = results.filter(r => r.outcome === "matched").length;
      const created = results.filter(r => r.outcome === "created").length;
      const failed = results.filter(r => r.outcome === "failed").length;
      const duplicates = results.filter(r => r.outcome === "duplicate").length;

      res.json({ ok: true, matched, created, failed, duplicates, results });
    } catch (e: any) {
      console.error("[expenses] bulk-receipts error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Admin overview — totals + per-cardholder breakdown
  app.get("/api/expenses/admin/summary", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const allCh = await db.select().from(stripeCardholders);
      const allExp = await db.select().from(expenses);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthExp = allExp.filter(e => e.transactionDate && new Date(e.transactionDate) >= startOfMonth);

      const totalMonthPence = monthExp.filter(e => !e.isPersonal).reduce((s, e) => s + (e.amountPence || 0), 0);
      const totalMonthCount = monthExp.length;
      const pendingReceipts = allExp.filter(e => e.status === "pending_receipt").length;
      const pendingApproval = allExp.filter(e => e.status === "pending_approval").length;
      const postedToXero = monthExp.filter(e => e.status === "posted_to_xero").length;
      const personalFlagged = monthExp.filter(e => e.isPersonal).length;

      // Spend by cardholder this month
      const byCh = allCh.map(ch => {
        const exps = monthExp.filter(e => e.cardholderId === ch.id && !e.isPersonal);
        const spent = exps.reduce((s, e) => s + (e.amountPence || 0), 0);
        return {
          cardholderId: ch.id,
          name: ch.userName,
          spentPence: spent,
          monthlyLimit: ch.monthlyLimit,
          utilisation: ch.monthlyLimit > 0 ? Math.round((spent / ch.monthlyLimit) * 100) : 0,
          txCount: exps.length,
          status: ch.status,
        };
      }).sort((a, b) => b.spentPence - a.spentPence);

      // Spend by category this month
      const catMap: Record<string, { count: number; pence: number }> = {};
      for (const e of monthExp.filter(e => !e.isPersonal)) {
        const k = e.category || "Uncategorised";
        if (!catMap[k]) catMap[k] = { count: 0, pence: 0 };
        catMap[k].count += 1;
        catMap[k].pence += e.amountPence || 0;
      }
      const byCategory = Object.entries(catMap)
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.pence - a.pence);

      res.json({
        totalMonthPence,
        totalMonthCount,
        pendingReceipts,
        pendingApproval,
        postedToXero,
        personalFlagged,
        cardholderCount: allCh.length,
        activeCards: allCh.filter(c => c.status === "active").length,
        byCardholder: byCh,
        byCategory,
      });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Mark personal — adds to payroll deduction list
  app.patch("/api/expenses/:id/mark-personal", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!(await userCanAccessExpense(req, id))) return res.status(403).json({ error: "Forbidden" });
      await db.update(expenses).set({
        isPersonal: true,
        category: "Personal (deduct from payroll)",
        xeroAccountCode: "910",
        updatedAt: new Date(),
      }).where(eq(expenses.id, String(req.params.id)));
      const { submitForApproval } = await import("./expense-approval");
      const userIdForSubmit = (req as any).session?.userId || (req as any).tokenUserId || null;
      await submitForApproval(id, userIdForSubmit);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Approve & post to Xero (one-click)
  // Approval inbox — what the current user is allowed to act on.
  // Approvers see: rows where approver_user_id matches them, plus (if
  // they're in the fallback pool or admin) rows where approver_user_id
  // is NULL. Grouped by submitter so the UI can show "Layla's pending",
  // "Tom's pending" etc.
  app.get("/api/expenses/pending-approval", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      const { listPendingForApprover } = await import("./expense-approval");
      const rows = await listPendingForApprover(userId);

      // Hydrate with submitter name + cardholder name for display.
      const submitterIds = Array.from(new Set(rows.map(r => r.submitterUserId).filter(Boolean) as string[]));
      const cardholderIds = Array.from(new Set(rows.map(r => r.cardholderId).filter(Boolean) as string[]));
      const [submitters, cardholders] = await Promise.all([
        submitterIds.length > 0
          ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
              .from(usersTable).where(inArray(usersTable.id, submitterIds))
          : Promise.resolve([]),
        cardholderIds.length > 0
          ? db.select().from(stripeCardholders).where(inArray(stripeCardholders.id, cardholderIds))
          : Promise.resolve([]),
      ]);
      const submitterById = new Map(submitters.map(s => [s.id, s]));
      const cardholderById = new Map(cardholders.map(c => [c.id, c]));

      // Hydrate attendees in one query rather than N round-trips.
      const expenseIds = rows.map(r => r.id);
      const attendeeRows = expenseIds.length > 0
        ? await db
            .select({
              expenseId: expenseAttendees.expenseId,
              contactId: expenseAttendees.contactId,
              name: crmContacts.name,
            })
            .from(expenseAttendees)
            .leftJoin(crmContacts, eq(crmContacts.id, expenseAttendees.contactId))
            .where(inArray(expenseAttendees.expenseId, expenseIds))
        : [];
      const attendeesByExpense = new Map<string, { id: string; name: string | null }[]>();
      for (const r of attendeeRows) {
        if (!attendeesByExpense.has(r.expenseId)) attendeesByExpense.set(r.expenseId, []);
        attendeesByExpense.get(r.expenseId)!.push({ id: r.contactId, name: r.name });
      }

      const enriched = rows.map(r => ({
        ...r,
        submitterName: r.submitterUserId ? submitterById.get(r.submitterUserId)?.name : null,
        cardholderName: r.cardholderId ? cardholderById.get(r.cardholderId)?.userName : null,
        attendeeContacts: attendeesByExpense.get(r.id) || [],
      }));
      res.json(enriched);
    } catch (e: any) {
      console.error("[expenses] pending-approval error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Approve a single expense. Sets status + audit fields, then posts to
  // Xero. The Xero post can fail (e.g. not connected) without unwinding
  // the approval — the row sits at status=approved and Wendy can retry
  // the post separately.
  app.post("/api/expenses/:id/approve", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      const expenseId = String(req.params.id);

      const { canApproveExpense } = await import("./expense-approval");
      if (!(await canApproveExpense(userId, expenseId))) {
        return res.status(403).json({ error: "Not authorised to approve this expense" });
      }

      const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
      await db.update(expenses).set({
        status: "approved",
        approvedAt: new Date(),
        approvedByUserId: userId,
        approvalNotes: notes,
        updatedAt: new Date(),
      }).where(eq(expenses.id, expenseId));

      // Auto-post to Xero. Failure leaves the row at approved=true so
      // the post can be retried via /post-to-xero without re-approving.
      let xeroResult: any = null;
      try {
        const { withSystemXero } = await import("./xero-system-session");
        const { postExpenseToXero } = await import("./expense-xero-poster");
        xeroResult = await withSystemXero((session) => postExpenseToXero({ session, expenseId }));
      } catch (e: any) {
        console.warn("[expenses] approve → xero post failed (row stays approved):", e?.message);
        xeroResult = { posted: false, error: e?.message };
      }

      res.json({ success: true, xero: xeroResult });
    } catch (e: any) {
      console.error("[expenses] approve error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Bulk approve — the "approve all clean" button on the inbox. Only
  // approves rows the user actually has permission for; silently skips
  // ones they don't. Returns per-row outcomes.
  app.post("/api/expenses/approve-bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      if (ids.length === 0) return res.status(400).json({ error: "ids array required" });

      const { canApproveExpense } = await import("./expense-approval");
      const { withSystemXero } = await import("./xero-system-session");
      const { postExpenseToXero } = await import("./expense-xero-poster");

      const outcomes: any[] = [];
      for (const id of ids) {
        if (!(await canApproveExpense(userId, id))) {
          outcomes.push({ id, ok: false, error: "not authorised" });
          continue;
        }
        await db.update(expenses).set({
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: userId,
          updatedAt: new Date(),
        }).where(eq(expenses.id, id));
        try {
          const xero = await withSystemXero((session) => postExpenseToXero({ session, expenseId: id }));
          outcomes.push({ id, ok: true, xero });
        } catch (e: any) {
          outcomes.push({ id, ok: true, xero: { posted: false, error: e?.message } });
        }
      }
      const approved = outcomes.filter(o => o.ok).length;
      const posted = outcomes.filter(o => o.xero?.posted).length;
      res.json({ ok: true, approved, posted, outcomes });
    } catch (e: any) {
      console.error("[expenses] approve-bulk error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Reject an expense. Permanent — the row stays for audit, no Xero
  // post, agent can resubmit a corrected version.
  app.post("/api/expenses/:id/reject", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not signed in" });
      const expenseId = String(req.params.id);

      const { canApproveExpense } = await import("./expense-approval");
      if (!(await canApproveExpense(userId, expenseId))) {
        return res.status(403).json({ error: "Not authorised to reject this expense" });
      }
      const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "No reason given";

      await db.update(expenses).set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectedByUserId: userId,
        rejectedReason: reason,
        updatedAt: new Date(),
      }).where(eq(expenses.id, expenseId));

      res.json({ success: true });
    } catch (e: any) {
      console.error("[expenses] reject error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Legacy direct-post-to-Xero — keeps working for admin retries on
  // approved rows whose initial Xero post failed.
  app.post("/api/expenses/:id/post-to-xero", requireAdmin, async (req: Request, res: Response) => {
    try {
      const expenseId = String(req.params.id);
      const { withSystemXero } = await import("./xero-system-session");
      const { postExpenseToXero } = await import("./expense-xero-poster");
      const result = await withSystemXero((session) => postExpenseToXero({ session, expenseId }));
      if (!result) return res.status(400).json({ error: "Xero not connected — admin needs to connect Xero on the Subscriptions page" });
      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[expenses] route error:", e?.message, e?.stack);
      res.status(500).json({ error: e?.message });
    }
  });

  // Stripe webhook — uses raw body captured by express.json verify callback
  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    try {
      const sig = req.headers["stripe-signature"] as string;
      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) return res.status(400).json({ error: "No raw body" });
      await handleStripeWebhook(rawBody, sig);
      res.json({ received: true });
    } catch (e: any) {
      console.error("[stripe-webhook] error:", e?.message);
      res.status(400).json({ error: e?.message });
    }
  });
}
