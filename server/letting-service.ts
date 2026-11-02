// The one write door for letting deals and Letting Tracker rows (CLAUDE.md
// "Lettings: units, deals and the Letting Tracker", decided 2026-10-26;
// docs/letting-cleanup-technical-appendix.md "One write door per record",
// Phase 2).
//
//   createListing          — the body of POST /api/available-units (Add Unit,
//                            ChatBGP's create_available_unit, client-added
//                            units): property_units find/create, the tracker
//                            row, the leasing row, the spine link, the backing
//                            deal, the landlord stamp, the fee split.
//   createDeal/updateDeal  — the deal factory behind POST/PUT /api/crm/deals,
//                            the WIP import and import-anything: status code,
//                            scheme defaults, unit/spine stamp, the letting
//                            rules on CREATE (a letting needs a unit; one live
//                            landlord-side letting per unit), then the tracker
//                            row for every live letting.
//   ensureTrackerRowForDeal— deal ⇒ tracker: adopt the unit's existing row or
//                            create one, never two rows for one deal.
//
// Every call that creates or links rows writes ONE deal_audit_log row
// (field 'letting_service', the ids it made as JSON) so a backout can walk
// exactly what it did. Nothing here runs at boot; integrity is reported
// (server/letting-integrity.ts), never silently repaired.
import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { insertAvailableUnitSchema, insertCrmDealSchema, type AvailableUnit, type CrmDeal, type InsertDealFeeAllocation } from "@shared/schema";
import { legacyToCode, statusSpellingsFor, TERMINAL_STATUSES } from "@shared/deal-status";
import { codeToLeasingStatus } from "@shared/lease-status-mirror";
import { isFirmOnlyDealType } from "@shared/fee-policy";
import { DEFAULT_LETTING_TYPE, closedStatusSqlList, isHistoricStatus, isLettingType, isTrackerDeal, lettingTypeSqlList } from "@shared/letting-rules";
import { pool as defaultPool } from "./db";
import { storage } from "./storage";

export type LettingSource = "deal-form" | "chat" | "wip-import" | "ingest" | "add-unit" | "backfill" | "client-add" | "xero";

export interface LettingCtx {
  userId: string | null;
  source: LettingSource;
  /** A client login's company (Landsec): the deal's landlord, and no BGP fee. */
  scope?: string | null;
  /** A transaction client when the caller is mid-transaction (the WIP import). */
  client?: PoolClient;
}

export type Queryable = Pool | PoolClient;

/** HTTP 409 for the letting rules. Routes answer `status` with `toBody()`. */
export class LettingRefusal extends Error {
  status = 409;
  constructor(
    public code: "LIVE_LETTING_EXISTS" | "UNIT_REQUIRED",
    message: string,
    public existing: { existingDealId?: string; existingDealRef?: number | null; trackerRowId?: string | null } = {},
  ) {
    super(message);
    this.name = "LettingRefusal";
  }
  toBody() {
    return {
      message: this.message,
      error: this.message,
      code: this.code,
      ...(this.existing.existingDealId ? { existingDealId: this.existing.existingDealId } : {}),
      ...(this.existing.existingDealRef != null ? { existingDealRef: this.existing.existingDealRef } : {}),
      ...(this.existing.trackerRowId ? { trackerRowId: this.existing.trackerRowId } : {}),
    };
  }
}

export const liveLettingMessage = (ref: number | null | undefined) =>
  `Already on the Letting Tracker as #${ref ?? "?"} — open that deal or link to it`;
export const UNIT_REQUIRED_MESSAGE = "A letting needs a property and a unit (an actual address) — pick or add the unit";

const q = (ctx: LettingCtx): Queryable => ctx.client ?? defaultPool;

/** ctx.source for a route: ChatBGP's own-route calls (callOwnRoute,
 *  addUnitToLettingTracker) mark themselves with X-BGP-Source: chat so the
 *  audit row says which door the write came through. */
export function lettingSource(req: { headers?: Record<string, unknown> }, fallback: LettingSource = "deal-form"): LettingSource {
  const h = String(req.headers?.["x-bgp-source"] || "").toLowerCase();
  return h === "chat" ? "chat" : fallback;
}
const isLandlordSide = (actingFor: string | null | undefined) => (actingFor || "landlord") === "landlord";

/** The unit's identity for a name match: the first comma segment, lower-
 *  cased — the tracker stores "MSU9, Bluewater, Bluewater" where the spine
 *  has "MSU9", and the tracker's own duplicate guard keys on this segment.
 *  '' (no match) below two characters, as that guard does. */
export function unitNameSegment(name: string | null | undefined): string {
  const seg = String(name || "").split(",")[0].trim().toLowerCase();
  return seg.length >= 2 ? seg : "";
}
const SEG_SQL = (expr: string) => `lower(trim(split_part(coalesce(${expr}, ''), ',', 1)))`;

/** Serialise the letting rules, the insert and the tracker row for one
 *  physical unit, so two concurrent creates (two agents, or ChatBGP and
 *  the deal form) can't both pass the one-live-letting guard — the
 *  application check is the only guard until Woody's index lands. Inside
 *  the caller's transaction the lock is transaction-scoped; otherwise a
 *  dedicated session holds it for the call. */
async function withUnitLock<T>(ctx: LettingCtx, propertyId: string, unitId: string, fn: () => Promise<T>): Promise<T> {
  const key = `letting:${propertyId}:${unitId}`;
  if (ctx.client) {
    await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
    return fn();
  }
  const client = await defaultPool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [key]);
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

// ── Audit ────────────────────────────────────────────────────────────────
// deal_audit_log has no jsonb column (deal_id, field, old_value, new_value,
// reason, changed_by, changed_by_name): the details go in new_value as JSON
// under field 'letting_service', reason 'letting_service:<source>'.
export interface LettingAudit {
  dealId: string;
  trackerRowId?: string | null;
  propertyUnitId?: string | null;
  tenancyUnitId?: string | null;
  /** "<table>:<id>" for every row this call made. */
  created: string[];
  /** "<table>:<id>" for every row this call linked rather than made. */
  adopted: string[];
  [extra: string]: unknown;
}

