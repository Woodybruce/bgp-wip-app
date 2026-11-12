// The Brand CRM diary (docs/brand-crm-spec-2026-11-12.md, 2.2 and 2.3): one
// dated list across brands. The server builds the items and cuts them to
// what the login may see (server/brand-crm-diary.ts); the screen only groups
// and filters them.
export type DiaryKind = "crm_action" | "viewing_booked" | "viewing_followup" | "deal_waiting" | "brief_signature" | "case_response";
export const DIARY_KINDS: DiaryKind[] = ["crm_action", "viewing_booked", "viewing_followup", "deal_waiting", "brief_signature", "case_response"];
export const DIARY_KIND_LABELS: Record<DiaryKind, string> = {
  crm_action: "CRM actions",
  viewing_booked: "Viewings booked",
  viewing_followup: "Viewing follow-ups",
  deal_waiting: "Deals waiting",
  brief_signature: "Briefs to sign",
  case_response: "Brand cases",
};

export type DiarySide = "bgp" | "landsec" | "joint_agent" | "other";
export interface DiaryItem {
  id: string;                                  // "<kind>:<record id>"
  kind: DiaryKind;
  title: string;
  date: string | null;                         // yyyy-mm-dd; null = nothing dated
  daysWaiting: number | null;
  overdue: boolean;
  brand: { id: string | null; name: string } | null;      // id null = no brand page for this login
  scheme: { key: string | null; name: string } | null;    // key null = a property outside the Landsec schemes
  unitLabel: string | null;
  owner: string | null;                        // the BGP person who has it
  waitingOn: { side: DiarySide; name: string } | null;
  raisedBy: "bgp" | "client" | null;           // CRM actions only
  status: "todo" | "in_progress" | null;       // CRM actions only
  actionId: string | null;                     // set when the viewer may tick it off
  canComplete: boolean;
  url: string | null;
}

export type DiaryBucket = "overdue" | "thisWeek" | "nextWeek" | "later" | "waiting";
export const DIARY_BUCKETS: DiaryBucket[] = ["overdue", "thisWeek", "nextWeek", "later", "waiting"];
export const DIARY_BUCKET_LABELS: Record<DiaryBucket, string> = {
  overdue: "Overdue", thisWeek: "This week", nextWeek: "Next week", later: "Later", waiting: "Waiting",
};
export type DiaryCounts = Record<DiaryBucket, number>;

export interface DiaryData {
  items: DiaryItem[];
  counts: DiaryCounts;
  today: string;
  canAddAction: boolean;      // BGP staff: a brand action
  canAddRequest: boolean;     // a full Landsec login: a request to BGP on a brand in its list
  warnings: string[];
}

/** A yyyy-mm-dd day at the start of a text value, when it names a real date. Anything else is null. */
export function diaryDay(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(text)?.[1];
  if (!day) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

/** The London calendar day of a moment. */
export function londonDayOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDiaryDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * Where an item sits when the diary is grouped by date. Weeks run Monday to
 * Sunday. With no date, an item that is waiting on someone is Waiting; an
 * action nobody dated and nobody is waited on for is Later.
 */
export function diaryBucket(item: Pick<DiaryItem, "date" | "waitingOn">, today: string): DiaryBucket {
  if (!item.date) return item.waitingOn ? "waiting" : "later";
  if (item.date < today) return "overdue";
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;   // Monday = 0
  const endOfWeek = addDiaryDays(today, 6 - weekday);
  if (item.date <= endOfWeek) return "thisWeek";
  if (item.date <= addDiaryDays(endOfWeek, 7)) return "nextWeek";
  return "later";
}

export function diaryCounts(items: Array<Pick<DiaryItem, "date" | "waitingOn">>, today: string): DiaryCounts {
  const counts: DiaryCounts = { overdue: 0, thisWeek: 0, nextWeek: 0, later: 0, waiting: 0 };
  for (const item of items) counts[diaryBucket(item, today)] += 1;
  return counts;
}
