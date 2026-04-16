import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { db } from "./db";
import { imageStudioImages, imageStudioCollections, imageStudioCollectionImages } from "@shared/schema";
import { eq, desc, ilike, or, sql, inArray, count } from "drizzle-orm";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import OpenAI from "openai";
import { saveFile, getFile } from "./file-storage";

// --- Multi-provider image generation helpers ---

async function generateWithFlux(prompt: string, size: string): Promise<Buffer | null> {
  // Accept `FAL_KEY` (canonical) or plain `FAL` — Railway config has just "FAL"
  const key = process.env.FAL_KEY || process.env.FAL;
  if (!key) return null;
  try {
    const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
      method: "POST",
      headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        image_size: size === "landscape" ? "landscape_16_9" : size === "portrait" ? "portrait_16_9" : "square",
        num_images: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.images?.[0]?.url) return null;
    const imgRes = await fetch(data.images[0].url);
    return Buffer.from(await imgRes.arrayBuffer());
  } catch { return null; }
}

async function generateWithDallE3(prompt: string, size: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: size === "landscape" ? "1792x1024" : size === "portrait" ? "1024x1792" : "1024x1024",
      quality: "hd",
      response_format: "b64_json",
    });
    if (!response.data[0]?.b64_json) return null;
    return Buffer.from(response.data[0].b64_json, "base64");
  } catch (e: any) {
    console.warn("[image-studio] DALL-E 3 failed:", e.message);
    return null;
  }
}

async function generateWithGemini(prompt: string, _size: string): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey) return null;
  try {
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const aiOpts: any = { apiKey };
    if (baseUrl) aiOpts.httpOptions = { apiVersion: "", baseUrl };
    const ai = new GoogleGenAI(aiOpts);

    const MODELS = ["gemini-2.5-flash-preview-image", "gemini-2.5-flash-image", "gemini-2.0-flash-exp"];
    for (const model of MODELS) {
      try {
        console.log(`[image-studio] Gemini generate: trying ${model}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { responseModalities: [Modality.TEXT, Modality.IMAGE], abortSignal: controller.signal as any },
          });
          clearTimeout(timeout);

          if (response && typeof response === "object" && "candidates" in response) {
            const candidate = (response as any).candidates?.[0];
            const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
            if (imagePart?.inlineData?.data) {
              console.log(`[image-studio] Gemini generate: success with ${model}`);
              return Buffer.from(imagePart.inlineData.data, "base64");
            }
          }
        } catch (innerErr: any) {
          clearTimeout(timeout);
          throw innerErr;
        }
      } catch (err: any) {
        const msg = err?.message || "";
        if (msg.includes("UNSUPPORTED_MODEL") || msg.includes("not supported") || msg.includes("not found") || msg.includes("abort")) continue;
        console.warn(`[image-studio] Gemini model ${model} error:`, msg);
      }
    }
    return null;
  } catch (e: any) {
    console.warn("[image-studio] Gemini generation failed:", e.message);
    return null;
  }
}

// Deterministic local enhancement — crops the Google Street View watermark
// band at the bottom, lifts brightness + saturation + contrast, gently
// sharpens. Never produces a different building because it never looks at
// the pixels, it just adjusts them. Safe fallback when Gemini is down.
async function enhanceLocally(buffer: Buffer, opts: { cropBottomPx?: number } = {}): Promise<Buffer> {
  const { cropBottomPx = 24 } = opts;
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 1600;
  const height = meta.height || 800;
  const cropHeight = Math.max(100, height - cropBottomPx);
  return sharp(buffer)
    .extract({ left: 0, top: 0, width, height: cropHeight })
    .modulate({ brightness: 1.05, saturation: 1.12 })
    .linear(1.08, -4) // mild contrast
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function editWithGemini(prompt: string, imageBase64: string, inputMime: string): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey) return null;
  try {
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const aiOpts: any = { apiKey };
    if (baseUrl) aiOpts.httpOptions = { apiVersion: "", baseUrl };
    const ai = new GoogleGenAI(aiOpts);

    const MODELS = ["gemini-2.5-flash-preview-image", "gemini-2.5-flash-image", "gemini-2.0-flash-exp"];
    for (const model of MODELS) {
      try {
        console.log(`[image-studio] Gemini edit: trying ${model}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{
              role: "user",
              parts: [
                { inlineData: { mimeType: inputMime, data: imageBase64 } },
                { text: prompt },
              ],
            }],
            config: { responseModalities: [Modality.TEXT, Modality.IMAGE], abortSignal: controller.signal as any },
          });
          clearTimeout(timeout);

          if (response && typeof response === "object" && "candidates" in response) {
            const candidate = (response as any).candidates?.[0];
            const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
            if (imagePart?.inlineData?.data) {
              console.log(`[image-studio] Gemini edit: success with ${model}`);
              return Buffer.from(imagePart.inlineData.data, "base64");
            }
          }
        } catch (innerErr: any) {
          clearTimeout(timeout);
          throw innerErr;
        }
      } catch (err: any) {
        const msg = err?.message || "";
        if (msg.includes("UNSUPPORTED_MODEL") || msg.includes("not supported") || msg.includes("not found") || msg.includes("abort")) continue;
        console.warn(`[image-studio] Gemini edit model ${model} error:`, msg);
      }
    }
    return null;
  } catch (e: any) {
    console.warn("[image-studio] Gemini edit failed:", e.message);
    return null;
  }
}

const IMAGE_DIR = path.join(process.cwd(), "uploads", "image-studio");
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

// ─── Durable image storage ────────────────────────────────────────────────
// Railway redeploys wipe the uploads/ directory, so any image only stored
// on disk disappears and AI Touch Up / AI Tag break with 'Image file not
// found'. These helpers dual-write every new image into the Postgres
// file_storage table (via saveFile) and read from the DB if the disk copy
// has gone missing. Existing images with localPath only are still readable
// while they exist on disk; once they're gone they need to be re-generated.
function storageKeyForImage(filePath: string): string {
  const filename = path.basename(filePath);
  return `image-studio/${filename}`;
}

async function persistImage(filePath: string, buffer: Buffer, mimeType: string, originalName?: string): Promise<void> {
  try { fs.writeFileSync(filePath, buffer); } catch (e: any) {
    console.warn(`[image-studio] fs write failed for ${filePath}: ${e?.message}`);
  }
  try {
    await saveFile(storageKeyForImage(filePath), buffer, mimeType, originalName || path.basename(filePath));
  } catch (e: any) {
    console.warn(`[image-studio] DB persist failed for ${filePath}: ${e?.message}`);
  }
}

