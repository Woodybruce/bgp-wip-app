// r621: the Board Report Excel export must tell the same story as the screen.
import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'fs';
import ExcelJS from 'exceljs';

const BASE = 'http://127.0.0.1:5000';
const EXEC = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const user = await (await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' },
})).json();
const auth = { Authorization: 'Bearer ' + user.token };

const res = await ctx.request.get(`${BASE}/api/board-report/export-excel`, { headers: auth });
console.log('export status:', res.status());
const buf = await res.body();
writeFileSync('/tmp/r621/board-report.xlsx', buf);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);
const ws = wb.getWorksheet('Executive Summary');
ws.eachRow((row) => {
  const label = String(row.getCell(1).value ?? '');
  if (/fee|close|deal/i.test(label)) console.log(' ', label, '=', row.getCell(2).value);
});

// second consumer door: the /reporting page KPI
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
await page.goto(`${BASE}/reporting`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const txt = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    if (el.children.length === 0 && /Fees Billed YTD/i.test(el.textContent || '')) {
      out.push((el.parentElement?.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200));
    }
  });
  return out;
});
console.log('reporting KPI:', JSON.stringify(txt));
await page.screenshot({ path: `/tmp/r621/${process.argv[2] || 'x'}-reporting.png`, fullPage: true });
await browser.close();
