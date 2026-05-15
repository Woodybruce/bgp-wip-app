// Why Buy — Gamma variant.
//
// Parallel path to `why-buy-renderer.ts` (pdfkit). Reads the same pathway run
// state, flattens it into a structured markdown brief, and hands the brief to
// Gamma's Generate API. Downloads the resulting PDF, saves to the usual
// image_studio_images table + SharePoint so the UI can link to it next to the
// existing Why Buy PDF for comparison.

import fs from "fs";
import path from "path";
import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  propertyPathwayRuns,
  excelModelRuns,
  excelModelRunVersions,
  imageStudioImages,
  crmCompanies,
} from "@shared/schema";
import { gammaGenerate, gammaWaitFor, gammaDownloadExport } from "./gamma";
import { getPlanningSummary, getPlanningSummaryForLocation, planningSummaryToMarkdown } from "./planning-summary";

const OUT_DIR = path.join(process.cwd(), "uploads", "why-buy-gamma");

function fmtMoney(n?: number | null): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  if (Math.abs(x) >= 1_000_000) return `£${(x / 1_000_000).toFixed(x >= 10_000_000 ? 0 : 1)}m`;
  if (Math.abs(x) >= 1_000) return `£${Math.round(x / 1_000)}k`;
  return `£${x.toLocaleString()}`;
}

function fmtPct(n?: number | null, digits: number = 1): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  const scaled = Math.abs(x) < 1 ? x * 100 : x;
  return `${scaled.toFixed(digits)}%`;
}

function kv(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return `- **${label}:** ${value}`;
}

