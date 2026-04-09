import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import multer from "multer";
import path from "path";
import fs from "fs";

const ADVICE_ENGINE_URL = "https://advice-generation-engine.replit.app";

const UPLOADS_DIR = path.join(process.cwd(), "ChatBGP", "advice-engine");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function setupAdviceEngineRoutes(app: Express) {
  app.get("/api/advice-engine/jobs", requireAuth, async (_req: Request, res: Response) => {
    try {
      const response = await fetch(`${ADVICE_ENGINE_URL}/api/jobs`);
      if (!response.ok) throw new Error("Failed to fetch jobs");
      const jobs = await response.json();
      res.json(jobs);
    } catch (err: any) {
      console.error("Advice engine jobs error:", err?.message);
      res.status(500).json({ message: "Failed to fetch jobs from Advice Engine" });
    }
  });

  app.get("/api/advice-engine/jobs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const response = await fetch(`${ADVICE_ENGINE_URL}/api/jobs/${id}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      const job = await response.json();
      res.json(job);
    } catch (err: any) {
      console.error("Advice engine job detail error:", err?.message);
      res.status(500).json({ message: "Failed to fetch job details" });
    }
  });

  app.post("/api/advice-engine/jobs", requireAuth, upload.fields([
    { name: "template", maxCount: 1 },
    { name: "sources", maxCount: 10 },
  ]), async (req: Request, res: Response) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    try {
      const templateFile = files?.template?.[0];
      const sourceFiles = files?.sources || [];

      if (!templateFile) {
        return res.status(400).json({ message: "Template file is required" });
      }
      if (sourceFiles.length === 0) {
        return res.status(400).json({ message: "At least one source document is required" });
      }

      const formData = new FormData();

      const templateBuffer = fs.readFileSync(templateFile.path);
      const templateBlob = new Blob([templateBuffer], { type: templateFile.mimetype });
      formData.append("template", templateBlob, templateFile.originalname);

      for (const sf of sourceFiles) {
        const buffer = fs.readFileSync(sf.path);
        const blob = new Blob([buffer], { type: sf.mimetype });
        formData.append("sources", blob, sf.originalname);
      }

      const response = await fetch(`${ADVICE_ENGINE_URL}/api/jobs`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Advice engine create job error:", errText);
        throw new Error("Failed to create job");
      }

      const job = await response.json();
      res.json(job);
    } catch (err: any) {
      console.error("Advice engine create job error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to create job" });
    } finally {
      if (files?.template) {
        for (const f of files.template) {
          try { fs.unlinkSync(f.path); } catch {}
        }
      }
      if (files?.sources) {
        for (const f of files.sources) {
          try { fs.unlinkSync(f.path); } catch {}
        }
      }
    }
  });

  app.get("/api/advice-engine/jobs/:id/download", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const response = await fetch(`${ADVICE_ENGINE_URL}/api/jobs/${id}/download`);

      if (!response.ok) throw new Error("Failed to download document");

      const contentDisposition = response.headers.get("content-disposition");
      const contentType = response.headers.get("content-type") || "application/octet-stream";

      let filename = `document-${id}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match) filename = match[1].replace(/['"]/g, "");
      } else if (contentType.includes("presentation") || contentType.includes("pptx")) {
        filename += ".pptx";
      } else if (contentType.includes("word") || contentType.includes("docx")) {
        filename += ".docx";
      } else if (contentType.includes("spreadsheet") || contentType.includes("xlsx")) {
        filename += ".xlsx";
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (err: any) {
      console.error("Advice engine download error:", err?.message);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  app.post("/api/advice-engine/jobs/:id/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const response = await fetch(`${ADVICE_ENGINE_URL}/api/jobs/${id}/retry`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to retry job");
      const job = await response.json();
      res.json(job);
    } catch (err: any) {
      console.error("Advice engine retry error:", err?.message);
      res.status(500).json({ message: "Failed to retry job" });
    }
  });
}
