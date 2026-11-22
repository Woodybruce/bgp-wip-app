// BGP's AML rules in short, checked against HMRC every three months (Woody,
// 22 November 2026). Source guards; the rules are tested in server/aml-rules.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('the check reads GOV.UK only: no AI, and it never changes the rules', () => {
  const s = read('server/aml-rules.ts');
  assert.match(s, /const CONTENT_API = "https:\/\/www\.gov\.uk\/api\/content";/);
  assert.doesNotMatch(s, /anthropic|openai|perplexity|callClaude/i);
  assert.doesNotMatch(s, /writeFile|AML_RULES\s*=/);
});

test('it runs on the 2nd of January, April, July and October, and HMRC_RULES_CHECK=off stops it', () => {
  const index = read('server/index.ts');
  assert.match(index, /\{ key: "aml-rules-hmrc", due: \(now\) => \[1, 4, 7, 10\]\.includes\(Number\(now\.month\.slice\(5\)\)\) \? monthlyAt\(2, 6, 40\)\(now\) : null, run: \(\) =>\s*import\("\.\/aml-rules"\)\.then\(m => m\.quarterlyHmrcRulesCheck\(\)\) \},/);
  assert.match(index, /app\.use\(amlRulesRouter\);/);
  assert.match(read('server/aml-rules.ts'), /if \(!hmrcRulesCheckOn\(\)\) \{/);
});

test('every BGP person reads the rules; only the officers check now or mark them reviewed', () => {
  const s = read('server/aml-rules.ts');
  const get = s.slice(s.indexOf('router.get("/api/aml-rules"'), s.indexOf('router.post("/api/aml-rules/check"'));
  assert.match(get, /if \(!\(await staffMe\(req\)\)\) return res\.status\(403\)/);
  for (const route of ['router.post("/api/aml-rules/check"', 'router.post("/api/aml-rules/reviewed"']) {
    const body = s.slice(s.indexOf(route), s.indexOf(route) + 700);
    assert.match(body, /if \(!actor\.isMlro\) return res\.status\(403\)/, route);
  }
});

test('the officers are emailed once for the same changes', () => {
  const s = read('server/aml-rules.ts');
  assert.match(s, /if \(\(await readSetting<string>\(EMAILED_KEY\)\) === key\) return;/);
  assert.match(s, /if \(sent\.ok\) await writeSetting\(EMAILED_KEY, key\);/);
});

test('the Rules pill is on the AML page for everyone', () => {
  const page = read('client/src/pages/aml-dashboard.tsx');
  assert.match(page, /\{ key: "rules", label: "Rules" \},/);
  assert.match(page, /\{shownSection === "rules" && <AmlRulesBoard \/>\}/);
});
