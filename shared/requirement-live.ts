// The ONE rule for what counts as a live leasing requirement (Woody,
// 2026-11-12; docs/requirements-review-2026-11-12.md).
//
//   LIVE        a named BGP person confirmed it within 90 days.
//   TO CONFIRM  confirmed 90 days to 12 months ago, or a Draft, or BGP's own
//               record nobody has confirmed yet (dated within 12 months).
//   BACKGROUND  older than that, on hold, or an import-only market listing
//               (PIPnet, The Requirement List) nobody at BGP has confirmed.
//   CLOSED      past / archived / satisfied.
//
// The state is worked out when a row is READ. Nothing ages rows by a
// scheduled write. `requirementLive` is for code that already holds the row;
// `requirementStateSql` is the same rule as a SQL CASE for queries that
// filter in the database. Change one and you change the other, and the tests
// beside this file.
//
// A row may only be called "confirmed" when last_confirmed_at AND a person
// are recorded. The requirement date, the created date and the last edit are
// never a confirmation: they read as "listed", "dated", "last edited".

export type RequirementState = "live" | "to_confirm" | "background" | "closed";

export const REQUIREMENT_LIVE_DAYS = 90;
export const REQUIREMENT_TO_CONFIRM_DAYS = 365;

export const REQUIREMENT_STATE_LABELS: Record<RequirementState, string> = {
  live: "Live",
  to_confirm: "To confirm",
  background: "Background",
  closed: "Closed",
};

// How a person confirmed it (crm_requirements_leasing.confirmed_how).
// "press" = a person confirmed a press story; the requirement is then
// press-reported until someone records speaking to the brand.
export const CONFIRMED_HOW = ["created", "still_live", "call", "meeting", "email", "chat", "viewing", "suggestion", "press"] as const;
export type ConfirmedHow = typeof CONFIRMED_HOW[number];

// crm_requirements_leasing.origin: whose record it is.
export const REQUIREMENT_ORIGIN_BGP = "bgp";
export const REQUIREMENT_IMPORT_ORIGINS = ["pipnet", "trl"] as const;

// Source labels (the `sources` array) that mean "came from a market listing
// import". Rows made before `origin` existed are import-only when every
// label they carry is one of these.
export const IMPORT_SOURCE_LABELS = ["pipnet", "trl", "the requirement list", "therequirementlist"] as const;

