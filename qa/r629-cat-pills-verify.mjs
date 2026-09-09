// r629 verify · the client CRM Brand Directory pill row must sum to its own
// header count, and a self-added out-of-slice brand must be reachable.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } });
const user = await lr.json();
const page = await ctx.newPage();
await page.goto(BASE);
await page.evaluate(([t,u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
await page.goto(BASE + '/companies?tab=tenants', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const pills = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="client-brand-cat-"]')).map(b => [b.getAttribute('data-testid').replace('client-brand-cat-',''), b.textContent.trim()]));
console.log('pills:', JSON.stringify(pills));
const count = () => page.evaluate(() => { const m = document.body.innerText.match(/(\d+) brands\s*$/m); return m ? parseInt(m[1]) : null; });
const names = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="client-brand-"]')).map(e => e.querySelector('a')?.textContent?.trim()).filter(Boolean));

let all = null; let sum = 0; const seen = new Set();
for (const [key, label] of pills) {
  await page.click(`[data-testid="client-brand-cat-${key}"]`);
  await page.waitForTimeout(900);
  const c = await count(); const n = await names();
  if (key === 'all') { all = n.length; n.forEach(x => seen.add('ALL:' + x)); }
  else { sum += n.length; n.forEach(x => seen.add(x)); }
  console.log(`  ${label.padEnd(16)} count=${c} rows=${n.length} ${n.join(', ')}`);
}
console.log(`\nAll = ${all} · sum of category pills = ${sum} · ${all === sum ? 'RECONCILES' : 'MISMATCH'}`);
const unreachable = [...seen].filter(x => x.startsWith('ALL:')).map(x => x.slice(4)).filter(x => !seen.has(x));
console.log('brands reachable only under All:', JSON.stringify(unreachable));
await page.screenshot({ path: '/tmp/r629-pills-after.png' });
await browser.close();
process.exit(0);
