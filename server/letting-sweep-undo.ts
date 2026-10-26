// Undo of the 2026-10-26 boot sweep that gave every Letting Tracker row a
// backing deal. Its adoption matched an existing deal only by unit id or the
// exact "Property – Unit" name, so on units that already carried deals made
// on the deal form ("Tenant – Property", no unit id) it minted a THIRD,
// empty Marketing deal (Carly, 2026-10-26: "there are now 3 deals for the
// ones which were duplicates"). The sweep no longer runs at boot.
//
//   POST /api/admin/letting-sweep-undo  { dryRun: boolean, scope: "duplicates" | "all" }
//
// Preview lists every deal with the sweep's signature (Marketing, New
// Letting, named "Property – Unit", pointed at by a tracker row, created on
// or after 26 Oct in a cluster the size only a sweep makes), the other
// letting deals on the same unit, and what Apply would do: delete the stub
// and re-link the tracker row to the one other live letting deal when there
// is exactly one, otherwise leave the row with no deal for the team to
// decide. Stubs anyone has touched since (fee split, HOTs, a manual edit, a
// tenant) are listed and kept. Apply refuses without a preview in the last
// hour and records every id it touched in system_settings.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { storage } from "./storage";
import { legacyToCode } from "@shared/deal-status";
import { ALL_LETTING_TYPES, DEFAULT_LETTING_TYPE, isHistoricStatus } from "@shared/letting-rules";

const SWEEP_KEY = "unit_backing_deals_2026_10_26";
const UNDO_KEY = "unit_backing_deals_undo_2026_10_26";
const DRY_RUN_KEY = "letting_sweep_undo_dry_run";
const SWEEP_START = "2026-10-26T00:00:00Z";
const CLUSTER_MS = 2 * 60_000;      // stubs minted within the same two minutes
const CLUSTER_MIN = 3;              // a person adds one unit at a time; a sweep makes many
const FIRST_RUN_WINDOW_MS = 30 * 60_000;
const TOUCHED_AFTER_MS = 5 * 60_000;
const DRY_RUN_TTL_MS = 60 * 60_000;

type Scope = "duplicates" | "all";
type OtherDeal = { id: string; dealRef: number | null; name: string; status: string | null; statusCode: string | null; dealType: string | null; live: boolean; linkedRowId: string | null; matchedBy: string };
type Candidate = {
  dealId: string; dealRef: number | null; name: string; status: string | null; fee: number | null; createdAt: string;
  trackerRowId: string; unitName: string | null; propertyId: string | null; propertyName: string | null;
  cluster: string; clusterSize: number; firstRun: boolean; inSweep: boolean;
  touched: string[]; otherDeals: OtherDeal[];
  action: "relink" | "unlink" | "keep-touched" | "keep-not-sweep" | "keep-out-of-scope";
  relinkTo: { id: string; dealRef: number | null; name: string } | null;
};

async function readSetting<T = any>(key: string): Promise<T | null> {
  const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
  return (r.rows[0]?.value as T) ?? null;
}
async function writeSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}

