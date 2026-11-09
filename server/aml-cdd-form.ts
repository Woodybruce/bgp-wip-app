// The KYC form — the app's replacement for the KYC4U "Standard KYC form"
// BGP used until Sept 2026 (Woody: "I want to use the app to replicate it").
// Same sections: risk factors (client / geographic / other), the SDD/EDD
// items (structure chart, authority to instruct, client background, adverse
// media, source of funds, financial statements, joint agency, certified
// documents), the ownership chain, the UBO table with each owner's ID
// method, a detailed risk assessment and a recommendation — plus the
// counterparty's agent and solicitors checks.
//
// The app pre-fills what it knows and writes the RECOMMENDATION; a named
// BGP person signs off (fee earner, plus the Nominated Officer for higher
// risk) — the form's own two approval lines.
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

export type RiskLevel = "low" | "high";
export type CddForm = {
  role?: "party" | "counterparty";
  workType?: string;
  riskFactors?: { client?: RiskLevel; geographic?: RiskLevel; other?: RiskLevel };
  structureChart?: string;
  authorityToInstruct?: string;
  clientBackground?: string;
  metFaceToFace?: boolean | null;
  adverseMedia?: string;
  sourceOfFunds?: string;
  financialStatements?: string;
  jointAgency?: string;
  documentsCertified?: string;
  ownershipChain?: Array<{ name: string; country?: string; orgType?: string }>;
  ubos?: Array<{ name: string; country?: string; idMethod?: string }>;
  riskNarrative?: string;
  counterparty?: {
    agentName?: string; agentHmrcRegistered?: string; agentComplianceTeam?: string; agentNegativeMedia?: string; brokerView?: string;
    solicitorName?: string; solicitorSizeReputation?: string; solicitorNegativeMedia?: string;
  };
  recommendation?: { verdict: "recommend" | "recommend_with_conditions" | "do_not_recommend"; reasons: string[]; generatedAt: string };
  source?: Record<string, string>;
  importedFrom?: string;
};

/** Overall level from the three factors — any high factor makes it high. */
export function overallRisk(form: CddForm): RiskLevel | null {
  const f = form.riskFactors || {};
  const vals = [f.client, f.geographic, f.other].filter(Boolean) as RiskLevel[];
  if (!vals.length) return null;
  return vals.includes("high") ? "high" : "low";
}

/** The app's recommendation — what KYC4U used to write at the bottom of the form. */
export function recommend(input: { sanctionsMatch: boolean; rejected: boolean; outstanding: string[]; higherRisk: boolean; form: CddForm }): NonNullable<CddForm["recommendation"]> {
  const reasons: string[] = [];
  if (input.rejected) reasons.push("The Nominated Officer has rejected this counterparty");
  if (input.sanctionsMatch) reasons.push("Sanctions screening returned a possible match — resolve before proceeding");
  if (reasons.length) return { verdict: "do_not_recommend", reasons, generatedAt: new Date().toISOString() };
  if (input.outstanding.length) reasons.push(`Outstanding: ${input.outstanding.join("; ")}`);
  if (input.higherRisk) reasons.push("Higher risk — Nominated Officer approval required");
  if (input.form.metFaceToFace === false) reasons.push("Not met face to face — identity verified remotely (Veriff / certified documents)");
  const unverified = (input.form.ubos || []).filter(u => !u.idMethod || /to verify/i.test(u.idMethod));
  if (unverified.length) reasons.push(`Beneficial owner ID to verify: ${unverified.map(u => u.name).join(", ")}`);
  if (reasons.length) return { verdict: "recommend_with_conditions", reasons, generatedAt: new Date().toISOString() };
  return { verdict: "recommend", reasons: ["All applicable CDD complete; standard risk"], generatedAt: new Date().toISOString() };
}

const ORG_TYPES: Record<string, string> = {
  ltd: "Limited company", plc: "Public limited company", llp: "Limited liability partnership",
  "private-unlimited": "Unlimited company", "limited-partnership": "Limited partnership", "oversea-company": "Overseas company",
};

