import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { db } from "./db";
import { imageStudioImages, imageStudioCollections, imageStudioCollectionImages, propertyImageryAssets } from "@shared/schema";

// Image kinds accepted on the property_imagery_assets row when a capture
// or upload is linked to a property. Mirrors ImageryKind in property-imagery.ts.
const ALL_KINDS = [
  "hero", "internal", "secondary_external",
  "location_plan", "floor_plan", "covenant_card",
  "comps_chart", "erv_walk", "overlay",
] as const;
import { eq, desc, ilike, or, sql, inArray, count, and } from "drizzle-orm";
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

async function editWithOpenAI(prompt: string, imageBuffer: Buffer, inputMime: string): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const openai = new OpenAI({ apiKey });
    const { toFile } = await import("openai");
    const ext = inputMime.includes("png") ? "png" : inputMime.includes("webp") ? "webp" : "jpg";
    const file = await toFile(imageBuffer, `source.${ext}`, { type: inputMime });
    console.log(`[image-studio] OpenAI edit: trying gpt-image-1`);
    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: file,
      prompt,
      n: 1,
      size: "auto" as any,
    });
    const b64 = response?.data?.[0]?.b64_json;
    if (b64) {
      console.log(`[image-studio] OpenAI edit: success with gpt-image-1`);
      return Buffer.from(b64, "base64");
    }
    return null;
  } catch (e: any) {
    console.warn("[image-studio] OpenAI edit failed:", e?.message);
    return null;
  }
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

export async function readPersistedImage(localPath: string | null | undefined): Promise<Buffer | null> {
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
  // CRM linkage columns added later — keep existing rows untouched.
  await pool.query(`ALTER TABLE image_studio_collections ADD COLUMN IF NOT EXISTS property_id VARCHAR`);
  await pool.query(`ALTER TABLE image_studio_collections ADD COLUMN IF NOT EXISTS company_id VARCHAR`);
  await pool.query(`ALTER TABLE image_studio_collections ADD COLUMN IF NOT EXISTS kind TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_collections_property ON image_studio_collections (property_id) WHERE property_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_collections_company ON image_studio_collections (company_id) WHERE company_id IS NOT NULL`);
  // One-shot backfill: every existing "Pathway · ..." collection inherits
  // the propertyId from the majority of its images (which always carry
  // it). Safe to re-run — only updates rows where property_id IS NULL.
  await pool.query(`
    UPDATE image_studio_collections c
    SET property_id = sub.property_id,
        kind = COALESCE(c.kind, 'pathway')
    FROM (
      SELECT ci.collection_id, i.property_id, COUNT(*) AS n,
             ROW_NUMBER() OVER (PARTITION BY ci.collection_id ORDER BY COUNT(*) DESC) AS rn
      FROM image_studio_collection_images ci
      JOIN image_studio_images i ON i.id = ci.image_id
      WHERE i.property_id IS NOT NULL
      GROUP BY ci.collection_id, i.property_id
    ) sub
    WHERE c.id = sub.collection_id AND sub.rn = 1 AND c.property_id IS NULL AND c.name LIKE 'Pathway · %'
  `).catch((e: any) => console.warn("[image-studio] pathway backfill skipped:", e?.message));
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
  try {
    // Match auth.ts: admin if is_admin=true OR email is in ADMIN_EMAILS.
    // Without the email fallback, a user gated by email-only admin could
    // load image-studio (other routes use auth.ts requireAdmin) but get
    // 403 on bulk-categorize / bulk-tag / etc.
    const { ADMIN_EMAILS } = await import("./auth");
    const result = await pool.query("SELECT is_admin, email FROM users WHERE id = $1", [userId]);
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: "Not authenticated" });
    const emailMatches = (ADMIN_EMAILS as Set<string>).has(String(row.email || "").toLowerCase().trim());
    if (!row.is_admin && !emailMatches) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch (e: any) {
    console.error("[image-studio requireAdmin] DB check failed:", e?.message);
    res.status(500).json({ error: "Auth check failed", detail: e?.message });
  }
}

// ─── Stage 8 bulk image sweep ─────────────────────────────────────────────
// Runs after the business plan and Excel model are agreed. Harvests Google
// Places photos of the building + neighbours and any embedded images from
// uploaded brochures, then files them into three named collections on the
// run: Building / Tenants / Area. Street View auto-capture was removed —
// it filled folders with low-quality drive-by shots; users can grab a
// specific Street View via the manual capture button in Image Studio if
// they actually want one.

type StoredImage = { id: string; localPath: string };

