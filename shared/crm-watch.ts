// The watch list: every company on a running CRM strategy, with what is new
// on it and what is owed (Woody, 2026-11-15: the CRM "closely watches them
// more than other CRMs"). Built by server/crm-watch.ts.
import type { EngagementNoun } from "./crm-engagement";

export interface CrmWatchRow {
  id: string; name: string; noun: EngagementNoun;
  strategies: string[]; strategyIds: string[];
  lastContactAt: string | null;
  openActions: number; overdueActions: number;
  nextAction: { title: string; dueAt: string | null; ownerName: string | null } | null;
  /** New in the last 14 days: signals, planning applications, job adverts, contact. */
  news: string[];
  /** What needs doing: overdue actions, no next step, no contact for 30 days. */
  owed: string[];
}
