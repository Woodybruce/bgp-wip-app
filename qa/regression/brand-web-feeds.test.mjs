import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/brand-web-feeds.ts';
const decl = name => find(file, node => (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === name))
  || (ts.isFunctionDeclaration(node) && node.name?.text === name));
const { pick } = evaluate(['PAGE_PATTERNS', 'NOT_A_PAGE', 'SOCIAL_HOSTS', 'pickBrandFeedPages'].map(decl).join('\n').replace(/^export /gm, '') + '\nexports.pick=pickBrandFeedPages;', { URL });
const L = (url, text = '') => ({ url, text });

test('the online shop is not the locations page; the restaurant finder is', () => {
  const out = pick([L('https://www.dishoom.com/store/', 'Shop'), L('https://www.dishoom.com/locations/', 'Restaurants'), L('https://www.dishoom.com/journal/', 'Journal'),
    L('https://www.dishoom.com/journal/recipes/', 'Recipes'), L('https://www.dishoom.com/careers/', 'Careers'), L('https://uk.linkedin.com/company/dishoom?trk=x', 'LinkedIn'),
    L('https://www.dishoom.com/newsletter/', 'Sign up to our newsletter')], 'https://www.dishoom.com/', 'dishoom.com');
  assert.deepEqual({ ...out }, { locations: 'https://www.dishoom.com/locations/', website: 'https://www.dishoom.com/journal/', careers: 'https://www.dishoom.com/careers/', linkedin: 'https://uk.linkedin.com/company/dishoom' });
});

test('a homepage that lists the venues is followed itself; a jobs subdomain counts as careers', () => {
  const venues = ['soho-en', 'born-en', 'arctriomf-en', 'cascais-en'].map(v => L(`https://www.honestgreens.com/en/restaurants/${v}`, v));
  const out = pick([...venues, L('https://jobs.honestgreens.com/', 'Join us'), L('https://www.instagram.com/honestgreens/', 'Careers')], 'https://www.honestgreens.com/en/', 'honestgreens.com');
  assert.equal(out.locations, 'https://www.honestgreens.com/en/');
  assert.equal(out.careers, 'https://jobs.honestgreens.com/');
  assert.equal(out.website, undefined);
});
