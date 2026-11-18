// The watch list: every company on a running CRM strategy, and every Super
// Brand (BGP's starred choice, Woody 2026-11-17), with what is new on it and
// what is owed (Woody, 2026-11-15: the CRM "closely watches them more than
// other CRMs"). Built by server/crm-watch-list.ts.
import type { EngagementNoun } from "./crm-engagement";

export interface CrmWatchRow {
  id: string; name: string; noun: EngagementNoun;
  strategies: string[]; strategyIds: string[];
  lastContactAt: string | null;
  openActions: number; overdueActions: number;
  nextAction: { title: string; dueAt: string | null; ownerName: string | null } | null;
  /** New in the last 14 days: signals, planning applications, job adverts, contact. */
  news: string[];
  /** What needs doing: no strategy yet (a Super Brand), overdue actions, no next step, no contact for 30 days. */
  owed: string[];
  /** Starred as a Super Brand. */
  superBrand?: boolean;
}