/** Pre-fill from what the app already holds. Never overwrites a field someone typed. */
export async function prefillCddForm(companyId: string): Promise<CddForm> {
  const c = (await pool.query(`SELECT * FROM crm_companies WHERE id=$1`, [companyId])).rows[0];
  if (!c) throw Object.assign(new Error("Company not found"), { status: 404 });
  const existing: CddForm = c.aml_cdd_form || {};
  const typed = new Set(Object.entries(existing.source || {}).filter(([, v]) => v === "manual" || v === "kyc4u").map(([k]) => k));
  const form: CddForm = { ...existing, source: { ...(existing.source || {}) } };
  const put = <K extends keyof CddForm>(key: K, value: CddForm[K] | undefined | null) => {
    if (value === undefined || value === null || typed.has(key as string)) return;
    (form as any)[key] = value; form.source![key as string] = "app";
  };

  // The latest run, but its ownership data from the latest run that HAD
  // PSCs — a sweep whose Companies House PSC call failed returns none.
  const inv = (await pool.query(`SELECT result, sanctions_match FROM kyc_investigations WHERE crm_company_id=$1 ORDER BY conducted_at DESC NULLS LAST, id DESC LIMIT 1`, [companyId])).rows[0];
  const withPscs = (await pool.query(`SELECT result FROM kyc_investigations WHERE crm_company_id=$1 AND jsonb_array_length(COALESCE(result->'pscs','[]'::jsonb)) > 0 ORDER BY conducted_at DESC NULLS LAST, id DESC LIMIT 1`, [companyId])).rows[0];
  const result = { ...(inv?.result || {}), pscs: (inv?.result?.pscs?.length ? inv.result.pscs : withPscs?.result?.pscs) || [] };
  const profile = c.companies_house_data?.profile || {};

  // Ownership chain: the company, then the corporate owners up the chain.
  const chain: CddForm["ownershipChain"] = [];
  if (c.companies_house_number) chain.push({ name: profile.companyName || c.uk_entity_name || c.name, country: "UK", orgType: ORG_TYPES[profile.companyType] || "Limited company" });
  for (const link of result?.ownershipChain?.chain || []) {
    const name = link?.name || link?.company_name;
    if (name && !chain.some(x => x.name.toLowerCase() === String(name).toLowerCase())) chain.push({ name, country: link?.country || link?.jurisdiction || "UK", orgType: link?.type || "Company" });
  }
  for (const p of result?.pscs || []) {
    if (p?.ceased_on || p?.ceasedOn) continue;
    if (!/corporate|legal-person/.test(String(p?.kind || ""))) continue;
    if (!chain.some(x => x.name.toLowerCase() === String(p.name).toLowerCase())) chain.push({ name: p.name, country: p?.identification?.country_registered || p?.address?.country || "", orgType: p?.identification?.legal_form || "Company" });
  }
  if (chain.length) put("ownershipChain", chain);
  put("structureChart", chain.length > 2 ? "Structure chart saved to evidence file" : c.aml_subject_type === "individual" ? "Not required - individual client" : chain.length ? "Not required - simple structure" : undefined);

  // UBOs: individuals over 25% (or significant control), with how each was verified.
  const docs = (await pool.query(`SELECT doc_type FROM kyc_documents WHERE company_id=$1 AND deleted_at IS NULL`, [companyId])).rows.map((r: any) => r.doc_type);
  const veriff = (await pool.query(`SELECT first_name, last_name FROM veriff_sessions WHERE company_id=$1 AND status='approved'`, [companyId]).catch(() => ({ rows: [] as any[] }))).rows;
  // CH raw items use snake_case; the auto-KYC record stores camelCase.
  const ubos = (result?.pscs || [])
    .filter((p: any) => !(p?.ceased_on || p?.ceasedOn) && /individual/.test(String(p?.kind || ""))
      && ((p.natures_of_control || p.naturesOfControl || []) as string[]).some((n: string) => /(25-to-50|50-to-75|75-to-100)-percent|significant-influence-or-control/.test(n)))
    .map((p: any) => {
      const words = String(p.name || "").toLowerCase().split(/\s+/);
      const viaVeriff = veriff.some((v: any) => [v.first_name, v.last_name].every((w: string) => w && words.includes(String(w).toLowerCase())));
      return { name: p.name, country: p.country_of_residence || p.countryOfResidence || p.nationality || "", idMethod: viaVeriff ? "Veriff (biometric)" : docs.includes("passport") ? "ID documents" : "To verify" };
    });
  if (ubos.length) put("ubos", ubos);

  // Risk factors
  const { ownershipJurisdictions } = await import("./kyc-orchestrator");
  const codes = await ownershipJurisdictions(result).catch(() => [] as string[]);
  const highCountries = codes.length ? (await pool.query(`SELECT country_code FROM aml_country_risks WHERE risk_level='high' AND country_code = ANY($1::text[])`, [codes])).rows : [];
  const overseasChain = chain.some(x => x.country && !/^(uk|united kingdom|gb|england|scotland|wales)$/i.test(x.country));
  put("riskFactors", {
    client: /^pep|rca|review_required/.test(String(c.aml_pep_status || "")) || inv?.sanctions_match || profile.hasInsolvencyHistory ? "high" : "low",
    geographic: highCountries.length ? "high" : overseasChain ? "high" : "low",
    other: chain.length > 3 ? "high" : "low",
  });

  const am = result?.adverseMedia || null;
  if (am?.verdict) put("adverseMedia", am.verdict === "clear" ? "No adverse media found" : `Adverse media: ${am.verdict} — see the sweep`);
  if (c.last_accounts_storage_key || result?.covenant) put("financialStatements", result?.covenant ? "Accounts reviewed in the covenant report (Companies House filings)" : "Filed accounts on record");
  put("documentsCertified", docs.length ? "All information from public sources or verified with trusted third parties" : undefined);

  // Counterparty agent from the deal the company is on (the HOTs fill the acquisition agent).
  const deal = (await pool.query(
    `SELECT d.id, d.deal_type, d.bgp_acting_for, d.tenant_id, d.landlord_id, a.name AS agent_name
       FROM crm_deals d LEFT JOIN crm_companies a ON a.id = d.acquisition_agent_id
      WHERE d.tenant_id=$1 OR d.landlord_id=$1 OR d.vendor_id=$1 OR d.purchaser_id=$1
      ORDER BY d.updated_at DESC NULLS LAST LIMIT 1`, [companyId])).rows[0];
  if (deal) {
    const isClient = (deal.bgp_acting_for || "landlord") === "landlord" ? deal.landlord_id === companyId : deal.tenant_id === companyId;
    put("role", isClient ? "party" : "counterparty");
    put("workType", deal.deal_type || undefined);
    if (!isClient) {
      put("authorityToInstruct", "Counter-party: Not our client");
      if (deal.agent_name && !typed.has("counterparty")) form.counterparty = { ...(form.counterparty || {}), agentName: form.counterparty?.agentName || deal.agent_name };
    }
  }
  return form;
}