export async function storeImageFromBuffer(args: {
  buffer: Buffer;
  fileName: string;
  category: string;
  tags: string[];
  description: string;
  source: string;
  propertyId?: string | null;
  /**
   * FK into crm_companies. Set this for any brand / landlord-attributed
   * image so the Image Studio can filter by company without falling
   * back on brand_name string matching.
   */
  companyId?: string | null;
  address?: string;
  brandName?: string;
  mimeType?: string;
  filenameHint?: string;
}): Promise<StoredImage> {
  const ext = (args.mimeType || "image/jpeg").includes("png") ? ".png" : ".jpg";
  const safeHint = (args.filenameHint || args.fileName).replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `${args.source}-${safeHint}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const filePath = path.join(IMAGE_DIR, filename);
  await persistImage(filePath, args.buffer, args.mimeType || "image/jpeg", args.fileName);
  const { thumbnail, width, height } = await generateThumbnail(args.buffer);
  const [inserted] = await db.insert(imageStudioImages).values({
    fileName: args.fileName,
    category: args.category,
    tags: args.tags,
    description: args.description,
    source: args.source,
    propertyId: args.propertyId || undefined,
    companyId: args.companyId || undefined,
    address: args.address,
    brandName: args.brandName,
    mimeType: args.mimeType || "image/jpeg",
    fileSize: args.buffer.length,
    width,
    height,
    thumbnailData: thumbnail,
    localPath: filePath,
  }).returning();
  return { id: inserted.id, localPath: filePath };
}

async function ensureRunCollection(args: {
  runId: string;
  address: string;
  bucket: "Building" | "Tenants" | "Area";
  propertyId?: string | null;
  userId?: string;
}): Promise<string> {
  const name = `Pathway · ${args.address} · ${args.bucket}`;
  const existing = await db.select().from(imageStudioCollections)
    .where(eq(imageStudioCollections.name, name)).limit(1);
  if (existing[0]?.id) {
    // Backfill propertyId on existing rows once we know it — older runs
    // pre-date the CRM link and would otherwise stay orphaned.
    if (args.propertyId && !existing[0].propertyId) {
      await pool.query(
        `UPDATE image_studio_collections SET property_id = $1, kind = COALESCE(kind, 'pathway') WHERE id = $2`,
        [args.propertyId, existing[0].id]
      );
    }
    return existing[0].id;
  }
  const [created] = await db.insert(imageStudioCollections).values({
    name,
    description: `Auto-created for property pathway run ${args.runId} (${args.bucket})`,
    propertyId: args.propertyId || undefined,
    kind: "pathway",
    createdBy: args.userId || undefined,
  }).returning();
  return created.id;
}

// Brand auto-folder — created when a company has 2+ images so the logo
// stops being the sole marker. Cover defaults to the first image tagged
// 'logo' (or just the first image, if no logo is on file yet).
export async function ensureBrandCollection(args: {
  companyId: string;
  brandName: string;
  userId?: string;
}): Promise<string | null> {
  if (!args.companyId) return null;
  const name = `Brand · ${args.brandName}`;
  const existing = await db.select().from(imageStudioCollections)
    .where(eq(imageStudioCollections.companyId, args.companyId)).limit(1);
  if (existing[0]?.id) return existing[0].id;

  // Pick a sensible cover: prefer a logo, fall back to oldest image.
  const coverRow = await pool.query(
    `SELECT id FROM image_studio_images
     WHERE company_id = $1
     ORDER BY
       CASE WHEN 'logo' = ANY(LOWER(ARRAY(SELECT lower(t) FROM unnest(tags) AS t))::text[]) THEN 0
            WHEN category = 'Brands' THEN 1
            ELSE 2 END,
       created_at ASC
     LIMIT 1`,
    [args.companyId]
  ).catch(() => ({ rows: [] as any[] }));
  const coverImageId = coverRow.rows[0]?.id || null;

  const [created] = await db.insert(imageStudioCollections).values({
    name,
    description: `Auto-created brand folder for ${args.brandName}.`,
    coverImageId: coverImageId || undefined,
    companyId: args.companyId,
    kind: "brand",
    createdBy: args.userId || undefined,
  }).returning();
  return created.id;
}

// Wrapper: when an image is saved with companyId set, ensure the brand
// folder exists (only once the company has 2+ images — single-logo
// companies don't need a folder yet) and add this image to it.
export async function maybeAddToBrandCollection(args: {
  imageId: string;
  companyId: string;
  brandName?: string | null;
  userId?: string;
}): Promise<{ collectionId: string | null; created: boolean }> {
  if (!args.companyId) return { collectionId: null, created: false };
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n, MAX(brand_name) AS brand FROM image_studio_images WHERE company_id = $1`,
    [args.companyId]
  );
  const count = countRes.rows[0]?.n || 0;
  if (count < 2) return { collectionId: null, created: false }; // logo-only, no folder yet
  const resolvedBrand = args.brandName || countRes.rows[0]?.brand || "Brand";
  const before = await db.select().from(imageStudioCollections)
    .where(eq(imageStudioCollections.companyId, args.companyId)).limit(1);
  const wasNew = !before[0];
  const collectionId = await ensureBrandCollection({ companyId: args.companyId, brandName: resolvedBrand, userId: args.userId });
  if (!collectionId) return { collectionId: null, created: false };
  // Add the just-saved image; if folder is brand-new, also retroactively
  // add every other image for this company so the folder is complete.
  if (wasNew) {
    const all = await pool.query(`SELECT id FROM image_studio_images WHERE company_id = $1`, [args.companyId]);
    for (const r of all.rows) {
      await pool.query(
        `INSERT INTO image_studio_collection_images (collection_id, image_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [collectionId, r.id]
      ).catch(() => {});
    }
  } else {
    await pool.query(
      `INSERT INTO image_studio_collection_images (collection_id, image_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [collectionId, args.imageId]
    ).catch(() => {});
  }
  return { collectionId, created: wasNew };
}

async function addImagesToCollection(collectionId: string, imageIds: string[]): Promise<number> {
  let added = 0;
  for (const imageId of imageIds) {
    try {
      const r = await pool.query(
        `INSERT INTO image_studio_collection_images (collection_id, image_id) VALUES ($1, $2) ON CONFLICT (collection_id, image_id) DO NOTHING`,
        [collectionId, imageId],
      );
      if ((r.rowCount ?? 0) > 0) added++;
    } catch {}
  }
  return added;
}

async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number; placeId?: string } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(address)}&inputtype=textquery&fields=geometry,place_id,formatted_address&locationbias=circle:50000@51.5074,-0.1278&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data: any = await r.json();
    const c = data?.candidates?.[0];
    if (!c?.geometry?.location) return null;
    return { lat: c.geometry.location.lat, lng: c.geometry.location.lng, placeId: c.place_id };
  } catch {
    return null;
  }
}

async function placeDetailsPhotos(placeId: string, apiKey: string, max = 15): Promise<string[]> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data: any = await r.json();
    const refs: string[] = (data?.result?.photos || []).map((p: any) => p.photo_reference).filter(Boolean);
    return refs.slice(0, max);
  } catch {
    return [];
  }
}

async function placePhotoBuffer(photoReference: string, apiKey: string): Promise<Buffer | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1200&photo_reference=${photoReference}&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function findPlaceByText(query: string, apiKey: string, bias?: { lat: number; lng: number; radiusM?: number }): Promise<{ placeId: string; name: string; lat: number; lng: number } | null> {
  try {
    const locationBias = bias
      ? `circle:${bias.radiusM ?? 300}@${bias.lat},${bias.lng}`
      : `circle:50000@51.5074,-0.1278`;
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=geometry,place_id,name&locationbias=${locationBias}&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data: any = await r.json();
    const c = data?.candidates?.[0];
    if (!c?.place_id) return null;
    return {
      placeId: c.place_id,
      name: c.name || query,
      lat: c.geometry?.location?.lat || 0,
      lng: c.geometry?.location?.lng || 0,
    };
  } catch {
    return null;
  }
}

async function nearbyPlaces(lat: number, lng: number, apiKey: string, radius = 80, limit = 6): Promise<Array<{ placeId: string; name: string; lat: number; lng: number; types: string[] }>> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data: any = await r.json();
    const results = (data?.results || []) as any[];
    return results.slice(0, limit).map((p: any) => ({
      placeId: p.place_id,
      name: p.name,
      lat: p.geometry?.location?.lat || 0,
      lng: p.geometry?.location?.lng || 0,
      types: p.types || [],
    }));
  } catch {
    return [];
  }
}

