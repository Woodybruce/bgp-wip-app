// Fable's written view of a party's AML file (Woody, 24 November 2026: "an AI
// led commentary with fable 5 giving a proper view on whats been found and
// given to date and the risk profile given the rules"). Source guards: the
// model and its request, who may ask, the allowance, the AML file printing
// the view first, and the AML box leading with it. Unit tests:
// server/aml-commentary.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const server = read("server/aml-commentary.ts");

test("the view is written by Fable 5.2 with the refusal fallback, structured output and no forced tool", () => {
  assert.match(server, /export const COMMENTARY_MODEL = "claude-fable-5-2";/);
  assert.match(server, /betas: \["server-side-fallback-2026-07-01"\],\s*fallbacks: "default",/);
  assert.match(server, /output_config: \{ effort: "high", format: \{ type: "json_schema", schema: COMMENTARY_SCHEMA \} \}/);
  assert.match(server, /\.beta\.messages\.create\(params/);
  assert.doesNotMatch(server, /tool_choice/, "Fable 5.2 refuses a forced tool");
  assert.doesNotMatch(server, /temperature|budget_tokens/, "Fable 5.2 refuses sampling settings and thinking budgets");
  assert.match(server, /if \(response\.stop_reason === "refusal"\) return \{ input: null, refused: true/);
  assert.match(server, /AML_COMMENTARY_DAILY_CAP/);
  assert.match(server, /claimDailyRead\(USAGE_KEY, commentaryDailyCap\(\)\)/);
  assert.match(server, /logAiUsage\(\{ provider: "anthropic", model: asked\.model, feature: FEATURE/);
});

test("BGP staff only, signed in as themselves, on both routes; kept against the facts it was written from", () => {
  for (const route of ['router.get("/api/deals/:id/aml-commentary"', 'router.post("/api/deals/:id/aml-commentary"']) {
    const at = server.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(server.slice(at, at + 300), /const me = await staff\(req\);\s*if \(!me\) return res\.status\(403\)/);
  }
  assert.match(server, /if \(!\(await contactViewer\(req\)\)\.staff\) return null;/);
  assert.match(server, /if \(existing && existing\.hash === hash && !opts\.again\) return reply\(existing, hash, true, null\);/);
  assert.match(read("server/index.ts"), /app\.use\(amlFileRouter\);\n  app\.use\(amlCommentaryRouter\);/);
  assert.match(read("server/index.ts"), /CREATE TABLE IF NOT EXISTS aml_risk_commentaries/);
});

test("the AML file prints a current view first, and the AML box leads with it, the record folded under it", () => {
  const file = read("server/aml-file.ts");
  assert.match(file, /if \(p\.commentary\) writeCommentary\(w, p\.commentary\);\n  if \(p\.riskAssessment\) \{/);
  assert.match(file, /m\.currentCommentary\(dealId, p\.role, ra\)/);
  const box = read("client/src/components/deal-aml-status.tsx");
  assert.match(box, /<AmlCommentaryView dealId=\{dealId\} role=\{role\} \/>/);
  assert.match(box, /\{showRecord && <PartyRiskRecord dealId=\{dealId\} role=\{role\} \/>\}/);
  const view = read("client/src/components/aml-commentary.tsx");
  assert.match(view, /It gives a view; it decides nothing\./);
  assert.match(view, /data\.commentary \|\| !data\.canWrite\) return;/, "written by itself only when there is none yet");
});
