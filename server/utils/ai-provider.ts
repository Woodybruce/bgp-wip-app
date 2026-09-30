import Anthropic from "@anthropic-ai/sdk";

// CHATBGP_PROVIDER selects the chat loop; AI_PROVIDER selects shared helpers.
// OpenAI uses Responses (OPENAI_API_KEY); Kimi uses the Anthropic-compatible
// endpoint (MOONSHOT_API_KEY); Anthropic remains available for rollback.
// OPENAI_CHAT_MODEL defaults to Sol 6.1, OPENAI_HELPER_MODEL to Luna, and
// OPENAI_ADVANCED_MODEL to Astra (only explicitly selected per thread).
// Direct Anthropic SDK pipelines are intentionally unchanged by these flags.

export type AiProvider = "anthropic" | "kimi" | "openai";

function resolveProvider(raw: string | undefined): AiProvider {
  // An explicitly selected provider must fail visibly if its key is missing;
  // never silently move OpenAI traffic onto a more expensive Claude model.
  if ((raw || "").trim().toLowerCase() === "openai") return "openai";
  if ((raw || "").trim().toLowerCase() !== "kimi") return "anthropic";
  if (!process.env.MOONSHOT_API_KEY) {
    console.warn("[ai-provider] kimi selected but MOONSHOT_API_KEY is not set — staying on Anthropic");
    return "anthropic";
  }
  return "kimi";
}

export function chatProvider(): AiProvider {
  return resolveProvider(process.env.CHATBGP_PROVIDER || process.env.AI_PROVIDER);
}

export function globalProvider(): AiProvider {
  return resolveProvider(process.env.AI_PROVIDER);
}

export function hasGlobalAiKey(): boolean {
  const provider = globalProvider();
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  if (provider === "kimi") return !!process.env.MOONSHOT_API_KEY;
  return !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export function openaiChatModel(): string {
  return process.env.OPENAI_CHAT_MODEL || "gpt-6.1-sol";
}

export function openaiHelperModel(): string {
  return process.env.OPENAI_HELPER_MODEL || "gpt-6-luna";
}

export function openaiAdvancedModel(): string {
  return process.env.OPENAI_ADVANCED_MODEL || "gpt-6-astra";
}

export function mapModelForOpenAI(model: string): string {
  if (/^gpt-/i.test(model || "")) return model;
  if ((model || "").includes("haiku")) return openaiHelperModel();
  // Saved Claude preferences must not silently opt a thread into Astra.
  return openaiChatModel();
}

export function kimiBaseURL(): string {
  return process.env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/anthropic";
}

// maxRetries capped at 1: Moonshot's own guidance is that SDK auto-retry
// storms amplify their org-level 429s (three distinct error types share the
// status), so we do our own small backoff loop instead.
export function getKimiClient(): Anthropic {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) throw new Error("MOONSHOT_API_KEY not configured");
  return new Anthropic({ apiKey, baseURL: kimiBaseURL(), maxRetries: 1 });
}

export function kimiChatModel(): string {
  return process.env.KIMI_CHAT_MODEL || "kimi-k3";
}
export function kimiFastModel(): string {
  return process.env.KIMI_FAST_MODEL || "kimi-k2.6";
}
export function kimiHelperModel(): string {
  return process.env.KIMI_HELPER_MODEL || "kimi-k2.6";
}

// Map a Claude model id onto the Kimi tier that plays the same role.
// Already-Kimi names pass through untouched.
export function mapModelForKimi(model: string): string {
  if (!model) return kimiChatModel();
  if (/^(kimi|moonshot)/i.test(model)) return model;
  if (model.includes("haiku")) return kimiHelperModel();
  if (model.includes("sonnet")) return kimiFastModel();
  // fable / opus / anything else → flagship
  return kimiChatModel();
}

// Anthropic-proprietary request fields Kimi's Messages endpoint won't
// accept: the server-side-fallback beta + fallbacks list (Fable safety
// feature), extended-thinking config (K3 thinks always-on; adaptive type
// and effort knobs are Anthropic-only), and the output_config effort lever.
// cache_control is kept: the endpoint supports prompt-cache semantics
// (usage returns cache_read/cache_creation tokens).
export function sanitizeParamsForKimi(params: any): any {
  delete params.betas;
  delete params.fallbacks;
  delete params.thinking;
  delete params.output_config;
  return params;
}
