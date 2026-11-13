// Matching a plan to the tenancy schedule, one outline at a time
// (docs/property-page-rebuild-2026-11-13.md). A scan only ever PROPOSES
// outlines. A person then links each one to a schedule row, keeps it as
// context (drawn, no row) or marks it "not a unit". Nothing here writes to the
// tenancy schedule: the schedule stays the list of units and the plan follows.
//
// Unlike the older one-shot review (applyPropertyPlanScan), a scan stays open:
// each accepted proposal is marked on the scan with the outline it became, so
// the work can be done over several sittings and by more than one person.
// Suggestions are worked out when the board is read, against the rows that
// have no outline on this plan yet, so they improve as the schedule is filled.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { isClientRequestUser } from "./company-scope";
import { isValidPolygon } from "@shared/plan-geometry";
import type { PropertyPlanCandidate } from "@shared/property-plan-scan";
import { bulkAcceptable, floorsDisagree, sameFloor, type PlanMatchBoard, type PlanMatchMethod, type PlanMatchProposal } from "@shared/property-plan-match";
import { namedTenant } from "@shared/property-units";
import { planPolygonsOverlap } from "./plan-unit-detection";
import { planPoints } from "./property-plan-scan";
import { validatePlanUnitLink } from "./property-plan-links";
import { expirePropertyPlanScans, PropertyPlanScanError, requirePropertyPlan, validPlanId } from "./property-plan-scan-store";
import { evidenceTenantNamesAgree, normalizeEvidenceUnitRef, resolveEvidenceScheduleMatch } from "./evidence-plan-schedule";
import { propertyReadBlocked } from "./property-units";

type Queryable = { query: (sql: string, values?: any[]) => Promise<any> };
type Database = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };
type CanAccess = (propertyId: string) => Promise<boolean>;
type StoredCandidate = PropertyPlanCandidate & { acceptedOutlineId?: string; dismissed?: boolean };
type SavedOutline = { id: string; label: string | null; polygon: PropertyPlanCandidate["polygon"]; tenancy_unit_id: string | null; unit_id: string | null };
export type PlanMatchScheduleRow = {
  id: string; property_id: "plan"; unit_number: string; premises: string | null;
  tenant_name: string | null; trading_name: string | null; permitted_use: string | null; floor: string | null;
};

// The live schedule rows of the plan's property, in the feed's own terms
// (server/property-units.ts SPINE_SQL): archived rows are not units.
const ROWS_SQL = `
  SELECT t.id, COALESCE(NULLIF(btrim(t.unit_number), ''), NULLIF(btrim(t.premises), ''), 'Unnamed unit') AS label,
         NULLIF(btrim(t.premises), '') AS premises, NULLIF(btrim(t.tenant_name), '') AS tenant_name, NULLIF(btrim(t.trading_name), '') AS trading_name,
         NULLIF(btrim(t.floor_level), '') AS floor, NULLIF(btrim(t.permitted_use), '') AS use
    FROM tenancy_schedule_units t
   WHERE t.property_id = $1
     AND lower(btrim(COALESCE(t.status, ''))) <> 'archived' AND lower(btrim(COALESCE(t.occupancy_status, ''))) <> 'archived'
   ORDER BY 2, t.id`;
const OUTLINES_SQL = `SELECT id, label, polygon, tenancy_unit_id, unit_id FROM property_plan_units WHERE plan_id = $1 ORDER BY created_at, id`;

const matchRow = (r: any): PlanMatchScheduleRow => ({
  id: r.id, property_id: "plan", unit_number: r.label, premises: r.premises, tenant_name: r.tenant_name, trading_name: r.trading_name, permitted_use: r.use, floor: r.floor,
});

// A scan names an outline it could not read "Unlabelled 7", and prints
// "VACANT" or "TO LET" where a shop is empty. Neither is a name to match on.
const NOT_A_NAME = /^(unlabelled \d+|to let|let|vacant|void|available|tbc|n\/a|[-—–])$/i;
const readable = (value: string | null | undefined) => { const s = String(value ?? "").trim(); return s && !NOT_A_NAME.test(s) ? s : null; };