export async function previewSweepUndo(scope: Scope): Promise<{ sweep: any; clusters: Array<{ bucket: string; count: number }>; candidates: Candidate[]; summary: Record<string, number> }> {
  const sweep = await readSetting<{ at?: string; created?: number; linked?: number }>(SWEEP_KEY);
  const firstRunEnd = sweep?.at ? new Date(sweep.at).getTime() : null;

  const { rows } = await pool.query(
    `SELECT d.id, d.deal_ref, d.name, d.status, d.fee, d.created_at, d.updated_at, d.property_id, d.tenant_id, d.comments,
            p.name AS property_name,
            au.id AS tracker_row_id, au.unit_name, au.unit_id AS au_unit_id, au.tenancy_unit_id AS au_tenancy_unit_id,
            COALESCE(pu.unit_name, au.unit_name) AS master_name,
            (SELECT count(*)::int FROM deal_fee_allocations f WHERE f.deal_id = d.id) AS fee_allocs,
            (SELECT count(*)::int FROM deal_hots h WHERE h.deal_id = d.id) AS hots,
            (SELECT count(*)::int FROM deal_audit_log a WHERE a.deal_id = d.id AND a.changed_by IS NOT NULL) AS manual_audits
       FROM crm_deals d
       JOIN available_units au ON au.deal_id = d.id
       LEFT JOIN property_units pu ON pu.id = au.unit_id
       LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE d.created_at >= $1::timestamptz
        AND lower(trim(coalesce(d.status, ''))) IN ('ava', 'available', 'marketing')
        AND coalesce(d.deal_type, $2) = $2
        AND d.name = CASE WHEN p.name IS NOT NULL THEN p.name || ' – ' || COALESCE(pu.unit_name, au.unit_name, 'Unit')
                          ELSE COALESCE(pu.unit_name, au.unit_name, 'Unit') END
      ORDER BY d.created_at`,
    [SWEEP_START, DEFAULT_LETTING_TYPE]);

  // Cluster by creation time: a sweep mints many stubs inside a minute or
  // two; a person on the Add Unit form makes one.
  const bucketOf = (iso: string) => new Date(Math.floor(new Date(iso).getTime() / CLUSTER_MS) * CLUSTER_MS).toISOString();
  const clusterCount: Record<string, number> = {};
  for (const r of rows) { const b = bucketOf(r.created_at); clusterCount[b] = (clusterCount[b] || 0) + 1; }

  const candidates: Candidate[] = [];
  for (const r of rows) {
    const createdMs = new Date(r.created_at).getTime();
    const cluster = bucketOf(r.created_at);
    const clusterSize = clusterCount[cluster];
    const firstRun = firstRunEnd != null && createdMs <= firstRunEnd + 60_000 && createdMs >= firstRunEnd - FIRST_RUN_WINDOW_MS;
    const inSweep = firstRun || clusterSize >= CLUSTER_MIN;
    const touched: string[] = [];
    if (r.fee_allocs > 0) touched.push("fee split entered");
    if (r.hots > 0) touched.push("HOTs document");
    if (r.manual_audits > 0) touched.push("edited by a person");
    if (r.tenant_id) touched.push("tenant set");
    if (r.comments) touched.push("comments added");
    if (new Date(r.updated_at).getTime() - createdMs > TOUCHED_AFTER_MS) touched.push("updated after creation");

    // The other landlord-side letting deals on this unit (the ones the sweep
    // failed to adopt): by unit id, by spine row, by the unit label inside
    // the deal name, or carried by another tracker row of the same name.
    const label = String(r.master_name || r.unit_name || "").trim();
    const others = await pool.query(
      `SELECT d2.id, d2.deal_ref, d2.name, d2.status, d2.deal_type,
              (SELECT a2.id FROM available_units a2 WHERE a2.deal_id = d2.id LIMIT 1) AS linked_row_id,
              CASE WHEN $3::varchar IS NOT NULL AND d2.unit_id = $3 THEN 'unit id'
                   WHEN $4::varchar IS NOT NULL AND d2.tenancy_unit_id = $4 THEN 'tenancy row'
                   WHEN EXISTS (SELECT 1 FROM available_units a3 WHERE a3.deal_id = d2.id AND a3.property_id = d2.property_id
                                  AND lower(trim(a3.unit_name)) = lower(trim($5))) THEN 'another tracker row of this name'
                   ELSE 'unit name in deal name' END AS matched_by
         FROM crm_deals d2
        WHERE d2.property_id = $1 AND d2.id <> $2
          AND coalesce(d2.bgp_acting_for, 'landlord') = 'landlord'
          AND (d2.deal_type IS NULL OR d2.deal_type = ANY($6::text[]))
          AND (($3::varchar IS NOT NULL AND d2.unit_id = $3)
            OR ($4::varchar IS NOT NULL AND d2.tenancy_unit_id = $4)
            OR ($5 <> '' AND lower(d2.name) LIKE '%' || lower($5) || '%')
            OR EXISTS (SELECT 1 FROM available_units a3 WHERE a3.deal_id = d2.id AND a3.property_id = d2.property_id
                         AND $5 <> '' AND lower(trim(a3.unit_name)) = lower(trim($5))))
        ORDER BY d2.created_at DESC NULLS LAST`,
      [r.property_id, r.id, r.au_unit_id, r.au_tenancy_unit_id, label, ALL_LETTING_TYPES]);
    const otherDeals: OtherDeal[] = others.rows.map((o: any) => ({
      id: o.id, dealRef: o.deal_ref, name: o.name, status: o.status, statusCode: legacyToCode(o.status), dealType: o.deal_type,
      live: !isHistoricStatus(o.status), linkedRowId: o.linked_row_id, matchedBy: o.matched_by,
    }));
    const liveOthers = otherDeals.filter((o) => o.live && (!o.linkedRowId || o.linkedRowId === r.tracker_row_id));
    const isDuplicate = otherDeals.some((o) => o.live);

    let action: Candidate["action"];
    let relinkTo: Candidate["relinkTo"] = null;
    if (!inSweep) action = "keep-not-sweep";
    else if (touched.length) action = "keep-touched";
    else if (scope === "duplicates" && !isDuplicate) action = "keep-out-of-scope";
    else if (liveOthers.length === 1) { action = "relink"; relinkTo = { id: liveOthers[0].id, dealRef: liveOthers[0].dealRef, name: liveOthers[0].name }; }
    else action = "unlink";

    candidates.push({
      dealId: r.id, dealRef: r.deal_ref, name: r.name, status: r.status, fee: r.fee, createdAt: new Date(r.created_at).toISOString(),
      trackerRowId: r.tracker_row_id, unitName: r.unit_name, propertyId: r.property_id, propertyName: r.property_name,
      cluster, clusterSize, firstRun, inSweep, touched, otherDeals, action, relinkTo,
    });
  }

  const summary: Record<string, number> = { matchedSignature: candidates.length, inSweep: 0, duplicates: 0, relink: 0, unlink: 0, keptTouched: 0, keptNotSweep: 0, keptOutOfScope: 0 };
  for (const c of candidates) {
    if (c.inSweep) summary.inSweep++;
    if (c.otherDeals.some((o) => o.live)) summary.duplicates++;
    if (c.action === "relink") summary.relink++;
    else if (c.action === "unlink") summary.unlink++;
    else if (c.action === "keep-touched") summary.keptTouched++;
    else if (c.action === "keep-not-sweep") summary.keptNotSweep++;
    else summary.keptOutOfScope++;
  }
  const clusters = Object.entries(clusterCount).sort().map(([bucket, count]) => ({ bucket, count }));
  return { sweep, clusters, candidates, summary };
}

