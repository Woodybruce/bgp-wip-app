import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import Anthropic from "@anthropic-ai/sdk";

const UPLOADS_DIR = path.join(process.cwd(), "ChatBGP", "legal-dd");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 30 * 1024 * 1024 },
});

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
          model: "claude-sonnet-4-6",
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

  app.post("/api/legal-dd/deal-dd", requireAuth, upload.array("files", 30), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    const { dealName, team } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }
    if (!dealName) {
      return res.status(400).json({ message: "Deal name is required" });
    }

    try {
      const anthropic = getAnthropicClient();
      const fileTexts: { name: string; text: string }[] = [];

      for (const file of files) {
        try {
          const text = await extractTextFromFile(file.path, file.originalname);
          fileTexts.push({ name: file.originalname, text: text.slice(0, 15000) });
        } catch {
          fileTexts.push({ name: file.originalname, text: "[Could not extract text from this file]" });
        }
      }

      const fileListPrompt = fileTexts.map((f, i) => `--- FILE ${i + 1}: ${f.name} ---\n${f.text}\n`).join("\n");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: DD_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Deal: "${dealName}"\nTeam: ${team || "Investment"}\n\nData room documents:\n\n${fileListPrompt}`
          }
        ],
      });

      const content = response.content[0]?.type === "text" ? response.content[0].text : "{}";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const analysis = JSON.parse(cleaned) as DDAnalysis;

      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });

      res.json({ analysis });
    } catch (err: any) {
      console.error("Deal DD error:", err);
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      res.status(500).json({ message: err.message || "Failed to process due diligence" });
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
