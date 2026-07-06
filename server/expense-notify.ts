/**
 * Expense notifications via WhatsApp
 * When a card is tapped, prompt the cardholder immediately for a receipt.
 */
import { sendWhatsAppText, getWhatsAppConfig } from "./whatsapp";
import type { StripeCardholder } from "@shared/schema";
import { db } from "./db";
import { expenses, stripeCardholders, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendPushNotification } from "./push-notifications";

function formatAmount(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export async function notifyExpensePending(args: {
  cardholder: StripeCardholder;
  merchant: string;
  amountPence: number;
  transactionId: string;
}): Promise<void> {
  const config = getWhatsAppConfig();
  if (!config?.token || !config?.phoneNumberId) return;

  const phone = args.cardholder.phone?.replace(/\D/g, "");
  if (!phone) return;

  const msg =
    `💳 ${formatAmount(args.amountPence)} at ${args.merchant} just hit your BGP card.\n\n` +
    `Drop me the receipt photo and who you were with, and I'll log it straight into the books. ` +
    `Or reply "personal" to flag it as personal spend.`;

  await sendWhatsAppText(config, phone, msg);
}

/**
 * Tell the submitter their expense was rejected, with the reason, so they can
 * fix it and resubmit. Goes to the person the expense belongs to (cardholder /
 * submitter), NOT the approver who rejected it. Sends WhatsApp (same channel as
 * the card-tap receipt prompt) and an in-app/web push, so it lands whether or
 * not they watch WhatsApp and works for manual claimants with no card.
 * Best-effort: never throws into the reject path.
 */
export async function notifyExpenseRejected(expenseId: string, reason: string): Promise<void> {
  try {
    const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
    if (!exp) return;

    // Resolve who to tell: cardholder (has a phone) and/or the submitter user.
    let phone: string | null = null;
    let userId: string | null = exp.submitterUserId ?? null;
    if (exp.cardholderId) {
      const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, exp.cardholderId)).limit(1);
      phone = ch?.phone ?? null;
      if (!userId) userId = ch?.userId ?? null;
    }
    if (!phone && userId) {
      const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      phone = u?.phone ?? null;
    }

    const amount = formatAmount(exp.amountPence ?? 0);
    const where = exp.merchant ? ` at ${exp.merchant}` : "";

    const config = getWhatsAppConfig();
    const digits = phone?.replace(/\D/g, "");
    if (config?.token && config?.phoneNumberId && digits) {
      const msg =
        `❌ Your expense — ${amount}${where} — was rejected.\n\n` +
        `Reason: ${reason}\n\n` +
        `Please correct it and resubmit. Reply here if you think that's wrong.`;
      await sendWhatsAppText(config, digits, msg)
        .catch((e) => console.warn("[expense-notify] reject WhatsApp failed:", e?.message));
    }

    if (userId) {
      await sendPushNotification(userId, {
        title: "Expense rejected",
        body: `${amount}${where} — ${reason}`,
        tag: `expense-rejected-${expenseId}`,
        url: "/my-expenses",
      }).catch((e) => console.warn("[expense-notify] reject push failed:", e?.message));
    }
  } catch (e: any) {
    console.warn("[expense-notify] notifyExpenseRejected failed:", e?.message);
  }
}
