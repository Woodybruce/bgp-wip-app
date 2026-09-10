// r610 journey part 4: the WRITE — add the bakery requirement from the
// phone, confirm it lands on the board, then tick Woody's task off home.
import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 480000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : (document.querySelector('[role="dialog"]') || document.body);
    if (!root) return { missing: true };
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 1200) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 2000)}`);
  return d;
}
async function step(label, fn) {
  try { return await fn(); } catch (e) { console.log(`!! STEP ${label} FAILED: ${String(e).slice(0, 220)}`); await shot(`${label}-fail`).catch(() => {}); return null; }
}
try {
  await go('/requirements', 'reqs');
  await page.waitForTimeout(11000);
  await tap('[data-testid="button-create-leasing"]', 'req-dialog');

  await step('fill', async () => {
    await page.click('[data-testid="option-company-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001"]');
    await page.waitForTimeout(600);
    await page.click('[data-testid="toggle-use-A1 Food"]');
    await page.click('[data-testid="toggle-type-Shopping Centre"]');
    await page.click('[data-testid="toggle-size-2,000 - 3,500 sq ft"]');
    await page.click('[data-testid="toggle-location-South East"]');
    await page.waitForTimeout(400);
    await shot('req-filled');
    await dump('req-filled');
  });
  await step('save', () => tap('[data-testid="button-submit-leasing"]', 'req-saved'));
  await page.waitForTimeout(2500);
  await report('reqs-after-save');
  await dump('reqs-after-save', 'body');

  // Now tick Woody's task off from the phone home.
  await go('/', 'home-before-tick');
  await page.waitForTimeout(11000);
  await step('tick', async () => {
    await page.click('[data-testid="mobile-home-task-r610-task-1"] button[aria-label="Complete task"]');
    await page.waitForTimeout(2500);
    await report('home-after-tick');
    await dump('home-after-tick', 'body');
  });
} catch (e) { console.log('!! ABORTED: ' + String(e).slice(0, 400)); }
await browser.close();
clearTimeout(HARD);