export async function logLettingService(db: Queryable, details: LettingAudit, ctx: LettingCtx): Promise<void> {
  if (!details.dealId) return;
  await db.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by)
     VALUES ($1, 'letting_service', NULL, $2, $3, $4)`,
    [details.dealId, JSON.stringify({ ...details, source: ctx.source }), `letting_service:${ctx.source}`, ctx.userId || null],
  ).catch((e: any) => console.warn("[letting-service] audit write failed:", e?.message));
}

// ── Physical unit helpers ────────────────────────────────────────────────

/** "__tenancy__<id>" (a tenancy row picked on the deal form) → the
 *  property_units id for that unit on the property, created if missing. */
export async function resolveTenancyTokenToUnitId(db: Queryable, token: string, propertyId: string | null | undefined): Promise<string | null> {
  if (!token || !token.startsWith("__tenancy__") || !propertyId) return null;
  const tenancyId = token.slice("__tenancy__".length);
  if (!tenancyId) return null;
  try {
    // The same name the unit search and findSpineRowId use: a Landsec
    // sheet lands the unit label in premises with unit_number empty.
    const t = await db.query(
      "SELECT coalesce(nullif(trim(unit_number), ''), premises) AS unit_name, nia_sqft FROM tenancy_schedule_units WHERE id = $1 LIMIT 1",
      [tenancyId],
    );
    const unitName: string | null = t.rows[0]?.unit_name?.toString().trim() || null;
    if (!unitName) return null;
    const existing = await db.query(
      "SELECT id FROM property_units WHERE property_id = $1 AND lower(trim(unit_name)) = lower($2) LIMIT 1",
      [propertyId, unitName],
    );
    if (existing.rows[0]?.id) return existing.rows[0].id as string;
    const nia: number | null = t.rows[0]?.nia_sqft ?? null;
    const ins = await db.query(
      `INSERT INTO property_units (property_id, unit_name, sqft) VALUES ($1, $2, $3) RETURNING id`,
      [propertyId, unitName, nia],
    );
    return (ins.rows[0]?.id as string) ?? null;
  } catch (e: any) {
    console.warn("[letting-service] resolveTenancyTokenToUnitId failed:", e?.message);
    return null;
  }
}

/** The spine row for a (property, unit name): the same confident
 *  normalised-name match the create/update stamps have always used. */
async function findSpineRowId(db: Queryable, propertyId: string, unitName: string): Promise<string | null> {
  if (!unitName.trim()) return null;
  const r = await db.query(
    `SELECT id FROM tenancy_schedule_units
      WHERE property_id = $1
        AND lower(trim(coalesce(nullif(trim(unit_number), ''), premises, ''))) = lower(trim($2))
      LIMIT 1`,
    [propertyId, unitName],
  );
  return r.rows[0]?.id ?? null;
}

/** The live landlord-side LETTING deal already on this physical unit, if
 *  any — same property, same unit_id, same spine row, or the same unit
 *  name identity (first comma segment: "MSU9" is "MSU9, Bluewater,
 *  Bluewater"), letting type, not historic. An untyped deal reads as
 *  New Letting, as ensureBackingDealForUnit reads it. Advisory and
 *  tenant-rep deals never match; a tenant-side letting (Lease Disposal /
 *  Sub-Letting acting for the tenant) never matches. */
export async function findLiveLandlordLetting(
  db: Queryable,
  unit: { propertyId: string; unitId?: string | null; unitName?: string | null; tenancyUnitId?: string | null },
  excludeDealId?: string | null,
): Promise<{ id: string; dealRef: number | null; trackerRowId: string | null } | null> {
  const seg = unitNameSegment(unit.unitName);
  const { rows } = await db.query(
    `SELECT d.id, d.deal_ref, d.status,
            (SELECT au.id FROM available_units au WHERE au.deal_id = d.id ORDER BY au.created_at LIMIT 1) AS tracker_row_id
       FROM crm_deals d
       LEFT JOIN property_units pu ON pu.id = d.unit_id
      WHERE d.property_id = $1
        AND d.id <> coalesce($5, '')
        AND coalesce(d.bgp_acting_for, 'landlord') = 'landlord'
        AND coalesce(d.deal_type, '${DEFAULT_LETTING_TYPE}') IN (${lettingTypeSqlList()})
        AND lower(trim(coalesce(d.status, ''))) NOT IN (${closedStatusSqlList()})
        AND (
             ($2::varchar IS NOT NULL AND d.unit_id = $2)
          OR ($4::varchar IS NOT NULL AND d.tenancy_unit_id = $4)
          OR ($3 <> '' AND ${SEG_SQL(`coalesce(pu.unit_name,
                    (SELECT coalesce(nullif(trim(ts.unit_number), ''), ts.premises) FROM tenancy_schedule_units ts WHERE ts.id = d.tenancy_unit_id),
                    (SELECT au2.unit_name FROM available_units au2 WHERE au2.deal_id = d.id ORDER BY au2.created_at LIMIT 1),
                    '')`)} = $3)
        )
      ORDER BY d.created_at DESC NULLS LAST`,
    [unit.propertyId, unit.unitId || null, seg, unit.tenancyUnitId || null, excludeDealId || null],
  );
  const live = rows.find((r: any) => !isHistoricStatus(r.status));
  return live ? { id: live.id, dealRef: live.deal_ref ?? null, trackerRowId: live.tracker_row_id ?? null } : null;
}

// ── Tracker-row factory ──────────────────────────────────────────────────

export interface EnsureTrackerRowResult {
  trackerRowId: string | null;
  created: boolean;
  adopted: boolean;
  /** Set when a row for this unit already carries ANOTHER live deal on the
   *  same side — no second row is made; the integrity report lists it. */
  conflict?: { dealId: string; dealRef: number | null; trackerRowId: string };
  /** The deal's own row followed the deal to the unit it now points at. */
  moved?: { trackerRowId: string; fromUnitId: string | null; toUnitId: string };
  /** The deal's own row sits on another unit and could not follow (the
   *  deal's current unit already has a live row) — reported, not forced. */
  stale?: { trackerRowId: string; rowUnitId: string | null; dealUnitId: string; otherRowId: string };
  /** Why no row was made or linked. */
  skipped?: string;
}

/** deal ⇒ tracker. For a letting-type deal with a property and a unit:
 *  return the row already carrying this deal (moving it when the deal was
 *  re-pointed at another unit); else adopt the unit's existing row when it
 *  has no deal (or its deal is historic — the fresh cycle the tracker
 *  PATCH already does, keeping the unit's viewings and offers on ONE
 *  row); else create a row keyed to the deal with marketing_status = the
 *  deal's code. Never two rows for one deal, never a second row beside
 *  another live deal on the same side. A historic deal only ever adopts
 *  (a let unit gets no new live row).
 *
 *  Audit: with `audit` passed (the deal factory's own row) everything made
 *  or linked is appended to it and the caller logs once; standalone (the
 *  backfill, link-deal) this writes its own row. */
export async function ensureTrackerRowForDeal(db: Queryable, dealId: string, ctx: LettingCtx, audit?: LettingAudit): Promise<EnsureTrackerRowResult> {
  const none: EnsureTrackerRowResult = { trackerRowId: null, created: false, adopted: false };
  const a: LettingAudit = audit ?? { dealId, created: [], adopted: [] };
  const finish = async (r: EnsureTrackerRowResult): Promise<EnsureTrackerRowResult> => {
    if (r.trackerRowId) a.trackerRowId = r.trackerRowId;
    if (r.conflict) a.trackerConflict = r.conflict;
    if (r.moved) a.trackerRowMoved = r.moved;
    if (r.stale) a.trackerRowStale = r.stale;
    if (r.skipped) a.trackerRowSkipped = r.skipped;
    if (!audit && (r.created || r.adopted || r.moved)) await logLettingService(db, a, ctx);
    return r;
  };

  const { rows: drows } = await db.query(
    `SELECT d.id, d.deal_ref, d.property_id, d.unit_id, d.tenancy_unit_id, d.status, d.deal_type, d.bgp_acting_for,
            d.fee, d.rent_pa, d.total_area_sqft,
            pu.unit_name, pu.floor, pu.sqft AS pu_sqft, pu.use_class, pu.condition, pu.epc_rating
       FROM crm_deals d
       LEFT JOIN property_units pu ON pu.id = d.unit_id AND pu.property_id = d.property_id
      WHERE d.id = $1`,
    [dealId],
  );
  const deal = drows[0];
  if (!deal || !isLettingType(deal.deal_type) || !deal.property_id || !deal.unit_id) return none;
  const code = legacyToCode(deal.status);
  if (!code) return none;
  const historic = isHistoricStatus(deal.status);
  const unitName = String(deal.unit_name || "").trim();
  const seg = unitNameSegment(unitName);

  // The row already keyed to this deal — scoped to the deal's CURRENT
  // property + unit. A deal re-pointed at another unit on the edit form
  // takes its row with it when that unit has no live row of its own.
  const linked = await db.query(
    `SELECT id, property_id, unit_id, unit_name, tenancy_unit_id FROM available_units WHERE deal_id = $1 ORDER BY created_at LIMIT 1`, [dealId]);
  if (linked.rows[0]) {
    const row = linked.rows[0];
    const samePlace = row.property_id === deal.property_id && (
      row.unit_id === deal.unit_id
      || (!!deal.tenancy_unit_id && row.tenancy_unit_id === deal.tenancy_unit_id)
      || (!!seg && unitNameSegment(row.unit_name) === seg));
    if (samePlace) return finish({ trackerRowId: row.id, created: false, adopted: false });
    const other = await db.query(
      `SELECT id FROM available_units
        WHERE id <> $1 AND property_id = $2
          AND (unit_id = $3
            OR ($4::varchar IS NOT NULL AND tenancy_unit_id = $4)
            OR ($5 <> '' AND ${SEG_SQL("unit_name")} = $5))
          AND lower(trim(coalesce(marketing_status, ''))) NOT IN (${closedStatusSqlList()})
        ORDER BY created_at LIMIT 1`,
      [row.id, deal.property_id, deal.unit_id, deal.tenancy_unit_id || null, seg]);
    if (other.rows[0]) {
      return finish({ trackerRowId: row.id, created: false, adopted: false, stale: { trackerRowId: row.id, rowUnitId: row.unit_id ?? null, dealUnitId: deal.unit_id, otherRowId: other.rows[0].id } });
    }
    if (!unitName) return finish({ trackerRowId: row.id, created: false, adopted: false, skipped: "deal's unit_id has no property_units row — row not moved" });
    const spineId: string | null = deal.tenancy_unit_id || (await findSpineRowId(db, deal.property_id, unitName));
    await db.query(
      `UPDATE available_units SET property_id = $2, unit_id = $3, unit_name = $4, tenancy_unit_id = $5, updated_at = NOW() WHERE id = $1`,
      [row.id, deal.property_id, deal.unit_id, unitName, spineId]);
    await db.query(`UPDATE tenancy_schedule_units SET letting_tracker_unit_id = NULL WHERE letting_tracker_unit_id = $1 AND id IS DISTINCT FROM $2`, [row.id, spineId]).catch(() => {});
    if (spineId) {
      await db.query(`UPDATE tenancy_schedule_units SET letting_tracker_unit_id = $1 WHERE id = $2 AND letting_tracker_unit_id IS NULL`, [row.id, spineId]).catch(() => {});
    }
    a.tenancyUnitId = spineId;
    return finish({ trackerRowId: row.id, created: false, adopted: false, moved: { trackerRowId: row.id, fromUnitId: row.unit_id ?? null, toUnitId: deal.unit_id } });
  }

  // A dangling unit_id (the unit was deleted under an open form) is the
  // backfill's "needs a unit row" bucket: no row named "Unit" is made.
  if (!unitName) return finish({ ...none, skipped: "deal's unit_id has no property_units row" });

  // The unit's rows: by unit id, by spine row, or by unit-name identity
  // (first comma segment — the tracker's own duplicate-guard key).
  type Cand = { id: string; deal_id: string | null; marketing_status: string | null; tenancy_unit_id: string | null; unit_id: string | null; x_id: string | null; x_status: string | null; x_type: string | null; x_side: string | null; x_ref: number | null };
  const classify = async () => {
    const { rows: candidates } = await db.query(
      `SELECT au.id, au.deal_id, au.marketing_status, au.tenancy_unit_id, au.unit_id, au.created_at,
              x.id AS x_id, x.status AS x_status, x.deal_type AS x_type, x.bgp_acting_for AS x_side, x.deal_ref AS x_ref
         FROM available_units au
         LEFT JOIN crm_deals x ON x.id = au.deal_id
        WHERE au.property_id = $1
          AND (au.unit_id = $2
            OR ($3::varchar IS NOT NULL AND au.tenancy_unit_id = $3)
            OR ($4 <> '' AND ${SEG_SQL("au.unit_name")} = $4))
        ORDER BY au.created_at`,
      [deal.property_id, deal.unit_id, deal.tenancy_unit_id || null, seg],
    );
    // free: no deal (live row) · freeHistoric: no deal, historic status ·
    // linkedNonLetting: carries a typed non-letting deal (a Rent Review on
    // the tracker — never belonged there; the letting takes the row) ·
    // linkedHistoric: its letting is closed (fresh cycle) · linkedLive: a
    // live deal already sits here (an untyped one reads as New Letting,
    // as findLiveLandlordLetting reads it — the create was refused first).
    const free: Cand[] = [], freeHistoric: Cand[] = [], linkedNonLetting: Cand[] = [], linkedHistoric: Cand[] = [], linkedLive: Cand[] = [];
    for (const c of candidates as Cand[]) {
      if (!c.x_id) {
        (isHistoricStatus(c.marketing_status) ? freeHistoric : free).push(c);
      } else if (c.x_type != null && !isLettingType(c.x_type)) {
        linkedNonLetting.push(c);
      } else if (isHistoricStatus(c.x_status)) {
        linkedHistoric.push(c);
      } else {
        linkedLive.push(c);
      }
    }
    // Another live letting on this unit on the same side is the letting; a
    // tenant-side row beside a landlord-side one (or vice versa) is the
    // two-rows-by-side case and does not block.
    const blocker = linkedLive.find((c) => isLandlordSide(c.x_side) === isLandlordSide(deal.bgp_acting_for)) || null;
    const adoptable = free[0] || (historic ? null : (linkedNonLetting[0] || freeHistoric[0] || linkedHistoric[0])) || null;
    // A re-marketed row's fee was the old letting's: the new deal's goes on.
    const wasHistoric = !!adoptable && adoptable !== free[0] && adoptable !== linkedNonLetting[0];
    return { blocker, adoptable, wasHistoric };
  };

  // Adopt, re-reading the unit after a lost race (two creates for one
  // unit in the same instant): the row that just went to another live
  // deal is a conflict, never a reason to insert a second row.
  let raceLost = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    raceLost = false;
    const { blocker, adoptable, wasHistoric } = await classify();
    if (blocker) {
      return finish({ ...none, conflict: { dealId: blocker.x_id!, dealRef: blocker.x_ref ?? null, trackerRowId: blocker.id } });
    }
    if (!adoptable) break;
    const upd = await db.query(
      `UPDATE available_units
          SET deal_id = $1, marketing_status = $2, updated_at = NOW(),
              unit_id = COALESCE(unit_id, $4),
              tenancy_unit_id = COALESCE(tenancy_unit_id, $5),
              fee = CASE WHEN $6::boolean THEN $7::real ELSE fee END
        WHERE id = $3 AND (deal_id IS NULL OR deal_id = $8 OR NOT EXISTS (SELECT 1 FROM crm_deals z WHERE z.id = available_units.deal_id))`,
      [dealId, code, adoptable.id, deal.unit_id, deal.tenancy_unit_id || null, wasHistoric, wasHistoric ? (deal.fee ?? null) : null, adoptable.deal_id || null],
    );
    if (upd.rowCount) {
      await db.query(
        `UPDATE tenancy_schedule_units SET letting_tracker_unit_id = $1 WHERE id = (SELECT tenancy_unit_id FROM available_units WHERE id = $1) AND letting_tracker_unit_id IS NULL`,
        [adoptable.id],
      ).catch(() => {});
      a.adopted.push(`available_units:${adoptable.id}`);
      a.propertyUnitId = deal.unit_id;
      a.tenancyUnitId = deal.tenancy_unit_id || adoptable.tenancy_unit_id || null;
      a.previousDealId = adoptable.deal_id || null;
      a.freshCycle = wasHistoric;
      return finish({ trackerRowId: adoptable.id, created: false, adopted: true });
    }
    const again = await db.query(`SELECT id FROM available_units WHERE deal_id = $1 ORDER BY created_at LIMIT 1`, [dealId]);
    if (again.rows[0]) return finish({ trackerRowId: again.rows[0].id, created: false, adopted: false });
    raceLost = true;
  }
  if (raceLost) return finish({ ...none, skipped: "lost the race for the unit's row three times" });
  if (historic) return none;

  const tenancyUnitId: string | null = deal.tenancy_unit_id || (await findSpineRowId(db, deal.property_id, unitName));
  const sqft = deal.pu_sqft ?? deal.total_area_sqft ?? null;
  const ins = await db.query(
    `INSERT INTO available_units
       (property_id, unit_id, unit_name, floor, sqft, use_class, condition, epc_rating, asking_rent, marketing_status, deal_id, tenancy_unit_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [deal.property_id, deal.unit_id, unitName, deal.floor || null, sqft, deal.use_class || null, deal.condition || null,
     deal.epc_rating || null, deal.rent_pa ?? null, code, dealId, tenancyUnitId],
  );
  const trackerRowId: string = ins.rows[0].id;
  a.created.push(`available_units:${trackerRowId}`);
  a.propertyUnitId = deal.unit_id;

  // Spine: link the existing row both ways, or make one (the Add Unit
  // path's helper — idempotent, best-effort).
  let spineId = tenancyUnitId;
  if (spineId) {
    await db.query(
      `UPDATE tenancy_schedule_units SET letting_tracker_unit_id = $1 WHERE id = $2 AND letting_tracker_unit_id IS NULL`,
      [trackerRowId, spineId],
    ).catch(() => {});
  } else {
    const { ensureTenancyRowForAvailableUnit } = await import("./unit-mirror");
    await ensureTenancyRowForAvailableUnit(db as Pool, trackerRowId);
    const after = await db.query(`SELECT tenancy_unit_id FROM available_units WHERE id = $1`, [trackerRowId]);
    spineId = after.rows[0]?.tenancy_unit_id ?? null;
    if (spineId) a.created.push(`tenancy_schedule_units:${spineId}`);
  }
  a.tenancyUnitId = spineId;
  const leasingId = await ensureLeasingRow(db, deal.property_id, unitName, sqft, deal.rent_pa ?? null, code);
  if (leasingId) a.created.push(`leasing_schedule_units:${leasingId}`);

  return finish({ trackerRowId, created: true, adopted: false });
}

