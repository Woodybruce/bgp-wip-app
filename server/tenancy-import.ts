type ScheduleRow = Record<string, any>;
export type ParsedTenancyImportRow = { sourceRow: number; values: ScheduleRow };
export type TenancyImportReview = {
  sourceRow: number;
  unitNumber: string | null;
  floorLevel: string | null;
  premises: string | null;
  reason: "missing_identity" | "ambiguous_identity" | "different_facts";
  existingIds: string[];
  differingFields: string[];
  incomingValues: ScheduleRow;
  candidates: Array<{ id: string; unitNumber: string | null; tenantName: string | null; tradingName: string | null;
    floorLevel: string | null; premises: string | null; values: ScheduleRow }>;
};

export class TenancyImportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function normaliseTenancyImportRef(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/\b(UNITS?|SHOPS?)\b/g, " ")
    .replace(/\bSTORES\b/g, "STORE").replace(/[‐‑‒–—−]/g, "-")
    .replace(/[^A-Z0-9/&-]+/g, " ").replace(/\b([A-Z]*)0+(\d)/g, "$1$2")
    .replace(/\s+/g, " ").trim();
}

const text = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const identity = (row: ScheduleRow) => normaliseTenancyImportRef(row.unit_number || row.premises);
const scopeFields = ["floor_level", "premises"];
const dateFields = new Set(["lease_start", "lease_expiry", "break_date", "landlord_break_date", "next_review_date"]);
function calendarDate(value: any): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  // pg reads date/timestamp-without-zone as local calendar dates. Converting
  // midnight to UTC first can incorrectly move a summer UK date back one day.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function equivalent(field: string, incoming: any, existing: any): boolean {
  if (incoming == null || incoming === "") return existing == null || existing === "";
  if (existing == null || existing === "") return false;
  if (field === "unit_number") return normaliseTenancyImportRef(incoming) === normaliseTenancyImportRef(existing);
  if (dateFields.has(field)) {
    const a = calendarDate(incoming), b = calendarDate(existing);
    return a !== null && a === b;
  }
  if (typeof incoming === "number") return Number.isFinite(incoming) && Number(existing) === incoming;
  if (Array.isArray(incoming)) return JSON.stringify(incoming) === JSON.stringify(existing);
  if (typeof incoming === "boolean") return incoming === existing;
  return text(incoming) === text(existing);
}

export function classifyTenancyImportRow(incoming: ParsedTenancyImportRow, existing: ScheduleRow[]):
  { action: "insert" } | { action: "skip"; existingId: string } | { action: "review"; review: TenancyImportReview } {
  const row = incoming.values;
  const key = identity(row);
  const sameRef = key ? existing.filter(saved => identity(saved) === key) : [];
  // An explicit different floor or demise reference can identify a different
  // tenancy. A missing value cannot choose between several possible rows.
  const candidates = sameRef.filter(saved => !scopeFields.some(field => text(row[field]) && text(saved[field]) && text(row[field]) !== text(saved[field])));
  const review = (reason: TenancyImportReview["reason"], rows: ScheduleRow[], differingFields: string[] = []) => ({
    action: "review" as const,
    review: { sourceRow: incoming.sourceRow, unitNumber: row.unit_number || null, floorLevel: row.floor_level || null,
      premises: row.premises || null, reason, existingIds: rows.map(saved => String(saved.id)), differingFields,
      incomingValues: Object.fromEntries(Object.entries(row).filter(([field]) => field !== "sort_order")),
      candidates: rows.map(saved => ({ id: String(saved.id), unitNumber: saved.unit_number || null,
        tenantName: saved.tenant_name || null, tradingName: saved.trading_name || null,
        floorLevel: saved.floor_level || null, premises: saved.premises || null,
        values: Object.fromEntries(Object.keys(row).filter(field => field !== "sort_order").map(field => [field,
          dateFields.has(field) && saved[field] != null ? calendarDate(saved[field]) : saved[field] ?? null])) })),
    },
  });
  if (!key) return review("missing_identity", []);
  if (candidates.length === 0) return { action: "insert" };
  if (candidates.length !== 1) return review("ambiguous_identity", candidates);
  const saved = candidates[0];
  const differingFields = Object.keys(row).filter(field => field !== "sort_order" && !equivalent(field, row[field], saved[field]));
  if (differingFields.length) return review("different_facts", candidates, differingFields);
  return { action: "skip", existingId: String(saved.id) };
}

