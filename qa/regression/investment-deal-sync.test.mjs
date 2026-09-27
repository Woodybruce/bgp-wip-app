import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTrackerFromDeal, transferOwnershipOnCompletion, startAmlOnStatus, boardForDealType } from '../../server/investment-deal-sync.ts';
import { isInvestmentTransaction, investmentCompFromLeasing } from '../../server/investment-comp-sync.ts';

// A querier that answers by SQL prefix and records every call.
function fakePool(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) if (re.test(sql)) return fn(params, sql);
      return { rows: [], rowCount: 0 };
    },
  };
}

test('deal types map to the investment boards', () => {
  assert.equal(boardForDealType('Sale'), 'Sales');
  assert.equal(boardForDealType('Investment Acquisition'), 'Purchases');
  assert.equal(boardForDealType('Letting'), null);
});

test('a deal-page edit lands on the Sales board row — only the fields written', async () => {
  const q = fakePool([
    [/FROM investment_tracker WHERE deal_id/, () => ({ rows: [{ id: 't1', board_type: 'Sales', status: 'NEG', guide_price: 10e6, niy: 5.5, buyer_id: null, buyer: null, client_id: 'v1', client: 'Vendor Co' }] })],
    [/FROM crm_deals d/, () => ({ rows: [{ id: 'd1', status: 'HOT', deal_type: 'Sale', pricing: 12e6, yield_percent: null, vendor_id: 'v1', vendor_name: 'Vendor Co', purchaser_id: 'b1', purchaser_name: 'Buyer plc' }] })],
  ]);
  const n = await syncTrackerFromDeal('d1', ['pricing', 'purchaserId', 'status'], { pool: q });
  assert.equal(n, 1);
  const upd = q.calls.find(c => /^UPDATE investment_tracker/.test(c.sql));
  assert.match(upd.sql, /status = /);
  assert.match(upd.sql, /guide_price = /);
  assert.match(upd.sql, /buyer_id = /);
  assert.match(upd.sql, /buyer = /);
  assert.doesNotMatch(upd.sql, /niy = /, 'yield was not edited, so the board keeps its NIY');
  assert.doesNotMatch(upd.sql, /client_id = /);
  assert.ok(upd.params.includes('HOT') && upd.params.includes(12e6) && upd.params.includes('b1') && upd.params.includes('Buyer plc'));
});

test('completion makes the buyer the owner, once', async () => {
  let events = [];
  const q = fakePool([
    [/FROM crm_deals d JOIN crm_properties/, () => ({ rows: [{ id: 'd1', status: 'COM', deal_type: 'Sale', property_id: 'p1', vendor_id: 'v1', purchaser_id: 'b1', landlord_id: 'v1', freeholder_id: 'v1', long_leaseholder_id: null, property_status: 'Sales Instruction', tenure: 'Freehold' }] })],
    [/FROM deal_events WHERE deal_id = \$1 AND event_type = 'ownership_transferred'/, () => ({ rows: events })],
    [/^DELETE FROM crm_company_properties/, () => ({ rows: [{ company_id: 'v1', relationship_role: 'owner' }], rowCount: 1 })],
    [/^UPDATE crm_company_properties/, () => ({ rows: [], rowCount: 0 })],
    [/^INSERT INTO deal_events/, () => { events = [{ x: 1 }]; return { rows: [], rowCount: 1 }; }],
  ]);
  assert.equal(await transferOwnershipOnCompletion('d1', { pool: q }), true);
  const prop = q.calls.find(c => /^UPDATE crm_properties/.test(c.sql));
  assert.deepEqual(prop.params, ['p1', 'b1', 'b1', null]);
  assert.ok(q.calls.some(c => /^INSERT INTO crm_company_properties/.test(c.sql) && c.params[0] === 'b1'));
  assert.equal(await transferOwnershipOnCompletion('d1', { pool: q }), false, 'second run is a no-op');
});

test('a lease deal never changes ownership', async () => {
  const q = fakePool([[/FROM crm_deals d JOIN crm_properties/, () => ({ rows: [{ id: 'd2', status: 'COM', deal_type: 'Letting', property_id: 'p1', purchaser_id: 'b1' }] })]]);
  assert.equal(await transferOwnershipOnCompletion('d2', { pool: q }), false);
});

test('HOTs / Solicitors starts AML once, and only with a counterparty', async () => {
  let recent = [];
  const launched = [];
  const q = fakePool([
    [/SELECT tenant_id, landlord_id, vendor_id, purchaser_id/, (p) => ({ rows: [p[0] === 'bare' ? {} : { vendor_id: 'v1', purchaser_id: 'b1' }] })],
    [/event_type IN \('kyc_orchestrator_run', 'kyc_auto_started'\)/, () => ({ rows: recent })],
    [/^INSERT INTO deal_events/, () => { recent = [{ x: 1 }]; return { rows: [] }; }],
  ]);
  const launch = async (id) => { launched.push(id); };
  assert.equal((await startAmlOnStatus('d1', 'NEG', 'NEG', {}, { pool: q, launch })).started, false);
  assert.equal((await startAmlOnStatus('d1', 'NEG', 'EXC', {}, { pool: q, launch })).started, false);
  assert.equal((await startAmlOnStatus('d1', 'NEG', 'HOT', {}, { pool: q, launch })).started, true);
  assert.equal((await startAmlOnStatus('d1', 'HOT', 'SOL', {}, { pool: q, launch })).started, false, 'already running');
  assert.equal((await startAmlOnStatus('bare', 'NEG', 'SOL', {}, { pool: q, launch })).reason, 'no counterparty linked yet');
  assert.deepEqual(launched, ['d1']);
});

test('investment trades are kept out of the leasing comps', () => {
  for (const t of ['Investment Sale', 'Sale', 'Investment', 'Purchase']) assert.equal(isInvestmentTransaction(t), true, t);
  for (const t of ['Open Market Letting', 'Rent Review', 'Lease Acquisition', 'Leasehold Acquisition', 'Tenant Acquisition', 'Assignment', 'Lease Renewal']) assert.equal(isInvestmentTransaction(t), false, t);
  assert.equal(isInvestmentTransaction(null, 'Purchase, Sale'), true);
  const c = investmentCompFromLeasing({ name: '152/154 Allerton Road, Liverpool', tenant: 'S & PB Re', headlineRent: '350000', useClass: 'Retail', yieldPercent: '6.5' });
  assert.equal(c.transactionType, 'Retail');
  assert.equal(c.capRate, 0.065);
  assert.match(c.comments, /Tenant: S & PB Re/);
  assert.match(c.comments, /£350,000 pa/);
});
