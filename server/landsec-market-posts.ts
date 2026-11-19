// What BGP's own team wrote about brands in the period, for the Landsec market
// report (Woody, 2026-11-19: "including all the info we get each month from
// the team"; and "this is landsec they should have intel that we do").
//
// RAW TALK IS NEVER PRINTED BY ITSELF. A post goes two places only: to the
// draft of a section (BGP staff ask for a draft, then edit and save it), and
// to the editor's list under the section, where a BGP person ticks "Add to
// the report" to put the post's words in the section's box, to edit and save.
// Only saved words are on a slide. A Landsec login is never sent this list.
//
// A post is read only from a conversation the requirement feed would read
// (server/requirement-feeds.ts, threadIsStaffOnly): never a ChatBGP chat,
// never a record's shared conversation, never one linked to a property, a deal
// or a company, and only where the creator, the poster and every member is a
// BGP person. One client login, one joint agent, or one member who cannot be
// found, and the conversation is left alone. Only posts that tag a tenant
// brand. Two queries, whatever the number of posts.
import { pool } from "./db";
import { landsecCategoryOf } from "@shared/landsec";
import { reportDay, type ReportPeriod } from "@shared/landsec-reports";
import { marketGroupOf, sectionOfGroup, type MarketTeamPost } from "@shared/landsec-market-report";

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

const STAFF_DOMAIN = "@brucegillinghampollard.com";
const COMPANY_TAG = /@\[([^\]]+)\]\(tag:company\/([^)\s]+)\)/g;
const ANY_TAG = /@\[([^\]]+)\]\(tag:[a-z]+\/[^)\s]+\)/g;

export async function teamPosts(period: ReportPeriod, db: Queryable = pool): Promise<MarketTeamPost[]> {
  const rows = (await db.query(
    `/* landsec-market-posts:posts */
     SELECT m.id, m.content, m.created_at
       FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
      WHERE m.role = 'user' AND m.created_at >= $1::date - 1 AND m.created_at < $2::date + 1
        AND m.content LIKE '%](tag:company/%'
        AND t.is_ai_chat IS NOT TRUE AND t.created_by <> '__record__'
        AND COALESCE(t.linked_type, '') IN ('', 'channel')
        AND NOT EXISTS (
          SELECT 1
            FROM (SELECT t.created_by AS person UNION SELECT m.user_id UNION SELECT tm.user_id FROM chat_thread_members tm WHERE tm.thread_id = t.id) who
            LEFT JOIN users u ON u.id = who.person
           WHERE who.person IS NULL OR u.id IS NULL
              OR lower(trim(COALESCE(u.email, ''))) NOT LIKE '%${STAFF_DOMAIN}'
              OR lower(trim(COALESCE(u.role, ''))) = 'client')
      ORDER BY m.created_at DESC LIMIT 600`, [period.start, period.end])).rows;
  const tagged = (content: string): string[] => Array.from(new Set(Array.from(content.matchAll(COMPANY_TAG)).map(m => m[2])));
  const ids = Array.from(new Set(rows.flatMap(r => tagged(String(r.content || "")))));
  if (ids.length === 0) return [];
  const brands = new Map<string, { name: string; type: string }>();
  for (const b of (await db.query(
    `/* landsec-market-posts:brands */
     SELECT c.id, c.name, c.company_type FROM crm_companies c
      WHERE c.id = ANY($1::varchar[]) AND c.company_type ILIKE 'tenant%' AND c.archived_at IS NULL AND c.merged_into_id IS NULL`, [ids])).rows) brands.set(String(b.id), { name: String(b.name), type: String(b.company_type || "") });
  const out: MarketTeamPost[] = [];
  for (const r of rows) {
    const content = String(r.content || "");
    const about = tagged(content).map(id => brands.get(id)).filter((b): b is { name: string; type: string } => !!b);
    const day = reportDay(r.created_at);
    const text = content.replace(ANY_TAG, "$1").replace(/\s+/g, " ").trim();
    if (!about.length || !day || day < period.start || day >= period.end || text.length < 20) continue;
    out.push({ id: String(r.id), section: sectionOfGroup(marketGroupOf(landsecCategoryOf(about[0].type))) || "overall", day, brands: about.map(b => b.name), text: text.slice(0, 700) });
  }
  return out;
}
