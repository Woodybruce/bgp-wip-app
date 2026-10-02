/** Scoped evidence-plan facts for chat. Uses the same transactional editor as the plan UI. */
export const EVIDENCE_PLAN_CHAT_TOOL = {
  type: "function",
  function: {
    name: "manage_evidence_plan_unit",
    description: "Read or update an evidence-plan unit's current tenancy facts. Use this for evidence-plan links, including unit B6 on Brent Cross, instead of sql_write. Read first using planId from /evidence-plans/<id> plus unitId or exact unitRef; the result includes the current facts, saved evidence, and revision. For an authorized edit, send the returned unitId and revision unchanged with ONLY the explicitly supported current facts to update. Saved transaction evidence is separate: never promote proposed/renewal headline rent to passing rent, infer lease dates from a term, or fill unknown values with zero. Explain missing source facts. An update writes through the linked tenancy schedule when applicable; no admin role is required. A conflict requires another read and review before retrying.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "update"] },
        planId: { type: "string", description: "Evidence plan UUID from its URL." },
        unitId: { type: "string", description: "Exact unit UUID returned by read. Required for update." },
        unitRef: { type: "string", description: "Unit reference for read, e.g. B6. If several levels contain it, choose a returned unitId." },
        revision: {
          type: "object", description: "For update, copy the entire revision returned by read without changing it.",
          properties: {
            unitUpdatedAt: { type: "string" },
            scheduleRowId: { type: ["string", "null"] },
            scheduleRowUpdatedAt: { type: ["string", "null"] },
          },
          required: ["unitUpdatedAt", "scheduleRowId", "scheduleRowUpdatedAt"],
          additionalProperties: false,
        },
        facts: {
          type: "object", description: "Only facts the user or source explicitly establishes as current. Omit unchanged fields; null explicitly clears a field.",
          properties: {
            tenantName: { type: ["string", "null"] },
            leaseExpiry: { type: ["string", "null"], description: "Explicit lease expiry YYYY-MM-DD; not the transaction date." },
            breakDate: { type: ["string", "null"], description: "Explicit break date YYYY-MM-DD." },
            reviewDate: { type: ["string", "null"], description: "Explicit next rent review YYYY-MM-DD." },
            erv: { type: ["number", "null"], description: "Annual ERV GBP, not Zone A or per-square-foot rent." },
            passingRent: { type: ["number", "null"], description: "Current annual passing rent GBP, not proposed or renewal headline rent." },
            sqft: { type: ["number", "null"], description: "Unit size in square feet, not ITZA." },
            notes: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
      required: ["action", "planId"],
      additionalProperties: false,
    },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FACT_KEYS = new Set(["tenantName", "leaseExpiry", "breakDate", "reviewDate", "erv", "passingRent", "sqft", "notes"]);
const timestamp = (value: any) => value == null ? null : new Date(value).toISOString();

type Dependencies = {
  query: (sql: string, values: any[]) => Promise<{ rows: any[] }>;
  canAccessProperty: (propertyId: string | null) => Promise<boolean>;
  scheduleRows: (propertyId: string | null) => Promise<any[]>;
  presentUnit: (unit: any, rows: any[]) => any;
  normaliseUnitRef: (ref: string) => string;
  saveUnit: (unitId: string, body: any, canEditProperty: Dependencies["canAccessProperty"]) => Promise<any>;
  audit: (entry: { tableName: string; op: string; data?: any; where?: any; affectedRows: number; success: boolean; error?: string }) => Promise<void>;
};

export async function manageEvidencePlanUnit(args: any, deps: Dependencies): Promise<any> {
  const failed = (error: string) => ({ success: false, error });
  if (!args || !["read", "update"].includes(args.action)) return failed("Choose read or update.");
  if (typeof args.planId !== "string" || !UUID.test(args.planId)) return failed("A valid evidence plan ID is required.");
  if (args.unitId != null && (typeof args.unitId !== "string" || !UUID.test(args.unitId))) return failed("A valid unit ID is required.");
  if (!args.unitId && (typeof args.unitRef !== "string" || !args.unitRef.trim())) return failed("Choose a unit ID or unit reference.");
  if (args.action === "update" && !args.unitId) return failed("Read the unit first, then update its exact unit ID and revision.");
  try {
    const plan = (await deps.query("SELECT id, name, property_id FROM evidence_plans WHERE id = $1", [args.planId])).rows[0];
    if (!plan || !(await deps.canAccessProperty(plan.property_id))) return failed("Plan is not available for this account.");
    const rows = (await deps.query(`SELECT * FROM evidence_plan_units WHERE plan_id = $1${args.unitId ? " AND id = $2" : ""} ORDER BY unit_ref, id`, args.unitId ? [args.planId, args.unitId] : [args.planId])).rows;
    const matches = args.unitId ? rows : rows.filter(row => deps.normaliseUnitRef(row.unit_ref) === deps.normaliseUnitRef(args.unitRef));
    if (!matches.length) return failed("Unit not found on this evidence plan.");
    if (matches.length > 1) return { success: false, error: "Several units have this reference. Choose the correct level and unit ID.", candidates: matches.map(unit => ({ id: unit.id, unitRef: unit.unit_ref, tenant: unit.tenant_name, levelId: unit.level_id })) };
    const unit = deps.presentUnit(matches[0], await deps.scheduleRows(plan.property_id));
    const revision = { unitUpdatedAt: timestamp(unit.updated_at), scheduleRowId: unit.ts_row_id || null, scheduleRowUpdatedAt: timestamp(unit.ts_row_updated_at) };
    if (args.action === "read") {
      const evidence = (await deps.query("SELECT * FROM evidence_plan_entries WHERE plan_id = $1 AND unit_id = $2 ORDER BY transaction_date DESC NULLS LAST, created_at DESC", [plan.id, unit.id])).rows;
      return { success: true, plan, unit, revision, evidence, url: `/evidence-plans/${plan.id}`,
        instruction: "Evidence records describe transactions, not necessarily the current tenancy. Missing rent and lease dates remain unknown. Use this revision when explicitly updating current unit facts." };
    }
    if (!args.facts || typeof args.facts !== "object" || Array.isArray(args.facts) || !Object.keys(args.facts).length) return failed("Provide the current facts to update.");
    if (Object.keys(args.facts).some(key => !FACT_KEYS.has(key))) return failed("Only current tenancy facts and notes can be changed here; use the plan editor for outlines, references and schedule links.");
    if (!args.revision || Object.keys(revision).some(key => !(key in args.revision) || args.revision[key] !== revision[key as keyof typeof revision])) return failed("The unit or tenancy schedule changed, or its revision is missing. Read the unit again and review before saving.");
    const body = { ...args.facts, expectedPlanId: plan.id, expectedUnitUpdatedAt: revision.unitUpdatedAt,
      scheduleRowId: revision.scheduleRowId, scheduleRowUpdatedAt: revision.scheduleRowUpdatedAt };
    const saved = await deps.saveUnit(unit.id, body, deps.canAccessProperty);
    await deps.audit({ tableName: "evidence_plan_units", op: "update", data: args.facts, where: { id: unit.id, plan_id: plan.id }, affectedRows: 1, success: true });
    return { success: true, affected: 1, planId: plan.id, propertyId: plan.property_id, unit: saved, updatedFields: Object.keys(args.facts),
      savedTo: saved.ts_linked ? "Linked property tenancy schedule" : "Evidence plan unit", url: `/evidence-plans/${plan.id}` };
  } catch (error: any) {
    if (args.action === "update") await deps.audit({ tableName: "evidence_plan_units", op: "update", data: args.facts, where: { id: args.unitId, plan_id: args.planId }, affectedRows: 0, success: false, error: error?.message || "Update failed" });
    return failed(error?.message || "Evidence plan request failed.");
  }
}

// Read-only schema discovery for tables created outside Drizzle. Writes must
// still use the scoped plan editor, never the generic SQL mutation path.
export const EVIDENCE_PLAN_READ_TABLES = Object.entries({
  evidence_plans: { id: "uuid", name: "text", property_id: "text", background_key: "text", background_width: "number", background_height: "number", dot_colours: "json", created_by: "text", created_at: "date", updated_at: "date" },
  evidence_plan_levels: { id: "uuid", plan_id: "uuid", name: "text", background_key: "text", background_width: "number", background_height: "number", sort_order: "number", created_at: "date" },
  evidence_plan_units: { id: "uuid", plan_id: "uuid", level_id: "uuid", unit_ref: "text", tenant_name: "text", tenancy_unit_id: "text", polygon: "json", dot: "json", source: "text", lease_expiry: "date", break_date: "date", review_date: "date", erv: "number", passing_rent: "number", sqft: "number", notes: "text", ts_matched_at: "date", updated_at: "date" },
  evidence_plan_entries: { id: "uuid", plan_id: "uuid", unit_id: "uuid", unit_ref: "text", tenant: "text", transaction_type: "text", transaction_date: "date", size_sqft: "number", zone_a: "number", itza: "number", headline_rent: "number", net_effective: "number", term: "text", concession: "text", notes: "text", source_key: "text", created_by: "text", created_at: "date" },
}).map(([name, fields]) => ({ name, columns: Object.entries(fields).map(([name, type]) => ({ name, type, nullable: !["id", "plan_id", "created_at", "updated_at"].includes(name) })) }));
