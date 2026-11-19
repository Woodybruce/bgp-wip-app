import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Red flags send a party to KYC4U (Woody, 17 November 2026: "basically we do
// the normal checks expected and if there is a red flag then we get KYC4U").
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const flagsServer = read('server/kyc-red-flags.ts');
const portal = read('server/aml-portal.ts');
const compliance = read('server/aml-compliance.ts');
const kyc4u = read('server/kyc4u.ts');
const veriff = read('server/veriff.ts');
const card = read('client/src/components/deal-aml-status.tsx');
const deals = read('client/src/pages/deals.tsx');

test('the deal KYC status sends red flags to BGP staff signed in as themselves only', () => {
  const route = compliance.slice(compliance.indexOf('"/api/kyc/deal/:id/status"'));
  const body = route.slice(0, route.indexOf('router.post('));
  assert.match(body, /const staff = \(await contactViewer\(req\)\)\.staff;/);
  assert.match(body, /const redFlags = staff\s*\?\s*await \(await import\("\.\/kyc-red-flags"\)\)\.loadDealRedFlags/);
  assert.match(body, /:\s*null;/);
  assert.match(body, /redFlags,/);
});

test("KYC4U's request note carries the red flags", () => {
  const prefill = kyc4u.slice(kyc4u.indexOf('export async function kyc4uPrefill'), kyc4u.indexOf('export const KYC4U_DRAFT_KEYS'));
  // The party's own flags: those of the company that signs when the deal names one (2026-11-18).
  assert.match(prefill, /loadDealRedFlags\(dealId, \[companyId\], entityId \? \{ \[companyId\]: entityId \} : \{\}\)/);
  assert.match(prefill, /redFlagNote\(/);
  assert.match(prefill, /flagNote, checkedNote\]\.filter\(Boolean\)\.join/);
});

test('the alert goes to the agents on the request (the admin on a test), never the client, once per flag', () => {
  const fn = flagsServer.slice(flagsServer.indexOf('export async function alertRedFlags'), flagsServer.indexOf('export async function alertRedFlagsForSession'));
  assert.match(fn, /const to = kycReplyAddresses\(row, request\.cc\);/);
  assert.match(fn, /sendKycEmail\(\{\s*to,\s*build:/);
  assert.doesNotMatch(fn, /cc:/);
  assert.match(fn, /ALERTED\.includes\(f\.kind\) && !done\.includes\(redFlagAlertKey\(f\)\)/);
  assert.match(fn, /'\{redFlagAlerts\}'/);
  // Only a sent alert is remembered.
  assert.ok(fn.indexOf('if (!sent.ok)') < fn.indexOf('redFlagAlerts}'));
  assert.match(flagsServer, /const ALERTED: KycRedFlagKind\[\] = \["client_pep", "id_declined"\];/);
});

test("the client's yes or not sure, and Veriff's decline, alert at once without holding the page", () => {
  const answers = portal.slice(portal.indexOf('"/api/kyc-upload/:token/answers"'), portal.indexOf('"/api/kyc-upload/:token/finish"'));
  assert.match(answers, /if \(pep !== "no"\) \{\s*import\("\.\/kyc-red-flags"\)\.then\(m => m\.alertRedFlags\(row\.token\)\)/);
  assert.doesNotMatch(answers, /await import\("\.\/kyc-red-flags"\)/);
  assert.match(veriff, /if \(status === "declined"\) \{\s*import\("\.\/kyc-red-flags"\)\.then\(m => m\.alertRedFlagsForSession\(sessionId\)\)/);
});

test('the finished note and the admin previews carry the red flags', () => {
  const finish = portal.slice(portal.indexOf('async function finishRequest'), portal.indexOf('// ── Replies with documents'));
  assert.match(finish, /loadDealRedFlags\(row\.deal_id, \[row\.company_id\], row\.trading_entity_id \? \{ \[row\.company_id\]: row\.trading_entity_id \} : \{\}\)/);
  assert.match(finish, /redFlags,/);
  assert.match(portal, /\{ kind: "red_flag", title: "Red flag: raise with KYC4U"/);
  assert.match(read('client/src/components/kyc-emails-admin.tsx'), /red_flag: "red_flag"/);
});

test('the deal card shows each party its red flags beside Request KYC4U check; the Kick off step sends a flagged party to KYC4U', () => {
  assert.equal((card.match(/<PartyRedFlags dealId=\{dealId\} data=\{data\} companyId=\{cp\.id\} role=\{cp\.role\} \/>/g) || []).length, 2);
  assert.equal((card.match(/<DealRedFlags dealId=\{dealId\} data=\{data\} \/>/g) || []).length, 2);
  assert.match(card, /Red flags could not be checked against/);
  assert.match(deals, /const flags = amlStepStatus\?\.redFlags\?\.parties\[p\.id\] \|\| \[\];/);
  assert.match(deals, /\{clientChecks && !flags\.length\s*\? <SendClientChecksButton/);
});
