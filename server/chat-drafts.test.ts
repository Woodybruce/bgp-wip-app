import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import AdmZip from "adm-zip";
import { CHAT_DRAFT_BODY_LIMIT, CHAT_DRAFT_PROPERTY, ChatDraftError, chatOutlookSchema, chatWordSchema,
  createChatDraftRouter, createOutlookDraft, type ChatDraftStore, type DraftRecord } from "./chat-drafts";
import { createChatDraftWord } from "./chat-drafts-word";
import { delegatedAccountBelongsToUser } from "./microsoft-delegated-account";

const staffId = "314d4acb-1170-4ffa-9621-7a72025b2ed1";
const threadId = "9575e07d-b46a-4d3f-8777-dea0aa461105";
const input = () => ({ subject: "Draft for review", bodyMarkdown: "Hello **team**.\n\n| Item | Rent |\n| --- | --- |\n| Retail | £50,000 |", idempotencyKey: randomUUID() });
const message = { id: "draft-1", isDraft: true, webLink: "https://outlook.office.com/mail/deeplink/compose/draft-1" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function memoryStore() {
  const records = new Map<string, DraftRecord>();
  const store: ChatDraftStore = {
    async reserve(user, key, hash) {
      const ownerKey = `${user}:${key}`;
      const existing = records.get(ownerKey);
      if (existing) {
        if (existing.request_hash === hash && existing.state === "rejected" && existing.error_code === "MICROSOFT_DRAFT_PERMISSION_REQUIRED") {
          Object.assign(existing, { state: "pending", error_code: null });
          return { created: true, record: { ...existing } };
        }
        return { created: false, record: { ...existing } };
      }
      const record: DraftRecord = { request_hash: hash, state: "pending", draft_id: null, error_code: null };
      records.set(ownerKey, record);
      return { created: true, record: { ...record } };
    },
    async complete(user, key, id) { Object.assign(records.get(`${user}:${key}`)!, { state: "complete", draft_id: id }); },
    async reject(user, key, code) { Object.assign(records.get(`${user}:${key}`)!, { state: "rejected", error_code: code }); },
  };
  return { store, records };
}
function graphMock(handler: (url: string, init: RequestInit) => Promise<Response> | Response = (_url, init) => reply(message, init.method === "POST" ? 201 : 200)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchGraph = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    assert.match(String(url), /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/messages(?:[/?]|$)/);
    assert.doesNotMatch(String(url), /sendMail|\/send|createReply|\/users\//);
    return handler(String(url), init);
  }) as typeof fetch;
  return { calls, fetchGraph };
}
const code = (expected: string) => (error: unknown) => error instanceof ChatDraftError && error.code === expected;

describe("delegated mailbox identity", () => {
  const user = { email: "person@brucegillinghampollard.com", role: "Agent", is_active: true };
  it("accepts the current active staff account, case-insensitively", () => {
    assert.equal(delegatedAccountBelongsToUser(user, { username: "Person@BruceGillinghamPollard.com" }), true);
  });
  it("rejects an org fallback cache even when stored under the current user ID", () => {
    assert.equal(delegatedAccountBelongsToUser(user, { username: "another.person@brucegillinghampollard.com" }), false);
    assert.equal(delegatedAccountBelongsToUser(user, {}), false);
    assert.equal(delegatedAccountBelongsToUser(null, { username: user.email }), false);
  });
  it("rejects inactive or client principals even with a matching Microsoft account", () => {
    assert.equal(delegatedAccountBelongsToUser({ ...user, is_active: false }, { username: user.email }), false);
    assert.equal(delegatedAccountBelongsToUser({ ...user, role: "Client" }, { username: user.email }), false);
    assert.equal(delegatedAccountBelongsToUser({ ...user, email: "client@example.com" }, { username: "client@example.com" }), false);
  });
});

