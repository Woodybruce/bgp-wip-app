// The Targeting Brief's "Describe the brief in your own words" box and the
// figures at the top of its Brief tab (Woody, 2026-11-19: "brief form needs
// our type and populate tool and the pills at the top are not clickable").
// The reader only fills the dialog's boxes: it never saves, it is Anthropic
// only, and it is open to exactly those who may change the brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { source, route } = require('./source-harness.cjs');

const routeSrc = route('server/unit-brief-workspace.ts', 'post', '/api/unit-briefs/read-note');
const reader = source('server/brief-note-reader.ts');
const dialog = source('client/src/components/unit-brief-dialog.tsx');
const box = source('client/src/components/unit-brief/brief-note-fill.tsx');

test('the read-note route checks briefAccess and the right to change the brief before it reads', () => {
  const access = routeSrc.indexOf('briefAccess(req, unit.property_id)');
  const canEdit = routeSrc.indexOf('access.canEditTerms');
  const read = routeSrc.indexOf('readBriefNote(');
  assert.ok(access > 0 && canEdit > access && read > canEdit, 'briefAccess, then canEditTerms, then the read');
  assert.match(routeSrc, /if \(!access\) return res\.status\(403\)/);
  assert.match(routeSrc, /if \(!access\.canEditTerms\) return res\.status\(403\)/);
});

test('the reader never saves: no write in the route or the reader, no save door called', () => {
  for (const [name, src] of [['route', routeSrc], ['reader', reader]]) {
    assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/, `${name} writes to the database`);
    assert.doesNotMatch(src, /saveBriefFields|apiRequest\("PATCH"|storage\.(create|update)/, `${name} saves the brief`);
  }
  assert.doesNotMatch(reader, /from "\.\/db"/, 'the reader holds no database handle');
  const apply = dialog.slice(dialog.indexOf('const applyNote ='), dialog.indexOf('const handleExtract ='));
  assert.ok(apply.length > 0, 'applyNote moved');
  assert.doesNotMatch(apply, /apiRequest|save\.mutate|fetch\(/, 'applying a reading only fills the form');
  assert.doesNotMatch(box, /apiRequest\("(PATCH|PUT|DELETE)"/, 'the box only posts the note to the reader');
  assert.match(box, /apiRequest\("POST", "\/api\/unit-briefs\/read-note"/);
});

test('the reader is Anthropic only, called directly, with a daily allowance', () => {
  assert.match(reader, /getAnthropicClient\(true\)\.messages\.create/);
  assert.doesNotMatch(reader, /callClaude|openai|gemini|perplexity|callAi\b/i);
  assert.match(reader, /BRIEF_NOTE_READER_DAILY_CAP/);
  assert.match(reader, /claimDailyRead\(USAGE_KEY, briefNoteReaderDailyCap\(\)\)/);
  assert.match(reader, /tool_choice: \{ type: "tool", name: tool\.name \}/);
});

test('a joint agent reaches the route through its brief rule, where the handler checks its scheme', async () => {
  const { restrictedLandsecApiRule } = await import('../../shared/landsec.ts');
  assert.equal(restrictedLandsecApiRule('joint_agent', 'POST', '/api/unit-briefs/read-note'), 'allow');
});

test('every pill on the brief switches its section, and the figures open what they count', () => {
  for (const tab of ['brief', 'commercials', 'people', 'targets', 'files', 'comments']) {
    const pill = dialog.split('\n').find(line => line.includes('<Pill') && line.includes(`data-testid="brief-tab-${tab}"`)) || '';
    assert.match(pill, /onClick=\{\(\) => (setTab|openTargets)\(/, `the ${tab} pill does nothing`);
  }
  assert.match(dialog, /function Kpi\([^)]*onClick[^)]*\)[\s\S]{0,400}<button type="button" onClick=\{onClick\}/);
  assert.match(dialog, /function DeadlineChip\([^)]*onClick[^)]*\)[\s\S]{0,400}<button type="button" onClick=\{onClick\}/);
  for (const [id, filter] of [['brief-kpi-targets', 'all'], ['brief-kpi-priority-a', 'priorityA'], ['brief-kpi-meetings', 'met'], ['brief-kpi-inspections', 'inspected']]) {
    assert.match(dialog, new RegExp(`onClick=\\{\\(\\) => openTargets\\("${filter}"\\)\\} testId="${id}"`), `${id} does not open its targets`);
  }
  assert.match(dialog, /data-testid="brief-approval-status"/);
  assert.match(dialog, /<button type="button" onClick=\{\(\) => setTab\("people"\)\}[^>]*data-testid="brief-approval-status"/, 'the sign-off chip opens People & sign-off');
  assert.match(dialog, /targets=\{shownTargets\}/, 'the Targets tab shows the list the figure asked for');
});

test('the note box sits on the Brief tab for those who may change the brief', () => {
  const briefTab = dialog.slice(dialog.indexOf('{tab === "brief" && ('), dialog.indexOf('{tab === "commercials" && ('));
  assert.match(briefTab, /\{!readOnly && unit && <BriefNoteFill unitId=\{unit\.id\}/);
});
