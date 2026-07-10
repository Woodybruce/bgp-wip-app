/**
 * Post a finalised expense to Xero as a Spend Money transaction against the
 * Stripe/Revolut Cards bank account, with receipt attached.
 *
 * Handles VAT and splits:
 *   - VAT treatment per line comes from the category's Xero tax type
 *     (reclaimable 20%/5%/0%) unless the per-expense/per-split vatReclaimable
 *     override forces it to NONE — i.e. the VAT becomes part of the cost
 *     (client entertainment etc.). The actual VAT read off the receipt is
 *     passed through as the line TaxAmount so Xero matches the paperwork.
 *   - A split expense posts one Xero line per split, each with its own
 *     account code, tax type and "Team Member" tracking (the person the cost
 *     is allocated to). An unsplit expense posts a single line off the parent.
 */
import { xeroApi } from "./xero";
import { db } from "./db";
import { expenses, stripeCardholders, expenseReceipts, expenseSplits, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  EXPENSE_CATEGORY_MAP, getCategoryCode, getCategoryTaxType, isCategoryVatReclaimable, isKnownExpenseCode,
} from "./expense-categories";

// Card spend posts here as a Xero "Spend Money" bank transaction, so this
// must be a BANK-type account. 1230 is a dedicated, app-owned card account
// (the app is its only source — see xero-chart-setup.ts) so card spend stays
// out of the main bank account's (1200) reconciliation. Wendy must create
// 1230 as a Bank Account in Xero for posts to land.
const STRIPE_CARDS_ACCOUNT_CODE = "1230";

// Xero requires a Contact on every SPEND bank transaction — without one the
// API rejects the whole post with "A Contact must be specified for this type
// of transaction" (the error blocking the Revolut card-expense queue). Card
// spend reconciles against a single supplier contact rather than one per
// merchant: it keeps Xero's supplier ledger clean and matches how the card
// feed is reconciled. Xero find-or-creates this contact by name on first post.
const CARD_SPEND_XERO_CONTACT = "Revolut Expenses";

export async function postExpenseToXero(args: {
  session: any;
  expenseId: string;
}): Promise<{ xeroTransactionId: string }> {
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, args.expenseId)).limit(1);
  if (!exp) throw new Error(`Expense ${args.expenseId} not found`);
  if (exp.xeroExpenseId) throw new Error(`Expense already posted to Xero: ${exp.xeroExpenseId}`);

  const [ch] = exp.cardholderId
    ? await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, exp.cardholderId)).limit(1)
    : [null];

  // Split lines, if any (sorted for stable display order).
  const splits = await db.select().from(expenseSplits)
    .where(eq(expenseSplits.expenseId, exp.id)).orderBy(expenseSplits.sortOrder);

  // Resolve names for any allocated-to users so the "Team Member" tracking can
  // point at the person the cost is for, not just whoever's card paid.
  const allocateIds = Array.from(new Set(
    [exp.allocatedToUserId, ...splits.map(s => s.allocatedToUserId)].filter(Boolean) as string[],
  ));
  const userById = new Map<string, string>();
  if (allocateIds.length > 0) {
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, allocateIds));
    for (const r of rows) userById.set(r.id, r.name);
  }
  const cardholderName = ch?.userName || null;
  const teamMemberFor = (allocatedToUserId: string | null | undefined): string | null =>
    (allocatedToUserId ? userById.get(allocatedToUserId) : null) || cardholderName;

  // Which tracking categories exist in Xero — pull live so we use real names.
  let hasPropertyCat = false;
  let hasTeamCat = false;
  try {
    const cats = await xeroApi(args.session, "/TrackingCategories");
    const trackingCats = cats.TrackingCategories || [];
    hasPropertyCat = trackingCats.some((c: any) => c.Name === "Property / Deal");
    hasTeamCat = trackingCats.some((c: any) => c.Name === "Team Member");
  } catch (e: any) {
    console.warn(`[xero-post] tracking categories lookup failed: ${e?.message}`);
  }
  const buildTracking = (teamMember: string | null): any[] | undefined => {
    const t: any[] = [];
    if (hasPropertyCat && exp.xeroTrackingProperty) t.push({ Name: "Property / Deal", Option: exp.xeroTrackingProperty });
    if (hasTeamCat && teamMember) t.push({ Name: "Team Member", Option: teamMember });
    return t.length > 0 ? t : undefined;
  };

  // Build one Xero line from a category + amount + VAT inputs.
  const buildLine = async (opts: {
    category: string | null;
    accountCode: string | null;
    amountPence: number;
    vatPence: number | null;
    vatReclaimable: boolean | null;
    allocatedToUserId: string | null;
    description: string;
  }) => {
    let accountCode = opts.accountCode
      || (opts.category ? await getCategoryCode(opts.category) : null)
      || (opts.category ? EXPENSE_CATEGORY_MAP[opts.category]?.code : null)
      || exp.xeroAccountCode || "900";
    // Guard: never post a code Xero doesn't recognise. If the resolved code
    // isn't in the live chart (or our static map), re-resolve from the
    // category name; if it still isn't recognised, fail with the reason
    // rather than letting Xero bounce the whole batch with a cryptic error.
    if (!(await isKnownExpenseCode(accountCode))) {
      const reResolved = opts.category ? await getCategoryCode(opts.category) : undefined;
      if (reResolved && (await isKnownExpenseCode(reResolved))) {
        accountCode = reResolved;
      } else {
        throw new Error(
          `Expense category "${opts.category || exp.category || "(none)"}" maps to Xero code "${accountCode}", which isn't in your Xero chart of accounts. Set a valid category before posting.`,
        );
      }
    }
    const reclaimable = await isCategoryVatReclaimable(opts.category, opts.vatReclaimable);
    const taxType = reclaimable ? await getCategoryTaxType(opts.category) : "NONE";
    const line: any = {
      Description: opts.description || exp.merchant || "BGP card spend",
      UnitAmount: opts.amountPence / 100,
      AccountCode: accountCode,
      TaxType: taxType,
      Tracking: buildTracking(teamMemberFor(opts.allocatedToUserId)),
    };
    // Pass the receipt's actual VAT through so Xero matches the paperwork.
    // Non-reclaimable → 0 (VAT folds into the cost). Reclaimable with a parsed
    // VAT figure → that figure. Otherwise omit and let Xero compute the rate.
    if (!reclaimable) line.TaxAmount = 0;
    else if (opts.vatPence != null && opts.vatPence > 0) line.TaxAmount = opts.vatPence / 100;
    return line;
  };

  let lineItems: any[];
  if (splits.length > 0) {
    lineItems = [];
    for (const s of splits) {
      lineItems.push(await buildLine({
        category: s.category,
        accountCode: s.xeroAccountCode,
        amountPence: s.amountPence,
        vatPence: s.vatPence ?? null,
        vatReclaimable: s.vatReclaimable ?? null,
        allocatedToUserId: s.allocatedToUserId ?? null,
        description: [s.businessPurpose, s.category].filter(Boolean).join(" — "),
      }));
    }
  } else {
    const description = [
      exp.merchant,
      exp.businessPurpose ? `— ${exp.businessPurpose}` : null,
      exp.attendees ? `(with ${exp.attendees})` : null,
    ].filter(Boolean).join(" ");
    lineItems = [await buildLine({
      category: exp.category,
      accountCode: exp.xeroAccountCode,
      amountPence: exp.amountPence,
      vatPence: exp.vatPence ?? null,
      vatReclaimable: exp.vatReclaimable ?? null,
      allocatedToUserId: exp.allocatedToUserId ?? null,
      description,
    })];
  }

  // Spend Money via /BankTransactions. LineAmountTypes=Inclusive: the amounts
  // are gross (what actually left the card), matching the receipt total.
  const body = {
    Type: "SPEND",
    Contact: { Name: CARD_SPEND_XERO_CONTACT },
    BankAccount: { Code: STRIPE_CARDS_ACCOUNT_CODE },
    Date: exp.transactionDate ? new Date(exp.transactionDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    Reference: exp.merchant?.slice(0, 50) || "BGP Card",
    LineAmountTypes: "Inclusive",
    LineItems: lineItems,
    Status: "AUTHORISED",
  };

  const result = await xeroApi(args.session, "/BankTransactions", {
    method: "PUT",
    body: JSON.stringify(body),
  });

  const xeroTxn = result.BankTransactions?.[0];
  if (!xeroTxn?.BankTransactionID) throw new Error(`Xero did not return a transaction ID: ${JSON.stringify(result).slice(0, 300)}`);

  // Mark expense as posted
  await db.update(expenses).set({
    xeroExpenseId: xeroTxn.BankTransactionID,
    status: "posted_to_xero",
    updatedAt: new Date(),
  }).where(eq(expenses.id, args.expenseId));

  // Attach receipt if we have one
  await attachReceiptToXero(args.session, args.expenseId, xeroTxn.BankTransactionID).catch((e) => {
    console.warn(`[xero-post] receipt attach failed: ${e?.message}`);
  });

  return { xeroTransactionId: xeroTxn.BankTransactionID };
}

