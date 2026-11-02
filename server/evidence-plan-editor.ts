import { createHash } from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import multer from "multer";
import { EVIDENCE_SHARE_TOKEN, EVIDENCE_SHARE_UUID, EvidencePlanShareError, sharedFileType } from "./evidence-plan-share-policy";
import { ensureEvidencePlanShareSchema, type EvidenceShareDatabase, type EvidenceShareClient } from "./evidence-plan-sharing";
import { runWithEvidencePlanEditorAccess, trackEvidencePlanEditorOperation } from "./evidence-plan-editor-access";

export interface ScopedEditorDependencies {
  db: EvidenceShareDatabase;
  downstream: RequestHandler;
  ensureSchema?(): Promise<void>;
  getFile(key: string): Promise<{ data: Buffer; contentType: string; originalName?: string | null } | null>;
  importTenancyWorkbook?(db: any, propertyId: string, data: Buffer, options: { clearExisting: false }): Promise<any>;
  originalPlanPdfKey?(key: string | null): string | null;
  hideRed?(data: Buffer, key: string): Promise<Buffer>;
}
export const editorBackgroundRevision = (key: unknown) => typeof key === "string" && key ? createHash("sha256").update(key).digest("hex") : null;
const missing = () => new EvidencePlanShareError(404, "Shared plan or item not found");
const fields = new Set(`id plan_id name property_name background_width background_height sort_order created_at updated_at dot_colours level_id unit_ref tenant_name polygon dot lease_start lease_expiry break_date review_date outside_lt_act erv passing_rent sqft notes source tenancy_unit_id ts_linked ts_match_status ts_match_reason ts_row_id ts_row_updated_at ts_candidate_ids ts_equivalent_ids ts_matched_at unit_id tenant transaction_type transaction_date size_sqft zone_a net_zone_a itza headline_rent net_effective term concession trading_name unit_number next_review_date erv_pa passing_rent_pa nia_sqft gia_sqft status kind total_docs done_docs pages extracted created linked detected added refined current needsReview reviewSummary jobId reused legacyNeedsRescan version planId levelId createdAt summary candidates existingUnits applied clearedUnitIds assignments clearOutlineUnitIds candidateId unitId newUnitRef unitRef tenantName suggestedUnitIds reason action x y ok success imported matched unmatched skipped warnings fileName duplicate candidateIndex unitMismatch sheetName sourceLabel transactionType transactionDate sizeSqft zoneA netZoneA headlineRent netEffective leaseExpiry breakDate reviewDate passingRent total rows count unitsUpdated entriesLinked unit_norm ts_match_method ts_unit_ref ts_link_status ts_link_reason ts_equivalent_row_ids ts_conflicts field label width height remapped adopted docs found reviewRows needsReview skippedExisting mirrorNeedsReview skippedOtherProperties headerRow mappedColumns unmatchedHeaders message sourceRow unitNumber tradingName floorLevel premises existingIds differingFields incomingValues values floor_level grouping permitted_use`.split(" "));
// Canonical schedule identity/version and authored facts needed by the editor
// and workbook comparison. CRM/company/deal/board references stay server-side.
const scheduleFields = new Set(`id updated_at unit_number tenant_name trading_name grouping floor_level premises permitted_use status am_initiative tenant_mix lease_start break_date break_type break_details break_notice lease_expiry term_years unexpired_term_break unexpired_term next_review_date outside_lt_act measurement_type area_basement_gia area_ground_gia area_first_gia area_other_gia area_basement_nia area_ground_nia area_first_nia area_first_sales_nia area_other_nia area_ground_itza gia_sqft nia_sqft itza_sqft units_applied passing_rent_pa marketing_rent_pa turnover_rent_payable erv_profile erv_pa rent_free_value capex_value rateable_value rates_payable service_charge service_charge_cap insurance shortfall_liability rental_shortfalls topped_up_noi noi_pa comments leasing_comments target_tenants underwriting_comments epc_rating rent_psf turnover_percent blended_erv landlord_break_date credit_rating deposit_held arrears_balance`.split(" "));
function scheduleFacts(value: any): any {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => scheduleFields.has(key)).map(([key, item]) => [key,
    item === null || ["string", "number", "boolean"].includes(typeof item) || item instanceof Date ? item
      : Array.isArray(item) ? item.filter(part => typeof part === "string" || typeof part === "number") : null]));
}
const containers = new Set(["plan", "levels", "units", "entries", "schedule_rows", "jobs", "review", "entry", "unit", "result"]);
/** Editor DTO retains plan content and geometry, but never returns raw storage or CRM records. */
export function presentScopedEditorPayload(value: any, base: string): any {
  if (Array.isArray(value)) return value.map(row => presentScopedEditorPayload(row, base));
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const result: any = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "schedule_rows") result.schedule_rows = Array.isArray(item) ? item.map(scheduleFacts) : [];
    else if (key === "values" || key === "incomingValues") result[key] = scheduleFacts(item);
    else if (["differingFields", "mappedColumns"].includes(key)) result[key] = Array.isArray(item) ? item.filter(field => typeof field === "string" && scheduleFields.has(field)) : [];
    else if (key === "background_key" || key === "backgroundKey") result[key] = editorBackgroundRevision(item);
    else if (key === "property_id") result.property_id = item ? "linked" : null;
    else if (key === "source_pdf_url") result.source_pdf_url = item && value.id ? `${base}/levels/${value.id}/original` : null;
    else if (key === "source_key") { if (item && value.id) result.document_url = `${base}/entries/${value.id}/document`; }
    else if (key === "matters") result.matters = [];
    else if (key === "error") result.error = item ? "The operation could not complete. Reload the plan and try again." : null;
    else if (key === "dot_colours") result.dot_colours = item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([name, colour]) => ["OML", "LR", "RR", "RG", "OTHER"].includes(name) && /^#[0-9a-f]{6}$/i.test(String(colour)))) : null;
    else if (key === "applied" && item && typeof item === "object") result.applied = Object.fromEntries(Object.entries(item).map(([id, applied]) => [id, presentScopedEditorPayload(applied, base)]));
    else if (fields.has(key) || containers.has(key)) result[key] = presentScopedEditorPayload(item, base);
  }
  return result;
}

