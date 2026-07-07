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

// ── Gazette: corporate insolvency notices (free JSON API) ──────────────────
export interface GazetteNotice { title: string; code: string; published: string; link: string }

export async function gazetteInsolvencyNotices(companyNumber: string): Promise<GazetteNotice[]> {
  const num = companyNumber.trim().toUpperCase();
  const url = `https://www.thegazette.co.uk/all-notices/notice/data.json?text=${encodeURIComponent(num)}&categorycode=24&results-page=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Gazette ${res.status}`);
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
  verdict: string | null;       // Claude two-liner
  ccjCheckUrl: string;          // manual TrustOnline link (~£6-10/search)
  computedAt: string;
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

  const [insolvency, gazette] = await Promise.all([
    profile.has_insolvency_history ? chFetch(`/company/${num}/insolvency`).catch(() => null) : Promise.resolve(null),
    gazetteInsolvencyNotices(num).catch(() => [] as GazetteNotice[]),
  ]);

  // Filed-accounts figures if the company is in the CRM (extracted by ch-accounts).
  let accounts: any = null;
  try {
    const { rows } = await pool.query(
      `SELECT companies_house_data->'latestAccountsExtracted' AS acc FROM crm_companies
        WHERE regexp_replace(upper(companies_house_number), '\\s', '', 'g') = $1 AND companies_house_data ? 'latestAccountsExtracted' LIMIT 1`,
      [num]
    );
    accounts = rows[0]?.acc || null;
  } catch { /* no DB / no row — score still works */ }

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
    gazetteNotices: gazette.slice(0, 6), insolvencyCases: insolvency?.cases?.length || 0,
    accounts: accounts ? { period: accounts.period, turnover: accounts.turnover, netAssets: accounts.netAssets, cash: accounts.cash, profitBeforeTax: accounts.profitBeforeTax } : null,
  };

  // Claude two-line verdict — best-effort, never blocks the score.
  let verdict: string | null = null;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const opts: any = { apiKey };
      if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) opts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
      const client = new Anthropic(opts);
      const msg = await client.messages.create({
        model: "claude-haiku-4-5-20251001", max_tokens: 150,
        messages: [{ role: "user", content: `You are a landlord's covenant analyst. Two sentences max, plain English, no hedging: assess tenant covenant strength.\n${profile.company_name} (${num}) — grade ${grade} (${score}/100)\nSignals: ${JSON.stringify({ status, flags: flags.map(f => f.label), accounts: signals.accounts })}` }],
      });
      verdict = (msg.content[0] as any)?.text?.trim() || null;
    }
  } catch { /* skip verdict */ }

  return {
    companyNumber: num, companyName: profile.company_name, status, score, grade, flags, signals, verdict,
    ccjCheckUrl: `https://www.trustonline.org.uk/search-yourself/`, // official CCJ register, ~£6-10/search
    computedAt: new Date().toISOString(),
  };
}

// ── Cache + watchlist + alerts (Postgres) ───────────────────────────────────
async function ensureTables() {
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

  // Nightly watcher — first pass 10 min after boot, then every 24h.
  setTimeout(() => { runCovenantWatch().catch(() => {}); }, 10 * 60 * 1000);
  setInterval(() => { runCovenantWatch().catch(() => {}); }, 24 * 60 * 60 * 1000);
}
