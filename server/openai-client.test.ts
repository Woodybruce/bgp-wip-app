import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAIRequest, convertMessagesForOpenAI, createOpenAIAdapter,
  normalizeOpenAIResponse, normalizeOpenAIUsage,
} from "./utils/openai-client";

const tool = (name = "find_deals") => ({ type: "function", function: {
  name, description: `Find ${name}`, parameters: { type: "object", properties: { query: { type: "string" } } },
} });
const opts = { messages: [{ role: "user", content: "Find deals" }], tools: [tool()] };
const textItem = { type: "message", id: "msg_1", role: "assistant", status: "completed",
  content: [{ type: "output_text", text: "Found deals", annotations: [] }] };
const call = (id = "call_1", name = "find_deals", args = '{"query":"Brent Cross"}') => ({
  type: "function_call", id: `fc_${id}`, call_id: id, name, arguments: args, status: "completed",
});
const response = (output: any[] = [textItem]) => ({ id: "resp_1", status: "completed", model: "gpt-6.1-sol", output,
  usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
    output_tokens_details: { reasoning_tokens: 25 } } });

test("Responses payload preserves optional arguments, uses stateless reasoning, and strips other providers' parameters", () => {
  const request = buildOpenAIRequest({ ...opts, max_completion_tokens: 3000, temperature: 0.3,
    thinking: true, betas: ["anthropic"], systemArray: [{ type: "text", text: "Act safely", cache_control: { type: "ephemeral" } }],
    messages: [{ role: "system", content: "Duplicate system" }, ...opts.messages] });
  assert.equal(request.model, "gpt-6.1-sol");
  assert.equal(request.max_output_tokens, 3000);
  assert.equal(request.store, false);
  assert.deepEqual(request.include, ["reasoning.encrypted_content"]);
  assert.equal(request.instructions, "Act safely");
  assert.equal(request.input.length, 1);
  assert.equal(request.tools[0].strict, false);
  assert.equal(request.tools[0].parameters.required, undefined);
  assert.equal(request.temperature, undefined);
  assert.equal(request.betas, undefined);
  assert.equal(request.thinking, undefined);
  assert.deepEqual(request.reasoning, { effort: "medium" });
  assert.equal(opts.tools[0].function.parameters.properties.query.type, "string");
});

test("explicit strict/schema/effort options are mapped without converting optional fields", () => {
  const request = buildOpenAIRequest({ ...opts, strict: true, reasoning_effort: "high",
    tool_choice: { type: "function", function: { name: "find_deals" } },
    response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: { type: "object" } } } });
  assert.equal(request.tools[0].strict, true);
  assert.equal(request.reasoning.effort, "high");
  assert.deepEqual(request.tool_choice, { type: "function", name: "find_deals" });
  assert.equal(request.text.format.name, "result");
  assert.equal(buildOpenAIRequest({ ...opts, thinking: false }).reasoning.effort, "low");
  assert.equal(buildOpenAIRequest({ ...opts, reasoning_effort: "none" }).reasoning.effort, "low");
  assert.equal(buildOpenAIRequest({ ...opts, effort: "high" }).reasoning.effort, "high");
  assert.equal(buildOpenAIRequest({ ...opts, max_output_tokens: 999 }).max_output_tokens, 999);
});

test("short extraction helpers budget reasoning without expanding Luna's visible-only cap", () => {
  for (const cap of [50, 150, 300]) {
    const luna = buildOpenAIRequest({ ...opts, model: "gpt-6-luna", max_completion_tokens: cap });
    assert.equal(luna.reasoning.effort, "none");
    assert.equal(luna.max_output_tokens, cap);
    const sol = buildOpenAIRequest({ ...opts, model: "gpt-6.1-sol", max_completion_tokens: cap });
    assert.equal(sol.reasoning.effort, "low");
    assert.equal(sol.max_output_tokens, 1024);
    assert.match(sol.instructions, new RegExp(`${cap} tokens`));
  }
  const mainChat = buildOpenAIRequest({ ...opts, thinking: true, max_completion_tokens: 16000 });
  assert.equal(mainChat.reasoning.effort, "medium");
  assert.equal(mainChat.max_output_tokens, 16000);
  const explicit = buildOpenAIRequest({ ...opts, model: "gpt-6-luna", effort: "high", max_completion_tokens: 150 });
  assert.equal(explicit.reasoning.effort, "high");
  assert.equal(explicit.max_output_tokens, 1024);
  assert.equal(buildOpenAIRequest({ ...opts, max_output_tokens: 50 }).max_output_tokens, 50);
});

