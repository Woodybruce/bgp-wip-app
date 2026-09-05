import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 380000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return { btns: [...root.querySelectorAll('button,[role="tab"],a[href]')].map(e => ({ t: (e.textContent||'').trim().slice(0,34), tid: e.getAttribute('data-testid')||'' })).filter(x=>x.t||x.tid).slice(0,45),
      text: (root.innerText||'').replace(/\s+/g,' ').slice(0,2600) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0,4000)}`);
  return d;
}
try {
  await go('/', 'home2');
  await tap('[data-testid="mobile-home-total-billing"]', 'tapped-total-billing');
  await dump('wip-report-phone');
  // raw API for comparison
  const api = await page.evaluate(async () => {
    const t = localStorage.getItem('bgp_auth_token');
    const r = await fetch('/api/wip', { headers: { Authorization: 'Bearer ' + t } });
    const j = await r.json();
    const entries = Array.isArray(j) ? j : (j.entries || []);
    return { status: r.status, n: entries.length,
      sum: entries.reduce((s,e)=>s+(e.amtWip||0)+(e.amtInvoice||0),0),
      sample: entries.slice(0,6).map(e=>({ deal:(e.dealName||e.name||'').slice(0,30), wip:e.amtWip, inv:e.amtInvoice, fee:e.fee, month:e.targetMonth||e.month, owner:e.owner||e.agent })) };
  });
  console.log('-- API /api/wip', JSON.stringify(api).slice(0,2000));
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
