// Reading the trust deed into the trust's structure (Jack, 23 November 2026,
// "Yes build", to filling the structure from an uploaded deed). The reader
// (server/trust-structure.ts, Anthropic, one forced-tool call) proposes the
// kind of trust, when it was settled, the governing law, the class of
// beneficiaries and the people with their roles, each with the deed's own
// words. Every value is checked here against the deed's text: a value whose
// quote is not in the deed, or whose words are not in its quote, is dropped
// with the reason. A scanned deed has no text to check against, so its values
// are kept marked "check by eye". The reading only fills the form: the form's
// Save is the only save, and it never overwrites what a person recorded.
//
// Pure: tested in server/trust-structure.test.ts.

import { nameTokens } from "./kyc-prechecks";
import {
  TRUST_KINDS, TRUST_ROLES, trustPersonKey,
  type TrustKind, type TrustPerson, type TrustRole, type TrustStructure,
} from "./trust-structure";

export const TRUST_DEED_TOOL = {
  name: "read_trust_deed",
  description: "Record what the trust deed says about the trust's structure. Every value comes with the deed's exact words it was read from.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: Object.keys(TRUST_KINDS), description: "discretionary when the trustees choose who benefits and how much; fixed when named beneficiaries have fixed shares or a life interest; bare when the beneficiary is absolutely entitled; charitable for charitable purposes; unknown when the deed does not say." },
      kindQuote: { type: "string", description: "The deed's exact words that show the kind." },
      established: { type: "string", description: "The date the deed was made or the trust settled, as the deed gives it." },
      establishedQuote: { type: "string" },
      governingLaw: { type: "string", description: "The law the deed says governs it, e.g. England and Wales." },
      governingLawQuote: { type: "string" },
      beneficiaryClass: { type: "string", description: "The class of beneficiaries as the deed describes it, in a sentence." },
      beneficiaryClassQuote: { type: "string" },
      people: {
        type: "array",
        description: "Every person or company the deed names as settlor, trustee, protector, beneficiary or with another power over the trust (an appointor, enforcer).",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The full name as the deed spells it." },
            roles: { type: "array", items: { type: "string", enum: Object.keys(TRUST_ROLES) } },
            corporate: { type: "boolean", description: "true for a company." },
            companyNumber: { type: "string" },
            share: { type: "string", description: "A beneficiary's share or interest, as the deed says." },
            quote: { type: "string", description: "The deed's exact words naming them in that role." },
          },
          required: ["name", "roles", "quote"],
        },
      },
    },
    required: ["kind", "people"],
  },
} as const;

export const trustDeedSystem = (partyName: string): string => [
  `You read a trust deed for Bruce Gillingham Pollard's anti-money laundering checks on ${partyName}.`,
  "Record only what the deed itself says. Every value must come with the deed's exact words, copied character for character, short enough to be one phrase or sentence.",
  "Do not guess, infer from outside knowledge, or fill a value the deed does not give: leave it out.",
  "Name every settlor, trustee, protector and beneficiary the deed names, and anyone else it gives a power over the trust (record them as controller). A class of beneficiaries described rather than named (\"the settlor's children\") goes in beneficiaryClass, not people.",
  "A deed of appointment or retirement changes the trustees: record the trustees as the latest document says, and say which in the quote.",
].join(" ");

export interface DeedReadLine {
  field: string;
  value: string;
  quote: string | null;
  // true: the quote is in the deed's text; null: a scanned deed, check by eye.
  checked: boolean | null;
}