test("large catalogues retain every tool under hosted search with the original function names", () => {
  const tools = Array.from({ length: 137 }, (_, i) => tool(`app_tool_${i}`));
  const request = buildOpenAIRequest({ ...opts, tools });
  assert.equal(request.tools[0].type, "tool_search");
  assert.equal(request.tools[1].type, "namespace");
  assert.equal(request.tools[1].name, "bgp");
  assert.equal(request.tools[1].tools.length, 137);
  assert.equal(request.tools[1].tools[136].name, "app_tool_136");
  assert.ok(request.tools[1].tools.every((fn: any) => fn.defer_loading && fn.strict === false));
  const message = normalizeOpenAIResponse(response([{ ...call(), namespace: "bgp" }])).choices[0].message;
  assert.equal(message.tool_calls[0].function.name, "find_deals");
  assert.throws(() => buildOpenAIRequest({ ...opts, tools: [tool(), tool()] }), /Duplicate/);
});

test("OpenAI and Anthropic images, PDFs, text documents, and tool attachments survive conversion", () => {
  const converted = convertMessagesForOpenAI([{ role: "user", content: [
    { type: "text", text: "Inspect these" },
    { type: "image_url", image_url: { url: "https://example.org/a.jpg", detail: "high" } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    { type: "document", title: "lease.pdf", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } },
    { type: "document", source: { type: "url", url: "https://example.org/lease.pdf" } },
    { type: "document", source: { type: "text", data: "Lease text" } },
  ] }]);
  assert.deepEqual(converted.input[0].content, [
    { type: "input_text", text: "Inspect these" },
    { type: "input_image", image_url: "https://example.org/a.jpg", detail: "high" },
    { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
    { type: "input_file", filename: "lease.pdf", file_data: "data:application/pdf;base64,BBBB" },
    { type: "input_file", file_url: "https://example.org/lease.pdf" },
    { type: "input_text", text: "Lease text" },
  ]);
  assert.throws(() => convertMessagesForOpenAI([{ role: "user", content: [{ type: "audio" }] }]), /Unsupported/);
});

test("multiple function calls/results preserve call_id, reasoning and hosted search output exactly once", () => {
  const output = [
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "encrypted-test-only" },
    { type: "tool_search_call", id: "ts_1", execution: "server", status: "completed", arguments: {} },
    { type: "tool_search_output", id: "tso_1", execution: "server", status: "completed", tools: [] },
    textItem, call("call_a"), call("call_b", "find_contacts", "{}"),
  ];
  const message = normalizeOpenAIResponse(response(output)).choices[0].message;
  assert.equal(message.content, "Found deals");
  assert.deepEqual(message.tool_calls.map((t: any) => t.id), ["call_a", "call_b"]);
  const converted = convertMessagesForOpenAI([message,
    { role: "tool", tool_call_id: "call_a", content: "First result" },
    { role: "tool", tool_call_id: "call_b", content: "Second result" },
  ]);
  assert.deepEqual(converted.input.slice(0, output.length), output);
  assert.deepEqual(converted.input.slice(output.length), [
    { type: "function_call_output", call_id: "call_a", output: "First result" },
    { type: "function_call_output", call_id: "call_b", output: "Second result" },
  ]);
});

