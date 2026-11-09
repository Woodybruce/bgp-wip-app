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

test('startup retries a contended privacy lock only after rollback and does not become ready early', async () => {
  const schema = `private_mail_retry_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host:'/tmp', database:'postgres', max:2, options:`-c search_path=${schema}` });
  let blocker;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE crm_interactions(id TEXT PRIMARY KEY, bgp_user TEXT, participants JSONB, microsoft_id TEXT, subject TEXT);
      CREATE TABLE crm_companies(id TEXT PRIMARY KEY, ai_generated_fields JSONB);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP);
      INSERT INTO crm_interactions VALUES ('retry-private','equity@brucegillinghampollard.com','[]','retry-private','Synthetic');`);
    blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(271027631)');
    let connections = 0, ready = false, rolledBack = false;
    const retryPool = { connect:async()=>{
      connections++;
      const client = await pool.connect();
      return {
        query:async config=>{
          if (config.text === 'ROLLBACK') {
            const result = await client.query(config);
            rolledBack = true;
            assert.equal(ready,false,'startup stays blocked while a failed privacy transaction is rolled back');
            await blocker.query('ROLLBACK');
            return result;
          }
          if (connections > 1) assert.equal(rolledBack,true,'new attempt starts only after clean rollback');
          return client.query(config.text === "SET LOCAL lock_timeout = '5s'"
            ? {...config,text:"SET LOCAL lock_timeout = '20ms'"} : config);
        },
        release:error=>client.release(error),
      };
    }};
    const removed = await ensurePrivateMailBoundary(retryPool,secret,{maxAttempts:2,retryDelayMs:0}).then(value=>{ready=true;return value;});
    assert.equal(connections,2);
    assert.equal(removed,1);
    assert.equal(ready,true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm_interactions')).rows[0].n,0);
    assert.equal((await pool.query("INSERT INTO crm_interactions VALUES ('blocked','equity@brucegillinghampollard.com','[]','blocked','Synthetic')")).rowCount,0);
  } finally {
    if (blocker) {await blocker.query('ROLLBACK');blocker.release();}
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('persistent startup lock contention rejects with a named stage and leaves no partial migration', async () => {
  const schema = `private_mail_exhausted_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ host:'/tmp', database:'postgres', max:2, options:`-c search_path=${schema}` });
  let blocker;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE crm_interactions(id TEXT PRIMARY KEY, bgp_user TEXT, participants JSONB, microsoft_id TEXT, subject TEXT);
      CREATE TABLE crm_companies(id TEXT PRIMARY KEY, ai_generated_fields JSONB);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP);`);
    blocker=await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(271027631)');
    let attempts=0,rollbacks=0,releases=0,ready=false;
    const retryPool={connect:async()=>{
      attempts++;
      const client=await pool.connect();
      return {query:config=>{
        if(config.text==='ROLLBACK')rollbacks++;
        return client.query(config.text==="SET LOCAL lock_timeout = '5s'"?{...config,text:"SET LOCAL lock_timeout = '20ms'"}:config);
      },release:error=>{releases++;client.release(error);}};
    }};
    await assert.rejects(ensurePrivateMailBoundary(retryPool,secret,{maxAttempts:2,retryDelayMs:0}).then(()=>{ready=true;}),
      error=>error.code==='55P03'&&error.privateMailStage==='startup lock');
    assert.equal(ready,false);
    assert.equal(attempts,2);
    assert.equal(rollbacks,2);
    assert.equal(releases,2);
    assert.equal((await pool.query("SELECT to_regclass('private_mail_quarantine') present")).rows[0].present,null);
  } finally {
    if(blocker){await blocker.query('ROLLBACK');blocker.release();}
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});

test('startup does not retry configuration errors or start another attempt outside its retry window',async()=>{
  for(const [code,options,expectedAttempts] of [['42501',{},1],['57014',{maxRetryWindowMs:0},1]]){
    const failure=Object.assign(new Error('Synthetic database error'),{code});
    let attempts=0;
    const pool={connect:async()=>{attempts++;return {query:async config=>{
      if(config.text!=='ROLLBACK')throw failure;
      return {rows:[]};
    },release:()=>{}};}};
    await assert.rejects(ensurePrivateMailBoundary(pool,secret,{...options,retryDelayMs:0}),error=>error===failure);
    assert.equal(attempts,expectedAttempts);
    assert.equal(failure.privateMailStage,'begin transaction');
  }
});

test('startup reuses only a complete enabled privacy trigger and repairs weaker definitions',async t=>{
  const schema=`private_mail_trigger_${randomUUID().replaceAll('-','')}`;
  const otherSchema=`${schema}_other`;
  const pool=new pg.Pool({host:'/tmp',database:'postgres',max:2,options:`-c search_path=${schema}`});
  try {
    await pool.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${otherSchema};
      CREATE TABLE crm_interactions(id TEXT PRIMARY KEY,bgp_user TEXT,participants JSONB,microsoft_id TEXT,subject TEXT);
      CREATE TABLE crm_companies(id TEXT PRIMARY KEY,ai_generated_fields JSONB);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY,value JSONB,updated_at TIMESTAMP);
      CREATE FUNCTION ${otherSchema}.bgp_reject_private_interaction() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);
    await ensurePrivateMailBoundary(pool,secret);
    const trigger=()=>pool.query(`SELECT oid,tgtype,tgenabled,tgqual IS NULL unconditional,tgattr=''::int2vector all_columns,
      tgfoid='bgp_reject_private_interaction()'::regprocedure correct_function FROM pg_trigger
      WHERE tgname='bgp_private_mail_boundary' AND tgrelid='crm_interactions'::regclass`);
    await t.test('unchanged valid trigger is reused even while a reader holds a table lock',async()=>{
      const before=(await trigger()).rows[0];
      const reader=await pool.connect();
      try {
        await reader.query('BEGIN');
        await reader.query('SELECT * FROM crm_interactions');
        // A short deadline makes an unnecessary DROP/CREATE fail this test.
        const shortLockPool={connect:async()=>{
          const client=await pool.connect();
          return {query:config=>client.query(config.text==="SET LOCAL lock_timeout = '5s'"
            ?{...config,text:"SET LOCAL lock_timeout = '30ms'"}:config),release:error=>client.release(error)};
        }};
        assert.equal(await ensurePrivateMailBoundary(shortLockPool,secret,{maxAttempts:1}),0);
        assert.equal((await trigger()).rows[0].oid,before.oid,'valid trigger is retained rather than recreated');
      } finally {await reader.query('ROLLBACK');reader.release();}
    });
    const variants=[
      ['missing',''],
      ['disabled',`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT OR UPDATE ON crm_interactions FOR EACH ROW EXECUTE FUNCTION bgp_reject_private_interaction(); ALTER TABLE crm_interactions DISABLE TRIGGER bgp_private_mail_boundary`],
      ['replica-only',`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT OR UPDATE ON crm_interactions FOR EACH ROW EXECUTE FUNCTION bgp_reject_private_interaction(); ALTER TABLE crm_interactions ENABLE REPLICA TRIGGER bgp_private_mail_boundary`],
      ['missing-update',`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT ON crm_interactions FOR EACH ROW EXECUTE FUNCTION bgp_reject_private_interaction()`],
      ['conditional',`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT OR UPDATE ON crm_interactions FOR EACH ROW WHEN (NEW.subject IS NOT NULL) EXECUTE FUNCTION bgp_reject_private_interaction()`],
      ['column-limited',`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT OR UPDATE OF subject ON crm_interactions FOR EACH ROW EXECUTE FUNCTION bgp_reject_private_interaction()`],
      ['wrong-function-schema',`CREATE TRIGGER bgp_private_mail_boundary BEFORE INSERT OR UPDATE ON crm_interactions FOR EACH ROW EXECUTE FUNCTION ${otherSchema}.bgp_reject_private_interaction()`],
    ];
    for(const [name,definition] of variants)await t.test(`repairs ${name} trigger before reporting readiness`,async()=>{
      await pool.query('DROP TRIGGER IF EXISTS bgp_private_mail_boundary ON crm_interactions');
      if(definition)await pool.query(definition);
      await ensurePrivateMailBoundary(pool,secret,{maxAttempts:1});
      const row=(await trigger()).rows[0];
      assert.equal(row.tgtype,23);
      assert.equal(row.tgenabled,'O');
      assert.equal(row.unconditional,true);
      assert.equal(row.all_columns,true);
      assert.equal(row.correct_function,true);
      assert.equal((await pool.query("INSERT INTO crm_interactions VALUES ($1,$2,'[]',$1,'Synthetic')",[`${name}-private`,address])).rowCount,0);
      await pool.query("INSERT INTO crm_interactions VALUES ($1,'staff@example.test','[]',$1,'Synthetic')",[`${name}-update`]);
      await pool.query('UPDATE crm_interactions SET participants=$1 WHERE id=$2',[JSON.stringify([address]),`${name}-update`]);
      assert.equal((await pool.query('SELECT count(*)::int n FROM crm_interactions WHERE id=$1',[`${name}-update`])).rows[0].n,0);
    });
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${otherSchema} CASCADE`);
    await pool.end();
  }
});
