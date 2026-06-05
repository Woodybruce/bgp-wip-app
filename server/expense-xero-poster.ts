/**
 * Post a finalised expense to Xero as a Spend Money transaction
 * against the Stripe Cards bank account, with receipt attached.
 */
import { xeroApi } from "./xero";
import { db } from "./db";
import { expenses, stripeCardholders, expenseReceipts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { EXPENSE_CATEGORY_MAP } from "./expense-categories";

const STRIPE_CARDS_ACCOUNT_CODE = "1200";

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

  // Prefer the code stamped on the expense at submission/edit time. Only
  // fall back to a category → code lookup for rows submitted before the
  // code stamp existed, or for receipt-parser auto-categorisations that
  // didn't catch the Xero side. Final fallback "900" = Other Expenses
  // so a post never blocks on a missing code.
  let accountCode = exp.xeroAccountCode;
  if (!accountCode && exp.category) {
    const { getCategoryCode } = await import("./expense-categories");
    accountCode = (await getCategoryCode(exp.category)) || EXPENSE_CATEGORY_MAP[exp.category]?.code;
  }
  accountCode = accountCode || "900";
  const amountGbp = exp.amountPence / 100;

  // Build tracking categories — pull live from Xero so we use the right IDs
  const tracking: any[] = [];
  try {
    const cats = await xeroApi(args.session, "/TrackingCategories");
    const trackingCats = cats.TrackingCategories || [];

    if (exp.xeroTrackingProperty) {
      const propCat = trackingCats.find((c: any) => c.Name === "Property / Deal");
      if (propCat) tracking.push({ Name: "Property / Deal", Option: exp.xeroTrackingProperty });
    }
    if (ch?.userName) {
      const teamCat = trackingCats.find((c: any) => c.Name === "Team Member");
      if (teamCat) tracking.push({ Name: "Team Member", Option: ch.userName });
    }
  } catch (e: any) {
    console.warn(`[xero-post] tracking categories lookup failed: ${e?.message}`);
  }

  const description = [
    exp.merchant,
    exp.businessPurpose ? `— ${exp.businessPurpose}` : null,
    exp.attendees ? `(with ${exp.attendees})` : null,
  ].filter(Boolean).join(" ");

  // Spend Money via /BankTransactions
  const body = {
    Type: "SPEND",
    BankAccount: { Code: STRIPE_CARDS_ACCOUNT_CODE },
    Date: exp.transactionDate ? new Date(exp.transactionDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    Reference: exp.merchant?.slice(0, 50) || "BGP Card",
    LineItems: [{
      Description: description || exp.merchant || "BGP card spend",
      UnitAmount: amountGbp,
      AccountCode: accountCode,
      TaxType: deriveTaxType(exp.category),
      Tracking: tracking.length > 0 ? tracking : undefined,
    }],
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

function deriveTaxType(category: string | null): string {
  if (!category) return "INPUT2";
  if (category === "Client Entertainment") return "NONE";
  if (category === "Travel - Flights") return "ZERORATEDINPUT";
  if (["Donations", "Staff Gifts", "Client Gifts", "RICS Fees", "Mileage Claims (HMRC 45p)",
       "Eye Tests", "Flu Jabs & Covid Tests", "Personal (deduct from payroll)"].includes(category)) {
    return "NONE";
  }
  return "INPUT2";
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
