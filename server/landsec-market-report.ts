// The Landsec market report: what is read for it (Woody, 2026-11-19: "The
// market analysis reports need to be surrounding the brands and who's doing
// what news etc including all the info we get each month from the team news
// propel etc ... But also to include any competition news such as buying
// shopping centres or their leasing ie Hammerson and Canary Wharf"; and on
// what Landsec may be shown, "Ignore Jack! This is landsec they should have
// intel that we do including other schemes").
//
// The rules are shared/landsec-market-report.ts. The brand rows (signals,
// store counts, planning and jobs, requirements) are read by
// server/landsec-board-industry.ts; this file reads the rest and puts it all
// together:
//   - a change of owner the ownership read found (crm_companies);
//   - public news that names a landlord or a competing centre (news_articles
//     from public sources only, by headline: never a story's text);
//   - the weekly research on the benchmark centres that are not the viewer's;
//   - the market patterns the Insights feed drew from public news and the
//     trade newsletters (cards every client login is already shown);
//   - the research papers the investment team has read: publisher, month,
//     headline and checked figures, never the paper;
//   - lettings BGP has recorded at schemes that are NOT the viewer's: the
//     brand, the scheme, its landlord, the day and the stage, and nothing
//     else. Whether one that is not yet done is read at all is
//     OTHER_SCHEMES_LEVEL;
//   - completed sales from the investment comparables, and (at "live") the
//     Investment Tracker's assets with their stage and no price.
//
// Every value is named, key by key. What a letting pays, its incentives and
// terms, what BGP earns, who runs it, a contact, BGP's remarks, compliance
// working and a deal's reference are never read here: the guard test holds
// this file to the tables and columns below. A fixed number of queries,
// whatever the number of brands; each may fail on its own to "not available".
// Nothing is asked of any outside service and nothing runs on a timer.
import { pool } from "./db";
import type { LandsecViewer } from "./landsec-access";
import type { Ctx } from "./landsec-reports";
import type { BoardData } from "./landsec-board-report";
import { resolveLandsecPortfolio } from "./landsec-schemes";
import { LANDLORD_CATALOGUE_PREDICATE } from "./landlord-meeting-matching";
import { publicNewsSourceSql } from "./news-ingestion";
import { isPublishableInsight } from "./insights-source-policy";
import { insightPublisherOf } from "./insights-feed";
import { landsecCategoryOf, type LandsecCategoryOrOther } from "@shared/landsec";
import { reportDay, type ReportPeriod } from "@shared/landsec-reports";
import { isJunkBrand } from "@shared/junk-brand";
import { lettingTypeSqlList } from "@shared/letting-rules";
import { OWNERSHIP_KIND_LABEL } from "@shared/ownership-intel";
import { compTrackerClass, trackerClass } from "@shared/tracker-class";
import {
  OTHER_SCHEMES_LEVEL, competitionItems, competitionSubjects, marketItems, researchLines, themeSection,
  type CompetitionArticle, type CompetitionResearchRow, type CompetitionSaleRow, type CompetitionSubject, type MarketData, type MarketLettingRow,
  type MarketOwnerRow, type MarketResearchRead, type MarketTheme, type OtherSchemesLevel,
} from "@shared/landsec-market-report";

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

const BRAND = `c.company_type ILIKE 'tenant%' AND c.archived_at IS NULL AND c.merged_into_id IS NULL`;
const kept = (row: any): { category: LandsecCategoryOrOther | null } | null =>
  (isJunkBrand({ name: row.name, companyType: row.company_type }) ? null : { category: landsecCategoryOf(row.company_type) });

async function attempt<T>(label: string, failed: string[], run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (e: any) { console.warn(`[landsec-market-report] ${label}: ${e?.message}`); failed.push(label); return null; }
}

/** The stages of a letting that is done, and of one still running, as the deal's status holds them. */
const DONE = ["EXC", "COM", "INV"], RUNNING = ["NEG", "HOT", "SOL"];
const STAGE: Record<string, MarketLettingRow["stage"]> = { NEG: "negotiating", HOT: "hots", SOL: "solicitors", EXC: "exchanged", COM: "completed", INV: "completed" };