/** The property's Leasing Schedule row for a unit (the client-facing
 *  board). Nothing on the Add Unit path fans out from the spine, so the
 *  row is made here; returns the new id, or null when one already exists. */
async function ensureLeasingRow(db: Queryable, propertyId: string, unitName: string, sqft: number | null, rentPa: number | null, status: string | null | undefined): Promise<string | null> {
  try {
    const existing = await db.query(
      `SELECT id FROM leasing_schedule_units
        WHERE property_id = $1 AND lower(trim(coalesce(unit_name, ''))) = lower(trim($2))
        LIMIT 1`,
      [propertyId, unitName || ""],
    );
    if (existing.rows.length > 0) return null;
    const ins = await db.query(
      `INSERT INTO leasing_schedule_units (property_id, unit_name, sqft, rent_pa, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [propertyId, unitName || null, sqft, rentPa, codeToLeasingStatus(status) || "Vacant"],
    );
    return ins.rows[0]?.id ?? null;
  } catch (e: any) {
    console.warn("[letting-service] leasing-schedule row failed:", e?.message);
    return null;
  }
}

// ── Fee split (the one write path for deal_fee_allocations) ─────────────

/** The deal page's PUT /api/crm/deals/:id/fee-allocations body: validation
 *  (100% total, BGP House present, firm-only types collapse to House),
 *  the write, and the internal_agent sync. Returns the error text instead
 *  of throwing so a route can answer 400 and a listing create can warn. */
export async function writeDealFeeAllocations(dealId: string, allocations: any[]): Promise<{ ok: true; result: any[] } | { ok: false; error: string }> {
  const { rows: policyRows } = await defaultPool.query(`SELECT deal_type FROM crm_deals WHERE id = $1`, [dealId]);
  if (isFirmOnlyDealType(policyRows[0]?.deal_type)) {
    const result = await storage.setDealFeeAllocations(dealId, [{
      dealId, agentName: "BGP House", allocationType: "percentage", percentage: 100, fixedAmount: null, isBgpHouse: true,
    }] as InsertDealFeeAllocation[]);
    return { ok: true, result };
  }
  const validated = allocations.map((a: any) => ({
    dealId,
    agentName: String(a.agentName || ""),
    allocationType: a.allocationType === "fixed" ? "fixed" : "percentage",
    percentage: a.allocationType === "percentage" ? Number(a.percentage) || 0 : null,
    fixedAmount: a.allocationType === "fixed" ? Number(a.fixedAmount) || 0 : null,
    // Canonical flag for the firm overhead slice. Sage import has
    // historically inferred this from the " (BGP House)" name suffix;
    // the form now sends the boolean directly. Accept either signal.
    isBgpHouse: a.isBgpHouse === true || /\(BGP House\)/i.test(String(a.agentName || "")),
  })).filter((a: any) => a.agentName.length > 0);
  // Percentage allocations must land on 100% (with a small tolerance for
  // 33.33 × 3 type splits) AND a BGP House row must be present.
  const pctRows = validated.filter((a: any) => a.allocationType === "percentage");
  if (pctRows.length > 0) {
    const totalPct = pctRows.reduce((sum: number, a: any) => sum + (a.percentage || 0), 0);
    if (Math.abs(totalPct - 100) > 0.05) {
      return { ok: false, error: `Percentage allocations must sum to 100% — currently ${totalPct.toFixed(2)}%. Adjust the agent rows to make the total balance.` };
    }
  }
  // BGP House takes 15% off the top of EVERY deal — whatever the split type
  // and even if it's the only row (deal 3511 once landed with no firm slice).
  if (!validated.some((a: any) => a.isBgpHouse)) {
    return { ok: false, error: "Fee split must include the BGP House 15% row. Open the editor to re-add it (it auto-inserts)." };
  }
  const result = await storage.setDealFeeAllocations(dealId, validated as InsertDealFeeAllocation[]);
  // Keep crm_deals.internal_agent in sync with the fee-allocation agents so
  // the Deals board's BGP Contact column and the WIP's Agent column agree.
  try {
    const allocAgents = validated
      .filter((a: any) => !a.isBgpHouse && a.agentName)
      .map((a: any) => String(a.agentName).trim())
      .filter((n: string) => n.length > 0);
    const dealRow = await storage.getCrmDeal(dealId);
    const existing: string[] = Array.isArray((dealRow as any)?.internalAgent)
      ? ((dealRow as any).internalAgent as string[])
      : ((dealRow as any)?.internalAgent ? [(dealRow as any).internalAgent as string] : []);
    // The split IS the contact list (Woody, 2026-10-28: "the contact is
    // driven by the fee split") — replace, don't merge, so dropping someone
    // from the split drops them as BGP contact too. A split with no agent
    // rows (firm-only placeholder) leaves the contacts alone.
    const next = Array.from(new Set(allocAgents));
    if (next.length > 0 && (next.length !== existing.length || next.some((n, i) => n !== existing[i]))) {
      await storage.updateCrmDeal(dealId, { internalAgent: next } as any);
    }
  } catch (mergeErr: any) {
    console.warn(`[fee-allocations] internal_agent sync failed for ${dealId}:`, mergeErr?.message);
  }
  return { ok: true, result };
}

/** Add Unit's feeAllocations: the FeeAllocationEditor row shape
 *  ({ agentName, allocationType, percentage, fixedAmount, isBgpHouse }),
 *  with { userId | externalName, percentage } accepted for a row that
 *  names the person by id instead. */
async function normaliseFeeAllocationInput(db: Queryable, rows: any[]): Promise<any[]> {
  const ids = rows.map((r) => r?.userId).filter((v) => typeof v === "string" && v);
  const names = new Map<string, string>();
  if (ids.length) {
    const { rows: users } = await db.query(`SELECT id, name FROM users WHERE id = ANY($1::varchar[])`, [ids]);
    for (const u of users) names.set(u.id, u.name);
  }
  return rows
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      agentName: String(r.agentName || r.externalName || (r.userId ? names.get(r.userId) || "" : "")).trim(),
      allocationType: r.allocationType === "fixed" ? "fixed" : "percentage",
      percentage: r.percentage ?? null,
      fixedAmount: r.fixedAmount ?? null,
      isBgpHouse: r.isBgpHouse === true,
    }))
    .filter((r) => r.agentName);
}

// ── Listing factory (POST /api/available-units) ──────────────────────────

export type CreatedListing = AvailableUnit & { dealId?: string; dealRef?: number | null; dealCreated?: boolean; feeAllocationsError?: string };
export type CreateListingResult =
  | { kind: "already_listed"; row: Record<string, any> }
  | { kind: "created"; unit: CreatedListing };

/** The body of POST /api/available-units. Throws ZodError for a bad body
 *  (the route answers 400 as it always has). The caller has already
 *  checked the client's property scope; ctx.scope pins the landlord. */
export async function createListing(input: Record<string, any>, ctx: LettingCtx): Promise<CreateListingResult> {
  const db = q(ctx);
  const parsed = insertAvailableUnitSchema.parse(input);
  // Clients never set BGP's fee, and their deal's landlord is their company.
  if (ctx.scope) delete (parsed as any).fee;
  const landlordId: string | null = ctx.scope ? ctx.scope : (input.landlordId || null);
  const feePctRaw = ctx.scope ? null : input.feePercentage;
  const feePct = feePctRaw != null && feePctRaw !== "" ? parseFloat(String(feePctRaw)) : null;
  const feeAllocations: any[] | null = !ctx.scope && Array.isArray(input.feeAllocations) ? input.feeAllocations : null;

  // One live listing per unit (Woody, 2026-08-04 — "sort the double
  // counting"). Every add-to-tracker path funnels through here, and the
  // client-side "already listed" guards miss when names differ in format
  // ("MSU9" vs "MSU9, Bluewater, Bluewater"), so this is the guard: an
  // existing non-closed listing on the same property whose first name
  // segment matches is handed back instead of a duplicate.
  if (parsed.propertyId && parsed.unitName?.trim()) {
    const seg = parsed.unitName.split(",")[0].trim().toLowerCase();
    if (seg.length >= 2) {
      const dupe = await db.query(
        `SELECT * FROM available_units
         WHERE property_id = $1
           AND lower(trim(split_part(coalesce(unit_name, ''), ',', 1))) = $2
           AND lower(trim(coalesce(marketing_status, ''))) <> ALL($3::text[])
         LIMIT 1`,
        [parsed.propertyId, seg, statusSpellingsFor(TERMINAL_STATUSES)],
      );
      if (dupe.rows.length > 0) {
        // Heal a listing that never got its deal (imported / mirror-born)
        // before handing it back. Raw row shape (snake_case, plus the
        // deal's id and ref for ChatBGP); no dealCreated, so the Add Unit
        // form never PUTs its fee split over the one already on this deal.
        const { ensureBackingDealForUnit } = await import("./unit-mirror");
        const backing = await ensureBackingDealForUnit(db as Pool, dupe.rows[0].id).catch(() => null);
        if (backing?.created) {
          await logLettingService(db, { dealId: backing.dealId, trackerRowId: dupe.rows[0].id, created: [`crm_deals:${backing.dealId}`], adopted: [`available_units:${dupe.rows[0].id}`], healedDupe: true }, ctx);
        }
        return {
          kind: "already_listed",
          row: { ...dupe.rows[0], ...(backing ? { deal_id: backing.dealId, deal_ref: backing.dealRef } : {}), alreadyListed: true },
        };
      }
    }
  }

  const created: string[] = [];
  const adopted: string[] = [];

  // The property_units master row for this (property, unit name).
  let unitMasterId: string | null = (parsed as any).unitId || null;
  if (!unitMasterId && parsed.propertyId && parsed.unitName?.trim()) {
    const existing = await db.query(
      `SELECT id FROM property_units WHERE property_id = $1 AND lower(trim(unit_name)) = lower(trim($2))`,
      [parsed.propertyId, parsed.unitName],
    );
    if (existing.rows.length > 0) {
      unitMasterId = existing.rows[0].id;
      adopted.push(`property_units:${unitMasterId}`);
    } else {
      const ins = await db.query(
        `INSERT INTO property_units (property_id, unit_name, floor, sqft, use_class, condition, epc_rating)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [parsed.propertyId, parsed.unitName.trim(), parsed.floor || null, parsed.sqft ?? null,
         parsed.useClass || null, parsed.condition || null, parsed.epcRating || null],
      );
      unitMasterId = ins.rows[0].id;
      created.push(`property_units:${unitMasterId}`);
    }
  }

  const unit = await storage.createAvailableUnit({ ...parsed, unitId: unitMasterId || undefined } as any);
  created.push(`available_units:${unit.id}`);

  // The property's Leasing Schedule row — nothing else makes it on this path.
  const leasingId = await ensureLeasingRow(db, parsed.propertyId, parsed.unitName || "", parsed.sqft ?? null, parsed.askingRent ?? null, parsed.marketingStatus);
  if (leasingId) created.push(`leasing_schedule_units:${leasingId}`);

  // The tenancy spine (source of truth): create-or-link an editable row,
  // deduped by normalised unit name, so the unit is a normal row there and
  // not a read-only orphan.
  let tenancyUnitId: string | null = null;
  try {
    const before = await findSpineRowId(db, parsed.propertyId, parsed.unitName || "");
    const { ensureTenancyRowForAvailableUnit } = await import("./unit-mirror");
    await ensureTenancyRowForAvailableUnit(db as Pool, unit.id);
    const after = await db.query(`SELECT tenancy_unit_id FROM available_units WHERE id = $1`, [unit.id]);
    tenancyUnitId = after.rows[0]?.tenancy_unit_id ?? null;
    if (tenancyUnitId) (before ? adopted : created).push(`tenancy_schedule_units:${tenancyUnitId}`);
  } catch (e: any) {
    console.warn("[letting-service] tenancy-spine sync failed:", e?.message);
  }

  // Every tracker row has a backing deal from birth (Woody, 2026-10-26):
  // the Ref # and the fee allocations live on it. dealCreated tells the
  // form whether its fee split may go on too (an adopted deal keeps the
  // split it already has).
  const out = unit as CreatedListing;
  let backing: { dealId: string; dealRef: number | null; created: boolean } | null = null;
  try {
    const { ensureBackingDealForUnit } = await import("./unit-mirror");
    backing = await ensureBackingDealForUnit(db as Pool, unit.id, {
      dealType: input.dealType,
      landlordId,
      feePercentage: feePct != null && !Number.isNaN(feePct) ? feePct : null,
      fee: unit.fee ?? null,
    });
    if (backing) {
      out.dealId = backing.dealId; out.dealRef = backing.dealRef; out.dealCreated = backing.created;
      (backing.created ? created : adopted).push(`crm_deals:${backing.dealId}`);
    }
  } catch (e: any) {
    console.warn("[letting-service] backing deal failed:", e?.message);
  }
  // Landlord picked on the form (or the client's own company): stamp the
  // property when it has none so the next deal on it doesn't ask again.
  if (landlordId && unit.propertyId) {
    await db.query(`UPDATE crm_properties SET landlord_id = $1 WHERE id = $2 AND landlord_id IS NULL`, [landlordId, unit.propertyId])
      .catch((e: any) => console.warn("[letting-service] property landlord backfill failed:", e?.message));
  }
  // The fee split typed on the Add Unit form goes on the backing deal
  // through the deal page's own write path — on a deal this call made, or
  // an adopted one that has no split yet.
  if (backing && feeAllocations && feeAllocations.length) {
    try {
      const existing = backing.created ? [] : await storage.getDealFeeAllocations(backing.dealId);
      if (existing.length === 0) {
        const rows = await normaliseFeeAllocationInput(db, feeAllocations);
        const w = await writeDealFeeAllocations(backing.dealId, rows);
        if (!w.ok) out.feeAllocationsError = w.error;
      }
    } catch (e: any) {
      out.feeAllocationsError = e?.message || "fee split failed";
    }
  }

  if (backing) {
    await logLettingService(db, { dealId: backing.dealId, trackerRowId: unit.id, propertyUnitId: unitMasterId, tenancyUnitId, created, adopted }, ctx);
  } else {
    console.warn(`[letting-service] listing ${unit.id} created without a backing deal (historic status or a sibling row carries the unit's live deal); made: ${created.join(", ")}`);
  }
  return { kind: "created", unit: out };
}

