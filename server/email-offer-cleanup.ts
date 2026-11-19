// Clearing the offers the 14 August 2026 email import left on the Letting
// Tracker (Woody, 2026-11-19: "1", an admin Preview then Apply). The rule for
// which rows go is shared/email-offer-cleanup.ts; this file reads, deletes,
// records and puts back.
//
//   POST /api/admin/email-offer-cleanup        { dryRun: true }                       preview
//   POST /api/admin/email-offer-cleanup        { dryRun: false, ids, previewedAt }    apply
//   POST /api/admin/email-offer-cleanup/undo   { batch }
//   GET  /api/admin/email-offer-cleanup/runs
//
// Admin only, and never at boot or on a timer. Preview lists every import row
// by unit and email thread in three groups (to clear; credited to a brand;
// kept, with why). One row of each thread stays as its offer (threadKeeper in
// the shared rule), so only the copies are offered for clearing. It records the
// clearable ids, with each one's thread and the row kept for it, under
// email_offer_cleanup:dry_run. Apply takes the ids the same admin ticked on
// that preview, within the hour, and the threads ticked as not an offer at all
// (whose kept row then goes too). It works one unit at a time, in a
// transaction: it takes the negotiation log's lock on each offer (lockOffer in
// server/unit-negotiation.ts), locks the rows and each thread's kept row, reads
// them again, leaves a thread's copies when its kept row has gone, and deletes
// only rows still untouched. Each offer and each of its rounds (only ever the
// blank round 1 the log writes when opened) is deleted and written whole to
// investment_comp_migration_log in the same statement, under one batch. Undo
// puts back every row of a batch whose unit is still on the tracker and whose
// id and email key are still free.
import type { Express, Request, RequestHandler, Response } from "express";
import type { Pool, PoolClient } from "pg";
import {
  IMPORT_KEY_PREFIX, KEEPER_REASON, OFFER_TERM_COLUMNS, cleanupGroup, importSubject, mayClear, threadKey, threadKeeper,
  type CleanupGroup, type ImportOfferFacts, type ImportRound,
} from "@shared/email-offer-cleanup";

export const DRY_RUN_KEY = "email_offer_cleanup:dry_run";
export const RUNS_KEY = "email_offer_cleanup:runs";
export const BATCH_PREFIX = "email-offer-cleanup-";
const DRY_RUN_TTL_MS = 60 * 60_000;
const LOG_NOTE = "Offer from the 14 August 2026 email import, untouched: cleared from the Letting Tracker";
// The same key as lockOffer's (server/unit-negotiation.ts), so nothing can log
// a position on an offer while it is being cleared.
export const OFFER_LOCK_PREFIX = "unit_offer:";

export type CleanupRow = {
  id: string; offerDate: string | null; companyName: string | null; contactName: string | null;
  subject: string | null; group: CleanupGroup; keptBecause: string[];
  /** The email thread (threadKey of the subject) and whether this row stands for its offer. */
  thread: string; keeper: boolean;
};
export type CleanupThread = {
  key: string; subject: string | null; emails: number;
  /** The row that stays as the offer; chosen = picked from the untouched rows (a "not an offer" tick clears it too). */
  keeperId: string | null; keeperChosen: boolean;
  counts: Record<CleanupGroup, number>; first: string | null; last: string | null;
};
export type CleanupUnit = {
  unitId: string; onTracker: boolean; unitName: string | null; propertyId: string | null; propertyName: string | null;
  counts: Record<CleanupGroup, number>;
  /** Offers on the unit that are not from the import: they all stay. */
  otherOffers: number;
  threads: CleanupThread[];
  rows: CleanupRow[];
};
export type CleanupRun = {
  kind: "apply" | "undo"; at: string; by: string | null; byName: string | null; batch: string;
  undoOf?: string; undoneAt?: string; counts: Record<string, number>;
};
type DryRun = {
  at: string; by: string | null;
  /** The copies that may be cleared, each with its thread and the row kept for that thread. */
  ids: Record<string, { unitId: string; group: CleanupGroup; thread: string; keeper: string | null }>;
  /** The untouched rows kept as each thread's offer: cleared only when the thread is ticked as not an offer. */
  keepers: Record<string, { unitId: string; thread: string }>;
};
type Tables = { rounds: boolean; recommendations: boolean; suggestions: boolean; hotsOffer: boolean };

const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });

