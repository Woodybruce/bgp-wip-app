// Explicitly opt-in: starts a new disposable Unix-socket-only PostgreSQL cluster.
// Never reads DATABASE_URL, app configuration or existing database credentials.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { createChatDraftEditRouter } from "./chat-draft-edits";

test("draft edits execute real PostgreSQL aliases, access checks and concurrent compare-and-swap", { skip: process.env.RUN_DISPOSABLE_DRAFT_POSTGRES !== "1" }, async () => {
  const directory = await mkdtemp(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "bgp-draft-edits-test-"));
  const data = path.join(directory, "data"), socket = path.join(directory, "socket");
  const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: "pipe", timeout: 30_000 });
  let started = false, pool: pg.Pool | undefined, server: ReturnType<typeof express.application.listen> | undefined;
  try {
    await mkdir(socket, { mode: 0o700 });
    run("initdb", ["-D", data, "-A", "trust", "-U", "qa_draft", "--no-locale", "-E", "UTF8"]);
    run("pg_ctl", ["-D", data, "-l", path.join(directory, "postgres.log"), "-w", "-t", "20", "-o",
      `-k ${socket} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`, "start"]);
    started = true;
    pool = new pg.Pool({ host: socket, port: 5432, database: "postgres", user: "qa_draft", password: "", ssl: false, max: 4 });
    await pool.query(`CREATE TABLE users (id varchar PRIMARY KEY, email text, role text, is_active boolean);
      CREATE TABLE chat_threads (id varchar PRIMARY KEY, created_by varchar NOT NULL);
      CREATE TABLE chat_thread_members (thread_id varchar, user_id varchar);
      CREATE TABLE chat_messages (id varchar PRIMARY KEY, thread_id varchar NOT NULL, role text NOT NULL,
        content text NOT NULL, user_id varchar, action_data text, attachments text[], created_at timestamp DEFAULT now());
      INSERT INTO users VALUES ('owner','owner@brucegillinghampollard.com','Staff',true),
        ('member','member@brucegillinghampollard.com','Staff',true),
        ('outsider','outsider@brucegillinghampollard.com','Staff',true);`);
    const threadId = "9575e07d-b46a-4d3f-8777-dea0aa461105", messageId = "4d58c560-ee06-4ec5-9962-47edfb7a1091";
    const expectedContent = "Original commentary.\n\nSubject: Terms\n\nHi Pete,\n\nPlease review the proposed terms.\n\nThanks,\nWoody";
    await pool.query("INSERT INTO chat_threads VALUES ($1,'owner');", [threadId]);
    await pool.query("INSERT INTO chat_thread_members VALUES ($1,'member')", [threadId]);
    await pool.query("INSERT INTO chat_messages (id,thread_id,role,content,action_data,attachments) VALUES ($1,$2,'assistant',$3,$4,$5)",
      [messageId, threadId, expectedContent, '{"preserved":true}', ["keep-attachment"]]);
    const events: unknown[][] = [];
    let revokeBeforeUpdate = false;
    const app = express();
    app.use(express.json());
    app.use("/api/chat-drafts", createChatDraftEditRouter({
      requireAuth: (req, _res, next) => { (req as any).session = { userId: req.get("x-synthetic-user") || "owner" }; next(); },
      db: { query: async (sql, values) => {
        if (revokeBeforeUpdate && sql.startsWith("UPDATE chat_messages")) {
          revokeBeforeUpdate = false;
          await pool!.query("DELETE FROM chat_thread_members WHERE user_id='member'");
        }
        return pool!.query(sql, values);
      } },
      emitMessageUpdated: (...args) => { events.push(args); },
    }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat-drafts/edit`;
    const payload = { threadId, messageId, expectedContent, subject: "Revised terms", bodyMarkdown: "Hi Pete,\n\nThe corrected number is 24 courts.\n\nThanks,\nWoody" };
    const post = async (user = "owner", subject = "Revised terms") => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-synthetic-user": user }, body: JSON.stringify({ ...payload, subject }) });
      return { status: response.status, body: await response.json() };
    };
    const reset = async () => { await pool!.query("UPDATE chat_messages SET content=$1", [expectedContent]); events.length = 0; };
    const owner = await post();
    assert.equal(owner.status, 200);
    assert.equal(owner.body.threadId, threadId);
    assert.equal(owner.body.actionData, '{"preserved":true}');
    assert.deepEqual(owner.body.attachments, ["keep-attachment"]);
    assert.equal(owner.body.role, "assistant");
    assert.equal(owner.body.userId, null);
    await reset();
    assert.equal((await post("member")).status, 200);
    await reset();
    assert.equal((await post("outsider")).status, 404);
    assert.equal(events.length, 0);
    const simultaneous = await Promise.all([post("owner", "First revision"), post("member", "Second revision")]);
    assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 409]);
    assert.equal(events.length, 1);
    assert.equal((await pool.query("SELECT content FROM chat_messages WHERE id=$1", [messageId])).rows[0].content,
      simultaneous.find(result => result.status === 200)!.body.content);
    await reset();
    revokeBeforeUpdate = true;
    assert.equal((await post("member")).status, 409);
    assert.equal(events.length, 0);
    assert.equal((await pool.query("SELECT content FROM chat_messages WHERE id=$1", [messageId])).rows[0].content, expectedContent);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    await rm(directory, { recursive: true, force: true });
  }
});
