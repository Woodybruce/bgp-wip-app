// r588 journey step: THE WRITE. Victoria adds a released Bluewater unit to
// the Letting Tracker through the real dialog, then re-reads the numbers.
import { chromium } from '../node_modules/playwright/index.mjs';
import { existsSync, readFileSync } from 'fs';
const BASE = 'http://localhost:5000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('**/*', (r) => r.request().url().startsWith(BASE) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
const c0 = JSON.parse(readFileSync('/tmp/r588-token.json','utf8'));
const page = await ctx.newPage();
let bucket = [];
const NOISE = /rocketreach|ai-briefing|ai-take|brand-gaps|commentary|sharepoint\/root|microsoft\/|brand-theme|favicon|\/photo|covenant\/|os\/sites/;
page.on('response', (res) => { if (res.status() >= 400) { const u = res.url().replace(BASE,''); bucket.push(`HTTP ${res.status()} ${res.request().method()} ${u}${NOISE.test(u)?'  [noise]':''}`); } });
page.on('pageerror', (e) => bucket.push(`PAGEERROR ${String(e).slice(0,220)}`));
const flush = (l) => { const s=[...new Set(bucket)]; if (s.length) console.log(`   [${l}] ` + s.join('\n   ')); bucket=[]; };

await page.goto(BASE).catch(()=>{});
await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[c0.token,c0]);

// Baseline, straight off the endpoints the surfaces read.
const api = async (p) => { const r = await ctx.request.get(BASE+p, { headers: { Authorization: `Bearer ${c0.token}` } }); return r.ok() ? r.json() : { __status: r.status() }; };
const PROP = 'cccccccc-0000-0000-0000-000000000001';
const before = { units: (await api('/api/available-units')).length, brief: (await api(`/api/properties/${PROP}/asset-brief`)) };
console.log(`BEFORE: tracker rows=${before.units}  funnel=${JSON.stringify(before.brief.pipeline)}  vacancy=${(before.brief.performance.vacancy_rate*100).toFixed(1)}% (${before.brief.performance.occupied_units}/${before.brief.performance.total_units})`);

await page.goto(`${BASE}/available`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
const hdrBefore = await page.evaluate(() => (document.body.innerText.match(/(\d+)\s+units/)||[])[0]);
console.log(`tracker header before: ${hdrBefore}`);

await page.locator('[data-testid="button-add-unit"]').first().click();
await page.waitForTimeout(1200);
flush('dialog-open');

// Property picker
await page.locator('[data-testid="select-property"]').first().click();
await page.waitForTimeout(900);
await page.getByRole('option', { name: /Bluewater Shopping Centre/ }).first().click();
await page.waitForTimeout(1500);
flush('property-picked');

// Unit picker — read what she is offered, then take one.
const unitOpts = await (async () => {
  await page.locator('[data-testid="select-unit"], [data-testid="input-unit-name"]').first().click().catch(()=>{});
  await page.waitForTimeout(1200);
  return page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map(e => (e.textContent||'').trim()).slice(0, 12));
})();
console.log(`unit options offered (first 12): ${JSON.stringify(unitOpts)}`);
await page.screenshot({ path: 'qa/smoke-shots/r588-06-unit-picker.png' });

// Pick the first offered unit that isn't a placeholder.
const pick = unitOpts.find(o => o && !/^select|^no /i.test(o));
if (!pick) { console.log('!! no unit offered — cannot complete the write'); await browser.close(); process.exit(1); }
await page.getByRole('option', { name: pick, exact: true }).first().click().catch(async () => {
  await page.getByRole('option').first().click();
});
await page.waitForTimeout(900);
// Quoting rent so the row carries a number a landlord would ask about.
await page.locator('input[placeholder*="85,000"]').first().fill('92000').catch(()=>{});
await page.waitForTimeout(300);
await page.screenshot({ path: 'qa/smoke-shots/r588-07-filled.png' });
flush('filled');

// Save
const saveSel = ['[data-testid="button-save-unit"]','[data-testid="unified-add-save"]','button:has-text("Save")','button:has-text("Create")','button:has-text("Add unit")'];
let saved = false;
for (const s of saveSel) {
  const el = page.locator(s).last();
  if (await el.count() && await el.isVisible().catch(()=>false)) { await el.click().catch(()=>{}); saved = true; console.log(`clicked save via ${s}`); break; }
}
await page.waitForTimeout(3500);
flush('save');
await page.screenshot({ path: 'qa/smoke-shots/r588-08-after-save.png' });
const toast = await page.evaluate(() => (document.body.innerText.match(/(added|created|saved|error|failed)[^\n]{0,90}/i)||[])[0] || '');
console.log(`saved=${saved} toast="${toast}"`);

await page.waitForTimeout(1500);
const hdrAfter = await page.evaluate(() => (document.body.innerText.match(/(\d+)\s+units/)||[])[0]);
console.log(`tracker header after: ${hdrAfter}`);

const after = { units: (await api('/api/available-units')).length, brief: (await api(`/api/properties/${PROP}/asset-brief`)) };
console.log(`AFTER : tracker rows=${after.units}  funnel=${JSON.stringify(after.brief.pipeline)}  vacancy=${(after.brief.performance.vacancy_rate*100).toFixed(1)}% (${after.brief.performance.occupied_units}/${after.brief.performance.total_units})`);
console.log(`DELTA : tracker rows ${before.units} -> ${after.units}`);

// Back to the property page — does the new unit show where Victoria would look?
await page.goto(`${BASE}/properties/${PROP}`).catch(()=>{});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(3200);
const panel = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/Available Units[\s\S]{0,320}/);
  return m ? m[0].replace(/\n+/g,' | ') : '(no Available Units panel)';
});
console.log(`property page Available Units panel: ${panel}`);
flush('property-recheck');
await page.screenshot({ path: 'qa/smoke-shots/r588-09-property-after.png' });
await browser.close();