// One proposal against the rows still free on this plan. The lease advisory
// matcher decides (unit references with ranges and aliases, then a full tenant
// or trading name, never an ancillary row); a schedule that names a unit
// "SVL02 Bluewater - Lower Level" is also tried on its leading code, as the
// scan itself does.
//
// The unit number is the unit. It is tried first and without the tenant, since
// a plan is often older than the schedule and prints a tenant who has left:
// that difference is reported, not treated as a different unit. A tenant's
// name only suggests a row when the plan prints no number for the outline; a
// number that matches nothing is never overridden by a name. More than one
// possible row is never a suggestion, unless exactly one is on this floor.
export type PlanLabelMatch = { rowId: string | null; method: PlanMatchMethod | null; possible: string[]; tenantDiffers: boolean; floorDiffers: boolean };
export function matchPlanLabel(label: string | null, tenant: string | null, rows: PlanMatchScheduleRow[], planFloor: string | null): PlanLabelMatch {
  const ref = readable(label), name = namedTenant(readable(tenant));
  const none: PlanLabelMatch = { rowId: null, method: null, possible: [], tenantDiffers: false, floorDiffers: false };
  if (!ref && !name) return none;
  const byId = new Map(rows.map(row => [row.id, row]));
  const attempt = (unitRef: string | null, tenantName: string | null, candidates: PlanMatchScheduleRow[]) =>
    resolveEvidenceScheduleMatch({ unit_ref: unitRef, tenant_name: tenantName, property_id: "plan" }, candidates, { propertyId: "plan" });
  const spaced = (row: PlanMatchScheduleRow) => /\s/.test(row.unit_number.trim());
  const onRef = (unitRef: string) => {
    const whole = attempt(unitRef, null, rows);
    if (whole.status === "matched") return whole;
    const leading = rows.filter(spaced).map(row => ({ ...row, unit_number: row.unit_number.trim().split(/\s+/)[0] })).filter(row => /\d/.test(row.unit_number));
    const clash = rows.some(row => !spaced(row) && normalizeEvidenceUnitRef(row.unit_number) === normalizeEvidenceUnitRef(unitRef));
    if (!leading.length || clash) return whole;
    const second = attempt(unitRef, null, leading);
    return second.status === "matched" || (second.candidateIds.length && !whole.candidateIds.length) ? second : whole;
  };
  const found = (rowId: string, method: PlanMatchMethod, possible: string[] = []): PlanLabelMatch => {
    const row = byId.get(rowId);
    const names = [row?.tenant_name, row?.trading_name].filter((n): n is string => !!namedTenant(n));
    return {
      rowId, method, possible,
      tenantDiffers: method !== "tenant" && !!name && names.length > 0 && !names.some(n => evidenceTenantNamesAgree(name, n)),
      floorDiffers: floorsDisagree(row?.floor, planFloor),
    };
  };
  const first = ref ? onRef(ref) : null;
  if (first?.status === "matched" && first.row && first.candidateIds.length === 1) return found(first.row.id, first.method === "tenant" ? "tenant" : "code");
  const printsNumber = !!ref && /\d/.test(ref);
  const second = name && name !== ref ? attempt(null, name, rows) : null;
  if (second?.status === "matched" && second.row && second.candidateIds.length === 1 && !printsNumber && !first?.candidateIds.length) return found(second.row.id, "tenant");
  const possible = [...new Set([...(first?.candidateIds || []), ...(second?.candidateIds || [])])];
  if (possible.length > 1 && planFloor) {
    const onFloor = possible.filter(id => sameFloor(byId.get(id)?.floor, planFloor));
    if (onFloor.length === 1) return found(onFloor[0], "floor", possible);
  }
  return { ...none, possible: possible.length <= 8 ? possible : [] };
}

