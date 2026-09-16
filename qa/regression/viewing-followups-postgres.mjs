// Explicit disposable PostgreSQL integration. Never loads a .env or sends mail.
import assert from 'node:assert/strict';
import pg from 'pg';
import { ensureViewingFollowupSchema, reconcileViewingFollowup, runViewingFollowupSweep } from '../../server/viewing-followups.ts';
const connectionString = process.env.VIEWING_TEST_DATABASE_URL;
if (!connectionString) throw new Error('VIEWING_TEST_DATABASE_URL must explicitly name the disposable local bgp_smoke database');
const parsed = new URL(connectionString);
if (parsed.pathname !== '/bgp_smoke' || parsed.searchParams.get('host') !== '/tmp/bgp-propertyqa-20260916/socket' || parsed.searchParams.get('port') !== '55446') throw new Error('Refusing anything other than the isolated local QA database');
const schema = `viewing_followup_qa_${process.pid}`;
const admin = new pg.Pool({ connectionString, ssl: false });
const db = new pg.Pool({ connectionString, ssl: false, options: `-c search_path=${schema},public`, max: 8 });
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };
const now = new Date('2026-09-22T10:00:00Z');
const emails = [];
const sendEmail = async email => { emails.push(email); };
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await db.query(`
    CREATE TABLE users(id varchar PRIMARY KEY,name text,email text,is_active boolean);
    CREATE TABLE crm_properties(id varchar PRIMARY KEY,name text);
    CREATE TABLE available_units(id varchar PRIMARY KEY,unit_name text,property_id varchar);
    CREATE TABLE unit_viewings(id varchar PRIMARY KEY,unit_id varchar,company_id varchar,contact_id varchar,agent_contact_id varchar,
      owner_user_id varchar,viewing_date text,viewing_time text,status text,outcome text,details_confirmed_at timestamptz,
      next_action text,follow_up_date text,created_at timestamptz,deleted_at timestamptz,company_name text);
    CREATE TABLE user_tasks(id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,user_id varchar NOT NULL,title text,description text,
      priority text,category text,status text,due_date timestamptz,completed_at timestamptz,linked_property_id varchar,
      linked_contact_id varchar,created_at timestamptz DEFAULT now());
    INSERT INTO users VALUES('owner-1','Owner One','one@brucegillinghampollard.com',true),('owner-2','Owner Two','two@brucegillinghampollard.com',true);
    INSERT INTO crm_properties VALUES('property-1','QA Property');
    INSERT INTO available_units VALUES('unit-1','QA Unit','property-1');
    INSERT INTO unit_viewings VALUES('viewing-1','unit-1','brand-1','contact-1',NULL,'owner-1','2026-09-18','14:00','scheduled',NULL,'2026-09-17',NULL,NULL,'2026-09-16',NULL,'QA Brand');
  `);
  await ensureViewingFollowupSchema(db);
  await ensureViewingFollowupSchema(db);
  const first = await reconcileViewingFollowup('viewing-1', { db, now });
  check('one explicit-owner task created with property link', () => { assert.equal(first.created, 1); assert.ok(first.taskId); });
  let tasks = (await db.query('SELECT * FROM user_tasks')).rows;
  check('owner and source linkage are canonical', () => { assert.equal(tasks[0].user_id, 'owner-1'); assert.equal(tasks[0].linked_property_id, 'property-1'); assert.equal(tasks[0].source_ref, 'viewing_followup:viewing-1'); assert.match(tasks[0].description, /\/available\?tab=viewings&viewingId=viewing-1/); });
  await Promise.all(Array.from({ length: 6 }, () => reconcileViewingFollowup('viewing-1', { db, now })));
  tasks = (await db.query('SELECT * FROM user_tasks')).rows;
  check('concurrent reconciliations do not duplicate task', () => assert.equal(tasks.length, 1));
  await db.query("UPDATE user_tasks SET status='done',completed_at=now()");
  const reopened = await reconcileViewingFollowup('viewing-1', { db, now });
  check('manual completion reopens while viewing remains incomplete', () => { assert.equal(reopened.reopened, 1); assert.equal(reopened.taskId, first.taskId); });
  await db.query("UPDATE unit_viewings SET owner_user_id='owner-2'");
  await reconcileViewingFollowup('viewing-1', { db, now });
  tasks = (await db.query('SELECT * FROM user_tasks')).rows;
  check('reassignment updates the same task', () => { assert.equal(tasks[0].id, first.taskId); assert.equal(tasks[0].user_id, 'owner-2'); });
  await db.query("UPDATE unit_viewings SET status='completed',outcome='Interested'");
  const resolved = await reconcileViewingFollowup('viewing-1', { db, now });
  check('recording outcome closes task', () => assert.equal(resolved.resolved, 1));
  await db.query("UPDATE unit_viewings SET outcome=NULL");
  const cleared = await reconcileViewingFollowup('viewing-1', { db, now });
  await db.query("UPDATE unit_viewings SET status='cancelled'");
  const cancelled = await reconcileViewingFollowup('viewing-1', { db, now });
  check('cleared outcome reopens and cancellation closes same task', () => { assert.equal(cleared.reopened, 1); assert.equal(cleared.taskId, first.taskId); assert.equal(cancelled.resolved, 1); });
  await db.query("UPDATE unit_viewings SET status='scheduled',owner_user_id=NULL");
  const unowned = await reconcileViewingFollowup('viewing-1', { db, now });
  check('unassigned viewing is reported instead of selecting arbitrary property agent', () => { assert.equal(unowned.skippedNoOwner, 1); assert.equal(unowned.created, 0); });
  await db.query("UPDATE unit_viewings SET owner_user_id='owner-2'");
  const previousEmailFlag = process.env.VIEWING_REMINDER_EMAILS_ENABLED;
  delete process.env.VIEWING_REMINDER_EMAILS_ENABLED;
  const silent = await runViewingFollowupSweep({ db, now, sendEmail });
  if (previousEmailFlag !== undefined) process.env.VIEWING_REMINDER_EMAILS_ENABLED = previousEmailFlag;
  check('email remains disabled and no delivery claims are made', () => { assert.equal(silent.emailEnabled, false); assert.equal(emails.length, 0); });
  assert.equal((await db.query('SELECT count(*)::int n FROM viewing_reminder_deliveries')).rows[0].n, 0);
  const once = await runViewingFollowupSweep({ db, now, emailEnabled: true, sendEmail });
  await runViewingFollowupSweep({ db, now, emailEnabled: true, sendEmail });
  check('overdue reminder is durable and deduped per owner/day', () => { assert.equal(once.emailsSent, 1); assert.equal(emails.length, 1); assert.equal(emails[0].to, 'two@brucegillinghampollard.com'); assert.match(emails[0].body, /https:\/\/chatbgp\.app\/available\?tab=viewings&viewingId=viewing-1/); });
  const nextDay = new Date('2026-09-23T10:00:00Z');
  const concurrent = await Promise.all([runViewingFollowupSweep({ db, now: nextDay, emailEnabled: true, sendEmail }), runViewingFollowupSweep({ db, now: nextDay, emailEnabled: true, sendEmail })]);
  check('concurrent sweeps send one digest', () => { assert.equal(concurrent.reduce((n,r) => n+r.emailsSent, 0), 1); assert.equal(emails.length, 2); });
  let failures = 0;
  const failedSender = async () => { failures++; throw new Error('simulated delivery timeout'); };
  const failedDay = new Date('2026-09-24T10:00:00Z');
  const failed = await runViewingFollowupSweep({ db, now: failedDay, emailEnabled: true, sendEmail: failedSender });
  await runViewingFollowupSweep({ db, now: failedDay, emailEnabled: true, sendEmail: failedSender });
  check('uncertain sends are recorded and not automatically duplicated', () => { assert.equal(failed.emailsFailed, 1); assert.equal(failures, 1); });
  assert.equal((await db.query("SELECT status FROM viewing_reminder_deliveries WHERE period_key='2026-09-24'")).rows[0].status, 'failed');
  const beforeWeekend = emails.length;
  for (const day of ['2026-09-26', '2026-09-27']) {
    const weekend = await runViewingFollowupSweep({ db, now: new Date(`${day}T10:00:00Z`), emailEnabled: true, sendEmail });
    assert.equal(weekend.emailsSent, 0);
    assert.ok(weekend.updated > 0, 'source tasks still reconcile at weekends');
  }
  const weekendClaims = (await db.query("SELECT count(*)::int n FROM viewing_reminder_deliveries WHERE period_key IN ('2026-09-26','2026-09-27')")).rows[0].n;
  check('weekend sweeps reconcile tasks without sending or claiming reminders', () => { assert.equal(emails.length, beforeWeekend); assert.equal(weekendClaims, 0); });
  await db.query("UPDATE unit_viewings SET details_confirmed_at=NULL,created_at='2026-09-28T08:00:00Z',viewing_date='2026-10-02'");
  const monday = await runViewingFollowupSweep({ db, now: new Date('2026-09-28T10:00:00Z'), emailEnabled: true, sendEmail });
  check('Monday summary includes fresh actions once without an extra overdue email', () => { assert.equal(monday.emailsSent, 1); assert.match(emails.at(-1).subject, /Weekly viewing review/); });
  await db.query("UPDATE unit_viewings SET deleted_at=now()");
  const deleted = await reconcileViewingFollowup('viewing-1', { db, now });
  check('deleted source closes task', () => assert.equal(deleted.resolved, 1));
  await db.query("UPDATE user_tasks SET status='todo'; DELETE FROM unit_viewings");
  const orphan = await runViewingFollowupSweep({ db, now, emailEnabled: false, sendEmail });
  check('hard-deleted legacy source closes task via durable source_ref', () => assert.equal(orphan.resolved, 1));
  console.log(`${checks} PostgreSQL follow-up checks passed; no real email sender was loaded.`);
} finally {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
