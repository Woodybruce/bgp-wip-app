// Receipts-only expense creation — turn a receipt image/PDF straight
// into an `expenses` row (no Stripe Issuing transaction required). The
// existing Stripe-funded flow stays untouched: that path lands a
// pending_receipt row via the webhook and matches an inbound receipt
// to it. This helper is for the parallel "no card, just submit the
// receipt" path used by the team WhatsApp bot and a new POST
// /api/expenses/submit endpoint.
//
// Idempotent on amount + merchant + date for the same cardholder
// within a 5-minute window — re-sending the same receipt twice (the
// classic "did it send?" double-tap) returns the original row rather
// than creating a duplicate.

import { db, pool } from "./db";
import { stripeCardholders, expenses, expenseReceipts, users } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { saveFile } from "./file-storage";
import { parseReceiptImage, type ParsedReceipt } from "./expense-receipt-parser";
import { EXPENSE_CATEGORY_MAP } from "./stripe-issuing";

export interface CreateFromReceiptArgs {
  receiptBytes: Buffer;
  mimeType: string;
  filename?: string;
  // Who's submitting. Provide whichever you have; we'll resolve to a
  // cardholder row (creating a card-less one if necessary).
  submitter: {
    cardholderId?: string;       // when already known
    userId?: string;              // BGP users.id
    phone?: string;
    email?: string;
    displayName?: string;
  };
  caption?: string;
  source: "whatsapp" | "dashboard" | "email";
  // Optional overrides — caller knows better than the parser.
  category?: string;
  businessPurpose?: string;
  attendees?: string;
  transactionDate?: Date;
}

export interface CreateFromReceiptResult {
  ok: boolean;
  expenseId?: string;
  parsed?: ParsedReceipt;
  cardholderId?: string;
  duplicateOf?: string;            // set when we returned an existing row
  xeroPosted?: boolean;
  xeroError?: string;
  error?: string;
}

