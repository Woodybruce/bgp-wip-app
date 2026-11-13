// Chat for a Landsec joint agent (Woody, 13 November 2026): the places the
// lock sits in the source. The behaviour is tested in
// shared/chat-joint-agent.test.ts, server/chatbgp-joint-agent.test.ts and
// server/chat-joint-agent-postgres.test.ts; this file fails the deploy if a
// later edit moves or removes one of the gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const chatbgp = read('server/chatbgp.ts');
const routes = read('server/routes.ts');
const lock = read('server/chatbgp-joint-agent.ts');
const messaging = read('server/chat-joint-agent.ts');
const sockets = read('server/websocket.ts');
const storage = read('server/storage.ts');
const access = read('server/landsec-access.ts');
const gateway = read('shared/landsec.ts');

const body = (src, start, length = 6000) => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, `missing: ${start}`);
  return src.slice(at, at + length);
};
const before = (text, first, later, label) => {
  const a = text.indexOf(first);
  assert.ok(a >= 0, `${label}: missing ${first}`);
  for (const l of later) { const b = text.indexOf(l); assert.ok(b < 0 || b > a, `${label}: ${l} comes before ${first}`); }
};

test('each tool executor asks the joint agent gate first', () => {
  before(body(chatbgp, 'export async function executeCrmToolRaw('), 'jointAgentToolGate(fnName, fnArgs, req)', ['isInternalStaffRequest', 'isClientRequestUser'], 'executeCrmToolRaw');
  before(body(chatbgp, 'export async function handleCrmToolCall('), 'isJointAgentChat(req)', ['isInternalStaffRequest', 'isClientRequestUser'], 'handleCrmToolCall');
  before(body(chatbgp, '  async function executeAnyTool('), 'jointAgentToolGate(tcName, tcArgs, req)', ['isInternalStaffRequest', 'isClientRequestUser'], 'executeAnyTool');
});

test('the chat route decides a joint agent before the AI key, and its run is its own', () => {
  const handler = body(chatbgp, 'app.post("/api/chatbgp/chat", requireAuth', 40000);
  before(handler, 'jointAgentChat = await isJointAgentChat(req)', ['hasChatKeyConfigured()', 'chatSchema.safeParse', 'getChatThreadAccess('], 'chat route');
  before(handler, 'jointAgentThreadKindById(String(req.session.userId), req.body?.threadId)) !== "own_ai"', ['hasChatKeyConfigured()'], 'chat route thread');
  assert.match(handler, /catch \{\s*return res\.status\(503\)\.json\(\{ message: JOINT_AGENT_UNVERIFIED \}\);/);
  // Inside the run, the joint agent block comes before any staff or client context.
  const run = handler.slice(handler.indexOf('let conversationMessages: any[] = [];'));
  before(run, 'if (jointAgentChat) {', ['getAvailableTools()', 'clientChatGuard(', 'getClientCrmContext(', 'buildSystemPrompt', 'getRelevantStaffMemoryContext(', 'readDocumentForAI', 'getValidMsToken(', 'extractAndSaveMemories('], 'chat run');
  const block = run.slice(run.indexOf('if (jointAgentChat) {'), run.indexOf('let { tools } = await getAvailableTools();'));
  assert.ok(block.includes('runJointAgentChat(') && /return;\s*\}\s*$/.test(block), 'the joint agent block must end the run');
  for (const never of ['getClientCrmContext', 'getRelevantStaffMemoryContext', 'extractAndSaveMemories', 'readDocumentForAI', 'parseSlashCommand', 'setThreadModel', 'deadlineMs', 'executeAnyTool', 'getAvailableTools', 'lastAction', 'action:']) {
    assert.ok(!block.includes(never), `the joint agent run uses ${never}`);
  }
  assert.ok(block.includes('resolveChatModel({ threadId: null })'), 'the model must be the default, never a thread preference');
  assert.ok(handler.includes('jointAgentChat ? { command: null'), 'a joint agent must not reach the model slash commands');
});

test('a run in a thread the joint agent may not hold is not shown or stopped', () => {
  for (const start of ['app.get("/api/chatbgp/threads/:threadId/active-run"', 'app.post("/api/chatbgp/threads/:threadId/cancel-run"']) {
    assert.ok(body(chatbgp, start, 1800).includes('jointAgentThreadKindById(String(req.session.userId), threadId)) !== "own_ai") return res.json({ active: false })'), start);
  }
});

test('the lock file reads and nothing else', () => {
  for (const never of ['"POST"', '"PUT"', '"PATCH"', '"DELETE"', 'x-forwarded-host', 'x-forwarded-proto', 'callOwnRoute', 'X-BGP-Internal', 'x-bgp-internal', 'auth_tokens', 'req.headers.host', 'from "./chatbgp"', 'storage', 'INSERT ', 'UPDATE ', 'DELETE FROM']) {
    assert.ok(!lock.includes(never), `server/chatbgp-joint-agent.ts holds ${never}`);
  }
  assert.ok(lock.includes('http://127.0.0.1:'), 'own pages are read on this machine');
  assert.ok(lock.includes('restrictedLandsecApiRule("joint_agent", "GET", path) !== "allow"'));
  assert.ok(lock.includes('Object.freeze(TOOLS.map'));
});