// ── Deal factory (POST/PUT /api/crm/deals) ───────────────────────────────

const FEE_FIELDS_CLIENTS_NEVER_SET = { fee: null, feePercentage: null, feeNotes: null, feeAgreement: null, feeAgreementUrl: null, commission: null };

/** Stamp crm_deals.tenancy_unit_id from the (property, unit) pair: on
 *  create only when the deal has none; on update re-resolved whenever the
 *  pair moved (NULL when the unit went). A landlord-side deal only takes a
 *  spine row no other live landlord-side deal holds (the 0034
 *  one-live-landlord-deal-per-spine-row index is deal-type-agnostic); the
 *  skip is recorded on the audit row, not swallowed. Returns the id the
 *  deal now carries, or null. */
async function stampSpine(db: Queryable, dealId: string, audit: LettingAudit, mode: "create" | "update"): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT d.id, d.property_id, d.unit_id, d.tenancy_unit_id, d.bgp_acting_for, pu.unit_name
       FROM crm_deals d LEFT JOIN property_units pu ON pu.id = d.unit_id WHERE d.id = $1`, [dealId]);
  const d = rows[0];
  if (!d) return null;
  if (mode === "create" && d.tenancy_unit_id) { audit.tenancyUnitId = d.tenancy_unit_id; return d.tenancy_unit_id; }
  const clear = async () => {
    if (d.tenancy_unit_id) await db.query(`UPDATE crm_deals SET tenancy_unit_id = NULL WHERE id = $1`, [dealId]);
    audit.tenancyUnitId = null;
    return null;
  };
  if (!d.unit_id || !d.property_id) return clear();
  const spineId = await findSpineRowId(db, d.property_id, String(d.unit_name || ""));
  if (!spineId) return clear();
  if (d.tenancy_unit_id === spineId) { audit.tenancyUnitId = spineId; return spineId; }
  if (isLandlordSide(d.bgp_acting_for)) {
    const holder = await db.query(
      `SELECT id, deal_ref FROM crm_deals
        WHERE tenancy_unit_id = $1 AND id <> $2 AND coalesce(bgp_acting_for, 'landlord') = 'landlord'
          AND lower(trim(coalesce(status, ''))) NOT IN (${closedStatusSqlList()}) LIMIT 1`,
      [spineId, dealId]);
    if (holder.rows[0]) {
      audit.tenancyStampSkipped = { spineId, heldByDealId: holder.rows[0].id, heldByDealRef: holder.rows[0].deal_ref ?? null };
      console.warn(`[letting-service] deal ${dealId}: spine row ${spineId} already carries live landlord deal ${holder.rows[0].id}; tenancy_unit_id not stamped`);
      // The old unit's pointer must not survive the move: the deal now
      // carries no spine row rather than the one it left.
      return clear();
    }
  }
  await db.query(`UPDATE crm_deals SET tenancy_unit_id = $2 WHERE id = $1`, [dealId, spineId]);
  audit.tenancyUnitId = spineId;
  return spineId;
}

/** Normalise what every door sends: a tenancy token for the unit and a
 *  legacy status label. */
async function normaliseDealBody(db: Queryable, body: Record<string, any>, propertyIdFallback?: string | null): Promise<Record<string, any>> {
  const out: Record<string, any> = { ...body };
  if (out.unitId && typeof out.unitId === "string" && out.unitId.startsWith("__tenancy__")) {
    const resolved = await resolveTenancyTokenToUnitId(db, out.unitId, out.propertyId || propertyIdFallback);
    if (resolved) out.unitId = resolved; else delete out.unitId;
  }
  if (typeof out.status === "string") {
    const canonical = legacyToCode(out.status);
    if (canonical) out.status = canonical;
  }
  return out;
}

/** POST /api/crm/deals. Throws ZodError (400) or LettingRefusal (409). */
export async function createDeal(input: Record<string, any>, ctx: LettingCtx): Promise<CrmDeal> {
  const db = q(ctx);
  // A client creating a deal: pinned to their own company as landlord, and
  // every fee field stripped — clients make deals but never set BGP's fee.
  const body = await normaliseDealBody(db, ctx.scope ? { ...input, landlordId: ctx.scope, ...FEE_FIELDS_CLIENTS_NEVER_SET } : input);
  const parsed = insertCrmDealSchema.parse(body);
  // On an estate with schemes, the scheme decides who invoices go to: its
  // landlord entity and inbox fill whatever the deal left blank.
  if (!ctx.scope) Object.assign(parsed, await (await import("./property-schemes")).schemeDealDefaults(db, parsed));

  const letting = isLettingType(parsed.dealType);
  // No unplaced letting deals: a letting must have a property and a unit.
  if (letting && (!parsed.propertyId || !parsed.unitId)) throw new LettingRefusal("UNIT_REQUIRED", UNIT_REQUIRED_MESSAGE);

  const run = async (): Promise<CrmDeal> => {
    if (letting) {
      // The unit must exist on that property (a stale form can carry a
      // unit a colleague has since deleted).
      const pu = await db.query(`SELECT unit_name FROM property_units WHERE id = $1 AND property_id = $2`, [parsed.unitId, parsed.propertyId]);
      if (!pu.rows[0]) throw new LettingRefusal("UNIT_REQUIRED", UNIT_REQUIRED_MESSAGE);
      // One LIVE landlord-side letting per physical unit — the application
      // check is the primary guard (the index is Woody's call). A record
      // entered at a closed status (a past letting for comps / fee history)
      // is not live and sits beside the live one.
      if (isLandlordSide(parsed.bgpActingFor) && !isHistoricStatus(parsed.status)) {
        const clash = await findLiveLandlordLetting(db, {
          propertyId: parsed.propertyId!, unitId: parsed.unitId, unitName: pu.rows[0].unit_name ?? null, tenancyUnitId: parsed.tenancyUnitId ?? null,
        });
        if (clash) {
          throw new LettingRefusal("LIVE_LETTING_EXISTS", liveLettingMessage(clash.dealRef), { existingDealId: clash.id, existingDealRef: clash.dealRef, trackerRowId: clash.trackerRowId });
        }
      }
    }

    let deal: CrmDeal;
    if (ctx.client) {
      // Inside the caller's transaction (the WIP import): the same insert
      // storage.createCrmDeal does, on that connection.
      const [row] = await drizzle(ctx.client, { schema }).insert(schema.crmDeals).values(parsed as any).returning();
      deal = row;
    } else {
      deal = await storage.createCrmDeal(parsed);
    }

    const audit: LettingAudit = { dealId: deal.id, propertyUnitId: deal.unitId ?? null, tenancyUnitId: deal.tenancyUnitId ?? null, created: [`crm_deals:${deal.id}`], adopted: [] };
    let linkedSomething = false;
    if (deal.propertyId && deal.unitId) {
      const spine = await stampSpine(db, deal.id, audit, "create").catch((e: any) => { audit.tenancyStampError = e?.message; console.warn("[letting-service] tenancy_unit_id stamp failed:", e?.message); return null; });
      if (spine) { (deal as any).tenancyUnitId = spine; linkedSomething = true; }
      if (isTrackerDeal(deal)) {
        // The factory's audit row carries the tracker row too — one row per
        // create, no overlapping id lists.
        const row = await ensureTrackerRowForDeal(db, deal.id, ctx, audit);
        if (row.created || row.adopted || row.moved) linkedSomething = true;
      }
    }
    // One audit row for every letting, and for any other deal the factory
    // linked to a unit; a plain Sale / advisory create leaves no JSON row
    // (a backout only needs what the factory made or linked).
    if (letting || linkedSomething) await logLettingService(db, audit, ctx);
    return deal;
  };
  return letting ? withUnitLock(ctx, parsed.propertyId!, parsed.unitId!, run) : run();
}

/** PUT /api/crm/deals/:id — the write itself, the spine re-stamp when the
 *  (property, unit) pair moved, and the tracker row when the deal is a
 *  live letting with a unit. Gates, audit of field changes and the status
 *  mirrors stay with the route (Phase 3 makes them one writer). Never
 *  refuses an existing deal for lacking a unit. */
export async function updateDeal(id: string, patch: Record<string, any>, ctx: LettingCtx): Promise<CrmDeal> {
  const db = q(ctx);
  const before = await storage.getCrmDeal(id);
  const body = await normaliseDealBody(db, patch, before?.propertyId ?? null);
  const deal = await storage.updateCrmDeal(id, body as any);

  const audit: LettingAudit = { dealId: id, propertyUnitId: deal.unitId ?? null, tenancyUnitId: deal.tenancyUnitId ?? null, created: [], adopted: [] };
  let touched = false;
  if ("propertyId" in body || "unitId" in body) {
    touched = true;
    const spine = await stampSpine(db, id, audit, "update").catch((e: any) => { audit.tenancyStampError = e?.message; console.warn("[letting-service] tenancy_unit_id re-stamp failed:", e?.message); return null; });
    (deal as any).tenancyUnitId = spine;
  }
  if (deal.propertyId && deal.unitId && isTrackerDeal(deal)) {
    // A conflict (the unit's row carries another live letting) is the
    // integrity report's to list — not a new audit row on every save.
    const row = await ensureTrackerRowForDeal(db, id, ctx, audit);
    if (row.created || row.adopted || row.moved) touched = true;
  }
  if (touched) await logLettingService(db, audit, ctx);
  return deal;
}
