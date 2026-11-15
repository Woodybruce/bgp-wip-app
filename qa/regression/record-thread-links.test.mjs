// A property's shared conversation when the property goes (15 November 2026):
// deleted with it, joined to the keeper on a merge, and left out of the
// Messages list when its property is already gone. Also the two phone
// tidy-ups found with it: one property tag on a Messages row, and the
// property page's fact pills at one height.
//
// The merge's SQL runs for real in a throwaway schema of a local disposable
// database; the other tests need none. After `bash qa/start-postgres.sh`:
// RECORD_THREAD_DATABASE_URL='postgresql://postgres:qa-local-pg@127.0.0.1:5432/postgres' node --import tsx --test qa/regression/record-thread-links.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { RECORD_THREAD_CREATOR, mergeSharedPropertyThreads } from '../../server/record-thread-links.ts';

const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const supplied = process.env.RECORD_THREAD_DATABASE_URL;
const skip = supplied ? false : 'Provide RECORD_THREAD_DATABASE_URL (a local disposable database) to run';

test('the marker is the one the shared conversation is made with', () => {
  assert.equal(RECORD_THREAD_CREATOR, '__record__');
  assert.match(source('server/record-conversation.ts'), /export const RECORD_THREAD_CREATOR = "__record__";/);
});

test('a merge with no shared conversation on the duplicate touches nothing', async () => {
  const calls = [];
  const run = async (sql, params) => { calls.push(sql); return { rows: [] }; };
  assert.equal(await mergeSharedPropertyThreads(run, 'keep', 'dupe', 'Keeper'), 'none');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^SELECT id FROM chat_threads/);
});

