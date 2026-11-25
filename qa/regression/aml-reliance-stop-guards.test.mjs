// Relying on another firm's checks (MLR 2017 reg 39) and BGP stopping acting
// on a deal (reg 31), both Woody, 21 November 2026 ("Yes go ahead"). Source
// guards; the rules are tested in server/aml-reliance.test.ts and
// server/aml-stop.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("reliance is the officers' to record and withdraw, on one deal, with the firm's letter", () => {
  const s = read("server/deal-party-aml.ts");
  assert.match(s, /router\.post\("\/api\/deals\/:id\/parties\/:role\/reliance", deciderFirst, takeFiles/);
  const withdraw = s.slice(s.indexOf('"/api/deals/:id/parties/:role/reliance/:relianceId/withdraw"'));
  assert.match(withdraw.slice(0, 400), /await decider\(req\)/);
  // The officer's form, or what the joint agent agreed on its page filling what was left blank (22 November 2026).
  assert.match(s, /let body: Record<string, unknown> = req\.body \|\| \{\};/);
  assert.match(s, /const said = relianceInput\(body\);/);
  assert.match(s, /Add the firm's letter or email/);
  assert.match(s, /'reliance_letter'/);
  // Agreed for one deal: read by the deal, never carried to the party's other deals.
  assert.match(read("server/kyc-people.ts"), /FROM kyc_reliance WHERE deal_id = \$1 AND company_id = \$2/);
  // Every caller of the people loader passes the deal.
  for (const f of ["server/aml-file.ts", "server/aml-portal.ts", "server/deal-parties.ts", "server/deal-party-aml.ts"]) {
    for (const call of read(f).match(/partyPeopleFor\(\{[^}]*\}/g) || []) assert.match(call, /dealId/, `${f}: ${call}`);
  }
});

test("reliance stands in for the client checks, not for enhanced due diligence", () => {
  const box = read("shared/aml-box.ts");
  const at = (needle) => box.indexOf(needle);
  assert.ok(at("if (f.reliance)") > at("if (f.redFlags > 0)"), "red flags come first");
  assert.ok(at("if (f.reliance)") > at("if (f.ownersAbroad)"), "owners abroad come first");
  assert.ok(at("if (f.reliance)") > at("if (f.trust)"), "a trust comes first");
  assert.match(read("shared/party-kyc.ts"), /!f\.sanctionsOnly && !f\.reliance && text\(f\.note\)/);
  assert.match(read("shared/aml-dashboard.ts"), /stage === "relied"/);
});

test("the reliance table is in the boot migrations, five-year deletion and company merges", () => {
  assert.match(read("server/index.ts"), /CREATE TABLE IF NOT EXISTS kyc_reliance/);
  const ret = read("server/aml-records-retention.ts");
  assert.match(ret, /\{ table: "kyc_reliance", party: "company_id"/);
  assert.match(ret, /DELETE FROM kyc_reliance WHERE company_id = \$1/);
  assert.match(ret, /DELETE FROM kyc_reliance WHERE deal_id = \$1/);
  assert.match(read("server/brand-dedupe.ts"), /\{ table: "kyc_reliance",\s+column: "company_id" \}/);
});

test("a stopped deal cannot move on through any door, be invoiced or be deleted", () => {
  assert.match(read("server/deal-gates.ts"), /const stopped = await amlStopDenial\(dealId, newStatusRaw\);\s+if \(stopped\) return stopped;/);
  const crm = read("server/crm.ts");
  const put = crm.slice(crm.indexOf('app.put("/api/crm/deals/:id"'));
  assert.match(put.slice(0, 6000), /amlStopDenial\(String\(req\.params\.id\), req\.body\.status\)/);
  const bulk = crm.slice(crm.indexOf('app.post("/api/crm/deals/bulk-update"'));
  assert.match(bulk.slice(0, 5000), /const stopped = await amlStopDenial\(id, value\);/);
  const bulkDelete = crm.slice(crm.indexOf('app.post("/api/crm/deals/bulk-delete"'));
  assert.ok(bulkDelete.indexOf("stoppedDealIds") < bulkDelete.indexOf("deleteCrmDeal"));
  const del = crm.slice(crm.indexOf('app.delete("/api/crm/deals/:id"'));
  assert.ok(del.indexOf("stoppedDealIds") < del.indexOf("deleteCrmDeal"));
  const xero = read("server/xero.ts");
  const create = xero.slice(xero.indexOf('app.post("/api/xero/invoices"'));
  assert.ok(create.indexOf("stoppedDealIds") > 0 && create.indexOf("stoppedDealIds") < create.indexOf("invoiceCurrencyFields"));
});

test("stopping and releasing are the officers'; the banner is BGP staff's; the reason is the officers' alone", () => {
  const s = read("server/aml-stop.ts");
  for (const route of ['router.post("/api/deals/:id/aml-stop"', 'router.post("/api/deals/:id/aml-stop/resume"']) {
    assert.match(s.slice(s.indexOf(route), s.indexOf(route) + 400), /const me = await officerOf\(req\);\s+if \(!\("id" in me\)\)/, route);
  }
  const get = s.slice(s.indexOf('router.get("/api/deals/:id/aml-stop"'));
  assert.match(get.slice(0, 400), /const me = await staffMe\(req\);\s+if \(!me\) return res\.status\(403\)/);
  assert.match(s, /\.\.\.\(officer \? \{ reason: stop\.reason/);
  assert.match(read("server/index.ts"), /app\.use\(amlStopRouter\);/);
  // The agents' email never carries the reason or the note.
  const email = read("shared/kyc-request.ts");
  const fn = email.slice(email.indexOf("export function amlStoppedEmail"), email.indexOf("export function amlRegisterNoticeEmail"));
  assert.doesNotMatch(fn, /\b(reason|reasonWords|note)\??:|ctx\.(reason|note)/);
  // Nor what a status move or a client is told.
  assert.doesNotMatch(read("shared/aml-stop.ts").match(/AML_STOP_REFUSAL = "([^"]+)"/)[1], /AML|money laundering|Nominated Officer/);
});

test("the international pieces stay international: a UK company is read as it always was", () => {
  // A company with no UK record is followed as a company abroad only when it
  // reads as registered abroad; GLEIF is also asked about a UK party since the
  // same evening, as a line with its parents screened (uk-screening-guards).
  assert.match(read("server/kyc-prechecks.ts"), /if \(name && \(looksOverseasName\(name\) \|\| ownerRegister\(crmCountry\) === "abroad"\)\) \{\s+const trace = partyGleif\?\.trace/);
  // The English word "Foundation" counts only abroad.
  assert.match(read("shared/deal-parties.ts"), /\|\| \(!!opts\.abroad && \/\\bfoundation\\b\/i\.test\(t\)\)/);
  assert.match(read("shared/aml-policy.ts"), /foundationMarkInName\(o\.name, \{ abroad: ownerRegister\(o\.country\) === "abroad" \}\)/);
});

test("a client login's deal history never shows BGP's AML lines", () => {
  const crm = read("server/crm.ts");
  // Since 24 November 2026 BGP's invoicing lines too (xero_invoice_approved, _emailed ...).
  assert.match(crm, /!CLIENT_HIDDEN_AUDIT_FIELDS\.has\(l\.field\) && !\/\^\(aml\|kyc\|client_checks\|xero\)\/i\.test/);
});
