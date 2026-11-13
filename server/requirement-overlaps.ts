// News joined to requirements IN CODE, by the brand's CRM id (Woody,
// 2026-11-12; docs/requirements-review-2026-11-12.md, "Weekly insights, the
// daily digest and leads"). The Friday report and the leads prompt used to
// hand the AI a list of news and a list of requirements and ask it to spot
// the overlap. Both brand_signals and crm_requirements_leasing carry the
// brand's company id, so the overlap is a join, and every requirement in it
// is labelled by the one live rule (shared/requirement-live.ts): only Live
// is a live requirement.
//
// Read-only. BGP staff reports only: nothing here is served to a client login.
import { requirementReason, requirementStateSql, requirementLiveColumnsSql, REQUIREMENT_STATE_LABELS, REQUIREMENT_LIVE_DAYS, REQUIREMENT_GOING_STALE_DAYS, type RequirementState } from "@shared/requirement-live";

type Db = { query(sql: string, params?: any[]): Promise<{ rows: any[] }> };

// The story types that say something about whether a brand wants space.
export const OVERLAP_SIGNAL_TYPES = ["opening", "funding", "requirement", "hiring", "closure"] as const;

export const REQUIREMENTS_TO_CONFIRM_PATH = "/requirements?list=to_confirm";

export interface OverlapRequirement { id: string; name: string | null; state: RequirementState; stateLabel: string; reason: string; size: string | null; locations: string | null }
export interface OverlapSignal { type: string; headline: string; date: Date | null; source: string | null; sentiment: string | null }
export interface RequirementNewsOverlap { companyId: string; brand: string; requirements: OverlapRequirement[]; signals: OverlapSignal[] }
export interface RequirementNewsOverlaps {
  windowDays: number;
  overlaps: RequirementNewsOverlap[];
  /** Open requirement rows with no brand link: they cannot be joined to news and are counted, not guessed at. */
  unlinkedRequirements: number;
}

const list = (v: any): string | null => {
  const s = (Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v || "")).trim();
  return s ? s.slice(0, 120) : null;
};

/** Where a signal came from, in a word or two: a publisher's host, "Propel", "Newsletter". */
export function overlapSource(source: string | null | undefined, detail?: string | null): string | null {
  const src = String(source || "").trim();
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) { try { return new URL(src).hostname.replace(/^www\./i, ""); } catch { return null; } }
  if (/^newsletter:/i.test(src)) return /propel/i.test(`${src} ${detail || ""}`) ? "Propel" : "Newsletter";
  return src.slice(0, 60);
}

/** Group the joined rows by brand: best-evidenced requirement first, newest story first, brands with a live requirement first. */
export function groupOverlaps(signals: any[], requirements: any[], now: Date, limit = 40): RequirementNewsOverlap[] {
  const byBrand = new Map<string, RequirementNewsOverlap & { weight: number }>();
  for (const r of requirements) {
    const id = String(r.company_id || "");
    if (!id) continue;
    const why = requirementReason(r, now);
    if (why.state === "closed") continue;
    const b = byBrand.get(id) || { companyId: id, brand: String(r.brand || r.name || "").trim(), requirements: [], signals: [], weight: 0 };
    b.requirements.push({ id: String(r.id), name: r.name ?? null, state: why.state, stateLabel: REQUIREMENT_STATE_LABELS[why.state], reason: why.text, size: list(r.size), locations: list(r.requirement_locations) });
    b.weight = Math.max(b.weight, why.weight);
    byBrand.set(id, b);
  }
  for (const s of signals) {
    const b = byBrand.get(String(s.brand_company_id || ""));
    if (!b) continue;
    const headline = String(s.headline || "").trim();
    if (!headline || b.signals.some(x => x.headline.toLowerCase() === headline.toLowerCase())) continue;
    b.signals.push({ type: s.signal_type, headline: headline.slice(0, 200), date: s.at ? new Date(s.at) : null, source: overlapSource(s.source, s.detail), sentiment: s.sentiment ?? null });
  }
  const order: Record<RequirementState, number> = { live: 0, to_confirm: 1, background: 2, closed: 3 };
  return [...byBrand.values()].filter(b => b.signals.length)
    .map(b => ({ ...b, requirements: b.requirements.sort((x, y) => order[x.state] - order[y.state]).slice(0, 3),
      signals: b.signals.sort((x, y) => (y.date?.getTime() || 0) - (x.date?.getTime() || 0)).slice(0, 4) }))
    .sort((x, y) => y.weight - x.weight || (y.signals[0].date?.getTime() || 0) - (x.signals[0].date?.getTime() || 0))
    .slice(0, limit)
    .map(({ weight, ...b }) => b);
}

