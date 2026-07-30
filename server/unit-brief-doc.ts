// Operator Targeting Brief renderer — branded one/two page PDF for a
// letting tracker unit's targeting brief (e.g. Landsec instructions).
// Persists into unit_marketing_files (Postgres file_storage) and files a
// best-effort copy into the scheme's SharePoint folder tree.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  unitBriefs,
  unitTargetOperators,
  unitMarketingFiles,
  availableUnits,
  crmProperties,
} from "@shared/schema";

const BGP_SLATE = "#232323";
const BGP_COOL_GREY = "#596264";
const BGP_MUTED = "#9E9E9E";
const LOGO_CANDIDATES = [
  path.join(process.cwd(), "attached_assets", "BGP_BlackHolder_1771853582461.png"),
  path.join(process.cwd(), "server", "assets", "BGP_BlackHolder.png"),
  path.join(process.cwd(), "dist", "server", "assets", "BGP_BlackHolder.png"),
];

function fmtMoney(n?: number | null): string {
  if (n === undefined || n === null || !Number.isFinite(Number(n))) return "—";
  return `£${Number(n).toLocaleString("en-GB")}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export async function generateBriefDocument(briefId: string): Promise<{
  fileId: string;
  downloadUrl: string;
  fileName: string;
  sharepointUrl?: string;
}> {
  const [brief] = await db.select().from(unitBriefs).where(eq(unitBriefs.id, briefId)).limit(1);
  if (!brief) throw new Error("Brief not found");

  const targets = await db.select().from(unitTargetOperators)
    .where(eq(unitTargetOperators.briefId, brief.id))
    .orderBy(unitTargetOperators.sortOrder, unitTargetOperators.createdAt);

  const [unit] = await db.select().from(availableUnits).where(eq(availableUnits.id, brief.unitId)).limit(1);
  if (!unit) throw new Error("Unit not found for brief");

  const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, brief.propertyId)).limit(1);
  const propertyName = property?.name || "Property";

  // @ts-ignore — pdfkit ships without bundled types
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, bottom: 64, left: 55, right: 55 },
    info: { Title: brief.title || "Operator Targeting Brief", Author: "Bruce Gillingham Pollard", Creator: "BGP Dashboard" },
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const pageWidth = doc.page.width - 110;

  // Header
  const logoPath = LOGO_CANDIDATES.find(p => fs.existsSync(p));
  if (logoPath) {
    try { doc.image(logoPath, 55, 40, { height: 26 }); } catch {}
  }
  doc.fontSize(8).fillColor(BGP_MUTED).font("Helvetica")
    .text(brief.clientCompany ? `Prepared for ${brief.clientCompany}` : "Bruce Gillingham Pollard", 55, 46, { width: pageWidth, align: "right" });

  doc.y = 90;
  doc.fontSize(16).fillColor(BGP_SLATE).font("Helvetica-Bold")
    .text((brief.title || "Operator Targeting Brief").toUpperCase(), { width: pageWidth });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor(BGP_COOL_GREY).font("Helvetica")
    .text(`${propertyName} — ${unit.unitName}${unit.floor ? ` (${unit.floor})` : ""}`, { width: pageWidth });
  doc.moveDown(0.4);
  doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y).strokeColor(BGP_SLATE).lineWidth(1).stroke();
  doc.moveDown(0.6);

  // Commercials strip
  const commercials: [string, string][] = [
    ["Size", unit.sqft ? `${unit.sqft.toLocaleString("en-GB")} sq ft` : "—"],
    ["Rent", unit.askingRent ? `${fmtMoney(unit.askingRent)} pa` : "—"],
    ["Service Charge", unit.serviceChargePa ? `${fmtMoney(unit.serviceChargePa)} pa` : "—"],
    ["Rates", unit.ratesPa ? `${fmtMoney(unit.ratesPa)} pa` : "—"],
    ["Use Class", unit.useClass || "—"],
  ];
  const colW = pageWidth / commercials.length;
  const stripY = doc.y;
  commercials.forEach(([label, value], i) => {
    doc.fontSize(7).fillColor(BGP_MUTED).font("Helvetica").text(label.toUpperCase(), 55 + i * colW, stripY, { width: colW - 8 });
    doc.fontSize(10).fillColor(BGP_SLATE).font("Helvetica-Bold").text(value, 55 + i * colW, stripY + 10, { width: colW - 8 });
  });
  doc.y = stripY + 34;

  const section = (title: string, body?: string | null) => {
    if (!body) return;
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor(BGP_COOL_GREY).font("Helvetica-Bold").text(title.toUpperCase(), 55, doc.y, { width: pageWidth, characterSpacing: 0.8 });
    doc.moveDown(0.15);
    doc.fontSize(9.5).fillColor(BGP_SLATE).font("Helvetica").text(body, { width: pageWidth, lineGap: 1.5 });
  };

  section("Objective", brief.objective);
  section("Location & Context", brief.locationContext);
  section("Target Operator", brief.targetCriteria);
  section("Priority Categories", brief.priorityCategories);
  section("Agent Instruction", brief.agentInstruction);

  const deliverables: string[] = [];
  if (brief.deadline1Date || brief.deadline1Deliverables) {
    deliverables.push(`By ${fmtDate(brief.deadline1Date)}:\n${brief.deadline1Deliverables || "—"}`);
  }
  if (brief.deadline2Date || brief.deadline2Deliverables) {
    deliverables.push(`By ${fmtDate(brief.deadline2Date)}:\n${brief.deadline2Deliverables || "—"}`);
  }
  if (deliverables.length > 0) section("Deliverables", deliverables.join("\n\n"));
  section("Success Measures", brief.successMeasures);

  if (targets.length > 0) {
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor(BGP_COOL_GREY).font("Helvetica-Bold").text("TARGET OPERATORS", 55, doc.y, { width: pageWidth, characterSpacing: 0.8 });
    doc.moveDown(0.3);
    const cols = [
      { label: "Operator", w: 0.26 },
      { label: "Category", w: 0.24 },
      { label: "Priority", w: 0.10 },
      { label: "Status", w: 0.14 },
      { label: "Rationale / Relationship", w: 0.26 },
    ];
    let y = doc.y;
    let x = 55;
    doc.fontSize(7.5).fillColor(BGP_MUTED).font("Helvetica-Bold");
    for (const c of cols) { doc.text(c.label.toUpperCase(), x, y, { width: pageWidth * c.w - 6 }); x += pageWidth * c.w; }
    y += 12;
    doc.moveTo(55, y - 2).lineTo(doc.page.width - 55, y - 2).strokeColor(BGP_MUTED).lineWidth(0.5).stroke();
    for (const t of targets) {
      if (y > doc.page.height - 100) { doc.addPage(); y = 70; }
      x = 55;
      const detail = [t.rationale, t.existingRelationship].filter(Boolean).join(" · ");
      const cells = [t.operatorName, t.category || "—", t.priority || "—", t.status || "Identified", detail || "—"];
      let rowH = 12;
      doc.fontSize(8.5).font("Helvetica").fillColor(BGP_SLATE);
      cells.forEach((cell, i) => {
        const w = pageWidth * cols[i].w - 6;
        const h = doc.heightOfString(cell, { width: w });
        rowH = Math.max(rowH, h + 4);
      });
      cells.forEach((cell, i) => {
        const w = pageWidth * cols[i].w - 6;
        doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").text(cell, x, y, { width: w });
        x += pageWidth * cols[i].w;
      });
      y += rowH;
    }
    doc.y = y;
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor(BGP_MUTED).font("Helvetica")
      .text(
        `Bruce Gillingham Pollard — Confidential${brief.instructedDate ? `  ·  Instructed ${fmtDate(brief.instructedDate)}` : ""}  ·  Page ${i - range.start + 1} of ${range.count}`,
        55, doc.page.height - 46, { width: pageWidth, align: "center" }
      );
  }

  doc.end();
  const buf: Buffer = await new Promise(resolve => { doc.on("end", () => resolve(Buffer.concat(chunks))); });

  // Persist into unit files (Postgres file_storage)
  const { saveFile } = await import("./file-storage");
  const safeTitle = (brief.title || "Operator Targeting Brief").replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeTitle}.pdf`;
  const fileName = `${safeTitle}.pdf`;
  await saveFile(`marketing-files/${uniqueName}`, buf, "application/pdf", fileName);
  const [file] = await db.insert(unitMarketingFiles).values({
    unitId: unit.id,
    fileName,
    filePath: `/uploads/marketing-files/${uniqueName}`,
    fileType: "targeting_brief",
    fileSize: buf.length,
    mimeType: "application/pdf",
  }).returning();

  await db.update(unitBriefs)
    .set({ documentFileId: file.id, updatedAt: new Date() })
    .where(eq(unitBriefs.id, brief.id));

  // Best-effort SharePoint filing into the scheme folder tree
  let sharepointUrl: string | undefined;
  try {
    const { uploadFileToSharePoint } = await import("./microsoft");
    const teamFolder = unit.location === "London" ? "London Leasing" : "National Leasing";
    const schemeName = propertyName.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 120);
    const candidates = [
      `BGP share drive/${teamFolder}/${schemeName}/Targeting Briefs`,
      `BGP share drive/${teamFolder}/${schemeName}`,
      undefined, // helper default: BGP share drive/ChatBGP Documents
    ];
    for (const folderPath of candidates) {
      try {
        const upload = await uploadFileToSharePoint(buf, fileName, "application/pdf", folderPath);
        sharepointUrl = upload.webUrl;
        break;
      } catch {}
    }
  } catch (err: any) {
    console.warn("[unit-brief] SharePoint upload failed:", err?.message);
  }

  return { fileId: file.id, downloadUrl: file.filePath, fileName, sharepointUrl };
}

