// Using a transaction that is already live, from New Transaction (Woody,
// 24 November 2026: "Can you allow for link to existing deal at this point?
// its easier", on the notice that One Clapham already had a live purchase).
// The form moves onto that transaction: what it holds stays, its blanks are
// filled from what New Transaction was given (the heads of terms read, the
// words typed, the boxes filled), and where the two disagree the transaction's
// value stays and the person may take the other one. Nothing moves the
// transaction's stage by itself. Pure, so it is tested without React.
import { DEAL_STATUS_LABELS, legacyToCode, type DealStatusCode } from "../../../shared/deal-status";
import { formatCalendarDate } from "../../../shared/calendar-date";

export type LinkForm = Record<string, any>;

// Never carried over: the transaction keeps its own name, team, BGP Contact,
// property and AML sign-off (the AML check is the Nominated Officer's).
const KEPT = new Set(["name", "team", "internalAgent", "propertyId", "amlCheckCompleted"]);

// Fields that travel together: a party with its billing entity and the company
// that signs, and the transaction's own invoice contact.
interface LinkGroup { key: string; label: string; lead: string[]; fields: string[] }
const party = (role: string, label: string): LinkGroup => ({
  key: role,
  label,
  lead: [`${role}Id`],
  fields: [`${role}Id`, `${role}EntityId`, `${role}EntityName`, `${role}TradingEntityId`],
});
export const LINK_GROUPS: LinkGroup[] = [
  party("landlord", "Landlord"),
  party("tenant", "Tenant"),
  party("vendor", "Vendor"),
  party("purchaser", "Purchaser"),
  { key: "xero", label: "Invoice contact", lead: ["xeroContactId", "xeroContactName"], fields: ["xeroContactId", "xeroContactName", "xeroAccountNumber", "xeroBillingAddress"] },
];
const IN_GROUP = new Set(LINK_GROUPS.flatMap(g => g.fields));

export const LINK_LABELS: Record<string, string> = {
  dealType: "Transaction type",
  status: "Stage",
  unitId: "Unit",
  groupName: "Group",
  scheme: "Scheme",
  assetClass: "Asset class",
  tenureText: "Tenure",
  pricing: "Price",
  yieldPercent: "Yield",
  feeAgreement: "Fee agreement",
  fee: "Fee",
  feeCurrency: "Fee currency",
  feePercentage: "Fee %",
  totalAreaSqft: "Total area",
  basementAreaSqft: "Basement area",
  gfAreaSqft: "Ground floor area",
  ffAreaSqft: "First floor area",
  itzaAreaSqft: "ITZA area",
  pricePsf: "Price per sq ft",
  priceItza: "Price ITZA",
  rentPa: "Rent a year",
  capitalContribution: "Capital contribution",
  rentFree: "Rent free",
  leaseLength: "Lease length",
  breakOption: "Break",
  rentAnalysis: "Rent analysis",
  instructedAt: "Instructed",
  targetDate: "Target date",
  exchangedAt: "Exchanged",
  completedAt: "Completed",
  invoicedAt: "Invoiced",
  comments: "Comments",
  lastInteraction: "Last contact",
  sharepointLink: "SharePoint link",
  poNumber: "PO number",
  invoicingEmail: "Invoicing email",
};

const MONEY = new Set(["pricing", "fee", "rentPa", "capitalContribution", "pricePsf", "priceItza", "rentAnalysis"]);
const PERCENT = new Set(["yieldPercent", "feePercentage"]);
const AREA = new Set(["totalAreaSqft", "basementAreaSqft", "gfAreaSqft", "ffAreaSqft", "itzaAreaSqft"]);
const NUMBER = new Set([...MONEY, ...PERCENT, ...AREA, "rentFree", "leaseLength"]);
const DATE = new Set(["instructedAt", "exchangedAt", "completedAt", "invoicedAt"]);

// The stages New Transaction can offer to move a live transaction on to, in
// order: only forward, and never past Solicitors (exchange, completion and
// invoicing are set on the transaction itself).
const STAGE_ORDER: DealStatusCode[] = ["OPP", "REP", "SPEC", "LIVE", "AVA", "NEG", "HOT", "SOL", "EXC", "COM", "INV"];
const OFFERED_STAGES = new Set<DealStatusCode>(["NEG", "HOT", "SOL"]);

export function linkBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? "").replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Whether two values of one field say the same thing (numbers as numbers,
 *  dates by their day, the target date by its month, words without case). */
