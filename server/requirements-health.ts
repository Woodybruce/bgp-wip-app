// Requirements health — the read-only count behind the requirements centre
// (Woody, 2026-11-12; docs/requirements-review-2026-11-12.md). Nobody could
// size the work without knowing what the tables hold: how many rows, from
// where, how old, in which state, and which ones no screen shows.
//
//   GET /api/admin/requirements-health  → requirementsHealthReport
//
// Reports, never repairs. Every section runs in its own try/catch so one
// missing table or column never hides the rest; a failed section carries
// { error } instead.
import type { Pool } from "pg";
import { requirementStateSql, REQUIREMENT_STATE_LABELS, REQUIREMENT_LIVE_DAYS, REQUIREMENT_TO_CONFIRM_DAYS, type RequirementState } from "@shared/requirement-live";

export interface HealthRow { label: string; count: number }
export interface HealthSection { key: string; title: string; note?: string; rows: HealthRow[]; error?: string }
export interface RequirementsHealthReport {
  generatedAt: string;
  liveDays: number;
  toConfirmDays: number;
  total: number | null;
  sections: HealthSection[];
}

const T = "crm_requirements_leasing";
// The free-text requirement date, in the two shapes the live rule reads.
const DATE_TEXT = `btrim(coalesce(r.requirement_date, ''))`;
const DATE_READABLE = `(${DATE_TEXT} ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])' OR ${DATE_TEXT} ~ '^(0?[1-9]|[12][0-9]|3[01])/(0?[1-9]|1[0-2])/(19|20)[0-9]{2}')`;
const DATE_VALUE = `(CASE
  WHEN ${DATE_TEXT} ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'
    THEN make_date(substr(${DATE_TEXT}, 1, 4)::int, substr(${DATE_TEXT}, 6, 2)::int, 1) + (substr(${DATE_TEXT}, 9, 2)::int - 1)
  WHEN ${DATE_TEXT} ~ '^(0?[1-9]|[12][0-9]|3[01])/(0?[1-9]|1[0-2])/(19|20)[0-9]{2}'
    THEN make_date(substr(split_part(${DATE_TEXT}, '/', 3), 1, 4)::int, split_part(${DATE_TEXT}, '/', 2)::int, 1) + (split_part(${DATE_TEXT}, '/', 1)::int - 1)
  ELSE NULL END)`;

const num = (v: any) => Number(v) || 0;

