import { go, tap, report, shot, page, browser, BASE } from './r600-client-mobile-journey.mjs';
const PID = 'cccccccc-0000-0000-0000-000000000001';
// FIX 1 — Brand Gap must now know Starbucks is in occupation here
await page.goto(BASE + '/properties/' + PID).catch(()=>{});
await page.waitForTimeout(14000);
await tap('button:text-is("Boards")', 'boards', {});
await page.waitForTimeout(5000);
const t = await page.evaluate(() => document.body.innerText || '');
const seg = (from, to) => { const i = t.indexOf(from); const j = to ? t.indexOf(to, i) : i + 400; return i < 0 ? `[${from} NOT FOUND]` : t.slice(i, j > i ? j : i + 400); };
console.log('--- other-UK-schemes bucket:\n' + seg('At other UK schemes, not here', 'In the local market'));
console.log('--- sector coverage:\n' + seg('Sector coverage', 'International watchlist'));
console.log('--- on-scheme detail:\n' + seg('On-scheme & nearby detail', 'PIPELINE'));
await shot('gap-fixed');
// FIX 2 — the BGP-team board must not carry Mark's own task
await go('/tasks', 'my-tasks-fixed', { text: true });
await browser.close();
