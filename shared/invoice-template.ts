// The words on a deal's Xero invoice (Layla O'Driscoll to Woody, 20 November
// 2026: "This is the template I use for majority of invoices – would be great
// if it could autofill over to Xero!"). Her template, as she sent it:
//
//   Customer Reference: FAO NAME
//   TENANT
//   ADDRESS
//   PO –
//   To: Acting on behalf of LANDLORD, in negotiating a new letting to TENANT
//   in respect of the above property.
//   To: Fee ?% of the agreed annual rent of £? = £? plus VAT
//
// It is filled from the deal for a New Letting where BGP acts for the
// landlord. Every other deal keeps the words it had (the deal's name), to be
// typed over before the draft goes to Xero. A figure the deal does not hold
// stays a "?" and a name stays the template's word, as in her template, and
// the form lists what is missing. Nothing here decides the amount: it is the
// deal's fee unless a person types another.
import type { DealPartyRole } from "./deal-parties";

export interface InvoiceTemplateFacts {
  dealName: string | null;
  dealType: string | null;
  // BGP's client, the party billed (dealClientRole).
  clientRole: DealPartyRole;
  // The person the invoice is for: the deal's client contact, else the
  // client's own contact on the deal.
  fao: string | null;
  // Each party as it signs (its company that signs), else its CRM name.
  landlord: string | null;
  tenant: string | null;
  // The unit and the property's address, one line.
  address: string | null;
  poNumber: string | null;
  feePercentage: number | null;
  rentPa: number | null;
  fee: number | null;
  currency: "GBP" | "USD";
  // The joint agent's share of the fee, when one shares it.
  jointAgentFeePct: number | null;
}

export interface InvoiceDraft {
  template: "letting" | "plain";
  reference: string;
  description: string;
  // The deal's fee, excl. VAT (0 when the deal has none).
  amount: number;
  // What the deal does not hold, in plain words ("the agreed annual rent").
  missing: string[];
  // Figures that do not agree, or a share to check.
  warnings: string[];
  // Figures the template worked out rather than read ("the fee percentage, from the fee and the rent").
  workedOut: string[];
}

const text = (v: unknown): string => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** The deals Layla's template is for: a New Letting with BGP acting for the landlord. */
export function usesLettingTemplate(facts: Pick<InvoiceTemplateFacts, "dealType" | "clientRole">): boolean {
  return text(facts.dealType).toLowerCase() === "new letting" && facts.clientRole === "landlord";
}

