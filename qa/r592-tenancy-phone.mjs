// r592 step 5 — Mark Warne, phone 390px: the TENANCY SCHEDULE on a phone
// (ground r584 never walked). "Who's either side of that unit, and when do
// their leases run out?" Then the property page's own boards pill.
process.env.QA_MAIN = '0';
process.env.QA_STEP_BASE = process.env.QA_STEP_BASE || '40';
const h = await import('./r592-client-mobile-journey.mjs');
const { page, go, tap, report, BASE, user } = h;
const PROP = 'cccccccc-0000-0000-0000-000000000001';

await go(`/tenancy-schedule/${PROP}`, 'tenancy-phone', { text: true, ids: true, tapTargets: true });

// Reconcile the tiles against the rows the API actually returns.
const r = await page.request.get(`${BASE}/api/properties/${PROP}/tenancy-schedule`, { headers: { Authorization: `Bearer ${user.token}` } });
console.log(`\n== [api] tenancy-schedule HTTP ${r.status()}`);
if (r.ok()) {
  const d = await r.json();
  const rows = Array.isArray(d) ? d : (d.units || d.rows || d.schedule || []);
  const by = {};
  for (const u of rows) by[String(u.status ?? u.unit_status)] = (by[String(u.status ?? u.unit_status)] || 0) + 1;
  console.log(`   ${rows.length} rows; status census ${JSON.stringify(by)}`);
  console.log('   sample keys: ' + Object.keys(rows[0] || {}).join(','));
}
await h.browser.close();
