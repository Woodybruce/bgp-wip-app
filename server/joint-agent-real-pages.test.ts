// A joint agent on the real Properties and Deals pages (Woody, 2026-11-14:
// "joint agent can do anything other than see brands", with BGP's own records
// kept private): what it is never sent on a property or a deal, and the
// handlers that cut the answer to the schemes on its login.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withoutJointAgentFields, JOINT_AGENT_HIDDEN_PROPERTY_FIELDS, JOINT_AGENT_HIDDEN_DEAL_FIELDS } from "../shared/landsec";

test("BGP's own fields are left off a property, in either spelling", () => {
  const row = { id: "p1", name: "Bluewater", notes: "BGP note", bgpCommentary: "ours", bgp_commentary_at: "x", bgpContactUserIds: ["u"], sharepointFolderUrl: "s", proprietorKycData: {}, address: "Kent" };
  assert.deepEqual(withoutJointAgentFields(row, JOINT_AGENT_HIDDEN_PROPERTY_FIELDS), { id: "p1", name: "Bluewater", address: "Kent" });
});

test("BGP's fee, invoicing, contacts, comments and compliance are left off a deal", () => {
  const row = {
    id: "d1", name: "U124 letting", status: "SOL", propertyId: "p1", rentPa: 120000, tenantId: "t1",
    fee: 1000, feePercentage: 10, invoicingNotes: "x", xeroContactName: "x", comments: "BGP comment", internalAgent: "Rob",
    clientContactId: "c", tenantContactId: "c", amlRiskLevel: "high", aml_pep_status: "x", kycApproved: true, mlrScope: "x", poNumber: "1",
  };
  assert.deepEqual(withoutJointAgentFields(row, JOINT_AGENT_HIDDEN_DEAL_FIELDS), { id: "d1", name: "U124 letting", status: "SOL", propertyId: "p1", rentPa: 120000, tenantId: "t1" });
});

test("the property and deal reads, the schedules and the plan parts cut the answer to the joint agent's schemes", () => {
  const crm = readFileSync("server/crm.ts", "utf8");
  const list = (route: string) => crm.slice(crm.indexOf(`app.get("${route}"`), crm.indexOf("app.", crm.indexOf(`app.get("${route}"`) + 10));
  for (const route of ["/api/crm/properties", "/api/crm/properties/:id", "/api/crm/deals", "/api/crm/deals/:id"]) {
    assert.match(list(route), /schemeLimitedPropertyIdsOrNone\(req, /, route);
    assert.match(list(route), /withoutJointAgentFields\(/, route);
  }
  // A record off the schemes is refused, not cut.
  assert.match(list("/api/crm/properties/:id"), /if \(!jaIds\.includes\(String\(req\.params\.id\)\)\) return res\.status\(403\)/);
  assert.match(list("/api/crm/deals/:id"), /if \(!deal\.propertyId \|\| !jaIds\.includes\(deal\.propertyId\)\) return res\.status\(403\)/);
  // A deal on the list must sit on one of its schemes' properties.
  assert.match(list("/api/crm/deals"), /d\.propertyId && jaIds\.includes\(d\.propertyId\)/);
  const schedule = readFileSync("server/tenancy-schedule.ts", "utf8");
  assert.equal(schedule.match(/schemeLimitedPropertyIdsOrNone\(req as any, "tenancy-schedule(-links)?"\)/g)?.length, 2);
  // Plans, brochures and the schemes list use the shared property check,
  // which holds a joint agent to its schemes.
  for (const [file, route] of [["server/property-plans.ts", "/api/properties/:propertyId/plans"], ["server/property-brochures.ts", "/api/properties/:id/brochures"], ["server/property-schemes.ts", "/api/properties/:id/schemes"]]) {
    const src = readFileSync(file, "utf8");
    const at = src.indexOf(`get("${route}"`);
    assert.ok(at > 0, route);
    assert.match(src.slice(at, at + 400), /clientBlockedForProperty\(/, route);
  }
  const scope = readFileSync("server/company-scope.ts", "utf8");
  assert.match(scope, /const schemeIds = await briefSchemePropertyIds\(req\);\s*return !!schemeIds && !schemeIds\.has\(propertyId\);/);
});
