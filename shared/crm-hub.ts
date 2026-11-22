// The CRM page's one list (Woody, 2026-11-15): landlords, brands, agents and
// lenders drawn the same way, every row saying who at BGP owns the
// relationship, when we last spoke, the next action and whether it is on a
// CRM strategy. All landlords, agents and lenders are listed; brands are only
// the ones BGP is working ("otherwise lose focus"). The feed is
// server/crm-hub.ts (BGP staff only); the rules that decide which list a
// company is on live here, with tests in server/crm-hub.test.ts.
import { latestPastContact, readLastContact } from "./last-contact";
import { londonDayOf } from "./brand-diary";

export type CrmHubKind = "landlord" | "brand" | "agent" | "lender";
export const CRM_HUB_KINDS: CrmHubKind[] = ["landlord", "brand", "agent", "lender"];
export const isCrmHubKind = (value: unknown): value is CrmHubKind => CRM_HUB_KINDS.includes(value as CrmHubKind);

export interface CrmHubPerson { id: string; name: string; role: string | null; email: string | null; phone: string | null }
export interface CrmHubRow {
  id: string; name: string; kind: CrmHubKind; companyType: string | null; domain: string | null; description: string | null;
  isClient: boolean;
  subType: string | null;
  city: string | null;
  owners: Array<{ id: string; name: string }>;
  /** True when nobody is set on the account and the owners are the BGP agents on its deals. */
  ownersFromDeals?: boolean;
  lastContactAt: string | null;
  nextContactAt: string | null;
  openActions: number;
  nextAction: { id: string; title: string; dueAt: string | null; ownerName: string | null; overdue: boolean } | null;
  strategies: Array<{ id: string; name: string }>;
  contactCount: number;
  people: CrmHubPerson[];
  counts: { properties?: number; deals?: number; requirements?: number; brandsRepresented?: number };
  line: string | null;
  why?: string[];
  /** A brand BGP has starred as a Super Brand (hunter_flag): VIP, listed first. */
  superBrand?: boolean;
}
export interface CrmHubResponse { kind: CrmHubKind; rows: CrmHubRow[]; owners: Array<{ id: string; name: string }>; cities: string[]; subTypes: string[] }
export const CRM_HUB_PEOPLE_SHOWN = 6;

// ── Which list a company is on ──────────────────────────────────────────────

export interface CrmHubCompanyLike {
  name?: string | null; companyType?: string | null; isPortfolioAccount?: boolean | null;
  domain?: string | null; domainUrl?: string | null;
}
const typeOf = (company: CrmHubCompanyLike) => String(company.companyType || "").toLowerCase().trim();

// BGP's own firm is not an outside agent.
export function isOwnFirm(company: CrmHubCompanyLike): boolean {
  if (/bruce\s+gillingham\s+pollard/i.test(company.name || "")) return true;
  return `${company.domain || ""} ${company.domainUrl || ""}`.toLowerCase().includes("brucegillinghampollard.com");
}

export const LANDLORD_TYPES = ["landlord", "client", "landlord / client"] as const;
export const CLIENT_TYPES = ["client", "landlord / client"] as const;
export const LENDER_TYPES = [
  "lender", "clearing bank", "investment bank", "insurance lender",
  "pension fund", "debt fund", "private credit", "mezzanine",
  "bridging", "development finance", "building society",
] as const;

export const isLandlordCompany = (company: CrmHubCompanyLike) => (LANDLORD_TYPES as readonly string[]).includes(typeOf(company)) || company.isPortfolioAccount === true;
export const isAgentCompany = (company: CrmHubCompanyLike) => typeOf(company) === "agent" && !isOwnFirm(company);
export const isLenderType = (companyType: string | null | undefined) => {
  const type = String(companyType || "").toLowerCase().trim();
  return LENDER_TYPES.some(lender => type.includes(lender));
};
export const isBrandCompany = (company: CrmHubCompanyLike) => typeOf(company).startsWith("tenant");
// The crown: a company BGP acts for.
export const isCrmClient = (company: CrmHubCompanyLike) => (CLIENT_TYPES as readonly string[]).includes(typeOf(company)) || company.isPortfolioAccount === true;

