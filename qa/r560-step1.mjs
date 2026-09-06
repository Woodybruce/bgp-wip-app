import { go, tap, page, browser } from './r560-client-mobile-journey.mjs';
await go('/', 'phone-home', { text: true, full: true });
await go('/tasks', 'tasks', { text: true, full: true, ids: true });
await browser.close();
