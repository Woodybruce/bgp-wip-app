// Finance, 17 November 2026. Woody: "fold reporting and board report in to
// finance trya nd make it sync and to the point there is so much going on its
// overhwelming and it defo double counts"; asked, he chose "Neg & HOTs 50%,
// SOL+ 100%", "Xero invoices, May–April" for fees billed and "Keep money
// only". These tests hold the one pipeline rule, run the real Fees & pipeline
// builder against a fixed book (each deal once, teams adding up to the book,
// BGP House never an agent, invoices reconciling to the penny), build its
// Excel, and pin that no screen keeps a second set of weights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as rule from '../../shared/finance-pipeline.ts';
import { legacyToCode, DEAL_STATUS_LABELS } from '../../shared/deal-status.ts';
const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');

test('one pipeline rule: Negotiating and HOTs 50%, Solicitors onwards 100%, invoiced never', () => {
  assert.deepEqual({ ...rule.PIPELINE_WEIGHTS }, { NEG: 0.5, HOT: 0.5, SOL: 1, EXC: 1, COM: 1 });
  const stage = (status, extra = {}) => rule.pipelineStage({ status, fee: 100000, ...extra });
  for (const s of ['NEG', 'HOT', 'SOL', 'EXC', 'COM']) assert.equal(stage(s), s);
  assert.equal(stage('Heads of Terms'), 'HOT', 'a legacy spelling of HOTs counts');
  assert.equal(stage('Under Offer'), 'SOL');
  assert.equal(stage('COM', { invoiceCount: 1 }), null, 'an invoiced deal is Xero income, not the book');
  assert.equal(stage('EXC', { invoiceCount: 1 }), null, 'an invoice raised at exchange is counted once, in Xero');
  for (const s of ['INV', 'WIT', 'ARCH', 'AVA', 'LIVE', 'OPP', 'REP', null, '']) assert.equal(stage(s), null, String(s));
  assert.equal(stage('NEG', { dealType: 'Sale' }), null, 'investment deals count from Solicitors');
  assert.equal(stage('HOT', { team: ['Investment'] }), null);
  assert.equal(stage('SOL', { dealType: 'Purchase' }), 'SOL');
  assert.equal(rule.pipelineStage({ status: 'NEG', fee: 0 }), null);
  assert.equal(rule.pipelineStage({ status: 'NEG', fee: null }), null);
  assert.equal(rule.pipelineWeighted(80000, 'HOT'), 40000);
  assert.deepEqual([...rule.FORWARD_COMMISSION_STAGES], ['NEG', 'HOT', 'SOL']);
});

test('a deal on several teams is shared equally; BGP\'s year runs May to April', () => {
  assert.deepEqual(rule.teamShares(['City', 'London Estate']), [{ team: 'City', share: 0.5 }, { team: 'London Estate', share: 0.5 }]);
  assert.deepEqual(rule.teamShares(['City', 'City']), [{ team: 'City', share: 1 }]);
  assert.deepEqual(rule.teamShares(null), [{ team: 'No team', share: 1 }]);
  assert.equal(rule.financialYearStart(new Date('2026-11-17T12:00:00Z')).toISOString().slice(0, 10), '2026-05-01');
  assert.equal(rule.financialYearStart(new Date('2027-04-30T12:00:00Z')).toISOString().slice(0, 10), '2026-05-01');
  assert.equal(rule.financialYearStart(new Date('2027-05-01T00:00:00Z')).toISOString().slice(0, 10), '2027-05-01');
});

