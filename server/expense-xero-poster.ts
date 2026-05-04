/**
 * Post a finalised expense to Xero as a Spend Money transaction
 * against the Stripe Cards bank account, with receipt attached.
 */
import { xeroApi } from "./xero";
import { db } from "./db";
import { expenses, stripeCardholders, expenseReceipts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { EXPENSE_CATEGORY_MAP } from "./stripe-issuing";

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

  const accountCode = exp.xeroAccountCode || (exp.category && EXPENSE_CATEGORY_MAP[exp.category]?.code) || "900";
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

  // For now: receipt body is stored at receipt.storageKey as a base64 string or path.
  // Xero attachment endpoint: PUT /BankTransactions/{ID}/Attachments/{filename}
  // Body: raw bytes of the file with appropriate Content-Type.
  // This will be wired once we finalise receipt storage (object storage vs DB blob).
  console.log(`[xero-post] receipt attach pending — txn ${xeroTransactionId}, receipt ${receipt.id}`);
}