test('deleting a property removes its shared conversation inside the same transaction, before the property', () => {
  const storage = source('server/storage.ts');
  const body = storage.slice(storage.indexOf('async deleteCrmProperty(id: string)'), storage.indexOf('async getCrmDeals('));
  assert.match(body, /await db\.transaction\(async \(tx\) => \{/);
  // Only the shared one: made by the marker and linked to this property.
  assert.match(body, /eq\(chatThreads\.createdBy, RECORD_THREAD_CREATOR\), eq\(chatThreads\.linkedType, "property"\), eq\(chatThreads\.linkedId, id\)/);
  const order = ['tx.delete(chatMessages)', 'tx.delete(chatThreadMembers)', 'tx.delete(chatThreads)', 'tx.delete(crmProperties)'].map(step => body.indexOf(step));
  assert.ok(order.every(at => at > 0), 'every step is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'messages, members, the thread, then the property');
  assert.doesNotMatch(body, /db\.delete\(chat/, 'nothing outside the transaction');
});

test('a merge moves or joins the conversation before the duplicate is removed', () => {
  const merge = source('server/property-merge.ts');
  const at = merge.indexOf('await mergeSharedPropertyThreads(q, keepId, mergeId, String(keep.name || ""));');
  assert.ok(at > 0);
  assert.ok(at < merge.indexOf('await q(`DELETE FROM crm_properties WHERE id = $1`, [mergeId]);'));
  assert.ok(at > merge.indexOf('await q("BEGIN");'), 'inside the merge transaction');
});

test('the Messages list leaves out a shared conversation whose property is gone', () => {
  const routes = source('server/routes.ts');
  const list = routes.slice(routes.indexOf('app.get("/api/chat/threads", requireAuth'), routes.indexOf('last_messages AS ('));
  assert.match(list, /WHERE \(t\.created_by = \$1 OR m\.user_id = \$1\)/);
  assert.match(list, /AND NOT \(t\.created_by = '__record__' AND t\.linked_type = 'property'\s+AND NOT EXISTS \(SELECT 1 FROM crm_properties rp WHERE rp\.id = t\.linked_id\)\)/);
});

test('a phone Messages row names the property once', () => {
  assert.match(source('client/src/components/mobile-app.tsx'), /\{thread\.linkedName && thread\.linkedName !== thread\.propertyName && \(/);
});

test("the property page's fact pills are one height on a phone", () => {
  const css = source('client/src/index.css');
  const rule = css.slice(css.indexOf('@media (max-width: 767px) {\n  button:not([data-no-min-touch])'));
  const selectors = rule.slice(0, rule.indexOf('{', rule.indexOf('button:not'))).split(',\n').map(s => s.trim());
  assert.equal(selectors.length, 2);
  for (const selector of selectors) assert.ok(selector.endsWith(':not([data-compact-taps] *)'), selector);
  assert.match(source('client/src/components/property-detail.tsx'), /data-testid="property-facts" data-compact-taps>/);
});

test('the merge keeps every message and each person once, for real', { skip }, async () => {
  if (!['', 'localhost', '127.0.0.1'].includes(new URL(supplied).hostname)) throw new Error('Refusing a database that is not local');
  const pool = new pg.Pool({ connectionString: supplied, ssl: false, max: 1 });
  const schema = `rtl_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const client = await pool.connect();
  const run = (sql, params = []) => client.query(sql, params);
  try {
    await run(`CREATE SCHEMA ${schema}`);
    await run(`SET search_path TO ${schema}`);
    await run(`CREATE TABLE chat_threads (id varchar PRIMARY KEY, title text, created_by varchar, property_id varchar, property_name text,
      linked_type text, linked_id varchar, linked_name text, created_at timestamp DEFAULT now())`);
    await run(`CREATE TABLE chat_messages (id varchar PRIMARY KEY, thread_id varchar NOT NULL, content text)`);
    await run(`CREATE TABLE chat_thread_members (id varchar PRIMARY KEY DEFAULT md5(random()::text), thread_id varchar NOT NULL, user_id varchar NOT NULL, seen boolean DEFAULT false)`);
    const thread = (id, by, propertyId, at) => run(
      `INSERT INTO chat_threads (id, title, created_by, property_id, property_name, linked_type, linked_id, linked_name, created_at)
       VALUES ($1, 'Old — conversation', $2, $3, 'Old', 'property', $3, 'Old', $4)`, [id, by, propertyId, at]);
    const members = async (threadId) => (await run(`SELECT user_id, seen FROM chat_thread_members WHERE thread_id = $1 ORDER BY user_id`, [threadId])).rows;

    // 1. The keeper has none: the duplicate's conversation moves across whole, renamed.
    await thread('t-dupe', RECORD_THREAD_CREATOR, 'dupe', '2026-11-01');
    await thread('t-own', 'u-anna', 'dupe', '2026-11-02');            // a person's own thread, linked to the same property
    await run(`INSERT INTO chat_messages VALUES ('m1', 't-dupe', 'first'), ('m2', 't-dupe', 'second'), ('m3', 't-own', 'mine')`);
    await run(`INSERT INTO chat_thread_members (thread_id, user_id, seen) VALUES ('t-dupe', 'u-anna', true), ('t-dupe', 'u-ben', false)`);
    assert.equal(await mergeSharedPropertyThreads(run, 'keep', 'dupe', 'Trinity Leeds'), 'moved');
    assert.deepEqual((await run(`SELECT id, title, property_id, linked_id, linked_name, property_name FROM chat_threads WHERE created_by = $1`, [RECORD_THREAD_CREATOR])).rows,
      [{ id: 't-dupe', title: 'Trinity Leeds — conversation', property_id: 'keep', linked_id: 'keep', linked_name: 'Trinity Leeds', property_name: 'Trinity Leeds' }]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM chat_messages WHERE thread_id = 't-dupe'`)).rows[0].n, 2);
    assert.deepEqual((await run(`SELECT linked_id FROM chat_threads WHERE id = 't-own'`)).rows, [{ linked_id: 'dupe' }], "a person's own thread is left alone");

    // 2. Both have one: the messages and the people join the keeper's, each person once.
    await thread('t-dupe2', RECORD_THREAD_CREATOR, 'dupe2', '2026-11-03');
    await run(`INSERT INTO chat_messages VALUES ('m4', 't-dupe2', 'third')`);
    await run(`INSERT INTO chat_thread_members (thread_id, user_id, seen) VALUES ('t-dupe2', 'u-anna', false), ('t-dupe2', 'u-cal', true)`);
    assert.equal(await mergeSharedPropertyThreads(run, 'keep', 'dupe2', 'Trinity Leeds'), 'joined');
    assert.deepEqual((await run(`SELECT id FROM chat_threads WHERE created_by = $1`, [RECORD_THREAD_CREATOR])).rows, [{ id: 't-dupe' }]);
    assert.deepEqual((await run(`SELECT id FROM chat_messages WHERE thread_id = 't-dupe' ORDER BY id`)).rows.map(r => r.id), ['m1', 'm2', 'm4']);
    // Anna was in both and unread in the joined one: one membership, unread. Cal came across.
    assert.deepEqual(await members('t-dupe'), [{ user_id: 'u-anna', seen: false }, { user_id: 'u-ben', seen: false }, { user_id: 'u-cal', seen: true }]);
    assert.equal((await run(`SELECT count(*)::int AS n FROM chat_thread_members WHERE thread_id = 't-dupe2'`)).rows[0].n, 0);

    // 3. Nothing to merge.
    assert.equal(await mergeSharedPropertyThreads(run, 'keep', 'nobody', 'Trinity Leeds'), 'none');
  } finally {
    await run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    client.release();
    await pool.end();
  }
});
