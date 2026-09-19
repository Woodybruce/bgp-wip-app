const assert = require('node:assert/strict');
const { source, route, evaluate } = require('./source-harness.cjs');
const statuses = evaluate(source('shared/deal-status.ts'));
async function runRoute(url, deals, senior, allocations = []) {
  let handler, result;
  evaluate(route('server/crm.ts', 'get', url), {
    app: { get: (_, ...handlers) => handler = handlers.at(-1) }, requireAuth() {},
    isClientRequestUser: async () => false, isWipSenior: async () => senior,
    hasWipFullView: async () => senior,
    storage: { getUser: async () => ({ team: 'London Retail', isAdmin: senior }) },
    db: { select: () => ({ from: async table => table === 'deals' ? deals : table === 'allocations' ? allocations : [] }) },
    crmDeals: 'deals', dealFeeAllocations: 'allocations', crmProperties: {}, crmCompanies: {},
    WIP_RESTRICTED_AGENTS: new Set(['woody bruce']), ...statuses,
  });
  await handler({ session: { userId: 'test-user' }, params: { agentName: 'Agent A' } }, {
    json(v) { result = v; }, status(n) { throw new Error(`Unexpected response ${n}`); },
  });
  return JSON.parse(JSON.stringify(result));
}
(async () => {
  const make = (status, fee) => ({ id: status, status, fee, team: ['London Retail'], internalAgent: ['Agent A'] });
  const fixture = [make('AVA', 10000), make('WIT', 20000), make('REP', 30000), make('INV', 40000), make('SOL', 5000), make('EXC', 6000), make('COM', 7000)];
  const [summary] = await runRoute('/api/wip/agent-summary', fixture, true);
  assert.deepEqual(summary, { agent: 'Agent A', wip: 28000, invoiced: 40000 });
  const drilldown = await runRoute('/api/wip/agent-drilldown/:agentName', fixture, true);
  assert.equal(drilldown.reduce((sum, d) => sum + d.wip, 0), summary.wip);
  assert.equal(drilldown.reduce((sum, d) => sum + d.invoiced, 0), summary.invoiced);
  for (const code of ['SOL', 'EXC', 'COM']) assert.equal(drilldown.find(d => d.status === code).stage, 'wip');
  const split = [{ ...make('SOL', 10000), internalAgent: ['Agent A', 'Woody Bruce'] }];
  for (const senior of [true, false]) {
    const results = await runRoute('/api/wip/agent-summary', split, senior);
    assert.equal(results.find(d => d.agent === 'Agent A').wip, 5000);
    assert.equal(results.some(d => d.agent === 'Woody Bruce'), senior);
  }
  console.log('PASS: WIP eligibility, summary/drilldown reconciliation, canonical stages, viewer-independent allocation');
})().catch(error => { console.error(error); process.exitCode = 1; });
