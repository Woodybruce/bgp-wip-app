import OpenAI from "openai";
import type { AiUsageEvent } from "../api-usage";

const DEFAULT_MODEL = "gpt-6.1-sol";
const TOOL_NAMESPACE = "bgp";

function abortError(): Error {
  const error = new Error("OpenAI request aborted");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function textOf(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => part.text || "").filter(Boolean).join("\n");
  return value == null ? "" : JSON.stringify(value);
}

/** Preserve supported attachments; never silently turn a document into an empty prompt. */
function inputParts(content: any): any[] {
  if (!Array.isArray(content)) return [{ type: "input_text", text: textOf(content) }];
  return content.flatMap((part: any) => {
    if (part.type === "text" || part.type === "input_text") {
      return [{ type: "input_text", text: part.text || "" }];
    }
    if (part.type === "input_image" || part.type === "input_file") return [part];
    if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!url) throw new Error("Image attachment is missing its URL");
      return [{ type: "input_image", image_url: url, detail: part.image_url?.detail || "auto" }];
    }
    if (part.type === "image") {
      const source = part.source;
      const url = source?.type === "base64"
        ? `data:${source.media_type};base64,${source.data}` : source?.url;
      if (!url) throw new Error("Image attachment is missing its source");
      return [{ type: "input_image", image_url: url, detail: "auto" }];
    }
    if (part.type === "document") {
      const source = part.source;
      if (source?.type === "text") return [{ type: "input_text", text: source.data || "" }];
      if (source?.type === "base64") {
        return [{ type: "input_file", filename: part.title || "attachment.pdf",
          file_data: `data:${source.media_type || "application/pdf"};base64,${source.data}` }];
      }
      if (source?.type === "url") return [{ type: "input_file", file_url: source.url }];
    }
    throw new Error(`Unsupported OpenAI attachment type: ${String(part.type)}`);
  });
}

function functionCall(id: any, name: any, args: any): any {
  if (!id || !name) throw new Error("Tool call is missing its call ID or name");
  return { type: "function_call", call_id: id, name,
    arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) };
}

export function convertMessagesForOpenAI(messages: any[], systemArray?: any[]) {
  const input: any[] = [];
  const system: string[] = systemArray ? [textOf(systemArray)] : [];
  for (const message of messages || []) {
    if (message.role === "system") {
      if (!systemArray) system.push(textOf(message.content));
    } else if (message.role === "tool") {
      if (!message.tool_call_id) throw new Error("Tool result is missing its call ID");
      input.push({ type: "function_call_output", call_id: message.tool_call_id,
        output: Array.isArray(message.content) ? inputParts(message.content) : textOf(message.content) });
    } else if (message.role === "assistant") {
      if (Array.isArray(message._openaiOutput) && message._openaiOutput.length) {
        // Includes encrypted reasoning and hosted tool-search results. Rebuilding
        // these as plain text breaks stateless, multi-step reasoning/tool calls.
        input.push(...message._openaiOutput);
        continue;
      }
      const blocks = Array.isArray(message.content) ? message.content : [];
      const content = Array.isArray(message.content)
        ? blocks.filter((part: any) => part.type === "text").map((part: any) => part.text).join("")
        : textOf(message.content);
      if (content) input.push({ role: "assistant", content });
      for (const call of message.tool_calls || []) {
        input.push(functionCall(call.id, call.function?.name, call.function?.arguments));
      }
      for (const block of blocks.filter((part: any) => part.type === "tool_use")) {
        input.push(functionCall(block.id, block.name, block.input));
      }
    } else if (message.role === "user" || message.role === "developer") {
      // Anthropic-form tool results sometimes reach shared helpers directly.
      const parts = Array.isArray(message.content) ? message.content : null;
      const ordinary = parts?.filter((part: any) => part.type !== "tool_result");
      for (const result of parts?.filter((part: any) => part.type === "tool_result") || []) {
        if (!result.tool_use_id) throw new Error("Tool result is missing its call ID");
        input.push({ type: "function_call_output", call_id: result.tool_use_id,
          output: Array.isArray(result.content) ? inputParts(result.content) : textOf(result.content) });
      }
      if (!parts || ordinary!.length) {
        input.push({ role: message.role, content: inputParts(ordinary || message.content) });
      }
    } else {
      throw new Error(`Unsupported OpenAI message role: ${String(message.role)}`);
    }
  }
  const callIds = new Set<string>();
  for (const item of input) {
    if (item.type === "function_call") callIds.add(item.call_id);
    if (item.type === "function_call_output" && !callIds.has(item.call_id)) {
      throw new Error("OpenAI conversation contains a tool result without its preceding tool call; preserve the complete tool exchange when trimming history");
    }
  }
  return { input, instructions: system.filter(Boolean).join("\n\n") };
}

