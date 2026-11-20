// Woody, 20 November 2026, on a Landsec login's chat ("The separate
// Requirements entry has not been created — that action isn't available in
// this chat"): "Needs to be able to add a requirement", then "Clients should
// be able to do what we can do really". A client login adds and amends a
// requirement from ChatBGP through the page's own routes, as that login (the
// client's fields only, saved as the client's own), and its word confirms as
// BGP staff's does: a new one is confirmed by the person who added it, and
// "still live" (or the same search logged again) is a confirmation through
// the intake, named and never a BGP owner. Never the state or who at BGP
// confirmed a requirement in what it is told. Joint agents stay refused.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, source, ts } = require('./source-harness.cjs');

const { clientLogRequirementFromChat, clientUpdateRequirementFromChat } = await import('../../server/chatbgp-requirements.ts');
const { brandKey, stillLive } = await import('../../server/requirement-intake.ts');
const { CLIENT_REQUIREMENT_FIELDS } = await import('../../shared/requirement-live.ts');

const NOW = new Date('2026-11-20T11:45:00Z');
const USER = { name: 'Alex Client' };
const SOMA = { id: 'c-soma', name: 'Soma' };
const WING_A = { id: 'c-wing-a', name: 'Wingstop' };
const WING_B = { id: 'c-wing-b', name: 'Wingstop' };

function fakeStore({ companies = [SOMA], requirements = [] } = {}) {
  const ref = c => ({ id: c.id, name: c.name, hidden: false, brandType: true });
  return {
    async brandsByIds(ids) { return companies.filter(c => ids.includes(c.id)).map(ref); },
    async brandsForContacts() { return []; },
    async brandsNamedLike(name) {
      const word = brandKey(name).split(' ').sort((a, b) => b.length - a.length)[0] || '';
      return companies.filter(c => c.name.toLowerCase().includes(word)).map(c => ({ ...ref(c), otherNames: [c.name] }));
    },
    async requirementsForCompanies(ids) { return requirements.filter(r => ids.includes(r.company_id)); },
    async requirementById(id) { return requirements.find(r => r.id === id) || null; },
  };
}

function fakeRoute(reply = { ok: true, status: 201, json: { id: 'r-new', name: 'Soma' } }) {
  const calls = [];
  const confirmed = [];
  const route = async (method, path, body) => { calls.push({ method, path, body }); return typeof reply === 'function' ? reply(method, path, body) : reply; };
  const markStillLive = async (id, how) => { confirmed.push([id, how]); };
  return { calls, confirmed, route, markStillLive };
}

const row = (over = {}) => ({
  id: 'r-1', name: 'Soma', company_id: 'c-soma', status: 'Active', origin: 'bgp', sources: null,
  size: null, requirement_locations: ['Clapham'], use: null, comments: 'From the pack.',
  last_confirmed_at: new Date('2026-11-01T10:00:00Z'), last_confirmed_by: 'u-staff', last_confirmed_by_name: 'A Staff Member', confirmed_how: 'call',
  requirement_date: '2026-11-01', created_at: new Date('2026-11-01T10:00:00Z'), updated_at: new Date('2026-11-01T10:00:00Z'), ...over,
});

const NEVER_TELL_A_CLIENT = /\bLive\b|To confirm|confirmed (today|by)|A Staff Member/;

test('a client adds a requirement through the page route, with the client fields only', async () => {
  const { calls, route } = fakeRoute();
  const out = await clientLogRequirementFromChat(fakeStore(), {
    companyName: 'Soma', sizeMin: '1,250 sq ft', sizeMax: '2,000 sq ft', budget: 'up to £50,000 pa',
    locations: ['Clapham', 'Dulwich', 'Balham'], use: ['Wellness'], notes: 'Communal sauna and cold plunge. Three-phase power, showers.', contactName: 'Alfred Grace',
  }, USER, { route, contactAt: async (companyId, name) => (companyId === 'c-soma' && name === 'Alfred Grace' ? 'ct-alfred' : null) }, NOW);
  assert.equal(out.success, true);
  assert.equal(out.action, 'created');
  assert.equal(out.id, 'r-new');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/api/crm/requirements-leasing');
  for (const key of Object.keys(calls[0].body)) assert.ok(CLIENT_REQUIREMENT_FIELDS.includes(key), `${key} is not a client field`);
  assert.equal(calls[0].body.companyId, 'c-soma');
  assert.equal(calls[0].body.principalContactId, 'ct-alfred');
  assert.deepEqual(calls[0].body.size, ['1,250 - 2,000 sq ft']);
  assert.deepEqual(calls[0].body.requirementLocations, ['Clapham', 'Dulwich', 'Balham']);
  assert.match(calls[0].body.comments, /Budget: up to £50,000 pa/);
  assert.doesNotMatch(calls[0].body.comments, /Contact:/);
  assert.match(out.message, /^Logged a requirement for Soma \(1,250 - 2,000 sq ft; Clapham, Dulwich, Balham; Wellness; budget up to £50,000 pa; contact Alfred Grace\)\. It is on the Requirements list/);
  assert.doesNotMatch(out.message, NEVER_TELL_A_CLIENT);
  assert.match(out.url, /requirementId=r-new/);
});

