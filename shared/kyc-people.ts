// The people a company's checks are about (Woody, 19 November 2026). On deal
// #4491 the owners' identity step ticked itself on the first file ("I didn't
// add Huseyn's details or David Bruce, just Huseyn's passport and nothing for
// David so can't be ok"), and the card did not show who else had to be
// checked ("doesn't show all the other directors at this stage that need to
// get signed off?"). Agreed: "a list of people to check for each party: the
// owners and the person acting, each with their own Veriff link and a
// proof-of-address upload; the directors shown with their sanctions result
// only".
//
// Who: the beneficial owners the register names (people with significant
// control, and the people found up the ownership chain: MLR 2017 reg 5) and
// the person dealing with us for the company (reg 28(10)). A company listed
// on a regulated market has no owners to identify (reg 28(5)). The directors
// who are neither are screened against the sanctions lists only. What each
// person sends is BGP's policy for individuals (Issue 2, "Individuals"): one
// proof of identity (the online check, on the UK DVS register) and one proof
// of residential address from the last three months.
//
// Pure: the server builds the input from the requests, their files and their
// identity checks, and the deal card, the client page and the sign-off read
// the answer.

import { controlWords, nameTokens, ownersAbroadOf, personDisplayName, personNamesMatch, type KycPrecheckResult } from "./kyc-prechecks";
import type { KycDocKey, KycIdState, KycPartyKind, KycPersonRole } from "./kyc-request";
import { checkAddressProof, type AddressProofAcceptance, type AddressProofReading } from "./kyc-address-proof";

export { personDisplayName };

/** A person's key: the words of their name, sorted ("BRUCE, David" and "Mr David Bruce" are "bruce david"). */
export const personKey = (name: string): string => nameTokens(name).sort().join(" ");

/** The date of birth Veriff read off the document (YYYY-MM-DD), or null. */
export function verifiedPersonDob(verdictPerson: unknown): string | null {
  const dob = (verdictPerson as Record<string, unknown> | null)?.dateOfBirth;
  return typeof dob === "string" && /^\d{4}-\d{2}-\d{2}/.test(dob) ? dob.slice(0, 10) : null;
}

type Dob = { month?: number | null; year?: number | null } | null | undefined;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const bornWords = (dob: Dob): string | null =>
  dob?.year ? `${dob.month && dob.month >= 1 && dob.month <= 12 ? `${MONTHS[dob.month - 1]} ` : ""}${dob.year}` : null;

// The register's month and year against the document's date: a different
// year, or a different month when both give one, is someone else.
export function dobAgrees(registerDob: Dob, documentDob: string | null | undefined): boolean {
  if (!registerDob?.year || !documentDob) return true;
  const [year, month] = documentDob.split("-").map(Number);
  if (!year || year !== registerDob.year) return false;
  return !registerDob.month || !month || registerDob.month === month;
}

// ── The input ───────────────────────────────────────────────────────────────

export interface PeopleIdCheck {
  state: KycIdState;
  verifiedName: string | null;
  verifiedDob: string | null;
}

/** A client checks request on the deal, as the people rule reads it. */
export interface PeopleRequest {
  token: string;
  ref: string;
  companyId: string | null;
  recipientName: string | null;
  // A person's own request (null for the request to the person acting).
  person: { key: string; name: string; roles: KycPersonRole[] } | null;
  cancelled: boolean;
  expired: boolean;
  finished: boolean;
  // When the email went (null: not emailed, the link only given).
  sentAt: string | null;
  needsIdCheck: boolean;
  docs: KycDocKey[];
  // The owners named on the old single "ID for each of those owners" step.
  ownerNames: string[];
  // Every identity check started on it, oldest first.
  idChecks: PeopleIdCheck[];
  files: Array<{
    name: string; docKey: KycDocKey | null; uploadedAt: string; url: string | null;
    // The KYC document it was filed as, and for a proof of address what it
    // was read as and whether an officer accepted it (20 November 2026).
    documentId?: string | null;
    reading?: AddressProofReading | null;
    accepted?: AddressProofAcceptance | null;
  }>;
}

/**
 * A person verified from public sources by the Nominated Officer or a Deputy
 * (Woody, 21 November 2026: KYC4U's "Public figure" method, "copies of
 * publicly available sources attached are sufficient to establish
 * public-figure status"). It counts for their identity check and their proof
 * of address.
 */
export interface PublicFigureCheck { id: string; name: string; note: string; by: string; at: string; links: string[]; documents: number }
export const PUBLIC_FIGURE_NOTE_MIN = 10;
export const PUBLIC_FIGURE_MAX_LINKS = 6;

