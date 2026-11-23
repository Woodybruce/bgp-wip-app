// The watch list: every company on a running CRM strategy, and every Super
// Brand (BGP's starred choice, Woody 2026-11-17), with what is new on it and
// what is owed (Woody, 2026-11-15: the CRM "closely watches them more than
// other CRMs"). Built by server/crm-watch-list.ts.
import type { EngagementNoun } from "./crm-engagement";

export interface CrmWatchRow {
  id: string; name: string; noun: EngagementNoun;
  strategies: string[]; strategyIds: string[];
  lastContactAt: string | null;
  /** The next meeting BGP diaries hold with it. */
  nextMeetingAt?: string | null;
  /** People filed under the company in the CRM. */
  peopleCount?: number;
  openActions: number; overdueActions: number;
  nextAction: { title: string; dueAt: string | null; ownerName: string | null } | null;
  /** New in the last 14 days: signals, planning applications, job adverts, contact. */
  news: string[];
  /** What needs doing: no strategy yet (a Super Brand), overdue actions, no next step, no people on record, no contact logged or none for 30 days. */
  owed: string[];
  /** Starred as a Super Brand. */
  superBrand?: boolean;
}

// One watch list entry's pop-out (GET /api/crm/engagement/watch/:id/summary):
// BGP's activity with the company. A part the server could not read is null.
export interface CrmWatchSummary {
  id: string; name: string; noun: EngagementNoun; superBrand?: boolean;
  lastContactAt: string | null; nextMeetingAt: string | null;
  people: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null; lastContactAt: string | null }> | null;
  recent: Array<{ id: string; type: string; direction: string | null; subject: string | null; at: string; bgpUser: string | null; contactName: string | null }> | null;
  meetings: { past: Array<{ subject: string; start: string; bgp: string[] }>; next: Array<{ subject: string; start: string; bgp: string[] }> } | null;
  deals: Array<{ id: string; name: string; status: string | null; dealType: string | null; propertyName: string | null }> | null;
  openRequirements: number | null;
}
