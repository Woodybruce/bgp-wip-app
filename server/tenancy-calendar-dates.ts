// PostgreSQL DATE otherwise becomes a JS local-midnight Date in node-postgres.
// JSON then converts BST midnight to the previous UTC day. Return the written
// SQL calendar date before that conversion can happen. break_notice is text.
const TENANCY_CALENDAR_DATES = ["lease_start", "break_date", "lease_expiry", "next_review_date", "landlord_break_date"] as const;

export function tenancyCalendarDatesSql(alias: "t" | "" = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return TENANCY_CALENDAR_DATES.map(field => `to_char(${prefix}${field}, 'YYYY-MM-DD') AS ${field}`).join(", ");
}
