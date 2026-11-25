// Simplified due diligence (SDD), said out loud (Layla, 23 November 2026, on
// transaction #3965, The Crown Estate: "We need the app to highlight when a
// company only needs a simplified (SDD) check so that employees dont go down
// a rabbit hole. we will need the reasoning of the SDD saved against this
// deal"). HMRC: SDD reduces the checks, it does not remove them, and the firm
// must be able to show why it departed from standard due diligence. So the
// app says when a party is SDD, lists what the file should hold, and drafts
// the note of reasons for a person to check and save on the transaction.
//
// A UK public body (a statutory corporation, a government department, a local
// authority) has no company at Companies House and no beneficial owner in the
// usual sense. It is recorded on the party's own record,
// crm_companies.aml_subject_type = 'public_body', by a person: a name that
// reads like one is only a suggestion, because a joint venture or partnership
// the body has an interest in is NOT the body and needs standard checks.

const text = (v: unknown): string => String(v ?? "").trim();

export const PUBLIC_BODY_SUBJECT = "public_body";
export const isPublicBodyRecord = (subjectType: unknown): boolean => text(subjectType).toLowerCase() === PUBLIC_BODY_SUBJECT;

/** Records that are checked on their own record, with no company that signs. */
export const SIGNS_ITSELF_SUBJECTS = ["individual", "trust", PUBLIC_BODY_SUBJECT] as const;
export const signsItself = (subjectType: unknown): boolean => (SIGNS_ITSELF_SUBJECTS as readonly string[]).includes(text(subjectType).toLowerCase());

export interface KnownPublicBody {
  key: string;
  // The body's own legal name and how it is established.
  legalName: string;
  statute: string;
  what: string;
  // Why there is no beneficial owner in the usual sense.
  ownership: string;
  // Who runs it: the people BGP names in the file.
  board: string;
  // Where its identity is evidenced.
  evidence: string;
  // What the SDD note says was checked ("... the party is <self>"), and who the
  // note asks to be named as the people BGP deals with.
  self: string;
  people: string;
}

// Bodies BGP deals with whose statutory basis is known. A name must be the
// body's own, exactly: "The Crown Estate" or "The Crown Estate Commissioners",
// never a company or partnership with those words in its name.
const KNOWN: Array<{ names: string[]; body: KnownPublicBody }> = [
  {
    names: ["crown estate", "crown estate commissioners"],
    body: {
      key: "crown_estate",
      legalName: "The Crown Estate Commissioners (The Crown Estate)",
      statute: "the Crown Estate Act 1961",
      what: "a statutory corporation",
      ownership: "The estate is held by the monarch in right of the Crown and managed by the Commissioners, with its net revenue profit paid to the Treasury, so there is no beneficial owner in the usual sense",
      board: "the Commissioners (its board)",
      evidence: "gov.uk or The Crown Estate's latest annual report",
      self: "The Crown Estate Commissioners themselves",
      people: "names of the Commissioners or officers",
    },
  },
  // The City of London Corporation (Woody, 25 November 2026, on #4600: "its a
  // public body this and cant be found on companies house"). Its legal name is
  // "The Mayor and Commonalty and Citizens of the City of London"; "City of
  // London" alone is how BGP's CRM names it as a landlord.
  {
    names: ["city of london", "city of london corporation", "corporation of london", "mayor and commonalty and citizens of the city of london"],
    body: {
      key: "city_of_london",
      legalName: "The Mayor and Commonalty and Citizens of the City of London (the City of London Corporation)",
      statute: "its charters and the Acts of Parliament that govern it",
      what: "the local authority for the City of London",
      ownership: "It is a local authority, run by its elected Court of Common Council, so there is no beneficial owner in the usual sense",
      board: "its senior officers (the Town Clerk, the Chamberlain and the City Surveyor)",
      evidence: "cityoflondon.gov.uk or its latest statement of accounts",
      self: "the City of London Corporation itself",
      people: "names of the officers, such as the City Surveyor",
    },
  },
];

