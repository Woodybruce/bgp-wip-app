// The messaging lock for a Landsec joint agent, against a real database
// (server/chat-joint-agent.ts, the guard in storage.addChatThreadMember).
// It needs the local fixture logins, so it runs only when
// RUN_JA_CHAT_POSTGRES=1 is set (with DATABASE_URL naming the local database).
// Every row it makes it removes again; it changes no other row.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const on = process.env.RUN_JA_CHAT_POSTGRES === "1";
const JA = "e9c13456-ce19-462c-8996-84a059b900a1";         // ja.test, CBRE, Westgate Oxford
const JA2 = "7ac4a700-0000-4000-8000-000000000001";        // another firm, Bluewater
const FULL = "35a456f4-1a01-4a70-b59f-3aa2fc94055f";       // mark.warne, a full Landsec login
const AM_BLUEWATER = "f6b60645-48bf-4970-a468-f8d31c156dd0"; // an asset manager who answers for Bluewater
const OTHER_LANDLORD = "99999999-4444-4444-4444-444444444444"; // sam.cole, Hammerson
const STAFF = "72715f6f-905d-40f4-bded-5275175f3e2b";      // victoria, BGP
const STAFF_OFF_ACCOUNT = "76098391-57a5-4bb7-be2e-a2100dd9c531"; // nick, BGP
const OWN_UNIT = "561a8f7e-c6ab-4db5-87fa-906370afe6f7";
const OTHER_UNIT = "ad71d852-80b7-4c38-9985-882a2579b748";  // Bluewater
const LIVE_DEAL = "b9a6e000-0000-4000-8000-000000000302";
const CLOSED_DEAL = "7ac4a700-0000-4000-8000-000000000004";
const WESTGATE = "de222c86-d59c-42b5-842a-a545d0e7fa44";

const made: string[] = [];
const uploads: string[] = [];
async function db() { return (await import("./db")).pool; }
async function thread(opts: { by: string; ai?: boolean; hasAi?: boolean; propertyId?: string | null; linkedType?: string | null; linkedId?: string | null; members?: string[]; messages?: Array<{ by: string | null; role?: string; content: string; attachments?: string[] }> }) {
  const pool = await db();
  const id = randomUUID();
  made.push(id);
  await pool.query(`INSERT INTO chat_threads (id, title, created_by, is_ai_chat, has_ai_member, property_id, linked_type, linked_id) VALUES ($1, 'jachat test', $2, $3, $4, $5, $6, $7)`,
    [id, opts.by, !!opts.ai, !!opts.hasAi, opts.propertyId || null, opts.linkedType || null, opts.linkedId || null]);
  for (const m of opts.members || []) await pool.query(`INSERT INTO chat_thread_members (thread_id, user_id, added_by, seen) VALUES ($1, $2, $3, false)`, [id, m, opts.by]);
  for (const m of opts.messages || []) await pool.query(`INSERT INTO chat_messages (thread_id, role, content, user_id, attachments) VALUES ($1, $2, $3, $4, $5)`, [id, m.role || "user", m.content, m.by, m.attachments || null]);
  return id;
}
const facts = (o: Partial<{ createdBy: string; isAiChat: boolean; hasAiMember: boolean; propertyId: string | null; linkedType: string | null; linkedId: string | null }> = {}) =>
  ({ createdBy: STAFF, isAiChat: false, hasAiMember: false, propertyId: null, linkedType: null, linkedId: null, ...o });

after(async () => {
  if (!on) return;
  const pool = await db();
  if (made.length) {
    await pool.query(`DELETE FROM chat_messages WHERE thread_id = ANY($1::text[])`, [made]);
    await pool.query(`DELETE FROM chat_thread_members WHERE thread_id = ANY($1::text[])`, [made]);
    await pool.query(`DELETE FROM chat_threads WHERE id = ANY($1::text[])`, [made]);
  }
  if (uploads.length) await pool.query(`DELETE FROM user_upload_history WHERE storage_key = ANY($1::text[])`, [uploads]);
  await pool.end().catch(() => {});
});