export async function requirementNewsOverlaps(db: Db, opts: { days?: number; now?: Date; limit?: number } = {}): Promise<RequirementNewsOverlaps> {
  const days = opts.days ?? 7;
  const now = opts.now ?? new Date();
  const state = requirementStateSql("r", "$1");
  const signals = (await db.query(
    `SELECT s.brand_company_id, s.signal_type, s.headline, s.detail, s.source, s.sentiment, coalesce(s.signal_date, s.created_at) AS at
       FROM brand_signals s JOIN crm_companies c ON c.id = s.brand_company_id AND c.merged_into_id IS NULL
      WHERE s.signal_type = ANY($2::text[]) AND s.ai_relevant IS DISTINCT FROM FALSE
        AND coalesce(s.source, '') NOT LIKE 'bgp-deal:%'
        AND coalesce(s.signal_date, s.created_at) > ($1)::timestamp - make_interval(days => $3::int)
        AND coalesce(s.signal_date, s.created_at) <= ($1)::timestamp + interval '1 day'
        AND EXISTS (SELECT 1 FROM crm_requirements_leasing r WHERE r.company_id = s.brand_company_id AND ${state} <> 'closed')
      ORDER BY coalesce(s.signal_date, s.created_at) DESC LIMIT 600`,
    [now, [...OVERLAP_SIGNAL_TYPES], days])).rows;
  const ids = [...new Set(signals.map((s: any) => String(s.brand_company_id)))];
  const requirements = ids.length ? (await db.query(
    `SELECT r.id, r.name, r.company_id, c.name AS brand, r.size, r.requirement_locations, ${requirementLiveColumnsSql("r")}
       FROM crm_requirements_leasing r JOIN crm_companies c ON c.id = r.company_id
      WHERE r.company_id = ANY($2::text[]) AND ${state} <> 'closed'`,
    [now, ids])).rows : [];
  const unlinked = (await db.query(
    `SELECT count(*)::int AS n FROM crm_requirements_leasing r WHERE r.company_id IS NULL AND ${state} <> 'closed'`, [now])).rows[0];
  return { windowDays: days, overlaps: groupOverlaps(signals, requirements, now, opts.limit ?? 40), unlinkedRequirements: Number(unlinked?.n) || 0 };
}

export interface ReconfirmCounts {
  /** Requirements in the To confirm state: drafts, BGP's own rows nobody has confirmed, and ones last confirmed 90 days to 12 months ago. */
  toConfirm: number;
  drafts: number;
  /** Confirmed once, more than 90 days ago. */
  lapsed: number;
  /** Still live, but within 14 days of lapsing. */
  goingStale: number;
  /** Open suggestions waiting for a person in the To confirm tray (from `openSuggestionCount`), when the caller counted them. */
  suggestions?: number;
}

/** Open suggestions waiting for a person: picked up from chat, viewings, deals, meetings and news. 0 when the table cannot be read. */
export async function openSuggestionCount(db: Db): Promise<number> {
  try {
    const row = (await db.query(`SELECT count(*)::int AS n FROM requirement_evidence WHERE status = 'open' AND suggestion_id IS NULL`)).rows[0];
    return Number(row?.n) || 0;
  } catch { return 0; }
}