const nameKey = (name: unknown): string => text(name).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");

/** The known public body a name is, exactly; null for anything else, a vehicle with the words in its name included. */
export function knownPublicBody(name: unknown): KnownPublicBody | null {
  const key = nameKey(name);
  return key ? KNOWN.find(k => k.names.includes(key))?.body || null : null;
}

// A name that reads like a UK public body (BGP's policy 4.3; HMRC: "a public
// authority or publicly owned body in the UK"). A local authority often signs
// under its corporate name: "The Mayor and Commonalty and Citizens of the City
// of London", "The Lord Mayor and Citizens of the City of Westminster", "The
// Mayor and Burgesses of the London Borough of Camden", "The Mayor, Aldermen
// and Burgesses of the Borough of ..." (25 November 2026).
const PUBLIC_BODY_NAME = /\b(council|london borough of|royal borough of|city of london corporation|corporation of london|greater london authority|transport for london|combined authority|nhs|ministry of|department (?:for|of)|secretary of state|homes england|police and crime commissioner|fire and rescue authority|(?:lord )?mayor,? (?:aldermen,? )?and (?:commonalty|citizens|burgesses))\b/i;
// A company or partnership is never the body itself.
const VEHICLE = /\b(limited|ltd|llp|plc|lp|partnership|unit trust|nominees?|gp|holdings?|jv|joint venture)\b/i;
// Nor is a trust the body acts for as trustee ("... as Trustees of The Bridge
// House Estates"): the trust is the party, checked as a trust.
const AS_TRUSTEE = /\bas (?:the )?(?:sole )?trustees? (?:of|for)\b/i;

/** A name that reads like a public body: a suggestion a person confirms, never applied by itself. */
export function publicBodyMarkInName(name: unknown): boolean {
  const n = text(name);
  if (!n || VEHICLE.test(n) || AS_TRUSTEE.test(n)) return false;
  return !!knownPublicBody(n) || PUBLIC_BODY_NAME.test(n);
}

