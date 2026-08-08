// Smoke suite — the deterministic, fail-loud sibling of two-bot-round.mjs.
//
// Walks the critical paths (staff + Landsec client) with HARD assertions and
// exits non-zero on any failure, so CI can block a deploy. Deliberately
// narrow and fast (~2-3 min): it proves the app isn't on fire, it doesn't
// explore. Add scenarios sparingly — every check here runs on EVERY push.
//
// Usage:   node qa/smoke.mjs
// Env:     SMOKE_BASE       server url        (default http://localhost:5000)
//          SMOKE_CHROMIUM   chromium binary   (default: playwright's own)
// Server:  expects the smoke fixture DB (qa/smoke-fixture.sql.gz) — Landsec
//          d25ec158…, Bluewater cccccccc…-0001, personas below. No AI /
//          Microsoft / scraper keys required: those panels degrade politely
//          and their API errors are on the ignore list.

import { chromium } from '../node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const SHOTS = new URL('./smoke-shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const PASSWORD = 'B@nd0077!';
const STAFF = 'victoria@brucegillinghampollard.com';
const CLIENT = 'mark.warne@landsec.com';
const BLUEWATER = 'cccccccc-0000-0000-0000-000000000001';
const LANDSEC_CO = 'd25ec158-82df-4f50-8188-cae113af5f9f';   // Mark's scope company
const RIVAL_CO = '99999999-1111-1111-1111-111111111111';      // Hammerson
const RIVAL_PROPERTY = '99999999-2222-2222-2222-222222222222';
const BRAND_CO = '11110000-0000-0000-0000-000000000201';      // Starbucks fixture

// Environment noise, mirrored from two-bot-round — never a smoke failure.
const IGNORED_RESPONSES = [
  /\/api\/auth\/me$/,
  /\/api\/microsoft\//,
  /\/api\/chatbgp\/status/,
  /\/api\/hr\/photo\//,
  /\/api\/client\/sharepoint\//,
  /\/api\/ai-briefing/,
  /\/api\/brand\/[^/]+\/ai-take\//,
  /\/api\/brand\/[^/]+\/(competitors\/research|rocketreach-company\/refresh|pipnet-requirements|hunter-score|expansion-score)/,
  /\/api\/activity\/(deal|brand|landlord|contact|property)\//,
  /\/api\/news-feed\//,
  /\/api\/covenant\//,
  /\/api\/kyc\//,
  /\/api\/land-registry/,
  // Brand-gap AI panels + interaction summarise call Claude directly — no
  // key in CI, so they 500 by design here (same class as ai-briefing).
  /\/api\/property\/[^/]+\/brand-gaps\/(international|commentary)/,
  /\/api\/interactions\/[^/]+\/summarise/,
  /fonts|\.woff|\.map$/,
];

