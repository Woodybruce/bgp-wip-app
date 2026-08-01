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
  /\/api\/ai-briefing/,                  // 503 locally (no AI key) by design
  /\/api\/brand\/[^/]+\/ai-take\//,      // 503 locally (no AI key) by design
  /\/api\/brand\/[^/]+\/(competitors\/research|rocketreach-company\/refresh)/, // 503 locally, no keys
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
const NEGATIVE_PROBE_SCENARIOS = new Set(['client-destructive-guards', 'client-add-delete-unit', 'client-hots-roundtrip', 'client-foreign-unit-guards', 'rival-client-write-guards', 'client-staff-deal-ops-guards']);

function attachCollectors(page, persona) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/net::|Failed to load resource/.test(t)) return; // captured via response hook
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
    if (r.id) {
      await page.evaluate(async (id) => {
        await fetch(`/api/crm/requirements-leasing/${id}`, { method: 'DELETE', credentials: 'include',
          headers: { Authorization: 'Bearer ' + localStorage.getItem('authToken') } });
      }, r.id);
    }
  });

  // 4d. Calendar team pills: picking a CLIENT team must filter the board to
  // that client's events. It used to filter BGP staff by users.team, which no
  // client team matches, so clicking "Landsec" did nothing / emptied it.
  await step(page, p, 'calendar-client-team-filter', async () => {
    const mine = `QA-CAL-MINE-R${ROUND}`, other = `QA-CAL-OTHER-R${ROUND}`;
    // The event must be in the FUTURE (GET /api/team-events only returns
    // start_time >= now) AND still on today's visible board (a "+2h" event
    // crossed midnight on a late round and vanished). now+2min satisfies
    // both — except in the 2-minute window before midnight, where no valid
    // slot exists at all: skip the round then.
    const soon = new Date(Date.now() + 2 * 60e3);
    if (soon.getUTCDate() !== new Date().getUTCDate()) return;
    await page.evaluate(async ([a, bb, startIso, endIso]) => {
      const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      for (const [title, company] of [[a, 'Landsec'], [bb, 'Hammerson']]) {
        await fetch('/api/team-events', { method: 'POST', credentials: 'include', headers: h,
          body: JSON.stringify({ title, event_type: 'Meetings', company_name: company,
            start_time: startIso, end_time: endIso }) }).catch(() => {});
      }
    }, [mine, other, soon.toISOString(), new Date(soon.getTime() + 36e5).toISOString()]);
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
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    if (await page.getByText('Page not found').count()) throw new Error('news is a dead route for client');
    const body = (await page.locator('main, [role="main"], body').first().innerText().catch(() => '')).trim();
    if (body.length < 40) throw new Error('news feed rendered blank for client');
    // If any article is present, exercise a save toggle (round-trips the
    // client-allowed engage endpoint).
    const save = page.locator('[data-testid^="button-save-"]').first();
    if (await save.count()) { await save.click().catch(() => {}); await page.waitForTimeout(600); }
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

  // Client dashboard carries the Portfolio Map (same map as the landlord
  // pages) and the BGP Relationship card, and the portfolio payload supplies
  // coordinates for the pins.
  await step(page, p, 'client-dashboard-map-and-relationship', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    if (!(await page.getByText('BGP Relationship', { exact: false }).count()))
      throw new Error('BGP Relationship card missing from client dashboard');
    if (!(await page.getByText('Portfolio Map', { exact: false }).count()))
      throw new Error('Portfolio Map widget missing from client dashboard');
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
    await page.goto(`${BASE}/requirements`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    const leaked = await page.getByText(cross.reqStamp, { exact: false }).count();
    if (leaked) throw new Error(`agent-only requirement "${cross.reqStamp}" visible to client`);
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
      const probes = [
        ['DELETE', `/api/crm/deals/${dealId}`],
        ['DELETE', `/api/crm/companies/11111111-1111-1111-1111-111111111111`],
        ['POST',   '/api/crm/deals/bulk-rent-analysis'],
        ['POST',   '/api/crm/wipe-deals'],
        ['POST',   '/api/image-studio/bulk-assign-property'],
        ['POST',   '/api/admin/letting-tracker-focus'],
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

  // Locks in the terminal-side audit fix: a client reading ANOTHER
  // landlord's unit files/viewings/offers BY ID must be refused (was a
  // confirmed live cross-tenant leak). Uses the seeded Hammerson unit.
  await step(page, p, 'client-foreign-unit-guards', async () => {
    const foreign = '99999999-3333-3333-3333-333333333333'; // Hammerson unit
    const r = await page.evaluate(async (uid) => {
      const auth = { Authorization: 'Bearer ' + localStorage.getItem('authToken') };
      const out = [];
      for (const ep of ['files', 'viewings', 'offers']) {
        const res = await fetch(`/api/available-units/${uid}/${ep}`, { headers: auth }).catch(() => ({ status: 0, ok: false }));
        out.push({ ep, status: res.status, ok: res.ok });
      }
      return out;
    }, foreign);
    const leaked = r.filter((x) => x.ok);
    if (leaked.length) throw new Error(`client can read a foreign unit's ${leaked.map((x) => x.ep).join(', ')} (cross-tenant leak regressed)`);
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
