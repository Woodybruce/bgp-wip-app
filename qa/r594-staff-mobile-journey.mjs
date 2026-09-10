// r594 journey: Victoria (BGP staff) on an iPhone at 390px.
// Task framing: "Month-end, on the train. Open the WIP report on the phone
// to see what needs chasing. Then the agent rings — the tenant at Bluewater
// has offered on a unit. Log the offer from the phone, and check it reaches
// the deal and the pipeline."
process.env.QA_USER = 'victoria@brucegillinghampollard.com';
process.env.QA_TAG = 'r594';
process.env.QA_TOKEN_CACHE = '/tmp/r594-token.json';
process.env.QA_MAIN = '0';
const H = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, shot, BASE, user } = H;

const auth = { Authorization: `Bearer ${user.token}` };
const api = async (m, p, d) => {
  const r = await page.request.fetch(BASE + p, { method: m, headers: auth, data: d });
  const t = await r.text();
  try { return { status: r.status(), body: JSON.parse(t) }; } catch { return { status: r.status(), body: t.slice(0, 300) }; }
};

// ── STEP 1: the WIP report on the phone. Month-end chasing.
await go('/deals', 'wip-report-phone', { text: true, ids: true, tapTargets: true });

// ── STEP 2: pick the unit the agent is ringing about.
const units = (await api('GET', '/api/available-units')).body;
const props = (await api('GET', '/api/crm/properties')).body;
const bw = props.find(p => /Bluewater/i.test(p.name || ''));
const cands = units.filter(u => u.propertyId === bw?.id && ['AVA', 'NEG'].includes(u.marketingStatus));
console.log(`\n#### Bluewater = ${bw?.name} ${bw?.id}; ${cands.length} AVA/NEG units; picking:`);
const unit = cands[0];
console.log(`   ${unit.id} "${unit.unitName}" status=${unit.marketingStatus} deal=${unit.dealId || 'none'}`);

// ── STEP 3: open the tracker and find that unit's card. Judge the page as her.
await go('/available', 'tracker-phone', { text: true, tapTargets: true });
const before = (await api('GET', `/api/available-units/${unit.id}/offers`)).body;
console.log(`#### offers before = ${Array.isArray(before) ? before.length : JSON.stringify(before)}`);

await tap(`[data-testid="unit-offer-${unit.id}"]`, 'offer-dialog-empty', { text: true, ids: true });
await tap('[data-testid="offer-add"]', 'offer-form-open', { ids: true });

// ── STEP 4: THE WRITE. Fill it in with thumbs.
await page.locator('[data-testid="offer-company"]').click();
await page.locator('input[placeholder*="Search"]').first().fill('Honi');
await page.waitForTimeout(900);
await shot('offer-company-search');
const opts = page.locator('[role="option"]');
const n = await opts.count();
console.log(`#### company options for "Honi": ${n}`);
for (let i = 0; i < Math.min(n, 4); i++) console.log(`   [${i}] ${(await opts.nth(i).innerText()).replace(/\n/g, ' | ')}`);
if (n > 0) await opts.first().click();
await page.waitForTimeout(400);

await page.locator('[data-testid="offer-date"]').fill('2026-09-07');
await page.locator('[data-testid="offer-rent"] input, input[data-testid="offer-rent"]').first().fill('62500');
await page.locator('[data-testid="offer-term"]').fill('10');
await page.locator('[data-testid="offer-rent-free"]').fill('9');
await page.locator('[data-testid="offer-break"]').fill('Year 5');
await page.locator('[data-testid="offer-premium"] input, input[data-testid="offer-premium"]').first().fill('15000');
await page.locator('[data-testid="offer-comments"]').fill('r594 QA — verbal offer taken at the unit, agent to confirm in writing.');
await report('offer-form-filled', { text: true });
await tap('[data-testid="offer-save"]', 'offer-saved', { text: true });

// ── STEP 5: did it actually land? Network log over toast.
const after = (await api('GET', `/api/available-units/${unit.id}/offers`)).body;
console.log(`\n#### offers after = ${Array.isArray(after) ? after.length : JSON.stringify(after)}`);
if (Array.isArray(after)) for (const o of after) console.log('   ' + JSON.stringify(o));

// ── STEP 6: full reload — does the card show the offer, and does it reopen?
await go('/available', 'tracker-after-offer', {});
const cardTxt = await page.locator(`[data-testid="unit-offer-${unit.id}"]`).innerText().catch(() => '(button not found)');
console.log(`#### offer button label after reload: ${JSON.stringify(cardTxt)}`);
await tap(`[data-testid="unit-offer-${unit.id}"]`, 'offer-dialog-reopened', { text: true });

// ── STEP 7: chase the next step — the deal behind the unit, and the pipeline.
if (unit.dealId) await go(`/deals/${unit.dealId}`, 'deal-detail-phone', { text: true, ids: true, tapTargets: true });
await go('/deals', 'wip-report-after', { text: true });
await H.browser.close();
