// The Investment Tracker's top (Woody, 2026-11-16: "everything stays at the
// top when scrolling"). In the app it is two lines on a computer and folds to
// one once the table is scrolled. The presentation window is the table alone
// (Jack, the same day) and fills its window at every size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source } = require('./source-harness.cjs');

const page = source('client/src/pages/investment-tracker.tsx');

test('the top folds when the table is scrolled: never on a phone, never in the presentation window', () => {
  assert.match(page, /const \[folded, setFolded\] = useState\(false\);/);
  assert.match(page, /const foldedTop = folded && !isMobile && !present;/);
  assert.match(page, /if \(!page \|\| isMobile \|\| present\) return;/);
  assert.match(page, /if \(table\.scrollTop > 48\) setFolded\(/);
  // A return to the top counts only when the person scrolled there: not the
  // jump a taller table makes, and not a sideways scroll at the top.
  assert.match(page, /else if \(table\.scrollTop <= 0 && cameUp && settled\(\)\) setFolded\(false\);/);
  assert.match(page, /Date\.now\(\) - foldedAtRef\.current > 400/);
  assert.match(page, /data-testid="button-show-tracker-top"/);
});

test('folded, the status pills and the charts are not drawn', () => {
  assert.match(page, /\{!foldedTop && !present && \(\s*<div className=\{`flex items-center gap-3 shrink-0/);
  assert.match(page, /\{chartsExpanded && !isMobile && !foldedTop && !present && \(/);
  assert.match(page, /\{foldedTop && <div className="flex min-w-0 items-center gap-1\.5 overflow-hidden">\{filterChips\(true\)\}<\/div>\}/);
});

test('the status pills are one line, and Class, Tenure and Agent sit behind Filters', () => {
  assert.match(page, /<PillLine testId="tracker-status-pills">/);
  const line = page.slice(page.indexOf('function PillLine('), page.indexOf('// `present` is the pop-out presentation window'));
  assert.match(line, /flex-nowrap/);
  assert.doesNotMatch(line, /flex-wrap/);
  const panel = page.slice(page.indexOf('const filtersButton = ('), page.indexOf('  return (\n    // On a phone the page scrolls as one'));
  for (const id of ['button-tracker-filters', 'tracker-filters-panel', 'filter-class-', 'select-tenure-filter', 'select-agent-filter', 'clear-all-filters']) {
    assert.ok(panel.includes(id), id);
  }
  // Each of those controls is drawn once, in the panel.
  for (const id of ['select-tenure-filter', 'select-agent-filter', 'filter-class-']) {
    assert.equal(page.split(`data-testid=${id.endsWith('-') ? '{`' : '"'}${id}`).length - 1, 1, id);
  }
});

test('the presentation window is the table alone: its own search, no pills, filters, charts or Add Asset', () => {
  assert.match(page, /\{present && \(\s*<div className="relative w-\[260px\]">/);
  assert.match(page, /\{!isMobile && !foldedTop && !present && \(\s*<Button\s+variant="ghost"/);
  assert.match(page, /\{!present && <Button size=\{foldedTop \? "sm" : "default"\} onClick=\{\(\) => \{ setForm\(makeEmptyForm\(boardType\)\); setCreateOpen\(true\); \}\} data-testid="button-add-asset">/);
});

test('the presentation board is pinned to its window and its table takes no measured cap', () => {
  const present = source('client/src/pages/investment-tracker-present.tsx');
  assert.match(present, /<div className="absolute inset-0" style=\{\{ zoom \}\}>/);
  assert.doesNotMatch(present, /100 \/ zoom/);
  assert.match(page, /<ScrollableTable minWidth=\{2196\} fill=\{present\}>/);
  const table = source('client/src/components/scrollable-table.tsx');
  assert.match(table, /if \(pageScroll \|\| fill\) return;/);
  assert.match(table, /fill \? \{ maxHeight: "none" \}/);
});
