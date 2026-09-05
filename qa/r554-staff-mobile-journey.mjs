// r554 journey: BGP staff (Victoria) on a phone at 390px.
// Task framing: "Month end, I'm on the train. Check the WIP forecast for this
// month on my phone, open the deal behind the number, check the fee agrees
// with what the WIP report says, and chase anything stale."
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';

const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 400000);
HARD.unref?.();

async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="tab"],[role="option"],a[href]')].map(e => ({ t: (e.textContent || '').trim().slice(0, 34), tid: e.getAttribute('data-testid') || '' })).filter(x => x.t || x.tid).slice(0, 45),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 1600),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3000)}`);
  return d;
}
async function step(label, fn) {
  try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0, 220)}`); await shot(`${label}-fail`).catch(() => {}); return null; }
}

try {
  // 1. cold open — where does the phone put her, and what's the bottom nav
  await go('/', 'home');
  await dump('home-shell');

  // 2. the WIP report on the phone
  await go('/deals', 'deals-wip');
  await dump('wip-report');

  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
