// r594 leg 2: the WIP report as a month-end chasing tool on a phone, and
// the deal's Compliance/KYC panel from the staff side.
process.env.QA_USER = 'victoria@brucegillinghampollard.com';
process.env.QA_TAG = 'r594b';
process.env.QA_TOKEN_CACHE = '/tmp/r594-token.json';
process.env.QA_MAIN = '0';
const H = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, BASE, user } = H;

await go('/deals/report', 'wip-report-tab-phone', { text: true, full: true, tapTargets: true });
await go('/deals/list', 'deals-list-phone', { text: true });

// The deal she just worked: does the WIP/deals view reach a NEG deal at all?
const auth = { Authorization: `Bearer ${user.token}` };
const r = await page.request.fetch(BASE + '/api/crm/deals', { headers: auth });
const deals = await r.json();
const census = {};
for (const d of deals) census[d.status || 'null'] = (census[d.status || 'null'] || 0) + 1;
console.log(`\n#### /api/crm/deals returns ${deals.length}; status census ${JSON.stringify(census)}`);

// KYC panel on a NEG deal, staff side, on the phone.
await go('/deals/11110000-0000-0000-0000-000000000301', 'deal-neg-phone', {});
await tap('[data-testid="toggle-deal-kyc"]', 'deal-kyc-panel-phone', { text: true, full: true });
await H.browser.close();
