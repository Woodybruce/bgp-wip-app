import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require('./source-harness.cjs');
const AdmZip = require('adm-zip');
const file = 'server/chatbgp.ts';
const functionSource = name => find(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const downloadSource = functionSource('fetchLandRegistryDocuments');
const incompleteSource = functionSource('incompleteChatReply');
const pdf = Buffer.from('%PDF-1.7\nTest document bytes\n%%EOF');

function zipBytes(files) {
  const zip = new AdmZip();
  for (const [name, bytes] of Object.entries(files)) zip.addFile(name, bytes);
  return zip.toBuffer();
}

function downloadFixture({ status = 200, bytes = zipBytes({ 'Register.pdf': pdf }), parseError = false, provider = {} } = {}) {
  const calls = [];
  const modules = {
    'adm-zip': { default: AdmZip },
    './document-reader': { extractPdfText: async data => {
      assert.equal(data.subarray(0, 5).toString(), '%PDF-');
      if (parseError) throw new Error('OCR needed');
      return 'Registered proprietor: Example Property Limited';
    } },
    './hmlr-direct': { findProprietorsByTitle: async title => {
      calls.push(['free-register', title]);
      return [{ proprietorName: 'Example Property Limited', propertyAddress: '1 Example Street', tenure: 'Freehold', dataset: 'CCOD' }];
    } },
  };
  const { run } = evaluate(`${downloadSource}\nexport const run = fetchLandRegistryDocuments;`, {
    URLSearchParams, AbortSignal,
    require(name) { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; },
    fetch: async url => {
      if (String(url).startsWith('https://api.propertydata.co.uk/land-registry-documents?')) {
        calls.push(['purchase']);
        return { ok: true, json: async () => ({ document_url: 'https://documents.example/register.zip', ...provider }) };
      }
      assert.equal(url, 'https://documents.example/register.zip');
      calls.push(['download']);
      return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes };
    },
  });
  return { calls, run: async () => (await run('test-key', ['NGL813653'], 'register', false))[0] };
}

test('expired provider link is not delivery and cannot be presented as a usable download', async () => {
  const f = downloadFixture({ status: 404 });
  const out = await f.run();
  assert.equal(out.delivered, false);
  assert.equal(out.documentUrl, null);
  assert.equal(out.billingStatus, 'not_verified');
  assert.match(out.error, /download HTTP 404/);
  assert.match(out.manualOrder.note, /Do not retry the purchase or place a replacement order/);
  assert.match(out.manualOrder.note, /does not establish whether the order was accepted or charged/);
  assert.equal(out.registerKnown.proprietors[0], 'Example Property Limited');
  assert.deepEqual(f.calls.map(c => c[0]), ['purchase', 'download', 'free-register']);
});

test('an HTML error page, an empty ZIP, and a falsely named PDF cannot confirm delivery', async () => {
  for (const bytes of [Buffer.from('<html>Access denied</html>'), zipBytes({}), zipBytes({ 'Register.pdf': Buffer.from('expired') })]) {
    const f = downloadFixture({ bytes });
    const out = await f.run();
    assert.equal(out.delivered, false);
    assert.equal(out.documentUrl, null);
    assert.equal(out.billingStatus, 'not_verified');
    assert.equal(f.calls.filter(c => c[0] === 'purchase').length, 1);
  }
});

test('retrieved ZIP register can be delivered even if automatic text extraction fails', async () => {
  const f = downloadFixture({ parseError: true });
  const out = await f.run();
  assert.equal(out.delivered, true);
  assert.equal(out.documentUrl, 'https://documents.example/register.zip');
  assert.match(out.files[0].note, /PDF received but text extraction failed/);
  assert.equal(out.manualOrder, undefined);
  assert.deepEqual(f.calls.map(c => c[0]), ['purchase', 'download']);
});

test('direct PDF and previously purchased ZIP copies require real retrieved bytes', async () => {
  for (const options of [{ bytes: pdf }, { provider: { status: 'error', code: '2906' } }]) {
    const f = downloadFixture(options);
    const out = await f.run();
    assert.equal(out.delivered, true);
    assert.match(out.files[0].text, /Example Property Limited/);
    assert.equal(out.alreadyPurchased, !!options.provider);
    assert.equal(f.calls.filter(c => c[0] === 'purchase').length, 1);
  }
});

const mainCatch = find(file, (n, ast) => ts.isCatchClause(n)
  && n.block.statements[0]?.getText(ast).startsWith('const errBodyRaw =')
  && n.block.getText(ast).includes('console.error("ChatBGP error:"'));

test('AI failure after a rejected order never republishes a pre-tool or historical delivery claim', async () => {
  for (const disconnected of [false, true]) {
    const emitted = [], saved = [];
    const { run } = evaluate(`${incompleteSource}\nexport async function run() { try { throw err; } ${mainCatch} }`, {
      err: { status: 503, message: 'Provider unavailable' },
      conversationMessages: [
        { role: 'assistant', content: 'Ordered — delivered. [Download](/api/lr-bg/register/NGL813653)' },
        { role: 'user', content: 'Please check this title' },
        { role: 'assistant', content: 'Done — the title register has been ordered and delivered.', tool_calls: [{ id: 'oc1' }] },
        { role: 'tool', tool_call_id: 'oc1', content: JSON.stringify({ success: false, outcome: 'rejected', fault: 'Login details are invalid' }) },
      ],
      console: { error() {} }, clearInterval() {}, heartbeat: 1,
      verifiedThreadId: 'thread-1', activeChatRuns: new Map(), clientDisconnected: disconnected,
      storage: { createChatMessage: async message => saved.push(message) },
      req: { session: { userId: 'user-1' } },
      require(name) { assert.equal(name, './push-notifications'); return { sendPushNotification: async () => {} }; },
      safeSseWrite: value => emitted.push(JSON.parse(value.slice(6))),
      res: { writableEnded: false, end() {} },
    });
    await run();
    assert.equal(emitted[0].error, true);
    assert.match(emitted[0].reply, /response is incomplete/);
    assert.match(emitted[0].reply, /check their results before retrying/);
    assert.doesNotMatch(emitted[0].reply, /Ordered|delivered|\/api\/lr-bg/);
    assert.equal(saved.length, disconnected ? 1 : 0);
    if (disconnected) assert.equal(saved[0].content, emitted[0].reply);
  }
});

test('file-chat and main loop exhaustion produce incomplete status instead of reusing assistant drafts', async () => {
  for (const name of ['fcSend', 'sendResult']) {
    const call = find(file, (n, ast) => ts.isCallExpression(n)
      && n.expression.getText(ast) === name
      && n.arguments[0]?.getText(ast).includes('incompleteChatReply("The ')
      && n.arguments[0]?.getText(ast).includes('run ended before a final answer'));
    let response;
    const { run } = evaluate(`${incompleteSource}\nexport async function run() { ${call}; }`, {
      fcSend: data => { response = data; }, sendResult: async data => { response = data; },
      lastAction: null, lastActionFile: null,
      convMessages: [{ role: 'assistant', content: 'Done — delivered' }],
      conversationMessages: [{ role: 'assistant', content: 'Done — delivered' }],
    });
    await run();
    assert.equal(response.partial, true);
    assert.match(response.reply, /ended before a final answer/);
    assert.doesNotMatch(response.reply, /Done|delivered/);
  }
});
