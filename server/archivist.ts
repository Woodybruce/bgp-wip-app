import type { Express, Request, Response as ExpressResponse, NextFunction } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { systemSettings, knowledgeBase, users } from "@shared/schema";
import { eq, sql, count } from "drizzle-orm";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { pool } from "./db";
import { ConfidentialClientApplication } from "@azure/msal-node";

const CRAWL_INTERVAL_HOURS = 6;
const DROPBOX_BATCH_SIZE = 50;
const CRAWL_TIMEOUT_MS = 90 * 60 * 1000;
const SP_TIMEOUT_MS = 60 * 60 * 1000;
const DBX_TIMEOUT_MS = 60 * 60 * 1000;
const EMAIL_TIMEOUT_MS = 30 * 60 * 1000;
let archivistRunning = false;
let crawlStartTime = 0;
let activeCrawlTimeout = CRAWL_TIMEOUT_MS;
let crawlProgress = "";

const ADMIN_EMAILS = [
  "rupert@brucegillinghampollard.com",
  "woody@brucegillinghampollard.com",
  "tom@brucegillinghampollard.com",
  "lucy@brucegillinghampollard.com",
  "sohail@brucegillinghampollard.com",
];

const pendingOAuthStates = new Map<string, { userId: string; expiresAt: number }>();

async function requireAdminAuth(req: Request, res: ExpressResponse, next: NextFunction) {
  try {
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) return res.status(403).json({ error: "Admin access required" });
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.email || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  } catch {
    return res.status(403).json({ error: "Access restricted" });
  }
}

async function getSetting(key: string): Promise<any> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: any): Promise<void> {
  await db.insert(systemSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
}

async function getMsTokenForBackground(): Promise<string | null> {
  try {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
    const tenantId = process.env.AZURE_TENANT_ID;
    if (!clientId || !clientSecret || !tenantId) {
      console.log("[archivist] MS token: missing Azure env vars (CLIENT_ID/SECRET/TENANT_ID)");
      return null;
    }

    const result = await pool.query(
      "SELECT user_id, cache_data, home_account_id FROM msal_token_cache ORDER BY updated_at DESC NULLS LAST LIMIT 1"
    );
    if (!result.rows.length) {
      console.log("[archivist] MS token: no cached token found in msal_token_cache table");
      return null;
    }

    const { user_id, cache_data, home_account_id } = result.rows[0];
    if (!cache_data || !home_account_id) {
      console.log("[archivist] MS token: cache_data or home_account_id missing for user", user_id);
      return null;
    }
    console.log("[archivist] MS token: found cached token for user", user_id);

    const client = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });

    client.getTokenCache().deserialize(cache_data);
    const accounts = await client.getTokenCache().getAllAccounts();
    const account = accounts.find((a: any) => a.homeAccountId === home_account_id);
    if (!account) {
      console.log("[archivist] MS token: account not found in cache. Available accounts:", accounts.length);
      return null;
    }
    console.log("[archivist] MS token: using account", account.username || account.homeAccountId);

    const tokenResult = await client.acquireTokenSilent({
      scopes: [
        "https://graph.microsoft.com/Files.ReadWrite.All",
        "https://graph.microsoft.com/Sites.ReadWrite.All",
        "offline_access",
      ],
      account,
    });

    if (tokenResult?.accessToken) {
      console.log("[archivist] MS token: acquired successfully (expires", tokenResult.expiresOn, ")");
      const serialized = client.getTokenCache().serialize();
      await pool.query(
        "UPDATE msal_token_cache SET cache_data = $1, updated_at = NOW() WHERE user_id = $2",
        [serialized, user_id]
      );
      return tokenResult.accessToken;
    }
    console.log("[archivist] MS token: acquireTokenSilent returned no access token");
  } catch (err: any) {
    console.error("[archivist] Background MS token error:", err.message);
  }
  return null;
}

let throttleBackoffMs = 0;

