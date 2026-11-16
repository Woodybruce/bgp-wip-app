// ChatBGP starting a CRM strategy (Woody, 2026-11-16: "yes chat should be
// able to"). It saves only through the CRM's own functions, for BGP staff
// signed in as themselves, and both of ChatBGP's tool paths know it. The
// same day ("build it") it gained three more: add a CRM event, change or
// close a strategy, tick a CRM action. The same rules hold for all five.
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
  // The three later tools: the engine's event save, strategy save and action
  // status door, each after the form's own checks.
  assert.match(tool, /await saveEngagementEvent\(pool as any, eventInputSchema\.parse\(input\) as EventInput, undefined, "all"\);/);
  assert.match(tool, /await saveEngagementStrategy\(pool as any, strategyInputSchema\.parse\(planned\.input\) as StrategyInput, strategy\.id, "all"\);/);
  assert.match(tool, /await setEngagementActionStatus\(pool as any, action\.id, want, actor\);/);
  // Nothing reaches a diary or an inbox: no Graph call, no invitation.
  assert.doesNotMatch(tool, /graph\.microsoft|createEvent|calendar\/events|sendMail/i);
});

test('an action is ticked through the one door the CRM page uses: its owner or the person who set it', () => {
  const engine = source('server/crm-engagement.ts');
  const door = engine.slice(engine.indexOf('export async function setEngagementActionStatus('), engine.indexOf('export async function createEngagementAction('));
  assert.match(door, /await assertActionStatusEditable\(q,actionId,actor\);/);
  assert.match(door, /WHERE t\.id=\$2 AND \(t\.user_id=\$3 OR t\.assigned_by_user_id=\$3\) AND EXISTS\(SELECT 1 FROM crm_engagement_actions a WHERE a\.task_id=t\.id\)/);
  const route = engine.slice(engine.indexOf('router.patch("/actions/:id"'), engine.indexOf('router.post("/read-note"'));
  assert.match(route, /if\(status!==undefined\)await assertActionStatusEditable\(deps\.pool,actionId,actor\);/);
  assert.match(route, /return setEngagementActionStatus\(deps\.pool,actionId,status,actor\);/);
  assert.doesNotMatch(route, /UPDATE user_tasks/);
  // Chat says whose it is before it tries, and never changes more than the status.
  assert.match(tool, /if \(action\.canEdit !== true\) return fail\(/);
  assert.ok(tool.indexOf('if (action.canEdit !== true) return fail(') < tool.indexOf('await setEngagementActionStatus('));
});

test('a strategy is changed with every company and person kept, and against the version that was read', () => {
  const plan = tool.slice(tool.indexOf('export function planStrategyChange('), tool.indexOf('/** The action a person means'));
  assert.match(plan, /targets: strategy\.targets\.map\(target => \(\{ companyId: target\.companyId, reason: target\.reason, contactIds: \[\.\.\.target\.contactIds\] \}\)\), expectedUpdatedAt: strategy\.updatedAt/);
  assert.match(plan, /team: strategy\.team/);
});

test('an event is a plan: guests are suggestions from the companies on it, and a twin is a question', () => {
  const add = tool.slice(tool.indexOf('async function addEvent('), tool.indexOf('async function updateStrategy('));
  assert.match(add, /guests\.push\(\{ contactId: picked\.one\.id, status: "suggested" \}\)/);
  assert.doesNotMatch(add, /status: "(invited|accepted)"/);
  assert.match(add, /\.filter\(contact => companies\.some\(company => company\.id === contact\.companyId\)\)/);
  assert.ok(add.indexOf('if (twin) return fail(') < add.indexOf('await saveEngagementEvent('));
  assert.match(add, /No invitation was sent and nothing was put in anyone's diary\./);
});

test('BGP staff as themselves only, never an automated run, and no client login is offered either tool', () => {
  // An automated run may read the plan and nothing else.
  assert.match(tool, /if \(tool !== "get_crm_plan" && \(await import\("\.\/chatbgp-internal"\)\)\.isInternalStaffRequest\(req\)\) \{/);
  assert.match(tool, /return isEngagementStaff\(actor, scope\) \? actor : null;/);
  assert.match(tool, /if \(!actor\) return fail\(/);
  const blocked = chat.slice(chat.indexOf('const CLIENT_BLOCKED_TOOLS'), chat.indexOf('export function isToolAllowedForClient'));
  assert.match(blocked, /"start_crm_strategy", "get_crm_plan", "add_crm_event", "update_crm_strategy", "update_crm_action",/);
  const joint = source('server/chatbgp-joint-agent.ts');
  assert.doesNotMatch(joint, /start_crm_strategy|get_crm_plan|add_crm_event|update_crm_strategy|update_crm_action/);
});

test('both tool paths know both tools, and answer in the tool\'s own words', () => {
  const raw = chat.slice(chat.indexOf('export async function executeCrmToolRaw('), chat.indexOf('export async function handleCrmToolCall('));
  const single = chat.slice(chat.indexOf('export async function handleCrmToolCall('));
  assert.match(raw, /if \(CRM_PLAN_TOOL_NAMES\.has\(fnName\)\) \{\s*const \{ runCrmStrategyTool \} = await import\("\.\/chatbgp-crm-strategy"\);\s*return runCrmStrategyTool\(fnName as any, fnArgs, req\);/);
  assert.match(single, /if \(CRM_PLAN_TOOL_NAMES\.has\(fnName\)\) \{\s*const rawResult = await executeCrmToolRaw\(fnName, fnArgs, req\);\s*return \{ handled: true, response: \{ reply: rawResult\.data\?\.message/);
  // One list of names for both paths, the same five the tool file runs.
  const names = ['start_crm_strategy', 'get_crm_plan', 'add_crm_event', 'update_crm_strategy', 'update_crm_action'];
  assert.ok(chat.includes(`const CRM_PLAN_TOOL_NAMES = new Set([${names.map(name => `"${name}"`).join(', ')}]);`));
  assert.ok(tool.includes(`export const CRM_PLAN_TOOLS: CrmPlanTool[] = [${names.map(name => `"${name}"`).join(', ')}];`));
  for (const name of names) assert.ok(chat.includes(`name: "${name}",`), name);
});

test('only a contact filed under the company is named on its strategy, and every owner is checked before anything is saved', () => {
  assert.match(tool, /const people = options\.contacts\.filter\(contact => contact\.companyId === company\.id\);/);
  const save = tool.indexOf('const applied = await applyKickoff(');
  assert.ok(save > 0);
  for (const check of ['is not an active BGP colleague. Nothing was saved.', 'const choice = chooseStrategy(']) {
    assert.ok(tool.lastIndexOf(check, save) > 0, check);
  }
});
