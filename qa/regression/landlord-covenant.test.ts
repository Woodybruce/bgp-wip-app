import assert from "node:assert/strict";
import test from "node:test";
import type { CovenantReport } from "../../server/covenant-engine.ts";
import { interpretLandlordCovenant, handleLandlordCovenant, readLandlordInsolvency, registerLandlordCovenantRoutes } from "../../server/landlord-covenant.ts";

const checkedAt = "2026-10-27T12:00:00Z";
const company = { name: "AEW", uk_entity_name: "AEW EUROPE LLP", companies_house_number: "OC342015" };
const oldReport: CovenantReport = { companyNumber: "OC342015", companyName: "AEW EUROPE LLP", status: "liquidation", grade: "E", score: 0, verdict: "Cannot reliably meet obligations.", flags: [{ level: "red", label: "Liquidation" }], signals: { accounts: { period: "FY2024", cash: "£1,397,000", netAssets: "£1,186,000" } }, missing: [], ccjCheckUrl: "", computedAt: "2026-10-26T12:00:00Z" };
const mvl = { type: "members-voluntary-liquidation", dates: [{ type: "wound-up-on", date: "2026-04-17" }, { type: "declaration-solvent-on", date: "2026-04-16" }] };

test("MVL uses the statutory case type and solvency date, never the old insolvency verdict", () => {
  const result = interpretLandlordCovenant(company, oldReport, { available: true, status: "liquidation", cases: [mvl], checkedAt });
  assert.equal(result.interpretation.kind, "members-voluntary-liquidation");
  assert.match(result.interpretation.title, /Members.*voluntary liquidation/);
  assert.match(result.interpretation.summary, /declaration of solvency/);
  assert.equal(result.assessment, undefined);
  assert.doesNotMatch(JSON.stringify(result), /Cannot reliably meet|"grade"|"score"/);
  assert.equal(result.financial?.netAssets, "£1,186,000");
  assert.deepEqual(result.interpretation.dates.map(date => [date.type, date.date]), [["declaration-solvent-on", "2026-04-16"], ["wound-up-on", "2026-04-17"]]);
  assert.match(result.interpretation.context.join(" "), /not the wider group/);
  assert.match(result.interpretation.context.join(" "), /billing/);
  assert.equal(result.sourceUrl, "https://find-and-update.company-information.service.gov.uk/company/OC342015/insolvency");
});

test("AEW transfer evidence is exact-entity context and never changes the saved number", () => {
  const result = interpretLandlordCovenant(company, oldReport, { available: true, cases: [mvl], checkedAt });
  assert.equal(result.companyNumber, "OC342015");
  assert.match(result.interpretation.evidence![0].text, /31 March 2023/);
  assert.match(result.interpretation.evidence![1].text, /OC367686/);
  assert.ok(result.interpretation.evidence!.every(item => item.sourceUrl.startsWith("https://") && item.reviewedAt === "2026-10-27"));
  const unrelated = interpretLandlordCovenant({ ...company, companies_house_number: "12345678" }, null, { available: true, cases: [mvl], checkedAt });
  assert.equal(unrelated.interpretation.evidence, undefined);
});

test("mixed MVL and creditor histories are not presented as a clean solvent winding-up", () => {
  const result = interpretLandlordCovenant(company, oldReport, { available: true, cases: [mvl, { type: "creditors-voluntary-liquidation", dates: [{ type: "wound-up-on", date: "2026-09-01" }] }], checkedAt });
  assert.equal(result.interpretation.kind, "mixed-history");
  assert.match(result.interpretation.summary, /alongside other case types/);
  assert.equal(result.assessment, undefined);
  const creditor = interpretLandlordCovenant(company, oldReport, { available: true, cases: [{ type: "creditors-voluntary-liquidation" }], checkedAt });
  assert.equal(creditor.interpretation.kind, "creditor-process");
  assert.match(creditor.interpretation.title, /Creditors/);
  assert.equal(creditor.assessment, undefined);
});

test("missing, unknown or failed case data cannot imply insolvency or resurrect a flawed grade", () => {
  for (const evidence of [
    { available: false, cases: [] },
    { available: true, cases: [] },
    { available: true, cases: [{ type: "voluntary-liquidation" }] },
    { available: true, cases: [{ type: "future-unknown-enum" }] },
  ]) {
    const result = interpretLandlordCovenant(company, oldReport, { ...evidence, checkedAt });
    assert.equal(result.interpretation.kind, "unknown");
    assert.equal(result.assessment, undefined);
  }
  const noDeclaration = interpretLandlordCovenant(company, oldReport, { available: true, cases: [{ type: mvl.type, dates: [{ type: "declaration-solvent-on", date: "2026-99-99" }] }], checkedAt });
  assert.match(noDeclaration.interpretation.summary, /does not include/);
  assert.equal(noDeclaration.interpretation.dates.length, 0);
});

