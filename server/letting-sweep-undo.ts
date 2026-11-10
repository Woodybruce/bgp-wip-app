// Undo of the 2026-10-26 boot sweep that gave every Letting Tracker row a
// backing deal. Its adoption matched an existing deal only by unit id or the
// exact "Property – Unit" name, so on units that already carried deals made
// on the deal form ("Tenant – Property", no unit id) it minted a THIRD,
// empty Marketing deal (Carly, 2026-10-26: "there are now 3 deals for the
// ones which were duplicates"). The sweep no longer runs at boot, and
// neither does this undo: it is an admin Preview → Apply only.
//
//   POST /api/admin/letting-sweep-undo  { dryRun: boolean, scope: "duplicates" | "all", relink?: boolean }
//
// What counts as the sweep's: the sweep ran once, in a single burst that
// ended at `sweep.at` (system_settings unit_backing_deals_2026_10_26, written
// when the run finished). Its span is derived from the data — walk back from
// `sweep.at` through the signature deals while the gaps between consecutive
// ones stay under SWEEP_GAP_MS — and a deal is "in the sweep" only when it
// was created inside that span. Same-shaped stubs minted by Add Unit, a
// tenancy import, Re-sync or a later boot are listed but never removed:
// they are listed as keep-not-sweep with their cluster so a person can see
// them. Apply refuses when there is no sweep record.
//
// Every stub the sweep minted has: landlord side, New Letting (or no type),
// a status the sweep could copy from the row (anything not Historic — it
// wrote legacyToCode(marketing_status) || 'AVA', so OPP/REP/SPEC/LIVE/AVA/
// NEG/HOT/SOL), and the name "<property> – <unit>" as the names WERE at
// 16:00. Names are compared lower/trim on both dash forms, and inside the
// span a stub whose property or unit has since been renamed still matches
// on the half that did not change; one where neither half matches is
// listed (keep-name-differs), not deleted.
//
// Stubs anyone has touched since (fee split, HOTs, a manual edit, a tenant,
// comments, a company / contact / lead / requirement link, a spine row, or
// any update after creation) are listed and kept. A stub whose tracker row
// has since been re-pointed or deleted (no row points at it) is still the
// sweep's and is deleted (action "delete").
//
// Apply deletes the stub and leaves the row with no deal — as it was before
// the sweep (the sweep only touched rows with no deal). With relink: true it
// also points the row at the ONE other live, unlinked landlord letting deal
// on the unit when there is exactly one STRICT match (unit id, tenancy row
// or the exact "Property – Unit" name — the sweep's own adoption forms; a
// unit label merely contained in a deal name is shown but never relinked)
// and that deal's status is not behind the row's. Each deal is snapshotted
// into the run record before it is deleted, and the record is written as
// the run goes so a restart mid-run loses nothing.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth, requireAdmin } from "./auth";
import { storage } from "./storage";
import { legacyToCode, type DealStatusCode } from "@shared/deal-status";
import { ALL_LETTING_TYPES, DEFAULT_LETTING_TYPE, TRACKER_LIVE_STATUSES, closedStatusSqlList, isHistoricStatus } from "@shared/letting-rules";

const SWEEP_KEY = "unit_backing_deals_2026_10_26";
const UNDO_KEY = "unit_backing_deals_undo_2026_10_26";
const DRY_RUN_KEY = "letting_sweep_undo_dry_run";
const SWEEP_START = "2026-10-26T00:00:00Z";
const CLUSTER_MS = 2 * 60_000;      // display only: stubs minted within the same two minutes
const SWEEP_GAP_MS = 2 * 60_000;    // walking back from sweep.at, a gap this long ends the sweep's span
const SWEEP_FLOOR_MS = 10 * 60_000; // the span never reaches further back than this before sweep.at
const SWEEP_TAIL_MS = 60_000;       // sweep.at was written after the last stub; allow clock slack
const TOUCHED_AFTER_MS = 5_000;     // the sweep never updates its own stubs
const DRY_RUN_TTL_MS = 60 * 60_000;

