// r545 — KYC upload portal end-to-end, the surface no round has exercised:
// staff issues a tokenised link on a deal, the CUSTOMER (no BGP login) opens
// it and drops a document. Judged as the two users, not as an API.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, writeFileSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const PASSWORD = 'B@nd0077!';
const STAFF = 'victoria@brucegillinghampollard.com';
const SHOTS = new URL('./smoke-shots/', import.meta.url).pathname;

const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: STAFF, password: PASSWORD } });
const user = await lr.json();
if (!user.token) { console.error('login failed'); process.exit(2); }

const page = await ctx.newPage();
const bucket = [];
page.on('response', (r) => { if (r.status() >= 400) bucket.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0, 200)}`));

await page.goto(BASE).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([t, u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);

// 1. Pick a real deal the way an MLRO would — off the deals board.
const deals = await (await ctx.request.get(`${BASE}/api/crm/deals`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
const deal = (Array.isArray(deals) ? deals : deals.deals || []).find(d => !/QA-R|PROBE/.test(d.name || '')) || deals[0];
console.log('DEAL', deal?.id, deal?.name);

// 2. Issue an upload link through the API the AML panel calls.
const issue = await ctx.request.post(`${BASE}/api/aml/deal/${deal.id}/upload-link`, {
  headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
  data: { contactEmail: 'qa-r545@example.com', contactName: 'QA R545 Contact', sendEmail: false },
});
const issued = await issue.json().catch(() => ({}));
console.log('ISSUE', issue.status(), JSON.stringify(issued).slice(0, 400));
const token = issued.token || (issued.url || '').split('/').pop();
if (!token) { console.error('no token issued — stopping'); await browser.close(); process.exit(3); }

// 3. The customer: a clean context, no login, opens the emailed link.
const cust = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await cust.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.abort();
});
const cp = await cust.newPage();
const cbucket = [];
cp.on('response', (r) => { if (r.status() >= 400) cbucket.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
cp.on('pageerror', (e) => cbucket.push(`PAGEERROR ${String(e).slice(0, 200)}`));
await cp.goto(`${BASE}/kyc-upload/${token}`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await cp.waitForLoadState('networkidle').catch(() => {});
await cp.waitForTimeout(2500);
console.log('PORTAL', JSON.stringify(await cp.evaluate(() => ({
  path: location.pathname.slice(0, 30),
  head: (document.querySelector('h1')?.textContent || '').trim(),
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})), null, 1));
await cp.screenshot({ path: `${SHOTS}r545-kyc-portal-open.png` });

// 4. Drop a document, the way the contact would.
const fp = '/tmp/qa-r545-proof-of-address.txt';
writeFileSync(fp, 'QA R545 — proof of address\nAcme Utilities Ltd\nBill date 01/08/2026\n');
await cp.setInputFiles('#kyc-file-input', fp);
await cp.waitForTimeout(9000);
console.log('AFTER-UPLOAD', JSON.stringify(await cp.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
})), null, 1));
await cp.screenshot({ path: `${SHOTS}r545-kyc-portal-uploaded.png` });
console.log('CUSTOMER 4xx/5xx:', cbucket.length ? cbucket.join(' | ') : 'none');

// 5. Back on the staff side: does the upload show against the deal?
const links = await (await ctx.request.get(`${BASE}/api/aml/deal/${deal.id}/upload-links`, { headers: { Authorization: `Bearer ${user.token}` } })).json();
console.log('LINKS', JSON.stringify(links).slice(0, 500));

console.log('STAFF 4xx/5xx:', bucket.length ? bucket.join(' | ') : 'none');
console.log('TOKEN', token);
await browser.close();
