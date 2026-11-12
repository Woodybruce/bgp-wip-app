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
      CREATE TABLE crm_properties(id varchar,freeholder_id varchar,long_leaseholder_id varchar,asset_manager_id varchar);
      CREATE TABLE crm_interviews(id varchar PRIMARY KEY,team text,interviewee text,meeting_date date,updated_at timestamp DEFAULT now(),responses jsonb);
      CREATE TABLE marketing_campaigns(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),name text,objective text,team text,lead_user_id varchar,status text,created_at timestamp DEFAULT now());
      CREATE TABLE marketing_events(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),title text,kind text,starts_at timestamp,ends_at timestamp,location text,description text,lead_user_id varchar,status text,external_url text,attendee_user_ids text[],attendee_contact_ids text[],created_by_user_id varchar,created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now());
      CREATE TABLE user_tasks(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),user_id varchar,title text,description text,due_date timestamp,status text,category text,created_at timestamp DEFAULT now(),completed_at timestamp);
      INSERT INTO users VALUES
        ('owner','Owner','owner@brucegillinghampollard.com','Staff',true,false,'Leasing'),
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
      companyIdForClientTeam: async team => ({ Landsec: 'landsec', Hammerson: 'hammerson' })[team] || null }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/crm/engagement`;
    const request = async (method, path = '', body, user = 'owner', scope = null) => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': user, ...(scope ? { 'x-scope': scope } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
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
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
  }
});
