// Days at stage (Woody, 2026-11-13: "they are there but make no sense").
//
// The date a deal reached its stage is read from three places, in this order:
//
//   1. A date a person set by hand (landsec_deal_clock.stage_since), while the
//      deal is still at the stage it was set for. Confirmed.
//   2. The latest status change in the deal's history (deal_audit_log).
//      Confirmed, unless at least STAGE_BULK_PEERS other deals changed status
//      in the same minute: that is an import or a bulk tidy-up stamping a
//      batch, the day the app was updated, not the day the deal moved.
//   3. Neither: the deal's own stage timestamp, else its creation. Never
//      confirmed.
//
// An unconfirmed date still counts for the stuck test exactly as a confirmed
// one does (a stuck deal is never hidden); the screens draw it greyed with a
// question mark and say so. The rule lives here, with its tests in
// server/stage-since.test.ts: change it here, never on a screen or in a query.

// A status change that shares its minute with this many OTHER deals is a
// bulk stamp.
export const STAGE_BULK_PEERS = 5;

// Not every 'status' line in a deal's history is a move. The approval route
// and the board mirror (server/lease-status-mirror.ts) also write one when a
// move was refused or skipped, and the deal's status did not change: such a
// line never restarts the days and never cancels a date set by hand (review,
// 2026-11-13). These are the opening words of those lines' reasons.
export const STATUS_LINE_NOT_A_MOVE = ["Approval rejected", "Blocked —", "Skipped —"] as const;
export const statusLineIsMove = (reason: string | null | undefined): boolean =>
  !reason || !STATUS_LINE_NOT_A_MOVE.some(opening => reason.startsWith(opening));
// The same test for a query over deal_audit_log (the reason column, with the
// table's alias when the query has one). Every reader of "the latest status
// change" uses it, so no screen counts a refused move.
export const statusLineIsMoveSql = (alias?: string): string => {
  const reason = alias ? `${alias}.reason` : "reason";
  return `(${reason} IS NULL OR (${STATUS_LINE_NOT_A_MOVE.map(opening => `${reason} NOT LIKE '${opening}%'`).join(" AND ")}))`;
};

// A hand-set date may be earlier than the deal's creation (a letting that was
// already running when it was put on the app), but not by more than this.
export const STAGE_SINCE_EARLIEST_YEARS = 3;

type When = string | Date | null | undefined;

export interface StageHandSet {
  date: string | null;        // yyyy-mm-dd
  code: string | null;        // the status code it was set for
  byName: string | null;
  setAt?: When;               // when it was set (the deal history's own line)
}

// What the server reads for one deal.
export interface StageFacts {
  auditAt?: When;             // the latest status change in the deal's history
  auditPeers?: number | null; // OTHER deals whose status changed in the same minute
  hand?: StageHandSet | null;
}

export type StageSinceSource = "set" | "history" | "bulk" | "none";

export interface StageSince {
  since: string | Date | null;
  confirmed: boolean;
  source: StageSinceSource;
  // The hand-set date, only while it applies.
  set: { date: string; byName: string | null } | null;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const time = (d: When): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

// A real calendar day written yyyy-mm-dd (31 February is not one).
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = YMD.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// Today in London, yyyy-mm-dd: the day the team means by "today".
export function londonDay(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

// Whether a hand-set date still applies: the deal is at the stage it was set
// for, and its status has not changed since the date was set (a deal that
// left the stage and came back starts again from its own history).
export function handSetApplies(code: string | null | undefined, facts: StageFacts | null | undefined): boolean {
  const hand = facts?.hand;
  if (!hand || !code || !isCalendarDay(hand.date) || hand.code !== code) return false;
  const moved = time(facts?.auditAt), set = time(hand.setAt);
  return !(moved !== null && set !== null && moved > set);
}

// The date a deal reached its stage, and whether the app can stand behind it.
// `fallback` is the deal's own stage timestamp, else its creation.
export function resolveStageSince(code: string | null | undefined, facts: StageFacts | null | undefined, fallback?: When): StageSince {
  if (handSetApplies(code, facts)) {
    const hand = facts!.hand!;
    return { since: hand.date, confirmed: true, source: "set", set: { date: hand.date!, byName: hand.byName || null } };
  }
  if (time(facts?.auditAt) !== null) {
    const bulk = Number(facts?.auditPeers || 0) >= STAGE_BULK_PEERS;
    return { since: facts!.auditAt!, confirmed: !bulk, source: bulk ? "bulk" : "history", set: null };
  }
  return { since: fallback || null, confirmed: false, source: "none", set: null };
}

// What PUT /api/landsec/deal/:id/clock accepts as stageSince: a day written
// yyyy-mm-dd, not in the future and not more than STAGE_SINCE_EARLIEST_YEARS
// before the deal was created. null (or "") clears the hand-set date.
export function checkStageSinceInput(value: unknown, opts: { today: string; createdAt?: When }): { ok: true; date: string | null } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, date: null };
  if (!isCalendarDay(value)) return { ok: false, error: "Give the date as a day, year first: 2026-10-01" };
  if (value > opts.today) return { ok: false, error: "The date a deal reached its stage cannot be in the future" };
  const created = time(opts.createdAt);
  if (created !== null) {
    const floor = new Date(created);
    floor.setUTCFullYear(floor.getUTCFullYear() - STAGE_SINCE_EARLIEST_YEARS);
    if (value < floor.toISOString().slice(0, 10)) {
      return { ok: false, error: `That date is more than ${STAGE_SINCE_EARLIEST_YEARS} years before the deal was created. Check the year` };
    }
  }
  return { ok: true, date: value };
}

// The figure as the screens write it: "17d", or "17d?" when the date is not
// confirmed.
// No question mark on an unconfirmed figure (Woody, 2026-11-13: "remove question
// marks looks stupid"): it is greyed, and its title says the date is not known.
export const stageDaysLabel = (days: number, _confirmed?: boolean | null): string => `${days}d`;

// The words behind the figure (its title). `stage` is the stage's name
// ("Negotiating"); `canSet` is true where pressing the figure opens the date.
export function stageDaysTitle(o: {
  stage?: string | null; days: number; confirmed?: boolean | null; stuck: boolean; stuckDays: number;
  setByName?: string | null; isSet?: boolean; canSet?: boolean;
}): string {
  const at = o.stage ? `At ${o.stage}` : "At this stage";
  const days = `${o.days} day${o.days === 1 ? "" : "s"}`;
  if (o.confirmed === false) {
    const lead = `The app does not know when this deal reached ${o.stage || "this stage"}.`;
    const stuck = o.stuck ? ` By the app's own date it has been ${days}, which counts as stuck (${o.stuckDays} days or more), but that date is unconfirmed.` : "";
    return `${lead}${stuck}${o.canSet ? " Set the date." : ""}`;
  }
  const base = o.stuck ? `${at} for ${days}: stuck (${o.stuckDays} days or more)` : `${at} for ${days}`;
  const by = o.isSet ? `. Date set by ${o.setByName || "hand"}` : "";
  return `${base}${by}${o.canSet ? ". Press to change the date" : ""}`;
}