test('a contact who is not one person at the brand goes into the comments by name', async () => {
  const { calls, route } = fakeRoute();
  await clientLogRequirementFromChat(fakeStore(), { companyId: 'c-soma', contactName: 'Alfred Grace' }, USER, { route, contactAt: async () => null }, NOW);
  assert.equal(calls[0].body.principalContactId, undefined);
  assert.match(calls[0].body.comments, /Contact: Alfred Grace/);
});

test('a brand not on the list, or one of two of the same name, saves nothing and says what to do', async () => {
  const none = fakeRoute();
  const missing = await clientLogRequirementFromChat(fakeStore(), { companyName: 'Nowhere Saunas' }, USER, { route: none.route }, NOW);
  assert.equal(missing.success, false);
  assert.equal(missing.brandNotFound, true);
  assert.match(missing.message, /not on the brand list yet, so nothing was saved/);
  assert.match(missing.next, /create_company/);
  assert.equal(none.calls.length, 0);
  const two = fakeRoute();
  const tied = await clientLogRequirementFromChat(fakeStore({ companies: [WING_A, WING_B] }), { companyName: 'Wingstop' }, USER, { route: two.route }, NOW);
  assert.equal(tied.success, false);
  assert.equal(tied.needsBrand, true);
  assert.deepEqual(tied.candidates.map(c => c.id).sort(), ['c-wing-a', 'c-wing-b']);
  assert.equal(two.calls.length, 0);
});

test('the same brand and area is added to and confirmed, never a second row, and blanks only are filled', async () => {
  const { calls, confirmed, route, markStillLive } = fakeRoute({ ok: true, status: 200, json: { id: 'r-1' } });
  const out = await clientLogRequirementFromChat(fakeStore({ requirements: [row()] }), { companyName: 'Soma', locations: ['Clapham'], sizeMin: '1,250 sq ft', sizeMax: '2,000 sq ft', notes: 'Wants outdoor space.', how: 'call' }, USER, { route, markStillLive }, NOW);
  assert.equal(out.action, 'updated');
  assert.equal(out.alreadyExisted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].path, '/api/crm/requirements-leasing/r-1');
  assert.deepEqual(calls[0].body.size, ['1,250 - 2,000 sq ft']);
  assert.equal(calls[0].body.requirementLocations, undefined, 'the saved area is not rewritten');
  assert.match(calls[0].body.comments, /^From the pack\.\n\n\[20 Nov 2026, Alex Client via ChatBGP\] /);
  // As for BGP staff, logging the same search again confirms it.
  assert.deepEqual(confirmed, [['r-1', 'call']]);
  assert.match(out.message, /recorded as still live today/);
  assert.doesNotMatch(out.message, NEVER_TELL_A_CLIENT);
  assert.equal(out.state, undefined);
  // Nothing new to add (no brief at all) still confirms it, with no edit.
  const again = fakeRoute({ ok: true, status: 200, json: { id: 'r-1' } });
  const same = await clientLogRequirementFromChat(fakeStore({ requirements: [row()] }), { companyName: 'Soma', how: 'press' }, USER, { route: again.route, markStillLive: again.markStillLive }, NOW);
  assert.equal(same.success, true);
  assert.equal(again.calls.length, 0);
  assert.deepEqual(again.confirmed, [['r-1', null]], 'press is never a client\'s way of knowing');
});