export interface PartyPeopleInput {
  companyId: string;
  kind: KycPartyKind;
  // Verified from public sources, for this party (the brand and the company that signs).
  publicFigures?: PublicFigureCheck[];
  // The party's latest checks before asking (the register read and the sanctions screen).
  precheck: Pick<KycPrecheckResult, "companiesHouse" | "sanctions"> | null;
  // Every request on the deal, each party's: an identity check passed on
  // someone else's link still counts for the person it was.
  requests: PeopleRequest[];
}

// ── The answer ──────────────────────────────────────────────────────────────

export type PersonIdState = "passed" | "waiting" | "document" | "started" | "retry" | "restart" | "not_started";
export type PersonSanctions = "clear" | "possible" | "discounted" | "not_screened";

export interface KycPartyPerson {
  key: string;
  name: string;
  roles: KycPersonRole[];
  // How they own or control the company (owners).
  ownerDetail: string | null;
  born: string | null;
  id: {
    state: PersonIdState;
    // The request the check or document came from.
    ref: string | null;
    // Done on someone else's link: "on the link sent to Jack Barratt (7MJEGT)".
    elsewhere: string | null;
    // The check on their own link was someone else's (who).
    someoneElse: string | null;
    // A live request of theirs asks for it.
    asked: boolean;
  };
  address: {
    done: boolean; ref: string | null; asked: boolean;
    // The proof that counts, else the latest one sent, as read against them
    // (shared/kyc-address-proof.ts): it counts when the reading passes or
    // the Nominated Officer or a Deputy accepted it.
    proof: {
      token: string; ref: string; documentId: string | null; fileName: string; url: string | null; uploadedAt: string;
      read: boolean; ok: boolean; summary: string; reasons: string[]; address: string | null;
      accepted: AddressProofAcceptance | null;
    } | null;
  };
  sanctions: PersonSanctions;
  // Verified from public sources by the officers: counts for the identity check and the proof of address.
  publicFigure: PublicFigureCheck | null;
  // Their own live request (their own link before the request to the person acting): their link, if they have one.
  own: { token: string; ref: string; isMain: boolean; sentAt: string | null } | null;
  outstanding: Array<"identity check" | "proof of address">;
  // Something outstanding that no live request of theirs asks for: send them a link.
  canSend: boolean;
}

export type PartyPeopleBasis = "owners" | "listed" | "no_owners" | "not_read" | "individual" | "owners_abroad";

export interface PartyPeople {
  basis: PartyPeopleBasis;
  people: KycPartyPerson[];
  // Directors who are neither owners nor the person acting: sanctions only.
  directors: Array<{ name: string; sanctions: PersonSanctions }>;
  // Files sent on the old single owners' step, which do not say whose they are.
  loose: Array<{ ref: string; files: number; names: string[] }>;
  // "Huseyn Mirhadiyev: identity check and proof of address", per person.
  outstanding: string[];
  // Companies registered abroad that own the party: Companies House cannot
  // show who owns them, so the client is asked (20 November 2026).
  ownersAbroad?: Array<{ name: string; country: string; foundAt: string | null }>;
}

export const PARTY_PEOPLE_BASIS_WORDS: Record<PartyPeopleBasis, string> = {
  owners: "The owners the register names, up the ownership chain, and the person dealing with us each do an identity check and send a proof of address (MLR 2017 reg 5 and 28; BGP's AML policy).",
  listed: "Listed on a regulated market: no owners to identify (MLR 2017 reg 28(5)). The person dealing with us still does their own check.",
  no_owners: "The register names no person who owns or controls the company. Ask the client who does; the person dealing with us still does their own check.",
  not_read: "BGP's checks before asking have not read the register yet, so the owners are not known. The person dealing with us does their own check.",
  individual: "Private individuals: each person named on the deal does an identity check and sends a proof of address. When more than one person is buying, selling or renting together, add each of them.",
  owners_abroad: "A company registered outside the UK owns or controls it, so Companies House cannot show the people behind it. It goes to KYC4U to find them; the client can also be asked for a structure chart, and each person it names then does their own check.",
};

const samePerson = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && personNamesMatch(a, b);

const isPerson = (role: string) => /director|member/i.test(role) && !/corporate/i.test(role);

interface Draft {
  name: string;
  registerName: boolean;
  roles: Set<KycPersonRole>;
  ownerDetail: string[];
  dob: Dob;
}

