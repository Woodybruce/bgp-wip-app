// The Landlord CRM and the Brand CRM are two views of the same planning
// records (docs/brand-crm-spec-2026-11-12.md, 2.2 and 2.6).
//
// The first test needs no database. The second runs the real SQL in a
// throwaway schema and is skipped unless CRM_ENGAGEMENT_DATABASE_URL names a
// local PostgreSQL database, for example:
//   CRM_ENGAGEMENT_DATABASE_URL=postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres \
//     node --import tsx --test qa/regression/crm-engagement-kind.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { CRM_ENGAGEMENT_MIGRATIONS, createCrmEngagementRouter, clientPlanView } from '../../server/crm-engagement.ts';
import { crmEngagementLink } from '../../shared/landlord-engagement-view.ts';

test('a landlord plan links to the CRM page and a brand plan to the Brand CRM; the client view is unchanged', () => {
  assert.equal(crmEngagementLink('landsec'), '/contacts?tab=overview&company=landsec');
  assert.equal(crmEngagementLink('landsec', { action: 'a1' }, 'landlord'), '/contacts?tab=overview&company=landsec&action=a1');
  assert.equal(crmEngagementLink('wingstop', undefined, 'brand'), '/brands?tab=crm&view=strategies&company=wingstop');
  assert.equal(crmEngagementLink('wingstop', { event: 'x/y' }, 'brand'), '/brands?tab=crm&view=strategies&company=wingstop&event=x%2Fy');
  const action = id => ({ id, title: id, notes: 'note', dueAt: null, status: 'todo', ownerId: 'owner', ownerName: 'Owner', companyId: 'wingstop', companyName: 'Wingstop', strategyId: 's', eventId: 'e', source: null });
  const view = clientPlanView({ strategies: [{ id: 's' }], events: [{ id: 'e' }], actions: [action('own'), action('bgp')] }, new Set(['own']));
  assert.deepEqual(view.strategies, []); assert.deepEqual(view.events, []);
  assert.deepEqual(view.actions.map(a => [a.id, a.strategyId, a.eventId]), [['own', null, null]]);
});

test('a client is given an action BGP shared with its company as title, date, owner, status and place only; nobody else is', () => {
  const action = (id, extra = {}) => ({ id, title: 'Title ' + id, notes: 'BGP note about the fee', dueAt: '2026-12-01T09:00:00.000Z', status: 'todo', canEdit: true, ownerId: 'owner', ownerName: 'Owner',
    companyId: 'wingstop', companyName: 'Wingstop', strategyId: 's', eventId: 'e', source: null, propertyId: null, schemeName: null, tenancyUnitId: null, unitLabel: null,
    sharedWithCompanyId: null, sharedWithName: null, waitingOnParty: null, waitingSince: null, raisedBy: 'bgp', ...extra });
  const placed = { propertyId: 'p-blue', schemeName: 'Bluewater', tenancyUnitId: 'u-1', unitLabel: 'Unit L104' };
  const data = { strategies: [{ id: 's' }], events: [{ id: 'e' }], actions: [
    action('own', { raisedBy: 'client', ...placed, waitingOnParty: 'BGP', waitingSince: '2026-11-12T09:00:00.000Z', sharedWithCompanyId: 'hammerson', sharedWithName: 'Hammerson' }),
    action('private', placed),
    action('shared', { ...placed, sharedWithCompanyId: 'landsec', sharedWithName: 'Landsec', waitingOnParty: 'Landsec asset manager', waitingSince: '2026-11-12T09:00:00.000Z' }),
    action('shared-unplaced', { sharedWithCompanyId: 'landsec', sharedWithName: 'Landsec' }),
    action('shared-elsewhere', { propertyId: 'p-other', schemeName: 'Another landlord\'s centre', sharedWithCompanyId: 'landsec', sharedWithName: 'Landsec' }),
    action('shared-hammerson', { ...placed, sharedWithCompanyId: 'hammerson', sharedWithName: 'Hammerson' }),
    action('client-typed', { ...placed, raisedBy: 'client', sharedWithCompanyId: 'landsec', sharedWithName: 'Landsec' }),
  ] };
  const landsec = { companyId: 'landsec', properties: new Set(['p-blue']), ownSchemesOnly: false };
  // No share rule given: the view is what it always was.
  assert.deepEqual(clientPlanView(data, new Set(['own'])).actions.map(a => a.id), ['own']);
  const full = clientPlanView(data, new Set(['own']), landsec);
  assert.deepEqual(full.strategies, []); assert.deepEqual(full.events, []);
  assert.deepEqual(full.actions.map(a => a.id), ['own', 'shared', 'shared-unplaced', 'shared-elsewhere']);
  // The client's own request carries nothing BGP added to it.
  assert.deepEqual(Object.keys(full.actions[0]).sort(), ['canEdit', 'companyId', 'companyName', 'dueAt', 'eventId', 'id', 'notes', 'ownerId', 'ownerName', 'source', 'status', 'strategyId', 'title']);
  assert.deepEqual(full.actions[1], { id: 'shared', title: 'Title shared', notes: null, dueAt: '2026-12-01T09:00:00.000Z', status: 'todo', canEdit: false, ownerId: '', ownerName: 'Owner',
    companyId: 'wingstop', companyName: 'Wingstop', strategyId: null, eventId: null, source: null, schemeName: 'Bluewater', unitLabel: 'Unit L104', raisedBy: 'bgp' });
  // A place outside the client's schemes is not named.
  assert.deepEqual([full.actions[3].schemeName, full.actions[3].unitLabel], [null, null]);
  const sent = JSON.stringify(full.actions.slice(1));
  for (const secret of ['fee', 'Landsec asset manager', 'p-blue', 'u-1', 'landsec', 'Hammerson', '"owner"']) assert.ok(!sent.includes(secret), secret);
  // A login held to named schemes (a joint agent; an asset manager was one until 13 November 2026): only what sits at one of its own schemes.
  assert.deepEqual(clientPlanView(data, new Set(), { ...landsec, ownSchemesOnly: true }).actions.map(a => a.id), ['shared']);
  assert.deepEqual(clientPlanView(data, new Set(), { companyId: 'landsec', properties: new Set(['p-west']), ownSchemesOnly: true }).actions, []);
  // Another client, and a client whose schemes could not be read, get none of them.
  assert.deepEqual(clientPlanView(data, new Set(), { companyId: 'british-land', properties: new Set(['p-blue']), ownSchemesOnly: false }).actions, []);
  assert.deepEqual(clientPlanView(data, new Set(), { companyId: 'landsec', properties: new Set(), ownSchemesOnly: true }).actions, []);
});