// The proposals still waiting for a person: not marked "not a unit", not
// already saved (an outline that was later removed puts its proposal back),
// and not sitting where something has since been drawn.
export function openPlanCandidates(candidates: StoredCandidate[] | null | undefined, outlines: SavedOutline[]): StoredCandidate[] {
  const saved = new Set(outlines.map(o => o.id));
  const drawn = outlines.map(o => planPoints(o.polygon));
  return (candidates || []).filter(c => {
    if (!c || c.dismissed || (c.acceptedOutlineId && saved.has(c.acceptedOutlineId))) return false;
    const shape = planPoints(c.polygon);
    return isValidPolygon(shape) && !drawn.some(other => planPolygonsOverlap(other, shape));
  });
}

// Every open proposal matched against the same free rows. A row that two
// proposals both point at is nobody's suggestion: a person chooses which
// outline is the unit.
export function suggestPlanMatches(open: StoredCandidate[], free: PlanMatchScheduleRow[], planFloor: string | null): PlanMatchProposal[] {
  const proposals = open.map((c): PlanMatchProposal => {
    const match = matchPlanLabel(c.label, c.tenant, free, planFloor);
    return { id: c.id, label: c.label, tenant: c.tenant ?? null, polygon: c.polygon, suggestedRowId: match.rowId, method: match.method, possibleRowIds: match.possible,
      tenantDiffers: match.tenantDiffers, floorDiffers: match.floorDiffers };
  });
  const claims = new Map<string, number>();
  for (const p of proposals) if (p.suggestedRowId) claims.set(p.suggestedRowId, (claims.get(p.suggestedRowId) || 0) + 1);
  return proposals.map(p => p.suggestedRowId && (claims.get(p.suggestedRowId) || 0) > 1
    ? { ...p, suggestedRowId: null, method: null, possibleRowIds: [...new Set([p.suggestedRowId, ...p.possibleRowIds])], tenantDiffers: false, floorDiffers: false }
    : p);
}

const currentScan = (job: any, plan: any) => (job && job.image_key === plan.storage_key ? job : null);