test('a confirmation that is refused is said, and what was saved stays saved', async () => {
  const { calls, route } = fakeRoute({ ok: true, status: 200, json: { id: 'r-1' } });
  const markStillLive = async () => { throw new Error('That requirement is closed.'); };
  const out = await clientUpdateRequirementFromChat(fakeStore({ requirements: [row()] }), { id: 'r-1', notes: 'Viewed Brixton.', stillLive: true }, USER, { route, markStillLive }, NOW);
  assert.equal(out.success, true);
  assert.equal(calls.length, 1);
  assert.match(out.message, /could not be recorded as still live: That requirement is closed\./);
});

test('another area asks first and lists the open requirements without their state', async () => {
  const { calls, route } = fakeRoute();
  const out = await clientLogRequirementFromChat(fakeStore({ requirements: [row()] }), { companyName: 'Soma', locations: ['Brockley'] }, USER, { route }, NOW);
  assert.equal(out.success, false);
  assert.equal(out.needsChoice, true);
  assert.equal(calls.length, 0);
  assert.doesNotMatch(out.message, NEVER_TELL_A_CLIENT);
  for (const e of out.existing) {
    assert.equal(e.state, undefined);
    assert.equal(e.howKnown, undefined);
    assert.match(e.listed, /requirement/);
  }
  const again = await clientLogRequirementFromChat(fakeStore({ requirements: [row()] }), { companyName: 'Soma', locations: ['Brockley'], newSearch: true }, USER, { route }, NOW);
  assert.equal(again.action, 'created');
  assert.equal(calls.at(-1).method, 'POST');
});

test("the page route's refusal is passed on, and investment requirements are refused", async () => {
  const { route } = fakeRoute({ ok: false, status: 403, json: { error: 'Choose the brand from your brand list' } });
  const out = await clientLogRequirementFromChat(fakeStore(), { companyId: 'c-soma' }, USER, { route }, NOW);
  assert.equal(out.success, false);
  assert.equal(out.message, 'Choose the brand from your brand list. Nothing was saved.');
  const investment = await clientLogRequirementFromChat(fakeStore(), { companyName: 'Soma', category: 'Investment' }, USER, { route }, NOW);
  assert.equal(investment.success, false);
  assert.match(investment.message, /Investment/);
});

test('a client changes a requirement through the page route, and its word that it is still live confirms it', async () => {
  const { calls, confirmed, route, markStillLive } = fakeRoute({ ok: true, status: 200, json: { id: 'r-1' } });
  const store = fakeStore({ requirements: [row({ size: ['1,000 sq ft'] })] });
  const out = await clientUpdateRequirementFromChat(store, { id: 'r-1', status: 'active', stillLive: true, how: 'meeting', notes: 'Moving to south London only.', use: ['Wellness'] }, USER, { route, markStillLive }, NOW);
  assert.equal(out.success, true);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].path, '/api/crm/requirements-leasing/r-1');
  for (const key of Object.keys(calls[0].body)) assert.ok(CLIENT_REQUIREMENT_FIELDS.includes(key), `${key} is not a client field`);
  assert.deepEqual(calls[0].body.use, ['Wellness']);
  assert.doesNotMatch(calls[0].body.comments, /still live/);
  assert.deepEqual(confirmed, [['r-1', 'meeting']]);
  assert.match(out.message, /recorded as still live today/);
  // "Still live" on its own confirms without an edit.
  const only = fakeRoute({ ok: true, status: 200, json: { id: 'r-1' } });
  const word = await clientUpdateRequirementFromChat(store, { id: 'r-1', stillLive: true }, USER, { route: only.route, markStillLive: only.markStillLive }, NOW);
  assert.equal(word.success, true);
  assert.equal(only.calls.length, 0);
  assert.deepEqual(only.confirmed, [['r-1', null]]);
  const withdrawn = await clientUpdateRequirementFromChat(store, { id: 'r-1', status: 'withdrawn' }, USER, { route }, NOW);
  assert.equal(calls.at(-1).body.status, 'Archived');
  assert.equal(withdrawn.success, true);
  const replace = await clientUpdateRequirementFromChat(store, { id: 'r-1', sizeMin: '2,000 sq ft' }, USER, { route }, NOW);
  assert.equal(replace.success, false);
  assert.equal(replace.needsConfirmation.length, 1);
  const replaced = await clientUpdateRequirementFromChat(store, { id: 'r-1', sizeMin: '2,000 sq ft', replaceSaved: true }, USER, { route }, NOW);
  assert.equal(replaced.success, true);
  assert.deepEqual(calls.at(-1).body.size, ['From 2,000 sq ft']);
  assert.equal((await clientUpdateRequirementFromChat(store, { id: 'r-nope', notes: 'x' }, USER, { route }, NOW)).success, false);
});

