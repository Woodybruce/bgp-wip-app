import type { CrmWatchRow, CrmWatchSummary } from "../shared/crm-watch";
import { companyNounSql } from "./crm-engagement";
import { PRIVATE_PATTERN } from "./crm-hub";
import { isPrivateMailboxAddress } from "./private-mail";
import { closedStatusSqlList } from "@shared/letting-rules";
import { requirementStateSql } from "@shared/requirement-live";

// ── The watch list ─────────────────────────────────────────────────────────
// What is new, and what is owed, on every company that is on a running
// strategy, and on every Super Brand whether or not its strategy has started
// (Woody, 2026-11-17: Super Brands "get the CRM VIP treatment and massive
// focus"): the Overview's first card. A fixed number of queries; each side
// query may fail and costs only its own column. BGP staff only (the route is
// on the CRM engagement router).

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
export const WATCH_NEWS_DAYS = 14;
export const WATCH_QUIET_DAYS = 30;

// Contact with a company is anything filed against it OR against one of its
// people (the CRM lists' own rule, server/crm-hub.ts), never a line the
// private mailbox is on, and the meetings BGP diaries hold with it (the
// landlord and leasing books). Until 23 November 2026 the watch list read
// only lines filed against the company itself, so Jersey Mike's read "No
// contact on record" (Woody: "which is wrong so needs to link").
const CONTACT_SQL = `SELECT x.company_id,
    max(x.interaction_date) FILTER (WHERE x.interaction_date <= now()) AS last_at,
    count(*) FILTER (WHERE x.interaction_date > now() - interval '${WATCH_NEWS_DAYS} days' AND x.interaction_date <= now())::int AS recent
  FROM (
    SELECT i.company_id, i.interaction_date, i.bgp_user, i.participants FROM crm_interactions i WHERE i.company_id = ANY($1::text[])
    UNION ALL
    SELECT p.company_id, i.interaction_date, i.bgp_user, i.participants
      FROM crm_interactions i JOIN crm_contacts p ON p.id = i.contact_id
     WHERE p.company_id = ANY($1::text[]) AND i.company_id IS DISTINCT FROM p.company_id
  ) x
  WHERE COALESCE(x.bgp_user, '') !~* $2 AND COALESCE(x.participants::text, '') !~* $2
  GROUP BY x.company_id`;

type DiaryMeeting = { companyId: string; subject: string; start: string; bgpParticipants: Array<{ name: string; email: string }> };
// Both diary books, each allowed to fail on its own. Built from the stored
// diary reads (cached a few minutes), never a call to Microsoft.
async function diaryMeetings(): Promise<DiaryMeeting[]> {
  const { getLandlordMeetingDigest } = await import("./landlord-meetings");
  const books = await Promise.all([getLandlordMeetingDigest({}), getLandlordMeetingDigest({ book: "leasing" })]
    .map(p => p.then(d => d.meetings as DiaryMeeting[]).catch(() => [] as DiaryMeeting[])));
  return books.flat();
}

