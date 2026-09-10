// r623 step 1 — Mark Warne on his phone: the five client tabs.
import { go, tap, warm, browser, assertPhoneShell } from './r623-mark-phone-journey.mjs';
await assertPhoneShell();
await go('/', 'portfolio-home', { text: true, ids: true });
await warm('/deals', 11000);
await go('/deals', 'deals', { text: true, ids: true });
await warm('/tasks', 11000);
await go('/tasks', 'tasks', { text: true, ids: true });
await browser.close();
