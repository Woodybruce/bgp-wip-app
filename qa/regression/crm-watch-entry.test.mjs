// The CRM Overview's Watch list (Woody, 2026-11-23): an entry opens a box with
// what's needed, its strategy and BGP's activity with it, every owed chip does
// its own job, and the same goes for brands, landlords, agents and lenders.
// Diary meetings that only name a company need someone from a firm on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const list = read('client/src/components/crm-engagement/watch-list.tsx');
const entry = read('client/src/components/crm-engagement/watch-entry.tsx');
const server = read('server/crm-watch-list.ts');
const router = read('server/crm-engagement.ts');
const matching = read('server/landlord-meeting-matching.ts');
const diaries = read('server/landlord-meetings.ts');

test('every owed chip is a button that does its job, and the name opens the entry', () => {
  assert.match(list, /row\.owed\.map\(line => <button type="button" key=\{line\} onClick=\{\(\) => chip\(row, line\)\}/);
  for (const kind of ['strategy', 'next', 'people', 'contact']) assert.match(list, new RegExp(`case "${kind}": return entryHandlers\\.`));
  assert.match(list, /onClick=\{\(\) => setOpen\(\{ id: row\.id \}\)\}/);
  // Not cut to brands: the list filters by the Overview's kind pill only.
  assert.match(list, /filter\(row => \(!noun \|\| row\.noun === noun\) && \(!match \|\| match\(row\)\)\)/);
  // No page is imported into the Overview (the contacts page pulls the map in).
  assert.doesNotMatch(list, /@\/pages\//);
});

test("the entry's three parts: what's needed, the strategy box and the activity summary", () => {
  for (const tab of ['needed', 'strategy', 'activity']) assert.match(entry, new RegExp(`data-testid="crm-watch-entry-tab-${tab}"`));
  // The strategy box saves the whole strategy with this company's plan, and the version read.
  assert.match(entry, /reason: t\.companyId === row\.id \? plan\.trim\(\) : t\.reason/);
  assert.match(entry, /expectedUpdatedAt: strategy\.updatedAt/);
  assert.match(entry, /\/api\/crm\/engagement\/watch\/\$\{encodeURIComponent\(row\.id\)\}\/summary/);
});

test('the summary is on the staff-only engagement router and never reads the private mailbox', () => {
  assert.match(router, /router\.get\("\/watch\/:companyId\/summary"/);
  assert.match(server, /export async function watchSummary/);
  assert.ok((server.match(/!~\* \$2/g) || []).length >= 4, 'every read of crm_interactions leaves the private mailbox out');
  assert.match(server, /isPrivateMailboxAddress/);
});

test('contact with a company counts its people and the diary meetings', () => {
  assert.match(server, /JOIN crm_contacts p ON p\.id = i\.contact_id/);
  assert.match(server, /getLandlordMeetingDigest\(\{ book: "leasing" \}\)/);
  assert.match(server, /owed\.push\("No people on record"\)/);
});

test('a diary entry that only names a company needs an outside business guest, in both books', () => {
  assert.match(matching, /export const LEASING_MATCHER: MatcherOptions = \{ tenants: true, minNameWords: 2, nameNeedsOutsider: true \};/);
  assert.match(matching, /export const LANDLORD_DIARY_MATCHER: MatcherOptions = \{ nameNeedsOutsider: true \};/);
  assert.match(matching, /if \(outsider\) for \(const \{ company, test \} of named\)/);
  // Every diary read goes through the book's matcher, never the plain name test.
  assert.doesNotMatch(diaries, /matchLandlordMeeting\(/);
  assert.match(diaries, /book === 'leasing' \? LEASING_MATCHER : LANDLORD_DIARY_MATCHER/);
});
