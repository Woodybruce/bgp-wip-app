import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const fn = find('server/leads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseLeadsArray');
const { parseLeadsArray } = evaluate(fn.replace(/^export /, '') + '\nexports.parseLeadsArray=parseLeadsArray;');

test('a cut-off leads answer still yields every complete lead', () => {
  const full = '[{"title":"A","summary":"x [y] {z}"},{"title":"B"}]';
  assert.equal(parseLeadsArray(full).length, 2);
  const cut = 'Here you go:\n[{"title":"Bunsik opens Coventry","summary":"Pitch \\"Unit 4\\""},{"title":"Pho moves Leeds"},{"title":"Half a le';
  const out = parseLeadsArray(cut);
  assert.deepEqual([...out.map(l => l.title)], ['Bunsik opens Coventry', 'Pho moves Leeds']);
  assert.equal(parseLeadsArray('no leads').length, 0);
});
