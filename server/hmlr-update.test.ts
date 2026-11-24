// Land Registry's lists keep themselves up to date (Woody, 24 November 2026:
// "we dont need a button just auto"). The rules are shared/hmlr-update.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hmlrLoadDue, hmlrStaleOwnersRemovable, hmlrChangeOnlyFile, HMLR_RUN_STALE_MS } from "../shared/hmlr-update";

const NOW = new Date("2026-11-25T00:20:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

test("a list loads when no finished load took its newest file", () => {
  // Live on 24 November 2026: the May loads stopped at the file's last line, June's was refused (licence).
  const runs = [
    { status: "error", filename: null, startedAt: "2026-06-22T08:14:58Z" },
    { status: "error", filename: "CCOD_FULL_2026_05.zip", startedAt: "2026-05-13T17:22:15Z" },
  ];
  assert.deepEqual(hmlrLoadDue("CCOD_FULL_2026_11.zip", runs, NOW), { due: true, busy: false, why: "CCOD_FULL_2026_11.zip is not loaded yet" });
  // Once that file is loaded, nothing until next month's file.
  const loaded = [{ status: "ok", filename: "CCOD_FULL_2026_11.zip", startedAt: ago(60_000) }, ...runs];
  assert.equal(hmlrLoadDue("CCOD_FULL_2026_11.zip", loaded, NOW).due, false);
  assert.equal(hmlrLoadDue("CCOD_FULL_2026_12.zip", loaded, NOW).due, true);
});

test("a load running now waits; one left running by a restart does not", () => {
  const running = [{ status: "running", filename: null, startedAt: ago(10 * 60_000) }];
  assert.deepEqual(hmlrLoadDue("OCOD_FULL_2026_11.zip", running, NOW), { due: false, busy: true, why: "a load is running" });
  const stuck = [{ status: "running", filename: "OCOD_FULL_2026_11.zip", startedAt: ago(HMLR_RUN_STALE_MS + 60_000) }];
  assert.equal(hmlrLoadDue("OCOD_FULL_2026_11.zip", stuck, NOW).due, true);
});

test("owners the new file no longer lists are removed only after a load that read the whole list", () => {
  // A full file that read the list: remove.
  assert.equal(hmlrStaleOwnersRemovable({ filename: "CCOD_FULL_2026_11.zip", processed: 4_420_000, titlesBefore: 4_413_000 }), true);
  assert.equal(hmlrStaleOwnersRemovable({ filename: "CCOD_FULL_2026_11.zip", processed: 3_980_000, titlesBefore: 4_413_000 }), true);
  // A file cut short never empties the table.
  assert.equal(hmlrStaleOwnersRemovable({ filename: "CCOD_FULL_2026_11.zip", processed: 3_900_000, titlesBefore: 4_413_000 }), false);
  assert.equal(hmlrStaleOwnersRemovable({ filename: "CCOD_FULL_2026_11.zip", processed: 0, titlesBefore: 4_413_000 }), false);
  // A change-only file holds only the month's changes.
  assert.equal(hmlrChangeOnlyFile("CCOD_COU_2026_11.zip"), true);
  assert.equal(hmlrChangeOnlyFile("CCOD_FULL_2026_11.zip"), false);
  assert.equal(hmlrStaleOwnersRemovable({ filename: "CCOD_COU_2026_11.zip", processed: 5_000_000, titlesBefore: 4_413_000 }), false);
  // Nothing held before: nothing to remove.
  assert.equal(hmlrStaleOwnersRemovable({ filename: "OCOD_FULL_2026_11.zip", processed: 97_000, titlesBefore: 0 }), false);
});

test("the nightly job is registered and removes only rows the load did not touch", () => {
  const boot = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(boot, /key: "hmlr-datasets", due: dailyAt\(0, 20\)/);
  const fetch = readFileSync(new URL("./hmlr-fetch.ts", import.meta.url), "utf8");
  assert.match(fetch, /DELETE FROM hmlr_proprietors WHERE dataset = \$1 AND ingest_run_id IS DISTINCT FROM \$2/);
  assert.match(fetch, /if \(hmlrStaleOwnersRemovable\(\{ filename: result\.filename, processed: result\.processed, titlesBefore \}\)\)/);
  assert.match(fetch, /HMLR_AUTO_UPDATE/);
  // One load of a list at a time.
  assert.match(fetch, /if \(loadingNow\.has\(dataset\)\) throw new Error/);
});
