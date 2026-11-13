// Reading the figures from a company's filed accounts again when an earlier
// read came back with none (the 13 November 2026 checks build: retried in the
// background, with no button). Greggs Plc was the case: the reply was cut
// off, every figure was stored as null, a second empty read marked it final
// and nothing could read it again.
//
// The rule, in one place:
// - A read with no figures is tried again in the background: a day after the
//   first empty read, then a week after each later one.
// - After ACCOUNTS_MAX_EMPTY_READS empty reads of one filing it stops (the
//   accounts are taken to hold no figures) until a new filing arrives.
// - An empty read stored before this rule carries no time, so it is due at
//   the next background run.
// The background run is the nightly brand preparation (server/brand-enrichment.ts,
// runAccountsRetryBatch), under its own daily cap. Nothing here runs when a
// page opens, and never for a client's request.

export const ACCOUNTS_FIGURE_KEYS = ["turnover", "grossProfit", "operatingProfit", "profitBeforeTax", "netAssets", "cash", "employees"] as const;
export const ACCOUNTS_MAX_EMPTY_READS = 4;
const DAY = 86400000;

type Extracted = Record<string, any> | null | undefined;

/** A figure is text with a digit in it: early reads stored "not found". */
export function accountsHaveFigures(extracted: Extracted): boolean {
  if (!extracted || typeof extracted !== "object") return false;
  return ACCOUNTS_FIGURE_KEYS.some(key => /\d/.test(String(extracted[key] ?? "")));
}

/** How many reads of this filing have come back with no figures (0 = none stored, or figures held). */
export function emptyReadCount(extracted: Extracted): number {
  if (!extracted || typeof extracted !== "object" || accountsHaveFigures(extracted)) return 0;
  const counted = Number(extracted.emptyReads);
  if (Number.isInteger(counted) && counted > 0) return counted;
  return extracted.retriedEmpty ? 2 : 1;
}

/** When the background may read the filing again. null = no further read of this filing. */
export function accountsRetryDueAt(extracted: Extracted): Date | null {
  const empties = emptyReadCount(extracted);
  if (!empties || empties >= ACCOUNTS_MAX_EMPTY_READS) return null;
  const readAt = Date.parse(String(extracted!.readAt || ""));
  if (!Number.isFinite(readAt)) return new Date(0);
  return new Date(readAt + (empties === 1 ? DAY : 7 * DAY));
}

export function accountsRetryDue(extracted: Extracted, now: Date = new Date()): boolean {
  const due = accountsRetryDueAt(extracted);
  return !!due && due.getTime() <= now.getTime();
}

/** The same "no figures" test for a query; json is the SQL for the stored read. */
export function accountsNoFiguresSql(json: string): string {
  return `NOT (${ACCOUNTS_FIGURE_KEYS.map(key => `COALESCE(${json}->>'${key}', '') ~ '[0-9]'`).join(" OR ")})`;
}

// Two records can carry one Companies House number (Greggs Plc and Greggs).
// The filed accounts belong to the legal entity, so a record whose own read
// holds no figures may be SHOWN the figures held on the other record. This
// builds the copy that is sent with a reply; nothing is written to either
// record. The period is the other record's own accounts date, so the figures
// are never labelled with this record's year.
export function accountsFromSameEntity(other: Extracted, madeUpTo: string | null): Record<string, any> | null {
  if (!accountsHaveFigures(other)) return null;
  const shown: Record<string, any> = { fromSameNumberRecord: true, period: madeUpTo || other!.period || null };
  for (const key of ACCOUNTS_FIGURE_KEYS) shown[key] = /\d/.test(String(other![key] ?? "")) ? other![key] : null;
  return shown;
}
