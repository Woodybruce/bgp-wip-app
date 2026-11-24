// Suggested sub companies for a company (Woody, 24 November 2026: "if we put
// the top company in then using our search facility to be able to have a
// suggestion of sub companies or linked companies? Not exhaustive but
// helpful prompts"). Read on request, never at boot or on a timer, and
// nothing is filed by the read: a person ticks a suggestion and adds it
// through the billing entity route, and nothing is checked until they ask.
//
//   GET /api/client-kyc/:companyId/suggestions[?refresh=1]
//
// Sources: Companies House (the top company's officers and their other
// appointments, a search by the start of its name, and each candidate's
// persons with significant control), Land Registry's company ownership lists
// loaded in the app (titles owned under a name that starts the same way), and
// GLEIF (the LEI's recorded subsidiaries). The rules and the words are
// shared/kyc-suggestions.ts. BGP staff signed in as themselves only.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { GLEIF_UK_REGISTERS } from "@shared/foreign-owner-words";
import { gleifEntityFrom, pickGleifRecord, type GleifEntity } from "@shared/foreign-owners";
import {
  nameStems, normaliseCompanyNumber, rankSuggestions, startsWithStem,
  type KycSuggestion, type KycSuggestionCandidate, type KycSuggestionSource,
} from "@shared/kyc-suggestions";

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

export interface SuggestionSourceLine { source: KycSuggestionSource; read: boolean; words: string }
export interface KycSuggestionsResult {
  companyId: string;
  top: { name: string; number: string | null } | null;
  suggestions: KycSuggestion[];
  sources: SuggestionSourceLine[];
  readAt: string;
}

export interface SuggestionDeps {
  query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
  // Companies House (null when no key is set on this machine).
  ch: ((path: string) => Promise<any>) | null;
  // GLEIF (null when switched off).
  gleif: {
    search: (q: { name: string; country: string | null; registrationNumber: string | null; authorities?: string[] | null }) => Promise<GleifEntity[]>;
    get: (path: string, params?: Record<string, string>) => Promise<any | null>;
  } | null;
}

const MAX_OFFICERS = 8;      // officers whose other appointments are read
const MAX_PSC_READS = 10;    // candidates whose owners are read
const CH_REGISTERS = Object.entries(GLEIF_UK_REGISTERS).filter(([, r]) => r.register === "companies_house").map(([ra]) => ra);

/** "SMITH, Jane Anne" → "Jane Anne Smith"; a company officer keeps its name. */
export function officerName(raw: unknown, corporate: boolean): string {
  const s = text(raw);
  if (corporate || !s.includes(",")) return s;
  const [surname, rest] = [s.slice(0, s.indexOf(",")), s.slice(s.indexOf(",") + 1)];
  const title = (w: string) => w.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
  return `${text(rest)} ${title(text(surname))}`.trim();
}

const isCorporateOfficer = (o: any): boolean => !!o?.identification || /corporate/.test(String(o?.officer_role || ""));
const postcode = (v: unknown): string => text(v).toUpperCase().replace(/\s+/g, "");

