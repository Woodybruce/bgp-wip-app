import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r562dot3';
const login = async (u) => (await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username:u, password:'B@nd0077!' }) })).json();
const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined, args: ['--no-sandbox'] });
for (const [who, email] of [['staff','victoria@brucegillinghampollard.com'], ['client','mark.warne@landsec.com']]) {
  const u = await login(email);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,uu]) => { localStorage.setItem('bgp_auth_token', t); localStorage.setItem('authToken', t); localStorage.setItem('user', JSON.stringify(uu)); localStorage.removeItem('bgp_letting_hidden_cols'); }, [u.token, u]);
  await page.goto(BASE + '/available').catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(3500);
  await page.locator('[data-testid="stat-chip-sol"]').first().click({ timeout: 8000 }).catch(e => console.log(`!! ${who} chip`, String(e).slice(0,100)));
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    head: document.body.innerText.replace(/\s+/g,' ').match(/\d+ of \d+ units|\d+ units/)?.[0] || '',
    rows: [...document.querySelectorAll('tr')].filter(tr => /MSU9 letting/.test(tr.innerText||'')).map(tr => (tr.innerText||'').replace(/\s+/g,' ').slice(0,160)),
    dots: [...document.querySelectorAll('[data-testid^="compliance-flag-"]')].map(e=>e.getAttribute('title')),
  }));
  console.log(`-- ${who.toUpperCase()}`, JSON.stringify(r));
  await page.screenshot({ path: `qa/smoke-shots/${TAG}-${who}.png` });
  await ctx.close();
}
await browser.close();