test("who a login is: a joint agent with its schemes' properties, or nobody", { skip: !on }, async () => {
  const { jointAgentByUserId, jointAgentsAmong, jointAgentOfRequest } = await import("./chat-joint-agent");
  const ja = await jointAgentByUserId(JA);
  assert.ok(ja);
  assert.deepEqual(ja!.schemeKeys, ["westgate-oxford"]);
  assert.ok(ja!.propertyIds.includes(WESTGATE));
  assert.equal(ja!.firm, "CBRE");
  for (const id of [FULL, AM_BLUEWATER, OTHER_LANDLORD, STAFF, "nobody", "", null]) assert.equal(await jointAgentByUserId(id as any), null, String(id));
  assert.deepEqual([...(await jointAgentsAmong([JA, JA2, FULL, STAFF, null])).keys()].sort(), [JA2, JA].sort());
  // The shape the email-instruction path builds: a user id and no headers.
  assert.ok(await jointAgentOfRequest({ session: { userId: JA }, headers: {} } as any));
  assert.equal(await jointAgentOfRequest({ session: { userId: FULL }, headers: {} } as any), null);
  assert.equal(await jointAgentOfRequest({ headers: {} } as any), null);
});

test("the people a joint agent may talk to: BGP on the account and Landsec at its schemes, by name only", { skip: !on }, async () => {
  const { jointAgentByUserId, chatPeopleFor } = await import("./chat-joint-agent");
  const ja = (await jointAgentByUserId(JA))!;
  const people = await chatPeopleFor(ja, JA);
  for (const p of people) assert.deepEqual(Object.keys(p).sort(), ["id", "name"]);
  const ids = new Set(people.map(p => p.id));
  assert.ok(ids.has(STAFF), "the BGP agent on its scheme is missing");
  assert.ok(ids.has(FULL), "a full Landsec login is missing");
  assert.ok(!ids.has(JA), "itself");
  assert.ok(!ids.has(JA2), "another joint agent");
  assert.ok(!ids.has(OTHER_LANDLORD), "another landlord's login");
  assert.ok(!ids.has(AM_BLUEWATER), "an asset manager who answers for another scheme");
  assert.ok(!JSON.stringify(people).includes("@"), "an email address");
  // The other agency's list is its own: the Bluewater asset manager is on it.
  const other = new Set((await chatPeopleFor((await jointAgentByUserId(JA2))!, JA2)).map(p => p.id));
  assert.ok(other.has(AM_BLUEWATER) && !other.has(JA));
});