export async function sweepStage8ImagesForRun(args: {
  runId: string;
  address: string;
  postcode?: string;
  propertyId?: string | null;
  tenantNames?: string[];
  userId?: string;
  brochurePdfs?: Array<{ name: string; buffer: Buffer; webUrl?: string }>;
}): Promise<{
  buildingCollectionId?: string;
  tenantsCollectionId?: string;
  areaCollectionId?: string;
  imagesAdded: number;
  collections: Array<{ id: string; name: string; bucket: "building" | "tenants" | "area"; imageCount: number }>;
}> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn("[pathway sweep] GOOGLE_API_KEY missing — Stage 8 image sweep skipped");
    return { imagesAdded: 0, collections: [] };
  }

  await ensureTable().catch(() => {});

  const [buildingId, tenantsId, areaId] = await Promise.all([
    ensureRunCollection({ runId: args.runId, address: args.address, bucket: "Building", propertyId: args.propertyId, userId: args.userId }),
    ensureRunCollection({ runId: args.runId, address: args.address, bucket: "Tenants", propertyId: args.propertyId, userId: args.userId }),
    ensureRunCollection({ runId: args.runId, address: args.address, bucket: "Area", propertyId: args.propertyId, userId: args.userId }),
  ]);

  const buildingImages: string[] = [];
  const tenantImages: string[] = [];
  const areaImages: string[] = [];

  const geo = await geocodeAddress(args.address, apiKey);

  // ─── Building: Places photos of the building ────────────────────────────
  if (geo?.placeId) {
    const refs = await placeDetailsPhotos(geo.placeId, apiKey, 15);
    let idx = 0;
    for (const ref of refs) {
      idx++;
      const buf = await placePhotoBuffer(ref, apiKey);
      if (!buf) continue;
      try {
        const stored = await storeImageFromBuffer({
          buffer: buf,
          fileName: `Place photo ${idx} — ${args.address}`,
          category: "Places",
          // Google building photos are overwhelmingly interior; tag as such
          // so Why Buy / Image Studio filters can favour brochure exteriors.
          tags: ["Google Places", "Building", "Interior-likely", "pathway"],
          description: `Google Places photo ${idx} of ${args.address} (auto — pathway Stage 8).`,
          source: "places",
          propertyId: args.propertyId,
          address: args.address,
          filenameHint: `${args.address}-place-${idx}`,
        });
        buildingImages.push(stored.id);
      } catch {}
    }
  }

  // ─── Tenants: Places photos of flagship stores ──────────────────────────
  const uniqueTenants = Array.from(new Set((args.tenantNames || []).map(t => t.trim()).filter(t => t && t.length > 1)));
  for (const tenant of uniqueTenants.slice(0, 6)) {
    // Places findplace → photos. Bias the search to the subject building so
    // we resolve the correct branch (e.g. the Haymarket Pret, not a Pret 5
    // miles away).
    try {
      const bias = geo ? { lat: geo.lat, lng: geo.lng, radiusM: 250 } : undefined;
      const place = await findPlaceByText(`${tenant}`, apiKey, bias)
        || await findPlaceByText(`${tenant} ${args.address}`, apiKey, bias)
        || await findPlaceByText(`${tenant} London`, apiKey);
      if (place?.placeId) {
        // Up to 4 Places photos (was 2) — actual store shots.
        const refs = await placeDetailsPhotos(place.placeId, apiKey, 4);
        let idx = 0;
        for (const ref of refs) {
          idx++;
          const buf = await placePhotoBuffer(ref, apiKey);
          if (!buf) continue;
          const stored = await storeImageFromBuffer({
            buffer: buf,
            fileName: `${tenant} — Store photo ${idx}`,
            category: "Places",
            tags: ["Google Places", "Tenant", "Brand", tenant, `brand:${tenant}`, "pathway"],
            description: `Google Places photo of ${place.name} (tenant: ${tenant}) — pathway Stage 8.`,
            source: "places",
            propertyId: args.propertyId,
            brandName: tenant,
            filenameHint: `${tenant}-place-${idx}`,
          });
          tenantImages.push(stored.id);
        }
      }
    } catch (err: any) {
      console.warn(`[pathway sweep] Places ${tenant} failed:`, err?.message);
    }
  }

  // ─── Area: nearby place photos ──────────────────────────────────────────
  if (geo) {
    const neighbours = await nearbyPlaces(geo.lat, geo.lng, apiKey, 80, 6);
    for (const p of neighbours) {
      // skip the building's own place_id
      if (p.placeId === geo.placeId) continue;
      const refs = await placeDetailsPhotos(p.placeId, apiKey, 1);
      for (const ref of refs) {
        const buf = await placePhotoBuffer(ref, apiKey);
        if (!buf) continue;
        try {
          const stored = await storeImageFromBuffer({
            buffer: buf,
            fileName: `${p.name} — nearby`,
            category: "Places",
            tags: ["Google Places", "Area", "Neighbour", "pathway"],
            description: `Nearby: ${p.name} (${p.types.slice(0, 3).join(", ")}) — pathway Stage 8.`,
            source: "places",
            propertyId: args.propertyId,
            filenameHint: p.name,
          });
          areaImages.push(stored.id);
        } catch {}
      }
    }
  }

  // ─── Brochures: extract embedded images from PDFs via poppler ───────────
  if (args.brochurePdfs?.length) {
    try {
      const { extractImagesFromPdf } = await import("./pdf-image-extract");
      for (const bro of args.brochurePdfs.slice(0, 6)) {
        try {
          const extracted = await extractImagesFromPdf({ pdfBuffer: bro.buffer, maxImages: 20, minBytes: 15_000 });
          console.log(`[pathway sweep] brochure "${bro.name}" → ${extracted.length} images`);
          for (const img of extracted) {
            try {
              const stored = await storeImageFromBuffer({
                buffer: img.buffer,
                fileName: `${bro.name} — ${img.filename}`,
                category: "Brochures",
                tags: ["Brochure", "PDF-extract", "Building", "pathway"],
                description: `Extracted from brochure "${bro.name}"${bro.webUrl ? ` (${bro.webUrl})` : ""} — pathway Stage 8.`,
                source: "brochure",
                propertyId: args.propertyId,
                address: args.address,
                mimeType: img.mimeType,
                filenameHint: `${bro.name}-${img.filename}`,
              });
              buildingImages.push(stored.id);
            } catch (err: any) {
              console.warn(`[pathway sweep] brochure store failed:`, err?.message);
            }
          }
        } catch (err: any) {
          console.warn(`[pathway sweep] brochure extract failed for "${bro.name}":`, err?.message);
        }
      }
    } catch (err: any) {
      console.warn("[pathway sweep] pdf-image-extract unavailable:", err?.message);
    }
  }

  const [buildingAdded, tenantAdded, areaAdded] = await Promise.all([
    addImagesToCollection(buildingId, buildingImages),
    addImagesToCollection(tenantsId, tenantImages),
    addImagesToCollection(areaId, areaImages),
  ]);

  const collections: Array<{ id: string; name: string; bucket: "building" | "tenants" | "area"; imageCount: number }> = [
    { id: buildingId, name: `Pathway · ${args.address} · Building`, bucket: "building", imageCount: buildingImages.length },
    { id: tenantsId,  name: `Pathway · ${args.address} · Tenants`,  bucket: "tenants",  imageCount: tenantImages.length },
    { id: areaId,     name: `Pathway · ${args.address} · Area`,     bucket: "area",     imageCount: areaImages.length },
  ];

  console.log(`[pathway sweep] Stage 8 complete: Building ${buildingAdded}, Tenants ${tenantAdded}, Area ${areaAdded}`);

  return {
    buildingCollectionId: buildingId,
    tenantsCollectionId: tenantsId,
    areaCollectionId: areaId,
    imagesAdded: buildingAdded + tenantAdded + areaAdded,
    collections,
  };
}

