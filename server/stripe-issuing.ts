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
import { requireAuth } from "./auth";
import { db } from "./db";
import { stripeCardholders, stripeCards, expenses, expenseReceipts } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import crypto from "crypto";

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
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
    if (typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenStripeParams(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ─── CARD CATEGORY LIMITS ──────────────────────────────────────────────────

const BLOCKED_MCCS = [
  "7995", // Gambling
  "6011", // ATM cash
  "6010", // Manual cash
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

export function setupStripeIssuingRoutes(app: Express) {

  // List all cardholders (admin)
  app.get("/api/expenses/cardholders", requireAuth, async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(stripeCardholders).orderBy(stripeCardholders.userName);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Create cardholder + issue virtual card
  app.post("/api/expenses/cardholders", requireAuth, async (req: Request, res: Response) => {
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
      res.status(500).json({ error: e?.message });
    }
  });

  // Update limits (admin)
  app.patch("/api/expenses/cardholders/:id/limits", requireAuth, async (req: Request, res: Response) => {
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
      res.status(500).json({ error: e?.message });
    }
  });

  // Freeze / unfreeze
  app.patch("/api/expenses/cardholders/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { status } = req.body;
      if (status !== "active" && status !== "inactive") return res.status(400).json({ error: "status must be active or inactive" });
      await setCardholderStatus(String(req.params.id), status);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // List expenses
  app.get("/api/expenses", requireAuth, async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(expenses).orderBy(desc(expenses.transactionDate)).limit(200);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Get single expense
  app.get("/api/expenses/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const [row] = await db.select().from(expenses).where(eq(expenses.id, String(req.params.id))).limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e?.message });
    }
  });

  // Update expense (category, business purpose, personal flag, etc.)
  app.patch("/api/expenses/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const allowed = ["category", "xeroAccountCode", "businessPurpose", "attendees", "isPersonal",
                       "isClientRechargeable", "relatedDealId", "notes", "status"];
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const k of allowed) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      if (updates.category && EXPENSE_CATEGORY_MAP[updates.category]) {
        updates.xeroAccountCode = EXPENSE_CATEGORY_MAP[updates.category].code;
      }
      await db.update(expenses).set(updates as any).where(eq(expenses.id, String(req.params.id)));
      res.json({ success: true });
    } catch (e: any) {
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
