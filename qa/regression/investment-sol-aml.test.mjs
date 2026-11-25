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
  assert.match(tracker, /<DealAmlDialog deal=\{amlDeal\} reason=\{amlDeal\?\.reason \|\| "solicitors"\}/);
});

// Issue 4 of BGP's AML policy (23 November 2026): the seller, BGP's client, is
// checked before marketing, so a sale's first move to Live or Available opens it too.
test("the Investment Tracker opens it when a sale first goes on the market", () => {
  const service = read("server/investment-tracker-service.ts");
  assert.match(service, /const toMarket = statusMoved && row\.boardType === "Sales" && \["LIVE", "AVA"\]\.includes/);
  assert.match(service, /\.\.\.\(toMarket && row\.dealId \? \{ amlBeforeMarketing: true \} : \{\}\)/);
  const tracker = read("client/src/pages/investment-tracker.tsx");
  assert.match(tracker, /\} else if \(body\?\.amlBeforeMarketing && body\?\.dealId\) \{/);
  assert.match(tracker, /reason: "marketing" \}\);/);
  assert.match(read("client/src/components/deal-aml-dialog.tsx"), /reason === "marketing" \? "On the market: check the seller"/);
});

test("the property page offers an AML pill per open deal, to BGP staff only", () => {
  const page = read("client/src/components/property-detail.tsx");
  assert.match(page, /enabled: !!id && !isClientViewer/);
  assert.match(page, /!isClientViewer && !landsecView && amlDeals\.slice\(0, 4\)/);
  assert.match(page, /<DealAmlDialog deal=\{amlDeal\} reason="property"/);
});
