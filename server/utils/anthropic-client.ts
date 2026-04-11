import Anthropic from "@anthropic-ai/sdk";

export const CHATBGP_MODEL = "claude-sonnet-4-6";
export const CHATBGP_HELPER_MODEL = "claude-sonnet-4-6";

export function getAnthropicClient(useDirect = false) {
  if (useDirect && process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
      ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
      : {}),
  });
}

export function convertToolsForClaude(tools: any[]): any[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export function convertMessagesForClaude(messages: any[]): { system: string; messages: any[] } {
  let system = "";
  const claudeMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
    } else if (msg.role === "tool") {
      const last = claudeMessages[claudeMessages.length - 1];
      const toolResultContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const toolResult = { type: "tool_result" as const, tool_use_id: msg.tool_call_id, content: toolResultContent || "No output" };
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.some((c: any) => c.type === "tool_result")) {
        last.content.push(toolResult);
      } else {
        claudeMessages.push({ role: "user", content: [toolResult] });
      }
    } else if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: any[] = [];
        if (msg.content) content.push({ type: "text", text: msg.content });
        for (const tc of msg.tool_calls) {
          let input: any;
          try { input = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch { input = {}; }
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        claudeMessages.push({ role: "assistant", content });
      } else {
        const text = typeof msg.content === "string" ? msg.content : (msg.content || "");
        claudeMessages.push({ role: "assistant", content: text || "OK" });
      }
    } else if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const parts: any[] = [];
        for (const part of msg.content) {
          if (part.type === "text") {
            parts.push({ type: "text", text: part.text || "(continued)" });
          } else if (part.type === "image_url" && part.image_url?.url) {
            const url = part.image_url.url;
            if (url.startsWith("data:")) {
              const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (match) {
                parts.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
              }
            } else {
              parts.push({ type: "image", source: { type: "url", url } });
            }
          }
        }
        claudeMessages.push({ role: "user", content: parts.length > 0 ? parts : [{ type: "text", text: "(continued)" }] });
      } else {
        claudeMessages.push({ role: "user", content: msg.content && msg.content.trim() ? msg.content : "(continued)" });
      }
    }
  }

  const merged: any[] = [];
  for (const msg of claudeMessages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      const thisContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
      last.content = [...lastContent, ...thisContent];
    } else {
      merged.push(msg);
    }
  }

  if (merged.length > 0 && merged[merged.length - 1].role === "assistant") {
    merged.pop();
  }

  if (merged.length === 0) {
    merged.push({ role: "user", content: "(continue)" });
  }

  return { system, messages: merged };
}

function parseClaudeResponse(response: any) {
  let textContent = "";
  const toolCalls: any[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  return {
    choices: [{
      message: {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    }],
  };
}

export async function callClaude(opts: any) {
  const tools = opts.tools ? convertToolsForClaude(opts.tools) : undefined;
  const { system, messages } = convertMessagesForClaude(opts.messages);

  const params: any = {
    model: opts.model || CHATBGP_MODEL,
    messages,
    max_tokens: opts.max_completion_tokens || 8192,
    temperature: opts.temperature ?? 0.3,
  };
  if (system) params.system = system;
  if (tools && tools.length > 0) params.tools = tools;

  const hasDirect = !!process.env.ANTHROPIC_API_KEY;
  const hasIntegration = !!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

  if (hasDirect) {
    try {
      const client = getAnthropicClient(true);
      const response = await client.messages.create(params);
      return parseClaudeResponse(response);
    } catch (err: any) {
      const isCreditsOrAuth = err?.status === 400 || err?.status === 401 || err?.status === 403;
      if (isCreditsOrAuth && hasIntegration) {
        console.error("Claude API error:", err?.status, err?.message, err?.error);
        console.log("[claude] Direct API key failed, falling back to Replit integration");
      } else {
        throw err;
      }
    }
  }

  const client = getAnthropicClient(false);
  const response = await client.messages.create(params);
  return parseClaudeResponse(response);
}

export function safeParseJSON(raw: string): any {
  if (!raw) throw new Error("Empty response from AI");
  const stripped = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse JSON from AI response");
  }
}