const failures = [];
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  if (ok) { console.log(`  ok  ${name}`); return; }
  failures.push({ name, detail });
  console.log(`  FAIL ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
}

function watchPage(page, label) {
  page.on('pageerror', (e) => check(`${label}: no uncaught page error`, false, e.message));
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/') || res.status() < 500) return;   // smoke gates on 5xx only
    if (IGNORED_RESPONSES.some((re) => re.test(url.split('?')[0]))) return;
    check(`${label}: no 5xx API responses`, false, `${res.status()} ${url.replace(BASE, '')}`);
  });
}

// Real form login — token injection doesn't hydrate the production build
// (secure-cookie sessions), and the form path is what users actually hit.
async function apiLogin(context, username) {
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const guest = page.locator('text=Client / guest sign in').first();
  if (await guest.count()) { await guest.click(); await page.waitForTimeout(500); }
  await page.locator('input[type="text"], input[type="email"]').first().fill(username);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.locator('input[type="password"]').first().waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => { throw new Error(`login form did not submit for ${username}`); });
  await page.waitForTimeout(2000);
  // Bearer token for the API-level scoping checks.
  const r = await context.request.post(`${BASE}/api/auth/login`, { data: { username, password: PASSWORD } });
  const user = await r.json().catch(() => ({}));
  if (!user.token) throw new Error(`token login failed for ${username}: HTTP ${r.status()}`);
  return { page, token: user.token };
}

async function apiGet(context, token, path) {
  const r = await context.request.get(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return r.status();
}

async function settle(page, ms = 6000) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function noCrash(page, label) {
  const boundary = await page.locator('text=/Something went wrong|component crashed/i').count();
  check(`${label}: no error boundary`, boundary === 0);
}

// Fresh containers ship chromium at /opt/pw-browsers/chromium but not the
// headless-shell build playwright's npm install expects — fall back to the
// preinstalled binary when the default launch can't find its browser.
let browser;
try {
  browser = await chromium.launch(
    process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {}
  );
} catch (err) {
  if (!process.env.SMOKE_CHROMIUM && existsSync('/opt/pw-browsers/chromium')) {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  } else {
    throw err;
  }
}

// ─── Staff — Victoria ─────────────────────────────────────────────────────
console.log('── staff (Victoria) ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let page, token;
  try { ({ page, token } = await apiLogin(ctx, STAFF)); check('staff: login', true); }
  catch (e) { check('staff: login', false, e.message); }

  if (page) {
    watchPage(page, 'staff');

    await settle(page);
    await noCrash(page, 'staff dashboard');
    await page.screenshot({ path: `${SHOTS}/staff-dashboard.png` }).catch(() => {});

    // Property page — the busiest surface in the app.
    await page.goto(`${BASE}/properties/${BLUEWATER}`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, 6000);
    await noCrash(page, 'staff property page');
    check('property: tenancy schedule renders', await page.locator('[data-testid="btn-open-letting-tracker"]').count() > 0);
    check('property: tracker strip renders', await page.locator('[data-testid="tracker-summary-strip"]').count() > 0);
    check('property: tracker card renders', await page.locator('[data-testid="tracker-summary-card"]').count() > 0);
    check('property: linked contacts panel', await page.locator('[data-testid="linked-contacts-panel"]').count() > 0);
    check('property: linked deals panel', await page.locator('[data-testid="deals-summary-card"]').count() > 0);
    check('property: activity board', await page.locator('[data-testid="activity-summary"]').count() > 0);
    await page.screenshot({ path: `${SHOTS}/staff-property.png` }).catch(() => {});

    // Tracker deep link lands filtered.
    await page.goto(`${BASE}/deals/letting?propertyId=${BLUEWATER}&status=AVA`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, 7000);
    await noCrash(page, 'staff letting tracker');
    const trackerRows = await page.locator('table tbody tr').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check('tracker: unit rows render', trackerRows);

    // Deals board deep link.
    await page.goto(`${BASE}/deals/list?propertyId=${BLUEWATER}`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page);
    await noCrash(page, 'staff deals board');
    const dealsChip = await page.locator('[data-testid="chip-property-filter"]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check('deals: property filter chip', dealsChip);

    // Properties board — strip + map header.
    await page.goto(`${BASE}/properties`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page);
    await noCrash(page, 'staff properties board');
    const propsHeader = await page.locator('[data-testid="properties-board-header"]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check('properties: board header (strip + map toggle)', propsHeader);

    // Brand profile — expansion intelligence + signals + key contacts.
    await page.goto(`${BASE}/companies/${BRAND_CO}`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, 9000);
    await noCrash(page, 'staff brand profile');
    const expZone = await page.locator('text=Expansion intelligence').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check('brand: expansion intelligence zone', expZone);
    const keyContacts = await page.locator('text=Key contacts').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check('brand: key contacts card', keyContacts);
    await page.screenshot({ path: `${SHOTS}/staff-brand.png` }).catch(() => {});

    // Tasks page.
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page);
    await noCrash(page, 'staff tasks');

    // Pathway board — its table is bootstrapped at runtime, so a fresh DB
    // used to 500 here until /api/portfolios had been opened once (r205).
    const pathway = await apiGet(ctx, token, `/api/property-pathway`);
    check('staff: property-pathway board API', pathway === 200, `HTTP ${pathway}`);
    const portfolios = await apiGet(ctx, token, `/api/portfolios`);
    check('staff: portfolios API', portfolios === 200, `HTTP ${portfolios}`);
  }
  await ctx.close();
}

// ─── Client — Mark Warne (Landsec) ────────────────────────────────────────
console.log('── client (Mark, Landsec) ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let page, token;
  try { ({ page, token } = await apiLogin(ctx, CLIENT)); check('client: login', true); }
  catch (e) { check('client: login', false, e.message); }

  if (page) {
    watchPage(page, 'client');

    await settle(page, 6000);
    await noCrash(page, 'client dashboard');
    check('client dashboard: portfolio section', await page.locator('[data-testid="portfolio-overview"]').count() > 0);
    check('client dashboard: tracker widget', await page.locator('[data-testid="available-units-widget"]').count() > 0);
    check('client dashboard: tasks widget', await page.locator('[data-testid="widget-my-tasks"]').count() > 0);
    check('client dashboard: activity board', await page.locator('[data-testid="activity-summary"]').count() > 0);
    check('client dashboard: team calendar', await page.locator('text=Team Calendar').count() > 0);
    check('client dashboard: properties & deals board', await page.locator('text=Properties & Deals').count() > 0);
    await page.screenshot({ path: `${SHOTS}/client-dashboard.png` }).catch(() => {});

    // Client property page — boards render, no internal team names in Files.
    await page.goto(`${BASE}/properties/${BLUEWATER}`, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, 6000);
    await noCrash(page, 'client property page');
    check('client property: tenancy schedule', await page.locator('[data-testid="btn-open-letting-tracker"]').count() > 0);
    check('client property: jailed files panel (no staff panel)', await page.locator('[data-testid="client-property-folders-panel"]').count() > 0);
    check('client property: no team-name folder tabs', await page.locator('[data-testid^="folder-team-tab-"]').count() === 0);
    await page.screenshot({ path: `${SHOTS}/client-property.png` }).catch(() => {});

    // Client letting activity: the scoped all-viewings branch used to return
    // snake_case rows, so the tracker's FY Viewings strip counted 0 for every
    // client (r205). Fixture ships one Gail's Bakery viewing on Bluewater.
    const vRes = await ctx.request.get(`${BASE}/api/available-units/all-viewings`, { headers: { Authorization: `Bearer ${token}` } });
    const vRows = vRes.ok() ? await vRes.json() : null;
    check('client: letting viewings feed camelCase',
      Array.isArray(vRows) && vRows.length > 0 && !!vRows[0].viewingDate,
      `rows=${Array.isArray(vRows) ? vRows.length : 'ERR'} firstKeys=${vRows?.[0] ? Object.keys(vRows[0]).slice(0, 4).join(',') : '-'}`);

    // Summarise scope must mirror feed visibility (r207): the Gail's — U124
    // meeting is deal-linked to the client's Bluewater portfolio (contact has
    // no company), so the client's auto-summarise used to 403 on a row their
    // own feed served. Short preview → deterministic skipped:true, no AI call.
    const sumRes = await ctx.request.post(
      `${BASE}/api/interactions/22220000-0000-0000-0000-000000000002/summarise`,
      { headers: { Authorization: `Bearer ${token}` } });
    check('client: summarise portfolio-linked interaction allowed', sumRes.status() === 200,
      `HTTP ${sumRes.status()}`);

    // ── Scoping guards — the checks that MUST fail closed ──
    check('scope: own portfolio property-summary allowed',
      await apiGet(ctx, token, `/api/crm/companies/${LANDSEC_CO}/property-summary?role=landlord`) === 200);
    check('scope: rival landlord property-summary denied',
      await apiGet(ctx, token, `/api/crm/companies/${RIVAL_CO}/property-summary?role=landlord`) === 403);
    check('scope: rival contact-summary denied',
      await apiGet(ctx, token, `/api/crm/companies/${RIVAL_CO}/contact-summary`) === 403);
    check('scope: rival activity-summary denied',
      await apiGet(ctx, token, `/api/activity-summary?companyId=${RIVAL_CO}`) === 403);
    check('scope: rival property activity denied',
      await apiGet(ctx, token, `/api/activity-summary?propertyId=${RIVAL_PROPERTY}`) === 403);
    const ownActivity = await apiGet(ctx, token, `/api/activity-summary`);
    check('scope: own activity feed allowed', ownActivity === 200, `HTTP ${ownActivity}`);
  }
  await ctx.close();
}

await browser.close();

// ─── O365 → tracker auto-collection (viewings + offers) ──────────────────
// Deterministic matcher/dedupe check against the fixture DB — the piece
// that silently produced zero tracker viewings in production. Needs direct
// DB access, so it only runs when DATABASE_URL is provided (CI does).
if (process.env.DATABASE_URL) {
  console.log('── tracker sync (viewings + offers) ──');
  const r = spawnSync('npx', ['tsx', new URL('./tracker-sync-check.ts', import.meta.url).pathname], {
    env: process.env, encoding: 'utf8', timeout: 120000,
  });
  if (r.stdout) process.stdout.write(r.stdout.split('\n').map(l => l ? '  ' + l : l).join('\n'));
  check('tracker sync: viewing + offer auto-collection', r.status === 0, r.status === 0 ? '' : (r.stderr || '').slice(0, 200));
} else {
  console.log('── tracker sync check skipped (no DATABASE_URL) ──');
}

console.log(`\n── smoke complete: ${checks} checks, ${failures.length} failure${failures.length === 1 ? '' : 's'} ──`);
for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
process.exit(failures.length === 0 ? 0 : 1);
