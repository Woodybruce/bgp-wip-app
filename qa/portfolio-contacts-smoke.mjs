// Real API/browser coverage against a disposable local fixture only.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pg from 'pg';
import { chromium, devices } from '../node_modules/playwright/index.mjs';

const BASE = new URL(process.env.SMOKE_BASE || 'https://127.0.0.1:5446');
if (!['http:', 'https:'].includes(BASE.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(BASE.hostname) || BASE.username || BASE.password) throw new Error('Local fixture app required');
const supplied = process.env.CRM_SMOKE_DATABASE_URL;
if (!supplied) throw new Error('Provide the separate CRM_SMOKE_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke' || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) throw new Error('Disposable smoke database Unix socket required');
const OUTPUT = resolve(process.env.UX_OUTPUT || 'qa/smoke-shots/portfolio-contacts');
mkdirSync(OUTPUT, { recursive: true });
const fixtureSource = readFileSync(new URL('./smoke.mjs', import.meta.url), 'utf8');
const fixture = name => fixtureSource.match(new RegExp(`const ${name} = '([^']+)'`))[1];
const LANDSEC = 'd25ec158-82df-4f50-8188-cae113af5f9f';
const id = n => `abcdabcd-0907-4100-8100-${String(n).padStart(12, '0')}`;
const owned = id(1), shared = id(2), foreign = id(3), agency = id(4), retail = id(5), consultancy = id(6), otherLandlord = id(7), brand = id(8);
const companies = [agency, retail, consultancy, otherLandlord, brand];
const contacts = Array.from({ length: 32 }, (_, n) => id(100 + n));
const deals = [id(10), id(11), id(12)];
const results = { checks: [], screenshots: [], pageErrors: [] };
let browser, seeded = false;
const db = new pg.Client({ connectionString: supplied, ssl: false });
function check(name, test) { assert.ok(test, name); results.checks.push(name); console.log(`PASS ${name}`); }
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const token = localStorage.getItem('bgp_auth_token');
    const r = await fetch(path, { method, credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  }, { path, method, body });
}
async function context(phone) {
  const c = await browser.newContext({ ...(phone ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }), serviceWorkers: 'block', ignoreHTTPSErrors: process.env.SMOKE_LOCAL_TLS === '1' });
  await c.route('**/*', r => new URL(r.request().url()).origin === BASE.origin ? r.continue() : r.abort());
  return c;
}
async function login(page) {
  page.on('pageerror', e => results.pageErrors.push(e.message));
  await page.goto(`${BASE.origin}/messages`);
  await page.getByTestId('card-login').waitFor({ state: 'visible', timeout: 25000 });
  if (await page.getByTestId('button-show-guest-login').isVisible()) await page.getByTestId('button-show-guest-login').click();
  await page.getByTestId('input-guest-email').fill(fixture('CLIENT'));
  await page.getByTestId('input-guest-password').fill(fixture('PASSWORD'));
  await page.getByTestId('button-guest-login').click();
  await page.getByTestId('card-login').waitFor({ state: 'hidden', timeout: 25000 });
  check('Authenticated as the local Landsec client', (await api(page, '/api/auth/me')).body.email.toLowerCase() === fixture('CLIENT').toLowerCase());
}
async function fullView(page) {
  await page.goto(BASE.origin);
  await page.getByTestId('portfolio-contacts-open').click();
  await page.getByTestId('portfolio-contacts-dialog').waitFor({ state: 'visible' });
  return page.getByTestId('portfolio-contacts-dialog');
}
async function snapshot(page, name) {
  await page.screenshot({ path: join(OUTPUT, `${name}.png`) });
  results.screenshots.push(`${name}.png`);
}
await db.connect();
try {
  const prior = await db.query('SELECT id FROM crm_properties WHERE id=ANY($1::varchar[]) UNION ALL SELECT id FROM crm_contacts WHERE id=ANY($2::varchar[]) UNION ALL SELECT id FROM crm_companies WHERE id=ANY($3::varchar[])', [[owned, shared, foreign], contacts, companies]);
  assert.equal(prior.rows.length, 0, 'Fixture IDs already exist; refusing to overwrite records');
  await db.query('BEGIN');
  for (const [co, name, type] of [[agency, 'QA Portfolio Agency', 'Agent'], [retail, 'QA Portfolio Fashion', 'Tenant - Fashion'], [consultancy, 'QA Portfolio Engineers', 'Consultant'], [otherLandlord, 'QA Portfolio Other Landlord', 'Landlord'], [brand, 'QA Portfolio Coffee', 'Tenant - Restaurant']]) {
    await db.query('INSERT INTO crm_companies (id,name,company_type) VALUES ($1,$2,$3)', [co, name, type]);
  }
  for (const [p, name, landlord] of [[owned, 'QA Portfolio Alpha', LANDSEC], [shared, 'QA Portfolio Beta Shared', otherLandlord], [foreign, 'QA Portfolio Private', otherLandlord]]) await db.query('INSERT INTO crm_properties (id,name,landlord_id,status) VALUES ($1,$2,$3,$4)', [p, name, landlord, 'Active']);
  await db.query('INSERT INTO crm_company_properties (id,company_id,property_id) VALUES ($1,$2,$3),($4,$5,$6)', [id(20), LANDSEC, shared, id(21), consultancy, owned]);
  for (let n = 0; n < contacts.length; n++) {
    const firm = n === 9 || n === 10 ? LANDSEC : n === 11 ? consultancy : n === 12 ? retail : n === 13 ? null : n >= 15 ? brand : agency;
    const name = n === 0 ? 'QA Portfolio Avery Agent' : n === 9 ? 'QA Portfolio Client Surveyor' : n === 10 ? 'QA Portfolio Director' : n === 11 ? 'QA Portfolio Consultant' : n === 12 ? 'QA Portfolio Retail Person' : n === 13 ? 'QA Portfolio Pinned Person' : n === 14 ? 'QA Portfolio Private Person' : `QA Portfolio Person ${String(n).padStart(2, '0')}`;
    await db.query('INSERT INTO crm_contacts (id,name,company_id,company_name,role,email,phone,last_interaction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [contacts[n], name, firm, 'Stale stored company label', n === 10 ? 'Director' : 'Surveyor', `portfolio-${n}@example.test`, '020 0000 0000', n >= 15 ? '2026-09-01' : null]);
  }
  await db.query('INSERT INTO crm_deals (id,name,property_id,status,tenant_id,client_contact_id,tenant_contact_id,landlord_contact_id,vendor_contact_id,purchaser_contact_id,vendor_agent_contact_id,acquisition_agent_contact_id,purchaser_agent_contact_id,leasing_agent_contact_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [deals[0], 'QA Portfolio Alpha Letting', owned, 'HOT', brand, ...contacts.slice(0, 9)]);
  await db.query('INSERT INTO crm_deals (id,name,property_id,status,tenant_id,client_contact_id,leasing_agent_contact_id) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14)', [deals[1], 'QA Portfolio Beta Letting', shared, 'HOT', brand, contacts[9], contacts[0], deals[2], 'QA Portfolio Hidden Letting', foreign, 'HOT', brand, contacts[14], null]);
  await db.query('INSERT INTO property_units (id,property_id,unit_name) VALUES ($1,$2,$3)', [id(30), owned, 'QA Portfolio Unit 101']);
  await db.query('INSERT INTO available_units (id,property_id,unit_id,unit_name,marketing_status) VALUES ($1,$2,$3,$4,$5)', [id(31), owned, id(30), 'QA Portfolio Unit 101', 'NEG']);
  await db.query('INSERT INTO tenancy_schedule_units (id,property_id,tenant_company_id,tenant_name,unit_number,status) VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [id(32), owned, retail, 'QA Portfolio Coffee', 'QA Portfolio Unit 102', 'Occupied', id(33), shared, null, 'QA Portfolio Unresolved Occupier', 'QA Portfolio Unit 103', 'Occupied']);
  await db.query("INSERT INTO property_contact_overrides (property_id,contact_id,kind) VALUES ($1,$2,'pin')", [shared, contacts[13]]);
  const staff = (await db.query('SELECT id FROM users WHERE lower(email)=lower($1)', [fixture('STAFF')])).rows[0];
  assert.ok(staff);
  await db.query('INSERT INTO crm_property_agents (id,property_id,user_id,role) VALUES ($1,$2,$3,$4)', [id(34), owned, staff.id, 'Lead']);
  await db.query('COMMIT');
  seeded = true;
  browser = await chromium.launch({ headless: true, ...(process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}) });
  for (const phone of [false, true]) {
    const label = phone ? 'phone' : 'desktop';
    const c = await context(phone);
    const page = await c.newPage();
    page.setDefaultTimeout(25000);
    await login(page);
    const response = await api(page, `/api/company-portfolio/${LANDSEC}/linked-contacts`);
    check(`${label}: portfolio endpoint returns complete structured response`, response.status === 200 && Array.isArray(response.body.entries));
    const entries = response.body.entries;
    const person = n => entries.find(e => e.contactId === contacts[n]);
    check(`${label}: all nine named deal contact roles populate`, contacts.slice(0, 9).every(cid => entries.some(e => e.contactId === cid)));
    check(`${label}: one person retains both owned and shared property links`, person(0).relationships.some(r => r.property?.id === owned) && person(0).relationships.some(r => r.property?.id === shared));
    check(`${label}: named client non-director remains visible`, !!person(9));
    check(`${label}: current company name replaces stale copied company label`, person(0).company?.name === 'QA Portfolio Agency');
    check(`${label}: consultant and retail people remain visible without forbidden CRM destinations`, person(11) && !person(11).canOpenContact && person(12) && !person(12).canOpenCompany);
    check(`${label}: pinned person without employer remains visible`, person(13)?.relationships.some(r => r.property?.id === shared));
    check(`${label}: foreign property and its named person are excluded`, !person(14) && !response.body.properties.some(p => p.id === foreign));
    check(`${label}: canonical occupancy link beats conflicting free text`, person(12)?.relationships.some(r => r.group === 'tenants' && r.confirmed) && !entries.some(e => e.company?.id === brand && e.relationships.some(r => r.group === 'tenants' && r.unitName === 'QA Portfolio Unit 102')));
    check(`${label}: another client portfolio stays forbidden`, (await api(page, `/api/company-portfolio/${otherLandlord}/linked-contacts`)).status === 403);
    if (!phone) {
      check('Client still edits authorised owned property', (await api(page, `/api/crm/properties/${owned}`, 'PUT', { website: 'https://example.test/owned' })).status === 200);
      check('Client still edits explicitly shared property', (await api(page, `/api/crm/properties/${shared}`, 'PUT', { website: 'https://example.test/shared' })).status === 200);
      check('Client still edits shared-property deal terms', (await api(page, `/api/crm/deals/${deals[1]}`, 'PUT', { pricing: 51000 })).status === 200);
    }
    const dialog = await fullView(page);
    if (phone) {
      const titleBox = await dialog.getByRole('heading', { name: 'Portfolio contacts' }).boundingBox();
      const closeBox = await dialog.getByRole('button', { name: 'Close portfolio contacts' }).boundingBox();
      check('Phone close control sits beside the title without consuming another row', Math.abs(titleBox.y - closeBox.y) < 16 && closeBox.x > titleBox.x + titleBox.width);
    }
    const search = dialog.getByTestId('portfolio-contacts-search');
    await search.fill('QA Portfolio');
    await dialog.locator('[data-testid^="portfolio-contact-contact:"]').first().waitFor({ state: 'visible' });
    check(`${label}: full list is paged`, await dialog.locator('[data-testid^="portfolio-contact-contact:"]').count() <= 12 && await dialog.getByTestId('portfolio-contacts-next').isEnabled());
    await dialog.getByTestId('portfolio-contacts-next').click();
    check(`${label}: next page advances`, (await dialog.getByTestId('portfolio-contacts-page').innerText()).includes('2'));
    await search.fill('QA Portfolio Avery Agent');
    const avery = dialog.getByTestId(`portfolio-contact-contact:${contacts[0]}`);
    await avery.waitFor({ state: 'visible' });
    check(`${label}: search resets pagination and finds named person`, (await dialog.getByTestId('portfolio-contacts-page').innerText()).includes('1'));
    const reveal = avery.getByTestId(`portfolio-contact-links-contact:${contacts[0]}`);
    if (await reveal.isVisible()) await reveal.click();
    check(`${label}: specific property and deal links are available`, await avery.locator(`a[href="/properties/${shared}"]`).count() > 0 && await avery.locator(`a[href="/deals/${deals[1]}"]`).count() > 0);
    check(`${label}: contact and employer profiles are independently linked`, await avery.locator(`a[href="/contacts/${contacts[0]}"]`).count() > 0 && await avery.locator(`a[href="/companies/${agency}"]`).count() > 0);
    check(`${label}: linked contact and company detail APIs accept this client`, (await api(page, `/api/crm/contacts/${contacts[0]}`)).status === 200 && (await api(page, `/api/crm/companies/${agency}`)).status === 200);
    check(`${label}: email and telephone actions are present`, await avery.locator('a[href^="mailto:"]').count() > 0 && await avery.locator('a[href^="tel:"]').count() > 0);
    await snapshot(page, `${label}-portfolio-person-links`);
    await search.fill('QA Portfolio Beta Letting');
    check(`${label}: search finds people by their related deal`, await avery.isVisible());
    await search.fill('QA Portfolio');
    await dialog.getByTestId('portfolio-contacts-property').click();
    await page.getByRole('option', { name: 'QA Portfolio Beta Shared', exact: true }).click();
    check(`${label}: property filter retains the shared-scheme contact`, await avery.isVisible());
    await dialog.getByTestId('portfolio-contacts-filter-internal').click();
    check(`${label}: combined group and property filters show the named client surveyor`, await dialog.getByTestId(`portfolio-contact-contact:${contacts[9]}`).isVisible());
    check(`${label}: property filter excludes account-only directors`, await dialog.getByTestId(`portfolio-contact-contact:${contacts[10]}`).count() === 0);
    await dialog.getByTestId('portfolio-contacts-filter-all').click();
    await dialog.getByTestId('portfolio-contacts-property').click();
    await page.getByRole('option', { name: 'All properties', exact: true }).click();
    await search.fill('QA Portfolio Retail Person');
    const retailer = dialog.getByTestId(`portfolio-contact-contact:${contacts[12]}`);
    await retailer.waitFor({ state: 'visible' });
    check(`${label}: out-of-directory occupier links its property without a forbidden profile`, await retailer.locator('a[href^="/contacts/"],a[href^="/companies/"]').count() === 0 && await retailer.locator(`a[href="/properties/${owned}"]`).count() > 0);
    await search.fill('QA Portfolio Unit 101');
    check(`${label}: unresolved tracker unit points to the actual property`, await dialog.locator(`a[href="/properties/${owned}"]`).count() > 0);
    check(`${label}: no generic HR or unsupported unit destinations`, await dialog.locator('a[href="/hr"],a[href="/available"],a[href*="/units/"]').count() === 0);
    await search.fill('QA Portfolio No Such Person');
    check(`${label}: search empty state is explicit`, (await dialog.innerText()).includes('No contacts, companies or units match'));
    await search.fill('QA Portfolio');
    await dialog.getByTestId('portfolio-contacts-filter-consultants').click();
    check(`${label}: consultant group filter finds the linked firm contact`, await dialog.getByTestId(`portfolio-contact-contact:${contacts[11]}`).isVisible());
    check(`${label}: dialog has no horizontal overflow`, await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    check(`${label}: page has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await snapshot(page, `${label}-portfolio-filtered`);
    await dialog.getByTestId('portfolio-contacts-filter-all').click();
    await search.fill('QA Portfolio Avery Agent');
    await avery.locator(`a[href="/deals/${deals[1]}"]`).first().click();
    await page.waitForURL(`**/deals/${deals[1]}`);
    await page.getByTestId('portfolio-contacts-dialog').waitFor({ state: 'hidden' });
    check(`${label}: deal navigation closes the contacts view`, !(await page.getByTestId('portfolio-contacts-dialog').isVisible()));
    check(`${label}: navigated shared deal loads successfully`, (await api(page, `/api/crm/deals/${deals[1]}`)).status === 200);
    await c.close();
  }
  const c = await context(false);
  const page = await c.newPage();
  let fail = true;
  await c.route(`**/api/company-portfolio/${LANDSEC}/linked-contacts`, r => fail ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic contacts outage' }) }) : r.continue());
  await login(page);
  await page.goto(BASE.origin);
  const board = page.getByTestId('portfolio-contacts-board');
  await board.getByTestId('portfolio-contacts-retry').waitFor({ state: 'visible', timeout: 30000 });
  check('Failed request is shown as an error instead of empty contacts', /could not|couldn.t|unable/i.test(await board.innerText()));
  fail = false;
  await board.getByTestId('portfolio-contacts-retry').click();
  await board.getByTestId('portfolio-contacts-preview-row').first().waitFor({ state: 'visible' });
  check('Retry reloads the actual portfolio contacts', !(await board.getByTestId('portfolio-contacts-retry').isVisible()));
  await c.close();
  check('No browser JavaScript errors', results.pageErrors.length === 0);
} catch (error) {
  results.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (seeded) {
    await db.query('BEGIN');
    await db.query('DELETE FROM property_contact_overrides WHERE property_id=ANY($1::varchar[])', [[owned, shared, foreign]]);
    await db.query('DELETE FROM crm_property_agents WHERE id=$1', [id(34)]);
    await db.query('DELETE FROM tenancy_schedule_units WHERE id=ANY($1::varchar[])', [[id(32), id(33)]]);
    await db.query('DELETE FROM available_units WHERE id=$1', [id(31)]);
    await db.query('DELETE FROM crm_deals WHERE id=ANY($1::varchar[])', [deals]);
    await db.query('DELETE FROM property_units WHERE id=$1', [id(30)]);
    await db.query('DELETE FROM crm_company_properties WHERE id=ANY($1::varchar[])', [[id(20), id(21)]]);
    await db.query('DELETE FROM crm_contacts WHERE id=ANY($1::varchar[])', [contacts]);
    await db.query('DELETE FROM crm_properties WHERE id=ANY($1::varchar[])', [[owned, shared, foreign]]);
    await db.query('DELETE FROM crm_companies WHERE id=ANY($1::varchar[])', [companies]);
    await db.query('COMMIT');
  } else await db.query('ROLLBACK').catch(() => {});
  await db.end();
  results.passed = !results.failure && results.pageErrors.length === 0;
  writeFileSync(join(OUTPUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.passed ? 'PASS' : 'FAIL'} ${results.checks.length} browser/API checks; synthetic portfolio records removed`);
}
