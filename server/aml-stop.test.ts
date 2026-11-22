// BGP stops acting on a deal for AML reasons (Woody, 21 November 2026: MLR
// 2017 reg 31, "Yes go ahead"). The rules are shared/aml-stop.ts; the email
// is shared/kyc-request.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { AML_STOP_REASONS, AML_STOP_REFUSAL, amlStopAllowsMove, amlStopInput } from "../shared/aml-stop";
import { amlStoppedEmail } from "../shared/kyc-request";

test("the officers say why and what happened; withdrawing is their choice", () => {
  assert.deepEqual(amlStopInput({ reason: "checks_incomplete", note: "The buyer will not say who owns the company, after three requests." }),
    { ok: true, value: { reason: "checks_incomplete", note: "The buyer will not say who owns the company, after three requests.", withdraw: false } });
  const w = amlStopInput({ reason: "other", note: "Asked to pay the deposit in cash.", withdraw: "true" });
  assert.ok(w.ok && w.value.withdraw);
  const noReason = amlStopInput({ reason: "suspicion", note: "Something long enough to count." });
  assert.equal(noReason.ok, false);
  const short = amlStopInput({ reason: "other", note: "Odd." });
  assert.ok(!short.ok && /in a sentence or more/.test(short.message));
  assert.match(AML_STOP_REASONS.checks_incomplete, /checks can't be completed/);
});

test("a stopped deal moves only to Withdrawn, or stays where it is", () => {
  assert.equal(amlStopAllowsMove("NEG", "WIT"), true);
  assert.equal(amlStopAllowsMove("SOL", "SOL"), true);
  assert.equal(amlStopAllowsMove("NEG", null), true);
  for (const target of ["HOT", "SOL", "EXC", "COM", "INV", "AVA"]) assert.equal(amlStopAllowsMove("NEG", target), false, target);
});

test("what everyone else is told never says AML, a suspicion or the Nominated Officer", () => {
  assert.doesNotMatch(AML_STOP_REFUSAL, /AML|money laundering|suspic|Nominated Officer|National Crime Agency/i);
  assert.match(AML_STOP_REFUSAL, /on hold/);
});

test("the agents' email says what to do and nothing of why", () => {
  const stopped = amlStoppedEmail({ dealName: "Unit 4, Westgate", dealRef: 4521, by: "Jack Barratt", resumed: false, withdrawn: true, link: "https://chatbgp.app/deals/d1", sentFrom: "kyc@example.org" });
  assert.equal(stopped.subject, "AML: BGP has stopped acting on Unit 4, Westgate");
  assert.match(stopped.html, /Deal #4521, Unit 4, Westgate is on hold for anti-money laundering reasons: Jack Barratt stopped BGP acting on it\. The deal has been moved to Withdrawn\./);
  assert.match(stopped.html, /Do not move the deal on, raise or send an invoice/);
  assert.match(stopped.html, /Do not tell the client, the other side or their advisers why/);
  assert.doesNotMatch(stopped.html, /reg 31|cannot be completed|suspic/i);
  const resumed = amlStoppedEmail({ dealName: "Unit 4, Westgate", dealRef: null, by: "Layla O'Driscoll", resumed: true, withdrawn: false, link: "https://chatbgp.app/deals/d1", sentFrom: "kyc@example.org" });
  assert.equal(resumed.subject, "AML: Unit 4, Westgate is no longer on hold");
  assert.match(resumed.html, /Layla O&#39;Driscoll released it|Layla O&#x27;Driscoll released it|Layla O'Driscoll released it/);
});
