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
 *
 * Discriminating receipts from non-receipts: only PDFs with ≤2 pages OR
 * images go down the receipt path. Multi-page PDFs (brochures, leases,
 * HoTs, anything substantial) fall straight through to ChatBGP /
 * document handling — receipts are never multi-page in practice.
 */
import { db } from "./db";
import { stripeCardholders, expenses, expenseReceipts, users } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { parseReceiptImage } from "./expense-receipt-parser";
import { EXPENSE_CATEGORY_MAP } from "./expense-categories";
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

// Receipts are single-page in the real world. Anything bigger is almost
// certainly a brochure / lease / HoT and should flow to other handlers.
const RECEIPT_MAX_PAGES = 2;

async function looksLikeReceipt(bytes: Buffer, mimeType: string | undefined): Promise<boolean> {
  const mt = (mimeType || "").toLowerCase();
  // Images: always plausible as a receipt. PDFs: only if 1-2 pages.
  if (mt.startsWith("image/") || mt === "image" || mt === "" || /^image\//i.test(mt)) {
    return true;
  }
  // PDF magic %PDF- or explicit mime.
  const isPdf = mt.includes("pdf") || (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  if (!isPdf) return true;        // unknown format — let the parser try
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount() <= RECEIPT_MAX_PAGES;
  } catch {
    return true;                  // can't read it — let the parser have a go
  }
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

    // Pull the bytes once; we need them for both the receipt sniff and
    // the parse (and we'll save a redundant Graph download).
    const { downloadWhatsAppMedia } = await import("./whatsapp");
    const { bytes, mimeType } = await downloadWhatsAppMedia(args.mediaId, args.config.token!);

    // Filter out obvious non-receipts (multi-page PDFs are brochures /
    // leases / HoTs / pitch decks). Fall through so the document
    // pipeline handles them.
    if (!(await looksLikeReceipt(bytes, mimeType))) {
      return false;
    }

    await args.sendReply("📸 Got it — reading the receipt...");
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
      // Soft failure ("no total" etc.) — almost certainly means the
      // document isn't actually a receipt. Fall through silently so
      // ChatBGP / brochure ingest get a shot at it.
      console.warn(`[expense-receipt] soft-fail, falling through: ${result.error}`);
      return false;
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
        userId: ch.userId,
        when: target.transactionDate,
        baseCategory: parsed.category,
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

  const { getCategoryCode } = await import("./expense-categories");
  const xeroCode = (await getCategoryCode(refinedCategory)) || EXPENSE_CATEGORY_MAP[refinedCategory]?.code;

  // Update the expense (without status — submitForApproval handles that
  // along with flag-computation and approver assignment).
  await db.update(expenses).set({
    merchant: parsed.merchant || target.merchant,
    category: refinedCategory,
    xeroAccountCode: xeroCode,
    businessPurpose: businessPurpose || args.caption || undefined,
    attendees,
    calendarEventId,
    transactionDate: target.transactionDate || (parsed.date ? new Date(parsed.date) : new Date()),
    isPersonal: /\bpersonal\b/i.test(args.caption),
    vatPence: parsed.vatPence ?? null,
    vatRate: parsed.vatRate ?? null,
    netPence: parsed.netPence ?? null,
    receiptFilename: `receipt_${target.id}.${(mimeType || "image/jpeg").split("/")[1]}`,
    updatedAt: new Date(),
  } as any).where(eq(expenses.id, target.id));

  // Store the receipt bytes (base64 for now — object storage TBD)
  await db.insert(expenseReceipts).values({
    expenseId: target.id,
    storageKey: bytes.toString("base64"),
    mimeType,
    filename: `receipt_${target.id}.${(mimeType || "image/jpeg").split("/")[1]}`,
  });

  // Submit to approval workflow — computes flags + resolves approver.
  // Submitter resolved from cardholder.userId by the helper.
  const { submitForApproval } = await import("./expense-approval");
  await submitForApproval(target.id, null);

  // No auto-post — the initial pass goes via Wendy first. Sits in her approval
  // queue until signed off, then posts to Xero.
  const xeroResult: { posted: boolean; error?: string } = { posted: false, error: "awaiting approval" };

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

