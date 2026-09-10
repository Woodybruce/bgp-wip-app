// r608 · part 2 — the pages that were still skeletons after 1.6s, the unread
// badge behind the Messages tab, and the write (self-add a brand to the
// client's own Brand CRM from the phone).
import { go, tap, report, shot, page, browser, BASE, user } from './r600-client-mobile-journey.mjs';

async function settle(route, label, ms) {
  await page.goto(BASE + route).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.waitForTimeout(ms);
  return report(label, { text: true });
}

// 1 — /deals with a long settle: skeleton or content?
await settle('/deals', 'phone-deals-settled', 12000);
// 2 — /news with a long settle
await settle('/news', 'phone-news-settled', 12000);
// 3 — the Messages badge: what is behind UNREAD?
await go('/messages', 'phone-messages', {});
await tap('button:has-text("UNREAD"), [role="tab"]:has-text("UNREAD")', 'phone-messages-unread', { text: true });
const threads = await page.evaluate(async (tok) => {
  const r = await fetch('/api/chat/threads', { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  return { status: r.status, n: Array.isArray(j) ? j.length : null,
    rows: (Array.isArray(j) ? j : []).map(t => ({ id: t.id, name: t.name, ai: t.isAiChat, seen: t.seen })) };
}, user.token);
console.log('THREADS:', JSON.stringify(threads).slice(0, 900));
const notif = await page.evaluate(async (tok) => (await (await fetch('/api/chat/notifications', { headers: { Authorization: 'Bearer ' + tok } })).json()), user.token);
console.log('NOTIF:', JSON.stringify(notif));

await browser.close();
