/**
 * WhatsApp inbound photo → match to pending expense, parse, populate, post to Xero.
 *
 * Two paths:
 *   1. Stripe-funded: the sender is a registered cardholder with a pending
 *      receipt — match the photo to the existing expense row, update + post.
 *   2. Receipts-only: no card, or no pending row — create a fresh expense
 *      from the parsed receipt via `createExpenseFromReceipt`. Either the
 *      sender's phone matches a BGP user (we'll auto-create a card-less
 *      cardholder), or the sender isn't on the team and we bail out so
 *      the photo flows to ChatBGP.
 */
import { db } from "./db";
import { stripeCardholders, expenses, expenseReceipts, users } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { parseReceiptImage } from "./expense-receipt-parser";
import { EXPENSE_CATEGORY_MAP } from "./stripe-issuing";
import { createExpenseFromReceipt } from "./expense-from-receipt";

interface MatchArgs {
  fromNumber: string;
  contactName: string;
  mediaId: string;
  mediaType: "image" | "document";
  caption: string;
  config: { token?: string; phoneNumberId?: string };
  sendReply: (text: string) => Promise<any>;
}

export async function tryMatchReceiptToExpense(args: MatchArgs): Promise<boolean> {
  const phoneTail = args.fromNumber.replace(/\D/g, "").slice(-10);

  // Look up cardholder by phone (last 10 digits, ignore country code)
  const allCardholders = await db.select().from(stripeCardholders);
  const ch = allCardholders.find((c) => (c.phone || "").replace(/\D/g, "").slice(-10) === phoneTail);

  // Find any pending_receipt expense within 7 days — only relevant when the
  // sender is a registered cardholder. Stripe-funded path requires this.
  let pending: typeof expenses.$inferSelect[] = [];
  if (ch) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    pending = await db
      .select()
      .from(expenses)
      .where(and(
        eq(expenses.cardholderId, ch.id),
        eq(expenses.status, "pending_receipt"),
        gte(expenses.createdAt, sevenDaysAgo),
      ))
      .orderBy(desc(expenses.transactionDate))
      .limit(5);
  }

  // ── Receipts-only path ────────────────────────────────────────────────
  // No matching cardholder, OR cardholder with no pending Stripe txn:
  // create a fresh expense from the receipt provided we can confirm the
  // sender is on the BGP team (phone matches users.phone). Anything else
  // falls through so the photo flows to ChatBGP.
  if (!ch || pending.length === 0) {
    const allUsers = phoneTail ? await db.select().from(users) : [];
    const matchingUser = phoneTail
      ? allUsers.find((u) => (u.phone || "").replace(/\D/g, "").slice(-10) === phoneTail)
      : undefined;
    if (!matchingUser && !ch) {
      // Sender isn't a cardholder and isn't a known user — not a receipt.
      return false;
    }

    await args.sendReply("📸 Got it — reading the receipt...");
    const { downloadWhatsAppMedia } = await import("./whatsapp");
    const { bytes, mimeType } = await downloadWhatsAppMedia(args.mediaId, args.config.token!);
    const result = await createExpenseFromReceipt({
      receiptBytes: bytes,
      mimeType,
      filename: `whatsapp-${args.mediaId}.${(mimeType || "image/jpeg").split("/")[1] || "jpg"}`,
      submitter: {
        cardholderId: ch?.id,
        userId: matchingUser?.id,
        phone: args.fromNumber,
        email: matchingUser?.email || ch?.email,
        displayName: args.contactName,
      },
      caption: args.caption,
      source: "whatsapp",
    });

    if (!result.ok) {
      await args.sendReply(`❌ Couldn't process that receipt: ${result.error || "unknown error"}`);
      return true;        // we handled it (with a fail message) — don't fall through
    }
    if (result.duplicateOf) {
      await args.sendReply(`👍 Already logged — same merchant + amount went in moments ago.`);
      return true;
    }

    const p = result.parsed!;
    const amountStr = `£${(p.totalPence / 100).toFixed(2)}`;
    const lines = [
      `✅ Logged ${amountStr} at ${p.merchant || "(no merchant)"}`,
      p.category ? `Category: ${p.category}` : null,
      p.vatPence ? `VAT: £${(p.vatPence / 100).toFixed(2)}` : null,
      result.xeroPosted ? "Posted to Xero ✓" : (result.xeroError ? `Review queue — ${result.xeroError}` : "In review queue"),
    ].filter(Boolean);
    await args.sendReply(lines.join("\n"));
    return true;
  }

  await args.sendReply("📸 Got it — reading the receipt...");

  // Download the media
  const { downloadWhatsAppMedia } = await import("./whatsapp");
  const { bytes, mimeType } = await downloadWhatsAppMedia(args.mediaId, args.config.token!);

  // Parse with Claude vision
  const parsed = await parseReceiptImage({ imageBytes: bytes, mimeType });

  // Match to one of the pending expenses by amount (within 50p tolerance)
  // If only one pending, use that. If many, match by amount.
  let target = pending.length === 1
    ? pending[0]
    : pending.find((e) => Math.abs(e.amountPence - parsed.totalPence) <= 50)
      ?? pending[0];

  // Cross-reference calendar for business purpose
  let attendees: string | undefined;
  let businessPurpose: string | undefined;
  let calendarEventId: string | undefined;
  let refinedCategory = parsed.category;

  if (target.transactionDate) {
    try {
      const calendar = await import("./expense-calendar-context");
      const ctx = await calendar.findMeetingContext({
        userEmail: ch.email,
        when: target.transactionDate,
      });
      if (ctx) {
        attendees = ctx.attendees;
        businessPurpose = ctx.subject;
        calendarEventId = ctx.eventId;
        if (ctx.refinedCategory) refinedCategory = ctx.refinedCategory;
      }
    } catch (e: any) {
      console.warn(`[expense-receipt] calendar lookup failed: ${e?.message}`);
    }
  }

  // Honour caption hints
  if (/\bpersonal\b/i.test(args.caption)) {
    refinedCategory = "Personal (deduct from payroll)";
  }

  const xeroCode = EXPENSE_CATEGORY_MAP[refinedCategory]?.code;

  // Update the expense
  await db.update(expenses).set({
    merchant: parsed.merchant || target.merchant,
    category: refinedCategory,
    xeroAccountCode: xeroCode,
    businessPurpose: businessPurpose || args.caption || undefined,
    attendees,
    calendarEventId,
    transactionDate: target.transactionDate || (parsed.date ? new Date(parsed.date) : new Date()),
    isPersonal: /\bpersonal\b/i.test(args.caption),
    receiptFilename: `receipt_${target.id}.${(mimeType || "image/jpeg").split("/")[1]}`,
    status: "pending_approval",
    updatedAt: new Date(),
  } as any).where(eq(expenses.id, target.id));

  // Store the receipt bytes (base64 for now — object storage TBD)
  await db.insert(expenseReceipts).values({
    expenseId: target.id,
    storageKey: bytes.toString("base64"),
    mimeType,
    filename: `receipt_${target.id}.${(mimeType || "image/jpeg").split("/")[1]}`,
  });

  // Auto-post to Xero (Wendy reviews monthly per policy)
  let xeroResult: { posted: boolean; error?: string } = { posted: false };
  try {
    const { postExpenseToXero } = await import("./expense-xero-poster");
    const { withSystemXero } = await import("./xero-system-session");
    const result = await withSystemXero((session) => postExpenseToXero({ session, expenseId: target.id }));
    if (result) {
      xeroResult.posted = true;
    } else {
      xeroResult.error = "no admin Xero session — sitting in queue for manual post";
    }
  } catch (e: any) {
    xeroResult.error = e?.message;
    console.warn(`[expense-receipt] Xero post failed: ${e?.message}`);
  }

  // Reply
  const amountStr = `£${(target.amountPence / 100).toFixed(2)}`;
  const lines = [
    `✅ Logged ${amountStr} at ${parsed.merchant || target.merchant}`,
    `Category: ${refinedCategory}`,
    attendees ? `With: ${attendees}` : null,
    businessPurpose ? `Re: ${businessPurpose}` : null,
    parsed.vatPence ? `VAT: £${(parsed.vatPence / 100).toFixed(2)}` : null,
    xeroResult.posted ? "Posted to Xero ✓" : "In review queue",
  ].filter(Boolean);
  await args.sendReply(lines.join("\n"));

  return true;
}

