// Team messaging for a Landsec joint agent (Woody, 13 November 2026, asked
// whether to build "Chat for joint agents, which needs a locked-down ChatBGP
// first": "yes go ahead"). A joint agent is another agency's login held to
// the schemes on it, so chat is cut the same way: who it may talk to, what a
// conversation with it in may be, what a tag may show it. The pure rules are
// in shared/chat-joint-agent.ts; its ChatBGP is server/chatbgp-joint-agent.ts.
//
// Every read of the role here fails closed: a read that throws is never
// treated as "not a joint agent" (that login would then be served as a full
// Landsec client).
import type { Express, Request } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { getLandsecAccess } from "./landsec-access";
import { landsecCompanyId, resolveLandsecPortfolio, LANDSEC_SCHEMES } from "./landsec-schemes";
import { getClientVisibleUserIds } from "./company-scope";
import { legacyToCode, CLOSED_STATUSES } from "@shared/deal-status";
import { isKnownLandsecRole, UNKNOWN_LANDSEC_ROLE_ERROR } from "@shared/landsec";
import { redactChatText, previewFor, tagIdsIn, hasBrokenTag, jointAgentThreadKind, type JointAgentTagAllow } from "@shared/chat-joint-agent";

export interface ChatJointAgent { userId: string; firm: string | null; schemeKeys: string[]; propertyIds: string[] }

const STAFF_SQL = `u.is_active IS NOT FALSE AND lower(u.email) LIKE '%@brucegillinghampollard.com' AND COALESCE(u.role, '') <> 'Client'`;
const CHAT_MEDIA_URL = /^\/api\/chat-media\/([^/?#]+)$/;
export const JOINT_AGENT_MESSAGE_MAX = 20000;

// A role row that is not one of the two full Landsec roles: a joint agent,
// or a value nobody recognises, which is treated as one wherever a
// conversation is checked (and refused wherever a login is read).
const NOT_FULL_ROLE_SQL = (col: string) => `COALESCE(${col}, '') NOT IN ('leasing_manager', 'asset_manager')`;

// Only a database with no landsec_access table reads as "no joint agents".
const accessRead = (sql: string, params: any[]) => pool.query(sql, params).catch((e: any) => {
  if (e?.code === "42P01") return { rows: [] as any[] };
  throw e;
});

async function withProperties(userId: string, schemes: unknown, firm: unknown): Promise<ChatJointAgent> {
  const schemeKeys = (Array.isArray(schemes) ? schemes.map(String) : []).filter(k => LANDSEC_SCHEMES.some(s => s.key === k));
  const companyId = await landsecCompanyId();
  const propertyIds = companyId && schemeKeys.length
    ? (await resolveLandsecPortfolio(companyId)).schemes.filter(s => schemeKeys.includes(s.key)).flatMap(s => s.properties.map(p => p.id))
    : [];
  return { userId, firm: firm ? String(firm) : null, schemeKeys, propertyIds };
}

// Is this login a joint agent? Null = it is not. Throws when it cannot say.
export async function jointAgentByUserId(userId: string | null | undefined): Promise<ChatJointAgent | null> {
  if (!userId) return null;
  const r = await accessRead(`SELECT landsec_role, schemes, firm FROM landsec_access WHERE user_id = $1`, [userId]);
  if (!r.rows[0]) return null;
  if (!isKnownLandsecRole(r.rows[0].landsec_role)) throw new Error(UNKNOWN_LANDSEC_ROLE_ERROR);
  if (r.rows[0].landsec_role !== "joint_agent") return null;
  return withProperties(userId, r.rows[0].schemes, r.rows[0].firm);
}

// The same answer the gateway took for this request (getLandsecAccess keeps
// it on the request). The role row alone decides: nothing can lift a login
// with a joint agent row out of the jail.
export async function jointAgentOfRequest(req: Request): Promise<ChatJointAgent | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const access = await getLandsecAccess(req);
  if (access?.role !== "joint_agent") return null;
  return withProperties(String(userId), access.schemes, access.firm);
}

// Which of these logins are joint agents. Throws when it cannot say.
export async function jointAgentsAmong(userIds: Array<string | null | undefined>): Promise<Map<string, ChatJointAgent>> {
  const ids = [...new Set(userIds.filter((v): v is string => typeof v === "string" && !!v))];
  const out = new Map<string, ChatJointAgent>();
  if (!ids.length) return out;
  const r = await accessRead(`SELECT user_id, landsec_role, schemes, firm FROM landsec_access WHERE user_id = ANY($1::text[]) AND ${NOT_FULL_ROLE_SQL("landsec_role")}`, [ids]);
  for (const row of r.rows) {
    if (!isKnownLandsecRole(row.landsec_role)) throw new Error(UNKNOWN_LANDSEC_ROLE_ERROR);
    out.set(row.user_id, await withProperties(row.user_id, row.schemes, row.firm));
  }
  return out;
}

// The Landsec logins a joint agent may talk to: Landsec's own people (never
// another joint agent), and an asset manager who answers for named schemes
// only when one of them is on the joint agent's login. The same rule as the
// people it is offered on a brief (briefClientCandidates).
async function landsecLoginsFor(ja: ChatJointAgent): Promise<Array<{ id: string; name: string }>> {
  const companyId = await landsecCompanyId();
  if (!companyId) return [];
  const company = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId])).rows[0]?.name;
  if (!company) return [];
  const r = await accessRead(
    `SELECT u.id, u.name, a.landsec_role, a.schemes FROM users u LEFT JOIN landsec_access a ON a.user_id = u.id
      WHERE COALESCE(u.is_active, true) AND u.role = 'Client' AND lower(u.team) = lower($1)
        AND (a.user_id IS NULL OR a.landsec_role IN ('leasing_manager', 'asset_manager')) ORDER BY u.name`, [company]);
  const out: Array<{ id: string; name: string }> = [];
  for (const u of r.rows) {
    const answersFor: string[] = Array.isArray(u.schemes) ? u.schemes : [];
    if (u.landsec_role === "asset_manager" && answersFor.length > 0 && !answersFor.some(k => ja.schemeKeys.includes(k))) continue;
    out.push({ id: u.id, name: u.name || "Landsec" });
  }
  return out;
}

