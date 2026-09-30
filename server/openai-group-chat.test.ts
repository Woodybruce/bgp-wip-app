import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { convertMessagesForOpenAI } from "./utils/openai-client";

// Execute the real route's loop with fake transport/handlers, without importing
// routes.ts (which starts databases and unrelated integrations at import time).
const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const start = source.indexOf("    while (currentMessage?.tool_calls");
const end = source.indexOf("\n    if (io)", start);
assert.ok(start > 0 && end > start, "group loop source markers must exist");
const loop = source.slice(start, end);
const harness = ts.transpileModule(`
  return async function run(deps: any) {
    const completionOptions = { messages: [{role: "user", content: "Please help"}] };
    const groupTools = deps.allowed.map((name: string) => ({function:{name}}));
    const chatbgp = {handleCrmToolCall: deps.handle};
    const callClaude = deps.respond;
    const req = deps.req || {};
    const withTimeout = async (promise: any) => promise;
    const console = {error() {}};
    let currentMessage = deps.message;
    let claudeResponse: any;
    let loopCount = 0;
    const maxLoops = 6;
    let lastAction: any = null;
    let lastHandledReply: string | null = null;
    ${loop}
    return {messages: completionOptions.messages, currentMessage, loopCount, lastAction, lastHandledReply};
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const runGroupLoop = new Function(harness)() as (deps: any) => Promise<any>;

const call = (id: string, name: string, args = "{}") => ({ id, type: "function", function: { name, arguments: args } });
const message = (calls: any[]) => ({ role: "assistant", content: "Checking the records.", tool_calls: calls,
  _openaiOutput: [
    { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "test-encrypted-state" },
    { type: "tool_search_output", execution: "server", call_id: null, status: "completed", tools: [] },
    ...calls.map(c => ({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments })),
  ] });
const final = { choices: [{ message: { role: "assistant", content: "Finished" } }] };

test("group chat preserves raw provider output once and returns one result for every requested call", async () => {
  const assistant = message([call("a", "search_crm"), call("b", "web_search")]);
  const invoked: string[] = [];
  let requests = 0;
  const req = { userId: "staff-test" };
  const result = await runGroupLoop({ message: assistant, allowed: ["search_crm", "web_search"], req,
    handle: async (name: string, _args: any, actualReq: any) => {
      assert.equal(actualReq, req);
      invoked.push(name);
      return { handled: true, response: { reply: `${name} completed`, action: { type: name } } };
    },
    respond: async (options: any) => {
      requests++;
      assert.equal(options.messages[1], assistant);
      assert.equal(options.messages.filter((m: any) => m.role === "assistant").length, 1);
      assert.deepEqual(options.messages.filter((m: any) => m.role === "tool").map((m: any) => m.tool_call_id), ["a", "b"]);
      const converted = convertMessagesForOpenAI(options.messages);
      assert.equal(converted.input.filter(i => i.type === "reasoning").length, 1);
      assert.equal(converted.input.filter(i => i.type === "tool_search_output").length, 1);
      assert.equal(converted.input.filter(i => i.type === "function_call").length, 2);
      return final;
    },
  });
  assert.deepEqual(invoked, ["search_crm", "web_search"]);
  assert.equal(requests, 1);
  assert.equal(result.lastHandledReply, "web_search completed");
  assert.equal(result.currentMessage.content, "Finished");
});

test("malformed, denied, throwing, unhandled and valid tools each get one result without skipping later calls", async () => {
  const assistant = message([
    call("invalid", "search_crm", "{"), call("denied", "send_email"),
    call("throws", "create_task"), call("unknown", "web_search"), call("valid", "search_crm"),
  ]);
  const invoked: string[] = [];
  const result = await runGroupLoop({ message: assistant, allowed: ["search_crm", "create_task", "web_search"],
    handle: async (name: string) => {
      invoked.push(name);
      if (name === "create_task") throw new Error("Test failure");
      if (name === "web_search") return { handled: false };
      return { handled: true, response: { reply: "Found records" } };
    }, respond: async () => final,
  });
  assert.deepEqual(invoked, ["create_task", "web_search", "search_crm"]);
  const outputs = result.messages.filter((m: any) => m.role === "tool");
  assert.deepEqual(outputs.map((m: any) => m.tool_call_id), ["invalid", "denied", "throws", "unknown", "valid"]);
  assert.deepEqual(outputs.map((m: any) => JSON.parse(m.content)), [
    { error: "Invalid JSON object in tool arguments" },
    { error: "This tool is not available in this group conversation" },
    { error: "Test failure" }, { error: "Tool not handled" }, { result: "Found records", action: null },
  ]);
});

test("a missing client scope exposing no tools cannot execute even a hallucinated tool call", async () => {
  let invoked = false;
  const result = await runGroupLoop({ message: message([call("a", "search_crm")]), allowed: [],
    handle: async () => { invoked = true; }, respond: async () => final });
  assert.equal(invoked, false);
  assert.match(result.messages.find((m: any) => m.role === "tool").content, /not available/);
});

test("failed follow-up response does not append duplicate results or re-execute mutations", async () => {
  let invoked = 0;
  let captured: any;
  await assert.rejects(runGroupLoop({ message: message([call("a", "create_task")]), allowed: ["create_task"],
    handle: async () => { invoked++; return { handled: true, response: { reply: "Created" } }; },
    respond: async (options: any) => { captured = options; throw new Error("provider down"); },
  }), /provider down/);
  assert.equal(invoked, 1);
  assert.equal(captured.messages.filter((m: any) => m.role === "tool").length, 1);
});

test("duplicate tool IDs fail before any mutation", async () => {
  let invoked = false;
  await assert.rejects(runGroupLoop({ message: message([call("a", "create_task"), call("a", "create_task")]), allowed: ["create_task"],
    handle: async () => { invoked = true; }, respond: async () => final }), /duplicate group tool call IDs/);
  assert.equal(invoked, false);
});
