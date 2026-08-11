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
import { mkdirSync, appendFileSync, existsSync } from 'fs';

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
  /\/api\/property\/[^/]+\/brand-gaps\/(commentary|international)/, // Brand Gap v2 AI reads — 500 locally with no AI key (the base /brand-gaps is keyless and stays checked); works in prod. The scope gate is covered by client-brand-gaps-scoped.
  /\/api\/activity\/(brand|landlord)\/[^/]+$/, // AI relationship activity: own company + slice brands return 200 for clients since r215 (gateway now honours the 2026-08-04 parity decision); anything else 403s. client-interactions-guard is the authoritative lock either way.
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
const NEGATIVE_PROBE_SCENARIOS = new Set(['client-destructive-guards', 'client-bulk-mutation-guard', 'client-crm-ingest-guard', 'client-add-delete-unit', 'client-hots-roundtrip', 'client-foreign-unit-guards', 'rival-client-write-guards', 'rival-team-board-isolated', 'client-staff-deal-ops-guards', 'client-brand-slice-and-extras', 'client-requirements-write-guards', 'client-contact-scope-guards', 'client-unit-matches', 'client-brand-suggestions-scoped', 'client-brand-suggested-pitches-scoped', 'client-news-write-guards', 'client-contact-edit-not-delete', 'client-requirement-scoping', 'client-password-reset-guard', 'client-commentary-own-property', 'client-plans-board-scoped', 'client-brand-gaps-scoped', 'client-task-assign-guard', 'client-lease-events-guard', 'client-firm-reporting-guard', 'client-deal-report-guard', 'client-mailbox-guard', 'client-firm-internal-guard', 'client-expenses-guard', 'client-property-tenants-scoped', 'client-available-unit-read-scoped', 'client-detail-by-id-scoped', 'client-contact-override-scoped', 'client-portfolio-rollup-scoped', 'client-tasks-board-scoped', 'client-tenancy-export-scoped', 'client-tenancy-write-scoped', 'client-tenancy-staff-ops-guard', 'client-insights-scoped', 'client-interactions-guard', 'client-hunters-guard', 'client-leads-guard', 'client-news-intel-guard', 'client-document-briefs-guard', 'client-wip-report-guard', 'client-agent-directory-tenant-rep', 'client-property-pathway-guard', 'client-chat-delete-own-only', 'client-chat-thread-read-isolation', 'client-brand-kyc-visible-actions-blocked', 'client-kyc-board-guard', 'client-covenant-guard', 'client-crm-truth-engine-guard', 'client-apollo-enrichment-scope', 'client-sharepoint-surface', 'client-sharepoint-write-guard', 'client-nav-guard-consistency', 'rival-viewing-offer-patch-guard', 'client-image-assign-scope-guard', 'client-map-layer-scope', 'client-brief-target-scope', 'client-contact-detail-gates', 'staff-ai-failure-terminal']);

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
  const properties = await list('/api/crm/properties');
  const bluewater = properties.find((p) => /bluewater/i.test(p.name || '') && (!landsec || p.landlordId === landsec.id))
    || properties.find((p) => /bluewater/i.test(p.name || ''));
  return {
    landsec: landsec?.id || LEGACY.landsec,
    bluewater: bluewater?.id || LEGACY.bluewater,
    brand: brand?.id || LEGACY.brand,
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

async function step(page, persona, scenario, fn) {
  currentScenario[persona] = scenario;
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
    await page.locator('[data-testid="input-deal-target-date"]').fill('2026-12-31');
    await page.locator('[data-testid="button-save-deal"]').click();
    await page.waitForTimeout(1800);
    // Verify via the API, not the deals table — the table is team-filtered
    // (Victoria = National Leasing) and Consultant deals carry no team, so a
    // freshly-created one legitimately won't appear in her filtered view.
    const check = await page.evaluate(async (needle) => {
      const r = await fetch('/api/crm/deals', { headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      if (!r.ok) return { ok: false, status: r.status };
      const deals = await r.json();
      return { ok: true, found: deals.some((d) => (d.name || '').includes(needle)) };
    }, `${stamp} Consultancy`);
    if (!check.ok) throw new Error(`deals API returned ${check.status} after create`);
    if (!check.found) throw new Error('deal saved (toast shown) but absent from /api/crm/deals');
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
      await mob.evaluate(([tok, u]) => {
        localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u));
      }, [await page.evaluate(() => localStorage.getItem('authToken')), await page.evaluate(() => localStorage.getItem('user'))]);
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
      return { ok: true, stillThere: rows.some((c) => c.name === needle) };
    }, name);
    if (!r.ok) throw new Error(`contact lifecycle failed (${r.why})`);
    if (r.stillThere) throw new Error('deleted contact still present in the CRM list');
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
      return { ok: true };
    }, stamp);
    if (!r.ok) throw new Error(`agent could not log a scheme comp (${r.why})`);
    cross.compStamp = stamp;
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
}

