// KYC4U takes requests only on its portal: the pack, Submitted on KYC4U's
// portal, and a prepared request no longer counting as with KYC4U (Jack,
// 20 November 2026). Rules tested in server/kyc4u-portal.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("a prepared request is not with KYC4U: the sign-off and the dashboard count only submitted ones", () => {
  assert.match(read("server/deal-party-aml.ts"), /d\.deal_id = \$1 AND d\.company_id = \$2 AND d\.status IN \('filled', 'submitted'\)/);
  assert.match(read("server/aml-dashboard.ts"), /d\.deal_id = ANY\(\$1::varchar\[\]\) AND d\.status IN \('filled', 'submitted'\)/);
  assert.match(read("client/src/components/deal-aml-status.tsx"), /const draftState = kyc4uDraftState\(draft\);/);
});

test("the pack and the submitted record are BGP staff's, and the submitted record is written on both histories", () => {
  const k = read("server/kyc4u.ts");
  assert.match(k, /app\.get\("\/api\/kyc4u\/drafts\/:id\/pack", requireAuth, async[\s\S]{0,120}if \(!await staffOnly\(req, res\)\) return;/);
  assert.match(k, /app\.post\("\/api\/kyc4u\/submitted", requireAuth, async[\s\S]{0,120}if \(!await staffOnly\(req, res\)\) return;/);
  assert.match(k, /'kyc4u_submitted', \$2, \$3\)/);
  assert.match(k, /deal_audit_log [\s\S]{0,140}'kyc4u_submitted'/);
  assert.match(read("server/index.ts"), /ALTER TABLE kyc4u_drafts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP/);
});

test("the request dialog leads to the pack, the portal and the record, not the bookmark", () => {
  const p = read("client/src/components/kyc4u-panel.tsx");
  assert.match(p, /data-testid="kyc4u-next-steps"/);
  assert.match(p, /<Kyc4uPackButton draftId=\{savedId\}/);
  assert.match(p, /<Kyc4uSubmittedButton dealId=\{dealId\} companyId=\{companyId\}/);
  assert.match(read("server/kyc4u-pack.ts"), /01 Request for KYC4U - /);
});
