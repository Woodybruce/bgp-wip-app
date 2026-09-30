import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, source, route, evaluate, ts } = require('./source-harness.cjs');
const sourceFile = 'server/chatbgp.ts';
const guard = find(sourceFile, n => ts.isFunctionDeclaration(n) && n.name?.text === 'hasChatKeyConfigured');
const status = route(sourceFile, 'get', '/api/chatbgp/status');
const visionStatements = ['useOpenAIVision', 'useKimiVision', 'anthropic', 'visionModel', 'askVision'];
const visionSource = source(sourceFile);
const start = visionSource.indexOf('const useOpenAIVision =');
const end = visionSource.indexOf('\n      let raw =', start);
assert.ok(start >= 0 && end > start);
const vision = visionSource.slice(start, end);

function statusOf(provider, env) {
  let handler;
  evaluate(`${guard}\n${status}`, { process: { env }, chatProvider: () => provider, requireAuth() {}, app: { get: (_path, _auth, callback) => { handler = callback; } } });
  let result;
  handler({}, { json: obj => { result = obj; } });
  return result;
}

test('chat status checks the selected provider without requiring a Claude key for OpenAI', () => {
  assert.equal(statusOf('openai', { OPENAI_API_KEY: 'test-only' }).connected, true);
  assert.equal(statusOf('openai', { ANTHROPIC_API_KEY: 'test-only' }).connected, false);
  assert.equal(statusOf('anthropic', { ANTHROPIC_API_KEY: 'test-only' }).connected, true);
  assert.equal(statusOf('anthropic', {}).connected, false);
});

function visionFor(provider, openAIError) {
  const calls = [];
  const client = name => {
    calls.push({ construct: name });
    return { messages: { create: async params => { calls.push({ provider: name, params }); return { content: [{ type: 'text', text: ' OCR text ' }] }; } } };
  };
  const exports = evaluate(`${vision}\nexport { askVision };`, {
    chatProvider: () => provider,
    mapModelForKimi: () => 'kimi-test', mapModelForOpenAI: () => 'gpt-6.1-sol',
    getKimiClient: () => client('kimi'), getAnthropicClient: () => client('anthropic'),
    callOpenAI: async params => {
      calls.push({ provider: 'openai', params });
      if (openAIError) throw openAIError;
      return { choices: [{ message: { content: ' OCR text ' } }] };
    },
  });
  return { askVision: exports.askVision, calls };
}

test('analyse_image sends the same image bytes and prompt to OpenAI with no Claude client construction', async () => {
  const { askVision, calls } = visionFor('openai');
  assert.equal(await askVision({ data: 'dGVzdA==', media: 'image/png' }, 'Read all labels', 2500), 'OCR text');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'openai');
  assert.equal(calls[0].params.model, 'gpt-6.1-sol');
  assert.equal(calls[0].params.max_tokens, 2500);
  assert.equal(calls[0].params.feature, 'analyse-image');
  assert.equal(calls[0].params.messages[0].content[0].source.data, 'dGVzdA==');
  assert.equal(calls[0].params.messages[0].content[1].text, 'Read all labels');
});

test('an OpenAI vision error does not silently fall back to Claude', async () => {
  const { askVision, calls } = visionFor('openai', new Error('Service unavailable'));
  await assert.rejects(askVision({ data: 'dGVzdA==', media: 'image/png' }, 'Read labels'), /Service unavailable/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'openai');
});

test('existing Kimi and Claude vision calls preserve their Messages request and text result', async () => {
  for (const provider of ['kimi', 'anthropic']) {
    const { askVision, calls } = visionFor(provider);
    assert.equal(await askVision({ data: 'dGVzdA==', media: 'image/jpeg' }, 'Describe'), 'OCR text');
    assert.equal(calls[0].construct, provider);
    assert.equal(calls[1].provider, provider);
    assert.equal(calls[1].params.max_tokens, 1500);
    assert.equal(calls[1].params.messages[0].content[0].source.media_type, 'image/jpeg');
  }
});

test('fallback system prompt does not falsely claim Claude when OpenAI is selected', () => {
  const fallback = find(sourceFile, n => ts.isVariableDeclaration(n) && n.name.getText() === 'SYSTEM_PROMPT_FALLBACK');
  assert.doesNotMatch(fallback, /powered by Claude/);
  assert.match(fallback, /Do NOT guess/);
});
