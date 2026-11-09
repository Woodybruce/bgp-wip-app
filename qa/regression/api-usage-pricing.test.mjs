import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function meter({ env = {}, query = async () => ({ rows: [] }) } = {}) {
  return evaluate(source('server/api-usage.ts').replace(/^import .*;\n/gm, '') + '\nexport { estimateCost, normalizedUsage, buildCosts };', {
    process: { env }, pool: { query }, requireEquityOrAdmin() {},
    fetch() { throw new Error('No external calls permitted in pricing tests'); },
  });
}
const { estimateCost, normalizedUsage } = meter();
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const usage = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000 };

test('standard GPT-6 estimates use each model’s distinct input, cache and output prices', () => {
  const prices = [
    ['gpt-6.1-sol', 2, .1, 2.5, 10],
    ['gpt-6-sol', 2, .2, 2.5, 10],
    ['gpt-6-luna', .1, .01, .125, .5],
    ['gpt-6-astra', 10, 1, 12.5, 50],
  ];
  for (const [model, input, read, write, output] of prices) {
    close(estimateCost({ provider: 'openai', model, usage }), (input + read + write + output) / 1000);
    close(estimateCost({ provider: 'openai', model: `${model}-2026-09-29`, usage }), (input + read + write + output) / 1000);
  }
});

test('raw Responses usage and normalized adapter usage cost the same without double charging caches', () => {
  const raw = {
    provider: 'openai', model: 'gpt-6.1-sol',
    usage: { input_tokens: 3000, output_tokens: 1000, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 1000 }, output_tokens_details: { reasoning_tokens: 800 } },
  };
  const normalized = { provider: 'openai', model: 'gpt-6.1-sol', usage };
  assert.deepEqual(JSON.parse(JSON.stringify(normalizedUsage(raw))), { input: 1000, output: 1000, read: 1000, write: 1000 });
  close(estimateCost(raw), .0146);
  close(estimateCost(raw), estimateCost(normalized));
});

test('the 272k threshold includes cached input and changes rates for the entire request', () => {
  const base = { provider: 'openai', model: 'gpt-6.1-sol', usage: { input_tokens: 100000, output_tokens: 1000, cache_read_input_tokens: 170000, cache_creation_input_tokens: 2000 } };
  close(estimateCost(base), (100000 * 2 + 170000 * .1 + 2000 * 2.5 + 1000 * 10) / 1e6);
  const longer = { ...base, usage: { ...base.usage, cache_creation_input_tokens: 2001 } };
  close(estimateCost(longer), ((100000 * 2 + 170000 * .1 + 2001 * 2.5) * 2 + 1000 * 10 * 1.5) / 1e6);
  const rawLong = { ...base, usage: { input_tokens: 272001, output_tokens: 1000, input_tokens_details: { cached_tokens: 170000, cache_write_tokens: 2001 } } };
  close(estimateCost(rawLong), estimateCost(longer));
});

test('unknown models, variants and missing usage stay unpriced rather than inventing zero cost', () => {
  for (const model of ['gpt-7', 'gpt-6-sol-pro', 'gpt-6.1-sol-preview', 'gpt-6-luna-tuned', null]) {
    assert.equal(estimateCost({ provider: 'openai', model, usage }), null);
  }
  assert.equal(estimateCost({ provider: 'openai', model: 'gpt-6.1-sol' }), null);
  assert.equal(estimateCost({ provider: 'openai', model: 'gpt-6.1-sol', usage: {} }), null);
  assert.equal(estimateCost({ provider: 'google', model: 'gpt-6.1-sol', usage }), null);
  assert.equal(estimateCost({ provider: 'openai', model: 'claude-fable-5', usage }), null);
  assert.equal(estimateCost({ provider: 'anthropic', model: 'gpt-6.1-sol', usage }), null);
});

test('Claude model-specific cache rates remain separate and saved cost overrides still win', () => {
  close(estimateCost({ provider: 'anthropic', model: 'claude-fable-5', usage }), .0735);
  close(estimateCost({ provider: 'anthropic', model: 'claude-fable-5-1', usage }), .07275);
  close(estimateCost({ provider: 'anthropic', model: 'claude-fable-5-1-20260929', usage }), .07275);
  close(estimateCost({ provider: 'anthropic', model: 'claude-opus-5-5', usage }), .0292);
  close(estimateCost({ provider: 'anthropic', model: 'claude-sonnet-4', usage }), .02205);
  assert.equal(estimateCost({ provider: 'anthropic', model: 'claude-fable-5-2', usage }), null);
  assert.equal(estimateCost({ provider: 'other', model: 'unknown', costUsd: .123 }), .123);
  assert.equal(estimateCost({ provider: 'other', model: 'unknown', costUsd: 0 }), 0);
});