async function recomputeRecommendation(companyId: string, form: CddForm): Promise<CddForm> {
  const c = (await pool.query(`SELECT * FROM crm_companies WHERE id=$1`, [companyId])).rows[0];
  const inv = (await pool.query(`SELECT sanctions_match FROM kyc_investigations WHERE crm_company_id=$1 ORDER BY conducted_at DESC NULLS LAST LIMIT 1`, [companyId])).rows[0];
  const { outstandingAmlItems, isHigherRisk } = await import("../shared/aml-checklist");
  const higherRisk = isHigherRisk({ ...c, aml_cdd_form: form });
  const open = outstandingAmlItems(c.aml_checklist, c.aml_subject_type || (c.companies_house_number ? "company" : null), c.aml_edd_required, higherRisk).filter(i => i.id !== "mlro_review");
  return { ...form, recommendation: recommend({ sanctionsMatch: !!inv?.sanctions_match, rejected: c.kyc_status === "rejected" && !!c.kyc_approved_by, outstanding: open.map(i => i.label), higherRisk, form }) };
}

async function saveForm(companyId: string, form: CddForm) {
  const withRec = await recomputeRecommendation(companyId, form);
  await pool.query(`UPDATE crm_companies SET aml_cdd_form=$2::jsonb, updated_at=NOW() WHERE id=$1`, [companyId, JSON.stringify(withRec)]);
  return withRec;
}

