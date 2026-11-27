// Heads of terms before HOTs or Solicitors on every transaction (Jack,
// 26 November 2026: "Lets add this block to these as well"): the transaction
// save (the Transactions table, the Edit form, ChatBGP) and the bulk change
// refuse the move for BGP staff while no heads of terms are on it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hotsGateApplies } from "../../shared/deal-hots-gate.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("which change of status needs the heads of terms", () => {
  assert.equal(hotsGateApplies("NEG", "HOT", "New Letting"), "HOT");
  assert.equal(hotsGateApplies("Negotiating", "HOTs", "Purchase"), "HOT");
  assert.equal(hotsGateApplies("HOT", "SOL", "Sale"), "SOL");
  assert.equal(hotsGateApplies(null, "SOL", null), "SOL");
  assert.equal(hotsGateApplies("HOT", "HOT", "New Letting"), null);
  assert.equal(hotsGateApplies("SOL", "HOT", "New Letting"), null, "a move back is not held");
  assert.equal(hotsGateApplies("EXC", "SOL", "New Letting"), null);
  assert.equal(hotsGateApplies("NEG", "EXC", "New Letting"), null);
  assert.equal(hotsGateApplies("NEG", "WIT", "New Letting"), null);
  assert.equal(hotsGateApplies("NEG", "SOL", "Rent Review"), null, "advisory work has no heads of terms");
});

test("the transaction save and the bulk change refuse the move for BGP staff", () => {
  const crm = read("server/crm.ts");
  const put = crm.slice(crm.indexOf('app.put("/api/crm/deals/:id"'));
  const at = put.indexOf("hotsRequiredDenial");
  assert.ok(at > 0 && at < put.indexOf("--- Approval gate for Invoiced / Completed ---"), "checked before anything is written");
  assert.match(put.slice(at - 400, at + 400), /!editScope/);
  const bulk = crm.slice(crm.indexOf('app.post("/api/crm/deals/bulk-update"'), crm.indexOf('app.post("/api/crm/deals/bulk-delete"'));
  assert.match(bulk, /if \(!scope\) \{\s+const \{ hotsRequiredDenial \}/);
});

test("heads of terms are on a transaction through its tracker unit or its own file", () => {
  const gate = read("server/deal-hots-gate.ts");
  assert.match(gate, /hots_final_file_id IS NOT NULL OR au\.hots_issued_at IS NOT NULL/);
  assert.match(gate, /FROM deal_hots_files WHERE deal_id = \$1/);
  assert.match(gate, /code: HOTS_REQUIRED_CODE/);
  // Who may add a file is decided before it is taken.
  const post = gate.slice(gate.indexOf('post("/api/deals/:id/heads-of-terms/file"'));
  assert.ok(post.indexOf("staffMe(req)") < post.indexOf("upload.single"));
  const index = read("server/index.ts");
  assert.match(index, /CREATE TABLE IF NOT EXISTS deal_hots_files/);
  assert.match(index, /app\.use\(dealHotsGateRouter\)/);
});

test("the Transactions table and the Edit form ask for the file first", () => {
  const page = read("client/src/pages/deals.tsx");
  assert.match(page, /hotsGateApplies\(deal\.status, String\(value \?\? ""\), deal\.dealType\)/);
  assert.match(page, /setStatusGate\(\{ deal, target \}\)/);
  assert.match(page, /hotsGateApplies\(moving\.status, form\.status/);
  assert.match(page, /<DealHotsGate deal=\{hotsGate\?\.deal \|\| null\}[^>]*setParties=\{false\}/);
  const box = read("client/src/components/tracker-hots-gate.tsx");
  assert.match(box, /Add HOTs or Proforma/);
  assert.match(box, /\/api\/deals\/\$\{encodeURIComponent\(deal\.id\)\}\/heads-of-terms\/file/);
  assert.match(box, /"vendor", "purchaser"/);
});

test("New Transaction and the Investment Tracker are held too (27 November 2026)", () => {
  assert.equal(hotsGateApplies(null, "SOL", "Purchase"), "SOL");
  const crm = read("server/crm.ts");
  const post = crm.slice(crm.indexOf('app.post("/api/crm/deals"'));
  const at = post.indexOf("hotsGateApplies(null");
  assert.ok(at > 0 && at < post.indexOf("const deal = await createDeal(req.body"), "refused before the transaction is made");
  assert.match(post.slice(at - 300, at), /if \(!dealScope &&/);
  const tracker = read("server/investment-tracker-service.ts");
  assert.ok(tracker.indexOf("hotsRequiredDenial") > 0 && tracker.indexOf("hotsRequiredDenial") < tracker.indexOf("db.transaction"), "refused before the tracker row is written");
  const page = read("client/src/pages/investment-tracker.tsx");
  assert.match(page, /<DealHotsGate deal=\{hotsGate\?\.deal \|\| null\}/);
  const deals = read("client/src/pages/deals.tsx");
  assert.match(deals, /if \(startsAt\) payload\.status = "NEG";/);
  assert.match(deals, /heads-of-terms\/file/);
});