// Who a joint agent may start a conversation with: the BGP people on the
// Landsec account and the Landsec logins at its schemes. Names only.
export async function chatPeopleFor(ja: ChatJointAgent, selfId: string): Promise<Array<{ id: string; name: string }>> {
  const companyId = await landsecCompanyId();
  if (!companyId) return [];
  const onAccount = [...(await getClientVisibleUserIds(companyId))];
  const bgp = onAccount.length
    ? (await pool.query(`SELECT u.id, u.name FROM users u WHERE u.id = ANY($1::text[]) AND ${STAFF_SQL} ORDER BY u.name`, [onAccount])).rows
    : [];
  const seen = new Set<string>([selfId]);
  const out: Array<{ id: string; name: string }> = [];
  for (const p of [...bgp, ...(await landsecLoginsFor(ja))]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: String(p.id), name: String(p.name || "Unknown") });
  }
  return out;
}

export interface ChatThreadFacts {
  createdBy: string | null;
  isAiChat: boolean | null;
  hasAiMember: boolean | null;
  propertyId: string | null;
  linkedType: string | null;
  linkedId: string | null;
}

// May this person be put in this conversation? Null = yes. With no joint
// agent in it or being added, nothing here applies to anyone. With one, the
// conversation must be between people (no ChatBGP), linked to no record,
// and hold only BGP staff and the Landsec people at that joint agent's
// schemes; a joint agent joins only before the first message.
export async function chatMemberDenial(input: { thread: ChatThreadFacts; existingMemberIds: string[]; targetUserId: string; messageCount: number }): Promise<string | null> {
  const { thread, targetUserId } = input;
  const everyone = [...new Set([thread.createdBy, ...input.existingMemberIds, targetUserId].filter((v): v is string => !!v))];
  const agents = await jointAgentsAmong(everyone);
  if (agents.size === 0) return null;
  if (thread.isAiChat !== false) return "A ChatBGP chat cannot be shared with a joint agent";
  if (thread.hasAiMember) return "A conversation with ChatBGP in it cannot include a joint agent";
  if (thread.propertyId || thread.linkedType || thread.linkedId) return "A conversation with a joint agent cannot be linked to a record";
  if (agents.has(targetUserId) && input.messageCount !== 0) return "A joint agent can only join a conversation before its first message. Start a new conversation.";
  const firms = new Set([...agents.values()].map(a => (a.firm || "").trim().toLowerCase()));
  if (agents.size > 1 && (firms.size !== 1 || firms.has(""))) return "Joint agents from different firms cannot share a conversation";
  const others = everyone.filter(id => !agents.has(id));
  if (others.length) {
    const staff = new Set((await pool.query(`SELECT u.id FROM users u WHERE u.id = ANY($1::text[]) AND ${STAFF_SQL}`, [others])).rows.map((r: any) => r.id));
    const notStaff = others.filter(id => !staff.has(id));
    if (notStaff.length) {
      for (const ja of agents.values()) {
        const allowed = new Set((await landsecLoginsFor(ja)).map(p => p.id));
        if (notStaff.some(id => !allowed.has(id))) return "That person cannot be in a conversation with this joint agent";
      }
    }
  }
  return null;
}

