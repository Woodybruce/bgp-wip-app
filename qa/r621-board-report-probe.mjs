// r621 probe: does the Board Report's "Fees Billed YTD" / billed-by-month
// series attribute a dateless invoiced deal to the month it was last SAVED?
import { chromium } from 'playwright';
import { existsSync } from 'fs';

const BASE = 'http://127.0.0.1:5000';
const PASSWORD = 'B@nd0077!';
const EXEC = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const TAG = process.argv[2] || 'run';

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());

const r = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { username: 'victoria@brucegillinghampollard.com', password: PASSWORD },
});
const user = await r.json();
if (!user.token) throw new Error('login failed: ' + JSON.stringify(user).slice(0, 200));
const auth = { Authorization: 'Bearer ' + user.token };

const br = await (await ctx.request.get(`${BASE}/api/board-report`, { headers: auth })).json();
console.log('--- /api/board-report performance ---');
console.log('totalFeesYTD      :', br.performance?.totalFeesYTD);
console.log('monthlyFees       :', JSON.stringify(br.performance?.monthlyFees));
console.log('avgTimeToClose    :', br.performance?.avgTimeToClose);
console.log('timeToCloseBuckets:', JSON.stringify(br.performance?.timeToCloseBuckets));

// Sibling doors asked the same question
const health = await (await ctx.request.get(`${BASE}/api/wip/health`, { headers: auth })).json();
const noDate = health?.buckets?.noDate ?? health?.noDate;
console.log('--- sibling: /api/wip/health noDate ---');
console.log(JSON.stringify(noDate)?.slice(0, 400));

const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([tok, u]) => {
  localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);
await page.goto(`${BASE}/board-report`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const kpi = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    if (el.children.length === 0 && /Fees Billed YTD/i.test(el.textContent || '')) {
      out.push((el.parentElement?.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160));
    }
  });
  return out;
});
console.log('--- board-report KPI card text ---');
console.log(JSON.stringify(kpi));
await page.screenshot({ path: `/tmp/r621/${TAG}-board-report.png`, fullPage: true });
await browser.close();
