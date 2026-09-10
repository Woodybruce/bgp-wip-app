import { importTenancyRows, TenancyImportError, type ParsedTenancyImportRow } from "./tenancy-import";

const fields: Record<string, string> = {
  unitNumber: "unit_number", premises: "premises", floorLevel: "floor_level", grouping: "grouping", permittedUse: "permitted_use",
  tenantName: "tenant_name", tradingName: "trading_name", leaseStart: "lease_start", leaseExpiry: "lease_expiry",
  breakDate: "break_date", nextReviewDate: "next_review_date", termYears: "term_years", passingRentPa: "passing_rent_pa",
  ervPa: "erv_pa", niaSqft: "nia_sqft", giaSqft: "gia_sqft", rateableValue: "rateable_value", status: "status", comments: "comments",
};
const dates = new Set(["leaseStart", "leaseExpiry", "breakDate", "nextReviewDate"]);
const numbers = new Set(["termYears", "passingRentPa", "ervPa", "niaSqft", "giaSqft", "rateableValue"]);

export function prepareChatTenancyRows(input: unknown) {
  if (!Array.isArray(input) || !input.length) throw new TenancyImportError(400, "No tenancy rows provided");
  const rows: ParsedTenancyImportRow[] = [], explicitEdits: Array<ParsedTenancyImportRow & { id: string }> = [];
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TenancyImportError(400, `Tenancy row ${i + 1} is invalid`);
    const values: Record<string, any> = {};
    for (const [camel, column] of Object.entries(fields)) {
      const value = raw[camel];
      // Omitted extractor fields are not instructions to clear staff data.
      if (value === undefined || value === null) continue;
      if (dates.has(camel)) {
        if (value === "") continue;
        const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
        if (!date || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
          throw new TenancyImportError(400, `Invalid ${camel} in tenancy row ${i + 1}; use a valid YYYY-MM-DD date`);
        }
        values[column] = value;
      } else if (numbers.has(camel)) {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new TenancyImportError(400, `Invalid ${camel} in tenancy row ${i + 1}`);
        values[column] = value;
      } else {
        if (typeof value !== "string") throw new TenancyImportError(400, `Invalid ${camel} in tenancy row ${i + 1}`);
        values[column] = value;
      }
    }
    if (raw.id != null) {
      if (typeof raw.id !== "string" || !raw.id.trim()) throw new TenancyImportError(400, `Invalid ID in tenancy row ${i + 1}`);
      explicitEdits.push({ id: raw.id, sourceRow: i + 1, values });
    } else {
      if (!values.status && values.tenant_name) values.status = /^vacant$/i.test(values.tenant_name.trim()) ? "Vacant" : "Occupied";
      values.sort_order = i;
      rows.push({ sourceRow: i + 1, values });
    }
  });
  return { rows, explicitEdits };
}

export async function upsertChatTenancySchedule(pool: any, propertyId: unknown, input: unknown) {
  if (typeof propertyId !== "string" || !propertyId.trim()) throw new TenancyImportError(400, "A property ID is required");
  const prepared = prepareChatTenancyRows(input);
  const property = (await pool.query("SELECT id, name FROM crm_properties WHERE id = $1", [propertyId])).rows[0];
  if (!property) throw new TenancyImportError(404, `No property found with ID "${propertyId}"`);
  const result = await importTenancyRows(pool, propertyId, prepared.rows, { allowedFields: [...Object.values(fields), "sort_order"], explicitEdits: prepared.explicitEdits });
  // The tenancy schedule is the god of truth: every OTHER write door on it
  // (tenancy-schedule.ts POST/PATCH/import, crm.ts) fans the status out to
  // available_units, leasing_schedule_units and crm_deals via unit-mirror,
  // and the schedule UI documents that contract to the user. This door
  // didn't — so a unit ChatBGP marked Occupied from a datatape stayed
  // "Vacant" on the landlord's leasing board and on the Letting Tracker.
  // Best-effort per row, exactly as the HTTP doors do it. Only mirror-eligible
  // inserts adopt existing name-based mirrors; a repeated reference on another
  // floor is left for review rather than pointed at a neighbour.
  const { fanOutTenancyStatus } = await import("./unit-mirror");
  for (const id of [...result.mirrorEligibleIds, ...result.updatedIds]) {
    try { await fanOutTenancyStatus(pool, id); } catch {}
  }
  return {
    success: true, action: "upserted", entity: "tenancy schedule", propertyId, name: property.name,
    inserted: result.imported, updated: result.updated, skipped: result.skippedExisting, needsReview: result.needsReview, reviewRows: result.reviewRows,
    message: `Tenancy schedule for "${property.name}": ${result.imported} added, ${result.updated} updated, ${result.skippedExisting} already present, ${result.needsReview} need review.${result.needsReview ? " Existing information was kept for the review rows." : ""}`,
  };
}
