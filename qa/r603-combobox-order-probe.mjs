// r603 probe: UX #298 — does EntityCombobox rank `Create <x> "…"` above the
// real match? Staff desktop, the new-deal dialog's Tenant picker on /deals.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';

const BASE = process.env.QA_BASE || 'http://localhost:5000';
const USER = 'victoria@brucegillinghampollard.com';
const TAG = process.env.QA_TAG || 'r603';
const CH = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(CH ? { executablePath: CH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: 'B@nd0077!' } });
const user = await r.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0, 300)); process.exit(2); }
const page = await ctx.newPage();
await page.goto(BASE).catch(e => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([t, u]) => {
  localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t);
  localStorage.setItem('user', JSON.stringify(u));
}, [user.token, user]);

let n = 0;
const shot = async (l) => { n++; const p = `qa/smoke-shots/${TAG}-${String(n).padStart(2,'0')}-${l}.png`; await page.screenshot({ path: p }); return p; };

// ?new=1 opens the create dialog straight away (the WIP report's own deep link).
await page.goto(`${BASE}/deals?new=1`).catch(() => {});
await page.waitForTimeout(4500);
console.log('dialog open:', await page.locator('[role="dialog"]').count());
console.log('PAGE', JSON.stringify(await page.evaluate(() => ({
  url: location.href.slice(-40),
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
  tids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 25),
}))));
console.log('shot', await shot('deals-new'));
// The create dialog lives on the deals LIST view, not the WIP report the page
// opens on. Flip the toggle, then use the page's own New Deal button.
await page.click('[data-testid="toggle-deals-tabs"]').catch(() => {});
await page.waitForTimeout(2500);
await page.click('[data-testid="button-create-deal"]').catch(() => {});
await page.waitForTimeout(2000);
console.log('dialog open (after toggle):', await page.locator('[role="dialog"]').count());

// The tenant picker only renders for a leasing counterparty kind — dump what we have.
const tids = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')]
  .map(e => e.getAttribute('data-testid')).filter(t => /deal-(tenant|landlord)|select-deal/.test(t)));
console.log('pickers:', JSON.stringify(tids));

const term = process.env.QA_TERM || 'Honi';
for (const tid of ['select-deal-tenant', 'select-deal-landlord']) {
  if (!tids.includes(tid)) { console.log(`SKIP ${tid} — not rendered`); continue; }
  await page.click(`[data-testid="${tid}"]`);
  await page.waitForTimeout(600);
  await page.locator('[role="dialog"] input[placeholder*="Search"], input[cmdk-input]').last().fill(term);
  await page.waitForTimeout(900);
  const order = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
    .map(e => ({ text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), selected: e.getAttribute('data-selected') === 'true' })));
  console.log(`ORDER ${tid} "${term}":`, JSON.stringify(order, null, 0));
  const first = order[0];
  console.log(`VERDICT ${tid}: first row ${/^Create /.test(first?.text || '') ? 'IS THE CREATE ROW' : 'is a real match'}; aria-selected default = ${JSON.stringify(order.find(o => o.selected)?.text || null)}`);
  console.log('shot', await shot(`combobox-${tid}-${term}`));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
await browser.close();
