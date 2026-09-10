// r579: does the staff review's "Sync from WIP" keep an agent's fee when the
// deal steps FORWARD out of Negotiating into HOTs? Drives the real UI.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const VICTORIA = '72715f6f-905d-40f4-bded-5275175f3e2b';
const tag = process.argv[2] || 'x';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 160)));

const r = await ctx.request.post('http://localhost:5000/api/auth/login', { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json();
if (!user.token) throw new Error('login failed: ' + JSON.stringify(user).slice(0, 200));
await p.goto('http://localhost:5000');
await p.evaluate(([tok, u]) => { localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u)); }, [user.token, user]);
console.log('logged in as', user.name);

await p.goto(`http://localhost:5000/hr?person=${VICTORIA}&tab=reviews`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

// Open an existing review, or start an annual one.
let row = p.locator('button:has-text("review ·")').first();
if (!(await row.count())) {
  await p.click('button:has-text("+ Annual")');
  await p.waitForTimeout(2500);
  row = p.locator('button:has-text("review ·")').first();
}
console.log('rows:', await p.locator('button:has-text("review ·")').count(), JSON.stringify((await p.locator('button:has-text("review ·")').allTextContents()).slice(0,3)));
await row.click();
await p.waitForTimeout(2000);
console.log('editor present:', await p.locator('[data-testid="button-sync-from-wip"]').count(), '| page text sample:', (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 400));

await p.click('[data-testid="button-sync-from-wip"]');
await p.waitForTimeout(3000);

const toast = (await p.locator('[data-testid="toast-description"], li[role="status"], .toast, [role="status"]').allTextContents()).join(' | ');
const fields = {};
for (const label of ['Target (£)', 'Achieved (£)', 'Pipeline — HOTs / under offer (£)', 'Pipeline — negotiating (£)']) {
  const inp = p.locator(`div:has(> label:text-is("${label}")) input`).first();
  fields[label] = (await inp.count()) ? await inp.inputValue() : '(not found)';
}
console.log('TOAST:', toast.replace(/\s+/g, ' ').slice(0, 300));
console.log('FIELDS:', JSON.stringify(fields, null, 1));
await p.screenshot({ path: `qa/smoke-shots/r579-review-${tag}.png`, fullPage: false });
await b.close();