export function linkSame(field: string, a: unknown, b: unknown): boolean {
  if (linkBlank(a) || linkBlank(b)) return linkBlank(a) && linkBlank(b);
  if (NUMBER.has(field)) {
    const x = num(a), y = num(b);
    if (x !== null && y !== null) return Math.abs(x - y) < 1e-9;
  }
  if (field === "targetDate") return String(a).slice(0, 7) === String(b).slice(0, 7);
  if (DATE.has(field)) return String(a).slice(0, 10) === String(b).slice(0, 10);
  if (field === "status") return legacyToCode(String(a)) === legacyToCode(String(b));
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export interface LinkDifference {
  key: string;          // the field, or the group's key
  field: string;        // the field whose values are shown
  label: string;
  current: unknown;     // what the transaction holds
  offered: unknown;     // what New Transaction was given
  patch: LinkForm;      // taking it: the value, or the group whole
  move?: boolean;       // a move of stage
}

export interface LinkResult {
  form: LinkForm;
  filled: Array<{ key: string; label: string }>;
  differs: LinkDifference[];
}

/**
 * Moves what New Transaction was given onto a live transaction.
 *  - `existing`: the transaction as the form reads it.
 *  - `given`: New Transaction's form as it stands.
 *  - `base`: New Transaction's form with nothing given, so its defaults (the
 *    stage it starts at, the fee currency) never count as something given.
 */
export function linkToTransaction(existing: LinkForm, given: LinkForm, base: LinkForm): LinkResult {
  const form: LinkForm = { ...existing };
  const filled: LinkResult["filled"] = [];
  const differs: LinkDifference[] = [];
  const isGiven = (field: string) => !linkBlank(given[field]) && !linkSame(field, given[field], base[field]);

  for (const g of LINK_GROUPS) {
    const leadGiven = g.lead.find(f => !linkBlank(given[f]) && isGiven(f));
    if (!leadGiven) continue;
    const leadHeld = g.lead.find(f => !linkBlank(existing[f]));
    if (!leadHeld) {
      for (const f of g.fields) form[f] = given[f] ?? "";
      filled.push({ key: g.key, label: g.label });
      continue;
    }
    if (linkSame(leadHeld, existing[leadHeld], given[leadHeld] ?? given[leadGiven])) {
      // The same party: its billing entity and the company that signs fill
      // only where the transaction has none (the billing entity as a pair).
      const [, entityId, entityName, trading] = g.fields;
      if (g.key !== "xero" && entityId && linkBlank(existing[entityId]) && !linkBlank(given[entityId])) {
        form[entityId] = given[entityId];
        form[entityName] = given[entityName] ?? "";
        filled.push({ key: `${g.key}.billing`, label: `${g.label}'s billing entity` });
      }
      if (g.key !== "xero" && trading && linkBlank(existing[trading]) && !linkBlank(given[trading])) {
        form[trading] = given[trading];
        filled.push({ key: `${g.key}.signs`, label: `${g.label}'s company that signs` });
      }
      continue;
    }
    const patch: LinkForm = {};
    for (const f of g.fields) patch[f] = given[f] ?? (f === "xeroBillingAddress" ? null : "");
    // A party is shown by its record, the invoice contact by its name.
    if (g.key === "xero") {
      differs.push({ key: g.key, field: "xeroContactName", label: g.label, current: existing.xeroContactName || existing.xeroContactId, offered: given.xeroContactName || given.xeroContactId, patch });
    } else {
      differs.push({ key: g.key, field: leadHeld, label: g.label, current: existing[leadHeld], offered: given[leadHeld], patch });
    }
  }

  for (const field of Object.keys(LINK_LABELS)) {
    if (KEPT.has(field) || IN_GROUP.has(field) || !isGiven(field)) continue;
    const label = LINK_LABELS[field];
    if (field === "status") {
      const to = legacyToCode(String(given.status));
      const from = linkBlank(existing.status) ? null : legacyToCode(String(existing.status));
      if (to && OFFERED_STAGES.has(to) && STAGE_ORDER.indexOf(to) > (from ? STAGE_ORDER.indexOf(from) : -1)) {
        differs.push({ key: field, field, label, current: existing.status, offered: to, patch: { status: to }, move: true });
      }
      continue;
    }
    if (field === "comments") {
      const add = String(given.comments).trim();
      const held = String(existing.comments || "").trim();
      if (held.includes(add)) continue;
      form.comments = held ? `${held}\n${add}` : add;
      filled.push({ key: field, label: held ? "Comments (added to)" : label });
      continue;
    }
    if (linkBlank(existing[field])) {
      form[field] = given[field];
      filled.push({ key: field, label });
      continue;
    }
    if (!linkSame(field, existing[field], given[field])) {
      differs.push({ key: field, field, label, current: existing[field], offered: given[field], patch: { [field]: given[field] } });
    }
  }
  return { form, filled, differs };
}

export interface LinkNames {
  company: (id: string) => string | undefined;
  unit: (id: string) => string | undefined;
}

/** A value as the person reads it. */
export function linkValueWords(field: string, value: unknown, names: LinkNames): string {
  if (linkBlank(value)) return "nothing";
  const v = String(value);
  if (/^(landlord|tenant|vendor|purchaser)Id$/.test(field)) return names.company(v) || "a company not in this list";
  if (field === "status") {
    const code = legacyToCode(v);
    return code ? DEAL_STATUS_LABELS[code] : v;
  }
  if (field === "unitId") return names.unit(v) || "another unit";
  const n = num(v);
  if (MONEY.has(field) && n !== null) return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
  if (PERCENT.has(field) && n !== null) return `${n.toLocaleString("en-GB", { maximumFractionDigits: 3 })}%`;
  if (AREA.has(field) && n !== null) return `${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })} sq ft`;
  if (field === "rentFree" && n !== null) return `${n} month${n === 1 ? "" : "s"}`;
  if (field === "leaseLength" && n !== null) return `${n} year${n === 1 ? "" : "s"}`;
  if (field === "targetDate") {
    const d = formatCalendarDate(v);
    return d ? d.replace(/^\d{1,2} /, "") : v;
  }
  if (DATE.has(field)) return formatCalendarDate(v) || v;
  return v.length > 80 ? `${v.slice(0, 77)}…` : v;
}
