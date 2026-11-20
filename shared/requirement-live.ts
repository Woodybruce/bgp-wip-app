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
//
// Every leasing requirement is open to client logins, to read, add and amend
// (Woody, 2026-11-17: "keep all requirements open for clients and access to
// amend and add"). A requirement a client adds is the client's (origin
// 'client'): nobody at BGP has confirmed it, so it reads To confirm for BGP,
// like BGP's own unconfirmed row. A client is still never told the state, who
// confirmed one or when (requirementClientCopy, clientText).

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

// crm_requirements_leasing.origin: whose record it is. 'client' = added by a
// client login (or BGP staff viewing as one) since 17 November 2026.
export const REQUIREMENT_ORIGIN_BGP = "bgp";
export const REQUIREMENT_ORIGIN_CLIENT = "client";
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
  /** Added by a client login (origin 'client'). */
  clientMade: boolean;
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

/** A requirement a client login added (origin 'client'). */
export function requirementIsClientMade(row: { origin?: string | null }): boolean {
  return norm(row.origin) === REQUIREMENT_ORIGIN_CLIENT;
}

// The market listing a row is, by the import's origin or label: what a client
// login is told the row is. Null for every other row, and always for a
// client's own (its source label is the client company's name).
function listingLabelOf(row: RequirementLiveRow): "PIPnet" | "The Requirement List" | null {
  if (requirementIsClientMade(row)) return null;
  const labels = [norm(row.origin), ...(row.sources || []).map(norm)];
  if (labels.includes("pipnet")) return "PIPnet";
  if (labels.some(l => l === "trl" || l === "the requirement list" || l === "therequirementlist")) return "The Requirement List";
  return null;
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
  const clientMade = requirementIsClientMade(row);
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
    // BGP's own record, or one a client login added: To confirm until a named BGP person confirms it.
    state = "to_confirm"; why = clientMade ? "Added by a client login: nobody at BGP has confirmed it yet" : "Nobody has confirmed this with the brand yet";
  } else {
    state = "background"; why = clientMade ? "Added by a client login more than 12 months ago and never confirmed" : "Never confirmed, and more than 12 months old";
  }

  return { state, stateLabel: REQUIREMENT_STATE_LABELS[state], why, dateLabel, dateKind, date, days, confirmed, pressReported, importOnly, clientMade };
}

/** The stamp for a requirement a person at BGP makes by hand: BGP's own, confirmed by its creator at creation. */
export function bgpCreatedStamp(user: { id: string; name?: string | null }, how: ConfirmedHow = "created", at: Date = new Date()) {
  return { origin: REQUIREMENT_ORIGIN_BGP, lastConfirmedAt: at, lastConfirmedBy: user.id, lastConfirmedByName: user.name || null, confirmedHow: how as string };
}

/**
 * The stamp for a requirement a client login adds (Woody, 2026-11-17): the
 * client's record (origin 'client'), labelled with the client company's name
 * so BGP sees where it came from, with no BGP owner. Since 20 November 2026
 * (Woody: "Clients should be able to do what we can do really") it is
 * confirmed by the person who added it, as BGP's own are (bgpCreatedStamp);
 * until then it waited for a named BGP person. With no creator it is not
 * confirmed.
 */
export function clientCreatedStamp(clientCompanyName: string | null | undefined, creator?: { id: string; name?: string | null } | null, at: Date = new Date()) {
  const name = String(clientCompanyName || "").trim();
  const by = creator && String(creator.id || "").trim() ? creator : null;
  return {
    origin: REQUIREMENT_ORIGIN_CLIENT, sources: [name || "Client"],
    lastConfirmedAt: by ? at : null, lastConfirmedBy: by ? by.id : null, lastConfirmedByName: by ? (by.name || null) : null, confirmedHow: by ? "created" : null,
    bgpContactUserId: null, bgpContactUserIds: null,
  };
}

