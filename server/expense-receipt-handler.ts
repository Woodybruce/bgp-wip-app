/**
 * WhatsApp inbound photo → match to pending expense, parse, populate, post to Xero.
 */
import { db } from "./db";
import { stripeCardholders, expenses, expenseReceipts } from "@shared/schema";
import { eq, and, desc, gte, isNull } from "drizzle-orm";
import { parseReceiptImage } from "./expense-receipt-parser";
import { EXPENSE_CATEGORY_MAP } from "./stripe-issuing";

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
  // Look up cardholder by phone (last 10 digits, ignore country code)
  const phoneTail = args.fromNumber.replace(/\D/g, "").slice(-10);
  const allCardholders = await db.select().from(stripeCardholders);
  const ch = allCardholders.find((c) => (c.phone || "").replace(/\D/g, "").slice(-10) === phoneTail);

  if (!ch) {
    // Not a registered cardholder — let the photo flow to other handlers
    return false;
  }

  // Find the most recent pending_receipt expense for this cardholder (within 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pending = await db
    .select()
    .from(expenses)
    .where(and(
      eq(expenses.cardholderId, ch.id),
      eq(expenses.status, "pending_receipt"),
      gte(expenses.createdAt, sevenDaysAgo),
    ))
    .orderBy(desc(expenses.transactionDate))
    .limit(5);

  if (pending.length === 0) {
    // No pending expenses — let other handlers take it
    return false;
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
    // Need an admin session to post. Look up the admin Xero session.
    const adminSession = await getAdminXeroSession();
    if (adminSession) {
      await postExpenseToXero({ session: adminSession, expenseId: target.id });
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

async function getAdminXeroSession(): Promise<any | null> {
  // Best-effort: pull the most recent session with a Xero token from sessions table.
  // For now: returns null in dev. Wired up properly once we add an admin-session
  // service-account pattern. This means transactions stay in pending_approval
  // until a logged-in admin triggers the post.
  return null;
}