/** Is this company on the list of that kind? A brand must also be one BGP is working (brandWhy). */
export function companyIsKind(company: CrmHubCompanyLike, kind: CrmHubKind): boolean {
  if (kind === "landlord") return isLandlordCompany(company);
  if (kind === "agent") return isAgentCompany(company);
  if (kind === "lender") return isLenderType(company.companyType);
  return isBrandCompany(company);
}
/** Every list a company's type puts it on (a portfolio account that is also a lender is on two). */
export const crmHubKindsOf = (company: CrmHubCompanyLike): CrmHubKind[] => CRM_HUB_KINDS.filter(kind => companyIsKind(company, kind));

export const LENDER_SUB_TYPES = ["Banks", "Debt Funds", "Insurance/Pension", "Private/Bridge", "Other"] as const;
export type LenderSubType = typeof LENDER_SUB_TYPES[number];
export function lenderSubType(companyType: string | null | undefined): LenderSubType {
  const type = String(companyType || "").toLowerCase().trim();
  if (type.includes("clearing bank") || type.includes("investment bank") || type.includes("building society")) return "Banks";
  if (type.includes("debt fund")) return "Debt Funds";
  if (type.includes("insurance") || type.includes("pension")) return "Insurance/Pension";
  if (type.includes("private credit") || type.includes("mezzanine") || type.includes("bridging") || type.includes("development finance")) return "Private/Bridge";
  return "Other";
}

// ── The brands BGP is working ───────────────────────────────────────────────

export interface BrandWorkSignals { onStrategy: boolean; openAction: boolean; liveDeal: boolean; requirement: boolean; hunterPick: boolean }
export const BRAND_WHY = { onStrategy: "On a strategy", openAction: "Open action", liveDeal: "Live transaction", requirement: "Requirement", hunterPick: "Super Brand" } as const;
/**
 * Why a brand is on the CRM list, in a fixed order; an empty answer means it
 * is not on it. On a CRM strategy that is not completed, an open CRM action,
 * tenant on a deal that is not closed, a requirement that is live or to
 * confirm by the one live rule, or starred as a Super Brand (hunter_flag,
 * once called a Hunter pick).
 */
export function brandWhy(signals: Partial<BrandWorkSignals>): string[] {
  return (Object.keys(BRAND_WHY) as Array<keyof BrandWorkSignals>).filter(key => signals[key] === true).map(key => BRAND_WHY[key]);
}

// ── What a row shows ────────────────────────────────────────────────────────

