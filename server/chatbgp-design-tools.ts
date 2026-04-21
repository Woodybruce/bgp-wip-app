// Design-oriented ChatBGP tools — Gamma for fresh decks, pdf-lib for stitching
// existing brochure pages, and Dropbox→SharePoint bridge for filing raw PDFs.
//
// Each helper returns a chat-media URL the model can hand back to the user as
// a download link. Keeping them in this module keeps chatbgp.ts manageable.

import type { Request } from "express";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { gammaGenerate, gammaWaitFor, gammaDownloadExport, type GammaFormat, type GammaExportAs } from "./gamma";
import { saveFile } from "./file-storage";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { systemSettings } from "@shared/schema";

// ─── Gamma designed-deck generation ──────────────────────────────────────────

export interface DesignedDeckArgs {
  title: string;
  inputText: string;
  format?: GammaFormat;
  numCards?: number;
  themeName?: string;
  exportAs?: GammaExportAs;
  additionalInstructions?: string;
}

export async function generateDesignedDeck(args: DesignedDeckArgs): Promise<any> {
  if (!process.env.GAMMA_API_KEY) {
    return { error: "GAMMA_API_KEY not configured on the server. Ask an admin to add it in Railway." };
  }

  if (!args.inputText || args.inputText.length < 50) {
    return { error: "inputText too short — provide at least 50 characters of content. The richer the text, the better the design." };
  }

  const format: GammaFormat = args.format || "document";
  const exportAs: GammaExportAs = args.exportAs || "pdf";

  const { generationId } = await gammaGenerate({
    inputText: args.inputText,
    format,
    exportAs,
    numCards: args.numCards,
    themeName: args.themeName,
    additionalInstructions: args.additionalInstructions,
  });

  const gen = await gammaWaitFor(generationId, { timeoutMs: 6 * 60 * 1000, intervalMs: 5000 });
  if (!gen.exportUrl) return { error: "Gamma generation completed but returned no export URL." };

  const buffer = await gammaDownloadExport(gen.exportUrl);
  const safeTitle = args.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60) || "Designed_Deck";
  const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeTitle}.${exportAs}`;
  const displayName = `${args.title}.${exportAs}`;
  const mime = exportAs === "pptx"
    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    : "application/pdf";
  await saveFile(`chat-media/${storageFilename}`, buffer, mime, displayName);
  const downloadUrl = `/api/chat-media/${storageFilename}`;

  return {
    success: true,
    title: args.title,
    format,
    exportAs,
    gammaUrl: gen.gammaUrl,
    downloadUrl,
    chatMediaFilename: storageFilename,
    downloadMarkdown: `[Download ${displayName}](${downloadUrl})`,
    message: `Generated a designed ${format} "${args.title}" via Gamma. Open in the browser with the Gamma link, or download the ${exportAs.toUpperCase()}.`,
  };
}

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
  const { getValidMsToken } = await import("./microsoft");
  const msToken = await getValidMsToken(req);
  if (!msToken) return { error: "Microsoft 365 not connected. Ask the user to connect SharePoint first." };

  const spSiteRes = await fetch("https://graph.microsoft.com/v1.0/sites/brucegillinghampollard.sharepoint.com:/sites/BGPsharedrive", {
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
