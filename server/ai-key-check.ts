// Which AI keys actually work right now. Each probe is the smallest paid
// request there is (a few tokens), so an admin can see at a glance whether
// a 401 in a feature is the key or the feature.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicWorkspaceOptions } from "./utils/anthropic-client";

export type KeyStatus = { name: string; configured: boolean; ok: boolean | null; detail: string };

async function probeAnthropic(name: string, apiKey: string | undefined, baseURL?: string): Promise<KeyStatus> {
  if (!apiKey) return { name, configured: false, ok: null, detail: "not set" };
  try {
    const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), ...anthropicWorkspaceOptions() });
    const r = await client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: "ok" }] }, { timeout: 15_000, maxRetries: 0 });
    return { name, configured: true, ok: true, detail: `ok (${r.model})` };
  } catch (e: any) {
    const status = e?.status || e?.statusCode;
    return { name, configured: true, ok: false, detail: `${status || e?.name || "error"}: ${String(e?.message || e).slice(0, 200)}` };
  }
}

async function probeOpenAI(): Promise<KeyStatus> {
  const name = "OpenAI (OPENAI_API_KEY)";
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { name, configured: false, ok: null, detail: "not set" };
  try {
    const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) return { name, configured: true, ok: true, detail: "ok" };
    const txt = await r.text().catch(() => "");
    return { name, configured: true, ok: false, detail: `${r.status}: ${txt.slice(0, 200)}` };
  } catch (e: any) {
    return { name, configured: true, ok: false, detail: String(e?.message || e).slice(0, 200) };
  }
}

export async function checkAiKeys(): Promise<{ checkedAt: string; provider: string; workspaceIdSet: boolean; keys: KeyStatus[] }> {
  const keys = await Promise.all([
    probeAnthropic("Anthropic direct (ANTHROPIC_API_KEY)", process.env.ANTHROPIC_API_KEY),
    probeAnthropic("Anthropic integration (AI_INTEGRATIONS_ANTHROPIC_API_KEY)", process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY, process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL),
    probeOpenAI(),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    provider: process.env.CHATBGP_PROVIDER || process.env.AI_PROVIDER || "anthropic",
    // A user-scoped key (sk-ant-usr-…) is refused without this header.
    workspaceIdSet: !!process.env.ANTHROPIC_WORKSPACE_ID,
    keys,
  };
}
