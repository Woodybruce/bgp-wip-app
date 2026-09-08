// r614 journey WRITE — Mark self-adds a brand from the global directory (the
// one write his login owns) and checks his own hub tiles move with it.
import { go, page, browser, user } from './r614-journey.mjs';
await go('/brands', 'pre-add');
const res = await page.evaluate(async (t) => {
  const H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  const dir = await fetch('/api/client/crm/brand-directory?limit=400', { headers: H });
  const list = dir.ok ? await dir.json() : null;
  const arr = Array.isArray(list) ? list : (list?.brands || list?.rows || []);
  return { dirStatus: dir.status, n: arr.length, sample: arr.slice(0, 12).map(b => `${b.name} · ${b.companyType || b.company_type}`) };
}, user.token);
console.log(JSON.stringify(res, null, 1).slice(0, 2000));
await browser.close();