describe("Outlook drafts are self-only, verified and retry-safe", () => {
  it("creates recipient-free HTML in /me/messages, then verifies isDraft", async () => {
    const { store } = memoryStore(), graph = graphMock(), tokenUsers: string[] = [];
    const result = await createOutlookDraft(staffId, input(), { store, ...graph, getToken: async user => { tokenUsers.push(user); return "fake-delegated-token"; } });
    assert.deepEqual(result, { id: message.id, webLink: message.webLink });
    assert.deepEqual(tokenUsers, [staffId]);
    assert.equal(graph.calls.length, 2);
    const post = JSON.parse(String(graph.calls[0].init.body));
    assert.equal(graph.calls[0].init.method, "POST");
    assert.deepEqual(post.toRecipients, []);
    assert.deepEqual(post.ccRecipients, []);
    assert.deepEqual(post.bccRecipients, []);
    assert.equal(post.body.contentType, "HTML");
    assert.match(post.body.content, /<table[ >]/);
    assert.match(post.body.content, /<strong>team<\/strong>/);
    assert.equal(post.singleValueExtendedProperties[0].id, CHAT_DRAFT_PROPERTY);
    assert.match(graph.calls[1].url, /\$select=id,isDraft,webLink$/);
  });
  it("requires the user's delegated connection before reserving or creating", async () => {
    const { store, records } = memoryStore(), graph = graphMock();
    await assert.rejects(createOutlookDraft(staffId, input(), { store, ...graph, getToken: async () => null }), code("MICROSOFT_DRAFT_PERMISSION_REQUIRED"));
    assert.equal(graph.calls.length, 0);
    assert.equal(records.size, 0);
  });
  it("retries a successful key by reading the original draft, never creating another", async () => {
    const { store } = memoryStore(), graph = graphMock(), payload = input();
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    await createOutlookDraft(staffId, payload, deps);
    await createOutlookDraft(staffId, payload, deps);
    assert.equal(graph.calls.filter(call => call.init.method === "POST").length, 1);
    assert.equal(graph.calls.length, 3);
  });
  it("rejects a changed payload using an old key", async () => {
    const { store } = memoryStore(), graph = graphMock(), payload = input();
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    await createOutlookDraft(staffId, payload, deps);
    await assert.rejects(createOutlookDraft(staffId, { ...payload, bodyMarkdown: "Changed" }, deps), code("IDEMPOTENCY_CONFLICT"));
    assert.equal(graph.calls.length, 2);
  });
  it("namespaces request keys by user", async () => {
    const { store } = memoryStore(), graph = graphMock(), payload = input();
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    await createOutlookDraft(staffId, payload, deps);
    await createOutlookDraft("other-staff", payload, deps);
    const posts = graph.calls.filter(call => call.init.method === "POST").map(call => JSON.parse(String(call.init.body)));
    assert.equal(posts.length, 2);
    assert.notEqual(posts[0].singleValueExtendedProperties[0].value, posts[1].singleValueExtendedProperties[0].value);
  });
  it("lost creation response reconciles the original Graph marker without a second POST", async () => {
    const { store } = memoryStore(), payload = input();
    const graph = graphMock((_url, init) => { if (init.method === "POST") throw new Error("network failed with sensitive details"); return reply({ value: [message] }); });
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    await assert.rejects(createOutlookDraft(staffId, payload, deps), code("DRAFT_OUTCOME_UNCERTAIN"));
    assert.deepEqual(await createOutlookDraft(staffId, payload, deps), { id: message.id, webLink: message.webLink });
    assert.equal(graph.calls.filter(call => call.init.method === "POST").length, 1);
    assert.match(new URL(graph.calls[1].url).searchParams.get("$filter")!, /singleValueExtendedProperties\/Any/);
  });
  it("an unresolved attempt stays uncertain on every retry", async () => {
    const { store } = memoryStore(), payload = input();
    const graph = graphMock((_url, init) => init.method === "POST" ? reply({}, 503) : reply({ value: [] }));
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    for (let i = 0; i < 3; i++) await assert.rejects(createOutlookDraft(staffId, payload, deps), code("DRAFT_OUTCOME_UNCERTAIN"));
    assert.equal(graph.calls.filter(call => call.init.method === "POST").length, 1);
  });
  it("concurrent calls reserve one creation attempt", async () => {
    const { store } = memoryStore(), payload = input();
    const graph = graphMock((url, init) => init.method === "POST" ? reply(message, 201) : url.includes("$filter") || url.includes("%24filter") ? reply({ value: [] }) : reply(message));
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    await Promise.allSettled([createOutlookDraft(staffId, payload, deps), createOutlookDraft(staffId, payload, deps)]);
    assert.equal(graph.calls.filter(call => call.init.method === "POST").length, 1);
  });
  it("confirmed permission rejection can retry the same key after consent", async () => {
    const { store } = memoryStore(), payload = input();
    let requests = 0, tokens = 0;
    const graph = graphMock((_url, init) => ++requests === 1 ? reply({ secret: "sensitive provider body" }, 403) : reply(message, init.method === "POST" ? 201 : 200));
    const deps = { store, ...graph, getToken: async () => `fake-token-${++tokens}` };
    await assert.rejects(createOutlookDraft(staffId, payload, deps), code("MICROSOFT_DRAFT_PERMISSION_REQUIRED"));
    assert.deepEqual(await createOutlookDraft(staffId, payload, deps), { id: message.id, webLink: message.webLink });
    assert.equal(tokens, 2);
    assert.equal(graph.calls.filter(call => call.init.method === "POST").length, 2);
  });
  it("an uncertain consent retry cannot become a third POST", async () => {
    const { store } = memoryStore(), payload = input();
    let posts = 0;
    const graph = graphMock((_url, init) => init.method === "POST" ? reply({}, ++posts === 1 ? 403 : 503) : reply({ value: [] }));
    const deps = { store, ...graph, getToken: async () => "fake-token" };
    await assert.rejects(createOutlookDraft(staffId, payload, deps), code("MICROSOFT_DRAFT_PERMISSION_REQUIRED"));
    for (let i = 0; i < 2; i++) await assert.rejects(createOutlookDraft(staffId, payload, deps), code("DRAFT_OUTCOME_UNCERTAIN"));
    assert.equal(posts, 2);
  });
  it("never returns a sent message as a draft", async () => {
    const { store } = memoryStore(), graph = graphMock((_url, init) => reply({ ...message, isDraft: init.method === "POST" }));
    await assert.rejects(createOutlookDraft(staffId, input(), { store, ...graph, getToken: async () => "fake-token" }), code("DRAFT_NO_LONGER_AVAILABLE"));
  });
  it("does not expose untrusted non-Outlook URLs returned by a provider", async () => {
    const { store } = memoryStore(), graph = graphMock(() => reply({ ...message, webLink: "https://evil.example/steal" }));
    await assert.rejects(createOutlookDraft(staffId, input(), { store, ...graph, getToken: async () => "fake-token" }), code("DRAFT_OUTCOME_UNCERTAIN"));
  });
  it("redacts credential-bearing and app-private URLs from the exported subject", async () => {
    const { store } = memoryStore(), graph = graphMock();
    await createOutlookDraft(staffId, { ...input(), subject: "Review https://example.com/?token=private-secret" }, { store, ...graph, getToken: async () => "fake-token" });
    const post = JSON.parse(String(graph.calls[0].init.body));
    assert.doesNotMatch(post.subject, /private-secret/);
    assert.match(post.subject, /Private link omitted/);
  });
});

