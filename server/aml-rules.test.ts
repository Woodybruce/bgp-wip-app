// BGP's AML rules in short and the quarterly HMRC check (22 November 2026):
// shared/aml-rules.ts and server/aml-rules.ts.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import { AML_RULES, HMRC_AML_MANUAL, HMRC_AML_PAGES, hmrcChangesKey, hmrcChangesSince, nextHmrcCheck, rulesHmrcPages, type HmrcRulesCheck } from "../shared/aml-rules";
import { readHmrcPages } from "./aml-rules";
import { amlRulesChangedEmail } from "../shared/kyc-request";

test("every rule is short, plain and names where it comes from", () => {
  const padding = /\b(ensure|robust|leverag|comprehensive|seamless|utili[sz]e|crucial|delve|holistic|streamline|in order to|it is important)\b/i;
  for (const group of AML_RULES) {
    assert.ok(group.rules.length > 0, group.title);
    for (const rule of group.rules) {
      assert.ok(rule.refs.length > 0, rule.text);
      assert.ok(rule.text.split(/\s+/).length <= 30, `too long: ${rule.text}`);
      assert.doesNotMatch(rule.text, padding, rule.text);
    }
  }
  // The joint agent rule says what HMRC's estate agency guidance (section 21) says,
  // and only for sales: the letting guidance (AMLG2300) has no such exception, so
  // a tenant the other agent found is checked, or relied on under a reliance agreement.
  const joint = AML_RULES.find(g => g.title === "Joint agents")!;
  const sales = joint.rules.find(r => /ask them for their checks/.test(r.text) && /record that you asked/.test(r.text))!;
  assert.match(sales.text, /^Sales:/);
  assert.doesNotMatch(sales.text, /tenant/);
  assert.deepEqual(sales.refs, ["amlg2200"]);
  const lettings = joint.rules.find(r => /^Lettings:/.test(r.text))!;
  assert.match(lettings.text, /reliance agreement/);
  assert.ok(lettings.refs.includes("amlg2300") && lettings.refs.includes("amlg11410"));
  // Registration with HMRC is a condition of working with an agent, not a reason to skip checks.
  assert.ok(joint.rules.some(r => /registered with HMRC/.test(r.text) && /tell HMRC/.test(r.text)));
});

test("the cited HMRC pages are the ones the check reads", () => {
  const pages = rulesHmrcPages();
  assert.ok(pages.includes("amlg2200") && pages.includes("amlg2300") && pages.includes("amlg11700"));
  for (const p of pages) assert.ok(p in HMRC_AML_PAGES);
});

test("the check reads GOV.UK's page dates and the manual's change notes", async () => {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    if (url.endsWith(HMRC_AML_MANUAL)) {
      return { details: { change_notes: [
        { base_path: `${HMRC_AML_MANUAL}/amlg2300`, change_note: "Threshold wording updated", published_at: "2027-02-03T00:00:00Z", title: "Letting" },
        { base_path: `${HMRC_AML_MANUAL}/amlg9999`, change_note: "Not a page we cite", published_at: "2027-02-03T00:00:00Z", title: "Other" },
        { base_path: HMRC_AML_MANUAL, change_note: "Addition of link to accountancy sector guidance", published_at: "2026-10-13T00:00:00Z", title: "Manual" },
      ] } };
    }
    if (url.endsWith("/amlg11410")) throw new Error("GOV.UK answered 503");
    return { title: "A page", public_updated_at: url.endsWith("/amlg2300") ? "2027-02-03T09:00:00+00:00" : "2026-07-08T01:00:00+01:00" };
  };
  const check = await readHmrcPages(get);
  assert.ok(asked[0].startsWith("https://www.gov.uk/api/content/"));
  assert.equal(check.notes.length, 2, "a note about a page the rules do not cite is left out");
  assert.deepEqual(check.failed, ["amlg11410"]);
  assert.match(String(check.error), /1 of \d+ HMRC pages could not be read/);
  const changes = hmrcChangesSince(check, null);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].page, "amlg2300");
  assert.equal(changes[0].note, "Threshold wording updated");
  // Reviewed after the change: nothing to show.
  assert.deepEqual(hmrcChangesSince(check, { at: "2027-02-10T10:00:00Z", byName: "Jack Barratt", note: null }), []);
});

test("changes are counted from the last review, or from the day the rules were written", () => {
  const check: HmrcRulesCheck = {
    checkedAt: "2027-01-02T06:40:00Z", failed: [], error: null,
    pages: [{ page: "amlg2200", title: "Estate", updatedAt: "2026-11-21T10:00:00Z" }, { page: "amlg11700", title: "Records", updatedAt: "2026-12-01T10:00:00Z" }],
    notes: [{ page: null, title: "Manual", note: "New section", at: "2026-12-05T00:00:00Z" }],
  };
  const changes = hmrcChangesSince(check, null, "2026-11-22");
  assert.deepEqual(changes.map(c => c.page), [null, "amlg11700"]);
  assert.equal(changes[0].label, "The whole manual");
  assert.deepEqual(hmrcChangesSince(check, { at: "2026-12-02T00:00:00Z", byName: null, note: null }, "2026-11-22").map(c => c.page), [null]);
  assert.equal(hmrcChangesKey(changes), hmrcChangesKey([...changes].reverse()));
});

test("the check runs on the 2nd of January, April, July and October", () => {
  assert.equal(nextHmrcCheck("2026-11-22"), "2027-01-02");
  assert.equal(nextHmrcCheck("2027-01-01"), "2027-01-02");
  assert.equal(nextHmrcCheck("2027-01-02"), "2027-04-02");
  assert.equal(nextHmrcCheck("2027-03-30"), "2027-04-02");
  assert.equal(nextHmrcCheck("2027-10-03"), "2028-01-02");
});

test("the officers' email lists each change plainly", () => {
  const email = amlRulesChangedEmail({ changes: [{ label: "AMLG2300 Letting agents", at: "2027-02-03T09:00:00Z", note: "Threshold <wording> updated" }], error: null, link: "https://chatbgp.app/deals/aml?section=rules", sentFrom: "kyc@chatbgp.app" });
  assert.equal(email.subject, "AML: HMRC has changed its guidance");
  assert.match(email.html, /AMLG2300 Letting agents, updated 3 Feb 2027: Threshold &lt;wording&gt; updated/);
  assert.match(email.html, /deals\/aml\?section=rules/);
  const failed = amlRulesChangedEmail({ changes: [], error: "GOV.UK did not answer", link: "x", sentFrom: "y" });
  assert.equal(failed.subject, "AML: HMRC's guidance could not be checked");
});
