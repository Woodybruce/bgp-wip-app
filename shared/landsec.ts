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

// The one line of the older two-signature brief a role login signs, or null
// where the login signs either (BGP staff, a Landsec login with no role).
// This is the role as a label, not a limit on what the login sees: an asset
// manager signs as the asset manager and a leasing manager as the leasing
// manager. The server refuses the other line and the unit page does not
// offer it. A joint agent signs neither (refused on the server).
export function landsecBriefSignerOnly(role: string | null | undefined): LandsecBriefSigner | null {
  if (role === "asset_manager") return "am";
  if (role === "leasing_manager") return "leasing";
  return null;
}

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
  // True when the deal depends on one the viewer cannot see: the screens say
  // "another deal" and the id and name are not sent.
  dependsOnHidden?: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

// ── One set of numbers (docs/landsec-menu-plan-2026-11-12.md, part 7) ────
// A live letting is a letting-type deal at Marketing, Negotiating, HOTs or
// Solicitors, counted from the deal. Stuck is a deal in negotiation that has
// sat at its stage for LANDSEC_STUCK_DAYS: Marketing is left out, because
// every tracker unit has a Marketing deal and those are voids, not deals.
export const LANDSEC_LIVE_STAGES = ["AVA", "NEG", "HOT", "SOL"] as const;
export type LandsecLiveStage = (typeof LANDSEC_LIVE_STAGES)[number];
export const LANDSEC_STUCK_STAGES: readonly LandsecLiveStage[] = ["NEG", "HOT", "SOL"];
export const LANDSEC_STUCK_DAYS = 30;

// A deal in negotiation: past Marketing and not yet exchanged. These are the
// only stages that can be stuck, and the only ones chased for "who is it
// waiting on".
export const landsecInNegotiation = (code: string | null | undefined): boolean =>
  !!code && (LANDSEC_STUCK_STAGES as readonly string[]).includes(code);
export const landsecIsStuck = (code: string | null | undefined, days: number | null | undefined): boolean =>
  landsecInNegotiation(code) && days != null && days >= LANDSEC_STUCK_DAYS;

