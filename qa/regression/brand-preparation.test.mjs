import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Router } from 'express';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { nextPreparationState } from '../../server/brand-preparation-jobs.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

test('batch endpoint resolves the literal route instead of enriching company "batch"', async () => {
  const ast = ts.createSourceFile('brand-enrichment.ts', source('server/brand-enrichment.ts'), ts.ScriptTarget.Latest, true);
  const routes = ast.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === 'router.post'
    && ts.isStringLiteral(node.expression.arguments[0]) && node.expression.arguments[0].text.startsWith('/api/brand/enrich/'));
  const router = Router(); let singleCalls = 0, batchCalls = 0;
  evaluate(routes.map(node => node.getText(ast)).join('\n'), {
    router, requireAuth: (_req, _res, next) => next(), checkBrandScope: async () => true,
    prepareBrandStage: async () => { singleCalls++; return { state: { status: 'ready' } }; }, enqueueBrandPreparation: async () => {},
    runBrandPreparationBatch: async limit => { batchCalls++; return { processed: limit }; },
  });
  const result = await new Promise((resolve, reject) => {
    const response = { json: resolve, status(code) { this.statusCode = code; return this; } };
    router.handle({ method: 'POST', url: '/api/brand/enrich/batch', body: { limit: 4 } }, response, reject);
  });
  assert.equal(result.processed, 4); assert.equal(batchCalls, 1); assert.equal(singleCalls, 0);
});

test('ordinary BGP take reads only persisted matching-identity output and never calls a model', async () => {
  const company = { id: 'brand', name: 'COOK', domain: 'cookfood.net', ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net', country: 'gb' } } };
  let saved; const queries = [];
  const code = find('server/brand-ai-take.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'readPreparedBrandAiTake');
  const { readPreparedBrandAiTake } = evaluate(code, {
    getBrandIdentity, takeKey: (id, tab) => `brand-prepared-take:${id}:${tab}`,
    pool: { query: async (sql, values) => { queries.push({ sql, values }); return { rows: sql.includes('crm_companies') ? [company] : saved ? [{ value: saved }] : [] }; } },
    callClaude: () => { throw new Error('Ordinary profile open must not call an AI provider'); },
  });
  const pending = await readPreparedBrandAiTake('brand', 'brand'); assert.equal(pending.pending, true); assert.equal(pending.text, '');
  saved = { text: 'Prepared action brief', fingerprint: getBrandIdentity(company).fingerprint, generatedAt: 100, expiresAt: Date.now() + 10000 };
  const cached = await readPreparedBrandAiTake('brand', 'brand'); assert.equal(cached.text, saved.text); assert.equal(cached.cached, true);
  company.domain = 'unrelated.example';
  const changed = await readPreparedBrandAiTake('brand', 'brand'); assert.equal(changed.text, ''); assert.equal(changed.pending, true);
  assert.ok(queries.every(query => query.sql.startsWith('SELECT')));
});

test('successful generation has freshness; failed/no-match attempts never manufacture a success date', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const empty = nextPreparationState({}, { status: 'no_match' }, now);
  assert.equal(empty.lastSuccessAt, undefined); assert.equal(empty.nextAttemptAt, '2026-09-17T12:00:00.000Z');
  const success = nextPreparationState({}, { status: 'ready' }, now); assert.equal(success.lastSuccessAt, now.toISOString());
  const error = nextPreparationState({ failures: 20 }, { status: 'error', reason: 'Failed' }, now);
  assert.equal(error.nextAttemptAt, '2026-09-17T12:00:00.000Z'); assert.equal(error.lastSuccessAt, undefined);
});

test('profile enrichment rejects object text and unknown headcount, and incomplete data does not become fresh', async () => {
  const company = { id: 'brand', name: 'COOK', domain: 'cookfood.net', enrichment_revision: '2026-09-10 12:00:00.123456',
    ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net' } } };
  const writes = [];
  const code = find('server/brand-enrichment.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'enrichCompany') + '\nexports.enrichCompany = enrichCompany;';
  const { enrichCompany } = evaluate(code, {
    getBrandIdentity, process: { env: { ANTHROPIC_API_KEY: 'synthetic-test-key' } },
    ENRICHABLE_FIELDS: ['description', 'industry', 'employee_count', 'store_count'], ROLLOUT_VALUES: [],
    MODEL_PRIMARY: 'test', MODEL_FALLBACK_1: 'test', MODEL_FALLBACK_2: 'test',
    fetchBrandWebContext: async () => '', buildPrompt: () => 'synthetic input',
    anthropic: { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ description: { wrong: 'shape' }, industry: 'Food', employee_count: 0, store_count: [] }) }] }) } },
    pool: { query: async (sql, values) => { if (sql.startsWith('SELECT')) return { rows: [company] }; writes.push({ sql, values }); return { rowCount: 1 }; } },
  });
  const result = await enrichCompany('brand');
  assert.deepEqual(Array.from(result.updated), ['industry']); assert.match(result.reason, /missing description or industry/);
  assert.equal(writes[0].sql.includes('last_enriched_at = now()'), false);
  assert.equal(writes[0].values.at(-1), company.enrichment_revision);
});

test('AI backer detail cannot override the human-maintained backers headline', async () => {
  const company = { id: 'brand', name: 'COOK', domain: 'cookfood.net', backers: 'Human confirmed owner', description: 'Human description', industry: 'Food',
    ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net' } } };
  const code = fn => find('server/brand-enrichment.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === fn);
  const { enrichCompany } = evaluate(code('enrichCompany') + '\nexports.enrichCompany=enrichCompany;', {
    getBrandIdentity, process: { env: { ANTHROPIC_API_KEY: 'synthetic-test-key' } }, ENRICHABLE_FIELDS: ['backers'], ROLLOUT_VALUES: [],
    MODEL_PRIMARY: 'test', MODEL_FALLBACK_1: 'test', MODEL_FALLBACK_2: 'test', fetchBrandWebContext: async () => '', buildPrompt: () => '',
    anthropic: { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ backers: 'Wrong owner', backers_detail: [{ name: 'Wrong owner', type: 'parent group', description: 'Wrong ownership claim' }] }) }] }) } },
    pool: { query: async sql => sql.startsWith('SELECT') ? { rows: [company] } : { rowCount: 1 } },
  });
  const result = await enrichCompany('brand'); assert.equal(result.updated.includes('backers_detail'), false);
  assert.equal(company.ai_generated_fields.backers_detail, undefined); assert.equal(company.backers, 'Human confirmed owner');
});
