/**
 * Covenant Engine — house tenant/counterparty financial-strength scoring.
 *
 * Replaces the need for Red Flag Alert / Experian with free statutory data:
 *   • Companies House (profile, charges, insolvency, officers, filing lateness)
 *   • The Gazette (corporate-insolvency notices, categorycode=24 — including
 *     winding-up petitions, the earliest public distress signal)
 *   • Filed-accounts figures already extracted by ch-accounts.ts (net assets,
 *     cash, turnover) when the company is in the CRM
 * plus a Claude two-line analyst verdict. CCJs are the one signal with no free
 * API — the report carries a pre-filled TrustOnline link (~£6-10/search).
 *
 * One engine, many consumers: KYC orchestrator, deal pages, tenancy schedules,
 * ChatBGP (check_covenant), decks, and the nightly watcher with alerts.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { chFetch } from "./companies-house";
import { getStockSnapshot } from "./stock-price";

// ── Gazette: corporate insolvency notices (free JSON API) ──────────────────
export interface GazetteNotice { title: string; code: string; published: string; link: string }

export async function gazetteInsolvencyNotices(companyNumber: string): Promise<GazetteNotice[]> {
  const num = companyNumber.trim().toUpperCase();
  const url = `https://www.thegazette.co.uk/all-notices/notice/data.json?text=${encodeURIComponent(num)}&categorycode=24&results-page=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    // The Gazette's machine-readable endpoints (data.json / data.feed) went
    // down fleet-wide on 2026-08-02 returning 500 while the HTML search kept
    // working — scrape that as a fallback so the earliest-distress signal
    // doesn't silently drop out of covenant reports.
    if (res.status >= 500) return gazetteInsolvencyNoticesHtml(num);
    throw new Error(`Gazette ${res.status}`);
  }
  const data: any = await res.json();
  let entries: any[] = data?.entry || [];
  if (entries && !Array.isArray(entries)) entries = [entries];
  return entries.map((e) => ({
    title: String(e?.title || "").trim(),
    code: String(e?.["f:notice-code"] || ""),
    published: String(e?.published || "").slice(0, 10),
    link: String((Array.isArray(e?.link) ? e.link[0]?.["@href"] : e?.link?.["@href"]) || ""),
  })).filter((n) => n.title);
}

const GAZETTE_MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

// HTML-search fallback. Real notices are <article id="item-…/id/notice/…">
// blocks — the page also embeds sidebar guide articles with the same
// feed-item class, so match on the id attribute, not the class.
async function gazetteInsolvencyNoticesHtml(num: string): Promise<GazetteNotice[]> {
  const url = `https://www.thegazette.co.uk/all-notices/notice?text=${encodeURIComponent(num)}&categorycode=24`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (BGP covenant engine)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Gazette HTML ${res.status}`);
  const html = await res.text();
  const notices: GazetteNotice[] = [];
  const articleRe = /<article id="item-https:\/\/www\.thegazette\.co\.uk\/id\/notice\/([^"]+)"[\s\S]*?<\/article>/g;
  for (const m of html.matchAll(articleRe)) {
    const block = m[0];
    const title = (block.match(/<h3>([^<]+)<\/h3>/)?.[1] || "").trim();
    const dateRaw = (block.match(/Publication date<\/dt>\s*<dd>([^<]+)<\/dd>/)?.[1] || "").trim();
    const dm = dateRaw.match(/^(\d{1,2}) (\w+) (\d{4})$/);
    const published = dm ? `${dm[3]}-${GAZETTE_MONTHS[dm[2].toLowerCase()] || "01"}-${dm[1].padStart(2, "0")}` : "";
    notices.push({
      title,
      // The HTML page doesn't carry f:notice-code — classify petitions by
      // title so PETITION_CODES-equivalent severity still applies.
      code: /petition/i.test(title) ? "2450" : "",
      published,
      link: `https://www.thegazette.co.uk/notice/${m[1]}`,
    });
  }
  return notices.filter((n) => n.title);
}

// Winding-up petition = 2450; administrations 2410-2412; liquidations 2432-2450s.
const PETITION_CODES = new Set(["2450"]);

// ── Signals + scoring ───────────────────────────────────────────────────────
export interface CovenantFlag { level: "red" | "amber" | "info"; label: string; detail?: string }
export interface CovenantReport {
  companyNumber: string;
  companyName: string;
  status: string;
  score: number;                // 0-100
  grade: "A" | "B" | "C" | "D" | "E";
  flags: CovenantFlag[];
  signals: Record<string, any>; // raw evidence for the UI
  verdict: string | null;       // Claude commentary
  missing: string[];            // data gaps — what would complete the picture
  ccjCheckUrl: string;          // manual TrustOnline link (~£6-10/search)
  computedAt: string;
}

// ── Director risk — free Experian replacement layer ────────────────────────
// Two CH lookups per active director (capped): their appointment history
// (companies currently in an insolvency process) and the disqualified-
// officers register (name match only, so surfaced as "verify", never
// auto-red).
const DISTRESS_STATUSES = new Set(["liquidation", "receivership", "administration", "insolvency-proceedings", "voluntary-arrangement"]);

function nameTokens(s: string): Set<string> {
  return new Set(String(s || "").toUpperCase().replace(/[^A-Z ]+/g, " ").split(/\s+/).filter((t) => t.length > 1));
}

function namesRoughlyMatch(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

export async function assessDirectorRisk(officersRes: any): Promise<{
  activeDirectors: number; historyChecked: number;
  directorsWithInsolventCompanies: Array<{ name: string; count: number }>;
  possibleDisqualified: Array<{ officer: string; match: string }>;
}> {
  const active = (officersRes?.items || [])
    .filter((o: any) => !o.resigned_on && /director/i.test(String(o.officer_role || "")))
    .slice(0, 8);
  const out = { activeDirectors: active.length, historyChecked: 0, directorsWithInsolventCompanies: [] as Array<{ name: string; count: number }>, possibleDisqualified: [] as Array<{ officer: string; match: string }> };
  for (const o of active) {
    const apptLink = o.links?.officer?.appointments;
    if (apptLink) {
      const app = await chFetch(`${apptLink}?items_per_page=50`).catch(() => null);
      if (app) {
        out.historyChecked++;
        const bad = (app.items || []).filter((a: any) => DISTRESS_STATUSES.has(String(a.appointed_to?.company_status || "")));
        if (bad.length) out.directorsWithInsolventCompanies.push({ name: String(o.name || ""), count: bad.length });
      }
    }
    const q = String(o.name || "").replace(/,/g, " ").trim();
    if (q) {
      const s = await chFetch(`/search/disqualified-officers?q=${encodeURIComponent(q)}&items_per_page=3`).catch(() => null);
      const hit = (s?.items || []).find((it: any) => namesRoughlyMatch(String(it.title || ""), q));
      if (hit) out.possibleDisqualified.push({ officer: String(o.name || ""), match: String(hit.title || "") });
    }
  }
  return out;
}

// ── Payment Practices Reporting (gov.uk) — the free replacement for
// Experian's days-beyond-terms data. Large companies must file avg
// days-to-pay and %-paid-late twice a year; the service publishes the lot
// as one CSV (~100MB). We ingest the latest report per company weekly.
export async function ingestPaymentPractices(): Promise<{ companies: number }> {
  const res = await fetch("https://check-payment-practices.service.gov.uk/export/csv/", {
    headers: { "User-Agent": "Mozilla/5.0 (BGP covenant engine)" }, signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok || !res.body) throw new Error(`payment-practices export ${res.status}`);
  const { parse } = await import("csv-parse");
  const { Readable } = await import("stream");
  const parser = (Readable.fromWeb(res.body as any)).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true }));
  const latest = new Map<string, { name: string; periodEnd: string; filed: string; avgDays: number | null; pctLate: number | null; pctOver60: number | null }>();
  for await (const r of parser) {
    const numRaw = String(r["Company number"] || "").trim().toUpperCase();
    if (!numRaw) continue;
    const num = numRaw.padStart(8, "0");
    const periodEnd = String(r["End date"] || "");
    const prev = latest.get(num);
    if (prev && prev.periodEnd >= periodEnd) continue;
    const toNum = (v: any) => { const n = parseFloat(String(v ?? "")); return isFinite(n) ? n : null; };
    latest.set(num, {
      name: String(r["Company"] || ""), periodEnd, filed: String(r["Filing date"] || ""),
      avgDays: toNum(r["Average time to pay"]),
      pctLate: toNum(r["% Invoices not paid within agreed terms"]),
      pctOver60: toNum(r["% Invoices paid later than 60 days"]),
    });
  }
  const entries = Array.from(latest.entries());
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const values: any[] = []; const rows: string[] = [];
    chunk.forEach(([num, p], j) => {
      const b = j * 7;
      rows.push(`($${b + 1},$${b + 2},nullif($${b + 3},'')::date,nullif($${b + 4},'')::date,$${b + 5},$${b + 6},$${b + 7})`);
      values.push(num, p.name, p.periodEnd, p.filed, p.avgDays, p.pctLate, p.pctOver60);
    });
    await pool.query(
      `INSERT INTO payment_practices (company_number, company_name, period_end, filed, avg_days_to_pay, pct_paid_late, pct_over_60)
       VALUES ${rows.join(",")}
       ON CONFLICT (company_number) DO UPDATE SET company_name = EXCLUDED.company_name, period_end = EXCLUDED.period_end,
         filed = EXCLUDED.filed, avg_days_to_pay = EXCLUDED.avg_days_to_pay, pct_paid_late = EXCLUDED.pct_paid_late,
         pct_over_60 = EXCLUDED.pct_over_60, ingested_at = now()`,
      values,
    );
  }
  console.log(`[payment-practices] ingested ${entries.length} companies' latest reports`);
  return { companies: entries.length };
}

async function paymentPracticesFor(num: string): Promise<{ avgDays: number | null; pctLate: number | null; pctOver60: number | null; periodEnd: string | null } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT avg_days_to_pay, pct_paid_late, pct_over_60, period_end::text FROM payment_practices WHERE company_number = $1`,
      [num],
    );
    if (!rows[0]) return null;
    return { avgDays: rows[0].avg_days_to_pay, pctLate: rows[0].pct_paid_late, pctOver60: rows[0].pct_over_60, periodEnd: rows[0].period_end };
  } catch { return null; }
}

// ── FCA daily short-positions register — free distress signal for listed
// counterparties. Heavy disclosed shorting = the market smells trouble.
let shortCache: { rows: Array<{ issuer: string; pct: number }>; expiresAt: number } | null = null;

async function fcaShortInterest(companyName: string): Promise<number | null> {
  try {
    if (!shortCache || Date.now() > shortCache.expiresAt) {
      const res = await fetch("https://www.fca.org.uk/publication/data/short-positions-daily-update.xlsx", {
        headers: { "User-Agent": "Mozilla/5.0 (BGP covenant engine)" }, signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
      // The register is a disclosure LOG — every update a holder ever filed.
      // The live position is each holder's most recent row per issuer, and
      // only counts while still ≥0.5% (below that = position closed/exited).
      const latest = new Map<string, { issuer: string; pct: number; date: number }>();
      for (const r of rows) {
        const issuer = String(r["Name of Share Issuer"] || "").trim();
        const holder = String(r["Position Holder"] || "").trim();
        const pct = parseFloat(String(r["Net Short Position (%)"] ?? ""));
        const date = Number(r["Position Date"]) || 0;
        if (!issuer || !holder || !isFinite(pct)) continue;
        const key = `${holder}|${issuer}`;
        const prev = latest.get(key);
        if (!prev || date > prev.date) latest.set(key, { issuer, pct, date });
      }
      const parsed = Array.from(latest.values()).filter((p) => p.pct >= 0.5).map(({ issuer, pct }) => ({ issuer, pct }));
      shortCache = { rows: parsed, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    }
    const target = nameTokens(companyName);
    if (target.size === 0) return null;
    let total = 0; let matched = false;
    for (const { issuer, pct } of shortCache.rows) {
      if (namesRoughlyMatch(issuer, companyName)) { total += pct; matched = true; }
    }
    return matched ? Math.round(total * 100) / 100 : 0;
  } catch {
    return null;
  }
}

// Parse "£84.2m" / "-£1.2m" / "(£450k)" → number in £; null if unreadable.
function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const neg = /^\(|^-/.test(s.trim());
  const m = String(s).replace(/[()£,\s]/g, "").match(/^-?([\d.]+)(m|k|bn|b)?$/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") v *= 1e3; else if (unit === "m") v *= 1e6; else if (unit === "b" || unit === "bn") v *= 1e9;
  return neg ? -v : v;
}

export async function computeCovenant(companyNumber: string): Promise<CovenantReport> {
  const num = companyNumber.trim().toUpperCase().padStart(8, "0");
  const [profile, officersRes, chargesRes] = await Promise.all([
    chFetch(`/company/${num}`),
    chFetch(`/company/${num}/officers?items_per_page=100`).catch(() => null),
    chFetch(`/company/${num}/charges`).catch(() => null),
  ]);
  if (!profile?.company_name) throw new Error(`Company ${num} not found at Companies House`);

  // gazetteFailed distinguishes "screen ran, found nothing" from "screen
  // never ran" — a clean-looking report whose early-warning layer silently
  // failed is worse than an amber flag saying so.
  let gazetteFailed = false;
  const [insolvency, gazette] = await Promise.all([
    profile.has_insolvency_history ? chFetch(`/company/${num}/insolvency`).catch(() => null) : Promise.resolve(null),
    gazetteInsolvencyNotices(num).catch(() => { gazetteFailed = true; return [] as GazetteNotice[]; }),
  ]);

  // Filed-accounts figures + ticker if the company is in the CRM.
  let accounts: any = null;
  let ticker: string | null = null;
  let crmCompanyId: string | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT id, companies_house_data->'latestAccountsExtracted' AS acc, stock_ticker FROM crm_companies
        WHERE regexp_replace(upper(companies_house_number), '\\s', '', 'g') = $1 LIMIT 1`,
      [num]
    );
    accounts = rows[0]?.acc || null;
    ticker = rows[0]?.stock_ticker || null;
    crmCompanyId = rows[0]?.id || null;
  } catch { /* no DB / no row — score still works */ }

  // An extraction where every figure is null (early runs stored "not
  // found" strings or read the wrong pages) is no data, not data — treat
  // it as absent so the re-extraction below gets its chance.
  const hasAccountsFigures = (a: any) => !!(a && (a.turnover || a.grossProfit || a.operatingProfit
    || a.profitBeforeTax || a.netAssets || a.cash || a.employees));
  if (accounts && !hasAccountsFigures(accounts)) accounts = null;

  // Self-serve missing accounts: download the latest filed accounts from CH
  // and extract the figures inline, instead of grading blind and telling the
  // user to go click a different button first (Woody, 2026-08-18 — Bill's
  // covenant sat at "run the accounts extraction" forever). Cached in
  // companies_house_data, so this runs once per filing, not per refresh.
  if (!accounts && crmCompanyId) {
    try {
      const { fetchLatestAccountsForCompany, extractAccountsFigures } = await import("./ch-accounts");
      await fetchLatestAccountsForCompany(crmCompanyId);
      accounts = await extractAccountsFigures(crmCompanyId);
      if (accounts && !hasAccountsFigures(accounts)) accounts = null;
    } catch (e: any) {
      console.warn(`[covenant] inline accounts extraction failed for ${num}:`, e?.message);
    }
  }

  // Free Experian-replacement layers, gathered in parallel: director track
  // record (CH appointments + disqualified register), auditor departures in
  // the filing history, and — for listed counterparties — market signals
  // (Yahoo) plus the FCA disclosed-short register.
  const [directorRisk, filingHistory, market, payPractices] = await Promise.all([
    assessDirectorRisk(officersRes).catch(() => null),
    chFetch(`/company/${num}/filing-history?items_per_page=100`).catch(() => null),
    ticker ? getStockSnapshot(ticker).catch(() => null) : Promise.resolve(null),
    paymentPracticesFor(num),
  ]);
  const shortInterest = market ? await fcaShortInterest(profile.company_name).catch(() => null) : null;

  const flags: CovenantFlag[] = [];
  let score = 100;
  const status = String(profile.company_status || "unknown");
  const yearNow = new Date().getFullYear();
  const ageYears = profile.date_of_creation ? yearNow - parseInt(profile.date_of_creation.slice(0, 4), 10) : null;

  // Terminal / distressed statuses dominate everything else.
  if (["dissolved", "liquidation", "receivership", "administration", "insolvency-proceedings", "voluntary-arrangement"].includes(status)) {
    score = status === "dissolved" ? 0 : 10;
    flags.push({ level: "red", label: `Company status: ${status}` });
  }

  // Gazette — the early-warning layer.
  const recentGazette = gazette.filter((g) => g.published && (yearNow - parseInt(g.published.slice(0, 4), 10)) <= 3);
  const petitions = gazette.filter((g) => PETITION_CODES.has(g.code));
  if (petitions.length) { score -= 50; flags.push({ level: "red", label: "Winding-up petition in The Gazette", detail: petitions[0].published }); }
  else if (recentGazette.length) { score -= 40; flags.push({ level: "red", label: `Corporate-insolvency Gazette notice (${recentGazette.length})`, detail: `${recentGazette[0].title} · ${recentGazette[0].published}` }); }
  else if (gazette.length) { score -= 15; flags.push({ level: "amber", label: "Historic Gazette insolvency notice", detail: gazette[0].published }); }
  if (gazetteFailed) flags.push({ level: "amber", label: "Gazette screen unavailable", detail: "Insolvency-notice check could not run — treat the absence of Gazette flags as unverified" });

  if (profile.has_insolvency_history && !gazette.length) { score -= 35; flags.push({ level: "red", label: "Insolvency history at Companies House" }); }

  // Filing lateness — the classic quiet distress signal.
  if (profile.accounts?.overdue) { score -= 20; flags.push({ level: "red", label: "Accounts OVERDUE", detail: `due ${profile.accounts?.next_due || "?"}` }); }
  if (profile.confirmation_statement?.overdue) { score -= 8; flags.push({ level: "amber", label: "Confirmation statement overdue" }); }

  // Balance sheet (when extracted accounts exist).
  const netAssets = parseMoney(accounts?.netAssets);
  const cash = parseMoney(accounts?.cash);
  if (netAssets != null && netAssets < 0) { score -= 20; flags.push({ level: "red", label: "Negative net assets", detail: accounts.netAssets }); }
  else if (netAssets != null) flags.push({ level: "info", label: `Net assets ${accounts.netAssets}`, detail: accounts.period || undefined });
  if (cash != null && cash <= 0) { score -= 8; flags.push({ level: "amber", label: "No cash on balance sheet" }); }

  // Leverage — charges register.
  const outstandingCharges = chargesRes ? Math.max(0, (chargesRes.total_count || 0) - (chargesRes.satisfied_count || 0) - (chargesRes.part_satisfied_count || 0)) : 0;
  const newCharges12m = (chargesRes?.items || []).filter((c: any) => c.created_on && (Date.now() - new Date(c.created_on).getTime()) < 365 * 864e5 && c.status !== "fully-satisfied").length;
  if (outstandingCharges > 5) { score -= 8; flags.push({ level: "amber", label: `${outstandingCharges} outstanding charges` }); }
  else if (outstandingCharges > 0) { score -= 4; flags.push({ level: "info", label: `${outstandingCharges} outstanding charge${outstandingCharges > 1 ? "s" : ""}` }); }
  if (newCharges12m > 0) { score -= 6; flags.push({ level: "amber", label: `${newCharges12m} new charge${newCharges12m > 1 ? "s" : ""} in last 12m` }); }

  // Profitability (when extracted accounts carry it).
  const pbt = parseMoney(accounts?.profitBeforeTax);
  const turnover = parseMoney(accounts?.turnover);
  if (pbt != null && pbt < 0) { score -= 10; flags.push({ level: "amber", label: "Loss-making", detail: `PBT ${accounts.profitBeforeTax}${accounts?.period ? ` · ${accounts.period}` : ""}` }); }
  else if (pbt != null && turnover != null && turnover > 0) {
    const margin = pbt / turnover;
    if (margin < 0.02) { score -= 4; flags.push({ level: "amber", label: `Thin margin (${(margin * 100).toFixed(1)}% PBT)` }); }
    else flags.push({ level: "info", label: `PBT margin ${(margin * 100).toFixed(1)}%` });
  }

  // Director track record — prior insolvent companies + disqualified register.
  if (directorRisk) {
    const insolventDirs = directorRisk.directorsWithInsolventCompanies;
    if (insolventDirs.length >= 2) { score -= 12; flags.push({ level: "amber", label: `${insolventDirs.length} directors with companies in insolvency processes`, detail: insolventDirs.map((d) => `${d.name} (${d.count})`).join(" · ") }); }
    else if (insolventDirs.length === 1) { score -= 6; flags.push({ level: "amber", label: "Director linked to insolvent company", detail: `${insolventDirs[0].name} — ${insolventDirs[0].count} appointment${insolventDirs[0].count > 1 ? "s" : ""} in an insolvency process` }); }
    for (const d of directorRisk.possibleDisqualified) {
      score -= 10;
      flags.push({ level: "amber", label: "Possible disqualified-director match — verify", detail: `${d.officer} ↔ register entry ${d.match} (name match only)` });
    }
  }

  // Payment behaviour — statutory Payment Practices reports (large cos).
  if (payPractices) {
    const late = payPractices.pctLate;
    const avg = payPractices.avgDays;
    if (late != null && late >= 50) { score -= 10; flags.push({ level: "red", label: `${late}% of invoices paid late`, detail: `Payment Practices report to ${payPractices.periodEnd}` }); }
    else if (late != null && late >= 30) { score -= 6; flags.push({ level: "amber", label: `${late}% of invoices paid late`, detail: `Payment Practices report to ${payPractices.periodEnd}` }); }
    if (avg != null && avg >= 60) { score -= 6; flags.push({ level: "amber", label: `Slow payer — ${avg} days average`, detail: "Payment Practices report" }); }
    else if (avg != null && (late == null || late < 30)) flags.push({ level: "info", label: `Pays suppliers in ${avg}d avg${late != null ? ` · ${late}% late` : ""}` });
  }

  // Auditor departure in the last 24 months — classic quiet red flag.
  const auditorDepartures = (filingHistory?.items || []).filter((f: any) => {
    const txt = `${f.description || ""} ${f.type || ""}`.toLowerCase();
    return /auditor/.test(txt) && /ceas|resign|remov|vacat|terminat/.test(txt)
      && f.date && (Date.now() - new Date(f.date).getTime()) < 730 * 864e5;
  });
  if (auditorDepartures.length) { score -= 8; flags.push({ level: "amber", label: "Auditor departure filed", detail: `${auditorDepartures[0].date} — ${auditorDepartures[0].description || auditorDepartures[0].type}` }); }

  // Listed-company signals — continuous disclosure beats bureau data.
  if (market) {
    const capBn = market.marketCapGBP != null ? market.marketCapGBP / 1e9 : null;
    flags.push({ level: "info", label: `Listed: ${market.shortName || ticker}`, detail: `${market.exchange || ""}${capBn != null ? ` · mkt cap £${capBn >= 1 ? capBn.toFixed(1) + "bn" : Math.round(capBn * 1000) + "m"}` : ""}` });
    if (market.price != null && market.fiftyTwoWeekHigh != null && market.fiftyTwoWeekHigh > 0) {
      const drawdown = 1 - market.price / market.fiftyTwoWeekHigh;
      if (drawdown >= 0.5) { score -= 12; flags.push({ level: "red", label: `Share price ${Math.round(drawdown * 100)}% below 52-week high` }); }
      else if (drawdown >= 0.3) { score -= 6; flags.push({ level: "amber", label: `Share price ${Math.round(drawdown * 100)}% below 52-week high` }); }
    }
    if (shortInterest != null && shortInterest >= 8) { score -= 10; flags.push({ level: "red", label: `Heavy disclosed short interest (${shortInterest}%)`, detail: "FCA net-short register" }); }
    else if (shortInterest != null && shortInterest >= 3) { score -= 6; flags.push({ level: "amber", label: `Material disclosed short interest (${shortInterest}%)`, detail: "FCA net-short register" }); }
  }

  // Stability — officer churn + age.
  const resignations12m = (officersRes?.items || []).filter((o: any) => o.resigned_on && (Date.now() - new Date(o.resigned_on).getTime()) < 365 * 864e5).length;
  if (resignations12m >= 3) { score -= 6; flags.push({ level: "amber", label: `${resignations12m} officer resignations in 12m` }); }
  if (ageYears != null && ageYears < 2) { score -= 8; flags.push({ level: "amber", label: `Young company (${ageYears}y)` }); }
  else if (ageYears != null && ageYears < 5) { score -= 4; flags.push({ level: "info", label: `Company age ${ageYears}y` }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade: CovenantReport["grade"] = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";

  const signals = {
    status, ageYears, accountsOverdue: !!profile.accounts?.overdue, nextAccountsDue: profile.accounts?.next_due || null,
    outstandingCharges, newCharges12m, resignations12m,
    gazetteNotices: gazette.slice(0, 6), gazetteChecked: !gazetteFailed, insolvencyCases: insolvency?.cases?.length || 0,
    accounts: accounts ? { period: accounts.period, turnover: accounts.turnover, netAssets: accounts.netAssets, cash: accounts.cash, profitBeforeTax: accounts.profitBeforeTax } : null,
    directorRisk, auditorDepartures: auditorDepartures.length, paymentPractices: payPractices,
    market: market ? { ticker: market.ticker, price: market.price, currency: market.currency, marketCapGBP: market.marketCapGBP, fiftyTwoWeekChange: market.fiftyTwoWeekChange, shortInterestPct: shortInterest } : null,
  };

  // Data gaps — what would complete the picture. Rendered alongside the
  // grade so a clean-looking report can't hide an unexecuted check.
  const missing: string[] = [];
  if (!accounts) missing.push("No filed-accounts figures extracted yet — run the accounts extraction for balance-sheet signals");
  if (gazetteFailed) missing.push("Gazette insolvency screen could not run");
  if (!directorRisk || directorRisk.historyChecked === 0) missing.push("Director track-record sweep did not run");
  if (!ticker && /\bPLC\b/i.test(profile.company_name || "")) missing.push("PLC with no stock ticker set — add one for market signals");
  if (!officersRes?.items?.length) missing.push("No officers returned from Companies House");

  // Claude commentary — best-effort, never blocks the score.
  let verdict: string | null = null;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const opts: any = { apiKey };
      if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) opts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
      const client = new Anthropic(opts);
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001", max_tokens: 250,
        messages: [{ role: "user", content: `You are a landlord's covenant analyst. Assess tenant covenant strength in 2-3 plain-English sentences, no hedging — lead with the verdict, then the strongest evidence for and against. If data gaps are listed, close with one short sentence starting "To complete the picture:" naming them. Plain prose only — no markdown, no bold, no headings, no bullet points.\n${profile.company_name} (${num}) — grade ${grade} (${score}/100)\nSignals: ${JSON.stringify({ status, flags: flags.map(f => f.label + (f.detail ? ` (${f.detail})` : "")), accounts: signals.accounts, market: signals.market, directorRisk })}\nData gaps: ${missing.length ? missing.join("; ") : "none"}` }],
      });
      verdict = (msg.content[0] as any)?.text?.trim() || null;
    }
  } catch { /* skip verdict */ }

  return {
    companyNumber: num, companyName: profile.company_name, status, score, grade, flags, signals, verdict, missing,
    ccjCheckUrl: `https://www.trustonline.org.uk/search-yourself/`, // official CCJ register, ~£6-10/search
    computedAt: new Date().toISOString(),
  };
}

