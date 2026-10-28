import type { Express, Request, RequestHandler, Response } from "express";
import type { CovenantReport } from "./covenant-engine";
import type { LandlordCovenantReport } from "../shared/landlord-covenant";
import { LANDLORD_CATALOGUE_PREDICATE } from "./landlord-meeting-matching";
import { buildLandlordCovenantOverview, reviewedOperatingCompanyNumber, type LandlordCovenantCompanyContext } from "./landlord-covenant-overview";

type Company = LandlordCovenantCompanyContext & { uk_entity_name?: string | null; companies_house_number: string | null; status?: string | null };
type InsolvencyEvidence = { available: boolean; cases: any[]; status?: string; checkedAt: string };
type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
const MVL = "members-voluntary-liquidation";
// Exact Companies House enumeration values, not a guess from "liquidation".
// https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/companyinsolvency
const CASE_LABELS: Record<string, string> = {
  [MVL]: "Members’ voluntary liquidation", "creditors-voluntary-liquidation": "Creditors’ voluntary liquidation",
  "compulsory-liquidation": "Compulsory liquidation", "in-administration": "Administration", "administration-order": "Administration order",
  "foreign-insolvency": "Overseas winding up", "administrative-receiver": "Administrative receiver appointed", "scottish-administrative-receiver": "Receiver appointed",
  "receiver-manager": "Receiver/manager appointed", receivership: "Receivership", "corporate-voluntary-arrangement": "Corporate voluntary arrangement",
  "corporate-voluntary-arrangement-moratorium": "Corporate voluntary arrangement moratorium", moratorium: "Moratorium", "order-of-court-restructuring-plan": "Restructuring plan",
};
const DATE_LABELS: Record<string, string> = {
  "wound-up-on": "Winding up commenced", "declaration-solvent-on": "Declaration of solvency", "concluded-winding-up-on": "Winding up concluded",
  "petitioned-on": "Petition", "ordered-to-wind-up-on": "Winding-up order", "dissolved-on": "Dissolved", "due-to-be-dissolved-on": "Due to be dissolved",
  "administration-started-on": "Administration started", "administration-ended-on": "Administration ended", "administration-discharged-on": "Administration discharged",
  "voluntary-arrangement-started-on": "Voluntary arrangement started", "voluntary-arrangement-ended-on": "Voluntary arrangement ended", "case-end-on": "Case ended",
  "moratorium-started-on": "Moratorium started", "moratorium-ended-on": "Moratorium ended", "instrumented-on": "Instrument date",
};
const SCOPE = "This check concerns the linked legal entity, not the wider group or a group guarantee.";
const CONTRACT = "Confirm the entity named in the instruction, contract and billing details before relying on this check.";
const companyNumber = (value: string | null | undefined) => {
  const text = String(value || "").trim().toUpperCase();
  return /^(?:\d{1,8}|[A-Z]{2}\d{6})$/.test(text) ? text.padStart(8, "0") : null;
};
const isoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function interpretLandlordCovenant(company: Company, report: CovenantReport | null, insolvency: InsolvencyEvidence): LandlordCovenantReport {
  const number = companyNumber(company.companies_house_number);
  const matchingReport = report && companyNumber(report.companyNumber) === number ? report : null;
  const result: LandlordCovenantReport = {
    companyName: matchingReport?.companyName || company.uk_entity_name || company.name,
    companyNumber: number, status: insolvency.status || matchingReport?.status || company.status || "Unknown",
    sourceUrl: number ? `https://find-and-update.company-information.service.gov.uk/company/${number}/insolvency` : null,
    checkedAt: insolvency.checkedAt,
    interpretation: { kind: "unknown", title: "Case details need checking", summary: "The type of proceedings could not be confirmed from Companies House. No insolvency conclusion has been drawn.", context: [SCOPE, CONTRACT], dates: [] },
  };
  const interpretation = result.interpretation;
  if (!number) { interpretation.kind = "unlinked"; interpretation.title = "No legal entity linked"; interpretation.summary = "Link the contracting company’s Companies House number to check its record."; return result; }
  const cases = insolvency.cases.filter(item => item && typeof item === "object");
  const types = [...new Set(cases.map(item => typeof item.type === "string" ? item.type : "unknown"))];
  interpretation.dates = cases.flatMap(item => (Array.isArray(item.dates) ? item.dates : []).filter((date: any) => DATE_LABELS[date?.type] && isoDate(date?.date)).map((date: any) => ({ type: date.type, label: DATE_LABELS[date.type], date: date.date, caseType: item.type || "unknown" })))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (insolvency.available && types.length && types.every(type => type === MVL)) {
    interpretation.kind = MVL; interpretation.title = CASE_LABELS[MVL];
    interpretation.summary = interpretation.dates.some(date => date.type === "declaration-solvent-on")
      ? "Companies House records a members’ voluntary liquidation and a declaration of solvency. This is a solvent winding-up procedure, not evidence by itself that the company cannot pay its debts."
      : "Companies House records a members’ voluntary liquidation, a solvent winding-up procedure. The retrieved case does not include a declaration-of-solvency date.";
  } else if (insolvency.available && types.includes(MVL) && types.length > 1) {
    interpretation.kind = "mixed-history"; interpretation.title = "Multiple proceedings recorded";
    interpretation.summary = "The register includes a members’ voluntary liquidation alongside other case types. Review the dated cases together; the MVL does not settle the position of the other proceedings.";
  } else if (insolvency.available && types.length && types.every(type => !!CASE_LABELS[type])) {
    interpretation.kind = "creditor-process"; interpretation.title = types.length === 1 ? CASE_LABELS[types[0]] : "Insolvency proceedings recorded";
    interpretation.summary = `Companies House records ${types.map(type => CASE_LABELS[type].toLowerCase()).join(" and ")}. Check the current case position and the entity responsible for the contract.`;
  } else if (insolvency.available && !cases.length && !/liquidation|administration|receiver|insolvency|arrangement/i.test(result.status)) {
    interpretation.kind = "standard"; interpretation.title = "Legal entity covenant";
    interpretation.summary = "No insolvency cases were returned for this company number. Any financial assessment below relates to this legal entity only.";
    if (matchingReport && /^[A-E]$/.test(matchingReport.grade) && Number.isFinite(matchingReport.score)) result.assessment = {
      grade: matchingReport.grade, score: matchingReport.score, verdict: matchingReport.verdict,
      flags: matchingReport.flags || [], missing: matchingReport.missing || [], computedAt: matchingReport.computedAt,
    };
  }
  const accounts = matchingReport?.signals?.accounts;
  if (accounts && typeof accounts === "object") {
    const financial: NonNullable<LandlordCovenantReport["financial"]> = {};
    for (const key of ["period", "turnover", "netAssets", "cash", "profitBeforeTax"] as const) {
      const value = accounts[key];
      if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) (financial as any)[key] = value;
    }
    if (Object.keys(financial).length) result.financial = financial;
  }
  // Reviewed public evidence is tied to the exact old legal entity. It does
  // not change the CRM company, billing entity, KYC approval or group record.
  if (number === "OC342015") interpretation.evidence = [
    { text: "The 2024 audited accounts state that the principal business and contracts transferred to AEW UK Investment Management LLP on 31 March 2023; the lease expired in March 2024 and the old LLP was expected to dissolve.", sourceLabel: "2024 audited accounts, filed 12 September 2025", sourceUrl: "https://find-and-update.company-information.service.gov.uk/company/OC342015/filing-history/MzQ4MDQ1MjQxMmFkaXF6a2N4/document?download=1&format=pdf", reviewedAt: "2026-10-27" },
    { text: "AEW’s current legal information names AEW UK Investment Management LLP (OC367686). This is context for checking the current contracting entity, not an automatic replacement of the saved billing company.", sourceLabel: "AEW legal information", sourceUrl: "https://www.aew.com/legal", reviewedAt: "2026-10-27" },
  ];
  return result;
}

