// Withdrawn is shown, not picked (Woody, 2026-11-20: "only chase live deals
// actually delete the Withdrawn option generally delete is good enough"). A
// deal that falls through is deleted; deleting a Letting Tracker unit still
// moves its deal to Withdrawn on the server. The Investment Tracker keeps
// Withdrawn as a choice (Woody did not answer when asked). Every other status
// picker reads the one rule in shared/deal-status.ts (INVESTMENT_ONLY_PICKS),
// and a deal already Withdrawn still reads Withdrawn: its label, colour,
// filters, Historic pill and counts stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  DEAL_STATUS_LABELS, DEAL_STATUS_COLORS, DEAL_STATUS_DOT_COLORS, DEAL_PAGE_STATUSES, INVESTMENT_ONLY_PICKS,
  INVESTMENT_STATUSES, LETTING_PICK_STATUSES, LETTING_STATUSES, SYSTEM_SET_STATUSES, WIP_STATUSES, legacyToCode,
} from '../../shared/deal-status.ts';
import { HISTORIC_STATUSES } from '../../shared/letting-rules.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

test('the rule: Withdrawn is picked on the Investment Tracker only', () => {
  assert.ok(INVESTMENT_ONLY_PICKS.includes('WIT'));
  assert.ok(INVESTMENT_STATUSES.includes('WIT'), 'the Investment Tracker still offers Withdrawn');
  for (const [name, list] of [['DEAL_PAGE_STATUSES', DEAL_PAGE_STATUSES], ['LETTING_PICK_STATUSES', LETTING_PICK_STATUSES], ['WIP_STATUSES', WIP_STATUSES]]) {
    assert.ok(!list.includes('WIT'), `${name} offers Withdrawn`);
  }
  const rule = source('shared/deal-status.ts');
  assert.match(rule, /export const LETTING_PICK_STATUSES: DealStatusCode\[\] = LETTING_STATUSES\.filter\(pickedOffInvestment\);/);
  assert.match(rule, /export const DEAL_PAGE_STATUSES: DealStatusCode\[\]\s+= DEAL_STATUS_CODES\.filter\(\(c\) => c !== "ARCH" && pickedOffInvestment\(c\)\);/);
});

test('Withdrawn is still shown: its label, colours, the Letting Tracker headings, the Historic pill and old spellings', () => {
  assert.equal(DEAL_STATUS_LABELS.WIT, 'Withdrawn');
  assert.ok(DEAL_STATUS_COLORS.WIT && DEAL_STATUS_DOT_COLORS.WIT);
  assert.ok(LETTING_STATUSES.includes('WIT'), 'the Letting Tracker still counts and orders Withdrawn rows');
  assert.ok(HISTORIC_STATUSES.includes('WIT'), 'Withdrawn still folds under Historic');
  for (const word of ['WIT', 'Withdrawn', 'withdrawn', 'lost', 'dead']) assert.equal(legacyToCode(word), 'WIT', word);
  const summary = source('client/src/components/tracker-summary.tsx');
  assert.match(summary, /for \(const s of LETTING_STATUSES\) c\[s\] = 0;/);
  const tracker = source('client/src/pages/available-units.tsx');
  assert.match(tracker, /const MARKETING_STATUSES = LETTING_STATUSES;/);
  assert.match(tracker, /for \(const s of MARKETING_STATUSES\) counts\[s\] = 0;/);
  assert.match(tracker, /const HISTORIC_PILL_STATUSES: DealStatusCode\[\] = HISTORIC_STATUSES;/);
});