export async function importTenancyRows(pool: any, propertyId: string, rows: ParsedTenancyImportRow[],
  options: { clearExisting?: boolean; allowedFields: readonly string[]; explicitEdits?: Array<ParsedTenancyImportRow & { id: string }> }) {
  const explicitEdits = options.explicitEdits || [];
  if (!rows.length && !explicitEdits.length) throw new TenancyImportError(400, "No tenancy rows were found for this property. The existing schedule is unchanged.");
  if (options.clearExisting && explicitEdits.length) throw new TenancyImportError(400, "A replacement import cannot also edit existing row IDs.");
  if (new Set(explicitEdits.map(row => row.id)).size !== explicitEdits.length) throw new TenancyImportError(400, "Each existing tenancy row can only be edited once per request.");
  const allowed = new Set(options.allowedFields);
  for (const { values } of [...rows, ...explicitEdits]) {
    for (const [field, value] of Object.entries(values)) {
      if (!allowed.has(field) || !/^[a-z][a-z0-9_]*$/.test(field) || typeof value === "number" && !Number.isFinite(value)) {
        throw new TenancyImportError(400, "The schedule contains an invalid field or value. The existing schedule is unchanged.");
      }
    }
  }
  if (options.clearExisting) {
    const preview: ScheduleRow[] = [];
    for (const row of rows) {
      const decision = classifyTenancyImportRow(row, preview);
      if (decision.action === "review") throw new TenancyImportError(400, "The replacement file contains missing or conflicting unit identities. The existing schedule is unchanged.");
      if (decision.action === "insert") preview.push({ ...row.values, id: `row-${row.sourceRow}` });
    }
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Serialise even the first import, when there are no unit rows to lock.
    const property = await db.query("SELECT id FROM crm_properties WHERE id = $1 FOR UPDATE", [propertyId]);
    if (!property.rows.length) throw new TenancyImportError(404, "Property not found");
    let existing: ScheduleRow[] = (await db.query("SELECT * FROM tenancy_schedule_units WHERE property_id = $1 ORDER BY id FOR UPDATE", [propertyId])).rows;
    for (const row of explicitEdits) {
      if (!existing.some(saved => String(saved.id) === row.id)) throw new TenancyImportError(404, `Tenancy row ${row.id} was not found on this property. No changes were saved.`);
    }
    if (options.clearExisting) {
      if (rows.some(row => !identity(row.values))) throw new TenancyImportError(400, "Every row needs a unit or demise reference before replacing a schedule. The existing schedule is unchanged.");
      await db.query("UPDATE leasing_schedule_units SET tenancy_unit_id = NULL WHERE property_id = $1 AND tenancy_unit_id IS NOT NULL", [propertyId]);
      await db.query("UPDATE available_units SET tenancy_unit_id = NULL WHERE property_id = $1 AND tenancy_unit_id IS NOT NULL", [propertyId]);
      await db.query("UPDATE crm_deals SET tenancy_unit_id = NULL WHERE tenancy_unit_id IN (SELECT id FROM tenancy_schedule_units WHERE property_id = $1)", [propertyId]);
      // Keep explicit evidence-plan links as stale IDs so the plan shows the
      // missing schedule row and asks for a reviewed replacement link.
      await db.query("DELETE FROM tenancy_schedule_units WHERE property_id = $1", [propertyId]);
      existing = [];
    }
    const insertedIds: string[] = [], updatedIds: string[] = [], reviewRows: TenancyImportReview[] = [];
    let skippedExisting = 0, updated = 0;
    for (const row of explicitEdits) {
      const index = existing.findIndex(saved => String(saved.id) === row.id);
      const fields = Object.keys(row.values).filter(field => {
        const value = row.values[field], saved = existing[index][field];
        return typeof value === "string" && !dateFields.has(field) ? value !== saved : !equivalent(field, value, saved);
      });
      if (!fields.length) { skippedExisting++; continue; }
      const updatedRow = (await db.query(`UPDATE tenancy_schedule_units SET ${fields.map((field, i) => `${field} = $${i + 1}`).join(", ")}, updated_at = now()
        WHERE id = $${fields.length + 1} AND property_id = $${fields.length + 2} RETURNING *`,
        [...fields.map(field => row.values[field]), row.id, propertyId])).rows[0];
      if (!updatedRow) throw new TenancyImportError(409, "The tenancy row changed while saving. Please reload and review it.");
      existing[index] = updatedRow;
      updatedIds.push(String(updatedRow.id));
      updated++;
    }
    for (const row of rows) {
      const decision = classifyTenancyImportRow(row, existing);
      if (decision.action === "skip") { skippedExisting++; continue; }
      if (decision.action === "review") { reviewRows.push(decision.review); continue; }
      const fields = Object.keys(row.values);
      const columns = ["property_id", ...fields];
      const inserted = (await db.query(`INSERT INTO tenancy_schedule_units (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
        [propertyId, ...fields.map(field => row.values[field])])).rows[0];
      insertedIds.push(String(inserted.id));
      existing.push(inserted);
    }
    // The existing mirror adopts by unit name alone. Never feed it a repeated
    // reference from different floors/demises, where it could choose a neighbour.
    const mirrorEligibleIds = insertedIds.filter(id => {
      const row = existing.find(saved => String(saved.id) === id)!;
      return existing.filter(saved => identity(saved) === identity(row)).length === 1;
    });
    await db.query("COMMIT");
    return { imported: insertedIds.length, updated, skippedExisting, needsReview: reviewRows.length, reviewRows, insertedIds, updatedIds, mirrorEligibleIds };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
