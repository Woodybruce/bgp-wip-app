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
    const completionOptions = { messages: [{role: "user", content: "Please help"}], landlordEvidence: deps.landlord || false };
    const groupTools = deps.allowed.map((name: string) => ({function:{name}}));
    const chatbgp = {handleCrmToolCall: deps.handle, executeCrmToolRaw: deps.raw};
    const landlordEvidence = deps.landlord ? {company:{id:'aew'}} : null;
    const searchLandlordMeetings = deps.calendarSearch;
    const callGroupModel = () => deps.respond(completionOptions);
    const groupDeadline = deps.deadline ?? Date.now() + 60000;
    const req = deps.req || {};
    const console = {error() {}};
    let currentMessage = deps.message;
    let claudeResponse: any;
    let loopCount = 0;
    const maxLoops = 6;
    let lastAction: any = null;
    let lastHandledReply: string | null = null;
    const landlordToolOutcomes: any[] = [];
    ${loop}
    return {messages: completionOptions.messages, currentMessage, loopCount, lastAction, lastHandledReply, landlordToolOutcomes};
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

test("landlord group prompts exclude the sender's generic mailbox and diary context while ordinary groups are unchanged", () => {
  const promptStart = source.indexOf("    const groupSystemPrompt =");
  const promptEnd = source.indexOf("\n\n    // Use the same", promptStart);
  assert.ok(promptStart > 0 && promptEnd > promptStart);
  const promptSource = ts.transpileModule(`
    return function prompt(landlordEvidence) {
      const systemPrompt='system',learnings='',calendarContext='PRIVATE_SENDER_CONTEXT',taggedContext='',landlordContext='SCOPED_LANDLORD_EVIDENCE';
      const senderName='Woody Bruce',mentionsChatBGP=true;
      ${source.slice(promptStart,promptEnd)}
      return groupSystemPrompt;
    };`, { compilerOptions: { target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None } }).outputText;
  const prompt = new Function(promptSource)();
  assert.doesNotMatch(prompt({company:{id:'aew'}}), /PRIVATE_SENDER_CONTEXT/);
  assert.match(prompt({company:{id:'aew'}}), /SCOPED_LANDLORD_EVIDENCE/);
  assert.match(prompt(null), /PRIVATE_SENDER_CONTEXT/);
});

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

test("landlord chat passes actual save receipts and failures to the model without a paraphrased success claim", async () => {
  const invoked: string[] = [];
  const result = await runGroupLoop({ landlord: true,
    message: message([call("search", "search_calendar"), call("write", "update_deal")]),
    allowed: ["search_calendar", "update_deal"],
    handle: async () => { throw new Error("Landlord receipts must not use the prose summary helper"); },
    calendarSearch: async () => ({ events: [{ subject:"AEW / BGP", start:"2026-10-28T10:00:00Z" }] }),
    raw: async (name: string) => {
      invoked.push(name);
      return { data: { success: false, error: "Write rejected", id: "3629" } };
    }, respond: async () => final });
  assert.deepEqual(invoked, ["update_deal"]);
  const results = result.messages.filter((m: any) => m.role === "tool").map((m: any) => JSON.parse(m.content));
  assert.equal(results[0].events[0].subject, "AEW / BGP");
  assert.equal(results[1].success, false);
  assert.equal(results[1].error, "Write rejected");
  assert.equal(result.lastAction, null);
  assert.equal(result.landlordToolOutcomes[0].tool, "update_deal");
});

test("landlord calendar tools use only the scoped safe reader and cannot override the linked company or authenticated request", async () => {
  const reads:any[]=[];
  const req={tokenUserId:'woody'};
  const result=await runGroupLoop({landlord:true,req,
    message:message([call('search','search_calendar',JSON.stringify({query:'Ben Sykes',mailbox:'all',companyId:'other',req:{tokenUserId:'forged'}})),call('list','query_calendar',JSON.stringify({daysAhead:7,teamMember:'Nick'}))]),
    allowed:['search_calendar','query_calendar'],
    raw:async()=>{throw Error('Must not use legacy calendar reader');},handle:async()=>{throw Error('Must not use legacy calendar reader');},
    calendarSearch:async(options:any)=>{reads.push(options);return{events:[],coverage:{status:'partial',issues:['One diary unavailable']}};},respond:async()=>final});
  assert.equal(reads.length,2);
  for(const read of reads){assert.equal(read.companyId,'aew');assert.equal(read.req,req);}
  assert.equal(reads[0].query,'Ben Sykes');assert.equal(reads[1].teamMember,'Nick');
  assert.deepEqual(result.landlordToolOutcomes,[]);
  assert.ok(result.messages.filter((m:any)=>m.role==='tool').every((m:any)=>JSON.parse(m.content).coverage.status==='partial'));
});
