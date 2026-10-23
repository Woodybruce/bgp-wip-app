import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createChatDraftEditRouter, EMAIL_DRAFT_EDIT_NOTE } from "./chat-draft-edits";
import { extractChatEmailDraft } from "../shared/chat-email-draft";

const userId = "314d4acb-1170-4ffa-9621-7a72025b2ed1";
const threadId = "9575e07d-b46a-4d3f-8777-dea0aa461105";
const messageId = "4d58c560-ee06-4ec5-9962-47edfb7a1091";
const originalContent = "Here is the draft you requested.\n\nSubject: Leisure proposal\n\nHi Pete,\n\nPlease review the proposed terms below.\n\nKind regards,\nWoody";
const requestBody = () => ({ threadId, messageId, expectedContent: originalContent,
  subject: "Revised leisure proposal", bodyMarkdown: "Hi Pete,\n\n| Use | Courts |\n| --- | --- |\n| Padel | 24 |\n\nKind regards,\nWoody" });

function fixture() {
  const state = {
    authenticated: true,
    staff: { email: "person@brucegillinghampollard.com", role: "Agent", is_active: true } as any,
    access: "owner" as "owner" | "member" | "none",
    message: { id: messageId, threadId, role: "assistant", content: originalContent, userId: null,
      actionData: '{"type":"document","content":"Keep this action"}', attachments: ["Keep this attachment"], createdAt: "2026-10-23T10:00:00Z" } as any,
    beforeUpdate: () => {},
    updateCalls: 0,
    events: [] as unknown[][],
    emitFails: false,
    databaseFails: false,
  };
  const app = express();
  app.use(express.json({ limit: "750kb" }));
  app.use("/api/chat-drafts", createChatDraftEditRouter({
    requireAuth: (req, res, next) => {
      if (!state.authenticated) return void res.status(401).json({ error: "Not authenticated" });
      (req as any).session = { userId };
      next();
    },
    db: { async query(sql, values = []) {
      if (state.databaseFails) throw new Error("CANARY private database failure");
      if (sql.startsWith("SELECT email")) {
        assert.deepEqual(values, [userId]);
        return { rows: state.staff ? [state.staff] : [] };
      }
      assert.match(sql, /m\.id=\$1 AND m\.thread_id=\$2/);
      assert.match(sql, /t\.created_by=\$3 OR EXISTS/);
      assert.match(sql, /member\.thread_id=t\.id AND member\.user_id=\$3/);
      assert.equal(values[2], userId);
      if (sql.startsWith("SELECT")) return { rows: state.message && state.access !== "none" && values[0] === state.message.id && values[1] === state.message.threadId ? [{ ...state.message }] : [] };
      assert.match(sql, /^UPDATE chat_messages m SET content=\$5/);
      assert.match(sql, /m\.role='assistant' AND m\.content=\$4/);
      assert.match(sql, /u\.is_active IS DISTINCT FROM FALSE/);
      state.updateCalls++;
      state.beforeUpdate();
      if (!state.message || state.access === "none" || state.message.role !== "assistant" || state.message.content !== values[3]) return { rows: [] };
      state.message = { ...state.message, content: values[4] };
      return { rows: [{ ...state.message }] };
    } },
    emitMessageUpdated: (...args) => {
      if (state.emitFails) throw new Error("CANARY socket failure");
      state.events.push(args);
    },
  }));
  return { state, app };
}