export async function applySweepUndo(scope: Scope, by: string | null, opts: { skipPreviewCheck?: boolean } = {}) {
  const dry = await readSetting<{ at?: string; scope?: Scope }>(DRY_RUN_KEY);
  if (!opts.skipPreviewCheck && (!dry?.at || dry.scope !== scope || Date.now() - new Date(dry.at).getTime() > DRY_RUN_TTL_MS)) {
    const err: any = new Error("Preview first — Apply only runs within an hour of a preview with the same scope.");
    err.status = 409;
    throw err;
  }
  const preview = await previewSweepUndo(scope);
  const deleted: Array<{ dealId: string; dealRef: number | null; name: string; trackerRowId: string; relinkedTo: string | null; relinkedToRef: number | null }> = [];
  const failed: Array<{ dealId: string; error: string }> = [];
  for (const c of preview.candidates) {
    if (c.action !== "relink" && c.action !== "unlink") continue;
    try {
      // deleteCrmDeal unlinks the tracker row and any tenancy row pointing at
      // the stub and removes its (empty) fee allocations; the row is then
      // pointed at the one other live letting deal when there is exactly one.
      await storage.deleteCrmDeal(c.dealId);
      if (c.relinkTo) {
        const target = await pool.query(`SELECT status FROM crm_deals WHERE id = $1`, [c.relinkTo.id]);
        const code = legacyToCode(target.rows[0]?.status);
        await pool.query(
          `UPDATE available_units SET deal_id = $1, marketing_status = COALESCE($2, marketing_status), updated_at = NOW()
            WHERE id = $3 AND deal_id IS NULL`,
          [c.relinkTo.id, code, c.trackerRowId]);
      }
      deleted.push({ dealId: c.dealId, dealRef: c.dealRef, name: c.name, trackerRowId: c.trackerRowId, relinkedTo: c.relinkTo?.id ?? null, relinkedToRef: c.relinkTo?.dealRef ?? null });
    } catch (e: any) {
      failed.push({ dealId: c.dealId, error: e?.message || String(e) });
    }
  }
  const run = { at: new Date().toISOString(), by, scope, deleted, failed, summary: preview.summary };
  const prior = (await readSetting<{ runs?: any[] }>(UNDO_KEY)) || {};
  await writeSetting(UNDO_KEY, { runs: [...(prior.runs || []), run] });
  await pool.query(`DELETE FROM system_settings WHERE key = $1`, [DRY_RUN_KEY]);
  return run;
}

export function registerLettingSweepUndoRoutes(app: Express) {
  app.post("/api/admin/letting-sweep-undo", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const scope: Scope = req.body?.scope === "all" ? "all" : "duplicates";
      const dryRun = req.body?.dryRun !== false;
      if (dryRun) {
        const out = await previewSweepUndo(scope);
        await writeSetting(DRY_RUN_KEY, { at: new Date().toISOString(), scope, candidates: out.candidates.length });
        return res.json({ dryRun: true, scope, ...out });
      }
      const by = (req as any).session?.userId || (req as any).tokenUserId || null;
      const run = await applySweepUndo(scope, by);
      res.json({ dryRun: false, ...run });
    } catch (e: any) {
      res.status(e?.status || 500).json({ message: e?.message || "letting sweep undo failed" });
    }
  });
  app.get("/api/admin/letting-sweep-undo/history", requireAuth, requireAdmin, async (_req, res) => {
    try {
      res.json({ sweep: await readSetting(SWEEP_KEY), undo: await readSetting(UNDO_KEY) });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "history failed" });
    }
  });
}
