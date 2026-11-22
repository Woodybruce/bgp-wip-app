// Who BGP bills, and who pays BGP's invoice (Woody, 20 November 2026: "at
// that point the Xero billing entity and the aml entity need to be flagged if
// they are different? They are effectively the same thing? ... Should we need
// to change the billing entity it's done on the deal page as add billing
// entity which also needs its own KYC no?", then "yes biuild"). Pure rules.
//
// The law and BGP's policy, as given to Woody: the customer BGP checked is the
// one that should pay (HMRC AMLG3200 and AMLG3300: "you must ensure that the
// customer you have verified is the one making the payment for your services.
// Payments from third parties ... not linked to the property transaction
// raise a red flag and should be treated as high risk"); a third party that
// pays BGP's invoice is checked too (BGP's AML policy, Issue 2, "Third
// parties invoiced": "steps must be taken to establish the nature of the
// relationship and identify and verify the ultimate beneficial owners").
//
// So BGP's client is billed as the company that signs, unless the deal says
// otherwise; a billing contact that names another company is flagged; and a
// third party that pays is recorded on the deal with how it is related to the
// client, and gets BGP's checks before asking of its own. It warns; it never
// blocks a deal.

import type { KycRedFlag } from "./kyc-red-flags";
import { precheckRedFlags, type KycPrecheckResult } from "./kyc-prechecks";

export const PAYER_RELATIONSHIPS = [
  // A purchase vehicle set up after the deal was agreed (Woody, 20 November
  // 2026: "they may not have set up the purchase vehicle to date").
  { key: "vehicle", words: "Its purchase vehicle: a company the client owns or controls", clear: true },
  { key: "group", words: "Its parent company, or another company in the same group", clear: true },
  { key: "owners", words: "Owned or controlled by the same people", clear: true },
  { key: "guarantor", words: "Its guarantor on this transaction", clear: true },
  { key: "agent", words: "Its agent or managing agent, paying for it", clear: true },
  { key: "other", words: "Another relationship (the note says what)", clear: true },
  { key: "none", words: "No clear relationship", clear: false },
] as const;
export type PayerRelationship = typeof PAYER_RELATIONSHIPS[number]["key"];
export const isPayerRelationship = (v: unknown): v is PayerRelationship => PAYER_RELATIONSHIPS.some(r => r.key === v);
export const payerRelationshipWords = (v: string | null | undefined): string => PAYER_RELATIONSHIPS.find(r => r.key === v)?.words || "Not recorded";
/** "Another relationship" says what in a note of at least this many characters. */
export const PAYER_NOTE_MIN = 10;

/** The payer's details as a request gives them, or why not. */
export function payerInput(body: unknown): { companyId: string | null; relationship: PayerRelationship | null; note: string | null } | { problem: string } {
  const b: Record<string, unknown> = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const companyId = b.companyId == null ? null : String(b.companyId).trim().slice(0, 100) || null;
  if (!companyId) return { companyId: null, relationship: null, note: null };
  const relationship = b.relationship;
  if (!isPayerRelationship(relationship)) return { problem: "Say how the company that pays is related to the client." };
  const note = String(b.note ?? "").replace(/\s+/g, " ").trim().slice(0, 1000) || null;
  if (relationship === "other" && (note || "").length < PAYER_NOTE_MIN) return { problem: "Say in the note how they are related." };
  return { companyId, relationship, note };
}

// The same legal company, read the way a person reads it: case, punctuation,
// Ltd and Limited, and a trading name after "t/a" do not count.
const companyKey = (v: unknown): string => String(v ?? "")
  .toLowerCase()
  .replace(/\s+(t\/a|trading as)\s+.*$/, "")
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(limited|ltd)\b/g, "ltd")
  .replace(/\bpublic ltd company\b/g, "plc")
  .replace(/\s+/g, " ")
  .trim();

export function sameBillingCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = companyKey(a), y = companyKey(b);
  return !!x && x === y;
}

export type BillingState =
  | "same"        // billed to the company that signs
  | "signing"     // no billing contact of its own: the invoice goes to the company that signs
  | "different"   // billed to another company, and nobody has said who pays
  | "payer"       // billed to a third party recorded as the payer
  | "no_company"  // a company party with no company that signs set
  | "individual"; // a private individual, billed in their own name

// xeroContactId / xeroContactName: the company's own Xero contact, kept on it
// once found or made, or once someone confirms "they are the same company".
export interface BillingCompany { name: string; xeroContactId?: string | null; xeroContactName?: string | null }

