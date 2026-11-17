// What client logins are sent of BGP's leasing requirements. Since 17
// November 2026 every requirement is open to a client login, to read, add and
// amend (Woody: "keep all requirements open for clients and access to amend
// and add"; CLAUDE.md "Requirements centre"). What stays BGP's own is the
// state, who confirmed a requirement and when, and any order a confirmation
// moves. Each test runs the real function cut out of its source. The fake
// database checks the SQL it is sent, then answers by the same rule in JS
// (requirementLive).
//   node --import tsx --test qa/regression/requirement-client-leaks.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { currentOfficialProfileEvidence } from '../../server/brand-profile-evidence.ts';
import { BRAND_BRIEF_POLICY_VERSION, BRAND_BRIEF_EVIDENCE_RULES, brandActionEvidence, brandBriefWithoutEvidence, landlordBriefFromRecords } from '../../server/brand-brief-evidence.ts';
import { PRIVATE_MAIL_POLICY_VERSION } from '../../shared/private-mail.ts';
import { isBrandSignalRelevant } from '../../server/brand-news-relevance.ts';
import { rankCompanyHeroImages } from '../../shared/brand-image-selection.ts';
import { publishableBrandImage } from '../../server/brand-publishing.ts';
import { clientBrandAnalysis } from '../../shared/tenant-categories.ts';
import { requirementReason, requirementStateSql, requirementLiveColumnsSql, requirementLive } from '../../shared/requirement-live.ts';
const require = createRequire(import.meta.url);
const { find, route, evaluate, ts } = require('./source-harness.cjs');

const TAKE = 'server/brand-ai-take.ts';
const PACK = 'server/brand-pack.ts';
const VIEWINGS = 'server/leasing-viewings.ts';
const fn = (file, name) => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const constant = (file, name) => find(file, (node, ast) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === name));
const requirementBindings = { requirementReason, requirementStateSql, requirementLiveColumnsSql };
const squash = s => s.replace(/\s+/g, ' ');
const ago = days => new Date(Date.now() - days * 86400000).toISOString();

const cook = () => ({ id: 'cook', name: 'COOK', company_type: 'Tenant - Food', description: 'Frozen ready-meal retailer', industry: 'Food retail', domain: 'cookfood.net',
  ai_generated_fields: { brand_identity: { status: 'verified', domain: 'cookfood.net', aliases: ['COOK Trading Ltd'] } } });