describe("native Word export", () => {
  it("produces actual OOXML with a structured table, headings, lists and styled runs", async () => {
    const buffer = await createChatDraftWord("Terms – café", "## Proposed terms\n\n**Bold** and *italic* &amp; text.\n\n| Item | Rent |\n| --- | ---: |\n| Café | £50,000 |\n\n3. First\n4. Second\n\n- [x] Reviewed\n- Outstanding");
    assert.equal(buffer.subarray(0, 2).toString(), "PK");
    const zip = new AdmZip(buffer), xml = zip.readAsText("word/document.xml");
    assert.ok(zip.getEntry("[Content_Types].xml"));
    assert.match(xml, /<w:tbl>/);
    assert.match(xml, /<w:tblHeader/);
    assert.equal((xml.match(/<w:tc>/g) ?? []).length, 4);
    assert.match(xml, /£50,000/);
    assert.doesNotMatch(xml, /&amp;amp;/);
    assert.match(xml, /<w:b\/>/);
    assert.match(xml, /<w:i\/>/);
    assert.match(xml, /Heading2/);
    assert.match(xml, /<w:numPr>/);
    assert.match(zip.readAsText("word/numbering.xml"), /w:start w:val="3"/);
  });
  it("raw HTML remains text and remote images cannot become fetched media", async () => {
    const buffer = await createChatDraftWord("Safe", "<script>alert('x')</script>\n\n![Image label](https://example.com/tracker.png)\n\n@[Alice](tag:user/abc)");
    const zip = new AdmZip(buffer), xml = zip.readAsText("word/document.xml");
    assert.match(xml, /&lt;script&gt;/);
    assert.doesNotMatch(xml, /<script>|tracker\.png|tag:user/);
    assert.match(xml, /Image label/);
    assert.match(xml, /Alice/);
    assert.equal(zip.getEntries().some(entry => entry.entryName.startsWith("word/media/")), false);
  });
  it("Word text, code and metadata omit private and credential-bearing URLs", async () => {
    const buffer = await createChatDraftWord("Review https://example.com/?token=secret-value",
      "A private /api/chat-media/hidden-file\n\n`https://example.com/?token=secret-value`\n\n[Download](/api/chat-media/hidden-file)\n\n```\nhttps://example.com/?token=secret-value\n```");
    const zip = new AdmZip(buffer);
    for (const name of ["word/document.xml", "docProps/core.xml"]) {
      const xml = zip.readAsText(name);
      assert.doesNotMatch(xml, /secret-value|hidden-file/);
    }
    assert.match(zip.readAsText("word/document.xml"), /Private link omitted/);
  });
});

