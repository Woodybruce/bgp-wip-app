// The People & HR overview's two columns end level (Woody, 2026-10-28:
// "always end level with the main HR board so looks ordered"; 2026-11-17:
// "fix this so they line up at the bottom"). The boards on the left keep
// their own height and only share spare height (flex-auto, never flex-1,
// which made Hunger Games as tall as the Brucey Bonus board); the Teams card
// stretches to the foot of the row when the left column is the taller side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, ts } = require('./source-harness.cjs');

const FILE = 'client/src/pages/hr-overview.tsx';
const overview = find(FILE, node => ts.isFunctionDeclaration(node) && node.name?.text === 'HrOverview');
const teams = find(FILE, node => ts.isFunctionDeclaration(node) && node.name?.text === 'OrganigramSection');

test('the left boards keep their own height and share only spare height', () => {
  assert.match(overview, /<BruceBonusBoard [^>]*className="lg:flex-auto" \/>/);
  assert.match(overview, /<HungerGamesStrip [^>]*className="lg:flex-auto" \/>/);
  assert.doesNotMatch(overview, /className="lg:flex-1" \/>\s*<HungerGamesStrip|<HungerGamesStrip [^>]*lg:flex-1/);
});

test('the Teams card stretches to the foot of the row', () => {
  assert.match(overview, /<div className="lg:col-span-2 flex flex-col gap-4">\s*<OrganigramSection [^>]*className="lg:flex-1" \/>/);
  assert.match(teams, /<Card className=\{className\}>/);
});
