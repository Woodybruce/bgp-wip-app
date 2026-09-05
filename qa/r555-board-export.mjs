// r555: does the Board Report's own Excel export agree with the screen?
import ExcelJS from '../node_modules/exceljs/lib/exceljs.nodejs.js';
const BASE = 'http://localhost:5000';
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) });
const { token } = await r.json();
const res = await fetch(`${BASE}/api/board-report/export-excel`, { headers: { Authorization: 'Bearer ' + token } });
console.log('export status', res.status, res.headers.get('content-type'));
const buf = Buffer.from(await res.arrayBuffer());
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);
for (const ws of wb.worksheets) {
  console.log(`\n--- SHEET "${ws.name}" (${ws.rowCount} rows) ---`);
  ws.eachRow((row, i) => {
    if (i > 40) return;
    const vals = row.values.slice(1).map(v => (v && v.result !== undefined ? v.result : v));
    console.log(' ', JSON.stringify(vals));
  });
}