async function fetchWithRetry(url: string, token: string, label: string, maxRetries = 5): Promise<Response> {
  if (throttleBackoffMs > 0) {
    await new Promise(r => setTimeout(r, throttleBackoffMs));
  }
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (res.status === 429 || res.status === 503) {
        lastRes = res;
        if (attempt >= maxRetries) break;
        const retryHeader = res.headers.get("Retry-After");
        let waitSec = 30;
        if (retryHeader) {
          const parsed = Number(retryHeader);
          waitSec = isNaN(parsed) ? 30 : Math.max(parsed + 5, 10);
        }
        waitSec = Math.min(waitSec * (1 + attempt * 0.5), 120);
        const waitMs = waitSec * 1000 + Math.random() * 3000;
        throttleBackoffMs = Math.min(throttleBackoffMs + 3000, 15000);
        console.warn(`[archivist] ${res.status} on ${label} — waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxRetries} (backoff=${throttleBackoffMs}ms)`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      if (throttleBackoffMs > 0) throttleBackoffMs = Math.max(throttleBackoffMs - 1000, 0);
      return res;
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;
      console.warn(`[archivist] Network error on ${label}: ${err.message} — retry ${attempt + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  return lastRes!;
}

let archivistFoldersChecked = 0;

type SPFile = { name: string; path: string; size: number; webUrl: string; driveId: string; itemId: string; lastModified?: string };
type FileCallback = (files: SPFile[]) => Promise<void>;

async function browseSharePointRecursive(
  driveId: string, itemId: string, token: string, basePath: string, maxDepth = 10, depth = 0,
  onFiles?: FileCallback
): Promise<SPFile[]> {
  if (depth >= maxDepth) return [];
  if (crawlStartTime && Date.now() - crawlStartTime > activeCrawlTimeout) {
    console.warn(`[archivist] Crawl timeout reached at ${basePath} (depth=${depth}), returning partial results`);
    return [];
  }
  archivistFoldersChecked++;
  if (depth <= 2) {
    console.log(`[archivist] Browsing: ${basePath} (depth=${depth})`);
    crawlProgress = `Browsing: ${basePath}`;
  } else if (archivistFoldersChecked % 50 === 0) {
    console.log(`[archivist] Progress: ${archivistFoldersChecked} folders checked...`);
  }
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`;
  const res = await fetchWithRetry(url, token, basePath);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[archivist] Browse failed at ${basePath} (depth=${depth}): HTTP ${res.status} — ${body.slice(0, 300)}`);
    return [];
  }
  const data = await res.json();
  let allItems = data.value || [];
  let nextLink = data["@odata.nextLink"];
  while (nextLink) {
    const pageRes = await fetchWithRetry(nextLink, token, `${basePath} (page)`);
    if (!pageRes.ok) {
      const pageBody = await pageRes.text().catch(() => "");
      console.error(`[archivist] Pagination failed at ${basePath}: HTTP ${pageRes.status} — ${pageBody.slice(0, 200)}`);
      break;
    }
    const pageData = await pageRes.json();
    allItems = allItems.concat(pageData.value || []);
    nextLink = pageData["@odata.nextLink"];
  }
  const folders = allItems.filter((c: any) => c.folder);
  const fileItems = allItems.filter((c: any) => !c.folder);
  const files: SPFile[] = [];
  for (const file of fileItems) {
    const childPath = basePath ? `${basePath}/${file.name}` : file.name;
    files.push({ name: file.name, path: childPath, size: file.size || 0, webUrl: file.webUrl, driveId, itemId: file.id, lastModified: file.lastModifiedDateTime });
  }
  if (onFiles && files.length > 0) {
    await onFiles(files);
  }
  for (const folder of folders) {
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    const childPath = basePath ? `${basePath}/${folder.name}` : folder.name;
    const sub = await browseSharePointRecursive(driveId, folder.id, token, childPath, maxDepth, depth + 1, onFiles);
    if (!onFiles) files.push(...sub);
  }
  return onFiles ? [] : files;
}

async function extractTextFromBuffer(buffer: Buffer, fileName: string): Promise<string | null> {
  const ext = path.extname(fileName).toLowerCase();
  const supportedExts = [".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc", ".pptx"];
  if (!supportedExts.includes(ext)) return null;

  const tempDir = path.join(process.cwd(), "ChatBGP", "archivist-temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `archivist-${Date.now()}-${fileName}`);

  try {
    fs.writeFileSync(tempPath, buffer);
  } catch (err) {
    console.error(`[archivist] Failed to write temp file ${tempPath}:`, err);
    return null;
  }

  try {
    const { extractTextFromFile } = await import("./utils/file-extractor");
    const text = await extractTextFromFile(tempPath, fileName);
    const cleaned = text ? text.replace(/\0/g, "") : text;
    if (ext === ".pdf" && (!cleaned || cleaned.trim().length < 50)) {
      const { isOcrConfigured, ocrPdfBuffer } = await import("./ocr");
      if (isOcrConfigured()) {
        console.log(`[archivist] OCR fallback for ${fileName} (extracted ${cleaned?.trim().length || 0} chars)`);
        const ocrText = await ocrPdfBuffer(buffer, fileName);
        if (ocrText && ocrText.trim().length >= 50) {
          console.log(`[archivist] OCR recovered ${ocrText.trim().length} chars from ${fileName}`);
          return ocrText.replace(/\0/g, "");
        }
        console.warn(`[archivist] OCR produced no usable text for ${fileName} — image-based PDF, OCR failed`);
      }
    }
    return cleaned;
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

async function summarizeAndIndex(
  fileName: string, filePath: string, fileUrl: string | null, folderUrl: string,
  content: string, sizeBytes: number, lastModified: Date | null, source: string
): Promise<boolean> {
  const existing = await storage.getKnowledgeBaseByFile(filePath);
  if (existing && existing.lastModified && lastModified) {
    if (lastModified.getTime() <= new Date(existing.lastModified).getTime()) return false;
  }

  if (!content || content.trim().length < 50) return false;
  const truncated = content.slice(0, 15000);

  let summary = "", category = "general", tags: string[] = [];
  try {
    const res = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        {
          role: "system",
          content: `You are an analyst for BGP (Bruce Gillingham Pollard), a London property consultancy. Summarise this document concisely in 2-3 sentences focusing on what it tells us about the business, a property, a deal, a client, or a process. Also provide a category (one of: property_advice, deal_terms, market_analysis, client_communication, internal_process, financial_model, marketing, legal, valuation, other) and up to 5 relevant tags. Respond as JSON: {"summary":"...","category":"...","tags":["..."]}`
        },
        { role: "user", content: `File: ${fileName}\nPath: ${filePath}\nSource: ${source}\n\nContent:\n${truncated.slice(0, 8000)}` }
      ],
      max_completion_tokens: 300,
    });
    let raw = res.choices[0]?.message?.content?.trim() || "{}";
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    const parsed = JSON.parse(raw);
    summary = parsed.summary || "";
    category = parsed.category || "general";
    tags = parsed.tags || [];
  } catch {
    summary = `Document: ${fileName}`;
  }

  await storage.upsertKnowledgeBaseItem({
    fileName, filePath, fileUrl, folderUrl, summary, content: truncated, category, aiTags: tags,
    sizeBytes, lastModified, source,
  });
  return true;
}

async function crawlSharePoint(): Promise<{ indexed: number; skipped: number; errors: number; errorSamples: string[]; folderResults: Record<string, { files: number; indexed: number; skipped: number; errors: number }> }> {
  archivistFoldersChecked = 0;
  throttleBackoffMs = 0;
  let token = await getMsTokenForBackground();
  if (!token) {
    console.log("[archivist] No MS token available for background crawl");
    return { indexed: 0, skipped: 0, errors: 0, errorSamples: [], folderResults: {} };
  }

  const meRes = await fetchWithRetry("https://graph.microsoft.com/v1.0/me", token, "identity check");
  if (meRes.ok) {
    const me = await meRes.json();
    console.log(`[archivist] Token identity: ${me.displayName} (${me.userPrincipalName})`);
  } else {
    const meBody = await meRes.text().catch(() => "");
    console.error(`[archivist] Token /me check failed: HTTP ${meRes.status} — ${meBody.slice(0, 300)}`);
  }

  const BGP_KNOWLEDGE_FOLDERS = [
    { name: "BGP Business Context", url: "https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/woody_brucegillinghampollard_com/IgA5N1cspPKHTJ8tcCdA-cRUAXmCOETID8BfvH-bxBgLNRE?e=jmc26e" },
    { name: "BGP Shared Drive", url: "https://brucegillinghampollardlimited.sharepoint.com/:f:/s/BGP/IgA_lPHJX3cQT6YBOeT3_Y5vAb-hiHkDENJFZylEDxpzbo8?e=PNilJl" },
  ];

  let totalIndexed = 0, totalSkipped = 0, totalErrors = 0;
  const errorSamples: string[] = [];
  const folderResults: Record<string, { files: number; indexed: number; skipped: number; errors: number }> = {};
  let filesProcessed = 0;
  let lastTokenRefresh = Date.now();

  for (const folder of BGP_KNOWLEDGE_FOLDERS) {
    if (crawlStartTime && Date.now() - crawlStartTime > activeCrawlTimeout) {
      console.warn(`[archivist] Crawl timeout reached, stopping before folder "${folder.name}"`);
      break;
    }
    try {
      crawlProgress = `Resolving folder: ${folder.name}`;
      const encodedUrl = Buffer.from(folder.url).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sharingUrl = `u!${encodedUrl}`;
      const driveItemRes = await fetchWithRetry(`https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`, token, `resolve ${folder.name}`);
      if (!driveItemRes.ok) {
        const body = await driveItemRes.text().catch(() => "");
        const errMsg = `Folder "${folder.name}": HTTP ${driveItemRes.status} — ${body.slice(0, 500)}`;
        console.error(`[archivist] Cannot access folder: ${errMsg}`);
        if (errorSamples.length < 20) errorSamples.push(errMsg);
        totalErrors++;
        folderResults[folder.name] = { files: 0, indexed: 0, skipped: 0, errors: 1 };
        continue;
      }
      const driveItem = await driveItemRes.json();
      const driveId = driveItem.parentReference?.driveId;
      const folderId = driveItem.id;
      console.log(`[archivist] Folder "${folder.name}": driveId=${driveId}, itemId=${folderId}`);

      crawlProgress = `Scanning & processing: ${folder.name}`;
      let folderErrors = 0, folderIndexed = 0, folderSkipped = 0, folderFileCount = 0;

      const processFiles: FileCallback = async (batchFiles) => {
        for (const file of batchFiles) {
          if (crawlStartTime && Date.now() - crawlStartTime > activeCrawlTimeout) break;

          if (filesProcessed > 0 && filesProcessed % 100 === 0 && Date.now() - lastTokenRefresh > 15 * 60 * 1000) {
            console.log(`[archivist] Refreshing token after ${filesProcessed} files...`);
            const freshToken = await getMsTokenForBackground();
            if (freshToken) { token = freshToken; lastTokenRefresh = Date.now(); }
          }
          filesProcessed++;
          folderFileCount++;
          if (filesProcessed % 50 === 0) {
            console.log(`[archivist] Files processed: ${filesProcessed} (indexed=${totalIndexed}, skipped=${totalSkipped}, errors=${totalErrors})`);
          }

          try {
            const existing = await storage.getKnowledgeBaseByFile(file.path);
            if (existing && existing.lastModified && file.lastModified) {
              if (new Date(file.lastModified).getTime() <= new Date(existing.lastModified).getTime()) { totalSkipped++; folderSkipped++; continue; }
            }

            const ext = path.extname(file.name).toLowerCase();
            if (![".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc", ".pptx", ".ppt", ".odt", ".ods", ".odp", ".rtf", ".md"].includes(ext)) {
              totalSkipped++; folderSkipped++; continue;
            }

            crawlProgress = `Processing: ${file.name} (${filesProcessed} files, ${totalIndexed} indexed)`;
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
            const contentRes = await fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${file.driveId}/items/${file.itemId}/content`, token, file.name);
            if (!contentRes.ok) {
              if (contentRes.status === 401) {
                console.warn(`[archivist] 401 on file download — refreshing token`);
                const freshToken = await getMsTokenForBackground();
                if (freshToken) { token = freshToken; lastTokenRefresh = Date.now(); }
                const retryRes = await fetchWithRetry(`https://graph.microsoft.com/v1.0/drives/${file.driveId}/items/${file.itemId}/content`, token, `${file.name} (retry)`);
                if (!retryRes.ok) {
                  const errBody = await retryRes.text().catch(() => "");
                  if (errorSamples.length < 20) errorSamples.push(`${file.name}: HTTP ${retryRes.status} (after retry) — ${errBody.slice(0, 200)}`);
                  totalErrors++; folderErrors++;
                  continue;
                }
                const buffer = Buffer.from(await retryRes.arrayBuffer());
                const text = await extractTextFromBuffer(buffer, file.name);
                if (!text || text.trim().length < 50) { totalSkipped++; folderSkipped++; continue; }
                const indexed = await summarizeAndIndex(file.name, file.path, file.webUrl, folder.url, text, file.size, file.lastModified ? new Date(file.lastModified) : null, "sharepoint");
                if (indexed) { totalIndexed++; folderIndexed++; console.log(`[archivist] Indexed: ${file.name}`); }
                else { totalSkipped++; folderSkipped++; }
                continue;
              }
              const errBody = await contentRes.text().catch(() => "");
              if (errorSamples.length < 20) errorSamples.push(`${file.name}: HTTP ${contentRes.status} — ${errBody.slice(0, 200)}`);
              totalErrors++; folderErrors++;
              continue;
            }
            const buffer = Buffer.from(await contentRes.arrayBuffer());
            const text = await extractTextFromBuffer(buffer, file.name);
            if (!text || text.trim().length < 50) { totalSkipped++; folderSkipped++; continue; }

            const indexed = await summarizeAndIndex(file.name, file.path, file.webUrl, folder.url, text, file.size, file.lastModified ? new Date(file.lastModified) : null, "sharepoint");
            if (indexed) { totalIndexed++; folderIndexed++; console.log(`[archivist] Indexed: ${file.name}`); }
            else { totalSkipped++; folderSkipped++; }
          } catch (err: any) {
            if (errorSamples.length < 20) errorSamples.push(`${file.name}: EXCEPTION — ${err?.message}`);
            console.error(`[archivist] Error indexing ${file.name}:`, err?.message);
            totalErrors++; folderErrors++;
          }
        }
      };

      await browseSharePointRecursive(driveId, folderId, token, folder.name, 10, 0, processFiles);
      folderResults[folder.name] = { files: folderFileCount, indexed: folderIndexed, skipped: folderSkipped, errors: folderErrors };
      console.log(`[archivist] Folder "${folder.name}" done: files=${folderFileCount}, indexed=${folderIndexed}, skipped=${folderSkipped}, errors=${folderErrors}`);
    } catch (err: any) {
      const errMsg = `Folder "${folder.name}" EXCEPTION: ${err?.message}`;
      console.error(`[archivist] ${errMsg}`);
      if (errorSamples.length < 20) errorSamples.push(errMsg);
      totalErrors++;
      folderResults[folder.name] = { files: 0, indexed: 0, skipped: 0, errors: 1 };
    }
  }

  if (errorSamples.length > 0) {
    console.log(`[archivist] SharePoint error samples (${errorSamples.length}):\n${errorSamples.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`);
  }
  console.log(`[archivist] SharePoint crawl complete: indexed=${totalIndexed}, skipped=${totalSkipped}, errors=${totalErrors}, folders=${Object.keys(folderResults).length}`);
  return { indexed: totalIndexed, skipped: totalSkipped, errors: totalErrors, errorSamples, folderResults };
}

