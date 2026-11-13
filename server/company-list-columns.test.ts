/**
 * company-list-columns.test.ts — what GET /api/crm/companies reads for a list.
 *
 * The list was SELECT * on crm_companies: 62 MB of JSON on the live data, two
 * thirds of it saved Companies House records no list shows. It now leaves six
 * heavy fields out in the SQL unless the caller asks (?full=1), and a lookup
 * can name its fields (?fields=). The rows, and who may read them, are decided
 * in the route exactly as before (qa/regression/company-list-columns.test.mjs).
 *
 * Run with: node --import tsx --test server/company-list-columns.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import { crmCompanies } from "@shared/schema";
import { COMPANY_LIST_HEAVY_COLUMNS, parseCompanyListFields, companyListSelection } from "./company-list-columns";

// Never connects: only used to print the statement drizzle would send.
const db = drizzle(new pg.Pool({ connectionString: "postgresql://nobody@127.0.0.1:1/none" }));
const statement = (opts: { fields?: string[] | null; slim?: boolean }) => {
  const selection = companyListSelection(opts);
  return (selection ? db.select(selection) : db.select()).from(crmCompanies).toSQL().sql;
};
const HEAVY_SQL = ["companies_house_data", "companies_house_officers", "aml_checklist", "ai_generated_fields", "brand_analysis", "menu_intel"];
const hasColumn = (sql: string, column: string) => new RegExp(`"${column}"`).test(sql);

describe("the company list's columns", () => {
  it("the whole row is still the default for a server caller", () => {
    assert.equal(companyListSelection({}), null);
    const sql = statement({});
    for (const column of HEAVY_SQL) assert.ok(hasColumn(sql, column), column);
  });

  it("the list columns leave the six heavy fields out of the SQL and keep every other column", () => {
    const selection = companyListSelection({ slim: true })!;
    const all = Object.keys(getTableColumns(crmCompanies));
    assert.deepEqual(Object.keys(selection).sort(), all.filter(name => !(COMPANY_LIST_HEAVY_COLUMNS as readonly string[]).includes(name)).sort());
    assert.equal(all.length - Object.keys(selection).length, 6);
    const sql = statement({ slim: true });
    for (const column of HEAVY_SQL) assert.ok(!hasColumn(sql, column), column);
    // What lists and pickers read, and what the client filter needs.
    for (const column of ["id", "name", "company_type", "domain", "description", "head_office_address", "kyc_status", "bgp_contact_user_ids", "concept_status", "is_portfolio_account", "parent_company_id"]) {
      assert.ok(hasColumn(sql, column), column);
    }
  });

  it("named fields are checked against the table, with id always first", () => {
    assert.equal(parseCompanyListFields(undefined), null);
    assert.equal(parseCompanyListFields(""), null);
    assert.equal(parseCompanyListFields(["id"]), null);
    assert.deepEqual(parseCompanyListFields("name, companyType ,domain"), ["id", "name", "companyType", "domain"]);
    assert.deepEqual(parseCompanyListFields("name,id,name"), ["id", "name"]);
    // A name that is not a field (a column's SQL name, a guess, SQL) is dropped.
    assert.deepEqual(parseCompanyListFields("name,company_type,password,1; DROP TABLE crm_companies,constructor,toString"), ["id", "name"]);
    assert.deepEqual(parseCompanyListFields("nothing-real"), ["id"]);
    assert.deepEqual(parseCompanyListFields("registeredLocality"), ["id", "registeredLocality"]);
  });

  it("a named-fields read selects only those columns", () => {
    const sql = statement({ fields: ["id", "name", "companyType"] });
    assert.match(sql, /^select "id", "name", "company_type" from "crm_companies"$/);
    // Named fields win over the list columns, and a heavy field can be asked for by name.
    assert.match(statement({ fields: ["id", "amlChecklist"], slim: true }), /^select "id", "aml_checklist" from "crm_companies"$/);
  });

  it("the registered office town is read out of the saved record without sending the record", () => {
    const sql = statement({ fields: ["id", "registeredLocality"] });
    assert.match(sql, /^select "id", "companies_house_data" #>> '\{profile,registeredOfficeAddress,locality\}' from "crm_companies"$/);
  });
});
