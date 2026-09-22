import { isDeepStrictEqual } from "node:util";
import { classifyEvidenceScheduleCandidates, EVIDENCE_SCHEDULE_COMPARISON_FIELDS, evidenceScheduleRefsEquivalent } from "./evidence-plan-schedule";

export class TenancyMergeError extends Error {
  constructor(public status: number, message: string, public conflicts: string[] = []) { super(message); }
}

const metadata = new Set(["id", "created_at", "updated_at", "sort_order"]);
const compared = new Set<string>(["property_id", "unit_number", ...EVIDENCE_SCHEDULE_COMPARISON_FIELDS]);
const blank = (value: unknown) => value == null || typeof value === "string" && !value.trim();
const identifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function tenancyMergeConflicts(primary: Record<string, any>, secondary: Record<string, any>): string[] {
  const fields = new Set(classifyEvidenceScheduleCandidates([primary as any, secondary as any]).conflicts.map(conflict => conflict.field));
  if (!evidenceScheduleRefsEquivalent(primary.unit_number, secondary.unit_number)) fields.add("unit_number");
  // Cover runtime/future columns as well as the shared schedule fields. A
  // value present only on the donor also needs review; never silently drop
  // it or fill the primary's gaps during a merge.
  for (const field of new Set([...Object.keys(primary), ...Object.keys(secondary)])) {
    if (metadata.has(field) || compared.has(field) && !/_ids?$/.test(field)) continue;
    if (!(blank(primary[field]) && blank(secondary[field])) && !isDeepStrictEqual(primary[field], secondary[field])) fields.add(field);
  }
  return [...fields].sort();
}

export async function mergeTenancyUnits(pool: any, propertyId: unknown, primaryId: unknown, secondaryId: unknown) {
  if (![propertyId, primaryId, secondaryId].every(value => typeof value === "string" && value.trim() && value.length <= 100)) {
    throw new TenancyMergeError(400, "Choose the property and both tenancy rows before merging.");
  }
  if (primaryId === secondaryId) throw new TenancyMergeError(400, "Choose two different tenancy rows.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Use the same property lock as imports and a deterministic row order.
    const property = await db.query("SELECT id FROM crm_properties WHERE id = $1 FOR UPDATE", [propertyId]);
    if (!property.rows.length) throw new TenancyMergeError(404, "Property not found.");
    const rows = (await db.query("SELECT * FROM tenancy_schedule_units WHERE id::text = ANY($1::text[]) ORDER BY id FOR UPDATE", [[primaryId, secondaryId]])).rows;
    if (rows.length !== 2) throw new TenancyMergeError(404, "One of the tenancy rows is no longer available. Reload the duplicate review.");
    if (rows.some((row: any) => row.property_id !== propertyId)) throw new TenancyMergeError(400, "Both tenancy rows must belong to this property.");
    const primary = rows.find((row: any) => row.id === primaryId), secondary = rows.find((row: any) => row.id === secondaryId);
    const conflicts = tenancyMergeConflicts(primary, secondary);
    if (conflicts.length) throw new TenancyMergeError(409,
      `These rows differ in ${conflicts.map(field => field.replace(/_/g, " ")).join(", ")}. Review and resolve those fields in the tenancy schedule before merging. Both rows and their links are unchanged.`, conflicts);

    // Include the legacy soft links and every declared FK to the tenancy ID.
    // Resolve the actual schedule schema so isolated tests and deployments
    // with a non-default search_path never touch a different schema.
    const references = (await db.query(`
      WITH target AS (SELECT oid, relnamespace FROM pg_class WHERE oid = 'tenancy_schedule_units'::regclass)
      SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenancy_unit_id' AND NOT a.attisdropped
       WHERE c.relnamespace = (SELECT relnamespace FROM target) AND c.relkind IN ('r', 'p') AND c.oid <> (SELECT oid FROM target)
      UNION
      SELECT n.nspname, c.relname, a.attname
        FROM pg_constraint fk JOIN pg_class c ON c.oid = fk.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN LATERAL generate_subscripts(fk.conkey, 1) key_position(i) ON true
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = fk.conkey[key_position.i]
        JOIN pg_attribute parent ON parent.attrelid = fk.confrelid AND parent.attnum = fk.confkey[key_position.i]
       WHERE fk.contype = 'f' AND fk.confrelid = (SELECT oid FROM target)
         AND parent.attname = 'id'
       ORDER BY schema_name, table_name, column_name`)).rows;
    const moved: Record<string, number> = { leasing: 0, available: 0, deals: 0, evidencePlans: 0, propertyPlans: 0 };
    const aliases: Record<string, string> = { leasing_schedule_units: "leasing", available_units: "available", crm_deals: "deals", evidence_plan_units: "evidencePlans", property_plan_units: "propertyPlans" };
    const movedReferences = [];
    for (const ref of references) {
      const count = (await db.query(`UPDATE ${identifier(ref.schema_name)}.${identifier(ref.table_name)} SET ${identifier(ref.column_name)} = $1 WHERE ${identifier(ref.column_name)} = $2`, [primaryId, secondaryId])).rowCount || 0;
      const key = aliases[ref.table_name] || `${ref.schema_name}.${ref.table_name}.${ref.column_name}`;
      moved[key] = (moved[key] || 0) + count;
      movedReferences.push({ table: ref.table_name, column: ref.column_name, count });
    }
    const removed = await db.query("DELETE FROM tenancy_schedule_units WHERE id = $1 AND property_id = $2", [secondaryId, propertyId]);
    if (removed.rowCount !== 1) throw new TenancyMergeError(409, "The duplicate changed during review. No changes were saved.");
    await db.query("COMMIT");
    return { ok: true, primaryId, secondaryId, merged: 1, moved, references: movedReferences };
  } catch (error: any) {
    await db.query("ROLLBACK");
    if (error.code === "23505" || error.code === "23503") throw new TenancyMergeError(409,
      "These rows have linked records that cannot be combined yet. Review their deals and unit links first. Both tenancy rows and all links are unchanged.");
    throw error;
  } finally { db.release(); }
}
