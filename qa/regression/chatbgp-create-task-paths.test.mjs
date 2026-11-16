// ChatBGP has two tool paths: the single-step one (handleCrmToolCall) and
// the multi-step one (executeCrmToolRaw). Until 16 November 2026 only the
// first knew create_task, so in a multi-step answer ChatBGP was told
// "Unknown tool: create_task" and a task for a colleague never landed
// (Woody's Matta plan: nothing reached the two people it named).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { source } = require('./source-harness.cjs');

const chat = source('server/chatbgp.ts');
const raw = chat.slice(chat.indexOf('export async function executeCrmToolRaw('), chat.indexOf('export async function handleCrmToolCall('));
const single = chat.slice(chat.indexOf('export async function handleCrmToolCall('));

test('both tool paths set a task through the one rule', () => {
  assert.match(raw, /if \(fnName === "create_task"\) \{\s*const made = await createTaskFromChat\(req, fnArgs\);/);
  assert.match(single, /if \(fnName === "create_task"\) \{\s*const made = await createTaskFromChat\(req, fnArgs\);/);
  assert.equal((chat.match(/INSERT INTO user_tasks \(user_id, title, description, due_date, priority, assigned_by_user_id, assigned_by_name\)/g) || []).length, 1);
});

test('the rule keeps a client login to the people on its account and needs a known asker', () => {
  const rule = chat.slice(chat.indexOf('async function createTaskFromChat('), chat.indexOf('export async function executeCrmToolRaw('));
  assert.match(rule, /if \(!requesterId\) return \{ error:/);
  assert.match(rule, /const allowedIds = scope \? await getClientVisibleUserIds\(scope\) : null;/);
  assert.match(rule, /if \(candidates\.length > 1\) return \{ error: `Which /);
});

test('every tool ChatBGP is offered by name in the single-step path that sets a record is known to the multi-step path too', () => {
  // The two paths drifted apart once. These are the record-setting tools both must know.
  for (const tool of ['create_task', 'create_diary_entry']) {
    assert.ok(raw.includes(`fnName === "${tool}"`), `${tool} missing from executeCrmToolRaw`);
    assert.ok(single.includes(`fnName === "${tool}"`), `${tool} missing from handleCrmToolCall`);
  }
});
