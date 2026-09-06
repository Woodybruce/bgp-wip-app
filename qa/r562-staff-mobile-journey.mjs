// r562 journey: BGP staff (Victoria) on a phone at 390px, iPhone UA + touch.
// Task framing: "Just out of a viewing at Bluewater. On my phone: find the
// unit on the letting tracker, record what happened, then open the deal
// behind it and check the tracker and the deal agree."
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';

const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();

async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return {
      btns: [...root.querySelectorAll('button,[role="tab"],[role="option"],a[href]')].map(e => ({ t: (e.textContent || '').trim().slice(0, 34), tid: e.getAttribute('data-testid') || '' })).filter(x => x.t || x.tid).slice(0, 50),
      text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2200),
    };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3600)}`);
  return d;
}

try {
  await go('/', 'home');
  await dump('home-shell');

  await go('/available', 'tracker');
  await page.waitForTimeout(3000);
  await dump('tracker');

  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