export function buildOpenAIRequest(opts: any): any {
  const { input, instructions } = convertMessagesForOpenAI(opts.messages, opts.systemArray);
  const model = opts.model || DEFAULT_MODEL;
  const requestedEffort = opts.reasoning?.effort || opts.reasoning_effort || opts.effort || opts.output_config?.effort;
  const isLuna = /-luna(?:-|$)/i.test(model);
  const effort = requestedEffort
    ? ((!isLuna && requestedEffort === "none") || requestedEffort === "minimal" ? "low" : requestedEffort)
    : opts.thinking === true ? "medium" : isLuna ? "none" : "low";
  const originalBudget = opts.max_output_tokens || opts.max_completion_tokens || opts.max_tokens || 8192;
  // Older helper caps (often 50–300) only budgeted visible text. Responses
  // counts reasoning too. Luna can disable reasoning; other reasoning helpers
  // need bounded headroom. An explicit Responses max_output_tokens stays exact.
  const outputBudget = opts.max_output_tokens == null && opts.thinking !== true && effort !== "none"
    ? Math.max(originalBudget, 1024) : originalBudget;
  const body: any = {
    model, input, store: false, include: ["reasoning.encrypted_content"],
    max_output_tokens: outputBudget,
    reasoning: { effort },
  };
  if (instructions) body.instructions = instructions;
  if (outputBudget > originalBudget) {
    body.instructions = [instructions, `Keep the visible answer concise, aiming for no more than ${originalBudget} tokens.`].filter(Boolean).join("\n\n");
  }
  const functions = (opts.tools || []).map((tool: any) => {
    const fn = tool.function || tool;
    if (tool.type && tool.type !== "function") throw new Error(`Unsupported application tool: ${tool.type}`);
    if (!fn.name) throw new Error("Application tool is missing its name");
    return { type: "function", name: fn.name, description: fn.description,
      parameters: fn.parameters || fn.input_schema || { type: "object", properties: {} },
      strict: fn.strict ?? opts.strict ?? false };
  });
  if (new Set(functions.map((fn: any) => fn.name)).size !== functions.length) {
    throw new Error("Duplicate application tool names");
  }
  // ChatBGP has more than 128 tools. Hosted tool search keeps the complete
  // catalogue available without eagerly placing every schema in model context.
  // This is a Responses capability; the older SDK types do not yet describe it.
  const deferred = functions.length > 128;
  if (functions.length) {
    body.tools = deferred ? [
      { type: "tool_search" },
      { type: "namespace", name: TOOL_NAMESPACE,
        description: "BGP commercial property app tools: CRM, contacts, brands, landlords, properties, deals, requirements, lease advisory, Land Registry, documents, email, calendar, tasks, reports and business operations.",
        tools: functions.map((fn: any) => ({ ...fn, defer_loading: true })) },
    ] : functions;
  }
  if (opts.tool_choice) {
    const choice = opts.tool_choice;
    const name = choice.function?.name || (choice.type === "function" ? choice.name : undefined);
    body.tool_choice = name ? { type: "function", name, ...(deferred ? { namespace: TOOL_NAMESPACE } : {}) }
      : choice === "any" || choice.type === "any" ? "required" : choice.type || choice;
  }
  if (opts.parallel_tool_calls != null) body.parallel_tool_calls = opts.parallel_tool_calls;
  if (opts.prompt_cache_key) body.prompt_cache_key = opts.prompt_cache_key;
  // Anthropic temperatures/thinking budgets/cache_control must not leak here.
  if (opts.response_format?.type === "json_object") body.text = { format: { type: "json_object" } };
  if (opts.response_format?.type === "json_schema") {
    body.text = { format: { type: "json_schema", ...opts.response_format.json_schema } };
  }
  return body;
}

export function normalizeOpenAIUsage(usage: any): AiUsageEvent["usage"] {
  const input = Math.max(0, Number(usage?.input_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage?.input_tokens_details?.cached_tokens) || 0));
  const written = Math.min(input - cached, Math.max(0, Number(usage?.input_tokens_details?.cache_write_tokens) || 0));
  return { input_tokens: input - cached - written,
    cache_read_input_tokens: cached, cache_creation_input_tokens: written,
    // output_tokens already includes reasoning_tokens.
    output_tokens: Math.max(0, Number(usage?.output_tokens) || 0) };
}

