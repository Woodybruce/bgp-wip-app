import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const declaration = find('server/chatbgp.ts', node => ts.isVariableDeclaration(node) && node.name.getText() === 'sendResult');
const savedId = '4d58c560-ee06-4ec5-9962-47edfb7a1091';
const reply = 'Subject: Leisure proposal\n\nHi Pete,\n\nPlease review these terms.\n\nThanks,\nWoody';

function fixture({ threadId = 'thread', save = async message => ({ ...message, id: savedId }), duplicate = false } = {}) {
  const frames = [], writes = [];
  const { send } = evaluate(`const ${declaration}; exports.send = sendResult;`, {
    verifyHmlrChatDelivery: async text => ({ reply: text }), result: { data: { messages: [] } }, hmlrReceipts: [], getFile() {},
    clearInterval() {}, heartbeat: 1, verifiedThreadId: threadId, activeChatRuns: new Map(),
    pool: { query: async () => ({ rows: duplicate ? [{ role: 'assistant', content: reply }] : [] }) },
    storage: { createChatMessage: async message => { writes.push(message); return save(message); } },
    clientDisconnected: false,
    safeSseWrite: frame => { frames.push(JSON.parse(frame.slice(6))); return true; },
    res: { end() {} }, console: { log() {}, warn() {}, error() {} },
  });
  return { send, frames, writes };
}

test('fresh persisted assistant response includes its actual message ID for immediate draft edits', async () => {
  const f = fixture();
  const action = { type: 'document', content: 'Preserved action' };
  assert.equal(await f.send({ reply, action }), reply);
  assert.equal(f.writes.length, 1);
  assert.equal(f.frames[0].messageId, savedId);
  assert.equal(f.frames[0].savedToThread, true);
  assert.deepEqual(f.frames[0].action, action);
  assert.equal(f.frames[0].reply, reply);
});

test('completion is not emitted until the message has been saved and its ID is known', async () => {
  let release;
  const f = fixture({ save: message => new Promise(resolve => { release = () => resolve({ ...message, id: savedId }); }) });
  const completion = f.send({ reply });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.frames.length, 0);
  release();
  await completion;
  assert.equal(f.frames[0].messageId, savedId);
});

test('unsaved or errored responses omit messageId and keep savedToThread false', async () => {
  for (const f of [fixture({ threadId: null }), fixture({ save: async () => { throw new Error('save unavailable'); } })]) {
    await f.send({ reply });
    assert.equal(f.frames[0].savedToThread, false);
    assert.equal('messageId' in f.frames[0], false);
  }
  const failed = fixture();
  await failed.send({ reply: 'Response failed', error: true });
  assert.equal(failed.writes.length, 0);
  assert.equal(failed.frames[0].savedToThread, false);
  assert.equal('messageId' in failed.frames[0], false);
});

test('duplicate replies retain existing duplicate and savedToThread semantics', async () => {
  const f = fixture({ duplicate: true });
  await f.send({ reply });
  assert.equal(f.writes.length, 0);
  assert.equal(f.frames[0].duplicate, true);
  assert.equal(f.frames[0].savedToThread, false);
});
