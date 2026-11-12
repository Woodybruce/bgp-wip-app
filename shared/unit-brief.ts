// The Targeting Brief workspace shared by server and client (Woody,
// 2026-11-12): who is involved in a unit's brief, the commercials, the
// plans and marketing material, each person's attributed comments, and the
// sign-off — every person involved agrees the brief, with the date.
// Storage: unit_briefs (+ commercials, agency_basis, plan_ids, brochure_ids,
// version, agreed_at), unit_brief_people, unit_brief_comments (migration 0050).

export const BRIEF_PERSON_ROLES = [
  { key: "bgp_agent", label: "BGP agent", group: "Agents" },
  { key: "joint_agent", label: "Joint agent", group: "Agents" },
  { key: "client_leasing", label: "Leasing team", group: "Client" },
  { key: "senior_asset_manager", label: "Senior asset manager", group: "Client" },
  { key: "asset_manager", label: "Asset manager", group: "Client" },
] as const;
export type BriefPersonRole = (typeof BRIEF_PERSON_ROLES)[number]["key"];
export const briefRoleLabel = (role: string | null | undefined): string =>
  BRIEF_PERSON_ROLES.find(r => r.key === role)?.label || "Involved";

export const BRIEF_AGENCY_BASES = [
  { key: "sole", label: "Sole agent" },
  { key: "joint", label: "Joint agents" },
] as const;
export type BriefAgencyBasis = (typeof BRIEF_AGENCY_BASES)[number]["key"];

// The commercial terms the brief is agreed on. Money is £ a year unless
// the label says otherwise; every field is optional.
export interface BriefCommercials {
  quotingRentPa: number | null;
  ervPa: number | null;
  nerFloorPa: number | null;            // net effective rent floor
  rentFreeMonthsMax: number | null;     // incentive ceiling: rent free
  capitalContributionMax: number | null; // incentive ceiling: landlord capital
  capexEnvelope: number | null;         // landlord works budget
  leaseTermYears: number | null;
  breakOption: string | null;
  rentReview: string | null;
  turnoverRentPct: number | null;
  serviceChargePa: number | null;
  ratesPayablePa: number | null;
  insurancePa: number | null;
  permittedUse: string | null;
  availableFrom: string | null;         // ISO date or free text ("on completion of works")
  otherTerms: string | null;
}

export const BRIEF_COMMERCIAL_FIELDS: { key: keyof BriefCommercials; label: string; kind: "money" | "number" | "percent" | "text" | "longtext"; hint?: string }[] = [
  { key: "quotingRentPa", label: "Quoting rent", kind: "money", hint: "£ a year" },
  { key: "ervPa", label: "ERV", kind: "money", hint: "£ a year" },
  { key: "nerFloorPa", label: "Net effective rent floor", kind: "money", hint: "£ a year" },
  { key: "rentFreeMonthsMax", label: "Rent free, up to", kind: "number", hint: "months" },
  { key: "capitalContributionMax", label: "Capital contribution, up to", kind: "money", hint: "£" },
  { key: "capexEnvelope", label: "Landlord works budget", kind: "money", hint: "£" },
  { key: "leaseTermYears", label: "Lease term", kind: "number", hint: "years" },
  { key: "breakOption", label: "Break", kind: "text", hint: "e.g. tenant break at year 5" },
  { key: "rentReview", label: "Rent review", kind: "text", hint: "e.g. year 5, upward only to market" },
  { key: "turnoverRentPct", label: "Turnover rent", kind: "percent", hint: "% of turnover" },
  { key: "serviceChargePa", label: "Service charge", kind: "money", hint: "£ a year" },
  { key: "ratesPayablePa", label: "Rates payable", kind: "money", hint: "£ a year" },
  { key: "insurancePa", label: "Insurance", kind: "money", hint: "£ a year" },
  { key: "permittedUse", label: "Permitted use", kind: "text" },
  { key: "availableFrom", label: "Available from", kind: "text", hint: "date or wording" },
  { key: "otherTerms", label: "Other terms", kind: "longtext" },
];

export const EMPTY_COMMERCIALS: BriefCommercials = {
  quotingRentPa: null, ervPa: null, nerFloorPa: null, rentFreeMonthsMax: null, capitalContributionMax: null,
  capexEnvelope: null, leaseTermYears: null, breakOption: null, rentReview: null, turnoverRentPct: null,
  serviceChargePa: null, ratesPayablePa: null, insurancePa: null, permittedUse: null, availableFrom: null, otherTerms: null,
};

