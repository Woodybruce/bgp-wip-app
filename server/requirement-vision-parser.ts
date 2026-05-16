// Vision parser for landlord-pack brochures. PIPnet + TRL both download a
// stitched brochure PDF per requirement (server/pipnet.ts:downloadBrochureAsPdf,
// server/trl.ts:importTrlRequirement). The HTML metadata they expose is
// often wrong or sparse — the brochure IMAGES contain the actual fields:
// requirement size, use class, target locations, format, fit-out notes.
//
// This module runs Claude vision over the brochure (or its embedded images)
// and returns structured fields that callers can merge into the requirement
// record, overriding the noisy source metadata when confidence is high.
import Anthropic from "@anthropic-ai/sdk";
import { extractImagesFromPdf, rasterisePdfPage } from "./pdf-image-extract";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ParsedRequirement {
  brandName: string | null;
  sizeRange: string | null;        // e.g. "1,500-3,000 sq ft"
  useClass: string | null;         // e.g. "E (a)" / "Sui Generis - drinking establishment"
  locations: string[];             // e.g. ["Marylebone", "Notting Hill", "Soho"]
  tenure: string | null;           // "Leasehold" / "Freehold" / "Either"
  format: string | null;           // "Flagship" / "High street" / "Standalone"
  fitOut: string | null;           // "Cat A+" / "Vanilla shell" / etc
  notes: string | null;            // freeform extras
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  confidence: "high" | "medium" | "low";
  rawText: string;
}

const PROMPT = `You are reading a UK commercial property "landlord pack" — the requirement document a retailer / F&B operator sends to agents describing the space they want.

Extract these fields. If a field is unclear or absent from the document, return null (don't guess).

- brandName: the operator's brand name (e.g. "Pret A Manger", "Aesop", "Soho House")
- sizeRange: requested square footage as the document phrases it (e.g. "1,500-3,000 sq ft" or "min 2,000 sq ft GIA")
- useClass: planning use class (e.g. "E (a) Retail", "E (b) F&B", "Sui Generis - drinking establishment")
- locations: array of named target locations/areas/towns (UK only; e.g. ["Marylebone", "Notting Hill", "Bath", "Brighton"])
- tenure: "Leasehold" / "Freehold" / "Either" / null
- format: positioning (e.g. "Flagship", "High street", "Standalone", "Shopping centre", "Mixed-use")
- fitOut: fit-out spec mentioned (e.g. "Cat A+", "Vanilla shell", "Open A1") or null
- notes: freeform anything else useful — features (basement, frontage), rent guidance, exclusivity etc, in <140 chars
- contactName / contactEmail / contactPhone: if the requirement names a contact for offers
- confidence: "high" if the document is clear and most fields visible, "medium" if some are inferred from context, "low" if pages are blurry / a different document type

Respond with ONLY valid JSON, no markdown fences, no commentary. Example:
{
  "brandName": "Aesop",
  "sizeRange": "800-1,500 sq ft GIA",
  "useClass": "E (a) Retail",
  "locations": ["Marylebone", "Notting Hill", "Soho"],
  "tenure": "Leasehold",
  "format": "Flagship",
  "fitOut": null,
  "notes": "Prefers prime corner units with double frontage",
  "contactName": "Henry Davis",
  "contactEmail": "henry@example.com",
  "contactPhone": null,
  "confidence": "high"
}`;

/**
 * Parse a landlord-pack PDF with Claude vision.
 *
 * Strategy:
 *   1. Try `pdfimages` first — Pipnet stitches images into a PDF, so the
 *      embedded images ARE the source material. Cheap, no rendering.
 *   2. If no embedded images (or fewer than 1), fall back to rasterising
 *      the first 4 pages with `pdftoppm`. Works for TRL/born-digital PDFs.
 *   3. Send up to 6 images to Claude as a single vision turn — way cheaper
 *      than one call per page and Claude can cross-reference fields across
 *      pages this way.
 */