async function readSetting<T>(pool: Pool, key: string): Promise<T | null> {
  const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
  return (r.rows[0]?.value as T) ?? null;
}
async function writeSetting(pool: Pool, key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}
async function readRuns(pool: Pool): Promise<CleanupRun[]> {
  const runs = await readSetting<CleanupRun[]>(pool, RUNS_KEY);
  return Array.isArray(runs) ? runs : [];
}
async function actorName(pool: Pool, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = (await pool.query(`SELECT name, email, username FROM users WHERE id = $1 LIMIT 1`, [userId])).rows[0];
  return u ? (u.name || u.email || u.username || null) : null;
}

// What can point at an offer. A table that is not there points at nothing.
async function tablesPresent(db: Pool | PoolClient): Promise<Tables> {
  const r = (await db.query(
    `SELECT to_regclass('unit_offer_rounds') IS NOT NULL AS rounds,
            to_regclass('unit_recommendations') IS NOT NULL AS recommendations,
            to_regclass('letting_suggestions') IS NOT NULL AS suggestions,
            EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'available_units' AND column_name = 'hots_offer_id') AS hots_offer`)).rows[0];
  return { rounds: !!r.rounds, recommendations: !!r.recommendations, suggestions: !!r.suggestions, hotsOffer: !!r.hots_offer };
}

