import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import mammoth from "mammoth";
import AdmZip from "adm-zip";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";

const UPLOADS_DIR = path.join(process.cwd(), "ChatBGP", "legal-dd");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// 500MB per file — a 300-pub data room routinely breaks 250MB. We still cap
// it so a runaway upload can't exhaust disk, but the old 30MB limit was
// rejecting every real data room.
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Supported extensions the text extractor can actually read. Anything else
// inside a ZIP is ignored (photos, movies, etc.) rather than being fed to
// Claude as garbage.
const TEXT_EXTRACTABLE = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".csv"]);

// Expand any ZIP uploads into their contained files. Returns a flat list of
// "effective" uploads — files on disk with their original archive-relative
// name preserved so the Claude classifier can see folder structure (e.g.
// "Legal/Leases/HSBC Lease.pdf" → classifier has useful context).
interface EffectiveFile {
  originalName: string;   // path-including name from archive, or plain name
  displayName: string;    // just the filename for UI
  path: string;           // disk path to read from
  size: number;
  mimeType?: string;
  sourceArchive?: string; // original ZIP filename if extracted from one
}

// Per-analysis persistent file folder. Files live here until an admin
// cron clears them out (future work) — this is how the UI can later
// serve the original PDF back to the user.
const ANALYSES_DIR = path.join(process.cwd(), "ChatBGP", "legal-dd", "analyses");
if (!fs.existsSync(ANALYSES_DIR)) fs.mkdirSync(ANALYSES_DIR, { recursive: true });

function analysisDir(analysisId: string): string {
  const dir = path.join(ANALYSES_DIR, analysisId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function mimeFromExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".doc") return "application/msword";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".txt") return "text/plain";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

async function expandUploads(files: Express.Multer.File[], analysisId: string): Promise<EffectiveFile[]> {
  const out: EffectiveFile[] = [];
  const dir = analysisDir(analysisId);
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext !== ".zip") {
      // Copy the multer temp file into the persistent folder.
      const safeName = f.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = path.join(dir, `${Date.now()}_${safeName}`);
      fs.copyFileSync(f.path, dest);
      try { fs.unlinkSync(f.path); } catch {}
      out.push({
        originalName: f.originalname,
        displayName: f.originalname,
        path: dest,
        size: f.size,
        mimeType: mimeFromExt(f.originalname),
      });
      continue;
    }

    // ZIP — extract every text-bearing entry to the persistent folder.
    try {
      const zip = new AdmZip(f.path);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName;
        const entryExt = path.extname(entryName).toLowerCase();
        if (!TEXT_EXTRACTABLE.has(entryExt)) continue;

        const safeName = entryName.replace(/[/\\]/g, "__").replace(/[^a-zA-Z0-9._-]/g, "_");
        const outPath = path.join(dir, `${Date.now()}_${safeName}`);
        fs.writeFileSync(outPath, entry.getData());
        out.push({
          originalName: entryName,
          displayName: path.basename(entryName),
          path: outPath,
          size: entry.header.size,
          mimeType: mimeFromExt(entryName),
          sourceArchive: f.originalname,
        });
      }
    } catch (err: any) {
      console.error(`[legal-dd] Failed to expand ZIP ${f.originalname}:`, err?.message);
    } finally {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }
  return out;
}

async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === ".pdf") {
    const pdfModule = await import("pdf-parse");
    const PDFParseClass = (pdfModule as any).PDFParse || (pdfModule as any).default;
    const buffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParseClass(uint8);
    const data = await parser.getText();
    return typeof data === "string" ? data : (data as any).text || String(data);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const XLSX = (await import("xlsx")).default;
    const wb = XLSX.readFile(filePath);
    const lines: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      lines.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
    return lines.join("\n\n");
  }

  if (ext === ".txt" || ext === ".doc") {
    return fs.readFileSync(filePath, "utf-8");
  }

  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return `[Binary file: ${originalName}]`;
  }
}

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
      ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
      : {}),
  });
}

interface FlaggedIssue {
  severity: "red" | "amber" | "green";
  category: string;
  title: string;
  detail: string;
  clause?: string;
  recommendation: string;
}

interface LegalAnalysis {
  documentType: string;
  parties: string[];
  summary: string;
  keyTerms: { label: string; value: string }[];
  issues: FlaggedIssue[];
  overallRisk: "high" | "medium" | "low";
  nextSteps: string[];
}