type Scope = "duplicates" | "all";
type NameMatch = "exact" | "property prefix" | "unit suffix" | "none";
type OtherDeal = {
  id: string; dealRef: number | null; name: string; status: string | null; statusCode: string | null; dealType: string | null;
  live: boolean; linkedRowId: string | null; matchedBy: string;
  // strict: a form the sweep's own adoption used — the only ones Apply may relink to
  strict: boolean;
};
type Candidate = {
  dealId: string; dealRef: number | null; name: string; status: string | null; fee: number | null; createdAt: string;
  trackerRowId: string | null; unitName: string | null; propertyId: string | null; propertyName: string | null;
  rowMarketingStatus: string | null;
  nameMatch: NameMatch; cluster: string; clusterSize: number; inSweep: boolean;
  touched: string[]; otherDeals: OtherDeal[];
  action: "relink" | "unlink" | "delete" | "keep-touched" | "keep-not-sweep" | "keep-name-differs" | "keep-out-of-scope";
  // the one strict live unlinked partner, when there is exactly one — shown
  // even when relink is off so the preview says what relink: true would do
  relinkTo: { id: string; dealRef: number | null; name: string; statusCode: string | null } | null;
  note: string | null;
};
type Window = { start: string; end: string } | null;

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

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const nameForms = (property: string | null, label: string): string[] =>
  property ? [norm(`${property} – ${label}`), norm(`${property} - ${label}`)] : [norm(label)];
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);
const trackerRank = (code: string | null) => (code ? TRACKER_LIVE_STATUSES.indexOf(code as DealStatusCode) : -1);

function classifyName(dealName: string, property: string | null, label: string): NameMatch {
  const name = norm(dealName);
  if (label && nameForms(property, label).includes(name)) return "exact";
  const prop = norm(property);
  if (prop && (name.startsWith(`${prop} – `) || name.startsWith(`${prop} - `))) return "property prefix";
  const lab = norm(label);
  if (lab && (name.endsWith(` – ${lab}`) || name.endsWith(` - ${lab}`))) return "unit suffix";
  return "none";
}