export async function requirementsHealthReport(pool: Pool): Promise<RequirementsHealthReport> {
  const sections: HealthSection[] = [];
  const section = async (key: string, title: string, note: string | undefined, run: () => Promise<HealthRow[]>) => {
    try { sections.push({ key, title, note, rows: await run() }); }
    catch (e: any) { sections.push({ key, title, note, rows: [], error: e?.message || String(e) }); }
  };
  const grouped = async (sql: string): Promise<HealthRow[]> =>
    (await pool.query(sql)).rows.map((r: any) => ({ label: String(r.label ?? "(blank)"), count: num(r.count) }));
  const one = async (sql: string): Promise<number> => num((await pool.query(sql)).rows[0]?.count);

  let total: number | null = null;
  try { total = await one(`SELECT count(*) AS count FROM ${T}`); } catch { total = null; }

  await section("state", "By state",
    `Worked out on read by the one live rule. Live = a named BGP person confirmed it within ${REQUIREMENT_LIVE_DAYS} days. Nothing was back-filled, so rows made before today read as To confirm or Background until somebody confirms them.`,
    async () => {
      const rows = await grouped(`SELECT ${requirementStateSql("r")} AS label, count(*) AS count FROM ${T} r GROUP BY 1`);
      const by = new Map(rows.map(r => [r.label, r.count]));
      return (Object.keys(REQUIREMENT_STATE_LABELS) as RequirementState[]).map(k => ({ label: REQUIREMENT_STATE_LABELS[k], count: by.get(k) || 0 }));
    });

  await section("status", "By status", "The page lists Active, Past and Archived only. Any other status is on no screen.",
    () => grouped(`SELECT coalesce(nullif(btrim(r.status), ''), '(blank)') AS label, count(*) AS count FROM ${T} r GROUP BY 1 ORDER BY 2 DESC`));

  await section("origin", "Whose record", "Stamped from 12 November 2026. 'Not stamped' rows were made before that and cannot be told apart by this column.",
    () => grouped(`SELECT CASE lower(btrim(coalesce(r.origin, ''))) WHEN 'bgp' THEN 'BGP''s own (made by a person)' WHEN 'pipnet' THEN 'PIPnet import' WHEN 'trl' THEN 'The Requirement List import' WHEN '' THEN 'Not stamped (older row)' ELSE r.origin END AS label, count(*) AS count FROM ${T} r GROUP BY 1 ORDER BY 2 DESC`));

  await section("sources", "By source label",
    "A row can carry several labels. A hand-added row had no label, and the PIPnet import then added 'PIPnet' to it, so 'PIPnet only' includes hand-made rows.",
    async () => {
      const r = (await pool.query(`
        SELECT count(*) FILTER (WHERE coalesce(cardinality(r.sources), 0) = 0) AS no_label,
               count(*) FILTER (WHERE r.sources = ARRAY['PIPnet']) AS pipnet_only,
               count(*) FILTER (WHERE r.sources = ARRAY['TRL']) AS trl_only,
               count(*) FILTER (WHERE 'PIPnet' = ANY(r.sources) AND 'TRL' = ANY(r.sources)) AS both_imports,
               count(*) FILTER (WHERE 'Viewing' = ANY(r.sources)) AS viewing,
               count(*) FILTER (WHERE coalesce(cardinality(r.sources), 0) > 0 AND NOT (r.sources <@ ARRAY['PIPnet','TRL','Viewing'])) AS other
          FROM ${T} r`)).rows[0] || {};
      return [
        { label: "No label", count: num(r.no_label) },
        { label: "PIPnet only", count: num(r.pipnet_only) },
        { label: "TRL only", count: num(r.trl_only) },
        { label: "PIPnet and TRL", count: num(r.both_imports) },
        { label: "Viewing (made from a viewing)", count: num(r.viewing) },
        { label: "Any other label", count: num(r.other) },
      ];
    });

  await section("age", "By age of the requirement date",
    "The requirement date is free text and means different things: PIPnet's listing date, a viewing date, or the day it was typed. It is not a confirmation date.",
    async () => {
      const r = (await pool.query(`
        SELECT count(*) FILTER (WHERE d >= current_date - 30) AS d30,
               count(*) FILTER (WHERE d < current_date - 30 AND d >= current_date - 90) AS d90,
               count(*) FILTER (WHERE d < current_date - 90 AND d >= current_date - 365) AS d365,
               count(*) FILTER (WHERE d < current_date - 365 AND d >= current_date - 730) AS d730,
               count(*) FILTER (WHERE d < current_date - 730) AS older,
               count(*) FILTER (WHERE d IS NULL) AS none
          FROM (SELECT ${DATE_VALUE} AS d FROM ${T} r) x`)).rows[0] || {};
      return [
        { label: "30 days or less", count: num(r.d30) },
        { label: "31 to 90 days", count: num(r.d90) },
        { label: "91 days to 12 months", count: num(r.d365) },
        { label: "1 to 2 years", count: num(r.d730) },
        { label: "Over 2 years", count: num(r.older) },
        { label: "No readable date", count: num(r.none) },
      ];
    });

  await section("dates", "Dates and confirmations", undefined, async () => {
    const r = (await pool.query(`
      SELECT count(*) FILTER (WHERE ${DATE_TEXT} = '') AS undated,
             count(*) FILTER (WHERE ${DATE_TEXT} <> '' AND NOT ${DATE_READABLE}) AS unreadable,
             count(*) FILTER (WHERE r.last_confirmed_at IS NOT NULL) AS confirmed,
             count(*) FILTER (WHERE r.last_listed_at IS NOT NULL) AS listed,
             count(*) FILTER (WHERE r.external_requirement_id IS NOT NULL) AS linked,
             count(*) FILTER (WHERE r.updated_at > r.created_at + interval '1 minute') AS edited
        FROM ${T} r`)).rows[0] || {};
    return [
      { label: "No requirement date at all", count: num(r.undated) },
      { label: "A date that cannot be read as a date", count: num(r.unreadable) },
      { label: "Confirmed by a named person", count: num(r.confirmed) },
      { label: "With a last-listed date from an import", count: num(r.listed) },
      { label: "Linked to its import record", count: num(r.linked) },
      { label: "Edited by hand since it was made", count: num(r.edited) },
    ];
  });

  await section("unreadable-dates", "Unreadable date text (the commonest)", "What people or imports typed where a date was expected.",
    () => grouped(`SELECT left(${DATE_TEXT}, 40) AS label, count(*) AS count FROM ${T} r WHERE ${DATE_TEXT} <> '' AND NOT ${DATE_READABLE} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`));

  await section("gaps", "Gaps", undefined, async () => {
    const r = (await pool.query(`
      SELECT count(*) FILTER (WHERE lower(btrim(coalesce(r.status, ''))) = 'draft') AS drafts,
             count(*) FILTER (WHERE r.company_id IS NULL) AS no_brand,
             count(*) FILTER (WHERE r.company_id IS NOT NULL AND c.id IS NULL) AS brand_gone,
             count(*) FILTER (WHERE c.archived_at IS NOT NULL) AS brand_hidden,
             count(*) FILTER (WHERE r.bgp_contact_user_id IS NULL AND coalesce(cardinality(r.bgp_contact_user_ids), 0) = 0) AS no_owner,
             count(*) FILTER (WHERE r.principal_contact_id IS NULL AND r.agent_contact_id IS NULL) AS no_contact,
             count(*) FILTER (WHERE r.monday_item_id IS NOT NULL) AS monday
        FROM ${T} r LEFT JOIN crm_companies c ON c.id = r.company_id`)).rows[0] || {};
    const dupes = await one(`SELECT count(*) AS count FROM (SELECT company_id FROM ${T} WHERE company_id IS NOT NULL GROUP BY company_id HAVING count(*) > 1) x`);
    return [
      { label: "Drafts (made from a viewing; listed first under To confirm)", count: num(r.drafts) },
      { label: "No brand link", count: num(r.no_brand) },
      { label: "Linked to a brand record that no longer exists", count: num(r.brand_gone) },
      { label: "Linked to a hidden brand", count: num(r.brand_hidden) },
      { label: "No BGP owner", count: num(r.no_owner) },
      { label: "No brand contact and no agent", count: num(r.no_contact) },
      { label: "Carried over from Monday", count: num(r.monday) },
      { label: "Brands with more than one requirement row", count: dupes },
    ];
  });

  await section("legacy", "Old 'requirements' table", "Where ChatBGP has been saving 'log a requirement'. No page reads it.",
    async () => {
      const totalLegacy = await one(`SELECT count(*) AS count FROM requirements`);
      const byStatus = await grouped(`SELECT 'Status: ' || coalesce(nullif(btrim(status), ''), '(blank)') AS label, count(*) AS count FROM requirements GROUP BY 1 ORDER BY 2 DESC`);
      return [{ label: "Rows", count: totalLegacy }, ...byStatus];
    });

  await section("staging", "Import records (PIPnet and The Requirement List)", "The listings as imported, before they become a row on the page.",
    async () => {
      const rows = (await pool.query(`SELECT source, coalesce(status, '(blank)') AS status, count(*) AS count FROM external_requirements GROUP BY 1, 2 ORDER BY 1, 3 DESC`)).rows;
      return rows.map((r: any) => ({ label: `${r.source}: ${r.status}`, count: num(r.count) }));
    });

  await section("staging-last", "Days since each import last saw a listing", "Only PIPnet runs by itself (05:30). The Requirement List refreshes when someone presses Refresh TRL.",
    async () => {
      const rows = (await pool.query(`SELECT source, max(updated_at) AS last FROM external_requirements GROUP BY 1 ORDER BY 1`)).rows;
      return rows.map((r: any) => ({
        label: `${r.source}${r.last ? ` (last ${new Date(r.last).toISOString().slice(0, 10)})` : " (never)"}`,
        count: r.last ? Math.max(0, Math.floor((Date.now() - new Date(r.last).getTime()) / 86400000)) : 0,
      }));
    });

  await section("tenant-rep", "Tenant Rep board", "'Looks auto-made' = made for a deal at Negotiating by the WIP import and never filled in: a deal, but no use, size, location, budget, notes, contact, next action or person.",
    async () => {
      const r = (await pool.query(`
        SELECT count(*) AS total,
               count(*) FILTER (WHERE deal_id IS NOT NULL) AS with_deal,
               count(*) FILTER (WHERE deal_id IS NOT NULL
                 AND coalesce(cardinality(target_use), 0) = 0 AND coalesce(cardinality(target_locations), 0) = 0
                 AND size_min IS NULL AND size_max IS NULL AND budget_min IS NULL AND budget_max IS NULL
                 AND coalesce(btrim(notes), '') = '' AND coalesce(btrim(next_action), '') = ''
                 AND contact_id IS NULL AND coalesce(btrim(assigned_to), '') = '') AS auto_made,
               count(*) FILTER (WHERE company_id IS NULL) AS no_brand
          FROM tenant_rep_searches`)).rows[0] || {};
      const byStatus = await grouped(`SELECT 'Status: ' || coalesce(nullif(btrim(status), ''), '(blank)') AS label, count(*) AS count FROM tenant_rep_searches GROUP BY 1 ORDER BY 2 DESC`);
      return [
        { label: "Rows", count: num(r.total) },
        { label: "Linked to a deal", count: num(r.with_deal) },
        { label: "Looks auto-made", count: num(r.auto_made) },
        { label: "No brand link", count: num(r.no_brand) },
        ...byStatus,
      ];
    });

  await section("evidence", "Evidence and suggestions", "Suggestions wait for a person to confirm, attach or dismiss them.",
    () => grouped(`SELECT status || ' (' || created_by_kind || ')' AS label, count(*) AS count FROM requirement_evidence GROUP BY 1 ORDER BY 2 DESC`));

  return { generatedAt: new Date().toISOString(), liveDays: REQUIREMENT_LIVE_DAYS, toConfirmDays: REQUIREMENT_TO_CONFIRM_DAYS, total, sections };
}