interface DDFileAnalysis {
  fileName: string;
  category: string;
  summary: string;
  issues: FlaggedIssue[];
  suggestedFolder: string;
}

interface DDAnalysis {
  dealName: string;
  overallSummary: string;
  overallRisk: "high" | "medium" | "low";
  fileAnalyses: DDFileAnalysis[];
  redFlags: number;
  amberFlags: number;
  greenFlags: number;
  folderMapping: { fileName: string; targetFolder: string }[];
  keyRisks: string[];
  recommendations: string[];
}

// Per-file classification. Runs Claude on just the filename + first chunk of
// text, producing a cheap tag that downstream specialist analysers use to
// decide whether to run rent-roll extraction, model auditing, lease term
// extraction, premises-licence parsing, etc.
interface FileClassification {
  primaryType:
    | "Lease" | "Licence" | "HoT" | "Title Register" | "Title Plan"
    | "Conditional Contract" | "Option" | "Surrender" | "Side Letter"
    | "Rent Roll" | "Financial Model" | "Management Accounts" | "Service Charge Budget" | "CapEx Schedule" | "Valuation"
    | "IM" | "Marketing Particulars" | "Photos" | "Floorplans"
    | "Premises Licence" | "Tied Lease" | "MRO Notice" | "Trade Accounts" | "BDM Report"
    | "Other";
  subType: string;
  confidence: "high" | "medium" | "low";
  propertyAddress?: string;
  tenantName?: string;
  landlordName?: string;
  notes?: string;
}

const CLASSIFY_SYSTEM_PROMPT = `You are a document classifier for UK commercial property and pub deal data rooms. Given a filename and the first few thousand characters of a document, return a JSON object with this exact shape:
{
  "primaryType": "Lease|Licence|HoT|Title Register|Title Plan|Conditional Contract|Option|Surrender|Side Letter|Rent Roll|Financial Model|Management Accounts|Service Charge Budget|CapEx Schedule|Valuation|IM|Marketing Particulars|Photos|Floorplans|Premises Licence|Tied Lease|MRO Notice|Trade Accounts|BDM Report|Other",
  "subType": "short descriptive label, e.g. 'Ground floor retail lease' or 'Pub P&L FY24'",
  "confidence": "high|medium|low",
  "propertyAddress": "extracted property address if present (optional)",
  "tenantName": "tenant or operator name if identifiable (optional)",
  "landlordName": "landlord or freeholder name if identifiable (optional)",
  "notes": "one-line useful observation (optional)"
}
Context: this is a deal-data-room pipeline. Pubs can be let (investment), managed (operating), tied-tenancy or free-of-tie. Rent rolls and financial models typically arrive as .xlsx. Title registers are distinctive HMLR documents. Return ONLY valid JSON.`;

