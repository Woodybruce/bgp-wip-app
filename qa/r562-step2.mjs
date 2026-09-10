import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="tab"],[role="option"],a[href],input,select')].map(e => ({ t: (e.textContent || '').trim().slice(0, 40), tid: e.getAttribute('data-testid') || '', tag: e.tagName, v: e.value !== undefined ? String(e.value).slice(0,30) : '' })).filter(x => x.t || x.tid).slice(0, 60),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2500),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 4200)}`);
  return d;
}
try {
  // The billing tile on the phone home: five stages all £0 but TOTAL £250,000.
  await go('/', 'home');
  const raw = await page.evaluate(async () => {
    const tok = localStorage.getItem('bgp_auth_token');
    const out = {};
    for (const u of ['/api/wip/my-summary','/api/wip/summary','/api/wip/deals','/api/dashboard/stats']) {
      try { const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } }); out[u] = { s: r.status, b: (await r.text()).slice(0, 900) }; } catch (e) { out[u] = String(e); }
    }
    return out;
  });
  console.log('-- API', JSON.stringify(raw).slice(0, 3000));
  await tap('[data-testid="fin-tile-open"]', 'fin-tile');
  await dump('fin-tile');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
