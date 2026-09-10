import { go, tap, report, shot, page, browser } from './r600-client-mobile-journey.mjs';

// The task card on the dashboard names Bluewater — tap it (the natural route
// into "the property I have a call about").
await go('/', 'dash', {});
const taskTap = await tap('text=Review Bluewater Q3 leasing plan', 'task-tap', { text: true });

// The phone header search — the documented way to a property on a phone.
await go('/', 'dash2', {});
console.log('HEADER BTNS:', await page.evaluate(() => [...document.querySelectorAll('header button, [data-testid*="search"]')].map(b => (b.getAttribute('data-testid')||'') + ':' + (b.textContent||'').trim().slice(0,20)).join(' | ')));
await tap('[data-testid="mobile-search-button"], header button:has(svg.lucide-search), [data-testid*="search"]', 'search-open', { text: true });
await browser.close();
