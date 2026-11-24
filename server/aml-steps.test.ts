// One rule for the four steps' lines, for every AML screen (Woody, 24 November
// 2026: "can we use this as the template and make them match?", "one build for AML").
import test from "node:test";
import assert from "node:assert/strict";
import {
  AFTER_COMPANY, amlNextTone, companyStepLine, documentsStepLine, sanctionsStepLine, screeningStepLine, signOffStepLine,
  type SignOffStepFacts,
} from "../shared/aml-steps";

test("the company: not set, still to sort, or done; a register warning is red", () => {
  assert.deepEqual(companyStepLine({ missing: true }), { state: "todo", words: "Not set" });
  assert.deepEqual(companyStepLine({ missing: false, gaps: ["who to ask not set"], notes: ["owned from abroad"] }),
    { state: "todo", words: "who to ask not set · owned from abroad" });
  assert.deepEqual(companyStepLine({ missing: false, notes: ["ask Jane Smith"] }), { state: "done", words: "ask Jane Smith" });
  assert.deepEqual(companyStepLine({ missing: false, kind: "a person" }), { state: "done", words: "a person" });
  assert.equal(companyStepLine({ missing: false, warning: "Dissolved on 3 March 2025. Do not proceed." }).state, "flag");
  assert.equal(companyStepLine({ missing: false }).words, "Set");
});

test("screening: a red flag first, then where the run stands, then clear in the client window's words", () => {
  const base = { run: "done" as const, ranAt: "2026-11-23T10:00:00Z", redFlags: [] as string[], attention: 0 };
  assert.deepEqual(screeningStepLine(base), { state: "done", words: "Checked 23 Nov 2026 · no red flags" });
  assert.deepEqual(screeningStepLine({ ...base, redFlags: ["Possible match on the UK Sanctions List", "Adverse media"] }),
    { state: "flag", words: "2 red flags: Possible match on the UK Sanctions List" });
  assert.deepEqual(screeningStepLine({ ...base, run: "needs_company" }), { state: "todo", words: AFTER_COMPANY, pending: true });
  assert.deepEqual(screeningStepLine({ ...base, run: "running" }), { state: "todo", words: "Running now", pending: true });
  assert.deepEqual(screeningStepLine({ ...base, run: "none" }), { state: "todo", words: "Not run yet", pending: true });
  // A run that did not finish, or a list that did not screen everyone, is never clear.
  assert.equal(screeningStepLine({ ...base, run: "unfinished" })!.pending, undefined);
  assert.equal(screeningStepLine({ ...base, failed: "sanctions" })!.words, "Sanctions lists not read: run again");
  assert.equal(screeningStepLine({ ...base, failed: "provider" })!.words, "ComplyAdvantage didn't screen everyone");
  assert.deepEqual(screeningStepLine({ ...base, attention: 2 }), { state: "todo", words: "2 to look at" });
  assert.equal(screeningStepLine({ ...base, enhanced: true, setAside: 1, unread: true })!.words,
    "Checked 23 Nov 2026 · no red flags · higher risk · 1 set aside · some records not read");
  // Checks off: the red flags alone, or nothing at all.
  assert.deepEqual(screeningStepLine({ ...base, run: "off", flagsRead: true }), { state: "done", words: "No red flags" });
  assert.equal(screeningStepLine({ ...base, run: "off" }), null);
});

test("sanctions only: a possible match is red and names the officer", () => {
  const base = { run: "done" as const, ranAt: "2026-11-23T10:00:00Z", match: false, read: true, officer: "AML Officer (Jack)" };
  assert.deepEqual(sanctionsStepLine(base), { state: "done", words: "Checked 23 Nov 2026 · no match" });
  assert.deepEqual(sanctionsStepLine({ ...base, match: true }), { state: "flag", words: "Possible match: raise with AML Officer (Jack)" });
  assert.equal(sanctionsStepLine({ ...base, read: false }).words, "Sanctions lists not read: run again");
  assert.equal(sanctionsStepLine({ ...base, run: "none" }).pending, true);
});

