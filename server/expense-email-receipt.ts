/**
 * Auto-find an email receipt for a pending card expense.
 *
 * Use case (Woody, June 2026): a Revolut card swipe lands as a
 * `pending_receipt` expense (merchant + amount + time), but the receipt
 * itself arrived as an EMAIL — e.g. a parking app (RingGo / JustPark /
 * NCP) emails a confirmation around the time of payment. Rather than
 * forward it to WhatsApp, the user wants the AI to hunt their own inbox
 * around the purchase time, find the matching receipt, and attach it.
 *
 * Strategy, scoped to the cardholder's own mailbox:
 *   1. Pull messages received in a window around the transaction time.
 *   2. For each, try its file attachments (PDF / image) through the same
 *      vision parser the WhatsApp path uses; failing that, parse the
 *      email body text.
 *   3. Match on AMOUNT — the Revolut charge is the source of truth — so a
 *      parsed total within 50p of the expense wins. Closest match is kept.
 *   4. On a match, attach + populate + submit for approval + post to Xero,
 *      mirroring the WhatsApp "match to pending" downstream exactly.
 */
import { db, pool } from "./db";
import { expenses, expenseReceipts, stripeCardholders } from "@shared/schema";
import { eq } from "drizzle-orm";
import { graphRequest } from "./shared-mailbox";
import { parseReceiptImage, type ParsedReceipt } from "./expense-receipt-parser";
import { getAnthropicClient, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";
import { EXPENSE_CATEGORY_MAP } from "./stripe-issuing";

export interface FindEmailReceiptResult {
  ok: boolean;
  found: boolean;
  error?: string;
  scanned: number;       // emails examined
  parsed: number;        // documents actually run through the parser
  amountPence?: number;
  matched?: {
    emailId: string;
    subject: string;
    from: string | null;
    receivedDateTime: string;
    source: "attachment" | "body";
    filename?: string;
  };
  posted?: boolean;
  xeroError?: string;
}

const AMOUNT_TOLERANCE_PENCE = 50;       // 50p — covers rounding / minor FX
const MAX_PARSES = 12;                   // cap vision/text calls per run
const RECEIPT_HINT = /receipt|parking|invoice|payment|paid|booking|confirmation|order|tax\s*invoice|vat/i;

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    .replace(/&#163;/g, "£")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Lightweight text parse of an email body when there's no attachment.
// Returns a ParsedReceipt-shaped object or null.
async function parseReceiptFromText(text: string, categories: string[]): Promise<ParsedReceipt | null> {
  const anthropic = getAnthropicClient();
  const msg = await anthropic.messages.create({
    model: CHATBGP_HELPER_MODEL,
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `This is the text of an email that may be a purchase receipt. If it IS a receipt/payment confirmation, extract the fields as STRICT JSON; if it is NOT a receipt, return {"isReceipt": false}.

{"isReceipt": true, "merchant": "...", "totalPence": <integer pence>, "vatPence": <integer pence or null>, "date": "YYYY-MM-DD or null", "currency": "GBP", "category": "one of: ${categories.join(", ")}"}

Email text:
${text.slice(0, 6000)}`,
    }],
  });
  const raw = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
  try {
    const j = safeParseJSON(raw);
    if (!j || j.isReceipt === false || typeof j.totalPence !== "number") return null;
    return {
      merchant: j.merchant || "(unknown)",
      totalPence: Math.round(j.totalPence),
      vatPence: typeof j.vatPence === "number" ? Math.round(j.vatPence) : undefined,
      date: j.date || undefined,
      currency: j.currency || "GBP",
      category: j.category || "Office Expenses (general)",
      confidence: "medium",
    };
  } catch {
    return null;
  }
}

interface BestMatch {
  parsed: ParsedReceipt;
  msg: any;
  source: "attachment" | "body";
  filename?: string;
  diff: number;
  bytes?: Buffer;
  mimeType?: string;
  html?: string;
}

