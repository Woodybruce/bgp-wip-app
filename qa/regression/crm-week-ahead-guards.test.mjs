// The CRM week (Woody, 2026-11-16): landlord meetings on the CRM events
// calendar, and Monday's email to the directors. These guards keep the email
// to its list and the calendar feed to BGP staff.
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
  assert.match(server, /AND COALESCE\(role,''\) <> 'Client' AND is_active IS DISTINCT FROM false/);
  assert.match(server, /if \(setting\.toLowerCase\(\) === "off"\) return \[\];/);
});

test('both routes are admin only, and nothing else in the file sends', () => {
  const routes = [...server.matchAll(/app\.(get|post)\("([^"]+)",([^\n]*)/g)];
  assert.deepEqual(routes.map(route => `${route[1]} ${route[2]}`), ['get /api/admin/crm-week-ahead', 'post /api/admin/crm-week-ahead/send-me']);
  for (const route of routes) assert.match(route[3], /^ requireAuth, requireAdmin,/);
  assert.doesNotMatch(server, /anthropic|openai|perplexity|callClaude/i);
});

test('it is sent once a week, on Monday morning, and the directors list is the Finance one', () => {
  const index = source('server/index.ts');
  assert.match(index, /\{ key: "crm-week-ahead", due: weeklyAt\(1, 7, 30\), run: \(\) =>\s*import\("\.\/crm-week-ahead"\)\.then\(m => m\.mondayWeekAhead\(\)\)/);
  assert.equal((index.match(/mondayWeekAhead/g) || []).length, 1);
  assert.match(source('server/auth.ts'), /export const EQUITY_DIRECTOR_EMAILS: string\[\] = \[\.\.\.EQUITY_EMAILS\];/);
});

test('the calendar feed is the diary digest, for BGP staff only', () => {
  const meetings = source('server/landlord-meetings.ts');
  assert.match(meetings, /app\.get\('\/api\/crm\/landlords\/meetings\/calendar', requireAuth, async \(req,res\) => \{\s*try \{ if \(await staffOnly\(req,res\)\) res\.json\(await getLandlordMeetingDigest\(\{\}\)\); \}/);
});

test('a meeting on the calendar is never saved as a CRM event, and the email preview is sandboxed', () => {
  const overview = source('client/src/components/crm-engagement/overview.tsx');
  const chip = overview.slice(overview.indexOf('function MeetingChip('), overview.indexOf('function Empty('));
  assert.doesNotMatch(chip, /apiRequest|setEditor/);
  assert.match(overview, /const meetingsOn = kind !== "brand" && !compact;/);
  const card = source('client/src/components/landlord-weekly-meetings.tsx');
  assert.match(card, /<iframe title="This week's email" sandbox="" srcDoc=\{preview\.data\.html\}/);
  assert.match(card, /enabled: open && !!me\?\.isAdmin/);
});
