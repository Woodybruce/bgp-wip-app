// Comments not yet logged (Woody, 2026-11-13: "yes to table";
// shared/letting-suggestions.ts has the contract and the pure rule). A
// comment on a target, a viewing, an interest note or a Targeting Brief
// comment that reads as an offer or a viewing, with none logged for that unit
// and brand, is kept in `letting_suggestions` for a person to log or dismiss.
//
//   GET  /api/letting-suggestions?unitId=&status=open     the list
//   GET  /api/letting-suggestions/count?unitId=           how many are open
//   POST /api/letting-suggestions/:id/dismiss  { reason? }
//   POST /api/letting-suggestions/:id/confirm  { recordKind, recordId }
//   GET  /api/admin/letting-suggestions/preview           the backlog, nothing written
//   POST /api/admin/letting-suggestions/apply             admin only
//
// NOTHING here writes an offer or a viewing. "Confirm" only marks a
// suggestion as logged, after the person saved the unit's own form, and the
// record it names must be on that unit.
//
// Detection is the shorthand rules only: no AI call, nothing sent anywhere.
// It runs when a source row is saved (scanUnitForSuggestions, fire and forget
// from the handlers that write a target comment, a viewing, an interest line
// or a brief comment) and from the admin Preview then Apply. Never at boot,
// never on a timer. It never reads inbox-swept rows, emails, chat, deal
// comments or CRM interactions.
//
// Who sees what (suggestionVisibleTo): a target's comments are BGP's notes,
// so those rows ('bgp') are for BGP staff only. The rest ('brief') are for
// BGP staff and the scheme's joint agent. An asset manager, a Landsec leasing
// manager and every other client login are shown nothing, counted nothing and
// get the same "not found" for any id. Every route checks the unit's scheme
// with briefAccess().
//
// The database and the login checks are imported lazily, so the pure parts
// load without them.
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  CLOSED_ALREADY_LOGGED, CLOSED_SOURCE_CHANGED, DISMISS_REASON_MAX, SUGGESTION_KINDS, SUGGESTION_SOURCE_LABELS, SUGGESTION_SOURCES,
  alreadyLogged, candidatesForUnit, describeSuggestion, parseSourceRef, suggestionVisibleTo,
  type LettingSuggestion, type LoggedRecord, type SuggestionCandidate, type SuggestionDetails, type SuggestionKind, type SuggestionSource,
  type SuggestionStatus, type SuggestionViewer, type UnitBrand, type UnitSources,
} from "@shared/letting-suggestions";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";
const LIST_MAX = 500;
// The inbox and diary sweeps write these notes (server/viewing-sync.ts). They
// are BGP's email history, never a person's own note.
const SWEPT_INTEREST_NOTE = /^(Detected in [^\n]*'s inbox: |Synced from [^\n]*'s Outlook diary: |Backfilled from synced email: )/;

