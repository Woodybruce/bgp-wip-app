// The app's draft of why a red flag can be set aside (Woody, 24 November 2026:
// "can you get the app to review and put a suggestions of why can set aside
// these flags in this box?"). Source guards; the rules are tested in
// server/flag-set-aside.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the draft is the officers', read on the server, and saves nothing", () => {
  const deal = read("server/deal-party-aml.ts");
  const at = deal.indexOf('router.post("/api/deals/:id/red-flags/suggest"');
  assert.ok(at > 0);
  assert.match(deal.slice(at, at + 300), /const me = await decider\(req\);/);
  const client = read("server/client-kyc.ts");
  const c = client.indexOf('clientKycRouter.post("/api/client-kyc/:companyId/subjects/:entity/red-flags/suggest"');
  assert.ok(c > 0);
  assert.match(client.slice(c, c + 400), /const me = await decider\(req\);/);
  const s = read("server/flag-set-aside.ts");
  // The flag is read again here, never taken from the request.
  assert.match(s, /const flag = live\.find\(f => f\.key === input\.key\);/);
  // A flag a person must check is never drafted, before any call is made.
  assert.ok(s.indexOf("setAsideNeedsPerson(flag)") < s.indexOf("deps.ask || askAnthropic"));
  // Anthropic, called directly, one forced tool, capped a day; nothing is written.
  assert.match(s, /tool_choice: \{ type: "tool", name: SET_ASIDE_SUGGEST_TOOL\.name \}/);
  assert.match(s, /claimDailyRead\(USAGE_KEY, setAsideSuggestDailyCap\(\)\)/);
  assert.doesNotMatch(s, /\b(INSERT|UPDATE|DELETE)\b/);
});

test("the box asks for the draft when it opens, fills it, and Set aside stays the only save", () => {
  const ui = read("client/src/components/aml-red-flags.tsx");
  assert.match(ui, /\/suggest`, \{ role, key: flag\.key \}/);
  assert.match(ui, /onSuccess: \(r\) => \{ if \(r\.comment && !typed\) setComment\(r\.comment\); \}/);
  // The set-aside is sent only from its own button.
  assert.equal((ui.match(/save\.mutate\(\)/g) || []).length, 1);
  assert.match(ui, /onClick=\{\(\) => save\.mutate\(\)\} data-testid="button-kyc-flag-set-aside-save"/);
});
