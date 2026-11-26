// A past KYC4U sign-off records its due diligence (Woody, 25 November 2026, on
// Sheet Anchor Evolve: signed off 24 Feb 2025 and read as expired a year on).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the sign-off stores its re-check years, standard (3) unless enhanced is chosen", () => {
  const s = read("server/kyc4u.ts");
  assert.match(s, /const years = Number\(req\.body\?\.recheckYears\) === 1 \? 1 : 3;/);
  assert.match(s, /"Re-check years": years/);
  const panel = read("client/src/components/kyc4u-panel.tsx");
  assert.match(panel, /recheckYears: years/);
  assert.match(panel, /data-testid="kyc4u-signoff-until"/);
});

// Jack, 26 November 2026: recorded from a transaction's party, the sign-off went
// on the brand's record and the party (another company signs) stayed uncleared.
test("a past sign-off recorded on a transaction's party goes on the company that signs", () => {
  const s = readFileSync(new URL("../../server/kyc4u.ts", import.meta.url), "utf8");
  const route = s.slice(s.indexOf('app.post("/api/kyc4u/company/:companyId/signoff"'), s.indexOf('app.post("/api/kyc4u/rematch"'));
  assert.match(route, /loadAmlParty\(pool as any, String\(req\.body\.dealId\), String\(req\.body\.role\) as any\)/);
  assert.match(route, /if \(!party \|\| party\.brandId !== companyId\) return res\.status\(400\)/);
  assert.match(route, /onBrand = party\.sameCompany;/);
  assert.match(route, /onBrand \? companyId : null, companyId, entityId,/);
  const box = readFileSync(new URL("../../client/src/components/deal-aml-status.tsx", import.meta.url), "utf8");
  assert.match(box, /<Kyc4uStatusStrip companyId=\{cp\.id\} party=\{\{ dealId, role: cp\.role \}\} \/>/);
});