/** A change of owner the weekly ownership read found: the owner now, the owner before, the day the change was read. */
export async function ownerChanges(db: Queryable = pool): Promise<MarketOwnerRow[]> {
  const rows = (await db.query(
    `/* landsec-market-report:owners */
     SELECT c.id, c.name, c.company_type, c.ai_generated_fields->'ownership_intel' AS owner_read
       FROM crm_companies c
      WHERE ${BRAND} AND c.ai_generated_fields->'ownership_intel'->'previous' IS NOT NULL`)).rows;
  const out: MarketOwnerRow[] = [];
  for (const r of rows) {
    const brand = kept(r), read = r.owner_read || {};
    if (!brand || !read.owner || !read.previous?.owner) continue;
    out.push({ brandId: String(r.id), brand: String(r.name), category: brand.category, owner: String(read.owner), ownerKind: (OWNERSHIP_KIND_LABEL as Record<string, string>)[String(read.kind)] || "", previous: String(read.previous.owner), day: reportDay(read.previous.until), source: read.source ? String(read.source) : read.viaUrl ? String(read.viaUrl) : null });
  }
  return out;
}

/** The landlords BGP holds a record for, by name, and the viewer's own name. Names only. */
async function landlordNames(viewer: LandsecViewer, db: Queryable): Promise<{ names: string[]; own: string[] }> {
  const rows = (await db.query(`/* landsec-market-report:landlords */ SELECT c.id, c.name FROM crm_companies c WHERE ${LANDLORD_CATALOGUE_PREDICATE} ORDER BY c.name LIMIT 4000`)).rows;
  const own = rows.filter(r => String(r.id) === viewer.companyId).map(r => String(r.name));
  return { names: rows.filter(r => String(r.id) !== viewer.companyId).map(r => String(r.name || "")).filter(Boolean), own };
}

const posix = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Public news of the period that may be about a landlord or a centre: property and investment feeds, and any public headline that names one. Headline, link, publisher and day only. */
async function competitionArticles(period: ReportPeriod, subjects: CompetitionSubject[], db: Queryable): Promise<CompetitionArticle[]> {
  const names = Array.from(new Set(subjects.flatMap(s => [s.name, ...s.aliases]).map(n => n.trim()).filter(n => n.replace(/\W/g, "").length >= 4))).slice(0, 700);
  const named = names.length ? `(${names.map(posix).join("|")})` : "^$a";
  const rows = (await db.query(
    `/* landsec-market-report:news */
     SELECT n.title, n.url, COALESCE(n.source_name, ns.name) AS source_name, n.published_at
       FROM news_articles n JOIN news_sources ns ON ns.id = n.source_id
      WHERE ${publicNewsSourceSql("ns")}
        AND n.published_at >= $1::date - 1 AND n.published_at < $2::date + 1
        AND n.url ~* '^https?://'
        AND (lower(COALESCE(ns.category, '')) IN ('property', 'investment') OR ns.type IN ('market_landlord', 'market_centre', 'market_openings') OR n.title ~* $3)
      ORDER BY n.published_at DESC LIMIT 6000`, [period.start, period.end, named])).rows;
  return rows.map((r: any): CompetitionArticle => ({ title: String(r.title || ""), url: String(r.url || ""), sourceName: r.source_name ? String(r.source_name) : null, day: reportDay(r.published_at) }));
}

