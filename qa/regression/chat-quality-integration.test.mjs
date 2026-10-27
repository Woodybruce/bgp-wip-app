import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { withAiRequestDeadline } from '../../server/utils/ai-request-deadline.ts';
const require = createRequire(import.meta.url);
const { source, find, route, evaluate, ts } = require('./source-harness.cjs');
const file = 'server/chatbgp.ts';
const quiet = { log() {}, warn() {}, error() {} };
const guideTool = { type: 'function', function: { name: 'search_app_guide' } };

test('staff guide is unavailable to client lists and raw calls, while ordinary client tools remain available', async () => {
  const blocked = find(file, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'CLIENT_BLOCKED_TOOLS'));
  const allowed = find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === 'isToolAllowedForClient');
  const { isToolAllowedForClient } = evaluate(blocked + '\n' + allowed);
  assert.equal(isToolAllowedForClient('search_app_guide'), false);
  assert.equal(isToolAllowedForClient('search_crm'), true);
  assert.equal(isToolAllowedForClient('create_task'), true);
  const raw = find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === 'executeCrmToolRaw');
  for (const isClient of [true, false]) {
    let reads = 0;
    const { executeCrmToolRaw } = evaluate(raw, { clientChatGuard: async () => ({ isClient }),
      searchAppGuide: () => { reads++; return { mode: 'search', results: [{ text: 'Staff directions' }] }; } });
    const result = await executeCrmToolRaw('search_app_guide', { query: 'phone chat' }, {});
    assert.equal(reads, isClient ? 0 : 1);
    if (isClient) assert.match(result.data.error, /not available on client accounts/);
    else assert.equal(result.data.results[0].text, 'Staff directions');
  }
});

test('group navigation evidence goes back to the model instead of becoming a raw JSON chat reply', async () => {
  const code = find('server/routes.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'triggerAiGroupResponse');
  const whitelist = find('server/routes.ts', n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'GROUP_CHAT_TOOLS'));
  const saved = [], calls = [], rawCalls = [];
  const chat = {
    buildSystemPrompt: async () => 'Use search_app_guide for directions.', getBusinessLearningsContext: async () => '',
    getEmailAndCalendarContext: async () => '', getAvailableTools: async () => ({ tools: [guideTool] }),
    isToolAllowedForClient: () => false,
    handleCrmToolCall: async () => { throw new Error('The guide must use the raw evidence path'); },
    executeCrmToolRaw: async (name, args) => { rawCalls.push({ name, args }); return { data: { results: [{ text: 'Tap the add-person icon in the chat header.' }] } }; },
    callClaude: async options => {
      calls.push(JSON.parse(JSON.stringify(options.messages)));
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.tools[0].function.name, 'search_app_guide');
      return calls.length === 1 ? { choices: [{ message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'guide-1', function: { name: 'search_app_guide', arguments: '{"query":"phone add people chat"}' } }] } }] }
        : { choices: [{ message: { role: 'assistant', content: 'On the phone, tap the add-person icon in the chat header.' } }] };
    },
  };
  const modules = { './chatbgp': chat, './utils/ai-request-deadline': { withAiRequestDeadline },
    './company-scope': { isClientRequestUser: async () => false, resolveCompanyScope: async () => null },
    './landlord-meetings': { canReadLandlordMeetings: async () => false,
      searchLandlordMeetings: async () => { throw new Error('Ordinary group navigation must not query landlord diaries'); } },
    './chat-quality-settings': { chatQualitySettings: () => ({ effort: 'high', max_completion_tokens: 32768 }) },
    './chatbgp-model-router': { resolveChatModel: async () => ({ model: 'gpt-6-astra' }) } };
  const { run } = evaluate(whitelist + '\n' + code + '\nexport const run = triggerAiGroupResponse;', {
    require: id => { assert.ok(modules[id], `Unexpected module ${id}`); return modules[id]; },
    console: quiet, getIO: () => null, emitNewMessage() {},
    pool: { query: async () => ({ rows: [{ role: 'user', content: '@ChatBGP how do I add people on my phone?' }] }) },
    storage: { getUser: async () => ({ name: 'Example' }), createChatMessage: async msg => { saved.push(msg); return msg; } },
    AI_MENTION_REGEX: /ChatBGP/i, stripTagTokens: text => text, resolveCompanyScope: async () => null,
    buildTaggedEntityContext: async () => '',
  });
  await run('thread-example', 'staff-example', {});
  assert.equal(rawCalls.length, 1);
  assert.equal(calls.length, 2);
  const evidence = calls[1].find(message => message.role === 'tool');
  assert.equal(evidence.tool_call_id, 'guide-1');
  assert.match(evidence.content, /add-person icon/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].content, 'On the phone, tap the add-person icon in the chat header.');
  assert.ok(!saved[0].content.includes('results'));
});

