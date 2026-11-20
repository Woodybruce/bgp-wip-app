// The deal read from the New Deal form's "Describe the deal" box (Woody,
// 20 November 2026: "doesn't search the adress", "didn't pick up the
// tenant", "couldn't add landlord or tenant once worked out they are not in
// the CRM", "didnt change the deal typ to new letting", "didnt help with the
// billing entiryies either"). The rules and look-ups are tested in
// server/deal-note.test.ts and the route in promote-to-solicitors.test.mjs;
// these source guards keep the promises they make.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the deal reading saves nothing, and the provider is sent the note and the deal types only', () => {
  const reader = read('server/deal-note-reader.ts');
  for (const src of [reader, read('shared/deal-note.ts')]) assert.doesNotMatch(src, /\b(?:INSERT|UPDATE|DELETE)\b/);
  assert.match(reader, /const user = `Deal types: \$\{DEAL_NOTE_TYPES\.join\(", "\)\}\n\nThe note:\n<note>\n\$\{safe\(text\)\}\n<\/note>`;/);
  // Anthropic through the letting note reader's own capped call, logged as its own feature.
  assert.match(reader, /const \{ defaultNoteReaderDeps \} = await import\("\.\/unit-note-reader"\);/);
  assert.match(reader, /feature: DEAL_READER_FEATURE/);
  // Every value the provider gives is checked against the note before anything looks it up.
  assert.match(reader, /const checked = checkDealNoteAnswer\(text, reply\.input\);/);
});

test("a property is matched on its address values, never the stored address's key names", () => {
  const reader = read('server/deal-note-reader.ts');
  assert.doesNotMatch(reader, /address::text/);
  assert.match(reader, /p\.address->>'formatted'/);
  assert.match(reader, /~ ALL\(\$1::text\[\]\)/);
});

test('the route stays BGP staff only, and the terms are sent whether or not the deal reading worked', () => {
  const route = read('server/unit-note-reader.ts');
  assert.match(route, /if \(!access \|\| !access\.isStaff \|\| access\.scope\) return res\.status\(403\)/);
  assert.match(route, /res\.json\(\{ \.\.\.reading, deal \}\);/);
  assert.match(route, /return null;\s*\}\),\s*\]\);/, 'a failed deal reading is null, never a failed request');
});

test('on the form a reading fills only empty boxes and sends nothing; adding a party or a billing entity is a press', () => {
  const deals = read('client/src/pages/deals.tsx');
  const apply = deals.slice(deals.indexOf('const applyDealRead = '), deals.indexOf('const requestWords = '));
  assert.ok(apply.length > 100, 'applyDealRead is found');
  assert.doesNotMatch(apply, /apiRequest|fetch\(/);
  assert.match(deals, /onAddParty=\{\(role, name, hit\) => \{ void addNoteParty\(role, name, hit\); \}\}/);
  assert.match(deals, /onBill=\{\(role, companyId, number\) => \{ void billNoteParty\(role, companyId, number\); \}\}/);
  assert.match(deals, /\{dealRead && !isEdit && !isClientCreate && \(/, 'BGP staff on New Deal and the handovers only, as the box is');
  assert.match(deals, /apiRequest\("POST", "\/api\/billing-entities", \{ brandId: companyId, companyNumber: number \}\)/, 'the billing entity goes through the route the picker uses');
  const lib = read('client/src/lib/deal-note.ts');
  assert.match(lib, /if \(read\.dealType\?\.value && !form\.dealType\) patch\.dealType/);
  assert.match(lib, /if \(propertyId && !form\.propertyId\) patch\.propertyId/);
  assert.match(lib, /if \(form\[k\.id\] && String\(form\[k\.id\]\) !== party\.candidates\[0\]\.companyId\) continue;/);
});

test('the panel draws in theme tokens only', () => {
  const panel = read('client/src/components/deal-note-read.tsx');
  assert.doesNotMatch(panel, /\b(?:text|bg|border)-(?:emerald|green|red|blue|amber|rose|teal|sky|indigo|violet|purple|pink|orange|yellow|lime|cyan|fuchsia|slate|gray|zinc|neutral|stone)-\d/);
});
