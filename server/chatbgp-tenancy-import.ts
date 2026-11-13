import { importTenancyRows, TenancyImportError, type ParsedTenancyImportRow } from "./tenancy-import";
import type { TenantActor } from "./tenancy-tenant";

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

// Who a ChatBGP schedule write is for, by the company-scope test the schedule
// routes use: a scope is a client (BGP staff viewing as a client included).
// Only a server-originated run with no client scope is the system.
export async function chatTenantActor(pool: any, caller: { scope: string | null; userId: string | null | undefined; internal: boolean }): Promise<TenantActor> {
  if (!caller.scope && (caller.internal || !caller.userId)) return { system: "chatbgp" };
  const viewer = caller.scope ? "client" : "staff";
  if (!caller.userId) return { userId: "unknown", name: "unknown login", viewer };
  const user = (await pool.query("SELECT username FROM users WHERE id = $1", [caller.userId])).rows[0];
  return { userId: String(caller.userId), name: user?.username || String(caller.userId), viewer };
}

export async function upsertChatTenancySchedule(pool: any, propertyId: unknown, input: unknown, actor: TenantActor) {
  if (typeof propertyId !== "string" || !propertyId.trim()) throw new TenancyImportError(400, "A property ID is required");
  const prepared = prepareChatTenancyRows(input);
  const property = (await pool.query("SELECT id, name FROM crm_properties WHERE id = $1", [propertyId])).rows[0];
  if (!property) throw new TenancyImportError(404, `No property found with ID "${propertyId}"`);
  const { relinkTenantAfterNameEdit } = await import("./tenancy-tenant");
  const result = await importTenancyRows(pool, propertyId, prepared.rows, { allowedFields: [...Object.values(fields), "sort_order"], explicitEdits: prepared.explicitEdits,
    afterTenantEdit: (db, id, before) => relinkTenantAfterNameEdit(db, id, before, actor) });
  return {
    success: true, action: "upserted", entity: "tenancy schedule", propertyId, name: property.name,
    inserted: result.imported, updated: result.updated, skipped: result.skippedExisting, needsReview: result.needsReview, reviewRows: result.reviewRows,
    message: `Tenancy schedule for "${property.name}": ${result.imported} added, ${result.updated} updated, ${result.skippedExisting} already present, ${result.needsReview} need review.${result.needsReview ? " Existing information was kept for the review rows." : ""}`,
  };
}