// The real builder, cut from the source and run against a fixed book.
const BOARD = 'server/finance-board.ts';
const fn = name => find(BOARD, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const constant = start => find(BOARD, n => ts.isVariableStatement(n) && n.getText().startsWith(start));
const DEALS = [
  { id: 'd1', name: 'Unit 4 letting', status: 'NEG', fee: 100000, dealType: 'New Letting', team: ['City', 'London Estate'], dt: '2026-12-15', invoiceCount: 0 },
  { id: 'd2', name: 'Lease disposal', status: 'HOT', fee: 40000, dealType: 'Lease Disposal', team: ['City'], dt: null, invoiceCount: 0 },
  { id: 'd3', name: 'Block sale', status: 'SOL', fee: 60000, dealType: 'Sale', team: ['Investment'], dt: '2027-06-01', invoiceCount: 0 },
  { id: 'd4', name: 'Invoiced letting', status: 'COM', fee: 30000, dealType: 'New Letting', team: ['City'], dt: '2026-06-01', invoiceCount: 1 },
  { id: 'd5', name: 'Completed, to invoice', status: 'Completed', fee: 20000, dealType: 'New Letting', team: null, dt: '2026-08-01', invoiceCount: 0 },
  { id: 'd6', name: 'Withdrawn', status: 'WIT', fee: 999000, dealType: 'New Letting', team: ['City'], dt: null, invoiceCount: 0 },
  { id: 'd7', name: 'Early purchase', status: 'NEG', fee: 500000, dealType: 'Purchase', team: ['Investment'], dt: null, invoiceCount: 0 },
  { id: 'd8', name: 'Invoiced', status: 'INV', fee: 10000, dealType: 'New Letting', team: ['City'], dt: null, invoiceCount: 1 },
];
const ALLOCATIONS = [
  { dealId: 'd1', agentUserId: 'u-alice', agentName: 'Alice', percentage: 42.5, fixedAmount: null, house: false, userName: 'Alice Adams' },
  { dealId: 'd1', agentUserId: 'u-bob', agentName: 'Bob', percentage: 42.5, fixedAmount: null, house: false, userName: 'Bob Brown' },
  { dealId: 'd1', agentUserId: null, agentName: 'BGP House', percentage: 15, fixedAmount: null, house: true, userName: null },
  { dealId: 'd5', agentUserId: 'u-alice', agentName: 'Alice', percentage: null, fixedAmount: 17000, house: false, userName: 'Alice Adams' },
  { dealId: 'd5', agentUserId: null, agentName: 'Bob (BGP House)', percentage: null, fixedAmount: 3000, house: false, userName: null },
  { dealId: 'd4', agentUserId: 'u-bob', agentName: 'Bob', percentage: 85, fixedAmount: null, house: false, userName: 'Bob Brown' },
  { dealId: 'd4', agentUserId: null, agentName: 'BGP House', percentage: 15, fixedAmount: null, house: true, userName: null },
];
const INVOICES = [
  { xeroInvoiceId: 'x1', date: '2026-06-10', subTotal: 30000 },
  { xeroInvoiceId: 'x2', date: '2026-07-01', subTotal: 5000 },
  { xeroInvoiceId: 'x3', date: '2026-07-20', subTotal: 1000 },
];
const LINKS = [{ xeroInvoiceId: 'x1', dealId: 'd4' }, { xeroInvoiceId: 'x3', dealId: 'd2' }];

function loadBoard({ xero = true } = {}) {
  const pool = {
    async query(sql) {
      if (/FROM crm_deals d/.test(sql)) return { rows: DEALS.map(d => ({ ...d })) };
      if (/FROM deal_fee_allocations/.test(sql)) return { rows: ALLOCATIONS.map(a => ({ ...a })) };
      if (/FROM xero_invoices WHERE xero_invoice_id/.test(sql)) return { rows: LINKS };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
  const realRequire = createRequire(import.meta.url);
  const fakeRequire = (m) => {
    if (m === './xero-financials') return { buildFinancialsShared: async () => (xero ? { fyInvoices: INVOICES } : null) };
    if (m === 'exceljs') return { default: realRequire('exceljs') };
    throw new Error(`unexpected require: ${m}`);
  };
  const built = evaluate([
    constant('const monthKey ='), constant('const round ='),
    fn('loadBookDeals'), fn('whenExpected'), fn('sharesByDeal'), fn('loadAllocations'), fn('buildFinanceBoard'),
    fn('monthLabel'), fn('boardWorkbook'),
    'exports.buildFinanceBoard = buildFinanceBoard; exports.boardWorkbook = boardWorkbook; exports.whenExpected = whenExpected;',
  ].join('\n'), {
    pool, require: fakeRequire, ...rule, legacyToCode, DEAL_STATUS_LABELS, Map, Set, Math, Number, String, Array, Object, Promise,
  });
  // Objects made inside the sandbox compare as plain data.
  return {
    buildFinanceBoard: async (today) => JSON.parse(JSON.stringify(await built.buildFinanceBoard(today))),
    boardWorkbook: built.boardWorkbook,
  };
}
const TODAY = new Date('2026-11-17T12:00:00Z');

test('the deal book: each live deal once, by the rule, landing this year, with no date or after April', async () => {
  const { buildFinanceBoard } = loadBoard();
  const b = await buildFinanceBoard(TODAY);
  assert.equal(b.fyStart, '2026-05-01');
  assert.equal(b.fyLabel, 'FY 2026–27');
  assert.equal(b.book.count, 4, 'NEG, HOTs, investment at Solicitors, completed to invoice');
  assert.equal(b.book.fee, 220000);
  assert.equal(b.book.weighted, 150000);
  assert.equal(b.book.thisYear, 70000);
  assert.deepEqual(b.book.noDate, { weighted: 20000, count: 1 });
  assert.deepEqual(b.book.afterYearEnd, { weighted: 60000, count: 1 });
  assert.equal(b.book.thisYear + b.book.noDate.weighted + b.book.afterYearEnd.weighted, b.book.weighted);
  assert.deepEqual(b.book.byStage.map(s => [s.code, s.fee, s.weighted, s.weightPct]), [
    ['NEG', 100000, 50000, 50], ['HOT', 40000, 20000, 50], ['SOL', 60000, 60000, 100], ['COM', 20000, 20000, 100],
  ]);
  assert.ok(!b.deals.some(d => ['d4', 'd6', 'd7', 'd8'].includes(d.id)), 'invoiced, withdrawn and provisional deals are not in the book');
});

test('teams and deal types add up to the book: a two-team deal counts half to each', async () => {
  const { buildFinanceBoard } = loadBoard();
  const b = await buildFinanceBoard(TODAY);
  const teams = Object.fromEntries(b.book.byTeam.map(t => [t.name, t.weighted]));
  assert.deepEqual(teams, { City: 45000, Investment: 60000, 'London Estate': 25000, 'No team': 20000 });
  assert.equal(b.book.byTeam.reduce((s, t) => s + t.weighted, 0), b.book.weighted);
  assert.equal(b.book.byTeam.reduce((s, t) => s + t.fee, 0), b.book.fee);
  assert.equal(b.book.byType.reduce((s, t) => s + t.weighted, 0), b.book.weighted);
  assert.equal(b.book.top[0].id, 'd3');
});

test('invoiced this year is Xero\'s invoices, shared by fee split; BGP House is never an agent', async () => {
  const { buildFinanceBoard } = loadBoard();
  const b = await buildFinanceBoard(TODAY);
  assert.deepEqual(b.invoiced && { ...b.invoiced, byMonth: b.invoiced.byMonth.map(m => [m.month, m.total]) }, {
    total: 36000, count: 3, house: 4500,
    byMonth: [['2026-06', 30000], ['2026-07', 6000]],
    notLinked: { total: 5000, count: 1 }, noSplit: { total: 1000, count: 1 },
  });
  assert.deepEqual(b.agents, [
    { agent: 'Bob Brown', invoiced: 25500, book: 21250 },
    { agent: 'Alice Adams', invoiced: 0, book: 38250 },
  ]);
  assert.ok(!b.agents.some(a => /bgp house/i.test(a.agent)), 'a house row by name is BGP House too');
  const toAgents = b.agents.reduce((s, a) => s + a.invoiced, 0);
  assert.equal(toAgents + b.invoiced.house + b.invoiced.notLinked.total + b.invoiced.noSplit.total, b.invoiced.total, 'every pound of invoices is accounted for once');
});

test('with Xero down the book still builds and the invoiced half says so', async () => {
  const { buildFinanceBoard } = loadBoard({ xero: false });
  const b = await buildFinanceBoard(TODAY);
  assert.equal(b.invoiced, null);
  assert.equal(b.book.weighted, 150000);
  assert.deepEqual(b.agents.map(a => [a.agent, a.invoiced]), [['Alice Adams', 0], ['Bob Brown', 0]]);
});

test('the board pack Excel holds the same numbers', async () => {
  const { buildFinanceBoard, boardWorkbook } = loadBoard();
  const b = await buildFinanceBoard(TODAY);
  const ExcelJS = createRequire(import.meta.url)('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await boardWorkbook(b));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'By stage', 'By team', 'By deal type', 'Deals', 'Fees by agent', 'Invoiced by month']);
  const team = wb.getWorksheet('By team');
  const totalRow = team.getRow(team.rowCount);
  assert.equal(totalRow.getCell(1).value, 'Total');
  assert.equal(totalRow.getCell(4).value, 150000);
  const agents = wb.getWorksheet('Fees by agent');
  assert.equal(agents.getRow(agents.rowCount).getCell(2).value, 36000);
});

test('no screen or server path keeps a second set of weights, and the dashboard reads the outlook', () => {
  const cashflow = source('server/cashflow-board.ts');
  assert.ok(!cashflow.includes('PROJ_WEIGHTS'));
  assert.match(cashflow, /const code = pipelineStage\(\{ status: d\.status, fee: d\.fee, dealType: d\.dealType, team: d\.team, invoiceCount: d\.invoiceCount \}\);/);
  assert.match(cashflow, /const rows = await loadBookDeals\(\);/);
  const xero = source('server/xero-financials.ts');
  assert.ok(!xero.includes('STAGE_WEIGHTS'));
  assert.ok(!xero.includes('projectedNet'), 'the old projected net is retired');
  assert.match(xero, /weights: PIPELINE_WEIGHTS,/);
  assert.match(xero, /const stage = pipelineStage\(/);
  assert.match(source('server/commission-engine.ts'), /FORWARD_COMMISSION_STAGES\.map\(stage => \[stage, PIPELINE_WEIGHTS\[stage\]\]\)/);
  assert.match(source('client/src/lib/outlook-model.ts'), /byStage: PIPELINE_STAGES/);
  for (const file of ['client/src/components/dashboard/equity-finance-widget.tsx', 'client/src/components/mobile-home.tsx']) {
    const text = source(file);
    assert.match(text, /useCompanyOutlook\(/, file);
    assert.ok(!text.includes('projection?.projectedNet') && !text.includes('projection.projectedNet'), file);
  }
  // A weight table written anywhere else is a second rule.
  for (const file of ['server/cashflow-board.ts', 'server/xero-financials.ts', 'server/commission-engine.ts', 'server/finance-board.ts', 'client/src/lib/outlook-model.ts', 'client/src/components/company-outlook.tsx', 'client/src/components/finance-board.tsx']) {
    assert.doesNotMatch(source(file), /NEG:\s*0?\.5|SOL:\s*0?\.75|EXC:\s*0?\.9/, file);
  }
  // The invoice list stays on the server.
  assert.match(xero, /res\.json\(forReply\(payload\)\);/);
  assert.match(xero, /return res\.json\(forReply\(cache\.payload\)\);/);
});

test('Finance is six pills; Reporting and Board Report open Fees & pipeline', () => {
  const page = source('client/src/pages/finance.tsx');
  const tabs = JSON.parse(JSON.stringify(evaluate(find('client/src/pages/finance.tsx', n => ts.isVariableStatement(n) && n.getText().startsWith('const FINANCE_TABS')) + '\nexports.tabs = FINANCE_TABS;').tabs));
  assert.deepEqual(tabs.map(t => t.label), ['Overview', 'Fees & pipeline', 'Cash flow', 'Commission', 'History', 'Spend']);
  assert.match(page, /\{tab === "pipeline" && <FinanceBoardSection \/>\}/);
  assert.match(page, /onOpenPipeline=\{\(\) => chooseTab\("pipeline"\)\}/);
  const app = source('client/src/App.tsx');
  assert.match(app, /<Route path="\/board-report">\{\(\) => <Redirect to="\/finance\?tab=pipeline" \/>\}<\/Route>/);
  assert.match(app, /<Route path="\/reporting">\{\(\) => <Redirect to="\/finance\?tab=pipeline" \/>\}<\/Route>/);
  assert.ok(!app.includes('@/pages/reporting') && !app.includes('@/pages/board-report'));
  const crm = source('server/crm.ts');
  assert.ok(!crm.includes('app.get("/api/board-report"') && !crm.includes('"/api/board-report/export-excel"'), 'the double-counting board report is gone');
  const board = source('server/finance-board.ts');
  assert.match(board, /app\.get\("\/api\/finance\/board", requireEquityOrAdmin,/);
  assert.match(board, /app\.get\("\/api\/finance\/board\.xlsx", requireEquityOrAdmin,/);
  // The outlook keeps one line for the book; the stage rows live on the pill.
  const outlook = source('client/src/components/company-outlook.tsx');
  assert.match(outlook, /data-testid="outlook-deal-book"/);
  assert.ok(!outlook.includes('income.byStage.map(s => (\n              <StageRow'), 'stage rows moved to Fees & pipeline');
});