export function registerImageStudioRoutes(app: Express) {
  ensureTable().catch(err => console.error("[image-studio] Table setup error:", err.message));

  // List images — DOES NOT return thumbnail_data (a base64 column that runs
  // 5-10KB per row and balloons the response into multi-MB territory once
  // the library has more than a few hundred images). The client fetches
  // thumbnails individually via /api/image-studio/:id/thumb, which the
  // browser then HTTP-caches.
  const LIST_COLS = {
    id: imageStudioImages.id,
    fileName: imageStudioImages.fileName,
    category: imageStudioImages.category,
    tags: imageStudioImages.tags,
    description: imageStudioImages.description,
    source: imageStudioImages.source,
    propertyId: imageStudioImages.propertyId,
    companyId: imageStudioImages.companyId,
    area: imageStudioImages.area,
    address: imageStudioImages.address,
    brandName: imageStudioImages.brandName,
    brandSector: imageStudioImages.brandSector,
    propertyType: imageStudioImages.propertyType,
    mimeType: imageStudioImages.mimeType,
    fileSize: imageStudioImages.fileSize,
    width: imageStudioImages.width,
    height: imageStudioImages.height,
    sharepointItemId: imageStudioImages.sharepointItemId,
    sharepointDriveId: imageStudioImages.sharepointDriveId,
    localPath: imageStudioImages.localPath,
    uploadedBy: imageStudioImages.uploadedBy,
    createdAt: imageStudioImages.createdAt,
    hasThumbnail: sql<boolean>`(${imageStudioImages.thumbnailData} IS NOT NULL)`.as("has_thumbnail"),
  };

  app.get("/api/image-studio", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const images = await db.select(LIST_COLS).from(imageStudioImages).orderBy(desc(imageStudioImages.createdAt));
      res.json(images);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/image-studio/search", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || "").trim();
      const companyId = (req.query.companyId as string || "").trim();
      const propertyId = (req.query.propertyId as string || "").trim();
      // Need at least one of: free-text query, companyId, or propertyId.
      // Without any filter we'd return the whole table.
      if (!q && !companyId && !propertyId) return res.json([]);
      const pattern = q ? `%${q}%` : null;
      const conditions: any[] = [];
      if (pattern) {
        conditions.push(or(
          ilike(imageStudioImages.fileName, pattern),
          ilike(imageStudioImages.description, pattern),
          ilike(imageStudioImages.area, pattern),
          ilike(imageStudioImages.category, pattern),
          ilike(imageStudioImages.address, pattern),
          ilike(imageStudioImages.brandName, pattern),
          ilike(imageStudioImages.brandSector, pattern),
          ilike(imageStudioImages.propertyType, pattern),
          sql`${pattern} ILIKE ANY(${imageStudioImages.tags})`,
        ));
      }
      if (companyId) conditions.push(eq(imageStudioImages.companyId, companyId));
      if (propertyId) conditions.push(eq(imageStudioImages.propertyId, propertyId));
      const images = await db.select(LIST_COLS).from(imageStudioImages)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(imageStudioImages.createdAt));
      res.json(images);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve a single image's thumbnail (the base64 JPEG stored in
  // thumbnail_data, decoded). Cached aggressively — the row is small but
  // the trip to Postgres still adds up at scale, so let the browser cache
  // it for a day.
  app.get("/api/image-studio/:id/thumb", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const [row] = await db
        .select({ thumbnailData: imageStudioImages.thumbnailData, mimeType: imageStudioImages.mimeType })
        .from(imageStudioImages)
        .where(eq(imageStudioImages.id, String(req.params.id)));
      if (!row?.thumbnailData) return res.status(404).end();
      const buf = Buffer.from(row.thumbnailData, "base64");
      res.setHeader("Content-Type", row.mimeType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.end(buf);
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
      // Optional: link uploaded files to a CRM property as imagery assets
      // so they appear in the Pathway picker / Property Intelligence
      // imagery tab without a separate Discover step.
      const linkPropertyId = (req.body.propertyId as string) || null;
      const linkKind = (req.body.kind as string) || "secondary_external";

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

        // Link to a CRM property (imagery asset) when caller provided one.
        if (linkPropertyId) {
          try {
            await db.insert(propertyImageryAssets).values({
              propertyId: linkPropertyId,
              kind: ALL_KINDS.includes(linkKind as any) ? linkKind : "secondary_external",
              source: "manual_upload",
              imageStudioId: inserted.id,
              score: 0.6,
              width,
              height,
              caption: file.originalname,
              generatedBy: userId,
            } as any);
          } catch (linkErr: any) {
            console.warn("[image-studio/upload] property_imagery_assets link failed:", linkErr?.message);
          }
        }

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

      const imgBuffer = await readPersistedImage(image.localPath);
      if (imgBuffer) {
        res.setHeader("Content-Type", image.mimeType || "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.end(imgBuffer);
      }

      res.status(404).json({ error: "Image not found" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // MUST be registered before /:id — Express matches in order and "bulk-categorize"
  // would otherwise be captured as an :id parameter.
  app.patch("/api/image-studio/bulk-categorize", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { ids, category } = req.body;
      if (!Array.isArray(ids) || !ids.length || !category) {
        return res.status(400).json({ error: "ids (array) and category (string) required" });
      }
      const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(", ");
      const r = await pool.query(
        `UPDATE image_studio_images SET category = $${ids.length + 1} WHERE id IN (${placeholders})`,
        [...ids, category]
      );
      res.json({ success: true, updated: r.rowCount ?? 0 });
    } catch (e: any) {
      console.error("[image-studio bulk-categorize] failed:", e?.code, e?.message);
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

      // Delete local files (synchronous fs calls — fast)
      for (const image of images) {
        if (image.localPath && fs.existsSync(image.localPath)) {
          try { fs.unlinkSync(image.localPath); } catch {}
        }
      }

      // Batch-insert SharePoint tombstones in one query instead of N round-trips
      const spPairs = images.filter(img => img.sharepointDriveId && img.sharepointItemId);
      if (spPairs.length > 0) {
        const values = spPairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
        const params = spPairs.flatMap(img => [img.sharepointDriveId, img.sharepointItemId]);
        await pool.query(
          `INSERT INTO deleted_sharepoint_images (sharepoint_drive_id, sharepoint_item_id) VALUES ${values} ON CONFLICT (sharepoint_drive_id, sharepoint_item_id) DO NOTHING`,
          params
        );
      }

      // Clean up collection references and delete records — both already batched
      await pool.query(`DELETE FROM image_studio_collection_images WHERE image_id = ANY($1::text[])`, [ids]);
      await db.delete(imageStudioImages).where(inArray(imageStudioImages.id, ids));
      res.json({ success: true, deleted: images.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Dedupe brand logos — keep oldest per brand_name (case-insensitive),
  // delete the rest. Run this manually after a logo.dev import that left
  // duplicate pairs in the library.
  app.post("/api/image-studio/dedupe-brand-logos", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows: dupeIds } = await pool.query<{ id: string; local_path: string | null; sharepoint_drive_id: string | null; sharepoint_item_id: string | null }>(`
        SELECT id, local_path, sharepoint_drive_id, sharepoint_item_id
        FROM image_studio_images
        WHERE brand_name IS NOT NULL AND brand_name <> ''
          AND id NOT IN (
            SELECT DISTINCT ON (lower(trim(brand_name))) id
            FROM image_studio_images
            WHERE brand_name IS NOT NULL AND brand_name <> ''
            ORDER BY lower(trim(brand_name)), created_at ASC
          )
      `);

      if (!dupeIds.length) return res.json({ success: true, deleted: 0, kept: 0 });

      for (const row of dupeIds) {
        if (row.local_path && fs.existsSync(row.local_path)) {
          try { fs.unlinkSync(row.local_path); } catch {}
        }
      }

      const spPairs = dupeIds.filter(r => r.sharepoint_drive_id && r.sharepoint_item_id);
      if (spPairs.length) {
        const values = spPairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
        const params = spPairs.flatMap(r => [r.sharepoint_drive_id, r.sharepoint_item_id]);
        await pool.query(
          `INSERT INTO deleted_sharepoint_images (sharepoint_drive_id, sharepoint_item_id) VALUES ${values} ON CONFLICT (sharepoint_drive_id, sharepoint_item_id) DO NOTHING`,
          params
        );
      }

      const ids = dupeIds.map(r => r.id);
      await pool.query(`DELETE FROM image_studio_collection_images WHERE image_id = ANY($1::text[])`, [ids]);
      await db.delete(imageStudioImages).where(inArray(imageStudioImages.id, ids));

      const { rows: remaining } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM image_studio_images WHERE brand_name IS NOT NULL AND brand_name <> ''`);
      res.json({ success: true, deleted: dupeIds.length, kept: parseInt(remaining[0].count, 10) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Public-ish brand logo lookup — used by Brand Explorer thumbnails.
  // Returns the most recent Image Studio logo for the given brand name.
  // 404 → frontend falls back to Clearbit. Auth required, but not admin.
  app.get("/api/brand-logo/:name", requireAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.params.name || "").trim();
      if (!name) return res.status(400).json({ error: "name required" });
      const domain = String(req.query.domain || "").trim().toLowerCase().replace(/^www\./, "");

      // Build a set of name variants to try matching against. Brand names in
      // crm_companies often have suffixes ("Ltd", "Limited", "Group", "plc")
      // that aren't in the logo library filenames. We strip those and also
      // try the first significant word as a loose fallback.
      const stripped = name.replace(/\b(ltd|limited|group|holdings|plc|inc|llc|llp)\b\.?/gi, "").replace(/\s+/g, " ").trim();
      const firstWord = name.split(/\s+/)[0] || name;
      const variants = Array.from(new Set([name, stripped, firstWord].filter(Boolean).map(s => s.toLowerCase().trim())));

      // Domain stem: "pretamanger.com" → "pretamanger"
      const domainStem = domain ? domain.split(".")[0] : "";

      const { rows } = await pool.query<{ id: string; local_path: string | null; mime_type: string; thumbnail_data: string | null; brand_name: string | null; file_name: string }>(
        `SELECT id, local_path, mime_type, thumbnail_data, brand_name, file_name
         FROM image_studio_images
         WHERE lower(trim(brand_name)) = ANY($1::text[])
            OR (category = 'Brands' AND lower(trim(file_name)) = ANY($1::text[]))
            OR (category = 'Brands' AND lower(file_name) LIKE lower($2) || '%')
            OR (category = 'Brands' AND $3 <> '' AND lower(file_name) LIKE '%' || $3 || '%')
            OR (category = 'Brands' AND $3 <> '' AND lower(trim(brand_name)) LIKE '%' || $3 || '%')
         ORDER BY
           CASE WHEN lower(trim(brand_name)) = lower(trim($4)) THEN 0
                WHEN lower(trim(file_name))  = lower(trim($4)) THEN 1
                WHEN $3 <> '' AND lower(file_name) LIKE $3 || '%' THEN 2
                ELSE 3 END,
           created_at DESC
         LIMIT 1`,
        [variants, name, domainStem, name]
      );

      const row = rows[0];
      if (!row) {
        // No local hit. Redirect to logo.dev (or Google favicons) so the <img>
        // renders something rather than 404. Clearbit's logo API was killed by
        // HubSpot March 2025. If no domain was supplied, slugify the name and
        // guess `<slug>.com` — logo.dev returns a placeholder for unknown
        // domains so the image element always loads.
        let effectiveDomain = domain;
        if (!effectiveDomain) {
          const slug = name
            .toLowerCase()
            .replace(/['']/g, "")
            .replace(/&/g, "and")
            .replace(/\b(ltd|limited|group|holdings|plc|inc|llc|llp|co|company|the)\b/gi, "")
            .replace(/[^a-z0-9]+/g, "")
            .trim();
          if (slug.length >= 3) effectiveDomain = `${slug}.com`;
        }
        if (effectiveDomain) {
          const token = process.env.LOGO_DEV_TOKEN;
          const target = token
            ? `https://img.logo.dev/${encodeURIComponent(effectiveDomain)}?token=${token}&size=256&format=png`
            : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(effectiveDomain)}&sz=128`;
          res.setHeader("Cache-Control", "public, max-age=3600");
          return res.redirect(302, target);
        }
        // Short TTL on the no-logo 404 so we don't get stuck serving stale
        // misses for a day after a fix lands.
        res.setHeader("Cache-Control", "public, max-age=60");
        return res.status(404).json({ error: "no logo" });
      }

      const imgBuffer = await readPersistedImage(row.local_path);
      if (imgBuffer) {
        res.setHeader("Content-Type", row.mime_type || "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.end(imgBuffer);
      }

      if (row.thumbnail_data) {
        const b64Match = row.thumbnail_data.match(/^data:([^;]+);base64,(.+)$/);
        if (b64Match) {
          const buf = Buffer.from(b64Match[2], "base64");
          res.setHeader("Content-Type", b64Match[1]);
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.end(buf);
        }
      }

      // Row exists but the blob is missing/unreadable. Don't 404 — fall through
      // to the same logo.dev redirect path used when there's no row at all.
      let effectiveDomain = domain;
      if (!effectiveDomain) {
        const slug = name
          .toLowerCase()
          .replace(/['']/g, "")
          .replace(/&/g, "and")
          .replace(/\b(ltd|limited|group|holdings|plc|inc|llc|llp|co|company|the)\b/gi, "")
          .replace(/[^a-z0-9]+/g, "")
          .trim();
        if (slug.length >= 3) effectiveDomain = `${slug}.com`;
      }
      if (effectiveDomain) {
        const token = process.env.LOGO_DEV_TOKEN;
        const target = token
          ? `https://img.logo.dev/${encodeURIComponent(effectiveDomain)}?token=${token}&size=256&format=png`
          : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(effectiveDomain)}&sz=128`;
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.redirect(302, target);
      }
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(404).json({ error: "no readable blob" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // One-shot stats — client calls this once per session to decide whether
  // /api/brand-logo/:name is worth hitting at all.
  //
  // Threshold: hasLogos = true once there's at least 1 brand logo. Earlier
  // we had a 50-row threshold to prevent spam when the library was empty;
  // that's no longer needed because (a) 404 responses are now cached by the
  // browser for 24h, (b) /api/brand-logo/* is exempt from the global rate
  // limiter, and (c) access logs are suppressed. So as soon as a single
  // logo lands, surface it.
  app.get("/api/brand-logo-stats", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM image_studio_images
          WHERE category = 'Brands'
            AND brand_name IS NOT NULL
            AND brand_name <> ''`
      );
      const count = Number(rows[0]?.count || 0);
      // No browser cache — used to be 5 min, but that locked in a stale
      // 'hasLogos: false' for users who loaded the page before the bulk
      // logo import ran. UI now always tries the local URL anyway, so
      // this endpoint is mostly informational.
      res.setHeader("Cache-Control", "no-store");
      res.json({ count, hasLogos: count >= 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Diagnostic — for a specific brand row, report which storage paths are
  // populated (disk file? file_storage backup? thumbnailData?). Helps
  // pinpoint why an existing row 404s even though the SQL match found it.
  app.get("/api/brand-logo-row-debug", requireAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.query.name || "").trim();
      if (!name) return res.status(400).json({ error: "name required" });

      const { rows } = await pool.query<{ id: string; local_path: string | null; mime_type: string; thumbnail_data: string | null; file_size: number | null; brand_name: string | null; file_name: string }>(
        `SELECT id, local_path, mime_type, thumbnail_data, file_size, brand_name, file_name
         FROM image_studio_images
         WHERE category = 'Brands' AND lower(trim(brand_name)) = lower(trim($1))
         LIMIT 1`,
        [name]
      );
      const row = rows[0];
      if (!row) return res.json({ matched: false });

      const onDisk = !!row.local_path && fs.existsSync(row.local_path);
      let inFileStorage: any = null;
      if (row.local_path) {
        try {
          const f = await getFile(storageKeyForImage(row.local_path));
          inFileStorage = f ? { size: f.data.length, mimeType: f.mimeType } : null;
        } catch (e: any) {
          inFileStorage = { error: e?.message };
        }
      }
      const thumbStartsWithData = !!(row.thumbnail_data && row.thumbnail_data.startsWith("data:"));
      const thumbLength = row.thumbnail_data ? row.thumbnail_data.length : 0;
      const thumbHead = row.thumbnail_data ? row.thumbnail_data.slice(0, 50) : null;

      res.json({
        matched: true,
        row: {
          id: row.id,
          brand_name: row.brand_name,
          file_name: row.file_name,
          mime_type: row.mime_type,
          file_size: row.file_size,
          local_path: row.local_path,
        },
        on_disk: onDisk,
        in_file_storage: inFileStorage,
        thumbnail: {
          present: !!row.thumbnail_data,
          starts_with_data_url: thumbStartsWithData,
          length: thumbLength,
          head: thumbHead,
        },
        verdict: onDisk
          ? "ok-disk"
          : inFileStorage
            ? "ok-file-storage-fallback"
            : thumbStartsWithData
              ? "ok-thumbnail-fallback"
              : "NO BYTES — row exists but no readable image. Re-import needed.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Diagnostic — shows what's in the brand library and whether a given name
  // matches anything. Hit /api/brand-logo-debug?name=Pret to test from the
  // browser. Auth required, but anyone can use.
  app.get("/api/brand-logo-debug", requireAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.query.name || "").trim();
      const domain = String(req.query.domain || "").trim().toLowerCase().replace(/^www\./, "");

      const { rows: counts } = await pool.query<{ total: string; with_brand_name: string; brands_category: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE brand_name IS NOT NULL AND brand_name <> '')::text AS with_brand_name,
           COUNT(*) FILTER (WHERE category = 'Brands')::text AS brands_category
         FROM image_studio_images`
      );

      const { rows: samples } = await pool.query<{ brand_name: string | null; file_name: string; category: string | null; created_at: string }>(
        `SELECT brand_name, file_name, category, created_at
         FROM image_studio_images
         WHERE category = 'Brands' OR (brand_name IS NOT NULL AND brand_name <> '')
         ORDER BY created_at DESC
         LIMIT 10`
      );

      let matchInfo: any = null;
      if (name) {
        const stripped = name.replace(/\b(ltd|limited|group|holdings|plc|inc|llc|llp)\b\.?/gi, "").replace(/\s+/g, " ").trim();
        const firstWord = name.split(/\s+/)[0] || name;
        const variants = Array.from(new Set([name, stripped, firstWord].filter(Boolean).map(s => s.toLowerCase().trim())));
        const domainStem = domain ? domain.split(".")[0] : "";

        const { rows: matches } = await pool.query<{ id: string; brand_name: string | null; file_name: string; category: string | null }>(
          `SELECT id, brand_name, file_name, category
           FROM image_studio_images
           WHERE lower(trim(brand_name)) = ANY($1::text[])
              OR (category = 'Brands' AND lower(trim(file_name)) = ANY($1::text[]))
              OR (category = 'Brands' AND lower(file_name) LIKE lower($2) || '%')
              OR (category = 'Brands' AND $3 <> '' AND lower(file_name) LIKE '%' || $3 || '%')
              OR (category = 'Brands' AND $3 <> '' AND lower(trim(brand_name)) LIKE '%' || $3 || '%')
           LIMIT 5`,
          [variants, name, domainStem]
        );
        matchInfo = { variants, domainStem, matches };
      }

      res.json({
        counts: counts[0],
        samples,
        query: { name, domain },
        match: matchInfo,
      });
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

  app.post("/api/image-studio/ai-edit", requireAuth, async (req: Request, res: Response) => {
    try {
      const { imageId, editPrompt, preferProvider } = req.body;
      const trimmedEdit = (editPrompt || "").trim();
      if (!imageId || !trimmedEdit) return res.status(400).json({ error: "imageId and editPrompt required" });
      if (trimmedEdit.length > 1000) return res.status(400).json({ error: "Edit prompt too long (max 1000 characters)" });
      // Caller can prefer 'gemini' (default — most pixel-faithful) or
      // 'openai' (gpt-image-1, stronger at instruction-following for
      // compositional adds like "place stalls along the street").
      const preferred = (typeof preferProvider === "string" ? preferProvider : "gemini").toLowerCase();

      const userId = req.session?.userId || (req as any).tokenUserId;

      const [image] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, imageId));
      if (!image) return res.status(404).json({ error: "Image not found" });
      // Team-shared imagery (property captures, etc.) — anyone signed in can iterate.
      const sourceBuffer = await readPersistedImage(image.localPath);
      if (!sourceBuffer) return res.status(400).json({ error: "Image file not found. The original image was lost on a deploy — re-capture / re-upload the source image and try again." });

      // Save undo snapshot (normalised to PNG) so the user can revert this edit
      const undoPath = path.join(IMAGE_DIR, `undo-${imageId}.png`);
      const undoBuffer = (image.mimeType === "image/png") ? sourceBuffer : await sharp(sourceBuffer).png().toBuffer();
      fs.writeFileSync(undoPath, undoBuffer);

      const base64 = sourceBuffer.toString("base64");
      const inputMime = image.mimeType || "image/jpeg";

      const fullPrompt = `Edit this specific photograph: ${trimmedEdit}. PRESERVE the exact building, composition, and architectural details — only apply the requested edit. Professional property photography standard.`;

      // Two real image-to-image providers — Gemini (pixel-faithful, cheap)
      // and OpenAI gpt-image-1 (stronger at compositional/instruction-led
      // adds like "add festoon lighting and outdoor tables"). Caller's
      // preferProvider picks which goes first; the other is the fallback.
      // DALL-E 3 is deliberately not in this chain — it's text-to-image
      // and regenerated entirely new buildings ('mad different buildings'
      // bug). Local Sharp is a last-resort polish for generic edits.
      let resultBuffer: Buffer | null = null;
      let provider = "unknown";

      const tryGemini = async () => {
        console.log("[image-studio] AI edit: trying Gemini...");
        const r = await editWithGemini(fullPrompt, base64, inputMime);
        if (r) provider = "gemini";
        return r;
      };
      const tryOpenAI = async () => {
        console.log("[image-studio] AI edit: trying OpenAI gpt-image-1...");
        const r = await editWithOpenAI(fullPrompt, sourceBuffer, inputMime);
        if (r) provider = "openai";
        return r;
      };

      if (preferred === "openai") {
        resultBuffer = await tryOpenAI();
        if (!resultBuffer) resultBuffer = await tryGemini();
      } else {
        resultBuffer = await tryGemini();
        if (!resultBuffer) resultBuffer = await tryOpenAI();
      }

      // If neither real editor returned anything AND the user's request is a generic visual
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

      // Update the existing record in place so the user can keep amending the same image
      const oldPath = image.localPath;
      const [updated] = await db.update(imageStudioImages).set({
        mimeType: "image/png",
        fileSize: resultBuffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        tags: [...new Set([...(image.tags || []), "AI Edited", provider])],
        source: "ai-edited",
      }).where(eq(imageStudioImages.id, imageId)).returning();

      // Clean up old file (best-effort — a different path means the old bytes are orphaned)
      if (oldPath && oldPath !== filePath) {
        try { fs.unlinkSync(oldPath); } catch {}
      }

      res.json({ ...updated, provider });
    } catch (e: any) {
      console.error("[image-studio] AI edit error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/image-studio/:id/revert", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const undoPath = path.join(IMAGE_DIR, `undo-${id}.png`);
      if (!fs.existsSync(undoPath)) return res.status(404).json({ error: "No undo snapshot available for this image" });

      const undoBuffer = fs.readFileSync(undoPath);
      const [image] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, id));
      if (!image) return res.status(404).json({ error: "Image not found" });

      const filename = `reverted-${crypto.randomUUID()}.png`;
      const filePath = path.join(IMAGE_DIR, filename);
      await persistImage(filePath, undoBuffer, "image/png");

      const { thumbnail, width, height } = await generateThumbnail(undoBuffer);
      const oldPath = image.localPath;

      const cleanedTags = (image.tags || []).filter(t => !["AI Edited", "gemini", "local", "openai"].includes(t));
      const [updated] = await db.update(imageStudioImages).set({
        mimeType: "image/png",
        fileSize: undoBuffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        tags: cleanedTags,
        source: image.source === "ai-edited" ? "uploaded" : (image.source || "uploaded"),
      }).where(eq(imageStudioImages.id, id)).returning();

      if (oldPath && oldPath !== filePath) { try { fs.unlinkSync(oldPath); } catch {} }
      try { fs.unlinkSync(undoPath); } catch {}

      res.json(updated);
    } catch (e: any) {
      console.error("[image-studio] revert error:", e.message);
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

  // ─── AI image finder ─────────────────────────────────────────────────────
  // Uses Perplexity to surface real exterior / interior photos of a specific
  // property from UK commercial-property sources (Knight Frank / Savills /
  // JLL / Estates Gazette / Property Week / CoStar marketing pages).
  // Returns ranked image URLs the user can preview + import via the existing
  // /import-stock flow. Replaces the rubbish auto-Wikipedia search for
  // 'real' (non-generic) building imagery.
  app.post("/api/image-studio/ai-find-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const { address, postcode, tenantName } = req.body as { address?: string; postcode?: string; tenantName?: string };
      if (!address && !postcode) return res.status(400).json({ error: "address or postcode required" });
      const { askPerplexity, isPerplexityConfigured } = await import("./perplexity");
      if (!isPerplexityConfigured()) {
        return res.status(503).json({ error: "Perplexity not configured (set PERPLEXITY_API_KEY on Railway)" });
      }
      const target = [address, postcode].filter(Boolean).join(", ");
      const tenantHint = tenantName ? ` Current/recent tenant: ${tenantName}.` : "";
      // Tight, JSON-only prompt — we want URLs we can fetch, not prose.
      const prompt = `Find exterior building photos for this UK commercial property:
${target}.${tenantHint}

Look at: knightfrank.co.uk, savills.com, jll.co.uk, cbre.co.uk, costar.com, propertyweek.com, egi.co.uk, realla.co.uk, allsop.co.uk, and the tenant brand's own website.

Return STRICT JSON — no commentary, no markdown. Schema:
{"images":[{"url":"<direct image URL ending in .jpg/.png/.webp>","sourceUrl":"<page where it came from>","sourceName":"<e.g. Knight Frank>","description":"<one-line caption>","quality":"high|medium|low"}]}

Only include images you've actually confirmed exist on those pages. Skip stock libraries (Unsplash/Pexels/Wikipedia) — we want real listing photos of the specific building. Max 8 results.`;

      const r = await askPerplexity(prompt, { maxTokens: 1500, temperature: 0.0 });

      // Parse the JSON out of the response — Perplexity sometimes wraps it
      // in a ```json block despite instructions, so we strip if needed.
      let parsed: any = null;
      const raw = r.answer.trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }

      const images = Array.isArray(parsed?.images) ? parsed.images : [];
      // Sanity-check: every image must be a direct HTTPS URL to a known image extension.
      const safe = images
        .filter((i: any) => typeof i?.url === "string" && /^https:\/\//.test(i.url) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(i.url))
        .slice(0, 8);

      res.json({
        target,
        images: safe,
        citations: r.citations,
        rawAnswer: safe.length === 0 ? r.answer : undefined, // surface for debugging when extraction fails
      });
    } catch (err: any) {
      console.error("[ai-find-images] error:", err?.message);
      res.status(500).json({ error: err?.message || "AI image search failed" });
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

  app.get("/api/image-studio/streetview-proxy", requireAuth, async (req: Request, res: Response) => {
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

  app.post("/api/image-studio/capture-streetview", requireAuth, async (req: Request, res: Response) => {
    try {
      const { location, heading, pitch, fov, category, area, tags, propertyId, kind } = req.body;
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

      // If a property was specified, link this capture to it as a
      // property_imagery_asset so it shows up in the Pathway picker
      // (and Property Intelligence imagery tab) without anyone having
      // to manually re-link. Default kind is secondary_external —
      // user can re-tag as hero from the picker.
      if (propertyId && typeof propertyId === "string") {
        try {
          await db.insert(propertyImageryAssets).values({
            propertyId,
            kind: (kind && ALL_KINDS.includes(kind)) ? kind : "secondary_external",
            source: "street_view",
            imageStudioId: inserted.id,
            score: 0.7,
            width,
            height,
            caption: `Street View · heading ${heading || 0}°`,
            generatedBy: userId,
          } as any);
        } catch (linkErr: any) {
          console.warn("[capture-streetview] property_imagery_assets link failed:", linkErr?.message);
        }

        // Also save into entity_images so the Images panel on the property
        // sidebar picks it up. file_blobs gets a copy of the bytes; the same
        // file_id is referenced from uploaded_files + entity_images.
        try {
          const fileMeta = await pool.query(
            `INSERT INTO uploaded_files (owner_user_id, uploaded_by_user_id, kind, name, mime_type, size_bytes, visibility)
             VALUES ($1, $1, 'entity_image', $2, 'image/jpeg', $3, 'team') RETURNING id`,
            [userId, filename, buffer.length]
          );
          const fileId = fileMeta.rows[0].id;
          await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [fileId, buffer]);
          await pool.query(
            `INSERT INTO entity_images (entity_type, entity_id, file_id, image_studio_id, kind, title, created_by_user_id)
             VALUES ('property', $1, $2, $3, 'street_view', $4, $5)`,
            [propertyId, fileId, inserted.id, `Street View · ${heading || 0}° / ${pitch || 0}° / fov ${fov || 90}`, userId]
          );
        } catch (entityErr: any) {
          console.warn("[capture-streetview] entity_images link failed:", entityErr?.message);
        }
      }

      res.json(inserted);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Combined capture + AI enhance endpoint — one-click professional property photography
  app.post("/api/image-studio/capture-and-enhance", requireAuth, async (req: Request, res: Response) => {
    try {
      const { location, heading, pitch, fov, category, area, tags, propertyId } = req.body;
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

        // Link the enhanced image to the property if propertyId was passed —
        // shows up in property sidebar Images panel + Pathway imagery picker.
        if (propertyId && typeof propertyId === "string") {
          try {
            await db.insert(propertyImageryAssets).values({
              propertyId,
              kind: "secondary_external",
              source: "street_view",
              imageStudioId: inserted.id,
              score: 0.8,
              width: enhThumb.width,
              height: enhThumb.height,
              caption: `Street View · enhanced · ${heading || 0}°`,
              generatedBy: userId,
            } as any);
          } catch (linkErr: any) {
            console.warn("[capture-enhance] property_imagery_assets link failed:", linkErr?.message);
          }
          try {
            const fileMeta = await pool.query(
              `INSERT INTO uploaded_files (owner_user_id, uploaded_by_user_id, kind, name, mime_type, size_bytes, visibility)
               VALUES ($1, $1, 'entity_image', $2, $3, $4, 'team') RETURNING id`,
              [userId, enhFilename, enhExt === ".png" ? "image/png" : "image/jpeg", enhancedBuffer.length]
            );
            const fileId = fileMeta.rows[0].id;
            await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [fileId, enhancedBuffer]);
            await pool.query(
              `INSERT INTO entity_images (entity_type, entity_id, file_id, image_studio_id, kind, title, created_by_user_id)
               VALUES ('property', $1, $2, $3, 'street_view', $4, $5)`,
              [propertyId, fileId, inserted.id, `Street View · enhanced · ${heading || 0}°`, userId]
            );
          } catch (entityErr: any) {
            console.warn("[capture-enhance] entity_images link failed:", entityErr?.message);
          }
        }
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
  app.post("/api/image-studio/bulk-assign-property", requireAuth, async (req: Request, res: Response) => {
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

      // Sync to property_imagery_assets + entity_images so the property
      // sidebar Images panel + Pathway imagery picker pick the images up
      // automatically. Idempotent per (image_studio_id, property_id).
      const userId = req.session?.userId || (req as any).tokenUserId;
      for (const imgId of ids) {
        try {
          const [img] = await db.select().from(imageStudioImages).where(eq(imageStudioImages.id, imgId));
          if (!img) continue;

          // property_imagery_assets (skip if one already exists for this image+property)
          const existingAsset = await pool.query(
            "SELECT id FROM property_imagery_assets WHERE property_id = $1 AND image_studio_id = $2 LIMIT 1",
            [propertyId, imgId]
          );
          if (existingAsset.rows.length === 0) {
            await pool.query(
              `INSERT INTO property_imagery_assets (property_id, kind, source, image_studio_id, caption, generated_by)
               VALUES ($1, 'secondary_external', $2, $3, $4, $5)`,
              [propertyId, img.source || "uploaded", imgId, img.fileName || null, userId]
            );
          }

          // entity_images (skip if already linked)
          const existingEntity = await pool.query(
            "SELECT id FROM entity_images WHERE entity_type = 'property' AND entity_id = $1 AND image_studio_id = $2 LIMIT 1",
            [propertyId, imgId]
          );
          if (existingEntity.rows.length === 0 && img.localPath) {
            // Read bytes from disk so the sidebar thumbnail renders without
            // a separate Image Studio request.
            try {
              const buf = await readPersistedImage(img.localPath);
              if (buf) {
                const fileMeta = await pool.query(
                  `INSERT INTO uploaded_files (owner_user_id, uploaded_by_user_id, kind, name, mime_type, size_bytes, visibility)
                   VALUES ($1, $1, 'entity_image', $2, $3, $4, 'team') RETURNING id`,
                  [userId, img.fileName, img.mimeType || "image/jpeg", buf.length]
                );
                const fileId = fileMeta.rows[0].id;
                await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [fileId, buf]);
                await pool.query(
                  `INSERT INTO entity_images (entity_type, entity_id, file_id, image_studio_id, kind, title, created_by_user_id)
                   VALUES ('property', $1, $2, $3, $4, $5, $6)`,
                  [propertyId, fileId, imgId, img.source === "streetview" ? "street_view" : "photo", img.fileName, userId]
                );
              }
            } catch (blobErr: any) {
              console.warn(`[bulk-assign-property] entity_images sync for ${imgId} failed:`, blobErr?.message);
            }
          }
        } catch (linkErr: any) {
          console.warn(`[bulk-assign-property] link failed for ${imgId}:`, linkErr?.message);
        }
      }

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

      // Drop thumbnail_data (large base64) — client falls back to /thumb endpoint.
      const result = await pool.query(`
        SELECT i.id, i.file_name, i.category, i.tags, i.description, i.source,
               i.property_id, i.area, i.address, i.brand_name, i.brand_sector,
               i.property_type, i.mime_type, i.file_size, i.width, i.height,
               i.sharepoint_item_id, i.sharepoint_drive_id, i.local_path,
               i.uploaded_by, i.created_at,
               (i.thumbnail_data IS NOT NULL) AS has_thumbnail
          FROM image_studio_images i
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

  // Render a PDF (local path or SharePoint driveId+itemId) to images and save each page
  app.post("/api/image-studio/capture-pdf", requireAuth, async (req: Request, res: Response) => {
    const { driveId, itemId, localPath: localFilePath, fileName, category = "Marketing", propertyName, tags = [], maxPages } = req.body;
    if (!driveId && !localFilePath) return res.status(400).json({ error: "driveId+itemId or localPath required" });
    try {
      let pdfBuffer: Buffer;
      if (driveId && itemId) {
        const { getValidMsToken } = await import("./microsoft");
        const token = await getValidMsToken(req as any);
        if (!token) return res.status(401).json({ error: "Not signed into Microsoft" });
        const upstream = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`, {
          headers: { Authorization: `Bearer ${token}` }, redirect: "follow",
        });
        if (!upstream.ok) return res.status(upstream.status).json({ error: `SharePoint fetch failed: ${upstream.status}` });
        pdfBuffer = Buffer.from(await upstream.arrayBuffer());
      } else {
        if (!fs.existsSync(localFilePath)) return res.status(404).json({ error: "File not found" });
        pdfBuffer = fs.readFileSync(localFilePath);
      }

      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs") as any;
      const { createCanvas } = await import("canvas") as any;

      class NodeCanvasFactory {
        create(w: number, h: number) { const cv = createCanvas(w, h); return { canvas: cv, context: cv.getContext("2d") }; }
        reset(ca: any, w: number, h: number) { ca.canvas.width = w; ca.canvas.height = h; }
        destroy(ca: any) { ca.canvas.width = 0; ca.canvas.height = 0; }
      }

      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), disableFontFace: true });
      const pdfDoc = await loadingTask.promise;
      const numPages = Math.min(pdfDoc.numPages, maxPages || 999);
      const baseName = (fileName || "brochure").replace(/\.pdf$/i, "");
      const userId = req.session?.userId || (req as any).tokenUserId;
      const saved: { id: string; page: number; fileName: string }[] = [];
      const pageTags = [...(Array.isArray(tags) ? tags : []), "brochure", "pdf-capture", ...(propertyName ? [propertyName] : [])];

      for (let p = 1; p <= numPages; p++) {
        const page = await pdfDoc.getPage(p);
        const viewport = page.getViewport({ scale: 1.8 });
        const factory = new NodeCanvasFactory();
        const { canvas, context } = factory.create(viewport.width, viewport.height);
        await page.render({ canvasContext: context, viewport, canvasFactory: factory }).promise;
        const jpegBuf: Buffer = (canvas as any).toBuffer("image/jpeg", { quality: 0.88 });
        const pageLabel = numPages > 1 ? ` p${p}` : "";
        const imgFileName = `${baseName}${pageLabel}.jpg`;
        const { thumbnail, width, height } = await generateThumbnail(jpegBuf);
        const diskName = `${crypto.randomUUID()}.jpg`;
        const diskPath = path.join(IMAGE_DIR, diskName);
        await persistImage(diskPath, jpegBuf, "image/jpeg", imgFileName);
        const [inserted] = await db.insert(imageStudioImages).values({
          fileName: imgFileName, category, tags: pageTags,
          description: propertyName ? `Page ${p} of ${baseName} — ${propertyName}` : `Page ${p} of ${baseName}`,
          source: "chatbgp", area: null, address: null, brandName: null, propertyType: null,
          mimeType: "image/jpeg", fileSize: jpegBuf.length, width, height,
          thumbnailData: thumbnail, localPath: diskPath, uploadedBy: userId,
        }).returning();
        saved.push({ id: inserted.id, page: p, fileName: imgFileName });
        factory.destroy({ canvas, context });
      }

      console.log(`[image-studio] capture-pdf: saved ${saved.length} pages from "${fileName}"`);
      res.json({ success: true, pages: saved.length, images: saved });
    } catch (e: any) {
      console.error("[image-studio] capture-pdf error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Save base64 image — used by PDF viewer page-capture and ChatBGP fetchUrl/SharePoint import
  app.post("/api/image-studio", requireAuth, async (req: Request, res: Response) => {
    try {
      const { base64Data, mimeType = "image/jpeg", fileName, category = "Marketing", description, area, address, brandName, propertyType, tags = [] } = req.body;
      if (!base64Data || !fileName) return res.status(400).json({ error: "base64Data and fileName required" });

      // Skip if an image with this fileName already exists in this category — prevents duplicate saves
      // when ChatBGP or any upstream caller re-invokes the tool.
      const dupe = await pool.query(
        `SELECT id FROM image_studio_images WHERE file_name = $1 AND category = $2 LIMIT 1`,
        [fileName, category]
      );
      if (dupe.rows.length > 0) {
        return res.json({ success: true, imageId: dupe.rows[0].id, fileName, category, deduped: true });
      }

      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 20 * 1024 * 1024) return res.status(400).json({ error: "Image too large (max 20MB)" });
      const ext = mimeType.includes("png") ? ".png" : mimeType.includes("webp") ? ".webp" : ".jpg";
      const filename = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(IMAGE_DIR, filename);
      await persistImage(filePath, buffer, mimeType, fileName);
      const { thumbnail, width, height } = await generateThumbnail(buffer);
      const userId = req.session?.userId || (req as any).tokenUserId;
      const [inserted] = await db.insert(imageStudioImages).values({
        fileName,
        category,
        tags: Array.isArray(tags) ? tags : [],
        description: description || null,
        source: "chatbgp",
        area: area || null,
        address: address || null,
        brandName: brandName || null,
        propertyType: propertyType || null,
        mimeType,
        fileSize: buffer.length,
        width,
        height,
        thumbnailData: thumbnail,
        localPath: filePath,
        uploadedBy: userId,
      }).returning();
      res.json({ success: true, imageId: inserted.id, fileName, category });
    } catch (e: any) {
      console.error("[image-studio] save error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Dedup Brands category — keeps the earliest row per (file_name, category) and removes the rest.
  // Fixes the ~500 duplicate logos left behind when ChatBGP re-invoked save_to_image_studio per logo.
  app.post("/api/image-studio/dedup-brands", requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        WITH dupes AS (
          SELECT id, file_name,
            ROW_NUMBER() OVER (PARTITION BY LOWER(file_name), category ORDER BY created_at ASC, id ASC) AS rn
          FROM image_studio_images
          WHERE category = 'Brands'
        )
        DELETE FROM image_studio_images
        WHERE id IN (SELECT id FROM dupes WHERE rn > 1)
        RETURNING id
      `);
      console.log(`[image-studio] dedup-brands removed ${result.rowCount} duplicate rows`);
      res.json({ success: true, removed: result.rowCount });
    } catch (e: any) {
      console.error("[image-studio] dedup-brands error:", e.message);
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
