// The app's draft of why a red flag can be set aside (Woody, 24 November 2026:
// "can you get the app to review and put a suggestions of why can set aside
// these flags in this box?"). Rules: shared/flag-set-aside.ts; reader:
// server/flag-set-aside.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkSetAsideSuggestion, flagFindings, setAsideNeedsPerson, setAsideSuggestMessage, setAsideSuggestSystem,
} from "../shared/flag-set-aside";
import { suggestSetAside } from "./flag-set-aside";
import type { KycRedFlag } from "../shared/kyc-red-flags";

// Berkeley Group PLC's adverse media, as the checks before asking raised it on 24 November 2026.
const berkeley: KycRedFlag = {
  kind: "web_adverse",
  label: "Adverse media about BERKELEY GROUP PLC(THE)",
  detail: "The CMA investigated The Berkeley Group plc and six other housebuilders over suspected exchanges of competitively sensitive information.",
  source: "BGP's checks before asking: web search",
  at: "2025-10-30",
  key: "web:adverse_media:berkeley group plc the",
  evidence: ["url:https://www.gov.uk/cma-cases/x", "url:https://www.berkeleygroup.co.uk/report", "url:https://www.financeuncovered.org/stories/y"],
  facts: [
    { label: "What the source says", value: "The CMA investigated The Berkeley Group plc and six other housebuilders over suspected exchanges of competitively sensitive information. Berkeley and the other companies offered binding commitments, including a combined £100 million contribution to affordable housing programmes." },
    { label: "Source", value: "Competition and Markets Authority (CMA), 2025-10-30", url: "https://www.gov.uk/cma-cases/x" },
    { label: "What the source says", value: "The company's annual report says a £125,000 contribution was made to Kent Wildlife Trust under an enforcement undertaking accepted by the Environment Agency in October 2025." },
    { label: "Source", value: "The Berkeley Group Holdings plc annual report 2026, 2025-10", url: "https://www.berkeleygroup.co.uk/report" },
    { label: "What the source says", value: "A report described allegations made by Berkeley's former finance director in a lawsuit, including bribery and corporate tax evasion. It also reported that Berkeley denied the allegations, an independent investigation concluded they were unfounded, the allegations were withdrawn in a settlement." },
    { label: "Source", value: "Finance Uncovered, 2018-11-22", url: "https://www.financeuncovered.org/stories/y" },
  ],
};

test("a flag's findings are numbered: the source's words with its source and date", () => {
  const f = flagFindings(berkeley);
  assert.equal(f.length, 3);
  assert.match(f[0], /^What the source says: The CMA investigated/);
  assert.match(f[0], /Source: Competition and Markets Authority \(CMA\), 2025-10-30 \(https:\/\/www\.gov\.uk\/cma-cases\/x\)/);
  assert.match(f[2], /Finance Uncovered, 2018-11-22/);
  // ComplyAdvantage: each matched profile is a finding, its articles with it.
  const ca = flagFindings({ detail: null, facts: [
    { label: "Matched profile: adverse media", value: "jane smith · listed in Media · match 92%" },
    { label: "Article", value: "Smith fined, 2021", url: "https://news.example/a" },
    { label: "Matched profile: public role", value: "jane smith · listed in UK PEPs · match 70%" },
  ] });
  assert.equal(ca.length, 2);
  assert.match(ca[0], /Article: Smith fined, 2021/);
  // With no facts, the detail is the one finding.
  assert.deepEqual(flagFindings({ detail: "Liquidation", facts: [] }), ["Liquidation"]);
});

test("a flag a person must check gets no draft, and says what to do", () => {
  assert.match(setAsideNeedsPerson({ kind: "sanctions", evidence: [] })!, /sanctions match is set aside only once a person/);
  assert.match(setAsideNeedsPerson({ kind: "provider_screen", evidence: ["type:sanctions"] })!, /Nominated Officer/);
  assert.match(setAsideNeedsPerson({ kind: "client_pep", evidence: [] })!, /their own answer/);
  assert.match(setAsideNeedsPerson({ kind: "id_declined", evidence: [] })!, /Veriff/);
  assert.equal(setAsideNeedsPerson({ kind: "web_adverse", evidence: [] }), null);
  assert.equal(setAsideNeedsPerson({ kind: "provider_screen", evidence: ["type:adverse_media"] }), null);
  assert.equal(setAsideNeedsPerson({ kind: "policy_sector", evidence: [] }), null);
});

