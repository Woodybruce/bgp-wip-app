// Seed only the disposable smoke DB, exercise the actual API and UI, then remove those exact fixture IDs.
// CRM_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres'
// SMOKE_BASE=https://127.0.0.1:5446 SMOKE_LOCAL_TLS=1 SMOKE_CHROMIUM=/path/to/chrome node qa/client-agent-directory-smoke.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { chromium, devices } from '../node_modules/playwright/index.mjs';

const BASE = new URL(process.env.SMOKE_BASE || 'http://localhost:5000');
if (!['http:','https:'].includes(BASE.protocol) || !['localhost','127.0.0.1','[::1]'].includes(BASE.hostname) || BASE.username || BASE.password) throw new Error('Local fixture app required');
const supplied = process.env.CRM_SMOKE_DATABASE_URL;
if (!supplied) throw new Error('Provide the separate CRM_SMOKE_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Disposable smoke database Unix socket required');
const OUTPUT = resolve(process.env.UX_OUTPUT || 'qa/smoke-shots/client-agents');
mkdirSync(OUTPUT, { recursive: true });
const smoke = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = name => smoke.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const id = n => `abcdabcd-0907-4000-8000-${String(n).padStart(12,'0')}`;
const brand = id(1), secondBrand = id(2), outsideBrand = id(3), agency = id(4), flagOnly = id(5), thirdBrand = id(6), fourthBrand = id(7);
const contactIds = [10,11,12,13,14,15,16].map(id);
const requirementIds = [20,21,22,23,24,25,26,27,28].map(id);
const allIds = [brand,secondBrand,outsideBrand,agency,flagOnly,thirdBrand,fourthBrand,...contactIds,...requirementIds,id(30)];
const results = { checks: [], screenshots: [], pageErrors: [] };
let browser;
let seeded = false;
const db = new pg.Client({ connectionString: supplied, ssl: false });
function check(name, test) { assert.ok(test, name); results.checks.push(name); console.log(`PASS ${name}`); }
async function api(page, path) {
  return page.evaluate(async path => {
    const token = localStorage.getItem('bgp_auth_token');
    const r = await fetch(path, { credentials:'include', headers: token ? { Authorization:`Bearer ${token}` } : {} });
    return { status:r.status, body:await r.json() };
  }, path);
}
async function context(phone) {
  const c = await browser.newContext({ ...(phone ? devices['iPhone 13'] : { viewport:{width:1440,height:1000} }), serviceWorkers:'block', ignoreHTTPSErrors:process.env.SMOKE_LOCAL_TLS === '1' });
  await c.route('**/*', r => new URL(r.request().url()).origin === BASE.origin ? r.continue() : r.abort());
  return c;
}
async function login(page) {
  page.on('pageerror', e => results.pageErrors.push(e.message));
  await page.goto(`${BASE.origin}/messages`);
  await page.getByTestId('card-login').waitFor({state:'visible',timeout:25000});
  if (await page.getByTestId('button-show-guest-login').isVisible()) await page.getByTestId('button-show-guest-login').click();
  await page.getByTestId('input-guest-email').fill(fixture('CLIENT'));
  await page.getByTestId('input-guest-password').fill(fixture('PASSWORD'));
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({state:'hidden',timeout:25000});
  const me = await api(page, '/api/auth/me');
  assert.equal(me.status,200);
  assert.equal(me.body.email.toLowerCase(),fixture('CLIENT').toLowerCase());
}
async function agentsPage(page) {
  await page.goto(`${BASE.origin}/contacts`);
  await page.getByTestId('client-crm-tab-agents').click();
}
async function snapshot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({path:join(OUTPUT,file),fullPage:false});
  results.screenshots.push(file);
}
await db.connect();
try {
  const prior = await db.query('SELECT id FROM crm_companies WHERE id=ANY($1::varchar[]) UNION ALL SELECT id FROM crm_contacts WHERE id=ANY($1::varchar[]) UNION ALL SELECT id FROM crm_requirements_leasing WHERE id=ANY($1::varchar[]) UNION ALL SELECT id FROM brand_agent_representations WHERE id=ANY($1::varchar[])',[allIds]);
  assert.equal(prior.rows.length,0,'Fixture IDs already exist; refusing to overwrite records');
  await db.query('BEGIN');
  for (const [co,name,type,flag] of [
    [brand,'QA CRM Coffee','Tenant - Restaurant',null], [secondBrand,'QA CRM Fitness','Tenant - Gym',null],
    [outsideBrand,'QA CRM Outside Fashion','Tenant - Fashion',null], [agency,'QA CRM Agency','Agent',null], [flagOnly,'QA CRM Flag Only','Agent','tenant_rep'],
    [thirdBrand,'QA CRM Bakery','Tenant - Bakery',null], [fourthBrand,'QA CRM Yoga','Tenant - Yoga',null],
  ]) await db.query('INSERT INTO crm_companies (id,name,company_type,agent_type) VALUES ($1,$2,$3,$4)',[co,name,type,flag]);
  for (const [i,name,firm] of [
    [10,'Avery QA',agency],[11,'Bailey QA',agency],[12,'Casey QA',agency],[13,'Zara QA',agency],
    [14,'QA CRM Agent Without Firm',null],[15,'Aardvark Unlinked Employee',agency],[16,'Outside Brand Agent',flagOnly],
  ]) await db.query('INSERT INTO crm_contacts (id,name,company_id,email,phone,role) VALUES ($1,$2,$3,$4,$5,$6)',[id(i),name,firm,`${name.toLowerCase().replaceAll(' ','-')}@example.test`,'020 0000 0000','Agent']);
  for (const [i,b,c] of [[20,brand,id(10)],[21,brand,id(11)],[22,brand,id(12)],[23,brand,id(13)],[24,secondBrand,id(14)],[25,secondBrand,id(10)],[26,outsideBrand,id(16)],[27,thirdBrand,id(10)],[28,fourthBrand,id(10)]]) {
    await db.query('INSERT INTO crm_requirements_leasing (id,name,company_id,agent_contact_id,status,sources) VALUES ($1,$2,$3,$4,$5,$6)',[id(i),'QA CRM Requirement',b,c,'Active',['PIPnet']]);
  }
  await db.query('INSERT INTO brand_agent_representations (id,brand_company_id,agent_company_id,primary_contact_id,agent_type,region) VALUES ($1,$2,$3,$4,$5,$6)',[id(30),brand,agency,id(10),'tenant_rep','London']);
  await db.query('COMMIT');
  seeded = true;
  browser = await chromium.launch({headless:true,...(process.env.SMOKE_CHROMIUM ? {executablePath:process.env.SMOKE_CHROMIUM} : {})});
  for (const phone of [false,true]) {
    const label = phone ? 'phone' : 'desktop';
    const c = await context(phone);
    const page = await c.newPage();
    page.setDefaultTimeout(20000);
    await login(page);
    const directory = await api(page,'/api/client/agent-directory');
    const brands = await api(page,'/api/client/brand-directory');
    check(`${label}: actual authenticated directory and Brand CRM endpoints load`,directory.status===200 && brands.status===200);
    const brandIds = new Set(brands.body.map(b=>b.id));
    const named = directory.body.find(a=>a.id===agency);
    check(`${label}: requirement agents populate without agency qualification flags`,named?.contacts.length===4);
    check(`${label}: firm employees without a brand link are excluded`,!directory.body.some(a=>a.contacts.some(c=>c.id===id(15))));
    check(`${label}: every agent entry links only to brands in the actual Brand CRM response`,directory.body.every(a=>a.represents.length>0 && a.represents.every(b=>brandIds.has(b.brandId))));
    check(`${label}: out-of-directory requirement does not qualify an agent firm`,!directory.body.some(a=>a.id===flagOnly));
    check(`${label}: linked agent without employer is retained`,directory.body.some(a=>a.id===`contact:${id(14)}` && a.kind==='contact'));
    await agentsPage(page);
    const card = page.getByTestId(`client-agent-${agency}`);
    await card.waitFor({state:'visible'});
    check(`${label}: compact contact preview matches the screen size`,await card.locator('[data-testid^="client-agent-contact-"]').count()===(phone?1:3));
    const firstPerson = card.getByTestId(`client-agent-contact-${id(10)}`);
    check(`${label}: a longer per-person brand list starts with three`,await firstPerson.locator('a[href^="/companies/"]').count()===3);
    await firstPerson.getByRole('button',{name:/Show all.*4.*brands/}).click();
    check(`${label}: Show all brands reveals all of that person's links`,await firstPerson.locator('a[href^="/companies/"]').count()===4);
    await firstPerson.getByRole('button',{name:'Show fewer brands'}).click();
    await card.getByTestId(`client-agent-show-contacts-${agency}`).click();
    check(`${label}: Show all reveals the fourth linked agent`,await card.getByTestId(`client-agent-contact-${id(13)}`).isVisible());
    check(`${label}: each person shows brand and relationship source`,(await card.getByTestId(`client-agent-contact-${id(10)}`).innerText()).includes('Current requirement'));
    await card.getByTestId(`client-agent-show-contacts-${agency}`).click();
    check(`${label}: Show fewer collapses the named contact list`,await card.locator('[data-testid^="client-agent-contact-"]').count()===(phone?1:3));
    const search = page.getByTestId('client-agent-search');
    await search.fill('Zara QA');
    check(`${label}: searching a collapsed contact makes that person visible`,await page.getByTestId(`client-agent-contact-${id(13)}`).isVisible());
    await search.fill('QA CRM Fitness');
    check(`${label}: brand search finds both its firm and its unconfirmed-firm contact`,await card.isVisible() && await page.getByTestId(`client-agent-contact-${id(14)}`).isVisible());
    await search.fill('QA CRM Agent Without Firm');
    check(`${label}: missing employer is explicitly labelled`,(await page.getByTestId(`client-agent-contact:${id(14)}`).innerText()).includes('Firm not confirmed'));
    await snapshot(page,`${label}-unconfirmed-firm`);
    await search.fill('No matching CRM agent 0907');
    check(`${label}: unmatched search has a clear empty state`,await page.getByTestId('client-agent-empty').isVisible());
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    check(`${label}: clearing search restores agents`,await card.isVisible());
    const count = await page.getByTestId('client-agent-results-count').innerText();
    const firms = directory.body.filter(a=>a.kind==='firm').length;
    const people = new Set(directory.body.flatMap(a=>a.contacts.map(c=>c.id))).size;
    check(`${label}: counts distinguish firms and unique people`,count.includes(`${firms} ${firms===1?'firm':'firms'}`) && count.includes(`${people} named`));
    await card.scrollIntoViewIfNeeded();
    check(`${label}: no horizontal page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await snapshot(page,`${label}-linked-agents`);
    await c.close();
  }
  const c = await context(false);
  const page = await c.newPage();
  let fail = true;
  await c.route('**/api/client/agent-directory',r=>fail ? r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic directory outage'})}) : r.continue());
  await login(page);
  await agentsPage(page);
  await page.getByTestId('client-agent-error').waitFor({state:'visible',timeout:25000});
  check('directory errors are visible instead of appearing as no agents',await page.getByTestId('client-agent-empty').count()===0);
  fail = false;
  await page.getByTestId('client-agent-retry').click();
  await page.getByTestId(`client-agent-${agency}`).waitFor({state:'visible'});
  check('Retry recovers the real directory',await page.getByTestId('client-agent-error').count()===0);
  await c.close();
  check('no uncaught browser errors',results.pageErrors.length===0);
} catch (error) {
  results.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (seeded) {
    await db.query('BEGIN');
    await db.query('DELETE FROM brand_agent_representations WHERE id=$1',[id(30)]);
    await db.query('DELETE FROM crm_requirements_leasing WHERE id=ANY($1::varchar[])',[requirementIds]);
    await db.query('DELETE FROM crm_contacts WHERE id=ANY($1::varchar[])',[contactIds]);
    await db.query('DELETE FROM crm_companies WHERE id=ANY($1::varchar[])',[[brand,secondBrand,outsideBrand,agency,flagOnly,thirdBrand,fourthBrand]]);
    await db.query('COMMIT');
  } else await db.query('ROLLBACK').catch(()=>{});
  await db.end();
  results.passed = !results.failure && results.pageErrors.length===0;
  writeFileSync(join(OUTPUT,'results.json'),`${JSON.stringify(results,null,2)}\n`);
  console.log(`${results.passed?'PASS':'FAIL'} ${results.checks.length} browser/API checks; synthetic CRM records removed`);
}
