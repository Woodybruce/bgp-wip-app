import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const execFileAsync = promisify(execFile);

export interface ExtractedImage {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Extracts embedded images from a PDF buffer using poppler's `pdfimages`.
 * Requires poppler_utils on the host (declared in nixpacks.toml).
 *
 * Returns real photos embedded in the PDF — not rasterised pages. Great for
 * brochures, where the agent has laid out 10–30 high-res images.
 *
 * Silently returns an empty array if poppler is missing or the PDF has no
 * images, so callers never need to catch.
 */
export async function extractImagesFromPdf(args: {
  pdfBuffer: Buffer;
  maxImages?: number;
  minBytes?: number;
}): Promise<ExtractedImage[]> {
  const { pdfBuffer } = args;
  const maxImages = args.maxImages ?? 30;
  const minBytes = args.minBytes ?? 8_000; // filter tiny icons / logos

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathway-pdfimages-"));
  const pdfPath = path.join(tmpDir, `${crypto.randomUUID()}.pdf`);
  const outPrefix = path.join(tmpDir, "img");

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);

    // -j writes JPEG-encoded images as .jpg (otherwise raster as .ppm).
    // -all writes every image as its native encoding (.jpg/.png/.jp2),
    // but keeping -j is safer for brochures which are overwhelmingly JPEG.
    await execFileAsync("pdfimages", ["-j", pdfPath, outPrefix], { timeout: 60_000 }).catch((err: any) => {
      console.warn("[pdf-image-extract] pdfimages failed:", err?.message || err);
    });

    const files = fs.readdirSync(tmpDir)
      .filter(n => /^img-\d+\.(jpg|jpeg|png|ppm|jp2)$/i.test(n))
      .sort();

    const results: ExtractedImage[] = [];
    for (const name of files) {
      if (results.length >= maxImages) break;
      const full = path.join(tmpDir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.size < minBytes) continue;
        const ext = path.extname(name).toLowerCase();
        // Skip .ppm — not web-viewable; we pass -j so they should be rare.
        if (ext === ".ppm") continue;
        const mimeType =
          ext === ".png" ? "image/png" :
          ext === ".jp2" ? "image/jp2" :
          "image/jpeg";
        const buffer = fs.readFileSync(full);
        results.push({ buffer, mimeType, filename: name });
      } catch {}
    }
    return results;
  } finally {
    try {
      for (const n of fs.readdirSync(tmpDir)) {
        try { fs.unlinkSync(path.join(tmpDir, n)); } catch {}
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}

/**
 * Rasterises page N of a PDF as a JPEG using poppler's `pdftoppm`.
 * Useful for brochure cover thumbnails when the embedded images aren't
 * stand-alone (e.g. vector layouts).
 */
export async function rasterisePdfPage(args: {
  pdfBuffer: Buffer;
  page?: number;
  dpi?: number;
}): Promise<Buffer | null> {
  const page = args.page ?? 1;
  const dpi = args.dpi ?? 150;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathway-pdftoppm-"));
  const pdfPath = path.join(tmpDir, `${crypto.randomUUID()}.pdf`);
  const outPrefix = path.join(tmpDir, "page");

  try {
    fs.writeFileSync(pdfPath, args.pdfBuffer);
    await execFileAsync("pdftoppm", [
      "-jpeg",
      "-r", String(dpi),
      "-f", String(page),
      "-l", String(page),
      pdfPath,
      outPrefix,
    ], { timeout: 30_000 });
    const file = fs.readdirSync(tmpDir).find(n => n.startsWith("page-") && n.endsWith(".jpg"));
    if (!file) return null;
    return fs.readFileSync(path.join(tmpDir, file));
  } catch (err: any) {
    console.warn("[pdf-image-extract] pdftoppm failed:", err?.message || err);
    return null;
  } finally {
    try {
      for (const n of fs.readdirSync(tmpDir)) {
        try { fs.unlinkSync(path.join(tmpDir, n)); } catch {}
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}
