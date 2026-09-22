import type { PlanScanReview, ScanReviewApplyRequest, ScanReviewAssignment, ScanReviewCandidate, ScanReviewResponse, ScanReviewUnit } from "@shared/plan-scan-review";
import { interiorPoint, isValidPolygon, pointInPolygon, type PlanPoint } from "@shared/plan-geometry";
import { planPolygonsOverlap } from "./plan-unit-detection";

type Queryable = { query: (text: string, values?: any[]) => Promise<any> };
type Database = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };
type StoredScanReview = PlanScanReview & {
  applicationRequests: Record<string, { unitId: string | null; newUnitRef: string | null }>;
  clearedSnapshots: Record<string, ScanReviewUnit>;
};

export class PlanScanReviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const planScanReviewKey = (planId: string, jobId: string) => `evidence-plans/${planId}/scans/${jobId}.json`;

export function scanUnitSnapshot(row: any): ScanReviewUnit {
  return { id: row.id, unitRef: row.unit_ref, tenantName: row.tenant_name ?? null,
    polygon: row.polygon ?? null, dot: row.dot ?? null, source: row.source ?? null };
}

function pointValue(point: PlanPoint | null): unknown {
  return point ? [point.x, point.y] : null;
}

export function scanUnitMatchesSnapshot(row: any, snapshot: ScanReviewUnit): boolean {
  const unit = scanUnitSnapshot(row);
  return unit.id === snapshot.id && unit.unitRef === snapshot.unitRef && unit.tenantName === snapshot.tenantName
    && unit.source === snapshot.source && JSON.stringify(pointValue(unit.dot)) === JSON.stringify(pointValue(snapshot.dot))
    && JSON.stringify(unit.polygon?.map(pointValue) ?? null) === JSON.stringify(snapshot.polygon?.map(pointValue) ?? null);
}

export function buildPlanScanReview(input: {
  planId: string; levelId: string; jobId: string; backgroundKey: string;
  candidates: ScanReviewCandidate[]; existingUnits: any[];
}): StoredScanReview {
  return { version: 1, planId: input.planId, levelId: input.levelId, jobId: input.jobId,
    backgroundKey: input.backgroundKey, createdAt: new Date().toISOString(),
    summary: { detected: input.candidates.length,
      added: input.candidates.filter(candidate => candidate.status === "added").length,
      refined: input.candidates.filter(candidate => candidate.status === "refined").length,
      current: input.candidates.filter(candidate => candidate.status === "current").length,
      needsReview: input.candidates.filter(candidate => candidate.status === "review").length },
    candidates: input.candidates, existingUnits: input.existingUnits.map(scanUnitSnapshot),
    applied: {}, clearedUnitIds: [], applicationRequests: {}, clearedSnapshots: {} };
}

export function publicPlanScanReview(review: StoredScanReview): PlanScanReview {
  const { applicationRequests: _requests, clearedSnapshots: _snapshots, ...publicReview } = review;
  return publicReview;
}

export async function persistPlanScanReview(db: Queryable, review: StoredScanReview): Promise<void> {
  const data = Buffer.from(JSON.stringify(review));
  await db.query(`INSERT INTO file_storage (storage_key, data, content_type, original_name, size)
    VALUES ($1, $2, 'application/json', 'plan-scan-review.json', $3)
    ON CONFLICT (storage_key) DO UPDATE SET data = $2, size = $3`, [planScanReviewKey(review.planId, review.jobId), data, data.length]);
}

function parseScanReview(data: Buffer, planId: string, jobId: string, levelId: string): StoredScanReview {
  let review: StoredScanReview;
  try { review = JSON.parse(data.toString("utf8")); }
  catch { throw new PlanScanReviewError(409, "This scan result could not be read. Scan the level again."); }
  if (!review || review.version !== 1 || review.planId !== planId || review.jobId !== jobId || review.levelId !== levelId
    || typeof review.backgroundKey !== "string" || !Array.isArray(review.candidates) || !Array.isArray(review.existingUnits)
    || !review.applied || !review.applicationRequests || !review.clearedSnapshots || !Array.isArray(review.clearedUnitIds)) {
    throw new PlanScanReviewError(409, "This scan result is incomplete. Scan the level again.");
  }
  return review;
}

