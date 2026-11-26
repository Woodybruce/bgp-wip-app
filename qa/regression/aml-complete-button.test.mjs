import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("Complete on a transaction's AML is staff only and reads the parties again on the server", () => {
  const server = read("server/deal-party-aml.ts");
  const at = server.indexOf('router.post("/api/deals/:id/aml-complete"');
  assert.ok(at > 0);
  const route = server.slice(at, server.indexOf("\n});", at));
  assert.ok(route.indexOf("contactViewer") < route.indexOf("checkCounterpartyAml"), "the staff check comes first");
  assert.match(route, /gate\.notReady\.length\) \{\s*return res\.status\(409\)/);
  assert.match(route, /'aml_complete'/);
});

test("the button is grey until every party is settled", () => {
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /<AmlCompleteButton dealId=\{dealId\} ready=\{data\.allApproved\}/);
  assert.match(box, /disabled=\{!ready \|\| save\.isPending/);
  assert.match(box, /const done = ready \? q\.data\?\.complete \|\| null : null;/);
});
