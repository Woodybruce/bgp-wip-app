import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const login = async (u) => (await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username:u, password:'B@nd0077!' }) })).json();
const vic = await login('victoria@brucegillinghampollard.com');
const H = { Authorization: 'Bearer ' + vic.token };
const deals = await (await fetch(`${BASE}/api/crm/deals`, { headers:H })).json();
const d = deals.find(x => x.id === '11110000-0000-0000-0000-000000000301');
console.log('DEAL301', JSON.stringify({ status: d.status, fee: d.feeAgreement, aml: d.amlCheckCompleted, ref: d.dealRef }));
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); localStorage.removeItem('bgp_letting_hidden_cols'); }, [vic.token, vic]);
await page.goto(BASE + '/available').catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(4500);
const r = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr')].filter(tr => /MSU9 letting/.test(tr.innerText||''));
  return { chips: document.body.innerText.replace(/\s+/g,' ').slice(0,300),
    rows: rows.map(tr => (tr.innerText||'').replace(/\s+/g,' ').slice(0,200)),
    dots: [...document.querySelectorAll('[data-testid^="compliance-flag-"]')].map(e=>e.getAttribute('title')),
    refs: [...document.querySelectorAll('[data-testid^="link-deal-ref-"]')].map(e=>e.textContent) };
});
console.log('STAFF', JSON.stringify(r).slice(0, 1600));
await page.screenshot({ path: 'qa/smoke-shots/r562dot2-staff.png', fullPage: false });
await browser.close();