async function classifyFile(anthropic: Anthropic, fileName: string, text: string): Promise<FileClassification> {
  const snippet = (text || "").slice(0, 4000);
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Filename: ${fileName}\n\nFirst 4000 chars:\n${snippet}` }],
    });
    const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned) as FileClassification;
  } catch (err: any) {
    console.warn(`[legal-dd] classification failed for ${fileName}:`, err?.message);
    return { primaryType: "Other", subType: path.extname(fileName).replace(".", "") || "unknown", confidence: "low" };
  }
}

// Background runner: extracts text, classifies every file in parallel
// batches, runs the overall DD analysis, persists everything. The HTTP
// handler returns 202 the moment this is kicked off — this function
// updates data_room_analyses.progress_classified as it goes so the
// client polling /analyses/:id sees a live progress counter.
async function runDealDdInBackground(
  analysisId: string,
  userId: string,
  dealName: string,
  team: string,
  effective: EffectiveFile[],
): Promise<void> {
  const anthropic = getAnthropicClient();
  const classified: Array<EffectiveFile & { text: string; classification: FileClassification }> = new Array(effective.length);

  // Batched parallel classification — much faster than sequential. Each
  // worker picks the next file index from the queue until done. Concurrency
  // 6 keeps us well under the Anthropic-per-account rate limit even on big
  // data rooms.
  let cursor = 0;
  let processed = 0;
  const concurrency = 6;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= effective.length) return;
      const f = effective[idx];
      let text = "";
      try { text = await extractTextFromFile(f.path, f.originalName); }
      catch { text = "[Could not extract text from this file]"; }
      const classification = await classifyFile(anthropic, f.originalName, text);
      classified[idx] = { ...f, text, classification };
      processed++;
      // Update progress counter every few files to avoid thrashing the DB.
      if (processed % 5 === 0 || processed === effective.length) {
        try {
          await pool.query(
            `UPDATE data_room_analyses SET progress_classified=$1 WHERE id=$2`,
            [processed, analysisId]
          );
        } catch {}
      }
    }
  }));

  // Persist file rows as soon as classification is done — enrichment (Push 2)
  // can then run on them even before the overall DD summary completes.
  for (const f of classified) {
    if (!f) continue;
    try {
      await pool.query(
        `INSERT INTO data_room_files (analysis_id, user_id, archive_name, file_name, display_name, file_size, primary_type, sub_type, extracted_text, classification, local_path, mime_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [analysisId, userId, f.sourceArchive || null, f.originalName, f.displayName, f.size,
         f.classification.primaryType, f.classification.subType,
         f.text.slice(0, 200000), JSON.stringify(f.classification), f.path, f.mimeType || null]
      );
    } catch (persistErr: any) {
      console.warn(`[legal-dd] file persist failed for ${f.displayName}:`, persistErr?.message);
    }
  }

  // Overall DD analysis — Claude Sonnet on the full classified inventory.
  // For very large data rooms we cap the text per file to keep total prompt
  // under ~150k tokens; Claude's context handles it comfortably.
  const fileListPrompt = classified.filter(Boolean).map((f, i) =>
    `--- FILE ${i + 1}: ${f.originalName} [${f.classification.primaryType}] ---\n${f.text.slice(0, classified.length > 50 ? 4000 : 12000)}\n`
  ).join("\n");

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: DD_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Deal: "${dealName}"\nTeam: ${team}\n\nData room documents:\n\n${fileListPrompt}`
      }],
    });
    const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const parsed = firstBrace >= 0 && lastBrace > firstBrace ? JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) : {};
    const analysis = parsed as DDAnalysis;

    await pool.query(
      `UPDATE data_room_analyses SET status='done', completed_at=now(),
        red_flags=$1, amber_flags=$2, green_flags=$3, overall_risk=$4, overall_summary=$5, analysis=$6
       WHERE id=$7`,
      [analysis.redFlags || 0, analysis.amberFlags || 0, analysis.greenFlags || 0,
       analysis.overallRisk || "medium", analysis.overallSummary || "", JSON.stringify(analysis), analysisId]
    );
  } catch (err: any) {
    console.error(`[legal-dd] background DD Claude call failed for ${analysisId}:`, err?.message);
    // Classification + file rows are still saved; mark the summary stage as
    // errored but keep status='done' so the user can see classified files.
    await pool.query(
      `UPDATE data_room_analyses SET status='done', completed_at=now(), error_message=$1, overall_summary=$2
       WHERE id=$3`,
      [`DD summary failed: ${err?.message || "unknown"}`, "Classification complete, but DD summary generation failed. Files are still available for enrichment.", analysisId]
    );
  }
}

const LEGAL_SYSTEM_PROMPT = `You are a senior UK commercial property lawyer and legal analyst for Bruce Gillingham Pollard (BGP), a commercial property consultancy in London specialising in Belgravia, Mayfair, and Chelsea.

Analyse the provided legal document and return a JSON object with this exact structure:
{
  "documentType": "e.g. Commercial Lease, Asset Management Agreement, Licence to Assign, etc.",
  "parties": ["Party 1 Name", "Party 2 Name"],
  "summary": "2-3 paragraph executive summary of the document",
  "keyTerms": [
    { "label": "Term/Lease Length", "value": "10 years from 01/01/2025" },
    { "label": "Rent", "value": "£150,000 per annum" }
  ],
  "issues": [
    {
      "severity": "red|amber|green",
      "category": "Termination|Liability|Financial|Compliance|Risk|Obligation|Covenant|Break Clause|Rent Review|Dilapidations|Assignment|Subletting|Insurance|Service Charge",
      "title": "Short issue title",
      "detail": "Detailed explanation of the issue",
      "clause": "Reference to specific clause number if applicable",
      "recommendation": "What BGP should do about this"
    }
  ],
  "overallRisk": "high|medium|low",
  "nextSteps": ["Recommended next step 1", "Step 2"]
}