export async function watchList(q: Queryable, now: Date = new Date(), meetings: () => Promise<DiaryMeeting[]> = diaryMeetings): Promise<CrmWatchRow[]> {
  const companies = (await q.query(
    `SELECT c.id, c.name, ${companyNounSql("c")} AS noun, c.hunter_flag IS TRUE AND c.company_type ILIKE 'tenant%' AS super_brand,
            COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.id IS NOT NULL), '{}') AS strategies,
            COALESCE(array_agg(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL), '{}') AS strategy_ids
       FROM crm_companies c
       LEFT JOIN crm_strategy_targets t ON t.company_id = c.id
       LEFT JOIN marketing_campaigns s ON s.id = t.strategy_id AND s.status = 'active'
      WHERE c.merged_into_id IS NULL
        AND (s.id IS NOT NULL OR (c.hunter_flag IS TRUE AND c.company_type ILIKE 'tenant%' AND c.archived_at IS NULL))
      GROUP BY c.id ORDER BY c.name`)).rows;
  if (!companies.length) return [];
  const ids = companies.map(c => String(c.id));
  const side = (sql: string, extra: any[] = []) => q.query(sql, [ids, ...extra]).then(r => r.rows).catch(() => [] as any[]);
  const [contact, actions, signals, pipeline, people, diary] = await Promise.all([
    side(CONTACT_SQL, [PRIVATE_PATTERN]),
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
    side(`SELECT company_id, email FROM crm_contacts WHERE company_id = ANY($1::text[])`),
    meetings().catch(() => [] as DiaryMeeting[]),
  ]);
  const peopleBy = new Map<string, number>();
  for (const p of people) if (!isPrivateMailboxAddress(String(p.email || ""))) peopleBy.set(String(p.company_id), (peopleBy.get(String(p.company_id)) || 0) + 1);
  const listed = new Set(ids);
  const meetingBy = new Map<string, { last: string | null; next: string | null; recent: number }>();
  const nowIso = now.toISOString(), recentFrom = new Date(now.getTime() - WATCH_NEWS_DAYS * 86400000).toISOString();
  for (const m of diary) {
    if (!listed.has(m.companyId) || !m.start) continue;
    const at = meetingBy.get(m.companyId) || { last: null, next: null, recent: 0 };
    if (m.start <= nowIso) { if (!at.last || m.start > at.last) at.last = m.start; if (m.start >= recentFrom) at.recent++; }
    else if (!at.next || m.start < at.next) at.next = m.start;
    meetingBy.set(m.companyId, at);
  }
  const by = (rows: any[]) => new Map(rows.map(r => [String(r.company_id), r]));
  const contactBy = by(contact), actionBy = by(actions), signalBy = by(signals), pipeBy = by(pipeline);
  const rows: CrmWatchRow[] = companies.map(c => {
    const id = String(c.id), touch = contactBy.get(id), act = actionBy.get(id), sig = signalBy.get(id), pipe = pipeBy.get(id), met = meetingBy.get(id);
    const logged = touch?.last_at ? new Date(touch.last_at).toISOString() : null;
    const lastAt = [logged, met?.last || null].filter((d): d is string => !!d).sort().at(-1) || null;
    const peopleCount = peopleBy.get(id) || 0;
    const quietDays = lastAt ? Math.floor((now.getTime() - Date.parse(lastAt)) / 86400000) : null;
    const news: string[] = [];
    if (sig?.n) news.push(sig.n === 1 ? String(sig.latest || "A new signal").slice(0, 110) : `${sig.n} new signals: ${String(sig.latest || "").slice(0, 90)}`);
    if (pipe?.planning) news.push(`${pipe.planning} new planning application${pipe.planning === 1 ? "" : "s"}${pipe.town ? ` (${pipe.town})` : ""}`);
    if (pipe?.jobs) news.push(`${pipe.jobs} new job advert${pipe.jobs === 1 ? "" : "s"} for an opening or a property role`);
    const recent = (touch?.recent || 0) + (met?.recent || 0);
    if (recent) news.push(`${recent} email${recent === 1 ? "" : "s"} or meeting${recent === 1 ? "" : "s"} in ${WATCH_NEWS_DAYS} days`);
    const owed: string[] = [];
    const superBrand = c.super_brand === true;
    const strategies = (c.strategies || []).map(String);
    if (superBrand && !strategies.length) owed.push("No strategy yet");
    if (act?.overdue) owed.push(`${act.overdue} action${act.overdue === 1 ? "" : "s"} overdue`);
    if (!act?.open) owed.push("No next step");
    if (!peopleCount) owed.push("No people on record");
    if (quietDays == null && !met?.next) owed.push("No contact logged");
    else if (quietDays != null && quietDays >= WATCH_QUIET_DAYS && !met?.next) owed.push(`No contact for ${quietDays} days`);
    return { id, name: String(c.name), noun: c.noun, strategies, strategyIds: (c.strategy_ids || []).map(String), ...(superBrand ? { superBrand } : {}),
      lastContactAt: lastAt, nextMeetingAt: met?.next || null, peopleCount, openActions: act?.open || 0, overdueActions: act?.overdue || 0,
      nextAction: act?.open ? { title: String(act.next_title || ""), dueAt: act.next_due ? new Date(act.next_due).toISOString() : null, ownerName: act.next_owner || null } : null,
      news, owed };
  });
  return rows.sort((a, b) => Number(b.owed.length > 0) - Number(a.owed.length > 0) || b.news.length - a.news.length || a.name.localeCompare(b.name));
}