export function partyPeople(input: PartyPeopleInput): PartyPeople {
  // A private individual (Jack, 20 November 2026): the person asked and anyone
  // added alongside them, each with their own checks. No register is read.
  const ch = input.kind === "individual" ? null : input.precheck?.companiesHouse || null;
  const drafts: Draft[] = [];
  const add = (raw: string, role: KycPersonRole, extra: { detail?: string; dob?: Dob; register?: boolean } = {}) => {
    const name = String(raw || "").trim();
    if (!nameTokens(name).length) return;
    const found = drafts.find(d => samePerson(d.name, name));
    if (found) {
      found.roles.add(role);
      if (extra.detail && !found.ownerDetail.includes(extra.detail)) found.ownerDetail.push(extra.detail);
      if (!found.dob?.year && extra.dob?.year) found.dob = extra.dob;
      // The register's spelling of a name wins over one typed for a contact.
      if (extra.register && !found.registerName) { found.name = name; found.registerName = true; }
      return;
    }
    drafts.push({ name, registerName: !!extra.register, roles: new Set([role]), ownerDetail: extra.detail ? [extra.detail] : [], dob: extra.dob || null });
  };

  if (ch && !ch.listing) {
    for (const o of ch.owners.filter(o => o.kind === "individual")) {
      add(o.name, "owner", { detail: [...new Set(o.controls.map(controlWords))].join("; ") || "significant control", dob: o.dob, register: true });
    }
    for (const p of ch.peopleUpChain) {
      const line = [...new Set(p.controls.map(controlWords))].join("; ");
      add(p.name, "owner", { detail: `up the ownership chain, in ${p.foundAt}${line ? `: ${line}` : ""}`, dob: p.dob, register: true });
    }
  }
  const party = input.requests.filter(r => r.companyId === input.companyId && !r.cancelled);
  for (const r of party.filter(r => !r.person && r.recipientName)) add(r.recipientName!, "acting");
  // Someone sent a request of their own stays on the list if the register changes.
  for (const r of party.filter(r => r.person)) for (const role of r.person!.roles) add(r.person!.name, role);

  const officers = (ch?.officers || []).filter(o => isPerson(o.role));
  for (const d of drafts) {
    const officer = officers.find(o => samePerson(o.name, d.name));
    if (!officer) continue;
    d.roles.add("director");
    if (!d.dob?.year && officer.dob?.year) d.dob = officer.dob;
    if (!d.registerName) { d.name = officer.name; d.registerName = true; }
  }

  const sanctionsFor = (name: string): PersonSanctions => {
    const line = (input.precheck?.sanctions?.lines || []).find(l => samePerson(l.name, name));
    return line ? line.outcome : "not_screened";
  };

  const people: KycPartyPerson[] = drafts.map(d => {
    const name = personDisplayName(d.name);
    const roles = (["owner", "acting", "joint", "director"] as const).filter(r => d.roles.has(r));
    // Their own requests: a cancelled one still holds what was done on it (a
    // check passed or a file sent is evidence), but is no longer their link.
    const own = (r: PeopleRequest) => r.companyId === input.companyId
      && (r.person ? samePerson(r.person.name, d.name) : samePerson(r.recipientName, d.name));
    const mine = input.requests.filter(own);
    const live = mine.filter(r => !r.expired && !r.cancelled);

    // An identity check is theirs when the document's name is theirs (and its
    // date of birth agrees), on any link on the deal; one whose name was not
    // read counts for the person its link was for.
    let id: KycPartyPerson["id"] = { state: "not_started", ref: null, elsewhere: null, someoneElse: null, asked: false };
    const rank: Record<PersonIdState, number> = { passed: 6, waiting: 5, document: 4, started: 3, retry: 2, restart: 1, not_started: 0 };
    // A check on their own link wins over the same result on someone else's.
    const better = (state: PersonIdState, ref: string, elsewhere: string | null) => {
      if (rank[state] > rank[id.state] || (rank[state] === rank[id.state] && !!id.elsewhere && !elsewhere)) id = { ...id, state, ref, elsewhere };
    };
    for (const r of input.requests) {
      const isOwn = own(r);
      for (const c of r.idChecks) {
        const theirs = c.verifiedName ? samePerson(c.verifiedName, d.name) && dobAgrees(d.dob, c.verifiedDob) : isOwn;
        if (!theirs) {
          if (isOwn && c.verifiedName && (c.state === "approved" || c.state === "submitted")) id = { ...id, someoneElse: personDisplayName(c.verifiedName) };
          continue;
        }
        // A check under way counts only on a live link of their own.
        const state: PersonIdState = c.state === "approved" ? "passed" : c.state === "submitted" ? "waiting"
          : isOwn && !r.cancelled ? (c.state === "started" ? "started" : c.state === "retry" ? "retry" : c.state === "restart" ? "restart" : "not_started") : "not_started";
        better(state, r.ref, isOwn ? null : `on the link sent to ${personDisplayName(r.recipientName || "someone else")} (${r.ref})`);
      }
      if (isOwn && r.files.some(f => f.docKey === "photo_id")) better("document", r.ref, null);
    }
    if (id.state === "passed" || id.state === "waiting") id = { ...id, someoneElse: null };
    const idDone = id.state === "passed" || id.state === "waiting" || id.state === "document";
    id.asked = live.some(r => !r.finished && (r.needsIdCheck || r.docs.includes("photo_id")));

    // A proof of address counts only when it reads as theirs, in date and of
    // a kind the policy accepts, or an officer accepted it (Woody, 20 November
    // 2026: "is the app checking its actually for that person and acceptable?").
    const proofs = mine.flatMap(r => r.files.filter(f => f.docKey === "proof_of_address").map(f => {
      const check = checkAddressProof(f.reading || null, d.name, f.uploadedAt);
      return { r, f, check, counts: check.ok || !!f.accepted };
    }));
    const counting = proofs.find(x => x.counts) || null;
    const shown = counting || proofs[proofs.length - 1] || null;
    const address: KycPartyPerson["address"] = {
      done: !!counting, ref: counting?.r.ref || null,
      asked: live.some(r => !r.finished && r.docs.includes("proof_of_address")),
      proof: shown ? {
        token: shown.r.token, ref: shown.r.ref, documentId: shown.f.documentId || null, fileName: shown.f.name, url: shown.f.url, uploadedAt: shown.f.uploadedAt,
        read: !!shown.f.reading?.read, ok: shown.check.ok, summary: shown.check.summary, reasons: shown.check.reasons,
        address: shown.f.reading?.address || null, accepted: shown.f.accepted || null,
      } : null,
    };

    const publicFigure = (input.publicFigures || []).find(f => samePerson(f.name, d.name)) || null;
    const outstanding: KycPartyPerson["outstanding"] = publicFigure ? [] : [...(idDone ? [] : ["identity check" as const]), ...(address.done ? [] : ["proof of address" as const])];
    const ownLink = live.find(r => r.person) || live.find(r => !r.person) || null;
    return {
      key: personKey(d.name), name, roles,
      ownerDetail: d.ownerDetail.length ? d.ownerDetail.join("; ") : null,
      born: bornWords(d.dob), id, address, sanctions: sanctionsFor(d.name), publicFigure,
      own: ownLink ? { token: ownLink.token, ref: ownLink.ref, isMain: !ownLink.person, sentAt: ownLink.sentAt } : null,
      outstanding,
      canSend: outstanding.some(o => o === "identity check" ? !id.asked : !address.asked),
    };
  });

  const directors = officers
    .filter(o => !drafts.some(d => samePerson(d.name, o.name)))
    .map(o => ({ name: personDisplayName(o.name), sanctions: sanctionsFor(o.name) }));
  const loose = party
    .filter(r => !r.person)
    .map(r => ({ ref: r.ref, files: r.files.filter(f => f.docKey === "owner_ids").length, names: r.ownerNames.map(personDisplayName) }))
    .filter(l => l.files > 0);
  const abroad = ownersAbroadOf(ch);
  const basis: PartyPeopleBasis = input.kind === "individual" ? "individual" : !ch ? "not_read" : ch.listing ? "listed" : people.some(p => p.roles.includes("owner")) ? "owners" : abroad.length ? "owners_abroad" : "no_owners";
  return {
    basis, people, directors, loose,
    outstanding: [
      ...people.filter(p => p.outstanding.length).map(p => `${p.name}: ${p.outstanding.join(" and ")}`),
      // Until the client names them, the people behind a company abroad are owed.
      ...(abroad.length && !party.some(r => !r.person && r.files.some(f => f.docKey === "ownership")) ? [`The people behind ${abroad.map(a => `${a.name} (${a.country})`).join(" and ")}: a structure chart and their IDs`] : []),
    ],
    ...(abroad.length ? { ownersAbroad: abroad.map(a => ({ name: a.name, country: a.country, foundAt: a.foundAt })) } : {}),
  };
}

/** What a person's own request asks for: only what is still outstanding. */
export function personRequestAsks(person: Pick<KycPartyPerson, "id" | "address"> & { publicFigure?: KycPartyPerson["publicFigure"] }, veriff: boolean): { needsIdCheck: boolean; docs: KycDocKey[] } {
  if (person.publicFigure) return { needsIdCheck: false, docs: [] };
  const idDone = person.id.state === "passed" || person.id.state === "waiting" || person.id.state === "document";
  return {
    needsIdCheck: veriff && !idDone,
    docs: [...(!veriff && !idDone ? ["photo_id" as const] : []), ...(person.address.done ? [] : ["proof_of_address" as const])],
  };
}
