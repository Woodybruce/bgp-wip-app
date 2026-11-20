// A proof of address is read and set against the person it is for (Woody,
// 20 November 2026: "with the proof of address is the app checking its
// actually for that person and acceptable? linking it from a name
// perspective?"). Source guards: every proof sent is read (never a test
// request's), the reader is sent the file alone, Anthropic direct and capped,
// a proof counts only on its verdict or an officer's acceptance, and only the
// officers accept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const portal = read('server/aml-portal.ts');
const reader = read('server/kyc-address-proof.ts');
const people = read('shared/kyc-people.ts');
const loader = read('server/kyc-people.ts');
const routes = read('shared/kyc-request.ts');
const card = read('client/src/components/kyc-client-checks.tsx');

test('every proof of address a client sends is read after it is filed, never on a test request', () => {
  const filing = portal.slice(portal.indexOf('async function fileClientDocument('), portal.indexOf('if (docKey === "source_of_funds")'));
  assert.ok(filing.indexOf('if (row.is_test) {') < filing.indexOf('if (docKey === "proof_of_address")'), 'a test upload returns before the reading');
  assert.match(filing, /m\.recordAddressProof\(pool, row\.token, documentId, await m\.readAddressProof\(\{ buffer: file\.buffer/);
});

test('the reader is Anthropic, called directly, capped a day, and sent the file alone', () => {
  assert.match(reader, /getAnthropicClient\(true\)/);
  assert.match(reader, /claimDailyRead\(USAGE_KEY, addressProofReaderDailyCap\(\)\)/);
  assert.match(reader, /ADDRESS_PROOF_READER_DAILY_CAP/);
  assert.match(reader, /tool_choice: \{ type: "tool", name: ADDRESS_PROOF_TOOL\.name \}/);
  const ask = reader.slice(reader.indexOf('async function askAnthropic('), reader.indexOf('/** Reads one file.'));
  assert.match(ask, /content: \[\.\.\.parts, \{ type: "text", text: "Read this document\." \}\]/);
  // It takes the file and nothing else: not the name it is meant to show.
  assert.match(reader, /export async function readAddressProof\(file: \{ buffer: Buffer; mime: string \| null; name: string \}, deps: AddressProofDeps = \{\}\)/);
  assert.match(reader, /const prepared = await addressProofParts\(file\);/);
});

test('a proof counts only on its verdict or an officer accepting it', () => {
  assert.match(people, /const check = checkAddressProof\(f\.reading \|\| null, d\.name, f\.uploadedAt\);/);
  assert.match(people, /counts: check\.ok \|\| !!f\.accepted/);
  assert.match(people, /done: !!counting,/);
  assert.match(loader, /reading: documentId \? request\.addressProofs\?\.\[documentId\] \|\| null : null,/);
  assert.match(loader, /accepted: documentId \? request\.addressAccepted\?\.\[documentId\] \|\| null : null,/);
});

test('Read again is BGP staff, Accept is the Nominated Officer or a Deputy, both through the switch', () => {
  const reread = portal.slice(portal.indexOf('"/api/aml/deal/:id/client-checks/address-proof/read"'), portal.indexOf('"/api/aml/deal/:id/client-checks/address-proof/accept"'));
  assert.match(reread, /const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)/);
  const accept = portal.slice(portal.indexOf('"/api/aml/deal/:id/client-checks/address-proof/accept"'), portal.indexOf('kycRequestRouter.post("/api/aml/deal/:id/client-checks", signedIn'));
  assert.match(accept, /if \(!actor\.isMlro\) return res\.status\(403\)/);
  assert.match(accept, /note\.length < ADDRESS_PROOF_ACCEPT_NOTE_MIN/);
  // The file must be this deal's, a proof of address, on a request that is not a test.
  assert.match(portal, /JOIN kyc_upload_files f ON f\.token = u\.token AND f\.kyc_document_id = \$3 AND f\.doc_type = 'proof_of_address'\s*WHERE u\.token = \$1 AND u\.deal_id = \$2 AND u\.is_test IS NOT TRUE/);
  assert.match(routes, /client-checks\\\/address-proof\\\/\(\?:read\|accept\)\$/);
  // The card offers Accept only to those who may decide.
  assert.match(card, /\{canDecide && !accepting && \(/);
  const box = read('client/src/components/deal-aml-status.tsx');
  assert.match(box, /const canDecide = !!data\.decisions\?\.canDecide;/);
  assert.match(box, /canDecide=\{canDecide\} part="people" \/>/);
});

test('proofs sent before the reading existed are read when the deal card is opened, each once, never a test', () => {
  const list = portal.slice(portal.indexOf('kycRequestRouter.get("/api/aml/deal/:id/client-checks"'), portal.indexOf('// A person\'s own link: given'));
  assert.ok(list.indexOf('await staffMe(req)') < list.indexOf('readUnreadAddressProofs(pool, dealId)'), 'staff only, before anything is read');
  const lazy = reader.slice(reader.indexOf('export async function readUnreadAddressProofs('));
  assert.match(lazy, /u\.is_test IS NOT TRUE AND f\.doc_type = 'proof_of_address'/);
  assert.match(lazy, /NOT \(COALESCE\(u\.request->'addressProofs', '\{\}'::jsonb\) \? f\.kyc_document_id\)/);
  assert.match(lazy, /if \(reading\.has\(key\)\) continue;/);
});