const caseCache = new Map<string, { evidence: InsolvencyEvidence; expires: number }>();
const inFlight = new Map<string, Promise<InsolvencyEvidence>>();
function bounded<T>(promise: Promise<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Source timed out")), ms); })]).finally(() => clearTimeout(timer!));
}
export async function readLandlordInsolvency(number: string, options: { refresh?: boolean; fetcher?: (path: string) => Promise<any>; now?: () => number } = {}): Promise<InsolvencyEvidence> {
  const now = options.now || Date.now;
  const cached = caseCache.get(number);
  if (!options.refresh && cached && cached.expires > now()) return cached.evidence;
  const pending = inFlight.get(number); if (pending) return pending;
  const run = (async () => {
    const checkedAt = new Date(now()).toISOString();
    let evidence: InsolvencyEvidence;
    try {
      const fetcher = options.fetcher || (await import("./companies-house")).chFetch;
      const value = await bounded(fetcher(`/company/${number}/insolvency`));
      evidence = { available: Array.isArray(value?.cases), cases: Array.isArray(value?.cases) ? value.cases : [], status: typeof value?.status === "string" ? value.status : undefined, checkedAt };
    } catch (error: any) {
      // The insolvency endpoint returns 404 for no case resource. Authentication,
      // rate limits and transport errors must never become a clean result.
      evidence = { available: /Companies House API error 404\b/.test(String(error?.message)), cases: [], checkedAt };
    }
    caseCache.set(number, { evidence, expires: now() + (evidence.available ? 5 * 60_000 : 30_000) });
    if (caseCache.size > 500) caseCache.delete(caseCache.keys().next().value!);
    return evidence;
  })().finally(() => inFlight.delete(number));
  inFlight.set(number, run); return run;
}