export async function parseRequirementBrochure(args: {
  pdfBuffer: Buffer;
  maxPages?: number;
}): Promise<ParsedRequirement | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[req-vision] ANTHROPIC_API_KEY not set");
    return null;
  }
  const maxPages = args.maxPages ?? 6;

  // Step 1: try embedded images
  let pages: { buffer: Buffer; mimeType: string }[] = [];
  try {
    const embedded = await extractImagesFromPdf({ pdfBuffer: args.pdfBuffer, maxImages: maxPages, minBytes: 20_000 });
    pages = embedded.map(e => ({ buffer: e.buffer, mimeType: e.mimeType }));
  } catch (err: any) {
    console.warn("[req-vision] pdfimages failed:", err?.message);
  }

  // Step 2: fall back to rasterising pages
  if (pages.length === 0) {
    for (let p = 1; p <= maxPages; p++) {
      const buf = await rasterisePdfPage({ pdfBuffer: args.pdfBuffer, page: p, dpi: 130 });
      if (!buf) break;
      pages.push({ buffer: buf, mimeType: "image/jpeg" });
    }
  }

  if (pages.length === 0) {
    console.warn("[req-vision] no pages extracted from PDF");
    return null;
  }

  const content: any[] = pages.map(p => ({
    type: "image",
    source: {
      type: "base64",
      media_type: p.mimeType.startsWith("image/png") ? "image/png" : "image/jpeg",
      data: p.buffer.toString("base64"),
    },
  }));
  content.push({ type: "text", text: PROMPT });

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content }],
    });
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[req-vision] no JSON in response:", text.slice(0, 200));
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      brandName: parsed.brandName || null,
      sizeRange: parsed.sizeRange || null,
      useClass: parsed.useClass || null,
      locations: Array.isArray(parsed.locations) ? parsed.locations.filter((l: any) => typeof l === "string" && l.trim()) : [],
      tenure: parsed.tenure || null,
      format: parsed.format || null,
      fitOut: parsed.fitOut || null,
      notes: parsed.notes || null,
      contactName: parsed.contactName || null,
      contactEmail: parsed.contactEmail || null,
      contactPhone: parsed.contactPhone || null,
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
      rawText: text,
    };
  } catch (err: any) {
    console.warn("[req-vision] Claude call failed:", err?.message);
    return null;
  }
}

/**
 * Merge a vision parse result into an external_requirements record. Only
 * overwrites a field if the scraper had nothing for it (preserves manual
 * cleanup) — unless confidence is "high", in which case vision wins.
 *
 * Returns the merged record. Mutates `target` in place.
 */
export function mergeVisionIntoRecord<T extends {
  sizeRange?: string | null;
  useClass?: string | null;
  locations?: string[] | null;
  tenure?: string | null;
  description?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}>(target: T, vision: ParsedRequirement): T {
  const visionWins = vision.confidence === "high";
  const orVision = <K extends keyof T>(field: K, visionVal: T[K]) => {
    if (visionVal == null) return;
    const isEmpty = target[field] == null || (typeof target[field] === "string" && !(target[field] as string).trim());
    if (isEmpty || visionWins) target[field] = visionVal;
  };
  orVision("sizeRange", vision.sizeRange as any);
  orVision("useClass", vision.useClass as any);
  orVision("tenure", vision.tenure as any);
  orVision("contactName", vision.contactName as any);
  orVision("contactEmail", vision.contactEmail as any);
  orVision("contactPhone", vision.contactPhone as any);
  // locations[]: union when scraper had nothing, vision-only when scraper sparse
  const hasLocations = Array.isArray(target.locations) && target.locations.length > 0;
  if (!hasLocations && vision.locations.length > 0) target.locations = vision.locations as any;
  // Append vision notes to description if useful
  if (vision.notes && !target.description) target.description = vision.notes as any;
  return target;
}