test("who may be put in a conversation with a joint agent", { skip: !on }, async () => {
  const { chatMemberDenial, chatCreateDenial } = await import("./chat-joint-agent");
  const add = (thread: any, existingMemberIds: string[], targetUserId: string, messageCount = 0) => chatMemberDenial({ thread, existingMemberIds, targetUserId, messageCount });
  // Nobody in it is a joint agent: nothing applies, whatever the thread is.
  assert.equal(await add(facts({ isAiChat: true, hasAiMember: true, propertyId: "p" }), [STAFF, OTHER_LANDLORD], FULL, 9), null);
  // A plain conversation of staff and the joint agent.
  assert.equal(await add(facts(), [STAFF], JA), null);
  assert.equal(await add(facts({ createdBy: JA }), [JA], STAFF), null);
  assert.equal(await add(facts({ createdBy: JA }), [JA], STAFF_OFF_ACCOUNT), null, "any BGP staff may be in it");
  assert.equal(await add(facts({ createdBy: JA }), [JA, STAFF], FULL), null);
  // Refused.
  assert.ok(await add(facts({ isAiChat: true }), [], JA), "a ChatBGP chat");
  assert.ok(await add(facts({ createdBy: JA, isAiChat: true }), [], STAFF), "its own ChatBGP chat takes nobody");
  assert.ok(await add(facts({ hasAiMember: true }), [STAFF], JA), "ChatBGP in it");
  assert.ok(await add(facts({ propertyId: WESTGATE }), [STAFF], JA), "linked to a property");
  assert.ok(await add(facts({ linkedType: "deal" }), [STAFF], JA), "linked type");
  assert.ok(await add(facts({ linkedId: "x" }), [STAFF], JA), "linked id");
  assert.ok(await add(facts({ linkedType: "channel", linkedId: "gossip" }), [STAFF], JA), "the gossip channel");
  assert.ok(await add(facts(), [STAFF], JA, 1), "a conversation that has a message");
  assert.ok(await add(facts(), [STAFF, OTHER_LANDLORD], JA), "another landlord's login is in it");
  assert.ok(await add(facts({ createdBy: JA }), [JA, STAFF], OTHER_LANDLORD), "another landlord's login is added");
  assert.ok(await add(facts({ createdBy: JA }), [JA], AM_BLUEWATER), "an asset manager for another scheme");
  assert.ok(await add(facts(), [STAFF, JA], JA2), "a joint agent of another firm");
  // Before a conversation exists.
  assert.equal(await chatCreateDenial({ creatorId: STAFF, memberIds: [JA], thread: { isAiChat: false, hasAiMember: false, propertyId: null, linkedType: null, linkedId: null } }), null);
  assert.ok(await chatCreateDenial({ creatorId: STAFF, memberIds: [JA], thread: { isAiChat: false, hasAiMember: false, propertyId: WESTGATE, linkedType: null, linkedId: null } }));
  assert.ok(await chatCreateDenial({ creatorId: STAFF, memberIds: [JA, "__chatbgp__"], thread: { isAiChat: false, hasAiMember: true, propertyId: null, linkedType: null, linkedId: null } }));
  assert.ok(await chatCreateDenial({ creatorId: STAFF, memberIds: [JA], thread: { isAiChat: true, hasAiMember: false, propertyId: null, linkedType: null, linkedId: null } }));
  assert.ok(await chatCreateDenial({ creatorId: STAFF, memberIds: [JA, OTHER_LANDLORD], thread: { isAiChat: false, hasAiMember: false, propertyId: null, linkedType: null, linkedId: null } }));
  assert.equal(await chatCreateDenial({ creatorId: JA, memberIds: [], thread: { isAiChat: true, hasAiMember: false, propertyId: null, linkedType: null, linkedId: null } }), null);
  assert.equal(await chatCreateDenial({ creatorId: STAFF, memberIds: [FULL, OTHER_LANDLORD, "__chatbgp__"], thread: { isAiChat: false, hasAiMember: true, propertyId: "p", linkedType: "deal", linkedId: "d" } }), null, "no joint agent: unchanged");
});