// The same check for a conversation that does not exist yet, so a refusal
// comes before anything is made. Null = it may be made.
export async function chatCreateDenial(input: { creatorId: string; memberIds: string[]; thread: Omit<ChatThreadFacts, "createdBy"> }): Promise<string | null> {
  const thread: ChatThreadFacts = { ...input.thread, createdBy: input.creatorId };
  const members: string[] = [];
  const order = input.thread.isAiChat === false ? [input.creatorId, ...input.memberIds] : input.memberIds;
  for (const id of [...new Set(order)]) {
    if (!id || id === "__chatbgp__") continue;
    const denial = await chatMemberDenial({ thread, existingMemberIds: members, targetUserId: id, messageCount: 0 });
    if (denial) return denial;
    members.push(id);
  }
  if (!members.length && (await jointAgentsAmong([input.creatorId])).size) {
    // A joint agent's own ChatBGP chat: nobody else, no link, no shared AI.
    if (input.thread.isAiChat === false) return null;
    if (input.thread.hasAiMember || input.thread.propertyId || input.thread.linkedType || input.thread.linkedId) return "A joint agent's chat cannot be linked to a record";
  }
  return null;
}

// Does this conversation have a joint agent in it (its creator or a
// member)? Throws when it cannot say: a caller treats a throw as yes.
export async function threadHasJointAgent(threadId: string): Promise<boolean> {
  const r = await accessRead(
    `SELECT 1 FROM landsec_access a
      WHERE ${NOT_FULL_ROLE_SQL("a.landsec_role")}
        AND (a.user_id = (SELECT created_by FROM chat_threads WHERE id = $1)
             OR a.user_id IN (SELECT user_id FROM chat_thread_members WHERE thread_id = $1))
      LIMIT 1`, [threadId]);
  return r.rows.length > 0;
}
export async function threadHasJointAgentOrFailed(threadId: string): Promise<boolean> {
  try { return await threadHasJointAgent(threadId); } catch { return true; }
}

// The SQL that keeps an automatic line out of any conversation with a joint
// agent in it (t = chat_threads).
export const NO_JOINT_AGENT_THREAD_SQL = `NOT EXISTS (
  SELECT 1 FROM landsec_access ja WHERE ${NOT_FULL_ROLE_SQL("ja.landsec_role")}
     AND (ja.user_id = t.created_by OR ja.user_id IN (SELECT jm.user_id FROM chat_thread_members jm WHERE jm.thread_id = t.id)))`;

// The deals a joint agent may be shown by id or name: the live ones at its
// schemes, by the rule its Deals page lists them (GET /api/landsec/deals).
export async function liveDealsAt(propertyIds: string[], opts: { ids?: string[]; like?: string; limit?: number } = {}): Promise<Array<{ id: string; name: string | null; ref: any }>> {
  if (!propertyIds.length) return [];
  if (opts.ids && !opts.ids.length) return [];
  const r = await pool.query(
    `SELECT d.id, d.name, d.deal_ref, d.status FROM crm_deals d
      WHERE d.property_id = ANY($1::text[]) AND d.status IS NOT NULL AND lower(trim(d.status)) <> ALL($2::text[])
        AND ($3::text[] IS NULL OR d.id = ANY($3::text[]))
        AND ($4::text IS NULL OR d.name ILIKE $4)
      ORDER BY d.updated_at DESC NULLS LAST LIMIT $5`,
    [propertyIds, CLOSED_STATUSES.map(c => c.toLowerCase()), opts.ids || null, opts.like || null, opts.limit || 500]);
  return r.rows
    .filter((d: any) => { const c = legacyToCode(d.status); return c && !CLOSED_STATUSES.includes(c); })
    .map((d: any) => ({ id: d.id, name: d.name, ref: d.deal_ref }));
}