export interface TrustDeedReading {
  read: boolean;
  why: string | null;              // why it could not be read
  scanned: boolean;                // no text to check the quotes against
  fields: Partial<Pick<TrustStructure, "kind" | "established" | "governingLaw" | "beneficiaryClass">>;
  people: TrustPerson[];
  lines: DeedReadLine[];
  dropped: Array<{ what: string; why: string }>;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9£%'".,-]+/g, " ").replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.replace(/\s+/g, " ").trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);

export const unreadDeed = (why: string): TrustDeedReading => ({ read: false, why, scanned: false, fields: {}, people: [], lines: [], dropped: [] });

/** The reader's answer, every value set against the deed's own text (null for a scan). */
export function checkTrustDeedRead(input: unknown, deedText: string | null): TrustDeedReading {
  const raw: any = input && typeof input === "object" ? input : {};
  const text = deedText ? norm(deedText) : null;
  const out: TrustDeedReading = { read: true, why: null, scanned: !text, fields: {}, people: [], lines: [], dropped: [] };
  const inDeed = (quote: string | null): boolean | null => {
    if (!quote) return false;
    if (text == null) return null;
    const q = norm(quote);
    return q.length >= 6 && text.includes(q);
  };
  const keep = (field: string, value: string | null, quote: string | null, wordsMustAppear: boolean): boolean => {
    if (!value) return false;
    const checked = inDeed(quote);
    if (checked === false) { out.dropped.push({ what: `${field}: ${value}`, why: quote ? "its words are not in the deed" : "no words from the deed were given" }); return false; }
    if (wordsMustAppear && checked && !nameTokens(value).every(w => norm(quote!).includes(w))) {
      out.dropped.push({ what: `${field}: ${value}`, why: "the deed's words given do not say it" });
      return false;
    }
    out.lines.push({ field, value, quote, checked });
    return true;
  };

  const kind = typeof raw.kind === "string" && raw.kind in TRUST_KINDS ? raw.kind as TrustKind : "unknown";
  if (kind !== "unknown" && keep("Kind", TRUST_KINDS[kind], str(raw.kindQuote, 400), false)) out.fields.kind = kind;
  const established = str(raw.established, 40);
  if (keep("Settled", established, str(raw.establishedQuote, 400), false)) out.fields.established = established;
  const law = str(raw.governingLaw, 80);
  if (keep("Governing law", law, str(raw.governingLawQuote, 400), false)) out.fields.governingLaw = law;
  const cls = str(raw.beneficiaryClass, 600);
  if (keep("Class of beneficiaries", cls, str(raw.beneficiaryClassQuote, 600), false)) out.fields.beneficiaryClass = cls;

  for (const p of Array.isArray(raw.people) ? raw.people.slice(0, 40) : []) {
    const name = str(p?.name, 160);
    const roles = (Object.keys(TRUST_ROLES) as TrustRole[]).filter(r => Array.isArray(p?.roles) && p.roles.includes(r));
    if (!name || !nameTokens(name).length) continue;
    if (!roles.length) { out.dropped.push({ what: name, why: "no role in the trust given" }); continue; }
    const corporate = !!p?.corporate;
    if (!corporate && nameTokens(name).length < 2) { out.dropped.push({ what: name, why: "not a full name" }); continue; }
    if (!keep(roles.map(r => TRUST_ROLES[r]).join(", "), name, str(p?.quote, 400), true)) continue;
    const key = corporate ? `co ${nameTokens(name).sort().join(" ")}` : trustPersonKey(name);
    const same = out.people.find(x => x.key === key);
    if (same) { same.roles = (Object.keys(TRUST_ROLES) as TrustRole[]).filter(r => same.roles.includes(r) || roles.includes(r)); continue; }
    out.people.push({
      key, name, roles, corporate, companyNumber: corporate ? str(p?.companyNumber, 20) : null, country: null, dob: null,
      share: roles.includes("beneficiary") ? str(p?.share, 60) : null, note: null,
    });
  }
  if (!out.lines.length) return { ...out, read: false, why: out.dropped.length ? "Nothing read could be found in the deed's own words." : "The deed did not say anything the reader could record." };
  return out;
}

/**
 * The structure the form opens on: what a person recorded stays, the deed's
 * reading fills what is blank, adds the people not already there, and adds a
 * role to a person already recorded. Registration and the settlor's wealth
 * are never read from a deed.
 */
export function mergeDeedReading(current: TrustStructure | null, read: TrustDeedReading): TrustStructure {
  const base: TrustStructure = current ? { ...current, people: current.people.map(p => ({ ...p, roles: [...p.roles] })) } : {
    kind: "unknown", established: null, governingLaw: null, trsStatus: "unknown", trsReference: null, beneficiaryClass: null, settlorWealth: null, people: [],
  };
  if (base.kind === "unknown" && read.fields.kind) base.kind = read.fields.kind;
  if (!base.established && read.fields.established) base.established = read.fields.established;
  if (!base.governingLaw && read.fields.governingLaw) base.governingLaw = read.fields.governingLaw;
  if (!base.beneficiaryClass && read.fields.beneficiaryClass) base.beneficiaryClass = read.fields.beneficiaryClass;
  for (const p of read.people) {
    const same = base.people.find(x => x.key === p.key);
    if (same) {
      same.roles = (Object.keys(TRUST_ROLES) as TrustRole[]).filter(r => same.roles.includes(r) || p.roles.includes(r));
      if (!same.share && p.share) same.share = p.share;
      if (!same.companyNumber && p.companyNumber) same.companyNumber = p.companyNumber;
    } else base.people.push(p);
  }
  return base;
}