export async function findEmailReceiptForExpense(
  expenseId: string,
  opts: { hoursBefore?: number; hoursAfter?: number; maxEmails?: number } = {},
): Promise<FindEmailReceiptResult> {
  const hoursBefore = opts.hoursBefore ?? 3;
  const hoursAfter = opts.hoursAfter ?? 24 * 7;        // a week — email receipts can lag
  const maxEmails = Math.min(opts.maxEmails ?? 40, 60);

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!expense) return { ok: false, found: false, error: "Expense not found", scanned: 0, parsed: 0 };
  if (!expense.cardholderId) return { ok: false, found: false, error: "Expense has no cardholder", scanned: 0, parsed: 0 };

  const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, expense.cardholderId)).limit(1);
  const mailbox = ch?.email;
  if (!mailbox) return { ok: false, found: false, error: "No mailbox email on the cardholder", scanned: 0, parsed: 0 };

  const txnDate = expense.transactionDate ? new Date(expense.transactionDate) : new Date(expense.createdAt || Date.now());
  const start = new Date(txnDate.getTime() - hoursBefore * 3600_000).toISOString();
  const end = new Date(txnDate.getTime() + hoursAfter * 3600_000).toISOString();

  // Pull candidate emails, newest first, within the window.
  const listUrl = `/users/${encodeURIComponent(mailbox)}/messages`
    + `?$filter=${encodeURIComponent(`receivedDateTime ge ${start} and receivedDateTime le ${end}`)}`
    + `&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview`
    + `&$orderby=receivedDateTime desc&$top=${maxEmails}`;
  const list = await graphRequest(listUrl).catch((e: any) => {
    throw new Error(`Mailbox search failed: ${e?.message}`);
  });
  const messages: any[] = list?.value || [];

  // Category list for the text-body parser (live Xero chart, falls back).
  let categories: string[];
  try {
    const { getExpenseCategories } = await import("./expense-categories");
    const live = await getExpenseCategories();
    categories = live.length ? live.map((c) => c.name) : Object.keys(EXPENSE_CATEGORY_MAP);
  } catch {
    categories = Object.keys(EXPENSE_CATEGORY_MAP);
  }

  let scanned = 0;
  let parses = 0;
  let best: BestMatch | null = null;
  let bestDiff = Infinity;       // tracked separately to keep CFA simple

  for (const m of messages) {
    if (parses >= MAX_PARSES) break;
    scanned++;
    const subject = m.subject || "";
    const preview = m.bodyPreview || "";
    const hintMatch = RECEIPT_HINT.test(subject) || RECEIPT_HINT.test(preview);

    // 1) Attachments first — strongest signal.
    if (m.hasAttachments) {
      const attRes = await graphRequest(
        `/users/${encodeURIComponent(mailbox)}/messages/${m.id}/attachments?$select=id,name,contentType,size,isInline,contentBytes`,
      ).catch(() => null);
      const atts: any[] = attRes?.value || [];
      for (const att of atts) {
        if (parses >= MAX_PARSES) break;
        if (att["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
        const ct = (att.contentType || "").toLowerCase();
        const isPdf = ct.includes("pdf") || /\.pdf$/i.test(att.name || "");
        const isImg = ct.startsWith("image/") || /\.(png|jpe?g|heic|webp|gif)$/i.test(att.name || "");
        if (!isPdf && !isImg) continue;
        if (att.isInline && isImg && !hintMatch) continue;   // skip inline logos unless email looks receipt-ish
        if (!att.contentBytes) continue;
        const bytes = Buffer.from(att.contentBytes, "base64");
        try {
          parses++;
          const parsed = await parseReceiptImage({ imageBytes: bytes, mimeType: att.contentType || (isPdf ? "application/pdf" : "image/jpeg") });
          const diff = Math.abs(parsed.totalPence - expense.amountPence);
          if (diff <= AMOUNT_TOLERANCE_PENCE && diff < bestDiff) {
            best = { parsed, msg: m, source: "attachment", filename: att.name, diff, bytes, mimeType: att.contentType };
            bestDiff = diff;
            if (diff === 0) break;
          }
        } catch { /* unreadable attachment — skip */ }
      }
      if (best && bestDiff === 0) break;
    }

    // 2) Body fallback — only if the email looks like a receipt and we
    //    haven't already matched it via an attachment.
    if (!best && hintMatch && parses < MAX_PARSES) {
      const full = await graphRequest(
        `/users/${encodeURIComponent(mailbox)}/messages/${m.id}?$select=body`,
      ).catch(() => null);
      const body = full?.body;
      if (body?.content) {
        const text = body.contentType === "html" ? htmlToText(body.content) : String(body.content);
        // Cheap pre-filter: the Revolut amount should appear in the body.
        const pounds = (expense.amountPence / 100).toFixed(2);
        if (text.includes(pounds)) {
          parses++;
          const parsed = await parseReceiptFromText(text, categories);
          if (parsed) {
            const diff = Math.abs(parsed.totalPence - expense.amountPence);
            if (diff <= AMOUNT_TOLERANCE_PENCE && diff < bestDiff) {
              best = { parsed, msg: m, source: "body", diff, html: body.content };
              bestDiff = diff;
            }
          }
        }
      }
    }
  }

  if (!best) {
    return { ok: true, found: false, scanned, parsed: parses, amountPence: expense.amountPence };
  }

  // ── Match found — populate + attach + submit + post (mirrors WhatsApp) ──
  const parsed = best.parsed;

  // Calendar cross-reference for business purpose / attendees.
  let attendees: string | undefined;
  let businessPurpose: string | undefined;
  let calendarEventId: string | undefined;
  let category = parsed.category;
  try {
    const calendar = await import("./expense-calendar-context");
    const ctx = await calendar.findMeetingContext({
      userEmail: mailbox,
      userId: ch.userId,
      when: txnDate,
      baseCategory: parsed.category,
    });
    if (ctx) {
      attendees = ctx.attendees;
      businessPurpose = ctx.subject;
      calendarEventId = ctx.eventId;
      if (ctx.refinedCategory) category = ctx.refinedCategory;
    }
  } catch { /* calendar optional */ }

  const { getCategoryCode } = await import("./expense-categories");
  const xeroCode = (await getCategoryCode(category)) || EXPENSE_CATEGORY_MAP[category]?.code;

  const ext = best.source === "attachment"
    ? (best.filename?.split(".").pop() || (best.mimeType || "").split("/")[1] || "pdf")
    : "html";
  const receiptFilename = `receipt_${expense.id}.${ext}`;

  await db.update(expenses).set({
    merchant: parsed.merchant || expense.merchant,
    category,
    xeroAccountCode: xeroCode,
    businessPurpose: businessPurpose || expense.businessPurpose || undefined,
    attendees: attendees || expense.attendees || undefined,
    calendarEventId: calendarEventId || expense.calendarEventId || undefined,
    receiptFilename,
    updatedAt: new Date(),
  } as any).where(eq(expenses.id, expense.id));

  await db.insert(expenseReceipts).values({
    expenseId: expense.id,
    storageKey: best.source === "attachment" ? best.bytes!.toString("base64") : Buffer.from(best.html || "", "utf8").toString("base64"),
    mimeType: best.source === "attachment" ? (best.mimeType || "application/pdf") : "text/html",
    filename: receiptFilename,
  });

  // Submit for approval (computes flags + approver).
  try {
    const { submitForApproval } = await import("./expense-approval");
    await submitForApproval(expense.id, ch.userId || null);
  } catch (e: any) {
    console.warn(`[email-receipt] submitForApproval failed: ${e?.message}`);
  }

  // Auto-post to Xero (Wendy reviews monthly per policy).
  let posted = false;
  let xeroError: string | undefined;
  try {
    const { postExpenseToXero } = await import("./expense-xero-poster");
    const { withSystemXero } = await import("./xero-system-session");
    const result = await withSystemXero((session) => postExpenseToXero({ session, expenseId: expense.id }));
    posted = !!result;
    if (!result) xeroError = "no admin Xero session — sitting in queue";
  } catch (e: any) {
    xeroError = e?.message;
  }

  return {
    ok: true,
    found: true,
    scanned,
    parsed: parses,
    amountPence: expense.amountPence,
    matched: {
      emailId: best.msg.id,
      subject: best.msg.subject || "(no subject)",
      from: best.msg.from?.emailAddress?.address || null,
      receivedDateTime: best.msg.receivedDateTime,
      source: best.source,
      filename: best.filename,
    },
    posted,
    xeroError,
  };
}

// Periodic retry sweep — receipt emails routinely arrive a few minutes (or
// hours) AFTER the card swipe, so a one-shot search at payment time usually
// misses. This re-tries every pending card expense without a receipt from
// the last 7 days and pushes a notification the moment one is matched.
// Naturally idempotent: a matched expense gets receipt_filename set and
// drops out of the query, so it's never double-notified.
export async function sweepPendingEmailReceipts(): Promise<{ scanned: number; matched: number }> {
  const { rows } = await pool.query<{ id: string; user_id: string | null; amount_pence: number; merchant: string | null }>(
    `SELECT e.id, c.user_id, e.amount_pence, e.merchant
       FROM expenses e
       JOIN stripe_cardholders c ON c.id = e.cardholder_id
      WHERE e.status = 'pending_receipt'
        AND e.receipt_filename IS NULL
        AND c.email IS NOT NULL
        AND e.created_at > now() - interval '7 days'
      ORDER BY e.created_at DESC
      LIMIT 25`,
  );
  let matched = 0;
  for (const r of rows) {
    try {
      const result = await findEmailReceiptForExpense(r.id);
      if (result.found) {
        matched++;
        if (r.user_id) {
          const { sendPushNotification } = await import("./push-notifications");
          const amt = `£${(r.amount_pence / 100).toFixed(2)}`;
          await sendPushNotification(r.user_id, {
            title: `Receipt filed ✓ ${amt}`,
            body: `${result.matched?.subject || r.merchant || "Card payment"}${result.posted ? " — posted to Xero" : ""}`,
            tag: `expense-${r.id}`,
            url: "/my-expenses",
          }).catch(() => {});
        }
      }
    } catch (e: any) {
      console.warn(`[email-receipt sweep] ${r.id}: ${e?.message}`);
    }
  }
  return { scanned: rows.length, matched };
}
