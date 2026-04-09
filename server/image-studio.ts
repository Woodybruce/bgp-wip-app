import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { db } from "./db";
import { imageStudioImages } from "@shared/schema";
import { eq, desc, ilike, or, sql, inArray } from "drizzle-orm";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const IMAGE_DIR = path.join(process.cwd(), "uploads", "image-studio");
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

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
        fs.writeFileSync(filePath, file.buffer);

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

      await db.delete(imageStudioImages).where(eq(imageStudioImages.id, req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/ai-generate", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { prompt, category, area, tags } = req.body;
      const trimmedPrompt = (prompt || "").trim();
      if (!trimmedPrompt) return res.status(400).json({ error: "Prompt is required" });
      if (trimmedPrompt.length > 1000) return res.status(400).json({ error: "Prompt too long (max 1000 characters)" });

      const userId = req.session?.userId || (req as any).tokenUserId;

      const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
      if (!apiKey || !baseUrl) return res.status(500).json({ error: "AI image generation not configured" });

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });

      const fullPrompt = `Professional, high quality property photography style: ${trimmedPrompt}. Suitable for a premium London commercial property agency. Clean, modern, 4K resolution.`;

      const MODELS = ["gemini-2.5-flash-preview-image", "gemini-2.5-flash-image", "gemini-2.0-flash-exp"];
      let imageData: string | null = null;
      let imageMimeType = "image/png";

      for (const model of MODELS) {
        try {
          console.log(`[image-studio] AI generate: trying ${model}`);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 90000);
          try {
            const response = await ai.models.generateContent({
              model,
              contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
              config: { responseModalities: [Modality.TEXT, Modality.IMAGE], abortSignal: controller.signal as any },
            });
            clearTimeout(timeout);

            if (response && typeof response === "object" && "candidates" in response) {
              const candidate = (response as any).candidates?.[0];
              const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
              if (imagePart?.inlineData?.data) {
                imageData = imagePart.inlineData.data;
                imageMimeType = imagePart.inlineData.mimeType || "image/png";
                console.log(`[image-studio] AI generate: success with ${model}`);
                break;
              }
            }
            console.log(`[image-studio] AI generate: ${model} returned no image`);
          } catch (innerErr: any) {
            clearTimeout(timeout);
            throw innerErr;
          }
        } catch (err: any) {
          const msg = err?.message || "";
          if (msg.includes("UNSUPPORTED_MODEL") || msg.includes("not supported") || msg.includes("not found") || msg.includes("abort")) continue;
          throw err;
        }
      }

      if (!imageData) return res.status(500).json({ error: "AI image generation failed — no model returned an image" });

      const buffer = Buffer.from(imageData, "base64");
      const ext = imageMimeType.includes("png") ? ".png" : ".jpg";
      const filename = `ai-${crypto.randomUUID()}${ext}`;
      const filePath = path.join(IMAGE_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const { thumbnail, width, height } = await generateThumbnail(buffer);

      const [inserted] = await db.insert(imageStudioImages).values({
        fileName: `AI: ${trimmedPrompt.slice(0, 60)}`,
        category: category || "Generated",
        tags: [...(tags || []), "AI Generated"].filter((v: any, i: any, a: any) => a.indexOf(v) === i),
        description: trimmedPrompt,
        source: "ai-generated",
        area: area || null,
        mimeType: imageMimeType,
        fileSize: buffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
      }).returning();

      res.json(inserted);
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
      if (!image.localPath || !fs.existsSync(image.localPath)) return res.status(400).json({ error: "Image file not found" });

      const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
      if (!apiKey || !baseUrl) return res.status(500).json({ error: "AI not configured" });

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });

      const imageBuffer = fs.readFileSync(image.localPath);
      const base64 = imageBuffer.toString("base64");
      const inputMime = image.mimeType || "image/jpeg";

      const fullPrompt = `Edit this image: ${trimmedEdit}. Keep the overall composition and quality. Professional property photography standard.`;

      const MODELS = ["gemini-2.5-flash-preview-image", "gemini-2.5-flash-image", "gemini-2.0-flash-exp"];
      let resultData: string | null = null;
      let resultMime = "image/png";

      for (const model of MODELS) {
        try {
          console.log(`[image-studio] AI edit: trying ${model}`);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 90000);
          try {
            const response = await ai.models.generateContent({
              model,
              contents: [{
                role: "user",
                parts: [
                  { inlineData: { mimeType: inputMime, data: base64 } },
                  { text: fullPrompt },
                ],
              }],
              config: { responseModalities: [Modality.TEXT, Modality.IMAGE], abortSignal: controller.signal as any },
            });
            clearTimeout(timeout);

            if (response && typeof response === "object" && "candidates" in response) {
              const candidate = (response as any).candidates?.[0];
              const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
              if (imagePart?.inlineData?.data) {
                resultData = imagePart.inlineData.data;
                resultMime = imagePart.inlineData.mimeType || "image/png";
                console.log(`[image-studio] AI edit: success with ${model}`);
                break;
              }
            }
            console.log(`[image-studio] AI edit: ${model} returned no image`);
          } catch (innerErr: any) {
            clearTimeout(timeout);
            throw innerErr;
          }
        } catch (err: any) {
          const msg = err?.message || "";
          if (msg.includes("UNSUPPORTED_MODEL") || msg.includes("not supported") || msg.includes("not found") || msg.includes("abort")) continue;
          throw err;
        }
      }

      if (!resultData) return res.status(500).json({ error: "AI editing failed — no model returned a result" });

      const buffer = Buffer.from(resultData, "base64");
      const ext = resultMime.includes("png") ? ".png" : ".jpg";
      const filename = `edited-${crypto.randomUUID()}${ext}`;
      const filePath = path.join(IMAGE_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const { thumbnail, width, height } = await generateThumbnail(buffer);

      const [inserted] = await db.insert(imageStudioImages).values({
        fileName: `Edit: ${trimmedEdit.slice(0, 50)} (from ${image.fileName})`,
        category: image.category || "Generated",
        tags: [...(image.tags || []), "AI Edited"].filter((v: any, i: any, a: any) => a.indexOf(v) === i),
        description: `AI edit of "${image.fileName}": ${trimmedEdit}`,
        source: "ai-edited",
        area: image.area,
        mimeType: resultMime,
        fileSize: buffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
        propertyId: image.propertyId,
      }).returning();

      res.json(inserted);
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

      if (!image.localPath || !fs.existsSync(image.localPath)) {
        return res.status(400).json({ error: "Image file not found" });
      }

      const imageBuffer = fs.readFileSync(image.localPath);
      const base64 = imageBuffer.toString("base64");
      const mediaType = image.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic();

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
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
      fs.writeFileSync(filePath, buffer);

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
      fs.writeFileSync(filePath, buffer);

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

  app.get("/api/image-studio/sync-status", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    res.json({
      running: imageSyncRunning,
      progress: imageSyncProgress,
      lastRun: imageSyncLastRun,
    });
  });

  app.post("/api/image-studio/trigger-sync", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    if (imageSyncRunning) return res.json({ message: "Sync already in progress" });
    res.json({ message: "Sync started" });
    runImageSync().catch(e => console.error("[image-sync] Manual sync error:", e.message));
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
  driveId: string, itemId: string, token: string, basePath: string, maxDepth: number, depth: number
): Promise<ImageResult[]> {
  if (depth >= maxDepth) return [];
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,webUrl,id,file,folder`;

  let data: any;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn(`[image-sync] Access denied browsing ${basePath} (${res.status})`);
      }
      return [];
    }
    data = await res.json();
  } catch (fetchErr: any) {
    console.warn(`[image-sync] Network error browsing ${basePath}: ${fetchErr.message}`);
    return [];
  }

  const results: ImageResult[] = [];
  const children = data.value || [];

  for (const child of children) {
    const childPath = basePath ? `${basePath}/${child.name}` : child.name;
    if (child.folder) {
      imageScanFoldersChecked++;
      if (imageScanFoldersChecked % 50 === 0) {
        console.log(`[image-sync] Scanning... ${imageScanFoldersChecked} folders checked, ${imageScanImagesFound} images found so far`);
        imageSyncProgress = `Scanning: ${imageScanFoldersChecked} folders, ${imageScanImagesFound} images`;
      }
      const sub = await browseForImages(driveId, child.id, token, childPath, maxDepth, depth + 1);
      results.push(...sub);
    } else {
      const ext = path.extname(child.name).toLowerCase();
      if (IMAGE_EXTENSIONS.includes(ext) && (child.size || 0) > 10000 && (child.size || 0) < 50 * 1024 * 1024) {
        results.push({ name: child.name, path: childPath, size: child.size, driveId, itemId: child.id, webUrl: child.webUrl });
        imageScanImagesFound++;
      }
    }
  }

  if (data["@odata.nextLink"]) {
    try {
      const nextRes = await fetch(data["@odata.nextLink"], { headers: { Authorization: `Bearer ${token}` } });
      if (nextRes.ok) {
        const nextData = await nextRes.json();
        for (const child of nextData.value || []) {
          const childPath = basePath ? `${basePath}/${child.name}` : child.name;
          if (child.folder) {
            imageScanFoldersChecked++;
            const sub = await browseForImages(driveId, child.id, token, childPath, maxDepth, depth + 1);
            results.push(...sub);
          } else {
            const ext = path.extname(child.name).toLowerCase();
            if (IMAGE_EXTENSIONS.includes(ext) && (child.size || 0) > 10000 && (child.size || 0) < 50 * 1024 * 1024) {
              results.push({ name: child.name, path: childPath, size: child.size, driveId, itemId: child.id, webUrl: child.webUrl });
              imageScanImagesFound++;
            }
          }
        }
      }
    } catch {}
  }

  return results;
}

async function runImageSync() {
  if (imageSyncRunning) return;
  imageSyncRunning = true;
  imageSyncProgress = "Starting...";
  imageScanFoldersChecked = 0;
  imageScanImagesFound = 0;
  console.log("[image-sync] Starting SharePoint image sync...");

  let totalImported = 0, totalSkipped = 0, totalErrors = 0;

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
        console.log(`[image-sync] Scanning ${folder.name} for images...`);
        const images = await browseForImages(driveId, folderId, token, folder.name, 10, 0);
        console.log(`[image-sync] Found ${images.length} images in ${folder.name}`);

        for (const img of images) {
          try {
            const existing = await pool.query(
              "SELECT id FROM image_studio_images WHERE sharepoint_drive_id = $1 AND sharepoint_item_id = $2",
              [img.driveId, img.itemId]
            );
            if (existing.rows.length > 0) { totalSkipped++; continue; }

            const wasDeleted = await pool.query(
              "SELECT id FROM deleted_sharepoint_images WHERE sharepoint_drive_id = $1 AND sharepoint_item_id = $2",
              [img.driveId, img.itemId]
            );
            if (wasDeleted.rows.length > 0) { totalSkipped++; continue; }

            const dupeByName = await pool.query(
              "SELECT id FROM image_studio_images WHERE file_name = $1 AND file_size = $2",
              [img.name, img.size]
            );
            if (dupeByName.rows.length > 0) { totalSkipped++; continue; }

            imageSyncProgress = `Importing: ${img.name} (${totalImported} saved)`;
            const contentRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${img.driveId}/items/${img.itemId}/content`, {
              headers: { Authorization: `Bearer ${token}` }, redirect: "follow"
            });
            if (!contentRes.ok) { totalErrors++; continue; }

            const buffer = Buffer.from(await contentRes.arrayBuffer());
            const ext = path.extname(img.name).toLowerCase();
            const filename = `sp-${crypto.randomUUID().slice(0, 8)}${ext}`;
            const filePath = path.join(IMAGE_DIR, filename);
            fs.writeFileSync(filePath, buffer);

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
              console.log(`[image-sync] Progress: ${totalImported} imported, ${totalSkipped} skipped, ${totalErrors} errors`);
            }
          } catch (err: any) {
            console.error(`[image-sync] Error importing ${img.name}:`, err.message);
            totalErrors++;
          }
        }
        console.log(`[image-sync] ${folder.name} done: imported=${totalImported}, skipped=${totalSkipped}`);
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
      skipped: totalSkipped,
      errors: totalErrors,
    };
    console.log(`[image-sync] Complete: imported=${totalImported}, skipped=${totalSkipped}, errors=${totalErrors}`);
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
