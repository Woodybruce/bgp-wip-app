// The people a company's checks are about (Woody, 19 November 2026). On deal
// #4491 the single "ID for each of those owners" step ticked itself on the
// first file ("I didn't add Huseyn's details or David Bruce, just Huseyn's
// passport and nothing for David so can't be ok"), and the card did not show
// who else had to be checked. Agreed: "a list of people to check for each
// party: the owners and the person acting, each with their own Veriff link
// and a proof-of-address upload; the directors shown with their sanctions
// result only". Source guards; the rules are tested in
// server/kyc-people.test.ts, server/kyc-request.test.ts and
// server/party-kyc.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('a person gets a link of their own from BGP staff, or from the person acting (owners only, never themselves)', () => {
  const portal = read('server/aml-portal.ts');
  // Staff: signed in as themselves, while the client checks are on.
  assert.match(portal, /kycRequestRouter\.post\("\/api\/aml\/deal\/:id\/client-checks\/people", signedIn, async[\s\S]{0,200}const me = await staffMe\(req\);\s*if \(!me\) return res\.status\(403\)[\s\S]{0,120}if \(!clientChecksOn\(\)\) return res\.status\(410\)/);
  // The client page: the request to the person acting only, never a test or a person's own page.
  assert.match(portal, /if \(row\.is_test \|\| request\.person \|\| request\.kind !== "company" \|\| !row\.company_id\) \{\s*return res\.status\(400\)/);
  assert.match(portal, /if \(!person\.roles\.includes\("owner"\)\) throw Object\.assign\(new Error\("Only the owners' links are passed on from this page\."\)/);
  assert.match(portal, /if \(personNamesMatch\(person\.name, main\.contact_name \|\| ""\)\) throw Object\.assign\(new Error\("Your own checks are on this page\."\)/);
  // A page can email a link only a few times a day, not twice in two minutes.
  assert.match(portal, /const CLIENT_SENDS_A_DAY = 3;/);
  assert.match(portal, /const CLIENT_SEND_GAP_MS = 2 \* 60 \* 1000;/);
  // A client's typing is never saved to the CRM.
  assert.match(portal, /if \(!main && !row\.contact_id\) \{/);
  // The new staff address goes through the client checks' own switch.
  assert.match(read('shared/kyc-request.ts'), /\/\^\\\/api\\\/aml\\\/deal\\\/\[\^\/\]\+\\\/client-checks\\\/people\$\//);
});

test("a person's own request asks only what is still outstanding and starts no identity check until they press the button", () => {
  const portal = read('server/aml-portal.ts');
  const body = portal.slice(portal.indexOf('export async function createPersonCheck'), portal.indexOf('// ── What the agents see on the deal'));
  assert.ok(body.length > 500, 'createPersonCheck is found');
  assert.match(body, /const asks = personRequestAsks\(person, veriff\);/);
  assert.doesNotMatch(body, /startIdSession\(/);
  assert.match(body, /person: \{ key: person\.key, name: person\.name, roles: person\.roles, detail: person\.ownerDetail \},/);
});

test('the old owners step is never ticked by files on the deal card, and the request to the person acting asks for no owner IDs when the owners are named', () => {
  const portal = read('server/aml-portal.ts');
  assert.match(portal, /if \(key !== "owner_ids" \|\| !names\.length\) return \{ key, title: KYC_DOCS\[key\]\.title, done: progress\.docsDone\.includes\(key\), note: null as string \| null \};/);
  assert.match(portal, /return \{ key, title: KYC_DOCS\[key\]\.title, done: false, note: count \?/);
  const asks = read('shared/kyc-prechecks.ts');
  assert.match(asks, /drop\("owner_ids", `Each owner gets a link of their own for their identity check and proof of address: /);
  assert.match(read('shared/kyc-request.ts'), /else docs\.push\("proof_of_address", "ownership", "owner_ids", "authority"\);/);
});

test("a party's checks are finished only when every person to check has sent what they owe", () => {
  const signOff = read('server/deal-party-aml.ts');
  assert.match(signOff, /AND COALESCE\(jsonb_typeof\(request->'person'\), 'null'\) <> 'object' LIMIT 1`/);
  assert.match(signOff, /const outstanding = people \? people\.outstanding : \["the people to check could not be read"\];/);
  assert.match(signOff, /const finished = mainFinished && !outstanding\.length;/);
  const dashboard = read('server/aml-dashboard.ts');
  assert.match(dashboard, /const personOpen = liveTokens\.some\(\(t: any\) => t\.request\?\.person && !t\.completed_at/);
  assert.match(dashboard, /const finished = personOpen \? null : liveTokens\.filter\(\(t: any\) => !t\.request\?\.person\)/);
  // A letting under £10,000 a month (BGP's AML policy A) needs no note and owes nothing.
  assert.match(signOff, /outstanding: facts\.sanctionsOnly \? \[\] : facts\.clientChecksOutstanding \|\| \[\],/);
});

test('the deal card lists the people to check first, and their own requests only under them', () => {
  const card = read('client/src/components/kyc-client-checks.tsx');
  assert.match(card, /const list = data\.requests\.filter\(r => r\.companyId === companyId && !r\.person\);/);
  assert.match(card, /\{party && people && people\.basis !== "individual" && !notRequired && <PeopleToCheck dealId=\{dealId\} data=\{data\} party=\{party\} people=\{people\} sanctionsOnly=\{!!sanctionsOnly\} canDecide=\{!!canDecide\} \/>\}/);
  // Under sanctions checks only, nobody is asked for an identity check or a proof of address.
  assert.match(card, /data-testid=\{`people-sanctions-only-\$\{party\.companyId\}`\}/);
  const box = read('client/src/components/deal-aml-status.tsx');
  assert.match(box, /const sanctionsOnly = data\.regime\?\.regime === "sanctions_only";/);
  assert.match(box, /<ClientChecksForParty dealId=\{dealId\} companyId=\{cp\.id\} sanctionsOnly=\{sanctionsOnly\} notRequired=\{!!cp\.notRequired\} canDecide=\{canDecide\} part="people" \/>/);
  assert.match(box, /<ClientChecksForParty dealId=\{dealId\} companyId=\{cp\.id\} sanctionsOnly=\{sanctionsOnly\} notRequired=\{!!cp\.notRequired\} canDecide=\{canDecide\} part="requests" \/>/);
  assert.match(card, /data-testid=\{`people-to-check-\$\{party\.companyId\}`\}/);
  assert.match(card, /Directors, no ID needed/);
  const page = read('client/src/pages/kyc-upload.tsx');
  assert.match(page, /<OwnerLinksCard n=\{step\} token=\{token\} people=\{view\.people\} onView=\{setView\} \/>/);
  assert.match(page, /fetch\(`\/api\/kyc-upload\/\$\{encodeURIComponent\(token\)\}\/people`/);
});