test("the one door for a member row refuses the same things, whoever is adding", { skip: !on }, async () => {
  const { storage } = await import("./storage");
  const pool = await db();
  const refused = async (threadId: string, userId: string, why: string) => {
    await assert.rejects(storage.addChatThreadMember({ threadId, userId, addedBy: STAFF, seen: false }), (e: any) => e?.code === "CHAT_MEMBER_REFUSED", why);
    assert.equal((await pool.query(`SELECT 1 FROM chat_thread_members WHERE thread_id = $1 AND user_id = $2`, [threadId, userId])).rows.length, 0, `${why}: a row was added`);
  };
  await refused(await thread({ by: STAFF, ai: true }), JA, "a staff ChatBGP chat");
  await refused(await thread({ by: STAFF, hasAi: true, members: [STAFF] }), JA, "ChatBGP in it");
  await refused(await thread({ by: STAFF, propertyId: WESTGATE, members: [STAFF] }), JA, "linked to a property");
  await refused(await thread({ by: STAFF, linkedType: "company", linkedId: "c", members: [STAFF] }), JA, "linked to a brand");
  await refused(await thread({ by: STAFF, members: [STAFF], messages: [{ by: STAFF, content: "history" }] }), JA, "has history");
  await refused(await thread({ by: STAFF, members: [STAFF, OTHER_LANDLORD] }), JA, "another landlord's login is in it");
  await refused(await thread({ by: JA, ai: true }), STAFF, "its own ChatBGP chat");
  const shared = await thread({ by: STAFF, members: [STAFF] });
  const row = await storage.addChatThreadMember({ threadId: shared, userId: JA, addedBy: STAFF, seen: false });
  assert.equal(row.userId, JA);
  assert.equal(row.threadId, shared);
  assert.equal(row.seen, false);
  await refused(shared, OTHER_LANDLORD, "another landlord's login is added to its conversation");
  await refused(shared, JA2, "another agency is added to its conversation");
  await refused(shared, AM_BLUEWATER, "an asset manager for another scheme");
  assert.equal((await storage.addChatThreadMember({ threadId: shared, userId: FULL, addedBy: STAFF, seen: false })).userId, FULL);
  assert.equal((await storage.addChatThreadMember({ threadId: shared, userId: JA, addedBy: STAFF, seen: false })).userId, JA, "already a member: handed back");
  // A message that lands after the count and before the insert: the insert
  // itself refuses (the same statement the door runs).
  const racing = await thread({ by: STAFF, members: [STAFF], messages: [{ by: STAFF, content: "landed in between" }] });
  const r = await pool.query(
    `INSERT INTO chat_thread_members (thread_id, user_id, added_by, seen)
     SELECT $1::varchar, $2::varchar, $3, false WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE thread_id = $1::varchar) RETURNING id`, [racing, JA, STAFF]);
  assert.equal(r.rows.length, 0);
  // Nobody else is narrowed: a full Landsec login joins a thread with history.
  const ordinary = await thread({ by: STAFF, members: [STAFF], propertyId: WESTGATE, messages: [{ by: STAFF, content: "history" }] });
  assert.equal((await storage.addChatThreadMember({ threadId: ordinary, userId: FULL, addedBy: STAFF, seen: false })).userId, FULL);
});

test("is there a joint agent in this conversation", { skip: !on }, async () => {
  const { threadHasJointAgent, jointAgentThreadKindById } = await import("./chat-joint-agent");
  const withJa = await thread({ by: STAFF, members: [STAFF, JA] });
  const byJa = await thread({ by: JA, ai: true });
  const without = await thread({ by: STAFF, members: [STAFF, FULL] });
  const linked = await thread({ by: STAFF, members: [STAFF, JA], propertyId: WESTGATE });
  const sharedAi = await thread({ by: STAFF, members: [STAFF, JA], hasAi: true });
  const staffAi = await thread({ by: STAFF, ai: true, members: [JA] });
  assert.equal(await threadHasJointAgent(withJa), true);
  assert.equal(await threadHasJointAgent(byJa), true);
  assert.equal(await threadHasJointAgent(without), false);
  assert.equal(await threadHasJointAgent(randomUUID()), false);
  assert.equal(await jointAgentThreadKindById(JA, withJa), "team");
  assert.equal(await jointAgentThreadKindById(JA, byJa), "own_ai");
  assert.equal(await jointAgentThreadKindById(JA, without), null);
  assert.equal(await jointAgentThreadKindById(JA, linked), null, "a linked conversation is hidden from it");
  assert.equal(await jointAgentThreadKindById(JA, sharedAi), null, "a conversation with ChatBGP in it is hidden from it");
  assert.equal(await jointAgentThreadKindById(JA, staffAi), null, "somebody else's ChatBGP chat");
  assert.equal(await jointAgentThreadKindById(JA2, byJa), null);
  for (const bad of [undefined, null, "", 5, {}, randomUUID()]) assert.equal(await jointAgentThreadKindById(JA, bad), null);
});

