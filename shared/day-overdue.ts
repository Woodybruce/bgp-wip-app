// One rule for "is this DAY-stamped due date late", shared by every reader of
// a TIMESTAMP column whose writers only ever write a day.
//
// A due date written as a day lands at midnight, so the naive
// `new Date(due) < new Date()` reads it as late from 00:00 on the day it is
// due. Anything due TODAY is due today — it only goes late once that day has
// passed. Same rule as `isTaskOverdue` (which now delegates here); r610 hit
// it on user_tasks.due_date, r612 on aml_recheck_reminders.due_date and the
// Xero cashflow buckets.
export function isDayOverdue(due: string | Date | null | undefined): boolean {
  if (!due) return false;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return dueDay < today;
}

// SQL twin for the same rule. `col` is caller-supplied (a column name), never
// user input.
export function dayOverdueSql(col: string): string {
  return `(${col})::date < CURRENT_DATE`;
}

// Midnight this morning, for callers bucketing many dates against one "today"
// (the day-safe equivalent of `Date.now()`).
export function startOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

// Whole CALENDAR days from today to a DAY-stamped due date: 0 = today,
// -1 = yesterday, 1 = tomorrow. The naive
// `Math.floor((new Date(due) - Date.now()) / 86400000)` is off by a whole day
// for every hour after midnight — a task due today reads "1d overdue", one
// due tomorrow reads "today" — because it measures a moment-to-moment gap
// against a date written at 00:00 (r615, the property asset brief's
// This-week's-focus card).
export function daysUntilDay(due: string | Date | null | undefined): number | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((dueDay - startOfToday()) / 86_400_000);
}
