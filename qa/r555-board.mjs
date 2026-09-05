import { page, go, browser } from '/home/user/bgp-wip-app/qa/r555-desk.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 300000);
HARD.unref?.();
async function dump(label, sel) {
  const d = await page.evaluate((s) => {
    const root = s ? document.querySelector(s) : document.body;
    if (!root) return { missing: true };
    return { text: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 3000) };
  }, sel || null);
  console.log(`-- DUMP ${label} ${JSON.stringify(d).slice(0, 3500)}`);
  return d;
}
try {
  await go('/board-report', 'board-report');
  await dump('board');
  await browser.close();
} catch (e) { console.log('FATAL', e); await browser.close(); process.exit(1); }
