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

  // The commercials the brief is agreed on (shared/unit-brief.ts).
  const briefShared = await import("@shared/unit-brief");
  {
    const { BRIEF_COMMERCIAL_FIELDS, normaliseCommercials } = briefShared;
    const c = normaliseCommercials((brief as any).commercials).value;
    const lines = BRIEF_COMMERCIAL_FIELDS
      .filter(f => c[f.key] !== null && c[f.key] !== "")
      .map(f => {
        const v = c[f.key] as string | number;
        const shown = f.kind === "money" ? `${fmtMoney(Number(v))}${/a year/.test(f.hint || "") ? " pa" : ""}`
          : f.kind === "percent" ? `${v}%`
          : f.kind === "number" ? `${v} ${f.hint || ""}`.trim()
          : String(v);
        return `${f.label}: ${shown}`;
      });
    if (lines.length) section("Commercials", lines.join("\n"));
  }

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

  // Who is involved, and where sign-off stands (server/unit-brief-workspace.ts).
  {
    const { briefApproval, briefApprovalLabel, briefRoleLabel } = briefShared;
    const { pool } = await import("./db");
    const people = (await pool.query(`SELECT * FROM unit_brief_people WHERE brief_id = $1 ORDER BY sort_order, created_at`, [brief.id]).catch(() => ({ rows: [] as any[] }))).rows;
    if (people.length) {
      const version = (brief as any).version || 1;
      const jointAgent = people.find((p: any) => p.role === "joint_agent");
      const basis = briefShared.agentFeeSplitText((brief as any).agencyBasis, (brief as any).jointAgentFeePct, jointAgent?.firm || jointAgent?.name || null);
      const approval = briefApproval(version, people.map((p: any) => ({ agreedAt: p.agreed_at, agreedVersion: p.agreed_version })));
      const who = people.map((p: any) => {
        const signed = p.agreed_at && p.agreed_version === version
          ? `agreed ${fmtDate(p.agreed_at)}${p.agreed_by_user_id && p.agreed_by_user_id !== p.user_id && p.agreed_by_name ? ` (recorded by ${p.agreed_by_name})` : ""}`
          : p.agreed_at ? "agreed an earlier version" : "not yet agreed";
        return `${p.name}${p.firm ? `, ${p.firm}` : ""} (${briefRoleLabel(p.role)}): ${signed}`;
      });
      section("People involved and sign-off", [basis, briefApprovalLabel(approval), ...who].filter(Boolean).join("\n"));
    }
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // The footer sits inside the bottom margin: with the margin left on,
    // pdfkit pushed it onto a new blank page.
    doc.page.margins.bottom = 0;
    doc.fontSize(7).fillColor(BGP_MUTED).font("Helvetica")
      .text(
        `Bruce Gillingham Pollard — Confidential${brief.instructedDate ? `  ·  Instructed ${fmtDate(brief.instructedDate)}` : ""}  ·  Page ${i - range.start + 1} of ${range.count}`,
        55, doc.page.height - 46, { width: pageWidth, align: "center", lineBreak: false }
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
  // One generated brief per unit: a new one replaces the last, so pressing
  // the button again does not pile up copies. It is an internal document
  // (category "other"): the public website feed never offers it.
  const { deleteFile } = await import("./file-storage");
  const { and } = await import("drizzle-orm");
  const previous = await db.select().from(unitMarketingFiles)
    .where(and(eq(unitMarketingFiles.unitId, unit.id), eq(unitMarketingFiles.fileType, "targeting_brief")));
  for (const old of previous) {
    const storedName = old.filePath.split("/").pop();
    if (storedName) await deleteFile(`marketing-files/${storedName}`).catch(() => undefined);
    await db.delete(unitMarketingFiles).where(eq(unitMarketingFiles.id, old.id));
  }
  const [file] = await db.insert(unitMarketingFiles).values({
    unitId: unit.id,
    fileName,
    filePath: `/uploads/marketing-files/${uniqueName}`,
    fileType: "targeting_brief",
    category: "other",
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
  "unitName": "The unit the brief is for, as the document names it, e.g. 'L29A' or '145A Queen Street'",
  "propertyName": "The scheme or building, e.g. 'Westgate Oxford'",
  "floor": "Floor or level, or null",
  "sqft": 2500,
  "agencyBasis": "sole or joint, only if the document says; otherwise null",
  "commercials": {
    "quotingRentPa": 95000,
    "ervPa": null,
    "nerFloorPa": null,
    "rentFreeMonthsMax": null,
    "capitalContributionMax": null,
    "capexEnvelope": null,
    "leaseTermYears": null,
    "breakOption": null,
    "rentReview": null,
    "turnoverRentPct": null,
    "serviceChargePa": null,
    "ratesPayablePa": null,
    "insurancePa": null,
    "permittedUse": null,
    "availableFrom": null,
    "otherTerms": null
  },
  "people": [
    { "name": "A person the document names", "role": "bgp_agent | joint_agent | client_leasing | senior_asset_manager | asset_manager", "firm": "Their firm", "email": null }
  ],
  "targets": [
    { "operatorName": "Named example operator", "category": "The category it was listed under", "priority": "B", "rationale": null }
  ]
}

For "commercials": money is pounds a year as a plain number (95000, not "£95k"), rent free is months, lease term is years. Take a figure only when the document states it; never estimate. "nerFloorPa" is a minimum net effective rent, "rentFreeMonthsMax" and "capitalContributionMax" are the most the landlord will give, "capexEnvelope" is the landlord's own works budget. Put any commercial term that fits no field in "otherTerms".
For "people": only people the document names, with the role that fits (leasing manager or leasing director = client_leasing; asset manager = asset_manager; senior asset manager, head of asset management or portfolio director = senior_asset_manager; a second agency firm = joint_agent). Leave it empty if none are named.
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

const BRIEF_DRAFT_PROMPT = `You are a senior retail-leasing agent at Bruce Gillingham Pollard drafting an Operator Targeting Brief for a specific unit on behalf of a landlord client (e.g. Landsec). You are given the unit, its property, the client, the categories already represented in the scheme, and the firm's category taxonomy. Draft a considered, specific brief — not generic filler. Ground every choice in the unit's size, position and the gaps in the scheme's current mix.

Return ONLY a valid JSON object in this shape (use null where you genuinely cannot judge):
{
  "title": "Operator Targeting Brief — <unit> at <property>",
  "objective": "1-2 sentences: what a good letting here achieves for the client (mix, footfall, rent tone).",
  "locationContext": "The unit's position and the categories already represented nearby — call out what's missing / over-represented.",
  "targetCriteria": "What a preferred operator must demonstrate for THIS unit (covenant, format fit, fit-out, trading style, extract needs).",
  "priorityCategories": ["Category from the taxonomy", "Second priority category", "..."],
  "agentInstruction": "Emphasis and constraints for the agent working this unit.",
  "successMeasures": "How the client will judge progress against this brief.",
  "minTargets": 5,
  "priorityTargets": 2,
  "targets": [
    { "operatorName": "A real, plausible operator that fits", "category": "Its taxonomy category", "priority": "A or B", "rationale": "One line: why it fits this unit / fills a gap" }
  ]
}

Rules:
- "priorityCategories" MUST be an array of category names drawn from the provided taxonomy (choose the 2-4 best-fit categories for this unit and the scheme's gaps).
- For "targets": suggest 5-8 named operators that realistically fit the unit and the priority categories. Prefer operators NOT already in the scheme. Mark the 2 strongest as priority "A", the rest "B". Give each a one-line rationale. These are suggestions for the agent to approve — be specific and credible, but do not fabricate operators that plainly don't exist.
- Keep prose tight and professional. Return ONLY the JSON object, no markdown.`;

export async function draftBriefFromContext(ctx: {
  unitName?: string | null;
  floor?: string | null;
  sqft?: number | null;
  askingRent?: number | null;
  propertyName?: string | null;
  address?: string | null;
  clientCompany?: string | null;
  currentTenants?: string[];
  taxonomy?: string[];
}): Promise<any> {
  const { getAnthropicClient, safeParseJSON } = await import("./utils/anthropic-client");
  const anthropic = getAnthropicClient();
  const userMsg = [
    `Unit: ${ctx.unitName || "—"}${ctx.floor ? ` (${ctx.floor})` : ""}${ctx.sqft ? `, ${ctx.sqft.toLocaleString()} sq ft` : ""}${ctx.askingRent ? `, quoting £${ctx.askingRent.toLocaleString()} pa` : ""}`,
    `Property: ${ctx.propertyName || "—"}${ctx.address ? `, ${ctx.address}` : ""}`,
    `Client / landlord: ${ctx.clientCompany || "—"}`,
    `Categories / operators already represented in the scheme: ${(ctx.currentTenants || []).length ? (ctx.currentTenants || []).join(", ") : "unknown"}`,
    `Category taxonomy to choose priorityCategories and target categories from:\n${(ctx.taxonomy || []).join(", ")}`,
  ].join("\n\n");
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: BRIEF_DRAFT_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON(content);
  // priorityCategories may come back as an array — normalise to the text
  // column shape the brief stores, but keep the array for the client picker.
  if (Array.isArray(parsed?.priorityCategories)) {
    parsed.priorityCategoriesList = parsed.priorityCategories;
    parsed.priorityCategories = parsed.priorityCategories.join(", ");
  }
  return parsed;
}


const BRIEF_COMMENT_PROMPT = `You are helping one named person write their own comment on a unit's Targeting Brief at Bruce Gillingham Pollard. The brief is shared by the BGP agents, any joint agent, and the landlord client's leasing team and asset managers; each of them comments on it before everyone agrees it. You are given the brief, its commercials, the target operators, earlier comments, what this person is on the brief, and any rough notes they typed.

Write the comment this person would post, in the first person, from the point of view of their role:
- A BGP agent or joint agent: market view on the use and category, who to approach first and why, whether the quoting rent and incentives will land, what is needed to start (plans, photos, a date).
- The leasing team: whether the use, category and targets match the scheme's leasing strategy, and anything the agents should know.
- An asset manager or senior asset manager: whether the rent floor, incentives, capex and term work for the asset plan, any constraint (service charge, landlord works, timing, neighbouring tenants), and what they need before they can agree.
If the person typed notes, the comment must say what the notes say: tidy and complete them, keep every point, add nothing that contradicts them. Use only facts in the material given. Never invent a figure, a name, a date or an approval. Where the brief is missing something this person would need, say so plainly as a question.

Plain British English, short sentences, no headings, no bullet symbols unless the notes are a list, no sign-off, under 160 words. Return ONLY the comment text.`;

// AI help with one person's comment on a brief. The person edits the draft
// and saves it themselves; nothing here is stored.
export async function draftBriefComment(ctx: {
  roleLabel: string; personName: string | null; notes: string;
  unit: { unit_name?: string | null; floor?: string | null; sqft?: number | null; property_name?: string | null };
  brief: Record<string, any>;
  targets: { operator_name: string; category: string | null; priority: string | null }[];
  earlierComments: { user_name: string | null; role_label: string | null; body: string }[];
}): Promise<string> {
  const { getAnthropicClient } = await import("./utils/anthropic-client");
  const { BRIEF_COMMERCIAL_FIELDS } = await import("@shared/unit-brief");
  const anthropic = getAnthropicClient();
  const b = ctx.brief;
  const commercials = BRIEF_COMMERCIAL_FIELDS
    .filter(f => b.commercials?.[f.key] !== null && b.commercials?.[f.key] !== undefined && b.commercials?.[f.key] !== "")
    .map(f => `${f.label}: ${b.commercials[f.key]}${f.hint && f.kind !== "text" && f.kind !== "longtext" ? ` (${f.hint})` : ""}`);
  const line = (label: string, v: any) => (v ? `${label}: ${v}` : null);
  const userMsg = [
    `Person commenting: ${ctx.personName || "—"}, ${ctx.roleLabel}`,
    `Unit: ${ctx.unit.unit_name || "—"}${ctx.unit.floor ? ` (${ctx.unit.floor})` : ""}${ctx.unit.sqft ? `, ${Number(ctx.unit.sqft).toLocaleString("en-GB")} sq ft` : ""} at ${ctx.unit.property_name || "—"}`,
    [line("Client", b.clientCompany), line("Agency basis", b.agencyBasis), line("Objective", b.objective), line("Location and adjacencies", b.locationContext),
     line("Target operator criteria", b.targetCriteria), line("Priority categories", b.priorityCategories), line("Agent instruction", b.agentInstruction),
     line("Success measures", b.successMeasures)].filter(Boolean).join("\n") || "The brief's text fields are empty.",
    commercials.length ? `Commercials:\n${commercials.join("\n")}` : "Commercials: none entered yet.",
    ctx.targets.length ? `Target operators: ${ctx.targets.map(t => `${t.operator_name}${t.priority ? ` (${t.priority})` : ""}`).join(", ")}` : "Target operators: none yet.",
    ctx.earlierComments.length ? `Earlier comments:\n${ctx.earlierComments.map(c => `- ${c.user_name || "Someone"} (${c.role_label || "—"}): ${c.body.slice(0, 500)}`).join("\n")}` : "Earlier comments: none.",
    ctx.notes ? `This person's rough notes:\n${ctx.notes.slice(0, 4000)}` : "This person typed no notes. Draft a first comment from their role.",
  ].join("\n\n");
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system: BRIEF_COMMENT_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  if (!text) throw new Error("AI returned nothing");
  return text;
}