const databaseUrl = process.env.CRM_ENGAGEMENT_DATABASE_URL;
const skip = !databaseUrl ? 'set CRM_ENGAGEMENT_DATABASE_URL to a local PostgreSQL database to run the SQL checks'
  : !/@(localhost|127\.0\.0\.1)[:/]|host=%2F|@%2F/.test(databaseUrl) ? 'CRM_ENGAGEMENT_DATABASE_URL must be a local database' : false;

test('CRM planning splits into a landlord view and a brand view without losing or mixing records', { skip }, async t => {
  const schema = 'crm_engagement_kind_' + randomUUID().replaceAll('-', '');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  let server;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`); await pool.query(`SET search_path TO ${schema},public`);
    await pool.query(`
      CREATE TABLE users(id varchar PRIMARY KEY,name text,email text,role text,is_active boolean,client_view_mode boolean,team text);
      CREATE TABLE crm_companies(id varchar PRIMARY KEY,name text,company_type text,merged_into_id varchar,archived_at timestamp,domain text,domain_url text);
      CREATE TABLE crm_contacts(id varchar PRIMARY KEY,name text,company_id varchar,email text,role text);
      CREATE TABLE crm_deals(id varchar,landlord_id varchar,status text);
      CREATE TABLE crm_properties(id varchar,name text,freeholder_id varchar,long_leaseholder_id varchar,asset_manager_id varchar);
      CREATE TABLE tenancy_schedule_units(id varchar PRIMARY KEY,property_id varchar,premises text,unit_number text);
      CREATE TABLE crm_interviews(id varchar PRIMARY KEY,team text,interviewee text,meeting_date date,updated_at timestamp DEFAULT now(),responses jsonb);
      CREATE TABLE marketing_campaigns(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),name text,objective text,team text,lead_user_id varchar,status text,created_at timestamp DEFAULT now());
      CREATE TABLE marketing_events(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),title text,kind text,starts_at timestamp,ends_at timestamp,location text,description text,lead_user_id varchar,status text,external_url text,attendee_user_ids text[],attendee_contact_ids text[],created_by_user_id varchar,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
      CREATE TABLE user_tasks(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),user_id varchar,title text,description text,due_date timestamp,status text,category text,created_at timestamp DEFAULT now(),completed_at timestamp);
      INSERT INTO users VALUES
        ('owner','Owner','owner@brucegillinghampollard.com','Staff',true,false,'Leasing'),
        ('colleague','Colleague','colleague@brucegillinghampollard.com','Staff',true,false,'Leasing'),
        ('ls-user','Landsec login','leasing@landsec.example','Client',true,false,'Landsec'),
        ('ham-user','Hammerson login','leasing@hammerson.example','Client',true,false,'Hammerson');
      INSERT INTO crm_companies(id,name,company_type) VALUES
        ('landsec','Landsec','Landlord'),('aew','AEW','Investor'),
        ('wingstop','Wingstop','Tenant - Restaurant'),('flatiron','Flat Iron','Tenant - Restaurant'),('yochi','Yo Chi','Tenant - Cafe');
      INSERT INTO crm_contacts VALUES
        ('jon','Jon','landsec','jon@landsec.example','Leasing'),('manish','Manish','aew','manish@aew.example','Investment'),
        ('wing-contact','Wing contact','wingstop','property@wingstop.example','Property'),
        ('flat-contact','Flat contact','flatiron','property@flatiron.example','Property');
    `);
    for (const sql of CRM_ENGAGEMENT_MIGRATIONS) await pool.query(sql);
    // Records as they stood before the split: one of each kind, one linking
    // both, and one linking no company at all.
    await pool.query(`
      INSERT INTO marketing_campaigns(id,name,objective,status,lead_user_id,created_at) VALUES
        ('s-landlord','Landlord strategy','Win the instruction','active','owner','2026-11-01'),
        ('s-brand','Brand strategy','Place the brand','active','owner','2026-11-02'),
        ('s-mixed','Mixed strategy','Older record','active','owner','2026-11-03'),
        ('s-unlinked','Unlinked strategy','No company yet','active','owner','2026-11-04');
      INSERT INTO crm_strategy_targets(strategy_id,company_id,reason,contact_ids) VALUES
        ('s-landlord','landsec','Leasing instruction','{jon}'),('s-brand','wingstop','Rollout','{wing-contact}'),
        ('s-mixed','landsec','Landlord side of the old record','{jon}'),('s-mixed','wingstop','Brand side of the old record','{wing-contact}');
      INSERT INTO marketing_events(id,title,status,starts_at,date_confirmed) VALUES
        ('e-landlord','Landlord breakfast','planned','2026-12-01T09:00:00',true),
        ('e-brand','Brand store tour','planned','2026-12-02T09:00:00',true),
        ('e-mixed','Mixed dinner','planned','2026-12-03T09:00:00',true),
        ('e-unlinked','Industry event','planned','2026-12-04T09:00:00',true);
      INSERT INTO crm_event_companies(event_id,company_id,reason) VALUES
        ('e-landlord','landsec','Leasing brief'),('e-brand','wingstop','Show the new format'),
        ('e-mixed','aew','Landlord side'),('e-mixed','flatiron','Brand side');
      INSERT INTO crm_event_guests(event_id,contact_id,status) VALUES
        ('e-landlord','jon','invited'),('e-brand','wing-contact','invited'),('e-mixed','manish','accepted'),('e-mixed','flat-contact','accepted');
      INSERT INTO crm_event_strategies(event_id,strategy_id) VALUES ('e-mixed','s-landlord'),('e-mixed','s-brand'),('e-mixed','s-mixed');
      INSERT INTO user_tasks(id,user_id,title,description,status,category,assigned_by_user_id,assigned_by_name) VALUES
        ('a-landlord','owner','Call the landlord','BGP note','todo','crm','owner','Owner'),
        ('a-brand','owner','Call the brand','BGP note','todo','crm','owner','Owner'),
        ('a-client','owner','Landsec asks for an update','Client note','todo','crm','ls-user','Landsec login');
      INSERT INTO crm_engagement_actions(task_id,company_id) VALUES ('a-landlord','landsec'),('a-brand','wingstop'),('a-client','wingstop');
    `);
    const app = express(); app.use(express.json());
    app.use('/api/crm/engagement', createCrmEngagementRouter({ pool,
      requireAuth: (req, _res, next) => { req.tokenUserId = req.headers['x-user']; next(); },
      resolveScope: async req => req.headers['x-scope'] || null,
      isClientVisibleBrand: async companyId => companyId === 'wingstop',
      companyIdForClientTeam: async team => ({ Landsec: 'landsec', Hammerson: 'hammerson' })[team] || null,
      // Landsec is the one client an action can be shown to; Bluewater has a duplicate property record.
      sharePartners: async () => [{ id: 'landsec', name: 'Landsec', schemes: [
        { key: 'bluewater', name: 'Bluewater', propertyId: 'p-blue', propertyIds: ['p-blue', 'p-blue-2'] },
        { key: 'westgate', name: 'Westgate Oxford', propertyId: 'p-west', propertyIds: ['p-west'] },
        { key: 'no-record', name: 'Scheme with no property', propertyId: null, propertyIds: [] }] }],
      viewerSchemeKeys: async req => req.headers['x-schemes'] === undefined ? null : String(req.headers['x-schemes']).split(',').filter(Boolean) }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/crm/engagement`;
    const request = async (method, path = '', body, user = 'owner', scope = null, headers = {}) => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': user, ...(scope ? { 'x-scope': scope } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const ids = rows => rows.map(row => row.id).sort();
    const companyIds = rows => rows.map(row => row.companyId).sort();
    const count = async table => (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    const strategy = (targets, extra = {}) => ({ name: 'New strategy', objective: 'Objective', team: null, ownerId: 'owner', status: 'active', startsOn: null, endsOn: null, targets, ...extra });
    const event = (companies, extra = {}) => ({ title: 'New event', kind: 'bgp', startsAt: null, endsAt: null, location: null, description: null, ownerId: 'owner', status: 'draft', sourceUrl: null, dateConfirmed: false, outcome: null, strategyIds: [], companies, guests: [], ...extra });
    const target = (companyId, contactIds = []) => ({ companyId, reason: 'Why ' + companyId, contactIds });
    const link = companyId => ({ companyId, reason: 'Why ' + companyId });

    await t.test('with no kind the answers are what they were: everything, or one company\'s whole plan', async () => {
      const all = (await request('GET')).body;
      assert.deepEqual(ids(all.strategies), ['s-brand', 's-landlord', 's-mixed', 's-unlinked']);
      assert.deepEqual(ids(all.events), ['e-brand', 'e-landlord', 'e-mixed', 'e-unlinked']);
      assert.deepEqual(ids(all.actions), ['a-brand', 'a-client', 'a-landlord']);
      const brandPage = await request('GET', '?companyId=wingstop');
      assert.equal(brandPage.status, 200);
      assert.deepEqual(ids(brandPage.body.strategies), ['s-brand', 's-mixed']);
      assert.deepEqual(companyIds(brandPage.body.strategies.find(s => s.id === 's-mixed').targets), ['landsec', 'wingstop'], 'a company page still shows every company on its records');
      assert.deepEqual(ids(brandPage.body.actions), ['a-brand', 'a-client']);
      for (const kind of ['landlord', 'brand']) assert.deepEqual((await request('GET', `?companyId=wingstop&kind=${kind}`)).body, brandPage.body, 'kind is ignored when a company is named');
      const landlordPage = (await request('GET', '?companyId=landsec')).body;
      assert.deepEqual(ids(landlordPage.strategies), ['s-landlord', 's-mixed']);
      assert.deepEqual((await request('GET', '?companyId=landsec&kind=brand')).body, landlordPage);
      const flatPage = (await request('GET', '?companyId=flatiron')).body;
      const mixedEvent = flatPage.events.find(e => e.id === 'e-mixed');
      assert.deepEqual(companyIds(mixedEvent.companies), ['aew', 'flatiron']);
      assert.deepEqual(mixedEvent.strategyIds.sort(), ['s-brand', 's-landlord', 's-mixed']);
      const options = (await request('GET', '/options')).body;
      assert.deepEqual(ids(options.companies), ['aew', 'flatiron', 'landsec', 'wingstop'], 'landlords plus the brands already on a plan');
      assert.deepEqual(ids((await request('GET', '/options?companyId=yochi')).body.companies), ['aew', 'flatiron', 'landsec', 'wingstop', 'yochi']);
      assert.equal((await request('GET', '?kind=tenants')).status, 400);
    });

    await t.test('the client branch is unchanged and ignores kind', async () => {
      for (const query of ['?companyId=wingstop', '?companyId=wingstop&kind=landlord', '?companyId=wingstop&kind=brand', '?companyId=wingstop&kind=nonsense']) {
        const own = await request('GET', query, null, 'ls-user', 'landsec');
        assert.equal(own.status, 200);
        assert.deepEqual(own.body.strategies, []); assert.deepEqual(own.body.events, []);
        assert.deepEqual(ids(own.body.actions), ['a-client'], 'only the actions its own company raised');
        assert.deepEqual((await request('GET', query, null, 'ham-user', 'hammerson')).body, { strategies: [], events: [], actions: [] }, 'another client never sees them');
      }
      const options = await request('GET', '/options?companyId=wingstop&kind=landlord', null, 'ls-user', 'landsec');
      assert.deepEqual(ids(options.body.companies), ['wingstop']); assert.deepEqual(options.body.contacts, []);
      assert.equal((await request('GET', '?kind=brand', null, 'ls-user', 'landsec')).status, 403);
      assert.equal((await request('GET', '?companyId=landsec&kind=brand', null, 'ls-user', 'landsec')).status, 403);
      assert.equal((await request('POST', '/strategies?kind=brand', strategy([target('wingstop')]), 'ls-user', 'landsec')).status, 403);
      assert.equal((await request('POST', '/events?kind=brand', event([link('wingstop')]), 'ls-user', 'landsec')).status, 403);
    });

    await t.test('the landlord view keeps unlinked records and every non-brand action; brand-only records are absent', async () => {
      const view = (await request('GET', '?kind=landlord')).body;
      assert.deepEqual(ids(view.strategies), ['s-landlord', 's-mixed', 's-unlinked']);
      assert.deepEqual(ids(view.events), ['e-landlord', 'e-mixed', 'e-unlinked']);
      assert.deepEqual(ids(view.actions), ['a-landlord']);
      assert.deepEqual(companyIds(view.strategies.find(s => s.id === 's-mixed').targets), ['landsec'], 'a mixed strategy shows only its landlords');
      const mixed = view.events.find(e => e.id === 'e-mixed');
      assert.deepEqual(companyIds(mixed.companies), ['aew']);
      assert.deepEqual(mixed.guests.map(g => g.contactId), ['manish']);
      assert.deepEqual(mixed.strategyIds.sort(), ['s-landlord', 's-mixed'], 'no link to a strategy this view does not show');
      assert.ok(!JSON.stringify(view).includes('wingstop') && !JSON.stringify(view).includes('flatiron'), 'no brand reaches the Landlord CRM');
      const options = (await request('GET', '/options?kind=landlord')).body;
      assert.deepEqual(ids(options.companies), ['aew', 'landsec']); assert.deepEqual(ids(options.contacts), ['jon', 'manish']);
      assert.deepEqual(ids((await request('GET', '/options?kind=landlord&companyId=yochi')).body.companies), ['aew', 'landsec']);
    });

    await t.test('the brand view holds brand records only, and a mixed record shows only its brands', async () => {
      const view = (await request('GET', '?kind=brand')).body;
      assert.deepEqual(ids(view.strategies), ['s-brand', 's-mixed']);
      assert.deepEqual(ids(view.events), ['e-brand', 'e-mixed']);
      assert.deepEqual(ids(view.actions), ['a-brand', 'a-client']);
      assert.deepEqual(companyIds(view.strategies.find(s => s.id === 's-mixed').targets), ['wingstop']);
      const mixed = view.events.find(e => e.id === 'e-mixed');
      assert.deepEqual(companyIds(mixed.companies), ['flatiron']);
      assert.deepEqual(mixed.guests.map(g => g.contactId), ['flat-contact']);
      assert.deepEqual(mixed.strategyIds.sort(), ['s-brand', 's-mixed']);
      assert.ok(!JSON.stringify(view).includes('landsec') && !JSON.stringify(view).includes('aew'), 'no landlord reaches the Brand CRM');
      const options = (await request('GET', '/options?kind=brand')).body;
      assert.deepEqual(ids(options.companies), ['flatiron', 'wingstop'], 'the brands already on a plan, not the directory');
      assert.deepEqual(ids(options.contacts), ['flat-contact', 'wing-contact']);
      assert.deepEqual(ids((await request('GET', '/options?kind=brand&companyId=yochi')).body.companies), ['flatiron', 'wingstop', 'yochi'], 'a brand picked by search joins the list');
    });

    await t.test('a new strategy or event is all brands or all landlords, and a brand one names a brand', async () => {
      const before = [await count('marketing_campaigns'), await count('marketing_events'), await count('crm_strategy_targets'), await count('crm_event_companies')];
      const refused = [
        ['POST', '/strategies', strategy([target('landsec'), target('wingstop')])],
        ['POST', '/strategies?kind=landlord', strategy([target('wingstop')])],
        ['POST', '/strategies?kind=brand', strategy([target('landsec'), target('wingstop')])],
        ['POST', '/strategies?kind=brand', strategy([target('aew')])],
        ['POST', '/strategies?kind=brand', strategy([])],
        ['POST', '/events', event([link('landsec'), link('flatiron')])],
        ['POST', '/events?kind=brand', event([link('landsec'), link('flatiron')])],
        ['POST', '/events?kind=brand', event([])],
        // An event links strategies from its own view only.
        ['POST', '/events?kind=brand', event([link('wingstop')], { strategyIds: ['s-landlord'] })],
        ['POST', '/events?kind=landlord', event([link('landsec')], { strategyIds: ['s-brand'] })],
        // A contact belongs to a company on the record.
        ['POST', '/strategies?kind=brand', strategy([target('wingstop', ['jon'])])],
        ['POST', '/events?kind=brand', event([link('wingstop')], { guests: [{ contactId: 'manish', status: 'suggested' }] })],
      ];
      for (const [method, path, body] of refused) assert.equal((await request(method, path, body)).status, 400, `${method} ${path} ${JSON.stringify(body.targets || body.companies)}`);
      // An edit cannot pull a record into the other view either.
      assert.equal((await request('PUT', '/strategies/s-brand?kind=landlord', strategy([target('landsec')]))).status, 404);
      assert.equal((await request('PUT', '/strategies/s-landlord?kind=brand', strategy([target('wingstop')]))).status, 404);
      assert.equal((await request('PUT', '/strategies/s-unlinked?kind=brand', strategy([target('wingstop')]))).status, 404);
      assert.equal((await request('PUT', '/events/e-brand', event([link('landsec')]))).status, 404);
      assert.equal((await request('PUT', '/events/e-landlord?kind=brand', event([link('wingstop')]))).status, 404);
      assert.deepEqual([await count('marketing_campaigns'), await count('marketing_events'), await count('crm_strategy_targets'), await count('crm_event_companies')], before, 'a refused save writes nothing');
      assert.match((await request('POST', '/strategies', strategy([target('landsec'), target('wingstop')]))).body.error, /landlords only.*Brand CRM/);
      assert.match((await request('POST', '/strategies?kind=brand', strategy([{ companyId: 'wingstop', reason: '', contactIds: [] }]))).body.error, /linking this brand/);
      assert.match((await request('POST', '/strategies', strategy([{ companyId: 'landsec', reason: '', contactIds: [] }]))).body.error, /linking this landlord/);
      // The Landlord CRM may still hold a strategy or event with no company.
      const unlinkedStrategy = await request('POST', '/strategies', strategy([]));
      const unlinkedEvent = await request('POST', '/events?kind=landlord', event([]));
      assert.equal(unlinkedStrategy.status, 200); assert.equal(unlinkedEvent.status, 200);
      const brandStrategy = await request('POST', '/strategies?kind=brand', strategy([target('flatiron', ['flat-contact']), target('yochi')]));
      const brandEvent = await request('POST', '/events?kind=brand', event([link('yochi')], { strategyIds: [brandStrategy.body.id, 's-mixed'] }));
      assert.equal(brandStrategy.status, 200); assert.equal(brandEvent.status, 200);
      const landlordView = (await request('GET', '?kind=landlord')).body, brandView = (await request('GET', '?kind=brand')).body;
      assert.ok(ids(landlordView.strategies).includes(unlinkedStrategy.body.id) && ids(landlordView.events).includes(unlinkedEvent.body.id));
      assert.ok(!ids(landlordView.strategies).includes(brandStrategy.body.id) && !ids(landlordView.events).includes(brandEvent.body.id));
      assert.ok(ids(brandView.strategies).includes(brandStrategy.body.id) && ids(brandView.events).includes(brandEvent.body.id));
      assert.ok(!ids(brandView.strategies).includes(unlinkedStrategy.body.id) && !ids(brandView.events).includes(unlinkedEvent.body.id));
    });

    await t.test('saving a mixed record from one view leaves the other kind\'s targets, guests and strategy links intact', async () => {
      const targets = async () => Object.fromEntries((await pool.query("SELECT company_id,reason FROM crm_strategy_targets WHERE strategy_id='s-mixed'")).rows.map(row => [row.company_id, row.reason]));
      const column = async (table, col) => (await pool.query(`SELECT ${col} v FROM ${table} WHERE event_id='e-mixed' ORDER BY 1`)).rows.map(row => row.v);

      // Brand CRM edits the brand side of the mixed strategy.
      assert.equal((await request('PUT', '/strategies/s-mixed?kind=brand', strategy([{ companyId: 'wingstop', reason: 'Revised brand reason', contactIds: [] }, target('flatiron')], { name: 'Mixed strategy' }))).status, 200);
      assert.deepEqual(await targets(), { landsec: 'Landlord side of the old record', wingstop: 'Revised brand reason', flatiron: 'Why flatiron' });
      assert.deepEqual((await pool.query("SELECT contact_ids FROM crm_strategy_targets WHERE strategy_id='s-mixed' AND company_id='landsec'")).rows[0].contact_ids, ['jon']);
      // A landlord cannot be added from the Brand CRM, nor a brand from the Landlord CRM.
      assert.equal((await request('PUT', '/strategies/s-mixed?kind=brand', strategy([target('wingstop'), target('aew')]))).status, 400);
      assert.equal((await request('PUT', '/strategies/s-mixed', strategy([target('landsec'), target('yochi')]))).status, 400);
      assert.equal((await request('PUT', '/strategies/s-mixed?kind=brand', strategy([]))).status, 400, 'the brand side cannot be emptied from the Brand CRM');
      // Landlord CRM swaps its landlord; the brands stay.
      assert.equal((await request('PUT', '/strategies/s-mixed?kind=landlord', strategy([target('aew')], { name: 'Mixed strategy' }))).status, 200);
      assert.deepEqual(await targets(), { aew: 'Why aew', wingstop: 'Revised brand reason', flatiron: 'Why flatiron' });

      // Landlord CRM edits the mixed event: drops its guest and one strategy link.
      assert.equal((await request('PUT', '/events/e-mixed?kind=landlord', event([link('aew'), link('landsec')], { title: 'Mixed dinner', strategyIds: ['s-landlord'] }))).status, 200);
      assert.deepEqual(await column('crm_event_companies', 'company_id'), ['aew', 'flatiron', 'landsec']);
      assert.deepEqual(await column('crm_event_guests', 'contact_id'), ['flat-contact'], 'the brand guest stays; the landlord guest was removed');
      assert.deepEqual(await column('crm_event_strategies', 'strategy_id'), ['s-brand', 's-landlord'], 's-brand is not the landlord view\'s to remove; s-mixed was');
      // Brand CRM edits it: changes its guest and links, the landlord side stays.
      assert.equal((await request('PUT', '/events/e-mixed?kind=brand', event([link('flatiron'), link('wingstop')], { title: 'Mixed dinner', strategyIds: ['s-mixed'], guests: [{ contactId: 'wing-contact', status: 'invited' }] }))).status, 200);
      assert.deepEqual(await column('crm_event_companies', 'company_id'), ['aew', 'flatiron', 'landsec', 'wingstop']);
      assert.deepEqual(await column('crm_event_guests', 'contact_id'), ['wing-contact']);
      assert.deepEqual(await column('crm_event_strategies', 'strategy_id'), ['s-landlord', 's-mixed']);
      assert.equal((await request('PUT', '/events/e-mixed?kind=landlord', event([link('aew')], { title: 'Mixed dinner', strategyIds: ['s-mixed'], guests: [{ contactId: 'manish', status: 'invited' }] }))).status, 200);
      assert.deepEqual(await column('crm_event_companies', 'company_id'), ['aew', 'flatiron', 'wingstop']);
      assert.deepEqual(await column('crm_event_guests', 'contact_id'), ['manish', 'wing-contact']);
      assert.deepEqual(await column('crm_event_strategies', 'strategy_id'), ['s-mixed'], 's-mixed is on both views, so each form holds the link and keeps it');
      // Legacy Marketing attendee ids follow only the guests this view changed.
      assert.deepEqual((await pool.query("SELECT attendee_contact_ids v FROM marketing_events WHERE id='e-mixed'")).rows[0].v.sort(), ['manish', 'wing-contact']);
    });

    await t.test('an action follows its company: brand actions never reach the Landlord CRM', async () => {
      const action = { title: 'Send the brand pack', notes: null, dueAt: '2026-12-10T12:00:00Z', status: 'todo', ownerId: 'owner', companyId: 'yochi', strategyId: null, eventId: null };
      const saved = await request('POST', '/actions', action);
      assert.equal(saved.status, 200);
      assert.ok(ids((await request('GET', '?kind=brand')).body.actions).includes(saved.body.id));
      assert.ok(!ids((await request('GET', '?kind=landlord')).body.actions).includes(saved.body.id));
      assert.match((await request('POST', '/actions', { ...action, strategyId: 's-landlord' })).body.error, /linked to this brand/);
      assert.match((await request('POST', '/actions', { ...action, companyId: 'landsec', strategyId: 's-brand' })).body.error, /linked to this landlord/);
    });

    await t.test('a brand action sits at a scheme and unit, is shown to one client and says who it waits on; only BGP sets these', async () => {
      // The column statements are safe to run again on every start.
      for (const sql of CRM_ENGAGEMENT_MIGRATIONS) await pool.query(sql);
      await pool.query(`
        INSERT INTO crm_properties(id,name) VALUES ('p-blue','Bluewater Shopping Centre'),('p-blue-2','Bluewater (duplicate record)'),('p-west','Westgate'),('p-other','Another landlord''s centre');
        INSERT INTO tenancy_schedule_units(id,property_id,premises,unit_number) VALUES
          ('u-blue','p-blue','Unit L104','L104'),('u-blue-2','p-blue-2','Kiosk 3','K3'),('u-west','p-west','','7'),('u-other','p-other','Unit 1','1');
      `);
      const stored = async actionId => (await pool.query('SELECT property_id,tenancy_unit_id,shared_with_company_id,waiting_on_party,waiting_since FROM crm_engagement_actions WHERE task_id=$1', [actionId])).rows[0];
      const base = { title: 'Send Landsec the trading figures', notes: 'BGP only: agree our fee first', dueAt: '2026-12-10T12:00:00Z', status: 'todo', ownerId: 'owner', companyId: 'wingstop', strategyId: 's-brand', eventId: null };
      const before = await count('crm_engagement_actions');
      const landlordBefore = (await request('GET', '?kind=landlord')).body;

      // Refused, and nothing written.
      const refused = [
        [{ ...base, companyId: 'landsec', strategyId: null, waitingOnParty: 'Tenant' }, /brand actions/],
        [{ ...base, companyId: 'landsec', strategyId: null, propertyId: 'p-blue' }, /brand actions/],
        [{ ...base, companyId: 'landsec', strategyId: null, sharedWithCompanyId: 'landsec' }, /brand actions/],
        [{ ...base, tenancyUnitId: 'no-such-unit' }, /not on the tenancy schedule/],
        [{ ...base, propertyId: 'p-blue', tenancyUnitId: 'u-west' }, /not in the scheme chosen/],
        [{ ...base, propertyId: 'no-such-property' }, /no property record/],
        [{ ...base, sharedWithCompanyId: 'hammerson' }, /Brand CRM/],
        [{ ...base, companyId: 'flatiron', strategyId: null, sharedWithCompanyId: 'landsec' }, /not on Landsec's brand list/],
        [{ ...base, propertyId: 'p-other', sharedWithCompanyId: 'landsec' }, /one of Landsec's schemes/],
        [{ ...base, tenancyUnitId: 'u-other', sharedWithCompanyId: 'landsec' }, /one of Landsec's schemes/],
        [{ ...base, waitingOnParty: 'Somebody else' }, /from the list/],
        [{ ...base, waitingSince: '2020-01-01T00:00:00Z' }, /./],
      ];
      for (const [body, message] of refused) { const r = await request('POST', '/actions', body); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.body.error, message); }
      assert.equal(await count('crm_engagement_actions'), before);

      // BGP adds an action at a unit, shown to Landsec, waiting on the asset manager.
      const shared = await request('POST', '/actions', { ...base, propertyId: 'p-blue', tenancyUnitId: 'u-blue', sharedWithCompanyId: 'landsec', waitingOnParty: 'Landsec asset manager' });
      assert.equal(shared.status, 200);
      const row = await stored(shared.body.id);
      assert.deepEqual([row.property_id, row.tenancy_unit_id, row.shared_with_company_id, row.waiting_on_party], ['p-blue', 'u-blue', 'landsec', 'Landsec asset manager']);
      assert.ok(row.waiting_since, 'the waiting clock starts');
      // The task is not tied to the property, so it cannot reach a landlord's activity board.
      assert.deepEqual((await pool.query('SELECT to_jsonb(t)->>\'linked_property_id\' p,to_jsonb(t)->>\'linked_deal_id\' d FROM user_tasks t WHERE id=$1', [shared.body.id])).rows[0], { p: null, d: null });
      // A unit on a duplicate record of the scheme is accepted and keeps its own property; a unit alone brings its scheme.
      const duplicate = await request('POST', '/actions', { ...base, title: 'Kiosk plans', propertyId: 'p-blue', tenancyUnitId: 'u-blue-2', sharedWithCompanyId: 'landsec' });
      assert.equal((await stored(duplicate.body.id)).property_id, 'p-blue-2');
      const west = await request('POST', '/actions', { ...base, title: 'Westgate walk-round', tenancyUnitId: 'u-west', sharedWithCompanyId: 'landsec' });
      assert.equal((await stored(west.body.id)).property_id, 'p-west');
      const unplaced = await request('POST', '/actions', { ...base, title: 'Send the brand deck', sharedWithCompanyId: 'landsec' });
      const privatePlaced = await request('POST', '/actions', { ...base, title: 'Agree our fee before Landsec hear', propertyId: 'p-blue', waitingOnParty: 'BGP' });
      for (const r of [duplicate, west, unplaced, privatePlaced]) assert.equal(r.status, 200);

      // BGP reads all of it back, notes included.
      const staff = (await request('GET', '?companyId=wingstop')).body.actions;
      const staffShared = staff.find(a => a.id === shared.body.id);
      assert.deepEqual([staffShared.propertyId, staffShared.schemeName, staffShared.tenancyUnitId, staffShared.unitLabel, staffShared.sharedWithCompanyId, staffShared.sharedWithName, staffShared.waitingOnParty, staffShared.raisedBy, staffShared.notes],
        ['p-blue', 'Bluewater', 'u-blue', 'Unit L104', 'landsec', 'Landsec', 'Landsec asset manager', 'bgp', 'BGP only: agree our fee first']);
      assert.ok(staffShared.waitingSince);
      assert.equal(staff.find(a => a.id === west.body.id).unitLabel, '7', 'a unit with no premises name falls back to its number');
      assert.equal(staff.find(a => a.id === 'a-client').raisedBy, 'client');
      assert.ok(ids((await request('GET', '?kind=brand')).body.actions).includes(shared.body.id));

      // Landsec: its own request as before, and the four shared actions cut down. Never the unshared ones, never notes.
      const landsec = (await request('GET', '?companyId=wingstop', null, 'ls-user', 'landsec')).body;
      assert.deepEqual(landsec.strategies, []); assert.deepEqual(landsec.events, []);
      assert.deepEqual(ids(landsec.actions), ids([{ id: 'a-client' }, shared.body, duplicate.body, west.body, unplaced.body]));
      const own = landsec.actions.find(a => a.id === 'a-client');
      assert.equal(own.notes, 'Client note'); assert.ok(!('raisedBy' in own) && !('sharedWithCompanyId' in own) && !('waitingOnParty' in own));
      assert.deepEqual(landsec.actions.find(a => a.id === shared.body.id), { id: shared.body.id, title: 'Send Landsec the trading figures', notes: null, dueAt: '2026-12-10T12:00:00.000Z', status: 'todo', canEdit: false,
        ownerId: '', ownerName: 'Owner', companyId: 'wingstop', companyName: 'Wingstop', strategyId: null, eventId: null, source: null, schemeName: 'Bluewater', unitLabel: 'Unit L104', raisedBy: 'bgp' });
      assert.deepEqual([landsec.actions.find(a => a.id === unplaced.body.id).schemeName, landsec.actions.find(a => a.id === unplaced.body.id).unitLabel], [null, null]);
      const sent = JSON.stringify(landsec.actions.filter(a => a.id !== 'a-client'));
      for (const secret of ['fee', 'Landsec asset manager', 'p-blue', 'u-blue', 's-brand', '"owner"', '"landsec"']) assert.ok(!sent.includes(secret), secret);

      // Another client never receives a shared action, whatever it asks for.
      for (const query of ['?companyId=wingstop', '?companyId=wingstop&kind=brand']) {
        assert.deepEqual((await request('GET', query, null, 'ham-user', 'hammerson')).body, { strategies: [], events: [], actions: [] });
        assert.deepEqual((await request('GET', query, null, 'ham-user', 'hammerson', { 'x-schemes': 'bluewater' })).body, { strategies: [], events: [], actions: [] });
      }

      // A login held to named schemes (a joint agent; an asset manager was one until 13 November 2026): only a shared action at one of its own schemes.
      const restricted = async schemes => ids((await request('GET', '?companyId=wingstop', null, 'ls-user', 'landsec', { 'x-schemes': schemes })).body.actions).filter(actionId => actionId !== 'a-client');
      assert.deepEqual(await restricted('bluewater'), ids([shared.body, duplicate.body]));
      assert.deepEqual(await restricted('westgate'), [west.body.id]);
      assert.deepEqual(await restricted(''), []);
      assert.deepEqual(await restricted('bluewater,westgate'), ids([shared.body, duplicate.body, west.body]));

      // A client login cannot place, share or set waiting on: on a new action the fields are dropped, on a change they are refused.
      const clientAction = await request('POST', '/actions', { ...base, title: 'Landsec asks about Bluewater', notes: 'From Landsec', strategyId: null, propertyId: 'p-blue', tenancyUnitId: 'u-blue', sharedWithCompanyId: 'landsec', waitingOnParty: 'BGP' }, 'ls-user', 'landsec');
      assert.equal(clientAction.status, 200);
      const clientRow = await stored(clientAction.body.id);
      assert.deepEqual([clientRow.property_id, clientRow.tenancy_unit_id, clientRow.shared_with_company_id, clientRow.waiting_on_party, clientRow.waiting_since], [null, null, null, null, null]);
      for (const body of [{ sharedWithCompanyId: 'landsec' }, { status: 'done', sharedWithCompanyId: 'landsec' }, { waitingOnParty: 'BGP' }, { propertyId: 'p-blue' }, { sharedWithCompanyId: null }]) {
        assert.equal((await request('PATCH', `/actions/${clientAction.body.id}`, body, 'ls-user', 'landsec')).status, 400, JSON.stringify(body));
        assert.equal((await request('PATCH', `/actions/${shared.body.id}`, body, 'ls-user', 'landsec')).status, 400, JSON.stringify(body));
      }
      assert.equal((await pool.query('SELECT status FROM user_tasks WHERE id=$1', [clientAction.body.id])).rows[0].status, 'todo');
      assert.equal((await stored(shared.body.id)).shared_with_company_id, 'landsec');
      assert.equal((await request('PATCH', `/actions/${clientAction.body.id}`, { status: 'in_progress' }, 'ls-user', 'landsec')).status, 200, 'a client still updates its own action');
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { status: 'done' }, 'ls-user', 'landsec')).status, 403, 'a shared action is not the client\'s to tick off');
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { status: 'done' }, 'ham-user', 'hammerson')).status, 403);

      // A request a client typed is never shown to a client by BGP; BGP may still place it and say who it waits on.
      assert.match((await request('PATCH', '/actions/a-client', { sharedWithCompanyId: 'landsec' })).body.error, /client login raised/);
      assert.equal((await request('PATCH', '/actions/a-client', { tenancyUnitId: 'u-blue', waitingOnParty: 'BGP' }, 'colleague')).status, 200);
      const ownAfter = (await request('GET', '?companyId=wingstop', null, 'ls-user', 'landsec')).body.actions.find(a => a.id === 'a-client');
      assert.deepEqual(Object.keys(ownAfter).sort(), Object.keys(own).sort(), 'the client\'s own request gains nothing BGP added');

      // Any BGP colleague changes the plan fields; the status stays the owner's or assigner's, and a refused status changes nothing.
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, {})).status, 400);
      assert.equal((await request('PATCH', '/actions/no-such-action', { waitingOnParty: 'BGP' })).status, 404);
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { status: 'done', waitingOnParty: 'Tenant' }, 'colleague')).status, 403);
      assert.equal((await stored(shared.body.id)).waiting_on_party, 'Landsec asset manager');
      const since = (await stored(shared.body.id)).waiting_since;
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { waitingOnParty: 'Landsec asset manager' }, 'colleague')).status, 200);
      assert.deepEqual((await stored(shared.body.id)).waiting_since, since, 'the clock keeps running while the same party is waited on');
      await pool.query("UPDATE crm_engagement_actions SET waiting_since=now()-interval '3 days' WHERE task_id=$1", [shared.body.id]);
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { waitingOnParty: 'Tenant' }, 'colleague')).status, 200);
      assert.ok(Date.now() - new Date((await stored(shared.body.id)).waiting_since).getTime() < 60_000, 'a new party restarts the clock');
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { waitingOnParty: null }, 'colleague')).status, 200);
      const cleared = await stored(shared.body.id);
      assert.deepEqual([cleared.waiting_on_party, cleared.waiting_since, cleared.tenancy_unit_id, cleared.shared_with_company_id], [null, null, 'u-blue', 'landsec'], 'only the field sent changes');
      // Another scheme without a unit clears the unit; a place outside the client's schemes is refused while it is shared.
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { propertyId: 'p-west' })).status, 200);
      assert.deepEqual([(await stored(shared.body.id)).property_id, (await stored(shared.body.id)).tenancy_unit_id], ['p-west', null]);
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { propertyId: 'p-other' })).status, 400);
      assert.equal((await request('PATCH', `/actions/${privatePlaced.body.id}`, { propertyId: 'p-other' })).status, 200, 'an action nobody is shown can sit at any property');
      assert.equal((await request('PATCH', `/actions/${privatePlaced.body.id}`, { sharedWithCompanyId: 'landsec' })).status, 400);
      // Unsharing takes it away from the client at once.
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { sharedWithCompanyId: null }, 'colleague')).status, 200);
      assert.ok(!ids((await request('GET', '?companyId=wingstop', null, 'ls-user', 'landsec')).body.actions).includes(shared.body.id));
      // The owner still ticks it off together with a plan change.
      assert.equal((await request('PATCH', `/actions/${shared.body.id}`, { status: 'done', waitingOnParty: 'BGP' })).status, 200);
      assert.equal((await pool.query('SELECT status FROM user_tasks WHERE id=$1', [shared.body.id])).rows[0].status, 'done');

      // The Landlord CRM is untouched: the same answer as before, and no plan field on a landlord action.
      const landlordAfter = (await request('GET', '?kind=landlord')).body;
      assert.deepEqual(landlordAfter, landlordBefore);
      assert.deepEqual(Object.keys(landlordAfter.actions.find(a => a.id === 'a-landlord')).sort(),
        ['canEdit', 'companyId', 'companyName', 'dueAt', 'eventId', 'id', 'notes', 'ownerId', 'ownerName', 'source', 'status', 'strategyId', 'title']);
      assert.equal((await request('PATCH', '/actions/a-landlord', { waitingOnParty: 'Tenant' })).status, 400, 'a landlord action takes no plan field');
      assert.equal((await request('PATCH', '/actions/a-landlord', { status: 'in_progress' })).status, 200);
      const landlordAction = await request('POST', '/actions', { ...base, title: 'Call the landlord again', companyId: 'landsec', strategyId: null });
      assert.equal(landlordAction.status, 200);
      const landlordRow = await stored(landlordAction.body.id);
      assert.deepEqual([landlordRow.property_id, landlordRow.shared_with_company_id, landlordRow.waiting_on_party], [null, null, null]);

      // The form's choices go to BGP planning a brand only.
      const partners = [{ id: 'landsec', name: 'Landsec', schemes: [{ key: 'bluewater', name: 'Bluewater', propertyId: 'p-blue', propertyIds: ['p-blue', 'p-blue-2'] }, { key: 'westgate', name: 'Westgate Oxford', propertyId: 'p-west', propertyIds: ['p-west'] }] }];
      assert.deepEqual((await request('GET', '/options?kind=brand')).body.sharePartners, partners);
      assert.deepEqual((await request('GET', '/options?companyId=wingstop')).body.sharePartners, partners);
      for (const query of ['/options', '/options?kind=landlord', '/options?companyId=landsec']) assert.ok(!('sharePartners' in (await request('GET', query)).body), query);
      assert.ok(!('sharePartners' in (await request('GET', '/options?companyId=wingstop', null, 'ls-user', 'landsec')).body));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
  }
});
