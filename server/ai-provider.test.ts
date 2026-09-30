import test from "node:test";
import assert from "node:assert/strict";

// Provider-switch pure logic: env parsing, model tier mapping, and the
// Anthropic-only param stripper. Client construction is exercised only for
// shape (no network).

process.env.MOONSHOT_API_KEY = "test-key";

const { chatProvider, globalProvider, mapModelForKimi, sanitizeParamsForKimi, kimiBaseURL } = await import("./utils/ai-provider");

test("provider defaults to anthropic when no switch set", () => {
  delete process.env.CHATBGP_PROVIDER;
  delete process.env.AI_PROVIDER;
  assert.equal(chatProvider(), "anthropic");
  assert.equal(globalProvider(), "anthropic");
});

test("CHATBGP_PROVIDER=kimi selects kimi for chat only", () => {
  process.env.CHATBGP_PROVIDER = "kimi";
  delete process.env.AI_PROVIDER;
  assert.equal(chatProvider(), "kimi");
  assert.equal(globalProvider(), "anthropic");
});

test("AI_PROVIDER=kimi selects kimi globally", () => {
  delete process.env.CHATBGP_PROVIDER;
  process.env.AI_PROVIDER = "kimi";
  assert.equal(chatProvider(), "kimi");
  assert.equal(globalProvider(), "kimi");
  delete process.env.AI_PROVIDER;
});

test("kimi requested without MOONSHOT_API_KEY falls back to anthropic", () => {
  const saved = process.env.MOONSHOT_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  process.env.AI_PROVIDER = "kimi";
  assert.equal(globalProvider(), "anthropic");
  delete process.env.AI_PROVIDER;
  process.env.MOONSHOT_API_KEY = saved;
});

test("model mapping: tiers land on the right Kimi models, kimi names pass through", () => {
  delete process.env.KIMI_CHAT_MODEL;
  delete process.env.KIMI_FAST_MODEL;
  delete process.env.KIMI_HELPER_MODEL;
  assert.equal(mapModelForKimi("claude-fable-5"), "kimi-k3");
  assert.equal(mapModelForKimi("claude-opus-4-8"), "kimi-k3");
  assert.equal(mapModelForKimi("claude-sonnet-4-6"), "kimi-k2.6");
  assert.equal(mapModelForKimi("claude-haiku-4-5-20251001"), "kimi-k2.6");
  assert.equal(mapModelForKimi("kimi-k2.7-code"), "kimi-k2.7-code");
  assert.equal(mapModelForKimi(""), "kimi-k3");
});

test("model mapping honours env overrides", () => {
  process.env.KIMI_CHAT_MODEL = "kimi-k3-max";
  assert.equal(mapModelForKimi("claude-fable-5"), "kimi-k3-max");
  delete process.env.KIMI_CHAT_MODEL;
});

test("sanitizeParamsForKimi strips Anthropic-only fields, keeps cache_control", () => {
  const params = {
    model: "claude-fable-5",
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
    max_tokens: 1024,
  };
  sanitizeParamsForKimi(params);
  assert.equal(params.betas, undefined);
  assert.equal(params.fallbacks, undefined);
  assert.equal(params.thinking, undefined);
  assert.equal(params.output_config, undefined);
  assert.equal(params.system[0].cache_control.type, "ephemeral");
  assert.equal(params.max_tokens, 1024);
});

test("kimi base URL defaults to the Moonshot Anthropic endpoint", () => {
  delete process.env.MOONSHOT_BASE_URL;
  assert.equal(kimiBaseURL(), "https://api.moonshot.ai/anthropic");
});
