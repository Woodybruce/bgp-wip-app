// Dry-run the two r555 two-bot assertions against the live app.
import * as XLSX from '../node_modules/xlsx/xlsx.mjs';
const BASE = 'http://localhost:5000';
const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) });
const { token } = await lr.json();
const auth = { Authorization: 'Bearer ' + token };
const br = await fetch(`${BASE}/api/board-report`, { headers: auth }).then(x => x.json());
const dl = await fetch(`${BASE}/api/crm/deals`, { headers: auth }).then(x => x.json());
const INV = /^(inv|invoiced|billed)$/i;
const priced = dl.filter(d => Number(d.fee) > 0);
const billed = Number(br.performance?.totalFeesYTD || 0);
const monthly = (br.performance?.monthlyFees || []).reduce((s, m) => s + Number(m.total || 0), 0);
const invoicedTotal = priced.filter(d => INV.test(String(d.status || '').trim())).reduce((s, d) => s + Number(d.fee), 0);
const openTotal = priced.filter(d => !INV.test(String(d.status || '').trim())).reduce((s, d) => s + Number(d.fee), 0);
console.log({ billed, monthly, invoicedTotal, openTotal });
console.log('A1 billed<=invoicedTotal:', billed <= invoicedTotal);
console.log('A2 not-including-open:', !(openTotal > 0 && billed >= invoicedTotal + openTotal));
console.log('A3 monthly<=billed:', monthly <= billed);

const xr = await fetch(`${BASE}/api/board-report/export-excel`, { headers: auth });
const buf = new Uint8Array(await xr.arrayBuffer());
console.log('ct', xr.headers.get('content-type'));
const wb = XLSX.read(buf, { type: 'array' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const row = rows.find(x => String(x?.[0] || '').toLowerCase().includes('fees billed'));
console.log('export row', JSON.stringify(row));
const exported = Number(String(row?.[1] ?? '').replace(/[^0-9]/g, '') || 0);
console.log('B1 export matches screen:', exported === Math.round(billed), exported, billed);