/** The candidates Companies House gives: the officers' other companies, the name search, then who owns each. */
export async function companiesHouseCandidates(
  ch: (path: string) => Promise<any>,
  top: { name: string; number: string | null },
  stems: string[],
  known: { numbers: Set<string>; names: Set<string> },
): Promise<{ candidates: KycSuggestionCandidate[]; words: string }> {
  const out: KycSuggestionCandidate[] = [];
  const said: string[] = [];
  let office: string | null = null;
  if (top.number) {
    const profile = await ch(`/company/${encodeURIComponent(top.number)}`).catch(() => null);
    office = postcode(profile?.registered_office_address?.postal_code) || null;
    const officers = ((await ch(`/company/${encodeURIComponent(top.number)}/officers?items_per_page=100`).catch(() => null))?.items || [])
      .filter((o: any) => !o?.resigned_on && o?.links?.officer?.appointments);
    // Company officers first (a group's corporate director or secretary is the strongest tie), then directors.
    const ranked = [...officers].sort((a: any, b: any) =>
      Number(isCorporateOfficer(b)) - Number(isCorporateOfficer(a))
      || Number(/director|member/.test(String(b.officer_role))) - Number(/director|member/.test(String(a.officer_role))));
    const read = ranked.slice(0, MAX_OFFICERS);
    for (const o of read) {
      const corporate = isCorporateOfficer(o);
      const who = officerName(o.name, corporate);
      const appts = (await ch(`${o.links.officer.appointments}?items_per_page=50`).catch(() => null))?.items || [];
      for (const a of appts) {
        if (a?.resigned_on) continue;
        const to = a?.appointed_to || {};
        const number = normaliseCompanyNumber(to.company_number);
        if (!number || number === normaliseCompanyNumber(top.number)) continue;
        out.push({
          source: "companies_house", name: text(to.company_name), number, status: text(to.company_status) || null,
          ...(corporate ? { sharedCorporateOfficer: who } : { sharedOfficers: [who] }),
          nameMatch: startsWithStem(text(to.company_name), stems),
        });
      }
    }
    said.push(read.length ? `${read.length} officer${read.length === 1 ? "" : "s"}' other companies` : "no current officers");
  }
  for (const stem of stems.slice(0, 2)) {
    const hits = (await ch(`/search/companies?q=${encodeURIComponent(stem)}&items_per_page=50`).catch(() => null))?.items || [];
    let kept = 0;
    for (const h of hits) {
      const name = text(h?.title);
      if (!startsWithStem(name, stems)) continue;
      const number = normaliseCompanyNumber(h?.company_number);
      if (!number || number === normaliseCompanyNumber(top.number)) continue;
      kept++;
      out.push({ source: "companies_house", name, number, status: text(h?.company_status) || null, nameMatch: true, sameOffice: !!office && postcode(h?.address?.postal_code) === office });
    }
    said.push(`a search for "${stem}" (${kept} found)`);
  }
  // Who owns the strongest candidates: a company with significant control that is
  // the top company, one filed under it, or another candidate here.
  const byNumber = new Map<string, { name: string; status: string | null; weight: number; officers: Set<string> }>();
  for (const c of out) {
    if (!c.number || known.numbers.has(c.number)) continue;
    const m = byNumber.get(c.number) || { name: c.name, status: c.status || null, weight: 0, officers: new Set<string>() };
    for (const o of c.sharedOfficers || []) m.officers.add(o);
    if (c.sharedCorporateOfficer) m.weight = Math.max(m.weight, 45);
    if (c.sameOffice) m.weight = Math.max(m.weight, 25);
    if (c.nameMatch) m.weight += 0.5;
    byNumber.set(c.number, m);
  }
  const prelim = [...byNumber.entries()]
    .filter(([, m]) => !/dissolved|closed|liquidation|removed/i.test(String(m.status || "")))
    .map(([number, m]) => ({ number, name: m.name, weight: m.weight + 20 * Math.min(m.officers.size, 4) }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, MAX_PSC_READS);
  // Owned by the top company or one filed under it; then, a level down, owned
  // by a candidate already found to be owned that way.
  const ours = new Set([...known.numbers, ...(top.number ? [normaliseCompanyNumber(top.number)!] : [])]);
  const topKey = top.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const owners = new Map<string, Array<{ number: string | null; name: string }>>();
  for (const s of prelim) {
    const pscs = (await ch(`/company/${encodeURIComponent(s.number)}/persons-with-significant-control?items_per_page=25`).catch(() => null))?.items || [];
    owners.set(s.number, pscs
      .filter((p: any) => !p?.ceased_on && /corporate|legal-person/.test(String(p?.kind || "")))
      .map((p: any) => ({ number: normaliseCompanyNumber(p?.identification?.registration_number), name: text(p?.name) })));
  }
  const ownedBy = new Map<string, string>();
  for (let pass = 0; pass < 3; pass++) {
    for (const s of prelim) {
      if (ownedBy.has(s.number)) continue;
      const hit = (owners.get(s.number) || []).find(p =>
        (p.number && (ours.has(p.number) || ownedBy.has(p.number))) || (!!p.name && p.name.toLowerCase().replace(/[^a-z0-9]/g, "") === topKey));
      if (hit) ownedBy.set(s.number, hit.name || top.name);
    }
  }
  for (const s of prelim) {
    const by = ownedBy.get(s.number);
    if (by) out.push({ source: "companies_house", name: s.name, number: s.number, ownedBy: by });
  }
  const owned = ownedBy.size;
  if (prelim.length) said.push(`owners read for ${prelim.length} (${owned} owned within the group)`);
  return { candidates: out, words: `Companies House: ${said.join(", ")}` };
}

/** Land Registry's company ownership lists: titles owned under a name that starts like the company's. */
export async function landRegistryCandidates(
  query: SuggestionDeps["query"],
  stems: string[],
): Promise<{ candidates: KycSuggestionCandidate[]; words: string; read: boolean }> {
  const out: KycSuggestionCandidate[] = [];
  let read = false;
  for (const stem of stems.slice(0, 2)) {
    // A range on the name index, then the exact prefix (the range alone can let in a near spelling).
    const upper = stem.slice(0, -1) + String.fromCharCode(stem.charCodeAt(stem.length - 1) + 1);
    const like = stem.replace(/[\\%_]/g, m => `\\${m}`) + "%";
    const rows = (await query(
      `SELECT proprietor_name, company_registration_no, max(country_incorporated) AS country,
              count(DISTINCT title_number)::int AS titles
         FROM hmlr_proprietors
        WHERE lower(proprietor_name) >= $1 AND lower(proprietor_name) < $2 AND lower(proprietor_name) LIKE $3
        GROUP BY proprietor_name, company_registration_no
        ORDER BY titles DESC
        LIMIT 40`,
      [stem, upper, like],
    )).rows;
    read = true;
    for (const r of rows) {
      const name = text(r.proprietor_name);
      if (!startsWithStem(name, stems)) continue;
      const country = text(r.country);
      out.push({
        source: "land_registry", name, number: normaliseCompanyNumber(r.company_registration_no),
        country: country && !/united kingdom|england|wales|scotland|northern ireland/i.test(country) ? country : null,
        titles: Number(r.titles) || 0, nameMatch: true,
      });
    }
  }
  return { candidates: out, read, words: read ? `Land Registry: ${out.length} owner${out.length === 1 ? "" : "s"} whose name starts like the company's` : "Land Registry: no name to search" };
}

/** GLEIF: the top company's LEI and the subsidiaries recorded under it. */
export async function gleifCandidates(
  gleif: NonNullable<SuggestionDeps["gleif"]>,
  top: { name: string; number: string | null },
): Promise<{ candidates: KycSuggestionCandidate[]; words: string }> {
  if (!top.number) return { candidates: [], words: "GLEIF: needs the company's Companies House number" };
  const records = await gleif.search({ name: top.name, country: "GB", registrationNumber: top.number, authorities: CH_REGISTERS });
  const pick = pickGleifRecord({ name: top.name, country: "GB", registrationNumber: top.number, authorities: CH_REGISTERS }, records);
  if (!pick.pick) return { candidates: [], words: "GLEIF: no LEI found for it" };
  const json = await gleif.get(`/lei-records/${pick.pick.lei}/direct-children`, { "page[size]": "100" });
  const children = (Array.isArray(json?.data) ? json.data : []).map(gleifEntityFrom).filter((e: GleifEntity | null): e is GleifEntity => !!e);
  const out: KycSuggestionCandidate[] = children.map((c: GleifEntity) => {
    const uk = !!(c.registeredAt && GLEIF_UK_REGISTERS[c.registeredAt]?.register === "companies_house");
    return {
      source: "gleif" as const, name: c.name, number: uk ? normaliseCompanyNumber(c.registeredAs) : null,
      status: c.status === "INACTIVE" ? "inactive" : null,
      country: uk ? null : c.country, gleifParent: pick.pick!.name,
    };
  });
  return { candidates: out, words: `GLEIF: LEI ${pick.pick.lei}, ${out.length} subsidiar${out.length === 1 ? "y" : "ies"} recorded` };
}

/** Every source in turn; one that fails is named, never the whole list. */
export async function suggestSubCompanies(companyId: string, deps: SuggestionDeps): Promise<KycSuggestionsResult | null> {
  const company = (await deps.query(
    `SELECT id, name, companies_house_number, uk_entity_name,
            COALESCE(NULLIF(companies_house_data->'profile'->>'companyName', ''), NULLIF(companies_house_data->>'company_name', '')) AS ch_name
       FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!company) return null;
  const entities = (await deps.query(
    `SELECT name, companies_house_number, is_default FROM crm_trading_entities WHERE parent_company_id = $1`, [companyId])).rows;
  const related = (await deps.query(
    `SELECT name, companies_house_number FROM crm_companies
      WHERE (parent_company_id = $1 OR id = (SELECT parent_company_id FROM crm_companies WHERE id = $1)) AND id <> $1`, [companyId])).rows;
  const ownNumber = normaliseCompanyNumber(company.companies_house_number);
  const filed = [...entities].sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default)).find(e => normaliseCompanyNumber(e.companies_house_number));
  const topNumber = ownNumber || normaliseCompanyNumber(filed?.companies_house_number);
  const topName = text(ownNumber ? (company.ch_name || company.uk_entity_name || company.name) : (filed?.name || company.uk_entity_name || company.name));
  const top = { name: topName, number: topNumber };
  const known = {
    numbers: new Set([ownNumber, ...entities.map(e => e.companies_house_number), ...related.map(r => r.companies_house_number)].map(normaliseCompanyNumber).filter((x): x is string => !!x)),
    names: new Set([company.name, company.uk_entity_name, company.ch_name, ...entities.map(e => e.name), ...related.map(r => r.name)].map(n => text(n).toLowerCase()).filter(Boolean)),
  };
  const stems = nameStems([topName, company.name, company.uk_entity_name]);
  const candidates: KycSuggestionCandidate[] = [];
  const sources: SuggestionSourceLine[] = [];

  if (deps.ch) {
    try {
      const r = await companiesHouseCandidates(deps.ch, top, stems, known);
      candidates.push(...r.candidates);
      sources.push({ source: "companies_house", read: true, words: r.words });
    } catch (e: any) {
      sources.push({ source: "companies_house", read: false, words: `Companies House: not read (${text(e?.message).slice(0, 120)})` });
    }
  } else {
    sources.push({ source: "companies_house", read: false, words: "Companies House: not set up on this machine" });
  }
  try {
    const r = await landRegistryCandidates(deps.query, stems);
    candidates.push(...r.candidates);
    sources.push({ source: "land_registry", read: r.read, words: r.words });
  } catch (e: any) {
    sources.push({ source: "land_registry", read: false, words: `Land Registry: not read (${text(e?.message).slice(0, 120)})` });
  }
  if (deps.gleif) {
    try {
      const r = await gleifCandidates(deps.gleif, top);
      candidates.push(...r.candidates);
      sources.push({ source: "gleif", read: true, words: r.words });
    } catch (e: any) {
      sources.push({ source: "gleif", read: false, words: `GLEIF: not read (${text(e?.message).slice(0, 120)})` });
    }
  } else {
    sources.push({ source: "gleif", read: false, words: "GLEIF: switched off" });
  }
  return {
    companyId,
    top: topName ? top : null,
    suggestions: rankSuggestions(candidates, { numbers: [...known.numbers], names: [...known.names] }),
    sources,
    readAt: new Date().toISOString(),
  };
}

async function defaultDeps(): Promise<SuggestionDeps> {
  const ch = process.env.COMPANIES_HOUSE_API_KEY
    ? (async (path: string) => (await import("./companies-house")).chFetch(path, { maxWaitMs: 15_000, timeoutMs: 15_000 }))
    : null;
  const g = await import("./gleif");
  return {
    query: (sql, params) => pool.query(sql, params as any[]),
    ch,
    gleif: g.gleifOn() ? { search: q => g.searchGleif(q), get: (p, params) => g.gleifGet(p, params || {}) } : null,
  };
}

// A day's read is kept for six hours per company, and read again when a company is filed under it.
const cache = new Map<string, { at: number; sig: string; result: KycSuggestionsResult }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

export const kycSuggestionsRouter = Router();

kycSuggestionsRouter.get("/api/client-kyc/:companyId/suggestions", async (req: Request, res: Response) => {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return res.status(403).json({ error: "BGP staff only." });
  const companyId = String(req.params.companyId);
  try {
    const sig = (await pool.query(
      `SELECT count(*)::int AS n, max(created_at) AS at FROM crm_trading_entities WHERE parent_company_id = $1`, [companyId],
    ).catch(() => ({ rows: [{ n: 0, at: null }] }))).rows[0];
    const key = `${sig?.n}:${sig?.at || ""}`;
    const hit = cache.get(companyId);
    if (hit && req.query.refresh !== "1" && hit.sig === key && Date.now() - hit.at < CACHE_MS) return res.json({ ...hit.result, cached: true });
    const result = await suggestSubCompanies(companyId, await defaultDeps());
    if (!result) return res.status(404).json({ error: "No such company." });
    cache.set(companyId, { at: Date.now(), sig: key, result });
    res.json(result);
  } catch (e: any) {
    console.error("[kyc-suggestions]", e?.message);
    res.status(500).json({ error: "Could not read the suggestions." });
  }
});