export function createScopedEditorRouter(deps: ScopedEditorDependencies) {
  const router = Router();
  let schema: Promise<void> | undefined;
  const ready = () => schema ??= (deps.ensureSchema?.() ?? ensureEvidencePlanShareSchema(deps.db)).catch(error => { schema = undefined; throw error; });
  // Each legacy operation may need another pool connection while this adapter
  // holds its grant lock. Keep enough of the production pool free to complete
  // those operations; queue ordinary parallel image loads rather than fail them.
  let active = 0;
  const waiting: Array<() => void> = [];
  const enter = async () => {
    if (active < 4) { active++; return; }
    if (waiting.length >= 64) throw new EvidencePlanShareError(429, "The editor is busy. Try again shortly.");
    await new Promise<void>(resolve => waiting.push(resolve));
  };
  const leave = () => { const next = waiting.shift(); if (next) next(); else active--; };
  const workbookUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } }).single("file");
  router.use("/api/public/evidence-plans/:token/editor", async (req, res) => {
    res.set({ "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Expires": "0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" });
    let client: EvidenceShareClient | undefined;
    let entered = false;
    try {
      const token = String(req.params.token || "");
      if (!EVIDENCE_SHARE_TOKEN.test(token)) throw missing();
      if (!["GET", "PUT", "POST", "DELETE"].includes(req.method)) throw missing();
      if (req.method !== "GET") {
        const origin = req.get("origin"), site = req.get("sec-fetch-site");
        if (site === "cross-site" || site === "same-site" || origin && origin !== `${req.protocol}://${req.get("host")}`) throw new EvidencePlanShareError(403, "Open this editor in the application to make changes");
        if (req.method !== "DELETE" && !req.is("application/json") && !req.is("multipart/form-data")) throw new EvidencePlanShareError(415, "Use an editor form to make changes");
      }
      await enter(); entered = true;
      if (res.destroyed) throw missing();
      await ready();
      const first = (await deps.db.query("SELECT id, plan_id FROM evidence_plan_shares WHERE token=$1 AND revoked_at IS NULL AND access_mode='edit'", [token])).rows[0];
      if (!first) throw missing();
      client = await deps.db.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [`evidence-plan-share:${first.id}`]);
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [`evidence-plan-binding:${first.plan_id}`]);
      const grant = (await client.query(`SELECT s.id, s.plan_id, p.property_id FROM evidence_plan_shares s JOIN evidence_plans p ON p.id=s.plan_id
        WHERE s.id=$1 AND s.token=$2 AND s.revoked_at IS NULL AND s.access_mode='edit'`, [first.id, token])).rows[0];
      if (!grant) throw missing();
      const suffix = req.path.replace(/\/$/, ""), parts = suffix.split("/").filter(Boolean), method = req.method;
      const own = async (kind: string, id: unknown) => {
        if (typeof id !== "string" || !EVIDENCE_SHARE_UUID.test(id)) throw missing();
        const table = ({ levels: "evidence_plan_levels", units: "evidence_plan_units", entries: "evidence_plan_entries", jobs: "evidence_plan_jobs" } as Record<string, string>)[kind];
        if (!table) throw missing();
        const row = (await client!.query(`SELECT * FROM ${table} WHERE id=$1 AND plan_id=$2`, [id, grant.plan_id])).rows[0];
        if (!row) throw missing();
        return row;
      };
      let route = "", entity: any;
      if (["levels", "units", "entries", "jobs"].includes(parts[0])) {
        entity = await own(parts[0], parts[1]);
        const operation = parts[2] || "";
        const allowed = parts.length <= 3 && (parts[0] === "levels" && (method === "GET" && ["background", "original"].includes(operation) || ["PUT", "DELETE"].includes(method) && !operation || method === "POST" && ["crop", "trace-unit"].includes(operation))
          || parts[0] === "units" && ["PUT", "DELETE"].includes(method) && !operation
          || parts[0] === "entries" && (["PUT", "DELETE"].includes(method) && !operation || method === "GET" && operation === "document")
          || parts[0] === "jobs" && method === "GET" && !operation);
        if (!allowed) throw missing();
        route = parts[0];
      } else {
        if (parts[0] !== grant.plan_id) throw missing();
        const operation = parts[1] || "";
        const allowed = parts.length === 1 && ["GET", "PUT"].includes(method)
          || parts.length === 2 && (method === "POST" && ["background", "units", "entries", "import-tenancy", "ingest-taf", "detect-units"].includes(operation) || method === "GET" && ["background", "scan-review"].includes(operation))
          || parts.length === 4 && operation === "units" && parts[3] === "import-evidence" && method === "POST"
          || parts.length === 4 && operation === "scan-review" && parts[3] === "apply" && method === "POST";
        if (!allowed) throw missing();
        if (parts.length === 4) await own(operation === "units" ? "units" : "jobs", parts[2]);
        route = operation || "plan";
        if (route === "plan" && method === "PUT" && Object.keys(req.body || {}).some(key => !["name", "dotColours"].includes(key))) throw new EvidencePlanShareError(403, "Only the plan name and key colours can be changed here");
      }
      for (const [key, kind] of [["levelId", "levels"], ["unitId", "units"], ["jobId", "jobs"]] as const) {
        if (req.body?.[key]) await own(kind, req.body[key]);
        if (req.query[key]) await own(kind, String(req.query[key]));
      }
      if (req.body?.expectedPlanId && req.body.expectedPlanId !== grant.plan_id) throw missing();
      for (const key of ["scheduleRowId", "linkScheduleRowId", "expectedScheduleRowId", "expectedTenancyUnitId"]) {
        if (req.body?.[key]) {
          const row = grant.property_id && (await client.query("SELECT id FROM tenancy_schedule_units WHERE id=$1 AND property_id=$2", [req.body[key], grant.property_id])).rows[0];
          if (!row) throw missing();
        }
      }
      for (const key of ["assignments", "clearOutlineUnitIds"]) {
        if (Object.hasOwn(req.body || {}, key) && !Array.isArray(req.body[key])) throw new EvidencePlanShareError(400, "Scan changes must contain a list of unit selections");
      }
      for (const assignment of req.body?.assignments || []) if (assignment?.unitId) await own("units", assignment.unitId);
      for (const id of req.body?.clearOutlineUnitIds || []) await own("units", id);
      if (Object.hasOwn(req.body || {}, "expectedBackgroundKey")) {
        const level = req.body.levelId ? await own("levels", req.body.levelId) : entity?.level_id ? await own("levels", entity.level_id) : entity;
        if (!level || editorBackgroundRevision(level.background_key) !== req.body.expectedBackgroundKey) throw new EvidencePlanShareError(409, "The plan image changed. Reload before saving.");
        req.body.expectedBackgroundKey = level.background_key;
      }
      const base = `/api/public/evidence-plans/${token}/editor`;
      if (method === "GET" && route === "background") {
        entity = (await client.query("SELECT * FROM evidence_plan_levels WHERE plan_id=$1 ORDER BY sort_order, created_at LIMIT 1", [grant.plan_id])).rows[0];
        if (!entity) throw missing();
        route = "levels"; parts[2] = "background";
      }
      if (method === "GET" && (route === "entries" && parts[2] === "document" || route === "levels" && ["background", "original"].includes(parts[2]))) {
        const image = parts[2] === "background";
        const key = route === "entries" ? entity.source_key : image ? entity.background_key : deps.originalPlanPdfKey?.(entity.background_key);
        if (!key) throw missing();
        const file = await deps.getFile(key); if (!file) throw missing();
        const type = sharedFileType(file, image); if (!type) throw missing();
        const data = image && req.query.hideRed === "1" && deps.hideRed ? await deps.hideRed(file.data, key) : file.data;
        res.set({ "Content-Type": image && data !== file.data ? "image/png" : type.mime, "Content-Disposition": `${image ? "inline" : "attachment"}; filename="${route === "entries" ? "evidence" : "plan"}.${type.extension}"` });
        res.send(data);
      } else if (route === "import-tenancy" && grant.property_id) {
        await new Promise<void>((resolve, reject) => workbookUpload(req, res, error => error ? reject(error) : resolve()));
        if (req.body?.clearExisting && req.body.clearExisting !== "false") throw new EvidencePlanShareError(400, "Replacing the whole tenancy schedule is not available from this link");
        if (req.body?.propertyId && !["linked", grant.property_id].includes(req.body.propertyId)) throw missing();
        if (!req.file || !deps.importTenancyWorkbook) throw new EvidencePlanShareError(400, "Choose a tenancy workbook");
        const result = await deps.importTenancyWorkbook(deps.db, grant.property_id, req.file.buffer, { clearExisting: false });
        res.json(presentScopedEditorPayload(result, base));
      } else {
        const originalJson = res.json.bind(res);
        res.json = ((body: any) => originalJson(presentScopedEditorPayload(body, base))) as Response["json"];
        req.url = `/api/evidence-plans${suffix}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
        const pendingOperations = new Set<Promise<void>>();
        await runWithEvidencePlanEditorAccess({ request: req, shareId: grant.id, planId: grant.plan_id, propertyId: grant.property_id || null, pendingOperations }, async () => {
          try {
            await new Promise<void>((resolve, reject) => {
              res.once("finish", resolve); res.once("close", resolve);
              try {
                const operation: unknown = deps.downstream(req, res, error => error ? reject(error) : reject(missing()));
                trackEvidencePlanEditorOperation(req, operation);
                if (operation && typeof (operation as any).then === "function") void Promise.resolve(operation).catch(reject);
              } catch (error) { reject(error); }
            });
          } finally {
            while (pendingOperations.size) await Promise.all([...pendingOperations]);
          }
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      if (!res.headersSent) res.status(error instanceof EvidencePlanShareError ? error.status : 500).json({ error: error instanceof EvidencePlanShareError ? error.message : "The shared editor could not complete this request" });
    } finally { client?.release(); if (entered) leave(); }
  });
  return router;
}
export const createEvidencePlanEditorRouter = createScopedEditorRouter;
let production: Promise<RequestHandler> | undefined;
export const evidencePlanEditorRouter: RequestHandler = async (req, res, next) => {
  if (!/^\/api\/public\/evidence-plans\/[^/]+\/editor(?:\/|$)/.test(req.path)) return next();
  try {
    production ??= Promise.all([import("./db"), import("./evidence-plan"), import("./file-storage"), import("./tenancy-schedule"), import("./plan-image-render"), import("./plan-display-image")])
      .then(([database, legacy, storage, tenancy, rendering, display]) => createScopedEditorRouter({ db: database.pool, downstream: legacy.default, getFile: storage.getFile, importTenancyWorkbook: tenancy.importTenancyWorkbook, originalPlanPdfKey: rendering.originalPlanPdfKey, hideRed: (data, key) => display.redInkHiddenPlanImage(key, data) }));
    (await production)(req, res, next);
  } catch { res.status(500).json({ error: "The shared editor is unavailable" }); }
};
