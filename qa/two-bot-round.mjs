// Two-persona QA harness — "Victoria" (BGP agent) × "Mark Warne" (Landsec client).
//
// Drives two logged-in browser sessions through real workflows at the same
// time, cross-checking that what the agent does shows up (or stays hidden)
// on the client side. Logs every console error, failed request, blank page,
// dead-end and broken flow to qa/logs/ as JSONL + screenshots.
//
// Usage:  node qa/two-bot-round.mjs [roundNumber]
// Server: expects the dev server on http://localhost:5000 with a fixture DB.
//         Entity IDs (Landsec, Bluewater, the in-slice brand) are resolved by
//         NAME at startup — see resolveFixture — so the harness works against
//         both the old dev fixture and qa/smoke-fixture.sql.gz. Unresolved
//         names fall back to the legacy dev-fixture IDs.

import { chromium } from '../node_modules/playwright/index.mjs';
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

// Chunked runs (600s foreground-exec cap, r447): QA_PERSONAS picks which
// persona rounds run; QA_CROSS_FILE persists the shared `cross` state between
// chunks so staff-creates → client-sees/rival-403 checks still line up.
const PERSONAS = (process.env.QA_PERSONAS || 'victoria,mark,woody,nick,sam')
  .split(',').map((s) => s.trim()).filter(Boolean);
const CROSS_FILE = process.env.QA_CROSS_FILE || '';

const BASE = 'http://localhost:5000';
const ROUND = parseInt(process.argv[2] || '1', 10);
const LOGDIR = new URL('./logs/', import.meta.url).pathname;
mkdirSync(LOGDIR, { recursive: true });

// Legacy dev-fixture IDs — the last-resort fallback when name resolution
// finds nothing (keeps the harness working on the old local fixture).
const LEGACY = {
  landsec: '11111111-1111-1111-1111-111111111111',
  bluewater: '22222222-2222-2222-2222-222222222222',
  brand: '77777777-7777-7777-7777-777777777777',
};
// Reassigned from resolveFixture at startup; page.evaluate bodies read the
// same values via window.QA_FIX (injected into every browser context).
let LANDSEC = LEGACY.landsec;
let BLUEWATER = LEGACY.bluewater;
let BRAND = LEGACY.brand;
let INTEL_BRAND = null; // brand with geocoded stores + AI competitors (Amorino on the smoke fixture)
const PASSWORD = 'B@nd0077!';
const AGENT_USER = 'victoria@brucegillinghampollard.com';
const CLIENT_USER = 'mark.warne@landsec.com';

// Requests that fail by design or are environment noise — not app bugs.
const IGNORED_RESPONSES = [
  /\/api\/auth\/me$/,                    // 401 before login hydrates
  /\/api\/microsoft\//,                  // no M365 creds locally
  /\/api\/chatbgp\/status/,              // no AI key locally
  /\/api\/hr\/photo\//,                  // 404 = no photo; UI hides the img
  /\/api\/client\/sharepoint\//,         // 404 locally = no Graph creds/folder; the panel's fallback is the pass state (403 regressions still caught by client-sharepoint-surface)
  /\/api\/ai-briefing/,                  // 503 locally (no AI key) by design
  /\/api\/brand\/[^/]+\/ai-take\//,      // 503 locally (no AI key) by design
  /\/api\/brand\/[^/]+\/(competitors\/research|rocketreach-company\/refresh)/, // 503 locally, no keys
  /\/api\/property\/[^/]+\/brand-gaps\/(commentary|international|live-intel)/, // Brand Gap v2 AI reads — 500/503 locally with no AI key (the base /brand-gaps is keyless and stays checked); works in prod. The scope gate is covered by client-brand-gaps-scoped.
  /\/api\/properties\/[^/]+\/brochures\/[^/]+\/cover/, // cover raster 422s locally — no pdftoppm binary in the QA container (spawn ENOENT); the tile falls back to its iframe embed. Renders fine in prod.
  /\/api\/activity\/(brand|landlord)\/[^/]+$/, // AI relationship activity: own company + slice brands return 200 for clients since r215 (gateway now honours the 2026-08-04 parity decision); anything else 403s. client-interactions-guard is the authoritative lock either way.
  /\/api\/hr\/staff$/,                   // guard-mount race (r464): the client-nav scenario deliberately opens /hr as a client; ClientRouteGuard bounces in a useEffect AFTER HRPage mounts, so the page's staff-directory query can fire once and 403 (correctly) before the bounce — lands only when the lazy chunk compiles fast enough, flipping the mark signature 9↔10. Staff coverage lives in staff-hr-directory-full-shape (asserts 200 + full shape), so ignoring the URL here masks nothing.
  /\/api\/interactions\//,               // correspondence drawer: own company + slice brands are client-readable (Woody, 2026-08-04 — restored r215); rival/summary/leaderboard stay 403. The client-interactions-guard scenario is the authoritative lock.
  /\/api\/covenant\//,                    // covenant engine (credit analysis) is staff-only — the client covenant badge fires /api/covenant/by-crm/:id and gets a safe 403. client-covenant-guard is the authoritative lock.
  /fonts|\.woff|\.map$/,
];

const issues = [];
function logIssue(persona, scenario, kind, detail) {
  const row = { ts: new Date().toISOString(), round: ROUND, persona, scenario, kind, detail };
  issues.push(row);
  appendFileSync(`${LOGDIR}/round-${ROUND}.jsonl`, JSON.stringify(row) + '\n');
  console.log(`  [ISSUE] ${persona} · ${scenario} · ${kind}: ${String(detail).slice(0, 180)}`);
}

let currentScenario = { victoria: 'startup', mark: 'startup' };

// Scenarios that deliberately provoke 4xx to prove a guard holds. A refusal
// there is the PASS condition, so don't log it as an app issue.
const NEGATIVE_PROBE_SCENARIOS = new Set(['client-destructive-guards', 'client-bulk-mutation-guard', 'client-crm-ingest-guard', 'client-add-delete-unit', 'client-hots-roundtrip', 'client-deal-audit-scope', 'client-foreign-unit-guards', 'client-info-sheet-roundtrip', 'rival-client-write-guards', 'rival-team-board-isolated', 'client-staff-deal-ops-guards', 'client-brand-slice-and-extras', 'client-requirements-write-guards', 'client-contact-scope-guards', 'client-unit-matches', 'client-brand-suggestions-scoped', 'client-brand-suggested-pitches-scoped', 'client-news-write-guards', 'client-contact-edit-not-delete', 'client-requirement-scoping', 'client-password-reset-guard', 'client-commentary-own-property', 'client-plans-board-scoped', 'client-brand-gaps-scoped', 'client-task-assign-guard', 'client-lease-events-guard', 'client-firm-reporting-guard', 'client-deal-report-guard', 'client-mailbox-guard', 'client-firm-internal-guard', 'client-expenses-guard', 'client-property-tenants-scoped', 'client-property-put-guard', 'client-available-unit-read-scoped', 'client-detail-by-id-scoped', 'client-contact-override-scoped', 'client-portfolio-rollup-scoped', 'client-tasks-board-scoped', 'client-tenancy-export-scoped', 'client-tenancy-write-scoped', 'client-tenancy-staff-ops-guard', 'client-insights-scoped', 'client-interactions-guard', 'client-hunters-guard', 'client-leads-guard', 'client-news-intel-guard', 'client-document-briefs-guard', 'client-wip-report-guard', 'client-agent-directory-tenant-rep', 'client-property-pathway-guard', 'client-chat-delete-own-only', 'client-chat-thread-read-isolation', 'client-brand-kyc-visible-actions-blocked', 'client-kyc-board-guard', 'client-pi-investigator-hidden', 'client-pi-lookup-open', 'client-covenant-guard', 'client-crm-truth-engine-guard', 'client-apollo-enrichment-scope', 'client-sharepoint-surface', 'client-sharepoint-write-guard', 'client-nav-guard-consistency', 'client-investment-deeplink-guard', 'rival-viewing-offer-patch-guard', 'rival-unit-interest-guard', 'rival-comp-files-and-reqinv-guard', 'rival-chat-media-and-deal-subreads-guard', 'client-image-assign-scope-guard', 'client-image-bytes-scoped', 'client-map-layer-scope', 'client-brief-target-scope', 'client-property-units-scoped', 'client-contact-detail-gates', 'client-comps-readonly', 'staff-ai-failure-terminal', 'staff-deal-verdict-flow', 'client-mobile-chat-error-prompt', 'client-turnover-slice-guard', 'client-plans-write-controls-hidden', 'staff-cashflow-board', 'staff-historical-wip-gate', 'staff-lrbg-status-client-order-guard', 'staff-crm-leads-and-packs-kept']);

function attachCollectors(page, persona) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/net::|Failed to load resource/.test(t)) return; // captured via response hook
      // External map providers (OS Places/NGD, Overpass) need API keys that
      // aren't set locally, and their tile/site fetches abort when a test hops
      // routes mid-request — benign env noise, not an app fault. (Internal
      // "[map] …" errors like CRM-pin/PDF failures are NOT suppressed.)
      if (/\[(os-sites|os-buildings)\] (fetch error|Reverse geocode error)|\[edozo\] Overpass error/i.test(t)) return;
      logIssue(persona, currentScenario[persona], 'console-error', t);
    }
  });
  page.on('pageerror', (e) => logIssue(persona, currentScenario[persona], 'page-error', e.message));
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (res.status() < 400) return;
    if (NEGATIVE_PROBE_SCENARIOS.has(currentScenario[persona])) return;
    if (IGNORED_RESPONSES.some((re) => re.test(url.split('?')[0]))) return;
    logIssue(persona, currentScenario[persona], `http-${res.status()}`, `${res.request().method()} ${url.replace(BASE, '')}`);
  });
}

async function login(context, username) {
  const r = await context.request.post(`${BASE}/api/auth/login`, { data: { username, password: PASSWORD } });
  const user = await r.json();
  if (!user.token) throw new Error(`login failed for ${username}: ${JSON.stringify(user).slice(0, 120)}`);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('authToken', tok);
    localStorage.setItem('user', JSON.stringify(u));
  }, [user.token, user]);
  page.qaToken = user.token; // node-side API access for the same session
  return page;
}

// The committed smoke fixture and the old dev fixture use different IDs for
// the same entities. Resolve them by name through the staff API so every
// scenario targets the right rows whichever DB is loaded. Runs in NODE with
// the login token — a page.evaluate here races the app's auth-hydration
// navigation, which aborts the fetches and silently falls back to legacy.
async function resolveFixture(token) {
  const auth = { Authorization: 'Bearer ' + token };
  const list = async (url) => {
    try {
      const r = await fetch(`${BASE}${url}`, { headers: auth });
      if (!r.ok) return [];
      const b = await r.json();
      return Array.isArray(b) ? b : (b?.data || []);
    } catch { return []; }
  };
  const companies = await list('/api/crm/companies');
  const landsec = companies.find((c) => /^landsec$/i.test(c.name || ''))
    || companies.find((c) => /landsec/i.test(c.name || '') && /landlord/i.test(c.companyType || ''));
  // Any in-slice (hospitality) brand works for the slice/profile scenarios;
  // prefer the old fixture's Honi Poke when it exists (seed-personas creates
  // it where absent).
  const brand = companies.find((c) => /^honi poke$/i.test(c.name || ''))
    || companies.find((c) => /restaurant|casual dining|fine dining|caf/i.test(c.companyType || '') && !/^testco/i.test(c.name || ''));
  // Intel-cards scenario target: a brand with geocoded stores (Amorino on
  // the smoke fixture); null lets the scenario fall back to the slice brand.
  const intelBrand = companies.find((c) => /^amorino$/i.test(c.name || ''));
  const properties = await list('/api/crm/properties');
  const bluewater = properties.find((p) => /bluewater/i.test(p.name || '') && (!landsec || p.landlordId === landsec.id))
    || properties.find((p) => /bluewater/i.test(p.name || ''));
  return {
    landsec: landsec?.id || LEGACY.landsec,
    bluewater: bluewater?.id || LEGACY.bluewater,
    brand: brand?.id || LEGACY.brand,
    intelBrand: intelBrand?.id || null,
  };
}

async function visit(page, persona, path, label) {
  currentScenario[persona] = `visit ${path}`;
  // Hub routes (e.g. /investment-tracker) client-side-redirect on mount,
  // which aborts the original navigation — not an app failure.
  await page.goto(`${BASE}${path}`).catch((e) => {
    if (!/ERR_ABORTED/.test(String(e))) throw e;
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  const notFound = await page.getByText('Page not found').count();
  if (notFound) logIssue(persona, `visit ${path}`, 'dead-route', `${label || path} renders "Page not found"`);
  let bodyText = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
  // Hub routes (/investment-tracker et al.) redirect on mount, then the target
  // hydrates — the innerText can be momentarily empty just past networkidle.
  // Give a slow render one more chance before calling the page blank, so a
  // timing hiccup isn't logged as a broken page.
  if (bodyText.length < 30) {
    await page.waitForTimeout(2500);
    bodyText = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
  }
  if (bodyText.length < 30) {
    await page.screenshot({ path: `${LOGDIR}/r${ROUND}-${persona}-blank-${path.replace(/\W+/g, '_')}.png` });
    logIssue(persona, `visit ${path}`, 'blank-page', `${label || path} rendered <30 chars of content`);
  }
}

// r273: goto for the dedicated mobile contexts — right after localStorage
// auth is planted on "/", the app's hydration can issue a redirect-on-mount
// that aborts the NEXT navigation (the r204 class; flaked once under round
// load as ERR_ABORTED at /requirements). Retry once so the page really lands
// on the target instead of swallowing the abort and asserting elsewhere.
// r320: the same race also surfaces as Playwright's "is interrupted by
// another navigation" wording (seen at /properties/:id) — retry that too.
// Seed the desktop session's token into a fresh mobile context. The app can
// navigate on mount (auth hydration redirect), destroying the evaluate's
// execution context mid-flight — retry on that instead of failing the step.
async function mobSeedAuth(mob, page) {
  const tok = await page.evaluate(() => localStorage.getItem('authToken'));
  const u = await page.evaluate(() => localStorage.getItem('user'));
  for (let attempt = 0; ; attempt++) {
    try {
      await mob.evaluate(([t, usr]) => {
        localStorage.setItem('authToken', t); localStorage.setItem('user', usr);
      }, [tok, u]);
      return;
    } catch (e) {
      if (attempt >= 2 || !/Execution context was destroyed|Cannot find context/.test(String(e))) throw e;
      await mob.waitForLoadState('domcontentloaded').catch(() => {});
      await mob.waitForTimeout(500);
    }
  }
}

async function mobGoto(pg, url, nav) {
  try {
    await pg.goto(url, nav);
  } catch (e) {
    if (!/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
    await pg.waitForTimeout(1000);
    await pg.goto(url, nav);
  }
}

async function step(page, persona, scenario, fn) {
  currentScenario[persona] = scenario;
  if (process.env.QA_DEBUG) console.log(`  [dbg ${new Date().toISOString()}] step ${scenario}`);
  try {
    await fn();
    console.log(`  [ok] ${persona} · ${scenario}`);
    return true;
  } catch (e) {
    await page.screenshot({ path: `${LOGDIR}/r${ROUND}-${persona}-fail-${scenario.replace(/\W+/g, '_')}.png` }).catch(() => {});
    logIssue(persona, scenario, 'flow-failure', e.message?.split('\n')[0]);
    return false;
  }
}

// ─── Personas ─────────────────────────────────────────────────────────────

async function victoriaRound(page, cross) {
  const p = 'victoria';
  const stamp = `QA-R${ROUND}-${Math.random().toString(36).slice(2, 6)}`;
  cross.dealStamp = stamp;

  // 1. Crawl the staff surface (staff CRM hub lives at /contacts)
  for (const path of ['/', '/deals', '/leasing-schedule', '/brands', `/companies/${LANDSEC}`, '/contacts', '/comps', '/news', '/tasks', '/wip-report', '/hr']) {
    await visit(page, p, path);
  }

  // 2. Create a deal through the real dialog. The /deals hub defaults to the
  //    WIP Report tab, so switch to Deals first. We use the "Consultant" deal
  //    type — the one create body that needs no property/counterparty picker,
  //    just name + fee + completion date — so the flow is scriptable end to
  //    end (create → appears in list).
  await step(page, p, 'create-deal', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /^Deals$/ }).first().click().catch(async () => {
      await page.getByText('Deals', { exact: true }).first().click();
    });
    await page.waitForTimeout(1200);
    await page.locator('[data-testid="button-create-deal"]').first().click();
    await page.waitForTimeout(600);
    // Pick Consultant so the fee-only body (with the required completion
    // date) renders.
    await page.locator('[data-testid="select-deal-type"]').click();
    await page.waitForTimeout(300);
    await page.getByRole('option', { name: 'Consultant' }).click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="input-deal-name"]').fill(`${stamp} Consultancy — Landsec`);
    // Leave the fee blank at creation — it's editable on the board later, and
    // entering it without an agent split would 400 the fee-allocations save
    // (BGP House 15% row required). A real user uses the split editor.
    // Completion date is a month picker on JOGQK (WIP report buckets by
    // month); older builds use a day input — fill whichever format the
    // rendered input expects.
    const targetDate = page.locator('[data-testid="input-deal-target-date"]');
    await targetDate.fill((await targetDate.getAttribute('type')) === 'month' ? '2026-12' : '2026-12-31');
    await page.locator('[data-testid="button-save-deal"]').click();
    await page.waitForTimeout(1800);
    // Verify via the API, not the deals table (the table is team-filtered).
    // Since r309 the create dialog seeds the creator's own team when no
    // auto-team rule fires (Consultant/New Letting class) — assert the
    // created deal carries it, else it vanishes from the creator's default
    // team-filtered view the moment it's created.
    const check = await page.evaluate(async (needle) => {
      const r = await fetch('/api/crm/deals', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      if (!r.ok) return { ok: false, status: r.status };
      const deals = await r.json();
      const deal = deals.find((d) => (d.name || '').includes(needle));
      return { ok: true, found: !!deal, team: deal ? deal.team : null };
    }, `${stamp} Consultancy`);
    if (!check.ok) throw new Error(`deals API returned ${check.status} after create`);
    if (!check.found) throw new Error('deal saved (toast shown) but absent from /api/crm/deals');
    const teams = Array.isArray(check.team) ? check.team : check.team ? [check.team] : [];
    if (!teams.length) throw new Error('created deal has no team — it is invisible in the creator\'s team-filtered deals list (r309 seeding regressed)');
  });

  // 3. Letting tracker: open the first property, flip a status band
  await step(page, p, 'tracker-status-band', async () => {
    await page.goto(`${BASE}/leasing-schedule`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    let band = page.locator('[data-testid^="inline-statusband-"]').first();
    if (!(await band.count())) {
      // Cards view — click into the first property to reach the unit rows
      await page.getByText('Bluewater', { exact: false }).first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      band = page.locator('[data-testid^="inline-statusband-"]').first();
    }
    if (!(await band.count())) throw new Error('no status-band cell found on tracker');
    await band.click();
    await page.waitForTimeout(400);
    const option = page.locator('[data-testid^="statusband-option-"]').first();
    await option.click();
    await page.waitForTimeout(800);
  });

  // 4. Landsec team board: add + remove a member (full cycle)
  await step(page, p, 'team-board-add-remove', async () => {
    await page.goto(`${BASE}/companies/${LANDSEC}`);
    // domcontentloaded — the profile polls (scrape status etc.), networkidle
    // can burn the full 30s and fail the step spuriously.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const addBtn = page.locator('[data-testid="btn-add-team-member"]');
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(800);
    const candidate = page.locator('[data-testid^="add-member-candidate-"]').first();
    if (!(await candidate.count())) throw new Error('no candidates offered in Add-to-team');
    const addedId = (await candidate.getAttribute('data-testid') || '').replace('add-member-candidate-', '');
    await candidate.click();
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    // REMOVE what we added. Without this the scenario added one member every
    // round and never took it back, silently inflating the Landsec account
    // board (35 curated rows locally) and skewing every count that reads it.
    if (addedId) {
      const removed = await page.evaluate(async ([cid, uid]) => {
        const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
        const rows = await (await fetch(`/api/client-teams/${cid}`, { headers: auth })).json();
        const row = (Array.isArray(rows) ? rows : []).find((m) => String(m.user_id) === String(uid));
        if (!row) return false;
        const r = await fetch(`/api/client-teams/member/${row.id}`, {
          method: 'DELETE', credentials: 'include', headers: auth,
        });
        return r.ok;
      }, [LANDSEC, addedId]);
      if (!removed) throw new Error('added a team member but could not remove it again (add/remove cycle incomplete)');
    }
  });

  // 4b. Switching the team picker to a CLIENT team must put the agent into
  // that client's exact view (nav trims, scope set, "Viewing as" banner), and
  // Exit must restore the full staff view. Woody: "everyone needs the ability
  // to switch to it... we see what they see." Previously the switch only
  // re-branded the UI and looked like it did nothing.
  await step(page, p, 'staff-switch-to-client-view', async () => {
    const scope = () => page.evaluate(async () => {
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      return (await r.json()).companyScopeId || null;
    });
    // Start from the agent's own team so the assertion is honest.
    await page.evaluate(async () => {
      await fetch('/api/auth/active-team', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') },
        body: JSON.stringify({ team: 'all' }),
      });
    });
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    if (await scope()) throw new Error('agent already scoped to a client before switching');
    if (!(await page.locator('[data-testid="button-team-switcher"]').count())) throw new Error('no team switcher for staff');

    await page.locator('[data-testid="button-team-switcher"]').click();
    await page.waitForTimeout(700);
    await page.locator('[data-testid="menu-team-landsec"]').click();
    await page.waitForTimeout(3500);
    if (!(await scope())) throw new Error('switching to the Landsec team did not scope the session to the client view');
    const exit = page.locator('[data-testid="button-exit-client-view"]');
    if (!(await exit.count())) throw new Error('no "Viewing as" banner / exit while in client view — staff would be trapped');
    if (!(await page.locator('[data-testid="button-team-switcher"]').count())) throw new Error('team switcher vanished in client view — no way back');

    await exit.first().click();
    await page.waitForTimeout(3000);
    if (await scope()) throw new Error('Exit did not restore the full staff view');
  });

  // 4c. Agent creates a leasing requirement via the API, confirms it lands on
  // the requirements board, then cleans up. Stamped so the client round can
  // cross-check what it does/doesn't see.
  await step(page, p, 'agent-create-requirement', async () => {
    const stamp = `QA-REQ-R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/crm/requirements-leasing', {
        method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, status: 'Active' }),
      });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json().catch(() => ({}));
      const list = await (await fetch('/api/crm/requirements-leasing', { headers: auth })).json();
      const rows = Array.isArray(list) ? list : (list?.data || []);
      return { ok: true, id: made?.id, found: rows.some(x => JSON.stringify(x).includes(needle)) };
    }, stamp);
    if (!r.ok) throw new Error(r.why);
    if (!r.found) throw new Error('created requirement absent from the requirements board');
    cross.reqStamp = stamp;
    // Keep the requirement ALIVE so the client round can prove API-level
    // gating against a live row (not one already deleted). Swept next round
    // by the run-round.sh 'QA-REQ%' cleanup.
    cross.reqId = r.id || null;
  });

  // 4d. Calendar team pills: picking a CLIENT team must filter the board to
  // that client's events. It used to filter BGP staff by users.team, which no
  // client team matches, so clicking "Landsec" did nothing / emptied it.
  await step(page, p, 'calendar-client-team-filter', async () => {
    const mine = `QA-CAL-MINE-R${ROUND}`, other = `QA-CAL-OTHER-R${ROUND}`;
    // The event must be in the FUTURE (GET /api/team-events only returns
    // start_time >= now) AND still on today's visible board (a "+2h" event
    // crossed midnight on a late round and vanished). It also has to STAY
    // future until the client round cross-checks it minutes later — +2min
    // expired before Mark's check and false-alarmed as a scoping regression.
    // now+30min covers both; skip the round in the half-hour before midnight.
    const soon = new Date(Date.now() + 30 * 60e3);
    if (soon.getUTCDate() !== new Date().getUTCDate()) return;
    await page.evaluate(async ([a, bb, startIso, endIso]) => {
      const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      for (const [title, company] of [[a, 'Landsec'], [bb, 'Hammerson']]) {
        await fetch('/api/team-events', { method: 'POST', credentials: 'include', headers: h,
          body: JSON.stringify({ title, event_type: 'Meetings', company_name: company,
            start_time: startIso, end_time: endIso,
            // Attendees ride the event so the client round can assert the
            // who-is-attending pipeline (stored -> served -> parsed).
            attendees: ['Mark Warne <mark.warne@landsec.com>', 'Victoria Steele <victoria@brucegillinghampollard.com>'] }) }).catch(() => {});
      }
    }, [mine, other, soon.toISOString(), new Date(soon.getTime() + 36e5).toISOString()]);
    // Stamp for the client round: Mark's calendar must show the Landsec
    // event and never the Hammerson one (the surface Woody reported dead).
    cross.calMine = mine;
    cross.calOther = other;
    // GET /api/team-events only serves start_time >= now, so the cross-check
    // is only meaningful while the seeded event is still in the future. A
    // mark chunk re-run later in the round (r526) read the expired event as
    // a scoping regression — stamp the deadline so it skips instead.
    cross.calValidUntil = soon.toISOString();
    await page.goto(`${BASE}/calendar`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);
    const chip = page.locator('[data-testid="team-pill-landsec"]');
    if (!(await chip.count())) throw new Error('no Landsec team pill on the calendar');
    const seenBefore = await page.getByText(other, { exact: false }).count();
    await chip.click();
    await page.waitForTimeout(3500);
    const mineAfter = await page.getByText(mine, { exact: false }).count();
    const otherAfter = await page.getByText(other, { exact: false }).count();
    // Only assert the exclusion when the control event was actually on the board.
    if (seenBefore && otherAfter) throw new Error("another client's event still shown after selecting the Landsec team");
    if (!mineAfter) throw new Error('Landsec event missing after selecting the Landsec team');
  });

  // 4f. Staff dashboard at phone width must not overflow horizontally.
  await step(page, p, 'staff-mobile-no-overflow', async () => {
    const mob = await page.context().newPage();
    try {
      await mob.setViewportSize({ width: 390, height: 780 });
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mob.goto(`${BASE}/`, nav);
      await mob.waitForTimeout(3500);
      const { scrollW, clientW } = await mob.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (scrollW > clientW + 4) throw new Error(`staff dashboard overflows on mobile: scrollWidth ${scrollW} > viewport ${clientW}`);
    } finally {
      await mob.close();
    }
  });

  // r522: the turnover BY BRAND group header crushed the brand name to a
  // one-character truncate at 390px (name span was flex-1 min-w-0 while the
  // stats + Find Stores button never shrank). The name now keeps min-w-[8rem]
  // so the trailing items wrap below it — assert it stays readable and the
  // page still fits the phone.
  await step(page, p, 'staff-turnover-bybrand-mobile-names', async () => {
    const mob = await page.context().newPage();
    try {
      await mob.setViewportSize({ width: 390, height: 780 });
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mob.goto(`${BASE}/turnover`, nav);
      await mob.waitForTimeout(3500);
      await mob.getByText(/by brand/i).first().click();
      await mob.waitForTimeout(1500);
      const names = mob.locator('[data-testid="text-brand-group-name"]');
      if (!(await names.count())) throw new Error('BY BRAND view rendered no brand-group rows');
      const w = await names.first().evaluate((el) => el.getBoundingClientRect().width);
      if (w < 96) throw new Error(`brand-group name squeezed to ${Math.round(w)}px at 390px (min-w regression)`);
      const { scrollW, clientW } = await mob.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (scrollW > clientW + 4) throw new Error(`turnover BY BRAND overflows on mobile: ${scrollW} > ${clientW}`);
    } finally {
      await mob.close();
    }
  });

  // r524: the tracker's zero-result empty state ("No units match filters.")
  // was centred across the FULL 2600px table width, so at 1440px it rendered
  // ~370px past the visible scroller — users saw a blank grey table. The
  // message is now pinned to the visible viewport (sticky left-0 wrapper);
  // assert it stays on-screen when a filter matches nothing.
  await step(page, p, 'staff-tracker-empty-state-visible', async () => {
    await page.goto(`${BASE}/available`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    const search = page.locator('input[placeholder*="earch" i]').first();
    if (!(await search.count())) throw new Error('tracker search input missing');
    await search.fill('QA-ZZZ-NO-SUCH-UNIT');
    await page.waitForTimeout(1200);
    const empty = page.locator('[data-testid="tracker-empty-state"]');
    if (!(await empty.count())) throw new Error('zero-result tracker shows no empty-state message');
    const box = await empty.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, w: b.width, vw: window.innerWidth };
    });
    if (box.x < 0 || box.x + Math.min(box.w, 200) > box.vw) {
      throw new Error(`tracker empty state off-screen: x=${Math.round(box.x)} w=${Math.round(box.w)} viewport=${box.vw}`);
    }
    await search.fill('');
    await page.waitForTimeout(800);
  });

  // r411: the staff cold-open lands on /chatbgp, which renders the Messages
  // list — the bottom nav must light the Messages tab there (it shipped with
  // no tab active, leaving the cold-open screen unanchored). Needs real
  // phone emulation: the /chatbgp → MobileApp branch is gated on useIsMobile.
  await step(page, p, 'staff-mobile-chat-home-nav', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/chatbgp`, nav);
      await mob.waitForTimeout(3000);
      const messages = mob.locator('[data-testid="bottom-nav-messages"]');
      if (!(await messages.count())) throw new Error('bottom nav missing on /chatbgp at 390px');
      const cls = await messages.getAttribute('class');
      if (!/\btext-foreground\b/.test(cls || '')) throw new Error('/chatbgp cold-open does not light the Messages tab');
      const dashCls = await mob.locator('[data-testid="bottom-nav-dashboard"]').getAttribute('class');
      if (/\btext-foreground\b/.test(dashCls || '')) throw new Error('/chatbgp lights the Dashboard tab too');
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r440: the tracker's Add Available Unit dialog overflowed the 390px
  // phone — the "Show all fields (…)" ghost button's whitespace-nowrap label
  // forced a 556px min-content column, so the whole form h-scrolled. The
  // button now wraps; assert the dialog never exceeds its own box again.
  await step(page, p, 'staff-mobile-add-unit-dialog', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/available`, nav);
      await mob.waitForTimeout(3500);
      await mob.locator('button:has-text("Add unit")').first().click();
      await mob.waitForTimeout(1200);
      const dlg = mob.locator('[role="dialog"]').last();
      if (!(await dlg.count())) throw new Error('Add unit dialog did not open at 390px');
      const m = await dlg.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      if (m.sw > m.cw + 4) throw new Error(`Add unit dialog overflows at 390px: scrollWidth ${m.sw} > ${m.cw}`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r448: the fullHeight PageLayout header actions row had no flex-wrap, so
  // Image Studio's Upload button sat entirely off-screen at 390px (clipped,
  // not scrollable — untappable on a phone). The row wraps now; assert the
  // Upload button lands inside the viewport.
  await step(page, p, 'staff-mobile-page-actions-reachable', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/image-studio`, nav);
      await mob.waitForTimeout(3500);
      const m = await mob.evaluate(() => {
        const btn = document.querySelector('[data-testid="button-upload"]');
        if (!btn) return { missing: true };
        const r = btn.getBoundingClientRect();
        return { left: r.left, right: r.right, iw: window.innerWidth };
      });
      if (m.missing) throw new Error('Image Studio Upload button not rendered at 390px');
      if (m.right > m.iw + 4 || m.left < -4) throw new Error(`Image Studio Upload button off-screen at 390px: left ${Math.round(m.left)} right ${Math.round(m.right)} viewport ${m.iw}`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // 4e. The retired Leasing Schedule shows its archived banner and the
  // banner's Letting Tracker link goes somewhere real (it shipped pointing
  // at /available-units, which has no route).
  await step(page, p, 'leasing-archived-banner', async () => {
    await page.goto(`${BASE}/leasing-schedule`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    if (!(await page.getByText('This board is retired', { exact: false }).count())) return; // banner not on this view
    const link = page.getByRole('link', { name: 'Letting Tracker' }).first();
    if (!(await link.count())) throw new Error('archived banner has no Letting Tracker link');
    await link.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    if (await page.getByText('Page not found').count()) throw new Error('archived-banner Letting Tracker link is a dead route');
  });

  // 4g. Staff contact lifecycle: create a contact, see it in the CRM list,
  // delete it, confirm it's gone (delete was previously untested).
  await step(page, p, 'staff-contact-create-delete', async () => {
    const name = `QA Contact R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const create = await fetch('/api/crm/contacts', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, role: 'QA probe' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      const del = await fetch(`/api/crm/contacts/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `delete ${del.status}` };
      const list = await (await fetch('/api/crm/contacts', { headers: auth })).json();
      const rows = Array.isArray(list) ? list : (list?.data || []);
      // Match by id, not name — mark's client-add-contact creates a contact
      // with the same round name and back-to-back runs without run-round.sh's
      // 'QA Contact%' purge left it behind, false-failing this check (r379).
      return { ok: true, stillThere: rows.some((c) => c.id === made.id) };
    }, name);
    if (!r.ok) throw new Error(`contact lifecycle failed (${r.why})`);
    if (r.stillThere) throw new Error('deleted contact still present in the CRM list');
  });

  // Tracker interest lifecycle (UX #71 / r347 mobile-card fix): a manual
  // "rang about this unit" interest logs against a unit, shows in the
  // per-unit list and the all-interest-counts badge map, then deletes clean.
  await step(page, p, 'staff-unit-interest-lifecycle', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : [])[0];
      if (!unit) return { ok: true, skipped: true };
      const create = await fetch(`/api/available-units/${unit.id}/interest`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: 'QA-PROBE Interest Co', notes: 'QA probe — rang about this unit' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      const list = await (await fetch(`/api/available-units/${unit.id}/interest`, { headers: auth })).json();
      const inList = (Array.isArray(list) ? list : []).some((i) => i.id === made.id);
      const counts = await (await fetch('/api/available-units/all-interest-counts', { headers: auth })).json();
      const counted = (counts?.[unit.id] || 0) > 0;
      const del = await fetch(`/api/available-units/interest/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `delete ${del.status}` };
      const after = await (await fetch(`/api/available-units/${unit.id}/interest`, { headers: auth })).json();
      const residue = (Array.isArray(after) ? after : []).some((i) => i.id === made.id);
      return { ok: true, inList, counted, residue };
    });
    if (!r.ok) throw new Error(`interest lifecycle failed (${r.why})`);
    if (r.skipped) return;
    if (!r.inList) throw new Error('logged interest missing from the per-unit interest list');
    if (!r.counted) throw new Error('logged interest not reflected in all-interest-counts');
    if (r.residue) throw new Error('deleted interest row still present');
  });

  // Staff task board: create → complete (PATCH) → delete round-trips, and the
  // task is user-scoped (a completed then deleted task leaves no residue).
  // Staff deal-board stage move: drag-between-stages persists (the client
  // 403 guard is covered elsewhere; this is the STAFF happy path). Uses the
  // Bluewater fixture deal and restores its original status after.
  await step(page, p, 'staff-deal-stage-move', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const deal = (Array.isArray(deals) ? deals : []).find((d) => /bluewater/i.test(d.name || ''));
      if (!deal) return { skip: true };
      const original = deal.status;
      const move = await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ status: 'UO' }) });
      if (!move.ok) return { ok: false, why: `stage PUT ${move.status}` };
      const after = await (await fetch(`/api/crm/deals/${deal.id}`, { headers: auth })).json();
      const moved = after?.status === 'UO';
      // Restoring INTO SOL/EXC/COM/INV re-fires the AML counterparty gate
      // (409 when the fixture deal has no KYC-approved counterparties), so
      // restore with the documented MLRO override, then put the override
      // flag back so the fixture is untouched.
      const gated = ['SOL', 'EXC', 'COM', 'INV'].includes(original);
      const restoreBody = gated ? { status: original, amlCheckCompleted: 'YES' } : { status: original };
      await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify(restoreBody) }).catch(() => {});
      if (gated && deal.amlCheckCompleted !== 'YES') {
        await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
          body: JSON.stringify({ amlCheckCompleted: deal.amlCheckCompleted ?? null }) }).catch(() => {});
      }
      const restored = await (await fetch(`/api/crm/deals/${deal.id}`, { headers: auth })).json();
      return { ok: true, moved, restoredStatus: restored?.status, original };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`staff stage move rejected (${r.why})`);
    if (!r.moved) throw new Error('stage move returned OK but the deal did not change stage');
    if (r.restoredStatus !== r.original) throw new Error(`fixture deal stuck in UO (restore failed: ${r.restoredStatus})`);
  });

  // MLR scope suggestion on deal detail: must 200 with a suggestion, never
  // 500 (r237: the route SELECTed non-existent monthly_rent/annual_rent
  // columns, so every staff deal-detail open fired a raw 500).
  await step(page, p, 'staff-deal-mlr-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const deal = (Array.isArray(deals) ? deals : []).find((d) => /bluewater/i.test(d.name || ''));
      if (!deal) return { skip: true };
      const res = await fetch(`/api/aml/deal/${deal.id}/mlr-scope`, { headers: auth });
      const body = res.ok ? await res.json().catch(() => null) : null;
      return { skip: false, status: res.status, hasSuggestion: !!body?.suggestion?.suggestedScope };
    });
    if (r.skip) return;
    if (r.status !== 200) throw new Error(`mlr-scope GET ${r.status} (must be 200, never 500)`);
    if (!r.hasSuggestion) throw new Error('mlr-scope 200 but no suggestion payload');
  });

  // Map goad layers under concurrency (r336): retail-units + occupier-plan
  // fire together from the map page; on a fresh DB both used to race
  // ensureGoadTables' CREATE TABLE and one 500'd (duplicate pg_type). The
  // fixture ships no goad_units, so the first pair here exercises the race.
  await step(page, p, 'staff-map-goad-concurrent', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const bbox = 'bbox=51.512,-0.145,51.516,-0.138';
      const hit = (path) => fetch(`${path}?${bbox}`, { headers: auth }).then((x) => x.status).catch(() => 0);
      const statuses = await Promise.all([
        hit('/api/map/retail-units'), hit('/api/map/occupier-plan'),
        hit('/api/map/retail-units'), hit('/api/map/occupier-plan'),
      ]);
      return { statuses };
    });
    const bad = r.statuses.filter((s) => s !== 200);
    if (bad.length) throw new Error(`concurrent goad layers returned ${r.statuses.join(',')} (all must be 200, never 500)`);
  });

  // AI failures must reach a terminal state the user can see (r261):
  // 1. Contact "Verify with AI" must never surface a raw 500/SDK error —
  //    no-key environments get a 503 with the house "not configured" copy.
  // 2. An activity curate job that dies (no AI key) must stop reporting
  //    inFlight so the "Analysing…" spinner resolves — the GET auto-kick
  //    honours the failure cooldown instead of relaunching a doomed job
  //    on every poll.
  await step(page, p, 'staff-ai-failure-terminal', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const contacts = await (await fetch('/api/crm/contacts', { headers: auth })).json();
      const tom = (Array.isArray(contacts) ? contacts : []).find((c) => /barista/i.test(c.name || ''));
      if (!tom) return { skip: true };
      const v = await fetch(`/api/crm/contacts/${tom.id}/verify`, { method: 'POST', credentials: 'include', headers: auth });
      const vBody = await v.json().catch(() => ({}));
      const kick = await fetch(`/api/activity/contact/${tom.id}/curate`, { method: 'POST', credentials: 'include', headers: auth });
      let terminal = false;
      for (let i = 0; i < 15; i++) {
        await new Promise((res2) => setTimeout(res2, 2000));
        const g = await (await fetch(`/api/activity/contact/${tom.id}`, { headers: auth })).json().catch(() => null);
        if (g && !g.inFlight) { terminal = true; break; }
      }
      return { skip: false, verifyStatus: v.status, verifyError: String(vBody?.error || ''), kickStatus: kick.status, terminal };
    });
    if (r.skip) return;
    if (r.verifyStatus === 500) throw new Error(`verify-contact returned raw 500 (${r.verifyError.slice(0, 80)})`);
    if (r.verifyStatus === 503 && !/not configured/i.test(r.verifyError)) throw new Error(`verify-contact 503 without house copy: ${r.verifyError.slice(0, 80)}`);
    if (![200, 503].includes(r.verifyStatus)) throw new Error(`verify-contact unexpected ${r.verifyStatus}`);
    if (r.kickStatus !== 202) throw new Error(`curate kick ${r.kickStatus} (expected 202)`);
    if (!r.terminal) throw new Error('activity curate never reached a terminal state (inFlight stuck true ≥30s — Analysing… spinner would spin forever)');
  });

  // r267: the staff deal-detail action row (Image Studio / Create document /
  // Edit) must wrap at 390px — without flex-wrap, Edit sat past the viewport
  // with no scroll path (same class as the r265 calendar toolbar). Real phone
  // emulation per r266: touch + mobile UA, session cookie copied over.
  await step(page, p, 'staff-deal-mobile-action-row', async () => {
    const deals = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/crm/deals', { headers: auth })).json();
      return Array.isArray(list) ? list : (list?.data || []);
    });
    const deal = deals.find((d) => /gail/i.test(d.name || '')) || deals[0];
    if (!deal) return; // fixture without deals
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/deals/${deal.id}`, nav);
      await mob.locator('[data-testid="button-edit-deal"]').waitFor({ timeout: 20000 });
      for (const id of ['button-deal-image-studio', 'button-deal-create-document', 'button-edit-deal']) {
        const box = await mob.locator(`[data-testid="${id}"]`).first().boundingBox();
        if (!box) throw new Error(`deal action ${id} missing at 390px`);
        if (box.x < 0 || box.x + box.width > 390 + 2) {
          throw new Error(`deal action ${id} clipped at 390px (x ${Math.round(box.x)}, right ${Math.round(box.x + box.width)})`);
        }
      }
      // r355: the KYC incomplete banner said "Only 0 counterparty linked"
      // when nothing was linked — assert the zero-count copy stays humane.
      const amlBanner = mob.locator('[data-testid="deal-aml-status-incomplete"]');
      if (await amlBanner.count()) {
        const txt = await amlBanner.innerText();
        if (/Only 0 counterparty/.test(txt)) throw new Error(`AML banner regressed to "Only 0 counterparty": ${txt.slice(0, 80)}`);
      }
      // r363: with no party linked, the Brand section pill must show its
      // empty state instead of a blank screen, and Delete Deal is gated to
      // the Overview section on phones.
      if (!deal.tenantId && !deal.landlordId) {
        await mob.locator('[data-testid="deal-section-brand"]').click();
        await mob.waitForTimeout(600);
        if (!(await mob.locator('[data-testid="deal-brand-empty"]').isVisible())) throw new Error('Brand pill with no linked party missing its empty state');
        if (await mob.locator('[data-testid="button-delete-deal"]').isVisible()) throw new Error('Delete Deal visible on the Brand phone section');
        await mob.locator('[data-testid="deal-section-overview"]').click();
        await mob.waitForTimeout(600);
        if (!(await mob.locator('[data-testid="button-delete-deal"]').count())) throw new Error('Delete Deal missing from the Overview phone section');
      }
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r329: UX #63 — every stage chip on the deals board, INCLUDING the "All"
  // chip, must recount against the active search (the All chip kept the
  // unfiltered count while the status chips recounted, so the numbers
  // disagreed the moment a search was typed).
  await step(page, p, 'staff-deals-all-chip-recounts', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/deals/list`, nav);
      const allChip = mob.locator('[data-testid="chip-group-all"]');
      await allChip.waitFor({ timeout: 20000 });
      await mob.locator('input[placeholder*="earch"]').first().fill('zzz-no-match-probe');
      await mob.waitForTimeout(1200);
      const txt = (await allChip.textContent()) || '';
      const count = parseInt(txt.replace(/\D/g, ''), 10);
      if (count !== 0) throw new Error(`All chip did not recount under a zero-match search (shows "${txt}")`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r275: the /tasks filter tab strip (Assigned by me / All / To Do /
  // In Progress / Done) was a nowrap flex row — Done sat at x 425-494 at
  // 390px, reachable only by panning the whole page pane sideways (r265
  // calendar-toolbar class, fixed with flex-wrap). Every filter tab must sit
  // inside the phone viewport, and the content pane must not h-scroll.
  await step(page, p, 'staff-tasks-mobile-tabs', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/tasks`, nav);
      await mob.locator('[data-testid="filter-done"]').waitFor({ timeout: 20000 });
      for (const id of ['filter-assigned-by-me', 'filter-all', 'filter-todo', 'filter-in_progress', 'filter-done']) {
        const box = await mob.locator(`[data-testid="${id}"]`).first().boundingBox();
        if (!box) throw new Error(`tasks tab ${id} missing at 390px`);
        if (box.x < 0 || box.x + box.width > 390 + 2) {
          throw new Error(`tasks tab ${id} clipped at 390px (x ${Math.round(box.x)}, right ${Math.round(box.x + box.width)})`);
        }
      }
      const paneOverflow = await mob.evaluate(() => {
        const p = document.querySelector('.flex-1.overflow-y-auto');
        return p ? p.scrollWidth - p.clientWidth : 0;
      });
      if (paneOverflow > 4) throw new Error(`tasks page pane h-scrolls at 390px (${paneOverflow}px overflow)`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r283: staff mobile property + tenancy schedule. The property header
  // action row was a nowrap flex row (610px at 390px — Create document +
  // Set Up Folders unreachable, r265/r267 class, fixed with flex-wrap); the
  // tenancy sheet's pinned Unit column grew to 434px — wider than the whole
  // 356px scroll window, hiding every moving column (fixed with a mobile
  // max-w cap on the unit cell). Both must stay inside a 390px phone.
  await step(page, p, 'staff-property-tenancy-mobile', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/properties/${BLUEWATER}`, nav);
      await mob.locator('[data-testid="button-setup-folders"]').waitFor({ timeout: 30000 });
      for (const id of ['button-ask-ai-property', 'button-image-studio', 'button-create-document', 'button-setup-folders']) {
        const box = await mob.locator(`[data-testid="${id}"]`).first().boundingBox();
        if (!box) throw new Error(`property action ${id} missing at 390px`);
        if (box.x < 0 || box.x + box.width > 390 + 2) {
          throw new Error(`property action ${id} clipped at 390px (x ${Math.round(box.x)}, right ${Math.round(box.x + box.width)})`);
        }
      }
      await mobGoto(mob, `${BASE}/tenancy-schedule/${BLUEWATER}`, nav);
      // JOGQK 6819e38e (2026-08-25): phones get one card per unit — the
      // banded sheet (sticky Unit column) never ships below md. Assert the
      // card list renders and the desktop table stays hidden at 390px.
      await mob.locator('[data-testid^="tenancy-card-"]').first().waitFor({ timeout: 30000 });
      const m = await mob.evaluate(() => {
        const sticky = document.querySelector('table tbody td.sticky');
        return {
          cards: document.querySelectorAll('[data-testid^="tenancy-card-"]').length,
          tableVisible: !!(sticky && sticky.getBoundingClientRect().width > 0),
        };
      });
      if (!m.cards) throw new Error('tenancy phone card list empty at 390px');
      if (m.tableVisible) throw new Error('desktop banded sheet visible at 390px alongside the phone card list');
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r379: phone Brands landing search (Woody 2026-08-25 — one box over
  // brands, contacts at brands, acting agents) + the brand Social pill.
  // A contact-name search must render the contact row with its call/email
  // buttons, and the Social pill must never be a blank screen: brands with
  // no Instagram handle get the "No social feed yet" empty state (the
  // Instagram card returns null without a handle — r379 fix).
  await step(page, p, 'staff-mobile-brand-search-social', async () => {
    const pr = await fetch(`${BASE}/api/brand/${BRAND}/profile`, { headers: { Authorization: 'Bearer ' + page.qaToken } });
    if (!pr.ok) throw new Error(`brand profile fetch ${pr.status} for ${BRAND}`);
    const prof = await pr.json();
    const sr = await fetch(`${BASE}/api/brands/search?q=tom`, { headers: { Authorization: 'Bearer ' + page.qaToken } });
    if (!sr.ok) throw new Error(`/api/brands/search 'tom' ${sr.status}`);
    const hits = await sr.json();
    const contactHit = (hits.contacts || [])[0];
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      if (contactHit) {
        await mobGoto(mob, `${BASE}/brands`, nav);
        const box = mob.locator('[data-testid="brand-quick-search"]');
        await box.waitFor({ timeout: 30000 });
        await box.fill('tom');
        await mob.waitForTimeout(2500);
        const body = await mob.evaluate(() => document.body.innerText);
        if (!body.includes(contactHit.name)) throw new Error(`quick-search 'tom' missing contact ${contactHit.name} at 390px`);
        if (contactHit.email && !await mob.locator(`a[href="mailto:${contactHit.email}"]`).count())
          throw new Error(`quick-search contact row missing mailto:${contactHit.email}`);
        if (contactHit.phone && !await mob.locator('a[href^="tel:"]').count())
          throw new Error('quick-search contact row missing tel: button despite phone on record');
      }
      await mobGoto(mob, `${BASE}/companies/${BRAND}`, nav);
      const socialPill = mob.locator('[data-testid="company-section-social"]');
      await socialPill.waitFor({ timeout: 30000 });
      await socialPill.tap().catch(() => socialPill.click());
      await mob.waitForTimeout(2500);
      const social = await mob.evaluate(() => document.body.innerText);
      if (prof?.company?.instagram_handle) {
        if (!/Instagram|@/.test(social)) throw new Error('Social pill: Instagram card missing despite handle on record');
      } else if (!/No social feed yet/i.test(social)) {
        throw new Error('Social pill blank for a no-handle brand — empty state missing');
      }
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r291: staff mobile comps board. /comps must render the Leasing board at
  // 390px (search box + Add Comp inside the viewport, no page h-scroll) and
  // the Add Comp dialog's controls must all sit inside the phone viewport
  // (r265/r275/r283 mobile-clipping class — dialogs are where it recurs).
  await step(page, p, 'staff-comps-mobile', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/comps`, nav);
      await mob.locator('[data-testid="button-create-comp"]').waitFor({ timeout: 30000 });
      const addBox = await mob.locator('[data-testid="button-create-comp"]').boundingBox();
      if (!addBox || addBox.x < 0 || addBox.x + addBox.width > 390 + 2) {
        throw new Error(`Add Comp button clipped/missing at 390px (${addBox ? `x ${Math.round(addBox.x)}, right ${Math.round(addBox.x + addBox.width)}` : 'no box'})`);
      }
      const pageOverflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (pageOverflow > 4) throw new Error(`/comps h-scrolls at 390px (${pageOverflow}px overflow)`);
      await mob.locator('[data-testid="button-create-comp"]').click();
      await mob.locator('[role="dialog"] [data-testid="create-comp-tenant"]').waitFor({ timeout: 15000 });
      const clipped = await mob.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        const bad = [];
        d.querySelectorAll('input, button, select, textarea, [role="combobox"]').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && (b.x < -2 || b.x + b.width > 392)) bad.push(el.tagName);
        });
        return bad;
      });
      if (clipped.length) throw new Error(`Add Comp dialog controls clipped at 390px: ${clipped.join(',')}`);
      await mob.keyboard.press('Escape');
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r307: a STAFF property-page load must never fire the client-jailed
  // sharepoint fetch. isClientViewer defaults true while /api/auth/me loads,
  // which used to briefly mount ClientPropertyFoldersPanel for staff and 403
  // GET /api/client/sharepoint/root on every staff property view. Fresh
  // context so nothing is cached and the loading window really happens.
  await step(page, p, 'staff-property-no-client-sharepoint', async () => {
    const mobCtx = await page.context().browser().newContext();
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      const doomed = [];
      mob.on('request', (r) => { if (r.url().includes('/api/client/sharepoint/root')) doomed.push(r.url()); });
      await mob.goto(`${BASE}/`, nav);
      // No cookies in this context, so the app's REAL token key must carry
      // the auth — the UI reads bgp_auth_token (queryClient getAuthHeaders),
      // not the legacy authToken key the cookie-backed scenarios plant.
      await mob.evaluate((tok) => {
        localStorage.setItem('bgp_auth_token', tok);
      }, page.qaToken);
      await mobGoto(mob, `${BASE}/properties/${BLUEWATER}`, nav);
      // 60s to match nav: a fresh context's first property-page load can
      // exceed 30s when another build is hogging the box (r308 flake).
      await mob.locator('[data-testid="toggle-files-section"]').first().waitFor({ timeout: 60000 });
      await mob.waitForTimeout(4000);
      if (doomed.length) throw new Error(`staff property page fired client sharepoint fetch ×${doomed.length} (isClientViewer loading-window regression)`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // Task assignment (terminal, 2026-08-03): a task assigned to another staff
  // member lands on the ASSIGNEE's list. Victoria assigns to Woody; the
  // woody round verifies receipt. Swept by the QA-PROBE task purge.
  await step(page, p, 'agent-assign-task', async () => {
    const title = `QA-PROBE task ASSIGN R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const staff = await (await fetch('/api/hr/staff', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(staff) ? staff : (staff?.staff || []);
      const woody = rows.find((s) => String(s.email || '').startsWith('woody@'));
      if (!woody) return { skip: true };
      const create = await fetch('/api/tasks', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: needle, assigneeUserId: woody.id }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      return { ok: true };
    }, title);
    if (r.skip) return;
    if (!r.ok) throw new Error(`staff task assignment failed (${r.why})`);
    cross.assignedTaskTitle = title;
  });

  await step(page, p, 'staff-task-lifecycle', async () => {
    const title = `QA-PROBE task R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const create = await fetch('/api/tasks', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ title: needle }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      const done = await fetch(`/api/tasks/${made.id}`, { method: 'PATCH', credentials: 'include', headers: auth, body: JSON.stringify({ completed: true }) });
      if (!done.ok) return { ok: false, why: `complete ${done.status}` };
      const del = await fetch(`/api/tasks/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `delete ${del.status}` };
      const list = await (await fetch('/api/tasks', { headers: auth })).json();
      const rows = Array.isArray(list) ? list : (list?.data || []);
      return { ok: true, residue: rows.some((t) => t.title === needle) };
    }, title);
    if (!r.ok) throw new Error(`staff task lifecycle failed (${r.why})`);
    if (r.residue) throw new Error('deleted task still present in the task list');
  });

  // Agent adds a contact ON the Landsec company — the client must then see it
  // in their own CRM (agent→client contact parity). Persisted (swept by the
  // round cleanup's 'QA Contact%' purge); the client-side check runs later.
  await step(page, p, 'agent-add-client-contact', async () => {
    const name = `QA Contact LS R${ROUND}`;
    const editedRole = `Landsec-side edited R${ROUND}`;
    const r = await page.evaluate(async (args) => {
      const [needle, role] = args;
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const create = await fetch('/api/crm/contacts', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, role: 'Landsec-side probe', companyId: window.QA_FIX.landsec }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      // Edit the role too, so the client-side parity check covers agent edits.
      const edit = await fetch(`/api/crm/contacts/${made.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ role }) });
      if (!edit.ok) return { ok: false, why: `edit ${edit.status}` };
      return { ok: true };
    }, [name, editedRole]);
    if (!r.ok) throw new Error(`agent could not add/edit a Landsec contact (${r.why})`);
    cross.contactStamp = name;
    cross.contactRole = editedRole;
  });

  // Agent authors an operator-targeting brief (+ a target) on a Landsec unit;
  // the client round must then see the same brief on their own unit
  // (agent->client brief parity). Kept alive; swept by 'QA Brief%' cleanup.
  await step(page, p, 'agent-create-unit-brief', async () => {
    const title = `QA Brief AgentParity R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const bluewater = window.QA_FIX.bluewater;
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : []).find((u) => String(u.propertyId) === bluewater);
      if (!unit) return { ok: false, why: 'no Landsec unit found' };
      const briefRes = await fetch(`/api/available-units/${unit.id}/brief`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: needle, brief: 'Agent-authored targeting brief' }) });
      if (!briefRes.ok) return { ok: false, why: `brief create ${briefRes.status}` };
      const brief = await briefRes.json();
      await fetch(`/api/unit-briefs/${brief.id}/targets`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ operatorName: 'QA Target Operator', rationale: 'fits the pitch' }) }).catch(() => {});
      return { ok: true, unitId: unit.id, briefId: brief.id };
    }, title);
    if (!r.ok) throw new Error(`agent could not author a unit brief (${r.why})`);
    cross.briefUnitId = r.unitId;
    cross.briefStamp = title;
    cross.briefId = r.briefId;
  });

  // Seed a firm-pool-only image (no property/company link) for the client
  // bytes-scope probe below — staff uploads carry no scope stamp, so this
  // row must never be readable by a scoped caller. Reuses the
  // qa-unit-photo.jpg name so run-round's purge sweeps it.
  await step(page, p, 'agent-seed-firm-pool-image', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const b64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      fd.append('images', new Blob([arr], { type: 'image/jpeg' }), 'qa-unit-photo.jpg');
      const up = await fetch('/api/image-studio/upload', { method: 'POST', headers: auth, body: fd });
      if (!up.ok) return { ok: false, status: up.status };
      const rows = await up.json();
      return { ok: true, id: (Array.isArray(rows) ? rows : rows?.results || [])[0]?.id || null };
    });
    if (!r.ok || !r.id) throw new Error(`firm-pool image seed failed (${r.status || 'no id'})`);
    cross.firmPoolImageId = r.id;
  });

  // 4h. Staff ChatBGP panel suggestion chips load into the composer.
  await step(page, p, 'staff-chat-suggestions', async () => {
    await page.goto(`${BASE}/`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const chips = page.locator('[data-testid^="button-panel-suggestion-"]');
    if (!(await chips.count())) return; // panel collapsed on this surface
    const label = (await chips.first().innerText().catch(() => '')).trim();
    await chips.first().click();
    await page.waitForTimeout(1200);
    const composer = await page.locator('textarea, [contenteditable="true"], input[placeholder*="Ask" i]').first()
      .inputValue().catch(async () => (await page.locator('[contenteditable="true"]').first().innerText().catch(() => '')));
    const echoed = label && (String(composer || '').includes(label.slice(0, 12)) ||
      (await page.getByText(label.slice(0, 18), { exact: false }).count()) > 0);
    if (!echoed) throw new Error(`clicking the "${label.slice(0, 24)}" suggestion did nothing (staff)`);
  });

  // 4i. Requirement EDIT: create, update the status, verify, delete.
  await step(page, p, 'agent-edit-requirement', async () => {
    const stamp = `QA-REQEDIT-R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/crm/requirements-leasing', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, status: 'Active' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      // UX #52: hand-added requirements (no date sent) default to today
      // server-side — a NULL date kills the Fresh badge + 90-day KPI.
      const today = new Date().toISOString().slice(0, 10);
      if ((made.requirementDate || '').slice(0, 10) !== today) {
        return { ok: false, why: `requirementDate did not default to today (got ${made.requirementDate})` };
      }
      const put = await fetch(`/api/crm/requirements-leasing/${made.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, status: 'On Hold' }) });
      if (!put.ok) return { ok: false, why: `edit ${put.status}` };
      const got = await (await fetch(`/api/crm/requirements-leasing/${made.id}`, { headers: auth })).json();
      const del = await fetch(`/api/crm/requirements-leasing/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      return { ok: true, status: got?.status, delOk: del.ok };
    }, stamp);
    if (!r.ok) throw new Error(`requirement edit lifecycle failed (${r.why})`);
    if (r.status !== 'On Hold') throw new Error(`requirement edit did not persist (status: ${r.status})`);
    if (!r.delOk) throw new Error('requirement cleanup delete failed');
  });

  // Global search labels deal hits with the DEAL's own name (r229: the
  // property-name join used to overwrite it, so every deal at a matched
  // property rendered as the property name — three identical "Bluewater
  // Shopping Centre" rows in the WIP group).
  await step(page, p, 'staff-search-deal-names', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/search?q=Bluewater', { credentials: 'include', headers: auth });
      if (!res.ok) return { ok: false, why: `search ${res.status}` };
      const body = await res.json();
      const deals = (body.results || []).filter((x) => x.type === 'deal');
      return { ok: true, total: deals.length, ownName: deals.filter((x) => !/^Bluewater Shopping Centre$/i.test(x.name)).length };
    });
    if (!r.ok) throw new Error(`global search failed (${r.why})`);
    if (r.total === 0) throw new Error('property-name search returned no deals — join coverage regressed');
    if (r.ownName === 0) throw new Error('deal search hits all carry the property name, not the deal name (r229 regression)');
  });

  // 4j. Staff brand profile renders its main sections without any error
  // boundary tripping (Honi Poke fixture).
  await step(page, p, 'staff-brand-profile-sections', async () => {
    await page.goto(`${BASE}/companies/${BRAND}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    if (await page.getByText('Page not found').count()) throw new Error('brand profile is a dead route for staff');
    const tripped = await page.getByText('something went wrong', { exact: false }).count();
    if (tripped) throw new Error(`${tripped} error boundary(ies) tripped on the staff brand profile`);
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 100) throw new Error('staff brand profile rendered nearly blank');
  });

  // Document Studio catalog (KYC / PLA / Why-Buy brief generation) is a live
  // staff feature — the catalog must list at least one brief type, so the
  // client-side guard below is proving a real surface is sealed, not a dead
  // route.
  await step(page, p, 'staff-document-briefs-catalog', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/document-briefs', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      return { ok: true, count: Array.isArray(body) ? body.length : 0 };
    });
    if (!r.ok) throw new Error(`staff document-briefs catalog unhealthy (${r.status})`);
    if (!r.count) throw new Error('staff document-briefs catalog is empty (feature dead?)');
  });

  // The HR staff directory has a silent minimal-SELECT fallback: if the full
  // query throws (r220: EXTRACT on the text start_date column), the route
  // still 200s but every profile-tier field vanishes. Assert the full shape —
  // fallback rows carry no holiday_used key at all.
  await step(page, p, 'staff-hr-directory-full-shape', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/hr/staff', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const rows = await res.json().catch(() => null);
      if (!Array.isArray(rows) || !rows.length) return { ok: false, status: 'empty' };
      return { ok: true, fullShape: 'holiday_used' in rows[0] };
    });
    if (!r.ok) throw new Error(`staff HR directory unhealthy (${r.status})`);
    if (!r.fullShape) throw new Error('HR directory served the minimal fallback shape (full query is throwing — check [hr] GET /staff error in the server log)');
  });

  // WIP Report is BGP's internal work-in-progress fee pipeline (every deal's
  // fee, agent split, completion value across the whole firm). It must be a
  // live staff surface — a 200 with an entries array — so the client guard
  // below is sealing real fee intel, not a dead route.
  await step(page, p, 'staff-wip-report-render', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/wip', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      return { ok: true, hasEntries: Array.isArray(body?.entries) };
    });
    if (!r.ok) throw new Error(`staff WIP report unhealthy (${r.status})`);
    if (!r.hasEntries) throw new Error('staff WIP report returned no entries array (shape broken)');
  });

  // r450: WIP "Client" fell back to the property's landlord in the name
  // chain, but the handler's properties select dropped landlord_id — so
  // deals with no direct counterparty (the fixture's Bluewater deals)
  // showed "—" instead of Landsec. Lock the fallback: any WIP entry whose
  // property is Bluewater must carry a client name + linkable clientId.
  await step(page, p, 'staff-wip-client-landlord-fallback', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/wip', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      const rows = (body?.entries || []).filter((e) => /bluewater/i.test(e.project || ''));
      if (!rows.length) return { ok: true, skip: true };
      const missing = rows.filter((e) => !e.client || !e.clientId);
      return { ok: true, total: rows.length, missing: missing.map((e) => e.ref) };
    });
    if (!r.ok) throw new Error(`WIP fetch failed (${r.status})`);
    if (r.skip) return;
    if (r.missing.length) throw new Error(`WIP Bluewater rows missing landlord-fallback client: ${r.missing.join(', ')}`);
  });

  // Deal-report v2 (BGP-branded 2-week deal PDF): a staff user pulls the
  // recent-deals feed and renders a real PDF. This exercises the pdfkit/
  // workbook builder end-to-end — the same class of code that 500'd on the
  // ExcelJS constructor — so a broken PDF path is caught, not just the client
  // guard. Assert a genuine application/pdf comes back, not a 500/HTML error.
  await step(page, p, 'staff-deal-report-pdf', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const rec = await fetch('/api/deal-report/recent-deals', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!rec.ok) return { ok: false, why: `recent-deals ${rec.status}` };
      const deals = await rec.json().catch(() => null);
      const list = Array.isArray(deals) ? deals : (deals?.deals || []);
      const ids = list.slice(0, 2).map((d) => d.id).filter(Boolean);
      if (!ids.length) return { ok: true, skip: true }; // no deals seeded this run
      const pdf = await fetch('/api/deal-report/pdf', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ dealIds: ids }) }).catch(() => ({ ok: false, status: 0 }));
      const ct = pdf.headers && pdf.headers.get ? (pdf.headers.get('content-type') || '') : '';
      const buf = pdf.ok ? await pdf.arrayBuffer().catch(() => null) : null;
      return { ok: true, pdfStatus: pdf.status, ct, size: buf ? buf.byteLength : 0 };
    });
    if (!r.ok) throw new Error(`staff deal-report feed failed (${r.why})`);
    if (r.skip) return;
    if (r.pdfStatus !== 200) throw new Error(`staff deal-report PDF failed (expected 200, got ${r.pdfStatus})`);
    if (!/pdf/.test(r.ct) || r.size < 1000) throw new Error(`deal-report returned a non-PDF/empty body (content-type ${r.ct || 'none'}, ${r.size} bytes)`);
  });

  // Property Pathway is BGP's acquisition-underwriting engine (Why-Buy runs:
  // off-market sourcing, title/RICS analysis, market intel, deck output). It
  // must be a live staff board — a 200 with an array of runs — so the client
  // guard below is sealing real underwriting IP, not a dead route.
  await step(page, p, 'staff-property-pathway-board', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/property-pathway', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      return { ok: true, isArray: Array.isArray(body) };
    });
    if (!r.ok) throw new Error(`staff property-pathway board unhealthy (${r.status})`);
    if (!r.isArray) throw new Error('staff property-pathway board did not return a runs array');
  });

  // Seed a staff-authored chat message so the client round can prove it
  // CANNOT delete someone else's message (the delete guard is own-message-or-
  // thread-creator only — recently surfaced in the brand-chat hover actions).
  await step(page, p, 'agent-chat-msg-for-delete-guard', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/chat/threads', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ isAiChat: true, title: `QA-CHATDEL staff R${round}` }) });
      if (!create.ok) return { ok: false, why: `thread ${create.status}` };
      const thread = await create.json();
      const post = await fetch(`/api/chat/threads/${thread.id}/messages`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ content: `QA staff message R${round}` }) });
      if (!post.ok) return { ok: false, why: `message ${post.status}` };
      const msg = await post.json();
      return { ok: true, threadId: thread.id, msgId: msg?.id };
    }, ROUND);
    if (!r.ok) throw new Error(`agent could not seed a chat message (${r.why})`);
    cross.chatThreadId = r.threadId;
    cross.chatMsgId = r.msgId;
  });

  // 4k. Agent logs a viewing on a Landsec unit — the client round then checks
  // it shows up on THEIR letting activity (true cross-persona visibility).
  await step(page, p, 'agent-log-viewing', async () => {
    const stamp = `QA-VIEWING-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : []).find((u) => u.propertyId === window.QA_FIX.bluewater) || (Array.isArray(units) ? units[0] : null);
      if (!unit) return { skip: true };
      const post = await fetch(`/api/available-units/${unit.id}/viewings`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ viewingDate: new Date().toISOString().slice(0, 10), attendees: marker }) });
      if (!post.ok) return { ok: false, why: `viewing POST ${post.status}` };
      const made = await post.json();
      return { ok: true, viewingId: made.id, unitId: unit.id };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`agent could not log a viewing (${r.why})`);
    cross.viewingStamp = stamp;
    cross.viewingId = r.viewingId;
    cross.viewingUnitId = r.unitId;
  });

  // Agent logs an OFFER on a Landsec unit — the client must then see it on
  // their own letting activity (parity with the viewing cross-check; exercises
  // the client-scoped all-offers read from the agent-write side).
  await step(page, p, 'agent-log-offer', async () => {
    const stamp = `QA-AOFFER-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : []).find((u) => u.propertyId === window.QA_FIX.bluewater) || (Array.isArray(units) ? units[0] : null);
      if (!unit) return { skip: true };
      const post = await fetch(`/api/available-units/${unit.id}/offers`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: marker, offerDate: new Date().toISOString().slice(0, 10) }) });
      if (!post.ok) return { ok: false, why: `offer POST ${post.status}` };
      const made = await post.json();
      return { ok: true, offerId: made.id };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`agent could not log an offer (${r.why})`);
    cross.offerStamp = stamp;
    cross.offerId = r.offerId;
  });

  // The tracker dialogs' edit pencils (2026-08-08 UX batch): PATCH
  // /api/available-units/viewings/:id and offers/:id. Edit the rows just
  // logged, confirm the edit persists on re-read, and hand the EDITED
  // stamps to Mark's round so the client-visibility checks also prove
  // edits flow through to the client.
  await step(page, p, 'agent-edit-viewing-offer', async () => {
    if (!cross.viewingId || !cross.offerId || !cross.viewingUnitId) return;
    const r = await page.evaluate(async (args) => {
      const [viewingId, offerId, vStamp, oStamp, unitId] = args;
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const pv = await fetch(`/api/available-units/viewings/${viewingId}`, { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ attendees: vStamp }) });
      if (!pv.ok) return { ok: false, why: `viewing PATCH ${pv.status}` };
      const po = await fetch(`/api/available-units/offers/${offerId}`, { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: oStamp }) });
      if (!po.ok) return { ok: false, why: `offer PATCH ${po.status}` };
      const viewings = await (await fetch(`/api/available-units/${unitId}/viewings`, { headers: auth })).json();
      const vRow = (Array.isArray(viewings) ? viewings : []).find((x) => x.id === viewingId);
      return { ok: true, persisted: vRow?.attendees === vStamp };
    }, [cross.viewingId, cross.offerId, `${cross.viewingStamp}-EDITED`, `${cross.offerStamp}-EDITED`, cross.viewingUnitId]);
    if (!r.ok) throw new Error(`tracker row edit failed (${r.why})`);
    if (!r.persisted) throw new Error('viewing PATCH returned OK but the edit did not persist');
    cross.viewingStamp = `${cross.viewingStamp}-EDITED`;
    cross.offerStamp = `${cross.offerStamp}-EDITED`;
  });

  // Big-ticket money fields (r371): drizzle-zod used to cap real() columns at
  // 8,388,607, so a £9m rent or £12m premium 400'd on both add and edit.
  // Offer created + deleted in-scenario; company_name QA-OFFER-% is also purged.
  await step(page, p, 'agent-offer-big-figures', async () => {
    if (!cross.viewingUnitId) return;
    const r = await page.evaluate(async (args) => {
      const [unitId, round] = args;
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const mk = await fetch(`/api/available-units/${unitId}/offers`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: `QA-OFFER-BIGNUM R${round}`, offerDate: new Date().toISOString().slice(0, 10), rentPa: 9000000, premium: 12000000 }) });
      if (!mk.ok) return { ok: false, why: `big-rent POST ${mk.status}` };
      const offer = await mk.json();
      try {
        const pa = await fetch(`/api/available-units/offers/${offer.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
          body: JSON.stringify({ rentPa: 10500000, fittingOutContribution: 9500000 }) });
        if (!pa.ok) return { ok: false, why: `big-rent PATCH ${pa.status}` };
        const row = await pa.json();
        return { ok: true, persisted: row.rentPa === 10500000 && row.premium === 12000000 };
      } finally {
        await fetch(`/api/available-units/offers/${offer.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      }
    }, [cross.viewingUnitId, ROUND]);
    if (!r.ok) throw new Error(`big-figure offer failed (${r.why}) — real() 8,388,607 cap regression`);
    if (!r.persisted) throw new Error('big-figure offer saved but values did not persist');
    // Same cap on investment offers — a £25m offerPrice must save (r371).
    const inv = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const trackers = await (await fetch('/api/investment-tracker', { headers: auth })).json().catch(() => []);
      const tracker = Array.isArray(trackers) ? trackers[0] : null;
      if (!tracker) return { ok: true, skipped: true };
      const mk = await fetch(`/api/investment-tracker/${tracker.id}/offers`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ company: `QA-OFFER-INV R${round}`, offerPrice: 25000000 }) });
      if (!mk.ok) return { ok: false, why: `investment offer POST ${mk.status}` };
      const row = await mk.json();
      await fetch(`/api/investment-offers/${row.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return { ok: true, persisted: row.offerPrice === 25000000 };
    }, ROUND);
    if (!inv.ok) throw new Error(`big-figure investment offer failed (${inv.why})`);
    if (!inv.skipped && !inv.persisted) throw new Error('investment offer saved but £25m price did not persist');
  });

  // Same real() cap on the unit and deal schemas (r372): a £9m asking rent on
  // a tracker unit and a £25m deal price must save. Rows created + deleted
  // in-scenario; QA-BIGNUM% units and QA-R% deals are also purged.
  await step(page, p, 'agent-unit-deal-big-figures', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const propertyId = Array.isArray(units) && units[0] ? units[0].propertyId : null;
      if (!propertyId) return { ok: false, why: 'no available unit to borrow a propertyId from' };
      const mk = await fetch('/api/available-units', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ propertyId, unitName: `QA-BIGNUM Unit R${round}`, askingRent: 9000000, fee: 9500000 }) });
      if (!mk.ok) return { ok: false, why: `big-rent unit POST ${mk.status}` };
      const unit = await mk.json();
      let unitOk = false;
      try {
        const pa = await fetch(`/api/available-units/${unit.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
          body: JSON.stringify({ askingRent: 10500000 }) });
        if (!pa.ok) return { ok: false, why: `big-rent unit PATCH ${pa.status}` };
        const row = await pa.json();
        unitOk = row.askingRent === 10500000;
      } finally {
        await fetch(`/api/available-units/${unit.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      }
      const dk = await fetch('/api/crm/deals', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: `QA-RCAP Deal R${round}`, status: 'INS', pricing: 25000000, rentPa: 9000000 }) });
      if (!dk.ok) return { ok: false, why: `big-price deal POST ${dk.status}` };
      const deal = await dk.json();
      await fetch(`/api/crm/deals/${deal.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return { ok: true, persisted: unitOk && deal.pricing === 25000000 && deal.rentPa === 9000000 };
    }, ROUND);
    if (!r.ok) throw new Error(`big-figure unit/deal failed (${r.why}) — real() 8,388,607 cap regression`);
    if (!r.persisted) throw new Error('big-figure unit/deal saved but values did not persist');
  });

  // Investment activity dialogs send timestamps as ISO strings; the insert
  // schemas must coerce them (r373) — before that fix a dated viewing/offer
  // 400'd and EVERY distribution add failed. Also guards the tracker-create
  // guidePrice real() cap lift. Rows created + deleted in-scenario;
  // QA-INVDATE% / QA-RCAP% rows are also purged by run-round.sh.
  await step(page, p, 'agent-investment-dated-activity', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const trackers = await (await fetch('/api/investment-tracker', { headers: auth })).json().catch(() => []);
      const tracker = Array.isArray(trackers) ? trackers[0] : null;
      if (!tracker) return { ok: true, skipped: true };
      const iso = new Date().toISOString();
      const vk = await fetch(`/api/investment-tracker/${tracker.id}/viewings`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ company: `QA-INVDATE R${round}`, viewingDate: iso }) });
      if (!vk.ok) return { ok: false, why: `dated viewing POST ${vk.status}` };
      const viewing = await vk.json();
      await fetch(`/api/investment-viewings/${viewing.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      const ok2 = await fetch(`/api/investment-tracker/${tracker.id}/offers`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ company: `QA-INVDATE R${round}`, offerDate: iso, offerPrice: 25000000 }) });
      if (!ok2.ok) return { ok: false, why: `dated offer POST ${ok2.status}` };
      const offer = await ok2.json();
      await fetch(`/api/investment-offers/${offer.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      const dk = await fetch(`/api/investment-tracker/${tracker.id}/distributions`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: `QA-INVDATE R${round}`, sentDate: iso }) });
      if (!dk.ok) return { ok: false, why: `distribution POST ${dk.status}` };
      const dist = await dk.json();
      let respOk = false;
      try {
        const pr = await fetch(`/api/investment-distributions/${dist.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
          body: JSON.stringify({ response: 'Interested', responseDate: iso }) });
        respOk = pr.ok;
      } finally {
        await fetch(`/api/investment-distributions/${dist.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      }
      if (!respOk) return { ok: false, why: 'distribution response PATCH failed' };
      // £25m guide price on tracker create (real() cap, r373). Reuses an
      // existing propertyId so no property is auto-created; the auto-created
      // backing deal is deleted alongside the tracker row.
      const tk = await fetch('/api/investment-tracker', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ assetName: `QA-RCAP Tracker R${round}`, propertyId: tracker.propertyId, boardType: 'Sales', guidePrice: 25000000 }) });
      if (!tk.ok) return { ok: false, why: `£25m tracker POST ${tk.status}` };
      const row = await tk.json();
      if (row.dealId) await fetch(`/api/crm/deals/${row.dealId}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      await fetch(`/api/investment-tracker/${row.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return { ok: true, persisted: row.guidePrice === 25000000 && offer.offerPrice === 25000000 && !!offer.offerDate };
    }, ROUND);
    if (!r.ok) throw new Error(`investment dated activity failed (${r.why}) — timestamp coercion or real() cap regression`);
    if (!r.skipped && !r.persisted) throw new Error('investment dated activity saved but values did not persist');
  });

  // Tracker create validates BEFORE auto-creating the backing CRM property
  // (r374): a payload that fails zod must 400 without stranding an orphan
  // crm_properties row. QA-ORPHAN% properties also purged by run-round.sh.
  await step(page, p, 'agent-tracker-invalid-no-orphan', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const name = `QA-ORPHAN Tracker R${round}`;
      const bad = await fetch('/api/investment-tracker', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ assetName: name, boardType: 'Sales', guidePrice: 'not-a-number' }) });
      if (bad.ok) return { ok: false, why: 'invalid tracker POST unexpectedly succeeded' };
      const props = await (await fetch('/api/crm/properties', { headers: auth })).json().catch(() => []);
      const orphan = Array.isArray(props) && props.some(pr => pr.name === name);
      return { ok: !orphan, why: orphan ? 'orphan crm_properties row stranded by validation 400' : undefined };
    }, ROUND);
    if (!r.ok) throw new Error(`tracker orphan guard failed (${r.why})`);
  });

  // Tenancy re-import must not duplicate the tracker (r217): the schedule
  // import's clearExisting and bulk-delete unlink the mirror rows first, so
  // the fan-out re-adopts them by name instead of spawning a second listing
  // per unit. Simulated on a throwaway QA property; everything cleaned up.
  await step(page, p, 'agent-reimport-no-dup', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const mk = await fetch('/api/crm/properties', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: `QA-REIMP Prop R${round}` }) });
      if (!mk.ok) return { ok: false, why: `property POST ${mk.status}` };
      const prop = await mk.json();
      const out = { ok: true, propId: prop.id, trackerRows: -1 };
      const cleanup = async () => {
        const units = await (await fetch(`/api/available-units?propertyId=${prop.id}`, { headers: auth })).json().catch(() => []);
        for (const u of (Array.isArray(units) ? units : [])) {
          await fetch(`/api/available-units/${u.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
        }
        await fetch('/api/tenancy-schedule/bulk-delete', { method: 'POST', credentials: 'include', headers: auth,
          body: JSON.stringify({ propertyId: prop.id }) }).catch(() => {});
        await fetch(`/api/crm/properties/${prop.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      };
      try {
        const mkRow = () => fetch('/api/tenancy-schedule/unit', { method: 'POST', credentials: 'include', headers: auth,
          body: JSON.stringify({ property_id: prop.id, unit_number: 'QA-REIMP-UNIT', status: 'Vacant' }) });
        const first = await mkRow();
        if (!first.ok) return { ...out, ok: false, why: `tenancy POST ${first.status}` };
        const bd = await fetch('/api/tenancy-schedule/bulk-delete', { method: 'POST', credentials: 'include', headers: auth,
          body: JSON.stringify({ propertyId: prop.id }) });
        if (!bd.ok) return { ...out, ok: false, why: `bulk-delete ${bd.status}` };
        const second = await mkRow();
        if (!second.ok) return { ...out, ok: false, why: `tenancy re-POST ${second.status}` };
        const units = await (await fetch(`/api/available-units?propertyId=${prop.id}`, { headers: auth })).json();
        out.trackerRows = (Array.isArray(units) ? units : []).filter((u) => u.unitName === 'QA-REIMP-UNIT').length;
        return out;
      } finally { await cleanup(); }
    }, ROUND);
    if (!r.ok) throw new Error(`re-import simulation failed (${r.why})`);
    if (r.trackerRows !== 1) throw new Error(`delete + re-import left ${r.trackerRows} tracker rows for one unit (want 1 — duplication regression)`);
  });

  // Comps parity: a comp Victoria logs against the client's scheme must show
  // in the client's scheme-scoped comps table. Kept alive for mark's round;
  // swept by the QA-COMP purge.
  await step(page, p, 'agent-add-scheme-comp', async () => {
    const stamp = `QA-COMP R${ROUND}, Bluewater Shopping Centre`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/crm/comps', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, tenantName: 'QA Comp Tenant', area: 'Bluewater' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const comp = await create.json().catch(() => ({}));
      // r532: give the comp a file row so the client-side file sub-reads
      // (own-scheme roundtrip + rival guard) have something to answer with.
      let fileOk = false;
      if (comp.id) {
        const fd = new FormData();
        fd.append('file', new Blob(['QA-PROBE comp evidence'], { type: 'text/plain' }), 'QA-PROBE comp evidence.txt');
        const up = await fetch(`/api/crm/comps/${comp.id}/files`, { method: 'POST', credentials: 'include',
          headers: { Authorization: auth.Authorization }, body: fd });
        fileOk = up.ok;
      }
      return { ok: true, compId: comp.id || null, fileOk };
    }, stamp);
    if (!r.ok) throw new Error(`agent could not log a scheme comp (${r.why})`);
    if (!r.fileOk) throw new Error('agent could not attach a file to the scheme comp');
    cross.compStamp = stamp;
    cross.compId = r.compId;
  });

  // r532: a Landsec-owned investment requirement, so the client chunks can
  // prove the detail read is company-scoped (list already was, /:id was not).
  await step(page, p, 'agent-add-investment-requirement', async () => {
    const stamp = `QA-REQINV R${ROUND} Landsec`;
    const r = await page.evaluate(async ([needle, landsec]) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/crm/requirements-investment', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, companyId: landsec, contactName: 'QA Probe Contact', comments: 'QA-PROBE confidential' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const row = await create.json().catch(() => ({}));
      return { ok: true, id: row.id || null };
    }, [stamp, LANDSEC]);
    if (!r.ok) throw new Error(`agent could not log an investment requirement (${r.why})`);
    cross.reqInvStamp = stamp;
    cross.reqInvId = r.id;
  });

  // r533: chat-media is one flat namespace (chat uploads, ChatBGP-generated
  // docs, KYC passports/bank statements) behind a client-allowed download
  // route. Victoria drops two staff files in: one shared into a thread Mark
  // belongs to, one never shared — the client chunks prove the shared one
  // still opens and the private one doesn't.
  await step(page, p, 'agent-upload-chat-media', async () => {
    const r = await page.evaluate(async (round) => {
      const bearer = 'Bearer ' + localStorage.getItem('authToken');
      const put = async (name) => {
        const fd = new FormData();
        fd.append('files', new Blob(['QA-PROBE chat media'], { type: 'text/plain' }), name);
        const up = await fetch('/api/chat/upload', { method: 'POST', credentials: 'include',
          headers: { Authorization: bearer }, body: fd });
        if (!up.ok) return null;
        return ((await up.json().catch(() => ({}))).files || [])[0] || null;
      };
      const shared = await put(`QA-PROBE chat media shared R${round}.txt`);
      const priv = await put(`QA-PROBE chat media private R${round}.txt`);
      if (!shared || !priv) return { ok: false, why: 'upload failed' };
      const users = await (await fetch('/api/users', { credentials: 'include', headers: { Authorization: bearer } })).json().catch(() => []);
      const mark = (Array.isArray(users) ? users : []).find((u) => (u.email || '').toLowerCase() === 'mark.warne@landsec.com');
      if (!mark) return { ok: false, why: 'mark not in /api/users' };
      const json = { 'Content-Type': 'application/json', Authorization: bearer };
      const th = await (await fetch('/api/chat/threads', { method: 'POST', credentials: 'include', headers: json,
        body: JSON.stringify({ title: `QA Thread R${round} media`, memberIds: [mark.id] }) })).json().catch(() => ({}));
      if (!th.id) return { ok: false, why: 'thread create failed' };
      const msg = await fetch(`/api/chat/threads/${th.id}/messages`, { method: 'POST', credentials: 'include', headers: json,
        body: JSON.stringify({ role: 'user', content: 'QA-PROBE pack for review', attachments: [JSON.stringify(shared)] }) });
      if (!msg.ok) return { ok: false, why: `message ${msg.status}` };
      return { ok: true, shared: shared.url.replace('/api/chat-media/', ''), priv: priv.url.replace('/api/chat-media/', '') };
    }, ROUND);
    if (!r.ok) throw new Error(`agent could not stage chat-media files (${r.why})`);
    cross.mediaShared = r.shared;
    cross.mediaPrivate = r.priv;
  });

  // r504: the comp detail dialog was a hard grid-cols-2 — at 390px each
  // column got ~160px, the 112px labels left ~40px value slivers and long
  // values collided with the Transaction column. Fixed with grid-cols-1
  // sm:grid-cols-2; the phone must render the sections stacked.
  await step(page, p, 'staff-comp-detail-mobile-stacks', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/comps`, nav);
      const card = mob.getByText(`QA-COMP R${ROUND}`, { exact: false }).first();
      await card.waitFor({ timeout: 30000 });
      await card.tap();
      await mob.locator('[role="dialog"]').waitFor({ timeout: 20000 });
      const m = await mob.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const h4s = [...dlg.querySelectorAll('h4')];
        const det = h4s.find((h) => /property details/i.test(h.textContent));
        const trn = h4s.find((h) => /transaction/i.test(h.textContent));
        if (!det || !trn) return { why: 'section headings missing' };
        const grid = det.closest('.grid');
        return {
          stacked: trn.getBoundingClientRect().top >= det.getBoundingClientRect().bottom,
          gridOverflow: grid ? grid.scrollWidth - grid.clientWidth : 0,
        };
      });
      if (m.why) throw new Error(`comp detail dialog: ${m.why}`);
      if (!m.stacked) throw new Error('comp detail sections side-by-side at 390px (grid-cols-1 regression)');
      if (m.gridOverflow > 4) throw new Error(`comp detail grid h-scrolls at 390px (${m.gridOverflow}px overflow)`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // Agent books a deal on a Landsec property WITH a BGP fee. The client round
  // then confirms the deal shows up on Mark's board (cross-persona visibility)
  // but every fee field is stripped from his view — staff set fees, clients
  // see the deal, never the fee. (Read-side complement to the write-side
  // client-deal-fee-injection-guard.)
  await step(page, p, 'agent-create-deal-with-fee', async () => {
    const name = `QA-R${ROUND} FeeVisibility`;
    const r = await page.evaluate(async (dealName) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/crm/deals', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: dealName, landlordId: window.QA_FIX.landsec, fee: 456789, feePercentage: 12, commission: 456789 }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json().catch(() => ({}));
      return { ok: true, id: made?.id };
    }, name);
    if (!r.ok) throw new Error(`agent could not create a fee-bearing Landsec deal (${r.why})`);
    cross.feeDealName = name;
    cross.feeDealId = r.id || null;
  });

  // Offer deletion parity: offers have no edit route (create/delete only),
  // so the lifecycle that matters is a deleted offer vanishing everywhere —
  // staff letting activity now, the client's view cross-checked later.
  await step(page, p, 'agent-offer-delete-lifecycle', async () => {
    const stamp = `QA-ODEL-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : []).find((u) => u.propertyId === window.QA_FIX.bluewater);
      if (!unit) return { skip: true };
      const post = await fetch(`/api/available-units/${unit.id}/offers`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: marker, offerDate: new Date().toISOString().slice(0, 10) }) });
      if (!post.ok) return { ok: false, why: `POST ${post.status}` };
      const made = await post.json();
      const del = await fetch(`/api/available-units/offers/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `DELETE ${del.status}` };
      const all = await (await fetch('/api/available-units/all-offers', { headers: auth })).json();
      return { ok: true, stillThere: JSON.stringify(all).includes(marker) };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`agent offer delete lifecycle failed (${r.why})`);
    if (r.stillThere) throw new Error('deleted offer still visible in staff letting activity');
    cross.odelStamp = stamp;
  });

  // 4l. Tracker inline-detail PATCH (new Costs-popover Details section):
  // write a detail field through the same PATCH the popover uses and verify
  // it persists, then restore the prior value.
  await step(page, p, 'staff-tracker-inline-patch', async () => {
    const marker = `QA-COND-R${ROUND}`;
    const r = await page.evaluate(async (val) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const before = unit.condition ?? null;
      const patch = await fetch(`/api/available-units/${unit.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ condition: val }) });
      if (!patch.ok) return { ok: false, why: `PATCH ${patch.status}` };
      const after = await (await fetch(`/api/available-units/${unit.id}`, { headers: auth })).json();
      const persisted = after?.condition === val;
      await fetch(`/api/available-units/${unit.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ condition: before }) }).catch(() => {});
      return { ok: true, persisted };
    }, marker);
    if (r.skip) return;
    if (!r.ok) throw new Error(`tracker inline PATCH failed (${r.why})`);
    if (!r.persisted) throw new Error('tracker inline PATCH did not persist the detail field');
  });

  // r450: the tracker's desktop status-pill row sat in a vertical-only
  // ScrollArea, so pills past the viewport edge (Invoiced at 1440px) were
  // clipped with no way to scroll to them. Now a plain overflow-x-auto
  // container — the last pill must be reachable by scrolling its own row,
  // and the page itself must not scroll sideways.
  await step(page, p, 'staff-tracker-status-pills-reachable', async () => {
    await page.goto(`${BASE}/available`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="stat-card-inv"]');
      if (!chip) return { skip: true }; // compact/mobile variant renders stat-chip-*
      const wrap = chip.parentElement.parentElement;
      wrap.scrollLeft = wrap.scrollWidth;
      const rect = chip.getBoundingClientRect();
      return {
        reachable: rect.right <= window.innerWidth + 1 && rect.width > 0,
        pageScrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    if (r.skip) return;
    if (!r.reachable) throw new Error('tracker Invoiced status pill is clipped/unreachable on desktop');
    if (r.pageScrolls) throw new Error('tracker page scrolls sideways (pill row must scroll inside its own container)');
  });

  // r458: pitch mode ("Pitch property" on a brand profile) renders a
  // "+ <brand>" button in the Target Tenant cell, which at 1440px starts
  // out UNDER the sticky Actions & Activity column — the banner pointed at
  // a button the user couldn't see. The page now auto-scrolls the table
  // once so the first pitch button clears the pinned column.
  await step(page, p, 'staff-tracker-inline-company-create-kept', async () => {
    // r528 counterpart: hiding the inline "Create company" row for clients
    // must not take it away from staff, who rely on it for a viewing/offer
    // against a brand that isn't in the CRM yet (UX #147).
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/available`, nav);
      await mob.waitForTimeout(4000);
      const first = await mob.locator('[data-testid^="mobile-unit-"]').first().getAttribute('data-testid');
      if (!first) throw new Error('no phone tracker card on the staff board');
      const uid = first.replace('mobile-unit-', '');
      await mob.locator(`[data-testid="unit-offer-${uid}"]`).click();
      await mob.waitForTimeout(1500);
      await mob.locator('[data-testid="offer-company"]').click();
      await mob.waitForTimeout(800);
      // Unique per run: an exact pre-existing name match makes the picker
      // (correctly) offer no create row, which would read as a regression.
      const newco = `QA-PROBE Newco ${ROUND}-${Date.now().toString().slice(-6)}`;
      await mob.locator('input[placeholder^="Search"]').last().fill(newco);
      await mob.waitForTimeout(800);
      if (!(await mob.getByText(/Create company/i).count())) {
        throw new Error('staff lost the tracker inline company-create row');
      }
      // r530: the row existing is not the same as it WORKING — tap it and
      // prove the company really lands in the CRM (the client counterpart
      // scenario proves it stays hidden for them).
      await mob.getByText(/Create company/i).first().click();
      await mob.waitForTimeout(2500);
      const trigger = await mob.locator('[data-testid="offer-company"]').innerText();
      if (!trigger.includes(newco)) {
        throw new Error(`inline create did not select the new company (trigger "${trigger.replace(/\n/g, ' ')}")`);
      }
      const auth = { Authorization: 'Bearer ' + page.qaToken };
      const cos = await (await fetch(`${BASE}/api/crm/companies`, { headers: auth })).json();
      const made = (Array.isArray(cos) ? cos : []).find((c) => c.name === newco);
      if (!made) throw new Error('inline create left no company row in the CRM');
      await fetch(`${BASE}/api/crm/companies/${made.id}`, { method: 'DELETE', headers: auth });
    } finally { await mobCtx.close(); }
  });

  // r530: the WIP-report page header put the (wide) BGP logo and the
  // title column side by side at every width, so on a 390px phone the
  // title/subtitle were squeezed into ~110px and wrapped around the logo.
  // Header must stack on the phone: logo above a full-width title.
  await step(page, p, 'staff-wip-report-phone-header-stacked', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/wip-report`, nav);
      await mob.waitForTimeout(5000);
      const g = await mob.evaluate(() => {
        const box = (sel) => {
          const e = document.querySelector(sel);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        return { logo: box('[data-testid="wip-bgp-logo"]'), title: box('[data-testid="wip-report-title"]') };
      });
      if (!g.title) throw new Error('no WIP report title on the phone');
      if (g.title.w < 280) throw new Error(`WIP phone title column squeezed to ${g.title.w}px (expected the full gutter width)`);
      if (g.logo && g.logo.y + g.logo.h > g.title.y) {
        throw new Error(`WIP phone header still side-by-side (logo bottom ${g.logo.y + g.logo.h} overlaps title top ${g.title.y})`);
      }
    } finally { await mobCtx.close(); }
  });

  await step(page, p, 'staff-tracker-pitch-button-visible', async () => {
    await page.goto(`${BASE}/available?pitchBrand=${BRAND}&pitchBrandName=PitchProbe`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000); // rows + the one-shot auto-scroll effect
    const r = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid^="pitch-here-"]');
      if (!btn) return { skip: true }; // every unit already has a target
      const container = btn.closest('.table-scroll-container');
      if (!container) return { skip: true }; // mobile/card variant
      const sticky = container.querySelector('th.sticky');
      const sw = sticky ? sticky.getBoundingClientRect().width : 205;
      const b = btn.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      return { clear: b.width > 0 && b.right <= c.right - sw + 1, btnRight: Math.round(b.right), visibleRight: Math.round(c.right - sw) };
    });
    if (r.skip) return;
    if (!r.clear) throw new Error(`pitch-mode "+ brand" button hidden under the sticky Actions column (btnRight ${r.btnRight} > ${r.visibleRight})`);
  });

  // r257: a signed-in user parked at the literal /login URL used to hit
  // "Page not found" (guest-form sign-in happens in place, and the
  // authenticated router had no /login route). Must now land on the dashboard.
  await step(page, p, 'staff-login-route-redirect', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path === '/login') throw new Error('authenticated /login did not redirect home');
    if (await page.getByText('Page not found').count()) throw new Error('authenticated /login landed on Page not found');
  });

  // r474: the Brand Intelligence overview's Research Turnover panel used to
  // cache its TENANT-FILTERED company list under the bare
  // ["/api/crm/companies"] query key, so for its 120s staleTime the CRM hub
  // read "0 landlords · 0 agents · 0 contacts" (and landlord pickers went
  // empty) after any /brands visit. Visit /brands, then /contacts, and
  // require the CRM header to show real landlord counts.
  await step(page, p, 'staff-brands-then-crm-not-poisoned', async () => {
    await page.goto(`${BASE}/brands`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000); // overview tab mounts TurnoverResearchPanel
    await page.goto(`${BASE}/contacts`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let header = '';
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      header = await page.evaluate(() => {
        const h1 = document.querySelector('[data-testid="text-page-title"]');
        return h1?.parentElement?.textContent || '';
      });
      if (/[1-9]\d* landlords?/.test(header)) return; // real counts painted
    }
    throw new Error(`CRM hub landlord count never left zero after a /brands visit (header: "${header.slice(0, 80)}")`);
  });

  // r269: /messages is the mobile chat list; a mobile bookmark opened on
  // desktop used to land on "Page not found" (no desktop route). Must now
  // redirect to /chatbgp.
  await step(page, p, 'staff-messages-desktop-redirect', async () => {
    await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path === '/messages') throw new Error('desktop /messages did not redirect');
    if (path !== '/chatbgp') throw new Error(`desktop /messages landed on ${path}, expected /chatbgp`);
    if (await page.getByText('Page not found').count()) throw new Error('desktop /messages landed on Page not found');
  });

  // r289: the tenancy schedule is per-property; a bare /tenancy-schedule
  // (bookmark / hand-typed — it's on the client allow-list) used to render
  // "Page not found". It must land on /properties instead.
  await step(page, p, 'staff-tenancy-bare-redirect', async () => {
    await page.goto(`${BASE}/tenancy-schedule`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path !== '/properties') throw new Error(`bare /tenancy-schedule landed on ${path}, expected /properties`);
    if (await page.getByText('Page not found').count()) throw new Error('bare /tenancy-schedule landed on Page not found');
  });

  // UX #43 (Woody 2026-08-13): the full /image-studio power page is open to
  // ALL staff now — non-admin staff must land on it directly (no /m/images
  // bounce) and see the studio toolbar. Supersedes the r277 redirect check.
  await step(page, p, 'staff-image-studio-full-access', async () => {
    await page.goto(`${BASE}/image-studio`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path !== '/image-studio') throw new Error(`non-admin /image-studio landed on ${path}, expected to stay on /image-studio`);
    if (await page.getByText('Page not found').count()) throw new Error('non-admin /image-studio landed on Page not found');
    if (!(await page.locator('[data-testid="button-upload"]').count())) throw new Error('full studio toolbar (button-upload) did not render for non-admin staff');
  });

  // Mobile Images folder lifecycle (r387): the /m/images FOLDERS row is a
  // hand-made collection (kind null, no CRM link). Create → listed → delete.
  await step(page, p, 'staff-image-folder-lifecycle', async () => {
    const name = `QA Folder R${ROUND}`;
    const r = await page.evaluate(async (nm) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const created = await (await fetch('/api/image-studio/collections', {
        method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ name: nm }) })).json().catch(() => null);
      const id = created?.id || null;
      const list = id ? await (await fetch('/api/image-studio/collections', { headers: auth })).json().catch(() => []) : [];
      const row = (Array.isArray(list) ? list : []).find((c) => c.id === id) || null;
      const del = id ? (await fetch(`/api/image-studio/collections/${id}`, { method: 'DELETE', credentials: 'include', headers: auth })).status : 0;
      const after = id ? await (await fetch('/api/image-studio/collections', { headers: auth })).json().catch(() => []) : [];
      const ghost = (Array.isArray(after) ? after : []).some((c) => c.id === id);
      return { id, row, del, ghost };
    }, name);
    if (!r.id) throw new Error('folder create did not return an id');
    if (!r.row) throw new Error('created folder missing from collections list');
    if (r.row.kind != null || r.row.property_id || r.row.company_id) throw new Error('hand-made folder carries a system kind/CRM link — /m/images would hide it');
    if (r.del < 200 || r.del >= 300) throw new Error(`folder delete refused (${r.del})`);
    if (r.ghost) throw new Error('deleted folder still in collections list');
  });

  // hdog commission (r390, Woody 2026-08-26): Huseyn's billing always shows
  // zero — Xero/engine/allocation matching skipped for the hdog login. Other
  // users' commission endpoint must keep its full shape.
  await step(page, p, 'staff-hdog-commission-zero', async () => {
    const r = await page.evaluate(async () => {
      // credentials:'omit' so the login's Set-Cookie never swaps THIS page's
      // session to hdog — server auth prefers session over Bearer, so a
      // stored hdog cookie makes every later credentials:'include' scenario
      // (deal-verdict pending, etc.) run as hdog (r391).
      const login = await (await fetch('/api/auth/login', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'hdog', password: 'hdog' }) })).json().catch(() => null);
      if (!login?.token || !login?.id) return { skip: true }; // hdog boot-seed absent
      // credentials:'omit' here too — default same-origin credentials ride
      // victoria's session cookie along with hdog's Bearer, and the server
      // prefers session, so the admin-or-self commission check would run as
      // victoria and 403 (r392).
      const h = await (await fetch(`/api/hr/staff/${login.id}/commission`, {
        credentials: 'omit', headers: { Authorization: 'Bearer ' + login.token } })).json().catch(() => null);
      const me = JSON.parse(localStorage.getItem('user') || '{}');
      const own = await (await fetch(`/api/hr/staff/${me.id}/commission`, {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } })).json().catch(() => null);
      return { h, ownOk: !!(own && Array.isArray(own.tierBreakdown) && Array.isArray(own.scenarios)) };
    });
    if (r.skip) return;
    if (!r.h) throw new Error('hdog commission fetch failed');
    if (r.h.billedPence !== 0 || (r.h.billingsByYear || []).length || r.h.wipTotal !== 0
      || (r.h.topDeals || []).length || (r.h.awaitingPayment || []).length)
      throw new Error(`hdog billing not zeroed: ${JSON.stringify({ billedPence: r.h.billedPence, byYear: (r.h.billingsByYear || []).length, wip: r.h.wipTotal })}`);
    if (!r.ownOk) throw new Error('regular staff commission lost its shape (tierBreakdown/scenarios)');
  });

  // 4m. Deal comments round-trip: Victoria writes a comment on the Bluewater
  // deal and reads it back (the sidebar Comments widget rides this field).
  await step(page, p, 'staff-deal-comment', async () => {
    const note = `QA comment R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const deal = (Array.isArray(deals) ? deals : []).find((d) => /bluewater/i.test(d.name || ''));
      if (!deal) return { skip: true };
      const before = deal.comments ?? null;
      const put = await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ comments: marker }) });
      if (!put.ok) return { ok: false, why: `PUT ${put.status}` };
      const fresh = await (await fetch(`/api/crm/deals/${deal.id}`, { headers: auth })).json();
      const persisted = (fresh?.comments || '').includes(marker);
      await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ comments: before }) }).catch(() => {});
      return { ok: true, persisted };
    }, note);
    if (r.skip) return;
    if (!r.ok) throw new Error(`deal comment write failed (${r.why})`);
    if (!r.persisted) throw new Error('deal comment did not persist');
  });

  // 4n. Deal stage move: the board drag between pipeline columns fires
  // PUT {stage} — exercise it directly on the Bluewater deal, then restore.
  await step(page, p, 'staff-deal-stage-move', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const deal = (Array.isArray(deals) ? deals : []).find((d) => /bluewater/i.test(d.name || ''));
      if (!deal) return { skip: true };
      const before = deal.stage ?? null;
      const target = before === 'viewings' ? 'offers' : 'viewings';
      const put = await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ stage: target }) });
      if (!put.ok) return { ok: false, why: `PUT ${put.status}` };
      const fresh = await (await fetch(`/api/crm/deals/${deal.id}`, { headers: auth })).json();
      const persisted = fresh?.stage === target;
      await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ stage: before }) }).catch(() => {});
      return { ok: true, persisted };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`deal stage move failed (${r.why})`);
    if (!r.persisted) throw new Error('deal stage move did not persist');
  });

  // 5. Deal board (kanban) renders its pipeline columns without a crash.
  await step(page, p, 'deal-board-render', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // The /deals hub defaults to the WIP Report tab on desktop — switch to
    // the Deals tab before the board view is reachable.
    await page.getByRole('button', { name: /^Deals$/ }).first().click().catch(async () => {
      await page.getByText('Deals', { exact: true }).first().click();
    });
    await page.waitForTimeout(1200);
    // Then flip to Board view (ViewToggle button by accessible name). The
    // /deals hub is heavy (WIP tab + funnel + board all mount lazily), so the
    // tab/toggle clicks + column render can lag behind the fixed waits — poll
    // for the pipeline columns and retry the Board toggle before failing, so a
    // slow render isn't logged as a broken board.
    const countCols = async () => {
      const cols = await Promise.all(['Negotiating', 'Solicitors', 'Exchanged', 'Completed', 'Invoiced']
        .map(c => page.getByText(c, { exact: false }).count()));
      return cols.filter(n => n > 0).length;
    };
    let shown = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const boardBtn = page.getByRole('button', { name: /board/i }).first();
      if (await boardBtn.count()) await boardBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
      shown = await countCols();
      if (shown >= 3) break;
    }
    if (shown < 3) throw new Error(`deal board shows only ${shown}/5 pipeline columns`);
  });

  // Targeting Brief + target operator via the API the Brief dialog uses
  // (r253: the dialog's popover picker was dead inside the Radix Dialog —
  // the API pair is the cheap guard that briefs/targets keep round-tripping).
  // The brief is left for markRound's client-brief-target-scope cross-check;
  // run-round.sh purges 'QA Brief%' briefs + their targets at round start.
  await step(page, p, 'staff-brief-target-create', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json().catch(() => []);
      const unit = (Array.isArray(units) ? units : []).find(u => u.propertyId === window.QA_FIX.bluewater);
      if (!unit) return { fail: 'no Bluewater unit found' };
      const bRes = await fetch('/api/unit-briefs', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ unitId: unit.id, title: `QA Brief R${round} target-scope` }) });
      const brief = bRes.ok ? await bRes.json() : null;
      if (!brief?.id) return { fail: `brief create ${bRes.status}` };
      const tRes = await fetch(`/api/unit-briefs/${brief.id}/targets`, { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ operatorName: `QA-TGT-R${round}`, priority: 'A' }) });
      // No GET-by-id route exists — the list endpoint is what the tracker and
      // Brief dialog read, and it rides the targets along.
      const list = await (await fetch('/api/unit-briefs', { headers: auth })).json().catch(() => []);
      const mine = (Array.isArray(list) ? list : []).find(b => b.id === brief.id);
      return { briefId: brief.id, targetStatus: tRes.status, targets: (mine?.targets || []).map(t => t.operatorName) };
    }, ROUND);
    if (r.fail) throw new Error(r.fail);
    if (r.targetStatus !== 200) throw new Error(`target add failed (${r.targetStatus})`);
    if (!r.targets.includes(`QA-TGT-R${ROUND}`)) throw new Error('added target missing from brief read-back');
    cross.briefId = r.briefId;
  });

  // A team chat's CREATOR must get their own member row (seen=true) at
  // creation — without it a 1:1 renders as a GROUP on the other side and
  // the creator never gets an unread dot (r420 fix). Thread title matches
  // the 'QA Thread%' purge pattern; deleted in-scenario anyway.
  await step(page, p, 'staff-dm-creator-member-row', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json().catch(() => ({}));
      const myId = me?.id || me?.user?.id;
      if (!myId) return { fail: 'no self id from /api/auth/me' };
      const users = await (await fetch('/api/users', { headers: auth })).json().catch(() => []);
      const other = (Array.isArray(users) ? users : []).find((u) => u.id !== myId && u.id !== '__chatbgp__');
      if (!other) return { fail: 'no second user to DM' };
      const cRes = await fetch('/api/chat/threads', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: `QA Thread DM R${round}`, isAiChat: false, memberIds: [other.id] }) });
      if (!cRes.ok) return { fail: `thread create ${cRes.status}` };
      const thread = await cRes.json();
      const list = await (await fetch('/api/chat/threads', { headers: auth })).json().catch(() => []);
      const mine = (Array.isArray(list) ? list : []).find((t) => t.id === thread.id);
      const out = {
        members: mine?.members || [],
        myRow: (mine?.members || []).find((m) => m.id === myId) || null,
        otherRow: (mine?.members || []).find((m) => m.id === other.id) || null,
      };
      await fetch(`/api/chat/threads/${thread.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return out;
    }, ROUND);
    if (r.fail) throw new Error(r.fail);
    if (!r.otherRow) throw new Error('invited member missing a member row');
    if (!r.myRow) throw new Error('creator missing their own member row (1:1 renders as group for the other side)');
    if (r.myRow.seen !== true) throw new Error('creator member row not seen=true at creation');
  });

  // Phone breadcrumb endpoint (2026-08-29): POST /api/client-log must accept
  // an authed post (200 {ok:true}) and reject an unauthed one (401) — the
  // group-photo flow on phones depends on it for debugging.
  await step(page, p, 'staff-client-log-breadcrumb', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const okRes = await fetch('/api/client-log', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ tag: 'qa-probe' }) });
      const okBody = okRes.ok ? await okRes.json().catch(() => ({})) : {};
      return { authedStatus: okRes.status, ok: okBody.ok };
    });
    if (r.authedStatus !== 200 || r.ok !== true) throw new Error(`authed client-log ${r.authedStatus} ok=${r.ok}`);
    // Anon probe from Node — a page fetch would ride the session cookie.
    const anon = await fetch(`${BASE}/api/client-log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: 'qa-probe-anon' }) });
    if (anon.status !== 401) throw new Error(`unauthed client-log ${anon.status} (expected 401)`);
  });

  // Invoice-verdict alarm (2026-08-19 feature): a deal past its target date
  // with no verdict must show in /pending for its agent; "slipping" demands a
  // date (400 bare), re-dates the deal, and clears the pending list. The deal
  // is API-created LAST in victoriaRound and deleted in the same scenario so
  // the un-dismissable alarm banner never overlays other browser scenarios;
  // run-round.sh's 'QA-R%' purge sweeps any mid-death survivors.
  await step(page, p, 'staff-deal-verdict-flow', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const past = new Date(Date.now() - 5 * 86400000).toISOString();
      const cRes = await fetch('/api/crm/deals', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ name: `QA-R${round} verdict probe`, dealType: 'Consultant', status: 'SOL', fee: 1000, targetDate: past, internalAgent: ['Victoria Broadhead'] }) });
      const deal = cRes.ok ? await cRes.json() : null;
      if (!deal?.id) return { fail: `deal create ${cRes.status}` };
      const out = { dealId: deal.id };
      const pending1 = await (await fetch('/api/deal-verdicts/pending', { credentials: 'include', headers: auth })).json();
      out.listed = (pending1.deals || []).some(d => d.id === deal.id);
      out.overdue = (pending1.deals || []).find(d => d.id === deal.id)?.daysOverdue;
      const bare = await fetch(`/api/deal-verdicts/${deal.id}`, { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ verdict: 'slipping' }) });
      out.bareStatus = bare.status;
      const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const slip = await fetch(`/api/deal-verdicts/${deal.id}`, { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ verdict: 'slipping', newTargetDate: nextMonth }) });
      out.slipStatus = slip.status;
      const pending2 = await (await fetch('/api/deal-verdicts/pending', { credentials: 'include', headers: auth })).json();
      out.stillListed = (pending2.deals || []).some(d => d.id === deal.id);
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json().catch(() => []);
      out.newTarget = (Array.isArray(deals) ? deals : []).find(d => d.id === deal.id)?.targetDate || null;
      out.deleteStatus = (await fetch(`/api/crm/deals/${deal.id}`, { method: 'DELETE', credentials: 'include', headers: auth })).status;
      return out;
    }, ROUND);
    if (r.fail) throw new Error(r.fail);
    if (!r.listed) throw new Error('overdue deal missing from /api/deal-verdicts/pending');
    if (!(r.overdue >= 4)) throw new Error(`daysOverdue wrong (${r.overdue}, expected ~5)`);
    if (r.bareStatus !== 400) throw new Error(`slipping without a date should 400 (got ${r.bareStatus})`);
    if (r.slipStatus !== 200) throw new Error(`slipping verdict failed (${r.slipStatus})`);
    if (r.stillListed) throw new Error('deal still pending after a verdict this month');
    if (!r.newTarget || new Date(r.newTarget) < new Date()) throw new Error(`slipping did not re-date the deal (targetDate ${r.newTarget})`);
    if (r.deleteStatus !== 200 && r.deleteStatus !== 204) throw new Error(`probe deal cleanup failed (${r.deleteStatus})`);
  });

  // Staff logs turnover entries — one on an in-slice brand, one on an
  // out-of-slice company (Hammerson) — so Mark's round can prove the client
  // turnover read is sliced and the write staff-only. run-round.sh purges
  // the rows by the QA-PROBE notes marker next round.
  await step(page, p, 'staff-turnover-entries', async () => {
    const marker = `QA-PROBE turnover R${ROUND}`;
    const r = await page.evaluate(async (note) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const companies = await (await fetch('/api/crm/companies', { headers: auth })).json();
      const arr = Array.isArray(companies) ? companies : (companies?.data || []);
      const brand = arr.find((c) => c.id === window.QA_FIX.brand);
      if (!brand) return { skip: true };
      const hidden = arr.find((c) => /hammerson/i.test(c.name || ''));
      const mk = (company, tag) => fetch('/api/turnover', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ company_id: company.id, company_name: company.name, period: 'QA FY', turnover: 999999, source: 'Conversation', notes: `${note} ${tag}` }) });
      const pv = await mk(brand, 'visible');
      if (!pv.ok) return { ok: false, why: `visible POST ${pv.status}` };
      if (hidden) {
        const ph = await mk(hidden, 'hidden');
        if (!ph.ok) return { ok: false, why: `hidden POST ${ph.status}` };
      }
      return { ok: true, hiddenMade: !!hidden };
    }, marker);
    if (r.skip) return;
    if (!r.ok) throw new Error(`staff turnover entry failed (${r.why})`);
    cross.turnoverMarker = marker;
    cross.turnoverHiddenMade = r.hiddenMade;

    // The 999999 probe value sits on formatCurrency's rounding edge: the
    // board must show it as £1.0m, never the r365 "£1000k" regression.
    await page.goto(`${BASE}/turnover`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes('£1000k')) throw new Error('turnover board renders £1000k (formatCurrency rounding edge regressed)');
    if (!body.includes('£1.0m')) throw new Error('turnover board missing £1.0m for the 999999 probe entry');

    // The brands-hub Overview "Turnover Leaders" tile has its own formatter —
    // r366 caught it rendering the same probe as £1000k after r365's fix.
    await page.goto(`${BASE}/brands`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const hubBody = await page.evaluate(() => document.body.innerText);
    if (hubBody.includes('£1000k') || hubBody.includes('£1000m')) throw new Error('brands hub renders £1000k/£1000m (formatTurnover rounding edge regressed)');
  });

  await step(page, p, 'staff-brochure-bad-id-400', async () => {
    // r468: a malformed :bid (the literal "undefined") used to reach the
    // uuid-typed query and 500; the guard must 400 it, and a well-formed
    // but missing uuid must still 404. Node-side fetch so the deliberate
    // 4xx rows don't land in the page issue log.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const bad = await fetch(`${BASE}/api/properties/${BLUEWATER}/brochures/undefined`, { method: 'DELETE', ...auth });
    if (bad.status !== 400) throw new Error(`brochure DELETE with bad id expected 400, got ${bad.status}`);
    const miss = await fetch(`${BASE}/api/properties/${BLUEWATER}/brochures/00000000-0000-4000-8000-000000000000`, { method: 'DELETE', ...auth });
    if (miss.status !== 404) throw new Error(`brochure DELETE with missing uuid expected 404, got ${miss.status}`);
  });

  await step(page, p, 'staff-expenses-cover-and-admin-gate', async () => {
    // r482: GET /api/expenses/stage1-cover was shadowed by /api/expenses/:id
    // (403 "not your expense" for every non-admin, so the approvals page's
    // "Layla is covering" state never loaded). Must be 200 for any staff;
    // the POST stays gated to Wendy/Layla/admins, and the admin expense
    // list stays 403 for non-admin staff (the /expenses page itself is
    // AdminRoute-gated client-side as of r482). Node-side fetch so the
    // deliberate 403 rows don't land in the page issue log.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const cov = await fetch(`${BASE}/api/expenses/stage1-cover`, auth);
    if (cov.status !== 200) throw new Error(`staff GET stage1-cover expected 200, got ${cov.status} (route shadowed by /api/expenses/:id again?)`);
    const body = await cov.json();
    if (typeof body?.active !== 'boolean') throw new Error('stage1-cover did not return {active: boolean}');
    const post = await fetch(`${BASE}/api/expenses/stage1-cover`, { method: 'POST', headers: { ...auth.headers, 'content-type': 'application/json' }, body: JSON.stringify({ active: true }) });
    if (post.status !== 403) throw new Error(`victoria POST stage1-cover expected 403, got ${post.status}`);
    const list = await fetch(`${BASE}/api/expenses`, auth);
    if (list.status !== 403) throw new Error(`victoria GET /api/expenses (admin list) expected 403, got ${list.status}`);
  });

  await step(page, p, 'staff-crm-stats-active-deals', async () => {
    // r488: the mobile Today page's "Active Deals" KPI reads
    // stats.activeDeals, which /api/crm/stats never returned — the tile was
    // hardwired to 0 for everyone. Must be a number, and never exceed the
    // total deal count. Node-side fetch, no page-log noise.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const r = await fetch(`${BASE}/api/crm/stats`, auth);
    if (r.status !== 200) throw new Error(`GET /api/crm/stats expected 200, got ${r.status}`);
    const body = await r.json();
    if (typeof body?.activeDeals !== 'number') throw new Error('crm/stats has no numeric activeDeals (Today KPI regresses to 0)');
    if (typeof body?.deals !== 'number' || body.activeDeals > body.deals) throw new Error(`activeDeals ${body.activeDeals} > deals ${body.deals}`);
  });

  await step(page, p, 'staff-evidence-plans-list', async () => {
    // r471: Evidence Plans (arrived via the d0b79fe JOGQK merge) — staff
    // list must stay reachable. Node-side fetch, no page-log noise.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const r = await fetch(`${BASE}/api/evidence-plans`, auth);
    if (r.status !== 200) throw new Error(`staff GET /api/evidence-plans expected 200, got ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body)) throw new Error('staff GET /api/evidence-plans did not return an array');
  });

  await step(page, p, 'staff-evidence-plan-lifecycle', async () => {
    // r472: full CRUD sweep of the Evidence Plans API — create plan, draw
    // unit, add entry, delete plan (cascade must leave no orphan rows in
    // the list payload). Node-side fetch, cleans up after itself.
    const auth = { Authorization: 'Bearer ' + page.qaToken, 'Content-Type': 'application/json' };
    const mk = await fetch(`${BASE}/api/evidence-plans`, { method: 'POST', headers: { Authorization: auth.Authorization }, body: (() => { const fd = new FormData(); fd.append('name', `QA-EVP R${ROUND}`); return fd; })() });
    if (mk.status !== 200) throw new Error(`plan create expected 200, got ${mk.status}`);
    const plan = await mk.json();
    try {
      const u = await fetch(`${BASE}/api/evidence-plans/${plan.id}/units`, { method: 'POST', headers: auth, body: JSON.stringify({ unitRef: 'QA1', polygon: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }] }) });
      if (u.status !== 200) throw new Error(`unit create expected 200, got ${u.status}`);
      const unit = await u.json();
      const e = await fetch(`${BASE}/api/evidence-plans/${plan.id}/entries`, { method: 'POST', headers: auth, body: JSON.stringify({ unitId: unit.id, unitRef: 'QA1', tenant: 'QA Tenant', zoneA: 111 }) });
      if (e.status !== 200) throw new Error(`entry create expected 200, got ${e.status}`);
      const full = await (await fetch(`${BASE}/api/evidence-plans/${plan.id}`, { headers: { Authorization: auth.Authorization } })).json();
      if (full.units?.length !== 1 || full.entries?.length !== 1) throw new Error(`plan detail expected 1 unit + 1 entry, got ${full.units?.length}/${full.entries?.length}`);
    } finally {
      const del = await fetch(`${BASE}/api/evidence-plans/${plan.id}`, { method: 'DELETE', headers: { Authorization: auth.Authorization } });
      if (del.status !== 200) throw new Error(`plan delete expected 200, got ${del.status}`);
    }
    const after = await (await fetch(`${BASE}/api/evidence-plans`, { headers: { Authorization: auth.Authorization } })).json();
    if (after.some((pl) => pl.id === plan.id)) throw new Error('deleted plan still in the list');
  });

  await step(page, p, 'staff-deals-table-editors', async () => {
    // Other half of client-deals-table-read-only-parties (r534): the client
    // read-only party cells must not cost staff their inline pickers.
    // /deals opens on the WIP report for staff — the Deals tab holds the table.
    await page.goto(`${BASE}/deals`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
      await page.waitForTimeout(1000);
      await page.goto(`${BASE}/deals`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    });
    await page.waitForTimeout(3000);
    await page.locator('text=Deals').nth(1).click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    if (!(await page.locator('[data-testid="inline-link-select-trigger"]').count())) {
      throw new Error('staff lost the inline party pickers on the deals table');
    }
    if (await page.locator('[data-testid="inline-link-readonly"]').count()) {
      throw new Error('staff deals table rendered client read-only party cells');
    }
  });

  await step(page, p, 'staff-properties-table-pickers-kept', async () => {
    // Other half of client-properties-table-readonly-cells (r542): the client
    // read-only dash must not cost staff the tenant / BGP-contact pickers.
    await page.goto(`${BASE}/properties`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
      await page.waitForTimeout(1000);
      await page.goto(`${BASE}/properties`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    });
    await page.waitForSelector('[data-testid^="tenants-readonly-"], [data-testid^="add-tenant-"]', { timeout: 25000 })
      .catch(() => { throw new Error('staff properties table never rendered a tenants cell (did it load?)'); });
    for (const kind of ['add-tenant', 'add-agent']) {
      if (!(await page.locator(`[data-testid^="${kind}-"]`).count())) {
        throw new Error(`staff lost the ${kind} picker on the properties table`);
      }
    }
    for (const kind of ['tenants', 'agents']) {
      if (await page.locator(`[data-testid^="${kind}-readonly-"]`).count()) {
        throw new Error(`staff properties table rendered the client read-only ${kind} cell`);
      }
    }
  });

  // Staff half of the r535 client-leads-guard additions: blocking the CRM
  // leads pipeline and gating landlord packs for clients must not cost BGP
  // its own prospecting board or its packs. A 404 on the pack filename is
  // the RIGHT staff answer (no such file) — a 403 would mean the gate leaked
  // onto staff.
  await step(page, p, 'staff-crm-leads-and-packs-kept', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await fetch('/api/crm/leads', { headers: auth }).catch(() => ({ status: 0 }));
      return {
        list: list.status,
        isArray: list.ok ? Array.isArray(await list.json().catch(() => null)) : false,
        pack: (await fetch('/api/crm/landlord-packs/qa-probe-nonexistent-pack.pdf', { headers: auth }).catch(() => ({ status: 0 }))).status,
      };
    });
    if (r.list !== 200) throw new Error(`staff lost the CRM leads pipeline (expected 200, got ${r.list})`);
    if (!r.isArray) throw new Error('staff CRM leads list did not come back as an array');
    if (r.pack === 403) throw new Error('the client landlord-pack gate leaked onto staff (403)');
  });

  // Staff half of the r536 dashboard block: BGP's own firm fee summary and the
  // per-agent leaderboard power the /hr overview hero, so the client gate must
  // not cost staff either.
  await step(page, p, 'staff-firm-dashboard-kept', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const j = async (url) => {
        const res = await fetch(url, { headers: auth }).catch(() => ({ status: 0 }));
        return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
      };
      return { summary: await j('/api/dashboard/firm-summary'), board: await j('/api/dashboard/individual-leaderboard') };
    });
    if (r.summary.status !== 200) throw new Error(`staff lost the firm fee summary (expected 200, got ${r.summary.status})`);
    if (typeof r.summary.body?.wipPence !== 'number') throw new Error('firm summary came back without a WIP figure');
    if (r.board.status !== 200) throw new Error(`staff lost the individual leaderboard (expected 200, got ${r.board.status})`);
    if (!Array.isArray(r.board.body?.topBiller)) throw new Error('leaderboard came back without a topBiller list');
  });

  // Staff-keeps counterpart to the r537 client blocks: the /map annotation
  // layer sidebar and the news Sources tab's paywall-login panel both live
  // behind newly-blocked prefixes, so prove staff still get a full layer
  // roundtrip (create → listed with its name → delete) and the cookie
  // health list. A regression here is a staff surface losing its data.
  await step(page, p, 'staff-map-layers-and-news-config-kept', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const name = 'QA-PROBE Layer ' + Date.now();
      const made = await fetch('/api/map-layers', {
        method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name, color: '#ef4444', sharedWithTeam: true }),
      }).catch(() => ({ ok: false, status: 0 }));
      const createStatus = made.status;
      const id = made.ok ? (await made.json().catch(() => ({})))?.id : null;
      const listRes = await fetch('/api/map-layers', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const list = listRes.ok ? await listRes.json().catch(() => []) : [];
      let delStatus = 0;
      if (id) delStatus = (await fetch(`/api/map-layers/${id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      const cookiesRes = await fetch('/api/news-feed/auth-cookies/health', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const cookies = cookiesRes.ok ? await cookiesRes.json().catch(() => ({})) : null;
      return {
        createStatus, listStatus: listRes.status, delStatus,
        seen: Array.isArray(list) && list.some((l) => l.name === name && l.mine === true),
        cookieStatus: cookiesRes.status,
        cookieCount: Array.isArray(cookies?.status) ? cookies.status.length : -1,
      };
    });
    if (![200, 201].includes(r.createStatus)) throw new Error(`staff lost map-layer create (expected 200/201, got ${r.createStatus})`);
    if (r.listStatus !== 200) throw new Error(`staff lost the map-layer list (expected 200, got ${r.listStatus})`);
    if (!r.seen) throw new Error('staff map-layer list came back without the layer just created');
    if (r.delStatus !== 200) throw new Error(`staff lost map-layer delete (expected 200, got ${r.delStatus})`);
    if (r.cookieStatus !== 200) throw new Error(`staff lost the paywall cookie health list (expected 200, got ${r.cookieStatus})`);
    if (r.cookieCount < 1) throw new Error('paywall cookie health came back without any publication rows');
  });

  await step(page, p, 'staff-board-report-category-labels', async () => {
    // r543: the Board Report's market-insights category breakdown was
    // printing the raw news_sources key "brand:<uuid>" as a board-facing
    // label. Those rows must resolve to the brand's name.
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/board-report', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const body = res.ok ? await res.json().catch(() => ({})) : {};
      const cats = body?.marketInsights?.categoryBreakdown || [];
      return { status: res.status, cats: cats.map((c) => c.category) };
    });
    if (r.status !== 200) throw new Error(`staff lost the board report (expected 200, got ${r.status})`);
    if (!r.cats.length) throw new Error('board report came back with no category breakdown');
    const raw = r.cats.filter((c) => typeof c === 'string' && c.startsWith('brand:'));
    if (raw.length) throw new Error(`board report still labels brand feeds with raw keys: ${raw.join(', ')}`);
  });

  await step(page, p, 'staff-tenancy-dupe-no-second-tracker-card', async () => {
    // r539: a duplicated spine row (same unit listed twice on the tenancy
    // schedule) used to spawn a SECOND Letting Tracker card via
    // fanOutTenancyStatus — the name-link only adopts unowned rows, so a
    // sibling spine row's card was invisible to it. Add a duplicate-named
    // tenancy row, assert the tracker card count for that name is unchanged,
    // then delete the row we added. Node-side fetch, cleans up after itself.
    const auth = { Authorization: 'Bearer ' + page.qaToken, 'Content-Type': 'application/json' };
    const units = async () => {
      const r = await fetch(`${BASE}/api/available-units?propertyId=${BLUEWATER}`, { headers: auth });
      if (r.status !== 200) throw new Error(`staff GET /api/available-units expected 200, got ${r.status}`);
      const body = await r.json();
      return Array.isArray(body) ? body : (body.units || []);
    };
    const before = await units();
    if (before.length === 0) throw new Error('staff tracker came back empty for Bluewater');
    const name = before[0].unitName;
    const countBefore = before.filter((u) => u.unitName === name).length;
    const mk = await fetch(`${BASE}/api/tenancy-schedule/unit`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ property_id: BLUEWATER, unit_number: name, status: 'Vacant' }),
    });
    if (mk.status !== 200) throw new Error(`tenancy row create expected 200, got ${mk.status}`);
    const row = await mk.json();
    try {
      const after = await units();
      const countAfter = after.filter((u) => u.unitName === name).length;
      if (countAfter !== countBefore) {
        throw new Error(`duplicate spine row changed the tracker card count for "${name}": ${countBefore} -> ${countAfter}`);
      }
    } finally {
      if (row?.id) await fetch(`${BASE}/api/tenancy-schedule/unit/${row.id}`, { method: 'DELETE', headers: auth }).catch(() => {});
    }
  });

  await step(page, p, 'staff-resync-mirror-is-idempotent', async () => {
    // r539 companion: the property-wide "Re-sync" is the other amplifier —
    // it fans out every spine row, so a dirty schedule used to grow the
    // tracker on each press. Two consecutive re-syncs must leave the card
    // count exactly where it started.
    const auth = { Authorization: 'Bearer ' + page.qaToken, 'Content-Type': 'application/json' };
    const count = async () => {
      const r = await fetch(`${BASE}/api/available-units?propertyId=${BLUEWATER}`, { headers: auth });
      if (r.status !== 200) throw new Error(`staff GET /api/available-units expected 200, got ${r.status}`);
      const body = await r.json();
      return (Array.isArray(body) ? body : (body.units || [])).length;
    };
    const before = await count();
    for (let i = 0; i < 2; i++) {
      const rs = await fetch(`${BASE}/api/properties/${BLUEWATER}/resync-mirror`, { method: 'POST', headers: auth });
      if (rs.status !== 200) throw new Error(`staff resync-mirror expected 200, got ${rs.status}`);
    }
    const after = await count();
    if (after !== before) throw new Error(`re-sync changed the Bluewater tracker card count: ${before} -> ${after}`);
  });

  await step(page, p, 'staff-requirement-fits-matches', async () => {
    // r540: the Requirements board's "Fits" column and its KPI both come from
    // /matches. A logged requirement with a size band must come back with at
    // least one fitting unit, or the board's whole point is dead.
    const auth = { Authorization: 'Bearer ' + page.qaToken, 'Content-Type': 'application/json' };
    const cr = await fetch(`${BASE}/api/crm/requirements-leasing`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'QA-REQ-FITS', use: ['Restaurant'], size: ['1,000 - 2,000 sq ft'], requirementLocations: ['South East'], status: 'Active' }),
    });
    if (cr.status !== 201) throw new Error(`staff POST requirements-leasing expected 201, got ${cr.status}`);
    const created = await cr.json();
    try {
      const m = await fetch(`${BASE}/api/crm/requirements-leasing/matches`, { headers: auth });
      if (m.status !== 200) throw new Error(`staff GET requirements matches expected 200, got ${m.status}`);
      const body = await m.json();
      if (!body.unitPool) throw new Error('requirements matches returned an empty unit pool');
      const hit = body.matches?.[created.id];
      if (!hit || !hit.count) throw new Error('a 1,000-2,000 sq ft requirement matched no available unit');
      if (!hit.top?.[0]?.unitName) throw new Error('fits row carries no unit name');
    } finally {
      await fetch(`${BASE}/api/crm/requirements-leasing/${created.id}`, { method: 'DELETE', headers: auth }).catch(() => {});
    }
  });

  await step(page, p, 'staff-unit-brief-keeps-every-target', async () => {
    // r540: targets added from the Suggest-Targets dialog used to each mint a
    // NEW brief for the unit, and the unit only ever reads its newest brief —
    // so every target but the last one vanished. Two targets added to a unit
    // must both come back on that unit's brief.
    const auth = { Authorization: 'Bearer ' + page.qaToken, 'Content-Type': 'application/json' };
    const ur = await fetch(`${BASE}/api/available-units?propertyId=${BLUEWATER}`, { headers: auth });
    const units = await ur.json();
    const unit = (Array.isArray(units) ? units : (units.units || []))[0];
    if (!unit?.id) throw new Error('no Bluewater unit to brief');
    const existing = await (await fetch(`${BASE}/api/available-units/${unit.id}/brief`, { headers: auth })).json();
    let briefId = existing?.id;
    let mine = false;
    if (!briefId) {
      const b = await fetch(`${BASE}/api/unit-briefs`, { method: 'POST', headers: auth, body: JSON.stringify({ unitId: unit.id }) });
      if (b.status !== 200) throw new Error(`staff POST unit-briefs expected 200, got ${b.status}`);
      briefId = (await b.json()).id; mine = true;
    }
    const names = ['QA-PROBE Target A', 'QA-PROBE Target B'];
    try {
      for (const operatorName of names) {
        const t = await fetch(`${BASE}/api/unit-briefs/${briefId}/targets`, { method: 'POST', headers: auth, body: JSON.stringify({ operatorName, priority: 'B' }) });
        if (t.status !== 200) throw new Error(`staff POST brief target expected 200, got ${t.status}`);
      }
      const view = await (await fetch(`${BASE}/api/available-units/${unit.id}/brief`, { headers: auth })).json();
      const got = (view?.targets || []).map((t) => t.operatorName);
      for (const n of names) if (!got.includes(n)) throw new Error(`unit brief lost target ${n} (sees: ${got.join(', ') || 'none'})`);
    } finally {
      const view = await (await fetch(`${BASE}/api/available-units/${unit.id}/brief`, { headers: auth })).json().catch(() => null);
      for (const t of (view?.targets || [])) {
        if (names.includes(t.operatorName)) await fetch(`${BASE}/api/unit-briefs/targets/${t.id}`, { method: 'DELETE', headers: auth }).catch(() => {});
      }
      if (mine) await fetch(`${BASE}/api/unit-briefs/${briefId}`, { method: 'DELETE', headers: auth }).catch(() => {});
    }
  });

  await step(page, p, 'staff-phone-chat-no-nested-controls', async () => {
    // r541: the phone chat header nested the group-pic <button> INSIDE the
    // group-settings <button> — invalid DOM that React warned about on every
    // group thread. Nested interactive controls swallow taps unpredictably,
    // so guard the whole phone chat surface, not just that one header.
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await page.goto(`${BASE}/messages`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2500);
      const thread = page.locator('[data-testid^="mobile-thread-"]').first();
      if (await thread.count()) {
        await thread.click();
        await page.waitForTimeout(2500);
      }
      const nested = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button button, a a')).map(
          (el) => `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') || el.className || ''}]`.slice(0, 80)
        )
      );
      if (nested.length) throw new Error(`nested interactive controls on the phone chat surface: ${nested.join(', ')}`);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
}

async function markRound(page, cross) {
  const p = 'mark';

  // 1. Crawl the client surface. The per-property leasing board is included
  //    because it used to fire a staff-only /privacy fetch that 403'd for
  //    clients on every load (r345) — the response hook catches a relapse.
  for (const path of ['/', '/contacts', '/brands', '/comps', '/deals', '/leasing-schedule', `/leasing-schedule/${BLUEWATER}`, '/m/images', '/news', '/tasks']) {
    await visit(page, p, path);
  }

  // 2. Add a contact to a brand through the client CRM
  await step(page, p, 'client-add-contact', async () => {
    await page.goto(`${BASE}/contacts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const addBtn = page.locator('[data-testid^="client-add-contact-"]').first();
    if (!(await addBtn.count())) throw new Error('no Add-contact button on any brand card');
    await addBtn.click();
    await page.waitForTimeout(600);
    await page.locator('[data-testid="contact-dialog-name"]').fill(`QA Contact R${ROUND}`);
    await page.locator('[data-testid="contact-dialog-role"]').fill('Acquisitions (bot test)');
    await page.getByRole('button', { name: /save|add/i }).last().click();
    await page.waitForTimeout(1200);
    const errToast = await page.getByText(/failed|error/i).count();
    if (errToast) throw new Error('error toast after saving contact');
  });

  // 3. Image Studio: scoped gallery, no staff actions
  await step(page, p, 'client-image-studio', async () => {
    await page.goto(`${BASE}/m/images`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    if (await page.locator('[data-testid="mobile-images-upload"]').count())
      throw new Error('client sees the Add photos (upload) button');
  });

  // 4. Comps: net-effective column present, no inline editors
  // r532 counterpart to rival-comp-files-and-reqinv-guard: scoping those two
  // sub-reads must not lock the OWNING landlord out of their own rows.
  await step(page, p, 'client-comp-files-and-reqinv-own-roundtrip', async () => {
    const compId = cross.compId;
    const reqInvId = cross.reqInvId;
    if (!compId && !reqInvId) return;
    const r = await page.evaluate(async ([comp, reqInv]) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const out = {};
      if (comp) {
        const files = await fetch(`/api/crm/comps/${comp}/files`, { headers: auth }).catch(() => ({ status: 0 }));
        out.filesStatus = files.status;
        out.fileRows = files.ok ? ((await files.json().catch(() => [])) || []).length : -1;
        const bulk = await fetch(`/api/crm/comps/files/bulk?compIds=${comp}`, { headers: auth }).catch(() => ({ status: 0 }));
        out.bulkRows = bulk.ok ? ((await bulk.json().catch(() => [])) || []).length : -1;
      }
      if (reqInv) {
        const detail = await fetch(`/api/crm/requirements-investment/${reqInv}`, { headers: auth }).catch(() => ({ status: 0 }));
        out.reqInvStatus = detail.status;
        out.reqInvName = detail.ok ? ((await detail.json().catch(() => ({}))).name || '') : '';
      }
      return out;
    }, [compId, reqInvId]);
    if (compId && r.filesStatus !== 200) throw new Error(`owning client locked out of their own comp files (${r.filesStatus})`);
    if (compId && r.fileRows < 1) throw new Error(`own comp files came back empty (${r.fileRows} rows)`);
    if (compId && r.bulkRows < 1) throw new Error(`own comp files/bulk came back empty (${r.bulkRows} rows)`);
    if (reqInvId && r.reqInvStatus !== 200) throw new Error(`owning client locked out of their own investment requirement (${r.reqInvStatus})`);
    if (reqInvId && !/QA-REQINV/.test(r.reqInvName)) throw new Error(`own investment requirement detail did not carry the row (name="${r.reqInvName}")`);
  });

  // r533 counterpart to rival-chat-media-and-deal-subreads-guard: gating
  // chat-media must not lock the client out of files it legitimately has —
  // its own upload, and a staff file shared into a thread it belongs to.
  await step(page, p, 'client-chat-media-own-roundtrip', async () => {
    const r = await page.evaluate(async ([shared, priv, round]) => {
      const bearer = 'Bearer ' + localStorage.getItem('authToken');
      const fd = new FormData();
      fd.append('files', new Blob(['QA-PROBE client media'], { type: 'text/plain' }), `QA-PROBE chat media client R${round}.txt`);
      const up = await fetch('/api/chat/upload', { method: 'POST', credentials: 'include',
        headers: { Authorization: bearer }, body: fd });
      const own = up.ok ? (((await up.json().catch(() => ({}))).files || [])[0] || null) : null;
      const get = async (name) => name
        ? (await fetch(`/api/chat-media/${name}`, { credentials: 'include', headers: { Authorization: bearer } }).catch(() => ({ status: 0 }))).status
        : -1;
      const out = {
        uploadStatus: up.status,
        ownStatus: await get(own && own.url.replace('/api/chat-media/', '')),
        sharedStatus: await get(shared),
        privateStatus: await get(priv),
      };
      out.ownName = own ? own.url.replace('/api/chat-media/', '') : null;
      // Own deal sub-reads: keyless locally, so the pass mark is a 200
      // carrying connected:false — not a 403.
      const deals = await (await fetch('/api/crm/deals', { credentials: 'include', headers: { Authorization: bearer } })).json().catch(() => []);
      const dealId = (Array.isArray(deals) ? deals : [])[0]?.id || null;
      out.dealId = dealId;
      if (dealId) {
        for (const sub of ['related-emails', 'related-events']) {
          const res = await fetch(`/api/crm/deals/${dealId}/${sub}`, { credentials: 'include', headers: { Authorization: bearer } }).catch(() => ({ status: 0 }));
          out[sub] = res.status;
        }
      }
      return out;
    }, [cross.mediaShared || null, cross.mediaPrivate || null, ROUND]);
    if (r.uploadStatus !== 200) throw new Error(`client could not upload to chat (${r.uploadStatus})`);
    if (r.ownStatus !== 200) throw new Error(`client locked out of its OWN chat upload (${r.ownStatus})`);
    if (cross.mediaShared && r.sharedStatus !== 200) throw new Error(`client locked out of a file shared into its own thread (${r.sharedStatus})`);
    if (cross.mediaPrivate && r.privateStatus !== 403) throw new Error(`unshared staff chat-media readable by client (${r.privateStatus})`);
    if (r.dealId && r['related-emails'] !== 200) throw new Error(`client locked out of its own deal related-emails (${r['related-emails']})`);
    if (r.dealId && r['related-events'] !== 200) throw new Error(`client locked out of its own deal related-events (${r['related-events']})`);
    cross.clientDealId = r.dealId;
    cross.mediaClientOwn = r.ownName;
  });

  await step(page, p, 'client-comps-readonly', async () => {
    await page.goto(`${BASE}/comps`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const netEff = await page.getByText(/net effective/i).count();
    if (!netEff) throw new Error('Net Effective column missing on client comps');
    // r317: comps are read-only for clients — the staff toolbar must not
    // render and the write APIs must refuse (journey-verified this round).
    for (const t of ['button-create-comp', 'button-scan-news-comps', 'button-import-dataset']) {
      if (await page.getByTestId(t).count()) throw new Error(`staff comps control ${t} leaked to client`);
    }
    const writes = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const post = await fetch('/api/crm/comps', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: 'QA-COMP client-write-probe' }) });
      const list = await (await fetch('/api/crm/comps', { credentials: 'include', headers: auth })).json().catch(() => []);
      const first = Array.isArray(list) && list[0] ? list[0].id : null;
      const del = first
        ? (await fetch(`/api/crm/comps/${first}`, { method: 'DELETE', credentials: 'include', headers: auth })).status
        : 403;
      return { post: post.status, del };
    });
    if (writes.post !== 403) throw new Error(`client comp POST expected 403, got ${writes.post}`);
    if (writes.del !== 403) throw new Error(`client comp DELETE expected 403, got ${writes.del}`);
  });

  // 5. Cross-visibility: the deal Victoria just created must NOT leak unless
  //    it is a letting deal on a Landsec property (round-1 deal is neither).
  await step(page, p, 'cross-deal-scoping', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    if (cross.dealStamp) {
      const leaked = await page.getByText(cross.dealStamp, { exact: false }).count();
      if (leaked) throw new Error(`unscoped staff deal "${cross.dealStamp}" visible to client`);
    }
  });

  // Client can open the deal-create dialog with no fee element and no crash.
  // (Woody: "client can make a deal, hide the fee.") The full save requires
  // the same counterparty + completion-date fields the agent fills; the
  // end-to-end scoped, fee-stripped POST is covered by the server API test.
  await step(page, p, 'client-create-deal-no-fee', async () => {
    await page.goto(`${BASE}/deals`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    if (!(await page.locator('[data-testid="button-create-deal"]').count()))
      throw new Error('client has no New Deal button');
    await page.locator('[data-testid="button-create-deal"]').first().click();
    await page.waitForTimeout(800);
    // Dialog must render (no ErrorBoundary) with the name field...
    if (!(await page.locator('[data-testid="input-deal-name"]').count()))
      throw new Error('client create dialog did not render');
    // ...and none of the fee inputs / split / "Show all fields" escape hatch.
    if (await page.locator('#deal-fee-pct').count()) throw new Error('agency % input visible to client');
    if (await page.locator('#deal-fee').count()) throw new Error('total-fee input visible to client');
    if (await page.getByText('BGP fee split', { exact: false }).count()) throw new Error('BGP fee split visible to client');
    if (await page.locator('[data-testid="button-toggle-all-fields"]').count()) throw new Error('"Show all fields" (exposes fees) visible to client');
    await page.keyboard.press('Escape');
  });

  // Client edits a deal comment; any fee fields smuggled into the same PUT
  // must be dropped server-side (clients see fees, they never set them).
  // woodyRound's admin-fee-injection-audit confirms the staff-only fields
  // (feeNotes/commission — stripped from client responses) stayed clean.
  await step(page, p, 'client-deal-fee-injection-guard', async () => {
    const marker = `QA client edit R${ROUND}`;
    const r = await page.evaluate(async (m) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const deal = (Array.isArray(deals) ? deals : []).find((d) => /bluewater/i.test(d.name || ''));
      if (!deal) return { skip: true };
      const beforeFee = deal.fee ?? null;
      const beforeComments = deal.comments ?? null;
      const put = await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ comments: m, fee: 999999, feePercentage: 99, feeNotes: 'QA-FEE-INJECT', commission: 999999 }) });
      if (!put.ok) return { ok: false, why: `PUT ${put.status}` };
      const fresh = await (await fetch(`/api/crm/deals/${deal.id}`, { headers: auth })).json();
      const commentsPersisted = (fresh?.comments || '').includes(m);
      const feeUntouched = (fresh?.fee ?? null) === beforeFee;
      await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ comments: beforeComments }) }).catch(() => {});
      return { ok: true, commentsPersisted, feeUntouched };
    }, marker);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client deal edit failed (${r.why})`);
    if (!r.commentsPersisted) throw new Error('client comment edit did not persist');
    if (!r.feeUntouched) throw new Error('client PUT changed the deal fee — injection not stripped');
  });

  // Client authors an Operator Targeting Brief on one of their own units
  // (like the Tag Heuer / 145A Westgate brief) and adds a target operator.
  // (Woody: "one scenario for mark should be creating this on another unit.")
  await step(page, p, 'client-create-targeting-brief', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { ok: false, why: 'no available units in client scope' };
      const briefRes = await fetch(`/api/available-units/${unit.id}/brief`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'QA Brief — food-led operator', objective: 'Secure a savoury meal-occasion operator' }),
      });
      if (!briefRes.ok) return { ok: false, why: `brief create ${briefRes.status}` };
      const brief = await briefRes.json();
      const tRes = await fetch(`/api/unit-briefs/${brief.id}/targets`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorName: 'Honi Poke', category: 'Handheld global food' }),
      });
      if (!tRes.ok) return { ok: false, why: `target add ${tRes.status}` };
      return { ok: true, briefId: brief.id, unitId: unit.id };
    });
    if (!r.ok) throw new Error(r.why);
    // Clean up so briefs don't pile up across rounds.
    await page.evaluate(async (id) => {
      await fetch(`/api/unit-briefs/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
    }, r.briefId);
  });

  // The per-unit brief was enriched (terminal side) with a priority-categories
  // taxonomy and attached image_ids. A client editing their own brief must be
  // able to set BOTH and have them persist (new columns, client-scoped PATCH).
  await step(page, p, 'client-brief-enriched-fields', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const mk = await fetch(`/api/available-units/${unit.id}/brief`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: 'QA Brief — enriched fields' }) });
      if (!mk.ok) return { ok: false, why: `create ${mk.status}` };
      const brief = await mk.json();
      const cats = 'Tenant - Wellness, Tenant - Café';
      const imgIds = ['qa-img-1', 'qa-img-2'];
      const patch = await fetch(`/api/unit-briefs/${brief.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ priorityCategories: cats, imageIds: imgIds }) });
      if (!patch.ok) return { ok: false, why: `patch ${patch.status}` };
      const back = await patch.json();
      const catsOk = (back.priorityCategories || '') === cats;
      const imgOk = JSON.stringify(back.imageIds || []) === JSON.stringify(imgIds);
      await fetch(`/api/unit-briefs/${brief.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return { ok: true, catsOk, imgOk };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`enriched brief edit failed (${r.why})`);
    if (!r.catsOk) throw new Error('brief priorityCategories did not persist');
    if (!r.imgOk) throw new Error('brief imageIds did not persist');
  });

  // Client manages their own tasks: add via quick-add, mark complete, remove.
  // (My Tasks widget + page; every task endpoint is user-scoped.)
  // /tasks gives clients the full My Tasks page — quick-add included (Woody,
  // "client parity round 3": full My Tasks back for clients). The client must
  // be able to add a task, see it, complete it, and clean it up from the UI.
  await step(page, p, 'client-task-create-complete', async () => {
    const title = `QA Task R${ROUND}`;
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    const add = page.locator('[data-testid="input-add-task"]').first();
    if (!(await add.count())) throw new Error('no quick-add task input on the client My Tasks page');
    await add.fill(title);
    await add.press('Enter');
    await page.waitForTimeout(1200);
    const row = page.locator('[data-testid^="task-row-"]', { hasText: title }).first();
    if (!(await row.count())) throw new Error('task not visible after add');
    // Complete it, then clean up via the row's delete button.
    await row.locator('[data-testid^="task-toggle-"]').first().click().catch(() => {});
    await page.waitForTimeout(600);
    await row.locator('[data-testid^="task-delete-"]').first().click().catch(() => {});
    await page.waitForTimeout(400);
  });

  // Client property-detail page renders (tabs, no blank/crash). Cross-check
  // that staff-only surfaces (fee/WIP) never leak onto it.
  await step(page, p, 'client-property-detail', async () => {
    await page.goto(`${BASE}/properties/${BLUEWATER}`);
    // The property news panel polls, so networkidle can never settle here —
    // tolerate the timeout and assert on rendered content instead.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    if (await page.getByText('Page not found').count()) throw new Error('property detail is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('property detail rendered blank for client');
    // Client Files board (2026-08-03: "put back the files board but remove
    // the team name"): panel must render — folder content or the graceful
    // no-folder fallback — and never leak an internal team name.
    // Poll rather than trusting the fixed wait above — under round load the
    // page can still be on skeletons at this point (r256/r257 flake class).
    const panel = page.locator('[data-testid="client-property-folders-panel"]');
    await panel.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    if (!(await panel.count())) throw new Error('client Files board missing from the property page');
    const panelText = (await panel.innerText().catch(() => '')).trim();
    if (panelText.length < 10) throw new Error('client Files board rendered blank');
    for (const team of ['National', 'Westend', 'West End', 'Lease Advisory', 'Investment Team']) {
      if (new RegExp(`Set up by.*${team}|${team} folder tree`, 'i').test(panelText)) {
        throw new Error(`client Files board leaks internal team name "${team}"`);
      }
    }
  });

  // The client team calendar (task-25 surface, reported dead 2026-08-02):
  // Mark's /api/team-events must include the Landsec event Victoria created
  // this round and must NEVER include the Hammerson one. Guards both the
  // allowlist (a merge once dropped /api/team-events → blanket 403) and the
  // company_name scoping (an exact-string compare once blanked the calendar).
  await step(page, p, 'client-calendar-sees-own-events', async () => {
    if (!cross.calMine) return; // staff step skipped (midnight window)
    // Seeded event already in the past (chunk re-run) — nothing to assert.
    if (cross.calValidUntil && Date.parse(cross.calValidUntil) <= Date.now()) return;
    const r = await page.evaluate(async (args) => {
      const [mine, other] = args;
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/team-events', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const events = await res.json().catch(() => []);
      const rows = Array.isArray(events) ? events : [];
      const titles = rows.map((e) => e.title || '');
      const mineRow = rows.find((e) => (e.title || '').includes(mine));
      const att = mineRow?.attendees || [];
      return {
        ok: true,
        mine: !!mineRow,
        other: titles.some((t) => t.includes(other)),
        attendeesServed: Array.isArray(att) && att.some((s) => String(s).includes('mark.warne@landsec.com')),
      };
    }, [cross.calMine, cross.calOther]);
    if (!r.ok) throw new Error(`client calendar request failed (${r.status}) — team-events allowlist regressed?`);
    if (!r.mine) throw new Error("client calendar missing their own company's event (scoping regressed)");
    if (r.other) throw new Error("another client's event leaked into the client calendar");
    if (!r.attendeesServed) throw new Error("event attendees missing from the client's team-events payload (who-is-attending regressed)");
    // ROUTE check, not just API: ClientRouteGuard bounced /calendar to the
    // dashboard because the route was missing from CLIENT_ALLOWED_ROUTES —
    // the API worked while the click did nothing (live-site 2026-08-02).
    await page.goto(`${BASE}/calendar`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    const calUrl = new URL(page.url());
    if (calUrl.pathname !== '/calendar') throw new Error(`client bounced off /calendar to ${calUrl.pathname} (route guard)`);
  });

  // Client "Add event" (Woody, 2026-08-04): a client may create a calendar
  // event, but the server forces company_name to their OWN scope whatever the
  // body claims — so a client can't plant an event on another landlord's
  // calendar. Create one attributed (in the body) to a rival, assert it comes
  // back company-jailed to the client, shows on their own calendar, then
  // clean up.
  await step(page, p, 'client-calendar-add-event', async () => {
    const title = `QA-CAL-R${ROUND} client-add`;
    const r = await page.evaluate(async (t) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const start = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
      const end = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000).toISOString();
      const post = await fetch('/api/team-events', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: t, event_type: 'meeting', start_time: start, end_time: end, company_name: 'QA-RIVAL-Hammerson' }) });
      if (!post.ok) return { ok: false, why: `POST ${post.status}` };
      const made = await post.json();
      const list = await (await fetch('/api/team-events', { headers: auth })).json().catch(() => []);
      const seen = (Array.isArray(list) ? list : []).some((e) => (e.title || '') === t);
      if (made?.id) await fetch(`/api/team-events/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return { ok: true, company: made?.company_name ?? null, seen };
    }, title);
    if (!r.ok) throw new Error(`client could not add a calendar event (${r.why})`);
    if (r.company === 'QA-RIVAL-Hammerson' || !r.company) throw new Error(`client calendar event not company-jailed to their scope (got ${JSON.stringify(r.company)})`);
    if (!r.seen) throw new Error('client-created event absent from their own calendar');
  });

  // Calendar intelligence for clients: insights and the meeting briefing are
  // company-jailed and FEE-FREE (both used to 500 on phantom columns, and the
  // briefing was session-gated so client tokens always failed).
  await step(page, p, 'client-calendar-intelligence', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const ins = await fetch('/api/microsoft/calendar/insights', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const insBody = ins.ok ? await ins.json().catch(() => ({})) : {};
      const insText = JSON.stringify(insBody.insights || []).toLowerCase();
      const br = await fetch('/api/microsoft/calendar/briefing', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ subject: 'BGP x Landsec QA probe', companyName: 'Landsec',
          attendees: [{ emailAddress: { name: 'Mark Warne', address: 'mark.warne@landsec.com' } }] }) }).catch(() => ({ ok: false, status: 0 }));
      const brBody = br.ok ? await br.json().catch(() => ({})) : {};
      const deals = brBody?.crmContext?.deals || [];
      return {
        insOk: ins.ok, insFee: insText.includes('fee'),
        brOk: br.ok, dealFee: deals.some((d) => d.fee !== undefined && d.fee !== null),
        agentLeak: deals.some((d) => d.agent),
      };
    });
    if (!r.insOk) throw new Error('client calendar insights request failed');
    if (r.insFee) throw new Error('client insights mention fees (staff feed leaked)');
    if (!r.brOk) throw new Error('client meeting briefing request failed');
    if (r.dealFee || r.agentLeak) throw new Error('client briefing context leaked deal fee/agent');
  });

  // The client SharePoint browser (task-25 surface): the root endpoint must
  // never 401/403 for a client — 200 (folder linked) or the friendly 404
  // (not linked yet) are the only healthy answers locally.
  await step(page, p, 'client-sharepoint-surface', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/client/sharepoint/root', { headers: auth }).catch(() => ({ status: 0 }));
      let message = '';
      try { message = (await res.json()).message || ''; } catch {}
      return { status: res.status, message };
    });
    if (r.status === 401 || r.status === 403) throw new Error(`client SharePoint root refused (${r.status}) — gateway/allowlist regressed`);
    if (![200, 404].includes(r.status) && !/sharepoint/i.test(r.message)) throw new Error(`client SharePoint root unhealthy (${r.status}: ${r.message})`);
    // ROUTE check — same guard bug as /calendar: the page must open, not
    // bounce to the dashboard.
    await page.goto(`${BASE}/sharepoint`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    const spUrl = new URL(page.url());
    if (spUrl.pathname !== '/sharepoint') throw new Error(`client bounced off /sharepoint to ${spUrl.pathname} (route guard)`);
  });

  // A client may BROWSE the SharePoint tree (read, above) but must not WRITE
  // into BGP's SharePoint — no uploading files, deleting items, or creating
  // folders in the firm's document store. All such writes are staff-only.
  await step(page, p, 'client-sharepoint-write-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const post = async (url) => (await fetch(url, { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return {
        upload: await post('/api/sharepoint/upload'),
        clientUpload: await post('/api/client/sharepoint/upload'),
        del: await post('/api/sharepoint/delete'),
        mkdir: await post('/api/sharepoint/create-folder'),
      };
    });
    if (r.upload !== 403) throw new Error(`client uploaded to BGP SharePoint (expected 403, got ${r.upload})`);
    if (r.clientUpload !== 403) throw new Error(`client uploaded via the client SharePoint route (expected 403, got ${r.clientUpload})`);
    if (r.del !== 403) throw new Error(`client deleted from BGP SharePoint (expected 403, got ${r.del})`);
    if (r.mkdir !== 403) throw new Error(`client created a SharePoint folder (expected 403, got ${r.mkdir})`);
  });

  // Client adds a photo to one of their own units/schemes; the same upload to
  // a property outside their scope is refused. ("Adding photos for a unit and
  // scheme should be a task.")
  await step(page, p, 'client-add-unit-photo', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json();
      const list = Array.isArray(props) ? props : (props?.data || []);
      const mine = list[0];
      if (!mine) return { ok: false, why: 'no property in client scope' };
      // 1x1 red JPEG
      const b64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const fd = new FormData();
      fd.append('images', new Blob([arr], { type: 'image/jpeg' }), 'qa-unit-photo.jpg');
      fd.append('propertyId', mine.id);
      fd.append('category', 'Property');
      const up = await fetch('/api/image-studio/upload', { method: 'POST', headers: auth, body: fd });
      return { ok: up.ok, status: up.status, propertyId: mine.id };
    });
    if (!r.ok) throw new Error(`photo upload to own property failed (${r.status})`);
  });

  // Client news feed renders and a save/dismiss action works (per-user
  // engagement is client-allowed; the fetch/scrape trigger stays staff-only).
  await step(page, p, 'client-news-feed', async () => {
    await page.goto(`${BASE}/news`);
    // domcontentloaded, not networkidle: the feed streams external article
    // thumbnails/social previews continuously, so the network never goes idle
    // for 500ms and networkidle times out. The blank/dead-route checks below
    // still catch a genuinely broken page.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    if (await page.getByText('Page not found').count()) throw new Error('news is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('news feed rendered blank for client');
    // If any article is present, exercise a save toggle (round-trips the
    // client-allowed engage endpoint).
    const save = page.locator('[data-testid^="button-save-"]').first();
    if (await save.count()) { await save.click().catch(() => {}); await page.waitForTimeout(600); }
  });

  // News is READ + per-user engage for clients, but the feed MANAGEMENT
  // (tags, sources, retag, brand-feed generation, scrape trigger) is BGP
  // intel and must stay staff-only. engage stays allowed.
  await step(page, p, 'client-news-write-guards', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const probe = async (url) => (await fetch(url, { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      // engage needs a valid payload; the staff writes 403 at the gateway
      // before any body validation, so an empty body is fine for those.
      const engage = (await fetch('/api/news-feed/engage', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ articleId: 'qa-probe', action: 'dismiss' }) }).catch(() => ({ status: 0 }))).status;
      const staffWrites = {
        fetch: await probe('/api/news-feed/fetch'),
        tags: await probe('/api/news-feed/tags'),
        retag: await probe('/api/news-feed/retag'),
        sources: await probe('/api/news-feed/sources'),
        ensureBrandFeeds: await probe('/api/news-feed/ensure-brand-feeds'),
      };
      return { engage, staffWrites };
    });
    if (!(r.engage >= 200 && r.engage < 300)) throw new Error(`client news engage blocked (${r.engage})`);
    const leaked = Object.entries(r.staffWrites).filter(([, v]) => v >= 200 && v < 300).map(([k]) => k);
    if (leaked.length) throw new Error(`client allowed a staff-only news-feed write: ${leaked.join(', ')}`);
  });

  // Save → Saved list → UNSAVE must round-trip for a client. Save goes via
  // the allowed engage endpoint but unsave is its own route — r295 found it
  // missing from the write allowlist, leaving saved articles stuck forever
  // (the UI toasts "Removed" optimistically, so the failure was silent).
  await step(page, p, 'client-news-save-unsave-roundtrip', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const arts = await (await fetch('/api/news-feed/articles?limit=1', { credentials: 'include', headers: auth })).json();
      if (!Array.isArray(arts) || !arts.length) return { skip: true };
      const id = arts[0].id;
      const save = (await fetch('/api/news-feed/engage', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ articleId: id, action: 'save' }) })).status;
      const savedList = await (await fetch('/api/news-feed/saved', { credentials: 'include', headers: auth })).json();
      const inSaved = Array.isArray(savedList) && savedList.some((a) => a.id === id);
      const unsave = (await fetch('/api/news-feed/unsave', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ articleId: id }) })).status;
      const savedAfter = await (await fetch('/api/news-feed/saved', { credentials: 'include', headers: auth })).json();
      const stillSaved = Array.isArray(savedAfter) && savedAfter.some((a) => a.id === id);
      // Re-save after unsave must bring the article back (r295 tombstone bug:
      // any historical unsave row hid the article from /saved forever).
      await new Promise((res) => setTimeout(res, 1100));
      const resave = (await fetch('/api/news-feed/engage', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ articleId: id, action: 'save' }) })).status;
      const savedFinal = await (await fetch('/api/news-feed/saved', { credentials: 'include', headers: auth })).json();
      const backSaved = Array.isArray(savedFinal) && savedFinal.some((a) => a.id === id);
      return { save, inSaved, unsave, stillSaved, resave, backSaved };
    });
    if (r.skip) return;
    if (!(r.save >= 200 && r.save < 300)) throw new Error(`client save blocked (${r.save})`);
    if (!r.inSaved) throw new Error('saved article missing from /api/news-feed/saved');
    if (!(r.unsave >= 200 && r.unsave < 300)) throw new Error(`client unsave blocked (${r.unsave}) — saved article is stuck`);
    if (r.stillSaved) throw new Error('article still in saved list after unsave');
    if (!(r.resave >= 200 && r.resave < 300)) throw new Error(`client re-save blocked (${r.resave})`);
    if (!r.backSaved) throw new Error('re-saved article missing from /saved — unsave tombstone is back (r295)');
  });

  // Client requirements page renders without a dead route / blank / staff
  // leak. Requirements are the brand demand side of the portfolio.
  await step(page, p, 'client-requirements', async () => {
    await page.goto(`${BASE}/requirements`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    if (await page.getByText('Page not found').count()) throw new Error('requirements is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('requirements rendered blank for client');
  });

  // Client edits a contact they can touch (the one added earlier this round,
  // or any editable brand contact) — change the role and save, no error.
  await step(page, p, 'client-edit-contact', async () => {
    await page.goto(`${BASE}/contacts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const edit = page.locator('[data-testid^="client-edit-contact-"], [data-testid^="client-edit-own-contact-"]').first();
    if (!(await edit.count())) throw new Error('no editable contact for client');
    await edit.click();
    await page.waitForTimeout(600);
    const roleInput = page.locator('[data-testid="contact-dialog-role"]');
    if (!(await roleInput.count())) throw new Error('contact edit dialog did not open');
    await roleInput.fill(`Acquisitions (edited R${ROUND})`);
    await page.locator('[data-testid="contact-dialog-save"]').click();
    await page.waitForTimeout(1200);
    if (await page.getByText(/failed|error/i).count()) throw new Error('error toast after editing contact');
  });

  // Contact-edit scope: a client may add/edit contacts on their own company
  // or on any brand in the (now-open) tenant directory, but must NOT edit a
  // contact belonging to another LANDLORD. Uses the seeded Hammerson contact.
  await step(page, p, 'client-contact-scope-guards', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const foreignLandlordContact = '99999999-6666-6666-6666-666666666666'; // Hammerson (landlord — never touchable)
      const inSliceBrand = window.QA_FIX.brand;           // Honi Poke (Tenant - Restaurant, in slice)
      const outOfSliceBrand = '88888888-1111-1111-1111-111111111111';        // QA Retail Brand (out of slice, not self-added)
      const editForeign = (await fetch(`/api/crm/contacts/${foreignLandlordContact}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: 'QA-CONTACT-HIJACK' }) }).catch(() => ({ status: 0 }))).status;
      const addInSlice = await fetch('/api/crm/contacts', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: 'QA Contact slice-brand', companyId: inSliceBrand }) }).catch(() => ({ ok: false, status: 0 }));
      let addInSliceStatus = addInSlice.status;
      if (addInSlice.ok) { const c = await addInSlice.json(); await fetch(`/api/crm/contacts/${c.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {}); }
      const addOutStatus = (await fetch('/api/crm/contacts', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: 'QA Contact out-of-slice', companyId: outOfSliceBrand }) }).catch(() => ({ status: 0 }))).status;
      return { editForeign, addInSliceStatus, addOutStatus };
    });
    if (r.editForeign !== 403) throw new Error(`client edited a foreign landlord's contact (expected 403, got ${r.editForeign})`);
    if (!(r.addInSliceStatus >= 200 && r.addInSliceStatus < 300)) throw new Error(`client blocked from adding an in-slice brand contact (${r.addInSliceStatus})`);
    if (r.addOutStatus !== 403) throw new Error(`client added a contact to an out-of-slice brand (expected 403, got ${r.addOutStatus})`);
  });

  // The property agents list ("who do I chase") is open to client logins, so
  // it must return DISPLAY fields only — never the whole users row. r424: it
  // was leaking the password hash + HR PII (dob/address/personalEmail) to any
  // authed caller. Assert no returned agent carries a sensitive key.
  await step(page, p, 'client-agents-no-pii-leak', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/crm/properties/${window.QA_FIX.bluewater}/agents`, { credentials: 'include', headers: auth }).catch(() => null);
      if (!res || !res.ok) return { status: res ? res.status : 0, rows: [] };
      const rows = await res.json().catch(() => []);
      const SENSITIVE = ['password', 'dob', 'address', 'personalEmail', 'personal_email', 'cvUrl', 'cv_url'];
      const leakedKeys = new Set();
      for (const row of (Array.isArray(rows) ? rows : [])) {
        for (const k of SENSITIVE) if (row && Object.prototype.hasOwnProperty.call(row, k)) leakedKeys.add(k);
      }
      return { status: res.status, count: Array.isArray(rows) ? rows.length : -1, leaked: [...leakedKeys] };
    });
    if (r.status && r.status >= 400) throw new Error(`client agents fetch failed (${r.status})`);
    if (r.leaked && r.leaked.length) throw new Error(`property agents leaked sensitive user fields to a client: ${r.leaked.join(', ')}`);
    // r436: the gateway block came off this route (it 403'd the client's own
    // list); the handler now scope-checks instead — a rival property's agent
    // list must still refuse. Fixed rival-property id from qa/seed-personas.sql.
    const rival = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/crm/properties/99999999-2222-2222-2222-222222222222/agents', { credentials: 'include', headers: auth }).catch(() => ({ status: 0 }));
      return res.status;
    });
    if (rival !== 403) throw new Error(`rival property agent list not sealed (expected 403, got ${rival})`);
  });

  // Staff-only boards must refuse client logins outright (r425): the landlord
  // board rolls up every landlord's deal counts + total WIP fees, and the
  // dedupe scan dumps contact emails/names across the ENTIRE CRM.
  await step(page, p, 'client-staff-boards-403', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const get = async (url) => (await fetch(url, { credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        landlords: await get('/api/crm/landlords'),
        dupes: await get('/api/crm/duplicates/scan'),
      };
    });
    if (r.landlords !== 403) throw new Error(`client read the landlord fee board (expected 403, got ${r.landlords})`);
    if (r.dupes !== 403) throw new Error(`client ran the CRM dedupe scan (expected 403, got ${r.dupes})`);
  });

  // The four firm-wide link-dump GETs (bare uuid relationship maps across the
  // whole CRM) are centrally blocked for clients in index.ts
  // CLIENT_BLOCKED_SUBPATHS — lock that gate in (r426, closes r425's deferral).
  await step(page, p, 'client-link-dumps-403', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const get = async (url) => (await fetch(url, { credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        companyDeal: await get('/api/crm/company-deal-links'),
        contactProperty: await get('/api/crm/contact-property-links'),
        contactDeal: await get('/api/crm/contact-deal-links'),
        contactRequirement: await get('/api/crm/contact-requirement-links'),
      };
    });
    for (const [k, v] of Object.entries(r)) {
      if (v !== 403) throw new Error(`client read ${k} link dump (expected 403, got ${v})`);
    }
  });

  // Turnover board (r427): the client list GET stays sliced-and-open, but the
  // firm-wide stats aggregate must refuse scoped callers — same intel class
  // as the blocked query_turnover ChatBGP tool (r426).
  await step(page, p, 'client-turnover-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const get = async (url) => (await fetch(url, { credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        list: await get('/api/turnover'),
        stats: await get('/api/turnover/stats/summary'),
      };
    });
    if (r.list !== 200) throw new Error(`client turnover board list broke (expected 200, got ${r.list})`);
    if (r.stats !== 403) throw new Error(`client read firm-wide turnover stats (expected 403, got ${r.stats})`);
  });

  // Clients may regenerate BGP Commentary on their OWN properties (terminal
  // side, 2026-08-03 — Mark hit a read-only 403 on Liverpool ONE), but a
  // foreign property must still refuse. Locally the own-property call gets
  // through the gate and then 500s on the missing AI key — that IS the pass
  // signal here (the guard admitted the client); prod generates for real.
  await step(page, p, 'client-commentary-own-property', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const post = async (pid) => (await fetch(`/api/properties/${pid}/bgp-commentary/regenerate`, {
        method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return {
        own: await post(window.QA_FIX.bluewater),
        foreign: await post('99999999-2222-2222-2222-222222222222'),
      };
    });
    if (r.own === 403 || r.own === 404) throw new Error(`client blocked from regenerating commentary on their own property (${r.own})`);
    if (r.foreign !== 403) throw new Error(`client regenerated commentary on a foreign property (expected 403, got ${r.foreign})`);
  });

  // Plans board parity (Woody, 2026-08-03): a client may read the floor/lease
  // plans on their OWN property (the board shows the plans panel to them now),
  // but the same read on a foreign landlord's property must refuse. Guards the
  // recently client-exposed /api/properties/:id/plans read via
  // clientBlockedForProperty.
  await step(page, p, 'client-plans-board-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = await fetch(`/api/properties/${window.QA_FIX.bluewater}/plans`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownBody = own.ok ? await own.json().catch(() => null) : null;
      const foreign = (await fetch('/api/properties/99999999-2222-2222-2222-222222222222/plans', { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { ownOk: own.ok, ownArray: Array.isArray(ownBody?.plans), foreign };
    });
    if (!r.ownOk || !r.ownArray) throw new Error('client cannot read the Plans board on their own property');
    if (r.foreign !== 403) throw new Error(`client read the Plans board on a foreign property (expected 403, got ${r.foreign})`);
  });

  // Brand Gap v2 (competing-centre operator-gap analysis) is a property-scoped
  // Brand Intelligence read: a client may run it on their OWN property (the
  // gate admits them — locally a missing GOOGLE_API_KEY yields a 400 geocode
  // error rather than a 403, which still proves admission) but must be refused
  // on a foreign landlord's property across the gaps, commentary and
  // international views.
  await step(page, p, 'client-brand-gaps-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const own = `property/${window.QA_FIX.bluewater}`;
      const foreign = 'property/99999999-2222-2222-2222-222222222222';
      return {
        own: await g(`/api/${own}/brand-gaps`),
        gaps: await g(`/api/${foreign}/brand-gaps`),
        commentary: await g(`/api/${foreign}/brand-gaps/commentary`),
        international: await g(`/api/${foreign}/brand-gaps/international`),
      };
    });
    if (r.own === 403) throw new Error('client blocked from Brand Gap on their own property (scope gate over-refused)');
    if (r.gaps !== 403) throw new Error(`client ran Brand Gap on a foreign property (expected 403, got ${r.gaps})`);
    if (r.commentary !== 403) throw new Error(`client read foreign Brand Gap commentary (expected 403, got ${r.commentary})`);
    if (r.international !== 403) throw new Error(`client read foreign Brand Gap international view (expected 403, got ${r.international})`);
  });

  // A client must never reach the admin password-reset (account takeover
  // vector) — and the target's password must be untouched by the attempt.
  await step(page, p, 'client-password-reset-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const status = (await fetch('/api/admin/users/aaaaaaaa-5555-5555-5555-555555555555/reset-password', {
        method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { status };
    });
    if (r.status !== 403) throw new Error(`client reached admin password reset (expected 403, got ${r.status})`);
  });

  // Merged contacts list (terminal, 2026-08-03: auto-discovery + dedupe):
  // the client's contact list must not serve duplicate (name,email) rows.
  await step(page, p, 'client-contacts-deduped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/crm/contacts', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.data || []);
      const seen = new Set(); const dupes = [];
      for (const c of rows) {
        // Skip the harness's own probe contacts — back-to-back runs without
        // run-round.sh's 'QA Contact%' purge leave same-named rows behind,
        // which are pollution, not an app dedupe failure (r379).
        if (/^QA Contact/i.test(String(c.name || ''))) continue;
        const key = `${String(c.name || '').trim().toLowerCase()}|${String(c.email || '').trim().toLowerCase()}`;
        if (key === '|') continue;
        if (seen.has(key)) dupes.push(c.name);
        seen.add(key);
      }
      return { total: rows.length, dupes };
    });
    if (r.dupes.length) throw new Error(`client contact list has duplicate rows post-dedupe: ${r.dupes.slice(0, 3).join(', ')}`);
  });

  // A client must not assign tasks onto BGP staff lists (the create route
  // gates assignee to the client's own visible people).
  await step(page, p, 'client-task-assign-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const status = (await fetch('/api/tasks', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: 'QA-PROBE task hijack', assigneeUserId: 'aaaaaaaa-5555-5555-5555-555555555555' }) }).catch(() => ({ status: 0 }))).status;
      // The AI task-suggestions sweep (terminal, 2026-08-03) is an org-wide
      // AI op — staff only.
      const sweep = (await fetch('/api/tasks/suggestions/run', { method: 'POST', credentials: 'include', headers: auth,
        body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { status, sweep };
    });
    if (r.status < 400) throw new Error(`client assigned a task onto a staff list (${r.status})`);
    if (r.sweep < 400) throw new Error(`client triggered the AI task-suggestions sweep (${r.sweep})`);
  });

  // Turnover Board slice scoping: the client's /api/turnover read includes
  // the in-slice fixture row (Honi Poke) and never the out-of-slice one
  // (QA Retail Brand) — the clientBrandSliceSql filter on turnover_data.
  await step(page, p, 'client-turnover-slice', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/turnover', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = JSON.stringify(await res.json().catch(() => []));
      return { ok: true, inSlice: body.includes('Honi Poke'), outOfSlice: body.includes('QA Retail Brand') };
    });
    if (!r.ok) throw new Error(`client turnover read unhealthy (${r.status})`);
    if (!r.inSlice) throw new Error('in-slice turnover row missing from the client board');
    if (r.outOfSlice) throw new Error('out-of-slice turnover row leaked to the client board');
  });

  // The Brand Hub overview + Brand Hunter both render for clients but must be
  // slice-scoped: the Hub's superBrands (a luxury/fashion showcase) is forced
  // empty for clients, and neither the Hub tiles (hot/turnover) nor the Hunter
  // list may surface a luxury/fashion brand — those types sit outside the
  // hospitality/leisure/fitness client slice. Guards the unscoped superBrands
  // SQL (and any future tile that forgets the slice filter).
  await step(page, p, 'client-brand-hub-hunter-scoped', async () => {
    // The canonical client gate is slice + own company + self-added extras
    // (CLAUDE.md 2026-08-01), and /api/crm/companies applies exactly that —
    // so every brand the hub/hunter serves a client must be in that set. A
    // self-added Fashion brand showing up is intended; a brand OUTSIDE the
    // client's directory is the leak.
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const j = async (url) => { const res = await fetch(url, { headers: auth }); return { ok: res.ok, status: res.status, body: res.ok ? await res.json().catch(() => null) : null }; };
      const hub = await j('/api/brands/hub');
      const hunter = await j('/api/brands/hunter');
      const dir = await j('/api/crm/companies');
      if (!hub.ok || !hunter.ok || !dir.ok) return { ok: false, why: `hub ${hub.status} / hunter ${hunter.status} / directory ${dir.status}` };
      const visible = new Set((Array.isArray(dir.body) ? dir.body : []).map((c) => c.id));
      const rows = (x) => (Array.isArray(x) ? x : []).map((b) => ({ id: b.id, name: b.name, type: String(b.company_type || b.companyType || '') }));
      // topTurnover serves turnover_data rows — the brand id/name live in
      // company_id/company_name (b.id is the turnover row's own id).
      const turnoverRows = (Array.isArray(hub.body?.topTurnover) ? hub.body.topTurnover : []).map((t) => ({ id: t.company_id, name: t.company_name, type: String(t.company_type || '') }));
      const served = [...rows(hub.body?.superBrands), ...rows(hub.body?.hotBrands), ...turnoverRows, ...rows(hunter.body)];
      const leaks = served.filter((b) => b.id && !visible.has(b.id));
      return { ok: true, leaks: leaks.slice(0, 3) };
    });
    if (!r.ok) throw new Error(`client brand hub/hunter unhealthy (${r.why})`);
    if (r.leaks.length) throw new Error(`brand outside the client's directory leaked into hub/hunter: ${r.leaks.map((b) => `${b.name} (${b.type})`).join(', ')}`);
  });

  // The hub's "With Turnover Data" stat and its Turnover Leaders board must
  // agree: the stat once counted brands with any turnover_data row (even
  // all-NULL figures) while the leaderboard required a real turnover value,
  // so the overview said "9 with turnover data" above an empty "no turnover
  // data yet" board (r343).
  await step(page, p, 'client-brands-hub-turnover-consistent', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/brands/hub', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      return { ok: true, withTurnover: parseInt(body?.stats?.brands_with_turnover || '0'), leaders: (body?.topTurnover || []).length };
    });
    if (!r.ok) throw new Error(`brands hub unhealthy (${r.status})`);
    if (r.withTurnover > 0 && r.leaders === 0) throw new Error(`stat says ${r.withTurnover} brands with turnover data but the leaderboard is empty`);
    if (r.withTurnover === 0 && r.leaders > 0) throw new Error(`leaderboard has ${r.leaders} rows but the stat says 0 brands with turnover data`);
  });

  // The invoice-verdict alarm is a staff-agent feature; /api/deal-verdicts is
  // outside the client API allowlist, so the client shell must not poll it at
  // all — it used to fire on every page for clients and 403-storm (r344).
  await step(page, p, 'client-no-deal-verdict-poll', async () => {
    const hits = [];
    const listen = (resp) => { if (resp.url().includes('/api/deal-verdicts/')) hits.push(resp.status()); };
    page.on('response', listen);
    await visit(page, p, '/');
    await page.waitForTimeout(6000);
    page.off('response', listen);
    if (hits.length) throw new Error(`client shell polled /api/deal-verdicts (${hits.length} call(s), status ${hits[0]})`);
  });

  // A client deep-linked to the staff Investment tab must not mount the
  // tracker (it used to fire 6 staff-only /api/investment-tracker fetches
  // during the auth-load window, then show "Deal not found" because Deals
  // parsed the "investment" segment as a deal id — r375). The hub now
  // rewrites the URL to /deals/list.
  await step(page, p, 'client-investment-deeplink-guard', async () => {
    const hits = [];
    const listen = (resp) => { if (/\/api\/investment-tracker/.test(resp.url())) hits.push(resp.status()); };
    page.on('response', listen);
    await visit(page, p, '/deals/investment');
    await page.waitForTimeout(5000);
    page.off('response', listen);
    if (hits.length) throw new Error(`client shell fetched /api/investment-tracker (${hits.length} call(s), status ${hits[0]})`);
    const body = await page.locator('body').innerText();
    if (/deal not found/i.test(body)) throw new Error('client saw "Deal not found" on /deals/investment (tab segment parsed as a deal id)');
    const loc = await page.evaluate(() => location.pathname);
    if (loc !== '/deals/list') throw new Error(`expected rewrite to /deals/list, still at ${loc}`);
  });

  // Firm-wide reporting (the board report + reporting summary — whole-book
  // revenue, pipeline, agent performance) is BGP-internal; a client login
  // must be refused.
  await step(page, p, 'client-firm-reporting-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        board: await g('/api/board-report'),
        reporting: await g('/api/reporting/summary'),
        // r536: both rode the allowed /api/dashboard/ prefix on requireAuth
        // alone. firm-summary handed a landlord BGP's billed YTD, WIP, ski
        // target and headcount; individual-leaderboard is the per-agent
        // billing strip. Only the staff-only /hr page reads either.
        firmSummary: await g('/api/dashboard/firm-summary'),
        leaderboard: await g('/api/dashboard/individual-leaderboard'),
      };
    });
    if (r.board !== 403) throw new Error(`client reached the board report (expected 403, got ${r.board})`);
    if (r.reporting !== 403) throw new Error(`client reached the reporting summary (expected 403, got ${r.reporting})`);
    if (r.firmSummary !== 403) throw new Error(`client read BGP's firm fee summary (expected 403, got ${r.firmSummary})`);
    if (r.leaderboard !== 403) throw new Error(`client read the per-agent leaderboard (expected 403, got ${r.leaderboard})`);
  });

  // The BGP deal-report generator (recent-deals feed + branded PDF builder) is
  // a staff sales-collateral tool spanning the firm's whole deal book — a
  // client login must never pull its recent-deals list nor render a report.
  await step(page, p, 'client-deal-report-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const recent = (await fetch('/api/deal-report/recent-deals', { headers: auth }).catch(() => ({ status: 0 }))).status;
      const pdf = (await fetch('/api/deal-report/pdf', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { recent, pdf };
    });
    if (r.recent !== 403) throw new Error(`client reached the deal-report recent-deals feed (expected 403, got ${r.recent})`);
    if (r.pdf !== 403) throw new Error(`client rendered a deal-report PDF (expected 403, got ${r.pdf})`);
  });

  // Firm-internal back-office surfaces a client must never touch: HR (staff
  // parental-leave register + Brucey award winners — personal staff data), the
  // Companies House search proxy (BGP's CH lookup credit), the deal compliance
  // audit, the investment comps book, and the board-report Excel export. All
  // staff-only; a client login is refused across the board.
  await step(page, p, 'client-firm-internal-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        hrLeave: await g('/api/hr/parental-leave'),
        hrAwards: await g('/api/hr/brucey-winners/current'),
        chSearch: await g('/api/companies-house/search?q=tesco'),
        compliance: await g('/api/deal-compliance-audit'),
        investmentComps: await g('/api/investment-comps'),
        boardExport: await g('/api/board-report/export-excel'),
      };
    });
    if (r.hrLeave !== 403) throw new Error(`client reached the HR parental-leave register (expected 403, got ${r.hrLeave})`);
    if (r.hrAwards !== 403) throw new Error(`client reached the HR Brucey award winners (expected 403, got ${r.hrAwards})`);
    if (r.chSearch !== 403) throw new Error(`client reached the Companies House search proxy (expected 403, got ${r.chSearch})`);
    if (r.compliance !== 403) throw new Error(`client reached the deal compliance audit (expected 403, got ${r.compliance})`);
    if (r.investmentComps !== 403) throw new Error(`client reached the investment comps book (expected 403, got ${r.investmentComps})`);
    if (r.boardExport !== 403) throw new Error(`client exported the board report (expected 403, got ${r.boardExport})`);
  });

  // The staff Outlook mailboxes — per-user (/api/user-mail/*) and the shared
  // team mailbox (/api/shared-mailbox/*) — are BGP internal correspondence. A
  // client login must never read a folder/message, check status, or send from
  // them. (The mobile nav's staff-only "Mail" tab is the UI door to this.)
  await step(page, p, 'client-mailbox-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        userMsgs: await g('/api/user-mail/messages'),
        userStatus: await g('/api/user-mail/status'),
        sharedMsgs: await g('/api/shared-mailbox/messages'),
        sharedFolders: await g('/api/shared-mailbox/folders'),
        send: (await fetch('/api/user-mail/send', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status,
      };
    });
    if (r.userMsgs !== 403) throw new Error(`client read the staff Outlook inbox (expected 403, got ${r.userMsgs})`);
    if (r.userStatus !== 403) throw new Error(`client read staff mailbox status (expected 403, got ${r.userStatus})`);
    if (r.sharedMsgs !== 403) throw new Error(`client read the shared team mailbox (expected 403, got ${r.sharedMsgs})`);
    if (r.sharedFolders !== 403) throw new Error(`client read shared-mailbox folders (expected 403, got ${r.sharedFolders})`);
    if (r.send !== 403) throw new Error(`client sent mail from a staff mailbox (expected 403, got ${r.send})`);
  });

  // The staff expense / Stripe-issuing system is BGP-internal finance: staff's
  // own expense list, their issued-card details (the card PAN!), the firm
  // cardholder roster, the admin expense summary, and the nominal-code chart.
  // A client login must be refused across all of it.
  await step(page, p, 'client-expenses-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        mine: await g('/api/expenses/me'),
        cardDetails: await g('/api/expenses/me/card-details'),
        cardholders: await g('/api/expenses/cardholders'),
        adminSummary: await g('/api/expenses/admin/summary'),
        nominalCodes: await g('/api/expenses/nominal-codes'),
      };
    });
    if (r.mine !== 403) throw new Error(`client reached the staff expense list (expected 403, got ${r.mine})`);
    if (r.cardDetails !== 403) throw new Error(`client reached issued-card details/PAN (expected 403, got ${r.cardDetails})`);
    if (r.cardholders !== 403) throw new Error(`client reached the cardholder roster (expected 403, got ${r.cardholders})`);
    if (r.adminSummary !== 403) throw new Error(`client reached the admin expense summary (expected 403, got ${r.adminSummary})`);
    if (r.nominalCodes !== 403) throw new Error(`client reached the expense nominal codes (expected 403, got ${r.nominalCodes})`);
  });

  // The org-wide operational feeds — /api/notifications (stuck deals, KYC-not-
  // approved alerts, unallocated-fee warnings) and /api/activity-feed (system
  // activity log) — are BGP-internal. Both routes hard-return [] for client
  // logins; a non-empty response means the firm's operational intel is
  // bleeding onto the client's briefing.
  await step(page, p, 'client-ops-feed-isolated', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const j = async (url) => { const res = await fetch(url, { headers: auth }); return { ok: res.ok, status: res.status, body: res.ok ? await res.json().catch(() => null) : null }; };
      const notif = await j('/api/notifications');
      const feed = await j('/api/activity-feed');
      return { notif, feed };
    });
    if (!r.notif.ok) throw new Error(`client notifications unhealthy (${r.notif.status})`);
    if (!r.feed.ok) throw new Error(`client activity-feed unhealthy (${r.feed.status})`);
    const nLen = Array.isArray(r.notif.body) ? r.notif.body.length : -1;
    const fLen = Array.isArray(r.feed.body) ? r.feed.body.length : -1;
    if (nLen !== 0) throw new Error(`firm operational alerts leaked to the client notifications feed (${nLen} items)`);
    if (fLen !== 0) throw new Error(`system activity log leaked to the client activity-feed (${fLen} items)`);
  });

  // Correspondence + AI activity on the brand profile's BGP Relationship
  // zone (Woody, 2026-08-04 parity; gateway fixed r215): a client reads the
  // drawer + activity card for their OWN company and slice brands. The
  // firm-wide surfaces (summary, leaderboard) and rivals stay sealed, as do
  // the raw meeting viewer and the curate/sync writes.
  await step(page, p, 'client-interactions-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        own: await g(`/api/interactions/company/${window.QA_FIX.landsec}`),
        slice: await g(`/api/interactions/company/${window.QA_FIX.brand}`),
        ownActivity: await g(`/api/activity/landlord/${window.QA_FIX.landsec}`),
        sliceActivity: await g(`/api/activity/brand/${window.QA_FIX.brand}`),
        rival: await g('/api/interactions/company/99999999-1111-1111-1111-111111111111'),
        rivalActivity: await g('/api/activity/landlord/99999999-1111-1111-1111-111111111111'),
        summary: await g('/api/interactions/summary'),
        leaderboard: await g('/api/interactions/leaderboard'),
        meetingViewer: await g('/api/activity/meeting/probe%40bgp.com/evt-probe'),
        sync: (await fetch('/api/interactions/sync?daysBack=1&daysForward=1', { method: 'POST', headers: auth }).catch(() => ({ status: 0 }))).status,
      };
    });
    if (r.own !== 200) throw new Error(`client blocked from their own correspondence drawer (expected 200, got ${r.own})`);
    if (r.slice !== 200) throw new Error(`client blocked from a slice brand's correspondence drawer (expected 200, got ${r.slice})`);
    if (r.ownActivity !== 200) throw new Error(`client blocked from own-company AI activity (expected 200, got ${r.ownActivity})`);
    if (r.sliceActivity !== 200) throw new Error(`client blocked from slice-brand AI activity (expected 200, got ${r.sliceActivity})`);
    if (r.rival !== 403) throw new Error(`client read a rival's correspondence log (expected 403, got ${r.rival})`);
    if (r.rivalActivity !== 403) throw new Error(`client read a rival's AI activity (expected 403, got ${r.rivalActivity})`);
    if (r.summary !== 403) throw new Error(`client reached the interactions summary (expected 403, got ${r.summary})`);
    if (r.leaderboard !== 403) throw new Error(`client reached the BD engagement leaderboard (expected 403, got ${r.leaderboard})`);
    if (r.meetingViewer !== 403) throw new Error(`client reached the raw meeting viewer (expected 403, got ${r.meetingViewer})`);
    if (r.sync !== 403) throw new Error(`client kicked the staff-only interactions sync (expected 403, got ${r.sync})`);
  });

  // The Lease Events board is BGP's lease-advisory BD pipeline (rent reviews,
  // breaks, expiries across the whole book) — staff-only intel; a client
  // login must be refused on the list and the digest.
  await step(page, p, 'client-lease-events-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { list: await g('/api/lease-events'), digest: await g('/api/lease-events/digest') };
    });
    if (r.list !== 403) throw new Error(`client reached the lease-events board (expected 403, got ${r.list})`);
    if (r.digest !== 403) throw new Error(`client reached the lease-events digest (expected 403, got ${r.digest})`);
  });

  // Property Pathway (Why-Buy acquisition underwriting) is a staff-only
  // sourcing/underwriting engine — off-market intel, title analysis, deck
  // generation. A client login must never reach the board or the latest-run
  // shortcut (sealed by the server gateway allowlist, which omits
  // /api/property-pathway).
  await step(page, p, 'client-property-pathway-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { board: await g('/api/property-pathway'), latest: await g('/api/property-pathway/latest') };
    });
    if (r.board !== 403) throw new Error(`client reached the property-pathway board (expected 403, got ${r.board})`);
    if (r.latest !== 403) throw new Error(`client reached the property-pathway latest run (expected 403, got ${r.latest})`);
  });

  // WIP Report is the firm's internal fee/work-in-progress pipeline — deal
  // fees, agent splits, completion values, fee reconciliation. A client
  // login must never reach the report, the per-agent summary, or the fee
  // reconciliation (double-sealed: explicit isClientRequestUser 403 in the
  // handler + the server gateway allowlist, which omits /api/wip).
  await step(page, p, 'client-wip-report-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        wip: await g('/api/wip'),
        summary: await g('/api/wip/agent-summary'),
        recon: await g('/api/wip/fee-reconciliation'),
      };
    });
    if (r.wip !== 403) throw new Error(`client reached the WIP report (expected 403, got ${r.wip})`);
    if (r.summary !== 403) throw new Error(`client reached the WIP agent-summary (expected 403, got ${r.summary})`);
    if (r.recon !== 403) throw new Error(`client reached WIP fee-reconciliation (expected 403, got ${r.recon})`);
  });

  // The client Agents tab (/api/client/agent-directory) surfaces ONLY
  // tenant-rep agents — the operators' side, never the landlord's own agents
  // (task #13). Positive: it renders a scoped list. Guard: the firm-wide
  // per-agent fee drilldown (/api/wip/agent-drilldown) stays staff-only, so a
  // client can't pull BGP's fee performance on any named agent.
  await step(page, p, 'client-agent-directory-tenant-rep', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/client/agent-directory', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => []);
      const rows = Array.isArray(body) ? body : (body.agents || body.rows || []);
      const landlordRep = rows.some((a) => {
        const t = String(a.agentType || a.agent_type || '').toLowerCase();
        return t === 'landlord_rep' || t === 'landlord';
      });
      const drill = (await fetch('/api/wip/agent-drilldown/CF%20Commercial', { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { ok: true, count: rows.length, landlordRep, drill };
    });
    if (!r.ok) throw new Error(`client agent-directory failed (${r.status}) — tenant-rep tab regressed?`);
    if (r.landlordRep) throw new Error('a landlord-rep agent leaked into the client tenant-rep agent directory');
    if (r.drill !== 403) throw new Error(`client reached the firm-wide WIP agent fee drilldown (expected 403, got ${r.drill})`);
  });

  // Document Studio (KYC / PLA / Why-Buy brief generation) is a staff
  // advisory tool — a client login must never list the catalog nor run a
  // brief (would expose BGP's internal document-generation pipeline). Sealed
  // by the server gateway allowlist (document-briefs isn't client-allowed).
  await step(page, p, 'client-document-briefs-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = (await fetch('/api/document-briefs', { headers: auth }).catch(() => ({ status: 0 }))).status;
      const run = (await fetch('/api/document-briefs/kyc/run', { method: 'POST', headers: auth, body: JSON.stringify({ propertyId: window.QA_FIX.bluewater }) }).catch(() => ({ status: 0 }))).status;
      return { list, run };
    });
    if (r.list !== 403) throw new Error(`client listed the document-briefs catalog (expected 403, got ${r.list})`);
    if (r.run !== 403) throw new Error(`client ran a document brief (expected 403, got ${r.run})`);
  });

  // The Hunters boards are BGP's BD prospecting engine — the letting hunter
  // ranks landlords with stale competitor agents / upcoming lease events to
  // pitch, and the investment hunter surfaces acquisition targets. That's
  // pure new-business intel across the whole book; a client login must never
  // reach either board (enforced by the server gateway allowlist).
  await step(page, p, 'client-hunters-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { letting: await g('/api/hunters/letting'), investment: await g('/api/hunters/investment') };
    });
    if (r.letting !== 403) throw new Error(`client reached the letting hunter (expected 403, got ${r.letting})`);
    if (r.investment !== 403) throw new Error(`client reached the investment hunter (expected 403, got ${r.investment})`);
  });

  // The AI Leads board is BGP's automated BD lead-generation engine (prospect
  // list + generate + per-lead actions + conversion stats) — pure new-business
  // intel; a client login must never reach the list, the stats, or trigger a
  // generation run. Sealed by the server gateway allowlist (no /api/leads).
  await step(page, p, 'client-leads-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const list = await g('/api/leads');
      const stats = await g('/api/leads/stats');
      const generate = (await fetch('/api/leads/generate', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      // r535: /api/crm/leads is a DIFFERENT family from /api/leads above —
      // BGP's own prospecting pipeline (the admin-only /leads page), and it
      // rode the allowed /api/crm/ prefix unscoped, so a client could pull
      // every prospect's name, email, phone and free-text notes.
      const crmList = await g('/api/crm/leads');
      const crmDetail = await g('/api/crm/leads/00000000-0000-0000-0000-000000000000');
      // r535: landlord packs are one flat filename namespace across the firm;
      // a filename no requirement in the client's slice references must be
      // refused OUTRIGHT (403), not answered 404 (which leaks existence).
      const strangePack = await g('/api/crm/landlord-packs/qa-probe-nonexistent-pack.pdf');
      return { list, stats, generate, crmList, crmDetail, strangePack };
    });
    if (r.list !== 403) throw new Error(`client reached the AI leads board (expected 403, got ${r.list})`);
    if (r.stats !== 403) throw new Error(`client reached the leads stats (expected 403, got ${r.stats})`);
    if (r.generate !== 403) throw new Error(`client triggered AI lead generation (expected 403, got ${r.generate})`);
    if (r.crmList !== 403) throw new Error(`client reached the CRM leads pipeline (expected 403, got ${r.crmList})`);
    if (r.crmDetail !== 403) throw new Error(`client reached a CRM lead detail (expected 403, got ${r.crmDetail})`);
    if (r.strangePack !== 403) throw new Error(`client reached an unreachable landlord pack (expected 403, got ${r.strangePack})`);
  });

  // The plain news feed (/api/news-feed/articles) is client-visible, but the
  // news-INTEL pipeline that mines those articles into BD leads — the intel
  // inbox, the leads list, and pushing a lead into the CRM — plus the manual
  // feed-fetch trigger are staff-only. A client login must be refused on all
  // of them (staff prospecting intel, not the reader's news).
  await step(page, p, 'client-news-intel-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const p = async (url) => (await fetch(url, { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return {
        articles: await g('/api/news-feed/articles'),
        inbox: await g('/api/news-intel/inbox'),
        leads: await g('/api/news-intel/leads'),
        push: await p('/api/news-intel/leads/00000000-0000-0000-0000-000000000000/push'),
        fetch: await p('/api/news-feed/fetch'),
        // r537: which paywalled publications BGP holds subscriber cookies
        // for, by label + env-var name. Staff Sources tab only — a client
        // login gets ClientNewsFeed, which never reads it.
        cookies: await g('/api/news-feed/auth-cookies/health'),
      };
    });
    if (r.cookies !== 403) throw new Error(`client read BGP's paywall cookie config (expected 403, got ${r.cookies})`);
    if (![200, 204].includes(r.articles)) throw new Error(`client news feed articles should be readable (expected 200, got ${r.articles})`);
    if (r.inbox !== 403) throw new Error(`client reached the news-intel inbox (expected 403, got ${r.inbox})`);
    if (r.leads !== 403) throw new Error(`client reached the news-intel leads (expected 403, got ${r.leads})`);
    if (r.push !== 403) throw new Error(`client pushed a news-intel lead (expected 403, got ${r.push})`);
    if (r.fetch !== 403) throw new Error(`client triggered a news feed fetch (expected 403, got ${r.fetch})`);
  });

  // ActivitySummary board (terminal, 2026-08-03): the dashboard's upcoming/
  // recent feed must serve client-scoped content only — never another
  // landlord's deals — and the board must render.
  await step(page, p, 'client-activity-summary-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/activity-summary', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = JSON.stringify(await res.json().catch(() => ({})));
      return { ok: true, rival: /hammerson|brent cross/i.test(body) };
    });
    if (!r.ok) throw new Error(`client activity-summary unhealthy (${r.status})`);
    if (r.rival) throw new Error("rival landlord content leaked into the client's activity summary");
    await page.goto(`${BASE}/`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    if (!(await page.locator('[data-testid="activity-summary"]').count())) throw new Error('activity-summary board missing from the client dashboard');
  });

  // Org-wide feeds are BGP-internal: the activity feed hard-empties for
  // client logins (Landsec audit) even when staff sees rows, and
  // notifications/daily-digest must never 4xx/5xx or leak org-wide rows.
  await step(page, p, 'client-feeds-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => {
        const res = await fetch(url, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
        if (!res.ok) return { status: res.status, len: null };
        const d = await res.json().catch(() => null);
        return { status: res.status, len: Array.isArray(d) ? d.length : (d ? -1 : null) };
      };
      return {
        activity: await g('/api/activity-feed'),
        notifications: await g('/api/notifications'),
        digest: await g('/api/daily-digest'),
      };
    });
    if (r.activity.status !== 200) throw new Error(`client activity-feed unhealthy (${r.activity.status})`);
    if (r.activity.len !== 0) throw new Error(`org-wide activity leaked to client (${r.activity.len} rows)`);
    if (r.notifications.status !== 200) throw new Error(`client notifications unhealthy (${r.notifications.status})`);
    if (r.digest.status !== 200) throw new Error(`client daily-digest unhealthy (${r.digest.status})`);
  });

  // The Insights feed (event-driven "market brain") is client-visible but
  // scoped: a client sees general market insights only in their own
  // categories (hospitality/retail/leisure/fitness/market) plus client-audience
  // insights tagged to THEIR company — never a staff-audience item, an
  // out-of-category general insight, or another landlord's client insight. And
  // the manual /run trigger is staff-only.
  await step(page, p, 'client-insights-scoped', async () => {
    const CLIENT_CATS = ['hospitality', 'retail', 'leisure', 'fitness', 'market'];
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json().catch(() => ({}));
      const scope = me?.companyScopeId || me?.companyId || null;
      const res = await fetch('/api/insights', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const body = res.ok ? await res.json().catch(() => null) : null;
      const rows = body && Array.isArray(body.insights) ? body.insights : null;
      const run = (await fetch('/api/insights/run', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { status: res.status, hasArray: Array.isArray(rows), rows: rows || [], scope, run };
    });
    if (r.status !== 200) throw new Error(`client insights feed unhealthy (${r.status})`);
    if (!r.hasArray) throw new Error('client insights payload missing insights array');
    for (const i of r.rows) {
      const aud = String(i.audience || '');
      if (aud === 'all') {
        if (!CLIENT_CATS.includes(String(i.category || ''))) throw new Error(`out-of-category general insight leaked to client: ${i.category}`);
      } else if (aud === 'client') {
        if (r.scope && String(i.company_id) !== String(r.scope)) throw new Error(`another company's client insight leaked (company_id ${i.company_id})`);
      } else {
        throw new Error(`non-client-audience insight leaked to client feed: audience=${aud}`);
      }
    }
    if (r.run !== 403) throw new Error(`client triggered the insights run (expected 403, got ${r.run})`);
  });

  // Property Intelligence is client-visible (sidebar decision) and its Map
  // tab's external OS layers must reach the handlers (the allowlist used to
  // carry the dead prefix "/api/os-data" — the routes are /api/os/* — so the
  // client map 403'd everywhere). BGP-internal layers (pins = the whole
  // property book, annotations, external listings, plan polygons, Goad
  // units) stay staff-only; the map skips them client-side (r233).
  await step(page, p, 'client-map-layer-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (u) => (await fetch(u, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        osSites: await g('/api/os/sites?bbox=51.4992,-0.1440,51.5036,-0.1398'),
        osStatus: await g('/api/os/ngd-status'),
        pins: await g('/api/map/pins'),
        annotations: await g('/api/map-annotations'),
        // r537: map_annotations was already staff-only, but the LAYER list
        // rode the allowed /api/map-layers prefix and returned every layer
        // with shared_with_team = TRUE — so a landlord read BGP's own layer
        // names and item counts out of the /map sidebar.
        layers: await g('/api/map-layers'),
        external: await g('/api/external-properties'),
        plans: await g('/api/property-plans/in-viewport?bbox=51.49,-0.15,51.51,-0.13'),
      };
    });
    // OS proxies: anything but a gateway 403 — 200 with keys, 502/503 without.
    if (r.osSites === 403 || r.osStatus === 403) throw new Error(`client blocked from OS layers (sites ${r.osSites}, status ${r.osStatus}) — dead allowlist prefix regressed`);
    for (const [k, v] of Object.entries({ pins: r.pins, annotations: r.annotations, layers: r.layers, external: r.external, plans: r.plans })) {
      if (v !== 403) throw new Error(`BGP-internal map layer ${k} not refused for client (expected 403, got ${v})`);
    }
  });

  // Global search must respect the client's scope: their own portfolio and
  // in-slice brands are findable, a rival landlord and out-of-slice brands
  // return nothing. (Staff search sees everything — differential covered by
  // the staff round using search implicitly.)
  await step(page, p, 'client-search-scoping', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const q = async (term) => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { headers: auth }).catch(() => ({ ok: false }));
        if (!res.ok) return null;
        const d = await res.json().catch(() => ({}));
        return Array.isArray(d.results) ? d.results.length : null;
      };
      return {
        own: await q('Bluewater'),
        inSlice: await q('Honi'),
        rival: await q('Hammerson'),
        outOfSlice: await q('QA Retail'),
      };
    });
    if (r.own === null) throw new Error('client search request failed');
    if (!r.own) throw new Error("client search can't find their own property");
    if (!r.inSlice) throw new Error("client search can't find an in-slice brand");
    if (r.rival) throw new Error(`rival landlord surfaced in client search (${r.rival} results)`);
    if (r.outOfSlice) throw new Error(`out-of-slice brand surfaced in client search (${r.outOfSlice} results)`);
  });

  // Client contact management asymmetry: a client MAY edit a contact on their
  // own account (task-12 feature) but MUST NOT delete it ("managed by your
  // BGP team"). Create on own company, edit ok, delete refused, survives.
  await step(page, p, 'client-contact-edit-not-delete', async () => {
    const name = `QA Contact EditNotDel R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const ownCompany = window.QA_FIX.landsec; // Landsec (client's own)
      const create = await fetch('/api/crm/contacts', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: needle, companyId: ownCompany }) }).catch(() => ({ ok: false, status: 0 }));
      if (!create.ok) return { createStatus: create.status };
      const made = await create.json();
      const edit = (await fetch(`/api/crm/contacts/${made.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ role: 'QA client-edited' }) }).catch(() => ({ status: 0 }))).status;
      const del = (await fetch(`/api/crm/contacts/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      const still = (await fetch(`/api/crm/contacts/${made.id}`, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { createStatus: create.status, edit, del, still };
    }, name);
    if (!(r.createStatus >= 200 && r.createStatus < 300)) throw new Error(`client blocked from creating an own-account contact (${r.createStatus})`);
    if (!(r.edit >= 200 && r.edit < 300)) throw new Error(`client blocked from editing an own-account contact (${r.edit})`);
    if (r.del !== 403) throw new Error(`client deleted an own-account contact (expected 403, got ${r.del})`);
    if (!(r.still >= 200 && r.still < 300)) throw new Error(`contact vanished after a refused client delete (${r.still})`);
  });

  // Client opens a hospitality brand profile (in their visible slice) — the
  // page must render (tabs/content), no dead route / blank / staff leak.
  await step(page, p, 'client-brand-profile', async () => {
    await page.goto(`${BASE}/companies/${BRAND}`); // Honi Poke
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    if (await page.getByText('Page not found').count()) throw new Error('brand profile is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('brand profile rendered blank for client');
  });

  // The brand-profile "pitchedTo" panel lists the schemes a brand is being
  // pitched to. For a client that must be THEIR OWN estate only — the
  // cross-landlord pitch list is BGP BD intel (a client learning BGP is
  // pitching this operator into a rival's centre is a leak). Every pitchedTo
  // entry the client sees must sit on a property in their own portfolio.
  // (Regression guard: the pitchedTo query had no requesting-company scope.)
  await step(page, p, 'client-brand-pitchedto-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const props = await (await fetch('/api/crm/properties', { headers: auth }).catch(() => null))?.json().catch(() => null);
      const mine = new Set((Array.isArray(props) ? props : (props?.properties || props?.rows || [])).map((p) => String(p.id)));
      const res = await fetch(`/api/brand/${window.QA_FIX.brand}/profile`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      const pitched = (body && Array.isArray(body.pitchedTo)) ? body.pitchedTo : [];
      const stray = pitched.map((x) => String(x.property_id)).filter((id) => id && mine.size && !mine.has(id));
      return { ok: true, mineCount: mine.size, pitchedCount: pitched.length, stray: stray.slice(0, 3) };
    });
    if (!r.ok) throw new Error(`client brand profile unhealthy (${r.status})`);
    if (!r.mineCount) return; // couldn't resolve the client's property set this run
    if (r.stray.length) throw new Error(`brand pitchedTo leaked a rival scheme to the client: property ${r.stray[0]}`);
  });

  // Companion to pitchedTo: the brand-profile `deals` and `bgpDeals` panels
  // must be counterparty-scoped for a client (this brand's deals WITH THEM,
  // not with rival landlords), the BGP fee/internal-agent columns stripped,
  // and the raw `interactions` log empty (staff-only correspondence). A
  // persistent fixture — QA-LEAK-DEAL, Honi↔a rival landlord — must never
  // surface on the Landsec client's Honi profile.
  await step(page, p, 'client-brand-deals-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/brand/${window.QA_FIX.brand}/profile`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const d = await res.json().catch(() => null);
      const deals = Array.isArray(d?.deals) ? d.deals : [];
      const bgpDeals = Array.isArray(d?.bgpDeals) ? d.bgpDeals : [];
      const leaseEvents = Array.isArray(d?.leaseEvents) ? d.leaseEvents : [];
      const names = [...deals, ...bgpDeals].map((x) => String(x.name || ''));
      const feeLeak = bgpDeals.some((x) => 'fee' in x || 'internal_agent' in x || 'team' in x);
      const leaseLeak = leaseEvents.map((x) => String(x.unit_name || '')).includes('QA-LEAK-UNIT');
      return { ok: true, rivalLeak: names.includes('QA-LEAK-DEAL'), feeLeak, leaseLeak, interactions: (d?.interactions || []).length, pending: (d?.pendingContactSuggestions || []).length };
    });
    if (!r.ok) throw new Error(`client brand profile unhealthy (${r.status})`);
    if (r.rivalLeak) throw new Error("a rival-landlord deal (QA-LEAK-DEAL) leaked onto the client's brand profile");
    if (r.feeLeak) throw new Error('BGP fee/internal-agent columns leaked on the client bgpDeals panel');
    if (r.leaseLeak) throw new Error("a rival-scheme lease event (QA-LEAK-UNIT @ Brent Cross) leaked onto the client's brand profile");
    if (r.interactions !== 0) throw new Error(`raw interaction log leaked to the client brand profile (${r.interactions} rows)`);
    if (r.pending !== 0) throw new Error(`correspondence-derived contact suggestions leaked to the client (${r.pending} rows)`);
  });

  // The raw company row (/api/crm/companies/:id) must strip BGP-internal BD
  // prospecting fields for client viewers — hunter flags/notes, distress
  // notes, acquiring/disposing notes, lending appetite, and last-interaction.
  // (Regression guard: these were listed in the strip in snake_case while the
  // row is camelCase, so they leaked. Honi carries seeded QA notes staff-side.)
  await step(page, p, 'client-company-detail-bd-stripped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/crm/companies/${window.QA_FIX.brand}`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const d = await res.json().catch(() => null);
      const internal = ['lettingHunterFlag', 'lettingHunterNotes', 'investmentHunterFlag', 'investmentHunterNotes',
        'distressFlag', 'distressNotes', 'acquiringNowNotes', 'disposingNowNotes', 'lendingAppetiteNotes', 'lastInteraction'];
      const leaked = internal.filter((k) => d && d[k] != null && d[k] !== false && d[k] !== '');
      return { ok: true, leaked };
    });
    if (!r.ok) throw new Error(`client company-detail unhealthy (${r.status})`);
    if (r.leaked.length) throw new Error(`BGP-internal BD fields leaked to the client on the company row: ${r.leaked.join(', ')}`);
  });

  // /api/crm/companies/:id/deals only serves a client their OWN company's
  // deals (fees stripped) — asking for a brand's deals returns []. Honi carries
  // the QA-LEAK-DEAL fixture (with a rival landlord); the client must get an
  // empty list there, and any deal on their own company row must be fee-free.
  await step(page, p, 'client-company-deals-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json().catch(() => ({}));
      const mine = me?.companyScopeId || me?.companyId || null;
      const brandRes = await fetch(`/api/crm/companies/${window.QA_FIX.brand}/deals`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const brand = brandRes.ok ? await brandRes.json().catch(() => null) : null;
      const brandRows = Array.isArray(brand) ? brand : (brand?.deals || []);
      let ownFeeLeak = false;
      if (mine) {
        const own = await (await fetch(`/api/crm/companies/${mine}/deals`, { headers: auth })).json().catch(() => []);
        const rows = Array.isArray(own) ? own : (own?.deals || []);
        ownFeeLeak = rows.some((d) => (d.fee != null && d.fee !== 0) || (d.feeNotes != null && d.feeNotes !== ''));
      }
      return { brandStatus: brandRes.status, brandCount: brandRows.length, ownFeeLeak };
    });
    if (r.brandStatus !== 200) throw new Error(`client company-deals endpoint unhealthy (${r.brandStatus})`);
    if (r.brandCount !== 0) throw new Error(`client listed a brand's deals via /companies/:id/deals (${r.brandCount} rows — QA-LEAK-DEAL leak)`);
    if (r.ownFeeLeak) throw new Error('BGP fee leaked on the client own-company deals list');
  });

  // Suggested-pitches is the brand-profile "which of my vacant units could
  // this operator take" engine (live requirement + AI-ranked available units
  // in the viewer's scope). A client sees it for a brand in their hospitality
  // slice (200 with {brandName, suggestions[]}) but is refused on an
  // out-of-slice brand — the handler's isClientVisibleBrand gate.
  await step(page, p, 'client-brand-suggested-pitches-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const inSlice = await fetch(`/api/brands/${window.QA_FIX.brand}/suggested-pitches`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const body = inSlice.ok ? await inSlice.json().catch(() => null) : null;
      const shapeOk = !!body && typeof body.brandName === 'string' && Array.isArray(body.suggestions);
      const foreign = (await fetch('/api/brands/88888888-1111-1111-1111-111111111111/suggested-pitches', { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { inSliceOk: inSlice.ok, shapeOk, foreign };
    });
    if (!r.inSliceOk || !r.shapeOk) throw new Error('client cannot read suggested-pitches on an in-slice brand');
    if (r.foreign !== 403) throw new Error(`client read suggested-pitches on an out-of-slice brand (expected 403, got ${r.foreign})`);
  });

  // Compliance & KYC panel STAYS visible on client brand profiles (2026-08-01
  // — landlords need tenant AML/financial standing). KYC action gating, as
  // decided 2026-08-04 ("allow Landsec to hit the enrichment button — use the
  // app the same way we can"): the Companies-House auto-KYC enrichment IS now
  // allowed for a brand in the client's slice, but must still be refused on an
  // out-of-slice brand, and the full staff KYC sweep (run-all-checks) stays
  // staff-only. Assert all four halves.
  await step(page, p, 'client-brand-kyc-visible-actions-blocked', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const honi = window.QA_FIX.brand;      // in the hospitality slice
      const outOfSlice = '88888888-1111-1111-1111-111111111111'; // QA Retail Brand
      const prof = await fetch(`/api/brand/${honi}/profile`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const kycVisible = prof.ok ? ((await prof.json().catch(() => ({}))).kyc !== undefined) : false;
      const runChecks = (await fetch('/api/kyc/run-all-checks', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyId: honi }) }).catch(() => ({ status: 0 }))).status;
      const autoKycSlice = (await fetch(`/api/companies-house/auto-kyc/${honi}`, { method: 'POST', credentials: 'include', headers: auth,
        body: '{}' }).catch(() => ({ status: 0 }))).status;
      const autoKycForeign = (await fetch(`/api/companies-house/auto-kyc/${outOfSlice}`, { method: 'POST', credentials: 'include', headers: auth,
        body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { profileOk: prof.ok, kycVisible, runChecks, autoKycSlice, autoKycForeign };
    });
    if (!r.profileOk) throw new Error('client cannot load an in-slice brand profile');
    if (!r.kycVisible) throw new Error('KYC/compliance panel data missing from the client brand profile (decision regressed)');
    if (r.runChecks !== 403) throw new Error(`client ran the staff KYC sweep (expected 403, got ${r.runChecks})`);
    if (r.autoKycSlice === 403) throw new Error('client blocked from the auto-KYC enrichment button on an in-slice brand (2026-08-04 decision regressed)');
    if (r.autoKycForeign !== 403) throw new Error(`client triggered auto-KYC on an out-of-slice brand (expected 403, got ${r.autoKycForeign})`);
  });

  // The per-brand Compliance & KYC PANEL is visible to clients (above), but
  // the firm-wide KYC compliance BOARD is a different surface: every
  // counterparty across every landlord's deals (names, AML status, financial
  // standing) plus the KYC company matcher. That's cross-tenant BGP intel and
  // must stay staff-only — a client login is refused on the board, its deals
  // view, and the matcher.
  await step(page, p, 'client-kyc-board-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const board = await g('/api/kyc/board');
      const deals = await g('/api/kyc/board/deals');
      const match = (await fetch('/api/kyc/match-company', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { board, deals, match };
    });
    if (r.board !== 403) throw new Error(`client reached the firm-wide KYC board (expected 403, got ${r.board})`);
    if (r.deals !== 403) throw new Error(`client reached the KYC board deals view (expected 403, got ${r.deals})`);
    if (r.match !== 403) throw new Error(`client reached the KYC company matcher (expected 403, got ${r.match})`);
  });

  // Property Intelligence hides the Investigator tab for clients (every
  // /api/kyc-clouseau route is client-blocked, so the tool can only
  // dead-end for them — r335). A ?tab=investigator deep link must land on
  // Map without mounting KYC Clouseau, and the API stays 403.
  await step(page, p, 'client-pi-investigator-hidden', async () => {
    await page.goto(`${BASE}/property-intelligence?tab=investigator`).catch((e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
    });
    await page.waitForTimeout(2500);
    const tabCount = await page.locator('[data-testid="pi-tab-investigator"]').count();
    if (tabCount !== 0) throw new Error(`client sees the Investigator tab (${tabCount})`);
    const active = (await page.locator('[role="tab"][data-state="active"]').textContent().catch(() => '')) || '';
    if (!/Map/i.test(active)) throw new Error(`investigator deep link landed on "${active}", not Map`);
    const st = await page.evaluate(async () =>
      (await fetch('/api/kyc-clouseau/recent?limit=1', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } }).catch(() => ({ status: 0 }))).status);
    if (st !== 403) throw new Error(`client kyc-clouseau read expected 403, got ${st}`);
  });

  // The PI Map panel + Land Registry tab work for clients (r359): the
  // property-lookup aggregate, address autocomplete and the LR resolve POST
  // must not 403 (resolve may 503 keyless — that's the staff experience
  // too), while the PAID purchase-title POST and the searches PATCH stay
  // staff-only.
  await step(page, p, 'client-pi-lookup-open', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        lookup: await g('/api/property-lookup?postcode=DA9%209ST&layers=core&propertyDataLayers=core'),
        addr: await g('/api/address-search?q=DA9'),
        resolve: (await fetch('/api/land-registry/resolve', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ postcode: 'DA9 9ST' }) }).catch(() => ({ status: 0 }))).status,
        purchase: (await fetch('/api/land-registry/purchase-title', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status,
        patchSearch: (await fetch('/api/land-registry/searches/00000000-0000-0000-0000-000000000000', { method: 'PATCH', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status,
      };
    });
    if (r.lookup === 403) throw new Error('client property-lookup 403d — PI Map panel is empty for clients again');
    if (r.addr === 403) throw new Error('client address-search 403d — PI map search box is dead for clients again');
    if (r.resolve === 403) throw new Error('client land-registry resolve 403d — LR tab search dead-ends for clients again');
    if (r.purchase !== 403) throw new Error(`client reached the PAID purchase-title endpoint (expected 403, got ${r.purchase})`);
    if (r.patchSearch !== 403) throw new Error(`client patched a land-registry search (expected 403, got ${r.patchSearch})`);
    // Own-searches scoping (r360): staff LR research and the paid-title
    // ledger must never surface for a client login.
    const staffLogin = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: AGENT_USER, password: PASSWORD }) })).json();
    await fetch(`${BASE}/api/land-registry/searches`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffLogin.token}` }, body: JSON.stringify({ address: 'QA-LR-SCOPE staff research probe', postcode: 'ZZ1 1ZZ' }) });
    const scope = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/land-registry/searches', { headers: auth })).json();
      const recent = await (await fetch('/api/land-registry/searches/recent', { headers: auth })).json();
      const ledger = await (await fetch('/api/land-registry/purchases', { headers: auth })).json();
      return {
        leak: [].concat(list, recent).some((s) => (s.address || '').includes('QA-LR-SCOPE')),
        ledgerRows: Array.isArray(ledger) ? ledger.length : -1,
        badDate: (Array.isArray(recent) ? recent : []).some((s) => !s.createdAt),
      };
    });
    if (scope.leak) throw new Error('client can read STAFF land-registry research (own-searches scoping broken)');
    if (scope.ledgerRows !== 0) throw new Error(`client purchase ledger not empty (got ${scope.ledgerRows})`);
    if (scope.badDate) throw new Error('searches/recent row missing createdAt (Invalid Date regression)');
  });

  // Covenant reads are open to clients for THEIR OWN visible brands only
  // (Woody, 2026-08-04: "open up covenant for Mark" — badge + commentary on
  // slice brands). The rest of the engine — rival companies, watchlist,
  // alerts, watch runs — stays staff-only.
  await step(page, p, 'client-covenant-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        byCrmSlice: await g(`/api/covenant/by-crm/${window.QA_FIX.brand}`),
        byCrmRival: await g('/api/covenant/by-crm/99999999-1111-1111-1111-111111111111'),
        watchlist: await g('/api/covenant/watchlist'),
        alerts: await g('/api/covenant/alerts'),
        watchRun: (await fetch('/api/covenant/watch/run', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status,
      };
    });
    if (![200, 204, 400].includes(r.byCrmSlice)) throw new Error(`client covenant read on a slice brand should be allowed (expected 200/204, got ${r.byCrmSlice})`);
    if (r.byCrmRival !== 403) throw new Error(`client read a rival's covenant report (expected 403, got ${r.byCrmRival})`);
    if (r.watchlist !== 403) throw new Error(`client reached the covenant watchlist (expected 403, got ${r.watchlist})`);
    if (r.alerts !== 403) throw new Error(`client reached covenant alerts (expected 403, got ${r.alerts})`);
    if (r.watchRun !== 403) throw new Error(`client triggered a covenant watch run (expected 403, got ${r.watchRun})`);
  });

  // The CRM truth engine (AI contact verification + the data-health review
  // queue + firm-wide sweep) is a data-steward tool — it surfaces flagged
  // contact-quality issues across the whole CRM and rewrites contact records.
  // It lives under the client-allowed /api/crm/ prefix, so this guard proves
  // it's still sealed: a client login is refused on the review queue, the
  // sweep trigger, and per-contact AI verification.
  await step(page, p, 'client-crm-truth-engine-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const dataHealth = (await fetch('/api/crm/data-health', { headers: auth }).catch(() => ({ status: 0 }))).status;
      const sweep = (await fetch('/api/crm/data-health/sweep', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      const verify = (await fetch('/api/crm/contacts/00000000-0000-0000-0000-000000000000/verify', { method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ status: 0 }))).status;
      return { dataHealth, sweep, verify };
    });
    if (r.dataHealth !== 403) throw new Error(`client reached the CRM data-health review queue (expected 403, got ${r.dataHealth})`);
    if (r.sweep !== 403) throw new Error(`client triggered a CRM data-health sweep (expected 403, got ${r.sweep})`);
    if (r.verify !== 403) throw new Error(`client triggered AI contact verification (expected 403, got ${r.verify})`);
  });

  // Apollo org enrichment (firmographics on a brand): a client may READ the
  // cached enrichment for a brand in their own slice (it's brand intelligence,
  // like the rest of the profile), but must NOT be able to trigger the paid
  // /refresh (it burns Apollo API credits) and must not read or refresh a
  // brand outside their scope. Proves the read is scope-gated and the paid
  // write stays staff-only.
  await step(page, p, 'client-apollo-enrichment-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const slice = window.QA_FIX.brand;
      const rival = '99999999-1111-1111-1111-111111111111';
      const g = async (url, opts) => (await fetch(url, opts || { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        readSlice: await g(`/api/brand/${slice}/apollo-company`),
        readRival: await g(`/api/brand/${rival}/apollo-company`),
        refreshSlice: await g(`/api/brand/${slice}/apollo-company/refresh`, { method: 'POST', credentials: 'include', headers: auth, body: '{}' }),
        refreshRival: await g(`/api/brand/${rival}/apollo-company/refresh`, { method: 'POST', credentials: 'include', headers: auth, body: '{}' }),
      };
    });
    if (![200, 204].includes(r.readSlice)) throw new Error(`client apollo read on a slice brand should be allowed (expected 200/204, got ${r.readSlice})`);
    if (r.readRival !== 403) throw new Error(`client read apollo enrichment on a rival brand (expected 403, got ${r.readRival})`);
    if (r.refreshSlice !== 403) throw new Error(`client triggered a paid apollo refresh on a slice brand (expected 403, got ${r.refreshSlice})`);
    if (r.refreshRival !== 403) throw new Error(`client triggered a paid apollo refresh on a rival brand (expected 403, got ${r.refreshRival})`);
  });

  // The client CRM shows the hospitality/leisure/fitness category slice
  // (Woody, 2026-08-01: "landsec only want CRM on the hospitality fitness
  // restaurants leisure cafes" — this supersedes the earlier "open up all
  // brands" note; do NOT resolve this back to all-brands in merges). A
  // non-hospitality brand (seeded Retail) must be gated by default, become
  // readable once added from the global directory, and gate again once
  // removed — while a rival LANDLORD stays 403 always. Also sanity-checks
  // /api/client/brand-theme serves the caller's theme.
  await step(page, p, 'client-brand-slice-and-extras', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const json = { ...auth, 'Content-Type': 'application/json' };
      const retail = '88888888-1111-1111-1111-111111111111';   // QA Retail Brand
      const landlord = '99999999-1111-1111-1111-111111111111'; // Hammerson
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const before = await g(`/api/crm/companies/${retail}`);
      const add = (await fetch('/api/client/crm/add-brand', { method: 'POST', headers: json, body: JSON.stringify({ brandId: retail }) }).catch(() => ({ status: 0 }))).status;
      const afterAdd = await g(`/api/crm/companies/${retail}`);
      const profileAfterAdd = await g(`/api/brand/${retail}/profile`);
      const remove = (await fetch(`/api/client/crm/add-brand/${retail}`, { method: 'DELETE', headers: auth }).catch(() => ({ status: 0 }))).status;
      const afterRemove = await g(`/api/crm/companies/${retail}`);
      return {
        before, add, afterAdd, profileAfterAdd, remove, afterRemove,
        rivalLandlord: await g(`/api/crm/companies/${landlord}`),
        brandTheme: await g('/api/client/brand-theme'),
      };
    });
    if (r.before !== 403) throw new Error(`out-of-slice brand readable before add (expected 403, got ${r.before})`);
    if (r.add !== 200) throw new Error(`add-from-global failed (${r.add})`);
    if (r.afterAdd !== 200) throw new Error(`added brand still gated (company ${r.afterAdd})`);
    if (r.profileAfterAdd !== 200) throw new Error(`added brand profile still gated (${r.profileAfterAdd})`);
    if (r.remove !== 200) throw new Error(`remove-extra failed (${r.remove})`);
    if (r.afterRemove !== 403) throw new Error(`removed brand still readable (expected 403, got ${r.afterRemove})`);
    if (r.rivalLandlord !== 403) throw new Error(`rival landlord readable by client (expected 403, got ${r.rivalLandlord})`);
    if (r.brandTheme !== 200) throw new Error(`client brand-theme route not serving (${r.brandTheme})`);
  });

  // Global search (Ctrl+K) for clients must match the canonical brand slice
  // (clientBrandSliceSql: categories + self-added extras) and never leak the
  // rival's world (r500: /api/search had its own category regex that missed
  // Bakery and the crm_extra_brand_ids extras).
  await step(page, p, 'client-global-search-slice', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const names = async (q) => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: auth }).catch(() => null);
        if (!res || !res.ok) return null;
        const j = await res.json().catch(() => ({}));
        return (j.results || []).map((x) => x.name);
      };
      return { testco: await names('Testco'), brent: await names('Brent'), bluewater: await names('Bluewater') };
    });
    if (!r.testco) throw new Error('client /api/search failed');
    if (!r.testco.includes('Testco Bakery')) throw new Error('slice-category brand (Testco Bakery) missing from client search');
    if (!r.testco.includes('Testco Fashion')) throw new Error('self-added extra brand (Testco Fashion) missing from client search');
    if (r.testco.includes('Testco Jewellers')) throw new Error('out-of-slice brand (Testco Jewellers) leaked into client search');
    if (r.brent && r.brent.length) throw new Error(`rival property leaked into client search: ${r.brent.join(', ')}`);
    if (!r.bluewater || !r.bluewater.some((n) => /bluewater/i.test(n))) throw new Error('own property missing from client search');
  });

  // The client "add brand from the global directory" endpoints (terminal
  // side): search returns tenant brands, add writes crm_extra_brand_ids,
  // remove clears it. Client-scoped (staff get 403). Under all-brands these
  // are a bonus, but must still round-trip and not error.
  await step(page, p, 'client-add-brand-from-directory', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const retail = '88888888-1111-1111-1111-111111111111';
      const search = await fetch('/api/client/crm/global-brands?search=qa', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const searchOk = search.ok;
      const searchArr = searchOk ? await search.json().catch(() => []) : [];
      const add = await fetch('/api/client/crm/add-brand', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ brandId: retail }) }).catch(() => ({ ok: false, status: 0 }));
      const del = await fetch(`/api/client/crm/add-brand/${retail}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ ok: false, status: 0 }));
      return { searchOk, searchIsArray: Array.isArray(searchArr), addOk: add.ok, delOk: del.ok };
    });
    if (!r.searchOk || !r.searchIsArray) throw new Error('client global-brands search failed');
    if (!r.addOk) throw new Error('client add-brand-from-directory failed');
    if (!r.delOk) throw new Error('client remove-brand failed');
  });

  // The add-brand dialog is also where a client REMOVES a self-added brand
  // (r247): an "Added" extra row must carry the Remove button, clicking it
  // flips the row back to Add, and slice rows never show Remove.
  await step(page, p, 'client-add-brand-remove-ui', async () => {
    const retail = '88888888-1111-1111-1111-111111111111';
    await page.evaluate(async (id) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      await fetch('/api/client/crm/add-brand', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ brandId: id }) });
    }, retail);
    await page.goto(`${BASE}/brands`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    await page.getByTestId('client-add-brand').click();
    await page.getByTestId('client-add-brand-search').fill('QA Retail');
    await page.waitForTimeout(1500);
    const removeBtn = page.getByTestId(`client-remove-brand-${retail}`);
    if (!(await removeBtn.count())) throw new Error('self-added brand row has no Remove button in the add-brand dialog');
    await removeBtn.click();
    // The flip is a query invalidation + refetch — fast alone (~150ms) but can
    // exceed a fixed wait under round load (r256 flake), so poll up to 10s.
    await removeBtn.waitFor({ state: 'detached', timeout: 10000 })
      .catch(() => { throw new Error('Remove click did not flip the row back to Add (10s)'); });
    await page.getByTestId('client-add-brand-search').fill('Starbucks');
    await page.waitForTimeout(1500);
    const dlg = await page.locator('[role="dialog"]').innerText();
    if (/Remove/.test(dlg)) throw new Error('slice brand row shows a Remove button (must be In CRM badge only)');
    await page.keyboard.press('Escape');
    const left = await page.evaluate(async (id) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json();
      return me?.companyScopeId || null;
    }, retail);
    if (left) {
      const extras = await page.evaluate(async () => {
        const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
        const r = await fetch('/api/client/crm/global-brands?search=qa retail', { headers: auth });
        const arr = await r.json().catch(() => []);
        return Array.isArray(arr) ? arr.filter((b) => b.added).length : -1;
      });
      if (extras !== 0) throw new Error(`QA Retail still marked added after UI remove (${extras})`);
    }
  });

  // Client dashboard carries the Portfolio Map (same map as the landlord
  // pages) and the BGP Relationship card, and the portfolio payload supplies
  // coordinates for the pins.
  await step(page, p, 'client-dashboard-map-and-relationship', async () => {
    await page.goto(`${BASE}/`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    if (!(await page.getByText('BGP Relationship', { exact: false }).count()))
      throw new Error('BGP Relationship card missing from client dashboard');
    // The map widget was renamed "Properties & Deals" in the canonical-family
    // rework (2026-08-03) — accept either label; the leaflet assertions below
    // are the real substance.
    const mapLabel = (await page.getByText('Properties & Deals', { exact: false }).count())
      || (await page.getByText('Portfolio Map', { exact: false }).count());
    if (!mapLabel)
      throw new Error('portfolio map widget missing from client dashboard');
    if (!(await page.locator('.leaflet-container').count()))
      throw new Error('portfolio map did not initialise (no leaflet container)');
    const coords = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json();
      const cid = me.companyScopeId;
      if (!cid) return { n: 0 };
      const d = await (await fetch(`/api/company-portfolio/${cid}`, { headers: auth })).json();
      return { n: (d.properties || []).filter((x) => x.lat != null && x.lng != null).length };
    });
    if (!coords.n) throw new Error('portfolio payload returned no property coordinates for the map');
  });

  // The Landsec dashboard now rolls contacts up across the whole portfolio via
  // /api/company-portfolio/:id/linked-contacts. That roll-up is scoped: a
  // client reads it for their OWN company id, but another company's
  // portfolio-wide contact roll-up is refused. Own → 200, foreign → 403.
  await step(page, p, 'client-portfolio-rollup-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json().catch(() => ({}));
      const mine = me?.companyScopeId || me?.companyId || null;
      const foreign = '99999999-1111-1111-1111-111111111111';
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const own = mine ? await g(`/api/company-portfolio/${mine}/linked-contacts`) : 0;
      const other = await g(`/api/company-portfolio/${foreign}/linked-contacts`);
      return { mine, own, other };
    });
    if (!r.mine) throw new Error('client has no company scope on /api/auth/me');
    if (r.own !== 200) throw new Error(`client own portfolio contact roll-up unhealthy (expected 200, got ${r.own})`);
    if (r.other !== 403) throw new Error(`client read another company's portfolio contact roll-up (expected 403, got ${r.other})`);
  });

  // The new Client Tasks board reads /api/company-portfolio/:id/tasks, split
  // into open/done. Scoped like the rest of the portfolio surface: a client
  // reads their OWN board (200, {open,done} arrays) but another company's task
  // board is refused.
  await step(page, p, 'client-tasks-board-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json().catch(() => ({}));
      const mine = me?.companyScopeId || me?.companyId || null;
      const foreign = '99999999-1111-1111-1111-111111111111';
      const ownRes = mine ? await fetch(`/api/company-portfolio/${mine}/tasks`, { headers: auth }).catch(() => ({ ok: false, status: 0 })) : { ok: false, status: 0 };
      const ownBody = ownRes.ok ? await ownRes.json().catch(() => null) : null;
      const other = (await fetch(`/api/company-portfolio/${foreign}/tasks`, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { mine, ownStatus: ownRes.status, shape: !!ownBody && Array.isArray(ownBody.open) && Array.isArray(ownBody.done), other };
    });
    if (!r.mine) throw new Error('client has no company scope on /api/auth/me');
    if (r.ownStatus !== 200) throw new Error(`client own tasks board unhealthy (expected 200, got ${r.ownStatus})`);
    if (!r.shape) throw new Error('client tasks board payload missing open/done arrays');
    if (r.other !== 403) throw new Error(`client read another company's tasks board (expected 403, got ${r.other})`);
  });

  // Client opens the viewings + offers panels on one of their own units — the
  // leasing-activity surfaces they'd actually check. Must return data (not
  // 4xx) for a unit in their scope.
  // Requirement matches on the client's OWN unit are readable (terminal side
  // opened these — slice-filtered), but a foreign unit's matches must refuse.
  await step(page, p, 'client-unit-matches', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const own = await fetch(`/api/available-units/matches/${unit.id}`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownArray = own.ok ? Array.isArray(await own.json().catch(() => null)) : false;
      const foreign = await fetch('/api/available-units/matches/99999999-3333-3333-3333-333333333333', { headers: auth }).catch(() => ({ status: 0, ok: false }));
      return { ownOk: own.ok, ownArray, foreignStatus: foreign.status };
    });
    if (r.skip) return;
    if (!r.ownOk || !r.ownArray) throw new Error('client cannot read requirement matches on their own unit');
    if (r.foreignStatus !== 403) throw new Error(`client read matches on a foreign unit (expected 403, got ${r.foreignStatus})`);
  });

  // Brand-suggestions is the operator-pitch engine for a vacant unit —
  // "who should we target for this space" (live requirements + tracked
  // brands, AI-ranked). Distinct from the requirement-matches list above.
  // A client sees it for their own unit (AI rank degrades gracefully with
  // no key, so a healthy call is a 200 with a suggestions array) and is
  // refused on a foreign landlord's unit.
  await step(page, p, 'client-brand-suggestions-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const own = await fetch(`/api/available-units/${unit.id}/brand-suggestions`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownBody = own.ok ? await own.json().catch(() => null) : null;
      const foreign = await fetch('/api/available-units/99999999-3333-3333-3333-333333333333/brand-suggestions', { headers: auth }).catch(() => ({ status: 0, ok: false }));
      return { ownOk: own.ok, ownArray: Array.isArray(ownBody?.suggestions), foreignStatus: foreign.status };
    });
    if (r.skip) return;
    if (!r.ownOk || !r.ownArray) throw new Error('client cannot read brand suggestions on their own unit');
    if (r.foreignStatus !== 403) throw new Error(`client read brand suggestions on a foreign unit (expected 403, got ${r.foreignStatus})`);
  });

  // The global requirements↔units matches board (/crm/requirements-leasing/
  // matches) scopes its unit pool to the caller's company. A client login
  // must see a healthy board whose every referenced unit is one they can
  // actually reach via /available-units — no rival landlord's unit may
  // surface as a match target.
  await step(page, p, 'client-requirement-matches-board-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth }).catch(() => null))?.json().catch(() => null);
      const allowed = new Set((Array.isArray(units) ? units : []).map((u) => String(u.id)));
      const res = await fetch('/api/crm/requirements-leasing/matches', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = await res.json().catch(() => null);
      const matches = body && typeof body.matches === 'object' ? body.matches : null;
      if (!matches || typeof body.unitPool !== 'number') return { ok: false, status: res.status, shape: true };
      const leaked = [];
      for (const key of Object.keys(matches)) {
        for (const hit of (matches[key]?.top || [])) {
          if (!allowed.has(String(hit.unitId))) leaked.push(String(hit.unitId));
        }
      }
      return { ok: true, unitPool: body.unitPool, leaked: leaked.slice(0, 3) };
    });
    if (!r.ok) throw new Error(r.shape ? 'requirement-matches board returned an unexpected shape' : `client requirement-matches board unhealthy (${r.status})`);
    if (r.leaked && r.leaked.length) throw new Error(`rival unit leaked into the client matches board: ${r.leaked.join(', ')}`);
  });

  await step(page, p, 'client-viewings-offers', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { ok: false, why: 'no available units in client scope' };
      const v = await fetch(`/api/available-units/${unit.id}/viewings`, { headers: auth });
      const o = await fetch(`/api/available-units/${unit.id}/offers`, { headers: auth });
      return { ok: v.ok && o.ok, vStatus: v.status, oStatus: o.status };
    });
    if (!r.ok) throw new Error(r.why || `viewings ${r.vStatus} / offers ${r.oStatus} for an in-scope unit`);
    // Client-parity WRITE round-trip (r311: journey-verified in the dialogs;
    // this locks the API path): the client logs a viewing on their own unit,
    // it must land in the unit's list, and the client can remove it again.
    const w = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { ok: false, why: 'no available units in client scope' };
      const post = await fetch(`/api/available-units/${unit.id}/viewings`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ viewingDate: new Date().toISOString().slice(0, 10), attendees: marker }) });
      if (!post.ok) return { ok: false, why: `client viewing POST ${post.status}` };
      const made = await post.json();
      const list = await (await fetch(`/api/available-units/${unit.id}/viewings`, { headers: auth })).json();
      if (!(Array.isArray(list) && list.some((x) => x.id === made.id))) return { ok: false, why: 'client-logged viewing missing from unit list' };
      const del = await fetch(`/api/available-units/viewings/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `client viewing DELETE ${del.status}` };
      const after = await (await fetch(`/api/available-units/${unit.id}/viewings`, { headers: auth })).json();
      if (Array.isArray(after) && after.some((x) => x.id === made.id)) return { ok: false, why: 'deleted viewing still listed' };
      return { ok: true };
    }, `QA-VIEWING-R${ROUND}-CLIENT`);
    if (!w.ok) throw new Error(w.why);
    // And the Letting Tracker UI must render the controls that open them.
    // NB the client's tracker is the Deals-hub tab at /deals/letting —
    // /leasing-schedule is the leasing STRATEGY board (zones/positioning).
    // /available also renders for clients now (scoped isClientTracker branch,
    // verified r331) — no redirect; this scenario checks the Deals-hub tab.
    await page.goto(`${BASE}/deals/letting`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    const controls = '[data-testid^="button-viewings-"], [data-testid^="unit-viewing-"], [data-testid^="button-offers-"], [data-testid^="unit-interest-"]';
    if (!(await page.locator(controls).count())) {
      throw new Error('no viewings/offers controls on the client Letting Tracker (/deals/letting)');
    }
  });

  // The Letting Tracker's per-unit offer/viewing count badges come from
  // /api/available-units/all-{offers,viewings}-counts, which scope by
  // clientUnitScopeSql. This proves the badge maps never key a unit outside
  // the client's own available-units list — a regression there would flash
  // another landlord's deal activity (a count against a foreign unit id) on
  // the client's tracker.
  await step(page, p, 'client-tracker-counts-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const j = async (url) => { const res = await fetch(url, { headers: auth }); return { ok: res.ok, status: res.status, body: res.ok ? await res.json().catch(() => null) : null }; };
      const units = await j('/api/available-units');
      const offers = await j('/api/available-units/all-offers-counts');
      const views = await j('/api/available-units/all-viewings-counts');
      const interest = await j('/api/available-units/all-interest-counts');
      if (!units.ok || !offers.ok || !views.ok || !interest.ok) return { ok: false, why: `units ${units.status} / offers ${offers.status} / views ${views.status} / interest ${interest.status}` };
      const visible = new Set((Array.isArray(units.body) ? units.body : []).map((u) => u.id));
      const stray = (map) => Object.keys(map || {}).filter((id) => !visible.has(id));
      return { ok: true, visibleCount: visible.size, strayOffers: stray(offers.body), strayViews: stray(views.body), strayInterest: stray(interest.body) };
    });
    if (!r.ok) throw new Error(`tracker count endpoints failed (${r.why})`);
    if (!r.visibleCount) return; // no units in scope this run — nothing to assert
    if (r.strayOffers.length) throw new Error(`offer-count badge keyed a unit outside client scope: ${r.strayOffers[0]}`);
    if (r.strayViews.length) throw new Error(`viewing-count badge keyed a unit outside client scope: ${r.strayViews[0]}`);
    if (r.strayInterest.length) throw new Error(`interest-count badge keyed a unit outside client scope: ${r.strayInterest[0]}`);
  });

  // Beyond the count badges, the full viewing/offer RECORD lists
  // (/api/available-units/all-{viewings,offers}) carry sensitive per-deal
  // detail — viewer names, offer amounts, acting agents. They must be scoped
  // the same way: every record's unit_id must belong to a unit in the
  // client's own available-units list, never another landlord's.
  await step(page, p, 'client-tracker-records-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const j = async (url) => { const res = await fetch(url, { headers: auth }); return { ok: res.ok, status: res.status, body: res.ok ? await res.json().catch(() => null) : null }; };
      const units = await j('/api/available-units');
      const views = await j('/api/available-units/all-viewings');
      const offers = await j('/api/available-units/all-offers');
      const interest = await j('/api/available-units/all-interest');
      if (!units.ok || !views.ok || !offers.ok || !interest.ok) return { ok: false, why: `units ${units.status} / views ${views.status} / offers ${offers.status} / interest ${interest.status}` };
      const visible = new Set((Array.isArray(units.body) ? units.body : []).map((u) => u.id));
      const rows = (b) => Array.isArray(b) ? b : (b && Array.isArray(b.data) ? b.data : []);
      const stray = (b) => rows(b).map((x) => x.unit_id || x.unitId).filter((id) => id && !visible.has(id));
      return { ok: true, visibleCount: visible.size, strayViews: stray(views.body), strayOffers: stray(offers.body), strayInterest: stray(interest.body) };
    });
    if (!r.ok) throw new Error(`tracker record endpoints failed (${r.why})`);
    if (!r.visibleCount) return; // no units in scope this run
    if (r.strayViews.length) throw new Error(`a viewing record for a unit outside client scope leaked: ${r.strayViews[0]}`);
    if (r.strayOffers.length) throw new Error(`an offer record for a unit outside client scope leaked: ${r.strayOffers[0]}`);
    if (r.strayInterest.length) throw new Error(`an interest record for a unit outside client scope leaked: ${r.strayInterest[0]}`);
  });

  // Client must NOT see the requirement the agent just created for another
  // brand unless it's theirs — guards requirements-board scoping.
  await step(page, p, 'client-requirement-scoping', async () => {
    if (!cross.reqStamp) return; // agent step didn't run
    // API-level: the live requirement must be absent from the client's list
    // AND unreadable by id (the requirements book is BGP intel).
    const api = await page.evaluate(async (args) => {
      const [stamp, id] = args;
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/crm/requirements-leasing', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.data || []);
      const inList = rows.some((r) => JSON.stringify(r).includes(stamp));
      const byId = id ? (await fetch(`/api/crm/requirements-leasing/${id}`, { headers: auth }).catch(() => ({ status: 0 }))).status : null;
      // The matches sub-resource is a separate route that takes a raw
      // requirement id — it must refuse clients too (BGP intel by id).
      const matches = id ? (await fetch(`/api/requirements/matches/${id}`, { headers: auth }).catch(() => ({ status: 0 }))).status : null;
      return { inList, byId, matches };
    }, [cross.reqStamp, cross.reqId]);
    if (api.inList) throw new Error(`agent-only requirement "${cross.reqStamp}" leaked into the client's requirements list`);
    if (cross.reqId && api.byId !== 404 && api.byId !== 403) throw new Error(`client read a BGP-intel requirement by id (expected 404/403, got ${api.byId})`);
    if (cross.reqId && api.matches !== 403 && api.matches !== 404) throw new Error(`client read requirement MATCHES by id (expected 403/404, got ${api.matches})`);
    // UI: the stamp must not render on the client's requirements page either.
    await page.goto(`${BASE}/requirements`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    const leaked = await page.getByText(cross.reqStamp, { exact: false }).count();
    if (leaked) throw new Error(`agent-only requirement "${cross.reqStamp}" visible to client`);
  });

  // Requirements are READ-ONLY for clients: they see the demand side but must
  // never author or edit it (the pipeline is BGP-owned). Every write path —
  // leasing create/edit/delete and investment create — must be refused, while
  // the GET stays open (covered by client-requirements above).
  await step(page, p, 'client-requirements-write-guards', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const rl = await (await fetch('/api/crm/requirements-leasing', { headers: auth })).json().catch(() => []);
      const anyId = Array.isArray(rl) && rl[0] ? rl[0].id : '00000000-0000-0000-0000-000000000000';
      const probe = async (method, url, body) =>
        (await fetch(url, { method, credentials: 'include', headers: auth, body: body ? JSON.stringify(body) : undefined }).catch(() => ({ status: 0 }))).status;
      return {
        readOk: Array.isArray(rl),
        createLeasing: await probe('POST', '/api/crm/requirements-leasing', { name: 'QA-REQ-PROBE' }),
        editLeasing: await probe('PUT', `/api/crm/requirements-leasing/${anyId}`, { name: 'QA-REQ-HIJACK' }),
        deleteLeasing: await probe('DELETE', `/api/crm/requirements-leasing/${anyId}`),
        createInvestment: await probe('POST', '/api/crm/requirements-investment', { name: 'QA-REQ-PROBE' }),
      };
    });
    if (!r.readOk) throw new Error('client cannot read the requirements list (over-scoped)');
    const leaked = Object.entries(r).filter(([k, v]) => k !== 'readOk' && v >= 200 && v < 300).map(([k]) => k);
    if (leaked.length) throw new Error(`client allowed a requirements write: ${leaked.join(', ')}`);
  });

  // Client team board: the badge count must match the cards actually rendered
  // (unassigned members were silently dropped before — badge said 12, 8 shown),
  // and the client must be able to edit it (add-member control present).
  await step(page, p, 'client-team-board-integrity', async () => {
    await page.goto(`${BASE}/companies/${LANDSEC}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    const chart = page.locator('[data-testid="client-team-orgchart"]');
    if (!(await chart.count())) return; // board not surfaced on this profile — nothing to assert
    // Invariants that don't conflate sources: the account-contacts badge and
    // the org chart are different lists, so don't compare their counts. What
    // must hold is that the chart renders, shows no duplicate people, and
    // every card belongs to a column.
    const cards = await chart.locator('[data-testid^="team-member-card-"]').count();
    if (!cards) throw new Error('client team board renders no members');
    const dupes = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="client-team-orgchart"]');
      const ids = [...(c?.querySelectorAll('[data-testid^="team-member-card-"]') || [])]
        .map(el => el.getAttribute('data-testid'));
      return ids.length - new Set(ids).size;
    });
    if (dupes) throw new Error(`client team board renders ${dupes} duplicate member card(s)`);
    if (!(await page.locator('[data-testid="btn-add-team-member"]').count())) {
      throw new Error('client team board has no add-member control (should mirror the internal board)');
    }
  });

  // Client edits a tenancy/leasing schedule cell on their own property and it
  // persists (these endpoints are client-allowed but scope-checked).
  await step(page, p, 'client-tenancy-edit', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json();
      const list = Array.isArray(props) ? props : (props?.data || []);
      if (!list[0]) return { skip: true };
      const rows = await (await fetch(`/api/leasing-schedule/property/${list[0].id}`, { headers: auth })).json();
      const units = Array.isArray(rows) ? rows : (rows?.units || rows?.data || []);
      const unit = units[0];
      if (!unit?.id) return { skip: true };
      const note = `QA note R${Date.now() % 100000}`;
      const put = await fetch(`/api/leasing-schedule/unit/${unit.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: note }),
      });
      if (!put.ok) return { ok: false, status: put.status };
      const after = await (await fetch(`/api/leasing-schedule/property/${list[0].id}`, { headers: auth })).json();
      const arr = Array.isArray(after) ? after : (after?.units || after?.data || []);
      const found = arr.find((u) => u.id === unit.id);
      return { ok: true, persisted: JSON.stringify(found || {}).includes(note) };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`client tenancy edit rejected (${r.status}) on their own property`);
    if (!r.persisted) throw new Error('client tenancy edit returned OK but did not persist');
  });

  // The tenancy-schedule write is own-property only. A client editing a
  // rival landlord's tenancy row (QA-LEAK-UNIT on Brent Cross) must be refused,
  // and the rival property's schedule must be unreadable. Complements
  // client-tenancy-edit (own-property write) with the foreign-scope guard.
  await step(page, p, 'client-tenancy-write-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      // The seeded rival tenancy row (Brent Cross BX10) — it must EXIST so
      // the probe reaches the scope gate; a made-up id 404s before authz.
      const put = (await fetch('/api/leasing-schedule/unit/99999999-4444-4444-4444-444444444444', { method: 'PUT', credentials: 'include', headers: auth, body: JSON.stringify({ updates: 'QA-INTRUSION client edit on rival scheme' }) }).catch(() => ({ status: 0 }))).status;
      const read = (await fetch('/api/leasing-schedule/property/99999999-2222-2222-2222-222222222222', { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { put, read };
    });
    if (r.put !== 403) throw new Error(`client edited a rival landlord's tenancy row (expected 403, got ${r.put})`);
    if (r.read !== 403) throw new Error(`client read a rival property's tenancy schedule (expected 403, got ${r.read})`);
  });

  // Import / bulk-delete / resync-mirror are staff-only (gateway comment:
  // "import/bulk-delete stay staff-only") — a client must get 403 even on
  // their OWN property. r223: the client UI showed Import/Re-sync buttons
  // that hit these; the buttons are now hidden, this locks the server side.
  await step(page, p, 'client-tenancy-staff-ops-guard', async () => {
    const r = await page.evaluate(async () => {
      const pid = window.QA_FIX.bluewater;
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const bulk = (await fetch('/api/tenancy-schedule/bulk-delete', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ propertyId: pid }) }).catch(() => ({ status: 0 }))).status;
      const imp = (await fetch('/api/tenancy-schedule/import-excel', { method: 'POST', credentials: 'include', headers: { Authorization: auth.Authorization } }).catch(() => ({ status: 0 }))).status;
      const resync = (await fetch(`/api/properties/${pid}/resync-mirror`, { method: 'POST', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      return { bulk, imp, resync };
    });
    if (r.bulk !== 403) throw new Error(`client bulk-deleted own tenancy schedule (expected 403, got ${r.bulk})`);
    if (r.imp !== 403) throw new Error(`client reached tenancy import-excel (expected 403, got ${r.imp})`);
    if (r.resync !== 403) throw new Error(`client fired global resync-mirror (expected 403, got ${r.resync})`);
  });

  // r367: bulk-delete is staff-only (guard above), so the tenancy board must
  // not offer a client the tick column / "Delete selected" bar that can only
  // 403 (same class as the r223 Import/Re-sync fix). Per-row trash stays —
  // single-row delete is client-allowed on their own property.
  await step(page, p, 'client-tenancy-bulk-ticks-hidden', async () => {
    await page.goto(`${BASE}/tenancy-schedule/${BLUEWATER}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText('Tenancy Schedule', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    if (await page.getByTestId('tenancy-select-all').count()) {
      throw new Error('bulk-delete select-all checkbox leaked to client tenancy board');
    }
    const rowTicks = await page.locator('tbody input[type="checkbox"]').count();
    if (rowTicks > 0) throw new Error(`${rowTicks} bulk-delete row ticks leaked to client tenancy board`);
  });

  // r393: every write on the tenancy board 403s for a client (covered by
  // client-tenancy-write-scoped), so the edit affordances must not render —
  // Add unit, per-row status dropdowns, row deletes and inline cell editing
  // were all client-visible dead controls (same class as the plans fix).
  await step(page, p, 'client-tenancy-edit-controls-hidden', async () => {
    await page.goto(`${BASE}/tenancy-schedule/${BLUEWATER}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText('Tenancy Schedule', { exact: false }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    if (await page.getByTestId('btn-add-tenancy-unit').count()) {
      throw new Error('Add-unit button leaked to client tenancy board');
    }
    const statusSelects = await page.locator('select[data-testid^="tenancy-status-"]').count();
    if (statusSelects > 0) throw new Error(`${statusSelects} status dropdowns leaked to client tenancy board`);
    const deletes = await page.locator('[data-testid^="tenancy-delete-"]').count();
    if (deletes > 0) throw new Error(`${deletes} row-delete buttons leaked to client tenancy board`);
    if (await page.getByTestId('btn-import-tenancy').count()) {
      throw new Error('Import button leaked to client tenancy board');
    }
  });

  // r368: plan upload is client-allowed on their own property (board parity)
  // but every other plan write — rename, auto-detect, delete — is staff-only,
  // so the plans panel must not offer a client those controls (same class as
  // the r367 tick fix) and the server must 403 the writes even on a plan the
  // client itself uploaded. run-round.sh purges the QA-PLAN-GATE row.
  await step(page, p, 'client-plans-write-controls-hidden', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const fd = new FormData();
      fd.append('file', new Blob([bytes], { type: 'image/png' }), 'qa-plan-gate.png');
      fd.append('floor', 'QA-PLAN-GATE');
      const up = await fetch(`/api/properties/${window.QA_FIX.bluewater}/plans`, { method: 'POST', credentials: 'include', headers: auth, body: fd }).catch(() => ({ status: 0 }));
      const plan = up.status === 200 ? await up.json().catch(() => null) : null;
      if (!plan) return { up: up.status };
      const jsonAuth = { ...auth, 'Content-Type': 'application/json' };
      const patch = (await fetch(`/api/plans/${plan.id}`, { method: 'PATCH', credentials: 'include', headers: jsonAuth, body: JSON.stringify({ floor: 'QA-PLAN-GATE' }) }).catch(() => ({ status: 0 }))).status;
      const auto = (await fetch(`/api/plans/${plan.id}/auto-detect`, { method: 'POST', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      const del = (await fetch(`/api/plans/${plan.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      return { up: up.status, patch, auto, del };
    });
    if (r.up !== 200) throw new Error(`client own-property plan upload should be allowed (expected 200, got ${r.up})`);
    if (r.patch !== 403) throw new Error(`client renamed a plan (expected 403, got ${r.patch})`);
    if (r.auto !== 403) throw new Error(`client fired plan auto-detect (expected 403, got ${r.auto})`);
    if (r.del !== 403) throw new Error(`client deleted a plan (expected 403, got ${r.del})`);
    await page.goto(`${BASE}/properties/${BLUEWATER}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByTestId('button-upload-plan').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    if (!(await page.getByTestId('button-floor-QA-PLAN-GATE').count())) throw new Error('uploaded plan chip not rendered on client plans panel');
    if (await page.getByTestId('button-toggle-draw-mode').count()) throw new Error('Add-unit draw toggle leaked to client plans panel');
    if ((await page.getByTestId('button-auto-detect-plan').count()) + (await page.getByTestId('button-auto-detect-plan-hq').count())) throw new Error('Auto-detect leaked to client plans panel');
    if (await page.locator('[data-testid="property-plans-panel"] button[title^="Delete"]').count()) throw new Error('Delete-plan button leaked to client plans panel');
  });

  // The unified tenancy schedule's deal/letting link-map on the client's OWN
  // property must load (drives the tenancy view's linked-deal chips). It's
  // scope-checked; the foreign case is covered in client-foreign-unit-guards.
  await step(page, p, 'client-tenancy-links', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/tenancy-schedule/property/${window.QA_FIX.bluewater}/links`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const d = await res.json().catch(() => null);
      return { ok: true, shape: !!d && Array.isArray(d.deals) && Array.isArray(d.lettingUnits) };
    });
    if (!r.ok) throw new Error(`client own tenancy links rejected (${r.status})`);
    if (!r.shape) throw new Error('tenancy links payload missing deals/lettingUnits arrays');
  });

  // The property tenant list (/api/crm/properties/:id/tenants — the rent roll
  // of who occupies a scheme) is core client data for their OWN buildings but
  // another landlord's rent roll is off-limits, and the list is read-only for
  // a client (removing a tenant is a staff write). Own → 200, foreign → 403,
  // tenant-unlink DELETE → 403.
  await step(page, p, 'client-property-tenants-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = window.QA_FIX.bluewater;
      const foreign = '44444444-4444-4444-4444-444444444444';
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const ownRes = await fetch(`/api/crm/properties/${own}/tenants`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownBody = ownRes.ok ? await ownRes.json().catch(() => null) : null;
      const del = (await fetch(`/api/crm/properties/${own}/tenants/${window.QA_FIX.brand}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      return { ownStatus: ownRes.status, ownIsArray: Array.isArray(ownBody), foreign: await g(`/api/crm/properties/${foreign}/tenants`), del };
    });
    if (r.ownStatus !== 200 || !r.ownIsArray) throw new Error(`client own property tenant list unhealthy (status ${r.ownStatus}, array ${r.ownIsArray})`);
    if (r.foreign !== 403) throw new Error(`client read a foreign property's rent roll (expected 403, got ${r.foreign})`);
    if (r.del !== 403) throw new Error(`client removed a tenant from a property (expected 403, got ${r.del})`);
  });

  // Property row writes (billing entity, status, etc.) are staff-only —
  // /api/crm/properties is not in the client write allowlist, and the UI now
  // hides the Set-billing-entity control for clients (r391). Guard the API
  // side: a client PUT on their OWN property must 403 and change nothing.
  await step(page, p, 'client-property-put-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = window.QA_FIX.bluewater;
      const put = (await fetch(`/api/crm/properties/${own}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ billingEntityId: null }) }).catch(() => ({ status: 0 }))).status;
      return { put };
    });
    if (r.put !== 403) throw new Error(`client PUT /api/crm/properties succeeded (expected 403, got ${r.put})`);
  });

  // The available-units LIST is client-scoped, so the single-unit read must be
  // too: a client can open their OWN unit by id (200) but a rival landlord's
  // unit — its rent/size/marketing status — must be refused. (Regression
  // guard: /api/available-units/:id had no scope check while its /viewings and
  // /offers siblings did, so a client could read any unit by id.)
  await step(page, p, 'client-available-unit-read-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json().catch(() => []);
      const own = (Array.isArray(units) ? units[0] : null)?.id;
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const ownStatus = own ? await g(`/api/available-units/${own}`) : 0;
      const rival = await g('/api/available-units/99999999-3333-3333-3333-333333333333');
      return { own: own ? ownStatus : null, rival };
    });
    if (r.own !== null && r.own !== 200) throw new Error(`client can't read their own available unit by id (expected 200, got ${r.own})`);
    if (r.rival !== 403) throw new Error(`client read a rival landlord's available unit by id (expected 403, got ${r.rival})`);
  });

  // Detail-by-id siblings of the available-unit read must be scoped the same
  // way (list scoped ⇒ single-fetch scoped): a client opens their OWN property
  // by id but a rival landlord's property, and a rival landlord's contact, are
  // refused — guarding the whole "read any row by guessing its id" class.
  await step(page, p, 'client-detail-by-id-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        ownProp: await g(`/api/crm/properties/${window.QA_FIX.bluewater}`),
        rivalProp: await g('/api/crm/properties/99999999-2222-2222-2222-222222222222'),
        rivalContact: await g('/api/crm/contacts/99999999-6666-6666-6666-666666666666'),
      };
    });
    if (r.ownProp !== 200) throw new Error(`client can't read their own property by id (expected 200, got ${r.ownProp})`);
    if (r.rivalProp !== 403) throw new Error(`client read a rival landlord's property by id (expected 403, got ${r.rivalProp})`);
    if (r.rivalContact !== 403) throw new Error(`client read a rival landlord's contact by id (expected 403, got ${r.rivalContact})`);
  });

  // The property contacts map (Linked Contacts v2): a client reads the linked
  // contacts for their OWN scheme and may pin/hide a contact on it (a
  // per-property override, not a CRM edit), but the same actions on another
  // landlord's property are refused. Own read 200 + pin/hide round-trip
  // (cleaned up), foreign read + override 403.
  await step(page, p, 'client-contact-override-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = window.QA_FIX.bluewater;
      const foreign = '44444444-4444-4444-4444-444444444444';
      const cid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const ownRead = await fetch(`/api/properties/${own}/linked-contacts`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownBody = ownRead.ok ? await ownRead.json().catch(() => null) : null;
      const post = (await fetch(`/api/properties/${own}/contact-override`, { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ contactId: cid, kind: 'hide' }) }).catch(() => ({ status: 0 }))).status;
      const del = (await fetch(`/api/properties/${own}/contact-override/${cid}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      const foreignRead = await g(`/api/properties/${foreign}/linked-contacts`);
      const foreignWrite = (await fetch(`/api/properties/${foreign}/contact-override`, { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ contactId: cid, kind: 'hide' }) }).catch(() => ({ status: 0 }))).status;
      return { ownReadStatus: ownRead.status, ownIsObj: !!ownBody && typeof ownBody === 'object', post, del, foreignRead, foreignWrite };
    });
    if (r.ownReadStatus !== 200 || !r.ownIsObj) throw new Error(`client own linked-contacts unhealthy (status ${r.ownReadStatus})`);
    if (r.post !== 200) throw new Error(`client could not pin/hide a contact on their own property (expected 200, got ${r.post})`);
    if (r.del !== 200) throw new Error(`client override cleanup failed (expected 200, got ${r.del})`);
    if (r.foreignRead !== 403) throw new Error(`client read a foreign property's linked contacts (expected 403, got ${r.foreignRead})`);
    if (r.foreignWrite !== 403) throw new Error(`client set a contact override on a foreign property (expected 403, got ${r.foreignWrite})`);
  });

  // A client can export their OWN scheme's tenancy schedule to Excel, but not
  // another landlord's. Regression guard: the export route built the workbook
  // via `new ExcelJS.Workbook()` off a dynamic import whose constructor lives
  // on `.default`, so it 500'd ("ExcelJS.Workbook is not a constructor") for
  // everyone until fixed — assert a real xlsx comes back, and foreign 403s.
  await step(page, p, 'client-tenancy-export-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = window.QA_FIX.bluewater;
      const foreign = '44444444-4444-4444-4444-444444444444';
      const ownRes = await fetch(`/api/tenancy-schedule/property/${own}/export-excel`, { headers: auth }).catch(() => ({ ok: false, status: 0, headers: { get: () => '' } }));
      const ct = ownRes.headers && ownRes.headers.get ? (ownRes.headers.get('content-type') || '') : '';
      const foreignStatus = (await fetch(`/api/tenancy-schedule/property/${foreign}/export-excel`, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { ownStatus: ownRes.status, ct, foreignStatus };
    });
    if (r.ownStatus !== 200) throw new Error(`client tenancy-schedule Excel export failed (expected 200, got ${r.ownStatus})`);
    if (!/spreadsheetml|officedocument/.test(r.ct)) throw new Error(`tenancy export returned a non-xlsx body (content-type ${r.ct || 'none'}) — ExcelJS constructor bug?`);
    if (r.foreignStatus !== 403) throw new Error(`client exported a foreign scheme's tenancy schedule (expected 403, got ${r.foreignStatus})`);
  });

  // Client comps: the scheme-scoped table must render rows AND the devaluation
  // figures (price psf / ITZA) the client is there to read — a comps table with
  // blank devaluation columns is the failure mode worth guarding.
  await step(page, p, 'client-comps-devaluation', async () => {
    await page.goto(`${BASE}/comps`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const rows = await page.locator('[data-testid^="comp-row-"]').count();
    if (!rows) return; // no comps in the client's scheme scope — nothing to assert
    const api = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const r = await fetch('/api/crm/deals?comps=true', { headers: auth });
      if (!r.ok) return { ok: false, status: r.status };
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d?.data || []);
      return { ok: true, n: arr.length, withDeval: arr.filter(x => x.pricePsf != null || x.priceItza != null).length };
    });
    if (!api.ok) throw new Error(`comps API ${api.status} for client`);
    // Any comp carrying a price should have a computed devaluation.
    const body = await page.locator('body').innerText();
    if (api.withDeval && !/£|psf|ITZA/i.test(body)) {
      throw new Error('comps table shows no devaluation figures despite comps having them');
    }
  });

  // ChatBGP panel: the suggestion chips must render for the client and clicking
  // one must load it into the composer (the panel is their main entry point).
  await step(page, p, 'client-chat-suggestions', async () => {
    await page.goto(`${BASE}/`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const chips = page.locator('[data-testid^="button-panel-suggestion-"]');
    const n = await chips.count();
    if (!n) return; // panel collapsed / no starters on this surface
    const label = (await chips.first().innerText().catch(() => '')).trim();
    await chips.first().click();
    await page.waitForTimeout(1200);
    // Either the composer picked it up, or a message row appeared. Both are
    // fine; a crash or a dead chip is not.
    const composer = await page.locator('textarea, [contenteditable="true"], input[placeholder*="Ask" i]').first()
      .inputValue().catch(async () => (await page.locator('[contenteditable="true"]').first().innerText().catch(() => '')));
    const echoed = label && (String(composer || '').includes(label.slice(0, 12)) ||
      (await page.getByText(label.slice(0, 18), { exact: false }).count()) > 0);
    if (!echoed) throw new Error(`clicking the "${label.slice(0, 24)}" suggestion did nothing`);
  });

  // Destructive/firm-wide writes must STAY refused for a client, even as more
  // client writes get opened up. Each of these should be 403 (or 404 for a
  // scoped-out id) — never 200.
  await step(page, p, 'client-destructive-guards', async () => {
    const results = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json().catch(() => []);
      const dealId = Array.isArray(deals) && deals[0] ? deals[0].id : '00000000-0000-0000-0000-000000000000';
      const contacts = await (await fetch('/api/crm/contacts', { headers: auth })).json().catch(() => []);
      const contactId = Array.isArray(contacts) && contacts[0] ? contacts[0].id : '00000000-0000-0000-0000-000000000000';
      const probes = [
        ['DELETE', `/api/crm/deals/${dealId}`],
        ['DELETE', `/api/crm/companies/${window.QA_FIX.landsec}`],
        ['POST',   '/api/crm/deals/bulk-rent-analysis'],
        ['POST',   '/api/crm/wipe-deals'],
        ['POST',   '/api/image-studio/bulk-assign-property'],
        ['POST',   '/api/admin/letting-tracker-focus'],
        // Contact-graph link writes (no scope check in the handler) — wiring
        // a contact onto a deal/property/requirement must be staff-only.
        ['POST',   `/api/crm/contacts/${contactId}/deals`],
        ['POST',   `/api/crm/contacts/${contactId}/properties`],
        ['POST',   `/api/crm/contacts/${contactId}/requirements`],
      ];
      const out = [];
      for (const [method, url] of probes) {
        try {
          const r = await fetch(url, { method, credentials: 'include', headers: auth, body: method === 'POST' ? '{}' : undefined });
          out.push({ url, status: r.status });
        } catch { out.push({ url, status: 0 }); }
      }
      return out;
    });
    const allowed = results.filter(r => r.status >= 200 && r.status < 300);
    if (allowed.length) {
      throw new Error(`client was allowed a destructive write: ${allowed.map(a => `${a.url} → ${a.status}`).join(', ')}`);
    }
  });

  // Mass-mutation + AI-credit-burning staff ops live under the client-allowed
  // /api/crm/ prefix: bulk delete/update of deals and properties, and the AI
  // enrich / AI description writers (which rewrite CRM rows and spend model
  // credits). A client login must be refused every one — a 2xx here is a
  // client wiping or AI-rewriting the firm's CRM in bulk.
  await step(page, p, 'client-bulk-mutation-guard', async () => {
    const results = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const probes = [
        '/api/crm/deals/bulk-delete',
        '/api/crm/deals/bulk-update',
        '/api/crm/properties/bulk-delete',
        '/api/crm/properties/bulk-update',
        '/api/crm/companies/ai-enrich',
        '/api/crm/companies/ai-description',
      ];
      const out = [];
      for (const url of probes) {
        try {
          const r = await fetch(url, { method: 'POST', credentials: 'include', headers: auth, body: '{}' });
          out.push({ url, status: r.status });
        } catch { out.push({ url, status: 0 }); }
      }
      return out;
    });
    const allowed = results.filter(r => r.status >= 200 && r.status < 300);
    if (allowed.length) {
      throw new Error(`client was allowed a bulk/AI CRM mutation: ${allowed.map(a => `${a.url} → ${a.status}`).join(', ')}`);
    }
  });

  // CRM data-ingest writes — bulk-importing companies/contacts, brand
  // enrichment, and the portfolio-comps importer — bring external data INTO
  // BGP's CRM (and spend enrichment credits). Staff-only: a client importing
  // rows or firing enrichment would pollute the firm's data book.
  await step(page, p, 'client-crm-ingest-guard', async () => {
    const results = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const probes = [
        '/api/crm/bulk-import/companies',
        '/api/crm/bulk-import/contacts',
        '/api/brand/enrich',
        '/api/crm/import-portfolio-comps',
      ];
      const out = [];
      for (const url of probes) {
        try {
          const r = await fetch(url, { method: 'POST', credentials: 'include', headers: auth, body: '{}' });
          out.push({ url, status: r.status });
        } catch { out.push({ url, status: 0 }); }
      }
      return out;
    });
    const allowed = results.filter(r => r.status >= 200 && r.status < 300);
    if (allowed.length) {
      throw new Error(`client was allowed a CRM data-ingest write: ${allowed.map(a => `${a.url} → ${a.status}`).join(', ')}`);
    }
  });

  // Client Letting Tracker parity (JOGQK rework): a client can ADD a unit on
  // their own property, it lands on the tracker, and they can delete it again.
  // The same create against a property outside their scope must be refused.
  await step(page, p, 'client-add-delete-unit', async () => {
    const stamp = `QA-UNIT-R${ROUND}`;
    const r = await page.evaluate(async (name) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json();
      const list = Array.isArray(props) ? props : (props?.data || []);
      if (!list[0]) return { skip: true };
      const create = await fetch('/api/available-units', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ propertyId: list[0].id, unitName: name, marketingStatus: 'AVA' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      const outOfScope = await fetch('/api/available-units', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ propertyId: 'aaaa1111-0000-0000-0000-00000000dead', unitName: name + '-X' }) });
      const del = await fetch(`/api/available-units/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      // r378: unit create mirrors a stub row onto the tenancy spine — the
      // delete must clean that stub too, not leave a ghost on the schedule.
      const sched = await fetch(`/api/tenancy-schedule/property/${list[0].id}`, { headers: auth });
      const schedRows = sched.ok ? await sched.json() : [];
      const ghost = (Array.isArray(schedRows) ? schedRows : (schedRows?.units || []))
        .some((u) => ((u.unit_number || u.unitNumber || '').trim() === name));
      return { ok: true, madeId: made.id, outOfScopeStatus: outOfScope.status, delOk: del.ok, delStatus: del.status, ghost };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client unit create failed (${r.why}) on their own property`);
    if (r.outOfScopeStatus >= 200 && r.outOfScopeStatus < 300) throw new Error('client created a unit on an out-of-scope property');
    if (!r.delOk) throw new Error(`client could not delete their own unit (${r.delStatus})`);
    if (r.ghost) throw new Error('deleted unit left a ghost row on the tenancy schedule (spine stub not cleaned)');
  });

  // Summarise scope mirrors feed visibility (r207): the deal-linked Gail's
  // meeting (contact without a company) is on the client's own feed, so
  // summarising it must not 403 (short preview → skipped:true, no AI call).
  await step(page, p, 'client-summarise-feed-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/interactions/22220000-0000-0000-0000-000000000002/summarise', { method: 'POST', headers: auth });
      return { status: res.status };
    });
    if (r.status === 404) return; // old fixture without the seeded interaction
    if (r.status !== 200) throw new Error(`client summarise of own-feed interaction returned ${r.status}`);
  });

  // Brand-gaps AI reads degrade gracefully (r214): with no AI key (or an AI
  // failure) the routes must serve the cached row or a clean 503 — never a
  // raw 500. Client reads their own property (parity rule).
  await step(page, p, 'client-brand-gaps-graceful', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (path) => (await fetch(`/api/property/${window.QA_FIX.bluewater}/brand-gaps/${path}`, { headers: auth })).status;
      return { commentary: await g('commentary'), international: await g('international') };
    });
    for (const [k, s] of Object.entries(r)) {
      if (s !== 200 && s !== 503) throw new Error(`brand-gaps/${k} returned ${s} (want 200 cached or 503 no-key, never 500)`);
    }
  });

  // BGP Commentary regenerate degrades gracefully (r218): the explicit
  // regenerate action calls the AI directly — an AI failure must map to
  // 503 (no key/auth) or 502, never a raw 500. Client on own property.
  await step(page, p, 'client-commentary-regen-graceful', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/properties/${window.QA_FIX.bluewater}/bgp-commentary/regenerate`, { method: 'POST', headers: auth });
      return { status: res.status };
    });
    if (r.status !== 200 && r.status !== 503 && r.status !== 502) {
      throw new Error(`bgp-commentary/regenerate returned ${r.status} (want 200, 503 no-key or 502, never 500)`);
    }
  });

  // The reworked target-operator columns must render on the client tracker —
  // either existing target rows or the add affordance, without a crash.
  await step(page, p, 'client-target-columns', async () => {
    await page.goto(`${BASE}/deals/letting`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    const targetRows = await page.locator('[data-testid^="row-unit-target-"]').count();
    const addAffordance = await page.getByText('Target operator', { exact: false }).count();
    if (!targetRows && !addAffordance) {
      throw new Error('no target-operator rows or add affordance on the client Letting Tracker');
    }
  });

  // Tenancy → Tracker for the client (JOGQK): a client can one-click list a
  // tenancy unit on the Letting Tracker; scope checks gate the write. Promote,
  // verify the tracker row landed, then delete it to leave no residue.
  await step(page, p, 'client-tenancy-to-tracker', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json();
      const list = Array.isArray(props) ? props : (props?.data || []);
      if (!list[0]) return { skip: true };
      const ten = await (await fetch(`/api/tenancy-schedule/property/${list[0].id}`, { headers: auth })).json();
      const rows = Array.isArray(ten) ? ten : (ten?.units || ten?.data || []);
      // Pick a row not already linked to a tracker unit.
      const cand = rows.find((u) => !u.leasing_unit_id && !u.tracker_unit_id) || rows[0];
      if (!cand?.id) return { skip: true };
      const promote = await fetch('/api/leasing-schedule/promote-from-tenancy', {
        method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ tenancyUnitId: cand.id }),
      });
      if (!promote.ok) return { ok: false, why: `promote ${promote.status}` };
      const made = await promote.json();
      const del = await fetch(`/api/leasing-schedule/unit/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      return { ok: true, delOk: del.ok, delStatus: del.status };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`client tenancy→tracker promote failed (${r.why})`);
    if (!r.delOk) throw new Error(`cleanup delete of the promoted tracker row failed (${r.delStatus})`);
  });

  // Heads of Terms (new): a client can read + edit the HOTs draft on their
  // own unit and populate it from the property template; the standard
  // template itself stays staff-only. (Woody's HOTs feature, tracker batch.)
  await step(page, p, 'client-hots-roundtrip', async () => {
    const note = `QA-HOTS-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken'), 'Content-Type': 'application/json' };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const get1 = await fetch(`/api/available-units/${unit.id}/hots`, { headers: auth });
      if (!get1.ok) return { ok: false, why: `hots GET ${get1.status}` };
      const before = await get1.json().catch(() => ({}));
      const put = await fetch(`/api/available-units/${unit.id}/hots`, {
        method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ content: marker }),
      });
      if (!put.ok) return { ok: false, why: `hots PUT ${put.status}` };
      const get2 = await (await fetch(`/api/available-units/${unit.id}/hots`, { headers: auth })).json();
      const persisted = JSON.stringify(get2).includes(marker);
      // restore whatever was there before so rounds leave no residue
      await fetch(`/api/available-units/${unit.id}/hots`, {
        method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ content: before?.content ?? null }),
      }).catch(() => {});
      // the property-level standard template must stay staff-only
      const tpl = await fetch(`/api/properties/${unit.propertyId}/hots-template`, {
        method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ template: 'nope' }),
      });
      return { ok: true, persisted, tplStatus: tpl.status };
    }, note);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client HOTs flow failed (${r.why})`);
    if (!r.persisted) throw new Error('client HOTs edit did not persist');
    if (r.tplStatus >= 200 && r.tplStatus < 300) throw new Error('client was allowed to edit the staff-only HOTs template');
  });

  // The viewing Victoria just logged must be visible to the client (their
  // unit, their letting activity) — cross-persona visibility, then cleanup.
  await step(page, p, 'client-sees-agent-viewing', async () => {
    if (!cross.viewingStamp) return;
    const r = await page.evaluate(async (marker) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const v = await (await fetch('/api/available-units/all-viewings', { headers: auth })).json();
      const row = (Array.isArray(v) ? v : []).find((x) => JSON.stringify(x).includes(marker));
      // The client-scoped branch is a raw SQL read — it must come back in the
      // drizzle camelCase shape or the tracker's FY strip counts 0 (r205).
      return { seen: !!row, camel: !!row && 'viewingDate' in row };
    }, cross.viewingStamp);
    if (!r.seen) throw new Error("agent-logged viewing not visible on the client's letting activity");
    if (!r.camel) throw new Error('client all-viewings rows are snake_case — FY strip counts them as 0');
  });

  // Agent names on the client tracker: every BGP agent assigned on the
  // client's units/targets must resolve through the client's /api/users —
  // otherwise the Agent column renders raw user ids (r205).
  await step(page, p, 'client-tracker-agent-names', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json().catch(() => []);
      const ids = new Set();
      for (const u of (Array.isArray(units) ? units : [])) for (const id of (u.agentUserIds || [])) ids.add(String(id));
      if (!ids.size) return { skip: true };
      const users = await (await fetch('/api/users', { headers: auth })).json().catch(() => []);
      const known = new Set((Array.isArray(users) ? users : []).map((u) => String(u.id)));
      const missing = [...ids].filter((id) => !known.has(id));
      return { missing };
    });
    if (r.skip) return;
    if (r.missing.length) throw new Error(`client cannot resolve tracker agent name(s): ${r.missing.join(', ').slice(0, 120)}`);
  });

  // Parity for contacts: a contact the agent added on the Landsec company
  // must appear in the client's own CRM contact list.
  await step(page, p, 'client-sees-agent-contact', async () => {
    if (!cross.contactStamp) return;
    const r = await page.evaluate(async (args) => {
      const [needle, role] = args;
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/crm/contacts', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.data || []);
      const found = rows.find((c) => c.name === needle);
      return { seen: !!found, roleMatches: !!found && found.role === role };
    }, [cross.contactStamp, cross.contactRole]);
    if (!r.seen) throw new Error("agent-added Landsec contact not visible in the client's CRM");
    if (cross.contactRole && !r.roleMatches) throw new Error("agent's contact edit (role) not reflected in the client's CRM");
  });

  // Parity for briefs: the operator-targeting brief Victoria authored on a
  // Landsec unit must be readable by the client on that same unit.
  await step(page, p, 'client-sees-agent-brief', async () => {
    if (!cross.briefId || !cross.briefUnitId) return;
    const r = await page.evaluate(async (args) => {
      const [unitId, briefId, stamp] = args;
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/available-units/${unitId}/brief`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const b = await res.json().catch(() => null);
      return { ok: true, matches: !!b && (b.id === briefId || JSON.stringify(b).includes(stamp)) };
    }, [cross.briefUnitId, cross.briefId, cross.briefStamp]);
    if (!r.ok) throw new Error(`client cannot read the agent's brief on their own unit (${r.status})`);
    if (!r.matches) throw new Error("agent-authored brief not visible on the client's unit");
  });

  // Parity for comps: the scheme comp Victoria logged must appear in the
  // client's scheme-scoped comps table.
  await step(page, p, 'client-sees-agent-comp', async () => {
    if (!cross.compStamp) return;
    const r = await page.evaluate(async (marker) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const c = await (await fetch('/api/crm/comps', { headers: auth })).json().catch(() => []);
      return { seen: JSON.stringify(c).includes(marker) };
    }, cross.compStamp);
    if (!r.seen) throw new Error("agent-logged scheme comp not visible in the client's comps table");
  });

  // Fee-visibility parity: the deal Victoria booked on a Landsec property
  // (with a BGP fee) must appear on the client's board, but every fee field
  // must be stripped from his view — clients see the deal, never the fee.
  await step(page, p, 'client-sees-agent-deal-fee-stripped', async () => {
    if (!cross.feeDealName) return;
    const r = await page.evaluate(async (name) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json().catch(() => []);
      const deal = (Array.isArray(deals) ? deals : []).find((d) => (d.name || '') === name);
      if (!deal) return { seen: false };
      const feeExposed = [deal.fee, deal.feePercentage, deal.feeNotes, deal.commission]
        .some((v) => v !== null && v !== undefined && v !== 0 && v !== '');
      return { seen: true, feeExposed };
    }, cross.feeDealName);
    if (!r.seen) throw new Error("agent-created Landsec deal not visible on the client's board");
    if (r.feeExposed) throw new Error("BGP fee leaked to the client on an agent-created deal");
  });

  // Fee-strip must hold on the SINGLE-deal detail fetch too, not just the list
  // — and cover the fee-agreement document link. Victoria's round created a
  // Landsec deal carrying a real fee (cross.feeDealId); the client's
  // GET /api/crm/deals/:id must come back with every fee field (incl.
  // feeAgreement / feeAgreementUrl / feeNotes) blanked. A route that strips
  // the list but not the detail would leak the fee on the deal page.
  await step(page, p, 'client-deal-detail-fee-stripped', async () => {
    const dealId = cross.feeDealId || '66666666-6666-6666-6666-666666666666';
    const r = await page.evaluate(async (dealId) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/crm/deals/${dealId}`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const d = await res.json().catch(() => null);
      if (!d || typeof d !== 'object') return { ok: false, status: -1 };
      const fields = ['fee', 'feePercentage', 'feeNotes', 'commission', 'feeAgreement', 'feeAgreementUrl'];
      const leaked = fields.filter((k) => { const v = d[k]; return v !== null && v !== undefined && v !== 0 && v !== ''; });
      return { ok: true, leaked };
    }, dealId);
    if (!r.ok) throw new Error(`client own deal detail fetch unhealthy (${r.status})`);
    if (r.leaked.length) throw new Error(`BGP fee data leaked on the client deal-detail fetch: ${r.leaked.join(', ')}`);
  });

  // Parity for offers: the offer Victoria logged on a Landsec unit must show
  // on the client's own letting activity (scoped all-offers).
  await step(page, p, 'client-sees-agent-offer', async () => {
    if (!cross.offerStamp) return;
    const r = await page.evaluate(async (args) => {
      const [marker, deleted] = args;
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const o = await (await fetch('/api/available-units/all-offers', { headers: auth })).json();
      const body = JSON.stringify(o);
      return { seen: body.includes(marker), deletedGone: !deleted || !body.includes(deleted) };
    }, [cross.offerStamp, cross.odelStamp || null]);
    if (!r.seen) throw new Error("agent-logged offer not visible on the client's letting activity");
    if (!r.deletedGone) throw new Error("agent-DELETED offer still visible on the client's letting activity");
  });

  // Tracker-created deals carry no landlord_id on the deal row — the client
  // Deals list must still include them via the property's landlord (r209:
  // Mark's board showed "0 deals" while the dashboard KPI counted 4), with
  // fees stripped, and a rival landlord's deal must stay invisible.
  await step(page, p, 'client-deals-property-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/crm/deals', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.data || []);
      const tracker = rows.filter((d) => d.propertyId === window.QA_FIX.bluewater);
      const rival = rows.find((d) => /broadgate secret/i.test(d.name || ''));
      const feeLeak = rows.find((d) => d.fee || d.feePercentage || d.commission);
      return { total: rows.length, tracker: tracker.length, rival: !!rival, feeLeak: !!feeLeak };
    });
    if (!r.tracker) throw new Error(`client deals list is missing property-scoped tracker deals (${r.total} rows, 0 on Bluewater)`);
    if (r.rival) throw new Error("a rival landlord's deal (Broadgate Secret Deal) leaked into the client deals list");
    if (r.feeLeak) throw new Error('BGP fee fields leaked on the client deals list');
  });

  // r518: the deal audit-log had NO scope check — any client could pull any
  // deal's fee/AML change history by id. Own deal must serve (minus the
  // hidden fee/AML/invoicing fields); a rival's fixture deal must refuse.
  await step(page, p, 'client-deal-audit-scope', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/crm/deals', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.data || []);
      const own = rows.find((d) => d.propertyId === window.QA_FIX.bluewater) || rows[0];
      const ownRes = own ? await fetch(`/api/crm/deals/${own.id}/audit-log`, { headers: auth }) : null;
      const ownRows = ownRes && ownRes.ok ? await ownRes.json() : [];
      const hidden = ownRows.filter((l) => /fee|commission|invoic|poNumber|xero|aml|kyc/i.test(l.field || ''));
      const rival = await fetch('/api/crm/deals/44444444-4444-4444-4444-444444444444/audit-log', { headers: auth });
      return { haveOwn: !!own, ownStatus: ownRes ? ownRes.status : 0, hidden: hidden.length, rivalStatus: rival.status };
    });
    if (r.haveOwn && r.ownStatus !== 200) throw new Error(`client blocked from own deal's audit log (HTTP ${r.ownStatus})`);
    if (r.hidden > 0) throw new Error(`client audit log leaked ${r.hidden} fee/AML/invoicing change row(s)`);
    if (r.rivalStatus !== 403) throw new Error(`rival deal audit log served to client (HTTP ${r.rivalStatus}, want 403)`);
  });

  // Locks in the terminal-side audit fix: a client reading ANOTHER
  // landlord's unit files/viewings/offers BY ID must be refused (was a
  // confirmed live cross-tenant leak). Uses the seeded Hammerson unit.
  await step(page, p, 'client-foreign-unit-guards', async () => {
    const foreign = '99999999-3333-3333-3333-333333333333'; // Hammerson unit
    const foreignProp = '99999999-2222-2222-2222-222222222222'; // Hammerson Brent Cross
    const r = await page.evaluate(async ([uid, pid]) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const out = [];
      for (const ep of ['files', 'viewings', 'offers']) {
        const res = await fetch(`/api/available-units/${uid}/${ep}`, { headers: auth }).catch(() => ({ status: 0, ok: false }));
        out.push({ ep, status: res.status, ok: res.ok });
      }
      // Property detail sub-resources by foreign id: tenants + clients leaked
      // a foreign property's tenant companies + client contacts (round 69);
      // deals + agents were already scoped. All four must refuse.
      for (const ep of ['tenants', 'clients', 'deals', 'agents']) {
        const res = await fetch(`/api/crm/properties/${pid}/${ep}`, { headers: auth }).catch(() => ({ status: 0, ok: false }));
        out.push({ ep: `property/${ep}`, status: res.status, ok: res.ok });
      }
      // Unified tenancy schedule link-map on a foreign property must refuse too
      // (drives the client's tenancy view; leaked another landlord's deals).
      const tl = await fetch(`/api/tenancy-schedule/property/${pid}/links`, { headers: auth }).catch(() => ({ status: 0, ok: false }));
      out.push({ ep: 'tenancy-links', status: tl.status, ok: tl.ok });
      // And WRITING a rival's leasing-schedule row must refuse (seeded
      // Hammerson row 99999999-4444...; client-tenancy-edit covers own-OK).
      const sw = await fetch('/api/leasing-schedule/unit/99999999-4444-4444-4444-444444444444', {
        method: 'PUT', credentials: 'include', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: 'QA-HIJACK' }) }).catch(() => ({ status: 0, ok: false }));
      out.push({ ep: 'schedule-write', status: sw.status, ok: sw.ok });
      return out;
    }, [foreign, foreignProp]);
    const leaked = r.filter((x) => x.ok);
    if (leaked.length) throw new Error(`client can read a foreign ${leaked.map((x) => x.ep).join(', ')} (cross-tenant leak regressed)`);

    // Company sub-entities scope to [] rather than 403 (the client legitimately
    // views their own + visible-brand trees), so assert EMPTINESS, not status.
    // Hammerson has a seeded sub-entity (AML high) a Landsec client must not see.
    const subs = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/crm/companies/99999999-1111-1111-1111-111111111111/sub-companies', { headers: auth }).catch(() => null);
      if (!res || !res.ok) return { count: 0 };
      const arr = await res.json().catch(() => []);
      return { count: Array.isArray(arr) ? arr.length : 0 };
    });
    if (subs.count > 0) throw new Error(`client can read a foreign company's ${subs.count} sub-entity(ies) with AML/KYC data (cross-tenant leak)`);

    // Foreign CONTACT sub-resource reads: the parent contact GET 403s, but
    // /properties, /deals, /requirements bypassed the gate (round 71) — a
    // Landsec client read a Hammerson contact's linked property. The seeded
    // Hammerson contact is linked to Brent Cross; all three must refuse.
    const foreignContact = '99999999-6666-6666-6666-666666666666';
    const cr = await page.evaluate(async (cid) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const out = [];
      for (const ep of ['properties', 'deals', 'requirements', 'investment-tracker']) {
        const res = await fetch(`/api/crm/contacts/${cid}/${ep}`, { headers: auth }).catch(() => ({ status: 0, ok: false }));
        out.push({ ep: `contact/${ep}`, status: res.status, ok: res.ok });
      }
      return out;
    }, foreignContact);
    const cleaked = cr.filter((x) => x.ok);
    if (cleaked.length) throw new Error(`client can read a foreign ${cleaked.map((x) => x.ep).join(', ')} (cross-tenant leak)`);
  });

  // Unit info-sheet generator (staging sync 2026-09-01): client generates a
  // landlord-branded particulars PDF on their OWN unit (tracker parity), the
  // sheet lands in that unit's Files as fileType=infosheet, and the same POST
  // on a rival's unit refuses. Cleans up its own file row.
  await step(page, p, 'client-info-sheet-roundtrip', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const json = { ...auth, 'Content-Type': 'application/json' };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const own = (Array.isArray(units) ? units : []).find((u) => u.propertyId === window.QA_FIX.bluewater);
      if (!own) return { err: 'no Bluewater unit visible to client' };
      const gen = await fetch(`/api/available-units/${own.id}/info-sheet`, {
        method: 'POST', credentials: 'include', headers: json, body: JSON.stringify({ photos: false }) });
      const genBody = gen.ok ? await gen.json() : { message: (await gen.text()).slice(0, 120) };
      let inFiles = false, cleanup = 0;
      if (gen.ok && genBody.file?.id) {
        const files = await (await fetch(`/api/available-units/${own.id}/files`, { headers: auth })).json();
        inFiles = Array.isArray(files) && files.some((f) => f.id === genBody.file.id && f.fileType === 'infosheet');
        cleanup = (await fetch(`/api/available-units/files/${genBody.file.id}`, { method: 'DELETE', credentials: 'include', headers: auth })).status;
      }
      const rival = await fetch('/api/available-units/99999999-3333-3333-3333-333333333333/info-sheet', {
        method: 'POST', credentials: 'include', headers: json, body: JSON.stringify({}) });
      return { genOk: gen.ok, genStatus: gen.status, pages: genBody.pages, inFiles, cleanup, rivalStatus: rival.status, rivalOk: rival.ok };
    });
    if (r.err) throw new Error(r.err);
    if (!r.genOk) throw new Error(`own-unit info-sheet POST failed: HTTP ${r.genStatus}`);
    if (!r.pages || r.pages < 2) throw new Error(`info-sheet generated but suspicious page count: ${r.pages}`);
    if (!r.inFiles) throw new Error('generated info sheet did not land in the unit Files list as fileType=infosheet');
    if (r.rivalOk) throw new Error(`client generated an info sheet on a RIVAL landlord's unit (HTTP ${r.rivalStatus})`);
  });

  // Image Studio bulk-assign-property with a VALID payload (the destructive-
  // guards probe only sends {} and stops at validation). Round 212: the
  // handler updated any image ids and filed them onto any property — a client
  // could hijack a rival's image or pollute a rival property's imagery.
  await step(page, p, 'client-image-assign-scope-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const post = async (ids, propertyId) => (await fetch('/api/image-studio/bulk-assign-property', {
        method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ ids, propertyId }) }).catch(() => ({ status: 0 }))).status;
      const gallery = await (await fetch('/api/image-studio', { headers: auth })).json().catch(() => []);
      const own = (Array.isArray(gallery) ? gallery : (gallery?.images || []))[0]?.id || null;
      return {
        // own image filed onto the rival's Brent Cross — must refuse
        rivalProp: own ? await post([own], '99999999-2222-2222-2222-222222222222') : null,
        // an image outside the client's scope onto their own property — must refuse
        foreignImg: await post(['99999999-aaaa-aaaa-aaaa-999999999999'], window.QA_FIX.bluewater),
      };
    });
    if (r.rivalProp !== null && r.rivalProp >= 200 && r.rivalProp < 300)
      throw new Error(`client filed their image onto a rival property (bulk-assign → ${r.rivalProp})`);
    if (r.foreignImg >= 200 && r.foreignImg < 300)
      throw new Error(`client bulk-assigned an out-of-scope image id (→ ${r.foreignImg})`);
  });

  // Raw image bytes are scope-jailed (r319): /thumb + /full must serve the
  // client's own gallery and 404 on a firm-pool image outside their scope —
  // the list endpoints were already scoped, this locks the byte endpoints.
  await step(page, p, 'client-image-bytes-scoped', async () => {
    const r = await page.evaluate(async (foreignId) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const get = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      const gallery = await (await fetch('/api/image-studio', { headers: auth })).json().catch(() => []);
      const own = (Array.isArray(gallery) ? gallery : []).find((i) => i.hasThumbnail)?.id || null;
      return {
        ownThumb: own ? await get(`/api/image-studio/${own}/thumb`) : null,
        ownFull: own ? await get(`/api/image-studio/${own}/full`) : null,
        foreignThumb: foreignId ? await get(`/api/image-studio/${foreignId}/thumb`) : null,
        foreignFull: foreignId ? await get(`/api/image-studio/${foreignId}/full`) : null,
      };
    }, cross.firmPoolImageId || null);
    if (r.ownThumb !== null && r.ownThumb !== 200) throw new Error(`client blocked from their OWN thumb (${r.ownThumb})`);
    if (r.ownFull !== null && r.ownFull !== 200) throw new Error(`client blocked from their OWN full image (${r.ownFull})`);
    if (r.foreignThumb !== null && r.foreignThumb !== 404) throw new Error(`client read a firm-pool thumb outside scope (${r.foreignThumb})`);
    if (r.foreignFull !== null && r.foreignFull !== 404) throw new Error(`client read a firm-pool full image outside scope (${r.foreignFull})`);
  });

  // Client creates a ChatBGP thread (no AI key needed for the thread itself)
  // and it lands in their thread list — the panel's first step before any
  // AI reply, previously untested.
  await step(page, p, 'client-chat-thread-create', async () => {
    const title = `QA Thread R${ROUND}`;
    const r = await page.evaluate(async (needle) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/chat/threads', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ isAiChat: true, name: needle }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      const list = await (await fetch('/api/chat/threads', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.threads || []);
      return { ok: true, id: made?.id, found: rows.some((t) => t.id === made?.id) };
    }, title);
    if (!r.ok) throw new Error(`client chat thread create failed (${r.why})`);
    if (!r.found) throw new Error('created chat thread absent from the client thread list');
  });

  // Chat message delete is own-message-or-thread-creator only. A client must
  // be able to delete their OWN message but never a staff-authored one in a
  // thread they didn't create (the agent seeded cross.chatMsgId above).
  await step(page, p, 'client-chat-delete-own-only', async () => {
    const r = await page.evaluate(async (foreign) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      let foreignStatus = null;
      if (foreign?.threadId && foreign?.msgId) {
        foreignStatus = (await fetch(`/api/chat/threads/${foreign.threadId}/messages/${foreign.msgId}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ status: 0 }))).status;
      }
      const create = await fetch('/api/chat/threads', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ isAiChat: true, title: 'QA-CHATDEL own' }) });
      if (!create.ok) return { ok: false, why: `own thread ${create.status}` };
      const thread = await create.json();
      const post = await fetch(`/api/chat/threads/${thread.id}/messages`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ content: 'QA own message' }) });
      if (!post.ok) return { ok: false, why: `own message ${post.status}` };
      const msg = await post.json();
      const del = await fetch(`/api/chat/threads/${thread.id}/messages/${msg.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ ok: false, status: 0 }));
      return { ok: true, foreignStatus, ownDeleteOk: del.ok, ownDeleteStatus: del.status };
    }, { threadId: cross.chatThreadId, msgId: cross.chatMsgId });
    if (!r.ok) throw new Error(`client chat-delete setup failed (${r.why})`);
    if (r.foreignStatus !== null && r.foreignStatus !== 403) throw new Error(`client deleted a staff-authored chat message (expected 403, got ${r.foreignStatus})`);
    if (!r.ownDeleteOk) throw new Error(`client could not delete their own chat message (${r.ownDeleteStatus})`);
  });

  // Read-isolation companion: a client must not READ another user's ChatBGP
  // thread (staff conversations can carry fee maths, internal strategy, deal
  // intel). The agent seeded cross.chatThreadId with a staff-owned thread —
  // the client fetching it must be refused.
  await step(page, p, 'client-chat-thread-read-isolation', async () => {
    if (!cross.chatThreadId) return; // agent chat step didn't run
    const r = await page.evaluate(async (threadId) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        thread: await g(`/api/chat/threads/${threadId}`),
        messages: await g(`/api/chat/thread/${threadId}/messages`),
      };
    }, cross.chatThreadId);
    if (r.thread !== 403 && r.thread !== 404) throw new Error(`client read a staff ChatBGP thread (expected 403, got ${r.thread})`);
    if (r.messages !== 403 && r.messages !== 404) throw new Error(`client read a staff ChatBGP thread's messages (expected 403, got ${r.messages})`);
  });

  // Client logs an OFFER (interest) on their own unit and it appears in the
  // letting activity, then cleans up — the offers write path was untested.
  await step(page, p, 'client-log-offer', async () => {
    const stamp = `QA-OFFER-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const post = await fetch(`/api/available-units/${unit.id}/offers`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: marker, offerDate: new Date().toISOString().slice(0, 10) }) });
      if (!post.ok) return { ok: false, why: `offer POST ${post.status}` };
      const made = await post.json();
      const all = await (await fetch('/api/available-units/all-offers', { headers: auth })).json();
      const seen = JSON.stringify(all).includes(marker);
      const del = await fetch(`/api/available-units/offers/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => ({ ok: false }));
      return { ok: true, seen, cleaned: del.ok };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client offer log failed (${r.why})`);
    if (!r.seen) throw new Error('logged offer absent from the client letting activity');
  });

  // Client edits a task through the full edit dialog fields (title PATCH).
  await step(page, p, 'client-task-edit', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const create = await fetch('/api/tasks', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: 'QA Task edit-me' }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json();
      const patch = await fetch(`/api/tasks/${made.id}`, { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ title: 'QA Task edited' }) });
      if (!patch.ok) return { ok: false, why: `patch ${patch.status}` };
      const list = await (await fetch('/api/tasks', { headers: auth })).json();
      const rows = Array.isArray(list) ? list : (list?.tasks || []);
      const edited = rows.some((t) => t.title === 'QA Task edited');
      await fetch(`/api/tasks/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      return { ok: true, edited };
    });
    if (!r.ok) throw new Error(`task edit lifecycle failed (${r.why})`);
    if (!r.edited) throw new Error('task title edit did not persist');
  });

  // Client dismisses a news article via the engage endpoint (save was
  // covered; dismiss wasn't).
  await step(page, p, 'client-news-dismiss', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const feed = await (await fetch('/api/news-feed/articles', { headers: auth })).json().catch(() => []);
      const arts = Array.isArray(feed) ? feed : (feed?.articles || feed?.data || []);
      if (!arts[0]?.id) return { skip: true };
      const res = await fetch('/api/news-feed/engage', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ articleId: arts[0].id, action: 'dismiss' }) });
      return { ok: res.ok, status: res.status };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`news dismiss failed (${r.status})`);
  });

  // Client logs then DELETES their own viewing (delete path untested for
  // clients); the viewing must be gone from the letting activity after.
  await step(page, p, 'client-viewing-delete', async () => {
    const stamp = `QA-VDEL-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const post = await fetch(`/api/available-units/${unit.id}/viewings`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ viewingDate: new Date().toISOString().slice(0, 10), attendees: marker }) });
      if (!post.ok) return { ok: false, why: `POST ${post.status}` };
      const made = await post.json();
      const del = await fetch(`/api/available-units/viewings/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `DELETE ${del.status}` };
      const all = await (await fetch('/api/available-units/all-viewings', { headers: auth })).json();
      return { ok: true, stillThere: JSON.stringify(all).includes(marker) };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client viewing delete lifecycle failed (${r.why})`);
    if (r.stillThere) throw new Error('deleted viewing still visible in letting activity');
  });

  // r529 counterpart to rival-unit-interest-guard: scoping the interest
  // routes must not lock the OWNING client out of their own unit.
  await step(page, p, 'client-unit-interest-own-roundtrip', async () => {
    const stamp = `QA-PROBE interest R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = Array.isArray(units) ? units[0] : null;
      if (!unit) return { skip: true };
      const get = await fetch(`/api/available-units/${unit.id}/interest`, { headers: auth });
      if (!get.ok) return { ok: false, why: `GET ${get.status}` };
      const post = await fetch(`/api/available-units/${unit.id}/interest`, { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ companyName: marker }) });
      if (!post.ok) return { ok: false, why: `POST ${post.status}` };
      const made = await post.json();
      const del = await fetch(`/api/available-units/interest/${made.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      if (!del.ok) return { ok: false, why: `DELETE ${del.status}` };
      const after = await (await fetch(`/api/available-units/${unit.id}/interest`, { headers: auth })).json();
      return { ok: true, stillThere: JSON.stringify(after).includes(marker) };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client interest lifecycle on their own unit failed (${r.why})`);
    if (r.stillThere) throw new Error('deleted interest row still listed on the unit');
  });

  // The owning landlord's own team board must keep every sub-read working —
  // the r531 rival gate can't be "fixed" by locking the real client out of
  // their org chart (the side sheet's property multi-select, the column list
  // and the add-member picker all hang off these three).
  await step(page, p, 'client-team-board-own-subroutes', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const me = await (await fetch('/api/auth/me', { headers: auth })).json();
      const cid = me?.companyScopeId || me?.user?.companyScopeId;
      if (!cid) return { skip: true };
      const board = await fetch(`/api/client-teams/${cid}`, { headers: auth });
      if (!board.ok) return { ok: false, why: `board ${board.status}` };
      const members = await board.json().catch(() => []);
      const uid = (Array.isArray(members) ? members : []).map((m) => m.user_id).filter(Boolean)[0];
      const out = { ok: true, cols: 0, cands: 0, props: null };
      const cols = await fetch(`/api/client-teams/${cid}/columns`, { headers: auth });
      if (!cols.ok) return { ok: false, why: `columns ${cols.status}` };
      out.cols = (await cols.json().catch(() => [])).length;
      const cands = await fetch(`/api/client-teams/${cid}/candidates`, { headers: auth });
      if (!cands.ok) return { ok: false, why: `candidates ${cands.status}` };
      out.cands = (await cands.json().catch(() => [])).length;
      if (uid) {
        const props = await fetch(`/api/client-teams/${cid}/member/${uid}/properties`, { headers: auth });
        if (!props.ok) return { ok: false, why: `member properties ${props.status}` };
        out.props = (await props.json().catch(() => [])).length;
      }
      return out;
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`client locked out of their own team board (${r.why})`);
    if (r.cols === 0) throw new Error('own team board returned no columns');
    if (r.cands === 0) throw new Error('own team board add-member picker returned no candidates');
    if (r.props === 0) throw new Error('own team board member sheet listed no properties');
  });

  // Staff-only deal operations that ride under the allowed /api/crm/deals
  // prefix must refuse clients: single + bulk delete, bulk field edits, the
  // internal per-agent fee split, and the firm-wide rent-analysis AI op.
  // (Round 64: every one of these was reachable — a client login could have
  // deleted the entire deal book.) The deal must survive the attempts.
  await step(page, p, 'client-staff-deal-ops-guards', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const deal = (Array.isArray(deals) ? deals : []).find((d) => /bluewater/i.test(d.name || ''));
      if (!deal) return { skip: true };
      const attempts = [
        ['DELETE deal', await fetch(`/api/crm/deals/${deal.id}`, { method: 'DELETE', credentials: 'include', headers: auth })],
        ['stage-move PUT', await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
          body: JSON.stringify({ status: 'COMPLETED' }) })],
        ['bulk-delete', await fetch('/api/crm/deals/bulk-delete', { method: 'POST', credentials: 'include', headers: auth,
          body: JSON.stringify({ ids: [deal.id] }) })],
        ['bulk-update', await fetch('/api/crm/deals/bulk-update', { method: 'POST', credentials: 'include', headers: auth,
          body: JSON.stringify({ ids: [deal.id], field: 'team', value: 'QA-PROBE' }) })],
        ['fee-allocations PUT', await fetch(`/api/crm/deals/${deal.id}/fee-allocations`, { method: 'PUT', credentials: 'include', headers: auth,
          body: JSON.stringify({ allocations: [{ agentName: 'QA Probe (BGP House)', allocationType: 'percentage', percentage: 100, isBgpHouse: true }] }) })],
        ['bulk-rent-analysis', await fetch('/api/crm/deals/bulk-rent-analysis', { method: 'POST', credentials: 'include', headers: auth,
          body: JSON.stringify({}) })],
      ];
      const leaks = attempts.filter(([, res]) => res.ok).map(([label]) => label);
      const still = await fetch(`/api/crm/deals/${deal.id}`, { headers: auth });
      return { ok: true, leaks, dealSurvived: still.ok };
    });
    if (r.skip) return;
    if (r.leaks.length) throw new Error(`staff-only deal ops accepted a client call: ${r.leaks.join(', ')}`);
    if (!r.dealSurvived) throw new Error('fixture deal GONE after guarded delete attempts');
  });

  // Client dashboard on a phone-width viewport must not overflow horizontally
  // (the app hit body-scroll bugs before; container queries fixed them). Use
  // a fresh 390px page so the desktop context isn't reused.
  // Every link in the client sidebar must OPEN when navigated — the nav and
  // ClientRouteGuard's CLIENT_ALLOWED_ROUTES are maintained separately, and
  // /calendar + /sharepoint shipped in the nav but not the guard, so clicks
  // silently bounced to the dashboard on the live site (2026-08-02). Also
  // proves a staff-only route still bounces.
  await step(page, p, 'client-nav-guard-consistency', async () => {
    await page.goto(`${BASE}/`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    const hrefs = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('[data-sidebar] a[href^="/"], nav a[href^="/"], aside a[href^="/"]'));
      return Array.from(new Set(links.map((a) => a.getAttribute('href').split('?')[0]))).filter((h) => h && h !== '/');
    });
    if (hrefs.length < 3) throw new Error(`client sidebar exposed only ${hrefs.length} links — selector or nav regressed`);
    const bounced = [];
    for (const href of hrefs.slice(0, 20)) {
      await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1800);
      const path = new URL(page.url()).pathname;
      if (path !== href && !path.startsWith(href + '/')) bounced.push(`${href} -> ${path}`);
      else if (await page.getByText('Page not found').count()) bounced.push(`${href} -> dead route`);
    }
    if (bounced.length) throw new Error(`client nav links bounced/dead: ${bounced.join(', ')}`);
    // Staff-only route must still bounce for a client.
    await page.goto(`${BASE}/hr`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1800);
    if (new URL(page.url()).pathname === '/hr') throw new Error('client can open the staff-only /hr route (guard hole)');
  });

  // r269: a client's mobile /messages bookmark opened on desktop must land
  // on ChatBGP, not "Page not found" or a guard-bounce home.
  await step(page, p, 'client-messages-desktop-redirect', async () => {
    await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path !== '/chatbgp') throw new Error(`client desktop /messages landed on ${path}, expected /chatbgp`);
    if (await page.getByText('Page not found').count()) throw new Error('client desktop /messages landed on Page not found');
  });

  // r289: same bare /tenancy-schedule redirect for clients (the route is on
  // CLIENT_ALLOWED_ROUTES, so a pasted link must land somewhere real).
  await step(page, p, 'client-tenancy-bare-redirect', async () => {
    await page.goto(`${BASE}/tenancy-schedule`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path !== '/properties') throw new Error(`client bare /tenancy-schedule landed on ${path}, expected /properties`);
    if (await page.getByText('Page not found').count()) throw new Error('client bare /tenancy-schedule landed on Page not found');
  });

  await step(page, p, 'client-deal-detail-name-and-doc-gate', async () => {
    // r231: unit-less leasing deals must be headed by the DEAL name (not the
    // property name, which made same-property deals indistinguishable), and
    // the staff-only "Create document" entry point must be hidden for clients
    // (the document-briefs API 403s them and the route guard bounces home).
    const deal = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      return (Array.isArray(deals) ? deals : []).find((d) =>
        !d.unitId && d.dealType !== 'Sale' && d.dealType !== 'Purchase' && d.name) || null;
    });
    if (!deal) return; // fixture has no unit-less leasing deal — nothing to assert
    await page.goto(`${BASE}/deals/${deal.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const h1 = (await page.locator('[data-testid="text-deal-name"]').first().textContent().catch(() => '')) || '';
    if (h1.trim() !== deal.name.trim()) throw new Error(`deal detail headed "${h1.trim()}" — expected deal name "${deal.name}"`);
    if (await page.locator('[data-testid="button-deal-create-document"]').count()) {
      throw new Error('client sees the staff-only "Create document" button on deal detail');
    }
  });

  await step(page, p, 'client-deal-party-link-gates', async () => {
    // UX #155 (Woody 2026-09-04): clients get READ-ONLY party slots — no
    // "Link landlord/tenant" pickers on their own deal (staff jargon read
    // like the deal was set up wrong); Landlord defaults to their own
    // company. r263's AML-kick worry is moot with no client link UI, but
    // keep the listener so a regression that re-adds the picker + kick is
    // caught. Timeline stays hidden (gateway-403 read); Audit log stays.
    const deal = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      return (Array.isArray(deals) ? deals : []).find((d) => d.name && !d.tenantId) || null;
    });
    if (!deal) return; // no tenant-less client-visible deal — nothing to assert
    const kycHits = [];
    const onReq = (r) => { if (r.url().includes('/api/kyc/run-all-checks')) kycHits.push(r.method()); };
    page.on('request', onReq);
    try {
      await page.goto(`${BASE}/deals/${deal.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      if (await page.locator('[data-testid="toggle-deal-timeline"]').count()) {
        throw new Error('client sees the Timeline card (its timeline read is gateway-403)');
      }
      // r415: wait, don't sample — under round load the audit query can
      // resolve after the fixed 2.5s pause (one flaked flow-failure).
      await page.locator('[data-testid="toggle-deal-audit"]').first()
        .waitFor({ state: 'attached', timeout: 15000 })
        .catch(() => { throw new Error('client lost the (allowed) deal Audit log card'); });
      // Read-only party slots must render (leasing deal → landlord+tenant)…
      await page.locator('[data-testid="client-party-tenant"]').first()
        .waitFor({ state: 'attached', timeout: 15000 })
        .catch(() => { throw new Error('client deal lost the read-only Tenant party slot (UX #155)'); });
      const landlordSlot = (await page.locator('[data-testid="client-party-landlord"]').first().textContent().catch(() => '')) || '';
      if (!landlordSlot.trim()) throw new Error('client deal Landlord party slot rendered empty (UX #155 defaults it)');
      // …and the staff link-pickers must NOT.
      const pickers = await page.locator('button:has-text("Link tenant"), button:has-text("Link landlord")').locator('visible=true').count();
      if (pickers) throw new Error(`client sees ${pickers} staff party link-picker(s) on deal detail (UX #155 made parties read-only)`);
      if (kycHits.length) throw new Error(`client deal detail fired the staff-only AML kick (${kycHits.length}× /api/kyc/run-all-checks)`);
    } finally {
      page.off('request', onReq);
    }
  });

  // r257: contact detail as a client — Edit stays (PUT is scope-checked,
  // client-instruction parity), but Delete/Enrich are staff-only (the DELETE
  // 403s: "Deleting contacts is managed by your BGP team"), and the two
  // staff-only boards (interactions + AI activity) must not fire their
  // gateway-403'd fetches or render a false "No interactions" empty state.
  await step(page, p, 'client-contact-detail-gates', async () => {
    const contact = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const rows = await (await fetch('/api/crm/contacts', { headers: auth })).json();
      return (Array.isArray(rows) ? rows : []).find((c) => c.name) || null;
    });
    if (!contact) return; // no client-visible contacts in fixture — nothing to assert
    const blocked = [];
    const onResp = (r) => {
      // r258: also catch the read path itself — the contacts LIST serves
      // agent-company contacts to clients, so the detail GET + company card
      // must never 403 for a row the list handed out.
      if (r.status() === 403 && /\/api\/(interactions\/contact\/|activity\/contact\/|crm\/contacts\/|crm\/companies\/)/.test(r.url())) blocked.push(r.url());
    };
    page.on('response', onResp);
    try {
      await page.goto(`${BASE}/contacts/${contact.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('[data-testid="contact-detail"]').waitFor({ state: 'attached', timeout: 15000 });
      await page.waitForTimeout(2500);
    } finally { page.off('response', onResp); }
    if (blocked.length) throw new Error(`client contact page fired staff-only endpoints: ${blocked.join(', ')}`);
    if (!(await page.locator('[data-testid="button-edit-contact"]').count())) throw new Error('client lost the (allowed) contact Edit button');
    if (await page.locator('[data-testid="button-delete-contact"]').count()) throw new Error('client sees the staff-only contact Delete button');
    if (await page.locator('[data-testid="button-enrich-contact"]').count()) throw new Error('client sees the staff-only contact Enrich button');
    if (await page.getByText('No interactions in the last 2 years').count()) throw new Error('client sees the interactions board (false empty state over a 403)');
    // Server side of the same rule: contact DELETE must 403 for a client,
    // probed against a QA-created row (never fixture data — a regression
    // here would delete it). run-round.sh purges 'QA Contact%' anyway.
    const probe = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const post = await fetch('/api/crm/contacts', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: `QA Contact DelProbe R${round}` }) });
      if (!post.ok) return { ok: false, why: `probe POST ${post.status}` };
      const row = await post.json();
      const del = await fetch(`/api/crm/contacts/${row.id}`, { method: 'DELETE', credentials: 'include', headers: auth });
      return { ok: true, delStatus: del.status };
    }, ROUND);
    if (!probe.ok) throw new Error(`contact delete probe setup failed (${probe.why})`);
    if (probe.delStatus !== 403) throw new Error(`client contact DELETE returned ${probe.delStatus} — expected 403`);
  });

  await step(page, p, 'client-landlord-files-gate', async () => {
    // r279: the landlord-profile Files card mounted the STAFF SharePoint
    // browser for clients — Set Up Folders + Upload buttons that 403
    // (M365 is sealed for client logins) and a per-team folder GET that
    // fired a 403 on every visit. Clients must get the jailed read-only
    // Documents panel instead (same swap as the property page).
    const fired = [];
    const onResp = (r) => {
      if (r.status() >= 400 && /\/api\/microsoft\/property-folders/.test(r.url())) fired.push(`${r.status()} ${r.url()}`);
    };
    page.on('response', onResp);
    try {
      await page.goto(`${BASE}/companies/${FIX.landsec}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
    } finally { page.off('response', onResp); }
    if (fired.length) throw new Error(`client landlord profile fired staff folder reads: ${fired.join(', ')}`);
    if (await page.locator('[data-testid="property-folders-panel"]').count()) throw new Error('client sees the staff SharePoint browser on the landlord profile');
    if (await page.locator('[data-testid="button-setup-landlord-folders"]').count()) throw new Error('client sees the staff-only Set Up Folders button');
    if (await page.locator('[data-testid="btn-upload-property-file"]').count()) throw new Error('client sees the staff-only Upload button');
    if (!(await page.locator('[data-testid="client-property-folders-panel"]').count())) throw new Error('client lost the jailed Documents panel on the landlord profile');
  });

  await step(page, p, 'client-deal-mobile-sidebar', async () => {
    // r241: below md the deal-detail right sidebar is display:none — the
    // Files/Linked Property/Comments/History sections must be re-rendered
    // stacked in the main column, or phones lose them entirely.
    const deal = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      return (Array.isArray(deals) ? deals : []).find((d) => d.name) || null;
    });
    if (!deal) return; // no visible deals — nothing to assert
    const mob = await page.context().newPage();
    try {
      await mob.setViewportSize({ width: 390, height: 780 });
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/deals/${deal.id}`, nav);
      await mob.waitForTimeout(3000);
      // JOGQK 2026-08-24: phone deal detail gates the stacked sections behind
      // section pills (Overview/Brand/Activity/Files) — drive the pills the
      // way a user would and assert the sections are still reachable.
      const filesPill = mob.locator('[data-testid="deal-section-files"]');
      if (!(await filesPill.count())) throw new Error('mobile deal detail lost its section pills (deal-section-files missing at 390px)');
      await filesPill.click();
      await mob.waitForTimeout(800);
      if (!(await mob.locator('[data-testid="deal-sidebar-mobile"]').isVisible().catch(() => false))) {
        throw new Error('Files pill did not surface the sidebar sections (deal-sidebar-mobile not visible at 390px)');
      }
      await mob.locator('[data-testid="deal-section-activity"]').click();
      await mob.waitForTimeout(800);
      if (!(await mob.locator('[data-testid="deal-sidebar-mobile-activity"] [data-testid="toggle-sidebar-comments"]').count())) {
        throw new Error('Activity pill section is missing the Comments block');
      }
    } finally {
      await mob.close();
    }
  });

  await step(page, p, 'client-mobile-controls-reachable', async () => {
    // r265: (a) the requirements "New Brand" button is staff-only — its POST
    // /api/crm/companies is read-only for clients, so showing it advertises a
    // flow that always fails; (b) the calendar toolbar must wrap at 390px —
    // without flex-wrap the Week/CRM controls sat past the viewport with no
    // scroll path to them.
    // r266: this needs REAL phone emulation (touch + mobile UA), not just a
    // narrow viewport — useIsMobile deliberately keeps the desktop layout for
    // non-touch windows, so a bare 390px page renders the squeezed desktop
    // shell and the toolbar assertions fail against the wrong layout.
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    // the session cookie (set by login()'s context.request.post) is the auth
    // carrier — localStorage alone does not authenticate a fresh context
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/requirements`, nav);
      await mob.waitForTimeout(3000);
      if (await mob.locator('[data-testid="button-new-brand"]').count()) {
        throw new Error('client requirements shows the staff-only New Brand button (its save 403s for clients)');
      }
      await mobGoto(mob, `${BASE}/calendar`, nav);
      await mob.waitForTimeout(3000);
      for (const id of ['view-week', 'toggle-crm-events']) {
        const box = await mob.locator(`[data-testid="${id}"]`).boundingBox();
        if (!box) throw new Error(`calendar control ${id} missing at 390px`);
        if (box.x < 0 || box.x + box.width > 390 + 2) {
          throw new Error(`calendar control ${id} clipped at 390px (x ${Math.round(box.x)}, right ${Math.round(box.x + box.width)})`);
        }
      }
      // r266: the Intelligence footer's first insight card must sit inside the
      // 390px viewport — the label/date chrome used to leave the strip 56px
      // wide, so the nowrap card clipped mid-word and read as broken.
      const firstInsight = mob.locator('[data-testid="calendar-footer"] [data-testid^="insight-"]').first();
      await firstInsight.waitFor({ timeout: 20000 }).catch(() => {});
      if (await firstInsight.count()) {
        const fb = await firstInsight.boundingBox();
        if (fb && (fb.x < 0 || fb.x + fb.width > 390 + 2)) {
          throw new Error(`calendar footer first insight clipped at 390px (x ${Math.round(fb.x)}, right ${Math.round(fb.x + fb.width)})`);
        }
      }
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  await step(page, p, 'client-mobile-no-overflow', async () => {
    const mob = await page.context().newPage();
    try {
      await mob.setViewportSize({ width: 390, height: 780 });
      // domcontentloaded + explicit timeout: the dashboard polls continuously,
      // so goto's default "load" wait can burn 30s and log a false failure.
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/`, nav);
      // Dashboard widgets poll (news/map), so networkidle can't settle here.
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(3000);
      const { scrollW, clientW } = await mob.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      // 4px tolerance for sub-pixel rounding.
      if (scrollW > clientW + 4) throw new Error(`client dashboard overflows on mobile: scrollWidth ${scrollW} > viewport ${clientW}`);
      // The property page got a unified any-width layout (terminal,
      // 2026-08-03) — hold it to the same no-overflow bar on a phone.
      await mob.goto(`${BASE}/properties/${BLUEWATER}`, nav);
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(3000);
      const prop = await mob.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (prop.scrollW > prop.clientW + 4) throw new Error(`client property page overflows on mobile: scrollWidth ${prop.scrollW} > viewport ${prop.clientW}`);
    } finally {
      await mob.close();
    }
  });

  // r454: the persisted react-query cache used to restore a pre-login
  // auth/me=null as FRESH after a UI login + quick reload — the app painted
  // the sign-in screen with a valid session cookie and never re-probed the
  // server. UI-login in a fresh context, reload straight onto a deep route
  // inside the persister's 2s throttle window, and require the app (not the
  // login form) to render.
  await step(page, p, 'client-ui-login-reload-no-bounce', async () => {
    const ctx2 = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    const pg = await ctx2.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await pg.goto(`${BASE}/login`, nav);
      // let the login screen cache auth/me=null and flush it to localStorage
      await pg.waitForTimeout(2500);
      const email = pg.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
      if (!(await email.isVisible().catch(() => false))) {
        await pg.getByText(/client|guest/i).first().click().catch(() => {});
        await pg.waitForTimeout(600);
      }
      await email.fill(CLIENT_USER);
      await pg.locator('input[type="password"]').first().fill(PASSWORD);
      await pg.getByRole('button', { name: 'Sign in', exact: true }).click();
      await pg.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 });
      // reload IMMEDIATELY — inside the persister's throttle window
      await mobGoto(pg, `${BASE}/deals/letting`, nav);
      await pg.waitForTimeout(6000);
      const txt = await pg.evaluate(() => document.body.innerText);
      if (/client \/ guest sign in/i.test(txt)) {
        throw new Error('UI login + immediate reload bounced back to the sign-in screen (persisted auth/me=null class)');
      }
    } finally {
      await pg.close();
      await ctx2.close();
    }
  });

  // r401: the brands-hub search box (mobile quick search) is backed by
  // /api/brands/search — assert the brand + contact facets actually return
  // rows for an in-slice brand (Mark's "find my tenant's contact" journey
  // dead-ends silently if this regresses) and that a no-match query is an
  // empty result, not an error. Data-driven off the brand's own profile.
  await step(page, p, 'client-brands-search-facets', async () => {
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const pr = await fetch(`${BASE}/api/brand/${BRAND}/profile`, auth);
    if (!pr.ok) throw new Error(`brand profile fetch ${pr.status}`);
    const prof = await pr.json();
    const name = prof?.company?.name;
    if (!name) throw new Error('brand profile returned no company name');
    const q = encodeURIComponent(name.slice(0, 5));
    const sr = await fetch(`${BASE}/api/brands/search?q=${q}`, auth);
    if (!sr.ok) throw new Error(`brands search ${sr.status} for "${name.slice(0, 5)}"`);
    const hits = await sr.json();
    for (const k of ['brands', 'contacts', 'agents']) {
      if (!Array.isArray(hits?.[k])) throw new Error(`brands search missing ${k} facet`);
    }
    if (!hits.brands.some((b) => b.id === BRAND)) throw new Error(`brands search "${name.slice(0, 5)}" did not return ${name}`);
    const contact = (prof?.contacts || [])[0];
    if (contact?.name) {
      const cq = encodeURIComponent(contact.name.split(' ')[0]);
      const cr = await fetch(`${BASE}/api/brands/search?q=${cq}`, auth);
      if (!cr.ok) throw new Error(`brands contact search ${cr.status}`);
      const chits = await cr.json();
      const found = chits.brands.some((b) => (b.contacts || []).some((c) => c.id === contact.id))
        || chits.contacts.some((c) => c.id === contact.id);
      if (!found) throw new Error(`brands search did not surface contact "${contact.name}"`);
    }
    const nr = await fetch(`${BASE}/api/brands/search?q=zzqxnomatch`, auth);
    if (!nr.ok) throw new Error(`brands search no-match query errored ${nr.status}`);
    const none = await nr.json();
    if (none.brands.length || none.contacts.length || none.agents.length) throw new Error('brands search no-match query returned rows');
  });

  // r281: client-mobile Brand Intelligence path — the "look up a tenant brand
  // on my phone before a meeting" journey. The hub, a brand profile and its
  // Key Contacts drill-in must all render inside a real 390px phone context
  // (r266 pattern — touch + mobile UA, session cookie copied over).
  await step(page, p, 'client-mobile-brands-hub', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      const noOverflow = async (label) => {
        const { scrollW, clientW } = await mob.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        if (scrollW > clientW + 4) throw new Error(`${label} overflows at 390px: scrollWidth ${scrollW} > viewport ${clientW}`);
      };
      await mobGoto(mob, `${BASE}/brands`, nav);
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(3000);
      if (await mob.getByText('Page not found').count()) throw new Error('/brands is Page not found at client mobile');
      if (!await mob.getByText(/brand intelligence/i).count()) throw new Error('brands hub heading missing at 390px');
      if (!await mob.locator('a[href*="/companies/"]').count()) throw new Error('brands hub has no tappable brand cards at 390px');
      await noOverflow('client brands hub');
      await mobGoto(mob, `${BASE}/companies/${BRAND}`, nav);
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(3000);
      if (!await mob.getByText(/key contacts/i).count()) throw new Error('brand profile Key Contacts card missing at client mobile');
      await noOverflow('client brand profile');
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r369: phone brand Intel section (JOGQK b9b9678e) — UK stores map,
  // Competition set (with the +N-more overflow line) and Instagram board.
  // Data-driven off the profile payload so the scenario holds on any fixture:
  // whatever the API returns geocoded stores / >6 AI competitors for must
  // show the matching card once the Intel pill is tapped.
  await step(page, p, 'client-mobile-brand-intel-cards', async () => {
    const targetId = INTEL_BRAND || BRAND;
    const pr = await fetch(`${BASE}/api/brand/${targetId}/profile`, { headers: { Authorization: 'Bearer ' + page.qaToken } });
    if (!pr.ok) throw new Error(`brand profile fetch ${pr.status} for intel target ${targetId}`);
    const prof = await pr.json();
    const stores = (prof?.stores || []).filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && (!s.country || s.country === 'GB'));
    const aiComps = Array.isArray(prof?.company?.ai_competitors) ? prof.company.ai_competitors : [];
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    const mob403s = [];
    mob.on('response', (r) => { if (r.status() === 403) mob403s.push(r.url().replace(BASE, '').split('?')[0]); });
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/companies/${targetId}`, nav);
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(3000);
      const intelPill = mob.locator('[data-testid="company-section-intel"]');
      if (!await intelPill.count()) throw new Error('Intel section pill missing on client mobile brand profile');
      await intelPill.tap().catch(() => intelPill.click());
      await mob.waitForTimeout(3000);
      const body = await mob.evaluate(() => document.body.innerText);
      if (aiComps.length > 0 && !/Competition/i.test(body)) throw new Error(`Intel: Competition card missing (${aiComps.length} AI competitors in payload)`);
      if (aiComps.length > 6 && !/\+\d+ more in the competitor set/.test(body)) throw new Error('Intel: Competition overflow line missing with >6 AI competitors');
      // UK stores moved from Intel to its own Stores pill (JOGQK 416bc9d1).
      if (stores.length > 0) {
        const storesPill = mob.locator('[data-testid="company-section-stores"]');
        if (!await storesPill.count()) throw new Error(`Stores pill missing (${stores.length} geocoded stores in payload)`);
        await storesPill.tap().catch(() => storesPill.click());
        await mob.waitForTimeout(2000);
        const storesBody = await mob.evaluate(() => document.body.innerText);
        if (!/UK stores/i.test(storesBody)) throw new Error(`Stores: UK stores card missing (${stores.length} geocoded stores in payload)`);
      }
      // r377: the profile used to mount the staff-only activity feed for
      // clients — a guaranteed 403 on every brand open. Zero 403s allowed.
      if (mob403s.length) throw new Error(`client mobile brand profile fired staff-only 403s: ${[...new Set(mob403s)].join(', ').slice(0, 160)}`);
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // r353: a ChatBGP send whose request the server REJECTS outright (keyless
  // 503 here; validation 400s / outages in prod) must surface an assistant
  // error bubble promptly — the mobile onError used to sit in its ~6-min
  // late-response recovery poll first, leaving the user on "Thinking...".
  // Assumes the keyless QA environment (the round always runs without AI
  // keys), where /api/chatbgp/chat 503s immediately.
  await step(page, p, 'client-mobile-chat-error-prompt', async () => {
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      // A BARE /chatbgp open deliberately lands on the Messages LIST
      // (Woody, 2026-08-23: "the messages page rather than last message");
      // guard that decision, then enter the chat the deliberate way (?ask=1,
      // the home "Ask ChatBGP…" path) to reach the composer.
      await mobGoto(mob, `${BASE}/chatbgp`, nav);
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(2000);
      if (!await mob.locator('[data-testid="mobile-pinned-chatbgp"]').count()) {
        throw new Error('bare /chatbgp open lost the Messages list (pinned ChatBGP row missing)');
      }
      await mobGoto(mob, `${BASE}/chatbgp?ask=1`, nav);
      await mob.waitForLoadState('networkidle').catch(() => {});
      await mob.waitForTimeout(2000);
      const box = mob.locator('textarea, input[placeholder*="Reply" i]').first();
      if (!await box.count()) throw new Error('chatbgp input missing at client mobile (?ask=1 entry)');
      // "QA Thread" prefix keeps the auto-titled thread purgeable next round.
      await box.fill('QA Thread probe — does a rejected send surface an error?');
      await mob.keyboard.press('Enter');
      // A definitive rejection (or a reply) must land well inside 25s —
      // anything slower means the UI is stuck in the recovery poll again.
      await mob.getByText(/Sorry, the server rejected this|Sorry, the server returned/i).first()
        .waitFor({ state: 'visible', timeout: 25000 })
        .catch(() => { throw new Error('rejected chat send still shows no assistant/error bubble after 25s (recovery-poll regression)'); });
    } finally {
      await mob.close();
      await mobCtx.close();
    }
  });

  // Targeting Brief scope (r253): the staff-created brief on the client's own
  // property is client-readable WITH its targets, the client may add a target
  // there (client-instruction parity — same decision family as tenancy row
  // edits), but target writes against a brief outside their portfolio are
  // refused. run-round.sh purges the QA Brief + targets next round.
  await step(page, p, 'client-brief-target-scope', async () => {
    if (!cross.briefId) throw new Error('no briefId from staff-brief-target-create');
    const r = await page.evaluate(async ([briefId, round]) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      // The list endpoint is the only brief read path (no GET-by-id route);
      // it is client-scoped and rides targets along.
      const listRes = await fetch('/api/unit-briefs', { headers: auth });
      const list = listRes.ok ? await listRes.json() : [];
      const mine = (Array.isArray(list) ? list : []).find(b => b.id === briefId);
      const ownAdd = (await fetch(`/api/unit-briefs/${briefId}/targets`, { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ operatorName: `QA-TGT-CLIENT-R${round}`, priority: 'B' }) })).status;
      const foreignAdd = (await fetch('/api/unit-briefs/00000000-dead-beef-0000-000000000000/targets', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ operatorName: 'QA-TGT-FOREIGN', priority: 'B' }) })).status;
      return { readStatus: listRes.status, found: !!mine, targets: (mine?.targets || []).map(t => t.operatorName), ownAdd, foreignAdd };
    }, [cross.briefId, ROUND]);
    if (r.readStatus !== 200) throw new Error(`client brief list unhealthy (${r.readStatus})`);
    if (!r.found) throw new Error('own-property brief missing from client brief list');
    if (!r.targets.includes(`QA-TGT-R${ROUND}`)) throw new Error('staff-added target not visible to client');
    if (r.ownAdd !== 200) throw new Error(`client target add on own brief refused (${r.ownAdd})`);
    if (![403, 404].includes(r.foreignAdd)) throw new Error(`foreign brief target write not refused (${r.foreignAdd})`);
  });

  // Deal Edit dialog's unit picker (decided deal parity): a client may list
  // property_units for their OWN property (was a blanket 403 → the picker
  // couldn't resolve saved unit names, r297), but never the firm-wide
  // unfiltered list, and unit writes stay staff-only.
  await step(page, p, 'client-property-units-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = await fetch(`/api/property-units?propertyId=${window.QA_FIX.bluewater}`, { headers: auth });
      const ownBody = own.ok ? await own.json() : null;
      const unfiltered = (await fetch('/api/property-units', { headers: auth })).status;
      const write = (await fetch('/api/property-units', { method: 'POST', credentials: 'include', headers: auth, body: JSON.stringify({ propertyId: window.QA_FIX.bluewater, unitName: 'QA-PU-GUARD' }) })).status;
      return { own: own.status, ownIsArray: Array.isArray(ownBody), unfiltered, write };
    });
    if (r.own !== 200) throw new Error(`client own-property unit list refused (${r.own})`);
    if (!r.ownIsArray) throw new Error('client own-property unit list is not an array');
    if (r.unfiltered !== 403) throw new Error(`unfiltered firm-wide unit list not refused (${r.unfiltered})`);
    if (r.write !== 403) throw new Error(`client property-units write not refused (${r.write})`);
  });

  // Turnover board slice (staff-creates → client-sees/stays-hidden): the
  // entry Victoria logged on the in-slice brand must be readable, the one
  // on the out-of-slice company must not, and the write is staff-only.
  await step(page, p, 'client-turnover-slice-guard', async () => {
    if (!cross.turnoverMarker) return;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await fetch('/api/turnover', { headers: auth });
      if (!list.ok) return { ok: false, why: `GET ${list.status}` };
      const rows = await list.json();
      const mine = (Array.isArray(rows) ? rows : []).filter((t) => (t.notes || '').startsWith(marker));
      const write = (await fetch('/api/turnover', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ company_name: 'QA-PROBE client write', period: 'QA FY' }) })).status;
      return { ok: true, seesVisible: mine.some((t) => /visible$/.test(t.notes || '')), seesHidden: mine.some((t) => /hidden$/.test(t.notes || '')), write };
    }, cross.turnoverMarker);
    if (!r.ok) throw new Error(`client turnover read failed (${r.why})`);
    if (!r.seesVisible) throw new Error('client cannot see the in-slice turnover entry');
    if (cross.turnoverHiddenMade && r.seesHidden) throw new Error('client can see an out-of-slice turnover entry');
    if (r.write !== 403) throw new Error(`client turnover write not refused (${r.write})`);
  });

  // r407: the portfolio dashboard's "BGP Contacts" pills must be display
  // names, not raw user ids (the endpoint used to send bgp_contact_user_ids
  // through unresolved).
  await step(page, p, 'client-portfolio-bgp-contact-names', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/company-portfolio/${window.QA_FIX.landsec}`, { headers: auth });
      if (!res.ok) return { ok: false, why: `GET ${res.status}` };
      const body = await res.json();
      return { ok: true, contacts: body?.company?.bgpContacts || [] };
    });
    if (!r.ok) throw new Error(`client portfolio read failed (${r.why})`);
    const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const raw = r.contacts.filter((c) => uuidish.test(String(c)));
    if (raw.length) throw new Error(`bgpContacts contains raw user ids: ${raw.join(', ')}`);
  });

  await step(page, p, 'client-landlord-picker-landlords-only', async () => {
    // r452: the inline deals-table landlord/client picker kept the legacy
    // filter that mixed every Tenant brand into the landlord options
    // ("Tenants joining a Landlord picker was the top user complaint" per
    // the deal form's own comment). Open the picker and assert no
    // tenant-typed company is offered while Landsec is.
    const tenants = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/crm/companies', { headers: auth });
      if (!res.ok) return null;
      const body = await res.json();
      return body.filter((c) => (c.companyType || '').startsWith('Tenant')).map((c) => c.name);
    });
    if (!tenants) throw new Error('companies read failed');
    await page.goto(`${BASE}/deals`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const trigger = page.getByText('Link landlord', { exact: false }).first();
    if (!(await trigger.count())) return; // all deals have landlords linked — nothing to assert
    await trigger.click();
    await page.waitForTimeout(800);
    const opts = await page.locator('[data-testid^="inline-link-option-"]').allTextContents();
    if (!opts.length) throw new Error('landlord picker opened with no options at all');
    const leaked = opts.filter((o) => tenants.includes(o.trim()));
    if (leaked.length) throw new Error(`landlord picker offers tenant brands: ${leaked.join(', ')}`);
    if (!opts.some((o) => /landsec/i.test(o))) throw new Error('landlord picker missing Landsec');
    await page.keyboard.press('Escape');
  });

  await step(page, p, 'client-files-no-doc-studio', async () => {
    // r452: "Create in Doc Studio" opened /templates, which isn't in
    // CLIENT_ALLOWED_ROUTES — the new tab bounced clients straight to
    // their dashboard. The button is staff-only now; Upload stays.
    await page.goto(`${BASE}/available`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    const files = page.locator('[data-testid^="button-files-"]').first();
    if (!(await files.count())) throw new Error('tracker files button not found');
    await files.click();
    await page.waitForTimeout(1200);
    if (await page.locator('[data-testid="button-create-doc-studio"]').count()) {
      throw new Error('client Files dialog still shows the staff-only Doc Studio button (its /templates tab bounces clients to the dashboard)');
    }
    if (!(await page.locator('[data-testid="button-upload-brochure"]').count())) {
      throw new Error('client Files dialog lost its Upload button');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  await step(page, p, 'client-properties-no-address-edit', async () => {
    // r460: the properties table showed clients a live "Set address" inline
    // editor whose PUT /api/crm/properties/:id is gateway-blocked (403) —
    // a dead-end staff affordance (r452 Doc Studio class). Client cells are
    // read-only now; the write stays blocked server-side.
    await page.goto(`${BASE}/properties`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    if (await page.locator('[data-testid="button-edit-address"]').count()) {
      throw new Error('client properties table still renders the Set address inline editor (its PUT is gateway-blocked for clients)');
    }
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken, 'Content-Type': 'application/json' } };
    const props = await (await fetch(`${BASE}/api/crm/properties`, auth)).json().catch(() => []);
    const own = Array.isArray(props) && props[0];
    if (own) {
      const r = await fetch(`${BASE}/api/crm/properties/${own.id}`, {
        method: 'PUT', ...auth, body: JSON.stringify({ address: { formatted: 'QA-PROBE addr' } }),
      });
      if (r.status !== 403) throw new Error(`client property PUT expected 403, got ${r.status}`);
    }
  });

  await step(page, p, 'client-brochure-upload-parity-manage-blocked', async () => {
    // r462: clients may UPLOAD brochures on their own property (explicit
    // gateway allowance) but reingest/PATCH/DELETE are gateway-blocked —
    // the tile used to show all four mutating buttons to clients
    // (dead-end, r452 class). Upload must stay 200, manage writes 403,
    // and the tile must hide the manage buttons for clients.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const pdf = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF';
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'QA-PROBE-brochure.pdf');
    form.append('type', 'leasing');
    const up = await fetch(`${BASE}/api/properties/${BLUEWATER}/brochures/upload`, { method: 'POST', ...auth, body: form });
    if (up.status !== 200) throw new Error(`client brochure upload on own property expected 200, got ${up.status}`);
    const upBody = await up.json().catch(() => ({}));
    const bid = upBody?.id || upBody?.brochure?.id;
    try {
      if (bid) {
        const del = await fetch(`${BASE}/api/properties/${BLUEWATER}/brochures/${bid}`, { method: 'DELETE', ...auth });
        if (del.status !== 403) throw new Error(`client brochure DELETE expected 403, got ${del.status}`);
        const rei = await fetch(`${BASE}/api/properties/${BLUEWATER}/brochures/${bid}/reingest`, { method: 'POST', ...auth });
        if (rei.status !== 403) throw new Error(`client brochure reingest expected 403, got ${rei.status}`);
        await page.goto(`${BASE}/properties/${BLUEWATER}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        if (await page.locator(`[data-testid="brochure-tile-reingest-${bid}"]`).count()) {
          throw new Error('client brochure tile still renders the reingest button (manage writes are gateway-blocked for clients)');
        }
      }
    } finally {
      // staff cleanup so the probe PDF doesn't linger for later scenarios
      if (bid) {
        const sl = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: AGENT_USER, password: PASSWORD }) });
        const stok = (await sl.json().catch(() => ({}))).token;
        if (stok) await fetch(`${BASE}/api/properties/${BLUEWATER}/brochures/${bid}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + stok } });
      }
    }
  });

  await step(page, p, 'client-board-report-gate', async () => {
    // r543: the firm-wide Board Report (every client's fees, every team's
    // pipeline) is staff-only — the client gateway must 403 it and its
    // Excel export. Node-side fetch so the deliberate 403s stay out of the
    // page issue log.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const rep = await fetch(`${BASE}/api/board-report`, auth);
    if (rep.status !== 403) throw new Error(`client GET /api/board-report expected 403, got ${rep.status}`);
    const xls = await fetch(`${BASE}/api/board-report/export-excel`, auth);
    if (xls.status !== 403) throw new Error(`client GET /api/board-report/export-excel expected 403, got ${xls.status}`);
  });

  await step(page, p, 'client-evidence-plans-gate', async () => {
    // r471: Evidence Plans is a staff-only module (admin "Unfinished" nav,
    // not in CLIENT_ALLOWED_API) — the client gateway must 403 reads,
    // writes and the /source lookup. Node-side fetch so the deliberate
    // 403 rows don't land in the page issue log (signature stays stable).
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const list = await fetch(`${BASE}/api/evidence-plans`, auth);
    if (list.status !== 403) throw new Error(`client GET /api/evidence-plans expected 403, got ${list.status}`);
    const src = await fetch(`${BASE}/api/evidence-plans/source?propertyId=${BLUEWATER}`, auth);
    if (src.status !== 403) throw new Error(`client GET /api/evidence-plans/source expected 403, got ${src.status}`);
    const write = await fetch(`${BASE}/api/evidence-plans`, { method: 'POST', body: new FormData(), ...auth });
    if (write.status !== 403) throw new Error(`client POST /api/evidence-plans expected 403, got ${write.status}`);
  });

  await step(page, p, 'client-news-signals-deduped', async () => {
    // r486: the news ingest can land the same story twice (Google News URL
    // wrap/unwrap flip defeats the URL dedupe), and the client Brand News
    // tab rendered the duplicate. The endpoint now collapses identical
    // (brand, headline, signal_date) rows — assert none survive.
    const auth = { headers: { Authorization: 'Bearer ' + page.qaToken } };
    const r = await fetch(`${BASE}/api/client/news-signals?limit=200`, auth);
    if (r.status !== 200) throw new Error(`client news-signals expected 200, got ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('client news-signals did not return an array');
    const seen = new Set();
    for (const s of rows) {
      const k = `${s.brand_company_id}|${s.headline}|${s.signal_date || s.created_at}`;
      if (seen.has(k)) throw new Error(`duplicate story in client news feed: "${String(s.headline).slice(0, 80)}"`);
      seen.add(k);
    }
  });

  await step(page, p, 'client-tracker-phone-card-titles', async () => {
    // r528: UX #130 stripped only the FULL property name from phone tracker
    // card titles, but unit_name embeds the scheme's short form — every card
    // still read "L112 Bluewater, Bluewater" over a "Bluewater Shopping
    // Centre" subtitle. Also guards #135 (no em-dash Area/Rent rows).
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/available`, nav);
      await mob.waitForTimeout(4000);
      const cards = await mob.locator('[data-testid^="mobile-unit-"]').count();
      if (!cards) throw new Error('no phone tracker cards rendered at 390px');
      const bad = await mob.evaluate(() => {
        const out = { echo: null, dash: null };
        for (const c of Array.from(document.querySelectorAll('[data-testid^="mobile-unit-"]'))) {
          const title = (c.querySelector('span.font-semibold')?.textContent || '').trim();
          const sub = (c.querySelector('p.text-muted-foreground')?.textContent || '').trim();
          // the scheme's short name = the subtitle's first word
          const core = sub.split(/[\s,·]+/)[0];
          if (!out.echo && core.length >= 4 && title.toLowerCase() !== core.toLowerCase()
              && title.toLowerCase().includes(core.toLowerCase())) out.echo = `${title} | ${sub}`;
          if (!out.dash && /(Area|Rent p\.a\.)\s*[—–-]\s*$/m.test(c.innerText)) out.dash = title;
        }
        return out;
      });
      if (bad.echo) throw new Error(`phone tracker card title repeats the property name: "${bad.echo}"`);
      if (bad.dash) throw new Error(`phone tracker card keeps an empty Area/Rent row (UX #135): ${bad.dash}`);
    } finally { await mobCtx.close(); }
  });

  await step(page, p, 'client-tracker-no-inline-company-create', async () => {
    // r528: the viewing/offer/interest company pickers offered clients an
    // inline "Create company" row whose POST /api/crm/companies 403s — the
    // row closed the picker and nothing happened, no error. Staff keep it
    // (asserted in the victoria round).
    const probe = await page.request.post(`${BASE}/api/crm/companies`, {
      headers: { Authorization: `Bearer ${page.qaToken}` },
      data: { name: 'QA-PROBE clientco 528' },
    });
    if (probe.status() !== 403) throw new Error(`client company create returned ${probe.status()}, expected 403`);
    const mobCtx = await page.context().browser().newContext({
      viewport: { width: 390, height: 780 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true, hasTouch: true,
    });
    await mobCtx.addCookies(await page.context().cookies());
    const mob = await mobCtx.newPage();
    try {
      const nav = { waitUntil: 'domcontentloaded', timeout: 60000 };
      await mob.goto(`${BASE}/`, nav);
      await mobSeedAuth(mob, page);
      await mobGoto(mob, `${BASE}/available`, nav);
      await mob.waitForTimeout(4000);
      const first = await mob.locator('[data-testid^="mobile-unit-"]').first().getAttribute('data-testid');
      if (!first) throw new Error('no phone tracker card to open an offer on');
      const uid = first.replace('mobile-unit-', '');
      await mob.locator(`[data-testid="unit-offer-${uid}"]`).click();
      await mob.waitForTimeout(1500);
      await mob.locator('[data-testid="offer-company"]').click();
      await mob.waitForTimeout(800);
      await mob.locator('input[placeholder^="Search"]').last().fill('QA-PROBE clientco 528');
      await mob.waitForTimeout(800);
      if (await mob.getByText(/Create company/i).count()) {
        throw new Error('client offer dialog still advertises inline company create (its POST 403s)');
      }
    } finally { await mobCtx.close(); }
  });

  await step(page, p, 'client-news-detail-not-echo', async () => {
    // r526: Google-News-shaped signals store detail = headline + source
    // ("Headline - The Grocer" vs "Headline  The Grocer"), so every card on
    // the client Brand News feed printed its own headline twice. The detail
    // line is suppressed when it adds nothing — assert no card echoes.
    await page.goto(`${BASE}/news`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    if (!(await page.locator('[data-testid="client-news-feed"]').count())) {
      throw new Error('client Brand News feed did not render');
    }
    const echo = await page.evaluate(() => {
      const key = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      for (const card of Array.from(document.querySelectorAll('[data-testid^="client-signal-"]'))) {
        if (/^client-signal-detail-/.test(card.getAttribute('data-testid') || '')) continue;
        const detail = card.querySelector('[data-testid^="client-signal-detail-"]');
        if (!detail) continue;
        const head = card.querySelector('p');
        const h = key(head && head.textContent);
        const d = key(detail.textContent);
        if (h && d && (d === h || d.startsWith(h) || h.startsWith(d))) return (head.textContent || '').slice(0, 80);
      }
      return null;
    });
    if (echo) throw new Error(`client news card repeats its headline as the detail line: "${echo}"`);
  });

  await step(page, p, 'client-deals-table-read-only-parties', async () => {
    // r534: the Deals TABLE still handed clients the "+ Link landlord" /
    // "+ Link tenant" pickers — staff jargon on their own deal, with an
    // inline "create company" row whose POST 403s (the r528 dead-end class).
    // Deal DETAIL has had read-only party slots since UX #155 (Woody,
    // 2026-09-04); the list now matches. Staff keep the pickers
    // (staff-deals-table-editors).
    await page.goto(`${BASE}/deals`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
      await page.waitForTimeout(1000);
      await page.goto(`${BASE}/deals`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    });
    await page.waitForTimeout(4000);
    if (!(await page.locator('[data-testid="inline-link-readonly"]').count())) {
      throw new Error('client deals table rendered no read-only party cells (did the table load?)');
    }
    if (await page.locator('[data-testid="inline-link-select-trigger"]').count()) {
      throw new Error('client deals table still offers an inline party picker (UX #155 is list-wide)');
    }
    // The create-company row behind that picker really is closed to a client.
    const probe = await page.request.post(`${BASE}/api/crm/companies`, {
      headers: { Authorization: `Bearer ${page.qaToken}` },
      data: { name: `QA-PROBE Newco ${ROUND}` },
    });
    if (probe.status() !== 403) throw new Error(`client company create returned ${probe.status()}, expected 403`);
  });

  await step(page, p, 'client-properties-table-readonly-cells', async () => {
    // r542: the client's Properties table printed NOTHING in the Tenants and
    // BGP Contacts cells when a property had neither linked — a client has no
    // "+" affordance, so the row read half-broken next to the "—" every other
    // read-only column shows. Staff keep the pickers
    // (staff-properties-table-pickers-kept).
    await page.goto(`${BASE}/properties`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(async (e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
      await page.waitForTimeout(1000);
      await page.goto(`${BASE}/properties`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    });
    // The Properties table is a TAB inside DealsHub — wait for a real
    // tenants cell (either shape) rather than a fixed sleep.
    await page.waitForSelector('[data-testid^="tenants-readonly-"], [data-testid^="add-tenant-"]', { timeout: 25000 })
      .catch(() => { throw new Error('client properties table never rendered a tenants cell (did it load?)'); });
    for (const kind of ['tenants', 'agents']) {
      if (!(await page.locator(`[data-testid^="${kind}-readonly-"]`).count())) {
        throw new Error(`client properties table printed a BLANK ${kind} cell instead of a read-only dash`);
      }
    }
    for (const kind of ['add-tenant', 'add-agent']) {
      if (await page.locator(`[data-testid^="${kind}-"]`).count()) {
        throw new Error(`client properties table still offers the ${kind} picker`);
      }
    }
  });
}

// ─── Additional personas ──────────────────────────────────────────────────
// Woody (admin), Nick (Investment staff) and Sam Cole (Hammerson — a SECOND
// client) extend coverage to the admin estate, the investment surfaces and
// bidirectional client-vs-client isolation.

const ADMIN_USER = 'woody@brucegillinghampollard.com';
const INVESTMENT_USER = 'nick@brucegillinghampollard.com';
const RIVAL_CLIENT_USER = 'sam.cole@hammerson.com';

async function woodyRound(page, cross) {
  const p = 'woody';
  // The admin + "Unfinished" estate nobody else can reach. visit() flags dead
  // routes / blank pages; collectors catch console errors and 4xx/5xx.
  for (const path of [
    '/finance', '/expenses', '/news', '/subscriptions', '/addins', '/settings',
    '/portfolios', '/kyc-clouseau?tab=board', '/tenant-rep',
    '/hunters/letting', '/hunters/investment', '/landlords', '/pla/matters',
    '/westminster-restaurants', '/models', '/document-studio',
    '/document-briefs', '/reporting', '/board-report', '/leads', '/enrichment',
  ]) {
    await visit(page, p, path);
  }
  // Admin password reset (terminal side): resetting the dedicated throwaway
  // user returns a temp password that actually logs in. Client-side refusal
  // is covered in mark's round (client-password-reset-guard).
  await step(page, p, 'admin-password-reset', async () => {
    const r = await page.evaluate(async (args) => {
      const [adminUser, adminPw] = args;
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const reset = await fetch('/api/admin/users/aaaaaaaa-5555-5555-5555-555555555555/reset-password', {
        method: 'POST', credentials: 'include', headers: auth, body: '{}' }).catch(() => ({ ok: false, status: 0 }));
      if (!reset.ok) return { ok: false, why: `reset ${reset.status}` };
      const d = await reset.json();
      if (!d.tempPassword) return { ok: false, why: 'no tempPassword returned' };
      const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'qa.resettable@bgp.test', password: d.tempPassword }) }).catch(() => ({ ok: false, status: 0 }));
      // The login proof just switched THIS page's session cookie to the
      // throwaway (non-admin) user — every admin call after this scenario
      // 403s until the session is restored. Log back in as the admin.
      await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUser, password: adminPw }) }).catch(() => {});
      return { ok: true, loginWorks: login.ok };
    }, [ADMIN_USER, PASSWORD]);
    if (!r.ok) throw new Error(`admin password reset failed (${r.why})`);
    if (!r.loginWorks) throw new Error('temp password from admin reset does not log in');
  });

  // Receipt of Victoria's assigned task — assignment must land on the
  // assignee's own list, not the assigner's.
  await step(page, p, 'admin-sees-assigned-task', async () => {
    if (!cross.assignedTaskTitle) return;
    const r = await page.evaluate(async (needle) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = await (await fetch('/api/tasks', { headers: auth })).json().catch(() => []);
      const rows = Array.isArray(list) ? list : (list?.data || []);
      return { seen: rows.some((t) => t.title === needle) };
    }, cross.assignedTaskTitle);
    if (!r.seen) throw new Error("task assigned to this user never arrived on their list");
  });

  // No error boundary anywhere on the heavy admin boards.
  await step(page, p, 'admin-kyc-board-render', async () => {
    await page.goto(`${BASE}/kyc-clouseau?tab=board`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const tripped = await page.getByText('something went wrong', { exact: false }).count();
    if (tripped) throw new Error(`${tripped} error boundary(ies) tripped on the AML board`);
  });

  // Companion to mark's client-deal-fee-injection-guard: as admin (who sees
  // the unstripped fields), confirm the injected markers never hit the DB.
  await step(page, p, 'admin-fee-injection-audit', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json();
      const hit = (Array.isArray(deals) ? deals : []).find((d) =>
        (d.feeNotes || '').includes('QA-FEE-INJECT') || Number(d.commission) === 999999);
      return { leaked: !!hit, name: hit?.name };
    });
    if (r.leaked) throw new Error(`client fee injection landed in the database (deal "${r.name}")`);
  });

  // Cashflow board v3 (r395): password gate dropped — the equity/admin gate
  // IS the lock. Equity sees the board directly on /finance; non-equity 403.
  // Receipts are app/Xero-driven now: workbook receipt lines retired, the
  // editable LEGACY receivables line remains; cell-edit roundtrip on it.
  await step(page, p, 'staff-cashflow-board', async () => {
    const r = await page.evaluate(async (agentUser) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const direct = await fetch('/api/cashflow', { credentials: 'include', headers: auth });
      if (direct.status !== 200) return { ok: false, why: `equity GET expected 200, got ${direct.status}` };
      const data = await direct.json();
      if (!Array.isArray(data.lines) || !data.lines.length || !data.months?.length) return { ok: false, why: 'GET returned no lines/months' };
      const legacy = data.lines.find((l) => l.key === 'LEGACY' && l.section === 'receipts');
      if (!legacy) return { ok: false, why: 'LEGACY receivables line missing from receipts' };
      const retired = data.lines.filter((l) => l.section === 'receipts' && ['1', '2', '3', '4a', '4c', '5'].includes(l.key));
      if (retired.length) return { ok: false, why: `retired workbook receipt lines still active (${retired.map((l) => l.key).join(',')})` };
      const gone = await fetch('/api/cashflow/unlock', { method: 'POST', credentials: 'include', headers: auth, body: '{"password":"BGPPAY"}' });
      if (gone.ok) return { ok: false, why: 'retired /api/cashflow/unlock endpoint still answers' };
      const month = data.months[0];
      const before = data.cells.find((c) => c.line_id === legacy.id && c.month === month && c.basis === 'budget');
      const save = await fetch('/api/cashflow/cell', { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ lineId: legacy.id, month, basis: 'budget', amount: 424242 }) });
      if (!save.ok) return { ok: false, why: `cell PATCH ${save.status}` };
      const after = await (await fetch('/api/cashflow', { credentials: 'include', headers: auth })).json();
      const cell = after.cells.find((c) => c.line_id === legacy.id && c.month === month && c.basis === 'budget');
      const landed = Number(cell?.amount) === 424242;
      // restore the original value (or clear the cell if it didn't exist)
      await fetch('/api/cashflow/cell', { method: 'PATCH', credentials: 'include', headers: auth,
        body: JSON.stringify({ lineId: legacy.id, month, basis: 'budget', amount: before ? before.amount : null }) });
      if (!landed) return { ok: false, why: `cell edit did not land (got ${cell?.amount})` };
      // non-equity staff must get nothing: token-login as victoria
      // (credentials:'omit' — never store the Set-Cookie, r391 lesson)
      const vlogin = await fetch('/api/auth/login', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: agentUser, password: 'B@nd0077!' }) });
      if (!vlogin.ok) return { ok: false, why: `victoria token login ${vlogin.status}` };
      const vtoken = (await vlogin.json()).token;
      const vres = await fetch('/api/cashflow', { credentials: 'omit', headers: { Authorization: 'Bearer ' + vtoken } });
      if (vres.status !== 403) return { ok: false, why: `non-equity GET expected 403, got ${vres.status}` };
      return { ok: true };
    }, AGENT_USER);
    if (!r.ok) throw new Error(`cashflow board v3 check failed (${r.why})`);
  });

  // Historical billings (r400): static Sage-era invoiced WIP behind the
  // equity/admin gate. Equity gets the pre-aggregated payload (FY2019-26,
  // known totals); non-equity staff 403.
  await step(page, p, 'staff-historical-wip-gate', async () => {
    const r = await page.evaluate(async (agentUser) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/historical-wip', { credentials: 'include', headers: auth });
      if (res.status !== 200) return { ok: false, why: `equity GET expected 200, got ${res.status}` };
      const data = await res.json();
      if (!Array.isArray(data.fys) || data.fys[data.fys.length - 1] !== 2026 || data.fys[0] !== 2019)
        return { ok: false, why: `fys wrong (${JSON.stringify(data.fys)})` };
      if (Math.round(data.fyTotals[2026]) !== 5191872 || Math.round(data.fyTotals[2025]) !== 4919519)
        return { ok: false, why: `FY totals drifted (26=${data.fyTotals[2026]}, 25=${data.fyTotals[2025]})` };
      for (const k of ['team', 'agent', 'client', 'company'])
        if (!Array.isArray(data.dims?.[k]) || !data.dims[k].length) return { ok: false, why: `dim ${k} empty` };
      const vlogin = await fetch('/api/auth/login', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: agentUser, password: 'B@nd0077!' }) });
      if (!vlogin.ok) return { ok: false, why: `victoria token login ${vlogin.status}` };
      const vtoken = (await vlogin.json()).token;
      const vres = await fetch('/api/historical-wip', { credentials: 'omit', headers: { Authorization: 'Bearer ' + vtoken } });
      if (vres.status !== 403) return { ok: false, why: `non-equity GET expected 403, got ${vres.status}` };
      return { ok: true };
    }, AGENT_USER);
    if (!r.ok) throw new Error(`historical WIP gate check failed (${r.why})`);
  });

  // Business Gateway status must answer for staff (r396: require-in-ESM made
  // it 500 under tsx dev) and the paid official-copy order must be blocked
  // for clients by the API gateway.
  await step(page, p, 'staff-lrbg-status-client-order-guard', async () => {
    const r = await page.evaluate(async (clientUser) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const st = await fetch('/api/lr-bg/status', { credentials: 'include', headers: auth });
      if (st.status !== 200) return { ok: false, why: `staff status expected 200, got ${st.status}` };
      const body = await st.json();
      if (!body.fingerprints || !('test' in body.fingerprints)) return { ok: false, why: 'fingerprints audit missing from status' };
      const mlogin = await fetch('/api/auth/login', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: clientUser, password: 'B@nd0077!' }) });
      if (!mlogin.ok) return { ok: false, why: `client token login ${mlogin.status}` };
      const mtoken = (await mlogin.json()).token;
      const order = await fetch('/api/lr-bg/official-copy', { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mtoken },
        body: JSON.stringify({ titleNumber: 'QA-GUARD-1' }) });
      if (order.status !== 403) return { ok: false, why: `client official-copy expected 403, got ${order.status}` };
      return { ok: true };
    }, CLIENT_USER);
    if (!r.ok) throw new Error(`lr-bg status/guard check failed (${r.why})`);
  });

  // Brand Intelligence overview: Turnover Leaders is a BRAND widget — a
  // landlord with turnover_data rows must not appear in topTurnover, and the
  // leaderboard must agree with the "With Turnover Data" stat (r442: the
  // staff query had no tenant filter, so Hammerson ranked as a "brand").
  await step(page, p, 'staff-brands-hub-turnover-brands-only', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/brands/hub', { credentials: 'include', headers: auth });
      if (res.status !== 200) return { ok: false, why: `hub GET expected 200, got ${res.status}` };
      const body = await res.json();
      const rows = body.topTurnover || [];
      const nonTenant = rows.find((t) => t.company_type && !/^tenant -/i.test(t.company_type));
      if (nonTenant) return { ok: false, why: `non-tenant in Turnover Leaders: ${nonTenant.company_name} (${nonTenant.company_type})` };
      const linked = rows.filter((t) => t.company_id).length;
      const stat = parseInt(body.stats?.brands_with_turnover || '0', 10);
      // topTurnover is capped at 20 rows — only compare when uncapped.
      if (rows.length < 20 && linked !== stat) return { ok: false, why: `leaderboard linked count ${linked} != brands_with_turnover stat ${stat}` };
      return { ok: true };
    });
    if (!r.ok) throw new Error(`brands-hub turnover leaders check failed (${r.why})`);
  });

  // Consultant external fee-split (r397, Woody 2026-08-27): "Consultant" is
  // selectable in every split picker, saves as a name-only allocation
  // (agent_user_id stays null — never enters staff commission) and shows on
  // the WIP Agent Summary. Self-contained: probe deal is created + deleted
  // (deleteCrmDeal cascades the allocation rows).
  await step(page, p, 'staff-consultant-fee-split', async () => {
    const r = await page.evaluate(async (round) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const cRes = await fetch('/api/crm/deals', { method: 'POST', credentials: 'include', headers: auth,
        body: JSON.stringify({ name: `QA-R${round} consultant split probe`, status: 'NEG', fee: 100000 }) });
      if (!cRes.ok) return { ok: false, why: `deal create ${cRes.status}` };
      const deal = await cRes.json();
      try {
        const put = await fetch(`/api/crm/deals/${deal.id}/fee-allocations`, { method: 'PUT', credentials: 'include', headers: auth,
          // Off-the-top rule (JOGQK ccd1cce): consultant 10% first, BGP House
          // 15% of the remaining 90% = 13.5%, staff share the rest (76.5%).
          body: JSON.stringify({ allocations: [
            { agentName: 'Victoria Broadhead', allocationType: 'percentage', percentage: 76.5, fixedAmount: 0, isBgpHouse: false },
            { agentName: 'Consultant', allocationType: 'percentage', percentage: 10, fixedAmount: 0, isBgpHouse: false },
            { agentName: 'BGP House', allocationType: 'percentage', percentage: 13.5, fixedAmount: 0, isBgpHouse: true },
          ] }) });
        if (!put.ok) return { ok: false, why: `allocations PUT ${put.status}` };
        const rows = await (await fetch(`/api/crm/deals/${deal.id}/fee-allocations`, { credentials: 'include', headers: auth })).json();
        const cons = rows.find((a) => a.agentName === 'Consultant');
        if (!cons) return { ok: false, why: 'Consultant allocation missing after save' };
        if (cons.agentUserId != null) return { ok: false, why: `Consultant resolved to a staff user id (${cons.agentUserId})` };
        if (!rows.some((a) => a.isBgpHouse)) return { ok: false, why: 'BGP House flag lost on save' };
        const summary = await (await fetch('/api/wip/agent-summary', { credentials: 'include', headers: auth })).json();
        const sRow = Array.isArray(summary) ? summary.find((s) => s.agent === 'Consultant') : null;
        if (!sRow) return { ok: false, why: 'Consultant missing from WIP agent summary' };
        if (Math.round(sRow.wip) < 10000) return { ok: false, why: `Consultant WIP slice wrong (${sRow.wip})` };
        return { ok: true };
      } finally {
        await fetch(`/api/crm/deals/${deal.id}`, { method: 'DELETE', credentials: 'include', headers: auth }).catch(() => {});
      }
    }, ROUND);
    if (!r.ok) throw new Error(`consultant fee-split check failed (${r.why})`);
  });
}

async function nickRound(page, cross) {
  const p = 'nick';
  for (const path of ['/investment-tracker', '/comps', '/deals']) {
    await visit(page, p, path);
  }
  // Investment tracker renders content (not a dead tab for the team that
  // lives in it).
  await step(page, p, 'investment-tracker-render', async () => {
    await page.goto(`${BASE}/investment-tracker`).catch((e) => {
      if (!/ERR_ABORTED/.test(String(e))) throw e;
    });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    if (await page.getByText('Page not found').count()) throw new Error('investment tracker is a dead route');
    const tripped = await page.getByText('something went wrong', { exact: false }).count();
    if (tripped) throw new Error(`${tripped} error boundary(ies) tripped on the investment tracker`);
  });
}

async function samRound(page, cross) {
  const p = 'sam';
  // Rival client sanity: their own scoped app works…
  await step(page, p, 'rival-client-dashboard', async () => {
    // The dashboard client-side-redirects on mount, which can abort the goto —
    // tolerate ERR_ABORTED like visit() does, then read the settled page.
    await page.goto(`${BASE}/`).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3500);
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('rival client dashboard rendered blank');
    if (!/Hammerson/i.test(body)) throw new Error('rival client dashboard shows no Hammerson branding/scope');
  });
  // …and NOTHING of Landsec leaks into it — deals, briefs, or the viewing
  // Victoria logged on a Landsec unit this round. This is the first REAL
  // client-vs-client isolation test (two genuine logins, both directions).
  await step(page, p, 'rival-client-isolation', async () => {
    const r = await page.evaluate(async (viewingStamp) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const out = {};
      const deals = await (await fetch('/api/crm/deals', { headers: auth })).json().catch(() => []);
      out.landsecDeals = JSON.stringify(deals).includes('Bluewater');
      const briefs = await (await fetch('/api/unit-briefs', { headers: auth })).json().catch(() => []);
      out.landsecBriefs = JSON.stringify(briefs).toLowerCase().includes('bluewater');
      const viewings = await (await fetch('/api/available-units/all-viewings', { headers: auth })).json().catch(() => []);
      out.landsecViewing = viewingStamp ? JSON.stringify(viewings).includes(viewingStamp) : false;
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json().catch(() => []);
      const list = Array.isArray(props) ? props : (props?.data || []);
      out.landsecProperty = list.some((x) => /bluewater|o2 centre/i.test(x.name || ''));
      return out;
    }, cross.viewingStamp || '');
    const leaks = Object.entries(r).filter(([, v]) => v).map(([k]) => k);
    if (leaks.length) throw new Error(`Landsec data leaked to the rival client: ${leaks.join(', ')}`);
  });
  // Rival client WRITE attempts against Landsec assets by id must be refused
  // — read guards exist; this locks the write side (viewing, offer, HOTs,
  // unit PATCH, brief create on a Landsec unit).
  // Bidirectional isolation on the ActivitySummary feed: the rival client
  // must never see Landsec content (mirror of client-activity-summary-scoped).
  await step(page, p, 'rival-activity-summary-isolated', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/activity-summary', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const body = JSON.stringify(await res.json().catch(() => ({})));
      return { ok: true, landsec: /landsec|bluewater/i.test(body) };
    });
    if (!r.ok) throw new Error(`rival activity-summary unhealthy (${r.status})`);
    if (r.landsec) throw new Error("Landsec content leaked into the rival client's activity summary");
  });

  await step(page, p, 'rival-client-write-guards', async () => {
    const probes = await page.evaluate(async (crossUnitId) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      // A real Landsec unit id: Victoria's round discovered one on the live
      // fixture (cross.briefUnitId); the legacy dev-fixture id is the
      // fallback so the probes hit an existing row, not a 404.
      const foreign = crossUnitId || '85b15bb7-58be-429a-b034-7df637aeb7cd';
      const out = [];
      const tryReq = async (label, method, url, body) => {
        const r = await fetch(url, { method, credentials: 'include', headers: auth, body: body ? JSON.stringify(body) : undefined }).catch(() => ({ status: 0, ok: false }));
        out.push({ label, status: r.status, ok: r.ok });
      };
      await tryReq('viewing', 'POST', `/api/available-units/${foreign}/viewings`, { viewingDate: '2026-08-01', attendees: 'QA-RIVAL-WRITE' });
      await tryReq('offer', 'POST', `/api/available-units/${foreign}/offers`, { companyName: 'QA-RIVAL-WRITE', offerDate: '2026-08-01' });
      await tryReq('hots', 'PUT', `/api/available-units/${foreign}/hots`, { content: 'QA-RIVAL-WRITE' });
      await tryReq('unit-patch', 'PATCH', `/api/available-units/${foreign}`, { condition: 'QA-RIVAL-WRITE' });
      await tryReq('brief', 'POST', `/api/available-units/${foreign}/brief`, { title: 'QA-RIVAL-WRITE' });
      // Cross-tenant client-team board writes: the /api/client-teams/ prefix
      // is client-writable, but the handlers must reject a board that isn't
      // the caller's own. Sam (Hammerson) aims every write at the LANDSEC id.
      const LANDSEC = window.QA_FIX.landsec;
      await tryReq('team-member-add', 'POST', `/api/client-teams/${LANDSEC}/member`, { user_id: '99999999-4444-4444-4444-444444444444', team_group: 'QA-RIVAL' });
      await tryReq('team-column-add', 'POST', `/api/client-teams/${LANDSEC}/columns`, { name: 'QA-RIVAL-COL' });
      await tryReq('team-column-del', 'DELETE', `/api/client-teams/${LANDSEC}/columns/Investment`, null);
      await tryReq('team-reorder', 'POST', `/api/client-teams/${LANDSEC}/reorder`, { items: [{ id: 'x', sort_order: 0 }] });
      return out;
    }, cross.briefUnitId || null);
    const allowed = probes.filter((x) => x.ok);
    if (allowed.length) throw new Error(`rival client wrote to a Landsec resource: ${allowed.map((x) => x.label).join(', ')}`);
  });

  // Sam can still work their OWN portfolio (scoping isn't just "sees nothing").
  await step(page, p, 'rival-client-own-portfolio', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const props = await (await fetch('/api/crm/properties?excludeComps=true', { headers: auth })).json().catch(() => []);
      const list = Array.isArray(props) ? props : (props?.data || []);
      return { hasOwn: list.some((x) => /brent cross/i.test(x.name || '')) };
    });
    if (!r.hasOwn) throw new Error("rival client can't see their own property (over-scoped)");
  });

  // Symmetry check for the brand-profile scoping fixes: the rival client
  // (Hammerson) viewing the same shared brand (Honi) must see THEIR OWN
  // counterparty data — Brent Cross pitches/leases, the QA-LEAK-DEAL that is
  // Honi↔Hammerson — and NEVER a Landsec scheme (Bluewater / O2). Confirms the
  // bpScope scoping is per-tenant, not Landsec-special.
  await step(page, p, 'rival-brand-profile-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch(`/api/brand/${window.QA_FIX.brand}/profile`, { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const d = await res.json().catch(() => null);
      const props = [...(d?.pitchedTo || []), ...(d?.leaseEvents || [])].map((x) => String(x.property_name || ''));
      const landsecLeak = props.some((n) => /bluewater|o2 centre/i.test(n));
      const ownVisible = props.some((n) => /brent cross/i.test(n));
      return { ok: true, landsecLeak, ownVisible };
    });
    if (!r.ok) throw new Error(`rival client brand profile unhealthy (${r.status})`);
    if (r.landsecLeak) throw new Error("a Landsec scheme leaked onto the rival client's brand profile (cross-tenant leak)");
    if (!r.ownVisible) throw new Error("rival client can't see their own scheme's brand activity (over-scoped)");
  });

  // Cross-tenant team isolation: a rival client (Sam/Hammerson) may read
  // THEIR OWN account team but must be refused the Landsec team board —
  // otherwise one landlord sees another's BGP staff assignments, names,
  // emails and CVs. (The GET route scopes a client to their own company.)
  await step(page, p, 'rival-team-board-isolated', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = await fetch('/api/client-teams/99999999-1111-1111-1111-111111111111', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownArray = own.ok ? Array.isArray(await own.json().catch(() => null)) : false;
      const foreign = (await fetch(`/api/client-teams/${window.QA_FIX.landsec}`, { headers: auth }).catch(() => ({ status: 0 }))).status;
      // r531: the board GET was scoped but three sub-reads under the same
      // allowed prefix were not — member/:id/properties handed a rival the
      // landlord's whole property list (names + postcodes), and
      // columns/candidates leaked their board config.
      const subs = {};
      for (const sub of ['member/00000000-0000-0000-0000-000000000000/properties', 'columns', 'candidates']) {
        subs[sub.split('/')[0] === 'member' ? 'memberProperties' : sub] =
          (await fetch(`/api/client-teams/${window.QA_FIX.landsec}/${sub}`, { headers: auth }).catch(() => ({ status: 0 }))).status;
      }
      return { ownOk: own.ok, ownArray, foreign, subs };
    });
    if (!r.ownOk || !r.ownArray) throw new Error("rival client can't read their own team board");
    if (r.foreign !== 403) throw new Error(`rival client read the Landsec team board (expected 403, got ${r.foreign})`);
    for (const [name, status] of Object.entries(r.subs)) {
      if (status !== 403) throw new Error(`rival client read the Landsec team board's ${name} (expected 403, got ${status})`);
    }
  });

  // The tracker-row edit endpoints (viewing/offer PATCH + DELETE) must hold
  // the tenant boundary: Sam editing or deleting the viewing/offer Victoria
  // logged on a Landsec unit must be refused. Complements
  // rival-client-write-guards, which only probes the POST side.
  // r533: chat-media by filename, and the deal M365 sub-reads, both carried
  // requireAuth only — a rival client could pull any chat attachment (KYC
  // documents live in the same namespace) and probe deal existence.
  await step(page, p, 'rival-chat-media-and-deal-subreads-guard', async () => {
    const r = await page.evaluate(async ([shared, priv, own, dealId]) => {
      const bearer = 'Bearer ' + localStorage.getItem('authToken');
      const get = async (url) => url
        ? (await fetch(url, { credentials: 'include', headers: { Authorization: bearer } }).catch(() => ({ status: 0 }))).status
        : -1;
      return {
        shared: await get(shared && `/api/chat-media/${shared}`),
        priv: await get(priv && `/api/chat-media/${priv}`),
        own: await get(own && `/api/chat-media/${own}`),
        emails: await get(dealId && `/api/crm/deals/${dealId}/related-emails`),
        events: await get(dealId && `/api/crm/deals/${dealId}/related-events`),
      };
    }, [cross.mediaShared || null, cross.mediaPrivate || null, cross.mediaClientOwn || null, cross.clientDealId || null]);
    for (const [k, want] of [['shared', 403], ['priv', 403], ['own', 403], ['emails', 403], ['events', 403]]) {
      if (r[k] !== -1 && r[k] !== want) throw new Error(`rival ${k} came back ${r[k]}, expected ${want}`);
    }
  });

  await step(page, p, 'rival-viewing-offer-patch-guard', async () => {
    if (!cross.viewingId || !cross.offerId) return;
    const r = await page.evaluate(async (args) => {
      const [viewingId, offerId] = args;
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const s = async (url, method, body) =>
        (await fetch(url, { method, credentials: 'include', headers: auth, body: body ? JSON.stringify(body) : undefined }).catch(() => ({ status: 0 }))).status;
      return {
        vPatch: await s(`/api/available-units/viewings/${viewingId}`, 'PATCH', { attendees: 'QA-RIVAL-EDIT' }),
        oPatch: await s(`/api/available-units/offers/${offerId}`, 'PATCH', { companyName: 'QA-RIVAL-EDIT' }),
        vDel: await s(`/api/available-units/viewings/${viewingId}`, 'DELETE'),
      };
    }, [cross.viewingId, cross.offerId]);
    if (r.vPatch !== 403) throw new Error(`rival client edited a Landsec viewing (expected 403, got ${r.vPatch})`);
    if (r.oPatch !== 403) throw new Error(`rival client edited a Landsec offer (expected 403, got ${r.oPatch})`);
    if (r.vDel !== 403) throw new Error(`rival client deleted a Landsec viewing (expected 403, got ${r.vDel})`);
  });

  // r529: the three unit-INTEREST routes were requireAuth only while their
  // viewing/offer siblings all carried assertUnitInClientScope — a rival
  // client could read, add and delete interest on another landlord's unit.
  // r532 (same class as r529/r531): GET sub-reads under the client-allowed
  // /api/crm/ prefix that answered for ANY id while their scoped siblings
  // (comp detail, requirements-investment list) gated correctly.
  await step(page, p, 'rival-comp-files-and-reqinv-guard', async () => {
    const compId = cross.compId;
    const reqInvId = cross.reqInvId;
    if (!compId && !reqInvId) return;
    const r = await page.evaluate(async ([comp, reqInv]) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const out = {};
      if (comp) {
        const files = await fetch(`/api/crm/comps/${comp}/files`, { headers: auth }).catch(() => ({ status: 0 }));
        out.files = files.status;
        const bulk = await fetch(`/api/crm/comps/files/bulk?compIds=${comp}`, { headers: auth }).catch(() => ({ status: 0 }));
        out.bulkStatus = bulk.status;
        out.bulkRows = bulk.ok ? ((await bulk.json().catch(() => [])) || []).length : -1;
      }
      if (reqInv) {
        const detail = await fetch(`/api/crm/requirements-investment/${reqInv}`, { headers: auth }).catch(() => ({ status: 0 }));
        out.reqInv = detail.status;
      }
      return out;
    }, [compId, reqInvId]);
    if (compId && r.files !== 403) throw new Error(`rival client read a Landsec comp's files (expected 403, got ${r.files})`);
    if (compId && r.bulkRows !== 0) throw new Error(`rival client got ${r.bulkRows} Landsec comp file row(s) from /files/bulk (expected 0)`);
    if (reqInvId && r.reqInv !== 403) throw new Error(`rival client read a Landsec investment requirement (expected 403, got ${r.reqInv})`);
  });

  await step(page, p, 'rival-unit-interest-guard', async () => {
    const unitId = cross.briefUnitId;
    if (!unitId) return;
    const r = await page.evaluate(async (foreign) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const s = async (url, method, body) =>
        (await fetch(url, { method, credentials: 'include', headers: auth, body: body ? JSON.stringify(body) : undefined }).catch(() => ({ status: 0 }))).status;
      return {
        get: await s(`/api/available-units/${foreign}/interest`, 'GET'),
        post: await s(`/api/available-units/${foreign}/interest`, 'POST', { companyName: 'QA-PROBE rival interest' }),
      };
    }, unitId);
    if (r.get !== 403) throw new Error(`rival client read a Landsec unit's interest (expected 403, got ${r.get})`);
    if (r.post !== 403) throw new Error(`rival client added interest to a Landsec unit (expected 403, got ${r.post})`);
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

// Prefer the container's preinstalled chromium (version-stable symlink);
// fall back to playwright's own browser where /opt/pw-browsers is absent.
const QA_CHROMIUM = process.env.QA_CHROMIUM
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM } : {});
// The QA container has no external network — requests to external hosts
// (google favicon fallbacks etc.) HANG ~12-28s before resetting, which
// starves waitForLoadState('networkidle') and randomly times out scenarios
// (r377: client-add-contact, staff-property-tenancy-mobile). Abort anything
// that isn't the local app so idle reflects the app alone.
const rawNewContext = browser.newContext.bind(browser);
browser.newContext = async (opts) => {
  const ctx = await rawNewContext(opts);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  return ctx;
};
const agentCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const clientCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

console.log(`── Round ${ROUND} — Victoria (agent) × Mark (Landsec client) ──`);
const vPage = await login(agentCtx, AGENT_USER);
const FIX = await resolveFixture(vPage.qaToken);
LANDSEC = FIX.landsec; BLUEWATER = FIX.bluewater; BRAND = FIX.brand; INTEL_BRAND = FIX.intelBrand;
console.log(`  [fixture] landsec=${LANDSEC} bluewater=${BLUEWATER} brand=${BRAND}`);
// Every page in every context reads the resolved IDs as window.QA_FIX
// (init script re-runs on each navigation — every scenario starts with one;
// a direct evaluate here would race the app's auth-hydration navigation).
for (const ctx of [agentCtx, clientCtx]) await ctx.addInitScript((f) => { window.QA_FIX = f; }, FIX);
const mPage = await login(clientCtx, CLIENT_USER);
attachCollectors(vPage, 'victoria');
attachCollectors(mPage, 'mark');
if (process.env.QA_DEBUG) {
  const t = () => new Date().toISOString();
  browser.on('disconnected', () => console.log(`  [dbg ${t()}] BROWSER disconnected`));
  vPage.on('close', () => console.log(`  [dbg ${t()}] vPage CLOSE`));
  vPage.on('crash', () => console.log(`  [dbg ${t()}] vPage CRASH`));
  mPage.on('close', () => console.log(`  [dbg ${t()}] mPage CLOSE`));
}

const cross = { dealStamp: null };
if (CROSS_FILE && existsSync(CROSS_FILE)) Object.assign(cross, JSON.parse(readFileSync(CROSS_FILE, 'utf8')));
if (PERSONAS.includes('victoria')) await victoriaRound(vPage, cross).catch((e) => logIssue('victoria', 'round', 'harness-crash', e.message));
if (PERSONAS.includes('mark')) await markRound(mPage, cross).catch((e) => logIssue('mark', 'round', 'harness-crash', e.message));

// Extended personas — each with its own context so sessions never bleed.
for (const [name, user, fn] of [
  ['woody', ADMIN_USER, woodyRound],
  ['nick', INVESTMENT_USER, nickRound],
  ['sam', RIVAL_CLIENT_USER, samRound],
]) {
  if (!PERSONAS.includes(name)) continue;
  currentScenario[name] = 'startup';
  try {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript((f) => { window.QA_FIX = f; }, FIX);
    const pg = await login(ctx, user);
    attachCollectors(pg, name);
    await fn(pg, cross).catch((e) => logIssue(name, 'round', 'harness-crash', e.message));
    await ctx.close();
  } catch (e) {
    logIssue(name, 'login', 'harness-crash', e.message);
  }
}

await browser.close();
if (CROSS_FILE) writeFileSync(CROSS_FILE, JSON.stringify(cross));

const byKind = {};
for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
console.log(`\n── Round ${ROUND} complete: ${issues.length} issues ──`);
console.log(JSON.stringify(byKind, null, 2));