// Every import row ($1 = the import's key prefix), with what the rule needs.
// With $2, only those ids.
function factsSql(t: Tables, byIds: boolean): string {
  return `
    SELECT o.*,
           au.id AS au_id, au.unit_name AS au_unit_name, au.property_id AS au_property_id, p.name AS property_name,
           c.name AS company_record_name,
           (c.id IS NOT NULL AND COALESCE(c.company_type, '') ILIKE 'tenant%') AS credited_to_brand,
           ${t.hotsOffer ? "EXISTS (SELECT 1 FROM available_units h WHERE h.hots_offer_id = o.id)" : "false"} AS hots_offer,
           ${t.recommendations ? "EXISTS (SELECT 1 FROM unit_recommendations rec WHERE rec.offer_id = o.id)" : "false"} AS recommendation_offer,
           ${t.suggestions ? "EXISTS (SELECT 1 FROM letting_suggestions s WHERE s.record_kind = 'offer' AND s.record_id = o.id)" : "false"} AS logged_from_comment,
           ${t.rounds
             ? "COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.round_no, r.created_at) FROM unit_offer_rounds r WHERE r.offer_id = o.id), '[]'::jsonb)"
             : "'[]'::jsonb"} AS rounds_json
      FROM unit_offers o
      LEFT JOIN available_units au ON au.id = o.unit_id
      LEFT JOIN crm_properties p ON p.id = au.property_id
      LEFT JOIN crm_companies c ON c.id = o.company_id
     WHERE o.source = 'email' AND left(o.email_conversation_id, length($1)) = $1
       ${byIds ? "AND o.id = ANY($2::varchar[])" : ""}
     ORDER BY p.name NULLS LAST, au.unit_name NULLS LAST, o.offer_date DESC, o.id`;
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function factsOf(row: any): ImportOfferFacts {
  const rounds: ImportRound[] = (Array.isArray(row.rounds_json) ? row.rounds_json : []).map((r: any) => ({
    roundNo: Number(r.round_no), party: r.party ?? null,
    createdByUserId: r.created_by_user_id ?? null, createdByName: r.created_by_name ?? null, note: r.note ?? null,
    hasTerms: OFFER_TERM_COLUMNS.some(c => !blank(r[c])), edited: !blank(r.updated_at),
  }));
  return {
    source: row.source ?? null, comments: row.comments ?? null, emailConversationId: row.email_conversation_id ?? null,
    status: row.status ?? null, confirmedAt: row.confirmed_at ?? null,
    agreedAt: row.agreed_at ?? null, agreedByUserId: row.agreed_by_user_id ?? null, agreedByName: row.agreed_by_name ?? null,
    terms: Object.fromEntries(OFFER_TERM_COLUMNS.map(c => [c, row[c] ?? null])),
    viewingId: row.viewing_id ?? null, updatedAt: row.updated_at ?? null, rounds,
    hotsOffer: !!row.hots_offer, recommendationOffer: !!row.recommendation_offer, loggedFromComment: !!row.logged_from_comment,
    creditedToBrand: !!row.credited_to_brand,
  };
}

function rowOf(row: any): CleanupRow {
  const verdict = cleanupGroup(factsOf(row));
  const comment = String(row.comments ?? "");
  const subject = importSubject(comment) ?? (comment ? comment.slice(0, 160) : null);
  return {
    id: row.id, offerDate: row.offer_date ?? null,
    companyName: row.company_name || row.company_record_name || null, contactName: row.contact_name || null,
    subject, group: verdict.group, keptBecause: verdict.keptBecause, thread: threadKey(subject), keeper: false,
  };
}

const threadSlot = (unitId: string, thread: string) => `${unitId}\u0000${thread}`;

export async function previewEmailOfferCleanup(pool: Pool, opts: { by: string | null }) {
  const tables = await tablesPresent(pool);
  const rows = (await pool.query(factsSql(tables, false), [IMPORT_KEY_PREFIX])).rows;
  const units = new Map<string, CleanupUnit>();
  const ids: DryRun["ids"] = {};
  const keepers: DryRun["keepers"] = {};
  const counts: Record<CleanupGroup, number> = { clear: 0, brand: 0, kept: 0 };

  // One email thread on one unit is one offer: keep one of its rows.
  const prepared = rows.map((raw: any) => ({ raw, row: rowOf(raw) }));
  const byThread = new Map<string, typeof prepared>();
  for (const p of prepared) {
    const slot = threadSlot(p.raw.unit_id, p.row.thread);
    byThread.set(slot, [...(byThread.get(slot) || []), p]);
  }
  const keeperOf = new Map<string, string | null>();
  for (const [slot, items] of byThread) {
    const { keeperId, chosen } = threadKeeper(items.map(({ raw, row }) => ({
      id: row.id, offerDate: row.offerDate, group: row.group, creditedToBrand: !!raw.credited_to_brand,
    })));
    keeperOf.set(slot, keeperId);
    for (const { raw, row } of items) {
      if (row.id !== keeperId) continue;
      row.keeper = true;
      if (chosen) {
        row.group = "kept";
        row.keptBecause = [KEEPER_REASON];
        keepers[row.id] = { unitId: raw.unit_id, thread: row.thread };
      }
    }
  }

  for (const { raw, row } of prepared) {
    const unit: CleanupUnit = units.get(raw.unit_id) || {
      unitId: raw.unit_id, onTracker: !!raw.au_id, unitName: raw.au_unit_name ?? null,
      propertyId: raw.au_property_id ?? null, propertyName: raw.property_name ?? null,
      counts: { clear: 0, brand: 0, kept: 0 }, otherOffers: 0, threads: [], rows: [],
    };
    unit.counts[row.group] += 1;
    unit.rows.push(row);
    units.set(raw.unit_id, unit);
    counts[row.group] += 1;
    if (mayClear(row.group)) {
      ids[row.id] = { unitId: raw.unit_id, group: row.group, thread: row.thread, keeper: keeperOf.get(threadSlot(raw.unit_id, row.thread)) ?? null };
    }
  }
  for (const unit of units.values()) {
    const threads = new Map<string, CleanupThread>();
    for (const row of unit.rows) {
      const t: CleanupThread = threads.get(row.thread) || {
        key: row.thread, subject: row.subject, emails: 0, keeperId: null, keeperChosen: false,
        counts: { clear: 0, brand: 0, kept: 0 }, first: row.offerDate, last: row.offerDate,
      };
      t.emails += 1;
      t.counts[row.group] += 1;
      if (row.keeper) { t.keeperId = row.id; t.keeperChosen = !!keepers[row.id]; t.subject = row.subject; }
      if (row.offerDate && (!t.first || row.offerDate < t.first)) t.first = row.offerDate;
      if (row.offerDate && (!t.last || row.offerDate > t.last)) t.last = row.offerDate;
      threads.set(row.thread, t);
    }
    unit.threads = [...threads.values()].sort((a, b) =>
      (b.counts.clear + b.counts.brand) - (a.counts.clear + a.counts.brand) || b.emails - a.emails || a.key.localeCompare(b.key));
    const order = new Map(unit.threads.map((t, i) => [t.key, i]));
    unit.rows.sort((a, b) => (order.get(a.thread)! - order.get(b.thread)!) || Number(b.keeper) - Number(a.keeper)
      || String(a.offerDate ?? "~").localeCompare(String(b.offerDate ?? "~")) || a.id.localeCompare(b.id));
  }
  if (units.size) {
    const others = await pool.query(
      `SELECT unit_id, count(*)::int AS n FROM unit_offers
        WHERE unit_id = ANY($1::varchar[])
          AND NOT (COALESCE(source, '') = 'email' AND left(COALESCE(email_conversation_id, ''), length($2)) = $2)
        GROUP BY unit_id`, [[...units.keys()], IMPORT_KEY_PREFIX]);
    for (const r of others.rows) { const u = units.get(r.unit_id); if (u) u.otherOffers = r.n; }
  }
  const list = [...units.values()].sort((a, b) =>
    (b.counts.clear + b.counts.brand) - (a.counts.clear + a.counts.brand)
    || String(a.propertyName ?? "~").localeCompare(String(b.propertyName ?? "~"))
    || String(a.unitName ?? "").localeCompare(String(b.unitName ?? "")));
  const previewedAt = new Date().toISOString();
  await writeSetting(pool, DRY_RUN_KEY, { at: previewedAt, by: opts.by, ids, keepers } satisfies DryRun);
  return {
    dryRun: true as const, previewedAt,
    counts: { offers: rows.length, units: units.size, threads: byThread.size, ...counts },
    units: list,
    runs: (await readRuns(pool)).slice(-10).reverse(),
  };
}

let running = false;

export async function applyEmailOfferCleanup(pool: Pool, opts: { by: string | null; ids: unknown; previewedAt: unknown; threads?: unknown }) {
  const dry = await readSetting<DryRun>(pool, DRY_RUN_KEY);
  if (!dry?.at || !dry.ids || Date.now() - new Date(dry.at).getTime() > DRY_RUN_TTL_MS) {
    throw refusal(409, "Preview first. Apply only runs within an hour of a preview.");
  }
  // The ticks must come from the preview this admin is looking at: not one
  // another admin made since, nor an earlier one of their own.
  if (!opts.by || dry.by !== opts.by || opts.previewedAt !== dry.at) {
    throw refusal(409, "The preview has changed since you saw it. Preview again, then apply.");
  }
  // A preview from before threads were kept has no kept rows to protect.
  if (!dry.keepers) throw refusal(409, "The clean-up has changed since this preview. Preview again, then apply.");
  const ticked = Array.isArray(opts.ids) ? [...new Set(opts.ids.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  // Threads ticked as not an offer at all: every clearable row of the thread
  // goes, the row kept as its offer included.
  const whole = new Set<string>();
  for (const t of Array.isArray(opts.threads) ? opts.threads : []) {
    if (t && typeof t.unitId === "string" && typeof t.key === "string") whole.add(threadSlot(t.unitId, t.key));
  }
  const wholeIds = [
    ...Object.entries(dry.ids).filter(([, s]) => whole.has(threadSlot(s.unitId, s.thread))).map(([id]) => id),
    ...Object.entries(dry.keepers).filter(([, k]) => whole.has(threadSlot(k.unitId, k.thread))).map(([id]) => id),
  ];
  if (!ticked.length && !wholeIds.length) throw refusal(400, "Tick the offers to clear, from the preview.");
  if (running) throw refusal(409, "A clean-up is already running. Try again when it has finished.");
  running = true;
  try {
    const notPreviewed = ticked.filter(id => !dry.ids[id]);
    type UnitWork = { ids: Set<string>; verify: Map<string, string> };
    const byUnit = new Map<string, UnitWork>();
    const work = (unitId: string): UnitWork => {
      const w = byUnit.get(unitId) || { ids: new Set<string>(), verify: new Map<string, string>() };
      byUnit.set(unitId, w);
      return w;
    };
    const threadOf = (id: string) => dry.ids[id]?.thread ?? dry.keepers[id]?.thread ?? "";
    for (const id of ticked) {
      const seen = dry.ids[id];
      if (!seen) continue;
      const w = work(seen.unitId);
      w.ids.add(id);
      // A copy goes only while the row kept for its thread is still there.
      if (!whole.has(threadSlot(seen.unitId, seen.thread)) && seen.keeper) w.verify.set(seen.thread, seen.keeper);
    }
    for (const id of wholeIds) work(dry.ids[id]?.unitId ?? dry.keepers[id].unitId).ids.add(id);
    const at = new Date().toISOString();
    const batch = `${BATCH_PREFIX}${at}`;
    const byName = await actorName(pool, opts.by);
    const deleted: Array<{ id: string; unitId: string }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const failed: Array<{ unitId: string; offers: number; error: string }> = [];
    let rounds = 0;
    for (const [unitId, w] of byUnit) {
      const ids = [...w.ids].sort();
      const keep = [...new Set(w.verify.values())];
      const lockIds = [...new Set([...ids, ...keep])].sort();
      const client = await pool.connect();
      const unitSkipped: typeof skipped = [];
      try {
        await client.query("BEGIN");
        const tables = await tablesPresent(client);
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($2::text || x)) FROM unnest($1::varchar[]) AS x ORDER BY x`, [lockIds, OFFER_LOCK_PREFIX]);
        await client.query(`SELECT id FROM unit_offers WHERE id = ANY($1::varchar[]) ORDER BY id FOR UPDATE`, [lockIds]);
        const present = new Map<string, string>(keep.length
          ? (await client.query(`SELECT id, unit_id FROM unit_offers WHERE id = ANY($1::varchar[])`, [keep])).rows.map((r: any) => [String(r.id), String(r.unit_id)])
          : []);
        const lost = new Set([...w.verify].filter(([, keeperId]) => present.get(keeperId) !== unitId).map(([thread]) => thread));
        const live = new Map<string, any>((await client.query(factsSql(tables, true), [IMPORT_KEY_PREFIX, ids])).rows.map((r: any) => [r.id, r]));
        const go: string[] = [];
        for (const id of ids) {
          if (lost.has(threadOf(id))) { unitSkipped.push({ id, reason: "the offer kept for its email thread has gone since the preview, so its copies are left" }); continue; }
          const row = live.get(id);
          if (!row) { unitSkipped.push({ id, reason: "already gone, or no longer an import row" }); continue; }
          if (row.unit_id !== unitId) { unitSkipped.push({ id, reason: "moved to another unit since the preview" }); continue; }
          const verdict = cleanupGroup(factsOf(row));
          if (!mayClear(verdict.group)) { unitSkipped.push({ id, reason: verdict.keptBecause.join(", ") }); continue; }
          go.push(id);
        }
        let unitRounds = 0;
        let gone: string[] = [];
        if (go.length) {
          // Each row is written whole to the log by the statement that deletes it.
          if (tables.rounds) {
            const r = await client.query(
              `WITH gone AS (DELETE FROM unit_offer_rounds WHERE offer_id = ANY($1::varchar[]) RETURNING *)
               INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note)
               SELECT $2, 'unit_offer_rounds', g.id, 'deleted', to_jsonb(g), $3 FROM gone g
               RETURNING record_id`, [go, batch, LOG_NOTE]);
            unitRounds = r.rowCount ?? r.rows.length;
          }
          const r = await client.query(
            `WITH gone AS (DELETE FROM unit_offers WHERE id = ANY($1::varchar[]) RETURNING *)
             INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note)
             SELECT $2, 'unit_offers', g.id, 'deleted', to_jsonb(g), $3 FROM gone g
             RETURNING record_id`, [go, batch, LOG_NOTE]);
          gone = r.rows.map((x: any) => String(x.record_id));
        }
        await client.query("COMMIT");
        rounds += unitRounds;
        for (const id of gone) deleted.push({ id, unitId });
        skipped.push(...unitSkipped);
      } catch (e: any) {
        await client.query("ROLLBACK").catch(() => {});
        failed.push({ unitId, offers: ids.length, error: e?.message || String(e) });
      } finally {
        client.release();
      }
    }
    const counts = {
      deleted: deleted.length, rounds, units: new Set(deleted.map(d => d.unitId)).size,
      skipped: skipped.length, notPreviewed: notPreviewed.length, failed: failed.length, wholeThreads: whole.size,
    };
    const run: CleanupRun = { kind: "apply", at, by: opts.by, byName, batch, counts };
    await writeSetting(pool, RUNS_KEY, [...(await readRuns(pool)), run]);
    await pool.query(`DELETE FROM system_settings WHERE key = $1`, [DRY_RUN_KEY]);
    return { dryRun: false as const, batch, appliedAt: at, by: opts.by, byName, counts, skipped, failed };
  } finally {
    running = false;
  }
}

/** Put back every offer (and its round) the batch deleted whose unit is still
 *  on the tracker and whose id and email key are still free. */
export async function undoEmailOfferCleanup(pool: Pool, opts: { batch: unknown; by: string | null }) {
  const batch = typeof opts.batch === "string" ? opts.batch.trim() : "";
  if (!batch.startsWith(BATCH_PREFIX) || batch.includes("-undo-")) throw refusal(400, "Say which clean-up to undo.");
  if (running) throw refusal(409, "A clean-up is already running. Try again when it has finished.");
  running = true;
  try {
    const at = new Date().toISOString();
    const undoBatch = `${batch}-undo-${at}`;
    const note = `undo of ${batch}`;
    const client = await pool.connect();
    let logged = 0, restored = 0, roundsBack = 0;
    try {
      await client.query("BEGIN");
      logged = (await client.query(
        `SELECT count(*)::int AS n FROM investment_comp_migration_log WHERE batch = $1 AND table_name = 'unit_offers' AND action = 'deleted'`,
        [batch])).rows[0].n;
      if (!logged) throw refusal(404, "No clean-up by that name.");
      const offers = await client.query(
        `WITH logged AS (
           SELECT jsonb_populate_record(NULL::unit_offers, l.prior) AS r
             FROM investment_comp_migration_log l
            WHERE l.batch = $1 AND l.table_name = 'unit_offers' AND l.action = 'deleted'
         ), back AS (
           INSERT INTO unit_offers
           SELECT (x.r).* FROM logged x
            WHERE EXISTS (SELECT 1 FROM available_units au WHERE au.id = (x.r).unit_id)
           ON CONFLICT DO NOTHING
           RETURNING id
         )
         INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note)
         SELECT $2, 'unit_offers', b.id, 'restored', NULL, $3 FROM back b
         RETURNING record_id`, [batch, undoBatch, note]);
      restored = offers.rows.length;
      if ((await tablesPresent(client)).rounds) {
        const back = await client.query(
          `WITH logged AS (
             SELECT jsonb_populate_record(NULL::unit_offer_rounds, l.prior) AS r
               FROM investment_comp_migration_log l
              WHERE l.batch = $1 AND l.table_name = 'unit_offer_rounds' AND l.action = 'deleted'
           ), back AS (
             INSERT INTO unit_offer_rounds
             SELECT (x.r).* FROM logged x
              WHERE (x.r).offer_id = ANY($4::varchar[])
             ON CONFLICT DO NOTHING
             RETURNING id
           )
           INSERT INTO investment_comp_migration_log (batch, table_name, record_id, action, prior, note)
           SELECT $2, 'unit_offer_rounds', b.id, 'restored', NULL, $3 FROM back b
           RETURNING record_id`, [batch, undoBatch, note, offers.rows.map((x: any) => String(x.record_id))]);
        roundsBack = back.rows.length;
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const byName = await actorName(pool, opts.by);
    const counts = { restored, rounds: roundsBack, notRestored: logged - restored };
    const runs = (await readRuns(pool)).map(r => (r.kind === "apply" && r.batch === batch && !r.undoneAt ? { ...r, undoneAt: at } : r));
    runs.push({ kind: "undo", at, by: opts.by, byName, batch: undoBatch, undoOf: batch, counts });
    await writeSetting(pool, RUNS_KEY, runs);
    return { batch: undoBatch, undoOf: batch, undoneAt: at, by: opts.by, byName, counts };
  } finally {
    running = false;
  }
}

export async function emailOfferCleanupRuns(pool: Pool): Promise<CleanupRun[]> {
  return (await readRuns(pool)).slice(-10).reverse();
}

export function registerEmailOfferCleanupRoutes(app: Express, deps: { pool: Pool; requireAuth: RequestHandler; requireAdmin: RequestHandler }) {
  const { pool, requireAuth, requireAdmin } = deps;
  const actor = (req: Request): string | null => (req as any).session?.userId || (req as any).tokenUserId || null;
  const fail = (res: Response, e: any) => {
    if (!e?.status) console.error("[email-offer-cleanup]", e?.message || e);
    res.status(e?.status || 500).json({ message: e?.message || "The offer clean-up failed." });
  };
  app.get("/api/admin/email-offer-cleanup/runs", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json({ runs: await emailOfferCleanupRuns(pool) }); } catch (e) { fail(res, e); }
  });
  app.post("/api/admin/email-offer-cleanup", requireAuth, requireAdmin, async (req, res) => {
    try {
      if (req.body?.dryRun !== false) return res.json(await previewEmailOfferCleanup(pool, { by: actor(req) }));
      res.json(await applyEmailOfferCleanup(pool, { by: actor(req), ids: req.body?.ids, previewedAt: req.body?.previewedAt, threads: req.body?.threads }));
    } catch (e) { fail(res, e); }
  });
  app.post("/api/admin/email-offer-cleanup/undo", requireAuth, requireAdmin, async (req, res) => {
    try { res.json(await undoEmailOfferCleanup(pool, { batch: req.body?.batch, by: actor(req) })); } catch (e) { fail(res, e); }
  });
}