async function getDropboxToken(): Promise<string | null> {
  const tokens = await getSetting("dropbox_tokens");
  if (!tokens) { console.log("[archivist] Dropbox: no tokens in database"); return null; }

  const { access_token, refresh_token, expires_at } = tokens;
  if (access_token && expires_at && Date.now() < expires_at - 60000) {
    console.log("[archivist] Dropbox: using cached token (expires in", Math.round((expires_at - Date.now()) / 60000), "min)");
    return access_token;
  }

  if (!refresh_token) { console.log("[archivist] Dropbox: token expired and no refresh token"); return null; }
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  if (!appKey || !appSecret) { console.log("[archivist] Dropbox: missing DROPBOX_APP_KEY or DROPBOX_APP_SECRET env vars"); return null; }

  console.log("[archivist] Dropbox: token expired, refreshing...");
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token,
        client_id: appKey,
        client_secret: appSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[archivist] Dropbox token refresh failed:", res.status, body);
      return null;
    }
    const data = await res.json();
    await setSetting("dropbox_tokens", {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refresh_token,
      expires_at: Date.now() + (data.expires_in || 14400) * 1000,
    });
    console.log("[archivist] Dropbox: token refreshed successfully");
    return data.access_token;
  } catch (err: any) {
    console.error("[archivist] Dropbox token refresh error:", err.message);
    return null;
  }
}