async function readPersistedImage(localPath: string | null | undefined): Promise<Buffer | null> {
  if (!localPath) return null;
  try {
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath);
  } catch {}
  try {
    const dbFile = await getFile(storageKeyForImage(localPath));
    if (dbFile) {
      // Rehydrate the disk copy so subsequent reads are fast
      try {
        if (!fs.existsSync(path.dirname(localPath))) fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, dbFile.data);
      } catch {}
      return dbFile.data;
    }
  } catch (e: any) {
    console.warn(`[image-studio] DB read failed for ${localPath}: ${e?.message}`);
  }
  return null;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_studio_images (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      file_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Uncategorised',
      tags TEXT[] DEFAULT '{}'::TEXT[],
      description TEXT,
      source TEXT NOT NULL DEFAULT 'upload',
      property_id VARCHAR,
      area TEXT,
      address TEXT,
      brand_name TEXT,
      property_type TEXT,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      file_size INTEGER,
      width INTEGER,
      height INTEGER,
      thumbnail_data TEXT,
      sharepoint_item_id TEXT,
      sharepoint_drive_id TEXT,
      local_path TEXT,
      uploaded_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE image_studio_images ADD COLUMN IF NOT EXISTS address TEXT`);
  await pool.query(`ALTER TABLE image_studio_images ADD COLUMN IF NOT EXISTS brand_name TEXT`);
  await pool.query(`ALTER TABLE image_studio_images ADD COLUMN IF NOT EXISTS property_type TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deleted_sharepoint_images (
      id SERIAL PRIMARY KEY,
      sharepoint_drive_id TEXT NOT NULL,
      sharepoint_item_id TEXT NOT NULL,
      deleted_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deleted_sp_drive_item
    ON deleted_sharepoint_images (sharepoint_drive_id, sharepoint_item_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_studio_collections (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      cover_image_id VARCHAR,
      created_by VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_studio_collection_images (
      id SERIAL PRIMARY KEY,
      collection_id VARCHAR NOT NULL,
      image_id VARCHAR NOT NULL,
      added_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(collection_id, image_id)
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_image_unique
    ON image_studio_collection_images (collection_id, image_id)
  `);
}

async function generateThumbnail(buffer: Buffer): Promise<{ thumbnail: string; width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  const thumbBuffer = await sharp(buffer)
    .resize(400, 400, { fit: "cover", position: "centre" })
    .jpeg({ quality: 70 })
    .toBuffer();
  return {
    thumbnail: `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`,
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}

async function requireAdmin(req: Request, res: Response, next: Function) {
  const userId = req.session?.userId || (req as any).tokenUserId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
  if (!result.rows[0]?.is_admin) return res.status(403).json({ error: "Admin access required" });
  next();
}

export function registerImageStudioRoutes(app: Express) {
  ensureTable().catch(err => console.error("[image-studio] Table setup error:", err.message));

  app.get("/api/image-studio", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const images = await db.select().from(imageStudioImages).orderBy(desc(imageStudioImages.createdAt));
      res.json(images);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/search", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (!q) return res.json([]);
      const pattern = `%${q}%`;
      const images = await db.select().from(imageStudioImages)
        .where(or(
          ilike(imageStudioImages.fileName, pattern),
          ilike(imageStudioImages.description, pattern),
          ilike(imageStudioImages.area, pattern),
          ilike(imageStudioImages.category, pattern),
          ilike(imageStudioImages.address, pattern),
          ilike(imageStudioImages.brandName, pattern),
          ilike(imageStudioImages.brandSector, pattern),
          ilike(imageStudioImages.propertyType, pattern),
          sql`${pattern} ILIKE ANY(${imageStudioImages.tags})`,
        ))
        .orderBy(desc(imageStudioImages.createdAt));
      res.json(images);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/upload", requireAuth, requireAdmin, imageUpload.array("images", 20), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

      const userId = req.session?.userId || (req as any).tokenUserId;
      const category = (req.body.category as string) || "Uncategorised";
      const area = (req.body.area as string) || null;
      const address = (req.body.address as string) || null;
      const brandName = (req.body.brandName as string) || null;
      const brandSector = (req.body.brandSector as string) || null;
      const propertyType = (req.body.propertyType as string) || null;
      const tagsRaw = req.body.tags as string || "";
      const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

      const results = [];
      for (const file of files) {
        const ext = path.extname(file.originalname) || ".jpg";
        const filename = `${crypto.randomUUID()}${ext}`;
        const filePath = path.join(IMAGE_DIR, filename);
        await persistImage(filePath, file.buffer, file.mimetype || "image/jpeg", file.originalname);

        const { thumbnail, width, height } = await generateThumbnail(file.buffer);

        const [inserted] = await db.insert(imageStudioImages).values({
          fileName: file.originalname,
          category,
          tags,
          description: null,
          source: "upload",
          area,
          address,
          brandName,
          brandSector,
          propertyType,
          mimeType: file.mimetype,
          fileSize: file.size,
          width,
          height,
          thumbnailData: thumbnail,
          localPath: filePath,
          uploadedBy: userId,
        }).returning();

        results.push(inserted);
      }

      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/:id/full", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const [image] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, req.params.id));
      if (!image) return res.status(404).json({ error: "Not found" });

      if (image.localPath && fs.existsSync(image.localPath)) {
        res.setHeader("Content-Type", image.mimeType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(image.localPath);
      }

      res.status(404).json({ error: "File not found on disk" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/image-studio/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const updates: Record<string, any> = {};
      if (req.body.fileName !== undefined) updates.fileName = req.body.fileName;
      if (req.body.category !== undefined) updates.category = req.body.category;
      if (req.body.tags !== undefined) updates.tags = req.body.tags;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.area !== undefined) updates.area = req.body.area;
      if (req.body.address !== undefined) updates.address = req.body.address;
      if (req.body.brandName !== undefined) updates.brandName = req.body.brandName;
      if (req.body.brandSector !== undefined) updates.brandSector = req.body.brandSector;
      if (req.body.propertyType !== undefined) updates.propertyType = req.body.propertyType;
      if (req.body.propertyId !== undefined) updates.propertyId = req.body.propertyId;

      const [updated] = await db.update(imageStudioImages)
        .set(updates)
        .where(eq(imageStudioImages.id, req.params.id))
        .returning();

      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/bulk-delete", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ error: "ids (array) required" });
      }
      const images = await db.select().from(imageStudioImages).where(inArray(imageStudioImages.id, ids));
      for (const image of images) {
        if (image.localPath && fs.existsSync(image.localPath)) {
          try { fs.unlinkSync(image.localPath); } catch {}
        }
        if (image.sharepointDriveId && image.sharepointItemId) {
          await pool.query(
            "INSERT INTO deleted_sharepoint_images (sharepoint_drive_id, sharepoint_item_id) VALUES ($1, $2) ON CONFLICT (sharepoint_drive_id, sharepoint_item_id) DO NOTHING",
            [image.sharepointDriveId, image.sharepointItemId]
          );
        }
      }
      // Clean up collection references before deleting images
      await pool.query(
        `DELETE FROM image_studio_collection_images WHERE image_id = ANY($1::text[])`,
        [ids]
      );
      await db.delete(imageStudioImages).where(inArray(imageStudioImages.id, ids));
      res.json({ success: true, deleted: images.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/image-studio/bulk-categorize", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { ids, category } = req.body;
      if (!Array.isArray(ids) || !ids.length || !category) {
        return res.status(400).json({ error: "ids (array) and category (string) required" });
      }
      const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(", ");
      await pool.query(
        `UPDATE image_studio_images SET category = $${ids.length + 1} WHERE id IN (${placeholders})`,
        [...ids, category]
      );
      res.json({ success: true, updated: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/image-studio/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const [image] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, req.params.id));
      if (!image) return res.status(404).json({ error: "Not found" });

      if (image.localPath && fs.existsSync(image.localPath)) {
        fs.unlinkSync(image.localPath);
      }

      if (image.sharepointDriveId && image.sharepointItemId) {
        await pool.query(
          "INSERT INTO deleted_sharepoint_images (sharepoint_drive_id, sharepoint_item_id) VALUES ($1, $2) ON CONFLICT (sharepoint_drive_id, sharepoint_item_id) DO NOTHING",
          [image.sharepointDriveId, image.sharepointItemId]
        );
      }

      // Clean up collection references before deleting image
      await pool.query(
        "DELETE FROM image_studio_collection_images WHERE image_id = $1",
        [req.params.id]
      );
      await db.delete(imageStudioImages).where(eq(imageStudioImages.id, req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/ai-generate", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { prompt, category, area, tags, size } = req.body;
      const trimmedPrompt = (prompt || "").trim();
      if (!trimmedPrompt) return res.status(400).json({ error: "Prompt is required" });
      if (trimmedPrompt.length > 1000) return res.status(400).json({ error: "Prompt too long (max 1000 characters)" });

      const userId = req.session?.userId || (req as any).tokenUserId;

      const fullPrompt = `Professional, high quality property photography style: ${trimmedPrompt}. Suitable for a premium London commercial property agency. Clean, modern, 4K resolution.`;
      const sizeHint = size || "landscape";

      // Try providers in order: fal.ai Flux > DALL-E 3 > Gemini (if configured)
      let imageBuffer: Buffer | null = null;
      let provider = "unknown";

      // Try Flux first (best quality for property renders)
      console.log("[image-studio] AI generate: trying Flux...");
      imageBuffer = await generateWithFlux(fullPrompt, sizeHint);
      if (imageBuffer) provider = "flux-pro";

      // Fall back to DALL-E 3
      if (!imageBuffer) {
        console.log("[image-studio] AI generate: trying DALL-E 3...");
        imageBuffer = await generateWithDallE3(fullPrompt, sizeHint);
        if (imageBuffer) provider = "dall-e-3";
      }

      // Fall back to Gemini (if configured)
      if (!imageBuffer) {
        console.log("[image-studio] AI generate: trying Gemini...");
        imageBuffer = await generateWithGemini(fullPrompt, sizeHint);
        if (imageBuffer) provider = "gemini";
      }

      if (!imageBuffer) return res.status(500).json({ error: "No image generation provider available" });

      console.log(`[image-studio] AI generate: success with ${provider}`);

      const ext = ".png";
      const filename = `ai-${crypto.randomUUID()}${ext}`;
      const filePath = path.join(IMAGE_DIR, filename);
      await persistImage(filePath, imageBuffer, `image/${ext.replace(".", "") === "jpg" ? "jpeg" : ext.replace(".", "")}`);

      const { thumbnail, width, height } = await generateThumbnail(imageBuffer);

      const [inserted] = await db.insert(imageStudioImages).values({
        fileName: `AI: ${trimmedPrompt.slice(0, 60)}`,
        category: category || "Generated",
        tags: [...(tags || []), "AI Generated", provider].filter((v: any, i: any, a: any) => a.indexOf(v) === i),
        description: trimmedPrompt,
        source: "ai-generated",
        area: area || null,
        mimeType: "image/png",
        fileSize: imageBuffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
      }).returning();

      res.json({ ...inserted, provider });
    } catch (e: any) {
      console.error("[image-studio] AI generate error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/ai-edit", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { imageId, editPrompt } = req.body;
      const trimmedEdit = (editPrompt || "").trim();
      if (!imageId || !trimmedEdit) return res.status(400).json({ error: "imageId and editPrompt required" });
      if (trimmedEdit.length > 1000) return res.status(400).json({ error: "Edit prompt too long (max 1000 characters)" });

      const userId = req.session?.userId || (req as any).tokenUserId;

      const [image] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, imageId));
      if (!image) return res.status(404).json({ error: "Image not found" });
      if (image.uploadedBy && image.uploadedBy !== userId) return res.status(403).json({ error: "Not authorised to edit this image" });
      const sourceBuffer = await readPersistedImage(image.localPath);
      if (!sourceBuffer) return res.status(400).json({ error: "Image file not found. The original image was lost on a deploy — re-capture / re-upload the source image and try again." });
      const base64 = sourceBuffer.toString("base64");
      const inputMime = image.mimeType || "image/jpeg";

      const fullPrompt = `Edit this specific photograph: ${trimmedEdit}. PRESERVE the exact building, composition, and architectural details — only apply the requested edit. Professional property photography standard.`;

      // Gemini first — real image-to-image editing with the source pixels
      // as inline input. DALL-E 3 is a text-to-image model so it regenerated
      // an entirely new building from the prompt ('mad different buildings'
      // bug). Local Sharp enhancement is a deterministic fallback when the
      // user's edit is generic enough ('enhance', 'brighten', etc).
      let resultBuffer: Buffer | null = null;
      let provider = "unknown";

      console.log("[image-studio] AI edit: trying Gemini...");
      resultBuffer = await editWithGemini(fullPrompt, base64, inputMime);
      if (resultBuffer) provider = "gemini";

      // If Gemini is unavailable AND the user's request is a generic visual
      // polish (enhance/brighten/sharpen/cleanup), try the local Sharp path
      // so they at least get a cropped + colour-graded result — never a
      // different building. For other requests, report failure honestly.
      if (!resultBuffer) {
        const isPolishRequest = /\b(enhance|brighten|sharpen|clean\s*up|remove\s+watermark|marketing|professional)\b/i.test(trimmedEdit);
        if (isPolishRequest) {
          try {
            resultBuffer = await enhanceLocally(sourceBuffer);
            provider = "local";
          } catch {}
        }
      }

      if (!resultBuffer) return res.status(500).json({ error: "AI editing failed — no provider returned a result" });

      console.log(`[image-studio] AI edit: success with ${provider}`);

      const ext = ".png";
      const filename = `edited-${crypto.randomUUID()}${ext}`;
      const filePath = path.join(IMAGE_DIR, filename);
      await persistImage(filePath, resultBuffer, "image/png");

      const { thumbnail, width, height } = await generateThumbnail(resultBuffer);

      const [inserted] = await db.insert(imageStudioImages).values({
        fileName: `Edit: ${trimmedEdit.slice(0, 50)} (from ${image.fileName})`,
        category: image.category || "Generated",
        tags: [...(image.tags || []), "AI Edited", provider].filter((v: any, i: any, a: any) => a.indexOf(v) === i),
        description: `AI edit of "${image.fileName}": ${trimmedEdit}`,
        source: "ai-edited",
        area: image.area,
        mimeType: "image/png",
        fileSize: resultBuffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
        propertyId: image.propertyId,
      }).returning();

      res.json({ ...inserted, provider });
    } catch (e: any) {
      console.error("[image-studio] AI edit error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/ai-tag", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { imageId } = req.body;
      if (!imageId) return res.status(400).json({ error: "imageId required" });

      const [image] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, imageId));
      if (!image) return res.status(404).json({ error: "Not found" });

      const imageBuffer = await readPersistedImage(image.localPath);
      if (!imageBuffer) {
        return res.status(400).json({ error: "Image file not found. The image was lost on a redeploy — re-upload and try again." });
      }
      const base64 = imageBuffer.toString("base64");
      const mediaType = image.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic();

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: `Analyze this image for a London commercial property agency (BGP). Return JSON only:\n{"description": "one sentence description", "tags": ["tag1", "tag2", ...], "category": "one of: Properties, Areas, Marketing, Events, Headshots, Floor Plans, Interiors, Exteriors, Street Views, Generated, Other", "area": "London area if identifiable, e.g. Mayfair, City, Covent Garden, or null"}` }
          ]
        }]
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: "AI did not return valid JSON" });

      const aiResult = JSON.parse(jsonMatch[0]);

      const [updated] = await db.update(imageStudioImages)
        .set({
          description: aiResult.description || image.description,
          tags: aiResult.tags || image.tags,
          category: aiResult.category || image.category,
          area: aiResult.area || image.area,
        })
        .where(eq(imageStudioImages.id, imageId))
        .returning();

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/stock-search", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { query, page = 1 } = req.body;
      if (!query) return res.status(400).json({ error: "Query required" });

      const perPage = 30;
      const offset = (page - 1) * perPage;

      const pexelsKey = process.env.PEXELS_API_KEY;
      if (pexelsKey) {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&orientation=landscape`;
        const resp = await fetch(url, {
          headers: { Authorization: pexelsKey },
        });
        if (resp.ok) {
          const data = await resp.json();
          const results = (data.photos || []).map((r: any) => ({
            id: String(r.id),
            description: r.alt || query,
            urls: {
              thumb: r.src.tiny,
              small: r.src.small,
              regular: r.src.large,
              full: r.src.original,
            },
            photographer: r.photographer || "Unknown",
            photographerUrl: r.photographer_url || null,
            downloadUrl: r.src.original,
            width: r.width,
            height: r.height,
            source: "pexels",
          }));
          return res.json({ results, total: data.total_results, totalPages: Math.ceil(data.total_results / perPage) });
        }
      }

      const pixabayKey = process.env.PIXABAY_API_KEY;
      if (pixabayKey) {
        const url = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&image_type=photo&orientation=horizontal&safesearch=true`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          const results = (data.hits || []).map((r: any) => ({
            id: String(r.id),
            description: r.tags || query,
            urls: {
              thumb: r.previewURL,
              small: r.webformatURL,
              regular: r.largeImageURL,
              full: r.largeImageURL,
            },
            photographer: r.user || "Unknown",
            photographerUrl: `https://pixabay.com/users/${r.user}-${r.user_id}/`,
            downloadUrl: r.largeImageURL,
            width: r.imageWidth,
            height: r.imageHeight,
            source: "pixabay",
          }));
          return res.json({ results, total: data.totalHits || 0, totalPages: Math.ceil((data.totalHits || 0) / perPage) });
        }
      }

      const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
      if (unsplashKey) {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&orientation=landscape`;
        const resp = await fetch(url, { headers: { Authorization: `Client-ID ${unsplashKey}` } });
        if (resp.ok) {
          const data = await resp.json();
          const results = (data.results || []).map((r: any) => ({
            id: r.id,
            description: r.description || r.alt_description,
            urls: { thumb: r.urls.thumb, small: r.urls.small, regular: r.urls.regular, full: r.urls.full },
            photographer: r.user?.name || "Unknown",
            photographerUrl: r.user?.links?.html,
            downloadUrl: r.links?.download_location,
            width: r.width,
            height: r.height,
            source: "unsplash",
          }));
          return res.json({ results, total: data.total, totalPages: data.total_pages });
        }
      }

      const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${perPage}&gsroffset=${offset}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=400&iiurlheight=300&format=json&origin=*`;
      const wikiResp = await fetch(wikiUrl);
      if (!wikiResp.ok) {
        return res.status(wikiResp.status).json({ error: `Stock photo API error: ${wikiResp.statusText}` });
      }
      const wikiData = await wikiResp.json();
      const pages = wikiData.query?.pages || {};
      const results = Object.values(pages)
        .filter((p: any) => p.imageinfo?.[0]?.url && /\.(jpg|jpeg|png|webp)/i.test(p.imageinfo[0].url))
        .map((p: any) => {
          const ii = p.imageinfo[0];
          const artist = ii.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, "") || "Wikimedia";
          return {
            id: String(p.pageid),
            description: (p.title || "").replace("File:", "").replace(/\.[^.]+$/, ""),
            urls: {
              thumb: ii.thumburl || ii.url,
              small: ii.thumburl || ii.url,
              regular: ii.url,
              full: ii.url,
            },
            photographer: artist,
            photographerUrl: ii.descriptionurl || null,
            downloadUrl: ii.url,
            width: ii.width,
            height: ii.height,
            source: "wikimedia",
          };
        });
      res.json({ results, total: results.length, totalPages: 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/import-stock", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { imageUrl, fileName, photographer, category, area, tags } = req.body;
      if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });

      const ALLOWED_STOCK_HOSTS = [
        "images.unsplash.com", "plus.unsplash.com",
        "images.pexels.com",
        "pixabay.com", "cdn.pixabay.com",
        "upload.wikimedia.org",
      ];
      try {
        const parsedUrl = new URL(imageUrl);
        if (!ALLOWED_STOCK_HOSTS.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith("." + h))) {
          return res.status(400).json({ error: "Only approved stock photo URLs are allowed" });
        }
        if (parsedUrl.protocol !== "https:") {
          return res.status(400).json({ error: "Only HTTPS URLs allowed" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid URL" });
      }

      const userId = req.session?.userId || (req as any).tokenUserId;

      const resp = await fetch(imageUrl);
      if (!resp.ok) return res.status(400).json({ error: "Failed to download image" });

      const buffer = Buffer.from(await resp.arrayBuffer());
      const ext = ".jpg";
      const filename = `stock-${crypto.randomUUID()}${ext}`;
      const filePath = path.join(IMAGE_DIR, filename);
      await persistImage(filePath, buffer, "image/jpeg");

      const { thumbnail, width, height } = await generateThumbnail(buffer);

      const [inserted] = await db.insert(imageStudioImages).values({
        fileName: fileName || "Stock Image",
        category: category || "Stock",
        tags: [...(tags || []), "Stock", photographer ? `Photo: ${photographer}` : ""].filter(Boolean),
        description: `Stock photo by ${photographer || "Unknown"}`,
        source: "stock",
        area: area || null,
        mimeType: "image/jpeg",
        fileSize: buffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
      }).returning();

      res.json(inserted);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/categories", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT category, COUNT(*)::int as count 
        FROM image_studio_images 
        GROUP BY category 
        ORDER BY count DESC
      `);
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/streetview-proxy", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { location, heading, pitch, fov, size } = req.query;
      if (!location) return res.status(400).json({ error: "location required" });

      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) return res.status(400).json({ error: "Google API key not configured" });

      const params = new URLSearchParams({
        size: (size as string) || "800x600",
        location: location as string,
        heading: (heading as string) || "0",
        pitch: (pitch as string) || "0",
        fov: (fov as string) || "90",
        key: apiKey,
      });

      const resp = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`);
      if (!resp.ok) return res.status(resp.status).json({ error: "Street View API error" });

      const buffer = Buffer.from(await resp.arrayBuffer());
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/capture-streetview", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { location, heading, pitch, fov, category, area, tags } = req.body;
      if (!location) return res.status(400).json({ error: "location required" });

      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) return res.status(400).json({ error: "Google API key not configured" });

      const userId = req.session?.userId || (req as any).tokenUserId;

      const params = new URLSearchParams({
        size: "1200x800",
        location,
        heading: String(heading || 0),
        pitch: String(pitch || 0),
        fov: String(fov || 90),
        key: apiKey,
      });

      const resp = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`);
      if (!resp.ok) return res.status(400).json({ error: "Failed to fetch Street View" });

      const buffer = Buffer.from(await resp.arrayBuffer());
      const safeName = (location as string).replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-");
      const filename = `streetview-${safeName}-${heading || 0}-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const filePath = path.join(IMAGE_DIR, filename);
      await persistImage(filePath, buffer, "image/jpeg");

      const { thumbnail, width, height } = await generateThumbnail(buffer);

      const [inserted] = await db.insert(imageStudioImages).values({
        fileName: `Street View - ${location}`,
        category: category || "Street Views",
        tags: [...(tags || []), "Street View", "Google", "Exterior"].filter((v: any, i: any, a: any) => a.indexOf(v) === i),
        description: `Google Street View capture of ${location} (heading: ${heading || 0}°)`,
        source: "streetview",
        area: area || location,
        mimeType: "image/jpeg",
        fileSize: buffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
      }).returning();

      res.json(inserted);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Combined capture + AI enhance endpoint — one-click professional property photography
  app.post("/api/image-studio/capture-and-enhance", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { location, heading, pitch, fov, category, area, tags } = req.body;
      if (!location) return res.status(400).json({ error: "location required" });

      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) return res.status(400).json({ error: "Google API key not configured" });

      const userId = req.session?.userId || (req as any).tokenUserId;

      // Step 1: Capture the Street View image
      console.log(`[capture-enhance] Capturing Street View for: ${location}`);
      const params = new URLSearchParams({
        size: "1200x800",
        location,
        heading: String(heading || 0),
        pitch: String(pitch || 0),
        fov: String(fov || 90),
        key: apiKey,
      });

      const svResp = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`);
      if (!svResp.ok) return res.status(400).json({ error: "Failed to fetch Street View" });

      const rawBuffer = Buffer.from(await svResp.arrayBuffer());
      const safeName = (location as string).replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-");

      // Step 2: Save the raw capture
      const rawFilename = `streetview-raw-${safeName}-${heading || 0}-${crypto.randomUUID().slice(0, 8)}.jpg`;
      const rawFilePath = path.join(IMAGE_DIR, rawFilename);
      await persistImage(rawFilePath, rawBuffer, "image/jpeg");

      const rawThumb = await generateThumbnail(rawBuffer);

      const baseTags = [...(tags || []), "Street View", "Google", "Exterior"].filter((v: any, i: any, a: any) => a.indexOf(v) === i);

      const [rawRecord] = await db.insert(imageStudioImages).values({
        fileName: `Street View (Raw) - ${location}`,
        category: category || "Street Views",
        tags: baseTags,
        description: `Raw Google Street View capture of ${location} (heading: ${heading || 0}deg)`,
        source: "streetview",
        area: area || location,
        mimeType: "image/jpeg",
        fileSize: rawBuffer.length,
        width: rawThumb.width,
        height: rawThumb.height,
        thumbnailData: rawThumb.thumbnail,
        localPath: rawFilePath,
        uploadedBy: userId,
      }).returning();

      console.log(`[capture-enhance] Raw capture saved: ${rawRecord.id}`);

      // Step 3: AI enhance the captured image for professional quality
      console.log(`[capture-enhance] Enhancing image with AI...`);
      // IMPORTANT: enhancement must be IMAGE-TO-IMAGE so the actual building
      // is preserved. DALL-E 3 was tried first in the old code — it's a
      // text-to-image model with no access to the source pixels, so it
      // regenerated a completely different building from the location name
      // alone. That was the 'mad different buildings' bug Woody reported.
      const enhancePrompt = "Subtly enhance this Google Street View photograph to look like professional commercial property marketing imagery. Preserve the EXACT building, street, windows, and architectural details — do not invent or alter the building. Remove Google watermarks and UI elements at the bottom. Improve the lighting and sky, lift contrast and saturation, and sharpen details. The result must be recognisable as the same building.";
      const rawBase64 = rawBuffer.toString("base64");
      const inputMime = "image/jpeg";

      let enhancedBuffer: Buffer | null = null;
      let enhanceProvider = "unknown";

      // Try Gemini first — true image-to-image editing via inline image data.
      enhancedBuffer = await editWithGemini(enhancePrompt, rawBase64, inputMime);
      if (enhancedBuffer) enhanceProvider = "gemini";

      // Fall back to deterministic local enhancement — crops the Google
      // watermark band + tonal polish. Never produces a different building
      // because it never leaves the source pixels. Always available.
      if (!enhancedBuffer) {
        try {
          enhancedBuffer = await enhanceLocally(rawBuffer);
          enhanceProvider = "local";
        } catch (localErr: any) {
          console.warn(`[capture-enhance] local enhancement failed: ${localErr?.message}`);
        }
      }

      let enhancedRecord = null;
      if (enhancedBuffer) {
        console.log(`[capture-enhance] Enhancement successful with ${enhanceProvider}`);
        const enhExt = enhanceProvider === "local" ? ".jpg" : ".png";
        const enhFilename = `streetview-enhanced-${safeName}-${heading || 0}-${crypto.randomUUID().slice(0, 8)}${enhExt}`;
        const enhFilePath = path.join(IMAGE_DIR, enhFilename);
        await persistImage(enhFilePath, enhancedBuffer, enhExt === ".png" ? "image/png" : "image/jpeg");

        const enhThumb = await generateThumbnail(enhancedBuffer);

        const [inserted] = await db.insert(imageStudioImages).values({
          fileName: `Street View (Enhanced) - ${location}`,
          category: category || "Street Views",
          tags: [...baseTags, "AI Enhanced", enhanceProvider],
          description: `AI-enhanced Street View of ${location} (from raw capture, enhanced with ${enhanceProvider})`,
          source: "ai-edited",
          area: area || location,
          mimeType: enhExt === ".png" ? "image/png" : "image/jpeg",
          fileSize: enhancedBuffer.length,
          width: enhThumb.width,
          height: enhThumb.height,
          thumbnailData: enhThumb.thumbnail,
          localPath: enhFilePath,
          uploadedBy: userId,
        }).returning();

        enhancedRecord = { ...inserted, provider: enhanceProvider };
        console.log(`[capture-enhance] Enhanced image saved: ${inserted.id}`);
      } else {
        console.warn(`[capture-enhance] AI enhancement failed for ${location}, returning raw only`);
      }

      res.json({
        raw: rawRecord,
        enhanced: enhancedRecord,
        message: enhancedRecord
          ? `Street View captured and enhanced with ${enhanceProvider}`
          : "Street View captured but AI enhancement failed — raw image saved",
      });
    } catch (e: any) {
      console.error("[capture-enhance] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/sync-status", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    res.json({
      running: imageSyncRunning,
      progress: imageSyncProgress,
      lastRun: imageSyncLastRun,
    });
  });

  app.post("/api/image-studio/trigger-sync", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    if (imageSyncRunning) return res.json({ message: "Sync already in progress" });
    const forceReimport = req.body?.forceReimport === true || req.query?.forceReimport === "true";
    res.json({ message: `Sync started${forceReimport ? " (forceReimport)" : ""}` });
    runImageSync({ forceReimport }).catch(e => console.error("[image-sync] Manual sync error:", e.message));
  });

  app.post("/api/image-studio/clear-deleted-blacklist", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const before = await pool.query("SELECT COUNT(*)::int AS n FROM deleted_sharepoint_images");
      await pool.query("TRUNCATE TABLE deleted_sharepoint_images");
      console.log(`[image-sync] Cleared ${before.rows[0].n} rows from deleted_sharepoint_images blacklist`);
      res.json({ success: true, cleared: before.rows[0].n });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk tag endpoint
  app.post("/api/image-studio/bulk-tag", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { ids, tags } = req.body;
      if (!Array.isArray(ids) || !ids.length || !Array.isArray(tags) || !tags.length) {
        return res.status(400).json({ error: "ids (array) and tags (array) required" });
      }
      const cleanTags = tags.map((t: string) => t.trim()).filter(Boolean);
      // Append tags to existing tags (unique)
      const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(", ");
      const tagArray = `ARRAY[${cleanTags.map((_: string, i: number) => `$${ids.length + i + 1}`).join(", ")}]::TEXT[]`;
      await pool.query(
        `UPDATE image_studio_images
         SET tags = (
           SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}'::TEXT[]) || ${tagArray}))
         )
         WHERE id IN (${placeholders})`,
        [...ids, ...cleanTags]
      );
      res.json({ success: true, updated: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk assign property endpoint
  app.post("/api/image-studio/bulk-assign-property", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { ids, propertyId, address } = req.body;
      if (!Array.isArray(ids) || !ids.length || !propertyId) {
        return res.status(400).json({ error: "ids (array) and propertyId required" });
      }
      const updates: Record<string, any> = { propertyId };
      if (address) updates.address = address;
      await db.update(imageStudioImages)
        .set(updates)
        .where(inArray(imageStudioImages.id, ids));
      res.json({ success: true, updated: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Collections CRUD
  app.post("/api/image-studio/collections", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Collection name required" });
      const userId = req.session?.userId || (req as any).tokenUserId;
      const [collection] = await db.insert(imageStudioCollections).values({
        name: name.trim(),
        description: description?.trim() || null,
        createdBy: userId,
      }).returning();
      res.json(collection);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/collections", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT c.*,
          (SELECT COUNT(*)::int FROM image_studio_collection_images ci WHERE ci.collection_id = c.id) as image_count,
          (SELECT i.thumbnail_data FROM image_studio_collection_images ci
           JOIN image_studio_images i ON i.id = ci.image_id
           WHERE ci.collection_id = c.id
           ORDER BY ci.added_at DESC LIMIT 1) as cover_thumbnail
        FROM image_studio_collections c
        ORDER BY c.created_at DESC
      `);
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/collections/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const collectionId = req.params.id as string;
      const [collection] = await db.select().from(imageStudioCollections).where(eq(imageStudioCollections.id, collectionId));
      if (!collection) return res.status(404).json({ error: "Collection not found" });

      const result = await pool.query(`
        SELECT i.* FROM image_studio_images i
        JOIN image_studio_collection_images ci ON ci.image_id = i.id
        WHERE ci.collection_id = $1
        ORDER BY ci.added_at DESC
      `, [collectionId]);

      res.json({ ...collection, images: result.rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/collections/:id/images", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const collectionId = req.params.id as string;
      const { imageIds } = req.body;
      if (!Array.isArray(imageIds) || !imageIds.length) {
        return res.status(400).json({ error: "imageIds (array) required" });
      }
      const [collection] = await db.select().from(imageStudioCollections).where(eq(imageStudioCollections.id, collectionId));
      if (!collection) return res.status(404).json({ error: "Collection not found" });

      let added = 0;
      for (const imageId of imageIds) {
        try {
          await pool.query(
            `INSERT INTO image_studio_collection_images (collection_id, image_id) VALUES ($1, $2) ON CONFLICT (collection_id, image_id) DO NOTHING`,
            [collectionId, imageId]
          );
          added++;
        } catch {}
      }
      res.json({ success: true, added });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/image-studio/collections/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const collectionId = req.params.id as string;
      await pool.query("DELETE FROM image_studio_collection_images WHERE collection_id = $1", [collectionId]);
      await db.delete(imageStudioCollections).where(eq(imageStudioCollections.id, collectionId));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/image-studio/collections/:id/images/:imageId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await pool.query(
        "DELETE FROM image_studio_collection_images WHERE collection_id = $1 AND image_id = $2",
        [req.params.id, req.params.imageId]
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("[image-studio] Image Studio routes registered");
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"];
let imageSyncRunning = false;
let imageSyncProgress = "";
let imageSyncLastRun: any = null;

async function getMsTokenForImageSync(): Promise<string | null> {
  try {
    const { ConfidentialClientApplication } = await import("@azure/msal-node");
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
    const tenantId = process.env.AZURE_TENANT_ID;
    if (!clientId || !clientSecret || !tenantId) return null;

    const result = await pool.query(
      "SELECT user_id, cache_data, home_account_id FROM msal_token_cache ORDER BY updated_at DESC NULLS LAST LIMIT 1"
    );
    if (!result.rows.length) return null;

    const { cache_data, home_account_id } = result.rows[0];
    if (!cache_data || !home_account_id) return null;

    const client = new ConfidentialClientApplication({
      auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` },
    });
    client.getTokenCache().deserialize(cache_data);
    const accounts = await client.getTokenCache().getAllAccounts();
    const account = accounts.find((a: any) => a.homeAccountId === home_account_id);
    if (!account) return null;

    const tokenResult = await client.acquireTokenSilent({
      scopes: ["https://graph.microsoft.com/Files.ReadWrite.All", "https://graph.microsoft.com/Sites.ReadWrite.All", "offline_access"],
      account,
    });

    if (tokenResult?.accessToken) {
      const serialized = client.getTokenCache().serialize();
      await pool.query("UPDATE msal_token_cache SET cache_data = $1, updated_at = NOW() WHERE user_id = $2", [serialized, result.rows[0].user_id]);
      return tokenResult.accessToken;
    }
  } catch (err: any) {
    console.error("[image-sync] Token error:", err.message);
  }
  return null;
}

const LONDON_AREAS = [
  "Mayfair", "Soho", "Covent Garden", "Fitzrovia", "Marylebone", "St James", "Knightsbridge",
  "Chelsea", "Kensington", "Belgravia", "Victoria", "Westminster", "Paddington", "Bond Street",
  "Oxford Street", "Regent Street", "Piccadilly", "Clerkenwell", "Shoreditch", "Hoxton",
  "Farringdon", "Holborn", "Bloomsbury", "King's Cross", "Euston", "Angel", "Islington",
  "Canary Wharf", "Stratford", "Southwark", "Bermondsey", "London Bridge", "Waterloo",
  "Vauxhall", "Battersea", "Hammersmith", "Fulham", "Richmond", "Wimbledon", "Croydon",
  "City of London", "Bank", "Liverpool Street", "Moorgate", "Aldgate", "Tower Hill",
  "Tottenham Court Road", "Leicester Square", "Charing Cross", "Embankment",
];

function detectAreaFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  for (const area of LONDON_AREAS) {
    if (lower.includes(area.toLowerCase())) return area;
  }
  return "";
}

function detectCategoryFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  const fileName = lower.split("/").pop() || "";

  if (lower.includes("headshot") || lower.includes("portrait") || lower.includes("team photo") || lower.includes("staff photo")) return "Headshots";
  if (/\b(team|staff|people|head\s?shots?)\b/.test(lower.split("/").slice(0, -1).join("/"))) return "Headshots";
  if (fileName.match(/^(img|dsc|photo)[\s_-]?\d+/i) && (lower.includes("team") || lower.includes("staff") || lower.includes("office event"))) return "Headshots";

  if (lower.includes("marketing") || lower.includes("brochure") || lower.includes("pitch")) return "Marketing";
  if (lower.includes("exterior") || lower.includes("facade")) return "Exteriors";
  if (lower.includes("interior") || lower.includes("fit out") || lower.includes("fitout")) return "Interiors";
  if (lower.includes("floor plan") || lower.includes("floorplan")) return "Floor Plans";
  if (lower.includes("logo") || lower.includes("brand")) return "Brands";
  if (lower.includes("aerial") || lower.includes("drone")) return "Exteriors";
  if (lower.includes("event") || lower.includes("launch") || lower.includes("party") || lower.includes("awards")) return "Events";
  if (lower.includes("street view") || lower.includes("streetview")) return "Street Views";

  if (/\d+\s+\w+\s+(street|road|lane|place|square|mews|gardens|court|row|hill|way|avenue|drive|crescent)/i.test(filePath)) return "Properties";
  if (lower.includes("property") || lower.includes("building") || lower.includes("unit") || lower.includes("scheme")) return "Properties";

  return "Uncategorised";
}

function extractPropertyFromPath(filePath: string): string {
  const parts = filePath.split("/");
  for (let i = parts.length - 2; i >= 1; i--) {
    const part = parts[i];
    if (/\d+\s+\w+/.test(part) || /\w+\s+(street|road|lane|place|square|mews|gardens|court|row|hill|way|avenue|drive|crescent)/i.test(part)) {
      return part;
    }
  }
  return "";
}

interface ImageResult { name: string; path: string; size: number; driveId: string; itemId: string; webUrl: string }

let imageScanFoldersChecked = 0;
let imageScanImagesFound = 0;

async function browseForImages(
  driveId: string, itemId: string, token: string, basePath: string, maxDepth: number, depth: number,
  onImage: (img: ImageResult) => Promise<void>
): Promise<void> {
  if (depth >= maxDepth) return;
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,webUrl,id,file,folder`;

  let data: any;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn(`[image-sync] Access denied browsing ${basePath} (${res.status})`);
      }
      return;
    }
    data = await res.json();
  } catch (fetchErr: any) {
    console.warn(`[image-sync] Network error browsing ${basePath}: ${fetchErr.message}`);
    return;
  }

  const processChild = async (child: any) => {
    const childPath = basePath ? `${basePath}/${child.name}` : child.name;
    if (child.folder) {
      imageScanFoldersChecked++;
      if (imageScanFoldersChecked % 50 === 0) {
        console.log(`[image-sync] Scanning... ${imageScanFoldersChecked} folders checked, ${imageScanImagesFound} images found so far`);
        imageSyncProgress = `Scanning: ${imageScanFoldersChecked} folders, ${imageScanImagesFound} images`;
      }
      await browseForImages(driveId, child.id, token, childPath, maxDepth, depth + 1, onImage);
    } else {
      const ext = path.extname(child.name).toLowerCase();
      if (IMAGE_EXTENSIONS.includes(ext) && (child.size || 0) > 10000 && (child.size || 0) < 50 * 1024 * 1024) {
        imageScanImagesFound++;
        try {
          await onImage({ name: child.name, path: childPath, size: child.size, driveId, itemId: child.id, webUrl: child.webUrl });
        } catch (err: any) {
          console.error(`[image-sync] onImage callback error for ${child.name}:`, err.message);
        }
      }
    }
  };

  for (const child of data.value || []) {
    await processChild(child);
  }

  let nextLink = data["@odata.nextLink"];
  while (nextLink) {
    try {
      const nextRes = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } });
      if (!nextRes.ok) break;
      const nextData = await nextRes.json();
      for (const child of nextData.value || []) {
        await processChild(child);
      }
      nextLink = nextData["@odata.nextLink"];
    } catch {
      break;
    }
  }
}