/** The benchmark centres with their owners, and the dated research on the ones that are not the viewer's own. */
async function centreResearch(ownPropertyIds: Set<string>): Promise<{ centres: Array<{ name: string; aliases: string[]; owner: string | null; own: boolean }>; research: CompetitionResearchRow[] }> {
  const { benchmarkCentres, centreRecords } = await import("./benchmark-centres");
  const list = benchmarkCentres();
  const records = await centreRecords(list);
  const research: CompetitionResearchRow[] = [];
  const centres = list.map(c => {
    const record = records.get(c.name);
    const own = !!record && ownPropertyIds.has(record.id);
    if (record && !own) for (const item of (Array.isArray(record.research?.items) ? record.research.items : [])) {
      if (!item?.source_url || !/^https?:\/\//i.test(String(item.source_url))) continue;
      research.push({ centre: c.name, kind: String(item.kind || "other"), headline: String(item.headline || "").trim(), source: String(item.source_url), day: item.date ? String(item.date) : null });
    }
    return { name: c.name, aliases: c.aliases, owner: record?.landlordName || null, own };
  });
  return { centres, research };
}

/** The market patterns the Insights feed drew from public news and the trade newsletters: the cards any client login is shown, and no other. */
async function themes(period: ReportPeriod, db: Queryable): Promise<MarketTheme[]> {
  const rows = (await db.query(
    `/* landsec-market-report:themes */
     SELECT i.headline, i.detail, i.category, i.source_kind, i.evidence, i.created_at
       FROM insights i
      WHERE i.audience = 'all' AND i.source_kind IN ('news', 'market-report')
        AND i.created_at >= $1::date - 1 AND i.created_at < $2::date + 1
      ORDER BY i.created_at DESC LIMIT 400`, [period.start, period.end])).rows;
  const out: MarketTheme[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const headline = String(r.headline || "").replace(/\s+/g, " ").trim(), day = reportDay(r.created_at);
    if (!headline || seen.has(headline.toLowerCase()) || !isPublishableInsight(r)) continue;
    seen.add(headline.toLowerCase());
    const source = r.source_kind === "market-report" ? insightPublisherOf(r.evidence) || "Trade newsletters" : "Public news";
    out.push({ section: themeSection(r.category), headline, detail: r.detail ? String(r.detail).replace(/\s+/g, " ").trim() : null, day, source });
  }
  return out;
}

/** The research papers the investment team has read: who published each and when, our one-line headline, and the figures its reader checked against the paper. */
async function researchReads(db: Queryable): Promise<MarketResearchRead[]> {
  const rows = (await db.query(
    `/* landsec-market-report:research */
     SELECT k.category, r.published, r.publisher, r.headline, r.facts, r.read_at
       FROM investment_research_reads r JOIN knowledge_base k ON k.id = r.research_id
      WHERE r.status = 'read' AND k.source = 'investment-research'
      ORDER BY r.read_at DESC LIMIT 400`)).rows;
  return rows.map((r: any): MarketResearchRead => ({
    publisher: r.publisher ? String(r.publisher) : null, published: r.published ? String(r.published) : null, day: reportDay(r.read_at), sector: r.category ? String(r.category) : null,
    headline: String(r.headline || ""),
    figures: (Array.isArray(r.facts) ? r.facts : []).map((f: any) => ({ topic: String(f?.topic || ""), figure: String(f?.figure || ""), place: f?.place ? String(f.place) : null, period: f?.period ? String(f.period) : null })),
  }));
}

/**
 * Lettings BGP has recorded at schemes that are not the viewer's: the brand,
 * the scheme, its landlord, the day it exchanged or completed, and its stage.
 * One still running is read only at "live". Nothing else of the deal is read.
 */
export async function otherSchemeLettings(viewer: LandsecViewer, ownPropertyIds: string[], period: ReportPeriod, level: OtherSchemesLevel, db: Queryable = pool): Promise<MarketLettingRow[]> {
  const stages = level === "live" ? [...DONE, ...RUNNING] : DONE;
  const rows = (await db.query(
    `/* landsec-market-report:lettings */
     SELECT d.tenant_id, c.name, c.company_type, p.name AS scheme, l.name AS landlord, d.status, d.exchanged_at, d.completed_at
       FROM crm_deals d
       JOIN crm_companies c ON c.id = d.tenant_id
       JOIN crm_properties p ON p.id = d.property_id
       LEFT JOIN crm_companies l ON l.id = COALESCE(p.landlord_id, d.landlord_id)
      WHERE ${BRAND} AND d.deal_type IN (${lettingTypeSqlList()}) AND d.status = ANY($1::text[])
        AND NOT (d.property_id = ANY($2::varchar[])) AND COALESCE(p.landlord_id, d.landlord_id, '') <> $3
        AND (d.status = ANY($4::text[]) OR GREATEST(COALESCE(d.exchanged_at, 'epoch'::timestamp), COALESCE(d.completed_at, 'epoch'::timestamp)) >= $5::date - 1)
      ORDER BY COALESCE(d.completed_at, d.exchanged_at) DESC NULLS LAST LIMIT 3000`,
    [stages, ownPropertyIds, viewer.companyId, RUNNING, period.start])).rows;
  const out: MarketLettingRow[] = [];
  for (const r of rows) {
    const brand = kept(r), stage = STAGE[String(r.status)];
    if (!brand || !stage || !r.scheme) continue;
    const exchanged = reportDay(r.exchanged_at), completed = reportDay(r.completed_at);
    const inPeriod = (day: string | null) => !!day && day >= period.start && day < period.end;
    // A done letting is listed on the day it exchanged, else the day it completed, whichever falls in the period.
    const day = RUNNING.includes(String(r.status)) ? null : inPeriod(exchanged) ? exchanged : inPeriod(completed) ? completed : exchanged || completed;
    out.push({ brandId: String(r.tenant_id), brand: String(r.name), category: brand.category, scheme: String(r.scheme), landlord: r.landlord ? String(r.landlord) : null, day, stage: stage === "completed" && inPeriod(exchanged) && !inPeriod(completed) ? "exchanged" : stage });
  }
  return out;
}

// A sale is the competition's when it is of a shopping centre, a retail park or a leisure scheme: the classes the Investment Tracker files those under.
const CENTRE_CLASSES: readonly string[] = ["Retail - Shopping Centre", "London Shopping Centre", "Retail Parks", "Leisure Schemes"];

/** Completed sales of shopping and leisure property from the investment comparables; at "live", the Investment Tracker's assets with their stage and no price. */
export async function centreSales(period: ReportPeriod, level: OtherSchemesLevel, db: Queryable = pool): Promise<CompetitionSaleRow[]> {
  const sold = (await db.query(
    `/* landsec-market-report:sales */
     SELECT s.property_name, s.city, s.buyer, s.seller, s.price, s.cap_rate, s.transaction_date, s.subtype, s.transaction_type
       FROM investment_comps s
      WHERE s.transaction_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND left(s.transaction_date, 10) >= $1 AND left(s.transaction_date, 10) < $2
        AND COALESCE(s.status, '') !~* '(terminat|withdraw|pending|under offer|quoting|on the market|refinanc)'
      ORDER BY s.transaction_date DESC LIMIT 2000`, [period.start, period.end])).rows;
  const out: CompetitionSaleRow[] = sold.filter((r: any) => CENTRE_CLASSES.includes(compTrackerClass({ subtype: r.subtype, transactionType: r.transaction_type, propertyName: r.property_name }))).map((r: any): CompetitionSaleRow => ({
    property: String(r.property_name || ""), place: r.city ? String(r.city) : null, buyer: r.buyer ? String(r.buyer) : null, seller: r.seller ? String(r.seller) : null,
    price: Number(r.price) > 0 ? Number(r.price) : null, yieldPct: Number(r.cap_rate) > 0 ? (Number(r.cap_rate) < 1 ? Number(r.cap_rate) * 100 : Number(r.cap_rate)) : null,
    day: reportDay(r.transaction_date), live: false,
  }));
  if (level !== "live") return out;
  const running = (await db.query(
    `/* landsec-market-report:tracker */
     SELECT t.asset_name, t.asset_type, t.address, t.tenure, t.status
       FROM investment_tracker t
      WHERE t.status IN ('AVA', 'Live', 'SOL') OR t.status ILIKE 'U/O%' OR t.status ILIKE 'under offer%'
      ORDER BY t.asset_name LIMIT 2000`)).rows;
  const stage = (s: string) => (/^sol/i.test(s) ? "with solicitors" : /^(u\/o|under offer)/i.test(s) ? "under offer" : "on the market");
  for (const r of running) if (r.asset_name && CENTRE_CLASSES.includes(trackerClass({ assetType: r.asset_type, assetName: r.asset_name, address: typeof r.address === "string" ? r.address : null, tenure: r.tenure }).cls)) out.push({ property: String(r.asset_name), place: null, buyer: null, seller: null, price: null, yieldPct: null, day: null, live: true, status: stage(String(r.status || "")) });
  return out;
}

/** Everything the market report holds for the period and the viewer, put together and in order. */
export async function marketData(ctx: Ctx, viewer: LandsecViewer, data: BoardData, level: OtherSchemesLevel = OTHER_SCHEMES_LEVEL, db: Queryable = pool): Promise<MarketData> {
  const failed: string[] = [];
  const portfolio = await resolveLandsecPortfolio(viewer.companyId);
  const ownIds = Array.from(new Set([...portfolio.schemes.flatMap(s => s.properties.map(p => p.id)), ...portfolio.outOfScope.map(p => p.id)]));
  const [owners, landlords, centres, themeRows, reads, lettings, sales] = await Promise.all([
    attempt("changes of owner", failed, () => ownerChanges(db)),
    attempt("landlord names", failed, () => landlordNames(viewer, db)),
    attempt("centre research", failed, () => centreResearch(new Set(ownIds))),
    attempt("market themes", failed, () => themes(ctx.period, db)),
    // No paper has been read on a database that has no table for them yet: that is none, not a failure.
    attempt("research papers", failed, () => researchReads(db).catch((e: any) => { if (e?.code === "42P01") return [] as MarketResearchRead[]; throw e; })),
    attempt("lettings at other schemes", failed, () => otherSchemeLettings(viewer, ownIds, ctx.period, level, db)),
    attempt("sales of centres", failed, () => centreSales(ctx.period, level, db)),
  ]);
  const subjects = competitionSubjects({
    landlords: landlords?.names || [],
    centres: (centres?.centres || []).filter(c => !c.own),
    own: [...(landlords?.own || []), "Landsec", "Land Securities", ...portfolio.schemes.map(s => s.name), ...(centres?.centres || []).filter(c => c.own).map(c => c.name)],
  });
  const articles = await attempt("landlord and centre news", failed, () => competitionArticles(ctx.period, subjects, db));
  const rows = data.industryRows;
  for (const [label, list] of [["brand news", rows.signals], ["store counts", rows.snapshots], ["planning and jobs", rows.pipeline], ["requirements", rows.requirements]] as const) if (!list) failed.push(label);
  return {
    level,
    items: marketItems({
      signals: rows.signals, snapshots: rows.snapshots, pipeline: rows.pipeline, owners, requirements: rows.requirements,
      ownActivity: data.ownActivity, lettings, trading: data.tradingBrandIds, targets: data.targetBrandIds,
    }, ctx.period, level),
    competition: competitionItems({ articles, research: centres?.research || null, lettings, sales, subjects }, ctx.period, level),
    research: reads ? researchLines(reads, ctx.period) : [],
    themes: themeRows || [],
    notAvailable: failed,
  };
}

/** The Market report's items as a workbook: every item by sector, the competition, the movers, the research and the themes. */
export async function marketWorkbook(def: import("@shared/landsec-reports").LandsecReportDef, ctx: Ctx, viewer: LandsecViewer): Promise<Buffer> {
  const { boardData } = await import("./landsec-board-report");
  const { workbookOf } = await import("./landsec-reports");
  const { COMPETITION_THEMES, MARKET_GROUPS, MARKET_SOURCES, MARKET_WORD_SECTIONS, marketGroupOf, marketKindLabel, marketMovers } = await import("@shared/landsec-market-report");
  const { landsecCategoryLabel } = await import("@shared/landsec");
  const data = await marketData(ctx, viewer, await boardData(ctx, viewer));
  const section = (key: string) => MARKET_WORD_SECTIONS.find(s => s.key === key)?.title || "Overall";
  const yes = (v: boolean) => (v ? "Yes" : "");
  return workbookOf(def, ctx, [
    {
      name: "Items",
      columns: [
        { header: "Sector", key: "sector", width: 22 }, { header: "Category", key: "category", width: 26 }, { header: "Date", key: "day", width: 13, kind: "date" }, { header: "Brand", key: "brand", width: 26 },
        { header: "Kind", key: "kind", width: 22 }, { header: "What happened", key: "line", width: 110 }, { header: "Source", key: "source", width: 24 }, { header: "From", key: "origin", width: 16 },
        { header: "At your schemes", key: "atSchemes", width: 14 }, { header: "Target", key: "target", width: 9 },
      ],
      rows: data.items.slice().sort((a, b) => MARKET_GROUPS.indexOf(marketGroupOf(a.category)) - MARKET_GROUPS.indexOf(marketGroupOf(b.category))).map(i => ({
        sector: marketGroupOf(i.category), category: landsecCategoryLabel(i.category) || "Not in a brief category", day: i.day, brand: i.brand, kind: marketKindLabel(i.kind), line: i.line, source: i.source,
        origin: i.origin === "bgp" ? "BGP records" : "Public report", atSchemes: yes(i.atSchemes), target: yes(i.target),
      })),
      caption: MARKET_SOURCES,
    },
    {
      name: "Competition",
      columns: [{ header: "Theme", key: "theme", width: 30 }, { header: "Date", key: "day", width: 13, kind: "date" }, { header: "Landlord or centre", key: "subject", width: 30 }, { header: "What happened", key: "line", width: 110 }, { header: "Source", key: "source", width: 24 }, { header: "From", key: "origin", width: 16 }],
      rows: data.competition.map(c => ({ theme: COMPETITION_THEMES.find(t => t.key === c.theme)?.title || "", day: c.day, subject: c.subject, line: c.line, source: c.source, origin: c.origin === "bgp" ? "BGP records" : "Public report" })),
      caption: "Other landlords and competing centres: public reports named by their source, the research on the benchmark centres, lettings BGP has recorded at other schemes and sales of centres. A row marked Live is not done.",
    },
    {
      name: "Most active brands",
      columns: [{ header: "Sector", key: "sector", width: 22 }, { header: "Brand", key: "brand", width: 28 }, { header: "Evidence in the period", key: "evidence", width: 90 }, { header: "At your schemes", key: "atSchemes", width: 14 }, { header: "Target", key: "target", width: 9 }],
      rows: MARKET_GROUPS.flatMap(group => marketMovers(data.items, group, 25).map(m => ({ sector: group, brand: m.brand, evidence: m.evidence, atSchemes: yes(m.atSchemes), target: yes(m.target) }))),
    },
    {
      name: "Research",
      columns: [{ header: "Publisher and month", key: "by", width: 30 }, { header: "Sector", key: "sector", width: 22 }, { header: "What it says", key: "headline", width: 100 }, { header: "Checked figures", key: "figures", width: 80 }],
      rows: data.research.map(r => ({ by: r.by, sector: section(r.section), headline: r.headline, figures: r.figures.join("; ") })),
      caption: "Research papers the team has read: publisher, month, headline and the figures the reader checked against the paper.",
    },
    {
      name: "Themes",
      columns: [{ header: "Date", key: "day", width: 13, kind: "date" }, { header: "Sector", key: "sector", width: 22 }, { header: "Theme", key: "headline", width: 80 }, { header: "Why it matters", key: "detail", width: 100 }, { header: "Drawn from", key: "source", width: 24 }],
      rows: data.themes.map(t => ({ day: t.day, sector: section(t.section), headline: t.headline, detail: t.detail || "", source: t.source })),
    },
  ], data.notAvailable.length ? [["Not available", `${data.notAvailable.join(", ")}. Nothing was put in their place.`]] : []);
}
