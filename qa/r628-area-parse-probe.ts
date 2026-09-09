// Proof for the Pathway area fix. A Stage 1 size fact is free text; the old
// derivation stripped every non-digit and parsed what was left, which glues
// several figures into one nonsense number. The real "50 St James's Street"
// model came out with a lettable area of 3,938,925,424,496,572,000 sq ft,
// which drove the per-sq-ft OpEx line and poisoned every number in it.
//
// Run: npx tsx qa/r628-area-parse-probe.ts
// Also runs as one check inside qa/run-smoke.sh via qa/smoke.mjs.
import { parseSizeSqFt, MAX_PLAUSIBLE_SQFT } from "@shared/size-parse";

// What the code did before this fix.
function oldParse(raw: unknown): number | null {
  const parsed = parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

const cases: Array<{ input: string; expect: number | null; why: string }> = [
  { input: "31,384 sq ft", expect: 31384, why: "the documented happy path" },
  { input: "8500", expect: 8500, why: "a bare number" },
  { input: "3,938 sq ft (925 sq m)", expect: 3938, why: "a bracketed sq m conversion must not be glued on" },
  { input: "3,938 sq ft; 925,424 sq ft; 496,572 sq ft", expect: 3938, why: "several figures must not concatenate" },
  { input: "12,000-15,000 sq ft", expect: 12000, why: "a range takes its first figure" },
  { input: "approx. 1,600,000 sq ft", expect: 1600000, why: "a big-but-real centre" },
  { input: "3938925424496572000", expect: null, why: "the value from Woody's real workbook is refused" },
  { input: "40 sq ft", expect: null, why: "implausibly small is refused" },
  { input: "no size stated", expect: null, why: "no figure at all" },
  { input: "", expect: null, why: "empty" },
];

let fails = 0;
for (const c of cases) {
  const got = parseSizeSqFt(c.input);
  const ok = got === c.expect;
  if (!ok) fails++;
  const before = oldParse(c.input);
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${JSON.stringify(c.input)} -> ${got} (expected ${c.expect}) — ${c.why}` +
      (before !== got ? `  [old code gave ${before}]` : ""),
  );
}

// The regression that matters: the old parser produced the poisoned value from
// text a real property record can plausibly hold.
const glued = oldParse("3,938 sq ft; 925,424 sq ft; 496,572 sq ft");
const oldGluedOk = glued !== null && glued > MAX_PLAUSIBLE_SQFT;
if (!oldGluedOk) fails++;
console.log(
  `${oldGluedOk ? "  ok  " : "  FAIL"} the old parser really did glue digits into an implausible area — ${glued}`,
);

console.log(`\n── r628 area parse: ${fails ? `${fails} FAILURE(S)` : "all green"} ──`);
process.exit(fails ? 1 : 0);
