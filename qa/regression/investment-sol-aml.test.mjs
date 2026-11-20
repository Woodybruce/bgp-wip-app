// Jack, 2026-11-20: an investment deal moving to Solicitors asks for the AML,
// and the property page has an AML option. Both open the deal's own AML box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the AML window is the deal page's own AML card", () => {
  const dialog = read("client/src/components/deal-aml-dialog.tsx");
  assert.match(dialog, /<DealAmlStatusCard dealId=\{deal\.id\}/);
  assert.match(dialog, /\/deals\/\$\{deal\.id\}\?section=parties/);
});

test("the Investment Tracker opens it on a move to Solicitors, single and bulk", () => {
  const tracker = read("client/src/pages/investment-tracker.tsx");
  assert.match(tracker, /legacyToCode\(vars\.data\.status\) === "SOL" && !!body\?\.dealId/);
  assert.match(tracker, /legacyToCode\(status\) === "SOL"/);
  assert.match(tracker, /<DealAmlDialog deal=\{amlDeal\} reason="solicitors"/);
});

test("the property page offers an AML pill per open deal, to BGP staff only", () => {
  const page = read("client/src/components/property-detail.tsx");
  assert.match(page, /enabled: !!id && !isClientViewer/);
  assert.match(page, /!isClientViewer && amlDeals\.slice\(0, 4\)/);
  assert.match(page, /<DealAmlDialog deal=\{amlDeal\} reason="property"/);
});