async function crawlDropbox(): Promise<{ indexed: number; skipped: number; errors: number }> {
  let token = await getDropboxToken();
  if (!token) {
    console.log("[archivist] No Dropbox token available");
    return { indexed: 0, skipped: 0, errors: 0 };
  }

  let totalIndexed = 0, totalSkipped = 0, totalErrors = 0;
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    try {
      const body = cursor
        ? { cursor }
        : { path: "", recursive: true, limit: DROPBOX_BATCH_SIZE };
      const endpoint = cursor
        ? "https://api.dropboxapi.com/2/files/list_folder/continue"
        : "https://api.dropboxapi.com/2/files/list_folder";

      let res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok && res.status === 401) {
        console.warn("[archivist] Dropbox list_folder 401 — refreshing token");
        const freshToken = await getDropboxToken();
        if (freshToken) {
          token = freshToken;
          res = await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }
      }

      if (!res.ok) {
        console.error("[archivist] Dropbox list_folder error:", res.status);
        break;
      }

      const data = await res.json();
      cursor = data.cursor;
      hasMore = data.has_more;

      for (const entry of data.entries || []) {
        if (entry[".tag"] !== "file") continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (![".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc", ".pptx"].includes(ext)) { totalSkipped++; continue; }

        const filePath = `dropbox:${entry.path_display}`;
        try {
          const existing = await storage.getKnowledgeBaseByFile(filePath);
          if (existing && existing.lastModified && entry.server_modified) {
            if (new Date(entry.server_modified).getTime() <= new Date(existing.lastModified).getTime()) { totalSkipped++; continue; }
          }

          const downloadRes = await fetch("https://content.dropboxapi.com/2/files/download", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Dropbox-API-Arg": JSON.stringify({ path: entry.id }),
            },
          });
          if (!downloadRes.ok) {
            if (downloadRes.status === 401) {
              console.warn(`[archivist] Dropbox download 401 for ${entry.name} — refreshing token and retrying`);
              const freshToken = await getDropboxToken();
              if (freshToken) {
                token = freshToken;
                const retryRes = await fetch("https://content.dropboxapi.com/2/files/download", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Dropbox-API-Arg": JSON.stringify({ path: entry.id }),
                  },
                });
                if (retryRes.ok) {
                  const retryBuffer = Buffer.from(await retryRes.arrayBuffer());
                  const retryText = await extractTextFromBuffer(retryBuffer, entry.name);
                  if (retryText && retryText.trim().length >= 50) {
                    const indexed = await summarizeAndIndex(
                      entry.name, filePath, null, "dropbox://", retryText,
                      entry.size || 0, entry.server_modified ? new Date(entry.server_modified) : null, "dropbox"
                    );
                    if (indexed) { totalIndexed++; console.log(`[archivist] Dropbox indexed (retry): ${entry.name}`); }
                    else totalSkipped++;
                    continue;
                  }
                }
              }
            }
            console.error(`[archivist] Dropbox download failed for ${entry.name}: HTTP ${downloadRes.status}`);
            totalErrors++; continue;
          }
          const buffer = Buffer.from(await downloadRes.arrayBuffer());
          const text = await extractTextFromBuffer(buffer, entry.name);
          if (!text || text.trim().length < 50) { totalSkipped++; continue; }

          const indexed = await summarizeAndIndex(
            entry.name, filePath, null, "dropbox://", text,
            entry.size || 0, entry.server_modified ? new Date(entry.server_modified) : null, "dropbox"
          );
          if (indexed) { totalIndexed++; console.log(`[archivist] Dropbox indexed: ${entry.name}`); }
          else totalSkipped++;
        } catch (err: any) {
          console.error(`[archivist] Error indexing Dropbox file ${entry.name}:`, err?.message);
          totalErrors++;
        }
      }
    } catch (err: any) {
      console.error("[archivist] Dropbox crawl error:", err.message);
      hasMore = false;
      totalErrors++;
    }
  }
  return { indexed: totalIndexed, skipped: totalSkipped, errors: totalErrors };
}