// ── Cache + watchlist + alerts (Postgres) ───────────────────────────────────
async function ensureTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS payment_practices (
    company_number VARCHAR PRIMARY KEY, company_name TEXT, period_end DATE, filed DATE,
    avg_days_to_pay REAL, pct_paid_late REAL, pct_over_60 REAL, ingested_at TIMESTAMP DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS covenant_reports (
    company_number VARCHAR PRIMARY KEY, company_name TEXT, score INTEGER, grade VARCHAR(1),
    report JSONB NOT NULL, computed_at TIMESTAMP DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS covenant_watch (
    company_number VARCHAR PRIMARY KEY, label TEXT, added_by VARCHAR, added_at TIMESTAMP DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS covenant_alerts (
    id SERIAL PRIMARY KEY, company_number VARCHAR NOT NULL, company_name TEXT, previous_grade VARCHAR(1),
    new_grade VARCHAR(1), headline TEXT NOT NULL, detail JSONB, created_at TIMESTAMP DEFAULT now(), acknowledged BOOLEAN DEFAULT false)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_covenant_alerts_created ON covenant_alerts(created_at DESC)`);
}

const CACHE_DAYS = 7;

export async function getCovenantReport(companyNumber: string, opts: { refresh?: boolean } = {}): Promise<CovenantReport> {
  const num = companyNumber.trim().toUpperCase().padStart(8, "0");
  if (!opts.refresh) {
    try {
      const { rows } = await pool.query(
        `SELECT report FROM covenant_reports WHERE company_number=$1 AND computed_at > now() - interval '${CACHE_DAYS} days'`, [num]);
      if (rows[0]?.report) return rows[0].report as CovenantReport;
    } catch { /* cache miss */ }
  }
  const report = await computeCovenant(num);
  try {
    await pool.query(
      `INSERT INTO covenant_reports (company_number, company_name, score, grade, report, computed_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (company_number) DO UPDATE SET company_name=$2, score=$3, grade=$4, report=$5, computed_at=now()`,
      [num, report.companyName, report.score, report.grade, report]);
  } catch (e: any) { console.warn("[covenant] cache write failed:", e?.message); }
  return report;
}

export async function addToWatchlist(companyNumber: string, label?: string, userId?: string | null) {
  const num = companyNumber.trim().toUpperCase().padStart(8, "0");
  await pool.query(
    `INSERT INTO covenant_watch (company_number, label, added_by) VALUES ($1,$2,$3)
     ON CONFLICT (company_number) DO UPDATE SET label=COALESCE($2, covenant_watch.label)`,
    [num, label || null, userId || null]);
}

// Nightly watcher: recompute every watched company; alert on grade drops or new red flags.
export async function runCovenantWatch(): Promise<{ checked: number; alerts: number }> {
  const { rows: watched } = await pool.query(`SELECT company_number, label FROM covenant_watch`);
  let alerts = 0;
  for (const w of watched) {
    try {
      const { rows: prevRows } = await pool.query(`SELECT grade, report FROM covenant_reports WHERE company_number=$1`, [w.company_number]);
      const prev = prevRows[0];
      const fresh = await computeCovenant(w.company_number);
      await pool.query(
        `INSERT INTO covenant_reports (company_number, company_name, score, grade, report, computed_at) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (company_number) DO UPDATE SET company_name=$2, score=$3, grade=$4, report=$5, computed_at=now()`,
        [fresh.companyNumber, fresh.companyName, fresh.score, fresh.grade, fresh]);
      const prevReds = new Set(((prev?.report as any)?.flags || []).filter((f: any) => f.level === "red").map((f: any) => f.label));
      const newReds = fresh.flags.filter((f) => f.level === "red" && !prevReds.has(f.label));
      const gradeDropped = prev && fresh.grade > prev.grade; // 'B' > 'A' lexicographically = worse
      if (newReds.length || gradeDropped) {
        const headline = newReds.length
          ? `${fresh.companyName}: ${newReds[0].label}`
          : `${fresh.companyName}: covenant grade ${prev.grade} → ${fresh.grade}`;
        await pool.query(
          `INSERT INTO covenant_alerts (company_number, company_name, previous_grade, new_grade, headline, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
          [fresh.companyNumber, fresh.companyName, prev?.grade || null, fresh.grade, headline, { newReds, score: fresh.score }]);
        alerts++;
      }
      await new Promise((r) => setTimeout(r, 1200)); // stay well inside CH rate limits
    } catch (e: any) { console.warn(`[covenant-watch] ${w.company_number}:`, e?.message); }
  }
  return { checked: watched.length, alerts };
}

