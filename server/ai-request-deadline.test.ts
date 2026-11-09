import test from "node:test";
import assert from "node:assert/strict";
import { withAiRequestDeadline } from "./utils/ai-request-deadline";

test("provider deadline aborts the request rather than just abandoning its promise", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(withAiRequestDeadline(async requestSignal => {
    signal = requestSignal;
    return new Promise(() => {});
  }, { deadline: Date.now() + 1_000, maxRequestMs: 10 }), /timed out/);
  assert.equal(signal?.aborted, true);
});

test("expired group run cannot start another provider request", async () => {
  let called = false;
  await assert.rejects(withAiRequestDeadline(async () => {
    called = true;
    return "should not run";
  }, { deadline: Date.now() - 1, maxRequestMs: 180_000 }), /timed out/);
  assert.equal(called, false);
});

test("successful answers and provider failures retain their original result", async () => {
  let signal: AbortSignal | undefined;
  const answer = await withAiRequestDeadline(async requestSignal => {
    signal = requestSignal;
    return { answer: "Complete" };
  }, { deadline: Date.now() + 1_000, maxRequestMs: 500 });
  assert.deepEqual(answer, { answer: "Complete" });
  assert.equal(signal?.aborted, false);
  const failure = new Error("Provider unavailable");
  await assert.rejects(withAiRequestDeadline(async () => { throw failure; },
    { deadline: Date.now() + 1_000, maxRequestMs: 500 }), error => error === failure);
});
