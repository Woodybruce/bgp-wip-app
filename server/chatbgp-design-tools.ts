// Design-oriented ChatBGP tools — pdf-lib for stitching existing brochure
// pages, and Dropbox→SharePoint bridge for filing raw PDFs. The Claude
// HTML→PDF design path (server/why-buy-design.ts) handles fresh decks; the
// Gamma integration was removed (Nov 2025) after repeated API
// breakages and consistently underwhelming output vs the Claude path.
//
// Each helper returns a chat-media URL the model can hand back to the user as
// a download link. Keeping them in this module keeps chatbgp.ts manageable.

import type { Request } from "express";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { saveFile, getFile, findChatMediaByOriginalName } from "./file-storage";
import { db, pool } from "./db";
import { eq } from "drizzle-orm";
import { systemSettings } from "@shared/schema";

// ─── Brochure compilation — stitch real pages from existing PDFs ─────────────

interface BrochureSource {
  source: "sharepoint" | "dropbox";
  sharepointDriveId?: string;
  sharepointItemId?: string;
  dropboxPath?: string;
  pages: number[];
  label?: string;
}

export interface CompileBrochureArgs {
  title: string;
  sources: BrochureSource[];
}

async function fetchSharepointPdf(driveId: string, itemId: string, msToken: string): Promise<Buffer> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
    { headers: { Authorization: `Bearer ${msToken}` }, redirect: "follow" }
  );
  if (!res.ok) throw new Error(`SharePoint download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getDropboxAccessToken(): Promise<string> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "dropbox_tokens"));
  const tokens = row?.value ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
  if (!tokens) throw new Error("Dropbox not connected");
  let accessToken = tokens.access_token;
  if (!accessToken || !tokens.expires_at || Date.now() >= tokens.expires_at - 60000) {
    const appKey = process.env.DROPBOX_APP_KEY;
    const appSecret = process.env.DROPBOX_APP_SECRET;
    if (!appKey || !appSecret || !tokens.refresh_token) throw new Error("Dropbox token expired and cannot be refreshed");
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: appKey,
        client_secret: appSecret,
      }),
    });
    if (!r.ok) throw new Error(`Dropbox token refresh failed: ${r.status}`);
    const d = await r.json();
    accessToken = d.access_token;
    await db.update(systemSettings)
      .set({ value: JSON.stringify({
        access_token: d.access_token,
        refresh_token: d.refresh_token || tokens.refresh_token,
        expires_at: Date.now() + (d.expires_in || 14400) * 1000,
      }), updatedAt: new Date() })
      .where(eq(systemSettings.key, "dropbox_tokens"));
  }
  return accessToken;
}

async function fetchDropboxPdf(pathOrId: string): Promise<Buffer> {
  const accessToken = await getDropboxAccessToken();
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: pathOrId }),
    },
  });
  if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function compileBrochureFromPdfs(args: CompileBrochureArgs, req: Request): Promise<any> {
  if (!args.sources?.length) return { error: "sources array is required and must contain at least one entry" };

  const out = await PDFDocument.create();
  const failures: string[] = [];
  let msToken: string | null = null;

  for (const src of args.sources) {
    try {
      let buffer: Buffer;
      if (src.source === "sharepoint") {
        if (!src.sharepointDriveId || !src.sharepointItemId) {
          failures.push(`${src.label || "source"}: missing SharePoint driveId/itemId`);
          continue;
        }
        if (!msToken) {
          const { getValidMsToken } = await import("./microsoft");
          msToken = await getValidMsToken(req);
          if (!msToken) return { error: "Microsoft 365 not connected — needed to fetch SharePoint source PDFs. Ask the user to connect SharePoint first." };
        }
        buffer = await fetchSharepointPdf(src.sharepointDriveId, src.sharepointItemId, msToken);
      } else if (src.source === "dropbox") {
        if (!src.dropboxPath) {
          failures.push(`${src.label || "source"}: missing dropboxPath`);
          continue;
        }
        buffer = await fetchDropboxPdf(src.dropboxPath);
      } else {
        failures.push(`${src.label || "source"}: unknown source type`);
        continue;
      }

      const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const totalPages = sourcePdf.getPageCount();
      const wanted = src.pages
        .map((p) => Math.floor(p) - 1)
        .filter((i) => i >= 0 && i < totalPages);
      if (!wanted.length) {
        failures.push(`${src.label || src.dropboxPath || src.sharepointItemId}: no valid pages (source has ${totalPages} pages)`);
        continue;
      }

      const copied = await out.copyPages(sourcePdf, wanted);
      for (const p of copied) out.addPage(p);
    } catch (err: any) {
      failures.push(`${src.label || "source"}: ${err?.message || "fetch/merge failed"}`);
    }
  }

  if (out.getPageCount() === 0) {
    return { error: `Couldn't assemble any pages. Failures: ${failures.join("; ")}` };
  }

  const pdfBytes = await out.save();
  const buffer = Buffer.from(pdfBytes);
  const safeTitle = args.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60) || "Compiled_Brochure";
  const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeTitle}.pdf`;
  const displayName = `${args.title}.pdf`;
  await saveFile(`chat-media/${storageFilename}`, buffer, "application/pdf", displayName);
  const downloadUrl = `/api/chat-media/${storageFilename}`;

  return {
    success: true,
    title: args.title,
    pageCount: out.getPageCount(),
    sourcesUsed: args.sources.length - failures.length,
    failures: failures.length ? failures : undefined,
    downloadUrl,
    chatMediaFilename: storageFilename,
    downloadMarkdown: `[Download ${displayName}](${downloadUrl})`,
    message: `Stitched ${out.getPageCount()} pages from ${args.sources.length - failures.length}/${args.sources.length} source brochures. Original design preserved.`,
  };
}

// ─── Dropbox → SharePoint bridge ─────────────────────────────────────────────

interface DropboxFileCopy {
  dropboxPath: string;
  renameTo?: string;
}

export interface CopyDropboxToSharepointArgs {
  files: DropboxFileCopy[];
  destinationFolderPath: string;
}

async function ensureSharepointFolder(driveId: string, folderPath: string, msToken: string): Promise<void> {
  const segments = folderPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const seg of segments) {
    const parent = currentPath;
    currentPath = currentPath ? `${currentPath}/${seg}` : seg;
    const checkUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(currentPath).replace(/%2F/g, "/")}`;
    const check = await fetch(checkUrl, { headers: { Authorization: `Bearer ${msToken}` } });
    if (check.ok) continue;
    const createUrl = parent
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(parent).replace(/%2F/g, "/")}:/children`
      : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
    await fetch(createUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: seg, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  }
}

export async function copyDropboxToSharepoint(args: CopyDropboxToSharepointArgs, req: Request): Promise<any> {
  const { getValidMsToken, SHAREPOINT_HOST, SHAREPOINT_SITE_PATH } = await import("./microsoft");
  const msToken = await getValidMsToken(req);
  if (!msToken) return { error: "Microsoft 365 not connected. Ask the user to connect SharePoint first." };

  const spSiteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`, {
    headers: { Authorization: `Bearer ${msToken}` },
  });
  if (!spSiteRes.ok) return { error: "Could not access BGP SharePoint site" };
  const spSite = await spSiteRes.json();

  const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${spSite.id}/drives`, {
    headers: { Authorization: `Bearer ${msToken}` },
  });
  if (!drivesRes.ok) return { error: "Could not access SharePoint drives" };
  const drivesData = await drivesRes.json();
  const docLib = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
  if (!docLib) return { error: "Could not find SharePoint document library" };
  const driveId = docLib.id;

  const folderPath = `BGP share drive/${args.destinationFolderPath.replace(/^\/+|\/+$/g, "")}`;
  await ensureSharepointFolder(driveId, folderPath, msToken);

  const uploaded: any[] = [];
  const failed: any[] = [];

  for (const file of args.files) {
    try {
      const buffer = await fetchDropboxPdf(file.dropboxPath);
      const originalName = file.dropboxPath.split("/").pop() || "file.pdf";
      const uploadName = file.renameTo || originalName;
      const ext = uploadName.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };
      const contentType = mimeMap[ext] || "application/octet-stream";
      const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(folderPath).replace(/%2F/g, "/")}/${encodeURIComponent(uploadName)}:/content`;
      const up = await fetch(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${msToken}`, "Content-Type": contentType },
        body: buffer,
      });
      if (!up.ok) {
        const errText = await up.text();
        failed.push({ dropboxPath: file.dropboxPath, error: `Upload failed: ${up.status} ${errText.slice(0, 200)}` });
        continue;
      }
      const result = await up.json();
      uploaded.push({ fileName: result.name, size: result.size, webUrl: result.webUrl });
    } catch (err: any) {
      failed.push({ dropboxPath: file.dropboxPath, error: err?.message || "copy failed" });
    }
  }

  return {
    success: uploaded.length > 0,
    uploaded: uploaded.length,
    failed: failed.length,
    folder: args.destinationFolderPath,
    files: uploaded,
    failures: failed.length ? failed : undefined,
    message: `Copied ${uploaded.length}/${args.files.length} files from Dropbox to SharePoint folder "${args.destinationFolderPath}".${failed.length ? ` ${failed.length} failed.` : ""}`,
  };
}

// ── PDF signing (sign_pdf / save_signature tools) ────────────────────────
// Woody, 2026-09-05: "Can you add my signature and date this please" on an
// NDA uploaded to chat — ChatBGP had no way to stamp an existing PDF. The
// signature image is stored once per user (uploaded via chat, cleaned to
// transparent-background navy ink); sign_pdf overlays it plus date/name/
// title fields, placed by matching anchor text on the page.

function chatUserId(req: Request): string | null {
  return (req as any).session?.userId || (req as any).tokenUserId || null;
}

const signatureTableReady = pool.query(`
  CREATE TABLE IF NOT EXISTS user_signatures (
    user_id varchar PRIMARY KEY,
    image_png bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`).catch(() => { /* db not ready at import — real queries will surface real errors */ });

// Accept a bare chat-media filename, a full /api/chat-media/<name> URL, or
// the file's original display name (fuzzy, most recent wins).
async function loadChatMedia(nameOrUrl: string): Promise<{ data: Buffer; contentType: string; originalName: string | null } | null> {
  const bare = String(nameOrUrl || "").replace(/^.*\/api\/chat-media\//, "").trim();
  if (!bare) return null;
  const direct = await getFile(`chat-media/${bare}`);
  if (direct) return direct;
  const byName = await findChatMediaByOriginalName(bare);
  return byName ? { data: byName.data, contentType: byName.contentType, originalName: byName.originalName } : null;
}

// Clean a photographed/scanned signature: paper → transparent, ink → navy.
async function cleanSignatureImage(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(input)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1600, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height * 4);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const alpha = brightness >= 200 ? 0 : brightness <= 110 ? 255 : Math.round((255 * (200 - brightness)) / 90);
      const o = (y * width + x) * 4;
      out[o] = 26; out[o + 1] = 35; out[o + 2] = 126; out[o + 3] = alpha; // navy ink
      if (alpha > 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("No ink found in the image — is it a clear photo/scan of a signature on light paper?");
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  return await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ width: 900, withoutEnlargement: true })
    .png()
    .toBuffer();
}

export async function saveUserSignature(args: { chatMediaFilename: string }, req: Request): Promise<any> {
  const userId = chatUserId(req);
  if (!userId) return { error: "Couldn't identify the logged-in user for this chat session." };
  const file = await loadChatMedia(args.chatMediaFilename);
  if (!file) return { error: `File not found in chat uploads: ${args.chatMediaFilename}` };
  if (!/image\//.test(file.contentType || "") && !/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(args.chatMediaFilename)) {
    return { error: `That file doesn't look like an image (${file.contentType}). Upload a photo or scan of the signature.` };
  }
  const png = await cleanSignatureImage(file.data);
  await signatureTableReady;
  await pool.query(
    `INSERT INTO user_signatures (user_id, image_png, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET image_png = $2, updated_at = now()`,
    [userId, png]
  );
  const previewName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-signature-preview.png`;
  await saveFile(`chat-media/${previewName}`, png, "image/png", "signature-preview.png");
  return {
    success: true,
    downloadUrl: `/api/chat-media/${previewName}`,
    downloadMarkdown: `[Preview the stored signature](/api/chat-media/${previewName})`,
    message: "Signature stored (background removed, ink cleaned). It will be used by sign_pdf from now on — show the user the preview link so they can check it.",
  };
}

type TextHit = { pageIndex: number; x: number; y: number; w: number; h: number; str: string };

async function extractPdfText(buffer: Buffer): Promise<TextHit[][]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs") as any;
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;
  const pages: TextHit[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const hits: TextHit[] = [];
    for (const item of content.items as any[]) {
      if (!item?.str || !item.transform) continue;
      const h = Math.hypot(item.transform[2], item.transform[3]) || 10;
      hits.push({ pageIndex: p - 1, x: item.transform[4], y: item.transform[5], w: item.width || 0, h, str: item.str });
    }
    pages.push(hits);
  }
  return pages;
}

// Find the first text item containing `anchor` (case/space-insensitive).
// Falls back to line-level matching for labels split across text items.
function findAnchor(pages: TextHit[][], anchor: string, onlyPage?: number): TextHit | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const target = norm(anchor);
  if (!target) return null;
  const pageOrder = onlyPage != null
    ? [onlyPage]
    : pages.map((_, i) => i).reverse(); // execution blocks live at the back
  for (const pi of pageOrder) {
    const items = pages[pi] || [];
    const hit = items.find(it => norm(it.str).includes(target));
    if (hit) return hit;
    // Line-level: group items by baseline, join left→right.
    const lines = new Map<number, TextHit[]>();
    for (const it of items) {
      const key = Math.round(it.y);
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key)!.push(it);
    }
    for (const line of lines.values()) {
      line.sort((a, b) => a.x - b.x);
      if (norm(line.map(l => l.str).join(" ")).includes(target)) {
        const first = line[0];
        const last = line[line.length - 1];
        return { ...first, w: last.x + last.w - first.x };
      }
    }
  }
  return null;
}

interface SignPdfArgs {
  chatMediaFilename: string;
  page?: number;
  signatureAnchor?: string;
  dateAnchor?: string;
  dateText?: string;
  signerName?: string;
  style?: "image" | "typed" | "auto";
  placement?: "right" | "above" | "auto";
  extraFields?: { anchor: string; text: string }[];
}

export async function signPdf(args: SignPdfArgs, req: Request): Promise<any> {
  const file = await loadChatMedia(args.chatMediaFilename);
  if (!file) return { error: `File not found in chat uploads: ${args.chatMediaFilename}` };

  const pdfDoc = await PDFDocument.load(file.data, { ignoreEncryption: true });
  const pages = await extractPdfText(file.data);
  const onlyPage = args.page != null ? Math.floor(args.page) - 1 : undefined;
  if (onlyPage != null && (onlyPage < 0 || onlyPage >= pdfDoc.getPageCount())) {
    return { error: `Page ${args.page} is out of range — the document has ${pdfDoc.getPageCount()} pages.` };
  }

  // Where does the signature go?
  const sigAnchors = args.signatureAnchor
    ? [args.signatureAnchor]
    : ["signature", "signed for and on behalf", "authorised signatory", "authorized signatory", "signed"];
  let sigHit: TextHit | null = null;
  for (const a of sigAnchors) { sigHit = findAnchor(pages, a, onlyPage); if (sigHit) break; }
  if (!sigHit) {
    const candidates = pages.flatMap(pg => pg.filter(it => /sign|behalf|date|witness/i.test(it.str))
      .map(it => ({ page: it.pageIndex + 1, text: it.str.trim() }))).slice(0, 20);
    return {
      error: `Couldn't find a signature anchor${args.signatureAnchor ? ` matching "${args.signatureAnchor}"` : ""} in the document text. Pass signatureAnchor with the exact label text next to where the signature should go.`,
      candidateAnchors: candidates,
    };
  }

  // Right of a "Label:"/fill-line, above a bare caption — overridable.
  const placeFor = (hit: TextHit, override?: string): "right" | "above" => {
    if (override === "right" || override === "above") return override;
    return /[:_]\s*$|_{3,}/.test(hit.str.trim()) ? "right" : "above";
  };

  const page = pdfDoc.getPage(sigHit.pageIndex);
  const navy = rgb(26 / 255, 35 / 255, 126 / 255);
  const ink = rgb(0.12, 0.12, 0.14);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const plain = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Stored signature image, unless the caller forces typed.
  let sigPngBuf: Buffer | null = null;
  if (args.style !== "typed") {
    await signatureTableReady;
    const userId = chatUserId(req);
    const row = userId ? await pool.query(`SELECT image_png FROM user_signatures WHERE user_id = $1`, [userId]) : { rows: [] as any[] };
    if (row.rows[0]?.image_png) sigPngBuf = row.rows[0].image_png;
    else if (args.style === "image") {
      return { error: "No stored signature for this user yet. Ask them to upload a photo/scan of their signature to the chat, then call save_signature with it — or call sign_pdf with style 'typed'." };
    }
  }

  const sigPlacement = placeFor(sigHit, args.placement === "auto" ? undefined : args.placement);
  // A "Signature: _____" anchor includes the fill line in its width — sit the
  // signature ON the line (a third of the way in), not after its far end.
  const hasFillLine = /_{3,}/.test(sigHit.str);
  const sigX = sigPlacement === "right"
    ? (hasFillLine ? sigHit.x + sigHit.w * 0.32 : sigHit.x + sigHit.w + 10)
    : sigHit.x;
  let styleUsed: "image" | "typed";
  if (sigPngBuf) {
    const img = await pdfDoc.embedPng(sigPngBuf);
    const targetH = 34;
    const scale = Math.min(targetH / img.height, 170 / img.width);
    const w = img.width * scale, h = img.height * scale;
    const sigY = sigPlacement === "right" ? sigHit.y - h * 0.2 : sigHit.y + sigHit.h + 4;
    page.drawImage(img, { x: sigX, y: sigY, width: w, height: h });
    styleUsed = "image";
  } else {
    const name = String(args.signerName || "").trim();
    if (!name) return { error: "signerName is required for a typed signature (no stored signature image)." };
    const sigY = sigPlacement === "right" ? sigHit.y : sigHit.y + sigHit.h + 8;
    page.drawText(name, { x: sigX, y: sigY, size: 21, font: italic, color: navy });
    styleUsed = "typed";
  }

  // Date + any extra printed fields (Name:, Title:, …).
  const fieldsDone: string[] = [];
  const fieldsMissed: string[] = [];
  const drawField = (anchor: string, text: string) => {
    const hit = findAnchor(pages, anchor, sigHit!.pageIndex);
    if (!hit) { fieldsMissed.push(anchor); return; }
    const fp = placeFor(hit);
    const fx = fp === "right" ? hit.x + hit.w + 8 : hit.x;
    const fy = fp === "right" ? hit.y : hit.y + hit.h + 4;
    pdfDoc.getPage(hit.pageIndex).drawText(text, { x: fx, y: fy, size: 11, font: plain, color: ink });
    fieldsDone.push(`${anchor} → ${text}`);
  };
  const dateText = args.dateText || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  if (args.dateAnchor !== "") drawField(args.dateAnchor || "date", dateText);
  for (const f of args.extraFields || []) {
    if (f?.anchor && f?.text) drawField(f.anchor, f.text);
  }

  const pdfBytes = await pdfDoc.save();
  const origBase = (file.originalName || args.chatMediaFilename).replace(/\.pdf$/i, "").replace(/^.*\//, "");
  const safeBase = origBase.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60) || "document";
  const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeBase}_signed.pdf`;
  const displayName = `${origBase} — signed.pdf`;
  await saveFile(`chat-media/${storageFilename}`, Buffer.from(pdfBytes), "application/pdf", displayName);
  const downloadUrl = `/api/chat-media/${storageFilename}`;

  return {
    success: true,
    styleUsed,
    signedOnPage: sigHit.pageIndex + 1,
    anchorUsed: sigHit.str.trim(),
    fieldsFilled: fieldsDone,
    fieldsNotFound: fieldsMissed.length ? fieldsMissed : undefined,
    downloadUrl,
    chatMediaFilename: storageFilename,
    downloadMarkdown: `[Download ${displayName}](${downloadUrl})`,
    message: `Signed on page ${sigHit.pageIndex + 1} (${styleUsed === "image" ? "stored signature image" : "typed italic signature"})${fieldsDone.length ? `, filled: ${fieldsDone.join("; ")}` : ""}. Give the user the download link verbatim, and tell them to check the placement before sending.${styleUsed === "typed" ? " A real signature image can be stored once via save_signature (upload a photo of the signature) for future documents." : ""}`,
  };
}