export function normalizeOpenAIResponse(response: any): any {
  if (response?.status !== "completed") {
    const reason = response?.incomplete_details?.reason || response?.error?.code || response?.status || "missing status";
    throw new Error(`OpenAI response did not complete (${reason})`);
  }
  if (!Array.isArray(response.output)) throw new Error("OpenAI returned no output");
  const text: string[] = [];
  const toolCalls: any[] = [];
  for (const item of response.output) {
    if (item.type === "message") {
      for (const part of item.content || []) {
        if (part.type === "refusal") throw new Error("OpenAI declined the request (safety refusal)");
        if (part.type === "output_text") text.push(part.text || "");
      }
    } else if (item.type === "function_call") {
      if (item.status && item.status !== "completed") throw new Error("OpenAI returned an incomplete tool call");
      if (!item.call_id || !item.name || typeof item.arguments !== "string") {
        throw new Error("OpenAI returned an invalid tool call");
      }
      let args: any;
      try { args = JSON.parse(item.arguments); } catch { throw new Error("OpenAI returned invalid tool arguments"); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("OpenAI tool arguments must be an object");
      if (toolCalls.some(call => call.id === item.call_id)) throw new Error("OpenAI returned duplicate tool call IDs");
      toolCalls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    }
  }
  if (!text.join("") && !toolCalls.length) throw new Error("OpenAI returned no text or application tool calls");
  return { choices: [{ message: { role: "assistant", content: text.join("") || null,
    tool_calls: toolCalls.length ? toolCalls : undefined, _openaiOutput: response.output } }] };
}

interface AdapterDependencies {
  create: (body: any, options: { signal?: AbortSignal }) => Promise<any>;
  logUsage: (event: AiUsageEvent) => void | Promise<void>;
}

/** Injectable transport keeps regression tests offline, including streaming errors. */
export function createOpenAIAdapter(dependencies: AdapterDependencies) {
  async function record(response: any, opts: any) {
    if (!response?.usage) return;
    try {
      await dependencies.logUsage({ provider: "openai", model: response.model || opts.model || DEFAULT_MODEL,
        feature: opts.feature || "chatbgp", usage: normalizeOpenAIUsage(response.usage) });
    } catch { /* Metering must not change the result of a completed request. */ }
  }
  return {
    async callOpenAI(opts: any) {
      checkAbort(opts.signal);
      const response = await dependencies.create(buildOpenAIRequest(opts), { signal: opts.signal });
      await record(response, opts);
      checkAbort(opts.signal);
      return normalizeOpenAIResponse(response);
    },
    async callOpenAIStreaming(opts: any, onText: (text: string) => void, shouldAbort?: () => boolean) {
      checkAbort(opts.signal);
      const controller = new AbortController();
      const externalAbort = () => controller.abort();
      opts.signal?.addEventListener("abort", externalAbort, { once: true });
      const checkStopped = () => {
        if (shouldAbort?.()) controller.abort();
      };
      checkStopped();
      const timer = shouldAbort ? setInterval(checkStopped, 100) : undefined;
      timer?.unref();
      let stream: any;
      let completed: any;
      const abort = () => stream?.controller?.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      try {
        checkAbort(controller.signal);
        stream = await dependencies.create({ ...buildOpenAIRequest(opts), stream: true }, { signal: controller.signal });
        checkAbort(controller.signal);
        for await (const event of stream) {
          checkStopped();
          checkAbort(controller.signal);
          if (event.type === "response.output_text.delta") onText(event.delta || "");
          if (event.type === "response.completed") {
            completed = event.response;
            await record(completed, opts);
            break;
          }
          if (event.type === "response.failed" || event.type === "response.incomplete") {
            await record(event.response, opts);
            throw new Error(`OpenAI stream did not complete (${event.response?.incomplete_details?.reason || event.response?.error?.code || event.type})`);
          }
          if (event.type === "error") throw new Error(`OpenAI stream failed (${event.code || "provider error"})`);
        }
        checkAbort(controller.signal);
        if (!completed) throw new Error("OpenAI stream ended without a completed response");
        return normalizeOpenAIResponse(completed);
      } finally {
        if (timer) clearInterval(timer);
        opts.signal?.removeEventListener("abort", externalAbort);
        controller.signal.removeEventListener("abort", abort);
        // Stop transport after failures, cancellation, or the terminal event.
        stream?.controller?.abort();
      }
    },
  };
}

let client: OpenAI | undefined;
const adapter = createOpenAIAdapter({
  create: async (body, options) => {
    if (!client) {
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the OpenAI provider");
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
    }
    return client.responses.create(body, options);
  },
  logUsage: async event => {
    const { logAiUsage } = await import("../api-usage");
    logAiUsage(event);
  },
});

export const callOpenAI = adapter.callOpenAI;
export const callOpenAIStreaming = adapter.callOpenAIStreaming;
