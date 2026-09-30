import Anthropic from "@anthropic-ai/sdk";

// Provider switch for the app's AI calls (Woody, 2026-09-30: "swap the
// Claude API to the Kimi API for ChatBGP... move the whole app across").
//
// Kimi's platform speaks the Anthropic Messages wire format, so the official
// Anthropic SDK works unchanged — only apiKey + baseURL + model name differ:
//   https://api.moonshot.ai/anthropic  (platform.kimi.ai, MOONSHOT_API_KEY)
//
// Switches (env):
//   CHATBGP_PROVIDER=kimi   → ChatBGP chat loop only
//   AI_PROVIDER=kimi        → everything routed through the shared
//                             utils/anthropic-client.ts helpers as well
//   MOONSHOT_API_KEY        → required for kimi; without it we stay on
//                             Anthropic (loudly) rather than crash
//   MOONSHOT_BASE_URL       → defaults to https://api.moonshot.ai/anthropic
//   KIMI_CHAT_MODEL         → flagship tier (fable/opus), default kimi-k3
//   KIMI_FAST_MODEL         → sonnet tier, default kimi-k2.6
//   KIMI_HELPER_MODEL       → haiku background tier, default kimi-k2.6
//
// Deliberately NOT migrated by these flags: files constructing
// `new Anthropic()` directly (~50 call sites — PDF document blocks,
// brochure/plan vision pipelines etc.). Those stay on Claude until each is
// moved onto the shared helper and verified against Kimi.

export type AiProvider = "anthropic" | "kimi";

function resolveProvider(raw: string | undefined): AiProvider {
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