test('ChatBGP in a conversation with a joint agent: who asked decides, and only staff get the staff run', () => {
  // Woody, 13 November 2026: "Relax all of those", then "Yes full use".
  const trigger = body(routes, 'async function triggerAiGroupResponse(', 1400);
  before(trigger, 'const groupRunner = await groupAnswerRunner({ threadId, req });', ['pool.query', 'getIO()', 'import("./chatbgp")', 'getAvailableTools', 'buildSystemPrompt'], 'triggerAiGroupResponse');
  assert.ok(trigger.includes('if (groupRunner.runner === "none") return;'));
  before(trigger, 'if (groupRunner.runner === "joint_agent") return answerAsJointAgents(threadId, senderUserId, groupRunner.agents);', ['pool.query', 'getIO()', 'import("./chatbgp")'], 'triggerAiGroupResponse');
  // The decision reads the request's own sign-in, never the message.
  const runner = body(messaging, 'export async function groupAnswerRunner(', 1200);
  assert.ok(runner.includes('(deps.staffAsking || bgpStaffAsking)(input.req).catch(() => false)'));
  assert.ok(runner.includes('return { runner: "none" };'));
  assert.ok(runner.includes('staff === true ? { runner: "ordinary" } : { runner: "joint_agent", agents }'));
  const staff = body(messaging, 'export async function bgpStaffAsking(', 700);
  before(staff, 'if (await jointAgentOfRequest(req)) return false;', ['resolveCompanyScope'], 'bgpStaffAsking');
  assert.ok(staff.includes('if (await isClientRequestUser(req)) return false;') && staff.includes('return !(await resolveCompanyScope(req));') && /catch \{\s*return false;/.test(staff));
  // The locked answer: the joint agent's run, read as a joint agent, never the asker's tools.
  const answer = body(routes, 'async function answerAsJointAgents(', 3600);
  assert.ok(answer.includes('runSharedJointAgentChat(') && answer.includes('readAs: `Bearer ${token}`'));
  assert.ok(answer.includes('[token, shared.readAs.userId]') && answer.includes('DELETE FROM auth_tokens WHERE token = $1'));
  for (const never of ['getAvailableTools', 'handleCrmToolCall', 'executeCrmToolRaw', 'buildSystemPrompt', 'getEmailAndCalendarContext', 'getBusinessLearningsContext', 'buildTaggedEntityContext', 'req.headers', 'req.session']) {
    assert.ok(!answer.includes(never), `answerAsJointAgents uses ${never}`);
  }
  assert.ok(answer.includes('if (!shared) return post(JOINT_AGENT_NO_SHARED_SCHEME);'));
  const post = body(routes, 'app.post("/api/chat/threads/:id/messages"', 9000);
  assert.ok(post.includes('if (!thread.hasAiMember && !thread.isAiChat && typeof content === "string" && AI_MENTION_REGEX.test(content))'));
  assert.ok(post.includes('if (thread.hasAiMember && !thread.isAiChat) {'));
  // Not relaxed: never read for requirements, and a joint agent's tags never pull anyone in.
  assert.ok(post.includes('if (!jointAgentThread && typeof content === "string" && content.includes("(tag:company/"))'));
  assert.ok(post.includes('postJointAgent ? [] : await resolveMentionedUserIds('));
  assert.ok(messaging.includes('try { return await threadHasJointAgent(threadId); } catch { return true; }'));
  // A conversation with a joint agent is still never linked to a record.
  const put = body(routes, 'app.put("/api/chat/threads/:id"', 1600);
  before(put, 'await threadHasJointAgent(id)', ['storage.updateChatThread('], 'PUT thread');
  const members = body(routes, 'app.post("/api/chat/threads/:id/members"', 1800);
  before(members, 'await threadIsUsers(id, addedBy)', ['storage.updateChatThread(', 'storage.addChatThreadMember('], 'POST members');
});

test('every chat route asks who the caller is before it answers as for anyone else', () => {
  const tag = body(routes, 'app.get("/api/chat/tag-search"', 3500);
  before(tag, 'const tagJointAgent = await jointAgentOfRequest(req);', ['resolveCompanyScope(req)', 'crmSearchAll(', 'knowledge_base', 'getClientVisibleUserIds('], 'tag-search');
  const jaBranch = tag.slice(tag.indexOf('if (tagJointAgent) {'), tag.indexOf('const scopeCompanyId'));
  assert.ok(/return res\.json\(\{ results \}\);\s*\}\s*(\/\/[^\n]*\n\s*)*$/.test(jaBranch.trimEnd() + '\n'), 'the joint agent branch of tag-search must return');
  for (const never of ['crmSearchAll', 'crm_companies', 'crm_contacts', 'knowledge_base', 'department']) assert.ok(!jaBranch.includes(never), `tag-search joint agent branch holds ${never}`);
  const expectations = [
    ['app.get("/api/chat/threads", requireAuth', 'listJointAgent = await jointAgentOrRefuse(req, res)', 'const threads = threadsResult.rows.map('],
    ['app.post("/api/chat/threads", requireAuth', 'createJointAgent = await jointAgentOrRefuse(req, res)', 'storage.createChatThread('],
    ['app.get("/api/chat/threads/:id", requireAuth', 'readJointAgent = await jointAgentOrRefuse(req, res)', 'storage.getChatMessages('],
    ['app.delete("/api/chat/threads/:id", requireAuth', 'deleteJointAgent = await jointAgentOrRefuse(req, res)', 'storage.deleteChatThread('],
    ['app.post("/api/chat/threads/:id/messages"', 'postJointAgent = await jointAgentOrRefuse(req, res)', 'storage.createChatMessage('],
    ['app.put("/api/chat/threads/:threadId/messages/:messageId"', 'editJointAgent = await jointAgentOrRefuse(req, res)', 'storage.updateChatMessage('],
    ['app.delete("/api/chat/threads/:threadId/messages/:messageId"', 'unsendJointAgent = await jointAgentOrRefuse(req, res)', 'storage.deleteChatMessage('],
  ];
  for (const [start, gate, action] of expectations) {
    const text = body(routes, start, 9000);
    before(text, gate, [action], start);
    assert.ok(text.slice(text.indexOf(gate)).match(/^[^\n]*\n\s*if \(\w+ === false\) return;/), `${start}: a failed role read must end the request`);
  }
  const refuse = body(routes, 'async function jointAgentOrRefuse(', 600);
  assert.ok(refuse.includes('res.status(503)') && refuse.includes('return false;'));
  assert.ok(body(routes, 'app.post("/api/chat/threads", requireAuth', 5000).includes("req.body?.isAiChat === false"), 'a joint agent thread is a ChatBGP chat unless it says otherwise');
});

