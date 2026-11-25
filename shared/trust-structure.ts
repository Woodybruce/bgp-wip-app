// A trust's structure, checked by BGP itself (Jack, 23 November 2026: "Remove
// KYC4u on trusts. We need you to build the trust structuring"). Until then a
// party recorded as a trust went to KYC4U in full (20 November 2026), because
// nothing in the app held what a trust is: who settled it, who the trustees
// are, whether it is discretionary, whether HMRC's Trust Registration Service
// holds it. A trust is on no public register, so these come from the client
// (the trust deed and HMRC's proof of registration) and are recorded here by
// BGP. The people recorded are the trust's beneficial owners (MLR 2017 reg 6:
// the settlor, the trustees, the beneficiaries or the class of them, and
// anyone else with control, such as a protector); each person is screened,
// and each one BGP's policy asks to verify does their own identity check
// (BGP's trust checklist, items 4 to 7; no proof of address since 25 November
// 2026: HMRC asks a trust's people for their identity). One structure per
// trust record (crm_companies.id), shared by every deal the trust is on.
//
// Pure: the server stores it (server/trust-structure.ts), the AML box, People
// to check, the screening, the sign-off and the second read read it.

import { nameTokens, personDisplayName } from "./kyc-prechecks";

export type TrustKind = "discretionary" | "fixed" | "bare" | "charitable" | "other" | "unknown";
export type TrustRole = "settlor" | "trustee" | "protector" | "beneficiary" | "controller";
export type TrsStatus = "registered" | "not_required" | "not_registered" | "unknown";

export const TRUST_KINDS: Record<TrustKind, string> = {
  discretionary: "Discretionary",
  fixed: "Fixed interest (interest in possession)",
  bare: "Bare trust",
  charitable: "Charitable trust",
  other: "Another kind",
  unknown: "Not known yet",
};
export const TRUST_ROLES: Record<TrustRole, string> = {
  settlor: "Settlor",
  trustee: "Trustee",
  protector: "Protector",
  beneficiary: "Beneficiary",
  controller: "Other control",
};
export const TRS_STATUSES: Record<TrsStatus, string> = {
  registered: "Registered with HMRC",
  not_required: "Not required to register",
  not_registered: "Should be registered, and is not",
  unknown: "Not known yet",
};
const ROLE_ORDER: TrustRole[] = ["settlor", "trustee", "protector", "beneficiary", "controller"];

export interface TrustPerson {
  key: string;
  name: string;
  roles: TrustRole[];
  // A company acting as trustee (a professional trust company, say): checked
  // as a company and screened, not asked for an identity check.
  corporate: boolean;
  companyNumber: string | null;
  country: string | null;
  dob: { month: number | null; year: number | null } | null;
  // A beneficiary's share in words ("50%", "life interest"), as the deed says.
  share: string | null;
  note: string | null;
}

export interface TrustStructure {
  kind: TrustKind;
  // When it was settled, as the deed says (a date or a year).
  established: string | null;
  governingLaw: string | null;
  trsStatus: TrsStatus;
  // HMRC's Unique Reference Number (URN) or the trust's UTR.
  trsReference: string | null;
  // A discretionary trust's class of beneficiaries, as the deed describes it.
  beneficiaryClass: string | null;
  // Where the settlor's money came from (the original funds put into the trust).
  settlorWealth: string | null;
  people: TrustPerson[];
}

export interface TrustStructureRecord {
  structure: TrustStructure;
  updatedBy: string | null;
  updatedAt: string;
}

export const TRUST_MAX_PEOPLE = 30;

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
};
const longText = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
  return s || null;
};
const oneOf = <T extends string>(v: unknown, all: Record<T, string>, fallback: T): T =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(all, v) ? v as T : fallback;

/** A person's key: the words of their name, sorted (the people rule's own key). */
export const trustPersonKey = (name: string): string => nameTokens(name).sort().join(" ");

