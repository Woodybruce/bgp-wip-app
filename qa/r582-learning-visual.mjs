// r582: visual proof the deal learning now lands where the dialog promises —
// "Attaches to the tenant's brand card". Steps a probe deal EXC -> COM with a
// learning, then renders the tenant's brand profile and reads the Signals
// section. Self-cleaning.
import pg from 'pg';
import { chromium } from '../node_modules/playwright/index.mjs';
const BASE = process.env.QA_BASE || 'http://localhost:5000';
const TAG = process.env.QA_TAG || 'r582-learning';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const DEAL = 'dddd5582-0000-0000-0000-0000000002';
const LEARNING = 'R582 learning — tenant took 9m rent free to accept Zone A £300 psf.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const { rows: b } = await pool.query(`SELECT id, name FROM crm_companies ORDER BY name LIMIT 1`);
  const tenant = b[0];
  await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
  await pool.query(`DELETE FROM brand_signals WHERE source = $1`, [`bgp-deal:${DEAL}`]);
  await pool.query(
    `INSERT INTO crm_deals (id, name, status, deal_type, tenant_id, fee, aml_check_completed)
     VALUES ($1, 'R582 learning probe deal', 'EXC', 'New Letting', $2, 25000, 'YES')`, [DEAL, tenant.id]);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  await ctx.route('**/*', (r) => { const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); return r.abort(); });
  const lg = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'woody@brucegillinghampollard.com', password: 'B@nd0077!' } });
  const user = await lg.json();
  const put = await ctx.request.put(`${BASE}/api/crm/deals/${DEAL}`, {
    headers: { Authorization: `Bearer ${user.token}` },
    data: { status: 'COM', learning: LEARNING, changeReason: 'r582 visual probe' } });
  console.log('PUT COM ->', put.status());
  const prof = await ctx.request.get(`${BASE}/api/brand/${tenant.id}/profile`, { headers: { Authorization: `Bearer ${user.token}` } });
  const pj = prof.status() === 200 ? await prof.json() : null;
  const sigs = pj?.signals || [];
  const hit = sigs.find(s => (s.detail || '').includes('R582 learning'));
  console.log('brand/:id/profile status', prof.status(), 'signals', sigs.length, 'learning present:', !!hit);
  if (hit) console.log('  ->', JSON.stringify({ headline: hit.headline, detail: hit.detail }));

  const page = await ctx.newPage();
  await page.goto(BASE).catch(()=>{});
  await page.evaluate(([t,u])=>{localStorage.setItem('bgp_auth_token',t);localStorage.setItem('authToken',t);localStorage.setItem('user',JSON.stringify(u));},[user.token,user.user||user]);
  await page.goto(`${BASE}/companies/${tenant.id}`, {waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.waitForTimeout(4000);
  const txt = await page.evaluate(()=> (document.body.innerText||'').replace(/\s+/g,' '));
  const i = txt.indexOf('R582 learning');
  console.log('brand page (%s) shows the learning:', tenant.name, i >= 0);
  if (i >= 0) console.log('   CONTEXT:', txt.slice(Math.max(0,i-220), i+180));
  const el = page.locator('text=/R582 learning/').first();
  if (await el.count()) await el.scrollIntoViewIfNeeded().catch(()=>{});
  await page.waitForTimeout(600);
  const shot = `qa/smoke-shots/${TAG}-after.png`;
  await page.screenshot({ path: shot });
  console.log('shot', shot);
} finally {
  await pool.query(`DELETE FROM brand_signals WHERE source = $1`, [`bgp-deal:${DEAL}`]);
  await pool.query(`DELETE FROM crm_comps WHERE deal_id = $1`, [DEAL]).catch(()=>{});
  await pool.query(`DELETE FROM deal_audit_log WHERE deal_id = $1`, [DEAL]).catch(()=>{});
  await pool.query(`DELETE FROM crm_deals WHERE id = $1`, [DEAL]);
  const { rows } = await pool.query(`SELECT count(*)::int n FROM crm_deals WHERE id LIKE 'dddd5582%' OR name LIKE 'R582%'`);
  console.log('fixture restored, probe rows left:', rows[0].n);
  await pool.end(); await browser.close();
}