// ── KYC4U form import ────────────────────────────────────────────────────
// Parses the "Client Standard KYC form" / "Counter-party Standard KYC form"
// sheet of a KYC4U workbook (label in column A, value in B/C) into the form.
export function parseKyc4uRows(rows: Array<{ row: number; cells: Record<string, string> }>): CddForm {
  const form: CddForm = { source: {} };
  const byLabel = new Map<string, Record<string, string>>();
  for (const r of rows) if (r.cells.A) byLabel.set(r.cells.A.trim().toLowerCase(), r.cells);
  const val = (label: string, col = "C") => { const r = byLabel.get(label); const v = r?.[col] || r?.B; return v && v.trim() && !/^#REF!|^0$/.test(v.trim()) ? v.trim() : undefined; };
  const lvl = (label: string) => { const v = val(label); return v ? (/high/i.test(v) ? "high" : "low") as RiskLevel : undefined; };
  const set = (k: keyof CddForm, v: any) => { if (v !== undefined) { (form as any)[k] = v; form.source![k as string] = "kyc4u"; } };
  set("role", /counter/i.test(val("party or counter-party checks", "B") || "") ? "counterparty" : "party");
  set("workType", val("work type", "B"));
  set("riskFactors", { client: lvl("client risk indicators"), geographic: lvl("geographic risk indicators"), other: lvl("other risk indicators") });
  set("structureChart", val("structure chart"));
  set("authorityToInstruct", val("authority to instruct"));
  set("clientBackground", val("client background"));
  const bg = val("client background") || "";
  if (/face to face/i.test(bg)) set("metFaceToFace", !/not met|never met|no face/i.test(bg));
  set("adverseMedia", val("adverse media from web search"));
  set("sourceOfFunds", val("source of funds for acquisitions"));
  set("financialStatements", val("financial statements"));
  set("jointAgency", val("is this a joint agency"));
  set("documentsCertified", val("are documents certified?"));
  // Tables: rows after the headings, until a blank / next heading.
  const table = (heading: RegExp) => {
    const start = rows.findIndex(r => heading.test(r.cells.A || ""));
    if (start < 0) return [] as Array<Record<string, string>>;
    const out: Array<Record<string, string>> = [];
    for (let i = start + 2; i < rows.length; i++) {
      const a = (rows[i].cells.A || "").trim();
      if (!a || /^details of|^detailed risk|^recommendation/i.test(a)) break;
      if (/^#REF!|^0$|^\*$/.test(a)) continue;
      out.push(rows[i].cells);
    }
    return out;
  };
  const chain = table(/details of client structure/i).map(r => ({ name: r.A.trim(), country: (r.B || "").trim(), orgType: (r.C || "").trim() }));
  if (chain.length) set("ownershipChain", chain);
  const ubos = table(/details of ultimate beneficial owners/i).map(r => ({ name: r.A.trim(), country: (r.B || "").trim(), idMethod: (r.C || "").trim() }));
  if (ubos.length) set("ubos", ubos);
  const narrIdx = rows.findIndex(r => /^detailed risk assessment/i.test(r.cells.A || ""));
  if (narrIdx >= 0 && rows[narrIdx + 1]?.cells.A && !/^recommendation/i.test(rows[narrIdx + 1].cells.A)) set("riskNarrative", rows[narrIdx + 1].cells.A.trim());
  const cp = {
    agentName: val("name of counterparty agent", "B") || val("who is the agent representing the counter party"),
    agentHmrcRegistered: val("is the agent registered with hmrc?", "B") || val("is the agent office registered with hmrc?"),
    agentComplianceTeam: val("does the agent have a compliance team?", "B"),
    agentNegativeMedia: val("is ther any negative media around the agency?", "B") || val("is there any negative media around the agent?"),
    brokerView: val("what is our brokers view of the other agents reputation?"),
    solicitorName: val("name of counterparty solicitors", "B") || val("who are the counter party's lawyers?"),
    solicitorSizeReputation: val("what is the size and reputation of the solicitors?", "B") || val("what is the size and reputation of the law firm?"),
    solicitorNegativeMedia: val("is there any negative media around the solicitors?", "B") || val("is there any negative media around the law firm?"),
  };
  if (Object.values(cp).some(Boolean)) set("counterparty", Object.fromEntries(Object.entries(cp).filter(([, v]) => v)));
  return form;
}

/** Read the first KYC form sheet of a KYC4U .xlsx into label/value rows. */
export async function readKyc4uWorkbook(buffer: Buffer): Promise<CddForm | null> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const text = (n: string) => zip.getEntry(n)?.getData().toString("utf8") || "";
  const wb = text("xl/workbook.xml");
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1]);
  const idx = names.findIndex(n => /standard kyc form/i.test(n) && !/counter/i.test(n));
  const cpIdx = names.findIndex(n => /counter-?party standard kyc form/i.test(n));
  if (idx < 0 && cpIdx < 0) return null;
  const strings = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join("")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  const sheetRows = (i: number) => {
    const xml = text(`xl/worksheets/sheet${i + 1}.xml`);
    const rows = new Map<number, Record<string, string>>();
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (m[4] || "").match(/<v>([^<]*)<\/v>/)?.[1] ?? (m[4] || "").match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
      if (v === undefined) continue;
      const value = /t="s"/.test(m[3]) ? strings[Number(v)] ?? "" : v;
      const r = rows.get(Number(m[2])) || {}; r[m[1]] = value; rows.set(Number(m[2]), r);
    }
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => ({ row, cells }));
  };
  // The client sheet is filled for a party, the counter-party sheet otherwise.
  const client = idx >= 0 ? parseKyc4uRows(sheetRows(idx)) : null;
  const cp = cpIdx >= 0 ? parseKyc4uRows(sheetRows(cpIdx)) : null;
  const filled = (f: CddForm | null) => f ? (f.ownershipChain?.length || 0) + (f.ubos?.length || 0) + Object.keys(f.source || {}).length : 0;
  return filled(client) >= filled(cp) ? client : cp;
}

