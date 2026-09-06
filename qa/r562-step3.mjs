import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 3000),
      btns: [...root.querySelectorAll('button,[role="tab"],a[href]')].map(e => ({ t: (e.textContent||'').trim().slice(0,32), tid: e.getAttribute('data-testid')||'' })).filter(x=>x.t||x.tid).slice(0,40) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3600)}`);
  return d;
}
try {
  await go('/', 'cold');
  await go('/', 'home');
  await tap('[data-testid="mobile-home-total-billing"]', 'tap-total-billing');
  await page.waitForTimeout(6000);
  await report('wip-report-landing');
  await dump('wip-report');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