const BRIEF_EXTRACT_PROMPT = `You are extracting a structured "operator targeting brief" from a client document (typically a landlord's leasing instruction to their agent, e.g. from Landsec).

Extract as many of the following fields as you can. Return ONLY a valid JSON object. Use null for fields you cannot determine. Dates must be ISO format (YYYY-MM-DD); if the document gives relative deadlines like "within 14 days", compute them from the instructed/issue date if known, otherwise leave null and put the wording in the deliverables text.

{
  "title": "Document title, e.g. 'Operator Targeting Brief – 145A Queen Street, Westgate (L29A)'",
  "clientCompany": "The instructing client / landlord, e.g. 'Landsec'",
  "objective": "The letting objective",
  "locationContext": "Location, adjacencies, categories already represented",
  "targetCriteria": "What the preferred operator should demonstrate",
  "priorityCategories": "Priority categories text (keep the category names and example operators together)",
  "agentInstruction": "Instruction to the agent (emphasis, constraints)",
  "successMeasures": "How success will be measured",
  "instructedDate": "YYYY-MM-DD or null",
  "deadline1Date": "YYYY-MM-DD or null",
  "deadline1Deliverables": "What is due at the first deadline",
  "deadline2Date": "YYYY-MM-DD or null",
  "deadline2Deliverables": "What is due at the second deadline",
  "minTargets": 5,
  "priorityTargets": 2,
  "targets": [
    { "operatorName": "Named example operator", "category": "The category it was listed under", "priority": "B", "rationale": null }
  ]
}

For "targets": list each operator NAMED in the document as an initial target with priority "B" and status left to default. Do not invent operators that are not in the document.
Return ONLY the JSON object, no markdown formatting.`;

export async function extractBriefFromText(documentText: string): Promise<any> {
  const { getAnthropicClient, safeParseJSON } = await import("./utils/anthropic-client");
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: BRIEF_EXTRACT_PROMPT,
    messages: [{ role: "user", content: documentText.slice(0, 30000) }],
  });
  const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  return safeParseJSON(content);
}
