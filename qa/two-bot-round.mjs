// Two-persona QA harness — "Victoria" (BGP agent) × "Mark Warne" (Landsec client).
//
// Drives two logged-in browser sessions through real workflows at the same
// time, cross-checking that what the agent does shows up (or stays hidden)
// on the client side. Logs every console error, failed request, blank page,
// dead-end and broken flow to qa/logs/ as JSONL + screenshots.
//
// Usage:  node qa/two-bot-round.mjs [roundNumber]
// Server: expects the dev server on http://localhost:5000 with the local
//         fixture DB (Landsec = 11111111-1111-1111-1111-111111111111).

import { chromium } from '../node_modules/playwright/index.mjs';
import { mkdirSync, appendFileSync } from 'fs';

const BASE = 'http://localhost:5000';
const ROUND = parseInt(process.argv[2] || '1', 10);
const LOGDIR = new URL('./logs/', import.meta.url).pathname;
mkdirSync(LOGDIR, { recursive: true });

const LANDSEC = '11111111-1111-1111-1111-111111111111';
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
  /\/api\/activity\/(brand|landlord)\/[^/]+$/, // AI relationship activity is own-company-only for clients (deliberate gateway rule); the client brand-profile panel fires it on slice brands and gets a safe 403. Own-company returns 200; cross-tenant isolation is covered by the rival-* scenarios.
  /\/api\/interactions\//,               // raw correspondence (meetings/emails) is staff-only for clients — the client correspondence drawer fires /api/interactions/company/:id and gets a safe 403. The client-interactions-guard scenario is the authoritative lock that this stays blocked.
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
const NEGATIVE_PROBE_SCENARIOS = new Set(['client-destructive-guards', 'client-add-delete-unit', 'client-hots-roundtrip', 'client-foreign-unit-guards', 'rival-client-write-guards', 'rival-team-board-isolated', 'client-staff-deal-ops-guards', 'client-brand-slice-and-extras', 'client-requirements-write-guards', 'client-contact-scope-guards', 'client-unit-matches', 'client-brand-suggestions-scoped', 'client-brand-suggested-pitches-scoped', 'client-news-write-guards', 'client-contact-edit-not-delete', 'client-requirement-scoping', 'client-password-reset-guard', 'client-commentary-own-property', 'client-plans-board-scoped', 'client-task-assign-guard', 'client-lease-events-guard', 'client-firm-reporting-guard', 'client-interactions-guard', 'client-hunters-guard', 'client-document-briefs-guard', 'client-wip-report-guard', 'client-property-pathway-guard', 'client-chat-delete-own-only', 'client-brand-kyc-visible-actions-blocked', 'client-sharepoint-surface', 'client-nav-guard-consistency']);

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
  return page;
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
  const bodyText = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
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
      await fetch(`/api/crm/deals/${deal.id}`, { method: 'PUT', credentials: 'include', headers: auth,
        body: JSON.stringify({ status: original }) }).catch(() => {});
      const restored = await (await fetch(`/api/crm/deals/${deal.id}`, { headers: auth })).json();
      return { ok: true, moved, restoredStatus: restored?.status, original };
    });
    if (r.skip) return;
    if (!r.ok) throw new Error(`staff stage move rejected (${r.why})`);
    if (!r.moved) throw new Error('stage move returned OK but the deal did not change stage');
    if (r.restoredStatus !== r.original) throw new Error(`fixture deal stuck in UO (restore failed: ${r.restoredStatus})`);
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
        body: JSON.stringify({ name: needle, role: 'Landsec-side probe', companyId: '11111111-1111-1111-1111-111111111111' }) });
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
      const bluewater = '22222222-2222-2222-2222-222222222222';
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
    await page.goto(`${BASE}/`);
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

  // 4j. Staff brand profile renders its main sections without any error
  // boundary tripping (Honi Poke fixture).
  await step(page, p, 'staff-brand-profile-sections', async () => {
    await page.goto(`${BASE}/companies/77777777-7777-7777-7777-777777777777`);
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
      const unit = (Array.isArray(units) ? units : []).find((u) => u.propertyId === '22222222-2222-2222-2222-222222222222') || (Array.isArray(units) ? units[0] : null);
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
  });

  // Agent logs an OFFER on a Landsec unit — the client must then see it on
  // their own letting activity (parity with the viewing cross-check; exercises
  // the client-scoped all-offers read from the agent-write side).
  await step(page, p, 'agent-log-offer', async () => {
    const stamp = `QA-AOFFER-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : []).find((u) => u.propertyId === '22222222-2222-2222-2222-222222222222') || (Array.isArray(units) ? units[0] : null);
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
        body: JSON.stringify({ name: dealName, landlordId: '11111111-1111-1111-1111-111111111111', fee: 456789, feePercentage: 12, commission: 456789 }) });
      if (!create.ok) return { ok: false, why: `create ${create.status}` };
      const made = await create.json().catch(() => ({}));
      return { ok: true, id: made?.id };
    }, name);
    if (!r.ok) throw new Error(`agent could not create a fee-bearing Landsec deal (${r.why})`);
    cross.feeDealName = name;
  });

  // Offer deletion parity: offers have no edit route (create/delete only),
  // so the lifecycle that matters is a deleted offer vanishing everywhere —
  // staff letting activity now, the client's view cross-checked later.
  await step(page, p, 'agent-offer-delete-lifecycle', async () => {
    const stamp = `QA-ODEL-R${ROUND}`;
    const r = await page.evaluate(async (marker) => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const units = await (await fetch('/api/available-units', { headers: auth })).json();
      const unit = (Array.isArray(units) ? units : []).find((u) => u.propertyId === '22222222-2222-2222-2222-222222222222');
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
    // Then flip to Board view (ViewToggle button by accessible name).
    const boardBtn = page.getByRole('button', { name: /board/i }).first();
    if (await boardBtn.count()) { await boardBtn.click().catch(() => {}); await page.waitForTimeout(1200); }
    const cols = await Promise.all(['Negotiating', 'Solicitors', 'Exchanged', 'Completed', 'Invoiced']
      .map(c => page.getByText(c, { exact: false }).count()));
    const shown = cols.filter(n => n > 0).length;
    if (shown < 3) throw new Error(`deal board shows only ${shown}/5 pipeline columns`);
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
  await step(page, p, 'client-task-create-complete', async () => {
    const title = `QA Task R${ROUND}`;
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const add = page.locator('[data-testid="input-add-task"]').first();
    if (!(await add.count())) throw new Error('no quick-add task input');
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
    await page.goto(`${BASE}/properties/22222222-2222-2222-2222-222222222222`);
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
    const panel = page.locator('[data-testid="client-property-folders-panel"]');
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
      const inSliceBrand = '77777777-7777-7777-7777-777777777777';           // Honi Poke (Tenant - Restaurant, in slice)
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
        own: await post('22222222-2222-2222-2222-222222222222'),
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
      const own = await fetch('/api/properties/22222222-2222-2222-2222-222222222222/plans', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownBody = own.ok ? await own.json().catch(() => null) : null;
      const foreign = (await fetch('/api/properties/99999999-2222-2222-2222-222222222222/plans', { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { ownOk: own.ok, ownArray: Array.isArray(ownBody?.plans), foreign };
    });
    if (!r.ownOk || !r.ownArray) throw new Error('client cannot read the Plans board on their own property');
    if (r.foreign !== 403) throw new Error(`client read the Plans board on a foreign property (expected 403, got ${r.foreign})`);
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

  // The interactions surface is BGP's raw correspondence store — logged
  // meetings and synced Outlook emails, per-company and per-contact, plus the
  // BD engagement leaderboards. It's fully staff-only for clients (even their
  // OWN company): a Landsec login only ever sees the curated AI activity
  // summary on their own company, never the underlying meeting/email log or
  // another firm's. All of /api/interactions/* must refuse a client.
  await step(page, p, 'client-interactions-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const g = async (url) => (await fetch(url, { headers: auth }).catch(() => ({ status: 0 }))).status;
      return {
        own: await g('/api/interactions/company/11111111-1111-1111-1111-111111111111'),
        rival: await g('/api/interactions/company/99999999-1111-1111-1111-111111111111'),
        summary: await g('/api/interactions/summary'),
        leaderboard: await g('/api/interactions/leaderboard'),
      };
    });
    if (r.own !== 403) throw new Error(`client read raw correspondence for their own company (expected 403, got ${r.own})`);
    if (r.rival !== 403) throw new Error(`client read a rival's correspondence log (expected 403, got ${r.rival})`);
    if (r.summary !== 403) throw new Error(`client reached the interactions summary (expected 403, got ${r.summary})`);
    if (r.leaderboard !== 403) throw new Error(`client reached the BD engagement leaderboard (expected 403, got ${r.leaderboard})`);
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

  // Document Studio (KYC / PLA / Why-Buy brief generation) is a staff
  // advisory tool — a client login must never list the catalog nor run a
  // brief (would expose BGP's internal document-generation pipeline). Sealed
  // by the server gateway allowlist (document-briefs isn't client-allowed).
  await step(page, p, 'client-document-briefs-guard', async () => {
    const r = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const list = (await fetch('/api/document-briefs', { headers: auth }).catch(() => ({ status: 0 }))).status;
      const run = (await fetch('/api/document-briefs/kyc/run', { method: 'POST', headers: auth, body: JSON.stringify({ propertyId: '22222222-2222-2222-2222-222222222222' }) }).catch(() => ({ status: 0 }))).status;
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
    await page.goto(`${BASE}/`);
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
      const ownCompany = '11111111-1111-1111-1111-111111111111'; // Landsec (client's own)
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
    await page.goto(`${BASE}/companies/77777777-7777-7777-7777-777777777777`); // Honi Poke
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    if (await page.getByText('Page not found').count()) throw new Error('brand profile is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('brand profile rendered blank for client');
  });

  // Suggested-pitches is the brand-profile "which of my vacant units could
  // this operator take" engine (live requirement + AI-ranked available units
  // in the viewer's scope). A client sees it for a brand in their hospitality
  // slice (200 with {brandName, suggestions[]}) but is refused on an
  // out-of-slice brand — the handler's isClientVisibleBrand gate.
  await step(page, p, 'client-brand-suggested-pitches-scoped', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const inSlice = await fetch('/api/brands/77777777-7777-7777-7777-777777777777/suggested-pitches', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
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
      const honi = '77777777-7777-7777-7777-777777777777';      // in the hospitality slice
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

  // Client dashboard carries the Portfolio Map (same map as the landlord
  // pages) and the BGP Relationship card, and the portfolio payload supplies
  // coordinates for the pins.
  await step(page, p, 'client-dashboard-map-and-relationship', async () => {
    await page.goto(`${BASE}/`);
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

  // The unified tenancy schedule's deal/letting link-map on the client's OWN
  // property must load (drives the tenancy view's linked-deal chips). It's
  // scope-checked; the foreign case is covered in client-foreign-unit-guards.
  await step(page, p, 'client-tenancy-links', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const res = await fetch('/api/tenancy-schedule/property/22222222-2222-2222-2222-222222222222/links', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      if (!res.ok) return { ok: false, status: res.status };
      const d = await res.json().catch(() => null);
      return { ok: true, shape: !!d && Array.isArray(d.deals) && Array.isArray(d.lettingUnits) };
    });
    if (!r.ok) throw new Error(`client own tenancy links rejected (${r.status})`);
    if (!r.shape) throw new Error('tenancy links payload missing deals/lettingUnits arrays');
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
    await page.goto(`${BASE}/`);
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
        ['DELETE', `/api/crm/companies/11111111-1111-1111-1111-111111111111`],
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
      return { seen: JSON.stringify(v).includes(marker) };
    }, cross.viewingStamp);
    if (!r.seen) throw new Error("agent-logged viewing not visible on the client's letting activity");
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
    await page.goto(`${BASE}/`);
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
      await mob.goto(`${BASE}/properties/22222222-2222-2222-2222-222222222222`, nav);
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
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('domcontentloaded');
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
    const landsecUnit = await page.evaluate(async () => {
      // Resolve a Landsec unit id via fixture convention (Bluewater unit is
      // seeded as 66666666-… in the fixture deal; fall back to a probe list).
      return null;
    });
    const probes = await page.evaluate(async () => {
      const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      // Any unit belonging to Landsec — fixture Bluewater tracker unit ids are
      // unknown here, so probe through the STAFF-visible id conventions used
      // by the fixture instead: ask our own list first and take a foreign id
      // from the cross-tenant seeded constant.
      const foreign = '85b15bb7-58be-429a-b034-7df637aeb7cd'; // Landsec Bluewater unit (fixture)
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
      const LANDSEC = '11111111-1111-1111-1111-111111111111';
      await tryReq('team-member-add', 'POST', `/api/client-teams/${LANDSEC}/member`, { user_id: '99999999-4444-4444-4444-444444444444', team_group: 'QA-RIVAL' });
      await tryReq('team-column-add', 'POST', `/api/client-teams/${LANDSEC}/columns`, { name: 'QA-RIVAL-COL' });
      await tryReq('team-column-del', 'DELETE', `/api/client-teams/${LANDSEC}/columns/Investment`, null);
      await tryReq('team-reorder', 'POST', `/api/client-teams/${LANDSEC}/reorder`, { items: [{ id: 'x', sort_order: 0 }] });
      return out;
    });
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

  // Cross-tenant team isolation: a rival client (Sam/Hammerson) may read
  // THEIR OWN account team but must be refused the Landsec team board —
  // otherwise one landlord sees another's BGP staff assignments, names,
  // emails and CVs. (The GET route scopes a client to their own company.)
  await step(page, p, 'rival-team-board-isolated', async () => {
    const r = await page.evaluate(async () => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const own = await fetch('/api/client-teams/99999999-1111-1111-1111-111111111111', { headers: auth }).catch(() => ({ ok: false, status: 0 }));
      const ownArray = own.ok ? Array.isArray(await own.json().catch(() => null)) : false;
      const foreign = (await fetch('/api/client-teams/11111111-1111-1111-1111-111111111111', { headers: auth }).catch(() => ({ status: 0 }))).status;
      return { ownOk: own.ok, ownArray, foreign };
    });
    if (!r.ownOk || !r.ownArray) throw new Error("rival client can't read their own team board");
    if (r.foreign !== 403) throw new Error(`rival client read the Landsec team board (expected 403, got ${r.foreign})`);
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const agentCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const clientCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });

console.log(`── Round ${ROUND} — Victoria (agent) × Mark (Landsec client) ──`);
const vPage = await login(agentCtx, AGENT_USER);
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
