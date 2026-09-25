import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/brand-profile.ts';
const decl = name => find(file, node => (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === name))
  || (ts.isFunctionDeclaration(node) && node.name?.text === name));
const { brandNewsPatterns, brandNewsQuery } = evaluate(['likeEscape', 'brandNewsPatterns', 'brandNewsQuery'].map(decl).join('\n').replace(/^export /gm, '') + '\nexports.brandNewsPatterns=brandNewsPatterns;exports.brandNewsQuery=brandNewsQuery;');

test('brand news matches the name with or without its apostrophe, aliases and the website', () => {
  const co = { name: "Nando's", domain: 'https://www.nandos.co.uk/', ai_generated_fields: { brand_identity: { status: 'verified', aliases: ['Nandos Chickenland', '50%Off_Co'] } } };
  const p = brandNewsPatterns(co);
  assert.deepEqual([...p.text], ['%Nando_s%', '%Nandos%', '%Nandos Chickenland%', '%50\\%Off\\_Co%']);
  assert.deepEqual([...p.urls], ['%nandos.co.uk%']);
  const q = brandNewsQuery('abc', co);
  assert.equal(q.params[0], 'abc');
  assert.match(q.sql, /n\.title ILIKE \$2 OR|n\.title ILIKE \$2\n/);
  assert.equal(q.params.length, 1 + 4 + 1);
  assert.doesNotMatch(q.sql, /Nando/);
});
