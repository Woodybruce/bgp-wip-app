// The brand page's Expansion tab: the two columns end as level as whole cards
// allow (Woody, 2026-11-18, on Flat Iron's page: "can you fix this gap?").
// The competitor set goes under whichever column is shorter, measured without
// it, so moving it never changes the measurement; on one column it keeps its
// place under the score card. No card is stretched into a blank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const panel = read('client/src/components/brand-profile-panel.tsx');
const pair = read('client/src/components/brand-page/balanced-pair.tsx');
const cards = panel.slice(panel.indexOf('const expansionCards ='), panel.indexOf(') : scoreCard || evidenceCount > 0 ?'));

test('the competitor set is the one card that moves, and only beside signals', () => {
  assert.match(cards, /<BalancedPair/);
  assert.match(cards, /testId="brand-expansion-cards"/);
  assert.match(cards, /left=\{scoreCard\}/);
  assert.match(cards, /right=\{<>\{measuredCards\}\{signalsCard\}\{!signalsCard && hasCompetitors && competitorPanel\}<\/>\}/);
  assert.match(cards, /floater=\{signalsCard && hasCompetitors \? competitorPanel : null\}/);
});

test('the columns are measured without the moving card, and only when side by side', () => {
  assert.match(pair, /<div ref=\{leftRef\} className=\{stackClass\}>\{left\}<\/div>\s*\{side === "left" && floater\}/);
  assert.match(pair, /<div ref=\{rightRef\} className=\{stackClass\}>\{right\}<\/div>\s*\{side === "right" && floater\}/);
  assert.match(pair, /Math\.abs\(l\.getBoundingClientRect\(\)\.top - r\.getBoundingClientRect\(\)\.top\) < 4/);
  assert.match(pair, /sideBySide && r\.offsetHeight < l\.offsetHeight \? "right" : "left"/);
  assert.match(pair, /new ResizeObserver\(decide\)/);
});

test('no card is stretched to fill the gap', () => {
  assert.doesNotMatch(pair, /h-full|flex-1|min-h-|stretch/);
  assert.match(panel, /const pair = "grid grid-cols-1 gap-3 items-start /);
});