async function attachReceiptToXero(session: any, expenseId: string, xeroTransactionId: string): Promise<void> {
  const [receipt] = await db.select().from(expenseReceipts).where(eq(expenseReceipts.expenseId, expenseId)).limit(1);
  if (!receipt) return;

  // Two storage shapes co-exist:
  //  - Dashboard / bulk uploads write the file to file_storage and put the
  //    key (e.g. "expense-receipts/<id>-<ts>-<name>") into receipt.storageKey.
  //  - The historical WhatsApp inbound path inlines the base64 bytes in
  //    receipt.storageKey directly (no file_storage row). Detected here by
  //    the absence of the expense-receipts/ prefix.
  let bytes: Buffer | null = null;
  let contentType = receipt.mimeType || "image/jpeg";
  if (receipt.storageKey?.startsWith("expense-receipts/")) {
    const { getFile } = await import("./file-storage");
    const file = await getFile(receipt.storageKey);
    if (file) {
      bytes = file.data;
      contentType = file.contentType || contentType;
    }
  } else if (receipt.storageKey) {
    // Treat as inline base64 (the legacy WhatsApp path).
    try { bytes = Buffer.from(receipt.storageKey, "base64"); } catch { /* fall through to skip */ }
  }
  if (!bytes || bytes.length === 0) {
    console.warn(`[xero-post] receipt ${receipt.id} has no bytes — skipping attach`);
    return;
  }

  // Xero attachment endpoint: PUT /BankTransactions/{ID}/Attachments/{filename}
  // Body: raw file bytes with the correct Content-Type. Filename gets URL
  // encoded — it's used by Xero as the display name in the attachment list.
  const safeFilename = (receipt.filename || `receipt-${receipt.id}.${(contentType.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "")}`)
    .replace(/[^\w.\- ]+/g, "_")
    .slice(0, 100);
  const path = `/BankTransactions/${xeroTransactionId}/Attachments/${encodeURIComponent(safeFilename)}`;

  await xeroApi(session, path, {
    method: "PUT",
    body: bytes as any,
    headers: { "Content-Type": contentType },
  });
  console.log(`[xero-post] receipt attached to ${xeroTransactionId} (${safeFilename}, ${bytes.length} bytes)`);
}