// ── Routes + scheduler ──────────────────────────────────────────────────────
export function setupCovenantRoutes(app: Express) {
  ensureTables().catch((e) => console.warn("[covenant] table init failed:", e?.message));

  app.get("/api/covenant/alerts", requireAuth, async (_req: Request, res: Response) => {
    const { rows } = await pool.query(`SELECT * FROM covenant_alerts ORDER BY created_at DESC LIMIT 100`);
    res.json(rows);
  });

  app.get("/api/covenant/watchlist", requireAuth, async (_req: Request, res: Response) => {
    const { rows } = await pool.query(
      `SELECT w.company_number, w.label, w.added_at, r.company_name, r.score, r.grade, r.computed_at
         FROM covenant_watch w LEFT JOIN covenant_reports r USING (company_number) ORDER BY r.score NULLS LAST`);
    res.json(rows);
  });

  // Resolve a CRM company id -> CH number -> covenant report. Lets client
  // surfaces (tenancy schedules, deal rows) badge tenants that only carry a
  // crm_companies id. Returns 204 when the company has no CH number linked.
  app.get("/api/covenant/by-crm/:companyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(`SELECT companies_house_number FROM crm_companies WHERE id = $1`, [String(req.params.companyId)]);
      const num = rows[0]?.companies_house_number;
      if (!num) return res.status(204).end();
      res.json(await getCovenantReport(num));
    } catch (e: any) { res.status(400).json({ error: e?.message || "covenant check failed" }); }
  });

  app.get("/api/covenant/:companyNumber", requireAuth, async (req: Request, res: Response) => {
    try {
      const report = await getCovenantReport(String(req.params.companyNumber), { refresh: req.query.refresh === "1" });
      res.json(report);
    } catch (e: any) { res.status(400).json({ error: e?.message || "covenant check failed" }); }
  });

  app.post("/api/covenant/:companyNumber/watch", requireAuth, async (req: any, res: Response) => {
    try {
      await addToWatchlist(String(req.params.companyNumber), req.body?.label, req.session?.userId);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e?.message }); }
  });

  app.delete("/api/covenant/:companyNumber/watch", requireAuth, async (req: Request, res: Response) => {
    await pool.query(`DELETE FROM covenant_watch WHERE company_number=$1`, [String(req.params.companyNumber).trim().toUpperCase().padStart(8, "0")]);
    res.json({ ok: true });
  });

  app.post("/api/covenant/watch/run", requireAuth, async (_req: Request, res: Response) => {
    res.json(await runCovenantWatch());
  });

  app.post("/api/covenant/payment-practices/ingest", requireAuth, async (_req: Request, res: Response) => {
    try { res.json(await ingestPaymentPractices()); }
    catch (err: any) { res.status(500).json({ error: err?.message || "ingest failed" }); }
  });

  // Nightly watcher — first pass 10 min after boot, then every 24h.
  setTimeout(() => { runCovenantWatch().catch(() => {}); }, 10 * 60 * 1000);
  setInterval(() => { runCovenantWatch().catch(() => {}); }, 24 * 60 * 60 * 1000);

  // Payment-practices reports file twice a year — refresh weekly, plus a
  // first fill 15 min after boot when the table is empty.
  setTimeout(async () => {
    try {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM payment_practices`);
      if ((rows[0]?.n || 0) === 0) await ingestPaymentPractices();
    } catch (e: any) { console.warn("[payment-practices] first-fill skipped:", e?.message); }
  }, 15 * 60 * 1000);
  setInterval(() => { ingestPaymentPractices().catch((e) => console.warn("[payment-practices] weekly ingest failed:", e?.message)); }, 7 * 24 * 60 * 60 * 1000);
}