test('the task-done line skips a conversation with a joint agent', () => {
  const hook = body(routes, "drops a line into that property's client-facing threads", 1200);
  assert.ok(hook.includes('AND ${NO_JOINT_AGENT_THREAD_SQL}'));
  assert.ok(messaging.includes('WHERE ${NOT_FULL_ROLE_SQL("ja.landsec_role")}') && messaging.includes("NOT IN ('leasing_manager', 'asset_manager')") && messaging.includes('ja.user_id = t.created_by'));
});

test('one door for a member row, with the joint agent check in it', () => {
  const add = body(storage, 'async addChatThreadMember(', 2600);
  before(add, 'chatMemberDenial(', ['db.insert(chatThreadMembers)'], 'addChatThreadMember');
  assert.ok(add.includes('code: "CHAT_MEMBER_REFUSED"'));
  assert.ok(add.includes('WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE thread_id = $1::varchar)'));
  // No other code path writes a member row for a login it was handed.
  const writers = [];
  for (const f of ['server/routes.ts', 'server/chatbgp.ts', 'server/websocket.ts', 'server/chat-joint-agent.ts', 'server/chatbgp-joint-agent.ts']) {
    if (/INSERT INTO chat_thread_members/i.test(read(f))) writers.push(f);
  }
  assert.deepEqual(writers, [], 'a raw member insert outside the door');
});

test("a joint agent's socket joins no conversation room and relays nothing", () => {
  before(sockets, 'socket.data.noThreadRooms = !!(await jointAgentByUserId(userId));', ['socket.join(`thread:${row.id}`)'], 'connection');
  assert.match(sockets, /catch \{\s*socket\.data\.noThreadRooms = true;/);
  assert.ok(sockets.includes('if (!socket.data.noThreadRooms) try {'));
  assert.ok(sockets.includes('if (s && !s.data.noThreadRooms) s.join(`thread:${threadId}`);'));
  assert.equal(sockets.split('if (socket.data.noThreadRooms) return;').length - 1, 2, 'typing and stop_typing');
  assert.ok(sockets.includes('if (socket.data.noThreadRooms && !marked.rowCount) return;'));
});

test('an existing login with conversations is not made a joint agent', () => {
  before(access, 'JOINT_AGENT_HAS_CHATS', ['INSERT INTO landsec_access'], 'POST /api/landsec/access');
  assert.ok(access.includes('disconnectSockets(true)'));
});

test('the gateway opens chat one address at a time, for a joint agent only', () => {
  const rule = body(gateway, 'export function restrictedLandsecApiRule(', 9000);
  const chat = rule.slice(rule.indexOf('// Chat (Woody, 2026-11-13'));
  assert.ok(rule.indexOf('if (jointAgent) {') < rule.indexOf('// Chat (Woody, 2026-11-13'));
  for (const never of ['startsWith("/api/chat', 'startsWith("/api/chatbgp']) assert.ok(!rule.includes(never), `a chat prefix is open: ${never}`);
  const common = gateway.slice(gateway.indexOf('const RESTRICTED_COMMON'), gateway.indexOf('const UNIT_ID'));
  assert.ok(!common.includes('/api/chat'), 'chat is on the shared prefix list');
  assert.ok(chat.includes('p === "/api/chatbgp/chat"') && chat.includes('m === "POST"'));
});
