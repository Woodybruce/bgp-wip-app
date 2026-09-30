import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { source, find, evaluate, ts } = require('./source-harness.cjs');
const { verifyHmlrChatDelivery, shouldBufferHmlrDelivery } = evaluate(source('server/hmlr-chat-delivery-guard.ts'), { URL });
const title = 'NGL813653';
const canonical = `/api/lr-bg/register/${title}`;
const invented = `/api/file-storage/hmlr-orders/invented-${title}-OC1.pdf`;
const messages = [{ role: 'assistant', content: `Order the HMLR official copy for ${title}?` }, { role: 'user', content: 'Order it' }];
const fakeReply = `Ordered — ${title}.\nStatus: Delivered\n[Download official register](${invented})`;

// Exercise the actual route closures, without starting the application or
// touching a provider/database. Changes in persistence/SSE ordering are tested
// here as behaviour, independently of the guard's isolated unit tests.
function routeClosure(name, bindings) {
  const declaration = find('server/chatbgp.ts', node => ts.isVariableDeclaration(node) && node.name.getText() === name);
  return evaluate(`const ${declaration}; exports.run = ${name};`, bindings).run;
}

function responseFixture() {
  const frames = [];
  const state = { ended: false, json: undefined };
  const write = frame => { frames.push(JSON.parse(frame.replace(/^data: /, '').trim())); return true; };
  return { frames, state, write, res: { write, end: () => { state.ended = true; }, json: value => { state.json = value; } } };
}

function mainFixture({ context = messages, getFile = async () => null, receipts = [] } = {}) {
  const response = responseFixture();
  const saved = [];
  const runs = new Map([['thread', { partial: '' }]]);
  const shared = {
    verifyHmlrChatDelivery, result: { data: { messages: context } }, hmlrReceipts: receipts, getFile,
    clearInterval() {}, heartbeat: 1, verifiedThreadId: 'thread', activeChatRuns: runs,
    pool: { query: async () => ({ rows: [] }) },
    storage: { createChatMessage: async message => { saved.push(message); } },
    clientDisconnected: false, safeSseWrite: response.write, res: response.res,
    console: { log() {}, warn() {}, error() {} },
  };
  return { ...response, saved, runs, send: routeClosure('sendResult', shared), delta: routeClosure('sendDelta', {
    bufferHmlr: shouldBufferHmlrDelivery(context), runRef: { id: 'thread' }, activeChatRuns: runs, safeSseWrite: response.write,
  }) };
}

function fileFixture({ context = messages, getFile = async () => null, receipts = [] } = {}) {
  const response = responseFixture();
  const shared = {
    verifyHmlrChatDelivery, messages: context, fcHmlrReceipts: receipts, getFile,
    fcHeartbeat: 1, clearInterval() {}, fcClosed: false, fcStarted: true,
    fcBufferHmlr: shouldBufferHmlrDelivery(context), res: response.res,
  };
  return { ...response, send: routeClosure('fcSend', shared), delta: routeClosure('fcDelta', shared) };
}

test('main final response saves, streams and returns the sanitized fabricated delivery text', async () => {
  const f = mainFixture();
  const returned = await f.send({ reply: fakeReply });
  assert.equal(f.saved.length, 1);
  assert.match(returned, /cannot confirm delivery/);
  assert.doesNotMatch(returned, /file-storage|Status: Delivered/);
  assert.equal(f.saved[0].content, returned);
  assert.equal(f.frames[0].reply, returned);
  assert.equal(f.frames[0].savedToThread, true);
  assert.equal(f.runs.has('thread'), false);
  assert.equal(f.state.ended, true);
});

test('main final response awaits the stored PDF check before persistence or SSE', async () => {
  let release;
  const f = mainFixture({ getFile: () => new Promise(resolve => { release = resolve; }) });
  const completion = f.send({ reply: `The register is delivered. [Download](${canonical})` });
  assert.equal(typeof release, 'function');
  assert.equal(f.saved.length, 0);
  assert.equal(f.frames.length, 0);
  release(null);
  await completion;
  assert.match(f.saved[0].content, /cannot confirm delivery/);
  assert.equal(f.frames[0].reply, f.saved[0].content);
});

test('main route preserves an ordinary answer, including its normal streaming and saved text', async () => {
  const f = mainFixture({ context: [{ role: 'user', content: 'Show the leasing summary' }] });
  f.delta('The leasing ');
  assert.equal(f.runs.get('thread').partial, 'The leasing ');
  assert.equal(f.frames[0].delta, 'The leasing ');
  const reply = 'The leasing summary is ready.';
  assert.equal(await f.send({ reply }), reply);
  assert.equal(f.saved[0].content, reply);
  assert.equal(f.frames[1].reply, reply);
});

test('main HMLR partials cannot escape through SSE or reconnect/cancellation state', () => {
  const f = mainFixture();
  f.delta(fakeReply);
  assert.equal(f.frames.length, 0);
  assert.equal(f.runs.get('thread').partial, '');
});

test('file chat buffers HMLR partials and sends only the verified final reply', async () => {
  const f = fileFixture();
  f.delta(fakeReply);
  assert.equal(f.frames.length, 0);
  await f.send({ reply: fakeReply });
  assert.equal(f.frames.length, 1);
  assert.match(f.frames[0].reply, /cannot confirm delivery/);
  assert.doesNotMatch(f.frames[0].reply, /file-storage|Status: Delivered/);
  assert.equal(f.state.ended, true);
});

test('file chat still streams and returns ordinary non-HMLR answers unchanged', async () => {
  const f = fileFixture({ context: [{ role: 'user', content: 'Summarize my spreadsheet' }] });
  f.delta('The spreadsheet ');
  assert.equal(f.frames[0].delta, 'The spreadsheet ');
  const reply = 'The spreadsheet contains five units.';
  await f.send({ reply });
  assert.equal(f.frames[1].reply, reply);
});

test('both final-response paths retain a real historical register after checking storage', async () => {
  const reads = [];
  const getFile = async key => { reads.push(key); return { data: Buffer.from('%PDF-1.7\nregister') }; };
  const reply = `Here is the saved register: [Download](${canonical})`;
  const main = mainFixture({ getFile });
  const file = fileFixture({ getFile });
  await main.send({ reply });
  await file.send({ reply });
  assert.equal(main.saved[0].content, reply);
  assert.equal(main.frames[0].reply, reply);
  assert.equal(file.frames[0].reply, reply);
  assert.deepEqual(reads, [`lr-bg/${title}-OC1-Register.pdf`, `lr-bg/${title}-OC1-Register.pdf`]);
});
