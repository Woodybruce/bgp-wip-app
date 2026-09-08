// r614 WRITE — Mark self-adds a brand outside his hospitality slice and
// watches his own hub tiles move, then removes it again.
import { go, page, browser, user } from './r614-journey.mjs';
await go('/brands', 'pre-add');
const out = await page.evaluate(async (t) => {
  const H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  const j = async (u, o) => { const r = await fetch(u, { headers: H, ...o }); const x = await r.text(); try { return { s: r.status, b: JSON.parse(x) }; } catch { return { s: r.status, b: x.slice(0, 200) }; } };
  const before = await j('/api/brands/hub');
  const search = await j('/api/client/crm/global-brands?search=Testco');
  const arr = Array.isArray(search.b) ? search.b : (search.b?.brands || []);
  const cand = arr.find(b => !/restaurant|caf|bakery|cinema|gym/i.test(b.companyType || b.company_type || '')) || arr[0];
  if (!cand) return { searchStatus: search.s, note: 'no candidate', sample: arr.slice(0, 8) };
  const add = await j('/api/client/crm/add-brand', { method: 'POST', body: JSON.stringify({ brandId: cand.id }) });
  const after = await j('/api/brands/hub');
  const del = await j(`/api/client/crm/add-brand/${cand.id}`, { method: 'DELETE' });
  const back = await j('/api/brands/hub');
  const cats = (h) => (h.b?.categoryCounts || []).map(r => `${r.company_type}:${r.count}`).sort();
  return {
    searchStatus: search.s, searchN: arr.length,
    candidate: `${cand.name} · ${cand.companyType || cand.company_type}`,
    addStatus: add.s, delStatus: del.s,
    before: { total: before.b?.stats?.total_brands, cats: cats(before) },
    after: { total: after.b?.stats?.total_brands, cats: cats(after) },
    restored: { total: back.b?.stats?.total_brands, cats: cats(back) },
  };
}, user.token);
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
await browser.close();