/**
 * What a client login may set on a leasing requirement, adding one or
 * amending any (Woody, 2026-11-17): the fields of the Add / Edit form, less
 * the BGP owner. Never provenance or a confirmation, an owner, the sources,
 * the requirement date, the landlord pack (its upload reads the file with AI),
 * or BGP's progress ticks. The server checks the brand, the contacts and the
 * deal it names.
 */
export const CLIENT_REQUIREMENT_FIELDS = [
  "name", "companyId", "groupName", "status", "principalContactId", "agentContactId", "dealId",
  "use", "requirementType", "size", "requirementLocations", "locationData", "comments",
] as const;

/** The statuses a client may give a requirement: the form's choices. */
export const CLIENT_REQUIREMENT_STATUSES = ["Active", "Past", "Archived"] as const;

/** The fields of a request body a client login may write, and nothing else. */
export function clientRequirementFields(body: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const field of CLIENT_REQUIREMENT_FIELDS) if (body && Object.prototype.hasOwnProperty.call(body, field)) out[field] = body[field];
  return out;
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

/**
 * The row a market listing folds into, from rows newest first: an open row
 * (the live rule's state is not closed) carrying the listing's link, else an
 * open row of the same brand. Folded into the first same-name row, closed
 * ones included, a fresh listing for a brand whose old requirement was Past
 * never came back under Market listings (audit, 2026-11-17). Null when no
 * open row matches: the import makes its own row, as for a brand it has never
 * seen. "closed" when the row this very listing became has been closed by a
 * person: the import leaves it so, or every run would bring it back.
 * A client's own requirement is never a target: the import makes its own row
 * and leaves the client's alone (its fields, its label and its link).
 */
export function listingTarget<T extends RequirementLiveRow & { externalRequirementId?: string | null }>(
  rows: readonly T[], externalId: string, sameBrand: (row: T) => boolean,
): T | "closed" | null {
  const open = (row: T) => !(CLOSED_STATUSES as readonly string[]).includes(norm(row.status)) && !requirementIsClientMade(row);
  const row = rows.find(r => r.externalRequirementId === externalId && open(r)) || rows.find(r => sameBrand(r) && open(r));
  if (row) return row;
  return rows.some(r => r.externalRequirementId === externalId && !requirementIsClientMade(r)) ? "closed" : null;
}

/**
 * An import adds its label to a row's sources only where it may, because the
 * label says where the row came from: never on a row a person made (BGP's own
 * or a client's), nor on a row made before `origin` existed, which may be
 * hand-made, unless it already carries that import's label.
 */
