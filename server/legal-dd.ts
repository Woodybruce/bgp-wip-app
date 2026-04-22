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
  sourceArchive?: string; // original ZIP filename if extracted from one
  cleanup?: () => void;   // call to delete temp file after analysis
}

async function expandUploads(files: Express.Multer.File[]): Promise<EffectiveFile[]> {
  const out: EffectiveFile[] = [];
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext !== ".zip") {
      out.push({
        originalName: f.originalname,
        displayName: f.originalname,
        path: f.path,
        size: f.size,
        cleanup: () => { try { fs.unlinkSync(f.path); } catch {} },
      });
      continue;
    }

    // ZIP — extract to a unique temp dir keyed to this upload.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-zip-"));
    try {
      const zip = new AdmZip(f.path);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryName = entry.entryName;
        const entryExt = path.extname(entryName).toLowerCase();
        if (!TEXT_EXTRACTABLE.has(entryExt)) continue;

        // Write to disk flat — safeName avoids collisions across folders.
        const safeName = entryName.replace(/[/\\]/g, "__");
        const outPath = path.join(tmpDir, safeName);
        fs.writeFileSync(outPath, entry.getData());
        out.push({
          originalName: entryName,
          displayName: path.basename(entryName),
          path: outPath,
          size: entry.header.size,
          sourceArchive: f.originalname,
          cleanup: () => { try { fs.unlinkSync(outPath); } catch {} },
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

  // Data-room ingest: accepts individual files and/or ZIPs, expands ZIPs,
  // classifies each file, runs the overall DD analysis, persists results.
  app.post("/api/legal-dd/deal-dd", requireAuth, upload.array("files", 30), async (req: Request, res: Response) => {
    const rawFiles = (req.files as Express.Multer.File[]) || [];
    const { dealName, team, crmDealId } = req.body;
    const userId = (req as any).session?.userId || (req as any).tokenUserId || null;

    if (rawFiles.length === 0) return res.status(400).json({ message: "No files uploaded" });
    if (!dealName) return res.status(400).json({ message: "Deal name is required" });

    let effective: EffectiveFile[] = [];
    try {
      effective = await expandUploads(rawFiles);
      if (effective.length === 0) {
        return res.status(400).json({ message: "No extractable files (PDF/DOCX/XLSX/TXT) found in upload" });
      }

      const anthropic = getAnthropicClient();

      // 1. Extract text + classify every file individually. Classification is
      //    a cheap one-shot pass that tags the file so specialist analysers
      //    (Phase 2 — lease, rent-roll, model, premises-licence) can route
      //    on it later.
      const classified: Array<EffectiveFile & { text: string; classification: FileClassification }> = [];
      for (const f of effective) {
        let text = "";
        try { text = await extractTextFromFile(f.path, f.originalName); }
        catch { text = "[Could not extract text from this file]"; }
        const classification = await classifyFile(anthropic, f.originalName, text);
        classified.push({ ...f, text, classification });
      }

      // 2. Overall DD analysis — feeds Claude the classified inventory so it
      //    produces a deal-level summary with reds/ambers/greens.
      const fileListPrompt = classified.map((f, i) =>
        `--- FILE ${i + 1}: ${f.originalName} [${f.classification.primaryType}] ---\n${f.text.slice(0, 12000)}\n`
      ).join("\n");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: DD_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Deal: "${dealName}"\nTeam: ${team || "Investment"}\n\nData room documents:\n\n${fileListPrompt}`
        }],
      });

      const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const analysis = JSON.parse(cleaned) as DDAnalysis;

      // 3. Persist — so a refresh doesn't throw away the result.
      let analysisId: string | null = null;
      if (userId) {
        try {
          const insert = await pool.query(
            `INSERT INTO data_room_analyses (user_id, deal_name, team, crm_deal_id, file_count, red_flags, amber_flags, green_flags, overall_risk, overall_summary, analysis)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [userId, dealName, team || "Investment", crmDealId || null, classified.length,
             analysis.redFlags || 0, analysis.amberFlags || 0, analysis.greenFlags || 0,
             analysis.overallRisk || "medium", analysis.overallSummary || "", JSON.stringify(analysis)]
          );
          analysisId = insert.rows[0].id;

          for (const f of classified) {
            await pool.query(
              `INSERT INTO data_room_files (analysis_id, user_id, archive_name, file_name, display_name, file_size, primary_type, sub_type, extracted_text, classification)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [analysisId, userId, f.sourceArchive || null, f.originalName, f.displayName, f.size,
               f.classification.primaryType, f.classification.subType,
               f.text.slice(0, 200000), JSON.stringify(f.classification)]
            );
          }
        } catch (persistErr: any) {
          console.error("[legal-dd] persist failed:", persistErr?.message);
        }
      }

      res.json({
        analysisId,
        analysis,
        files: classified.map(f => ({
          originalName: f.originalName,
          displayName: f.displayName,
          size: f.size,
          sourceArchive: f.sourceArchive,
          classification: f.classification,
        })),
      });
    } catch (err: any) {
      console.error("Deal DD error:", err);
      res.status(500).json({ message: err.message || "Failed to process due diligence" });
    } finally {
      effective.forEach(f => f.cleanup?.());
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
        `SELECT id, archive_name, file_name, display_name, file_size, primary_type, sub_type, classification, created_at
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
        `SELECT id, archive_name, file_name, display_name, file_size, primary_type, sub_type, classification, enrichment, created_at
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