export async function buildBrief(runId: string): Promise<{ brief: string; title: string; address: string }> {
  const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
  if (!run) throw new Error("Pathway run not found");

  const r = (run.stageResults as any) || {};
  const s1 = r.stage1 || {};
  const s2 = r.stage2 || {};
  const s4 = r.stage4 || {};
  const s6 = r.stage6 || {};
  const plan = s6.agreed || s6.draft || {};

  // Tenant/brand company
  let tenant: any = null;
  if (s2.companyId) {
    const [c] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, s2.companyId)).limit(1);
    tenant = c;
  }

  // Model outputs (prefer locked/agreed version)
  let modelOutputs: Record<string, any> = {};
  let modelName: string | null = null;
  const agreedModelVersionId: string | undefined = r.stage7?.modelVersionId;
  const modelRunId = run.modelRunId || r.stage7?.modelRunId;
  if (modelRunId) {
    const [modelRun] = await db.select().from(excelModelRuns).where(eq(excelModelRuns.id, modelRunId)).limit(1);
    if (modelRun) {
      modelName = modelRun.name;
      let version: any = null;
      if (agreedModelVersionId) {
        const [v] = await db.select().from(excelModelRunVersions).where(eq(excelModelRunVersions.id, agreedModelVersionId)).limit(1);
        version = v;
      }
      if (!version) {
        const [latest] = await db
          .select()
          .from(excelModelRunVersions)
          .where(eq(excelModelRunVersions.modelRunId, modelRunId))
          .orderBy(desc(excelModelRunVersions.version))
          .limit(1);
        version = latest;
      }
      if (version?.outputValues) modelOutputs = version.outputValues as any;
      else if ((modelRun as any).outputValues) {
        try { modelOutputs = JSON.parse((modelRun as any).outputValues); } catch {}
      }
    }
  }

  const address = run.address;
  const postcode = (run as any).postcode || s1.postcode || "";
  const title = `Why Buy — ${address}`;

  const aiFacts = s1.aiFacts || {};
  const tenancy = s1.tenancy || {};
  const units: any[] = Array.isArray(tenancy.units) ? tenancy.units : [];
  const mainTenants: string[] = Array.isArray(aiFacts.mainTenants) ? aiFacts.mainTenants : [];
  const comps: any[] = Array.isArray(r.marketIntel?.comparables) ? r.marketIntel.comparables
    : Array.isArray(s4?.comparables) ? s4.comparables : [];

  const irr = modelOutputs.unleveredIRR ?? modelOutputs.irr;
  const moic = modelOutputs.unleveredMOIC ?? modelOutputs.moic;
  const exit = modelOutputs.exitValue ?? modelOutputs.gdv ?? modelOutputs.exit;
  const entryPrice = plan.entryPrice ?? modelOutputs.entryPrice ?? aiFacts.askingPrice;
  const rent = plan.passingRent ?? tenancy.passingRent ?? aiFacts.passingRent;
  const area = aiFacts.totalArea ?? aiFacts.nia ?? aiFacts.gia;

  const lines: string[] = [];

  // Cover / title
  lines.push(`# ${title}`);
  if (postcode) lines.push(`${address}, ${postcode} — Investment Opportunity Overview`);
  else lines.push(`${address} — Investment Opportunity Overview`);
  lines.push("");

  // Executive Summary
  lines.push(`## Executive Summary`);
  const summary = s6.summary || plan.summary || aiFacts.summary;
  if (summary) lines.push(summary);
  const highlights: string[] = [];
  const hl = kv("Asking / Entry", fmtMoney(entryPrice)); if (hl) highlights.push(hl);
  const hr = kv("Passing rent", fmtMoney(rent)); if (hr) highlights.push(hr);
  const ha = kv("Area", area ? `${Number(area).toLocaleString()} sq ft` : null); if (ha) highlights.push(ha);
  const hi = kv("Unlevered IRR (target)", fmtPct(irr, 1)); if (hi) highlights.push(hi);
  const hm = kv("Unlevered MOIC", moic ? `${Number(moic).toFixed(2)}x` : null); if (hm) highlights.push(hm);
  const he = kv("Exit / GDV", fmtMoney(exit)); if (he) highlights.push(he);
  if (highlights.length) { lines.push(""); lines.push(...highlights); }
  lines.push("");

  // Business Plan
  if (plan.thesis || plan.strategy || Array.isArray(plan.keyActions)) {
    lines.push(`## Business Plan`);
    if (plan.thesis) lines.push(plan.thesis);
    if (plan.strategy && plan.strategy !== plan.thesis) lines.push("", plan.strategy);
    if (Array.isArray(plan.keyActions) && plan.keyActions.length) {
      lines.push("");
      lines.push(`**Key Actions**`);
      for (const a of plan.keyActions.slice(0, 8)) lines.push(`- ${a}`);
    }
    lines.push("");
  }

  // Asset / Tenancy
  lines.push(`## The Asset`);
  const assetKv: string[] = [];
  const akAddr = kv("Address", [address, postcode].filter(Boolean).join(", ")); if (akAddr) assetKv.push(akAddr);
  const akArea = kv("Net area", area ? `${Number(area).toLocaleString()} sq ft` : null); if (akArea) assetKv.push(akArea);
  const akUse = kv("Use class / description", aiFacts.useClass || aiFacts.propertyType || s1.description); if (akUse) assetKv.push(akUse);
  const akTen = kv("Occupancy", tenancy.occupancyStatus || aiFacts.occupancyStatus); if (akTen) assetKv.push(akTen);
  const akWault = kv("WAULT", tenancy.waultYears ? `${tenancy.waultYears} yrs` : null); if (akWault) assetKv.push(akWault);
  if (assetKv.length) lines.push(...assetKv);
  if (units.length) {
    lines.push("", `**Unit Schedule**`);
    for (const u of units.slice(0, 10)) {
      const bits = [u.name || u.unit || "Unit", u.tenantName, u.area ? `${u.area} sq ft` : null, u.rent ? fmtMoney(u.rent) : null].filter(Boolean);
      lines.push(`- ${bits.join(" — ")}`);
    }
  }
  lines.push("");

  // Tenant / Brand
  if (tenant || mainTenants.length) {
    lines.push(`## The Tenant`);
    if (tenant) {
      const tKv: string[] = [];
      const tkName = kv("Name", tenant.name); if (tkName) tKv.push(tkName);
      const tkSector = kv("Sector", tenant.industry); if (tkSector) tKv.push(tkSector);
      const tkCov = kv("Covenant / AML risk", tenant.amlRiskLevel); if (tkCov) tKv.push(tkCov);
      const tkSites = kv("UK sites", tenant.storeCount); if (tkSites) tKv.push(tkSites);
      const tkRev = kv("Turnover", fmtMoney(tenant.annualRevenue)); if (tkRev) tKv.push(tkRev);
      if (tKv.length) lines.push(...tKv);
      if (tenant.description) lines.push("", tenant.description);
    } else if (mainTenants.length) {
      lines.push(`Occupiers include: ${mainTenants.slice(0, 6).join(", ")}.`);
    }
    lines.push("");
  }

  // Market / Comps
  if (comps.length) {
    lines.push(`## Market Comparables`);
    lines.push(`| Address | Tenant | Rent | Area | Date |`);
    lines.push(`|---|---|---|---|---|`);
    for (const c of comps.slice(0, 8)) {
      lines.push(`| ${c.address || "—"} | ${c.tenant || "—"} | ${c.rent || "—"} | ${c.area || "—"} | ${c.date || "—"} |`);
    }
    lines.push("");
  }

  // Financials
  if (Object.keys(modelOutputs).length) {
    lines.push(`## Financials`);
    if (modelName) lines.push(`_Source model: ${modelName}${agreedModelVersionId ? " (agreed version)" : ""}_`);
    const fkv: string[] = [];
    const f1 = kv("Unlevered IRR", fmtPct(irr, 1)); if (f1) fkv.push(f1);
    const f2 = kv("Unlevered MOIC", moic ? `${Number(moic).toFixed(2)}x` : null); if (f2) fkv.push(f2);
    const f3 = kv("Exit value / GDV", fmtMoney(exit)); if (f3) fkv.push(f3);
    const f4 = kv("Entry price", fmtMoney(entryPrice)); if (f4) fkv.push(f4);
    const f5 = kv("Stabilised NOI", fmtMoney(modelOutputs.stabilisedNOI ?? modelOutputs.noi)); if (f5) fkv.push(f5);
    const f6 = kv("Net initial yield", fmtPct(modelOutputs.niy, 2)); if (f6) fkv.push(f6);
    if (fkv.length) lines.push("", ...fkv);
    lines.push("");
  }

  // Risks
  const risks: string[] = Array.isArray(plan.risks) ? plan.risks
    : Array.isArray(aiFacts.risks) ? aiFacts.risks : [];
  if (risks.length) {
    lines.push(`## Risks & Mitigants`);
    for (const rk of risks.slice(0, 8)) {
      if (typeof rk === "string") lines.push(`- ${rk}`);
      else {
        const o: any = rk;
        lines.push(`- ${o.risk || o.description || JSON.stringify(o)}`);
      }
    }
    lines.push("");
  }

  // Planning context — sourced live from planning.data.gov.uk + PlanIt so the
  // brief cites current designations and recent application history regardless
  // of whether stage 4 of the pathway captured them.
  try {
    const planning = run.propertyId
      ? await getPlanningSummary(run.propertyId)
      : await getPlanningSummaryForLocation({
          cacheKey: `pathway:${run.id}`,
          postcode,
          lat: (run as any).lat ?? null,
          lng: (run as any).lng ?? null,
          propertyName: address,
        });
    const planningMd = planningSummaryToMarkdown(planning);
    if (planningMd && planningMd.split("\n").length > 1) {
      lines.push(planningMd);
      lines.push("");
    }
  } catch (e: any) {
    console.warn(`[why-buy-gamma] planning context failed: ${e?.message}`);
  }

  // Next Steps
  lines.push(`## Next Steps`);
  const nextSteps: string[] = Array.isArray(plan.nextSteps) && plan.nextSteps.length
    ? plan.nextSteps
    : [
        "Request full title register and plan from Land Registry",
        "Commission building survey and measured survey",
        "Initiate KYC on seller entity",
        "Schedule viewing and tenant engagement",
        "Confirm funding structure and issue LOI",
        "Instruct solicitors and prepare Heads of Terms",
      ];
  for (const st of nextSteps.slice(0, 8)) lines.push(`- ${st}`);

  const brief = lines.join("\n");
  return { brief, title, address };
}

// ─── DEPRECATED: renderWhyBuyGamma removed (May 2026) ────────────────────────
// The Gamma export path was removed when Claude design proved a better
// renderer. The route + UI buttons are gone; this file now only exports
// buildBrief (still used by server/why-buy-design.ts).
//
// Future migration: replace why-buy-design.ts's buildBrief call with
// document-briefs.runBrief("why-buy-memo") so Stage 9 fully consumes the
// brief framework. Then this file can be deleted.
