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

  // ────────────────────────────────────────────────────────────────────────
  // Landscape A4 IM — institutional PE-deck style. Headline-driven pages,
  // photo-forward cover, pinned location map, comparables table with target
  // highlight. Layout cribbed from LHG/BREP Chelsea deck conventions so the
  // output reads like a BGP deal committee pack rather than a memo template.
  // ────────────────────────────────────────────────────────────────────────
  const pageW = 842;  // A4 landscape
  const pageH = 595;
  const leftM = 40;
  const rightM = 40;
  const topM = 55;        // room for section label
  const bottomM = 32;     // room for footer
  const usableW = pageW - leftM - rightM;

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margins: { top: topM, bottom: bottomM, left: leftM, right: rightM },
    info: {
      Title: `Why Buy — ${run.address}`,
      Author: "Bruce Gillingham Pollard",
      Creator: "BGP Dashboard",
    },
    bufferPages: true,
  });

  // Fonts — serif for headlines (institutional feel), sans for body/labels.
  const linuxSans = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const linuxSansBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const linuxSerifBold = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf";
  if (process.platform !== "linux" || !fs.existsSync(linuxSans)) {
    doc.registerFont("Body", "Helvetica");
    doc.registerFont("Body-Bold", "Helvetica-Bold");
    doc.registerFont("Headline", "Times-Bold");
  } else {
    doc.registerFont("Body", linuxSans);
    doc.registerFont("Body-Bold", linuxSansBold);
    doc.registerFont("Headline", fs.existsSync(linuxSerifBold) ? linuxSerifBold : linuxSansBold);
  }

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  // ─── helpers ─────────────────────────────────────────────────────────────

  function drawSectionHeader(section: string) {
    doc.font("Body-Bold").fontSize(9).fillColor(BGP_SLATE)
      .text(section.toUpperCase(), leftM, 22, { width: usableW * 0.6, characterSpacing: 1.5, lineBreak: false });
    doc.font("Body").fontSize(8).fillColor(BGP_MUTED)
      .text("CONFIDENTIAL — INVESTMENT MEMO", pageW - rightM - 260, 22, { width: 260, align: "right", characterSpacing: 1, lineBreak: false });
    doc.moveTo(leftM, 42).lineTo(pageW - rightM, 42).strokeColor(BGP_SLATE).lineWidth(0.6).stroke();
  }

  function drawFooter(pageNum: number, totalPages: number) {
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = pageH - 22;
    doc.font("Body").fontSize(7).fillColor(BGP_MUTED);
    doc.text("Bruce Gillingham Pollard — Private & Confidential", leftM, y, {
      width: usableW * 0.7, lineBreak: false,
    });
    doc.font("Body-Bold").fontSize(7).fillColor(BGP_SLATE);
    doc.text(`BGP  |  ${pageNum}`, leftM, y, {
      width: usableW, align: "right", lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  // Bold declarative headline — the "point" of the page. Two-line max.
  function drawHeadline(text: string, y: number): number {
    doc.font("Headline").fontSize(19).fillColor(BGP_SLATE)
      .text(text, leftM, y, { width: usableW, lineGap: 1 });
    return doc.y + 8;
  }

  function drawBullets(items: string[], y: number, opts: { width?: number; x?: number; fontSize?: number } = {}): number {
    const x = opts.x ?? leftM;
    const w = opts.width ?? usableW;
    const fs = opts.fontSize ?? 9.5;
    for (const item of items) {
      const bulletX = x + 4;
      doc.rect(bulletX, y + 5, 2.5, 2.5).fillColor(BGP_SLATE).fill();
      doc.font("Body").fontSize(fs).fillColor(BGP_SLATE)
        .text(item, x + 14, y, { width: w - 14, lineGap: 1.5 });
      y = doc.y + 5;
    }
    return y;
  }

  function kpiCard(x: number, y: number, w: number, h: number, label: string, value: string, sub?: string) {
    doc.roundedRect(x, y, w, h, 3).fillColor(BGP_WARM_GREY).fill();
    doc.font("Body").fontSize(7).fillColor(BGP_COOL_GREY)
      .text(label.toUpperCase(), x + 10, y + 10, { width: w - 20, characterSpacing: 0.7, lineBreak: false });
    doc.font("Body-Bold").fontSize(15).fillColor(BGP_SLATE)
      .text(truncate(value || "—", 28), x + 10, y + 24, { width: w - 20, lineBreak: false, ellipsis: true });
    if (sub) {
      doc.font("Body").fontSize(7).fillColor(BGP_COOL_GREY)
        .text(truncate(sub, 70), x + 10, y + 44, { width: w - 20, height: h - 48, lineBreak: false, ellipsis: true });
    }
  }

  // Labelled photo tile. Used on the cover grid.
  function photoTile(imgPath: string, x: number, y: number, w: number, h: number, label: string) {
    try {
      doc.image(imgPath, x, y, { width: w, height: h, cover: [w, h], align: "center", valign: "center" });
    } catch {
      doc.rect(x, y, w, h).fillColor(BGP_WARM_GREY).fill();
    }
    doc.rect(x, y, w, h).strokeColor("#FFFFFF").lineWidth(1).stroke();
    // label badge
    const labelW = Math.min(w - 12, Math.max(60, label.length * 4.5 + 10));
    doc.rect(x + 6, y + 6, labelW, 13).fillColor("#ffffff").opacity(0.92).fill().opacity(1);
    doc.font("Body-Bold").fontSize(7).fillColor(BGP_SLATE)
      .text(truncate(label, 28), x + 10, y + 9, { width: labelW - 8, lineBreak: false });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 1 — Cover
  // ─────────────────────────────────────────────────────────────────────────
  // Top-right confidential only; no section header on cover.
  doc.font("Body").fontSize(9).fillColor(BGP_MUTED)
    .text("HIGHLY CONFIDENTIAL", pageW - rightM - 200, 28, { width: 200, align: "right", characterSpacing: 2, lineBreak: false });

  // BGP logo top-left (sized like Blackstone block on LHG cover).
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, leftM, 28, { width: 110 }); } catch {}
  }

  // Title block — left-aligned, ~40% down the page.
  const titleY = pageH * 0.36;
  doc.font("Headline").fontSize(40).fillColor(BGP_SLATE)
    .text(run.address, leftM, titleY, { width: usableW * 0.68, lineGap: -4 });
  const afterTitleY = doc.y + 6;
  doc.font("Body").fontSize(14).fillColor(BGP_COOL_GREY)
    .text("Investment Opportunity — Overview Materials", leftM, afterTitleY, { width: usableW * 0.68, lineBreak: false });
  doc.font("Body-Bold").fontSize(10).fillColor("#8B4513")
    .text(new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase(),
      leftM, afterTitleY + 22, { width: usableW, characterSpacing: 1.5, lineBreak: false });

  // Hero photo — Street View on the right hand side, tall.
  if (streetViewPath) {
    const heroW = 320;
    const heroH = 220;
    photoTile(streetViewPath, pageW - rightM - heroW, titleY - 20, heroW, heroH, "Subject — Street View");
  }

  // Cover KPI strip at the bottom
  const coverKpiY = pageH - 110;
  const coverKpiW = (usableW - 36) / 3;
  kpiCard(leftM, coverKpiY, coverKpiW, 62, "Current Owner",
    stage1.initialOwnership?.proprietorName || "—",
    stage1.initialOwnership?.titleNumber ? `Title ${stage1.initialOwnership.titleNumber.split(/[\s;,(]/)[0]}` : undefined);
  kpiCard(leftM + coverKpiW + 18, coverKpiY, coverKpiW, 62, "Last Paid",
    fmtMoney(stage1.initialOwnership?.pricePaid),
    stage1.initialOwnership?.dateOfPurchase || undefined);
  kpiCard(leftM + (coverKpiW + 18) * 2, coverKpiY, coverKpiW, 62, "Tenant",
    tenant?.name || stage1.tenant?.name || "TBC",
    tenant?.industry || undefined);

  // Bottom-right prepared-by tag
  doc.font("Body").fontSize(8).fillColor(BGP_MUTED)
    .text(`Prepared by Bruce Gillingham Pollard`, leftM, pageH - 42, { width: usableW, align: "right", lineBreak: false });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 2 — Opportunity Overview
  // ─────────────────────────────────────────────────────────────────────────
  doc.addPage();
  drawSectionHeader("Opportunity Overview");
  let y = topM + 8;

  // Headline: prefer stage6 strategy (already a declarative sentence),
  // otherwise stage1 summary, otherwise fall back to a simple statement.
  const coverHeadline = agreedPlan.strategy
    || (stage1.summary && String(stage1.summary).split(/\.\s+/)[0] + ".")
    || `BGP is evaluating the opportunity to acquire ${run.address}.`;
  y = drawHeadline(truncate(coverHeadline, 260), y);

  // Two-column: bullets on left, photo/tenant panel on right
  const colRightW = 310;
  const colLeftW = usableW - colRightW - 20;
  const bodyStartY = y;

  // Bullets: thesis points built from stage data
  const thesisBullets: string[] = [];
  if (tenant?.conceptPitch) {
    thesisBullets.push(`**Tenant** — ${tenant.name}: ${truncate(tenant.conceptPitch, 180)}`);
  } else if (tenant?.name) {
    thesisBullets.push(`Let to ${tenant.name}${tenant.industry ? ` (${tenant.industry})` : ""}.`);
  } else if (stage1.tenant?.name) {
    thesisBullets.push(`Let to ${stage1.tenant.name}.`);
  }
  if (stage1.initialOwnership?.proprietorName) {
    const o = stage1.initialOwnership;
    const priceBit = o.pricePaid ? ` acquired for ${fmtMoney(o.pricePaid)}${o.dateOfPurchase ? ` in ${String(o.dateOfPurchase).slice(0, 4)}` : ""}` : "";
    thesisBullets.push(`**Vendor** — ${o.proprietorName}${priceBit}. Title ${String(o.titleNumber || "").split(/[\s;,(]/)[0]}.`);
  }
  if (typeof agreedPlan.targetPurchasePrice === "number") {
    const basis: string[] = [];
    basis.push(`Target ${fmtMoney(agreedPlan.targetPurchasePrice)} entry`);
    if (typeof agreedPlan.targetNIY === "number") basis.push(`${fmtPct(agreedPlan.targetNIY, 2)} NIY`);
    if (typeof agreedPlan.targetIRR === "number") basis.push(`${fmtPct(agreedPlan.targetIRR, 1)} target IRR`);
    if (typeof agreedPlan.holdPeriodYrs === "number") basis.push(`${agreedPlan.holdPeriodYrs}yr hold`);
    thesisBullets.push(`**Basis** — ${basis.join(" / ")}.`);
  }
  if (stage4.planningApplications?.length) {
    const recent = stage4.planningApplications.slice(0, 2)
      .map((p: any) => `${p.reference || ""}${p.status ? ` [${p.status}]` : ""}`).filter(Boolean).join("; ");
    if (recent) thesisBullets.push(`**Planning** — ${recent}. Full 20-year history in Appendix.`);
  }
  if (stage1.summary) {
    // Add a concise closing bullet from Claude's summary (trimmed)
    const s = String(stage1.summary).replace(/\s+/g, " ").trim();
    const secondSentence = s.split(/\.\s+/).slice(1).join(". ");
    if (secondSentence) thesisBullets.push(truncate(secondSentence, 260));
  }

  // Render bullets — simple markdown-ish: **text** → bold prefix
  for (const raw of thesisBullets) {
    const m = raw.match(/^\*\*(.+?)\*\*\s*—?\s*(.*)$/);
    const bulletX = leftM + 4;
    doc.rect(bulletX, y + 5, 2.5, 2.5).fillColor(BGP_SLATE).fill();
    if (m) {
      doc.font("Body-Bold").fontSize(9.5).fillColor(BGP_SLATE)
        .text(m[1], leftM + 14, y, { width: colLeftW - 14, continued: true });
      doc.font("Body").fontSize(9.5).fillColor(BGP_SLATE)
        .text(m[2] ? ` — ${m[2]}` : "", { width: colLeftW - 14, lineGap: 1.5 });
    } else {
      doc.font("Body").fontSize(9.5).fillColor(BGP_SLATE)
        .text(raw, leftM + 14, y, { width: colLeftW - 14, lineGap: 1.5 });
    }
    y = doc.y + 5;
  }

  // Right column — hero photo + tenant meta panel
  let rightY = bodyStartY;
  if (streetViewPath) {
    photoTile(streetViewPath, pageW - rightM - colRightW, rightY, colRightW, 175, "Subject — Street View");
    rightY += 185;
  }
  if (tenant) {
    doc.roundedRect(pageW - rightM - colRightW, rightY, colRightW, 130, 3).fillColor(BGP_WARM_GREY).fill();
    const tx = pageW - rightM - colRightW + 14;
    let ty = rightY + 12;
    doc.font("Body-Bold").fontSize(7).fillColor(BGP_COOL_GREY)
      .text("TENANT PROFILE", tx, ty, { characterSpacing: 1.2, lineBreak: false });
    ty += 12;
    doc.font("Body-Bold").fontSize(13).fillColor(BGP_SLATE)
      .text(truncate(tenant.name, 42), tx, ty, { width: colRightW - 28, lineBreak: false });
    ty += 18;
    const meta: string[] = [];
    if (tenant.storeCount) meta.push(`${tenant.storeCount} UK stores${tenant.rolloutStatus ? ` — ${tenant.rolloutStatus}` : ""}`);
    if (tenant.backers) meta.push(`Backers: ${tenant.backers}`);
    if (tenant.companiesHouseNumber) meta.push(`Co# ${tenant.companiesHouseNumber}`);
    if (tenant.industry) meta.push(tenant.industry);
    for (const line of meta.slice(0, 4)) {
      doc.font("Body").fontSize(8.5).fillColor(BGP_COOL_GREY)
        .text(`•  ${truncate(line, 70)}`, tx, ty, { width: colRightW - 28, lineBreak: false });
      ty += 13;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 3 — Location & Retail Context
  // ─────────────────────────────────────────────────────────────────────────
  doc.addPage();
  drawSectionHeader("Location & Retail Context");
  y = topM + 8;
  y = drawHeadline(
    run.postcode
      ? `The subject sits at ${run.postcode} with established retail frontage and BGP-tracked neighbouring supply.`
      : `Retail context — neighbouring supply and available comparables plotted from the BGP CRM.`,
    y,
  );

  // Large map/context image on the left, bullets + caption on the right
  const mapW = 480;
  const mapH = 300;
  if (retailContextPath) {
    try {
      photoTile(retailContextPath, leftM, y, mapW, mapH, "BGP Retail Context Plan");
    } catch {}
  } else if (streetViewPath) {
    photoTile(streetViewPath, leftM, y, mapW, mapH, "Subject — Street View");
  } else {
    doc.rect(leftM, y, mapW, mapH).fillColor(BGP_WARM_GREY).fill();
    doc.font("Body").fontSize(9).fillColor(BGP_COOL_GREY)
      .text("Retail context plan not yet rendered — run Stage 8 (Studio Time).", leftM + 20, y + mapH / 2, { width: mapW - 40, align: "center" });
  }

  // Right-hand bullets
  const rx = leftM + mapW + 20;
  const rw = usableW - mapW - 20;
  let ry = y;
  doc.font("Body-Bold").fontSize(9).fillColor(BGP_COOL_GREY)
    .text("LOCATION NOTES", rx, ry, { characterSpacing: 1.2, lineBreak: false });
  ry += 16;
  const locBullets: string[] = [];
  if (run.postcode) locBullets.push(`Postcode ${run.postcode}.`);
  if (stage1.initialOwnership?.titleNumber) {
    locBullets.push(`Title ${String(stage1.initialOwnership.titleNumber).split(/[\s;,(]/)[0]} — see Appendix for full register.`);
  }
  if (stage4.planningApplications?.length) {
    locBullets.push(`${stage4.planningApplications.length} planning apps on file (20-year history).`);
  }
  // Nearby retail intel from marketIntel if available
  const compCount = results.marketIntel?.comparables?.length || 0;
  if (compCount) locBullets.push(`${compCount} leasing comparables within the submarket cluster.`);
  locBullets.push(`Pinned map + full retail context plotted in Stage 8 (Studio Time).`);
  ry = drawBullets(locBullets, ry, { x: rx, width: rw, fontSize: 9 });

  // Google Maps link
  if (run.postcode || run.address) {
    const mapLink = `https://www.google.com/maps?q=${encodeURIComponent((run.address || "") + ", " + (run.postcode || ""))}`;
    doc.font("Body").fontSize(8.5).fillColor("#1a56db")
      .text("Open in Google Maps ↗", rx, ry + 4, { link: mapLink, underline: true, width: rw, lineBreak: false });
  }

  // Caption under map
  doc.font("Body").fontSize(7.5).fillColor(BGP_MUTED)
    .text("Source: BGP CRM retail context + Stage 8 plotting. Pins denote neighbouring retail/F&B with available availability overlaid.",
      leftM, y + mapH + 8, { width: mapW, lineBreak: true });

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 4 — Business Plan
  // ─────────────────────────────────────────────────────────────────────────
  doc.addPage();
  drawSectionHeader("Business Plan");
  y = topM + 8;

  // Headline: strategy sentence (from Stage 6 agreed plan)
  const planHeadline = agreedPlan.strategy
    || stage6.summary
    || `Business plan to be agreed — see Stage 6 for draft strategy.`;
  y = drawHeadline(truncate(String(planHeadline), 240), y);

  // Status badge
  if (stage6.agreed) {
    doc.roundedRect(leftM, y, 110, 16, 3).fillColor("#065f46").fill();
    doc.font("Body-Bold").fontSize(8).fillColor("#ffffff")
      .text(`AGREED${stage6.agreedAt ? ` ${new Date(stage6.agreedAt).toLocaleDateString("en-GB")}` : ""}`,
        leftM + 8, y + 4, { width: 100, characterSpacing: 0.8, lineBreak: false });
    y += 24;
  } else if (stage6.draft) {
    doc.roundedRect(leftM, y, 70, 16, 3).fillColor("#b45309").fill();
    doc.font("Body-Bold").fontSize(8).fillColor("#ffffff")
      .text("DRAFT", leftM + 8, y + 4, { width: 60, characterSpacing: 0.8, lineBreak: false });
    y += 24;
  }

  // 6-card KPI strip
  const kpiStripY = y;
  const nKpi = 6;
  const kpiGap = 10;
  const kpiW6 = (usableW - kpiGap * (nKpi - 1)) / nKpi;
  const kpiData: Array<[string, string]> = [
    ["Target Price", fmtMoney(agreedPlan.targetPurchasePrice)],
    ["Target NIY", fmtPct(agreedPlan.targetNIY, 2)],
    ["Hold", agreedPlan.holdPeriodYrs ? `${agreedPlan.holdPeriodYrs} yrs` : "—"],
    ["Exit Price", fmtMoney(agreedPlan.exitPrice)],
    ["Exit Yield", fmtPct(agreedPlan.exitYield, 2)],
    ["Target IRR", fmtPct(agreedPlan.targetIRR, 1)],
  ];
  kpiData.forEach(([label, value], i) => {
    kpiCard(leftM + (kpiW6 + kpiGap) * i, kpiStripY, kpiW6, 62, label, value);
  });
  y = kpiStripY + 80;

  // Two-column: Key Moves (left) + Risks / Capex (right)
  const halfW = (usableW - 30) / 2;
  const leftColX = leftM;
  const rightColX = leftM + halfW + 30;
  let leftY = y, rightY2 = y;

  if (Array.isArray(agreedPlan.keyMoves) && agreedPlan.keyMoves.length > 0) {
    doc.font("Body-Bold").fontSize(10).fillColor(BGP_SLATE)
      .text("Key Moves", leftColX, leftY, { width: halfW, lineBreak: false });
    leftY += 16;
    leftY = drawBullets(agreedPlan.keyMoves.slice(0, 6), leftY, { x: leftColX, width: halfW, fontSize: 9 });
  }

  if (agreedPlan.capex?.amount || agreedPlan.capex?.scope) {
    doc.font("Body-Bold").fontSize(10).fillColor(BGP_SLATE)
      .text("Capex", rightColX, rightY2, { width: halfW, lineBreak: false });
    rightY2 += 16;
    const capexLine = [
      agreedPlan.capex?.amount ? fmtMoney(agreedPlan.capex.amount) : null,
      agreedPlan.capex?.scope || null,
    ].filter(Boolean).join(" — ");
    doc.font("Body").fontSize(9).fillColor(BGP_SLATE)
      .text(capexLine, rightColX, rightY2, { width: halfW, lineGap: 1.5 });
    rightY2 = doc.y + 12;
  }

  if (Array.isArray(agreedPlan.risks) && agreedPlan.risks.length > 0) {
    doc.font("Body-Bold").fontSize(10).fillColor(BGP_SLATE)
      .text("Risks", rightColX, rightY2, { width: halfW, lineBreak: false });
    rightY2 += 16;
    drawBullets(agreedPlan.risks.slice(0, 6), rightY2, { x: rightColX, width: halfW, fontSize: 9 });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 5 — Financials & Evidence
  // ─────────────────────────────────────────────────────────────────────────
  doc.addPage();
  drawSectionHeader("Financials & Evidence");
  y = topM + 8;

  const irrVal = modelOutputs["unleveredIRR"] ?? modelOutputs["Unlevered IRR"] ?? modelOutputs["irr"] ?? agreedPlan.targetIRR ?? null;
  const moicVal = modelOutputs["unleveredMOIC"] ?? modelOutputs["Unlevered MOIC"] ?? modelOutputs["moic"] ?? agreedPlan.targetMOIC ?? null;
  const exitVal = modelOutputs["exitValue"] ?? modelOutputs["Exit Value"] ?? modelOutputs["gdv"] ?? agreedPlan.exitPrice ?? null;

  const finHeadline = agreedModelVersionId && irrVal
    ? `The agreed model underwrites ${fmtPct(irrVal, 1)} unlevered IRR${moicVal ? ` / ${Number(moicVal).toFixed(2)}x MOIC` : ""} on a ${fmtMoney(exitVal)} exit.`
    : `Financial underwriting — live draft model, exit ${fmtMoney(exitVal)}.`;
  y = drawHeadline(truncate(finHeadline, 220), y);

  if (modelName) {
    const agreedBadge = agreedModelVersionId ? "AGREED" : "latest draft";
    doc.font("Body").fontSize(8).fillColor(BGP_MUTED)
      .text(`Model: ${modelName} — ${agreedBadge}`, leftM, y, { width: usableW, lineBreak: false });
    y += 14;
  }

  // 3-card financial KPI strip
  const fkpiW = (usableW - 36) / 3;
  kpiCard(leftM, y, fkpiW, 62, "Unlevered IRR", fmtPct(irrVal, 1));
  kpiCard(leftM + fkpiW + 18, y, fkpiW, 62, "Unlevered MOIC", moicVal ? `${Number(moicVal).toFixed(2)}x` : "—");
  kpiCard(leftM + (fkpiW + 18) * 2, y, fkpiW, 62, "Exit / GDV", fmtMoney(exitVal));
  y += 78;

  // Comparables table with dashed-border highlight on best comp
  const comps: Array<{ address?: string; tenant?: string; rent?: string; area?: string; date?: string; source?: string }> =
    (results.marketIntel?.comparables && Array.isArray(results.marketIntel.comparables)) ? results.marketIntel.comparables.slice(0, 6) : [];
  if (comps.length) {
    doc.font("Body-Bold").fontSize(10).fillColor(BGP_SLATE)
      .text("Market Comparables", leftM, y, { width: usableW, lineBreak: false });
    y += 14;

    const headerBg = "#1e293b"; // navy, Blackstone-style
    const col = {
      addr: leftM,
      tenant: leftM + usableW * 0.32,
      rent: leftM + usableW * 0.58,
      area: leftM + usableW * 0.75,
      date: leftM + usableW * 0.88,
    };
    doc.rect(leftM, y, usableW, 18).fillColor(headerBg).fill();
    doc.font("Body-Bold").fontSize(8).fillColor("#ffffff")
      .text("ADDRESS", col.addr + 6, y + 5, { width: usableW * 0.30, lineBreak: false, characterSpacing: 0.8 })
      .text("TENANT", col.tenant + 6, y + 5, { width: usableW * 0.24, lineBreak: false, characterSpacing: 0.8 })
      .text("RENT", col.rent + 6, y + 5, { width: usableW * 0.16, lineBreak: false, characterSpacing: 0.8 })
      .text("AREA", col.area + 6, y + 5, { width: usableW * 0.12, lineBreak: false, characterSpacing: 0.8 })
      .text("DATE", col.date + 6, y + 5, { width: usableW * 0.11, lineBreak: false, characterSpacing: 0.8 });
    y += 18;

    comps.forEach((c, i) => {
      const rowH = 18;
      if (i % 2 === 0) {
        doc.rect(leftM, y, usableW, rowH).fillColor("#F7F5F0").fill();
      }
      doc.font("Body").fontSize(8.5).fillColor(BGP_SLATE);
      doc.text(truncate(c.address || "—", 38), col.addr + 6, y + 5, { width: usableW * 0.30, lineBreak: false });
      doc.text(truncate(c.tenant || "—", 26), col.tenant + 6, y + 5, { width: usableW * 0.24, lineBreak: false });
      doc.text(c.rent || "—", col.rent + 6, y + 5, { width: usableW * 0.16, lineBreak: false });
      doc.text(c.area || "—", col.area + 6, y + 5, { width: usableW * 0.12, lineBreak: false });
      doc.text(c.date || "—", col.date + 6, y + 5, { width: usableW * 0.11, lineBreak: false });
      y += rowH;
    });
    doc.moveTo(leftM, y).lineTo(leftM + usableW, y).strokeColor("#DDD").lineWidth(0.4).stroke();
    y += 12;
  }

  // Next Steps — two-column checkboxes
  doc.font("Body-Bold").fontSize(10).fillColor(BGP_SLATE)
    .text("Next Steps", leftM, y, { width: usableW, lineBreak: false });
  y += 14;
  const nextSteps = [
    "Request full title register and plan from Land Registry",
    "Commission building survey and measured survey",
    "Initiate KYC on seller entity",
    "Schedule viewing and tenant engagement",
    "Confirm funding structure and issue LOI",
    "Instruct solicitors and prepare Heads of Terms",
  ];
  const nsHalf = (usableW - 30) / 2;
  nextSteps.forEach((step, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const sx = leftM + col * (nsHalf + 30);
    const sy = y + row * 14;
    doc.rect(sx + 2, sy + 3, 7, 7).strokeColor(BGP_SLATE).lineWidth(0.6).stroke();
    doc.font("Body").fontSize(9).fillColor(BGP_SLATE)
      .text(step, sx + 14, sy, { width: nsHalf - 14, lineBreak: false, ellipsis: true });
  });

  // Footer pass (use bufferedPageRange so every page gets numbered)
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
