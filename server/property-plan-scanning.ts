import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { getFile } from "./file-storage";
import { clientBlockedForProperty, isClientRequestUser } from "./company-scope";
import { tracePlanUnit } from "./plan-unit-detection";
import { queryPickableUnits } from "./property-plan-links";
import { propertyPlanRaster, scanPropertyPlanImage } from "./property-plan-scan";
import { applyPropertyPlanScan, expirePropertyPlanScans, PropertyPlanScanError, requirePropertyPlan, startPropertyPlanScan } from "./property-plan-scan-store";

const router = Router();
const access = (req: Request) => async (propertyId: string) => !await clientBlockedForProperty(req, propertyId);
function fail(res: Response, error: any) { res.status(error?.status || 500).json({ error: error?.message || "Plan operation failed" }); }
function publicJob(job: any) {
  if (!job) return null;
  return { id: job.id, status: job.status, total: job.total, completed: job.completed, message: job.message, candidates: job.candidates || [] };
}

// Tracing is local image analysis, available to every authorised property editor.
// It returns a preview; the normal outline endpoint saves it after review/linking.
router.post("/api/plans/:planId/trace-unit", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await requirePropertyPlan(pool, String(req.params.planId), access(req));
    const { x, y } = req.body || {};
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new PropertyPlanScanError(400, "Click inside a unit on the plan");
    if (plan.is_geo) throw new PropertyPlanScanError(400, "Tracing needs an image plan");
    const file = await getFile(plan.storage_key);
    if (!file) throw new PropertyPlanScanError(404, "Plan image is missing");
    const traced = tracePlanUnit(await propertyPlanRaster(file.data), { x, y });
    if (!traced) throw new PropertyPlanScanError(422, "No reliable enclosed boundary at this point. Try a clear area inside the unit, or use Draw unit.");
    res.json({ polygon: { points: traced.polygon.map(p => [p.x, p.y]) }, imageKey: plan.storage_key });
  } catch (error) { fail(res, error); }
});

router.get("/api/plans/:planId/scan", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = await requirePropertyPlan(pool, String(req.params.planId), access(req));
    await expirePropertyPlanScans(pool, plan.id);
    const job = (await pool.query("SELECT * FROM property_plan_scans WHERE plan_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [plan.id])).rows[0];
    res.json({ job: publicJob(job) });
  } catch (error) { fail(res, error); }
});

router.post("/api/plans/:planId/scan", requireAuth, async (req: Request, res: Response) => {
  try {
    if (await isClientRequestUser(req)) throw new PropertyPlanScanError(403, "AI scanning is available to the BGP team. You can trace or draw units on your own properties.");
    if (!process.env.ANTHROPIC_API_KEY) throw new PropertyPlanScanError(503, "AI plan scanning is not configured. You can still trace or draw units.");
    const { job, plan, reused } = await startPropertyPlanScan(pool, String(req.params.planId), access(req));
    if (!reused) void runPropertyPlanScan(job, plan);
    res.status(202).json({ job: publicJob(job) });
  } catch (error) { fail(res, error); }
});

router.post("/api/plans/:planId/scans/:jobId/apply", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await applyPropertyPlanScan(pool, String(req.params.planId), String(req.params.jobId), req.body, access(req)));
  } catch (error) { fail(res, error); }
});

// Old cached clients must never invoke the retired rectangle writer.
router.post("/api/plans/:planId/auto-detect", requireAuth, async (_req: Request, res: Response) => {
  res.status(409).json({ error: "Plan scanning now includes boundary review. Refresh the page and choose Scan units." });
});

async function runPropertyPlanScan(job: any, plan: any) {
  let inactive = false;
  const checkpoint = async (message: string, completed: number, total: number) => {
    if (inactive) throw new Error("This scan has stopped. Start a new scan.");
    const result = await pool.query(`UPDATE property_plan_scans SET message=$2, completed=$3, total=$4, updated_at=now()
      WHERE id=$1 AND status='running' AND updated_at > now() - interval '3 minutes' AND created_at > now() - interval '30 minutes' RETURNING id`, [job.id, message, completed, total]);
    if (!result.rows.length) { inactive = true; throw new Error("This scan has stopped. Start a new scan."); }
  };
  // Provider calls have explicit 75-second timeouts. Heartbeats keep in-flight
  // workers live; the hard deadline still caps the entire job at 30 minutes.
  const heartbeat = setInterval(() => {
    void pool.query(`UPDATE property_plan_scans SET updated_at=now() WHERE id=$1 AND status='running'
      AND updated_at > now() - interval '3 minutes' AND created_at > now() - interval '30 minutes' RETURNING id`, [job.id])
      .then(result => { if (!result.rows.length) inactive = true; }).catch(() => { inactive = true; });
  }, 30000);
  heartbeat.unref();
  try {
    const file = await getFile(plan.storage_key);
    if (!file) throw new Error("The plan image is missing");
    const options = await queryPickableUnits(pool, plan.property_id);
    const existing = (await pool.query("SELECT polygon FROM property_plan_units WHERE plan_id=$1", [plan.id])).rows;
    const result = await scanPropertyPlanImage(file.data, options, existing, checkpoint);
    // No outline writes here. The apply transaction re-checks the current plan,
    // links and overlaps, including drawings added while the scan was running.
    if (inactive) throw new Error("This scan has stopped. Start a new scan.");
    const saved = await pool.query(`UPDATE property_plan_scans s SET status='ready', candidates=$2::jsonb, message=$3, completed=total, updated_at=now()
      WHERE s.id=$1 AND s.status='running' AND s.updated_at > now() - interval '3 minutes' AND s.created_at > now() - interval '30 minutes'
      AND EXISTS (SELECT 1 FROM property_plans p WHERE p.id=s.plan_id AND p.storage_key=s.image_key) RETURNING s.id`, [job.id, JSON.stringify(result.candidates), result.message]);
    if (!saved.rows.length) throw new Error("The plan changed or this scan expired. Start a new scan. Saved outlines are unchanged.");
  } catch (error: any) {
    await pool.query("UPDATE property_plan_scans SET status='failed', message=$2, updated_at=now() WHERE id=$1 AND status='running'", [job.id, error?.message || "Scan failed. Saved outlines are unchanged."]).catch(() => {});
  } finally { clearInterval(heartbeat); }
}

export default router;
