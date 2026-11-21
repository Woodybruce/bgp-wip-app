// Relying on another firm's checks (Woody, 21 November 2026: "Relying on
// another firm's checks (reg 39, such as their UK solicitor's): there's
// nowhere to record it" ... "Yes go ahead").
//
// MLR 2017 reg 39, read on legislation.gov.uk on 21 November 2026:
// - (1) BGP may rely on a third party to apply the customer due diligence
//   measures of reg 28(2) to (6) and (10), but remains liable for any failure;
// - (2)(a) it must immediately obtain from the third party all the information
//   those measures need about the customer, its beneficial owners and anyone
//   acting for it; (2)(b) it must have arrangements that let it obtain copies
//   of the identification and verification data immediately on request, and
//   that require the third party to keep them for the reg 40 period (five years);
// - (3) the third party is another firm under these regulations, or a firm in
//   a third country under equivalent due diligence and record-keeping rules
//   and equivalent supervision;
// - (4) not a third party established in a FATF call-for-action country.
// HMRC's guidance adds that reliance does not cover enhanced due diligence.
//
// Pure: the routes are in server/deal-party-aml.ts (the Nominated Officer or a
// Deputy records it), and the people to check owe nothing while it stands.

import { countryOf, countryRisk } from "./aml-policy";

export const RELIANCE_FIRM_KINDS = {
  solicitor: "Solicitors",
  bank: "Bank or building society",
  accountant: "Accountants",
  estate_agent: "Estate or letting agent",
  other: "Another firm under the money laundering regulations",
} as const;
export type RelianceFirmKind = keyof typeof RELIANCE_FIRM_KINDS;

export const RELIANCE_NOTE_MIN = 10;

export interface PartyReliance {
  id: string;
  firm: string;
  kind: RelianceFirmKind;
  where: "uk" | "abroad";
  country: string | null;
  regulator: string;
  regulatorRef: string | null;
  contact: string | null;
  agreedOn: string;
  note: string;
  by: string;
  at: string;
  documents: number;
}

/** What the officers are told before they record it, in the regulation's terms. */
export const RELIANCE_TERMS = [
  "BGP stays responsible for the checks (MLR 2017 reg 39(1)).",
  "BGP must have from the firm, now, who the customer is, its beneficial owners and anyone acting for it (reg 39(2)(a)).",
  "The firm must give copies of its identification and verification documents immediately on request, and keep them for five years (reg 39(2)(b)).",
  "The firm must be under the UK money laundering regulations, or abroad under equivalent rules and supervision (reg 39(3)), and not in a FATF call-for-action country (reg 39(4)).",
  "Reliance does not cover enhanced due diligence (HMRC): a higher-risk party still needs the officers' own checks.",
];

export type RelianceInput = Omit<PartyReliance, "id" | "by" | "at" | "documents">;

const clean = (v: unknown, max = 200): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The officer's form, checked. Every one of the regulation's conditions must
 * be confirmed; a firm abroad also names its country, and is refused in a
 * FATF call-for-action country.
 */
export function relianceInput(raw: Record<string, unknown>, today: Date = new Date()): { ok: true; value: RelianceInput } | { ok: false; message: string } {
  const firm = clean(raw.firm, 160);
  if (firm.length < 2) return { ok: false, message: "Name the firm whose checks BGP relies on." };
  const kind = clean(raw.kind) as RelianceFirmKind;
  if (!(kind in RELIANCE_FIRM_KINDS)) return { ok: false, message: "Say what kind of firm it is." };
  const where = raw.where === "abroad" ? "abroad" : raw.where === "uk" ? "uk" : null;
  if (!where) return { ok: false, message: "Say whether the firm is in the UK or abroad." };
  const country = where === "abroad" ? clean(raw.country, 60) : null;
  if (where === "abroad" && !country) return { ok: false, message: "Name the country the firm is in." };
  if (country && countryRisk(countryOf(country)) === "fatf_call_for_action") {
    return { ok: false, message: `BGP cannot rely on a firm in ${country}: it is on FATF's call-for-action list (MLR 2017 reg 39(4)).` };
  }
  const regulator = clean(raw.regulator, 80);
  if (regulator.length < 2) return { ok: false, message: "Name the firm's anti-money laundering supervisor (for example the SRA, the FCA, the ICAEW or HMRC)." };
  const agreedOn = clean(raw.agreedOn, 10);
  const agreed = /^\d{4}-\d{2}-\d{2}$/.test(agreedOn) ? new Date(`${agreedOn}T12:00:00Z`) : null;
  if (!agreed || Number.isNaN(agreed.getTime())) return { ok: false, message: "Give the date the firm agreed to BGP relying on its checks." };
  if (agreed.getTime() > today.getTime() + 86400000) return { ok: false, message: "The date the firm agreed cannot be in the future." };
  for (const [key, words] of [
    ["agreed", "that the firm agreed in writing to BGP relying on its checks"],
    ["informationHeld", "that BGP has from the firm who the customer is, its beneficial owners and anyone acting for it"],
    ["copiesOnRequest", "that the firm will give copies of its documents immediately on request and keep them for five years"],
    ...(where === "abroad" ? [["equivalent", "that the firm is under equivalent money laundering rules and supervision"]] : []),
  ] as Array<[string, string]>) {
    if (raw[key] !== true && raw[key] !== "true") return { ok: false, message: `Confirm ${words}.` };
  }
  const note = clean(raw.note, 1500);
  if (note.length < RELIANCE_NOTE_MIN) return { ok: false, message: "Say what the firm has checked and who it covers (at least a sentence)." };
  return {
    ok: true,
    value: { firm, kind, where, country, regulator, regulatorRef: clean(raw.regulatorRef, 40) || null, contact: clean(raw.contact, 160) || null, agreedOn, note },
  };
}

/** "Relying on Smith & Co's checks (solicitors, SRA 123456), agreed 20 Nov 2026". */
export function relianceWords(r: Pick<PartyReliance, "firm" | "kind" | "regulator" | "regulatorRef" | "agreedOn" | "where" | "country">): string {
  const day = new Date(`${r.agreedOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  // "SRA 123456" typed as the number is not "SRA SRA 123456".
  const ref = !r.regulatorRef ? "" : r.regulatorRef.toLowerCase().startsWith(r.regulator.toLowerCase()) ? r.regulatorRef : `${r.regulator} ${r.regulatorRef}`;
  return `Relying on ${r.firm}'s checks (${RELIANCE_FIRM_KINDS[r.kind].toLowerCase()}${r.where === "abroad" && r.country ? ` in ${r.country}` : ""}, ${ref || r.regulator}), agreed ${day}`;
}