test('a client confirming a requirement is recorded by name and never made its BGP owner', async () => {
  const owned = row({ id: 'r-owned', bgp_contact_user_id: 'u-staff', bgp_contact_user_ids: ['u-staff'] });
  const ownerless = row({ id: 'r-free', bgp_contact_user_id: null, bgp_contact_user_ids: null, last_confirmed_at: null, last_confirmed_by: null, last_confirmed_by_name: null });
  const rows = [owned, ownerless];
  const evidence = [];
  const store = {
    async requirementById(id) { return rows.find(r => r.id === id) || null; },
    async updateRequirement(id, patch) { const r = rows.find(x => x.id === id); Object.assign(r, patch); return r; },
    async insertEvidence(values) { evidence.push(values); return { id: `e${evidence.length}`, ...values }; },
  };
  const client = { id: 'u-client', name: 'Alex Client', client: true };
  const free = await stillLive(store, 'r-free', client, 'meeting', NOW);
  assert.deepEqual([free.last_confirmed_by, free.last_confirmed_by_name, free.confirmed_how], ['u-client', 'Alex Client', 'meeting']);
  assert.deepEqual([free.bgp_contact_user_id, free.bgp_contact_user_ids], [null, null], 'a client is never a BGP owner');
  const kept = await stillLive(store, 'r-owned', client, null, NOW);
  assert.deepEqual(kept.bgp_contact_user_ids, ['u-staff']);
  assert.ok(evidence.every(e => e.created_by_user_id === 'u-client' && e.created_by_name === 'Alex Client'));
  // A BGP person confirming an ownerless row still becomes its owner.
  const staffRow = row({ id: 'r-staff', bgp_contact_user_id: null, bgp_contact_user_ids: null });
  rows.push(staffRow);
  const staff = await stillLive(store, 'r-staff', { id: 'u-staff', name: 'A Staff Member' }, null, NOW);
  assert.deepEqual(staff.bgp_contact_user_ids, ['u-staff']);
});

test('the client path writes fields only through the page routes, and confirms only through stillLive as a client', () => {
  const clientWrites = ['clientLogRequirementFromChat', 'clientUpdateRequirementFromChat']
    .map(name => find('server/chatbgp-requirements.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === name)).join('\n');
  assert.doesNotMatch(clientWrites, /\bconfirm\(|\bstillLive\(|\bsuggest\(|insertRequirement|updateRequirement\(/);
  const runner = find('server/chatbgp-requirements.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'runClientRequirementTool');
  assert.doesNotMatch(runner, /\bconfirm\(|\bsuggest\(|insertRequirement|updateRequirement\(/);
  assert.match(runner, /stillLive\(pgIntakeStore\(db\), requirementId, \{ id: String\(user\.id\), name: who\.name, client: true \}, how\)/);
  assert.match(runner, /requirementViewer\(req\) === "joint_agent"/);
  assert.match(runner, /callOwnRoute\(req, method, path, body\)/);
  const chat = source('server/chatbgp.ts');
  assert.match(chat, /runChatRequirementTool\(fnName, fnArgs, req, \{ callOwnRoute \}\)/);
  const blocked = find('server/chatbgp.ts', (n, ast) => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'CLIENT_BLOCKED_TOOLS');
  assert.doesNotMatch(blocked, /"create_requirement"|"update_requirement"/);
  // A joint agent's ChatBGP is an allow-list that never names them.
  assert.doesNotMatch(source('server/chatbgp-joint-agent.ts'), /create_requirement|update_requirement/);
  // The client prompt says what it may do, and its search finds requirements as the client reads them.
  assert.match(chat, /You can add a brand's leasing requirement to the Requirements list/);
  const search = find('server/chatbgp.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'clientScopedCrmSearch');
  assert.match(search, /results\.requirements/);
  assert.match(search, /requirementReason\(r\)\.clientText/);
  assert.doesNotMatch(search, /last_confirmed_by_name AS|stateLabel/);
});
