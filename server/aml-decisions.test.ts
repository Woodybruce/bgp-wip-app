// The AML decisions log (Jack, 23 November 2026): every entry is dated, names
// who decided, and reads plainly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AML_DECISIONS, AML_DECISION_PEOPLE, AML_DECISION_TOPICS, amlDecisionsNewestFirst } from "@shared/aml-decisions";

test("every entry has a real date, a person, a topic, a title and a short plain rule", () => {
  assert.ok(AML_DECISIONS.length >= 50);
  const seen = new Set<string>();
  for (const e of AML_DECISIONS) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.title);
    assert.ok(Number.isFinite(Date.parse(`${e.date}T12:00:00Z`)), e.title);
    assert.ok(e.who.length && e.who.every(w => (AML_DECISION_PEOPLE as readonly string[]).includes(w)), e.title);
    assert.ok((AML_DECISION_TOPICS as readonly string[]).includes(e.topic), e.title);
    assert.ok(e.title.length >= 8 && e.title.length <= 80, e.title);
    assert.ok(e.text.split(/\s+/).length <= 70, `${e.title}: keep it short`);
    for (const words of [e.text, e.title, e.changed || ""]) {
      assert.doesNotMatch(words, /\u2014|\bensure\b|\brobust\b|\bleverage\b|\bseamless/i, e.title);
      assert.doesNotMatch(words.replace(/"deal"/g, ""), /\bdeals?\b/i, `${e.title}: say transaction`);
    }
    const key = `${e.date}|${e.title}`;
    assert.ok(!seen.has(key), `twice: ${key}`);
    seen.add(key);
  }
});

test("the log is written and served newest first, and a replaced rule says what replaced it", () => {
  const dates = AML_DECISIONS.map(e => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "new entries go at the top");
  assert.deepEqual(amlDecisionsNewestFirst().map(e => e.title), AML_DECISIONS.map(e => e.title));
  const trusts = AML_DECISIONS.find(e => e.title === "Trusts to KYC4U in full");
  assert.match(trusts?.changed || "", /23 November 2026/);
  assert.ok(AML_DECISIONS.some(e => e.title === "Who can certify a copy" && /chartered accountant/.test(e.text)));
});

test("the log is served to BGP staff only and is not bundled into the client", () => {
  const s = readFileSync("server/aml-rules.ts", "utf8");
  const route = s.slice(s.indexOf('router.get("/api/aml-decisions"'), s.indexOf('router.get("/api/aml-rules"'));
  assert.match(route, /if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  const board = readFileSync("client/src/components/aml-decisions.tsx", "utf8");
  assert.match(board, /import type \{ AmlDecision \} from "@shared\/aml-decisions"/);
  assert.doesNotMatch(board, /import \{[^}]*\} from "@shared\/aml-decisions"/);
  assert.match(readFileSync("CLAUDE.md", "utf8"), /shared\/aml-decisions\.ts/);
});
