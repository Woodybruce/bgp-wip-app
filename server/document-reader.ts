// Universal document reader — back-end for ChatBGP's `read_document`
// tool. One entry point that pulls a file from any of the three places
// docs live (chat-media, property brochures, raw file_storage key) and
// returns text + (for visual docs) base64 page images, ready to be
// dropped straight into Claude's tool-result so ChatBGP can reason
// about the content and decide what to file where.
//
// Deliberately minimal — we lean on the existing extractors (pdf-parse,
// ExcelJS, mammoth) and the existing rasterisation helper. The point
// of this module is "everything ChatBGP needs to handle any document,
// in one tool call".

import { pool } from "./db";
import { getFile } from "./file-storage";
import { rasterisePdfPage } from "./pdf-image-extract";

export interface ReadDocumentArgs {
  chatMediaFilename?: string;
  storageKey?: string;
  brochureId?: string;
  includePageImages?: boolean;
  maxTextChars?: number;
}

export interface ReadDocumentResult {
  ok: boolean;
  error?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  // Where this came from — useful for ChatBGP to know the entity context.
  source?: {
    kind: "chat_media" | "property_brochure" | "storage_key";
    storageKey: string;
    propertyId?: string | null;
    brochureType?: "leasing" | "investment" | null;
  };
  // Extracted plain text (truncated to maxTextChars).
  text?: string;
  textTruncated?: boolean;
  // Base64-encoded page images (JPEG), one per rasterised PDF page or
  // one entry containing the raw image itself for image uploads.
  pageImages?: Array<{ index: number; mimeType: string; base64: string }>;
  // For PDFs, total page count if we could read it.
  pageCount?: number | null;
}

const MAX_RASTER_PAGES = 4;

export async function readDocumentForAI(args: ReadDocumentArgs): Promise<ReadDocumentResult> {
  const maxText = args.maxTextChars ?? 40_000;
  const includeImages = args.includePageImages !== false;

  // Resolve to a storage key + source kind + optional property context.
  const resolved = await resolveSource(args);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const file = await getFile(resolved.storageKey);
  if (!file) return { ok: false, error: `File not found in storage: ${resolved.storageKey}` };

  const fileName = file.originalName || resolved.storageKey.split("/").pop() || "document";
  const mimeType = file.contentType || guessMimeFromExt(fileName);
  const ext = fileName.toLowerCase().split(".").pop() || "";

  const result: ReadDocumentResult = {
    ok: true,
    fileName,
    mimeType,
    size: file.data.length,
    source: {
      kind: resolved.kind,
      storageKey: resolved.storageKey,
      propertyId: resolved.propertyId || null,
      brochureType: resolved.brochureType || null,
    },
  };

  // Branch by type — text formats get extracted to text, images get returned
  // straight as base64, PDFs get both.
  try {
    if (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic"].includes(ext)) {
      result.text = "";
      result.pageImages = includeImages ? [{
        index: 1,
        mimeType: mimeType.startsWith("image/") ? mimeType : `image/${ext === "jpg" ? "jpeg" : ext}`,
        base64: file.data.toString("base64"),
      }] : [];
    } else if (mimeType.includes("pdf") || ext === "pdf") {
      const text = await extractPdfText(file.data);
      result.text = text.slice(0, maxText);
      result.textTruncated = text.length > maxText;
      result.pageCount = await readPdfPageCount(file.data);
      if (includeImages) {
        result.pageImages = await rasteriseFirstPages(file.data, Math.min(MAX_RASTER_PAGES, result.pageCount || MAX_RASTER_PAGES));
      }
    } else if (mimeType.includes("spreadsheet") || ["xlsx", "xls", "csv"].includes(ext)) {
      const text = await extractSpreadsheetText(file.data, ext);
      result.text = text.slice(0, maxText);
      result.textTruncated = text.length > maxText;
    } else if (mimeType.includes("wordprocessing") || mimeType.includes("msword") || ext === "docx" || ext === "doc") {
      const text = await extractWordText(file.data);
      result.text = text.slice(0, maxText);
      result.textTruncated = text.length > maxText;
    } else if (mimeType.includes("presentationml") || ext === "pptx") {
      const text = await extractPptxText(file.data);
      result.text = text.slice(0, maxText);
      result.textTruncated = text.length > maxText;
    } else if (ext === "ppt") {
      result.text = "[Legacy binary .ppt file — ask the user to re-save it as .pptx and re-upload; the old format can't be read directly.]";
    } else if (mimeType.startsWith("text/") || ["txt", "json", "xml", "html", "md", "log"].includes(ext)) {
      const text = file.data.toString("utf-8");
      result.text = text.slice(0, maxText);
      result.textTruncated = text.length > maxText;
    } else if (mimeType.includes("zip") || ext === "zip") {
      const text = await extractZipText(file.data, maxText);
      result.text = text.slice(0, maxText);
      result.textTruncated = text.length > maxText;
    } else {
      result.text = `[Binary file — ${mimeType}. Use a different tool to handle this format.]`;
    }
  } catch (err: any) {
    result.error = `Extraction failed: ${err?.message || String(err)}`;
  }

  return result;
}