test('image generation retains explicitly configured per-image estimates even with token usage', () => {
  const { estimateCost: withImagePrice } = meter({ env: { AI_IMAGE_COST_USD_OPENAI: '.15', AI_IMAGE_COST_USD_GEMINI: '.08' } });
  close(withImagePrice({ provider: 'openai', model: 'gpt-image-1', images: 2, usage }), .30);
  close(withImagePrice({ provider: 'google', model: 'gemini-image', images: 2 }), .16);
  assert.equal(estimateCost({ provider: 'openai', model: 'gpt-image-1', images: 2, usage }), null);
});

test('logging stores disjoint token buckets and leaves unknown costs NULL', async () => {
  const writes = [];
  const { logAiUsage } = meter({ query: async (sql, params) => { writes.push({ sql, params }); return { rows: [] }; } });
  logAiUsage({ provider: 'openai', model: 'gpt-6.1-sol', feature: 'chat', usage: { input_tokens: 3000, output_tokens: 1000, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 1000 } } });
  logAiUsage({ provider: 'openai', model: 'unknown-model', usage });
  await new Promise(resolve => setImmediate(resolve));
  const inserts = writes.filter(w => w.sql.startsWith('INSERT'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(Array.from(inserts[0].params.slice(3, 8)), [1000, 1000, 1000, 1000, 0]);
  close(inserts[0].params[8], .0146);
  assert.equal(inserts[1].params[8], null);
  assert.match(writes[0].sql, /model ~ '\^claude-fable-5\(-\[0-9\]\{8\}\)\?\$'/);
});

test('cost reporting exposes unpriced calls at total, model and feature levels', async () => {
  const queries = [];
  const { buildCosts } = meter({ query: async sql => {
    queries.push(sql);
    if (sql.includes('AS month_usd')) return { rows: [{ month_usd: 0, fytd_usd: 3.5, month_calls: 2, month_tokens: '1500', month_unpriced_calls: 2, fytd_unpriced_calls: 4, month_unpriced_images: 1 }] };
    if (sql.includes('SELECT provider')) return { rows: [{ provider: 'unknown', model: 'unknown', calls: 2, unpriced_calls: 2, usd: 0 }] };
    if (sql.includes('SELECT COALESCE(feature')) return { rows: [{ feature: 'chat', calls: 2, unpriced_calls: 2, usd: 0 }] };
    return { rows: [] };
  } });
  const costs = await buildCosts();
  assert.equal(costs.monthUsd, 0);
  assert.equal(costs.monthUnpricedCalls, 2);
  assert.equal(costs.fytdUnpricedCalls, 4);
  assert.equal(costs.byProvider[0].unpriced_calls, 2);
  assert.equal(costs.byFeature[0].unpriced_calls, 2);
  assert.match(costs.meteredFrom, /not invoices/);
  const totals = queries.find(q => q.includes('AS month_usd'));
  assert.match(totals, /input_tokens \+ output_tokens \+ cache_read_tokens \+ cache_write_tokens/);
  assert.match(totals, /COUNT\(\*\) FILTER \(WHERE at >= \$1 AND cost_usd IS NULL\)::int AS month_unpriced_calls/);
  assert.match(queries.find(q => q.includes('SELECT provider')), /cost_usd IS NULL\)::int AS unpriced_calls/);
  assert.match(queries.find(q => q.includes('SELECT COALESCE(feature')), /cost_usd IS NULL\)::int AS unpriced_calls/);
});

function renderCosts(data) {
  const component = find('client/src/pages/finance.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'AppCostsSection');
  const js = ts.transpileModule(`${component}\nexports.AppCostsSection = AppCostsSection;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports = {};
  const shell = ({ children }) => React.createElement('div', null, children);
  vm.runInNewContext(js, { React, exports, useQuery: () => ({ data }), Card: shell, CardHeader: shell, CardTitle: shell, CardContent: shell });
  return renderToStaticMarkup(React.createElement(exports.AppCostsSection));
}

test('finance UI labels unknown model costs Unpriced and partial feature costs incomplete', () => {
  const html = renderCosts({
    monthUsd: 1.25, fytdUsd: 3, monthCalls: 3, monthTokens: 1500,
    monthUnpricedCalls: 2, fytdUnpricedCalls: 5, monthUnpricedImages: 0,
    byProvider: [{ provider: 'openai', model: 'new-model', calls: 2, unpriced_calls: 2, usd: 0, images: 0 }],
    byFeature: [{ feature: 'chat', calls: 3, unpriced_calls: 2, usd: 1.25 }],
    scraperapi: null, meteredFrom: 'Provider estimates',
  });
  assert.match(html, /Estimated subtotal/);
  assert.match(html, /Costs are incomplete: 2 unpriced call\(s\) this month; 5 FYTD/);
  assert.match(html, />Unpriced</);
  assert.match(html, /\$1\.25 \+ 2 unpriced/);
  assert.doesNotMatch(html, /\$0\.00/);
});