// Some stored descriptions are the enrichment model's failure message, and a
// stored "…" / "..." tail collapses to one ellipsis.
export function shownDescription(description: string | null | undefined): string | null {
  if (!description || /^\s*(unable to identify|i could not|i couldn['’]t|no (reliable )?information)/i.test(description)) return null;
  const text = description.trim();
  if (!text) return null;
  return /(\.{2,}|…)$/.test(text) ? `${text.replace(/[\s.…]+$/, "")}…` : text;
}

const UK = /^(uk|united kingdom|england|scotland|wales|northern ireland|gb|great britain)$/i;
/**
 * The town shown for a company: the Companies House registered office first
 * (global firms' head offices read "Los Angeles"), then the head office city
 * unless the head office is outside the UK.
 */
export function companyCity(registeredLocality: string | null | undefined, headOffice: any): string | null {
  const registered = String(registeredLocality || "").trim();
  if (registered) return registered.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
  const address = headOffice && typeof headOffice === "object" ? headOffice : null;
  const country = String(address?.country || "").trim();
  if (country && !UK.test(country)) return null;
  const city = String(address?.city || "").trim();
  return city || null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const trimNumber = (value: number) => String(Math.round(value * 100) / 100);

export function landlordLine(counts: { properties?: number; deals?: number }): string | null {
  const parts = [
    counts.properties ? plural(counts.properties, "property", "properties") : "",
    counts.deals ? plural(counts.deals, "live transaction", "live transactions") : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
export function agentLine(counts: { brandsRepresented?: number }): string | null {
  return counts.brandsRepresented ? `Acts for ${plural(counts.brandsRepresented, "brand", "brands")}` : null;
}
export function loanRange(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min != null && max != null) return `£${trimNumber(min)}m–£${trimNumber(max)}m`;
  if (min != null) return `£${trimNumber(min)}m+`;
  if (max != null) return `up to £${trimNumber(max)}m`;
  return null;
}
/** "Typical LTV 60% · £5m–£50m · Active". Appetite is said only when it was recorded. */
export function lenderLine(lender: { typicalLtvMax?: number | null; loanMin?: number | null; loanMax?: number | null; lendingActive?: boolean | null }): string | null {
  const parts = [
    lender.typicalLtvMax != null ? `Typical LTV ${trimNumber(lender.typicalLtvMax)}%` : "",
    loanRange(lender.loanMin, lender.loanMax) || "",
    lender.lendingActive === true ? "Active" : lender.lendingActive === false ? "Paused" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// ── Contact and next action ─────────────────────────────────────────────────

/**
 * The latest contact that has happened and the nearest one ahead, by the
 * rules in shared/last-contact.ts: a date ahead is never a last contact.
 */
export function contactDates(values: Array<string | Date | null | undefined>, now: number = Date.now()): { lastContactAt: string | null; nextContactAt: string | null } {
  let next: number | null = null;
  for (const value of values) {
    const read = readLastContact(value, now);
    if (read.kind === "next" && (next === null || read.at < next)) next = read.at;
  }
  const last = latestPastContact(values, now);
  return { lastContactAt: last ? new Date(last).toISOString() : null, nextContactAt: next === null ? null : new Date(next).toISOString() };
}

export interface OpenActionLike { id: string; title: string; dueAt: string | null; createdAt?: string | null; ownerName: string | null }
/** The open action to show: the earliest due, an undated one last, the newest first among equals. Overdue = due before today in London. */
export function nextActionOf(actions: OpenActionLike[], now: number = Date.now()): CrmHubRow["nextAction"] {
  const due = (action: OpenActionLike) => action.dueAt ? Date.parse(action.dueAt) : Infinity;
  const created = (action: OpenActionLike) => action.createdAt ? Date.parse(action.createdAt) : 0;
  const first = [...actions].sort((a, b) => due(a) - due(b) || created(b) - created(a))[0];
  if (!first) return null;
  const dueDay = londonDayOf(first.dueAt);
  const today = londonDayOf(new Date(now));
  return { id: first.id, title: first.title, dueAt: first.dueAt, ownerName: first.ownerName, overdue: !!dueDay && !!today && dueDay < today };
}

export interface RankablePerson extends CrmHubPerson { favourite?: boolean; lastContactAt?: string | null }
/**
 * The people most worth showing first: a favourite, then whoever BGP spoke
 * to most recently, then the people with a job title and a way to reach them,
 * then by name.
 */
export function rankPeople<T extends RankablePerson>(people: T[]): T[] {
  const time = (person: RankablePerson) => person.lastContactAt ? Date.parse(person.lastContactAt) || 0 : 0;
  const reach = (person: RankablePerson) => Number(!!person.role) + Number(!!person.email) + Number(!!person.phone);
  return [...people].sort((a, b) => Number(b.favourite === true) - Number(a.favourite === true)
    || time(b) - time(a) || reach(b) - reach(a) || a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
}

// ── The list's filters (the screen and its counts use the same tests) ───────

export const CRM_HUB_QUIET_DAYS = 90;
export type CrmHubFilter = "all" | "strategy" | "no-strategy" | "no-next" | "quiet";
export const CRM_HUB_FILTERS: Array<{ key: CrmHubFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "strategy", label: "On a strategy" },
  { key: "no-strategy", label: "No strategy" },
  { key: "no-next", label: "No next step" },
  { key: "quiet", label: `No contact in ${CRM_HUB_QUIET_DAYS} days` },
];
/** No contact in 90 days: never spoken to, or last spoken to over 90 days ago. A meeting booked ahead does not count as contact. */
export function rowIsQuiet(row: Pick<CrmHubRow, "lastContactAt">, now: number = Date.now()): boolean {
  const read = readLastContact(row.lastContactAt, now);
  return read.kind !== "last" || read.days > CRM_HUB_QUIET_DAYS;
}
export function rowMatchesFilter(row: Pick<CrmHubRow, "strategies" | "nextAction" | "lastContactAt">, filter: CrmHubFilter, now: number = Date.now()): boolean {
  if (filter === "strategy") return row.strategies.length > 0;
  if (filter === "no-strategy") return row.strategies.length === 0;
  if (filter === "no-next") return !row.nextAction;
  if (filter === "quiet") return rowIsQuiet(row, now);
  return true;
}
/** The search box: the company's name, type, description and town, its owners, strategies and the people in the row. */
export function rowMatchesSearch(row: CrmHubRow, text: string): boolean {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return true;
  return [row.name, row.companyType, row.description, row.city, row.line, ...row.owners.map(owner => owner.name),
    ...row.strategies.map(strategy => strategy.name), ...row.people.map(person => person.name)]
    .some(value => String(value || "").toLowerCase().includes(wanted));
}
