import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { hasGlobalAiKey } from "./utils/ai-provider";

const source = readFileSync(new URL("./news-brand-linking.ts", import.meta.url), "utf8");
const start = source.indexOf("async function classifySignal(");
const end = source.indexOf("\nconst BRAND_CATEGORY_PREFIX", start);
assert.ok(start >= 0 && end > start);
const classifyFactory = new Function("hasGlobalAiKey", "callClaude", "safeParseJSON", "CHATBGP_HELPER_MODEL",
  ts.transpileModule(`${source.slice(start, end)}\nreturn classifySignal;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText);

test("brand signal extraction uses the selected provider key, including OpenAI without Anthropic", async () => {
  const keys = ["AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_API_KEY", "MOONSHOT_API_KEY"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
    let calls = 0;
    const classify = classifyFactory(hasGlobalAiKey, async () => {
      calls++;
      return { choices: [{ message: { content: '{"aboutBrand":true,"signalType":"opening","magnitude":"small","sentiment":"positive"}' } }] };
    }, JSON.parse, "helper-test");
    assert.deepEqual(await classify("Example", "New Example store opens", null), {
      aboutBrand: true, signalType: "opening", magnitude: "small", sentiment: "positive",
    });
    assert.equal(calls, 1);
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "unused-test-key";
    assert.equal(await classify("Example", "No selected provider key", null), null);
    assert.equal(calls, 1);
    assert.match(source.slice(source.indexOf("export async function backfillSignalClassifications")), /if \(!hasGlobalAiKey\(\)\) return \{ scanned: 0, reclassified: 0, skipped: 0 \}/);
  } finally {
    for (const key of keys) {
      if (saved[key] == null) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