interface Dependencies { canRead?: (req: Request) => Promise<boolean>; q?: Queryable; insolvency?: typeof readLandlordInsolvency; now?: () => number }
export async function handleLandlordCovenant(req: Request, res: Response, deps: Dependencies = {}) {
  try {
    const canRead = deps.canRead || (await import("./landlord-meetings")).canReadLandlordMeetings;
    if (!await canRead(req)) return res.status(403).json({ error: "Available to BGP staff only" });
    const q = deps.q || (await import("./db")).pool;
    const company = (await q.query(`SELECT c.name,c.industry,c.backers,c.uk_entity_name,c.companies_house_number,c.companies_house_data->>'company_status' AS status,
      p.name AS parent_name,p.companies_house_number AS parent_number,pr.report AS parent_report
      FROM crm_companies c LEFT JOIN crm_companies p ON p.id=c.parent_company_id AND p.merged_into_id IS NULL
      LEFT JOIN covenant_reports pr ON pr.company_number=p.companies_house_number
      WHERE c.id=$1 AND ${LANDLORD_CATALOGUE_PREDICATE}`, [String(req.params.companyId)])).rows[0] as Company | undefined;
    if (!company) return res.status(404).json({ error: "Landlord not found" });
    const number = companyNumber(company.companies_house_number);
    const checkedAt = new Date((deps.now || Date.now)()).toISOString();
    if (!number) {
      const result = interpretLandlordCovenant(company, null, { available: false, cases: [], checkedAt });
      result.overview = buildLandlordCovenantOverview(company, result);
      return res.json(result);
    }
    const operatingNumber = reviewedOperatingCompanyNumber(number);
    const readInsolvency = deps.insolvency || readLandlordInsolvency;
    const [cached, insolvency, operatingInsolvency] = await Promise.all([
      // Read the existing engine report without calling its recomputation /
      // stale-while-revalidate path. This view never writes shared cache data.
      q.query("SELECT report FROM covenant_reports WHERE company_number=$1", [number]).catch(() => ({ rows: [] })),
      readInsolvency(number, { refresh: req.query.refresh === "1" }),
      operatingNumber && operatingNumber !== number ? readInsolvency(operatingNumber, { refresh: req.query.refresh === "1" }) : null,
    ]);
    const result = interpretLandlordCovenant(company, cached.rows[0]?.report || null, insolvency);
    const operating = operatingInsolvency && operatingNumber
      ? interpretLandlordCovenant({ name: "AEW UK Investment Management LLP", companies_house_number: operatingNumber }, null, operatingInsolvency)
      : operatingNumber === number ? result : undefined;
    result.overview = buildLandlordCovenantOverview(company, result, operating);
    return res.json(result);
  } catch { return res.status(502).json({ error: "The legal entity check could not be loaded. Try again shortly." }); }
}

export function registerLandlordCovenantRoutes(app: Express, authenticate: RequestHandler) {
  app.get("/api/landlord-relationships/:companyId/covenant", authenticate, (req, res) => handleLandlordCovenant(req, res));
}