Traffic light severity guide:
- RED: Critical issues requiring immediate attention — unfavourable terms, significant financial exposure, termination risks, onerous obligations, missing protections
- AMBER: Moderate concerns requiring review — unusual but not critical terms, areas needing clarification, potential negotiation points
- GREEN: Positive provisions or standard terms — protective clauses, market-standard provisions, favourable terms

Be thorough and practical. Focus on commercial property relevance. Return ONLY valid JSON.`;

const DD_SYSTEM_PROMPT = `You are a senior UK commercial property due diligence analyst for Bruce Gillingham Pollard (BGP). You are reviewing a data room for a property deal.

Analyse ALL the uploaded documents as a complete data room package and return a JSON object:
{
  "dealName": "the deal name provided",
  "overallSummary": "Executive summary of the deal based on all documents reviewed",
  "overallRisk": "high|medium|low",
  "fileAnalyses": [
    {
      "fileName": "exact filename",
      "category": "Legal|Financial|Title|Planning|Environmental|Survey|Lease|Insurance|Compliance|Corporate|Marketing|Other",
      "summary": "Brief summary of this specific document",
      "issues": [
        {
          "severity": "red|amber|green",
          "category": "category",
          "title": "Issue title",
          "detail": "Details",
          "clause": "clause reference if applicable",
          "recommendation": "What to do"
        }
      ],
      "suggestedFolder": "e.g. Legal/Title Deeds, Financial/Accounts, Legal/Leases etc."
    }
  ],
  "redFlags": 0,
  "amberFlags": 0,
  "greenFlags": 0,
  "folderMapping": [
    { "fileName": "exact filename", "targetFolder": "Legal/Title Deeds" }
  ],
  "keyRisks": ["Top risk 1", "Top risk 2"],
  "recommendations": ["Action 1", "Action 2"]
}

DD Folder structure categories to use for suggestedFolder:
- Legal/Title Deeds
- Legal/Leases
- Legal/Licences & Consents
- Legal/Contracts & Agreements
- Financial/Accounts
- Financial/Rent Roll
- Financial/Service Charge
- Financial/Valuations
- Planning/Permissions
- Planning/Building Regs
- Environmental/Reports
- Environmental/Contamination
- Survey/Building Survey
- Survey/M&E
- Insurance
- Corporate/Company Docs
- Marketing/Brochure
- Marketing/Photos
- Other

Traffic light severity:
- RED: Deal-breaking or high-risk issues
- AMBER: Needs further investigation or negotiation
- GREEN: Satisfactory / standard