// ── One entry's pop-out: BGP's activity with the company ─────────────────────
// The people on record, last and next contact, what was filed lately, the
// diary meetings, live deals and open requirements. BGP staff only (the route
// is on the CRM engagement router). Each part may fail and costs only itself.
const OPEN_DEAL = `lower(trim(COALESCE(d.status, ''))) NOT IN (${closedStatusSqlList()})`;
export async function watchSummary(q: Queryable, companyId: string, now: Date = new Date(), meetings: () => Promise<DiaryMeeting[]> = diaryMeetings): Promise<CrmWatchSummary | null> {
  const company = (await q.query(`SELECT c.id, c.name, ${companyNounSql("c")} AS noun, c.hunter_flag IS TRUE AND c.company_type ILIKE 'tenant%' AS super_brand
    FROM crm_companies c WHERE c.id = $1 AND c.merged_into_id IS NULL`, [companyId])).rows[0];
  if (!company) return null;
  const part = (sql: string, values: any[]) => q.query(sql, values).then(r => r.rows).catch(() => null as any[] | null);
  const [people, touches, deals, requirements, diary] = await Promise.all([
    part(`SELECT p.id, p.name, p.role, p.email, p.phone,
            (SELECT max(i.interaction_date) FROM crm_interactions i WHERE i.contact_id = p.id AND i.interaction_date <= now()
               AND COALESCE(i.bgp_user, '') !~* $2 AND COALESCE(i.participants::text, '') !~* $2) AS last_at
          FROM crm_contacts p WHERE p.company_id = $1 ORDER BY last_at DESC NULLS LAST, lower(p.name) LIMIT 40`, [companyId, PRIVATE_PATTERN]),
    part(`SELECT i.id, i.type, i.direction, i.subject, i.interaction_date AS at, i.bgp_user, p.name AS contact_name
          FROM crm_interactions i LEFT JOIN crm_contacts p ON p.id = i.contact_id
         WHERE (i.company_id = $1 OR p.company_id = $1) AND i.interaction_date <= now()
           AND COALESCE(i.bgp_user, '') !~* $2 AND COALESCE(i.participants::text, '') !~* $2
         ORDER BY i.interaction_date DESC LIMIT 8`, [companyId, PRIVATE_PATTERN]),
    part(`SELECT d.id, d.name, d.status, d.deal_type, pr.name AS property_name, d.updated_at
          FROM crm_deals d LEFT JOIN crm_properties pr ON pr.id = d.property_id
         WHERE (d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1) AND ${OPEN_DEAL}
         ORDER BY d.updated_at DESC NULLS LAST LIMIT 10`, [companyId]),
    part(`SELECT count(*)::int AS n FROM crm_requirements_leasing r
         WHERE r.company_id = $1 AND (${requirementStateSql("r")}) IN ('live','to_confirm')`, [companyId]),
    meetings().then(list => list.filter(m => m.companyId === companyId)).catch(() => null),
  ]);
  const iso = (v: any) => (v ? new Date(v).toISOString() : null);
  const nowIso = now.toISOString();
  const shownPeople = (people || []).filter(p => !isPrivateMailboxAddress(String(p.email || "")));
  const diaryRows = (diary || []).filter(m => !!m.start).sort((a, b) => a.start.localeCompare(b.start));
  const pastMeetings = diaryRows.filter(m => m.start <= nowIso).slice(-5).reverse();
  const nextMeetings = diaryRows.filter(m => m.start > nowIso).slice(0, 3);
  const meetingOf = (m: DiaryMeeting) => ({ subject: m.subject, start: m.start, bgp: [...new Set((m.bgpParticipants || []).map(p => p.name))] });
  const lastTouch = iso(touches?.[0]?.at);
  const lastAt = [lastTouch, pastMeetings[0]?.start || null].filter((d): d is string => !!d).sort().at(-1) || null;
  return {
    id: String(company.id), name: String(company.name), noun: company.noun, ...(company.super_brand === true ? { superBrand: true } : {}),
    lastContactAt: lastAt, nextMeetingAt: nextMeetings[0]?.start || null,
    people: people ? shownPeople.map(p => ({ id: String(p.id), name: String(p.name || ""), role: p.role || null, email: p.email || null, phone: p.phone || null, lastContactAt: iso(p.last_at) })) : null,
    recent: touches ? touches.map(t => ({ id: String(t.id), type: String(t.type || ""), direction: t.direction || null, subject: t.subject || null, at: iso(t.at)!, bgpUser: t.bgp_user || null, contactName: t.contact_name || null })) : null,
    meetings: diary ? { past: pastMeetings.map(meetingOf), next: nextMeetings.map(meetingOf) } : null,
    deals: deals ? deals.map(d => ({ id: String(d.id), name: String(d.name || ""), status: d.status || null, dealType: d.deal_type || null, propertyName: d.property_name || null })) : null,
    openRequirements: requirements ? Number(requirements[0]?.n || 0) : null,
  };
}
