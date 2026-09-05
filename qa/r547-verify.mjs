// r547 verification: the WIP Target Month clears as well as sets.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync } from 'fs';
const BASE = 'http://localhost:5000';
const QA_CHROMIUM = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
  const user = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } })).json();
  const page = await ctx.newPage();
  let writes = [], errs = [];
  page.on('response', (res) => { const m = res.request().method(); if (m !== 'GET' && !/heartbeat/.test(res.url())) writes.push(`${m} ${res.url().replace(BASE,'')} -> ${res.status()}`); if (res.status() >= 400) errs.push(`${res.status()} ${m} ${res.url().replace(BASE,'')}`); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0,200)));
  await page.goto(BASE).catch(() => {});
  await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token',t); localStorage.setItem('authToken',t); localStorage.setItem('user',JSON.stringify(u)); }, [user.token, user]);
  const load = async () => { await page.goto(`${BASE}/wip-report`, { waitUntil: 'domcontentloaded' }).catch(()=>{}); await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(3200); };
  const cells = async () => page.evaluate(() => [...document.querySelectorAll('tbody tr')].map(tr => { const i = tr.querySelector('input[type="month"]'); return { deal: (tr.querySelector('td:nth-child(3)')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,40), month: i ? i.value : null }; }));

  await load();
  console.log('before:', JSON.stringify(await cells()));
  // make sure the first row has a value to clear
  let inp = page.locator('tbody tr input[type="month"]').first();
  if (!(await inp.inputValue())) { await inp.fill('2027-03'); await page.locator('h1').first().click({force:true}); await page.waitForTimeout(2800); await load(); console.log('seeded:', JSON.stringify(await cells())); }
  writes = [];
  inp = page.locator('tbody tr input[type="month"]').first();
  await inp.scrollIntoViewIfNeeded();
  await inp.fill('');
  await page.waitForTimeout(400);
  await page.locator('h1').first().click({ force: true });
  await page.waitForTimeout(3000);
  console.log('clear writes:', JSON.stringify([...new Set(writes)]));
  console.log('toast:', await page.evaluate(() => (document.body.innerText.match(/Target month (cleared|updated)[^\n]*|Couldn't save target month[^\n]*/)||[''])[0]));
  await page.screenshot({ path: 'qa/smoke-shots/r547v-01-cleared-toast.png' });
  await load();
  const after = await cells();
  console.log('after reload:', JSON.stringify(after));
  console.log('CLEAR PERSISTED:', after[0].month === '');
  await page.screenshot({ path: 'qa/smoke-shots/r547v-02-cleared-reload.png' });

  // and setting still works
  writes = [];
  inp = page.locator('tbody tr input[type="month"]').first();
  await inp.fill('2027-05');
  await page.locator('h1').first().click({ force: true });
  await page.waitForTimeout(3000);
  console.log('set writes:', JSON.stringify([...new Set(writes)]));
  await load();
  const after2 = await cells();
  console.log('set persisted 2027-05:', after2[0].month === '2027-05');
  await page.screenshot({ path: 'qa/smoke-shots/r547v-03-set-again.png' });
  // leave it clean
  inp = page.locator('tbody tr input[type="month"]').first();
  await inp.fill('');
  await page.locator('h1').first().click({ force: true });
  await page.waitForTimeout(2800);
  await load();
  console.log('final:', JSON.stringify(await cells()));
  console.log('errors:', JSON.stringify([...new Set(errs)].filter(e => !/microsoft|ai-briefing|favicon/.test(e))));
} finally { await browser.close(); }
