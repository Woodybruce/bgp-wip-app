import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2600),
      ctl: [...root.querySelectorAll('button,[role="tab"],a[href],input,textarea,select,[role="combobox"]')].map(e => ({ t:(e.textContent||'').trim().slice(0,34), tid:e.getAttribute('data-testid')||'', tag:e.tagName, ph:e.getAttribute('placeholder')||'', v:(e.value!==undefined?String(e.value):'').slice(0,26) })).filter(x=>x.t||x.tid||x.ph).slice(0,55) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 4200)}`);
  return d;
}
try {
  await go('/', 'cold');
  await go('/available', 'tracker');
  await page.waitForTimeout(2500);
  // as Victoria: I only care about the two units in negotiation
  await tap('[data-testid="stat-chip-neg"]', 'chip-negotiating');
  await page.waitForTimeout(1500);
  const filtered = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g,' ');
    return { head: t.slice(0, 500), cards: document.querySelectorAll('[data-testid^="unit-edit-"]').length, url: location.pathname + location.search };
  });
  console.log('-- FILTERED', JSON.stringify(filtered));
  // open the viewing dialog on the Bluewater MSU9 unit
  await tap('[data-testid="unit-viewing-36c81e04-6f16-4951-8ea7-cbaf16b83741"]', 'viewing-dialog');
  await page.waitForTimeout(1500);
  await dump('viewing-dialog');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
