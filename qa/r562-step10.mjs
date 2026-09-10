import { page, go, tap, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
const UNIT = '36c81e04-6f16-4951-8ea7-cbaf16b83741';
async function dump(label) {
  const d = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]') || document.body;
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2400) };
  });
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 2800)}`);
}
try {
  await go('/', 'cold');
  await go('/available', 'tracker');
  await page.waitForTimeout(2500);
  // What does the unit row itself say, and does its title go anywhere?
  const row = await page.evaluate((u) => {
    const btn = document.querySelector(`[data-testid="unit-edit-${u}"]`);
    const card = btn?.closest('[class*="rounded"]') || btn?.parentElement?.parentElement;
    return { card: (card?.innerText||'').replace(/\s+/g,' ').slice(0,600),
      links: [...(card?.querySelectorAll('a[href]')||[])].map(a=>({t:(a.textContent||'').trim().slice(0,30),h:a.getAttribute('href')})) };
  }, UNIT);
  console.log('-- UNIT CARD', JSON.stringify(row));
  await tap(`[data-testid="unit-offer-${UNIT}"]`, 'offer-dialog');
  await page.waitForTimeout(1500);
  await dump('offer-dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  await tap(`[data-testid="unit-edit-${UNIT}"]`, 'unit-edit');
  await page.waitForTimeout(1500);
  await dump('unit-edit');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