// What the tags in these texts may show this joint agent.
export async function allowSetsFor(ja: ChatJointAgent, texts: unknown[], memberIds: Iterable<string>): Promise<JointAgentTagAllow> {
  const units = new Set<string>();
  const deals = new Set<string>();
  for (const t of texts) { const ids = tagIdsIn(t); ids.units.forEach(i => units.add(i)); ids.deals.forEach(i => deals.add(i)); }
  const allow: JointAgentTagAllow = { memberIds: new Set([...memberIds].filter(Boolean)), unitIds: new Set(), dealIds: new Set() };
  if (!ja.propertyIds.length) return allow;
  if (units.size) {
    const r = await pool.query(`SELECT id FROM available_units WHERE id = ANY($1::text[]) AND property_id = ANY($2::text[])`, [[...units], ja.propertyIds]);
    for (const row of r.rows) allow.unitIds.add(row.id);
  }
  if (deals.size) for (const d of await liveDealsAt(ja.propertyIds, { ids: [...deals] })) allow.dealIds.add(d.id);
  return allow;
}

function attachmentForJointAgent(raw: unknown): string | null {
  let a: any = raw;
  if (typeof raw === "string") { try { a = JSON.parse(raw); } catch { return null; } }
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  if (typeof a.url !== "string" || !CHAT_MEDIA_URL.test(a.url)) return null;
  return JSON.stringify({
    url: a.url,
    name: typeof a.name === "string" ? a.name : null,
    size: typeof a.size === "number" ? a.size : null,
    type: typeof a.type === "string" ? a.type : null,
  });
}

export interface JointAgentThreadView {
  id: string; title: string | null; createdBy: string; isAiChat: boolean; hasAiMember: false;
  createdAt: any; updatedAt: any; creatorName: string; members: Array<{ id: string; name: string; seen: boolean }>;
  propertyId: null; propertyName: null; linkedType: null; linkedId: null; linkedName: null; groupPicUrl: null; projectId: null;
  kind: "team" | "own_ai";
  lastMessage?: { content: string; senderName: string; createdAt: any } | null;
  messages?: Array<{ id: string; threadId: string; role: string; userId: string | null; createdAt: any; content: string; actionData: null; attachments: string[] | null }>;
}

// A conversation as a joint agent is sent it: named fields only, never the
// stored row. In a team conversation every text goes through the redaction.
export function threadForJointAgent(input: {
  thread: any; kind: "team" | "own_ai"; members: Array<{ id: string; name: string; seen: any }>; creatorName: string;
  allow: JointAgentTagAllow; messages?: any[]; last?: { content: unknown; senderName: string; createdAt: any } | null;
}): JointAgentThreadView {
  const { thread, kind, allow } = input;
  const text = (v: unknown) => (kind === "team" ? redactChatText(v, allow) : typeof v === "string" ? v : "");
  const out: JointAgentThreadView = {
    id: thread.id,
    title: thread.title ? text(thread.title) : null,
    createdBy: thread.createdBy,
    isAiChat: kind === "own_ai",
    hasAiMember: false,
    createdAt: thread.createdAt, updatedAt: thread.updatedAt,
    creatorName: input.creatorName,
    members: input.members.map(m => ({ id: String(m.id), name: String(m.name || "Unknown"), seen: !!m.seen })),
    propertyId: null, propertyName: null, linkedType: null, linkedId: null, linkedName: null, groupPicUrl: null, projectId: null,
    kind,
  };
  if (input.last !== undefined) {
    out.lastMessage = input.last
      ? { content: kind === "team" ? previewFor(input.last.content, allow) : previewFor(input.last.content, { memberIds: new Set(), unitIds: new Set(), dealIds: new Set() }), senderName: input.last.senderName, createdAt: input.last.createdAt }
      : null;
  }
  if (input.messages) {
    out.messages = input.messages.map((m: any) => {
      const attachments = Array.isArray(m.attachments) ? m.attachments.map(attachmentForJointAgent).filter((a: string | null): a is string => !!a) : [];
      return {
        id: m.id, threadId: m.threadId, role: m.role === "assistant" ? "assistant" : "user", userId: m.userId || null, createdAt: m.createdAt,
        content: text(m.content), actionData: null, attachments: attachments.length ? attachments : null,
      };
    });
  }
  return out;
}

