// Whose identity check it was (Woody, 19 November 2026: "this is email about
// jack barrat but its actually after woody bruce did the check so its got
// confused jack hasnt done his yet"). The agents are copied on a client's
// request; Woody opened his copy of Jack's link and passed Veriff himself,
// and the app reported and filed it as Jack's. Veriff reads the name off the
// document; the app sets it against the person the request was for, and a
// check passed by someone else is never reported, counted or filed as the
// client's. Source guards; the rules are tested in server/kyc-prechecks.test.ts
// and server/kyc-request.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test("someone else's identity check does not count as the client's, on the page, the card or the Finished note", () => {
  const portal = read('server/aml-portal.ts');
  assert.match(portal, /return \{ verifiedName, isThePerson: idCheckIsThePerson\(row\.contact_name, verifiedName\) \};/);
  assert.match(portal, /const idDone = accepted \|\| \(\(idState === "approved" \|\| idState === "submitted"\) && idPerson\?\.isThePerson !== false\);/);
  assert.match(portal, /idVerifiedName: progress\.idPerson\?\.verifiedName \?\? null, idOtherPerson: progress\.idPerson\?\.isThePerson === false,/);
  assert.match(portal, /idState: progress\.idState, idPerson: progress\.idPerson,/);
  // The right person can still start their own on the same link.
  assert.match(portal, /if \(\(state === "approved" \|\| state === "submitted"\) && !otherPerson\) return res\.status\(409\)/);
  const email = read('shared/kyc-request.ts');
  assert.match(email, /Identity check: \$\{ctx\.idState === "approved" \? "passed" : "done"\} by \$\{someoneElse\}, not \$\{who\}, who this request was for\./);
  assert.match(email, /has not done their own identity check\./);
  assert.match(read('client/src/pages/kyc-upload.tsx'), /const idOther = !!view\.idCheck\?\.otherPerson;/);
  assert.match(read('client/src/components/kyc-client-checks.tsx'), /request\.idOtherPerson \? \(/);
});

test("Veriff's approval is filed as the person it checked, never on the contact it was asked of when that is someone else", () => {
  const veriff = read('server/veriff.ts');
  assert.match(veriff, /const otherPerson = idCheckIsThePerson\(asked, verified\) === false;/);
  assert.match(veriff, /s\.company_id, otherPerson \? null : s\.contact_id, s\.deal_id,/);
  assert.match(veriff, /if \(s\.company_id && !otherPerson\) \{/);
});

test('photos the client sends show as thumbnails on the deal card (Woody, 19 November 2026)', () => {
  const card = read('client/src/components/kyc-client-checks.tsx');
  assert.match(card, /const isPhoto = \(f: \{ name: string; url: string \| null \}\) => !!f\.url && \/\\\.\(jpe\?g\|png\|webp\|gif\)\$\/i\.test\(f\.name\);/);
  assert.match(card, /<img src=\{f\.url!\}/);
});
