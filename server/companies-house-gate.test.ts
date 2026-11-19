// The Companies House queue (19 November 2026): BGP's checks before asking
// for Hammerson and T4 failed with a 429 because nothing paced the calls.
// server/companies-house-gate.ts: a steady pace, Companies House's own count,
// and a hold after a 429.
import test from "node:test";
import assert from "node:assert/strict";
import { CH_BURST, CH_RESERVE, ChBusyError, ChGate, type ChAnswer } from "./companies-house-gate";

function fakeClock(start = Date.UTC(2026, 10, 19, 8, 0, 0)) {
  let now = start;
  return {
    deps: { now: () => now, sleep: async (ms: number) => { now += ms; } },
    now: () => now,
    advance: (ms: number) => { now += ms; },
  };
}

const answer = (status: number, headers: Record<string, string> = {}): ChAnswer => ({
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
});

test("a burst goes at once, then the pace is 1.8 a second", async () => {
  const clock = fakeClock();
  const gate = new ChGate(clock.deps);
  const start = clock.now();
  for (let i = 0; i < CH_BURST; i++) await gate.turn(start + 60_000);
  assert.equal(clock.now(), start, "the burst waited");
  await gate.turn(start + 60_000);
  assert.ok(clock.now() - start >= 500 && clock.now() - start <= 700, `the next waited ${clock.now() - start}ms`);
});

test("past the burst a caller with no time to wait is told when to try again", async () => {
  const clock = fakeClock();
  const gate = new ChGate(clock.deps);
  for (let i = 0; i < CH_BURST; i++) await gate.turn(clock.now() + 1_000);
  await assert.rejects(gate.turn(clock.now() + 10), (e: any) => e instanceof ChBusyError && /Companies House API error 429/.test(e.message));
});

test("Companies House's own count stops requests until its window ends", async () => {
  const clock = fakeClock();
  const gate = new ChGate(clock.deps);
  const resetAt = Math.floor((clock.now() + 120_000) / 1000);
  gate.note(answer(200, { "x-ratelimit-remain": String(CH_RESERVE), "x-ratelimit-reset": String(resetAt) }));
  // A caller that may wait 30 seconds is refused straight away, naming the wait.
  await assert.rejects(gate.turn(clock.now() + 30_000), (e: any) => e instanceof ChBusyError && /about 2 minutes/.test(e.message));
  // One that may wait longer goes once the window has ended.
  await gate.turn(clock.now() + 5 * 60_000);
  assert.ok(clock.now() >= resetAt * 1000, "went before the window ended");
});

test("an answer without the headers does not hold anything up", async () => {
  const clock = fakeClock();
  const gate = new ChGate(clock.deps);
  gate.note(answer(200));
  const start = clock.now();
  await gate.turn(start + 1_000);
  assert.equal(clock.now(), start);
});

test("a 429 holds every request until the window ends, then the request is tried again", async () => {
  const clock = fakeClock();
  const gate = new ChGate(clock.deps);
  const resetAt = Math.floor((clock.now() + 90_000) / 1000);
  const answers = [answer(429, { "x-ratelimit-reset": String(resetAt) }), answer(200)];
  let sent = 0;
  const got = await gate.request(async () => { sent++; return answers.shift()!; }, 5 * 60_000);
  assert.equal(got.status, 200);
  assert.equal(sent, 2);
  assert.ok(clock.now() >= resetAt * 1000, "tried again before the window ended");
  // With no time to wait for the window, the 429 comes back to the caller.
  const gate2 = new ChGate(fakeClock().deps);
  const back = await gate2.request(async () => answer(429), 1_000);
  assert.equal(back.status, 429);
  assert.ok(gate2.holdEndsAt() > 0, "a 429 with no reset still holds for a minute");
});