// The brand's requirement rows as the database holds them.
const REQUIREMENTS = [
  // BGP's own, hand-entered, confirmed this week by a named person.
  { id: 'bgp-own', company_id: 'cook', name: 'Bristol requirement', status: 'Active', origin: 'bgp', sources: ['Manual'], use: ['Retail'], size: ['2,000 sq ft'],
    requirement_locations: ['Bristol'], agent_contact_id: 'agent-bgp', requirement_date: '2026-11-01', created_at: ago(30), updated_at: ago(4),
    last_confirmed_at: ago(4), last_confirmed_by: 'u-emily', last_confirmed_by_name: 'Emily Hart', confirmed_how: 'call' },
  // A PIPnet listing BGP confirmed yesterday (live): the confirmation moved updated_at.
  { id: 'pipnet-confirmed', company_id: 'cook', name: 'Leeds listing', status: 'Active', origin: 'pipnet', sources: ['PIPnet'], use: ['Retail'], size: ['1,000 sq ft'],
    requirement_locations: ['Leeds'], agent_contact_id: 'agent-confirmed', last_listed_at: '2026-09-03T00:00:00Z', last_listed_source: 'PIPnet',
    created_at: '2026-09-03T00:00:00Z', updated_at: ago(1), last_confirmed_at: ago(1), last_confirmed_by: 'u-harry', last_confirmed_by_name: 'Harry Vale', confirmed_how: 'still_live' },
  // A PIPnet listing nobody at BGP has confirmed (background by the live rule), listed more recently.
  { id: 'pipnet-listed', company_id: 'cook', name: 'York listing', status: 'Active', origin: 'pipnet', sources: ['PIPnet'], use: ['Retail'], size: ['1,200 sq ft'],
    requirement_locations: ['York'], agent_contact_id: 'agent-listed', last_listed_at: '2026-10-10T00:00:00Z', last_listed_source: 'PIPnet',
    created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' },
  // A PIPnet listing since archived.
  { id: 'pipnet-closed', company_id: 'cook', name: 'Hull listing', status: 'Archived', origin: 'pipnet', sources: ['PIPnet'], use: ['Retail'], size: ['900 sq ft'],
    requirement_locations: ['Hull'], agent_contact_id: 'agent-closed', last_listed_at: '2026-08-01T00:00:00Z', last_listed_source: 'PIPnet',
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
];
const byId = id => REQUIREMENTS.find(r => r.id === id);
const listedAt = r => Date.parse(r.last_listed_at || r.created_at);
const STATE_RANK = { live: 0, to_confirm: 1, background: 2, closed: 3 };
// Who confirmed one, and the state, are BGP's own wherever a requirement goes.
const WHO_OR_STATE = /Emily|Harry|still_live|last_confirmed|confirmed_how|Active in CRM|record_updated_at|"state"/;

// ── 1. The BGP take: one saved text, read by client logins too ────────────

// What openRequirements' SELECT returns: every open requirement, live first.
function openRequirementRows(sql, values) {
  assert.ok(sql.includes(`WHERE r.company_id = $1 AND ${requirementStateSql('r')} <> 'closed'`), 'every requirement that is not closed');
  assert.doesNotMatch(sql, /'active'|PIPnet/i, 'never "any Active row", never the old PIPnet cut');
  return REQUIREMENTS.filter(r => r.company_id === values[0] && requirementLive(r).state !== 'closed')
    .sort((a, b) => STATE_RANK[requirementLive(a).state] - STATE_RANK[requirementLive(b).state]).slice(0, values[1]);
}

test('the BGP take (brand tab) is given every open requirement, each worded by the live rule, and never who confirmed it', async () => {
  const { loadBrandSlice } = evaluate(`${fn(TAKE, 'openRequirements')}\n${fn(TAKE, 'loadBrandSlice')}\nexports.loadBrandSlice = loadBrandSlice;`, {
    ...requirementBindings, brandActionEvidence, bgpDealEvidence: deal => ({ property: deal.name }), relationshipEvidence: async () => null,
    pool: { query: async (sql, values) => {
      if (sql.includes('FROM crm_requirements_leasing')) return { rows: openRequirementRows(sql, values) };
      if (sql.includes('FROM crm_companies')) return { rows: [cook()] };
      return { rows: [] };
    } },
  });
  const slice = await loadBrandSlice('cook');
  // BGP's own requirement is there now, live first; the closed listing is not.
  assert.deepEqual(Array.from(slice.requirements, l => l.name), ['Bristol requirement', 'Leeds listing', 'York listing']);
  assert.deepEqual(Array.from(slice.requirements, l => l.requirement), ['bgp-own', 'pipnet-confirmed', 'pipnet-listed'].map(id => requirementReason(byId(id)).text));
  assert.match(slice.requirements[0].requirement, /^requirement confirmed /);
  assert.match(slice.requirements[2].requirement, /^PIPnet listing from Oct, not confirmed$/);
  assert.equal(slice.active_requirements.length, 0, 'brandActionEvidence is given no requirement rows');
  assert.equal('market_listings' in slice, false);
  assert.doesNotMatch(JSON.stringify(slice), WHO_OR_STATE);
  assert.doesNotMatch(JSON.stringify(slice), /Hull/);

  const { brandPrompt } = evaluate(`${fn(TAKE, 'brandPrompt')}\nexports.brandPrompt = brandPrompt;`, { BRAND_BRIEF_EVIDENCE_RULES });
  const prompt = brandPrompt(slice);
  assert.match(prompt, /"requirement": "requirement confirmed /);
  assert.match(prompt, /call it confirmed only when its line says confirmed, never call one live/);
  assert.match(prompt, /Never say who at BGP confirmed or logged a requirement/);
  assert.doesNotMatch(prompt, /BGP's own requirement records are not supplied|never say whether BGP holds a requirement/);
  assert.doesNotMatch(prompt, WHO_OR_STATE);
});

test('the BGP take (activity tab) is given every open requirement, and its prompt words them by their lines', async () => {
  const { loadActivitySlice } = evaluate(`${fn(TAKE, 'openRequirements')}\n${fn(TAKE, 'loadActivitySlice')}\nexports.loadActivitySlice = loadActivitySlice;`, {
    ...requirementBindings,
    pool: { query: async (sql, values) => {
      if (sql.includes('FROM crm_requirements_leasing')) return { rows: openRequirementRows(sql, values) };
      if (sql.includes('FROM crm_interactions')) return { rows: [{ total: 0, last_at: null, last_90d: 0 }] };
      if (sql.includes('FROM crm_companies WHERE id')) return { rows: [{ name: 'COOK', company_type: 'Tenant - Food', domain: null, domain_url: null }] };
      return { rows: [] };
    } },
  });
  const slice = await loadActivitySlice('cook');
  assert.deepEqual(Array.from(slice.requirements, l => l.name), ['Bristol requirement', 'Leeds listing', 'York listing']);
  assert.equal('active_requirements' in slice, false);
  assert.equal('market_listings' in slice, false);
  assert.doesNotMatch(JSON.stringify(slice), WHO_OR_STATE);

  const { activityPrompt } = evaluate(`${fn(TAKE, 'activityPrompt')}\nexports.activityPrompt = activityPrompt;`, { BRAND_BRIEF_EVIDENCE_RULES });
  const prompt = activityPrompt(slice);
  assert.match(prompt, /requirements — each with what it is and its date in "requirement"\), attributed with that line: call one confirmed only when its line says confirmed, never live, and never say who at BGP confirmed or logged one/);
  assert.doesNotMatch(prompt, WHO_OR_STATE);
});

test('a take saved before the morning of 17 November is not served again on the brand and activity tabs; the uk and intel takes stay', async () => {
  const company = cook();
  // Every take was saved under this version until 17 November 2026; the version kept since names fewer requirements, never more.
  const before = `${BRAND_BRIEF_POLICY_VERSION}:${PRIVATE_MAIL_POLICY_VERSION}`;
  let saved;
  const { readPreparedBrandAiTake } = evaluate(`${fn(TAKE, 'preparedTakePolicyVersion')}\n${fn(TAKE, 'readPreparedBrandAiTake')}\nexports.readPreparedBrandAiTake = readPreparedBrandAiTake;`, {
    getBrandIdentity, currentOfficialProfileEvidence, BRAND_BRIEF_POLICY_VERSION, PRIVATE_MAIL_POLICY_VERSION, takeKey: (id, tab) => `brand-prepared-take:${id}:${tab}`,
    pool: { query: async sql => ({ rows: sql.includes('crm_companies') ? [company] : [{ value: saved }] }) },
  });
  for (const tab of ['brand', 'activity', 'uk', 'intel']) {
    saved = { text: `Saved ${tab} take: CRM requirement dated 1 Nov, 2,000 sq ft in Bristol`, policyVersion: before,
      fingerprint: getBrandIdentity(company).fingerprint, generatedAt: 1, expiresAt: Date.now() + 10000 };
    const read = await readPreparedBrandAiTake('cook', tab);
    if (tab === 'brand' || tab === 'activity') {
      assert.equal(read.text, '', `the old ${tab} take is not served`);
      assert.equal(read.pending, true);
    } else assert.equal(read.text, saved.text, `the ${tab} take read no requirement rows and stays`);
  }
});

test('a brand with only an open requirement still gets a model take; with no evidence at all it gets the plain unknown', async () => {
  const company = { ...cook(), brief_revision: 'revision' };
  const run = async slice => {
    let calls = 0; const written = [];
    const { prepareBrandAiTake } = evaluate(`${fn(TAKE, 'preparedTakePolicyVersion')}\n${fn(TAKE, 'prepareBrandAiTake')}\nexports.prepareBrandAiTake = prepareBrandAiTake;`, {
      getBrandIdentity, currentOfficialProfileEvidence, BRAND_BRIEF_POLICY_VERSION, PRIVATE_MAIL_POLICY_VERSION, CACHE_TTL_MS: 86400000,
      brandBriefWithoutEvidence, landlordBriefFromRecords, takeKey: () => 'brand-prepared-take:cook:brand', dataHash: () => 'hash',
      loadBrandSlice: async () => slice, brandPrompt: () => 'prompt',
      callClaude: async () => { calls++; return 'Model take on the requirement'; },
      pool: { query: async sql => ({ rows: sql.includes('crm_companies') ? [company] : [] }),
        connect: async () => ({ query: async (sql, values) => {
          if (sql.startsWith('SELECT')) return { rows: [company] };
          if (sql.includes('INSERT')) written.push(JSON.parse(values[1]));
          return { rowCount: 1 };
        }, release() {} }) },
    });
    return { result: await prepareBrandAiTake('cook', 'brand'), calls, written };
  };
  const evidence = brandActionEvidence(company, [], []);
  const held = await run({ ...evidence, requirements: [{ requirement: 'BGP requirement dated 4 Aug, not confirmed', name: 'York', uses: [], sizes: [], locations: ['York'] }] });
  assert.equal(held.calls, 1);
  assert.equal(held.result.text, 'Model take on the requirement');
  // The cache policy version is kept as it was (17 November 2026).
  assert.equal(held.written[0].policyVersion, `${BRAND_BRIEF_POLICY_VERSION}:market-listings-1:${PRIVATE_MAIL_POLICY_VERSION}`);
  const none = await run({ ...evidence, requirements: [] });
  assert.equal(none.calls, 0);
  assert.match(none.result.text, /strategy is unconfirmed/);
});

// ── 2. The Brand Pack: a client's requirements in an order that says nothing ──

const CLIENT_ORDER = 'ORDER BY coalesce(r.last_listed_at, r.created_at) DESC NULLS LAST LIMIT 3';
const STAFF_ORDER = `ORDER BY (${requirementStateSql('r')} = 'live') DESC, r.updated_at DESC NULLS LAST LIMIT 3`;
function packRows(sql) {
  const order = sql.slice(sql.lastIndexOf('ORDER BY'));
  assert.doesNotMatch(sql, /PIPnet/, 'the old client cut is gone');
  const clientWhere = sql.includes(`AND ${requirementStateSql('r')} <> 'closed'`);
  const rows = REQUIREMENTS.filter(r => clientWhere ? requirementLive(r).state !== 'closed' : ['live', 'to_confirm'].includes(requirementLive(r).state));
  if (order === CLIENT_ORDER) rows.sort((a, b) => listedAt(b) - listedAt(a));
  else if (order === STAFF_ORDER) rows.sort((a, b) => (requirementLive(b).state === 'live') - (requirementLive(a).state === 'live') || Date.parse(b.updated_at) - Date.parse(a.updated_at));
  else assert.fail(`unexpected order: ${order}`);
  return rows.slice(0, 3);
}

test('a client\'s Brand Pack lists every open requirement by listing or added date, never live first; staff keep live first', async () => {
  const queries = [];
  const { loadBrandPackData } = evaluate(`${fn(PACK, 'loadBrandPackData')}\nexports.loadBrandPackData = loadBrandPackData;`, {
    isBrandSignalRelevant, rankCompanyHeroImages, publishableBrandImage, clientBrandAnalysis, ...requirementBindings,
    require: () => ({ readPreparedBrandAiTake: async () => ({ text: '' }) }),
    pool: { query: async sql => {
      queries.push(sql);
      if (sql.includes('FROM crm_requirements_leasing')) return { rows: packRows(sql) };
      if (sql.includes('FROM crm_companies WHERE')) return { rows: [cook()] };
      return { rows: [] };
    } },
  });
  const requirementSql = () => queries.find(sql => sql.includes('FROM crm_requirements_leasing'));

  const client = await loadBrandPackData('cook', true, null, 'landlord-1', true);
  assert.equal(requirementSql().slice(requirementSql().lastIndexOf('ORDER BY')), CLIENT_ORDER);
  // BGP's hand-entered requirement is a client's now; the listing BGP confirmed yesterday is not put first.
  assert.deepEqual(Array.from(client.requirements, r => r.name), ['Bristol requirement', 'York listing', 'Leeds listing']);
  assert.deepEqual(Array.from(client.requirements, r => r.reason), ['requirement dated 1 Nov', 'PIPnet listing from Oct', 'PIPnet listing from Sep']);
  assert.doesNotMatch(JSON.stringify(client.requirements), /confirm/i, 'a client is never told whether, or when, BGP confirmed one');

  queries.length = 0;
  const staff = await loadBrandPackData('cook');
  assert.equal(requirementSql().slice(requirementSql().lastIndexOf('ORDER BY')), STAFF_ORDER);
  assert.deepEqual(Array.from(staff.requirements, r => r.name), ['Leeds listing', 'Bristol requirement']);
});

// ── 3. The viewing form: agents, the save check and the requirement picker ─

// What agentRequirementSql must say: the one live rule for BGP staff (scope
// NULL); for a client, every requirement that is not closed, never cut by the
// live state (which would tell it which ones BGP has confirmed).
const AGENT_SQL = p => `(CASE WHEN ${p}::varchar IS NULL THEN ${requirementStateSql('r')} IN ('live', 'to_confirm') ELSE ${requirementStateSql('r')} <> 'closed' END)`;
const agentRequirement = (r, scope) => scope == null
  ? ['live', 'to_confirm'].includes(requirementLive(r).state)
  : requirementLive(r).state !== 'closed';
const CONTACTS = [
  { id: 'brand-person', name: 'Brand Person', email: null, company_id: 'cook' },
  { id: 'agent-bgp', name: 'Agent on BGP\'s own requirement', email: null, company_id: 'agency' },
  { id: 'agent-confirmed', name: 'Agent on a confirmed listing', email: null, company_id: 'agency' },
  { id: 'agent-listed', name: 'Agent on an unconfirmed listing', email: null, company_id: 'agency' },
  { id: 'agent-closed', name: 'Agent on a closed listing', email: null, company_id: 'agency' },
  { id: 'agent-rep', name: 'Tenant rep', email: null, company_id: 'agency' },
  { id: 'stranger', name: 'Unrelated contact', email: null, company_id: 'elsewhere' },
];
const REPRESENTATIONS = [{ contact_id: 'agent-rep', brand_id: 'cook' }];
const agentSqlSource = constant(VIEWINGS, 'agentRequirementSql');

function viewingDb() {
  const seen = [];
  return { seen, query: async (sql, params = []) => {
    seen.push({ sql, params });
    if (sql.includes('FROM crm_companies WHERE company_type')) return { rows: [{ id: 'cook', name: 'COOK' }] };
    if (sql.includes('FROM crm_contacts ct')) {
      assert.ok(squash(sql).includes(squash(AGENT_SQL('$3'))), 'the contacts list goes by the shared agent test');
      const [all, brandIds, scope] = params;
      return { rows: CONTACTS.filter(c => all || brandIds.includes(c.company_id)
        || REPRESENTATIONS.some(rep => rep.contact_id === c.id && brandIds.includes(rep.brand_id))
        || REQUIREMENTS.some(r => r.agent_contact_id === c.id && brandIds.includes(r.company_id) && agentRequirement(r, scope))) };
    }
    if (sql.includes('UNION SELECT r.agent_contact_id,r.company_id')) {
      assert.ok(squash(sql).includes(squash(AGENT_SQL('$2'))), 'the represented brands go by the shared agent test');
      const [brandIds, scope] = params;
      return { rows: [...REPRESENTATIONS.filter(rep => brandIds.includes(rep.brand_id)),
        ...REQUIREMENTS.filter(r => brandIds.includes(r.company_id) && agentRequirement(r, scope)).map(r => ({ contact_id: r.agent_contact_id, brand_id: r.company_id }))] };
    }
    if (sql.includes('SELECT r.id,r.name,r.company_id FROM crm_requirements_leasing r')) {
      assert.ok(sql.includes(`AND ${requirementStateSql('r')} <> 'closed'`), 'no closed requirement is offered');
      assert.doesNotMatch(sql, /PIPnet|\$2/, 'every open requirement of the brands, for staff and clients alike');
      const [brandIds] = params;
      return { rows: REQUIREMENTS.filter(r => brandIds.includes(r.company_id) && requirementLive(r).state !== 'closed').map(r => ({ id: r.id, name: r.name, company_id: r.company_id })) };
    }
    return { rows: [] };
  } };
}

async function viewingOptions(viewer) {
  let handler;
  const db = viewingDb();
  evaluate(`${agentSqlSource}\n${constant(VIEWINGS, 'toCamel')}\n${route(VIEWINGS, 'get', '/api/leasing-viewings/options')}`, {
    app: { get: (path, ...callbacks) => { handler = callbacks.at(-1); } }, requireAuth: () => {}, handle: body => body,
    viewingScope: async () => viewer, pool: db, scopeSql: 'TRUE', scopeParams: () => [],
    clientBrandSliceSql: async () => 'TRUE', getClientVisibleUserIds: async () => new Set(), jointAgentPeople: async () => [], isLandsecCompany: async () => true,
    requirementStateSql,
  });
  const options = await handler({});
  return { options, db, represents: Object.fromEntries(options.contacts.map(c => [c.id, Array.from(c.representedBrandIds)])) };
}

test('a client login\'s viewing form offers agents through every open requirement, whatever BGP has confirmed', async () => {
  const { options, db, represents } = await viewingOptions({ companyId: 'landlord-1', propertyIds: null, jointAgent: false });
  assert.deepEqual(represents['agent-bgp'], ['cook'], 'BGP\'s own requirement names its agent to a client too');
  assert.equal('agent-closed' in represents, false, 'never one known only from a closed listing');
  assert.deepEqual(represents['agent-listed'], ['cook'], 'an unconfirmed listing still names its agent: the offer never turns on the live state');
  assert.deepEqual(represents['agent-confirmed'], ['cook']);
  assert.deepEqual(represents['agent-rep'], ['cook']);
  assert.ok('brand-person' in represents);
  assert.equal('stranger' in represents, false);
  assert.equal(db.seen.find(q => q.sql.includes('FROM crm_contacts ct')).params[2], 'landlord-1');
  assert.deepEqual(Array.from(options.requirements, r => r.id).sort(), ['bgp-own', 'pipnet-confirmed', 'pipnet-listed']);
});

test('a joint agent\'s viewing form offers no CRM contact or requirement', async () => {
  const { options } = await viewingOptions({ companyId: 'landsec', propertyIds: new Set(['p1']), jointAgent: true });
  assert.deepEqual([Array.from(options.contacts), Array.from(options.requirements)], [[], []]);
});

test('BGP staff keep every contact; the brands an agent represents and the requirement picker follow the one live rule', async () => {
  const { options, db, represents } = await viewingOptions({ companyId: null, propertyIds: null, jointAgent: false });
  assert.equal(options.contacts.length, CONTACTS.length, 'staff are offered every contact, as before');
  assert.deepEqual(represents['agent-bgp'], ['cook'], 'a live BGP requirement names its agent for staff');
  assert.deepEqual(represents['agent-confirmed'], ['cook']);
  assert.deepEqual(represents['agent-listed'], [], 'an unconfirmed listing is background by the live rule, whatever its status says');
  assert.deepEqual(represents['agent-closed'], []);
  assert.equal(db.seen.find(q => q.sql.includes('FROM crm_contacts ct')).params[2], null);
  assert.deepEqual(Array.from(options.requirements, r => r.id).sort(), ['bgp-own', 'pipnet-confirmed', 'pipnet-listed'], 'every requirement but the closed one');
});

test('a client\'s save accepts exactly the agents its form offers', async () => {
  class ViewingError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const { validateLinks } = evaluate(`${agentSqlSource}\n${fn(VIEWINGS, 'validateLinks')}\nexports.validateLinks = validateLinks;`, {
    requirementStateSql, ViewingError,
    scopeOf: s => s && typeof s === 'object' ? s : { companyId: s || null, propertyIds: null, jointAgent: false },
    assertViewingUnit: async () => null, isClientVisibleBrand: async () => true, getClientVisibleUserIds: async () => new Set(), jointAgentPeople: async () => [],
  });
  const db = { query: async (sql, params) => {
    if (sql.includes('FROM crm_companies')) return { rows: [{ id: 'cook', name: 'COOK', company_type: 'Tenant - Food' }] };
    if (sql.startsWith('SELECT id FROM crm_contacts')) return { rows: [{ id: params[0] }] };
    if (sql.includes('FROM brand_agent_representations ar')) {
      assert.ok(squash(sql).includes(squash(AGENT_SQL('$3'))), 'the save check goes by the shared agent test');
      const [brand, agent, scope] = params;
      assert.equal(scope, 'landlord-1');
      const eligible = REPRESENTATIONS.some(rep => rep.brand_id === brand && rep.contact_id === agent)
        || REQUIREMENTS.some(r => r.company_id === brand && r.agent_contact_id === agent && agentRequirement(r, scope));
      return { rows: eligible ? [{ eligible: 1 }] : [] };
    }
    if (sql.includes('FROM crm_requirements_leasing r WHERE r.id=$1')) {
      assert.doesNotMatch(sql, /PIPnet|client_visible/);
      return { rows: REQUIREMENTS.filter(r => r.id === params[0]).map(r => ({ company_id: r.company_id })) };
    }
    return { rows: [] };
  } };
  const viewer = { companyId: 'landlord-1', propertyIds: null, jointAgent: false };
  const save = agentContactId => validateLinks(db, { unitId: 'unit-1', companyId: 'cook', agentContactId }, viewer);
  for (const agent of ['agent-listed', 'agent-confirmed', 'agent-rep', 'agent-bgp']) await save(agent);
  await assert.rejects(save('agent-closed'), e => e.status === 403 && /Choose an agent linked to this brand/.test(e.message));
  // A client may link any requirement of the viewing brand, BGP's own included.
  await validateLinks(db, { unitId: 'unit-1', companyId: 'cook', requirementId: 'bgp-own' }, viewer);
  await assert.rejects(validateLinks(db, { unitId: 'unit-1', companyId: 'other', requirementId: 'bgp-own' }, viewer), e => e.status === 400);
});

test('a viewing tells a client the linked requirement\'s name, never a joint agent', () => {
  const { projectViewing } = evaluate(`${fn(VIEWINGS, 'serializeViewingForScope')}\n${fn(VIEWINGS, 'projectViewing')}\nexports.projectViewing = projectViewing;`, {
    toCamel: row => ({ ...row }), viewingTypedContact: () => false, viewingMissingDetails: () => [], createHash: require('node:crypto').createHash,
  });
  const row = { id: 'v1', requirementId: 'bgp-own', requirementName: 'Bristol requirement', detailsConfirmedAt: '2026-11-01' };
  assert.equal(projectViewing(row, true, false).requirementName, 'Bristol requirement');
  assert.equal(projectViewing(row, true, true).requirementName, null);
  assert.equal(projectViewing(row, true, true).requirementId, null);
});
