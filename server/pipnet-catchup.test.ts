// The twelve-month PIPnet catch-up (19 November 2026): the rules in
// shared/pipnet-catchup.ts and the run in server/pipnet-catchup.ts, against a
// stand-in for system_settings and for PIPnet.
import "./test-database-url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATCHUP_FIRST_FLYERS, addTally, catchupSince, catchupWords, emptyTotals, flyerAlreadyRead, nextCatchupStep, parseTradeTypes, pauseForCost,
  type PipnetCatchupState,
} from "../shared/pipnet-catchup";
import { currentCatchupRun, startPipnetCatchup, stopPipnetCatchup, resumePipnetCatchup, type CatchupDeps } from "./pipnet-catchup";

test("listed since a year ago, in London", () => {
  assert.deepEqual(catchupSince(new Date("2026-11-19T10:00:00Z")), { since: "19/11/2025", cutoff: "2025-11-19T00:00:00.000Z" });
  // 23:30 on 30 June in UTC is 1 July in London.
  assert.equal(catchupSince(new Date("2026-06-30T23:30:00Z")).since, "01/07/2025");
  // 29 February a year back is 28 February.
  assert.equal(catchupSince(new Date("2028-02-29T12:00:00Z")).since, "28/02/2027");
});

test("each trade type in turn, then one search with none, then done", () => {
  const types = ["BAKERS", "CAFES"];
  assert.deepEqual(nextCatchupStep({ types, next: 0 }), { kind: "search", tradeType: "BAKERS" });
  assert.deepEqual(nextCatchupStep({ types, next: 2 }), { kind: "search", tradeType: null });
  assert.deepEqual(nextCatchupStep({ types, next: 3 }), { kind: "done" });
});

test("it pauses once, after the first 100 flyers read", () => {
  const totals = { ...emptyTotals(), aiReads: CATCHUP_FIRST_FLYERS };
  assert.equal(pauseForCost({ phase: "first", totals }), true);
  assert.equal(pauseForCost({ phase: "first", totals: { ...totals, aiReads: 99 } }), false);
  assert.equal(pauseForCost({ phase: "rest", totals: { ...totals, aiReads: 500 } }), false);
  assert.deepEqual(addTally({ ...emptyTotals(), rows: 2 }, { rows: 3, aiReads: 1 }), { ...emptyTotals(), rows: 5, aiReads: 1 });
});

test("a stored flyer is read again only when PIPnet re-issues it or the reading was not sure", () => {
  const kept = { lastUpdated: "09/11/2026", rawData: { _brochurePack: { url: "/f.pdf" }, _visionParse: { confidence: "high" } } };
  assert.equal(flyerAlreadyRead(kept, "09/11/2026"), true);
  assert.equal(flyerAlreadyRead(kept, "12/11/2026"), false, "re-issued");
  assert.equal(flyerAlreadyRead({ ...kept, rawData: { ...kept.rawData, _visionParse: { confidence: "low" } } }, "09/11/2026"), false);
  assert.equal(flyerAlreadyRead({ ...kept, rawData: { _visionParse: { confidence: "high" } } }, "09/11/2026"), false, "no pack kept");
  assert.equal(flyerAlreadyRead({ ...kept, lastUpdated: null }, null), false);
  assert.equal(flyerAlreadyRead(null, "09/11/2026"), false);
});

test("the trade types are read from the search form", () => {
  const html = `<select name="clientListBox"><option value="Pret">Pret</option></select>
    <select name="tradeTypeListBox" size="5"><option value="AIRLINE">AIRLINE</option><option value="ARTS &amp; CRAFTS">ARTS &amp; CRAFTS</option>
    <option>BAKERS</option><option value="AIRLINE">AIRLINE</option></select>`;
  assert.deepEqual(parseTradeTypes(html), ["AIRLINE", "ARTS & CRAFTS", "BAKERS"]);
  assert.deepEqual(parseTradeTypes("<form></form>"), []);
});