export async function createExpenseFromReceipt(args: CreateFromReceiptArgs): Promise<CreateFromReceiptResult> {
  try {
    // 1. Resolve submitter → cardholder row (may be card-less).
    const cardholderId = args.submitter.cardholderId
      || await findOrCreateSubmitter(args.submitter);
    if (!cardholderId) {
      return { ok: false, error: "Couldn't resolve submitter — supply phone/email/userId matching a BGP user." };
    }

    // 2. Parse the receipt.
    const parsed = await parseReceiptImage({
      imageBytes: args.receiptBytes,
      mimeType: args.mimeType,
    });
    if (!parsed.totalPence || parsed.totalPence <= 0) {
      return { ok: false, parsed, cardholderId, error: "Couldn't read a total off this receipt — try a clearer photo." };
    }

    const txnDate = args.transactionDate
      || (parsed.date ? new Date(parsed.date) : new Date());
    const category = args.category || parsed.category;
    const { getCategoryCode } = await import("./expense-categories");
    const xeroCode = category
      ? (await getCategoryCode(category)) || EXPENSE_CATEGORY_MAP[category]?.code
      : undefined;
    const isPersonal = /\bpersonal\b/i.test(args.caption || "");

    // 3. Dedupe — same cardholder + merchant + amount + same transaction
    //    date is almost certainly the same receipt re-uploaded (retries,
    //    accidental double-tap, AI flow trying again). The previous 5-min
    //    createdAt window missed retries spread over a longer demo session.
    //    Wider key, no time window — duplicate receipts always collapse.
    const merchantNorm = (parsed.merchant || "").trim().toLowerCase();
    const txnDateOnly = txnDate.toISOString().slice(0, 10);
    const candidates = await db
      .select()
      .from(expenses)
      .where(and(
        eq(expenses.cardholderId, cardholderId),
        eq(expenses.amountPence, parsed.totalPence),
      ));
    const dupe = candidates.find((e) => {
      const eDate = e.transactionDate ? new Date(e.transactionDate).toISOString().slice(0, 10) : "";
      const eMerchant = (e.merchant || "").trim().toLowerCase();
      if (eDate !== txnDateOnly) return false;
      if (!merchantNorm || !eMerchant) return true;          // missing merchant → still treat as dupe on amount+date
      return eMerchant === merchantNorm;
    });
    if (dupe) {
      return {
        ok: true,
        expenseId: dupe.id,
        cardholderId,
        parsed,
        duplicateOf: dupe.id,
      };
    }

    // 4. Insert the expense. Status starts at pending_receipt; the
    // submitForApproval helper below transitions it to pending_approval
    // after the receipt is persisted so flags compute against the
    // complete row.
    const [inserted] = await db.insert(expenses).values({
      cardholderId,
      type: "cash",                           // non-Stripe submission
      status: "pending_receipt",
      merchant: parsed.merchant || null,
      amountPence: parsed.totalPence,
      currency: parsed.currency || "gbp",
      transactionDate: txnDate,
      category: category || null,
      xeroAccountCode: xeroCode || null,
      businessPurpose: args.businessPurpose || args.caption || null,
      attendees: args.attendees || null,
      isPersonal,
      createdBy: args.submitter.userId || null,
    } as any).returning({ id: expenses.id });

    if (!inserted) return { ok: false, error: "Insert failed" };

    // 5. Persist the receipt bytes into file_storage and the linkage row.
    const ext = (args.mimeType || "image/jpeg").split("/").pop()?.replace("jpeg", "jpg") || "bin";
    const storageKey = `expense-receipts/${inserted.id}-${Date.now()}.${ext}`;
    const fname = args.filename || `receipt_${inserted.id}.${ext}`;
    await saveFile(storageKey, args.receiptBytes, args.mimeType, fname).catch((err: any) =>
      console.warn(`[expense-from-receipt] saveFile failed (non-fatal):`, err?.message)
    );

    await db.insert(expenseReceipts).values({
      expenseId: inserted.id,
      storageKey,
      mimeType: args.mimeType,
      filename: fname,
    });
    await db.update(expenses).set({
      receiptUrl: storageKey,
      receiptFilename: fname,
      updatedAt: new Date(),
    } as any).where(eq(expenses.id, inserted.id));

    // Transition to pending_approval — computes flag reasons + assigns
    // the approver from the submitter's manager.
    const { submitForApproval } = await import("./expense-approval");
    await submitForApproval(inserted.id, args.submitter.userId || null);

    // 6. Auto-post to Xero when category resolved + parser confidence is high.
    let xeroPosted = false;
    let xeroError: string | undefined;
    if (!isPersonal && xeroCode && parsed.confidence !== "low") {
      try {
        const { postExpenseToXero } = await import("./expense-xero-poster");
        const { withSystemXero } = await import("./xero-system-session");
        const posted = await withSystemXero((session) => postExpenseToXero({ session, expenseId: inserted.id }));
        if (posted) {
          xeroPosted = true;
        } else {
          xeroError = "no admin Xero session — sitting in review queue";
        }
      } catch (e: any) {
        xeroError = e?.message;
        console.warn(`[expense-from-receipt] Xero post failed:`, e?.message);
      }
    } else if (isPersonal) {
      xeroError = "marked personal — not posted to Xero";
    }

    return {
      ok: true,
      expenseId: inserted.id,
      cardholderId,
      parsed,
      xeroPosted,
      xeroError,
    };
  } catch (err: any) {
    console.error("[expense-from-receipt]", err?.message, err?.stack);
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Submitter resolution ────────────────────────────────────────────────

// Look up an existing cardholder by phone or email. If none found but the
// submitter matches a BGP `users` row, create a card-less cardholder row
// (stripeCardholderId left null — the schema now allows it) so we have a
// stable id to hang expenses off.
async function findOrCreateSubmitter(s: CreateFromReceiptArgs["submitter"]): Promise<string | null> {
  // 1. Existing cardholder by userId.
  if (s.userId) {
    const [byUser] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.userId, s.userId)).limit(1);
    if (byUser) return byUser.id;
  }

  // 2. Existing cardholder by phone (last 10 digits — strip country code).
  if (s.phone) {
    const tail = s.phone.replace(/\D/g, "").slice(-10);
    if (tail) {
      const allCh = await db.select().from(stripeCardholders);
      const match = allCh.find((c) => (c.phone || "").replace(/\D/g, "").slice(-10) === tail);
      if (match) return match.id;
    }
  }

  // 3. Existing cardholder by email.
  if (s.email) {
    const byEmail = await db.select().from(stripeCardholders).where(eq(stripeCardholders.email, s.email)).limit(1);
    if (byEmail[0]) return byEmail[0].id;
  }

  // 4. No existing cardholder — fall back to BGP users.
  let userRow: typeof users.$inferSelect | undefined;
  if (s.userId) {
    const [u] = await db.select().from(users).where(eq(users.id, s.userId)).limit(1);
    userRow = u || undefined;
  }
  if (!userRow && s.phone) {
    const tail = s.phone.replace(/\D/g, "").slice(-10);
    if (tail) {
      const allUsers = await db.select().from(users);
      userRow = allUsers.find((u) => (u.phone || "").replace(/\D/g, "").slice(-10) === tail);
    }
  }
  if (!userRow && s.email) {
    const [u] = await db.select().from(users).where(eq(users.email, s.email)).limit(1);
    userRow = u || undefined;
  }
  if (!userRow) return null;

  // 5. Create a card-less cardholder row for this user.
  const [created] = await db.insert(stripeCardholders).values({
    userId: userRow.id,
    userName: userRow.name || s.displayName || userRow.username,
    email: userRow.email || s.email || `${userRow.username}@brucegillinghampollard.com`,
    phone: userRow.phone || s.phone || null,
    stripeCardholderId: null,
    status: "active",
  } as any).returning({ id: stripeCardholders.id });
  return created?.id || null;
}

// ─── Schema migration helper ────────────────────────────────────────────

// Stripe Issuing predates this flow — the original schema marked
// stripe_cardholder_id NOT NULL. Relax it so we can write card-less
// submitter rows. Idempotent.
let _migrated = false;
export async function ensureCardlessCardholderColumn(): Promise<void> {
  if (_migrated) return;
  try {
    await pool.query(`ALTER TABLE stripe_cardholders ALTER COLUMN stripe_cardholder_id DROP NOT NULL`);
    _migrated = true;
  } catch (err: any) {
    if (err?.code === "42P01") return;     // table doesn't exist yet — fine
    if (!/does not exist|already/i.test(err?.message || "")) {
      console.warn("[expense-from-receipt] ALTER stripe_cardholders failed:", err?.message);
    }
  }
}
