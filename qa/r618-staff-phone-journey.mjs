// r618 journey — BGP staff · phone 390px (rotation #4).
// Victoria, between viewings on her phone: a colleague has flagged a
// duplicate property clogging the Bluewater CRM. Can she find the CRM
// data-hygiene tools from the phone, and actually merge it there?
import { chromium } from '/home/user/bgp-wip-app/node_modules/playwright/index.mjs';
import pg from '/home/user/bgp-wip-app/node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke' });
const SHOT = process.env.SHOT_PREFIX || '/tmp/r618';
const BASE = 'http://127.0.0.1:5000';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const u1 = (await pool.query("SELECT id FROM users WHERE lower(email)=lower($1)", ['victoria@brucegillinghampollard.com'])).rows[0].id;
await pool.query("DELETE FROM crm_property_agents WHERE property_id IN (SELECT id FROM crm_properties WHERE name LIKE 'QA r618%')");
await pool.query("DELETE FROM crm_properties WHERE name LIKE 'QA r618%'");
const keep = (await pool.query("INSERT INTO crm_properties (name) VALUES ('QA r618 Riverside Retail Park') RETURNING id")).rows[0].id;
const dupe = (await pool.query("INSERT INTO crm_properties (name) VALUES ('QA r618 Riverside Retail Park') RETURNING id")).rows[0].id;
await pool.query("INSERT INTO crm_property_agents (property_id, user_id, role) VALUES ($1,$2,'Lead')", [dupe, u1]);
console.log('seeded 2x "QA r618 Riverside Retail Park", agent linked to the loser\n');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, isMobile: true, hasTouch: true });
const lr = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' } });
const user = await lr.json();
if (!user.token) { console.error('login failed', JSON.stringify(user).slice(0,200)); process.exit(2); }
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0,150)); });
page.on('response', r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().replace(BASE,'')}`); });
await page.goto(BASE).catch(e => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
await page.evaluate(([t,u]) => { localStorage.setItem('bgp_auth_token',t); localStorage.setItem('authToken',t); localStorage.setItem('user',JSON.stringify(u)); }, [user.token, user]);

async function step(label, url, waitMs = 9000) {
  errs.length = 0;
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }).catch(e => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
  await page.waitForTimeout(waitMs);
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  const shell = await page.evaluate(() => !!document.querySelector('[data-testid^="mobile-"], nav[class*="fixed bottom"]'));
  console.log(`— ${label} (${url}): overflow ${ov.sw}>${ov.iw}? ${ov.sw > ov.iw + 1 ? 'YES ' + ov.sw : 'no'} · phone shell: ${shell}`);
  const uniq = [...new Set(errs)];
  if (uniq.length) console.log('   issues:', uniq.slice(0,6).join(' | '));
  await page.screenshot({ path: `${SHOT}-${label.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.png`, fullPage: true });
  return ov;
}

// STEP 1 — her phone home screen
await step('01-home', '/', 12000);
const homeText = await page.innerText('body');
console.log('   home mentions Settings?', /settings/i.test(homeText));
const anySettingsLink = await page.locator('a[href="/settings"]').count();
console.log('   any <a href="/settings"> on the whole phone shell:', anySettingsLink);

// STEP 2 — ask ChatBGP's own app map where Settings is (what she'd be told)
const mapRes = await ctx.request.get(`${BASE}/api/health`);
console.log('   (health', mapRes.status(), ')\n');

// STEP 3 — she types the URL she remembers from her desktop
await step('02-settings', '/settings', 12000);
const sTitle = await page.locator('h1, h2').first().innerText().catch(()=>'(none)');
console.log('   first heading:', JSON.stringify(sTitle));
const scan = page.locator('[data-testid="button-scan-duplicates"]');
console.log('   "Scan duplicates" button present:', await scan.count());
if (await scan.count()) {
  const box = await scan.boundingBox();
  console.log('   scan button box:', box && `${Math.round(box.width)}x${Math.round(box.height)} at x=${Math.round(box.x)}`);
  await scan.scrollIntoViewIfNeeded();
  await scan.click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${SHOT}-03-after-scan.png`, fullPage: true });
  const sec = page.locator('[data-testid="section-property-dupes"]');
  console.log('   property-dupes section visible:', await sec.isVisible().catch(()=>false));
  if (await sec.isVisible().catch(()=>false)) {
    await sec.scrollIntoViewIfNeeded();
    const secBox = await sec.boundingBox();
    console.log('   dupes section box:', secBox && `w=${Math.round(secBox.width)} (viewport 390)`);
    const txt = await sec.innerText();
    console.log('   our group listed:', /r618 riverside/i.test(txt));
    await page.screenshot({ path: `${SHOT}-04-dupes-section.png` });
    // THE WRITE — merge it from the phone
    const mergeBtns = sec.locator('button', { hasText: /^Merge$/ });
    console.log('   Merge buttons in section:', await mergeBtns.count());
    const row = sec.locator('div', { hasText: /r618 riverside/i }).last();
    const rb = row.locator('button', { hasText: /Merge/ }).first();
    if (await rb.count()) {
      const bb = await rb.boundingBox();
      console.log('   merge button tap target:', bb && `${Math.round(bb.width)}x${Math.round(bb.height)}`);
      errs.length = 0;
      await rb.click();
      await page.waitForTimeout(7000);
      await page.screenshot({ path: `${SHOT}-05-after-merge.png`, fullPage: true });
      const toast = (await page.locator('[role="status"], li[role="status"], [data-testid="toast"]').allInnerTexts()).join(' | ');
      console.log('   toast:', JSON.stringify(toast.slice(0,200)));
      console.log('   merge issues:', [...new Set(errs)].slice(0,5).join(' | ') || 'none');
    } else console.log('   !! no Merge button reachable in the row');
  }
}
const rows = (await pool.query("SELECT count(*)::int c FROM crm_properties WHERE name LIKE 'QA r618%'")).rows[0].c;
const agentOnKeeper = (await pool.query("SELECT count(*)::int c FROM crm_property_agents WHERE property_id=$1", [keep])).rows[0].c;
console.log(`   DB after: ${rows} rows (want 1) · agent link on keeper: ${agentOnKeeper} (want 1)\n`);

// STEP 4 — the other surfaces she'd try on a phone
await step('06-image-studio', '/m/images', 12000);
await step('07-aml', '/aml-compliance', 12000);
await step('08-news', '/news', 10000);

await pool.query("DELETE FROM crm_property_agents WHERE property_id IN (SELECT id FROM crm_properties WHERE name LIKE 'QA r618%')");
await pool.query("DELETE FROM crm_properties WHERE name LIKE 'QA r618%'");
await browser.close();
await pool.end();
console.log('journey done');