const londonDay = (at: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const dayOf = (at: unknown): string | null => {
  if (!at) return null;
  const when = at instanceof Date ? at : new Date(String(at));
  return Number.isFinite(when.getTime()) ? londonDay(when) : null;
};
const textDay = (s: unknown): string | null => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

// ── Reading one unit's sources ─────────────────────────────────────────────

async function loadUnitSources(db: Db, unitId: string, staffNames: readonly string[], today: string): Promise<UnitSources | null> {
  const unit = (await db.query(`SELECT id, asking_rent FROM available_units WHERE id = $1`, [unitId])).rows[0];
  if (!unit) return null;
  const brief = (await db.query(`SELECT id, commercials FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at LIMIT 1`, [unitId])).rows[0] || null;
  const targets = brief ? (await db.query(
    `SELECT t.id, t.operator_name, t.company_id, t.comments, c.name AS company_name
       FROM unit_target_operators t LEFT JOIN crm_companies c ON c.id = t.company_id AND c.merged_into_id IS NULL
      WHERE t.brief_id = $1 ORDER BY t.sort_order, t.created_at`, [brief.id])).rows : [];
  const viewings = (await db.query(
    `SELECT v.id, v.company_id, COALESCE(c.name, v.company_name) AS company_name, v.viewing_date, v.outcome, v.notes, v.source, v.status,
            COALESCE(ob.name, ow.name) AS said_by
       FROM unit_viewings v LEFT JOIN crm_companies c ON c.id = v.company_id
       LEFT JOIN users ob ON ob.id = v.outcome_by_user_id LEFT JOIN users ow ON ow.id = v.owner_user_id
      WHERE v.unit_id = $1 AND v.deleted_at IS NULL ORDER BY v.viewing_date, v.id`, [unitId])).rows;
  // Only lines a person wrote: never a row the inbox or diary sweep made.
  const interest = (await db.query(
    `SELECT i.id, i.company_id, COALESCE(c.name, i.company_name) AS company_name, i.notes, i.interest_date
       FROM unit_interest i LEFT JOIN crm_companies c ON c.id = i.company_id
      WHERE i.unit_id = $1 AND i.source IS NULL AND i.email_conversation_id IS NULL AND COALESCE(i.notes, '') <> ''
      ORDER BY i.interest_date, i.id`, [unitId])).rows.filter((r: any) => !SWEPT_INTEREST_NOTE.test(String(r.notes || "")));
  const briefComments = brief ? (await db.query(
    `SELECT id, body, user_name, created_at FROM unit_brief_comments WHERE brief_id = $1 AND kind = 'comment' ORDER BY created_at, id`, [brief.id])).rows : [];
  const offers = (await db.query(`SELECT company_id, company_name, offer_date, viewing_id FROM unit_offers WHERE unit_id = $1`, [unitId])).rows;

  // The brands on the unit: the CRM brands its offers, viewings, interest and
  // targets link, and the targets named in words only.
  const { brandsOnUnit } = await import("./unit-negotiation");
  const brands: UnitBrand[] = (await brandsOnUnit(unitId, db)).map(b => ({ companyId: b.id, name: b.name }));
  for (const t of targets) if (!t.company_id && String(t.operator_name || "").trim()) brands.push({ companyId: null, name: String(t.operator_name).trim() });

  const quoting = Number(brief?.commercials?.quotingRentPa);
  const asking = Number(unit.asking_rent);
  return {
    unitId, today, staffNames, brands,
    quotingRentPa: Number.isFinite(quoting) && quoting > 0 ? quoting : Number.isFinite(asking) && asking > 0 ? asking : null,
    targets: targets.map((t: any) => ({
      id: String(t.id), operatorName: t.operator_name || null, companyId: t.company_name ? t.company_id : null, companyName: t.company_name || null,
      comments: (Array.isArray(t.comments) ? t.comments : [])
        .filter((c: any) => c && typeof c === "object" && typeof c.text === "string" && c.at != null)
        .map((c: any) => ({ text: String(c.text), at: String(c.at), day: dayOf(c.at), userName: typeof c.userName === "string" && c.userName.trim() ? c.userName.trim() : null })),
    })),
    viewings: viewings.map((v: any) => ({
      id: String(v.id), companyId: v.company_id || null, companyName: v.company_name || null, viewingDate: textDay(v.viewing_date),
      outcome: v.outcome || null, notes: v.notes || null, source: v.source || null, status: v.status || null, saidBy: v.said_by || null,
    })),
    interest: interest.map((i: any) => ({ id: String(i.id), companyId: i.company_id || null, companyName: i.company_name || null, notes: i.notes || null, interestDate: textDay(i.interest_date) })),
    briefComments: briefComments.map((c: any) => ({ id: String(c.id), body: String(c.body || ""), userName: c.user_name || null, day: dayOf(c.created_at) })),
    offersLogged: offers.map((o: any): LoggedRecord => ({ companyId: o.company_id || null, brandName: o.company_name || null, date: textDay(o.offer_date), viewingId: o.viewing_id || null })),
    viewingsLogged: viewings.map((v: any): LoggedRecord => ({ companyId: v.company_id || null, brandName: v.company_name || null, date: textDay(v.viewing_date) })),
  };
}

async function bgpStaffNames(db: Db): Promise<string[]> {
  return (await db.query(`SELECT name FROM users WHERE lower(email) LIKE $1 AND name IS NOT NULL AND is_active IS NOT FALSE`, [`%${BGP_EMAIL_DOMAIN}`]))
    .rows.map((r: any) => String(r.name || "").trim()).filter(Boolean);
}

// ── The scan ───────────────────────────────────────────────────────────────

export interface ScanResult {
  unitId: string;
  /** What was raised (or, on a dry run, would be). */
  raised: SuggestionCandidate[];
  /** Open suggestions closed because the offer or viewing is now logged, or the words changed. */
  closed: number;
}

/**
 * Reads one unit's target comments, viewings, interest notes and brief
 * comments, and brings its suggestions in line: raises what is new, and
 * closes an open suggestion whose offer or viewing has since been logged or
 * whose words have changed. A suggestion a person dismissed or logged is
 * never raised again (the dedupe key). `dryRun` writes nothing.
 *
 * A source that has moved to this unit brings its suggestion with it (review,
 * 2026-11-13: a viewing matched to the wrong unit and corrected). The key is
 * the source and its words, not the unit, so the row already exists under the
 * unit the source was on: it is moved here and opened again, unless a person
 * dismissed or logged it (suggestionMoves). Without that it stayed on the old
 * unit, then was closed there and never raised here.
 */
export async function scanUnitForSuggestions(unitId: string, opts: { dryRun?: boolean; db?: Db; staffNames?: readonly string[]; today?: string } = {}): Promise<ScanResult> {
  const db: Db = opts.db || (await import("./db")).pool;
  const src = await loadUnitSources(db, unitId, opts.staffNames || await bgpStaffNames(db), opts.today || londonDay());
  if (!src) return { unitId, raised: [], closed: 0 };
  const candidates = candidatesForUnit(src);
  const fresh = candidates.filter(c => !c.logged);
  const freshKeys = new Set(fresh.map(c => c.dedupeKey));
  const loggedKeys = new Set(candidates.filter(c => c.logged).map(c => c.dedupeKey));
  const rows = (await db.query(
    `/* suggestions:existing */ SELECT id, unit_id, dedupe_key, status, resolved_by_user_id, resolved_reason
       FROM letting_suggestions WHERE unit_id = $1 OR dedupe_key = ANY($2::text[])`, [unitId, [...freshKeys]])).rows;
  const existing = rows.filter((r: any) => String(r.unit_id) === unitId);
  const known = new Set(existing.map((r: any) => String(r.dedupe_key)));
  // The same evidence held under another unit: raised here only when it may move.
  const elsewhere = new Map<string, any>(rows.filter((r: any) => String(r.unit_id) !== unitId).map((r: any) => [String(r.dedupe_key), r]));
  const seen = new Set<string>();
  const toRaise = fresh.filter(c => !known.has(c.dedupeKey) && !seen.has(c.dedupeKey) && !!seen.add(c.dedupeKey)
    && (!elsewhere.has(c.dedupeKey) || suggestionMoves(elsewhere.get(c.dedupeKey))));
  const toClose = existing.filter((r: any) => r.status === "open" && !freshKeys.has(String(r.dedupe_key)));
  if (opts.dryRun) return { unitId, raised: toRaise, closed: toClose.length };

  const raised: SuggestionCandidate[] = [];
  for (const c of toRaise) {
    // Held under the unit its source used to be on: moved here and opened
    // again, with the brand and date as they read now. The database makes the
    // "no person has answered it" test again, in case one just did.
    if (elsewhere.has(c.dedupeKey)) {
      const moved = (await db.query(
        `/* suggestions:move */ UPDATE letting_suggestions
            SET unit_id = $1, company_id = $3, brand_name = $4, details = $5::jsonb, said_by = $6, evidence_date = $7::date,
                status = 'open', resolved_at = NULL, resolved_reason = NULL
          WHERE dedupe_key = $2 AND ${SUGGESTION_MOVES_SQL} RETURNING id`,
        [c.unitId, c.dedupeKey, c.companyId, c.brandName, JSON.stringify(c.details || {}), c.saidBy, c.evidenceDate])).rows[0];
      if (moved) raised.push(c);
      continue;
    }
    const made = (await db.query(
      `INSERT INTO letting_suggestions (unit_id, kind, company_id, brand_name, source_kind, source_ref, dedupe_key, excerpt, details, said_by, evidence_date, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::date, $12)
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [c.unitId, c.kind, c.companyId, c.brandName, c.sourceKind, c.sourceRef, c.dedupeKey, c.excerpt, JSON.stringify(c.details || {}), c.saidBy, c.evidenceDate, c.visibility])).rows[0];
    if (made) raised.push(c);
  }
  let closed = 0;
  for (const r of toClose) {
    const reason = loggedKeys.has(String(r.dedupe_key)) ? CLOSED_ALREADY_LOGGED : CLOSED_SOURCE_CHANGED;
    const done = (await db.query(
      `UPDATE letting_suggestions SET status = 'dismissed', resolved_at = now(), resolved_reason = $2 WHERE id = $1 AND status = 'open' RETURNING id`, [r.id, reason])).rows[0];
    if (done) closed++;
  }
  return { unitId, raised, closed };
}

// May a suggestion held under another unit move to the unit its source is on
// now? Only one no person has answered: still open, or closed by an earlier
// scan of the old unit because its source was no longer there. A suggestion a
// person dismissed or logged stays where it was answered and is never raised
// again. The move itself makes the same test in the database.
export function suggestionMoves(row: { status?: string | null; resolved_by_user_id?: string | null; resolved_reason?: string | null } | null | undefined): boolean {
  if (!row || row.resolved_by_user_id) return false;
  return row.status === "open" || (row.status === "dismissed" && row.resolved_reason === CLOSED_SOURCE_CHANGED);
}
const SUGGESTION_MOVES_SQL = `unit_id <> $1 AND resolved_by_user_id IS NULL AND (status = 'open' OR (status = 'dismissed' AND resolved_reason = '${CLOSED_SOURCE_CHANGED}'))`;

// A unit's open suggestions are closed when it starts a new letting: they
// were about the letting that has ended, and its earlier offers are marked
// Closed at the same moment (server/letting-cycle.ts). Closed, not deleted,
// with a plain reason and no person's name, so the record of what was said
// stays and the same words are never raised again.
export const CLOSED_REMARKETED = "The unit was re-marketed: this was about the earlier letting.";
export async function closeSuggestionsForNewLetting(db: Db, unitId: string): Promise<number> {
  return (await db.query(
    `UPDATE letting_suggestions SET status = 'dismissed', resolved_at = now(), resolved_reason = $2 WHERE unit_id = $1 AND status = 'open' RETURNING id`,
    [unitId, CLOSED_REMARKETED])).rows.length;
}

// One scan a unit at a time; a save that lands while one runs asks for one more.
const running = new Set<string>();
const again = new Set<string>();
async function scanSoon(unitId: string): Promise<void> {
  if (running.has(unitId)) { again.add(unitId); return; }
  running.add(unitId);
  try {
    do {
      again.delete(unitId);
      await scanUnitForSuggestions(unitId);
    } while (again.has(unitId));
  } finally {
    running.delete(unitId);
    again.delete(unitId);
  }
}

/**
 * For the handlers that save a source row: look the unit over again, after
 * the save and never as part of it. Returns at once and never throws; a scan
 * that fails only writes a log line.
 */
export function queueSuggestionScan(ref: { unitId?: string | null; targetId?: string | null; briefId?: string | null; viewingId?: string | null } | null | undefined): void {
  void (async () => {
    try {
      if (!ref) return;
      const { pool } = await import("./db");
      let unitId = ref.unitId ? String(ref.unitId) : null;
      if (!unitId && ref.targetId) {
        unitId = (await pool.query(`SELECT b.unit_id FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id WHERE t.id = $1`, [String(ref.targetId)])).rows[0]?.unit_id || null;
      }
      if (!unitId && ref.briefId) unitId = (await pool.query(`SELECT unit_id FROM unit_briefs WHERE id = $1`, [String(ref.briefId)])).rows[0]?.unit_id || null;
      if (!unitId && ref.viewingId) unitId = (await pool.query(`SELECT unit_id FROM unit_viewings WHERE id = $1`, [String(ref.viewingId)])).rows[0]?.unit_id || null;
      if (unitId) await scanSoon(unitId);
    } catch (e: any) {
      console.warn("[letting-suggestions] scan skipped:", e?.message || e);
    }
  })();
}

// ── The backlog: admin Preview, then Apply ─────────────────────────────────

const UNITS_WITH_SOURCES = `
  SELECT DISTINCT u.id FROM (
    SELECT b.unit_id FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id
     WHERE (CASE WHEN jsonb_typeof(t.comments) = 'array' THEN jsonb_array_length(t.comments) ELSE 0 END) > 0
    UNION SELECT unit_id FROM unit_viewings WHERE deleted_at IS NULL AND unit_id IS NOT NULL AND (outcome IN ('Offer Received', 'Offer Expected') OR COALESCE(notes, '') <> '')
    UNION SELECT unit_id FROM unit_interest WHERE source IS NULL AND email_conversation_id IS NULL AND COALESCE(notes, '') <> ''
    UNION SELECT b.unit_id FROM unit_brief_comments c JOIN unit_briefs b ON b.id = c.brief_id WHERE c.kind = 'comment'
    UNION SELECT unit_id FROM letting_suggestions WHERE status = 'open'
  ) x JOIN available_units u ON u.id = x.unit_id`;

export interface BacklogResult {
  unitsRead: number;
  raised: number;
  closed: number;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
  sample: { unitName: string; propertyName: string | null; brandName: string | null; kind: SuggestionKind; source: string; summary: string; excerpt: string; evidenceDate: string | null }[];
  failed: number;
}

/** Every unit with something to read, scanned one after another. `dryRun` writes nothing. */
export async function runSuggestionBacklog(opts: { dryRun: boolean; db?: Db }): Promise<BacklogResult> {
  const db: Db = opts.db || (await import("./db")).pool;
  const ids: string[] = (await db.query(UNITS_WITH_SOURCES)).rows.map((r: any) => String(r.id));
  const staffNames = await bgpStaffNames(db);
  const today = londonDay();
  const out: BacklogResult = { unitsRead: ids.length, raised: 0, closed: 0, byKind: {}, bySource: {}, sample: [], failed: 0 };
  const sampled: SuggestionCandidate[] = [];
  for (const unitId of ids) {
    try {
      const r = await scanUnitForSuggestions(unitId, { dryRun: opts.dryRun, db, staffNames, today });
      out.raised += r.raised.length;
      out.closed += r.closed;
      for (const c of r.raised) {
        out.byKind[c.kind] = (out.byKind[c.kind] || 0) + 1;
        out.bySource[c.sourceKind] = (out.bySource[c.sourceKind] || 0) + 1;
        if (sampled.length < 20) sampled.push(c);
      }
    } catch (e: any) {
      out.failed++;
      console.warn("[letting-suggestions] backlog scan failed for a unit:", e?.message || e);
    }
  }
  if (sampled.length) {
    const names = (await db.query(
      `SELECT u.id, u.unit_name, p.name AS property_name FROM available_units u LEFT JOIN crm_properties p ON p.id = u.property_id WHERE u.id = ANY($1::varchar[])`,
      [[...new Set(sampled.map(c => c.unitId))]])).rows;
    const byId = new Map<string, any>(names.map((n: any) => [String(n.id), n]));
    out.sample = sampled.map(c => ({
      unitName: byId.get(c.unitId)?.unit_name || "Unit", propertyName: byId.get(c.unitId)?.property_name || null, brandName: c.brandName, kind: c.kind,
      source: SUGGESTION_SOURCE_LABELS[c.sourceKind], summary: describeSuggestion(c.kind, c.details), excerpt: c.excerpt.slice(0, 240), evidenceDate: c.evidenceDate,
    }));
  }
  return out;
}

// ── The list a caller may see ──────────────────────────────────────────────

const SOURCE_ORDER = `CASE s.source_kind WHEN 'target_comment' THEN 0 WHEN 'viewing' THEN 1 WHEN 'interest_note' THEN 2 ELSE 3 END`;
const SELECT_SUGGESTIONS = `
  SELECT s.id, s.unit_id, s.kind, s.company_id, s.brand_name, s.source_kind, s.source_ref, s.excerpt, s.details, s.said_by,
         to_char(s.evidence_date, 'YYYY-MM-DD') AS evidence_day, s.visibility, s.status, s.created_at,
         u.unit_name, u.property_id, p.name AS property_name
    FROM letting_suggestions s JOIN available_units u ON u.id = s.unit_id LEFT JOIN crm_properties p ON p.id = u.property_id`;

type Access = SuggestionViewer & { scope: string | null; userId: string | null; name: string | null };

// briefAccess() for each property a row sits on, asked once a property.
function accessLookup(req: Request): (propertyId: string | null) => Promise<Access | null> {
  const cache = new Map<string, Promise<Access | null>>();
  let everywhere: Access | null = null;
  return async propertyId => {
    // BGP staff with no client scope get the same answer for every property.
    if (everywhere) return everywhere;
    const key = propertyId || "";
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const { briefAccess } = await import("./unit-brief-workspace");
        return (await briefAccess(req, propertyId)) as Access | null;
      })());
    }
    const access = await cache.get(key)!;
    if (access && !access.scope && access.isStaff) everywhere = access;
    return access;
  };
}

function suggestionOut(row: any, brandIdAllowed: boolean): LettingSuggestion | null {
  const kind = (SUGGESTION_KINDS as readonly string[]).includes(row.kind) ? (row.kind as SuggestionKind) : null;
  const sourceKind = (SUGGESTION_SOURCES as readonly string[]).includes(row.source_kind) ? (row.source_kind as SuggestionSource) : null;
  const source = sourceKind ? parseSourceRef(sourceKind, String(row.source_ref || "")) : null;
  if (!kind || !sourceKind || !source) return null;
  const details: SuggestionDetails = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {};
  return {
    id: String(row.id), unitId: String(row.unit_id), unitName: row.unit_name || "Unit", propertyId: row.property_id || null, propertyName: row.property_name || null,
    kind, brandName: row.brand_name || null, companyId: brandIdAllowed ? row.company_id || null : null,
    sourceKind, sourceLabel: SUGGESTION_SOURCE_LABELS[sourceKind], source,
    excerpt: String(row.excerpt || ""), details, summary: describeSuggestion(kind, details),
    saidBy: row.said_by || null, evidenceDate: row.evidence_day || null,
    status: (row.status as SuggestionStatus) || "open", createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

/**
 * The suggestions the caller may see. A row they may not see is not here, so
 * it is not listed and not counted. An open suggestion whose offer or viewing
 * has been logged since (through any form) is left out too: the next scan of
 * its unit closes it.
 */
export async function visibleSuggestions(req: Request, filter: { unitId?: string | null; status?: SuggestionStatus } = {}): Promise<LettingSuggestion[]> {
  const { pool } = await import("./db");
  const { isClientRequestUser } = await import("./company-scope");
  const { briefSchemePropertyIds } = await import("./unit-brief-workspace");
  const client = await isClientRequestUser(req);
  // The schemes on a restricted Landsec login (null for everyone else). A
  // client login with no scheme list is a full client view: nothing is theirs.
  const schemeProperties = await briefSchemePropertyIds(req);
  if (client && !schemeProperties) return [];
  // Only BGP staff look back at what was logged or dismissed.
  const status: SuggestionStatus = !client && filter.status ? filter.status : "open";

  const where = [`s.status = $1`];
  const params: unknown[] = [status];
  // A viewing that has been moved to another unit is no longer this unit's
  // evidence: its open suggestion is left out here until the next scan of the
  // unit it is on now moves it, so "Log as offer" never opens the old unit's form.
  if (status === "open") where.push(`NOT (s.source_kind = 'viewing' AND EXISTS (SELECT 1 FROM unit_viewings mv WHERE mv.id::text = s.source_ref AND mv.unit_id IS DISTINCT FROM s.unit_id))`);
  if (filter.unitId) { params.push(filter.unitId); where.push(`s.unit_id = $${params.length}`); }
  if (schemeProperties) { params.push([...schemeProperties]); where.push(`u.property_id = ANY($${params.length}::varchar[])`); }
  const rows = (await pool.query(
    `${SELECT_SUGGESTIONS} WHERE ${where.join(" AND ")}
      ORDER BY p.name NULLS LAST, u.unit_name, s.unit_id, ${SOURCE_ORDER}, s.evidence_date DESC NULLS LAST, s.created_at DESC LIMIT ${LIST_MAX}`, params)).rows;

  const accessFor = accessLookup(req);
  const mine: { row: any; access: Access }[] = [];
  for (const row of rows) {
    const access = await accessFor(row.property_id || null);
    if (access && suggestionVisibleTo(row.visibility, access)) mine.push({ row, access });
  }
  if (!mine.length) return [];

  // What is already on those units, for the open list.
  const unitIds = [...new Set(mine.map(m => String(m.row.unit_id)))];
  const offers = new Map<string, LoggedRecord[]>();
  const viewings = new Map<string, LoggedRecord[]>();
  if (status === "open") {
    const push = (map: Map<string, LoggedRecord[]>, unitId: string, record: LoggedRecord) => { map.set(unitId, [...(map.get(unitId) || []), record]); };
    for (const o of (await pool.query(`SELECT unit_id, company_id, company_name, offer_date, viewing_id FROM unit_offers WHERE unit_id = ANY($1::varchar[])`, [unitIds])).rows) {
      push(offers, String(o.unit_id), { companyId: o.company_id || null, brandName: o.company_name || null, date: textDay(o.offer_date), viewingId: o.viewing_id || null });
    }
    for (const v of (await pool.query(
      `SELECT v.unit_id, v.company_id, COALESCE(c.name, v.company_name) AS company_name, v.viewing_date
         FROM unit_viewings v LEFT JOIN crm_companies c ON c.id = v.company_id WHERE v.unit_id = ANY($1::varchar[]) AND v.deleted_at IS NULL`, [unitIds])).rows) {
      push(viewings, String(v.unit_id), { companyId: v.company_id || null, brandName: v.company_name || null, date: textDay(v.viewing_date) });
    }
  }
  // A joint agent is sent a brand's id only when that brand is already named on the unit.
  const brandsHere = new Map<string, Set<string>>();
  const { brandsOnUnit } = await import("./unit-negotiation");

  const out: LettingSuggestion[] = [];
  for (const { row, access } of mine) {
    const unitId = String(row.unit_id);
    if (status === "open") {
      const records = row.kind === "offer" ? offers.get(unitId) : viewings.get(unitId);
      const fromViewingId = row.source_kind === "viewing" ? String(row.source_ref) : null;
      if (alreadyLogged({ companyId: row.company_id, brandName: row.brand_name, evidenceDate: row.evidence_day || null, fromViewingId }, records || [])) continue;
    }
    let brandIdAllowed = access.isStaff;
    if (!brandIdAllowed && row.company_id) {
      if (!brandsHere.has(unitId)) brandsHere.set(unitId, new Set((await brandsOnUnit(unitId)).map(b => b.id)));
      brandIdAllowed = brandsHere.get(unitId)!.has(String(row.company_id));
    }
    const item = suggestionOut(row, brandIdAllowed);
    if (item) out.push(item);
  }
  return out;
}

// One suggestion, only when the caller may see it. Null covers "not there",
// "not on your schemes" and "not for your login": the caller cannot tell them apart.
async function suggestionForCaller(req: Request, id: string): Promise<{ row: any; access: Access } | null> {
  const { pool } = await import("./db");
  const row = (await pool.query(`${SELECT_SUGGESTIONS} WHERE s.id = $1`, [id])).rows[0];
  const { briefAccess } = await import("./unit-brief-workspace");
  // The access check runs whether or not the row exists, so the answer takes the same road.
  const access = (await briefAccess(req, row?.property_id || null)) as Access | null;
  if (!row || !access || !suggestionVisibleTo(row.visibility, access)) return null;
  return { row, access };
}

// ── Routes ─────────────────────────────────────────────────────────────────

const NOT_FOUND = "That suggestion is not on your list.";
const DEALT_WITH = "That suggestion has already been dealt with.";
const idParam = z.string().min(1).max(100);
const listQuery = z.object({
  unitId: z.string().min(1).max(100).optional(),
  status: z.enum(["open", "confirmed", "dismissed"]).optional(),
});
const dismissBody = z.object({ reason: z.string().max(DISMISS_REASON_MAX).optional().nullable() });
const confirmBody = z.object({ recordKind: z.enum(SUGGESTION_KINDS), recordId: z.string().min(1).max(100) });

export function setupLettingSuggestionRoutes(app: Express) {
  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    import("./auth").then(m => m.requireAuth(req, res, next)).catch(next);
  };
  const admin = (req: Request, res: Response, next: NextFunction) => {
    import("./auth").then(m => m.requireAdmin(req, res, next)).catch(next);
  };
  const failed = (res: Response, where: string, err: any) => {
    console.error(`[letting-suggestions] ${where} failed:`, err?.message || err);
    res.status(500).json({ message: "The list could not be read. Try again in a moment." });
  };
  const first = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

  app.get("/api/letting-suggestions/count", signedIn, async (req: Request, res: Response) => {
    try {
      const q = listQuery.safeParse({ unitId: first(req.query.unitId) });
      if (!q.success) return res.status(400).json({ message: "That unit is not valid." });
      res.json({ count: (await visibleSuggestions(req, { unitId: q.data.unitId, status: "open" })).length });
    } catch (err) { failed(res, "count", err); }
  });

  app.get("/api/letting-suggestions", signedIn, async (req: Request, res: Response) => {
    try {
      const q = listQuery.safeParse({ unitId: first(req.query.unitId), status: first(req.query.status) });
      if (!q.success) return res.status(400).json({ message: "Ask for open, confirmed or dismissed suggestions." });
      const suggestions = await visibleSuggestions(req, q.data);
      res.json({ suggestions, count: suggestions.length });
    } catch (err) { failed(res, "list", err); }
  });

  app.post("/api/letting-suggestions/:id/dismiss", signedIn, async (req: Request, res: Response) => {
    try {
      const id = idParam.safeParse(req.params.id);
      const body = dismissBody.safeParse(req.body || {});
      if (!id.success) return res.status(404).json({ message: NOT_FOUND });
      if (!body.success) return res.status(400).json({ message: `Keep the reason to ${DISMISS_REASON_MAX} characters.` });
      const found = await suggestionForCaller(req, id.data);
      if (!found) return res.status(404).json({ message: NOT_FOUND });
      const { pool } = await import("./db");
      const reason = String(body.data.reason || "").replace(/\s+/g, " ").trim() || null;
      const done = (await pool.query(
        `UPDATE letting_suggestions SET status = 'dismissed', resolved_by_user_id = $2, resolved_by_name = $3, resolved_at = now(), resolved_reason = $4
          WHERE id = $1 AND status = 'open' RETURNING id`, [id.data, found.access.userId, found.access.name, reason])).rows[0];
      if (!done) return res.status(409).json({ message: DEALT_WITH });
      res.json({ ok: true, id: id.data, status: "dismissed" });
    } catch (err) { failed(res, "dismiss", err); }
  });

  // Called by the screen only after the unit's own offer or viewing form has
  // saved. It writes no offer and no viewing: the record must already be on
  // this unit, and must be the kind the suggestion was for.
  app.post("/api/letting-suggestions/:id/confirm", signedIn, async (req: Request, res: Response) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) return res.status(404).json({ message: NOT_FOUND });
      const body = confirmBody.safeParse(req.body || {});
      if (!body.success) return res.status(400).json({ message: "Name the offer or viewing that was logged." });
      const found = await suggestionForCaller(req, id.data);
      if (!found) return res.status(404).json({ message: NOT_FOUND });
      if (body.data.recordKind !== found.row.kind) {
        return res.status(400).json({ message: found.row.kind === "offer" ? "This suggestion is for an offer. Log the offer first." : "This suggestion is for a viewing. Log the viewing first." });
      }
      const { pool } = await import("./db");
      const record = body.data.recordKind === "offer"
        ? (await pool.query(`SELECT id FROM unit_offers WHERE id = $1 AND unit_id = $2`, [body.data.recordId, found.row.unit_id])).rows[0]
        : (await pool.query(`SELECT id FROM unit_viewings WHERE id = $1 AND unit_id = $2 AND deleted_at IS NULL`, [body.data.recordId, found.row.unit_id])).rows[0];
      if (!record) return res.status(400).json({ message: body.data.recordKind === "offer" ? "That offer is not on this unit." : "That viewing is not on this unit." });
      const done = (await pool.query(
        `UPDATE letting_suggestions SET status = 'confirmed', resolved_by_user_id = $2, resolved_by_name = $3, resolved_at = now(), record_kind = $4, record_id = $5
          WHERE id = $1 AND status = 'open' RETURNING id`, [id.data, found.access.userId, found.access.name, body.data.recordKind, body.data.recordId])).rows[0];
      if (!done) return res.status(409).json({ message: DEALT_WITH });
      res.json({ ok: true, id: id.data, status: "confirmed" });
    } catch (err) { failed(res, "confirm", err); }
  });

  // The backlog. Preview reads every unit and writes nothing; Apply stores
  // what Preview counted. Admin only, and never run at boot or on a timer.
  app.get("/api/admin/letting-suggestions/preview", signedIn, admin, async (_req: Request, res: Response) => {
    try {
      res.json({ ...(await runSuggestionBacklog({ dryRun: true })), previewedAt: new Date().toISOString() });
    } catch (err) { failed(res, "preview", err); }
  });
  app.post("/api/admin/letting-suggestions/apply", signedIn, admin, async (_req: Request, res: Response) => {
    try {
      res.json({ ...(await runSuggestionBacklog({ dryRun: false })), appliedAt: new Date().toISOString() });
    } catch (err) { failed(res, "apply", err); }
  });
}