const CLOSED_STATUSES = ["past", "archived", "satisfied", "completed", "complete", "cancelled", "canceled", "closed", "withdrawn", "dead", "lost"] as const;
const DRAFT_STATUSES = ["draft"] as const;
const HOLD_STATUSES = ["on hold", "hold", "paused"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;

// Either shape: a Drizzle row (camelCase) or a pg row (snake_case).
export interface RequirementLiveRow {
  status?: string | null;
  origin?: string | null;
  sources?: string[] | null;
  lastConfirmedAt?: Date | string | null;
  last_confirmed_at?: Date | string | null;
  lastConfirmedBy?: string | null;
  last_confirmed_by?: string | null;
  lastConfirmedByName?: string | null;
  last_confirmed_by_name?: string | null;
  confirmedHow?: string | null;
  confirmed_how?: string | null;
  lastListedAt?: Date | string | null;
  last_listed_at?: Date | string | null;
  lastListedSource?: string | null;
  last_listed_source?: string | null;
  requirementDate?: string | null;
  requirement_date?: string | null;
  createdAt?: Date | string | null;
  created_at?: Date | string | null;
  updatedAt?: Date | string | null;
  updated_at?: Date | string | null;
}

export type RequirementDateKind = "confirmed" | "press" | "listed" | "dated" | "edited" | "added" | "none";

export interface RequirementLive {
  state: RequirementState;
  stateLabel: string;
  /** One plain line on why it is in this state. */
  why: string;
  /** The honest date line: "confirmed 12 Nov by Emily", "listed on PIPnet 3 Sep", "last edited 4 Aug". */
  dateLabel: string;
  dateKind: RequirementDateKind;
  /** The date behind dateLabel, or null when the row has none. */
  date: Date | null;
  /** Whole days from that date to today; null when there is no date. */
  days: number | null;
  /** True only when a named person's confirmation is recorded. */
  confirmed: boolean;
  /** Confirmed from a press story; nobody has recorded speaking to the brand. */
  pressReported: boolean;
  /** A market listing (PIPnet / The Requirement List) nobody at BGP made. */
  importOnly: boolean;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// The requirement date is free text. Only two shapes are read, the same two
// the SQL reads: 2026-11-12 (anything may follow) and 12/11/2026. A day past
// the end of its month rolls into the next month in both.
export function parseRequirementDate(text: string | null | undefined): Date | null {
  const s = String(text || "").trim();
  const iso = s.match(/^((?:19|20)[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, 1) + (+iso[3] - 1) * DAY_MS);
  const uk = s.match(/^(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])\/((?:19|20)[0-9]{2})/);
  if (uk) return new Date(Date.UTC(+uk[3], +uk[2] - 1, 1) + (+uk[1] - 1) * DAY_MS);
  return null;
}

function norm(v: string | null | undefined): string {
  return String(v || "").trim().toLowerCase();
}

export function requirementIsImportOnly(row: RequirementLiveRow): boolean {
  const origin = norm(row.origin);
  if (origin) return (REQUIREMENT_IMPORT_ORIGINS as readonly string[]).includes(origin);
  const labels = (row.sources || []).map(norm);
  return labels.length > 0 && labels.every(l => (IMPORT_SOURCE_LABELS as readonly string[]).includes(l));
}

function listingName(row: RequirementLiveRow): string {
  const raw = norm(row.lastListedSource ?? row.last_listed_source) || norm(row.origin) || norm((row.sources || [])[0]);
  if (raw === "pipnet") return "PIPnet";
  if (raw === "trl" || raw === "the requirement list" || raw === "therequirementlist") return "The Requirement List";
  return "a market listing";
}

export function formatRequirementDay(d: Date, today: Date): string {
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === today.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

function firstName(name: string | null | undefined): string {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

export function requirementLive(row: RequirementLiveRow, today: Date = new Date()): RequirementLive {
  const status = norm(row.status);
  const importOnly = requirementIsImportOnly(row);
  const confirmedAt = toDate(row.lastConfirmedAt ?? row.last_confirmed_at);
  const confirmedById = String(row.lastConfirmedBy ?? row.last_confirmed_by ?? "").trim();
  const confirmedByName = String(row.lastConfirmedByName ?? row.last_confirmed_by_name ?? "").trim();
  // A confirmation with no person behind it does not count.
  const confirmed = !!confirmedAt && !!(confirmedById || confirmedByName);
  const pressReported = confirmed && norm(row.confirmedHow ?? row.confirmed_how) === "press";

  // The date line, most trustworthy first.
  let date: Date | null = null;
  let dateKind: RequirementDateKind = "none";
  let dateLabel = "no date";
  if (confirmed) {
    date = confirmedAt;
    const who = firstName(confirmedByName);
    const day = formatRequirementDay(confirmedAt!, today);
    dateKind = pressReported ? "press" : "confirmed";
    dateLabel = pressReported
      ? `press-reported, logged ${day}${who ? ` by ${who}` : ""}`
      : `confirmed ${day}${who ? ` by ${who}` : ""}`;
  } else if (importOnly) {
    const listed = toDate(row.lastListedAt ?? row.last_listed_at) || parseRequirementDate(row.requirementDate ?? row.requirement_date);
    date = listed;
    dateKind = listed ? "listed" : "none";
    dateLabel = listed ? `listed on ${listingName(row)} ${formatRequirementDay(listed, today)}` : `listed on ${listingName(row)}, no date`;
  } else {
    const dated = parseRequirementDate(row.requirementDate ?? row.requirement_date);
    const edited = toDate(row.updatedAt ?? row.updated_at);
    const added = toDate(row.createdAt ?? row.created_at);
    if (dated) { date = dated; dateKind = "dated"; dateLabel = `dated ${formatRequirementDay(dated, today)}`; }
    else if (edited) { date = edited; dateKind = "edited"; dateLabel = `last edited ${formatRequirementDay(edited, today)}`; }
    else if (added) { date = added; dateKind = "added"; dateLabel = `added ${formatRequirementDay(added, today)}`; }
  }
  const age = date ? (today.getTime() - date.getTime()) / DAY_MS : null;
  const days = age == null ? null : Math.max(0, Math.floor(age));

  let state: RequirementState;
  let why: string;
  if ((CLOSED_STATUSES as readonly string[]).includes(status)) {
    state = "closed"; why = "Marked past, archived or satisfied";
  } else if ((DRAFT_STATUSES as readonly string[]).includes(status)) {
    state = "to_confirm"; why = "A draft waiting for a person to confirm it";
  } else if ((HOLD_STATUSES as readonly string[]).includes(status)) {
    state = "background"; why = "On hold";
  } else if (confirmed) {
    if (age! <= REQUIREMENT_LIVE_DAYS) { state = "live"; why = pressReported ? "Press-reported and confirmed by a person within 90 days; nobody has recorded speaking to the brand" : "Confirmed by a named person within 90 days"; }
    else if (age! <= REQUIREMENT_TO_CONFIRM_DAYS) { state = "to_confirm"; why = "Last confirmed more than 90 days ago"; }
    else { state = "background"; why = "Last confirmed more than 12 months ago"; }
  } else if (importOnly) {
    state = "background"; why = "A market listing nobody at BGP has confirmed";
  } else if (age == null || age <= REQUIREMENT_TO_CONFIRM_DAYS) {
    state = "to_confirm"; why = "Nobody has confirmed this with the brand yet";
  } else {
    state = "background"; why = "Never confirmed, and more than 12 months old";
  }

  return { state, stateLabel: REQUIREMENT_STATE_LABELS[state], why, dateLabel, dateKind, date, days, confirmed, pressReported, importOnly };
}

/** The stamp for a requirement a person at BGP makes by hand: BGP's own, confirmed by its creator at creation. */
export function bgpCreatedStamp(user: { id: string; name?: string | null }, how: ConfirmedHow = "created", at: Date = new Date()) {
  return { origin: REQUIREMENT_ORIGIN_BGP, lastConfirmedAt: at, lastConfirmedBy: user.id, lastConfirmedByName: user.name || null, confirmedHow: how as string };
}

// The provenance columns. A request body never sets these: the server does.
export const REQUIREMENT_PROVENANCE_FIELDS = ["lastConfirmedAt", "lastConfirmedBy", "lastConfirmedByName", "confirmedHow", "origin", "externalRequirementId", "lastListedAt", "lastListedSource"] as const;

// The same columns by their database names, for the doors that write by column name.
export const REQUIREMENT_PROVENANCE_COLUMNS = ["last_confirmed_at", "last_confirmed_by", "last_confirmed_by_name", "confirmed_how", "origin", "external_requirement_id", "last_listed_at", "last_listed_source"] as const;

export function stripRequirementProvenance<T extends Record<string, any>>(body: T): T {
  const out: Record<string, any> = { ...(body || {}) };
  for (const f of REQUIREMENT_PROVENANCE_FIELDS) delete out[f];
  for (const f of REQUIREMENT_PROVENANCE_COLUMNS) delete out[f];
  return out as T;
}

/**
 * What a client login is sent of a row it may see: no provenance, no BGP
 * owner, and no last-edit time (a confirmation moves it, which would tell the
 * client when BGP confirmed).
 */
export function requirementClientCopy<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = stripRequirementProvenance(row);
  for (const f of ["bgpContactUserId", "bgpContactUserIds", "bgp_contact_user_id", "bgp_contact_user_ids", "updatedAt", "updated_at"]) delete out[f];
  return out as T;
}

export interface MarketListing {
  source: "PIPnet" | "TRL";
  /** external_requirements.id of the import row. */
  externalId: string;
  /** The listing's own date, when it has one the import can read. */
  listedAt: Date | null;
  /** When this import run saw it. Used only when the listing carries no date. */
  seenAt?: Date;
}

/**
 * What an import may write about provenance, and nothing else. A new row is
 * stamped as that import's. An existing row gets the link and a last-listed
 * date that only moves forward; a closed row is left alone. An import never
 * sets or clears a confirmation and never changes whose record it is.
 */
export function requirementListingUpdates(existing: RequirementLiveRow & { externalRequirementId?: string | null } | null, listing: MarketListing): Record<string, any> {
  const listedAt = listing.listedAt || listing.seenAt || new Date();
  if (!existing) {
    return { origin: listing.source === "PIPnet" ? "pipnet" : "trl", externalRequirementId: listing.externalId, lastListedAt: listedAt, lastListedSource: listing.source };
  }
  if ((CLOSED_STATUSES as readonly string[]).includes(norm(existing.status))) return {};
  const updates: Record<string, any> = {};
  if (existing.externalRequirementId !== listing.externalId) updates.externalRequirementId = listing.externalId;
  const previous = toDate(existing.lastListedAt ?? existing.last_listed_at);
  if (!previous || listedAt.getTime() > previous.getTime()) {
    updates.lastListedAt = listedAt;
    updates.lastListedSource = listing.source;
  }
  return updates;
}

/** An import adds its label to a row's sources, except on BGP's own rows: clients are shown rows labelled PIPnet. */
export function importMayLabel(existing: { origin?: string | null }): boolean {
  return norm(existing.origin) !== REQUIREMENT_ORIGIN_BGP;
}

const sqlList = (items: readonly string[]) => items.map(s => `'${s.replace(/'/g, "''")}'`).join(", ");

/** `requirementIsImportOnly` as a SQL boolean: a PIPnet / Requirement List row nobody at BGP made. */
export function requirementImportOnlySql(alias = "r"): string {
  const c = (col: string) => (alias ? `${alias}.${col}` : col);
  const origin = `nullif(lower(btrim(${c("origin")})), '')`;
  return `(${origin} IN (${sqlList(REQUIREMENT_IMPORT_ORIGINS)})
      OR (${origin} IS NULL AND coalesce(cardinality(${c("sources")}), 0) > 0
          AND NOT EXISTS (SELECT 1 FROM unnest(${c("sources")}) AS _src(label)
                           WHERE lower(btrim(coalesce(_src.label, ''))) NOT IN (${sqlList(IMPORT_SOURCE_LABELS)}))))`;
}

/**
 * The same rule as `requirementLive`, as a SQL expression that yields
 * 'live' | 'to_confirm' | 'background' | 'closed' for a
 * crm_requirements_leasing row. `alias` is the table alias in the query ("" for
 * none); `nowSql` is the SQL for "today" (a parameter placeholder in tests).
 * Use it as `WHERE ${requirementStateSql("r")} = 'live'`, or select it.
 */
export function requirementStateSql(alias = "r", nowSql = "now()"): string {
  const c = (col: string) => (alias ? `${alias}.${col}` : col);
  const status = `lower(btrim(coalesce(${c("status")}, '')))`;
  const confirmed = `(${c("last_confirmed_at")} IS NOT NULL AND coalesce(nullif(btrim(${c("last_confirmed_by")}), ''), nullif(btrim(${c("last_confirmed_by_name")}), '')) IS NOT NULL)`;
  const importOnly = requirementImportOnlySql(alias);
  const d = `btrim(coalesce(${c("requirement_date")}, ''))`;
  // The free-text requirement date, read in the two shapes parseRequirementDate reads.
  const dated = `(CASE
      WHEN ${d} ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'
        THEN (make_date(substr(${d}, 1, 4)::int, substr(${d}, 6, 2)::int, 1) + (substr(${d}, 9, 2)::int - 1))::timestamp
      WHEN ${d} ~ '^(0?[1-9]|[12][0-9]|3[01])/(0?[1-9]|1[0-2])/(19|20)[0-9]{2}'
        THEN (make_date(substr(split_part(${d}, '/', 3), 1, 4)::int, split_part(${d}, '/', 2)::int, 1) + (split_part(${d}, '/', 1)::int - 1))::timestamp
      ELSE NULL END)`;
  const ownDate = `coalesce(${dated}, ${c("updated_at")}, ${c("created_at")})`;
  return `(CASE
    WHEN ${status} IN (${sqlList(CLOSED_STATUSES)}) THEN 'closed'
    WHEN ${status} IN (${sqlList(DRAFT_STATUSES)}) THEN 'to_confirm'
    WHEN ${status} IN (${sqlList(HOLD_STATUSES)}) THEN 'background'
    WHEN ${confirmed} THEN (CASE
      WHEN ${c("last_confirmed_at")} >= (${nowSql})::timestamp - interval '${REQUIREMENT_LIVE_DAYS} days' THEN 'live'
      WHEN ${c("last_confirmed_at")} >= (${nowSql})::timestamp - interval '${REQUIREMENT_TO_CONFIRM_DAYS} days' THEN 'to_confirm'
      ELSE 'background' END)
    WHEN ${importOnly} THEN 'background'
    WHEN ${ownDate} IS NULL OR ${ownDate} >= (${nowSql})::timestamp - interval '${REQUIREMENT_TO_CONFIRM_DAYS} days' THEN 'to_confirm'
    ELSE 'background' END)`;
}

/** `WHERE ${requirementIsLiveSql("r")}`: confirmed by a named person within 90 days and not closed, draft or on hold. */
export function requirementIsLiveSql(alias = "r", nowSql = "now()"): string {
  return `${requirementStateSql(alias, nowSql)} = 'live'`;
}

// ── The Requirements page's lists ──────────────────────────────────────────

/** A live requirement is "going stale" in its last 14 days before it drops to To confirm. */
export const REQUIREMENT_GOING_STALE_DAYS = 14;

/** Days until a live requirement drops to To confirm; null when it is not live. */
export function requirementDaysLeft(live: Pick<RequirementLive, "state" | "days">): number | null {
  if (live.state !== "live" || live.days == null) return null;
  return Math.max(0, REQUIREMENT_LIVE_DAYS - live.days);
}

export function requirementGoingStale(live: Pick<RequirementLive, "state" | "days">): boolean {
  const left = requirementDaysLeft(live);
  return left != null && left <= REQUIREMENT_GOING_STALE_DAYS;
}

// Every row sits on exactly one list. Background splits in two so nothing is
// hidden: an import nobody confirmed is a market listing; BGP's own row that
// has gone a year unconfirmed, or is on hold, is "older".
export type RequirementListKey = "to_confirm" | "live" | "market" | "older" | "closed";

export function requirementListKey(live: Pick<RequirementLive, "state" | "importOnly">): RequirementListKey {
  if (live.state === "closed") return "closed";
  if (live.state === "live") return "live";
  if (live.state === "to_confirm") return "to_confirm";
  return live.importOnly ? "market" : "older";
}

/**
 * Where a row came from, in the words the page shows: whose record it is
 * (`origin`) first, then any other source label it carries. A row made before
 * `origin` existed shows its labels alone, or "Not recorded".
 */
export function requirementSourceLabels(row: { origin?: string | null; sources?: string[] | null }): string[] {
  const out: string[] = [];
  const add = (label: string) => { if (label && !out.includes(label)) out.push(label); };
  const origin = norm(row.origin);
  if (origin === REQUIREMENT_ORIGIN_BGP) add("BGP");
  else if (origin === "pipnet") add("PIPnet");
  else if (origin === "trl") add("The Requirement List");
  for (const raw of row.sources || []) {
    const l = norm(raw);
    if (l === "pipnet") add("PIPnet");
    else if (l === "trl" || l === "the requirement list" || l === "therequirementlist") add("The Requirement List");
    else add(String(raw || "").trim());
  }
  if (!out.length) add("Not recorded");
  return out;
}

/**
 * The BGP owner is held twice on the row: a list (`bgpContactUserIds`, the one
 * the screens read) and a single id. Whichever a request body carries, the
 * two are made to agree; a body that carries neither is left alone.
 */
export function requirementOwnerColumns<T extends Record<string, any>>(body: T): T {
  const out: Record<string, any> = { ...(body || {}) };
  if ("bgpContactUserIds" in out) {
    const ids = [...new Set((Array.isArray(out.bgpContactUserIds) ? out.bgpContactUserIds : []).map((x: any) => String(x || "").trim()).filter(Boolean))];
    out.bgpContactUserIds = ids.length ? ids : null;
    out.bgpContactUserId = ids[0] || null;
  } else if ("bgpContactUserId" in out) {
    const id = String(out.bgpContactUserId || "").trim();
    out.bgpContactUserId = id || null;
    out.bgpContactUserIds = id ? [id] : null;
  }
  return out as T;
}

// ── Honest use on other screens (targets, fits, scores, reports) ───────────

/** How much a requirement counts as evidence that the brand wants space: live in full, to confirm reduced, background small. */
export const REQUIREMENT_STATE_WEIGHT: Record<RequirementState, number> = { live: 1, to_confirm: 0.5, background: 0.2, closed: 0 };

/** The source label that puts a row in front of client logins (the list in server/crm.ts). */
export const CLIENT_VISIBLE_SOURCE_LABEL = "PIPnet";

/** May a client login be told this row exists? Only rows labelled PIPnet: BGP's hand-entered rows stay private. */
export function requirementClientVisible(row: { sources?: string[] | null }): boolean {
  return Array.isArray(row.sources) && row.sources.includes(CLIENT_VISIBLE_SOURCE_LABEL);
}

/** The same test in SQL: `AND ${requirementClientVisibleSql("r")}`. */
export function requirementClientVisibleSql(alias = "r"): string {
  return `'${CLIENT_VISIBLE_SOURCE_LABEL}' = ANY(coalesce(${alias ? `${alias}.` : ""}sources, '{}'::text[]))`;
}

/** The columns `requirementLive` reads, for a SELECT list. */
export function requirementLiveColumnsSql(alias = "r"): string {
  const p = alias ? `${alias}.` : "";
  return ["status", "origin", "sources", "last_confirmed_at", "last_confirmed_by", "last_confirmed_by_name", "confirmed_how",
    "last_listed_at", "last_listed_source", "requirement_date", "created_at", "updated_at"].map(c => `${p}${c}`).join(", ");
}

export interface RequirementReason {
  state: RequirementState;
  /** REQUIREMENT_STATE_WEIGHT for the state. */
  weight: number;
  /** For BGP staff: "requirement confirmed 3 Nov", "PIPnet listing from Sep, not confirmed". Never the word "live". */
  text: string;
  /** The same without the leading noun, to follow "their 2,000 sq ft requirement: ". */
  short: string;
  /** What a client login may read: the source and date of a PIPnet listing, nothing else. Null when the row is not theirs to see. */
  clientText: string | null;
  /** Confirmed from a press story only: nobody has recorded speaking to the brand. Staff screens badge it "press-reported", never "confirmed". */
  pressReported: boolean;
}

const monthOf = (d: Date, today: Date) => d.getUTCFullYear() === today.getUTCFullYear() ? MONTHS[d.getUTCMonth()] : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/**
 * The dated, honest reason other screens show for a requirement, in place of
 * "live requirement". It never names who confirmed (these lines travel into
 * target lists and packs).
 */
export function requirementReason(row: RequirementLiveRow, today: Date = new Date()): RequirementReason {
  const live = requirementLive(row, today);
  const status = norm(row.status);
  const day = live.date ? formatRequirementDay(live.date, today) : "";
  let noun = "requirement";
  let short: string;
  if (live.pressReported) {
    noun = "press-reported requirement";
    short = `logged ${day}${live.state === "live" ? "" : ", not reconfirmed since"}`;
  } else if (live.confirmed) {
    short = live.state === "live" ? `confirmed ${day}` : `last confirmed ${day}`;
  } else if (live.importOnly) {
    noun = `${listingName(row)} listing`;
    short = `${live.date ? `from ${monthOf(live.date, today)}` : "no date"}, not confirmed`;
  } else {
    noun = (DRAFT_STATUSES as readonly string[]).includes(status) ? "draft requirement" : "BGP requirement";
    const kind = live.dateKind === "dated" ? "dated" : live.dateKind === "edited" ? "last edited" : live.dateKind === "added" ? "added" : "";
    short = `${kind ? `${kind} ${day}` : "no date"}, not confirmed`;
  }
  if ((HOLD_STATUSES as readonly string[]).includes(status)) short += ", on hold";
  if (live.state === "closed") short += ", closed";
  // A listing reads "PIPnet listing from Sep, not confirmed"; the rest read "requirement confirmed 3 Nov".
  const text = live.pressReported || short.startsWith("no date") ? `${noun}, ${short}` : `${noun} ${short}`;
  const shortForm = live.importOnly && !live.confirmed ? text : live.pressReported ? `press-reported, ${short}` : short;
  let clientText: string | null = null;
  if (requirementClientVisible(row)) {
    const listed = toDate(row.lastListedAt ?? row.last_listed_at) || parseRequirementDate(row.requirementDate ?? row.requirement_date);
    clientText = listed ? `PIPnet listing from ${monthOf(listed, today)}` : "PIPnet listing";
  }
  return { state: live.state, weight: REQUIREMENT_STATE_WEIGHT[live.state], text, short: shortForm, clientText, pressReported: live.pressReported };
}
