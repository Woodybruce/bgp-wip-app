/** Keep visual document evidence attached to the tool result that produced it. */
export type ChatToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ChatToolResultContent = string | ChatToolResultBlock[];

const MAX_TEXT_CHARS = 80_000;
const MAX_PAGE_IMAGES = 4; // The document reader rasterises at most four pages.
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** The notice is inside the limit, so unusually large results remain bounded. */
function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const notice = `\n...[truncated — full text result was ${text.length} chars; omitted content has not been read. Request a narrower result if needed.]`;
  return text.slice(0, Math.max(0, limit - notice.length)) + notice.slice(0, limit);
}

function stringifyResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result) ?? "No output";
}

async function prepareImage(page: any): Promise<{ mimeType: string; base64: string }> {
  if (typeof page?.base64 !== "string" || !page.base64.length) throw new Error("missing image data");
  // Check before decoding so a broken tool cannot allocate an unbounded buffer.
  if (page.base64.length > Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3) * 4) throw new Error("image too large");
  const base64 = page.base64.replace(/\s/g, "");
  if (!base64.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new Error("invalid image data");
  }
  const buffer = Buffer.from(base64, "base64");
  const mimeType = String(page.mimeType || "").toLowerCase().split(";")[0].trim().replace("image/jpg", "image/jpeg");
  // Rendered PDF pages are already small JPEGs. Keep those intact. Normalise
  // large photos and formats such as HEIC before either provider sees them.
  if (SUPPORTED_IMAGE_MIMES.has(mimeType) && buffer.length <= 1_500_000) {
    return { mimeType, base64 };
  }
  const sharp = (await import("sharp")).default;
  const image = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { mimeType: "image/jpeg", base64: image.toString("base64") };
}

/**
 * Ordinary tools retain their text/JSON contract. read_document instead returns
 * text plus actual image blocks, never base64 embedded in a JSON text prompt.
 * Keep this content on the original tool message: its call ID is the provenance.
 */
export async function buildChatToolResultContent(
  toolName: string,
  result: unknown,
): Promise<ChatToolResultContent> {
  if (toolName !== "read_document" || !result || typeof result !== "object"
      || !Array.isArray((result as any).pageImages) || !(result as any).pageImages.length) {
    return boundedText(stringifyResult(result), MAX_TEXT_CHARS);
  }

  const { pageImages, text: extractedText, ...document } = result as Record<string, any>;
  const images: ChatToolResultBlock[] = [];
  const imageSummary: Array<{ index: number; mimeType?: string; status: string }> = [];
  // Sequential conversion keeps peak memory bounded when several large photos
  // are returned together. A failed image must not hide readable document text.
  for (const [position, page] of pageImages.slice(0, MAX_PAGE_IMAGES).entries()) {
    const index = Number.isInteger(page?.index) && page.index > 0 ? page.index : position + 1;
    try {
      const image = await prepareImage(page);
      imageSummary.push({ index, mimeType: image.mimeType, status: "attached below as an image" });
      images.push({ type: "text", text: `Document page ${index}:` });
      images.push({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } });
    } catch {
      imageSummary.push({ index, status: "Image unavailable: invalid, unsupported or too large to decode. Do not claim to have inspected this page visually." });
    }
  }

  const notes: string[] = [];
  if (document.textTruncated) notes.push("The document reader truncated the extracted text; the omitted text has not been read.");
  if (pageImages.length > MAX_PAGE_IMAGES) notes.push(`Only the first ${MAX_PAGE_IMAGES} of ${pageImages.length} returned page images were processed.`);
  if (typeof document.pageCount === "number" && document.pageCount > imageSummary.length) {
    notes.push(`This document has ${document.pageCount} pages. Images are supplied only for the page numbers listed here; do not assume every page was visually reviewed.`);
  }
  // Put evidence scope before the potentially long extracted text, so a text
  // truncation cannot hide which pages were (or were not) visually inspected.
  const metadata = { ...document, pageImages: imageSummary, ...(notes.length ? { visionNotes: notes } : {}),
    ...(extractedText !== undefined ? { text: extractedText } : {}) };
  const labelChars = images.reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);
  return [{ type: "text", text: boundedText(JSON.stringify(metadata), MAX_TEXT_CHARS - labelChars) }, ...images];
}
