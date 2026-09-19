import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { getBrandIdentity } from '../../server/brand-identity.ts';
import { currentOfficialProfileEvidence } from '../../server/brand-profile-evidence.ts';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/brand-core-refresh.ts';
const fn = name => find(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const keySource = find(file, node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(d => d.name.getText() === 'keyFor'));
const coreSource = fn('prepareBrandCore').replace(/await import\("\.\/brand-enrichment"\)/g, '__enrichment')
  .replace(/await import\("\.\/brand-ai-take"\)/g, '__brief');

function company(verified = true) {
  return { id: 'hammerson', name: 'Hammerson', domain: 'hammerson.com', ai_generated_fields: verified
    ? { brand_identity: { status: 'verified', domain: 'hammerson.com' } } : {} };
}
const readyProfile = (overrides = {}) => ({ stage: 'profile', status: 'ready', nextAttemptAt: new Date(Date.now() + 86400000).toISOString(), ...overrides });

function fixture({ verified = true, states = [readyProfile()], outcomes = {}, savedBrief = { text: 'A supported saved action brief.', pending: false }, row = company(verified), enqueueError } = {}) {
  const stages = [], progress = [], calls = [], current = row;
  const compiled = evaluate(coreSource, {
    getBrandIdentity, currentOfficialProfileEvidence, console: { warn() {} },
    pool: { query: async sql => { calls.push(sql); return { rows: [current] }; } },
    readPreparationStates: async (_pool, id, fingerprint) => {
      assert.equal(id, current.id); assert.equal(fingerprint, getBrandIdentity(current).fingerprint); return states;
    },
    __enrichment: {
      prepareBrandStage: async (id, stage, force, options) => {
        assert.equal(id, current.id); assert.equal(force, true); stages.push({ stage, options });
        const result = outcomes[stage] || { state: { status: 'ready' }, result: { updated: stage === 'profile' ? ['description', 'industry'] : [] } };
        if (stage === 'identity' && result.state.status === 'ready' && result.reason !== 'daily_limit') {
          current.ai_generated_fields.brand_identity = { status: 'verified', domain: current.domain };
        }
        return result;
      },
      enqueueBrandPreparation: async id => { assert.equal(id, current.id); calls.push('enqueue'); if (enqueueError) throw enqueueError; },
    },
    __brief: { readPreparedBrandAiTake: async (id, tab) => { calls.push(`saved-brief:${id}:${tab}`); return savedBrief; } },
  });
  return { run: options => compiled.prepareBrandCore(current.id, options, async reason => { progress.push(reason); }), stages, progress, calls, current };
}

test('core refresh checks identity then profile then requested brief and verifies its persisted output', async () => {
  const f = fixture({ verified: false, states: [] });
  const result = await f.run({ tab: 'intel' });
  assert.deepEqual(f.stages.map(run => run.stage), ['identity', 'profile', 'brief']);
  assert.equal(f.stages.at(-1).options.tab, 'intel');
  assert.equal(result.status, 'done'); assert.deepEqual(Array.from(result.updated), ['description', 'industry']);
  assert.equal(f.progress.length, 3);
  assert.ok(f.calls.indexOf('saved-brief:hammerson:intel') < f.calls.indexOf('enqueue'));
});

test('verified identities and current ready profiles are reused, while explicit profile refresh still runs', async () => {
  const reused = fixture(); await reused.run();
  assert.deepEqual(reused.stages.map(run => run.stage), ['brief']);
  const forced = fixture(); await forced.run({ refreshProfile: true });
  assert.deepEqual(forced.stages.map(run => run.stage), ['profile', 'brief']);
});

test('expired, undated and invalidly dated profiles must be checked before generating a brief', async () => {
  for (const nextAttemptAt of ['2020-01-01T00:00:00Z', undefined, 'not-a-date']) {
    const f = fixture({ states: [readyProfile({ nextAttemptAt })] });
    const result = await f.run();
    assert.equal(result.status, 'done');
    assert.deepEqual(f.stages.map(run => run.stage), ['profile', 'brief'], String(nextAttemptAt));
  }
});

test('retained facts trigger a sourced profile check unless a current official evidence snapshot exists', async () => {
  const row = company(); row.ai_generated_fields.brand_identity.previousFactsNeedReview = true;
  const unchecked = fixture({ row }); await unchecked.run();
  assert.deepEqual(unchecked.stages.map(run => run.stage), ['profile', 'brief']);
  row.ai_generated_fields.official_profile = { fingerprint: getBrandIdentity(row).fingerprint,
    checkedAt: new Date().toISOString(), description: 'Property owner and operator.', industry: 'Real estate',
    url: 'https://hammerson.com/about', quote: 'Hammerson owns and operates prime urban real estate.' };
  const checked = fixture({ row }); await checked.run();
  assert.deepEqual(checked.stages.map(run => run.stage), ['brief']);
});

test('blocked or unavailable prerequisite stages stop downstream work without enqueuing success', async () => {
  for (const [stage, status] of [['identity', 'needs_review'], ['profile', 'unavailable'], ['profile', 'error'], ['brief', 'running']]) {
    const f = fixture({ verified: stage !== 'identity', states: [], outcomes: { [stage]: { state: { status, reason: `${stage} provider stopped` } } } });
    const result = await f.run();
    assert.equal(result.status, status === 'needs_review' ? 'needs_review' : 'error');
    assert.equal(result.reason, `${stage} provider stopped`);
    assert.equal(f.stages.at(-1).stage, stage);
    assert.equal(f.calls.includes('enqueue'), false);
    assert.equal(f.calls.some(call => call.startsWith('saved-brief:')), false);
  }
});

test('daily research limits cannot turn an old ready stage into a successful refresh', async () => {
  for (const stage of ['identity', 'profile', 'brief']) {
    const f = fixture({ verified: stage !== 'identity', states: [], outcomes: { [stage]: { ran: false, reason: 'daily_limit', state: { status: 'ready' } } } });
    const result = await f.run();
    assert.equal(result.status, 'error'); assert.match(result.reason, /limit/);
    assert.equal(f.stages.at(-1).stage, stage); assert.equal(f.calls.includes('enqueue'), false);
  }
});

test('a claimed ready brief requires actual non-pending saved text before success is reported', async () => {
  for (const savedBrief of [{ text: '' }, { text: '   ' }, { text: 'Unusable saved output', pending: true, reason: 'Identity changed' }]) {
    const f = fixture({ savedBrief }); const result = await f.run();
    assert.equal(result.status, 'error'); assert.equal(f.calls.includes('enqueue'), false);
    if (savedBrief.reason) assert.equal(result.reason, savedBrief.reason);
  }
});

test('disabled enrichment does not call any preparation stage or provider', async () => {
  const row = { ...company(), ai_disabled: true };
  const f = fixture({ row }); const result = await f.run();
  assert.equal(result.status, 'needs_review'); assert.match(result.reason, /disabled/);
  assert.equal(f.stages.length, 0); assert.equal(f.calls.includes('enqueue'), false);
});

test('failure to queue optional sections does not misreport a successfully prepared and saved core brief', async () => {
  const f = fixture({ enqueueError: new Error('Optional queue temporarily unavailable') });
  const result = await f.run();
  assert.equal(result.status, 'done');
  assert.ok(f.calls.includes('saved-brief:hammerson:brand')); assert.ok(f.calls.includes('enqueue'));
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function jobFixture(work, { failInitialWrite = false, failUpdates = false } = {}) {
  let held = false; const states = new Map(), queries = [], connections = [], finished = deferred();
  const sqlQuery = async (sql, values, connection) => {
    queries.push({ sql, values, connection: connection?.id });
    if (sql.includes('pg_try_advisory_lock')) { const locked = !held; if (locked) held = true; return { rows: [{ locked }] }; }
    if (sql.includes('pg_advisory_unlock')) { held = false; return { rows: [] }; }
    if (sql.startsWith('SELECT value')) return { rows: states.has(values[0]) ? [{ value: states.get(values[0]) }] : [] };
    if (sql.startsWith('INSERT INTO system_settings')) {
      if (failInitialWrite) throw new Error('Initial status write failed');
      states.set(values[0], JSON.parse(values[1])); return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith('UPDATE system_settings')) {
      if (failUpdates) throw new Error('Status update failed');
      if (states.get(values[0])?.claim !== values[2]) return { rowCount: 0, rows: [] };
      states.set(values[0], JSON.parse(values[1])); return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  };
  const pool = {
    query: (sql, values) => sqlQuery(sql, values),
    connect: async () => {
      const connection = { id: connections.length + 1, released: 0,
        query: (sql, values) => sqlQuery(sql, values, connection),
        release: () => { connection.released++; if (connection.id === 1) finished.resolve(); } };
      connections.push(connection); return connection;
    },
  };
  const compiled = evaluate(keySource + '\n' + fn('readBrandCoreRefresh') + '\n' + fn('startBrandCoreRefresh'), {
    pool, randomUUID: () => 'test-claim', prepareBrandCore: work, console: { error() {} },
  });
  return { ...compiled, states, queries, connections, finished: finished.promise, lockHeld: () => held };
}

test('async core job persists progress and completion, conceals claim and releases its advisory lock', async () => {
  const gate = deferred(), progressed = deferred();
  const f = jobFixture(async (id, options, progress) => {
    assert.equal(id, 'hammerson'); assert.equal(options.tab, 'uk');
    await progress('Checking the official profile…'); progressed.resolve(); await gate.promise;
    return { status: 'done', updated: ['industry'] };
  });
  const started = await f.startBrandCoreRefresh('hammerson', { tab: 'uk' });
  assert.equal(started.status, 'running'); assert.equal(started.claim, undefined);
  await progressed.promise;
  const current = await f.readBrandCoreRefresh('hammerson');
  assert.equal(current.status, 'running'); assert.equal(current.reason, 'Checking the official profile…'); assert.equal(current.claim, undefined);
  assert.equal(f.lockHeld(), true);
  gate.resolve(); await f.finished;
  const complete = await f.readBrandCoreRefresh('hammerson');
  assert.equal(complete.status, 'done'); assert.ok(complete.finishedAt); assert.equal(complete.claim, undefined);
  assert.equal(f.lockHeld(), false); assert.equal(f.connections[0].released, 1);
  assert.ok(f.queries.filter(query => query.sql.startsWith('UPDATE')).every(query => query.sql.includes("value->>'claim'=$3") && query.values[2] === 'test-claim'));
});

test('a concurrent core refresh reuses the running job rather than starting duplicate research', async () => {
  const gate = deferred(); let runs = 0;
  const f = jobFixture(async () => { runs++; await gate.promise; return { status: 'done' }; });
  await f.startBrandCoreRefresh('hammerson');
  const duplicate = await f.startBrandCoreRefresh('hammerson');
  assert.equal(duplicate.status, 'running'); assert.equal(runs, 1); assert.equal(f.connections[1].released, 1);
  assert.equal(f.lockHeld(), true);
  gate.resolve(); await f.finished;
  assert.equal(f.lockHeld(), false); assert.equal(f.connections[0].released, 1);
});

test('failed background work persists a useful error and always releases the lock and connection', async () => {
  const f = jobFixture(async () => { throw new Error('Official website could not be read'); });
  await f.startBrandCoreRefresh('hammerson'); await f.finished;
  const current = await f.readBrandCoreRefresh('hammerson');
  assert.equal(current.status, 'error'); assert.equal(current.reason, 'Official website could not be read'); assert.ok(current.finishedAt);
  assert.equal(f.lockHeld(), false); assert.equal(f.connections[0].released, 1);
});

test('status-write failures release acquired locks without reporting a completed job', async () => {
  let calls = 0;
  const initial = jobFixture(async () => { calls++; }, { failInitialWrite: true });
  await assert.rejects(() => initial.startBrandCoreRefresh('hammerson'), /Initial status write failed/);
  assert.equal(calls, 0); assert.equal(initial.lockHeld(), false); assert.equal(initial.connections[0].released, 1);
  const updates = jobFixture(async () => ({ status: 'done' }), { failUpdates: true });
  await updates.startBrandCoreRefresh('hammerson'); await updates.finished;
  assert.equal(updates.lockHeld(), false); assert.equal(updates.connections[0].released, 1);
  assert.notEqual((await updates.readBrandCoreRefresh('hammerson')).status, 'done');
});

test('expired or malformed running leases surface interruption instead of spinning indefinitely', async () => {
  const f = jobFixture(async () => ({ status: 'done' }));
  assert.equal((await f.readBrandCoreRefresh('hammerson')).status, 'idle');
  for (const expiresAt of ['2020-01-01T00:00:00Z', undefined, 'not-a-date']) {
    f.states.set('brand-core-refresh:hammerson', { status: 'running', expiresAt, claim: 'private-claim' });
    const current = await f.readBrandCoreRefresh('hammerson');
    assert.equal(current.status, 'error', String(expiresAt)); assert.match(current.reason, /interrupted|too long/);
    assert.equal(current.claim, undefined);
  }
});