// What landsecCounts (server/landsec-counts.ts) works out for a set of
// properties. The last three say where the Letting Tracker and the deals
// disagree: the tracker shows trackerRows, Deals shows liveLettings.
export interface LandsecCount {
  stages: Record<LandsecLiveStage, number>;
  liveLettings: number;
  liveDeals: number;                 // every open deal on the properties, lettings or not
  stuck: number;                     // every open deal in negotiation for 30 days, a letting or not (as Deals counts it)
  oldestStageDays: number | null;    // the longest a deal in negotiation has sat at its stage
  trackerRows: number;               // tracker rows at one of the four stages
  rowsWithoutLetting: number;        // of those, rows with no live letting behind them
  lettingsWithoutRow: number;        // live lettings no tracker row points at
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

// With no rent free and no capital recorded the sum above returns the
// headline rent, which reads as a deal that meets its floor. A 0 counts as
// recorded (it says there is none); a blank does not. The screens then say
// "incentives not recorded" and give no pass or fail.
export const landsecIncentivesRecorded = (...values: unknown[]): boolean =>
  values.some(v => v !== null && v !== undefined && v !== "");

// How a deal's Net Effective Rent sits against the brief's floor.
// "unchecked" = there is a floor, but the incentives are not recorded.
export type LandsecBriefCheck = "pass" | "fail" | "unchecked" | null;
export function landsecBriefCheck(nerPa: number | null | undefined, floor: number | null | undefined, incentivesRecorded: boolean): LandsecBriefCheck {
  if (nerPa == null || floor == null || !floor) return null;
  if (!incentivesRecorded) return "unchecked";
  return nerPa >= floor ? "pass" : "fail";
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
  { key: "asset_manager", label: "Landsec asset manager", scope: "all schemes, as a leasing manager; the schemes ticked are the ones this person answers for" },
  { key: "joint_agent", label: "Joint agent", scope: "full control of the letting work on their schemes only; no brand pages, BGP contacts, email history or fees" },
] as const;
export type LandsecRole = (typeof LANDSEC_ROLES)[number]["key"];
// The roles held to the schemes on their login and to their own pages. An
// asset manager is not one of them (Woody, 2026-11-13: "asset managers and
// leasing landsec should be the same"): for access that role is a full
// Landsec login, and the schemes on it only say which ones the person
// answers for.
export const RESTRICTED_LANDSEC_ROLES: LandsecRole[] = ["joint_agent"];
// A role row must hold one of the three roles, spelt exactly. The table has
// no check on the column, so a row written by hand with any other value
// ("joint-agent", "JOINT_AGENT") is refused wherever the role is read: it is
// never read as a full Landsec login.
export const isKnownLandsecRole = (role: unknown): role is LandsecRole =>
  typeof role === "string" && LANDSEC_ROLES.some(r => r.key === role);
export const UNKNOWN_LANDSEC_ROLE_ERROR = "This login's Landsec role is not recognised";

// The API a joint agent login may reach (the only role this is asked for:
// restrictedLandsecApiDecision in server/landsec-access.ts). The answer is
// final at the gateway (server/index.ts): nothing on the ordinary client
// lists applies to that login, so every rule carries its own limits.
// Until 13 November 2026 an asset manager was judged here too, and its brand
// reads answered a third way, "client" (on to the ordinary client checks,
// after a review found "allow" let it read a rival landlord's records). An
// asset manager is a full Landsec login now (Woody, 2026-11-13: "asset
// managers and leasing landsec should be the same"), so the ordinary client
// gateway judges every request it makes and this rule holds nothing for it.
// Reaching a route is not the permission: each handler behind these paths
// checks the scheme. A joint agent has full control of the letting work on
// their schemes (Woody, 2026-11-12): the tracker unit, its interest,
// viewings and offers, the viewings calendar, share with a brand and their
// own tasks (read and tick). Never the unit list, the firm-wide aggregates,
// deleting a unit, the CRM requirement made from a viewing, or the generated
// Targeting Brief document.
// Of the config addresses only the maps key the browser draws with: the
// other one (/api/config/os-key) hands out a key the server pays for.
const RESTRICTED_COMMON = ["/api/landsec/", "/api/heartbeat", "/api/client/brand-theme", "/api/push/", "/api/config/maps-key", "/api/notifications"];
const UNIT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const JOINT_AGENT_UNIT = new RegExp(`^/api/available-units/${UNIT_ID}$`);
const JOINT_AGENT_UNIT_ACTIVITY = new RegExp(`^/api/available-units/${UNIT_ID}/(interest|viewings|offers)$`);
const JOINT_AGENT_ACTIVITY_ITEM = /^\/api\/available-units\/(interest|viewings|offers)\/[^/]+$/;
const JOINT_AGENT_CHAT_THREAD = new RegExp(`^/api/chat/threads/${UNIT_ID}$`);
const JOINT_AGENT_CHAT_MESSAGES = new RegExp(`^/api/chat/threads/${UNIT_ID}/messages$`);
const JOINT_AGENT_CHAT_MESSAGE = new RegExp(`^/api/chat/threads/${UNIT_ID}/messages/${UNIT_ID}$`);
const JOINT_AGENT_CHAT_ACTIVE_RUN = new RegExp(`^/api/chatbgp/threads/${UNIT_ID}/active-run$`);
const JOINT_AGENT_CHAT_CANCEL_RUN = new RegExp(`^/api/chatbgp/threads/${UNIT_ID}/cancel-run$`);
const JOINT_AGENT_BRIEF_DRAFT = new RegExp(`^/api/available-units/${UNIT_ID}/brief/draft-ai$`);

// The path a gate mounted on "/api" must judge: the one the router matches
// the request on. Never cut it out of req.originalUrl. The router stops a
// path at "#" as well as "?", so "/api/available-units/#/files" is routed to
// the unit list, and a gate reading the text up to "?" let it in as one
// unit's files.
// Reading req.path can throw on a request line that is not an address at all
// ("/api//x@y[/foo#" reads as a broken host name). The router matches no
// route for such a request, so the answer is the empty path: no rule allows
// it, and a gate must not turn it into a server error.
// The same answer when the path read here is not the one typed on the
// request line. Below a mount the router re-reads what is left of the line,
// and with a "#" in it the slower reader takes over: it turns "\" into "/"
// and reads "//user@host" as a host, so "/api\a@b/landsec/home#" came out
// here as "/api/landsec/home" while the routes were matched on
// "/api/a@b/landsec/home" (review, 2026-11-13; it reached only "Not found").
// Two readings of one request are never judged: the gate refuses.
export function routedApiPath(req: { baseUrl?: string; path?: string; originalUrl?: string }): string {
  try {
    const routed = `${req.baseUrl || ""}${req.path || ""}`.replace(/\/+$/, "");
    if (typeof req.originalUrl === "string") {
      const typed = req.originalUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/)[0].replace(/\/+$/, "");
      if (typed !== routed) return "";
    }
    return routed;
  } catch {
    return "";
  }
}

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
    // Comments not yet logged (server/letting-suggestions.ts): read the list
    // and the count, and mark one as logged or dismissed. Nothing else under
    // the path. Every handler checks the scheme, and a suggestion made from a
    // target's comments (BGP's notes) is never listed or counted for them.
    if (m === "GET" && (p === "/api/letting-suggestions" || p === "/api/letting-suggestions/count")) return "allow";
    if (m === "POST" && /^\/api\/letting-suggestions\/[^/]+\/(confirm|dismiss)$/.test(p)) return "allow";
    // Chat (Woody, 2026-11-13: "yes go ahead"). Each address is opened by
    // itself, by method: never a prefix. Reaching one is not the permission:
    // the handlers hold a joint agent to its own conversations, the people
    // it may talk to and tags at its schemes (server/chat-joint-agent.ts),
    // and its ChatBGP to a fixed set of read tools
    // (server/chatbgp-joint-agent.ts). Still closed: members after a
    // conversation is made, renaming and linking, search, the media drawer,
    // group pictures, drafts, files to ChatBGP and every other ChatBGP door.
    if ((m === "GET" || m === "POST") && p === "/api/chat/threads") return "allow";
    if ((m === "GET" || m === "DELETE") && JOINT_AGENT_CHAT_THREAD.test(p)) return "allow";
    if (m === "POST" && JOINT_AGENT_CHAT_MESSAGES.test(p)) return "allow";
    if ((m === "PUT" || m === "DELETE") && JOINT_AGENT_CHAT_MESSAGE.test(p)) return "allow";
    if (m === "GET" && (p === "/api/chat/notifications" || p === "/api/chat/tag-search")) return "allow";
    if (m === "POST" && p === "/api/chat/upload") return "allow";
    if (m === "GET" && /^\/api\/chat-media\/[^/]+$/.test(p)) return "allow";
    if (m === "GET" && p === "/api/chatbgp/status") return "allow";
    if (m === "POST" && p === "/api/chatbgp/chat") return "allow";
    if (m === "GET" && JOINT_AGENT_CHAT_ACTIVE_RUN.test(p)) return "allow";
    if (m === "POST" && JOINT_AGENT_CHAT_CANCEL_RUN.test(p)) return "allow";
  }
  // Their own task list (Woody, 2026-11-13: "we need each person to have
  // this update their own task list"): read it and tick a task. Nothing else
  // under /api/tasks: no create, delete, reorder, import or notebook link.
  // An asset manager has the ordinary client task list, as a full Landsec
  // login does.
  if (m === "GET" && p === "/api/tasks") return "allow";
  if (m === "PATCH" && /^\/api\/tasks\/[^/]+$/.test(p)) return "allow";
  return "deny";
}
