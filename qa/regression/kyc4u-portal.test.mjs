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

// KYC4U is no longer used (Woody, 23 November 2026): nothing new is sent to them, and their past records stay.
test("no new KYC4U work: the routes that start or send it answer 410, the bookmark fills no form, no sync", () => {
  const k = read("server/kyc4u.ts");
  for (const head of ['app.get("/api/kyc4u/connect"', 'app.get("/api/kyc4u/admin-consent-link"', 'app.post("/api/kyc4u/sync"',
    'app.get("/api/kyc4u/drafts/prefill"', 'app.post("/api/kyc4u/drafts", ', 'app.post("/api/kyc4u/submitted"']) {
    const at = k.indexOf(head);
    assert.ok(at > 0, head);
    assert.match(k.slice(at, at + 260), /if \(KYC4U_RETIRED\) return res\.status\(410\)\.json\(\{ message: KYC4U_RETIRED_WORDS \}\);/, head);
  }
  const next = k.indexOf('app.get("/api/kyc4u/drafts/next"');
  assert.match(k.slice(next, next + 260), /if \(KYC4U_RETIRED\) return res\.json\(\{ draft: null, docs: \[\], waiting: 0 \}\);/);
  assert.doesNotMatch(k, /SYNC_EVERY_MS/);
  // The records stay readable: their requests, the archive, a past sign-off recorded by an admin.
  for (const kept of ['app.get("/api/kyc4u/requests"', 'app.get("/api/kyc4u/company/:companyId"', 'app.post("/api/kyc4u/company/:companyId/signoff"', 'app.post("/api/kyc4u/import"']) {
    assert.ok(k.includes(kept), kept);
  }
  assert.match(read("server/index.ts"), /ALTER TABLE kyc4u_drafts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP/);
});

test("no screen offers a KYC4U request, its pack or its portal", () => {
  const p = read("client/src/components/kyc4u-panel.tsx");
  for (const gone of ["Kyc4uRequestButton", "Kyc4uPackButton", "Kyc4uSubmittedButton", "KYC4U_FORM_URL", "button-kyc4u-connect", "button-kyc4u-sync"]) {
    assert.doesNotMatch(p, new RegExp(gone), gone);
  }
  assert.match(p, /data-testid="kyc4u-retired"/);
  for (const f of ["client/src/components/deal-aml-status.tsx", "client/src/pages/deals.tsx", "client/src/components/unit-hots/hots-convert.tsx", "client/src/components/aml-file-button.tsx"]) {
    assert.doesNotMatch(read(f), /Kyc4uRequestButton|Kyc4uPackButton|Kyc4uSubmittedButton|aml-file\/kyc4u/, f);
  }
});
