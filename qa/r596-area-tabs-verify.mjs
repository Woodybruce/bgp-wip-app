// r596 verification: the comps area tabs must be reachable and honest.
// Before: AREA_GROUPS was 16 hardcoded central-London sub-markets plus an
// "Other" tab that substring-searched for the literal word "other" — so 8 of
// the 11 areas in the fixture (West End, Oxford Street, Reading, Dartford)
// could not be reached by ANY tab, including the one that exists to catch them.
process.env.QA_MAIN = '0';
process.env.QA_TAG = 'r596v';
process.env.QA_TOKEN_CACHE = '/tmp/r596-token.json';
const H = await import('./r596-staff-desktop-journey.mjs');
const { page, go, shot, browser, BASE, user } = H;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m)); };

const auth = { Authorization: `Bearer ${user.token}` };
const put = (id, d) => page.request.fetch(BASE + '/api/crm/comps/' + id, { method: 'PUT', headers: auth, data: d });
const fetchComps = async () => (await (await page.request.fetch(BASE + '/api/crm/comps', { headers: auth })).json());
const isLead = c => !c.verified && (["News Feed","Team Email","SharePoint File"].includes(c.sourceEvidence||"") || c.createdBy === "AI Auto-Extract");

// Put the board in the state the fix is about: Victoria has worked through the
// AI leads and confirmed them, which is exactly what the "Confirm Lead" button
// does (PUT verified:true). Until she does, everything sits on the Leads tab
// and the area tabs have almost nothing to filter.
const before = await fetchComps();
const reviewed = before.filter(isLead).map(c => c.id);
for (const id of reviewed) await put(id, { verified: true });
console.log(`#### confirmed ${reviewed.length} AI leads through the real review PUT`);

const comps = await fetchComps();
const confirmed = comps.filter(c => !isLead(c));
const areaOf = c => `${c.areaLocation || ''} ${c.groupName || ''}`.trim();
console.log(`#### ${comps.length} comps, ${confirmed.length} confirmed; areas: ${JSON.stringify(confirmed.map(areaOf))}`);
ok(confirmed.length >= 3, `baseline NOT VACUOUS — ${confirmed.length} confirmed comps on the board`);

await go('/comps', 'area-tabs', {});
await page.locator('[data-testid="text-comps-title"]').waitFor({ timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);
const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="area-tab-"]')].map(e => e.textContent.trim()));
console.log('#### area tabs offered: ' + JSON.stringify(tabs));

const rows = async () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="comp-row-"]')].map(e => e.getAttribute('data-testid').replace('comp-row-','')));
const clickTab = async (t) => { await page.locator(`[data-testid="area-tab-${t}"]`).click(); await page.waitForTimeout(700); };

// 1. every confirmed comp WITH an area is reachable by a tab of that name
for (const c of confirmed.filter(c => areaOf(c))) {
  const a = areaOf(c);
  ok(tabs.includes(a), `a tab exists for "${a}" (comp "${c.name}" / ${c.tenant})`);
}
// 2. NOT VACUOUS: clicking a previously-unreachable area really shows its comp
const outsideLondon = confirmed.filter(c => ['Reading','Dartford','West End','Oxford Street'].includes(areaOf(c)));
console.log(`#### comps in areas the curated list never named: ${outsideLondon.length}`);
for (const c of outsideLondon.slice(0, 3)) {
  await clickTab(areaOf(c));
  const r = await rows();
  ok(r.includes(c.id), `tab "${areaOf(c)}" shows comp ${c.id} (${r.length} row(s))`);
}
await shot('area-tab-outside-london');

// 3. CONTROL: a curated London area with no comps is NOT offered as a dead tab
const dead = ['Mayfair','Soho','Chelsea','Paddington'].filter(a => !confirmed.some(c => areaOf(c).toLowerCase().includes(a.toLowerCase())));
ok(dead.length > 0, `CONTROL not vacuous — ${dead.length} curated areas hold no comps`);
for (const a of dead) ok(!tabs.includes(a), `CONTROL empty curated area "${a}" is not offered`);

// 4. "Other" means no area recorded — and is the NEAR-MISS control for (2)
const unfiled = confirmed.filter(c => !areaOf(c));
console.log(`#### comps with no area at all: ${unfiled.length}`);
if (unfiled.length) {
  ok(tabs.includes('Other'), '"Other" is offered because unfiled comps exist');
  await clickTab('Other');
  const r = await rows();
  ok(r.length === unfiled.length, `"Other" returns the ${unfiled.length} unfiled comp(s), got ${r.length}`);
  for (const c of unfiled) ok(r.includes(c.id), `  "Other" includes unfiled comp ${c.id}`);
  // NEAR-MISS: a comp that HAS an area must not fall into "Other"
  for (const c of outsideLondon.slice(0, 2)) ok(!r.includes(c.id), `  NEAR-MISS CONTROL "Other" excludes ${areaOf(c)} comp ${c.id}`);
} else {
  ok(!tabs.includes('Other'), '"Other" not offered when nothing is unfiled');
}
await shot('area-tab-other');

// 5. Clear now clears the area tab too
await clickTab(tabs[1]);
const clear = page.locator('[data-testid="button-clear-filters"]');
ok(await clear.count() > 0, 'Clear is offered when only an area tab is active');
if (await clear.count()) {
  await clear.click(); await page.waitForTimeout(700);
  const active = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="area-tab-"]')]
    .filter(e => /bg-primary/.test(e.className)).map(e => e.textContent.trim()));
  ok(active.length === 1 && active[0] === 'All Areas', `Clear returns the area tab to All Areas (now: ${JSON.stringify(active)})`);
}
await shot('area-tab-cleared');

// teardown — hand the fixture back exactly as found
for (const id of reviewed) await put(id, { verified: false });
console.log(`#### restored ${reviewed.length} leads to unverified`);

console.log(`\n#### r596 area tabs: ${pass} PASS, ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);
