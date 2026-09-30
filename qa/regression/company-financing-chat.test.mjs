import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts, source } = require('./source-harness.cjs');

const branch = find('server/chatbgp.ts', (n, ast) => ts.isIfStatement(n) && n.expression.getText(ast) === 'fnName === "get_company_financing"');

function fixture(helper) {
  const calls = [];
  const { run } = evaluate(`export async function run(fnArgs: any) { const fnName = "get_company_financing"; ${branch} }`, {
    require(name) {
      assert.equal(name, './company-financing', 'Research must not invoke paid ordering or administrative tools');
      return { getCompanyFinancingEvidence: async args => { calls.push(args); return helper(args); } };
    },
  });
  return { run, calls };
}

test('ordinary chat execution returns sourced financing evidence without admin or purchase dependencies', async () => {
  const evidence = {
    company: { number: '11473397', name: 'Example owner' },
    outstandingBalance: null,
    charges: [{ status: 'outstanding', instrument: {
      propertyTitleMatch: true,
      evidence: [{ page: 6, text: 'Property title NGL813653' }],
      url: '/api/companies-house/document/doc-123',
    } }],
  };
  const f = fixture(() => evidence);
  const out = await f.run({ companyNumber: '11473397', titleNumber: 'NGL813653', maxDocuments: 4 });
  assert.equal(out.data, evidence);
  assert.equal(out.data.outstandingBalance, null);
  assert.equal(out.data.charges[0].instrument.evidence[0].page, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ companyNumber: '11473397', titleNumber: 'NGL813653', maxDocuments: 4 }]);
});

test('provider failure is an incomplete check and cannot turn into a debt-free finding or paid fallback', async () => {
  const f = fixture(() => { throw new Error('Companies House temporarily unavailable'); });
  const out = await f.run({ companyNumber: '11473397' });
  assert.equal(out.data.success, false);
  assert.match(out.data.error, /Companies House temporarily unavailable/);
  assert.match(out.data.note, /incomplete check/);
  assert.match(out.data.note, /not evidence.*no debt/);
  assert.equal(f.calls.length, 1);
});

test('debt research is exposed as a standard tool with verified owner and title inputs', () => {
  const call = find('server/chatbgp.ts', (n, ast) => ts.isCallExpression(n)
    && n.expression.getText(ast) === 'tools.push'
    && n.getText(ast).includes('name: "get_company_financing"'));
  const { tools } = evaluate(`export const tools: any[] = []; ${call};`);
  const tool = tools[0].function;
  assert.equal(tool.name, 'get_company_financing');
  assert.deepEqual(Array.from(tool.parameters.required), ['companyNumber']);
  assert.ok(tool.parameters.properties.titleNumber);
  assert.match(tool.description, /scanned pages/);
  assert.match(tool.description, /No paid HMLR order/);
  assert.match(source('server/chatbgp.ts'), /charge count alone does not establish leverage/);
});
