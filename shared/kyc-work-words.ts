// What a client checks request says about the work (Woody, 25 November 2026,
// on the request to CBRE for Wirral Metropolitan Borough Council on Tunsgate
// Quarter: "wording here for clients is a bit weird", "Maybe its as simple as
// ... By law to act on your behalf in an estate agency capacity we need to",
// then "the our client one is good. we should add the town Tunsgate Quarter,
// Guildford", and of the other side "Before it can go ahead ... we need to
// spell out the transaction").
//
// Our own client is told why we check them (we act for them) and that it is
// done once; the other side is told what the transaction is, who we act for and
// that both sides are checked. A public body is never told about owners or
// directors it does not have. Read once when a request is made and kept on it,
// so the email, the reminders and the client's page say the same.

import { townFromAddress } from "./store-count";

export interface KycWork {
  // BGP acts for this party (a client file is always BGP's client).
  client: boolean;
  // "Tunsgate Quarter, Guildford": the property and its town.
  place: string | null;
  // "the letting of 98-100 High Street, Tunsgate Quarter, Guildford, to Rodd & Gunn".
  what: string | null;
  // "letting", "sale", "purchase", "lease renewal" ... or "transaction".
  word: string;
  // BGP's client on the transaction, for the other side's opening.
  clientName: string | null;
  clientRole: string | null;
  // A UK public body: no owners or directors.
  publicBody?: boolean;
}

export type KycWordsPart = { text: string; strong?: boolean };

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const ROLE_NOUN: Record<string, string> = { tenant: "tenant", purchaser: "buyer", landlord: "landlord", vendor: "seller" };

/** "Tunsgate Quarter, Guildford": the property, and its town when the name does not already say it. */
export function kycPlace(propertyName: unknown, address: unknown): string | null {
  const name = clean(propertyName);
  const town = clean(townFromAddress(clean(address), ""));
  if (!name) return town || null;
  if (!town || name.toLowerCase().includes(town.toLowerCase())) return name;
  return `${name}, ${town}`;
}

/** The transaction spelt out, and the one word for it. */
export function kycWorkFor(input: {
  dealType: string | null; unitName: string | null; propertyName: string | null; propertyAddress: string | null;
  parties: Partial<Record<"landlord" | "tenant" | "vendor" | "purchaser", string | null>>;
  clientRole: string | null; clientName: string | null; partyRole: string; dealName: string;
  // A client file: BGP's client checked with no transaction.
  clientFile?: boolean; publicBody?: boolean;
}): KycWork {
  const client = !!input.clientFile || (!!input.clientRole && input.clientRole === input.partyRole);
  const place = input.clientFile ? null : kycPlace(input.propertyName, input.propertyAddress);
  const unit = clean(input.unitName);
  const premises = [unit && !(place || "").toLowerCase().includes(unit.toLowerCase()) ? unit : "", place || ""].filter(Boolean).join(", ") || null;
  const type = clean(input.dealType).toLowerCase();
  const tenant = clean(input.parties.tenant) || null;
  const vendor = clean(input.parties.vendor) || null;
  const purchaser = clean(input.parties.purchaser) || null;
  let word = "transaction";
  let what: string | null = null;
  // "the letting of 98-100 High Street, Tunsgate Quarter, Guildford, to Rodd & Gunn".
  const tail = (by: string, name: string | null) => name && premises ? `${premises.includes(",") ? "," : ""} ${by} ${name}` : "";
  if (!input.clientFile && premises) {
    if (/renewal|regear/.test(type)) { word = "lease renewal"; what = `the lease renewal of ${premises}${tail("with", tenant)}`; }
    else if (/rent review/.test(type)) { word = "rent review"; what = `the rent review of ${premises}${tail("with", tenant)}`; }
    else if (/disposal|assignment/.test(type) && !/sale/.test(type)) { word = "lease disposal"; what = `the disposal of the lease of ${premises}`; }
    else if (/sub-?let/.test(type)) { word = "sub-letting"; what = `the sub-letting of ${premises}${tail("to", tenant)}`; }
    else if (/licen[cs]e/.test(type)) { word = "licence"; what = `the licence of ${premises}${tail("to", tenant)}`; }
    else if (/let|lease|tenant/.test(type)) { word = "letting"; what = `the letting of ${premises}${tail("to", tenant)}`; }
    else if (/sale/.test(type) || (/investment/.test(type) && input.clientRole === "vendor")) { word = "sale"; what = `the sale of ${premises}${tail("to", purchaser)}`; }
    else if (/purchase|acquisition|investment/.test(type)) { word = "purchase"; what = `the purchase of ${premises}${tail("from", vendor)}`; }
    else what = premises;
  }
  return {
    client, place, what, word,
    clientName: clean(input.clientName) || null, clientRole: input.clientRole || null,
    ...(input.publicBody ? { publicBody: true } : {}),
  };
}

/**
 * The request's opening, as paragraphs of parts (bold where marked): the email
 * and the client's page both draw it. asksOwners: the request asks about the
 * company's owners (so the other side is told they are checked too).
 */
export function kycWorkOpening(work: KycWork, party: { name: string; kind: "company" | "individual" }, asksOwners: boolean): KycWordsPart[][] {
  const you = party.kind === "individual";
  if (work.client) {
    return [
      [
        { text: "By law, before we can act for you as estate agents, we have to confirm who we are dealing with. We act for " },
        you ? { text: "you" } : { text: party.name, strong: true },
        ...(work.place ? [{ text: " on " }, { text: work.place, strong: true }] : []),
        { text: ", so we need a few things from you." },
      ],
      [
        { text: "We only ask once: it then covers our future work for " },
        you ? { text: "you" } : { text: party.name, strong: true },
        { text: ", until our next review." },
      ],
    ];
  }
  const noun = ROLE_NOUN[work.clientRole || ""] || null;
  const first: KycWordsPart[] = work.clientName
    ? [{ text: "We act for " }, { text: work.clientName, strong: true }, { text: noun ? `, the ${noun}, on ` : " on " }]
    : [{ text: "We are the agents on " }];
  return [[
    ...first,
    { text: work.what || work.place || "this transaction", strong: !work.what },
    { text: `. Before the ${work.word} can go ahead, the law requires us to confirm who is on each side. That's you` },
    ...(you ? [] : [{ text: ", for " }, { text: party.name, strong: true }]),
    { text: asksOwners && !work.publicBody && !you ? ", and the people who own or control it." : "." },
  ]];
}

/** The reminder's line: what is still owed is for. */
export function kycWorkReminder(work: KycWork, party: { name: string; kind: "company" | "individual" }): KycWordsPart[] {
  if (work.client) {
    return [{ text: "We still need a few things from you before we can act for " }, party.kind === "individual" ? { text: "you" } : { text: party.name, strong: true }, { text: "." }];
  }
  return [{ text: "We still need a few things from you before " }, { text: work.what || `the ${work.word}`, strong: !work.what }, { text: " can go ahead." }];
}

/** "the council", "the organisation": what a public body is called in a step. */
export const publicBodyNoun = (name: string): string => /\bcouncil\b/i.test(name) ? "the council" : "the organisation";

/** Plain text of parts (the page and the WhatsApp message use it). */
export const partsText = (parts: KycWordsPart[]): string => parts.map(p => p.text).join("");