async function requirePlanAccess(db: Queryable, planId: string, canEditProperty: (propertyId: string | null) => Promise<boolean>, lock = false): Promise<void> {
  if (!uuid.test(planId)) throw new PlanScanReviewError(400, "Invalid plan ID");
  const plan = (await db.query(`SELECT id, property_id FROM evidence_plans WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [planId])).rows[0];
  if (!plan) throw new PlanScanReviewError(404, "Plan not found");
  if (!await canEditProperty(plan.property_id)) throw new PlanScanReviewError(403, "Not available for this account");
}

export async function readPlanScanReview(db: Queryable, planId: string, options: { levelId: string; jobId?: string },
  canEditProperty: (propertyId: string | null) => Promise<boolean>): Promise<ScanReviewResponse> {
  await requirePlanAccess(db, planId, canEditProperty);
  if (!uuid.test(options.levelId) || options.jobId && !uuid.test(options.jobId)) throw new PlanScanReviewError(400, "Choose a valid level and scan");
  const level = (await db.query("SELECT id, background_key FROM evidence_plan_levels WHERE id = $1 AND plan_id = $2", [options.levelId, planId])).rows[0];
  if (!level) throw new PlanScanReviewError(404, "Plan level not found");
  const job = (await db.query(`SELECT id FROM evidence_plan_jobs WHERE plan_id = $1 AND level_id = $2
    AND kind = 'detect' AND status = 'done' ${options.jobId ? "AND id = $3" : ""}
    ORDER BY created_at DESC, id DESC LIMIT 1`, options.jobId ? [planId, level.id, options.jobId] : [planId, level.id])).rows[0];
  if (!job && options.jobId) throw new PlanScanReviewError(404, "Completed scan not found on this level");
  if (!job) return { review: null, legacyNeedsRescan: false };
  const file = (await db.query("SELECT data FROM file_storage WHERE storage_key = $1", [planScanReviewKey(planId, job.id)])).rows[0];
  if (!file) return { review: null, legacyNeedsRescan: true };
  const review = parseScanReview(file.data, planId, job.id, level.id);
  if (review.backgroundKey !== level.background_key) throw new PlanScanReviewError(409, "The plan image changed after this scan. Close this review and refresh units to scan the current image.");
  return { review: publicPlanScanReview(review), legacyNeedsRescan: false };
}

export function validateScanReviewApplyRequest(body: any): ScanReviewApplyRequest {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.assignments)
    || body.assignments.length > 1000 || body.clearOutlineUnitIds !== undefined && !Array.isArray(body.clearOutlineUnitIds)) {
    throw new PlanScanReviewError(400, "Choose the scan outlines to apply");
  }
  const clearIds: unknown[] = body.clearOutlineUnitIds ?? [];
  if (clearIds.length > 1000 || !body.assignments.length && !clearIds.length) throw new PlanScanReviewError(400, "Choose at least one outline to apply or clear");
  const candidates = new Set<string>(), targets = new Set<string>();
  const assignments = body.assignments.map((assignment: any): ScanReviewAssignment => {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)
      || typeof assignment.candidateId !== "string" || !/^candidate-\d+$/.test(assignment.candidateId)
      || assignment.unitId !== null && (typeof assignment.unitId !== "string" || !uuid.test(assignment.unitId))
      || assignment.newUnitRef !== undefined && (typeof assignment.newUnitRef !== "string" || !assignment.newUnitRef.trim() || assignment.newUnitRef.trim().length > 80)) {
      throw new PlanScanReviewError(400, "Choose a valid candidate, unit and reference");
    }
    if (assignment.unitId !== null && assignment.newUnitRef !== undefined) throw new PlanScanReviewError(400, "Replacing an outline keeps the saved unit reference");
    if (candidates.has(assignment.candidateId) || assignment.unitId !== null && targets.has(assignment.unitId)) {
      throw new PlanScanReviewError(400, "Use each scan outline and saved unit only once");
    }
    candidates.add(assignment.candidateId);
    if (assignment.unitId !== null) targets.add(assignment.unitId);
    return { candidateId: assignment.candidateId, unitId: assignment.unitId,
      ...(assignment.newUnitRef !== undefined ? { newUnitRef: assignment.newUnitRef.trim() } : {}) };
  });
  const clearOutlineUnitIds = clearIds.map((id): string => {
    if (typeof id !== "string" || !uuid.test(id) || targets.has(id)) throw new PlanScanReviewError(400, "Each cleared outline must be a different saved unit");
    targets.add(id);
    return id;
  });
  return { assignments, clearOutlineUnitIds };
}

export async function applyPlanScanReview(database: Database, planId: string, jobId: string, body: unknown,
  canEditProperty: (propertyId: string | null) => Promise<boolean>, normaliseUnitRef: (ref: string) => string): Promise<{
    review: PlanScanReview; applied: PlanScanReview["applied"]; clearedUnitIds: string[];
  }> {
  const request = validateScanReviewApplyRequest(body);
  if (!uuid.test(planId) || !uuid.test(jobId)) throw new PlanScanReviewError(400, "Invalid plan or scan ID");
  const db = await database.connect();
  try {
    await db.query("BEGIN");
    await requirePlanAccess(db, planId, canEditProperty);
    const beforeJob = (await db.query("SELECT level_id FROM evidence_plan_jobs WHERE id = $1 AND plan_id = $2 AND kind = 'detect'", [jobId, planId])).rows[0];
    if (!beforeJob?.level_id) throw new PlanScanReviewError(404, "Scan not found on this plan");
    // Keep the same lock order as scans, cropping and manual unit edits.
    const level = (await db.query("SELECT id, background_key FROM evidence_plan_levels WHERE id = $1 AND plan_id = $2 FOR UPDATE", [beforeJob.level_id, planId])).rows[0];
    if (!level) throw new PlanScanReviewError(404, "Plan level not found");
    const job = (await db.query("SELECT id, level_id, status FROM evidence_plan_jobs WHERE id = $1 AND plan_id = $2 AND kind = 'detect' FOR UPDATE", [jobId, planId])).rows[0];
    if (!job || job.level_id !== level.id || job.status !== "done") throw new PlanScanReviewError(409, "Wait for this level's scan to finish before reviewing outlines");
    const file = (await db.query("SELECT data FROM file_storage WHERE storage_key = $1 FOR UPDATE", [planScanReviewKey(planId, jobId)])).rows[0];
    if (!file) throw new PlanScanReviewError(409, "This older scan did not save its proposed outlines. Scan the level again to review them.");
    const review = parseScanReview(file.data, planId, jobId, level.id);
    if (level.background_key !== review.backgroundKey) throw new PlanScanReviewError(409, "The plan image changed after this scan. Scan the current image before applying outlines.");
    const units = (await db.query("SELECT * FROM evidence_plan_units WHERE plan_id = $1 AND level_id = $2 ORDER BY id FOR UPDATE", [planId, level.id])).rows;
    await requirePlanAccess(db, planId, canEditProperty, true);
    const unitById = new Map<string, any>(units.map((unit: any) => [unit.id, unit]));
    const snapshotById = new Map(review.existingUnits.map(unit => [unit.id, unit]));
    const candidateById = new Map(review.candidates.map(candidate => [candidate.id, candidate]));
    const pending: { candidate: ScanReviewCandidate; assignment: ScanReviewAssignment; target: any; ref: string }[] = [];
    const result: PlanScanReview["applied"] = {};
    const refs = new Set<string>();
    for (const assignment of request.assignments) {
      const candidate = candidateById.get(assignment.candidateId);
      if (!candidate || candidate.status !== "review") throw new PlanScanReviewError(400, "Choose an outline awaiting review from this scan");
      const rawRef = assignment.newUnitRef ?? candidate.unitRef;
      if (assignment.unitId === null && (typeof rawRef !== "string" || !rawRef.trim() || rawRef.trim().length > 80)) {
        throw new PlanScanReviewError(400, "Enter a unit reference between 1 and 80 characters");
      }
      const requested = { unitId: assignment.unitId, newUnitRef: assignment.unitId === null ? rawRef.trim() : null };
      const applied = review.applied[candidate.id];
      if (applied) {
        const original = review.applicationRequests[candidate.id];
        if (!original || original.unitId !== requested.unitId || original.newUnitRef !== requested.newUnitRef) {
          throw new PlanScanReviewError(409, "This scan outline has already been applied to a different unit or reference");
        }
        result[candidate.id] = applied;
        continue;
      }
      if (!isValidPolygon(candidate.polygon)) throw new PlanScanReviewError(409, "This scan outline is invalid. Scan the level again.");
      let target: any = null;
      if (assignment.unitId !== null) {
        target = unitById.get(assignment.unitId);
        const snapshot = snapshotById.get(assignment.unitId);
        if (!target || !snapshot) throw new PlanScanReviewError(409, "The selected unit is no longer on this scan's level. Reload and review it again.");
        if (target.source === "manual") throw new PlanScanReviewError(409, "This unit has a manually reviewed outline. Use its outline editor to change it.");
        if (!scanUnitMatchesSnapshot(target, snapshot)) throw new PlanScanReviewError(409, "The selected unit changed after this scan. Scan the level again before replacing its outline.");
        if (Object.values(review.applied).some(previous => previous.unitId === target.id)) throw new PlanScanReviewError(409, "Another scan outline has already been assigned to this unit");
      }
      const ref = target ? target.unit_ref : requested.newUnitRef!;
      const normalized = normaliseUnitRef(ref);
      if (!normalized || refs.has(normalized)) throw new PlanScanReviewError(400, "Give each new or selected unit a distinct unit reference");
      if (!target && units.some((unit: any) => normaliseUnitRef(unit.unit_ref) === normalized)) throw new PlanScanReviewError(409, "That reference already belongs to a saved unit. Choose that unit or enter a different reference.");
      refs.add(normalized);
      pending.push({ candidate, assignment, target, ref });
    }
    const clearing: any[] = [];
    for (const id of request.clearOutlineUnitIds || []) {
      const unit = unitById.get(id);
      if (review.clearedUnitIds.includes(id)) {
        if (!unit || !review.clearedSnapshots[id] || !scanUnitMatchesSnapshot(unit, review.clearedSnapshots[id])) throw new PlanScanReviewError(409, "A previously cleared unit changed. Reload the plan before continuing.");
        continue;
      }
      const snapshot = snapshotById.get(id);
      if (!unit || !snapshot || !scanUnitMatchesSnapshot(unit, snapshot)) throw new PlanScanReviewError(409, "The unit to clear changed after this scan. Scan the level again before clearing its outline.");
      if (unit.source !== "ai") throw new PlanScanReviewError(409, "Only old AI outlines can be cleared through scan review");
      if (!isValidPolygon(unit.polygon)) throw new PlanScanReviewError(400, "This unit has no saved outline to clear");
      clearing.push(unit);
    }
    for (const [index, item] of pending.entries()) {
      if (units.some((unit: any) => unit.source === "manual" && planPolygonsOverlap(item.candidate.polygon, unit.polygon))) {
        throw new PlanScanReviewError(409, "A proposed outline overlaps a manually reviewed unit. Correct the boundary before applying it.");
      }
      if (pending.slice(index + 1).some(other => planPolygonsOverlap(item.candidate.polygon, other.candidate.polygon))) {
        throw new PlanScanReviewError(409, "Two chosen scan outlines overlap. Apply only the correct boundary for each unit.");
      }
    }
    for (const { candidate, assignment, target, ref } of pending) {
      const preferred = target ? target.dot : candidate.dot;
      const dot = preferred && Number.isFinite(preferred.x) && Number.isFinite(preferred.y) && pointInPolygon(preferred, candidate.polygon)
        ? preferred : interiorPoint(candidate.polygon);
      let unitId: string;
      if (target) {
        await db.query("UPDATE evidence_plan_units SET polygon = $1, dot = $2, source = 'manual', updated_at = now() WHERE id = $3", [JSON.stringify(candidate.polygon), JSON.stringify(dot), target.id]);
        unitId = target.id;
      } else {
        const inserted = (await db.query(`INSERT INTO evidence_plan_units (plan_id, level_id, unit_ref, tenant_name, polygon, dot, source)
          VALUES ($1, $2, $3, $4, $5, $6, 'manual') RETURNING id`, [planId, level.id, ref, candidate.tenantName, JSON.stringify(candidate.polygon), JSON.stringify(dot)])).rows[0];
        unitId = inserted.id;
      }
      review.applied[candidate.id] = { unitId, action: target ? "replaced" : "created" };
      review.applicationRequests[candidate.id] = { unitId: assignment.unitId, newUnitRef: target ? null : ref };
      result[candidate.id] = review.applied[candidate.id];
    }
    for (const unit of clearing) {
      await db.query("UPDATE evidence_plan_units SET polygon = NULL, source = 'manual', updated_at = now() WHERE id = $1", [unit.id]);
      review.clearedUnitIds.push(unit.id);
      review.clearedSnapshots[unit.id] = scanUnitSnapshot({ ...unit, polygon: null, source: "manual" });
    }
    if (pending.length || clearing.length) {
      await persistPlanScanReview(db, review);
      await db.query("UPDATE evidence_plans SET updated_at = now() WHERE id = $1", [planId]);
    }
    await db.query("COMMIT");
    return { review: publicPlanScanReview(review), applied: result, clearedUnitIds: request.clearOutlineUnitIds || [] };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
