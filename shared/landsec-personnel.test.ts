import test from "node:test";
import assert from "node:assert/strict";
import { landsecSchemeTeamFor, landsecTeamSuggestions } from "./landsec-personnel";

// Bluewater as Landsec described it on 18 November 2026.
test("Bluewater suggests the people who agree a brief, in their roles", () => {
  const s = landsecTeamSuggestions("Bluewater Shopping Centre");
  const names = (role: string) => s.filter(p => p.role === role).map(p => p.name);
  assert.deepEqual(names("senior_asset_manager"), ["Will Harvey"]);
  assert.deepEqual(names("asset_manager"), ["Alice Wilkins"]);
  assert.equal(names("client_leasing")[0], "Jonny Rushton");
  assert.deepEqual(names("bgp_agent"), ["Millie Edwards", "Emily Dumbell", "Alex Todd", "Kate Martin"]);
  assert.equal(s.filter(p => p.name === "Will Harvey").length, 1);
});

test("people who are only kept informed are on the team but are not suggested on a brief", () => {
  const team = landsecSchemeTeamFor("Bluewater")!;
  const suggested = landsecTeamSuggestions("Bluewater").map(p => p.name);
  for (const name of ["Gemma Casey", "Rebecca Blenkinsop", "Mark Warne"]) {
    assert.ok([...team.assetManagers, ...team.leasing].includes(name), `${name} is on the team`);
    assert.ok(!suggested.includes(name), `${name} is not asked to agree a brief`);
  }
});

test("a scheme with nobody marked as informed or senior suggests its whole sheet", () => {
  const s = landsecTeamSuggestions("Trinity Leeds");
  assert.ok(s.some(p => p.name === "Mark Warne" && p.role === "client_leasing"));
  assert.ok(s.some(p => p.name === "Rob Hardie" && p.role === "asset_manager"));
  assert.ok(!s.some(p => p.role === "senior_asset_manager"));
});