export async function loadPlanMatchBoard(db: Queryable, plan: any, viewer: { canScan: boolean }): Promise<PlanMatchBoard> {
  await expirePropertyPlanScans(db, plan.id);
  const [jobs, outlineRows, scheduleRows, elsewhere] = await Promise.all([
    db.query("SELECT * FROM property_plan_scans WHERE plan_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [plan.id]),
    db.query(OUTLINES_SQL, [plan.id]),
    db.query(ROWS_SQL, [plan.property_id]),
    db.query(`SELECT DISTINCT u.tenancy_unit_id FROM property_plan_units u JOIN property_plans p ON p.id = u.plan_id
               WHERE p.property_id = $1 AND p.id <> $2 AND COALESCE(p.is_geo, false) = false AND u.tenancy_unit_id IS NOT NULL`, [plan.property_id, plan.id]),
  ]);
  const job = currentScan(jobs.rows[0], plan);
  const outlines: SavedOutline[] = outlineRows.rows;
  const live = new Set<string>(scheduleRows.rows.map((r: any) => r.id));
  const here = new Set(outlines.map(o => o.tenancy_unit_id).filter((id): id is string => !!id && live.has(id)));
  const otherFloors = new Set<string>(elsewhere.rows.map((r: any) => r.tenancy_unit_id));
  const stored: StoredCandidate[] = job?.status === "ready" ? job.candidates || [] : [];
  const free = scheduleRows.rows.filter((r: any) => !here.has(r.id)).map(matchRow);
  return {
    plan: { id: plan.id, propertyId: plan.property_id, floor: plan.floor, width: plan.width ?? null, height: plan.height ?? null, imageKey: plan.storage_key },
    scan: job ? { id: job.id, status: job.status, message: job.message ?? null, completed: job.completed ?? 0, total: job.total ?? 0 } : null,
    outlines: outlines.map(o => ({ id: o.id, label: o.label, polygon: o.polygon, scheduleRowId: o.tenancy_unit_id && live.has(o.tenancy_unit_id) ? o.tenancy_unit_id : null })),
    proposals: suggestPlanMatches(openPlanCandidates(stored, outlines), free, plan.floor),
    dismissed: stored.filter(c => c?.dismissed).length,
    rows: scheduleRows.rows.map((r: any) => ({
      id: r.id, label: r.label, tenant: namedTenant(r.trading_name, r.tenant_name), floor: r.floor, use: r.use,
      outlinedHere: here.has(r.id), outlinedElsewhere: otherFloors.has(r.id),
    })),
    canScan: viewer.canScan,
  };
}

const CANDIDATE_ID = /^candidate-\d+$/;
const ALREADY_DRAWN = "This unit already has an outline on this floor. Change that outline, or remove it first.";

// Plan row, then scan row: the lock order every plan-unit write uses.
async function lockScan(db: Queryable, planId: string, scanId: string, propertyId: string) {
  const plan = await requirePropertyPlan(db, planId, async id => id === propertyId, true);
  const job = (await db.query("SELECT * FROM property_plan_scans WHERE id = $1 AND plan_id = $2 FOR UPDATE", [scanId, planId])).rows[0];
  if (!job) throw new PropertyPlanScanError(404, "Scan not found on this plan");
  if (job.image_key !== plan.storage_key) throw new PropertyPlanScanError(409, "The plan image changed. Scan the current image before saving outlines.");
  if (job.status === "applied") throw new PropertyPlanScanError(409, "This scan's review has already been saved. Scan the plan again to find more units.");
  if (job.status !== "ready") throw new PropertyPlanScanError(409, "Wait for this scan to finish before saving outlines");
  const outlines: SavedOutline[] = (await db.query("SELECT id, label, polygon, tenancy_unit_id, unit_id FROM property_plan_units WHERE plan_id = $1 ORDER BY id FOR UPDATE", [planId])).rows;
  return { plan, job, candidates: (job.candidates || []) as StoredCandidate[], outlines };
}
const saveCandidates = (db: Queryable, scanId: string, candidates: StoredCandidate[]) =>
  db.query("UPDATE property_plan_scans SET candidates = $2::jsonb, updated_at = now() WHERE id = $1", [scanId, JSON.stringify(candidates)]);

async function transaction<T>(database: Database, planId: string, scanId: string, canAccess: CanAccess, work: (db: Queryable, propertyId: string) => Promise<T>): Promise<T> {
  if (!validPlanId(scanId)) throw new PropertyPlanScanError(400, "Invalid scan ID");
  const authorised = await requirePropertyPlan(database, planId, canAccess);
  const db = await database.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db, authorised.property_id);
    await db.query("COMMIT");
    return result;
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
  finally { db.release(); }
}

