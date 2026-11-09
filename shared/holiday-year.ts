// BGP's holiday year runs 1 May – 30 April (the firm's holiday calendar
// spreadsheet; Woody, 2026-10-28). Used / pending / remaining count
// against it. The SQL twin of holidayYearBounds sits in the staff queries
// in server/hr-routes.ts.
export const HOLIDAY_YEAR_START_MONTH = 5;

export function holidayYearBounds(d: Date = new Date()): { start: string; end: string; label: string } {
  const y = d.getMonth() + 1 >= HOLIDAY_YEAR_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
  const mm = String(HOLIDAY_YEAR_START_MONTH).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y + 1}-${mm}-01`, label: `${y}/${String(y + 1).slice(2)}` };
}

/** start inclusive, end exclusive — compare on the YYYY-MM-DD prefix. */
export function inHolidayYear(dateStr: string | null | undefined, bounds = holidayYearBounds()): boolean {
  const s = String(dateStr || "").slice(0, 10);
  return s >= bounds.start && s < bounds.end;
}
