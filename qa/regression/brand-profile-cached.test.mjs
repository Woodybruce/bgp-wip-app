import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, ts } = require('./source-harness.cjs');
const getRoute = path => find('server/brand-profile.ts', (node, ast) => ts.isCallExpression(node)
  && ts.isPropertyAccessExpression(node.expression) && node.expression.getText(ast) === 'router.get'
  && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path);

test('opening a brand profile cannot restart the legacy background analysis or provider enrichment', () => {
  const handler = getRoute('/api/brand/:companyId/profile');
  for (const name of ['refreshBrandAnalysis', 'generateBrandAnalysis', 'autoRefreshApolloIfStale', 'autoRefreshRocketReachIfStale',
    'autoRefreshBrandImages', 'researchBrandStores', 'enrichBrand', 'prepareBrandStage']) {
    assert.doesNotMatch(handler, new RegExp(`\\b${name}\\b`), `${name} belongs in a controlled preparation action, not a page read`);
  }
  assert.doesNotMatch(handler, /\bfetch\s*\(|anthropic\.messages\.create|\bcallClaude\s*\(/);
});

test('brand hero is read from approved saved images without a Places fallback', () => {
  const handler = getRoute('/api/brand/:companyId/flagship-image');
  assert.match(handler, /publishableBrandImage/);
  assert.match(handler, /canUseBrand/);
  assert.doesNotMatch(handler, /\bfetch\s*\(|researchBrandStores|maps\.googleapis\.com|autoRefreshBrandImages/);
  assert.match(handler, /status\(204\)/, 'a missing approved photo remains empty');
});
