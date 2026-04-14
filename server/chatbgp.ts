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
import multer from "multer";
import mammoth from "mammoth";
import { getValidMsToken } from "./microsoft";
import { getFile, saveFile, findChatMediaByOriginalName } from "./file-storage";
import { escapeLike } from "./utils/escape-like";

const CHATBGP_MODEL = "claude-opus-4-6";        // Main chat: Opus for intelligence
const CHATBGP_OPUS_MODEL = "claude-opus-4-6";   // Same
const CHATBGP_HELPER_MODEL = "claude-haiku-4-5-20251001"; // Background tasks: Haiku for cost savings

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

async function generatePdfFromHtml(fnArgs: Record<string, any>): Promise<{ data: any; action?: any }> {
  const PDFDocument = (await import("pdfkit")).default;
  const crypto = (await import("crypto")).default;
  const { saveFile } = await import("./file-storage");

  const isLandscape = fnArgs.orientation === "landscape";
  const doc = new PDFDocument({
    size: "A4",
    layout: isLandscape ? "landscape" : "portrait",
    margins: { top: 70, bottom: 70, left: 55, right: 55 },
    info: { Title: fnArgs.title, Author: "Bruce Gillingham Pollard", Creator: "BGP Dashboard" },
    bufferPages: true,
  });

  // Platform-aware font paths (Linux: DejaVu, macOS: Helvetica built-in)
  const linuxFont = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const linuxFontBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  if (process.platform !== "linux" || !require("fs").existsSync(linuxFont)) {
    doc.registerFont("Body", "Helvetica");
    doc.registerFont("Body-Bold", "Helvetica-Bold");
  } else {
    doc.registerFont("Body", linuxFont);
    doc.registerFont("Body-Bold", linuxFontBold);
  }

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const pageW = isLandscape ? 842 : 595;
  const usableW = pageW - 110;
  const leftM = 55;

  function drawHeader() {
    doc.font("Body-Bold").fontSize(8).fillColor("#232323")
      .text("BRUCE GILLINGHAM POLLARD", leftM, 25, { width: usableW, align: "left" });
    doc.moveTo(leftM, 40).lineTo(leftM + usableW, 40).strokeColor("#232323").lineWidth(0.5).stroke();
  }

  function drawFooter(pageNum: number, totalPages: number) {
    const bottomY = isLandscape ? 555 : 790;
    doc.font("Body").fontSize(7).fillColor("#999999")
      .text("Bruce Gillingham Pollard \u2014 Confidential", leftM, bottomY, { width: usableW * 0.6 })
      .text(`Page ${pageNum} of ${totalPages}`, leftM, bottomY, { width: usableW, align: "right" });
  }

  function newPage(): number { doc.addPage(); drawHeader(); return 60; }

  drawHeader();
  let y = 60;

  const htmlContent = fnArgs.htmlContent as string;

  const headingMatches: Array<{ text: string; level: number }> = [];
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(htmlContent)) !== null) {
    headingMatches.push({
      text: sanitiseForPdf(hMatch[2].replace(/<[^>]+>/g, "").trim()),
      level: parseInt(hMatch[1]),
    });
  }

  const processed = htmlContent
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  \u2022 ")
    .replace(/<hr[^>]*>/gi, "\n---\n")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "$1")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "$1")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "$1")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "$1")
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1");

  let plainText = processed
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, " \u2014 ")
    .replace(/&ndash;/gi, " \u2013 ")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  plainText = sanitiseForPdf(plainText);

  const paragraphs = plainText.split("\n");
  const numberedRegex = /^(\d+)[.)]\s+(.+)/;
  const bottomLimit = isLandscape ? 530 : 760;
  let firstHeadingDone = false;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) { y += 6; continue; }

    if (y > bottomLimit) y = newPage();

    const matchedHeading = headingMatches.find(h => trimmed === h.text);

    if (trimmed === "---") {
      y += 4;
      doc.moveTo(leftM, y).lineTo(leftM + usableW, y).strokeColor("#cccccc").lineWidth(0.3).stroke();
      y += 8;
    } else if (matchedHeading) {
      const level = matchedHeading.level;
      if (!firstHeadingDone) {
        firstHeadingDone = true;
        y += 4;
        doc.font("Body-Bold").fontSize(20).fillColor("#1a1a1a")
          .text(trimmed, leftM, y, { width: usableW });
        y = doc.y + 14;
      } else {
        const fontSize = level <= 1 ? 15 : level === 2 ? 13 : level === 3 ? 11.5 : 10.5;
        const spaceBefore = level <= 1 ? 16 : level === 2 ? 12 : 8;
        y += spaceBefore;
        if (y > bottomLimit) y = newPage();
        doc.font("Body-Bold").fontSize(fontSize).fillColor("#1a1a1a")
          .text(trimmed, leftM, y, { width: usableW });
        y = doc.y + 6;
      }
    } else if (trimmed.startsWith("\u2022") || trimmed.startsWith("  \u2022")) {
      const bulletText = trimmed.replace(/^\s*\u2022\s*/, "");
      doc.font("Body").fontSize(10).fillColor("#333333");
      doc.text("\u2022  " + bulletText, leftM + 8, y, { width: usableW - 16, indent: 0 });
      y = doc.y + 3;
    } else if (numberedRegex.test(trimmed)) {
      const nMatch = trimmed.match(numberedRegex)!;
      const num = nMatch[1];
      const text = nMatch[2];
      doc.font("Body").fontSize(10).fillColor("#333333");
      doc.text(`${num}.  ${text}`, leftM + 4, y, { width: usableW - 8 });
      y = doc.y + 3;
    } else {
      doc.font("Body").fontSize(10).fillColor("#333333")
        .text(trimmed, leftM, y, { width: usableW });
      y = doc.y + 4;
    }
  }

  const range = doc.bufferedPageRange();
  const totalPages = range.start + range.count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    drawFooter(i + 1, totalPages);
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  const pdfBuffer = Buffer.concat(chunks);

  const safeName = (fnArgs.title as string).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
  const uniqueId = crypto.randomBytes(8).toString("hex");
  const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.pdf`;
  await saveFile(`chat-media/${storageFilename}`, pdfBuffer, "application/pdf", `${safeName}.pdf`);
  const downloadUrl = `/api/chat-media/${storageFilename}`;

  return {
    data: {
      success: true,
      downloadUrl,
      filename: `${safeName}.pdf`,
      pages: totalPages,
      action: "pdf_generated",
      downloadMarkdown: `[Download ${safeName}.pdf](${downloadUrl})`,
      instruction: "IMPORTANT: Include the downloadMarkdown text EXACTLY as-is in your response so the user can download the file.",
    },
    action: { type: "download", url: downloadUrl, filename: `${safeName}.pdf` },
  };
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
    property_lookup: "Looking up property data...",
    property_data_lookup: "Querying PropertyData...",
    deep_investigate: "Running deep investigation...",
    run_kyc_check: "Running KYC check...",
    create_deal: "Creating deal...",
    update_deal: "Updating deal...",
    create_contact: "Creating contact...",
    update_contact: "Updating contact...",
    create_company: "Creating company...",
    update_company: "Updating company...",
    create_property: "Creating property...",
    create_requirement: "Logging requirement...",
    create_available_unit: "Creating unit...",
    update_available_unit: "Updating unit...",
    create_investment_tracker: "Adding to tracker...",
    update_investment_tracker: "Updating tracker...",
    send_email: "Sending email...",
    reply_email: "Replying to email...",
    search_emails: "Searching emails...",
    query_calendar: "Checking calendar...",
    query_wip: "Querying pipeline...",
    query_xero: "Looking up invoices...",
    export_to_excel: "Generating Excel file...",
    generate_pdf: "Generating PDF...",
    generate_word: "Generating Word document...",
    generate_pptx: "Generating PowerPoint...",
    generate_document: "Generating document...",
    generate_image: "Generating image...",
    browse_sharepoint_folder: "Browsing SharePoint...",
    read_sharepoint_file: "Reading file...",
    search_news: "Searching news...",
    search_green_street: "Searching Green Street...",
    query_leasing_schedule: "Querying leasing schedule...",
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
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
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
      if (msg.tool_calls && msg.tool_calls.length > 0) {
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

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 4000, 8000];

  let response: any;
  let lastErr: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = attempt === 0 ? anthropic : getAnthropicClient(false);
      if (attempt > 0) claudeParams.model = model;
      response = await client.messages.create(claudeParams);
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

  return {
    choices: [{
      message: {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
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

  const MAX_RETRIES = 2;
  const RETRY_DELAYS = [2000, 4000];

  let lastErr: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = attempt === 0 ? anthropic : getAnthropicClient(false);
      if (attempt > 0) claudeParams.model = model;

      let fullText = "";
      const toolCalls: any[] = [];

      const stream = client.messages.stream(claudeParams);

      stream.on("text", (text) => {
        fullText += text;
        onDelta(text);
      });

      const finalMessage = await stream.finalMessage();

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

      return {
        choices: [{
          message: {
            role: "assistant",
            content: fullText || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
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

## Key Tool Workflows
- **CRM**: search_crm (fuzzy matching) → create/update entities. Search broadly with multiple variations before saying something doesn't exist.
- **Property onboarding**: Read document → create_property with full address → auto Land Registry enrichment runs in background.
- **KYC**: run_kyc_check for Companies House + sanctions + financial strength. deep_investigate for full D&B-style intelligence combining all sources.
- **Web research**: web_search → ingest_url → property_data_lookup → property_lookup. Chain tools for comprehensive answers.
- **SharePoint**: read_sharepoint_file / browse_sharepoint_folder / move_sharepoint_item. Support both team SharePoint and personal OneDrive URLs. For subfolder navigation, use driveId+itemId from browse results, NOT webUrl.
- **Documents**: generate_pdf, generate_word, generate_pptx, export_to_excel. All include BGP branding. Proactively export tables to Excel.
- **Maps**: navigate_to "property-map" with lat/lng/zoom. Tell users to use built-in Radius/Distance buttons.
- **SharePoint folders**: Always create inside "BGP share drive" root. Team folders: Investment, London Leasing, etc.
- **deep_investigate**: If report.property.ambiguous === true, present options as numbered list and ask user to pick. Never guess.

## Memory Systems
1. **Auto-memories** (per-user): Extracted automatically after conversations. Loaded in future chats.
2. **Business learnings** (save_learning): Shared across all users. Save client intel, market knowledge, BGP processes, property insights, team preferences. Save when users teach you facts, correct you, or you discover important info via tools. Don't save greetings or CRM data that's already in the database.

## CRITICAL Rules
1. **ACT FIRST, REPORT AFTER.** Never ask "shall I proceed?" — just do it and confirm.
2. **Search broadly.** Try multiple name variations. "16 Tottenham Court Road" → "6-17 Tottenham Court Road" IS a match.
3. **Never ask for IDs.** Search by name, find the ID yourself.
4. **Only confirm when deleting** or genuinely ambiguous (3+ equal matches).
5. **Match response length to question.** CRM actions: 1-3 sentences. Research/strategy: full thoughtful answer.
6. **You CAN search the web, create any document, edit source code, move SharePoint files.** NEVER say you lack access.
7. **Bulk operations are fine.** Create 20 records without asking if they're sure.
8. **NEVER FAKE ACTIONS.** Only claim you read/created/saved something if there's a corresponding successful tool call. Never invent IDs or filenames. If a tool fails, say so honestly.
9. **Fix bugs yourself.** You have list_project_files, read_source_file, edit_source_file, restart_application. Never say "this needs a developer."
10. **log_app_feedback** is SECONDARY only. If user asks you to DO something, do it first.

## Response Format
- **Tone**: Confident, warm, professional. British English. Like a senior property partner.
- **CRM actions**: Brief confirmation. No preamble.
- **Research**: Match the question's depth. Headings/bullets/tables when genuinely useful; flowing prose when it reads better. Don't over-structure.
- **Checkbox suggestions**: Only when the user faces a genuine multi-option decision (e.g. picking between records, choosing an action). Never append them as ritual follow-up questions. If the answer is complete, just stop.
- **Silent execution**: Don't narrate tool calls. Execute all, then give one clean answer.
- **Proactive cross-referencing**: Connect dots from CRM context. Surface opportunities.
- **Commercial awareness**: Contextualise rents/yields with market comparisons.

## You Are Claude — No Limits
General-purpose AI with property expertise. Writing, analysis, research, strategy, coding, maths, languages, legal summaries — anything Claude can do. NEVER refuse because it's "outside scope."

## Dashboard Features
- **Auto-Match**: Sparkles button on requirements/units matches by use/location/size.
- **Deal Timeline**: Chronological events on deal detail pages.
- **Property 360 Hub**: Matching requirements, comps, deals, news on property pages.
- **Daily Digest**: Stuck deals, KYC gaps, cooling contacts. Encourage daily checks.

## WIP/Deals Architecture
crm_deals IS the WIP source of truth. Status determines WIP stage automatically. Update deals → WIP Report updates automatically. Fee allocations (dealFeeAllocations) track per-agent billing.

## Frontend Sync Rules
CRM_OPTIONS (crm-options.ts) and color maps (deals.tsx) MUST stay in sync. Missing color map entry = invisible badge. When adding values: update options list → update color map → then update database.

## DB Column Names
Drizzle: camelCase (JS) = snake_case (SQL). dealType = deal_type, assetClass = asset_class, etc.`;





  setCache("systemPrompt", prompt, 10 * 60 * 1000);
  return prompt;
}

