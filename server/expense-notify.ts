/**
 * Expense notifications via WhatsApp
 * When a card is tapped, prompt the cardholder immediately for a receipt.
 */
import { sendWhatsAppText, getWhatsAppConfig } from "./whatsapp";
import type { StripeCardholder } from "@shared/schema";

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
