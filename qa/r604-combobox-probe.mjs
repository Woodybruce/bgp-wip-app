// r604: finish r603's UX #298 hand-off — prove the ranking in the BROWSER on
// every EntityCombobox door in the new-deal dialog.
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await r.json(); if (!user.token) process.exit(2);
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token',t); localStorage.setItem('authToken',t); localStorage.setItem('user',JSON.stringify(u)); }, [user.token,user]);
await page.goto(`${BASE}/deals/list?new=1`).catch(()=>{});
await page.waitForTimeout(7000);
await page.click('[data-testid="select-deal-type"]'); await page.waitForTimeout(400);
await page.click('[role="option"]:has-text("Lease Acquisition")'); await page.waitForTimeout(1200);

let n = 0;
const probe = async (tid, term) => {
  const trig = page.locator(`[data-testid="${tid}"]`);
  await trig.click(); await page.waitForTimeout(600);
  // type into the input that is a SIBLING of this trigger (each combobox
  // renders its own inline dropdown next to its own button)
  const input = trig.locator('xpath=../..').locator('input[cmdk-input]').first();
  const cnt = await input.count();
  await input.click();
  await page.keyboard.type(term, { delay: 40 });
  await page.waitForTimeout(1000);
  const val = await input.inputValue().catch(()=>'?');
  const order = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map(e => ({ t:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,55), sel: e.getAttribute('data-selected')==='true' })));
  n++;
  await page.screenshot({ path: `qa/smoke-shots/r604c-${String(n).padStart(2,'0')}-${tid}.png` });
  const first = order[0]?.t || '';
  console.log(`${tid} typed=${JSON.stringify(val)} (inputs found ${cnt})`);
  console.log(`  rows: ${JSON.stringify(order)}`);
  console.log(`  VERDICT: first row ${/^Create /.test(first) ? '*** IS THE CREATE ROW ***' : 'is a real match'}; default-selected = ${JSON.stringify(order.find(o=>o.sel)?.t || null)}`);
  // ESC to dismiss just the dropdown — does the whole dialog go with it?
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  console.log(`  after ESC: dropdown rows=${await page.locator('[role="option"]').count()} DIALOGS=${await page.locator('[role="dialog"]').count()}`);
  if (await page.locator('[role="dialog"]').count() === 0) {
    console.log('  !! REGRESSION: ESC on the combobox closed the WHOLE New Deal dialog — form lost');
    await page.screenshot({ path: `qa/smoke-shots/r604c-${String(n).padStart(2,'0')}-esc-killed-dialog.png` });
    await page.goto(`${BASE}/deals/list?new=1`).catch(()=>{});
    await page.waitForTimeout(6000);
    await page.click('[data-testid="select-deal-type"]'); await page.waitForTimeout(400);
    await page.click('[role="option"]:has-text("Lease Acquisition")'); await page.waitForTimeout(1200);
  }
};
await probe('select-deal-tenant', 'Honi');
await probe('select-deal-landlord', 'Landsec');
await probe('select-deal-property-top', 'Bluewater');

// Regression guard: with NO dropdown open, Escape must still close the dialog.
console.log('dialogs before bare ESC:', await page.locator('[role="dialog"]').count());
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
console.log('dialogs after bare ESC:', await page.locator('[role="dialog"]').count(), '(expect 0)');
await browser.close();
