// Why Buy renderer — 4-page PE-style investment memo PDF.
//
// Reads the full state of a property_pathway_run, assembles a compact, branded
// PDF (BGP monochrome palette, logo, Work Sans family on body), and uploads
// the result to SharePoint `Investment/<Property>/Why Buy Deck/`.

import type { Request } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  propertyPathwayRuns,
  excelModelRuns,
  excelModelRunVersions,
  imageStudioImages,
  crmCompanies,
} from "@shared/schema";

const BGP_SLATE = "#232323";
const BGP_WARM_GREY = "#E8E6DF";
const BGP_COOL_GREY = "#596264";
const BGP_MUTED = "#9E9E9E";

const LOGO_PATH = path.join(process.cwd(), "attached_assets", "BGP_BlackHolder_1771853582461.png");
const OUT_DIR = path.join(process.cwd(), "uploads", "why-buy");

function ensureDirs() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

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

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export async function renderWhyBuy(args: { runId: string; req?: Request }): Promise<{ documentUrl?: string; sharepointUrl?: string; pdfPath: string }> {
  ensureDirs();
  // @ts-ignore — pdfkit ships without bundled types
  const PDFDocument = (await import("pdfkit")).default;

  const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, args.runId)).limit(1);
  if (!run) throw new Error("Pathway run not found");

  const results = run.stageResults as any;
  const stage1 = results.stage1 || {};
  const stage2 = results.stage2 || {};
  const stage4 = results.stage4 || {};
  const stage6 = results.stage6 || {};        // Business Plan (agreed + draft)
  const stage8 = results.stage8 || {};        // Studio Time (images)
  const agreedPlan = stage6.agreed || stage6.draft || {};

  // Load tenant/brand company if linked
  let tenant: any = null;
  if (stage2.companyId) {
    const [c] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, stage2.companyId)).limit(1);
    tenant = c;
  }

  // Load Street View + Retail Context Plan images (now sourced from Stage 8)
  let streetViewPath: string | null = null;
  let retailContextPath: string | null = null;
  if (stage8.streetViewImageId) {
    const [img] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, stage8.streetViewImageId)).limit(1);
    if (img?.localPath && fs.existsSync(img.localPath)) streetViewPath = img.localPath;
  }
  if (stage8.retailContextImageId) {
    const [img] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, stage8.retailContextImageId)).limit(1);
    if (img?.localPath && fs.existsSync(img.localPath)) retailContextPath = img.localPath;
  }

  // Load model outputs — prefer the LOCKED (agreed) version from stage7 if present,
  // otherwise fall back to latest.
  let modelOutputs: Record<string, any> = {};
  let modelName: string | null = null;
  const agreedModelVersionId: string | undefined = results.stage7?.modelVersionId;
  const modelRunId = run.modelRunId || results.stage7?.modelRunId;
  if (modelRunId) {
    const [modelRun] = await db.select().from(excelModelRuns).where(eq(excelModelRuns.id, modelRunId)).limit(1);
    if (modelRun) {
      modelName = modelRun.name;
      let version: any = null;
      if (agreedModelVersionId) {
        const [v] = await db
          .select()
          .from(excelModelRunVersions)
          .where(eq(excelModelRunVersions.id, agreedModelVersionId))
          .limit(1);
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
      else if (modelRun.outputValues) {
        try { modelOutputs = JSON.parse(modelRun.outputValues); } catch {}
      }
    }
  }

  // PDF init
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 45, right: 45 },
    info: {
      Title: `Why Buy — ${run.address}`,
      Author: "Bruce Gillingham Pollard",
      Creator: "BGP Dashboard",
    },
    bufferPages: true,
  });

  // Fonts — Helvetica is a safe default; DejaVu on Linux
  const linuxFont = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const linuxFontBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  if (process.platform !== "linux" || !fs.existsSync(linuxFont)) {
    doc.registerFont("Body", "Helvetica");
    doc.registerFont("Body-Bold", "Helvetica-Bold");
  } else {
    doc.registerFont("Body", linuxFont);
    doc.registerFont("Body-Bold", linuxFontBold);
  }

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const pageW = 595;
  const pageH = 842;
  const leftM = 45;
  const rightM = 45;
  const usableW = pageW - leftM - rightM;

  function drawHeader(showLogo: boolean = true) {
    if (showLogo && fs.existsSync(LOGO_PATH)) {
      try {
        doc.image(LOGO_PATH, leftM, 22, { width: 80 });
      } catch {}
    }
    doc.font("Body").fontSize(8).fillColor(BGP_COOL_GREY)
      .text("CONFIDENTIAL — INVESTMENT MEMO", pageW - rightM - 200, 30, { width: 200, align: "right" });
    doc.moveTo(leftM, 50).lineTo(pageW - rightM, 50).strokeColor(BGP_SLATE).lineWidth(0.4).stroke();
  }

  function drawFooter(pageNum: number, totalPages: number) {
    const y = pageH - 35;
    doc.font("Body").fontSize(7).fillColor(BGP_MUTED)
      .text("Bruce Gillingham Pollard — Private & Confidential", leftM, y, { width: usableW * 0.6 })
      .text(`Page ${pageNum} of ${totalPages}`, leftM, y, { width: usableW, align: "right" });
  }

  function kpiCard(x: number, y: number, w: number, h: number, label: string, value: string, sub?: string) {
    doc.roundedRect(x, y, w, h, 4).fillColor(BGP_WARM_GREY).fill();
    doc.font("Body").fontSize(7).fillColor(BGP_COOL_GREY)
      .text(label.toUpperCase(), x + 10, y + 10, { width: w - 20, characterSpacing: 0.5 });
    doc.font("Body-Bold").fontSize(14).fillColor(BGP_SLATE)
      .text(value, x + 10, y + 24, { width: w - 20 });
    if (sub) {
      doc.font("Body").fontSize(7).fillColor(BGP_COOL_GREY)
        .text(sub, x + 10, y + h - 16, { width: w - 20 });
    }
  }

  // ──────────────────────────────────────────────────────────
  // PAGE 1 — Cover
  // ──────────────────────────────────────────────────────────
  drawHeader();
  let y = 80;
  doc.font("Body").fontSize(10).fillColor(BGP_COOL_GREY).text("INVESTMENT OPPORTUNITY", leftM, y, { characterSpacing: 1.2 });
  y += 18;
  doc.font("Body-Bold").fontSize(26).fillColor(BGP_SLATE).text(run.address, leftM, y, { width: usableW });
  y = doc.y + 4;
  if (run.postcode) {
    doc.font("Body").fontSize(11).fillColor(BGP_COOL_GREY).text(run.postcode, leftM, y);
    y = doc.y + 14;
  }

  // Subject photo (Street View)
  if (streetViewPath) {
    try {
      doc.image(streetViewPath, leftM, y, { width: usableW, height: 320, fit: [usableW, 320], align: "center" });
      y += 330;
    } catch {
      y += 10;
    }
  }

  // KPI strip
  const kpiY = y + 8;
  const kpiW = (usableW - 24) / 3;
  kpiCard(leftM, kpiY, kpiW, 60, "Current Owner", truncate(stage1.initialOwnership?.proprietorName || "—", 22), stage1.initialOwnership?.titleNumber ? `Title ${stage1.initialOwnership.titleNumber}` : undefined);
  kpiCard(leftM + kpiW + 12, kpiY, kpiW, 60, "Last Paid", fmtMoney(stage1.initialOwnership?.pricePaid), stage1.initialOwnership?.dateOfPurchase || undefined);
  kpiCard(leftM + (kpiW + 12) * 2, kpiY, kpiW, 60, "Tenant", truncate(tenant?.name || stage1.tenant?.name || "TBC", 22), tenant?.industry || undefined);

  // Cover bottom tag
  doc.font("Body").fontSize(8).fillColor(BGP_MUTED)
    .text(`Prepared by Bruce Gillingham Pollard — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, leftM, pageH - 60, { width: usableW });

  // ──────────────────────────────────────────────────────────
  // PAGE 2 — Investment Thesis & Owner
  // ──────────────────────────────────────────────────────────
  doc.addPage();
  drawHeader();
  y = 80;
  doc.font("Body-Bold").fontSize(16).fillColor(BGP_SLATE).text("Investment Thesis", leftM, y);
  y = doc.y + 10;

  const thesis = stage1.summary || `Opportunity to acquire ${run.address}.`;
  doc.font("Body").fontSize(10).fillColor(BGP_SLATE).text(thesis, leftM, y, { width: usableW, lineGap: 2 });
  y = doc.y + 16;

  // Tenant / Brand section
  if (tenant) {
    doc.font("Body-Bold").fontSize(12).fillColor(BGP_SLATE).text(`Tenant: ${tenant.name}`, leftM, y);
    y = doc.y + 6;
    const lines: string[] = [];
    if (tenant.conceptPitch) lines.push(tenant.conceptPitch);
    if (tenant.storeCount) lines.push(`${tenant.storeCount} UK stores${tenant.rolloutStatus ? ` — ${tenant.rolloutStatus}` : ""}`);
    if (tenant.backers) lines.push(`Backers: ${tenant.backers}`);
    if (tenant.companiesHouseNumber) lines.push(`Co# ${tenant.companiesHouseNumber}`);
    for (const line of lines) {
      doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY).text(`  •  ${line}`, leftM, y, { width: usableW });
      y = doc.y + 3;
    }
    y += 8;
  }

  // Owner / seller
  if (stage1.initialOwnership?.proprietorName) {
    doc.font("Body-Bold").fontSize(12).fillColor(BGP_SLATE).text("Seller", leftM, y);
    y = doc.y + 6;
    const o = stage1.initialOwnership;
    const oLines = [
      `${o.proprietorName}${o.proprietorCategory ? ` (${o.proprietorCategory})` : ""}`,
      o.pricePaid ? `Acquired for ${fmtMoney(o.pricePaid)}${o.dateOfPurchase ? ` on ${o.dateOfPurchase}` : ""}` : null,
      `Title ${o.titleNumber}`,
    ].filter(Boolean) as string[];
    for (const line of oLines) {
      doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY).text(`  •  ${line}`, leftM, y, { width: usableW });
      y = doc.y + 3;
    }
    y += 8;
  }

  // Planning highlights
  if (stage4.planningApplications?.length) {
    doc.font("Body-Bold").fontSize(12).fillColor(BGP_SLATE).text("Planning Activity", leftM, y);
    y = doc.y + 6;
    for (const p of stage4.planningApplications.slice(0, 4)) {
      doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY)
        .text(`  •  ${p.reference || ""}${p.status ? ` [${p.status}]` : ""} — ${truncate(p.description || "", 130)}`, leftM, y, { width: usableW });
      y = doc.y + 3;
    }
  }

  // ──────────────────────────────────────────────────────────
  // PAGE 3 — Business Plan (agreed)
  // ──────────────────────────────────────────────────────────
  doc.addPage();
  drawHeader();
  y = 80;
  doc.font("Body-Bold").fontSize(16).fillColor(BGP_SLATE).text("Business Plan", leftM, y);
  y = doc.y + 4;

  if (stage6.agreed) {
    doc.font("Body").fontSize(8).fillColor(BGP_MUTED).text(
      `Agreed${stage6.agreedAt ? ` on ${new Date(stage6.agreedAt).toLocaleDateString("en-GB")}` : ""}${stage6.agreedBy ? ` by ${stage6.agreedBy}` : ""}`,
      leftM, y, { width: usableW }
    );
    y = doc.y + 10;
  } else if (stage6.draft) {
    doc.font("Body").fontSize(8).fillColor("#b45309").text("DRAFT — plan not yet agreed", leftM, y, { width: usableW });
    y = doc.y + 10;
  }

  if (agreedPlan.strategy) {
    doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Strategy", leftM, y);
    y = doc.y + 4;
    doc.font("Body").fontSize(10).fillColor(BGP_SLATE).text(agreedPlan.strategy, leftM, y, { width: usableW, lineGap: 2 });
    y = doc.y + 12;
  }

  if (stage6.summary && !agreedPlan.strategy) {
    // Fallback — use Claude's conversational summary if no explicit strategy string
    doc.font("Body").fontSize(10).fillColor(BGP_SLATE).text(stage6.summary, leftM, y, { width: usableW, lineGap: 2 });
    y = doc.y + 12;
  }

  // Plan KPI strip — agreed targets
  const planKpiY = y;
  const planKpiW = (usableW - 24) / 3;
  kpiCard(leftM, planKpiY, planKpiW, 56, "Target Price", fmtMoney(agreedPlan.targetPurchasePrice));
  kpiCard(leftM + planKpiW + 12, planKpiY, planKpiW, 56, "Target NIY", fmtPct(agreedPlan.targetNIY));
  kpiCard(leftM + (planKpiW + 12) * 2, planKpiY, planKpiW, 56, "Hold Period", agreedPlan.holdPeriodYrs ? `${agreedPlan.holdPeriodYrs} yrs` : "—");
  y = planKpiY + 68;

  const planKpiY2 = y;
  kpiCard(leftM, planKpiY2, planKpiW, 56, "Exit Price", fmtMoney(agreedPlan.exitPrice));
  kpiCard(leftM + planKpiW + 12, planKpiY2, planKpiW, 56, "Exit Yield", fmtPct(agreedPlan.exitYield));
  kpiCard(leftM + (planKpiW + 12) * 2, planKpiY2, planKpiW, 56, "Target IRR", fmtPct(agreedPlan.targetIRR));
  y = planKpiY2 + 72;

  // Key moves
  if (Array.isArray(agreedPlan.keyMoves) && agreedPlan.keyMoves.length > 0) {
    doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Key Moves", leftM, y);
    y = doc.y + 6;
    for (const move of agreedPlan.keyMoves) {
      doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY).text(`  •  ${move}`, leftM, y, { width: usableW });
      y = doc.y + 3;
    }
    y += 8;
  }

  // Capex callout
  if (agreedPlan.capex?.amount || agreedPlan.capex?.scope) {
    doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Capex", leftM, y);
    y = doc.y + 4;
    const capexLine = [
      agreedPlan.capex?.amount ? fmtMoney(agreedPlan.capex.amount) : null,
      agreedPlan.capex?.scope || null,
    ].filter(Boolean).join(" — ");
    doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY).text(capexLine, leftM, y, { width: usableW });
    y = doc.y + 10;
  }

  // Risks
  if (Array.isArray(agreedPlan.risks) && agreedPlan.risks.length > 0) {
    doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Risks", leftM, y);
    y = doc.y + 6;
    for (const r of agreedPlan.risks) {
      doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY).text(`  •  ${r}`, leftM, y, { width: usableW });
      y = doc.y + 3;
    }
  }

  // ──────────────────────────────────────────────────────────
  // PAGE 4 — Location & Retail Context
  // ──────────────────────────────────────────────────────────
  doc.addPage();
  drawHeader();
  y = 80;
  doc.font("Body-Bold").fontSize(16).fillColor(BGP_SLATE).text("Location & Retail Context", leftM, y);
  y = doc.y + 8;

  if (retailContextPath) {
    try {
      doc.image(retailContextPath, leftM, y, { width: usableW, height: 380, fit: [usableW, 380], align: "center" });
      y += 390;
      doc.font("Body").fontSize(8).fillColor(BGP_MUTED)
        .text("BGP Retail Context Plan — neighbouring retail/F&B units plotted from CRM. Red pins denote available units.", leftM, y, { width: usableW });
      y = doc.y + 10;
    } catch { y += 10; }
  } else {
    doc.font("Body").fontSize(10).fillColor(BGP_COOL_GREY).text("Retail context plan not yet rendered — run Stage 8 (Studio Time).", leftM, y);
    y += 20;
  }

  // Embedded Google Maps link
  if (run.postcode) {
    const mapLink = `https://www.google.com/maps?q=${encodeURIComponent(run.address + ", " + run.postcode)}`;
    doc.font("Body").fontSize(9).fillColor("#1a56db")
      .text("Open in Google Maps ↗", leftM, y, { link: mapLink, underline: true, width: usableW });
    y = doc.y + 8;
  }

  // ──────────────────────────────────────────────────────────
  // PAGE 5 — Financials, Comps & Next Steps
  // ──────────────────────────────────────────────────────────
  doc.addPage();
  drawHeader();
  y = 80;
  doc.font("Body-Bold").fontSize(16).fillColor(BGP_SLATE).text("Financials & Evidence", leftM, y);
  y = doc.y + 4;

  if (modelName) {
    const agreedBadge = agreedModelVersionId ? " — AGREED" : " — latest draft";
    doc.font("Body").fontSize(8).fillColor(BGP_MUTED).text(`Model: ${modelName}${agreedBadge}`, leftM, y);
    y = doc.y + 10;
  }

  // Financial KPIs from agreed (or latest) model version
  const fkpiY = y;
  const fkpiW = (usableW - 24) / 3;
  const irr = modelOutputs["unleveredIRR"] ?? modelOutputs["Unlevered IRR"] ?? modelOutputs["irr"] ?? agreedPlan.targetIRR ?? null;
  const moic = modelOutputs["unleveredMOIC"] ?? modelOutputs["Unlevered MOIC"] ?? modelOutputs["moic"] ?? agreedPlan.targetMOIC ?? null;
  const exit = modelOutputs["exitValue"] ?? modelOutputs["Exit Value"] ?? modelOutputs["gdv"] ?? agreedPlan.exitPrice ?? null;
  kpiCard(leftM, fkpiY, fkpiW, 60, "Unlevered IRR", fmtPct(irr));
  kpiCard(leftM + fkpiW + 12, fkpiY, fkpiW, 60, "Unlevered MOIC", moic ? `${Number(moic).toFixed(2)}x` : "—");
  kpiCard(leftM + (fkpiW + 12) * 2, fkpiY, fkpiW, 60, "Exit / GDV", fmtMoney(exit));
  y = fkpiY + 72;

  // Additional outputs table
  const extraOutputs = Object.entries(modelOutputs).filter(([k]) => !/IRR|MOIC|exitValue|Exit Value|gdv/i.test(k)).slice(0, 6);
  if (extraOutputs.length) {
    doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Key Model Outputs", leftM, y);
    y = doc.y + 6;
    for (const [k, v] of extraOutputs) {
      doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY);
      const label = String(k).replace(/_/g, " ");
      const value = typeof v === "number" ? (Math.abs(v) < 10 ? v.toFixed(3) : v.toLocaleString()) : String(v);
      doc.text(`  •  ${label}: `, leftM, y, { continued: true, width: usableW })
        .font("Body-Bold").fillColor(BGP_SLATE).text(value);
      y = doc.y + 2;
    }
    y += 10;
  }

  // Market comparables table (from market intel + stage1 comps)
  const comps: Array<{ address?: string; tenant?: string; rent?: string; area?: string; date?: string; source?: string }> =
    (results.marketIntel?.comparables && Array.isArray(results.marketIntel.comparables)) ? results.marketIntel.comparables.slice(0, 6) : [];
  if (comps.length) {
    doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Market Comparables", leftM, y);
    y = doc.y + 6;

    // Table header
    const col = {
      addr: leftM,
      tenant: leftM + usableW * 0.32,
      rent: leftM + usableW * 0.58,
      area: leftM + usableW * 0.75,
      date: leftM + usableW * 0.88,
    };
    doc.rect(leftM, y, usableW, 14).fillColor(BGP_WARM_GREY).fill();
    doc.font("Body-Bold").fontSize(8).fillColor(BGP_SLATE)
      .text("ADDRESS", col.addr + 4, y + 3, { width: usableW * 0.30 })
      .text("TENANT", col.tenant + 4, y + 3, { width: usableW * 0.24 })
      .text("RENT", col.rent + 4, y + 3, { width: usableW * 0.16 })
      .text("AREA", col.area + 4, y + 3, { width: usableW * 0.12 })
      .text("DATE", col.date + 4, y + 3, { width: usableW * 0.11 });
    y += 14;

    for (const c of comps) {
      const rowH = 16;
      doc.font("Body").fontSize(8).fillColor(BGP_SLATE);
      doc.text(truncate(c.address || "—", 34), col.addr + 4, y + 4, { width: usableW * 0.30 });
      doc.text(truncate(c.tenant || "—", 24), col.tenant + 4, y + 4, { width: usableW * 0.24 });
      doc.text(c.rent || "—", col.rent + 4, y + 4, { width: usableW * 0.16 });
      doc.text(c.area || "—", col.area + 4, y + 4, { width: usableW * 0.12 });
      doc.text(c.date || "—", col.date + 4, y + 4, { width: usableW * 0.11 });
      doc.moveTo(leftM, y + rowH).lineTo(leftM + usableW, y + rowH).strokeColor("#EEE").lineWidth(0.3).stroke();
      y += rowH;
    }
    y += 10;
  }

  doc.font("Body-Bold").fontSize(11).fillColor(BGP_SLATE).text("Next Steps", leftM, y);
  y = doc.y + 6;
  const nextSteps = [
    "Request full title register and plan from Land Registry",
    "Commission building survey and measured survey",
    "Initiate KYC on seller entity",
    "Schedule viewing and tenant engagement",
    "Confirm funding structure and issue LOI",
  ];
  for (const step of nextSteps) {
    doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY).text(`  ☐  ${step}`, leftM, y, { width: usableW });
    y = doc.y + 3;
  }

  // Apply footers to all pages before ending
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(i + 1, range.count);
  }

  doc.end();
  const buf: Buffer = await new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // Persist
  const fileName = `why-buy-${run.id}-${Date.now()}.pdf`;
  const pdfPath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(pdfPath, buf);

  // Try to upload to SharePoint
  let sharepointUrl: string | undefined;
  try {
    const { uploadFileToSharePoint } = await import("./microsoft");
    const folderPath = run.sharepointFolderPath
      ? `${run.sharepointFolderPath}/Why Buy Deck`
      : `BGP share drive/Investment/${run.address.replace(/[\/\\:*?"<>|]/g, "-")}/Why Buy Deck`;
    const upload = await uploadFileToSharePoint(buf, fileName, "application/pdf", folderPath);
    sharepointUrl = upload.webUrl;
  } catch (err: any) {
    console.warn("[why-buy] SharePoint upload failed:", err?.message);
  }

  return {
    documentUrl: `/uploads/why-buy/${fileName}`,
    sharepointUrl,
    pdfPath,
  };
}