test("the reader is told what bears on money laundering risk, to use only the facts, and to write plainly", () => {
  const sys = setAsideSuggestSystem();
  assert.match(sys, /Money Laundering Regulations 2017/);
  assert.match(sys, /Use only the facts given here/);
  assert.match(sys, /withdrawn, dismissed or found unfounded/);
  assert.match(sys, /at most 80 words/);
  const msg = setAsideSuggestMessage(berkeley, flagFindings(berkeley), ["Listed: Owned through The Berkeley Group Holdings Plc, which is listed on a UK regulated market"]);
  assert.match(msg, /<findings>\n1\. What the source says: The CMA/);
  assert.match(msg, /<about_the_subject>\nListed: /);
  assert.doesNotMatch(setAsideSuggestMessage({ ...berkeley, label: "<script>" }, ["x"], []), /<script>/);
});

test("the reader's answer is checked: a verdict it may give, plain words, never set aside with a finding it calls relevant", () => {
  const ok = checkSetAsideSuggestion({
    verdict: "set_aside",
    findings: [{ n: 1, relevant: false, why: "CMA case closed with commitments" }, { n: 2, relevant: false, why: "environmental" }, { n: 9, relevant: true, why: "out of range" }],
    comment: "- The CMA case on information exchange closed with commitments and no finding of financial crime. The Environment Agency undertaking concerns silt discharges. The 2018 allegations were withdrawn and found unfounded.",
  }, 3);
  assert.equal(ok.verdict, "set_aside");
  assert.equal(ok.findings.length, 2, "a finding the flag does not have is dropped");
  assert.match(ok.comment, /^The CMA case/, "a bullet is taken off");
  assert.equal(ok.unavailable, null);
  // The reader calls a finding relevant but says set aside: look closer.
  assert.equal(checkSetAsideSuggestion({ verdict: "set_aside", findings: [{ n: 1, relevant: true, why: "bribery" }], comment: "Nothing to see here at all, set it aside." }, 1).verdict, "look_closer");
  // No verdict, or a draft too short to save, is no draft.
  assert.equal(checkSetAsideSuggestion({ verdict: "maybe", comment: "x" }, 1).verdict, null);
  assert.match(checkSetAsideSuggestion({ verdict: "keep", findings: [], comment: "Bad." }, 1).unavailable!, /too short/);
  // A long draft is cut to about 100 words, on a sentence where one ends.
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  assert.ok(checkSetAsideSuggestion({ verdict: "keep", findings: [], comment: long }, 1).comment.split(" ").length <= 100);
});

test("the draft: the flag is read on the server, a person's check is never drafted, the allowance is kept", async () => {
  const flags = async () => ({ parties: { b1: [berkeley, { ...berkeley, kind: "sanctions" as const, key: "sanctions:x", label: "Possible match on the UK Sanctions List" }] }, deal: [], unchecked: [], levels: {} } as any);
  let asked: string | null = null;
  const deps = {
    flags, hasKey: () => true, claim: async () => true, about: async () => ["Listed: through The Berkeley Group Holdings Plc"],
    ask: async (_s: string, m: string) => { asked = m; return { input: { verdict: "set_aside", findings: [{ n: 1, relevant: false, why: "competition law" }], comment: "The CMA matter closed with commitments; no finding of financial crime. The other two are an environmental undertaking and withdrawn allegations." }, model: "test" }; },
  };
  const r = await suggestSetAside({ dealId: "d1", brandId: "b1", entityId: null, key: berkeley.key }, deps);
  assert.equal(r.verdict, "set_aside");
  assert.match(r.comment, /CMA matter closed/);
  assert.match(asked!, /Finance Uncovered/);
  assert.match(asked!, /The Berkeley Group Holdings Plc/);
  // A sanctions match: no draft and no call.
  asked = null;
  const s = await suggestSetAside({ dealId: "d1", brandId: "b1", entityId: null, key: "sanctions:x" }, deps);
  assert.equal(s.verdict, null);
  assert.match(s.unavailable!, /sanctions match/);
  assert.equal(asked, null);
  // A flag that is not there any more is refused.
  await assert.rejects(suggestSetAside({ dealId: "d1", brandId: "b1", entityId: null, key: "gone" }, deps), /not there any more/);
  // Today's allowance used: the officer writes it.
  const used = await suggestSetAside({ dealId: "d1", brandId: "b1", entityId: null, key: berkeley.key }, { ...deps, claim: async () => false });
  assert.match(used.unavailable!, /allowance/);
  // No key: the reader is off.
  const off = await suggestSetAside({ dealId: "d1", brandId: "b1", entityId: null, key: berkeley.key }, { ...deps, hasKey: () => false });
  assert.match(off.unavailable!, /not switched on/);
});
