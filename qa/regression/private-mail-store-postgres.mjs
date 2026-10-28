import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensurePrivateMailBoundary, flushPrivateMailQuarantine, blockPrivateMailCopies } from '../../server/private-mail-store.ts';

const secret = 'synthetic-test-secret';
const address = 'equity@brucegillinghampollard.com';

test('private mail migration removes copies, seals source records, blocks reingestion and leaves normal CRM facts intact', async () => {
  const schema = `private_mail_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host: '/tmp', database: 'postgres', max: 1 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`CREATE TABLE crm_interactions(id TEXT PRIMARY KEY, bgp_user TEXT, participants JSONB, microsoft_id TEXT, subject TEXT);
      CREATE TABLE crm_companies(id TEXT PRIMARY KEY, ai_generated_fields JSONB);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP);
      CREATE TABLE daily_briefings(id TEXT, briefing TEXT);
      INSERT INTO daily_briefings VALUES ('old','Outdated synthetic email summary');
      INSERT INTO crm_companies VALUES ('normal','{"email_summary":{"text":"stale"},"manual_fact":"retain"}');
      INSERT INTO system_settings VALUES ('brand-prepared-take:normal:activity','{"text":"stale"}',now()), ('keep-setting','{}',now());`);
    const insert = (id, mailbox, participants, ms=id) => pool.query('INSERT INTO crm_interactions VALUES ($1,$2,$3,$4,$5)', [id,mailbox,JSON.stringify(participants),ms,'Confidential synthetic text']);
    await insert('private', address, ['client@example.test']);
    await insert('copy', 'staff@example.test', ['client@example.test', address.toUpperCase()], 'same-message');
    await insert('incomplete-copy', 'staff2@example.test', ['client@example.test'], 'same-message');
    await insert('alias', 'staff@example.test', [{emailAddress:{address:'Equity <equity+alias@brucegillinghampollard.com>'}}]);
    await insert('safe', 'staff@example.test', ['notequity@brucegillinghampollard.com', 'equity@brucegillinghampollard.com.evil']);
    await assert.rejects(ensurePrivateMailBoundary(pool, ''), /secret/i);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM crm_interactions')).rows[0].n, 5, 'missing archive secret rolls everything back');
    assert.equal(await ensurePrivateMailBoundary(pool, secret), 4);
    assert.deepEqual((await pool.query('SELECT id FROM crm_interactions')).rows.map(r=>r.id), ['safe']);
    const sealed = (await pool.query('SELECT sealed_record FROM private_mail_quarantine')).rows[0].sealed_record;
    assert.ok(!sealed.includes(address)); assert.ok(!sealed.includes('Confidential'));
    const [version, iv, tag, ciphertext] = sealed.split(':'); assert.equal(version, 'v1');
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(`bgp-private-mail-archive:v1:${secret}`).digest(), Buffer.from(iv,'base64'));
    decipher.setAuthTag(Buffer.from(tag,'base64'));
    assert.match(Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64')),decipher.final()]).toString(), /Confidential synthetic text/);
    assert.deepEqual((await pool.query('SELECT ai_generated_fields FROM crm_companies')).rows[0].ai_generated_fields, {manual_fact:'retain'});
    assert.deepEqual((await pool.query("SELECT key FROM system_settings WHERE key NOT LIKE 'private-mail%'")).rows.map(r=>r.key), ['keep-setting']);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM daily_briefings')).rows[0].n, 0);
    assert.equal((await insert('blocked', address, [])).rowCount, 0);
    assert.equal((await insert('blocked-copy','staff@example.test',[],'same-message')).rowCount, 0);
    assert.equal((await insert('normal-new','staff@example.test',['client@example.test'])).rowCount, 1);
    assert.equal(await ensurePrivateMailBoundary(pool, secret), 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM private_mail_quarantine')).rows[0].n, 4);
    await insert('late-copy','staff@example.test',[],'late-private');
    assert.equal((await insert('late-private',address,[],'late-private')).rowCount,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM crm_interactions WHERE microsoft_id='late-private'")).rows[0].n,0,'a later private observation removes the old incomplete copy immediately');
    await insert('update-copy','staff@example.test',[],'updated-private');
    await pool.query('UPDATE crm_interactions SET participants=$1 WHERE id=$2',[JSON.stringify([address]),'update-copy']);
    assert.equal((await pool.query("SELECT count(*)::int n FROM crm_interactions WHERE id='update-copy'")).rows[0].n,0,'updates revealing privacy also remove the old row');
    await insert('graph-copy','staff@example.test',[],'email_graph-private');
    await blockPrivateMailCopies(pool,{id:'graph-private'},'staff@example.test','messages');
    assert.equal((await pool.query("SELECT count(*)::int n FROM crm_interactions WHERE id='graph-copy'")).rows[0].n,0,'Graph prefilter registers private IDs before dropping the response');
    assert.equal(await flushPrivateMailQuarantine(pool,secret),3);
    assert.equal(await flushPrivateMailQuarantine(pool,secret),0,'archive maintenance is idempotent');
    assert.equal((await pool.query('SELECT count(*)::int n FROM private_mail_pending_quarantine')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM private_mail_quarantine')).rows[0].n,7);
    await insert('manual-copy','staff@example.test',[],null);
    await pool.query('UPDATE crm_interactions SET participants=$1 WHERE id=$2',[JSON.stringify([address]),'manual-copy']);
    assert.equal((await pool.query("SELECT count(*)::int n FROM crm_interactions WHERE id='manual-copy'")).rows[0].n,0,'manual rows without Microsoft IDs are removed when newly identified as private');
    assert.equal(await flushPrivateMailQuarantine(pool,secret),1);
    await insert('legacy-event-copy','staff@example.test',[],'cal_legacy-private-event');
    await insert('current-event-copy','staff@example.test',[],'cal_staff@example.test_private-event-uid');
    await blockPrivateMailCopies(pool,{id:'legacy-private-event',iCalUId:'private-event-uid'},'staff@example.test','events');
    assert.equal((await pool.query("SELECT count(*)::int n FROM crm_interactions WHERE id IN ('legacy-event-copy','current-event-copy')")).rows[0].n,0,'Graph privacy observation removes both legacy and mailbox-scoped stored calendar copies');
    assert.equal(await flushPrivateMailQuarantine(pool,secret),2);
    const concurrent = new pg.Pool({ host:'/tmp', database:'postgres', max:2, options:`-c search_path=${schema}` });
    const writer = await concurrent.connect();
    try {
      await writer.query('BEGIN');
      await writer.query("INSERT INTO crm_interactions VALUES ('in-flight','staff@example.test','[]','racing-copy','Synthetic')");
      let blockFinished = false;
      const block = blockPrivateMailCopies(concurrent,{id:'racing-copy'},'staff@example.test','messages').then(()=>{blockFinished=true;});
      await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(blockFinished,false,'privacy observation waits for the concurrent source write');
      await writer.query('COMMIT');
      await block;
      assert.equal((await pool.query("SELECT count(*)::int n FROM crm_interactions WHERE microsoft_id='racing-copy'")).rows[0].n,0,'a concurrent copy cannot appear after privacy is established');
    } finally { await writer.query('ROLLBACK'); writer.release(); await concurrent.end(); }
  } finally {
    await pool.query('SET search_path TO public');
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('startup quarantine completes multiple batches without revisiting retained mail or missing final partial batch', async () => {
  const schema = `private_mail_batches_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host: '/tmp', database: 'postgres', max: 1 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query(`CREATE TABLE crm_interactions(id TEXT PRIMARY KEY, bgp_user TEXT, participants JSONB, microsoft_id TEXT, subject TEXT);
      CREATE TABLE crm_companies(id TEXT PRIMARY KEY, ai_generated_fields JSONB);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP);`);
    await pool.query(`INSERT INTO crm_interactions
      SELECT lpad(n::text, 8, '0'), CASE WHEN n % 5 = 0 THEN $1 ELSE 'staff@example.test' END,
        '[]'::jsonb, 'synthetic-' || n, 'Synthetic batch regression'
      FROM generate_series(1, 6005) n`, [address]);
    assert.equal(await ensurePrivateMailBoundary(pool, secret), 1201);
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm_interactions')).rows[0].n, 4804);
    assert.equal((await pool.query('SELECT count(*)::int n FROM private_mail_quarantine')).rows[0].n, 1201);
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm_interactions WHERE bgp_user=$1', [address])).rows[0].n, 0);
    assert.equal(await ensurePrivateMailBoundary(pool, secret), 0);
  } finally {
    await pool.query('SET search_path TO public');
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('quarantine overrides a short pool read timeout while PostgreSQL owns statement cancellation', async () => {
  const schema = `private_mail_timeout_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host: '/tmp', database: 'postgres', max: 1, query_timeout: 25 });
  const setup = (text, values) => pool.query({ text, values, query_timeout: 2000 });
  try {
    await setup(`CREATE SCHEMA ${schema}`);
    await setup(`SET search_path TO ${schema}`);
    await setup(`CREATE TABLE crm_interactions(id TEXT PRIMARY KEY, bgp_user TEXT, participants JSONB, microsoft_id TEXT, subject TEXT);
      CREATE TABLE crm_companies(id TEXT PRIMARY KEY, ai_generated_fields JSONB);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP);
      CREATE TABLE private_mail_quarantine(source_id TEXT PRIMARY KEY, sealed_record TEXT NOT NULL, policy_version TEXT NOT NULL);
      CREATE FUNCTION slow_archive() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.075); RETURN NEW; END $$;
      CREATE TRIGGER archive_delay BEFORE INSERT ON private_mail_quarantine FOR EACH ROW EXECUTE FUNCTION slow_archive();`);
    await setup("INSERT INTO crm_interactions VALUES ('slow-private',$1,'[]','slow-private','Synthetic')", [address]);
    assert.equal(await ensurePrivateMailBoundary(pool, secret), 1, 'a valid 75ms statement must not inherit the 25ms client read timeout');
    await setup("INSERT INTO private_mail_pending_quarantine VALUES ('later-private','{}')");
    assert.equal(await flushPrivateMailQuarantine(pool, secret), 1, 'buffer maintenance uses the same positive timeout override');
    await setup("INSERT INTO private_mail_pending_quarantine VALUES ('cancelled-private','{}')");
    await setup("CREATE OR REPLACE FUNCTION slow_archive() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$");
    // Shorten only the explicit server-side deadline so this regression can
    // exercise real cancellation without waiting 30 seconds.
    const shortStatementPool = { connect: async () => {
      const client = await pool.connect();
      return {
        query: config => client.query(config.text === "SET LOCAL statement_timeout = '30s'"
          ? { ...config, text: "SET LOCAL statement_timeout = '30ms'" } : config),
        release: error => client.release(error),
      };
    } };
    await assert.rejects(flushPrivateMailQuarantine(shortStatementPool, secret), error => error.code === '57014');
    assert.equal((await setup("SELECT count(*)::int n FROM private_mail_pending_quarantine WHERE source_id='cancelled-private'")).rows[0].n, 1, 'cancelled archive remains excluded and retryable');
    assert.equal((await setup("SELECT count(*)::int n FROM private_mail_quarantine WHERE source_id='cancelled-private'")).rows[0].n, 0, 'failed statement was rolled back');
    assert.equal((await setup('SELECT 1 AS healthy')).rows[0].healthy, 1, 'connection is usable after SQL cancellation and rollback');
  } finally {
    await setup('SET search_path TO public');
    await setup(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('client read timeout destroys the private transaction connection without queuing a rollback', async () => {
  for (const operation of [ensurePrivateMailBoundary, flushPrivateMailQuarantine]) {
    const calls = [];
    const timeout = new Error('Query read timeout');
    let released;
    const pool = { connect: async () => ({
      query: async config => { calls.push(config.text); throw timeout; },
      release: error => { released = error; },
    }) };
    await assert.rejects(operation(pool, secret), error => error === timeout);
    assert.equal(released, timeout, 'release(error) discards the socket and rolls back the abandoned backend transaction');
    assert.deepEqual(calls, ['BEGIN'], 'no ROLLBACK is queued behind a query that may still be executing');
  }
});
