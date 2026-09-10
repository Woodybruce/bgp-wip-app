import { page, go, shot, browser } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 300000);
HARD.unref?.();
const TAG = process.env.QA_LABEL || 'x';
try {
  await go('/', 'home-' + TAG);
  await page.waitForTimeout(1500);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="mobile-home-total-billing"]')))) await go('/', 'home2-' + TAG);
  const card = await page.evaluate(() => {
    const t = (s) => { const e = document.querySelector(s); return e ? (e.innerText||'').replace(/\s+/g,' ').trim() : null; };
    const fin = [...document.querySelectorAll('div')].find(d => /MY BILLING/i.test(d.innerText||'') && (d.innerText||'').length < 400);
    return { finTile: fin ? fin.innerText.replace(/\s+/g,' ').trim().slice(0,220) : null, totalBilling: t('[data-testid="mobile-home-total-billing"]') };
  });
  console.log(`-- PHONE HOME [${TAG}] ` + JSON.stringify(card));
  await go('/hr', 'hr-' + TAG);
  const hr = await page.evaluate(() => {
    const t = (s) => { const e = document.querySelector(s); return e ? (e.innerText||'').replace(/\s+/g,' ').trim() : null; };
    const body = (document.body.innerText||'').replace(/\s+/g,' ');
    return {
      youCommission: t('[data-testid="you-commission"]'),
      hero: (body.match(/Ski target[^]{0,140}/)||[''])[0],
      tiles: [...document.querySelectorAll('[data-testid="you-commission"] ~ * , .grid')].length,
      pipelineChip: (body.match(/£[\d.,kmKM]+\s*PIPELINE/)||[''])[0],
    };
  });
  console.log(`-- HR [${TAG}] ` + JSON.stringify(hr));
  const api = await page.evaluate(async () => {
    const tk = localStorage.getItem('bgp_auth_token');
    const r = await fetch('/api/hr/my-commission', { headers: { Authorization: 'Bearer ' + tk } });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return { wipByStage: j.wipByStage, wipTotal: j.wipTotal, forecastPence: j.forecastPence, commissionForecast: j.commissionForecast, billedPence: j.billedPence, topDeals: (j.topDeals||[]).map(d=>({n:d.name,s:d.status,f:d.fee})) };
  });
  console.log(`-- API my-commission [${TAG}] ` + JSON.stringify(api));
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