// Save one proposal as an outline: linked to a schedule row, or with no row
// (context). Asking twice for the same proposal hands back the outline it
// already became.
export async function acceptPlanProposal(database: Database, planId: string, scanId: string,
  choice: { candidateId?: unknown; scheduleRowId?: unknown; label?: unknown }, canAccess: CanAccess): Promise<{ outlineId: string; reused: boolean }> {
  const candidateId = choice.candidateId, rowId = choice.scheduleRowId ?? null, typed = choice.label ?? null;
  if (typeof candidateId !== "string" || !CANDIDATE_ID.test(candidateId)) throw new PropertyPlanScanError(400, "Choose an outline from this scan");
  if (rowId !== null && (typeof rowId !== "string" || !rowId.trim() || rowId.length > 100)) throw new PropertyPlanScanError(400, "Choose a tenancy schedule row, or keep the outline as context");
  if (typed !== null && (typeof typed !== "string" || typed.trim().length > 160)) throw new PropertyPlanScanError(400, "Use a label of up to 160 characters");
  return transaction(database, planId, scanId, canAccess, async (db, propertyId) => {
    const { plan, candidates, outlines } = await lockScan(db, planId, scanId, propertyId);
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) throw new PropertyPlanScanError(404, "That outline is not in this scan");
    if (candidate.acceptedOutlineId && outlines.some(o => o.id === candidate.acceptedOutlineId)) return { outlineId: candidate.acceptedOutlineId, reused: true };
    const shape = planPoints(candidate.polygon);
    if (!isValidPolygon(shape)) throw new PropertyPlanScanError(409, "This proposed outline could not be read. Scan the plan again.");
    const label = (typeof typed === "string" && typed.trim()) || candidate.label;
    if (outlines.some(o => planPolygonsOverlap(planPoints(o.polygon), shape))) {
      throw new PropertyPlanScanError(409, `Something is already drawn where ${label} sits on this plan. Remove that outline first, or mark this one as not a unit.`);
    }
    const link = rowId ? await validatePlanUnitLink(db, plan.property_id, { tenancy_unit_id: rowId }) : { unit_id: null, tenancy_unit_id: null };
    if (outlines.some(o => (link.tenancy_unit_id && o.tenancy_unit_id === link.tenancy_unit_id) || (link.unit_id && o.unit_id === link.unit_id))) throw new PropertyPlanScanError(409, ALREADY_DRAWN);
    const outlineId: string = (await db.query(`INSERT INTO property_plan_units (plan_id, unit_id, tenancy_unit_id, label, polygon)
      VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`, [planId, link.unit_id, link.tenancy_unit_id, label, JSON.stringify(candidate.polygon)])).rows[0].id;
    await saveCandidates(db, scanId, candidates.map(c => c.id === candidateId ? { ...c, acceptedOutlineId: outlineId, dismissed: false } : c));
    return { outlineId, reused: false };
  });
}

// "Accept the suggested matches": every proposal whose row was suggested on
// its unit number or tenant name alone, as the board showed it. Anything that
// cannot be saved cleanly is left for a person, with the reason.
export async function acceptSuggestedPlanProposals(database: Database, planId: string, scanId: string, canAccess: CanAccess): Promise<{ created: number; skipped: Array<{ label: string; reason: string }> }> {
  return transaction(database, planId, scanId, canAccess, async (db, propertyId) => {
    const { plan, candidates, outlines } = await lockScan(db, planId, scanId, propertyId);
    const rows = (await db.query(ROWS_SQL, [plan.property_id])).rows;
    const live = new Set<string>(rows.map((r: any) => r.id));
    const here = new Set(outlines.map(o => o.tenancy_unit_id).filter((id): id is string => !!id && live.has(id)));
    const suggested = suggestPlanMatches(openPlanCandidates(candidates, outlines), rows.filter((r: any) => !here.has(r.id)).map(matchRow), plan.floor).filter(bulkAcceptable);
    const accepted = new Map<string, string>();
    const skipped: Array<{ label: string; reason: string }> = [];
    const drawn = outlines.map(o => ({ shape: planPoints(o.polygon), tenancy_unit_id: o.tenancy_unit_id, unit_id: o.unit_id }));
    for (const proposal of suggested) {
      const shape = planPoints(proposal.polygon);
      if (drawn.some(o => planPolygonsOverlap(o.shape, shape))) { skipped.push({ label: proposal.label, reason: "It overlaps another outline." }); continue; }
      let link: { unit_id: string | null; tenancy_unit_id: string | null };
      try { link = await validatePlanUnitLink(db, plan.property_id, { tenancy_unit_id: proposal.suggestedRowId }); }
      catch { skipped.push({ label: proposal.label, reason: "Its schedule row is no longer on this property." }); continue; }
      if (drawn.some(o => (link.tenancy_unit_id && o.tenancy_unit_id === link.tenancy_unit_id) || (link.unit_id && o.unit_id === link.unit_id))) { skipped.push({ label: proposal.label, reason: "Its unit already has an outline on this floor." }); continue; }
      const outlineId: string = (await db.query(`INSERT INTO property_plan_units (plan_id, unit_id, tenancy_unit_id, label, polygon)
        VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`, [planId, link.unit_id, link.tenancy_unit_id, proposal.label, JSON.stringify(proposal.polygon)])).rows[0].id;
      accepted.set(proposal.id, outlineId);
      drawn.push({ shape, tenancy_unit_id: link.tenancy_unit_id, unit_id: link.unit_id });
    }
    if (accepted.size) await saveCandidates(db, scanId, candidates.map(c => accepted.has(c.id) ? { ...c, acceptedOutlineId: accepted.get(c.id), dismissed: false } : c));
    return { created: accepted.size, skipped };
  });
}