async function getMemoryContext(userId: string): Promise<string> {
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

async function extractAndSaveMemories(
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

export async function getCrmContext(): Promise<string> {
  const cached = getCached<string>("crmContext");
  if (cached) return cached;
  try {
    const [properties, deals, companies, contacts] = await Promise.all([
      withTimeout(storage.getCrmProperties(), 5000, []),
      withTimeout(storage.getCrmDeals(), 5000, []),
      withTimeout(storage.getCrmCompanies(), 5000, []),
      withTimeout(storage.getCrmContacts(), 5000, []),
    ]);

    let requirementsCtx = "";
    let unitsCtx = "";
    let investmentCtx = "";
    try {
      const [reqRows, invReqRows, unitRows, invRows, compRows] = await Promise.all([
        withTimeout(pool.query(`SELECT r.name, r.use, r.size, r.requirement_locations, r.under_offer, c.name as company_name 
          FROM crm_requirements_leasing r LEFT JOIN crm_companies c ON r.company_id = c.id 
          WHERE r.deal_id IS NULL ORDER BY r.created_at DESC LIMIT 25`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout(pool.query(`SELECT r.name, r.use_types as use, r.size_range as size, r.requirement_locations, r.requirement_types, c.name as company_name, r.status 
          FROM crm_requirements_investment r LEFT JOIN crm_companies c ON r.company_id = c.id 
          WHERE r.deal_id IS NULL ORDER BY r.created_at DESC LIMIT 15`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout(pool.query(`SELECT au.unit_name, au.use_class, au.sqft, au.asking_rent, au.marketing_status, au.location, p.name as property_name 
          FROM available_units au LEFT JOIN crm_properties p ON au.property_id = p.id 
          WHERE au.marketing_status IN ('Available', 'Under Offer') ORDER BY au.created_at DESC LIMIT 20`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout(pool.query(`SELECT asset_name as name, status, guide_price, address, asset_type, board_type FROM investment_tracker 
          WHERE status NOT IN ('Dead', 'Withdrawn') ORDER BY updated_at DESC LIMIT 15`), 3000, { rows: [] }).catch(() => ({ rows: [] })),
        withTimeout(pool.query(`SELECT tenant, name, area_location, headline_rent, rent_psf_nia, nia_sqft, use_class, transaction_type, lease_start 
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
        ctx += `- ${c.name}${c.company ? " @ " + c.company : ""}${c.email ? " (" + c.email + ")" : ""}${(c as any).title ? " — " + (c as any).title : ""}\n`;
      }
    }

    if (companies.length > 0) {
      ctx += "\n### Companies (latest 30)\n";
      for (const co of companies.slice(0, 30)) {
        ctx += `- ${co.name}${co.sector ? " [" + co.sector + "]" : ""}${(co as any).isClient ? " ★ Client" : ""}\n`;
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

const SYSTEM_PROMPT_FALLBACK = "You are ChatBGP, an AI assistant for Bruce Gillingham Pollard (BGP). You are powered by Claude Opus. IMPORTANT: If deep_investigate returns report.property.ambiguous === true, present the options as a numbered list and ask the user to pick the correct property. Do NOT guess or proceed with unverified property data.";

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
      description: "Create a folder in the BGP SharePoint site. All folders must be inside the 'BGP share drive' root folder. Team folders are at 'BGP share drive/Investment', 'BGP share drive/London Leasing', etc. Can create folders inside team folders or any existing folder by providing its path. Call multiple times for nested structures.",
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
            description: "A SharePoint sharing URL for a folder (e.g. https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/...) OR a folder path in the BGP SharePoint document library (e.g. 'Investment/Deal Files', 'London Leasing'). Use '/' to browse the root. When drilling into subfolders from a previous browse result, you can omit this and use driveId + itemId instead.",
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
            description: "The path to the destination folder where the item should be moved to (e.g. 'Investment/New Folder', 'London Leasing/Active Deals'). Use '/' for root.",
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
      description: "Upload a file to a specific folder in BGP SharePoint. Use when you need to save a generated file (Excel export, document, etc.) to a SharePoint folder. The file must already exist as a chat-media file (e.g. from export_to_excel). Provide the chat-media filename and the destination folder path.",
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: {
            type: "string",
            description: "The filename from chat-media storage (e.g. '1774348793476-f3ddbf080ba7fd73-Travelodge_Comps.xlsx'). This is the filename portion from the /api/chat-media/ URL.",
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
      description: "Create a new deal in the BGP CRM. Use when the user asks to add a deal, log a transaction, or start tracking a new piece of work.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Deal name (usually the property address)" },
          team: { type: "array", items: { type: "string" }, description: "Team(s): London Leasing, National Leasing, Investment, Tenant Rep, Development, Lease Advisory, Office / Corporate" },
          groupName: { type: "string", description: "Pipeline stage: Under Offer, Exchanged, Completed, New Instructions, etc." },
          dealType: { type: "string", description: "Type: Letting, Acquisition, Sale, Lease Renewal, Rent Review" },
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
          currentRent: { type: "number" },
          ervPa: { type: "number" },
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
      description: "Look up comprehensive property information by property name, address, place name, or postcode. Aggregates data from multiple sources: EPC energy ratings, VOA rateable values, HMLR price paid transaction history, Environment Agency flood risk, Historic England listed buildings, and planning designations (conservation areas, article 4 directions, tree preservation orders, scheduled monuments). Use when the user asks about a property, wants to research an address, or needs property intelligence. You can pass just a property/place name (e.g. 'Harrods', '10 Downing Street', 'One Hyde Park') and the system will automatically find the postcode.",
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
      name: "generate_pdf",
      description: "Generate a professional PDF document from HTML content and save it as a downloadable file. Use this when the user asks for a PDF, report, or printable document. The HTML content will be converted to a clean, branded PDF with BGP header and page numbers. Returns a download link.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title for the PDF filename and header" },
          htmlContent: { type: "string", description: "Full HTML content to render in the PDF. Use <h1>-<h4> for headings, <p> for paragraphs, <ul>/<li> for bullet points, and numbered steps as '1. Step text'. Use <strong> for emphasis. Keep formatting clean and professional. Do NOT use emoji characters — they will not render correctly in the PDF font. Instead use plain text labels like 'Tip:', 'Important:', 'Note:' etc." },
          orientation: { type: "string", enum: ["portrait", "landscape"], description: "Page orientation. Default portrait." },
        },
        required: ["title", "htmlContent"],
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
      description: "Generate a native Microsoft PowerPoint (.pptx) presentation with professional formatting and BGP branding. Use when the user asks for a PowerPoint, presentation, slides, or deck.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Presentation title for the filename and title slide" },
          subtitle: { type: "string", description: "Optional subtitle for the title slide" },
          slides: {
            type: "array",
            description: "Array of slides to include in the presentation",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Slide title" },
                bullets: { type: "array", items: { type: "string" }, description: "Array of bullet point texts for the slide" },
                notes: { type: "string", description: "Optional speaker notes for the slide" },
                table: {
                  type: "object",
                  description: "Optional table to display on the slide",
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
        required: ["title", "slides"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "send_email",
      description: "Send a NEW email from the BGP shared mailbox (chatbgp@brucegillinghampollard.com). Use ONLY for brand new emails, NOT for replying to existing threads. For replies, use reply_email instead to preserve email threading.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (HTML supported)" },
          cc: { type: "string", description: "CC email address (optional)" },
        },
        required: ["to", "subject", "body"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "reply_email",
      description: "Reply to an existing email thread in the BGP shared mailbox. Use this INSTEAD of send_email when responding to an email the user received. This preserves the email thread/conversation. You MUST provide the messageId from the email context (the [msgId:...] tag). The reply is sent from chatbgp@brucegillinghampollard.com and goes to the original sender, preserving the full thread.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Graph API message ID from the email context [msgId:...] tag. This is required to thread the reply correctly." },
          body: { type: "string", description: "The reply body (HTML supported). Write ONLY the new reply content — the original email thread is automatically included by Outlook." },
          cc: { type: "string", description: "Optional CC email address" },
        },
        required: ["messageId", "body"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "search_emails",
      description: "Search the user's Outlook inbox for emails matching a query. Returns up to 50 results. Use this when the user asks to find specific emails, conversations, or correspondence beyond the 15 most recent shown in context. Supports searching by keyword, sender name, subject, or date range.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — matches against subject, body, sender, and recipients. Use KQL syntax: e.g. 'from:john subject:proposal', 'hasattachment:true landsec', 'received>=2025-01-01'" },
          top: { type: "number", description: "Number of results to return (default 25, max 50)" },
        },
        required: ["query"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "get_email_attachments",
      description: "List the attachments on a specific email. Returns attachment names, IDs, content types, and sizes. Use this when the user asks about an attachment on an email — you'll need the msgId from the email context or search results.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Graph API message ID from the email context [msgId:...] tag or from search_emails results." },
        },
        required: ["messageId"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "download_email_attachment",
      description: "Download and read the content of an email attachment. For text-based files (PDF, Word, Excel, CSV, text), returns the extracted text content so you can read and summarise it. For binary files, returns metadata and a download link. Use get_email_attachments first to get the attachment ID.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Graph API message ID of the email containing the attachment." },
          attachmentId: { type: "string", description: "The attachment ID from get_email_attachments results." },
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
          currentRent: { type: "number" },
          ervPa: { type: "number" },
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
          agent: { type: "string", description: "BGP agent responsible (e.g. 'Rupert', 'Lucy')" },
          assetClass: { type: "string", description: "e.g. Retail, Office, Residential, Mixed-Use, Leisure, Industrial" },
          tenure: { type: "string", description: "e.g. Freehold, Leasehold, Virtual Freehold" },
          sqft: { type: "number", description: "Size in square feet" },
          status: { type: "string", description: "e.g. Active, Pipeline, Completed" },
          notes: { type: "string" },
          folderTeams: { type: "array", items: { type: "string" }, description: "Teams this property belongs to e.g. ['London Leasing', 'Investment']" },
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
      name: "update_property",
      description: "Update an existing property in the CRM. Search first to find the property ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The property ID (UUID)" },
          name: { type: "string", description: "Property name" },
          address: { type: "object", description: "Address as JSON object with fields: street, city, postcode", properties: { street: { type: "string" }, city: { type: "string" }, postcode: { type: "string" } } },
          agent: { type: "string", description: "BGP agent responsible" },
          assetClass: { type: "string", description: "e.g. Retail, Office, Residential, Mixed-Use" },
          tenure: { type: "string", description: "e.g. Freehold, Leasehold" },
          sqft: { type: "number", description: "Size in square feet" },
          status: { type: "string", description: "e.g. Active, Pipeline, Completed" },
          notes: { type: "string" },
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
          sourceEvidence: { type: "string", enum: ["BGP Direct", "Opposing Agent", "Published", "EGi/CoStar", "Market Intel", "OneDrive Extract"], description: "Source of evidence" },
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

  tools.push({
    type: "function",
    function: {
      name: "edit_source_file",
      description: "Edit or create a project source file. Use when the user asks to change the app — add features, fix bugs, change UI, modify backend logic. The change is applied immediately and the app restarts. All changes are logged for rollback. IMPORTANT: Read the file first before editing to understand the existing code.",
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
          description: { type: "string", description: "Brief description of what this change does, for the audit log" },
        },
        required: ["filePath", "action", "description"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "run_shell_command",
      description: "Execute a shell command on the server. Use for database migrations (ALTER TABLE), installing packages (npm install), checking logs, or running scripts. Dangerous commands (rm -rf, git push --force, DROP DATABASE) are blocked. Output is captured and logged.",
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
      description: "Add a new column to an existing database table. A safe, targeted tool for extending the CRM schema. The column will automatically appear in search results and API responses. Use when the user says 'add a field for X' or 'I need to track Y on deals/contacts/properties'.",
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
      name: "restart_application",
      description: "Restart the BGP application after making code changes. Use after editing source files to apply the changes. The app typically restarts automatically, but use this if it doesn't or if the user reports issues.",
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
      description: "Save an image to the BGP Image Studio library. Can save: (1) an AI-generated image from a previous generate_image call by providing the imageUrl, or (2) a base64-encoded image directly. Use when the user wants to save a generated image, upload an image to the studio, or add an image to the library. The image will appear in the Image Studio with all metadata.",
      parameters: {
        type: "object",
        properties: {
          imageUrl: { type: "string", description: "URL of a previously generated image (from generate_image action), e.g. '/api/chat-media/xxx.png'" },
          base64Data: { type: "string", description: "Base64-encoded image data (alternative to imageUrl)" },
          mimeType: { type: "string", description: "MIME type if using base64Data, e.g. 'image/png', 'image/jpeg'" },
          fileName: { type: "string", description: "Name for the image file, e.g. 'Oxford Street Retail View'" },
          category: { type: "string", description: "Category: Exteriors, Interiors, Floor Plans, Properties, Areas, Marketing, Brands, Generated, Other", enum: ["Exteriors", "Interiors", "Floor Plans", "Properties", "Areas", "Marketing", "Brands", "Generated", "Other"] },
          description: { type: "string", description: "Optional description of the image" },
          area: { type: "string", description: "Optional area/location, e.g. 'West End', 'City of London'" },
          address: { type: "string", description: "Optional full address, e.g. '100 Oxford Street, London W1D 1LL'" },
          brandName: { type: "string", description: "Optional brand name (for Brands category), e.g. 'Pret A Manger'" },
          propertyType: { type: "string", description: "Optional property type", enum: ["Office", "Retail", "Industrial", "Warehouse", "Mixed Use", "Residential", "Restaurant", "Leisure", "Development", "Other"] },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for the image" },
        },
        required: ["fileName", "category"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "ingest_url",
      description: "Fetch and read content from an external URL — works with PDFs, research reports, and web pages. Use when the user shares a link and wants you to read, summarise, or add it to the news feed. Can also save the content as a news article.",
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
            description: "Which data to retrieve. Market: sold-prices, prices, prices-per-sqf, sold-prices-per-sqf, rents-commercial, yields, growth, growth-psf, demand, demand-rent, demographics, postcode-key-stats. Residential: rents, rents-hmo, tenure-types, property-types, floor-areas. Valuations: valuation-commercial-sale/rent, valuation-sale/rent. Local: ptal, crime, schools, internet-speed, restaurants, agents, area-type, council-tax, household-income, population, politics. Planning: planning-applications, conservation-area, green-belt, aonb, national-park, listed-buildings, flood-risk, freeholds, national-hmo-register. Property Intelligence: uprns, energy-efficiency, address-match-uprn, uprn, uprn-title, analyse-buildings, rebuild-cost. Land Registry: land-registry-documents (purchase Title Register and/or Title Plan by title number — costs £7.50+VAT per document)."
          },
          postcode: { type: "string", description: "UK postcode (full, district, or sector). e.g. W1K 3QB, SW1X, EC2A. Not required for 'uprn' endpoint." },
          address: { type: "string", description: "For address-match-uprn: the street address to match. e.g. '10 Lowndes Street'" },
          uprn: { type: "string", description: "For uprn and uprn-title endpoints: the UPRN number to look up." },
          title: { type: "string", description: "For analyse-buildings or land-registry-documents: the Land Registry title number. e.g. 'ON60618'" },
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
      name: "query_wip",
      description: "Query the WIP (Work In Progress) pipeline data. Use when the user asks about pipeline value, deal counts, team performance, overdue deals, or wants a summary of current deals. Can filter by team, status, or deal type.",
      parameters: {
        type: "object",
        properties: {
          team: { type: "string", description: "Filter by team: London Leasing, National Leasing, Investment, Tenant Rep, Development, Lease Advisory, Office / Corporate" },
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
      description: "Save a piece of business knowledge or insight that ChatBGP has learned during this conversation. This persists across all future conversations, making ChatBGP smarter about BGP's business over time. Only save genuinely useful, reusable knowledge — not transient details.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["client_intel", "market_knowledge", "bgp_process", "property_insight", "team_preference", "general"], description: "Category of the learning" },
          learning: { type: "string", description: "The specific knowledge or insight to remember. Be concise but include enough context to be useful in future conversations. E.g. 'The Cadogan Estate (SW1) prefer to deal directly with Charlotte Roberts for any leasing enquiries.'" },
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
      description: "Transcribe audio or video files to text using AI speech recognition (Whisper). Use when a user uploads a voice note, meeting recording, Teams recording, or any audio/video file and wants it transcribed. Supports MP3, MP4, M4A, WAV, WEBM, OGG, and other common formats. After transcription, you can use the transcript to update CRM deals, create diary notes, log viewings, update trackers, or take any follow-up actions the user requests.",
      parameters: {
        type: "object",
        properties: {
          fileUrl: { type: "string", description: "URL path to the audio/video file (e.g. '/api/chat-media/filename.mp4' for uploaded files, or a full URL for external files)" },
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
      description: "Send a WhatsApp message to a phone number. Use when the user asks you to message someone on WhatsApp. The message is sent from the BGP business WhatsApp number. Always confirm with the user before sending.",
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
      description: "Run a deep intelligence investigation on a company, person, and/or property. Combines Companies House (full profile, officers, PSCs, corporate ownership chain, ultimate parent/brand identification), Apollo.io (contact details — emails, phone numbers, LinkedIn), UK Sanctions List screening, web search (recent news and activity), and CRM cross-referencing into a comprehensive intelligence report. Use when someone asks to 'investigate', 'dig into', 'research', 'find out about', 'who owns', 'who to contact', 'find the owner', 'known associates', 'deep dive', or wants to find key decision-makers and contact routes for a company, person, or property. This is the D&B-style corporate intelligence tool. When a property address is provided, it will trace ownership back through SPVs to the real owner, find all associated people and companies, and suggest who to speak to about acquiring or managing the property.",
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
    const { getMicrosoftToken } = await import("./microsoft");
    const msToken = await getMicrosoftToken();
    if (msToken) {
      const SP_HOST = "brucegillinghampollard.sharepoint.com";
      const SP_SITE = "/sites/BGPsharedrive";
      const siteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE}`, { headers: { Authorization: `Bearer ${msToken}` } });
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


const SHAREPOINT_HOST = "brucegillinghampollardlimited.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/BGP";

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
  const supportedExts = [".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc", ".pptx"];
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
    const tempPath = path.join(tempDir, `kb-${Date.now()}-${fileName}`);
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
      const tmpPath = path.join(process.cwd(), "ChatBGP", `tmp-sp-${Date.now()}-${fileName}`);
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
    const supportedExts = [".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc"];
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
    const tempPath = path.join(tempDir, `sp-${Date.now()}-${fileName}`);
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

  if ([".csv", ".txt", ".doc"].includes(ext)) {
    return fs.readFileSync(filePath, "utf-8");
  }

  throw new Error(`Unsupported file format: ${ext}`);
}

const CHAT_UPLOADS_DIR = path.join(process.cwd(), "ChatBGP", "chat-files");

async function executeCrmToolRaw(
  fnName: string,
  fnArgs: any,
  req: Request
): Promise<{ data: any; action?: any }> {
  const { db } = await import("./db");
  const { pool } = await import("./db");

  if (fnName === "search_crm") {
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
      results.deals = await db.select({ id: crmDeals.id, name: crmDeals.name, groupName: crmDeals.groupName, status: crmDeals.status }).from(crmDeals).where(buildOr([crmDeals.name, crmDeals.comments])).limit(15);
    }
    if (entityType === "all" || entityType === "contacts") {
      results.contacts = await db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, role: crmContacts.role }).from(crmContacts).where(buildOr([crmContacts.name, crmContacts.email])).limit(15);
    }
    if (entityType === "all" || entityType === "companies") {
      const { and: andOp, eq: eqOp, ne: neOp } = await import("drizzle-orm");
      results.companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType }).from(crmCompanies).where(andOp(buildOr([crmCompanies.name]), neOp(crmCompanies.aiDisabled, true))).limit(15);
    }
    if (entityType === "all" || entityType === "properties") {
      const { sql: sqlTag } = await import("drizzle-orm");
      const addressText = sqlTag`${crmProperties.address}::text`;
      const propConditions: any[] = [];
      propConditions.push(ilike(crmProperties.name, exactQ));
      for (const wp of wordPatterns) propConditions.push(ilike(crmProperties.name, wp));
      propConditions.push(sqlTag`${addressText} ILIKE ${exactQ}`);
      for (const wp of wordPatterns) propConditions.push(sqlTag`${addressText} ILIKE ${wp}`);
      results.properties = await db.select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status, address: crmProperties.address }).from(crmProperties).where(or(...propConditions)).limit(15);
    }
    if (entityType === "all" || entityType === "investment") {
      results.investmentTracker = await db.select({ id: investmentTracker.id, assetName: investmentTracker.assetName, address: investmentTracker.address, status: investmentTracker.status, boardType: investmentTracker.boardType, client: investmentTracker.client }).from(investmentTracker).where(buildOr([investmentTracker.assetName, investmentTracker.address, investmentTracker.client, investmentTracker.vendor])).limit(15);
    }
    if (entityType === "all" || entityType === "units") {
      results.availableUnits = await db.select({ id: availableUnits.id, unitName: availableUnits.unitName, marketingStatus: availableUnits.marketingStatus, propertyId: availableUnits.propertyId }).from(availableUnits).where(buildOr([availableUnits.unitName])).limit(15);
    }
    if (entityType === "all" || entityType === "requirements") {
      const reqConds = [exactQ, ...wordPatterns].map((p, i) => `(company_name ILIKE $${i+1} OR contact_name ILIKE $${i+1} OR location ILIKE $${i+1} OR notes ILIKE $${i+1})`);
      const reqParams = [exactQ, ...wordPatterns];
      const reqResult = await pool.query(`SELECT id, category, company_name AS "companyName", contact_name AS "contactName", location, status, priority FROM requirements WHERE ${reqConds.join(" OR ")} LIMIT 15`, reqParams);
      results.requirements = reqResult.rows;
    }
    if (entityType === "all" || entityType === "comps") {
      const { crmComps } = await import("@shared/schema");
      results.comps = await db.select({ id: crmComps.id, name: crmComps.name, tenant: crmComps.tenant, landlord: crmComps.landlord, dealType: crmComps.dealType, headlineRent: crmComps.headlineRent, completionDate: crmComps.completionDate }).from(crmComps).where(buildOr([crmComps.name, crmComps.tenant, crmComps.landlord])).limit(15);
    }
    const totalFound = Object.values(results).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
    return { data: { success: true, query: fnArgs.query, totalFound, results } };
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

  if (fnName === "create_deal") {
    const { crmDeals } = await import("@shared/schema");
    const [created] = await db.insert(crmDeals).values({
      name: fnArgs.name,
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
    const { eq } = await import("drizzle-orm");
    let propertyId = fnArgs.propertyId;
    if (!propertyId && fnArgs.assetName) {
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
    }
    const [created] = await db.insert(investmentTracker).values({
      propertyId, assetName: fnArgs.assetName, address: fnArgs.address, status: fnArgs.status || "Reporting",
      boardType: fnArgs.boardType || "Purchases", client: fnArgs.client, clientContact: fnArgs.clientContact,
      vendor: fnArgs.vendor, vendorAgent: fnArgs.vendorAgent, guidePrice: fnArgs.guidePrice,
      niy: fnArgs.niy, eqy: fnArgs.eqy, sqft: fnArgs.sqft, currentRent: fnArgs.currentRent,
      ervPa: fnArgs.ervPa, tenure: fnArgs.tenure, fee: fnArgs.fee, feeType: fnArgs.feeType, notes: fnArgs.notes,
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
      agent: fnArgs.agent || null,
      assetClass: fnArgs.assetClass || null,
      tenure: fnArgs.tenure || null,
      sqft: fnArgs.sqft || null,
      status: fnArgs.status || "Active",
      notes: fnArgs.notes || null,
      folderTeams: fnArgs.folderTeams || null,
    }).returning();

    const propertyId = created[0].id;
    const postcode = fnArgs.address?.postcode;
    const willEnrich = !!(postcode && fnArgs.autoEnrich !== false);
    if (willEnrich) {
      const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
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
      fitoutContribution: fnArgs.fitoutContribution || null, sourceEvidence: fnArgs.sourceEvidence || null,
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
      await pool.query(`INSERT INTO ${mapping.table} (id, ${mapping.col1}, ${mapping.col2}) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [linkId, sourceId, targetId]);
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
      const output = execSync(cmd, { timeout: 5000 }).toString();
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

  if (fnName === "edit_source_file") {
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

    try {
      let beforeContent = "";
      try { beforeContent = fs.readFileSync(fullPath, "utf-8"); } catch {}

      let afterContent = "";

      if (action === "create") {
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        afterContent = fnArgs.content || fnArgs.replaceText || "";
        fs.writeFileSync(fullPath, afterContent, "utf-8");
      } else if (action === "append") {
        afterContent = beforeContent + "\n" + (fnArgs.replaceText || fnArgs.content || fnArgs.insertText || "");
        fs.writeFileSync(fullPath, afterContent, "utf-8");
      } else if (action === "replace") {
        if (!fnArgs.searchText) return { data: { success: false, error: "searchText is required for replace action" } };
        if (!beforeContent.includes(fnArgs.searchText)) {
          return { data: { success: false, error: `Could not find the search text in "${safePath}". Read the file first to get the exact content.` } };
        }
        afterContent = beforeContent.replace(fnArgs.searchText, fnArgs.replaceText || "");
        fs.writeFileSync(fullPath, afterContent, "utf-8");
      } else if (action === "insert") {
        const lines = beforeContent.split("\n");
        const insertAt = Math.max(0, (fnArgs.insertAtLine || 1) - 1);
        lines.splice(insertAt, 0, fnArgs.insertText || "");
        afterContent = lines.join("\n");
        fs.writeFileSync(fullPath, afterContent, "utf-8");
      } else {
        return { data: { success: false, error: `Unknown action "${action}"` } };
      }

      await pool.query(
        `INSERT INTO code_changes (tool_used, file_path, description, before_content, after_content, status) VALUES ($1, $2, $3, $4, $5, 'applied')`,
        ["edit_source_file", safePath, description, beforeContent.substring(0, 50000), afterContent.substring(0, 50000)]
      );

      return { data: { success: true, action: action, filePath: safePath, description, linesChanged: Math.abs(afterContent.split("\n").length - beforeContent.split("\n").length) } };
    } catch (err: any) {
      return { data: { success: false, error: `Failed to edit "${safePath}": ${err.message}` } };
    }
  }

  if (fnName === "run_shell_command") {
    const { execSync } = await import("child_process");
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
      const output = execSync(command, {
        cwd: process.cwd(),
        timeout: 30000,
        env: { ...process.env },
        maxBuffer: 1024 * 1024,
      }).toString();

      await pool.query(
        `INSERT INTO code_changes (tool_used, shell_command, shell_output, description, status) VALUES ($1, $2, $3, $4, 'applied')`,
        ["run_shell_command", command, output.substring(0, 10000), description]
      );

      return { data: { success: true, command, output: output.substring(0, 5000) } };
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
    const { execSync } = await import("child_process");
    try {
      execSync("kill -USR2 1 2>/dev/null || true", { timeout: 5000 });
      return { data: { success: true, message: "Application restart signal sent. The app will restart momentarily." } };
    } catch {
      return { data: { success: true, message: "Restart signal sent." } };
    }
  }

  if (fnName === "generate_image") {
    try {
      const prompt = String(fnArgs.prompt || "").substring(0, 1000);
      if (!prompt || prompt.length < 3) {
        return { data: { success: false, error: "Please provide a more detailed image description." } };
      }
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
      if (!apiKey || !baseUrl) {
        return { data: { success: false, error: "Image generation not configured" } };
      }
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
      const styleHint = fnArgs.style === "illustration" ? "digital illustration style, " :
                        fnArgs.style === "architectural" ? "architectural rendering style, " :
                        "photorealistic, professional photography, ";
      const fullPrompt = `${styleHint}${prompt}. High quality, professional, suitable for property marketing materials.`;
      console.log("[chatbgp] Generating image with Nano Banana:", fullPrompt.substring(0, 100));
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
      });
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

      let imageBuffer: Buffer;
      let ext = "png";

      if (imageUrl) {
        const fsModule = await import("fs");
        const pathModule = await import("path");
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
        return { data: { success: false, error: "Provide either imageUrl (from generate_image) or base64Data." } };
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
      const insertResult = await pool.query(
        `INSERT INTO image_studio_images (file_name, category, area, tags, description, source, width, height, file_size, thumbnail_data, local_path, uploaded_by, address, brand_name, property_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [fileName, category, area || null, tags, description || null, "chatbgp", width, height, imageBuffer.length, thumbnailData, localPath, sessionUserId, address || null, brandName || null, propertyType || null]
      );

      const imageId = insertResult.rows[0].id;
      console.log(`[chatbgp] Saved image to Image Studio: ${fileName} (id=${imageId}, ${(imageBuffer.length / 1024).toFixed(0)}KB)`);

      return { data: { success: true, imageId, fileName, category, message: `Image "${fileName}" saved to Image Studio in the ${category} category.` } };
    } catch (err: any) {
      console.error("[chatbgp] Save to Image Studio error:", err?.message);
      return { data: { success: false, error: `Failed to save to Image Studio: ${err?.message}` } };
    }
  }

  if (fnName === "web_search") {
    const searchQuery = fnArgs.query as string;
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      const searchRes = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15000),
      });
      const html = await searchRes.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const resultBlocks = html.split(/class="result\s/);
      for (let i = 1; i < resultBlocks.length && results.length < 8; i++) {
        const block = resultBlocks[i];
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
        const urlMatch = block.match(/class="result__url"[^>]*href="([^"]*)"/) || block.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/);
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//);
        if (titleMatch && urlMatch) {
          let resultUrl = urlMatch[1];
          if (resultUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
            resultUrl = decodeURIComponent(resultUrl.replace("//duckduckgo.com/l/?uddg=", ""));
          } else if (!resultUrl.startsWith("http")) {
            resultUrl = decodeURIComponent(resultUrl.trim());
            if (!resultUrl.startsWith("http")) resultUrl = "https://" + resultUrl;
          }
          results.push({
            title: titleMatch[1].trim(),
            url: resultUrl,
            snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim(),
          });
        }
      }
      if (results.length === 0) {
        return { data: { results: [], message: "No results found. Try a different search query." } };
      }
      console.log(`[ChatBGP] Web search for "${searchQuery}" returned ${results.length} results`);
      return { data: { results, query: searchQuery, resultCount: results.length } };
    } catch (err: any) {
      console.error("[chatbgp] Web search error:", err?.message);
      return { data: { error: `Web search failed: ${err?.message}` } };
    }
  }

  if (fnName === "ingest_url") {
    const targetUrl = fnArgs.url as string;
    try {
      const response = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGPBot/1.0)" },
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
        await parser.load();
        const textResult = await parser.getText();
        extractedText = textResult.pages.map((p: any) => p.text || "").join("\n\n");
        const info = await parser.getInfo();
        title = info?.info?.Title || targetUrl.split("/").pop()?.replace(/-/g, " ").replace(".pdf", "") || "PDF Document";
      } else {
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = titleMatch ? titleMatch[1].trim() : "Web Page";
        extractedText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
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

      return { data: { success: true, action: "ingested", title, contentLength: extractedText.length, content: truncated } };
    } catch (err: any) {
      return { data: { error: `Failed to ingest URL: ${err.message}` } };
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
    const ALLOWED_ENDPOINTS = new Set(["sold-prices", "prices", "prices-per-sqf", "sold-prices-per-sqf", "rents", "rents-commercial", "rents-hmo", "yields", "growth", "growth-psf", "planning-applications", "valuation-commercial-sale", "valuation-commercial-rent", "valuation-sale", "valuation-rent", "demand", "demand-rent", "demographics", "flood-risk", "floor-areas", "postcode-key-stats", "uprns", "energy-efficiency", "address-match-uprn", "uprn", "uprn-title", "analyse-buildings", "rebuild-cost", "ptal", "crime", "schools", "internet-speed", "restaurants", "conservation-area", "green-belt", "aonb", "national-park", "listed-buildings", "household-income", "population", "tenure-types", "property-types", "council-tax", "national-hmo-register", "freeholds", "politics", "agents", "area-type", "land-registry-documents"]);
    const endpoint = fnArgs.endpoint as string;
    if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) return { data: { error: `Invalid endpoint "${endpoint}". Allowed: ${[...ALLOWED_ENDPOINTS].join(", ")}` } };
    const postcode = (fnArgs.postcode as string || "").trim().replace(/\s{2,}/g, " ");
    const needsPostcode = !["uprn", "uprn-title", "analyse-buildings", "land-registry-documents"].includes(endpoint);
    if (needsPostcode && !postcode) return { data: { error: "Postcode is required." } };
    if (endpoint === "address-match-uprn" && !fnArgs.address) return { data: { error: "Both 'address' (street address, e.g. '10 Lowndes Street') and 'postcode' are required for address-match-uprn." } };
    if (endpoint === "land-registry-documents" && !fnArgs.title) return { data: { error: "Title number is required for land-registry-documents." } };
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
      if (endpoint === "land-registry-documents") {
        params.set("documents", (fnArgs.documents as string) || "both");
        params.set("extract_proprietor_data", fnArgs.extract_proprietor_data === false ? "false" : "true");
      }
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
        if (data.code === "2906" && data.document_url) return { data: { success: true, note: "Documents previously purchased", document_url: data.document_url, source: "PropertyData.co.uk", endpoint } };
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
    for (const d of deals) byStage[d.groupName || "Unknown"] = (byStage[d.groupName || "Unknown"] || 0) + 1;
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

  if (fnName === "generate_pdf") {
    try {
      return await generatePdfFromHtml(fnArgs);
    } catch (pdfErr: any) {
      console.error("[chatbgp] PDF generation error:", pdfErr?.message);
      return { data: { error: `Failed to generate PDF: ${pdfErr?.message || "Unknown error"}` } };
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
      const PptxGenJS = (await import("pptxgenjs")).default;
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");

      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Bruce Gillingham Pollard";
      pptx.company = "Bruce Gillingham Pollard";
      pptx.title = fnArgs.title as string;

      const titleSlide = pptx.addSlide();
      titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: "232323" } });
      titleSlide.addText("BRUCE GILLINGHAM POLLARD", { x: 0.8, y: 0.5, w: 8, h: 0.5, fontSize: 14, color: "AAAAAA", fontFace: "Calibri", bold: true });
      titleSlide.addText(fnArgs.title as string, { x: 0.8, y: 2.0, w: 10, h: 1.5, fontSize: 36, color: "FFFFFF", fontFace: "Calibri", bold: true });
      if (fnArgs.subtitle) {
        titleSlide.addText(fnArgs.subtitle as string, { x: 0.8, y: 3.5, w: 10, h: 0.8, fontSize: 18, color: "CCCCCC", fontFace: "Calibri" });
      }

      const slides = (fnArgs.slides as any[]) || [];
      for (const slideData of slides) {
        const slide = pptx.addSlide();
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: "232323" } });
        slide.addText("BGP", { x: 0.3, y: 0.15, w: 1, h: 0.5, fontSize: 12, color: "FFFFFF", fontFace: "Calibri", bold: true });
        slide.addText(slideData.title || "", { x: 0.5, y: 1.0, w: 11, h: 0.7, fontSize: 24, color: "232323", fontFace: "Calibri", bold: true });

        let yPos = 1.9;
        if (slideData.bullets && slideData.bullets.length > 0) {
          const bulletText = slideData.bullets.map((b: string) => ({ text: b, options: { fontSize: 14, color: "444444", fontFace: "Calibri", bullet: true, breakType: "n" as const, paraSpaceAfter: 6 } }));
          slide.addText(bulletText, { x: 0.8, y: yPos, w: 10.5, h: 4.0, valign: "top" });
          yPos += Math.min(slideData.bullets.length * 0.45, 4.0) + 0.3;
        }

        if (slideData.table && slideData.table.headers && slideData.table.rows) {
          const tableRows: any[][] = [];
          tableRows.push(slideData.table.headers.map((h: string) => ({ text: h, options: { bold: true, fontSize: 11, color: "FFFFFF", fill: { color: "232323" }, fontFace: "Calibri" } })));
          slideData.table.rows.forEach((row: string[], ri: number) => {
            tableRows.push(row.map((cell: string) => ({ text: cell, options: { fontSize: 10, color: "333333", fill: { color: ri % 2 === 0 ? "F5F5F5" : "FFFFFF" }, fontFace: "Calibri" } })));
          });
          slide.addTable(tableRows, { x: 0.5, y: yPos, w: 11.5, fontSize: 10, border: { type: "solid", pt: 0.5, color: "DDDDDD" } });
        }

        if (slideData.notes) {
          slide.addNotes(slideData.notes);
        }
      }

      const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
      const safeName = (fnArgs.title as string).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.pptx`;

      await saveFile(`chat-media/${storageFilename}`, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      return {
        data: {
          success: true, downloadUrl, filename: `${safeName}.pptx`, slides: slides.length + 1, action: "pptx_generated",
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

  if (fnName === "send_email") {
    try {
      const { sendSharedMailboxEmail } = await import("./shared-mailbox");
      await sendSharedMailboxEmail({
        to: fnArgs.to,
        subject: fnArgs.subject,
        body: fnArgs.body,
        cc: fnArgs.cc,
      });
      return { data: { success: true, action: "email_sent", to: fnArgs.to, subject: fnArgs.subject }, action: { type: "email_sent", to: fnArgs.to } };
    } catch (emailErr: any) {
      return { data: { error: `Failed to send email: ${emailErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "reply_email") {
    try {
      const { replyToSharedMailboxMessage } = await import("./shared-mailbox");
      const ccList = fnArgs.cc ? [fnArgs.cc] : undefined;
      await replyToSharedMailboxMessage(fnArgs.messageId, fnArgs.body, ccList);
      return { data: { success: true, action: "email_replied", messageId: fnArgs.messageId }, action: { type: "email_sent" } };
    } catch (replyErr: any) {
      return { data: { error: `Failed to reply to email: ${replyErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "search_emails") {
    try {
      const token = await getValidMsToken(req);
      if (!token) return { data: { error: "Not connected to Microsoft 365. Please sign in first." } };
      const searchQuery = fnArgs.query;
      const top = Math.min(fnArgs.top || 25, 50);
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const url = "https://graph.microsoft.com/v1.0/me/messages?" + new URLSearchParams({
        $search: `"${searchQuery}"`,
        $top: String(top),
        $select: "id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,conversationId",
        $orderby: "receivedDateTime desc",
      });
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const errText = await res.text();
        return { data: { error: `Email search failed: ${res.status} ${errText.slice(0, 200)}` } };
      }
      const data = await res.json();
      const messages = (data.value || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || "(No subject)",
        from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown",
        fromEmail: msg.from?.emailAddress?.address || "",
        to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", "),
        date: msg.receivedDateTime,
        preview: (msg.bodyPreview || "").slice(0, 200).replace(/\n/g, " "),
        isRead: msg.isRead,
        hasAttachments: msg.hasAttachments,
        msgId: msg.id,
      }));
      return { data: { results: messages, count: messages.length, query: searchQuery } };
    } catch (searchErr: any) {
      return { data: { error: `Email search error: ${searchErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "get_email_attachments") {
    try {
      const token = await getValidMsToken(req);
      if (!token) return { data: { error: "Not connected to Microsoft 365. Please sign in first." } };
      const msgId = encodeURIComponent(fnArgs.messageId);
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline`,
        { headers }
      );
      if (!graphRes.ok) {
        const errText = await graphRes.text();
        return { data: { error: `Failed to fetch attachments: ${graphRes.status} ${errText.slice(0, 200)}` } };
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
      const token = await getValidMsToken(req);
      if (!token) return { data: { error: "Not connected to Microsoft 365. Please sign in first." } };
      const action = fnArgs.action || "read";
      if (action === "save_to_sharepoint" && !fnArgs.folderPath) {
        return { data: { error: "folderPath is required when action is 'save_to_sharepoint'." } };
      }
      const msgId = encodeURIComponent(fnArgs.messageId);
      const attId = encodeURIComponent(fnArgs.attachmentId);
      const headers = { Authorization: `Bearer ${token}` };
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments/${attId}`,
        { headers }
      );
      if (!graphRes.ok) {
        const errText = await graphRes.text();
        return { data: { error: `Failed to download attachment: ${graphRes.status} ${errText.slice(0, 200)}` } };
      }
      const attachment = await graphRes.json();
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
        const uploadResult = await uploadFileToSharePoint(buffer, name, contentType || "application/octet-stream", fnArgs.folderPath);
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
          const ExcelJS = await import("exceljs");
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
      const ExcelJS = await import("exceljs");
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

      for (const sheet of sheets) {
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

      if (!fileUrl.startsWith("/api/chat-media/")) {
        return { data: { error: "Only uploaded chat-media files are supported. Please upload the file via the chat attachment button." } };
      }

      const tmpDir = path.join(process.cwd(), "ChatBGP", "transcribe-tmp");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const filename = fileUrl.replace("/api/chat-media/", "");
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const file = await getFile(`chat-media/${filename}`);
      if (!file) return { data: { error: "File not found in chat media" } };
      const allowedExts = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma", ".mov", ".avi", ".mkv", ".wmv", ".flv"];
      const ext = path.extname(safeFilename).toLowerCase() || ".mp4";
      if (!allowedExts.includes(ext)) return { data: { error: `Unsupported file type: ${ext}` } };
      const audioFilePath = path.join(tmpDir, `${tmpId}-source${ext}`);
      fs.writeFileSync(audioFilePath, file.data);
      tmpFiles.push(audioFilePath);

      const videoExts = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"];
      let whisperInputPath = audioFilePath;

      if (videoExts.includes(ext)) {
        const audioOutPath = path.join(tmpDir, `${tmpId}-audio.mp3`);
        tmpFiles.push(audioOutPath);
        try {
          execFileSync("ffmpeg", ["-i", audioFilePath, "-vn", "-acodec", "libmp3lame", "-ab", "64k", "-ar", "16000", "-ac", "1", "-y", audioOutPath], { timeout: 120000, stdio: "pipe" });
          whisperInputPath = audioOutPath;
        } catch (ffErr: any) {
          cleanupTmp();
          return { data: { error: `Failed to extract audio from video: ${ffErr?.message?.substring(0, 200)}` } };
        }
      }

      const fileStat = fs.statSync(whisperInputPath);
      const maxSize = 25 * 1024 * 1024;
      if (fileStat.size > maxSize) {
        let durationOutput: string;
        try {
          durationOutput = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", whisperInputPath], { timeout: 30000, stdio: "pipe" }).toString().trim();
        } catch {
          cleanupTmp();
          return { data: { error: "Could not determine audio duration" } };
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
            execFileSync("ffmpeg", ["-i", whisperInputPath, "-ss", String(start), "-t", String(segmentDuration), "-vn", "-acodec", "libmp3lame", "-ab", "64k", "-ar", "16000", "-ac", "1", "-y", segPath], { timeout: 60000, stdio: "pipe" });
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
        note: "This is an indicative assessment based on publicly available Companies House data. For definitive covenant checks, obtain and review the actual filed accounts or commission a credit report (D&B/Experian).",
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
        let downloadRes: Response;
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
        const fileName = filePath.split("/").pop() || "file";
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

                const body: Record<string, any> = { reveal_personal_emails: false, reveal_phone_number: false };
                if (firstName) body.first_name = firstName;
                if (lastName) body.last_name = lastName;
                body.organization_name = report.company.profile?.companyName || targetCompanyName;

                const apolloRes = await timedFetch("https://api.apollo.io/api/v1/people/match", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloApiKey },
                  body: JSON.stringify(body),
                });

                if (apolloRes.ok) {
                  const data = await apolloRes.json() as any;
                  if (data.person) {
                    apolloResults.push({
                      name: officer.name,
                      role: officer.role,
                      email: data.person.email,
                      phone: data.person.phone_numbers?.[0]?.sanitized_number,
                      title: data.person.title,
                      linkedin: data.person.linkedin_url,
                      city: data.person.city,
                      company: data.person.organization?.name,
                      companyWebsite: data.person.organization?.website_url,
                      companyLinkedin: data.person.organization?.linkedin_url,
                      companyIndustry: data.person.organization?.industry,
                      companySize: data.person.organization?.estimated_num_employees,
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
            const body: Record<string, any> = { reveal_personal_emails: false, reveal_phone_number: false };
            if (firstName) body.first_name = firstName;
            if (lastName) body.last_name = lastName;
            body.organization_name = targetCompanyName || companyName || "";

            const apolloRes = await timedFetch("https://api.apollo.io/api/v1/people/match", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloApiKey },
              body: JSON.stringify(body),
            });

            if (apolloRes.ok) {
              const data = await apolloRes.json() as any;
              if (data.person) {
                report.person.apolloProfile = {
                  email: data.person.email,
                  phone: data.person.phone_numbers?.[0]?.sanitized_number,
                  title: data.person.title,
                  linkedin: data.person.linkedin_url,
                  city: data.person.city,
                  company: data.person.organization?.name,
                  companyWebsite: data.person.organization?.website_url,
                  industry: data.person.organization?.industry,
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
    
    await db.insert(chatbgpLearnings).values({
      category: fnArgs.category || "general",
      learning: learningText,
      sourceUser: userId,
      sourceUserName: userName,
      confidence: "confirmed",
      active: true,
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
      const deals = await db.select({ id: crmDeals.id, name: crmDeals.name, groupName: crmDeals.groupName, status: crmDeals.status }).from(crmDeals).where(buildOr([crmDeals.name, crmDeals.comments])).limit(15);
      results.deals = deals;
    }
    if (entityType === "all" || entityType === "contacts") {
      const contacts = await db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, role: crmContacts.role }).from(crmContacts).where(buildOr([crmContacts.name, crmContacts.email])).limit(15);
      results.contacts = contacts;
    }
    if (entityType === "all" || entityType === "companies") {
      const companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType }).from(crmCompanies).where(buildOr([crmCompanies.name])).limit(15);
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
      const properties = await db.select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status, address: crmProperties.address }).from(crmProperties).where(or(...propConditions)).limit(15);
      results.properties = properties;
    }
    if (entityType === "all" || entityType === "investment") {
      const investments = await db.select({ id: investmentTracker.id, assetName: investmentTracker.assetName, address: investmentTracker.address, status: investmentTracker.status, boardType: investmentTracker.boardType, client: investmentTracker.client }).from(investmentTracker).where(buildOr([investmentTracker.assetName, investmentTracker.address, investmentTracker.client, investmentTracker.vendor])).limit(15);
      results.investmentTracker = investments;
    }
    if (entityType === "all" || entityType === "units") {
      const units = await db.select({ id: availableUnits.id, unitName: availableUnits.unitName, marketingStatus: availableUnits.marketingStatus, propertyId: availableUnits.propertyId }).from(availableUnits).where(buildOr([availableUnits.unitName])).limit(15);
      results.availableUnits = units;
    }
    if (entityType === "all" || entityType === "requirements") {
      const { pool } = await import("./db");
      const reqConds = [exactQ, ...wordPatterns].map((p: string, i: number) => `(company_name ILIKE $${i+1} OR contact_name ILIKE $${i+1} OR location ILIKE $${i+1} OR notes ILIKE $${i+1})`);
      const reqParams = [exactQ, ...wordPatterns];
      const reqResult = await pool.query(`SELECT id, category, company_name AS "companyName", contact_name AS "contactName", location, status, priority FROM requirements WHERE ${reqConds.join(" OR ")} LIMIT 15`, reqParams);
      results.requirements = reqResult.rows;
    }
    if (entityType === "all" || entityType === "comps") {
      const { crmComps } = await import("@shared/schema");
      results.comps = await db.select({ id: crmComps.id, name: crmComps.name, tenant: crmComps.tenant, landlord: crmComps.landlord, dealType: crmComps.dealType, headlineRent: crmComps.headlineRent, completionDate: crmComps.completionDate }).from(crmComps).where(buildOr([crmComps.name, crmComps.tenant, crmComps.landlord])).limit(15);
    }

    const totalFound = Object.values(results).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
    const reply = await summaryHelper({ success: true, query: fnArgs.query, totalFound, results });
    return { handled: true, response: { reply: reply || `Found ${totalFound} results for "${fnArgs.query}".` } };
  }

  if (fnName === "create_investment_tracker") {
    const { investmentTracker, crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    let propertyId = fnArgs.propertyId;
    if (!propertyId && fnArgs.assetName) {
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
      name: fnArgs.name, address: fnArgs.address || null, agent: fnArgs.agent || null,
      assetClass: fnArgs.assetClass || null, tenure: fnArgs.tenure || null, sqft: fnArgs.sqft || null,
      status: fnArgs.status || "Active", notes: fnArgs.notes || null, folderTeams: fnArgs.folderTeams || null,
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
      fitoutContribution: fnArgs.fitoutContribution || null, sourceEvidence: fnArgs.sourceEvidence || null,
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
        await pool.query(`INSERT INTO crm_contact_deals (id, contact_id, deal_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [linkId, sourceId, targetId]);
      } else if (linkType === "contact-property") {
        await pool.query(`INSERT INTO crm_contact_properties (id, contact_id, property_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [linkId, sourceId, targetId]);
      } else if (linkType === "contact-requirement") {
        await pool.query(`INSERT INTO crm_contact_requirements (id, contact_id, requirement_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [linkId, sourceId, targetId]);
      } else if (linkType === "company-property") {
        await pool.query(`INSERT INTO crm_company_properties (id, company_id, property_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [linkId, sourceId, targetId]);
      } else if (linkType === "company-deal") {
        await pool.query(`INSERT INTO crm_company_deals (id, company_id, deal_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [linkId, sourceId, targetId]);
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

  if (fnName === "web_search") {
    const searchQuery = fnArgs.query as string;
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(15000),
      });
      const html = await searchRes.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const resultBlocks = html.split(/class="result\s/);
      for (let i = 1; i < resultBlocks.length && results.length < 8; i++) {
        const block = resultBlocks[i];
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
        const urlMatch = block.match(/class="result__url"[^>]*href="([^"]*)"/) || block.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/);
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//);
        if (titleMatch && urlMatch) {
          let resultUrl = urlMatch[1];
          if (resultUrl.startsWith("//duckduckgo.com/l/?uddg=")) {
            resultUrl = decodeURIComponent(resultUrl.replace("//duckduckgo.com/l/?uddg=", ""));
          } else if (!resultUrl.startsWith("http")) {
            resultUrl = decodeURIComponent(resultUrl.trim());
            if (!resultUrl.startsWith("http")) resultUrl = "https://" + resultUrl;
          }
          results.push({
            title: titleMatch[1].trim(),
            url: resultUrl,
            snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim(),
          });
        }
      }
      console.log(`[ChatBGP] Web search for "${searchQuery}" returned ${results.length} results`);
      if (results.length === 0) {
        return { handled: true, response: { reply: `I searched the web for "${searchQuery}" but couldn't find relevant results. Let me try a different approach.` } };
      }
      const formatted = results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      const reply = await summaryHelper({ success: true, query: searchQuery, resultCount: results.length, results });
      return { handled: true, response: { reply: reply || `Found ${results.length} results for "${searchQuery}":\n\n${formatted}` } };
    } catch (err: any) {
      return { handled: true, response: { reply: `Sorry, the web search failed: ${err.message}` } };
    }
  }

  if (fnName === "ingest_url") {
    const targetUrl = fnArgs.url as string;
    try {
      const response = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGPBot/1.0)" },
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
        await parser.load();
        const textResult = await parser.getText();
        extractedText = textResult.pages.map((p: any) => p.text || "").join("\n\n");
        const info = await parser.getInfo();
        title = info?.info?.Title || targetUrl.split("/").pop()?.replace(/-/g, " ").replace(".pdf", "") || "PDF Document";
      } else {
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = titleMatch ? titleMatch[1].trim() : "Web Page";
        extractedText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
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
    const ALLOWED_ENDPOINTS = new Set(["sold-prices", "prices", "prices-per-sqf", "sold-prices-per-sqf", "rents", "rents-commercial", "rents-hmo", "yields", "growth", "growth-psf", "planning-applications", "valuation-commercial-sale", "valuation-commercial-rent", "valuation-sale", "valuation-rent", "demand", "demand-rent", "demographics", "flood-risk", "floor-areas", "postcode-key-stats", "uprns", "energy-efficiency", "address-match-uprn", "uprn", "uprn-title", "analyse-buildings", "rebuild-cost", "ptal", "crime", "schools", "internet-speed", "restaurants", "conservation-area", "green-belt", "aonb", "national-park", "listed-buildings", "household-income", "population", "tenure-types", "property-types", "council-tax", "national-hmo-register", "freeholds", "politics", "agents", "area-type", "land-registry-documents"]);
    const endpoint = fnArgs.endpoint as string;
    if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) return { handled: true, response: { reply: `Invalid endpoint "${endpoint}". Allowed: ${[...ALLOWED_ENDPOINTS].join(", ")}` } };
    const postcode = (fnArgs.postcode as string || "").trim().replace(/\s{2,}/g, " ");
    const needsPostcode = !["uprn", "uprn-title", "analyse-buildings", "land-registry-documents"].includes(endpoint);
    if (needsPostcode && !postcode) return { handled: true, response: { reply: "Postcode is required." } };
    if (endpoint === "address-match-uprn" && !fnArgs.address) return { handled: true, response: { reply: "Both 'address' (street address, e.g. '10 Lowndes Street') and 'postcode' are required for address-match-uprn." } };
    if (endpoint === "land-registry-documents" && !fnArgs.title) return { handled: true, response: { reply: "Title number is required for land-registry-documents." } };
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
      if (endpoint === "land-registry-documents") {
        params.set("documents", (fnArgs.documents as string) || "both");
        params.set("extract_proprietor_data", fnArgs.extract_proprietor_data === false ? "false" : "true");
      }
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
        if (data.code === "2906" && data.document_url) {
          return { handled: true, response: { reply: `These documents were previously purchased. Download link: ${data.document_url}` } };
        }
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
      byStage[d.groupName || "Unknown"] = (byStage[d.groupName || "Unknown"] || 0) + 1;
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

  if (fnName === "generate_pdf") {
    try {
      const result = await generatePdfFromHtml(fnArgs);
      const downloadUrl = result.data.downloadUrl;
      const safeName = result.data.filename;
      const downloadLink = `[Download ${safeName}](${downloadUrl})`;
      let reply = await summaryHelper({ success: true, downloadUrl, filename: safeName, pages: result.data.pages, action: "pdf_generated" });
      if (!reply || !reply.includes("/api/chat-media/")) reply = `Your PDF has been generated.\n\n${downloadLink}`;
      else if (!reply.includes(downloadUrl)) reply += `\n\n${downloadLink}`;
      return { handled: true, response: { reply, action: result.action } };
    } catch (pdfErr: any) {
      console.error("[chatbgp] PDF generation error:", pdfErr?.message);
      return { handled: true, response: { reply: `Failed to generate PDF: ${pdfErr?.message || "Unknown error"}` } };
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
      const PptxGenJS = (await import("pptxgenjs")).default;
      const crypto = (await import("crypto")).default;
      const { saveFile } = await import("./file-storage");

      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Bruce Gillingham Pollard";
      pptx.company = "Bruce Gillingham Pollard";
      pptx.title = fnArgs.title as string;

      const titleSlide = pptx.addSlide();
      titleSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: "232323" } });
      titleSlide.addText("BRUCE GILLINGHAM POLLARD", { x: 0.8, y: 0.5, w: 8, h: 0.5, fontSize: 14, color: "AAAAAA", fontFace: "Calibri", bold: true });
      titleSlide.addText(fnArgs.title as string, { x: 0.8, y: 2.0, w: 10, h: 1.5, fontSize: 36, color: "FFFFFF", fontFace: "Calibri", bold: true });
      if (fnArgs.subtitle) {
        titleSlide.addText(fnArgs.subtitle as string, { x: 0.8, y: 3.5, w: 10, h: 0.8, fontSize: 18, color: "CCCCCC", fontFace: "Calibri" });
      }

      const slides = (fnArgs.slides as any[]) || [];
      for (const slideData of slides) {
        const slide = pptx.addSlide();
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: "232323" } });
        slide.addText("BGP", { x: 0.3, y: 0.15, w: 1, h: 0.5, fontSize: 12, color: "FFFFFF", fontFace: "Calibri", bold: true });
        slide.addText(slideData.title || "", { x: 0.5, y: 1.0, w: 11, h: 0.7, fontSize: 24, color: "232323", fontFace: "Calibri", bold: true });

        let yPos = 1.9;
        if (slideData.bullets && slideData.bullets.length > 0) {
          const bulletText = slideData.bullets.map((b: string) => ({ text: b, options: { fontSize: 14, color: "444444", fontFace: "Calibri", bullet: true, breakType: "n" as const, paraSpaceAfter: 6 } }));
          slide.addText(bulletText, { x: 0.8, y: yPos, w: 10.5, h: 4.0, valign: "top" });
          yPos += Math.min(slideData.bullets.length * 0.45, 4.0) + 0.3;
        }

        if (slideData.table && slideData.table.headers && slideData.table.rows) {
          const tableRows: any[][] = [];
          tableRows.push(slideData.table.headers.map((h: string) => ({ text: h, options: { bold: true, fontSize: 11, color: "FFFFFF", fill: { color: "232323" }, fontFace: "Calibri" } })));
          slideData.table.rows.forEach((row: string[], ri: number) => {
            tableRows.push(row.map((cell: string) => ({ text: cell, options: { fontSize: 10, color: "333333", fill: { color: ri % 2 === 0 ? "F5F5F5" : "FFFFFF" }, fontFace: "Calibri" } })));
          });
          slide.addTable(tableRows, { x: 0.5, y: yPos, w: 11.5, fontSize: 10, border: { type: "solid", pt: 0.5, color: "DDDDDD" } });
        }

        if (slideData.notes) {
          slide.addNotes(slideData.notes);
        }
      }

      const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
      const safeName = (fnArgs.title as string).replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const storageFilename = `${Date.now()}-${uniqueId}-${safeName}.pptx`;

      await saveFile(`chat-media/${storageFilename}`, pptxBuffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", `${safeName}.pptx`);
      const downloadUrl = `/api/chat-media/${storageFilename}`;
      const downloadLink = `[📊 Download ${safeName}.pptx](${downloadUrl})`;
      let reply = await summaryHelper({ success: true, downloadUrl, filename: `${safeName}.pptx`, slides: slides.length + 1, action: "pptx_generated" });
      if (!reply || !reply.includes("/api/chat-media/")) reply = `Your PowerPoint has been generated with ${slides.length + 1} slides.\n\n${downloadLink}`;
      else if (!reply.includes(downloadUrl)) reply += `\n\n${downloadLink}`;
      return { handled: true, response: { reply, action: { type: "download", url: downloadUrl, filename: `${safeName}.pptx` } } };
    } catch (err: any) {
      console.error("[chatbgp] PowerPoint generation error:", err?.message);
      return { handled: true, response: { reply: `Failed to generate PowerPoint: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "send_email") {
    try {
      const { sendSharedMailboxEmail } = await import("./shared-mailbox");
      await sendSharedMailboxEmail({
        to: fnArgs.to,
        subject: fnArgs.subject,
        body: fnArgs.body,
        cc: fnArgs.cc,
      });
      const reply = await summaryHelper({ success: true, action: "email_sent", to: fnArgs.to, subject: fnArgs.subject });
      return { handled: true, response: { reply: reply || `Email sent to ${fnArgs.to}.`, action: { type: "email_sent", to: fnArgs.to } } };
    } catch (emailErr: any) {
      return { handled: true, response: { reply: `Failed to send email: ${emailErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "reply_email") {
    try {
      const { replyToSharedMailboxMessage } = await import("./shared-mailbox");
      const ccList = fnArgs.cc ? [fnArgs.cc] : undefined;
      await replyToSharedMailboxMessage(fnArgs.messageId, fnArgs.body, ccList);
      const reply = await summaryHelper({ success: true, action: "email_replied", messageId: fnArgs.messageId });
      return { handled: true, response: { reply: reply || "Reply sent successfully, threaded with the original email.", action: { type: "email_sent" } } };
    } catch (replyErr: any) {
      return { handled: true, response: { reply: `Failed to reply to email: ${replyErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "search_emails") {
    try {
      const token = await getValidMsToken(req);
      if (!token) return { handled: true, response: { reply: "Not connected to Microsoft 365. Please sign in first." } };
      const searchQuery = fnArgs.query;
      const top = Math.min(fnArgs.top || 25, 50);
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const url = "https://graph.microsoft.com/v1.0/me/messages?" + new URLSearchParams({
        $search: `"${searchQuery}"`,
        $top: String(top),
        $select: "id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,conversationId",
        $orderby: "receivedDateTime desc",
      });
      const searchRes = await fetch(url, { headers });
      if (!searchRes.ok) {
        const errText = await searchRes.text();
        return { handled: true, response: { reply: `Email search failed: ${searchRes.status} ${errText.slice(0, 200)}` } };
      }
      const data = await searchRes.json();
      const messages = (data.value || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || "(No subject)",
        from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown",
        fromEmail: msg.from?.emailAddress?.address || "",
        to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.name || r.emailAddress?.address).join(", "),
        date: msg.receivedDateTime,
        preview: (msg.bodyPreview || "").slice(0, 200).replace(/\n/g, " "),
        isRead: msg.isRead,
        hasAttachments: msg.hasAttachments,
        msgId: msg.id,
      }));
      const reply = await summaryHelper({ results: messages, count: messages.length, query: searchQuery });
      return { handled: true, response: { reply: reply || `Found ${messages.length} emails matching "${searchQuery}".` } };
    } catch (searchErr: any) {
      return { handled: true, response: { reply: `Email search error: ${searchErr?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "get_email_attachments") {
    try {
      const token = await getValidMsToken(req);
      if (!token) return { handled: true, response: { reply: "Not connected to Microsoft 365. Please sign in first." } };
      const msgId = encodeURIComponent(fnArgs.messageId);
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline`,
        { headers }
      );
      if (!graphRes.ok) {
        return { handled: true, response: { reply: `Failed to fetch attachments: ${graphRes.status}` } };
      }
      const data = await graphRes.json();
      const attachments = (data.value || [])
        .filter((a: any) => !a.isInline && a["@odata.type"] !== "#microsoft.graph.itemAttachment")
        .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
      const reply = await summaryHelper({ attachments, count: attachments.length });
      return { handled: true, response: { reply: reply || `Found ${attachments.length} attachment(s).` } };
    } catch (err: any) {
      return { handled: true, response: { reply: `Attachment list error: ${err?.message || "Unknown error"}` } };
    }
  }

  if (fnName === "download_email_attachment") {
    try {
      const token = await getValidMsToken(req);
      if (!token) return { handled: true, response: { reply: "Not connected to Microsoft 365. Please sign in first." } };
      const action = fnArgs.action || "read";
      if (action === "save_to_sharepoint" && !fnArgs.folderPath) {
        return { handled: true, response: { reply: "I need a SharePoint folder path to save the attachment. Could you tell me where you'd like it saved?" } };
      }
      const msgId = encodeURIComponent(fnArgs.messageId);
      const attId = encodeURIComponent(fnArgs.attachmentId);
      const headers = { Authorization: `Bearer ${token}` };
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments/${attId}`,
        { headers }
      );
      if (!graphRes.ok) {
        return { handled: true, response: { reply: `Failed to download attachment: ${graphRes.status}` } };
      }
      const attachment = await graphRes.json();
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
        const uploadResult = await uploadFileToSharePoint(buffer, name, contentType || "application/octet-stream", fnArgs.folderPath);
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
          const ExcelJS = await import("exceljs");
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
    
    await db.insert(chatbgpLearnings).values({
      category: fnArgs.category || "general",
      learning: learningText,
      sourceUser: userId,
      sourceUserName: userName,
      confidence: "confirmed",
      active: true,
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

  app.post("/api/chatbgp/chat-with-files", requireAuth, chatUpload.array("files", 20), async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    let messages: Array<{ role: "user" | "assistant"; content: any }> = [];
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
              const base64 = fileData.toString("base64");
              const mimeType = file.mimetype || "image/png";
              imageContentParts.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}`, detail: "auto" },
              });
            } catch (err: any) {
              console.error(`Chat image read error (${file.originalname}):`, err?.message);
            }
          } else if (isAudioVideo) {
            documentTexts.push(`=== AUDIO/VIDEO FILE: ${file.originalname} ===\nThis is an audio/video file uploaded by the user. File URL: /api/chat-media/${chatMediaName}\nUse the transcribe_audio tool with fileUrl="/api/chat-media/${chatMediaName}" to transcribe this recording. Then use the transcript to help the user with whatever they need — update trackers, create notes, log actions, etc.`);
          } else {
            try {
              const text = await extractTextFromFile(file.path, file.originalname);
              documentTexts.push(`=== FILE: ${file.originalname} ===\n${text.slice(0, 15000)}`);
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

      const { tools } = await getAvailableTools();

      const fileUserId = req.session.userId!;
      const [knowledgeContext, fileMemoryContext, fileEmailCalContext, fileCrmCtx, businessLearnings] = await Promise.all([
        withTimeout(getKnowledgeContext(), 8000, ""),
        withTimeout(getMemoryContext(fileUserId), 8000, ""),
        withTimeout(getEmailAndCalendarContext(req), 8000, ""),
        withTimeout(getCrmContext(), 8000, ""),
        withTimeout(getBusinessLearningsContext(), 8000, ""),
      ]);
      let systemPrompt: string;
      try {
        systemPrompt = await buildSystemPrompt();
      } catch {
        systemPrompt = SYSTEM_PROMPT_FALLBACK;
      }
      const systemContent = systemPrompt + knowledgeContext + businessLearnings + fileMemoryContext + fileEmailCalContext + fileCrmCtx;

      const completionOptions: any = {
        model: CHATBGP_MODEL,
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
          model: CHATBGP_MODEL,
          messages: convMessages,
          max_completion_tokens: 8192,
        };
        if (!isLastLoop) {
          loopOpts.tools = tools;
          loopOpts.tool_choice = "auto";
        }

        const completion = await callClaude(loopOpts);
        const message = completion.choices[0]?.message;
        if (!message) break;

        console.log(`[ChatBGP] File-chat loop ${loopCountFile}: tool_calls=${message.tool_calls?.length || 0}, has_content=${!!message.content}`);

        if (message.tool_calls && message.tool_calls.length > 0) {
          convMessages.push(message);

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
                content: resultStr.length > 12000 ? resultStr.slice(0, 12000) + "\n...[truncated]" : resultStr,
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
            return res.json({ reply: message.content, ...(lastActionFile ? { action: lastActionFile } : {}) });
          }
          convMessages.push(message);
          break;
        }
      }

      const lastAMsg = convMessages.filter((m: any) => m.role === "assistant" && m.content).pop();
      res.json({ reply: lastAMsg?.content || "I've processed your request. Please ask a follow-up for more details.", ...(lastActionFile ? { action: lastActionFile } : {}) });
    } catch (err: any) {
      console.error("ChatBGP file chat error:", err?.message || err);
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
          return res.json({ reply: retryContent });
        } catch {
          return res.json({ reply: "I wasn't able to process that image. Could you try sending it again, or let me know what you need help with?" });
        }
      }
      res.status(500).json({ message: "Failed to process chat with files" });
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
        if (!fileBuffer) return { data: { error: `File not found: ${chatMediaFilename}. It may have expired. Please regenerate the file and try again.` } };

        const spSiteRes = await fetch("https://graph.microsoft.com/v1.0/sites/brucegillinghampollard.sharepoint.com:/sites/BGPsharedrive", {
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
    // Everything else goes through executeCrmToolRaw (CRM, navigation, email, code tools, etc.)
    return executeCrmToolRaw(tcName, tcArgs, req);
  }

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

    const sendProgress = (status: string) => {
      safeSseWrite(`data: ${JSON.stringify({ progress: status })}\n\n`);
    };

    const sendDelta = (token: string) => {
      safeSseWrite(`data: ${JSON.stringify({ delta: token })}\n\n`);
    };

    const sseThreadId = result.data.threadId;

    let verifiedThreadId: string | null = null;
    if (sseThreadId) {
      try {
        const thread = await storage.getChatThread(sseThreadId);
        if (thread && thread.createdBy === req.session.userId) {
          verifiedThreadId = sseThreadId;
        } else {
          console.warn(`[ChatBGP] threadId ${sseThreadId} not owned by user ${req.session.userId}`);
        }
      } catch {}
    }

    const sendResult = async (data: any) => {
      clearInterval(heartbeat);
      let saved = false;
      if (verifiedThreadId && data.reply && !data.error) {
        try {
          await storage.createChatMessage({
            threadId: verifiedThreadId,
            role: "assistant",
            content: data.reply,
            actionData: data.action ? JSON.stringify(data.action) : undefined,
          });
          saved = true;
          console.log(`[ChatBGP] Saved assistant reply to thread ${verifiedThreadId} (${data.reply.length} chars)`);
        } catch (saveErr: any) {
          console.error(`[ChatBGP] Failed to save reply to thread:`, saveErr?.message);
        }
      }
      if (!safeSseWrite(`data: ${JSON.stringify({ ...data, savedToThread: saved })}\n\n`)) return;
      try { res.end(); } catch {}
    };

    const requestStart = Date.now();
    const REQUEST_DEADLINE_MS = 120000; // 120 seconds — stricter deadline with faster context loading
    let clientDisconnected = false;
    const isOverDeadline = () => clientDisconnected || Date.now() - requestStart > REQUEST_DEADLINE_MS;

    req.on("close", () => {
      clientDisconnected = true;
      clearInterval(heartbeat);
    });

    let conversationMessages: any[] = [];
    try {
      const { tools } = await getAvailableTools();
      const userId = req.session.userId!;
      // Load contexts with size limits and error handling
      let knowledgeContext2 = "";
      let memoryContext = "";
      let emailCalContext = "";
      let crmCtx = "";
      let businessLearnings2 = "";
      
      try {
        sendProgress("Gathering intelligence...");
        const contextResults = await Promise.all([
          withTimeout(getMemoryContext(userId), 3000, ""),
          withTimeout(getBusinessLearningsContext(), 3000, ""),
          withTimeout(getCrmContext(), 3000, ""),
          withTimeout(getKnowledgeContext(), 3000, ""),
          withTimeout(getEmailAndCalendarContext(req), 3000, ""),
        ]);
        memoryContext = contextResults[0];
        businessLearnings2 = contextResults[1];
        crmCtx = contextResults[2];
        knowledgeContext2 = contextResults[3];
        emailCalContext = contextResults[4];
        // Trim to stay under 120KB total context
        const totalLen = memoryContext.length + businessLearnings2.length + crmCtx.length + knowledgeContext2.length + emailCalContext.length;
        if (totalLen > 120000) {
          emailCalContext = emailCalContext.slice(0, Math.max(0, 120000 - totalLen + emailCalContext.length));
        }
      } catch (err) {
        console.error("Context loading error:", err);
      }
      let threadContext = "";
      let currentUserContext = "";
      try {
        const currentUser = await storage.getUser(userId);
        if (currentUser) {
          currentUserContext = `\n\n## Current User\nYou are speaking with **${currentUser.name}**${currentUser.department ? " (" + currentUser.department + " team)" : ""}${currentUser.role ? " — " + currentUser.role : ""}. Personalise your responses accordingly — use their name occasionally, and prioritise information relevant to their team.\n`;
        }
      } catch {}

      if (verifiedThreadId) {
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
              threadContext += `Asset class: ${prop.asset_class || "Unknown"} | Status: ${prop.status || "Unknown"}\n`;
              if (prop.tenure) threadContext += `Tenure: ${prop.tenure}\n`;
              if (prop.sqft) threadContext += `Total area: ${Number(prop.sqft).toLocaleString()} sqft\n`;
              threadContext += `Units: ${prop.unit_count} total, ${prop.available_count} available\n`;
              if (dealRows.rows.length > 0) {
                threadContext += `\n**Active deals on this property:**\n`;
                for (const d of dealRows.rows) {
                  threadContext += `- ${d.name} | ${d.deal_type || ""} | ${d.status} | Fee: ${d.fee ? "£" + Number(d.fee).toLocaleString() : "TBC"} | ${d.team || ""}\n`;
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
              if (deal.fee) threadContext += `Fee: £${Number(deal.fee).toLocaleString()}\n`;
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
      try {
        systemPrompt2 = await buildSystemPrompt();
      } catch {
        systemPrompt2 = SYSTEM_PROMPT_FALLBACK;
      }
      // Split system prompt: static (cacheable) vs dynamic (per-request)
      const dynamicContext = currentUserContext + threadContext + knowledgeContext2 + businessLearnings2 + memoryContext + emailCalContext + crmCtx;
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
      const processedMessages = await Promise.all(trimmedMessages.map(async (msg: any) => {
        if (msg.role !== "user" || typeof msg.content !== "string") return msg;
        const imageUrlPattern = /!\[([^\]]*)\]\((\/api\/chat-media\/[^)]+)\)/g;
        const matches = [...msg.content.matchAll(imageUrlPattern)];
        if (matches.length === 0) return msg;
        const textContent = msg.content.replace(imageUrlPattern, "").trim() || "What do you see in this image?";
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
              const base64 = imageData.toString("base64");
              contentParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "auto" } });
            }
          } catch (err: any) {
            console.error(`[ChatBGP] Failed to load pasted image ${filename}:`, err?.message);
          }
        }
        if (contentParts.length === 1) return msg;
        return { ...msg, content: contentParts };
      }));

      const completionOptions: any = {
        model: CHATBGP_MODEL,
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
      const maxLoops = 20;

      while (loopCount < maxLoops) {
        if (isOverDeadline()) {
          console.log(`[ChatBGP] Deadline reached after ${loopCount} loops`);
          const timeoutMsg = clientDisconnected
            ? "Connection lost. Please refresh and try again."
            : "Request took too long. I've completed what I could - please ask a follow-up question if you need more.";
          await sendResult({ reply: timeoutMsg, partial: true });
          return;
        }
        loopCount++;
        const isLastLoop = loopCount >= maxLoops;

        const loopOpts: any = {
          model: CHATBGP_MODEL,
          messages: conversationMessages,
          max_completion_tokens: 16384,
          systemArray, // prompt caching on every call
        };
        if (!isLastLoop) {
          loopOpts.tools = tools;
          loopOpts.tool_choice = "auto";
        }

        // Use streaming for the final text response (when tools are not passed, or last loop)
        // For tool-calling rounds, use non-streaming to avoid partial delta noise
        const useStreaming = isLastLoop || loopCount > 1;
        let completion: any;
        let streamedFinal = false;

        if (useStreaming) {
          // Stream with deltas — if tool_calls come back, deltas were just partial text (rare)
          sendProgress("Composing response...");
          completion = await callClaudeStreaming(loopOpts, (token) => {
            sendDelta(token);
          });
          streamedFinal = true;
        } else {
          completion = await callClaude(loopOpts);
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
              const toolTimeoutMs = tcName.includes("sharepoint") || tcName.includes("file") ? 20000 : 15000;
              const toolResult = await withTimeout(
                executeAnyTool(tcName, tcArgs, req, msToken),
                toolTimeoutMs,
                { data: { error: `Tool timed out after ${toolTimeoutMs / 1000}s` } }
              );
              if (toolResult.action) lastAction = toolResult.action;
              const resultStr = typeof toolResult.data === "string" ? toolResult.data : JSON.stringify(toolResult.data);
              conversationMessages.push({
                role: "tool" as const,
                tool_call_id: tc.id,
                content: resultStr.length > 12000 ? resultStr.slice(0, 12000) + "\n...[truncated]" : resultStr,
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
      console.error("ChatBGP error:", err?.message || err);
      let errorMsg = "Sorry, I ran into an issue processing your request. Please try again.";
      if (err?.status === 529) errorMsg = "I'm a bit overloaded right now. Please try again in a moment.";
      else if (err?.status === 401) errorMsg = "AI authentication issue — please contact support.";
      else if (err?.status === 429) errorMsg = "I've hit my rate limit. Please wait a minute and try again.";
      else if (err?.status === 400) {
        const errBody = JSON.stringify(err?.error || err?.body || "").toLowerCase();
        if (errBody.includes("too long") || errBody.includes("token") || errBody.includes("max_tokens") || errBody.includes("context")) {
          errorMsg = "That conversation got too long for me to process. Try starting a new thread or asking a simpler question.";
        } else {
          errorMsg = "I had trouble understanding that request. Could you rephrase it?";
        }
      }

      const lastAssistantContent = conversationMessages?.filter((m: any) => m.role === "assistant" && m.content).pop()?.content;
      if (lastAssistantContent && lastAssistantContent.length > 30) {
        errorMsg = lastAssistantContent;
      }

      clearInterval(heartbeat);
      safeSseWrite(`data: ${JSON.stringify({ reply: errorMsg, error: !lastAssistantContent, errorStatus: err?.status || 500 })}\n\n`);
      try { if (!res.writableEnded) res.end(); } catch {}
    }
  });

  app.post("/api/chatbgp/excel-chat", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: "AI API key not configured" });
    }

    const { messages, excelContext } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ message: "messages array required" });
    }
    if (messages.length > 40) {
      return res.status(400).json({ message: "Too many messages (max 40)" });
    }
    for (const m of messages) {
      if (!m || typeof m.content !== "string" || !["user", "assistant"].includes(m.role)) {
        return res.status(400).json({ message: "Each message must have role (user/assistant) and content (string)" });
      }
      if (m.content.length > 50000) {
        return res.status(400).json({ message: "Message content too long (max 50000 chars)" });
      }
    }
    if (excelContext && (typeof excelContext !== "string" || excelContext.length > 100000)) {
      return res.status(400).json({ message: "excelContext must be a string under 100000 chars" });
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

    req.on("close", () => { clearInterval(heartbeat); });

    try {
      let crmCtx = "";
      try { crmCtx = await withTimeout(getCrmContext(), 5000, ""); } catch {}

      let safeExcelContext = excelContext || "";
      const totalBudget = 80000;
      const crmLen = crmCtx.length;
      const maxExcelLen = totalBudget - crmLen;
      if (safeExcelContext.length > maxExcelLen) {
        safeExcelContext = safeExcelContext.substring(0, maxExcelLen) + "\n... (spreadsheet data truncated for size — full workbook metadata above is complete)\n";
      }

      const excelSystemPrompt = `You are ChatBGP Excel Assistant — an AI built into Microsoft Excel for Bruce Gillingham Pollard (BGP), a London commercial property consultancy.

You help BGP team members work with Excel spreadsheets. You have deep knowledge of:
- Commercial property finance (IRR, yields, MOIC, rent reviews, DCF models)
- BGP's CRM data (deals, properties, contacts, companies — provided below)
- Excel formulas, VBA macros, data analysis, and financial modelling

**What makes you better than a generic AI:**
- You can see the FULL workbook — all sheets, their column headers, dimensions, and the active sheet's data.
- You can cross-reference spreadsheet data against BGP's CRM (companies, properties, deals, contacts).
- You understand BGP's Investment WIP format, leasing schedules, and property finance conventions.
- You can now WRITE directly to cells in the user's workbook via Office.js — formulas, values, and formatting.
- You have access to the full BGP investment model template (6 sheets: Summary, Assumptions, Cash Flow, Debt Schedule, Sensitivity, Returns Analysis) and the Model Builder can create it in one click.

**Your capabilities:**
1. **Workbook overview** — When the user first asks about their spreadsheet, give a structured overview: file name, each sheet with its dimensions, and the column structure you can see. Identify the type of data (investment tracker, rent roll, sales comps, etc.).
2. **Cross-reference CRM** — Match company names, property addresses, and agents in the spreadsheet against BGP's CRM data. Flag any matches or gaps.
3. **Write formulas** — Give Excel formulas the user can paste into cells. Reference actual cell addresses from their sheet.
4. **Apply to Excel** — You can now WRITE values and formulas directly into the user's workbook. When suggesting a formula or value, emit an action block so the user can click "Apply" to write it directly:
   \`\`\`json
   {"action": "writeFormula", "sheet": "Sheet1", "cell": "C10", "formula": "=B10*(1+0.025)"}
   \`\`\`
   or for values:
   \`\`\`json
   {"action": "writeValue", "sheet": "Sheet1", "cell": "A1", "value": "Hello"}
   \`\`\`
5. **Explain cells** — When the user shares cell data or formulas, explain what they do clearly.
6. **Build models** — Help construct financial models, sensitivity tables, and scenario analyses. The Model Builder tab can generate a full 6-sheet investment appraisal model directly into the open workbook.
7. **Data analysis** — Help with VLOOKUP, INDEX/MATCH, pivot logic, conditional formatting formulas.
8. **VBA & macros** — Write VBA code for automation tasks.

**Response format:**
- When giving formulas, wrap them in \`\`\`excel code blocks so they're easy to copy.
- When you want the user to be able to apply a formula or value directly, ALSO emit a JSON action block (as shown above). The add-in will render an "Apply" button next to it.
- Be concise and practical — the user is working in Excel and wants quick answers.
- When referencing CRM data, be specific with values so the user can enter them directly.
- Use UK English and UK number formatting.
- Reference specific rows, columns, and cell addresses from their actual spreadsheet data.
- When giving a workbook overview, format it cleanly with the file name, then a numbered list of sheets with their dimensions and whether they are active, with frozen rows/columns noted.
- When the user asks to build a financial model, remind them about the Models tab which can build a full investment appraisal in one click.

${safeExcelContext ? `\n**Current Workbook Data (automatically read from the user's open Excel workbook):**\nYou CAN see all sheets in this workbook. The full data for the active sheet is provided below, plus metadata (dimensions, column headers, frozen panes) for every sheet. Use this to give specific, actionable answers referencing actual cell addresses.\n\n${safeExcelContext}\n` : "\n**Note:** No spreadsheet data was provided. If the user asks you to analyse their sheet, suggest they click the refresh button next to the input or paste their data directly into the chat.\n"}
${crmCtx}`;

      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          { role: "system", content: excelSystemPrompt },
          ...messages.slice(-20),
        ],
        max_completion_tokens: 4096,
      });

      const reply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
      res.write(`data: ${JSON.stringify({ reply })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("[ChatBGP Excel] Error:", err?.message);
      clearInterval(heartbeat);
      try {
        res.write(`data: ${JSON.stringify({ reply: "Failed to get AI response. Please try again.", error: true })}\n\n`);
        res.end();
      } catch {}
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
