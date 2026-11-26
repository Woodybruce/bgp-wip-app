// Heads of terms before HOTs or Solicitors on the Letting Tracker (Jack,
// 26 November 2026): the box has no way round it, and the server refuses the
// move for BGP staff while no heads of terms are on the unit.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the tracker opens the heads of terms box on a move to HOTs or Solicitors, for BGP staff", () => {
  const page = read("client/src/pages/available-units.tsx");
  assert.match(page, /\(toCode === "HOT" \|\| toCode === "SOL"\) && !isClientTracker/);
  assert.match(page, /setHotsGate\(\{ unit, target: toCode \}\)/);
  assert.match(page, /<TrackerHotsGate/);
  assert.match(page, /<DealAmlDialog deal=\{amlDeal\} reason="hots"/);
});

test("the box offers the file or Cancel and nothing else, files the heads of terms and sets the landlord and tenant", () => {
  const box = read("client/src/components/tracker-hots-gate.tsx");
  assert.match(box, /\/api\/unit-hots\/\$\{encodeURIComponent\(unit\.id\)\}\/final/);
  assert.match(box, /heads-of-terms\/read/);
  assert.match(box, /"landlord", "tenant"/);
  assert.doesNotMatch(box, /skip|anyway|without/i);
  const buttons = box.match(/data-testid="tracker-hots-gate-[a-z]+"/g) || [];
  assert.deepEqual(buttons.sort(), ['data-testid="tracker-hots-gate-cancel"', 'data-testid="tracker-hots-gate-choose"', 'data-testid="tracker-hots-gate-drop"', 'data-testid="tracker-hots-gate-error"', 'data-testid="tracker-hots-gate-input"']);
});

test("the unit save refuses a move to HOTs or Solicitors with no heads of terms on the unit", () => {
  const routes = read("server/routes.ts");
  const at = routes.indexOf('code: "HOTS_REQUIRED"');
  assert.ok(at > 0);
  const block = routes.slice(at - 900, at + 200);
  assert.match(block, /!scopedCaller/);
  assert.match(block, /to === "HOT" \|\| to === "SOL"/);
  assert.match(block, /hots_final_file_id, hots_issued_at/);
  assert.match(block, /status\(409\)/);
});

test("a letting's AML window names the landlord and the tenant", () => {
  const board = read("client/src/components/deal-aml-board.tsx");
  assert.match(board, /partiesInvestment = deal\.dealType === "Sale" \|\| deal\.dealType === "Purchase"/);
  assert.match(board, /label: "Landlord"/);
  assert.match(board, /label: "Tenant"/);
});
