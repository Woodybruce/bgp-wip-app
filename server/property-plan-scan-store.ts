import type { PropertyPlanCandidate, PropertyPlanScanAssignment } from "@shared/property-plan-scan";
import { isValidPolygon } from "@shared/plan-geometry";
import { planPolygonsOverlap } from "./plan-unit-detection";
import { planPoints } from "./property-plan-scan";
import { validatePlanUnitLink } from "./property-plan-links";

type Queryable = { query: (sql: string, values?: any[]) => Promise<any> };
type Database = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };
export class PropertyPlanScanError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validPlanId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

export async function requirePropertyPlan(db: Queryable, planId: string, canAccess: (propertyId: string) => Promise<boolean>, lock = false) {
  if (!validPlanId(planId)) throw new PropertyPlanScanError(400, "Invalid plan ID");
  const plan = (await db.query(`SELECT * FROM property_plans WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [planId])).rows[0];
  if (!plan) throw new PropertyPlanScanError(404, "Plan not found");
  if (!await canAccess(plan.property_id)) throw new PropertyPlanScanError(403, "Not available for this account");
  return plan;
}

export async function expirePropertyPlanScans(db: Queryable, planId: string) {
  await db.query(`UPDATE property_plan_scans SET status = 'failed', message = 'This scan stopped or expired. Start a new scan. Saved outlines are unchanged.', updated_at = now()
    WHERE plan_id = $1 AND status = 'running' AND (updated_at < now() - interval '3 minutes' OR created_at < now() - interval '30 minutes')`, [planId]);
}

export async function startPropertyPlanScan(database: Database, planId: string, canAccess: (propertyId: string) => Promise<boolean>) {
  const authorisedPlan = await requirePropertyPlan(database, planId, canAccess);
  const db = await database.connect();
  try {
    await db.query("BEGIN");
    const plan = await requirePropertyPlan(db, planId, async propertyId => propertyId === authorisedPlan.property_id, true);
    if (plan.is_geo) throw new PropertyPlanScanError(400, "Boundary scanning needs an image plan");
    await expirePropertyPlanScans(db, planId);
    const running = (await db.query("SELECT * FROM property_plan_scans WHERE plan_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1", [planId])).rows[0];
    const job = running || (await db.query(`INSERT INTO property_plan_scans (plan_id, image_key, status, message)
      VALUES ($1, $2, 'running', 'Preparing plan scan') RETURNING *`, [planId, plan.storage_key])).rows[0];
    await db.query("COMMIT");
    return { job, plan, reused: !!running };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export function validatePropertyScanAssignments(body: any): PropertyPlanScanAssignment[] {
  if (!Array.isArray(body?.assignments) || !body.assignments.length || body.assignments.length > 400) throw new PropertyPlanScanError(400, "Choose between 1 and 400 outlines to save");
  const ids = new Set<string>();
  return body.assignments.map((row: any) => {
    if (!row || typeof row.candidateId !== "string" || !/^candidate-\d+$/.test(row.candidateId) || ids.has(row.candidateId)
      || row.tenancy_unit_id != null && (typeof row.tenancy_unit_id !== "string" || !row.tenancy_unit_id.trim() || row.tenancy_unit_id.length > 100)
      || row.unit_id != null && (typeof row.unit_id !== "string" || !row.unit_id.trim() || row.unit_id.length > 100)
      || typeof row.label !== "string" || !row.label.trim() || row.label.trim().length > 160) {
      throw new PropertyPlanScanError(400, "Each outline needs a unique candidate and a label of up to 160 characters");
    }
    ids.add(row.candidateId);
    return { candidateId: row.candidateId, tenancy_unit_id: row.tenancy_unit_id ?? null, unit_id: row.unit_id ?? null, label: row.label.trim() };
  }).sort((a: PropertyPlanScanAssignment, b: PropertyPlanScanAssignment) => a.candidateId.localeCompare(b.candidateId));
}

export async function applyPropertyPlanScan(database: Database, planId: string, jobId: string, body: unknown,
  canAccess: (propertyId: string) => Promise<boolean>) {
  const assignments = validatePropertyScanAssignments(body);
  if (!validPlanId(jobId)) throw new PropertyPlanScanError(400, "Invalid scan ID");
  const authorisedPlan = await requirePropertyPlan(database, planId, canAccess);
  const db = await database.connect();
  try {
    await db.query("BEGIN");
    // Every plan-unit write takes this same lock, including manual drawings.
    const plan = await requirePropertyPlan(db, planId, async propertyId => propertyId === authorisedPlan.property_id, true);
    const job = (await db.query("SELECT * FROM property_plan_scans WHERE id = $1 AND plan_id = $2 FOR UPDATE", [jobId, planId])).rows[0];
    if (!job) throw new PropertyPlanScanError(404, "Scan not found on this plan");
    if (job.image_key !== plan.storage_key) throw new PropertyPlanScanError(409, "The plan image changed. Scan the current image before saving outlines.");
    if (job.status === "applied") {
      if (JSON.stringify(validatePropertyScanAssignments({ assignments: job.applied_request })) !== JSON.stringify(assignments)) throw new PropertyPlanScanError(409, "This review was already saved with different choices. Start a new scan to add more outlines.");
      await db.query("COMMIT");
      return { created: job.applied_count, reused: true };
    }
    if (job.status !== "ready") throw new PropertyPlanScanError(409, "Wait for this scan to finish before saving outlines");
    const candidates = new Map<string, PropertyPlanCandidate>((job.candidates || []).map((row: PropertyPlanCandidate) => [row.id, row]));
    const existing = (await db.query("SELECT * FROM property_plan_units WHERE plan_id = $1 ORDER BY id FOR UPDATE", [planId])).rows;
    const pending: { polygon: PropertyPlanCandidate["polygon"]; unit_id: string | null; tenancy_unit_id: string | null; label: string }[] = [];
    for (const assignment of assignments) {
      const candidate = candidates.get(assignment.candidateId);
      if (!candidate || !isValidPolygon(planPoints(candidate.polygon))) throw new PropertyPlanScanError(409, "A proposed outline could not be read. Scan the plan again.");
      if ([...existing, ...pending].some(row => planPolygonsOverlap(planPoints(row.polygon), planPoints(candidate.polygon)))) {
        throw new PropertyPlanScanError(409, `The outline for ${assignment.label} overlaps another outline. Check the plan and choose only the correct boundaries.`);
      }
      const link = await validatePlanUnitLink(db, plan.property_id, assignment);
      if ([...existing, ...pending].some(row => (link.tenancy_unit_id && row.tenancy_unit_id === link.tenancy_unit_id)
        || (link.unit_id && row.unit_id === link.unit_id))) throw new PropertyPlanScanError(409, `A selected tenancy already has an outline on this floor. Check ${assignment.label}.`);
      pending.push({ polygon: candidate.polygon, ...link, label: assignment.label });
    }
    for (const row of pending) await db.query(`INSERT INTO property_plan_units (plan_id, unit_id, tenancy_unit_id, label, polygon)
      VALUES ($1, $2, $3, $4, $5::jsonb)`, [planId, row.unit_id, row.tenancy_unit_id, row.label, JSON.stringify(row.polygon)]);
    await db.query(`UPDATE property_plan_scans SET status = 'applied', applied_request = $2::jsonb, applied_count = $3,
      message = $4, updated_at = now() WHERE id = $1`, [jobId, JSON.stringify(assignments), pending.length, `${pending.length} reviewed outlines saved.`]);
    await db.query("COMMIT");
    return { created: pending.length, reused: false };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