test("historical normalized and Anthropic tool messages work without provider reasoning blocks", () => {
  const converted = convertMessagesForOpenAI([
    { role: "system", content: "Rules" }, { role: "developer", content: "More rules" },
    { role: "assistant", content: "Searching", tool_calls: [{ id: "call_a", function: { name: "find_deals", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_a", content: "done" },
    { role: "assistant", content: [{ type: "thinking", thinking: "Provider-specific hidden state" },
      { type: "tool_use", id: "call_b", name: "find_contacts", input: { name: "Alex" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_b", content: "contact found" }] },
  ]);
  assert.equal(converted.instructions, "Rules");
  assert.equal(converted.input[2].call_id, "call_a");
  assert.equal(converted.input[4].call_id, "call_b");
  assert.equal(converted.input[5].call_id, "call_b");
  assert.ok(!JSON.stringify(converted).includes("Provider-specific hidden state"));
  assert.throws(() => convertMessagesForOpenAI([{ role: "tool", tool_call_id: "orphan", content: "trimmed" }]), /preserve the complete tool exchange/);
});

test("incomplete, empty, refusal and malformed or duplicate tool calls never become executable results", () => {
  assert.throws(() => normalizeOpenAIResponse({ ...response([call()]), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), /max_output_tokens/);
  assert.throws(() => normalizeOpenAIResponse({ ...response(), status: "failed", error: { code: "server_error" } }), /server_error/);
  assert.throws(() => normalizeOpenAIResponse(response([])), /no text/);
  assert.throws(() => normalizeOpenAIResponse(response([{ ...textItem, content: [{ type: "refusal", refusal: "No" }] }])), /declined/);
  assert.throws(() => normalizeOpenAIResponse(response([call("x", "find_deals", "{")])), /invalid tool arguments/);
  assert.throws(() => normalizeOpenAIResponse(response([call("x", "find_deals", "[]")])), /must be an object/);
  assert.throws(() => normalizeOpenAIResponse(response([call(), call()])), /duplicate/);
  assert.throws(() => normalizeOpenAIResponse(response([{ ...call(), call_id: undefined }])), /invalid tool call/);
});

test("usage separates cached reads/writes and counts reasoning output once", () => {
  assert.deepEqual(normalizeOpenAIUsage(response().usage), {
    input_tokens: 60, output_tokens: 40, cache_read_input_tokens: 30, cache_creation_input_tokens: 10,
  });
  assert.deepEqual(normalizeOpenAIUsage({ input_tokens: 10, input_tokens_details: { cached_tokens: 20 } }), {
    input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10, cache_creation_input_tokens: 0,
  });
});

test("normal requests meter actual model and feature without executing any tool or retrying failures", async () => {
  const events: any[] = [];
  let calls = 0;
  const adapter = createOpenAIAdapter({ create: async (body, options) => {
    calls++;
    assert.equal(body.store, false);
    assert.equal(options.signal, undefined);
    return response([call()]);
  }, logUsage: event => { events.push(event); } });
  const result = await adapter.callOpenAI({ ...opts, feature: "qa-openai" });
  assert.equal(result.choices[0].message.tool_calls[0].id, "call_1");
  assert.equal(calls, 1);
  assert.equal(events[0].provider, "openai");
  assert.equal(events[0].model, "gpt-6.1-sol");
  assert.equal(events[0].feature, "qa-openai");
  const failing = createOpenAIAdapter({ create: async () => { calls++; throw new Error("401 unauthorized"); }, logUsage: () => {} });
  await assert.rejects(failing.callOpenAI(opts), /401/);
  assert.equal(calls, 2);
});

function streaming(events: any[], metering: any[] = []) {
  let aborted = false;
  const adapter = createOpenAIAdapter({ create: async () => ({
    controller: { abort() { aborted = true; } },
    async *[Symbol.asyncIterator]() { for (const event of events) yield event; },
  }), logUsage: event => { metering.push(event); } });
  return { adapter, aborted: () => aborted };
}

test("streamed text is delivered but tool calls are released only after completed response", async () => {
  const metering: any[] = [];
  const { adapter, aborted } = streaming([
    { type: "response.output_text.delta", delta: "Found " },
    { type: "response.output_text.delta", delta: "deals" },
    { type: "response.function_call_arguments.delta", delta: '{"query":' },
    { type: "response.completed", response: response([textItem, call()]) },
  ], metering);
  let text = "";
  const result = await adapter.callOpenAIStreaming(opts, delta => { text += delta; });
  assert.equal(text, "Found deals");
  assert.equal(result.choices[0].message.tool_calls[0].id, "call_1");
  assert.equal(metering.length, 1);
  assert.ok(aborted());
});

test("truncated, failed, incomplete and provider-error streams reject instead of returning partial tools", async () => {
  for (const final of [null,
    { type: "response.failed", response: { ...response(), status: "failed", error: { code: "server_error" } } },
    { type: "response.incomplete", response: { ...response(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
    { type: "error", code: "server_error" },
  ]) {
    const metering: any[] = [];
    const { adapter, aborted } = streaming([{ type: "response.output_item.done", item: call() }, ...(final ? [final] : [])], metering);
    await assert.rejects(adapter.callOpenAIStreaming(opts, () => {}), /OpenAI stream/);
    assert.ok(aborted());
    assert.equal(metering.length, final?.response ? 1 : 0);
  }
});

test("AbortSignal and existing Stop callback reject before releasing results", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const adapter = createOpenAIAdapter({ create: async () => { calls++; return response(); }, logUsage: () => {} });
  await assert.rejects(adapter.callOpenAI({ ...opts, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(adapter.callOpenAIStreaming({ ...opts, signal: controller.signal }, () => {}), { name: "AbortError" });
  await assert.rejects(adapter.callOpenAIStreaming(opts, () => {}, () => true), { name: "AbortError" });
  assert.equal(calls, 0);
  let stopped = false;
  const stream = streaming([{ type: "response.output_text.delta", delta: "Partial" }, { type: "response.completed", response: response([call()]) }]);
  await assert.rejects(stream.adapter.callOpenAIStreaming(opts, () => { stopped = true; }, () => stopped), { name: "AbortError" });
  assert.ok(stream.aborted());
});

test("Stop callback aborts the request while waiting for the first stream event", async () => {
  let stopped = false;
  let sentSignal: AbortSignal | undefined;
  const adapter = createOpenAIAdapter({ create: (_body, options) => {
    sentSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => {
      const error = new Error("stopped"); error.name = "AbortError"; reject(error);
    }, { once: true }));
  }, logUsage: () => {} });
  const keepAlive = setTimeout(() => {}, 500);
  const pending = adapter.callOpenAIStreaming(opts, () => {}, () => stopped);
  stopped = true;
  try {
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(sentSignal?.aborted);
  } finally { clearTimeout(keepAlive); }
});

test("metering failure never changes a completed response", async () => {
  const adapter = createOpenAIAdapter({ create: async () => response(), logUsage: () => { throw new Error("db offline"); } });
  assert.equal((await adapter.callOpenAI(opts)).choices[0].message.content, "Found deals");
});