test("documents: the route they come by, in one line", () => {
  assert.deepEqual(documentsStepLine({ clientChecks: true }), { state: "todo", words: "Not asked yet" });
  assert.deepEqual(documentsStepLine({ clientChecks: false }), { state: "todo", words: "For the officers to sign off" });
  assert.deepEqual(documentsStepLine({ clientChecks: true, companyMissing: true }), { state: "todo", words: AFTER_COMPANY, pending: true });
  assert.equal(documentsStepLine({ clientChecks: true, sanctionsOnly: true }).words, "Not needed: sanctions checks only");
  assert.equal(documentsStepLine({ clientChecks: true, notRequired: true }).words, "Not needed");
  assert.equal(documentsStepLine({ clientChecks: true, reliance: "Savills (UK) Limited" }).words, "Relying on Savills");
  assert.deepEqual(documentsStepLine({ clientChecks: true, cleared: true }), { state: "done", words: "Not needed now: cleared" });
  const sent = { status: "sent" as const, who: "Jane Smith", sentAt: "2026-11-20T09:00:00Z" };
  assert.deepEqual(documentsStepLine({ clientChecks: true, request: sent, people: { total: 3, owing: 2 } }),
    { state: "todo", words: "Sent to Jane Smith 20 Nov 2026 · 1 of 3 people done" });
  assert.deepEqual(documentsStepLine({ clientChecks: true, request: { ...sent, status: "finished" }, people: { total: 1, owing: 0 } }),
    { state: "done", words: "From Jane Smith · all in" });
  assert.equal(documentsStepLine({ clientChecks: true, request: { ...sent, status: "not_sent" } }).words, "The client checks email didn't go");
  // A cancelled request is no request.
  assert.equal(documentsStepLine({ clientChecks: true, request: { ...sent, status: "cancelled" } }).words, "Not asked yet");
  const joint = { firm: "Knight Frank LLP", status: "in" as const, sentAt: null, who: "Tom", unread: 0, missing: 2, chasing: true, termsPending: false };
  assert.deepEqual(documentsStepLine({ clientChecks: true, joint }), { state: "todo", words: "From Knight Frank (Tom) · 2 missing · chasing" });
  assert.deepEqual(documentsStepLine({ clientChecks: true, joint: { ...joint, missing: 0 } }), { state: "done", words: "From Knight Frank (Tom) · all in" });
  assert.equal(documentsStepLine({ clientChecks: true, joint: { ...joint, status: "sent", sentAt: "2026-11-21T09:00:00Z" } }).words, "Asked Knight Frank 21 Nov 2026 · nothing back yet");
});

test("sign-off: the steps before it come first; the same company reads the same on every screen", () => {
  const base: SignOffStepFacts = {
    rejected: false, notRequired: null, approved: null, expired: null, companyMissing: false, screeningPending: false,
    documentsDone: true, decisionRead: true, blocked: null, edd: false, canDecide: false, canSignOff: true, needsNote: false,
  };
  assert.deepEqual(signOffStepLine(base), { state: "todo", words: "Ready to sign off" });
  assert.equal(signOffStepLine({ ...base, needsNote: true }).words, "Ready: sign off with a note");
  assert.equal(signOffStepLine({ ...base, canSignOff: false }).words, "Ready: for an agent or an officer");
  assert.equal(signOffStepLine({ ...base, edd: true }).words, "Ready: for an officer");
  assert.equal(signOffStepLine({ ...base, edd: true, canDecide: true }).words, "Ready: an officer signs off, with a note");
  // The client window used to say "Ready" here; both screens now wait for the documents.
  assert.deepEqual(signOffStepLine({ ...base, documentsDone: false }), { state: "todo", words: "After the documents", pending: true });
  assert.equal(signOffStepLine({ ...base, screeningPending: true }).words, "After screening");
  assert.equal(signOffStepLine({ ...base, screeningPending: true, sanctionsView: true }).words, "After the sanctions checks");
  assert.equal(signOffStepLine({ ...base, companyMissing: true }).words, AFTER_COMPANY);
  assert.equal(signOffStepLine({ ...base, blocked: "The register extract is not on file yet. Upload it under Documents." }).words, "The register extract is not on file yet");
  assert.deepEqual(signOffStepLine({ ...base, approved: { by: "Layla O'Driscoll", until: "2029-11-24T00:00:00Z" } }),
    { state: "done", words: "Cleared by Layla O'Driscoll until 24 Nov 2029" });
  assert.deepEqual(signOffStepLine({ ...base, rejected: true }), { state: "flag", words: "Rejected" });
  assert.deepEqual(signOffStepLine({ ...base, notRequired: "no transaction with this party" }), { state: "done", words: "Not required: no transaction with this party" });
  // Expired is to do again, not a red flag.
  assert.equal(signOffStepLine({ ...base, expired: { on: "2026-10-01T00:00:00Z" } }).state, "todo");
});

test("one set of Next colours for both rules", () => {
  assert.equal(amlNextTone("done"), "ok");
  assert.equal(amlNextTone("flag"), "bad");
  assert.equal(amlNextTone("wait"), "wait");
  assert.equal(amlNextTone("act"), "act");
  assert.equal(amlNextTone("ok"), "ok");
});
