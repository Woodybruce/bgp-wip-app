import Anthropic from "@anthropic-ai/sdk";

// Claude model constants
export const CHATBGP_MODEL = "claude-sonnet-4-6";
export const CHATBGP_HELPER_MODEL = "claude-sonnet-4-6";

/**
 * Get an Anthropic client instance
 * @param useDirect - If true, use direct API key instead of AI integrations proxy
 */
export function getAnthropicClient(useDirect = false): Anthropic {
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

/**
 * Convert OpenAI-style tools to Claude format
 */
export function convertToolsForClaude(tools: any[]): any[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Convert OpenAI-style messages to Claude format
 */
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

  // Merge consecutive messages from the same role
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

  // Fix message ordering
  const fixed: any[] = [];
  for (let i = 0; i < merged.length; i++) {
    const msg = merged[i];
    const prev = fixed[fixed.length - 1];
    if (prev && prev.role === msg.role) {
      if (prev.role === "assistant") {
        fixed.push({ role: "user", content: "(continued)" });
        fixed.push(msg);
      } else {
        fixed.push({ role: "assistant", content: "OK" });
        fixed.push(msg);
      }
    } else if (!prev && msg.role === "assistant") {
      fixed.push({ role: "user", content: "Hello" });
      fixed.push(msg);
    } else {
      fixed.push(msg);
    }
  }

  return { system, messages: fixed };
}

/**
 * Convert Claude response to OpenAI format
 */
export function convertClaudeResponse(claudeResponse: any): any {
  let textContent = "";
  const toolCalls: any[] = [];

  if (claudeResponse.content) {
    for (const block of claudeResponse.content) {
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

/**
 * Call Claude API with retry logic
 */
export async function callClaude(params: any): Promise<any> {
  const client = getAnthropicClient();
  const tools = params.tools ? convertToolsForClaude(params.tools) : undefined;
  const { system, messages } = convertMessagesForClaude(params.messages);

  try {
    const response = await client.messages.create({
      model: params.model || CHATBGP_MODEL,
      system,
      messages,
      tools,
      max_tokens: params.max_tokens || 4096,
      tool_choice: params.tool_choice,
    });

    return convertClaudeResponse(response);
  } catch (error: any) {
    if (error?.status === 429) {
      const retryAfter = parseInt(error.headers?.["retry-after"] || "5");
      console.log(`[Claude] Rate limited, retrying after ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      
      const retryClient = getAnthropicClient(true);
      const response = await retryClient.messages.create({
        model: params.model || CHATBGP_MODEL,
        system,
        messages,
        tools,
        max_tokens: params.max_tokens || 4096,
        tool_choice: params.tool_choice,
      });
      return convertClaudeResponse(response);
    }
    
    throw error;
  }
}