export function invoiceMoney(n: number, currency: "GBP" | "USD" = "GBP"): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const body = (whole ? Math.round(n) : n).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${currency === "USD" ? "$" : "£"}${body}`;
}

export function invoicePercent(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// A percentage worked out from the fee and the rent is used only when it is a
// whole number or has at most two decimals (10, 7.5, 12.25): a fee agreed as a
// sum is not a percentage of the rent.
function cleanPercent(fee: number, rent: number): number | null {
  if (!(rent > 0) || !(fee > 0)) return null;
  const pct = (fee / rent) * 100;
  const two = Math.round(pct * 100) / 100;
  if (Math.abs(pct - two) > 0.0001) return null;
  if (Math.abs((rent * two) / 100 - fee) > 1) return null;
  return two;
}

export function buildInvoiceDraft(facts: InvoiceTemplateFacts): InvoiceDraft {
  const currency = facts.currency === "USD" ? "USD" : "GBP";
  const fee = num(facts.fee);
  const amount = fee != null && fee > 0 ? fee : 0;
  const warnings: string[] = [];
  const missing: string[] = [];
  const workedOut: string[] = [];
  const po = text(facts.poNumber);
  const jointPct = num(facts.jointAgentFeePct);
  if (jointPct != null && jointPct > 0) {
    warnings.push(`Joint agent takes ${invoicePercent(jointPct)}% of the fee: check this is BGP's share.`);
  }
  if (!(amount > 0)) missing.push("the fee");

  if (!usesLettingTemplate(facts)) {
    const name = text(facts.dealName) || "Professional fees";
    return { template: "plain", reference: name, description: name, amount, missing, warnings, workedOut };
  }

  const fao = text(facts.fao);
  const tenant = text(facts.tenant);
  const landlord = text(facts.landlord);
  const address = text(facts.address);
  const rent = num(facts.rentPa);
  let pct = num(facts.feePercentage);
  if (!fao) missing.push("the client contact (FAO)");
  if (!tenant) missing.push("the tenant");
  if (!landlord) missing.push("the landlord");
  if (!address) missing.push("the property's address");
  if (rent == null || !(rent > 0)) missing.push("the agreed annual rent");
  if (pct == null || !(pct > 0)) {
    const worked = rent != null && fee != null ? cleanPercent(fee, rent) : null;
    if (worked != null) {
      pct = worked;
      workedOut.push(`the fee percentage, ${invoicePercent(worked)}%, from the fee and the rent`);
    } else {
      pct = null;
      missing.push("the fee percentage");
    }
  }
  if (pct != null && pct > 0 && rent != null && rent > 0 && amount > 0) {
    const expected = Math.round(rent * pct) / 100;
    if (Math.abs(expected - amount) > 1) {
      warnings.push(`${invoicePercent(pct)}% of ${invoiceMoney(rent, currency)} is ${invoiceMoney(expected, currency)}, not ${invoiceMoney(amount, currency)}.`);
    }
  }

  const tenantWord = tenant || "TENANT";
  const lines = [
    tenantWord,
    address || "ADDRESS",
    ...(po ? [`PO – ${po}`] : []),
    "",
    `To: Acting on behalf of ${landlord || "LANDLORD"}, in negotiating a new letting to ${tenantWord} in respect of the above property.`,
    "",
    `To: Fee ${pct != null && pct > 0 ? invoicePercent(pct) : "?"}% of the agreed annual rent of ${rent != null && rent > 0 ? invoiceMoney(rent, currency) : `${currency === "USD" ? "$" : "£"}?`} = ${amount > 0 ? invoiceMoney(amount, currency) : `${currency === "USD" ? "$" : "£"}?`} plus VAT`,
  ];
  return {
    template: "letting",
    reference: `FAO ${fao || "NAME"}`,
    description: lines.join("\n"),
    amount,
    missing,
    warnings,
    workedOut,
  };
}

// The unit and the property's address on one line: the unit, the property's
// name where the address does not already hold it, the address (a stored
// "formatted" line, else its parts) and the postcode where the address lacks
// it, without a closing ", UK".
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const holds = (whole: string, part: string) => !!part && ` ${key(whole)} `.includes(` ${key(part)} `);

export function invoiceAddress(input: { unitName?: string | null; propertyName?: string | null; address?: unknown; postcode?: string | null }): string {
  const a = input.address;
  let line = "";
  if (typeof a === "string") line = text(a);
  else if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    line = text(o.formatted) || text(o.address) || text(o.text)
      || [o.line1, o.street, o.line2, o.district, o.city ?? o.town, o.county, o.postcode].map(text).filter(Boolean).join(", ");
  }
  line = line.replace(/,\s*(UK|United Kingdom|England)\.?$/i, "").trim();
  const unit = text(input.unitName);
  const name = text(input.propertyName);
  const postcode = text(input.postcode).toUpperCase();
  const parts: string[] = [];
  if (unit && !holds(line, unit) && !holds(name, unit)) parts.push(unit);
  if (name && !holds(line, name)) parts.push(name);
  if (line) parts.push(line);
  if (postcode && !holds(parts.join(" "), postcode)) parts.push(postcode);
  const out: string[] = [];
  for (const p of parts) if (!out.length || key(out[out.length - 1]) !== key(p)) out.push(p);
  return out.join(", ");
}

/** True when a line of the invoice already names the PO number, so the reference need not repeat it. */
export function descriptionHoldsPo(descriptions: Array<string | null | undefined>, po: string | null | undefined): boolean {
  const p = text(po);
  if (!p) return false;
  return descriptions.some(d => text(d).toLowerCase().includes(p.toLowerCase()));
}