export function importMayLabel(existing: { origin?: string | null; sources?: string[] | null }, source: MarketListing["source"]): boolean {
  const origin = norm(existing.origin);
  if (origin) return (REQUIREMENT_IMPORT_ORIGINS as readonly string[]).includes(origin);
  const labels = source === "PIPnet" ? ["pipnet"] : ["trl", "the requirement list", "therequirementlist"];
  return (existing.sources || []).some(l => labels.includes(norm(l)));
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
// has gone a year unconfirmed, or is on hold, is "older". The board's pills
// (since 19 November 2026) are `boardListOf` in shared/requirements-board.ts,
// which also puts a market listing unseen for six months under Older.
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
  else if (origin === REQUIREMENT_ORIGIN_CLIENT) add("Client");
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

/**
 * May a client login be told this row exists? Every row (Woody, 2026-11-17:
 * "keep all requirements open for clients and access to amend and add"). The
 * rule this replaced showed a client only the rows labelled PIPnet and its
 * own company's; it is retired here, at its source, so a screen still asking
 * it opens. What stays BGP's own on a row a client is sent is taken off by
 * requirementClientCopy, and clientText never tells it the state, who
 * confirmed one or when. A Landsec joint agent is another agency: it keeps
 * the old rule (requirementJointAgentVisible) where it reads any at all.
 */
export function requirementClientVisible(_row?: { sources?: string[] | null }): boolean {
  return true;
}

/** The same in SQL: every row. */
export function requirementClientVisibleSql(_alias = "r"): string {
  return "TRUE";
}

/** The label a market listing a joint agent may be told of carries. */
const JOINT_AGENT_LISTING_LABEL = "PIPnet";

/**
 * What a Landsec joint agent may be told of: a market listing labelled
 * PIPnet, by source and month, and nothing else. It has no Brands and is
 * never sent BGP's requirements (or a client's), the rule every client login
 * had until 17 November 2026. It reaches requirements on its own schemes'
 * Brand Gap and target tenants only; the requirement routes refuse it
 * (jointAgentApiDenied in shared/landsec.ts).
 */
export function requirementJointAgentVisible(row: { sources?: string[] | null }): boolean {
  return Array.isArray(row.sources) && row.sources.includes(JOINT_AGENT_LISTING_LABEL);
}

/** The same test in SQL: `AND ${requirementJointAgentVisibleSql("r")}`. */
export function requirementJointAgentVisibleSql(alias = "r"): string {
  return `'${JOINT_AGENT_LISTING_LABEL}' = ANY(coalesce(${alias ? `${alias}.` : ""}sources, '{}'::text[]))`;
}

/** Who is reading requirements: BGP staff, a client login (staff viewing as one included), or a Landsec joint agent. */
export type RequirementViewer = "staff" | "client" | "joint_agent";

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
  /**
   * What a client login may read, for every row: what it is and its own date
   * ("PIPnet listing from Sep", "requirement dated 4 Aug"). Never the state,
   * whether or when BGP confirmed it, or who did.
   */
  clientText: string;
  /** What a Landsec joint agent may read: a PIPnet listing by source and month. Null for every other row (requirementJointAgentVisible). */
  listingText: string | null;
  /** A market listing (PIPnet / The Requirement List) nobody at BGP made. */
  importOnly: boolean;
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
    noun = (DRAFT_STATUSES as readonly string[]).includes(status) ? "draft requirement" : live.clientMade ? "client requirement" : "BGP requirement";
    const kind = live.dateKind === "dated" ? "dated" : live.dateKind === "edited" ? "last edited" : live.dateKind === "added" ? "added" : "";
    short = `${kind ? `${kind} ${day}` : "no date"}, not confirmed`;
  }
  if ((HOLD_STATUSES as readonly string[]).includes(status)) short += ", on hold";
  if (live.state === "closed") short += ", closed";
  // A listing reads "PIPnet listing from Sep, not confirmed"; the rest read "requirement confirmed 3 Nov".
  const text = live.pressReported || short.startsWith("no date") ? `${noun}, ${short}` : `${noun} ${short}`;
  const shortForm = live.importOnly && !live.confirmed ? text : live.pressReported ? `press-reported, ${short}` : short;
  // What a client login reads: what the row is and its own date. A listing by
  // its source and month; any other row by its requirement date, else the day
  // it was added. Never a confirmation or its date (a confirmation moves
  // updated_at), so not the last edit either, and never the state.
  const listed = toDate(row.lastListedAt ?? row.last_listed_at) || parseRequirementDate(row.requirementDate ?? row.requirement_date);
  const listing = listingLabelOf(row);
  let clientText: string;
  if (listing) clientText = listed ? `${listing} listing from ${monthOf(listed, today)}` : `${listing} listing`;
  else {
    const dated = parseRequirementDate(row.requirementDate ?? row.requirement_date);
    const added = toDate(row.createdAt ?? row.created_at);
    clientText = dated ? `requirement dated ${formatRequirementDay(dated, today)}` : added ? `requirement added ${formatRequirementDay(added, today)}` : "requirement";
  }
  const listingText = requirementJointAgentVisible(row) ? (listed ? `PIPnet listing from ${monthOf(listed, today)}` : "PIPnet listing") : null;
  return { state: live.state, weight: REQUIREMENT_STATE_WEIGHT[live.state], text, short: shortForm, clientText, listingText, importOnly: live.importOnly, pressReported: live.pressReported };
}
