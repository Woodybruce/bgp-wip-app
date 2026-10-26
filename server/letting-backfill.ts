// Phase 2 backfills of the lettings cleanup (Woody, 2026-10-26; CLAUDE.md
// "Lettings: units, deals and the Letting Tracker"; appendix Phase 2):
//
//   POST /api/admin/letting-backfill/tracker-rows  { dryRun }
//     Every live letting deal (isTrackerDeal) with no tracker row — the
//     integrity report's section (b) — classified as would link (a row for
//     that property + unit exists with no deal), would create (property +
//     unit present) or needs a unit (no property, no unit — listed, never
//     auto-placed: "Refuse, we need each one to have an actual address").
//     Apply calls ensureTrackerRowForDeal for the first two groups only.
//
//   POST /api/admin/letting-backfill/stub-pairs    { dryRun }
//     The report's section (e): a £0 Marketing stub beside a real live
//     letting deal on one unit. Apply re-points the stub's tracker row at
//     the real deal (deal_id + its status code) and withdraws the stub
//     through the deal PUT route's own status write (gate, audit row,
//     mirrors) — never a raw UPDATE.
//
// Nothing here runs at boot. A dry run is recorded (counts AND the ids it
// showed) under letting_backfill_dry_run:<job>; Apply refuses without one
// in the last hour, re-runs the preview against live data, touches only
// the ids that preview showed (the rest are listed as notPreviewed), and
// appends a run record (ids, created / adopted lists, failures) to the
// job's system_settings key so a backout can walk exactly what it did. Every row the factory
// makes or links also carries its own deal_audit_log row (letting-service).
import type { Pool } from "pg";
import { legacyToCode } from "@shared/deal-status";
import { ALL_LETTING_TYPES, DEFAULT_LETTING_TYPE, isHistoricStatus, isLettingType, isTrackerLiveStatus } from "@shared/letting-rules";
import { ensureTrackerRowForDeal, logLettingService, updateDeal, unitNameSegment, type LettingCtx } from "./letting-service";

export type BackfillJob = "tracker-rows" | "stub-pairs";

export const TRACKER_ROWS_KEY = "tracker_rows_for_letting_deals_v1";
export const STUB_PAIRS_KEY = "stub_pairs_resolved_v1";
const DRY_RUN_TTL_MS = 60 * 60_000;
const dryRunKey = (job: BackfillJob) => `letting_backfill_dry_run:${job}`;

const isLandlordSide = (actingFor: string | null | undefined) => (actingFor || "landlord") === "landlord";

async function readSetting<T = any>(pool: Pool, key: string): Promise<T | null> {
  const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
  return (r.rows[0]?.value as T) ?? null;
}
async function writeSetting(pool: Pool, key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}
/** The job's record is an array of runs; a run is appended, never replaced. */
async function appendRun(pool: Pool, key: string, run: unknown): Promise<void> {
  const prior = await readSetting<unknown>(pool, key);
  const runs = Array.isArray(prior) ? prior : prior ? [prior] : [];
  await writeSetting(pool, key, [...runs, run]);
}

/** The dry run records the ids it showed, not just counts: Apply resolves
 *  only what was previewed. */
async function recordDryRun(pool: Pool, job: BackfillJob, counts: Record<string, number>, ids: string[]): Promise<string> {
  const at = new Date().toISOString();
  await writeSetting(pool, dryRunKey(job), { at, counts, ids });
  return at;
}
/** Apply only within an hour of a recorded dry run — nobody applies blind.
 *  Returns the ids that preview showed. */
async function requireRecentDryRun(pool: Pool, job: BackfillJob): Promise<Set<string>> {
  const dry = await readSetting<{ at?: string; ids?: string[] }>(pool, dryRunKey(job));
  if (!dry?.at || Date.now() - new Date(dry.at).getTime() > DRY_RUN_TTL_MS) {
    const err: any = new Error("Preview first — Apply only runs within an hour of a preview.");
    err.status = 409;
    throw err;
  }
  return new Set(Array.isArray(dry.ids) ? dry.ids : []);
}

async function actorName(pool: Pool, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = await pool.query(`SELECT name, email, username FROM users WHERE id = $1 LIMIT 1`, [userId]);
  const u = r.rows[0];
  return u ? (u.name || u.email || u.username || null) : null;
}

// ── (a) tracker rows for live letting deals ──────────────────────────────

