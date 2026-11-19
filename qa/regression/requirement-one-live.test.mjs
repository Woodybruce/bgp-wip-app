// One meaning of "live" (step 6 of docs/requirements-board-review-2026-11-19.md,
// finding 20; Woody, 19 November 2026: "carry on"): every reader of a leasing
// requirement asks the one rule in shared/requirement-live.ts. The five places
// that pick an agent or a brand through a requirement still read status
// Active or blank until Woody has seen the Health report's list of the links
// that would change. A new hand-written reading fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const HAND_WRITTEN = /IN \('', ?'active'\)|status = 'Active'|status ILIKE '%active%'|'active'\)\)='active'|\.status === "Active"/;

// The five agent and brand pickers, each named in the Health report's note.
const WAITING_ON_WOODY = new Set([
  'server/client-agent-directory.ts',
  'server/contact-verify.ts',
  'server/chatbgp.ts',
  'server/viewing-sync.ts',
  'server/requirement-intake.ts',
]);

test('no reader of a leasing requirement decides live by hand, but the five agent pickers', () => {
  const offenders = [];
  for (const name of readdirSync('server')) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const file = `server/${name}`;
    const source = read(file);
    if (!source.includes('crm_requirements_leasing') && !source.includes('crmRequirementsLeasing') && !/requirements\?\.filter/.test(source)) continue;
    source.split('\n').forEach((line, i) => {
      if (!HAND_WRITTEN.test(line)) return;
      // A deal or an investment requirement is not a leasing requirement.
      if (/crm_deals|crm_requirements_investment/.test(line)) return;
      if (file === 'server/investment-buyers.ts') return;
      // The Health report compares the old reading with the rule on purpose.
      if (file === 'server/requirements-health.ts') return;
      if (WAITING_ON_WOODY.has(file)) return;
      offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'read requirementStateSql or requirementLive instead');
  // The agent pickers are still on the old reading, and the Health report lists what would change.
  for (const file of WAITING_ON_WOODY) assert.match(read(file), HAND_WRITTEN, `${file} has moved: take it off the list and the Health report's note`);
  const health = read('server/requirements-health.ts');
  assert.match(health, /await section\("agents_by_rule", "Agent links that would change on the live rule"/);
  assert.match(health, /WHERE \(lower\(btrim\(coalesce\(q\.status, ''\)\)\) IN \('', 'active'\)\) <> \(\$\{requirementStateSql\("q"\)\} <> 'closed'\)/);
  assert.doesNotMatch(health.slice(health.indexOf('agents_by_rule')), /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/);
});

test('the places moved onto the rule', () => {
  const crm = read('server/crm.ts');
  const fits = crm.slice(crm.indexOf('app.get("/api/crm/requirements-leasing/matches"'));
  assert.match(fits.slice(0, fits.indexOf('\n  app.')), /FROM crm_requirements_leasing r\s+WHERE \$\{requirementStateSql\("r"\)\} <> 'closed'/);
  // The Expansion score's count of BGP's own requirements: the rule alone, and a new score version.
  assert.match(read('server/expansion-intel.ts'), /FROM crm_requirements_leasing r\s+WHERE r\.company_id = \$1\) x`/);
  assert.match(read('server/brand-triggers.ts'), /const SCORE_VERSION = 6;/);
  assert.match(read('server/brand-ai-take.ts'), /WHERE r\.company_id = \$1 AND \$\{requirementStateSql\("r"\)\} <> 'closed'\s+LIMIT 5/);
  assert.match(read('server/brand-enrichment.ts'), /\$\{requirementStateSql\("r"\)\} IN \('live', 'to_confirm'\)\) DESC,/);
  assert.match(read('server/chatbgp.ts'), /requirements: full\.requirements\?\.slice\(0, 10\),/);
});

test("the agent firm page and a contact's page read the state, closed ones last or left out", () => {
  const agents = read('server/agent-relationship.ts');
  assert.match(agents, /WHERE r\.agent_contact_id = ANY\(\$1::text\[\]\) AND \$\{requirementStateSql\("r"\)\} <> 'closed'/);
  assert.match(agents, /const label = boardStateWords\(live\);/);
  assert.match(read('shared/requirements-board.ts'), /return boardListOf\(live\) === "market" \? "Market listing" : "Older";/);
  assert.match(agents, /state_label: label, date_label: live\.dateLabel/);
  const card = read('client/src/components/agent-relationship-card.tsx');
  assert.match(card, /href=\{`\/requirements\?requirementId=\$\{encodeURIComponent\(r\.id\)\}`\}/);
  assert.match(card, /right=\{<RowPill>\{r\.state_label\}<\/RowPill>\}/);
  assert.doesNotMatch(card, /r\.status \|\| "Active"/);
  const crm = read('server/crm.ts');
  const contact = crm.slice(crm.indexOf('app.get("/api/crm/contacts/:id/requirements"'), crm.indexOf('app.post("/api/crm/contacts/:id/requirements"'));
  assert.match(contact, /\.sort\(\(a, b\) => Number\(a\.live\?\.state === "closed"\) - Number\(b\.live\?\.state === "closed"\)\)/);
  // A client is never told the state: Open or Closed only.
  assert.match(contact, /\{ \.\.\.requirementClientCopy\(r\), stateLabel: live!\.state === "closed" \? "Closed" : null \}/);
  assert.match(contact, /live \? \{ \.\.\.r, stateLabel: boardStateWords\(live\) \} : r/);
  assert.match(read('client/src/pages/contacts.tsx'), /req\.use\?\.length \? req\.use\.join\(", "\) : null, req\.stateLabel\]/);
});