/** Who BGP's client is billed as, set against the company that signs and any payer the deal records. */
export function billingState(input: {
  individual: boolean;
  signing: BillingCompany | null;
  billed: { contactId: string | null; name: string | null } | null;
  payer: BillingCompany | null;
}): BillingState {
  if (input.individual) return "individual";
  const billed = input.billed && (input.billed.contactId || input.billed.name) ? input.billed : null;
  const is = (co: BillingCompany | null) => !!co && !!billed && (
    (!!billed.contactId && !!co.xeroContactId && billed.contactId === co.xeroContactId)
    || sameBillingCompany(billed.name, co.name)
    || (!billed.contactId && !!co.xeroContactName && sameBillingCompany(billed.name, co.xeroContactName)));
  if (input.payer && (!billed || is(input.payer))) return "payer";
  if (!input.signing) return "no_company";
  if (!billed) return "signing";
  if (is(input.signing)) return "same";
  return "different";
}

export interface BillingView {
  state: BillingState;
  tone: "done" | "act" | "flag" | "info";
  words: string;
}

/** The billing line, in words, for the Parties card, the AML box and the invoice card. */
export function billingWords(state: BillingState, names: {
  billed: string | null; signing: string | null; payer: string | null; relationship: string | null;
  // The one who signs is a person, not a company (20 November 2026).
  signingPerson?: boolean;
}): BillingView {
  const who = names.signingPerson ? "who signs" : "the company that signs";
  const signing = names.signing || who;
  switch (state) {
    case "same":
      return { state, tone: "done", words: `Billed to ${names.billed || signing}, ${who}.` };
    case "signing":
      return { state, tone: "done", words: `Billed to ${signing}, ${who}. ${names.signingPerson ? "Their" : "Its"} Xero contact is found or made when the invoice is drafted.` };
    case "different":
      return { state, tone: "flag", words: `Billed to ${names.billed || "another company"}, not ${names.signingPerson ? "the person who signs" : "the company that signs"} (${signing}): a third party paying BGP's invoice needs its own checks. Record who pays and how they are related, or confirm it is the same ${names.signingPerson ? "person" : "company"}.` };
    case "payer": {
      const clear = PAYER_RELATIONSHIPS.find(r => r.key === names.relationship)?.clear;
      return clear
        ? { state, tone: "act", words: `${names.payer || "A third party"} pays BGP's invoice for the client (${payerRelationshipWords(names.relationship).toLowerCase()}). It is checked as a third party: BGP's checks before asking run on it.` }
        : { state, tone: "flag", words: `${names.payer || "A third party"} pays BGP's invoice with no clear relationship to the client: HMRC treats that as high risk. A red flag: enhanced checks needed.` };
    }
    case "no_company":
      return { state, tone: "act", words: "Set the company that signs: BGP bills it." };
    case "individual":
      return { state, tone: "info", words: "Billed in the client's own name." };
  }
}

/**
 * The red flags a third party that pays raises on BGP's client: no clear
 * relationship is one by itself (HMRC: high risk), and what BGP's checks
 * before asking found on the payer counts as it would on the client.
 */
export function payerRedFlags(input: {
  payer: { id: string; name: string };
  relationship: string | null;
  note: string | null;
  precheck: KycPrecheckResult | null;
}): KycRedFlag[] {
  const flags: KycRedFlag[] = [];
  const { id, name } = input.payer;
  const clear = PAYER_RELATIONSHIPS.find(r => r.key === input.relationship)?.clear;
  if (!clear) {
    flags.push({
      kind: "third_party_payer",
      key: `payer:${id}:relationship`,
      label: `${name} pays BGP's invoice with no clear relationship to the client`,
      detail: "HMRC treats a payment from a third party with no link to the customer as high risk. Find out how they are related, and check the payer's owners.",
      source: "the deal's billing",
      at: null,
      evidence: [`payer:${id}`, `relationship:${input.relationship || "not recorded"}`],
      facts: [
        { label: "Pays BGP's invoice", value: name },
        { label: "Relationship to the client", value: payerRelationshipWords(input.relationship) },
        ...(input.note ? [{ label: "Note", value: input.note }] : []),
      ],
    });
  }
  if (input.precheck) {
    for (const f of precheckRedFlags(input.precheck, { sanctionsCurrent: true })) {
      flags.push({ ...f, key: `payer:${id}:${f.key}`, label: `The payer, ${name}: ${f.label}` });
    }
  }
  return flags;
}
