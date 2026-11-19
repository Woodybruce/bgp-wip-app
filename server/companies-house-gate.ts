// One queue for every Companies House call in the process. Companies House
// lets an API key make 600 requests in each five-minute window and answers
// 429 past it. On 19 November 2026 BGP's checks before asking for Hammerson
// and T4 failed on their first call with a 429: one check makes about 50
// calls (the register, the ownership chain, the disqualified directors
// register, the covenant report, three filings), and nothing paced them, so
// opening a few AML boxes in a row used up the window.
//
// A request waits here for its turn:
//   - a steady pace: a burst of up to BURST requests, then 1.8 a second, so
//     the process alone never sends more than 600 in five minutes;
//   - Companies House's own count: each answer says how many requests the
//     window has left (X-Ratelimit-Remain) and when it ends
//     (X-Ratelimit-Reset), which counts every process using the key; with
//     RESERVE or fewer left, requests wait for the window to end;
//   - a 429 holds every request until the window ends (a minute when the
//     answer does not say), then the request is tried again.
// A caller waits only so long (maxWaitMs), then gets an error that says when
// to try again. BGP's checks before asking wait longer (withChPatience):
// they run in the background, and a check that gave up would miss the
// register.

import { AsyncLocalStorage } from "node:async_hooks";

export const CH_BURST = 60;
export const CH_RATE_PER_SECOND = 1.8;
export const CH_RESERVE = 25;
export const CH_DEFAULT_MAX_WAIT_MS = 30_000;
const HOLD_WITHOUT_RESET_MS = 60_000;
const MAX_TRIES = 3;

export class ChBusyError extends Error {
  readonly retryAt: number;
  constructor(retryAt: number, now: number) {
    const minutes = Math.max(1, Math.ceil((retryAt - now) / 60_000));
    super(`Companies House API error 429: BGP's allowance of 600 requests in five minutes is used up; try again in about ${minutes} minute${minutes === 1 ? "" : "s"}`);
    this.name = "ChBusyError";
    this.retryAt = retryAt;
  }
}

export interface ChAnswer { status: number; headers: { get(name: string): string | null } }

export interface ChGateDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: ChGateDeps = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export class ChGate {
  private tokens = CH_BURST;
  private refilledAt: number;
  // Companies House's own count, from the last answer.
  private remain: number | null = null;
  private resetAt = 0;
  private heldUntil = 0;
  private inFlight = 0;

  constructor(private deps: ChGateDeps = realDeps) {
    this.refilledAt = deps.now();
  }

  private refill(now: number) {
    this.tokens = Math.min(CH_BURST, this.tokens + ((now - this.refilledAt) / 1000) * CH_RATE_PER_SECOND);
    this.refilledAt = now;
  }

  /** When the next request may go, ignoring the steady pace: 0 for now. */
  private blockedUntil(now: number): number {
    if (this.heldUntil > now) return this.heldUntil;
    if (this.remain != null && this.resetAt > now && this.remain - this.inFlight <= CH_RESERVE) return this.resetAt;
    if (this.resetAt && this.resetAt <= now) this.remain = null;
    return 0;
  }

  /** Waits for a turn; throws ChBusyError when it would come after `deadline`. */
  async turn(deadline: number): Promise<void> {
    for (;;) {
      const now = this.deps.now();
      const blocked = this.blockedUntil(now);
      if (blocked) {
        if (blocked > deadline) throw new ChBusyError(blocked, now);
        await this.deps.sleep(Math.max(50, Math.min(blocked - now + 50, 5_000)));
        continue;
      }
      this.refill(now);
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = Math.ceil(((1 - this.tokens) / CH_RATE_PER_SECOND) * 1000);
      if (now + wait > deadline) throw new ChBusyError(now + wait, now);
      await this.deps.sleep(Math.max(20, wait));
    }
  }

  /** When a hold after a 429 ends (0 when there is none). */
  holdEndsAt(): number {
    return this.heldUntil > this.deps.now() ? this.heldUntil : 0;
  }

  /** Reads Companies House's count from an answer, and holds every request after a 429. */
  note(answer: ChAnswer) {
    const now = this.deps.now();
    const num = (raw: string | null): number => (raw == null || raw.trim() === "" ? NaN : Number(raw));
    const remain = num(answer.headers.get("x-ratelimit-remain") ?? answer.headers.get("x-ratelimit-remaining"));
    const reset = num(answer.headers.get("x-ratelimit-reset"));
    // Seconds since 1970; a small number would be seconds from now.
    const resetAt = Number.isFinite(reset) && reset > 0 ? (reset > 1e9 ? reset * 1000 : now + reset * 1000) : 0;
    if (Number.isFinite(remain)) this.remain = remain;
    if (resetAt > now) this.resetAt = resetAt;
    if (answer.status === 429) this.heldUntil = Math.max(this.heldUntil, resetAt > now ? resetAt : now + HOLD_WITHOUT_RESET_MS);
  }

  /** Runs one request in turn: waits, sends, reads the count, and tries again after a 429 while time allows. */
  async request<T extends ChAnswer>(send: () => Promise<T>, maxWaitMs: number): Promise<T> {
    const deadline = this.deps.now() + Math.max(0, maxWaitMs);
    for (let attempt = 1; ; attempt++) {
      await this.turn(deadline);
      this.inFlight += 1;
      let answer: T;
      try {
        answer = await send();
      } finally {
        this.inFlight -= 1;
      }
      this.note(answer);
      if (answer.status !== 429 || attempt >= MAX_TRIES) return answer;
      const now = this.deps.now();
      if (this.heldUntil > deadline) return answer;
      console.warn(`[companies-house] 429 from Companies House: waiting ${Math.round((this.heldUntil - now) / 1000)}s for the window to end, then trying again`);
    }
  }
}

export const chGate = new ChGate();

// How long a Companies House call may wait for its turn, for everything run
// inside: BGP's checks before asking pass a few minutes.
const patience = new AsyncLocalStorage<number>();
export const withChPatience = <T>(ms: number, run: () => Promise<T>): Promise<T> => patience.run(ms, run);
export const chMaxWait = (given?: number): number => given ?? patience.getStore() ?? CH_DEFAULT_MAX_WAIT_MS;