// ─── Source resolution ──────────────────────────────────────────────────

async function resolveSource(args: ReadDocumentArgs): Promise<
  | { ok: true; kind: "chat_media" | "property_brochure" | "storage_key"; storageKey: string; propertyId?: string | null; brochureType?: "leasing" | "investment" | null }
  | { ok: false; error: string }
> {
  if (args.chatMediaFilename) {
    let name = args.chatMediaFilename.trim();
    if (name.startsWith("/api/chat-media/")) name = name.slice("/api/chat-media/".length);
    if (name.startsWith("chat-media/")) name = name.slice("chat-media/".length);
    return { ok: true, kind: "chat_media", storageKey: `chat-media/${name}` };
  }
  if (args.brochureId) {
    const { rows } = await pool.query<{ storage_key: string; property_id: string; type: string }>(
      `SELECT storage_key, property_id, type FROM property_brochures WHERE id = $1`,
      [args.brochureId]
    );
    if (!rows[0]) return { ok: false, error: `Brochure ${args.brochureId} not found` };
    return {
      ok: true,
      kind: "property_brochure",
      storageKey: rows[0].storage_key,
      propertyId: rows[0].property_id,
      brochureType: rows[0].type as any,
    };
  }
  if (args.storageKey) {
    return { ok: true, kind: "storage_key", storageKey: args.storageKey.trim() };
  }
  return { ok: false, error: "One of chatMediaFilename, brochureId, or storageKey is required" };
}

// ─── Text extraction ────────────────────────────────────────────────────

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfModule = await import("pdf-parse");
  const PDFParseClass = (pdfModule as any).PDFParse || (pdfModule as any).default;
  const parser = new PDFParseClass(new Uint8Array(buffer));
  const result = await parser.getText();
  try { (parser as any).destroy?.(); } catch {}
  if (typeof result === "string") return result;
  if (Array.isArray((result as any).pages)) {
    return (result as any).pages.map((p: any) => p.text || "").join("\n\n");
  }
  return (result as any).text || String(result);
}

async function readPdfPageCount(buffer: Buffer): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

async function rasteriseFirstPages(buffer: Buffer, pages: number): Promise<Array<{ index: number; mimeType: string; base64: string }>> {
  const out: Array<{ index: number; mimeType: string; base64: string }> = [];
  for (let p = 1; p <= pages; p++) {
    const img = await rasterisePdfPage({ pdfBuffer: buffer, page: p, dpi: 130 });
    if (!img) break;
    out.push({ index: p, mimeType: "image/jpeg", base64: img.toString("base64") });
  }
  return out;
}

async function extractSpreadsheetText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === "csv") {
    return buffer.toString("utf-8");
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const lines: string[] = [];
  wb.eachSheet((sheet) => {
    lines.push(`\n--- Sheet: ${sheet.name} ---`);
    sheet.eachRow((row, rowNum) => {
      if (rowNum > 500) return;
      const vals = (row.values as any[]).slice(1).map((v: any) => (v?.result !== undefined ? v.result : v ?? ""));
      lines.push(vals.join("\t"));
    });
  });
  return lines.join("\n");
}

