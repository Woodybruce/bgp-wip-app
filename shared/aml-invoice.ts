// No invoice until the AML checks are complete (Jack, 27 November 2026: "Our
// internal blocks need to be at invoice stage. I.e we cant invoice until check
// complete"). BGP cannot stop a client exchanging, so its own hold is on the
// invoice: no draft is made and none is approved while a party is not cleared.
// Which parties count follows the checks the transaction needs: every party on
// a sale, a purchase or a letting; BGP's own client alone on advisory work
// (a rent review, dilapidations, a service charge), where the other side is
// not checked. A party marked Not required counts as done.

export const AML_INVOICE_BLOCK_CODE = "AML_NOT_COMPLETE";

export interface InvoiceBlockParty { role: string; name: string; reason: string }

/** The parties whose checks hold the invoice. */
export function invoiceBlockParties(input: { notReady: InvoiceBlockParty[]; advisory: boolean; clientRole: string | null }): InvoiceBlockParty[] {
  if (!input.advisory) return input.notReady;
  return input.notReady.filter(p => !!input.clientRole && p.role === input.clientRole);
}

/** The refusal's words, safe for anyone at BGP to read. */
export function invoiceBlockWords(parties: InvoiceBlockParty[]): string {
  const names = parties.slice(0, 3).map(p => p.name).join(", ");
  return `No invoice until the AML checks are complete: ${names}${parties.length > 3 ? ` and ${parties.length - 3} more` : ""} ${parties.length === 1 ? "is" : "are"} not cleared yet. Finish the checks on the transaction's Parties & AML, then invoice.`;
}