test('the Deals pickers (the deal form and the Deals table) do not offer Withdrawn, and a Withdrawn deal still shows it', () => {
  const options = source('client/src/lib/crm-options.ts');
  assert.match(options, /dealStatus: DEAL_PAGE_STATUSES\.filter\(\(c\) => c !== "OPP"\) as string\[\],/);
  const deals = source('client/src/pages/deals.tsx');
  // The deal form (New Deal, Edit, the deal page's Edit).
  const form = deals.slice(deals.indexOf('<SelectTrigger data-testid="select-deal-status">'), deals.indexOf('{isApprovalStatus && !isSenior && ('));
  assert.ok(form.length > 0, 'the deal form status picker was not found');
  assert.match(form, /\{CRM_OPTIONS\.dealStatus\.map\(\(s\) => \{/);
  assert.match(form, /const current = legacyToCode\(form\.status\);\s+return current && !CRM_OPTIONS\.dealStatus\.includes\(current\) \? \(\s+<SelectItem value=\{current\} disabled data-testid="select-deal-status-current">\{DEAL_STATUS_LABELS\[current\]\}<\/SelectItem>/);
  // The Deals table's status cell: its chip shows the stored status whatever is offered.
  assert.match(deals, /const all: string\[\] = mode === "wip" \? WIP_STATUSES : CRM_OPTIONS\.dealStatus;/);
  assert.match(deals, /<InlineLabelSelect\s+value=\{legacyToCode\(deal\.status\) \|\| deal\.status\}\s+options=\{statusOptions\}/);
  const chip = source('client/src/components/inline-edit.tsx');
  assert.match(chip, /\{\(value && labelMap\?\.\[value\]\) \|\| value\}/);
});

test('the WIP report status editor reads the deal pickers\' list', () => {
  const wip = source('client/src/pages/wip-report.tsx');
  assert.match(wip, /value=\{legacyToCode\(e\.dealStatus\) \|\| ""\}\s+options=\{DEAL_PAGE_STATUSES as unknown as string\[\]\}/);
});

test('the staff Letting Tracker offers no Withdrawn: bulk Change Status, the row Deal Status and the Unit Status', () => {
  const tracker = source('client/src/pages/available-units.tsx');
  assert.match(tracker, /\{LETTING_PICK_STATUSES\.filter\(s => s !== "SOL"\)\.map\(s => \(\s+<DropdownMenuItem/);
  assert.doesNotMatch(tracker, /MARKETING_STATUSES\.filter\(s => s !== "SOL"\)/);
  assert.match(tracker, /const DEAL_PIPELINE_STATUSES: DealStatusCode\[\] = WIP_STATUSES;/);
  assert.match(tracker, /options=\{DEAL_PIPELINE_STATUSES\}/);
  assert.match(tracker, /const UNIT_STATUSES: DealStatusCode\[\] = \["OPP", "AVA"\];/);
  // Every option list on the page is one of those three.
  const lists = [...tracker.matchAll(/options=\{([A-Z_]+)\}/g)].map(m => m[1]);
  for (const list of lists) assert.ok(['DEAL_PIPELINE_STATUSES', 'UNIT_STATUSES'].includes(list), `options={${list}}`);
  // Deleting a unit is how a letting ends: its deal is still moved to Withdrawn on the server.
  assert.match(tracker, /r\?\.dealWithdrawn \? "Its transaction has been moved to Withdrawn\." : undefined/);
  const routes = source('server/routes.ts');
  assert.match(routes, /await mirrorFromAvailableUnit\(unitId, "WIT", \{ pool, reason: "available_units\.DELETE", actorUserId \}\);/);
});

test('the joint agent\'s Edit unit offers no Withdrawn, and a unit already at it still shows it', () => {
  const format = source('client/src/components/landsec-tracker/format.ts');
  const line = find('client/src/components/landsec-tracker/format.ts', (n, ast) => ts.isVariableStatement(n) && n.getText(ast).includes('UNIT_STATUS_OPTIONS'));
  const { UNIT_STATUS_OPTIONS } = evaluate(line, { LETTING_PICK_STATUSES, SYSTEM_SET_STATUSES });
  assert.deepEqual(UNIT_STATUS_OPTIONS, ['AVA', 'NEG', 'HOT', 'SOL', 'EXC', 'COM']);
  assert.match(format, /UNIT_STATUS_OPTIONS: DealStatusCode\[\] = LETTING_PICK_STATUSES\.filter\(/);
  const dialog = source('client/src/components/landsec-tracker/edit-unit-dialog.tsx');
  assert.match(dialog, /const statusOptions = UNIT_STATUS_OPTIONS\.includes\(unit\.statusCode\) \? UNIT_STATUS_OPTIONS : \[unit\.statusCode, \.\.\.UNIT_STATUS_OPTIONS\];/);
  assert.match(dialog, /\{statusOptions\.map\(c => <SelectItem key=\{c\} value=\{c\} disabled=\{!UNIT_STATUS_OPTIONS\.includes\(c\)\}>\{statusLabel\(c\)\}<\/SelectItem>\)\}/);
  assert.doesNotMatch(dialog, /"WIT"/);
});

test('the Investment Tracker still offers Withdrawn: the row, the Change status menu and the form', () => {
  const page = source('client/src/pages/investment-tracker.tsx');
  assert.match(page, /const STATUSES = INVESTMENT_STATUSES;/);
  assert.match(page, /options=\{\[\.\.\.STATUSES, SOLD_COMP\]\}/);
  assert.match(page, /\{STATUSES\.map\(s => \(\s+<DropdownMenuItem key=\{s\} onClick=\{\(\) => bulkSetStatus\(s\)\}/);
  assert.match(page, /<SelectContent>\{STATUSES\.map\(s => <SelectItem key=\{s\} value=\{s\}>\{DEAL_STATUS_LABELS\[s\]\}<\/SelectItem>\)\}<\/SelectContent>/);
});

test('ChatBGP offers no Withdrawn for a tracker unit, says to delete the unit, and keeps it for the Investment Tracker', () => {
  const chat = source('server/chatbgp.ts');
  const hint = find('server/chatbgp.ts', (n, ast) => ts.isVariableStatement(n) && n.getText(ast).startsWith('const TRACKER_STATUS_HINT'));
  const { TRACKER_STATUS_HINT } = evaluate(`${hint}\nexports.TRACKER_STATUS_HINT = TRACKER_STATUS_HINT;`, { LETTING_PICK_STATUSES, SYSTEM_SET_STATUSES, DEAL_STATUS_LABELS });
  assert.equal(TRACKER_STATUS_HINT, 'OPP (Opportunity), AVA (Available), NEG (Negotiating), HOT (HOTs), SOL (Solicitors), EXC (Exchanged), COM (Completed)');
  assert.match(chat, /Withdrawn is not offered \(Woody, 2026-11-20\): when a letting falls through, tell the user to delete the unit on the Letting Tracker/);
  assert.match(chat, /A transaction that falls through is deleted, not withdrawn \(Woody, 2026-11-20\)/);
  assert.equal(chat.split('COM (completed), WIT (withdrawn).').length - 1, 2, 'the two Investment Tracker tools still list Withdrawn');
  // The server still accepts WIT on a save: chat refuses only an unknown or a system-set code.
  assert.match(chat, /if \(SYSTEM_SET_STATUSES\.includes\(code\)\) return/);
  assert.ok(!SYSTEM_SET_STATUSES.includes('WIT'));
  // An import of old data may still write Withdrawn.
  assert.match(source('server/universal-ingest.ts'), /status \(string — \$\{\[\.\.\.DEAL_PAGE_STATUSES, "WIT"\]\.join\(" \| "\)\}\)/);
  const map = source('server/chatbgp-app-map.ts');
  assert.match(map, /\*\*A transaction that falls through is deleted, not withdrawn\*\*/);
  assert.doesNotMatch(map, /Change Status → Withdrawn/);
});