export async function requirementsToReconfirm(db: Db, now: Date = new Date()): Promise<ReconfirmCounts> {
  const row = (await db.query(
    `SELECT count(*) FILTER (WHERE st = 'to_confirm')::int AS to_confirm,
            count(*) FILTER (WHERE st = 'to_confirm' AND lower(btrim(coalesce(status, ''))) = 'draft')::int AS drafts,
            count(*) FILTER (WHERE st = 'to_confirm' AND last_confirmed_at IS NOT NULL AND lower(btrim(coalesce(status, ''))) <> 'draft')::int AS lapsed,
            count(*) FILTER (WHERE st = 'live' AND last_confirmed_at < ($1)::timestamp - interval '${REQUIREMENT_LIVE_DAYS - REQUIREMENT_GOING_STALE_DAYS} days')::int AS going_stale
       FROM (SELECT r.status, r.last_confirmed_at, ${requirementStateSql("r", "$1")} AS st FROM crm_requirements_leasing r) x`, [now])).rows[0] || {};
  return { toConfirm: Number(row.to_confirm) || 0, drafts: Number(row.drafts) || 0, lapsed: Number(row.lapsed) || 0, goingStale: Number(row.going_stale) || 0 };
}

/** "12 requirements need reconfirming", "6 suggestions to answer and 12 requirements need reconfirming", or null when there are none. */
export function reconfirmLine(counts: ReconfirmCounts): string | null {
  const waiting = counts.suggestions ? `${counts.suggestions} suggestion${counts.suggestions === 1 ? "" : "s"} to answer` : "";
  if (!counts.toConfirm) return waiting ? `${waiting} on the Requirements page` : null;
  const parts = [
    counts.lapsed ? `${counts.lapsed} last confirmed more than 90 days ago` : "",
    counts.drafts ? `${counts.drafts} draft${counts.drafts === 1 ? "" : "s"}` : "",
    counts.goingStale ? `${counts.goingStale} more lapse within 14 days` : "",
  ].filter(Boolean);
  return `${waiting ? `${waiting} and ` : ""}${counts.toConfirm} requirement${counts.toConfirm === 1 ? " needs" : "s need"} reconfirming${parts.length ? ` (${parts.join("; ")})` : ""}`;
}

const day = (d: Date | null) => d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "undated";

/** The two code-built lists as plain text, to paste into a report's brief. */
export function overlapReportText(result: RequirementNewsOverlaps, counts: ReconfirmCounts | null, baseUrl = ""): string {
  const lines: string[] = [
    `NEWS THAT MEETS A REQUIREMENT ON THE BOOKS (last ${result.windowDays} days). This list was built in code by joining brand news to the Requirements page on the brand's CRM record. It is the complete list: do not add overlaps of your own. Each requirement carries its state. Only "Live" is a live requirement (a named BGP person confirmed it within 90 days); "To confirm" and "Background" (old, or a PIPnet / Requirement List listing nobody at BGP has confirmed) are leads to check with the brand, so word them that way and give the date.`,
  ];
  if (!result.overlaps.length) lines.push("- None this week.");
  for (const o of result.overlaps) {
    const reqs = o.requirements.map(r => `[${r.stateLabel}] ${[r.size, r.locations].filter(Boolean).join(", ") || r.name || "requirement"} (${r.reason})`).join(" | ");
    const news = o.signals.map(s => `${day(s.date)} ${s.type}: "${s.headline}"${s.source ? ` (${s.source})` : ""}`).join(" | ");
    lines.push(`- ${o.brand} · Requirement: ${reqs} · News: ${news}`);
  }
  if (result.unlinkedRequirements) lines.push(`${result.unlinkedRequirements} open requirement row${result.unlinkedRequirements === 1 ? " has" : "s have"} no brand link and could not be joined to news.`);
  const reconfirm = counts ? reconfirmLine(counts) : null;
  if (reconfirm) lines.push("", `REQUIREMENTS TO RECONFIRM: ${reconfirm}. Link: ${baseUrl}${REQUIREMENTS_TO_CONFIRM_PATH}`);
  return lines.join("\n");
}