async function withFixture(run: (state: ReturnType<typeof fixture>["state"], post: (body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const { state, app } = fixture();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(state, async (body = requestBody(), headers = {}) => {
      const response = await fetch(`${origin}/api/chat-drafts/edit`, { method: "POST",
        headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("owner and shared member can persist an email without changing action, attachment or author fields", async () => {
  for (const access of ["owner", "member"] as const) await withFixture(async (state, post) => {
    state.access = access;
    const before = { ...state.message };
    const response = await post();
    assert.equal(response.status, 200);
    assert.deepEqual({ ...response.body, content: before.content }, before);
    assert.match(response.body.content, /^Here is the draft you requested\./);
    assert.match(response.body.content, /\| Padel \| 24 \|/);
    assert.equal(response.body.content.split(EMAIL_DRAFT_EDIT_NOTE).length - 1, 1);
    assert.deepEqual(state.events, [[threadId, messageId, response.body.content]]);
  });
});

test("repeat edits use the latest content and retain one provenance note", async () => withFixture(async (state, post) => {
  const first = await post();
  const second = await post({ ...requestBody(), expectedContent: first.body.content, subject: "Final proposal" });
  assert.equal(second.status, 200);
  assert.equal(second.body.content.split(EMAIL_DRAFT_EDIT_NOTE).length - 1, 1);
  assert.match(second.body.content, /Subject: Final proposal/);
  assert.equal(state.events.length, 2);
}));

test("formatted, replaced and removed greetings remain editable after saving and reloading", async () => {
  for (const bodyMarkdown of ["**Hi Pete,**\n\nPlease review the corrected terms.", "*Hi Pete,*\n\nPlease review the corrected terms.",
    "Pete,\n\nPlease review the corrected terms.", "Please review the corrected terms.", "Thanks!"]) {
    await withFixture(async (state, post) => {
      const first = await post({ ...requestBody(), bodyMarkdown });
      assert.equal(first.status, 200);
      // The client recognises the same persisted content when the chat reloads.
      assert.equal(extractChatEmailDraft(state.message.content)?.bodyMarkdown, bodyMarkdown);
      const second = await post({ ...requestBody(), expectedContent: first.body.content, bodyMarkdown, subject: "Second revision" });
      assert.equal(second.status, 200);
      assert.equal(extractChatEmailDraft(second.body.content)?.subject, "Second revision");
      assert.equal(second.body.content.split(EMAIL_DRAFT_EDIT_NOTE).length - 1, 1);
    });
  }
});

test("a quoted edit note in the original commentary cannot substitute for save provenance", async () => withFixture(async (state, post) => {
  state.message.content = `\`\`\`text\n${EMAIL_DRAFT_EDIT_NOTE}\n\`\`\`\n\n${originalContent}`;
  const saved = await post({ ...requestBody(), expectedContent: state.message.content, bodyMarkdown: "Please review the corrected terms." });
  assert.equal(saved.status, 200);
  assert.equal(extractChatEmailDraft(saved.body.content)?.bodyMarkdown, "Please review the corrected terms.");
  assert.ok(saved.body.content.includes(`${EMAIL_DRAFT_EDIT_NOTE}\n\nSubject:`));
}));

test("authentication and active staff identity are required before message reads or updates", async () => {
  for (const override of [{ authenticated: false }, { staff: null }, { staff: { email: "client@example.com", role: "Client", is_active: true } },
    { staff: { email: "person@brucegillinghampollard.com", role: "Agent", is_active: false } }]) {
    await withFixture(async (state, post) => {
      Object.assign(state, override);
      assert.ok([401, 403].includes((await post()).status));
      assert.equal(state.updateCalls, 0);
      assert.equal(state.events.length, 0);
    });
  }
});

test("missing messages, foreign threads and removed members return the same fixed 404", async () => {
  for (const mode of ["missing", "foreign", "removed"]) await withFixture(async (state, post) => {
    if (mode === "missing") state.message = null;
    if (mode === "foreign") state.message.threadId = "28c01199-c015-45e0-897b-563b94a596a1";
    if (mode === "removed") state.access = "none";
    const result = await post();
    assert.deepEqual(result, { status: 404, body: { error: "Draft not found", code: "DRAFT_NOT_FOUND" } });
    assert.equal(state.updateCalls, 0);
  });
});

test("only an existing assistant email is editable", async () => {
  for (const mode of ["user", "tool", "non-email"]) await withFixture(async (state, post) => {
    if (mode === "non-email") state.message.content = "I have finished updating the CRM record.";
    else state.message.role = mode;
    const result = await post({ ...requestBody(), expectedContent: state.message.content });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "DRAFT_NOT_EDITABLE");
    assert.equal(state.updateCalls, 0);
  });
});

test("stale content is rejected without overwriting a colleague's revision", async () => withFixture(async (state, post) => {
  state.message.content += "\nColleague correction.";
  const result = await post();
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "DRAFT_CHANGED");
  assert.equal(state.updateCalls, 0);
  assert.match(state.message.content, /Colleague correction/);
}));

test("concurrent changes and access revocation are rechecked atomically at write time", async () => {
  for (const mode of ["change", "revoke"]) await withFixture(async (state, post) => {
    state.beforeUpdate = () => { if (mode === "change") state.message.content += "\nLatest version."; else state.access = "none"; };
    const result = await post();
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "DRAFT_CHANGED");
    assert.equal(state.updateCalls, 1);
    assert.equal(state.events.length, 0);
    assert.doesNotMatch(state.message.content, /Revised leisure proposal/);
  });
});

test("invalid, oversized and overposted payloads are rejected without writes", async () => {
  const invalid = [
    { threadId: "not-a-uuid" }, { messageId: "not-a-uuid" }, { expectedContent: "" },
    { expectedContent: "x".repeat(500_001) }, { subject: "x".repeat(201) }, { subject: "Two\nlines" },
    { bodyMarkdown: "x".repeat(120_001) }, { bodyMarkdown: "\u0000" }, { role: "user" }, { attachments: [] },
  ];
  for (const override of invalid) await withFixture(async (state, post) => {
    const response = await post({ ...requestBody(), ...override });
    assert.equal(response.status, 400);
    assert.equal(state.updateCalls, 0);
  });
});

test("cross-site session requests are rejected before looking up a draft", async () => withFixture(async (state, post) => {
  const result = await post(requestBody(), { Origin: "https://other.invalid", "Sec-Fetch-Site": "cross-site" });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "ORIGIN_REJECTED");
  assert.equal(state.updateCalls, 0);
}));

test("database failure returns a fixed error without private error details", async () => withFixture(async (state, post) => {
  state.databaseFails = true;
  const result = await post();
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "DRAFT_EDIT_FAILED");
  assert.doesNotMatch(JSON.stringify(result), /CANARY/);
  assert.equal(state.events.length, 0);
}));

test("a failed websocket notification does not misreport an already saved edit", async () => withFixture(async (state, post) => {
  state.emitFails = true;
  const result = await post();
  assert.equal(result.status, 200);
  assert.equal(result.body.content, state.message.content);
  assert.match(state.message.content, /Subject: Revised leisure proposal/);
}));