async function fileChatHarness(closeAt) {
  let handler;
  let modelCalls = 0;
  const toolsRun = [];
  const response = new EventEmitter();
  Object.assign(response, { writeHead() {}, write() {}, end() {}, json() {}, status() { return this; } });
  const request = { files: [], body: { messages: JSON.stringify([{ role: 'user', content: 'Read my document' }]) }, session: { userId: 'example' } };
  const toolCalls = ['first', 'second'].map(id => ({ id, function: { name: id, arguments: '{}' } }));
  const bindings = {
    console: quiet, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    app: { post(_path, ...handlers) { handler = handlers.at(-1); } }, requireAuth() {}, chatUpload: { array: () => () => {} },
    shouldBufferHmlrDelivery: () => false, hasChatKeyConfigured: () => true,
    getChatThreadAccess: async () => ({ allowed: true, threadId: null }),
    parseSlashCommand: () => ({ command: null }), getAvailableTools: async () => ({ tools: [] }),
    clientChatGuard: async () => ({ isClient: false }), getUserPersonalisationContext: async () => '',
    getRelevantStaffMemoryContext: async () => '', withTimeout: async p => p, buildSystemPrompt: async () => 'System',
    selectChatHistory: messages => ({ messages }), resolveChatModel: async () => ({ model: 'gpt-6-astra' }),
    chatQualitySettings: () => ({ effort: 'high', max_completion_tokens: 32768 }), getValidMsToken: async () => null,
    getToolProgressLabel: name => name, incompleteChatReply: text => text,
    verifyHmlrChatDelivery: async reply => ({ reply }), getFile() {},
    buildChatToolResultContent: async (_name, data) => JSON.stringify(data),
    executeAnyTool: async name => { toolsRun.push(name); if (closeAt === 'tool') response.emit('close'); return { data: { ok: true } }; },
    callClaude: async options => {
      modelCalls++;
      assert.equal(options.signal.aborted, false);
      if (closeAt === 'model') response.emit('close');
      return { choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls } }] };
    },
  };
  evaluate(route(file, 'post', '/api/chatbgp/chat-with-files'), bindings);
  await handler(request, response);
  return { modelCalls, toolsRun };
}

test('closing file chat during its model request prevents every subsequent tool call', async () => {
  const result = await fileChatHarness('model');
  assert.equal(result.modelCalls, 1);
  assert.deepEqual(result.toolsRun, []);
});

test('closing file chat during a tool permits it to finish but starts no later tools or model rounds', async () => {
  const result = await fileChatHarness('tool');
  assert.equal(result.modelCalls, 1);
  assert.deepEqual(result.toolsRun, ['first']);
});

test('Excel respects saved OpenAI choices without the legacy Fable default overriding them', async () => {
  const resolved = find(file, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText() === 'excelResolved'));
  for (const provider of ['openai', 'anthropic']) {
    const calls = [];
    const { run } = evaluate(`export async function run() { ${resolved}; return excelResolved; }`, {
      excelThreadId: 'example-thread', excelSlashOverride: null, host: 'excel', chatProvider: () => provider,
      resolveChatModel: async args => { calls.push(args); return { model: 'selected' }; },
    });
    await run();
    assert.equal(calls[0].override, provider === 'openai' ? null : 'fable');
    assert.equal(calls[0].threadId, 'example-thread');
  }
});
