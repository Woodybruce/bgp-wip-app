// ChatBGP starting a CRM strategy (Woody, 2026-11-16: "yes chat should be
// able to"). It saves only through the CRM's own functions, for BGP staff
// signed in as themselves, and both of ChatBGP's tool paths know it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source } = require('./source-harness.cjs');

const tool = source('server/chatbgp-crm-strategy.ts');
const chat = source('server/chatbgp.ts');

test('it has no save of its own: the strategy and the actions go through the CRM engine', () => {
  assert.doesNotMatch(tool, /INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM/i);
  assert.match(tool, /const applied = await applyKickoff\(pool as any, \{/);
  assert.match(tool, /await createEngagementAction\(pool as any, \{/);
  assert.doesNotMatch(tool, /sendSharedMailboxEmail|sendWorkspaceEmail|sendPushNotification|anthropic|openai|callClaude/i);
});

test('BGP staff as themselves only, never an automated run, and no client login is offered either tool', () => {
  assert.match(tool, /if \(tool === "start_crm_strategy" && \(await import\("\.\/chatbgp-internal"\)\)\.isInternalStaffRequest\(req\)\) \{/);
  assert.match(tool, /return isEngagementStaff\(actor, scope\) \? actor : null;/);
  assert.match(tool, /if \(!actor\) return fail\(/);
  const blocked = chat.slice(chat.indexOf('const CLIENT_BLOCKED_TOOLS'), chat.indexOf('export function isToolAllowedForClient'));
  assert.match(blocked, /"start_crm_strategy", "get_crm_plan",/);
  const joint = source('server/chatbgp-joint-agent.ts');
  assert.doesNotMatch(joint, /start_crm_strategy|get_crm_plan/);
});

test('both tool paths know both tools, and answer in the tool\'s own words', () => {
  const raw = chat.slice(chat.indexOf('export async function executeCrmToolRaw('), chat.indexOf('export async function handleCrmToolCall('));
  const single = chat.slice(chat.indexOf('export async function handleCrmToolCall('));
  assert.match(raw, /if \(fnName === "start_crm_strategy" \|\| fnName === "get_crm_plan"\) \{\s*const \{ runCrmStrategyTool \} = await import\("\.\/chatbgp-crm-strategy"\);\s*return runCrmStrategyTool\(fnName, fnArgs, req\);/);
  assert.match(single, /if \(fnName === "start_crm_strategy" \|\| fnName === "get_crm_plan"\) \{\s*const rawResult = await executeCrmToolRaw\(fnName, fnArgs, req\);\s*return \{ handled: true, response: \{ reply: rawResult\.data\?\.message/);
  for (const name of ['start_crm_strategy', 'get_crm_plan']) assert.ok(chat.includes(`name: "${name}",`), name);
});

test('only a contact filed under the company is named on its strategy, and every owner is checked before anything is saved', () => {
  assert.match(tool, /const people = options\.contacts\.filter\(contact => contact\.companyId === company\.id\);/);
  const save = tool.indexOf('const applied = await applyKickoff(');
  assert.ok(save > 0);
  for (const check of ['is not an active BGP colleague. Nothing was saved.', 'const choice = chooseStrategy(']) {
    assert.ok(tool.lastIndexOf(check, save) > 0, check);
  }
});