test("what a tag may show it: its own units and live deals", { skip: !on }, async () => {
  const { jointAgentByUserId, allowSetsFor, liveDealsAt } = await import("./chat-joint-agent");
  const ja = (await jointAgentByUserId(JA))!;
  const text = `@[a](tag:unit/${OWN_UNIT}) @[b](tag:unit/${OTHER_UNIT}) @[c](tag:deal/${LIVE_DEAL}) @[d](tag:deal/${CLOSED_DEAL})`;
  const allow = await allowSetsFor(ja, [text, null, 5], [STAFF, JA]);
  assert.deepEqual([...allow.unitIds], [OWN_UNIT]);
  assert.deepEqual([...allow.dealIds], [LIVE_DEAL]);
  assert.deepEqual([...allow.memberIds].sort(), [STAFF, JA].sort());
  const live = (await liveDealsAt(ja.propertyIds)).map(d => d.id);
  assert.ok(live.includes(LIVE_DEAL) && !live.includes(CLOSED_DEAL));
  assert.deepEqual(await liveDealsAt([]), []);
  assert.deepEqual(await liveDealsAt(ja.propertyIds, { ids: [] }), []);
  // With no schemes resolved nothing is allowed.
  const none = await allowSetsFor({ ...ja, propertyIds: [] }, [text], [JA]);
  assert.equal(none.unitIds.size + none.dealIds.size, 0);
});

test("what it may post, and what an edit may become", { skip: !on }, async () => {
  const { jointAgentByUserId, postDenialForJointAgent } = await import("./chat-joint-agent");
  const pool = await db();
  const ja = (await jointAgentByUserId(JA))!;
  const members = [STAFF, JA];
  const post = (content: unknown, attachments?: unknown) => postDenialForJointAgent(ja, members, { content, attachments });
  assert.equal((await post("Hello there")).error, null);
  assert.equal((await post(`See @[RU9](tag:unit/${OWN_UNIT}) and @[Deal](tag:deal/${LIVE_DEAL}) @[Victoria](tag:user/${STAFF})`)).error, null);
  for (const bad of [
    "", "   ", null, undefined, 5, { text: "x" }, ["x"], "x".repeat(20001),
    `@[Brand](tag:company/${randomUUID()})`, `@[Pat](tag:contact/${randomUUID()})`, `@[Bluewater](tag:property/${WESTGATE})`, `@[F](tag:folder/aHR0cA)`, `@[X](tag:invoice/1)`,
    `@[Unit](tag:unit/${OTHER_UNIT})`, `@[Old](tag:deal/${CLOSED_DEAL})`, `@[Nick](tag:user/${STAFF_OFF_ACCOUNT})`, `@[ChatBGP](tag:user/__chatbgp__)`,
    `@[Brand](tag:company/${randomUUID()}`, `(tag:company/${randomUUID()})`, `@[Brand](TAG:Company/${randomUUID()})`,
  ]) assert.ok((await post(bad)).error, `accepted: ${String(bad).slice(0, 60)}`);
  // Attachments: only a chat file this login uploaded.
  const mine = `jachat-${randomUUID()}.pdf`;
  const theirs = `jachat-${randomUUID()}.pdf`;
  uploads.push(`chat-media/${mine}`, `chat-media/${theirs}`);
  await pool.query(`INSERT INTO user_upload_history (user_id, storage_key, original_name, url) VALUES ($1, $2, 'mine.pdf', $3)`, [JA, `chat-media/${mine}`, `/api/chat-media/${mine}`]);
  await pool.query(`INSERT INTO user_upload_history (user_id, storage_key, original_name, url) VALUES ($1, $2, 'theirs.pdf', $3)`, [STAFF, `chat-media/${theirs}`, `/api/chat-media/${theirs}`]);
  const ok = await post("file", [JSON.stringify({ url: `/api/chat-media/${mine}`, name: "mine.pdf", size: 3, type: "application/pdf", extra: "dropped" })]);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.attachments!.map(a => JSON.parse(a)), [{ url: `/api/chat-media/${mine}`, name: "mine.pdf", size: 3, type: "application/pdf" }]);
  assert.equal((await post("file", [{ url: `/api/chat-media/${mine}`, name: "mine.pdf" }])).error, null);
  for (const bad of [
    [JSON.stringify({ url: `/api/chat-media/${theirs}`, name: "x" })],
    [JSON.stringify({ url: "https://bgp.sharepoint.com/sites/x/file.pdf", name: "x" })],
    [JSON.stringify({ url: `/api/chat-media/${mine}/../${theirs}` })],
    [JSON.stringify({ url: `/api/available-units/files/${randomUUID()}` })],
    ["not json"], [5], "a string", { url: `/api/chat-media/${mine}` },
  ]) assert.ok((await post("file", bad)).error, `accepted: ${JSON.stringify(bad).slice(0, 80)}`);
});

