// The officers' AML file (Woody, 20 November 2026: "an option for the AML
// officers to generate a report to include all the documents etc which we can
// then send to HMRC if asked? Also we can send to KYC4U if we get stuck").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const file = read('server/aml-file.ts');

test('only the Nominated Officer and the Deputies make it', () => {
  for (const route of ['router.get("/api/deals/:id/aml-file"', 'router.post("/api/deals/:id/aml-file/kyc4u"']) {
    const at = file.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(file.slice(at, at + 300), /const me = await officer\(req\);\s*if \(!\("id" in me\)\) return res\.status\(me\.status\)\.json\(\{ message: me\.refusal \}\);/, route);
  }
  assert.match(file, /const \{ decider \} = await import\("\.\/deal-party-aml"\);\s*return decider\(req\);/);
  assert.match(read('server/deal-party-aml.ts'), /^export async function decider\(req: Request\)/m);
  // Outside the retired /api/aml/ addresses, and mounted.
  assert.match(read('server/index.ts'), /app\.use\(amlFileRouter\);/);
  // On no client login's list.
  assert.doesNotMatch(read('server/index.ts'), /CLIENT_ALLOWED[^\n]*aml-file/);
});

test('it never carries the AML register, and each file made is recorded', () => {
  // Internal reports and SARs stay with the officers: the file may leave BGP (tipping off).
  assert.doesNotMatch(file, /aml_internal_reports|aml-register/);
  assert.match(file, /INSERT INTO kyc_audit_log \(company_id, action, performed_by, notes\) VALUES \(\$1, 'aml_file', \$2, \$3\)/);
  assert.match(file, /INSERT INTO deal_audit_log \(deal_id, field, old_value, new_value, reason, changed_by, changed_by_name\) VALUES \(\$1, 'aml_file'/);
  for (const made of ['await recordMade(data, me, "made (report)");', 'await recordMade(data, me, `made (report and', 'await recordMade(data, me, "filed on the KYC record for KYC4U");']) {
    assert.ok(file.includes(made), made);
  }
});

test('it reads the party the way the AML box does, and every document as stored', () => {
  for (const fn of ['loadPartyKyc(', 'dealPrechecks(', 'loadDealRedFlags(', 'partyPeopleFor(', 'clientChecksForDeal(', 'loadNotRequired(', 'dealAgentsAml(']) {
    assert.ok(file.includes(fn), fn);
  }
  // Reading the file never starts a paid check.
  assert.match(file, /\{ userId: me\.id, autoStart: false \}/);
  assert.match(file, /getFile\(`chat-media\/\$\{decodeURIComponent\(media\[1\]\)\}`\)/);
  // Filed for KYC4U, it is a document on the party's record, which Request KYC4U check offers.
  assert.match(file, /INSERT INTO kyc_documents \(company_id, trading_entity_id, deal_id, doc_type, file_url, file_name, file_size, mime_type, notes, uploaded_by\)/);
  assert.match(read('shared/aml-file.ts'), /export const AML_FILE_DOC_TYPE = "aml_file";/);
});

test('the button is drawn only for the officers', () => {
  const box = read('client/src/components/deal-aml-status.tsx');
  assert.match(box, /\{officer && data\.counterparties\.length > 0 && <AmlFileButton dealId=\{dealId\} \/>\}/);
  assert.match(box, /const officer = !!data\.decisions\?\.canDecide;/);
  assert.match(box, /\{canDecide && \(\s*<div[^>]*data-testid=\{`aml-file-line-\$\{cp\.role\}`\}>\s*<AmlFileButton dealId=\{dealId\} role=\{cp\.role\} partyName=\{partyName\} \/>/);
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /<PartyTrail row=\{open\} onClose=\{\(\) => setOpen\(null\)\} officer=\{!!roles\?\.isOfficer\} \/>/);
  assert.match(page, /\{officer && \(\s*<div className="pt-1" data-testid="aml-trail-file">/);
});
