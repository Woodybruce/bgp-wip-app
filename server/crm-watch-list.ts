import type { CrmWatchRow } from "../shared/crm-watch";
import { companyNounSql } from "./crm-engagement";

// ── The watch list ─────────────────────────────────────────────────────────
// What is new, and what is owed, on every company that is on a running
// strategy: the Overview's first card. A fixed number of queries; each side
// query may fail and costs only its own column. BGP staff only (the route is
// on the CRM engagement router).

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
export const WATCH_NEWS_DAYS = 14;
export const WATCH_QUIET_DAYS = 30;

export async function watchList(q: Queryable, now: Date = new Date()): Promise<CrmWatchRow[]> {
  const companies = (await q.query(
    `SELECT c.id, c.name, ${companyNounSql("c")} AS noun, array_agg(DISTINCT s.name) AS strategies, array_agg(DISTINCT s.id) AS strategy_ids
       FROM crm_strategy_targets t JOIN marketing_campaigns s ON s.id = t.strategy_id AND s.status = 'active'
       JOIN crm_companies c ON c.id = t.company_id AND c.merged_into_id IS NULL
      GROUP BY c.id, c.name, c.company_type ORDER BY c.name`)).rows;
  if (!companies.length) return [];
  const ids = companies.map(c => String(c.id));
  const side = (sql: string) => q.query(sql, [ids]).then(r => r.rows).catch(() => [] as any[]);
  const [contact, actions, signals, pipeline] = await Promise.all([
    side(`SELECT company_id, max(interaction_date) FILTER (WHERE interaction_date <= now()) AS last_at,
                 count(*) FILTER (WHERE interaction_date > now() - interval '${WATCH_NEWS_DAYS} days' AND interaction_date <= now())::int AS recent
            FROM crm_interactions WHERE company_id = ANY($1::text[]) GROUP BY company_id`),
    side(`SELECT a.company_id, count(*)::int AS open, count(*) FILTER (WHERE t.due_date < now())::int AS overdue,
                 (array_agg(t.title ORDER BY t.due_date ASC NULLS LAST))[1] AS next_title, min(t.due_date) AS next_due,
                 (array_agg(u.name ORDER BY t.due_date ASC NULLS LAST))[1] AS next_owner
            FROM crm_engagement_actions a JOIN user_tasks t ON t.id = a.task_id LEFT JOIN users u ON u.id = t.user_id
           WHERE a.company_id = ANY($1::text[]) AND t.status <> 'done' GROUP BY a.company_id`),
    side(`SELECT brand_company_id AS company_id, count(*)::int AS n, (array_agg(headline ORDER BY created_at DESC))[1] AS latest
            FROM brand_signals WHERE brand_company_id = ANY($1::text[]) AND created_at > now() - interval '${WATCH_NEWS_DAYS} days'
             AND ai_relevant IS DISTINCT FROM FALSE AND signal_type <> 'news' GROUP BY brand_company_id`),
    side(`SELECT brand_company_id AS company_id, count(*) FILTER (WHERE kind = 'planning')::int AS planning, count(*) FILTER (WHERE kind <> 'planning')::int AS jobs,
                 (array_agg(COALESCE(town, authority) ORDER BY first_seen_at DESC))[1] AS town
            FROM brand_pipeline_items WHERE brand_company_id = ANY($1::text[]) AND first_seen_at > now() - interval '${WATCH_NEWS_DAYS} days' GROUP BY brand_company_id`),
  ]);
  const by = (rows: any[]) => new Map(rows.map(r => [String(r.company_id), r]));
  const contactBy = by(contact), actionBy = by(actions), signalBy = by(signals), pipeBy = by(pipeline);
  const rows: CrmWatchRow[] = companies.map(c => {
    const id = String(c.id), touch = contactBy.get(id), act = actionBy.get(id), sig = signalBy.get(id), pipe = pipeBy.get(id);
    const lastAt = touch?.last_at ? new Date(touch.last_at).toISOString() : null;
    const quietDays = lastAt ? Math.floor((now.getTime() - Date.parse(lastAt)) / 86400000) : null;
    const news: string[] = [];
    if (sig?.n) news.push(sig.n === 1 ? String(sig.latest || "A new signal").slice(0, 110) : `${sig.n} new signals: ${String(sig.latest || "").slice(0, 90)}`);
    if (pipe?.planning) news.push(`${pipe.planning} new planning application${pipe.planning === 1 ? "" : "s"}${pipe.town ? ` (${pipe.town})` : ""}`);
    if (pipe?.jobs) news.push(`${pipe.jobs} new job advert${pipe.jobs === 1 ? "" : "s"} for an opening or a property role`);
    if (touch?.recent) news.push(`${touch.recent} email${touch.recent === 1 ? "" : "s"} or meeting${touch.recent === 1 ? "" : "s"} in ${WATCH_NEWS_DAYS} days`);
    const owed: string[] = [];
    if (act?.overdue) owed.push(`${act.overdue} action${act.overdue === 1 ? "" : "s"} overdue`);
    if (!act?.open) owed.push("No next step");
    if (quietDays == null) owed.push("No contact on record");
    else if (quietDays >= WATCH_QUIET_DAYS) owed.push(`No contact for ${quietDays} days`);
    return { id, name: String(c.name), noun: c.noun, strategies: (c.strategies || []).map(String), strategyIds: (c.strategy_ids || []).map(String),
      lastContactAt: lastAt, openActions: act?.open || 0, overdueActions: act?.overdue || 0,
      nextAction: act?.open ? { title: String(act.next_title || ""), dueAt: act.next_due ? new Date(act.next_due).toISOString() : null, ownerName: act.next_owner || null } : null,
      news, owed };
  });
  return rows.sort((a, b) => Number(b.owed.length > 0) - Number(a.owed.length > 0) || b.news.length - a.news.length || a.name.localeCompare(b.name));
}
