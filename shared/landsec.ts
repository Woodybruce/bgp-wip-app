// Landsec workspace constants shared by server and client
// (docs/landsec-pitch-plan.md). The brief categories are the Hospitality &
// Leisure categories of the instruction; the four London schemes also take
// all retail.
export const LANDSEC_BRIEF_CATEGORIES = [
  "Restaurants & Bars",
  "Café, Grab & Go and QSR",
  "Food Halls",
  "Competitive Socialising",
  "Active Leisure",
  "Gyms, Wellness & Softplay",
  "Retail (London schemes)",
] as const;
export type LandsecBriefCategory = (typeof LANDSEC_BRIEF_CATEGORIES)[number];

export type LandsecBriefSigner = "leasing" | "am";

export interface LandsecAgreedBrief {
  use: string | null;
  category: string | null;
  nerFloor: number | null;          // net effective rent floor, £ pa
  incentiveCeiling: string | null;  // e.g. "12 months rent free, no capital contribution"
  capexEnvelope: number | null;     // £
  targetBrands: string | null;
  notes: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  leasing: { by: string | null; at: string | null };
  am: { by: string | null; at: string | null };
}

export function briefStatus(b: LandsecAgreedBrief | null | undefined): "agreed" | "awaiting_am" | "awaiting_leasing" | "unsigned" | "empty" {
  if (!b) return "empty";
  const hasContent = !!(b.use || b.category || b.nerFloor || b.incentiveCeiling || b.capexEnvelope || b.targetBrands);
  if (!hasContent) return "empty";
  if (b.leasing.at && b.am.at) return "agreed";
  if (b.leasing.at) return "awaiting_am";
  if (b.am.at) return "awaiting_leasing";
  return "unsigned";
}

// ── Deal clock (item 4) ─────────────────────────────────────────────────
export const LANDSEC_WAITING_PARTIES = [
  "Landsec asset manager",
  "Landsec leasing manager",
  "Landsec approval (CAPR / board)",
  "Tenant",
  "Tenant's agent",
  "Landsec solicitors",
  "Tenant's solicitors",
  "BGP",
  "Joint agent",
  "Another deal",
] as const;