test("a conversation as it is sent: named fields, redacted, files from the chat store only", { skip: !on }, async () => {
  const { jointAgentByUserId, allowSetsFor, threadForJointAgent } = await import("./chat-joint-agent");
  const ja = (await jointAgentByUserId(JA))!;
  const brand = randomUUID();
  const content = `Hi @[Nick Outsider](tag:user/${STAFF_OFF_ACCOUNT}) re @[Jersey Mikes](tag:company/${brand}) at @[RU9](tag:unit/${OWN_UNIT}) not @[Bluewater unit](tag:unit/${OTHER_UNIT})`;
  const stored = {
    id: "t1", title: `About @[Jersey Mikes](tag:company/${brand})`, createdBy: STAFF, isAiChat: false, hasAiMember: false, createdAt: "c", updatedAt: "u",
    propertyId: "SECRET-PROPERTY", propertyName: "SECRET-NAME", linkedType: "deal", linkedId: "SECRET-LINK", linkedName: "SECRET-NAME", groupPicUrl: "/SECRET-PIC", projectId: "SECRET-PROJECT", modelPreference: "SECRET-MODEL",
  };
  const messages = [{
    id: "m1", threadId: "t1", role: "user", userId: STAFF, createdAt: "c", content, actionData: JSON.stringify({ secret: "SECRET-ACTION" }),
    attachments: [JSON.stringify({ url: "/api/chat-media/a.pdf", name: "a.pdf", size: 1, type: "application/pdf", secret: "SECRET-EXTRA" }), JSON.stringify({ url: "https://bgp.sharepoint.com/SECRET-FILE" }), "SECRET-LEGACY.pdf"],
  }];
  const allow = await allowSetsFor(ja, [stored.title, content], [STAFF, JA]);
  const view = threadForJointAgent({ thread: stored, kind: "team", members: [{ id: STAFF, name: "Victoria", seen: true }, { id: JA, name: "Jo", seen: false }], creatorName: "Victoria", allow, messages, last: { content, senderName: "Victoria", createdAt: "c" } });
  const text = JSON.stringify(view);
  for (const leak of ["SECRET", brand, "Jersey", STAFF_OFF_ACCOUNT, "Nick Outsider", OTHER_UNIT, "Bluewater unit", "sharepoint", "modelPreference"]) assert.ok(!text.includes(leak), `sent ${leak}`);
  assert.ok(view.messages![0].content.includes(`@[RU9](tag:unit/${OWN_UNIT})`));
  assert.equal(view.messages![0].content, `Hi [someone] re [a company] at @[RU9](tag:unit/${OWN_UNIT}) not [another unit]`);
  assert.equal(view.title, "About [a company]");
  assert.deepEqual(view.messages![0].attachments!.map(a => JSON.parse(a)), [{ url: "/api/chat-media/a.pdf", name: "a.pdf", size: 1, type: "application/pdf" }]);
  assert.equal(view.messages![0].actionData, null);
  assert.ok(view.lastMessage!.content.length <= 83 && !view.lastMessage!.content.includes("(tag:company"));
  assert.deepEqual(Object.keys(view).sort(), ["createdAt", "createdBy", "creatorName", "groupPicUrl", "hasAiMember", "id", "isAiChat", "kind", "lastMessage", "linkedId", "linkedName", "linkedType", "members", "messages", "projectId", "propertyId", "propertyName", "title", "updatedAt"]);
});