type OffTrackerDeal = {
  id: string; dealRef: number | null; name: string; dealType: string | null; status: string | null; statusCode: string | null;
  bgpActingFor: string | null; fee: number | null; propertyId: string | null; propertyName: string | null;
  unitId: string | null; unitName: string | null; tenancyUnitId: string | null; createdAt: string | null;
};
type WouldLink = OffTrackerDeal & { trackerRowId: string; rowStatus: string | null; how: string; previousDealId: string | null; previousDealRef: number | null };
type NeedsUnit = OffTrackerDeal & { missing: "property" | "unit" | "unit row" };
type Blocked = OffTrackerDeal & { blockedBy: { dealId: string; dealRef: number | null; trackerRowId: string } };

export type TrackerRowsPreview = {
  dryRun: true; job: "tracker-rows"; previewedAt: string;
  counts: { total: number; wouldLink: number; wouldCreate: number; needsUnit: number; blocked: number };
  lists: { wouldLink: WouldLink[]; wouldCreate: OffTrackerDeal[]; needsUnit: NeedsUnit[]; blocked: Blocked[] };
};

async function offTrackerLiveLettingDeals(pool: Pool): Promise<OffTrackerDeal[]> {
  // Same population as the integrity report's section (b).
  const { rows } = await pool.query(
    `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.bgp_acting_for, d.fee, d.property_id, p.name AS property_name,
            d.unit_id, pu.unit_name, d.tenancy_unit_id, d.created_at
       FROM crm_deals d
       LEFT JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN property_units pu ON pu.id = d.unit_id AND pu.property_id = d.property_id
      WHERE d.deal_type = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM available_units au WHERE au.deal_id = d.id)
      ORDER BY p.name NULLS LAST, pu.unit_name NULLS LAST, d.created_at`, [ALL_LETTING_TYPES]);
  return rows
    .filter((r: any) => isTrackerLiveStatus(r.status))
    .map((r: any) => ({
      id: r.id, dealRef: r.deal_ref ?? null, name: r.name, dealType: r.deal_type, status: r.status, statusCode: legacyToCode(r.status),
      bgpActingFor: r.bgp_acting_for, fee: r.fee ?? null, propertyId: r.property_id, propertyName: r.property_name,
      unitId: r.unit_id, unitName: r.unit_name ? String(r.unit_name).trim() : null, tenancyUnitId: r.tenancy_unit_id,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
}

/** What ensureTrackerRowForDeal (letting-service.ts) will do for this
 *  deal, read-only: the same candidate query and the same free /
 *  non-letting / historic / live buckets, so the preview is the apply. */
async function classifyTrackerRow(pool: Pool, d: OffTrackerDeal): Promise<{ kind: "link"; row: WouldLink } | { kind: "create" } | { kind: "blocked"; row: Blocked }> {
  const seg = unitNameSegment(d.unitName);
  const { rows: candidates } = await pool.query(
    `SELECT au.id, au.deal_id, au.marketing_status,
            x.id AS x_id, x.status AS x_status, x.deal_type AS x_type, x.bgp_acting_for AS x_side, x.deal_ref AS x_ref
       FROM available_units au
       LEFT JOIN crm_deals x ON x.id = au.deal_id
      WHERE au.property_id = $1
        AND (au.unit_id = $2
          OR ($3::varchar IS NOT NULL AND au.tenancy_unit_id = $3)
          OR ($4 <> '' AND lower(trim(split_part(coalesce(au.unit_name, ''), ',', 1))) = $4))
      ORDER BY au.created_at`,
    [d.propertyId, d.unitId, d.tenancyUnitId || null, seg]);
  type Cand = (typeof candidates)[number];
  const free: Cand[] = [], freeHistoric: Cand[] = [], linkedNonLetting: Cand[] = [], linkedHistoric: Cand[] = [], linkedLive: Cand[] = [];
  for (const c of candidates) {
    if (!c.x_id) (isHistoricStatus(c.marketing_status) ? freeHistoric : free).push(c);
    else if (c.x_type != null && !isLettingType(c.x_type)) linkedNonLetting.push(c);
    else if (isHistoricStatus(c.x_status)) linkedHistoric.push(c);
    else linkedLive.push(c);
  }
  const blocker = linkedLive.find((c) => isLandlordSide(c.x_side) === isLandlordSide(d.bgpActingFor));
  if (blocker) return { kind: "blocked", row: { ...d, blockedBy: { dealId: blocker.x_id, dealRef: blocker.x_ref ?? null, trackerRowId: blocker.id } } };
  const pick = (c: Cand | undefined, how: string) => c ? { c, how } : null;
  const adopt =
    pick(free[0], "free row") ||
    pick(linkedNonLetting[0], "row carried a non-letting deal") ||
    pick(freeHistoric[0], "fresh cycle (row at a closed status, no deal)") ||
    pick(linkedHistoric[0], "fresh cycle (row's letting is closed)");
  if (adopt) {
    return { kind: "link", row: { ...d, trackerRowId: adopt.c.id, rowStatus: adopt.c.marketing_status, how: adopt.how, previousDealId: adopt.c.x_id || null, previousDealRef: adopt.c.x_ref ?? null } };
  }
  return { kind: "create" };
}

export async function previewTrackerRows(pool: Pool): Promise<TrackerRowsPreview> {
  const deals = await offTrackerLiveLettingDeals(pool);
  const lists: TrackerRowsPreview["lists"] = { wouldLink: [], wouldCreate: [], needsUnit: [], blocked: [] };
  for (const d of deals) {
    // No unplaced letting deals: property + unit (a property_units row that
    // still exists) or it is listed for a person to place.
    if (!d.propertyId) { lists.needsUnit.push({ ...d, missing: "property" }); continue; }
    if (!d.unitId) { lists.needsUnit.push({ ...d, missing: "unit" }); continue; }
    if (!d.unitName) { lists.needsUnit.push({ ...d, missing: "unit row" }); continue; }
    const c = await classifyTrackerRow(pool, d);
    if (c.kind === "link") lists.wouldLink.push(c.row);
    else if (c.kind === "blocked") lists.blocked.push(c.row);
    else lists.wouldCreate.push(d);
  }
  const counts = { total: deals.length, wouldLink: lists.wouldLink.length, wouldCreate: lists.wouldCreate.length, needsUnit: lists.needsUnit.length, blocked: lists.blocked.length };
  return { dryRun: true, job: "tracker-rows", previewedAt: new Date().toISOString(), counts, lists };
}

export async function runTrackerRowsBackfill(pool: Pool, opts: { dryRun: boolean; by: string | null }) {
  if (opts.dryRun) {
    const preview = await previewTrackerRows(pool);
    await recordDryRun(pool, "tracker-rows", preview.counts, [...preview.lists.wouldLink, ...preview.lists.wouldCreate].map((d) => d.id));
    return preview;
  }
  const previewed = await requireRecentDryRun(pool, "tracker-rows");
  const preview = await previewTrackerRows(pool);
  const ctx: LettingCtx = { userId: opts.by, source: "backfill" };
  const rows: Array<{ dealId: string; dealRef: number | null; name: string; trackerRowId: string | null; created: boolean; adopted: boolean; conflict?: any }> = [];
  const failed: Array<{ dealId: string; dealRef: number | null; error: string }> = [];
  const notPreviewed: string[] = [];
  for (const d of [...preview.lists.wouldLink, ...preview.lists.wouldCreate]) {
    // Only what the preview showed: a deal that joined the list since is
    // left for the next preview.
    if (!previewed.has(d.id)) { notPreviewed.push(d.id); continue; }
    try {
      const r = await ensureTrackerRowForDeal(pool, d.id, ctx);
      rows.push({ dealId: d.id, dealRef: d.dealRef, name: d.name, trackerRowId: r.trackerRowId, created: r.created, adopted: r.adopted, ...(r.conflict ? { conflict: r.conflict } : {}) });
    } catch (e: any) {
      failed.push({ dealId: d.id, dealRef: d.dealRef, error: e?.message || String(e) });
    }
  }
  const run = {
    job: "tracker-rows" as const,
    appliedAt: new Date().toISOString(),
    by: opts.by,
    byName: await actorName(pool, opts.by),
    dealIds: rows.map((r) => r.dealId),
    trackerRowIds: rows.map((r) => r.trackerRowId).filter((id): id is string => !!id),
    created: rows.filter((r) => r.created).map((r) => r.trackerRowId as string),
    adopted: rows.filter((r) => r.adopted).map((r) => r.trackerRowId as string),
    rows,
    failed,
    skipped: { needsUnit: preview.lists.needsUnit.map((d) => d.id), blocked: preview.lists.blocked.map((d) => d.id), notPreviewed },
    previewCounts: preview.counts,
  };
  await appendRun(pool, TRACKER_ROWS_KEY, run);
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [dryRunKey("tracker-rows")]);
  return { dryRun: false as const, ...run };
}

// ── (b) stub + real pairs ────────────────────────────────────────────────

type PairDeal = {
  id: string; dealRef: number | null; name: string; dealType: string | null; status: string | null; statusCode: string | null;
  fee: number | null; unitId: string | null; tenancyUnitId: string | null; trackerRowId: string | null; trackerTenancyUnitId: string | null; createdAt: string | null;
  /** Signs a person has worked on the deal (the sweep-undo's test): a
   *  stub with any of these is decided by hand, never withdrawn here. */
  touched: string[];
};
const TOUCHED_AFTER_MS = 5 * 60_000;
export type StubPair = {
  propertyId: string; propertyName: string | null; unitName: string;
  stubs: PairDeal[]; real: PairDeal[];
  action: "resolve" | "skip"; reason: string | null;
  /** The stub's tracker row the real deal is adopted onto (null: no stub
   *  had a row — the factory makes or adopts one after the withdrawal). */
  trackerRowId: string | null;
};
export type StubPairsPreview = {
  dryRun: true; job: "stub-pairs"; previewedAt: string;
  counts: { total: number; resolve: number; skip: number };
  lists: { resolve: StubPair[]; skip: StubPair[] };
};

export async function previewStubPairs(pool: Pool): Promise<StubPairsPreview> {
  // Same grouping as the integrity report's section (e): live letting deals
  // by (property, unit name), the name from property_units via unit_id or
  // from the tracker row pointing at the deal; a stub is AVA with no fee.
  // An untyped deal reads as New Letting, as every door reads it.
  const { rows } = await pool.query(
    `SELECT d.id, d.deal_ref, d.name, d.deal_type, d.status, d.fee, d.property_id, p.name AS property_name, d.unit_id, d.tenancy_unit_id, d.created_at,
            d.updated_at, d.tenant_id, d.comments,
            coalesce(pu.unit_name, au.unit_name) AS unit_name,
            au.id AS tracker_row_id, au.tenancy_unit_id AS tracker_tenancy_unit_id,
            (SELECT count(*)::int FROM deal_fee_allocations f WHERE f.deal_id = d.id) AS fee_allocs,
            (SELECT count(*)::int FROM deal_hots h WHERE h.deal_id = d.id) AS hots,
            (SELECT count(*)::int FROM deal_audit_log a WHERE a.deal_id = d.id AND a.changed_by IS NOT NULL AND a.field <> 'letting_service') AS manual_audits
       FROM crm_deals d
       LEFT JOIN property_units pu ON pu.id = d.unit_id
       LEFT JOIN LATERAL (SELECT a.id, a.unit_name, a.tenancy_unit_id FROM available_units a WHERE a.deal_id = d.id ORDER BY a.created_at LIMIT 1) au ON true
       LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE coalesce(d.deal_type, $2) = ANY($1::text[]) AND d.property_id IS NOT NULL
      ORDER BY d.created_at`, [ALL_LETTING_TYPES, DEFAULT_LETTING_TYPE]);
  const groups = new Map<string, { propertyId: string; propertyName: string | null; unitName: string; deals: PairDeal[] }>();
  for (const r of rows) {
    const unitName = String(r.unit_name || "").trim();
    if (!isTrackerLiveStatus(r.status) || !unitName) continue;
    // The same unit identity as the factory: first comma segment.
    const key = `${r.property_id}::${unitNameSegment(unitName) || unitName.toLowerCase()}`;
    const g = groups.get(key) || { propertyId: r.property_id, propertyName: r.property_name, unitName, deals: [] as PairDeal[] };
    const touched: string[] = [];
    if (r.fee_allocs > 0) touched.push("fee split entered");
    if (r.hots > 0) touched.push("HOTs document");
    if (r.manual_audits > 0) touched.push("edited by a person");
    if (r.tenant_id) touched.push("tenant set");
    if (r.comments) touched.push("comments added");
    if (r.updated_at && r.created_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > TOUCHED_AFTER_MS) touched.push("updated after creation");
    g.deals.push({
      id: r.id, dealRef: r.deal_ref ?? null, name: r.name, dealType: r.deal_type, status: r.status, statusCode: legacyToCode(r.status),
      fee: r.fee ?? null, unitId: r.unit_id, tenancyUnitId: r.tenancy_unit_id, trackerRowId: r.tracker_row_id, trackerTenancyUnitId: r.tracker_tenancy_unit_id,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, touched,
    });
    groups.set(key, g);
  }
  const lists: StubPairsPreview["lists"] = { resolve: [], skip: [] };
  for (const g of groups.values()) {
    const stubs = g.deals.filter((x) => x.statusCode === "AVA" && !(Number(x.fee) > 0));
    const real = g.deals.filter((x) => !stubs.includes(x));
    if (!stubs.length || !real.length) continue;
    const base = { propertyId: g.propertyId, propertyName: g.propertyName, unitName: g.unitName, stubs, real };
    let reason: string | null = null;
    // A Marketing deal legitimately has no fee yet (Woody: "fee needed",
    // not "not WIP"): one a person has worked on is a real deal, not a stub.
    const worked = stubs.filter((x) => x.touched.length);
    if (worked.length) reason = `stub has been worked on (${worked.map((x) => `#${x.dealRef ?? "?"}: ${x.touched.join(", ")}`).join("; ")}) — decide by hand`;
    else if (real.length > 1) reason = `${real.length} live deals beside the stub — pick the letting by hand`;
    else if (real[0].trackerRowId) reason = "the live deal already has its own tracker row — merge the two rows by hand";
    if (reason) { lists.skip.push({ ...base, action: "skip", reason, trackerRowId: null }); continue; }
    const rowStub = stubs.find((s) => s.trackerRowId);
    lists.resolve.push({ ...base, action: "resolve", reason: null, trackerRowId: rowStub?.trackerRowId ?? null });
  }
  const counts = { total: lists.resolve.length + lists.skip.length, resolve: lists.resolve.length, skip: lists.skip.length };
  return { dryRun: true, job: "stub-pairs", previewedAt: new Date().toISOString(), counts, lists };
}

/** The deal PUT route's status write for a stub going to WIT: the
 *  transition gate (deal-gates), the field audit row the route writes,
 *  the factory's updateDeal, then the three-way status mirror. The stub's
 *  tracker row has already been re-pointed, so the mirror finds no row and
 *  touches nothing else. */
async function withdrawStub(pool: Pool, stub: PairDeal, realRef: number | null, by: string | null, byName: string | null): Promise<void> {
  const { dealStatusTransitionDenial } = await import("./deal-gates");
  const denial = await dealStatusTransitionDenial(by, stub.id, "WIT");
  if (denial) throw new Error(denial.error);
  const reason = `${STUB_PAIRS_KEY}: £0 Marketing stub beside #${realRef ?? "?"}; tracker row re-pointed at the real deal`;
  await pool.query(
    `INSERT INTO deal_audit_log (deal_id, field, old_value, new_value, reason, changed_by, changed_by_name)
     VALUES ($1, 'status', $2, 'WIT', $3, $4, $5)`,
    [stub.id, stub.status ?? null, reason, by, byName]);
  await updateDeal(stub.id, { status: "WIT" }, { userId: by, source: "backfill" });
  const { mirrorFromDeal } = await import("./lease-status-mirror");
  await mirrorFromDeal(stub.id, "WIT", { pool, reason: STUB_PAIRS_KEY, actorUserId: by });
}

export async function runStubPairsBackfill(pool: Pool, opts: { dryRun: boolean; by: string | null }) {
  if (opts.dryRun) {
    const preview = await previewStubPairs(pool);
    await recordDryRun(pool, "stub-pairs", preview.counts, preview.lists.resolve.flatMap((p) => p.stubs.map((x) => x.id)));
    return preview;
  }
  const previewed = await requireRecentDryRun(pool, "stub-pairs");
  const preview = await previewStubPairs(pool);
  const byName = await actorName(pool, opts.by);
  const ctx: LettingCtx = { userId: opts.by, source: "backfill" };
  const pairs: Array<{ propertyId: string; propertyName: string | null; unitName: string; realDealId: string; realDealRef: number | null; trackerRowId: string | null; adoptedFromDealId: string | null; stubDealIds: string[]; stubDealRefs: Array<number | null>; trackerRowCreated: boolean; warnings: string[] }> = [];
  const failed: Array<{ unitName: string; propertyName: string | null; realDealId: string; error: string }> = [];
  const notPreviewed: Array<{ propertyId: string; unitName: string; dealIds: string[] }> = [];
  for (const p of preview.lists.resolve) {
    // Only pairs whose stubs the preview showed: one that appeared since
    // is left for the next preview.
    if (!p.stubs.every((x) => previewed.has(x.id))) { notPreviewed.push({ propertyId: p.propertyId, unitName: p.unitName, dealIds: p.stubs.map((x) => x.id) }); continue; }
    const real = p.real[0];
    const code = real.statusCode;
    const warnings: string[] = [];
    try {
      let trackerRowId: string | null = p.trackerRowId;
      let adoptedFromDealId: string | null = null;
      let trackerRowCreated = false;
      if (trackerRowId) {
        // Adopt: the row IS the real deal now. Guarded on the stub still
        // being the row's deal so a row someone re-pointed meanwhile is left.
        const stub = p.stubs.find((s) => s.trackerRowId === trackerRowId)!;
        const upd = await pool.query(
          `UPDATE available_units SET deal_id = $1, marketing_status = COALESCE($2, marketing_status), updated_at = NOW()
            WHERE id = $3 AND deal_id = $4`,
          [real.id, code, trackerRowId, stub.id]);
        if (!upd.rowCount) throw new Error(`tracker row ${trackerRowId} no longer carries stub #${stub.dealRef ?? "?"}`);
        adoptedFromDealId = stub.id;
        await logLettingService(pool, {
          dealId: real.id, trackerRowId, propertyUnitId: real.unitId, tenancyUnitId: stub.trackerTenancyUnitId || real.tenancyUnitId || null,
          created: [], adopted: [`available_units:${trackerRowId}`], previousDealId: stub.id, stubPair: true,
        }, ctx);
      }
      for (const stub of p.stubs) {
        await withdrawStub(pool, stub, real.dealRef, opts.by, byName);
      }
      if (!trackerRowId) {
        // No stub had a row: the factory gives the real deal one now that
        // the stub no longer counts as the unit's live letting.
        const r = await ensureTrackerRowForDeal(pool, real.id, ctx);
        trackerRowId = r.trackerRowId;
        trackerRowCreated = r.created;
        if (r.conflict) warnings.push(`no tracker row: unit already carries #${r.conflict.dealRef ?? "?"} on row ${r.conflict.trackerRowId}`);
      }
      // The leasing / tenancy rows follow the real deal's code, as they do
      // after any deal-page status change (best-effort, like the route).
      if (trackerRowId && real.status) {
        try {
          const { mirrorFromDeal } = await import("./lease-status-mirror");
          await mirrorFromDeal(real.id, real.status, { pool, reason: STUB_PAIRS_KEY, actorUserId: opts.by });
        } catch (e: any) {
          warnings.push(`status mirror failed: ${e?.message || e}`);
        }
      }
      pairs.push({
        propertyId: p.propertyId, propertyName: p.propertyName, unitName: p.unitName, realDealId: real.id, realDealRef: real.dealRef,
        trackerRowId, adoptedFromDealId, stubDealIds: p.stubs.map((s) => s.id), stubDealRefs: p.stubs.map((s) => s.dealRef), trackerRowCreated, warnings,
      });
    } catch (e: any) {
      failed.push({ unitName: p.unitName, propertyName: p.propertyName, realDealId: real.id, error: e?.message || String(e) });
    }
  }
  const run = {
    job: "stub-pairs" as const,
    appliedAt: new Date().toISOString(),
    by: opts.by,
    byName,
    dealIds: pairs.flatMap((p) => p.stubDealIds),
    realDealIds: pairs.map((p) => p.realDealId),
    trackerRowIds: pairs.map((p) => p.trackerRowId).filter((id): id is string => !!id),
    created: pairs.filter((p) => p.trackerRowCreated).map((p) => p.trackerRowId as string),
    adopted: pairs.filter((p) => p.adoptedFromDealId).map((p) => p.trackerRowId as string),
    pairs,
    failed,
    skipped: preview.lists.skip.map((p) => ({ propertyId: p.propertyId, unitName: p.unitName, reason: p.reason, dealIds: [...p.stubs, ...p.real].map((d) => d.id) })),
    notPreviewed,
    previewCounts: preview.counts,
  };
  await appendRun(pool, STUB_PAIRS_KEY, run);
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [dryRunKey("stub-pairs")]);
  return { dryRun: false as const, ...run };
}
