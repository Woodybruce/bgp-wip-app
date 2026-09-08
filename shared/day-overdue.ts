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