// A stand-in for the system_settings row the run keeps.
function fakeDb() {
  let value: any = null;
  return {
    get value() { return value; },
    async query(text: string, values: any[] = []) {
      if (/^SELECT value FROM system_settings/.test(text)) return { rows: value ? [{ value: JSON.parse(JSON.stringify(value)) }] : [] };
      if (/^INSERT INTO system_settings/.test(text)) { value = JSON.parse(values[1]); return { rows: [] }; }
      if (/^UPDATE system_settings/.test(text)) {
        if (value?.status === "running" && value?.runId === values[2]) { value = JSON.parse(values[1]); return { rows: [{ key: values[0] }] }; }
        return { rows: [] };
      }
      throw new Error(`unexpected query ${text.slice(0, 40)}`);
    },
  };
}

const tally = (over: Partial<Record<string, number>> = {}) => ({ rows: 10, capped: false, imported: 9, promoted: 3, agentsOnly: 1, aiReads: 40, reused: 2, skippedOld: 0, failed: 0, ...over });

test("a run reads each trade type, pauses after the first 100 flyers with their cost, and Carry on finishes it", async () => {
  const db = fakeDb();
  const asked: Array<string | null> = [];
  const deps: CatchupDeps = {
    db, now: () => new Date("2026-11-19T10:00:00Z"),
    listTypes: async () => ["BAKERS", "CAFES", "GYMS"],
    step: async ({ tradeType, since }) => { assert.equal(since, "19/11/2025"); asked.push(tradeType); return tally(); },
    flyerSpend: async () => ({ flyers: 120, usd: 4.8 }),
  };
  await startPipnetCatchup("Admin", deps);
  await currentCatchupRun();
  let state = db.value as PipnetCatchupState;
  assert.equal(state.status, "paused");
  assert.deepEqual(asked, ["BAKERS", "CAFES", "GYMS"], "paused after the search that passed 100 flyers");
  assert.deepEqual(state.firstCost, { flyers: 120, usd: 4.8 });
  assert.match(catchupWords(state), /^Paused after the first 120 flyers, about \$4\.80 of AI\. .* Carry on reads the rest\.$/);

  await startPipnetCatchup("Admin", deps);
  await currentCatchupRun();
  state = db.value;
  assert.equal(state.status, "done");
  assert.equal(state.phase, "rest");
  assert.deepEqual(asked, ["BAKERS", "CAFES", "GYMS", null], "the last pass is a search with no trade type");
  assert.equal(state.totals.aiReads, 160);
  assert.match(catchupWords(state), /^Finished: 40 listings seen, 160 flyers read/);
});

test("a search PIPnet refuses stops the run at that search; Carry on tries it again", async () => {
  const db = fakeDb();
  let refuse = true;
  const asked: Array<string | null> = [];
  const deps: CatchupDeps = {
    db, listTypes: async () => ["BAKERS", "CAFES"],
    step: async ({ tradeType }) => {
      asked.push(tradeType);
      if (tradeType === "CAFES" && refuse) throw new Error("Maximum number of licensed users for your company exceeded");
      return tally({ aiReads: 1 });
    },
    flyerSpend: async () => ({ flyers: 0, usd: null }),
  };
  await startPipnetCatchup(null, deps);
  await currentCatchupRun();
  assert.equal(db.value.status, "stopped");
  assert.equal(db.value.next, 1);
  assert.match(db.value.lastError, /licensed users/);
  refuse = false;
  await startPipnetCatchup(null, deps);
  await currentCatchupRun();
  assert.equal(db.value.status, "done");
  assert.deepEqual(asked, ["BAKERS", "CAFES", "CAFES", null]);
});

test("Stop during a search is never written over, and resume carries on only a run that was running", async () => {
  const db = fakeDb();
  let release!: () => void;
  const deps: CatchupDeps = {
    db, listTypes: async () => ["BAKERS", "CAFES"],
    step: () => new Promise(resolve => { release = () => resolve(tally({ aiReads: 1 })); }),
    flyerSpend: async () => ({ flyers: 0, usd: null }),
  };
  await startPipnetCatchup(null, deps);
  await new Promise(r => setImmediate(r));
  await stopPipnetCatchup(deps);
  release();
  await currentCatchupRun();
  assert.equal(db.value.status, "stopped");
  assert.equal(db.value.next, 0, "the search in flight when Stop was pressed is done again on Carry on");
  await resumePipnetCatchup(deps);
  assert.equal(db.value.status, "stopped", "a stopped run does not start by itself");
});
