// Landsec reports: which schemes a request is given (server/landsec-reports.ts).
// The period rule and the registry are tested in shared/landsec-reports.test.ts.
import "./test-database-url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSchemes, type ReportScheme } from "./landsec-reports";

const scheme = (key: string): ReportScheme => ({ key, name: key.toUpperCase(), town: "", group: "South", properties: [{ id: `p-${key}`, name: key }] });
const allowed = [scheme("bluewater"), scheme("westgate-oxford"), scheme("st-davids")];
const keys = (list: ReportScheme[]) => list.map(s => s.key);

test("no scheme asked for is every scheme the login has", () => {
  for (const none of [undefined, null, "", " ", ",", []]) assert.deepEqual(keys(pickSchemes(allowed, none)), keys(allowed), JSON.stringify(none));
});

test("a scheme asked for narrows the login's schemes, in the login's order", () => {
  assert.deepEqual(keys(pickSchemes(allowed, "st-davids,bluewater")), ["bluewater", "st-davids"]);
  assert.deepEqual(keys(pickSchemes(allowed, ["westgate-oxford"])), ["westgate-oxford"]);
  assert.deepEqual(keys(pickSchemes(allowed, " bluewater , bluewater ")), ["bluewater"]);
});

test("a scheme the login does not have, or that is no scheme, is never added", () => {
  assert.deepEqual(keys(pickSchemes(allowed, "liverpool-one")), []);
  assert.deepEqual(keys(pickSchemes(allowed, "liverpool-one,bluewater,nope")), ["bluewater"]);
  assert.deepEqual(keys(pickSchemes([], "bluewater")), []);
  assert.deepEqual(keys(pickSchemes(allowed, "BLUEWATER")), [], "keys are matched exactly");
  assert.deepEqual(keys(pickSchemes(allowed, { key: "bluewater" })), [], "anything that is not a list of keys names no scheme");
});