// "Not a unit" (a mall, a void, a misread): the proposal leaves the queue and
// nothing is drawn. It can be put back, one at a time or all together.
export async function dismissPlanProposal(database: Database, planId: string, scanId: string,
  body: { candidateId?: unknown; dismissed?: unknown; restoreAll?: unknown }, canAccess: CanAccess): Promise<{ dismissed: number }> {
  const restoreAll = body.restoreAll === true;
  if (!restoreAll && (typeof body.candidateId !== "string" || !CANDIDATE_ID.test(body.candidateId))) throw new PropertyPlanScanError(400, "Choose an outline from this scan");
  const dismissed = body.dismissed !== false;
  return transaction(database, planId, scanId, canAccess, async (db, propertyId) => {
    const { candidates, outlines } = await lockScan(db, planId, scanId, propertyId);
    if (!restoreAll) {
      const candidate = candidates.find(c => c.id === body.candidateId);
      if (!candidate) throw new PropertyPlanScanError(404, "That outline is not in this scan");
      if (dismissed && candidate.acceptedOutlineId && outlines.some(o => o.id === candidate.acceptedOutlineId)) throw new PropertyPlanScanError(409, "This outline has been saved. Remove it from the plan instead.");
    }
    const next = candidates.map(c => restoreAll ? { ...c, dismissed: false } : c.id === body.candidateId ? { ...c, dismissed } : c);
    await saveCandidates(db, scanId, next);
    return { dismissed: next.filter(c => c.dismissed).length };
  });
}

const router = Router();
const access = (req: Request): CanAccess => async propertyId => !(await propertyReadBlocked(req, propertyId));
function fail(res: Response, error: any, fallback: string) {
  if (!error?.status) console.error("[plan match]", error?.message);
  res.status(error?.status || 500).json({ error: error?.status ? error.message : fallback });
}

router.get("/api/plans/:planId/match", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await requirePropertyPlan(pool, String(req.params.planId), access(req));
    if (plan.is_geo) throw new PropertyPlanScanError(400, "Matching needs an image plan");
    const canScan = !!process.env.ANTHROPIC_API_KEY && !(await isClientRequestUser(req));
    res.json(await loadPlanMatchBoard(pool, plan, { canScan }));
  } catch (error) { fail(res, error, "Could not load this plan"); }
});

router.post("/api/plans/:planId/match/accept", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await acceptPlanProposal(pool, String(req.params.planId), String(req.body?.scanId || ""), req.body || {}, access(req)));
  } catch (error) { fail(res, error, "Could not save this outline"); }
});

router.post("/api/plans/:planId/match/accept-suggested", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await acceptSuggestedPlanProposals(pool, String(req.params.planId), String(req.body?.scanId || ""), access(req)));
  } catch (error) { fail(res, error, "Could not save the suggested matches"); }
});

router.post("/api/plans/:planId/match/dismiss", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await dismissPlanProposal(pool, String(req.params.planId), String(req.body?.scanId || ""), req.body || {}, access(req)));
  } catch (error) { fail(res, error, "Could not update this outline"); }
});

export default router;
