// Anyone on the transaction may send a proof of address for another person
// (Woody, 24 November 2026: "Let's allow others to drop proof of address?";
// who hands it over is not a legal point). Source guards: the person acting's
// page sends a bill for an owner with a "for" hint that must name one of the
// party's people; the hint never makes a bill count by itself; it counts for
// the person it names once read, and an acceptance only for the person it was
// sent for. Rules: server/kyc-people.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const portal = read('server/aml-portal.ts');
const rule = read('shared/kyc-people.ts');

test('the upload takes a "for" only for a proof of address, on the person acting\'s own request, naming one of the party\'s people', () => {
  assert.match(portal, /if \(docKey !== "proof_of_address" \|\| isJointRequest\(row\.request\) \|\| row\.request!\.person\) return res\.status\(400\)/);
  assert.match(portal, /const person = found\?\.people\.find\(p => p\.key === askedFor\) \|\| null;\s*if \(!person\) return res\.status\(400\)/);
  assert.match(portal, /SET request = jsonb_set\(COALESCE\(request, '\{\}'::jsonb\), '\{addressProofFor\}'/);
  assert.match(read('server/kyc-people.ts'), /forKey: documentId \? request\.addressProofFor\?\.\[documentId\] \|\| null : null,/);
});

test('a proof counts for the person it names; the hint only decides whose row shows it and whose acceptance it is', () => {
  assert.match(rule, /f\.docKey === "proof_of_address" && \(f\.forKey === myKey \|\| !!f\.reading\)/);
  assert.match(rule, /counts: check\.ok \|\| \(sentFor && !!f\.accepted\)/);
  assert.match(rule, /accepted: shown\.elsewhere && !shown\.sentFor \? null : shown\.f\.accepted \|\| null,/);
  assert.match(rule, /input\.requests\.filter\(r => r\.companyId === input\.companyId && !r\.trustDocs && !own\(r\)\)/, 'this party\'s links only');
});

test('the person acting\'s page offers each owner Upload their proof of address, and BGP sees where it came in', () => {
  const page = read('client/src/pages/kyc-upload.tsx');
  assert.match(page, /form\.append\("forKey", person\.key\);/);
  assert.match(page, /data-testid=\{`kyc-owner-proof-\$\{person\.key\.replace\(\/\\s\+\/g, "-"\)\}`\}/);
  assert.match(portal, /reading: !p\.address\.done && mine\.some\(docId => !request\.addressProofs\?\.\[docId\]\),/);
  assert.match(read('client/src/components/kyc-client-checks.tsx'), /data-testid=\{`person-address-elsewhere-\$\{testKey\}`\}> · sent \{proof\.elsewhere\}/);
});