Be thorough and commercial. Flag anything a buyer/tenant should be aware of. Return ONLY valid JSON.`;

export function registerLegalDDRoutes(app: Express) {
  app.post("/api/legal-dd/analyze", requireAuth, upload.array("files", 10), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    try {
      const anthropic = getAnthropicClient();
      const analyses: LegalAnalysis[] = [];

      for (const file of files) {
        const text = await extractTextFromFile(file.path, file.originalname);
        const truncated = text.slice(0, 30000);

        const response = await anthropic.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 8192,
          system: LEGAL_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Analyse this legal document: "${file.originalname}"\n\n${truncated}`
            }
          ],
        });

        const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const analysis = JSON.parse(cleaned) as LegalAnalysis;
        analyses.push(analysis);

        try { fs.unlinkSync(file.path); } catch {}
      }

      res.json({ analyses });
    } catch (err: any) {
      console.error("Legal analysis error:", err);
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      res.status(500).json({ message: err.message || "Failed to analyse documents" });
    }
  });

  // Data-room ingest: accepts individual files and/or ZIPs. Expansion +
  // classification + DD analysis can take 5-10+ minutes for a 300-file
  // data room — too long to hold an HTTP connection. We create the
  // analysis record immediately, return 202 with the analysisId, then
  // do all the work in the background. Client polls for progress.
  app.post("/api/legal-dd/deal-dd", requireAuth, upload.array("files", 30), async (req: Request, res: Response) => {
    const rawFiles = (req.files as Express.Multer.File[]) || [];
    const { dealName, team, crmDealId } = req.body;
    const userId = (req as any).session?.userId || (req as any).tokenUserId || null;

    if (rawFiles.length === 0) return res.status(400).json({ message: "No files uploaded" });
    if (!dealName) return res.status(400).json({ message: "Deal name is required" });
    if (!userId) return res.status(401).json({ message: "Not signed in" });

    try {
      // 1. Create the pending analysis record FIRST so we have an id to
      //    key the persistent file folder against.
      const insert = await pool.query(
        `INSERT INTO data_room_analyses (user_id, deal_name, team, crm_deal_id, file_count, status, progress_classified, progress_total, overall_summary)
         VALUES ($1,$2,$3,$4,0,'processing',0,0,$5) RETURNING id`,
        [userId, dealName, team || "Investment", crmDealId || null, "Analysing data room..."]
      );
      const analysisId = insert.rows[0].id as string;

      const effective = await expandUploads(rawFiles, analysisId);
      if (effective.length === 0) {
        await pool.query(`UPDATE data_room_analyses SET status='error', error_message='No extractable files in upload', completed_at=now() WHERE id=$1`, [analysisId]);
        return res.status(400).json({ message: "No extractable files (PDF/DOCX/XLSX/TXT) found in upload" });
      }

      await pool.query(
        `UPDATE data_room_analyses SET file_count=$1, progress_total=$2 WHERE id=$3`,
        [effective.length, effective.length, analysisId]
      );

      // 2. Return 202 so the client can start polling immediately.
      res.status(202).json({
        analysisId,
        status: "processing",
        total: effective.length,
        message: "Analysis running in background — poll /api/legal-dd/analyses/:id for progress",
      });

      // 3. Kick off the actual work in the background. Any errors update
      //    the analysis row to status=error so the client sees them.
      setImmediate(() => runDealDdInBackground(analysisId, userId, dealName, team || "Investment", effective)
        .catch(async (err: any) => {
          console.error(`[legal-dd] background job ${analysisId} failed:`, err?.message);
          try {
            await pool.query(
              `UPDATE data_room_analyses SET status='error', error_message=$1, completed_at=now() WHERE id=$2`,
              [err?.message || "unknown error", analysisId]
            );
          } catch {}
        }));
    } catch (err: any) {
      console.error("Deal DD error:", err);
      res.status(500).json({ message: err.message || "Failed to process due diligence" });
    }
  });

  // List past data-room analyses for this user (for the UI history/deal panel).
  app.get("/api/legal-dd/analyses", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.json({ analyses: [] });
    try {
      const r = await pool.query(
        `SELECT id, deal_name, team, crm_deal_id, file_count, red_flags, amber_flags, green_flags, overall_risk, overall_summary, created_at
         FROM data_room_analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [userId]
      );
      res.json({ analyses: r.rows });
    } catch (err: any) {
      console.error("[legal-dd] list analyses error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to list analyses" });
    }
  });

  // Full payload for a single analysis — reconstructed so a page refresh
  // restores the exact DD view the user last saw.
  app.get("/api/legal-dd/analyses/:id", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const analysisRow = await pool.query(
        `SELECT * FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (analysisRow.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      const filesRow = await pool.query(
        `SELECT id, archive_name, file_name, display_name, file_size, primary_type, sub_type, classification, mime_type, created_at
         FROM data_room_files WHERE analysis_id = $1 ORDER BY created_at ASC`,
        [req.params.id]
      );
      res.json({ analysis: analysisRow.rows[0], files: filesRow.rows });
    } catch (err: any) {
      console.error("[legal-dd] get analysis error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to fetch analysis" });
    }
  });

  // Trigger Push 2 enrichment on a persisted analysis. Runs in the
  // background (so a 300-file data room doesn't block the HTTP response)
  // with concurrency 4 — see data-room-enrich.ts. Client polls GET
  // /api/legal-dd/analyses/:id/files to see per-file progress.
  app.post("/api/legal-dd/enrich/:id", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const owns = await pool.query(
        `SELECT id FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (owns.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });

      const { enrichAnalysis } = await import("./data-room-enrich");
      // Fire-and-forget. Result is written to data_room_files.enrichment.
      setImmediate(() => {
        enrichAnalysis(req.params.id, { concurrency: 4 })
          .then((r) => console.log(`[legal-dd] enrichment complete for ${req.params.id}:`, r))
          .catch((err) => console.error(`[legal-dd] enrichment failed for ${req.params.id}:`, err?.message));
      });
      res.status(202).json({ started: true, analysisId: req.params.id });
    } catch (err: any) {
      console.error("[legal-dd] enrich start error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to start enrichment" });
    }
  });

  // Files for an analysis with their current enrichment status (the
  // polling target for the client while Push 2 runs). Returns the
  // JSONB enrichment blob per file, so the UI can render specialist
  // output + CH/VOA/Land-Registry/FSA matches as they complete.
  app.get("/api/legal-dd/analyses/:id/files", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const owns = await pool.query(
        `SELECT id FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (owns.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      const files = await pool.query(
        `SELECT id, archive_name, file_name, display_name, file_size, primary_type, sub_type, classification, enrichment, mime_type, local_path, created_at
         FROM data_room_files WHERE analysis_id = $1 ORDER BY created_at ASC`,
        [req.params.id]
      );
      const done = files.rows.filter(r => r.enrichment?.status === "done").length;
      const running = files.rows.filter(r => r.enrichment?.status === "running").length;
      const errors = files.rows.filter(r => r.enrichment?.status === "error").length;
      res.json({ files: files.rows, progress: { total: files.rows.length, done, running, errors } });
    } catch (err: any) {
      console.error("[legal-dd] files progress error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to load files" });
    }
  });

  // Stream the original file bytes back to the browser so the user can
  // open the raw PDF/DOCX/XLSX. Auth checked against analysis owner so
  // another user can't pull someone else's data room. inline disposition
  // means PDFs render in the browser tab; docx/xlsx prompt a download.
  app.get("/api/legal-dd/files/:id/raw", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).send("Not signed in");
    try {
      const r = await pool.query(
        `SELECT f.local_path, f.mime_type, f.display_name, f.user_id
         FROM data_room_files f
         WHERE f.id = $1`,
        [req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).send("File not found");
      const row = r.rows[0];
      if (row.user_id !== userId) return res.status(403).send("Forbidden");
      if (!row.local_path || !fs.existsSync(row.local_path)) {
        return res.status(410).send("File no longer available on disk — re-upload the data room to restore it.");
      }
      const safeName = (row.display_name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      fs.createReadStream(row.local_path).pipe(res);
    } catch (err: any) {
      console.error("[legal-dd] file stream error:", err?.message);
      res.status(500).send(err?.message || "Failed to stream file");
    }
  });

  // Retry just the final Claude Sonnet DD-summary call on an existing
  // analysis — useful when classification + enrichment succeeded but the
  // summary stage errored (rate limit, timeout, etc). Reuses the
  // extracted_text + classification already persisted on data_room_files,
  // so there's no second classification pass.
  app.post("/api/legal-dd/analyses/:id/retry-summary", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const own = await pool.query(
        `SELECT id, deal_name, team FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (own.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      const files = await pool.query(
        `SELECT file_name, display_name, primary_type, extracted_text FROM data_room_files WHERE analysis_id = $1 ORDER BY created_at ASC`,
        [req.params.id]
      );
      if (files.rows.length === 0) return res.status(400).json({ message: "No files to summarise" });

      const anthropic = getAnthropicClient();
      const perFile = files.rows.length > 50 ? 3500 : (files.rows.length > 20 ? 6000 : 12000);
      const fileListPrompt = files.rows.map((f: any, i: number) =>
        `--- FILE ${i + 1}: ${f.file_name} [${f.primary_type}] ---\n${(f.extracted_text || "").slice(0, perFile)}\n`
      ).join("\n");

      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: DD_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Deal: "${own.rows[0].deal_name}"\nTeam: ${own.rows[0].team || "Investment"}\n\nData room documents:\n\n${fileListPrompt}`
        }],
      });
      const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      const parsed = firstBrace >= 0 && lastBrace > firstBrace ? JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) : {};
      const analysis = parsed as DDAnalysis;

      await pool.query(
        `UPDATE data_room_analyses SET
           red_flags=$1, amber_flags=$2, green_flags=$3, overall_risk=$4,
           overall_summary=$5, analysis=$6, error_message=NULL
         WHERE id=$7`,
        [analysis.redFlags || 0, analysis.amberFlags || 0, analysis.greenFlags || 0,
         analysis.overallRisk || "medium", analysis.overallSummary || "", JSON.stringify(analysis), req.params.id]
      );
      res.json({ analysis });
    } catch (err: any) {
      console.error("[legal-dd] retry-summary failed:", err?.message);
      res.status(500).json({ message: err?.message || "Retry failed" });
    }
  });

  // Reconciliation + portfolio roll-up (Push 3). Computes cross-file
  // checks (rent roll ↔ model ↔ leases, landlord-vs-title-proprietor,
  // dissolved-tenant counts, rent-to-rates ratios) and the portfolio-
  // level summary stats. Runs on demand against persisted Push 2
  // enrichments, no re-analysis required.
  app.get("/api/legal-dd/analyses/:id/reconciliation", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const owns = await pool.query(
        `SELECT id FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (owns.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      const { buildReconciliationReport } = await import("./data-room-reconcile");
      const report = await buildReconciliationReport(req.params.id);
      res.json(report);
    } catch (err: any) {
      console.error("[legal-dd] reconciliation error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to build reconciliation" });
    }
  });

  // Dispatch: push extracted lease events (break, expiry, rent review) into
  // the Lease Events board so they appear on the same timeline as
  // everything else the business tracks.
  app.post("/api/legal-dd/analyses/:id/dispatch/lease-events", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    const userName = req.session?.userName || "Data Room";
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const owns = await pool.query(
        `SELECT deal_name, crm_deal_id FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (owns.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      const dealName = owns.rows[0].deal_name;
      const crmDealId = owns.rows[0].crm_deal_id;

      const files = await pool.query(
        `SELECT id, display_name, primary_type, classification, enrichment FROM data_room_files WHERE analysis_id = $1`,
        [req.params.id]
      );
      const eventsToInsert: Array<[string, string, string, string, string, string, string | null, string | null]> = [];
      for (const f of files.rows) {
        const spec = f.enrichment?.specialist;
        if (!spec) continue;
        const address = spec.demise || spec.property || spec.premisesAddress || f.classification?.propertyAddress;
        const tenant = spec.tenant || f.classification?.tenantName || null;
        const passingRent = spec.passingRent != null ? String(spec.passingRent) : null;
        if (!address) continue;

        // One row per date we extracted from the lease.
        const push = (type: string, date: any) => {
          if (!date) return;
          const d = new Date(date);
          if (isNaN(d.getTime())) return;
          eventsToInsert.push([type, d.toISOString(), address, tenant || "", f.display_name, `Auto-extracted from data room: ${dealName}`, crmDealId, passingRent]);
        };
        if (Array.isArray(spec.breakDates)) spec.breakDates.forEach((d: any) => push("Break", d));
        push("Expiry", spec.termEnd);
        // rent review can be a frequency string ("5-yearly") or a date — only push if clearly a date.
        if (typeof spec.rentReview === "string" && /\d{4}-\d{2}-\d{2}/.test(spec.rentReview)) {
          push("Rent Review", spec.rentReview.match(/\d{4}-\d{2}-\d{2}/)?.[0]);
        }
      }

      let inserted = 0;
      for (const e of eventsToInsert) {
        try {
          await pool.query(
            `INSERT INTO lease_events (event_type, event_date, address, tenant, source_title, source_evidence, deal_id, current_rent, created_by, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Monitoring')`,
            [e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], userName]
          );
          inserted++;
        } catch (insertErr: any) {
          console.warn(`[legal-dd] lease event insert failed:`, insertErr?.message);
        }
      }
      res.json({ inserted, requested: eventsToInsert.length });
    } catch (err: any) {
      console.error("[legal-dd] dispatch lease-events error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to dispatch lease events" });
    }
  });

  // Dispatch: save extracted title numbers + proprietors into the Land
  // Registry board so the DD findings persist alongside regular LR searches.
  app.post("/api/legal-dd/analyses/:id/dispatch/land-registry", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    try {
      const owns = await pool.query(
        `SELECT deal_name FROM data_room_analyses WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      if (owns.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      const dealName = owns.rows[0].deal_name;

      const files = await pool.query(
        `SELECT display_name, primary_type, classification, enrichment FROM data_room_files WHERE analysis_id = $1`,
        [req.params.id]
      );

      let inserted = 0;
      const seen = new Set<string>();
      for (const f of files.rows) {
        const spec = f.enrichment?.specialist;
        const enr = f.enrichment?.enrichment;
        const titleNumber = enr?.landRegistry?.title_number || spec?.titleNumber;
        const address = spec?.demise || spec?.property || spec?.premisesAddress || f.classification?.propertyAddress;
        if (!address) continue;
        const dedupKey = `${address}|${titleNumber || ""}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const postcode = (address.match(/\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/i) || [])[0] || null;
        const freeholds = enr?.landRegistry?.tenure === "Freehold" ? [enr.landRegistry] : (spec?.tenure === "Freehold" ? [spec] : []);
        const leaseholds = enr?.landRegistry?.tenure === "Leasehold" ? [enr.landRegistry] : [];
        try {
          await pool.query(
            `INSERT INTO land_registry_searches (user_id, address, postcode, freeholds_count, leaseholds_count, freeholds, leaseholds, notes, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'From Data Room')`,
            [userId, address, postcode ? postcode.toUpperCase() : null, freeholds.length, leaseholds.length,
             JSON.stringify(freeholds), JSON.stringify(leaseholds),
             `Auto-saved from data room DD: ${dealName} → ${f.display_name}`]
          );
          inserted++;
        } catch (insertErr: any) {
          console.warn(`[legal-dd] land-registry insert failed:`, insertErr?.message);
        }
      }
      res.json({ inserted });
    } catch (err: any) {
      console.error("[legal-dd] dispatch land-registry error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to dispatch to Land Registry board" });
    }
  });

  // Dispatch: link this analysis to an existing CRM deal (sets crm_deal_id).
  app.post("/api/legal-dd/analyses/:id/dispatch/crm-deal", requireAuth, async (req: any, res: Response) => {
    const userId = req.session?.userId || req.tokenUserId;
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    const { crmDealId } = req.body || {};
    if (!crmDealId) return res.status(400).json({ message: "crmDealId required" });
    try {
      const r = await pool.query(
        `UPDATE data_room_analyses SET crm_deal_id = $1 WHERE id = $2 AND user_id = $3 RETURNING id`,
        [crmDealId, req.params.id, userId]
      );
      if (r.rows.length === 0) return res.status(404).json({ message: "Analysis not found" });
      res.json({ linked: true, crmDealId });
    } catch (err: any) {
      console.error("[legal-dd] dispatch crm-deal error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to link CRM deal" });
    }
  });

  app.post("/api/legal-dd/create-project", requireAuth, async (req: Request, res: Response) => {
    const { getValidMsToken } = await import("./microsoft");
    const token = await getValidMsToken(req);
    if (!token) {
      return res.status(401).json({ message: "Not connected to Microsoft 365" });
    }

    const { dealName, team, folderMapping } = req.body;
    if (!dealName || !folderMapping || !Array.isArray(folderMapping)) {
      return res.status(400).json({ message: "dealName and folderMapping are required" });
    }

    try {
      const spHost = "brucegillinghampollardlimited.sharepoint.com";
      const spSitePath = "/sites/BGP";
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${spHost}:${spSitePath}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!siteRes.ok) throw new Error("Failed to access SharePoint site");
      const siteData = await siteRes.json();

      const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteData.id}/drives`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const drivesData = await drivesRes.json();
      const drive = drivesData.value?.find((d: any) =>
        d.name === "Documents" || d.name === "Shared Documents"
      );
      if (!drive) throw new Error("Could not find Documents drive");
      const driveId = drive.id;

      const teamFolder = `BGP share drive/${team || "Investment"}`;
      const projectPath = `${teamFolder}/DD - ${dealName}`;

      async function createFolderByPath(parentPath: string, folderName: string) {
        let createUrl: string;
        if (!parentPath || parentPath === "/") {
          createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
        } else {
          const cleanPath = parentPath.replace(/^\/+|\/+$/g, "");
          createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}:/children`;
        }

        const response = await fetch(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: folderName,
            folder: {},
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        });

        return response.ok || response.status === 409;
      }

      await createFolderByPath(teamFolder, `DD - ${dealName}`);

      const uniqueFolders = new Set<string>();
      for (const mapping of folderMapping) {
        const parts = mapping.targetFolder.split("/");
        let current = projectPath;
        for (const part of parts) {
          const key = `${current}/${part}`;
          if (!uniqueFolders.has(key)) {
            uniqueFolders.add(key);
            await createFolderByPath(current, part);
          }
          current = key;
        }
      }

      res.json({
        success: true,
        projectPath,
        foldersCreated: uniqueFolders.size + 1,
        message: `Created DD project folder structure for "${dealName}" in SharePoint under ${teamFolder}/`,
      });
    } catch (err: any) {
      console.error("Create project error:", err);
      res.status(500).json({ message: err.message || "Failed to create project folders" });
    }
  });
}