async function markRound(page, cross) {
  const p = 'mark';

  // 1. Crawl the client surface
  for (const path of ['/', '/contacts', '/brands', '/comps', '/deals', '/leasing-schedule', '/m/images', '/news', '/tasks']) {
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
  await step(page, p, 'client-comps-readonly', async () => {
    await page.goto(`${BASE}/comps`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const netEff = await page.getByText(/net effective/i).count();
    if (!netEff) throw new Error('Net Effective column missing on client comps');
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
      const served = [...rows(hub.body?.superBrands), ...rows(hub.body?.hotBrands), ...rows(hub.body?.topTurnover), ...rows(hunter.body)];
      const leaks = served.filter((b) => b.id && !visible.has(b.id));
      return { ok: true, leaks: leaks.slice(0, 3) };
    });
    if (!r.ok) throw new Error(`client brand hub/hunter unhealthy (${r.why})`);
    if (r.leaks.length) throw new Error(`brand outside the client's directory leaked into hub/hunter: ${r.leaks.map((b) => `${b.name} (${b.type})`).join(', ')}`);
  });

  // Firm-wide reporting (the board report + reporting summary — whole-book
  // revenue, pipeline, agent performance) is BGP-internal; a client login
  // must be refused.
  await step(page, p, 'client-firm-reporting-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { board: await g('/api/board-report'), reporting: await g('/api/reporting/summary') };
    });
    if (r.board !== 403) throw new Error(`client reached the board report (expected 403, got ${r.board})`);
    if (r.reporting !== 403) throw new Error(`client reached the reporting summary (expected 403, got ${r.reporting})`);
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
      return { list, stats, generate };
    });
    if (r.list !== 403) throw new Error(`client reached the AI leads board (expected 403, got ${r.list})`);
    if (r.stats !== 403) throw new Error(`client reached the leads stats (expected 403, got ${r.stats})`);
    if (r.generate !== 403) throw new Error(`client triggered AI lead generation (expected 403, got ${r.generate})`);
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
      };
    });
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
        external: await g('/api/external-properties'),
        plans: await g('/api/property-plans/in-viewport?bbox=51.49,-0.15,51.51,-0.13'),
      };
    });
    // OS proxies: anything but a gateway 403 — 200 with keys, 502/503 without.
    if (r.osSites === 403 || r.osStatus === 403) throw new Error(`client blocked from OS layers (sites ${r.osSites}, status ${r.osStatus}) — dead allowlist prefix regressed`);
    for (const [k, v] of Object.entries({ pins: r.pins, annotations: r.annotations, external: r.external, plans: r.plans })) {
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
    // And the Letting Tracker UI must render the controls that open them.
    // NB the client's tracker is the Deals-hub tab at /deals/letting —
    // /leasing-schedule is the leasing STRATEGY board (zones/positioning) and
    // /available is staff-only (clients get redirected to the dashboard).
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
      if (!units.ok || !offers.ok || !views.ok) return { ok: false, why: `units ${units.status} / offers ${offers.status} / views ${views.status}` };
      const visible = new Set((Array.isArray(units.body) ? units.body : []).map((u) => u.id));
      const stray = (map) => Object.keys(map || {}).filter((id) => !visible.has(id));
      return { ok: true, visibleCount: visible.size, strayOffers: stray(offers.body), strayViews: stray(views.body) };
    });
    if (!r.ok) throw new Error(`tracker count endpoints failed (${r.why})`);
    if (!r.visibleCount) return; // no units in scope this run — nothing to assert
    if (r.strayOffers.length) throw new Error(`offer-count badge keyed a unit outside client scope: ${r.strayOffers[0]}`);
    if (r.strayViews.length) throw new Error(`viewing-count badge keyed a unit outside client scope: ${r.strayViews[0]}`);
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
      if (!units.ok || !views.ok || !offers.ok) return { ok: false, why: `units ${units.status} / views ${views.status} / offers ${offers.status}` };
      const visible = new Set((Array.isArray(units.body) ? units.body : []).map((u) => u.id));
      const rows = (b) => Array.isArray(b) ? b : (b && Array.isArray(b.data) ? b.data : []);
      const stray = (b) => rows(b).map((x) => x.unit_id || x.unitId).filter((id) => id && !visible.has(id));
      return { ok: true, visibleCount: visible.size, strayViews: stray(views.body), strayOffers: stray(offers.body) };
    });
    if (!r.ok) throw new Error(`tracker record endpoints failed (${r.why})`);
    if (!r.visibleCount) return; // no units in scope this run
    if (r.strayViews.length) throw new Error(`a viewing record for a unit outside client scope leaked: ${r.strayViews[0]}`);
    if (r.strayOffers.length) throw new Error(`an offer record for a unit outside client scope leaked: ${r.strayOffers[0]}`);
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
      return { ok: true, madeId: made.id, outOfScopeStatus: outOfScope.status, delOk: del.ok, delStatus: del.status };
    }, stamp);
    if (r.skip) return;
    if (!r.ok) throw new Error(`client unit create failed (${r.why}) on their own property`);
    if (r.outOfScopeStatus >= 200 && r.outOfScopeStatus < 300) throw new Error('client created a unit on an out-of-scope property');
    if (!r.delOk) throw new Error(`client could not delete their own unit (${r.delStatus})`);
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
    // r263: linking a party on an own-portfolio deal is client-allowed (PUT
    // parity), but the staff-only AML auto-kick must NOT fire for clients
    // (it 403s and the "Running AML checks" toast lies), and the Timeline
    // card must be hidden (its /api/deals/:id/timeline read is gateway-403;
    // clients keep the Audit log).
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
      if (!(await page.locator('[data-testid="toggle-deal-audit"]').count())) {
        throw new Error('client lost the (allowed) deal Audit log card');
      }
      // Link a tenant through the inline picker, then undo. The AML kick is
      // client-side logic, so this must go through the real UI.
      await page.locator('button:has-text("Link tenant")').locator('visible=true').first().click();
      await page.waitForTimeout(600);
      await page.fill('[data-testid="inline-link-search"]', 'Starbucks');
      await page.waitForTimeout(600);
      const opt = page.locator('button[data-testid^="inline-link-option-"]').first();
      if (!(await opt.count())) throw new Error('tenant picker listed no options for "Starbucks"');
      await opt.click();
      await page.waitForTimeout(2000);
      if (kycHits.length) throw new Error(`client party-link fired the staff-only AML kick (${kycHits.length}× /api/kyc/run-all-checks)`);
    } finally {
      page.off('request', onReq);
      // restore the fixture deal whether or not the assertions passed
      await page.evaluate(async (id) => {
        const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
        await fetch(`/api/crm/deals/${id}`, { method: 'PUT', credentials: 'include', headers: auth, body: JSON.stringify({ tenantId: null }) });
      }, deal.id);
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
      await mob.evaluate(([tok, u]) => {
        localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u));
      }, [await page.evaluate(() => localStorage.getItem('authToken')), await page.evaluate(() => localStorage.getItem('user'))]);
      await mob.goto(`${BASE}/deals/${deal.id}`, nav);
      await mob.waitForTimeout(3000);
      if (!(await mob.locator('[data-testid="deal-sidebar-mobile"]').isVisible().catch(() => false))) {
        throw new Error('mobile deal detail lost the sidebar sections (deal-sidebar-mobile not visible at 390px)');
      }
      if (!(await mob.locator('[data-testid="deal-sidebar-mobile"] [data-testid="toggle-sidebar-comments"]').count())) {
        throw new Error('mobile deal sidebar block is missing the Comments section');
      }
    } finally {
      await mob.close();
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
      await mob.evaluate(([tok, u]) => {
        localStorage.setItem('authToken', tok); localStorage.setItem('user', JSON.stringify(u));
      }, [await page.evaluate(() => localStorage.getItem('authToken')), await page.evaluate(() => localStorage.getItem('user'))]);
      await mob.goto(`${BASE}/`, nav);
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
      return { ownOk: own.ok, ownArray, foreign };
    });
    if (!r.ownOk || !r.ownArray) throw new Error("rival client can't read their own team board");
    if (r.foreign !== 403) throw new Error(`rival client read the Landsec team board (expected 403, got ${r.foreign})`);
  });

  // The tracker-row edit endpoints (viewing/offer PATCH + DELETE) must hold
  // the tenant boundary: Sam editing or deleting the viewing/offer Victoria
  // logged on a Landsec unit must be refused. Complements
  // rival-client-write-guards, which only probes the POST side.
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
}