/** The roles in words: "settlor and trustee". */
export function trustRoleWords(roles: readonly TrustRole[]): string {
  const words = ROLE_ORDER.filter(r => roles.includes(r)).map(r => (r === "controller" ? "has other control" : TRUST_ROLES[r].toLowerCase()));
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Whether BGP's policy asks this person to verify their identity and address
 * (BGP's trust checklist, items 4 to 7): the settlor, every trustee, the
 * protector and anyone else with control; a beneficiary only when the trust is
 * not discretionary (a named beneficiary of a fixed or bare trust). A company
 * acting as trustee is checked as a company, not asked.
 */
export function trustPersonOwesChecks(p: Pick<TrustPerson, "roles" | "corporate">, kind: TrustKind): boolean {
  if (p.corporate) return false;
  if (p.roles.some(r => r !== "beneficiary")) return true;
  return p.roles.includes("beneficiary") && kind !== "discretionary" && kind !== "charitable";
}

/** A structure from a request body: every field checked, nothing else kept. */
export function checkTrustStructure(body: unknown): TrustStructure | { error: string } {
  const b: any = body && typeof body === "object" ? body : {};
  const rawPeople: any[] = Array.isArray(b.people) ? b.people : [];
  if (rawPeople.length > TRUST_MAX_PEOPLE) return { error: `At most ${TRUST_MAX_PEOPLE} people on one trust.` };
  const people: TrustPerson[] = [];
  for (const raw of rawPeople) {
    const name = text(raw?.name, 160);
    if (!name) continue;
    const corporate = !!raw?.corporate;
    const key = corporate ? `co ${nameTokens(name).sort().join(" ")}` : trustPersonKey(name);
    if (!nameTokens(name).length) return { error: `"${name}" is not a name.` };
    if (!corporate && nameTokens(name).length < 2) return { error: `Give ${name}'s full name (first name and surname).` };
    const roles = ROLE_ORDER.filter(r => Array.isArray(raw?.roles) && raw.roles.includes(r));
    if (!roles.length) return { error: `Say what ${name} is to the trust (settlor, trustee, protector, beneficiary or other control).` };
    const month = Number(raw?.dob?.month);
    const year = Number(raw?.dob?.year);
    const thisYear = new Date().getUTCFullYear();
    const dob = !corporate && Number.isInteger(year) && year >= 1900 && year <= thisYear
      ? { year, month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null } : null;
    const same = people.find(p => p.key === key);
    if (same) {
      for (const r of roles) if (!same.roles.includes(r)) same.roles.push(r);
      same.roles = ROLE_ORDER.filter(r => same.roles.includes(r));
      continue;
    }
    people.push({
      key, name, roles, corporate,
      companyNumber: corporate ? text(raw?.companyNumber, 20) : null,
      country: text(raw?.country, 60),
      dob,
      share: roles.includes("beneficiary") ? text(raw?.share, 60) : null,
      note: text(raw?.note, 300),
    });
  }
  const established = text(b.established, 40);
  return {
    kind: oneOf(b.kind, TRUST_KINDS, "unknown"),
    established,
    governingLaw: text(b.governingLaw, 80),
    trsStatus: oneOf(b.trsStatus, TRS_STATUSES, "unknown"),
    trsReference: text(b.trsReference, 40),
    beneficiaryClass: longText(b.beneficiaryClass, 600),
    settlorWealth: longText(b.settlorWealth, 1200),
    people,
  };
}

export const emptyTrustStructure = (): TrustStructure => ({
  kind: "unknown", established: null, governingLaw: null, trsStatus: "unknown", trsReference: null,
  beneficiaryClass: null, settlorWealth: null, people: [],
});

export interface TrustDocumentsHeld { deed: boolean; trs: boolean }

export interface TrustGap {
  key: "structure" | "kind" | "settlor" | "trustee" | "beneficiaries" | "trs" | "trs_unregistered" | "wealth" | "deed" | "trs_excerpt";
  words: string;
  // recorded: BGP records it on the structure; document: it comes from the client.
  from: "recorded" | "document";
}

/**
 * What the trust's file still needs before an officer can sign it off (BGP's
 * trust checklist, items 1 to 7). Recorded gaps are BGP's to fill on the
 * structure; document gaps come in with the client checks (the trust deed and
 * HMRC's proof of registration) or are added to the KYC record by hand.
 */
export function trustStructureGaps(s: TrustStructure | null, docs: TrustDocumentsHeld): TrustGap[] {
  const gaps: TrustGap[] = [];
  if (!s) {
    gaps.push({ key: "structure", words: "Add the trust's information: what kind of trust, who set it up, the trustees and who benefits", from: "recorded" });
  } else {
    if (s.kind === "unknown") gaps.push({ key: "kind", words: "Say what kind of trust it is", from: "recorded" });
    if (!s.people.some(p => p.roles.includes("settlor"))) gaps.push({ key: "settlor", words: "Record the settlor", from: "recorded" });
    if (!s.people.some(p => p.roles.includes("trustee"))) gaps.push({ key: "trustee", words: "Record the trustees", from: "recorded" });
    if (s.kind !== "charitable" && !s.people.some(p => p.roles.includes("beneficiary")) && !s.beneficiaryClass) {
      gaps.push({ key: "beneficiaries", words: s.kind === "discretionary" ? "Record the class of beneficiaries" : "Record the beneficiaries", from: "recorded" });
    }
    if (s.trsStatus === "unknown") gaps.push({ key: "trs", words: "Say whether the trust is on HMRC's Trust Registration Service", from: "recorded" });
    if (s.trsStatus === "not_registered") gaps.push({ key: "trs_unregistered", words: "The trust should be on HMRC's Trust Registration Service and is not: the trustees register it first", from: "recorded" });
    if (!s.settlorWealth) gaps.push({ key: "wealth", words: "Record where the settlor's money came from", from: "recorded" });
  }
  if (!docs.deed) gaps.push({ key: "deed", words: "The trust deed is not on file", from: "document" });
  if (s?.trsStatus !== "not_required" && !docs.trs) gaps.push({ key: "trs_excerpt", words: "HMRC's proof of registration is not on file", from: "document" });
  return gaps;
}

/** The structure as plain lines, for the officers' second read, the AML file and the risk assessment. */
export function trustStructureLines(s: TrustStructure, partyName: string): string[] {
  const lines = [
    `The trust: ${partyName}. Kind: ${TRUST_KINDS[s.kind]}.${s.established ? ` Settled: ${s.established}.` : ""}${s.governingLaw ? ` Governing law: ${s.governingLaw}.` : ""}`,
    `HMRC's Trust Registration Service: ${TRS_STATUSES[s.trsStatus]}${s.trsReference ? ` (reference ${s.trsReference})` : ""}.`,
  ];
  if (s.beneficiaryClass) lines.push(`Class of beneficiaries: ${s.beneficiaryClass}`);
  if (s.settlorWealth) lines.push(`Where the settlor's money came from: ${s.settlorWealth}`);
  for (const p of s.people) {
    const born = p.dob?.year ? `, born ${p.dob.month ? `${p.dob.month}/` : ""}${p.dob.year}` : "";
    lines.push(`${personDisplayName(p.name)}: ${trustRoleWords(p.roles)}${p.corporate ? ` (a company${p.companyNumber ? `, number ${p.companyNumber}` : ""})` : ""}${born}${p.country ? `, ${p.country}` : ""}${p.share ? `, share ${p.share}` : ""}${p.note ? `. ${p.note}` : ""}`);
  }
  return lines;
}
