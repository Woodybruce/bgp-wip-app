// Matching a plan to the tenancy schedule (docs/property-page-rebuild-2026-11-13.md).
// Everything a scan finds is saved the moment it finishes (Woody, 2026-11-16:
// "the scan and tenancy schedule matches dont need checking they are all done
// immediately and then there is the ability to edit"): an outline whose
// printed unit number or tenant name points at one free schedule row is linked
// to it, and every other outline is saved unlinked, drawn in grey, for a
// person to link, change or remove on the plan. Nothing here writes to the
// tenancy schedule: the schedule stays the list of units and the plan follows.
//
// Each saved proposal is marked on the scan with the outline it became, and a
// removed outline marks its proposal "not a unit" (DELETE /api/plan-units/:id),
// so nothing comes back by itself. A scan from before saving was automatic
// still holds proposals; the Plan tab saves them all with one press.
// Suggestions for an unlinked outline are worked out when the board is read,
// against the rows that have no outline on this plan yet, so they improve as
// the schedule is filled.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { isClientRequestUser } from "./company-scope";
import { isValidPolygon } from "@shared/plan-geometry";
import type { PropertyPlanCandidate } from "@shared/property-plan-scan";
import { floorsDisagree, planSaveOrder, sameFloor, type PlanMatchBoard, type PlanMatchMethod, type PlanMatchProposal } from "@shared/property-plan-match";
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
// number that matches nothing is never overridden by a name. A number here is
// any printed unit reference ("WVL22", "Kiosk C"); a label that only repeats
// the tenant's name is not one, since a scan labels an outline with the tenant
// when the plan prints nothing else. More than one possible row is never a
// suggestion, unless exactly one is on this floor; where the plan prints a
// number, only the rows that number names are settled that way.
export type PlanLabelMatch = { rowId: string | null; method: PlanMatchMethod | null; possible: string[]; tenantDiffers: boolean; floorDiffers: boolean };
export function matchPlanLabel(label: string | null, tenant: string | null, rows: PlanMatchScheduleRow[], planFloor: string | null): PlanLabelMatch {
  const ref = readable(label), name = namedTenant(readable(tenant));
  const none: PlanLabelMatch = { rowId: null, method: null, possible: [], tenantDiffers: false, floorDiffers: false };
  if (!ref && !name) return none;
  const byId = new Map(rows.map(row => [row.id, row]));
  const attempt = (unitRef: string | null, tenantName: string | null, candidates: PlanMatchScheduleRow[]) =>
    resolveEvidenceScheduleMatch({ unit_ref: unitRef, tenant_name: tenantName, property_id: "plan" }, candidates, { propertyId: "plan" });
  const spaced = (row: PlanMatchScheduleRow) => /\s/.test(row.unit_number.trim());
  // A unit reference in the matcher's own terms ("WVL22", "Kiosk C", "5"), as opposed to a name.
  const isUnitRef = (value: string) => !normalizeEvidenceUnitRef(value).startsWith("NAME:");
  const onRef = (unitRef: string) => {
    const whole = attempt(unitRef, null, rows);
    // Leading codes are for a reference. A name tried against the coded rows
    // alone would lose the other rows that carry it.
    if (whole.status === "matched" || !isUnitRef(unitRef)) return whole;
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
  let first = ref ? onRef(ref) : null;
  // "WVL 22" and "WVL-22" are WVL22: the matcher reads a gap or a dash inside a
  // code as part of another code, so the joined form is tried when the printed one finds nothing.
  if (ref && first && first.status !== "matched" && isUnitRef(ref)) {
    const joined = ref.replace(/([A-Za-z])[\s-]+(?=\d)/g, "$1");
    if (joined !== ref) { const again = onRef(joined); if (again.status === "matched") first = again; }
  }
  if (first?.status === "matched" && first.row && first.candidateIds.length === 1) return found(first.row.id, first.method === "tenant" ? "tenant" : "code");
  const printsNumber = !!ref && ref !== name && isUnitRef(ref);
  // A name that reads as a reference ("Future 62") was only tried as one above.
  const second = name && (name !== ref || isUnitRef(name)) ? attempt(null, name, rows) : null;
  if (second?.status === "matched" && second.row && second.candidateIds.length === 1 && !printsNumber && !first?.candidateIds.length) return found(second.row.id, "tenant");
  const possible = [...new Set([...(first?.candidateIds || []), ...(second?.candidateIds || [])])];
  const tied = printsNumber ? first?.candidateIds || [] : possible;
  if (tied.length > 1 && planFloor) {
    const onFloor = tied.filter(id => sameFloor(byId.get(id)?.floor, planFloor));
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
  // What the scan read where each of its outlines was saved.
  const read = new Map<string, StoredCandidate>(((job?.candidates || []) as StoredCandidate[]).filter(c => c?.acceptedOutlineId).map(c => [c.acceptedOutlineId as string, c]));
  return {
    plan: { id: plan.id, propertyId: plan.property_id, floor: plan.floor, width: plan.width ?? null, height: plan.height ?? null, imageKey: plan.storage_key },
    scan: job ? { id: job.id, status: job.status, message: job.message ?? null, completed: job.completed ?? 0, total: job.total ?? 0 } : null,
    outlines: outlines.map(o => {
      const scheduleRowId = o.tenancy_unit_id && live.has(o.tenancy_unit_id) ? o.tenancy_unit_id : null;
      const scanned = read.get(o.id);
      const guess = scheduleRowId ? null : matchPlanLabel(scanned?.label ?? o.label, scanned?.tenant ?? null, free, plan.floor);
      return {
        id: o.id, label: o.label, polygon: o.polygon, scheduleRowId,
        printed: scanned ? { label: String(scanned.label ?? ""), tenant: scanned.tenant ?? null } : null,
        possibleRowIds: guess ? [...new Set([...(guess.rowId ? [guess.rowId] : []), ...guess.possible])] : [],
      };
    }),
    proposals: suggestPlanMatches(openPlanCandidates(stored, outlines), free, plan.floor),
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

// Save one proposal as an outline: linked to a live schedule row of the plan's
// property, or with no row (context). Asking twice for the same proposal with
// the same row hands back the outline it already became; asking for another
// row (or none) is refused, since that outline is already saved.
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
    const saved = candidate.acceptedOutlineId ? outlines.find(o => o.id === candidate.acceptedOutlineId) : undefined;
    if (saved) {
      if ((saved.tenancy_unit_id ?? null) !== rowId) throw new PropertyPlanScanError(409, "This outline has already been saved for another unit. Change that outline on the plan instead.");
      return { outlineId: saved.id, reused: true };
    }
    const shape = planPoints(candidate.polygon);
    if (!isValidPolygon(shape)) throw new PropertyPlanScanError(409, "This proposed outline could not be read. Scan the plan again.");
    const label = (typeof typed === "string" && typed.trim()) || candidate.label;
    if (outlines.some(o => planPolygonsOverlap(planPoints(o.polygon), shape))) {
      throw new PropertyPlanScanError(409, `Something is already drawn where ${label} sits on this plan. Remove that outline first, or mark this one as not a unit.`);
    }
    const link = rowId ? await validatePlanUnitLink(db, plan.property_id, { tenancy_unit_id: rowId }) : { unit_id: null, tenancy_unit_id: null };
    if (rowId && !(await db.query(`SELECT 1 FROM (${ROWS_SQL}) live WHERE live.id = $2`, [plan.property_id, rowId])).rows.length) {
      throw new PropertyPlanScanError(400, "That tenancy schedule row is archived. Choose a live row, or keep the outline as context.");
    }
    if (outlines.some(o => (link.tenancy_unit_id && o.tenancy_unit_id === link.tenancy_unit_id) || (link.unit_id && o.unit_id === link.unit_id))) throw new PropertyPlanScanError(409, ALREADY_DRAWN);
    // An outline kept as context is marked unlinked on purpose, so the older
    // Plans card and the review list do not ask for it to be linked.
    const outlineId: string = (await db.query(`INSERT INTO property_plan_units (plan_id, unit_id, tenancy_unit_id, label, polygon, status_override)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`, [planId, link.unit_id, link.tenancy_unit_id, label, JSON.stringify(candidate.polygon), link.tenancy_unit_id ? null : "unlinked"])).rows[0].id;
    await saveCandidates(db, scanId, candidates.map(c => c.id === candidateId ? { ...c, acceptedOutlineId: outlineId, dismissed: false } : c));
    return { outlineId, reused: false };
  });
}

export type PlanScanSaved = { linked: number; unlinked: number; setAside: number };

// Every proposal still waiting on a locked scan goes on the plan: linked to
// the row the board would suggest (a unit number or a tenant name, a floor
// tie-break, a different tenant or floor on the plan included: the unit
// number is the unit), and unlinked where nothing points at exactly one free
// row. The surest readings are saved first. A proposal over something already
// drawn is left off and marked "not a unit", so the scan leaves nothing waiting.
async function saveOpenProposals(db: Queryable, scanId: string, { plan, candidates, outlines }: { plan: any; candidates: StoredCandidate[]; outlines: SavedOutline[] }): Promise<PlanScanSaved> {
  const rows = (await db.query(ROWS_SQL, [plan.property_id])).rows;
  const live = new Set<string>(rows.map((r: any) => r.id));
  const here = new Set(outlines.map(o => o.tenancy_unit_id).filter((id): id is string => !!id && live.has(id)));
  const proposals = suggestPlanMatches(openPlanCandidates(candidates, outlines), rows.filter((r: any) => !here.has(r.id)).map(matchRow), plan.floor);
  const drawn = outlines.map(o => ({ shape: planPoints(o.polygon), tenancy_unit_id: o.tenancy_unit_id, unit_id: o.unit_id }));
  const saved = new Map<string, string>(), setAside = new Set<string>();
  let linked = 0;
  for (const proposal of [...proposals].sort((a, b) => planSaveOrder(a) - planSaveOrder(b))) {
    const shape = planPoints(proposal.polygon);
    if (drawn.some(o => planPolygonsOverlap(o.shape, shape))) { setAside.add(proposal.id); continue; }
    let link: { unit_id: string | null; tenancy_unit_id: string | null } = { unit_id: null, tenancy_unit_id: null };
    if (proposal.suggestedRowId) {
      const found = await validatePlanUnitLink(db, plan.property_id, { tenancy_unit_id: proposal.suggestedRowId }).catch(() => null);
      // One schedule row, one outline per floor: a row (or the physical unit behind it) drawn already leaves this one unlinked.
      if (found && !drawn.some(o => (found.tenancy_unit_id && o.tenancy_unit_id === found.tenancy_unit_id) || (found.unit_id && o.unit_id === found.unit_id))) link = found;
    }
    // "Unlabelled 7" is the scan's name for an outline where the plan prints nothing.
    const label = proposal.label && !/^unlabelled \d+$/i.test(proposal.label.trim()) ? proposal.label : null;
    const outlineId: string = (await db.query(`INSERT INTO property_plan_units (plan_id, unit_id, tenancy_unit_id, label, polygon)
      VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`, [plan.id, link.unit_id, link.tenancy_unit_id, label, JSON.stringify(proposal.polygon)])).rows[0].id;
    saved.set(proposal.id, outlineId);
    if (link.tenancy_unit_id || link.unit_id) linked++;
    drawn.push({ shape, ...link });
  }
  if (saved.size || setAside.size) await saveCandidates(db, scanId, candidates.map(c => saved.has(c.id) ? { ...c, acceptedOutlineId: saved.get(c.id), dismissed: false } : setAside.has(c.id) ? { ...c, dismissed: true } : c));
  return { linked, unlinked: saved.size - linked, setAside: setAside.size };
}

// A removed outline stays removed: the scan proposal it was saved from is
// marked "not a unit", so it is not offered again. Run inside the delete's own
// transaction (DELETE /api/plan-units/:id, server/property-plans.ts).
export async function setRemovedOutlineAside(db: Queryable, planId: string, outlineId: string): Promise<void> {
  await db.query(`UPDATE property_plan_scans SET updated_at = now(), candidates = (
      SELECT jsonb_agg(CASE WHEN c->>'acceptedOutlineId' = $2 THEN c || '{"dismissed": true}'::jsonb ELSE c END ORDER BY n)
        FROM jsonb_array_elements(candidates) WITH ORDINALITY AS e(c, n))
    WHERE plan_id = $1 AND candidates @> jsonb_build_array(jsonb_build_object('acceptedOutlineId', $2::text))`, [planId, outlineId]);
}

// "Save them" on the Plan tab: the proposals of a scan that finished before
// saving was automatic, or whose save failed.
export async function acceptAllPlanProposals(database: Database, planId: string, scanId: string, canAccess: CanAccess): Promise<PlanScanSaved> {
  return transaction(database, planId, scanId, canAccess, async (db, propertyId) => saveOpenProposals(db, scanId, await lockScan(db, planId, scanId, propertyId)));
}

// The scan runner's last step (server/property-plan-scanning.ts): the scan is
// marked ready and what it found is saved in the same transaction, under the
// plan's lock, so a finished scan is never seen with its outlines still
// waiting. A failed save leaves the scan ready with its proposals open, for
// "Save them". Null when the scan stopped or the plan's image changed while it ran.
export async function completePlanScan(database: Database, scanId: string, planId: string, candidates: PropertyPlanCandidate[], message: string): Promise<PlanScanSaved | null> {
  const db = await database.connect();
  try {
    await db.query("BEGIN");
    const plan = (await db.query("SELECT * FROM property_plans WHERE id = $1 FOR UPDATE", [planId])).rows[0];
    const marked = plan ? (await db.query(`UPDATE property_plan_scans SET status = 'ready', candidates = $2::jsonb, message = $3, completed = total, updated_at = now()
      WHERE id = $1 AND plan_id = $4 AND image_key = $5 AND status = 'running' AND updated_at > now() - interval '3 minutes' AND created_at > now() - interval '30 minutes'
      RETURNING id`, [scanId, JSON.stringify(candidates), message, planId, plan.storage_key])).rows.length > 0 : false;
    if (!marked) { await db.query("ROLLBACK"); return null; }
    let saved: PlanScanSaved = { linked: 0, unlinked: 0, setAside: 0 };
    await db.query("SAVEPOINT scan_outlines");
    try {
      saved = await saveOpenProposals(db, scanId, await lockScan(db, planId, scanId, plan.property_id));
      await db.query("RELEASE SAVEPOINT scan_outlines");
    } catch (error: any) {
      await db.query("ROLLBACK TO SAVEPOINT scan_outlines");
      console.warn("[plan match] the scan finished but its outlines were not saved:", error?.message);
    }
    await db.query("COMMIT");
    return saved;
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
  finally { db.release(); }
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

router.post("/api/plans/:planId/match/accept-all", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await acceptAllPlanProposals(pool, String(req.params.planId), String(req.body?.scanId || ""), access(req)));
  } catch (error) { fail(res, error, "Could not save the scan's outlines"); }
});

export default router;
