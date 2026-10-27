import assert from "node:assert/strict";
import test from "node:test";
import type { CovenantReport } from "../../server/covenant-engine.ts";
import { interpretLandlordCovenant, handleLandlordCovenant, readLandlordInsolvency, registerLandlordCovenantRoutes } from "../../server/landlord-covenant.ts";
import { buildLandlordCovenantOverview } from "../../server/landlord-covenant-overview.ts";

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
    q, canRead: async () => true, insolvency: async (number, options) => { assert.ok(["OC342015", "OC367686"].includes(number)); assert.equal(options?.refresh, true); return { available: true, cases: number === "OC342015" ? [mvl] : [], checkedAt }; },
  });
  assert.equal(body.interpretation.kind, mvl.type);
  assert.equal(body.companyNumber, "OC342015");
  assert.equal(body.overview.financial.companyNumber, "OC367686");
  assert.equal(body.assessment, undefined);
  assert.ok(queries.every(sql => sql.startsWith("SELECT")));
  assert.equal(queries.length, 2);
});

test("company/group overview uses current audited AEW figures separately from the saved historical entity", () => {
  const legal = interpretLandlordCovenant(company, oldReport, { available: true, cases: [mvl], checkedAt });
  const operating = interpretLandlordCovenant({ name: "AEW UK Investment Management LLP", companies_house_number: "OC367686" }, null, { available: true, cases: [], checkedAt });
  const summary = buildLandlordCovenantOverview(company, legal, operating);
  assert.match(summary.company, /£10.7m net assets.*£8.8m cash.*December 2025.*£1.4m annual loss/);
  assert.match(summary.group!, /Natixis Investment Managers.*Groupe BPCE/);
  assert.match(summary.group!, /support from AEW SA.*24 April 2026/);
  assert.equal(summary.financial?.companyNumber, "OC367686");
  assert.equal(summary.financial?.facts.find(fact => fact.label === "Net current assets")?.value, "£8.949m");
  assert.match(summary.entityNote!, /former operating company.*solvent winding-up/);
  assert.equal(summary.warning, undefined);
  assert.match(summary.limitations.join(" "), /not evidence of a guarantee/);
  assert.ok(summary.evidence.some(item => item.sourceUrl.includes("MzUyMDQ4MzQxN2FkaXF6a2N4") && item.text.includes("11 May 2026")));
  assert.equal(legal.companyNumber, "OC342015");
  assert.equal(legal.financial?.netAssets, "£1,186,000");
  assert.equal(legal.assessment, undefined);
});

test("reviewed group context cannot suppress material current or saved-entity proceedings", () => {
  const creditor = { type: "creditors-voluntary-liquidation" };
  const legal = interpretLandlordCovenant(company, oldReport, { available: true, cases: [mvl], checkedAt });
  const operating = interpretLandlordCovenant({ name: "AEW UK Investment Management LLP", companies_house_number: "OC367686" }, null, { available: true, cases: [creditor], checkedAt });
  assert.match(buildLandlordCovenantOverview(company, legal, operating).warning!.title, /UK Investment.*creditors/);
  assert.doesNotMatch(buildLandlordCovenantOverview(company, legal, operating).title, /Positive/);
  const operatingMvl = interpretLandlordCovenant({ name: "AEW UK Investment Management LLP", companies_house_number: "OC367686" }, null, { available: true, cases: [mvl], checkedAt });
  assert.match(buildLandlordCovenantOverview(company, legal, operatingMvl).warning!.title, /UK operating company.*winding-up/);
  const mixed = interpretLandlordCovenant(company, oldReport, { available: true, cases: [mvl, creditor], checkedAt });
  assert.match(buildLandlordCovenantOverview(company, mixed).warning!.title, /multiple proceedings/);
  assert.match(buildLandlordCovenantOverview(company, legal).limitations.join(" "), /insolvency check is unavailable/);
});

test("other landlords receive their own financial and group context without AEW evidence or an invented guarantee", () => {
  const other = { name: "Example Estates", companies_house_number: "12345678", parent_name: "Example Holdings", parent_number: "87654321", parent_report: { ...oldReport, companyNumber: "87654321", companyName: "Example Holdings", signals: { accounts: { period: "FY2025", netAssets: "£30m" } } } };
  const report = { ...oldReport, companyNumber: "12345678", companyName: "Example Estates", status: "active", flags: [], signals: { accounts: { period: "FY2025", netAssets: "£2m", cash: "£500,000" } } };
  const legal = interpretLandlordCovenant(other, report, { available: true, cases: [], checkedAt });
  const summary = buildLandlordCovenantOverview(other, legal);
  assert.match(summary.title, /Positive net assets/);
  assert.match(summary.company, /Example Estates reports £2m net assets, £500,000 cash/);
  assert.match(summary.group!, /Example Holdings.*separate accounts.*£30m/);
  assert.match(summary.group!, /No support commitment or guarantee is recorded/);
  assert.equal(summary.financial?.companyNumber, "12345678");
  assert.doesNotMatch(JSON.stringify(summary), /AEW|Natixis|BPCE|£10.7m/);
  const unknown = buildLandlordCovenantOverview({ name: "Unlinked owner" }, interpretLandlordCovenant({ name: "Unlinked owner", companies_house_number: null }, null, { available: false, cases: [], checkedAt }));
  assert.match(unknown.company, /not yet been recorded/);
  assert.equal(unknown.financial, undefined);
  assert.match(unknown.entityNote!, /contracting legal entity/);
});

test("generic headlines distinguish net liabilities, losses and missing figures without creating a grade", () => {
  const other = { name: "Other owner", companies_house_number: "12345678" };
  const legal = interpretLandlordCovenant(other, null, { available: true, cases: [], checkedAt });
  for (const [financial, expected] of [
    [{ netAssets: "(£2.5m)", cash: "£0" }, /Net liabilities/],
    [{ netAssets: "£2m", profitBeforeTax: "-£500,000" }, /report a loss/],
    [{ netAssets: "Unknown", cash: "Not disclosed" }, /Company and group covenant/],
  ] as const) {
    const result = buildLandlordCovenantOverview(other, { ...legal, financial });
    assert.match(result.title, expected);
    assert.doesNotMatch(JSON.stringify(result), /"grade"|"score"/);
  }
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