// The most a figure on a brief can be. Anything larger is a typing slip.
export const BRIEF_FIGURE_MAX = 10_000_000_000;

// "£95,000 pa", "95k", "1.2m", 95000 → a number; "" / null → null; anything
// else → undefined (the caller shows an error rather than saving a blank).
// "pcm" and "psf" are refused: every figure here is a year's, and a monthly
// or per-square-foot figure saved as annual is wrong by a large multiple.
export function parseMoney(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) <= BRIEF_FIGURE_MAX ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const m = s.replace(/[£,\s]/g, "").replace(/(pa|perannum)$/g, "").match(/^(-?\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) && Math.abs(n) <= BRIEF_FIGURE_MAX ? n : undefined;
}

// Clean a commercials object from a form or an AI reply: known keys only,
// numbers parsed, blanks to null. Returns the bad field labels so a save
// can be refused instead of silently blanking a figure.
export function normaliseCommercials(input: unknown): { value: BriefCommercials; invalid: string[] } {
  const src = isPlainObject(input) ? input : {};
  const value: BriefCommercials = { ...EMPTY_COMMERCIALS };
  const invalid: string[] = [];
  for (const f of BRIEF_COMMERCIAL_FIELDS) {
    const raw = Object.prototype.hasOwnProperty.call(src, f.key) ? src[f.key] : null;
    if (f.kind === "text" || f.kind === "longtext") {
      if (raw !== null && raw !== undefined && typeof raw !== "string" && typeof raw !== "number") { invalid.push(f.label); continue; }
      const t = raw === null || raw === undefined ? "" : String(raw).trim();
      (value as any)[f.key] = t || null;
    } else {
      const n = f.kind === "percent" && typeof raw === "string" ? parseMoney(raw.replace(/%/g, "")) : parseMoney(raw);
      if (n === undefined || (n !== null && n < 0)) invalid.push(f.label);
      else (value as any)[f.key] = n;
    }
  }
  return { value, invalid };
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export const commercialsHaveContent = (c: BriefCommercials | null | undefined): boolean =>
  !!c && Object.values(c).some(v => v !== null && v !== undefined && v !== "");

// The brief's terms: a change to any of these raises the version, and a
// signature given on an earlier version no longer counts.
export const BRIEF_TERM_FIELDS = [
  "title", "clientCompany", "objective", "locationContext", "targetCriteria", "priorityCategories",
  "agentInstruction", "successMeasures", "instructedDate", "deadline1Date", "deadline1Deliverables",
  "deadline2Date", "deadline2Deliverables", "agencyBasis",
] as const;

export interface BriefPerson {
  id: string;
  briefId: string;
  role: BriefPersonRole;
  userId: string | null;      // a login (BGP staff or a client login)
  contactId: string | null;   // a CRM contact
  companyId: string | null;   // their firm (the joint agent's firm, the client)
  name: string;
  email: string | null;
  firm: string | null;
  agreedAt: string | null;
  agreedVersion: number | null;
  agreedByName: string | null; // who pressed the button: the person, or BGP staff recording it for them
  agreedOnBehalf: boolean;
  sortOrder: number;
}

export interface BriefComment {
  id: string;
  briefId: string;
  userId: string | null;
  userName: string | null;
  roleLabel: string | null;   // "BGP agent", "Senior asset manager", "Landsec", "BGP"
  kind: "comment" | "event";  // event = a line the app wrote (agreed, terms changed)
  body: string;
  aiAssisted: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export type BriefApprovalState = "none" | "draft" | "awaiting" | "agreed";
export type BriefSide = "agent" | "client";
export const briefSideOf = (role: string | null | undefined): BriefSide | null =>
  role === "bgp_agent" ? "agent" : role === "client_leasing" || role === "senior_asset_manager" || role === "asset_manager" ? "client" : null;
export interface BriefApproval { state: BriefApprovalState; total: number; agreed: number; stale: number; missing: BriefSide[] }

// Where sign-off stands. A person counts only if they agreed the CURRENT
// version. "Agreed" means everyone on the brief has agreed AND both sides
// are on it: at least one BGP agent and at least one of the client's people.
// Without that rule, taking the people who have not signed off the brief
// would turn it to agreed on one side's signature alone.
export function briefApproval(version: number, people: { agreedAt: unknown; agreedVersion: number | null; role?: string | null }[]): BriefApproval {
  const total = people.length;
  const agreed = people.filter(p => p.agreedAt && p.agreedVersion === version).length;
  const stale = people.filter(p => p.agreedAt && p.agreedVersion !== version).length;
  const missing: BriefSide[] = [];
  if (total > 0 && !people.some(p => briefSideOf(p.role) === "agent")) missing.push("agent");
  if (total > 0 && !people.some(p => briefSideOf(p.role) === "client")) missing.push("client");
  const state: BriefApprovalState = total === 0 ? "none"
    : agreed === total && missing.length === 0 ? "agreed"
    : agreed > 0 || stale > 0 ? "awaiting" : "draft";
  return { state, total, agreed, stale, missing };
}

export const briefMissingText = (missing: BriefSide[]): string =>
  missing.length === 2 ? "a BGP agent and the client's people" : missing[0] === "agent" ? "a BGP agent" : missing[0] === "client" ? "the client's people" : "";

export function briefApprovalLabel(a: { state: BriefApprovalState; total: number; agreed: number; missing?: BriefSide[] }): string {
  if (a.state === "agreed") return "Brief agreed";
  if (a.state === "awaiting") return `Awaiting sign-off · ${a.agreed} of ${a.total}`;
  if (a.state === "draft") return `Not yet signed · 0 of ${a.total}`;
  return "No one added yet";
}

export interface BriefFileRef { id: string; name: string; url: string; category: string; mimeType: string | null; createdAt: string | null }
export interface BriefPlanRef { id: string; floor: string | null; source: string | null; imageUrl: string; attached: boolean }
export interface BriefBrochureRef { id: string; name: string; url: string | null; type: string | null; attached: boolean }

export interface BriefViewer {
  userId: string | null;
  name: string | null;
  isStaff: boolean;            // BGP staff (may record a signature for someone, manage everything)
  canEditTerms: boolean;       // may change the brief, commercials, people and files
  canComment: boolean;
  personIds: string[];         // the people rows that are this login
  roleLabel: string;           // how this login's comments are labelled
}

export interface BriefWorkspace {
  brief: Record<string, any> & { id: string; unitId: string; propertyId: string; version: number; agencyBasis: BriefAgencyBasis | null; commercials: BriefCommercials; agreedAt: string | null; termsUpdatedAt: string | null; termsUpdatedByName: string | null };
  unit: { id: string; unitName: string; propertyId: string; propertyName: string | null; floor: string | null; sqft: number | null; marketingStatus: string | null;
    tenancy: { id: string; unitName: string | null; status: string | null; tenant: string | null; leaseExpiry: string | null } | null };
  unitDefaults: Partial<BriefCommercials>; // what the unit already holds, offered when a field is blank
  people: BriefPerson[];
  comments: BriefComment[];
  approval: BriefApproval & { label: string };
  files: BriefFileRef[];        // the unit's own files (plans, brochure, photos, other)
  plans: BriefPlanRef[];        // the property's plans; attached = on this brief
  brochures: BriefBrochureRef[]; // the scheme's brochures; attached = on this brief
  viewer: BriefViewer;
}

export interface BriefPeopleCandidates {
  bgp: { userId: string; name: string; email: string | null }[];
  client: { contactId: string | null; userId: string | null; name: string; role: string | null; email: string | null }[];
  clientCompany: { id: string | null; name: string | null };
  agentFirms: { companyId: string; name: string; contacts: { contactId: string; name: string; role: string | null; email: string | null }[] }[];
}

// How the fee is split between the agents the client has instructed, in
// words: "Sole agent: BGP 100%" or "Joint agents: BGP 60%, CBRE 40%". Null
// when the basis is not set. Shown to everyone on the brief, the joint agent
// included (their own share, and clarity with the client).
export function agentFeeSplitText(basis: string | null | undefined, jointAgentFeePct: number | null | undefined, jointAgentName?: string | null): string | null {
  if (basis === "sole") return "Sole agent: BGP 100%";
  if (basis !== "joint") return null;
  const who = jointAgentName || "joint agent";
  if (jointAgentFeePct === null || jointAgentFeePct === undefined) return "Joint agents: fee split not set yet";
  const bgp = Math.round((100 - Number(jointAgentFeePct)) * 100) / 100;
  return `Joint agents: BGP ${bgp}%, ${who} ${Number(jointAgentFeePct)}%`;
}