// What a joint agent may post (and what an edit of its message may become).
// A tag may name a person in the conversation, a unit at its schemes or a
// live deal there. An attachment is a file it uploaded itself.
export async function postDenialForJointAgent(ja: ChatJointAgent, memberIds: Iterable<string>, body: { content?: unknown; attachments?: unknown }): Promise<{ error: string | null; attachments: string[] | null }> {
  const refuse = (error: string) => ({ error, attachments: null });
  const content = body.content;
  if (typeof content !== "string" || !content.trim()) return refuse("Message content is required");
  if (content.length > JOINT_AGENT_MESSAGE_MAX) return refuse("That message is too long");
  if (hasBrokenTag(content)) return refuse("That tag cannot be used here");
  const ids = tagIdsIn(content);
  if (ids.other.length) return refuse("You can tag people in this conversation, and units and deals at your schemes");
  const members = new Set([...memberIds].filter(Boolean));
  if (ids.users.some(id => !members.has(id))) return refuse("You can only tag people who are in this conversation");
  const allow = await allowSetsFor(ja, [content], members);
  if (ids.units.some(id => !allow.unitIds.has(id)) || ids.deals.some(id => !allow.dealIds.has(id))) return refuse("You can only tag units and live deals at your schemes");
  let attachments: string[] | null = null;
  if (body.attachments !== undefined && body.attachments !== null) {
    if (!Array.isArray(body.attachments) || body.attachments.length > 30) return refuse("Those attachments cannot be sent");
    attachments = [];
    for (const raw of body.attachments) {
      const clean = attachmentForJointAgent(raw);
      if (!clean) return refuse("Only files you uploaded here can be attached");
      const name = (JSON.parse(clean).url as string).match(CHAT_MEDIA_URL)![1];
      const own = await pool.query(`SELECT 1 FROM user_upload_history WHERE user_id = $1 AND storage_key = 'chat-media/' || $2 LIMIT 1`, [ja.userId, name]);
      if (!own.rows.length) return refuse("Only files you uploaded here can be attached");
      attachments.push(clean);
    }
    if (!attachments.length) attachments = null;
  }
  return { error: null, attachments };
}

// The line a notification or a push carries, per recipient. A joint agent is
// sent the redacted line and a link to its own chat page. When the read that
// says who is a joint agent fails, nobody is sent the words.
export async function notificationLinesFor(input: { threadId: string; content: unknown; recipientIds: string[]; memberIds: string[]; plain: string }): Promise<Map<string, { preview: string; url: string }>> {
  const out = new Map<string, { preview: string; url: string }>();
  const staffUrl = `/chatbgp?thread=${input.threadId}`;
  let agents: Map<string, ChatJointAgent>;
  try {
    agents = await jointAgentsAmong(input.recipientIds);
  } catch (e: any) {
    console.warn("[chat] joint agent check failed, notification sent without its words:", e?.message);
    for (const id of input.recipientIds) out.set(id, { preview: "New message", url: staffUrl });
    return out;
  }
  for (const id of input.recipientIds) {
    const ja = agents.get(id);
    if (!ja) { out.set(id, { preview: input.plain, url: staffUrl }); continue; }
    let preview = "New message";
    try { preview = previewFor(input.content, await allowSetsFor(ja, [input.content], input.memberIds)) || "New message"; } catch {}
    out.set(id, { preview, url: `/landsec/chat?thread=${input.threadId}` });
  }
  return out;
}

export { jointAgentThreadKind };

export function setupJointAgentChatRoutes(app: Express) {
  // The people a joint agent may start a conversation with. Names only.
  app.get("/api/landsec/chat/people", requireAuth, async (req, res) => {
    let ja: ChatJointAgent | null;
    try { ja = await jointAgentOfRequest(req); }
    catch { return res.status(503).json({ message: "Your account could not be verified. Try again in a moment." }); }
    if (!ja) return res.status(403).json({ message: "Not available" });
    try {
      res.json({ people: await chatPeopleFor(ja, ja.userId) });
    } catch (e: any) {
      console.error("[chat] people list failed:", e?.message);
      res.status(500).json({ message: "The people list could not be loaded" });
    }
  });
}

// Which of its two kinds of conversation this thread is for the joint agent
// asking, or null (not one it may hold, or not found). Throws on a failed read.
export async function jointAgentThreadKindById(userId: string, threadId: unknown): Promise<"team" | "own_ai" | null> {
  if (typeof threadId !== "string" || !threadId) return null;
  const t = (await pool.query(
    `SELECT created_by, is_ai_chat, has_ai_member, property_id, linked_type, linked_id FROM chat_threads WHERE id = $1`, [threadId])).rows[0];
  if (!t) return null;
  const members = (await pool.query(`SELECT user_id FROM chat_thread_members WHERE thread_id = $1`, [threadId])).rows.map((r: any) => r.user_id);
  return jointAgentThreadKind(
    { createdBy: t.created_by, isAiChat: t.is_ai_chat, hasAiMember: t.has_ai_member, propertyId: t.property_id, linkedType: t.linked_type, linkedId: t.linked_id },
    members, userId);
}
