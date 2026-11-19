// PIPnet counts concurrent logins against BGP's licence, and a session that is
// never logged off holds a licence until PIPnet times it out (19 November 2026:
// "Maximum number of licensed users for your company exceeded"). Every PIPnet
// operation runs inside withPipnetSession, and the last one to finish presses
// Logoff for every session the operations used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { source, evaluate } = require('./source-harness.cjs');

const file = 'server/pipnet.ts';
const text = source(file);

function loadSession() {
  const start = text.indexOf('let pipnetUsers = 0;');
  const end = text.indexOf('// One-shot inspector');
  assert.ok(start > 0 && end > start, 'the PIPnet session block moved: update this test');
  const calls = [];
  const code = `let sessionCookie: string | null = null;
let scraperSession: any = null;
${text.slice(start, end)}
export const setCookieForTest = (c: string | null) => { sessionCookie = c; };
export const cookieForTest = () => sessionCookie;
export { withPipnetSession, abandonSession };`;
  const mod = evaluate(code, {
    fetch: async (url, init) => { calls.push({ url, cookie: init?.headers?.Cookie }); return { status: 200 }; },
    AbortSignal,
    PIPNET_URL: 'https://pip.test',
    withPipHeaders: (init = {}) => ({ ...init, headers: { ...(init.headers || {}) } }),
    isScraperApiAvailable: () => false,
    ScraperSession: class { fetch() { throw new Error('not used when direct logoff works'); } },
  });
  return { mod, cookies: () => calls.map((c) => c.cookie), calls };
}

test('one run presses Logoff for its session when it finishes', async () => {
  const { mod, calls } = loadSession();
  await mod.withPipnetSession(async () => { mod.setCookieForTest('JSESSIONID=a'); });
  assert.deepEqual(calls, [{ url: 'https://pip.test/logoff.jsp', cookie: 'JSESSIONID=a' }]);
  assert.equal(mod.cookieForTest(), null);
});

test('a run that fails still logs its session off', async () => {
  const { mod, cookies } = loadSession();
  await assert.rejects(mod.withPipnetSession(async () => { mod.setCookieForTest('JSESSIONID=x'); throw new Error('search failed'); }));
  assert.deepEqual(cookies(), ['JSESSIONID=x']);
});

test('overlapping runs share the session, and the last one out logs it off once', async () => {
  const { mod, cookies } = loadSession();
  let release;
  const first = mod.withPipnetSession(() => new Promise((r) => { release = r; }));
  await mod.withPipnetSession(async () => { mod.setCookieForTest('JSESSIONID=b'); });
  assert.deepEqual(cookies(), [], 'logged off while another run was still using it');
  release();
  await first;
  assert.deepEqual(cookies(), ['JSESSIONID=b']);
});

test('a session dropped mid-run is logged off: at once when alone, after the others when shared', async () => {
  const alone = loadSession();
  await alone.mod.withPipnetSession(async () => {
    alone.mod.setCookieForTest('JSESSIONID=c');
    alone.mod.abandonSession();
    assert.deepEqual(alone.cookies(), ['JSESSIONID=c']);
    alone.mod.setCookieForTest('JSESSIONID=d');
  });
  assert.deepEqual(alone.cookies(), ['JSESSIONID=c', 'JSESSIONID=d']);

  const shared = loadSession();
  let release;
  const other = shared.mod.withPipnetSession(() => new Promise((r) => { release = r; }));
  await shared.mod.withPipnetSession(async () => {
    shared.mod.setCookieForTest('JSESSIONID=e');
    shared.mod.abandonSession();
    shared.mod.setCookieForTest('JSESSIONID=f');
  });
  assert.deepEqual(shared.cookies(), [], 'logged off a session another run may still hold');
  release();
  await other;
  assert.deepEqual(shared.cookies().sort(), ['JSESSIONID=e', 'JSESSIONID=f']);
});

test('changing the credentials logs the session off: at once when idle, else after the runs', async () => {
  const idle = loadSession();
  idle.mod.setCookieForTest('JSESSIONID=g');
  idle.mod.resetSession();
  assert.deepEqual(idle.cookies(), ['JSESSIONID=g']);

  const busy = loadSession();
  let release;
  const run = busy.mod.withPipnetSession(() => new Promise((r) => { release = r; }));
  busy.mod.setCookieForTest('JSESSIONID=h');
  busy.mod.resetSession();
  assert.deepEqual(busy.cookies(), []);
  release();
  await run;
  assert.deepEqual(busy.cookies(), ['JSESSIONID=h']);
});

test('every PIPnet operation other files call runs inside withPipnetSession', () => {
  const exported = [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm)].map((m) => m[1]);
  assert.ok(exported.includes('importPipnetRequirements') && exported.includes('searchPipnetRequirements'));
  for (const name of exported) {
    if (name === 'resetSession') continue;
    const line = text.match(new RegExp(`^export const ${name} = .*$`, 'm'))?.[0] ?? '';
    assert.match(line, /withPipnetSession\(/, `${name} is exported without withPipnetSession, so its session would never be logged off`);
  }
  assert.doesNotMatch(text, /^export\s*\{/m, 'a re-export list could export an operation without withPipnetSession');
  assert.doesNotMatch(text, /^export\s+default/m);
});