test("what a notification carries: the redacted line for a joint agent, the plain line for everyone else", { skip: !on }, async () => {
  const { notificationLinesFor } = await import("./chat-joint-agent");
  const brand = randomUUID();
  const content = `Offer in from @[Jersey Mikes](tag:company/${brand}) on @[RU9](tag:unit/${OWN_UNIT})`;
  const lines = await notificationLinesFor({ threadId: "T", content, recipientIds: [JA, FULL], memberIds: [STAFF, JA, FULL], plain: content.slice(0, 80) });
  assert.equal(lines.get(FULL)!.preview, content.slice(0, 80));
  assert.equal(lines.get(FULL)!.url, "/chatbgp?thread=T");
  assert.ok(!lines.get(JA)!.preview.includes(brand.slice(0, 8)) && !lines.get(JA)!.preview.includes("Jersey"));
  assert.ok(lines.get(JA)!.preview.startsWith("Offer in from [a company] on"));
  assert.equal(lines.get(JA)!.url, "/landsec/chat?thread=T");
});

test("the task-done line is never written into a conversation with a joint agent", { skip: !on }, async () => {
  const { NO_JOINT_AGENT_THREAD_SQL } = await import("./chat-joint-agent");
  const pool = await db();
  // A linked thread with a joint agent in it cannot be made through the app:
  // these rows are written directly to prove the hook's own query skips one.
  const withJa = await thread({ by: STAFF, members: [STAFF, JA], propertyId: WESTGATE });
  const byJa = await thread({ by: JA, members: [FULL], propertyId: WESTGATE });
  const withFull = await thread({ by: STAFF, members: [STAFF, FULL], propertyId: WESTGATE });
  const r = await pool.query(
    `SELECT DISTINCT t.id FROM chat_threads t
      JOIN chat_thread_members tm ON tm.thread_id = t.id
      JOIN users cu ON cu.id = tm.user_id AND cu.role = 'Client'
     WHERE t.property_id = $1 AND t.is_ai_chat IS NOT TRUE
       AND ${NO_JOINT_AGENT_THREAD_SQL}`, [WESTGATE]);
  const ids = r.rows.map((x: any) => x.id);
  assert.ok(ids.includes(withFull), "a full Landsec login's thread still gets the line");
  assert.ok(!ids.includes(withJa) && !ids.includes(byJa));
});

test("a file in the chat store: its own upload, or one somebody else posted in its conversation", { skip: !on }, async () => {
  const pool = await db();
  // The statement the download route runs for a joint agent.
  const { readFileSync } = await import("node:fs");
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const at = routes.indexOf("if (mediaJointAgent) {");
  const sql = routes.slice(routes.indexOf("`", at) + 1, routes.indexOf("`,", at));
  assert.ok(sql.includes("m.user_id IS DISTINCT FROM $1") && !sql.includes("action_data"));
  const reach = async (file: string) => ((await pool.query(sql, [JA, file])).rowCount || 0) > 0;
  const typed = `jachat-${randomUUID()}.pdf`;
  const posted = `jachat-${randomUUID()}.pdf`;
  const inLinked = `jachat-${randomUUID()}.pdf`;
  const byAi = `jachat-${randomUUID()}.pdf`;
  const mine = `jachat-${randomUUID()}.pdf`;
  uploads.push(`chat-media/${mine}`);
  await pool.query(`INSERT INTO user_upload_history (user_id, storage_key, original_name, url) VALUES ($1, $2, 'm.pdf', 'u')`, [JA, `chat-media/${mine}`]);
  await thread({ by: JA, ai: true, messages: [{ by: JA, content: `look at /api/chat-media/${typed}` }, { by: null, role: "assistant", content: `/api/chat-media/${byAi}` }] });
  await thread({ by: STAFF, members: [STAFF, JA], messages: [{ by: JA, content: `/api/chat-media/${typed}`, attachments: [JSON.stringify({ url: `/api/chat-media/${typed}` })] }, { by: STAFF, content: "here", attachments: [JSON.stringify({ url: `/api/chat-media/${posted}` })] }] });
  await thread({ by: STAFF, members: [STAFF, JA], propertyId: WESTGATE, messages: [{ by: STAFF, content: `/api/chat-media/${inLinked}` }] });
  assert.equal(await reach(typed), false, "typing a file name is no entitlement");
  assert.equal(await reach(posted), true);
  assert.equal(await reach(mine), true);
  assert.equal(await reach(inLinked), false, "a conversation it may not hold");
  assert.equal(await reach(byAi), false);
  assert.equal(await reach("%"), false);
  assert.equal(await reach("_"), false);
});

