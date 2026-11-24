// Land Registry's company ownership lists keep themselves up to date (Woody,
// 24 November 2026: "we dont need a button just auto", once the licences for
// both lists were agreed on use-land-property-data.service.gov.uk).
//
// HM Land Registry publishes each list once a month: UK companies that own
// property in England and Wales (CCOD) and overseas companies (OCOD). A
// nightly check (server/hmlr-fetch.ts autoUpdateHmlrDatasets, job
// "hmlr-datasets") asks for each list's newest full file and loads it when no
// finished load has taken that file yet. After a load that read the whole
// file, the owners the file no longer lists are removed, so a title sold on to
// a person, or a second owner taken off, stops showing.

/** A load still marked running after this long was cut off by a restart. */
export const HMLR_RUN_STALE_MS = 6 * 60 * 60 * 1000;

/** How much of the list a load must have read before owners it no longer lists are removed. */
export const HMLR_COMPLETE_SHARE = 0.9;

export interface HmlrRunFact {
  status: string;              // running | ok | error
  filename: string | null;     // the file the load took, once downloaded
  startedAt: string | null;
}

/** Whether the newest file still needs loading, from the loads recorded for that list. */
export function hmlrLoadDue(latestFile: string, runs: HmlrRunFact[], now = new Date()): { due: boolean; busy: boolean; why: string } {
  if (runs.some(r => r.status === "ok" && r.filename === latestFile)) return { due: false, busy: false, why: `${latestFile} is loaded` };
  const live = runs.find(r => r.status === "running" && !!r.startedAt && now.getTime() - new Date(r.startedAt).getTime() < HMLR_RUN_STALE_MS);
  if (live) return { due: false, busy: true, why: "a load is running" };
  return { due: true, busy: false, why: `${latestFile} is not loaded yet` };
}

/** A file named as a change-only update holds only the month's changes, never the whole list. */
export function hmlrChangeOnlyFile(filename: string): boolean {
  return !/full/i.test(filename) && /cou|change|delta/i.test(filename);
}

/**
 * Whether a finished load read enough of the list to remove the owners it no
 * longer lists: a full file, and at least nine in ten of the titles held
 * before (a file cut short must never empty the table).
 */
export function hmlrStaleOwnersRemovable(o: { filename: string; processed: number; titlesBefore: number }): boolean {
  if (hmlrChangeOnlyFile(o.filename)) return false;
  if (!(o.titlesBefore > 0)) return false;
  return o.processed >= Math.floor(o.titlesBefore * HMLR_COMPLETE_SHARE);
}
