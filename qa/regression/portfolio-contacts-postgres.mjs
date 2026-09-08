// Uses only transaction-local synthetic tables on the disposable audit socket.
// PORTFOLIO_CONTACTS_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node --import tsx qa/regression/portfolio-contacts-postgres.mjs
import assert from 'node:assert/strict';
import pg from 'pg';
import { loadPortfolioContacts, buildPortfolioContactsQuery, mapPortfolioContactRows } from '../../server/portfolio-contacts.ts';

const supplied = process.env.PORTFOLIO_CONTACTS_DATABASE_URL;
if (!supplied) throw new Error('Provide PORTFOLIO_CONTACTS_DATABASE_URL for the disposable audit database');
const url = new URL(supplied);
if (url.hostname || !['/bgp_smoke', '/bgp_crm_directory_regression'].includes(url.pathname)
  || !/^\/(?:private\/)?tmp\/bgp-[a-zA-Z0-9_-]+\/socket$/.test(url.searchParams.get('host') || '')) {
  throw new Error('Refusing a database outside the disposable audit Unix socket');
}
const db = new pg.Client({ connectionString: supplied, ssl: false });
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`
    CREATE TEMP TABLE crm_properties (id varchar PRIMARY KEY, name text, landlord_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE crm_company_properties (company_id varchar, property_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE crm_companies (id varchar PRIMARY KEY, name text, company_type text, agent_type text) ON COMMIT DROP;
    CREATE TEMP TABLE crm_contacts (id varchar PRIMARY KEY, name text, role text, email text, phone text, phone_mobile text, company_id varchar, last_interaction timestamp) ON COMMIT DROP;
    CREATE TEMP TABLE users (id varchar PRIMARY KEY, name text, email text, phone text) ON COMMIT DROP;
    CREATE TEMP TABLE crm_property_agents (property_id varchar, user_id varchar, role text) ON COMMIT DROP;
    CREATE TEMP TABLE crm_property_clients (property_id varchar, contact_id varchar, role text) ON COMMIT DROP;
    CREATE TEMP TABLE brand_agent_representations (agent_company_id varchar, end_date timestamp, agent_type text) ON COMMIT DROP;
    CREATE TEMP TABLE property_contact_overrides (property_id varchar, contact_id varchar, kind text) ON COMMIT DROP;
    CREATE TEMP TABLE property_units (id varchar PRIMARY KEY, property_id varchar, unit_name text) ON COMMIT DROP;
    CREATE TEMP TABLE crm_deals (id varchar PRIMARY KEY, name text, property_id varchar, unit_id varchar, tenancy_unit_id varchar, status text, tenant_id varchar,
      client_contact_id varchar, tenant_contact_id varchar, landlord_contact_id varchar, vendor_contact_id varchar, purchaser_contact_id varchar,
      vendor_agent_contact_id varchar, acquisition_agent_contact_id varchar, purchaser_agent_contact_id varchar, leasing_agent_contact_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE available_units (id varchar PRIMARY KEY, property_id varchar, unit_id varchar, unit_name text, marketing_status text, tenant_company_id varchar, deal_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE unit_offers (id varchar PRIMARY KEY, unit_id varchar, company_id varchar, contact_id varchar, offer_date text) ON COMMIT DROP;
    CREATE TEMP TABLE unit_viewings (id varchar PRIMARY KEY, unit_id varchar, contact_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE tenancy_schedule_units (id varchar PRIMARY KEY, property_id varchar, property_unit_id varchar, tenant_company_id varchar, tenant_name text, trading_name text, unit_number text, premises text, status text) ON COMMIT DROP;
  `);
  await db.query(`INSERT INTO crm_companies VALUES
    ('client','Client','Landlord',NULL), ('coffee','Coffee','Tenant - Café',NULL), ('retail','Retail','Tenant - Fashion',NULL),
    ('agency','Agency','Agent',NULL), ('consultant','Consultant','Consultant',NULL), ('rep','Rep Firm','Consultant','tenant_rep'),
    ('nobody','No People','Tenant - Restaurant',NULL), ('dup-a','Ambiguous','Tenant - Café',NULL), ('dup-b','Ambiguous','Tenant - Café',NULL);
    INSERT INTO crm_properties VALUES ('one','First Scheme','client'), ('two','Shared Scheme','other'), ('foreign','Foreign Scheme','other');
    INSERT INTO crm_company_properties VALUES ('client','two'), ('consultant','one'), ('rep','one');
    INSERT INTO property_units VALUES ('master','one','Master 1'), ('foreign-master','foreign','Private unit');
    INSERT INTO users VALUES ('staff','Staff Person','staff@example.test','020');
    INSERT INTO crm_property_agents VALUES ('one','staff','Lead'), ('two','staff','Leasing');
  `);
  const contact = async (id, company, name = id, role = null, touched = null) => db.query(
    'INSERT INTO crm_contacts (id,name,company_id,role,last_interaction,email,phone) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id,name,company,role,touched,`${id}@example.test`,'020']);
  for (let i = 0; i < 9; i++) await contact(`named-${i}`, i === 0 ? 'client' : 'agency');
  for (let i = 0; i < 25; i++) await contact(`coffee-${i}`, 'coffee', `Coffee person ${i}`, null, '2025-01-01');
  for (let i = 0; i < 12; i++) await contact(`director-${i}`, 'client', `Director ${i}`, 'Director');
  await contact('property-client', 'client', 'Property manager', 'Manager');
  await contact('hidden', 'coffee'); await contact('pinned', null); await contact('retail-person', 'retail');
  await contact('consultant-person','consultant'); await contact('rep-person','rep'); await contact('offer-person',null);
  await contact('same-one','coffee','Same Person'); await contact('same-two','coffee','Same Person');
  await db.query(`
    INSERT INTO crm_deals VALUES ('deal','Nine named contacts','one','master',NULL,'HOT','coffee',
      'named-0','named-1','named-2','named-3','named-4','named-5','named-6','named-7','named-8');
    INSERT INTO crm_deals (id,name,property_id,status,tenant_id,tenant_contact_id,unit_id) VALUES
      ('shared-deal','Shared Deal','two','HOT','coffee','hidden','foreign-master'),
      ('foreign-deal','Foreign Deal','foreign','HOT','retail','retail-person',NULL),
      ('no-person-deal','No people deal','one','HOT','nobody',NULL,NULL);
    INSERT INTO crm_property_clients VALUES ('two','property-client','Asset manager');
    INSERT INTO property_contact_overrides VALUES ('one','hidden','hide'),('one','pinned','pin');
    INSERT INTO available_units VALUES
      ('tracker','one','master','Unit 1','NEG','coffee',NULL), ('empty','one',NULL,'Empty unit','NEG',NULL,NULL),
      ('offer-unit','two',NULL,'Offer unit','HoTs',NULL,NULL);
    INSERT INTO unit_offers VALUES ('offer','offer-unit','coffee','offer-person','2026-01-01');
    INSERT INTO unit_viewings VALUES ('viewing','tracker','named-1');
    INSERT INTO tenancy_schedule_units VALUES
      ('canonical','one','master','retail','Coffee','Coffee','1',NULL,'Occupied'),
      ('matched','one',NULL,NULL,'Coffee',NULL,'2',NULL,'Occupied'),
      ('ambiguous','one',NULL,NULL,'Ambiguous',NULL,'3',NULL,'Occupied'),
      ('unmatched','two',NULL,NULL,'Unknown operator',NULL,'4',NULL,'Occupied'),
      ('missing','one',NULL,'missing-company','Coffee',NULL,'5',NULL,'Occupied'),
      ('vacant','one',NULL,NULL,'Vacant',NULL,'6',NULL,'Vacant'),
      ('no-contacts','two',NULL,'nobody','No People',NULL,'7',NULL,'Occupied');
    INSERT INTO crm_companies (id,name,company_type)
      SELECT 'bulk-' || n, 'Portfolio occupier ' || n, 'Tenant - Fashion' FROM generate_series(1,205) n;
    INSERT INTO tenancy_schedule_units (id,property_id,tenant_company_id,tenant_name,unit_number,status)
      SELECT 'bulk-tenancy-' || n, 'one', 'bulk-' || n, 'Portfolio occupier ' || n, 'Bulk ' || n, 'Occupied' FROM generate_series(1,205) n;
  `);
  const slice = "co.company_type IN ('Tenant - Café', 'Tenant - Restaurant')";
  const response = await loadPortfolioContacts(db, 'client', 'client', slice);
  const by = id => response.entries.find(e => e.id === id);
  check('owned and shared schemes included without foreign properties', () => assert.deepEqual(response.properties.map(p=>p.id), ['one','two']));
  check('all nine explicitly named deal contacts survive, including own-company non-director', () => {
    for (let i=0;i<9;i++) assert.ok(by(`contact:named-${i}`)?.relationships.some(r=>r.deal?.id==='deal'));
  });
  check('uncapped client directors and explicit property manager are visible', () => {
    assert.equal(response.entries.filter(e=>e.contactId?.startsWith('director-')).length,12);
    assert.ok(by('contact:property-client').relationships.some(r=>r.property?.id==='two'));
  });
  check('contacts beyond old preview limits remain searchable and no person is arbitrarily picked per brand', () => assert.equal(response.entries.filter(e=>e.contactId?.startsWith('coffee-')).length,25));
  check('all occupiers beyond the former 200-brand cutoff remain available', () => assert.equal(response.entries.filter(e=>e.id.startsWith('company:bulk-')).length,205));
  check('all occupancy and tracker relationships are attached to each same company contact', () => {
    const person=by('contact:coffee-0');
    assert.ok(person.relationships.some(r=>r.group==='tenants' && r.unitName==='2'));
    assert.ok(person.relationships.some(r=>r.trackerId==='tracker'));
    assert.ok(person.relationships.some(r=>r.property?.id==='two' && r.deal?.id==='shared-deal'));
  });
  check('hiding one scheme preserves the same contact on another scheme', () => {
    const person=by('contact:hidden'); assert.ok(person); assert.ok(person.relationships.every(r=>r.property?.id==='two'));
  });
  check('pinned contacts with unknown companies remain visible with an accessible property', () => {
    const person=by('contact:pinned'); assert.ok(person); assert.equal(person.canOpenContact,false);
    assert.equal(person.relationships[0].property.id,'one');
  });
  check('canonical occupier ID wins despite a conflicting brand name', () => {
    assert.ok(by('contact:retail-person').relationships.some(r=>r.group==='tenants' && r.unitName==='1' && r.confirmed));
    assert.ok(by('contact:coffee-0').relationships.every(r=>r.group!=='tenants' || r.unitName!=='1'));
  });
  check('name-only occupier matches are explicitly unconfirmed', () => assert.equal(by('contact:coffee-0').relationships.find(r=>r.group==='tenants' && r.unitName==='2').confirmed,false));
  check('ambiguous and missing canonical companies never guess a CRM identity', () => {
    for (const id of ['ambiguous','unmatched','missing']) { const e=by(`tenancy:${id}`); assert.ok(e); assert.equal(e.company,null); assert.equal(e.canOpenCompany,false); }
    assert.equal(by('tenancy:vacant'),undefined);
  });
  check('company with no contacts keeps all occupancy and deal evidence', () => {
    const e=by('company:nobody'); assert.ok(e.relationships.some(r=>r.group==='tenants')); assert.ok(e.relationships.some(r=>r.deal?.id==='no-person-deal'));
  });
  check('retail and consultant cards retain context without forbidden contact/company links', () => {
    for (const id of ['retail-person','consultant-person']) {const e=by(`contact:${id}`); assert.ok(e); assert.equal(e.canOpenContact,false);assert.equal(e.canOpenCompany,false);}
  });
  check('existing company and contact read gates remain distinct for a flagged tenant rep', () => {
    assert.equal(by('contact:rep-person').canOpenCompany,true);assert.equal(by('contact:rep-person').canOpenContact,false);
  });
  check('normal brand and agency profiles remain linked', () => {
    assert.equal(by('contact:coffee-0').canOpenContact,true);assert.equal(by('contact:named-1').canOpenContact,true);
  });
  check('BGP people retain all assigned properties without an HR or contact profile link', () => {
    const e=by('user:staff');assert.equal(e.canOpenContact,false);assert.equal(e.contactId,null);assert.equal(e.relationships.length,2);
  });
  check('tracker evidence carries master-unit ID separately from tracker ID', () => {
    const r=by('contact:coffee-0').relationships.find(r=>r.trackerId==='tracker');assert.equal(r.unit.id,'master');assert.equal(r.trackerId,'tracker');
  });
  check('foreign master-unit IDs on an otherwise scoped deal never produce a link', () => assert.ok(response.entries.every(e=>e.relationships.every(r=>r.unit?.id!=='foreign-master'))));
  check('unlinked tracker unit is a navigable scoped gap', () => assert.equal(by('tracker:empty').relationships[0].property.id,'one'));
  check('latest offer supplies tracker company and the specifically named offer person', () => {
    assert.ok(by('contact:coffee-0').relationships.some(r=>r.trackerId==='offer-unit'));
    assert.ok(by('contact:offer-person').relationships.some(r=>r.source==='Named offer contact'));
  });
  check('same-name distinct contacts and foreign-data exclusions hold', () => {
    assert.ok(by('contact:same-one'));assert.ok(by('contact:same-two'));
    assert.ok(response.entries.every(e=>e.relationships.every(r=>r.property?.id!=='foreign' && r.deal?.id!=='foreign-deal')));
  });
  const staff=await loadPortfolioContacts(db,'client',null,slice);
  check('staff keep existing wider CRM profile reads',()=>assert.equal(staff.entries.find(e=>e.id==='contact:retail-person').canOpenContact,true));
  const query=buildPortfolioContactsQuery('client','client',slice,false);
  const withoutOverrides=mapPortfolioContactRows((await db.query(query.text,query.values)).rows,[]);
  check('optional override table can be absent without creating a schema object',()=>assert.ok(withoutOverrides.entries.find(e=>e.id==='contact:hidden').relationships.some(r=>r.property?.id==='one')));
  await db.query('ALTER TABLE tenancy_schedule_units DROP COLUMN property_unit_id');
  const legacy = await loadPortfolioContacts(db,'client','client',slice);
  check('legacy tenancy rows without the optional master-unit link still load with property and unit text',()=>{
    const r=legacy.entries.find(e=>e.id==='contact:retail-person').relationships.find(r=>r.group==='tenants');
    assert.equal(r.property.id,'one');assert.equal(r.unitName,'1');assert.equal(r.unit,null);
  });
  console.log(`PASS ${checks} PostgreSQL portfolio contact checks`);
} finally {
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
}