async function extractWordText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

// PowerPoint: each slide's text plus tables, pulled straight from the OOXML
// (same approach as the chat file extractor — no external service).
export async function extractPptxText(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
  const linesOf = (xml: string) => (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
    .map((para) => dec((para.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((x) => x.replace(/<\/?a:t>/g, "")).join("")).trim())
    .filter(Boolean);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10));
  if (names.length === 0) return "[PowerPoint file contains no slides.]";
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const xml = (await zip.file(names[i])!.async("string")) || "";
    out.push(`--- Slide ${i + 1} ---`);
    const tables: string[][][] = [];
    for (const tbl of xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || []) {
      const rows: string[][] = [];
      for (const tr of tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []) {
        const cells: string[] = [];
        for (const tc of tr.match(/<a:tc>[\s\S]*?<\/a:tc>/g) || []) cells.push(linesOf(tc).join(" ").trim());
        if (cells.some((c) => c)) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }
    const noTbl = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, "");
    const lines: string[] = [];
    for (const sp of noTbl.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) lines.push(...linesOf(sp));
    if (lines.length) out.push(lines.join("\n"));
    for (const t of tables) { out.push("[table]"); for (const r of t) out.push("| " + r.join(" | ") + " |"); }
  }
  return out.join("\n");
}

// A ZIP is read as its contents: list every entry, then extract the ones we
// have a reader for (spreadsheets, PDFs, Word, text) through the same
// extractors used for a bare upload. Mirrors what ingest_url already does
// for zipped downloads, so a dropped .zip and a zipped link behave alike.
const ZIP_MAX_ENTRIES = 12;

export async function extractZipText(buffer: Buffer, maxText: number): Promise<string> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e: any) =>
    !e.isDirectory && !e.entryName.startsWith("__MACOSX") && !e.entryName.split("/").pop()?.startsWith("."));
  if (entries.length === 0) return "[ZIP archive is empty.]";

  const parts: string[] = [
    `ZIP archive — ${entries.length} file(s):`,
    ...entries.map((e: any) => `  ${e.entryName} (${e.header.size} bytes)`),
    "",
  ];
  // Share the text budget across the entries we read so one huge workbook
  // can't crowd the rest out of the reply.
  const readable = entries.slice(0, ZIP_MAX_ENTRIES);
  const perEntry = Math.max(2_000, Math.floor(maxText / Math.max(1, readable.length)));

  for (const e of readable) {
    const name = e.entryName.toLowerCase();
    const base = e.entryName.replace(/^.*\//, "");
    try {
      const data = e.getData();
      let text: string | null = null;
      if (/\.(xlsx|xls|csv)$/.test(name)) {
        text = await extractSpreadsheetText(data, name.split(".").pop() || "xlsx");
      } else if (name.endsWith(".pdf")) {
        text = await extractPdfText(data);
      } else if (/\.(docx|doc)$/.test(name)) {
        text = await extractWordText(data);
      } else if (name.endsWith(".pptx")) {
        text = await extractPptxText(data);
      } else if (/\.(txt|json|xml|html|md|log)$/.test(name)) {
        text = data.toString("utf-8");
      }
      if (text === null) {
        parts.push(`--- ${base} (${data.length} bytes — format not extracted) ---`);
      } else {
        const clipped = text.slice(0, perEntry);
        parts.push(`--- ${base} ---\n${clipped}${text.length > perEntry ? `\n… (${text.length - perEntry} more characters not shown)` : ""}`);
      }
    } catch (entryErr: any) {
      parts.push(`--- ${base} — could not extract: ${entryErr?.message || String(entryErr)} ---`);
    }
  }
  if (entries.length > ZIP_MAX_ENTRIES) {
    parts.push(`… ${entries.length - ZIP_MAX_ENTRIES} further file(s) in the archive were not extracted.`);
  }
  return parts.join("\n");
}

function guessMimeFromExt(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    md: "text/markdown",
    zip: "application/zip",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  return map[ext] || "application/octet-stream";
}
