// r625 journey: BGP staff (Victoria, Head of National, isAdmin false) on a
// REAL iPhone context at 390px. Reuses the r623 harness — the phone shell is
// gated on USER AGENT + touch, not the viewport — and THROWS if it is absent.
// Task: "a landlord rang about the Gail's letting at Bluewater" — find the
// deal on the phone, log a note on it (the WRITE), then work the tracker and
// set herself a follow-up task.
process.env.QA_USER = 'victoria@brucegillinghampollard.com';
process.env.QA_TAG = 'r625';
const h = await import('./r623-mark-phone-journey.mjs');
const { go, tap, report, warm, page, ctx, browser, assertPhoneShell, user, BASE } = h;
const DEAL = '11110000-0000-0000-0000-000000000302';

await assertPhoneShell();

// ── the WRITE: a deal comment from the phone ────────────────────────────
await warm(`/deals/${DEAL}`, 12000);
await go(`/deals/${DEAL}`, 'deal-before');
// The phone deal detail has its OWN section tabs; the desktop sidebar is
// rendered but hidden, so BOTH input-deal-comment copies exist in the DOM.
// Always drive the :visible one.
console.log(`\n[dom] comment inputs in DOM = ${await page.locator('[data-testid="input-deal-comment"]').count()}, visible = ${await page.locator('[data-testid="input-deal-comment"]:visible').count()}`);
await tap('[data-testid="deal-section-activity"]', 'activity-tab', { text: true });
console.log(`[dom] after ACTIVITY: visible comment inputs = ${await page.locator('[data-testid="input-deal-comment"]:visible').count()}`);
const note = `r625 phone note ${Date.now()}`;
await page.locator('[data-testid="input-deal-comment"]:visible').first().fill(note);
await tap('[data-testid="btn-add-deal-comment"]:visible', 'comment-posted', { settle: 3500 });
const shown = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="deal-comment-"]')].map(e => e.innerText.replace(/\n/g,' | ')));
console.log(`\n[write] comment entries on screen: ${JSON.stringify(shown)}`);
if (!shown.some(s => s.includes(note))) throw new Error('WRITE did not render: ' + JSON.stringify(shown));

// what the client sees of the same deal — staff-writes → client-sees
const mark = await ctx.request; // NOT reused: fresh context below
const ctx2 = await (await import('../node_modules/playwright/index.mjs')).chromium; // noop
const clientCtx = await page.context().browser().newContext();
const lg = await clientCtx.request.post(`${BASE}/api/auth/login`, { data: { username: 'mark.warne@landsec.com', password: 'B@nd0077!' } });
const mUser = await lg.json();
const mDeal = await clientCtx.request.get(`${BASE}/api/crm/deals/${DEAL}`).then(r => r.json());
console.log(`[client] mark sees this deal: comments=${JSON.stringify(String(mDeal.comments||'').slice(-140))}`);
console.log(`[client] fee=${mDeal.fee} amlSarReference=${mDeal.amlSarReference} internalAgent=${JSON.stringify(mDeal.internalAgent)} team=${JSON.stringify(mDeal.team)}`);
await clientCtx.close();

// ── the staff phone Letting Tracker ─────────────────────────────────────
await warm('/deals/letting', 14000);
await go('/deals/letting', 'tracker', { text: true });

// ── a follow-up task from the phone (second WRITE) ──────────────────────
await warm('/tasks', 12000);
await go('/tasks', 'tasks-before');
console.log('--- TASK IDS --- ' + await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')))].join(' ')));

await browser.close();
