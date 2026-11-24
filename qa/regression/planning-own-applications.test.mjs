// The planning card lists the property's own applications apart from its
// neighbours' (Woody, 2026-11-24, 26A and 26B The Pavement), and ChatBGP reads
// one application on its council's Idox register (get_planning_application).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the summary splits own applications from nearby ones by address", () => {
  const s = read("server/planning-summary.ts");
  assert.match(s, /planningAddressFit\(a\.address, key\)/);
  assert.match(s, /nearbyApplications/);
  assert.match(s, /idoxBuildingHistory\(/);
  assert.match(s, /addressKnown: !!key/);
});

test("the card shows this building first and the neighbours apart", () => {
  const c = read("client/src/components/property-planning-card.tsx");
  assert.match(c, /Planning history at this address/);
  assert.match(c, /Nearby, not this building/);
});

test("ChatBGP has get_planning_application, read from the council's own register in one session", () => {
  const chat = read("server/chatbgp.ts");
  assert.match(chat, /name: "get_planning_application"/);
  assert.match(chat, /tcName === "get_planning_application"/);
  const idox = read("server/idox-application.ts");
  assert.match(idox, /search\.do\?action=simple/);
  assert.match(idox, /_csrf/);
  assert.match(read("server/chatbgp-app-map.ts"), /get_planning_application/);
});
