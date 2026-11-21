// The SRA's own data for the solicitors check (Woody, 21 November 2026: "ive
// done the solcitors api btw"). Source guards; the rules are tested in
// server/sra-register.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the SRA key is read in one place and sent only to the SRA's own host, never logged", () => {
  const s = read("server/sra-register.ts");
  assert.match(s, /process\.env\.SRA_API_KEY/);
  assert.match(s, /fetch\(SRA_DATASHARE_URL, \{\s*headers: \{ "Ocp-Apim-Subscription-Key": key,/);
  assert.match(read("shared/sra-register.ts"), /export const SRA_DATASHARE_HOST = "sra-prod-apim\.azure-api\.net";/);
  for (const line of s.split("\n").filter(l => /console\./.test(l))) assert.doesNotMatch(line, /\bkey\b/, line.trim());
  const readers = readdirSync(new URL("../../server/", import.meta.url)).filter(f => f.endsWith(".ts") && read(`server/${f}`).includes("SRA_API_KEY"));
  assert.deepEqual(readers.sort(), ["integrations-status.ts", "sra-register.ts"]);
});

test("the SRA's data is read at most once a day, on use, never at boot or on a timer", () => {
  const s = read("server/sra-register.ts");
  assert.match(s, /if \(held && Date\.now\(\) - Date\.parse\(held\.readAt\) < DAY_MS\) return held;/);
  assert.match(s, /RETRY_AFTER_FAILURE_MS = 10 \* 60 \* 1000/);
  assert.doesNotMatch(s, /setInterval/);
  assert.doesNotMatch(read("server/index.ts"), /sra-register/);
});

test("a name that matches several entries asks which firm before anything runs", () => {
  const s = read("server/solicitor-aml.ts");
  const route = s.slice(s.indexOf('router.post("/api/deals/:id/solicitors-aml/check"'));
  assert.ok(route.indexOf("solicitorChoices(firm, sraNumber)") > 0);
  assert.ok(route.indexOf("solicitorChoices(firm, sraNumber)") < route.indexOf("runSolicitorCheck(firm, { sraNumber, noneOfThese })"));
  assert.match(route, /if \(choices\) return res\.json\(\{ choose: true, firm, \.\.\.choices \}\);/);
  // Without the key, or when the SRA's data cannot be read, the register is searched on the web as before.
  assert.match(s, /searchDomains: SOLICITOR_REGISTER_SITES/);
});

test("where the SRA's data is used, the app says it includes data supplied by the SRA, with a link", () => {
  const shared = read("shared/sra-register.ts");
  assert.match(shared, /SRA_ATTRIBUTION_URL = "https:\/\/www\.sra\.org\.uk\/sra\/how-we-work\/privacy-data-information\/data-sharing\/attribution\/"/);
  assert.match(shared, /SRA_ATTRIBUTION_WORDS = "ChatBGP includes data supplied by the Solicitors Regulation Authority"/);
  const panel = read("client/src/components/solicitor-aml.tsx");
  assert.match(panel, /<a href=\{SRA_ATTRIBUTION_URL\}[^>]*>\{SRA_ATTRIBUTION_WORDS\}<\/a>/);
  assert.match(read("shared/aml-risk-assessment.ts"), /label: "Source of the SRA data", value: `\$\{SRA_ATTRIBUTION_WORDS\} \(\$\{SRA_ATTRIBUTION_URL\}\)`/);
});
