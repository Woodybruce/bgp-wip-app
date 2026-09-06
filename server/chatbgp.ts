import type { Express, Request, Response as ExpressResponse } from "express";
type Response = ExpressResponse;
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { db, pool } from "./db";
import { eq, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import multer from "multer";
import { parseSlashCommand, setThreadModel, resolveChatModel, ackMessage } from "./chatbgp-model-router";
import { APP_MAP } from "./chatbgp-app-map";
import mammoth from "mammoth";
import { getValidMsToken, SHAREPOINT_HOST, SHAREPOINT_SITE_PATH } from "./microsoft";
import { getFile, saveFile, findChatMediaByOriginalName, searchChatMedia, getRecentUserUploads } from "./file-storage";
import { rectifyRows, fixPptxSchemaViolations } from "./pptx-rectify";

// Build a branded BGP deck PPTX (via the shared deck-engine card system) from
// either the rich card model (fnArgs.cards) or the legacy {title, subtitle,
// slides:[{title,bullets,table,notes}]} shape. Legacy slides are mapped to
// content/table/board cards so even old-style calls get the on-brand engine.
async function buildDeckPptxFromArgs(fnArgs: any): Promise<{ buffer: Buffer; safeName: string; slideCount: number }> {
  const { assembleDeckPptx } = await import("./deck-engine");
  const title = String(fnArgs?.title || "Presentation");
  let cards: any[] = Array.isArray(fnArgs?.cards) ? fnArgs.cards : [];
  if (!cards.length) {
    cards.push({ type: "cover", title, subtitle: fnArgs?.subtitle || "", eyebrow: fnArgs?.eyebrow || "Bruce Gillingham Pollard" });
    for (const sd of (Array.isArray(fnArgs?.slides) ? fnArgs.slides : [])) {
      const hasT = sd?.table?.headers && sd?.table?.rows;
      const hasB = Array.isArray(sd?.bullets) && sd.bullets.length > 0;
      if (hasT && hasB) cards.push({ type: "board", title: sd.title, blocks: [
        { kind: "text", col: 0, colSpan: 6, row: 0, rowSpan: 1, bullets: sd.bullets },
        { kind: "table", col: 6, colSpan: 6, row: 0, rowSpan: 1, headers: sd.table.headers, rows: sd.table.rows },
      ] });
      else if (hasT) cards.push({ type: "table", title: sd.title, headers: sd.table.headers, rows: sd.table.rows });
      else cards.push({ type: "content", title: sd.title, bullets: sd.bullets || [] });
    }
  }
  const raw = await assembleDeckPptx({ cards });
  const buffer = await fixPptxSchemaViolations(raw); // polish OOXML so PowerPoint won't demand a "repair"
  const safeName = (title.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_")) || "Presentation";
  return { buffer, safeName, slideCount: cards.length };
}
import { escapeLike } from "./utils/escape-like";
import { askPerplexity, isPerplexityConfigured } from "./perplexity";
import type { CrmProperty, CrmDeal, CrmCompany, CrmContact } from "@shared/schema";
import { resolveCompanyScope, isPropertyInScope } from "./company-scope";

const CHATBGP_MODEL = "claude-sonnet-4-6";      // Lightweight sub-tasks only — the main chat defaults to Fable 5 via chatbgp-model-router.
const CHATBGP_OPUS_MODEL = "claude-opus-4-8";   // Heavy reasoning fallback tier.
const CHATBGP_HELPER_MODEL = "claude-haiku-4-5-20251001"; // Background tasks: Haiku for cost savings

// Fable 5: safety classifiers can decline a request with stop_reason
// "refusal". The server-side fallback re-serves declined requests on Opus
// inside the same API call (requires the beta messages endpoint).
function isFableModel(model: string): boolean {
  return model.startsWith("claude-fable");
}

function applyFableParams(claudeParams: any): void {
  claudeParams.betas = ["server-side-fallback-2026-06-01"];
  claudeParams.fallbacks = [{ model: CHATBGP_OPUS_MODEL }];
}

const REFUSAL_REPLY = "I can't help with that particular request.";

// PowerPoint/Excel reject XML-1.0-invalid control characters (common in text
// extracted from PDFs) with a "repair this file?" prompt that strips content.
// pptxgenjs/exceljs escape XML entities but pass control characters through,
// so strip them before any Office file is built.
function cleanOfficeText(v: any): string {
  return String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, "");
}

// Shared non-PDF body reader for ingest_url (both executors). Handles ZIP
// downloads — Propel's monthly multi-site database, research packs sent as
// zipped workbooks — by unpacking in memory and reading the spreadsheets/
// PDFs/text inside (Woody, 2026-08-31: a Mailchimp ZIP link came back as
// raw binary). Download trackers often serve octet-stream, so the PK magic
// bytes are sniffed as well as the content-type. Falls through to the
// original HTML-strip path for everything else.
async function ingestNonPdfBody(response: globalThis.Response, targetUrl: string, contentType: string): Promise<{ title: string; extractedText: string }> {
  const rawBuf = Buffer.from(await response.arrayBuffer());
  const isZip = contentType.includes("zip") || /\.zip($|\?)/i.test(targetUrl) ||
    (rawBuf.length > 4 && rawBuf[0] === 0x50 && rawBuf[1] === 0x4b && rawBuf[2] === 0x03 && rawBuf[3] === 0x04 && !contentType.includes("html"));
  if (isZip) {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(rawBuf);
    const entries = zip.getEntries().filter((e: any) => !e.isDirectory && !e.entryName.startsWith("__MACOSX"));
    let title = decodeURIComponent((targetUrl.split("/").pop() || "").replace(/\?.*$/, "")) || "ZIP archive";
    const parts: string[] = [`ZIP archive — ${entries.length} file(s): ${entries.map((e: any) => e.entryName).join(", ")}`];
    for (const e of entries.slice(0, 5)) {
      const name = e.entryName.toLowerCase();
      const data = e.getData();
      try {
        if (/\.(xlsx|xls|csv)$/.test(name)) {
          const XLSX = (await import("xlsx")).default;
          const wb = XLSX.read(data, { type: "buffer" });
          title = e.entryName.replace(/^.*\//, "").replace(/\.(xlsx|xls|csv)$/i, "");
          // Stage EVERY row into Postgres so sql_query can work over the
          // whole file — the preview below is capped, but a 3,700-row
          // operator database is only useful if all of it is queryable
          // (Woody, 2026-08-31: "it needs to have all the tools you do").
          // Re-ingesting the same file replaces its previous rows.
          const ingestKey = e.entryName.replace(/^.*\//, "").toLowerCase().replace(/\.(xlsx|xls|csv)$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "spreadsheet";
          // Sheets without a header row (the Propel "Company" sheet) would
          // otherwise get keyed by the first data row's values — detect that
          // and fall back to column letters so SQL keys stay sane.
          const readSheetRows = (sheet: any): { rows: any[]; headerless: boolean } => {
            let rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
            if (rows.length) {
              const keys = Object.keys(rows[0]);
              const suspect = keys.filter(k => /^__EMPTY/.test(k) || /^\d+(\.\d+)?$/.test(String(k).trim())).length;
              if (suspect >= Math.max(1, Math.floor(keys.length * 0.2))) {
                return { rows: XLSX.utils.sheet_to_json(sheet, { defval: null, header: "A" }), headerless: true };
              }
            }
            return { rows, headerless: false };
          };
          let staged: { loaded: boolean; error?: string } = { loaded: false };
          try {
            const { pool } = await import("./db");
            await pool.query(`
              CREATE TABLE IF NOT EXISTS ingested_spreadsheet_rows (
                id BIGSERIAL PRIMARY KEY,
                ingest_key TEXT NOT NULL,
                file_name TEXT NOT NULL,
                sheet_name TEXT NOT NULL,
                row_num INTEGER NOT NULL,
                data JSONB NOT NULL,
                source_url TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
              );
              CREATE INDEX IF NOT EXISTS idx_ingested_rows_key ON ingested_spreadsheet_rows (ingest_key, sheet_name);`);
            for (const sheetName of wb.SheetNames.slice(0, 5)) {
              const { rows } = readSheetRows(wb.Sheets[sheetName]);
              if (!rows.length) continue;
              await pool.query(`DELETE FROM ingested_spreadsheet_rows WHERE ingest_key = $1 AND sheet_name = $2`, [ingestKey, sheetName]);
              const capped = rows.slice(0, 20000);
              for (let i = 0; i < capped.length; i += 500) {
                const batch = capped.slice(i, i + 500);
                const values: string[] = [];
                const params: any[] = [];
                batch.forEach((row, j) => {
                  const base = j * 6;
                  values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
                  params.push(ingestKey, e.entryName, sheetName, i + j + 1, JSON.stringify(row), targetUrl.slice(0, 500));
                });
                await pool.query(`INSERT INTO ingested_spreadsheet_rows (ingest_key, file_name, sheet_name, row_num, data, source_url) VALUES ${values.join(", ")}`, params);
              }
              staged = { loaded: true };
            }
          } catch (stageErr: any) {
            staged = { loaded: false, error: stageErr?.message };
          }
          for (const sheetName of wb.SheetNames.slice(0, 5)) {
            const { rows: sheetRows, headerless } = readSheetRows(wb.Sheets[sheetName]);
            const headers = sheetRows.length ? Object.keys(sheetRows[0]) : [];
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
            const lines = csv.split("\n").filter(l => l.replace(/,/g, "").trim());
            const stagedNote = staged.loaded && sheetRows.length
              ? `\nFULL SHEET QUERYABLE: all ${Math.min(sheetRows.length, 20000)} rows are staged in Postgres — use sql_query on ingested_spreadsheet_rows WHERE ingest_key = '${ingestKey}' AND sheet_name = '${sheetName}'. Each row's cells are in the jsonb "data" column${headerless ? " keyed by COLUMN LETTER (A, B, C…) because this sheet has no header row — work out what each column holds from the preview rows above" : " keyed by header"}, e.g. SELECT data->>'${(headers[0] || "Column").replace(/'/g, "''")}' FROM ingested_spreadsheet_rows WHERE ingest_key = '${ingestKey}'. Columns: ${headers.slice(0, 25).join(", ")}. Use this for any cross-referencing or filtering over the whole file instead of the preview above.`
              : (staged.error ? `\n(Could not stage full rows for SQL: ${staged.error} — only the preview above is available.)` : "");
            parts.push(`--- ${e.entryName} · sheet "${sheetName}" · ${lines.length} data rows ---\n` +
              lines.slice(0, 400).join("\n") +
              (lines.length > 400 ? `\n… ${lines.length - 400} more preview rows not shown.` : "") +
              stagedNote);
          }
        } else if (name.endsWith(".pdf")) {
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse(new Uint8Array(data));
          const textResult = await parser.getText();
          parts.push(`--- ${e.entryName} ---\n${textResult.pages.map((p: any) => p.text || "").join("\n\n").slice(0, 8000)}`);
        } else if (/\.(txt|json|md)$/.test(name)) {
          parts.push(`--- ${e.entryName} ---\n${data.toString("utf8").slice(0, 8000)}`);
        } else {
          parts.push(`--- ${e.entryName} (${data.length} bytes — format not extracted) ---`);
        }
      } catch (entryErr: any) {
        parts.push(`--- ${e.entryName} — could not extract: ${entryErr?.message} ---`);
      }
    }
    return { title, extractedText: parts.join("\n\n") };
  }
  const html = rawBuf.toString("utf8");
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : "Web Page",
    extractedText: html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

// Resolve a list of chat-media filenames into Graph fileAttachment payloads
// (base64 + contentType + filename). Each filename is expected to already
// exist in chat-media storage — anything we can't find is dropped with a
// warning rather than failing the whole email send. Output is consumed by
// sendFromSharedMailbox / replyToSharedMailboxMessage which forward it
// to /me/sendMail via Graph.
async function resolveChatMediaAttachments(
  filenames: unknown,
): Promise<Array<{ name: string; contentType: string; contentBytes: string }>> {
  if (!Array.isArray(filenames) || filenames.length === 0) return [];
  const { getFile } = await import("./file-storage");
  const out: Array<{ name: string; contentType: string; contentBytes: string }> = [];
  for (const raw of filenames) {
    if (typeof raw !== "string" || !raw) continue;
    // Accept either a bare filename or a full /api/chat-media/<filename> URL.
    const filename = raw.split("/").pop()!.split("?")[0];
    if (!filename || filename.includes("..") || filename.includes("/")) continue;
    try {
      const file = await getFile(`chat-media/${filename}`);
      if (!file) {
        console.warn(`[send_email] chat-media attachment not found: ${filename}`);
        continue;
      }
      out.push({
        name: file.originalName || filename,
        contentType: file.contentType || "application/octet-stream",
        contentBytes: file.data.toString("base64"),
      });
    } catch (e: any) {
      console.warn(`[send_email] failed to load attachment ${filename}:`, e?.message);
    }
  }
  return out;
}

function sanitiseForPdf(text: string): string {
  const emojiMap: Record<string, string> = {
    "\u{1F4A1}": "\u2737 ",  "\u{1F4BB}": "",  "\u{1F4F1}": "",
    "\u{1F5A5}": "",  "\u{2699}": "",  "\u{26A0}": "\u25B6 ",
    "\u{2757}": "\u25B6 ",  "\u{2714}": "\u2713 ",  "\u{274C}": "x ",
    "\u{1F4E7}": "",  "\u{1F4E9}": "",  "\u{1F4CE}": "",
    "\u{1F4C4}": "",  "\u{1F4C1}": "",  "\u{1F4C2}": "",
    "\u{1F4CA}": "",  "\u{1F4C8}": "",  "\u{1F4C9}": "",
    "\u{1F4CC}": "",  "\u{1F4DD}": "",  "\u{1F4CD}": "",
    "\u{1F50D}": "",  "\u{1F512}": "",  "\u{1F513}": "",
    "\u{1F310}": "",  "\u{1F3E2}": "",  "\u{1F3E0}": "",
    "\u{1F4B0}": "",  "\u{1F4B7}": "",  "\u{1F4B5}": "",
    "\u{1F46B}": "",  "\u{1F464}": "",  "\u{1F465}": "",
    "\u{1F44D}": "",  "\u{1F44E}": "",  "\u{1F44B}": "",
    "\u{2B50}": "\u2605 ",  "\u{1F31F}": "\u2605 ",  "\u{2728}": "",
    "\u{1F525}": "",  "\u{1F3AF}": "",  "\u{1F680}": "",
    "\u{2705}": "\u2713 ",  "\u{1F4F0}": "",  "\u{1F4AC}": "",
    "\u{1F4DE}": "",  "\u{2709}": "",  "\u{1F4E4}": "",
    "\u{1F4E5}": "",  "\u{1F6E0}": "",  "\u{1F527}": "",
    "\u{1F4A4}": "",  "\u{1F4A5}": "",
    "\u{1F4E2}": "\u25B6 ",  "\u{1F514}": "\u25B6 ",
    "\u{1F4CB}": "",  "\u{1F4D1}": "",  "\u{1F4D2}": "",
    "\u{1F4D3}": "",  "\u{1F4D4}": "",  "\u{1F4D5}": "",
    "\u{1F4D6}": "",  "\u{1F4D7}": "",  "\u{1F4D8}": "",
    "\u{1F4D9}": "",  "\u{1F4DA}": "",
    "\u{1F4E6}": "",  "\u{1F4E8}": "",
    "\u{1F4F2}": "",  "\u{1F4F3}": "",  "\u{1F4F4}": "",
    "\u{1F4F5}": "",  "\u{1F4F6}": "",  "\u{1F4F7}": "",
    "\u{1F4F8}": "",  "\u{1F4F9}": "",  "\u{1F4FA}": "",
    "\u{1F4FB}": "",  "\u{1F4FC}": "",  "\u{1F4FD}": "",
    "\u{1F4FE}": "",  "\u{1F4FF}": "",
    "\u{1F9E9}": "",  "\u{1F9F0}": "",
    "\u{2753}": "? ",  "\u{2754}": "? ",  "\u{2755}": "! ",
    "\u{2764}": "",  "\u{1F49A}": "",  "\u{1F499}": "",
    "\u{1F49B}": "",  "\u{1F49C}": "",  "\u{1F49D}": "",
    "\u{1F4AF}": "",
    "\u{1F389}": "",  "\u{1F38A}": "",
    "\u{1F449}": "\u25B6 ",  "\u{1F448}": "",
    "\u{261D}": "",  "\u{270B}": "",  "\u{270C}": "",
  };
  let result = text;
  for (const [emoji, replacement] of Object.entries(emojiMap)) {
    result = result.split(emoji).join(replacement);
  }
  result = result
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/[\u{20E3}]/gu, "")
    .replace(/[\u{E0020}-\u{E007F}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return result;
}


interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const contextCache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = contextCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    contextCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  contextCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// Graph $search takes KQL. The model sometimes passes multi-term queries like
// "Ottolenghi" OR "Kricket" — blindly wrapping those in another pair of quotes
// produces invalid KQL ("" at the start) and Graph rejects the whole request.
// Only wrap bare phrases; queries that already carry quotes or uppercase
// KQL operators pass through as-is. Unbalanced quotes also 400, so strip
// them when the count is odd.
function toGraphSearchQuery(raw: string): string {
  const q = String(raw || "").trim();
  const quoteCount = (q.match(/"/g) || []).length;
  const balanced = quoteCount % 2 === 0 ? q : q.replace(/"/g, "");
  if (balanced.includes('"') || /\b(OR|AND|NOT)\b/.test(balanced)) return balanced;
  return `"${balanced}"`;
}

// Shared implementation of the search_emails tool, used by two handler sites.
// - Default (no mailbox arg): uses the current user's delegated token on /me/messages.
// - mailbox === "all": fans out across the shared inbox + every active BGP user's mailbox
//   via the app-only token on /users/{email}/messages (requires Mail.Read Application).
// - mailbox === specific email: uses the app-only token to search just that mailbox.
//
// Exported so the property-pathway email investigator can reuse the same
// fan-out semantics ChatBGP gets — searching across all 31 BGP mailboxes.
export async function runSearchEmailsTool(opts: { query: string; top: number; mailbox: string; req: any }):
  Promise<{ messages: any[]; scope: string } | { error: string }> {
  const { query, top, mailbox, req } = opts;
  const mapMsg = (msg: any, via?: string, mailboxEmail?: string) => ({
    id: msg.id,
    subject: (msg.subject || "(No subject)") + (via ? ` · via ${via}` : ""),
    from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown",
    fromEmail: msg.from?.emailAddress?.address || "",
    to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", "),
    date: msg.receivedDateTime,
    preview: (msg.bodyPreview || "").slice(0, 200).replace(/\n/g, " "),
    isRead: msg.isRead,
    hasAttachments: msg.hasAttachments,
    msgId: msg.id,
    // CRITICAL: Graph message IDs are mailbox-scoped. To download attachments
    // from a message found in another user's mailbox, we need the mailbox
    // address to route via /users/{email}/messages/{id}/attachments with the
    // app token. Surface it so the model knows to pass it through.
    mailboxEmail: mailboxEmail || undefined,
  });
  const selectFields = "id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,conversationId";

  // App-token path (used for mailbox=email or mailbox=all)
  if (mailbox && mailbox !== "me") {
    try {
      const { graphRequest } = await import("./shared-mailbox");

      // Build the list of mailboxes to query
      const mailboxes: Array<{ email: string; owner: string }> = [];
      if (mailbox === "all") {
        const { db } = await import("./db");
        const { users } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        mailboxes.push({ email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox" });
        try {
          const activeUsers = await db
            .select({ username: users.username, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.isActive, true));
          for (const u of activeUsers) {
            const mb = u.email || u.username;
            if (mb && /@brucegillinghampollard\.com$/i.test(mb) && mb.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
              mailboxes.push({ email: mb, owner: u.name || mb });
            }
          }
        } catch {}
      } else {
        mailboxes.push({ email: mailbox, owner: mailbox });
      }

      const seen = new Set<string>();
      const collected: any[] = [];
      const errors: string[] = [];
      for (const mb of mailboxes) {
        try {
          const url = `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(toGraphSearchQuery(query))}&$top=${top}&$select=${encodeURIComponent(selectFields)}`;
          const data = await graphRequest(url);
          for (const msg of data?.value || []) {
            if (seen.has(msg.id)) continue;
            seen.add(msg.id);
            collected.push(mapMsg(msg, mailbox === "all" ? mb.owner : undefined, mb.email));
          }
        } catch (err: any) {
          errors.push(`${mb.email}: ${String(err?.message || err).slice(0, 120)}`);
        }
      }
      collected.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const scope = mailbox === "all" ? `${mailboxes.length} mailboxes` : mailbox;
      if (collected.length === 0 && errors.length > 0) {
        return { error: `No results, and all mailboxes errored. First: ${errors[0]}` };
      }
      return { messages: collected.slice(0, top), scope };
    } catch (err: any) {
      return { error: `App-token search setup error: ${err?.message || "unknown"}` };
    }
  }

  // Default path: delegated /me/messages
  try {
    const token = await getValidMsToken(req);
    if (!token) return { error: "Not connected to Microsoft 365. Please sign in first." };
    const url = "https://graph.microsoft.com/v1.0/me/messages?" + new URLSearchParams({
      $search: toGraphSearchQuery(query),
      $top: String(top),
      $select: selectFields,
    });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    if (!res.ok) {
      const errText = await res.text();
      return { error: `Email search failed: ${res.status} ${errText.slice(0, 200)}` };
    }
    const data = await res.json();
    const messages = (data.value || [])
      .sort((a: any, b: any) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime())
      .map((msg: any) => mapMsg(msg));
    return { messages, scope: "my inbox" };
  } catch (err: any) {
    return { error: `Email search error: ${err?.message || "unknown"}` };
  }
}

// Shared implementation of the search_calendar tool. Mirrors
// runSearchEmailsTool — same mailbox fan-out semantics, same auth paths,
// same shape of return value but for Outlook calendar events.
//
// Used by ChatBGP itself and by the AI activity curator
// (server/ai-activity-curator.ts) when it needs to find historic
// meetings about a deal / brand / landlord across all 31 BGP mailboxes.
//
// IMPLEMENTATION NOTE: Graph rejects $search on /events ("Graph $search
// isn't supported on Events at the moment"). We use /calendarView with a
// date range and filter for the query term client-side over subject/body/
// location/attendees/organiser. Same end result — the tool DOES support
// keyword search, just not via Graph's native operator.
//
// Date-bounded by optional startDateTime / endDateTime params (default:
// last 18 months to next 6 months — covers most "is there a meeting about
// X?" needs).
export async function runSearchCalendarTool(opts: {
  query: string;
  top: number;
  mailbox: string;
  startDateTime?: string;
  endDateTime?: string;
  req: any;
}): Promise<{ events: any[]; scope: string } | { error: string }> {
  const { query, top, mailbox, req } = opts;

  // Default to last 18 months → next 6 months. Wide enough to catch the
  // historic comms a deal / brand curation typically wants.
  const defaultStart = new Date(); defaultStart.setMonth(defaultStart.getMonth() - 18);
  const defaultEnd = new Date(); defaultEnd.setMonth(defaultEnd.getMonth() + 6);
  const startDateTime = opts.startDateTime || defaultStart.toISOString();
  const endDateTime = opts.endDateTime || defaultEnd.toISOString();

  const mapEvent = (ev: any, via?: string, mailboxEmail?: string) => ({
    id: ev.id,
    eventId: ev.id,
    subject: (ev.subject || "(No subject)") + (via ? ` · via ${via}` : ""),
    organiser: ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || "Unknown",
    organiserEmail: ev.organizer?.emailAddress?.address || "",
    start: ev.start?.dateTime || null,
    end: ev.end?.dateTime || null,
    location: ev.location?.displayName || null,
    isAllDay: !!ev.isAllDay,
    isCancelled: !!ev.isCancelled,
    attendees: (ev.attendees || []).map((a: any) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean).slice(0, 20),
    preview: (ev.bodyPreview || "").slice(0, 200).replace(/\n/g, " "),
    // Mailbox-scoped event ID — caller must pass mailboxEmail back to
    // /api/activity/meeting/:mailbox/:eventId or any /events/{id} call.
    mailboxEmail: mailboxEmail || undefined,
  });

  const selectFields = "id,subject,start,end,location,organizer,attendees,isAllDay,isCancelled,bodyPreview";

  // App-token path (mailbox=email or mailbox=all)
  if (mailbox && mailbox !== "me") {
    try {
      const { graphRequest } = await import("./shared-mailbox");
      const mailboxes: Array<{ email: string; owner: string }> = [];
      if (mailbox === "all") {
        const { db } = await import("./db");
        const { users } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        mailboxes.push({ email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox" });
        try {
          const activeUsers = await db
            .select({ username: users.username, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.isActive, true));
          for (const u of activeUsers) {
            const mb = u.email || u.username;
            if (mb && /@brucegillinghampollard\.com$/i.test(mb) && mb.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
              mailboxes.push({ email: mb, owner: u.name || mb });
            }
          }
        } catch {}
      } else {
        mailboxes.push({ email: mailbox, owner: mailbox });
      }

      const seen = new Set<string>();
      const collected: any[] = [];
      const errors: string[] = [];
      // Graph rejects $search on /events ("Graph $search isn't supported on
      // Events at the moment"), so we use /calendarView with a date range
      // and filter for the query term client-side over subject/body/location/
      // attendees. CalendarView also expands recurring instances, which is
      // what we want for "find a meeting about X" anyway.
      const q = (query || "").toLowerCase().trim();
      const matchesQuery = (ev: any) => {
        if (!q) return true;
        const hay = [
          ev.subject || "",
          ev.bodyPreview || "",
          ev.location?.displayName || "",
          ...(ev.attendees || []).flatMap((a: any) => [a.emailAddress?.name || "", a.emailAddress?.address || ""]),
          ev.organizer?.emailAddress?.name || "",
          ev.organizer?.emailAddress?.address || "",
        ].join(" ").toLowerCase();
        return hay.includes(q);
      };
      for (const mb of mailboxes) {
        try {
          const url = `/users/${encodeURIComponent(mb.email)}/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$top=${Math.max(top * 4, 50)}&$select=${encodeURIComponent(selectFields)}&$orderby=${encodeURIComponent("start/dateTime desc")}`;
          const data = await graphRequest(url, { headers: { Prefer: "outlook.timezone=\"Europe/London\"" } });
          for (const ev of data?.value || []) {
            if (seen.has(ev.id)) continue;
            if (!matchesQuery(ev)) continue;
            seen.add(ev.id);
            collected.push(mapEvent(ev, mailbox === "all" ? mb.owner : undefined, mb.email));
          }
        } catch (err: any) {
          errors.push(`${mb.email}: ${String(err?.message || err).slice(0, 120)}`);
        }
      }
      collected.sort((a, b) => new Date(b.start || 0).getTime() - new Date(a.start || 0).getTime());
      const scope = mailbox === "all" ? `${mailboxes.length} calendars` : mailbox;
      if (collected.length === 0 && errors.length > 0) {
        return { error: `No results, and all calendars errored. First: ${errors[0]}` };
      }
      return { events: collected.slice(0, top), scope };
    } catch (err: any) {
      return { error: `App-token calendar search setup error: ${err?.message || "unknown"}` };
    }
  }

  // Default path: delegated /me/calendarView (Graph rejects $search on events)
  try {
    const token = await getValidMsToken(req);
    if (!token) return { error: "Not connected to Microsoft 365. Please sign in first." };
    const q = (query || "").toLowerCase().trim();
    const matchesQuery = (ev: any) => {
      if (!q) return true;
      const hay = [
        ev.subject || "",
        ev.bodyPreview || "",
        ev.location?.displayName || "",
        ...(ev.attendees || []).flatMap((a: any) => [a.emailAddress?.name || "", a.emailAddress?.address || ""]),
        ev.organizer?.emailAddress?.name || "",
        ev.organizer?.emailAddress?.address || "",
      ].join(" ").toLowerCase();
      return hay.includes(q);
    };
    const url = "https://graph.microsoft.com/v1.0/me/calendarView?" + new URLSearchParams({
      startDateTime,
      endDateTime,
      $top: String(Math.max(top * 4, 50)),
      $select: selectFields,
      $orderby: "start/dateTime desc",
    });
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: "outlook.timezone=\"Europe/London\"", "Content-Type": "application/json" } });
    if (!res.ok) {
      const errText = await res.text();
      return { error: `Calendar search failed: ${res.status} ${errText.slice(0, 200)}` };
    }
    const data = await res.json();
    const events = (data.value || [])
      .filter((ev: any) => matchesQuery(ev))
      .slice(0, top)
      .map((ev: any) => mapEvent(ev));
    return { events, scope: "my calendar" };
  } catch (err: any) {
    return { error: `Calendar search error: ${err?.message || "unknown"}` };
  }
}

export function invalidateContextCache(prefix?: string): void {
  if (!prefix) {
    contextCache.clear();
    return;
  }
  for (const key of contextCache.keys()) {
    if (key.startsWith(prefix)) contextCache.delete(key);
  }
}

setInterval(() => {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of contextCache.entries()) {
    if (now > entry.expiresAt) {
      contextCache.delete(key);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[cache] Pruned ${pruned} expired entries (${contextCache.size} remaining)`);
}, 5 * 60 * 1000);

function getToolProgressLabel(toolName: string): string {
  const labels: Record<string, string> = {
    search_crm: "Searching CRM...",
    web_search: "Searching the web...",
    ingest_url: "Reading page...",
    follow_url: "Adding to news feed...",
    property_lookup: "Looking up property data...",
    get_property_planning: "Pulling planning constraints + recent applications...",
    property_data_lookup: "Querying PropertyData...",
    deep_investigate: "Running deep investigation...",
    rocketreach_person_lookup: "Looking up verified contact details...",
    perplexity_people_search: "Searching for the right person...",
    find_similar_brands: "Finding similar brands...",
    get_aged_receivables: "Pulling invoice positions from Xero...",
    search_food_hygiene: "Checking the FSA hygiene register...",
    run_kyc_check: "Running KYC check...",
    create_deal: "Creating deal...",
    update_deal: "Updating deal...",
    create_contact: "Creating contact...",
    update_contact: "Updating contact...",
    create_company: "Creating company...",
    update_company: "Updating company...",
    get_company_accounts: "Reading filed accounts...",
    create_property: "Creating property...",
    upsert_tenancy_schedule: "Updating tenancy schedule...",
    add_property_imagery: "Attaching imagery...",
    create_requirement: "Logging requirement...",
    create_available_unit: "Creating unit...",
    update_available_unit: "Updating unit...",
    create_targeting_brief: "Creating targeting brief...",
    find_duplicate_properties: "Scanning for duplicates...",
    merge_properties: "Merging properties...",
    reconcile_tenancy_rows: "Reconciling tenancy rows...",
    run_brand_enrichment_backfill: "Enriching brands from logo.dev...",
    create_investment_tracker: "Adding to tracker...",
    update_investment_tracker: "Updating tracker...",
    send_email: "Sending email...",
    reply_email: "Replying to email...",
    search_emails: "Searching emails...",
    search_calendar: "Searching calendars...",
    query_calendar: "Checking calendar...",
    query_wip: "Querying pipeline...",
    query_xero: "Looking up invoices...",
    export_to_excel: "Generating Excel file...",
    generate_word: "Generating Word document...",
    generate_pptx: "Generating PowerPoint...",
    generate_why_buy_deck: "Building the Why Buy deck...",
    generate_document: "Generating document...",
    generate_brief_document: "Generating with Claude design...",
    sign_pdf: "Signing the document...",
    save_signature: "Storing your signature...",
    generate_image: "Generating image...",
    browse_sharepoint_folder: "Browsing SharePoint...",
    read_sharepoint_file: "Reading file...",
    search_news: "Searching news...",
    search_green_street: "Searching Green Street...",
    manage_chat_members: "Updating chat members...",
    query_leasing_schedule: "Querying leasing schedule...",
    import_leasing_schedule: "Importing leasing schedule...",
    query_turnover: "Querying turnover data...",
    tfl_nearby: "Finding nearby stations...",
    scan_duplicates: "Scanning for duplicates...",
    navigate_to: "Navigating...",
    transcribe_audio: "Transcribing audio...",
    save_learning: "Saving to memory...",
    edit_source_file: "Editing source code...",
    read_source_file: "Reading source code...",
    run_shell_command: "Running command...",
    bulk_update_crm: "Bulk updating CRM...",
    delete_record: "Deleting record...",
    log_viewing: "Logging viewing...",
    log_offer: "Logging offer...",
    create_diary_entry: "Creating diary entry...",
    create_comp: "Creating comp...",
    run_model: "Running financial model...",
    restart_application: "Restarting app...",
    send_whatsapp: "Sending WhatsApp...",
    trigger_archivist_crawl: "Triggering document crawl...",
    manage_tasks: "Managing tasks...",
    search_knowledge_base: "Searching the memory bank...",
    search_chat_history: "Searching past chats...",
    create_document_template: "Creating template...",
    create_sharepoint_folder: "Creating folder...",
    move_sharepoint_item: "Moving file...",
    get_email_attachments: "Getting attachments...",
    download_email_attachment: "Downloading attachment...",
    list_project_files: "Browsing project files...",
    add_database_column: "Adding database column...",
    log_app_feedback: "Logging feedback...",
    link_records: "Linking records...",
    request_app_change: "Requesting app change...",
    browse_dropbox: "Browsing Dropbox...",
  };
  return labels[toolName] || `Running ${toolName.replace(/_/g, " ")}...`;
}

function getAnthropicClient(useDirect = false) {
  if (useDirect && process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  // Use integration key if available, otherwise fall back to direct key
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const opts: any = { apiKey };
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    opts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  }
  return new Anthropic(opts);
}

function convertToolsForClaude(tools: any[]): any[] {
  const converted = tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
  // Prompt-cache the tool block: ~100 tool definitions are tens of
  // thousands of input tokens resent on EVERY ChatBGP turn. Marking the
  // last tool caches the whole prefix (tools precede system in the cache
  // hierarchy) at ~10% of input price on cache hits, and speeds up TTFT.
  // The system prompt already carries its own cache_control breakpoint.
  if (converted.length > 0) {
    (converted[converted.length - 1] as any).cache_control = { type: "ephemeral" };
  }
  return converted;
}

// Claude vision only accepts jpeg / png / gif / webp. iPhone uploads
// (.heic), Android (.bmp), and any other format trip a 400. Plus a
// single message with multiple unresized photos easily blows past the
// 32MB request cap (413). This helper:
//   1. Converts non-supported formats to JPEG.
//   2. Resizes anything wider than 1600px so a 12MP iPhone shot drops
//      from ~3MB to ~250KB.
//   3. Strips EXIF (orientation already applied) so we don't pay for
//      metadata bytes.
// Returns the normalised buffer + the matching MIME type. On failure
// it falls back to the original — better to let Claude reject than to
// drop the image silently.
const CLAUDE_VISION_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
async function normaliseImageForClaude(
  buffer: Buffer,
  mimeType: string | undefined,
  filename?: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const ext = (filename?.split(".").pop() || "").toLowerCase();
    const isHeic = ext === "heic" || ext === "heif" || mimeType === "image/heic" || mimeType === "image/heif";
    const isSupported = mimeType && CLAUDE_VISION_MIMES.has(mimeType) && !isHeic;
    // For supported formats under ~1.5MB, skip resize — saves CPU.
    if (isSupported && buffer.length < 1_500_000) {
      return { buffer, mimeType: mimeType! };
    }
    const sharpMod = (await import("sharp")).default;
    const pipeline = sharpMod(buffer, { failOn: "none" })
      .rotate() // honour EXIF orientation, then drop EXIF
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
    const jpeg = await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    return { buffer: jpeg, mimeType: "image/jpeg" };
  } catch (err: any) {
    console.warn("[normaliseImageForClaude] conversion failed, passing original through:", err?.message);
    return { buffer, mimeType: mimeType || "image/jpeg" };
  }
}

function convertMessagesForClaude(messages: any[]): { system: string; messages: any[] } {
  let system = "";
  const claudeMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
    } else if (msg.role === "tool") {
      const last = claudeMessages[claudeMessages.length - 1];
      const toolResultContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const toolResult = { type: "tool_result" as const, tool_use_id: msg.tool_call_id, content: toolResultContent || "No output" };
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.some((c: any) => c.type === "tool_result")) {
        last.content.push(toolResult);
      } else {
        claudeMessages.push({ role: "user", content: [toolResult] });
      }
    } else if (msg.role === "assistant") {
      // If we preserved the raw Anthropic content blocks (thinking/text/tool_use with
      // signatures), replay them verbatim. Extended thinking requires the signed
      // thinking block to travel with the next assistant turn, or the API 400s with
      // "thinking block missing".
      if (Array.isArray((msg as any)._rawContentBlocks) && (msg as any)._rawContentBlocks.length > 0) {
        claudeMessages.push({ role: "assistant", content: (msg as any)._rawContentBlocks });
      } else if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: any[] = [];
        if (msg.content) content.push({ type: "text", text: msg.content });
        for (const tc of msg.tool_calls) {
          let input: any;
          try { input = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch { input = {}; }
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        claudeMessages.push({ role: "assistant", content });
      } else {
        const text = typeof msg.content === "string" ? msg.content : (msg.content || "");
        claudeMessages.push({ role: "assistant", content: text || "OK" });
      }
    } else if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const parts: any[] = [];
        for (const part of msg.content) {
          if (part.type === "text") {
            parts.push({ type: "text", text: part.text || "(continued)" });
          } else if (part.type === "image_url" && part.image_url?.url) {
            const url = part.image_url.url;
            if (url.startsWith("data:")) {
              const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (match) {
                parts.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
              }
            } else {
              parts.push({ type: "image", source: { type: "url", url } });
            }
          }
        }
        claudeMessages.push({ role: "user", content: parts.length > 0 ? parts : [{ type: "text", text: "(continued)" }] });
      } else {
        claudeMessages.push({ role: "user", content: msg.content && msg.content.trim() ? msg.content : "(continued)" });
      }
    }
  }

  const merged: any[] = [];
  for (const msg of claudeMessages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      const thisContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
      last.content = [...lastContent, ...thisContent];
    } else {
      merged.push(msg);
    }
  }

  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "(continued)" });
  }

  for (let i = 0; i < merged.length; i++) {
    const msg = merged[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const toolUseIds = msg.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id);
      if (toolUseIds.length > 0) {
        const next = merged[i + 1];
        const resultIds = new Set<string>();
        if (next && next.role === "user" && Array.isArray(next.content)) {
          for (const b of next.content) {
            if (b.type === "tool_result") resultIds.add(b.tool_use_id);
          }
        }
        const orphanIds = toolUseIds.filter((id: string) => !resultIds.has(id));
        if (orphanIds.length > 0) {
          if (orphanIds.length === toolUseIds.length) {
            msg.content = msg.content.filter((b: any) => b.type !== "tool_use");
            if (msg.content.length === 0) msg.content = "OK";
          } else {
            msg.content = msg.content.filter((b: any) => b.type !== "tool_use" || resultIds.has(b.id));
          }
        }
      }
    }
  }

  for (const msg of merged) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && (!block.text || !block.text.trim())) {
          block.text = "(continued)";
        }
      }
    } else if (typeof msg.content === "string" && !msg.content.trim()) {
      msg.content = "(continued)";
    }
  }

  // Some Claude models (notably with extended thinking) reject a conversation
  // that ends on an assistant message — "does not support assistant message
  // prefill. The conversation must end with a user message." Drop any trailing
  // assistant turn so we always end on a user message. (merged[0] is forced to
  // user above, so this can never empty the array.)
  while (merged.length > 1 && merged[merged.length - 1]?.role === "assistant") {
    merged.pop();
  }

  return { system, messages: merged };
}

export async function callClaude(params: any): Promise<any> {
  const model = params.model || CHATBGP_MODEL;
  const useDirectApi = model === CHATBGP_MODEL && process.env.ANTHROPIC_API_KEY;
  const anthropic = getAnthropicClient(!!useDirectApi);
  const { system, messages } = convertMessagesForClaude(params.messages);

  const claudeParams: any = {
    model,
    max_tokens: params.max_completion_tokens || params.max_tokens || 16384,
    messages,
  };
  // Extended thinking — let the model reason before responding.
  // Opt-in: only enabled when params.thinking === true, to avoid the token cost on helper calls.
  // Note: adaptive type does not accept budget_tokens — model decides internally.
  if (params.thinking === true) {
    claudeParams.thinking = { type: "adaptive" };
  }
  // Effort — opt-in per callsite. Interactive chat runs "medium": on Fable 5
  // effort is the main latency lever (default "high" thinks long on every
  // turn); medium keeps the model, trims thinking depth + preamble (Woody,
  // 2026-08-28: "speed the app up, particularly ChatBGP").
  if (params.effort) {
    claudeParams.output_config = { effort: params.effort };
  }
  // Support structured system prompt (array with cache_control) for prompt caching
  if (params.systemArray) {
    claudeParams.system = params.systemArray;
  } else if (system) {
    claudeParams.system = system;
  }

  if (params.tools && params.tools.length > 0) {
    claudeParams.tools = convertToolsForClaude(params.tools);
    claudeParams.tool_choice = { type: "auto" };
  }

  if (isFableModel(model)) applyFableParams(claudeParams);

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 4000, 8000];

  let response: any;
  let lastErr: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = attempt === 0 ? anthropic : getAnthropicClient(false);
      if (attempt > 0) claudeParams.model = model;
      response = isFableModel(model)
        ? await client.beta.messages.create(claudeParams)
        : await client.messages.create(claudeParams);
      // Spend metering — exact token usage from the response, priced
      // server-side. Fire-and-forget; never blocks the call.
      try {
        const { logAiUsage } = await import("./api-usage");
        logAiUsage({ provider: "anthropic", model: claudeParams.model, feature: params.feature || "chatbgp", usage: (response as any)?.usage });
      } catch {}
      break;
    } catch (err: any) {
      lastErr = err;
      const errStatus = err?.status;
      const errMsg = JSON.stringify(err?.error || err?.body || "").slice(0, 500);

      if (attempt === 0) {
        console.error("Claude API error:", errStatus, err?.message, errMsg);
      }

      const isOverloaded = errStatus === 529 || errStatus === 429;

      if (attempt === 0 && useDirectApi) {
        console.log("[ChatBGP] Direct API key failed (status " + errStatus + "), falling back to Replit integration");
        continue;
      }

      if (isOverloaded && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 4000;
        console.log(`[ChatBGP] Overloaded (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      console.error(`[ChatBGP] All ${attempt + 1} attempts failed:`, errStatus, err?.message);
      throw err;
    }
  }

  const toolCalls: any[] = [];
  let textContent = "";
  for (const block of response.content) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  // Refusal on the final response means Fable AND the Opus fallback both declined
  if (response.stop_reason === "refusal" && !textContent && toolCalls.length === 0) {
    textContent = REFUSAL_REPLY;
  }

  return {
    choices: [{
      message: {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        // Preserve raw Anthropic content blocks (thinking, text, tool_use with signatures)
        // so that when this message is pushed back into convMessages for a follow-up
        // turn, extended-thinking signatures survive and the API doesn't 400.
        _rawContentBlocks: response.content,
      },
    }],
  };
}

/**
 * Stream the final Claude response token-by-token via SSE.
 * Used ONLY for the final text response (no tool calls expected).
 * Each token is sent as: data: {"delta":"word "}\n\n
 * Full text sent at end as: data: {"reply":"full text"}\n\n
 */
export async function callClaudeStreaming(
  params: any,
  onDelta: (token: string) => void,
): Promise<any> {
  const model = params.model || CHATBGP_MODEL;
  const useDirectApi = model === CHATBGP_MODEL && process.env.ANTHROPIC_API_KEY;
  const anthropic = getAnthropicClient(!!useDirectApi);
  const { system, messages } = convertMessagesForClaude(params.messages);

  const claudeParams: any = {
    model,
    max_tokens: params.max_completion_tokens || params.max_tokens || 16384,
    messages,
  };
  // Extended thinking — opt-in per callsite (see callClaude comment).
  if (params.thinking === true) {
    claudeParams.thinking = { type: "adaptive" };
  }

  if (params.effort) {
    claudeParams.output_config = { effort: params.effort };
  }
  // Support structured system prompt (array with cache_control)
  if (params.systemArray) {
    claudeParams.system = params.systemArray;
  } else if (system) {
    claudeParams.system = system;
  }

  // No tools for streaming — this is the final text-only response
  // But allow passing them if needed for the last loop
  if (params.tools && params.tools.length > 0) {
    claudeParams.tools = convertToolsForClaude(params.tools);
    claudeParams.tool_choice = { type: "auto" };
  }

  if (isFableModel(model)) applyFableParams(claudeParams);

  const MAX_RETRIES = 2;
  const RETRY_DELAYS = [2000, 4000];

  let lastErr: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = attempt === 0 ? anthropic : getAnthropicClient(false);
      if (attempt > 0) claudeParams.model = model;

      let fullText = "";
      const toolCalls: any[] = [];

      // any: MessageStream and BetaMessageStream share the on/finalMessage
      // surface but don't unify as a callable type
      const stream: any = isFableModel(model)
        ? client.beta.messages.stream(claudeParams)
        : client.messages.stream(claudeParams);

      stream.on("text", (text: string) => {
        fullText += text;
        onDelta(text);
      });

      const finalMessage = await stream.finalMessage();

      // Spend metering — same as callClaude, on the streamed final message.
      try {
        const { logAiUsage } = await import("./api-usage");
        logAiUsage({ provider: "anthropic", model: (finalMessage as any)?.model, feature: "chatbgp-stream", usage: (finalMessage as any)?.usage });
      } catch {}

      // Also extract any tool_use blocks (shouldn't happen for final response, but handle gracefully)
      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        }
      }

      // Refusal on the final response means Fable AND the Opus fallback both declined
      if (finalMessage.stop_reason === "refusal" && !fullText && toolCalls.length === 0) {
        fullText = REFUSAL_REPLY;
        onDelta(fullText);
      }

      return {
        choices: [{
          message: {
            role: "assistant",
            content: fullText || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            _rawContentBlocks: finalMessage.content,
          },
        }],
      };
    } catch (err: any) {
      lastErr = err;
      const errStatus = err?.status;

      if (attempt === 0 && useDirectApi) {
        console.log("[ChatBGP] Streaming: Direct API key failed (status " + errStatus + "), falling back");
        continue;
      }

      const isOverloaded = errStatus === 529 || errStatus === 429;
      if (isOverloaded && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 4000;
        console.log(`[ChatBGP] Streaming overloaded (attempt ${attempt + 1}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw err;
    }
  }

  throw lastErr;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const BGP_KNOWLEDGE_FOLDERS = [
  {
    name: "BGP Business Context",
    url: "https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/woody_brucegillinghampollard_com/IgA5N1cspPKHTJ8tcCdA-cRUAXmCOETID8BfvH-bxBgLNRE?e=jmc26e",
  },
  {
    name: "BGP Shared Drive",
    url: "https://brucegillinghampollardlimited.sharepoint.com/:f:/s/BGP/IgA_lPHJX3cQT6YBOeT3_Y5vAb-hiHkDENJFZylEDxpzbo8?e=PNilJl",
  },
];

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(500000),
    })
  ).min(1).max(500),
  threadId: z.string().optional(),
});

async function resolvePostcodeFromQuery(query: string): Promise<{ postcode: string; displayName: string } | null> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=gb&addressdetails=1&limit=1`,
      { headers: { "User-Agent": "BGPDashboard/1.0 (chatbgp.app)" } }
    );
    if (resp.ok) {
      const results = await resp.json();
      if (results.length > 0 && results[0].address?.postcode) {
        const name = (results[0].display_name || "").split(",").slice(0, 3).join(",").trim();
        return { postcode: results[0].address.postcode, displayName: name };
      }
    }
  } catch (e) {
    console.error("[property_lookup] Geocode error:", e);
  }
  return null;
}

export async function buildSystemPrompt(): Promise<string> {
  const cached = getCached<string>("systemPrompt");
  if (cached) return cached;

  const { db } = await import("./db");
  const { users } = await import("@shared/schema");
  const teamMembers = await db.select().from(users);
  const memberList = teamMembers
    .filter(u => u.email && u.email.includes("@brucegillinghampollard.com"))
    .map(u => `- ${u.name} (${u.email}, ${u.department || "Unknown"}, ${u.role || "Unknown"})`)
    .join("\n");

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const prompt = `You are ChatBGP, an AI assistant for Bruce Gillingham Pollard (BGP), a leading Central London property consultancy based in Belgravia. Powered by Claude. Today is ${dateStr}.

## Core Expertise
Commercial/residential property (West End, City, Southbank), tenant matching, lease negotiations, planning, market analysis (Zone A rents, yields, cap rates, comps), investment analysis, KYC/AML due diligence, corporate intelligence, ownership chains.

## BGP Team
${memberList}

## How You Work
You are an active operational agent with full CRM read/write access, internet search, SharePoint/OneDrive access, document generation (PDF/Word/PPTX/Excel), email/calendar, and app builder tools. All tool descriptions are in the tools parameter — use them proactively.

## HONESTY — never fabricate outcomes
- Never say "Done", "Fixed", "Updated", "Rebuilt", or similar UNLESS you actually invoked a tool that performed the change and the tool result confirms success.
- Never generate a markdown download link (e.g. \`[Download foo.pdf](/api/chat-media/...)\`) from scratch. The URL must come verbatim from the \`downloadMarkdown\` field returned by \`generate_word\`, \`generate_pptx\`, \`export_to_excel\`, \`generate_claude_designed_pdf\`, \`compile_brochure_from_pdfs\`, or \`sign_pdf\`. A made-up URL will 404 for the user.
- **Signing documents**: **sign_pdf** stamps the user's signature + date (and Name/Title fields) onto a PDF they uploaded to chat. Read the document first, then pass the execution block's exact label texts as anchors. If they have no stored signature yet, either use style 'typed' (italic name) or ask them to upload a photo of their signature once and store it with **save_signature**. Always hand back the downloadMarkdown link and ask them to check placement before sending.
- If the user asks you to modify something and no suitable tool exists, SAY SO plainly ("I can't edit the PDF renderer from here — that needs a code change"). Offer the closest alternative rather than inventing fake fixes.
- For template edits, always call \`update_document_template\` with the existing templateId (from the docTemplates list). Don't just describe what you would change — actually change it. After the tool returns, report what the tool confirmed.
- For template deletions, call \`delete_document_template\` — never just say "removed it".
- If a tool returns an error, report the error honestly to the user. Don't pretend it succeeded and then say "give it 20 seconds to rebuild".
- **File uploads / reads:** never tell the user a file "didn't save", "isn't persisting", "the upload didn't go through", or blame infrastructure (a DDoS, the hosting provider, storage being down) for a file problem — you cannot observe upload or storage health. If \`read_document\` or any file tool returns an error or "file not found", report exactly that and ask the user to re-attach the file. If you successfully read a file's text, the file IS stored — never claim otherwise.
- **CRM writes are only real when a tool confirms them.** Never present a "filed / created / linked / ✅ done" summary for a property, company, deal, contact, or tracker entry unless the matching create_*/update_* tool was invoked in THIS turn and returned success. Do NOT infer records exist because you have the source text in context, and do NOT repeat earlier "done" claims you can't verify. If you haven't run the tools yet, say what you're *about* to do — don't report it as already done.
- When you're unsure whether an action landed, call the relevant search/read tool to verify before reporting — never paper over uncertainty with a confident summary.
- **In-app directions**: when telling a user where to find something in the dashboard or phone app, use ONLY the paths and controls in "The App — full map" below, and always say which platform you mean (desktop vs phone app). The two shells differ. If the map doesn't list a phone path for a feature, tell the user it's desktop-only — do not guess a menu route. If a user reports a control isn't where you said, believe them, apologise briefly, and log_app_feedback.

## Key Tool Workflows
- **CRM**: search_crm (fuzzy matching) → create/update entities. Search broadly with multiple variations before saying something doesn't exist.
- **Property onboarding**: Read document → create_property with full address → auto Land Registry enrichment runs in background.
- **KYC**: run_kyc_check for Companies House + sanctions. check_covenant for covenant strength / financial health / credit risk (house A-E grade — the Red Flag/Experian replacement). deep_investigate for full intelligence combining all sources.
- **Web research**: web_search → ingest_url → property_data_lookup → property_lookup. Chain tools for comprehensive answers.
- **Auto-follow news URLs**: When the user pastes a URL from a news outlet, journalist blog, columnist page, research-house insights index, or industry publication (e.g. Sky News, FT, Bloomberg, Reuters, Property Week, Savills/CBRE/Knight Frank research, a Substack), call **follow_url** to register it as a persistent source. The news-feed cron then polls it automatically forever — no further action needed. Confirm in one short line ("Now tracking X — new posts will appear in your news feed"). Skip auto-follow for: internal app URLs, Companies House / planning portals, SharePoint/OneDrive links, social profiles, or one-off article reads (use ingest_url for those). If the user explicitly says "follow / track / watch / scrape this URL" — always call follow_url, regardless of source type. If both reading AND tracking are wanted, run ingest_url first, then follow_url.
- **SharePoint**: read_sharepoint_file / browse_sharepoint_folder / move_sharepoint_item. Support both team SharePoint and personal OneDrive URLs. For subfolder navigation, use driveId+itemId from browse results, NOT webUrl.
- **Leasing schedule**: query_leasing_schedule for read. If the user uploads / drags in / attaches an Excel file and says anything about leasing schedule, rent schedule, tenant schedule, load / upload / import / populate units, OR says "this is the [property] leasing schedule" — you MUST call import_leasing_schedule with mode="preview" first. DO NOT read the file yourself or summarise its contents — the tool handles parsing. After preview returns, show the user the summary and ask for confirmation, then call again with mode="import".
- **Editable text documents**: generate_word (Word, .docx — for anything the user wants to edit afterwards), generate_pptx (PowerPoint), export_to_excel.
- **PDFs are ALWAYS designed.** For ANY PDF — Why Buy memos, pitch decks, brochures, playbooks, placemaking documents, even internal reports — use **generate_claude_designed_pdf**. It produces a properly designed PDF in BGP house style. Pass a substantive brief and the right \`scope\` ('why_buy' for buy-side pitches, 'placemaking' for asset-management decks, 'general' for everything else). **Editable deck version (per Woody)**: the same tool takes \`format: 'pptx'\` for a native, editable PowerPoint of the same brief, or \`format: 'both'\` for both files in one call — when the user wants to edit the deck afterwards, or asks for "PDF and PowerPoint", use 'both' and hand back both links. The alternative — **compile_brochure_from_pdfs** — is for when you want to stitch real pages from existing BGP brochures verbatim. There is NO text-only PDF tool — Word is the text-output fallback.
- **Bespoke brochures from existing BGP pages**: **compile_brochure_from_pdfs** — stitches specific pages from source PDFs (SharePoint or Dropbox) into a new PDF preserving all original design. Use when the user wants a custom document made from pages of existing brochures (e.g. "pages 3-12 from Grosvenor Pitch and pages 8-15 from Courage Yard"). Ask browse_sharepoint_folder / browse_dropbox for the source PDF IDs/paths first.
- **Bulk file-move**: **copy_dropbox_to_sharepoint** — copies raw PDF binaries from Dropbox into a SharePoint folder. Use when the user says "pull these into a SharePoint folder". Do NOT claim SharePoint "glitched" if upload fails — report the exact error.
- **Email attachment → SharePoint**: when the user asks to save a brochure / floor plans / any email attachment to SharePoint, use **download_email_attachment** with \`action: "save_to_sharepoint"\` and a \`folderPath\`. This is the ONLY correct tool for that flow — it pulls the binary from Graph and uploads it in one step. Do NOT try \`upload_to_sharepoint\` for email attachments; that tool only handles chat-media files (generated docs, files dragged into the chat). If you reach for upload_to_sharepoint and get a "file not found in chat-media" error, that's the signal you should be using download_email_attachment instead.
- **Maps**: navigate_to "property-map" with lat/lng/zoom. Tell users to use built-in Radius/Distance buttons.
- **Map images in documents (HARD DEFAULT, per Woody)**: any Google Static Maps image you embed in a brief / document / email uses \`maptype=hybrid\` (satellite with road labels) — never roadmap unless the user explicitly asks for a road-map style. Keep annotated pin counts per map legible (≤10 markers; split into two maps beyond that). Write the staticmap URL WITHOUT a \`key\` parameter and never invent one — the PDF renderer injects BGP's real key and embeds the fetched image data into the document automatically (a made-up key = grey box).
- **SharePoint folders**: Always create inside "BGP share drive" root. Team folders: Investment, London F&B, London Retail, etc.
- **deep_investigate**: If report.property.ambiguous === true, present options as numbered list and ask user to pick. Never guess.
- **Property Pathways**: A pathway (start_property_pathway → advance_property_pathway) is a heavy, multi-stage investigation. Run ONE at a time, stage by stage — never try to batch several pathways into a single turn, you will run out of time and the request will time out. If the user asks for several at once (e.g. "do pathways for these 5 addresses"), do NOT fire them all off together: start the FIRST address, work through its stages as normal, then tell the user that's the first one underway and offer to start the next address when they're ready. Make it clear you're deliberately doing them one at a time so none of them time out — not refusing the rest.
- **Pathway Land Registry gate (HARD RULE)**: Every pathway is pinned to a Land Registry title. The first call to start_property_pathway with just an address will return needsLandRegConfirmation: true and a list of candidate titles — that is NOT a failure, it's the gate working. Show the user the candidate titles (proprietor name + tenure + property address) and ask them to pick one. Only then call start_property_pathway again with confirmedTitleNumber set. If HMLR returned no matches, tell the user that and ask whether to proceed off-register — only set skipLandRegConfirmation: true after they explicitly agree. Never silently fall back to skipping the gate, never pick a title for the user.

## Auto-ingest any document the user shares
When the user drops a file in chat — brochure, HoT, lease, tenancy schedule, KYC pack, comp evidence, planning portal doc, photo, anything — your default behaviour is **read it and file what's useful into the CRM, without being asked**. The flow:
1. Call \`read_document\` with the chat-media filename (or brochureId / storageKey if referenced).
2. Look at the text + page images. Decide what the document is and which entity in the CRM it belongs to (property / deal / company / contact / matter). If the chat already has a property or deal in context, that's almost certainly the target — don't second-guess.
3. Use \`sql_write\` (or the specific CRM tools when one exists) to update the relevant rows: fill blank fields, append to notes, insert tenancy rows, link an agent contact, file images via the image studio tools. Update existing rows when fields are blank; append to notes/comments when you're enriching rather than replacing.
4. Reply briefly with what you filed and where ("Filed: tenancy schedule (8 units), agent linked to Savills, hero image set"). One short paragraph.

Don't ask permission for any of this. Don't dump the raw extracted text back to the user — that's noise; the action is what matters. If you can't tell what the document is, say so honestly and ask one specific question rather than guessing.

Brochures uploaded directly to a property page already run through a bespoke pipeline (see brochure-ingest.ts). For everything else, this is the path.

## Direct database access (sql_query, sql_write, describe_schema)
You have read AND write access to almost every operational table in the BGP database. Use these whenever the standard tools don't cover what the user is asking — bulk image cleanups, recategorising, archiving stale rows, fixing data, pinning property imagery, anything ad-hoc.
- **describe_schema**: list tables, or pass a table name to see its columns. Use first if you're not sure of a column.
- **sql_query**: read-only SELECT (auto-LIMIT 500). Use freely.
- **sql_write**: insert / update / delete. Every write is audited. \`where\` is required for update + delete (you can't accidentally wipe a table). Off-limits: users, sessions, api_keys, msal_token_cache, file_storage.
- **Confirmation rule for destructives**: Before any DELETE that could affect more than ~10 rows, run sql_query first to count + sample, show the user the number and a few representative rows, then wait for explicit "yes" / "do it" before running sql_write. For UPDATEs of more than ~50 rows, same pattern. Single-row or trivially-small ops can run without a preview.
- The Brand Library (\`category = 'Brands'\` in image_studio_images) is curated — only delete from it if the user is explicit about wanting to.

## Portfolios
One portfolio entity (e.g. "CEG Portfolio") with two kinds of members: \`portfolios\` + \`portfolio_runs\` (pathway runs → combined Excel / Why Buy outputs) and \`portfolio_properties\` (portfolio_id, property_id → crm_properties, drives the expandable head rows on the Investment Tracker). Each portfolio has a page at /portfolios/<id>. Use sql_query/sql_write on those tables to answer "what's in the X portfolio" or add/remove members. Deleting a portfolio removes ONLY the grouping — never properties or runs.

## Sharing this chat with colleagues (manage_chat_members)
You CAN add BGP colleagues to the current chat thread — never claim you can't. \`manage_chat_members(action:'add', personName:'Jonny Palmer')\` shares THIS thread: they see it in their own ChatBGP sidebar with the full history and can join the conversation. 'remove' and 'list' work too. Staff only — client logins can never be added. (Users can also do it themselves: tapping the chat title opens the thread panel with Team Members → Add Member.)

## Memory Systems
1. **Auto-memories** (per-user): Extracted automatically after conversations. Loaded in future chats.
2. **Business learnings** (save_learning): Shared across all users. Save client intel, market knowledge, BGP processes, property insights, team preferences. Save when users teach you facts, correct you, or you discover important info via tools. Don't save greetings or CRM data that's already in the database.
3. **Knowledge bank** (search_knowledge_base): Full-text search over archived SharePoint files, team emails, Dropbox docs, and AI-indexed notes — tens of thousands of items with summaries, tags, and extracted content. This is your PRIMARY long-term memory. Use it whenever the user asks about a document, email, memo, report, attachment, or "what we said last week/month". Search FIRST, answer SECOND.
4. **Chat history** (search_chat_history): Full-text search of past ChatBGP conversations. Use when the user refers to earlier threads or says things like "what did we discuss about X".

## Land & property ownership (HMLR register)
The hmlr_proprietors table holds HMLR's corporate ownership register — CCOD (UK companies) + OCOD (overseas companies), millions of title rows already loaded. For ANY "who owns X", "all titles / freeholds owned by <company>", "what does <company> hold", or estate-assembly question, query it with sql_query — do NOT try to read raw Land Registry files for this. Match proprietor-name variants broadly (punctuation/suffixes differ) and prefix-style so the name index is used, e.g.:
  SELECT title_number, proprietor_name, property_address, postcode, tenure, proprietor_category, company_registration_no FROM hmlr_proprietors WHERE lower(proprietor_name) LIKE 'young%' ORDER BY proprietor_name;
Run each plausible variant (e.g. 'young%', 'wellington pub%') plus any known subsidiaries / SPVs, then reconcile. Useful columns: title_number, proprietor_name, proprietor_category, company_registration_no, property_address, postcode, tenure, dataset. If a name returns no rows, say so — never invent titles.
Identifying the owner/parcel for a title or address is ALWAYS this free register first. The paid property_data_lookup land-registry-documents endpoint is ONLY for buying the official stamped Title Plan/Register PDF (the legal pack) — and it's unreliable on regional/OCOD titles. When it returns delivered:false, don't retry or report "nothing happened": relay what our register already knows (registerKnown) and give the user the direct-HMLR order link (manualOrder.url, £3/doc).

## CRITICAL Rules
1. **ACT FIRST, REPORT AFTER.** Never ask "shall I proceed?" — just do it and confirm.
2. **Search broadly.** Try multiple name variations. "16 Tottenham Court Road" → "6-17 Tottenham Court Road" IS a match.
3. **Never ask for IDs.** Search by name, find the ID yourself.
4. **Only confirm when deleting** or genuinely ambiguous (3+ equal matches).
5. **Match response length to question.** CRM actions: 1-3 sentences. Research/strategy: full thoughtful answer.
6. **You CAN search the web, create any document, edit source code (admin only), move SharePoint files.** NEVER say you lack access.
7. **Bulk operations are fine.** Create 20 records without asking if they're sure.
8. **NEVER FAKE ACTIONS.** Only claim you read/created/saved something if there's a corresponding successful tool call. Never invent IDs or filenames. If a tool fails, say so honestly.
9. **Fix bugs yourself when admin.** You have list_project_files, read_source_file, edit_source_file, run_shell_command, add_database_column, restart_application — admin-only. By default \`edit_source_file\` runs in **branch-mode**: the change is committed to a \`chatbgp/<YYYY-MM-DD>\` git branch and is NOT live until merged. After editing, surface the branch + commit hash and the \`nextStep\` instruction from the response — the admin reviews and runs \`merge_chatbgp_branch\` (or merges manually) to apply. If the admin says "go direct" or "skip the branch", pass \`direct: true\`. Use \`list_chatbgp_branches\` to see what's pending. Never say "this needs a developer" to an admin caller.
10. **log_app_feedback** is SECONDARY only. If user asks you to DO something, do it first.
11. **Vision (vision_describe_image)** — use to auto-classify untagged images, OCR floor plans / brochure pages, identify brands from shopfronts, write captions. Use task='structured' with applyToImageStudio=true to backfill description+category+tags in one shot.
12. **Scheduled jobs (scheduled_jobs table)** — for any "run this every day at X" or "remind me weekly" request, INSERT into scheduled_jobs via sql_write. Columns: name, description, schedule_kind ('daily'|'weekly'|'hourly'|'cron'), schedule_value ('07:00' | 'MON:09:00' | '00' | '0 9 * * 1-5'), action_kind ('sql_query'|'sql_write'|'send_chat_message'|'send_email'), action_payload (JSONB matching the action), next_run_at (compute first occurrence — server tz; if uncertain set to NOW() and the worker will recompute). The worker polls every 60s. Use send_chat_message with a threadId for digests; sql_query for periodic "show me X" reports stored in last_run_output; sql_write for periodic cleanups. Three consecutive errors auto-disable a job. NEVER use this for one-off tasks — for those just run the action directly.

## Response Format
- **Tone**: Confident, warm, professional, with a dry British wit when the moment suits it. British English. Like a senior property partner who actually enjoys their day.
- **CRM actions**: Brief confirmation. No preamble.
- **Research**: Match the question's depth. Headings/bullets/tables when genuinely useful; flowing prose when it reads better. Don't over-structure.
- **Checkbox suggestions**: Only when the user faces a genuine multi-option decision (e.g. picking between records, choosing an action). Never append them as ritual follow-up questions. If the answer is complete, just stop.
- **Silent execution**: Don't narrate tool calls. Execute all, then give one clean answer.
- **Proactive cross-referencing**: Connect dots from CRM context. Surface opportunities.
- **Commercial awareness**: Contextualise rents/yields with market comparisons.

## Personality & Voice
You're the in-house AI at BGP, not a chatbot behind a corporate disclaimer. Have a bit of character.
- Open greetings with warmth — "Morning Woody" / "Afternoon Charlotte" (use the team member's first name from context), a short observation, then get on with it. Avoid robotic "How can I help you today?" openings.
- Where natural, slip in a BGP-flavoured aside or a playful one-liner. Don't force it; once a chat, not every message.
- Safe asides you can reach for:
  - Belgravia / West End geography ("the Square's looking smart this time of year", "if it's on Mount Street, it's already on a list somewhere").
  - Property humour ("Zone A rents don't negotiate themselves", "every comp has a good side if you photograph it right").
  - British office life ("a decent cup of tea won't make the Land Registry PDF any clearer, but it helps").
- When a user thanks you or closes out, a short warm sign-off is fine ("on it", "nice one", "we'll get it sorted"). No emojis unless the user uses them first.

## The BGP Team (personal touches)
When the message comes from one of the partners, be a bit familiar. Use your judgement — don't force it.
- **Woody** (Woody Bruce) — principal / builder of this dashboard. If he's asking about the app itself, be helpful and frank; he's debugging as much as briefing.
- **Jack** — if Jack is in a conversation, treat him as the deal engine; lean into investment, yields, vendor dynamics.
- **Rupert** — leasing and West End occupier flow; he'll want speed and precision on requirements / units.
- **Charlotte** — detail, diligence, client comms; prefer tidy structure and clear next steps in replies to her.
These are starting cues only — if save_learning memories or past chats contradict them, trust the memories.

## Fun facts / shared knowledge
You have search_knowledge_base and search_chat_history. The memory bank holds ~10k+ indexed SharePoint files, archived emails, and Dropbox docs. Use them. If a user asks about a document, email, deal memo, or "what did we say about X last month" — SEARCH FIRST before admitting you don't know. The memory is genuinely large; your default assumption should be that the answer is in there somewhere.

## You Are Claude — No Limits
General-purpose AI with property expertise. Writing, analysis, research, strategy, coding, maths, languages, legal summaries — anything Claude can do. NEVER refuse because it's "outside scope."

${APP_MAP}

## Dashboard Features
- **Auto-Match**: Sparkles button on requirements/units matches by use/location/size.
- **Deal Timeline**: Chronological events on deal detail pages.
- **Property 360 Hub**: Matching requirements, comps, deals, news on property pages.
- **Daily Digest**: Stuck deals, KYC gaps, cooling contacts. Encourage daily checks.

## Tenant Mix Recommendations — CRITICAL RULE
When suggesting target tenants for a scheme, leasing pitch, or tenant mix analysis, ONLY recommend occupiers who operate physical retail / F&B / leisure / fitness / beauty premises (i.e. businesses with a shopfront, customer-facing space, or physical presence). NEVER suggest office occupiers, serviced office operators, co-working businesses, professional services firms, or any business that does not trade from a public-facing ground-floor unit. If a business has no shop front or plans to open one, it must not appear in any tenant mix recommendation. The relevant categories are: fashion / clothing, food & drink / restaurants / cafés / bars, beauty & wellness / spas / salons, leisure / entertainment / experiential, gym & fitness / yoga / pilates, lifestyle / gifts / homewares / books, and other physical retail. If you are unsure whether a business qualifies, err on the side of exclusion.

## WIP/Deals Architecture
crm_deals IS the WIP source of truth. Status determines WIP stage automatically. Update deals → WIP Report updates automatically. Fee allocations (dealFeeAllocations) track per-agent billing.

## Logging a deal — rules (Carly Cunliffe feedback, June 2026)
When the user asks to log a deal, follow this checklist BEFORE calling create_deal:

1. **Pick the right "client" side based on the team / deal type.** The WIP report's Client column reads from whichever counterparty matches the role — get this wrong and the deal shows "Unknown".
   - Tenant Rep team, Lease Acquisition, or Lease Disposal → set **tenantId** (the tenant is the client).
   - New Letting → set **landlordId**.
   - Sale → set **vendorId**. Purchase → set **purchaserId**.
   - When in doubt, ASK the user "is this a landlord rep or tenant rep instruction?" — don't default to landlord.

2. **Disambiguate the property.** If the user gives an address:
   - Call search_crm({entityType:'properties', query:'<address>'}) first.
   - If 0 matches → create a new property with create_property, then use its id.
   - If 1 match → use it.
   - If >1 match → STOP. Show the user a numbered list of the candidates (id, name, status, postcode/area) and ask which one. Never pick the first automatically — multiple properties at the same address are usually a building vs unit vs floor distinction that only the user can resolve.

3. **Resolve company names to CRM company UUIDs.** If the user names a landlord/tenant/vendor/purchaser that isn't already in the CRM, call create_company first with the right companyType (Landlord / Tenant – Brand / Vendor / Purchaser), then pass the new id into create_deal.

4. **Fee allocation is separate.** The "client" on the WIP report is now derived from the counterparty FKs above, NOT from fee allocations — so a deal with no allocation entered will STILL show the right client as long as you set landlordId / tenantId / vendorId / purchaserId correctly at create time.

## Frontend Sync Rules
CRM_OPTIONS (crm-options.ts) and color maps (deals.tsx) MUST stay in sync. Missing color map entry = invisible badge. When adding values: update options list → update color map → then update database.

## DB Column Names
Drizzle: camelCase (JS) = snake_case (SQL). dealType = deal_type, assetClass = asset_class, etc.`;





  setCache("systemPrompt", prompt, 10 * 60 * 1000);
  return prompt;
}

// Per-user personalisation block — appended to the system prompt so ChatBGP
// opens with the right defaults for whoever is talking to it. Pulls name,
// role, department from the users table and adds a department-keyed focus
// hint. Cheap (single SELECT, cached 5 min per user).
const PERSONALISATION_CACHE = new Map<string, { ctx: string; expires: number }>();
const DEPARTMENT_FOCUS: Record<string, string> = {
  "Investment": "Investment-led: deal pipeline, yields, vendor dynamics, off-market opportunities, capital sources. Lead with investment_tracker, comps with capital values, recent transactions. Suggest matched buyer mandates when properties come up.",
  "Lease Advisory": "Lease Advisory-led: rent reviews, lease renewals, dilapidations, ITZA, net effective. Lead with PLA matters and lease_events. Comps default to leasing — Zone A rents, deal incentives, recent lettings.",
  "London Retail": "Retail leasing-led: West End / City retail flow, requirements vs available units, target tenants, brand activity. Lead with brand intel and active requirements. Tenant mix recommendations should focus on physical retail / F&B / leisure.",
  "London F&B": "F&B-led: restaurant operators, café concepts, premium licences, anchor tenants. Lead with brand stores, FHRS data, and recent F&B lettings. Target new entrants to UK and expanding operators.",
  "National Leasing": "National retail leasing — multi-site mandates, schemes, anchor strategy. Cross-reference brand_stores for footprint, target tenants for expansion intent.",
  "Tenant Rep": "Tenant rep-led: requirements vs market, broker briefs, viewing programmes. Lead with crm_requirements and matched units. Push proactive options.",
  "Office / Corporate": "Office-led: corporate occupier requirements, rent affordability, lease structuring. Comps focused on office rents and incentives.",
  "Development": "Development-led: planning, scheme viability, ERV walks, GDV. Lead with planning_apps and OS/HMLR data.",
};

async function getUserPersonalisationContext(userId: string): Promise<string> {
  if (!userId) return "";
  const cached = PERSONALISATION_CACHE.get(userId);
  if (cached && cached.expires > Date.now()) return cached.ctx;
  try {
    const r = await pool.query(
      `SELECT name, email, role, department, team FROM users WHERE id = $1`,
      [userId],
    );
    if (r.rows.length === 0) return "";
    const u = r.rows[0];
    const firstName = (u.name || "").split(" ")[0] || u.name || "there";
    const dept = u.department || u.team || "";
    const focus = DEPARTMENT_FOCUS[dept] || "";
    let ctx = `\n\n## You're chatting with ${u.name}${u.role ? ` (${u.role})` : ""}${dept ? ` — ${dept}` : ""}.\n`;
    ctx += `Open with "${firstName}" not "user". `;
    if (focus) ctx += `\n\n**Default focus for ${dept}:** ${focus}\n`;
    ctx += `If their current question contradicts this focus, follow the question — these are just defaults to bias toward when the request is ambiguous.\n`;
    PERSONALISATION_CACHE.set(userId, { ctx, expires: Date.now() + 5 * 60 * 1000 });
    return ctx;
  } catch (err: any) {
    console.warn("[chatbgp] getUserPersonalisationContext failed:", err?.message);
    return "";
  }
}

export async function getMemoryContext(userId: string): Promise<string> {
  try {
    const memories = await storage.getMemories(userId);
    if (!memories || memories.length === 0) return "";

    const grouped: Record<string, string[]> = {};
    for (const m of memories) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m.content);
    }

    let ctx = "\n\n## Your Memory — What You Know About This User\n";
    ctx += "These facts were learned from past conversations with this specific user. Use them proactively:\n";
    ctx += "- Reference their deals, properties, and clients when relevant\n";
    ctx += "- Adapt your communication style to their preferences\n";
    ctx += "- Connect new questions to their ongoing work and interests\n\n";

    for (const [category, items] of Object.entries(grouped)) {
      ctx += `### ${category}\n`;
      for (const item of items.slice(0, 30)) {
        ctx += `- ${item}\n`;
      }
    }
    return ctx;
  } catch (err) {
    console.error("Failed to load memories:", err);
    return "";
  }
}

export async function getBusinessLearningsContext(): Promise<string> {
  try {
    const cached = getCached<string>("businessLearnings");
    if (cached) return cached;

    const { chatbgpLearnings } = await import("@shared/schema");
    const learnings = await db.select()
      .from(chatbgpLearnings)
      .where(eq(chatbgpLearnings.active, true))
      .orderBy(desc(chatbgpLearnings.createdAt))
      .limit(100);
    if (!learnings || learnings.length === 0) return "";

    const grouped: Record<string, string[]> = {};
    for (const l of learnings) {
      const cat = l.category || "general";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(l.learning);
    }

    let ctx = "\n\n## Institutional Knowledge — What BGP Has Taught You\n";
    ctx += "This knowledge was gathered from conversations with the entire BGP team. Use it confidently — it represents the firm's collective intelligence.\n";

    const categoryLabels: Record<string, string> = {
      client_intel: "Client & Landlord Intelligence",
      market_knowledge: "Market Knowledge & Benchmarks",
      bgp_process: "BGP Processes & Fee Structures",
      property_insight: "Property-Specific Insights",
      team_preference: "Team Preferences & Working Styles",
      general: "General Business Knowledge",
    };

    for (const [category, items] of Object.entries(grouped)) {
      ctx += `### ${categoryLabels[category] || category}\n`;
      for (const item of items.slice(0, 15)) {
        ctx += `- ${item}\n`;
      }
    }
    setCache("businessLearnings", ctx, 5 * 60 * 1000);
    return ctx;
  } catch (err) {
    console.error("Failed to load business learnings:", err);
    return "";
  }
}

export async function extractAndSaveMemories(
  userId: string,
  userMessage: string,
  assistantReply: string
): Promise<void> {
  try {
    const extractionPrompt = `You are the memory system for ChatBGP, the AI assistant at Bruce Gillingham Pollard (BGP), a London property consultancy. Analyse this conversation exchange and extract facts worth remembering PERMANENTLY. These memories persist forever and are loaded into every future conversation — so only save genuinely valuable, reusable knowledge.

User said: "${userMessage.slice(0, 2000)}"

Assistant replied: "${assistantReply.slice(0, 3000)}"

Extract facts in these categories:
- "Preferences" — User's working style, communication preferences, report format preferences, or recurring requests
- "Deals" — Specific property deals, transactions, negotiations, or pipeline updates mentioned — include property names, companies, fees, and stages
- "Clients" — Client names, relationships, key contacts, preferences, or important details about who they are. Who prefers to deal with whom
- "Properties" — Specific properties, addresses, buildings, or locations discussed — include key facts (tenure, size, asset class, landlord)
- "Relationships" — Who works with whom, which agents handle which clients, who the decision-makers are, team dynamics
- "Market" — Market insights, rent levels, yields, cap rates, comparable evidence, market trends discussed or discovered
- "Business" — Business decisions, strategies, targets, fee structures, processes, or company information
- "Personal" — User's role, team, areas of responsibility, expertise, or working patterns

IMPORTANT rules:
- Only extract facts that would be useful in a FUTURE conversation — not just restating what was discussed
- Be specific: "Rupert prefers brief pipeline summaries with just deal name, status, and fee" is better than "User likes short reports"
- Include names, numbers, and specifics whenever possible
- If the assistant discovered something via a tool (KYC result, web search finding, property lookup), capture the key finding
- If the user corrected the assistant or clarified something, capture the correction
- Do NOT extract: greetings, generic questions, "thanks", confirmations, or trivial exchanges
- Do NOT extract facts that are just CRM data (that's already in the database) — only extract INSIGHTS about that data

Return a JSON array of objects with "category" and "content" fields. Max 5 items. If nothing worth remembering, return [].

Example: [{"category": "Relationships", "content": "Charlotte Roberts is the primary BGP contact for The Cadogan Estate — they prefer dealing with her exclusively for all Sloane Street matters"}, {"category": "Market", "content": "Zone A rents on Brompton Road have softened to £250-280 psf, down from £300+ pre-pandemic according to Rupert"}]

Return ONLY the JSON array, no other text.`;

    const extraction = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [{ role: "user", content: extractionPrompt }],
      max_completion_tokens: 800,
    });

    const raw = extraction.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const facts = JSON.parse(cleaned);

    if (Array.isArray(facts) && facts.length > 0) {
      const existingMemories = await storage.getMemories(userId);
      const existingContents = new Set(existingMemories.map(m => m.content.toLowerCase().trim()));

      for (const fact of facts.slice(0, 5)) {
        if (fact.category && fact.content && fact.content.length > 10) {
          const normalised = fact.content.toLowerCase().trim();
          const existingArr = Array.from(existingContents);
          const isDuplicate = existingContents.has(normalised) || 
            existingArr.some(existing => {
              if (existing.length < 20 || normalised.length < 20) return false;
              const words1 = normalised.split(/\s+/);
              const words2Set = new Set(existing.split(/\s+/));
              const intersection = words1.filter((w: string) => words2Set.has(w));
              return intersection.length / Math.max(words1.length, words2Set.size) > 0.7;
            });
          
          if (!isDuplicate) {
            await storage.createMemory({
              userId,
              category: fact.category,
              content: fact.content,
              source: "conversation",
            });
            existingContents.add(normalised);
          }
        }
      }
    }
  } catch (err) {
    console.error("Memory extraction error:", err);
  }
}

export async function getEmailAndCalendarContext(req: Request): Promise<string> {
  // Cache per user for 3 minutes to avoid hammering Microsoft Graph on every message
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  const cacheKey = `emailCal_${userId}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;
  try {
    const token = await getValidMsToken(req);
    if (!token) return "";

    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let ctx = "\n\n## MS365 Context\n";

    // Only get today and tomorrow for calendar
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const twoDaysLater = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    
    const [calRes, mailRes] = await Promise.allSettled([
      fetch("https://graph.microsoft.com/v1.0/me/calendarview?" + new URLSearchParams({
        startDateTime: todayStart.toISOString(),
        endDateTime: twoDaysLater.toISOString(),
        $top: "30",
        $select: "subject,start,end,location,organizer,attendees",
        $orderby: "start/dateTime",
      }), { headers }),
      fetch("https://graph.microsoft.com/v1.0/me/messages?" + new URLSearchParams({
        $top: "15",
        $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments,conversationId",
        $orderby: "receivedDateTime desc",
      }), { headers }),
    ]);

    if (calRes.status === "fulfilled" && calRes.value.ok) {
      const calData = await calRes.value.json();
      const events = calData.value || [];
      if (events.length > 0) {
        ctx += "\n### Calendar — Today & Next 7 Days (includes earlier today)\n";
        for (const ev of events) {
          const start = new Date(ev.start?.dateTime + "Z");
          const day = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
          const time = start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
          const loc = ev.location?.displayName ? ` at ${ev.location.displayName}` : "";
          const organiser = ev.organizer?.emailAddress?.name || "";
          const attendeeNames = (ev.attendees || []).slice(0, 4).map((a: any) => a.emailAddress?.name).filter(Boolean).join(", ");
          ctx += `- ${day} ${time}: ${ev.subject || "No subject"}${loc}${organiser ? ` (organised by ${organiser})` : ""}${attendeeNames ? ` - with ${attendeeNames}` : ""}\n`;
        }
      }
    }

    if (mailRes.status === "fulfilled" && mailRes.value.ok) {
      const mailData = await mailRes.value.json();
      const messages = mailData.value || [];
      if (messages.length > 0) {
        ctx += "\n### Recent Emails (latest 15)\n";
        for (const msg of messages) {
          const from = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown";
          const date = new Date(msg.receivedDateTime);
          const when = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
          const unread = msg.isRead ? "" : " [UNREAD]";
          const attach = msg.hasAttachments ? " [+attachments]" : "";
          const preview = (msg.bodyPreview || "").slice(0, 120).replace(/\n/g, " ");
          const msgId = msg.id ? ` [msgId:${msg.id}]` : "";
          ctx += "- " + when + " from " + from + unread + attach + ': "' + (msg.subject || "(No subject)") + '" - ' + preview + msgId + "\n";
        }
      }
    }

    setCache(cacheKey, ctx, 3 * 60 * 1000);
    return ctx;
  } catch (err) {
    console.error("Failed to load email/calendar context:", err);
    return "";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── Land Registry documents via PropertyData ─────────────────────────────
// Fetches Title Register / Title Plan for one or MORE titles, downloads the
// ZIP PropertyData returns, and extracts the PDF text server-side so the
// model can read the register (lease parties, term, charges) directly —
// previously it could only hand the user a download link, and only for a
// single title per call.
interface LandRegDocResult {
  title: string;
  documentUrl: string | null;
  alreadyPurchased: boolean;
  files: Array<{ filename: string; text?: string; note?: string }>;
  proprietorData?: any;
  error?: string;
  // True once PropertyData actually returns a document. When false the
  // order didn't complete — never report that as a delivered plan/register.
  delivered?: boolean;
  // What our own ingested HMLR register knows about this title, filled in
  // when PropertyData yields nothing so the ownership question is still
  // answered (free, instant) instead of dead-ending.
  registerKnown?: {
    source: string;
    proprietors: string[];
    propertyAddress: string | null;
    tenure: string | null;
    pricePaid: string | null;
    dataset: string | null;
  } | null;
  // Actionable next step when PropertyData can't fulfil the stamped PDF —
  // order it direct from HMLR rather than retrying a broken endpoint.
  manualOrder?: { url: string; note: string };
}

async function fetchLandRegistryDocuments(
  apiKey: string,
  titles: string[],
  documents: string,
  extractProprietor: boolean,
): Promise<LandRegDocResult[]> {
  const MAX_TITLES = 4;          // cost guard — each title is a paid purchase
  const MAX_TEXT_PER_PDF = 15000; // keep tool results inside sane token budgets
  const HMLR_ORDER_URL = "https://search-property-information.service.gov.uk/"; // gov.uk official-copy ordering (£3/doc)
  const results: LandRegDocResult[] = [];

  // PropertyData's land-registry-documents reseller is flaky on regional /
  // OCOD-held titles — it 404s or returns alreadyPurchased:false with no
  // document, even when the title is valid. When that happens we must NOT
  // dead-end: answer the ownership question from our own ingested HMLR
  // register (free, instant) and hand back the direct-HMLR order link for
  // the official stamped PDF.
  const finalize = async (out: LandRegDocResult) => {
    out.delivered = !!out.documentUrl;
    if (out.delivered) return;
    try {
      const { findProprietorsByTitle } = await import("./hmlr-direct");
      const props = await findProprietorsByTitle(out.title);
      if (props.length) {
        out.registerKnown = {
          source: "in-house HMLR register (CCOD/OCOD)",
          proprietors: props.map((p) => p.proprietorName).filter((n): n is string => !!n),
          propertyAddress: props[0].propertyAddress || null,
          tenure: props[0].tenure || null,
          pricePaid: props[0].pricePaid || null,
          dataset: props[0].dataset || null,
        };
      }
    } catch {
      // Register lookup is best-effort — the manual-order step below still
      // gives the user an actionable path.
    }
    out.manualOrder = {
      url: HMLR_ORDER_URL,
      note: `PropertyData could not return a document for ${out.title}. Order the official title plan/register direct from HMLR (£3 each) at the link, searching by title number ${out.title}.`,
    };
  };

  for (const rawTitle of titles.slice(0, MAX_TITLES)) {
    const title = rawTitle.trim().toUpperCase();
    if (!title) continue;
    const out: LandRegDocResult = { title, documentUrl: null, alreadyPurchased: false, files: [] };
    try {
      const params = new URLSearchParams({ key: apiKey, title, documents: documents || "both" });
      params.set("extract_proprietor_data", extractProprietor ? "true" : "false");
      const res = await fetch(`https://api.propertydata.co.uk/land-registry-documents?${params.toString()}`, {
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json().catch(() => ({} as any)) as any;
      if (!res.ok && !data?.document_url) {
        out.error = `PropertyData HTTP ${res.status}`;
        await finalize(out);
        results.push(out);
        continue;
      }
      if (data.status === "error" && !(data.code === "2906" && data.document_url)) {
        out.error = data.message || `PropertyData error (code ${data.code || "?"})`;
        await finalize(out);
        results.push(out);
        continue;
      }
      out.alreadyPurchased = data.code === "2906";
      out.documentUrl = data.document_url || null;
      if (data.proprietor_data || data.extracted_data) out.proprietorData = data.proprietor_data || data.extracted_data;

      // Download the ZIP and pull the text out of each PDF inside it.
      if (out.documentUrl) {
        try {
          const zipRes = await fetch(out.documentUrl, { signal: AbortSignal.timeout(60000) });
          if (!zipRes.ok) throw new Error(`download HTTP ${zipRes.status}`);
          const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
          const AdmZip = (await import("adm-zip")).default;
          const { extractPdfText } = await import("./document-reader");
          const zip = new AdmZip(zipBuffer);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            if (/\.pdf$/i.test(entry.entryName)) {
              try {
                const text = (await extractPdfText(entry.getData())).trim();
                out.files.push({
                  filename: entry.entryName,
                  text: text.length > MAX_TEXT_PER_PDF ? `${text.slice(0, MAX_TEXT_PER_PDF)}\n…[truncated]` : text,
                  // Title PLANS are map images — pdf text extraction returns
                  // little/nothing, which is expected, not a failure.
                  note: text.length < 40 ? "No extractable text (likely a plan/map PDF — use the download link to view it)" : undefined,
                });
              } catch (pdfErr: any) {
                out.files.push({ filename: entry.entryName, note: `PDF parse failed: ${pdfErr?.message}` });
              }
            } else {
              out.files.push({ filename: entry.entryName, note: "non-PDF file — see download link" });
            }
          }
        } catch (zipErr: any) {
          out.files.push({ filename: "(zip)", note: `Couldn't download/extract: ${zipErr?.message}. Use the download link instead.` });
        }
      }
    } catch (err: any) {
      out.error = err?.message || "Unknown error";
    }
    await finalize(out);
    results.push(out);
  }
  return results;
}

export async function getCrmContext(): Promise<string> {
  const cached = getCached<string>("crmContext");
  if (cached) return cached;
  try {
    const [properties, deals, companies, contacts] = await Promise.all([
      withTimeout(storage.getCrmProperties() as Promise<CrmProperty[]>, 5000, []),
      withTimeout(storage.getCrmDeals() as Promise<CrmDeal[]>, 5000, []),
      withTimeout(storage.getCrmCompanies() as Promise<CrmCompany[]>, 5000, []),
      withTimeout(storage.getCrmContacts() as Promise<CrmContact[]>, 5000, []),
    ]);

    let requirementsCtx = "";
    let unitsCtx = "";
    let investmentCtx = "";
    try {
      const [reqRows, invReqRows, unitRows, invRows, compRows] = await Promise.all([
        withTimeout<{ rows: any[] }>(pool.query(`SELECT r.name, r.use, r.size, r.requirement_locations, r.under_offer, c.name as company_name 
          FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON r.company_id = c.id 
          WHERE r.deal_id IS NULL ORDER BY r.created_at DESC LIMIT 25`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout<{ rows: any[] }>(pool.query(`SELECT r.name, r.use_types as use, r.size_range as size, r.requirement_locations, r.requirement_types, c.name as company_name, r.status 
          FROM crm_requirements_investment r LEFT JOIN crm_companies c ON r.company_id = c.id 
          WHERE r.deal_id IS NULL ORDER BY r.created_at DESC LIMIT 15`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout<{ rows: any[] }>(pool.query(`SELECT au.unit_name, au.use_class, au.sqft, au.asking_rent, au.marketing_status, au.location, p.name as property_name 
          FROM available_units au LEFT JOIN crm_properties p ON au.property_id = p.id 
          WHERE au.marketing_status IN ('Available', 'Under Offer') ORDER BY au.created_at DESC LIMIT 20`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout<{ rows: any[] }>(pool.query(`SELECT asset_name as name, status, guide_price, address, asset_type, board_type FROM investment_tracker 
          WHERE status NOT IN ('Dead', 'Withdrawn') ORDER BY updated_at DESC LIMIT 15`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout<{ rows: any[] }>(pool.query(`SELECT tenant, name, area_location, headline_rent, rent_psf_nia, nia_sqft, use_class, transaction_type, lease_start 
          FROM crm_comps WHERE verified = true ORDER BY created_at DESC LIMIT 15`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
      ]);
      if (reqRows.rows.length > 0) {
        requirementsCtx = "\n### Open Requirements (active, no deal linked)\n";
        for (const r of reqRows.rows) {
          const uses = Array.isArray(r.use) ? r.use.join("/") : "";
          const sizes = Array.isArray(r.size) ? r.size.join(", ") : "";
          const locs = Array.isArray(r.requirement_locations) ? r.requirement_locations.join(", ") : "";
          requirementsCtx += `- ${r.name} (${r.company_name || "Unknown"}) — ${uses || "Any use"}, ${sizes || "Any size"}, ${locs || "Any location"}${r.under_offer ? " [UNDER OFFER]" : ""}\n`;
        }
      }
      if (invReqRows.rows.length > 0) {
        requirementsCtx += "\n### Open Investment Requirements (active, no deal linked)\n";
        for (const r of invReqRows.rows) {
          const uses = Array.isArray(r.use) ? r.use.join("/") : "";
          const sizes = Array.isArray(r.size) ? r.size.join(", ") : "";
          const locs = Array.isArray(r.requirement_locations) ? r.requirement_locations.join(", ") : "";
          const types = Array.isArray(r.requirement_types) ? r.requirement_types.join("/") : "";
          requirementsCtx += `- ${r.name} (${r.company_name || "Unknown"}) — ${types || "Any type"}, ${uses || "Any use"}, ${sizes || "Any size"}, ${locs || "Any location"} [${r.status || "Open"}]\n`;
        }
      }
      if (unitRows.rows.length > 0) {
        unitsCtx = "\n### Available/Under Offer Units\n";
        for (const u of unitRows.rows) {
          unitsCtx += `- ${u.unit_name} at ${u.property_name || "Unknown"} — ${u.use_class || ""}, ${u.sqft ? u.sqft.toLocaleString() + " sqft" : ""}, ${u.asking_rent ? "£" + u.asking_rent + " psf" : ""} [${u.marketing_status}]\n`;
        }
      }
      if (invRows.rows.length > 0) {
        investmentCtx = "\n### Investment Pipeline (active)\n";
        for (const inv of invRows.rows) {
          investmentCtx += `- ${inv.name} — ${inv.status || ""}, ${inv.guide_price ? "£" + Number(inv.guide_price).toLocaleString() : "Price TBC"}, ${inv.asset_type || ""}, ${inv.board_type || ""}\n`;
        }
      }
      if (compRows.rows.length > 0) {
        investmentCtx += "\n### Recent Verified Comps (market evidence)\n";
        for (const comp of compRows.rows) {
          const psfDisplay = comp.rent_psf_nia ? `£${comp.rent_psf_nia} psf` : (comp.headline_rent ? `£${comp.headline_rent} pa` : "");
          investmentCtx += `- ${comp.tenant || "Unknown tenant"} at ${comp.name || "Unknown"} (${comp.area_location || ""}) — ${comp.use_class || ""}, ${comp.nia_sqft ? Number(comp.nia_sqft).toLocaleString() + " sqft" : ""}${psfDisplay ? ", " + psfDisplay : ""} [${comp.transaction_type || ""}${comp.lease_start ? ", " + comp.lease_start : ""}]\n`;
        }
      }
    } catch (e) {
      console.error("Failed to load extended CRM context:", e);
    }

    let ctx = "\n\n## CRM Data Summary\n";
    ctx += `Total: ${properties.length} properties, ${deals.length} deals, ${companies.length} companies, ${contacts.length} contacts\n`;

    if (deals.length > 0) {
      const activeDeals = deals.filter((d: any) => !["Dead", "Withdrawn", "Leasing Comps", "Investment Comps"].includes(d.status));
      const byStage: Record<string, number> = {};
      let totalFees = 0;
      for (const d of activeDeals) {
        const stage = d.status || "Unknown";
        byStage[stage] = (byStage[stage] || 0) + 1;
        if (d.fee) totalFees += Number(d.fee) || 0;
      }
      ctx += `\n**Pipeline snapshot**: ${activeDeals.length} active deals, total fees £${totalFees.toLocaleString()}\n`;
      ctx += `**By status**: ${Object.entries(byStage).map(([s, c]) => `${s}: ${c}`).join(", ")}\n`;

      ctx += "\n### Active Deals (latest 30)\n";
      for (const d of activeDeals.slice(0, 30)) {
        ctx += `- ${d.name} | ${d.dealType || ""} | ${d.status || ""} | Fee: ${d.fee ? "£" + Number(d.fee).toLocaleString() : "TBC"} | Team: ${d.team || ""} | Agent: ${(d.internalAgent || []).join(", ") || "Unassigned"}\n`;
      }
    }

    ctx += requirementsCtx;
    ctx += unitsCtx;
    ctx += investmentCtx;

    if (properties.length > 0) {
      ctx += "\n### Properties (latest 30)\n";
      for (const p of properties.slice(0, 30)) {
        const addr = typeof p.address === "object" && p.address ? ((p.address as any).formatted || (p.address as any).address || "") : (p.address || "");
        ctx += `- ${p.name}${addr ? " — " + addr : ""}${(p as any).assetClass ? " [" + (p as any).assetClass + "]" : ""}\n`;
      }
    }

    if (contacts.length > 0) {
      ctx += "\n### Key Contacts (latest 30)\n";
      for (const c of contacts.slice(0, 30)) {
        ctx += `- ${c.name}${c.companyName ? " @ " + c.companyName : ""}${c.email ? " (" + c.email + ")" : ""}${(c as any).title ? " — " + (c as any).title : ""}\n`;
      }
    }

    if (companies.length > 0) {
      ctx += "\n### Companies (latest 30)\n";
      for (const co of companies.slice(0, 30)) {
        ctx += `- ${co.name}${co.companyType ? " [" + co.companyType + "]" : ""}${(co as any).isClient ? " ★ Client" : ""}\n`;
      }
    }

    setCache("crmContext", ctx, 2 * 60 * 1000); // 2-minute cache
    return ctx;
  } catch (err) {
    console.error("Failed to load CRM context:", err);
    return "";
  }
}

// Invalidate CRM context cache when CRM data changes (call from crm.ts on mutations)
export function invalidateCrmContextCache() {
  contextCache.delete("crmContext");
}


// ── Client-login guard ────────────────────────────────────────────────────
// External client users (e.g. Landsec) must not reach ChatBGP's CRM/DB
// tools — sql_query alone would hand them the firm's fee book. For client
// requests we strip ALL tools and pin a hard constraint block into the
// prompt. (Landsec audit.)
const CLIENT_CHAT_CONSTRAINT = `\n\n## EXTERNAL CLIENT SESSION — HARD RULES\nYou are speaking with an EXTERNAL CLIENT of BGP (not BGP staff). You have NO tools in this session. Answer only from the conversation itself and general knowledge. NEVER discuss: BGP fees, commissions, WIP or billing; other BGP clients or their deals/properties; BGP staff personal information; any internal BGP operations. If asked for portfolio data beyond what the user provides, direct them to their portfolio dashboard or their BGP contact. Be warm and helpful within these limits.\n`;

export async function clientChatGuard(req: any): Promise<{ isClient: boolean; constraint: string }> {
  try {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req)) {
      return { isClient: true, constraint: CLIENT_CHAT_CONSTRAINT };
    }
    return { isClient: false, constraint: "" };
  } catch {
    // Fail CLOSED: if we can't confirm the user is staff, treat as a client
    // and strip tools rather than leaving the full toolset attached.
    return { isClient: true, constraint: CLIENT_CHAT_CONSTRAINT };
  }
}

// ---- Client scope (external logins, e.g. Landsec) ----
// External client users get: a restricted tool allowlist, a CRM context
// scoped to their own properties/units/deals/tenants, and none of the
// firm-wide knowledge base, business learnings, or pipeline data.

// Woody, 2026-07: "release chat to fully access the app, no restrictions
// other than BGP SharePoint." So this is a BLOCKlist, not an allowlist — a
// client's ChatBGP can drive the app the same way an agent's can (boards,
// letting tracker, units, viewings/offers, deals, briefs, documents, decks,
// images, tasks, comps, requirements, pathway), and new app tools are
// available to clients by default instead of silently missing.
//
// What stays blocked, and why:
//  1. BGP's own systems — SharePoint / OneDrive / Dropbox / BGP mailboxes /
//     BGP diaries / WhatsApp. This is the carve-out Woody asked for; filing
//     to SharePoint stays a BGP-team action.
//  2. Raw database, codebase and destructive/firm-wide operations. These
//     aren't app features, they're admin — and they're the one route by which
//     a client session (or a prompt injection inside one) could read or wreck
//     ANOTHER client's data or the app itself.
//  3. BGP's money and internal memory — WIP, Xero, the firm knowledge base,
//     saved learnings, other people's chat history.
export const CLIENT_BLOCKED_TOOLS = new Set([
  // 1. BGP systems (the SharePoint carve-out)
  "browse_sharepoint_folder", "create_sharepoint_folder", "move_sharepoint_item",
  "read_sharepoint_file", "upload_to_sharepoint", "copy_dropbox_to_sharepoint",
  "browse_dropbox", "download_email_attachment", "get_email_attachments",
  "search_emails", "reply_email", "send_email", "send_whatsapp",
  "query_calendar", "search_calendar",
  // 2. Raw DB / codebase / destructive / firm-wide
  "sql_query", "sql_write", "add_database_column", "describe_schema",
  "delete_record", "wipe_crm_deals", "bulk_update_crm", "merge_properties",
  "scan_duplicates", "find_duplicate_properties",
  // House templates are firm-shared state — create/update were open while
  // only delete was blocked, letting a client session rewrite BGP's templates.
  "delete_document_template", "create_document_template", "update_document_template",
  "run_shell_command", "restart_application", "git_diff", "git_status",
  "grep_codebase", "read_source_file", "edit_source_file", "list_project_files",
  "list_chatbgp_branches", "merge_chatbgp_branch", "revert_chatbgp_commit",
  "trigger_archivist_crawl", "run_brand_enrichment_backfill", "import_wip_excel",
  // 3. BGP money + internal memory
  // get_aged_receivables is BGP's own Xero sales ledger (who owes the firm
  // fees) — same category as query_wip/query_xero. query_turnover reads the
  // whole turnover table unscoped, i.e. any landlord's tenant turnover.
  "query_wip", "query_xero", "get_aged_receivables", "query_turnover",
  "search_knowledge_base", "save_learning",
  "search_chat_history", "manage_chat_members",
]);

export function isToolAllowedForClient(name: string): boolean {
  return !!name && !CLIENT_BLOCKED_TOOLS.has(name);
}

// Kept as a named export for the two hard gates below; `.has()` now means
// "allowed for a client", so the gate logic reads the same as before.
export const CLIENT_SAFE_TOOLS = { has: (name: string) => isToolAllowedForClient(name) };

export function filterToolsForClientScope(tools: any[]): any[] {
  return tools.filter(t => isToolAllowedForClient(t?.function?.name));
}

export const CLIENT_SYSTEM_PROMPT = `You are ChatBGP, the AI assistant of Bruce Gillingham Pollard (BGP), currently speaking with a CLIENT of BGP — not a BGP staff member.

Strict rules:
- You may only discuss this client's own properties, units, deals and the tenants on them. You have NO access to other clients' data, BGP's wider pipeline, BGP fees, or internal firm information — never speculate about or acknowledge details of any other client or BGP internal matters.
- Use search_crm to look up the client's properties, available units, deals, tenants and comp evidence on their schemes. Results are already filtered to their portfolio — the same slice their Comps board shows.
- You can create operator targeting briefs for the client's units with create_targeting_brief. Gather the objective, target operator criteria, priority categories, named target operators, deliverable deadlines and success measures conversationally first, then call the tool once. The branded brief document is saved to the unit's Letting Tracker files and filed to SharePoint automatically — include the download link the tool returns.
- **You can drive the app on their behalf, not just answer questions.** You have the same app tooling an agent has for their portfolio: update properties and units, maintain the tenancy/leasing schedule, log viewings and offers, create and update deals, requirements, comps, companies and contacts, run the Property Pathway, generate documents/decks/PDFs/Word/Excel, create and edit images and file them to a building, manage tasks and diary entries, run KYC/covenant checks and look up market data. If a request maps to a tool, DO IT rather than telling them to ask their BGP team.
- Two things you genuinely cannot do: (a) anything in BGP's own systems — SharePoint/OneDrive filing, BGP mailboxes, BGP diaries; and (b) raw database, bulk/merge/delete or app-administration operations. For those, say plainly that it's a BGP-team action and offer to do the in-app equivalent (e.g. attach the document to the property/unit record instead of a SharePoint folder).
- Never reveal or infer anything about another client, another landlord's portfolio, BGP's internal fees/WIP or the firm's pipeline. Every tool call you make must concern THIS client's own properties, units, deals and tenants. If a request would require reaching outside their portfolio, decline that part.
- Be professional and concise. Use UK English and UK date/number formats.`;

export async function getClientCrmContext(scopeCompanyId: string): Promise<string> {
  const cacheKey = `crmContext:client:${scopeCompanyId}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;
  try {
    const propsQ = await pool.query(
      `SELECT p.id, p.name, p.address::text AS address
       FROM crm_properties p
       WHERE p.landlord_id = $1
          OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1)
       ORDER BY p.name LIMIT 50`,
      [scopeCompanyId]
    );
    const propIds = propsQ.rows.map(r => r.id);
    let unitsQ: { rows: any[] } = { rows: [] };
    let dealsQ: { rows: any[] } = { rows: [] };
    if (propIds.length > 0) {
      [unitsQ, dealsQ] = await Promise.all([
        pool.query(
          `SELECT au.unit_name, au.use_class, au.sqft, au.asking_rent, au.marketing_status, p.name AS property_name
           FROM available_units au JOIN crm_properties p ON p.id = au.property_id
           WHERE au.property_id = ANY($1) ORDER BY p.name, au.unit_name LIMIT 60`,
          [propIds]
        ).catch(() => ({ rows: [] })),
        pool.query(
          `SELECT d.name, d.status, d.deal_type, p.name AS property_name,
                  (SELECT name FROM crm_companies WHERE id = d.tenant_id) AS tenant_name
           FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id
           WHERE (d.property_id = ANY($1) OR d.landlord_id = $2)
             AND d.status NOT IN ('Dead','Withdrawn')
           ORDER BY d.updated_at DESC LIMIT 40`,
          [propIds, scopeCompanyId]
        ).catch(() => ({ rows: [] })),
      ]);
    }

    let ctx = "\n\n## Your Portfolio (all data below is limited to your own instructions)\n";
    if (propsQ.rows.length === 0) {
      ctx += "No properties are currently linked to your account. Ask your BGP team to link your instructions.\n";
    } else {
      ctx += `\n### Properties (${propsQ.rows.length})\n`;
      for (const p of propsQ.rows) {
        let addr = "";
        try { const a = JSON.parse(p.address); addr = a?.formatted || a?.address || ""; } catch { addr = p.address || ""; }
        ctx += `- ${p.name}${addr ? " — " + addr : ""}\n`;
      }
      if (unitsQ.rows.length > 0) {
        ctx += `\n### Units\n`;
        for (const u of unitsQ.rows) {
          ctx += `- ${u.unit_name} at ${u.property_name} — ${u.use_class || ""}${u.sqft ? ", " + Number(u.sqft).toLocaleString() + " sq ft" : ""}${u.asking_rent ? ", £" + Number(u.asking_rent).toLocaleString() + " pa asking" : ""} [${u.marketing_status || "Available"}]\n`;
        }
      }
      if (dealsQ.rows.length > 0) {
        ctx += `\n### Active deals on your properties\n`;
        for (const d of dealsQ.rows) {
          ctx += `- ${d.name}${d.property_name ? " at " + d.property_name : ""} | ${d.deal_type || ""} | ${d.status || ""}${d.tenant_name ? " | Tenant: " + d.tenant_name : ""}\n`;
        }
      }
    }
    setCache(cacheKey, ctx, 2 * 60 * 1000);
    return ctx;
  } catch (err) {
    console.error("Failed to load client CRM context:", err);
    return "";
  }
}

// Scoped replacement for search_crm when the requester is a client login.
// Searches ONLY the client's own properties, units on them, deals on them,
// the tenant companies on those deals, and comp evidence on their schemes
// (same scope as the client Comps page). No contacts, no fees, no
// investment pipeline, no requirements.
export async function clientScopedCrmSearch(scopeCompanyId: string, rawQuery: string): Promise<any> {
  const q = `%${rawQuery.trim()}%`;
  const words = rawQuery.trim().split(/\s+/).filter(w => w.length >= 2).map(w => `%${w}%`);
  const patterns = [q, ...words];
  const like = (col: string, startIdx: number) => patterns.map((_, i) => `${col} ILIKE $${startIdx + i}`).join(" OR ");

  const results: any = {};
  const scopedPropsSql = `SELECT p.id FROM crm_properties p WHERE p.landlord_id = $1 OR p.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1)`;

  const props = await pool.query(
    `SELECT p.id, p.name, p.status, p.address::text AS address FROM crm_properties p
     WHERE p.id IN (${scopedPropsSql})
       AND (${like("p.name", 2)} OR ${like("p.address::text", 2 + patterns.length)})
     LIMIT 15`,
    [scopeCompanyId, ...patterns, ...patterns]
  ).catch(() => ({ rows: [] }));
  results.properties = props.rows;

  const units = await pool.query(
    `SELECT au.id, au.unit_name AS "unitName", au.marketing_status AS "marketingStatus", au.property_id AS "propertyId", p.name AS "propertyName"
     FROM available_units au JOIN crm_properties p ON p.id = au.property_id
     WHERE au.property_id IN (${scopedPropsSql})
       AND (${like("au.unit_name", 2)} OR ${like("p.name", 2 + patterns.length)})
     LIMIT 15`,
    [scopeCompanyId, ...patterns, ...patterns]
  ).catch(() => ({ rows: [] }));
  results.availableUnits = units.rows;

  const deals = await pool.query(
    `SELECT d.id, d.name, d.status, d.deal_type AS "dealType", p.name AS "propertyName",
            (SELECT name FROM crm_companies WHERE id = d.tenant_id) AS "tenantName"
     FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id
     WHERE (d.property_id IN (${scopedPropsSql}) OR d.landlord_id = $1)
       AND d.status NOT IN ('Dead','Withdrawn')
       AND (${like("d.name", 2)} OR ${like("p.name", 2 + patterns.length)})
     LIMIT 15`,
    [scopeCompanyId, ...patterns, ...patterns]
  ).catch(() => ({ rows: [] }));
  results.deals = deals.rows;

  const tenants = await pool.query(
    `SELECT DISTINCT c.id, c.name FROM crm_companies c
     WHERE (c.id = $1 OR c.id IN (
        SELECT d.tenant_id FROM crm_deals d
        WHERE d.tenant_id IS NOT NULL AND (d.property_id IN (${scopedPropsSql}) OR d.landlord_id = $1)
     ))
       AND (${like("c.name", 2)})
     LIMIT 15`,
    [scopeCompanyId, ...patterns]
  ).catch(() => ({ rows: [] }));
  results.companies = tenants.rows;

  // Comp evidence on the client's own schemes — same scope the Comps page
  // applies for client viewers (crm.ts GET /api/crm/comps): linked to a
  // portfolio property, landlord = the client, or (legacy free-text comps)
  // the scheme name appears in the comp's name/address. The chat used to
  // skip comps entirely, so it claimed "no comps" while the Comps board
  // showed dozens (Woody, 2026-08-04).
  const comps = await pool.query(
    `SELECT c.id, c.name, c.tenant, c.landlord, c.deal_type AS "dealType",
            c.headline_rent AS "headlineRent", c.completion_date AS "completionDate",
            p.name AS "propertyName"
     FROM crm_comps c LEFT JOIN crm_properties p ON p.id = c.property_id
     WHERE (
        c.property_id IN (${scopedPropsSql})
        OR c.landlord_company_id = $1
        OR EXISTS (
          SELECT 1 FROM crm_properties sp
          WHERE (sp.landlord_id = $1 OR sp.id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1))
            AND length(split_part(sp.name, ',', 1)) >= 5
            AND (c.name || ' ' || COALESCE(c.address::text, '')) ILIKE '%' || split_part(sp.name, ',', 1) || '%'
        )
     )
       AND (${like("c.name", 2)} OR ${like("c.tenant", 2 + patterns.length)} OR ${like("c.landlord", 2 + 2 * patterns.length)})
     ORDER BY c.completion_date DESC NULLS LAST
     LIMIT 25`,
    [scopeCompanyId, ...patterns, ...patterns, ...patterns]
  ).catch(() => ({ rows: [] }));
  results.comps = comps.rows;

  const totalFound = Object.values(results).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
  return { success: true, query: rawQuery, totalFound, results, note: "Results are limited to your own portfolio." };
}

const SYSTEM_PROMPT_FALLBACK = "You are ChatBGP, an AI assistant for Bruce Gillingham Pollard (BGP). You are powered by Claude Fable. IMPORTANT: If deep_investigate returns report.property.ambiguous === true, present the options as a numbered list and ask the user to pick the correct property. Do NOT guess or proceed with unverified property data.";

export async function getAvailableTools(): Promise<{
  modelTemplates: any[];
  docTemplates: any[];
  tools: any[];
}> {
  const cached = getCached<{ modelTemplates: any[]; docTemplates: any[]; tools: any[] }>("availableTools");
  if (cached) return cached;

  const modelTemplates = await storage.getExcelTemplates();
  const docTemplatesRaw = await storage.getDocumentTemplates();
  const docTemplates = docTemplatesRaw
    .filter((t) => t.status === "approved")
    .map((t) => ({
      ...t,
      fields: JSON.parse(t.fields || "[]"),
    }));

  const tools: any[] = [];

  if (modelTemplates.length > 0) {
    const templateDescriptions = modelTemplates.map((t) => {
      const inputs = JSON.parse(t.inputMapping || "{}");
      const inputFields = Object.entries(inputs)
        .map(([key, val]: [string, any]) => `${key} (${val.label}, type: ${val.type})`)
        .join(", ");
      return `Template "${t.name}" (id: ${t.id}): inputs: ${inputFields}`;
    }).join("\n");

    tools.push({
      type: "function",
      function: {
        name: "run_model",
        description: `Run a financial property model to calculate IRR, yields, MOIC, etc. Available templates:\n${templateDescriptions}`,
        parameters: {
          type: "object",
          properties: {
            templateId: {
              type: "string",
              description: "The template ID to use",
            },
            name: {
              type: "string",
              description: "A name for this model run, e.g. the property name or deal",
            },
            inputValues: {
              type: "object",
              description: "Key-value pairs of input field IDs and their values. Use the field IDs from the template descriptions.",
              additionalProperties: true,
            },
          },
          required: ["templateId", "name", "inputValues"],
        },
      },
    });
  }

  if (docTemplates.length > 0) {
    const templateDescriptions = docTemplates.map((t: any) => {
      const fieldsList = t.fields
        .map((f: any) => `${f.id} (${f.label}, type: ${f.type})`)
        .join(", ");
      return `Template "${t.name}" (id: ${t.id}): ${t.description || ""}. Fields: ${fieldsList}`;
    }).join("\n");

    tools.push({
      type: "function",
      function: {
        name: "generate_document",
        description: `Generate a professional property document from a template. Available templates:\n${templateDescriptions}`,
        parameters: {
          type: "object",
          properties: {
            templateId: {
              type: "string",
              description: "The template ID to use",
            },
            fieldValues: {
              type: "object",
              description: "Key-value pairs of field IDs and their values. Use the field IDs from the template descriptions.",
              additionalProperties: true,
            },
          },
          required: ["templateId", "fieldValues"],
        },
      },
    });
  }

  // ── New brief-based document generation (Document Studio convergence) ──
  // Lets users say "Generate a Brochure for 12 Hanover Square" and the
  // brief framework pulls structured data + auto-resolves imagery + Claude
  // design renders the final HTML, all in one tool call.
  tools.push({
    type: "function",
    function: {
      name: "generate_brief_document",
      description: `Generate a polished BGP document from the brief registry — the new path that uses Claude design + the imagery layer. Use this when the user asks for a Brochure, Why Buy memo, Heads of Terms, Rent Review Representations, or Market Report on a specific property or matter. Available briefs:
- "why-buy-memo" — PE-style 4-page investment memo (best with a Pathway run)
- "brochure" — letting/sale marketing brochure with hero + internals + floor plan + location plan
- "heads-of-terms" — concise 2-page HoT for a deal
- "rent-review-representations" — Tom + Pete's RR pack (REQUIRES matterId)
- "market-report" — area / asset-class market report with comps chart

The tool runs the brief, renders via Claude design, and saves to the canonical SharePoint folder per brief category. Prefer this over the legacy generate_document for any new property document.`,
      parameters: {
        type: "object",
        properties: {
          briefId: {
            type: "string",
            enum: ["why-buy-memo", "brochure", "heads-of-terms", "rent-review-representations", "market-report"],
            description: "Which brief to run.",
          },
          propertyId: {
            type: "string",
            description: "Canonical CRM property id (look it up via search_crm or resolveAddressToUprn first if you have a free-text address).",
          },
          matterId: {
            type: "string",
            description: "Optional PLA matter id — required for rent-review-representations brief; pulls linked comps + workbook snapshots.",
          },
          pathwayRunId: {
            type: "string",
            description: "Optional Pathway run id — for why-buy-memo brief, pulls Stage 6 business plan + Stage 7 model.",
          },
          saveToSharePoint: {
            type: "boolean",
            description: "Save the rendered HTML to the canonical SharePoint folder. Default true.",
          },
        },
        required: ["briefId", "propertyId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_document_template",
      description: "Modify an existing document template in the BGP app — e.g. rename it, change its description, rewrite the template content, or replace the field definitions. Use when the user asks to edit, rename, reword, remove a heading, add a logo placeholder, or otherwise change a template that already exists (not to create a new one). Look up the templateId from the docTemplates list provided above. Only include the fields you want to change; the rest stay as-is.",
      parameters: {
        type: "object",
        properties: {
          templateId: { type: "string", description: "The id of the existing template to update" },
          name: { type: "string", description: "New template name (optional)" },
          description: { type: "string", description: "New template description (optional)" },
          templateContent: { type: "string", description: "New full template content with {{fieldId}} placeholders (optional)" },
          fields: {
            type: "array",
            description: "New array of fillable fields — REPLACES the existing fields entirely (optional)",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                type: { type: "string", enum: ["text", "textarea", "number", "date", "select"] },
                placeholder: { type: "string" },
                section: { type: "string" },
              },
              required: ["id", "label", "type", "placeholder", "section"],
            },
          },
        },
        required: ["templateId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "delete_document_template",
      description: "Permanently delete a document template. Only call this when the user explicitly asks to remove, delete, or get rid of a template. Look up the templateId from the docTemplates list provided above.",
      parameters: {
        type: "object",
        properties: {
          templateId: { type: "string", description: "The id of the template to delete" },
        },
        required: ["templateId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_document_template",
      description: "Create a new reusable document template in the BGP app. Use this when the user asks you to build a document template based on example documents, SharePoint files, or descriptions. The template should contain {{placeholder}} fields that users can fill in when generating documents.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Template name, e.g. 'Leasing RFP Response' or 'Investment Sale Pitch'",
          },
          description: {
            type: "string",
            description: "Brief description of what this template is for",
          },
          templateContent: {
            type: "string",
            description: "The full template content with {{fieldId}} placeholders for dynamic fields. Use clear section headings and professional formatting. Each placeholder should match a field ID from the fields array.",
          },
          fields: {
            type: "array",
            description: "Array of fillable fields for the template",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Unique field identifier used in {{id}} placeholders" },
                label: { type: "string", description: "Human-readable label shown in the form" },
                type: { type: "string", enum: ["text", "textarea", "number", "date", "select"], description: "Field input type" },
                placeholder: { type: "string", description: "Example or hint text for the field" },
                section: { type: "string", description: "Section grouping for the field in the form" },
              },
              required: ["id", "label", "type", "placeholder", "section"],
            },
          },
        },
        required: ["name", "description", "templateContent", "fields"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_sharepoint_folder",
      description: "Create a folder in the BGP SharePoint site. All folders must be inside the 'BGP share drive' root folder. Team folders are at 'BGP share drive/Investment', 'BGP share drive/London F&B', 'BGP share drive/London Retail', etc. Can create folders inside team folders or any existing folder by providing its path. Call multiple times for nested structures.",
      parameters: {
        type: "object",
        properties: {
          folderName: {
            type: "string",
            description: "The name of the folder to create",
          },
          parentPath: {
            type: "string",
            description: "The path to the parent folder, e.g. 'London' to create inside the London team folder, or 'London/10 Eaton Place' to create inside a subfolder. Leave empty or '/' to create at root.",
          },
        },
        required: ["folderName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "read_sharepoint_file",
      description: "Read and extract the contents of a file from SharePoint or OneDrive. Use this when the user shares ANY SharePoint or OneDrive link or asks you to open/look at a file. Supports both team SharePoint (brucegillinghampollardlimited.sharepoint.com) and personal OneDrive (brucegillinghampollardlimited-my.sharepoint.com) URLs. Supports Excel (.xlsx/.xls), Word (.docx), PDF, CSV, and text files. You can provide either a sharing URL, a file path, or driveId + itemId from a previous browse_sharepoint_folder result.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "A SharePoint sharing URL (e.g. https://brucegillinghampollardlimited-my.sharepoint.com/:x:/g/personal/...) or a file path in the BGP SharePoint document library (e.g. 'Investment/Deal Files/report.xlsx'). Can be omitted when using driveId + itemId.",
          },
          driveId: {
            type: "string",
            description: "The driveId from a previous browse_sharepoint_folder result. Use together with itemId to read a file without needing a sharing URL.",
          },
          itemId: {
            type: "string",
            description: "The itemId from a previous browse_sharepoint_folder result. Use together with driveId to read a file directly.",
          },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "browse_sharepoint_folder",
      description: "Browse the contents of a SharePoint or OneDrive folder. Use this when the user shares ANY SharePoint or OneDrive folder link (containing /:f:/) or asks you to look at what's in a folder. Supports both team SharePoint and personal OneDrive URLs. Returns a list of files and subfolders with their names, types, sizes, driveId and itemId. To drill into a subfolder, call this tool again with the subfolder's driveId and itemId from the previous result — this is the most reliable way to navigate subfolders on personal OneDrive.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "A SharePoint sharing URL for a folder (e.g. https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/...) OR a folder path in the BGP SharePoint document library (e.g. 'Investment/Deal Files', 'London Retail'). Use '/' to browse the root. When drilling into subfolders from a previous browse result, you can omit this and use driveId + itemId instead.",
          },
          driveId: {
            type: "string",
            description: "The driveId of a subfolder returned from a previous browse_sharepoint_folder call. Use together with itemId to drill into subfolders without needing a sharing URL.",
          },
          itemId: {
            type: "string",
            description: "The itemId of a subfolder returned from a previous browse_sharepoint_folder call. Use together with driveId to drill into subfolders.",
          },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "move_sharepoint_item",
      description: "Move a file or folder from one location to another in the BGP SharePoint site. Use when the user asks to move, reorganise, or relocate files/folders. You can move items by their SharePoint path (e.g. 'Investment/Old Folder/report.xlsx') to a new destination folder path (e.g. 'Investment/New Folder'). Can also optionally rename the item during the move.",
      parameters: {
        type: "object",
        properties: {
          sourcePath: {
            type: "string",
            description: "The current path of the file or folder in SharePoint (e.g. 'Investment/Deal Files/report.xlsx' or 'London/Old Folder'). Can also be a SharePoint sharing URL.",
          },
          destinationFolderPath: {
            type: "string",
            description: "The path to the destination folder where the item should be moved to (e.g. 'Investment/New Folder', 'London Retail/Active Deals'). Use '/' for root.",
          },
          newName: {
            type: "string",
            description: "Optional: rename the item during the move. If not provided, the item keeps its original name.",
          },
        },
        required: ["sourcePath", "destinationFolderPath"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "upload_to_sharepoint",
      description: "Upload a file ALREADY IN CHAT-MEDIA STORAGE to a SharePoint folder. Only use for files generated by another tool (export_to_excel, generate_word, generate_claude_designed_pdf, etc.) or files the user has uploaded into the chat. The chatMediaFilename must follow the chat-media pattern (e.g. '1774348793476-f3ddbf080ba7fd73-Travelodge_Comps.xlsx'). DO NOT USE for email attachments — use `download_email_attachment` with `action: 'save_to_sharepoint'` instead, which handles the Graph download → SharePoint upload in one step. DO NOT USE for SharePoint-to-SharePoint moves — use `copy_dropbox_to_sharepoint` for that.",
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: {
            type: "string",
            description: "The filename from chat-media storage (e.g. '1774348793476-f3ddbf080ba7fd73-Travelodge_Comps.xlsx'). This is the filename portion from the /api/chat-media/ URL — NOT the original file name from an email attachment.",
          },
          destinationFolderPath: {
            type: "string",
            description: "The SharePoint folder path to upload into (e.g. 'Leasing Comps/hotels', 'Investment/Deal Files'). The folder will be created if it doesn't exist.",
          },
          fileName: {
            type: "string",
            description: "Optional: custom filename for the uploaded file. If not provided, uses the original filename.",
          },
        },
        required: ["chatMediaFilename", "destinationFolderPath"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_deal",
      description: "Create a new deal in the BGP CRM. Use when the user asks to add a deal, log a transaction, or start tracking a new piece of work.\n\nIMPORTANT — client side picks the right counterparty:\n  • Tenant Rep / Lease Acquisition / Lease Disposal → tenantId is the client.\n  • New Letting → landlordId is the client.\n  • Sale → vendorId is the client. Purchase → purchaserId is the client.\nAlways set whichever of landlordId / tenantId / vendorId / purchaserId is the client BEFORE creating, otherwise the WIP report will show 'Unknown' for client. If the user names a client company that doesn't exist yet in the CRM, call create_company first, then pass the new id here.\n\nIMPORTANT — property linking + disambiguation: if the user gives an address, ALWAYS call search_crm({entityType:'properties'}) first. If it returns more than one property at that address, STOP and ask the user which one — show the candidates with their id, name, status, and any postcode/area. Do not pick the first one yourself. Once the user has picked, pass propertyId here.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Deal name (usually the property address)" },
          propertyId: { type: "string", description: "CRM property UUID. Set after the user has confirmed which property when multiple share the address." },
          landlordId: { type: "string", description: "CRM company UUID of the landlord. The client on New Letting deals." },
          tenantId: { type: "string", description: "CRM company UUID of the tenant. The client on Tenant Rep / Lease Acquisition / Lease Disposal deals." },
          vendorId: { type: "string", description: "CRM company UUID of the vendor. The client on Sale deals." },
          purchaserId: { type: "string", description: "CRM company UUID of the purchaser. The client on Purchase deals." },
          team: { type: "array", items: { type: "string" }, description: "Team(s): London F&B, London Retail, National Leasing, Investment, Tenant Rep, Development, Lease Advisory, Office / Corporate" },
          groupName: { type: "string", description: "Pipeline stage: Under Offer, Exchanged, Completed, New Instructions, etc." },
          dealType: { type: "string", description: "Type: New Letting, Lease Acquisition, Lease Disposal, Lease Renewal, Rent Review, Sale, Purchase" },
          status: { type: "string", description: "Status of the deal" },
          pricing: { type: "number", description: "Deal value/price in GBP" },
          fee: { type: "number", description: "BGP fee in GBP" },
          rentPa: { type: "number", description: "Annual rent in GBP" },
          totalAreaSqft: { type: "number", description: "Total area in sq ft" },
          comments: { type: "string", description: "Any additional notes" },
        },
        required: ["name"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_deal",
      description: "Update an existing deal in the CRM. Use when the user asks to change a deal's status, price, stage, or any other field.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The deal ID (UUID)" },
          name: { type: "string" },
          team: { type: "array", items: { type: "string" } },
          groupName: { type: "string" },
          dealType: { type: "string" },
          status: { type: "string" },
          pricing: { type: "number" },
          fee: { type: "number" },
          rentPa: { type: "number" },
          totalAreaSqft: { type: "number" },
          comments: { type: "string" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_contact",
      description: "Create a new contact in the BGP CRM. Use when the user mentions a new person to track.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name" },
          email: { type: "string", description: "Email address" },
          phone: { type: "string", description: "Phone number" },
          role: { type: "string", description: "Job title/role" },
          companyName: { type: "string", description: "Company name" },
          contactType: { type: "string", description: "Type: Landlord, Tenant, Agent, Surveyor, Solicitor, etc." },
          notes: { type: "string" },
        },
        required: ["name"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_contact",
      description: "Update an existing contact in the CRM.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The contact ID (UUID)" },
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          role: { type: "string" },
          companyName: { type: "string" },
          contactType: { type: "string" },
          notes: { type: "string" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_company",
      description: "Create a new company in the BGP CRM.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Company name" },
          companyType: { type: "string", description: "Type: Landlord, Tenant, Agent, Developer, Investor, etc." },
          description: { type: "string", description: "Brief description" },
          domain: { type: "string", description: "Website domain" },
          groupName: { type: "string", description: "CRM group" },
        },
        required: ["name"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_company",
      description: "Update an existing company in the CRM.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The company ID (UUID)" },
          name: { type: "string" },
          companyType: { type: "string" },
          description: { type: "string" },
          domain: { type: "string" },
          groupName: { type: "string" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_company_accounts",
      description: "Download and read the latest filed Companies House annual accounts for a company — returns turnover, gross profit, operating profit, profit before tax, net assets, cash and employee numbers. Works for ANY UK company: pass companyNumber (from deep_investigate/run_kyc_check) for companies not yet in the CRM — a minimal CRM record is created automatically so the filing is banked. Triggers the PDF download if it isn't already cached, then reads the figures off the filing with vision.",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Company name, e.g. 'Goyard Limited'. Used to look up the CRM company if companyId isn't known." },
          companyId: { type: "string", description: "CRM company UUID, if already known." },
          companyNumber: { type: "string", description: "Companies House number, e.g. '08506610'. Use this for companies not yet in the CRM — the record is created automatically." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_crm",
      description: "Search across the BGP CRM for deals, contacts, companies, properties, investment tracker items, and available units by keyword. Searches broadly — splits multi-word queries to find partial matches (e.g. '16 Tottenham Court Road' will find '6-17 Tottenham Court Road'). Use this to find records before updating or to answer user questions about specific items.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword or phrase. For addresses/properties, try the street name without the number as well." },
          entityType: { type: "string", enum: ["deals", "contacts", "companies", "properties", "investment", "units", "requirements", "comps", "all"], description: "Which entity type to search. Default: all" },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_brand_profile",
      description: "Get the full BGP brand bible for a retail brand — covenant (Companies House health, traffic light), rollout velocity (openings/closures last 12m), store footprint, rent affordability vs peer comps, turnover history, active requirements, pitched-to history (every leasing schedule this brand has been a target on), completed + active deals, agent representations, contacts with last touchpoint, and the AI-classified signals timeline. Use this when the user asks 'who should pitch for X', 'is brand Y expanding', 'what's their covenant', 'when did we last touch them', or anything about a specific retail brand.",
      parameters: {
        type: "object",
        properties: {
          companyId: { type: "string", description: "The company UUID. Prefer this when known." },
          name: { type: "string", description: "Brand name — used if companyId isn't known. Matched case-insensitive." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_investment_tracker",
      description: "Update an existing investment tracker item. Use when the user asks to change an investment record's status, client, price, notes, or any other field. Search first to find the record ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The investment tracker item ID (UUID)" },
          assetName: { type: "string" },
          status: { type: "string", description: "e.g. Reporting, Under Offer, Exchanged, Completed, Withdrawn, On Hold" },
          client: { type: "string" },
          clientContact: { type: "string" },
          vendor: { type: "string" },
          vendorAgent: { type: "string" },
          buyer: { type: "string" },
          guidePrice: { type: "number" },
          niy: { type: "number" },
          eqy: { type: "number" },
          sqft: { type: "number" },
          currentRent: { type: "number", description: "Passing rent per annum (£)" },
          ervPa: { type: "number", description: "Estimated rental value per annum (£)" },
          waultBreak: { type: "number", description: "WAULT to break (years)" },
          waultExpiry: { type: "number", description: "WAULT to expiry (years)" },
          occupancy: { type: "number", description: "Occupancy as a fraction (0.95 = 95%)" },
          capexRequired: { type: "number", description: "Capex required (£)" },
          notes: { type: "string" },
          tenure: { type: "string" },
          boardType: { type: "string", enum: ["Purchases", "Sales"] },
          fee: { type: "number" },
          feeType: { type: "string" },
          address: { type: "string" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "delete_record",
      description: "Delete a record from the CRM. Only use after confirming with the user. This is irreversible.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["deal", "contact", "company", "property"], description: "Type of record to delete" },
          id: { type: "string", description: "The record ID (UUID)" },
          confirmName: { type: "string", description: "The name of the record being deleted, for confirmation" },
        },
        required: ["entityType", "id", "confirmName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "navigate_to",
      description: "Navigate the user to a specific page in the BGP app. Use when the user says 'take me to', 'show me', 'go to', or asks to see a specific section.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "string", enum: ["dashboard", "deals", "comps", "investment-comps", "contacts", "companies", "properties", "requirements", "instructions", "news", "mail", "chatbgp", "sharepoint", "models", "templates", "settings", "land-registry", "voa-rates", "business-rates", "intelligence-map", "leasing-units", "leasing-schedule", "investment-tracker", "wip-report", "property-map", "map"], description: "The page to navigate to. Use 'property-map' or 'map' for the interactive Google Maps view with radius/distance tools." },
          message: { type: "string", description: "Brief message about why you're navigating there" },
          lat: { type: "number", description: "Latitude to centre the map on (only for property-map/map)" },
          lng: { type: "number", description: "Longitude to centre the map on (only for property-map/map)" },
          zoom: { type: "number", description: "Zoom level for the map (only for property-map/map, default 17)" },
        },
        required: ["page"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "property_lookup",
      description: "Look up comprehensive property information by property name, address, place name, or postcode. Aggregates data from multiple sources: EPC energy ratings, VOA rateable values, HMLR price paid transaction history, Environment Agency flood risk, Historic England listed buildings, and planning designations (conservation areas, article 4 directions, tree preservation orders, scheduled monuments). Use when the user asks about a property, wants to research an address, or needs property intelligence. You can pass just a property/place name (e.g. 'Harrods', '10 Downing Street', 'One Hyde Park') and the system will automatically find the postcode. For a focused planning-only query on a CRM property, prefer get_property_planning.",
      parameters: {
        type: "object",
        properties: {
          postcode: { type: "string", description: "UK postcode (e.g. SW1X 8DT). If not known, provide query instead." },
          query: { type: "string", description: "Property name, address, or place name to search for (e.g. 'Harrods', '10 Downing Street', 'Canary Wharf'). The system will find the postcode automatically." },
          street: { type: "string", description: "Street name (e.g. Eaton Place)" },
          buildingNameOrNumber: { type: "string", description: "Building name or number (e.g. 10 or Harrods)" },
          address: { type: "string", description: "Full address string for EPC lookup" },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_property_planning",
      description: "Get a focused planning-data summary for a CRM property: which constraints affect it (Listed Building, Conservation Area, Article 4 Direction, Tree Preservation Order, Scheduled Monument, World Heritage Site, Flood Risk Zone) and recent planning applications nearby (last 5 years). Faster and more focused than property_lookup when the user is asking specifically about planning, designations, or recent applications. Pass the crm_properties.id when known.",
      parameters: {
        type: "object",
        properties: {
          propertyId: { type: "string", description: "crm_properties.id of the property to look up" },
        },
        required: ["propertyId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "start_property_pathway",
      description: "Start a new end-to-end Property Pathway investigation on an address. This orchestrates all BGP app modules — email + SharePoint search, CRM lookup, Land Registry, brand enrichment, property intelligence, image studio, model studio, and Why Buy document generation. Returns a runId to use with advance_property_pathway and get_property_pathway. Always use this instead of ad-hoc tool chaining when the user asks for a comprehensive property investigation, deal briefing, or Why Buy document.\n\n**LAND REGISTRY GATE — DO NOT SKIP.** The whole pathway is built on a specific Land Registry title (freehold or leasehold). Picking the wrong title means every downstream stage — tenant schedule, owner, valuation, Why Buy — is wrong. The first call to this tool with just an address triggers a LandReg lookup and returns candidate titles WITHOUT creating the run. You MUST show those candidates to the user, ask them to pick the right one, and only then call this tool again with `confirmedTitleNumber` set. If LandReg returns nothing (no postcode match, off-register estate, big multi-title campus), you may pass `skipLandRegConfirmation: true` BUT you must first tell the user you couldn't find a clean title match and get them to explicitly agree to proceed without one.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "The property address, e.g. '18-22 Haymarket' or '17 Dover Street'" },
          postcode: { type: "string", description: "UK postcode, e.g. 'SW1Y 4DG'. Strongly recommended — without it the LandReg lookup is much weaker." },
          propertyId: { type: "string", description: "Optional CRM property id if this already has a record" },
          confirmedTitleNumber: { type: "string", description: "The Land Registry title number the USER has explicitly picked from the candidates returned by an earlier call. Only set this after the user has confirmed which title to base the pathway on." },
          skipLandRegConfirmation: { type: "boolean", description: "Set true ONLY when (a) LandReg returned no candidates and the user explicitly said to proceed without a title, or (b) the user has explicitly said 'skip the land reg check'. Never set this on the first call." },
          forceNew: { type: "boolean", description: "Set true ONLY when the user explicitly wants a brand-new, fresh pathway for an address that ALREADY has one (e.g. 'start a new one from scratch', 'ignore the existing investigation'). Bypasses the dedupe that would otherwise reuse the existing run for this address. Pass it on every call in that flow (the LandReg lookup call AND the confirmedTitleNumber call). Leave unset by default so we never spawn accidental duplicates." },
        },
        required: ["address"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "advance_property_pathway",
      description: "Kick off the next stage (or a specific stage) of a Property Pathway. Returns IMMEDIATELY — the stage runs in the background; the user watches progress on the watchUrl page. Safe to call multiple times in one turn for different runIds, so a portfolio of pathways can be progressed in parallel without timing out the chat. Stages: 1=Initial Search, 2=Brand Intel, 3=Review summary, 4=Property Intel (titles/planning/KYC), 5=Investigation Board, 6=Business Plan (user must agree before moving on), 7=Excel Model (refined in Excel add-in, user must agree), 8=Studios, 9=Why Buy PDF. After kicking off the stage, briefly tell the user it's running and link the watchUrl — do NOT wait or call again on the same run.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The pathway run id returned by start_property_pathway" },
          stage: { type: "number", description: "Optional specific stage to run (1-9). Defaults to current stage." },
        },
        required: ["runId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_business_plan",
      description: "Patch one or more fields on the Stage 6 business plan draft for a Property Pathway run. Use this as you discuss the plan with the user — whenever they agree to a change (e.g. 'bump the target price to £14m', 'let's make it a 5-year hold not 7'), call this tool to persist the change. Then restate the full updated plan so they can confirm. Do NOT call agree_business_plan yourself — only the user agrees, via the UI or by an explicit 'agree' request.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The pathway run id" },
          patch: {
            type: "object",
            description: "Partial BusinessPlan — any subset of: strategy, holdPeriodYrs, targetPurchasePrice, targetNIY (decimal), exitPrice, exitYield (decimal), exitYear, capex {amount, scope}, leasing {vacantUnits, targetRentPsf, reversionNotes}, equityCheck, targetIRR (decimal), targetMOIC, risks (string[]), keyMoves (string[]), notes",
          },
          note: { type: "string", description: "Optional short note on why this change was made (shown in the revision log)" },
        },
        required: ["runId", "patch"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "agree_business_plan",
      description: "Lock the current Stage 6 business plan draft as agreed, which unlocks Stage 7 (Excel Model). ONLY call this when the user explicitly says 'agree', 'lock it', 'ship it', or similar — never proactively. Always summarise the plan first and get explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The pathway run id" },
        },
        required: ["runId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_property_pathway",
      description: "Fetch the current state of a Property Pathway run — all stages, findings, images, model links, market intel (lease comps, availability, submarket context crawled from EG / CoStar / web during Stage 1), and the Why Buy PDF URL if generated. Use this to answer follow-up questions about a pathway investigation without re-running anything. If the user refers to a current investigation by address rather than runId, call list_property_pathway first to find the right runId.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The pathway run id" },
        },
        required: ["runId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "list_property_pathway",
      description: "List active and recent Property Pathway investigations on the board — address, current stage, who started it, last update. Use this when the user asks a general question about what's being worked on (\"how's Haymarket going?\", \"what investigations are open?\") so you can match their address/context to the right runId, then call get_property_pathway for detail.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional substring match on address/postcode to narrow the list" },
          limit: { type: "number", description: "Max runs to return (default 15)" },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "attach_workbook_to_pathway",
      description: "Attach an existing Excel model run to a Property Pathway's Stage 7 (Excel Model). Use when the user has refined a workbook in the Excel add-in and asks to 'save to the pathway'. Looks up the model run, links it to the pathway (top-level modelRunId + stageResults.stage7), and marks Stage 7 as running so the user can review and agree. Does NOT auto-agree the model — the user still needs to click Agree on the pathway card to lock it.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The pathway run id" },
          modelRunId: { type: "string", description: "The excel_model_runs id of the workbook being attached. The Excel add-in surfaces this as the 'linked model run'." },
          modelVersionId: { type: "string", description: "Optional specific version id. Defaults to the latest version of the model run." },
        },
        required: ["runId", "modelRunId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_pathway_tenancy",
      description: "Upsert a tenancy unit on a Property Pathway run (stage1.tenancy.units). Use after extracting lease terms — e.g. from a Land Registry title register, an email, or a brochure — so the run's tenancy schedule reflects the real lease and downstream documents (business plan, Why Buy) regenerate against it. Upserts by titleNumber (preferred) or tenantName+unitName; merges fields so partial updates don't wipe existing data.",
      parameters: {
        type: "object",
        properties: {
          runId: { type: "string", description: "The pathway run id" },
          tenantName: { type: "string", description: "Tenant company name, e.g. 'Waitrose Limited'" },
          unitName: { type: "string", description: "Unit/demise label, e.g. 'Ground & Basement'. Defaults to 'Whole'." },
          leaseStart: { type: "string", description: "Lease start date, ISO format (e.g. '2024-09-26')" },
          leaseExpiry: { type: "string", description: "Lease expiry date, ISO format (e.g. '2039-09-25')" },
          passingRentPa: { type: "number", description: "Passing rent per annum in £, if known" },
          sqft: { type: "number", description: "Demise area in sq ft, if known" },
          floor: { type: "string", description: "Floor(s), e.g. 'Ground, Basement'" },
          useClass: { type: "string", description: "Planning use class, e.g. 'E'" },
          titleNumber: { type: "string", description: "Land Registry title number of the occupational lease, e.g. 'TGL624521' — used as the upsert key" },
          notes: { type: "string", description: "Anything else worth keeping: break clauses, review pattern, alienation restrictions etc." },
          source: { type: "string", description: "Where the terms came from: 'land_registry', 'email', 'sharepoint', 'brochure', 'user'. Defaults to 'land_registry'." },
        },
        required: ["runId", "tenantName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "generate_word",
      description: "Generate a native Microsoft Word (.docx) document with professional formatting and BGP branding. Use when the user asks for a Word document, editable report, or anything they want to open and edit in Word.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title for the filename and header" },
          sections: {
            type: "array",
            description: "Array of content sections to include in the document",
            items: {
              type: "object",
              properties: {
                heading: { type: "string", description: "Section heading (optional)" },
                level: { type: "number", description: "Heading level: 1 for main headings, 2 for sub-headings (default 1)" },
                paragraphs: { type: "array", items: { type: "string" }, description: "Array of paragraph texts" },
                bullets: { type: "array", items: { type: "string" }, description: "Array of bullet point texts" },
                table: {
                  type: "object",
                  description: "Optional table data",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
        required: ["title", "sections"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "generate_pptx",
      description: [
        "Generate a native, editable Microsoft PowerPoint (.pptx) in BGP house style (green/gold, Georgia). Use for any PowerPoint / presentation / slides / deck / teaser / pitch.",
        "PREFER the rich `cards` model over `slides` — it produces dense, professional, teaser-grade boards. Each card = { type, ...fields }. Card types:",
        "• cover {title, subtitle?, eyebrow?, meta:[{label,value}]}  • section {number,title}  • statement {title, kick?, sub?} full-bleed emphasis",
        "• content {title, kick?, bullets:[string] | body, image?/ref?}  • two_col {title, leftTitle?, left:[string], rightTitle?, right:[string]}",
        "• highlights {title, items:[{title,body}] (2-6)} callout grid  • kpi {title, kpis:[{value,label}]}  • quote {quote, attribution?}",
        "• table {title, headers:[string], rows:[[string,...]]}  • comparison {title, columns:[string], rows:[{label,cells:[...]}]} (✓/—)",
        "• chart {title, chartType:'bar'|'line'|'pie'|'doughnut'|'area', labels:[string], values:[number] OR series:[{name,labels,values}]}",
        "• board {title, blocks:[{kind:'text'|'stat'|'chart'|'image'|'table'|'quote', col:0-11, colSpan, row:0+, rowSpan, ...}]}  ← DENSE composite: text + chart + photo + stats on ONE slide",
        "• timeline {title, milestones:[{date,title,body?}]}  • phasing {title, periods:[string], phases:[{label,start,span,note?}]} Gantt",
        "• map {title, caption?, pins:[{x:0-1,y:0-1,label}], list:[{label,sub?}]}  • disclaimer {title, paragraphs:[string]}  • closing {heading, body, contacts?}",
        "• covenant {title, companyName, grade:'A'-'E', score:0-100, status?, flags:[{level:'red'|'amber'|'info', label, detail?}], verdict?}  — tenant covenant slide; populate it from check_covenant results",
        "Any card may add an image via `ref` (a chat-media/image reference) or `image` (data URI). Order logically (cover → highlights/board → detail → closing). Prefer dense boards over one-idea-per-slide.",
      ].join("\n"),
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Presentation title for the filename and cover" },
          subtitle: { type: "string", description: "Optional subtitle for the cover" },
          cards: {
            type: "array",
            description: "PREFERRED. Array of typed card objects (see the card types in the tool description). Each item is { type, ...fields }.",
            items: { type: "object", properties: { type: { type: "string", description: "Card type (cover, content, board, chart, table, highlights, two_col, statement, quote, timeline, phasing, map, kpi, comparison, disclaimer, closing, image, section)" } }, required: ["type"] },
          },
          slides: {
            type: "array",
            description: "Legacy fallback (used only if `cards` is omitted). Simple slides.",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Slide title" },
                bullets: { type: "array", items: { type: "string" }, description: "Bullet point texts" },
                notes: { type: "string", description: "Optional speaker notes" },
                table: {
                  type: "object",
                  description: "Optional table",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                  },
                },
              },
              required: ["title"],
            },
          },
        },
        required: ["title"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "generate_org_chart",
      description: "Generate an organisation chart as an editable PowerPoint (.pptx): the classic connected-boxes hierarchy tree (boxes joined by lines), one chart per slide. Use whenever the user asks for an org chart, organogram, team structure, reporting lines or role hierarchy — generate_pptx can only do tables, not the tree. Every box is a movable shape, so the user can reshuffle names in PowerPoint.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Chart title (e.g. 'BGP Business Organisation Chart')" },
          tree: {
            type: "object",
            description: "The hierarchy as a nested tree. Each node: { name, role?, support?: string[], children?: node[] }. name = person or 'TBC'; role = function/title; support = additional team names shown under the lead in the same box. Keep total leaf nodes <= 12 for a readable single page.",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              support: { type: "array", items: { type: "string" } },
              children: { type: "array", items: { type: "object" } },
            },
            required: ["name"],
          },
          notes: { type: "array", items: { type: "string" }, description: "Optional footnotes shown under the chart (e.g. 'names suggested based on skill sets')." },
        },
        required: ["title", "tree"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "check_covenant",
      description: "Financial covenant / risk check on a UK company — the house replacement for Red Flag/Experian. Returns a 0-100 score, A-E grade, red/amber flags and a two-line verdict, built from Companies House (status, charges/debt, insolvency, overdue filings, officer churn, filed-accounts figures) and The Gazette (winding-up petitions and other corporate-insolvency notices). Use whenever the user asks about tenant covenant strength, financial health, credit risk, debt issues, or 'can they pay the rent' for any company. Provide the Companies House number if known, otherwise the exact company name (it will be resolved via CH search).",
      parameters: {
        type: "object",
        properties: {
          companyNumber: { type: "string", description: "Companies House number (preferred, e.g. '00365335')" },
          companyName: { type: "string", description: "Exact company name if the number is unknown — resolved via Companies House search" },
          refresh: { type: "boolean", description: "Force a fresh check instead of the ≤7-day cached report" },
          watch: { type: "boolean", description: "Also add the company to the nightly covenant watchlist (alerts on deterioration)" },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "generate_why_buy_deck",
      description: "Generate an EDITABLE, branded 'Why Buy' / investment-memo PowerPoint (.pptx) for a property — the team edits it in PowerPoint and exports to PDF for the final. Pulls the property + its units from the CRM and authors the narrative in BGP house style. Use when the user asks for a Why Buy, IM, investment memo or pitch deck for a specific property. For a locked, non-editable PDF instead, use generate_claude_designed_pdf.",
      parameters: {
        type: "object",
        properties: {
          propertyName: { type: "string", description: "Property name or address to build the deck for (e.g. '56-60 Pimlico Road'). The tool searches the CRM for the match." },
          propertyId: { type: "string", description: "Optional crm_properties id if you already have it (skips the name search)." },
          preparedFor: { type: "string", description: "Optional client/recipient name for the cover ('Prepared for ...')." },
          context: { type: "string", description: "Optional extra context, figures or angle to fold into the narrative." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "send_email",
      description: "Send a NEW email from the BGP shared mailbox (chatbgp@brucegillinghampollard.com). Use ONLY for brand new emails, NOT for replying to existing threads. For replies, use reply_email instead to preserve email threading. **When emailing a file you just generated (PDF / Word / Excel / PPTX), pass the chat-media filename(s) in `chatMediaAttachments` so the file is attached as a real binary — never just paste the /api/chat-media/ URL into the body, those links require auth and break for the recipient.**",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (HTML supported). When attaching files, do NOT also put /api/chat-media/ links to the same files in the body — the attachment is the file." },
          cc: { type: "string", description: "CC email address (optional)" },
          chatMediaAttachments: {
            type: "array",
            items: { type: "string" },
            description: "Optional. Array of chat-media filenames (e.g. ['1779162931260-fafba8ed4b186427-The_Broadway__Wimbledon___Why_Buy.pdf']). Each becomes a real binary attachment on the email. Use the filename portion from any /api/chat-media/<filename> URL you previously generated via generate_word, generate_pptx, export_to_excel, generate_claude_designed_pdf, etc.",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "reply_email",
      description: "Reply to an existing email thread in the BGP shared mailbox. Use this INSTEAD of send_email when responding to an email the user received. This preserves the email thread/conversation. You MUST provide the messageId from the email context (the [msgId:...] tag). The reply is sent from chatbgp@brucegillinghampollard.com and goes to the original sender, preserving the full thread. **Same attachment rules as send_email — pass chatMediaAttachments rather than dropping /api/chat-media/ links into the body.**",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Graph API message ID from the email context [msgId:...] tag. This is required to thread the reply correctly." },
          body: { type: "string", description: "The reply body (HTML supported). Write ONLY the new reply content — the original email thread is automatically included by Outlook." },
          cc: { type: "string", description: "Optional CC email address" },
          chatMediaAttachments: {
            type: "array",
            items: { type: "string" },
            description: "Optional. Array of chat-media filenames to attach as real binaries. Same format as send_email.",
          },
        },
        required: ["messageId", "body"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_emails",
      description: "Search Outlook for emails matching a query. By default searches the signed-in user's inbox. Pass `mailbox` to search a specific BGP teammate's inbox, or 'all' to search across every team member's mailbox plus the shared inbox (uses app-level Mail.Read). Returns up to 50 results. Use when the user asks to find specific emails, correspondence, or historic threads beyond the 15 most recent shown in context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — matches against subject, body, sender, recipients, and attachments. Use KQL syntax: e.g. 'from:john subject:proposal', 'hasattachment:true landsec', 'received>=2025-01-01'" },
          top: { type: "number", description: "Number of results to return (default 50, max 500)." },
          mailbox: { type: "string", description: "Optional. A specific BGP mailbox email address (e.g. 'jack@brucegillinghampollard.com') to search, OR the literal string 'all' to fan out across every active BGP user's mailbox plus the shared inbox. Omit to search only the current user's inbox." },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_calendar",
      // KEY: this tool DOES support keyword search — implemented via
      // /calendarView + client-side filter because Graph rejects $search on
      // /events. Don't tell the user the API can't search keywords; it can.
      description: "Keyword-search Outlook calendars for meetings — supports full-text search across subject, body, attendees, and location even though Graph's $search operator doesn't work on /events (we use /calendarView + client-side filter under the hood). By default searches the signed-in user's calendar. Pass `mailbox` to search a specific BGP teammate's calendar, or 'all' to fan out across every team member's calendar plus the shared inbox. Date-bounded — defaults to last 18 months → next 6 months. Returns up to 50 results sorted by start date desc. Use when the user asks about historic or upcoming meetings, viewings, or calendar history about a deal/brand/landlord/property — never say 'the calendar API can't search keywords', it can. Distinct from query_calendar which only lists upcoming events in a date range without keyword search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — matches subject, body, attendees, location. e.g. 'Aurora Capital', '18-22 Haymarket', 'rent review meeting'." },
          top: { type: "number", description: "Number of results to return (default 50, max 500)." },
          mailbox: { type: "string", description: "Optional. A specific BGP mailbox email (e.g. 'jack@brucegillinghampollard.com') to search, OR the literal 'all' to fan out across every active BGP calendar plus the shared inbox. Omit to search only the current user's calendar." },
          startDateTime: { type: "string", description: "Optional ISO date-time lower bound (default: 18 months ago). Events must start on or after this." },
          endDateTime: { type: "string", description: "Optional ISO date-time upper bound (default: 6 months from now). Events must end on or before this." },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_email_attachments",
      description: "List the attachments on a specific email. Returns attachment names, IDs, content types, and sizes. Use this when the user asks about an attachment on an email — you'll need the msgId from the email context or search results. If the email came from search_emails with a mailboxEmail (i.e. another user's mailbox), you MUST pass mailboxEmail too — Graph message IDs are mailbox-scoped and will return ErrorInvalidMailboxItemId otherwise.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Graph API message ID from the email context [msgId:...] tag or from search_emails results." },
          mailboxEmail: { type: "string", description: "The owner of the mailbox the message lives in (e.g. 'ollie@brucegillinghampollard.com'). REQUIRED when the message was returned by search_emails with mailbox=<email> or mailbox=all — the search result's mailboxEmail field has this value. Omit only when the message is in the calling user's own inbox." },
        },
        required: ["messageId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "download_email_attachment",
      description: "Download an email attachment and either (a) read its content, or (b) save it directly to a SharePoint folder. THIS IS THE TOOL TO USE when the user asks to 'save this brochure to SharePoint', 'file this attachment under …', 'put the floor plans in the Due Diligence folder', or anything that moves an email attachment into SharePoint. Set `action: 'save_to_sharepoint'` and pass `folderPath` — the tool downloads the binary from Graph and uploads it in a single step. DO NOT try to use upload_to_sharepoint for email attachments; that tool only works for chat-media files. For 'read' mode: PDF/Word/Excel/CSV/text return extracted text; other binaries return metadata. Use get_email_attachments first to get the attachment ID. If the email is in another user's mailbox (came from search_emails with mailboxEmail), you MUST pass the same mailboxEmail here — Graph IDs are mailbox-scoped.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Graph API message ID of the email containing the attachment." },
          attachmentId: { type: "string", description: "The attachment ID from get_email_attachments results." },
          mailboxEmail: { type: "string", description: "The owner of the mailbox the message lives in. REQUIRED when the message was returned by search_emails with mailbox=<email> or mailbox=all. The search result's mailboxEmail field has this value." },
          action: { type: "string", enum: ["read", "save_to_sharepoint"], description: "What to do with the attachment. 'read' returns the content. 'save_to_sharepoint' saves it to SharePoint (requires folderPath)." },
          folderPath: { type: "string", description: "SharePoint folder path to save the attachment to (required when action is 'save_to_sharepoint'). e.g. 'Deals/Brixton Market'" },
        },
        required: ["messageId", "attachmentId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "request_app_change",
      description: "Submit a request to change the app's structure, layout, or add new features. Use this when the user asks for something that would require code changes — new fields, new pages, layout changes, new integrations, or feature requests. These go through a two-step approval: developer review, then admin sign-off.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Detailed description of what the user wants changed or added" },
          category: { type: "string", enum: ["feature", "layout", "field", "integration", "bug_fix", "other"], description: "Category of the change" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"], description: "How urgent is this request" },
        },
        required: ["description"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_investment_tracker",
      description: "Create a new investment tracker item. Use when the user wants to add a new property to the investment pipeline.",
      parameters: {
        type: "object",
        properties: {
          assetName: { type: "string", description: "Property/asset name" },
          address: { type: "string", description: "Full address" },
          status: { type: "string", description: "e.g. Reporting, Under Offer, Exchanged, Completed, Withdrawn, On Hold" },
          boardType: { type: "string", enum: ["Purchases", "Sales"], description: "Which board" },
          client: { type: "string", description: "Client name" },
          clientContact: { type: "string" },
          vendor: { type: "string" },
          vendorAgent: { type: "string" },
          guidePrice: { type: "number" },
          niy: { type: "number", description: "Net initial yield %" },
          eqy: { type: "number", description: "Equivalent yield %" },
          sqft: { type: "number" },
          currentRent: { type: "number", description: "Passing rent per annum (£)" },
          ervPa: { type: "number", description: "Estimated rental value per annum (£)" },
          waultBreak: { type: "number", description: "WAULT to break (years)" },
          waultExpiry: { type: "number", description: "WAULT to expiry (years)" },
          occupancy: { type: "number", description: "Occupancy as a fraction (0.95 = 95%)" },
          capexRequired: { type: "number", description: "Capex required (£)" },
          tenure: { type: "string" },
          fee: { type: "number" },
          feeType: { type: "string" },
          notes: { type: "string" },
        },
        required: ["assetName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_available_unit",
      description: "Create a new available unit (leasing). Use when the user wants to add a unit to market for letting.",
      parameters: {
        type: "object",
        properties: {
          propertyId: { type: "string", description: "Property ID this unit belongs to. Search properties first to get the ID." },
          unitName: { type: "string", description: "Unit name/description e.g. 'Ground Floor', 'Unit 3', '1st-2nd Floor'" },
          floor: { type: "string" },
          sqft: { type: "number", description: "Area in sq ft" },
          askingRent: { type: "number", description: "Asking rent £ per sq ft per annum" },
          ratesPa: { type: "number", description: "Business rates per annum" },
          serviceChargePa: { type: "number", description: "Service charge per annum" },
          useClass: { type: "string", description: "Use class e.g. E, A1, B1, Sui Generis" },
          condition: { type: "string", description: "e.g. Shell & Core, Cat A, Fitted" },
          location: { type: "string", description: "Region/location: Clapham, East Anglia, Ireland, London, Midlands, N. Ireland, National, North East, North West, Scotland, South East, South West, Wales" },
          availableDate: { type: "string", description: "When available" },
          marketingStatus: { type: "string", description: "e.g. Available, Under Offer, Let, Withdrawn" },
          epcRating: { type: "string" },
          notes: { type: "string" },
          fee: { type: "number", description: "Fee percentage" },
        },
        required: ["propertyId", "unitName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "find_duplicate_properties",
      description: "Find duplicate property records (same normalised name) with counts of linked deals, tenancy units and files on each, so the right keeper can be chosen before merging. Use before merge_properties.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional name filter, e.g. 'Bluewater'. Omit to scan the whole CRM." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "merge_properties",
      description: "Merge a duplicate property into the canonical one. Re-points every linked record (deals, units, schedules, files, briefs, threads, etc.) to the keeper, fills any blank fields on the keeper from the duplicate, then deletes the duplicate. IRREVERSIBLE — always run find_duplicate_properties first, tell the user which record will be kept and which removed (with their linked-record counts), and get their explicit confirmation before calling this.",
      parameters: {
        type: "object",
        properties: {
          keepPropertyId: { type: "string", description: "Property ID to KEEP (usually the one with more linked data)" },
          mergePropertyId: { type: "string", description: "Duplicate property ID to merge in and delete" },
        },
        required: ["keepPropertyId", "mergePropertyId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "run_brand_enrichment_backfill",
      description: "Run the logo.dev Brand API backfill over the brand book: fills BLANK description, Instagram/TikTok/X handles and LinkedIn on brand records that have a website domain (never overwrites existing data; skips brands with nothing missing). Costs ~1p per brand that needs filling, so confirm the run size with the user first. hospitalityOnly=true limits it to the client-visible hospitality/F&B slice (e.g. 'all Landsec brands').",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max brands to process this run (default 100, cap 500)." },
          hospitalityOnly: { type: "boolean", description: "true = only the hospitality/F&B client slice (Landsec's brands)." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "reconcile_tenancy_rows",
      description: "Fix split tenancy-schedule rows — where one import put the passing rent on one row and another import put the lease dates on a parallel row for the same unit, so almost no row has both (breaking rent coverage, WAULT weighting and expiry-vs-income analysis). Dry run (default) returns the full merge plan: which rows merge, which groups are ambiguous, and what rent+expiry coverage becomes. Only call with apply=true AFTER showing the user the dry-run numbers and getting their explicit confirmation — applying merges rows and deletes the duplicates (references are re-pointed first). Conflicting rows (different tenant/rent/expiry) are never auto-merged; they come back in the 'ambiguous' list for human review.",
      parameters: {
        type: "object",
        properties: {
          propertyId: { type: "string", description: "Optional: limit to one property. Omit to reconcile the whole tenancy schedule." },
          apply: { type: "boolean", description: "false/omitted = dry run (report only). true = execute the merge plan — requires the user's explicit confirmation of the dry-run numbers first." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_targeting_brief",
      description: "Create an operator targeting brief for a letting tracker unit and generate the branded brief document (PDF). Use when a client (e.g. Landsec) or agent describes a leasing instruction for a specific unit: the letting objective, what kind of operator they want, priority categories, named target operators, deliverable deadlines and success measures. Ask for the property and unit first (search available units to find the unit ID), then gather the brief content conversationally before calling this tool. The generated document is saved against the unit in the Letting Tracker and filed to the scheme's SharePoint folder.",
      parameters: {
        type: "object",
        properties: {
          unitId: { type: "string", description: "Available unit ID the brief is for. Search available units first to get the ID." },
          title: { type: "string", description: "Brief title, e.g. 'Operator Targeting Brief – 145A Queen Street, Westgate (L29A)'" },
          clientCompany: { type: "string", description: "Instructing client / landlord, e.g. 'Landsec'. Defaults to the current user's client company if they are a client user." },
          objective: { type: "string", description: "The letting objective" },
          locationContext: { type: "string", description: "Location, adjacencies, categories already represented nearby" },
          targetCriteria: { type: "string", description: "What the preferred operator should demonstrate" },
          priorityCategories: { type: "string", description: "Priority categories, keeping category names and example operators together" },
          agentInstruction: { type: "string", description: "Instruction to the agent (emphasis, constraints)" },
          successMeasures: { type: "string", description: "How success will be measured" },
          instructedDate: { type: "string", description: "YYYY-MM-DD instruction date (default today)" },
          deadline1Date: { type: "string", description: "YYYY-MM-DD first deliverable deadline (e.g. +14 days)" },
          deadline1Deliverables: { type: "string", description: "What is due at the first deadline" },
          deadline2Date: { type: "string", description: "YYYY-MM-DD second deliverable deadline (e.g. +30 days)" },
          deadline2Deliverables: { type: "string", description: "What is due at the second deadline" },
          minTargets: { type: "number", description: "Minimum number of target operators required (default 5)" },
          priorityTargets: { type: "number", description: "Number of priority targets required (default 2)" },
          targets: {
            type: "array",
            description: "Named target operators from the instruction",
            items: {
              type: "object",
              properties: {
                operatorName: { type: "string" },
                category: { type: "string" },
                priority: { type: "string", description: "A or B" },
                rationale: { type: "string" },
              },
              required: ["operatorName"],
            },
          },
        },
        required: ["unitId", "objective"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_available_unit",
      description: "Update an existing available unit. Search for the unit first to find its ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The unit ID (UUID)" },
          unitName: { type: "string" },
          floor: { type: "string" },
          sqft: { type: "number" },
          askingRent: { type: "number" },
          ratesPa: { type: "number" },
          serviceChargePa: { type: "number" },
          useClass: { type: "string" },
          condition: { type: "string" },
          availableDate: { type: "string" },
          marketingStatus: { type: "string" },
          epcRating: { type: "string" },
          notes: { type: "string" },
          fee: { type: "number" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "log_viewing",
      description: "Log a viewing for an investment tracker item or a leasing unit. Search for the item first to get the ID.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["investment", "unit"], description: "Whether this is for an investment tracker item or a leasing unit" },
          entityId: { type: "string", description: "The investment tracker ID or unit ID" },
          company: { type: "string", description: "Company/party viewing" },
          contact: { type: "string", description: "Contact name" },
          viewingDate: { type: "string", description: "Date of viewing (YYYY-MM-DD)" },
          viewingTime: { type: "string", description: "Time of viewing (HH:MM)" },
          attendees: { type: "string", description: "Who attended" },
          notes: { type: "string" },
          outcome: { type: "string", description: "e.g. Interested, Not Interested, Follow-up, Offer Made" },
        },
        required: ["entityType", "entityId", "viewingDate"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "log_offer",
      description: "Log an offer for an investment tracker item or a leasing unit. Search first to find the record ID.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["investment", "unit"], description: "Whether this is for an investment tracker item or a leasing unit" },
          entityId: { type: "string", description: "The investment tracker ID or unit ID" },
          company: { type: "string", description: "Company making the offer" },
          contact: { type: "string", description: "Contact name" },
          offerDate: { type: "string", description: "Date of offer (YYYY-MM-DD)" },
          offerPrice: { type: "number", description: "Offer price (for investment)" },
          niy: { type: "number", description: "Net initial yield % (for investment)" },
          rentPa: { type: "number", description: "Annual rent offered (for leasing)" },
          rentFreeMonths: { type: "number", description: "Rent-free period in months (for leasing)" },
          termYears: { type: "number", description: "Lease term in years (for leasing)" },
          breakOption: { type: "string", description: "Break clause details (for leasing)" },
          incentives: { type: "string", description: "Other incentives" },
          premium: { type: "number", description: "Premium/key money" },
          fittingOutContribution: { type: "number", description: "Fitting out contribution" },
          conditions: { type: "string", description: "Conditions attached to offer" },
          status: { type: "string", description: "e.g. Pending, Accepted, Rejected, Withdrawn" },
          notes: { type: "string" },
        },
        required: ["entityType", "entityId", "offerDate"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_property",
      description: "Create a new property in the CRM. Use when the user mentions a new property, building, or address that needs to be tracked. Always search first to avoid duplicates. If you provide a postcode in the address, the system will AUTOMATICALLY run Land Registry lookup, AI-match the freehold title, identify the owner, create/link the landlord company, and prepare KYC. You do NOT need to do this manually — just provide the address with postcode and it all happens.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Property name (e.g. '10 Grosvenor Street', 'One Hyde Park')" },
          address: { type: "object", description: "Address as JSON object with fields: street, city, postcode, country", properties: { street: { type: "string" }, city: { type: "string" }, postcode: { type: "string" }, country: { type: "string" } } },
          postcode: { type: "string", description: "Postcode (also drives auto-enrich and geocoding if not in address)" },
          latitude: { type: "string", description: "Latitude (decimal degrees). Set when known to skip geocoding." },
          longitude: { type: "string", description: "Longitude (decimal degrees)." },
          agent: { type: "string", description: "BGP agent responsible (e.g. 'Rupert', 'Lucy')" },
          assetClass: { type: "string", description: "e.g. Retail, Office, Residential, Mixed-Use, Leisure, Industrial" },
          tenure: { type: "string", description: "e.g. Freehold, Leasehold, Virtual Freehold" },
          sqft: { type: "number", description: "Size in square feet" },
          status: { type: "string", description: "e.g. Active, Pipeline, Completed" },
          notes: { type: "string" },
          website: { type: "string", description: "Property or scheme website URL" },
          tags: { type: "string", description: "Free-text tags" },
          groupName: { type: "string", description: "CRM group/board this property sits under" },
          titleNumber: { type: "string", description: "Land Registry title number (if already known)" },
          competitorAgent: { type: "string", description: "Competitor agent instructed on non-BGP stock e.g. 'CBRE'" },
          folderTeams: { type: "array", items: { type: "string" }, description: "Teams this property belongs to e.g. ['London Retail', 'Investment']" },
          autoEnrich: { type: "boolean", description: "If true (default), automatically runs Land Registry lookup, AI title matching, proprietor identification, and landlord linking after creation. Set false to skip." },
        },
        required: ["name"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_requirement",
      description: "Log a new tenant or buyer requirement. Use when someone says a company is looking for space, a tenant needs premises, or an investor is seeking a property. Categories: 'Leasing' for tenants, 'Investment' for buyers.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["Leasing", "Investment"], description: "Leasing for tenants, Investment for buyers" },
          companyName: { type: "string", description: "Company/tenant/buyer name" },
          contactName: { type: "string", description: "Main contact person" },
          sizeMin: { type: "string", description: "Minimum size requirement (e.g. '2,000 sq ft')" },
          sizeMax: { type: "string", description: "Maximum size requirement (e.g. '5,000 sq ft')" },
          budget: { type: "string", description: "Budget or rent expectation (e.g. '£50 psf', '£5m-£10m')" },
          location: { type: "string", description: "Preferred area/location (e.g. 'Mayfair', 'SW1', 'West End')" },
          notes: { type: "string", description: "Additional details about the requirement" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level" },
        },
        required: ["category", "companyName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_diary_entry",
      description: "Create a diary entry — log a meeting, call, viewing, or any scheduled event. Use when the user says they have a meeting, need to log an event, or schedule something.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What the entry is about (e.g. 'Meeting with CBRE re: 10 Grosvenor Street')" },
          person: { type: "string", description: "Who it's with" },
          project: { type: "string", description: "Related project/deal name" },
          day: { type: "string", description: "Day in format YYYY-MM-DD" },
          time: { type: "string", description: "Time in format HH:MM" },
          type: { type: "string", enum: ["meeting", "call", "viewing", "note", "task"], description: "Type of entry" },
        },
        required: ["title", "person", "day", "time"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_task",
      description: "Create a task on someone's task list. Use whenever someone asks you to remind them, set a to-do, or give a colleague/agent something to do (e.g. 'task for Rob: send the Bluewater brief by Friday'). If no assignee is named, the task goes to the person you're talking to.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The task, short and actionable" },
          assigneeName: { type: "string", description: "Who the task is FOR (a person's name) — omit to assign to the requester" },
          description: { type: "string", description: "Optional extra detail" },
          dueDate: { type: "string", description: "Optional due date YYYY-MM-DD" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
        },
        required: ["title"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_property",
      description: "Update an existing property in the CRM. Search first to find the property ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The property ID (UUID)" },
          name: { type: "string", description: "Property name" },
          address: { type: "object", description: "Address as JSON object with fields: street, city, postcode", properties: { street: { type: "string" }, city: { type: "string" }, postcode: { type: "string" } } },
          postcode: { type: "string", description: "Postcode" },
          latitude: { type: "string", description: "Latitude (decimal degrees)" },
          longitude: { type: "string", description: "Longitude (decimal degrees)" },
          agent: { type: "string", description: "BGP agent responsible" },
          assetClass: { type: "string", description: "e.g. Retail, Office, Residential, Mixed-Use" },
          tenure: { type: "string", description: "e.g. Freehold, Leasehold" },
          sqft: { type: "number", description: "Size in square feet" },
          status: { type: "string", description: "e.g. Active, Pipeline, Completed" },
          notes: { type: "string" },
          website: { type: "string", description: "Property or scheme website URL" },
          tags: { type: "string", description: "Free-text tags" },
          groupName: { type: "string", description: "CRM group/board this property sits under" },
          titleNumber: { type: "string", description: "Land Registry title number" },
          competitorAgent: { type: "string", description: "Competitor agent instructed on this stock e.g. 'CBRE'" },
          folderTeams: { type: "array", items: { type: "string" }, description: "Teams this property belongs to" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_requirement",
      description: "Update an existing tenant or buyer requirement. Search first to find the requirement ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The requirement ID (UUID)" },
          category: { type: "string", enum: ["Leasing", "Investment"] },
          companyName: { type: "string" },
          contactName: { type: "string" },
          sizeMin: { type: "string" },
          sizeMax: { type: "string" },
          budget: { type: "string" },
          location: { type: "string" },
          status: { type: "string", enum: ["active", "fulfilled", "withdrawn", "on_hold"] },
          notes: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_comp",
      description: "Record a leasing transaction as a comp (comparable). Use for rent reviews, open market lettings, lease renewals, assignments. The core reference for lease consultancy evidence. Populate as many fields as possible — especially Zone A rate, transaction type, use class, area, and passing rent for rent reviews.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Comp name — usually the property/address" },
          tenant: { type: "string", description: "Tenant name" },
          landlord: { type: "string", description: "Landlord name" },
          dealType: { type: "string", description: "Legacy field — use transactionType instead" },
          transactionType: { type: "string", enum: ["Open Market Letting", "Rent Review", "Lease Renewal", "Assignment", "Sub-letting", "Surrender & Re-grant", "Pre-let"], description: "Type of transaction" },
          useClass: { type: "string", enum: ["E", "E(a) Retail", "E(b) F&B", "E(c) Office", "A1 (Legacy)", "A3 (Legacy)"], description: "Use class" },
          areaSqft: { type: "string", description: "Total area in sq ft (legacy — prefer niaSqft)" },
          niaSqft: { type: "string", description: "Net Internal Area (sq ft) per RICS" },
          giaSqft: { type: "string", description: "Gross Internal Area (sq ft) per RICS" },
          itzaSqft: { type: "string", description: "In Terms of Zone A area (sq ft) for retail" },
          headlineRent: { type: "string", description: "Headline rent e.g. '£150,000 pa'" },
          overallRate: { type: "string", description: "Overall rate e.g. '£75 psf'" },
          zoneARate: { type: "string", description: "Zone A rate per sq ft — key metric for retail rent reviews" },
          netEffectiveRent: { type: "string", description: "Net effective rent after incentives" },
          passingRent: { type: "string", description: "Previous/passing rent — essential for rent review comps" },
          term: { type: "string", description: "Lease term e.g. '10 years'" },
          rentFree: { type: "string", description: "Rent-free period e.g. '6 months'" },
          capex: { type: "string", description: "Capital expenditure" },
          fitoutContribution: { type: "string", description: "Landlord fitout/capital contribution" },
          breakClause: { type: "string", description: "Break option details" },
          ltActStatus: { type: "string", enum: ["Inside L&T Act", "Outside L&T Act", "Contracted Out"], description: "Landlord & Tenant Act status" },
          completionDate: { type: "string", description: "Date of transaction" },
          areaLocation: { type: "string", description: "London area e.g. Mayfair, City, Covent Garden" },
          postcode: { type: "string", description: "Postcode" },
          sourceEvidence: { type: "string", enum: ["Email", "WhatsApp", "File", "Brochure", "News", "SharePoint", "Dropbox", "Manual", "ChatBGP", "BGP Direct"], description: "Where the comp came from. Default: ChatBGP if created by the AI; match the actual origin (email, brochure, WhatsApp, etc.) when extracting from content." },
          measurementStandard: { type: "string", enum: ["NIA", "GIA", "IPMS 3 Office", "IPMS 3 Retail", "ITZA", "GEA"], description: "RICS measurement basis used" },
          rentPsfNia: { type: "string", description: "Rent per sq ft on NIA basis" },
          rentPsfGia: { type: "string", description: "Rent per sq ft on GIA basis" },
          comments: { type: "string" },
          rentAnalysis: { type: "string", description: "Detailed rent analysis notes" },
          propertyId: { type: "string", description: "Link to CRM property ID if known" },
          dealId: { type: "string", description: "Link to CRM deal ID if known" },
        },
        required: ["name"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_investment_comp",
      description: "Record a completed investment transaction as a comp. Use when an investment deal completes — purchase, sale, or disposal. Logs the key deal metrics for future analysis.",
      parameters: {
        type: "object",
        properties: {
          propertyName: { type: "string", description: "Property name" },
          address: { type: "string", description: "Full address" },
          transactionType: { type: "string", description: "e.g. Acquisition, Disposal, Forward Purchase" },
          price: { type: "number", description: "Transaction price in £" },
          pricePsf: { type: "number", description: "Price per square foot" },
          capRate: { type: "number", description: "Cap rate / yield (as decimal, e.g. 0.045 for 4.5%)" },
          areaSqft: { type: "number", description: "Total area in sq ft" },
          buyer: { type: "string", description: "Buyer name" },
          seller: { type: "string", description: "Seller name" },
          buyerBroker: { type: "string", description: "Buyer's agent" },
          sellerBroker: { type: "string", description: "Seller's agent" },
          transactionDate: { type: "string", description: "Date of transaction (YYYY-MM-DD)" },
          comments: { type: "string" },
          propertyId: { type: "string", description: "Link to CRM property ID if known" },
        },
        required: ["propertyName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "link_entities",
      description: "Create a relationship between CRM records — link a contact or company to a deal, property, or requirement. Use when the user says a contact is involved in a deal, a company owns a property, etc.",
      parameters: {
        type: "object",
        properties: {
          linkType: { type: "string", enum: ["contact-deal", "contact-property", "contact-requirement", "company-property", "company-deal"], description: "Type of relationship to create" },
          sourceId: { type: "string", description: "ID of the contact or company" },
          targetId: { type: "string", description: "ID of the deal, property, or requirement to link to" },
        },
        required: ["linkType", "sourceId", "targetId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "list_project_files",
      description: "Browse the project file structure. Use when you need to understand the codebase layout before making changes, or when the user asks about how the app is structured.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Directory to list, relative to project root. e.g. 'client/src/pages', 'server', 'shared'. Default: root" },
          recursive: { type: "boolean", description: "If true, list files recursively. Default false." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "read_source_file",
      description: "Read the contents of a project source file. Use to understand existing code before making edits, or when the user asks what's in a file. Can read any file: TypeScript, CSS, HTML, config files, etc.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "File path relative to project root, e.g. 'server/routes.ts', 'client/src/pages/Dashboard.tsx', 'shared/schema.ts'" },
          startLine: { type: "number", description: "Optional: start reading from this line number" },
          endLine: { type: "number", description: "Optional: stop reading at this line number" },
        },
        required: ["filePath"],
      },
    },
  });

  // Codebase write + shell + restart tools — always registered. The
  // dispatcher gates each call on admin. Audit log lives in code_changes.
  tools.push({
    type: "function",
    function: {
      name: "edit_source_file",
      description: "Edit or create a project source file. Admin-only. By default, edits commit to a `chatbgp/<YYYY-MM-DD>` git branch via plumbing (no live working-tree change) — the admin then merges the branch into the deploy branch and restarts to apply. The response includes the branch name + commit hash + a `nextStep` instruction you should pass to the user. Set `direct: true` ONLY when the user explicitly says 'go direct' or 'skip branch' — that writes live to the working tree (pre-restart). All edits logged in code_changes. Read the file first to get exact content for replace operations.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "File path relative to project root, e.g. 'server/routes.ts'" },
          action: { type: "string", enum: ["replace", "insert", "create", "append"], description: "replace: find and replace text. insert: insert text at a line number. create: create a new file. append: add text to end of file." },
          searchText: { type: "string", description: "For 'replace' action: the exact text to find and replace. Must match the file content exactly." },
          replaceText: { type: "string", description: "For 'replace' action: the new text to replace searchText with. For 'create'/'append': the full content to write." },
          insertAtLine: { type: "number", description: "For 'insert' action: line number to insert before" },
          insertText: { type: "string", description: "For 'insert' action: text to insert" },
          content: { type: "string", description: "For 'create' action: full file content" },
          description: { type: "string", description: "Brief description of what this change does, for the audit log + commit message" },
          direct: { type: "boolean", description: "Default false. When true, skips branch-mode and writes directly to the live working tree. Use only when the user explicitly opts in." },
        },
        required: ["filePath", "action", "description"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "run_shell_command",
      description: "Execute a shell command on the server. Admin-only. Use for database migrations (ALTER TABLE), installing packages (npm install), checking logs, or running scripts. Dangerous commands (rm -rf, git push --force, DROP DATABASE) are blocked. Output is captured and logged.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run. e.g. 'npm install lodash', 'psql $DATABASE_URL -c \"ALTER TABLE crm_contacts ADD COLUMN linkedin TEXT\"'" },
          description: { type: "string", description: "Brief description of what this command does, for the audit log" },
        },
        required: ["command", "description"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "add_database_column",
      description: "Add a new column to an existing database table. Admin-only. A safe, targeted tool for extending the CRM schema. The column will automatically appear in search results and API responses. Use when the user says 'add a field for X' or 'I need to track Y on deals/contacts/properties'.",
      parameters: {
        type: "object",
        properties: {
          tableName: { type: "string", enum: ["crm_deals", "crm_contacts", "crm_companies", "crm_properties", "investment_tracker", "available_units", "requirements", "crm_comps", "investment_comps", "crm_leads", "diary_entries"], description: "Database table to add the column to" },
          columnName: { type: "string", description: "Column name in snake_case, e.g. 'linkedin_url', 'floor_area', 'aml_status'" },
          columnType: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BOOLEAN", "TIMESTAMP", "JSONB"], description: "Data type for the column" },
          defaultValue: { type: "string", description: "Optional default value. Use 'NULL' for nullable, or a specific value like 'true', '0', 'active'" },
          description: { type: "string", description: "What this field is for — will be logged in the audit trail" },
        },
        required: ["tableName", "columnName", "columnType", "description"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "list_chatbgp_branches",
      description: "List the chatbgp/* git branches currently holding pending ChatBGP edits. Each row shows the branch name, tip commit hash, tip commit subject, and how many commits the branch is ahead of the deploy branch HEAD. Use to find a branch to merge.",
      parameters: { type: "object", properties: {} },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "merge_chatbgp_branch",
      description: "Admin-only. Merge a chatbgp/<date> branch into the current (deploy) branch and optionally restart. Use only after the admin has reviewed the commit(s) and explicitly says 'merge it'. Performs a fast-forward merge if possible; refuses if there's a conflict — admin would then need to resolve manually via terminal.",
      parameters: {
        type: "object",
        properties: {
          branch: { type: "string", description: "Branch name to merge, e.g. 'chatbgp/2026-05-09'." },
          restart: { type: "boolean", description: "Default false. When true, calls restart_application after a successful merge." },
        },
        required: ["branch"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "grep_codebase",
      description: "Search the project for a regex pattern. Returns file:line + a snippet for each match. Excludes node_modules, .git, dist, build artefacts. Use this BEFORE read_source_file when you need to find where something is defined or referenced — much faster than guessing paths. Use \"\\b\" word boundaries for symbols. Case-insensitive by default.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for. Examples: 'export function buildSystemPrompt', 'eq\\(crmCompanies\\.id', '/api/property-imagery'." },
          glob: { type: "string", description: "Optional path glob to scope the search, e.g. 'server/**/*.ts', 'client/src/pages/**', 'shared/schema.ts'. Defaults to whole repo." },
          caseSensitive: { type: "boolean", description: "Default false (case-insensitive). Set true for exact matches." },
          maxResults: { type: "number", description: "Max matches to return. Default 50, max 200." },
        },
        required: ["pattern"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "git_status",
      description: "Show current branch, working-tree state (clean/dirty + per-file flags), upstream ahead/behind counts, and the last 10 commits. Use to understand what state the repo is in before / after edits.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "git_diff",
      description: "Show a unified diff. Three modes: (1) no args → diff of working tree against HEAD (uncommitted changes). (2) branch only → diff of that branch against the current deploy branch (use to review a chatbgp/<date> branch before merging). (3) branch + file → diff for one file only. Truncated to 8KB if huge.",
      parameters: {
        type: "object",
        properties: {
          branch: { type: "string", description: "Optional branch to diff against current HEAD (e.g. 'chatbgp/2026-05-09'). Omit to see uncommitted working-tree changes." },
          file: { type: "string", description: "Optional file path to scope the diff. Useful for reviewing a single file's changes on a multi-file branch." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "revert_chatbgp_commit",
      description: "Drop the most recent commit from a chatbgp/<date> branch. Admin-only. Useful when you spot a typo or wrong edit you just made and want to back the branch up before merging. If the branch only has one commit, deletes the branch entirely. Cannot undo merges or touch any branch other than chatbgp/*. The dropped commit's hash is returned in case you need to recover it manually with `git reflog`.",
      parameters: {
        type: "object",
        properties: {
          branch: { type: "string", description: "chatbgp/* branch name to back up by one commit." },
        },
        required: ["branch"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "restart_application",
      description: "Restart the BGP application after making code changes. Admin-only. Use after editing source files to apply the changes. The app typically restarts automatically, but use this if it doesn't or if the user reports issues.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why the restart is needed" },
        },
        required: ["reason"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image using AI (Nano Banana). Use for property marketing visuals, document illustrations, presentation graphics, floor plan sketches, area photos, or any visual content the user needs. Returns a base64 image that can be displayed in chat. Use when the user asks for an image, a visual, a graphic, or when creating marketing materials that would benefit from imagery.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed description of the image to generate. Be specific about style, content, lighting, perspective. For property images, include details about the building type, area, and aesthetic." },
          style: { type: "string", description: "Optional style hint: 'photo' for photorealistic, 'illustration' for drawn/graphic style, 'architectural' for technical/blueprint style", enum: ["photo", "illustration", "architectural"] },
        },
        required: ["prompt"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "edit_image",
      description: "Iteratively edit an existing image with AI image-to-image. Source can be either (a) an image already in the Image Studio (pass imageStudioId) or (b) a photo the user has just pasted/dropped into chat (pass imageUrl '/api/chat-media/...') — in which case the photo is auto-imported into the Image Studio first so iterative edits stack. Two providers: Gemini (default — most pixel-faithful, great at lighting / mood / small adds) and OpenAI gpt-image-1 (stronger at compositional, instruction-led adds like 'place market stalls in pairs down the centre of the street'). Preserves the source building / composition / architectural detail and only applies the requested edit. Use for placemaking CGI iteration — adding stalls, planting, festoon lighting, outdoor seating, evening mood, dressing facades, removing clutter, etc. The image row is updated in place and a single undo snapshot is kept, so successive edits build on each other.",
      parameters: {
        type: "object",
        properties: {
          imageStudioId: { type: "string", description: "image_studio_images.id of an existing studio image. Either this OR imageUrl is required." },
          imageUrl: { type: "string", description: "Alternative to imageStudioId — a /api/chat-media/... URL of a photo the user has just uploaded/pasted into chat. The photo is imported into the Image Studio first (so subsequent edit_image calls can refer to it by imageStudioId) and then edited in the same call. The response's imageStudioId is the persistent id to use for further edits." },
          editPrompt: { type: "string", description: "Plain-English description of the edit to apply, max 1000 chars. Be specific about what should change AND what should be preserved (e.g. 'add festoon lighting strung across the lane and a few outdoor cafe tables — keep the same buildings, perspective and daylight'). Avoid vague terms like 'better' or 'nicer'." },
          preferProvider: { type: "string", enum: ["gemini", "openai"], description: "Override which AI editor to try first. Leave unset to use the smart default — OpenAI (gpt-image-1) for compositional / instruction-led edits (adding stalls, signage, people, planting, multiple new elements) and Gemini for atmospheric tweaks (lighting, mood, dusk, weather, colour grade). The other provider is the automatic fallback. Only pass this if you want to override the heuristic." },
          propertyId: { type: "string", description: "Optional crm_properties.id to link the imported photo to a property. Only used when auto-importing via imageUrl — once a studio row exists, repeat edits stay linked to whatever it was originally tagged with. Pass when the user is editing a photo of a specific BGP-tracked property so the result is filed against it in the CRM." },
          companyId: { type: "string", description: "Optional crm_companies.id to link the imported photo to a landlord or brand. Only used when auto-importing via imageUrl." },
        },
        required: ["editPrompt"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "browse_image_studio",
      description: "Search and browse the BGP Image Studio library. Returns images with their file names, categories, tags, descriptions, areas, addresses, brand names, and property types. Use when the user asks about images in the studio, wants to find a specific photo, or asks what images are available.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Optional search term to filter images by name, tags, description, address, or brand name" },
          category: { type: "string", description: "Optional category filter: Exteriors, Interiors, Floor Plans, Properties, Areas, Marketing, Brands, Generated, Other" },
          limit: { type: "number", description: "Max results to return (default 20, max 50)" },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "save_to_image_studio",
      description: "Save an image to the BGP Image Studio library. Can save: (1) an AI-generated image from a previous generate_image call by providing the imageUrl, (2) a base64-encoded image directly, (3) a SharePoint image by providing sharepointDriveId + sharepointItemId, or (4) any public image URL via fetchUrl (e.g. company logos from Clearbit: 'https://logo.clearbit.com/pret.com'). Use when the user wants to save a generated image, upload an image, import SharePoint headshots/photos, or bulk-import company logos.",
      parameters: {
        type: "object",
        properties: {
          imageUrl: { type: "string", description: "URL of a previously generated image (from generate_image action), e.g. '/api/chat-media/xxx.png'" },
          base64Data: { type: "string", description: "Base64-encoded image data (alternative to imageUrl)" },
          mimeType: { type: "string", description: "MIME type if using base64Data, e.g. 'image/png', 'image/jpeg'" },
          fetchUrl: { type: "string", description: "A public HTTPS image URL to fetch and save, e.g. 'https://logo.clearbit.com/savills.com' for company logos. Must be https://. Do not use for SharePoint — use sharepointDriveId+itemId for that." },
          sharepointDriveId: { type: "string", description: "SharePoint driveId of the image file (from a browse_sharepoint_folder result). Use together with sharepointItemId to import a SharePoint image directly." },
          sharepointItemId: { type: "string", description: "SharePoint itemId of the image file (from a browse_sharepoint_folder result). Use together with sharepointDriveId." },
          fileName: { type: "string", description: "Name for the image file, e.g. 'Oxford Street Retail View'" },
          category: { type: "string", description: "Category: Exteriors, Interiors, Floor Plans, Properties, Areas, Marketing, Brands, Generated, Other", enum: ["Exteriors", "Interiors", "Floor Plans", "Properties", "Areas", "Marketing", "Brands", "Generated", "Other"] },
          description: { type: "string", description: "Optional description of the image" },
          area: { type: "string", description: "Optional area/location, e.g. 'West End', 'City of London'" },
          address: { type: "string", description: "Optional full address, e.g. '100 Oxford Street, London W1D 1LL'" },
          brandName: { type: "string", description: "Optional brand name (for Brands category), e.g. 'Pret A Manger'" },
          propertyType: { type: "string", description: "Optional property type", enum: ["Office", "Retail", "Industrial", "Warehouse", "Mixed Use", "Residential", "Restaurant", "Leisure", "Development", "Other"] },
          propertyId: { type: "string", description: "Optional crm_properties.id to link this image to a property in the CRM. Pass when the image is of a specific BGP-tracked property — surfaces the image on the property detail page and lets future browse_image_studio calls find it by property. Look it up first via the page context, a recent CRM search, or browse_crm." },
          companyId: { type: "string", description: "Optional crm_companies.id to link this image to a landlord or tenant brand. Use for brand pack imagery (Brands category) or landlord portfolio photos. Look it up first via the page context or a recent CRM search." },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for the image" },
        },
        required: ["fileName", "category"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "capture_pdf_pages",
      description: "Render a PDF brochure into images and save each page to the Image Studio. Use when the user says 'take images of this brochure', 'capture the pages', 'save brochure images', or similar. Requires the SharePoint driveId and itemId from a browse_sharepoint_folder result. Works silently in the background — no viewer needed.",
      parameters: {
        type: "object",
        properties: {
          driveId: { type: "string", description: "SharePoint driveId of the PDF file" },
          itemId: { type: "string", description: "SharePoint itemId of the PDF file" },
          fileName: { type: "string", description: "Display name for the saved images, e.g. '18-22 Haymarket Brochure'" },
          propertyName: { type: "string", description: "Property name for tagging, e.g. '18-22 Haymarket'" },
          category: { type: "string", description: "Image Studio category. Default: Marketing", enum: ["Exteriors", "Interiors", "Floor Plans", "Properties", "Areas", "Marketing", "Brands", "Generated", "Other"] },
          maxPages: { type: "number", description: "Maximum pages to capture (default: all). Use 1 for cover-only." },
        },
        required: ["driveId", "itemId", "fileName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "vision_describe_image",
      description: "Look at an image and return structured intelligence about it via Claude vision. Use to: classify untagged Image Studio rows, OCR floor plans / brochure pages / business rates letters, identify a brand from a shopfront photo, write a caption for a hero shot, or extract structured data from a document scan. Pass either an Image Studio image id (preferred — loads from the local file or fetches from SharePoint), a public https image URL, or base64 data. Optionally apply the result back to the row with applyToImageStudio:true (writes description / category / tags). Cheap (Sonnet) and fast.",
      parameters: {
        type: "object",
        properties: {
          imageStudioId: { type: "string", description: "Preferred — image_studio_images.id. Loads from disk or SharePoint." },
          imageUrl: { type: "string", description: "Public https image URL (alternative to imageStudioId)." },
          base64Data: { type: "string", description: "Base64-encoded image bytes (alternative)." },
          mimeType: { type: "string", description: "Required if base64Data is used. e.g. 'image/jpeg', 'image/png'." },
          task: { type: "string", enum: ["describe", "classify", "ocr", "tag", "structured"], description: "describe = free-text caption. classify = pick a category from the Image Studio list. ocr = extract all readable text. tag = generate 3-8 short tags. structured = describe + classify + ocr + tag in one pass (recommended for backfill jobs)." },
          customPrompt: { type: "string", description: "Optional extra instructions appended to the task prompt — e.g. 'this is a UK retail unit, focus on the brand name and shopfront condition'." },
          applyToImageStudio: { type: "boolean", description: "Default false. When true and imageStudioId is set, writes the result back to the row (description for describe/structured, category for classify/structured, tags for tag/structured, description ← OCR text for ocr)." },
        },
        required: ["task"],
      },
    },
  });

  // ─── General-purpose database tools ─────────────────────────────────────
  // Three primitives that let ChatBGP touch most of the app's tables. The
  // server enforces a deny-list (users / sessions / tokens / file blobs)
  // and column validation; everything else is fair game so ChatBGP can do
  // whatever the user asks. Every write is audited in ai_write_audit.
  tools.push({
    type: "function",
    function: {
      name: "describe_schema",
      description: "Inspect the BGP database schema. Call without arguments to list all tables. Pass a table name to get its columns. Use this when you need to know what tables/columns exist before crafting a sql_query or sql_write.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Optional — get the column list for a single table. Omit to list all tables." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "sql_query",
      description: "Run a read-only SQL SELECT (or WITH) against the BGP database. Use this when the user asks something the standard tools don't cover, or when you need to find rows before mutating them. Auto-LIMITed to 500 rows; 15s timeout; INSERT/UPDATE/DELETE/DDL are blocked — use sql_write for those. Tables off-limits: users, sessions, msal_token_cache, file_storage, ai_write_audit. Call describe_schema first if you don't know the columns.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A SELECT or WITH … SELECT query. Single statement, no trailing semicolon needed. Example: SELECT id, file_name FROM image_studio_images WHERE source = 'pexels' LIMIT 20" },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "read_document",
      description: "Universal document reader. Reads any document (PDF / Word / PowerPoint / Excel / CSV / text / image / ZIP) from chat-media storage, a property's brochure storage, or any file_storage key. PowerPoint (.pptx) returns each slide's text + tables. A ZIP is unpacked and read as its contents — the file list plus extracted text from the spreadsheets, PDFs, Word and text files inside — so a zipped pack dropped into chat needs no unzipping by the user. Returns extracted text plus, for PDFs and images, base64-encoded page images so you can use vision on visual material. Use this AUTOMATICALLY whenever the user shares a document in chat — read it without being asked, then file the relevant info into the CRM via sql_write / standard tools. Brochures, HoTs, leases, tenancy schedules, KYC docs, news articles, comp evidence, presentations — all flow through here.",
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: { type: "string", description: "Chat-media filename (e.g. '1774348793476-f3ddbf080ba7fd73-foo.pdf'). Use when the user drags a file into chat — the filename appears in the chat context with the /api/chat-media/ prefix." },
          storageKey: { type: "string", description: "Full file_storage key (e.g. 'property-brochures/<propertyId>/<timestamp>-<hash>.pdf'). Use for arbitrary stored files." },
          brochureId: { type: "string", description: "Property brochure id — looks up storage_key from property_brochures." },
          includePageImages: { type: "boolean", description: "Default true. When true, PDF first 4 pages are rasterised + included as base64 for vision. Set false to save tokens on text-heavy docs." },
          maxTextChars: { type: "integer", description: "Default 40000 chars of extracted text. Drop lower for huge documents." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "sql_write",
      description: "Run an INSERT, UPDATE, or DELETE on the BGP database. Use whenever the user asks to add, change, archive, or remove rows in any operational table — images, properties, deals, contacts, companies, comps, lease events, PLA matters, available units, tasks, diary, etc. Off-limits: users, sessions, api_keys, msal_token_cache, file_storage, deleted_sharepoint_images. Every write is audited. SAFETY RULE: before any DELETE that could affect more than a handful of rows, run sql_query first to count and show the user what's about to be deleted, get explicit confirmation in chat, then run the sql_write. UPDATE and DELETE both require a `where` clause — refusing to mutate the entire table is the only built-in guardrail.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Physical table name (snake_case), e.g. 'image_studio_images', 'crm_properties', 'pla_matters'. Call describe_schema if unsure." },
          op: { type: "string", enum: ["insert", "update", "delete"], description: "Mutation type." },
          data: { type: "object", description: "For insert: { col: value, ... }. For update: { col: newValue, ... }. Ignored for delete." },
          rows: { type: "array", items: { type: "object" }, description: "Bulk insert: array of row objects with the same column set. Use instead of `data` for inserting many rows at once." },
          where: { type: "object", description: "Required for update + delete. { col: value } → equality. { col: [a, b] } → IN (a, b). { col: null } → IS NULL. AND'd together." },
          returning: { type: "boolean", description: "Default true — return the affected rows. Set false for huge bulk ops where you don't need them." },
        },
        required: ["table", "op"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "manage_chat_members",
      description: "Add or remove a BGP colleague on the CURRENT chat thread, or list who's in it. Added members see this thread in their own ChatBGP sidebar with the full history and can join the conversation. Use whenever someone says 'add <name> to this chat' / 'share this thread with <name>'. Staff only — client logins can never be added. Only works inside a saved thread.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "remove", "list"], description: "What to do." },
          personName: { type: "string", description: "The colleague's name, e.g. 'Jonny Palmer'. Fuzzy-matched against BGP staff. Required for add/remove." },
        },
        required: ["action"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "generate_claude_designed_pdf",
      description: "Generate a properly designed, visually polished document (deck / brochure / pitch / playbook / Why Buy memo) in BGP house style from one brief. format='pdf' (default) renders a locked, print-ready PDF; format='pptx' renders the SAME brief as a native, fully editable PowerPoint; format='both' returns both download links — the editable master plus the locked final. THIS IS THE ONLY TOOL THAT MAKES DESIGNED PDFs/DECKS. Returns chat-media download link(s). For plain text the user will edit, use generate_word instead.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title (also used in the filename). e.g. 'Wimbledon Broadway — Why Buy'." },
          brief: { type: "string", description: "Structured markdown content (500-3000 words). Sections: cover info, executive summary, property/subject, tenant/counterparty, numbers + comps, risks, next steps. Be specific — Claude designs the layout from this verbatim." },
          scope: { type: "string", enum: ["why_buy", "placemaking", "pitch", "general"], description: "House-style scope to apply. Defaults to 'why_buy'. Picks the accumulated design preferences for that scope (Nick's saved direction etc.)." },
          additionalInstructions: { type: "string", description: "Optional design steer for this specific document, e.g. 'lead with the 4.86% true initial yield, downplay the headline'." },
          format: { type: "string", enum: ["pdf", "pptx", "both"], description: "Output format. 'pdf' (default) = locked designed PDF. 'pptx' = editable PowerPoint of the same brief. 'both' = one call, both files. When the user says they want to edit the deck, or asks for PowerPoint, use 'pptx' or 'both'." },
        },
        required: ["title", "brief"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "compile_brochure_from_pdfs",
      description: "Stitch specific pages from existing PDF brochures into a single new PDF, preserving all original design, imagery, and typography. Use when the user wants a bespoke brochure made from real BGP brochure pages (e.g. 'take pages 3-12 from Grosvenor Pitch and pages 8-15 from Courage Yard'). The output is a properly designed document because the pages ARE properly designed — you're just assembling them. Source PDFs must be accessible via SharePoint or Dropbox.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title for the new combined PDF (used for the filename)." },
          sources: {
            type: "array",
            description: "Ordered list of source PDF slices. Each item contributes its specified pages to the final output, in the order given.",
            items: {
              type: "object",
              properties: {
                source: { type: "string", enum: ["sharepoint", "dropbox"], description: "Where the source PDF lives." },
                sharepointDriveId: { type: "string", description: "SharePoint driveId (required if source=sharepoint)" },
                sharepointItemId: { type: "string", description: "SharePoint itemId (required if source=sharepoint)" },
                dropboxPath: { type: "string", description: "Dropbox file path or ID (required if source=dropbox)" },
                pages: { type: "array", items: { type: "number" }, description: "1-indexed page numbers to include (e.g. [3,4,5,6,7,8,9,10,11,12]). Use ranges if needed." },
                label: { type: "string", description: "Optional human label for this source (for logging/debug)." },
              },
              required: ["source", "pages"],
            },
          },
        },
        required: ["title", "sources"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "sign_pdf",
      description: "Stamp a signature and date (plus Name/Title fields) onto an existing PDF the user uploaded to chat — NDAs, engagement letters, forms. Placement is by ANCHOR TEXT: read the document first (read_document) to see the execution block, then pass the exact label text next to where each mark goes. Uses the user's stored signature image when one exists (saved via save_signature); otherwise falls back to a typed italic signature of signerName. Returns a downloadMarkdown link to the signed copy — give it to the user verbatim and ask them to check placement.",
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: { type: "string", description: "The PDF's chat-media filename (from the /api/chat-media/ URL in chat context) or its original file name." },
          page: { type: "number", description: "1-indexed page carrying the execution block. Omit to auto-find (searches from the last page back)." },
          signatureAnchor: { type: "string", description: "Exact label text next to/under the signature spot, e.g. 'Signature:', 'Authorised Signatory', 'SIGNED for and on behalf of'. Omit to try common labels. Labels ending ':' or with a fill-line get the signature to their RIGHT; bare captions get it ABOVE." },
          dateAnchor: { type: "string", description: "Label for the date field (default 'date'). Pass an empty string to skip dating." },
          dateText: { type: "string", description: "Date text to write (default: today, e.g. '5 September 2026')." },
          signerName: { type: "string", description: "The signer's full name — required when no stored signature image exists (typed italic signature)." },
          style: { type: "string", enum: ["auto", "image", "typed"], description: "auto (default): stored image if available, else typed. image: require the stored signature. typed: always type the name." },
          placement: { type: "string", enum: ["auto", "right", "above"], description: "Override the signature placement relative to its anchor." },
          extraFields: {
            type: "array",
            description: "Additional printed fields to fill on the same page, e.g. [{anchor:'Name:', text:'Woody Bruce'},{anchor:'Title:', text:'Managing Director'}].",
            items: { type: "object", properties: { anchor: { type: "string" }, text: { type: "string" } }, required: ["anchor", "text"] },
          },
        },
        required: ["chatMediaFilename"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "save_signature",
      description: "Store the user's real signature for sign_pdf, from a photo or scan they upload to chat. Cleans it automatically: background removed, ink recoloured to navy, cropped tight. Stored once per user and reused on every future sign_pdf. Returns a preview link — show it so the user can check the result.",
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: { type: "string", description: "The uploaded signature image's chat-media filename (from the /api/chat-media/ URL in chat context)." },
        },
        required: ["chatMediaFilename"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "copy_dropbox_to_sharepoint",
      description: "Copy one or more files from Dropbox into a SharePoint folder, preserving the binary file (not just text). Use when the user asks to 'pull files into a SharePoint folder', 'file these to SharePoint', or 'move these PDFs to a shared folder'. Creates the destination folder if it doesn't exist.",
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "array",
            description: "List of Dropbox files to copy.",
            items: {
              type: "object",
              properties: {
                dropboxPath: { type: "string", description: "Dropbox file path (e.g. '/Brixton/Target Tenants/Prospectus/Brixton Master Plan.pdf')" },
                renameTo: { type: "string", description: "Optional: rename the file on upload. Defaults to original filename." },
              },
              required: ["dropboxPath"],
            },
          },
          destinationFolderPath: { type: "string", description: "SharePoint folder path (e.g. 'Investment/Islington Square/Placemaking References'). Folder is created if missing." },
        },
        required: ["files", "destinationFolderPath"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "ingest_url",
      description: "Fetch and read content from an external URL — works with PDFs, research reports, web pages, and ZIP downloads (unpacks in memory and reads the spreadsheets/PDFs/text inside — e.g. the Propel multi-site database ZIP). Spreadsheets found in a ZIP are ALSO staged in full into the ingested_spreadsheet_rows table, so after ingesting you can cross-reference or filter EVERY row with sql_query (the tool result tells you the ingest_key and columns) — the inline preview is only the first slice. Use when the user shares a link and wants you to read, summarise, cross-reference, or add it to the news feed. Can also save the content as a news article.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch and read" },
          addToNews: { type: "boolean", description: "If true, save the content as a news article in the BGP news feed" },
          sourceName: { type: "string", description: "Source name for the article (e.g. 'Savills Research', 'CBRE', 'Knight Frank')" },
        },
        required: ["url"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "follow_url",
      description: "Register a news/blog/publisher URL as a persistent source in the BGP news feed. The news-feeds cron will then auto-poll it on every cycle, dedupe, AI-score, and link to brands — so new articles appear automatically in /news without any further action. Use whenever the user pastes (or mentions) a URL from a news outlet, journalist blog, columnist page, research publisher, or industry publication and the intent is to track it ongoing rather than just read one page. Examples: a Sky News journalist blog, an FT columnist landing page, a research-house insights index. Do NOT use for: internal app URLs, Companies House records, planning-portal pages, SharePoint/OneDrive links, social profiles, or one-off article reads (use ingest_url for those).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The page URL to start tracking. Can be a homepage, section page, author/blog page, or direct article URL — RSS.app will generate an RSS feed from it." },
          name: { type: "string", description: "Optional display name for the source. If omitted, the page title is used (e.g. 'Mark Kleinman — Sky News')." },
          category: { type: "string", description: "Category bucket: Property, Retail, Hospitality, Investment, or general. Default 'general'." },
        },
        required: ["url"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "export_to_excel",
      description: "Generate a downloadable Excel (.xlsx) file from structured table data. Use when you extract comps tables, schedules, financial data, or any tabular information from brochures, PDFs, or documents and the user wants it as an Excel file. Also use proactively when presenting tabular data that would be useful to download. Returns a download link.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Name for the Excel file (without extension), e.g. 'Travelodge_Southwark_Comps'" },
          sheets: {
            type: "array",
            description: "Array of sheets to include in the workbook",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Sheet/tab name, e.g. 'Comps', 'Summary'" },
                headers: { type: "array", items: { type: "string" }, description: "Column headers" },
                rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Array of rows, each row is an array of cell values as strings" },
              },
              required: ["name", "headers", "rows"],
            },
          },
        },
        required: ["filename", "sheets"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "web_search",
      description: "Search the internet for any topic. Use when you need to find information from the web — planning applications, property details, company information, market data, news, or any other publicly available information. Returns search results with titles, URLs, and snippets. You can then use ingest_url to read specific result pages in detail.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query — be specific. e.g. 'Battersea Power Station Phase 1 ground floor retail plans', 'Wandsworth planning portal 2010/3897'" },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_news",
      description: "Search the BGP news feed for articles by keyword. Use when the user asks about property news, market news, or mentions a company/location and wants to see relevant articles.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term — property name, company, location, or topic" },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_green_street",
      description: "Search Green Street News for commercial property articles and analysis. Use when the user asks about Green Street, wants premium property market intelligence, or asks about property sectors/regions covered by Green Street. Returns UK-focused articles with sector and region tags.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term — property sector, company, location, topic, or keyword" },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "property_data_lookup",
      description: "Look up UK property market data from PropertyData.co.uk. Supports multiple data types by postcode or location. Use when users ask about property values, rents, yields, sold prices, planning applications, commercial valuations, demographics, or growth trends for a specific area. For commercial valuations, property_type must be one of: retail, offices, industrial, restaurants, pubs.",
      parameters: {
        type: "object",
        properties: {
          endpoint: {
            type: "string",
            enum: ["sold-prices", "prices", "prices-per-sqf", "sold-prices-per-sqf", "rents", "rents-commercial", "rents-hmo", "yields", "growth", "growth-psf", "planning-applications", "valuation-commercial-sale", "valuation-commercial-rent", "valuation-sale", "valuation-rent", "demand", "demand-rent", "demographics", "flood-risk", "floor-areas", "postcode-key-stats", "uprns", "energy-efficiency", "address-match-uprn", "uprn", "uprn-title", "analyse-buildings", "rebuild-cost", "ptal", "crime", "schools", "internet-speed", "restaurants", "conservation-area", "green-belt", "aonb", "national-park", "listed-buildings", "household-income", "population", "tenure-types", "property-types", "council-tax", "national-hmo-register", "freeholds", "politics", "agents", "area-type", "land-registry-documents"],
            description: "Which data to retrieve. Market: sold-prices, prices, prices-per-sqf, sold-prices-per-sqf, rents-commercial, yields, growth, growth-psf, demand, demand-rent, demographics, postcode-key-stats. Residential: rents, rents-hmo, tenure-types, property-types, floor-areas. Valuations: valuation-commercial-sale/rent, valuation-sale/rent. Local: ptal, crime, schools, internet-speed, restaurants, agents, area-type, council-tax, household-income, population, politics. Planning: planning-applications, conservation-area, green-belt, aonb, national-park, listed-buildings, flood-risk, freeholds, national-hmo-register. Property Intelligence: uprns, energy-efficiency, address-match-uprn, uprn, uprn-title, analyse-buildings, rebuild-cost. Land Registry: land-registry-documents (purchase the official stamped Title Register and/or Title Plan PDF by title number — costs £7.50+VAT per document). NOTE: to IDENTIFY a title's owner/parcel, query the in-house hmlr_proprietors register with sql_query FIRST (free, instant) — only use land-registry-documents when the user needs the actual stamped PDF. This reseller is flaky on regional/OCOD titles; if a result comes back with delivered:false, relay its registerKnown + manualOrder.url (order direct from HMLR) instead of retrying."
          },
          postcode: { type: "string", description: "UK postcode (full, district, or sector). e.g. W1K 3QB, SW1X, EC2A. Not required for 'uprn' endpoint." },
          address: { type: "string", description: "For address-match-uprn: the street address to match. e.g. '10 Lowndes Street'" },
          uprn: { type: "string", description: "For uprn and uprn-title endpoints: the UPRN number to look up." },
          title: { type: "string", description: "For analyse-buildings: a single Land Registry title number. For land-registry-documents: one or MORE title numbers, comma-separated (e.g. 'TGL379483,TGL624521') — each is purchased and its register text extracted in one call (max 4)." },
          documents: { type: "string", enum: ["register", "plan", "both"], description: "For land-registry-documents: which documents to purchase. 'register' = Title Register, 'plan' = Title Plan, 'both' = both. Default: both." },
          extract_proprietor_data: { type: "boolean", description: "For land-registry-documents: extract proprietor name, address, price paid, and mortgage charges from the register (extra £1+VAT). Default: true." },
          property_type: { type: "string", description: "For commercial endpoints: retail, offices, industrial, restaurants, or pubs. For residential: flat, terraced, semi-detached, detached. For rebuild-cost: detached_house, semi_detached_house, mid_terrace_house, end_terrace_house, flat." },
          internal_area: { type: "number", description: "Internal floor area in sqft (for valuation and rebuild-cost endpoints)" },
          bedrooms: { type: "number", description: "Number of bedrooms (for residential endpoints, 0-5)" },
          max_age: { type: "number", description: "Max age in months for sold-prices (3-84, default 18) or days for planning (14-1500)" },
        },
        required: ["endpoint"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "tfl_nearby",
      description: "Find nearby TfL stations (tube, rail, DLR, overground, Elizabeth line) for a given UK postcode. Returns station names, distances in metres, walking times, transport modes, and line names. Use when users ask about transport links, nearest tube/train stations, or commute options for a property or area.",
      parameters: {
        type: "object",
        properties: {
          postcode: { type: "string", description: "UK postcode, e.g. SW1X 7XL, W1K 3QB" },
          radius: { type: "number", description: "Search radius in metres (default 1500, max 3000)" },
        },
        required: ["postcode"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "log_lease_event",
      description: "Log an upcoming lease event (rent review, break, expiry, renewal option) to the Lease Events tracker. Use when the user mentions an upcoming lease event in conversation, or when you extract one from an email/brochure/WhatsApp. Lease advisory team uses this as their BD pipeline. Always set sourceEvidence to match where the info came from.",
      parameters: {
        type: "object",
        properties: {
          tenant: { type: "string", description: "Tenant company name" },
          address: { type: "string", description: "Property address" },
          unitRef: { type: "string", description: "Unit reference, e.g. 'Unit 2A' or floor number" },
          eventType: { type: "string", enum: ["Rent Review", "Break Option", "Lease Expiry", "Renewal Option", "Service Charge", "Other"], description: "Type of lease event" },
          eventDate: { type: "string", description: "Event date as ISO date string (YYYY-MM-DD)" },
          noticeDate: { type: "string", description: "Notice date as ISO (for break options)" },
          currentRent: { type: "string", description: "Current rent, e.g. '£125,000 pa'" },
          estimatedErv: { type: "string", description: "Estimated rental value if known" },
          sqft: { type: "string", description: "Unit size" },
          sourceEvidence: { type: "string", enum: ["Email", "WhatsApp", "File", "Brochure", "News", "SharePoint", "Dropbox", "Manual", "ChatBGP", "BGP Direct"], description: "Where this information came from" },
          sourceUrl: { type: "string", description: "Link back to the source (email URL, SharePoint link, etc.)" },
          sourceTitle: { type: "string", description: "Short title for the source, e.g. 'Pete's email — 14 Apr'" },
          notes: { type: "string", description: "Any context from the source" },
        },
        required: ["tenant", "eventType"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "query_wip",
      description: "Query the WIP (Work In Progress) pipeline data. Use when the user asks about pipeline value, deal counts, team performance, overdue deals, or wants a summary of current deals. Can filter by team, status, or deal type.",
      parameters: {
        type: "object",
        properties: {
          team: { type: "string", description: "Filter by team: London F&B, London Retail, National Leasing, Investment, Tenant Rep, Development, Lease Advisory, Office / Corporate" },
          status: { type: "string", description: "Filter by status/stage e.g. Under Offer, Exchanged, Completed, New Instructions" },
          dealType: { type: "string", description: "Filter by deal type: Letting, Acquisition, Sale, Lease Renewal, Rent Review" },
          summaryOnly: { type: "boolean", description: "If true, return just totals and counts. If false, return deal details." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "query_xero",
      description: "Look up Xero invoices linked to CRM deals. Use when the user asks about invoicing status, whether a fee has been invoiced, or payment status.",
      parameters: {
        type: "object",
        properties: {
          dealId: { type: "string", description: "CRM deal ID to check invoices for" },
          query: { type: "string", description: "Search term to find invoices by reference, number, or deal name" },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "scan_duplicates",
      description: "Scan for duplicate records in the CRM. Use when the user wants to check if a contact, company, or property already exists, or asks to clean up duplicates.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["contacts", "companies", "properties"], description: "Which entity type to scan for duplicates" },
        },
        required: ["entityType"],
      },
    },
  });

  tools.push({
    type: "function" as const,
    function: {
      name: "save_learning",
      description: "Save a piece of business knowledge or insight that ChatBGP has learned during this conversation. This persists across all future conversations, making ChatBGP smarter about BGP's business over time. Only save genuinely useful, reusable knowledge — not transient details. Pass subjectPropertyId or subjectCompanyNumber when the fact is about a specific property or company so later HMLR-verified findings can correctly supersede it.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["client_intel", "market_knowledge", "bgp_process", "property_insight", "team_preference", "general"], description: "Category of the learning" },
          learning: { type: "string", description: "The specific knowledge or insight to remember. Be concise but include enough context to be useful in future conversations. E.g. 'The Cadogan Estate (SW1) prefer to deal directly with Charlotte Roberts for any leasing enquiries.'" },
          subjectPropertyId: { type: "string", description: "Optional. The crm_properties.id this learning is about. Use when saving a fact about a specific property (e.g. ownership, tenant, lease terms) so subsequent HMLR-verified data can supersede stale entries." },
          subjectCompanyNumber: { type: "string", description: "Optional. Companies House number (or OE / OC number) the learning is about. Use for company-specific facts (UBOs, group structure)." },
        },
        required: ["category", "learning"],
      },
    },
  });

  tools.push({
    type: "function" as const,
    function: {
      name: "log_app_feedback",
      description: "Log feedback about the BGP Dashboard app. Use this proactively when: (1) a user reports something not working or looking wrong (bug), (2) a user expresses frustration about the app, (3) a user makes a suggestion for improvement, (4) you notice something that seems broken or could be better, (5) a user compliments a feature (praise). Always log before responding to the user about the issue.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["bug", "suggestion", "complaint", "praise", "error"], description: "Type of feedback" },
          summary: { type: "string", description: "Short one-line summary of the feedback" },
          detail: { type: "string", description: "Detailed description including what the user said, what page/feature it relates to, and any context about what went wrong or what they'd like improved" },
          pageContext: { type: "string", description: "Which page or feature this relates to, e.g. 'Deals', 'Dashboard', 'ChatBGP', 'Properties', 'WIP Report'" },
        },
        required: ["category", "summary"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "transcribe_audio",
      description: "Transcribe audio or video files to text using AI speech recognition (Whisper). Use when a user uploads a voice note, meeting recording, Teams recording, or any audio/video file and wants it transcribed. Accepts three source types: (1) chat-media uploads (e.g. '/api/chat-media/filename.mp4'), (2) SharePoint or OneDrive share links (any 'https://...sharepoint.com/...' or 'https://...-my.sharepoint.com/...' URL — auto-resolved via Microsoft Graph and streamed server-side, no need to download first), or (3) any public https URL. Supports MP3, MP4, M4A, WAV, WEBM, OGG, MOV, AVI, MKV and other common formats. After transcription, you can use the transcript to update CRM deals, create diary notes, log viewings, update trackers, or take any follow-up actions the user requests.",
      parameters: {
        type: "object",
        properties: {
          fileUrl: { type: "string", description: "Source of the audio/video. Accepts: '/api/chat-media/filename.mp4' for uploaded files, a SharePoint/OneDrive share link (e.g. 'https://yourtenant-my.sharepoint.com/...'), or any public https URL." },
          language: { type: "string", description: "Language code (e.g. 'en' for English). Defaults to 'en'." },
        },
        required: ["fileUrl"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "query_leasing_schedule",
      description: "Search and query the leasing schedule board — unit-level data across all managed properties (Bluewater, Cardiff, White Rose, Trinity Leeds, Westgate Oxford, Lewisham, Finchley Road, Gunwharf Quays, Clark's Village, Braintree Village). Use when the user asks about tenants, vacant units, upcoming lease expiries, rent levels, zones, occupancy costs, or any leasing schedule data. Can filter by property, status (Occupied/Vacant), zone, tenant name, or date range.",
      parameters: {
        type: "object",
        properties: {
          propertyName: { type: "string", description: "Filter by property name (partial match, e.g. 'Bluewater', 'Cardiff')" },
          status: { type: "string", enum: ["Occupied", "Vacant", "Under Offer", "In Negotiation"], description: "Filter by unit status" },
          zone: { type: "string", description: "Filter by zone name (partial match)" },
          tenantName: { type: "string", description: "Filter by tenant name (partial match)" },
          expiringWithinMonths: { type: "number", description: "Find units with lease expiry within this many months from now" },
          limit: { type: "number", description: "Max results to return (default 50)" },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "list_my_uploads",
      description: "List files the current user has uploaded to chat recently — most recent first. Use this when the user references a previously-uploaded file ('the Landsec sheet', 'that xlsx I dropped last week') but the exact filename is unclear. Returns filename + size + when uploaded + the chat-media filename to pass to import tools. Always call this BEFORE telling the user 'file not found, please re-upload' — the file is almost certainly still here.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Optional case-insensitive substring filter (e.g. 'landsec' or 'wip'). Omit to list everything recent." },
          limit: { type: "number", description: "Max files to return. Default 20, max 50." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "import_leasing_schedule",
      description: "Import leasing schedule data from an uploaded Excel file into the Leasing Schedule Board (leasing_schedule_units table). The workbook can contain multiple properties — the tool parses property headers and unit rows intelligently. The file must have been uploaded to this chat first (drag & drop, or via file picker). Use when the user asks to import / upload / load / populate / restore a leasing schedule, or says they've dragged in a leasing schedule file. ALWAYS call with mode='preview' first, show the user a summary, then call again with mode='import' only after they confirm.",
      parameters: {
        type: "object",
        properties: {
          mediaFilename: { type: "string", description: "Name of the uploaded Excel file (e.g. 'Landsec_Leasing_Schedule.xlsx'). Must already be uploaded to this chat." },
          mode: { type: "string", enum: ["preview", "import"], description: "preview = parse and show what would be imported, no DB writes. import = insert rows into database. Default: preview." },
          propertyFilter: { type: "string", description: "Optional: import only one property from the file (partial name match, e.g. 'Westgate'). Omit to import every property in the workbook." },
        },
        required: ["mediaFilename"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "import_wip_excel",
      description: "Import a Sage WIP (Work-in-Progress) Excel export end-to-end. Auto-detects either Sage layout: legacy 'WIP by deal' (Ref, Amt WIP, Amt invoice, …) or current Sage TransactionsExpo (HEADER_NUMBER, NetAmount, NAME, ADDRESS_*, STOCK_CODE, DealStatus, …). Wipes wip_entries and reloads (or appends with mode='append'), then on the TransactionsExpo layout ALSO populates: (1) crm_deals via syncWipToCrmDeals, (2) cached billing name + address from NAME + ADDRESS_* onto each deal as `xero_contact_name` / `xero_billing_address` (Xero is the source of truth for the actual contact link, picked by the user via the deal form), (3) deal_fee_allocations from per-Agent NetAmount slices (CON049 STOCK_CODE tagged as BGP House), (4) tenant_rep_searches kanban entries for any NEG-status deals. Idempotent — safe to re-run on each Sage export. Pass either `chatMediaFilename` (file dragged into chat) OR `sharepointUrl` (a SharePoint share link the user pastes). By default REPLACES wip_entries — use mode='append' only for incremental updates between full Sage exports.",
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: { type: "string", description: "The chat-media filename of the uploaded Excel (e.g. '1745689452345-abc123def.xlsx'). Use when the user has dragged the file into chat." },
          sharepointUrl: { type: "string", description: "A SharePoint share URL (e.g. 'https://...sharepoint.com/.../IQ...') pointing at the WIP Excel. Use when the user pastes a share link instead of dragging the file in. Either this or chatMediaFilename must be supplied." },
          mode: { type: "string", enum: ["replace", "append"], description: "replace = wipe wip_entries and reload from file (default — what Sage gives you each quarter). append = keep existing rows and add new ones. Default: replace." },
          sourceOfTruth: { type: "boolean", description: "When true (and mode='replace'), also soft-archive any crm_deals previously synced from a WIP import whose ref is no longer in the file. Sets status='ARCH' and tags comments with [ARCHIVED <date>] — fully reversible. Use this for the start-of-year cutover when the new file is the definitive list. Default: false." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "wipe_crm_deals",
      description: "ADMIN ONLY. Wipe ALL crm_deals from the database so the user can start fresh with a clean WIP import. Clears deal_id/property_id references in wip_entries first, then deletes all deals. Use when the user says 'nuke all deals', 'delete all deals', 'clean reload', or equivalent. After wiping, tell the user to re-import their WIP Excel to repopulate.",
      parameters: {
        type: "object",
        properties: {
          confirm: { type: "boolean", description: "Must be true to proceed. Ask the user to confirm before setting this." },
        },
        required: ["confirm"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "query_turnover",
      description: "Search the Turnover Data Board — brand/operator revenue intelligence. Use when the user asks about a brand's turnover, revenue, sales performance, £/sqft, or occupational cost data. Can filter by company/brand name, property, category (F&B, Retail, Leisure, etc.), or period.",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Filter by brand/company name (partial match, e.g. 'Pret', 'JD Sports')" },
          propertyName: { type: "string", description: "Filter by property name (partial match)" },
          category: { type: "string", description: "Filter by category: F&B, Retail, Leisure, Services, Health & Beauty, Grocery, Fashion, Technology, Hospitality, Other" },
          period: { type: "string", description: "Filter by period (partial match, e.g. 'FY 2025', '2024')" },
          limit: { type: "number", description: "Max results to return (default 50)" },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "query_calendar",
      description: "Look up calendar events and diary entries for team members. Use when the user asks about schedules, availability, upcoming meetings, viewings, or 'what's in my diary'. Can check the current user's calendar or any team member's. Returns events from Microsoft Outlook/365.",
      parameters: {
        type: "object",
        properties: {
          daysAhead: { type: "number", description: "Number of days ahead to look (default 7, max 30)" },
          teamMember: { type: "string", description: "Name or email of team member to check. Leave empty for the current user's calendar." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "send_whatsapp",
      description: "Send a WhatsApp message to a phone number. Use when the user asks you to message someone on WhatsApp. The message is sent from the BGP business WhatsApp number. CONSTRAINT: WhatsApp only permits free-form messages to a person who has messaged the BGP business number within the last 24 hours — to anyone else (e.g. a contact you're introducing yourself to cold) the send WILL FAIL and the result will contain an error. HONESTY: never tell the user a message was sent unless you actually called this tool AND it returned success:true. If you did not call it, or it returned an error, say so plainly — do not claim it was sent. Confirm the number and message with the user before sending.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient phone number in international format (e.g. '447700900123' or '+447700900123')" },
          message: { type: "string", description: "The message text to send" },
          contactName: { type: "string", description: "Name of the recipient (for confirmation)" },
        },
        required: ["to", "message"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "bulk_update_crm",
      description: "Update multiple CRM records at once. Use when you need to apply the same change to several deals, contacts, companies, or properties — e.g. updating status on a batch of deals, adding notes to multiple contacts, or changing an agent assignment across records. Much faster than updating one at a time.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["deal", "contact", "company", "property"], description: "Type of CRM record to update" },
          ids: { type: "array", items: { type: "string" }, description: "Array of record IDs to update" },
          updates: {
            type: "object",
            description: "Fields to update on all records. Keys are field names, values are the new values. e.g. { status: 'Under Offer', notes: 'Updated by ChatBGP' }",
          },
        },
        required: ["entityType", "ids", "updates"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "run_kyc_check",
      description: "Run a KYC (Know Your Customer) check on any company by name. Searches Companies House, retrieves the company profile, officers, PSCs, and screens all individuals against the UK Sanctions List. Returns a full risk assessment WITHOUT needing to create the company in the CRM first. Use when someone asks to 'KYC a company', 'check a company', 'run due diligence', 'sanctions check', or any AML/compliance query.",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "The company name to check (e.g. 'Landsec', 'British Land PLC', 'Grosvenor Group'). Required unless companyNumber is provided." },
          companyNumber: { type: "string", description: "Companies House number if known (e.g. '00030776'). If provided, skips the name search. Can be used instead of companyName." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "deep_investigate",
      description: "Run a deep intelligence investigation on a company, person, and/or property. Combines Companies House (full profile, officers, PSCs, corporate ownership chain, ultimate parent/brand identification), Apollo.io and RocketReach (contact details — emails, phone numbers, LinkedIn), UK Sanctions List screening, web search (recent news and activity), and CRM cross-referencing into a comprehensive intelligence report. Use when someone asks to 'investigate', 'dig into', 'research', 'find out about', 'who owns', 'who to contact', 'find the owner', 'known associates', 'deep dive', or wants to find key decision-makers and contact routes for a company, person, or property. This is the D&B-style corporate intelligence tool. When a property address is provided, it will trace ownership back through SPVs to the real owner, find all associated people and companies, and suggest who to speak to about acquiring or managing the property.",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Company name to investigate (e.g. 'British Land', 'Grosvenor Group'). Will search Companies House, trace ownership, find officers, PSCs, and enrich contacts via Apollo." },
          companyNumber: { type: "string", description: "Companies House number if known (e.g. '00621920'). Speeds up the search." },
          personName: { type: "string", description: "Person's name to investigate. Will find all their directorships via Companies House officer search, and try to find contact details via Apollo." },
          propertyAddress: { type: "string", description: "Property address or postcode to investigate. Will look up Land Registry ownership, trace the proprietor company, and find who is connected to it." },
          includeWebSearch: { type: "boolean", description: "Whether to include web search for recent news/activity about the subjects. Default true." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_food_hygiene",
      description: "Search the UK Food Standards Agency hygiene-ratings register for every rated premises matching a business name. Free, authoritative, and instant — for any F&B or hospitality operator this returns their real trading footprint: each site's address, postcode, local authority, hygiene rating and inspection date. Use it to build an operator's site list, verify where a brand actually trades, or spot expansion (a recent rating date at a new address means a new site). Covers England, Wales and Northern Ireland with 0-5 ratings; Scottish premises return Pass/Improvement Required.",
      parameters: {
        type: "object",
        properties: {
          businessName: { type: "string", description: "Business/brand name as it appears on premises registrations, e.g. 'Dishoom' or 'A Wong'. Partial matches work." },
          maxResults: { type: "number", description: "Max premises to return (1-200). Default 50." },
        },
        required: ["businessName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "rocketreach_person_lookup",
      description: "Look up a specific person's verified contact details (emails with SMTP validation, phones, LinkedIn) via RocketReach. Searches by person name — optionally narrowed by company name or website domain — then reveals the best-matching profile(s). Reveals cost RocketReach credits, so use this for specific named targets (e.g. directors/PSCs found via Companies House or deep_investigate), not broad discovery. Returns all candidates with employer + title so namesakes can be rejected: only trust a result whose employer matches the target brand, and only treat an email as verified (grade A material) when its smtpValid field is 'valid'.",
      parameters: {
        type: "object",
        properties: {
          personName: { type: "string", description: "The person's full name, e.g. 'Andrew Wong'." },
          companyName: { type: "string", description: "Company or brand name to disambiguate namesakes, e.g. 'A. Wong'." },
          domain: { type: "string", description: "The company's website domain, e.g. 'awong.co.uk'. The strongest disambiguator — prefer this over companyName when known." },
          maxReveals: { type: "number", description: "How many top candidates to reveal full contact details for (1-3). Default 1. Each reveal costs credits." },
        },
        required: ["personName"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_aged_receivables",
      description: "Who owes BGP money — pulls every awaiting-payment sales invoice from Xero and buckets it by age (current / 1-30 / 31-60 / 61-90 / 90+ days overdue), grouped by client with totals. Use for 'aged debtors', 'who owes us', 'outstanding invoices', 'has X paid us yet', WIP/cash conversations. Read-only.",
      parameters: {
        type: "object",
        properties: {
          contactName: { type: "string", description: "Optional — filter to one client/contact name (contains-match)." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "find_similar_brands",
      description: "Discover brands SIMILAR to a given brand via Exa's similarity engine — 'more brands like Gail's' / 'who else is like this tenant'. Takes the reference brand's website URL (get it from the CRM row when you only have a name). Returns similar companies with name + website, each cross-checked against the CRM so you can tell Woody which are already tracked and which are genuinely new prospects worth adding to Brand Hunter.",
      parameters: {
        type: "object",
        properties: {
          websiteUrl: { type: "string", description: "The reference brand's website, e.g. 'https://gails.com'." },
          numResults: { type: "number", description: "How many similar companies to return (1-25). Default 10." },
        },
        required: ["websiteUrl"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "perplexity_people_search",
      description: "Find WHO holds a role — professionals by role + company + location — via Perplexity's people-search (public web info only: names, titles, employers, background; NO emails/phones). Use this FIRST when you don't have a specific name yet ('who is head of acquisitions at Maxima Properties?', 'F&B leasing directors in London', 'who runs the family office behind X') — then pass the name it finds to rocketreach_person_lookup for verified contact details. Very cheap (~£0.004/lookup), so prefer it over guessing names.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language people query. Combine role + company (or role + location) for best results, e.g. 'current head of property/acquisitions at Greene King' or 'leasing director, Bluewater shopping centre'." },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "browse_dropbox",
      description: "Browse and interact with the BGP Dropbox account. Use this to list folders, search for files, or read file contents. Supports listing folder contents, searching by name, and downloading/reading text from documents.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "search", "read"],
            description: "'list' to list folder contents (default: root), 'search' to search for files by name, 'read' to read a file's text content.",
          },
          path: { type: "string", description: "For 'list': folder path to browse (default: '' for root). For 'read': the file path or ID to read." },
          query: { type: "string", description: "For 'search': the search query string." },
        },
        required: ["action"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "trigger_archivist_crawl",
      description: "Trigger the BGP Archivist to crawl and index documents from SharePoint, Dropbox, and team emails into the knowledge base. The archivist runs automatically every 6 hours, but this tool lets you trigger it on demand. Use when the user asks to refresh the knowledge base, re-index documents, start a crawl, or update the archivist. Also use to check archivist status (how many documents/emails indexed, last run time, whether Dropbox is connected).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "crawl"], description: "Whether to check status or trigger a crawl. Default: 'crawl'." },
        },
        required: [],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "manage_tasks",
      description: "Manage the user's personal task list. Create new tasks, mark tasks complete, list open tasks, or delete tasks. Use when the user asks to add a to-do, reminder, follow-up, or task. Also use to check what tasks are pending or mark something as done.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "create", "complete", "delete"], description: "Action to perform" },
          title: { type: "string", description: "Task title (for create)" },
          description: { type: "string", description: "Task description (for create)" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "Priority level (for create). Default: medium" },
          dueDate: { type: "string", description: "Due date in ISO format (for create)" },
          category: { type: "string", enum: ["follow-up", "meeting", "deal", "admin", "client", "research", "viewing", "personal"], description: "Task category (for create)" },
          taskId: { type: "string", description: "Task ID (for complete/delete)" },
          linkedDealId: { type: "string", description: "Link task to a deal by deal ID (for create)" },
          linkedPropertyId: { type: "string", description: "Link task to a property by property ID (for create)" },
        },
        required: ["action"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Full-text search the BGP knowledge base — archived SharePoint files, emails, Dropbox documents, and AI-indexed notes with AI-generated summaries, tags, and extracted content. Use this WHENEVER the user asks about a document, email, memo, report, note, deck, spreadsheet, letter, or historical information that might have been ingested. This is your primary memory bank — check it before saying you don't know something. Returns matches ranked by relevance with fileName, summary, source, fileUrl, and tags.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query. Supports multi-word phrases, quotes, AND/OR operators (websearch-style)." },
          source: { type: "string", enum: ["sharepoint", "email", "dropbox", "note"], description: "Optional: filter to a single source type." },
          category: { type: "string", description: "Optional: filter by AI-assigned category (e.g., 'lease', 'valuation', 'correspondence')." },
          limit: { type: "number", description: "Max results to return (default 10, max 50)." },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_chat_history",
      description: "Search past ChatBGP conversations by content. Use when the user refers to 'what we discussed before', 'the chat about X', 'that conversation last week', or wants to recall something from prior chat threads. Returns matching messages with thread context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query over chat message content." },
          limit: { type: "number", description: "Max results to return (default 10, max 50)." },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "create_deck",
      description: "Create a new Deck — BGP's composable document primitive used for any deliverable (Why Buy memo, AM/IM pitch, leasing pitch, rent review pack, brand pack). Pass a templateKey and the deck is seeded with that template's default cards as drafts. You can also pre-populate specific cards (overrides the template defaults). After creating, ChatBGP can use the returned deck.id to update cards, lock them, and call assemble_deck to produce the designed PDF. Use this whenever the user asks for any multi-section document — prefer it over generate_claude_designed_pdf because decks are editable and re-assemblable.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Deck name — what shows in the list (e.g. 'Brixton Market Quarter — AM/IM Strategy')." },
          templateKey: { type: "string", enum: ["why_buy", "am_im", "leasing_pitch", "rent_review", "brand_pack"], description: "Which template to base the deck on. Picks the default card set and the PDF design scope." },
          propertyId: { type: "string", description: "Optional crm_properties.id to anchor the deck to a property — surfaces it on the property page and lets the assembler pick the right map." },
          companyId: { type: "string", description: "Optional crm_companies.id (landlord or brand) to anchor the deck to a company — useful for brand packs and rent reviews." },
          dealId: { type: "string", description: "Optional crm_deals.id to anchor the deck to a specific live deal." },
          notes: { type: "string", description: "Free-text brief / one-liner. Visible on the deck list view." },
          cards: {
            type: "array",
            description: "Optional explicit card set — overrides the template defaults. Use when you've already drafted content and want to pre-populate cards rather than starting from blanks. Each card is { type, title?, sortOrder?, content?, state? }. Content shape depends on type — see the universal vocabulary below.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["cover", "narrative", "image", "image_grid", "map", "kpi_block", "data_table", "model_link", "risk_register", "next_steps", "signature_block"] },
                title: { type: "string" },
                sortOrder: { type: "number" },
                state: { type: "string", enum: ["draft", "locked"] },
                content: { type: "object", description: "Shape per type: narrative={markdown}, kpi_block={kpis:[{value,label,note}]}, data_table={headers,rows}, risk_register={items:[{risk,mitigant,severity}]}, next_steps={items:[{action,owner,by}]}, signature_block={team:[{name,role,email}],fee}, image={imageStudioId,caption}, image_grid={imageIds[]}, map={propertyId,zoom}, model_link={modelRef,summary}, cover={subtitle,hero}." },
              },
              required: ["type"],
            },
          },
        },
        required: ["name", "templateKey"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_deck_card",
      description: "Update a single deck card — title, content, or state (draft → locked). Use to refine a card the user wants changed, or to lock cards ready for assembly. To assemble the deck into a PDF, all cards must be locked.",
      parameters: {
        type: "object",
        properties: {
          deckId: { type: "string", description: "decks.id" },
          cardId: { type: "string", description: "deck_cards.id" },
          title: { type: "string" },
          content: { type: "object", description: "New card content (full replacement; merge client-side first if you only want to patch)." },
          state: { type: "string", enum: ["draft", "locked"], description: "Set to 'locked' to mark this card ready for assembly. Locked cards can't be edited via this tool — unlock first." },
        },
        required: ["deckId", "cardId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "assemble_deck",
      description: "Assemble a deck into a designed BGP PDF using the template's house style. Every card must be locked first — call update_deck_card with state='locked' on each. Returns a download URL the user can open. Use after a back-and-forth where the deck content is settled.",
      parameters: {
        type: "object",
        properties: {
          deckId: { type: "string", description: "decks.id" },
        },
        required: ["deckId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "list_decks",
      description: "List existing decks, optionally filtered by template, status, property, company, or deal. Use when the user asks 'what decks do I have', 'show me the Why Buy decks', or wants to find a deck to update.",
      parameters: {
        type: "object",
        properties: {
          templateKey: { type: "string", description: "Filter by template (why_buy, am_im, etc.)." },
          status: { type: "string", enum: ["draft", "ready", "archived"] },
          propertyId: { type: "string", description: "Filter by anchor property." },
          companyId: { type: "string", description: "Filter by anchor company." },
          dealId: { type: "string", description: "Filter by anchor deal." },
        },
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "upsert_tenancy_schedule",
      description: "Add or update tenancy schedule rows on a property (one row per let/vacant unit). Use to populate a full tenancy schedule from a brochure, datatape, or the user's notes. Pass the property ID and an array of unit rows. Each row with an `id` updates that row; rows without an `id` are inserted. Search for the property first to get its ID.",
      parameters: {
        type: "object",
        properties: {
          propertyId: { type: "string", description: "crm_properties.id this schedule belongs to" },
          rows: {
            type: "array",
            description: "Tenancy schedule unit rows",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Existing tenancy_schedule_units.id — provide to update, omit to insert" },
                unitNumber: { type: "string", description: "Unit number / reference e.g. 'Unit 4'" },
                premises: { type: "string", description: "Demise / premises e.g. 'Ground Floor'" },
                permittedUse: { type: "string", description: "Permitted use e.g. 'Retail', 'Class E'" },
                tenantName: { type: "string", description: "Tenant legal name. Leave blank/'Vacant' for void units." },
                tradingName: { type: "string", description: "Tenant trading name" },
                leaseStart: { type: "string", description: "Lease start date (ISO YYYY-MM-DD)" },
                leaseExpiry: { type: "string", description: "Lease expiry date (ISO YYYY-MM-DD)" },
                breakDate: { type: "string", description: "Next break date (ISO YYYY-MM-DD)" },
                nextReviewDate: { type: "string", description: "Next rent review date (ISO YYYY-MM-DD)" },
                termYears: { type: "number", description: "Lease term in years" },
                passingRentPa: { type: "number", description: "Passing rent per annum (£)" },
                ervPa: { type: "number", description: "Estimated rental value per annum (£)" },
                niaSqft: { type: "number", description: "Net internal area (sq ft)" },
                giaSqft: { type: "number", description: "Gross internal area (sq ft)" },
                rateableValue: { type: "number", description: "Rateable value (£)" },
                status: { type: "string", description: "e.g. Occupied, Vacant" },
                comments: { type: "string", description: "Free-text commentary for this unit" },
              },
            },
          },
        },
        required: ["propertyId", "rows"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "add_property_imagery",
      description: "Attach one or more images to a property's imagery gallery (hero, internal, floor plan, location plan, etc.). Use after sourcing an image URL or an Image Studio asset for a property. Search for the property first to get its ID.",
      parameters: {
        type: "object",
        properties: {
          propertyId: { type: "string", description: "crm_properties.id to attach imagery to" },
          images: {
            type: "array",
            description: "Images to attach",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["hero", "internal", "secondary_external", "location_plan", "floor_plan", "covenant_card", "comps_chart", "erv_walk", "overlay"], description: "Role this image plays for the property" },
                source: { type: "string", enum: ["brochure", "sharepoint", "street_view", "planning_portal", "os_ngd", "google_static", "edozo", "cad_measure", "image_studio", "generated_chart", "manual_upload"], description: "Where the image came from (provenance)" },
                sourceUrl: { type: "string", description: "Raw image URL for provenance / re-fetch" },
                imageStudioId: { type: "string", description: "image_studio_images.id when the image already lives in Image Studio" },
                caption: { type: "string", description: "Caption / description" },
                score: { type: "number", description: "Relevance ranking 0-1 (higher = more relevant); defaults to 0.6" },
                width: { type: "number", description: "Pixel width if known" },
                height: { type: "number", description: "Pixel height if known" },
                pinned: { type: "boolean", description: "Mark as the definitive image for its kind" },
              },
              required: ["kind", "source"],
            },
          },
        },
        required: ["propertyId", "images"],
      },
    },
  });

  const result = { modelTemplates, docTemplates, tools };
  setCache("availableTools", result, 10 * 60 * 1000);
  return result;
}

async function executeModelRun(args: { templateId: string; name: string; inputValues: Record<string, any> }) {
  const template = await storage.getExcelTemplate(args.templateId);
  if (!template) throw new Error("Model template not found");

  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.readFile(template.filePath);
  const inputMapping = JSON.parse(template.inputMapping || "{}");
  const outputMapping = JSON.parse(template.outputMapping || "{}");

  for (const [key, value] of Object.entries(args.inputValues)) {
    const mapping = inputMapping[key];
    if (mapping) {
      const ws = wb.Sheets[mapping.sheet];
      if (ws) {
        const cellRef = mapping.cell;
        if (!ws[cellRef]) ws[cellRef] = {};
        const numVal = Number(value);
        if (mapping.type === "percent") {
          ws[cellRef] = { t: "n", v: isNaN(numVal) ? 0 : numVal / 100 };
        } else if (mapping.type === "number" && !isNaN(numVal)) {
          ws[cellRef] = { t: "n", v: numVal };
        } else {
          ws[cellRef] = { t: "s", v: String(value) };
        }
      }
    }
  }

  const RUNS_DIR = path.join(process.cwd(), "ChatBGP", "runs");
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });

  const runFileName = `run-${Date.now()}-${args.name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
  const runFilePath = path.join(RUNS_DIR, runFileName);
  XLSX.writeFile(wb, runFilePath);

  const reloadedWb = XLSX.readFile(runFilePath);
  const outputs: Record<string, string> = {};
  for (const [key, mapping] of Object.entries(outputMapping) as any[]) {
    const ws = reloadedWb.Sheets[mapping.sheet];
    if (ws && ws[mapping.cell]) {
      const cell = ws[mapping.cell];
      const raw = cell.v;
      if (mapping.format === "percent") {
        outputs[key] = typeof raw === "number" ? (raw * 100).toFixed(2) + "%" : String(raw);
      } else if (mapping.format === "number2") {
        outputs[key] = typeof raw === "number" ? raw.toFixed(2) : String(raw);
      } else if (mapping.format === "number0") {
        outputs[key] = typeof raw === "number" ? Math.round(raw).toLocaleString() : String(raw);
      } else {
        outputs[key] = String(raw);
      }
    }
  }

  const run = await storage.createExcelModelRun({
    templateId: args.templateId,
    name: args.name,
    inputValues: JSON.stringify(args.inputValues),
    outputValues: JSON.stringify(outputs),
    generatedFilePath: runFilePath,
    status: "completed",
  });

  try {
    const { getAppGraphToken } = await import("./microsoft");
    const msToken = await getAppGraphToken();
    if (msToken) {
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`, { headers: { Authorization: `Bearer ${msToken}` } });
      if (siteRes.ok) {
        const site = await siteRes.json();
        const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, { headers: { Authorization: `Bearer ${msToken}` } });
        if (drivesRes.ok) {
          const drives = await drivesRes.json();
          const bgpDrive = drives.value?.find((d: any) => d.name === "BGP share drive" || d.name === "Documents");
          if (bgpDrive) {
            const fileName = `${(args.name || "model-run").replace(/[^a-zA-Z0-9 _-]/g, "_")}.xlsx`;
            const folderPath = "Models/Live";
            const encoded = encodeURIComponent(folderPath).replace(/%2F/g, "/");
            const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${bgpDrive.id}/root:/${encoded}/${encodeURIComponent(fileName)}:/content`;
            const fileBuffer = fs.readFileSync(runFilePath);
            const uploadRes = await fetch(uploadUrl, {
              method: "PUT",
              headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
              body: fileBuffer,
            });
            if (uploadRes.ok) {
              const uploadResult = await uploadRes.json();
              const { db } = await import("./db");
              const { excelModelRuns } = await import("@shared/schema");
              const { eq } = await import("drizzle-orm");
              await db.update(excelModelRuns).set({
                sharepointUrl: uploadResult.webUrl,
                sharepointDriveItemId: uploadResult.id,
              }).where(eq(excelModelRuns.id, run.id));
              console.log(`[model-run] Auto-synced to SharePoint: ${uploadResult.webUrl}`);
            }
          }
        }
      }
    }
  } catch (spErr: any) {
    console.log(`[model-run] SharePoint auto-sync skipped: ${spErr?.message}`);
  }

  return {
    runId: run.id,
    name: args.name,
    outputs,
    outputMapping,
  };
}

async function executeDocumentGenerate(args: { templateId: string; fieldValues: Record<string, string> }) {
  const template = await storage.getDocumentTemplate(args.templateId);
  if (!template) throw new Error("Document template not found");

  const fields = JSON.parse(template.fields || "[]");
  let content = template.templateContent;

  for (const field of fields) {
    const value = args.fieldValues[field.id] || field.placeholder || "TBC";
    content = content.replace(new RegExp(`\\{\\{${field.id}\\}\\}`, "g"), value);
  }

  return {
    templateName: template.name,
    content,
    fieldsUsed: Object.keys(args.fieldValues).length,
    totalFields: fields.length,
  };
}

async function getTeamMemberMapping(): Promise<Record<string, { name: string; email: string; department: string; role: string }>> {
  const { db } = await import("./db");
  const { users } = await import("@shared/schema");
  const teamMembers = await db.select().from(users);
  const mapping: Record<string, { name: string; email: string; department: string; role: string }> = {};
  for (const u of teamMembers) {
    if (!u.email || !u.email.includes("@brucegillinghampollard.com")) continue;
    const firstName = u.name.split(" ")[0].toLowerCase();
    const lastName = u.name.split(" ").slice(-1)[0].toLowerCase();
    const fullName = u.name.toLowerCase();
    const entry = { name: u.name, email: u.email, department: u.department || "Unknown", role: u.role || "Unknown" };
    mapping[firstName] = entry;
    mapping[lastName] = entry;
    mapping[fullName] = entry;
    mapping[u.email.toLowerCase()] = entry;
    mapping[u.email.split("@")[0].toLowerCase()] = entry;
  }
  return mapping;
}


async function resolveOneDriveShortLink(url: string): Promise<string> {
  if (url.includes("1drv.ms") || url.includes("onedrive.live.com")) {
    try {
      const headRes = await fetch(url, { redirect: "manual" });
      const location = headRes.headers.get("location");
      if (location && location.includes("sharepoint.com")) {
        return location;
      }
    } catch {}
  }
  return url;
}

async function getSharePointDriveId(token: string): Promise<string | null> {
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
  const siteRes = await fetch(siteUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!siteRes.ok) return null;
  const site = await siteRes.json();

  const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`;
  const drivesRes = await fetch(drivesUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!drivesRes.ok) return null;
  const drivesData = await drivesRes.json();
  const docsDrive = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
  return docsDrive?.id || null;
}

async function executeCreateSharePointFolder(
  args: { folderName: string; parentPath?: string },
  token: string | null
): Promise<{ success: boolean; name: string; path: string; webUrl?: string; error?: string }> {
  if (!token) {
    return { success: false, name: args.folderName, path: args.parentPath || "/", error: "Microsoft 365 is not connected. Please connect via the SharePoint page first." };
  }

  const driveId = await getSharePointDriveId(token);
  if (!driveId) {
    return { success: false, name: args.folderName, path: args.parentPath || "/", error: "Could not find the BGP SharePoint site. Check your Microsoft 365 connection." };
  }

  const parentPath = args.parentPath?.trim();
  let createUrl: string;

  if (!parentPath || parentPath === "/" || parentPath === "") {
    createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
  } else {
    const cleanPath = parentPath.replace(/^\/+|\/+$/g, "");
    createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}:/children`;
  }

  console.log(`[ChatBGP] Creating folder "${args.folderName}" at parent "${parentPath || '/'}" -> ${createUrl}`);

  const response = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: args.folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });

  const fullPath = parentPath && parentPath !== "/" ? `${parentPath}/${args.folderName}` : args.folderName;

  if (!response.ok) {
    if (response.status === 409) {
      console.log(`[ChatBGP] Folder already exists: ${fullPath}`);
      return { success: true, name: args.folderName, path: fullPath, error: "Folder already exists (this is fine)" };
    }
    if (response.status === 404) {
      console.log(`[ChatBGP] Parent folder not found: ${parentPath}`);
      return { success: false, name: args.folderName, path: fullPath, error: `Parent folder "${parentPath}" was not found. You may need to create it first.` };
    }
    const errText = await response.text();
    console.error("ChatBGP create folder error:", response.status, errText);
    return { success: false, name: args.folderName, path: fullPath, error: `Failed to create folder (${response.status})` };
  }

  const folder = await response.json();
  return { success: true, name: args.folderName, path: fullPath, webUrl: folder.webUrl };
}

async function executeMoveSharePointItem(
  args: { sourcePath: string; destinationFolderPath: string; newName?: string },
  token: string | null
): Promise<{ success: boolean; name: string; from: string; to: string; webUrl?: string; error?: string }> {
  if (!token) {
    return { success: false, name: "", from: args.sourcePath, to: args.destinationFolderPath, error: "Microsoft 365 is not connected. Please connect via the SharePoint page first." };
  }

  const driveId = await getSharePointDriveId(token);
  if (!driveId) {
    return { success: false, name: "", from: args.sourcePath, to: args.destinationFolderPath, error: "Could not find the BGP SharePoint site." };
  }

  try {
    let sourceItemId: string | null = null;
    let sourceName: string = "";
    const sourcePath = (await resolveOneDriveShortLink(args.sourcePath.trim())).trim();

    if (sourcePath.includes("sharepoint.com") && sourcePath.includes("/:")) {
      const encodedUrl = Buffer.from(sourcePath).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sharingUrl = `u!${encodedUrl}`;
      const driveItemRes = await fetch(
        `https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (driveItemRes.ok) {
        const driveItem = await driveItemRes.json();
        sourceItemId = driveItem.id;
        sourceName = driveItem.name;
      } else {
        return { success: false, name: "", from: sourcePath, to: args.destinationFolderPath, error: `Could not access source item from sharing URL (${driveItemRes.status})` };
      }
    } else {
      const cleanSource = sourcePath.replace(/^\/+|\/+$/g, "");
      const encodedSource = encodeURIComponent(cleanSource).replace(/%2F/g, "/");
      const itemRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedSource}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (itemRes.ok) {
        const item = await itemRes.json();
        sourceItemId = item.id;
        sourceName = item.name;
      } else {
        return { success: false, name: "", from: cleanSource, to: args.destinationFolderPath, error: `Source item not found: ${cleanSource}` };
      }
    }

    if (!sourceItemId) {
      return { success: false, name: sourceName, from: sourcePath, to: args.destinationFolderPath, error: "Could not resolve source item." };
    }

    let destFolderId: string | null = null;
    const destPath = args.destinationFolderPath.trim();

    if (!destPath || destPath === "/") {
      const rootRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (rootRes.ok) {
        const root = await rootRes.json();
        destFolderId = root.id;
      }
    } else {
      const cleanDest = destPath.replace(/^\/+|\/+$/g, "");
      const encodedDest = encodeURIComponent(cleanDest).replace(/%2F/g, "/");
      const destRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedDest}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (destRes.ok) {
        const destItem = await destRes.json();
        if (!destItem.folder) {
          return { success: false, name: sourceName, from: sourcePath, to: destPath, error: `Destination "${cleanDest}" is a file, not a folder.` };
        }
        destFolderId = destItem.id;
      } else {
        return { success: false, name: sourceName, from: sourcePath, to: destPath, error: `Destination folder not found: "${cleanDest}". You may need to create it first.` };
      }
    }

    if (!destFolderId) {
      return { success: false, name: sourceName, from: sourcePath, to: destPath, error: "Could not resolve destination folder." };
    }

    const patchBody: any = {
      parentReference: { driveId, id: destFolderId },
    };
    if (args.newName) {
      patchBody.name = args.newName;
    }

    const moveRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${sourceItemId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      }
    );

    if (!moveRes.ok) {
      const errText = await moveRes.text();
      console.error("SharePoint move error:", moveRes.status, errText);
      if (moveRes.status === 409) {
        return { success: false, name: sourceName, from: sourcePath, to: destPath, error: `An item with the same name already exists in the destination folder.` };
      }
      return { success: false, name: sourceName, from: sourcePath, to: destPath, error: `Failed to move item (${moveRes.status})` };
    }

    const movedItem = await moveRes.json();
    return {
      success: true,
      name: movedItem.name || sourceName,
      from: sourcePath,
      to: destPath,
      webUrl: movedItem.webUrl,
    };
  } catch (err: any) {
    console.error("SharePoint move error:", err?.message);
    return { success: false, name: "", from: args.sourcePath, to: args.destinationFolderPath, error: `Failed to move item: ${err?.message}` };
  }
}

async function browseSharePointFolder(
  url: string,
  token: string
): Promise<{ success: boolean; items?: Array<{ name: string; type: string; size?: number; webUrl: string; driveId?: string; itemId?: string; lastModified?: string }>; error?: string }> {
  try {
    const input = (await resolveOneDriveShortLink(url.trim())).trim();
    const isSharePointLink = input.includes("sharepoint.com") && (input.includes("/:") || input.includes("/sites/"));
    const isDirectPath = !input.startsWith("http");

    let driveId: string | null = null;
    let itemId: string | null = null;

    if (isSharePointLink) {
      const encodedUrl = Buffer.from(input).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sharingUrl = `u!${encodedUrl}`;

      const driveItemRes = await fetch(
        `https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!driveItemRes.ok) {
        return { success: false, error: `Could not access folder (${driveItemRes.status}). The link may require sharing permissions or may have expired.` };
      }

      const driveItem = await driveItemRes.json();
      driveId = driveItem.parentReference?.driveId;
      itemId = driveItem.id;

      if (!driveItem.folder) {
        return { success: false, error: "This link points to a file, not a folder. Use read_sharepoint_file to read file contents." };
      }
    } else if (isDirectPath) {
      const resolvedDriveId = await getSharePointDriveId(token);
      if (!resolvedDriveId) {
        return { success: false, error: "Could not find the BGP SharePoint site." };
      }
      driveId = resolvedDriveId;

      const cleanPath = input.replace(/^\/+|\/+$/g, "");
      if (!cleanPath || cleanPath === "") {
        const rootRes = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/root`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (rootRes.ok) {
          const root = await rootRes.json();
          itemId = root.id;
        } else {
          return { success: false, error: "Could not access the root folder." };
        }
      } else {
        const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, "/");
        const itemRes = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (itemRes.ok) {
          const item = await itemRes.json();
          if (!item.folder) {
            return { success: false, error: `"${cleanPath}" is a file, not a folder. Use read_sharepoint_file to read file contents.` };
          }
          itemId = item.id;
        } else {
          return { success: false, error: `Folder not found at path: "${cleanPath}"` };
        }
      }
    } else {
      return { success: false, error: "Unrecognised URL format. Please provide a SharePoint sharing link or a folder path like 'Investment/Deal Files'." };
    }

    if (!driveId || !itemId) {
      return { success: false, error: "Could not resolve the folder." };
    }

    const childrenRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!childrenRes.ok) {
      return { success: false, error: `Could not list folder contents (${childrenRes.status})` };
    }

    const children = await childrenRes.json();
    const items = (children.value || []).map((child: any) => ({
      name: child.name,
      type: child.folder ? "folder" : "file",
      size: child.size,
      webUrl: child.webUrl,
      driveId,
      itemId: child.id,
      lastModified: child.lastModifiedDateTime,
    }));

    return { success: true, items };
  } catch (err: any) {
    return { success: false, error: `Failed to browse folder: ${err?.message}` };
  }
}

async function browseSharePointFolderByIds(
  driveId: string,
  itemId: string,
  token: string
): Promise<{ success: boolean; items?: Array<{ name: string; type: string; size?: number; webUrl: string; driveId?: string; itemId?: string; lastModified?: string }>; error?: string }> {
  try {
    const childrenRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!childrenRes.ok) {
      return { success: false, error: `Could not list folder contents (${childrenRes.status})` };
    }

    const children = await childrenRes.json();
    const items = (children.value || []).map((child: any) => ({
      name: child.name,
      type: child.folder ? "folder" : "file",
      size: child.size,
      webUrl: child.webUrl,
      driveId,
      itemId: child.id,
      lastModified: child.lastModifiedDateTime,
    }));

    return { success: true, items };
  } catch (err: any) {
    return { success: false, error: `Failed to browse folder: ${err?.message}` };
  }
}

async function browseSharePointFolderRecursive(
  driveId: string,
  itemId: string,
  token: string,
  basePath: string = "",
  maxDepth: number = 3,
  currentDepth: number = 0
): Promise<Array<{ name: string; path: string; type: string; size?: number; webUrl: string; driveId: string; itemId: string; lastModified?: string }>> {
  if (currentDepth >= maxDepth) return [];

  const childrenRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!childrenRes.ok) return [];
  const children = await childrenRes.json();
  const results: any[] = [];

  for (const child of children.value || []) {
    const childPath = basePath ? `${basePath}/${child.name}` : child.name;
    if (child.folder) {
      const subItems = await browseSharePointFolderRecursive(driveId, child.id, token, childPath, maxDepth, currentDepth + 1);
      results.push(...subItems);
    } else {
      results.push({
        name: child.name,
        path: childPath,
        type: "file",
        size: child.size,
        webUrl: child.webUrl,
        driveId,
        itemId: child.id,
        lastModified: child.lastModifiedDateTime,
      });
    }
  }
  return results;
}

async function downloadAndExtractFile(
  driveId: string,
  itemId: string,
  fileName: string,
  token: string
): Promise<string | null> {
  const ext = path.extname(fileName).toLowerCase();
  const supportedExts = [".xlsx", ".xls", ".docx", ".pdf", ".pptx", ".csv", ".tsv", ".txt", ".md", ".markdown", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml", ".rtf"];
  if (!supportedExts.includes(ext)) return null;

  try {
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" }
    );

    if (!contentRes.ok) return null;
    const buffer = Buffer.from(await contentRes.arrayBuffer());

    const tempDir = path.join(process.cwd(), "ChatBGP", "sp-temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `kb-${Date.now()}-${path.basename(fileName)}`);
    try {
      fs.writeFileSync(tempPath, buffer);
    } catch (writeErr: any) {
      console.error("[chatbgp] Failed to write temp file:", writeErr?.message);
      return null;
    }

    try {
      const text = await extractTextFromFile(tempPath, fileName);
      return text;
    } finally {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  } catch {
    return null;
  }
}

async function indexKnowledgeFolder(
  folderUrl: string,
  token: string
): Promise<{ indexed: number; skipped: number; errors: number; files: string[] }> {
  const encodedUrl = Buffer.from(folderUrl).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sharingUrl = `u!${encodedUrl}`;

  const driveItemRes = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!driveItemRes.ok) throw new Error(`Cannot access folder (${driveItemRes.status})`);
  const driveItem = await driveItemRes.json();
  const driveId = driveItem.parentReference?.driveId;
  const itemId = driveItem.id;

  const allFiles = await browseSharePointFolderRecursive(driveId, itemId, token, "");

  let indexed = 0, skipped = 0, errors = 0;
  const fileNames: string[] = [];

  for (const file of allFiles) {
    try {
      const existing = await storage.getKnowledgeBaseByFile(file.path);
      if (existing && existing.indexedAt && file.lastModified) {
        const existingTime = new Date(existing.indexedAt).getTime();
        const fileTime = new Date(file.lastModified).getTime();
        if (fileTime <= existingTime) {
          skipped++;
          continue;
        }
      }

      const content = await downloadAndExtractFile(file.driveId, file.itemId, file.name, token);
      if (!content || content.trim().length < 50) {
        skipped++;
        continue;
      }

      const truncatedContent = content.slice(0, 15000);

      let summary = "";
      let category = "general";
      let tags: string[] = [];

      try {
        const summaryRes = await callClaude({
          model: CHATBGP_HELPER_MODEL,
          messages: [
            {
              role: "system",
              content: `You are an analyst for BGP (Bruce Gillingham Pollard), a London property consultancy. Summarise this document concisely in 2-3 sentences focusing on what it tells us about the business, a property, a deal, a client, or a process. Also provide a category (one of: property_advice, deal_terms, market_analysis, client_communication, internal_process, financial_model, marketing, legal, valuation, other) and up to 5 relevant tags. Respond as JSON: {"summary":"...","category":"...","tags":["..."]}`
            },
            { role: "user", content: `File: ${file.name}\nPath: ${file.path}\n\nContent:\n${truncatedContent.slice(0, 8000)}` }
          ],
          max_completion_tokens: 300,
        });

        let summaryRaw = summaryRes.choices[0]?.message?.content?.trim() || "{}";
        if (summaryRaw.startsWith("```")) summaryRaw = summaryRaw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        const parsed = JSON.parse(summaryRaw);
        summary = parsed.summary || "";
        category = parsed.category || "general";
        tags = parsed.tags || [];
      } catch {
        summary = `Document: ${file.name}`;
      }

      await storage.upsertKnowledgeBaseItem({
        fileName: file.name,
        filePath: file.path,
        fileUrl: file.webUrl,
        folderUrl,
        summary,
        content: truncatedContent,
        category,
        aiTags: tags,
        sizeBytes: file.size,
        lastModified: file.lastModified ? new Date(file.lastModified) : null,
      });

      indexed++;
      fileNames.push(file.name);
      console.log(`[KB] Indexed: ${file.name} (${category})`);
    } catch (err: any) {
      console.error(`[KB] Error indexing ${file.name}:`, err?.message);
      errors++;
    }
  }

  return { indexed, skipped, errors, files: fileNames };
}

export async function getKnowledgeContext(): Promise<string> {
  try {
    const items = await storage.getKnowledgeBaseItems();
    if (!items || items.length === 0) return "";

    // Include up to 20 documents with full summaries (prompt compression freed up space)
    const recentItems = items.slice(0, 20);
    const summaries = recentItems.map(item => {
      const summary = (item.summary || "").slice(0, 300);
      const tags = item.aiTags ? ` [${item.aiTags}]` : "";
      return `- **${item.fileName}**${tags}: ${summary}`;
    }).join("\n");

    return `\n\n## Knowledge Base (${items.length} indexed docs, showing ${recentItems.length} most recent)\n${summaries}`;
  } catch (err) {
    console.error("getKnowledgeContext error:", err);
    return "";
  }
}

async function executeReadSharePointFile(
  args: { url?: string; driveId?: string; itemId?: string },
  token: string | null
): Promise<{ success: boolean; fileName?: string; content?: string; webUrl?: string; error?: string }> {
  if (args.driveId && args.itemId && token) {
    try {
      const itemRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!itemRes.ok) return { success: false, error: `Could not access file (${itemRes.status})` };
      const item = await itemRes.json();
      const fileName = item.name || "unknown";
      const webUrl = item.webUrl || "";

      let downloadUrl = item["@microsoft.graph.downloadUrl"];
      if (!downloadUrl) {
        const contentRes = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${args.driveId}/items/${args.itemId}/content`,
          { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" }
        );
        if (contentRes.status === 302) {
          downloadUrl = contentRes.headers.get("location");
        }
      }
      if (!downloadUrl) return { success: false, error: `Could not get download URL for ${fileName}` };

      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) return { success: false, error: `Download failed (${fileRes.status})` };
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const tmpPath = path.join(process.cwd(), "ChatBGP", `tmp-sp-${Date.now()}-${path.basename(fileName)}`);
      const fsModule = await import("fs");
      const dir = path.dirname(tmpPath);
      if (!fsModule.existsSync(dir)) fsModule.mkdirSync(dir, { recursive: true });
      fsModule.writeFileSync(tmpPath, buffer);
      try {
        const text = await extractTextFromFile(tmpPath, fileName);
        return { success: true, fileName, content: text.slice(0, 30000), webUrl };
      } finally {
        try { fsModule.unlinkSync(tmpPath); } catch {}
      }
    } catch (err: any) {
      return { success: false, error: `Failed to read file: ${err?.message}` };
    }
  }

  const rawUrl = (args.url || "").trim();
  if (!rawUrl) return { success: false, error: "No URL or driveId/itemId provided." };

  const chatMediaMatch = rawUrl.match(/\/api\/chat-media\/([^?\s]+)/);
  if (chatMediaMatch) {
    const mediaFilename = chatMediaMatch[1];
    const mediaPath = path.join(process.cwd(), "ChatBGP", "chat-media", mediaFilename);
    const fsModule = await import("fs");

    if (mediaFilename.includes("..") || mediaFilename.includes("/") || mediaFilename.includes("\\") || mediaFilename.includes("%")) {
      return { success: false, error: "Invalid filename" };
    }

    if (!fsModule.existsSync(mediaPath)) {
      const dbFile = await getFile(`chat-media/${mediaFilename}`);
      if (dbFile && dbFile.data) {
        const dir = path.dirname(mediaPath);
        if (!fsModule.existsSync(dir)) fsModule.mkdirSync(dir, { recursive: true });
        fsModule.writeFileSync(mediaPath, dbFile.data);
      } else {
        const allKeys = await findChatMediaByOriginalName(mediaFilename);
        if (allKeys) {
          const dir = path.dirname(mediaPath);
          if (!fsModule.existsSync(dir)) fsModule.mkdirSync(dir, { recursive: true });
          fsModule.writeFileSync(mediaPath, allKeys.data);
        } else {
          return { success: false, error: `Chat file not found: ${mediaFilename}. The file may have been uploaded in a previous session that wasn't persisted. Please re-upload the file.` };
        }
      }
    }

    const origName = mediaFilename.replace(/^\d+-/, "");
    try {
      const text = await extractTextFromFile(mediaPath, origName);
      return { success: true, fileName: origName, content: text.slice(0, 30000), webUrl: rawUrl };
    } catch (err: any) {
      return { success: false, error: `Could not read chat file ${origName}: ${err?.message}` };
    }
  }

  if (!token) {
    return { success: false, error: "Microsoft 365 is not connected. Please connect via the SharePoint page first." };
  }

  const inputUrl = (await resolveOneDriveShortLink(rawUrl)).trim();
  let downloadUrl: string | null = null;
  let fileName = "unknown";
  let webUrl = inputUrl;

  try {
    const isSharePointLink = inputUrl.includes("sharepoint.com") && inputUrl.includes("/:") ;
    const isOneDrivePersonal = inputUrl.includes("-my.sharepoint.com");
    const isDirectPath = !inputUrl.startsWith("http");

    if (isSharePointLink) {
      const encodedUrl = Buffer.from(inputUrl).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sharingUrl = `u!${encodedUrl}`;

      const driveItemRes = await fetch(
        `https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (driveItemRes.ok) {
        const driveItem = await driveItemRes.json();
        fileName = driveItem.name || "unknown";
        webUrl = driveItem.webUrl || inputUrl;

        if (driveItem["@microsoft.graph.downloadUrl"]) {
          downloadUrl = driveItem["@microsoft.graph.downloadUrl"];
        } else if (driveItem.parentReference?.driveId && driveItem.id) {
          const contentRes = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveItem.parentReference.driveId}/items/${driveItem.id}/content`,
            { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" }
          );
          if (contentRes.status === 302) {
            downloadUrl = contentRes.headers.get("location");
          } else if (contentRes.ok) {
            downloadUrl = `https://graph.microsoft.com/v1.0/drives/${driveItem.parentReference.driveId}/items/${driveItem.id}/content`;
          }
        }
      } else {
        const errText = await driveItemRes.text();
        console.error("SharePoint shares API error:", driveItemRes.status, errText);

        if (isOneDrivePersonal) {
          return {
            success: false,
            error: `Could not access this file. It may be in a personal OneDrive and requires sharing permissions. The link points to: ${inputUrl}`,
          };
        }
        return { success: false, error: `Could not access this SharePoint file (${driveItemRes.status}). It may require additional sharing permissions.` };
      }
    } else if (isDirectPath) {
      const driveId = await getSharePointDriveId(token);
      if (!driveId) {
        return { success: false, error: "Could not find the BGP SharePoint site." };
      }

      const cleanPath = inputUrl.replace(/^\/+|\/+$/g, "");
      const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, "/");
      const itemRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (itemRes.ok) {
        const item = await itemRes.json();
        fileName = item.name || cleanPath.split("/").pop() || "unknown";
        webUrl = item.webUrl || "";

        if (item["@microsoft.graph.downloadUrl"]) {
          downloadUrl = item["@microsoft.graph.downloadUrl"];
        } else {
          downloadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/content`;
        }
      } else {
        return { success: false, error: `File not found at path: ${cleanPath}` };
      }
    } else {
      return { success: false, error: "Unrecognised URL format. Please provide a SharePoint sharing link or a file path like 'Investment/report.xlsx'." };
    }

    if (!downloadUrl) {
      return { success: false, error: "Could not get download URL for this file." };
    }

    const ext = path.extname(fileName).toLowerCase();
    const supportedExts = [".xlsx", ".xls", ".docx", ".pdf", ".pptx", ".csv", ".tsv", ".txt", ".md", ".markdown", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml", ".rtf"];
    if (!supportedExts.includes(ext)) {
      return {
        success: true,
        fileName,
        webUrl,
        content: `This file (${fileName}) is a ${ext || "unknown"} format which I can't read directly. You can open it in your browser: ${webUrl}`,
      };
    }

    const fetchHeaders: Record<string, string> = {};
    if (downloadUrl.includes("graph.microsoft.com")) {
      fetchHeaders["Authorization"] = `Bearer ${token}`;
    }

    const fileRes = await fetch(downloadUrl, { headers: fetchHeaders });
    if (!fileRes.ok) {
      return { success: false, error: `Failed to download file (${fileRes.status})` };
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const tempDir = path.join(process.cwd(), "ChatBGP", "sp-temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `sp-${Date.now()}-${path.basename(fileName)}`);
    try {
      fs.writeFileSync(tempPath, buffer);
    } catch (writeErr: any) {
      console.error("[chatbgp] Failed to write SP temp file:", writeErr?.message);
      return { success: false, error: "Failed to write temporary file for extraction" };
    }

    try {
      const text = await extractTextFromFile(tempPath, fileName);
      const truncated = text.slice(0, 20000);
      return {
        success: true,
        fileName,
        webUrl,
        content: truncated.length < text.length
          ? `${truncated}\n\n[Content truncated — showing first ${truncated.length} of ${text.length} characters]`
          : truncated,
      };
    } finally {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  } catch (err: any) {
    console.error("SharePoint file read error:", err?.message);
    return { success: false, error: `Failed to read file: ${err?.message}` };
  }
}

export async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === ".pdf") {
    const pdfModule = await import("pdf-parse");
    const PDFParseClass = (pdfModule as any).PDFParse || (pdfModule as any).default;
    const buffer = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParseClass(uint8);
    const data = await parser.getText();
    return typeof data === "string" ? data : (data as any).text || String(data);
  }

  if ([".xlsx", ".xls"].includes(ext)) {
    const XLSX = (await import("xlsx")).default;
    const wb = XLSX.readFile(filePath);
    const lines: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      if (csv.trim()) {
        lines.push(`--- Sheet: ${sheetName} ---`);
        lines.push(csv);
      }
    }
    return lines.join("\n");
  }

  if (ext === ".pptx") {
    // PowerPoint: pull each slide's text + tables straight from the OOXML (no
    // external service). Mirrors the universal reader's other formats.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
    const linesOf = (xml: string) => (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [])
      .map((para) => dec((para.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((x) => x.replace(/<\/?a:t>/g, "")).join("")).trim())
      .filter(Boolean);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10));
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

  if ([".csv", ".tsv", ".txt", ".md", ".markdown", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml"].includes(ext)) {
    return fs.readFileSync(filePath, "utf-8");
  }

  if (ext === ".rtf") {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .replace(/\{\\\*[^{}]*\}/g, " ")
      .replace(/\\par[d]?\b/g, "\n")
      .replace(/\\'[0-9a-fA-F]{2}/g, "")
      .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
      .replace(/[{}]/g, "")
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  // Legacy binary Office formats can't be read directly (reading them as text
  // returns garbage), so fail with clear guidance instead.
  if ([".doc", ".ppt", ".pps"].includes(ext)) {
    throw new Error(`Legacy binary ${ext} file — please re-save as ${ext === ".doc" ? ".docx" : ".pptx"} and re-upload; the old binary format can't be read directly.`);
  }

  throw new Error(`Unsupported file format: ${ext}`);
}

const CHAT_UPLOADS_DIR = path.join(process.cwd(), "ChatBGP", "chat-files");

export async function executeCrmToolRaw(
  fnName: string,
  fnArgs: any,
  req: Request
): Promise<{ data: any; action?: any }> {
  const { db } = await import("./db");
  const { pool } = await import("./db");

  if (fnName === "search_crm") {
    const searchScope = req ? await resolveCompanyScope(req).catch(() => null) : null;
    if (searchScope) {
      const rawQ = (fnArgs.query as string || "").trim();
      if (rawQ.length < 2) return { data: { error: "Search term too short", results: {} } };
      return { data: await clientScopedCrmSearch(searchScope, rawQ) };
    }
    const { crmDeals, crmContacts, crmCompanies, crmProperties, investmentTracker, availableUnits } = await import("@shared/schema");
    const { ilike, or } = await import("drizzle-orm");
    const rawQuery = (fnArgs.query as string || "").trim();
    if (rawQuery.length < 2) {
      return { data: { error: "Search term too short", results: {} } };
    }
    const entityType = fnArgs.entityType || "all";
    const results: any = {};
    const words = rawQuery.split(/\s+/).filter((w: string) => w.length >= 2);
    const exactQ = `%${rawQuery}%`;
    const wordPatterns = words.map((w: string) => `%${w}%`);
    const buildOr = (cols: any[]) => {
      const conditions: any[] = [];
      for (const col of cols) {
        conditions.push(ilike(col, exactQ));
        for (const wp of wordPatterns) conditions.push(ilike(col, wp));
      }
      return or(...conditions);
    };
    if (entityType === "all" || entityType === "deals") {
      results.deals = await db.select({ id: crmDeals.id, name: crmDeals.name, groupName: crmDeals.groupName, status: crmDeals.status }).from(crmDeals).where(buildOr([crmDeals.name, crmDeals.comments])).limit(100);
    }
    if (entityType === "all" || entityType === "contacts") {
      results.contacts = await db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, role: crmContacts.role }).from(crmContacts).where(buildOr([crmContacts.name, crmContacts.email])).limit(100);
    }
    if (entityType === "all" || entityType === "companies") {
      const { and: andOp, eq: eqOp, ne: neOp } = await import("drizzle-orm");
      results.companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType }).from(crmCompanies).where(andOp(buildOr([crmCompanies.name]), neOp(crmCompanies.aiDisabled, true))).limit(100);
    }
    if (entityType === "all" || entityType === "properties") {
      const { sql: sqlTag } = await import("drizzle-orm");
      const addressText = sqlTag`${crmProperties.address}::text`;
      const propConditions: any[] = [];
      propConditions.push(ilike(crmProperties.name, exactQ));
      for (const wp of wordPatterns) propConditions.push(ilike(crmProperties.name, wp));
      propConditions.push(sqlTag`${addressText} ILIKE ${exactQ}`);
      for (const wp of wordPatterns) propConditions.push(sqlTag`${addressText} ILIKE ${wp}`);
      results.properties = await db.select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status, address: crmProperties.address }).from(crmProperties).where(or(...propConditions)).limit(100);
    }
    if (entityType === "all" || entityType === "investment") {
      results.investmentTracker = await db.select({ id: investmentTracker.id, assetName: investmentTracker.assetName, address: investmentTracker.address, status: investmentTracker.status, boardType: investmentTracker.boardType, client: investmentTracker.client }).from(investmentTracker).where(buildOr([investmentTracker.assetName, investmentTracker.address, investmentTracker.client, investmentTracker.vendor])).limit(100);
    }
    if (entityType === "all" || entityType === "units") {
      const { eq: eqUnits } = await import("drizzle-orm");
      results.availableUnits = await db
        .select({ id: availableUnits.id, unitName: availableUnits.unitName, marketingStatus: availableUnits.marketingStatus, propertyId: availableUnits.propertyId, propertyName: crmProperties.name })
        .from(availableUnits)
        .leftJoin(crmProperties, eqUnits(availableUnits.propertyId, crmProperties.id))
        .where(buildOr([availableUnits.unitName, crmProperties.name]))
        .limit(100);
    }
    if (entityType === "all" || entityType === "requirements") {
      const reqConds = [exactQ, ...wordPatterns].map((p, i) => `(company_name ILIKE $${i+1} OR contact_name ILIKE $${i+1} OR location ILIKE $${i+1} OR notes ILIKE $${i+1})`);
      const reqParams = [exactQ, ...wordPatterns];
      const reqResult = await pool.query(`SELECT id, category, company_name AS "companyName", contact_name AS "contactName", location, status, priority FROM requirements WHERE ${reqConds.join(" OR ")} LIMIT 100`, reqParams);
      results.requirements = reqResult.rows;
    }
    if (entityType === "all" || entityType === "comps") {
      const { crmComps } = await import("@shared/schema");
      results.comps = await db.select({ id: crmComps.id, name: crmComps.name, tenant: crmComps.tenant, landlord: crmComps.landlord, dealType: crmComps.dealType, headlineRent: crmComps.headlineRent, completionDate: crmComps.completionDate }).from(crmComps).where(buildOr([crmComps.name, crmComps.tenant, crmComps.landlord])).limit(100);
    }
    const totalFound = Object.values(results).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
    return { data: { success: true, query: fnArgs.query, totalFound, results } };
  }

  if (fnName === "get_brand_profile") {
    let companyId: string | null = fnArgs.companyId || null;
    if (!companyId && fnArgs.name) {
      const found = await pool.query(
        `SELECT id FROM crm_companies WHERE lower(name) = lower($1) AND merged_into_id IS NULL LIMIT 1`,
        [String(fnArgs.name).trim()]
      );
      if (!found.rows[0]) {
        const fuzzy = await pool.query(
          `SELECT id, name FROM crm_companies
             WHERE name ILIKE $1 AND merged_into_id IS NULL
             ORDER BY CASE WHEN company_type ILIKE 'tenant%' THEN 0 ELSE 1 END
             LIMIT 5`,
          [`%${String(fnArgs.name).trim()}%`]
        );
        if (!fuzzy.rows.length) return { data: { success: false, error: `No brand found matching "${fnArgs.name}"` } };
        if (fuzzy.rows.length > 1) return { data: { success: false, error: "Multiple matches", candidates: fuzzy.rows } };
        companyId = fuzzy.rows[0].id;
      } else {
        companyId = found.rows[0].id;
      }
    }
    if (!companyId) return { data: { success: false, error: "Provide companyId or name" } };

    // Reuse the brand-profile endpoint directly — proxy via HTTP to keep one
    // source of truth. Bypasses requireAuth by calling the internal host.
    try {
      const port = process.env.PORT || "5000";
      const res = await fetch(`http://127.0.0.1:${port}/api/brand/${companyId}/profile`, {
        headers: { cookie: req.headers.cookie || "", authorization: req.headers.authorization || "" },
      });
      if (!res.ok) return { data: { success: false, error: `brand-profile ${res.status}` } };
      const full = await res.json();
      // Trim for LLM: keep the decision-relevant fields, drop raw CH blobs + images
      return {
        data: {
          success: true,
          company: {
            id: full.company.id,
            name: full.company.name,
            description: full.company.description,
            conceptPitch: full.company.concept_pitch,
            storeCount: full.company.store_count,
            rolloutStatus: full.company.rollout_status,
            backers: full.company.backers,
            leadBroker: full.company.bgp_contact_crm,
            industry: full.company.industry,
            annualRevenue: full.company.annual_revenue,
          },
          covenant: full.covenant,
          rolloutVelocity: full.rolloutVelocity,
          rentAffordability: full.rentAffordability,
          turnover: full.turnover,
          kyc: full.kyc,
          parentGroup: full.parentGroup,
          siblings: full.siblings?.slice(0, 10),
          contactsSummary: {
            total: full.contacts?.length || 0,
            lastTouchedAt: full.contacts?.[0]?.last_contacted_at || null,
            sample: full.contacts?.slice(0, 5).map((ct: any) => ({
              name: ct.name, role: ct.role, email: ct.email, lastContactedAt: ct.last_contacted_at,
            })),
          },
          completedDealsCount: full.completedDeals?.length || 0,
          activeDealsCount: full.activeDeals?.length || 0,
          activeDeals: full.activeDeals?.slice(0, 10).map((d: any) => ({ id: d.id, name: d.name, stage: d.stage, role: d.role })),
          requirements: full.requirements?.filter((r: any) => r.status === "Active").slice(0, 10),
          pitchedTo: full.pitchedTo?.slice(0, 15).map((p: any) => ({
            propertyId: p.property_id, propertyName: p.property_name, unit: p.unit_name, status: p.status,
          })),
          signals: full.signals?.slice(0, 15).map((s: any) => ({
            type: s.signal_type, magnitude: s.magnitude, sentiment: s.sentiment,
            headline: s.headline, date: s.signal_date, source: s.source,
          })),
          representedBy: full.representedBy?.map((r: any) => ({ agent: r.agent_name, type: r.agent_type, region: r.region })),
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: err?.message || "Failed to fetch brand profile" } };
    }
  }

  if (fnName === "update_investment_tracker") {
    const { investmentTracker } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const existing = await db.select({ id: investmentTracker.id, assetName: investmentTracker.assetName }).from(investmentTracker).where(eq(investmentTracker.id, id)).limit(1);
    if (!existing.length) {
      return { data: { success: false, error: `No investment tracker item found with ID "${id}"` } };
    }
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    cleanUpdates.updatedAt = new Date();
    await db.update(investmentTracker).set(cleanUpdates).where(eq(investmentTracker.id, id));
    return { data: { success: true, action: "updated", entity: "investment tracker item", name: existing[0].assetName, fields: Object.keys(cleanUpdates) }, action: { type: "crm_updated", entityType: "investment", id } };
  }

  if (fnName === "update_deal") {
    const { crmDeals } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    await db.update(crmDeals).set(cleanUpdates).where(eq(crmDeals.id, id));
    return { data: { success: true, action: "updated", entity: "deal", id, fields: Object.keys(cleanUpdates) }, action: { type: "crm_updated", entityType: "deal", id } };
  }

  if (fnName === "update_contact") {
    const { crmContacts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    await db.update(crmContacts).set(cleanUpdates).where(eq(crmContacts.id, id));
    return { data: { success: true, action: "updated", entity: "contact", id, fields: Object.keys(cleanUpdates) }, action: { type: "crm_updated", entityType: "contact", id } };
  }

  if (fnName === "update_company") {
    const { crmCompanies } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    await db.update(crmCompanies).set(cleanUpdates).where(eq(crmCompanies.id, id));
    return { data: { success: true, action: "updated", entity: "company", id, fields: Object.keys(cleanUpdates) }, action: { type: "crm_updated", entityType: "company", id } };
  }

  if (fnName === "get_company_accounts") {
    const companyName = fnArgs.companyName as string | undefined;
    const companyNumber = fnArgs.companyNumber ? String(fnArgs.companyNumber).trim().toUpperCase() : undefined;
    let cid = fnArgs.companyId as string | undefined;

    // Companies House number path — works for companies not yet in the CRM.
    // A minimal record is created (or the number attached to a name match)
    // so the downloaded filing is banked against a real company row.
    if (!cid && companyNumber) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM crm_companies WHERE UPPER(companies_house_number) = $1 LIMIT 1`,
        [companyNumber]
      );
      cid = rows[0]?.id;
      if (!cid && companyName) {
        const { rows: byName } = await pool.query<{ id: string }>(
          `UPDATE crm_companies SET companies_house_number = $1
            WHERE id = (SELECT id FROM crm_companies WHERE LOWER(name) LIKE LOWER($2) AND companies_house_number IS NULL LIMIT 1)
            RETURNING id`,
          [companyNumber, `%${companyName}%`]
        );
        cid = byName[0]?.id;
      }
      if (!cid) {
        const { rows: created } = await pool.query<{ id: string }>(
          `INSERT INTO crm_companies (name, companies_house_number) VALUES ($1, $2) RETURNING id`,
          [companyName || `Company ${companyNumber}`, companyNumber]
        );
        cid = created[0]?.id;
      }
    }

    // Resolve the CRM company id by name if not supplied.
    if (!cid && companyName) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM crm_companies
          WHERE LOWER(name) LIKE LOWER($1)
            AND companies_house_number IS NOT NULL
          LIMIT 1`,
        [`%${companyName}%`]
      );
      cid = rows[0]?.id;
    }
    if (!cid) return { data: { error: "Company not found in CRM. Pass companyNumber (the Companies House number, e.g. from deep_investigate) and the record will be created automatically." } };

    const { fetchLatestAccountsForCompany, extractAccountsFigures } = await import("./ch-accounts");
    let fetchStatus: string;
    try {
      const fetchResult = await fetchLatestAccountsForCompany(cid);
      fetchStatus = fetchResult.status;
    } catch (err: any) {
      fetchStatus = `fetch_error: ${err?.message || err}`;
    }

    const figures = await extractAccountsFigures(cid);
    if (!figures) {
      return { data: { error: "Could not read the accounts — no PDF on file, or extraction failed.", fetchStatus } };
    }

    const { rawText, ...summary } = figures;
    return { data: { companyId: cid, fetchStatus, ...summary } };
  }

  if (fnName === "create_deal") {
    const { crmDeals } = await import("@shared/schema");
    const [created] = await db.insert(crmDeals).values({
      name: fnArgs.name,
      propertyId: fnArgs.propertyId || null,
      landlordId: fnArgs.landlordId || null,
      tenantId: fnArgs.tenantId || null,
      vendorId: fnArgs.vendorId || null,
      purchaserId: fnArgs.purchaserId || null,
      team: fnArgs.team || [],
      groupName: fnArgs.groupName || "New Instructions",
      dealType: fnArgs.dealType,
      status: fnArgs.status,
      pricing: fnArgs.pricing,
      fee: fnArgs.fee,
      rentPa: fnArgs.rentPa,
      totalAreaSqft: fnArgs.totalAreaSqft,
      comments: fnArgs.comments,
    }).returning();
    return { data: { success: true, action: "created", entity: "deal", id: created.id, name: created.name }, action: { type: "crm_created", entityType: "deal", id: created.id } };
  }

  if (fnName === "create_contact") {
    const { crmContacts } = await import("@shared/schema");
    const [created] = await db.insert(crmContacts).values({
      name: fnArgs.name,
      email: fnArgs.email,
      phone: fnArgs.phone,
      role: fnArgs.role,
      companyName: fnArgs.companyName,
      contactType: fnArgs.contactType,
      notes: fnArgs.notes,
    }).returning();
    return { data: { success: true, action: "created", entity: "contact", id: created.id, name: created.name }, action: { type: "crm_created", entityType: "contact", id: created.id } };
  }

  if (fnName === "create_company") {
    const { crmCompanies } = await import("@shared/schema");
    const [created] = await db.insert(crmCompanies).values({
      name: fnArgs.name,
      companyType: fnArgs.companyType,
      description: fnArgs.description,
      domain: fnArgs.domain,
      groupName: fnArgs.groupName,
    }).returning();
    return { data: { success: true, action: "created", entity: "company", id: created.id, name: created.name }, action: { type: "crm_created", entityType: "company", id: created.id } };
  }

  if (fnName === "create_investment_tracker") {
    const { investmentTracker, crmProperties } = await import("@shared/schema");
    let propertyId: string;
    const [existingProp] = await db.select().from(crmProperties).where(eq(crmProperties.name, fnArgs.assetName)).limit(1);
    if (existingProp) {
      propertyId = existingProp.id;
    } else {
      const [newProp] = await db.insert(crmProperties).values({
        name: fnArgs.assetName,
        address: fnArgs.address ? { street: fnArgs.address } : null,
        tenure: fnArgs.tenure || null,
      }).returning();
      propertyId = newProp.id;
    }
    const [created] = await db.insert(investmentTracker).values({
      propertyId,
      assetName: fnArgs.assetName, address: fnArgs.address, status: fnArgs.status || "Reporting",
      boardType: fnArgs.boardType || "Purchases", client: fnArgs.client, clientContact: fnArgs.clientContact,
      vendor: fnArgs.vendor, vendorAgent: fnArgs.vendorAgent, guidePrice: fnArgs.guidePrice,
      niy: fnArgs.niy, eqy: fnArgs.eqy, sqft: fnArgs.sqft, currentRent: fnArgs.currentRent,
      ervPa: fnArgs.ervPa, waultBreak: fnArgs.waultBreak, waultExpiry: fnArgs.waultExpiry,
      occupancy: fnArgs.occupancy, capexRequired: fnArgs.capexRequired,
      tenure: fnArgs.tenure, fee: fnArgs.fee, feeType: fnArgs.feeType, notes: fnArgs.notes,
    }).returning();
    return { data: { success: true, action: "created", entity: "investment tracker item", id: created.id, name: created.assetName }, action: { type: "crm_created", entityType: "investment", id: created.id } };
  }

  if (fnName === "create_available_unit") {
    const { availableUnits } = await import("@shared/schema");
    const [created] = await db.insert(availableUnits).values({
      propertyId: fnArgs.propertyId, unitName: fnArgs.unitName, floor: fnArgs.floor,
      sqft: fnArgs.sqft, askingRent: fnArgs.askingRent, ratesPa: fnArgs.ratesPa,
      serviceChargePa: fnArgs.serviceChargePa, useClass: fnArgs.useClass, condition: fnArgs.condition,
      location: fnArgs.location, availableDate: fnArgs.availableDate, marketingStatus: fnArgs.marketingStatus || "Available",
      epcRating: fnArgs.epcRating, notes: fnArgs.notes, fee: fnArgs.fee,
    }).returning();
    return { data: { success: true, action: "created", entity: "available unit", id: created.id, name: created.unitName }, action: { type: "crm_created", entityType: "unit", id: created.id } };
  }

  if (fnName === "find_duplicate_properties") {
    const { findDuplicateProperties } = await import("./property-merge");
    const groups = await findDuplicateProperties(fnArgs.name || undefined);
    if (groups.length === 0) {
      return { data: { success: true, duplicates: [], note: fnArgs.name ? `No duplicate properties matching "${fnArgs.name}"` : "No duplicate properties found" } };
    }
    return { data: { success: true, duplicates: groups, instruction: "Present each group to the user with the linked-record counts (deals/units/files) per record, recommend which to keep (usually the one with more linked data), and get explicit confirmation before calling merge_properties." } };
  }

  if (fnName === "merge_properties") {
    const { mergeProperties } = await import("./property-merge");
    try {
      const result = await mergeProperties(String(fnArgs.keepPropertyId || ""), String(fnArgs.mergePropertyId || ""));
      return {
        data: { success: true, ...result },
        action: { type: "crm_updated", entityType: "property", id: result.keptId },
      };
    } catch (e: any) {
      return { data: { success: false, error: e?.message || "Merge failed" } };
    }
  }

  if (fnName === "run_brand_enrichment_backfill") {
    const { runLogoDevBackfill, isLogoDevBrandConfigured } = await import("./logo-dev-brand");
    if (!(await isLogoDevBrandConfigured())) {
      return { data: { success: false, error: "The logo.dev Brand API secret key (sk_...) isn't configured. An admin can paste it on Subscriptions & APIs → logo.dev Brand API (desktop, admin sidebar) — it takes effect within a minute, no restart needed." } };
    }
    try {
      const stats = await runLogoDevBackfill(
        Number(fnArgs.limit ?? 100),
        fnArgs.hospitalityOnly === true
      );
      return {
        data: {
          success: true, ...stats,
          instruction: "Report: how many brands were candidates, how many got fields filled, and that re-running later picks up brands logo.dev hadn't indexed yet.",
        },
      };
    } catch (e: any) {
      return { data: { success: false, error: e?.message || "Backfill failed" } };
    }
  }

  if (fnName === "reconcile_tenancy_rows") {
    const { reconcileTenancyRows } = await import("./tenancy-reconcile");
    try {
      const report = await reconcileTenancyRows({
        propertyId: fnArgs.propertyId ? String(fnArgs.propertyId) : null,
        apply: fnArgs.apply === true,
      });
      // Keep the tool payload compact for big books — the model summarises,
      // the user doesn't need 1,000 raw merge rows in context.
      const sample = report.merges.slice(0, 25);
      return {
        data: {
          success: true,
          applied: report.applied,
          rowsScanned: report.rowsScanned,
          duplicateGroups: report.duplicateGroups,
          mergeCount: report.merges.length,
          mergesSample: sample,
          ambiguousCount: report.ambiguous.length,
          ambiguous: report.ambiguous.slice(0, 25),
          coverage: report.coverage,
          instruction: report.applied
            ? "Report what was merged and the new rent+expiry coverage."
            : "Summarise for the user: how many rows would merge, projected rent+expiry coverage before → after, and list the ambiguous groups needing a human decision. Ask for explicit confirmation before calling again with apply=true.",
        },
      };
    } catch (e: any) {
      return { data: { success: false, error: e?.message || "Reconcile failed" } };
    }
  }

  if (fnName === "create_targeting_brief") {
    const { availableUnits, unitBriefs, unitTargetOperators } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [unit] = await db.select().from(availableUnits).where(eq(availableUnits.id, fnArgs.unitId)).limit(1);
    if (!unit) return { data: { success: false, error: `No available unit found with ID "${fnArgs.unitId}". Search available units first.` } };

    const briefScope = req ? await resolveCompanyScope(req).catch(() => null) : null;
    if (briefScope && !(await isPropertyInScope(briefScope, unit.propertyId))) {
      return { data: { success: false, error: "That unit is not part of your portfolio, so a brief can't be created for it from this account." } };
    }

    const userId = (req as any)?.session?.userId || (req as any)?.tokenUserId || null;
    let userName: string | null = null;
    let clientCompany: string | null = fnArgs.clientCompany || null;
    if (userId) {
      const user = await storage.getUser(userId);
      userName = user?.name || null;
      if (!clientCompany && user?.email && !user.email.toLowerCase().endsWith("@brucegillinghampollard.com")) {
        clientCompany = user.team || null;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const [brief] = await db.insert(unitBriefs).values({
      unitId: unit.id,
      propertyId: unit.propertyId,
      clientCompany,
      title: fnArgs.title || `Operator Targeting Brief — ${unit.unitName}`,
      objective: fnArgs.objective,
      locationContext: fnArgs.locationContext,
      targetCriteria: fnArgs.targetCriteria,
      priorityCategories: fnArgs.priorityCategories,
      agentInstruction: fnArgs.agentInstruction,
      successMeasures: fnArgs.successMeasures,
      instructedDate: fnArgs.instructedDate || today,
      deadline1Date: fnArgs.deadline1Date,
      deadline1Deliverables: fnArgs.deadline1Deliverables,
      deadline2Date: fnArgs.deadline2Date,
      deadline2Deliverables: fnArgs.deadline2Deliverables,
      minTargets: fnArgs.minTargets ?? 5,
      priorityTargets: fnArgs.priorityTargets ?? 2,
      createdByUserId: userId,
      createdByName: userName,
    }).returning();

    const targetsIn: any[] = Array.isArray(fnArgs.targets) ? fnArgs.targets : [];
    for (let i = 0; i < targetsIn.length; i++) {
      const t = targetsIn[i];
      if (!t?.operatorName) continue;
      await db.insert(unitTargetOperators).values({
        briefId: brief.id,
        operatorName: t.operatorName,
        category: t.category || null,
        priority: t.priority === "A" ? "A" : "B",
        rationale: t.rationale || null,
        sortOrder: i,
      });
    }

    let docResult: any = null;
    try {
      const { generateBriefDocument } = await import("./unit-brief-doc");
      docResult = await generateBriefDocument(brief.id);
    } catch (err: any) {
      console.warn("[chatbgp] Brief document generation failed:", err?.message);
    }

    return {
      data: {
        success: true,
        action: "created",
        entity: "targeting brief",
        id: brief.id,
        unit: unit.unitName,
        targetsAdded: targetsIn.length,
        ...(docResult ? {
          downloadUrl: docResult.downloadUrl,
          filename: docResult.fileName,
          sharepointUrl: docResult.sharepointUrl || null,
          downloadMarkdown: `[Download ${docResult.fileName}](${docResult.downloadUrl})`,
          instruction: "IMPORTANT: Include the downloadMarkdown text EXACTLY as-is in your response so the user can download the brief document. Mention it is also saved on the unit's Letting Tracker files" + (docResult.sharepointUrl ? " and filed in the scheme's SharePoint folder." : "."),
        } : { documentNote: "Brief saved, but document generation failed — it can be regenerated from the Letting Tracker." }),
      },
      action: { type: "crm_created", entityType: "unit_brief", id: brief.id },
    };
  }

  if (fnName === "update_available_unit") {
    const { availableUnits } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const existing = await db.select({ id: availableUnits.id, unitName: availableUnits.unitName }).from(availableUnits).where(eq(availableUnits.id, id)).limit(1);
    if (!existing.length) return { data: { success: false, error: `No available unit found with ID "${id}"` } };
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) { if (v !== undefined && v !== null) cleanUpdates[k] = v; }
    cleanUpdates.updatedAt = new Date();
    await db.update(availableUnits).set(cleanUpdates).where(eq(availableUnits.id, id));
    return { data: { success: true, action: "updated", entity: "available unit", id, name: existing[0].unitName, fields: Object.keys(cleanUpdates) }, action: { type: "crm_updated", entityType: "unit", id } };
  }

  if (fnName === "log_viewing") {
    if (fnArgs.entityType === "investment") {
      const { investmentViewings } = await import("@shared/schema");
      await db.insert(investmentViewings).values({
        trackerId: fnArgs.entityId, company: fnArgs.company, contact: fnArgs.contact,
        viewingDate: fnArgs.viewingDate ? new Date(fnArgs.viewingDate) : new Date(),
        attendees: fnArgs.attendees, notes: fnArgs.notes, outcome: fnArgs.outcome,
      });
    } else {
      const { unitViewings } = await import("@shared/schema");
      await db.insert(unitViewings).values({
        unitId: fnArgs.entityId, companyName: fnArgs.company, contactName: fnArgs.contact,
        viewingDate: fnArgs.viewingDate, viewingTime: fnArgs.viewingTime,
        attendees: fnArgs.attendees, notes: fnArgs.notes, outcome: fnArgs.outcome,
      });
    }
    return { data: { success: true, action: "logged", entity: `${fnArgs.entityType} viewing`, company: fnArgs.company, date: fnArgs.viewingDate } };
  }

  if (fnName === "log_offer") {
    if (fnArgs.entityType === "investment") {
      const { investmentOffers } = await import("@shared/schema");
      await db.insert(investmentOffers).values({
        trackerId: fnArgs.entityId, company: fnArgs.company, contact: fnArgs.contact,
        offerDate: fnArgs.offerDate ? new Date(fnArgs.offerDate) : new Date(),
        offerPrice: fnArgs.offerPrice, niy: fnArgs.niy, conditions: fnArgs.conditions,
        status: fnArgs.status || "Pending", notes: fnArgs.notes,
      });
    } else {
      const { unitOffers } = await import("@shared/schema");
      await db.insert(unitOffers).values({
        unitId: fnArgs.entityId, companyName: fnArgs.company, contactName: fnArgs.contact,
        offerDate: fnArgs.offerDate, rentPa: fnArgs.rentPa, rentFreeMonths: fnArgs.rentFreeMonths,
        termYears: fnArgs.termYears, breakOption: fnArgs.breakOption, incentives: fnArgs.incentives,
        premium: fnArgs.premium, fittingOutContribution: fnArgs.fittingOutContribution,
        status: fnArgs.status || "Pending", comments: fnArgs.notes,
      });
    }
    return { data: { success: true, action: "logged", entity: `${fnArgs.entityType} offer`, company: fnArgs.company } };
  }

  if (fnName === "create_property") {
    const { crmProperties } = await import("@shared/schema");
    const created = await db.insert(crmProperties).values({
      name: fnArgs.name,
      address: fnArgs.address || null,
      postcode: fnArgs.postcode || fnArgs.address?.postcode || null,
      latitude: fnArgs.latitude || null,
      longitude: fnArgs.longitude || null,
      agent: fnArgs.agent || null,
      assetClass: fnArgs.assetClass || null,
      tenure: fnArgs.tenure || null,
      sqft: fnArgs.sqft || null,
      status: fnArgs.status || "Active",
      notes: fnArgs.notes || null,
      website: fnArgs.website || null,
      tags: fnArgs.tags || null,
      groupName: fnArgs.groupName || null,
      titleNumber: fnArgs.titleNumber || null,
      competitorAgent: fnArgs.competitorAgent || null,
      folderTeams: fnArgs.folderTeams || null,
    }).returning();

    const propertyId = created[0].id;
    const postcode = fnArgs.address?.postcode || fnArgs.postcode;
    const willEnrich = !!(postcode && fnArgs.autoEnrich !== false);
    if (willEnrich) {
      const baseUrl = process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 5000}`;
      fetch(`${baseUrl}/api/title-search/auto-fill-from-postcode/${propertyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcode }),
        signal: AbortSignal.timeout(120000),
      }).then(async (enrichRes) => {
        if (!enrichRes.ok) {
          console.log(`[chatbgp] Auto-enrich HTTP ${enrichRes.status} for ${created[0].name}`);
          return;
        }
        try {
          const enrichResult = await enrichRes.json();
          console.log(`[chatbgp] Auto-enrich for ${created[0].name}:`, JSON.stringify(enrichResult).substring(0, 300));
        } catch (parseErr: any) {
          console.log(`[chatbgp] Auto-enrich parse error for ${created[0].name}: ${parseErr.message}`);
        }
      }).catch((err: any) => {
        console.log(`[chatbgp] Auto-enrich failed for ${created[0].name}: ${err.message}`);
      });
    }

    return {
      data: {
        success: true,
        action: "created",
        entity: "property",
        id: propertyId,
        name: created[0].name,
        enrichment: willEnrich ? { status: "running_in_background", message: "Land Registry lookup and owner identification is running in the background. The property page will update automatically when complete." } : null,
      },
      action: { type: "crm_created", entityType: "property", id: propertyId },
    };
  }

  if (fnName === "create_requirement") {
    const { pool } = await import("./db");
    const { v4: uuid } = await import("uuid");
    const id = uuid();
    await pool.query(
      `INSERT INTO requirements (id, category, company_name, contact_name, size_min, size_max, budget, location, status, notes, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, fnArgs.category, fnArgs.companyName, fnArgs.contactName || null, fnArgs.sizeMin || null, fnArgs.sizeMax || null, fnArgs.budget || null, fnArgs.location || null, "active", fnArgs.notes || null, fnArgs.priority || "medium"]
    );
    return { data: { success: true, action: "created", entity: "requirement", id, category: fnArgs.category, company: fnArgs.companyName } };
  }

  if (fnName === "create_diary_entry") {
    const { diaryEntries } = await import("@shared/schema");
    const created = await db.insert(diaryEntries).values({
      title: fnArgs.title,
      person: fnArgs.person,
      project: fnArgs.project || null,
      day: fnArgs.day,
      time: fnArgs.time,
      type: fnArgs.type || "meeting",
    }).returning();
    return { data: { success: true, action: "created", entity: "diary entry", id: created[0].id, title: created[0].title, day: fnArgs.day, time: fnArgs.time } };
  }

  if (fnName === "update_property") {
    const { crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const existing = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, id)).limit(1);
    if (!existing.length) return { data: { success: false, error: `No property found with ID "${id}"` } };
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) { if (v !== undefined && v !== null) cleanUpdates[k] = v; }
    if (Object.keys(cleanUpdates).length === 0) return { data: { success: false, error: "No fields to update" } };
    await db.update(crmProperties).set(cleanUpdates).where(eq(crmProperties.id, id));
    return { data: { success: true, action: "updated", entity: "property", id, name: existing[0].name, fields: Object.keys(cleanUpdates) }, action: { type: "crm_updated", entityType: "property", id } };
  }

  if (fnName === "upsert_tenancy_schedule") {
    const { tenancyScheduleUnits, crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const propertyId = fnArgs.propertyId as string;
    const rows: any[] = Array.isArray(fnArgs.rows) ? fnArgs.rows : [];
    const prop = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, propertyId)).limit(1);
    if (!prop.length) return { data: { success: false, error: `No property found with ID "${propertyId}"` } };
    if (!rows.length) return { data: { success: false, error: "No tenancy rows provided" } };
    const toDate = (v: any) => (v ? new Date(v) : null);
    let inserted = 0, updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const values: any = {
        propertyId,
        unitNumber: r.unitNumber ?? null, premises: r.premises ?? null, permittedUse: r.permittedUse ?? null,
        tenantName: r.tenantName ?? null, tradingName: r.tradingName ?? null,
        leaseStart: toDate(r.leaseStart), leaseExpiry: toDate(r.leaseExpiry), breakDate: toDate(r.breakDate), nextReviewDate: toDate(r.nextReviewDate),
        termYears: r.termYears ?? null, passingRentPa: r.passingRentPa ?? null, ervPa: r.ervPa ?? null,
        niaSqft: r.niaSqft ?? null, giaSqft: r.giaSqft ?? null, rateableValue: r.rateableValue ?? null,
        status: r.status ?? (r.tenantName && String(r.tenantName).toLowerCase() !== "vacant" ? "Occupied" : "Vacant"),
        comments: r.comments ?? null,
      };
      if (r.id) {
        const clean: any = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(values)) { if (v !== undefined && v !== null && k !== "propertyId") clean[k] = v; }
        await db.update(tenancyScheduleUnits).set(clean).where(eq(tenancyScheduleUnits.id, r.id));
        updated++;
      } else {
        values.sortOrder = i;
        await db.insert(tenancyScheduleUnits).values(values);
        inserted++;
      }
    }
    return { data: { success: true, action: "upserted", entity: "tenancy schedule", propertyId, name: prop[0].name, inserted, updated }, action: { type: "crm_updated", entityType: "property", id: propertyId } };
  }

  if (fnName === "add_property_imagery") {
    const { propertyImageryAssets, crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const propertyId = fnArgs.propertyId as string;
    const images: any[] = Array.isArray(fnArgs.images) ? fnArgs.images : [];
    const prop = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, propertyId)).limit(1);
    if (!prop.length) return { data: { success: false, error: `No property found with ID "${propertyId}"` } };
    if (!images.length) return { data: { success: false, error: "No images provided" } };
    let added = 0;
    for (const img of images) {
      if (!img?.kind || !img?.source) continue;
      await db.insert(propertyImageryAssets).values({
        propertyId, kind: img.kind, source: img.source,
        sourceUrl: img.sourceUrl ?? null, imageStudioId: img.imageStudioId ?? null,
        caption: img.caption ?? null, score: img.score ?? 0.6,
        width: img.width ?? null, height: img.height ?? null, pinned: img.pinned ?? false,
        generatedBy: req.session?.userId || (req as any).tokenUserId || null,
      } as any);
      added++;
    }
    return { data: { success: true, action: "added", entity: "property imagery", propertyId, name: prop[0].name, added }, action: { type: "crm_updated", entityType: "property", id: propertyId } };
  }

  if (fnName === "update_requirement") {
    const fieldMap: Record<string, string> = { category: "category", companyName: "company_name", contactName: "contact_name", sizeMin: "size_min", sizeMax: "size_max", budget: "budget", location: "location", status: "status", notes: "notes", priority: "priority" };
    const { id, ...updates } = fnArgs;
    const check = await pool.query(`SELECT id, company_name FROM requirements WHERE id = $1`, [id]);
    if (!check.rows.length) return { data: { success: false, error: `No requirement found with ID "${id}"` } };
    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null && fieldMap[k]) { sets.push(`${fieldMap[k]} = $${idx}`); params.push(v); idx++; }
    }
    if (sets.length === 0) return { data: { success: false, error: "No fields to update" } };
    await pool.query(`UPDATE requirements SET ${sets.join(", ")} WHERE id = $1`, params);
    return { data: { success: true, action: "updated", entity: "requirement", id, company: check.rows[0].company_name, fields: Object.keys(updates) } };
  }

  if (fnName === "create_comp") {
    const { crmComps } = await import("@shared/schema");
    const created = await db.insert(crmComps).values({
      name: fnArgs.name, tenant: fnArgs.tenant || null, landlord: fnArgs.landlord || null,
      dealType: fnArgs.dealType || null, areaSqft: fnArgs.areaSqft || null,
      headlineRent: fnArgs.headlineRent || null, overallRate: fnArgs.overallRate || null,
      zoneARate: fnArgs.zoneARate || null, term: fnArgs.term || null, rentFree: fnArgs.rentFree || null,
      capex: fnArgs.capex || null, completionDate: fnArgs.completionDate || null,
      comments: fnArgs.comments || null, propertyId: fnArgs.propertyId || null, dealId: fnArgs.dealId || null,
      transactionType: fnArgs.transactionType || null, useClass: fnArgs.useClass || null,
      ltActStatus: fnArgs.ltActStatus || null, passingRent: fnArgs.passingRent || null,
      fitoutContribution: fnArgs.fitoutContribution || null, sourceEvidence: fnArgs.sourceEvidence || "ChatBGP",
      niaSqft: fnArgs.niaSqft || null, giaSqft: fnArgs.giaSqft || null, itzaSqft: fnArgs.itzaSqft || null,
      netEffectiveRent: fnArgs.netEffectiveRent || null, breakClause: fnArgs.breakClause || null,
      areaLocation: fnArgs.areaLocation || null, postcode: fnArgs.postcode || null,
      measurementStandard: fnArgs.measurementStandard || null,
      rentPsfNia: fnArgs.rentPsfNia || null, rentPsfGia: fnArgs.rentPsfGia || null,
      rentAnalysis: fnArgs.rentAnalysis || null,
    }).returning();
    return { data: { success: true, action: "created", entity: "leasing comp", id: created[0].id, name: created[0].name }, action: { type: "crm_created", entityType: "comp", id: created[0].id } };
  }

  if (fnName === "create_investment_comp") {
    const { investmentComps } = await import("@shared/schema");
    const created = await db.insert(investmentComps).values({
      propertyName: fnArgs.propertyName, address: fnArgs.address || null,
      transactionType: fnArgs.transactionType || null, price: fnArgs.price || null,
      pricePsf: fnArgs.pricePsf || null, capRate: fnArgs.capRate || null,
      areaSqft: fnArgs.areaSqft || null, buyer: fnArgs.buyer || null, seller: fnArgs.seller || null,
      buyerBroker: fnArgs.buyerBroker || null, sellerBroker: fnArgs.sellerBroker || null,
      transactionDate: fnArgs.transactionDate || null, comments: fnArgs.comments || null,
      propertyId: fnArgs.propertyId || null, source: "ChatBGP",
    }).returning();
    return { data: { success: true, action: "created", entity: "investment comp", id: created[0].id, name: created[0].propertyName }, action: { type: "crm_created", entityType: "investment_comp", id: created[0].id } };
  }

  if (fnName === "link_entities") {
    const { v4: uuid } = await import("uuid");
    const linkId = uuid();
    const linkType = fnArgs.linkType as string;
    const sourceId = fnArgs.sourceId as string;
    const targetId = fnArgs.targetId as string;
    try {
      const tableMap: Record<string, { table: string; col1: string; col2: string }> = {
        "contact-deal": { table: "crm_contact_deals", col1: "contact_id", col2: "deal_id" },
        "contact-property": { table: "crm_contact_properties", col1: "contact_id", col2: "property_id" },
        "contact-requirement": { table: "crm_contact_requirements", col1: "contact_id", col2: "requirement_id" },
        "company-property": { table: "crm_company_properties", col1: "company_id", col2: "property_id" },
        "company-deal": { table: "crm_company_deals", col1: "company_id", col2: "deal_id" },
      };
      const mapping = tableMap[linkType];
      if (!mapping) return { data: { success: false, error: `Unknown link type "${linkType}"` } };
      await pool.query(`INSERT INTO ${mapping.table} (id, ${mapping.col1}, ${mapping.col2}) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM ${mapping.table} WHERE ${mapping.col1} = $2 AND ${mapping.col2} = $3)`, [linkId, sourceId, targetId]);
      return { data: { success: true, action: "linked", linkType, sourceId, targetId } };
    } catch (err: any) {
      return { data: { success: false, error: err.message } };
    }
  }

  const APP_BUILDER_TOOL_SET = new Set(["list_project_files", "read_source_file", "edit_source_file", "run_shell_command", "add_database_column", "restart_application"]);
  if (APP_BUILDER_TOOL_SET.has(fnName)) {
    const { storage } = await import("./storage");
    const sessionUserId = (req as any)?.session?.userId || "";
    let userEmail = "";
    if (sessionUserId) {
      const user = await storage.getUser(sessionUserId);
      userEmail = user?.email || user?.username || "";
    }
    if (!userEmail) {
      return { data: { success: false, error: "You must be logged in to use app builder tools." } };
    }
  }

  if (fnName === "list_project_files") {
    const { execSync } = await import("child_process");
    const dir = fnArgs.directory || ".";
    const path = await import("path");
    const safePath = dir.replace(/\.\./g, "").replace(/[;&|`$]/g, "");
    const projectRoot = process.cwd();
    const targetDir = safePath === "." ? projectRoot : path.resolve(projectRoot, safePath);
    if (!targetDir.startsWith(projectRoot)) {
      return { data: { success: false, error: "Path must be within the project directory." } };
    }
    try {
      const cmd = fnArgs.recursive
        ? `find "${targetDir}" -maxdepth 3 -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" | sort | head -100`
        : `ls -la "${targetDir}" | head -60`;
      const output = execSync(cmd, { timeout: 30000 }).toString();
      return { data: { success: true, directory: safePath, files: output } };
    } catch (err: any) {
      return { data: { success: false, error: `Could not list "${safePath}": ${err.message}` } };
    }
  }

  if (fnName === "read_source_file") {
    const fs = await import("fs");
    const path = await import("path");
    const projectRoot = process.cwd();
    const safePath = (fnArgs.filePath as string).replace(/\.\./g, "");
    const fullPath = path.resolve(projectRoot, safePath);
    if (!fullPath.startsWith(projectRoot)) {
      return { data: { success: false, error: "Path must be within the project directory." } };
    }
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const start = fnArgs.startLine ? Math.max(0, fnArgs.startLine - 1) : 0;
      const end = fnArgs.endLine ? Math.min(lines.length, fnArgs.endLine) : lines.length;
      const selectedLines = lines.slice(start, end);
      const numbered = selectedLines.map((l: string, i: number) => `${start + i + 1}: ${l}`).join("\n");
      return { data: { success: true, filePath: safePath, totalLines: lines.length, content: numbered.substring(0, 15000) } };
    } catch (err: any) {
      return { data: { success: false, error: `Could not read "${safePath}": ${err.message}` } };
    }
  }

  // Inline helper: admin gate for the codebase-write / shell / restart family.
  // Looks up the session user and bails if they're not flagged is_admin.
  // Cheap (one cached query). Returns null on success, an error response on
  // refusal — caller does `const fail = await ensureAdmin(); if (fail) return fail;`.
  async function ensureAdmin(): Promise<{ data: { success: false; error: string } } | null> {
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) return { data: { success: false, error: "Not authenticated." } };
    try {
      const r = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      if (r.rows.length === 0 || !r.rows[0].is_admin) {
        return { data: { success: false, error: "Admin access required for this tool." } };
      }
    } catch (e: any) {
      return { data: { success: false, error: `Admin check failed: ${e?.message}` } };
    }
    return null;
  }

  if (fnName === "edit_source_file") {
    const fail = await ensureAdmin();
    if (fail) return fail;
    const fs = await import("fs");
    const path = await import("path");
    const projectRoot = process.cwd();
    const safePath = (fnArgs.filePath as string).replace(/\.\./g, "");
    const fullPath = path.resolve(projectRoot, safePath);
    if (!fullPath.startsWith(projectRoot)) {
      return { data: { success: false, error: "Path must be within the project directory." } };
    }
    const action = fnArgs.action as string;
    const description = fnArgs.description || "Code change via ChatBGP";
    // Direct mode = skip branch-mode, write to live working tree. Off by
    // default — only use when the admin says "go direct" or for files git
    // wouldn't track anyway.
    const directMode = fnArgs.direct === true;

    try {
      let beforeContent = "";
      try { beforeContent = fs.readFileSync(fullPath, "utf-8"); } catch {}

      // Compute the new content in memory; don't touch disk yet.
      let afterContent = "";
      if (action === "create") {
        afterContent = fnArgs.content || fnArgs.replaceText || "";
      } else if (action === "append") {
        afterContent = beforeContent + "\n" + (fnArgs.replaceText || fnArgs.content || fnArgs.insertText || "");
      } else if (action === "replace") {
        if (!fnArgs.searchText) return { data: { success: false, error: "searchText is required for replace action" } };
        if (!beforeContent.includes(fnArgs.searchText)) {
          return { data: { success: false, error: `Could not find the search text in "${safePath}". Read the file first to get the exact content.` } };
        }
        afterContent = beforeContent.replace(fnArgs.searchText, fnArgs.replaceText || "");
      } else if (action === "insert") {
        const lines = beforeContent.split("\n");
        const insertAt = Math.max(0, (fnArgs.insertAtLine || 1) - 1);
        lines.splice(insertAt, 0, fnArgs.insertText || "");
        afterContent = lines.join("\n");
      } else {
        return { data: { success: false, error: `Unknown action "${action}"` } };
      }

      // Branch-mode (default): commit to chatbgp/<date> via git plumbing,
      // do NOT touch the live working tree. Admin merges to apply. Falls
      // back to direct write if git isn't available (Railway strips .git).
      if (!directMode) {
        const branchMod = await import("./chatbgp-branch-mode");
        if (!branchMod.isGitAvailable()) {
          // No .git in this environment — fall through to direct mode but
          // tell the caller why. Audit log still records the change.
          console.warn("[edit_source_file] git unavailable in this environment, falling back to direct write");
        } else {
          const userRow = await pool.query(
            "SELECT name, email FROM users WHERE id = $1",
            [req.session?.userId || (req as any).tokenUserId],
          ).catch(() => ({ rows: [] }));
          const u = userRow.rows[0] || {};
          try {
            const result = branchMod.commitToChatbgpBranch({
              filePath: safePath,
              newContent: afterContent,
              description,
              userName: u.name,
              userEmail: u.email,
            });
            await pool.query(
              `INSERT INTO code_changes (tool_used, file_path, description, before_content, after_content, status) VALUES ($1, $2, $3, $4, $5, 'committed-to-branch')`,
              ["edit_source_file", safePath, `[${result.branch}@${result.commitHash.slice(0,8)}] ${description}`, beforeContent.substring(0, 50000), afterContent.substring(0, 50000)],
            );
            return {
              data: {
                success: true,
                mode: "branch",
                branch: result.branch,
                commitHash: result.commitHash,
                isFirstCommit: result.isFirstCommit,
                filePath: safePath,
                description,
                linesChanged: Math.abs(afterContent.split("\n").length - beforeContent.split("\n").length),
                message: result.message,
                nextStep: `Tell the admin: edit committed to ${result.branch}. To apply, they run \`git checkout <deploy-branch> && git merge ${result.branch}\` and restart. The change is NOT live until merged.`,
              },
            };
          } catch (err: any) {
            // Git plumbing failed mid-flight (rare — partially stripped .git,
            // permission issue, etc). Fall through to direct mode.
            console.warn("[edit_source_file] branch-mode failed, falling back to direct:", err?.message);
          }
        }
      }

      // Direct mode (also the fallback): write live, audit, return.
      if (action === "create") {
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, afterContent, "utf-8");

      await pool.query(
        `INSERT INTO code_changes (tool_used, file_path, description, before_content, after_content, status) VALUES ($1, $2, $3, $4, $5, 'applied')`,
        ["edit_source_file", safePath, `[direct] ${description}`, beforeContent.substring(0, 50000), afterContent.substring(0, 50000)],
      );
      return {
        data: {
          success: true,
          mode: "direct",
          action,
          filePath: safePath,
          description,
          linesChanged: Math.abs(afterContent.split("\n").length - beforeContent.split("\n").length),
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: `Failed to edit "${safePath}": ${err.message}` } };
    }
  }

  if (fnName === "run_shell_command") {
    const fail = await ensureAdmin();
    if (fail) return fail;
    // Async exec — execSync here froze the whole Node event loop for up to
    // 5 minutes per command (every request, every chat, every SSE stream
    // stalled on "Thinking..." while a build/backfill ran).
    const { exec } = await import("child_process");
    const command = fnArgs.command as string;
    const description = fnArgs.description || "Shell command via ChatBGP";

    const blockedPatterns = [
      /rm\s+-rf\s+[\/~]/i, /rm\s+-rf\s+\*/i,
      /DROP\s+DATABASE/i, /DROP\s+SCHEMA/i,
      /git\s+push\s+.*--force/i, /git\s+reset\s+--hard/i,
      />\s*\/dev\/sd/i, /mkfs/i, /dd\s+if=/i,
      /shutdown/i, /reboot/i, /kill\s+-9\s+1$/,
      /chmod\s+-R\s+777\s+\//i,
    ];
    for (const pattern of blockedPatterns) {
      if (pattern.test(command)) {
        return { data: { success: false, error: `Command blocked for safety: matches dangerous pattern. Command: ${command}` } };
      }
    }

    try {
      const output = await new Promise<string>((resolve, reject) => {
        exec(command, {
          cwd: process.cwd(),
          timeout: 300000, // 5 min — admin-gated, no point sub-second cap
          env: { ...process.env },
          maxBuffer: 10 * 1024 * 1024, // 10 MB — long outputs like npm install fit
        }, (err, stdout, stderr) => {
          if (err) {
            (err as any).stderr = stderr || stdout;
            reject(err);
          } else {
            resolve(stdout.toString());
          }
        });
      });

      await pool.query(
        `INSERT INTO code_changes (tool_used, shell_command, shell_output, description, status) VALUES ($1, $2, $3, $4, 'applied')`,
        ["run_shell_command", command, output.substring(0, 50000), description]
      );

      return { data: { success: true, command, output: output.substring(0, 50000) } };
    } catch (err: any) {
      const stderr = err.stderr?.toString?.() || err.message;
      await pool.query(
        `INSERT INTO code_changes (tool_used, shell_command, shell_output, description, status) VALUES ($1, $2, $3, $4, 'failed')`,
        ["run_shell_command", command, stderr.substring(0, 10000), description]
      );
      return { data: { success: false, command, error: stderr.substring(0, 3000) } };
    }
  }

  if (fnName === "add_database_column") {
    const fail = await ensureAdmin();
    if (fail) return fail;
    const tableName = fnArgs.tableName as string;
    const columnName = (fnArgs.columnName as string).replace(/[^a-z0-9_]/gi, "");
    const columnType = fnArgs.columnType as string;
    const defaultVal = fnArgs.defaultValue || "NULL";
    const description = fnArgs.description || `Add ${columnName} to ${tableName}`;

    const allowedTables = ["crm_deals", "crm_contacts", "crm_companies", "crm_properties", "investment_tracker", "available_units", "requirements", "crm_comps", "investment_comps", "crm_leads", "diary_entries"];
    if (!allowedTables.includes(tableName)) {
      return { data: { success: false, error: `Table "${tableName}" is not allowed. Allowed tables: ${allowedTables.join(", ")}` } };
    }
    const allowedTypes = ["TEXT", "INTEGER", "REAL", "BOOLEAN", "TIMESTAMP", "JSONB"];
    if (!allowedTypes.includes(columnType)) {
      return { data: { success: false, error: `Column type "${columnType}" is not allowed. Allowed: ${allowedTypes.join(", ")}` } };
    }

    try {
      const sanitizedDefault = String(defaultVal).replace(/'/g, "''").replace(/;/g, "").replace(/--/g, "").substring(0, 100);
      const defaultClause = defaultVal === "NULL" ? "" : ` DEFAULT ${defaultVal === "true" || defaultVal === "false" ? defaultVal : `'${sanitizedDefault}'`}`;
      const sql = `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${columnType}${defaultClause}`;
      await pool.query(sql);

      await pool.query(
        `INSERT INTO code_changes (tool_used, shell_command, description, status) VALUES ($1, $2, $3, 'applied')`,
        ["add_database_column", sql, description]
      );

      return { data: { success: true, action: "column_added", table: tableName, column: columnName, type: columnType, sql } };
    } catch (err: any) {
      return { data: { success: false, error: `Failed to add column: ${err.message}` } };
    }
  }

  if (fnName === "restart_application") {
    const fail = await ensureAdmin();
    if (fail) return fail;
    const { execSync } = await import("child_process");
    try {
      execSync("kill -USR2 1 2>/dev/null || true", { timeout: 5000 });
      return { data: { success: true, message: "Application restart signal sent. The app will restart momentarily." } };
    } catch {
      return { data: { success: true, message: "Restart signal sent." } };
    }
  }

  if (fnName === "list_chatbgp_branches") {
    try {
      const { isGitAvailable, listChatbgpBranches } = await import("./chatbgp-branch-mode");
      if (!isGitAvailable()) {
        return { data: { success: true, gitAvailable: false, branches: [], count: 0, message: "git is not available in this environment — no branches to list." } };
      }
      const branches = listChatbgpBranches();
      return {
        data: {
          success: true,
          branches,
          count: branches.length,
          message: branches.length === 0
            ? "No pending ChatBGP branches."
            : `${branches.length} ChatBGP branch(es) pending review.`,
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: err?.message } };
    }
  }

  if (fnName === "merge_chatbgp_branch") {
    const fail = await ensureAdmin();
    if (fail) return fail;
    const { isGitAvailable } = await import("./chatbgp-branch-mode");
    if (!isGitAvailable()) {
      return { data: { success: false, gitAvailable: false, error: "git is not available in this environment — can't merge here. ChatBGP edits in this env fall back to direct write automatically." } };
    }
    const branch = String(fnArgs.branch || "");
    if (!branch.startsWith("chatbgp/")) {
      return { data: { success: false, error: "Refusing to merge: only chatbgp/* branches accepted." } };
    }
    const { execSync } = await import("child_process");
    try {
      // Verify branch exists.
      execSync(`git rev-parse --verify ${branch}`, { encoding: "utf-8" });
    } catch {
      return { data: { success: false, error: `Branch ${branch} not found.` } };
    }
    let mergeOutput = "";
    try {
      mergeOutput = execSync(
        `git merge --ff-only ${branch}`,
        { cwd: process.cwd(), encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "ChatBGP", GIT_AUTHOR_EMAIL: "chatbgp@brucegillinghampollard.com", GIT_COMMITTER_NAME: "ChatBGP", GIT_COMMITTER_EMAIL: "chatbgp@brucegillinghampollard.com" } },
      );
    } catch (err: any) {
      // Fast-forward failed — likely diverged. Don't auto-resolve.
      return { data: { success: false, error: `Merge failed (fast-forward only): ${err?.message?.substring(0, 500)}. Admin must resolve manually via terminal.` } };
    }
    if (fnArgs.restart === true) {
      try {
        execSync("kill -USR2 1 2>/dev/null || true", { timeout: 5000 });
      } catch {}
    }
    return {
      data: {
        success: true,
        branch,
        mergeOutput: mergeOutput.substring(0, 1000),
        restarted: fnArgs.restart === true,
        message: `Merged ${branch}. ${fnArgs.restart === true ? "Restart signal sent." : "Run restart_application to load the changes."}`,
      },
    };
  }

  if (fnName === "grep_codebase") {
    try {
      const pattern = String(fnArgs.pattern || "");
      if (!pattern) return { data: { success: false, error: "pattern required" } };
      const glob = fnArgs.glob ? String(fnArgs.glob) : "";
      const caseSensitive = fnArgs.caseSensitive === true;
      const maxResults = Math.min(Math.max(Number(fnArgs.maxResults) || 50, 1), 200);

      const { execFileSync } = await import("child_process");
      const args: string[] = [
        "-rn",                            // recursive, with line numbers
        "--color=never",
        "--exclude-dir=node_modules",
        "--exclude-dir=.git",
        "--exclude-dir=dist",
        "--exclude-dir=build",
        "--exclude-dir=.next",
        "--exclude=*.lock",
        "--exclude=*.map",
      ];
      if (!caseSensitive) args.push("-i");
      args.push("-E");                     // ERE so the LLM can use ()|+? naturally
      args.push("--", pattern);
      // grep takes paths after the pattern. If glob given, pass as --include
      // and search the repo root; otherwise just the repo root.
      if (glob) {
        // grep --include is a filename pattern, not a path glob. Translate
        // common cases: "server/**/*.ts" → search server/ with --include='*.ts',
        // "shared/schema.ts" → just that one file.
        const m = glob.match(/^([^*?[\]]+?)\/(?:\*\*\/)?(\*[^/]*|[^/*]+)$/);
        if (m && !m[2].includes("*") && !m[2].includes("?")) {
          // Single-file shortcut.
          args.push(m[1] + "/" + m[2]);
        } else if (m) {
          args.push(`--include=${m[2]}`);
          args.push(m[1] || ".");
        } else {
          // Treat as a literal path or include pattern.
          if (glob.includes("*") || glob.includes("?")) {
            args.push(`--include=${glob}`);
            args.push(".");
          } else {
            args.push(glob);
          }
        }
      } else {
        args.push(".");
      }

      let raw = "";
      try {
        raw = execFileSync("grep", args, { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 1024 * 1024 }).toString();
      } catch (err: any) {
        // grep exits 1 on no matches — that's not an error for us.
        if (err?.status === 1) return { data: { success: true, pattern, matches: [], count: 0, message: "No matches." } };
        return { data: { success: false, error: `grep failed: ${err?.message?.substring(0, 500)}` } };
      }

      const lines = raw.split("\n").filter(Boolean);
      const matches = lines.slice(0, maxResults).map(line => {
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) return { file: "", lineNumber: 0, snippet: line.substring(0, 200) };
        return {
          file: m[1].replace(/^\.\//, ""),
          lineNumber: parseInt(m[2], 10),
          snippet: m[3].substring(0, 200),
        };
      });

      return {
        data: {
          success: true,
          pattern,
          matches,
          count: matches.length,
          truncated: lines.length > maxResults,
          totalUntruncated: lines.length,
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: `grep_codebase failed: ${err?.message}` } };
    }
  }

  if (fnName === "git_status") {
    try {
      const { isGitAvailable } = await import("./chatbgp-branch-mode");
      if (!isGitAvailable()) {
        return { data: { success: false, gitAvailable: false, error: "git is not available in this environment (Railway / nixpacks usually strips .git). Branch-mode tools fall back to direct write automatically; the read-only git_* tools have nothing to report here." } };
      }
      const { execSync } = await import("child_process");
      const exec = (cmd: string) => execSync(cmd, { cwd: process.cwd(), encoding: "utf-8" }).trim();

      const branch = exec("git rev-parse --abbrev-ref HEAD");
      let upstream = "";
      let ahead = 0;
      let behind = 0;
      try {
        upstream = exec("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
        const counts = exec(`git rev-list --left-right --count HEAD...${upstream}`);
        const [a, b] = counts.split("\t").map(n => parseInt(n.trim(), 10) || 0);
        ahead = a; behind = b;
      } catch {} // no upstream is fine

      const porcelain = exec("git status --porcelain=v1");
      const dirty = porcelain.length > 0;
      const changed = porcelain.split("\n").filter(Boolean).map(l => ({
        flag: l.substring(0, 2).trim(),
        file: l.substring(3),
      }));

      const log = exec("git log -10 --pretty=format:%H|%h|%s|%an|%ar")
        .split("\n").filter(Boolean).map(l => {
          const [hash, short, subject, author, when] = l.split("|");
          return { hash, short, subject, author, when };
        });

      return {
        data: {
          success: true,
          branch,
          upstream: upstream || null,
          ahead, behind,
          dirty,
          changedCount: changed.length,
          changed: changed.slice(0, 30),
          recentCommits: log,
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: `git_status failed: ${err?.message}` } };
    }
  }

  if (fnName === "git_diff") {
    try {
      const { isGitAvailable } = await import("./chatbgp-branch-mode");
      if (!isGitAvailable()) {
        return { data: { success: false, gitAvailable: false, error: "git is not available in this environment — diff unavailable." } };
      }
      const { execSync } = await import("child_process");
      const branch = fnArgs.branch ? String(fnArgs.branch) : "";
      const file = fnArgs.file ? String(fnArgs.file) : "";

      let cmd: string;
      if (branch) {
        // Diff branch against current HEAD (so review of a chatbgp branch
        // shows what would be merged in).
        cmd = `git diff HEAD..${branch}`;
        if (file) cmd += ` -- ${file}`;
      } else {
        cmd = "git diff HEAD";
        if (file) cmd += ` -- ${file}`;
      }

      let out: string;
      try {
        out = execSync(cmd, { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 }).toString();
      } catch (err: any) {
        return { data: { success: false, error: `git diff failed: ${err?.message?.substring(0, 500)}` } };
      }
      const truncated = out.length > 8000;
      return {
        data: {
          success: true,
          mode: branch ? "branch" : "working-tree",
          branch: branch || null,
          file: file || null,
          diff: out.substring(0, 8000),
          truncated,
          message: out.length === 0 ? "No changes." : `Diff (${out.length} bytes${truncated ? ", truncated" : ""}).`,
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: `git_diff failed: ${err?.message}` } };
    }
  }

  if (fnName === "revert_chatbgp_commit") {
    const fail = await ensureAdmin();
    if (fail) return fail;
    const { isGitAvailable } = await import("./chatbgp-branch-mode");
    if (!isGitAvailable()) {
      return { data: { success: false, gitAvailable: false, error: "git is not available — nothing to revert in this environment." } };
    }
    const branch = String(fnArgs.branch || "");
    if (!branch.startsWith("chatbgp/")) {
      return { data: { success: false, error: "Refusing — only chatbgp/* branches can be reverted via this tool." } };
    }
    try {
      const { execSync } = await import("child_process");
      const exec = (cmd: string) => execSync(cmd, { cwd: process.cwd(), encoding: "utf-8" }).trim();
      const refName = `refs/heads/${branch}`;

      const tipHash = exec(`git rev-parse --verify ${refName}`);
      // How many commits is this branch ahead of HEAD?
      const aheadStr = exec(`git rev-list --count HEAD..${refName}`);
      const ahead = parseInt(aheadStr, 10) || 0;
      if (ahead === 0) {
        return { data: { success: false, error: `${branch} has no commits ahead of HEAD — nothing to revert.` } };
      }

      if (ahead === 1) {
        // Only one commit on the branch — delete the ref entirely.
        execSync(`git update-ref -d ${refName}`, { cwd: process.cwd() });
        return {
          data: {
            success: true,
            branch,
            droppedHash: tipHash,
            action: "branch-deleted",
            message: `Deleted ${branch} (was the only commit). Reflog still holds ${tipHash.slice(0, 8)} if you need it.`,
          },
        };
      }

      // Move the branch ref back by one commit.
      const newTip = exec(`git rev-parse ${refName}~1`);
      execSync(`git update-ref ${refName} ${newTip} ${tipHash}`, { cwd: process.cwd() });
      return {
        data: {
          success: true,
          branch,
          droppedHash: tipHash,
          newTipHash: newTip,
          action: "ref-moved",
          message: `${branch} backed up by one. Dropped ${tipHash.slice(0, 8)}; new tip is ${newTip.slice(0, 8)}. Reflog still holds the dropped commit.`,
        },
      };
    } catch (err: any) {
      return { data: { success: false, error: `revert failed: ${err?.message}` } };
    }
  }

  if (fnName === "generate_image") {
    try {
      const prompt = String(fnArgs.prompt || "").substring(0, 1000);
      if (!prompt || prompt.length < 3) {
        return { data: { success: false, error: "Please provide a more detailed image description." } };
      }
      const { GoogleGenAI, Modality } = await import("@google/genai");
      // Match the fallback chain used by server/image-studio.ts so this
      // tool works whenever any of the standard Gemini keys is set —
      // previously this only checked AI_INTEGRATIONS_GEMINI_API_KEY,
      // so it 503'd on environments that only had GEMINI_API_KEY or
      // GOOGLE_API_KEY configured. base_url is optional (the SDK
      // defaults to Google's public endpoint).
      const apiKey =
        process.env.GEMINI_API_KEY ||
        process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
        process.env.GOOGLE_AI_API_KEY ||
        process.env.GOOGLE_API_KEY;
      const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
      if (!apiKey) {
        return { data: { success: false, error: "Image generation not configured — no Gemini key set" } };
      }
      const ai = baseUrl
        ? new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } })
        : new GoogleGenAI({ apiKey });
      const styleHint = fnArgs.style === "illustration" ? "digital illustration style, " :
                        fnArgs.style === "architectural" ? "architectural rendering style, " :
                        "photorealistic, professional photography, ";
      const fullPrompt = `${styleHint}${prompt}. High quality, professional, suitable for property marketing materials.`;
      console.log("[chatbgp] Generating image with Nano Banana:", fullPrompt.substring(0, 100));
      // Same model-fallback chain as image-studio.ts — try the current
      // preview model first, then fall back if the API rejects it.
      const MODELS = ["gemini-3-pro-image-preview", "gemini-3-pro-image", "gemini-2.5-flash-preview-image", "gemini-2.5-flash-image", "gemini-2.0-flash-exp"];
      let response: any = null;
      let lastErr: any = null;
      for (const model of MODELS) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
          });
          if (response) break;
        } catch (err: any) {
          lastErr = err;
          if (!/not found|unsupported|invalid model/i.test(err?.message || "")) throw err;
        }
      }
      if (!response) throw lastErr || new Error("All Gemini image models rejected the request");
      const candidate = response.candidates?.[0];
      const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData);
      if (!imagePart?.inlineData?.data) {
        return { data: { success: false, error: "No image was generated. Try a different description." } };
      }
      const mimeType = imagePart.inlineData.mimeType || "image/png";
      const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
      const { saveFile } = await import("./file-storage");
      await saveFile(`chat-media/${uniqueName}`, imageBuffer, mimeType, `ai-generated-${uniqueName}`);
      const imageUrl = `/api/chat-media/${uniqueName}`;
      console.log("[chatbgp] Image saved to", imageUrl, `(${(imageBuffer.length / 1024).toFixed(0)}KB)`);
      return {
        data: { success: true, imageGenerated: true },
        action: { type: "show_image", imageUrl, prompt: fnArgs.prompt },
      };
    } catch (err: any) {
      console.error("[chatbgp] Image generation error:", err?.message);
      return { data: { success: false, error: `Image generation failed: ${err?.message}` } };
    }
  }

  if (fnName === "edit_image") {
    try {
      let imageStudioId = String(fnArgs.imageStudioId || "").trim();
      const imageUrl = String(fnArgs.imageUrl || "").trim();
      const editPrompt = String(fnArgs.editPrompt || "").trim();
      if (!imageStudioId && !imageUrl) return { data: { success: false, error: "Pass either imageStudioId (existing studio image) or imageUrl (a /api/chat-media/... URL of a freshly uploaded photo)." } };
      if (!editPrompt) return { data: { success: false, error: "editPrompt is required" } };
      if (editPrompt.length > 1000) return { data: { success: false, error: "editPrompt too long (max 1000 chars)" } };

      const sessionCookie = req.headers.cookie || "";
      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
      const baseUrl = `${protocol}://${host}`;

      // If the caller passed a chat-media URL, import the photo into the
      // Image Studio first so the edit + future iterations all reference a
      // persistent studio row. Done in-process so we don't need a second
      // tool round-trip from the model.
      if (!imageStudioId && imageUrl) {
        if (!imageUrl.startsWith("/api/chat-media/")) {
          return { data: { success: false, error: "imageUrl must be a /api/chat-media/... URL (a file the user uploaded into chat)." } };
        }
        const mediaName = imageUrl.replace("/api/chat-media/", "");
        const { getFile } = await import("./file-storage");
        const fileData = await getFile(`chat-media/${mediaName}`);
        if (!fileData) return { data: { success: false, error: "Could not find that chat-media file — it may have expired or the URL is wrong." } };

        const fsModule = await import("fs");
        const pathModule = await import("path");
        const sharp = (await import("sharp")).default;
        const uploadsDir = pathModule.default.join(process.cwd(), "uploads", "image-studio");
        if (!fsModule.default.existsSync(uploadsDir)) fsModule.default.mkdirSync(uploadsDir, { recursive: true });
        const inferredExt = mediaName.toLowerCase().endsWith(".png") ? "png"
          : mediaName.toLowerCase().match(/\.(jpe?g)$/) ? "jpg"
          : mediaName.toLowerCase().endsWith(".webp") ? "webp"
          : "jpg";
        const localName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${inferredExt}`;
        const localPath = pathModule.default.join(uploadsDir, localName);
        fsModule.default.writeFileSync(localPath, fileData.data);

        let width: number | null = null, height: number | null = null, thumbnailData: string | null = null;
        try {
          const meta = await sharp(fileData.data).metadata();
          width = meta.width || null;
          height = meta.height || null;
          const thumbBuf = await sharp(fileData.data).resize(200, 200, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
          thumbnailData = `data:image/jpeg;base64,${thumbBuf.toString("base64")}`;
        } catch {}

        const mime = inferredExt === "png" ? "image/png" : inferredExt === "webp" ? "image/webp" : "image/jpeg";
        const userId = req.session?.userId || (req as any).tokenUserId || null;
        const linkPropertyId = fnArgs.propertyId ? String(fnArgs.propertyId) : null;
        const linkCompanyId = fnArgs.companyId ? String(fnArgs.companyId) : null;
        const insertRes = await pool.query(
          `INSERT INTO image_studio_images
             (file_name, category, tags, description, source, mime_type, file_size, width, height, thumbnail_data, local_path, uploaded_by, property_id, company_id, created_at)
           VALUES ($1, $2, $3::text[], $4, 'upload', $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
           RETURNING id`,
          [fileData.originalName || mediaName, "Other", ["User Upload", "For Edit"], "Imported from chat for AI edit",
           mime, fileData.data.length, width, height, thumbnailData, localPath, userId, linkPropertyId, linkCompanyId]
        );
        imageStudioId = insertRes.rows[0].id;
        console.log(`[chatbgp] edit_image: imported chat-media ${mediaName} as studio row ${imageStudioId}${linkPropertyId ? ` linked to property ${linkPropertyId}` : ""}${linkCompanyId ? ` linked to company ${linkCompanyId}` : ""}`);
      }

      // Internal call to the existing /api/image-studio/ai-edit handler so
      // we reuse its Gemini/OpenAI chain, undo snapshot, row update and
      // SharePoint sync. Same forwarding pattern as capture_pdf_pages.
      const preferProvider = typeof fnArgs.preferProvider === "string" ? fnArgs.preferProvider : undefined;
      const editRes = await fetch(`${baseUrl}/api/image-studio/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ imageId: imageStudioId, editPrompt, preferProvider }),
      });

      if (!editRes.ok) {
        const errBody = await editRes.text().catch(() => "");
        let errMsg = `Image edit failed: HTTP ${editRes.status}`;
        try { const j = JSON.parse(errBody); if (j?.error) errMsg = j.error; } catch {}
        return { data: { success: false, error: errMsg } };
      }

      const updated = await editRes.json();
      const editedImageUrl = `/api/image-studio/${updated.id}/full`;
      console.log(`[chatbgp] edit_image: ${updated.id} via ${updated.provider}`);
      return {
        data: {
          success: true,
          imageStudioId: updated.id,
          provider: updated.provider,
          width: updated.width,
          height: updated.height,
          tags: updated.tags,
          message: `Edit applied via ${updated.provider}. The image studio row was updated in place — call edit_image again on the same id to iterate further.`,
        },
        action: { type: "show_image", imageUrl: editedImageUrl, prompt: editPrompt },
      };
    } catch (err: any) {
      console.error("[chatbgp] edit_image error:", err?.message);
      return { data: { success: false, error: `Image edit failed: ${err?.message}` } };
    }
  }

  if (fnName === "capture_pdf_pages") {
    try {
      const { driveId, itemId, fileName, propertyName, category = "Marketing", maxPages } = fnArgs as any;
      if (!driveId || !itemId) return { data: { success: false, error: "driveId and itemId are required — browse SharePoint first to find the PDF." } };
      const userId = req.session?.userId || (req as any).tokenUserId;
      const sessionCookie = req.headers.cookie || "";
      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
      const baseUrl = `${protocol}://${host}`;
      const captureRes = await fetch(`${baseUrl}/api/image-studio/capture-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ driveId, itemId, fileName, propertyName, category, maxPages }),
      });
      const data = await captureRes.json() as any;
      if (!captureRes.ok) return { data: { success: false, error: data.error || `Capture failed: ${captureRes.status}` } };
      return { data: { success: true, pages: data.pages, message: `Captured ${data.pages} page${data.pages === 1 ? "" : "s"} from "${fileName}" and saved to Image Studio under ${category}.` } };
    } catch (err: any) {
      return { data: { success: false, error: `PDF capture error: ${err?.message}` } };
    }
  }

  if (fnName === "browse_image_studio") {
    try {
      const search = (fnArgs.search as string) || "";
      const category = (fnArgs.category as string) || "";
      const limit = Math.min(Number(fnArgs.limit) || 20, 50);
      let query = `SELECT id, file_name, category, area, tags, description, source, width, height, file_size, address, brand_name, property_type, created_at FROM image_studio_images`;
      const conditions: string[] = [];
      const params: any[] = [];
      if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        const p = params.length;
        conditions.push(`(file_name ILIKE $${p} OR description ILIKE $${p} OR area ILIKE $${p} OR address ILIKE $${p} OR brand_name ILIKE $${p} OR array_to_string(tags, ',') ILIKE $${p})`);
      }
      if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;
      query += ` ORDER BY created_at DESC LIMIT ${limit}`;
      const result = await pool.query(query, params);
      const images = result.rows.map((r: any) => ({
        id: r.id,
        fileName: r.file_name,
        category: r.category,
        area: r.area,
        tags: r.tags,
        description: r.description,
        source: r.source,
        dimensions: r.width && r.height ? `${r.width}x${r.height}` : null,
        fileSize: r.file_size ? `${(r.file_size / 1024).toFixed(0)}KB` : null,
        address: r.address,
        brandName: r.brand_name,
        propertyType: r.property_type,
        createdAt: r.created_at,
      }));
      const totalResult = await pool.query("SELECT count(*) FROM image_studio_images");
      return { data: { total: Number(totalResult.rows[0].count), returned: images.length, images } };
    } catch (err: any) {
      return { data: { error: `Failed to browse Image Studio: ${err.message}` } };
    }
  }

  if (fnName === "save_to_image_studio") {
    try {
      const fileName = String(fnArgs.fileName || "Untitled Image");
      const category = String(fnArgs.category || "Other");
      const description = String(fnArgs.description || "");
      const area = String(fnArgs.area || "");
      const address = String(fnArgs.address || "");
      const brandName = String(fnArgs.brandName || "");
      const propertyType = String(fnArgs.propertyType || "");
      const tags = (fnArgs.tags as string[]) || [];
      const imageUrl = fnArgs.imageUrl as string;
      const base64Data = fnArgs.base64Data as string;
      const mimeType = String(fnArgs.mimeType || "image/png");
      const fetchUrl = fnArgs.fetchUrl as string;
      const spDriveId = fnArgs.sharepointDriveId as string;
      const spItemId = fnArgs.sharepointItemId as string;

      let imageBuffer: Buffer;
      let ext = "png";

      if (fetchUrl) {
        if (!fetchUrl.startsWith("https://")) {
          return { data: { success: false, error: "fetchUrl must be an https:// URL." } };
        }
        try {
          const u = new URL(fetchUrl);
          const host = u.hostname.toLowerCase();
          if (host === "localhost" || host === "127.0.0.1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "169.254.169.254") {
            return { data: { success: false, error: "fetchUrl points to a private/internal address — not allowed." } };
          }
        } catch {
          return { data: { success: false, error: "fetchUrl is not a valid URL." } };
        }
        const fetchRes = await fetch(fetchUrl, { redirect: "follow", signal: AbortSignal.timeout(15000) });
        if (!fetchRes.ok) {
          return { data: { success: false, error: `Fetch failed: HTTP ${fetchRes.status} from ${fetchUrl}` } };
        }
        const ctype = fetchRes.headers.get("content-type") || "";
        if (!ctype.startsWith("image/")) {
          return { data: { success: false, error: `URL did not return an image (content-type: ${ctype}). Check the URL is correct.` } };
        }
        const bytes = await fetchRes.arrayBuffer();
        if (bytes.byteLength > 10 * 1024 * 1024) {
          return { data: { success: false, error: "Image is larger than 10MB — too large to import." } };
        }
        imageBuffer = Buffer.from(bytes);
        ext = ctype.includes("jpeg") || ctype.includes("jpg") ? "jpg" : ctype.includes("png") ? "png" : ctype.includes("webp") ? "webp" : ctype.includes("svg") ? "svg" : "jpg";
      } else if (spDriveId && spItemId) {
        const token = await getValidMsToken(req);
        if (!token) {
          return { data: { success: false, error: "Not signed into Microsoft — cannot fetch SharePoint image." } };
        }
        const contentRes = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${spDriveId}/items/${spItemId}/content`,
          { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" }
        );
        if (!contentRes.ok) {
          return { data: { success: false, error: `SharePoint fetch failed: HTTP ${contentRes.status}` } };
        }
        imageBuffer = Buffer.from(await contentRes.arrayBuffer());
        const ctype = contentRes.headers.get("content-type") || "";
        ext = ctype.includes("jpeg") || ctype.includes("jpg") ? "jpg" : ctype.includes("png") ? "png" : ctype.includes("webp") ? "webp" : "jpg";
      } else if (imageUrl) {
        if (imageUrl.startsWith("/api/chat-media/")) {
          const mediaName = imageUrl.replace("/api/chat-media/", "");
          const { getFile } = await import("./file-storage");
          const fileData = await getFile(`chat-media/${mediaName}`);
          if (!fileData) {
            return { data: { success: false, error: "Could not find the generated image. It may have expired." } };
          }
          imageBuffer = fileData.data;
          ext = mediaName.endsWith(".jpg") || mediaName.endsWith(".jpeg") ? "jpg" : "png";
        } else {
          return { data: { success: false, error: "Invalid imageUrl. Use the URL from a generate_image result." } };
        }
      } else if (base64Data) {
        imageBuffer = Buffer.from(base64Data, "base64");
        ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
      } else {
        return { data: { success: false, error: "Provide imageUrl (from generate_image), base64Data, or sharepointDriveId+sharepointItemId." } };
      }

      const fsModule = await import("fs");
      const pathModule = await import("path");
      const sharp = (await import("sharp")).default;

      const uploadsDir = pathModule.default.join(process.cwd(), "uploads", "image-studio");
      if (!fsModule.default.existsSync(uploadsDir)) {
        fsModule.default.mkdirSync(uploadsDir, { recursive: true });
      }
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const localPath = pathModule.default.join(uploadsDir, uniqueName);
      fsModule.default.writeFileSync(localPath, imageBuffer);

      let width: number | null = null, height: number | null = null;
      let thumbnailData: string | null = null;
      try {
        const meta = await sharp(imageBuffer).metadata();
        width = meta.width || null;
        height = meta.height || null;
        const thumbBuffer = await sharp(imageBuffer).resize(300, 300, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
        thumbnailData = `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`;
      } catch {}

      const sessionUserId = req.session?.userId || "chatbgp";
      const propertyId = fnArgs.propertyId ? String(fnArgs.propertyId) : null;
      const companyId = fnArgs.companyId ? String(fnArgs.companyId) : null;
      const insertResult = await pool.query(
        `INSERT INTO image_studio_images (file_name, category, area, tags, description, source, width, height, file_size, thumbnail_data, local_path, uploaded_by, address, brand_name, property_type, property_id, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        [fileName, category, area || null, tags, description || null, "chatbgp", width, height, imageBuffer.length, thumbnailData, localPath, sessionUserId, address || null, brandName || null, propertyType || null, propertyId, companyId]
      );

      const imageId = insertResult.rows[0].id;
      console.log(`[chatbgp] Saved image to Image Studio: ${fileName} (id=${imageId}, ${(imageBuffer.length / 1024).toFixed(0)}KB${propertyId ? `, propertyId=${propertyId}` : ""}${companyId ? `, companyId=${companyId}` : ""})`);

      // Fold into umbrella property / brand folders so multi-image
      // properties and brands surface as a single grouped folder.
      let brandCollectionId: string | null = null;
      let brandCollectionCreated = false;
      let propertyCollectionId: string | null = null;
      let propertyCollectionCreated = false;
      if (propertyId) {
        try {
          const { maybeAddToPropertyCollection } = await import("./image-studio");
          const r = await maybeAddToPropertyCollection({ imageId, propertyId, userId: sessionUserId });
          propertyCollectionId = r.collectionId;
          propertyCollectionCreated = r.created;
        } catch (e: any) {
          console.warn("[chatbgp] property collection link failed:", e?.message);
        }
      }
      if (companyId) {
        try {
          const { maybeAddToBrandCollection } = await import("./image-studio");
          const r = await maybeAddToBrandCollection({ imageId, companyId, brandName, userId: sessionUserId });
          brandCollectionId = r.collectionId;
          brandCollectionCreated = r.created;
        } catch (e: any) {
          console.warn("[chatbgp] brand collection link failed:", e?.message);
        }
      }

      const linkBits = [
        propertyId ? "linked to the CRM property" : null,
        companyId ? "linked to the CRM company" : null,
        propertyCollectionCreated ? `umbrella "Property · ..." folder created` : null,
        propertyCollectionId && !propertyCollectionCreated ? "added to the existing property folder" : null,
        brandCollectionCreated ? `auto-folder "Brand · ${brandName}" created` : null,
        brandCollectionId && !brandCollectionCreated ? "added to the existing brand folder" : null,
      ].filter(Boolean);
      const linkSuffix = linkBits.length ? " — " + linkBits.join(", ") : "";

      return { data: { success: true, imageId, fileName, category, propertyId, companyId, propertyCollectionId, brandCollectionId, message: `Image "${fileName}" saved to Image Studio in the ${category} category${linkSuffix}.` } };
    } catch (err: any) {
      console.error("[chatbgp] Save to Image Studio error:", err?.message);
      return { data: { success: false, error: `Failed to save to Image Studio: ${err?.message}` } };
    }
  }

  if (fnName === "vision_describe_image") {
    try {
      const task = String(fnArgs.task || "structured");
      const applyToImageStudio = fnArgs.applyToImageStudio === true;
      const customPrompt = fnArgs.customPrompt ? String(fnArgs.customPrompt) : "";
      let mimeType = String(fnArgs.mimeType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      let base64: string | null = null;
      let imageStudioId: string | null = fnArgs.imageStudioId ? String(fnArgs.imageStudioId) : null;

      // ── Source the image bytes ────────────────────────────────────────
      if (imageStudioId) {
        const r = await pool.query(
          "SELECT local_path, mime_type, sharepoint_drive_id, sharepoint_item_id, thumbnail_data FROM image_studio_images WHERE id = $1",
          [imageStudioId],
        );
        if (r.rows.length === 0) return { data: { success: false, error: "Image not found in image_studio_images." } };
        const row = r.rows[0];
        mimeType = (row.mime_type || "image/jpeg") as any;
        const fs = await import("fs");
        if (row.local_path && fs.existsSync(row.local_path)) {
          base64 = fs.readFileSync(row.local_path).toString("base64");
        } else if (row.sharepoint_drive_id && row.sharepoint_item_id) {
          const token = await getValidMsToken(req);
          if (!token) return { data: { success: false, error: "Local file missing and not signed into Microsoft to fetch from SharePoint." } };
          const cr = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${row.sharepoint_drive_id}/items/${row.sharepoint_item_id}/content`,
            { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" },
          );
          if (!cr.ok) return { data: { success: false, error: `SharePoint fetch failed: HTTP ${cr.status}` } };
          base64 = Buffer.from(await cr.arrayBuffer()).toString("base64");
        } else if (row.thumbnail_data) {
          // Last resort — thumbnail is small but classification still works.
          base64 = String(row.thumbnail_data).replace(/^data:image\/\w+;base64,/, "");
          mimeType = "image/jpeg";
        } else {
          return { data: { success: false, error: "Image bytes unavailable (no local file, no SharePoint refs, no thumbnail)." } };
        }
      } else if (fnArgs.imageUrl) {
        const url = String(fnArgs.imageUrl);
        // Accept chat-media paths (images dragged into ChatBGP) the same
        // way save_to_image_studio does — they live in file-storage under
        // chat-media/<filename> and never get an https URL. Without this
        // branch, vision can't see anything the user has just pasted.
        if (url.startsWith("/api/chat-media/") || url.startsWith("chat-media/")) {
          const mediaName = url.replace(/^\/?api\/chat-media\//, "").replace(/^chat-media\//, "");
          const { getFile } = await import("./file-storage");
          const file = await getFile(`chat-media/${mediaName}`);
          if (!file) return { data: { success: false, error: `chat-media file not found: ${mediaName}` } };
          mimeType = (file.contentType?.split(";")[0].trim() || (mediaName.match(/\.(png|jpe?g|gif|webp)$/i)?.[1] === "png" ? "image/png" : "image/jpeg")) as any;
          base64 = Buffer.from(file.data).toString("base64");
        } else if (!url.startsWith("https://")) {
          return { data: { success: false, error: "imageUrl must be https:// or a chat-media path" } };
        } else {
          const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
          if (!resp.ok) return { data: { success: false, error: `Image fetch failed: HTTP ${resp.status}` } };
          const ctype = resp.headers.get("content-type") || "image/jpeg";
          if (!ctype.startsWith("image/")) return { data: { success: false, error: `URL did not return an image (${ctype})` } };
          mimeType = (ctype.split(";")[0].trim() as any);
          base64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
        }
      } else if (fnArgs.base64Data) {
        base64 = String(fnArgs.base64Data).replace(/^data:image\/\w+;base64,/, "");
      } else {
        return { data: { success: false, error: "Provide imageStudioId, imageUrl, or base64Data." } };
      }

      // ── Build the prompt for the chosen task ──────────────────────────
      const CATEGORIES = ["Exteriors", "Interiors", "Floor Plans", "Properties", "Areas", "Marketing", "Brands", "Generated", "Headshots", "Other"];
      const taskPrompts: Record<string, string> = {
        describe: "Write a single-paragraph factual description of this image — what it shows, key visible details, mood/condition. No flowery language.",
        classify: `Classify this image into ONE of these categories: ${CATEGORIES.join(", ")}. Respond ONLY with the category name, nothing else.`,
        ocr: "Extract all readable text from this image. Preserve line breaks and structure. If there is no text, respond with 'NO_TEXT'.",
        tag: "Generate 3 to 8 short, lower-case tags describing this image (subject matter, location type, brand if visible, condition, style). Respond as a JSON array of strings, e.g. [\"shopfront\",\"belgravia\",\"luxury-retail\"].",
        structured: `Analyse this image and respond ONLY with valid minified JSON, no other text, in this exact shape: {"description": "single paragraph factual description", "category": "ONE OF: ${CATEGORIES.join("|")}", "tags": ["tag1","tag2",...], "ocr": "all readable text or empty string"}. Tags 3-8, lower-case, hyphen-separated. OCR preserves line breaks with \\n.`,
      };
      const prompt = taskPrompts[task] + (customPrompt ? `\n\nAdditional context: ${customPrompt}` : "");

      // ── Call Claude vision ────────────────────────────────────────────
      const anthropic = getAnthropicClient(false);
      const visionResp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
            { type: "text", text: prompt },
          ],
        }],
      });
      const textBlock = visionResp.content.find(b => b.type === "text") as { type: "text"; text: string } | undefined;
      const raw = textBlock?.text?.trim() || "";

      // ── Parse the response ────────────────────────────────────────────
      let parsed: any = { raw };
      if (task === "structured") {
        try {
          const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
          parsed = JSON.parse(cleaned);
        } catch (e: any) {
          return { data: { success: false, error: `Couldn't parse structured response: ${e?.message}`, raw } };
        }
      } else if (task === "tag") {
        try {
          const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
          parsed = { tags: JSON.parse(cleaned) };
        } catch {
          parsed = { tags: raw.split(/[,\n]/).map(t => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean) };
        }
      } else if (task === "classify") {
        const cat = CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase()) || raw;
        parsed = { category: cat };
      } else if (task === "ocr") {
        parsed = { text: raw === "NO_TEXT" ? "" : raw };
      } else {
        parsed = { description: raw };
      }

      // ── Optionally write back to the image_studio_images row ─────────
      let applied: string[] = [];
      if (applyToImageStudio && imageStudioId) {
        const sets: string[] = [];
        const params: any[] = [];
        if (parsed.description) { params.push(parsed.description); sets.push(`description = $${params.length}`); applied.push("description"); }
        if (parsed.category && CATEGORIES.includes(parsed.category)) { params.push(parsed.category); sets.push(`category = $${params.length}`); applied.push("category"); }
        if (Array.isArray(parsed.tags) && parsed.tags.length) { params.push(parsed.tags); sets.push(`tags = $${params.length}::text[]`); applied.push("tags"); }
        if (task === "ocr" && parsed.text) { params.push(parsed.text); sets.push(`description = $${params.length}`); applied.push("description (OCR)"); }
        if (sets.length) {
          params.push(imageStudioId);
          await pool.query(`UPDATE image_studio_images SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
        }
      }

      return {
        data: { success: true, task, ...parsed, applied: applied.length ? applied : undefined },
        ...(applied.length ? { action: { type: "image_studio_changed" as const } } : {}),
      };
    } catch (err: any) {
      console.error("[chatbgp] vision_describe_image error:", err?.message);
      return { data: { success: false, error: `Vision failed: ${err?.message}` } };
    }
  }

  // ─── Universal document reader ──────────────────────────────────────────
  if (fnName === "read_document") {
    try {
      const { readDocumentForAI } = await import("./document-reader");
      const result = await readDocumentForAI({
        chatMediaFilename: fnArgs.chatMediaFilename as string | undefined,
        storageKey: fnArgs.storageKey as string | undefined,
        brochureId: fnArgs.brochureId as string | undefined,
        includePageImages: fnArgs.includePageImages !== false,
        maxTextChars: typeof fnArgs.maxTextChars === "number" ? fnArgs.maxTextChars : 40_000,
      });
      return { data: result };
    } catch (err: any) {
      return { data: { error: err?.message || String(err) } };
    }
  }

  // ─── General-purpose database tools ─────────────────────────────────────
  if (fnName === "describe_schema") {
    const { executeDescribeSchema } = await import("./sql-tools");
    return { data: executeDescribeSchema(fnArgs.table as string | undefined) };
  }

  if (fnName === "sql_query") {
    const { executeSqlQuery } = await import("./sql-tools");
    return { data: await executeSqlQuery(String(fnArgs.query || "")) };
  }

  if (fnName === "sql_write") {
    const { executeSqlWrite } = await import("./sql-tools");
    const userId = req.session?.userId || (req as any).tokenUserId || undefined;
    const result = await executeSqlWrite(
      {
        table: String(fnArgs.table || ""),
        op: fnArgs.op as "insert" | "update" | "delete",
        data: fnArgs.data as Record<string, any> | undefined,
        rows: fnArgs.rows as Array<Record<string, any>> | undefined,
        where: fnArgs.where as Record<string, any> | undefined,
        returning: fnArgs.returning !== false,
      },
      { userId, threadId: (req.body?.threadId as string) || undefined },
    );
    const action = result.success
      ? { type: "db_changed" as const, table: String(fnArgs.table || ""), op: fnArgs.op }
      : undefined;
    return { data: result, ...(action ? { action } : {}) };
  }

  if (fnName === "manage_chat_members") {
    // Share the CURRENT thread with a colleague (or remove / list). Members
    // get the thread in their own sidebar via the existing chat_thread_members
    // mechanics — same rows the group-chat UI writes.
    const threadId = (req.body?.threadId as string) || null;
    if (!threadId) return { data: { error: "This chat isn't a saved thread yet — once the conversation has a thread (send one message first), people can be added." } };
    const sessionUserId = req.session?.userId || (req as any).tokenUserId || null;
    const action = String(fnArgs.action || "list");
    try {
      const t = await pool.query(`SELECT id, created_by FROM chat_threads WHERE id = $1`, [threadId]);
      if (!t.rows[0]) return { data: { error: "Thread not found." } };
      if (action === "list") {
        const m = await pool.query(
          `SELECT u.id, u.name, 'owner' AS kind FROM users u WHERE u.id = $2
           UNION ALL
           SELECT u.id, u.name, 'member' AS kind
             FROM chat_thread_members tm JOIN users u ON u.id = tm.user_id
            WHERE tm.thread_id = $1`,
          [threadId, t.rows[0].created_by],
        );
        return { data: { members: m.rows } };
      }
      const name = String(fnArgs.personName || "").trim();
      if (!name) return { data: { error: "personName is required for add/remove." } };
      // Staff only: client logins must never be pulled into internal threads.
      let candidates = await pool.query(
        `SELECT id, name FROM users
          WHERE COALESCE(role, '') <> 'Client' AND name ILIKE '%' || $1 || '%'
          ORDER BY name LIMIT 5`,
        [name],
      );
      if (candidates.rows.length === 0 && name.includes(" ")) {
        // Fall back to first-name match ("Jonny" for "Jonny Palmer" typos)
        candidates = await pool.query(
          `SELECT id, name FROM users
            WHERE COALESCE(role, '') <> 'Client' AND name ILIKE '%' || $1 || '%'
            ORDER BY name LIMIT 5`,
          [name.split(/\s+/)[0]],
        );
      }
      if (candidates.rows.length === 0) return { data: { error: `No BGP staff member matching "${name}" found.` } };
      if (candidates.rows.length > 1) {
        return { data: { needsClarification: true, note: "Multiple staff match — ask which one.", candidates: candidates.rows.map((c: any) => c.name) } };
      }
      const person = candidates.rows[0];
      if (action === "add") {
        if (person.id === t.rows[0].created_by) return { data: { ok: true, note: `${person.name} owns this thread already.` } };
        const dupe = await pool.query(`SELECT 1 FROM chat_thread_members WHERE thread_id = $1 AND user_id = $2 LIMIT 1`, [threadId, person.id]);
        if (dupe.rows[0]) return { data: { ok: true, note: `${person.name} is already in this chat.` } };
        await storage.addChatThreadMember({ threadId, userId: person.id, addedBy: sessionUserId, seen: false });
        try {
          const { emitMemberAdded } = await import("./websocket");
          emitMemberAdded(threadId, person.id, person.name);
        } catch {}
        return { data: { ok: true, added: person.name, note: `${person.name} now sees this thread in their ChatBGP sidebar with the full history and can join the conversation.` } };
      }
      if (action === "remove") {
        await storage.removeChatThreadMember(threadId, person.id);
        try {
          const { emitMemberRemoved } = await import("./websocket");
          emitMemberRemoved(threadId, person.id);
        } catch {}
        return { data: { ok: true, removed: person.name } };
      }
      return { data: { error: `Unknown action "${action}".` } };
    } catch (err: any) {
      return { data: { error: err?.message || String(err) } };
    }
  }

  if (fnName === "web_search") {
    const searchQuery = fnArgs.query as string;
    try {
      if (!isPerplexityConfigured()) return { data: { error: "Web search not configured (PERPLEXITY_API_KEY missing)" } };
      const r = await askPerplexity(searchQuery, { maxTokens: 800, temperature: 0.1 });
      console.log(`[ChatBGP] Web search for "${searchQuery}" via Perplexity — ${r.citations.length} citations`);
      return { data: { answer: r.answer, citations: r.citations, query: searchQuery } };
    } catch (err: any) {
      console.error("[chatbgp] Web search error:", err?.message);
      return { data: { error: `Web search failed: ${err?.message}` } };
    }
  }

  if (fnName === "ingest_url") {
    // bgp.uk.com is a JS app — its HTML carries only the title. Read the
    // machine-readable site.json instead (see chatbgp-app-map).
    if (typeof fnArgs.url === "string" && /(^|\/\/|\.)bgp\.uk\.com/i.test(fnArgs.url) && !/site\.json/i.test(fnArgs.url)) fnArgs.url = "https://www.bgp.uk.com/site.json";
    // Digest trade-press articles into structured deal facts — the prose
    // says "Fred Perry took 4,000 sq ft at £150 ZA"; the comps board wants
    // fields. Extraction only fires for property-press domains so ordinary
    // page reads don't pay a Haiku call.
    const DEAL_PRESS_RE = /greenstreetnews\.com|propertyweek\.com|costar\.com|reactnews\.com|egi\.co\.uk|estatesgazette|bisnow\.com|retail-week\.com|thecaterer\.com|bighospitality\.co\.uk|drapersonline\.com/i;
    async function extractDealFacts(url: string, title: string, text: string): Promise<any[] | null> {
      if (!DEAL_PRESS_RE.test(url) || text.length < 600) return null;
      try {
        const { callClaude, CHATBGP_HELPER_MODEL } = await import("./utils/anthropic-client");
        const r = await callClaude({
          model: CHATBGP_HELPER_MODEL,
          max_completion_tokens: 900,
          temperature: 0,
          messages: [{
            role: "user",
            content: `Extract UK property DEAL FACTS from this trade-press article. Return a STRICT JSON array (possibly empty), no prose:\n` +
              `[{"kind":"letting"|"investment","address":string,"scheme":string?,"tenant":string?,"buyer":string?,"seller":string?,"landlord":string?,"rent":string?,"rentPsfZa":string?,"price":string?,"yield":string?,"areaSqFt":number?,"leaseTermYears":number?,"date":string?}]\n` +
              `Only include transactions the article actually reports, each with at least an address/scheme and one commercial number.\n\nTitle: ${title}\n\n${text.slice(0, 9000)}`,
          }],
        });
        const raw = r.choices?.[0]?.message?.content || "";
        const s = raw.indexOf("["), e = raw.lastIndexOf("]");
        if (s < 0 || e <= s) return null;
        const arr = JSON.parse(raw.slice(s, e + 1));
        return Array.isArray(arr) && arr.length ? arr.slice(0, 10) : null;
      } catch { return null; }
    }
    const targetUrl = fnArgs.url as string;
    try {
      // Subscriber cookies (Green Street, Property Week, Drapers...) ride
      // along automatically — without them a paywalled URL returns the
      // teaser, not the article BGP's subscription entitles it to.
      const { authHeadersForUrl } = await import("./auth-cookies");
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          ...authHeadersForUrl(targetUrl),
        },
        redirect: "follow",
      });
      if (!response.ok) return { data: { error: `Failed to fetch URL: HTTP ${response.status}` } };
      const contentType = response.headers.get("content-type") || "";
      let extractedText = "";
      let title = "";

      if (contentType.includes("pdf") || targetUrl.toLowerCase().endsWith(".pdf")) {
        const buffer = await response.arrayBuffer();
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse(new Uint8Array(buffer));
        const textResult = await parser.getText();
        extractedText = textResult.pages.map((p: any) => p.text || "").join("\n\n");
        const info = await parser.getInfo();
        title = info?.info?.Title || targetUrl.split("/").pop()?.replace(/-/g, " ").replace(".pdf", "") || "PDF Document";
      } else {
        ({ title, extractedText } = await ingestNonPdfBody(response, targetUrl, contentType));
      }

      const truncated = extractedText.substring(0, 15000);

      if (fnArgs.addToNews) {
        const { pool } = await import("./db");
        const { v4: uuid } = await import("uuid");
        const articleId = uuid();
        const sourceName = fnArgs.sourceName || new URL(targetUrl).hostname.replace("www.", "");
        await pool.query(
          `INSERT INTO news_articles (id, source_name, title, url, summary, category, published_at, processed)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)`,
          [articleId, sourceName, title, targetUrl, truncated.substring(0, 2000), "research"]
        );
        return { data: { success: true, action: "ingested_and_saved", title, contentLength: extractedText.length, articleId, content: truncated } };
      }

      const dealFacts = await extractDealFacts(targetUrl, title, extractedText);
      return { data: {
        success: true, action: "ingested", title, contentLength: extractedText.length, content: truncated,
        ...(dealFacts ? {
          dealFacts,
          dealFactsNote: "Structured transactions extracted from this article. Offer to save the relevant ones — lettings to retail_leasing_comps, investment deals to the comps board (sql_write) — citing this URL as the source. Ask before writing.",
        } : {}),
      } };
    } catch (err: any) {
      return { data: { error: `Failed to ingest URL: ${err.message}` } };
    }
  }

  if (fnName === "follow_url") {
    const targetUrl = (fnArgs.url as string || "").trim();
    if (!targetUrl) return { data: { error: "url is required" } };
    try {
      const { newsSources } = await import("@shared/schema");
      const { createRssAppFeed } = await import("./rssapp");
      const existing = await db.select().from(newsSources).where(eq(newsSources.url, targetUrl)).limit(1);
      if (existing.length > 0) {
        return { data: { success: true, action: "already_following", source: existing[0], message: `Already tracking ${existing[0].name}.` } };
      }
      const feed = await createRssAppFeed(targetUrl);
      const [source] = await db.insert(newsSources).values({
        name: (fnArgs.name as string) || feed.title || new URL(targetUrl).hostname.replace("www.", ""),
        url: targetUrl,
        feedUrl: feed.rss_feed_url,
        type: "rssapp",
        category: (fnArgs.category as string) || "general",
        active: true,
      }).returning();
      console.log(`[ChatBGP] follow_url: registered "${source.name}" (${targetUrl}) via RSS.app`);
      return { data: { success: true, action: "now_following", source, message: `Now tracking ${source.name}. New articles will appear in your news feed on the next poll.` } };
    } catch (err: any) {
      return { data: { error: `Failed to follow URL: ${err?.message || err}` } };
    }
  }

  if (fnName === "search_news") {
    const { newsArticles } = await import("@shared/schema");
    const { ilike, or, desc: descOrder } = await import("drizzle-orm");
    const query = (fnArgs.query as string || "").trim();
    const limit = fnArgs.limit || 10;
    const words = query.split(/\s+/).filter((w: string) => w.length >= 2);
    const conditions: any[] = [];
    for (const w of words) {
      const pat = `%${w}%`;
      conditions.push(ilike(newsArticles.title, pat));
      conditions.push(ilike(newsArticles.summary, pat));
    }
    if (conditions.length === 0) return { data: { error: "Search term too short" } };
    const articles = await db.select({
      id: newsArticles.id, title: newsArticles.title, summary: newsArticles.aiSummary,
      url: newsArticles.url, publishedAt: newsArticles.publishedAt, source: newsArticles.sourceName,
    }).from(newsArticles).where(or(...conditions)).orderBy(descOrder(newsArticles.publishedAt)).limit(limit);
    return { data: { success: true, query, totalFound: articles.length, articles } };
  }

  if (fnName === "search_green_street") {
    const { searchGreenStreet } = await import("./news-feeds");
    const query = (fnArgs.query as string || "").trim();
    const limit = fnArgs.limit || 10;
    if (!query) return { data: { error: "Please provide a search term" } };
    const result = await searchGreenStreet(query, limit);
    return { data: result };
  }

  if (fnName === "property_data_lookup") {
    const apiKey = process.env.PROPERTYDATA_API_KEY;
    if (!apiKey) return { data: { error: "PropertyData API key not configured. Add PROPERTYDATA_API_KEY to environment secrets." } };
    // No allowlist — PropertyData ship new endpoints regularly and a
    // hardcoded list goes stale. Validate the SHAPE of the endpoint
    // name only: lowercase letters, digits, hyphens, no path-escape
    // characters. That blocks SSRF / injection while letting any
    // legitimate PropertyData endpoint through.
    const VALID_ENDPOINT = /^[a-z0-9][a-z0-9-]{1,60}$/;
    const endpoint = fnArgs.endpoint as string;
    if (!endpoint || !VALID_ENDPOINT.test(endpoint)) return { data: { error: `Invalid endpoint name "${endpoint}". Endpoint names must be lowercase letters/digits/hyphens only (e.g. "sold-prices", "freeholds", "valuation-commercial-sale").` } };
    const postcode = (fnArgs.postcode as string || "").trim().replace(/\s{2,}/g, " ");
    const needsPostcode = !["uprn", "uprn-title", "analyse-buildings", "land-registry-documents"].includes(endpoint);
    if (needsPostcode && !postcode) return { data: { error: "Postcode is required." } };
    if (endpoint === "address-match-uprn" && !fnArgs.address) return { data: { error: "Both 'address' (street address, e.g. '10 Lowndes Street') and 'postcode' are required for address-match-uprn." } };
    if (endpoint === "land-registry-documents" && !fnArgs.title) return { data: { error: "Title number is required for land-registry-documents." } };
    // Land Registry docs get a dedicated path: multi-title support (comma/
    // space-separated) + server-side ZIP download and PDF text extraction so
    // the register contents come back readable instead of as a bare link.
    if (endpoint === "land-registry-documents") {
      const titles = String(fnArgs.title).split(/[,\s]+/).filter(Boolean);
      const docs = await fetchLandRegistryDocuments(apiKey, titles, (fnArgs.documents as string) || "both", fnArgs.extract_proprietor_data !== false);
      const undelivered = docs.filter((d) => !d.delivered);
      const noteParts: string[] = [];
      if (docs.some((d) => d.delivered)) noteParts.push("Delivered documents include the extracted register text (files[].text) and a documentUrl download link — present documentUrl as a bare URL on its own line so the chat UI renders it clickable.");
      if (undelivered.length) noteParts.push(`PropertyData returned NO document for ${undelivered.map((d) => d.title).join(", ")} — this is the known flakiness on regional/OCOD titles, NOT a 'nothing happened' result and nothing was charged. For each, relay registerKnown (verified owner/parcel from our own HMLR register) if present, and give the user manualOrder.url to order the official plan/register direct from HMLR (£3 each). Do NOT retry this endpoint for those titles.`);
      return { data: { success: docs.some((d) => d.delivered), source: "PropertyData.co.uk", endpoint, results: docs, note: noteParts.join(" ") } };
    }
    try {
      const params = new URLSearchParams({ key: apiKey });
      if (postcode) params.set("postcode", postcode);
      if (fnArgs.property_type) params.set("type", fnArgs.property_type);
      if (fnArgs.internal_area) params.set("internal_area", String(fnArgs.internal_area));
      if (fnArgs.bedrooms !== undefined) params.set("bedrooms", String(fnArgs.bedrooms));
      if (fnArgs.max_age) params.set("max_age", String(fnArgs.max_age));
      if (fnArgs.address) params.set("address", fnArgs.address as string);
      if (fnArgs.uprn) params.set("uprn", String(fnArgs.uprn));
      if (fnArgs.title) params.set("title", fnArgs.title as string);
      if (endpoint.startsWith("valuation-commercial") || endpoint === "rebuild-cost") {
        if (fnArgs.property_type) params.set("property_type", fnArgs.property_type);
        params.delete("type");
      }
      const url = `https://api.propertydata.co.uk/${endpoint}?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        let errBody = "";
        try { errBody = await res.text(); } catch {}
        return { data: { error: `PropertyData API returned HTTP ${res.status}`, detail: errBody.slice(0, 500) } };
      }
      const data = await res.json() as any;
      if (data.status === "error") {
        return { data: { error: data.message || "PropertyData API error", code: data.code } };
      }
      return { data: { success: true, source: "PropertyData.co.uk", endpoint, postcode: fnArgs.postcode, ...data } };
    } catch (err: any) {
      return { data: { error: `PropertyData API error: ${err?.message}` } };
    }
  }

  if (fnName === "tfl_nearby") {
    const postcode = (fnArgs.postcode as string || "").trim();
    if (!postcode) return { data: { error: "Postcode is required." } };
    try {
      const geocodeResp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
      if (!geocodeResp.ok) return { data: { error: "Could not geocode postcode." } };
      const geoData = await geocodeResp.json() as any;
      const lat = geoData.result?.latitude;
      const lng = geoData.result?.longitude;
      if (!lat || !lng) return { data: { error: "Could not geocode postcode." } };
      const radius = Math.max(100, Math.min(Number(fnArgs.radius) || 1500, 3000));
      const url = `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=${radius}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return { data: { error: `TfL API returned HTTP ${resp.status}` } };
      const data = await resp.json() as any;
      const stations = (data.stopPoints || []).map((s: any) => ({
        name: s.commonName,
        distance: Math.round(s.distance || 0),
        walkMinutes: Math.round((s.distance || 0) / 80),
        modes: (s.modes || []).map((m: string) => m === "tube" ? "Tube" : m === "national-rail" ? "National Rail" : m === "dlr" ? "DLR" : m === "overground" ? "Overground" : m === "elizabeth-line" ? "Elizabeth line" : m),
        lines: (s.lines || []).map((l: any) => l.name),
      })).sort((a: any, b: any) => a.distance - b.distance);
      return { data: { success: true, source: "TfL API", postcode, searchRadius: radius, stationCount: stations.length, stations } };
    } catch (err: any) {
      return { data: { error: `TfL API error: ${err?.message}` } };
    }
  }

  if (fnName === "log_lease_event") {
    try {
      const { tenant, address, unitRef, eventType, eventDate, noticeDate, currentRent, estimatedErv, sqft, sourceEvidence, sourceUrl, sourceTitle, notes } = fnArgs as any;
      if (!tenant || !eventType) return { data: { success: false, error: "tenant and eventType are required" } };
      const userId = req.session?.userId || (req as any).tokenUserId || "chatbgp";
      const { leaseEvents } = await import("@shared/schema");
      const [row] = await db.insert(leaseEvents).values({
        tenant,
        address: address || null,
        unitRef: unitRef || null,
        eventType,
        eventDate: eventDate ? new Date(eventDate) : null,
        noticeDate: noticeDate ? new Date(noticeDate) : null,
        currentRent: currentRent || null,
        estimatedErv: estimatedErv || null,
        sqft: sqft || null,
        sourceEvidence: sourceEvidence || "ChatBGP",
        sourceUrl: sourceUrl || null,
        sourceTitle: sourceTitle || null,
        notes: notes || null,
        status: "Monitoring",
        createdBy: userId,
      }).returning();
      return { data: { success: true, id: row.id, message: `Logged ${eventType} for ${tenant}${eventDate ? ` on ${new Date(eventDate).toLocaleDateString("en-GB")}` : ""}. Visible on the Lease Events board.` } };
    } catch (err: any) {
      return { data: { success: false, error: err?.message } };
    }
  }

  if (fnName === "query_wip") {
    let sql = `SELECT id, name, group_name AS "groupName", deal_type AS "dealType", status, team, pricing, fee, rent_pa AS "rentPa", total_area_sqft AS "totalAreaSqft" FROM crm_deals WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;
    if (fnArgs.team) { sql += ` AND $${idx}::text = ANY(team)`; params.push(fnArgs.team); idx++; }
    if (fnArgs.status) { sql += ` AND group_name ILIKE $${idx}`; params.push(`%${escapeLike(fnArgs.status)}%`); idx++; }
    if (fnArgs.dealType) { sql += ` AND deal_type ILIKE $${idx}`; params.push(`%${escapeLike(fnArgs.dealType)}%`); idx++; }
    sql += ` ORDER BY created_at DESC`;
    const result = await pool.query(sql, params);
    const deals = result.rows;
    const totalPipeline = deals.reduce((sum: number, d: any) => sum + (parseFloat(d.pricing) || 0), 0);
    const totalFees = deals.reduce((sum: number, d: any) => sum + (parseFloat(d.fee) || 0), 0);
    const byStage: Record<string, number> = {};
    for (const d of deals) byStage[d.status || "Unknown"] = (byStage[d.status || "Unknown"] || 0) + 1;
    const summary = { totalDeals: deals.length, totalPipeline, totalFees, byStage };
    return { data: fnArgs.summaryOnly ? { success: true, summary } : { success: true, summary, deals: deals.slice(0, 50) } };
  }

  if (fnName === "query_xero") {
    let sql = `SELECT xi.id, xi.deal_id AS "dealId", xi.xero_invoice_id AS "xeroInvoiceId", xi.invoice_number AS "invoiceNumber", xi.reference, xi.status, xi.total_amount AS "total", xi.currency, xi.due_date AS "dueDate", xi.sent_to_xero AS "sentToXero", cd.name AS "dealName" FROM xero_invoices xi LEFT JOIN crm_deals cd ON xi.deal_id = cd.id WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;
    if (fnArgs.dealId) { sql += ` AND xi.deal_id = $${idx}`; params.push(fnArgs.dealId); idx++; }
    if (fnArgs.query) { sql += ` AND (xi.reference ILIKE $${idx} OR xi.invoice_number ILIKE $${idx} OR cd.name ILIKE $${idx})`; params.push(`%${escapeLike(fnArgs.query)}%`); idx++; }
    sql += ` ORDER BY xi.created_at DESC LIMIT 20`;
    const result = await pool.query(sql, params);
    return { data: { success: true, invoices: result.rows, totalFound: result.rows.length } };
  }

  if (fnName === "scan_duplicates") {
    const entityType = fnArgs.entityType;
    let sql = "";
    if (entityType === "contacts") sql = `SELECT MIN(name) as name, COUNT(*) as count FROM crm_contacts GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 20`;
    else if (entityType === "companies") sql = `SELECT MIN(name) as name, COUNT(*) as count FROM crm_companies GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 20`;
    else if (entityType === "properties") sql = `SELECT MIN(name) as name, COUNT(*) as count FROM crm_properties GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 20`;
    else return { data: { error: "Unknown entity type" } };
    const result = await pool.query(sql);
    return { data: { success: true, entityType, duplicates: result.rows, totalFound: result.rows.length } };
  }

  if (fnName === "delete_record") {
    const { storage } = await import("./storage");
    const deleteMap: Record<string, (id: string) => Promise<void>> = {
      deal: (id) => storage.deleteCrmDeal(id),
      contact: (id) => storage.deleteCrmContact(id),
      company: (id) => storage.deleteCrmCompany(id),
      property: (id) => storage.deleteCrmProperty(id),
    };
    const deleteFn = deleteMap[fnArgs.entityType];
    if (!deleteFn) return { data: { error: `Unknown entity type: ${fnArgs.entityType}` } };
    await deleteFn(fnArgs.id);
    return { data: { success: true, action: "deleted", entity: fnArgs.entityType, id: fnArgs.id, name: fnArgs.confirmName }, action: { type: "crm_deleted", entityType: fnArgs.entityType, id: fnArgs.id } };
  }

  if (fnName === "navigate_to") {
    const pageRoutes: Record<string, string> = {
      dashboard: "/", deals: "/deals", comps: "/comps", "investment-comps": "/investment-comps",
      contacts: "/contacts", companies: "/companies", properties: "/properties",
      requirements: "/requirements", instructions: "/instructions", news: "/news",
      mail: "/mail", chatbgp: "/chatbgp", sharepoint: "/sharepoint", models: "/models",
      templates: "/templates", settings: "/settings", "land-registry": "/land-registry",
      "voa-rates": "/business-rates", "business-rates": "/business-rates",
      "intelligence-map": "/edozo", "leasing-units": "/available", "leasing-schedule": "/leasing-schedule",
      "investment-tracker": "/investment-tracker", "wip-report": "/deals/report",
      "property-map": "/property-map", map: "/property-map",
    };
    let path = pageRoutes[fnArgs.page] || "/";
    if ((fnArgs.page === "property-map" || fnArgs.page === "map") && fnArgs.lat && fnArgs.lng) {
      path += `?lat=${fnArgs.lat}&lng=${fnArgs.lng}` + (fnArgs.zoom ? `&zoom=${fnArgs.zoom}` : "&zoom=17");
    }
    return { data: { success: true, navigatedTo: fnArgs.page }, action: { type: "navigate", path } };
  }


  if (fnName === "generate_claude_designed_pdf") {
    try {
      const format = String(fnArgs.format || "pdf");
      if (format === "pptx") {
        const { generateClaudeDesignedPptx } = await import("./claude-designed-pptx");
        return { data: await generateClaudeDesignedPptx(fnArgs) };
      }
      if (format === "both") {
        const [{ generateClaudeDesignedPdf }, { generateClaudeDesignedPptx }] = await Promise.all([
          import("./claude-designed-pdf"),
          import("./claude-designed-pptx"),
        ]);
        const [pdf, pptx] = await Promise.all([
          generateClaudeDesignedPdf(fnArgs),
          generateClaudeDesignedPptx(fnArgs),
        ]);
        const links = [
          (pdf as any).downloadMarkdown,
          (pptx as any).downloadMarkdown,
        ].filter(Boolean).join("\n");
        return {
          data: {
            success: !("error" in pdf) || !("error" in pptx),
            pdf,
            pptx,
            downloadMarkdown: links,
            message: `Generated both versions — locked PDF + editable PowerPoint. Give the user BOTH download links verbatim from downloadMarkdown.`,
          },
        };
      }
      const { generateClaudeDesignedPdf } = await import("./claude-designed-pdf");
      const result = await generateClaudeDesignedPdf(fnArgs);
      return { data: result };
    } catch (err: any) {
      console.error("[chatbgp] generate_claude_designed_pdf error:", err?.message);
      return { data: { error: `Claude-designed document failed: ${err?.message}` } };
    }
  }

  if (fnName === "compile_brochure_from_pdfs") {
    try {
      const { compileBrochureFromPdfs } = await import("./chatbgp-design-tools");
      const result = await compileBrochureFromPdfs(fnArgs, req);
      return { data: result };
    } catch (err: any) {
      console.error("[chatbgp] compile_brochure_from_pdfs error:", err?.message);
      return { data: { error: `Brochure compilation failed: ${err?.message}` } };
    }
  }

  if (fnName === "sign_pdf") {
    try {
      const { signPdf } = await import("./chatbgp-design-tools");
      return { data: await signPdf(fnArgs, req) };
    } catch (err: any) {
      console.error("[chatbgp] sign_pdf error:", err?.message);
      return { data: { error: `PDF signing failed: ${err?.message}` } };
    }
  }

  if (fnName === "save_signature") {
    try {
      const { saveUserSignature } = await import("./chatbgp-design-tools");
      return { data: await saveUserSignature(fnArgs, req) };
    } catch (err: any) {
      console.error("[chatbgp] save_signature error:", err?.message);
      return { data: { error: `Saving the signature failed: ${err?.message}` } };
    }
  }

  if (fnName === "copy_dropbox_to_sharepoint") {
    try {
      const { copyDropboxToSharepoint } = await import("./chatbgp-design-tools");
      const result = await copyDropboxToSharepoint(fnArgs, req);
      return { data: result };
    } catch (err: any) {
      console.error("[chatbgp] copy_dropbox_to_sharepoint error:", err?.message);
      return { data: { error: `Dropbox→SharePoint copy failed: ${err?.message}` } };
    }
  }

  if (fnName === "generate_word") {
    try {
      const docx = await import("docx");
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");

      const sections = (fnArgs.sections as any[]) || [];
      const children: any[] = [];

      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: "BRUCE GILLINGHAM POLLARD", bold: true, size: 20, font: "Calibri", color: "232323" })],
        spacing: { after: 100 },
      }));
      children.push(new docx.Paragraph({
        border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "232323" } },
        spacing: { after: 300 },
      }));
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: fnArgs.title as string, bold: true, size: 32, font: "Calibri", color: "232323" })],
        heading: docx.HeadingLevel.TITLE,
        spacing: { after: 200 },
      }));

      for (const section of sections) {
        if (section.heading) {
          const level = section.level === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_1;
          children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: section.heading, bold: true, size: level === docx.HeadingLevel.HEADING_1 ? 28 : 24, font: "Calibri" })],
            heading: level,
            spacing: { before: 240, after: 120 },
          }));
        }
        if (section.paragraphs) {
          for (const para of section.paragraphs) {
            children.push(new docx.Paragraph({
              children: [new docx.TextRun({ text: para, size: 22, font: "Calibri" })],
              spacing: { after: 120 },
            }));
          }
        }
        if (section.bullets) {
          for (const bullet of section.bullets) {
            children.push(new docx.Paragraph({
              children: [new docx.TextRun({ text: bullet, size: 22, font: "Calibri" })],
              bullet: { level: 0 },
              spacing: { after: 60 },
            }));
          }
        }
        if (section.table && section.table.headers && section.table.rows) {
          const headerRow = new docx.TableRow({
            children: section.table.headers.map((h: string) => new docx.TableCell({
              children: [new docx.Paragraph({ children: [new docx.TextRun({ text: h, bold: true, size: 20, font: "Calibri" })] })],
              shading: { fill: "232323", type: docx.ShadingType.SOLID, color: "FFFFFF" },
              verticalAlign: docx.VerticalAlign.CENTER,
            })),
            tableHeader: true,
          });
          const dataRows = section.table.rows.map((row: string[], ri: number) => new docx.TableRow({
            children: row.map((cell: string) => new docx.TableCell({
              children: [new docx.Paragraph({ children: [new docx.TextRun({ text: cell, size: 20, font: "Calibri" })] })],
              shading: ri % 2 === 0 ? { fill: "F5F5F5", type: docx.ShadingType.SOLID } : undefined,
              verticalAlign: docx.VerticalAlign.CENTER,
            })),
          }));
          children.push(new docx.Table({
            rows: [headerRow, ...dataRows],
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
          }));
          children.push(new docx.Paragraph({ spacing: { after: 120 } }));
        }
      }

      const doc = new docx.Document({
        sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
        styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      });

      const buffer = await docx.Packer.toBuffer(doc);
      const safeName = (fnArgs.title as string).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.docx`;

      await saveFile(`chat-media/${storageFilename}`, Buffer.from(buffer), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${safeName}.docx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      return {
        data: {
          success: true, downloadUrl, filename: `${safeName}.docx`, action: "word_generated",
          downloadMarkdown: `[📄 Download ${safeName}.docx](${downloadUrl})`,
          instruction: "IMPORTANT: Include the downloadMarkdown text EXACTLY as-is in your response so the user can download the file.",
        },
        action: { type: "download", url: downloadUrl, filename: `${safeName}.docx` },
      };
    } catch (err: any) {
      console.error("[chatbgp] Word generation error:", err?.message);
      return { data: { error: `Failed to generate Word document: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "generate_pptx") {
    try {
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");
      const { buffer: pptxBuffer, safeName, slideCount } = await buildDeckPptxFromArgs(fnArgs);
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.pptx`;
      await saveFile(`chat-media/${storageFilename}`, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      return {
        data: {
          success: true, downloadUrl, filename: `${safeName}.pptx`, slides: slideCount, action: "pptx_generated",
          downloadMarkdown: `[📊 Download ${safeName}.pptx](${downloadUrl})`,
          instruction: "IMPORTANT: Include the downloadMarkdown text EXACTLY as-is in your response so the user can download the file.",
        },
        action: { type: "download", url: downloadUrl, filename: `${safeName}.pptx` },
      };
    } catch (err: any) {
      console.error("[chatbgp] PowerPoint generation error:", err?.message);
      return { data: { error: `Failed to generate PowerPoint: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "generate_org_chart") {
    try {
      if (!fnArgs.tree || typeof fnArgs.tree !== "object" || !fnArgs.tree.name) {
        return { data: { error: "tree is required — a nested { name, role?, support?, children? } hierarchy" } };
      }
      const { buildOrgChartPptx } = await import("./org-chart-pptx");
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");
      const pptxBuffer = await buildOrgChartPptx({ title: String(fnArgs.title || "Organisation Chart"), tree: fnArgs.tree, notes: Array.isArray(fnArgs.notes) ? fnArgs.notes : undefined });
      const safeName = String(fnArgs.title || "Organisation_Chart").replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}.pptx`;
      await saveFile(`chat-media/${storageFilename}`, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      return {
        data: {
          success: true, downloadUrl, filename: `${safeName}.pptx`, action: "pptx_generated",
          downloadMarkdown: `[📊 Download ${safeName}.pptx](${downloadUrl})`,
          instruction: "IMPORTANT: Include the downloadMarkdown text EXACTLY as-is in your response so the user can download the file.",
        },
        action: { type: "download", url: downloadUrl, filename: `${safeName}.pptx` },
      };
    } catch (err: any) {
      console.error("[chatbgp] org chart generation error:", err?.message);
      return { data: { error: `Failed to generate org chart: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "check_covenant") {
    try {
      const { getCovenantReport, addToWatchlist } = await import("./covenant-engine");
      const { chFetch } = await import("./companies-house");
      let num: string | null = fnArgs.companyNumber ? String(fnArgs.companyNumber).trim() : null;
      let resolvedFrom: string | null = null;
      if (!num && fnArgs.companyName) {
        const search = await chFetch(`/search/companies?q=${encodeURIComponent(String(fnArgs.companyName))}&items_per_page=5`);
        const hit = (search?.items || [])[0];
        if (!hit) return { data: { error: `No Companies House match for "${fnArgs.companyName}"` } };
        num = hit.company_number;
        resolvedFrom = `${hit.title} (${hit.company_number}) — ${hit.company_status}`;
      }
      if (!num) return { data: { error: "Provide companyNumber or companyName" } };
      const report = await getCovenantReport(num, { refresh: !!fnArgs.refresh });
      if (fnArgs.watch) await addToWatchlist(num, report.companyName).catch(() => {});
      return {
        data: {
          resolvedFrom,
          company: `${report.companyName} (${report.companyNumber})`,
          grade: report.grade, score: report.score, status: report.status,
          verdict: report.verdict,
          flags: report.flags,
          signals: report.signals,
          ccjNote: `CCJs have no free API — official register search ~£6-10: ${report.ccjCheckUrl}`,
          watched: !!fnArgs.watch,
        },
      };
    } catch (err: any) {
      return { data: { error: `Covenant check failed: ${err?.message || "unknown"}` } };
    }
  }

  if (fnName === "generate_why_buy_deck") {
    const { generateWhyBuyForChat } = await import("./why-buy-pptx");
    return await generateWhyBuyForChat(fnArgs, req);
  }

  if (fnName === "send_email") {
    try {
      const { sendSharedMailboxEmail } = await import("./shared-mailbox");
      const attachments = await resolveChatMediaAttachments(fnArgs.chatMediaAttachments);
      await sendSharedMailboxEmail({
        to: fnArgs.to,
        subject: fnArgs.subject,
        body: fnArgs.body,
        cc: fnArgs.cc,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      return {
        data: {
          success: true,
          action: "email_sent",
          to: fnArgs.to,
          subject: fnArgs.subject,
          attachmentCount: attachments.length,
        },
        action: { type: "email_sent", to: fnArgs.to },
      };
    } catch (emailErr: any) {
      return { data: { error: `Failed to send email: ${emailErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "reply_email") {
    try {
      const { replyToSharedMailboxMessage } = await import("./shared-mailbox");
      const ccList = fnArgs.cc ? [fnArgs.cc] : undefined;
      const attachments = await resolveChatMediaAttachments(fnArgs.chatMediaAttachments);
      await replyToSharedMailboxMessage(
        fnArgs.messageId,
        fnArgs.body,
        ccList,
        attachments.length > 0 ? attachments : undefined,
      );
      return {
        data: {
          success: true,
          action: "email_replied",
          messageId: fnArgs.messageId,
          attachmentCount: attachments.length,
        },
        action: { type: "email_sent" },
      };
    } catch (replyErr: any) {
      return { data: { error: `Failed to reply to email: ${replyErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "search_emails") {
    try {
      const searchQuery = fnArgs.query;
      const top = Math.min(fnArgs.top || 50, 500);
      const mailboxArg = typeof fnArgs.mailbox === "string" ? fnArgs.mailbox.trim().toLowerCase() : "";
      const results = await runSearchEmailsTool({ query: searchQuery, top, mailbox: mailboxArg, req });
      if ("error" in results) return { data: { error: results.error } };
      return { data: { results: results.messages, count: results.messages.length, query: searchQuery, scope: results.scope } };
    } catch (searchErr: any) {
      return { data: { error: `Email search error: ${searchErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "search_calendar") {
    try {
      const searchQuery = fnArgs.query;
      const top = Math.min(fnArgs.top || 50, 500);
      const mailboxArg = typeof fnArgs.mailbox === "string" ? fnArgs.mailbox.trim().toLowerCase() : "";
      const results = await runSearchCalendarTool({
        query: searchQuery,
        top,
        mailbox: mailboxArg,
        startDateTime: fnArgs.startDateTime,
        endDateTime: fnArgs.endDateTime,
        req,
      });
      if ("error" in results) return { data: { error: results.error } };
      return { data: { results: results.events, count: results.events.length, query: searchQuery, scope: results.scope } };
    } catch (searchErr: any) {
      return { data: { error: `Calendar search error: ${searchErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "get_email_attachments") {
    try {
      const msgId = encodeURIComponent(fnArgs.messageId);
      const mailboxEmail: string | undefined = fnArgs.mailboxEmail;
      // Cross-mailbox path: route via app token on /users/{email}/messages/...
      // Graph message IDs are mailbox-scoped, so using /me here against an id
      // from another user's mailbox returns ErrorInvalidMailboxItemId.
      if (mailboxEmail) {
        const { graphRequest } = await import("./shared-mailbox");
        const data = await graphRequest(
          `/users/${encodeURIComponent(mailboxEmail)}/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline`,
          { headers: { "X-AnchorMailbox": mailboxEmail } as any }
        );
        const attachments = (data?.value || [])
          .filter((a: any) => !a.isInline && a["@odata.type"] !== "#microsoft.graph.itemAttachment")
          .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
        return { data: { attachments, count: attachments.length, mailboxEmail } };
      }
      const token = await getValidMsToken(req);
      if (!token) return { data: { error: "Not connected to Microsoft 365. Please sign in first." } };
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline`,
        { headers }
      );
      if (!graphRes.ok) {
        const errText = await graphRes.text();
        return { data: { error: `Failed to fetch attachments: ${graphRes.status} ${errText.slice(0, 200)}${errText.includes("ErrorInvalidMailboxItemId") ? " — this message is in another user's mailbox. Pass mailboxEmail (from the search_emails result)." : ""}` } };
      }
      const data = await graphRes.json();
      const attachments = (data.value || [])
        .filter((a: any) => !a.isInline && a["@odata.type"] !== "#microsoft.graph.itemAttachment")
        .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
      return { data: { attachments, count: attachments.length } };
    } catch (err: any) {
      return { data: { error: `Attachment list error: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "download_email_attachment") {
    try {
      const action = fnArgs.action || "read";
      if (action === "save_to_sharepoint" && !fnArgs.folderPath) {
        return { data: { error: "folderPath is required when action is 'save_to_sharepoint'." } };
      }
      const msgId = encodeURIComponent(fnArgs.messageId);
      const attId = encodeURIComponent(fnArgs.attachmentId);
      const mailboxEmail: string | undefined = fnArgs.mailboxEmail;
      let attachment: any;
      if (mailboxEmail) {
        const { graphRequest } = await import("./shared-mailbox");
        attachment = await graphRequest(
          `/users/${encodeURIComponent(mailboxEmail)}/messages/${msgId}/attachments/${attId}`,
          { headers: { "X-AnchorMailbox": mailboxEmail } as any }
        );
      } else {
        const token = await getValidMsToken(req);
        if (!token) return { data: { error: "Not connected to Microsoft 365. Please sign in first." } };
        const headers = { Authorization: `Bearer ${token}` };
        const graphRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments/${attId}`,
          { headers }
        );
        if (!graphRes.ok) {
          const errText = await graphRes.text();
          return { data: { error: `Failed to download attachment: ${graphRes.status} ${errText.slice(0, 200)}${errText.includes("ErrorInvalidMailboxItemId") ? " — this message is in another user's mailbox. Pass mailboxEmail (from the search_emails result)." : ""}` } };
        }
        attachment = await graphRes.json();
      }
      if (!attachment.contentBytes) {
        return { data: { error: "This attachment type is not downloadable (no content bytes). It may be a linked item rather than a file." } };
      }
      const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
      const buffer = Buffer.from(attachment.contentBytes, "base64");
      if (buffer.length > MAX_ATTACHMENT_SIZE) {
        return { data: { error: `Attachment is too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum supported size is 25MB.` } };
      }
      const name = attachment.name || "download";
      const contentType = (attachment.contentType || "").toLowerCase();

      if (action === "save_to_sharepoint" && fnArgs.folderPath) {
        const { uploadFileToSharePoint } = await import("./microsoft");
        const uploadResult = await uploadFileToSharePoint(buffer, name, attachment.contentType || "application/octet-stream", fnArgs.folderPath);
        return { data: { success: true, action: "saved_to_sharepoint", fileName: name, path: fnArgs.folderPath, uploadResult } };
      }

      const isText = contentType.includes("text") || contentType.includes("csv") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("html");
      const isWord = contentType.includes("wordprocessingml") || contentType.includes("msword") || name.endsWith(".docx") || name.endsWith(".doc");
      const isPdf = contentType.includes("pdf");
      const isExcel = contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");

      let extractedText = "";

      if (isText || name.endsWith(".csv") || name.endsWith(".txt")) {
        extractedText = buffer.toString("utf-8").slice(0, 50000);
      } else if (isPdf) {
        try {
          const { PDFParse: PdfCls } = await import("pdf-parse");
          const parser = new (PdfCls as any)(new Uint8Array(buffer));
          const pdfData = await parser.getText();
          const pdfText = typeof pdfData === "string" ? pdfData : (pdfData as any).text || String(pdfData);
          extractedText = pdfText.slice(0, 50000);
          try { parser.destroy(); } catch {}
        } catch {
          extractedText = "[PDF text extraction failed — binary content]";
        }
      } else if (isExcel) {
        try {
          const ExcelJS = (await import("exceljs")).default;
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const lines: string[] = [];
          wb.eachSheet((sheet) => {
            lines.push(`\n--- Sheet: ${sheet.name} ---`);
            sheet.eachRow((row, rowNum) => {
              if (rowNum <= 200) {
                const vals = (row.values as any[]).slice(1).map((v: any) => (v?.result !== undefined ? v.result : v ?? ""));
                lines.push(vals.join("\t"));
              }
            });
          });
          extractedText = lines.join("\n").slice(0, 50000);
        } catch {
          extractedText = "[Excel text extraction failed]";
        }
      } else if (isWord) {
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          extractedText = (result.value || "").slice(0, 50000);
        } catch {
          extractedText = "[Word document text extraction failed]";
        }
      }

      if (extractedText) {
        return { data: { fileName: name, contentType: attachment.contentType, size: buffer.length, content: extractedText } };
      } else {
        const { saveFile } = await import("./file-storage");
        const crypto = (await import("crypto")).default;
        const fileId = crypto.randomBytes(8).toString("hex");
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
        const storedName = `chat-media/${Date.now()}-${fileId}${ext}`;
        await saveFile(storedName, buffer, attachment.contentType || "application/octet-stream", name);
        const downloadUrl = `/api/${storedName}`;
        return { data: { fileName: name, contentType: attachment.contentType, size: buffer.length, downloadUrl, note: "Binary file — content cannot be read as text. Use the download link to share it or save_to_sharepoint to store it." } };
      }
    } catch (err: any) {
      return { data: { error: `Attachment download error: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "export_to_excel") {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");

      const wb = new ExcelJS.Workbook();
      wb.creator = "Bruce Gillingham Pollard";
      wb.created = new Date();

      const DARK_BLUE = "FF082861";
      const WHITE_FONT: any = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      const HEADER_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
      const ALT_ROW_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8F8" } };
      const THIN_BORDER: any = {
        top: { style: "thin", color: { argb: "FFDDDFE0" } },
        left: { style: "thin", color: { argb: "FFDDDFE0" } },
        bottom: { style: "thin", color: { argb: "FFDDDFE0" } },
        right: { style: "thin", color: { argb: "FFDDDFE0" } },
      };

      const sheets = fnArgs.sheets as Array<{ name: string; headers: string[]; rows: string[][] }>;

      // The model occasionally passes objects/arrays as cell values despite the
      // string[][] schema — those stringify to "[object Object]" in the workbook.
      // Coerce every cell to a clean primitive before it reaches ExcelJS.
      const cellText = (val: any): string => {
        if (val === null || val === undefined) return "";
        if (typeof val === "string") return cleanOfficeText(val);
        if (typeof val === "number" || typeof val === "boolean") return String(val);
        if (Array.isArray(val)) return val.map(cellText).filter(Boolean).join(", ");
        if (typeof val === "object") {
          const inner = val.text ?? val.value ?? val.email ?? val.name ?? val.label;
          if (inner !== undefined) return cellText(inner);
          try { return JSON.stringify(val); } catch { return ""; }
        }
        return String(val);
      };

      for (const sheet of sheets) {
        sheet.headers = (sheet.headers || []).map(cellText);
        sheet.rows = (sheet.rows || []).map((r) => (r || []).map(cellText));
        const safeSheetName = sheet.name.replace(/[\\/*?\[\]:]/g, "").substring(0, 31) || "Sheet1";
        const ws = wb.addWorksheet(safeSheetName);

        const titleRow = ws.addRow([sheet.name]);
        ws.mergeCells(titleRow.number, 1, titleRow.number, sheet.headers.length);
        const titleCell = ws.getCell(titleRow.number, 1);
        titleCell.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
        titleCell.fill = HEADER_FILL;
        titleCell.alignment = { vertical: "middle" };
        ws.getRow(titleRow.number).height = 30;

        const headerRow = ws.addRow(sheet.headers);
        headerRow.eachCell((cell: any) => {
          cell.font = WHITE_FONT;
          cell.fill = HEADER_FILL;
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = THIN_BORDER;
        });
        headerRow.height = 24;

        const colWidths = sheet.headers.map((h: string, i: number) => {
          let maxLen = h.length;
          for (const row of sheet.rows) {
            if (row[i] && String(row[i]).length > maxLen) maxLen = String(row[i]).length;
          }
          return Math.min(maxLen + 3, 50);
        });
        ws.columns = colWidths.map(w => ({ width: w }));

        sheet.rows.forEach((rowData, rowIdx) => {
          const row = ws.addRow(rowData.map(val => {
            const num = Number(val);
            if (val && !isNaN(num) && val.trim() !== "") return num;
            return val;
          }));
          row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
            cell.font = { name: "Calibri", size: 10 };
            cell.alignment = { vertical: "middle" };
            cell.border = THIN_BORDER;
            if (rowIdx % 2 === 1) cell.fill = ALT_ROW_FILL;

            if (typeof cell.value === "number") {
              const headerText = (sheet.headers[colNumber - 1] || "").toLowerCase();
              if (headerText.includes("£") || headerText.includes("rent") || headerText.includes("price") || headerText.includes("value") || headerText.includes("cost") || headerText.includes("income")) {
                cell.numFmt = '£#,##0';
              } else if (headerText.includes("%") || headerText.includes("percent") || headerText.includes("yield")) {
                cell.numFmt = '0.0"%"';
              } else if (cell.value > 100) {
                cell.numFmt = '#,##0';
              }
            }
          });
          row.height = 18;
        });

        ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + sheet.rows.length, column: sheet.headers.length } };
        ws.views = [{ state: "frozen", ySplit: 2 }];
      }

      const buffer = await wb.xlsx.writeBuffer();
      const safeName = (fnArgs.filename as string).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.xlsx`;
      await saveFile(
        `chat-media/${storageFilename}`,
        Buffer.from(buffer as ArrayBuffer),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        `${safeName}.xlsx`
      );
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      const totalRows = sheets.reduce((sum: number, s: { rows: string[][] }) => sum + s.rows.length, 0);
      return {
        data: {
          success: true,
          filename: `${safeName}.xlsx`,
          downloadUrl,
          sheetCount: sheets.length,
          totalRows,
          message: `Excel file "${safeName}.xlsx" generated with ${sheets.length} sheet(s) and ${totalRows} rows.`,
          downloadMarkdown: `[📥 Download ${safeName}.xlsx](${downloadUrl})`,
          instruction: "IMPORTANT: Include the downloadMarkdown text EXACTLY as-is in your response so the user can download the file.",
        },
      };
    } catch (err: any) {
      console.error("[chatbgp] Export to Excel error:", err?.message);
      return { data: { error: `Failed to generate Excel file: ${err?.message}` } };
    }
  }

  if (fnName === "transcribe_audio") {
    const tmpFiles: string[] = [];
    const cleanupTmp = () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} } };
    try {
      const OpenAI = (await import("openai")).default;
      const fs = (await import("fs")).default;
      const path = (await import("path")).default;
      const { execFileSync } = await import("child_process");
      const { getFile } = await import("./file-storage");

      const fileUrl = fnArgs.fileUrl as string;
      const language = (fnArgs.language as string) || "en";

      const tmpDir = path.join(process.cwd(), "ChatBGP", "transcribe-tmp");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const allowedExts = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma", ".mov", ".avi", ".mkv", ".wmv", ".flv"];

      let audioFilePath: string;
      let ext: string;

      if (fileUrl.startsWith("/api/chat-media/")) {
        // Existing path — file uploaded via the chat attachment button.
        const filename = fileUrl.replace("/api/chat-media/", "");
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const file = await getFile(`chat-media/${filename}`);
        if (!file) return { data: { error: "File not found in chat media" } };
        ext = path.extname(safeFilename).toLowerCase() || ".mp4";
        if (!allowedExts.includes(ext)) {
          // Don't reject upfront — Whisper + ffmpeg between them accept
          // basically anything with audio. Log a warning but let it try.
          console.warn(`[transcribe_audio] unfamiliar extension ${ext}, attempting anyway`);
        }
        audioFilePath = path.join(tmpDir, `${tmpId}-source${ext}`);
        fs.writeFileSync(audioFilePath, file.data);
        tmpFiles.push(audioFilePath);
      } else if (/^https?:\/\/.*sharepoint\.com\//i.test(fileUrl) || /^https?:\/\/.*-my\.sharepoint\.com\//i.test(fileUrl)) {
        // SharePoint / OneDrive share link — resolve via Microsoft Graph
        // and stream directly to disk so big meeting recordings (often
        // ~100-500 MB) don't buffer in memory. Same resolver + streamer
        // we use for HMLR data.
        const { resolveSharePointShareLinkMetadata, streamUrlToFile } = await import("./sharepoint-resolver");
        let meta;
        try {
          meta = await resolveSharePointShareLinkMetadata(fileUrl);
        } catch (resErr: any) {
          return { data: { error: `Failed to resolve SharePoint link: ${resErr?.message || resErr}` } };
        }
        if (meta.isFolder) {
          return { data: { error: "SharePoint link points to a folder, not a single audio/video file. Share the specific recording, not the folder." } };
        }
        if (!meta.downloadUrl) {
          return { data: { error: "SharePoint link resolved but no download URL returned. The file may be permission-locked." } };
        }
        const safeFilename = (meta.name || "recording.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
        ext = path.extname(safeFilename).toLowerCase() || ".mp4";
        if (!allowedExts.includes(ext)) {
          // Don't reject upfront — Whisper + ffmpeg between them accept
          // basically anything with audio. Log a warning but let it try.
          console.warn(`[transcribe_audio] unfamiliar extension ${ext}, attempting anyway`);
        }
        audioFilePath = path.join(tmpDir, `${tmpId}-source${ext}`);
        try {
          await streamUrlToFile(meta.downloadUrl, audioFilePath);
        } catch (dlErr: any) {
          return { data: { error: `Failed to download from SharePoint: ${dlErr?.message || dlErr}` } };
        }
        tmpFiles.push(audioFilePath);
      } else if (/^https?:\/\//i.test(fileUrl)) {
        // Generic public URL fallback — just fetch and write to disk.
        const resp = await fetch(fileUrl, { redirect: "follow" });
        if (!resp.ok) return { data: { error: `Public URL fetch failed: HTTP ${resp.status}` } };
        const ctype = resp.headers.get("content-type") || "";
        const guessExt = (() => {
          if (ctype.includes("mp4") || ctype.includes("mpeg")) return ".mp4";
          if (ctype.includes("wav")) return ".wav";
          if (ctype.includes("webm")) return ".webm";
          return ".mp4";
        })();
        const lastSeg = (new URL(fileUrl)).pathname.split("/").pop() || "audio";
        const safeFilename = lastSeg.replace(/[^a-zA-Z0-9._-]/g, "_");
        ext = path.extname(safeFilename).toLowerCase() || guessExt;
        if (!allowedExts.includes(ext)) {
          // Don't reject upfront — Whisper + ffmpeg between them accept
          // basically anything with audio. Log a warning but let it try.
          console.warn(`[transcribe_audio] unfamiliar extension ${ext}, attempting anyway`);
        }
        audioFilePath = path.join(tmpDir, `${tmpId}-source${ext}`);
        const fsStream = fs.createWriteStream(audioFilePath);
        const { pipeline } = await import("stream/promises");
        if (!resp.body) return { data: { error: "Response had no body" } };
        await pipeline(resp.body as any, fsStream);
        tmpFiles.push(audioFilePath);
      } else {
        return { data: { error: "fileUrl must be a chat-media path (/api/chat-media/...), a SharePoint/OneDrive share link, or a public https URL." } };
      }

      // Use bundled ffmpeg / ffprobe binaries via npm packages
      // (ffmpeg-static, ffprobe-static). Ships the binaries with the
      // deploy so there's no dependency on the OS having ffmpeg
      // installed — the previous nixpacks attempt was unreliable on
      // Railway. Falls back to "ffmpeg"/"ffprobe" on PATH if the
      // packages aren't loadable for some reason.
      let ffmpegBin = "ffmpeg";
      let ffprobeBin = "ffprobe";
      try {
        const ffmpegStatic = (await import("ffmpeg-static")).default;
        if (ffmpegStatic && typeof ffmpegStatic === "string") ffmpegBin = ffmpegStatic;
      } catch { /* keep PATH fallback */ }
      try {
        const ffprobeStatic = (await import("ffprobe-static")).default;
        if (ffprobeStatic?.path) ffprobeBin = ffprobeStatic.path;
      } catch { /* keep PATH fallback */ }

      // Diagnostic: log actual on-disk size right before ffmpeg. If the
      // SharePoint stream dropped chunks silently this is where we'll
      // see it (file much smaller than expected).
      const sourceStat = fs.statSync(audioFilePath);
      console.log(`[transcribe_audio] source: ${audioFilePath} size=${sourceStat.size}B (${(sourceStat.size / 1024 / 1024).toFixed(1)} MB)`);

      const videoExts = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"];
      let whisperInputPath = audioFilePath;

      // Whisper API accepts MP4 / M4A / MP3 / WAV / WebM / etc.
      // directly. If the file is small enough, skip ffmpeg entirely —
      // no point re-encoding to MP3 just to upload. This also dodges
      // ffmpeg's pickiness about Teams' weird container quirks. Only
      // need to invoke ffmpeg for >25MB files where we have to
      // segment for Whisper's per-request size cap.
      if (sourceStat.size <= 25 * 1024 * 1024) {
        whisperInputPath = audioFilePath;
      } else if (videoExts.includes(ext)) {
        const audioOutPath = path.join(tmpDir, `${tmpId}-audio.mp3`);
        tmpFiles.push(audioOutPath);
        const { spawnSync } = await import("child_process");
        // Capture full stderr so we can diagnose if it fails. The old
        // execFileSync threw with .message truncated to a useless
        // prefix — we'd never see the actual ffmpeg error.
        // -err_detect ignore_err: tolerate Teams MP4 quirks
        // -fflags +genpts+igndts: regenerate timestamps if Teams' are weird
        const ff = spawnSync(ffmpegBin, [
          "-err_detect", "ignore_err",
          "-fflags", "+genpts+igndts",
          "-i", audioFilePath,
          "-vn", "-acodec", "libmp3lame", "-ab", "64k", "-ar", "16000", "-ac", "1", "-y",
          audioOutPath,
        ], { timeout: 240000, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
        if (ff.status !== 0) {
          const stderr = ff.stderr || "";
          const stdout = ff.stdout || "";
          // Last ~3000 chars of stderr is usually where the actual fatal error lives.
          const tail = stderr.slice(-3000);
          console.error("[transcribe_audio] ffmpeg FAILED. stdout-tail:", stdout.slice(-500), "stderr-tail:", tail);
          cleanupTmp();
          return { data: {
            error: "Audio extraction failed",
            ffmpegPath: ffmpegBin,
            exitCode: ff.status,
            signal: ff.signal,
            sourceFile: audioFilePath,
            sourceSize: sourceStat.size,
            stderr: tail,
          } };
        }
        whisperInputPath = audioOutPath;
      }

      const fileStat = fs.statSync(whisperInputPath);
      const maxSize = 25 * 1024 * 1024;
      if (fileStat.size > maxSize) {
        let durationOutput: string;
        try {
          durationOutput = execFileSync(ffprobeBin, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", whisperInputPath], { timeout: 30000, stdio: "pipe" }).toString().trim();
        } catch {
          cleanupTmp();
          return { data: { error: `Could not determine audio duration (ffprobe=${ffprobeBin})` } };
        }
        const totalDuration = parseFloat(durationOutput) || 0;
        if (totalDuration === 0) { cleanupTmp(); return { data: { error: "Could not determine audio duration" } }; }
        const segmentDuration = 600;
        const segmentCount = Math.min(Math.ceil(totalDuration / segmentDuration), 10);
        const segPaths: string[] = [];
        for (let i = 0; i < segmentCount; i++) {
          const segPath = path.join(tmpDir, `${tmpId}-seg${i}.mp3`);
          tmpFiles.push(segPath);
          const start = i * segmentDuration;
          try {
            execFileSync(ffmpegBin, ["-i", whisperInputPath, "-ss", String(start), "-t", String(segmentDuration), "-vn", "-acodec", "libmp3lame", "-ab", "64k", "-ar", "16000", "-ac", "1", "-y", segPath], { timeout: 120000, stdio: "pipe" });
            segPaths.push(segPath);
          } catch { /* skip failed segment */ }
        }
        if (segPaths.length === 0) { cleanupTmp(); return { data: { error: "Failed to split audio into segments" } }; }
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const transcriptParts: string[] = [];
        for (const segPath of segPaths) {
          const fileStream = fs.createReadStream(segPath);
          const resp = await openai.audio.transcriptions.create({ file: fileStream as any, model: "whisper-1", language, response_format: "text" });
          transcriptParts.push(resp as unknown as string);
        }
        cleanupTmp();
        const fullTranscript = transcriptParts.join("\n\n");
        return {
          data: {
            success: true,
            transcript: fullTranscript,
            duration: Math.round(totalDuration),
            segments: segPaths.length,
            wordCount: fullTranscript.split(/\s+/).length,
            message: `Transcribed ${Math.round(totalDuration / 60)} minutes of audio (${segPaths.length} segments, ${fullTranscript.split(/\s+/).length} words).`,
          },
        };
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const fileStream = fs.createReadStream(whisperInputPath);
      const transcription = await openai.audio.transcriptions.create({ file: fileStream as any, model: "whisper-1", language, response_format: "text" });
      const transcript = transcription as unknown as string;
      cleanupTmp();
      return {
        data: {
          success: true,
          transcript,
          wordCount: transcript.split(/\s+/).length,
          message: `Transcribed audio successfully (${transcript.split(/\s+/).length} words).`,
        },
      };
    } catch (err: any) {
      cleanupTmp();
      console.error("[chatbgp] Transcription error:", err?.message);
      return { data: { error: `Transcription failed: ${err?.message}` } };
    }
  }

  if (fnName === "query_leasing_schedule") {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (fnArgs.propertyName) {
        conditions.push(`p.name ILIKE $${idx}`);
        params.push(`%${fnArgs.propertyName}%`);
        idx++;
      }
      if (fnArgs.status) {
        conditions.push(`u.status = $${idx}`);
        params.push(fnArgs.status);
        idx++;
      }
      if (fnArgs.zone) {
        conditions.push(`u.zone ILIKE $${idx}`);
        params.push(`%${fnArgs.zone}%`);
        idx++;
      }
      if (fnArgs.tenantName) {
        conditions.push(`u.tenant_name ILIKE $${idx}`);
        params.push(`%${fnArgs.tenantName}%`);
        idx++;
      }
      if (fnArgs.expiringWithinMonths) {
        conditions.push(`u.lease_expiry IS NOT NULL AND u.lease_expiry <= NOW() + INTERVAL '${Math.min(parseInt(fnArgs.expiringWithinMonths), 60)} months'`);
      }
      conditions.push(`(c.ai_disabled IS NULL OR c.ai_disabled = FALSE)`);
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = Math.min(Math.max(1, Number(fnArgs.limit) || 50), 200);
      const whereParams = [...params];
      params.push(limit);
      const result = await pool.query(`
        SELECT u.*, p.name as property_name, c.name as landlord_name
        FROM leasing_schedule_units u
        JOIN crm_properties p ON u.property_id::text = p.id::text
        LEFT JOIN crm_companies c ON p.landlord_id = c.id
        ${where}
        ORDER BY p.name, u.sort_order, u.zone, u.unit_name
        LIMIT $${params.length}
      `, params);
      const countResult = await pool.query(`
        SELECT COUNT(*) as total FROM leasing_schedule_units u
        JOIN crm_properties p ON u.property_id::text = p.id::text
        LEFT JOIN crm_companies c ON p.landlord_id = c.id
        ${where}
      `, whereParams);
      return {
        data: {
          units: result.rows.map((r: any) => ({
            property: r.property_name, landlord: r.landlord_name, zone: r.zone, unit: r.unit_name,
            tenant: r.tenant_name, status: r.status, positioning: r.positioning,
            leaseExpiry: r.lease_expiry, leaseBreak: r.lease_break, rentReview: r.rent_review,
            rentPa: r.rent_pa, sqft: r.sqft, matPsqft: r.mat_psqft,
            lflPercent: r.lfl_percent, occCostPercent: r.occ_cost_percent,
            targetBrands: r.target_brands, optimumTarget: r.optimum_target,
            priority: r.priority, updates: r.updates, agent: r.agent_initials,
          })),
          totalMatching: parseInt(countResult.rows[0].total),
          returned: result.rows.length,
        },
      };
    } catch (err: any) {
      return { data: { error: `Leasing schedule query failed: ${err?.message}` } };
    }
  }

  if (fnName === "list_my_uploads") {
    try {
      const search = String(fnArgs.search || "").trim();
      const limit = Math.min(Math.max(Number(fnArgs.limit) || 20, 1), 50);
      const currentUserId = (req.session as any)?.userId || (req as any).tokenUserId || null;
      // Prefer the user-scoped history table (populated on every upload).
      // Fall back to a global chat-media search when the per-user table has
      // gaps (older uploads predating the recordUserUpload fix).
      let items: Array<{ storageKey: string; originalName: string; mimeType: string; size: number; uploadedAt: string }> = [];
      if (currentUserId) {
        const recent = await getRecentUserUploads(currentUserId, limit * 2);
        items = recent
          .filter(r => !search || r.originalName.toLowerCase().includes(search.toLowerCase()))
          .slice(0, limit)
          .map(r => ({ storageKey: r.storageKey, originalName: r.originalName, mimeType: r.mimeType, size: r.size, uploadedAt: r.uploadedAt }));
      }
      if (items.length === 0) {
        const global = await searchChatMedia(search, limit);
        items = global.map(g => ({ storageKey: g.storageKey, originalName: g.originalName, mimeType: g.contentType, size: g.size, uploadedAt: "" }));
      }
      return {
        data: {
          count: items.length,
          files: items.map(it => ({
            chat_media_filename: it.storageKey.replace(/^chat-media\//, ""),
            original_name: it.originalName,
            mime_type: it.mimeType,
            size_kb: Math.round((it.size || 0) / 1024),
            uploaded_at: it.uploadedAt || null,
          })),
          hint: items.length === 0
            ? "No matching files. Ask the user to drag/drop the file into chat."
            : `Pass any \`chat_media_filename\` above (or the \`original_name\`) to import tools — both resolve to the same file.`,
        },
      };
    } catch (err: any) {
      return { data: { error: err?.message || "list_my_uploads failed" } };
    }
  }

  if (fnName === "import_leasing_schedule") {
    try {
      const mediaFilename = String(fnArgs.mediaFilename || "").trim();
      const mode = (fnArgs.mode === "import" ? "import" : "preview") as "preview" | "import";
      const propertyFilter = fnArgs.propertyFilter ? String(fnArgs.propertyFilter).toLowerCase() : null;

      if (!mediaFilename) {
        return { data: { error: "mediaFilename is required. The user must upload an Excel file to chat first." } };
      }
      if (mediaFilename.includes("..") || mediaFilename.includes("/") || mediaFilename.includes("\\")) {
        return { data: { error: "Invalid filename" } };
      }

      const mediaPath = path.join(process.cwd(), "ChatBGP", "chat-media", mediaFilename);
      if (!fs.existsSync(mediaPath)) {
        const dbFile = await getFile(`chat-media/${mediaFilename}`);
        if (dbFile?.data) {
          const dir = path.dirname(mediaPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(mediaPath, dbFile.data);
        } else {
          const byName = await findChatMediaByOriginalName(mediaFilename);
          if (byName?.data) {
            const dir = path.dirname(mediaPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(mediaPath, byName.data);
          } else {
            return { data: { error: `Chat file not found: ${mediaFilename}. Ask the user to re-upload the file.` } };
          }
        }
      }

      const origName = mediaFilename.replace(/^\d+-/, "");
      const ext = path.extname(origName).toLowerCase();
      if (ext !== ".xlsx" && ext !== ".xls" && ext !== ".csv") {
        return { data: { error: `Only .xlsx, .xls, or .csv files are supported. Got: ${ext}` } };
      }

      const rawText = await extractTextFromFile(mediaPath, origName);
      if (!rawText || rawText.length < 50) {
        return { data: { error: "Could not read any content from the file — it may be empty, password-protected, or corrupted." } };
      }

      const MAX_CHARS = 150000;
      const sheetText = rawText.length > MAX_CHARS ? rawText.slice(0, MAX_CHARS) + "\n[...truncated]" : rawText;

      const extractionSystem = `You are extracting leasing schedule data from a BGP Dashboard Excel workbook for insertion into the leasing_schedule_units database table.

The workbook contains one or more PROPERTY SECTIONS. Each property section starts with a header block naming the property (often on its own row or in a merged cell), sometimes with a "Cluster:" line and "Asset Lead:" line. After the header, the property section has these columns:
  Zone | Positioning | Existing | Targets | Optimum Targets | Financial Performance | Top 10 Priority? | Updates

Then multiple unit rows. Some rows are zone-group headers (Zone column populated, everything else empty) — skip those. Some rows are blank — skip. Some rows at the end of the workbook contain strategy principles, key definitions (GREEN/AMBER/RED), rules — all should be skipped.

For each UNIT ROW, extract:
- property_name: from the nearest preceding property header
- zone: the last non-empty Zone value above this row (e.g. "1. Westgate Social")
- positioning: from Positioning column (e.g. "Social Dining"). If it has "(XX)" at the end, extract those initials as agent_initials and strip from positioning.
- agent_initials: the "(XX)" part, 2-3 letter initials like "JR", "HK", "TG", "GOH"
- unit_name: from Existing column. Strip surrounding parens/dates. E.g. "Benito's (JR) (Exp. 10/9/26)" → "Benito's". For empty/void units like "[L13 - Loake]", "Neal's Yard Unit L40", keep as-is.
- tenant_name: same as unit_name unless explicitly different
- lease_expiry: parse "(Exp. DD/M/YY)" → YYYY-MM-DD (assume 20YY for 2-digit years). "TaW" or missing → null
- lease_break: parse "(TB DD/M/YY)" → YYYY-MM-DD. null if missing.
- landlord_break: parse "(LB DD/M/YY)" → YYYY-MM-DD
- rent_review: parse "(RR DD/M/YY)" → YYYY-MM-DD
- target_brands: array of strings parsed from the Targets column. If column has a numbered list "1. X 2. Y", return ["X", "Y"]. Ignore leading category labels like "Grab & Go" or "Premium Casual Dining".
- optimum_target: from Optimum Targets column. Single string (may be multi-word).
- lfl_percent: parse from "X% LFL" or "-X% LFL" → number (null if absent or "-")
- mat_psqft: parse from "£X MAT/sqft" → integer (null if absent)
- occ_cost_percent: parse from "X% Occ Costs" → number (null if absent or "?")
- priority: if Priority column says "Top 10 25/26 LS Portfolio Priority" or similar → store that string. "-" or empty → null.
- updates: full text from Updates column (keep line breaks as \\n). Empty or "-" → null.
- status: "Occupied" by default. If unit_name is wrapped in "[...]" or the Existing cell suggests void (e.g. "VOID", "[L13 - ...]", "Neal's Yard Unit L40") → "Vacant".

Output STRICT JSON ONLY, no markdown fences:
{
  "properties": [
    {
      "property_name": "Westgate Oxford",
      "cluster": "Major Retail - Engine Room",
      "asset_lead": "JR",
      "units": [ { ...all fields above... } ]
    }
  ],
  "skipped_rows_count": 0,
  "notes": "brief notes on any ambiguities"
}

Be thorough — include every unit row you can classify, across all properties in the workbook.`;

      const response = await callClaude({
        model: CHATBGP_MODEL,
        messages: [
          { role: "system", content: extractionSystem },
          { role: "user", content: `Workbook content (CSV-style, one sheet per "=== Sheet:" block):\n\n${sheetText}` },
        ],
        max_completion_tokens: 16000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content?.trim() || "";
      if (!content) return { data: { error: "AI extraction returned empty response" } };

      let parsed: any;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch (parseErr: any) {
        return { data: { error: `Could not parse AI response as JSON: ${parseErr?.message}. Raw response started with: ${content.slice(0, 200)}` } };
      }

      const allProperties = Array.isArray(parsed?.properties) ? parsed.properties : [];
      const properties = propertyFilter
        ? allProperties.filter((p: any) => String(p.property_name || "").toLowerCase().includes(propertyFilter))
        : allProperties;

      if (properties.length === 0) {
        return { data: { error: propertyFilter ? `No property matching "${fnArgs.propertyFilter}" found in file.` : "No properties could be extracted from the file." } };
      }

      const userId = (req.session as any)?.userId || (req as any).tokenUserId || null;
      const userRes = userId
        ? await pool.query("SELECT id, username FROM users WHERE id = $1 LIMIT 1", [userId])
        : { rows: [] as Array<{ id: string; username: string }> };
      const user = userRes.rows[0];

      const results: any[] = [];
      for (const prop of properties) {
        const propName = String(prop.property_name || "").trim();
        const units = Array.isArray(prop.units) ? prop.units : [];

        const matchRes = await pool.query(
          "SELECT id, name FROM crm_properties WHERE name ILIKE $1 ORDER BY length(name) ASC LIMIT 1",
          [`%${propName}%`]
        );
        const matched = matchRes.rows[0];

        if (!matched) {
          results.push({ property: propName, status: "property_not_found_in_crm", units_parsed: units.length, inserted: 0 });
          continue;
        }

        if (mode === "preview") {
          results.push({
            property: propName,
            matched_crm_property: matched.name,
            matched_crm_id: matched.id,
            units_parsed: units.length,
            sample_unit: units[0] || null,
            vacant_count: units.filter((u: any) => u.status === "Vacant").length,
          });
          continue;
        }

        let inserted = 0;
        let order = 0;
        for (const u of units) {
          try {
            await pool.query(`
              INSERT INTO leasing_schedule_units
                (property_id, zone, positioning, unit_name, tenant_name, agent_initials,
                 lease_expiry, lease_break, rent_review, landlord_break,
                 rent_pa, sqft, mat_psqft, lfl_percent, occ_cost_percent, financial_notes,
                 target_brands, optimum_target, priority, status, updates, sort_order)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            `, [
              matched.id,
              u.zone || null,
              u.positioning || null,
              u.unit_name || "(unnamed)",
              u.tenant_name || u.unit_name || "(unnamed)",
              u.agent_initials || null,
              u.lease_expiry || null,
              u.lease_break || null,
              u.rent_review || null,
              u.landlord_break || null,
              u.rent_pa ?? null,
              u.sqft ?? null,
              u.mat_psqft ?? null,
              u.lfl_percent ?? null,
              u.occ_cost_percent ?? null,
              u.financial_notes || null,
              Array.isArray(u.target_brands) && u.target_brands.length > 0
                ? u.target_brands.map((b: string, i: number) => `${i + 1}. ${b}`).join("\n")
                : (typeof u.target_brands === "string" ? u.target_brands : null),
              u.optimum_target || null,
              u.priority || null,
              u.status || "Occupied",
              u.updates || null,
              order++,
            ]);
            inserted++;
          } catch (insErr: any) {
            console.error(`[import_leasing_schedule] Insert failed for ${propName} / ${u.unit_name}:`, insErr?.message);
          }
        }

        if (inserted > 0 && user) {
          await pool.query(`
            INSERT INTO leasing_schedule_audit (property_id, user_id, user_name, action, new_value, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
          `, [matched.id, user.id, user.username, "import_via_chatbgp", `${inserted} units imported from ${origName}`]);
        }

        results.push({ property: propName, matched_crm_property: matched.name, units_parsed: units.length, inserted });
      }

      const totalParsed = results.reduce((s, r) => s + (r.units_parsed || 0), 0);
      const totalInserted = results.reduce((s, r) => s + (r.inserted || 0), 0);
      const notMatched = results.filter(r => r.status === "property_not_found_in_crm").map(r => r.property);

      return {
        data: {
          mode,
          file: origName,
          properties_in_file: allProperties.length,
          properties_processed: properties.length,
          total_units_parsed: totalParsed,
          total_units_inserted: mode === "import" ? totalInserted : 0,
          properties_not_found_in_crm: notMatched,
          results,
          ai_notes: parsed?.notes || null,
          next_step: mode === "preview"
            ? "Review the summary. If it looks correct, call import_leasing_schedule again with mode='import'."
            : "Import complete. Check /leasing-schedule to verify.",
        },
      };
    } catch (err: any) {
      return { data: { error: `Leasing schedule import failed: ${err?.message}` } };
    }
  }

  if (fnName === "import_wip_excel") {
    try {
      const chatMediaFilename = String(fnArgs.chatMediaFilename || "").trim();
      const sharepointUrl = String(fnArgs.sharepointUrl || "").trim();
      const mode = (fnArgs.mode === "append" ? "append" : "replace") as "replace" | "append";
      if (!chatMediaFilename && !sharepointUrl) {
        return { data: { error: "Either chatMediaFilename or sharepointUrl must be provided. Ask the user to drag the WIP Excel into chat or paste a SharePoint share link." } };
      }

      let buffer: Buffer | null = null;
      let resolvedName = chatMediaFilename;

      if (sharepointUrl) {
        // SharePoint share-link path — resolve via Graph /shares/{token}/driveItem
        // and download the binary content.
        const { getValidMsToken } = await import("./microsoft");
        const token = await getValidMsToken(req);
        if (!token) {
          return { data: { error: "Microsoft 365 is not connected. Please connect via the SharePoint page first." } };
        }
        const inputUrl = (await resolveOneDriveShortLink(sharepointUrl)).trim();
        const encodedUrl = Buffer.from(inputUrl).toString("base64")
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const sharingUrl = `u!${encodedUrl}`;
        const driveItemRes = await fetch(
          `https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!driveItemRes.ok) {
          const errText = await driveItemRes.text();
          return { data: { error: `Could not access SharePoint file (${driveItemRes.status}): ${errText.slice(0, 200)}` } };
        }
        const driveItem = await driveItemRes.json();
        resolvedName = driveItem.name || "wip.xlsx";
        let downloadUrl: string | null = driveItem["@microsoft.graph.downloadUrl"] || null;
        if (!downloadUrl && driveItem.parentReference?.driveId && driveItem.id) {
          const contentRes = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveItem.parentReference.driveId}/items/${driveItem.id}/content`,
            { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" },
          );
          if (contentRes.status === 302) {
            downloadUrl = contentRes.headers.get("location");
          }
        }
        if (!downloadUrl) {
          return { data: { error: `Could not get a download URL for ${resolvedName}.` } };
        }
        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) {
          return { data: { error: `SharePoint download failed (${fileRes.status}).` } };
        }
        buffer = Buffer.from(await fileRes.arrayBuffer());
      } else {
        if (chatMediaFilename.includes("..") || chatMediaFilename.includes("/") || chatMediaFilename.includes("\\")) {
          return { data: { error: "Invalid filename" } };
        }
        // Resolve the file: try disk first (multer-saved), then DB-backed
        // chat-media storage, then a fallback by originalName lookup. Same
        // pattern import_leasing_schedule uses.
        const diskPath = path.join(process.cwd(), "ChatBGP", "chat-media", chatMediaFilename);
        if (fs.existsSync(diskPath)) {
          buffer = fs.readFileSync(diskPath);
        } else {
          const dbFile = await getFile(`chat-media/${chatMediaFilename}`);
          if (dbFile?.data) {
            buffer = dbFile.data;
          } else {
            const byName = await findChatMediaByOriginalName(chatMediaFilename);
            if (byName?.data) buffer = byName.data;
          }
        }
        if (!buffer) {
          return { data: { error: `Chat file not found: ${chatMediaFilename}. Ask the user to re-upload the file.` } };
        }
      }

      const ext = path.extname(resolvedName).toLowerCase();
      if (ext !== ".xlsx" && ext !== ".xls") {
        return { data: { error: `WIP import expects an Excel file (.xlsx / .xls). Got ${ext || "<no ext>"}.` } };
      }

      const { importWipFromBuffer } = await import("./crm");
      const archiveOrphans = mode === "replace" && fnArgs.sourceOfTruth === true;
      const result = await importWipFromBuffer(buffer, { append: mode === "append", archiveOrphans });

      // Trim the sync result for the chat reply — the agent only needs
      // headline numbers, not the full row-level breakdown. `layout`
      // exposes which Sage export format was detected, useful for the
      // analyst to know we're parsing what they uploaded.
      const sync = result.sync || {};
      const enrich = result.enrichment || {};
      return {
        data: {
          success: true,
          imported: result.imported,
          layout: result.layout,
          mode,
          syncSummary: {
            dealsCreated: sync.created ?? sync.dealsCreated ?? null,
            dealsUpdated: sync.updated ?? sync.dealsUpdated ?? null,
            propertiesCreated: sync.propertiesCreated ?? null,
            companiesCreated: sync.companiesCreated ?? null,
          },
          enrichment: {
            dealsEnriched: enrich.dealsEnriched ?? null,
            billingEntitiesCreated: enrich.billingEntitiesCreated ?? null,
            billingEntitiesLinked: enrich.billingEntitiesLinked ?? null,
            allocationsCreated: enrich.allocationsCreated ?? null,
            tenantRepSearchesCreated: enrich.tenantRepSearchesCreated ?? null,
            skipped: enrich.skipped ?? null,
          },
          orphans: result.orphans
            ? {
                archived: result.orphans.archived,
                deals: result.orphans.deals.slice(0, 50),
                truncated: result.orphans.deals.length > 50,
              }
            : null,
        },
        action: { type: "wip_imported", imported: result.imported, layout: result.layout },
      };
    } catch (err: any) {
      console.error("[chatbgp] import_wip_excel error:", err?.message, err?.stack);
      return { data: { error: `WIP import failed: ${err?.message || "unknown error"}` } };
    }
  }

  if (fnName === "wipe_crm_deals") {
    try {
      const { confirm } = fnArgs as { confirm?: boolean };
      if (!confirm) return { data: { error: "Wipe not confirmed. Set confirm: true to proceed." } };
      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
      const baseUrl = `${protocol}://${host}`;
      const resp = await fetch(`${baseUrl}/api/admin/wipe-deals`, {
        method: "POST",
        headers: { cookie: req.headers.cookie || "", authorization: req.headers.authorization || "" },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { data: { error: (err as any).message || `Wipe failed (${resp.status})` } };
      }
      const result = await resp.json();
      return { data: result };
    } catch (err: any) {
      return { data: { error: `wipe_crm_deals failed: ${err?.message}` } };
    }
  }

  if (fnName === "query_turnover") {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (fnArgs.companyName) {
        conditions.push(`company_name ILIKE $${idx}`);
        params.push(`%${fnArgs.companyName}%`);
        idx++;
      }
      if (fnArgs.propertyName) {
        conditions.push(`(property_name ILIKE $${idx} OR location ILIKE $${idx})`);
        params.push(`%${fnArgs.propertyName}%`);
        idx++;
      }
      if (fnArgs.category) {
        conditions.push(`category = $${idx}`);
        params.push(fnArgs.category);
        idx++;
      }
      if (fnArgs.period) {
        conditions.push(`period ILIKE $${idx}`);
        params.push(`%${fnArgs.period}%`);
        idx++;
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = Math.min(Math.max(1, Number(fnArgs.limit) || 50), 200);
      const whereParams = [...params];
      params.push(limit);
      const result = await pool.query(`
        SELECT * FROM turnover_data ${where} ORDER BY created_at DESC LIMIT $${params.length}
      `, params);
      const countResult = await pool.query(`SELECT COUNT(*) as total FROM turnover_data ${where}`, whereParams);
      return {
        data: {
          entries: result.rows.map((r: any) => ({
            brand: r.company_name, property: r.property_name, location: r.location,
            period: r.period, turnover: r.turnover, sqft: r.sqft,
            turnoverPerSqft: r.turnover_per_sqft, source: r.source,
            confidence: r.confidence, category: r.category, notes: r.notes,
            addedBy: r.added_by, date: r.created_at,
          })),
          totalMatching: parseInt(countResult.rows[0].total),
          returned: result.rows.length,
        },
      };
    } catch (err: any) {
      return { data: { error: `Turnover query failed: ${err?.message}` } };
    }
  }

  if (fnName === "query_calendar") {
    try {
      const { getValidMsToken } = await import("./microsoft");
      const token = await getValidMsToken(req);
      if (!token) {
        return { data: { error: "Microsoft 365 not connected. Please connect via Settings > Microsoft 365." } };
      }
      const daysAhead = Math.min(fnArgs.daysAhead || 7, 30);
      const now = new Date();
      const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      let targetEmail: string | null = null;
      if (fnArgs.teamMember) {
        const memberSearch = fnArgs.teamMember.toLowerCase();
        const usersResult = await pool.query(
          `SELECT email, name FROM users WHERE LOWER(name) LIKE $1 OR LOWER(email) LIKE $1 LIMIT 1`,
          [`%${memberSearch}%`]
        );
        if (usersResult.rows.length > 0) {
          targetEmail = usersResult.rows[0].email;
        } else {
          return { data: { error: `Could not find team member "${fnArgs.teamMember}"` } };
        }
      }
      const calendarUrl = targetEmail
        ? `https://graph.microsoft.com/v1.0/users/${targetEmail}/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}&$top=50&$orderby=start/dateTime&$select=subject,start,end,location,organizer,attendees,isAllDay`
        : `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}&$top=50&$orderby=start/dateTime&$select=subject,start,end,location,organizer,attendees,isAllDay`;
      const calResponse = await fetch(calendarUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="Europe/London"',
        },
      });
      if (!calResponse.ok) {
        const errText = await calResponse.text();
        return { data: { error: `Calendar API error: ${calResponse.status} ${errText.substring(0, 200)}` } };
      }
      const calData = await calResponse.json() as { value: any[] };
      const events = (calData.value || []).map((e: any) => ({
        subject: e.subject,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        location: e.location?.displayName || null,
        organizer: e.organizer?.emailAddress?.name || null,
        attendees: (e.attendees || []).map((a: any) => a.emailAddress?.name).filter(Boolean).slice(0, 10),
        allDay: e.isAllDay,
      }));
      return {
        data: {
          events,
          count: events.length,
          period: `${now.toISOString().split("T")[0]} to ${end.toISOString().split("T")[0]}`,
          forUser: targetEmail || "current user",
        },
      };
    } catch (err: any) {
      return { data: { error: `Calendar query failed: ${err?.message}` } };
    }
  }

  if (fnName === "send_whatsapp") {
    try {
      const token = process.env.WHATSAPP_TOKEN_V2 || process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneNumberId) {
        return { data: { error: "WhatsApp not configured. Missing access token or phone number ID." } };
      }
      const to = (fnArgs.to as string).replace(/[^0-9]/g, "");
      const message = fnArgs.message as string;
      const waResponse = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        }),
      });
      if (!waResponse.ok) {
        const errBody = await waResponse.text();
        return { data: { error: `WhatsApp send failed: ${waResponse.status} ${errBody.substring(0, 200)}` } };
      }
      const waResult = await waResponse.json() as any;
      return {
        data: {
          success: true,
          to,
          contactName: fnArgs.contactName || null,
          messageId: waResult.messages?.[0]?.id || null,
          message: `WhatsApp message sent to ${fnArgs.contactName || to}`,
        },
        action: { type: "whatsapp_sent", to },
      };
    } catch (err: any) {
      return { data: { error: `WhatsApp send failed: ${err?.message}` } };
    }
  }

  if (fnName === "bulk_update_crm") {
    try {
      const entityType = fnArgs.entityType as string;
      const ids = fnArgs.ids as string[];
      const updates = fnArgs.updates as Record<string, any>;
      if (!ids || ids.length === 0) return { data: { error: "No record IDs provided" } };
      if (ids.length > 100) return { data: { error: "Maximum 100 records per bulk update" } };
      const tableMap: Record<string, string> = {
        deal: "crm_deals",
        contact: "crm_contacts",
        company: "crm_companies",
        property: "crm_properties",
      };
      const table = tableMap[entityType];
      if (!table) return { data: { error: `Unknown entity type: ${entityType}` } };
      const fieldMap: Record<string, Record<string, string>> = {
        deal: { status: "status", stage: "stage", notes: "notes", dealType: "deal_type", team: "team", priority: "priority" },
        contact: { notes: "notes", category: "category", status: "status", email: "email", phone: "phone" },
        company: { notes: "notes", companyType: "company_type", status: "status" },
        property: { notes: "notes", status: "status", assetClass: "asset_class" },
      };
      const allowedFields = fieldMap[entityType] || {};
      const sets: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;
      for (const [key, value] of Object.entries(updates)) {
        const col = allowedFields[key];
        if (col) {
          sets.push(`${col} = $${paramIdx}`);
          params.push(value);
          paramIdx++;
        }
      }
      if (sets.length === 0) return { data: { error: "No valid fields to update" } };
      const placeholders = ids.map((_, i) => `$${paramIdx + i}`).join(", ");
      params.push(...ids);
      const result = await pool.query(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE id IN (${placeholders})`,
        params
      );
      return {
        data: {
          success: true,
          entityType,
          updatedCount: result.rowCount || 0,
          requestedCount: ids.length,
          fieldsUpdated: Object.keys(updates),
          message: `Updated ${result.rowCount} ${entityType}(s)`,
        },
      };
    } catch (err: any) {
      return { data: { error: `Bulk update failed: ${err?.message}` } };
    }
  }

  if (fnName === "run_kyc_check") {
    try {
      const { chFetch } = await import("./companies-house");
      const { loadSanctionsList, screenName, assessRisk, isSanctionsListLoaded } = await import("./sanctions-screening");

      const companyName = (fnArgs.companyName as string || "").trim();
      let chNumber = (fnArgs.companyNumber as string || "").trim() || undefined;

      if (!companyName && !chNumber) {
        return { data: { error: "Please provide a company name or Companies House number." } };
      }

      if (!chNumber) {
        const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`);
        const items = searchData.items || [];
        if (items.length === 0) {
          return {
            data: {
              success: false,
              status: "not_found",
              message: `No Companies House match found for "${companyName}". Try a different name or provide the Companies House number directly.`,
            },
          };
        }
        const nameLower = companyName.toLowerCase().trim();
        const bestMatch = items.find((i: any) => i.title?.toLowerCase().trim() === nameLower)
          || items.find((i: any) => i.title?.toLowerCase().includes(nameLower) || nameLower.includes(i.title?.toLowerCase()))
          || items[0];
        chNumber = bestMatch.company_number;
      }

      const profileData = await chFetch(`/company/${encodeURIComponent(chNumber!)}`);
      const profile = {
        companyNumber: profileData.company_number,
        companyName: profileData.company_name,
        companyStatus: profileData.company_status,
        companyType: profileData.type,
        dateOfCreation: profileData.date_of_creation,
        registeredOfficeAddress: profileData.registered_office_address,
        sicCodes: profileData.sic_codes,
        hasCharges: profileData.has_charges,
        hasInsolvencyHistory: profileData.has_insolvency_history,
        jurisdiction: profileData.jurisdiction,
        accountsOverdue: profileData.accounts?.overdue,
        confirmationStatementOverdue: profileData.confirmation_statement?.overdue,
        lastAccountsMadeUpTo: profileData.accounts?.last_accounts?.made_up_to,
      };

      let officers: any[] = [];
      let pscs: any[] = [];

      const [officerResult, pscResult] = await Promise.allSettled([
        chFetch(`/company/${encodeURIComponent(chNumber!)}/officers`),
        chFetch(`/company/${encodeURIComponent(chNumber!)}/persons-with-significant-control`),
      ]);

      if (officerResult.status === "fulfilled") {
        officers = (officerResult.value.items || []).map((o: any) => ({
          name: o.name,
          officerRole: o.officer_role,
          appointedOn: o.appointed_on,
          resignedOn: o.resigned_on,
          nationality: o.nationality,
          occupation: o.occupation,
          dateOfBirth: o.date_of_birth ? `${o.date_of_birth.month}/${o.date_of_birth.year}` : null,
        }));
      }

      if (pscResult.status === "fulfilled") {
        pscs = (pscResult.value.items || []).map((p: any) => ({
          name: p.name || (p.name_elements ? [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" ") : "Unknown"),
          kind: p.kind,
          naturesOfControl: p.natures_of_control || [],
          nationality: p.nationality,
          countryOfResidence: p.country_of_residence,
          notifiedOn: p.notified_on,
          ceasedOn: p.ceased_on,
        }));
      }

      const activeOfficers = officers.filter(o => !o.resignedOn);
      const activePscs = pscs.filter(p => !p.ceasedOn);
      const namesToScreen = [
        ...activeOfficers.filter(o => o.name).map(o => ({ name: o.name, role: o.officerRole || "officer" })),
        ...activePscs.filter(p => p.name).map(p => ({ name: p.name, role: "psc" })),
        { name: profile.companyName, role: "company" },
      ].filter(n => n.name && n.name.trim());

      await loadSanctionsList();
      let sanctionsAvailable = isSanctionsListLoaded();
      const sanctionsResults = sanctionsAvailable ? namesToScreen.map(({ name, role }) => {
        const matches = screenName(name);
        const status = matches.some(m => m.score >= 0.9)
          ? "strong_match"
          : matches.length > 0
            ? "potential_match"
            : "clear";
        return {
          name,
          role,
          status,
          matches: matches.map(m => ({
            sanctionedName: m.entry.name,
            matchScore: Math.round(m.score * 100),
            regime: m.entry.regime,
            entityType: m.entry.entityType,
          })),
        };
      }) : [];

      let filingHistory: any[] = [];
      let charges: any[] = [];
      let financialStrength: any = null;

      const [filingResult, chargesResult] = await Promise.allSettled([
        chFetch(`/company/${encodeURIComponent(chNumber!)}/filing-history?items_per_page=20`),
        chFetch(`/company/${encodeURIComponent(chNumber!)}/charges`),
      ]);

      if (filingResult.status === "fulfilled") {
        filingHistory = (filingResult.value.items || []).map((f: any) => ({
          date: f.date,
          category: f.category,
          description: f.description,
          type: f.type,
        }));
      }

      let totalCharges = 0;
      let satisfiedCharges = 0;
      let outstandingCharges = 0;
      if (chargesResult.status === "fulfilled") {
        const chargeItems = chargesResult.value.items || [];
        totalCharges = chargesResult.value.total_count || chargeItems.length;
        charges = chargeItems.map((c: any) => ({
          status: c.status,
          classification: c.classification?.description,
          createdOn: c.created_on,
          deliveredOn: c.delivered_on,
          satisfiedOn: c.satisfied_on,
          personsEntitled: (c.persons_entitled || []).map((p: any) => p.name).join(", "),
          particulars: c.particulars?.description,
        }));
        satisfiedCharges = charges.filter((c: any) => c.status === "fully-satisfied" || c.satisfiedOn).length;
        outstandingCharges = charges.filter((c: any) => c.status === "outstanding" || (!c.satisfiedOn && c.status !== "fully-satisfied")).length;
      }

      const accountsFilings = filingHistory.filter(f => f.category === "accounts");
      const lastAccountsFiling = accountsFilings[0];
      const accountsType = profileData.accounts?.last_accounts?.type || "unknown";

      const companyAgeYears = profileData.date_of_creation
        ? Math.floor((Date.now() - new Date(profileData.date_of_creation).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;

      const accountsSizeMap: Record<string, string> = {
        "micro-entity": "Micro-entity (turnover ≤ £632k, assets ≤ £316k)",
        "small": "Small (turnover ≤ £10.2m, net assets ≤ £5.1m)",
        "medium": "Medium (turnover ≤ £36m, net assets ≤ £18m)",
        "full": "Full accounts (above medium thresholds or public company)",
        "group": "Group accounts",
        "dormant": "Dormant",
        "unaudited-abridged": "Small/micro (abridged)",
        "total-exemption-small": "Small (total exemption)",
        "total-exemption-full": "Full (total exemption)",
        "filing-exemption-subsidiary": "Subsidiary (filing exemption)",
        "initial": "Initial accounts",
        "null": "No accounts filed",
      };

      const accountsSizeLabel = accountsSizeMap[accountsType] || accountsType;

      let covenantStrength = "unknown";
      let estimatedMaxRent = "unable to assess";
      let purchaseCapacity = "unable to assess";
      const financialFlags: string[] = [];

      if (profile.companyStatus !== "active") {
        covenantStrength = "unacceptable";
        financialFlags.push(`Company is ${profile.companyStatus} — not a viable covenant`);
      } else if (profile.hasInsolvencyHistory) {
        covenantStrength = "weak";
        financialFlags.push("Company has insolvency history");
      } else if (accountsType === "dormant" || accountsType === "null") {
        covenantStrength = "unverifiable";
        financialFlags.push("No accounts filed or company is dormant — cannot assess financial strength");
      } else {
        if (accountsType === "full" || accountsType === "group" || accountsType === "total-exemption-full") {
          covenantStrength = "strong";
          estimatedMaxRent = "Likely above £500k pa based on accounts size — verify against filed accounts";
          purchaseCapacity = "Likely capable of significant acquisitions — verify against filed accounts";
          financialFlags.push("Files full/group accounts indicating substantial business");
        } else if (accountsType === "medium") {
          covenantStrength = "good";
          estimatedMaxRent = "Potentially £100k–£500k pa — verify against filed accounts";
          purchaseCapacity = "Capable of mid-market acquisitions — verify against filed accounts";
          financialFlags.push("Medium-sized company by Companies House thresholds");
        } else if (accountsType === "small" || accountsType === "total-exemption-small" || accountsType === "unaudited-abridged") {
          covenantStrength = "moderate";
          estimatedMaxRent = "Likely up to £100k pa — recommend guarantor or rent deposit";
          purchaseCapacity = "Limited — may need to verify funding source";
          financialFlags.push("Small company — consider requesting guarantor for leases");
        } else if (accountsType === "micro-entity") {
          covenantStrength = "weak";
          estimatedMaxRent = "Up to £25k pa — recommend personal guarantee or rent deposit";
          purchaseCapacity = "Very limited — likely requires external funding";
          financialFlags.push("Micro-entity — personal guarantee recommended for any lease");
        }

        if (companyAgeYears !== null) {
          if (companyAgeYears < 2) {
            financialFlags.push(`Young company (${companyAgeYears} years) — limited trading history`);
            if (covenantStrength === "strong") covenantStrength = "good";
            else if (covenantStrength === "good" || covenantStrength === "moderate") covenantStrength = "moderate";
          } else if (companyAgeYears >= 10) {
            financialFlags.push(`Established company (${companyAgeYears} years) — long trading history`);
          }
        }

        if (profile.accountsOverdue) {
          financialFlags.push("ACCOUNTS OVERDUE — potential financial distress signal");
          if (covenantStrength === "strong") covenantStrength = "good";
          else if (covenantStrength !== "weak") covenantStrength = "moderate";
        }
        if (profile.confirmationStatementOverdue) {
          financialFlags.push("Confirmation statement overdue — compliance concern");
        }
        if (outstandingCharges > 0) {
          financialFlags.push(`${outstandingCharges} outstanding charge(s) registered — existing secured debt`);
        }
        if (totalCharges > 5) {
          financialFlags.push(`${totalCharges} total charges registered — heavily leveraged`);
        }
      }

      financialStrength = {
        covenantStrength,
        accountsType: accountsSizeLabel,
        companyAge: companyAgeYears !== null ? `${companyAgeYears} years` : "unknown",
        estimatedMaxRent,
        purchaseCapacity,
        outstandingCharges,
        totalCharges,
        satisfiedCharges,
        lastAccountsFiled: lastAccountsFiling?.date || profile.lastAccountsMadeUpTo || "unknown",
        flags: financialFlags,
        houseCovenant: await (async () => {
          // The canonical grade — same engine as check_covenant, so the two
          // never diverge. Non-fatal: the heuristic words above remain if it fails.
          try {
            const { getCovenantReport } = await import("./covenant-engine");
            const r = await getCovenantReport(chNumber!);
            return { grade: r.grade, score: r.score, redFlags: r.flags.filter((fl) => fl.level === "red").map((fl) => fl.label) };
          } catch { return null; }
        })(),
        note: "Indicative wording above; houseCovenant carries the canonical A-E grade (same engine as check_covenant, incl. Gazette insolvency signals).",
      };

      const riskAssessment = assessRisk(profile, activeOfficers, activePscs, sanctionsResults as any);

      const kycStatus = profile.companyStatus === "active" && !profile.hasInsolvencyHistory && !profile.accountsOverdue
        ? "pass"
        : profile.companyStatus !== "active"
          ? "fail"
          : "warning";

      const hasSanctionsHits = sanctionsResults.some(r => r.status !== "clear");

      console.log(`[chatbgp] Standalone KYC check for "${companyName}" → ${kycStatus}, risk: ${riskAssessment.level}, covenant: ${covenantStrength}`);

      return {
        data: {
          success: true,
          kycStatus,
          riskLevel: riskAssessment.level,
          riskScore: riskAssessment.score,
          riskFactors: riskAssessment.factors,
          financialStrength,
          hasSanctionsHits,
          sanctionsListAvailable: sanctionsAvailable,
          sanctionsWarning: !sanctionsAvailable ? "UK Sanctions List could not be loaded — sanctions screening was SKIPPED. Company profile and officers data is still valid, but sanctions clearance is NOT confirmed." : undefined,
          profile,
          activeOfficers,
          activePscs,
          recentCharges: charges.filter((c: any) => !c.satisfiedOn).slice(0, 5),
          sanctionsScreening: sanctionsResults.filter(r => r.status !== "clear"),
          allClear: sanctionsResults.filter(r => r.status === "clear").length,
          totalScreened: sanctionsResults.length,
          checkedAt: new Date().toISOString(),
          note: "Standalone KYC check — not saved to CRM. Use create_company to add this company to the CRM if needed.",
        },
      };
    } catch (err: any) {
      if (err.message?.includes("not configured")) {
        return { data: { error: "Companies House API key not configured. Contact admin to add the COMPANIES_HOUSE_API_KEY." } };
      }
      return { data: { error: `KYC check failed: ${err?.message}` } };
    }
  }

  if (fnName === "browse_dropbox") {
    try {
      const getSetting = async (key: string) => {
        const { systemSettings } = await import("@shared/schema");
        const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
        return row?.value ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
      };

      const tokens = await getSetting("dropbox_tokens");
      if (!tokens) return { data: { error: "Dropbox is not connected. An admin needs to connect Dropbox first via the settings." } };

      let accessToken = tokens.access_token;
      if (!accessToken || !tokens.expires_at || Date.now() >= tokens.expires_at - 60000) {
        const appKey = process.env.DROPBOX_APP_KEY;
        const appSecret = process.env.DROPBOX_APP_SECRET;
        if (!appKey || !appSecret || !tokens.refresh_token) return { data: { error: "Dropbox token expired and cannot be refreshed." } };

        const refreshRes = await fetch("https://api.dropboxapi.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
            client_id: appKey,
            client_secret: appSecret,
          }),
        });
        if (!refreshRes.ok) return { data: { error: `Dropbox token refresh failed (${refreshRes.status})` } };
        const refreshData = await refreshRes.json();
        accessToken = refreshData.access_token;

        const { systemSettings } = await import("@shared/schema");
        await db.update(systemSettings)
          .set({ value: JSON.stringify({
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token || tokens.refresh_token,
            expires_at: Date.now() + (refreshData.expires_in || 14400) * 1000,
          }), updatedAt: new Date() })
          .where(eq(systemSettings.key, "dropbox_tokens"));
      }

      const action = (fnArgs.action as string) || "list";

      if (action === "list") {
        const folderPath = (fnArgs.path as string) || "";
        const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: folderPath, limit: 100 }),
        });
        if (!res.ok) {
          console.error(`[chatbgp] Dropbox list failed (${res.status}):`, await res.text());
          return { data: { error: `Could not list Dropbox folder. The folder may not exist or access was denied.` } };
        }
        const data = await res.json();
        const entries = (data.entries || []).map((e: any) => ({
          name: e.name,
          type: e[".tag"],
          path: e.path_display,
          size: e.size || null,
          modified: e.server_modified || null,
        }));
        return { data: { path: folderPath || "/", entries, hasMore: data.has_more, totalEntries: entries.length } };
      }

      if (action === "search") {
        const query = (fnArgs.query as string) || "";
        if (!query) return { data: { error: "Search query is required" } };
        const res = await fetch("https://api.dropboxapi.com/2/files/search_v2", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, options: { max_results: 20 } }),
        });
        if (!res.ok) return { data: { error: `Dropbox search failed (${res.status})` } };
        const data = await res.json();
        const matches = (data.matches || []).map((m: any) => {
          const meta = m.metadata?.metadata || m.metadata || {};
          return { name: meta.name, path: meta.path_display, type: meta[".tag"], size: meta.size || null, modified: meta.server_modified || null };
        });
        return { data: { query, results: matches, totalResults: matches.length } };
      }

      if (action === "read") {
        const filePath = (fnArgs.path as string) || "";
        if (!filePath) return { data: { error: "File path is required" } };

        const metaRes = await fetch("https://api.dropboxapi.com/2/files/get_metadata", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path: filePath }),
        });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          const MAX_SIZE = 25 * 1024 * 1024;
          if (meta.size && meta.size > MAX_SIZE) return { data: { error: `File is too large (${(meta.size / 1024 / 1024).toFixed(1)}MB). Maximum is 25MB.` } };
          const ext = (meta.name || "").split(".").pop()?.toLowerCase();
          const allowed = ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "txt", "csv", "md", "json"];
          if (ext && !allowed.includes(ext)) return { data: { error: `Unsupported file type: .${ext}. Supported: ${allowed.join(", ")}` } };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let downloadRes: globalThis.Response;
        try {
          downloadRes = await fetch("https://content.dropboxapi.com/2/files/download", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
            },
            signal: controller.signal,
          });
        } catch (err: any) {
          clearTimeout(timeout);
          return { data: { error: "Download timed out or failed" } };
        }
        clearTimeout(timeout);
        if (!downloadRes.ok) return { data: { error: `Could not download file` } };
        const buffer = Buffer.from(await downloadRes.arrayBuffer());
        const fileName = (filePath.split("/").pop() || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        try {
          const { extractTextFromFile } = await import("./utils/file-extractor");
          const tempDir = require("path").join(process.cwd(), "ChatBGP", "archivist-temp");
          const fs = require("fs");
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempPath = require("path").join(tempDir, `chatbgp-${Date.now()}-${fileName}`);
          try {
            fs.writeFileSync(tempPath, buffer);
          } catch (writeErr: any) {
            console.error("[chatbgp] Failed to write Dropbox temp file:", writeErr?.message);
            return { data: { error: "Failed to write temporary file for extraction" } };
          }
          try {
            const text = await extractTextFromFile(tempPath, fileName);
            const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n\n[... truncated, file is " + text.length + " chars total]" : text;
            return { data: { fileName, content: truncated, fullLength: text.length } };
          } finally {
            try { fs.unlinkSync(tempPath); } catch {}
          }
        } catch (err: any) {
          console.error("[chatbgp] Dropbox file read error:", err?.message);
          return { data: { error: "Could not extract text from this file. It may be in an unsupported format or corrupted." } };
        }
      }

      return { data: { error: "Unknown action requested." } };
    } catch (err: any) {
      console.error("[chatbgp] Dropbox browse error:", err?.message);
      return { data: { error: "Dropbox is temporarily unavailable. Please try again." } };
    }
  }

  if (fnName === "trigger_archivist_crawl") {
    try {
      const action = (fnArgs.action as string) || "crawl";
      if (action === "status") {
        const { count: countFn } = await import("drizzle-orm");
        const { knowledgeBase, systemSettings, imageStudioImages } = await import("@shared/schema");
        const [{ count: totalCount }] = await db.select({ count: countFn() }).from(knowledgeBase);
        const [{ count: imageCount }] = await db.select({ count: countFn() }).from(imageStudioImages);
        const spCount = await pool.query("SELECT COUNT(*) FROM knowledge_base WHERE source = 'sharepoint' OR source IS NULL");
        const dbxCount = await pool.query("SELECT COUNT(*) FROM knowledge_base WHERE source = 'dropbox'");
        const emailCount = await pool.query("SELECT COUNT(*) FROM knowledge_base WHERE source = 'email'");
        const [lastRunRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "archivist_last_run"));
        const [dropboxRow] = await db.select().from(systemSettings).where(eq(systemSettings.key, "dropbox_tokens"));
        const { getImageSyncStatus } = await import("./image-studio");
        const imgSync = getImageSyncStatus();
        const { isArchivistRunning } = await import("./archivist");
        return {
          data: {
            totalIndexed: Number(totalCount),
            sharepointDocs: Number(spCount.rows[0]?.count || 0),
            dropboxDocs: Number(dbxCount.rows[0]?.count || 0),
            emailDocs: Number(emailCount.rows[0]?.count || 0),
            lastRun: lastRunRow?.value || null,
            dropboxConnected: !!dropboxRow?.value,
            archivistRunning: isArchivistRunning(),
            imageStudio: {
              totalImages: Number(imageCount),
              syncRunning: imgSync.running,
              syncProgress: imgSync.progress || null,
              foldersScanned: imgSync.foldersChecked,
              imagesDiscovered: imgSync.imagesFound,
            },
          }
        };
      } else {
        const { runArchivistCrawl, isArchivistRunning } = await import("./archivist");
        if (isArchivistRunning()) {
          return { data: { message: "Crawl already in progress", success: true } };
        }
        runArchivistCrawl().catch(e => console.error("[archivist] ChatBGP-triggered crawl error:", e.message));
        return { data: { message: "Crawl started successfully", success: true } };
      }
    } catch (err: any) {
      return { data: { error: `Archivist error: ${err?.message}` } };
    }
  }

  if (fnName === "manage_tasks") {
    try {
      const action = (fnArgs.action as string) || "list";
      const userId = (req as any).session?.userId;
      if (!userId) return { data: { error: "User not identified" } };

      if (action === "list") {
        const result = await pool.query(
          `SELECT id, title, description, due_date, priority, status, category, created_at, completed_at FROM user_tasks 
           WHERE user_id = $1 AND status != 'done'
           ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC NULLS LAST`,
          [userId]
        );
        const overdue = result.rows.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());
        return {
          data: {
            tasks: result.rows.map((t: any) => ({
              id: t.id, title: t.title, description: t.description,
              dueDate: t.due_date, priority: t.priority, status: t.status,
              category: t.category,
            })),
            total: result.rows.length,
            overdue: overdue.length,
          }
        };
      }

      if (action === "create") {
        const title = (fnArgs.title as string || "").trim();
        if (!title) return { data: { error: "Task title is required" } };
        const result = await pool.query(
          `INSERT INTO user_tasks (user_id, title, description, priority, due_date, category, linked_deal_id, linked_property_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, title, priority, due_date, category`,
          [userId, title, (fnArgs.description as string) || null, (fnArgs.priority as string) || "medium",
           (fnArgs.dueDate as string) || null, (fnArgs.category as string) || null,
           (fnArgs.linkedDealId as string) || null, (fnArgs.linkedPropertyId as string) || null]
        );
        return { data: { success: true, task: result.rows[0], message: `Task "${title}" created` } };
      }

      if (action === "complete") {
        const taskId = (fnArgs.taskId as string || "").trim();
        if (!taskId) {
          const searchTitle = (fnArgs.title as string || "").trim().toLowerCase();
          if (searchTitle) {
            const found = await pool.query(
              "SELECT id, title FROM user_tasks WHERE user_id = $1 AND status != 'done' AND LOWER(title) LIKE $2 LIMIT 1",
              [userId, `%${searchTitle}%`]
            );
            if (found.rows.length > 0) {
              await pool.query("UPDATE user_tasks SET status = 'done', completed_at = NOW() WHERE id = $1", [found.rows[0].id]);
              return { data: { success: true, message: `Task "${found.rows[0].title}" marked as done` } };
            }
            return { data: { error: `No open task matching "${searchTitle}" found` } };
          }
          return { data: { error: "Task ID or title is required to complete a task" } };
        }
        await pool.query("UPDATE user_tasks SET status = 'done', completed_at = NOW() WHERE id = $1 AND user_id = $2", [taskId, userId]);
        return { data: { success: true, message: "Task marked as done" } };
      }

      if (action === "delete") {
        const taskId = (fnArgs.taskId as string || "").trim();
        if (!taskId) return { data: { error: "Task ID is required" } };
        await pool.query("DELETE FROM user_tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
        return { data: { success: true, message: "Task deleted" } };
      }

      return { data: { error: `Unknown action: ${action}` } };
    } catch (err: any) {
      return { data: { error: `Task error: ${err?.message}` } };
    }
  }

  // ─── Memory bank: full-text search across knowledge_base (SharePoint files, emails, Dropbox, notes) ───
  if (fnName === "search_knowledge_base") {
    try {
      const rawQuery = (fnArgs.query as string || "").trim();
      if (!rawQuery) return { data: { error: "Search query is required" } };
      const source = (fnArgs.source as string || "").trim();
      const category = (fnArgs.category as string || "").trim();
      const limitRaw = Number(fnArgs.limit);
      const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10));

      const params: any[] = [rawQuery];
      const whereClauses: string[] = [];
      // Rank against the same tsvector expression as the GIN index
      const tsExpr = "to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'') || ' ' || coalesce(array_to_string(ai_tags, ' '),'') || ' ' || coalesce(category,''))";
      whereClauses.push(`${tsExpr} @@ websearch_to_tsquery('english', $1)`);
      if (source) { params.push(source); whereClauses.push(`source = $${params.length}`); }
      if (category) { params.push(category); whereClauses.push(`category = $${params.length}`); }
      params.push(limit);

      const sqlText = `
        SELECT id, file_name, summary, content, source, category, file_url, ai_tags, last_modified,
               ts_rank(${tsExpr}, websearch_to_tsquery('english', $1)) AS rank
          FROM knowledge_base
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY rank DESC, last_modified DESC NULLS LAST
         LIMIT $${params.length}
      `;
      const result = await pool.query(sqlText, params);
      const rows = result.rows.map((r: any) => ({
        id: r.id,
        fileName: r.file_name,
        summary: r.summary,
        snippet: r.content ? String(r.content).slice(0, 400) : null,
        source: r.source || "sharepoint",
        category: r.category,
        fileUrl: r.file_url,
        aiTags: r.ai_tags || [],
        lastModified: r.last_modified,
      }));
      return {
        data: {
          query: rawQuery,
          totalResults: rows.length,
          results: rows,
          message: rows.length === 0 ? "No matches in the knowledge base. Try a different query or check if the archivist has been run recently." : `Found ${rows.length} match${rows.length === 1 ? "" : "es"}.`,
        },
      };
    } catch (err: any) {
      console.error("[chatbgp] search_knowledge_base error:", err?.message);
      return { data: { error: `Knowledge base search failed: ${err?.message || "unknown error"}` } };
    }
  }

  // ─── Memory bank: full-text search across past ChatBGP conversations ───
  if (fnName === "search_chat_history") {
    try {
      const rawQuery = (fnArgs.query as string || "").trim();
      if (!rawQuery) return { data: { error: "Search query is required" } };
      const limitRaw = Number(fnArgs.limit);
      const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10));
      const userId = (req as any).session?.userId || null;

      const params: any[] = [rawQuery];
      const whereClauses: string[] = [
        `to_tsvector('english', coalesce(content,'')) @@ websearch_to_tsquery('english', $1)`,
      ];
      if (userId) { params.push(userId); whereClauses.push(`user_id = $${params.length}`); }
      params.push(limit);

      // chat_messages table: id, thread_id, role, content, user_id, created_at
      const sqlText = `
        SELECT id, thread_id, role, content, created_at,
               ts_rank(to_tsvector('english', coalesce(content,'')), websearch_to_tsquery('english', $1)) AS rank
          FROM chat_messages
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY rank DESC, created_at DESC
         LIMIT $${params.length}
      `;
      const result = await pool.query(sqlText, params);
      const rows = result.rows.map((r: any) => ({
        id: r.id,
        threadId: r.thread_id,
        role: r.role,
        snippet: r.content ? String(r.content).slice(0, 500) : null,
        createdAt: r.created_at,
      }));
      return {
        data: {
          query: rawQuery,
          totalResults: rows.length,
          results: rows,
          message: rows.length === 0 ? "No matches in your chat history." : `Found ${rows.length} match${rows.length === 1 ? "" : "es"} across past conversations.`,
        },
      };
    } catch (err: any) {
      console.error("[chatbgp] search_chat_history error:", err?.message);
      return { data: { error: `Chat history search failed: ${err?.message || "unknown error"}` } };
    }
  }

  // ─── Decks — composable document primitive ──────────────────────────
  if (fnName === "create_deck") {
    try {
      const name = String(fnArgs.name || "").trim();
      const templateKey = String(fnArgs.templateKey || "").trim();
      if (!name || !templateKey) return { data: { success: false, error: "name and templateKey are required" } };

      const tpl = await pool.query(
        `SELECT key, default_cards FROM deck_templates WHERE key = $1 AND active = true`,
        [templateKey]
      );
      if (!tpl.rows[0]) return { data: { success: false, error: `Unknown template '${templateKey}'. Try: why_buy, am_im, leasing_pitch, rent_review, brand_pack.` } };

      const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
      const deckRow = await pool.query(
        `INSERT INTO decks (name, template_key, property_id, company_id, deal_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          name,
          templateKey,
          fnArgs.propertyId || null,
          fnArgs.companyId || null,
          fnArgs.dealId || null,
          fnArgs.notes || null,
          userId,
        ]
      );
      const deck = deckRow.rows[0];

      const seeds: any[] = Array.isArray(fnArgs.cards) && fnArgs.cards.length
        ? fnArgs.cards
        : (tpl.rows[0].default_cards as any[]);

      const cardIds: { id: string; type: string; title: string | null }[] = [];
      for (const seed of seeds) {
        const inserted = await pool.query(
          `INSERT INTO deck_cards (deck_id, type, sort_order, state, title, content)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, type, title`,
          [
            deck.id,
            seed.type,
            typeof seed.sortOrder === "number" ? seed.sortOrder : 0,
            seed.state === "locked" ? "locked" : "draft",
            seed.title || null,
            seed.content ? JSON.stringify(seed.content) : null,
          ]
        );
        cardIds.push(inserted.rows[0]);
      }

      return {
        data: {
          success: true,
          deckId: deck.id,
          name: deck.name,
          templateKey: deck.template_key,
          cards: cardIds,
          deckUrl: `/decks/${deck.id}`,
          message: `Deck "${deck.name}" created with ${cardIds.length} cards. Edit cards with update_deck_card, then assemble_deck once they're all locked.`,
        },
      };
    } catch (e: any) {
      console.error("[chatbgp] create_deck:", e?.message);
      return { data: { success: false, error: `Couldn't create deck: ${e?.message}` } };
    }
  }

  if (fnName === "update_deck_card") {
    try {
      const deckId = String(fnArgs.deckId || "").trim();
      const cardId = String(fnArgs.cardId || "").trim();
      if (!deckId || !cardId) return { data: { success: false, error: "deckId and cardId are required" } };

      const updates: string[] = [];
      const params: any[] = [];
      const push = (col: string, val: any) => { params.push(val); updates.push(`${col} = $${params.length}`); };

      if (fnArgs.title !== undefined) push("title", fnArgs.title);
      if (fnArgs.content !== undefined) push("content", JSON.stringify(fnArgs.content));
      if (fnArgs.state !== undefined) {
        push("state", fnArgs.state);
        if (fnArgs.state === "locked") {
          const userId = (req as any).session?.userId || (req as any).tokenUserId || null;
          push("locked_at", new Date().toISOString());
          push("locked_by", userId);
        } else {
          push("locked_at", null);
          push("locked_by", null);
        }
      }
      if (!updates.length) return { data: { success: false, error: "No fields to update" } };

      updates.push("updated_at = NOW()");
      params.push(deckId, cardId);
      const r = await pool.query(
        `UPDATE deck_cards SET ${updates.join(", ")}
         WHERE deck_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, type, title, state`,
        params
      );
      if (!r.rows[0]) return { data: { success: false, error: "Card not found" } };
      await pool.query(`UPDATE decks SET updated_at = NOW() WHERE id = $1`, [deckId]).catch(() => {});
      return { data: { success: true, card: r.rows[0], message: `Card ${r.rows[0].title || r.rows[0].type} ${fnArgs.state ? `is now ${fnArgs.state}` : "updated"}.` } };
    } catch (e: any) {
      console.error("[chatbgp] update_deck_card:", e?.message);
      return { data: { success: false, error: `Couldn't update card: ${e?.message}` } };
    }
  }

  if (fnName === "assemble_deck") {
    try {
      const deckId = String(fnArgs.deckId || "").trim();
      if (!deckId) return { data: { success: false, error: "deckId is required" } };
      const { assembleDeck } = await import("./deck-assembler");
      const result = await assembleDeck(deckId);
      if (!result.success) return { data: result };
      return {
        data: {
          ...result,
          downloadMarkdown: `[Download ${result.title}.pdf](${result.downloadUrl})`,
          message: `Deck assembled — ${result.cardCount} cards rendered. PDF ready for download.`,
        },
      };
    } catch (e: any) {
      console.error("[chatbgp] assemble_deck:", e?.message);
      return { data: { success: false, error: `Assemble failed: ${e?.message}` } };
    }
  }

  if (fnName === "list_decks") {
    try {
      const where: string[] = [];
      const params: any[] = [];
      const push = (clause: string, value: any) => { params.push(value); where.push(clause.replace("$$", `$${params.length}`)); };
      if (fnArgs.templateKey) push(`template_key = $$`, String(fnArgs.templateKey));
      if (fnArgs.status) push(`status = $$`, String(fnArgs.status));
      if (fnArgs.propertyId) push(`property_id = $$`, String(fnArgs.propertyId));
      if (fnArgs.companyId) push(`company_id = $$`, String(fnArgs.companyId));
      if (fnArgs.dealId) push(`deal_id = $$`, String(fnArgs.dealId));
      const r = await pool.query(
        `SELECT d.id, d.name, d.template_key, d.status, d.property_id, d.company_id, d.deal_id, d.updated_at,
                (SELECT COUNT(*)::int FROM deck_cards c WHERE c.deck_id = d.id) AS card_count,
                (SELECT COUNT(*)::int FROM deck_cards c WHERE c.deck_id = d.id AND c.state = 'locked') AS locked_count
         FROM decks d
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY d.updated_at DESC LIMIT 30`,
        params
      );
      return { data: { success: true, decks: r.rows, count: r.rows.length } };
    } catch (e: any) {
      console.error("[chatbgp] list_decks:", e?.message);
      return { data: { success: false, error: `List failed: ${e?.message}` } };
    }
  }

  if (fnName === "search_food_hygiene") {
    try {
      const name = String(fnArgs.businessName || "").trim();
      if (!name) return { data: { error: "businessName is required" } };
      const top = Math.max(1, Math.min(200, Number(fnArgs.maxResults) || 50));
      const url = `https://api.ratings.food.gov.uk/Establishments?name=${encodeURIComponent(name)}&pageSize=${top}&pageNumber=1`;
      const res = await fetch(url, {
        headers: { "x-api-version": "2", accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { data: { error: `FSA hygiene API returned ${res.status}` } };
      const data = (await res.json()) as any;
      const establishments = (data?.establishments || []).map((e: any) => ({
        name: e.BusinessName,
        type: e.BusinessType,
        rating: e.RatingValue,
        ratingDate: e.RatingDate ? String(e.RatingDate).slice(0, 10) : null,
        address: [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.AddressLine4].filter(Boolean).join(", "),
        postcode: e.PostCode || null,
        localAuthority: e.LocalAuthorityName || null,
        newRatingPending: e.NewRatingPending === "True" || e.NewRatingPending === true || undefined,
      }));
      return { data: {
        query: name,
        count: establishments.length,
        establishments,
        note: "Authoritative FSA register of rated premises. Treat this as the operator's real trading footprint; a recent ratingDate at a new address is expansion evidence. Watch for unrelated businesses sharing the name — check the address/type fits the brand.",
      } };
    } catch (err: any) {
      return { data: { error: `FSA hygiene lookup failed: ${err?.message || "unknown"}` } };
    }
  }

  if (fnName === "get_aged_receivables") {
    try {
      const { xeroApiWithFallback } = await import("./xero");
      const nameFilter = String(fnArgs.contactName || "").trim().toLowerCase();
      const invoices: any[] = [];
      // Awaiting-payment sales invoices, paged (Xero caps at 100/page).
      for (let page = 1; page <= 5; page++) {
        const data = await xeroApiWithFallback(null, `/Invoices?where=${encodeURIComponent('Type=="ACCREC" AND Status=="AUTHORISED"')}&order=DueDate&page=${page}`);
        const batch: any[] = data?.Invoices || [];
        invoices.push(...batch);
        if (batch.length < 100) break;
      }
      const parseXeroDate = (d: any): Date | null => {
        if (!d) return null;
        const m = String(d).match(/\/Date\((\d+)/);
        if (m) return new Date(Number(m[1]));
        const t = Date.parse(String(d));
        return Number.isFinite(t) ? new Date(t) : null;
      };
      const now = Date.now();
      const bucketOf = (due: Date | null): string => {
        if (!due) return "current";
        const days = Math.floor((now - due.getTime()) / 86400000);
        if (days <= 0) return "current";
        if (days <= 30) return "1-30";
        if (days <= 60) return "31-60";
        if (days <= 90) return "61-90";
        return "90+";
      };
      type ContactRow = { contact: string; total: number; buckets: Record<string, number>; invoices: any[] };
      const byContact = new Map<string, ContactRow>();
      const buckets: Record<string, number> = { "current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
      let grandTotal = 0;
      for (const inv of invoices) {
        const contact = inv?.Contact?.Name || "Unknown";
        if (nameFilter && !contact.toLowerCase().includes(nameFilter)) continue;
        const due = parseXeroDate(inv.DueDate);
        const amount = Number(inv.AmountDue) || 0;
        if (amount <= 0) continue;
        const b = bucketOf(due);
        buckets[b] += amount;
        grandTotal += amount;
        const row: ContactRow = byContact.get(contact) || { contact, total: 0, buckets: { "current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, invoices: [] };
        row.total += amount;
        row.buckets[b] += amount;
        if (row.invoices.length < 8) {
          row.invoices.push({ number: inv.InvoiceNumber, amountDue: amount, dueDate: due ? due.toISOString().slice(0, 10) : null, overdueBucket: b, reference: inv.Reference || undefined });
        }
        byContact.set(contact, row);
      }
      const contacts = Array.from(byContact.values()).sort((a, b) => b.total - a.total).slice(0, 40);
      const round = (n: number) => Math.round(n * 100) / 100;
      return { data: {
        totalOutstanding: round(grandTotal),
        agedBuckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round(v)])),
        byClient: contacts.map(c => ({ ...c, total: round(c.total), buckets: Object.fromEntries(Object.entries(c.buckets).map(([k, v]) => [k, round(v)])) })),
        invoiceCount: invoices.length,
        note: "AUTHORISED (awaiting payment) sales invoices only. Amounts are AmountDue in the invoice currency.",
      } };
    } catch (err: any) {
      return { data: { error: `Xero receivables failed: ${err?.message || "unknown"} — is the Xero system connection signed in?` } };
    }
  }

  if (fnName === "find_similar_brands") {
    try {
      const exaKey = process.env.EXA_API_KEY;
      if (!exaKey) return { data: { error: "EXA_API_KEY not configured" } };
      const websiteUrl = String(fnArgs.websiteUrl || "").trim();
      if (!websiteUrl) return { data: { error: "websiteUrl is required" } };
      const numResults = Math.max(1, Math.min(25, Number(fnArgs.numResults) || 10));
      const resp = await fetch("https://api.exa.ai/findSimilar", {
        method: "POST",
        headers: { "x-api-key": exaKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          url: websiteUrl,
          numResults,
          excludeSourceDomain: true,
          contents: { text: { maxCharacters: 250 } },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) return { data: { error: `Exa findSimilar ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}` } };
      const data: any = await resp.json();
      const results: any[] = Array.isArray(data?.results) ? data.results : [];
      const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
      const domains = Array.from(new Set(results.map(r => domainOf(r.url)).filter(Boolean)));
      // Cross-reference against the CRM so the answer separates "already
      // tracked" from "new prospect".
      const known = new Map<string, { id: string; name: string; tracked: boolean }>();
      if (domains.length) {
        const { rows } = await pool.query(
          `SELECT id, name, lower(coalesce(domain, '')) AS domain, (company_type ILIKE 'tenant%') AS tracked
             FROM crm_companies WHERE lower(coalesce(domain, '')) = ANY($1::text[])`,
          [domains],
        );
        for (const r of rows) known.set(r.domain, { id: r.id, name: r.name, tracked: r.tracked });
      }
      const out = results.map(r => {
        const d = domainOf(r.url);
        const crm = known.get(d);
        return {
          name: r.title || d,
          website: r.url,
          snippet: (r.text || "").slice(0, 200) || undefined,
          inCrm: !!crm,
          crmCompanyId: crm?.id,
          tracked: crm?.tracked || false,
        };
      });
      return { data: { referenceUrl: websiteUrl, similar: out, newProspects: out.filter(o => !o.inCrm).length } };
    } catch (err: any) {
      return { data: { error: `Similar-brand search failed: ${err?.message || "unknown"}` } };
    }
  }

  if (fnName === "perplexity_people_search") {
    try {
      const { askPerplexity, isPerplexityConfigured } = await import("./perplexity");
      if (!isPerplexityConfigured()) return { data: { error: "PERPLEXITY_API_KEY not configured" } };
      const query = String(fnArgs.query || "").trim();
      if (!query) return { data: { error: "query is required" } };
      const r = await askPerplexity(query, {
        systemPrompt: "You are a UK commercial-property research assistant finding the right person to approach. Use the people-search tool. Return the person/people found with: full name, current job title, employer, and one line of relevant background. If several candidates match, list up to 5, most likely first. If nobody credible is found, say so plainly — never invent a name.",
        maxTokens: 700,
        temperature: 0.1,
        extraTools: [{ type: "people_search" }],
      });
      return { data: { answer: r.answer, sources: r.citations.slice(0, 8), note: "Public info only — for verified emails/phones, pass the best name to rocketreach_person_lookup with the company domain." } };
    } catch (err: any) {
      return { data: { error: `People search failed: ${err?.message || "unknown"}` } };
    }
  }

  if (fnName === "rocketreach_person_lookup") {
    try {
      const { searchRocketReach, revealProfile, isRocketReachConfigured } = await import("./rocketreach-contacts");
      if (!isRocketReachConfigured()) return { data: { error: "ROCKETREACH_API_KEY not configured" } };
      const personName = String(fnArgs.personName || "").trim();
      if (!personName) return { data: { error: "personName is required" } };
      const companyName = fnArgs.companyName ? String(fnArgs.companyName).trim() : undefined;
      const domain = fnArgs.domain ? String(fnArgs.domain).trim() : undefined;
      const maxReveals = Math.max(1, Math.min(3, Number(fnArgs.maxReveals) || 1));

      let profiles: any[] = await searchRocketReach({ personName, companyName, domain });
      // Domain/company filters can be too tight for founders whose RocketReach
      // profile predates the current venture — retry on name alone so the
      // model can judge the candidates by employer itself.
      let widened = false;
      if (profiles.length === 0 && (companyName || domain)) {
        profiles = await searchRocketReach({ personName });
        widened = true;
      }
      if (profiles.length === 0) {
        return { data: { personName, totalMatches: 0, note: "No RocketReach profile matched this name. This tier of independent operator is often unindexed — fall back to the company's own website or a warm route." } };
      }

      const candidates = profiles.slice(0, 10).map((p: any) => ({
        id: p.id ?? null,
        name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "),
        title: p.current_title || null,
        employer: p.current_employer || null,
        location: typeof p.location === "string" ? p.location : (p.location?.city || null),
        linkedin: p.linkedin_url || null,
      }));

      const revealed: any[] = [];
      for (const c of candidates.slice(0, maxReveals)) {
        if (c.id === null || c.id === undefined) continue;
        const full: any = await revealProfile(c.id);
        if (!full) continue;
        const emails = (full.emails || []).map((e: any) => ({ email: e.email, type: e.type || null, smtpValid: e.smtp_valid || "unknown" }));
        const phones = (full.phones || []).map((ph: any) => ({ number: ph.number, type: ph.type || null }));
        revealed.push({
          id: c.id,
          name: full.name || c.name,
          title: full.current_title || c.title,
          employer: full.current_employer || c.employer,
          linkedin: full.linkedin_url || c.linkedin,
          emails,
          phones,
          recommendedEmail: full.recommended_professional_email || full.recommended_email || emails[0]?.email || null,
        });
      }

      return { data: {
        personName,
        totalMatches: profiles.length,
        widenedToNameOnly: widened || undefined,
        revealed,
        otherCandidates: candidates.slice(maxReveals),
        note: "Only emails with smtpValid='valid' count as verified. Reject any candidate whose employer doesn't line up with the target brand — namesakes are common.",
      } };
    } catch (err: any) {
      return { data: { error: `RocketReach lookup failed: ${err?.message || "unknown"}` } };
    }
  }

  if (fnName === "deep_investigate") {
    try {
      const { chFetch, discoverUltimateParent, identifyBrandParent } = await import("./companies-house");
      const { loadSanctionsList, screenName, isSanctionsListLoaded } = await import("./sanctions-screening");

      const companyName = (fnArgs.companyName as string || "").trim();
      const companyNumber = (fnArgs.companyNumber as string || "").trim() || undefined;
      const personName = (fnArgs.personName as string || "").trim();
      const propertyAddress = (fnArgs.propertyAddress as string || "").trim();
      const includeWebSearch = fnArgs.includeWebSearch !== false;

      if (!companyName && !companyNumber && !personName && !propertyAddress) {
        return { data: { error: "Please provide at least one of: company name, person name, or property address to investigate." } };
      }

      const report: Record<string, any> = {
        investigationType: [],
        timestamp: new Date().toISOString(),
        sourcesStatus: {} as Record<string, string>,
      };

      const timedFetch = (url: string, opts?: RequestInit) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));
      };

      let targetCompanyName = companyName;
      let targetCompanyNumber = companyNumber;

      if (propertyAddress) {
        report.investigationType.push("property");
        report.property = { address: propertyAddress };

        let resolvedPostcode = propertyAddress.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0] || "";
        let resolvedStreet = "";
        let resolvedBuildingName = "";
        let resolvedBuildingNumber = "";
        let resolvedFormattedAddress = propertyAddress;

        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (googleApiKey) {
          try {
            const googleQuery = propertyAddress.toLowerCase().includes("london") || propertyAddress.toLowerCase().includes("uk") ? propertyAddress : `${propertyAddress}, London, UK`;
            const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(googleQuery)}&key=${googleApiKey}&region=uk&components=country:GB`;
            const gResp = await timedFetch(gUrl);
            if (gResp.ok) {
              const gData = await gResp.json() as any;
              const place = gData.results?.[0];
              if (place) {
                resolvedFormattedAddress = place.formatted_address?.replace(/, UK$/i, "").replace(/, United Kingdom$/i, "").trim() || propertyAddress;
                report.property.resolvedAddress = resolvedFormattedAddress;
                report.sourcesStatus.googleGeocode = "ok";

                for (const comp of place.address_components || []) {
                  if (comp.types.includes("postal_code")) resolvedPostcode = comp.long_name;
                  if (comp.types.includes("route")) resolvedStreet = comp.long_name;
                  if (comp.types.includes("street_number")) resolvedBuildingNumber = comp.long_name;
                  if (comp.types.includes("premise") || comp.types.includes("establishment")) resolvedBuildingName = comp.long_name;
                }

                if (!resolvedBuildingName && place.formatted_address) {
                  try {
                    const fpUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(googleQuery)}&inputtype=textquery&fields=name,formatted_address,geometry&locationbias=circle:50000@51.5074,-0.1278&key=${googleApiKey}`;
                    const fpResp = await timedFetch(fpUrl);
                    if (fpResp.ok) {
                      const fpData = await fpResp.json() as any;
                      const candidate = fpData.candidates?.[0];
                      if (candidate?.name && candidate.name !== resolvedStreet) {
                        resolvedBuildingName = candidate.name;
                      }
                    }
                  } catch {}
                }

                report.property.resolvedComponents = {
                  postcode: resolvedPostcode,
                  street: resolvedStreet,
                  buildingNumber: resolvedBuildingNumber,
                  buildingName: resolvedBuildingName,
                };
              }
            }
          } catch (err: any) {
            report.sourcesStatus.googleGeocode = `failed: ${err.message}`;
          }
        }

        if (!resolvedPostcode) {
          report.sourcesStatus.propertyData = "no_postcode_resolved";
          report.property.warning = "Could not resolve a postcode from the address. Try providing a full UK address with postcode.";
        }

        if (resolvedPostcode) {
          try {
            const pdApiKey = process.env.PROPERTYDATA_API_KEY;
            if (pdApiKey) {
              const pdRes = await timedFetch(`https://api.propertydata.co.uk/freeholds?key=${pdApiKey}&postcode=${encodeURIComponent(resolvedPostcode.replace(/\s+/g, ""))}`);
              if (pdRes.ok) {
                const pdData = await pdRes.json() as any;
                const allTitles = pdData.data || [];
                if (allTitles.length > 0) {
                  report.sourcesStatus.propertyData = "ok";

                  const addressTerms = [resolvedBuildingName, resolvedBuildingNumber, resolvedStreet, propertyAddress.split(",")[0]]
                    .filter(Boolean)
                    .map(t => t.toLowerCase().trim());

                  const scoredTitles = allTitles.map((t: any) => {
                    const addr = (t.address || "").toLowerCase();
                    let score = 0;
                    for (const term of addressTerms) {
                      if (term && addr.includes(term)) score += 10;
                    }
                    if (resolvedBuildingName && addr.includes(resolvedBuildingName.toLowerCase())) score += 20;
                    if (resolvedBuildingNumber && addr.includes(resolvedBuildingNumber)) score += 15;
                    return { ...t, matchScore: score };
                  });

                  scoredTitles.sort((a: any, b: any) => b.matchScore - a.matchScore);

                  const bestTitle = scoredTitles[0];
                  const bestScore = bestTitle?.matchScore || 0;
                  const relevantTitles = bestScore > 0
                    ? scoredTitles.filter((t: any) => t.matchScore >= bestScore * 0.5)
                    : scoredTitles.slice(0, 5);

                  const hasBuildingMatch = resolvedBuildingName || resolvedBuildingNumber;
                  if (bestScore < 15 || (!hasBuildingMatch && bestScore < 20)) {
                    report.property.ambiguous = true;
                    report.property.message = "I found multiple properties at this postcode but couldn't confidently identify the right one. Please pick from the options below, or provide a more specific address.";
                    report.property.options = scoredTitles.slice(0, 8).map((t: any, idx: number) => ({
                      optionNumber: idx + 1,
                      titleNumber: t.title_number,
                      address: t.address,
                      proprietor: t.proprietor_name,
                      proprietorType: t.proprietor_category,
                    }));
                    report.property.totalTitlesAtPostcode = allTitles.length;
                    report.sourcesStatus.propertyData = "ambiguous — user must choose";
                    return { data: report };
                  } else {
                    report.property.freeholdTitles = relevantTitles.slice(0, 10).map((t: any) => ({
                      titleNumber: t.title_number,
                      address: t.address,
                      proprietor: t.proprietor_name,
                      proprietorType: t.proprietor_category,
                      tenure: t.tenure,
                      pricePaid: t.price_paid,
                      datePaid: t.date_proprietor,
                      matchScore: t.matchScore,
                    }));
                    report.property.totalTitlesAtPostcode = allTitles.length;
                    report.property.filteredToRelevant = relevantTitles.length;

                    if (bestTitle) {
                      report.property.matchedTitle = {
                        titleNumber: bestTitle.title_number,
                        address: bestTitle.address,
                        proprietor: bestTitle.proprietor_name,
                        proprietorType: bestTitle.proprietor_category,
                        companyNumber: bestTitle.proprietor_company_reg_no,
                        confidence: bestScore >= 20 ? "high" : "medium",
                      };
                      if (bestTitle.proprietor_name && !targetCompanyName) {
                        targetCompanyName = bestTitle.proprietor_name;
                      }
                      if (bestTitle.proprietor_company_reg_no && !targetCompanyNumber) {
                        targetCompanyNumber = bestTitle.proprietor_company_reg_no;
                      }
                    }
                  }
                } else {
                  report.sourcesStatus.propertyData = "no_results";
                }
              } else {
                report.sourcesStatus.propertyData = "api_error";
              }
            } else {
              report.sourcesStatus.propertyData = "not_configured";
            }
          } catch (pdErr: any) {
            report.sourcesStatus.propertyData = `failed: ${pdErr.message}`;
            report.property.lookupError = pdErr.message;
          }

          try {
            let hmlrUrl = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(resolvedPostcode)}&_pageSize=10&_sort=-transactionDate`;
            if (resolvedStreet) {
              hmlrUrl += `&propertyAddress.street=${encodeURIComponent(resolvedStreet.toUpperCase())}`;
            }
            const hmlrRes = await timedFetch(hmlrUrl);
            if (hmlrRes.ok) {
              const hmlrData = await hmlrRes.json() as any;
              let items = hmlrData.result?.items || [];

              if (items.length > 0 && (resolvedBuildingNumber || resolvedBuildingName)) {
                const filtered = items.filter((t: any) => {
                  const paon = (t.propertyAddress?.paon || "").toLowerCase();
                  if (resolvedBuildingNumber && paon.includes(resolvedBuildingNumber.toLowerCase())) return true;
                  if (resolvedBuildingName && paon.includes(resolvedBuildingName.toLowerCase())) return true;
                  return false;
                });
                if (filtered.length > 0) items = filtered;
              }

              if (items.length > 0) {
                report.sourcesStatus.landRegistry = "ok";
                report.property.recentTransactions = items.slice(0, 5).map((t: any) => ({
                  address: [t.propertyAddress?.paon, t.propertyAddress?.street, t.propertyAddress?.town].filter(Boolean).join(", "),
                  price: t.pricePaid,
                  date: t.transactionDate,
                  propertyType: t.propertyType?.replace("http://landregistry.data.gov.uk/def/common/", ""),
                  newBuild: t.newBuild,
                }));
              } else {
                report.sourcesStatus.landRegistry = "no_results";
              }
            } else {
              report.sourcesStatus.landRegistry = "api_error";
            }
          } catch (err: any) {
            report.sourcesStatus.landRegistry = `failed: ${err.message}`;
          }
        }
      }

      if (targetCompanyName || targetCompanyNumber) {
        report.investigationType.push("company");
        let chNumber = targetCompanyNumber;

        if (!chNumber) {
          try {
            const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(targetCompanyName)}&items_per_page=5`);
            const items = searchData.items || [];
            if (items.length > 0) {
              const nameLower = targetCompanyName.toLowerCase().trim();
              const bestMatch = items.find((i: any) => i.title?.toLowerCase().trim() === nameLower)
                || items.find((i: any) => i.title?.toLowerCase().includes(nameLower) || nameLower.includes(i.title?.toLowerCase()))
                || items[0];
              chNumber = bestMatch.company_number;
              report.company = { searchMatches: items.slice(0, 3).map((i: any) => ({ name: i.title, number: i.company_number, status: i.company_status })) };
            } else {
              report.company = { error: `No Companies House match found for "${targetCompanyName}"` };
            }
          } catch (err: any) {
            report.company = { error: `Companies House search failed: ${err.message}` };
          }
        }

        if (chNumber) {
          try {
            const profileData = await chFetch(`/company/${encodeURIComponent(chNumber)}`);
            report.sourcesStatus.companiesHouse = "ok";
            report.company = {
              ...report.company,
              profile: {
                companyName: profileData.company_name,
                companyNumber: profileData.company_number,
                status: profileData.company_status,
                type: profileData.type,
                dateOfCreation: profileData.date_of_creation,
                registeredOffice: profileData.registered_office_address,
                sicCodes: profileData.sic_codes,
                hasInsolvencyHistory: profileData.has_insolvency_history,
                hasCharges: profileData.has_charges,
                accountsOverdue: profileData.accounts?.overdue,
                lastAccountsMadeUpTo: profileData.accounts?.last_accounts?.made_up_to,
              },
            };
          } catch (err: any) {
            report.sourcesStatus.companiesHouse = `failed: ${err.message}`;
          }

          const [officerResult, pscResult, filingResult] = await Promise.allSettled([
            chFetch(`/company/${encodeURIComponent(chNumber)}/officers`),
            chFetch(`/company/${encodeURIComponent(chNumber)}/persons-with-significant-control`),
            chFetch(`/company/${encodeURIComponent(chNumber)}/filing-history?items_per_page=5`),
          ]);

          if (officerResult.status === "fulfilled") {
            const allOfficers = (officerResult.value.items || []).map((o: any) => ({
              name: o.name,
              role: o.officer_role,
              appointedOn: o.appointed_on,
              resignedOn: o.resigned_on,
              nationality: o.nationality,
              occupation: o.occupation,
              dateOfBirth: o.date_of_birth ? `${o.date_of_birth.month}/${o.date_of_birth.year}` : null,
              address: o.address,
            }));
            report.company.allOfficers = allOfficers;
            report.company.activeOfficers = allOfficers.filter((o: any) => !o.resignedOn);
          }

          if (pscResult.status === "fulfilled") {
            report.company.pscs = (pscResult.value.items || []).filter((p: any) => !p.ceased_on).map((p: any) => ({
              name: p.name || (p.name_elements ? [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" ") : "Unknown"),
              kind: p.kind,
              naturesOfControl: p.natures_of_control || [],
              nationality: p.nationality,
              countryOfResidence: p.country_of_residence,
            }));
          }

          if (filingResult.status === "fulfilled") {
            report.company.recentFilings = (filingResult.value.items || []).slice(0, 5).map((f: any) => ({
              date: f.date, category: f.category, description: f.description,
            }));
          }

          try {
            const ownershipResult = await discoverUltimateParent(chNumber);
            report.company.ownershipChain = ownershipResult.chain;
            report.company.ultimateParent = ownershipResult.ultimateParent;
            report.sourcesStatus.ownershipChain = ownershipResult.chain.length > 0 ? "ok" : "no_parent_found";

            if (report.company.activeOfficers) {
              const brand = await identifyBrandParent(
                report.company.profile?.companyName || targetCompanyName,
                ownershipResult.chain,
                report.company.activeOfficers
              );
              if (brand) {
                report.company.identifiedBrand = brand;
              }
            }
          } catch (err: any) {
            report.sourcesStatus.ownershipChain = `failed: ${err.message}`;
          }

          await loadSanctionsList();
          if (isSanctionsListLoaded()) {
            const namesToScreen = [
              ...(report.company.activeOfficers || []).filter((o: any) => o.name).map((o: any) => ({ name: o.name, role: o.role || "officer" })),
              ...(report.company.pscs || []).filter((p: any) => p.name).map((p: any) => ({ name: p.name, role: "psc" })),
              { name: report.company.profile?.companyName || targetCompanyName, role: "company" },
            ].filter(n => n.name && n.name.trim());

            const sanctionsHits = namesToScreen.map(({ name, role }) => {
              const matches = screenName(name);
              return matches.length > 0 ? { name, role, matches: matches.map(m => ({ sanctionedName: m.entry.name, score: Math.round(m.score * 100), regime: m.entry.regime })) } : null;
            }).filter(Boolean);

            report.company.sanctionsScreening = {
              totalScreened: namesToScreen.length,
              hits: sanctionsHits,
              allClear: sanctionsHits.length === 0,
            };
          } else {
            report.company.sanctionsScreening = { warning: "UK Sanctions List could not be loaded — screening skipped." };
          }

          const apolloApiKey = process.env.APOLLO_API_KEY;
          if (apolloApiKey && report.company.activeOfficers) {
            const keyPeople = report.company.activeOfficers.slice(0, 5);
            const apolloResults: any[] = [];
            let apolloErrors = 0;

            for (const officer of keyPeople) {
              if (!officer.name) continue;
              try {
                const nameParts = officer.name.split(/,\s*/);
                const lastName = nameParts[0]?.trim();
                const firstName = nameParts[1]?.trim()?.split(/\s+/)[0];

                // mixed_people/api_search (replaces deprecated mixed_people/search)
                const body: Record<string, any> = { page: 1, per_page: 1 };
                if (firstName || lastName) body.q_keywords = `${firstName || ""} ${lastName || ""}`.trim();
                const orgName = report.company.profile?.companyName || targetCompanyName;
                body.organization_names = [orgName];

                const apolloRes = await timedFetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloApiKey },
                  body: JSON.stringify(body),
                });

                if (apolloRes.ok) {
                  const data = await apolloRes.json() as any;
                  const person = (data.people || data.contacts || [])[0];
                  if (person) {
                    apolloResults.push({
                      name: officer.name,
                      role: officer.role,
                      email: person.email,
                      phone: person.phone_numbers?.[0]?.sanitized_number,
                      title: person.title,
                      linkedin: person.linkedin_url,
                      city: person.city,
                      company: person.organization?.name,
                      companyWebsite: person.organization?.website_url,
                      companyLinkedin: person.organization?.linkedin_url,
                      companyIndustry: person.organization?.industry,
                      companySize: person.organization?.estimated_num_employees,
                    });
                  }
                }
                await new Promise(r => setTimeout(r, 300));
              } catch { apolloErrors++; }
            }

            report.sourcesStatus.apollo = apolloResults.length > 0 ? `ok (${apolloResults.length}/${keyPeople.length} enriched)` : apolloErrors > 0 ? "failed" : "no_matches";
            if (apolloResults.length > 0) {
              report.company.contactIntelligence = apolloResults;
            }
          } else if (!apolloApiKey) {
            report.sourcesStatus.apollo = "not_configured";
          }

          // RocketReach — runs when Apollo found nothing useful (not configured,
          // no results, or results with zero emails). Searches by company name,
          // returns C-suite / property decision-makers with best available email.
          const apolloHasEmails = (report.company.contactIntelligence || []).some((c: any) => c.email);
          const rrNoResults = !apolloApiKey || !apolloHasEmails;
          if (rrNoResults) {
            try {
              const { searchRocketReach, isRocketReachConfigured } = await import("./rocketreach-contacts");
              if (isRocketReachConfigured()) {
                const domain = report.company.profile?.registeredOffice
                  ? undefined
                  : undefined; // domain not available here — fall back to name
                const rrPeople = await searchRocketReach({
                  companyName: report.company.profile?.companyName || targetCompanyName,
                  scope: "tenant",
                });
                if (rrPeople.length > 0) {
                  report.company.contactIntelligence = rrPeople.slice(0, 10).map((p: any) => ({
                    name: p.name,
                    title: p.current_title,
                    linkedin: p.linkedin_url,
                    email: p.emails?.[0]?.email || null,
                    source: "rocketreach",
                  }));
                  report.sourcesStatus.rocketreach = `ok (${rrPeople.length} found)`;
                } else {
                  report.sourcesStatus.rocketreach = "no_matches";
                }
              } else {
                report.sourcesStatus.rocketreach = "not_configured";
              }
            } catch (rrErr: any) {
              report.sourcesStatus.rocketreach = `failed: ${rrErr.message}`;
            }
          }

          try {
            const crmResult = await pool.query(
              `SELECT id, name, company_type, kyc_status, parent_company_id FROM crm_companies WHERE LOWER(name) LIKE $1 OR companies_house_number = $2 LIMIT 5`,
              [`%${(report.company.profile?.companyName || targetCompanyName).toLowerCase()}%`, chNumber]
            );
            if (crmResult.rows.length > 0) {
              report.company.existingCrmRecords = crmResult.rows;
            }
            const contactResult = await pool.query(
              `SELECT c.id, c.name, c.email, c.phone, c.role, c.linkedin_url FROM crm_contacts c JOIN crm_companies co ON c.company_id = co.id WHERE co.companies_house_number = $1 OR LOWER(co.name) LIKE $2 LIMIT 10`,
              [chNumber, `%${(report.company.profile?.companyName || targetCompanyName).toLowerCase()}%`]
            );
            if (contactResult.rows.length > 0) {
              report.company.existingCrmContacts = contactResult.rows;
            }
          } catch {}
        }
      }

      if (personName) {
        report.investigationType.push("person");
        report.person = { name: personName };

        try {
          const officerSearch = await chFetch(`/search/officers?q=${encodeURIComponent(personName)}&items_per_page=10`);
          const items = officerSearch.items || [];
          if (items.length > 0) {
            report.sourcesStatus.personSearch = "ok";
            const appointments = items.map((o: any) => ({
              name: o.title,
              dateOfBirth: o.date_of_birth ? `${o.date_of_birth.month}/${o.date_of_birth.year}` : null,
              address: o.address_snippet,
              appointments: o.links?.self ? o.links.self : null,
              matchSnippet: o.snippet,
            }));
            report.person.companiesHouseMatches = appointments;

            const searchLower = personName.toLowerCase().replace(/\s+/g, " ").trim();
            const exactMatch = items.find((o: any) => {
              const title = (o.title || "").toLowerCase().replace(/\s+/g, " ").trim();
              return title === searchLower || title.includes(searchLower) || searchLower.includes(title);
            });
            const bestMatch = exactMatch || items[0];
            report.person.matchConfidence = exactMatch ? "high" : "low — multiple people share this name, results may include directorships from different individuals";

            if (bestMatch.links?.self) {
              try {
                const apptData = await chFetch(bestMatch.links.self);
                const apptItems = apptData.items || [];
                report.person.directorships = apptItems.filter((a: any) => !a.resigned_on).map((a: any) => ({
                  companyName: a.appointed_to?.company_name,
                  companyNumber: a.appointed_to?.company_number,
                  role: a.officer_role,
                  appointedOn: a.appointed_on,
                }));
                report.person.pastDirectorships = apptItems.filter((a: any) => a.resigned_on).slice(0, 10).map((a: any) => ({
                  companyName: a.appointed_to?.company_name,
                  companyNumber: a.appointed_to?.company_number,
                  role: a.officer_role,
                  appointedOn: a.appointed_on,
                  resignedOn: a.resigned_on,
                }));
              } catch (err: any) {
                report.person.directorshipsError = `Failed to fetch: ${err.message}`;
              }
            }
          } else {
            report.sourcesStatus.personSearch = "no_results";
          }
        } catch (err: any) {
          report.sourcesStatus.personSearch = `failed: ${err.message}`;
          report.person.searchError = err.message;
        }

        const apolloApiKey = process.env.APOLLO_API_KEY;
        if (apolloApiKey) {
          try {
            const nameParts = personName.split(/\s+/);
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(" ");
            // mixed_people/api_search (replaces deprecated mixed_people/search)
            const body: Record<string, any> = { page: 1, per_page: 1 };
            if (firstName || lastName) body.q_keywords = `${firstName || ""} ${lastName || ""}`.trim();
            const orgName = targetCompanyName || companyName || "";
            if (orgName) body.organization_names = [orgName];

            const apolloRes = await timedFetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloApiKey },
              body: JSON.stringify(body),
            });

            if (apolloRes.ok) {
              const data = await apolloRes.json() as any;
              const person = (data.people || data.contacts || [])[0];
              if (person) {
                report.person.apolloProfile = {
                  email: person.email,
                  phone: person.phone_numbers?.[0]?.sanitized_number,
                  title: person.title,
                  linkedin: person.linkedin_url,
                  city: person.city,
                  company: person.organization?.name,
                  companyWebsite: person.organization?.website_url,
                  industry: person.organization?.industry,
                };
              }
            }
          } catch {}
        }

        try {
          const crmResult = await pool.query(
            `SELECT id, name, email, phone, role, company_name, linkedin_url FROM crm_contacts WHERE LOWER(name) LIKE $1 LIMIT 5`,
            [`%${personName.toLowerCase()}%`]
          );
          if (crmResult.rows.length > 0) {
            report.person.existingCrmRecords = crmResult.rows;
          }
        } catch {}
      }

      if (includeWebSearch && (targetCompanyName || personName)) {
        try {
          const searchTerms = [targetCompanyName, personName, propertyAddress ? "property" : ""].filter(Boolean).join(" ");
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchTerms + " site:egi.co.uk OR site:costar.com OR site:propertyweek.com OR site:reactnews.com")}`;
          const searchRes = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (searchRes.ok) {
            const html = await searchRes.text();
            const results: any[] = [];
            const snippetMatches = html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g);
            for (const match of snippetMatches) {
              if (results.length >= 5) break;
              const url = decodeURIComponent(match[1].replace(/.*uddg=/, "").split("&")[0]);
              results.push({
                title: match[2].replace(/<[^>]+>/g, ""),
                snippet: match[3].replace(/<[^>]+>/g, ""),
                url,
              });
            }
            if (results.length > 0) {
              report.recentNews = results;
            }
          }
        } catch {}
      }

      const allAssociates: any[] = [];
      if (report.company?.activeOfficers) {
        for (const officer of report.company.activeOfficers) {
          const contactInfo = report.company.contactIntelligence?.find((c: any) => c.name === officer.name);
          allAssociates.push({
            name: officer.name,
            relationship: officer.role,
            source: "Companies House (current officer)",
            email: contactInfo?.email || null,
            phone: contactInfo?.phone || null,
            linkedin: contactInfo?.linkedin || null,
            title: contactInfo?.title || officer.occupation || null,
          });
        }
      }
      if (report.company?.pscs) {
        for (const psc of report.company.pscs) {
          if (!allAssociates.some(a => a.name === psc.name)) {
            allAssociates.push({
              name: psc.name,
              relationship: `PSC (${(psc.naturesOfControl || []).join(", ")})`,
              source: "Companies House (Person with Significant Control)",
              nationality: psc.nationality,
            });
          }
        }
      }
      if (report.company?.existingCrmContacts) {
        for (const contact of report.company.existingCrmContacts) {
          if (!allAssociates.some(a => a.name === contact.name)) {
            allAssociates.push({
              name: contact.name,
              relationship: contact.role || "CRM contact",
              source: "BGP CRM (existing relationship)",
              email: contact.email,
              phone: contact.phone,
              linkedin: contact.linkedin_url,
            });
          }
        }
      }
      if (report.person?.directorships) {
        for (const d of report.person.directorships) {
          allAssociates.push({
            name: personName,
            relationship: `${d.role} at ${d.companyName}`,
            source: "Companies House (active directorship)",
            companyNumber: d.companyNumber,
          });
        }
      }

      report.knownAssociates = allAssociates;
      report.summary = {
        totalAssociatesFound: allAssociates.length,
        withContactDetails: allAssociates.filter(a => a.email || a.phone).length,
        withLinkedIn: allAssociates.filter(a => a.linkedin).length,
        investigatedSubjects: report.investigationType,
        companyIdentified: report.company?.profile?.companyName || targetCompanyName || null,
        brandParent: report.company?.identifiedBrand?.name || report.company?.ultimateParent?.name || null,
        propertyOwner: report.property?.matchedTitle?.proprietor || null,
      };

      console.log(`[chatbgp] Deep investigation: ${report.investigationType.join("+")} — ${allAssociates.length} associates found`);

      return { data: report };
    } catch (err: any) {
      return { data: { error: `Investigation failed: ${err?.message}` } };
    }
  }

  if (fnName === "save_learning") {
    const { chatbgpLearnings } = await import("@shared/schema");
    const userId = req.session?.userId || "unknown";
    let userName = "Unknown User";
    try { const { storage } = await import("./storage"); const user = await storage.getUser(userId); if (user?.name) userName = user.name; } catch {}
    
    const learningText = typeof fnArgs.learning === "string" ? fnArgs.learning.trim() : "";
    if (!learningText) {
      return { data: { error: "No learning text provided" } };
    }
    
    let isDuplicate = false;
    try {
      const existingLearnings = await db.select({ learning: chatbgpLearnings.learning }).from(chatbgpLearnings).where(eq(chatbgpLearnings.active, true));
      const normalised = learningText.toLowerCase();
      isDuplicate = existingLearnings.some((l: any) => {
        const existing = (typeof l.learning === "string" ? l.learning : "").toLowerCase().trim();
        if (!existing) return false;
        if (existing === normalised) return true;
        if (existing.length < 20 || normalised.length < 20) return false;
        const words1 = normalised.split(/\s+/);
        const words2Set = new Set(existing.split(/\s+/));
        const intersection = words1.filter((w: string) => words2Set.has(w));
        return intersection.length / Math.max(words1.length, words2Set.size) > 0.7;
      });
    } catch (e) {
      console.error("Learning dedup check failed, saving anyway:", e);
    }
    
    if (isDuplicate) {
      return { data: { success: true, alreadyKnown: true, message: "I already know this — no need to save again." }, action: { type: "learning_already_known" } };
    }
    
    const subjectPropertyId = typeof fnArgs.subjectPropertyId === "string" ? fnArgs.subjectPropertyId.trim() || null : null;
    const subjectCompanyNumber = typeof fnArgs.subjectCompanyNumber === "string" ? fnArgs.subjectCompanyNumber.trim().toUpperCase() || null : null;
    await db.insert(chatbgpLearnings).values({
      category: fnArgs.category || "general",
      learning: learningText,
      sourceUser: userId,
      sourceUserName: userName,
      confidence: "confirmed",
      active: true,
      subjectPropertyId,
      subjectCompanyNumber,
    });
    return { data: { success: true, saved: learningText }, action: { type: "learning_saved" } };
  }

  if (fnName === "log_app_feedback") {
    const { appFeedbackLog } = await import("@shared/schema");
    const userId = req.session?.userId || "unknown";
    let userName = "Unknown User";
    try { const { storage } = await import("./storage"); const user = await storage.getUser(userId); if (user?.name) userName = user.name; } catch {}
    await db.insert(appFeedbackLog).values({
      category: fnArgs.category || "suggestion",
      summary: fnArgs.summary,
      detail: fnArgs.detail || null,
      userId,
      userName,
      threadId: fnArgs.threadId || null,
      pageContext: fnArgs.pageContext || null,
      status: "new",
    });
    return { data: { success: true, feedbackLogged: fnArgs.summary }, action: { type: "feedback_logged" } };
  }

  if (fnName === "request_app_change") {
    const { appChangeRequests } = await import("@shared/schema");
    const userId = req.session?.userId || "unknown";
    let userName = "Unknown User";
    try { const { storage } = await import("./storage"); const user = await storage.getUser(userId); if (user?.name) userName = user.name; } catch {}
    const [created] = await db.insert(appChangeRequests).values({
      description: fnArgs.description,
      requestedBy: userName,
      requestedByUserId: userId,
      category: fnArgs.category || "feature",
      priority: fnArgs.priority || "normal",
      status: "pending",
    }).returning();
    return { data: { success: true, action: "change_request_created", id: created.id, description: fnArgs.description }, action: { type: "change_request", id: created.id } };
  }

  return { data: { error: `Unknown tool: ${fnName}` } };
}

export async function handleCrmToolCall(
  fnName: string,
  fnArgs: any,
  req: Request,
  completionOptions: any,
  message: any,
  toolCall: ToolCall
): Promise<{ handled: boolean; response?: any }> {
  const { db } = await import("./db");

  try {
    // Gate on the ACTUAL account role, not scope — staff previewing a client
    // team (Woody as MD "Viewing as Landsec") kept losing mailbox/calendar
    // tools because the team switch sets a scope (2026-08-04). Real client
    // logins stay on the allowlist; staff keep full tools in any view.
    // Server-originated curation calls (X-BGP-Internal) run staff-grade
    // even when the forwarded session is a client's — this gate was
    // blocking every mailbox sweep in client-triggered curations.
    const { isClientRequestUser } = await import("./company-scope");
    const { isInternalStaffRequest } = await import("./chatbgp-internal");
    if (!isInternalStaffRequest(req) && await isClientRequestUser(req) && !CLIENT_SAFE_TOOLS.has(fnName)) {
      return { handled: true, response: { reply: "That capability isn't available on client accounts — your account covers your own portfolio only. Contact your BGP team for anything further." } };
    }
  } catch {}

  const summaryHelper = async (toolResult: any) => {
    const summaryMessages = [
      ...completionOptions.messages,
      message,
      { role: "tool" as const, tool_call_id: toolCall.id, content: JSON.stringify(toolResult) },
    ];
    const summaryCompletion = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: summaryMessages,
      max_completion_tokens: 1024,
    });
    return summaryCompletion.choices[0]?.message?.content;
  };

  if (fnName === "create_deal") {
    const { crmDeals } = await import("@shared/schema");
    const [created] = await db.insert(crmDeals).values({
      name: fnArgs.name,
      propertyId: fnArgs.propertyId || null,
      landlordId: fnArgs.landlordId || null,
      tenantId: fnArgs.tenantId || null,
      vendorId: fnArgs.vendorId || null,
      purchaserId: fnArgs.purchaserId || null,
      team: fnArgs.team || [],
      groupName: fnArgs.groupName || "New Instructions",
      dealType: fnArgs.dealType,
      status: fnArgs.status,
      pricing: fnArgs.pricing,
      fee: fnArgs.fee,
      rentPa: fnArgs.rentPa,
      totalAreaSqft: fnArgs.totalAreaSqft,
      comments: fnArgs.comments,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "deal", record: { id: created.id, name: created.name } });
    return { handled: true, response: { reply: reply || `Deal "${created.name}" created.`, action: { type: "crm_created", entityType: "deal", id: created.id, name: created.name } } };
  }

  if (fnName === "update_deal") {
    const { crmDeals } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    await db.update(crmDeals).set(cleanUpdates).where(eq(crmDeals.id, id));
    const reply = await summaryHelper({ success: true, action: "updated", entity: "deal", id, fields: Object.keys(cleanUpdates) });
    return { handled: true, response: { reply: reply || `Deal updated.`, action: { type: "crm_updated", entityType: "deal", id } } };
  }

  if (fnName === "create_contact") {
    const { crmContacts } = await import("@shared/schema");
    const [created] = await db.insert(crmContacts).values({
      name: fnArgs.name,
      email: fnArgs.email,
      phone: fnArgs.phone,
      role: fnArgs.role,
      companyName: fnArgs.companyName,
      contactType: fnArgs.contactType,
      notes: fnArgs.notes,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "contact", record: { id: created.id, name: created.name } });
    return { handled: true, response: { reply: reply || `Contact "${created.name}" created.`, action: { type: "crm_created", entityType: "contact", id: created.id, name: created.name } } };
  }

  if (fnName === "update_contact") {
    const { crmContacts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    await db.update(crmContacts).set(cleanUpdates).where(eq(crmContacts.id, id));
    const reply = await summaryHelper({ success: true, action: "updated", entity: "contact", id, fields: Object.keys(cleanUpdates) });
    return { handled: true, response: { reply: reply || `Contact updated.`, action: { type: "crm_updated", entityType: "contact", id } } };
  }

  if (fnName === "create_company") {
    const { crmCompanies } = await import("@shared/schema");
    const [created] = await db.insert(crmCompanies).values({
      name: fnArgs.name,
      companyType: fnArgs.companyType,
      description: fnArgs.description,
      domain: fnArgs.domain,
      groupName: fnArgs.groupName,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "company", record: { id: created.id, name: created.name } });
    return { handled: true, response: { reply: reply || `Company "${created.name}" created.`, action: { type: "crm_created", entityType: "company", id: created.id, name: created.name } } };
  }

  if (fnName === "update_company") {
    const { crmCompanies } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    await db.update(crmCompanies).set(cleanUpdates).where(eq(crmCompanies.id, id));
    const reply = await summaryHelper({ success: true, action: "updated", entity: "company", id, fields: Object.keys(cleanUpdates) });
    return { handled: true, response: { reply: reply || `Company updated.`, action: { type: "crm_updated", entityType: "company", id } } };
  }

  if (fnName === "update_investment_tracker") {
    const { investmentTracker } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const existing = await db.select({ id: investmentTracker.id, assetName: investmentTracker.assetName }).from(investmentTracker).where(eq(investmentTracker.id, id)).limit(1);
    if (!existing.length) {
      return { handled: true, response: { reply: `No investment tracker item found with ID "${id}". Please search first to find the correct record.` } };
    }
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    cleanUpdates.updatedAt = new Date();
    await db.update(investmentTracker).set(cleanUpdates).where(eq(investmentTracker.id, id));
    const reply = await summaryHelper({ success: true, action: "updated", entity: "investment tracker item", id, name: existing[0].assetName, fields: Object.keys(cleanUpdates) });
    return { handled: true, response: { reply: reply || `Investment tracker item "${existing[0].assetName}" updated.`, action: { type: "crm_updated", entityType: "investment", id } } };
  }

  if (fnName === "search_crm") {
    const { crmDeals, crmContacts, crmCompanies, crmProperties, investmentTracker, availableUnits } = await import("@shared/schema");
    const { ilike, or } = await import("drizzle-orm");
    const rawQuery = (fnArgs.query as string || "").trim();
    if (rawQuery.length < 2) {
      return { handled: true, response: { reply: "Please provide a longer search term (at least 2 characters)." } };
    }
    const legacySearchScope = req ? await resolveCompanyScope(req).catch(() => null) : null;
    if (legacySearchScope) {
      const scoped = await clientScopedCrmSearch(legacySearchScope, rawQuery);
      const reply = await summaryHelper(scoped);
      return { handled: true, response: { reply: reply || JSON.stringify(scoped) } };
    }
    const entityType = fnArgs.entityType || "all";
    const results: any = {};

    const words = rawQuery.split(/\s+/).filter(w => w.length >= 2);
    const exactQ = `%${rawQuery}%`;
    const wordPatterns = words.map(w => `%${w}%`);

    const buildOr = (cols: any[]) => {
      const conditions: any[] = [];
      for (const col of cols) {
        conditions.push(ilike(col, exactQ));
        for (const wp of wordPatterns) {
          conditions.push(ilike(col, wp));
        }
      }
      return or(...conditions);
    };

    if (entityType === "all" || entityType === "deals") {
      const deals = await db.select({ id: crmDeals.id, name: crmDeals.name, groupName: crmDeals.groupName, status: crmDeals.status }).from(crmDeals).where(buildOr([crmDeals.name, crmDeals.comments])).limit(100);
      results.deals = deals;
    }
    if (entityType === "all" || entityType === "contacts") {
      const contacts = await db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, role: crmContacts.role }).from(crmContacts).where(buildOr([crmContacts.name, crmContacts.email])).limit(100);
      results.contacts = contacts;
    }
    if (entityType === "all" || entityType === "companies") {
      const companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType }).from(crmCompanies).where(buildOr([crmCompanies.name])).limit(100);
      results.companies = companies;
    }
    if (entityType === "all" || entityType === "properties") {
      const { sql: sqlTag } = await import("drizzle-orm");
      const addressText = sqlTag`${crmProperties.address}::text`;
      const propConditions: any[] = [];
      propConditions.push(ilike(crmProperties.name, exactQ));
      for (const wp of wordPatterns) propConditions.push(ilike(crmProperties.name, wp));
      propConditions.push(sqlTag`${addressText} ILIKE ${exactQ}`);
      for (const wp of wordPatterns) propConditions.push(sqlTag`${addressText} ILIKE ${wp}`);
      const properties = await db.select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status, address: crmProperties.address }).from(crmProperties).where(or(...propConditions)).limit(100);
      results.properties = properties;
    }
    if (entityType === "all" || entityType === "investment") {
      const investments = await db.select({ id: investmentTracker.id, assetName: investmentTracker.assetName, address: investmentTracker.address, status: investmentTracker.status, boardType: investmentTracker.boardType, client: investmentTracker.client }).from(investmentTracker).where(buildOr([investmentTracker.assetName, investmentTracker.address, investmentTracker.client, investmentTracker.vendor])).limit(100);
      results.investmentTracker = investments;
    }
    if (entityType === "all" || entityType === "units") {
      const units = await db.select({ id: availableUnits.id, unitName: availableUnits.unitName, marketingStatus: availableUnits.marketingStatus, propertyId: availableUnits.propertyId }).from(availableUnits).where(buildOr([availableUnits.unitName])).limit(100);
      results.availableUnits = units;
    }
    if (entityType === "all" || entityType === "requirements") {
      const { pool } = await import("./db");
      const reqConds = [exactQ, ...wordPatterns].map((p: string, i: number) => `(company_name ILIKE $${i+1} OR contact_name ILIKE $${i+1} OR location ILIKE $${i+1} OR notes ILIKE $${i+1})`);
      const reqParams = [exactQ, ...wordPatterns];
      const reqResult = await pool.query(`SELECT id, category, company_name AS "companyName", contact_name AS "contactName", location, status, priority FROM requirements WHERE ${reqConds.join(" OR ")} LIMIT 100`, reqParams);
      results.requirements = reqResult.rows;
    }
    if (entityType === "all" || entityType === "comps") {
      const { crmComps } = await import("@shared/schema");
      results.comps = await db.select({ id: crmComps.id, name: crmComps.name, tenant: crmComps.tenant, landlord: crmComps.landlord, dealType: crmComps.dealType, headlineRent: crmComps.headlineRent, completionDate: crmComps.completionDate }).from(crmComps).where(buildOr([crmComps.name, crmComps.tenant, crmComps.landlord])).limit(100);
    }

    const totalFound = Object.values(results).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
    const reply = await summaryHelper({ success: true, query: fnArgs.query, totalFound, results });
    return { handled: true, response: { reply: reply || `Found ${totalFound} results for "${fnArgs.query}".` } };
  }

  if (fnName === "create_investment_tracker") {
    const { investmentTracker, crmProperties } = await import("@shared/schema");
    let propertyId: string;
    const [existingProp] = await db.select().from(crmProperties).where(eq(crmProperties.name, fnArgs.assetName)).limit(1);
    if (existingProp) {
      propertyId = existingProp.id;
    } else {
      const [newProp] = await db.insert(crmProperties).values({
        name: fnArgs.assetName,
        address: fnArgs.address ? { street: fnArgs.address } : null,
        tenure: fnArgs.tenure || null,
      }).returning();
      propertyId = newProp.id;
    }
    const [created] = await db.insert(investmentTracker).values({
      propertyId,
      assetName: fnArgs.assetName,
      address: fnArgs.address,
      status: fnArgs.status || "Reporting",
      boardType: fnArgs.boardType || "Purchases",
      client: fnArgs.client,
      clientContact: fnArgs.clientContact,
      vendor: fnArgs.vendor,
      vendorAgent: fnArgs.vendorAgent,
      guidePrice: fnArgs.guidePrice,
      niy: fnArgs.niy,
      eqy: fnArgs.eqy,
      sqft: fnArgs.sqft,
      currentRent: fnArgs.currentRent,
      ervPa: fnArgs.ervPa,
      waultBreak: fnArgs.waultBreak,
      waultExpiry: fnArgs.waultExpiry,
      occupancy: fnArgs.occupancy,
      capexRequired: fnArgs.capexRequired,
      tenure: fnArgs.tenure,
      fee: fnArgs.fee,
      feeType: fnArgs.feeType,
      notes: fnArgs.notes,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "investment tracker item", record: { id: created.id, name: created.assetName } });
    return { handled: true, response: { reply: reply || `Investment tracker item "${created.assetName}" created.`, action: { type: "crm_created", entityType: "investment", id: created.id, name: created.assetName } } };
  }

  if (fnName === "create_available_unit") {
    const { availableUnits } = await import("@shared/schema");
    const [created] = await db.insert(availableUnits).values({
      propertyId: fnArgs.propertyId,
      unitName: fnArgs.unitName,
      floor: fnArgs.floor,
      sqft: fnArgs.sqft,
      askingRent: fnArgs.askingRent,
      ratesPa: fnArgs.ratesPa,
      serviceChargePa: fnArgs.serviceChargePa,
      useClass: fnArgs.useClass,
      condition: fnArgs.condition,
      availableDate: fnArgs.availableDate,
      marketingStatus: fnArgs.marketingStatus || "Available",
      epcRating: fnArgs.epcRating,
      notes: fnArgs.notes,
      fee: fnArgs.fee,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "available unit", record: { id: created.id, name: created.unitName } });
    return { handled: true, response: { reply: reply || `Available unit "${created.unitName}" created.`, action: { type: "crm_created", entityType: "unit", id: created.id, name: created.unitName } } };
  }

  if (fnName === "update_available_unit") {
    const { availableUnits } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const existing = await db.select({ id: availableUnits.id, unitName: availableUnits.unitName }).from(availableUnits).where(eq(availableUnits.id, id)).limit(1);
    if (!existing.length) {
      return { handled: true, response: { reply: `No available unit found with that ID. Please search first.` } };
    }
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    cleanUpdates.updatedAt = new Date();
    await db.update(availableUnits).set(cleanUpdates).where(eq(availableUnits.id, id));
    const reply = await summaryHelper({ success: true, action: "updated", entity: "available unit", id, name: existing[0].unitName, fields: Object.keys(cleanUpdates) });
    return { handled: true, response: { reply: reply || `Unit "${existing[0].unitName}" updated.`, action: { type: "crm_updated", entityType: "unit", id } } };
  }

  if (fnName === "log_viewing") {
    if (fnArgs.entityType === "investment") {
      const { investmentViewings } = await import("@shared/schema");
      const [created] = await db.insert(investmentViewings).values({
        trackerId: fnArgs.entityId,
        company: fnArgs.company,
        contact: fnArgs.contact,
        viewingDate: fnArgs.viewingDate ? new Date(fnArgs.viewingDate) : new Date(),
        attendees: fnArgs.attendees,
        notes: fnArgs.notes,
        outcome: fnArgs.outcome,
      }).returning();
      const reply = await summaryHelper({ success: true, action: "logged", entity: "investment viewing", company: fnArgs.company, date: fnArgs.viewingDate });
      return { handled: true, response: { reply: reply || `Viewing logged for ${fnArgs.company || "unknown"} on ${fnArgs.viewingDate}.` } };
    } else {
      const { unitViewings } = await import("@shared/schema");
      const [created] = await db.insert(unitViewings).values({
        unitId: fnArgs.entityId,
        companyName: fnArgs.company,
        contactName: fnArgs.contact,
        viewingDate: fnArgs.viewingDate,
        viewingTime: fnArgs.viewingTime,
        attendees: fnArgs.attendees,
        notes: fnArgs.notes,
        outcome: fnArgs.outcome,
      }).returning();
      const reply = await summaryHelper({ success: true, action: "logged", entity: "unit viewing", company: fnArgs.company, date: fnArgs.viewingDate });
      return { handled: true, response: { reply: reply || `Viewing logged for ${fnArgs.company || "unknown"} on ${fnArgs.viewingDate}.` } };
    }
  }

  if (fnName === "log_offer") {
    if (fnArgs.entityType === "investment") {
      const { investmentOffers } = await import("@shared/schema");
      const [created] = await db.insert(investmentOffers).values({
        trackerId: fnArgs.entityId,
        company: fnArgs.company,
        contact: fnArgs.contact,
        offerDate: fnArgs.offerDate ? new Date(fnArgs.offerDate) : new Date(),
        offerPrice: fnArgs.offerPrice,
        niy: fnArgs.niy,
        conditions: fnArgs.conditions,
        status: fnArgs.status || "Pending",
        notes: fnArgs.notes,
      }).returning();
      const reply = await summaryHelper({ success: true, action: "logged", entity: "investment offer", company: fnArgs.company, price: fnArgs.offerPrice });
      return { handled: true, response: { reply: reply || `Offer logged from ${fnArgs.company || "unknown"} for £${fnArgs.offerPrice?.toLocaleString() || "TBC"}.` } };
    } else {
      const { unitOffers } = await import("@shared/schema");
      const [created] = await db.insert(unitOffers).values({
        unitId: fnArgs.entityId,
        companyName: fnArgs.company,
        contactName: fnArgs.contact,
        offerDate: fnArgs.offerDate,
        rentPa: fnArgs.rentPa,
        rentFreeMonths: fnArgs.rentFreeMonths,
        termYears: fnArgs.termYears,
        breakOption: fnArgs.breakOption,
        incentives: fnArgs.incentives,
        premium: fnArgs.premium,
        fittingOutContribution: fnArgs.fittingOutContribution,
        status: fnArgs.status || "Pending",
        comments: fnArgs.notes,
      }).returning();
      const reply = await summaryHelper({ success: true, action: "logged", entity: "leasing offer", company: fnArgs.company, rent: fnArgs.rentPa });
      return { handled: true, response: { reply: reply || `Offer logged from ${fnArgs.company || "unknown"}.` } };
    }
  }

  if (fnName === "create_property") {
    const { crmProperties } = await import("@shared/schema");
    const created = await db.insert(crmProperties).values({
      name: fnArgs.name, address: fnArgs.address || null,
      postcode: fnArgs.postcode || fnArgs.address?.postcode || null,
      latitude: fnArgs.latitude || null, longitude: fnArgs.longitude || null,
      agent: fnArgs.agent || null,
      assetClass: fnArgs.assetClass || null, tenure: fnArgs.tenure || null, sqft: fnArgs.sqft || null,
      status: fnArgs.status || "Active", notes: fnArgs.notes || null,
      website: fnArgs.website || null, tags: fnArgs.tags || null, groupName: fnArgs.groupName || null,
      titleNumber: fnArgs.titleNumber || null, competitorAgent: fnArgs.competitorAgent || null,
      folderTeams: fnArgs.folderTeams || null,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "property", name: created[0].name, id: created[0].id });
    return { handled: true, response: { reply: reply || `Property "${created[0].name}" created.`, action: { type: "crm_created", entityType: "property", id: created[0].id } } };
  }

  if (fnName === "update_property") {
    const { crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const { id, ...updates } = fnArgs;
    const existing = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, id)).limit(1);
    if (!existing.length) {
      return { handled: true, response: { reply: `No property found with ID "${id}". Please search first to find the correct record.` } };
    }
    const cleanUpdates: any = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) cleanUpdates[k] = v;
    }
    if (Object.keys(cleanUpdates).length === 0) {
      return { handled: true, response: { reply: "No fields to update. Please specify at least one field to change." } };
    }
    await db.update(crmProperties).set(cleanUpdates).where(eq(crmProperties.id, id));
    const reply = await summaryHelper({ success: true, action: "updated", entity: "property", id, name: existing[0].name, fields: Object.keys(cleanUpdates) });
    return { handled: true, response: { reply: reply || `Property "${existing[0].name}" updated.`, action: { type: "crm_updated", entityType: "property", id } } };
  }

  if (fnName === "upsert_tenancy_schedule") {
    const { tenancyScheduleUnits, crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const propertyId = fnArgs.propertyId as string;
    const rows: any[] = Array.isArray(fnArgs.rows) ? fnArgs.rows : [];
    const prop = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, propertyId)).limit(1);
    if (!prop.length) return { handled: true, response: { reply: `No property found with ID "${propertyId}". Please search first.` } };
    if (!rows.length) return { handled: true, response: { reply: "No tenancy rows provided." } };
    const toDate = (v: any) => (v ? new Date(v) : null);
    let inserted = 0, updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const values: any = {
        propertyId,
        unitNumber: r.unitNumber ?? null, premises: r.premises ?? null, permittedUse: r.permittedUse ?? null,
        tenantName: r.tenantName ?? null, tradingName: r.tradingName ?? null,
        leaseStart: toDate(r.leaseStart), leaseExpiry: toDate(r.leaseExpiry), breakDate: toDate(r.breakDate), nextReviewDate: toDate(r.nextReviewDate),
        termYears: r.termYears ?? null, passingRentPa: r.passingRentPa ?? null, ervPa: r.ervPa ?? null,
        niaSqft: r.niaSqft ?? null, giaSqft: r.giaSqft ?? null, rateableValue: r.rateableValue ?? null,
        status: r.status ?? (r.tenantName && String(r.tenantName).toLowerCase() !== "vacant" ? "Occupied" : "Vacant"),
        comments: r.comments ?? null,
      };
      if (r.id) {
        const clean: any = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(values)) { if (v !== undefined && v !== null && k !== "propertyId") clean[k] = v; }
        await db.update(tenancyScheduleUnits).set(clean).where(eq(tenancyScheduleUnits.id, r.id));
        updated++;
      } else {
        values.sortOrder = i;
        await db.insert(tenancyScheduleUnits).values(values);
        inserted++;
      }
    }
    const reply = await summaryHelper({ success: true, action: "upserted", entity: "tenancy schedule", name: prop[0].name, inserted, updated });
    return { handled: true, response: { reply: reply || `Tenancy schedule updated for "${prop[0].name}" (${inserted} added, ${updated} updated).`, action: { type: "crm_updated", entityType: "property", id: propertyId } } };
  }

  if (fnName === "add_property_imagery") {
    const { propertyImageryAssets, crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const propertyId = fnArgs.propertyId as string;
    const images: any[] = Array.isArray(fnArgs.images) ? fnArgs.images : [];
    const prop = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, propertyId)).limit(1);
    if (!prop.length) return { handled: true, response: { reply: `No property found with ID "${propertyId}". Please search first.` } };
    if (!images.length) return { handled: true, response: { reply: "No images provided." } };
    let added = 0;
    for (const img of images) {
      if (!img?.kind || !img?.source) continue;
      await db.insert(propertyImageryAssets).values({
        propertyId, kind: img.kind, source: img.source,
        sourceUrl: img.sourceUrl ?? null, imageStudioId: img.imageStudioId ?? null,
        caption: img.caption ?? null, score: img.score ?? 0.6,
        width: img.width ?? null, height: img.height ?? null, pinned: img.pinned ?? false,
        generatedBy: req.session?.userId || (req as any).tokenUserId || null,
      } as any);
      added++;
    }
    const reply = await summaryHelper({ success: true, action: "added", entity: "property imagery", name: prop[0].name, added });
    return { handled: true, response: { reply: reply || `Attached ${added} image(s) to "${prop[0].name}".`, action: { type: "crm_updated", entityType: "property", id: propertyId } } };
  }

  if (fnName === "update_requirement") {
    const { pool } = await import("./db");
    const { id, ...updates } = fnArgs;
    const check = await pool.query(`SELECT id, company_name FROM requirements WHERE id = $1`, [id]);
    if (!check.rows.length) {
      return { handled: true, response: { reply: `No requirement found with ID "${id}". Please search first.` } };
    }
    const fieldMap: Record<string, string> = { category: "category", companyName: "company_name", contactName: "contact_name", sizeMin: "size_min", sizeMax: "size_max", budget: "budget", location: "location", status: "status", notes: "notes", priority: "priority" };
    const sets: string[] = [];
    const params: any[] = [id];
    let idx = 2;
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null && fieldMap[k]) {
        sets.push(`${fieldMap[k]} = $${idx}`);
        params.push(v);
        idx++;
      }
    }
    if (sets.length === 0) {
      return { handled: true, response: { reply: "No fields to update. Please specify at least one field to change." } };
    }
    await pool.query(`UPDATE requirements SET ${sets.join(", ")} WHERE id = $1`, params);
    const reply = await summaryHelper({ success: true, action: "updated", entity: "requirement", id, company: check.rows[0].company_name, fields: Object.keys(updates) });
    return { handled: true, response: { reply: reply || `Requirement for "${check.rows[0].company_name}" updated.` } };
  }

  if (fnName === "create_comp") {
    const { crmComps } = await import("@shared/schema");
    const created = await db.insert(crmComps).values({
      name: fnArgs.name, tenant: fnArgs.tenant || null, landlord: fnArgs.landlord || null,
      dealType: fnArgs.dealType || null, areaSqft: fnArgs.areaSqft || null,
      headlineRent: fnArgs.headlineRent || null, overallRate: fnArgs.overallRate || null,
      zoneARate: fnArgs.zoneARate || null, term: fnArgs.term || null, rentFree: fnArgs.rentFree || null,
      capex: fnArgs.capex || null, completionDate: fnArgs.completionDate || null,
      comments: fnArgs.comments || null, propertyId: fnArgs.propertyId || null, dealId: fnArgs.dealId || null,
      transactionType: fnArgs.transactionType || null, useClass: fnArgs.useClass || null,
      ltActStatus: fnArgs.ltActStatus || null, passingRent: fnArgs.passingRent || null,
      fitoutContribution: fnArgs.fitoutContribution || null, sourceEvidence: fnArgs.sourceEvidence || "ChatBGP",
      niaSqft: fnArgs.niaSqft || null, giaSqft: fnArgs.giaSqft || null, itzaSqft: fnArgs.itzaSqft || null,
      netEffectiveRent: fnArgs.netEffectiveRent || null, breakClause: fnArgs.breakClause || null,
      areaLocation: fnArgs.areaLocation || null, postcode: fnArgs.postcode || null,
      measurementStandard: fnArgs.measurementStandard || null,
      rentPsfNia: fnArgs.rentPsfNia || null, rentPsfGia: fnArgs.rentPsfGia || null,
      rentAnalysis: fnArgs.rentAnalysis || null,
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "leasing comp", name: created[0].name, tenant: fnArgs.tenant });
    return { handled: true, response: { reply: reply || `Leasing comp "${created[0].name}" recorded.`, action: { type: "crm_created", entityType: "comp", id: created[0].id } } };
  }

  if (fnName === "create_investment_comp") {
    const { investmentComps } = await import("@shared/schema");
    const created = await db.insert(investmentComps).values({
      propertyName: fnArgs.propertyName, address: fnArgs.address || null,
      transactionType: fnArgs.transactionType || null, price: fnArgs.price || null,
      pricePsf: fnArgs.pricePsf || null, capRate: fnArgs.capRate || null,
      areaSqft: fnArgs.areaSqft || null, buyer: fnArgs.buyer || null, seller: fnArgs.seller || null,
      buyerBroker: fnArgs.buyerBroker || null, sellerBroker: fnArgs.sellerBroker || null,
      transactionDate: fnArgs.transactionDate || null, comments: fnArgs.comments || null,
      propertyId: fnArgs.propertyId || null, source: "ChatBGP",
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "investment comp", name: created[0].propertyName, price: fnArgs.price });
    return { handled: true, response: { reply: reply || `Investment comp "${created[0].propertyName}" recorded.`, action: { type: "crm_created", entityType: "investment_comp", id: created[0].id } } };
  }

  if (fnName === "link_entities") {
    const { pool } = await import("./db");
    const { v4: uuid } = await import("uuid");
    const linkId = uuid();
    const linkType = fnArgs.linkType as string;
    const sourceId = fnArgs.sourceId as string;
    const targetId = fnArgs.targetId as string;
    try {
      if (linkType === "contact-deal") {
        const check = await pool.query(`SELECT id FROM crm_contacts WHERE id = $1`, [sourceId]);
        if (!check.rows.length) return { handled: true, response: { reply: `Contact with ID "${sourceId}" not found.` } };
        await pool.query(`INSERT INTO crm_contact_deals (id, contact_id, deal_id) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crm_contact_deals WHERE contact_id = $2 AND deal_id = $3)`, [linkId, sourceId, targetId]);
      } else if (linkType === "contact-property") {
        await pool.query(`INSERT INTO crm_contact_properties (id, contact_id, property_id) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crm_contact_properties WHERE contact_id = $2 AND property_id = $3)`, [linkId, sourceId, targetId]);
      } else if (linkType === "contact-requirement") {
        await pool.query(`INSERT INTO crm_contact_requirements (id, contact_id, requirement_id) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crm_contact_requirements WHERE contact_id = $2 AND requirement_id = $3)`, [linkId, sourceId, targetId]);
      } else if (linkType === "company-property") {
        await pool.query(`INSERT INTO crm_company_properties (id, company_id, property_id) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crm_company_properties WHERE company_id = $2 AND property_id = $3)`, [linkId, sourceId, targetId]);
      } else if (linkType === "company-deal") {
        await pool.query(`INSERT INTO crm_company_deals (id, company_id, deal_id) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM crm_company_deals WHERE company_id = $2 AND deal_id = $3)`, [linkId, sourceId, targetId]);
      } else {
        return { handled: true, response: { reply: `Unknown link type "${linkType}".` } };
      }
      const reply = await summaryHelper({ success: true, action: "linked", linkType, sourceId, targetId });
      return { handled: true, response: { reply: reply || `${linkType} relationship created.` } };
    } catch (err: any) {
      if (err.message?.includes("does not exist")) {
        return { handled: true, response: { reply: `That relationship table doesn't exist yet. The link type "${linkType}" may not be supported.` } };
      }
      return { handled: true, response: { reply: `Error creating link: ${err.message}` } };
    }
  }

  const APP_BUILDER_TOOLS = new Set(["list_project_files", "read_source_file", "edit_source_file", "run_shell_command", "add_database_column", "restart_application"]);
  if (APP_BUILDER_TOOLS.has(fnName)) {
    const rawResult = await executeCrmToolRaw(fnName, fnArgs, req);
    const reply = await summaryHelper(rawResult.data);
    return { handled: true, response: { reply: reply || JSON.stringify(rawResult.data).substring(0, 500), action: rawResult.action } };
  }

  if (fnName === "generate_image") {
    const rawResult = await executeCrmToolRaw(fnName, fnArgs, req);
    const reply = rawResult.data?.success ? `Image generated for: "${fnArgs.prompt}"` : (rawResult.data?.error || "Image generation failed");
    return { handled: true, response: { reply, action: rawResult.action } };
  }

  if (fnName === "create_requirement") {
    const { pool } = await import("./db");
    const { v4: uuid } = await import("uuid");
    const id = uuid();
    await pool.query(
      `INSERT INTO requirements (id, category, company_name, contact_name, size_min, size_max, budget, location, status, notes, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, fnArgs.category, fnArgs.companyName, fnArgs.contactName || null, fnArgs.sizeMin || null, fnArgs.sizeMax || null, fnArgs.budget || null, fnArgs.location || null, "active", fnArgs.notes || null, fnArgs.priority || "medium"]
    );
    const reply = await summaryHelper({ success: true, action: "created", entity: "requirement", category: fnArgs.category, company: fnArgs.companyName, location: fnArgs.location, size: fnArgs.sizeMin ? `${fnArgs.sizeMin} - ${fnArgs.sizeMax}` : null });
    return { handled: true, response: { reply: reply || `${fnArgs.category} requirement logged for ${fnArgs.companyName}.` } };
  }

  if (fnName === "create_diary_entry") {
    const { diaryEntries } = await import("@shared/schema");
    const created = await db.insert(diaryEntries).values({
      title: fnArgs.title, person: fnArgs.person, project: fnArgs.project || null,
      day: fnArgs.day, time: fnArgs.time, type: fnArgs.type || "meeting",
    }).returning();
    const reply = await summaryHelper({ success: true, action: "created", entity: "diary entry", title: created[0].title, day: fnArgs.day, time: fnArgs.time });
    return { handled: true, response: { reply: reply || `Diary entry "${created[0].title}" logged for ${fnArgs.day} at ${fnArgs.time}.` } };
  }

  if (fnName === "create_task") {
    const requesterId = req?.session?.userId || (req as any)?.tokenUserId || null;
    if (!requesterId) return { handled: true, response: { reply: "I couldn't work out who's asking, so I can't set the task." } };
    let ownerId = requesterId;
    let assignedById: string | null = null;
    let assignedByName: string | null = null;
    let assigneeName: string | null = null;
    if (fnArgs.assigneeName) {
      // Resolve the named person; clients (Landsec) may only assign within
      // the people working on their account — same rule as the HTTP route.
      const { resolveCompanyScope, getClientVisibleUserIds } = await import("./company-scope");
      const scope = await resolveCompanyScope(req);
      const allowedIds = scope ? await getClientVisibleUserIds(scope) : null;
      const match = await pool.query(
        `SELECT id, name FROM users WHERE is_active IS NOT FALSE AND name ILIKE $1 ORDER BY name LIMIT 5`,
        [`%${String(fnArgs.assigneeName).trim()}%`]
      );
      const candidates = allowedIds ? match.rows.filter((r: any) => allowedIds.has(r.id) || r.id === requesterId) : match.rows;
      if (!candidates.length) return { handled: true, response: { reply: `I couldn't find "${fnArgs.assigneeName}" among the people you can assign tasks to.` } };
      if (candidates.length > 1) return { handled: true, response: { reply: `Which ${fnArgs.assigneeName} — ${candidates.map((c: any) => c.name).join(", ")}?` } };
      if (candidates[0].id !== requesterId) {
        ownerId = candidates[0].id;
        assigneeName = candidates[0].name;
        assignedById = requesterId;
        const meQ = await pool.query(`SELECT name FROM users WHERE id = $1`, [requesterId]);
        assignedByName = meQ.rows[0]?.name || null;
      }
    }
    const ins = await pool.query(
      `INSERT INTO user_tasks (user_id, title, description, due_date, priority, assigned_by_user_id, assigned_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title`,
      [ownerId, String(fnArgs.title).trim(), fnArgs.description || null, fnArgs.dueDate || null, fnArgs.priority || "medium", assignedById, assignedByName]
    );
    if (assignedById) {
      try {
        const { emitNotification } = await import("./websocket");
        const { sendPushNotification } = await import("./push-notifications");
        emitNotification(ownerId, { type: "task_assigned", threadId: "", senderName: assignedByName || "Someone", preview: ins.rows[0].title } as any);
        sendPushNotification(ownerId, { title: `New task from ${assignedByName || "a colleague"}`, body: ins.rows[0].title.slice(0, 100), tag: `task-${ins.rows[0].id}`, url: "/tasks" }).catch(() => {});
      } catch { /* notification is best-effort */ }
    }
    return { handled: true, response: {
      reply: assigneeName
        ? `Task set for ${assigneeName}: "${ins.rows[0].title}"${fnArgs.dueDate ? ` (due ${fnArgs.dueDate})` : ""} — they've been notified.`
        : `Task added to your list: "${ins.rows[0].title}"${fnArgs.dueDate ? ` (due ${fnArgs.dueDate})` : ""}.`,
      action: { type: "navigate", url: "/tasks" },
    } };
  }

  if (fnName === "web_search") {
    const searchQuery = fnArgs.query as string;
    try {
      if (!isPerplexityConfigured()) return { handled: true, response: { reply: "Web search is not configured (PERPLEXITY_API_KEY missing)." } };
      const r = await askPerplexity(searchQuery, { maxTokens: 800, temperature: 0.1 });
      console.log(`[ChatBGP] Web search for "${searchQuery}" via Perplexity — ${r.citations.length} citations`);
      const citationList = r.citations.length > 0
        ? "\n\nSources: " + r.citations.map(c => c.title ? `[${c.title}](${c.url})` : c.url).join(" · ")
        : "";
      return { handled: true, response: { reply: r.answer + citationList } };
    } catch (err: any) {
      return { handled: true, response: { reply: `Sorry, the web search failed: ${err.message}` } };
    }
  }

  if (fnName === "ingest_url") {
    // bgp.uk.com is a JS app — its HTML carries only the title. Read the
    // machine-readable site.json instead (see chatbgp-app-map).
    if (typeof fnArgs.url === "string" && /(^|\/\/|\.)bgp\.uk\.com/i.test(fnArgs.url) && !/site\.json/i.test(fnArgs.url)) fnArgs.url = "https://www.bgp.uk.com/site.json";
    const targetUrl = fnArgs.url as string;
    try {
      // Subscriber cookies (Green Street, Property Week, Drapers...) ride
      // along automatically — without them a paywalled URL returns the
      // teaser, not the article BGP's subscription entitles it to.
      const { authHeadersForUrl } = await import("./auth-cookies");
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          ...authHeadersForUrl(targetUrl),
        },
        redirect: "follow",
      });
      if (!response.ok) return { handled: true, response: { reply: `Sorry, I couldn't fetch that URL — got HTTP ${response.status}.` } };
      const contentType = response.headers.get("content-type") || "";
      let extractedText = "";
      let title = "";

      if (contentType.includes("pdf") || targetUrl.toLowerCase().endsWith(".pdf")) {
        const buffer = await response.arrayBuffer();
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse(new Uint8Array(buffer));
        const textResult = await parser.getText();
        extractedText = textResult.pages.map((p: any) => p.text || "").join("\n\n");
        const info = await parser.getInfo();
        title = info?.info?.Title || targetUrl.split("/").pop()?.replace(/-/g, " ").replace(".pdf", "") || "PDF Document";
      } else {
        ({ title, extractedText } = await ingestNonPdfBody(response, targetUrl, contentType));
      }

      const truncated = extractedText.substring(0, 15000);

      if (fnArgs.addToNews) {
        const { pool } = await import("./db");
        const { v4: uuid } = await import("uuid");
        const articleId = uuid();
        const sourceName = fnArgs.sourceName || new URL(targetUrl).hostname.replace("www.", "");
        await pool.query(
          `INSERT INTO news_articles (id, source_name, title, url, summary, category, published_at, processed)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)`,
          [articleId, sourceName, title, targetUrl, truncated.substring(0, 2000), "research"]
        );
      }

      const reply = await summaryHelper({ success: true, title, contentLength: extractedText.length, savedToNews: !!fnArgs.addToNews, content: truncated });
      return { handled: true, response: { reply: reply || `I've read "${title}" (${extractedText.length} characters).${fnArgs.addToNews ? " Saved to news feed." : ""}` } };
    } catch (err: any) {
      return { handled: true, response: { reply: `Sorry, I couldn't read that URL: ${err.message}` } };
    }
  }

  if (fnName === "follow_url") {
    const targetUrl = (fnArgs.url as string || "").trim();
    if (!targetUrl) return { handled: true, response: { reply: "I need a URL to follow." } };
    try {
      const { newsSources } = await import("@shared/schema");
      const { createRssAppFeed } = await import("./rssapp");
      const existing = await db.select().from(newsSources).where(eq(newsSources.url, targetUrl)).limit(1);
      if (existing.length > 0) {
        return { handled: true, response: { reply: `Already tracking **${existing[0].name}** — new articles flow into your news feed automatically.` } };
      }
      const feed = await createRssAppFeed(targetUrl);
      const [source] = await db.insert(newsSources).values({
        name: (fnArgs.name as string) || feed.title || new URL(targetUrl).hostname.replace("www.", ""),
        url: targetUrl,
        feedUrl: feed.rss_feed_url,
        type: "rssapp",
        category: (fnArgs.category as string) || "general",
        active: true,
      }).returning();
      console.log(`[ChatBGP] follow_url: registered "${source.name}" (${targetUrl}) via RSS.app`);
      return { handled: true, response: { reply: `Now tracking **${source.name}**. New posts will land in your news feed on the next poll.` } };
    } catch (err: any) {
      return { handled: true, response: { reply: `Couldn't start following that URL: ${err?.message || err}` } };
    }
  }

  if (fnName === "search_news") {
    const { newsArticles } = await import("@shared/schema");
    const { ilike, or, desc: descOrder } = await import("drizzle-orm");
    const query = (fnArgs.query as string || "").trim();
    const limit = fnArgs.limit || 10;
    const words = query.split(/\s+/).filter((w: string) => w.length >= 2);
    const conditions: any[] = [];
    for (const w of words) {
      const pat = `%${w}%`;
      conditions.push(ilike(newsArticles.title, pat));
      conditions.push(ilike(newsArticles.summary, pat));
    }
    if (conditions.length === 0) {
      return { handled: true, response: { reply: "Please provide a search term for news." } };
    }
    const articles = await db.select({
      id: newsArticles.id,
      title: newsArticles.title,
      summary: newsArticles.aiSummary,
      url: newsArticles.url,
      publishedAt: newsArticles.publishedAt,
      source: newsArticles.sourceName,
      category: newsArticles.category,
    }).from(newsArticles).where(or(...conditions)).orderBy(descOrder(newsArticles.publishedAt)).limit(limit);
    const reply = await summaryHelper({ success: true, query, totalFound: articles.length, articles });
    return { handled: true, response: { reply: reply || `Found ${articles.length} news articles for "${query}".` } };
  }

  if (fnName === "search_green_street") {
    const { searchGreenStreet } = await import("./news-feeds");
    const query = (fnArgs.query as string || "").trim();
    const limit = fnArgs.limit || 10;
    if (!query) return { handled: true, response: { reply: "Please provide a search term for Green Street News." } };
    const result = await searchGreenStreet(query, limit);
    if (result.error) return { handled: true, response: { reply: result.error } };
    const reply = await summaryHelper(result);
    return { handled: true, response: { reply: reply || `Found ${result.totalFound} Green Street articles for "${query}".` } };
  }

  if (fnName === "property_data_lookup") {
    const apiKey = process.env.PROPERTYDATA_API_KEY;
    if (!apiKey) return { handled: true, response: { reply: "PropertyData API key not configured." } };
    // No allowlist — PropertyData ship new endpoints regularly and a
    // hardcoded list goes stale. Validate the SHAPE of the endpoint
    // name only: lowercase letters, digits, hyphens, no path-escape
    // characters. That blocks SSRF / injection while letting any
    // legitimate PropertyData endpoint through.
    const VALID_ENDPOINT = /^[a-z0-9][a-z0-9-]{1,60}$/;
    const endpoint = fnArgs.endpoint as string;
    if (!endpoint || !VALID_ENDPOINT.test(endpoint)) return { handled: true, response: { reply: `Invalid endpoint name "${endpoint}". Endpoint names must be lowercase letters/digits/hyphens only.` } };
    const postcode = (fnArgs.postcode as string || "").trim().replace(/\s{2,}/g, " ");
    const needsPostcode = !["uprn", "uprn-title", "analyse-buildings", "land-registry-documents"].includes(endpoint);
    if (needsPostcode && !postcode) return { handled: true, response: { reply: "Postcode is required." } };
    if (endpoint === "address-match-uprn" && !fnArgs.address) return { handled: true, response: { reply: "Both 'address' (street address, e.g. '10 Lowndes Street') and 'postcode' are required for address-match-uprn." } };
    if (endpoint === "land-registry-documents" && !fnArgs.title) return { handled: true, response: { reply: "Title number is required for land-registry-documents." } };
    // Dedicated Land Registry path — multi-title + server-side ZIP/PDF
    // extraction (mirrors the property_data_lookup handler above).
    if (endpoint === "land-registry-documents") {
      const titles = String(fnArgs.title).split(/[,\s]+/).filter(Boolean);
      const docs = await fetchLandRegistryDocuments(apiKey, titles, (fnArgs.documents as string) || "both", fnArgs.extract_proprietor_data !== false);
      const replyParts = docs.map((d) => {
        const lines = [`Title ${d.title}${d.alreadyPurchased ? " (previously purchased)" : ""}:`];
        if (d.error) lines.push(`  Error: ${d.error}`);
        // Bare URL on its own line — the chat UI auto-links bare URLs;
        // markdown [text](url) was rendering as literal brackets.
        if (d.documentUrl) lines.push(`  Download: ${d.documentUrl}`);
        for (const f of d.files) {
          if (f.text) lines.push(`  --- ${f.filename} ---\n${f.text}`);
          else if (f.note) lines.push(`  ${f.filename}: ${f.note}`);
        }
        // PropertyData returned nothing — don't leave a bare "Title X:" line.
        // Give what our own register knows plus the direct-HMLR order link.
        if (!d.delivered) {
          if (d.registerKnown) {
            const who = d.registerKnown.proprietors.join(", ") || "—";
            const extras = [d.registerKnown.tenure, d.registerKnown.propertyAddress].filter(Boolean).join(" · ");
            lines.push(`  Our HMLR register: ${who}${extras ? ` (${extras})` : ""}`);
          }
          if (d.manualOrder) {
            lines.push(`  ${d.manualOrder.note}`);
            lines.push(`  ${d.manualOrder.url}`);
          }
        }
        return lines.join("\n");
      });
      return { handled: true, response: { reply: replyParts.join("\n\n") || "No documents returned." } };
    }
    try {
      const params = new URLSearchParams({ key: apiKey });
      if (postcode) params.set("postcode", postcode);
      if (fnArgs.property_type) params.set("type", fnArgs.property_type);
      if (fnArgs.internal_area) params.set("internal_area", String(fnArgs.internal_area));
      if (fnArgs.bedrooms !== undefined) params.set("bedrooms", String(fnArgs.bedrooms));
      if (fnArgs.max_age) params.set("max_age", String(fnArgs.max_age));
      if (fnArgs.address) params.set("address", fnArgs.address as string);
      if (fnArgs.uprn) params.set("uprn", String(fnArgs.uprn));
      if (fnArgs.title) params.set("title", fnArgs.title as string);
      if (endpoint.startsWith("valuation-commercial") || endpoint === "rebuild-cost") {
        if (fnArgs.property_type) params.set("property_type", fnArgs.property_type);
        params.delete("type");
      }
      const url = `https://api.propertydata.co.uk/${endpoint}?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        let errBody = "";
        try { errBody = await res.text(); } catch {}
        return { handled: true, response: { reply: `PropertyData API returned HTTP ${res.status}: ${errBody.slice(0, 300)}` } };
      }
      const data = await res.json() as any;
      if (data.status === "error") {
        return { handled: true, response: { reply: `PropertyData error: ${data.message || "Unknown error"}` } };
      }
      const reply = await summaryHelper({ success: true, source: "PropertyData.co.uk", endpoint, postcode: fnArgs.postcode, ...data });
      return { handled: true, response: { reply: reply || JSON.stringify(data).slice(0, 2000) } };
    } catch (err: any) {
      return { handled: true, response: { reply: `PropertyData API error: ${err?.message}` } };
    }
  }

  if (fnName === "tfl_nearby") {
    const postcode = (fnArgs.postcode as string || "").trim();
    if (!postcode) return { handled: true, response: { reply: "Postcode is required." } };
    try {
      const geocodeResp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
      if (!geocodeResp.ok) return { handled: true, response: { reply: "Could not geocode postcode." } };
      const geoData = await geocodeResp.json() as any;
      const lat = geoData.result?.latitude;
      const lng = geoData.result?.longitude;
      if (!lat || !lng) return { handled: true, response: { reply: "Could not geocode postcode." } };
      const radius = Math.max(100, Math.min(Number(fnArgs.radius) || 1500, 3000));
      const url = `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=${radius}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return { handled: true, response: { reply: `TfL API returned HTTP ${resp.status}` } };
      const data = await resp.json() as any;
      const stations = (data.stopPoints || []).map((s: any) => ({
        name: s.commonName,
        distance: Math.round(s.distance || 0),
        walkMinutes: Math.round((s.distance || 0) / 80),
        modes: (s.modes || []).map((m: string) => m === "tube" ? "Tube" : m === "national-rail" ? "National Rail" : m === "dlr" ? "DLR" : m === "overground" ? "Overground" : m === "elizabeth-line" ? "Elizabeth line" : m),
        lines: (s.lines || []).map((l: any) => l.name),
      })).sort((a: any, b: any) => a.distance - b.distance);
      const result = { success: true, source: "TfL API", postcode, searchRadius: radius, stationCount: stations.length, stations };
      const reply = await summaryHelper(result);
      return { handled: true, response: { reply: reply || JSON.stringify(result).slice(0, 2000) } };
    } catch (err: any) {
      return { handled: true, response: { reply: `TfL API error: ${err?.message}` } };
    }
  }

  if (fnName === "query_wip") {
    const { pool } = await import("./db");
    let sql = `SELECT id, name, group_name AS "groupName", deal_type AS "dealType", status, team, pricing, fee, rent_pa AS "rentPa", total_area_sqft AS "totalAreaSqft", comments FROM crm_deals WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;
    if (fnArgs.team) {
      sql += ` AND $${idx}::text = ANY(team)`;
      params.push(fnArgs.team);
      idx++;
    }
    if (fnArgs.status) {
      sql += ` AND group_name ILIKE $${idx}`;
      params.push(`%${fnArgs.status}%`);
      idx++;
    }
    if (fnArgs.dealType) {
      sql += ` AND deal_type ILIKE $${idx}`;
      params.push(`%${fnArgs.dealType}%`);
      idx++;
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await pool.query(sql, params);
    const deals = result.rows;
    const totalPipeline = deals.reduce((sum: number, d: any) => sum + (parseFloat(d.pricing) || 0), 0);
    const totalFees = deals.reduce((sum: number, d: any) => sum + (parseFloat(d.fee) || 0), 0);
    const byStage: Record<string, number> = {};
    for (const d of deals) {
      byStage[d.status || "Unknown"] = (byStage[d.status || "Unknown"] || 0) + 1;
    }
    const summary = { totalDeals: deals.length, totalPipeline, totalFees, byStage };
    const responseData = fnArgs.summaryOnly ? { success: true, summary } : { success: true, summary, deals: deals.slice(0, 50) };
    const reply = await summaryHelper(responseData);
    return { handled: true, response: { reply: reply || `Found ${deals.length} deals. Total pipeline: £${totalPipeline.toLocaleString()}, total fees: £${totalFees.toLocaleString()}.` } };
  }

  if (fnName === "query_xero") {
    const { pool } = await import("./db");
    let sql = `SELECT xi.id, xi.deal_id AS "dealId", xi.xero_invoice_id AS "xeroInvoiceId", xi.invoice_number AS "invoiceNumber", xi.reference, xi.status, xi.total_amount AS "total", xi.currency, xi.due_date AS "dueDate", xi.sent_to_xero AS "sentToXero", cd.name AS "dealName" FROM xero_invoices xi LEFT JOIN crm_deals cd ON xi.deal_id = cd.id WHERE 1=1`;
    const params: any[] = [];
    let idx = 1;
    if (fnArgs.dealId) {
      sql += ` AND xi.deal_id = $${idx}`;
      params.push(fnArgs.dealId);
      idx++;
    }
    if (fnArgs.query) {
      sql += ` AND (xi.reference ILIKE $${idx} OR xi.invoice_number ILIKE $${idx} OR cd.name ILIKE $${idx})`;
      params.push(`%${fnArgs.query}%`);
      idx++;
    }
    sql += ` ORDER BY xi.created_at DESC LIMIT 20`;
    const result = await pool.query(sql, params);
    const reply = await summaryHelper({ success: true, invoices: result.rows, totalFound: result.rows.length });
    return { handled: true, response: { reply: reply || `Found ${result.rows.length} invoices.` } };
  }

  if (fnName === "scan_duplicates") {
    const { pool } = await import("./db");
    const entityType = fnArgs.entityType;
    let sql = "";
    if (entityType === "contacts") {
      sql = `SELECT MIN(name) as name, COUNT(*) as count FROM crm_contacts GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 20`;
    } else if (entityType === "companies") {
      sql = `SELECT MIN(name) as name, COUNT(*) as count FROM crm_companies GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 20`;
    } else if (entityType === "properties") {
      sql = `SELECT MIN(name) as name, COUNT(*) as count FROM crm_properties GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT 20`;
    } else {
      return { handled: true, response: { reply: `Unknown entity type "${entityType}". Choose from: contacts, companies, or properties.` } };
    }
    const result = await pool.query(sql);
    const reply = await summaryHelper({ success: true, entityType, duplicates: result.rows, totalFound: result.rows.length });
    return { handled: true, response: { reply: reply || `Found ${result.rows.length} potential duplicate groups in ${entityType}.` } };
  }

  if (fnName === "delete_record") {
    const { storage } = await import("./storage");
    const deleteMap: Record<string, (id: string) => Promise<void>> = {
      deal: (id) => storage.deleteCrmDeal(id),
      contact: (id) => storage.deleteCrmContact(id),
      company: (id) => storage.deleteCrmCompany(id),
      property: (id) => storage.deleteCrmProperty(id),
    };
    const deleteFn = deleteMap[fnArgs.entityType];
    if (!deleteFn) {
      return { handled: true, response: { reply: `Unknown entity type: ${fnArgs.entityType}` } };
    }
    await deleteFn(fnArgs.id);
    const reply = await summaryHelper({ success: true, action: "deleted", entity: fnArgs.entityType, id: fnArgs.id, name: fnArgs.confirmName });
    return { handled: true, response: { reply: reply || `${fnArgs.entityType} "${fnArgs.confirmName}" has been deleted.`, action: { type: "crm_deleted", entityType: fnArgs.entityType, id: fnArgs.id } } };
  }

  if (fnName === "navigate_to") {
    const pageRoutes: Record<string, string> = {
      dashboard: "/", deals: "/deals", comps: "/comps", "investment-comps": "/investment-comps",
      contacts: "/contacts", companies: "/companies", properties: "/properties",
      requirements: "/requirements", instructions: "/instructions", news: "/news",
      mail: "/mail", chatbgp: "/chatbgp", sharepoint: "/sharepoint", models: "/models",
      templates: "/templates", settings: "/settings", "land-registry": "/land-registry",
      "voa-rates": "/business-rates", "business-rates": "/business-rates",
      "intelligence-map": "/edozo", "leasing-units": "/available", "leasing-schedule": "/leasing-schedule",
      "investment-tracker": "/investment-tracker", "wip-report": "/deals/report",
      "property-map": "/property-map", map: "/property-map",
    };
    let path = pageRoutes[fnArgs.page] || "/";
    if ((fnArgs.page === "property-map" || fnArgs.page === "map") && fnArgs.lat && fnArgs.lng) {
      path += `?lat=${fnArgs.lat}&lng=${fnArgs.lng}` + (fnArgs.zoom ? `&zoom=${fnArgs.zoom}` : "&zoom=17");
    }
    const reply = fnArgs.message || `Navigating you to ${fnArgs.page}.`;
    return { handled: true, response: { reply, action: { type: "navigate", path } } };
  }

  if (fnName === "generate_word") {
    try {
      const docx = await import("docx");
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");

      const sections = (fnArgs.sections as any[]) || [];
      const children: any[] = [];

      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: "BRUCE GILLINGHAM POLLARD", bold: true, size: 20, font: "Calibri", color: "232323" })],
        spacing: { after: 100 },
      }));
      children.push(new docx.Paragraph({
        border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "232323" } },
        spacing: { after: 300 },
      }));
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: fnArgs.title as string, bold: true, size: 32, font: "Calibri", color: "232323" })],
        heading: docx.HeadingLevel.TITLE,
        spacing: { after: 200 },
      }));

      for (const section of sections) {
        if (section.heading) {
          const level = section.level === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_1;
          children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: section.heading, bold: true, size: level === docx.HeadingLevel.HEADING_1 ? 28 : 24, font: "Calibri" })],
            heading: level,
            spacing: { before: 240, after: 120 },
          }));
        }
        if (section.paragraphs) {
          for (const para of section.paragraphs) {
            children.push(new docx.Paragraph({
              children: [new docx.TextRun({ text: para, size: 22, font: "Calibri" })],
              spacing: { after: 120 },
            }));
          }
        }
        if (section.bullets) {
          for (const bullet of section.bullets) {
            children.push(new docx.Paragraph({
              children: [new docx.TextRun({ text: bullet, size: 22, font: "Calibri" })],
              bullet: { level: 0 },
              spacing: { after: 60 },
            }));
          }
        }
        if (section.table && section.table.headers && section.table.rows) {
          const headerRow = new docx.TableRow({
            children: section.table.headers.map((h: string) => new docx.TableCell({
              children: [new docx.Paragraph({ children: [new docx.TextRun({ text: h, bold: true, size: 20, font: "Calibri" })] })],
              shading: { fill: "232323", type: docx.ShadingType.SOLID, color: "FFFFFF" },
              verticalAlign: docx.VerticalAlign.CENTER,
            })),
            tableHeader: true,
          });
          const dataRows = section.table.rows.map((row: string[], ri: number) => new docx.TableRow({
            children: row.map((cell: string) => new docx.TableCell({
              children: [new docx.Paragraph({ children: [new docx.TextRun({ text: cell, size: 20, font: "Calibri" })] })],
              shading: ri % 2 === 0 ? { fill: "F5F5F5", type: docx.ShadingType.SOLID } : undefined,
              verticalAlign: docx.VerticalAlign.CENTER,
            })),
          }));
          children.push(new docx.Table({
            rows: [headerRow, ...dataRows],
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
          }));
          children.push(new docx.Paragraph({ spacing: { after: 120 } }));
        }
      }

      const doc = new docx.Document({
        sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
        styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
      });

      const buffer = await docx.Packer.toBuffer(doc);
      const safeName = (fnArgs.title as string).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.docx`;

      await saveFile(`chat-media/${storageFilename}`, Buffer.from(buffer), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${safeName}.docx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      const downloadLink = `[📄 Download ${safeName}.docx](${downloadUrl})`;
      let reply = await summaryHelper({ success: true, downloadUrl, filename: `${safeName}.docx`, action: "word_generated" });
      if (!reply || !reply.includes("/api/chat-media/")) reply = `Your Word document has been generated.\n\n${downloadLink}`;
      else if (!reply.includes(downloadUrl)) reply += `\n\n${downloadLink}`;
      return { handled: true, response: { reply, action: { type: "download", url: downloadUrl, filename: `${safeName}.docx` } } };
    } catch (err: any) {
      console.error("[chatbgp] Word generation error:", err?.message);
      return { handled: true, response: { reply: `Failed to generate Word document: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "generate_pptx") {
    try {
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");
      const { buffer: pptxBuffer, safeName, slideCount } = await buildDeckPptxFromArgs(fnArgs);
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.pptx`;
      await saveFile(`chat-media/${storageFilename}`, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      const downloadLink = `[📊 Download ${safeName}.pptx](${downloadUrl})`;
      let reply = await summaryHelper({ success: true, downloadUrl, filename: `${safeName}.pptx`, slides: slideCount, action: "pptx_generated" });
      if (!reply || !reply.includes("/api/chat-media/")) reply = `Your PowerPoint has been generated with ${slideCount} slides.\n\n${downloadLink}`;
      else if (!reply.includes(downloadUrl)) reply += `\n\n${downloadLink}`;
      return { handled: true, response: { reply, action: { type: "download", url: downloadUrl, filename: `${safeName}.pptx` } } };
    } catch (err: any) {
      console.error("[chatbgp] PowerPoint generation error:", err?.message);
      return { handled: true, response: { reply: `Failed to generate PowerPoint: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "generate_org_chart") {
    try {
      if (!fnArgs.tree || typeof fnArgs.tree !== "object" || !fnArgs.tree.name) {
        return { handled: true, response: { reply: "I need the hierarchy as a tree to draw an org chart — tell me who reports to whom." } };
      }
      const { buildOrgChartPptx } = await import("./org-chart-pptx");
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");
      const pptxBuffer = await buildOrgChartPptx({ title: String(fnArgs.title || "Organisation Chart"), tree: fnArgs.tree, notes: Array.isArray(fnArgs.notes) ? fnArgs.notes : undefined });
      const safeName = String(fnArgs.title || "Organisation_Chart").replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}.pptx`;
      await saveFile(`chat-media/${storageFilename}`, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      const downloadLink = `[\u{1F4CA} Download ${safeName}.pptx](${downloadUrl})`;
      let reply = await summaryHelper({ success: true, downloadUrl, filename: `${safeName}.pptx`, action: "org_chart_generated" });
      if (!reply || !reply.includes("/api/chat-media/")) reply = `Your organisation chart is ready as an editable PowerPoint.\n\n${downloadLink}`;
      else if (!reply.includes(downloadUrl)) reply += `\n\n${downloadLink}`;
      return { handled: true, response: { reply, action: { type: "download", url: downloadUrl, filename: `${safeName}.pptx` } } };
    } catch (err: any) {
      console.error("[chatbgp] org chart generation error:", err?.message);
      return { handled: true, response: { reply: `Failed to generate org chart: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "send_email") {
    try {
      const { sendSharedMailboxEmail } = await import("./shared-mailbox");
      const attachments = await resolveChatMediaAttachments(fnArgs.chatMediaAttachments);
      await sendSharedMailboxEmail({
        to: fnArgs.to,
        subject: fnArgs.subject,
        body: fnArgs.body,
        cc: fnArgs.cc,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      const reply = await summaryHelper({
        success: true,
        action: "email_sent",
        to: fnArgs.to,
        subject: fnArgs.subject,
        attachmentCount: attachments.length,
      });
      return { handled: true, response: { reply: reply || `Email sent to ${fnArgs.to}${attachments.length ? ` with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}.`, action: { type: "email_sent", to: fnArgs.to } } };
    } catch (emailErr: any) {
      return { handled: true, response: { reply: `Failed to send email: ${emailErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "reply_email") {
    try {
      const { replyToSharedMailboxMessage } = await import("./shared-mailbox");
      const ccList = fnArgs.cc ? [fnArgs.cc] : undefined;
      const attachments = await resolveChatMediaAttachments(fnArgs.chatMediaAttachments);
      await replyToSharedMailboxMessage(
        fnArgs.messageId,
        fnArgs.body,
        ccList,
        attachments.length > 0 ? attachments : undefined,
      );
      const reply = await summaryHelper({
        success: true,
        action: "email_replied",
        messageId: fnArgs.messageId,
        attachmentCount: attachments.length,
      });
      return { handled: true, response: { reply: reply || "Reply sent successfully, threaded with the original email.", action: { type: "email_sent" } } };
    } catch (replyErr: any) {
      return { handled: true, response: { reply: `Failed to reply to email: ${replyErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "search_emails") {
    try {
      const searchQuery = fnArgs.query;
      const top = Math.min(fnArgs.top || 50, 500);
      const mailboxArg = typeof fnArgs.mailbox === "string" ? fnArgs.mailbox.trim().toLowerCase() : "";
      const results = await runSearchEmailsTool({ query: searchQuery, top, mailbox: mailboxArg, req });
      if ("error" in results) return { handled: true, response: { reply: results.error } };
      const reply = await summaryHelper({ results: results.messages, count: results.messages.length, query: searchQuery, scope: results.scope });
      return { handled: true, response: { reply: reply || `Found ${results.messages.length} emails matching "${searchQuery}" (${results.scope}).` } };
    } catch (searchErr: any) {
      return { handled: true, response: { reply: `Email search error: ${searchErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "get_email_attachments") {
    try {
      const msgId = encodeURIComponent(fnArgs.messageId);
      const mailboxEmail: string | undefined = fnArgs.mailboxEmail;
      let attachments: any[];
      if (mailboxEmail) {
        const { graphRequest } = await import("./shared-mailbox");
        const data = await graphRequest(
          `/users/${encodeURIComponent(mailboxEmail)}/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline`,
          { headers: { "X-AnchorMailbox": mailboxEmail } as any }
        );
        attachments = (data?.value || [])
          .filter((a: any) => !a.isInline && a["@odata.type"] !== "#microsoft.graph.itemAttachment")
          .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
      } else {
        const token = await getValidMsToken(req);
        if (!token) return { handled: true, response: { reply: "Not connected to Microsoft 365. Please sign in first." } };
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const graphRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline`,
          { headers }
        );
        if (!graphRes.ok) {
          const errText = await graphRes.text();
          const hint = errText.includes("ErrorInvalidMailboxItemId") ? " — this message is in another user's mailbox. Pass mailboxEmail." : "";
          return { handled: true, response: { reply: `Failed to fetch attachments: ${graphRes.status}${hint}` } };
        }
        const data = await graphRes.json();
        attachments = (data.value || [])
          .filter((a: any) => !a.isInline && a["@odata.type"] !== "#microsoft.graph.itemAttachment")
          .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
      }
      const reply = await summaryHelper({ attachments, count: attachments.length, mailboxEmail });
      return { handled: true, response: { reply: reply || `Found ${attachments.length} attachment(s).` } };
    } catch (err: any) {
      return { handled: true, response: { reply: `Attachment list error: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "download_email_attachment") {
    try {
      const action = fnArgs.action || "read";
      if (action === "save_to_sharepoint" && !fnArgs.folderPath) {
        return { handled: true, response: { reply: "I need a SharePoint folder path to save the attachment. Could you tell me where you'd like it saved?" } };
      }
      const msgId = encodeURIComponent(fnArgs.messageId);
      const attId = encodeURIComponent(fnArgs.attachmentId);
      const mailboxEmail: string | undefined = fnArgs.mailboxEmail;
      let attachment: any;
      if (mailboxEmail) {
        const { graphRequest } = await import("./shared-mailbox");
        attachment = await graphRequest(
          `/users/${encodeURIComponent(mailboxEmail)}/messages/${msgId}/attachments/${attId}`,
          { headers: { "X-AnchorMailbox": mailboxEmail } as any }
        );
      } else {
        const token = await getValidMsToken(req);
        if (!token) return { handled: true, response: { reply: "Not connected to Microsoft 365. Please sign in first." } };
        const headers = { Authorization: `Bearer ${token}` };
        const graphRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments/${attId}`,
          { headers }
        );
        if (!graphRes.ok) {
          const errText = await graphRes.text();
          const hint = errText.includes("ErrorInvalidMailboxItemId") ? " — this message is in another user's mailbox. Pass mailboxEmail." : "";
          return { handled: true, response: { reply: `Failed to download attachment: ${graphRes.status}${hint}` } };
        }
        attachment = await graphRes.json();
      }
      if (!attachment.contentBytes) {
        return { handled: true, response: { reply: "This attachment type is not downloadable — it may be a linked item rather than a file." } };
      }
      const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
      const buffer = Buffer.from(attachment.contentBytes, "base64");
      if (buffer.length > MAX_ATTACHMENT_SIZE) {
        return { handled: true, response: { reply: `This attachment is too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB) to process. Maximum supported size is 25MB.` } };
      }
      const name = attachment.name || "download";
      const contentType = (attachment.contentType || "").toLowerCase();

      if (action === "save_to_sharepoint" && fnArgs.folderPath) {
        const { uploadFileToSharePoint } = await import("./microsoft");
        const uploadResult = await uploadFileToSharePoint(buffer, name, attachment.contentType || "application/octet-stream", fnArgs.folderPath);
        const reply = await summaryHelper({ success: true, action: "saved_to_sharepoint", fileName: name, path: fnArgs.folderPath });
        return { handled: true, response: { reply: reply || `Saved ${name} to SharePoint at ${fnArgs.folderPath}.` } };
      }

      const isText = contentType.includes("text") || contentType.includes("csv") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("html");
      const isWord = contentType.includes("wordprocessingml") || contentType.includes("msword") || name.endsWith(".docx") || name.endsWith(".doc");
      const isPdf = contentType.includes("pdf");
      const isExcel = contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");

      let extractedText = "";

      if (isText || name.endsWith(".csv") || name.endsWith(".txt")) {
        extractedText = buffer.toString("utf-8").slice(0, 50000);
      } else if (isPdf) {
        try {
          const { PDFParse: PdfCls } = await import("pdf-parse");
          const parser = new (PdfCls as any)(new Uint8Array(buffer));
          const pdfData = await parser.getText();
          const pdfText = typeof pdfData === "string" ? pdfData : (pdfData as any).text || String(pdfData);
          extractedText = pdfText.slice(0, 50000);
          try { parser.destroy(); } catch {}
        } catch {
          extractedText = "[PDF text extraction failed — binary content]";
        }
      } else if (isExcel) {
        try {
          const ExcelJS = (await import("exceljs")).default;
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buffer);
          const lines: string[] = [];
          wb.eachSheet((sheet) => {
            lines.push(`\n--- Sheet: ${sheet.name} ---`);
            sheet.eachRow((row, rowNum) => {
              if (rowNum <= 200) {
                const vals = (row.values as any[]).slice(1).map((v: any) => (v?.result !== undefined ? v.result : v ?? ""));
                lines.push(vals.join("\t"));
              }
            });
          });
          extractedText = lines.join("\n").slice(0, 50000);
        } catch {
          extractedText = "[Excel text extraction failed]";
        }
      } else if (isWord) {
        try {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          extractedText = (result.value || "").slice(0, 50000);
        } catch {
          extractedText = "[Word document text extraction failed]";
        }
      }

      if (extractedText) {
        const reply = await summaryHelper({ fileName: name, content: extractedText.slice(0, 10000) });
        return { handled: true, response: { reply: reply || `Here's the content of ${name}:\n\n${extractedText.slice(0, 5000)}` } };
      } else {
        const { saveFile } = await import("./file-storage");
        const crypto = (await import("crypto")).default;
        const fileId = crypto.randomBytes(8).toString("hex");
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
        const storedName = `chat-media/${Date.now()}-${fileId}${ext}`;
        await saveFile(storedName, buffer, attachment.contentType || "application/octet-stream", name);
        const downloadUrl = `/api/${storedName}`;
        return { handled: true, response: { reply: `Downloaded **${name}** — this is a binary file I can't read as text. [📥 Download ${name}](${downloadUrl})\n\nI can also save it to SharePoint if you'd like.` } };
      }
    } catch (err: any) {
      return { handled: true, response: { reply: `Attachment download error: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "save_learning") {
    const { chatbgpLearnings } = await import("@shared/schema");
    const userId = req.session?.userId || "unknown";
    let userName = "Unknown User";
    try {
      const { storage } = await import("./storage");
      const user = await storage.getUser(userId);
      if (user?.name) userName = user.name;
    } catch {}
    
    const learningText = typeof fnArgs.learning === "string" ? fnArgs.learning.trim() : "";
    if (!learningText) {
      return { handled: true, response: { reply: "No learning text provided.", action: { type: "error" } } };
    }
    
    let isDuplicate = false;
    try {
      const existingLearnings = await db.select({ learning: chatbgpLearnings.learning }).from(chatbgpLearnings).where(eq(chatbgpLearnings.active, true));
      const normalised = learningText.toLowerCase();
      isDuplicate = existingLearnings.some((l: any) => {
        const existing = (typeof l.learning === "string" ? l.learning : "").toLowerCase().trim();
        if (!existing) return false;
        if (existing === normalised) return true;
        if (existing.length < 20 || normalised.length < 20) return false;
        const words1 = normalised.split(/\s+/);
        const words2Set = new Set(existing.split(/\s+/));
        const intersection = words1.filter((w: string) => words2Set.has(w));
        return intersection.length / Math.max(words1.length, words2Set.size) > 0.7;
      });
    } catch (e) {
      console.error("Learning dedup check failed, saving anyway:", e);
    }
    
    if (isDuplicate) {
      const reply = await summaryHelper({ success: true, alreadyKnown: true, message: "I already know this." });
      return { handled: true, response: { reply: reply || "I already know that — no need to save again.", action: { type: "learning_already_known" } } };
    }
    
    const subjectPropertyId = typeof fnArgs.subjectPropertyId === "string" ? fnArgs.subjectPropertyId.trim() || null : null;
    const subjectCompanyNumber = typeof fnArgs.subjectCompanyNumber === "string" ? fnArgs.subjectCompanyNumber.trim().toUpperCase() || null : null;
    await db.insert(chatbgpLearnings).values({
      category: fnArgs.category || "general",
      learning: learningText,
      sourceUser: userId,
      sourceUserName: userName,
      confidence: "confirmed",
      active: true,
      subjectPropertyId,
      subjectCompanyNumber,
    });
    const reply = await summaryHelper({ success: true, saved: learningText });
    return { handled: true, response: { reply: reply || "Got it — I've noted that down.", action: { type: "learning_saved" } } };
  }

  if (fnName === "log_app_feedback") {
    const { appFeedbackLog } = await import("@shared/schema");
    const userId = req.session?.userId || "unknown";
    let userName = "Unknown User";
    try {
      const { storage } = await import("./storage");
      const user = await storage.getUser(userId);
      if (user?.name) userName = user.name;
    } catch {}
    await db.insert(appFeedbackLog).values({
      category: fnArgs.category || "suggestion",
      summary: fnArgs.summary,
      detail: fnArgs.detail || null,
      userId,
      userName,
      threadId: fnArgs.threadId || null,
      pageContext: fnArgs.pageContext || null,
      status: "new",
    });
    const reply = await summaryHelper({ success: true, feedbackLogged: fnArgs.summary });
    return { handled: true, response: { reply: reply || "Thanks — I've noted that feedback.", action: { type: "feedback_logged" } } };
  }

  if (fnName === "request_app_change") {
    const { appChangeRequests } = await import("@shared/schema");
    const userId = req.session?.userId || "unknown";
    let userName = "Unknown User";
    try {
      const { storage } = await import("./storage");
      const user = await storage.getUser(userId);
      if (user?.name) userName = user.name;
    } catch {}
    const [created] = await db.insert(appChangeRequests).values({
      description: fnArgs.description,
      requestedBy: userName,
      requestedByUserId: userId,
      category: fnArgs.category || "feature",
      priority: fnArgs.priority || "normal",
      status: "pending",
    }).returning();
    const reply = await summaryHelper({
      success: true,
      action: "change_request_created",
      id: created.id,
      description: fnArgs.description,
      message: "This request has been logged and will be reviewed by the development team, then approved by admin before implementation.",
    });
    return { handled: true, response: { reply: reply || `Change request logged (#${created.id.slice(0, 8)}). It will be reviewed by the development team and then approved by admin before implementation.`, action: { type: "change_request", id: created.id } } };
  }

  return { handled: false };
}

export function setupChatBGPRoutes(app: Express) {
  if (!fs.existsSync(CHAT_UPLOADS_DIR)) {
    fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });
  }

  const chatUpload = multer({
    dest: CHAT_UPLOADS_DIR,
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  app.get("/api/chatbgp/status", requireAuth, (_req: Request, res: Response) => {
    const hasKey = !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
    res.json({ connected: hasKey });
  });

  app.post("/api/chatbgp/chat-with-files", requireAuth, chatUpload.array("files", 30), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    let messages: Array<{ role: "user" | "assistant"; content: any }> = [];
    // SSE plumbing, hoisted to handler scope so the catch block can finish the
    // stream. Before fcStarted, fcSend degrades to a plain JSON response.
    let fcStarted = false;
    let fcClosed = false;
    let fcHeartbeat: ReturnType<typeof setInterval> | null = null;
    const fcProgress = (s: string) => { try { if (fcStarted && !fcClosed) res.write(`data: ${JSON.stringify({ progress: s })}\n\n`); } catch {} };
    const fcDelta = (t: string) => { try { if (fcStarted && !fcClosed) res.write(`data: ${JSON.stringify({ delta: t })}\n\n`); } catch {} };
    const fcSend = (obj: any) => {
      if (fcHeartbeat) clearInterval(fcHeartbeat);
      try {
        if (fcClosed) return;
        if (fcStarted) { res.write(`data: ${JSON.stringify(obj)}\n\n`); res.end(); }
        else if (obj.error !== undefined) res.status(500).json({ message: obj.error });
        else res.json(obj);
      } catch {}
    };
    try {
      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ message: "AI API key not configured" });
      }

      try {
        messages = JSON.parse(req.body.messages || "[]");
      } catch {
        return res.status(400).json({ message: "Invalid messages format" });
      }

      if (!messages.length) {
        return res.status(400).json({ message: "No messages provided" });
      }

      // /opus or /sonnet at the start of the last user message — applies
      // for this single request (no thread persistence here).
      const fileThreadId = typeof req.body.threadId === "string" ? req.body.threadId : null;
      let fileSlashOverride: "fable" | "opus" | "sonnet" | null = null;
      {
        const lastIdx = messages.length - 1;
        const lastText = typeof messages[lastIdx]?.content === "string" ? messages[lastIdx].content : "";
        const slash = parseSlashCommand(lastText);
        if (slash.command) {
          await setThreadModel(fileThreadId, slash.command);
          if (slash.wasJustCommand) {
            return res.json({ reply: ackMessage(slash.command) });
          }
          fileSlashOverride = slash.command;
          messages[lastIdx] = { ...messages[lastIdx], content: slash.strippedContent } as any;
        }
      }

      // SSE from here on. The old single-JSON response meant minutes of blind
      // waiting (and gateway-timeout exposure) on long agentic runs — now the
      // client gets live progress + token deltas like the /chat handler.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      fcStarted = true;
      fcHeartbeat = setInterval(() => { try { res.write(": heartbeat\n\n"); } catch {} }, 5000);
      req.on("close", () => { fcClosed = true; if (fcHeartbeat) clearInterval(fcHeartbeat); });
      if (files && files.length > 0) fcProgress(`Reading ${files.length} file${files.length === 1 ? "" : "s"}...`);

      const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic"];
      const AUDIO_VIDEO_EXTENSIONS = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma", ".mov", ".avi", ".mkv", ".wmv", ".flv"];
      const documentTexts: string[] = [];
      const imageContentParts: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];

      if (files && files.length > 0) {
        for (const file of files) {
          const ext = "." + (file.originalname.split(".").pop()?.toLowerCase() || "");
          const isImage = IMAGE_EXTENSIONS.includes(ext) || file.mimetype?.startsWith("image/");
          const isAudioVideo = AUDIO_VIDEO_EXTENSIONS.includes(ext) || file.mimetype?.startsWith("audio/") || file.mimetype?.startsWith("video/");

          const fileData = fs.readFileSync(file.path);
          const chatMediaName = `${Date.now()}-${path.basename(file.path)}${ext}`;
          const storageKey = `chat-media/${chatMediaName}`;
          try {
            await saveFile(storageKey, fileData, file.mimetype || "application/octet-stream", file.originalname);
          } catch (err: any) {
            console.error(`Chat file DB save error (${file.originalname}):`, err?.message);
          }

          if (isImage) {
            try {
              // Normalise HEIC / oversize iPhone photos to ≤1600px JPEG
              // before sending to Claude — Anthropic rejects HEIC
              // (400) and chains of unresized photos blow the 32MB
              // request cap (413). Defaults to original on failure.
              const normalised = await normaliseImageForClaude(fileData, file.mimetype, file.originalname);
              const base64 = normalised.buffer.toString("base64");
              imageContentParts.push({
                type: "image_url",
                image_url: { url: `data:${normalised.mimeType};base64,${base64}`, detail: "auto" },
              });
              // Tell the agent WHERE the stored binary lives. Documents get
              // this hint below; images didn't — so the model could SEE a
              // photo yet had no filename to hand to the image/SharePoint
              // tools and reported it "missing from the chat-media store"
              // (Woody's signature photo, 2026-08-21).
              documentTexts.push(
                `=== IMAGE ATTACHED: ${file.originalname} ===\n` +
                `chat-media filename: ${chatMediaName}\n` +
                `The image itself is in this message for you to look at. The stored file is at /api/chat-media/${chatMediaName} — use that filename with edit_image / save_to_image_studio / upload_to_sharepoint or any tool that needs the underlying file.`
              );
            } catch (err: any) {
              console.error(`Chat image read error (${file.originalname}):`, err?.message);
            }
          } else if (isAudioVideo) {
            documentTexts.push(`=== AUDIO/VIDEO FILE: ${file.originalname} ===\nThis is an audio/video file uploaded by the user. File URL: /api/chat-media/${chatMediaName}\nUse the transcribe_audio tool with fileUrl="/api/chat-media/${chatMediaName}" to transcribe this recording. Then use the transcript to help the user with whatever they need — update trackers, create notes, log actions, etc.`);
          } else {
            // Brochure-shaped PDF? Route it through the rich brochure pipeline
            // (Claude vision → property match-or-create, tenancy schedule,
            // ownership, agent contacts, filed images, geocode) — the same one
            // email + WhatsApp use — instead of the lite text-only path.
            // tryIngestBrochure does the page-count heuristic itself and
            // returns handled=false for non-brochure PDFs, so we just gate on
            // the PDF mimetype here and fall through on handled=false / failure.
            const isPdf = ext === ".pdf" || file.mimetype === "application/pdf";
            if (isPdf) {
              try {
                const { tryIngestBrochure } = await import("./whatsapp-brochure-pipeline");
                const pipelineMessages: string[] = [];
                const broResult = await tryIngestBrochure({
                  bytes: fileData,
                  mimeType: file.mimetype || "application/pdf",
                  filename: file.originalname,
                  source: "other",
                  userId: req.session.userId || (req as any).tokenUserId || null,
                  sendReply: async (text: string) => { pipelineMessages.push(text); },
                });
                if (broResult.handled) {
                  // Surface the pipeline's own progress/summary replies so the
                  // agent and user can see what was captured (property name,
                  // tenancy rows, contacts, images). Skip the lite path.
                  const detail = pipelineMessages.length > 0 ? `\n${pipelineMessages.join("\n")}` : "";
                  documentTexts.push(
                    `=== BROCHURE: ${file.originalname} ===\n` +
                    `This PDF was processed through the rich brochure pipeline (not raw text extraction). ` +
                    `It was matched/created in the property CRM and its tenancy schedule, ownership, agent contacts, and images were captured where present.${detail}`
                  );
                  continue;
                }
              } catch (err: any) {
                console.error(`[ChatBGP file-chat] Brochure pipeline failed for ${file.originalname}:`, err?.message);
              }
            }
            try {
              const text = await extractTextFromFile(file.path, file.originalname);
              // Include the chat-media filename so the agent can pass it to
              // upload_to_sharepoint when the user asks to save the dropped
              // file. Without this hint the agent only sees the extracted
              // text and has no way to reference the underlying binary —
              // it would say things like "the binary isn't reachable via
              // the chat-media filename pattern" because it never learned
              // the filename in the first place.
              documentTexts.push(
                `=== FILE: ${file.originalname} ===\n` +
                `chat-media filename: ${chatMediaName}\n` +
                `(If the user asks to save this file to SharePoint, call upload_to_sharepoint with chatMediaFilename="${chatMediaName}" and the destinationFolderPath they specify.)\n\n` +
                `--- Extracted text ---\n${text.slice(0, 15000)}`
              );
            } catch (err: any) {
              console.error(`Chat file extract error (${file.originalname}):`, err?.message);
            }
          }
        }
      }

      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        if (documentTexts.length > 0) {
          const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
          lastMsg.content = `${textContent}\n\n--- ATTACHED DOCUMENTS ---\n${documentTexts.join("\n\n")}`;
        }
        if (imageContentParts.length > 0) {
          const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
          lastMsg.content = [
            { type: "text" as const, text: textContent || "What do you see in this image?" },
            ...imageContentParts,
          ];
        }
      }

      let tools: any[] = [];
      let fileIsClient = false;
      let fileScopeCompanyId: string | null = null;
      try {
        ({ tools } = await getAvailableTools());
        fileIsClient = (await clientChatGuard(req)).isClient;
        if (fileIsClient) {
          // Client login: scoped tool allowlist when we can resolve their
          // company, no tools at all when we can't (fail closed).
          fileScopeCompanyId = await resolveCompanyScope(req).catch(() => null);
          tools = fileScopeCompanyId ? filterToolsForClientScope(tools) : [];
        }
      } catch (e: any) {
        console.error("[ChatBGP file-chat] getAvailableTools failed:", e?.message);
      }

      const fileUserId = req.session.userId || (req as any).tokenUserId || "unknown";
      // Lean mode: only the cheap personalisation line is still injected; the
      // knowledge bank / memory / email+calendar / CRM dumps are fetched on
      // demand via tools, so we skip building them here.
      const personalisation = await withTimeout(getUserPersonalisationContext(fileUserId), 2000, "");
      let systemPrompt: string;
      if (fileIsClient) {
        systemPrompt = CLIENT_SYSTEM_PROMPT
          + (fileScopeCompanyId ? await withTimeout(getClientCrmContext(fileScopeCompanyId), 5000, "") : "");
      } else {
        try {
          systemPrompt = await buildSystemPrompt();
        } catch {
          systemPrompt = SYSTEM_PROMPT_FALLBACK;
        }
      }
      // Lean context (see main chat handler) — keep only who you're talking to;
      // fetch knowledge / CRM / email on demand via tools rather than force-feeding.
      const systemContent = systemPrompt + personalisation;

      const fileResolved = await resolveChatModel({ threadId: fileThreadId, override: fileSlashOverride });
      const completionOptions: any = {
        model: fileResolved.model,
        messages: [
          { role: "system", content: systemContent },
          ...messages,
        ],
        max_completion_tokens: 8192,
      };

      if (tools.length > 0) {
        completionOptions.tools = tools;
        completionOptions.tool_choice = "auto";
      }

      console.log(`[ChatBGP] Sending to Claude with ${tools.length} tools`);

      let msTokenFile: string | null = null;
      try { msTokenFile = await getValidMsToken(req); } catch {}

      let convMessages: any[] = [...completionOptions.messages];
      let lastActionFile: any = null;
      let loopCountFile = 0;
      const maxLoopsFile = 15;
      const fileDeadline = Date.now() + 240000;

      while (loopCountFile < maxLoopsFile) {
        if (Date.now() > fileDeadline) {
          console.log(`[ChatBGP] File-chat deadline reached after ${loopCountFile} loops`);
          break;
        }
        loopCountFile++;
        const isLastLoop = loopCountFile >= maxLoopsFile;

        const loopOpts: any = {
          model: fileResolved.model,
          messages: convMessages,
          max_completion_tokens: 8192,
          thinking: true,
          effort: "medium", // interactive chat: trims Fable's default deep-think per turn (Woody, 2026-08-28: speed)
        };
        if (!isLastLoop) {
          loopOpts.tools = tools;
          loopOpts.tool_choice = "auto";
        }

        let completion: any;
        // From loop 2 on, stream — the reply after a tool round is usually
        // final, and deltas make it appear live (same pattern as /chat).
        const useStreamingFile = loopCountFile > 1 || isLastLoop;
        try {
          if (useStreamingFile) {
            fcProgress("Composing response...");
            completion = await callClaudeStreaming(loopOpts, (token) => fcDelta(token));
          } else {
            completion = await callClaude(loopOpts);
          }
        } catch (thinkErr: any) {
          // If thinking mode is rejected (e.g. proxy doesn't support it), retry plain
          const isModelErr = thinkErr?.status === 400 || thinkErr?.status === 422;
          if (isModelErr && loopCountFile === 1) {
            console.warn("[ChatBGP file-chat] thinking mode failed, retrying plain:", thinkErr?.message);
            const plainOpts = { ...loopOpts, thinking: false };
            completion = await callClaude(plainOpts);
          } else {
            throw thinkErr;
          }
        }
        const message = completion.choices[0]?.message;
        if (!message) break;

        console.log(`[ChatBGP] File-chat loop ${loopCountFile}: tool_calls=${message.tool_calls?.length || 0}, has_content=${!!message.content}`);

        if (message.tool_calls && message.tool_calls.length > 0) {
          convMessages.push(message);
          const fcToolNames = (message.tool_calls as unknown as ToolCall[]).map(tc => tc.function.name);
          fcProgress(fcToolNames.length === 1 ? getToolProgressLabel(fcToolNames[0]) : `Running ${fcToolNames.length} operations...`);

          for (const tc of message.tool_calls as unknown as ToolCall[]) {
            if (Date.now() > fileDeadline) {
              convMessages.push({ role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Ran out of time" }) });
              continue;
            }
            const tcName = tc.function.name;
            let tcArgs: any;
            try { tcArgs = JSON.parse(tc.function.arguments); } catch { tcArgs = {}; }
            console.log(`[ChatBGP] File-chat loop ${loopCountFile}: tool=${tcName}${tcArgs?.command ? ' cmd=' + tcArgs.command.substring(0, 80) : ''}`);

            try {
              const toolResult = await executeAnyTool(tcName, tcArgs, req, msTokenFile);
              if (toolResult.action) lastActionFile = toolResult.action;
              const resultStr = typeof toolResult.data === "string" ? toolResult.data : JSON.stringify(toolResult.data);
              convMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: resultStr.length > 80000 ? resultStr.slice(0, 80000) + "\n...[truncated — full result was " + resultStr.length + " chars]" : resultStr,
              });
            } catch (toolErr: any) {
              console.error(`[ChatBGP] Tool ${tcName} error:`, toolErr?.message);
              convMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }),
              });
            }
          }
        } else {
          if (message.content) {
            console.log(`[ChatBGP] File-chat loop ${loopCountFile}: final reply received`);
            return fcSend({ reply: message.content, ...(lastActionFile ? { action: lastActionFile } : {}) });
          }
          convMessages.push(message);
          break;
        }
      }

      const lastAMsg = convMessages.filter((m: any) => m.role === "assistant" && m.content).pop();
      fcSend({ reply: lastAMsg?.content || "I've processed your request. Please ask a follow-up for more details.", ...(lastActionFile ? { action: lastActionFile } : {}) });
    } catch (err: any) {
      console.error("ChatBGP file chat error:", err?.status, err?.message || err, err?.error || "");
      const errMsg = String(err?.message || err || "");
      if (errMsg.includes("Could not process image")) {
        try {
          const textOnlyMessages = messages.map((m: any) => {
            if (Array.isArray(m.content)) {
              const textParts = m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).filter(Boolean);
              return { ...m, content: textParts.length > 0 ? textParts.join("\n") : "(The user sent an image that could not be processed)" };
            }
            return m;
          });
          const retryOpts: any = {
            model: CHATBGP_HELPER_MODEL,
            messages: [{ role: "system", content: "You are ChatBGP. The user tried to send an image but it could not be processed. Acknowledge this and help with their text message." }, ...textOnlyMessages],
            max_completion_tokens: 1024,
          };
          const retry = await callClaude(retryOpts);
          const retryContent = retry.choices[0]?.message?.content || "I wasn't able to process that image. Could you try sending it again, or describe what you'd like help with?";
          return fcSend({ reply: retryContent });
        } catch {
          return fcSend({ reply: "I wasn't able to process that image. Could you try sending it again, or let me know what you need help with?" });
        }
      }
      // Surface the underlying error so callers (internal admin users)
      // can diagnose without trawling Railway logs. Caps the body to
      // avoid leaking very large stack traces.
      const surfaceMsg = String(err?.message || err || "Unknown error").slice(0, 500);
      const fileSummary = files?.map(f => `${f.originalname} (${f.mimetype || "?"}, ${f.size} bytes)`).join(", ") || null;
      fcSend({
        error: `Failed to process chat with files: ${surfaceMsg}`,
        status: err?.status ?? null,
        files: fileSummary,
      });
    } finally {
      if (files) {
        for (const file of files) {
          try { fs.unlinkSync(file.path); } catch {}
        }
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UNIFIED TOOL EXECUTOR — handles ALL tool types in one place
  // Fixes: fragmented routing, SharePoint-only loops, missing tools in chains
  // ─────────────────────────────────────────────────────────────────────────
  async function executeAnyTool(
    tcName: string,
    tcArgs: any,
    req: Request,
    msToken: string | null
  ): Promise<{ data: any; action?: any }> {
    // Hard gate: external client logins (e.g. Landsec) may only run the
    // client-safe allowlist, regardless of what the model asked for.
    // Keyed on the ACTUAL account role — staff previewing a client team
    // ("Viewing as Landsec") keep their full toolset (2026-08-04).
    // Internal-token calls (server-originated curations) bypass — they
    // run staff-grade regardless of the forwarded session.
    try {
      const { isClientRequestUser } = await import("./company-scope");
      const { isInternalStaffRequest } = await import("./chatbgp-internal");
      if (!isInternalStaffRequest(req) && await isClientRequestUser(req) && !CLIENT_SAFE_TOOLS.has(tcName)) {
        return { data: { success: false, error: "This capability is not available on client accounts. Your account covers your own portfolio only — contact your BGP team for anything further." } };
      }
    } catch {}
    // SharePoint tools
    if (tcName === "browse_sharepoint_folder") {
      if (!msToken) return { data: { error: "Microsoft 365 not connected. Please connect via the SharePoint page." } };
      if (tcArgs.driveId && tcArgs.itemId) {
        const r = await browseSharePointFolderByIds(tcArgs.driveId, tcArgs.itemId, msToken);
        return { data: r };
      }
      const r = await browseSharePointFolder(tcArgs.url || "/", msToken);
      return { data: r };
    }
    if (tcName === "create_sharepoint_folder") {
      const r = await executeCreateSharePointFolder(tcArgs, msToken);
      return { data: r, action: r.success ? { type: "sharepoint_folders", folders: [r] } : undefined };
    }
    if (tcName === "move_sharepoint_item") {
      const r = await executeMoveSharePointItem(tcArgs, msToken);
      return { data: r, action: r.success ? { type: "sharepoint_move", results: [r] } : undefined };
    }
    if (tcName === "read_sharepoint_file") {
      const r = await executeReadSharePointFile(tcArgs, msToken);
      return { data: r, action: r.success ? { type: "sharepoint_file", fileName: r.fileName, webUrl: r.webUrl } : undefined };
    }
    if (tcName === "upload_to_sharepoint") {
      if (!msToken) return { data: { error: "Microsoft 365 not connected. The user needs to connect their Microsoft account via the SharePoint page first, then try again." } };
      try {
        const chatMediaFilename = tcArgs.chatMediaFilename;
        if (!chatMediaFilename) return { data: { error: "No filename provided" } };

        let fileBuffer: Buffer | null = null;
        let originalName = tcArgs.fileName || chatMediaFilename.replace(/^\d+-[a-f0-9]+-/, "");
        const diskPath = path.join(process.cwd(), "ChatBGP", "chat-media", chatMediaFilename);
        if (fs.existsSync(diskPath)) {
          fileBuffer = fs.readFileSync(diskPath);
        } else {
          const dbFile = await getFile(`chat-media/${chatMediaFilename}`);
          if (dbFile) {
            fileBuffer = dbFile.data;
            if (dbFile.originalName) originalName = tcArgs.fileName || dbFile.originalName;
          }
        }
        if (!fileBuffer) {
          // Detect the most common misuse: someone passing an email attachment
          // filename (which doesn't follow the chat-media `<timestamp>-<hash>-`
          // pattern) and direct the agent to the correct tool. Same for
          // SharePoint paths or arbitrary filenames.
          const looksLikeChatMedia = /^\d+-[a-f0-9]+-/.test(chatMediaFilename);
          const hint = looksLikeChatMedia
            ? "It may have expired. Please regenerate the file and try again."
            : `That filename doesn't look like a chat-media file. If this is an email attachment, use \`download_email_attachment\` with \`action: 'save_to_sharepoint'\` and the folderPath instead — that tool pulls the binary from Graph and uploads it in one step. \`upload_to_sharepoint\` only handles files already in chat-media storage (generated docs, files dragged into the chat).`;
          return { data: { error: `File not found in chat-media: ${chatMediaFilename}. ${hint}` } };
        }

        const spSiteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`, {
          headers: { Authorization: `Bearer ${msToken}` },
        });
        if (!spSiteRes.ok) return { data: { error: "Could not access SharePoint site" } };
        const spSite = await spSiteRes.json();

        const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${spSite.id}/drives`, {
          headers: { Authorization: `Bearer ${msToken}` },
        });
        if (!drivesRes.ok) return { data: { error: "Could not access SharePoint drives" } };
        const drivesData = await drivesRes.json();
        const docLib = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
        if (!docLib) return { data: { error: "Could not find SharePoint document library" } };
        const driveId = docLib.id;

        const folderPath = `BGP share drive/${tcArgs.destinationFolderPath.replace(/^\/+|\/+$/g, "")}`;
        const segments = folderPath.split("/");
        let currentPath = "";
        for (const seg of segments) {
          const parentPath = currentPath || "";
          currentPath = currentPath ? `${currentPath}/${seg}` : seg;
          try {
            const checkUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(currentPath).replace(/%2F/g, "/")}`;
            const checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${msToken}` } });
            if (checkRes.ok) continue;
          } catch {}
          try {
            const createParent = parentPath
              ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(parentPath).replace(/%2F/g, "/")}:/children`
              : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
            await fetch(createParent, {
              method: "POST",
              headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ name: seg, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
            });
          } catch {}
        }

        const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(folderPath).replace(/%2F/g, "/")}/${encodeURIComponent(originalName)}:/content`;
        const ext = originalName.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
        const contentType = mimeMap[ext] || "application/octet-stream";

        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { Authorization: `Bearer ${msToken}`, "Content-Type": contentType },
          body: fileBuffer,
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          return { data: { error: `Upload failed (${uploadRes.status}): ${errText.slice(0, 200)}` } };
        }

        const result = await uploadRes.json();
        return {
          data: { success: true, fileName: result.name, webUrl: result.webUrl, size: result.size, folder: tcArgs.destinationFolderPath },
          action: { type: "sharepoint_file", fileName: result.name, webUrl: result.webUrl },
        };
      } catch (err: any) {
        return { data: { error: `SharePoint upload error: ${err.message}` } };
      }
    }
    // Property lookup — geocode then fetch
    // Property Pathway — orchestrator thin wrappers
    if (tcName === "start_property_pathway") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { desc } = await import("drizzle-orm");
        const userId = req.session?.userId || (req as any).tokenUserId || null;
        const address = String(tcArgs.address || "").trim();
        const postcode = tcArgs.postcode ? String(tcArgs.postcode).trim() : null;
        const confirmedTitleNumber = tcArgs.confirmedTitleNumber ? String(tcArgs.confirmedTitleNumber).trim().toUpperCase() : null;
        const skipLandReg = !!tcArgs.skipLandRegConfirmation;
        const forceNew = !!tcArgs.forceNew;

        // Dedupe — the same exact + fuzzy matcher POST /api/property-pathway/start
        // uses (findDuplicatePathwayRuns), so both front doors ask the same
        // question. An exact address match reopens the run; a fuzzy match
        // ("Vesuvius Site" vs "Vesuvius Works") makes the model ask the user
        // before creating anything. `forceNew` skips dedupe entirely.

        // Build the confirmed-title seed: resolve the proprietor for the
        // picked title and lock Stage 1 to it (manualLock) so the runner
        // honours the user's choice instead of re-fetching and picking the
        // first title back. Shared by the create path and the re-pin path.
        const buildConfirmedSeed = async (titleNumber: string) => {
          let proprietorName: string | null = null;
          let tenure: string | null = null;
          try {
            const { findProprietorsByTitle } = await import("./hmlr-direct");
            const props = await findProprietorsByTitle(titleNumber);
            if (props?.length) {
              proprietorName = props.map((p: any) => p.proprietorName).filter(Boolean).join(", ") || null;
              tenure = (props[0] as any)?.tenure || null;
            }
          } catch (e: any) {
            console.warn(`[start_property_pathway] proprietor lookup for ${titleNumber} failed: ${e?.message}`);
          }
          return {
            confirmedLandReg: { titleNumber, confirmedAt: new Date().toISOString(), confirmedBy: userId },
            stage1: {
              initialOwnership: {
                titleNumber,
                proprietorName,
                tenure,
                titleVerified: true,
                titleSource: "user_confirmed",
                manualLock: true,
                manualSetBy: userId,
                manualSetAt: new Date().toISOString(),
              },
            },
          };
        };

        if (!forceNew) {
          const existing = await db.select().from(propertyPathwayRuns).orderBy(desc(propertyPathwayRuns.updatedAt)).limit(200);
          const { findDuplicatePathwayRuns } = await import("./property-pathway");
          const { exact: match, similar } = findDuplicatePathwayRuns(address, postcode, existing);
          if (!match && similar.length > 0) {
            return {
              data: {
                duplicateSuspected: true,
                candidates: similar.map((r) => ({
                  runId: r.id,
                  address: r.address,
                  postcode: r.postcode,
                  currentStage: r.currentStage,
                  updatedAt: r.updatedAt,
                })),
                nextStep: `Found ${similar.length} existing pathway run${similar.length === 1 ? "" : "s"} that look like the same property ("${address}" vs e.g. "${similar[0].address}"). Do NOT create a new run yet — show the user the candidate(s) and ask whether to open the existing run or genuinely start fresh. To open one, navigate to /property-pathway?runId=<runId>. To start fresh anyway, call start_property_pathway again with forceNew: true.`,
              },
            };
          }
          if (match) {
            // What title is this existing run pinned to?
            const existingPin: string | null =
              (match.stageResults as any)?.confirmedLandReg?.titleNumber
              || (match.stageResults as any)?.stage1?.initialOwnership?.titleNumber
              || null;
            // BUG FIX: if the user has now confirmed a DIFFERENT title than the
            // matched run is pinned to, re-pin the existing run rather than
            // silently returning the stale one. Previously this `match` short-
            // circuit dropped the new confirmedTitleNumber on the floor — so
            // picking the long-leasehold (e.g. Nuveen/TGL379483) after a run
            // had been started on the freehold (Pavement Holdings) just reused
            // the freehold run, and every stage stayed built around the wrong
            // interest. Re-pinning resets it to Stage 1 on the correct title.
            if (confirmedTitleNumber && (!existingPin || existingPin.toUpperCase() !== confirmedTitleNumber)) {
              const seed = await buildConfirmedSeed(confirmedTitleNumber);
              const { eq } = await import("drizzle-orm");
              await db.update(propertyPathwayRuns).set({
                currentStage: 1,
                stageStatus: {},
                // Discard the old stage intel — it was built around the wrong
                // title — and reseed with the confirmed-title lock.
                stageResults: { confirmedLandReg: seed.confirmedLandReg, stage1: seed.stage1 },
              }).where(eq(propertyPathwayRuns.id, match.id));
              return {
                data: {
                  runId: match.id,
                  address: match.address,
                  currentStage: 1,
                  repinnedFrom: existingPin || null,
                  repinnedTo: confirmedTitleNumber,
                  nextStep: `This address already had an investigation pinned to ${existingPin || "another title"}. Re-pinned it to the confirmed title ${confirmedTitleNumber} and reset to Stage 1. Call advance_property_pathway with stage 1 to re-run Initial Search on the correct interest.`,
                },
                action: { type: "navigate", path: `/property-pathway?runId=${match.id}` },
              };
            }
            return {
              data: { runId: match.id, address: match.address, currentStage: match.currentStage, existing: true, nextStep: `Existing investigation reused for this address. Call advance_property_pathway to continue from stage ${match.currentStage}. If the user explicitly wants a fresh investigation from scratch instead, call start_property_pathway again with forceNew: true.` },
              action: { type: "navigate", path: `/property-pathway?runId=${match.id}` },
            };
          }
        }

        // ── LAND REGISTRY GATE ──────────────────────────────────────────
        // The pathway has to be pinned to a specific title. If the user
        // hasn't confirmed one yet (and hasn't explicitly opted out), look
        // up candidates and return them — do NOT create the run.
        if (!confirmedTitleNumber && !skipLandReg) {
          if (!postcode) {
            return {
              data: {
                needsLandRegConfirmation: true,
                reason: "missing_postcode",
                nextStep: `Before I can start the pathway on "${address}" I need a postcode so I can look up the Land Registry title. Ask the user for the postcode, then call start_property_pathway again with both address and postcode set.`,
              },
            };
          }
          const { findProprietorsByAddress } = await import("./hmlr-direct");
          // Pull a street-number-like token off the front of the address so
          // findProprietorsByAddress can ILIKE-match on it. Falls back to
          // "no number" (returns everything at the postcode).
          const numMatch = address.match(/^(\d+(?:-\d+)?[a-z]?)\b/i);
          const streetNumber = numMatch ? numMatch[1] : null;
          let candidates: any[] = [];
          try {
            candidates = await findProprietorsByAddress(postcode, streetNumber);
          } catch (e: any) {
            console.warn(`[start_property_pathway] LandReg lookup failed: ${e?.message}`);
          }
          if (candidates.length === 0) {
            return {
              data: {
                needsLandRegConfirmation: true,
                reason: "no_matches",
                postcode,
                streetNumber,
                nextStep: `No Land Registry titles found at postcode ${postcode}${streetNumber ? ` for "${streetNumber}"` : ""}. Tell the user we couldn't find a title from HMLR data and ASK whether to proceed without one (mixed-use estate, off-register property, etc.). If they agree, call start_property_pathway again with skipLandRegConfirmation: true.`,
              },
            };
          }
          // Compact the candidate list — proprietor name + tenure is all
          // the user needs to pick. (Drop addresses and dates from the
          // prompt to keep it short.)
          const compact = candidates.map((c) => ({
            titleNumber: c.titleNumber,
            tenure: c.tenure || null,
            propertyAddress: c.propertyAddress || null,
            proprietors: (c.proprietors || []).map((p: any) => p.proprietorName).filter(Boolean),
          }));
          return {
            data: {
              needsLandRegConfirmation: true,
              reason: "user_must_pick_title",
              postcode,
              streetNumber,
              candidates: compact,
              nextStep: `Show the user the ${compact.length} Land Registry candidate${compact.length === 1 ? "" : "s"} at ${address}. Ask which title to base the pathway on. Then call start_property_pathway again with confirmedTitleNumber set to their choice. Do NOT pick for them — the wrong title taints every later stage.`,
            },
          };
        }

        const initialStageResults: any = {};
        if (confirmedTitleNumber) {
          const seed = await buildConfirmedSeed(confirmedTitleNumber);
          initialStageResults.confirmedLandReg = seed.confirmedLandReg;
          // Seed stage1.initialOwnership with manualLock so the Stage 1 runner
          // HONOURS this title instead of re-fetching and picking a different
          // one (property-pathway.ts checks initialOwnership.manualLock).
          initialStageResults.stage1 = seed.stage1;
        } else if (skipLandReg) {
          initialStageResults.confirmedLandReg = { skipped: true, skippedAt: new Date().toISOString(), skippedBy: userId };
        }

        const [runRow] = await db.insert(propertyPathwayRuns).values({
          address,
          postcode,
          propertyId: tcArgs.propertyId || null,
          currentStage: 1,
          stageStatus: {},
          stageResults: initialStageResults,
          startedBy: userId,
        }).returning();
        return {
          data: {
            runId: runRow.id,
            address: runRow.address,
            currentStage: runRow.currentStage,
            confirmedTitleNumber: confirmedTitleNumber || null,
            landRegSkipped: skipLandReg,
            nextStep: "Call advance_property_pathway with stage 1 to run Initial Search",
          },
          action: { type: "navigate", path: `/property-pathway?runId=${runRow.id}` },
        };
      } catch (err: any) {
        return { data: { error: `Failed to start pathway: ${err?.message}` } };
      }
    }
    if (tcName === "advance_property_pathway") {
      try {
        const { runStage } = await import("./property-pathway");
        const runId = String(tcArgs.runId);
        const stage = tcArgs.stage ? Number(tcArgs.stage) : undefined;
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [existing] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
        if (!existing) return { data: { error: "Pathway run not found" } };
        const targetStage = stage ?? existing.currentStage;

        // Background the actual work — pathway stages take minutes
        // (Land Registry + planning + AI plan + Excel model), and we
        // were running them synchronously inside the chat turn, which
        // blocks the SSE stream long enough that the client gives up.
        // Nick & Jonny saw this as "chat keeps timing out". Now we
        // launch the stage async, return immediately with the watch
        // URL, and the user lands on the pathway page where progress
        // streams in via the realtime socket.
        (async () => {
          try {
            await runStage(runId, targetStage, req);
          } catch (err: any) {
            console.error(`[advance_property_pathway bg] run ${runId} stage ${targetStage} failed:`, err?.message);
          }
        })();

        return {
          data: {
            runId,
            stageStarted: targetStage,
            status: "running",
            watchUrl: `/property-pathway?runId=${runId}`,
            note: `Stage ${targetStage} kicked off in the background. Progress streams to the watch URL — no need to wait in chat. Multiple pathways can run in parallel.`,
          },
        };
      } catch (err: any) {
        return { data: { error: `Failed to advance pathway: ${err?.message}` } };
      }
    }
    if (tcName === "get_property_pathway") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, String(tcArgs.runId))).limit(1);
        if (!run) return { data: { error: "Pathway run not found" } };
        return { data: run };
      } catch (err: any) {
        return { data: { error: `Failed to fetch pathway: ${err?.message}` } };
      }
    }

    if (tcName === "update_business_plan") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const runId = String(tcArgs.runId || "");
        const patch = tcArgs.patch;
        if (!runId || !patch || typeof patch !== "object") return { data: { error: "runId and patch (object) required" } };
        const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
        if (!run) return { data: { error: "Pathway run not found" } };
        const sr: any = run.stageResults || {};
        const stage6: any = sr.stage6 || {};
        const base = stage6.agreed ? { ...stage6.agreed } : { ...(stage6.draft || {}) };
        const merged = { ...base, ...patch };
        const revisions = [
          ...(stage6.revisions || []),
          { at: new Date().toISOString(), source: "chat", patch, note: tcArgs.note },
        ].slice(-50);
        const nextStage6 = stage6.agreed
          ? { ...stage6, agreed: merged, revisions }
          : { ...stage6, draft: merged, revisions };
        await db.update(propertyPathwayRuns).set({ stageResults: { ...sr, stage6: nextStage6 }, updatedAt: new Date() }).where(eq(propertyPathwayRuns.id, runId));
        return { data: { ok: true, plan: merged, agreed: !!stage6.agreed } };
      } catch (err: any) {
        return { data: { error: `Failed to update business plan: ${err?.message}` } };
      }
    }

    if (tcName === "agree_business_plan") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const runId = String(tcArgs.runId || "");
        if (!runId) return { data: { error: "runId required" } };
        const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
        if (!run) return { data: { error: "Pathway run not found" } };
        const sr: any = run.stageResults || {};
        const stage6: any = sr.stage6 || {};
        if (!stage6.draft) return { data: { error: "No draft to agree — run Stage 6 first." } };
        const agreed = { ...stage6.draft };
        const user: any = (req as any).user;
        const nextStage6 = {
          ...stage6,
          agreed,
          agreedAt: new Date().toISOString(),
          agreedBy: user?.username || user?.email || "chatbgp",
        };
        const nextStatus = { ...(run.stageStatus as any), stage6: "completed" };
        await db.update(propertyPathwayRuns).set({
          stageResults: { ...sr, stage6: nextStage6 },
          stageStatus: nextStatus,
          currentStage: Math.max(run.currentStage || 6, 7),
          updatedAt: new Date(),
        }).where(eq(propertyPathwayRuns.id, runId));
        return { data: { ok: true, agreed, nextStage: 7 } };
      } catch (err: any) {
        return { data: { error: `Failed to agree plan: ${err?.message}` } };
      }
    }

    if (tcName === "list_property_pathway") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { desc, or, ilike } = await import("drizzle-orm");
        const limit = Math.min(Math.max(Number(tcArgs.limit) || 15, 1), 50);
        const q = tcArgs.query ? String(tcArgs.query).trim() : "";
        const query = db.select({
          id: propertyPathwayRuns.id,
          address: propertyPathwayRuns.address,
          postcode: propertyPathwayRuns.postcode,
          currentStage: propertyPathwayRuns.currentStage,
          stageStatus: propertyPathwayRuns.stageStatus,
          startedAt: propertyPathwayRuns.startedAt,
          updatedAt: propertyPathwayRuns.updatedAt,
        }).from(propertyPathwayRuns);
        const rows = q
          ? await query.where(or(ilike(propertyPathwayRuns.address, `%${q}%`), ilike(propertyPathwayRuns.postcode, `%${q}%`))).orderBy(desc(propertyPathwayRuns.updatedAt)).limit(limit)
          : await query.orderBy(desc(propertyPathwayRuns.updatedAt)).limit(limit);
        return { data: { count: rows.length, runs: rows } };
      } catch (err: any) {
        return { data: { error: `Failed to list pathway runs: ${err?.message}` } };
      }
    }

    if (tcName === "attach_workbook_to_pathway") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns, excelModelRuns, excelModelRunVersions } = await import("@shared/schema");
        const { eq, desc, and } = await import("drizzle-orm");
        const runId = String(tcArgs.runId || "");
        const modelRunId = String(tcArgs.modelRunId || "");
        if (!runId || !modelRunId) return { data: { error: "runId and modelRunId required" } };

        const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
        if (!run) return { data: { error: "Pathway run not found" } };

        const [modelRun] = await db.select().from(excelModelRuns).where(eq(excelModelRuns.id, modelRunId)).limit(1);
        if (!modelRun) return { data: { error: "Model run not found" } };

        const versionId = tcArgs.modelVersionId ? String(tcArgs.modelVersionId) : null;
        const [version] = versionId
          ? await db.select().from(excelModelRunVersions).where(and(eq(excelModelRunVersions.id, versionId), eq(excelModelRunVersions.modelRunId, modelRunId))).limit(1)
          : await db.select().from(excelModelRunVersions).where(eq(excelModelRunVersions.modelRunId, modelRunId)).orderBy(desc(excelModelRunVersions.version)).limit(1);
        if (versionId && !version) return { data: { error: "Specified modelVersionId not found on this model run" } };

        const sr: any = run.stageResults || {};
        const existingStage7: any = sr.stage7 || {};
        const nextStage7 = {
          ...existingStage7,
          modelRunId,
          modelVersionId: version?.id,
          modelRunName: modelRun.name,
          modelVersionLabel: version?.notes || (version ? `v${version.version}` : undefined),
          workbookUrl: `/api/models/runs/${modelRunId}/download`,
          // Re-attaching a workbook un-agrees Stage 7 — the user must review the
          // new model and click Agree again.
          agreed: false,
          agreedAt: undefined,
          agreedBy: undefined,
        };

        await db.update(propertyPathwayRuns).set({
          modelRunId,
          stageResults: { ...sr, stage7: nextStage7 },
          stageStatus: { ...((run.stageStatus as any) || {}), stage7: "running" },
          currentStage: Math.max(run.currentStage || 7, 7),
          updatedAt: new Date(),
        }).where(eq(propertyPathwayRuns.id, runId));

        return {
          data: {
            ok: true,
            runId,
            modelRunId,
            modelVersionId: version?.id,
            modelRunName: modelRun.name,
            modelVersionLabel: nextStage7.modelVersionLabel,
            workbookUrl: nextStage7.workbookUrl,
            note: "Stage 7 marked as running. The user still needs to Agree on the model from the pathway card to lock it and unlock Stage 8.",
          },
          action: { type: "navigate", path: `/property-pathway?runId=${runId}` },
        };
      } catch (err: any) {
        return { data: { error: `Failed to attach workbook to pathway: ${err?.message}` } };
      }
    }

    // Upsert a tenancy unit on a pathway run — used when lease terms are
    // extracted from a Land Registry register (or an email/brochure) so the
    // tenancy schedule + Why Buy regenerate against the real lease, instead
    // of the user re-typing terms ChatBGP already read.
    if (tcName === "update_pathway_tenancy") {
      try {
        const { db } = await import("./db");
        const { propertyPathwayRuns } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const runId = String(tcArgs.runId || "");
        const tenantName = String(tcArgs.tenantName || "").trim();
        if (!runId || !tenantName) return { data: { error: "runId and tenantName are required" } };

        const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
        if (!run) return { data: { error: "Pathway run not found" } };

        const sr: any = run.stageResults || {};
        const stage1: any = sr.stage1 || {};
        const tenancy: any = stage1.tenancy || { status: "unknown", units: [] };
        const units: any[] = Array.isArray(tenancy.units) ? [...tenancy.units] : [];

        const unitName = String(tcArgs.unitName || "Whole").trim();
        const incoming: any = {
          unitName,
          tenantName,
          ...(tcArgs.leaseStart ? { leaseStart: String(tcArgs.leaseStart) } : {}),
          ...(tcArgs.leaseExpiry ? { leaseExpiry: String(tcArgs.leaseExpiry) } : {}),
          ...(tcArgs.passingRentPa !== undefined && tcArgs.passingRentPa !== null ? { passingRentPa: Number(tcArgs.passingRentPa) } : {}),
          ...(tcArgs.sqft !== undefined && tcArgs.sqft !== null ? { sqft: Number(tcArgs.sqft) } : {}),
          ...(tcArgs.floor ? { floor: String(tcArgs.floor) } : {}),
          ...(tcArgs.useClass ? { useClass: String(tcArgs.useClass) } : {}),
          ...(tcArgs.titleNumber ? { titleNumber: String(tcArgs.titleNumber).toUpperCase() } : {}),
          ...(tcArgs.notes ? { notes: String(tcArgs.notes) } : {}),
          source: String(tcArgs.source || "land_registry"),
        };

        // Upsert: match on titleNumber first (strongest key), then
        // tenant + unit. Merge so partial updates don't wipe fields.
        const idx = units.findIndex((u: any) =>
          (incoming.titleNumber && u?.titleNumber && String(u.titleNumber).toUpperCase() === incoming.titleNumber)
          || (String(u?.tenantName || "").toLowerCase() === tenantName.toLowerCase()
              && String(u?.unitName || "Whole").toLowerCase() === unitName.toLowerCase())
        );
        if (idx >= 0) units[idx] = { ...units[idx], ...incoming };
        else units.push({ id: `manual-${Date.now()}`, ...incoming });

        const status = units.length > 0 ? (units.every((u: any) => u?.tenantName) ? "let" : "mixed") : (tenancy.status || "unknown");
        const nextStage1 = { ...stage1, tenancy: { ...tenancy, status, units } };

        await db.update(propertyPathwayRuns).set({
          stageResults: { ...sr, stage1: nextStage1 },
          updatedAt: new Date(),
        }).where(eq(propertyPathwayRuns.id, runId));

        return {
          data: {
            ok: true,
            runId,
            upserted: incoming,
            unitCount: units.length,
            note: "Tenancy updated on the run. Downstream documents (business plan / Why Buy) pick this up on their next regenerate.",
          },
        };
      } catch (err: any) {
        return { data: { error: `Failed to update pathway tenancy: ${err?.message}` } };
      }
    }

    if (tcName === "property_lookup") {
      const { performPropertyLookup, formatPropertyReport } = await import("./property-lookup");
      const args = { ...tcArgs };
      if (!args.postcode && args.query) {
        const geo = await resolvePostcodeFromQuery(args.query);
        if (geo) { args.postcode = geo.postcode; if (!args.address) args.address = geo.displayName; }
        else return { data: { error: `Couldn't find UK postcode for "${args.query}"` } };
      }
      if (!args.postcode) return { data: { error: "Need a postcode, address, or place name" } };
      const lookupResult = await performPropertyLookup({ ...args, layers: ["core", "extended"], propertyDataLayers: ["core", "market", "area", "planning", "residential"] });
      return { data: formatPropertyReport(lookupResult) };
    }
    if (tcName === "get_property_planning") {
      if (!tcArgs.propertyId) return { data: { error: "propertyId is required" } };
      const { getPlanningSummary, planningSummaryToMarkdown } = await import("./planning-summary");
      const summary = await getPlanningSummary(String(tcArgs.propertyId));
      return { data: planningSummaryToMarkdown(summary) };
    }
    // Financial model
    if (tcName === "run_model") {
      const modelResult = await executeModelRun(tcArgs);
      return { data: modelResult, action: { type: "model_run", runId: modelResult.runId, name: modelResult.name, outputs: modelResult.outputs, outputMapping: modelResult.outputMapping } };
    }
    // Document generation
    if (tcName === "generate_document") {
      const docResult = await executeDocumentGenerate(tcArgs);
      return { data: { templateName: docResult.templateName, fieldsUsed: docResult.fieldsUsed, totalFields: docResult.totalFields }, action: { type: "document_generate", templateName: docResult.templateName, content: docResult.content, fieldsUsed: docResult.fieldsUsed, totalFields: docResult.totalFields } };
    }
    // Brief-based document generation (new Document Studio convergence path)
    if (tcName === "generate_brief_document") {
      try {
        if (!tcArgs.briefId || !tcArgs.propertyId) {
          return { data: { error: "briefId and propertyId are required" } };
        }
        const briefMod: any = await import("./document-briefs");
        if (!briefMod.BRIEF_REGISTRY[tcArgs.briefId]) {
          return { data: { error: `Unknown briefId: ${tcArgs.briefId}. Valid: ${Object.keys(briefMod.BRIEF_REGISTRY).join(", ")}` } };
        }
        const ctx = {
          propertyId: String(tcArgs.propertyId),
          matterId: tcArgs.matterId,
          pathwayRunId: tcArgs.pathwayRunId,
          userId: undefined,
        };
        const brief = await briefMod.runBrief(tcArgs.briefId, ctx);
        const result: any = {
          briefId: brief.briefId,
          briefName: brief.briefName,
          title: brief.title,
          sectionCount: brief.sections.length,
          imageryResolved: Object.keys(brief.imagery).length,
          imageryProvenance: brief.imageryProvenance,
          summary: `Brief built. ${brief.sections.length} sections, imagery: ${Object.entries(brief.imageryProvenance).map(([k, p]) => `${k} (${p})`).join(", ")}.`,
        };
        // For chat, the brief output JSON is the deliverable — the user can
        // jump to /document-briefs to render with Claude design and save to
        // SharePoint via the picker. Keeps the chat call lean (Claude render
        // takes ~10-30s and the client iframe preview is the better UX for
        // iteration).
        result.nextStep = "Open /document-briefs and click Render on this brief to produce the styled HTML, then Save to SharePoint.";
        return {
          data: result,
          action: {
            type: "navigate",
            path: tcArgs.matterId ? `/pla/matters/${tcArgs.matterId}` : `/document-briefs`,
          },
        };
      } catch (err: any) {
        return { data: { error: err?.message || "brief document generation failed" } };
      }
    }
    // Template creation
    if (tcName === "create_document_template") {
      const { storage } = await import("./storage");
      const created = await storage.createDocumentTemplate({
        name: tcArgs.name, description: tcArgs.description || "",
        sourceFileName: "chatbgp-generated", sourceFilePath: "chatbgp-generated",
        templateContent: tcArgs.templateContent, fields: JSON.stringify(tcArgs.fields || []),
        status: "ready", design: "{}",
      });
      return { data: { success: true, templateId: created.id, templateName: created.name, fieldCount: (tcArgs.fields || []).length }, action: { type: "navigate", path: "/doc-generate?tab=templates" } };
    }
    // Template update (rename / rewrite / replace fields)
    if (tcName === "update_document_template") {
      const { storage } = await import("./storage");
      if (!tcArgs.templateId) return { data: { error: "templateId is required" } };
      const existing = await storage.getDocumentTemplate(tcArgs.templateId).catch(() => null);
      if (!existing) return { data: { error: `Template ${tcArgs.templateId} not found` } };
      const updates: Record<string, any> = {};
      if (typeof tcArgs.name === "string") updates.name = tcArgs.name;
      if (typeof tcArgs.description === "string") updates.description = tcArgs.description;
      if (typeof tcArgs.templateContent === "string") updates.templateContent = tcArgs.templateContent;
      if (Array.isArray(tcArgs.fields)) updates.fields = JSON.stringify(tcArgs.fields);
      if (Object.keys(updates).length === 0) return { data: { error: "No fields provided to update" } };
      const updated = await storage.updateDocumentTemplate(tcArgs.templateId, updates);
      return { data: { success: true, templateId: updated.id, templateName: updated.name, changed: Object.keys(updates) }, action: { type: "navigate", path: "/doc-generate?tab=templates" } };
    }
    // Template delete
    if (tcName === "delete_document_template") {
      const { storage } = await import("./storage");
      if (!tcArgs.templateId) return { data: { error: "templateId is required" } };
      const existing = await storage.getDocumentTemplate(tcArgs.templateId).catch(() => null);
      if (!existing) return { data: { error: `Template ${tcArgs.templateId} not found` } };
      await storage.deleteDocumentTemplate(tcArgs.templateId);
      return { data: { success: true, deletedId: tcArgs.templateId, deletedName: existing.name }, action: { type: "navigate", path: "/doc-generate?tab=templates" } };
    }
    // Everything else goes through executeCrmToolRaw (CRM, navigation, email, code tools, etc.)
    return executeCrmToolRaw(tcName, tcArgs, req);
  }

  // Live run registry — Claude-style re-attach. Phones tear the SSE down
  // the moment the user backs out of the chat; the work now survives that
  // (see isOverDeadline below), and this registry lets the returning client
  // see the run still composing: the thread view polls the active-run
  // endpoint and shows live progress until the saved reply lands. In-memory
  // is fine — the app runs a single replica.
  const activeChatRuns = new Map<string, { startedAt: number; userId: string; progress: string; partial: string }>();

  app.get("/api/chatbgp/threads/:threadId/active-run", requireAuth, async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId);
    const run = activeChatRuns.get(threadId);
    if (!run) return res.json({ active: false });
    // A run older than the 30-min hard deadline cap is a leaked entry.
    if (Date.now() - run.startedAt > 35 * 60 * 1000) {
      activeChatRuns.delete(threadId);
      return res.json({ active: false });
    }
    try {
      // Same visibility rule as the chat itself: thread creator or member.
      const thread = await storage.getChatThread(threadId);
      let allowed = !!thread && thread.createdBy === req.session.userId;
      if (!allowed && thread) {
        const m = await pool.query(
          `SELECT 1 FROM chat_thread_members WHERE thread_id = $1 AND user_id = $2 LIMIT 1`,
          [threadId, req.session.userId],
        );
        allowed = !!m.rows[0];
      }
      if (!allowed) return res.json({ active: false });
    } catch {
      return res.json({ active: false });
    }
    res.json({
      active: true,
      startedAt: run.startedAt,
      progress: run.progress,
      partial: run.partial.length > 2000 ? run.partial.slice(-2000) : run.partial,
    });
  });

  app.post("/api/chatbgp/chat", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: "AI API key not configured" });
    }

    const result = chatSchema.safeParse(req.body);
    if (!result.success) {
      console.error("[chatbgp] Chat validation failed:", JSON.stringify(result.error.issues.map(i => ({ path: i.path, code: i.code, message: i.message }))));
      if (req.body?.messages) {
        console.error("[chatbgp] Message count:", req.body.messages.length, "Lengths:", req.body.messages.map((m: any, i: number) => `[${i}] ${m.role}: ${(m.content || "").length} chars`).join(", "));
      }
      return res.status(400).json({ message: "Invalid request" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const heartbeat = setInterval(() => {
      if (res.destroyed || res.writableEnded) { clearInterval(heartbeat); return; }
      try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 2000);

    const safeSseWrite = (data: string) => {
      if (res.destroyed || res.writableEnded) return false;
      try { res.write(data); return true; } catch { return false; }
    };

    // Holder for the verified thread id (set below) so progress/deltas can
    // mirror into the active-run registry for re-attaching clients.
    const runRef: { id: string | null } = { id: null };

    const sendProgress = (status: string) => {
      if (runRef.id) {
        const run = activeChatRuns.get(runRef.id);
        if (run) { run.progress = status; run.partial = ""; }
      }
      safeSseWrite(`data: ${JSON.stringify({ progress: status })}\n\n`);
    };

    const sendDelta = (token: string) => {
      if (runRef.id) {
        const run = activeChatRuns.get(runRef.id);
        if (run) run.partial += token;
      }
      safeSseWrite(`data: ${JSON.stringify({ delta: token })}\n\n`);
    };

    const sseThreadId = result.data.threadId;

    let verifiedThreadId: string | null = null;
    if (sseThreadId) {
      try {
        const thread = await storage.getChatThread(sseThreadId);
        if (thread && thread.createdBy === req.session.userId) {
          verifiedThreadId = sseThreadId;
        } else if (thread) {
          // Shared thread: members chat in the same thread (that's what
          // "add <name> to this chat" means), so their assistant replies
          // must save too — creator-only would silently drop them.
          const m = await pool.query(
            `SELECT 1 FROM chat_thread_members WHERE thread_id = $1 AND user_id = $2 LIMIT 1`,
            [sseThreadId, req.session.userId],
          );
          if (m.rows[0]) {
            verifiedThreadId = sseThreadId;
          } else {
            console.warn(`[ChatBGP] threadId ${sseThreadId} not owned by or shared with user ${req.session.userId}`);
          }
        } else {
          console.warn(`[ChatBGP] threadId ${sseThreadId} not found`);
        }
      } catch {}
    }

    if (verifiedThreadId) {
      runRef.id = verifiedThreadId;
      activeChatRuns.set(verifiedThreadId, {
        startedAt: Date.now(),
        userId: req.session.userId!,
        progress: "Thinking...",
        partial: "",
      });
    }

    // Declared before sendResult so the save path can tell whether the
    // client is still listening; set by the req "close" handler below.
    let clientDisconnected = false;

    const sendResult = async (data: any) => {
      clearInterval(heartbeat);
      if (verifiedThreadId) activeChatRuns.delete(verifiedThreadId);
      let saved = false;
      if (verifiedThreadId && data.reply && !data.error) {
        try {
          // Never save the same assistant reply twice in a row — a stale
          // retry / queued re-send after a timeout regenerated an earlier
          // answer verbatim and the thread showed it twice (Woody's
          // signature hunt, 2026-08-21). Identical consecutive assistant
          // content is never intentional; drop the save and the push.
          try {
            const last = await pool.query(
              `SELECT role, content FROM chat_messages WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [verifiedThreadId]
            );
            if (last.rows[0]?.role === "assistant" && last.rows[0]?.content === data.reply) {
              console.warn(`[ChatBGP] Skipped duplicate assistant reply to thread ${verifiedThreadId}`);
              if (!safeSseWrite(`data: ${JSON.stringify({ ...data, savedToThread: false, duplicate: true })}\n\n`)) return;
              try { res.end(); } catch {}
              return;
            }
          } catch {}
          await storage.createChatMessage({
            threadId: verifiedThreadId,
            role: "assistant",
            content: data.reply,
            actionData: data.action ? JSON.stringify(data.action) : undefined,
          });
          saved = true;
          console.log(`[ChatBGP] Saved assistant reply to thread ${verifiedThreadId} (${data.reply.length} chars)`);
          if (clientDisconnected) {
            // The user left before the reply landed — nudge them back in.
            // Same shape as team-chat pushes; the deep link opens the thread.
            import("./push-notifications")
              .then(p => p.sendPushNotification(req.session.userId!, {
                title: "ChatBGP",
                body: String(data.reply).slice(0, 80),
                tag: `chat-${verifiedThreadId}`,
                url: `/chatbgp?thread=${verifiedThreadId}`,
              }))
              .catch(() => {});
          }
        } catch (saveErr: any) {
          console.error(`[ChatBGP] Failed to save reply to thread:`, saveErr?.message);
        }
      }
      if (!safeSseWrite(`data: ${JSON.stringify({ ...data, savedToThread: saved })}\n\n`)) return;
      try { res.end(); } catch {}
    };

    // ── /opus or /sonnet slash-command interception ─────────────────────
    // If the latest user message starts with one of those, flip the
    // thread's model_preference. If the user typed JUST the command,
    // short-circuit with an ack — no Claude call. Otherwise strip the
    // command from the message and continue with the new model.
    let slashOverride: "fable" | "opus" | "sonnet" | null = null;
    {
      const allMessages = result.data.messages || [];
      const lastIdx = allMessages.length - 1;
      const lastMsg = allMessages[lastIdx];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      const slash = parseSlashCommand(lastText);
      if (slash.command) {
        await setThreadModel(verifiedThreadId, slash.command);
        if (slash.wasJustCommand) {
          await sendResult({ reply: ackMessage(slash.command) });
          return;
        }
        slashOverride = slash.command;
        allMessages[lastIdx] = { ...lastMsg, content: slash.strippedContent };
      }
    }

    const requestStart = Date.now();
    // Hard deadline = 10 minutes by default, matching the client's fetch
    // abort. Beyond this the SSE connection is going to be torn down
    // anyway, so cutting the loop is the honest move. Inside the deadline,
    // Claude is free to run as long as it needs.
    // Server-side callers (chatbgp-internal: activity curations) don't have
    // the browser abort and their sweeps outrun 10 minutes — a big landlord
    // mailbox+calendar fan-out (Landsec) died at "Deadline reached after 2
    // loops" four times on 2026-08-04. They pass deadlineMs in the body;
    // clamped to 30 min so nothing can pin a worker forever.
    const REQUEST_DEADLINE_MS = Math.min(
      Math.max(Number((req.body as any)?.deadlineMs) || 10 * 60 * 1000, 60 * 1000),
      30 * 60 * 1000,
    );
    // A dropped connection must NOT kill the work when the chat is a saved
    // thread: phones tear down the SSE the moment the user backs out of the
    // chat or the app is backgrounded, and the reply used to die with it
    // (Woody, 2026-08-18 — "when I return out of the chat it halts"). With
    // a verified thread the loop runs to completion and sendResult saves
    // the reply to the thread; the mobile 8s thread poll shows it on
    // return. Ephemeral chats (no saved thread) still stop early — there's
    // nowhere to save, so finishing would waste the tokens.
    const isOverDeadline = () =>
      (clientDisconnected && !verifiedThreadId) || Date.now() - requestStart > REQUEST_DEADLINE_MS;

    req.on("close", () => {
      clientDisconnected = true;
      clearInterval(heartbeat);
    });

    let conversationMessages: any[] = [];
    try {
      let { tools } = await getAvailableTools();
      const chatGuard = await clientChatGuard(req);
      // Server-originated curation calls carry the internal staff token —
      // they run at FULL tool power (mailbox + diary sweeps included) even
      // when the triggering viewer was a client login. What clients get to
      // READ is governed at the cache layer, not by degrading the analysis
      // (Woody, 2026-08-19: "remove the gating entirely").
      const { internalStaffToken } = await import("./chatbgp-internal");
      const isInternalStaffCall = req.headers["x-bgp-internal"] === internalStaffToken();
      let sseScopeCompanyId: string | null = null;
      if (chatGuard.isClient && !isInternalStaffCall) {
        // Client login: scoped tool allowlist when we can resolve their
        // company, no tools at all when we can't (fail closed).
        sseScopeCompanyId = await resolveCompanyScope(req).catch(() => null);
        tools = sseScopeCompanyId ? filterToolsForClientScope(tools) : [];
      }
      const userId = req.session.userId!;
      // Lean mode: the firm-wide context builders (memory, learnings, CRM
      // summary, knowledge bank, and a live email/calendar Graph fetch) used to
      // run on every turn and get force-fed into the prompt. They're no longer
      // injected — the model pulls any of that on demand via tools — so we skip
      // building them entirely. Just the current thread's property/deal context
      // and the cheap "current user" line (below) remain.
      let threadContext = "";
      let currentUserContext = "";
      if (isInternalStaffCall) {
        // Server-originated analysis job (activity curation etc.) — the
        // forwarded session is just transport. No greeting, no client
        // persona: neutral analyst voice for the BGP team.
        currentUserContext = `\n\n## Server-originated analysis job\nThis is an automated BGP-internal analysis run, not a live chat. Write in neutral analyst voice — do not greet or address any individual by name, and never suggest the reader "contact BGP" (this analysis is produced BY BGP).\n`;
      } else {
        try {
          const currentUser = await storage.getUser(userId);
          if (currentUser) {
            currentUserContext = `\n\n## Current User\nYou are speaking with **${currentUser.name}**${currentUser.department ? " (" + currentUser.department + " team)" : ""}${currentUser.role ? " — " + currentUser.role : ""}. Personalise your responses accordingly — use their name occasionally, and prioritise information relevant to their team.\n`;
          }
        } catch {}
        if (chatGuard.isClient) {
          currentUserContext += sseScopeCompanyId
            ? await withTimeout(getClientCrmContext(sseScopeCompanyId), 5000, "")
            : chatGuard.constraint;
        }
      }

      if (verifiedThreadId && !sseScopeCompanyId) {
        try {
          const thread = await storage.getChatThread(verifiedThreadId);
          if (thread?.propertyId) {
            const [propRows, dealRows, unitRows, reqRows] = await Promise.all([
              pool.query(`SELECT p.*, 
                (SELECT COUNT(*) FROM available_units au WHERE au.property_id = p.id) as unit_count,
                (SELECT COUNT(*) FROM available_units au WHERE au.property_id = p.id AND au.marketing_status = 'Available') as available_count
                FROM crm_properties p WHERE p.id = $1`, [thread.propertyId]),
              pool.query(`SELECT name, status, deal_type, fee, team FROM crm_deals WHERE property_id = $1 AND status NOT IN ('Dead','Withdrawn') ORDER BY created_at DESC LIMIT 10`, [thread.propertyId]).catch(() => ({ rows: [] })),
              pool.query(`SELECT unit_name, use_class, sqft, asking_rent, marketing_status FROM available_units WHERE property_id = $1 ORDER BY unit_name LIMIT 15`, [thread.propertyId]).catch(() => ({ rows: [] })),
              pool.query(`SELECT r.name, r.use, r.size, c.name as company_name FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON r.company_id = c.id WHERE r.requirement_locations IS NOT NULL AND EXISTS (SELECT 1 FROM crm_properties p WHERE p.id = $1 AND (r.requirement_locations && ARRAY[p.name])) LIMIT 5`, [thread.propertyId]).catch(() => ({ rows: [] })),
            ]);
            const prop = propRows.rows[0];
            if (prop) {
              const addr = typeof prop.address === "object" && prop.address ? ((prop.address as any).formatted || (prop.address as any).address || "") : (prop.address || "");
              threadContext = `\n\n## ACTIVE PROPERTY CONTEXT — You are chatting about this property\n`;
              threadContext += `**${prop.name}**${addr ? " — " + addr : ""}\n`;
              threadContext += `Property id (use for save_to_image_studio.propertyId, edit_image.propertyId, and any other tool that takes a propertyId): ${prop.id}\n`;
              threadContext += `Asset class: ${prop.asset_class || "Unknown"} | Status: ${prop.status || "Unknown"}\n`;
              if (prop.tenure) threadContext += `Tenure: ${prop.tenure}\n`;
              if (prop.sqft) threadContext += `Total area: ${Number(prop.sqft).toLocaleString()} sqft\n`;
              threadContext += `Units: ${prop.unit_count} total, ${prop.available_count} available\n`;
              if (dealRows.rows.length > 0) {
                threadContext += `\n**Active deals on this property:**\n`;
                for (const d of dealRows.rows) {
                  const feeText = chatGuard.isClient ? "" : ` | Fee: ${d.fee ? "£" + Number(d.fee).toLocaleString() : "TBC"}`;
                  threadContext += `- ${d.name} | ${d.deal_type || ""} | ${d.status}${feeText} | ${d.team || ""}\n`;
                }
              }
              if (unitRows.rows.length > 0) {
                threadContext += `\n**Units:**\n`;
                for (const u of unitRows.rows) {
                  threadContext += `- ${u.unit_name} — ${u.use_class || ""}, ${u.sqft ? Number(u.sqft).toLocaleString() + " sqft" : ""}, ${u.asking_rent ? "£" + u.asking_rent + " psf" : ""} [${u.marketing_status}]\n`;
                }
              }
              if (reqRows.rows.length > 0) {
                threadContext += `\n**Matching requirements (tenants looking in this area):**\n`;
                for (const r of reqRows.rows) {
                  const uses = Array.isArray(r.use) ? r.use.join("/") : "";
                  const sizes = Array.isArray(r.size) ? r.size.join(", ") : "";
                  threadContext += `- ${r.name} (${r.company_name || "Unknown"}) — ${uses || "Any use"}, ${sizes || "Any size"}\n`;
                }
              }
              threadContext += `\nAll questions in this thread should be assumed to relate to this property unless the user specifies otherwise.\n`;
            }
          }
          if (thread?.linkedType === "deal" && thread?.linkedId) {
            const dealRows = await pool.query(`SELECT d.*, p.name as property_name, 
              (SELECT name FROM crm_companies WHERE id = d.tenant_id) as tenant_name,
              (SELECT name FROM crm_companies WHERE id = d.landlord_id) as landlord_name
              FROM crm_deals d LEFT JOIN crm_properties p ON d.property_id = p.id WHERE d.id = $1`, [thread.linkedId]).catch(() => ({ rows: [] }));
            const deal = dealRows.rows[0];
            if (deal) {
              threadContext += `\n\n## ACTIVE DEAL CONTEXT — You are chatting about this deal\n`;
              threadContext += `**${deal.name}** | ${deal.deal_type || ""} | Status: ${deal.status || "Unknown"}\n`;
              if (deal.property_name) threadContext += `Property: ${deal.property_name}\n`;
              if (deal.tenant_name) threadContext += `Tenant: ${deal.tenant_name}\n`;
              if (deal.landlord_name) threadContext += `Landlord: ${deal.landlord_name}\n`;
              if (deal.fee && !chatGuard.isClient) threadContext += `Fee: £${Number(deal.fee).toLocaleString()}\n`;
              if (deal.team) threadContext += `Team: ${deal.team}\n`;
              if (deal.internal_agent) threadContext += `Agent: ${Array.isArray(deal.internal_agent) ? deal.internal_agent.join(", ") : deal.internal_agent}\n`;
              threadContext += `All questions in this thread should be assumed to relate to this deal unless the user specifies otherwise.\n`;
            }
          }
        } catch (e) {
          console.error("Failed to load thread context:", e);
        }
      }

      let systemPrompt2: string;
      if (chatGuard.isClient && !isInternalStaffCall) {
        systemPrompt2 = CLIENT_SYSTEM_PROMPT;
      } else {
        try {
          systemPrompt2 = await buildSystemPrompt();
        } catch {
          systemPrompt2 = SYSTEM_PROMPT_FALLBACK;
        }
      }
      // Split system prompt: static (cacheable) vs dynamic (per-request)
      // Lean context: only the cheap, targeted bits — who you're talking to and
      // the current thread's property/deal. The firm-wide dumps (knowledge,
      // learnings, memory, email/calendar, CRM summary) used to be force-fed on
      // every turn, bloating the window and diluting focus. The model now fetches
      // any of those on demand via tools (search_crm, search_knowledge_base, the
      // email/calendar tools) only when a request actually needs them.
      const dynamicContext = currentUserContext + threadContext;
      const systemContent2 = systemPrompt2 + dynamicContext;

      // Build structured system prompt array for Anthropic prompt caching
      const systemArray = [
        { type: "text" as const, text: systemPrompt2, cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: dynamicContext },
      ];

      const MAX_AI_MESSAGES = 80;
      const trimmedMessages = result.data.messages.length > MAX_AI_MESSAGES
        ? result.data.messages.slice(-MAX_AI_MESSAGES)
        : result.data.messages;
      const { readDocumentForAI } = await import("./document-reader");
      const DOC_LINK_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic"];
      const processedMessages = await Promise.all(trimmedMessages.map(async (msg: any) => {
        if (msg.role !== "user" || typeof msg.content !== "string") return msg;

        // Resolve attached DOCUMENT links — [name](/api/chat-media/foo.xlsx) —
        // into extracted text. The full-page ChatBGP attaches non-image files
        // (Excel, PDF, Word) as plain markdown links, but Claude only ever saw
        // the bare link and replied "I can't see any attachment". Image links
        // use the ![..](..) form and are handled by the image pass below; the
        // (?<!!) guard keeps them out of this one.
        let docContent: string = msg.content;
        const docLinkPattern = /(?<!!)\[([^\]]*)\]\((\/api\/chat-media\/[^)]+)\)/g;
        const docMatches = [...docContent.matchAll(docLinkPattern)];
        const docTexts: string[] = [];
        for (const m of docMatches) {
          const filename = m[2].replace("/api/chat-media/", "");
          if (DOC_LINK_IMAGE_EXTS.includes(path.extname(filename).toLowerCase())) continue;
          const label = m[1] || filename;
          try {
            const doc = await readDocumentForAI({ chatMediaFilename: filename, includePageImages: false, maxTextChars: 40000 });
            if (doc.ok && doc.text && doc.text.trim()) {
              docTexts.push(`=== FILE: ${label} ===\n${doc.text}${doc.textTruncated ? "\n\n[...truncated]" : ""}`);
            } else {
              docTexts.push(`=== FILE: ${label} ===\n(Could not read this file: ${doc.ok ? "no extractable text found" : doc.error})`);
            }
          } catch (err: any) {
            console.error(`[ChatBGP] Failed to read attached document ${filename}:`, err?.message);
            docTexts.push(`=== FILE: ${label} ===\n(Could not read this file: ${err?.message || "error"})`);
          }
        }
        if (docTexts.length > 0) {
          docContent = `${docContent}\n\n--- ATTACHED DOCUMENTS ---\n${docTexts.join("\n\n")}`;
        }

        const imageUrlPattern = /!\[([^\]]*)\]\((\/api\/chat-media\/[^)]+)\)/g;
        const matches = [...docContent.matchAll(imageUrlPattern)];
        if (matches.length === 0) return docTexts.length > 0 ? { ...msg, content: docContent } : msg;
        const textContent = docContent.replace(imageUrlPattern, "").trim() || "What do you see in this image?";
        const contentParts: any[] = [{ type: "text", text: textContent }];
        for (const match of matches) {
          const mediaPath = match[2];
          const filename = mediaPath.replace("/api/chat-media/", "");
          try {
            const file = await getFile(`chat-media/${filename}`);
            let imageData: Buffer | null = null;
            let mime = "image/png";
            if (file && file.data) {
              imageData = Buffer.from(file.data);
              mime = file.contentType || "image/png";
            } else {
              const diskPath = path.join(process.cwd(), "ChatBGP", "chat-media", filename);
              if (fs.existsSync(diskPath)) {
                imageData = fs.readFileSync(diskPath);
                const ext = path.extname(filename).toLowerCase();
                mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/png";
              }
            }
            if (imageData) {
              // Same normalisation as the live upload paths — HEIC
              // files persisted to chat-media still need converting
              // before they hit Claude on a later thread reload.
              const normalised = await normaliseImageForClaude(imageData, mime, filename);
              const base64 = normalised.buffer.toString("base64");
              contentParts.push({ type: "image_url", image_url: { url: `data:${normalised.mimeType};base64,${base64}`, detail: "auto" } });
            }
          } catch (err: any) {
            console.error(`[ChatBGP] Failed to load pasted image ${filename}:`, err?.message);
          }
        }
        // No images actually loaded — keep docContent so any extracted
        // document text still reaches Claude (falls back to original msg
        // when there were no attachments at all).
        if (contentParts.length === 1) return { ...msg, content: docContent };
        return { ...msg, content: contentParts };
      }));

      const resolved = await resolveChatModel({ threadId: verifiedThreadId, override: slashOverride });
      const completionOptions: any = {
        model: resolved.model,
        messages: [
          { role: "system", content: systemContent2 },
          ...processedMessages,
        ],
        max_completion_tokens: 16384,
        systemArray, // structured system prompt for prompt caching
      };

      if (tools.length > 0) {
        completionOptions.tools = tools;
        completionOptions.tool_choice = "auto";
      }

      let msToken: string | null = null;
      try { msToken = await getValidMsToken(req); } catch {}

      conversationMessages = [...completionOptions.messages];
      let lastAction: any = null;
      let loopCount = 0;
      // Soft cap to prevent a genuinely-stuck Claude looping forever
      // (e.g. tool keeps erroring, Claude keeps retrying it). Set
      // high enough that no legitimate multi-step task hits it —
      // Anthropic's API itself has no per-turn iteration cap, this
      // is purely a runaway guard. The real cap is the 10-min
      // deadline above.
      const maxLoops = 100;

      while (loopCount < maxLoops) {
        if (isOverDeadline()) {
          console.log(`[ChatBGP] Deadline reached after ${loopCount} loops`);
          const timeoutMsg = clientDisconnected && !verifiedThreadId
            ? "Connection lost. Please refresh and try again."
            : "This is taking longer than expected — try breaking your request into smaller steps (e.g. ask me to check one category at a time).";
          await sendResult({ reply: timeoutMsg, partial: true });
          return;
        }
        loopCount++;
        const isLastLoop = loopCount >= maxLoops;

        const loopOpts: any = {
          model: resolved.model,
          messages: conversationMessages,
          max_completion_tokens: 16384,
          systemArray, // prompt caching on every call
          thinking: true, // extended thinking for quality
          effort: "medium", // interactive chat: trims Fable's default deep-think per turn (Woody, 2026-08-28: speed)
        };
        if (!isLastLoop) {
          loopOpts.tools = tools;
          loopOpts.tool_choice = "auto";
        }

        // Stream every round (Woody, 2026-08-18: quick no-tool answers are
        // the most common case and never streamed — the first loop was
        // non-streaming, so simple questions got no live text at all).
        // Text emitted before a tool round is harmless: the next progress
        // event resets both the client bubble and the active-run partial.
        const useStreaming = true;
        let completion: any;
        let streamedFinal = false;

        if (useStreaming) {
          // Stream with deltas — if tool_calls come back, deltas were just partial text (rare)
          sendProgress("Composing response...");
          try {
            completion = await callClaudeStreaming(loopOpts, (token) => {
              sendDelta(token);
            });
          } catch (streamErr: any) {
            // Context-length error mid-loop: trim oldest non-system messages and retry once
            const errStr = JSON.stringify(streamErr?.error || streamErr?.body || streamErr?.message || "").toLowerCase();
            const isContextErr = streamErr?.status === 400 && (errStr.includes("too long") || errStr.includes("context_length") || errStr.includes("prompt is too long"));
            if (isContextErr && conversationMessages.length > 4) {
              console.warn("[ChatBGP] Context too long mid-stream — trimming history and retrying");
              // Keep system + first user message + last 6 messages
              const sys = conversationMessages.filter((m: any) => m.role === "system");
              const rest = conversationMessages.filter((m: any) => m.role !== "system");
              conversationMessages = [...sys, ...rest.slice(0, 2), ...rest.slice(-12)];
              loopOpts.messages = conversationMessages;
              completion = await callClaudeStreaming(loopOpts, (token) => { sendDelta(token); });
            } else {
              throw streamErr;
            }
          }
          streamedFinal = true;
        } else {
          try {
            completion = await callClaude(loopOpts);
          } catch (callErr: any) {
            const errStr = JSON.stringify(callErr?.error || callErr?.body || callErr?.message || "").toLowerCase();
            const isContextErr = callErr?.status === 400 && (errStr.includes("too long") || errStr.includes("context_length") || errStr.includes("prompt is too long"));
            if (isContextErr && conversationMessages.length > 4) {
              console.warn("[ChatBGP] Context too long in tool loop — trimming history and retrying");
              const sys = conversationMessages.filter((m: any) => m.role === "system");
              const rest = conversationMessages.filter((m: any) => m.role !== "system");
              conversationMessages = [...sys, ...rest.slice(0, 2), ...rest.slice(-12)];
              loopOpts.messages = conversationMessages;
              completion = await callClaude(loopOpts);
            } else {
              throw callErr;
            }
          }
        }

        const message = completion.choices[0]?.message;
        if (!message) break;

        console.log(`[ChatBGP] Loop ${loopCount}: tool_calls=${message.tool_calls?.length || 0}, has_content=${!!message.content}, streamed=${streamedFinal}`);

        if (message.tool_calls && message.tool_calls.length > 0) {
          conversationMessages.push(message);
          const toolNames = (message.tool_calls as unknown as ToolCall[]).map(tc => tc.function.name);
          const progressLabel = toolNames.length === 1
            ? getToolProgressLabel(toolNames[0])
            : toolNames.length <= 3
              ? toolNames.map(getToolProgressLabel).join(", ")
              : `Running ${toolNames.length} operations...`;
          sendProgress(progressLabel);

          for (const tc of message.tool_calls as unknown as ToolCall[]) {
            if (isOverDeadline()) {
              conversationMessages.push({ role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Ran out of time" }) });
              continue;
            }
            const tcName = tc.function.name;
            let tcArgs: any;
            try { tcArgs = JSON.parse(tc.function.arguments); } catch { tcArgs = {}; }
            console.log(`[ChatBGP] Loop ${loopCount}: tool=${tcName}${tcArgs?.command ? ' cmd=' + tcArgs.command.substring(0, 80) : ''}`);

            try {
              // No artificial per-tool timeout. Normal Claude tool use
              // doesn't impose one — the tool either succeeds or fails
              // on its own merits. We keep ONE generous hard cap (10
              // min, matching the client) purely as a safety net for a
              // genuinely-hung tool (deadlocked query etc.); every
              // tool worth caring about has its own internal fetch /
              // abort handling well inside this. The previous 60s
              // default was clipping legitimate long-running work like
              // designed PDF generation and big SharePoint fetches.
              const toolResult = await withTimeout(
                executeAnyTool(tcName, tcArgs, req, msToken),
                10 * 60 * 1000,
                { data: { error: "Tool didn't return within 10 minutes — looks hung. The chat has a hard 10-min cap as a safety net." } }
              );
              if (toolResult.action) lastAction = toolResult.action;
              const resultStr = typeof toolResult.data === "string" ? toolResult.data : JSON.stringify(toolResult.data);
              conversationMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: resultStr.length > 80000 ? resultStr.slice(0, 80000) + "\n...[truncated — full result was " + resultStr.length + " chars]" : resultStr,
              });
            } catch (toolErr: any) {
              console.error(`[ChatBGP] Tool ${tcName} error:`, toolErr?.message);
              conversationMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }),
              });
            }
          }
        } else {
          if (message.content) {
            console.log(`[ChatBGP] Loop ${loopCount}: final text reply received (streamed=${streamedFinal})`);
            await sendResult({ reply: message.content, ...(lastAction ? { action: lastAction } : {}) });

            const lastUserMsg = result.data.messages.filter(m => m.role === "user").pop();
            if (lastUserMsg && message.content.length > 20) {
              extractAndSaveMemories(userId, lastUserMsg.content, message.content).catch(() => {});
            }
            return;
          }
          conversationMessages.push(message);
          break;
        }
      }

      const lastAssistantMsg = conversationMessages.filter((m: any) => m.role === "assistant" && m.content).pop();
      const fallbackReply = lastAssistantMsg?.content || "I've processed your request. Please ask a follow-up for more details.";
      await sendResult({ reply: fallbackReply, ...(lastAction ? { action: lastAction } : {}) });
    } catch (err: any) {
      const errBodyRaw = JSON.stringify(err?.error || err?.body || "").slice(0, 2000);
      console.error("ChatBGP error:", err?.status, err?.message || err, errBodyRaw);
      let errorMsg = "I ran into a technical glitch — the server logs have the details. Please try again, or rephrase if it keeps happening.";
      if (err?.status === 529) errorMsg = "Anthropic's API is overloaded right now. Please try again in a moment.";
      else if (err?.status === 401) errorMsg = "AI authentication issue — the API key may be missing or invalid. Please contact support.";
      else if (err?.status === 429) errorMsg = "Hit the API rate limit. Please wait a minute and try again.";
      else if (err?.status === 400) {
        const errBody = errBodyRaw.toLowerCase();
        const isContextLen = errBody.includes("too long") || errBody.includes("context_length") || errBody.includes("prompt is too long") || errBody.includes("max_tokens_to_sample");
        const isThinkingMode = errBody.includes("thinking.type") || errBody.includes("thinking type") || errBody.includes("budget_tokens") || errBody.includes("output_config");
        if (isContextLen && !isThinkingMode) {
          errorMsg = "That conversation got too long for me to process. Try starting a new thread or asking a simpler question.";
        } else if (errBody.includes("image") || errBody.includes("media")) {
          errorMsg = "Problem with an attached image or file. Try removing it or sending a different format.";
        } else {
          errorMsg = `Technical error from the AI API (400). Server logs have the full details. ${errBodyRaw.slice(0, 180)}`;
        }
      } else if (err?.status === 500 || err?.status === 502 || err?.status === 503 || err?.status === 504) {
        errorMsg = "Anthropic's API returned a server error. Please try again in a moment.";
      }

      const lastAssistantContent = conversationMessages?.filter((m: any) => m.role === "assistant" && m.content).pop()?.content;
      if (lastAssistantContent && lastAssistantContent.length > 30) {
        errorMsg = lastAssistantContent;
      }

      clearInterval(heartbeat);
      if (verifiedThreadId) activeChatRuns.delete(verifiedThreadId);
      // Client already gone: the SSE write below lands nowhere, so persist
      // the outcome to the thread — returning to silence looks like a hang.
      if (verifiedThreadId && clientDisconnected) {
        try {
          await storage.createChatMessage({ threadId: verifiedThreadId, role: "assistant", content: errorMsg });
          import("./push-notifications")
            .then(p => p.sendPushNotification(req.session.userId!, {
              title: "ChatBGP",
              body: errorMsg.slice(0, 80),
              tag: `chat-${verifiedThreadId}`,
              url: `/chatbgp?thread=${verifiedThreadId}`,
            }))
            .catch(() => {});
        } catch {}
      }
      safeSseWrite(`data: ${JSON.stringify({ reply: errorMsg, error: !lastAssistantContent, errorStatus: err?.status || 500 })}\n\n`);
      try { if (!res.writableEnded) res.end(); } catch {}
    }
  });

  app.post("/api/chatbgp/excel-chat", requireAuth, chatUpload.array("files", 20), async (req: Request, res: Response) => {
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: "AI API key not configured" });
    }

    const isMultipart = (req.headers["content-type"] || "").startsWith("multipart/form-data");
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];

    let messages: any[] = [];
    let excelContext: string | undefined;
    try {
      if (isMultipart) {
        messages = JSON.parse(req.body.messages || "[]");
        excelContext = req.body.excelContext || undefined;
      } else {
        messages = req.body.messages;
        excelContext = req.body.excelContext;
      }
    } catch {
      return res.status(400).json({ message: "Invalid messages format" });
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ message: "messages array required" });
    }
    if (messages.length > 40) {
      // Don't hard-reject long sessions (Excel add-in model builds blow past 40).
      // Keep the opening brief + the most recent turns so the chat keeps flowing.
      messages = [messages[0], ...messages.slice(-39)];
    }
    for (const m of messages) {
      if (!m || !["user", "assistant"].includes(m.role)) {
        return res.status(400).json({ message: "Each message must have role (user/assistant)" });
      }
      const contentLen = typeof m.content === "string" ? m.content.length : 0;
      if (contentLen > 50000) {
        return res.status(400).json({ message: "Message content too long (max 50000 chars)" });
      }
    }
    if (excelContext && (typeof excelContext !== "string" || excelContext.length > 100000)) {
      return res.status(400).json({ message: "excelContext must be a string under 100000 chars" });
    }

    // /opus or /sonnet slash-command interception (excel-chat).
    const excelThreadId = typeof req.body.threadId === "string" ? req.body.threadId : null;
    let excelSlashOverride: "fable" | "opus" | "sonnet" | null = null;
    {
      const lastIdx = messages.length - 1;
      const lastText = lastIdx >= 0 && typeof messages[lastIdx]?.content === "string" ? messages[lastIdx].content : "";
      const slash = parseSlashCommand(lastText);
      if (slash.command) {
        await setThreadModel(excelThreadId, slash.command);
        if (slash.wasJustCommand) {
          return res.json({ reply: ackMessage(slash.command) });
        }
        excelSlashOverride = slash.command;
        messages[lastIdx] = { ...messages[lastIdx], content: slash.strippedContent };
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch {}
    }, 5000);

    let clientClosed = false;
    req.on("close", () => { clientClosed = true; clearInterval(heartbeat); });

    const sendProgress = (status: string) => {
      try { if (!clientClosed) res.write(`data: ${JSON.stringify({ progress: status })}\n\n`); } catch {}
    };

    try {
      // Handle attached files (same pattern as chat-with-files)
      const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic"];
      const AUDIO_VIDEO_EXTENSIONS = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma", ".mov", ".avi", ".mkv", ".wmv", ".flv"];
      const documentTexts: string[] = [];
      const imageContentParts: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];

      if (uploadedFiles.length > 0) {
        sendProgress(`Reading ${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"}...`);
        for (const file of uploadedFiles) {
          const ext = "." + (file.originalname.split(".").pop()?.toLowerCase() || "");
          const isImage = IMAGE_EXTENSIONS.includes(ext) || file.mimetype?.startsWith("image/");
          const isAudioVideo = AUDIO_VIDEO_EXTENSIONS.includes(ext) || file.mimetype?.startsWith("audio/") || file.mimetype?.startsWith("video/");
          const fileData = fs.readFileSync(file.path);
          const chatMediaName = `${Date.now()}-${path.basename(file.path)}${ext}`;
          const storageKey = `chat-media/${chatMediaName}`;
          try {
            await saveFile(storageKey, fileData, file.mimetype || "application/octet-stream", file.originalname);
          } catch (err: any) {
            console.error(`[ChatBGP Excel] File DB save error (${file.originalname}):`, err?.message);
          }
          if (isImage) {
            try {
              // HEIC / oversize photos rejected by Claude — normalise
              // to JPEG ≤1600px first. See normaliseImageForClaude.
              const normalised = await normaliseImageForClaude(fileData, file.mimetype, file.originalname);
              const base64 = normalised.buffer.toString("base64");
              imageContentParts.push({
                type: "image_url",
                image_url: { url: `data:${normalised.mimeType};base64,${base64}`, detail: "auto" },
              });
            } catch (err: any) {
              console.error(`[ChatBGP Excel] Image read error (${file.originalname}):`, err?.message);
            }
          } else if (isAudioVideo) {
            documentTexts.push(`=== AUDIO/VIDEO FILE: ${file.originalname} ===\nFile URL: /api/chat-media/${chatMediaName}\nUse transcribe_audio with fileUrl="/api/chat-media/${chatMediaName}".`);
          } else {
            try {
              const text = await extractTextFromFile(file.path, file.originalname);
              documentTexts.push(`=== FILE: ${file.originalname} ===\n${text.slice(0, 15000)}`);
            } catch (err: any) {
              console.error(`[ChatBGP Excel] File extract error (${file.originalname}):`, err?.message);
            }
          }
        }
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          if (documentTexts.length > 0) {
            const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
            lastMsg.content = `${textContent}\n\n--- ATTACHED DOCUMENTS ---\n${documentTexts.join("\n\n")}`;
          }
          if (imageContentParts.length > 0) {
            const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
            lastMsg.content = [
              { type: "text" as const, text: textContent || "What do you see in this image?" },
              ...imageContentParts,
            ];
          }
        }
      }

      // Truncate excel context to leave room for other contexts + tools
      let safeExcelContext = excelContext || "";
      if (safeExcelContext.length > 60000) {
        safeExcelContext = safeExcelContext.substring(0, 60000) + "\n... (spreadsheet data truncated for size — full workbook metadata above is complete)\n";
      }

      // Lean mode: skip the firm-wide context builders (fetched on demand via
      // tools); the Excel add-in only needs its task-specific excelSupplement.
      const userId = req.session.userId!;
      const excelScopeCompanyId = await resolveCompanyScope(req).catch(() => null);

      let baseSystemPrompt: string;
      if (excelScopeCompanyId) {
        baseSystemPrompt = CLIENT_SYSTEM_PROMPT;
      } else {
        try { baseSystemPrompt = await buildSystemPrompt(); } catch { baseSystemPrompt = SYSTEM_PROMPT_FALLBACK; }
      }

      const excelSupplement = `

## EXCEL ADD-IN — you are the FULL ChatBGP, inside Excel
You're running in the Microsoft Excel task pane, but you are the SAME ChatBGP as the main app — the full brain, with all your BGP knowledge and tools: CRM (companies, properties, deals, contacts), SharePoint, property pathways, KYC, market data, news, document generation, sql_query, all of it. Answer strategy, market, CRM, deal and "tell me about X" questions as fully and thoughtfully as you would in the main app, using your tools to pull real BGP data. You are NOT a cut-down formula bot — don't reduce everything to formulas, and don't be terse when the question deserves a proper answer.

On top of that, you have live read/write access to the user's OPEN workbook:
- You see the workbook structure (all sheets, headers, dimensions) plus each sheet's data (provided below as "Workbook Data" when available — that's the whole workbook, not just the active sheet).
- You can READ ANY SHEET/RANGE ON DEMAND — emit a read action (below) and the add-in reads it live and sends it back next turn. ALWAYS read the sheets a formula will reference before writing it, so you use real cell addresses, never guesses.
- Cross-reference the spreadsheet against the CRM whenever the question touches BGP data — pull deal/property/pathway/company records with your tools rather than working only from the cells on screen.

### Writing to the open workbook
You CAN write formulas and values straight into the open workbook via Office.js — never say you can't. By default the add-in applies your write actions to the workbook AUTOMATICALLY the moment your reply arrives (the user sees "Applied N changes"); if they've switched auto-apply off, each action renders as an Apply button instead. Either way: when the user asks you to build / amend / fill in / add / update / populate the workbook, respond with one or more JSON action blocks and speak as if you are making the change ("Writing the uplift into Summary C10…"), not as if you're handing over homework. Always include the exact sheet + cell on every action — untargeted actions are never auto-applied:

\`\`\`json
{"action": "writeFormula", "sheet": "Summary", "cell": "C10", "formula": "=B10*(1+0.025)"}
\`\`\`
\`\`\`json
{"action": "writeValue", "sheet": "Summary", "cell": "A1", "value": "Investment Summary"}
\`\`\`

For a full model, emit the blocks in order (headers → assumptions → formulas → totals).

### Action types
- \`writeValue\` — literal value (string/number) into one cell
- \`writeFormula\` — formula (must start with =) into one cell
- \`readRange\` — read a range: \`{"action":"readRange","sheet":"TS","range":"A1:L60"}\`
- \`readSheet\` — read a whole sheet's used range: \`{"action":"readSheet","sheet":"Mthly_CF"}\`
Read actions are fulfilled automatically (the data returns next turn, no user click). Workflow for changing a model: emit read actions for the sheets you need → then write with the real addresses you found. Don't invent other verbs (\`highlightCell\`, \`setFormat\`, \`mergeCells\`, \`createSheet\`…) — the add-in drops them; write a label into an adjacent cell with \`writeValue\` instead.

### export_to_excel
Only when the user explicitly wants a SEPARATE downloadable file ("send me an Excel file", "export as xlsx"). Never for changes to the workbook that's already open.

### Response style — the user NEVER sees your JSON
Your JSON action blocks are stripped from the chat and applied to the workbook (automatically, or as Apply buttons), and read actions are fulfilled silently. So:
- **Match depth to the question.** Analysis, strategy, CRM, market, "tell me about this deal/property" → give a full, considered answer (you're the real ChatBGP, not a formula bot). "Build / amend / fill in the model" → lead with the JSON action blocks.
- Emit JSON action blocks as the ONLY machinery. Do NOT also print the formula in prose, in \`\`\`excel blocks, or in backticks — that duplicates what the applied change already shows and makes the reply read like code.
- For workbook edits keep the prose SHORT and human: one or two sentences saying what you're doing and anything the user must decide. No cell-by-cell narration, no restating the JSON, no "Let me now…" workings.
- Reference real cell addresses from the user's actual sheets (read the sheet first if you haven't seen it). UK English and UK number formatting.

${safeExcelContext ? `**Workbook Data (read live from the user's open Excel workbook — all sheets):**\n${safeExcelContext}\n` : "**Note:** No spreadsheet data was provided. If the user asks about their sheet, suggest the refresh button next to the input."}
`;

      // Lean context — keep the task-relevant Excel supplement; fetch the rest on demand.
      const dynamicContext = excelSupplement;
      const systemContent = baseSystemPrompt + dynamicContext;

      // Load all the tools the main ChatBGP has
      let { tools } = await getAvailableTools();
      if ((await clientChatGuard(req)).isClient) {
        tools = excelScopeCompanyId ? filterToolsForClientScope(tools) : [];
      }
      let msToken: string | null = null;
      try { msToken = await getValidMsToken(req); } catch {}

      // Run the agentic loop — same pattern as /api/chatbgp/chat-with-files
      const excelResolved = await resolveChatModel({ threadId: excelThreadId, override: excelSlashOverride });
      let convMessages: any[] = [
        { role: "system", content: systemContent },
        ...messages.slice(-20),
      ];
      let lastAction: any = null;
      let loopCount = 0;
      // Same permissive bounds as the main chat handler. Runaway-loop
      // guard at 100 iterations; the real cap is the 10-min deadline.
      const maxLoops = 100;
      const deadline = Date.now() + 10 * 60 * 1000;

      while (loopCount < maxLoops) {
        if (clientClosed || Date.now() > deadline) {
          console.log(`[ChatBGP Excel] Deadline/close after ${loopCount} loops`);
          break;
        }
        loopCount++;
        const isLastLoop = loopCount >= maxLoops;
        const loopOpts: any = {
          model: excelResolved.model,
          messages: convMessages,
          max_completion_tokens: 8192,
        };
        if (!isLastLoop && tools.length > 0) {
          loopOpts.tools = tools;
          loopOpts.tool_choice = "auto";
        }

        const completion = await callClaude(loopOpts);
        const message = completion.choices[0]?.message;
        if (!message) break;

        console.log(`[ChatBGP Excel] Loop ${loopCount}: tool_calls=${message.tool_calls?.length || 0}, has_content=${!!message.content}`);

        if (message.tool_calls && message.tool_calls.length > 0) {
          convMessages.push(message);
          const toolNames = (message.tool_calls as unknown as ToolCall[]).map(tc => tc.function.name);
          sendProgress(toolNames.length === 1 ? getToolProgressLabel(toolNames[0]) : `Running ${toolNames.length} operations...`);

          for (const tc of message.tool_calls as unknown as ToolCall[]) {
            if (clientClosed || Date.now() > deadline) {
              convMessages.push({ role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Ran out of time" }) });
              continue;
            }
            const tcName = tc.function.name;
            let tcArgs: any;
            try { tcArgs = JSON.parse(tc.function.arguments); } catch { tcArgs = {}; }
            try {
              // No artificial per-tool timeout. Normal Claude tool use
              // doesn't impose one — the tool either succeeds or fails
              // on its own merits. We keep ONE generous hard cap (10
              // min, matching the client) purely as a safety net for a
              // genuinely-hung tool (deadlocked query etc.); every
              // tool worth caring about has its own internal fetch /
              // abort handling well inside this. The previous 60s
              // default was clipping legitimate long-running work like
              // designed PDF generation and big SharePoint fetches.
              const toolResult = await withTimeout(
                executeAnyTool(tcName, tcArgs, req, msToken),
                10 * 60 * 1000,
                { data: { error: "Tool didn't return within 10 minutes — looks hung. The chat has a hard 10-min cap as a safety net." } }
              );
              if (toolResult.action) lastAction = toolResult.action;
              const resultStr = typeof toolResult.data === "string" ? toolResult.data : JSON.stringify(toolResult.data);
              convMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: resultStr.length > 80000 ? resultStr.slice(0, 80000) + "\n...[truncated — full result was " + resultStr.length + " chars]" : resultStr,
              });
            } catch (toolErr: any) {
              console.error(`[ChatBGP Excel] Tool ${tcName} error:`, toolErr?.message);
              convMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }),
              });
            }
          }
        } else {
          const reply = message.content || "Sorry, I couldn't generate a response.";
          clearInterval(heartbeat);
          try {
            res.write(`data: ${JSON.stringify({ reply, ...(lastAction ? { action: lastAction } : {}) })}\n\n`);
            res.end();
          } catch {}
          return;
        }
      }

      // Fell through the loop — write whatever's last
      clearInterval(heartbeat);
      try {
        res.write(`data: ${JSON.stringify({ reply: "This is taking longer than expected — try breaking your request into smaller steps.", partial: true, ...(lastAction ? { action: lastAction } : {}) })}\n\n`);
        res.end();
      } catch {}
    } catch (err: any) {
      console.error("[ChatBGP Excel] Error:", err?.message);
      clearInterval(heartbeat);
      try {
        res.write(`data: ${JSON.stringify({ reply: "Failed to get AI response. Please try again.", error: true })}\n\n`);
        res.end();
      } catch {}
    } finally {
      // Clean up uploaded temp files
      for (const f of uploadedFiles) {
        try { fs.unlinkSync(f.path); } catch {}
      }
    }
  });

  // ChatBGP inside PowerPoint — same brain + tools as the main app, plus the
  // ability to draft presentation-ready slide content and insert it into the
  // open deck. Mirrors /api/chatbgp/excel-chat; the only PowerPoint-specific
  // bits are the supplement and the `insertText` action (client-parsed, same
  // way Excel parses writeFormula/writeValue out of the reply).
  app.post("/api/chatbgp/powerpoint-chat", requireAuth, chatUpload.array("files", 20), async (req: Request, res: Response) => {
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: "AI API key not configured" });
    }

    const isMultipart = (req.headers["content-type"] || "").startsWith("multipart/form-data");
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];

    let messages: any[] = [];
    let pptContext: string | undefined;
    try {
      if (isMultipart) {
        messages = JSON.parse(req.body.messages || "[]");
        pptContext = req.body.pptContext || undefined;
      } else {
        messages = req.body.messages;
        pptContext = req.body.pptContext;
      }
    } catch {
      return res.status(400).json({ message: "Invalid messages format" });
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ message: "messages array required" });
    }
    if (messages.length > 40) {
      messages = [messages[0], ...messages.slice(-39)];
    }
    for (const m of messages) {
      if (!m || !["user", "assistant"].includes(m.role)) {
        return res.status(400).json({ message: "Each message must have role (user/assistant)" });
      }
      const contentLen = typeof m.content === "string" ? m.content.length : 0;
      if (contentLen > 50000) {
        return res.status(400).json({ message: "Message content too long (max 50000 chars)" });
      }
    }
    if (pptContext && (typeof pptContext !== "string" || pptContext.length > 100000)) {
      return res.status(400).json({ message: "pptContext must be a string under 100000 chars" });
    }

    // /opus or /sonnet slash-command interception (powerpoint-chat).
    const pptThreadId = typeof req.body.threadId === "string" ? req.body.threadId : null;
    let pptSlashOverride: "fable" | "opus" | "sonnet" | null = null;
    {
      const lastIdx = messages.length - 1;
      const lastText = lastIdx >= 0 && typeof messages[lastIdx]?.content === "string" ? messages[lastIdx].content : "";
      const slash = parseSlashCommand(lastText);
      if (slash.command) {
        await setThreadModel(pptThreadId, slash.command);
        if (slash.wasJustCommand) {
          return res.json({ reply: ackMessage(slash.command) });
        }
        pptSlashOverride = slash.command;
        messages[lastIdx] = { ...messages[lastIdx], content: slash.strippedContent };
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch {}
    }, 5000);

    let clientClosed = false;
    req.on("close", () => { clientClosed = true; clearInterval(heartbeat); });

    const sendProgress = (status: string) => {
      try { if (!clientClosed) res.write(`data: ${JSON.stringify({ progress: status })}\n\n`); } catch {}
    };

    try {
      const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic"];
      const AUDIO_VIDEO_EXTENSIONS = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma", ".mov", ".avi", ".mkv", ".wmv", ".flv"];
      const documentTexts: string[] = [];
      const imageContentParts: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];

      if (uploadedFiles.length > 0) {
        sendProgress(`Reading ${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"}...`);
        for (const file of uploadedFiles) {
          const ext = "." + (file.originalname.split(".").pop()?.toLowerCase() || "");
          const isImage = IMAGE_EXTENSIONS.includes(ext) || file.mimetype?.startsWith("image/");
          const isAudioVideo = AUDIO_VIDEO_EXTENSIONS.includes(ext) || file.mimetype?.startsWith("audio/") || file.mimetype?.startsWith("video/");
          const fileData = fs.readFileSync(file.path);
          const chatMediaName = `${Date.now()}-${path.basename(file.path)}${ext}`;
          const storageKey = `chat-media/${chatMediaName}`;
          try {
            await saveFile(storageKey, fileData, file.mimetype || "application/octet-stream", file.originalname);
          } catch (err: any) {
            console.error(`[ChatBGP PowerPoint] File DB save error (${file.originalname}):`, err?.message);
          }
          if (isImage) {
            try {
              const normalised = await normaliseImageForClaude(fileData, file.mimetype, file.originalname);
              const base64 = normalised.buffer.toString("base64");
              imageContentParts.push({
                type: "image_url",
                image_url: { url: `data:${normalised.mimeType};base64,${base64}`, detail: "auto" },
              });
            } catch (err: any) {
              console.error(`[ChatBGP PowerPoint] Image read error (${file.originalname}):`, err?.message);
            }
          } else if (isAudioVideo) {
            documentTexts.push(`=== AUDIO/VIDEO FILE: ${file.originalname} ===\nFile URL: /api/chat-media/${chatMediaName}\nUse transcribe_audio with fileUrl="/api/chat-media/${chatMediaName}".`);
          } else {
            try {
              const text = await extractTextFromFile(file.path, file.originalname);
              documentTexts.push(`=== FILE: ${file.originalname} ===\n${text.slice(0, 15000)}`);
            } catch (err: any) {
              console.error(`[ChatBGP PowerPoint] File extract error (${file.originalname}):`, err?.message);
            }
          }
        }
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          if (documentTexts.length > 0) {
            const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
            lastMsg.content = `${textContent}\n\n--- ATTACHED DOCUMENTS ---\n${documentTexts.join("\n\n")}`;
          }
          if (imageContentParts.length > 0) {
            const textContent = typeof lastMsg.content === "string" ? lastMsg.content : "";
            lastMsg.content = [
              { type: "text" as const, text: textContent || "What do you see in this image?" },
              ...imageContentParts,
            ];
          }
        }
      }

      let safePptContext = pptContext || "";
      if (safePptContext.length > 60000) {
        safePptContext = safePptContext.substring(0, 60000) + "\n... (slide text truncated for size)\n";
      }

      let baseSystemPrompt: string;
      try { baseSystemPrompt = await buildSystemPrompt(); } catch { baseSystemPrompt = SYSTEM_PROMPT_FALLBACK; }

      const pptSupplement = `

## POWERPOINT ADD-IN — you are the FULL ChatBGP, inside PowerPoint
You're running in the Microsoft PowerPoint task pane, but you are the SAME ChatBGP as the main app — the full brain, with all your BGP knowledge and tools: CRM (companies, properties, deals, contacts), SharePoint, property pathways, KYC, market data, comparables, news, document generation, sql_query, all of it. Answer strategy, market, CRM, deal and "tell me about X" questions as fully and thoughtfully as you would in the main app, using your tools to pull real BGP data. You are NOT a cut-down slide bot — don't be terse when the question deserves a proper answer.

You're here to help build a deck. Typical asks: "pull the comps for X and draft a slide", "summarise this deal for the investment committee", "three bullets on the tenant covenant", "what's our available space in Soho — make a slide". Use your tools to get the REAL BGP data first, then turn it into clean, presentation-ready slide copy.

### Inserting content into the open presentation
When the user wants something put ON a slide (draft / write / add / make a slide / insert / put this on a slide), respond with one or more JSON action blocks — the add-in renders an "Insert into slide" button per block (plus "Insert all"). The text drops into the currently selected text box / placeholder on the active slide:

\`\`\`json
{"action": "insertText", "text": "Investment Summary\\n• £4.2m lot size, 5.75% net initial yield\\n• 12-year unexpired term to M&S\\n• Soho — resilient rental growth"}
\`\`\`

Use \\n for line breaks and • for bullets. Keep slide text tight and scannable — a headline plus short bullets, not paragraphs. One block per slide's worth of content; for several slides, emit several blocks in order.

### Action type
- \`insertText\` — insert a block of text into the selected slide placeholder: \`{"action":"insertText","text":"..."}\`
Don't invent other verbs (\`addSlide\`, \`setLayout\`, \`insertImage\`, \`setFont\`…) — the add-in drops them. For multiple slides, emit multiple \`insertText\` blocks and remind the user to click into the target placeholder before inserting each.

### Response style
- **Match depth to the question.** Analysis / strategy / CRM / "tell me about this deal" → a full, considered answer (you're the real ChatBGP). "Draft a slide / write bullets / make a slide" → lead with the insertText block(s), each with a one-line note on what it covers.
- When you draft slide copy, ALWAYS emit it as an \`insertText\` block so it's one click to place — don't just paste the text and stop.
- UK English and UK number formatting. Keep it boardroom-clean.

${safePptContext ? `**Current slide / selection (read live from the open PowerPoint):**\n${safePptContext}\n` : "**Note:** No slide text was provided (the user may not have selected anything). Draft content freely; they'll click into a placeholder before inserting."}
`;

      const dynamicContext = pptSupplement;
      const systemContent = baseSystemPrompt + dynamicContext;

      let { tools } = await getAvailableTools();
      if ((await clientChatGuard(req)).isClient) tools = [];
      let msToken: string | null = null;
      try { msToken = await getValidMsToken(req); } catch {}

      const pptResolved = await resolveChatModel({ threadId: pptThreadId, override: pptSlashOverride });
      let convMessages: any[] = [
        { role: "system", content: systemContent },
        ...messages.slice(-20),
      ];
      let lastAction: any = null;
      let loopCount = 0;
      const maxLoops = 100;
      const deadline = Date.now() + 10 * 60 * 1000;

      while (loopCount < maxLoops) {
        if (clientClosed || Date.now() > deadline) {
          console.log(`[ChatBGP PowerPoint] Deadline/close after ${loopCount} loops`);
          break;
        }
        loopCount++;
        const isLastLoop = loopCount >= maxLoops;
        const loopOpts: any = {
          model: pptResolved.model,
          messages: convMessages,
          max_completion_tokens: 4096,
        };
        if (!isLastLoop && tools.length > 0) {
          loopOpts.tools = tools;
          loopOpts.tool_choice = "auto";
        }

        const completion = await callClaude(loopOpts);
        const message = completion.choices[0]?.message;
        if (!message) break;

        console.log(`[ChatBGP PowerPoint] Loop ${loopCount}: tool_calls=${message.tool_calls?.length || 0}, has_content=${!!message.content}`);

        if (message.tool_calls && message.tool_calls.length > 0) {
          convMessages.push(message);
          const toolNames = (message.tool_calls as unknown as ToolCall[]).map(tc => tc.function.name);
          sendProgress(toolNames.length === 1 ? getToolProgressLabel(toolNames[0]) : `Running ${toolNames.length} operations...`);

          for (const tc of message.tool_calls as unknown as ToolCall[]) {
            if (clientClosed || Date.now() > deadline) {
              convMessages.push({ role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Ran out of time" }) });
              continue;
            }
            const tcName = tc.function.name;
            let tcArgs: any;
            try { tcArgs = JSON.parse(tc.function.arguments); } catch { tcArgs = {}; }
            try {
              const toolResult = await withTimeout(
                executeAnyTool(tcName, tcArgs, req, msToken),
                10 * 60 * 1000,
                { data: { error: "Tool didn't return within 10 minutes — looks hung. The chat has a hard 10-min cap as a safety net." } }
              );
              if (toolResult.action) lastAction = toolResult.action;
              const resultStr = typeof toolResult.data === "string" ? toolResult.data : JSON.stringify(toolResult.data);
              convMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: resultStr.length > 80000 ? resultStr.slice(0, 80000) + "\n...[truncated — full result was " + resultStr.length + " chars]" : resultStr,
              });
            } catch (toolErr: any) {
              console.error(`[ChatBGP PowerPoint] Tool ${tcName} error:`, toolErr?.message);
              convMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }),
              });
            }
          }
        } else {
          const reply = message.content || "Sorry, I couldn't generate a response.";
          clearInterval(heartbeat);
          try {
            res.write(`data: ${JSON.stringify({ reply, ...(lastAction ? { action: lastAction } : {}) })}\n\n`);
            res.end();
          } catch {}
          return;
        }
      }

      clearInterval(heartbeat);
      try {
        res.write(`data: ${JSON.stringify({ reply: "This is taking longer than expected — try breaking your request into smaller steps.", partial: true, ...(lastAction ? { action: lastAction } : {}) })}\n\n`);
        res.end();
      } catch {}
    } catch (err: any) {
      console.error("[ChatBGP PowerPoint] Error:", err?.message);
      clearInterval(heartbeat);
      try {
        res.write(`data: ${JSON.stringify({ reply: "Failed to get AI response. Please try again.", error: true })}\n\n`);
        res.end();
      } catch {}
    } finally {
      for (const f of uploadedFiles) {
        try { fs.unlinkSync(f.path); } catch {}
      }
    }
  });

  app.get("/api/knowledge-base", requireAuth, async (_req: Request, res: Response) => {
    try {
      const items = await storage.getKnowledgeBaseItems();
      res.json({ items, folders: BGP_KNOWLEDGE_FOLDERS });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/knowledge-base/index", requireAuth, async (req: Request, res: Response) => {
    try {
      const msToken = await getValidMsToken(req);
      if (!msToken) {
        return res.status(400).json({ message: "Microsoft 365 not connected. Please connect via SharePoint page first." });
      }

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ message: "AI API key not configured" });
      }

      const folderUrl = req.body.folderUrl;
      const foldersToIndex = folderUrl
        ? [{ url: folderUrl, name: "Custom" }]
        : BGP_KNOWLEDGE_FOLDERS;

      let totalIndexed = 0, totalSkipped = 0, totalErrors = 0;
      const allFiles: string[] = [];

      for (const folder of foldersToIndex) {
        try {
          const result = await indexKnowledgeFolder(folder.url, msToken);
          totalIndexed += result.indexed;
          totalSkipped += result.skipped;
          totalErrors += result.errors;
          allFiles.push(...result.files);
          console.log(`[KB] Indexed folder "${folder.name}": ${result.indexed} files`);
        } catch (err: any) {
          console.error(`[KB] Error indexing folder "${folder.name}":`, err?.message);
          totalErrors++;
        }
      }

      res.json({
        success: true,
        indexed: totalIndexed,
        skipped: totalSkipped,
        errors: totalErrors,
        files: allFiles,
        message: `Indexed ${totalIndexed} files, skipped ${totalSkipped}, ${totalErrors} errors`,
      });
    } catch (err: any) {
      console.error("[KB] Index error:", err?.message);
      res.status(500).json({ message: "Failed to index knowledge base" });
    }
  });

  app.delete("/api/knowledge-base", requireAuth, async (_req: Request, res: Response) => {
    try {
      await storage.clearKnowledgeBase();
      res.json({ success: true, message: "Knowledge base cleared" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
