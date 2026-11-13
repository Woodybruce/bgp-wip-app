// Which columns GET /api/crm/companies reads for a LIST. The full table is
// 114 fields a row and, on the live data, 62 MB of JSON for 5,500 companies:
// two thirds of it is the saved Companies House record, which no list uses.
// The list leaves the six heavy fields out unless the caller asks (?full=1),
// and a lookup or picker can ask for just the fields it needs (?fields=).
// One company (GET /api/crm/companies/:id) always carries every field.
import { getTableColumns, sql } from "drizzle-orm";
import { crmCompanies } from "@shared/schema";

export const COMPANY_LIST_HEAVY_COLUMNS = [
  "companiesHouseData", "companiesHouseOfficers", "amlChecklist",
  "aiGeneratedFields", "brandAnalysis", "menuIntel",
] as const;

// The one list field that is not a column: the town of the registered office
// from the saved Companies House record, which the People cards show.
export const COMPANY_LIST_DERIVED_FIELDS = ["registeredLocality"] as const;

// ?fields=id,name,companyType → the names that are real list fields, id
// first and always there. Null when the caller did not ask for fields.
export function parseCompanyListFields(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const known = new Set<string>([...Object.keys(getTableColumns(crmCompanies)), ...COMPANY_LIST_DERIVED_FIELDS]);
  const picked = raw.split(",").map(name => name.trim()).filter(name => known.has(name));
  return Array.from(new Set(["id", ...picked]));
}

// The drizzle selection for a list read: the named fields, or every column
// but the heavy six, or null for the whole row.
export function companyListSelection(opts: { fields?: string[] | null; slim?: boolean }): Record<string, any> | null {
  const columns = getTableColumns(crmCompanies) as Record<string, any>;
  if (opts.fields) {
    const selection: Record<string, any> = {};
    for (const name of opts.fields) {
      if (name === "registeredLocality") {
        selection[name] = sql<string | null>`${crmCompanies.companiesHouseData} #>> '{profile,registeredOfficeAddress,locality}'`;
      } else if (columns[name]) selection[name] = columns[name];
    }
    return selection;
  }
  if (!opts.slim) return null;
  const heavy = new Set<string>(COMPANY_LIST_HEAVY_COLUMNS);
  return Object.fromEntries(Object.entries(columns).filter(([name]) => !heavy.has(name)));
}
