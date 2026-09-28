import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused@localhost/unused';

// A tiny in-memory stand-in for Office.js: one sheet, cells by address.
function fakeExcel() {
  const cells = new Map(); // "A1" -> formula/value
  const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colName = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const parse = (a) => { const m = a.match(/^([A-Z]+)(\d+)$/); return { c: colNum(m[1]), r: Number(m[2]) }; };
  const evalCell = (f) => {
    if (typeof f !== 'string' || !f.startsWith('=')) return f;
    if (f.includes('/0')) return '#DIV/0!';
    const m = f.match(/^=([A-Z]+\d+)\*([A-Z]+\d+)$/);
    if (m) return Number(evalCell(cells.get(m[1]) ?? 0)) * Number(evalCell(cells.get(m[2]) ?? 0));
    return 0;
  };
  const range = (r0, c0, rows, cols) => {
    const addrs = () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => `${colName(c0 + j)}${r0 + i}`));
    const obj = {
      get address() { return `Sheet1!${colName(c0)}${r0}:${colName(c0 + cols - 1)}${r0 + rows - 1}`; },
      load() {}, rowCount: rows, columnCount: cols, isNullObject: false,
      getResizedRange(dr, dc) { return range(r0, c0, rows + dr, cols + dc); },
      get formulas() { return addrs().map(row => row.map(a => cells.get(a) ?? '')); },
      set formulas(v) { addrs().forEach((row, i) => row.forEach((a, j) => { if (v[i][j] === '') cells.delete(a); else cells.set(a, v[i][j]); })); },
      get values() { return addrs().map(row => row.map(a => evalCell(cells.get(a) ?? ''))); },
      get numberFormat() { return addrs().map(row => row.map(() => 'General')); },
      set numberFormat(_v) {},
    };
    return obj;
  };
  const sheet = {
    getRange(addr) {
      const [a, b] = addr.split(':'); const s = parse(a); const e = b ? parse(b) : s;
      return range(s.r, s.c, e.r - s.r + 1, e.c - s.c + 1);
    },
    getUsedRangeOrNullObject() { return range(1, 1, 5, 5); },
  };
  globalThis.Excel = { run: async (cb) => cb({ workbook: { worksheets: { getItem: () => sheet } }, sync: async () => {} }) };
  return cells;
}

const tools = await import('../../client/src/lib/excel-agent-tools.ts');

test('write_range writes a block with formulas, reports results and error cells, and records undo', async () => {
  const cells = fakeExcel();
  cells.set('B2', 'old');
  const undo = [];
  const r = await tools.runExcelTool('excel_write_range', { sheet: 'Sheet1', range: 'B2', values: [['Rent', 'Yield'], [100000, 0.05], ['=B3*C3', '=B3/0']] }, undo);
  assert.equal(r.written, 'Sheet1!B2:C4');
  assert.equal(r.cells, 6);
  assert.match(r.results, /B4: 5000 \| =B3\*C3/);
  assert.deepEqual(r.errors, ['C4: #DIV/0! (=B3/0)']);
  assert.equal(undo.length, 1);
  assert.equal(undo[0].formulas[0][0], 'old');
  await tools.undoSteps(undo);
  assert.equal(cells.get('B2'), 'old');
  assert.equal(cells.has('B4'), false);
});

test('read_range lists non-empty cells with formulas', async () => {
  const cells = fakeExcel();
  cells.set('A1', 'Rent'); cells.set('B1', 10); cells.set('B2', '=B1*B1');
  const r = await tools.runExcelTool('excel_read_range', { sheet: 'Sheet1', range: 'A1:B2' }, []);
  assert.match(r.cells, /A1: "Rent"/);
  assert.match(r.cells, /B2: 100 \| =B1\*B1/);
});

test('errors come back as a result, not a thrown exception', async () => {
  globalThis.Excel = { run: async () => { throw Object.assign(new Error('The requested resource doesn\'t exist.'), { code: 'ItemNotFound' }); } };
  const r = await tools.runExcelTool('excel_read_range', { sheet: 'Nope' }, []);
  assert.equal(r.code, 'ItemNotFound');
});

test('cell references in replies become chips', () => {
  assert.deepEqual(tools.cellRefs('See [[Summary!B4:F20]] and [[\'Cash Flow\'!C10]] and [[Summary!B4:F20]].').map(r => r.label), ['Summary!B4:F20', 'Cash Flow!C10']);
});

test('server bridge: a tool call waits for the pane and resumes with its result', async () => {
  const agent = await import('../../server/excel-agent.ts');
  const runId = agent.openExcelRun('u1');
  let sent;
  const pending = agent.callExcelTool(runId, (p) => { sent = p; }, 'excel_read_range', { sheet: 'S' });
  assert.equal(sent.excelTool.name, 'excel_read_range');
  // Simulate POST /api/chatbgp/excel-tool-result
  const routes = {};
  agent.registerExcelAgentRoutes({ post: (p, _a, h) => { routes[p] = h; }, get() {}, delete() {} }, () => {});
  let status = 200, body;
  routes['/api/chatbgp/excel-tool-result']({ body: { runId, callId: sent.excelTool.callId, result: { ok: 1 } }, session: { userId: 'u1' } }, { status(s) { status = s; return this; }, json(b) { body = b; } });
  assert.equal(status, 200);
  assert.deepEqual(await pending, { ok: 1 });
  agent.closeExcelRun(runId);
  assert.ok(agent.EXCEL_TOOL_NAMES.has('excel_write_range'));
});
