import { page, go, browser } from '/home/user/bgp-wip-app/qa/r555-desk.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 300000);
HARD.unref?.();
async function dump(label) {
  const d = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 2200));
  console.log(`-- DUMP ${label} ${d}`);
}
try {
  await go('/board-report', 'board-report-fixed');
  await dump('board');
  await go('/reporting', 'reporting-fixed');
  await dump('reporting');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
