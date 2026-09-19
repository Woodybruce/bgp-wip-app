// Runs real importer SQL in isolated temporary tables; the outer transaction rolls back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import pg from 'pg';
import * as matching from '../../server/viewing-matching.ts';
import { viewingMissingDetails } from '../../shared/viewing-workflow.ts';
const require = createRequire(import.meta.url);
const { source, evaluate } = require('./source-harness.cjs');
const supplied = process.env.VIEWING_TEST_DATABASE_URL;
if (!supplied) throw new Error('Provide the disposable VIEWING_TEST_DATABASE_URL');
const url = new URL(supplied);
if (url.hostname || url.pathname !== '/bgp_smoke' || url.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || url.searchParams.get('port') !== '55446') throw new Error('Refusing non-disposable database');
const client = new pg.Client({ connectionString: supplied, ssl: false });
await client.connect();
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
try {
  await client.query('BEGIN');
  await client.query(`
    CREATE TEMP TABLE unit_viewings (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), unit_id varchar NOT NULL,
      company_name text, contact_name text, contact_id varchar, company_id varchar, viewing_date text NOT NULL,
      viewing_time text, attendees text, notes text, outcome text, source text, calendar_event_id text, created_at timestamp DEFAULT NOW()) ON COMMIT DROP;
    CREATE UNIQUE INDEX viewing_qa_calendar_unique ON unit_viewings(calendar_event_id) WHERE calendar_event_id IS NOT NULL;
    CREATE TEMP TABLE unit_offers (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), unit_id varchar, company_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE crm_properties (id varchar PRIMARY KEY, name text) ON COMMIT DROP;
    CREATE TEMP TABLE available_units (id varchar PRIMARY KEY, property_id varchar, unit_name text) ON COMMIT DROP;
    CREATE TEMP TABLE users (id varchar PRIMARY KEY, email text, is_active boolean DEFAULT true, client_view_mode boolean DEFAULT false) ON COMMIT DROP;
    CREATE TEMP TABLE crm_companies (id varchar PRIMARY KEY, name text, company_type text, merged_into_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE crm_contacts (id varchar PRIMARY KEY, name text, email text, company_id varchar) ON COMMIT DROP;
    CREATE TEMP TABLE brand_agent_representations (id varchar PRIMARY KEY, primary_contact_id varchar, brand_company_id varchar, agent_type text, start_date timestamp, end_date timestamp) ON COMMIT DROP;
    CREATE TEMP TABLE crm_requirements_leasing (id varchar PRIMARY KEY, company_id varchar, agent_contact_id varchar, principal_contact_id varchar, status text) ON COMMIT DROP;
    INSERT INTO unit_viewings(id,unit_id,viewing_date,outcome,company_id) VALUES ('legacy','unit-1','2026-08-01','Interested','agency');
  `);
  const before = (await client.query('SELECT id,unit_id,viewing_date,outcome,company_id FROM unit_viewings')).rows;
  const migration = await readFile(new URL('../../migrations/0038_leasing_viewings.sql', import.meta.url), 'utf8');
  await client.query(migration);
  await client.query(migration);
  const after = (await client.query('SELECT id,unit_id,viewing_date,outcome,company_id FROM unit_viewings')).rows;
  check('additive migration is repeatable and preserves existing links and historical outcomes', () => assert.deepEqual(after, before));
  await client.query(`INSERT INTO crm_properties VALUES ('property','Brent Cross');
    INSERT INTO available_units VALUES ('unit-1','property','Unit 1'),('unit-2','property','Unit 2');
    INSERT INTO users(id,email) VALUES ('carly','carly@brucegillinghampollard.com'),('will','will@brucegillinghampollard.com');
    INSERT INTO crm_companies VALUES ('brand','Viewing Brand','Tenant - Retail',NULL),('old-brand','Former Brand','Tenant - Retail',NULL),('agency','Agency','Agent',NULL),('contractor','Contractor','Contractor',NULL);
    INSERT INTO crm_contacts VALUES ('agent','Viewing Agent','agent@example.test','agency'),('builder','Builder','builder@example.test','contractor');
    INSERT INTO brand_agent_representations VALUES ('current','agent','brand','tenant_rep',NULL,NULL),('ended','agent','old-brand','tenant_rep',NULL,'2020-01-01'),('future','agent','old-brand','tenant_rep','2099-01-01',NULL);
    INSERT INTO crm_requirements_leasing VALUES ('requirement','brand','agent',NULL,'Active'),('inactive','old-brand','agent',NULL,'Archived');`);
  let inBooking = false;
  const pool = { query: (sql, args) => client.query(sql, args), async connect() { return {
    release() {}, async query(sql, args) {
      if (sql === 'BEGIN') { assert.equal(inBooking, false); inBooking = true; return client.query('SAVEPOINT viewing_booking'); }
      if (sql === 'COMMIT') { inBooking = false; return client.query('RELEASE SAVEPOINT viewing_booking'); }
      if (sql === 'ROLLBACK') { inBooking = false; await client.query('ROLLBACK TO SAVEPOINT viewing_booking'); return client.query('RELEASE SAVEPOINT viewing_booking'); }
      return client.query(sql, args);
    },
  }; } };
  const module = evaluate(source('server/viewing-sync.ts'), { require(name) {
    if (name === './db') return { pool };
    if (name === 'node:crypto') return { createHash };
    if (name === '@shared/viewing-workflow') return { viewingMissingDetails };
    if (name === './viewing-matching') return matching;
    throw new Error(`Unexpected import ${name}`);
  } });
  const event = (key, changes = {}) => ({ id: key, iCalUId: key, subject: 'Viewing Brent Cross Unit 1', location: { displayName: 'Brent Cross' }, start: { dateTime: '2026-09-16T09:00:00Z', timeZone: 'UTC' }, organizer: { emailAddress: { address: 'carly@brucegillinghampollard.com' } }, attendees: [{ emailAddress: { address: 'agent@example.test' } }], ...changes });
  const mailbox = 'carly@brucegillinghampollard.com';
  const run = (events, email = mailbox, window) => module.syncDiaryViewings(events, email, window);
  const read = async key => (await client.query('SELECT * FROM unit_viewings WHERE booking_id=$1 ORDER BY calendar_event_id', [key])).rows;
  await run([event('single')]);
  await run([event('single')], 'will@brucegillinghampollard.com');
  let rows = await read('single');
  check('actual SQL dedupes mailbox copies and resolves only current named brand relationships', () => {
    assert.equal(rows.length, 1); assert.equal(rows[0].company_id, 'brand'); assert.equal(rows[0].requirement_id, 'requirement');
    assert.equal(rows[0].agent_contact_id, 'agent'); assert.equal(rows[0].contact_id, null); assert.equal(rows[0].owner_user_id, 'carly');
    assert.ok(rows[0].details_confirmed_at); assert.equal(rows[0].viewing_time, '10:00');
  });
  await run([event('missing', { subject: 'Viewing unknown location', location: null, attendees: [{ emailAddress: { address: 'unknown@example.test' } }] })]);
  rows = await read('missing');
  check('unanchored bookings persist with null unit, no invented company, and actionable issues', () => {
    assert.equal(rows[0].unit_id, null); assert.equal(rows[0].company_id, null); assert.equal(rows[0].details_confirmed_at, null); assert.ok(rows[0].source_details.issues.length);
  });
  await run([event('contractor', { attendees: [{ emailAddress: { address: 'agent@example.test' } }, { emailAddress: { address: 'builder@example.test' } }] })]);
  rows = await read('contractor');
  check('known contractor ambiguity is retained for owner review', () => assert.equal(rows[0].details_confirmed_at, null));
  const multi = event('multi', { subject: 'Viewing Brent Cross Unit 1 and Unit 2' });
  await run([multi]);
  rows = await read('multi');
  check('one calendar booking creates independently linked rows for every explicit unit', () => {
    assert.equal(rows.length, 2); assert.equal(new Set(rows.map(row => row.unit_id)).size, 2);
    assert.deepEqual(rows.map(row => row.calendar_event_id), ['multi', 'multi::unit:unit-2']);
  });
  await client.query("UPDATE unit_viewings SET outcome='Interested', status='completed', outcome_recorded_at=NOW() WHERE calendar_event_id='multi'");
  await run([{ ...multi, subject: 'Cancelled', isCancelled: true }]);
  rows = await read('multi');
  check('cancellation updates all linked units and preserves recorded outcome history', () => {
    assert.ok(rows.every(row => row.status === 'cancelled')); assert.equal(rows[0].outcome, 'Interested');
  });
  const changed = event('single', { subject: 'Viewing Brent Cross Unit 2', start: { dateTime: '2026-09-17T11:00:00Z', timeZone: 'UTC' } });
  await run([changed]); await run([changed]);
  rows = await read('single');
  check('reschedules update London time but preserve confirmed unit with persistent review after repeated sync', () => {
    assert.equal(rows[0].unit_id, 'unit-1'); assert.equal(rows[0].viewing_date, '2026-09-17'); assert.equal(rows[0].viewing_time, '12:00');
    assert.equal(rows[0].details_confirmed_at, null); assert.ok(rows[0].source_details.issues.some(issue => issue.startsWith('Calendar invitation changed')));
  });
  await client.query("UPDATE unit_viewings SET unit_id='unit-2',details_confirmed_at=NOW(),source_details=source_details || '{\"issues\":[]}'::jsonb WHERE booking_id='single'");
  await run([changed]);
  rows = await read('single');
  check('human confirmation resolves invitation review without sync resurrecting old issues', () => {
    assert.equal(rows[0].unit_id, 'unit-2'); assert.ok(rows[0].details_confirmed_at); assert.deepEqual(rows[0].source_details.issues, []);
  });
  await client.query("UPDATE unit_viewings SET deleted_at=NOW() WHERE booking_id='single'");
  await run([changed]);
  rows = await read('single');
  check('soft-deleted calendar booking remains deleted after another sync', () => { assert.equal(rows.length, 1); assert.ok(rows[0].deleted_at); });
  await run([event('removed')]);
  const window = { complete: true, start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' };
  await run([], 'will@brucegillinghampollard.com', window);
  rows = await read('removed');
  check('absence from another attendee calendar does not clear the owner’s confirmed booking', () => assert.ok(rows[0].details_confirmed_at));
  await run([], mailbox, { ...window, complete: false });
  rows = await read('removed');
  check('an incomplete calendar snapshot cannot establish that a booking disappeared', () => assert.ok(rows[0].details_confirmed_at));
  await run([], mailbox, window);
  rows = await read('removed');
  check('complete owner snapshot flags deleted invitation for review without assuming cancelled/no-show', () => {
    assert.equal(rows[0].details_confirmed_at, null); assert.equal(rows[0].status, 'scheduled');
    assert.ok(rows[0].source_details.issues.some(issue => issue.startsWith('No longer in')));
  });
  await run([event('removed')], mailbox, window);
  rows = await read('removed');
  check('a restored unchanged invitation clears the absence warning', () => { assert.ok(rows[0].details_confirmed_at); assert.deepEqual(rows[0].source_details.issues, []); });
  check('historical outcome is not rewritten by another booking’s import', () => assert.equal(after[0].outcome, 'Interested'));
  console.log(`${checks} disposable viewing PostgreSQL checks passed.`);
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