export function isArchivistRunning() { return archivistRunning; }

const EMAIL_CRAWL_MONTHS = 6;
const EMAIL_BATCH_SIZE = 50;

async function crawlEmails(): Promise<{ indexed: number; skipped: number; errors: number; usersProcessed: number }> {
  let totalIndexed = 0, totalSkipped = 0, totalErrors = 0, usersProcessed = 0;

  try {
    const { getAppToken } = await import("./shared-mailbox");
    const token = await getAppToken();

    const userRows = await pool.query(
      "SELECT DISTINCT email FROM users WHERE email LIKE '%@brucegillinghampollard.com' ORDER BY email"
    );
    const userEmails = userRows.rows.map((r: any) => r.email).filter(Boolean);
    console.log(`[archivist] Email crawl: ${userEmails.length} mailboxes to scan (last ${EMAIL_CRAWL_MONTHS} months)`);

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - EMAIL_CRAWL_MONTHS);
    const cutoffISO = cutoffDate.toISOString();

    for (const userEmail of userEmails) {
      if (crawlStartTime && Date.now() - crawlStartTime > activeCrawlTimeout) {
        console.warn(`[archivist] Email crawl timeout, stopping at ${userEmail}`);
        break;
      }

      try {
        crawlProgress = `Scanning emails: ${userEmail}`;
        let userIndexed = 0, userSkipped = 0, userErrors = 0;
        let hasMore = true;
        let nextUrl: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/messages?$top=${EMAIL_BATCH_SIZE}&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${cutoffISO}&$select=id,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,importance`;

        while (hasMore && nextUrl) {
          if (crawlStartTime && Date.now() - crawlStartTime > CRAWL_TIMEOUT_MS) break;

          const res = await fetchWithRetry(nextUrl, token, `emails:${userEmail}`);

          if (!res.ok) {
            if (res.status === 404 || res.status === 403) {
              console.log(`[archivist] Email crawl: ${userEmail} — ${res.status} (mailbox not accessible), skipping`);
              break;
            }
            const body = await res.text().catch(() => "");
            console.error(`[archivist] Email crawl error for ${userEmail}: HTTP ${res.status} — ${body.slice(0, 200)}`);
            totalErrors++;
            userErrors++;
            break;
          }

          const data = await res.json();
          const messages = data.value || [];
          if (messages.length === 0) { hasMore = false; break; }

          for (const msg of messages) {
            try {
              const emailDate = new Date(msg.receivedDateTime);
              if (emailDate < cutoffDate) { hasMore = false; break; }

              const fromEmail = msg.from?.emailAddress?.address || "unknown";
              const fromName = msg.from?.emailAddress?.name || fromEmail;
              const toList = (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");
              const subject = msg.subject || "(no subject)";
              const filePath = `email:${userEmail}/${msg.id}`;
              const bodyContent = msg.body?.content || msg.bodyPreview || "";

              const plainText = bodyContent
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/\s+/g, " ")
                .trim();

              if (plainText.length < 30) { userSkipped++; totalSkipped++; continue; }

              const emailContent = `From: ${fromName} <${fromEmail}>\nTo: ${toList}\nDate: ${emailDate.toISOString()}\nSubject: ${subject}\n\n${plainText}`;

              const indexed = await summarizeAndIndex(
                subject,
                filePath,
                null,
                `mailbox:${userEmail}`,
                emailContent,
                emailContent.length,
                emailDate,
                "email"
              );

              if (indexed) { userIndexed++; totalIndexed++; }
              else { userSkipped++; totalSkipped++; }
            } catch (err: any) {
              userErrors++;
              totalErrors++;
              if (totalErrors <= 10) {
                console.error(`[archivist] Email index error (${userEmail}): ${err.message}`);
              }
            }
          }

          nextUrl = data["@odata.nextLink"] || null;
          if (!nextUrl && messages.length < EMAIL_BATCH_SIZE) hasMore = false;
        }

        usersProcessed++;
        if (userIndexed > 0) {
          console.log(`[archivist] Email crawl: ${userEmail} — indexed=${userIndexed}, skipped=${userSkipped}, errors=${userErrors}`);
        }
      } catch (err: any) {
        console.error(`[archivist] Email crawl error for ${userEmail}:`, err.message);
        totalErrors++;
      }
    }
  } catch (err: any) {
    console.error("[archivist] Email crawl setup error:", err.message);
    totalErrors++;
  }

  console.log(`[archivist] Email crawl complete: users=${usersProcessed}, indexed=${totalIndexed}, skipped=${totalSkipped}, errors=${totalErrors}`);
  return { indexed: totalIndexed, skipped: totalSkipped, errors: totalErrors, usersProcessed };
}

export async function runArchivistCrawl() {
  if (archivistRunning) {
    console.log("[archivist] Already running, skipping");
    return;
  }
  archivistRunning = true;
  const overallStart = Date.now();
  crawlProgress = "Starting SharePoint crawl...";
  console.log("[archivist] Starting background crawl...");

  try {
    crawlStartTime = Date.now();
    activeCrawlTimeout = SP_TIMEOUT_MS;
    const spResult = await crawlSharePoint();
    console.log(`[archivist] SharePoint: indexed=${spResult.indexed}, skipped=${spResult.skipped}, errors=${spResult.errors}`);
    await setSetting("archivist_last_run", {
      timestamp: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - overallStart) / 1000),
      sharepoint: { indexed: spResult.indexed, skipped: spResult.skipped, errors: spResult.errors, errorSamples: spResult.errorSamples.slice(0, 20), folderResults: spResult.folderResults },
      dropbox: { indexed: 0, skipped: 0, errors: 0 },
    });

    crawlProgress = "Starting Dropbox crawl...";
    crawlStartTime = Date.now();
    activeCrawlTimeout = DBX_TIMEOUT_MS;
    const dbxResult = await crawlDropbox();
    console.log(`[archivist] Dropbox: indexed=${dbxResult.indexed}, skipped=${dbxResult.skipped}, errors=${dbxResult.errors}`);
    await setSetting("archivist_last_run", {
      timestamp: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - overallStart) / 1000),
      sharepoint: { indexed: spResult.indexed, skipped: spResult.skipped, errors: spResult.errors, errorSamples: spResult.errorSamples.slice(0, 20), folderResults: spResult.folderResults },
      dropbox: dbxResult,
    });

    crawlProgress = "Starting email crawl...";
    crawlStartTime = Date.now();
    activeCrawlTimeout = EMAIL_TIMEOUT_MS;
    const emailResult = await crawlEmails();
    console.log(`[archivist] Emails: users=${emailResult.usersProcessed}, indexed=${emailResult.indexed}, skipped=${emailResult.skipped}, errors=${emailResult.errors}`);

    const duration = Math.round((Date.now() - overallStart) / 1000);
    await setSetting("archivist_last_run", {
      timestamp: new Date().toISOString(),
      durationSeconds: duration,
      sharepoint: { indexed: spResult.indexed, skipped: spResult.skipped, errors: spResult.errors, errorSamples: spResult.errorSamples.slice(0, 20), folderResults: spResult.folderResults },
      dropbox: dbxResult,
      email: emailResult,
    });
    const totalIndexed = (spResult.indexed || 0) + (dbxResult.indexed || 0) + (emailResult.indexed || 0);
    if (totalIndexed > 0) {
      const { logActivity } = await import("./activity-logger");
      await logActivity("archivist", "documents_indexed", `${totalIndexed} documents indexed: ${spResult.indexed} from SharePoint, ${dbxResult.indexed} from Dropbox, ${emailResult.indexed} from emails`, totalIndexed);
    }
    console.log(`[archivist] Crawl complete in ${duration}s`);
  } catch (err: any) {
    console.error("[archivist] Crawl error:", err.message);
  } finally {
    archivistRunning = false;
    crawlStartTime = 0;
    crawlProgress = "";
  }
}

export function startArchivist() {
  console.log("[archivist] Auto-crawl enabled — running every", CRAWL_INTERVAL_HOURS, "hours");

  setTimeout(() => {
    runArchivistCrawl().catch(err => console.error("[archivist] Initial crawl error:", err.message));
  }, 30_000);

  setInterval(() => {
    runArchivistCrawl().catch(err => console.error("[archivist] Scheduled crawl error:", err.message));
  }, CRAWL_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function setupArchivistRoutes(app: Express) {
  app.get("/api/archivist/status", requireAuth, async (_req: Request, res: ExpressResponse) => {
    try {
      const [{ count: totalCount }] = await db.select({ count: count() }).from(knowledgeBase);
      const spCount = await pool.query("SELECT COUNT(*) FROM knowledge_base WHERE source = 'sharepoint' OR source IS NULL");
      const dbxCount = await pool.query("SELECT COUNT(*) FROM knowledge_base WHERE source = 'dropbox'");
      const emailCount = await pool.query("SELECT COUNT(*) FROM knowledge_base WHERE source = 'email'");
      const lastRun = await getSetting("archivist_last_run");
      const dropboxTokens = await getSetting("dropbox_tokens");
      res.json({
        running: archivistRunning,
        progress: crawlProgress,
        runningForSeconds: crawlStartTime ? Math.round((Date.now() - crawlStartTime) / 1000) : 0,
        totalIndexed: Number(totalCount),
        sharepointDocs: Number(spCount.rows[0]?.count || 0),
        dropboxDocs: Number(dbxCount.rows[0]?.count || 0),
        emailDocs: Number(emailCount.rows[0]?.count || 0),
        lastRun,
        dropboxConnected: !!dropboxTokens?.access_token,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/archivist/dropbox/connect", async (_req: Request, res: ExpressResponse, next: Function) => {
    const userId = _req.session?.userId || (_req as any).tokenUserId;
    if (!userId) {
      return res.redirect("/?dropbox_connect=1");
    }
    next();
  }, requireAuth, async (_req: Request, res: ExpressResponse) => {
    const appKey = process.env.DROPBOX_APP_KEY;
    if (!appKey) return res.status(500).json({ error: "Dropbox app not configured" });

    const protocol = _req.headers["x-forwarded-proto"] || _req.protocol;
    const host = _req.headers["x-forwarded-host"] || _req.headers.host;
    const redirectUri = `${protocol}://${host}/api/archivist/dropbox/callback`;

    const state = crypto.randomBytes(32).toString("hex");
    const userId = _req.session?.userId || (_req as any).tokenUserId;
    pendingOAuthStates.set(state, { userId, expiresAt: Date.now() + 10 * 60 * 1000 });

    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&token_access_type=offline&state=${state}`;
    res.redirect(authUrl);
  });

  app.get("/api/archivist/dropbox/callback", async (req: Request, res: ExpressResponse) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    if (!code) return res.status(400).send("No authorization code");

    if (!state) return res.status(400).send("Missing OAuth state");
    const pending = pendingOAuthStates.get(state);
    if (!pending || Date.now() > pending.expiresAt) {
      pendingOAuthStates.delete(state);
      return res.status(400).send("Invalid or expired OAuth state");
    }
    pendingOAuthStates.delete(state);

    const appKey = process.env.DROPBOX_APP_KEY;
    const appSecret = process.env.DROPBOX_APP_SECRET;
    if (!appKey || !appSecret) return res.status(500).send("Dropbox app not configured");

    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/archivist/dropbox/callback`;

    try {
      const tokenRes = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: appKey,
          client_secret: appSecret,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("[archivist] Dropbox token exchange failed:", err);
        return res.redirect("/?dropbox_error=token_exchange_failed");
      }

      const data = await tokenRes.json();
      await setSetting("dropbox_tokens", {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 14400) * 1000,
      });

      console.log("[archivist] Dropbox connected successfully");
      res.redirect("/sharepoint?dropbox=connected");

      setTimeout(() => runArchivistCrawl().catch(e => console.error("[archivist] Post-connect crawl error:", e.message)), 5000);
    } catch (err: any) {
      console.error("[archivist] Dropbox callback error:", err.message);
      res.redirect("/?dropbox_error=" + encodeURIComponent(err.message));
    }
  });

  app.post("/api/archivist/dropbox/disconnect", requireAuth, requireAdminAuth, async (_req: Request, res: ExpressResponse) => {
    try {
      await db.delete(systemSettings).where(eq(systemSettings.key, "dropbox_tokens"));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/archivist/crawl", requireAuth, requireAdminAuth, async (_req: Request, res: ExpressResponse) => {
    if (archivistRunning) return res.json({ message: "Crawl already in progress" });
    res.json({ message: "Crawl started" });
    runArchivistCrawl().catch(e => console.error("[archivist] Manual crawl error:", e.message));
  });
}