describe("input boundaries", () => {
  it("rejects mailbox/recipient/HTML overrides and invalid subjects, keys or sizes", () => {
    const valid = input();
    assert.equal(chatOutlookSchema.safeParse(valid).success, true);
    for (const extra of [{ mailbox: "another@example.com" }, { toRecipients: ["guess@example.com"] }, { html: "<b>unsafe</b>" }]) {
      assert.equal(chatOutlookSchema.safeParse({ ...valid, ...extra }).success, false);
    }
    assert.equal(chatOutlookSchema.safeParse({ ...valid, subject: "Injected\r\nHeader: x" }).success, false);
    assert.equal(chatOutlookSchema.safeParse({ ...valid, idempotencyKey: "invalid" }).success, false);
    assert.equal(chatWordSchema.safeParse({ subject: "Title", bodyMarkdown: "x".repeat(CHAT_DRAFT_BODY_LIMIT + 1) }).success, false);
  });
});

describe("authenticated export HTTP boundaries", () => {
  let server: ReturnType<express.Express["listen"]>, origin = "";
  const graph = graphMock();
  const users: Record<string, any> = {
    staff: { email: "person@brucegillinghampollard.com", role: "Agent", is_active: true },
    client: { email: "client@example.com", role: "Client", is_active: true },
    inactive: { email: "inactive@brucegillinghampollard.com", role: "Agent", is_active: false },
  };
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).session = { userId: req.get("x-test-user") }; next(); });
    app.use("/api/chat-drafts", createChatDraftRouter({
      requireAuth: (_req, _res, next) => next(),
      db: { async query(sql, values) {
        if (sql.includes("FROM users")) return { rows: users[values![0]] ? [users[values![0]]] : [] };
        if (sql.includes("FROM chat_threads")) return { rows: values![0] === threadId ? [{ id: threadId }] : [] };
        throw new Error("Unexpected database query");
      } },
      store: memoryStore().store, getToken: async () => "fake-token", ...graph,
    }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.on("listening", resolve); server.on("error", reject); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => { if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const post = (route: string, body: unknown, user = "staff", headers: Record<string, string> = {}) => fetch(`${origin}/api/chat-drafts/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-test-user": user, ...headers }, body: JSON.stringify(body),
  });
  it("denies unauthenticated, client and deactivated users before Graph", async () => {
    const before = graph.calls.length;
    for (const [user, status] of [["", 401], ["missing", 401], ["client", 403], ["inactive", 403]] as const) {
      assert.equal((await post("outlook", input(), user)).status, status);
    }
    assert.equal(graph.calls.length, before);
  });
  it("rejects foreign threads and cross-origin cookie requests before Graph", async () => {
    const before = graph.calls.length;
    assert.equal((await post("outlook", { ...input(), threadId: randomUUID() })).status, 404);
    assert.equal((await post("outlook", input(), "staff", { Origin: "https://evil.example" })).status, 403);
    assert.equal((await post("outlook", input(), "staff", { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal(graph.calls.length, before);
  });
  it("allows an authorized thread and returns only the verified draft link", async () => {
    const response = await post("outlook", { ...input(), threadId });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: message.id, webLink: message.webLink });
    assert.match(response.headers.get("cache-control")!, /no-store/);
  });
  it("downloads a true DOCX without any Graph call", async () => {
    const before = graph.calls.length;
    const response = await post("word", { subject: "Draft – café", bodyMarkdown: "| A | B |\n| --- | --- |\n| One | Two |" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
    assert.match(response.headers.get("content-disposition")!, /\.docx/);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString(), "PK");
    assert.equal(graph.calls.length, before);
  });
});
