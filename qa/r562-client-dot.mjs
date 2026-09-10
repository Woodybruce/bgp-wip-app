import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const DEAL = '11110000-0000-0000-0000-000000000301';
const TAG = process.env.QA_TAG || 'r562dot';
const target = process.env.QA_DEAL_STATUS || 'SOL';

const login = async (u) => {
  const r = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username:u, password:'B@nd0077!' }) });
  return r.json();
};
const vic = await login('victoria@brucegillinghampollard.com');
const VH = { Authorization: 'Bearer ' + vic.token, 'content-type':'application/json' };
const put = await fetch(`${BASE}/api/crm/deals/${DEAL}`, { method:'PUT', headers:VH, body: JSON.stringify({ status: target, feeAgreement: 'NO', amlCheckCompleted: 'YES' }) });
console.log('-- SET DEAL', target, put.status);

const mark = await login('mark.warne@landsec.com');
if (!mark.token) { console.log('mark login failed'); process.exit(2); }
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [mark.token, mark]);
await page.goto(BASE + '/available').catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(4000);
const res = await page.evaluate(() => {
  const dots = [...document.querySelectorAll('[data-testid^="compliance-flag-"]')].map(e => ({ tid: e.getAttribute('data-testid'), title: e.getAttribute('title') }));
  return { dots, body: document.body.innerText.replace(/\s+/g,' ').slice(0, 300) };
});
console.log('-- CLIENT DOTS', JSON.stringify(res));
await page.screenshot({ path: `qa/smoke-shots/${TAG}-client-tracker.png` });

// and as Victoria, for contrast
const p2 = await ctx.newPage();
await p2.goto(BASE).catch(()=>{});
await p2.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(u)); }, [vic.token, vic]);
await p2.goto(BASE + '/available').catch(()=>{});
await p2.waitForLoadState('networkidle').catch(()=>{});
await p2.waitForTimeout(4000);
const res2 = await p2.evaluate(() => [...document.querySelectorAll('[data-testid^="compliance-flag-"]')].map(e => ({ tid: e.getAttribute('data-testid'), title: e.getAttribute('title') })));
console.log('-- STAFF DOTS', JSON.stringify(res2));
await p2.screenshot({ path: `qa/smoke-shots/${TAG}-staff-tracker.png` });
await browser.close();
