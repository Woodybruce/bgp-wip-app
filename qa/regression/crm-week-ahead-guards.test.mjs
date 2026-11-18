// The CRM week (Woody, 2026-11-16): diary meetings on the CRM events
// calendar, and Monday's two emails (landlords to the directors, brands and
// agents to the leasing team). These guards keep each email to its own
// address, the diary feeds to BGP staff, and the two books apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source } = require('./source-harness.cjs');

const server = source('server/crm-week-ahead.ts');

test('who is emailed is decided on the server: never from a request', () => {
  assert.doesNotMatch(server, /req\.body|req\.query/);
  const sends = [...server.matchAll(/sendSharedMailboxEmail\(\{ to(: (\w+))?,/g)].map(m => m[2] || 'to');
  assert.deepEqual(sends, ['address', 'to']);
  // The scheduled send goes to the list; the test send to the caller's own address.
  assert.match(server, /for \(const address of to\)/);
  assert.match(server, /const to = await callerEmail\(req\);/);
  // Never an address outside BGP, and "off" stops an edition.
  assert.match(server, /address\.endsWith\(BGP_DOMAIN\)/);
  assert.match(server, /if \(value\.toLowerCase\(\) === "off"\) return \[\];/);
  // Landlords and the CRM's events to the directors; brands and agents, with no events, to leasing.
  assert.match(server, /directors: \{ to: `directors\$\{BGP_DOMAIN\}`, setting: "CRM_WEEK_AHEAD_TO", book: "landlord", events: true \}/);
  assert.match(server, /leasing: \{ to: `leasing\$\{BGP_DOMAIN\}`, setting: "LEASING_WEEK_AHEAD_TO", book: "leasing", events: false \}/);
});

test('both routes are admin only, and nothing else in the file sends', () => {
  const routes = [...server.matchAll(/app\.(get|post)\("([^"]+)",([^\n]*)/g)];
  assert.deepEqual(routes.map(route => `${route[1]} ${route[2]}`), ['get /api/admin/crm-week-ahead', 'post /api/admin/crm-week-ahead/:edition/send-me']);
  for (const route of routes) assert.match(route[3], /^ requireAuth, requireAdmin,/);
  assert.doesNotMatch(server, /anthropic|openai|perplexity|callClaude/i);
});

test('both are sent once a week, on Monday morning, by one job', () => {
  const index = source('server/index.ts');
  assert.match(index, /\{ key: "crm-week-ahead", due: weeklyAt\(1, 7, 30\), run: \(\) =>\s*import\("\.\/crm-week-ahead"\)\.then\(m => m\.mondayWeekAhead\(\)\)/);
  assert.equal((index.match(/mondayWeekAhead/g) || []).length, 1);
  assert.match(server, /for \(const edition of WEEK_EDITIONS\) \{\s*try \{ await sendEdition\(edition\); \}/);
});

test('the calendar feeds are the diary digests, for BGP staff only, and the two books have their own stores', () => {
  const meetings = source('server/landlord-meetings.ts');
  assert.match(meetings, /app\.get\('\/api\/crm\/leasing-meetings\/calendar', requireAuth, async \(req,res\) => \{\s*try \{ if \(await staffOnly\(req,res\)\) res\.json\(await getLandlordMeetingDigest\(\{ book: 'leasing' \}\)\); \}/);
  assert.match(meetings, /const BOOK_PREFIX: Record<DiaryBook, string> = \{ landlord: PREFIX, leasing: 'leasing_diary_v1:' \};/);
  // The leasing list is agent firms and the brands BGP is working: never the whole directory, never BGP itself.
  const leasing = meetings.slice(meetings.indexOf('export async function loadLeasingCatalogue('), meetings.indexOf('const loadBook = '));
  assert.match(leasing, /const brandIds = await workedBrandIds\(q\);/);
  assert.match(leasing, /LIKE 'tenant%' AND c\.id = ANY\(\$1::text\[\]\)/);
  assert.match(leasing, /c\.name !~\* '\^\(bgp\|bruce gillingham pollard\)'/);
  // The hourly sync fills both books from one read, each failing on its own.
  const sync = source('server/interactions.ts');
  assert.match(sync, /try \{ await captureLandlordDiary\(events, userEmail, \{ start, end \}, \{ scanStartedAt, book: "leasing" \}\); \}\s*catch \{/);
  assert.match(meetings, /app\.get\('\/api\/crm\/landlords\/meetings\/calendar', requireAuth, async \(req,res\) => \{\s*try \{ if \(await staffOnly\(req,res\)\) res\.json\(await getLandlordMeetingDigest\(\{\}\)\); \}/);
});

test('a meeting on the calendar is never saved as a CRM event, and the email preview is sandboxed', () => {
  const overview = source('client/src/components/crm-engagement/overview.tsx');
  const chip = overview.slice(overview.indexOf('function MeetingChip('), overview.indexOf('function Empty('));
  assert.doesNotMatch(chip, /apiRequest|setEditor/);
  assert.match(overview, /const meetingsOn = !compact;/);
  const card = source('client/src/components/landlord-weekly-meetings.tsx');
  assert.match(card, /<iframe title="This week's email" sandbox="" srcDoc=\{email\.html\}/);
  assert.match(card, /enabled: open && !!me\?\.isAdmin/);
});