async function runImageSync(opts: { forceReimport?: boolean } = {}) {
  if (imageSyncRunning) return;
  imageSyncRunning = true;
  imageSyncProgress = "Starting...";
  imageScanFoldersChecked = 0;
  imageScanImagesFound = 0;
  console.log(`[image-sync] Starting SharePoint image sync${opts.forceReimport ? " (forceReimport=true)" : ""}...`);

  let totalImported = 0, totalSkippedExists = 0, totalSkippedDeleted = 0, totalSkippedDupeName = 0, totalErrors = 0;

  try {
    const token = await getMsTokenForImageSync();
    if (!token) {
      console.log("[image-sync] No MS token available");
      imageSyncRunning = false;
      imageSyncProgress = "";
      return;
    }

    const FOLDERS = [
      { name: "BGP Business Context", url: "https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/woody_brucegillinghampollard_com/IgA5N1cspPKHTJ8tcCdA-cRUAXmCOETID8BfvH-bxBgLNRE?e=jmc26e" },
      { name: "BGP Shared Drive", url: "https://brucegillinghampollardlimited.sharepoint.com/:f:/s/BGP/IgA_lPHJX3cQT6YBOeT3_Y5vAb-hiHkDENJFZylEDxpzbo8?e=PNilJl" },
    ];

    for (const folder of FOLDERS) {
      try {
        imageSyncProgress = `Resolving: ${folder.name}`;
        const encodedUrl = Buffer.from(folder.url).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const sharingUrl = `u!${encodedUrl}`;
        const driveItemRes = await fetch(`https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`, { headers: { Authorization: `Bearer ${token}` } });
        if (!driveItemRes.ok) {
          console.error(`[image-sync] Cannot access ${folder.name}: HTTP ${driveItemRes.status}`);
          totalErrors++;
          continue;
        }
        const driveItem = await driveItemRes.json();
        const driveId = driveItem.parentReference?.driveId;
        const folderId = driveItem.id;

        imageSyncProgress = `Scanning: ${folder.name}`;
        console.log(`[image-sync] Scanning ${folder.name} for images (streaming import)...`);

        const importOne = async (img: ImageResult) => {
          try {
            const existing = await pool.query(
              "SELECT id FROM image_studio_images WHERE sharepoint_drive_id = $1 AND sharepoint_item_id = $2",
              [img.driveId, img.itemId]
            );
            if (existing.rows.length > 0) { totalSkippedExists++; return; }

            if (!opts.forceReimport) {
              const wasDeleted = await pool.query(
                "SELECT id FROM deleted_sharepoint_images WHERE sharepoint_drive_id = $1 AND sharepoint_item_id = $2",
                [img.driveId, img.itemId]
              );
              if (wasDeleted.rows.length > 0) { totalSkippedDeleted++; return; }
            }

            const dupeByName = await pool.query(
              "SELECT id FROM image_studio_images WHERE file_name = $1 AND file_size = $2",
              [img.name, img.size]
            );
            if (dupeByName.rows.length > 0) { totalSkippedDupeName++; return; }

            imageSyncProgress = `Importing: ${img.name} (${totalImported} saved, ${imageScanFoldersChecked} folders)`;
            const contentRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${img.driveId}/items/${img.itemId}/content`, {
              headers: { Authorization: `Bearer ${token}` }, redirect: "follow"
            });
            if (!contentRes.ok) { totalErrors++; return; }

            const buffer = Buffer.from(await contentRes.arrayBuffer());
            const ext = path.extname(img.name).toLowerCase();
            const filename = `sp-${crypto.randomUUID().slice(0, 8)}${ext}`;
            const filePath = path.join(IMAGE_DIR, filename);
            const spMime = `image/${ext.replace(".", "") === "jpg" ? "jpeg" : ext.replace(".", "")}`;
            await persistImage(filePath, buffer, spMime, img.name);

            const { thumbnail, width, height } = await generateThumbnail(buffer);

            await db.insert(imageStudioImages).values({
              fileName: img.name,
              category: "Uncategorised",
              tags: [],
              description: img.path,
              source: "sharepoint",
              mimeType: `image/${ext.replace(".", "") === "jpg" ? "jpeg" : ext.replace(".", "")}`,
              fileSize: buffer.length,
              width,
              height,
              thumbnailData: thumbnail,
              sharepointItemId: img.itemId,
              sharepointDriveId: img.driveId,
              localPath: filePath,
            });
            totalImported++;
            if (totalImported % 10 === 0) {
              console.log(`[image-sync] Progress: imported=${totalImported}, exists=${totalSkippedExists}, blacklisted=${totalSkippedDeleted}, dupeName=${totalSkippedDupeName}, errors=${totalErrors}`);
            }
          } catch (err: any) {
            console.error(`[image-sync] Error importing ${img.name}:`, err.message);
            totalErrors++;
          }
        };

        await browseForImages(driveId, folderId, token, folder.name, 10, 0, importOne);
        console.log(`[image-sync] ${folder.name} done: imported=${totalImported}, exists=${totalSkippedExists}, blacklisted=${totalSkippedDeleted}, dupeName=${totalSkippedDupeName}, errors=${totalErrors}`);
      } catch (err: any) {
        console.error(`[image-sync] Error processing folder ${folder.name}:`, err.message);
        totalErrors++;
      }
    }
  } catch (err: any) {
    console.error("[image-sync] Fatal error:", err.message);
  } finally {
    imageSyncLastRun = {
      timestamp: new Date().toISOString(),
      imported: totalImported,
      skipped: totalSkippedExists + totalSkippedDeleted + totalSkippedDupeName,
      skippedExists: totalSkippedExists,
      skippedBlacklisted: totalSkippedDeleted,
      skippedDupeName: totalSkippedDupeName,
      errors: totalErrors,
      forceReimport: !!opts.forceReimport,
    };
    console.log(`[image-sync] Complete: imported=${totalImported}, exists=${totalSkippedExists}, blacklisted=${totalSkippedDeleted}, dupeName=${totalSkippedDupeName}, errors=${totalErrors}`);
    imageSyncRunning = false;
    imageSyncProgress = "";
  }
}

export function getImageSyncStatus() {
  return { running: imageSyncRunning, progress: imageSyncProgress, foldersChecked: imageScanFoldersChecked, imagesFound: imageScanImagesFound };
}

export function startImageSync() {
  setTimeout(() => {
    runImageSync().catch(e => console.error("[image-sync] Initial sync error:", e.message));
  }, 60_000);

  setInterval(() => {
    runImageSync().catch(e => console.error("[image-sync] Scheduled sync error:", e.message));
  }, 6 * 60 * 60 * 1000);

  console.log("[image-sync] SharePoint image sync enabled — runs on startup + every 6 hours");
}
