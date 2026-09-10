// r610 verification: the task page's overdue bucket + the diary's Busiest
// Agent tile, on the staff phone at 390px.
import { page, go, report, shot, browser, BASE } from '/home/user/bgp-wip-app/qa/r544-client-mobile-journey.mjs';
const HARD = setTimeout(() => { console.log('!! HARD TIMEOUT'); process.exit(9); }, 420000);
HARD.unref?.();
try {
  await go('/tasks', 'tasks');
  await page.waitForTimeout(11000);
  await report('tasks-settled');
  const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  console.log('\nTASKS TEXT: ' + t.slice(0, 900));

  await go('/calendar', 'diary');
  await page.waitForTimeout(11000);
  await report('diary-settled');
  const c = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const m = c.match(/BUSIEST AGENT[^A-Z]*[^]{0,80}/) || [];
  console.log('\nDIARY BUSIEST: ' + (c.split('BUSIEST AGENT')[1] || '(no tile)').slice(0, 120));
} catch (e) { console.log('!! ABORTED: ' + String(e).slice(0, 400)); }
await browser.close();
clearTimeout(HARD);
