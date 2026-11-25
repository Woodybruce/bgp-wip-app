// A past KYC4U sign-off records its due diligence (Woody, 25 November 2026, on
// Sheet Anchor Evolve: signed off 24 Feb 2025 and read as expired a year on).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the sign-off stores its re-check years, standard (3) unless enhanced is chosen", () => {
  const s = read("server/kyc4u.ts");
  assert.match(s, /const years = Number\(req\.body\?\.recheckYears\) === 1 \? 1 : 3;/);
  assert.match(s, /"Re-check years": years/);
  const panel = read("client/src/components/kyc4u-panel.tsx");
  assert.match(panel, /recheckYears: years/);
  assert.match(panel, /data-testid="kyc4u-signoff-until"/);
});
