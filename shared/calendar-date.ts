// Lease dates describe a calendar day, not an instant. Keep their written day
// for display and date inputs regardless of the browser's time zone.
export function calendarDateValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
  return `${year}-${month}-${day}`;
}

export function formatCalendarDate(value: string | null | undefined, day: "numeric" | "2-digit" = "numeric"): string | null {
  const canonical = calendarDateValue(value);
  return canonical ? new Date(`${canonical}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day, month: "short", year: "numeric", timeZone: "UTC",
  }) : null;
}
