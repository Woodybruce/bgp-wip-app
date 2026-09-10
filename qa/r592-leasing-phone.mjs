// r592 step 4 — Mark Warne, phone 390px: "which of my units would I put them
// in?" The client-facing Leasing Schedule on a phone (the surface r591 fixed
// on desktop), then the vacant filter, then a unit card.
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '30';
const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, BASE, user } = h;
const PROP = 'cccccccc-0000-0000-0000-000000000001';

await go(`/leasing-schedule/${PROP}`, 'leasing-phone', { text: true, ids: true, tapTargets: true });

// The API behind the tiles — reconcile the headline against the rows.
const r = await page.request.get(`${BASE}/api/properties/${PROP}/leasing-schedule`, { headers: { Authorization: `Bearer ${user.token}` } });
console.log(`\n== [api] leasing-schedule HTTP ${r.status()}`);
if (r.ok()) {
  const d = await r.json();
  const rows = Array.isArray(d) ? d : (d.units || d.rows || []);
  const by = {};
  for (const u of rows) by[String(u.status)] = (by[String(u.status)] || 0) + 1;
  console.log(`   ${rows.length} rows; status census ${JSON.stringify(by)}`);
}

// Tap the Vacant tile / filter — does the count open the list it counted?
for (const sel of ['[data-testid="stat-card-vacant"]', 'button:has-text("Vacant")']) {
  if (await page.locator(sel).count()) { await tap(sel, 'leasing-vacant-filter', { text: true }); break; }
}
await h.browser.close();