test("regular verified records retain the existing assessment and unlinked records stay unassessed", () => {
  const active = { ...oldReport, status: "active", grade: "B", score: 80, verdict: "Positive net assets.", flags: [] } as CovenantReport;
  const result = interpretLandlordCovenant(company, active, { available: true, cases: [], checkedAt });
  assert.equal(result.interpretation.kind, "standard");
  assert.equal(result.assessment?.grade, "B");
  const unlinked = interpretLandlordCovenant({ ...company, companies_house_number: null }, oldReport, { available: false, cases: [], checkedAt });
  assert.equal(unlinked.interpretation.kind, "unlinked");
  assert.equal(unlinked.assessment, undefined);
  assert.equal(unlinked.companyNumber, null);
  assert.equal(unlinked.sourceUrl, null);
});

test("staff and landlord checks precede all external case retrieval, and route retains authentication", async () => {
  let route: any[] = [];
  const auth = () => {};
  registerLandlordCovenantRoutes({ get: (...args: any[]) => { route = args; } } as any, auth as any);
  assert.equal(route[0], "/api/landlord-relationships/:companyId/covenant");
  assert.equal(route[1], auth);
  let status = 200, body: any, queries = 0, external = 0;
  const res: any = { status: (value: number) => { status = value; return res; }, json: (value: any) => { body = value; return res; } };
  const req: any = { params: { companyId: "saved-company" }, query: {} };
  const q = { query: async (sql: string, values?: any[]) => { queries++; assert.match(sql, /c\.merged_into_id IS NULL/); assert.match(sql, /NOT LIKE 'tenant%'/); assert.deepEqual(values, ["saved-company"]); return { rows: [] }; } };
  const insolvency = async () => { external++; return { available: true, cases: [], checkedAt }; };
  await handleLandlordCovenant(req, res, { canRead: async () => false, q, insolvency });
  assert.equal(status, 403); assert.equal(queries, 0); assert.equal(external, 0);
  await handleLandlordCovenant(req, res, { canRead: async () => true, q, insolvency });
  assert.equal(status, 404); assert.equal(queries, 1); assert.equal(external, 0); assert.match(body.error, /Landlord not found/);
});

test("landlord route reads existing cache only and does not write shared reports", async () => {
  const queries: string[] = []; let body: any;
  const q = { query: async (sql: string) => { queries.push(sql); return { rows: sql.includes("FROM crm_companies") ? [company] : [{ report: oldReport }] }; } };
  await handleLandlordCovenant({ params: { companyId: "example" }, query: { refresh: "1" } } as any, { status: () => assert.fail("Unexpected route error"), json: (value: any) => { body = value; } } as any, {
    q, canRead: async () => true, insolvency: async (number, options) => { assert.equal(number, "OC342015"); assert.equal(options?.refresh, true); return { available: true, cases: [mvl], checkedAt }; },
  });
  assert.equal(body.interpretation.kind, mvl.type);
  assert.ok(queries.every(sql => sql.startsWith("SELECT")));
  assert.equal(queries.length, 2);
});

test("source cache coalesces requests, expires and retries errors without treating API failures as no cases", async () => {
  let clock = Date.parse(checkedAt), calls = 0;
  const fetcher = async () => { calls++; return { status: "liquidation", cases: [mvl] }; };
  const options = { now: () => clock, fetcher };
  const responses = await Promise.all([readLandlordInsolvency("OC999991", options), readLandlordInsolvency("OC999991", options)]);
  assert.equal(calls, 1); assert.deepEqual(responses[0], responses[1]);
  await readLandlordInsolvency("OC999991", options); assert.equal(calls, 1);
  clock += 300_001; await readLandlordInsolvency("OC999991", options); assert.equal(calls, 2);
  let errors = 0;
  const failureOptions = { now: () => clock, fetcher: async () => { errors++; throw new Error("Companies House API error 429: throttled"); } };
  assert.equal((await readLandlordInsolvency("OC999992", failureOptions)).available, false);
  await readLandlordInsolvency("OC999992", failureOptions); assert.equal(errors, 1);
  clock += 30_001; await readLandlordInsolvency("OC999992", failureOptions); assert.equal(errors, 2);
  const noCases = await readLandlordInsolvency("OC999993", { fetcher: async () => { throw new Error("Companies House API error 404: not found"); } });
  assert.equal(noCases.available, true); assert.deepEqual(noCases.cases, []);
});