export async function previewSweepUndo(scope: Scope, opts: { relink?: boolean } = {}): Promise<{
  sweep: any; window: Window; relink: boolean; clusters: Array<{ bucket: string; count: number }>; candidates: Candidate[]; summary: Record<string, number>;
}> {
  const relink = opts.relink === true;
  const sweep = await readSetting<{ at?: string; created?: number; linked?: number }>(SWEEP_KEY);
  const sweepAt = sweep?.at ? new Date(sweep.at).getTime() : NaN;

  // Every landlord-side New-Letting-or-untyped deal created on/after 26 Oct
  // that is not Historic — the sweep's own filter, not a tracker-only list.
  // The name is classified in code (see classifyName) rather than filtered
  // in SQL so a renamed property/unit cannot hide a stub. LEFT JOIN: a stub
  // whose row was re-pointed or deleted since is still the sweep's.
  const { rows } = await pool.query(
    `SELECT d.id, d.deal_ref, d.name, d.status, d.fee, d.created_at, d.updated_at, d.property_id, d.unit_id AS deal_unit_id, d.tenant_id, d.comments,
            p.name AS property_name,
            au.id AS tracker_row_id, au.unit_name, au.unit_id AS au_unit_id, au.tenancy_unit_id AS au_tenancy_unit_id,
            au.marketing_status AS row_marketing_status,
            COALESCE(pu.unit_name, au.unit_name, du.unit_name) AS master_name,
            (SELECT count(*)::int FROM deal_fee_allocations f WHERE f.deal_id = d.id) AS fee_allocs,
            (SELECT count(*)::int FROM deal_hots h WHERE h.deal_id = d.id) AS hots,
            (SELECT count(*)::int FROM deal_audit_log a WHERE a.deal_id = d.id AND a.changed_by IS NOT NULL) AS manual_audits,
            EXISTS (SELECT 1 FROM crm_company_deals x WHERE x.deal_id = d.id) AS has_companies,
            EXISTS (SELECT 1 FROM crm_contact_deals x WHERE x.deal_id = d.id) AS has_contacts,
            EXISTS (SELECT 1 FROM crm_deal_leads x WHERE x.deal_id = d.id) AS has_leads,
            EXISTS (SELECT 1 FROM crm_req_invest_deals x WHERE x.deal_id = d.id) AS has_invest_reqs,
            EXISTS (SELECT 1 FROM crm_requirements_leasing x WHERE x.deal_id = d.id) AS has_requirements,
            EXISTS (SELECT 1 FROM tenancy_schedule_units x WHERE x.deal_id = d.id) AS has_spine_rows
       FROM crm_deals d
       LEFT JOIN LATERAL (SELECT a.* FROM available_units a WHERE a.deal_id = d.id ORDER BY a.created_at LIMIT 1) au ON true
       LEFT JOIN property_units pu ON pu.id = au.unit_id
       LEFT JOIN property_units du ON du.id = d.unit_id
       LEFT JOIN crm_properties p ON p.id = d.property_id
      WHERE d.created_at >= $1::timestamptz
        AND lower(trim(coalesce(d.status, ''))) NOT IN (${closedStatusSqlList()})
        AND coalesce(d.deal_type, $2) = $2
        AND coalesce(d.bgp_acting_for, 'landlord') = 'landlord'
      ORDER BY d.created_at`,
    [SWEEP_START, DEFAULT_LETTING_TYPE]);

  const labelOf = (r: any) => String(r.master_name || r.unit_name || "").trim();
  const createdOf = (r: any) => new Date(r.created_at).getTime();
  const signature = rows.filter((r: any) => classifyName(r.name, r.property_name, labelOf(r)) === "exact");

  // The sweep's span: walk back from sweep.at through the signature deals
  // while consecutive gaps stay short. Nothing older than the floor, and
  // nothing after sweep.at + tail, is the sweep's.
  let window: Window = null;
  if (!Number.isNaN(sweepAt)) {
    const end = sweepAt + SWEEP_TAIL_MS;
    const floor = sweepAt - SWEEP_FLOOR_MS;
    const times = signature.map(createdOf).filter((t: number) => t <= end && t >= floor).sort((a: number, b: number) => b - a);
    let start = sweepAt;
    for (const t of times) { if (start - t <= SWEEP_GAP_MS) start = t; else break; }
    window = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  }
  const inWindow = (t: number) => !!window && t >= new Date(window.start).getTime() && t <= new Date(window.end).getTime();

  // Display only: how the signature deals cluster by creation time.
  const bucketOf = (iso: string) => new Date(Math.floor(new Date(iso).getTime() / CLUSTER_MS) * CLUSTER_MS).toISOString();
  const clusterCount: Record<string, number> = {};
  for (const r of signature) { const b = bucketOf(r.created_at); clusterCount[b] = (clusterCount[b] || 0) + 1; }

  const candidates: Candidate[] = [];
  for (const r of rows) {
    const label = labelOf(r);
    const nameMatch = classifyName(r.name, r.property_name, label);
    const createdMs = createdOf(r);
    const inSweep = inWindow(createdMs);
    // Outside the sweep's span only the exact signature is worth listing;
    // inside it every deal is shown so nothing the sweep made can hide.
    if (!inSweep && nameMatch !== "exact") continue;
    const cluster = bucketOf(r.created_at);
    const clusterSize = clusterCount[cluster] || 0;

    const touched: string[] = [];
    if (r.fee_allocs > 0) touched.push("fee split entered");
    if (r.hots > 0) touched.push("HOTs document");
    if (r.manual_audits > 0) touched.push("edited by a person");
    if (r.tenant_id) touched.push("tenant set");
    if (r.comments) touched.push("comments added");
    if (r.has_companies) touched.push("company linked");
    if (r.has_contacts) touched.push("contact linked");
    if (r.has_leads) touched.push("lead linked");
    if (r.has_invest_reqs) touched.push("investment requirement linked");
    if (r.has_requirements) touched.push("leasing requirement linked");
    if (r.has_spine_rows) touched.push("tenancy row points at it");
    if (new Date(r.updated_at).getTime() - createdMs > TOUCHED_AFTER_MS) touched.push("updated after creation");

    // The other landlord-side letting deals on this unit (the ones the sweep
    // failed to adopt). Strict forms are the sweep's own adoption forms —
    // unit id, spine row, exact "Property – Unit" name; a NULL-typed deal
    // (WIP-imported rent reviews and sales are untyped) is strict only by
    // unit id or spine row. "Unit label inside the deal name" is shown for
    // the person reading the preview and never relinked to.
    let otherDeals: OtherDeal[] = [];
    if (r.property_id) {
      const forms = label ? nameForms(r.property_name, label) : [];
      const others = await pool.query(
        `SELECT d2.id, d2.deal_ref, d2.name, d2.status, d2.deal_type,
                (SELECT a2.id FROM available_units a2 WHERE a2.deal_id = d2.id LIMIT 1) AS linked_row_id,
                CASE WHEN $3::varchar IS NOT NULL AND d2.unit_id = $3 THEN 'unit id'
                     WHEN $4::varchar IS NOT NULL AND d2.tenancy_unit_id = $4 THEN 'tenancy row'
                     WHEN lower(trim(d2.name)) = ANY($7::text[]) THEN 'exact name'
                     WHEN EXISTS (SELECT 1 FROM available_units a3 WHERE a3.deal_id = d2.id AND a3.property_id = d2.property_id
                                    AND $5 <> '' AND lower(trim(a3.unit_name)) = lower(trim($5))) THEN 'another tracker row of this name'
                     ELSE 'unit name in deal name' END AS matched_by
           FROM crm_deals d2
          WHERE d2.property_id = $1 AND d2.id <> $2
            AND coalesce(d2.bgp_acting_for, 'landlord') = 'landlord'
            AND (d2.deal_type IS NULL OR d2.deal_type = ANY($6::text[]))
            AND (($3::varchar IS NOT NULL AND d2.unit_id = $3)
              OR ($4::varchar IS NOT NULL AND d2.tenancy_unit_id = $4)
              OR lower(trim(d2.name)) = ANY($7::text[])
              OR EXISTS (SELECT 1 FROM available_units a3 WHERE a3.deal_id = d2.id AND a3.property_id = d2.property_id
                           AND $5 <> '' AND lower(trim(a3.unit_name)) = lower(trim($5)))
              OR ($8 <> '' AND lower(d2.name) LIKE '%' || $8 || '%'))
          ORDER BY d2.created_at DESC NULLS LAST`,
        [r.property_id, r.id, r.au_unit_id, r.au_tenancy_unit_id, label, ALL_LETTING_TYPES, forms, escapeLike(norm(label))]);
      otherDeals = others.rows.map((o: any) => ({
        id: o.id, dealRef: o.deal_ref, name: o.name, status: o.status, statusCode: legacyToCode(o.status), dealType: o.deal_type,
        live: !isHistoricStatus(o.status), linkedRowId: o.linked_row_id, matchedBy: o.matched_by,
        strict: o.matched_by === "unit id" || o.matched_by === "tenancy row" || (o.matched_by === "exact name" && o.deal_type != null),
      }));
    }
    const strictLive = otherDeals.filter((o) => o.strict && o.live && !o.linkedRowId);
    // A duplicate (scope "duplicates"): another live letting deal on the
    // unit. A label-inside-name hit counts only when the label is long
    // enough to mean something and is not the property name itself.
    const isDuplicate = otherDeals.some((o) => o.live && (o.matchedBy !== "unit name in deal name" || (label.length >= 3 && norm(label) !== norm(r.property_name))));

    const rowCode = legacyToCode(r.row_marketing_status);
    let relinkTo: Candidate["relinkTo"] = null;
    let note: string | null = null;
    if (r.tracker_row_id && strictLive.length === 1) {
      const o = strictLive[0];
      const partnerRank = trackerRank(o.statusCode);
      if (partnerRank < 0) note = `not relinked: ${o.name} is at ${o.statusCode || o.status || "no status"}, not a tracker status`;
      else if (rowCode && TRACKER_LIVE_STATUSES.includes(rowCode) && partnerRank < trackerRank(rowCode)) note = `not relinked: ${o.name} is at ${o.statusCode}, behind the row's ${rowCode}`;
      else relinkTo = { id: o.id, dealRef: o.dealRef, name: o.name, statusCode: o.statusCode };
    } else if (r.tracker_row_id && strictLive.length > 1) {
      note = `${strictLive.length} live letting deals on this unit — the team decides`;
    }

    let action: Candidate["action"];
    if (!inSweep) action = "keep-not-sweep";
    else if (touched.length) action = "keep-touched";
    else if (nameMatch === "none") action = "keep-name-differs";
    else if (!r.tracker_row_id) action = "delete";
    else if (scope === "duplicates" && !isDuplicate) action = "keep-out-of-scope";
    else if (relink && relinkTo) action = "relink";
    else action = "unlink";

    candidates.push({
      dealId: r.id, dealRef: r.deal_ref, name: r.name, status: r.status, fee: r.fee, createdAt: new Date(r.created_at).toISOString(),
      trackerRowId: r.tracker_row_id, unitName: r.unit_name, propertyId: r.property_id, propertyName: r.property_name,
      rowMarketingStatus: r.row_marketing_status,
      nameMatch, cluster, clusterSize, inSweep, touched, otherDeals, action, relinkTo, note,
    });
  }

  // Two rows must never end up on one deal: a partner chosen by more than
  // one candidate is relinked to by none of them.
  const wanted: Record<string, number> = {};
  for (const c of candidates) if (c.action === "relink" && c.relinkTo) wanted[c.relinkTo.id] = (wanted[c.relinkTo.id] || 0) + 1;
  for (const c of candidates) {
    if (c.action === "relink" && c.relinkTo && wanted[c.relinkTo.id] > 1) {
      c.action = "unlink";
      c.note = `not relinked: ${c.relinkTo.name} is the only live deal for ${wanted[c.relinkTo.id]} tracker rows`;
      c.relinkTo = null;
    }
  }

  const summary: Record<string, number> = {
    matchedSignature: signature.length, listed: candidates.length, inSweep: 0, duplicates: 0,
    relink: 0, unlink: 0, deleteOrphan: 0, keptTouched: 0, keptNotSweep: 0, keptNameDiffers: 0, keptOutOfScope: 0,
  };
  for (const c of candidates) {
    if (c.inSweep) summary.inSweep++;
    if (c.otherDeals.some((o) => o.live)) summary.duplicates++;
    if (c.action === "relink") summary.relink++;
    else if (c.action === "unlink") summary.unlink++;
    else if (c.action === "delete") summary.deleteOrphan++;
    else if (c.action === "keep-touched") summary.keptTouched++;
    else if (c.action === "keep-not-sweep") summary.keptNotSweep++;
    else if (c.action === "keep-name-differs") summary.keptNameDiffers++;
    else summary.keptOutOfScope++;
  }
  const clusters = Object.entries(clusterCount).sort().map(([bucket, count]) => ({ bucket, count }));
  return { sweep, window, relink, clusters, candidates, summary };
}

