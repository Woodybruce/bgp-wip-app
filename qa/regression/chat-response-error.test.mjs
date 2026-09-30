import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const reader = find('client/src/components/chat-panel.tsx', n => ts.isVariableDeclaration(n) && n.name.getText() === 'readSseResponse');
const { readResponse } = evaluate(`export async function readResponse(res: any) { const ${reader}; return readSseResponse(res); }`, {
  TextDecoder, setPanelProgressLabel() {}, setStreamingText() {},
});
function response(events) {
  const encoded = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''));
  // Exercise an SSE payload split in the middle of JSON, as a real stream is.
  const split = Math.floor(encoded.length / 2);
  const chunks = [encoded.slice(0, split), encoded.slice(split)];
  return { body: { getReader: () => ({ read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true } }) } };
}

test('sidebar shows an honest interrupted-action reply instead of throwing the boolean error flag', async () => {
  const reply = 'The response is incomplete. Some actions may already have run; check before retrying a paid order.';
  const out = await readResponse(response([{ progress: 'Getting the register...' }, { reply, error: true, errorStatus: 503 }]));
  assert.equal(out.reply, reply);
  assert.equal(out.error, true);
  assert.equal(out.errorStatus, 503);
});

test('sidebar keeps final replies carrying an error string or a legacy false error flag', async () => {
  for (const error of ['Provider unavailable', false]) {
    const out = await readResponse(response([{ reply: 'I could not finish. Please check the existing order.', error }]));
    assert.match(out.reply, /check the existing order/);
  }
});

test('errors without a usable final reply still reject with a meaningful message', async () => {
  for (const reply of [undefined, '', '  ', null]) {
    await assert.rejects(readResponse(response([{ reply, error: 'File processing failed' }])), /File processing failed/);
  }
  await assert.rejects(readResponse(response([{ error: true }])), /could not complete this response/);
});

test('normal final replies and incomplete responses retain their existing contract', async () => {
  const out = await readResponse(response([{ delta: 'Draft' }, { reply: 'Finished', action: { type: 'navigate', path: '/crm' } }]));
  assert.equal(out.reply, 'Finished');
  assert.equal(out.action.path, '/crm');
  await assert.rejects(readResponse(response([{ progress: 'Checking...' }])), /No response received/);
});
