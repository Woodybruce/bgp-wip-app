// r610 journey part 3: THE WRITE — add Gail's Bakery's requirement from the
// phone, then tick Woody's task off the home screen.
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 480000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="option"]')].map(e => ({ t: (e.textContent || '').trim().slice(0, 30), tid: e.getAttribute('data-testid') || '' })).filter(x => x.t || x.tid).slice(0, 55),
      inputs: [...root.querySelectorAll('input,textarea,select')].map(e => ({ tid: e.getAttribute('data-testid') || '', ph: e.getAttribute('placeholder') || '', type: e.getAttribute('type') || '' })).slice(0, 30),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3600)}`);
  return d;
}
async function step(label, fn) {
  try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0, 220)}`); await shot(`${label}-fail`).catch(() => {}); return null; }
}
try {
  await go('/requirements', 'reqs');
  await page.waitForTimeout(11000);
  await tap('[data-testid="button-create-leasing"]', 'req-dialog');
  await dump('req-dialog');
} catch (e) { console.log('!! ABORTED: ' + String(e).slice(0, 400)); }
await browser.close();
clearTimeout(HARD);