let applying = false;

export async function applySweepUndo(scope: Scope, by: string | null, opts: { skipPreviewCheck?: boolean; relink?: boolean } = {}) {
  const relink = opts.relink === true;
  const dry = await readSetting<{ at?: string; scope?: Scope; relink?: boolean }>(DRY_RUN_KEY);
  if (!opts.skipPreviewCheck && (!dry?.at || dry.scope !== scope || (dry.relink === true) !== relink || Date.now() - new Date(dry.at).getTime() > DRY_RUN_TTL_MS)) {
    const err: any = new Error("Preview first — Apply only runs within an hour of a preview with the same scope and relink setting.");
    err.status = 409;
    throw err;
  }
  if (applying) {
    const err: any = new Error("A sweep undo is already running.");
    err.status = 409;
    throw err;
  }
  applying = true;
  try {
    const preview = await previewSweepUndo(scope, { relink });
    if (!preview.sweep?.at || !preview.window) {
      const err: any = new Error(`No sweep record (${SWEEP_KEY}) on this database — nothing to undo.`);
      err.status = 409;
      throw err;
    }

    // The run record is written before the first delete and appended to
    // after every step, so a restart mid-run keeps what was already done.
    const prior = (await readSetting<{ runs?: any[] }>(UNDO_KEY)) || {};
    const runIndex = (prior.runs || []).length;
    type Deleted = {
      dealId: string; dealRef: number | null; name: string; status: string | null; fee: number | null;
      trackerRowId: string | null; priorDealId: string | null; priorMarketingStatus: string | null;
      relinkedTo: string | null; relinkedToRef: number | null; note: string | null;
      snapshot: Record<string, unknown> | null;
    };
    const deleted: Deleted[] = [];
    const relinked: Array<{ dealId: string; trackerRowId: string; relinkedTo: string; relinkedToRef: number | null; marketingStatus: string | null; priorMarketingStatus: string | null }> = [];
    const failed: Array<{ dealId: string; step: "delete" | "relink"; error: string }> = [];
    const run: any = {
      at: new Date().toISOString(), by, scope, relink, status: "running", window: preview.window,
      deleted, relinked, failed, summary: preview.summary,
    };
    await writeSetting(UNDO_KEY, { runs: [...(prior.runs || []), run] });
    const append = (field: "deleted" | "relinked" | "failed", entry: unknown) => pool.query(
      `UPDATE system_settings
          SET value = jsonb_set(value, $2::text[], COALESCE(value #> $2::text[], '[]'::jsonb) || $3::jsonb), updated_at = now()
        WHERE key = $1`,
      [UNDO_KEY, ["runs", String(runIndex), field], JSON.stringify([entry])]);

    for (const c of preview.candidates) {
      if (c.action !== "relink" && c.action !== "unlink" && c.action !== "delete") continue;
      const entry: Deleted = {
        dealId: c.dealId, dealRef: c.dealRef, name: c.name, status: c.status, fee: c.fee,
        trackerRowId: c.trackerRowId, priorDealId: null, priorMarketingStatus: null,
        relinkedTo: null, relinkedToRef: null, note: c.note, snapshot: null,
      };
      try {
        // Snapshot the deal and the row it sits on so it can be put back.
        const snap = await pool.query(`SELECT to_jsonb(d) AS deal FROM crm_deals d WHERE d.id = $1`, [c.dealId]);
        if (!snap.rows.length) { entry.note = "already gone"; deleted.push(entry); await append("deleted", entry); continue; }
        entry.snapshot = Object.fromEntries(Object.entries(snap.rows[0].deal as Record<string, unknown>).filter(([, v]) => v != null));
        if (c.trackerRowId) {
          const row = await pool.query(`SELECT deal_id, marketing_status FROM available_units WHERE id = $1`, [c.trackerRowId]);
          entry.priorDealId = row.rows[0]?.deal_id ?? null;
          entry.priorMarketingStatus = row.rows[0]?.marketing_status ?? null;
        }
        // deleteCrmDeal unlinks the tracker row and any tenancy row pointing
        // at the stub and removes its (empty) fee allocations.
        await storage.deleteCrmDeal(c.dealId);
        deleted.push(entry);
        await append("deleted", entry);
      } catch (e: any) {
        const f = { dealId: c.dealId, step: "delete" as const, error: e?.message || String(e) };
        failed.push(f);
        await append("failed", f).catch(() => {});
        continue;
      }
      if (c.action !== "relink" || !c.relinkTo || !c.trackerRowId) continue;
      try {
        // Re-check the partner at apply time: still there, still live, still
        // on no row; and the row must still be empty and the partner on no
        // other row when the UPDATE lands.
        const target = await pool.query(
          `SELECT d.status, (SELECT a.id FROM available_units a WHERE a.deal_id = d.id LIMIT 1) AS linked_row_id FROM crm_deals d WHERE d.id = $1`,
          [c.relinkTo.id]);
        const t = target.rows[0];
        const code = t ? legacyToCode(t.status) : null;
        if (!t || t.linked_row_id || isHistoricStatus(t.status) || trackerRank(code) < 0) {
          const why = !t ? "partner deal gone" : t.linked_row_id ? "partner deal now on another row" : "partner deal no longer at a tracker status";
          entry.note = `not relinked: ${why}`;
          failed.push({ dealId: c.dealId, step: "relink", error: why });
          await append("failed", { dealId: c.dealId, step: "relink", error: why });
          continue;
        }
        const upd = await pool.query(
          `UPDATE available_units SET deal_id = $1, marketing_status = COALESCE($2, marketing_status), updated_at = NOW()
            WHERE id = $3 AND deal_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM available_units x WHERE x.deal_id = $1 AND x.id <> $3)`,
          [c.relinkTo.id, code, c.trackerRowId]);
        if (upd.rowCount !== 1) {
          const why = "row no longer empty or partner taken by another row";
          entry.note = `not relinked: ${why}`;
          failed.push({ dealId: c.dealId, step: "relink", error: why });
          await append("failed", { dealId: c.dealId, step: "relink", error: why });
          continue;
        }
        entry.relinkedTo = c.relinkTo.id;
        entry.relinkedToRef = c.relinkTo.dealRef;
        const rl = { dealId: c.dealId, trackerRowId: c.trackerRowId, relinkedTo: c.relinkTo.id, relinkedToRef: c.relinkTo.dealRef, marketingStatus: code, priorMarketingStatus: entry.priorMarketingStatus };
        relinked.push(rl);
        await append("relinked", rl);
      } catch (e: any) {
        const f = { dealId: c.dealId, step: "relink" as const, error: e?.message || String(e) };
        failed.push(f);
        await append("failed", f).catch(() => {});
      }
    }
    run.status = "finished";
    run.finishedAt = new Date().toISOString();
    await pool.query(
      `UPDATE system_settings SET value = jsonb_set(jsonb_set(value, $2::text[], '"finished"'::jsonb), $3::text[], to_jsonb($4::text)), updated_at = now() WHERE key = $1`,
      [UNDO_KEY, ["runs", String(runIndex), "status"], ["runs", String(runIndex), "finishedAt"], run.finishedAt]);
    await pool.query(`DELETE FROM system_settings WHERE key = $1`, [DRY_RUN_KEY]);
    return run;
  } finally {
    applying = false;
  }
}

export function registerLettingSweepUndoRoutes(app: Express) {
  app.post("/api/admin/letting-sweep-undo", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const scope: Scope = req.body?.scope === "all" ? "all" : "duplicates";
      const dryRun = req.body?.dryRun !== false;
      const relink = req.body?.relink === true;
      if (dryRun) {
        const out = await previewSweepUndo(scope, { relink });
        await writeSetting(DRY_RUN_KEY, { at: new Date().toISOString(), scope, relink, candidates: out.candidates.length });
        return res.json({ dryRun: true, scope, ...out });
      }
      const by = (req as any).session?.userId || (req as any).tokenUserId || null;
      const run = await applySweepUndo(scope, by, { relink });
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
