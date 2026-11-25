// A private individual's date of birth and nationality, typed in by BGP
// (Woody, 24 November 2026). Source guards; the rules are tested in
// server/kyc-person-details.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the route: BGP staff as themselves, a private individual only, the checks run again with it", () => {
  const s = read("server/deal-party-aml.ts");
  const at = s.indexOf('router.put(["/api/deals/:id/parties/:role/person-details", "/api/client-kyc/:companyId/subjects/:entity/person-details"]');
  assert.ok(at > 0);
  const body = s.slice(at, at + 2600);
  assert.match(body, /contactViewer\(req\)\)\.staff\) return res\.status\(403\)/);
  assert.match(body, /\(await partyKindOf\(pool, party\)\) !== "individual"/);
  assert.match(body, /personDetailsInput\(req\.body\)/);
  // The date itself goes on the KYC history only, never on the transaction's history.
  assert.match(body, /dealAudit\(party\.dealId, "aml_person_details", null, "recorded"/);
  assert.match(body, /startPrecheck\(party\.brandId, \{ dealId: party\.dealId, userId, force: true, entityId: party\.entityId \}\)/);
  assert.match(read("server/kyc-person-details.ts"), /INSERT INTO kyc_audit_log \(company_id, action, performed_by, notes, entity_kind, entity_id\) VALUES \(\$1, 'person_details'/);
});

test("BGP's checks screen the private individual with it; the sign-off and the five-year deletion read it", () => {
  const checks = read("server/kyc-prechecks.ts");
  assert.match(checks, /const born = dobParts\(personDetails\?\.dateOfBirth\);/);
  assert.match(checks, /role: "the party", person: true, dobYear: born\?\.year \?\? null, dobMonth: born\?\.month \?\? null,/);
  const aml = read("server/deal-party-aml.ts");
  assert.match(aml, /dobNeeded: dobNeeded && !personDetails,/);
  assert.match(aml, /person: facts\.person \?\? null,/);
  const retention = read("server/aml-records-retention.ts");
  assert.match(retention, /\{ table: "kyc_person_details", party: "company_id", at: "recorded_at" \}/);
  assert.match(retention, /DELETE FROM kyc_person_details WHERE company_id = \$1/);
  assert.match(read("server/index.ts"), /CREATE UNIQUE INDEX IF NOT EXISTS kyc_person_details_party_idx ON kyc_person_details \(company_id, COALESCE\(trading_entity_id, ''\)\)/);
});

test("the screens: one line, in the AML box and the client KYC window", () => {
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /<PersonDetailsLine view=\{decision\.person\} url=\{`\/api\/deals\/\$\{dealId\}\/parties\/\$\{cp\.role\}\/person-details`\}/);
  assert.match(box, /case "person_details": return <Button/);
  const win = read("client/src/components/client-kyc/client-kyc-dialog.tsx");
  assert.match(win, /<PersonDetailsLine view=\{view\.signOff\.person\}/);
});