// ─── Run ──────────────────────────────────────────────────────────────────

// Prefer the container's preinstalled chromium (version-stable symlink);
// fall back to playwright's own browser where /opt/pw-browsers is absent.
const QA_CHROMIUM = process.env.QA_CHROMIUM
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const browser = await chromium.launch(QA_CHROMIUM ? { executablePath: QA_CHROMIUM } : {});
const agentCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const clientCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

console.log(`── Round ${ROUND} — Victoria (agent) × Mark (Landsec client) ──`);
const vPage = await login(agentCtx, AGENT_USER);
const FIX = await resolveFixture(vPage.qaToken);
LANDSEC = FIX.landsec; BLUEWATER = FIX.bluewater; BRAND = FIX.brand;
console.log(`  [fixture] landsec=${LANDSEC} bluewater=${BLUEWATER} brand=${BRAND}`);
// Every page in every context reads the resolved IDs as window.QA_FIX
// (init script re-runs on each navigation — every scenario starts with one;
// a direct evaluate here would race the app's auth-hydration navigation).
for (const ctx of [agentCtx, clientCtx]) await ctx.addInitScript((f) => { window.QA_FIX = f; }, FIX);
const mPage = await login(clientCtx, CLIENT_USER);
attachCollectors(vPage, 'victoria');
attachCollectors(mPage, 'mark');

const cross = { dealStamp: null };
await victoriaRound(vPage, cross).catch((e) => logIssue('victoria', 'round', 'harness-crash', e.message));
await markRound(mPage, cross).catch((e) => logIssue('mark', 'round', 'harness-crash', e.message));

// Extended personas — each with its own context so sessions never bleed.
for (const [name, user, fn] of [
  ['woody', ADMIN_USER, woodyRound],
  ['nick', INVESTMENT_USER, nickRound],
  ['sam', RIVAL_CLIENT_USER, samRound],
]) {
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

const byKind = {};
for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
console.log(`\n── Round ${ROUND} complete: ${issues.length} issues ──`);
console.log(JSON.stringify(byKind, null, 2));