// A registered name without case, punctuation, a leading "The" or its legal form.
const registeredKey = (v: unknown): string => text(v).toLowerCase().replace(/&/g, " and ").replace(/['\u2019]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "")
  .replace(/\s*\b(limited|ltd|public limited company|plc|llp|limited liability partnership)$/, "").replace(/\s+/g, " ").trim();

export interface CompaniesHouseLink { number: string; name: string }

/**
 * A Companies House link stored on a record whose name reads as a UK public
 * body, naming another company. A public body has no Companies House record of
 * its own, so such a link is a mistake: the old in-app screening put ALAXIA
 * LIMITED, a restaurant company dissolved in 2021, on the City of London
 * Corporation's record (Woody, 25 November 2026, on #4600), and two startup
 * jobs then filed it under the City as its main company. A link whose registered
 * name is the body's own (a Royal Charter body on the register) is not this, nor
 * is a number held with no registered name: nothing says it is wrong.
 */
export function wrongCompaniesHouseLink(name: unknown, link: { number?: unknown; name?: unknown }): CompaniesHouseLink | null {
  const number = text(link.number), registered = text(link.name);
  if (!number || !registered || !publicBodyMarkInName(name)) return null;
  const known = knownPublicBody(name);
  const own = new Set([registeredKey(name), ...(known ? [registeredKey(known.legalName.replace(/\s*\(.*\)\s*$/, ""))] : [])]);
  return own.has(registeredKey(registered)) ? null : { number, name: registered };
}

/** A company filed under the record from the wrong link: its number, or, with no number, its name. */
export function filedFromWrongLink(company: { name?: unknown; companiesHouseNumber?: unknown }, link: CompaniesHouseLink | null): boolean {
  if (!link) return false;
  const number = text(company.companiesHouseNumber).replace(/\s+/g, "").toUpperCase();
  const wrong = link.number.replace(/\s+/g, "").toUpperCase();
  const pad = (n: string) => (/^\d+$/.test(n) ? n.padStart(8, "0") : n);
  if (number) return pad(number) === pad(wrong);
  return !!registeredKey(company.name) && registeredKey(company.name) === registeredKey(link.name);
}

export type SddKind = "public_body" | "listed" | "listed_abroad" | "fund";

/** Why a party is simplified, and what its file should hold. */
export interface SddCase {
  kind: SddKind;
  basis: string;
  // What the file should hold, in the order to gather it.
  fileHolds: string[];
  // When the basis does not carry across.
  caveat: string;
  // Recorded by a person (a public body), or read from the register.
  confirmed: boolean;
  known?: KnownPublicBody | null;
}

export const SDD_MEANS = "Simplified due diligence reduces the checks. It does not remove them, and the reasons are kept on the file.";

const PUBLIC_BODY_CAVEAT = "This covers the body itself. A joint venture, partnership or company it has an interest in is not covered: that needs standard checks, with its other partners looked through.";

/** A public body's case: recorded by a person, or only read from its name. */
export function publicBodyCase(partyName: unknown, recorded: boolean): SddCase {
  const known = knownPublicBody(partyName);
  const name = text(partyName) || "The party";
  const basis = known
    ? `${known.legalName}: ${known.what} under ${known.statute}, a UK public body. Simplified due diligence (SDD)${recorded ? "" : " once it is recorded as a public body"}. No beneficial owners to verify.`
    : `A UK public body${recorded ? "" : ", by its name"}: simplified due diligence (SDD)${recorded ? "" : " once that is confirmed"} (policy 4.3). No beneficial owners to verify; who controls it is still noted.`;
  return {
    kind: "public_body", basis, confirmed: recorded, known,
    fileHolds: [
      known
        ? `Its identity and statutory basis: its full name, ${known.statute} and its principal office, from ${known.evidence}`
        : `Its identity and legal basis: its full name, the Act, Charter or order that sets it up and its principal office, from gov.uk or its latest annual report`,
      known
        ? `A note that it has no beneficial owner in the usual sense, with the names of ${known.board} or the people ${name} deals with us through`
        : "A note of who controls it (its members, board or senior officers), as it has no beneficial owner in the usual sense",
      "Proof that the person instructing us has authority to act for it",
      "A short note of why simplified due diligence was applied",
    ],
    caveat: PUBLIC_BODY_CAVEAT,
  };
}

export function listedCase(basis: string, abroad: boolean): SddCase {
  return {
    kind: abroad ? "listed_abroad" : "listed", basis, confirmed: !abroad,
    fileHolds: [
      "Its Companies House record, with the market it is listed on",
      "Sanctions and adverse media screening of the company",
      "Proof that the person instructing us has authority to act for it",
      "A short note of why simplified due diligence was applied",
    ],
    caveat: abroad
      ? "The officers confirm the market's disclosure rules are equivalent to the London Stock Exchange's. A subsidiary or joint venture of the listed company is not covered: that needs standard checks."
      : "This covers the listed company itself. A subsidiary or joint venture of it is not covered: that needs standard checks.",
  };
}

export function fundCase(basis: string): SddCase {
  return {
    kind: "fund", basis, confirmed: true,
    fileHolds: [
      "Its Companies House record and its FCA authorisation",
      "Who owns or controls it: its owners are still identified",
      "Proof that the person instructing us has authority to act for it",
      "A short note of why simplified due diligence was applied",
    ],
    caveat: "Simplified due diligence does not apply if there is a politically exposed person, an unclear source of funds or any higher-risk factor.",
  };
}

export const SDD_NOTE_MIN = 40;
export const SDD_NOTE_MAX = 3000;

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

/**
 * The note of reasons, drafted for a person to check, change and save on the
 * transaction. Square brackets mark what the person fills in.
 */
export function sddNoteDraft(input: {
  sdd: SddCase; partyName: string; roleLabel: string; dealName: string; dealRef?: string | number | null;
  contactName?: string | null; isClient?: boolean; today?: Date;
}): string {
  const { sdd } = input;
  const name = text(input.partyName) || "The party";
  const role = text(input.roleLabel).toLowerCase() || "party";
  const deal = `${text(input.dealName) || "this transaction"}${input.dealRef ? ` (ref ${input.dealRef})` : ""}`;
  const contact = text(input.contactName);
  const who = `${name}, ${input.isClient ? `BGP's client and the ${role}` : `the ${role}`} on ${deal}`;
  const lines: string[] = [`Simplified due diligence (SDD) note, ${day(input.today || new Date())}.`, ""];
  if (sdd.kind === "public_body") {
    const k = sdd.known || null;
    lines.push(
      k ? `Who: ${who}. Its legal name is ${k.legalName}, ${k.what} under ${k.statute}. Principal office: [address, from ${k.evidence}].`
        : `Who: ${who}. It is a UK public body set up under [the Act, Charter or order]. Principal office: [address, from gov.uk or its latest annual report].`,
      "",
      `Why SDD: HMRC lists a public authority or publicly owned body in the UK as a customer that may indicate lower risk, and BGP's AML policy (4.3) allows simplified due diligence for a UK public body. No higher-risk factor was found: no sanctions match, no adverse media and nothing unusual about the transaction.`,
      "",
      k ? `Beneficial owners: ${k.ownership}. The people we deal with: [${k.people}].`
        : `Beneficial owners: none in the usual sense. It is controlled by [its members, board or senior officers: names].`,
      "",
      `Authority: ${contact || "[name]"} instructs us for ${name}. Evidence of their authority to act: [what was seen, and when].`,
      "",
      `Checked that the party is ${k ? k.self : "the public body itself"}, not a joint venture, partnership or company it has an interest in (which would need standard due diligence).`,
    );
  } else if (sdd.kind === "fund") {
    lines.push(
      `Who: ${who}.`, "",
      `Why SDD: ${sdd.basis} No higher-risk factor was found: no politically exposed person, no sanctions match, no adverse media and a clear source of funds.`, "",
      `Owners: [who owns or controls it, as identified].`, "",
      `Authority: ${contact || "[name]"} instructs us for ${name}. Evidence of their authority to act: [what was seen, and when].`,
    );
  } else {
    lines.push(
      `Who: ${who}.`, "",
      `Why SDD: ${sdd.basis} HMRC lists a company listed on a regulated market as a customer that may indicate lower risk. No higher-risk factor was found: no sanctions match, no adverse media and nothing unusual about the transaction.`, "",
      `Beneficial owners: none to verify, as the company is listed and its ownership is publicly disclosed.${sdd.kind === "listed_abroad" ? " Market and why its disclosure rules are equivalent: [market, reason]." : ""}`, "",
      `Authority: ${contact || "[name]"} instructs us for ${name}. Evidence of their authority to act: [what was seen, and when].`, "",
      `Checked that the party is the listed company itself, not a subsidiary or joint venture of it (which would need standard due diligence).`,
    );
  }
  lines.push("", "SDD reduces the checks and does not remove them: sanctions screening was done and the transaction stays under review.");
  return lines.join("\n");
}

/** A note as a person saves it: long enough to be a reason, with nothing left in square brackets. */
export function sddNoteProblem(note: unknown): string | null {
  const n = text(note);
  if (n.length < SDD_NOTE_MIN) return "Write a sentence or two on why simplified due diligence applies.";
  if (n.length > SDD_NOTE_MAX) return `Keep the note under ${SDD_NOTE_MAX} characters.`;
  const blank = n.match(/\[[^\]]{2,}\]/);
  if (blank) return `Fill in ${blank[0]} before saving, or take it out.`;
  return null;
}

export interface SavedSddNote { role: string; note: string; basis: string | null; by: string | null; at: string }