test("an existing login with conversations is not made a joint agent", { skip: !on }, async () => {
  const pool = await db();
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./landsec-access.ts", import.meta.url), "utf8");
  const at = src.indexOf('role === "joint_agent" && before?.landsec_role !== "joint_agent"');
  assert.ok(at > 0 && src.indexOf("JOINT_AGENT_HAS_CHATS") > at);
  assert.ok(at < src.indexOf("INSERT INTO landsec_access"), "the refusal comes before anything is written");
  const sql = src.slice(src.indexOf("`", at) + 1, src.indexOf("`,", at));
  const has = async (id: string) => (await pool.query(sql, [id])).rows.length > 0;
  assert.equal(await has("7ac4a700-0000-4000-8000-000000000002"), true, "the fixture login with a ChatBGP chat");
  assert.equal(await has(randomUUID()), false);
});

test("the email-instruction path: a joint agent's tool call is refused by its own gate", { skip: !on }, async () => {
  const { jointAgentToolGate, JOINT_AGENT_TOOL_REFUSAL } = await import("./chatbgp-joint-agent");
  const stub = { session: { userId: JA }, headers: {} } as any;
  for (const name of ["search_crm", "sql_query", "send_email", "query_leasing_schedule", "navigate_to"]) {
    assert.deepEqual(await jointAgentToolGate(name, {}, stub), { data: { success: false, error: JOINT_AGENT_TOOL_REFUSAL } }, name);
  }
  // One of its own tools with no login to forward reads nothing.
  assert.equal((await jointAgentToolGate("ja_my_schemes", {}, stub))!.data.success, false);
  assert.equal(await jointAgentToolGate("search_crm", {}, { session: { userId: FULL }, headers: {} } as any), null);
  // A unit that is not at its schemes, checked against the database.
  const withLogin = { session: { userId: JA }, headers: { authorization: "Bearer none" } } as any;
  let read = 0;
  const fetcher = async () => { read++; return { status: 200, json: async () => ({}) }; };
  for (const [tool, key, id] of [["ja_get_unit", "unitId", OTHER_UNIT], ["ja_get_offers", "unitId", OTHER_UNIT], ["ja_get_heads_of_terms", "unitId", OTHER_UNIT], ["ja_get_deal_checklist", "unitId", OTHER_UNIT], ["ja_get_recommendation", "unitId", OTHER_UNIT], ["ja_get_brief", "briefId", randomUUID()], ["ja_get_negotiation", "offerId", randomUUID()]] as const) {
    const out = await jointAgentToolGate(tool, { [key]: id }, withLogin, { fetcher });
    assert.equal(out!.data.success, false, tool);
  }
  assert.equal(read, 0, "an address was read for a record off its schemes");
  const own = await jointAgentToolGate("ja_get_offers", { unitId: OWN_UNIT }, withLogin, { fetcher: async () => { read++; return { status: 200, json: async () => ([{ offerId: "o", companyName: "B" }]) }; } });
  assert.deepEqual(own!.data, [{ offerId: "o", companyName: "B" }]);
});
