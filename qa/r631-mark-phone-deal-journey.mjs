// r631 journey: Mark Warne (Landsec client) on a REAL iPhone context, 390px.
// Task: "is the Bluewater deal moving? fix the target date and grab a
// marketing image" — a real WRITE through the phone deal detail's
// button-edit-deal, plus the never-tested button-deal-image-studio.
import { page, ctx, go, tap, report, warm, browser, BASE, user, assertPhoneShell } from './r623-mark-phone-journey.mjs';

await assertPhoneShell();
await go('/home', 'home', { text: true });

// --- 1. Deals tab
await tap('[data-testid="bottom-nav-deals"]', 'deals-tab', { text: true, settle: 3000 });

// Which deal cards are on the phone list?
const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="card-deal"],[data-testid^="deal-card"],[data-testid^="row-deal"]')]
  .map(e => ({ id: e.getAttribute('data-testid'), txt: (e.innerText||'').replace(/\n+/g,' | ').slice(0,120) })).slice(0, 12));
console.log('\nDEAL CARDS:', JSON.stringify(cards, null, 1));

// --- 2. Open a deal
let opened = false;
if (cards.length) {
  await tap(`[data-testid="${cards[0].id}"]`, 'deal-open', { settle: 3500 });
  opened = /\/deals\//.test(await page.evaluate(() => location.pathname));
}
if (!opened) {
  // fall back: resolve one in-scope deal by API and go straight there
  const r = await ctx.request.get(`${BASE}/api/crm/deals`, { headers: { Authorization: `Bearer ${user.token}` } });
  const arr = await r.json();
  console.log(`\nAPI deals visible to Mark: ${arr.length}; first = ${arr[0]?.id} "${arr[0]?.name}"`);
  await go(`/deals/${arr[0].id}`, 'deal-detail-direct', { settle: 4000 });
}
const dealPath = await page.evaluate(() => location.pathname);
const dealId = dealPath.split('/').pop();
console.log(`\nON DEAL ${dealId}`);
await report('deal-detail', { text: true, full: true });

// every sidebar testid exists TWICE on the phone deal detail (hidden md:block
// desktop sidebar renders alongside) — drive :visible.
for (const t of ['button-edit-deal', 'button-deal-image-studio', 'button-deal-create-document']) {
  const total = await page.locator(`[data-testid="${t}"]`).count();
  const vis = await page.locator(`[data-testid="${t}"]:visible`).count();
  console.log(`   ${t}: ${total} in DOM, ${vis} visible`);
}

// --- 3. THE WRITE: tap Edit and inspect what a CLIENT is shown
await tap('[data-testid="button-edit-deal"]:visible', 'edit-dialog-open', { settle: 2500 });
const dlg = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  return {
    title: (d.querySelector('h2,[id$="title"]')?.textContent || '').trim(),
    labels: [...d.querySelectorAll('label')].map(l => (l.textContent||'').trim()).filter(Boolean),
    ids: [...d.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')),
    overflow: d.scrollWidth - d.clientWidth,
  };
});
console.log('\nEDIT DIALOG (client):', JSON.stringify(dlg, null, 1));
await browser.close();