export interface LandsecDealClock {
  waitingOnParty: string | null;
  waitingOnName: string | null;
  waitingSince: string | null;
  waitingNote: string | null;
  dependsOnDealId: string | null;
  dependsOn?: { id: string; ref: number | null; name: string; unit: string | null } | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

// Net Effective Rent as Landsec defines it: the headline rent less the
// annual cost of the incentives spread over the MINIMUM term — the term
// certain to the first break — not the full lease.
//   NER pa = (headline × (termCertain − rentFreeYears) − capital) / termCertain
export interface LandsecNer {
  nerPa: number;
  headlinePa: number;
  termCertainYears: number;
  rentFreeMonths: number;
  capital: number;
  assumedTerm: boolean;
}

const numIn = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const m = String(s).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// "10 years", "10 yrs", "10" → 10. Break: "5th year", "year 5", "5", "break at year 5",
// "mutual break 2031" (a year, not a term — ignored).
export function termCertainYears(leaseLength: string | number | null | undefined, breakOption: string | null | undefined): { years: number; assumed: boolean } {
  const full = numIn(leaseLength);
  const b = (breakOption || "").toLowerCase();
  let brk: number | null = null;
  if (b && !/\bno\b|none|n\/a/.test(b)) {
    const m = b.match(/(\d+(\.\d+)?)/);
    if (m) {
      const v = parseFloat(m[1]);
      brk = v > 0 && v < 100 ? v : null; // a calendar year ("2031") is not a term
    }
  }
  if (full && brk && brk < full) return { years: brk, assumed: false };
  if (brk && !full) return { years: brk, assumed: false };
  if (full) return { years: full, assumed: false };
  return { years: 5, assumed: true };
}

export function landsecNer(input: {
  headlinePa: number | null | undefined;
  rentFreeMonths?: number | null;
  capital?: number | null;
  leaseLength?: string | number | null;
  breakOption?: string | null;
  termYears?: number | null;
}): LandsecNer | null {
  const headlinePa = Number(input.headlinePa);
  if (!headlinePa || headlinePa < 1000) return null;
  const tc = input.termYears && input.termYears > 0 ? { years: input.termYears, assumed: false } : termCertainYears(input.leaseLength, input.breakOption);
  const rentFreeMonths = Math.max(0, Number(input.rentFreeMonths) || 0);
  const rentFreeYears = Math.min(rentFreeMonths / 12, tc.years);
  const capital = Math.max(0, Number(input.capital) || 0);
  const nerPa = (headlinePa * (tc.years - rentFreeYears) - capital) / tc.years;
  if (!Number.isFinite(nerPa)) return null;
  return { nerPa: Math.round(nerPa), headlinePa: Math.round(headlinePa), termCertainYears: tc.years, rentFreeMonths, capital, assumedTerm: tc.assumed };
}

// ── Brand case (item 5) ─────────────────────────────────────────────────
export const LANDSEC_CASE_RESPONSES = [
  { key: "seen", label: "Seen" },
  { key: "supportive", label: "Supportive" },
  { key: "concerns", label: "Concerns" },
  { key: "visit", label: "Wants a store visit" },
] as const;
export type LandsecCaseResponse = (typeof LANDSEC_CASE_RESPONSES)[number]["key"];

export interface LandsecCaseEvidence { id: string; kind: "photo" | "video" | "link" | "file"; url: string; caption: string | null; fileKey?: string | null; mimeType?: string | null }
export interface LandsecCaseUnit { id: string; schemeKey: string; schemeName?: string; tenancyUnitId: string | null; unitLabel: string; note: string | null; status: string | null }

// ── Logins by role and scheme (item 6) ──────────────────────────────────
export const LANDSEC_ROLES = [
  { key: "leasing_manager", label: "Landsec leasing manager", scope: "all schemes" },
  { key: "asset_manager", label: "Landsec asset manager", scope: "their schemes; brand pages and brand cases portfolio-wide" },
  { key: "joint_agent", label: "Joint agent", scope: "full control of the letting work on their schemes only; no brand pages, BGP contacts, email history or fees" },
] as const;
export type LandsecRole = (typeof LANDSEC_ROLES)[number]["key"];
export const RESTRICTED_LANDSEC_ROLES: LandsecRole[] = ["asset_manager", "joint_agent"];

// The API an asset manager or joint agent login may reach. The answer is
// final at the gateway (server/index.ts): nothing on the ordinary client
// lists applies to these logins, so every rule carries its own limits.
// Reaching a route is not the permission: each handler behind these paths
// checks the scheme. A joint agent has full control of the letting work on
// their schemes (Woody, 2026-11-12), so the tracker unit, its interest,
// viewings and offers, the viewings calendar, share with a brand and their
// own tasks are open to that role only. Never the unit list, the firm-wide
// aggregates, deleting a unit, the CRM requirement made from a viewing, or
// the generated Targeting Brief document.
const RESTRICTED_COMMON = ["/api/landsec/", "/api/heartbeat", "/api/client/brand-theme", "/api/push/", "/api/config/", "/api/notifications"];
const ASSET_MANAGER_READS = ["/api/crm/companies/", "/api/brands/", "/api/brand-logo/", "/api/brand/", "/api/covenant/by-crm/", "/api/client/crm/"];
const UNIT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JOINT_AGENT_UNIT = new RegExp(`^/api/available-units/${UNIT_ID}$`);
const JOINT_AGENT_UNIT_ACTIVITY = new RegExp(`^/api/available-units/${UNIT_ID}/(interest|viewings|offers)$`);
const JOINT_AGENT_ACTIVITY_ITEM = /^\/api\/available-units\/(interest|viewings|offers)\/[^/]+$/;
const JOINT_AGENT_BRIEF_DRAFT = new RegExp(`^/api/available-units/${UNIT_ID}/brief/draft-ai$`);

export function restrictedLandsecApiRule(role: LandsecRole, method: string, path: string): "allow" | "deny" {
  const p = path.toLowerCase().replace(/\/+$/, "");
  const m = method.toUpperCase();
  const hit = (list: string[]) => list.some(pre => pre.endsWith("/") ? p.startsWith(pre) : (p === pre || p.startsWith(pre + "/")));
  const jointAgent = role === "joint_agent";
  if (hit(RESTRICTED_COMMON)) {
    // Joint agents never see brand cases (BGP's brand work).
    if (jointAgent && p.startsWith("/api/landsec/brand-case")) return "deny";
    return "allow";
  }
  if (role === "asset_manager" && m === "GET" && hit(ASSET_MANAGER_READS)) return "allow";
  // The generated Targeting Brief document carries BGP's notes on the
  // target brands: a joint agent does not make it.
  if (jointAgent && /^\/api\/unit-briefs\/[^/]+\/generate-document$/.test(p)) return "deny";
  // The Targeting Brief on their own schemes (server/unit-brief-workspace.ts):
  // the brief, its people, comments and sign-off, the unit's files, and the
  // plan and brochure files a brief links to. Every handler checks the
  // scheme with briefAccess.
  if (p === "/api/unit-briefs" || p.startsWith("/api/unit-briefs/")) return "allow";
  // The negotiation log, the Heads of Terms, the deal checklist and the
  // transaction recommendation on their own schemes: every handler checks
  // the scheme with briefAccess.
  if (p.startsWith("/api/unit-offers/") || p.startsWith("/api/unit-hots/") || p.startsWith("/api/deal-checklists/") || p.startsWith("/api/unit-recommendations/")) return "allow";
  if (/^\/api\/available-units\/[^/]+\/(brief|files)$/.test(p)) return "allow";
  // The AI draft of the brief, for the roles that can change the brief.
  if (role === "asset_manager" && m === "POST" && /^\/api\/available-units\/[^/]+\/brief\/draft-ai$/.test(p)) return "allow";
  // The people pickers read the names of the people on the account.
  if (m === "GET" && p === "/api/users") return "allow";
  if (/^\/api\/available-units\/files\/[^/]+$/.test(p)) return "allow";
  if (m === "GET" && (/^\/api\/plans\/[^/]+\/image$/.test(p) || /^\/api\/properties\/[^/]+\/brochures\/[^/]+\/file$/.test(p))) return "allow";
  if (jointAgent) {
    // Share with a brand (server/unit-share.ts).
    if (p.startsWith("/api/unit-share/")) return "allow";
    // Add a unit, and read or change one unit. Not the list, not a delete.
    if (m === "POST" && p === "/api/available-units") return "allow";
    if ((m === "GET" || m === "PATCH") && JOINT_AGENT_UNIT.test(p)) return "allow";
    // Interest, viewings and offers on a unit, and one line of each.
    if (JOINT_AGENT_UNIT_ACTIVITY.test(p) || JOINT_AGENT_ACTIVITY_ITEM.test(p)) return "allow";
    if (m === "POST" && JOINT_AGENT_BRIEF_DRAFT.test(p)) return "allow";
    // The viewings calendar. Making a CRM requirement from a viewing stays
    // with BGP.
    if (m === "GET" && (p === "/api/leasing-viewings" || p === "/api/leasing-viewings/options" || p === "/api/leasing-viewings/report")) return "allow";
    if (m === "PATCH" && /^\/api\/leasing-viewings\/[^/]+$/.test(p)) return "allow";
    if (m === "POST" && (/^\/api\/leasing-viewings\/[^/]+\/units$/.test(p) || /^\/api\/leasing-viewings\/[^/]+\/offers\/[^/]+\/confirm$/.test(p))) return "allow";
    // Their own task list: read it and tick a task.
    if (m === "GET" && p === "/api/tasks") return "allow";
    if (m === "PATCH" && /^\/api\/tasks\/[^/]+$/.test(p)) return "allow";
  }
  return "deny";
}
