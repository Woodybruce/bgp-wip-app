import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
const UNIT = '36c81e04-6f16-4951-8ea7-cbaf16b83741';
try {
  await go('/', 'cold');
  const api = await page.evaluate(async (u) => {
    const tok = localStorage.getItem('bgp_auth_token');
    const g = async (p) => { const r = await fetch(p, { headers: { Authorization: 'Bearer ' + tok } }); return { s: r.status, j: await r.json().catch(()=>null) }; };
    const units = await g('/api/units');
    const arr = Array.isArray(units.j) ? units.j : (units.j?.units || []);
    const unit = arr.find(x => x.id === u);
    const deals = await g('/api/crm/deals');
    const d = (deals.j || []).find(x => x.id === unit?.dealId);
    return { unit: unit && { id: unit.id, name: unit.unitName || unit.name, ms: unit.marketingStatus, dealId: unit.dealId, status: unit.status }, deal: d && { id: d.id, title: d.title, status: d.status, stage: d.stage } };
  }, UNIT);
  console.log('-- API', JSON.stringify(api));
  await go('/available', 'tracker');
  await page.waitForTimeout(2500);
  const before = await page.evaluate((u) => {
    const btn = document.querySelector(`[data-testid="unit-edit-${u}"]`);
    let n = btn; for (let i=0;i<6 && n;i++) n = n.parentElement;
    return (n?.innerText||'').replace(/\s+/g,' ').slice(0,300);
  }, UNIT);
  console.log('-- CARD BEFORE', JSON.stringify(before));
  await tap(`[data-testid="unit-edit-${UNIT}"]`, 'unit-edit');
  await page.waitForTimeout(1800);
  // as Victoria: just add a note after the viewing, nothing else
  const notes = page.locator('[role="dialog"] textarea').first();
  await notes.fill('R562 — post-viewing note').catch(e=>console.log('!! notes', String(e).slice(0,140)));
  page.on('response', async r => { if (r.request().method()!=='GET' && /\/api\//.test(r.url())) console.log(`   << ${r.status()} ${r.request().method()} ${r.url().replace(BASE,'')}`); });
  await page.locator('[role="dialog"] button', { hasText: /^Save$/ }).first().click({ timeout: 8000 }).catch(e=>console.log('!! save', String(e).slice(0,140)));
  await page.waitForTimeout(3500);
  await report('after-unit-save');
  const after = await page.evaluate((u) => {
    const btn = document.querySelector(`[data-testid="unit-edit-${u}"]`);
    let n = btn; for (let i=0;i<6 && n;i++) n = n.parentElement;
    return (n?.innerText||'').replace(/\s+/g,' ').slice(0,300);
  }, UNIT);
  console.log('-- CARD AFTER', JSON.stringify(after));
  const api2 = await page.evaluate(async (u) => {
    const tok = localStorage.getItem('bgp_auth_token');
    const r = await fetch('/api/units', { headers: { Authorization: 'Bearer ' + tok } });
    const j = await r.json(); const arr = Array.isArray(j) ? j : (j?.units || []);
    const unit = arr.find(x => x.id === u);
    return unit && { ms: unit.marketingStatus, dealId: unit.dealId };
  }, UNIT);
  console.log('-- API AFTER', JSON.stringify(api2));
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