export async function importKyc4uForm(companyId: string, buffer: Buffer, fileName: string): Promise<CddForm | null> {
  const parsed = await readKyc4uWorkbook(buffer);
  if (!parsed) return null;
  const c = (await pool.query(`SELECT aml_cdd_form FROM crm_companies WHERE id=$1`, [companyId])).rows[0];
  const existing: CddForm = c?.aml_cdd_form || {};
  const manual = new Set(Object.entries(existing.source || {}).filter(([, v]) => v === "manual").map(([k]) => k));
  const merged: CddForm = { ...existing, source: { ...(existing.source || {}) }, importedFrom: fileName };
  for (const [k, v] of Object.entries(parsed)) {
    if (k === "source" || manual.has(k)) continue;
    (merged as any)[k] = v; merged.source![k] = "kyc4u";
  }
  return saveForm(companyId, merged);
}

const EDITABLE = new Set(["role", "workType", "riskFactors", "structureChart", "authorityToInstruct", "clientBackground", "metFaceToFace", "adverseMedia",
  "sourceOfFunds", "financialStatements", "jointAgency", "documentsCertified", "ownershipChain", "ubos", "riskNarrative", "counterparty"]);

router.get("/api/kyc/company/:id/cdd-form", requireAuth, async (req: Request, res: Response) => {
  try {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req)) return res.status(403).json({ error: "Staff only" });
    const c = (await pool.query(`SELECT aml_cdd_form FROM crm_companies WHERE id=$1`, [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: "Company not found" });
    let form: CddForm = c.aml_cdd_form || {};
    if (!form.recommendation || req.query.prefill === "1") form = await saveForm(String(req.params.id), await prefillCddForm(String(req.params.id)));
    res.json({ form, overallRisk: overallRisk(form) });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message });
  }
});

router.put("/api/kyc/company/:id/cdd-form", requireAuth, async (req: Request, res: Response) => {
  try {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req)) return res.status(403).json({ error: "Staff only" });
    const c = (await pool.query(`SELECT aml_cdd_form FROM crm_companies WHERE id=$1`, [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: "Company not found" });
    const form: CddForm = { ...(c.aml_cdd_form || {}), source: { ...(c.aml_cdd_form?.source || {}) } };
    const changed: string[] = [];
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!EDITABLE.has(k)) continue;
      (form as any)[k] = v; form.source![k] = "manual"; changed.push(k);
    }
    const saved = await saveForm(String(req.params.id), form);
    const uid = (req.session as any)?.userId || (req as any).tokenUserId || null;
    const name = uid ? (await pool.query(`SELECT name FROM users WHERE id=$1`, [uid])).rows[0]?.name : null;
    if (changed.length) await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'kyc_form_updated', $2, $3)`, [req.params.id, name || uid, changed.join(", ")]).catch(() => {});
    res.json({ form: saved, overallRisk: overallRisk(saved) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
