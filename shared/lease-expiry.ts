// One rule for "is this lease expiring soon", shared by every reader of a
// lease_expiry column.
//
// Expiring soon means the lease STILL RUNS and runs out inside the window —
// a lease that expired two years ago is expired, not expiring. Five doors
// already had it right (the landlord board's SQL, the leasing-schedule page,
// the company properties board, the client dashboard's 6-month tile and the
// daily briefing); two counted the past as well, so the leasing board's
// "N expiring" badge summed expiring AND long-expired units while the same
// property's own page listed them as separate "Expiring <12m" / "Expired"
// tiles, and ChatBGP's search_leasing_schedule answered "expiring within N
// months from now" with leases that had already gone.
export const DEFAULT_EXPIRY_WINDOW_MONTHS = 12;

export function isLeaseExpiringSoon(
  d: string | Date | null | undefined,
  months: number = DEFAULT_EXPIRY_WINDOW_MONTHS,
): boolean {
  if (!d) return false;
  const expiry = new Date(d);
  if (Number.isNaN(expiry.getTime())) return false;
  const now = new Date();
  if (expiry.getTime() <= now.getTime()) return false;
  const horizon = new Date(now.getTime());
  horizon.setMonth(horizon.getMonth() + months);
  return expiry.getTime() <= horizon.getTime();
}

// The same rule as SQL, for the doors that count in the database. `col` is a
// caller-supplied column reference, never user input; `months` is clamped to
// an integer so it is safe to interpolate.
export function leaseExpiringSoonSql(
  col: string,
  months: number = DEFAULT_EXPIRY_WINDOW_MONTHS,
): string {
  const n = Math.max(1, Math.min(600, Math.round(Number(months) || DEFAULT_EXPIRY_WINDOW_MONTHS)));
  return `${col} IS NOT NULL AND ${col} > NOW() AND ${col} <= NOW() + INTERVAL '${n} months'`;
}
