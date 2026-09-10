// r600 step 8: verify the Unread chip now surfaces the unseen AI thread the
// nav badge is counting (2 unseen memberships seeded/left by the round).
import { go, tap, page, browser } from './r600-client-mobile-journey.mjs';

await go('/messages', 'messages-all', { text: true });
await tap('[data-testid="chip-mobile-threads-unread"]', 'messages-unread', { text: true });
await browser.close();
