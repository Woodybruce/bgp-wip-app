import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { requireAuth, requireAdmin, getUserIdFromToken } from "./auth";
import { setPipnetCreds, clearPipnetCreds, getPipnetCredsStatus } from "./integration-credentials";
import { resolveCompanyScope } from "./company-scope";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { saveFile, getFile, recordUserUpload } from "./file-storage";
import { contentDispositionFor } from "./utils/http-headers";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";
import { escapeLike } from "./utils/escape-like";
import { emitNewMessage, emitMessageUpdated, emitMessageDeleted, emitThreadUpdated, emitMemberAdded, emitMemberRemoved, emitNotification, getIO } from "./websocket";
import { saveSubscription, removeSubscription, removeSubscriptionForUser, sendPushNotification, getVapidPublicKey } from "./push-notifications";
import {
  insertProjectSchema,
  users,
  externalRequirements,
  crmCompanies,
  crmContacts,
  crmProperties,
  crmRequirementsLeasing,
  investmentTracker,
  insertInvestmentTrackerSchema,
  investmentViewings,
  investmentOffers,
  investmentDistributions,
  investmentMarketingFiles,
  insertInvestmentViewingSchema,
  insertInvestmentOfferSchema,
  insertInvestmentDistributionSchema,
  insertInvestmentMarketingFileSchema,
} from "@shared/schema";
import { fromError } from "zod-validation-error";
import { db } from "./db";
import { eq, ilike, or, sql, and, desc, inArray } from "drizzle-orm";
import { newsArticles } from "@shared/schema";
import { registerIngestRoutes } from "./ingest-routes";
import { registerGenericCrmRoutes } from "./generic-crm-routes";
import { setupStripeIssuingRoutes } from "./stripe-issuing";
import { registerExpenseAutoClassifyRoutes } from "./expense-auto-classify";
import { registerMapAnnotationsRoutes } from "./map-annotations";
import { setupRevolutRoutes } from "./revolut";
import { setupRefreshImageRoutes } from "./refresh-website-images";
import { setupHrRoutes } from "./hr-routes";
import { setupWhyBuyDesignRoutes } from "./why-buy-design";
import { setupDocumentPreferencesRoutes } from "./document-preferences";
import { setupDeckRoutes } from "./decks";
import { setupDocumentRoutes } from "./documents";
import { importTrlRequirement } from "./trl";
import { resolveBuildingTitles } from "./land-registry";
import { fetchPlanitPlanning } from "./planit-planning";
import { lookupVoaByPostcode, voaSqliteAvailable } from "./voa-sqlite";
import { searchPipnetRequirements, searchPipnetProperties, importPipnetRequirements, importPipnetProperties, inspectPipnetPropertySearch } from "./pipnet";
import { startJob, getJobStatus } from "./brand-jobs";
import { executeSeedSql } from "./seed";
import { gunzipSync } from "zlib";
import { invalidateContextCache } from "./chatbgp";

const CHAT_MEDIA_DIR = path.join(process.cwd(), "ChatBGP", "chat-media");
if (!fs.existsSync(CHAT_MEDIA_DIR)) {
  fs.mkdirSync(CHAT_MEDIA_DIR, { recursive: true });
}

const PROFILE_PICS_DIR = path.join(process.cwd(), "ChatBGP", "profile-pics");
if (!fs.existsSync(PROFILE_PICS_DIR)) {
  fs.mkdirSync(PROFILE_PICS_DIR, { recursive: true });
}

const profilePicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].includes(ext)) {
      return cb(new Error("Only image files allowed."));
    }
    cb(null, true);
  },
});

const MARKETING_FILES_DIR = path.join(process.cwd(), "ChatBGP", "marketing-files");
if (!fs.existsSync(MARKETING_FILES_DIR)) {
  fs.mkdirSync(MARKETING_FILES_DIR, { recursive: true });
}

const ALLOWED_MARKETING_EXTS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const marketingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MARKETING_EXTS.has(ext)) {
      return cb(new Error("File type not allowed. Accepted: PDF, Word, Excel, PowerPoint, and images."));
    }
    cb(null, true);
  },
});

const chatMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const GROUP_CHAT_TOOLS = [
  "search_crm", "search_news", "query_wip", "create_deal", "update_deal",
  "create_contact", "update_contact", "create_company", "update_company",
  "create_property", "create_available_unit", "update_available_unit",
  "update_investment_tracker", "create_investment_tracker",
  "log_viewing", "log_offer", "create_requirement", "create_diary_entry",
  "delete_record", "web_search", "ingest_url", "property_lookup", "property_data_lookup",
  "tfl_nearby", "search_green_street", "query_xero", "scan_duplicates",
  "navigate_to", "send_email", "query_leasing_schedule",
];

// ── Smart tags ──────────────────────────────────────────────────────────
// Chat messages carry entity tags as inline tokens: @[Name](tag:type/id).
// The client renders them as clickable chips; here they (a) trigger the
// AI auto-join when the tag is the AI itself and (b) get resolved into
// real CRM context for the group AI responder.
const TAG_TOKEN_REGEX = /@\[([^\]]+)\]\(tag:(user|company|property|deal|unit|contact|folder)\/([^)\s]+)\)/g;

// One regex for "the user summoned the AI", shared by the auto-join in the
// message handler and the must-respond rule in triggerAiGroupResponse.
// Covers @ChatBGP / "chat bgp" / bare "@chat" / an AI user-tag token.
const AI_MENTION_REGEX = /@?chat\s*(bgp|pave|landsec)\b|@chat\b|\(tag:user\/__chatbgp__\)/i;

function stripTagTokens(text: string): string {
  return text.replace(TAG_TOKEN_REGEX, "@$1");
}

// Resolve the entities tagged in a conversation into a compact context
// block for the group AI, so "@[Bluewater](tag:property/…) what's vacant?"
// answers from the actual record instead of a cold search.
async function buildTaggedEntityContext(messages: Array<{ content: string }>): Promise<string> {
  const seen = new Map<string, { type: string; id: string; name: string }>();
  for (const m of messages) {
    for (const match of (m.content || "").matchAll(TAG_TOKEN_REGEX)) {
      const [, name, type, id] = match;
      if (type !== "user" && seen.size < 8) seen.set(`${type}/${id}`, { type, id, name });
    }
  }
  if (seen.size === 0) return "";
  const lines: string[] = [];
  for (const { type, id, name } of seen.values()) {
    try {
      if (type === "property") {
        const r = await pool.query(
          `SELECT p.name, p.status, p.asset_class,
            (SELECT COUNT(*) FROM available_units au WHERE au.property_id = p.id) as unit_count,
            (SELECT COUNT(*) FROM available_units au WHERE au.property_id = p.id AND au.marketing_status = 'Available') as available_count
           FROM crm_properties p WHERE p.id = $1`, [id]);
        const p = r.rows[0];
        if (p) {
          lines.push(`- Property **${p.name}** (id ${id}) — ${p.asset_class || "unknown class"}, status ${p.status || "unknown"}, ${p.unit_count} units (${p.available_count} available)`);
          // Inline the unit schedule so "which units are free at X?" answers
          // straight from context — the group loop only gets a few tool hops.
          const units = await pool.query(
            `SELECT unit_name, sqft, asking_rent, marketing_status FROM available_units
             WHERE property_id = $1 ORDER BY unit_name LIMIT 15`, [id]);
          for (const u of units.rows) {
            lines.push(`  - ${u.unit_name}: ${u.sqft ? Number(u.sqft).toLocaleString() + " sqft" : "size TBC"}${u.asking_rent ? ", £" + u.asking_rent + " psf" : ""} — ${u.marketing_status || "status unknown"}`);
          }
          const ls = await pool.query(
            `SELECT COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status ILIKE 'vacant%' OR status ILIKE 'available%') as vacant,
                    COALESCE(SUM(rent_pa), 0) as rent
             FROM leasing_schedule_units WHERE property_id = $1`, [id]);
          if (Number(ls.rows[0]?.total) > 0) {
            lines.push(`  - Leasing schedule: ${ls.rows[0].total} units, ${ls.rows[0].vacant} vacant, £${Number(ls.rows[0].rent).toLocaleString()} passing rent pa`);
          }
        }
      } else if (type === "deal") {
        const r = await pool.query(
          `SELECT d.name, d.status, d.deal_type, d.team, p.name as property_name FROM crm_deals d
           LEFT JOIN crm_properties p ON d.property_id = p.id WHERE d.id = $1`, [id]);
        const d = r.rows[0];
        if (d) lines.push(`- Deal **${d.name}** (id ${id}) — ${d.deal_type || "deal"}, status ${d.status || "unknown"}${d.property_name ? `, property ${d.property_name}` : ""}${d.team ? `, team ${d.team}` : ""}`);
      } else if (type === "company") {
        const r = await pool.query(`SELECT name, company_type FROM crm_companies WHERE id = $1`, [id]);
        const c = r.rows[0];
        if (c) lines.push(`- Company/brand **${c.name}** (id ${id})${c.company_type ? ` — ${c.company_type}` : ""}`);
      } else if (type === "unit") {
        const r = await pool.query(
          `SELECT au.unit_name, au.sqft, au.asking_rent, au.marketing_status, p.name as property_name
           FROM available_units au LEFT JOIN crm_properties p ON au.property_id = p.id WHERE au.id = $1`, [id]);
        const u = r.rows[0];
        if (u) lines.push(`- Letting-tracker unit **${u.unit_name}**${u.property_name ? ` at ${u.property_name}` : ""} (id ${id}) — ${u.sqft ? Number(u.sqft).toLocaleString() + " sqft, " : ""}${u.asking_rent ? "£" + u.asking_rent + " psf, " : ""}status ${u.marketing_status || "unknown"}`);
      } else if (type === "folder") {
        lines.push(`- SharePoint folder **${name}** was linked in the chat — that's where the relevant documents live. You cannot open folders yourself; acknowledge the pointer rather than asking for uploads.`);
        continue;
      } else if (type === "contact") {
        const r = await pool.query(`SELECT c.name, c.email, co.name as company_name FROM crm_contacts c LEFT JOIN crm_companies co ON c.company_id = co.id WHERE c.id = $1`, [id]);
        const c = r.rows[0];
        if (c) lines.push(`- Contact **${c.name}** (id ${id})${c.company_name ? ` — ${c.company_name}` : ""}${c.email ? `, ${c.email}` : ""}`);
      }
      if (!lines.length || !lines[lines.length - 1].includes(`(id ${id})`)) {
        // Entity was deleted since it was tagged — keep the AI honest about it.
        lines.push(`- Tagged "${name}" (${type} ${id}) — no longer found in the CRM`);
      }
    } catch {
      lines.push(`- Tagged "${name}" (${type} ${id}) — lookup failed`);
    }
  }
  return `\n\n## TAGGED IN THIS CONVERSATION\nThese records were tagged with @ in the chat. Questions near a tag are almost certainly about that record — use these ids directly with your tools instead of searching by name:\n${lines.join("\n")}\n`;
}

// available_units / investment_tracker store agent user IDs (text[] of
// user.id), but crm_deals.internal_agent stores display NAMES (the
// deal-detail chip render + the BGP-Contact dropdown both look up by
// name). Without this resolver, deals auto-created off the trackers
// surfaced raw UUIDs in the Edit Deal dialog and on the kanban chip.
async function resolveAgentNames(userIds: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const r = await pool.query<{ name: string }>(
    `SELECT name FROM users WHERE id = ANY($1::varchar[])`,
    [userIds],
  );
  return r.rows.map(row => row.name).filter((n): n is string => !!n);
}

async function triggerAiGroupResponse(threadId: string, senderUserId: string, req: Request) {
  const startTime = Date.now();
  const TIMEOUT_MS = 60000;

  const io = getIO();
  if (io) {
    io.to(`thread:${threadId}`).emit("typing", { threadId, userId: "__chatbgp__" });
  }

  const recentResult = await pool.query(
    "SELECT role, content, user_id FROM chat_messages WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 20",
    [threadId]
  );
  const recentMessages = recentResult.rows.reverse()
    .filter((m: any) => m.content && m.content.trim())
    .map((m: any) => ({
      role: m.role === "assistant" ? "assistant" as const : "user" as const,
      content: m.content.trim(),
    }));

  if (recentMessages.length === 0) return;

  const sender = await storage.getUser(senderUserId);
  const senderName = sender?.name || "A team member";

  try {
    const chatbgp = await import("./chatbgp");
    const { callClaude } = chatbgp;

    const [systemPrompt, learnings, allTools, calendarContext] = await Promise.all([
      chatbgp.buildSystemPrompt().catch(() => "You are ChatBGP, the AI assistant for Bruce Gillingham Pollard, a London commercial property agency."),
      chatbgp.getBusinessLearningsContext().catch(() => ""),
      chatbgp.getAvailableTools().catch(() => ({ tools: [] })),
      chatbgp.getEmailAndCalendarContext(req).catch(() => ""),
    ]);

    // Client logins get NO tools in the group-AI path either — this loop is
    // separate from the main chat handler's clientChatGuard. (Landsec audit.)
    const groupIsClient = await (await import("./company-scope")).isClientRequestUser(req).catch(() => true);
    const groupTools = groupIsClient ? [] : ((allTools as any).tools?.filter((t: any) =>
      GROUP_CHAT_TOOLS.includes(t.function?.name)
    ) || []);

    const lastUserMsg = recentMessages.filter(m => m.role === "user").pop()?.content || "";
    const mentionsChatBGP = AI_MENTION_REGEX.test(lastUserMsg);
    const taggedContext = await buildTaggedEntityContext(recentMessages).catch(() => "");

    const groupSystemPrompt = systemPrompt + learnings + calendarContext + taggedContext +
      `\n\nIMPORTANT: You are participating in a GROUP CHAT with multiple team members. ` +
      `The most recent message was sent by ${senderName}. ` +
      `CRITICAL RULES FOR GROUP CHAT:\n` +
      `1. Be conversational and natural — you are a colleague, not a robot. Respond like a helpful team member in a WhatsApp group.\n` +
      `2. For casual messages, banter, jokes, or social chat — respond in kind with personality. Do NOT use tools for these.\n` +
      `3. Only use tools when someone asks a specific work question or shares actionable business intelligence.\n` +
      `4. When you DO use tools, always explain the results in detail — list specific names, statuses, key details. Never just say "Found X results".\n` +
      `5. Keep responses concise but complete and actionable. 2-4 sentences is usually right.\n` +
      `6. When someone shares business intelligence (e.g. "Met X, they want Y type of property for £Z"), be PROACTIVE:\n` +
      `   - Check the calendar context above to see if there was a meeting with that person today — if so, reference it (e.g. "I can see you had a meeting with X at 2pm")\n` +
      `   - Suggest concrete next steps (log the requirement, search for matching properties, set up follow-ups)\n` +
      `   - Offer to create CRM records or search for matches\n` +
      `   - Share relevant context you know about similar requirements or properties\n` +
      `7. When someone asks to check their diary/calendar, look at the calendar context provided to you and summarise their upcoming schedule.\n` +
      `8. NEVER respond with raw error messages or technical details. If a tool fails, apologise briefly and try a different approach.\n` +
      `8b. FINISH YOUR ANSWER IN THIS TURN. After a tool result comes back, your next message IS the final answer the team sees — include the actual findings (names, numbers, statuses). NEVER end with "Let me pull/check/look up..." or a sentence that trails off with a colon: there is no further lookup after you reply. If the tool returned nothing useful, say what you tried and what you'd need.\n` +
      (mentionsChatBGP
        ? `9. The user mentioned you by name — you MUST respond. Do NOT skip.`
        : `9. Only respond with exactly __SKIP__ if the conversation is clearly a private side-conversation between team members that has nothing to do with work, property, or anything you could help with. When in doubt, respond — it's better to be helpful than silent.`);

    console.log(`[ai-group] Prepared in ${Date.now() - startTime}ms (${groupTools.length} tools, mention=${mentionsChatBGP})`);

    const completionOptions: any = {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: groupSystemPrompt },
        // Tag tokens read as line noise to the model — send plain @Name;
        // the resolved records are already in TAGGED IN THIS CONVERSATION.
        ...recentMessages.map(m => ({ ...m, content: stripTagTokens(m.content) })),
      ],
      max_completion_tokens: 2048,
      tools: groupTools.length > 0 ? groupTools : undefined,
    };

    const withTimeout = <T>(p: Promise<T>): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI response timed out")), TIMEOUT_MS);
      });
      return Promise.race([p, timeoutPromise]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
    };
    let claudeResponse = await withTimeout(callClaude(completionOptions)) as any;
    let currentMessage = claudeResponse.choices?.[0]?.message;
    let loopCount = 0;
    const maxLoops = 6;
    // Multi-hop: each handled tool's summarised outcome is fed back as a tool
    // result so the model can chain lookups (search → detail → answer) instead
    // of the first tool's summary being posted as the final reply. lastHandled*
    // is the safety net if the model goes quiet after tools or hits the cap.
    let lastAction: any = null;
    let lastHandledReply: string | null = null;

    while (currentMessage?.tool_calls && currentMessage.tool_calls.length > 0 && loopCount < maxLoops) {
      loopCount++;
      const toolCall = currentMessage.tool_calls[0];
      const fnName = toolCall.function.name;
      let fnArgs: any;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch (parseErr: any) {
        console.error("[ai-group] Bad tool args JSON:", parseErr?.message);
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: "Invalid JSON in tool arguments" }) });
        claudeResponse = await withTimeout(callClaude(completionOptions)) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
        continue;
      }

      try {
        const result = await chatbgp.handleCrmToolCall(fnName, fnArgs, req, completionOptions, currentMessage, toolCall);
        if (result?.handled && result.response) {
          lastAction = result.response.action || lastAction;
          lastHandledReply = result.response.reply || lastHandledReply;
          completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
          completionOptions.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ result: result.response.reply || "done", action: result.response.action || null }),
          });
          claudeResponse = await withTimeout(callClaude(completionOptions)) as any;
          currentMessage = claudeResponse.choices?.[0]?.message;
          continue;
        }

        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: "Tool not handled" }) });
        claudeResponse = await withTimeout(callClaude(completionOptions)) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
      } catch (toolErr: any) {
        console.error("[ai-group] Tool call error:", toolErr?.message);
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }) });
        claudeResponse = await withTimeout(callClaude(completionOptions)) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
      }
    }

    if (io) io.to(`thread:${threadId}`).emit("stop_typing", { threadId, userId: "__chatbgp__" });

    let replyText = currentMessage?.content;
    if ((!replyText || !replyText.trim() || replyText.trim() === "__SKIP__") && lastHandledReply) {
      // Model went quiet after its tool run (or hit the hop cap) — post the
      // last tool summary rather than dropping the work on the floor.
      replyText = lastHandledReply;
    }
    if (!replyText || replyText.trim() === "__SKIP__") {
      if (mentionsChatBGP) {
        replyText = "I'm here! How can I help?";
        console.log(`[ai-group] Mention override — forcing response in ${Date.now() - startTime}ms`);
      } else {
        console.log(`[ai-group] Skipped in ${Date.now() - startTime}ms`);
        return;
      }
    }

    const saved = await storage.createChatMessage({
      threadId,
      role: "assistant",
      content: replyText,
      userId: null,
      actionData: lastAction ? JSON.stringify(lastAction) : null,
      attachments: null,
    });
    emitNewMessage(threadId, saved, "ChatBGP");
    console.log(`[ai-group] Responded in ${Date.now() - startTime}ms (${loopCount} tool hops)`);
  } catch (err: any) {
    console.error("[ai-group] AI response failed:", err?.message);
    if (io) io.to(`thread:${threadId}`).emit("stop_typing", { threadId, userId: "__chatbgp__" });
    const fallback = "Sorry, I had a bit of a hiccup there. Could you say that again?";
    const saved = await storage.createChatMessage({
      threadId,
      role: "assistant",
      content: fallback,
      userId: null,
      actionData: null,
      attachments: null,
    });
    emitNewMessage(threadId, saved, "ChatBGP");
    console.log(`[ai-group] Sent error fallback in ${Date.now() - startTime}ms`);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const { registerImageStudioRoutes } = await import("./image-studio");
  registerImageStudioRoutes(app);

  const { registerLeaseEventRoutes } = await import("./lease-events");
  registerLeaseEventRoutes(app);

  const { registerLandlordHunterRoutes } = await import("./landlord-hunter");
  registerLandlordHunterRoutes(app);

  const { registerLenderRoutes } = await import("./lender-routes");
  registerLenderRoutes(app);

  const { registerAdminRoutes } = await import("./admin-routes");
  registerAdminRoutes(app);

  const { registerIntegrationsStatusRoutes } = await import("./integrations-status");
  registerIntegrationsStatusRoutes(app);

  const { registerAutoDeployRoutes } = await import("./auto-deploy");
  registerAutoDeployRoutes(app);

  const { registerOSDataRoutes } = await import("./os-data");
  registerOSDataRoutes(app);

  const express = await import("express");

  app.post("/api/admin/seed-data", express.default.json({ limit: "50mb" }), async (req: Request, res) => {
    try {
      const authHeader = req.headers.authorization;
      const seedKey = process.env.SESSION_SECRET;
      if (!authHeader || !seedKey || authHeader !== `SeedKey ${seedKey}`) {
        return res.status(403).json({ message: "Invalid seed key" });
      }
      const { sql: sqlData, gzipped } = req.body;
      if (!sqlData) {
        return res.status(400).json({ message: "No SQL data provided" });
      }
      let sqlContent = sqlData;
      if (gzipped) {
        const buf = Buffer.from(sqlData, "base64");
        sqlContent = gunzipSync(buf).toString("utf-8");
      }
      const result = await executeSeedSql(sqlContent);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Seed failed" });
    }
  });

  // Chat media downloads — support both Bearer token and ?token= query param
  // This allows mobile browsers to download files via plain <a href> links
  app.get("/api/chat-media/:filename", async (req: Request, res) => {
    // Allow auth via query param for direct mobile downloads
    if (!req.session?.userId && !req.tokenUserId && req.query.token) {
      try {
        const userId = await getUserIdFromToken(req.query.token as string);
        if (userId) req.tokenUserId = userId;
      } catch {}
    }
    if (!req.session?.userId && !req.tokenUserId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const filename = String(req.params.filename || "");
      if (filename.includes("..") || filename.includes("/")) return res.status(400).end();
      const file = await getFile(`chat-media/${filename}`);
      if (!file) {
        const diskPath = path.join(CHAT_MEDIA_DIR, filename);
        if (fs.existsSync(diskPath)) return res.sendFile(diskPath);
        return res.status(404).end();
      }
      res.set("Content-Type", file.contentType);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      const downloadTypes = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ];
      if (downloadTypes.includes(file.contentType)) {
        const dlName = file.originalName || filename;
        res.set("Content-Disposition", contentDispositionFor(dlName));
      }
      res.send(file.data);
    } catch (err: any) { console.error("[routes] File download error:", err?.message); res.status(500).end(); }
  });

  // Wrap multer so its errors (esp. LIMIT_FILE_SIZE) return a clear JSON
  // message the client can show, instead of falling through to the generic
  // 500 handler. The old opaque failure is what made oversized brochures
  // look like a mysterious "storage" problem.
  const chatUploadMw = (req: any, res: any, next: any) => {
    chatMediaUpload.array("files", 10)(req, res, (err: any) => {
      if (err) {
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({
          message: tooBig
            ? "File too large — the limit is 100 MB per file. Compress or split the PDF and try again."
            : (err?.message || "Upload failed"),
        });
      }
      next();
    });
  };
  app.post("/api/chat/upload", requireAuth, chatUploadMw, async (req: Request, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }
      const userId = (req as any).userId || req.session?.userId || null;
      const uploaded = await Promise.all(files.map(async (f) => {
        const ext = path.extname(f.originalname).toLowerCase();
        const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
        const storageKey = `chat-media/${uniqueName}`;
        await saveFile(storageKey, f.buffer, f.mimetype, f.originalname);
        const url = `/api/chat-media/${uniqueName}`;
        // Track per-user so ChatBGP can list "what has Woody uploaded
        // recently" without needing the exact filename — fixes the "file
        // vanished" complaint when the user comes back in a new session.
        if (userId) {
          recordUserUpload(userId, storageKey, f.originalname, f.mimetype, f.size, url).catch(() => {});
        }
        return { url, name: f.originalname, size: f.size, type: f.mimetype };
      }));
      res.json({ files: uploaded });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Upload failed" });
    }
  });

  app.post("/api/proxy-image", requireAuth, async (req: Request, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string" || (!url.startsWith("https://") && !url.startsWith("http://"))) {
        return res.status(400).json({ message: "Invalid URL" });
      }
      let parsed: URL;
      try { parsed = new URL(url); } catch { return res.status(400).json({ message: "Invalid URL" }); }
      const hostname = parsed.hostname.toLowerCase();
      const blockedPatterns = [
        /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
        /^0\./, /^169\.254\./, /^::1$/, /^fc/, /^fd/, /^fe80/,
        /\.local$/, /\.internal$/, /^metadata\.google/, /^169\.254\.169\.254$/,
      ];
      if (blockedPatterns.some(p => p.test(hostname))) {
        return res.status(400).json({ message: "URL not allowed" });
      }
      let currentUrl = url;
      let resp!: Awaited<ReturnType<typeof fetch>>;
      let redirects = 0;
      while (true) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          resp = await fetch(currentUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; BGPDashboard/1.0)" },
            redirect: "manual",
          });
        } finally {
          clearTimeout(timeout);
        }
        if (resp.status < 300 || resp.status >= 400) break;
        const location = resp.headers.get("location");
        if (!location) break;
        if (++redirects > 5) return res.status(502).json({ message: "Too many redirects" });
        let next: URL;
        try { next = new URL(location, currentUrl); } catch { return res.status(400).json({ message: "Invalid redirect" }); }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return res.status(400).json({ message: "URL not allowed" });
        }
        if (blockedPatterns.some(p => p.test(next.hostname.toLowerCase()))) {
          return res.status(400).json({ message: "URL not allowed" });
        }
        currentUrl = next.toString();
      }
      if (!resp.ok) return res.status(502).json({ message: `Failed to fetch image: ${resp.status}` });
      const contentType = resp.headers.get("content-type") || "image/png";
      if (!contentType.startsWith("image/")) return res.status(400).json({ message: "URL is not an image" });
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length === 0) return res.status(400).json({ message: "Empty image" });
      if (buffer.length > 25 * 1024 * 1024) return res.status(400).json({ message: "Image too large" });
      const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
      await saveFile(`chat-media/${uniqueName}`, buffer, contentType, `pasted-image.${ext}`);
      res.json({
        url: `/api/chat-media/${uniqueName}`,
        name: `pasted-image.${ext}`,
        size: buffer.length,
        type: contentType,
      });
    } catch (err: any) {
      console.error("[proxy-image] Error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to proxy image" });
    }
  });

  app.get("/api/config/maps-key", requireAuth, (_req, res) => {
    res.json({ key: process.env.GOOGLE_API_KEY || "" });
  });

  const GOAD_DIR = path.join(process.cwd(), "data", "goad");
  const GOAD_LAYERS: Record<string, string> = {
    lg: "9033MM_LG_WGS84.geojson",
    gf: "9033MM_GF_WGS84.geojson",
    f1: "9033MM_F1_WGS84.geojson",
    f2: "9033MM_F2_WGS84.geojson",
  };
  // Diagnostic — exposes which external data sources the live server can
  // see. Lets us tell at a glance whether PROPERTYDATA_API_KEY /
  // GOOGLE_API_KEY / Companies House key / VOA SQLite are actually
  // wired up in the current environment. No secrets returned — booleans
  // and counts only.
  app.get("/api/admin/data-sources", requireAuth, (_req, res) => {
    res.json({
      propertyDataKey: !!process.env.PROPERTYDATA_API_KEY,
      propertyDataKeyLength: process.env.PROPERTYDATA_API_KEY?.length || 0,
      googleApiKey: !!process.env.GOOGLE_API_KEY,
      companiesHouseKey: !!process.env.COMPANIES_HOUSE_API_KEY,
      anthropicKey: !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY),
      voaSqliteAvailable: voaSqliteAvailable(),
      voaSqlitePath: process.env.VOA_SQLITE_PATH || null,
      goadFiles: Object.entries(GOAD_LAYERS).map(([id, file]) => ({
        id,
        exists: fs.existsSync(path.join(GOAD_DIR, file)),
      })),
      nodeEnv: process.env.NODE_ENV || null,
    });
  });

  app.get("/api/goad/layers", requireAuth, (_req, res) => {
    const layers = Object.entries(GOAD_LAYERS).map(([id, file]) => {
      const p = path.join(GOAD_DIR, file);
      const exists = fs.existsSync(p);
      return { id, file, exists, sizeBytes: exists ? fs.statSync(p).size : 0 };
    });
    res.json({ centreCode: "9033MM", centreName: "London West End", layers });
  });
  app.get("/api/goad/:layer", requireAuth, (req, res, next) => {
    const layerParam = String(req.params.layer || "").toLowerCase();
    // Critical: don't shadow other /api/goad/<name> routes registered
    // AFTER this one. Express evaluates in declaration order — a
    // wildcard like :layer otherwise eats /api/goad/polygon-context
    // and returns 404 because 'polygon-context' isn't in GOAD_LAYERS.
    if (!(layerParam in GOAD_LAYERS)) return next();
    const file = GOAD_LAYERS[layerParam];
    if (!file) return res.status(404).json({ message: "Unknown Goad layer" });
    const diskPath = path.join(GOAD_DIR, file);
    if (!fs.existsSync(diskPath)) return res.status(404).json({ message: "Goad layer file not found" });
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Content-Type", "application/geo+json");
    return res.sendFile(diskPath);
  });

  // Polygon context: when a user clicks a Goad polygon, hand the side
  // panel everything BGP already knows about that unit — CRM property,
  // recent deals, and (cheap) a parent-company hit by HoldingCo name.
  // VOA / Companies House / Land Registry can be layered on later; this
  // first cut is the join most useful day-to-day.
  app.get("/api/goad/polygon-context", requireAuth, async (req: any, res) => {
    let postcode = String(req.query.postcode || "").trim().toUpperCase();
    const streetNum = String(req.query.streetNum || "").trim();
    const street = String(req.query.street || "").trim().toUpperCase();
    const holding = String(req.query.holding || "").trim();
    const fascia = String(req.query.fascia || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    if (!postcode && !street && !(lat && lng)) {
      return res.json({ crmProperties: [], deals: [], parentCompany: null, landRegistry: null, rates: [], planningApplications: [], pathwayRun: null, tenantCompany: null });
    }

    // Goad polygons don't always carry a Postcode attribute. When the click
    // only gave us coords, reverse-geocode once via Google to recover the
    // postcode — every downstream search (VOA, Planning, Land Registry,
    // Pathway) is keyed on postcode, so without this they all return empty
    // and only the fascia/holding company lookups survive.
    let postcodeRecoveredFromGeocode = false;
    if (!postcode && typeof lat === "number" && typeof lng === "number" && process.env.GOOGLE_API_KEY) {
      try {
        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_API_KEY}&result_type=premise|street_address|subpremise|establishment`;
        const gResp = await fetch(gUrl, { signal: AbortSignal.timeout(5000) });
        if (gResp.ok) {
          const gData = await gResp.json() as any;
          const pc = (gData.results?.[0]?.address_components || [])
            .find((c: any) => c.types?.includes("postal_code"))?.long_name || "";
          if (pc) {
            postcode = pc.toUpperCase();
            postcodeRecoveredFromGeocode = true;
            console.log(`[polygon-context] postcode recovered from geocode: ${postcode} (lat=${lat}, lng=${lng})`);
          }
        }
      } catch (e: any) {
        console.warn(`[polygon-context] reverse-geocode for postcode failed:`, e?.message);
      }
    }

    // Correct the postcode via OS Places before any lookup. Goad's postcode
    // is sometimes wrong (e.g. "W1K 2AP" where the building is really
    // "W1K 2TJ"), and HMLR-direct keys ownership on postcode + street number,
    // so a wrong postcode misses the titles entirely and we fall to noise.
    // Resolve the canonical OS DPA for this unit and adopt ITS postcode + UPRN
    // — the OS Places product is live (confirmed via /api/property-data/health).
    let osUprn: string | null = null;
    let osResolved: any = null;
    const numHead = String(streetNum).replace(/\s+/g, "").split(/[-–—,]/)[0];
    try {
      const { osPlacesNearest, osPlacesFind } = await import("./os-data");
      let candidates: any[] = [];
      // Prefer the Goad CENTROID via OS Places nearest — this doesn't rely on
      // Goad's postcode (which can be wrong, e.g. 2AP vs the real 2TJ).
      if (typeof lat === "number" && typeof lng === "number") {
        for (const radius of [25, 50, 90]) {
          candidates = await osPlacesNearest(lat, lng, radius);
          if (candidates.length) break;
        }
      }
      // Fall back to a number + street search WITHOUT Goad's (possibly wrong)
      // postcode, if coords gave us nothing.
      if (!candidates.length && street) {
        candidates = await osPlacesFind([numHead, street, "London"].filter(Boolean).join(" "), 5);
      }
      // Prefer a candidate whose address carries the Goad street number.
      const pick = (numHead
        ? candidates.find((d: any) => new RegExp(`(^|[^0-9])${numHead}([^0-9]|$)`).test((d.address || "").toLowerCase()))
        : null) || candidates[0];
      if (pick?.postcode) postcode = String(pick.postcode).toUpperCase();
      if (pick?.uprn) osUprn = String(pick.uprn);
      osResolved = pick ? { uprn: pick.uprn || null, postcode: pick.postcode || null, address: pick.address || null } : null;
      if (pick) console.log(`[polygon-context] OS resolved → ${postcode}${osUprn ? ` UPRN ${osUprn}` : ""} (${pick.address || ""})`);
    } catch (e: any) { console.warn("[polygon-context] OS resolve failed:", e?.message); }

    const addressPattern = streetNum && street ? `%${streetNum} ${street}%` : street ? `%${street}%` : "";
    // Reconstruct the address line for the Land Registry resolver.
    const lrAddress = [streetNum, street, postcode].filter(Boolean).join(" ");
    // PropertyData wants postcodes WITHOUT a space ("W1J8NR", not "W1J 8NR")
    // — most of its endpoints silently return zero results for the spaced
    // form. That was the 'board only showing Goad stuff' bug.
    const postcodeNoSpace = postcode.replace(/\s+/g, "");
    const userId = req.session?.userId || req.tokenUserId || null;
    const PD_KEY = process.env.PROPERTYDATA_API_KEY;

    try {
      const [crmRows, dealRows, parentRows, lrResult, planningResult, pathwayRow, tenantRows] = await Promise.all([
        pool.query(
          `SELECT p.id, p.name, p.status, p.asset_class, p.sqft, p.postcode, p.latitude, p.longitude,
                  p.address, p.monday_item_id, p.group_name,
                  p.landlord_id,
                  lc.name AS landlord_name, lc.company_type AS landlord_type,
                  lc.company_number AS landlord_company_number,
                  fc.id AS freeholder_id, fc.name AS freeholder_name
           FROM crm_properties p
           LEFT JOIN crm_companies lc ON lc.id = p.landlord_id
           LEFT JOIN crm_companies fc ON fc.id = p.freeholder_id
           WHERE (p.postcode IS NOT NULL AND UPPER(REPLACE(p.postcode, ' ', '')) = REPLACE($1, ' ', ''))
              OR ($2 <> '' AND (UPPER(p.name) LIKE $2 OR UPPER(p.address::text) LIKE $2))
           LIMIT 8`,
          [postcode, addressPattern],
        ).catch(() => ({ rows: [] as any[] })),
        pool.query(
          `SELECT d.id, d.name, d.deal_type, d.status, d.team, d.fee, d.completed_at, d.created_at,
                  p.name AS property_name, p.postcode AS property_postcode
           FROM crm_deals d
           LEFT JOIN crm_properties p ON p.id = d.property_id
           WHERE (p.postcode IS NOT NULL AND UPPER(REPLACE(p.postcode, ' ', '')) = REPLACE($1, ' ', ''))
              OR ($2 <> '' AND UPPER(p.name) LIKE $2)
           ORDER BY d.created_at DESC NULLS LAST
           LIMIT 10`,
          [postcode, addressPattern],
        ).catch(() => ({ rows: [] as any[] })),
        holding && holding !== "NON MULTIPLE"
          ? pool.query(
              `SELECT id, name, company_number, company_type, status, website
               FROM crm_companies
               WHERE UPPER(name) = UPPER($1)
                  OR UPPER(name) LIKE UPPER($2)
               LIMIT 3`,
              [holding, `%${holding}%`],
            ).catch(() => ({ rows: [] as any[] }))
          : Promise.resolve({ rows: [] as any[] }),
        // Land Registry — hit the real API via the existing resolver. It
        // returns matched freeholds/leaseholds for this exact building.
        (postcode || (lat && lng))
          ? resolveBuildingTitles({
              address: lrAddress || undefined,
              postcode: postcode || undefined,
              lat,
              lng,
              uprn: osUprn,
              source: "goad-polygon",
              userId,
              skipPersist: true,
            }).catch((err: any) => ({ ok: false, status: 500, error: err?.message || "lr lookup failed" }))
          : Promise.resolve({ ok: false, status: 0, error: "no address" }),
        // Planning applications via PlanIt (planit.org.uk) — the same source
        // the Pathway planning card uses. It scrapes every UK LPA portal
        // (incl. Westminster, which TCP-blocks our egress IP) and needs no
        // API key, so it gives better coverage than the PropertyData postcode
        // endpoint. ~200m radius, last 10 yrs. Mapped to the snake_case shape
        // the panel already renders.
        postcode
          ? fetchPlanitPlanning(postcode, lrAddress || street || "", { maxAgeYears: 10, radiusKm: 0.2 })
              .then((apps) => apps.map((a) => ({
                description: a.description,
                decision: a.decision,
                status: a.status,
                decided_date: a.decidedAt || null,
                received_date: a.receivedAt || null,
                reference: a.reference,
                address: a.address,
                documentUrl: a.documentUrl,
                lpa: a.lpa,
              })))
              .catch(() => [] as any[])
          : Promise.resolve([] as any[]),
        // Latest Pathway run for this address/postcode — so the panel can
        // either link to it or surface a "Start Pathway" button.
        postcode || street
          ? pool.query(
              `SELECT id, address, postcode, status, updated_at
               FROM property_pathway_runs
               WHERE ($1 <> '' AND REPLACE(UPPER(postcode), ' ', '') = $1)
                  OR ($2 <> '' AND LOWER(address) LIKE $2)
               ORDER BY updated_at DESC
               LIMIT 1`,
              [postcode.replace(/\s+/g, ""), addressPattern.toLowerCase()],
            ).then((r) => r.rows[0] || null).catch(() => null)
          : Promise.resolve(null),
        // Tenant CRM match by fascia name. The fascia is the brand
        // currently trading from the unit (e.g. "BUBALA"), distinct
        // from HoldingCo (the legal parent). We look for a company
        // whose name matches the fascia exactly, then loosely.
        fascia
          ? pool.query(
              `SELECT id, name, company_number, company_type, status, website
               FROM crm_companies
               WHERE UPPER(name) = UPPER($1)
                  OR UPPER(name) LIKE UPPER($2)
               ORDER BY (CASE WHEN UPPER(name) = UPPER($1) THEN 0 ELSE 1 END)
               LIMIT 3`,
              [fascia, `%${fascia}%`],
            ).catch(() => ({ rows: [] as any[] }))
          : Promise.resolve({ rows: [] as any[] }),
      ]);

      let landRegistry: any = null;
      if (lrResult && (lrResult as any).ok) {
        const r: any = lrResult;
        landRegistry = {
          resolvedAddress: r.resolvedAddress,
          buildingName: r.buildingName,
          source: r.source, // "uprn" | "street_number" | "postcode_only"
          exact: r.matched?.exact || false,
          uprns: r.uprns || [],
          matched: {
            freeholds: (r.matched?.freeholds || []).slice(0, 8),
            leaseholds: (r.matched?.leaseholds || []).slice(0, 8),
          },
          fallback: {
            freeholds: (r.fallback?.freeholds || []).slice(0, 8),
            leaseholds: (r.fallback?.leaseholds || []).slice(0, 8),
            usedStreetNumberMatch: r.fallback?.usedStreetNumberMatch || false,
          },
          context: {
            freeholds: (r.context?.freeholds || []).slice(0, 8),
          },
        };
      }

      // VOA rates from the SQLite snapshot — by postcode then narrowed by
      // the Goad street number when present. Returns the actual unit-level
      // rateable values, not a postcode-wide aggregate.
      let rates: any[] = [];
      if (postcode && voaSqliteAvailable()) {
        const all = lookupVoaByPostcode(postcode, street || undefined, 60);
        const numTrimmed = streetNum.replace(/\s+/g, "").toLowerCase();
        if (numTrimmed) {
          // Match if the VOA address starts with this number (e.g. "188-196 Regent Street" → starts with "188")
          const head = numTrimmed.split(/[-–—,]/)[0];
          rates = all.filter((r) => {
            const addr = (r.address || "").toLowerCase().replace(/\s+/g, " ");
            return head && (addr.startsWith(head + " ") || addr.startsWith(head + ",") || addr.startsWith(head + "-") || addr.includes(`/${head} `) || addr.startsWith(numTrimmed));
          });
          // Fall back to the whole postcode list if filtering nuked everything
          if (rates.length === 0) rates = all.slice(0, 30);
        } else {
          rates = all.slice(0, 30);
        }
      }

      // Planning applications: cap at 10 yrs (PD returns dates in d.decided_date / d.received_date)
      const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - TEN_YEARS_MS;
      const planningApplications = (planningResult as any[])
        .filter((a) => {
          const d = a?.decided_date || a?.received_date || a?.date;
          if (!d) return true; // keep undated
          const t = new Date(d).getTime();
          return Number.isFinite(t) ? t >= cutoff : true;
        })
        .slice(0, 20);

      // Fuzzy CRM fallback — only runs when the strict (exact-postcode /
      // name-LIKE) lookup found nothing, so it can never override a good
      // match. Catches the cases the strict query misses: the address
      // living in `address` not `name`, "St" vs "Street" abbreviations,
      // and a slightly different postcode on the CRM record (e.g. the
      // building spans W1K 2TJ and W1K 2AP). Anchored on the street number
      // so it can't drag in unrelated properties on the same street.
      let crmPropertiesOut = crmRows.rows;
      if (crmPropertiesOut.length === 0 && street) {
        const normAddr = (s: string) => (s || "").toUpperCase()
          .replace(/\bSTREET\b/g, "ST").replace(/\bROAD\b/g, "RD")
          .replace(/\bAVENUE\b/g, "AVE").replace(/\bSQUARE\b/g, "SQ")
          .replace(/\bPLACE\b/g, "PL").replace(/[^A-Z0-9 ]/g, " ")
          .replace(/\s+/g, " ").trim();
        const streetCore = normAddr(street).replace(/\b(ST|RD|AVE|SQ|PL)\b/g, "").replace(/\s+/g, " ").trim();
        const numHead = String(streetNum).replace(/\s+/g, "").split(/[-–—,]/)[0];
        const outward = postcodeNoSpace.length > 3 ? postcodeNoSpace.slice(0, postcodeNoSpace.length - 3) : postcodeNoSpace;
        if (streetCore) {
          const cand = await pool.query(
            `SELECT p.id, p.name, p.status, p.asset_class, p.sqft, p.postcode, p.latitude, p.longitude,
                    p.address, p.monday_item_id, p.group_name, p.landlord_id,
                    lc.name AS landlord_name, lc.company_type AS landlord_type,
                    lc.company_number AS landlord_company_number,
                    fc.id AS freeholder_id, fc.name AS freeholder_name
             FROM crm_properties p
             LEFT JOIN crm_companies lc ON lc.id = p.landlord_id
             LEFT JOIN crm_companies fc ON fc.id = p.freeholder_id
             WHERE (p.postcode IS NOT NULL AND UPPER(REPLACE(p.postcode, ' ', '')) LIKE $1)
                OR UPPER(p.name) LIKE $2
                OR UPPER(p.address::text) LIKE $2
             LIMIT 40`,
            [`${outward}%`, `%${streetCore}%`],
          ).catch(() => ({ rows: [] as any[] }));
          crmPropertiesOut = cand.rows.filter((p: any) => {
            const hay = normAddr(`${p.name || ""} ${typeof p.address === "string" ? p.address : JSON.stringify(p.address || "")}`);
            if (!hay.includes(streetCore)) return false;
            if (numHead) return new RegExp(`(^|[^0-9])${numHead}([^0-9]|$)`).test(hay);
            return true;
          }).slice(0, 8);
        }
      }

      // When there's no CRM match for the fascia, try to resolve the tenant
      // via Google Places (name + website + phone) so the drawer can offer
      // a "verify on Companies House" → "add to CRM" mini-flow without
      // any name-only guessing. Only runs when fascia + coords are set
      // AND the CRM lookup turned up nothing — cheap path otherwise.
      let tenantPlace: any = null;
      if (fascia && tenantRows.rows.length === 0 && typeof lat === "number" && typeof lng === "number") {
        try {
          const { findPlaceWebsiteAtCoord } = await import("./goad-tenant-resolver");
          tenantPlace = await findPlaceWebsiteAtCoord(lat, lng, fascia);
        } catch (e: any) {
          console.warn("[polygon-context] tenant Places lookup failed:", e?.message);
        }
      }

      // Freeholder + head-leaseholder chain. resolveBuildingTitles already
      // returns the unit-level leaseholds (Mayfair Spirit Ltd at 43 Curzon
      // Street). This widens the search to the whole postcode and ranks
      // candidates by likely role: freeholder = block-level (multiple titles
      // by same proprietor, estate-style name, long-held), head-leaseholder
      // = older long-dated leasehold with multiple_address_indicator='Y'.
      let chain: any = null;
      if (postcode) {
        try {
          const { findFreeholderChain } = await import("./hmlr-direct");
          // Exclude unit-level title numbers from the chain search so we
          // don't surface the unit lease as its own "head-leaseholder".
          const matchedTitleNums: string[] = [];
          if (landRegistry) {
            for (const t of (landRegistry.matched?.freeholds || [])) if (t.title_number || t.titleNumber) matchedTitleNums.push(t.title_number || t.titleNumber);
            for (const t of (landRegistry.matched?.leaseholds || [])) if (t.title_number || t.titleNumber) matchedTitleNums.push(t.title_number || t.titleNumber);
          }
          // Use the unit lease's date as the reference for "significantly older"
          // when scoring head-leasehold candidates.
          const unitLeaseDate = landRegistry?.matched?.leaseholds?.[0]?.dateProprietorAdded
                             || landRegistry?.matched?.leaseholds?.[0]?.date_proprietor_added
                             || null;
          chain = await findFreeholderChain(postcode, street || null, matchedTitleNums, unitLeaseDate);
        } catch (e: any) {
          console.warn("[polygon-context] freeholder chain lookup failed:", e?.message);
        }
      }
      if (landRegistry && chain) landRegistry.chain = chain;

      res.json({
        crmProperties: crmPropertiesOut,
        deals: dealRows.rows,
        parentCompany: parentRows.rows[0] || null,
        parentCompanyCandidates: parentRows.rows,
        landRegistry,
        rates,
        planningApplications,
        pathwayRun: pathwayRow || null,
        tenantCompany: tenantRows.rows[0] || null,
        tenantCompanyCandidates: tenantRows.rows,
        tenantPlace,
        // Diagnostics so the panel can show 'we ran X but found nothing'
        // rather than silently hiding the section.
        diagnostics: {
          voaAvailable: voaSqliteAvailable(),
          propertyDataKeyAvailable: !!PD_KEY,
          landRegistryRan: lrResult && (lrResult as any).ok === true,
          landRegistryError: (lrResult as any)?.ok === false ? (lrResult as any).error : null,
          postcodeUsed: postcode || null,
          postcodeRecoveredFromGeocode,
          osResolved,
          osUprnUsed: osUprn,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load polygon context" });
    }
  });

  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      // Client logins only need id+name (agent chips/colors on their boards) —
      // not the staff directory with emails/teams. (Landsec audit.)
      if (await (await import("./company-scope")).isClientRequestUser(req)) {
        return res.json(allUsers.filter(u => u.isActive !== false).map(u => ({ id: u.id, name: u.name })));
      }
      res.json(allUsers.map(u => ({ id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, department: u.department, team: u.team, additionalTeams: u.additionalTeams || [], profilePicUrl: u.profilePicUrl || null, isActive: u.isActive !== false })));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users/:id/toggle-access", requireAuth, async (req: any, res) => {
    try {
      const adminId = req.session.userId || req.tokenUserId;
      const [admin] = await pool.query("SELECT is_admin FROM users WHERE id = $1", [adminId]).then(r => r.rows);
      if (!admin?.is_admin) return res.status(403).json({ message: "Admin access required" });

      const targetId = req.params.id;
      if (targetId === adminId) return res.status(400).json({ message: "You cannot deactivate your own account" });

      const { active } = req.body;
      await pool.query("UPDATE users SET is_active = $1 WHERE id = $2", [active, targetId]);

      if (!active) {
        await pool.query("DELETE FROM session WHERE sess::jsonb -> 'passport' ->> 'user' = $1 OR sess::jsonb ->> 'userId' = $1", [targetId]);
      }

      const [updated] = await pool.query("SELECT name, is_active FROM users WHERE id = $1", [targetId]).then(r => r.rows);
      res.json({ success: true, name: updated?.name, isActive: updated?.is_active });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update access" });
    }
  });

  app.post("/api/admin/users/:id/force-logout", requireAuth, async (req: any, res) => {
    try {
      const adminId = req.session.userId || req.tokenUserId;
      const [admin] = await pool.query("SELECT is_admin FROM users WHERE id = $1", [adminId]).then(r => r.rows);
      if (!admin?.is_admin) return res.status(403).json({ message: "Admin access required" });

      const targetId = req.params.id;
      const result = await pool.query("DELETE FROM session WHERE sess::jsonb -> 'passport' ->> 'user' = $1 OR sess::jsonb ->> 'userId' = $1", [targetId]);
      const [user] = await pool.query("SELECT name FROM users WHERE id = $1", [targetId]).then(r => r.rows);
      res.json({ success: true, name: user?.name, sessionsCleared: result.rowCount });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to force logout" });
    }
  });

  app.get("/api/properties/:id/instructions", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT pi.*, u.name as author_name FROM property_instructions pi LEFT JOIN users u ON pi.created_by = u.id WHERE pi.property_id = $1 ORDER BY pi.created_at DESC",
        [req.params.id]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/properties/:id/instructions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Content required" });
      const { rows } = await pool.query(
        "INSERT INTO property_instructions (property_id, content, created_by) VALUES ($1, $2, $3) RETURNING *",
        [req.params.id, content.trim(), userId]
      );
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/properties/:propertyId/instructions/:id", requireAuth, async (req, res) => {
    try {
      await pool.query("DELETE FROM property_instructions WHERE id = $1 AND property_id = $2", [req.params.id, req.params.propertyId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/properties/:id/project-files", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT pf.*, u.name as added_by_name FROM property_files pf LEFT JOIN users u ON pf.added_by = u.id WHERE pf.property_id = $1 ORDER BY pf.added_at DESC",
        [req.params.id]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/properties/:id/project-files", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      const { name, filePath, webUrl, size } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name required" });
      const { rows } = await pool.query(
        "INSERT INTO property_files (property_id, name, file_path, web_url, size, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [req.params.id, name.trim(), filePath || null, webUrl || null, size || null, userId]
      );
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/properties/:propertyId/project-files/:id", requireAuth, async (req, res) => {
    try {
      await pool.query("DELETE FROM property_files WHERE id = $1 AND property_id = $2", [req.params.id, req.params.propertyId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users/profile-pic", requireAuth, profilePicUpload.single("file"), async (req: any, res) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId || !req.file) return res.status(400).json({ message: "No file uploaded" });
      const ext = path.extname(req.file.originalname).toLowerCase();
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      await saveFile(`profile-pics/${uniqueName}`, req.file.buffer, req.file.mimetype, req.file.originalname);
      const url = `/uploads/profile-pics/${uniqueName}`;
      await pool.query("UPDATE users SET profile_pic_url = $1 WHERE id = $2", [url, userId]);
      res.json({ profilePicUrl: url });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Upload failed" });
    }
  });

  app.post("/api/chat/threads/:id/group-pic", requireAuth, profilePicUpload.single("file"), async (req: any, res) => {
    try {
      const threadId = req.params.id;
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const ext = path.extname(req.file.originalname).toLowerCase();
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      await saveFile(`profile-pics/${uniqueName}`, req.file.buffer, req.file.mimetype, req.file.originalname);
      const url = `/uploads/profile-pics/${uniqueName}`;
      await pool.query("UPDATE chat_threads SET group_pic_url = $1 WHERE id = $2", [url, threadId]);
      res.json({ groupPicUrl: url });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Upload failed" });
    }
  });

  app.get("/uploads/profile-pics/:filename", requireAuth, async (req, res) => {
    try {
      const filename = req.params.filename as string;
      if (filename.includes("..") || filename.includes("/")) return res.status(400).end();
      const file = await getFile(`profile-pics/${filename}`);
      if (!file) {
        const diskPath = path.join(PROFILE_PICS_DIR, filename);
        if (fs.existsSync(diskPath)) return res.sendFile(diskPath);
        return res.status(404).end();
      }
      res.set("Content-Type", file.contentType);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(file.data);
    } catch (err: any) { console.error("[routes] Chat file download error:", err?.message); res.status(500).end(); }
  });

  app.get("/api/projects", requireAuth, async (_req, res) => {
    try {
      const items = await storage.getProjects();
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const result = insertProjectSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: fromError(result.error).toString() });
      }
      const project = await storage.createProject(result.data);
      res.json(project);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to create project" });
    }
  });

  app.get("/api/team-events", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const days = parseInt(req.query.days as string) || 14;
      const now = new Date();
      const end = new Date(now);
      end.setDate(end.getDate() + days);
      // Client logins (and staff in client view) only see their own
      // company's events — the client-events-sync rows plus any manual
      // team event tagged with their company name. BGP's wider diary
      // never crosses over.
      const teScope = await resolveCompanyScope(req);
      const result = teScope
        ? await pool.query(
            `SELECT * FROM team_events
              WHERE start_time >= $1 AND start_time <= $2
                AND company_name = (SELECT name FROM crm_companies WHERE id = $3)
              ORDER BY start_time`,
            [now.toISOString(), end.toISOString(), teScope]
          )
        : await pool.query(
            `SELECT * FROM team_events WHERE start_time >= $1 AND start_time <= $2 ORDER BY start_time`,
            [now.toISOString(), end.toISOString()]
          );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch team events" });
    }
  });

  app.post("/api/team-events", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { title, event_type, start_time, end_time, property_id, property_name, deal_id, company_name, location, attendees, notes, created_by } = req.body;
      if (!title || typeof title !== "string" || !start_time || !end_time) {
        return res.status(400).json({ message: "Title, start_time, and end_time are required" });
      }
      const result = await pool.query(
        `INSERT INTO team_events (title, event_type, start_time, end_time, property_id, property_name, deal_id, company_name, location, attendees, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [title, event_type, start_time, end_time, property_id, property_name, deal_id, company_name, location, attendees || [], notes, created_by]
      );
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to create team event" });
    }
  });

  app.delete("/api/team-events/:id", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      const isAdmin = adminCheck.rows[0]?.is_admin === true;
      const existing = await pool.query("SELECT created_by FROM team_events WHERE id = $1", [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ message: "Event not found" });
      if (!isAdmin && String(existing.rows[0].created_by) !== String(userId)) {
        return res.status(403).json({ message: "You can only delete events you created" });
      }
      await pool.query(`DELETE FROM team_events WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete team event" });
    }
  });

  app.get("/api/team-members", requireAuth, async (_req, res) => {
    try {
      const members = await db.select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        department: users.department,
        team: users.team,
        isActive: users.isActive,
      }).from(users).orderBy(users.name);
      res.json(members);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch team members" });
    }
  });

  app.patch("/api/team-members/:id/team", requireAuth, async (req: any, res) => {
    try {
      const adminId = req.session.userId || req.tokenUserId;
      const [admin] = await pool.query("SELECT is_admin FROM users WHERE id = $1", [adminId]).then(r => r.rows);
      if (!admin?.is_admin) return res.status(403).json({ message: "Admin access required" });

      const { id } = req.params;
      const { team } = req.body;
      if (!team || typeof team !== "string") {
        return res.status(400).json({ message: "Team is required" });
      }
      const validTeams = ["Development", "London F&B", "London Retail", "National Leasing", "Investment", "Tenant Rep", "Lease Advisory", "Office / Corporate", "Landsec"];
      if (!validTeams.includes(team)) {
        return res.status(400).json({ message: "Invalid team" });
      }
      await db.update(users).set({ team }).where(eq(users.id, id as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update team" });
    }
  });

  // ============================================================
  // People & HR — org chart, profiles, birthdays
  // ============================================================
  // Public-tier fields visible to the whole team (everyone authenticated).
  // Sensitive fields (address, dob, personal_email, employment_type, salary
  // history, etc.) are restricted to the user themselves + admins.
  const HR_PUBLIC_COLUMNS = `
    id, username, name, email, phone, role, department, team, additional_teams,
    profile_pic_url, manager_id, board_member, management_team, display_order,
    wfh_days, bio, cv_url, is_active, is_admin
  `;
  const HR_PRIVATE_COLUMNS = `
    dob, address, personal_email, employment_type, start_date
  `;

  app.get("/api/hr/team", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      const isAdmin = adminCheck.rows[0]?.is_admin === true;

      // Admins get the full HR record for everyone; non-admins get the public
      // tier for everyone plus the private tier for themselves only.
      const sql = isAdmin
        ? `SELECT ${HR_PUBLIC_COLUMNS}, ${HR_PRIVATE_COLUMNS} FROM users WHERE is_active = true ORDER BY display_order, name`
        : `SELECT ${HR_PUBLIC_COLUMNS},
              CASE WHEN id = $1 THEN dob ELSE NULL END AS dob,
              CASE WHEN id = $1 THEN address ELSE NULL END AS address,
              CASE WHEN id = $1 THEN personal_email ELSE NULL END AS personal_email,
              CASE WHEN id = $1 THEN employment_type ELSE NULL END AS employment_type,
              CASE WHEN id = $1 THEN start_date ELSE NULL END AS start_date
            FROM users WHERE is_active = true ORDER BY display_order, name`;
      const params = isAdmin ? [] : [userId];
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch team" });
    }
  });

  app.get("/api/hr/birthdays", requireAuth, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(60, parseInt(String(req.query.days || "14"), 10) || 14));
      // Birthdays are stored as ISO YYYY-MM-DD strings. Match on month/day so
      // age is irrelevant; window crosses the year boundary if needed.
      // DOB is owned by staff_profiles (the HR record); the old users.dob
      // column is no longer written now that the Team page is retired.
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.role, u.team, u.profile_pic_url, sp.dob
           FROM users u
           LEFT JOIN staff_profiles sp ON sp.user_id = u.id
          WHERE u.is_active = true AND sp.dob IS NOT NULL`
      );
      const today = new Date();
      const upcoming = rows
        .map((r: any) => {
          const dob = String(r.dob);
          const m = dob.match(/-(\d{2})-(\d{2})$/);
          if (!m) return null;
          const month = parseInt(m[1], 10) - 1;
          const day = parseInt(m[2], 10);
          const next = new Date(today.getFullYear(), month, day);
          if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
            next.setFullYear(today.getFullYear() + 1);
          }
          const diffDays = Math.round((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return diffDays >= 0 && diffDays <= days
            ? { id: r.id, name: r.name, role: r.role, team: r.team, profilePicUrl: r.profile_pic_url, date: next.toISOString().slice(0, 10), daysUntil: diffDays }
            : null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.daysUntil - b.daysUntil);
      res.json(upcoming);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch birthdays" });
    }
  });

  // Updates: admins can edit anyone's full record; non-admins can edit only
  // their own personal-tier fields (no role, team, manager, admin flags).
  app.patch("/api/hr/team/:id", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      const targetId = req.params.id;
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      const isAdmin = adminCheck.rows[0]?.is_admin === true;
      const isSelf = String(userId) === String(targetId);
      if (!isAdmin && !isSelf) return res.status(403).json({ message: "You can only edit your own profile" });

      const allowed = isAdmin
        ? new Set([
            "name", "email", "phone", "role", "department", "team", "additionalTeams",
            "managerId", "boardMember", "managementTeam", "displayOrder",
            "dob", "address", "personalEmail", "wfhDays", "employmentType",
            "startDate", "cvUrl", "bio", "isActive", "isAdmin",
          ])
        : new Set([
            "phone", "dob", "address", "personalEmail", "wfhDays",
            "cvUrl", "bio",
          ]);

      const camelToSnake = (s: string) => s.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
      // Booleans must go in as real booleans, not the string "true".
      const boolFields = new Set(["isAdmin", "boardMember", "managementTeam", "isActive"]);
      const sets: string[] = [];
      const params: any[] = [];
      let p = 1;
      for (const [key, value] of Object.entries(req.body || {})) {
        if (!allowed.has(key)) continue;
        sets.push(`${camelToSnake(key)} = $${p++}`);
        params.push(boolFields.has(key) ? value === true || value === "true" : value);
      }
      if (sets.length === 0) return res.status(400).json({ message: "No editable fields supplied" });
      params.push(targetId);
      await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${p}`, params);

      const { rows } = await pool.query(`SELECT ${HR_PUBLIC_COLUMNS}, ${HR_PRIVATE_COLUMNS} FROM users WHERE id = $1`, [targetId]);
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update profile" });
    }
  });

  // Admin: create a new person on the org chart.
  app.post("/api/hr/team", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      if (adminCheck.rows[0]?.is_admin !== true) return res.status(403).json({ message: "Admin access required" });

      const { name, role, team, managerId, email, phone, additionalTeams, boardMember, managementTeam } = req.body || {};
      if (!name || typeof name !== "string") return res.status(400).json({ message: "Name is required" });

      const username = name.toLowerCase().replace(/['']/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
      const bcrypt = await import("bcrypt");
      const placeholderHash = await bcrypt.default.hash(`bgp-placeholder-${Date.now()}`, 10);

      const { rows } = await pool.query(
        `INSERT INTO users (
          username, password, name, role, team, additional_teams, manager_id,
          board_member, management_team, email, phone, is_admin, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,true)
         RETURNING ${HR_PUBLIC_COLUMNS}`,
        [
          username, placeholderHash, name.trim(), role || null, team || null,
          additionalTeams || [], managerId || null,
          boardMember === true, managementTeam === true, email || null, phone || null,
        ]
      );
      res.json(rows[0]);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(409).json({ message: "Username already exists — try a different name" });
      res.status(500).json({ message: err?.message || "Failed to create person" });
    }
  });

  // Admin: deactivate (soft-delete) a person from the org chart. Their direct
  // reports become orphaned; the page surfaces these for re-assignment.
  app.delete("/api/hr/team/:id", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      if (adminCheck.rows[0]?.is_admin !== true) return res.status(403).json({ message: "Admin access required" });
      if (String(userId) === String(req.params.id)) return res.status(400).json({ message: "You cannot remove yourself" });
      await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to remove person" });
    }
  });

  // Admin: one-shot seed of the BGP org chart (idempotent — safe to re-run).
  app.post("/api/admin/seed-team", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      if (adminCheck.rows[0]?.is_admin !== true) return res.status(403).json({ message: "Admin access required" });
      const { seedBgpOrgChart } = await import("./seed-team");
      const result = await seedBgpOrgChart();
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[seed-team]", err);
      res.status(500).json({ message: err?.message || "Failed to seed team" });
    }
  });

  app.post("/api/heartbeat", requireAuth, async (req, res) => {
    const userId = req.session.userId || (req as any).tokenUserId;
    if (!userId) return res.status(401).json({ ok: false });
    try {
      const existing = await pool.query("SELECT id, current_session_start, last_heartbeat_at FROM user_activity WHERE user_id = $1", [userId]);
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        const lastHb = row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null;
        const now = new Date();
        let addMinutes = 0;
        if (lastHb && (now.getTime() - lastHb.getTime()) < 3 * 60 * 1000) {
          addMinutes = Math.round((now.getTime() - lastHb.getTime()) / 60000);
        }
        if (!row.current_session_start || !lastHb || (now.getTime() - lastHb.getTime()) > 5 * 60 * 1000) {
          await pool.query(
            "UPDATE user_activity SET current_session_start = NOW(), last_heartbeat_at = NOW(), last_active_at = NOW() WHERE user_id = $1",
            [userId]
          );
        } else {
          await pool.query(
            "UPDATE user_activity SET last_heartbeat_at = NOW(), last_active_at = NOW(), total_session_minutes = COALESCE(total_session_minutes, 0) + $2 WHERE user_id = $1",
            [userId, addMinutes]
          );
        }
      } else {
        await pool.query(
          "INSERT INTO user_activity (user_id, current_session_start, last_heartbeat_at, last_active_at, total_session_minutes) VALUES ($1, NOW(), NOW(), NOW(), 0)",
          [userId]
        );
      }
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Heartbeat error:", err.message);
      res.status(500).json({ ok: false });
    }
  });

  app.get("/api/admin/user-activity", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId || (req as any).tokenUserId;
      const adminCheck = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      if (!adminCheck.rows[0]?.is_admin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const result = await pool.query(`
        SELECT 
          u.id, u.name, u.email, u.role, u.team, u.profile_pic_url,
          ua.last_login_at, ua.login_count, ua.last_active_at, ua.login_method,
          ua.o365_linked, ua.o365_linked_at, ua.chatbgp_message_count, ua.last_chatbgp_at, ua.page_views,
          ua.total_session_minutes, ua.current_session_start, ua.last_heartbeat_at,
          CASE WHEN m.user_id IS NOT NULL THEN true ELSE false END as has_msal_cache,
          m.updated_at as msal_cache_updated,
          (SELECT COUNT(*) FROM auth_tokens t WHERE t.user_id = u.id AND t.expires_at > NOW()) as active_token_count,
          (SELECT COUNT(*) FROM chat_messages cm JOIN chat_threads ct ON cm.thread_id = ct.id WHERE ct.created_by = u.id AND ct.is_ai_chat = true) as total_ai_messages,
          (SELECT MAX(cm.created_at) FROM chat_messages cm JOIN chat_threads ct ON cm.thread_id = ct.id WHERE ct.created_by = u.id AND ct.is_ai_chat = true) as last_ai_message_at
        FROM users u
        LEFT JOIN user_activity ua ON ua.user_id = u.id
        LEFT JOIN msal_token_cache m ON m.user_id = u.id
        ORDER BY ua.last_active_at DESC NULLS LAST, u.name ASC
      `);
      
      const activeSessionsResult = await pool.query(`
        SELECT sess FROM session WHERE expire > NOW()
      `);
      const activeUserIds = new Set<string>();
      const msTokenUserIds = new Set<string>();
      for (const row of activeSessionsResult.rows) {
        try {
          const s = typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
          if (s?.userId) {
            activeUserIds.add(s.userId);
            if (s.msTokens) msTokenUserIds.add(s.userId);
          }
        } catch {}
      }

      const userMap = new Map<string, any>();
      const users = result.rows.map(r => {
        const hbAt = r.last_heartbeat_at ? new Date(r.last_heartbeat_at) : null;
        const isOnlineByHeartbeat = hbAt && (Date.now() - hbAt.getTime()) < 2 * 60 * 1000;
        const currentSessionMinutes = (isOnlineByHeartbeat && r.current_session_start)
          ? Math.round((Date.now() - new Date(r.current_session_start).getTime()) / 60000)
          : 0;
        const u = {
          ...r,
          is_currently_online: !!isOnlineByHeartbeat,
          has_session_ms_tokens: msTokenUserIds.has(r.id),
          current_session_minutes: currentSessionMinutes,
        };
        userMap.set(r.id, u);
        return u;
      });

      const summary = {
        totalUsers: users.length,
        usersOnline: users.filter(u => u.is_currently_online).length,
        usersWithO365: users.filter(u => u.o365_linked || u.has_msal_cache).length,
        usersEverLoggedIn: users.filter(u => u.login_count > 0).length,
        usersActiveThisWeek: users.filter(u => u.last_active_at && new Date(u.last_active_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length,
        totalLogins: users.reduce((sum, u) => sum + (u.login_count || 0), 0),
        totalAiMessages: users.reduce((sum, u) => sum + parseInt(u.total_ai_messages || '0'), 0),
      };

      res.json({ users, summary });
    } catch (err: any) {
      console.error("Admin user activity error:", err.message);
      res.status(500).json({ message: err?.message || "Failed to fetch user activity" });
    }
  });

  app.get("/api/search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (q.length < 2) {
        return res.json({ results: [] });
      }

      // Client logins search only their own world: their properties, their
      // contacts, and the client-safe brand slice — never the firm-wide CRM.
      const searchScopeId = await resolveCompanyScope(req);
      if (searchScopeId) {
        const like = `%${q}%`;
        const [propRows, contactRows, brandRows] = await Promise.all([
          pool.query(
            `SELECT id, name FROM crm_properties
             WHERE name ILIKE $2 AND (landlord_id = $1 OR id IN
               (SELECT property_id FROM crm_company_properties WHERE company_id = $1))
             LIMIT 8`, [searchScopeId, like]),
          pool.query(
            `SELECT id, name, role FROM crm_contacts WHERE company_id = $1 AND name ILIKE $2 LIMIT 8`,
            [searchScopeId, like]),
          pool.query(
            `SELECT id, name, company_type FROM crm_companies
             WHERE name ILIKE $1 AND company_type ILIKE 'Tenant -%'
               AND (company_type ILIKE '%Restaurant%' OR company_type ILIKE '%Dining%' OR company_type ILIKE '%F&B%'
                 OR company_type ILIKE '%QSR%' OR company_type ILIKE '%Food%' OR company_type ILIKE '%Caf%'
                 OR company_type ILIKE '%Coffee%' OR company_type ILIKE '%Bar%' OR company_type ILIKE '%Leisure%'
                 OR company_type ILIKE '%Cinema%' OR company_type ILIKE '%Entertainment%' OR company_type ILIKE '%Fitness%'
                 OR company_type ILIKE '%Gym%' OR company_type ILIKE '%Yoga%' OR company_type ILIKE '%Hotel%' OR company_type ILIKE '%Hospitality%')
             LIMIT 8`, [like]),
        ]);
        return res.json({
          results: [
            ...propRows.rows.map(r => ({ id: r.id, name: r.name, type: "property" })),
            ...contactRows.rows.map(r => ({ id: r.id, name: r.name, type: "contact", subtitle: r.role || undefined })),
            ...brandRows.rows.map(r => ({ id: r.id, name: r.name, type: "company", subtitle: (r.company_type || "").replace(/^Tenant - /, "") })),
          ],
        });
      }

      const crmResults = await storage.crmSearchAll(q);
      const results: Array<{ id: string; name: string; type: string; group?: string; subtitle?: string }> = crmResults.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        subtitle: r.detail,
      }));

      const newsResults = await db
        .select({ id: newsArticles.id, title: newsArticles.title, sourceName: newsArticles.sourceName })
        .from(newsArticles)
        .where(ilike(newsArticles.title, `%${escapeLike(q)}%`))
        .limit(10);

      for (const article of newsResults) {
        results.push({
          id: String(article.id),
          name: article.title || "Untitled",
          type: "news",
          subtitle: article.sourceName || undefined,
        });
      }

      res.json({ results: results.slice(0, 30) });
    } catch (err: any) {
      console.error("Search error:", err?.message);
      res.json({ results: [] });
    }
  });


  // Smart-tag picker behind the chat @ menu: people, brands/companies,
  // properties, deals and letting-tracker units in one grouped payload.
  app.get("/api/chat/tag-search", requireAuth, async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      const results: Array<{ type: string; id: string; name: string; subtitle?: string }> = [];

      const like = `%${escapeLike(q)}%`;
      const userRows = await pool.query(
        `SELECT id, name, department FROM users WHERE ($1 = '' OR name ILIKE $2) ORDER BY name LIMIT 6`,
        [q, like]
      );
      for (const u of userRows.rows) {
        results.push({ type: "user", id: u.id, name: u.name, subtitle: u.department || undefined });
      }

      if (q.length >= 2) {
        const [crmResults, unitRows] = await Promise.all([
          storage.crmSearchAll(q).catch(() => []),
          pool.query(
            `SELECT au.id, au.unit_name, au.marketing_status, p.name as property_name
             FROM available_units au LEFT JOIN crm_properties p ON au.property_id = p.id
             WHERE au.unit_name ILIKE $1 OR p.name ILIKE $1
             ORDER BY au.unit_name LIMIT 5`,
            [like]
          ).catch(() => ({ rows: [] as any[] })),
        ]);
        const caps: Record<string, number> = { company: 5, property: 5, deal: 5, contact: 4 };
        const counts: Record<string, number> = {};
        for (const r of crmResults) {
          if (!(r.type in caps)) continue;
          counts[r.type] = (counts[r.type] || 0) + 1;
          if (counts[r.type] > caps[r.type]) continue;
          results.push({ type: r.type, id: r.id, name: r.name, subtitle: r.detail });
        }
        for (const u of unitRows.rows) {
          results.push({
            type: "unit",
            id: u.id,
            name: u.property_name ? `${u.unit_name} · ${u.property_name}` : u.unit_name,
            subtitle: u.marketing_status || undefined,
          });
        }

        // SharePoint folders come from the archivist's knowledge-base index —
        // no live Graph call, so the picker stays fast and degrades to nothing
        // when the index is empty. Folder ids carry the URL base64url-encoded
        // (URLs contain characters the tag token grammar forbids).
        try {
          const folderRows = await pool.query(
            `SELECT folder_path, MAX(folder_url) as folder_url, COUNT(*) as files FROM (
               SELECT regexp_replace(file_path, '/[^/]*$', '') AS folder_path, folder_url
               FROM knowledge_base WHERE folder_url IS NOT NULL AND file_path IS NOT NULL
             ) t
             WHERE folder_path ILIKE $1 AND folder_path <> ''
             GROUP BY folder_path ORDER BY length(folder_path) ASC LIMIT 4`,
            [like]
          );
          for (const f of folderRows.rows) {
            const segs = String(f.folder_path).split("/").filter(Boolean);
            const name = segs[segs.length - 1] || f.folder_path;
            results.push({
              type: "folder",
              id: Buffer.from(String(f.folder_url)).toString("base64url"),
              name,
              subtitle: `${segs.slice(0, -1).join(" / ")}${segs.length > 1 ? " · " : ""}${f.files} files`,
            });
          }
        } catch {}
      }

      res.json({ results });
    } catch (err: any) {
      console.error("[tag-search] Error:", err?.message);
      res.json({ results: [] });
    }
  });

  // Conversations that tag a given record — powers the "Conversations" card
  // on entity pages. Member-scoped: you only see threads you belong to, same
  // visibility rule as the chat list itself.
  app.get("/api/chat/threads-tagging", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const type = String(req.query.type || "");
      const id = String(req.query.id || "");
      if (!/^(company|property|deal|unit|contact)$/.test(type) || !id) {
        return res.status(400).json({ message: "type and id required" });
      }
      const tagFragment = `(tag:${type}/${id})`;
      const rows = await pool.query(
        `SELECT DISTINCT ON (t.id) t.id, t.title, t.updated_at, t.has_ai_member,
                (SELECT m2.content FROM chat_messages m2 WHERE m2.thread_id = t.id ORDER BY m2.created_at DESC LIMIT 1) as last_message
         FROM chat_threads t
         JOIN chat_messages m ON m.thread_id = t.id
         LEFT JOIN chat_thread_members mem ON mem.thread_id = t.id AND mem.user_id = $2
         WHERE position($1 in m.content) > 0
           AND (t.created_by = $2 OR mem.user_id IS NOT NULL)
         ORDER BY t.id, t.updated_at DESC`,
        [tagFragment, userId]
      );
      const threads = rows.rows
        .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 10)
        .map((r: any) => ({
          id: r.id,
          title: r.title,
          updatedAt: r.updated_at,
          hasAiMember: r.has_ai_member,
          lastMessage: r.last_message ? String(r.last_message).replace(/@\[([^\]]+)\]\(tag:[^)]+\)/g, "@$1").slice(0, 90) : null,
        }));
      res.json({ threads });
    } catch (err: any) {
      console.error("[threads-tagging] Error:", err?.message);
      res.json({ threads: [] });
    }
  });


  app.get("/api/chat/threads", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;

      const threadsResult = await pool.query(`
        WITH user_threads AS (
          SELECT DISTINCT t.*
          FROM chat_threads t
          LEFT JOIN chat_thread_members m ON m.thread_id = t.id
          WHERE t.created_by = $1 OR m.user_id = $1
        ),
        last_messages AS (
          SELECT DISTINCT ON (cm.thread_id)
            cm.thread_id,
            cm.content,
            cm.role,
            cm.user_id,
            cm.created_at,
            u.name as sender_name
          FROM chat_messages cm
          INNER JOIN user_threads ut ON ut.id = cm.thread_id
          LEFT JOIN users u ON u.id = cm.user_id
          ORDER BY cm.thread_id, cm.created_at DESC
        ),
        thread_members AS (
          SELECT
            tm.thread_id,
            json_agg(json_build_object('id', tm.user_id, 'name', COALESCE(u.name, 'Unknown'), 'seen', tm.seen)) as members
          FROM chat_thread_members tm
          INNER JOIN user_threads ut ON ut.id = tm.thread_id
          LEFT JOIN users u ON u.id = tm.user_id
          GROUP BY tm.thread_id
        )
        SELECT
          ut.*,
          cu.name as creator_name,
          lm.content as last_msg_content,
          lm.role as last_msg_role,
          lm.sender_name as last_msg_sender,
          lm.created_at as last_msg_at,
          COALESCE(tm.members, '[]'::json) as members
        FROM user_threads ut
        LEFT JOIN users cu ON cu.id = ut.created_by
        LEFT JOIN last_messages lm ON lm.thread_id = ut.id
        LEFT JOIN thread_members tm ON tm.thread_id = ut.id
        ORDER BY ut.updated_at DESC
      `, [userId]);

      const threads = threadsResult.rows.map(row => {
        let lastMessage = null;
        if (row.last_msg_content) {
          const content = row.last_msg_content;
          lastMessage = {
            content: content.length > 80 ? content.slice(0, 80) + "..." : content,
            senderName: row.last_msg_sender?.split(" ")[0] || (row.last_msg_role === "assistant" ? "ChatBGP" : "Unknown"),
            createdAt: row.last_msg_at,
          };
        }
        return {
          id: row.id,
          title: row.title,
          createdBy: row.created_by,
          propertyId: row.property_id,
          propertyName: row.property_name,
          linkedType: row.linked_type,
          linkedId: row.linked_id,
          linkedName: row.linked_name,
          isAiChat: row.is_ai_chat,
          hasAiMember: row.has_ai_member,
          groupPicUrl: row.group_pic_url,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          members: row.members,
          creatorName: row.creator_name || "Unknown",
          lastMessage,
        };
      });
      res.json(threads);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch threads" });
    }
  });

  app.post("/api/chat/threads", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { title, propertyId, propertyName, linkedType, linkedId, linkedName, isAiChat, memberIds } = req.body;

      if (linkedType && linkedId && isAiChat) {
        const existingResult = await pool.query(
          "SELECT * FROM chat_threads WHERE is_ai_chat = true AND linked_type = $1 AND linked_id = $2 LIMIT 1",
          [linkedType, linkedId]
        );
        if (existingResult.rows.length > 0) {
          return res.json(existingResult.rows[0]);
        }
      }

      const hasAiMember = Array.isArray(memberIds) && memberIds.includes("__chatbgp__");
      const realMemberIds = Array.isArray(memberIds) ? memberIds.filter((id: string) => id !== "__chatbgp__") : memberIds;

      const thread = await storage.createChatThread({
        title: title || null,
        createdBy: userId,
        propertyId: propertyId || null,
        propertyName: propertyName || null,
        linkedType: linkedType || null,
        linkedId: linkedId || null,
        linkedName: linkedName || null,
        isAiChat: isAiChat !== undefined ? isAiChat : true,
        hasAiMember,
      });
      if (Array.isArray(realMemberIds) && realMemberIds.length > 0) {
        for (const memberId of realMemberIds) {
          if (memberId !== userId) {
            try {
              await storage.addChatThreadMember({
                threadId: thread.id,
                userId: memberId,
                addedBy: userId,
                seen: false,
              });
              const addedUser = await storage.getUser(memberId);
              emitMemberAdded(thread.id, memberId, addedUser?.name || "Unknown");
            } catch {}
          }
        }
      }
      res.json(thread);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to create thread" });
    }
  });

  app.put("/api/chat/threads/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const thread = await storage.getChatThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const { title, propertyId, propertyName, linkedType, linkedId, linkedName, hasAiMember } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (propertyId !== undefined) updates.propertyId = propertyId;
      if (propertyName !== undefined) updates.propertyName = propertyName;
      if (linkedType !== undefined) updates.linkedType = linkedType;
      if (linkedId !== undefined) updates.linkedId = linkedId;
      if (linkedName !== undefined) updates.linkedName = linkedName;
      if (hasAiMember !== undefined) updates.hasAiMember = hasAiMember;
      const updated = await storage.updateChatThread(id, updates);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update thread" });
    }
  });

  app.post("/api/chat/threads/:id/auto-title", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const userId = req.session.userId!;
      const thread = await storage.getChatThread(id);
      if (!thread || !thread.isAiChat) return res.status(404).json({ message: "Thread not found" });

      if (thread.createdBy !== userId) {
        const members = await storage.getChatThreadMembers(id);
        if (!members.some(m => m.userId === userId)) {
          return res.status(403).json({ message: "Not authorized" });
        }
      }

      const currentTitle = (thread.title || "").trim();
      const looksLikeUrl = currentTitle.startsWith("http") || currentTitle.includes("://");
      const looksLikeRawMessage = currentTitle.length > 40;
      const isGeneric = !currentTitle || currentTitle === "New conversation";
      if (!looksLikeUrl && !looksLikeRawMessage && !isGeneric) {
        return res.json({ title: thread.title });
      }

      const messages = await storage.getChatMessages(id);
      if (messages.length < 2) return res.json({ title: thread.title });

      const conversationSnippet = messages
        .slice(0, 6)
        .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
        .join("\n");

      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          { role: "system", content: "Generate a very short title (3-6 words max) summarising what this conversation is about. No quotes, no punctuation at the end. Examples: 'Canary Wharf folder setup', 'Live deals overview', 'Market outlook Belgravia'." },
          { role: "user", content: conversationSnippet },
        ],
        max_completion_tokens: 20,
        temperature: 0.3,
      });

      const newTitle = completion.choices[0]?.message?.content?.trim();
      if (newTitle && newTitle.length > 0 && newTitle.length <= 60) {
        await storage.updateChatThread(id, { title: newTitle });
        res.json({ title: newTitle });
      } else {
        res.json({ title: thread.title });
      }
    } catch (err: any) {
      console.error("Auto-title error:", err?.message);
      res.json({ title: null });
    }
  });

  app.post("/api/chat/project-summary", requireAuth, async (req, res) => {
    try {
      const { linkedType, linkedId } = req.body;
      if (!linkedType || !linkedId) return res.status(400).json({ message: "linkedType and linkedId required" });

      const threadResult = await pool.query(
        "SELECT * FROM chat_threads WHERE is_ai_chat = true AND linked_type = $1 AND linked_id = $2",
        [linkedType, linkedId]
      );
      const projectThreads = threadResult.rows;

      if (projectThreads.length === 0) {
        return res.json({ summary: "No conversations yet for this project." });
      }

      const threadSnippets: string[] = [];
      for (const thread of projectThreads.slice(0, 10)) {
        const msgs = await storage.getChatMessages(thread.id);
        const snippet = msgs
          .slice(0, 8)
          .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 150)}`)
          .join("\n");
        threadSnippets.push(`--- Thread: "${thread.title || "Untitled"}" ---\n${snippet}`);
      }

      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          {
            role: "system",
            content: "Summarise these property/deal conversations in 1-2 short sentences MAX. Use bullet-point style if needed. State only: what was done, what's pending. No filler words, no introductions. Example: 'SharePoint folders created. Deal not yet added to WIP — awaiting confirmation.'",
          },
          { role: "user", content: threadSnippets.join("\n\n") },
        ],
        max_completion_tokens: 80,
        temperature: 0.2,
      });

      const summary = completion.choices[0]?.message?.content?.trim() || `${projectThreads.length} conversation(s) linked to this project.`;
      res.json({ summary });
    } catch (err: any) {
      console.error("Project summary error:", err?.message);
      res.json({ summary: "Unable to generate summary at the moment." });
    }
  });

  app.get("/api/chat/threads/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const thread = await storage.getChatThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const userId = req.session.userId!;
      const members = await storage.getChatThreadMembers(thread.id);
      const isMember = thread.createdBy === userId || members.some(m => m.userId === userId);
      if (!isMember) return res.status(403).json({ message: "You are not a member of this thread" });
      const messages = await storage.getChatMessages(thread.id);
      const memberUsers = await Promise.all(members.map(async (m) => {
        const u = await storage.getUser(m.userId);
        return { id: m.userId, name: u?.name || "Unknown", seen: m.seen };
      }));
      const creator = await storage.getUser(thread.createdBy);
      await storage.markThreadSeen(thread.id, userId);
      res.json({ ...thread, messages, members: memberUsers, creatorName: creator?.name || "Unknown" });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch thread" });
    }
  });

  app.delete("/api/chat/threads/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const thread = await storage.getChatThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      if (thread.createdBy !== req.session.userId) {
        return res.status(403).json({ message: "Only the thread creator can delete it" });
      }
      await storage.deleteChatThread(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete thread" });
    }
  });

  app.post("/api/chat/threads/:id/messages", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = req.params.id as string;
      const thread = await storage.getChatThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const threadMembers = await storage.getChatThreadMembers(thread.id);
      const isMember = thread.createdBy === userId || threadMembers.some(m => m.userId === userId);
      if (!isMember) return res.status(403).json({ message: "You are not a member of this thread" });
      const { content, role: requestedRole, actionData, attachments } = req.body;
      if (!content || (typeof content === "string" && !content.trim())) {
        return res.status(400).json({ message: "Message content is required" });
      }
      const role = (requestedRole === "assistant" && (thread.isAiChat || thread.hasAiMember)) ? "assistant" : "user";
      const message = await storage.createChatMessage({
        threadId: thread.id,
        role,
        content,
        userId: role === "user" ? userId : null,
        actionData: actionData || null,
        attachments: attachments || null,
      });
      if (role === "user") {
        await storage.markOtherMembersUnseen(thread.id, userId);
        const sender = await storage.getUser(userId);
        const senderName = sender?.name || "Someone";
        emitNewMessage(thread.id, message, senderName);
        const members = await storage.getChatThreadMembers(thread.id);
        const preview = content?.substring(0, 80) || "New message";
        const threadTitle = thread.title || "Chat";
        for (const m of members) {
          if (m.userId !== userId) {
            emitNotification(m.userId, { type: "new_message", threadId: thread.id, senderName, preview });
            sendPushNotification(m.userId, {
              title: senderName,
              body: preview,
              tag: `chat-${thread.id}`,
              url: `/chatbgp?thread=${thread.id}`,
            }).catch(() => {});
          }
        }
        if (thread.createdBy !== userId && !members.find(m => m.userId === thread.createdBy)) {
          emitNotification(thread.createdBy, { type: "new_message", threadId: thread.id, senderName, preview });
          sendPushNotification(thread.createdBy, {
            title: senderName,
            body: preview,
            tag: `chat-${thread.id}`,
            url: `/chatbgp?thread=${thread.id}`,
          }).catch(() => {});
        }

        // Summoning the AI by name pulls it into the conversation for good —
        // the WhatsApp mental model: mention someone and they're in the group.
        if (!thread.hasAiMember && !thread.isAiChat && typeof content === "string" && AI_MENTION_REGEX.test(content)) {
          try {
            await storage.updateChatThread(thread.id, { hasAiMember: true });
            (thread as any).hasAiMember = true;
            emitMemberAdded(thread.id, "__chatbgp__", "ChatBGP");
          } catch (e: any) {
            console.error("[ai-group] Failed to auto-join AI on mention:", e?.message);
          }
        }

        if (thread.hasAiMember && !thread.isAiChat) {
          triggerAiGroupResponse(thread.id, userId, req).catch(async (err) => {
            console.error("[ai-group] Error triggering AI response:", err?.message);
            try {
              const fallback = "Sorry, I'm having a connection issue. Give me a moment and try again.";
              const saved = await storage.createChatMessage({
                threadId: thread.id,
                role: "assistant",
                content: fallback,
                userId: null,
                actionData: null,
                attachments: null,
              });
              emitNewMessage(thread.id, saved, "ChatBGP");
            } catch (_) {}
          });
        }
      }
      res.json(message);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to send message" });
    }
  });

  app.post("/api/chat/threads/:id/members", requireAuth, async (req, res) => {
    try {
      const addedBy = req.session.userId!;
      const id = req.params.id as string;
      const thread = await storage.getChatThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ message: "userId required" });
      if (userId === "__chatbgp__") {
        // The AI joins via the thread flag, not a member row — same mechanism
        // as the create-time toggle, so the group responder picks it up.
        await storage.updateChatThread(thread.id, { hasAiMember: true });
        emitMemberAdded(thread.id, "__chatbgp__", "ChatBGP");
        return res.json({ threadId: thread.id, userId: "__chatbgp__" });
      }
      const member = await storage.addChatThreadMember({
        threadId: thread.id,
        userId,
        addedBy,
        seen: false,
      });
      const addedUser = await storage.getUser(userId);
      emitMemberAdded(thread.id, userId, addedUser?.name || "Unknown");
      res.json(member);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to add member" });
    }
  });

  app.delete("/api/chat/threads/:id/members/:userId", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const memberId = req.params.userId as string;
      if (memberId === "__chatbgp__") {
        await storage.updateChatThread(id, { hasAiMember: false });
        emitMemberRemoved(id, "__chatbgp__");
        return res.json({ success: true });
      }
      await storage.removeChatThreadMember(id, memberId);
      emitMemberRemoved(id, memberId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to remove member" });
    }
  });

  app.put("/api/chat/threads/:threadId/messages/:messageId", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { threadId, messageId } = req.params as { threadId: string; messageId: string };
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "Content required" });
      const msg = await storage.getChatMessage(messageId);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      if (msg.threadId !== threadId) return res.status(400).json({ message: "Message does not belong to this thread" });
      if (msg.userId !== userId) return res.status(403).json({ message: "Can only edit your own messages" });
      if (msg.role !== "user") return res.status(403).json({ message: "Can only edit user messages" });
      const updated = await storage.updateChatMessage(messageId, content.trim());
      emitMessageUpdated(threadId, messageId, content.trim());
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update message" });
    }
  });

  app.delete("/api/chat/threads/:threadId/messages/:messageId", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { threadId, messageId } = req.params as { threadId: string; messageId: string };
      const msg = await storage.getChatMessage(messageId);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      if (msg.threadId !== threadId) return res.status(400).json({ message: "Message does not belong to this thread" });
      const thread = await storage.getChatThread(threadId);
      if (msg.userId !== userId && thread?.createdBy !== userId) {
        return res.status(403).json({ message: "Can only delete your own messages or as thread creator" });
      }
      await storage.deleteChatMessage(messageId);
      emitMessageDeleted(threadId, messageId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete message" });
    }
  });

  app.get("/api/chat/search", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const query = req.query.q as string;
      if (!query?.trim()) return res.json([]);
      const results = await storage.searchChatMessages(userId, query.trim());
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Search failed" });
    }
  });

  app.get("/api/chat/notifications", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const count = await storage.getUnseenThreadCount(userId);
      res.json({ unseenCount: count });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch notifications" });
    }
  });

  app.get("/api/push/vapid-key", (_req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  });

  app.post("/api/push/subscribe", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { subscription } = req.body;
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ message: "Invalid subscription" });
      }
      await saveSubscription(userId, subscription);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to save subscription" });
    }
  });

  app.post("/api/push/unsubscribe", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { endpoint } = req.body;
      if (endpoint) await removeSubscriptionForUser(endpoint, userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to remove subscription" });
    }
  });

  app.get("/api/external-requirements", requireAuth, async (_req, res) => {
    try {
      const results = await db
        .select()
        .from(externalRequirements)
        .orderBy(externalRequirements.companyName);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch external requirements" });
    }
  });

  app.post("/api/external-requirements/import-trl", requireAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "URL is required" });
      }
      if (!url.startsWith("https://www.therequirementlist.com/")) {
        return res.status(400).json({ message: "URL must be from therequirementlist.com" });
      }
      const id = await importTrlRequirement(url);
      if (!id) return res.status(400).json({ message: "Failed to extract data from URL — page may not exist or structure may differ" });
      res.json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "TRL import failed" });
    }
  });

  app.get("/api/market-tone", requireAuth, async (req, res) => {
    try {
      const postcode = (req.query.postcode as string || "").trim();
      if (!postcode) return res.status(400).json({ error: "postcode required" });
      const { fetchPropertyDataMarketTone } = await import("./propertydata-market");
      const tone = await fetchPropertyDataMarketTone(postcode);
      if (!tone) return res.status(503).json({ error: "PropertyData not configured or no data for this postcode" });
      res.json(tone);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── HM Land Registry CCOD / UCOD ingestion ─────────────────────────────
  // Three operating modes:
  //   POST { latest: true, source: "CCOD" }              fetch + ingest the
  //                                                       most recent FULL
  //                                                       monthly file via
  //                                                       the HMLR API (uses
  //                                                       HMLR_API_KEY).
  //   POST { filename, source }                           same, but for a
  //                                                       specific filename.
  //   POST { url, source, filename? }                     ingest directly from
  //                                                       a pre-resolved URL
  //                                                       (e.g. a manually-
  //                                                       downloaded mirror).
  // Always runs in the background; poll /status. CCOD file is ~150MB so
  // expect 10-30 min depending on instance size.
  // Reversible cleanup of crm_properties clutter. Snapshots full rows into
  // crm_properties_archive (JSONB) BEFORE deleting, so anything removed can be
  // restored. mode:"investment_comps" removes the legacy bulk-loaded investment
  // comparables (status 'Investment Comp' / group 'Investment Comps'); ids:[...]
  // removes specific rows (the junk stubs). Dry-run unless confirm:true.
  // Manual trigger for the client team-diary → events sync (Landsec).
  app.post("/api/admin/sync-client-events", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { syncClientTeamEvents, syncAllClientTeamEvents } = await import("./client-team-events-sync");
      const companyId = (req.body?.companyId || req.query.companyId) as string | undefined;
      if (companyId) {
        const stats = await syncClientTeamEvents(companyId);
        return res.json({ ok: true, stats });
      }
      await syncAllClientTeamEvents();
      res.json({ ok: true, message: "Synced all client teams" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "sync failed" });
    }
  });

  app.post("/api/admin/cleanup-crm-properties", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { mode, ids, confirm, reason } = req.body || {};
      await pool.query(`CREATE TABLE IF NOT EXISTS crm_properties_archive (
        id TEXT, data JSONB, reason TEXT, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      let where = "", params: any[] = [];
      if (mode === "investment_comps") {
        where = `status = 'Investment Comp' OR group_name = 'Investment Comps'`;
      } else if (Array.isArray(ids) && ids.length) {
        where = `id = ANY($1)`; params = [ids];
      } else {
        return res.status(400).json({ message: "Provide mode:'investment_comps' or ids:[...]" });
      }
      const preview = await pool.query(
        `SELECT id, name, status, group_name AS "groupName" FROM crm_properties WHERE ${where} LIMIT 1000`, params);
      if (!confirm) {
        return res.json({ dryRun: true, matched: preview.rowCount, sample: preview.rows.slice(0, 20) });
      }
      // Snapshot then delete, in a transaction.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO crm_properties_archive (id, data, reason)
           SELECT id, to_jsonb(p), $${params.length + 1} FROM crm_properties p WHERE ${where}`,
          [...params, reason || mode || "cleanup"]);
        const del = await client.query(`DELETE FROM crm_properties WHERE ${where}`, params);
        await client.query("COMMIT");
        res.json({ archived: preview.rowCount, deleted: del.rowCount, restorableFrom: "crm_properties_archive" });
      } catch (e: any) {
        await client.query("ROLLBACK"); throw e;
      } finally { client.release(); }
    } catch (err: any) {
      console.error("[cleanup-crm-properties] failed:", err?.message);
      res.status(500).json({ message: err?.message || "cleanup failed" });
    }
  });

  app.post("/api/admin/ingest-ccod", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { ingestCcodFromUrl, ingestLatestFor, resolveHmlrDownloadUrl, getIngestProgress } = await import("./land-registry-ccod");
      const progress = getIngestProgress();
      if (progress.state === "downloading" || progress.state === "parsing") {
        return res.status(202).json({ accepted: true, alreadyRunning: true, progress });
      }
      const body = req.body || {};
      const source = (String(body.source || "CCOD").toUpperCase() === "UCOD" ? "UCOD" : "CCOD") as "CCOD" | "UCOD";

      // Kick off in the background; respond 202 immediately so Railway's
      // edge proxy doesn't time out on the 10-30 min ingest.
      if (body.latest) {
        ingestLatestFor(source).catch(err => console.error("[ccod] ingestLatestFor failed:", err?.message));
      } else if (body.filename) {
        (async () => {
          try {
            const url = await resolveHmlrDownloadUrl(source, body.filename);
            await ingestCcodFromUrl(url, source, body.filename);
          } catch (err: any) { console.error("[ccod] filename ingest failed:", err?.message); }
        })();
      } else if (body.url) {
        ingestCcodFromUrl(body.url, source, body.filename || "manual-upload.csv")
          .catch(err => console.error("[ccod] url ingest failed:", err?.message));
      } else {
        return res.status(400).json({ error: "pass { latest: true } | { filename } | { url }" });
      }
      res.status(202).json({ accepted: true, message: `Started ${source} ingest. Poll /api/admin/ingest-ccod/status for progress.` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "ingest failed" });
    }
  });

  app.get("/api/admin/ingest-ccod/status", requireAuth, requireAdmin, async (_req, res) => {
    const { getIngestProgress } = await import("./land-registry-ccod");
    res.json(getIngestProgress());
  });

  app.get("/api/admin/ingest-ccod/files", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { listHmlrFiles } = await import("./land-registry-ccod");
      const source = (String(req.query.source || "CCOD").toUpperCase() === "UCOD" ? "UCOD" : "CCOD") as "CCOD" | "UCOD";
      const files = await listHmlrFiles(source);
      res.json({ source, files });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "list failed" });
    }
  });

  // Land Registry titles for a given company, matched by CH number.
  // Used by the Ownership block on the landlord profile.
  app.get("/api/landlord/:companyId/land-registry-titles", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.params;
      const { rows } = await pool.query(
        `SELECT companies_house_number FROM crm_companies WHERE id = $1`,
        [companyId]
      );
      const ch = rows[0]?.companies_house_number;
      if (!ch) return res.json({ chNumber: null, count: 0, titles: [] });

      const { getTitlesForCompany, countTitlesForCompany } = await import("./land-registry-ccod");
      const [titles, count] = await Promise.all([
        getTitlesForCompany(ch, 500),
        countTitlesForCompany(ch),
      ]);
      res.json({ chNumber: ch, count, titles });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "lookup failed" });
    }
  });

  // Scrape a landlord's website — drills portfolio / investor / board
  // pages with JS rendering on, extracts structured intel via Haiku.
  // Returns 202 + a job state — poll /status for results.
  app.post("/api/landlord/:companyId/scrape-portfolio", requireAuth, async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    try {
      const { scrapeLandlordWebsite, getLandlordScrapeProgress } = await import("./landlord-scraper");
      const current = getLandlordScrapeProgress(companyId);
      if (current.state === "fetching" || current.state === "extracting") {
        return res.status(202).json({ accepted: true, alreadyRunning: true, progress: current });
      }
      // Fire and forget; the scraper writes to landlord_website_findings
      // when done. Avoids Railway edge timeout on the ~60s render fan-out.
      scrapeLandlordWebsite(companyId).catch(err =>
        console.error(`[landlord-scrape ${companyId}] failed:`, err?.message || err)
      );
      res.status(202).json({ accepted: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "kick-off failed" });
    }
  });

  app.get("/api/landlord/:companyId/scrape-portfolio/status", requireAuth, async (req, res) => {
    try {
      const { getLandlordScrapeProgress, getLandlordFindings } = await import("./landlord-scraper");
      const progress = getLandlordScrapeProgress(req.params.companyId as string);
      const findings = await getLandlordFindings(req.params.companyId as string);
      res.json({ progress, findings });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "status failed" });
    }
  });

  // Stream the cached annual report PDF for a landlord. Same pattern
  // as the CH accounts streaming endpoint — 404 if we haven't fetched
  // one yet (the scraper does this automatically).
  app.get("/api/landlord/:companyId/annual-report.pdf", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query<{ annual_report_storage_key: string | null; name: string }>(
        `SELECT annual_report_storage_key, name FROM crm_companies WHERE id = $1`,
        [req.params.companyId]
      );
      const row = rows[0];
      if (!row?.annual_report_storage_key) return res.status(404).json({ error: "no annual report on file" });
      const { getFile } = await import("./file-storage");
      const file = await getFile(row.annual_report_storage_key);
      if (!file) return res.status(404).json({ error: "stored file missing" });
      const safeName = (row.name || "landlord").replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Content-Type", file.contentType || "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}-annual-report.pdf"`);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(file.data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "stream failed" });
    }
  });

  // Why-didn't-it-link diagnostic. Returns the most recent link report
  // produced by autoLinkScrapedProperties so the user can see, per
  // scraped property: did it match a CRM row? Was the row already
  // owned by another landlord? Is it a totally new asset? Used by
  // ChatBGP + the Ownership block to debug "Bluewater isn't showing".
  app.get("/api/landlord/:companyId/link-diagnostic", requireAuth, async (req, res) => {
    try {
      const { getLandlordScrapeProgress } = await import("./landlord-scraper");
      const progress = getLandlordScrapeProgress(req.params.companyId as string);
      const linkReport = (progress as any)?.result?.link_report || null;
      res.json({ progress: progress.state, linkReport });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "diagnostic failed" });
    }
  });

  // Per-account BGP staff role. POST { userId, role } upserts a row
  // in crm_company_bgp_roles so the coverer chip on the panel can show
  // "Charlotte — Investment lead". Empty role string removes the row.
  app.post("/api/brand/:companyId/bgp-role", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = String(req.body?.userId || "").trim();
      const role = String(req.body?.role || "").trim();
      if (!userId) return res.status(400).json({ error: "userId required" });
      if (!role) {
        await pool.query(`DELETE FROM crm_company_bgp_roles WHERE company_id = $1 AND user_id = $2`, [companyId, userId]);
        return res.json({ ok: true, cleared: true });
      }
      await pool.query(
        `INSERT INTO crm_company_bgp_roles (company_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, user_id) DO UPDATE SET role = $3, updated_at = NOW()`,
        [companyId, userId, role]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "save failed" });
    }
  });

  // Promote a pending email-sender suggestion into a CRM contact.
  // Body: { email, name? } — name parsed from the email local part
  // if not supplied. Returns the new contact id.
  app.post("/api/brand/:companyId/promote-sender", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.params;
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) return res.status(400).json({ error: "valid email required" });
      // Derive a name from the local part if the caller didn't pass one
      // ("sara.ciullaserino@hm.com" → "Sara Ciullaserino"). Cheap, and
      // the user can fix it inline via the existing role-edit flow.
      const localPart = email.split("@")[0];
      const derived = localPart
        .replace(/[._-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      const name = (req.body?.name && String(req.body.name).trim()) || derived || email;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO crm_contacts (name, email, company_id, enrichment_source)
         VALUES ($1, $2, $3, 'promoted-from-email')
         RETURNING id`,
        [name, email, companyId]
      );
      res.json({ id: rows[0].id, name, email });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "create failed" });
    }
  });

  // Create a crm_properties row from a scraped item and link it to this
  // landlord. Used by the per-row "Create CRM property" button in the
  // Ownership block. Returns the new property id so the client can
  // jump to it.
  app.post("/api/landlord/:companyId/create-property", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.params as { companyId: string };
      const { name, address, postcode, sector } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });
      const { createPropertyFromScraped } = await import("./landlord-scraper");
      const out = await createPropertyFromScraped(companyId, { name: String(name).trim(), address, postcode, sector });
      res.json(out);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "create failed" });
    }
  });

  // Dismiss a discovered (not-yet-in-CRM) portfolio row from the
  // Properties board — wrong matches or dupes already in the CRM under
  // a different name. Body: { key } using the board's stable discovery
  // key ("scraped:<name>" / "lr:<title_number>"). The dismissal is
  // remembered so the weekly re-scrape won't re-surface it. POST again
  // with { restore: true } to bring it back.
  app.post("/api/landlord/:companyId/dismiss-discovery", requireAuth, async (req, res) => {
    try {
      const companyId = String(req.params.companyId);
      const key = String(req.body?.key || "").trim();
      if (!key) return res.status(400).json({ error: "key is required" });
      const { dismissDiscovery, restoreDiscovery } = await import("./landlord-scraper");
      if (req.body?.restore) {
        await restoreDiscovery(companyId, key);
        return res.json({ ok: true, restored: true });
      }
      await dismissDiscovery(companyId, key);
      res.json({ ok: true, dismissed: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "dismiss failed" });
    }
  });

  // Detach a CRM property from THIS landlord without deleting it.
  // Clears landlord_id only if it currently points at this company (so
  // we never steal a property owned by a different landlord that's
  // merely link-attached here), and removes any explicit company↔property
  // link. The property and its deals/units survive untouched.
  app.post("/api/landlord/:companyId/unlink-property", requireAuth, async (req, res) => {
    try {
      const companyId = String(req.params.companyId);
      const propertyId = String(req.body?.propertyId || "").trim();
      if (!propertyId) return res.status(400).json({ error: "propertyId is required" });
      await pool.query(
        `UPDATE crm_properties SET landlord_id = NULL WHERE id = $1 AND landlord_id = $2`,
        [propertyId, companyId]
      );
      await pool.query(
        `DELETE FROM crm_company_properties WHERE company_id = $1 AND property_id = $2`,
        [companyId, propertyId]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "unlink failed" });
    }
  });

  app.get("/api/admin/integrations/pipnet", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const status = await getPipnetCredsStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to read PIPnet credentials" });
    }
  });

  app.post("/api/admin/integrations/pipnet", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { username, email, password } = req.body || {};
      if (!username || !email || !password) {
        return res.status(400).json({ message: "username, email and password are all required" });
      }
      await setPipnetCreds({ username, email, password });
      const { resetSession } = await import("./pipnet");
      resetSession();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to save PIPnet credentials" });
    }
  });

  app.post("/api/admin/integrations/pipnet/test", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { testPipnetLogin } = await import("./pipnet");
      const result = await testPipnetLogin();
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err?.message || "PIPnet test failed" });
    }
  });

  app.delete("/api/admin/integrations/pipnet", requireAuth, requireAdmin, async (_req, res) => {
    try {
      await clearPipnetCreds();
      const { resetSession } = await import("./pipnet");
      resetSession();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to clear PIPnet credentials" });
    }
  });

  app.post("/api/external-requirements/search-pipnet", requireAuth, async (req, res) => {
    try {
      const { type, location, minSize, maxSize, client } = req.body;
      if (type === "properties") {
        const results = await searchPipnetProperties({ location, minSize, maxSize });
        res.json(results);
      } else {
        const results = await searchPipnetRequirements({ location, minSize, maxSize, client });
        res.json(results);
      }
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "PIPnet search failed" });
    }
  });

  app.post("/api/external-requirements/import-pipnet", requireAuth, async (req, res) => {
    try {
      const { location, minSize, maxSize, client, documentDate, allPages, monthsBack, autoPromote } = req.body;
      const result = await importPipnetRequirements({ location, minSize, maxSize, client, documentDate, allPages, monthsBack, autoPromote });
      if (!res.headersSent) res.json(result);
    } catch (err: any) {
      console.error("[import-pipnet] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "PIPnet import failed" });
    }
  });

  // Import PIPnet AVAILABLE retail properties — the mirror of import-pipnet but
  // for space on the market. Each listing is geocoded and upserted into
  // crm_properties (status "Market Listing", group "PIPnet") so it appears on
  // the Property Map; its brochure is stored under landlord-packs.
  app.post("/api/external-requirements/import-pipnet-properties", requireAuth, async (req, res) => {
    try {
      const { location, minSize, maxSize, type, allPages } = req.body;
      const result = await importPipnetProperties({ location, minSize, maxSize, type, allPages });
      if (!res.headersSent) res.json(result);
    } catch (err: any) {
      console.error("[import-pipnet-properties] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "PIPnet property import failed" });
    }
  });

  // ─── Background-job versions ────────────────────────────────────────────
  // A full import does a detail fetch + brochure download + Claude vision per
  // row, which blows past Railway's ~60s/300s request limits. These kick the
  // work off, return 202 immediately, and the client polls *-status until done.
  app.post("/api/external-requirements/import-pipnet-async", requireAuth, async (req, res) => {
    const { location, minSize, maxSize, client, documentDate, allPages, monthsBack, autoPromote } = req.body || {};
    const { alreadyRunning } = startJob("pipnet-req-import", () =>
      importPipnetRequirements({ location, minSize, maxSize, client, documentDate, allPages: allPages ?? true, monthsBack, autoPromote }));
    res.status(202).json({ started: !alreadyRunning, alreadyRunning, statusUrl: "/api/external-requirements/import-pipnet-status" });
  });
  app.get("/api/external-requirements/import-pipnet-status", requireAuth, (_req, res) => {
    res.json(getJobStatus("pipnet-req-import") || { state: "idle" });
  });
  app.post("/api/external-requirements/import-pipnet-properties-async", requireAuth, async (req, res) => {
    const { location, minSize, maxSize, type, allPages } = req.body || {};
    const { alreadyRunning } = startJob("pipnet-prop-import", () =>
      importPipnetProperties({ location, minSize, maxSize, type, allPages: allPages ?? true }));
    res.status(202).json({ started: !alreadyRunning, alreadyRunning, statusUrl: "/api/external-requirements/import-pipnet-properties-status" });
  });
  app.get("/api/external-requirements/import-pipnet-properties-status", requireAuth, (_req, res) => {
    res.json(getJobStatus("pipnet-prop-import") || { state: "idle" });
  });

  // External (scraped) available properties — a STANDALONE dataset, separate
  // from the CRM (crm_properties), so PIPnet market listings never clutter the
  // CRM. Feeds its own toggleable map layer.
  app.get("/api/external-properties", requireAuth, async (_req, res) => {
    try {
      const { listExternalProperties } = await import("./external-properties");
      res.json(await listExternalProperties());
    } catch (err: any) {
      console.error("[external-properties] failed:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to load external properties" });
    }
  });

  // Ingest an available-property flyer/email into external_properties. Shared
  // entry point for ChatBGP, forwarded emails and WhatsApp. Accepts a PDF
  // (multipart "file") and/or text body; Claude extracts, we geocode + dedup.
  app.post("/api/external-properties/ingest", requireAuth, marketingUpload.single("file"), async (req: any, res) => {
    try {
      const { ingestAvailableProperty } = await import("./property-ingest");
      const source = (req.body?.source || "Upload").toString();
      const text = req.body?.text ? String(req.body.text) : undefined;
      const pdfBuffer = req.file?.buffer;
      if (!pdfBuffer && !text) return res.status(400).json({ message: "Provide a PDF file and/or text" });
      const result = await ingestAvailableProperty({ source, pdfBuffer, text, originalName: req.file?.originalname });
      if (!result.ok) return res.status(422).json(result);
      res.json(result);
    } catch (err: any) {
      console.error("[external-properties/ingest] failed:", err?.message);
      res.status(500).json({ message: err?.message || "Property ingest failed" });
    }
  });

  // Diagnostic: dump PIPnet's property search form inputs + current detailsfetch
  // result, so we can fix the property scrape's params (they differ from reqs).
  app.get("/api/external-requirements/pipnet-inspect-property-search", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await inspectPipnetPropertySearch();
      if (!res.headersSent) res.json(result);
    } catch (err: any) {
      console.error("[pipnet-inspect-property-search] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "PIPnet property search inspect failed" });
    }
  });

  // Debug: fetch one requirement's detail page from PIPnet and dump every
  // label/value pair we can find. Lets us see exactly what extra fields are
  // available behind the click-through.
  app.get("/api/external-requirements/pipnet-inspect-detail", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { inspectPipnetDetail } = await import("./pipnet");
      const result = await inspectPipnetDetail();
      if (!res.headersSent) res.json(result);
    } catch (err: any) {
      console.error("[pipnet-inspect-detail] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "PIPnet detail inspect failed" });
    }
  });

  // Debug: return the actual column headers PIPnet is using on already-imported
  // rows, plus a small sample of values per column. Lets us see field names
  // without re-scraping.
  app.get("/api/external-requirements/pipnet-headers", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { externalRequirements: extReq } = await import("@shared/schema");
      const rows = await db
        .select({ rawData: extReq.rawData })
        .from(extReq)
        .where(eq(extReq.source, "PIPnet"))
        .limit(20);
      const headerCounts: Record<string, number> = {};
      const samples: Record<string, string[]> = {};
      for (const r of rows) {
        const raw = (r.rawData ?? {}) as Record<string, any>;
        for (const [k, v] of Object.entries(raw)) {
          if (k.startsWith("_")) continue;
          headerCounts[k] = (headerCounts[k] ?? 0) + 1;
          const val = String(v ?? "").trim();
          if (val && (samples[k]?.length ?? 0) < 3) {
            (samples[k] ??= []).push(val.length > 80 ? val.slice(0, 80) + "…" : val);
          }
        }
      }
      const headers = Object.entries(headerCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, presentIn: count, samples: samples[name] ?? [] }));
      if (!res.headersSent) res.json({ rowsInspected: rows.length, headers });
    } catch (err: any) {
      console.error("[pipnet-headers] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "Failed to read PIPnet headers" });
    }
  });

  // Admin: wipe the leasing requirements that previously came from PIPnet
  // (using the wrong contact mapping) and re-run the sync with the corrected
  // promote logic. Only removes rows whose name matches a PIPnet-sourced
  // external_requirements row. CRM companies/contacts are left in place
  // (re-sync will reuse or update them).
  app.post("/api/external-requirements/resync-pipnet", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { externalRequirements: extReq, crmRequirementsLeasing: crmReqL } = await import("@shared/schema");
      const { inArray, sql: drizzleSql } = await import("drizzle-orm");
      const pipnetRows = await db
        .select({ id: extReq.id, companyName: extReq.companyName })
        .from(extReq)
        .where(eq(extReq.source, "PIPnet"));
      const clientNames = Array.from(new Set(pipnetRows.map(r => r.companyName).filter((n): n is string => !!n)));
      let deletedReqs = 0;
      if (clientNames.length > 0) {
        const deleted = await db
          .delete(crmReqL)
          .where(inArray(crmReqL.name, clientNames))
          .returning({ id: crmReqL.id });
        deletedReqs = deleted.length;
      }
      // Reset status so promoteToCrmRequirement re-runs for every PIPnet row.
      await db.update(extReq).set({ status: drizzleSql`'active'` }).where(eq(extReq.source, "PIPnet"));

      const result = await importPipnetRequirements({ allPages: true, monthsBack: 3, autoPromote: true });
      if (!res.headersSent) res.json({ deletedReqs, clientNames: clientNames.length, ...result });
    } catch (err: any) {
      console.error("[resync-pipnet] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "PIPnet resync failed" });
    }
  });

  // ComplyAdvantage diagnostic — probes several candidate search-endpoint
  // URLs and reports which return non-405 responses. The current `/v2/searches`
  // path 405s every time at nginx level; this helps pinpoint the new path
  // without guessing.
  app.get("/api/comply-advantage/probe", requireAuth, async (req, res) => {
    try {
      const { probeComplyAdvantage } = await import("./comply-advantage");
      const testName = String(req.query.name || "John Smith");
      const results = await probeComplyAdvantage(testName);
      res.json({ probed: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Re-run Claude vision over an already-imported external requirement's
  // brochure and merge the extracted fields back into the row. Useful when:
  // - the requirement was imported BEFORE the vision parser was wired (older
  //   PIPnet rows have only the noisy tabular metadata)
  // - the prompt has been tuned and we want to re-extract
  // - the original parse was low-confidence
  //
  // POST /api/external-requirements/:id/reparse-vision
  app.post("/api/external-requirements/:id/reparse-vision", requireAuth, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { externalRequirements: extReq } = await import("@shared/schema");
      const { getFile } = await import("./file-storage");
      const { parseRequirementBrochure, mergeVisionIntoRecord } = await import("./requirement-vision-parser");
      const [row] = await db.select().from(extReq).where(eq(extReq.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Requirement not found" });
      const brochure = (row.rawData as any)?._brochurePack;
      if (!brochure?.url) {
        return res.status(400).json({ message: "No brochure pack on this row — vision needs a PDF" });
      }
      // The URL is /api/crm/landlord-packs/<filename>. Reconstruct the storage key.
      const filename = String(brochure.url).split("/").pop();
      if (!filename) return res.status(400).json({ message: "Couldn't parse brochure URL" });
      const file = await getFile(`landlord-packs/${filename}`);
      if (!file) return res.status(404).json({ message: "Brochure file missing from storage" });
      const vision = await parseRequirementBrochure({ pdfBuffer: file.data });
      if (!vision) return res.status(502).json({ message: "Vision parse failed or returned nothing" });
      const updated: any = {
        sizeRange: row.sizeRange,
        useClass: row.useClass,
        locations: row.locations,
        tenure: row.tenure,
        description: row.description,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
      };
      mergeVisionIntoRecord(updated, vision);
      await db.update(extReq)
        .set({ ...updated, rawData: { ...(row.rawData as any || {}), _visionParse: vision }, updatedAt: new Date() })
        .where(eq(extReq.id, id));
      res.json({ ok: true, confidence: vision.confidence, fields: updated, vision });
    } catch (err: any) {
      console.error("[reparse-vision] failed:", err?.message);
      res.status(500).json({ message: err?.message || "Vision reparse failed" });
    }
  });

  // TRL: full sync — discovers every requirement URL via TRL's search and
  // imports + auto-promotes each into crm_requirements_leasing.
  app.post("/api/external-requirements/sync-trl", requireAuth, async (_req, res) => {
    try {
      const { syncAllTrlRequirements } = await import("./trl");
      const result = await syncAllTrlRequirements();
      if (!res.headersSent) res.json(result);
    } catch (err: any) {
      console.error("[sync-trl] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "TRL sync failed" });
    }
  });

  // TRL: wipe every TRL-sourced leasing requirement and re-sync. Mirror of
  // resync-pipnet — only removes crm rows whose name matches a TRL-sourced
  // external_requirements row, leaving manual entries untouched.
  app.post("/api/external-requirements/resync-trl", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { externalRequirements: extReq, crmRequirementsLeasing: crmReqL } = await import("@shared/schema");
      const { inArray, sql: drizzleSql } = await import("drizzle-orm");
      const { syncAllTrlRequirements } = await import("./trl");
      const trlRows = await db
        .select({ id: extReq.id, companyName: extReq.companyName })
        .from(extReq)
        .where(eq(extReq.source, "TRL"));
      const clientNames = Array.from(new Set(trlRows.map(r => r.companyName).filter((n): n is string => !!n)));
      let deletedReqs = 0;
      if (clientNames.length > 0) {
        const deleted = await db
          .delete(crmReqL)
          .where(inArray(crmReqL.name, clientNames))
          .returning({ id: crmReqL.id });
        deletedReqs = deleted.length;
      }
      await db.update(extReq).set({ status: drizzleSql`'active'` }).where(eq(extReq.source, "TRL"));
      const result = await syncAllTrlRequirements();
      if (!res.headersSent) res.json({ deletedReqs, clientNames: clientNames.length, ...result });
    } catch (err: any) {
      console.error("[resync-trl] failed:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "TRL resync failed" });
    }
  });

  app.delete("/api/external-requirements/:id", requireAuth, async (req, res) => {
    try {
      await db
        .delete(externalRequirements)
        .where(eq(externalRequirements.id, req.params.id as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete requirement" });
    }
  });

  app.post("/api/external-requirements/:id/convert", requireAuth, async (req, res) => {
    try {
      const ext = await db
        .select()
        .from(externalRequirements)
        .where(eq(externalRequirements.id, req.params.id as string))
        .limit(1);
      if (ext.length === 0) return res.status(404).json({ message: "Not found" });
      const item = ext[0];

      const result = await db.transaction(async (tx) => {
        let companyId: string | null = null;
        if (item.companyName) {
          const existingCompany = await tx
            .select()
            .from(crmCompanies)
            .where(eq(crmCompanies.name, item.companyName))
            .limit(1);
          if (existingCompany.length > 0) {
            companyId = existingCompany[0].id;
          } else {
            const [newCompany] = await tx
              .insert(crmCompanies)
              .values({ name: item.companyName })
              .returning({ id: crmCompanies.id });
            companyId = newCompany.id;
          }
        }

        let contactId: string | null = null;
        if (item.contactName) {
          const existingContact = await tx
            .select()
            .from(crmContacts)
            .where(eq(crmContacts.name, item.contactName))
            .limit(1);
          if (existingContact.length > 0) {
            contactId = existingContact[0].id;
          } else {
            const [newContact] = await tx
              .insert(crmContacts)
              .values({
                name: item.contactName,
                companyName: item.companyName,
                email: item.contactEmail,
                phone: item.contactPhone,
                role: item.contactTitle,
                companyId,
              })
              .returning({ id: crmContacts.id });
            contactId = newContact.id;
          }
        }

        const [req_row] = await tx
          .insert(crmRequirementsLeasing)
          .values({
            name: item.companyName,
            companyId,
            principalContactId: contactId,
            use: item.useClass ? [item.useClass] : null,
            size: item.sizeRange ? [item.sizeRange] : null,
            requirementLocations: item.locations,
            comments: [item.description, item.pitch, `Tenure: ${item.tenure || "N/A"}`]
              .filter(Boolean)
              .join("\n"),
            status: "Active",
          })
          .returning({ id: crmRequirementsLeasing.id });

        await tx
          .update(externalRequirements)
          .set({ status: "converted" })
          .where(eq(externalRequirements.id, item.id));

        return { requirementId: req_row.id, companyId, contactId };
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Conversion failed" });
    }
  });

  app.get("/api/change-requests", requireAuth, async (_req: Request, res: Response) => {
    try {
      const requests = await storage.getAppChangeRequests();
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/change-requests/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body;
      const allowedStatuses = ["pending", "reviewed", "approved", "rejected", "implemented"];
      const cleanUpdates: any = {};
      if (body.status && allowedStatuses.includes(body.status)) {
        cleanUpdates.status = body.status;
        if (body.status === "reviewed") cleanUpdates.reviewedAt = new Date();
        if (body.status === "approved") cleanUpdates.approvedAt = new Date();
      }
      if (typeof body.developerNotes === "string") cleanUpdates.developerNotes = body.developerNotes;
      if (typeof body.adminNotes === "string") cleanUpdates.adminNotes = body.adminNotes;
      if (Object.keys(cleanUpdates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      const updated = await storage.updateAppChangeRequest(id, cleanUpdates);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/app-feedback", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { appFeedbackLog } = await import("@shared/schema");
      const feedback = await db.select().from(appFeedbackLog).orderBy(desc(appFeedbackLog.createdAt)).limit(200);
      res.json(feedback);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/app-feedback/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { appFeedbackLog } = await import("@shared/schema");
      if (!/^\d+$/.test(req.params.id as string)) return res.status(400).json({ message: "Invalid id" });
      const id = Number(req.params.id);
      const { status, adminNotes } = req.body;
      const updates: any = {};
      if (status && ["new", "acknowledged", "in_progress", "resolved", "dismissed"].includes(status)) {
        updates.status = status;
        if (status === "resolved") updates.resolvedAt = new Date();
      }
      if (typeof adminNotes === "string") updates.adminNotes = adminNotes;
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      const [updated] = await db.update(appFeedbackLog).set(updates).where(eq(appFeedbackLog.id, id)).returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/chatbgp-learnings/ingest-folder", requireAuth, async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "SharePoint folder URL is required" });
      }
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) {
        return res.status(401).json({ message: "Microsoft 365 not connected. Please connect via SharePoint page first." });
      }

      const { chatbgpLearnings } = await import("@shared/schema");
      const nodePath = await import("node:path");
      const nodeFs = await import("node:fs");

      const encodedUrl = Buffer.from(url.trim()).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const sharingUrl = `u!${encodedUrl}`;

      const driveItemRes = await fetch(
        `https://graph.microsoft.com/v1.0/shares/${sharingUrl}/driveItem`,
        { headers: { Authorization: `Bearer ${msToken}` } }
      );
      if (!driveItemRes.ok) {
        return res.status(400).json({ message: `Cannot access folder (${driveItemRes.status})` });
      }
      const driveItem = await driveItemRes.json();
      const driveId = driveItem.parentReference?.driveId;
      const folderId = driveItem.id;

      const supportedExts = [".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc", ".pptx"];

      async function collectFilesRecursive(dId: string, parentId: string, parentPath: string, depth: number = 0): Promise<Array<{id: string; name: string; folderPath: string}>> {
        if (depth > 4) return [];
        const res2 = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${dId}/items/${parentId}/children?$top=200&$select=name,size,webUrl,id,file,folder,lastModifiedDateTime`,
          { headers: { Authorization: `Bearer ${msToken}` } }
        );
        if (!res2.ok) return [];
        const data = await res2.json();
        const results: Array<{id: string; name: string; folderPath: string}> = [];
        for (const item of data.value || []) {
          if (item.folder) {
            const subPath = parentPath ? `${parentPath}/${item.name}` : item.name;
            const subFiles = await collectFilesRecursive(dId, item.id, subPath, depth + 1);
            results.push(...subFiles);
          } else if (item.file) {
            const ext = nodePath.extname(item.name).toLowerCase();
            if (supportedExts.includes(ext)) {
              results.push({ id: item.id, name: item.name, folderPath: parentPath });
            }
          }
        }
        return results;
      }

      const readableFiles = await collectFilesRecursive(driveId, folderId, "");

      let processed = 0;
      let learningsCreated = 0;
      const errors: string[] = [];

      const existingLearnings = await db.select({ sourceUserName: chatbgpLearnings.sourceUserName })
        .from(chatbgpLearnings)
        .where(sql`${chatbgpLearnings.sourceUserName} LIKE 'SharePoint:%'`);
      const alreadyProcessed = new Set(existingLearnings.map(l => l.sourceUserName));

      for (const file of readableFiles) {
        const fileLabel = file.folderPath ? `${file.folderPath}/${file.name}` : file.name;
        if (alreadyProcessed.has(`SharePoint: ${fileLabel}`) || alreadyProcessed.has(`SharePoint: ${file.name}`)) {
          continue;
        }
        try {
          const contentRes = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.id}/content`,
            { headers: { Authorization: `Bearer ${msToken}` }, redirect: "follow" }
          );
          if (!contentRes.ok) { errors.push(`${fileLabel}: download failed`); continue; }

          const buffer = Buffer.from(await contentRes.arrayBuffer());
          const tempDir = nodePath.join(process.cwd(), "ChatBGP", "sp-temp");
          if (!nodeFs.existsSync(tempDir)) nodeFs.mkdirSync(tempDir, { recursive: true });
          const tempPath = nodePath.join(tempDir, `learn-${Date.now()}-${file.name}`);
          nodeFs.writeFileSync(tempPath, buffer);

          let text = "";
          try {
            const { extractTextFromFile } = await import("./chatbgp");
            text = await extractTextFromFile(tempPath, file.name);
          } catch {
            const ext = nodePath.extname(file.name).toLowerCase();
            if (ext === ".txt" || ext === ".csv") {
              text = nodeFs.readFileSync(tempPath, "utf-8");
            }
          } finally {
            try { nodeFs.unlinkSync(tempPath); } catch {}
          }

          if (!text || text.trim().length < 50) { errors.push(`${fileLabel}: too short or empty`); continue; }

          const truncated = text.slice(0, 12000);
          const completion = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            messages: [
              {
                role: "system",
                content: `You are analysing business documents for BGP (Bruce Gillingham Pollard), a London commercial property consultancy operating in Belgravia, Mayfair, and Chelsea.

Extract the most important, reusable business knowledge from this document as a JSON array of learnings. Each learning should be a standalone fact that would help an AI assistant give better advice about BGP's business.

Categories: client_intel, market_knowledge, bgp_process, property_insight, team_preference, general

Rules:
- Extract 3-10 learnings per document depending on content richness
- Each learning should be specific and actionable, not vague
- Include names, numbers, addresses, and dates where relevant
- Skip boilerplate, headers, and formatting artifacts
- Focus on: client relationships, market data, property details, deal terms, BGP processes, team structure

Respond ONLY with a JSON array: [{"category":"...","learning":"..."},...]`
              },
              { role: "user", content: `File: ${fileLabel}\n\nContent:\n${truncated}` }
            ],
            max_completion_tokens: 2000,
          });

          const raw = completion.choices[0]?.message?.content || "[]";
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            let items: any[];
            try { items = JSON.parse(jsonMatch[0]); } catch { items = []; }
            for (const item of items) {
              if (item.learning && item.learning.length > 10) {
                await db.insert(chatbgpLearnings).values({
                  category: item.category || "general",
                  learning: item.learning,
                  sourceUserName: `SharePoint: ${fileLabel}`,
                  confidence: "extracted",
                  active: true,
                });
                learningsCreated++;
              }
            }
          }
          processed++;
        } catch (err: any) {
          errors.push(`${fileLabel}: ${err.message}`);
        }
      }

      res.json({
        success: true,
        totalFiles: readableFiles.length,
        processed,
        learningsCreated,
        errors: errors.length > 0 ? errors : undefined,
      });
      if (learningsCreated > 0) invalidateContextCache("businessLearnings");
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/chatbgp-learnings", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { chatbgpLearnings } = await import("@shared/schema");
      const learnings = await db.select().from(chatbgpLearnings).orderBy(desc(chatbgpLearnings.createdAt)).limit(200);
      res.json(learnings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/chatbgp-learnings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { chatbgpLearnings } = await import("@shared/schema");
      if (!/^\d+$/.test(req.params.id as string)) return res.status(400).json({ message: "Invalid id" });
      const id = Number(req.params.id);
      const { active } = req.body;
      if (typeof active !== "boolean") {
        return res.status(400).json({ message: "active must be boolean" });
      }
      const [updated] = await db.update(chatbgpLearnings).set({ active }).where(eq(chatbgpLearnings.id, id)).returning();
      invalidateContextCache("businessLearnings");
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/chatbgp-learnings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { chatbgpLearnings } = await import("@shared/schema");
      if (!/^\d+$/.test(req.params.id as string)) return res.status(400).json({ message: "Invalid id" });
      const id = Number(req.params.id);
      await db.delete(chatbgpLearnings).where(eq(chatbgpLearnings.id, id));
      invalidateContextCache("businessLearnings");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // --- Public leasing feed (bgp marketing website) ---
  // Read-only, unauthenticated. Exposes only marketing-safe fields for units
  // being publicly marketed, and skips properties with leasing privacy enabled.
  const PUBLIC_MARKETING_STATUSES = ["Available", "Under Offer"];

  app.use("/api/public", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const publicListingColumns = () => import("@shared/schema").then(({ availableUnits, crmProperties }) => ({
    id: availableUnits.id,
    unitName: availableUnits.unitName,
    floor: availableUnits.floor,
    sqft: availableUnits.sqft,
    askingRent: availableUnits.askingRent,
    ratesPa: availableUnits.ratesPa,
    serviceChargePa: availableUnits.serviceChargePa,
    useClass: availableUnits.useClass,
    condition: availableUnits.condition,
    availableDate: availableUnits.availableDate,
    marketingStatus: availableUnits.marketingStatus,
    location: availableUnits.location,
    epcRating: availableUnits.epcRating,
    propertyName: crmProperties.name,
    propertyAddress: crmProperties.address,
    postcode: crmProperties.postcode,
    latitude: crmProperties.latitude,
    longitude: crmProperties.longitude,
    assetClass: crmProperties.assetClass,
  }));

  app.get("/api/public/leasing-listings", async (_req, res) => {
    try {
      const { availableUnits, crmProperties, unitMarketingFiles } = await import("@shared/schema");
      const columns = await publicListingColumns();
      const rows = await db
        .select(columns)
        .from(availableUnits)
        .leftJoin(crmProperties, eq(availableUnits.propertyId, crmProperties.id))
        .where(and(
          inArray(availableUnits.marketingStatus, PUBLIC_MARKETING_STATUSES),
          or(eq(crmProperties.leasingPrivacyEnabled, false), sql`${crmProperties.leasingPrivacyEnabled} IS NULL`),
        ))
        .orderBy(desc(availableUnits.createdAt));
      const unitIds = rows.map(r => r.id);
      const files = unitIds.length
        ? await db
            .select({
              id: unitMarketingFiles.id,
              unitId: unitMarketingFiles.unitId,
              fileName: unitMarketingFiles.fileName,
              mimeType: unitMarketingFiles.mimeType,
            })
            .from(unitMarketingFiles)
            .where(inArray(unitMarketingFiles.unitId, unitIds))
        : [];
      const byUnit: Record<string, typeof files> = {};
      for (const f of files) (byUnit[f.unitId] ||= []).push(f);
      res.json(rows.map(r => ({ ...r, files: byUnit[r.id] || [] })));
    } catch (err: any) {
      console.error("[routes] Public leasing listings error:", err?.message);
      res.status(500).json({ message: "Failed to fetch listings" });
    }
  });

  app.get("/api/public/leasing-listings/:id", async (req, res) => {
    try {
      const { availableUnits, crmProperties, unitMarketingFiles } = await import("@shared/schema");
      const columns = await publicListingColumns();
      const [row] = await db
        .select(columns)
        .from(availableUnits)
        .leftJoin(crmProperties, eq(availableUnits.propertyId, crmProperties.id))
        .where(and(
          eq(availableUnits.id, req.params.id),
          inArray(availableUnits.marketingStatus, PUBLIC_MARKETING_STATUSES),
          or(eq(crmProperties.leasingPrivacyEnabled, false), sql`${crmProperties.leasingPrivacyEnabled} IS NULL`),
        ));
      if (!row) return res.status(404).json({ message: "Listing not found" });
      const files = await db
        .select({
          id: unitMarketingFiles.id,
          fileName: unitMarketingFiles.fileName,
          mimeType: unitMarketingFiles.mimeType,
        })
        .from(unitMarketingFiles)
        .where(eq(unitMarketingFiles.unitId, row.id));
      res.json({ ...row, files });
    } catch (err: any) {
      console.error("[routes] Public leasing listing error:", err?.message);
      res.status(500).json({ message: "Failed to fetch listing" });
    }
  });

  app.get("/api/public/unit-files/:fileId", async (req, res) => {
    try {
      const { availableUnits, crmProperties, unitMarketingFiles } = await import("@shared/schema");
      const [file] = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.id, req.params.fileId));
      if (!file) return res.status(404).end();
      const [unit] = await db
        .select({ id: availableUnits.id })
        .from(availableUnits)
        .leftJoin(crmProperties, eq(availableUnits.propertyId, crmProperties.id))
        .where(and(
          eq(availableUnits.id, file.unitId),
          inArray(availableUnits.marketingStatus, PUBLIC_MARKETING_STATUSES),
          or(eq(crmProperties.leasingPrivacyEnabled, false), sql`${crmProperties.leasingPrivacyEnabled} IS NULL`),
        ));
      if (!unit) return res.status(404).end();
      const fileName = file.filePath.split("/").pop();
      if (fileName) {
        const stored = await getFile(`marketing-files/${fileName}`);
        if (stored) {
          res.setHeader("Content-Type", stored.contentType || file.mimeType || "application/octet-stream");
          res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/"/g, "")}"`);
          res.setHeader("Cache-Control", "public, max-age=3600");
          return res.send(stored.data);
        }
      }
      const diskPath = path.join(process.cwd(), file.filePath);
      if (fs.existsSync(diskPath)) return res.sendFile(diskPath);
      res.status(404).end();
    } catch (err: any) {
      console.error("[routes] Public unit file error:", err?.message);
      res.status(500).end();
    }
  });

  app.get("/api/available-units", requireAuth, async (req, res) => {
    try {
      // Clients (e.g. Landsec) see the Letting Tracker for THEIR OWN
      // properties only, with BGP fees/agents stripped. (Landsec audit.)
      const auScope = await resolveCompanyScope(req);
      // Master physical attributes live on property_units; the listing's columns
      // are kept as a backwards-compat cache. We COALESCE master over listing so
      // every reader sees the source-of-truth values.
      const params: any[] = [];
      const filters: string[] = [];
      if (auScope) {
        params.push(auScope);
        filters.push(`(p.landlord_id = $${params.length} OR au.property_id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $${params.length}))`);
      }
      if (req.query.propertyId) {
        params.push(req.query.propertyId);
        filters.push(`au.property_id = $${params.length}`);
      }
      if (req.query.marketingStatus) {
        params.push(req.query.marketingStatus);
        filters.push(`au.marketing_status = $${params.length}`);
      }
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const result = await pool.query(`
        SELECT
          au.id,
          au.property_id AS "propertyId",
          au.unit_id AS "unitId",
          COALESCE(pu.unit_name, au.unit_name) AS "unitName",
          COALESCE(pu.floor, au.floor) AS "floor",
          COALESCE(pu.sqft, au.sqft) AS "sqft",
          au.asking_rent AS "askingRent",
          au.rates_pa AS "ratesPa",
          au.service_charge_pa AS "serviceChargePa",
          COALESCE(pu.use_class, au.use_class) AS "useClass",
          COALESCE(pu.condition, au.condition) AS "condition",
          au.available_date AS "availableDate",
          au.marketing_status AS "marketingStatus",
          au.location,
          COALESCE(pu.epc_rating, au.epc_rating) AS "epcRating",
          au.notes,
          au.restrictions,
          au.fee,
          au.deal_id AS "dealId",
          d.deal_ref AS "dealRef",
          au.agent_user_ids AS "agentUserIds",
          au.viewings_count AS "viewingsCount",
          au.last_viewing_date AS "lastViewingDate",
          au.marketing_start_date AS "marketingStartDate",
          au.created_at AS "createdAt",
          au.updated_at AS "updatedAt",
          p.name AS "propertyName",
          p.address AS "propertyAddress"
        FROM available_units au
        LEFT JOIN crm_properties p ON p.id = au.property_id
        LEFT JOIN property_units pu ON pu.id = au.unit_id
        LEFT JOIN crm_deals d ON d.id = au.deal_id
        ${whereClause}
        ORDER BY au.created_at DESC
      `, params);
      // Strip BGP fee + agent assignments for client logins.
      if (auScope) {
        return res.json(result.rows.map((r: any) => ({ ...r, fee: null, agentUserIds: null })));
      }
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch available units" });
    }
  });

  app.get("/api/available-units/all-files", requireAuth, async (req, res) => {
    try {
      // unitName comes from property_units master with listing fallback
      const result = await pool.query(`
        SELECT
          umf.id,
          umf.unit_id AS "unitId",
          umf.file_name AS "fileName",
          umf.file_path AS "filePath",
          umf.file_type AS "fileType",
          umf.file_size AS "fileSize",
          umf.mime_type AS "mimeType",
          umf.created_at AS "createdAt",
          COALESCE(pu.unit_name, au.unit_name) AS "unitName",
          au.property_id AS "propertyId"
        FROM unit_marketing_files umf
        LEFT JOIN available_units au ON au.id = umf.unit_id
        LEFT JOIN property_units pu ON pu.id = au.unit_id
        ORDER BY umf.created_at
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch all files" });
    }
  });

  // Letting-activity aggregates for the tracker. These used to be blocked
  // outright for clients (they were firm-wide), which meant a client's Letting
  // Tracker silently lost its viewings/offers controls. They're now SCOPED
  // instead: a client sees viewings/offers on their OWN units only, staff see
  // everything. Landsec seeing activity on their vacant units is the point of
  // the tracker.
  async function clientUnitScopeSql(req: any) {
    const scope = await resolveCompanyScope(req);
    if (!scope) return null; // staff — unrestricted
    return scope;
  }

  app.get("/api/available-units/all-viewings-counts", requireAuth, async (req, res) => {
    try {
      const scope = await clientUnitScopeSql(req);
      const rows = scope
        ? await db.execute(sql`SELECT v.unit_id, COUNT(*)::int as count FROM unit_viewings v
             JOIN available_units u ON u.id = v.unit_id
             LEFT JOIN crm_properties p ON p.id = u.property_id
             LEFT JOIN crm_company_properties cp ON cp.property_id = p.id AND cp.company_id = ${scope}
            WHERE p.landlord_id = ${scope} OR cp.company_id IS NOT NULL
            GROUP BY v.unit_id`)
        : await db.execute(sql`SELECT unit_id, COUNT(*)::int as count FROM unit_viewings GROUP BY unit_id`);
      const counts: Record<string, number> = {};
      for (const r of rows.rows as any[]) counts[r.unit_id] = r.count;
      res.json(counts);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/all-offers-counts", requireAuth, async (req, res) => {
    try {
      const scope = await clientUnitScopeSql(req);
      const rows = scope
        ? await db.execute(sql`SELECT o.unit_id, COUNT(*)::int as count FROM unit_offers o
             JOIN available_units u ON u.id = o.unit_id
             LEFT JOIN crm_properties p ON p.id = u.property_id
             LEFT JOIN crm_company_properties cp ON cp.property_id = p.id AND cp.company_id = ${scope}
            WHERE p.landlord_id = ${scope} OR cp.company_id IS NOT NULL
            GROUP BY o.unit_id`)
        : await db.execute(sql`SELECT unit_id, COUNT(*)::int as count FROM unit_offers GROUP BY unit_id`);
      const counts: Record<string, number> = {};
      for (const r of rows.rows as any[]) counts[r.unit_id] = r.count;
      res.json(counts);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/all-viewings", requireAuth, async (req, res) => {
    try {
      const scope = await clientUnitScopeSql(req);
      if (scope) {
        const rows = await db.execute(sql`SELECT v.* FROM unit_viewings v
             JOIN available_units u ON u.id = v.unit_id
             LEFT JOIN crm_properties p ON p.id = u.property_id
             LEFT JOIN crm_company_properties cp ON cp.property_id = p.id AND cp.company_id = ${scope}
            WHERE p.landlord_id = ${scope} OR cp.company_id IS NOT NULL
            ORDER BY v.viewing_date`);
        return res.json(rows.rows);
      }
      const { unitViewings } = await import("@shared/schema");
      const rows = await db.select().from(unitViewings).orderBy(unitViewings.viewingDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/all-offers", requireAuth, async (req, res) => {
    try {
      const scope = await clientUnitScopeSql(req);
      if (scope) {
        const rows = await db.execute(sql`SELECT o.* FROM unit_offers o
             JOIN available_units u ON u.id = o.unit_id
             LEFT JOIN crm_properties p ON p.id = u.property_id
             LEFT JOIN crm_company_properties cp ON cp.property_id = p.id AND cp.company_id = ${scope}
            WHERE p.landlord_id = ${scope} OR cp.company_id IS NOT NULL
            ORDER BY o.offer_date`);
        return res.json(rows.rows);
      }
      const { unitOffers } = await import("@shared/schema");
      const rows = await db.select().from(unitOffers).orderBy(unitOffers.offerDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/:id", requireAuth, async (req, res) => {
    try {
      // Master overrides cache for unitName/floor/sqft/useClass/condition/epcRating
      const result = await pool.query(`
        SELECT
          au.*,
          au.property_id AS "propertyId",
          au.unit_id AS "unitId",
          COALESCE(pu.unit_name, au.unit_name) AS "unitName",
          COALESCE(pu.floor, au.floor) AS "floor",
          COALESCE(pu.sqft, au.sqft) AS "sqft",
          COALESCE(pu.use_class, au.use_class) AS "useClass",
          COALESCE(pu.condition, au.condition) AS "condition",
          COALESCE(pu.epc_rating, au.epc_rating) AS "epcRating",
          au.asking_rent AS "askingRent",
          au.rates_pa AS "ratesPa",
          au.service_charge_pa AS "serviceChargePa",
          au.available_date AS "availableDate",
          au.marketing_status AS "marketingStatus",
          au.deal_id AS "dealId",
          au.agent_user_ids AS "agentUserIds",
          au.viewings_count AS "viewingsCount",
          au.last_viewing_date AS "lastViewingDate",
          au.marketing_start_date AS "marketingStartDate",
          au.created_at AS "createdAt",
          au.updated_at AS "updatedAt"
        FROM available_units au
        LEFT JOIN property_units pu ON pu.id = au.unit_id
        WHERE au.id = $1
        LIMIT 1
      `, [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Unit not found" });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch unit" });
    }
  });

  // ── Property Units (master record for the physical space) ──────────────
  app.get("/api/property-units", requireAuth, async (req, res) => {
    try {
      const propertyId = (req.query.propertyId as string | undefined) || undefined;
      const where = propertyId ? `WHERE property_id = $1` : "";
      const params = propertyId ? [propertyId] : [];
      const result = await pool.query(
        `SELECT id, property_id, unit_name, floor, sqft, use_class, condition,
                epc_rating, frontage, notes, created_at, updated_at
         FROM property_units ${where}
         ORDER BY unit_name`,
        params
      );
      res.json(result.rows.map(r => ({
        id: r.id,
        propertyId: r.property_id,
        unitName: r.unit_name,
        floor: r.floor,
        sqft: r.sqft,
        useClass: r.use_class,
        condition: r.condition,
        epcRating: r.epc_rating,
        frontage: r.frontage,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to list units" });
    }
  });

  app.post("/api/property-units", requireAuth, async (req, res) => {
    try {
      const { insertPropertyUnitSchema } = await import("@shared/schema");
      const parsed = insertPropertyUnitSchema.parse(req.body);
      if (!parsed.propertyId || !parsed.unitName?.trim()) {
        return res.status(400).json({ message: "propertyId and unitName are required" });
      }
      const result = await pool.query(
        `INSERT INTO property_units (property_id, unit_name, floor, sqft, use_class, condition, epc_rating, frontage, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [parsed.propertyId, parsed.unitName.trim(), parsed.floor || null, parsed.sqft ?? null,
         parsed.useClass || null, parsed.condition || null, parsed.epcRating || null,
         parsed.frontage || null, parsed.notes || null]
      );
      res.json({ id: result.rows[0].id, ...parsed });
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({ message: "A unit with that name already exists on this property" });
      }
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to create unit" });
    }
  });

  app.patch("/api/property-units/:id", requireAuth, async (req, res) => {
    try {
      const allowed = ["unitName", "floor", "sqft", "useClass", "condition", "epcRating", "frontage", "notes",
        "unitAddress", "unitPostcode", "unitUprn", "unitAddressFreeText"];
      const cols: Record<string, string> = {
        unitName: "unit_name", floor: "floor", sqft: "sqft", useClass: "use_class",
        condition: "condition", epcRating: "epc_rating", frontage: "frontage", notes: "notes",
        unitAddress: "unit_address", unitPostcode: "unit_postcode",
        unitUprn: "unit_uprn", unitAddressFreeText: "unit_address_free_text",
      };
      const sets: string[] = [];
      const values: any[] = [];
      let i = 1;
      for (const k of allowed) {
        if (k in req.body) {
          sets.push(`${cols[k]} = $${i++}`);
          values.push((req.body as any)[k]);
        }
      }
      if (sets.length === 0) return res.json({ success: true });
      sets.push(`updated_at = NOW()`);
      values.push(req.params.id);
      await pool.query(
        `UPDATE property_units SET ${sets.join(", ")} WHERE id = $${i}`,
        values
      );
      res.json({ success: true });
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({ message: "A unit with that name already exists on this property" });
      }
      res.status(500).json({ message: err?.message || "Failed to update unit" });
    }
  });

  app.delete("/api/property-units/:id", requireAuth, async (req, res) => {
    try {
      const inUse = await pool.query(
        `SELECT 1 FROM available_units WHERE unit_id = $1
         UNION ALL SELECT 1 FROM crm_deals WHERE unit_id = $1 LIMIT 1`,
        [req.params.id]
      );
      if (inUse.rows.length > 0) {
        return res.status(409).json({ message: "Unit is referenced by listings or deals" });
      }
      await pool.query(`DELETE FROM property_units WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete unit" });
    }
  });

  app.post("/api/available-units", requireAuth, async (req, res) => {
    try {
      const { insertAvailableUnitSchema } = await import("@shared/schema");
      const parsed = insertAvailableUnitSchema.parse(req.body);
      // Clients: own-portfolio only, and never set BGP's fee.
      {
        const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
        const auScope = await resolveCompanyScope(req);
        if (auScope) {
          if (!parsed.propertyId || !(await isPropertyInScope(auScope, parsed.propertyId))) {
            return res.status(403).json({ message: "Unit is outside your portfolio" });
          }
          delete (parsed as any).fee;
        }
      }

      // Ensure a property_units master row exists for this (property, unit name).
      // Create one if missing, then set unit_id on the listing.
      let unitMasterId: string | null = (parsed as any).unitId || null;
      if (!unitMasterId && parsed.propertyId && parsed.unitName?.trim()) {
        const existing = await pool.query(
          `SELECT id FROM property_units
           WHERE property_id = $1 AND lower(trim(unit_name)) = lower(trim($2))`,
          [parsed.propertyId, parsed.unitName]
        );
        if (existing.rows.length > 0) {
          unitMasterId = existing.rows[0].id;
        } else {
          const created = await pool.query(
            `INSERT INTO property_units (property_id, unit_name, floor, sqft, use_class, condition, epc_rating)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [parsed.propertyId, parsed.unitName.trim(), parsed.floor || null, parsed.sqft ?? null,
             parsed.useClass || null, parsed.condition || null, parsed.epcRating || null]
          );
          unitMasterId = created.rows[0].id;
        }
      }

      const unit = await storage.createAvailableUnit({ ...parsed, unitId: unitMasterId || undefined } as any);

      // Also create a leasing_schedule_units row on the same property so the
      // unit shows up on the property's Leasing Schedule view automatically.
      // Pre-SOL units belong on the leasing schedule but NOT on the deal CRM
      // — the deal row gets created later by the SOL promotion flow.
      try {
        const existingLs = await pool.query(
          `SELECT id FROM leasing_schedule_units
           WHERE property_id = $1 AND lower(trim(coalesce(unit_name, ''))) = lower(trim($2))
           LIMIT 1`,
          [parsed.propertyId, parsed.unitName || ""]
        );
        if (existingLs.rows.length === 0) {
          await pool.query(
            `INSERT INTO leasing_schedule_units
               (property_id, unit_name, sqft, rent_pa, status)
             VALUES ($1, $2, $3, $4, $5)`,
            [parsed.propertyId, parsed.unitName || null, parsed.sqft ?? null,
             parsed.askingRent ?? null, parsed.marketingStatus || "AVA"]
          );
        }
      } catch (e: any) {
        console.warn("[available-units POST] leasing-schedule sync failed:", e.message);
      }

      // Mirror onto the tenancy spine (the source of truth): create-or-link a
      // standard, editable tenancy row, deduped by normalised unit name. Means
      // a unit/deal created here shows as a normal row, not a read-only orphan.
      try {
        const { ensureTenancyRowForAvailableUnit } = await import("./unit-mirror");
        await ensureTenancyRowForAvailableUnit(pool, (unit as any).id);
      } catch (e: any) {
        console.warn("[available-units POST] tenancy-spine sync failed:", e.message);
      }

      // Auto-create a backing CRM deal so every tracker row has a source of
      // truth. Deal CRM kanban filters this back out for pre-SOL statuses so
      // the kanban stays clean — see filteredDeals in client/src/pages/deals.tsx.
      //
      // STAGE 3a (unit spine cleanup): when UNIFIED_ADD_UNIT=1, skip this
      // entirely. Deals are then born only at Solicitors promotion (the
      // existing WIP flow at /api/available-units/:id/create-deal, which
      // already handles a missing prior deal via its else-branch).
      // Leaves all the other side-effects above (property_units master,
      // available_units row, leasing_schedule_units row, tenancy spine
      // mirror) untouched — only the silent pre-SOL deal goes away.
      const UNIFIED_ADD_UNIT = process.env.UNIFIED_ADD_UNIT === "1";
      if (!UNIFIED_ADD_UNIT && !unit.dealId) {
        try {
          const property = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
          // Landlord linkage: prefer the value the user picked on the
          // form (it may differ from property.landlord_id if they
          // overrode), then fall back to property.landlord_id. Stamps
          // the deal at AVA so AML on the landlord side fires the
          // moment the deal flips to SOL.
          const landlordId = (req.body as any).landlordId
            || (property as any)?.landlordId
            || null;
          // Also backfill property.landlord_id if the user picked one
          // and the property was missing one — so the next deal on
          // this property doesn't repeat the same prompt.
          if ((req.body as any).landlordId && property && !(property as any).landlordId) {
            try {
              await pool.query(
                `UPDATE crm_properties SET landlord_id = $1 WHERE id = $2 AND landlord_id IS NULL`,
                [(req.body as any).landlordId, property.id]
              );
            } catch (e: any) {
              console.warn("[available-units POST] property landlord backfill failed:", e.message);
            }
          }
          // feePercentage: comes only from the Add-Unit form body (the
          // available_units table doesn't carry it). Without this the
          // auto-created deal loses the % the user typed and reopens blank.
          const feePctRaw = (req.body as any).feePercentage;
          const feePct = feePctRaw != null && feePctRaw !== ""
            ? parseFloat(String(feePctRaw))
            : null;
          // available_units stores agent user IDs (text[] of user.id),
          // but crm_deals.internal_agent stores display names (the
          // deal-detail chip render + add-agent dropdown both look up
          // by name). Resolve IDs → names here so the auto-created deal
          // matches the shape the rest of the UI expects.
          const agentNames = await resolveAgentNames(unit.agentUserIds);
          const deal = await storage.createCrmDeal({
            name: property
              ? `${property.name}${unit.unitName ? ` – ${unit.unitName}` : ""}`
              : unit.unitName,
            propertyId: unit.propertyId || undefined,
            unitId: unitMasterId || undefined,
            status: unit.marketingStatus || "AVA",
            dealType: (req.body as any).dealType || "New Letting",
            internalAgent: agentNames,
            fee: unit.fee ?? undefined,
            feePercentage: feePct != null && !Number.isNaN(feePct) ? feePct : undefined,
            rentPa: unit.askingRent ?? undefined,
            totalAreaSqft: unit.sqft ?? undefined,
            landlordId: landlordId || undefined,
          } as any);
          await storage.updateAvailableUnit(unit.id, { dealId: deal.id });
          (unit as any).dealId = deal.id;
          (unit as any).dealRef = deal.dealRef;
        } catch (e: any) {
          console.warn("[available-units POST] auto-create deal failed:", e.message);
        }
      }

      // Canonical unit FK: stamp tenancy_unit_id when the new vacant
      // unit's name matches a tenancy_schedule row on the property.
      try {
        await pool.query(
          `UPDATE available_units au
              SET tenancy_unit_id = (
                SELECT ts.id FROM tenancy_schedule_units ts
                 WHERE ts.property_id = au.property_id
                   AND lower(trim(ts.unit_number)) = lower(trim(coalesce(au.unit_name, '')))
                   AND coalesce(trim(ts.unit_number), '') <> ''
                 LIMIT 1
              )
            WHERE au.id = $1 AND au.tenancy_unit_id IS NULL`,
          [unit.id]
        );
      } catch (e: any) { console.warn("[available-units] tenancy_unit_id stamp failed:", e?.message); }

      res.json(unit);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to create unit" });
    }
  });

  app.patch("/api/available-units/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getAvailableUnit(req.params.id as string);
      if (!existing) return res.status(404).json({ message: "Unit not found" });
      const { insertAvailableUnitSchema } = await import("@shared/schema");
      const partial = insertAvailableUnitSchema.partial().parse(req.body);
      // Clients: own-portfolio only, and never set BGP's fee.
      {
        const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
        const auScope = await resolveCompanyScope(req);
        if (auScope) {
          if (!(await isPropertyInScope(auScope, existing.propertyId))) {
            return res.status(403).json({ message: "Unit is outside your portfolio" });
          }
          delete (partial as any).fee;
        }
      }

      // Master-managed fields: write to property_units (the source of truth).
      // We still write the same value to the listing cache so direct DB queries
      // outside our GET endpoints stay coherent until the columns are dropped.
      const MASTER_FIELDS = ["unitName", "floor", "sqft", "useClass", "condition", "epcRating"] as const;
      const masterPatch: Record<string, any> = {};
      for (const f of MASTER_FIELDS) {
        if (f in partial) masterPatch[f] = (partial as any)[f];
      }
      if (existing.unitId && Object.keys(masterPatch).length > 0) {
        const cols: Record<string, string> = {
          unitName: "unit_name", floor: "floor", sqft: "sqft", useClass: "use_class",
          condition: "condition", epcRating: "epc_rating",
        };
        const sets: string[] = [];
        const values: any[] = [];
        let i = 1;
        for (const [k, v] of Object.entries(masterPatch)) {
          sets.push(`${cols[k]} = $${i++}`);
          values.push(v);
        }
        sets.push(`updated_at = NOW()`);
        values.push(existing.unitId);
        try {
          await pool.query(`UPDATE property_units SET ${sets.join(", ")} WHERE id = $${i}`, values);
        } catch (e: any) {
          if (e?.code === "23505") {
            return res.status(409).json({ message: "A unit with that name already exists on this property" });
          }
          throw e;
        }
      }

      const unit = await storage.updateAvailableUnit(req.params.id as string, partial);

      // Mirror deal-bearing fields onto the backing crm_deal so the Deals
      // board + WIP report don't drift from inline tracker edits. Without
      // this, editing agent/fee/rent here updated only the unit row while
      // the deal kept the value captured at create/promote time.
      if (existing.dealId) {
        const dealPatch: Record<string, any> = {};
        if ("agentUserIds" in partial) {
          dealPatch.internalAgent = await resolveAgentNames((partial as any).agentUserIds);
        }
        if ("fee" in partial) dealPatch.fee = (partial as any).fee;
        if ("askingRent" in partial) dealPatch.rentPa = (partial as any).askingRent;
        if ((req.body as any).landlordId) dealPatch.landlordId = (req.body as any).landlordId;
        if ((req.body as any).dealType) dealPatch.dealType = (req.body as any).dealType;
        if (Object.keys(dealPatch).length > 0) {
          try {
            await storage.updateCrmDeal(existing.dealId, dealPatch as any);
          } catch (e: any) {
            console.warn(`[available-units PATCH] deal sync failed for ${existing.dealId}:`, e?.message);
          }
        }
      } else if ((req.body as any).dealType) {
        // The unit has no backing deal (imported row, or born under
        // UNIFIED_ADD_UNIT where deals wait for SOL) but the user
        // explicitly set a Deal Type on the edit dialog. Zod strips
        // dealType from the unit patch (available_units has no such
        // column), so without this the edit silently went nowhere and
        // the tracker's Deal Type column stayed "—". Create the backing
        // deal now and link it — same shape as the POST auto-create.
        try {
          const property = existing.propertyId ? await storage.getCrmProperty(existing.propertyId) : null;
          const dealLandlordId = (req.body as any).landlordId || (property as any)?.landlordId || null;
          const agentNames = await resolveAgentNames((unit as any).agentUserIds);
          const deal = await storage.createCrmDeal({
            name: property
              ? `${property.name}${(unit as any).unitName ? ` – ${(unit as any).unitName}` : ""}`
              : (unit as any).unitName,
            propertyId: existing.propertyId || undefined,
            unitId: (existing as any).unitId || undefined,
            status: (unit as any).marketingStatus || "AVA",
            dealType: (req.body as any).dealType,
            internalAgent: agentNames,
            fee: (unit as any).fee ?? undefined,
            rentPa: (unit as any).askingRent ?? undefined,
            totalAreaSqft: (unit as any).sqft ?? undefined,
            landlordId: dealLandlordId || undefined,
          } as any);
          await storage.updateAvailableUnit(req.params.id as string, { dealId: deal.id });
          (unit as any).dealId = deal.id;
          (unit as any).dealRef = (deal as any).dealRef;
        } catch (e: any) {
          console.warn("[available-units PATCH] deal auto-create failed:", e?.message);
        }
      }

      // Landlord edited on the dialog: available_units doesn't carry a
      // landlord column (Zod strips it above), so persist it by stamping
      // the property when it has none — same semantics as the POST route.
      if ((req.body as any).landlordId && existing.propertyId) {
        try {
          await pool.query(
            `UPDATE crm_properties SET landlord_id = $1 WHERE id = $2 AND landlord_id IS NULL`,
            [(req.body as any).landlordId, existing.propertyId]
          );
        } catch (e: any) {
          console.warn("[available-units PATCH] property landlord backfill failed:", e?.message);
        }
      }

      // Three-way status mirror: when the marketing status changes on the
      // Letting Tracker, propagate to the linked crm_deal and to the
      // leasing-schedule row that shares this unit's tenancy_unit_id.
      let mirrorWarning: string | null = null;
      if ("marketingStatus" in partial) {
        try {
          const { mirrorFromAvailableUnit } = await import("./lease-status-mirror");
          await mirrorFromAvailableUnit(req.params.id as string, (partial as any).marketingStatus, { pool, reason: "available_units.PATCH" });
        } catch (e: any) {
          console.warn(`[available-units PATCH] status mirror failed for ${req.params.id}:`, e?.message);
          mirrorWarning = `Status saved, but syncing it to the Deals board / Leasing Schedule failed (${e?.message || "unknown error"}). The other boards may briefly disagree.`;
        }
      }

      // Re-stamp tenancy_unit_id when the unit name changes — only when
      // the new name resolves to a real tenancy row. COALESCE preserves
      // the existing link otherwise; without the guard, a rename to a
      // value that no longer matches would silently wipe the FK and
      // drop the row off the 4-way mirror.
      if ("unitName" in partial) {
        await pool.query(
          `UPDATE available_units au
              SET tenancy_unit_id = COALESCE((
                SELECT ts.id FROM tenancy_schedule_units ts
                 WHERE ts.property_id = au.property_id
                   AND lower(trim(ts.unit_number)) = lower(trim(coalesce(au.unit_name, '')))
                   AND coalesce(trim(ts.unit_number), '') <> ''
                 LIMIT 1
              ), au.tenancy_unit_id)
            WHERE au.id = $1`,
          [req.params.id]
        ).catch((e: any) => console.warn("[available-units] tenancy_unit_id re-stamp failed:", e?.message));
      }

      res.json(mirrorWarning ? { ...(unit as any), mirrorWarning } : unit);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to update unit" });
    }
  });

  app.delete("/api/available-units/:id", requireAuth, async (req, res) => {
    try {
      // Add Unit auto-creates a stub deal at AVA alongside the unit row.
      // If that deal is still at AVA when the unit is deleted, remove it
      // too — otherwise it lingers on the boards with no unit behind it.
      // Deals that progressed past AVA are kept (real pipeline history)
      // and just lose their unit link via deleteAvailableUnit.
      const unitId = String(req.params.id);
      const unitRow = await storage.getAvailableUnit(unitId);
      if (await assertUnitInClientScope(req, unitRow?.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      await storage.deleteAvailableUnit(unitId);
      if (unitRow?.dealId) {
        try {
          const linkedDeal = await storage.getCrmDeal(unitRow.dealId);
          const { legacyToCode } = await import("@shared/deal-status");
          if (linkedDeal && legacyToCode(linkedDeal.status) === "AVA") {
            await storage.deleteCrmDeal(unitRow.dealId);
          }
        } catch (e: any) {
          console.warn(`[available-units DELETE] stub deal cleanup failed for ${unitRow.dealId}:`, e?.message);
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete unit" });
    }
  });

  // HMLR direct upload — fallback for when the gov.uk API is being
  // stale about our licence (returning example.csv even after licence
  // signing). User downloads the CCOD/OCOD .csv from the gov.uk
  // dashboard and posts it here as multipart form-data. Same downstream
  // ingest as the API-driven sync, just with a local file path instead
  // of an HMLR download URL.
  //
  // 2 GB disk-streamed multer — CCOD's full file is 1.56 GB. Memory
  // storage would OOM Railway; use disk and stream-parse from there.
  const hmlrUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, os.tmpdir()),
      filename: (_req, file, cb) => cb(null, `hmlr-upload-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  });
  app.post("/api/admin/hmlr/upload", requireAuth, hmlrUpload.single("file"), async (req: any, res) => {
    try {
      const userRes = await pool.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1",
        [req.session?.userId],
      );
      if (!userRes.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });

      if (!req.file) return res.status(400).json({ error: "no file uploaded (use multipart field 'file')" });

      const localPath = req.file.path;
      const filename = req.file.originalname;

      // Auto-detect dataset from the filename so a caller can't
      // accidentally mislabel — CCOD_FULL_*.zip is always CCOD, OCOD_FULL_*.zip
      // always OCOD. Caller can still override via dataset form field
      // if they really want, but if filename and override disagree we
      // trust the filename and reject the call so we don't half-ingest
      // junk under the wrong label.
      const explicitDataset = (req.body?.dataset || req.query?.dataset) as "ccod" | "ocod" | undefined;
      let detectedDataset: "ccod" | "ocod" | null = null;
      if (/(^|[^a-z])ccod(_|\.|$)/i.test(filename)) detectedDataset = "ccod";
      else if (/(^|[^a-z])ocod(_|\.|$)/i.test(filename)) detectedDataset = "ocod";
      if (detectedDataset && explicitDataset && detectedDataset !== explicitDataset) {
        try { fs.unlinkSync(localPath); } catch { /* ignore */ }
        return res.status(400).json({
          error: `Filename suggests ${detectedDataset.toUpperCase()} but caller said ${explicitDataset.toUpperCase()}. Either rename the file or pass the correct dataset.`,
        });
      }
      const dataset = detectedDataset || explicitDataset;
      if (dataset !== "ccod" && dataset !== "ocod") {
        try { fs.unlinkSync(localPath); } catch { /* ignore */ }
        return res.status(400).json({ error: "Cannot detect dataset from filename. Pass dataset='ccod' or 'ocod' explicitly." });
      }
      console.log(`[hmlr-upload] received ${filename} (${(req.file.size / 1024 / 1024).toFixed(1)} MB) → ${localPath}`);

      // Background ingest — same pattern as the API sync, returns 202
      // immediately and writes progress to hmlr_ingest_runs.
      setImmediate(() => {
        (async () => {
          try {
            const { ingestUploadedCsv } = await import("./hmlr-fetch");
            await ingestUploadedCsv(localPath, dataset, filename);
            try { fs.unlinkSync(localPath); } catch { /* ignore */ }
          } catch (err: any) {
            console.error(`[hmlr-upload] ingest failed for ${filename}:`, err?.message);
          }
        })();
      });
      res.status(202).json({ ok: true, message: `${dataset.toUpperCase()} ingest started — poll /api/admin/hmlr/runs for progress`, dataset, sizeBytes: req.file.size });
    } catch (e: any) {
      console.error("[hmlr-upload] failed to start:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch CCOD / OCOD from a SharePoint share link and ingest server-
  // side. Way better than browser upload for the 1.5 GB CCOD case
  // because nothing crosses through Railway's edge proxy — server
  // streams from Microsoft Graph straight to local /tmp, then runs
  // the existing ingest path. Folder share links are walked
  // automatically; the matcher picks up files named CCOD_FULL_*.zip
  // / OCOD_FULL_*.zip / *.csv variants.
  app.post("/api/admin/hmlr/fetch-from-sharepoint", requireAuth, async (req: any, res) => {
    try {
      const userRes = await pool.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1",
        [req.session?.userId],
      );
      if (!userRes.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });
      const shareUrl: string = req.body?.shareUrl;
      if (!shareUrl) return res.status(400).json({ error: "shareUrl required in body" });

      const { resolveSharePointShareLinkMetadata, streamUrlToFile } = await import("./sharepoint-resolver");
      const { ingestUploadedCsv } = await import("./hmlr-fetch");

      const meta = await resolveSharePointShareLinkMetadata(shareUrl);
      // Figure out the list of {filename, downloadUrl, size} to ingest.
      // Folder share → all matching children. File share → just that file.
      const candidates: { filename: string; downloadUrl: string; size: number }[] = meta.isFolder
        ? (meta.children || [])
        : meta.downloadUrl
          ? [{ filename: meta.name, downloadUrl: meta.downloadUrl, size: meta.size || 0 }]
          : [];
      const hmlrFiles = candidates.filter((c) => /^(ccod|ocod)/i.test(c.filename) && /\.(zip|csv)$/i.test(c.filename));
      if (hmlrFiles.length === 0) {
        return res.status(400).json({
          error: `No CCOD/OCOD files found at share link. Filtered children: ${candidates.map((c) => c.filename).join(", ") || "(empty)"}. Raw folder contents: ${meta.rawChildSummary ? `${meta.rawChildSummary.total} items, sample: ${meta.rawChildSummary.sample.join(", ")}` : "(no folder)"}. Expected names like CCOD_FULL_2026_05.zip or OCOD_FULL_2026_05.csv.`,
          rawChildSummary: meta.rawChildSummary,
          candidates: candidates.map((c) => c.filename),
        });
      }

      // Fire-and-forget: stream each file to /tmp then ingest. Returns
      // 202 immediately. Each file gets its own hmlr_ingest_runs row so
      // /api/admin/hmlr/runs shows progress per dataset.
      setImmediate(() => {
        (async () => {
          for (const f of hmlrFiles) {
            const localPath = path.join(os.tmpdir(), `hmlr-sp-${Date.now()}-${f.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
            try {
              console.log(`[hmlr-sp] streaming ${f.filename} (${(f.size / 1024 / 1024).toFixed(1)} MB) to ${localPath}`);
              await streamUrlToFile(f.downloadUrl, localPath);
              // ingestUploadedCsv autodetects the dataset from filename
              const detected = /^ccod/i.test(f.filename) ? "ccod" : "ocod";
              await ingestUploadedCsv(localPath, detected, f.filename);
            } catch (err: any) {
              console.error(`[hmlr-sp] failed for ${f.filename}:`, err?.message);
            } finally {
              try { fs.unlinkSync(localPath); } catch { /* ignore */ }
            }
          }
        })();
      });

      res.status(202).json({
        ok: true,
        message: `Started ingest for ${hmlrFiles.length} file(s) — poll /api/admin/hmlr/runs for progress`,
        files: hmlrFiles.map((f) => ({ filename: f.filename, sizeMB: Math.round(f.size / 1024 / 1024) })),
      });
    } catch (e: any) {
      console.error("[hmlr-sp] failed to start:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Fetch INSPIRE Index Polygons from a SharePoint share link and ingest
  // them into hmlr_title_polygons (map boundary shading). Mirrors the
  // CCOD/OCOD fetch above but routes to the polygon ingest, which handles
  // .zip/.gml/.geojson/.ndjson and lets PostGIS reproject 27700 → 4326.
  app.post("/api/admin/hmlr/fetch-polygons-from-sharepoint", requireAuth, async (req: any, res) => {
    try {
      const userRes = await pool.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1",
        [req.session?.userId],
      );
      if (!userRes.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });
      const shareUrl: string = req.body?.shareUrl;
      if (!shareUrl) return res.status(400).json({ error: "shareUrl required in body" });
      const region: string | null = req.body?.region ? String(req.body.region).trim() : null;

      // Councils mode: pull only the named local authorities straight out of
      // the national zip via HTTP range requests — no whole-file download,
      // web-dyno-safe for a handful of councils. (NOT a way to load all 348 —
      // 24M parcels still needs the offline CLI.)
      const councils: string[] = Array.isArray(req.body?.councils)
        ? req.body.councils.map((c: any) => String(c)).filter(Boolean)
        : [];
      if (councils.length) {
        const { ingestInspireCouncilsFromShareLink } = await import("./hmlr-polygons-fetch");
        const rr = await pool.query<{ id: string }>(
          `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ('inspire', $1, 'running') RETURNING id`,
          [`councils: ${councils.join(",")}`],
        );
        const runId = rr.rows[0].id;
        setImmediate(() => {
          (async () => {
            try { await ingestInspireCouncilsFromShareLink(shareUrl, { councils, region, runId }); }
            catch (err: any) { console.error("[inspire-councils] failed:", err?.message); }
          })();
        });
        return res.status(202).json({ ok: true, mode: "councils", councils, message: `Started council ingest for ${councils.join(", ")} — poll /api/admin/hmlr/runs` });
      }

      const { resolveSharePointShareLinkMetadata, streamUrlToFile } = await import("./sharepoint-resolver");
      const { ingestInspirePolygonsFile } = await import("./hmlr-polygons-fetch");

      const meta = await resolveSharePointShareLinkMetadata(shareUrl);
      const candidates: { filename: string; downloadUrl: string; size: number }[] = meta.isFolder
        ? (meta.children || [])
        : meta.downloadUrl
          ? [{ filename: meta.name, downloadUrl: meta.downloadUrl, size: meta.size || 0 }]
          : [];
      const polygonFiles = candidates.filter((c) => /\.(zip|gml|geojson|ndjson)$/i.test(c.filename));
      if (polygonFiles.length === 0) {
        return res.status(400).json({
          error: `No INSPIRE polygon files (.zip/.gml/.geojson/.ndjson) found at share link. Filtered children: ${candidates.map((c) => c.filename).join(", ") || "(empty)"}. Raw folder contents: ${meta.rawChildSummary ? `${meta.rawChildSummary.total} items, sample: ${meta.rawChildSummary.sample.join(", ")}` : "(no folder)"}.`,
          rawChildSummary: meta.rawChildSummary,
          candidates: candidates.map((c) => c.filename),
        });
      }

      // Fire-and-forget: reserve a run row up-front (so the attempt + any
      // download/size failure is visible in /api/admin/hmlr/runs, not just
      // server logs), then stream each file to /tmp and ingest. 202 now.
      // 8GB cap: the unzip is now streamed (unzipper), so the national bulk
      // (~5GB) is fine — the file just has to fit on disk to download.
      const MAX_INSPIRE_BYTES = 8 * 1024 * 1024 * 1024;
      setImmediate(() => {
        (async () => {
          for (const f of polygonFiles) {
            const rr = await pool.query<{ id: string }>(
              `INSERT INTO hmlr_ingest_runs (dataset, source_filename, status) VALUES ('inspire', $1, 'running') RETURNING id`,
              [f.filename],
            );
            const runId = rr.rows[0].id;
            if (f.size > MAX_INSPIRE_BYTES) {
              await pool.query(
                `UPDATE hmlr_ingest_runs SET status='error', error=$1, finished_at=now() WHERE id=$2`,
                [`File is ${Math.round(f.size / 1024 / 1024)}MB — over the 8GB ceiling for in-app ingest (it must download to the container disk first). Split it, or load via the scripts/ingest-hmlr-polygons.ts CLI.`, runId],
              );
              console.warn(`[inspire-sp] ${f.filename} too large (${Math.round(f.size / 1024 / 1024)}MB) — skipped`);
              continue;
            }
            const localPath = path.join(os.tmpdir(), `inspire-sp-${Date.now()}-${f.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
            try {
              console.log(`[inspire-sp] streaming ${f.filename} (${(f.size / 1024 / 1024).toFixed(1)} MB) to ${localPath}`);
              await streamUrlToFile(f.downloadUrl, localPath);
              await ingestInspirePolygonsFile(localPath, { region, sourceFilename: f.filename, runId });
            } catch (err: any) {
              await pool.query(`UPDATE hmlr_ingest_runs SET status='error', error=$1, finished_at=now() WHERE id=$2`, [String(err?.message || err).slice(0, 500), runId]).catch(() => {});
              console.error(`[inspire-sp] failed for ${f.filename}:`, err?.message);
            } finally {
              try { fs.unlinkSync(localPath); } catch { /* ignore */ }
            }
          }
        })();
      });

      res.status(202).json({
        ok: true,
        message: `Started INSPIRE polygon ingest for ${polygonFiles.length} file(s) — poll /api/admin/hmlr/runs for progress`,
        files: polygonFiles.map((f) => ({ filename: f.filename, sizeMB: Math.round(f.size / 1024 / 1024) })),
      });
    } catch (e: any) {
      console.error("[inspire-sp] failed to start:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Clear HMLR ingest data — useful when a mislabelled upload has put
  // bad data into the table and you want to start fresh. Caller passes
  // dataset='ccod' | 'ocod' | 'all' to scope the delete.
  app.post("/api/admin/hmlr/reset", requireAuth, async (req: any, res) => {
    try {
      const userRes = await pool.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1",
        [req.session?.userId],
      );
      if (!userRes.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });

      const scope = (req.body?.dataset || "all") as "ccod" | "ocod" | "all";
      if (scope !== "ccod" && scope !== "ocod" && scope !== "all") {
        return res.status(400).json({ error: "dataset must be 'ccod', 'ocod', or 'all'" });
      }
      // TRUNCATE for the "all" path — DELETE on 4M+ rows can hit
      // Railway's statement-timeout and 500. TRUNCATE is constant-
      // time and bypasses MVCC scan. Doesn't give a rowCount back
      // so we return null in that case.
      let deletedProprietorRows: number | null;
      let deletedRunRows: number | null;
      if (scope === "all") {
        await pool.query(`TRUNCATE TABLE hmlr_proprietors`);
        await pool.query(`TRUNCATE TABLE hmlr_ingest_runs`);
        deletedProprietorRows = null;
        deletedRunRows = null;
      } else {
        const propsRes = await pool.query(`DELETE FROM hmlr_proprietors WHERE dataset = $1`, [scope]);
        const runsRes = await pool.query(`DELETE FROM hmlr_ingest_runs WHERE dataset = $1`, [scope]);
        deletedProprietorRows = propsRes.rowCount;
        deletedRunRows = runsRes.rowCount;
      }
      res.json({
        ok: true,
        deletedProprietorRows,
        deletedRunRows,
        scope,
        note: scope === "all" ? "TRUNCATE used; row counts not reported" : undefined,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // HMLR bulk sync — pulls the latest CCOD or OCOD monthly snapshot
  // from gov.uk's "Use land and property data" service and ingests it
  // into hmlr_proprietors. Long-running (1.5GB CCOD takes ~10-15 min);
  // returns 202 immediately and runs in the background. Poll
  // /api/admin/hmlr/runs to see progress.
  app.post("/api/admin/hmlr/sync", requireAuth, async (req: any, res) => {
    try {
      const userRes = await pool.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1",
        [req.session?.userId],
      );
      if (!userRes.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });

      const dataset = (req.body?.dataset || "ccod") as "ccod" | "ocod";
      if (dataset !== "ccod" && dataset !== "ocod") {
        return res.status(400).json({ error: "dataset must be 'ccod' or 'ocod'" });
      }
      if (!process.env.HMLR_API_KEY) {
        return res.status(400).json({ error: "HMLR_API_KEY not set in environment" });
      }

      // Fire and forget — the sync writes its own status to
      // hmlr_ingest_runs, so the client polls that to follow along.
      const { syncHmlrDataset } = await import("./hmlr-fetch");
      setImmediate(() => {
        syncHmlrDataset(dataset).catch((err) => {
          console.error(`[hmlr-sync] ${dataset} background sync failed:`, err?.message);
        });
      });
      res.status(202).json({ ok: true, message: `${dataset.toUpperCase()} sync started — poll /api/admin/hmlr/runs for progress`, dataset });
    } catch (e: any) {
      console.error("[hmlr-sync] failed to start:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Recent HMLR sync runs, newest first. Used by the admin UI to poll
  // sync progress (rows_processed updates every 10k rows mid-flight).
  app.get("/api/admin/hmlr/runs", requireAuth, async (req: any, res) => {
    try {
      const userRes = await pool.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1",
        [req.session?.userId],
      );
      if (!userRes.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });

      const runs = await pool.query(
        `SELECT id, dataset, status, source_filename, rows_processed, rows_inserted, rows_updated, rows_skipped, error, started_at, finished_at
           FROM hmlr_ingest_runs
          ORDER BY started_at DESC
          LIMIT 20`,
      );
      const counts = await pool.query<{ dataset: string; count: string }>(
        `SELECT dataset, COUNT(*)::text AS count FROM hmlr_proprietors GROUP BY dataset`,
      );
      res.json({
        runs: runs.rows,
        counts: Object.fromEntries(counts.rows.map((r) => [r.dataset, Number(r.count)])),
        apiKeySet: !!process.env.HMLR_API_KEY,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Backfill: create CRM deals for any tracker rows that are still missing dealId.
  // Safe to run multiple times — skips rows that already have a dealId.
  app.post("/api/admin/backfill-tracker-deals", requireAuth, async (req, res) => {
    try {
      const { availableUnits, investmentTracker: invTracker } = await import("@shared/schema");
      let created = 0;
      const skipped = 0;

      // --- Letting Tracker ---
      const unlinkedUnits = await db.select().from(availableUnits).where(sql`deal_id IS NULL`);
      for (const unit of unlinkedUnits) {
        try {
          const property = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
          const deal = await storage.createCrmDeal({
            name: property
              ? `${property.name}${unit.unitName ? ` – ${unit.unitName}` : ""}`
              : unit.unitName,
            propertyId: unit.propertyId || undefined,
            unitId: unit.unitId || undefined,
            status: unit.marketingStatus || "AVA",
            dealType: "Leasing",
            internalAgent: await resolveAgentNames(unit.agentUserIds),
            fee: unit.fee ?? undefined,
            rentPa: unit.askingRent ?? undefined,
            totalAreaSqft: unit.sqft ?? undefined,
          } as any);
          await db.update(availableUnits).set({ dealId: deal.id }).where(eq(availableUnits.id, unit.id));
          created++;
        } catch (e: any) {
          console.warn(`[backfill] unit ${unit.id} failed:`, e.message);
        }
      }

      // --- Investment Tracker ---
      const unlinkedInv = await db.select().from(invTracker).where(sql`deal_id IS NULL`);
      for (const row of unlinkedInv) {
        try {
          const dealType = row.boardType === "Sales" ? "Sale" : "Purchase";
          const deal = await storage.createCrmDeal({
            name: row.assetName,
            propertyId: row.propertyId,
            status: "REP",
            dealType,
            internalAgent: await resolveAgentNames(row.agentUserIds),
            fee: row.fee ?? undefined,
          });
          await db.update(invTracker).set({ dealId: deal.id }).where(eq(invTracker.id, row.id));
          created++;
        } catch (e: any) {
          console.warn(`[backfill] inv-tracker ${row.id} failed:`, e.message);
        }
      }

      res.json({ created, skipped, message: `Created ${created} deals for previously unlinked tracker rows` });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Backfill failed" });
    }
  });

  // Rename legacy long team names in crm_deals.team array
  app.post("/api/admin/rename-teams", requireAuth, async (req, res) => {
    try {
      const renames: Record<string, string> = {
        "London Leasing Hospitality": "London F&B",
        "London Leasing Retail": "London Retail",
      };
      let updated = 0;
      for (const [oldName, newName] of Object.entries(renames)) {
        const result = await pool.query(
          `UPDATE crm_deals
           SET team = array_replace(team, $1, $2)
           WHERE $1 = ANY(team)`,
          [oldName, newName]
        );
        updated += result.rowCount ?? 0;
      }
      res.json({ updated, message: `Renamed team values in ${updated} deal(s)` });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Rename failed" });
    }
  });

  // /api/admin/restore-wrongly-archived-deals and /api/admin/wipe-deals
  // removed. Both were tied to the Sage WIP import lifecycle (recovery
  // for orphan-archive false-positives after a Sage reload, and a wipe-
  // before-reimport admin tool). Sage imports are retired.

  // ---- Operator targeting briefs (per letting tracker unit) ----

  app.get("/api/unit-briefs", requireAuth, async (req, res) => {
    try {
      const { unitBriefs, availableUnits, crmProperties, unitTargetOperators } = await import("@shared/schema");
      // Client logins get their OWN briefs only — this list was firm-wide, so
      // opening it to the Letting Tracker would have exposed every other
      // landlord's briefs and target operators.
      const briefScope = await resolveCompanyScope(req);
      const scopedPropertyIds = briefScope
        ? (await pool.query(
            `SELECT id FROM crm_properties WHERE landlord_id = $1
             UNION
             SELECT property_id FROM crm_company_properties WHERE company_id = $1`,
            [briefScope]
          )).rows.map((r: any) => r.id)
        : null;
      if (scopedPropertyIds && scopedPropertyIds.length === 0) return res.json([]);
      const rows = await db
        .select({
          brief: unitBriefs,
          unitName: availableUnits.unitName,
          propertyName: crmProperties.name,
        })
        .from(unitBriefs)
        .leftJoin(availableUnits, eq(unitBriefs.unitId, availableUnits.id))
        .leftJoin(crmProperties, eq(unitBriefs.propertyId, crmProperties.id))
        .where(scopedPropertyIds ? inArray(unitBriefs.propertyId, scopedPropertyIds) : undefined)
        .orderBy(desc(unitBriefs.createdAt));
      // Targets ride along so the Letting Tracker can show each unit's
      // target operators without a per-unit round trip.
      // Only the targets belonging to the briefs we're returning — otherwise
      // a client would still receive every other landlord's target operators.
      const briefIds = rows.map(r => r.brief.id);
      const allTargets = briefIds.length
        ? await db.select().from(unitTargetOperators).where(inArray(unitTargetOperators.briefId, briefIds))
        : [];
      const targetsByBrief = new Map<string, typeof allTargets>();
      for (const t of allTargets) {
        if (!targetsByBrief.has(t.briefId)) targetsByBrief.set(t.briefId, []);
        targetsByBrief.get(t.briefId)!.push(t);
      }
      res.json(rows.map(r => ({ ...r.brief, unitName: r.unitName, propertyName: r.propertyName, targets: (targetsByBrief.get(r.brief.id) || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) })));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch briefs" });
    }
  });

  app.get("/api/available-units/:id/brief", requireAuth, async (req, res) => {
    try {
      const { unitBriefs, unitTargetOperators } = await import("@shared/schema");
      const [brief] = await db.select().from(unitBriefs)
        .where(eq(unitBriefs.unitId, String(req.params.id)))
        .orderBy(desc(unitBriefs.createdAt))
        .limit(1);
      if (!brief) return res.json(null);
      const targets = await db.select().from(unitTargetOperators)
        .where(eq(unitTargetOperators.briefId, brief.id))
        .orderBy(unitTargetOperators.sortOrder, unitTargetOperators.createdAt);
      res.json({ ...brief, targets });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch brief" });
    }
  });

  // Clients may author briefs only on their own units. Returns 403 when a
  // client request targets a unit/property outside their scope; a no-op for
  // BGP staff (null scope).
  async function assertUnitInClientScope(req: any, propertyId: string | null | undefined): Promise<string | null> {
    const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    const scope = await resolveCompanyScope(req);
    if (!scope) return null; // staff — unrestricted
    if (!propertyId || !(await isPropertyInScope(scope, propertyId))) return "out-of-scope";
    return null;
  }
  async function briefPropertyId(briefId: string): Promise<string | null> {
    const r = await pool.query("SELECT property_id FROM unit_briefs WHERE id = $1", [briefId]);
    return r.rows[0]?.property_id ?? null;
  }
  async function targetPropertyId(targetId: string): Promise<string | null> {
    const r = await pool.query(
      "SELECT b.property_id FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id WHERE t.id = $1",
      [targetId]
    );
    return r.rows[0]?.property_id ?? null;
  }

  app.post("/api/available-units/:id/brief", requireAuth, async (req: any, res) => {
    try {
      const unit = await storage.getAvailableUnit(String(req.params.id));
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { unitBriefs, insertUnitBriefSchema } = await import("@shared/schema");
      const userId = req.session?.userId || req.tokenUserId || null;
      let userName: string | null = null;
      if (userId) {
        const r = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
        userName = r.rows[0]?.name || null;
      }
      const parsed = insertUnitBriefSchema.parse({
        ...req.body,
        unitId: unit.id,
        propertyId: unit.propertyId,
        createdByUserId: userId,
        createdByName: userName,
      });
      // Default the client to the property's landlord (e.g. Landsec) —
      // briefs auto-created from the tracker arrive without one, and the
      // targets' Client-Contact picker needs it to offer the client's
      // people (Mark Warne, Jonny Rushton, ...).
      if (!parsed.clientCompanyId && unit.propertyId) {
        const briefProp = await storage.getCrmProperty(unit.propertyId);
        const briefLandlordId = (briefProp as any)?.landlordId;
        if (briefLandlordId) {
          parsed.clientCompanyId = briefLandlordId;
          if (!parsed.clientCompany) {
            const landlordCo = await storage.getCrmCompany(briefLandlordId);
            if (landlordCo?.name) parsed.clientCompany = landlordCo.name;
          }
        }
      }
      const [brief] = await db.insert(unitBriefs).values(parsed).returning();
      res.json(brief);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to create brief" });
    }
  });

  app.patch("/api/unit-briefs/:id", requireAuth, async (req: any, res) => {
    try {
      if (await assertUnitInClientScope(req, await briefPropertyId(String(req.params.id)))) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { unitBriefs, insertUnitBriefSchema } = await import("@shared/schema");
      const partial = insertUnitBriefSchema.partial().parse(req.body);
      const [brief] = await db.update(unitBriefs)
        .set({ ...partial, updatedAt: new Date() })
        .where(eq(unitBriefs.id, String(req.params.id)))
        .returning();
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      res.json(brief);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to update brief" });
    }
  });

  app.delete("/api/unit-briefs/:id", requireAuth, async (req: any, res) => {
    try {
      if (await assertUnitInClientScope(req, await briefPropertyId(String(req.params.id)))) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { unitBriefs, unitTargetOperators } = await import("@shared/schema");
      await db.delete(unitTargetOperators).where(eq(unitTargetOperators.briefId, String(req.params.id)));
      await db.delete(unitBriefs).where(eq(unitBriefs.id, String(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete brief" });
    }
  });

  app.post("/api/unit-briefs/:id/targets", requireAuth, async (req: any, res) => {
    try {
      if (await assertUnitInClientScope(req, await briefPropertyId(String(req.params.id)))) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { unitBriefs, unitTargetOperators, insertUnitTargetOperatorSchema } = await import("@shared/schema");
      const [brief] = await db.select().from(unitBriefs).where(eq(unitBriefs.id, String(req.params.id)));
      if (!brief) return res.status(404).json({ message: "Brief not found" });
      const parsed = insertUnitTargetOperatorSchema.parse({ ...req.body, briefId: brief.id });
      // Auto-link an exact brand-list match when the caller didn't pick one,
      // so every target ties back to the brand list wherever possible.
      if (!parsed.companyId && parsed.operatorName) {
        const match = await pool.query(`SELECT id FROM crm_companies WHERE LOWER(name) = LOWER($1) LIMIT 1`, [parsed.operatorName.trim()]);
        if (match.rows[0]?.id) parsed.companyId = match.rows[0].id;
      }
      const [target] = await db.insert(unitTargetOperators).values(parsed).returning();
      res.json(target);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to add target" });
    }
  });

  app.patch("/api/unit-briefs/targets/:id", requireAuth, async (req: any, res) => {
    try {
      if (await assertUnitInClientScope(req, await targetPropertyId(String(req.params.id)))) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { unitTargetOperators, insertUnitTargetOperatorSchema } = await import("@shared/schema");
      const partial = insertUnitTargetOperatorSchema.partial().parse(req.body);
      const [target] = await db.update(unitTargetOperators)
        .set({ ...partial, updatedAt: new Date() })
        .where(eq(unitTargetOperators.id, String(req.params.id)))
        .returning();
      if (!target) return res.status(404).json({ message: "Target not found" });
      res.json(target);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to update target" });
    }
  });

  app.delete("/api/unit-briefs/targets/:id", requireAuth, async (req: any, res) => {
    try {
      if (await assertUnitInClientScope(req, await targetPropertyId(String(req.params.id)))) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { unitTargetOperators } = await import("@shared/schema");
      await db.delete(unitTargetOperators).where(eq(unitTargetOperators.id, String(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete target" });
    }
  });

  app.post("/api/unit-briefs/extract", requireAuth, marketingUpload.single("file"), async (req: any, res) => {
    let tmpPath: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const ext = path.extname(req.file.originalname).toLowerCase();
      tmpPath = path.join(MARKETING_FILES_DIR, `extract-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
      fs.writeFileSync(tmpPath, req.file.buffer);
      const { extractTextFromFile } = await import("./chatbgp");
      const text = await extractTextFromFile(tmpPath, req.file.originalname);
      if (!text || text.trim().length < 40) return res.status(400).json({ message: "Could not read any text from that file" });
      const { extractBriefFromText } = await import("./unit-brief-doc");
      const extracted = await extractBriefFromText(text);
      res.json(extracted);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to extract brief" });
    } finally {
      if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch {} }
    }
  });

  // Client-app brand theme — the caller's OWN company logo + colours (from
  // logo.dev), so a landlord client's app skins itself in their brand.
  // Client-allowed (under /api/client/); staff get their active client team's.
  app.get("/api/client/brand-theme", requireAuth, async (req: any, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      const scope = await resolveCompanyScope(req);
      if (!scope) return res.json({ scoped: false });
      const q = await pool.query(
        `SELECT name, logo_url, brand_primary_color, brand_secondary_color FROM crm_companies WHERE id = $1`,
        [scope]
      );
      const c = q.rows[0];
      if (!c) return res.json({ scoped: false });
      // Lazy fetch: if we have a key but no theme yet, populate it in the
      // background so the next load is branded (doesn't block this response).
      if (!c.logo_url || !c.brand_primary_color) {
        import("./logo-dev-brand").then(m => m.fetchBrandThemeForCompany(scope)).catch(() => {});
      }
      res.json({
        scoped: true,
        companyId: scope,
        name: c.name,
        logoUrl: c.logo_url || null,
        primaryColor: c.brand_primary_color || null,
        secondaryColor: c.brand_secondary_color || null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to load brand theme" });
    }
  });

  // ── Client CRM: add brands from the global directory ─────────────────
  // A client's CRM auto-shows the hospitality/F&B/leisure/fitness slice; these
  // let them pull ANY other brand from the global directory into their CRM
  // (stored on their own company's crm_extra_brand_ids).
  app.get("/api/client/crm/global-brands", requireAuth, async (req: any, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      const scope = await resolveCompanyScope(req);
      if (!scope) return res.status(403).json({ message: "Client accounts only" });
      const search = String(req.query.search || "").trim();
      if (search.length < 2) return res.json([]);
      // Search the whole tenant directory (any category) so the client can add
      // brands outside their auto slice; exclude what they already see.
      const { isClientCrmCategory } = await import("@shared/tenant-categories");
      const { getClientExtraBrandIds } = await import("./company-scope");
      const extra = await getClientExtraBrandIds(scope);
      const q = await pool.query(
        `SELECT id, name, company_type FROM crm_companies
          WHERE merged_into_id IS NULL AND company_type ILIKE 'Tenant -%'
            AND name ILIKE $1
          ORDER BY is_tracked_brand DESC NULLS LAST, name LIMIT 25`,
        [`%${search}%`]
      );
      res.json(q.rows.map((r: any) => ({
        id: r.id, name: r.name, companyType: r.company_type,
        inSlice: isClientCrmCategory(r.company_type),
        added: extra.has(r.id),
      })));
    } catch (err: any) { res.status(500).json({ message: err?.message || "Search failed" }); }
  });

  app.post("/api/client/crm/add-brand", requireAuth, async (req: any, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      const scope = await resolveCompanyScope(req);
      if (!scope) return res.status(403).json({ message: "Client accounts only" });
      const brandId = String(req.body?.brandId || "");
      if (!/^[0-9a-f-]{36}$/i.test(brandId)) return res.status(400).json({ message: "brandId required" });
      const chk = await pool.query(`SELECT company_type FROM crm_companies WHERE id = $1`, [brandId]);
      if (!chk.rows[0] || !/^tenant -/i.test(chk.rows[0].company_type || "")) {
        return res.status(400).json({ message: "Only tenant brands can be added" });
      }
      await pool.query(
        `UPDATE crm_companies
            SET crm_extra_brand_ids = (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(crm_extra_brand_ids, '{}') || $1::text)))
          WHERE id = $2`,
        [brandId, scope]
      );
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed to add brand" }); }
  });

  app.delete("/api/client/crm/add-brand/:brandId", requireAuth, async (req: any, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      const scope = await resolveCompanyScope(req);
      if (!scope) return res.status(403).json({ message: "Client accounts only" });
      await pool.query(
        `UPDATE crm_companies SET crm_extra_brand_ids = array_remove(crm_extra_brand_ids, $1) WHERE id = $2`,
        [String(req.params.brandId), scope]
      );
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed to remove brand" }); }
  });

  // Staff refresh of a company's brand theme from logo.dev (company page).
  app.post("/api/crm/companies/:id/fetch-brand-theme", requireAuth, async (req: any, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      if (await resolveCompanyScope(req)) return res.status(403).json({ message: "Staff only" });
      const { fetchBrandThemeForCompany, isLogoDevBrandConfigured } = await import("./logo-dev-brand");
      if (!isLogoDevBrandConfigured()) return res.status(503).json({ message: "logo.dev Brand API not configured (LOGO_DEV_SECRET_KEY)" });
      const theme = await fetchBrandThemeForCompany(String(req.params.id), { force: true });
      if (!theme) return res.status(404).json({ message: "No brand found — the company needs a domain, or logo.dev had no match." });
      res.json(theme);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch brand theme" });
    }
  });

  // AI-draft a targeting brief from scratch for a unit: gathers the unit,
  // its property, the categories already in the scheme, the client and the
  // firm's taxonomy, and asks Claude to propose the brief fields + a
  // suggested target-operator list. Returns the draft for review — nothing
  // is saved. Scope-checked so a client can only draft on their own units.
  app.post("/api/available-units/:id/brief/draft-ai", requireAuth, async (req: any, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const property = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
      let clientCompany: string | null = null;
      if ((property as any)?.landlordId) {
        const co = await storage.getCrmCompany((property as any).landlordId).catch(() => null);
        clientCompany = (co as any)?.name || null;
      }
      // Categories / operators already represented in the scheme — from the
      // tenancy schedule (occupied units carry a tenant/trading name).
      const tenantsQ = await pool.query(
        `SELECT DISTINCT COALESCE(trading_name, tenant_name) AS n
           FROM tenancy_schedule_units
          WHERE property_id = $1 AND COALESCE(trading_name, tenant_name) IS NOT NULL
          LIMIT 60`,
        [unit.propertyId]
      ).catch(() => ({ rows: [] as any[] }));
      const currentTenants = tenantsQ.rows.map((r: any) => String(r.n)).filter(Boolean);
      const { TENANT_CATEGORIES } = await import("@shared/tenant-categories");
      const taxonomy: string[] = [...TENANT_CATEGORIES];
      const { draftBriefFromContext } = await import("./unit-brief-doc");
      const draft = await draftBriefFromContext({
        unitName: (unit as any).unitName,
        floor: (unit as any).floor,
        sqft: (unit as any).sqft,
        askingRent: (unit as any).askingRent,
        propertyName: property?.name,
        address: (property as any)?.address,
        clientCompany,
        currentTenants,
        taxonomy,
      });
      res.json(draft);
    } catch (err: any) {
      if (/api ?key|authentication|not configured/i.test(err?.message || "")) {
        return res.status(503).json({ message: "AI drafting unavailable — AI service is not configured" });
      }
      res.status(500).json({ message: err?.message || "Failed to draft brief" });
    }
  });

  app.post("/api/unit-briefs/:id/generate-document", requireAuth, async (req: any, res) => {
    try {
      if (await assertUnitInClientScope(req, await briefPropertyId(String(req.params.id)))) {
        return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { generateBriefDocument } = await import("./unit-brief-doc");
      const result = await generateBriefDocument(String(req.params.id));
      res.json({ ...result, sharepoint: !!result.sharepointUrl });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to generate brief document" });
    }
  });

  // Focus the Letting Tracker on units actually in play. Three passes:
  //   1. PRUNE — tracker rows with no leasing activity at all (idle AVA
  //      imports: no viewings/offers/files/targets, stub-or-no deal, no
  //      strategy-board activity) are deleted. The tenancy row (the rent
  //      roll spine) is untouched — a pruned unit can be re-listed any
  //      time with the one-click on its tenancy row.
  //   2. PULL IN — strategy-board (leasing_schedule_units) rows showing
  //      activity (updates / optimum target / targets) whose tenancy row
  //      has no tracker listing get one created and linked.
  //   3. MIGRATE — strategy-board target_tenants (approved/converted)
  //      move onto the tracker's target-operator system so nothing typed
  //      on the boards is lost when they're retired.
  // dryRun (default true) reports what WOULD happen without touching data.
  app.post("/api/admin/letting-tracker-focus", requireAuth, requireAdmin, async (req, res) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      const { legacyToCode } = await import("@shared/deal-status");

      const units = (await pool.query(`
        SELECT au.id, au.unit_name, au.property_id, au.marketing_status, au.deal_id, au.tenancy_unit_id,
               p.name AS property_name,
               d.status AS deal_status, d.tenant_id AS deal_tenant_id, d.fee AS deal_fee,
               (SELECT COUNT(*) FROM unit_viewings v WHERE v.unit_id = au.id)::int AS viewings,
               (SELECT COUNT(*) FROM unit_offers o WHERE o.unit_id = au.id)::int AS offers,
               (SELECT COUNT(*) FROM unit_marketing_files f WHERE f.unit_id = au.id)::int AS files,
               (SELECT COUNT(*) FROM unit_target_operators t JOIN unit_briefs b ON b.id = t.brief_id WHERE b.unit_id = au.id)::int AS brief_targets,
               ls.id AS ls_id,
               (COALESCE(ls.updates, '') <> '' OR COALESCE(ls.optimum_target, '') <> '' OR COALESCE(ls.target_brands, '') <> '') AS ls_activity,
               (SELECT COUNT(*) FROM target_tenants tt WHERE tt.unit_id = ls.id AND tt.status IN ('approved','converted'))::int AS ls_targets
          FROM available_units au
          LEFT JOIN crm_properties p ON p.id = au.property_id
          LEFT JOIN crm_deals d ON d.id = au.deal_id
          LEFT JOIN leasing_schedule_units ls ON ls.tenancy_unit_id = au.tenancy_unit_id AND au.tenancy_unit_id IS NOT NULL
      `)).rows;

      const inPlay = (u: any): boolean => {
        const code = legacyToCode(u.marketing_status) || "AVA";
        if (code !== "AVA" && code !== "REP") return true;
        if (u.viewings > 0 || u.offers > 0 || u.files > 0 || u.brief_targets > 0) return true;
        const dealCode = u.deal_status ? (legacyToCode(u.deal_status) || "AVA") : "AVA";
        if (u.deal_id && (dealCode !== "AVA" || u.deal_tenant_id || u.deal_fee)) return true;
        if (u.ls_activity || u.ls_targets > 0) return true;
        return false;
      };

      const keep = units.filter(inPlay);
      const drop = units.filter((u: any) => !inPlay(u));

      // Strategy-board rows in play whose tenancy row has no tracker listing.
      const missing = (await pool.query(`
        SELECT ls.id AS ls_id, ls.tenancy_unit_id, ls.property_id, ls.unit_name,
               ts.unit_number, ts.premises, ts.nia_sqft, ts.gia_sqft, ts.marketing_rent_pa,
               p.name AS property_name
          FROM leasing_schedule_units ls
          JOIN tenancy_schedule_units ts ON ts.id = ls.tenancy_unit_id
          LEFT JOIN crm_properties p ON p.id = ls.property_id
         WHERE (COALESCE(ls.updates, '') <> '' OR COALESCE(ls.optimum_target, '') <> '' OR COALESCE(ls.target_brands, '') <> ''
                OR EXISTS (SELECT 1 FROM target_tenants tt WHERE tt.unit_id = ls.id AND tt.status IN ('approved','converted')))
           AND NOT EXISTS (SELECT 1 FROM available_units au WHERE au.tenancy_unit_id = ls.tenancy_unit_id)
      `)).rows;

      // Strategy-board targets to migrate onto tracker targets.
      const lsTargets = (await pool.query(`
        SELECT tt.id, tt.brand_name, tt.company_id, tt.status, tt.outcome, tt.rationale, ls.tenancy_unit_id, ls.property_id
          FROM target_tenants tt
          JOIN leasing_schedule_units ls ON ls.id = tt.unit_id
         WHERE tt.status IN ('approved','converted') AND ls.tenancy_unit_id IS NOT NULL
      `)).rows;

      const report: any = {
        dryRun,
        scanned: units.length,
        keep: keep.length,
        prune: drop.length,
        pullIn: missing.length,
        targetsToMigrate: lsTargets.length,
        pruneSample: drop.slice(0, 12).map((u: any) => `${u.property_name || "?"} — ${u.unit_name}`),
        pullInSample: missing.slice(0, 12).map((m: any) => `${m.property_name || "?"} — ${m.unit_name || m.unit_number || m.premises}`),
      };
      if (dryRun) return res.json(report);

      // 1. Prune idle rows (storage handles files/viewings/offers cleanup,
      //    clears the tenancy back-reference and removes still-AVA stub deals).
      let pruned = 0;
      for (const u of drop) {
        try {
          const unitRow = await storage.getAvailableUnit(u.id);
          await storage.deleteAvailableUnit(u.id);
          if (unitRow?.dealId) {
            const linkedDeal = await storage.getCrmDeal(unitRow.dealId);
            if (linkedDeal && (legacyToCode(linkedDeal.status) || "AVA") === "AVA" && !linkedDeal.tenantId && !linkedDeal.fee) {
              await storage.deleteCrmDeal(unitRow.dealId);
            }
          }
          pruned++;
        } catch (e: any) {
          console.warn(`[tracker-focus] prune failed for ${u.id}:`, e?.message);
        }
      }

      // 2. Create listings for in-play strategy rows missing from the tracker.
      let added = 0;
      for (const m of missing) {
        try {
          const ins = await pool.query(
            `INSERT INTO available_units (property_id, unit_name, sqft, asking_rent, marketing_status, tenancy_unit_id)
             VALUES ($1, $2, $3, $4, 'Available', $5) RETURNING id`,
            [m.property_id, m.unit_name || m.unit_number || m.premises || "Unit",
             m.nia_sqft ?? m.gia_sqft ?? null, m.marketing_rent_pa ?? null, m.tenancy_unit_id]
          );
          await pool.query(
            `UPDATE tenancy_schedule_units SET letting_tracker_unit_id = $1 WHERE id = $2`,
            [ins.rows[0].id, m.tenancy_unit_id]
          );
          added++;
        } catch (e: any) {
          console.warn(`[tracker-focus] pull-in failed for ls ${m.ls_id}:`, e?.message);
        }
      }

      // 3. Migrate strategy-board targets → tracker target operators
      //    (converted → Let, approved → Identified), deduped by name per unit.
      let migrated = 0;
      for (const t of lsTargets) {
        try {
          const au = await pool.query(
            `SELECT id, unit_name, property_id FROM available_units WHERE tenancy_unit_id = $1 LIMIT 1`,
            [t.tenancy_unit_id]
          );
          if (!au.rows[0]) continue;
          let brief = await pool.query(`SELECT id FROM unit_briefs WHERE unit_id = $1 LIMIT 1`, [au.rows[0].id]);
          if (!brief.rows[0]) {
            const prop = await storage.getCrmProperty(au.rows[0].property_id);
            brief = await pool.query(
              `INSERT INTO unit_briefs (unit_id, property_id, title, client_company_id, client_company)
               VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [au.rows[0].id, au.rows[0].property_id, `Operator Targeting — ${au.rows[0].unit_name}`,
               (prop as any)?.landlordId || null, null]
            );
          }
          const dupe = await pool.query(
            `SELECT 1 FROM unit_target_operators WHERE brief_id = $1 AND LOWER(operator_name) = LOWER($2) LIMIT 1`,
            [brief.rows[0].id, t.brand_name]
          );
          if (dupe.rows[0]) continue;
          await pool.query(
            `INSERT INTO unit_target_operators (brief_id, operator_name, company_id, rationale, status)
             VALUES ($1, $2, $3, $4, $5)`,
            [brief.rows[0].id, t.brand_name, t.company_id || null, t.rationale || null,
             (t.status === "converted" || t.outcome === "signed") ? "Let" : "Identified"]
          );
          migrated++;
        } catch (e: any) {
          console.warn(`[tracker-focus] target migrate failed for ${t.id}:`, e?.message);
        }
      }

      res.json({ ...report, dryRun: false, pruned, added, migrated });
    } catch (err: any) {
      console.error("[tracker-focus] failed:", err);
      res.status(500).json({ message: err?.message || "Tracker focus failed" });
    }
  });

  app.post("/api/available-units/migrate-letting-deals", requireAuth, async (req, res) => {
    try {
      // Firm-wide bulk migration — staff only, even though the parent
      // prefix is client-writable for tracker parity.
      {
        const { resolveCompanyScope } = await import("./company-scope");
        if (await resolveCompanyScope(req)) return res.status(403).json({ message: "Not available for client accounts" });
      }
      const { crmDeals, availableUnits } = await import("@shared/schema");
      // Match both canonical and legacy strings — migration may not yet have run
      const NEGOTIATION_STATUSES = ["NEG", "Under Negotiation", "HOTs"];
      const negDeals = await db.select().from(crmDeals)
        .where(inArray(crmDeals.status, NEGOTIATION_STATUSES));

      if (negDeals.length === 0) {
        return res.json({ migrated: 0, message: "No negotiation deals to migrate" });
      }

      const existingUnits = await db.select().from(availableUnits);
      const existingDealIds = new Set(existingUnits.filter(u => u.dealId).map(u => u.dealId));

      let migrated = 0;
      const skipped: string[] = [];
      for (const deal of negDeals) {
        if (existingDealIds.has(deal.id)) {
          skipped.push(deal.name);
          continue;
        }

        let propertyName = deal.name;
        let assetClass: string | null = deal.assetClass || null;
        if (deal.propertyId) {
          const prop = await storage.getCrmProperty(deal.propertyId);
          if (prop) {
            propertyName = prop.name;
            assetClass = assetClass || prop.assetClass || null;
          }
        }

        await storage.createAvailableUnit({
          propertyId: deal.propertyId || "",
          unitName: deal.name || propertyName,
          floor: null,
          sqft: deal.totalAreaSqft || null,
          askingRent: deal.rentPa || null,
          ratesPa: null,
          serviceChargePa: null,
          useClass: assetClass,
          condition: null,
          availableDate: null,
          marketingStatus: "Available",
          epcRating: null,
          notes: deal.comments || null,
          restrictions: null,
          fee: deal.fee || null,
          dealId: deal.id,
          agentUserIds: deal.internalAgent || null,
          viewingsCount: 0,
          lastViewingDate: null,
          marketingStartDate: null,
        });
        migrated++;
      }

      res.json({ migrated, skipped: skipped.length, message: `Migrated ${migrated} deals to available units` });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Migration failed" });
    }
  });

  // One-off backfill: create a leasing_schedule_units row for every existing
  // available_units that doesn't already have one on the same property. Safe
  // to re-run — only creates rows where none exists (matched by
  // property_id + unit_name). Returns the count created.
  // Compliance audit — recorded when someone overrides the AML / fee-agreement
  // gate when promoting a deal to SOL. PLA side calls this directly; Letting
  // Tracker side writes inline from the promote endpoint above.
  app.post("/api/deal-compliance-audit", requireAuth, async (req: any, res) => {
    const { dealId, missingFields, targetStatus } = req.body || {};
    if (!dealId || !Array.isArray(missingFields)) {
      return res.status(400).json({ error: "dealId and missingFields[] required" });
    }
    try {
      const userId = req.user?.id ?? null;
      await pool.query(
        `INSERT INTO deal_compliance_audit (deal_id, user_id, missing_fields, target_status)
         VALUES ($1, $2, $3, $4)`,
        [dealId, userId, missingFields, targetStatus || null]
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Debug / test-data tool: rename every property's units to "Unit 1", "Unit 2"...
  // sequentially. Useful for verifying the unit name shows up consistently across
  // tracker / deal / property views. Cascades to available_units +
  // leasing_schedule_units which carry their own copy of the name.
  // Entity images — one set of endpoints serving property / unit / deal. Bytes
  // live in file_blobs; metadata in uploaded_files (kind='entity_image') so the
  // existing file-serving route can stream them via /api/hr/files/:id/file.
  const entityImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("PNG, JPEG, WebP or GIF only"));
    },
  });

  app.get("/api/entity-images", requireAuth, async (req: any, res) => {
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) return res.status(400).json({ error: "entityType and entityId required" });
    try {
      const { rows } = await pool.query(
        `SELECT ei.id, ei.entity_type, ei.entity_id, ei.file_id, ei.image_studio_id, ei.kind, ei.title, ei.notes,
                ei.created_at, ei.created_by_user_id, u.name AS created_by_name,
                f.mime_type
         FROM entity_images ei
         LEFT JOIN users u ON u.id = ei.created_by_user_id
         LEFT JOIN uploaded_files f ON f.id = ei.file_id
         WHERE ei.entity_type = $1 AND ei.entity_id = $2
         ORDER BY ei.created_at DESC`,
        [entityType, entityId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/entity-images", requireAuth, entityImageUpload.single("file"), async (req: any, res) => {
    const { entityType, entityId, kind, title, notes } = req.body;
    if (!entityType || !entityId) return res.status(400).json({ error: "entityType and entityId required" });
    if (!req.file) return res.status(400).json({ error: "file required (multipart 'file')" });
    try {
      const userId = req.user?.id ?? null;
      const fileMeta = await pool.query(
        `INSERT INTO uploaded_files (owner_user_id, uploaded_by_user_id, kind, name, mime_type, size_bytes, visibility)
         VALUES ($1, $1, 'entity_image', $2, $3, $4, 'team') RETURNING id`,
        [userId, req.file.originalname, req.file.mimetype, req.file.size]
      );
      const fileId = fileMeta.rows[0].id;
      await pool.query("INSERT INTO file_blobs (file_id, data) VALUES ($1, $2)", [fileId, req.file.buffer]);

      // When the image is attached to a property, also store it in Image
      // Studio's library + property_imagery_assets so it appears in Image
      // Studio search, the Property Pathway imagery picker, and the
      // Property Intelligence imagery tab — not just the sidebar.
      let imageStudioId: string | null = null;
      if (entityType === "property") {
        try {
          const { storeImageFromBuffer } = await import("./image-studio");
          const stored = await storeImageFromBuffer({
            buffer: req.file.buffer,
            fileName: req.file.originalname,
            category: "Property",
            tags: ["uploaded", "property"],
            description: title || `Uploaded for property`,
            source: "uploaded",
            propertyId: entityId,
            mimeType: req.file.mimetype,
          });
          imageStudioId = stored.id;
          await pool.query(
            `INSERT INTO property_imagery_assets (property_id, kind, source, image_studio_id, caption, generated_by)
             VALUES ($1, 'secondary_external', 'uploaded', $2, $3, $4)`,
            [entityId, stored.id, title || null, userId]
          ).catch(() => {});
        } catch (syncErr: any) {
          console.warn("[entity-images POST] Image Studio sync failed:", syncErr?.message);
        }
      }

      const ins = await pool.query(
        `INSERT INTO entity_images (entity_type, entity_id, file_id, image_studio_id, kind, title, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [entityType, entityId, fileId, imageStudioId, kind || null, title || null, notes || null, userId]
      );
      res.json({ id: ins.rows[0].id, fileId, imageStudioId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Public-ish read for entity images — any signed-in BGP user. Mirrors the
  // /api/hr/photo route's reasoning (these aren't sensitive personal data).
  app.get("/api/entity-images/:id/file", requireAuth, async (req, res) => {
    try {
      const meta = await pool.query(
        `SELECT f.id, f.mime_type FROM entity_images ei
         JOIN uploaded_files f ON f.id = ei.file_id
         WHERE ei.id = $1`,
        [req.params.id]
      );
      if (!meta.rows[0]) return res.status(404).end();
      const blob = await pool.query("SELECT data FROM file_blobs WHERE file_id = $1", [meta.rows[0].id]);
      if (!blob.rows[0]) return res.status(404).end();
      res.setHeader("Content-Type", meta.rows[0].mime_type || "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(blob.rows[0].data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.delete("/api/entity-images/:id", requireAuth, async (req: any, res) => {
    try {
      const meta = await pool.query("SELECT file_id FROM entity_images WHERE id = $1", [req.params.id]);
      if (!meta.rows[0]) return res.status(404).end();
      await pool.query("DELETE FROM entity_images WHERE id = $1", [req.params.id]);
      await pool.query("DELETE FROM file_blobs WHERE file_id = $1", [meta.rows[0].file_id]);
      await pool.query("DELETE FROM uploaded_files WHERE id = $1", [meta.rows[0].file_id]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Revert an entity image's last AI edit. Calls Image Studio's revert to
  // restore the undo snapshot, then resyncs the file_blob bytes so the
  // sidebar thumbnail reflects the reverted image.
  app.post("/api/entity-images/:id/revert", requireAuth, async (req: any, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT image_studio_id, file_id FROM entity_images WHERE id = $1`,
        [req.params.id]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Image not found" });
      if (!row.image_studio_id) return res.status(400).json({ error: "Revert only available for AI-edited images." });

      const revertRes = await fetch(`${req.protocol}://${req.get("host")}/api/image-studio/${row.image_studio_id}/revert`, {
        method: "POST",
        headers: { cookie: req.headers.cookie || "" },
      });
      if (!revertRes.ok) {
        const err = await revertRes.json().catch(() => ({}));
        return res.status(revertRes.status).json(err);
      }
      const fullRes = await fetch(`${req.protocol}://${req.get("host")}/api/image-studio/${row.image_studio_id}/full`, {
        headers: { cookie: req.headers.cookie || "" },
      });
      if (fullRes.ok) {
        const buf = Buffer.from(await fullRes.arrayBuffer());
        await pool.query("UPDATE file_blobs SET data = $1 WHERE file_id = $2", [buf, row.file_id]);
        await pool.query(
          `UPDATE uploaded_files SET mime_type = 'image/png', size_bytes = $1 WHERE id = $2`,
          [buf.length, row.file_id]
        );
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Revert failed" });
    }
  });

  // Also loosen the Image Studio revert gate (was admin-only)
  // see server/image-studio.ts

  // AI-edit an entity image. Routes through Image Studio's ai-edit (in-place
  // on the imageStudio image) and then refreshes the file_blob bytes so the
  // entity image thumbnails pick up the new version automatically.
  app.post("/api/entity-images/:id/ai-edit", requireAuth, async (req: any, res) => {
    const { editPrompt } = req.body || {};
    if (!editPrompt?.trim()) return res.status(400).json({ error: "editPrompt required" });
    try {
      const { rows } = await pool.query(
        `SELECT ei.id, ei.image_studio_id, ei.file_id FROM entity_images ei WHERE ei.id = $1`,
        [req.params.id]
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Image not found" });
      if (!row.image_studio_id) return res.status(400).json({ error: "AI edit only available for images captured via Street View / Image Studio. Drag-and-drop uploads don't carry the source link yet." });

      // Forward to ai-edit — it'll fetch the source bytes from localPath, run
      // Gemini, write the result back to the same imageStudio image record.
      const editRes = await fetch(`${req.protocol}://${req.get("host")}/api/image-studio/ai-edit`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: req.headers.cookie || "" },
        body: JSON.stringify({ imageId: row.image_studio_id, editPrompt }),
      });
      if (!editRes.ok) {
        const err = await editRes.json().catch(() => ({}));
        return res.status(editRes.status).json(err);
      }

      // Pull the now-edited bytes from /api/image-studio/:id/full and refresh
      // the file_blob so the sidebar thumbnail re-renders with the new view.
      const fullRes = await fetch(`${req.protocol}://${req.get("host")}/api/image-studio/${row.image_studio_id}/full`, {
        headers: { cookie: req.headers.cookie || "" },
      });
      if (fullRes.ok) {
        const buf = Buffer.from(await fullRes.arrayBuffer());
        await pool.query("UPDATE file_blobs SET data = $1 WHERE file_id = $2", [buf, row.file_id]);
        await pool.query(
          `UPDATE uploaded_files SET mime_type = 'image/png', size_bytes = $1 WHERE id = $2`,
          [buf.length, row.file_id]
        );
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "AI edit failed" });
    }
  });

  // List users by team — used by the "Split London Leasing" admin tool.
  app.get("/api/admin/users-by-team", requireAuth, requireAdmin, async (req: any, res) => {
    const team = (req.query.team as string) || "";
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.email, u.team, u.profile_pic_url, sp.title
         FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         WHERE u.is_active = true AND (
           CASE WHEN $1 = '' OR $1 = '__unassigned__' THEN (u.team IS NULL OR u.team = '')
                ELSE u.team = $1 END
         )
         ORDER BY u.name`,
        [team]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Bulk reassign — body: { assignments: [{ userId, team }] }
  app.post("/api/admin/users-bulk-reassign-team", requireAuth, requireAdmin, async (req: any, res) => {
    const { assignments } = req.body || {};
    if (!Array.isArray(assignments)) return res.status(400).json({ error: "assignments[] required" });
    try {
      let updated = 0;
      for (const a of assignments) {
        if (!a?.userId) continue;
        await pool.query("UPDATE users SET team = $1 WHERE id = $2", [a.team || null, a.userId]);
        updated++;
      }
      res.json({ ok: true, updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // One-shot tidy applied via a Settings button — May 2026 team reorg.
  // Splits London Leasing into London Retail + London F&B, parks the 4
  // unassigned users on Office / Corporate, renames the Accounts mailbox
  // user to its actual person (Wendy), and marks Daisy + Emily Mitchell as
  // Contract type so HR views skip them. Safe to re-run — uses name lookups
  // so it does nothing on rows that already match.
  app.post("/api/admin/apply-may-2026-team-tidy", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const remap: Array<{ names: string[]; team: string }> = [
        { team: "London Retail",      names: ["Charlotte Roberts", "Lizzie Knights", "Lucy Cope", "Emily Cann"] },
        { team: "London F&B",         names: ["Rupert Bentley-Smith", "Will Penfold", "Evie North"] },
        { team: "Office / Corporate", names: ["Wendy McKenzie", "Accounts", "Johnny", "Daisy Driscoll", "Emily Mitchell"] },
      ];
      let teamUpdates = 0;
      for (const r of remap) {
        const result = await pool.query(
          "UPDATE users SET team = $1 WHERE is_active = true AND name = ANY($2)",
          [r.team, r.names]
        );
        teamUpdates += result.rowCount ?? 0;
      }

      // Rename the shared mailbox alias to its actual person name.
      await pool.query(
        "UPDATE users SET name = 'Wendy McKenzie' WHERE is_active = true AND name = 'Accounts'"
      );

      // Mark consultants — HR sections (salary, holiday, pension) hide for
      // anyone tagged Contract type via the client-side gate.
      const consultants = ["Daisy Driscoll", "Emily Mitchell"];
      const contractResult = await pool.query(
        `UPDATE staff_profiles SET employment_type = 'Contract'
         WHERE user_id IN (SELECT id FROM users WHERE name = ANY($1))`,
        [consultants]
      );

      res.json({
        ok: true,
        teamUpdates,
        contractUpdates: contractResult.rowCount ?? 0,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Move everyone currently on fromTeam → toTeam in one go. Empty/null fromTeam
  // means "currently unassigned". Used for tidy-ups like splitting / merging
  // teams without per-user clicking.
  app.post("/api/admin/team-bulk-remap", requireAuth, requireAdmin, async (req: any, res) => {
    const { fromTeam, toTeam } = req.body || {};
    if (toTeam === undefined) return res.status(400).json({ error: "toTeam required" });
    try {
      let result;
      if (!fromTeam || fromTeam === "__unassigned__") {
        result = await pool.query(
          "UPDATE users SET team = $1 WHERE is_active = true AND (team IS NULL OR team = '')",
          [toTeam || null]
        );
      } else {
        result = await pool.query(
          "UPDATE users SET team = $1 WHERE is_active = true AND team = $2",
          [toTeam || null, fromTeam]
        );
      }
      res.json({ ok: true, updated: result.rowCount ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/number-test-units", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const props = await pool.query(`SELECT DISTINCT property_id FROM property_units WHERE property_id IS NOT NULL`);
      let renamed = 0;
      for (const p of props.rows) {
        const units = await pool.query(
          `SELECT id, unit_name FROM property_units WHERE property_id = $1 ORDER BY created_at ASC, id ASC`,
          [p.property_id]
        );
        for (let i = 0; i < units.rows.length; i++) {
          const newName = `Unit ${i + 1}`;
          const oldName = units.rows[i].unit_name;
          const unitId = units.rows[i].id;
          if (oldName === newName) continue;
          await pool.query(`UPDATE property_units SET unit_name = $1 WHERE id = $2`, [newName, unitId]);
          await pool.query(`UPDATE available_units SET unit_name = $1 WHERE unit_id = $2`, [newName, unitId]);
          await pool.query(
            `UPDATE leasing_schedule_units SET unit_name = $1
             WHERE property_id = $2 AND lower(trim(coalesce(unit_name, ''))) = lower(trim(coalesce($3, '')))`,
            [newName, p.property_id, oldName]
          );
          renamed++;
        }
      }
      res.json({ renamed });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Rename failed" });
    }
  });

  app.post("/api/available-units/backfill-leasing-schedule", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `WITH inserted AS (
           INSERT INTO leasing_schedule_units (property_id, unit_name, sqft, rent_pa, status)
           SELECT au.property_id, au.unit_name, au.sqft, au.asking_rent, COALESCE(au.marketing_status, 'AVA')
           FROM available_units au
           WHERE NOT EXISTS (
             SELECT 1 FROM leasing_schedule_units ls
             WHERE ls.property_id = au.property_id
               AND lower(trim(coalesce(ls.unit_name, ''))) = lower(trim(coalesce(au.unit_name, '')))
           )
           RETURNING id
         )
         SELECT COUNT(*)::int AS created FROM inserted`
      );
      res.json({ created: rows[0]?.created ?? 0 });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Backfill failed" });
    }
  });

  app.post("/api/available-units/:id/link-deal", requireAuth, async (req, res) => {
    try {
      const { dealId } = req.body;
      if (!dealId) return res.status(400).json({ message: "dealId is required" });
      const existing = await storage.getAvailableUnit(req.params.id as string);
      if (!existing) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, existing.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const deal = await storage.getCrmDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const unit = await storage.updateAvailableUnit(req.params.id as string, { dealId });
      res.json(unit);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to link deal" });
    }
  });

  app.post("/api/available-units/:id/create-deal", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const property = await storage.getCrmProperty(unit.propertyId);
      const body = req.body || {};
      // Clients never set or see BGP's fee — same rule as the deals API.
      {
        const { resolveCompanyScope } = await import("./company-scope");
        if (await resolveCompanyScope(req)) {
          delete body.fee;
          delete body.feePercentage;
          delete body.feeAgreement;
          delete body.feeAgreementUrl;
        }
      }

      // Build the field set from the form. Used to either UPDATE an existing
      // linked deal (the common case now that Add Unit auto-creates a deal)
      // or CREATE a new one (only when the unit was somehow orphaned).
      //
      // Contracting entities: tenantId comes from the WIP form's
      // EntityCombobox; landlordId is auto-resolved from the property
      // (crm_properties.landlord_id) since the landlord is implicit at
      // SOL on a letting deal. Xero billing entities (tenant + landlord)
      // are also captured for the invoicing chain.
      // Promote merges into the existing deal — don't clobber multi-agent
      // / multi-team rosters with whatever the dialog's single-picker
      // shows. Layla picks a "lead agent" on the dialog; if the deal
      // already had Charlotte on it too, Charlotte stays. Same for team.
      const existingDeal = unit.dealId ? await storage.getCrmDeal(unit.dealId) : null;
      const existingAgents: string[] = Array.isArray((existingDeal as any)?.internalAgent)
        ? ((existingDeal as any).internalAgent as string[])
        : ((existingDeal as any)?.internalAgent ? [(existingDeal as any).internalAgent as string] : []);
      const mergedAgents = body.agent && !existingAgents.includes(body.agent)
        ? [body.agent, ...existingAgents]
        : (body.agent ? existingAgents : existingAgents);
      const bodyTeams: string[] = Array.isArray(body.team) ? body.team : (body.team ? [body.team] : []);
      const existingTeams: string[] = Array.isArray((existingDeal as any)?.team)
        ? ((existingDeal as any).team as string[])
        : ((existingDeal as any)?.team ? [(existingDeal as any).team as string] : []);
      const mergedTeams = bodyTeams.length === 0
        ? existingTeams
        : Array.from(new Set([...bodyTeams, ...existingTeams]));

      // Resolve the landlord defensively: prefer an explicit body value
      // ONLY if it points at a real company; otherwise fall back to the
      // property's current landlord. Stops a stale/orphaned landlord_id
      // (a deleted or merged company) being stamped onto the deal, which
      // would make it show as "Unknown" client on the WIP roll-up.
      let resolvedLandlordId: string | undefined = (property as any)?.landlordId || undefined;
      if (body.landlordId) {
        const lc = await pool.query(`SELECT 1 FROM crm_companies WHERE id = $1 LIMIT 1`, [body.landlordId]);
        if ((lc.rowCount ?? 0) > 0) resolvedLandlordId = body.landlordId;
      }

      const dealFields: Record<string, any> = {
        propertyId: unit.propertyId,
        unitId: unit.unitId || undefined,
        status: "SOL",
        dealType: body.dealType || "New Letting",
        team: mergedTeams,
        internalAgent: mergedAgents,
        fee: body.fee ? parseFloat(body.fee) : (unit.fee || undefined),
        feePercentage: body.feePercentage != null && body.feePercentage !== ""
          ? parseFloat(String(body.feePercentage))
          : undefined,
        feeAgreement: body.feeAgreement || undefined,
        rentPa: body.askingRent ? parseFloat(body.askingRent) : (unit.askingRent || undefined),
        totalAreaSqft: body.totalAreaSqft ? parseFloat(body.totalAreaSqft) : (unit.sqft || undefined),
        leaseLength: body.leaseLength ? parseFloat(body.leaseLength) : undefined,
        rentFree: body.rentFree ? parseFloat(body.rentFree) : undefined,
        // targetDate is mandatory on the dialog now — persist so the
        // WIP report can bucket the freshly-flipped deal by month.
        targetDate: body.targetDate || undefined,
        comments: body.comments || undefined,
        amlCheckCompleted: body.amlChecked || undefined,
        tenantId: body.tenantId || undefined,
        tenantEntityId: body.tenantEntityId || undefined,
        tenantEntityName: body.tenantEntityName || undefined,
        // Landlord auto-resolved + validated above (resolvedLandlordId):
        // explicit body value wins only if it resolves to a real company,
        // else the property's current landlord.
        landlordId: resolvedLandlordId,
        landlordEntityId: body.landlordEntityId || undefined,
        landlordEntityName: body.landlordEntityName || undefined,
      };

      let deal;
      if (unit.dealId) {
        // Promote: existing deal gets the SOL-handover fields applied and
        // status flipped. Don't change the deal name (it might have been
        // edited).
        deal = await storage.updateCrmDeal(unit.dealId, dealFields as any);
      } else {
        // Orphan unit (no auto-create ran) — fresh deal.
        deal = await storage.createCrmDeal({
          name: `${property?.name || "Property"} - ${unit.unitName}`,
          groupName: "Leasing - Active",
          ...dealFields,
        } as any);
      }

      await storage.updateAvailableUnit(req.params.id as string, {
        dealId: deal?.id ?? unit.dealId,
        marketingStatus: "SOL",
      });

      // Fire AML on every counterparty now that the deal carries real
      // company links rather than a tenant-name string. Auto-launched
      // chain mirrors the deal-stages SOL transition path so an
      // AVA→SOL via Letting Tracker behaves the same as a direct
      // kanban drag-to-SOL.
      if (deal?.id) {
        try {
          const { autoLaunchAmlForDeal } = await import("./deal-stages");
          await autoLaunchAmlForDeal(
            deal.id,
            (req as any).user?.id || null,
            (req as any).user?.name || null,
          );
        } catch (e: any) {
          console.warn("[promote-unit] AML auto-launch failed:", e?.message);
        }
      }

      // If user ticked "Promote anyway" to bypass missing AML / fee-agreement,
      // log it so a future compliance report can chase the gaps before exchange.
      if (deal && body.overrideCompliance) {
        const missing: string[] = [];
        if (body.feeAgreement !== "YES") missing.push("fee_agreement_signed");
        if (body.amlChecked !== "YES" && body.amlChecked !== "N-A") missing.push("aml_kyc_checked");
        if (missing.length > 0) {
          try {
            const userId = (req as any).user?.id ?? null;
            await pool.query(
              `INSERT INTO deal_compliance_audit (deal_id, user_id, missing_fields, target_status)
               VALUES ($1, $2, $3, $4)`,
              [deal.id, userId, missing, "SOL"]
            );
          } catch (e: any) {
            console.warn("[promote] compliance audit log failed:", e.message);
          }
        }
      }

      // AML warn-but-allow: run the same KYC counterparty check that
      // PUT /api/crm/deals/:id enforces as a hard block. We don't reject
      // here because the promotion is the moment of capture (Layla has
      // just filled in the tenant + landlord on the WIP modal) — but we
      // do attach the warning to the response so the UI can flag any
      // counterparty that's still missing KYC, and log it server-side.
      let amlWarning: { hasCounterparties: boolean; notReady: any[]; message: string | null } | null = null;
      if (deal) {
        try {
          const { checkCounterpartyAml, formatAmlWarning } = await import("./deal-gates");
          const result = await checkCounterpartyAml({
            landlordId: (deal as any).landlordId,
            tenantId: (deal as any).tenantId,
            vendorId: (deal as any).vendorId,
            purchaserId: (deal as any).purchaserId,
          });
          const msg = formatAmlWarning(result);
          if (msg) {
            amlWarning = { hasCounterparties: result.hasCounterparties, notReady: result.notReady, message: msg };
            console.warn(`[promote-unit] AML warning for deal ${deal.id}: ${msg}`);
          }
        } catch (e: any) {
          console.warn(`[promote-unit] AML pre-check failed:`, e?.message);
        }
      }

      res.json({ deal, unit: { ...unit, dealId: deal?.id ?? unit.dealId, marketingStatus: "SOL" }, amlWarning });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to promote unit" });
    }
  });

  // ─── Heads of Terms ────────────────────────────────────────────────
  // Each property holds a standard HOTs template; each tracker unit holds
  // its negotiated instance. Populate copies the template with the deal /
  // unit specifics filled in; PDF renders the instance for solicitors.
  app.get("/api/available-units/:id/hots", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const u = await pool.query(`SELECT hots_content, hots_updated_at FROM available_units WHERE id = $1`, [req.params.id]);
      const t = unit.propertyId
        ? await pool.query(`SELECT hots_template FROM crm_properties WHERE id = $1`, [unit.propertyId])
        : { rows: [] as any[] };
      res.json({
        content: u.rows[0]?.hots_content || null,
        updatedAt: u.rows[0]?.hots_updated_at || null,
        template: t.rows[0]?.hots_template || null,
      });
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
  });

  app.put("/api/available-units/:id/hots", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const content = typeof req.body?.content === "string" ? req.body.content : null;
      await pool.query(`UPDATE available_units SET hots_content = $1, hots_updated_at = NOW() WHERE id = $2`, [content, req.params.id]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
  });

  // Standard template lives on the property. Staff-only to edit (the
  // template is BGP's standard form); clients read it via the unit GET.
  app.put("/api/properties/:id/hots-template", requireAuth, async (req: any, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      if (await resolveCompanyScope(req)) return res.status(403).json({ message: "Staff only" });
      const template = typeof req.body?.template === "string" ? req.body.template : null;
      await pool.query(`UPDATE crm_properties SET hots_template = $1 WHERE id = $2`, [template, req.params.id]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
  });

  // Populate: template + unit/deal specifics → the unit's HOTs draft.
  app.post("/api/available-units/:id/hots/populate", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const prop = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
      const t = unit.propertyId
        ? await pool.query(`SELECT hots_template FROM crm_properties WHERE id = $1`, [unit.propertyId])
        : { rows: [] as any[] };
      const template: string = t.rows[0]?.hots_template ||
        `HEADS OF TERMS — SUBJECT TO CONTRACT

Property: {PROPERTY}
Unit: {UNIT}
Landlord: {LANDLORD}
Tenant: {TENANT}

Rent: {RENT} per annum exclusive
Lease length: [term] years
Rent free: [months] months
Break option: [details]
Rent reviews: [pattern]
Service charge: {SERVICE_CHARGE}
Rates payable: {RATES}
Use: [permitted use]
Repairing obligation: [FRI / IRI]
Conditions: [board approval / planning / licences]

Each party to bear its own legal costs.
These terms are indicative only and do not constitute a binding agreement.`;
      const deal = (unit as any).dealId ? await storage.getCrmDeal((unit as any).dealId).catch(() => null) : null;
      const landlordQ = (prop as any)?.landlordId
        ? await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [(prop as any).landlordId])
        : { rows: [] as any[] };
      const fmtGBP = (v: any) => (v != null && v !== "" && !isNaN(Number(v))) ? `£${Number(v).toLocaleString("en-GB")}` : "[amount]";
      const filled = template
        .replace(/\{PROPERTY\}/g, prop?.name || "[property]")
        .replace(/\{UNIT\}/g, (unit as any).unitName || "[unit]")
        .replace(/\{LANDLORD\}/g, landlordQ.rows[0]?.name || (deal as any)?.landlord || "[landlord]")
        .replace(/\{TENANT\}/g, (deal as any)?.name?.split("—")[0]?.trim() || "[tenant]")
        .replace(/\{RENT\}/g, fmtGBP((unit as any).askingRent))
        .replace(/\{SERVICE_CHARGE\}/g, fmtGBP((unit as any).serviceChargePa))
        .replace(/\{RATES\}/g, fmtGBP((unit as any).ratesPa))
        .replace(/\{AREA\}/g, (unit as any).totalAreaSqft ? `${Number((unit as any).totalAreaSqft).toLocaleString("en-GB")} sq ft` : "[area]");
      await pool.query(`UPDATE available_units SET hots_content = $1, hots_updated_at = NOW() WHERE id = $2`, [filled, req.params.id]);
      res.json({ content: filled });
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
  });

  // PDF for solicitors — pdfkit render of the negotiated text.
  app.get("/api/available-units/:id/hots/pdf", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const u = await pool.query(`SELECT hots_content FROM available_units WHERE id = $1`, [req.params.id]);
      const content: string = u.rows[0]?.hots_content;
      if (!content) return res.status(404).json({ message: "No HOTs on this unit yet" });
      const prop = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 56, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="HOTs - ${(prop?.name || "Property").replace(/[^a-zA-Z0-9 ]/g, "")} - ${((unit as any).unitName || "Unit").replace(/[^a-zA-Z0-9 ]/g, "")}.pdf"`);
      doc.pipe(res);
      doc.fontSize(9).fillColor("#666").text("SUBJECT TO CONTRACT — WITHOUT PREJUDICE", { align: "right" });
      doc.moveDown(0.5);
      doc.fontSize(16).fillColor("#000").text("Heads of Terms", { align: "left" });
      doc.fontSize(10).fillColor("#444").text(`${prop?.name || ""}${(unit as any).unitName ? ` — ${(unit as any).unitName}` : ""}`);
      doc.moveDown();
      doc.fontSize(10).fillColor("#000").text(content, { lineGap: 3 });
      doc.moveDown(2);
      doc.fontSize(8).fillColor("#888").text(`Prepared by Bruce Gillingham Pollard — ${new Date().toLocaleDateString("en-GB")}`);
      doc.end();
    } catch (err: any) { res.status(500).json({ message: err?.message || "Failed" }); }
  });

  app.get("/api/available-units/:id/files", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id as string);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const { unitMarketingFiles } = await import("@shared/schema");
      const files = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.unitId, req.params.id as string)).orderBy(unitMarketingFiles.createdAt);
      res.json(files);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch files" });
    }
  });

  app.post("/api/available-units/:id/files", requireAuth, marketingUpload.single("file"), async (req: any, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      if (await assertUnitInClientScope(req, unit.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const ext = path.extname(req.file.originalname).toLowerCase();
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      await saveFile(`marketing-files/${uniqueName}`, req.file.buffer, req.file.mimetype, req.file.originalname);
      const { unitMarketingFiles } = await import("@shared/schema");
      const [file] = await db.insert(unitMarketingFiles).values({
        unitId: req.params.id,
        fileName: req.file.originalname,
        filePath: `/uploads/marketing-files/${uniqueName}`,
        fileType: "upload",
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      }).returning();
      // Photos uploaded against a tracker unit also land in the Image
      // Gallery, filed under the property (and tagged with the unit) so
      // they show organised on the property page / Image Studio.
      if ((req.file.mimetype || "").startsWith("image/")) {
        try {
          const prop = unit.propertyId ? await storage.getCrmProperty(unit.propertyId) : null;
          const { storeImageFromBuffer } = await import("./image-studio");
          await storeImageFromBuffer({
            buffer: req.file.buffer,
            fileName: req.file.originalname,
            category: "Properties",
            tags: ["letting-tracker", ...(unit.unitName ? [unit.unitName] : []), ...(prop?.name ? [prop.name] : [])],
            description: `Uploaded on the Letting Tracker${unit.unitName ? ` — ${unit.unitName}` : ""}${prop?.name ? ` at ${prop.name}` : ""}`,
            source: "letting-tracker",
            propertyId: unit.propertyId || null,
            companyId: (prop as any)?.landlordId || null,
            address: (prop as any)?.address || undefined,
            mimeType: req.file.mimetype,
          });
        } catch (e: any) {
          console.warn("[unit-files] gallery mirror failed:", e?.message);
        }
      }
      res.json(file);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to upload file" });
    }
  });

  app.delete("/api/available-units/files/:fileId", requireAuth, async (req, res) => {
    try {
      const { unitMarketingFiles } = await import("@shared/schema");
      const [file] = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.id, req.params.fileId as string));
      if (!file) return res.status(404).json({ message: "File not found" });
      {
        const fileUnit = await storage.getAvailableUnit(file.unitId);
        if (await assertUnitInClientScope(req, fileUnit?.propertyId)) {
          return res.status(403).json({ message: "Unit is outside your portfolio" });
        }
      }
      const fileName = file.filePath.split("/").pop();
      if (fileName) {
        const { deleteFile } = await import("./file-storage");
        await deleteFile(`marketing-files/${fileName}`);
      }
      const fullPath = path.join(process.cwd(), file.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await db.delete(unitMarketingFiles).where(eq(unitMarketingFiles.id, req.params.fileId as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete file" });
    }
  });

  // --- Unit Viewings ---
  app.get("/api/available-units/:id/viewings", requireAuth, async (req, res) => {
    try {
      const vUnit = await storage.getAvailableUnit(req.params.id as string);
      if (await assertUnitInClientScope(req, vUnit?.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const { unitViewings } = await import("@shared/schema");
      const rows = await db.select().from(unitViewings).where(eq(unitViewings.unitId, req.params.id as string)).orderBy(unitViewings.viewingDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch viewings" });
    }
  });

  app.post("/api/available-units/:id/viewings", requireAuth, async (req, res) => {
    try {
      const vUnit = await storage.getAvailableUnit(req.params.id as string);
      if (await assertUnitInClientScope(req, vUnit?.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const { unitViewings, insertUnitViewingSchema } = await import("@shared/schema");
      const parsed = insertUnitViewingSchema.safeParse({ ...req.body, unitId: req.params.id });
      if (!parsed.success) return res.status(400).json({ message: fromError(parsed.error).toString() });
      const [row] = await db.insert(unitViewings).values(parsed.data).returning();
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to add viewing" });
    }
  });

  app.delete("/api/available-units/viewings/:viewingId", requireAuth, async (req, res) => {
    try {
      const { unitViewings } = await import("@shared/schema");
      const [viewing] = await db.select().from(unitViewings).where(eq(unitViewings.id, req.params.viewingId as string));
      if (viewing) {
        const vUnit = await storage.getAvailableUnit(viewing.unitId);
        if (await assertUnitInClientScope(req, vUnit?.propertyId)) {
          return res.status(403).json({ message: "Unit is outside your portfolio" });
        }
      }
      await db.delete(unitViewings).where(eq(unitViewings.id, req.params.viewingId as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete viewing" });
    }
  });

  // --- Unit Offers ---
  app.get("/api/available-units/:id/offers", requireAuth, async (req, res) => {
    try {
      const oUnit = await storage.getAvailableUnit(req.params.id as string);
      if (await assertUnitInClientScope(req, oUnit?.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const { unitOffers } = await import("@shared/schema");
      const rows = await db.select().from(unitOffers).where(eq(unitOffers.unitId, req.params.id as string)).orderBy(unitOffers.offerDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch offers" });
    }
  });

  app.post("/api/available-units/:id/offers", requireAuth, async (req, res) => {
    try {
      const oUnit = await storage.getAvailableUnit(req.params.id as string);
      if (await assertUnitInClientScope(req, oUnit?.propertyId)) {
        return res.status(403).json({ message: "Unit is outside your portfolio" });
      }
      const { unitOffers, insertUnitOfferSchema } = await import("@shared/schema");
      const parsed = insertUnitOfferSchema.safeParse({ ...req.body, unitId: req.params.id });
      if (!parsed.success) return res.status(400).json({ message: fromError(parsed.error).toString() });
      const [row] = await db.insert(unitOffers).values(parsed.data).returning();
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to add offer" });
    }
  });

  app.delete("/api/available-units/offers/:offerId", requireAuth, async (req, res) => {
    try {
      const { unitOffers } = await import("@shared/schema");
      const [offer] = await db.select().from(unitOffers).where(eq(unitOffers.id, req.params.offerId as string));
      if (offer) {
        const oUnit = await storage.getAvailableUnit(offer.unitId);
        if (await assertUnitInClientScope(req, oUnit?.propertyId)) {
          return res.status(403).json({ message: "Unit is outside your portfolio" });
        }
      }
      await db.delete(unitOffers).where(eq(unitOffers.id, req.params.offerId as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete offer" });
    }
  });

  app.get("/uploads/marketing-files/:filename", requireAuth, async (req, res) => {
    try {
      const sanitized = path.basename(req.params.filename as string);
      const file = await getFile(`marketing-files/${sanitized}`);
      if (!file) {
        const diskPath = path.join(MARKETING_FILES_DIR, sanitized);
        if (fs.existsSync(diskPath)) return res.sendFile(diskPath);
        return res.status(404).json({ message: "File not found" });
      }
      const ext = path.extname(sanitized).toLowerCase();
      const viewable = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp"];
      const dlName = file.originalName || sanitized;
      if (req.query.view === "1" && viewable.includes(ext)) {
        res.setHeader("Content-Disposition", contentDispositionFor(dlName, "inline"));
      } else {
        res.setHeader("Content-Disposition", contentDispositionFor(dlName));
      }
      res.set("Content-Type", file.contentType);
      res.send(file.data);
    } catch (err: any) { console.error("[routes] WIP file download error:", err?.message); res.status(500).end(); }
  });

  // PDF proxy — streams a SharePoint file to the browser so pdfjs can render it cross-origin
  app.get("/api/pdf-proxy", requireAuth, async (req, res) => {
    const driveId = req.query.driveId as string;
    const itemId = req.query.itemId as string;
    const shareUrl = req.query.shareUrl as string;
    if (!driveId && !shareUrl) return res.status(400).json({ message: "driveId+itemId or shareUrl required" });
    try {
      const { getValidMsToken } = await import("./microsoft");
      const token = await getValidMsToken(req as any);
      if (!token) return res.status(401).json({ message: "Not signed into Microsoft" });
      let graphUrl: string;
      if (driveId && itemId) {
        graphUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
      } else {
        const b64 = Buffer.from(shareUrl).toString("base64url");
        graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${b64}/driveItem/content`;
      }
      const upstream = await fetch(graphUrl, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (!upstream.ok) return res.status(upstream.status).json({ message: `SharePoint returned ${upstream.status}` });
      const ctype = upstream.headers.get("content-type") || "application/pdf";
      res.setHeader("Content-Type", ctype);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, max-age=300");
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err: any) {
      console.error("[pdf-proxy]", err?.message);
      res.status(500).json({ message: err?.message });
    }
  });

  // Investment Tracker routes
  app.get("/api/investment-tracker", requireAuth, async (req, res) => {
    try {
      const scopeCompanyId = await resolveCompanyScope(req);
      let queryText = `SELECT
        id, property_id AS "propertyId", asset_name AS "assetName", asset_type AS "assetType",
        tenure, guide_price AS "guidePrice", niy, eqy, sqft,
        wault_break AS "waultBreak", wault_expiry AS "waultExpiry",
        current_rent AS "currentRent", erv_pa AS "ervPa", occupancy, capex_required AS "capexRequired",
        board_type AS "boardType", status, client, client_contact AS "clientContact",
        vendor, vendor_agent AS "vendorAgent", buyer, address, notes,
        deal_id AS "dealId", agent_user_ids AS "agentUserIds",
        client_id AS "clientId", client_contact_id AS "clientContactId",
        vendor_id AS "vendorId", vendor_agent_id AS "vendorAgentId",
        completion_date AS "completionDate",
        fee, fee_type AS "feeType", marketing_date AS "marketingDate", bid_deadline AS "bidDeadline",
        created_at AS "createdAt", updated_at AS "updatedAt"
        FROM investment_tracker`;
      const params: string[] = [];
      if (scopeCompanyId) {
        queryText += ` WHERE client_id = $1 OR vendor_id = $1`;
        params.push(scopeCompanyId);
      }
      queryText += ` ORDER BY created_at DESC`;
      const result = await pool.query(queryText, params);
      console.log(`[investment-tracker] GET /api/investment-tracker returned ${result.rows.length} rows`);
      res.json(result.rows);
    } catch (e: any) {
      console.error(`[investment-tracker] Error:`, e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // Counts route must be before :id param routes
  app.get("/api/investment-tracker/counts/all", requireAuth, async (req, res) => {
    try {
      const vRows = await pool.query(`SELECT tracker_id, COUNT(*)::int as count FROM investment_viewings GROUP BY tracker_id`);
      const oRows = await pool.query(`SELECT tracker_id, COUNT(*)::int as count FROM investment_offers GROUP BY tracker_id`);
      const dRows = await pool.query(`SELECT tracker_id, COUNT(*)::int as count FROM investment_distributions GROUP BY tracker_id`);
      const viewings: Record<string, number> = {};
      const offers: Record<string, number> = {};
      const distributions: Record<string, number> = {};
      for (const r of vRows.rows) viewings[r.tracker_id] = r.count;
      for (const r of oRows.rows) offers[r.tracker_id] = r.count;
      for (const r of dRows.rows) distributions[r.tracker_id] = r.count;
      res.json({ viewings, offers, distributions });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-tracker/all-viewings", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentViewings).orderBy(desc(investmentViewings.viewingDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-tracker/all-offers", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentOffers).orderBy(desc(investmentOffers.offerDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-tracker/all-distributions", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentDistributions).orderBy(desc(investmentDistributions.sentDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  const INV_MARKETING_DIR = path.join(process.cwd(), "ChatBGP", "investment-marketing");
  if (!fs.existsSync(INV_MARKETING_DIR)) {
    fs.mkdirSync(INV_MARKETING_DIR, { recursive: true });
  }

  app.get("/api/investment-tracker/all-marketing-files", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentMarketingFiles).orderBy(desc(investmentMarketingFiles.createdAt));
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.trackerId] = (counts[r.trackerId] || 0) + 1;
      res.json(counts);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-tracker/:trackerId/marketing-files", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentMarketingFiles).where(eq(investmentMarketingFiles.trackerId, req.params.trackerId as string)).orderBy(desc(investmentMarketingFiles.createdAt));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/investment-tracker/:trackerId/marketing-files", requireAuth, marketingUpload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const safeTrackerId = req.params.trackerId.replace(/[^a-zA-Z0-9_-]/g, "");
      const ext = path.extname(req.file.originalname).toLowerCase();
      const safeFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      const storageKey = `investment-marketing/${safeTrackerId}/${safeFilename}`;
      await saveFile(storageKey, req.file.buffer, req.file.mimetype, req.file.originalname);
      const [row] = await db.insert(investmentMarketingFiles).values({
        trackerId: req.params.trackerId,
        fileName: req.file.originalname,
        filePath: storageKey,
        fileType: "upload",
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      }).returning();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/investment-marketing-files/:id", requireAuth, async (req, res) => {
    try {
      const [file] = await db.select().from(investmentMarketingFiles).where(eq(investmentMarketingFiles.id, req.params.id as string));
      if (file?.filePath) {
        const { deleteFile } = await import("./file-storage");
        await deleteFile(file.filePath);
      }
      await db.delete(investmentMarketingFiles).where(eq(investmentMarketingFiles.id, req.params.id as string));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-marketing-files/:id/download", requireAuth, async (req, res) => {
    try {
      const [file] = await db.select().from(investmentMarketingFiles).where(eq(investmentMarketingFiles.id, req.params.id as string));
      if (!file) return res.status(404).json({ message: "Not found" });
      const stored = await getFile(file.filePath);
      if (!stored) {
        if (fs.existsSync(file.filePath)) return res.download(file.filePath, file.fileName);
        return res.status(404).json({ message: "File not found" });
      }
      res.set("Content-Type", stored.contentType);
      res.set("Content-Disposition", contentDispositionFor(file.fileName));
      res.send(stored.data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-tracker/:id", requireAuth, async (req, res) => {
    try {
      const [row] = await db.select().from(investmentTracker).where(eq(investmentTracker.id, req.params.id as string));
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker", requireAuth, async (req, res) => {
    try {
      const body = { ...req.body };
      if (!body.propertyId && body.assetName) {
        const [existing] = await db.select().from(crmProperties).where(eq(crmProperties.name, body.assetName)).limit(1);
        if (existing) {
          body.propertyId = existing.id;
        } else {
          const [newProp] = await db.insert(crmProperties).values({
            name: body.assetName,
            address: body.address ? { street: body.address } : null,
            assetClass: body.assetType || null,
            tenure: body.tenure || null,
          }).returning();
          body.propertyId = newProp.id;
        }
      }
      const parsed = insertInvestmentTrackerSchema.parse(body);
      const [row] = await db.insert(investmentTracker).values(parsed).returning();

      // Auto-create a backing CRM deal
      if (!row.dealId) {
        try {
          const dealType = row.boardType === "Sales" ? "Sale" : "Purchase";
          const deal = await storage.createCrmDeal({
            name: row.assetName,
            propertyId: row.propertyId,
            status: "REP",
            dealType,
            internalAgent: await resolveAgentNames(row.agentUserIds),
            fee: row.fee ?? undefined,
          });
          await db.update(investmentTracker).set({ dealId: deal.id }).where(eq(investmentTracker.id, row.id));
          (row as any).dealId = deal.id;
          (row as any).dealRef = deal.dealRef;
        } catch (e: any) {
          console.warn("[investment-tracker POST] auto-create deal failed:", e.message);
        }
      }

      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/investment-tracker/:id", requireAuth, async (req, res) => {
    try {
      const allowedFields = new Set([
        "propertyId", "assetName", "assetType", "tenure", "guidePrice", "niy", "eqy", "sqft",
        "waultBreak", "waultExpiry", "currentRent", "ervPa", "occupancy", "capexRequired",
        "boardType", "status", "client", "clientContact", "vendor", "vendorAgent", "buyer",
        "address", "notes", "dealId", "agentUserIds", "fee", "feeType", "marketingDate", "bidDeadline", "completionDate",
        // Link FKs — without these the inline Client/Vendor/Agent pickers
        // silently dropped every selection (PATCH ignored unknown keys).
        "clientId", "clientContactId", "vendorId", "vendorAgentId",
      ]);
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.has(key)) updates[key] = value;
      }

      const row = await db.transaction(async (tx) => {
        const [updated] = await tx.update(investmentTracker).set(updates).where(eq(investmentTracker.id, req.params.id as string)).returning();
        if (!updated) return null;

        if (updated.propertyId) {
          const syncFields: Record<string, any> = {};
          if (updates.assetName !== undefined) syncFields.name = updates.assetName;
          if (updates.address !== undefined) syncFields.address = typeof updates.address === 'string' ? { street: updates.address } : updates.address;
          if (updates.assetType !== undefined) syncFields.assetClass = updates.assetType;
          if (updates.tenure !== undefined) syncFields.tenure = updates.tenure;
          if (Object.keys(syncFields).length > 0) {
            await tx.update(crmProperties).set(syncFields).where(eq(crmProperties.id, updated.propertyId));
          }
        }

        return updated;
      });

      if (!row) return res.status(404).json({ message: "Not found" });

      // Mirror status/fee/agent/parties onto the backing crm_deal so the
      // Deals board + WIP stay in step with inline investment-tracker edits.
      if (row.dealId) {
        const dealPatch: Record<string, any> = {};
        if ("status" in updates) dealPatch.status = updates.status;
        if ("fee" in updates) dealPatch.fee = updates.fee;
        if ("agentUserIds" in updates) dealPatch.internalAgent = await resolveAgentNames(updates.agentUserIds);
        if ("clientId" in updates) dealPatch.landlordId = updates.clientId || null;
        if ("vendorId" in updates) dealPatch.vendorId = updates.vendorId || null;
        if (Object.keys(dealPatch).length > 0) {
          try {
            await storage.updateCrmDeal(row.dealId, dealPatch as any);
          } catch (e: any) {
            console.warn(`[investment-tracker PATCH] deal sync failed for ${row.dealId}:`, e?.message);
          }
        }
        // We bypass /api/crm/deals/:id (calling storage directly), so the
        // route's mirrorFromDeal fan-out never fires. Trigger it manually
        // when status changed so available_units + leasing_schedule +
        // tenancy stay in lockstep with investment-tracker edits.
        if ("status" in updates) {
          try {
            const { mirrorFromDeal } = await import("./lease-status-mirror");
            await mirrorFromDeal(row.dealId, updates.status as string, { pool, reason: "investment-tracker.PATCH" });
          } catch (e: any) {
            console.warn(`[investment-tracker PATCH] mirror fan-out failed for ${row.dealId}:`, e?.message);
          }
        }
      }

      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/investment-tracker/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentTracker).where(eq(investmentTracker.id, req.params.id as string));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker/:id/link-deal", requireAuth, async (req, res) => {
    try {
      const { dealId } = req.body;
      const [row] = await db.update(investmentTracker).set({ dealId, updatedAt: new Date() }).where(eq(investmentTracker.id, req.params.id as string)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker/:id/unlink-deal", requireAuth, async (req, res) => {
    try {
      const [row] = await db.update(investmentTracker).set({ dealId: null, updatedAt: new Date() }).where(eq(investmentTracker.id, req.params.id as string)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker/:id/create-deal", requireAuth, async (req, res) => {
    try {
      const [item] = await db.select().from(investmentTracker).where(eq(investmentTracker.id, req.params.id as string));
      if (!item) return res.status(404).json({ message: "Not found" });
      // Idempotent — if already linked, return the existing deal
      if (item.dealId) {
        const existing = await storage.getCrmDeal(item.dealId);
        if (existing) return res.json({ ...existing, alreadyLinked: true });
      }
      const property = item.propertyId ? await storage.getCrmProperty(item.propertyId) : null;
      // Sales board: client = landlord; Purchases board: vendor = the seller side
      const landlordCompanyId = item.boardType === "Sales" ? item.clientId : null;
      const vendorCompanyId   = item.boardType === "Sales" ? null          : item.vendorId;
      const deal = await storage.createCrmDeal({
        name: item.assetName || property?.name || "Investment Deal",
        propertyId: item.propertyId || undefined,
        status: item.status && ["REP","SPEC","LIVE","AVA","NEG","SOL","EXC","COM","WIT","INV"].includes(item.status) ? item.status : "REP",
        dealType: (item.boardType === "Sales") ? "Sale" : "Purchase",
        groupName: "Investment - Active",
        team: ["Investment"],
        landlordId: landlordCompanyId || undefined,
        vendorId:   vendorCompanyId   || undefined,
        internalAgent: await resolveAgentNames(item.agentUserIds),
        fee: item.fee || undefined,
        comments: `Converted from investment tracker on ${new Date().toISOString().slice(0,10)}.`,
      } as any);
      await db.update(investmentTracker).set({ dealId: deal.id, updatedAt: new Date() }).where(eq(investmentTracker.id, req.params.id as string));
      res.json(deal);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // --- Investment Viewings ---
  app.get("/api/investment-tracker/:trackerId/viewings", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentViewings).where(eq(investmentViewings.trackerId, req.params.trackerId as string)).orderBy(desc(investmentViewings.viewingDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/investment-tracker/:trackerId/viewings", requireAuth, async (req, res) => {
    try {
      const parsed = insertInvestmentViewingSchema.parse({ ...req.body, trackerId: req.params.trackerId });
      const [row] = await db.insert(investmentViewings).values(parsed).returning();
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.patch("/api/investment-viewings/:id", requireAuth, async (req, res) => {
    try {
      const allowed = insertInvestmentViewingSchema.partial().omit({ trackerId: true }).parse(req.body);
      const [row] = await db.update(investmentViewings).set({ ...allowed, updatedAt: new Date() }).where(eq(investmentViewings.id, req.params.id as string)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/investment-viewings/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentViewings).where(eq(investmentViewings.id, req.params.id as string));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // --- Investment Offers ---
  app.get("/api/investment-tracker/:trackerId/offers", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentOffers).where(eq(investmentOffers.trackerId, req.params.trackerId as string)).orderBy(desc(investmentOffers.offerDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/investment-tracker/:trackerId/offers", requireAuth, async (req, res) => {
    try {
      const parsed = insertInvestmentOfferSchema.parse({ ...req.body, trackerId: req.params.trackerId });
      const [row] = await db.insert(investmentOffers).values(parsed).returning();
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.patch("/api/investment-offers/:id", requireAuth, async (req, res) => {
    try {
      const allowed = insertInvestmentOfferSchema.partial().omit({ trackerId: true }).parse(req.body);
      const [row] = await db.update(investmentOffers).set({ ...allowed, updatedAt: new Date() }).where(eq(investmentOffers.id, req.params.id as string)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/investment-offers/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentOffers).where(eq(investmentOffers.id, req.params.id as string));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // --- Investment Distributions (Sent To tracking) ---
  app.get("/api/investment-tracker/:trackerId/distributions", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentDistributions).where(eq(investmentDistributions.trackerId, req.params.trackerId as string)).orderBy(desc(investmentDistributions.sentDate));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/investment-tracker/:trackerId/distributions", requireAuth, async (req, res) => {
    try {
      const parsed = insertInvestmentDistributionSchema.parse({ ...req.body, trackerId: req.params.trackerId });
      const [row] = await db.insert(investmentDistributions).values(parsed).returning();
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.patch("/api/investment-distributions/:id", requireAuth, async (req, res) => {
    try {
      const allowed = insertInvestmentDistributionSchema.partial().omit({ trackerId: true }).parse(req.body);
      const [row] = await db.update(investmentDistributions).set({ ...allowed, updatedAt: new Date() }).where(eq(investmentDistributions.id, req.params.id as string)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/investment-distributions/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentDistributions).where(eq(investmentDistributions.id, req.params.id as string));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  (async () => {
    try {
      const countResult = await pool.query("SELECT COUNT(*)::int as count FROM investment_tracker");
      if (countResult.rows[0].count === 0) {
        const seedPath = path.join(process.cwd(), "server", "investment_tracker_seed.json");
        if (fs.existsSync(seedPath)) {
          const seedData = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
          let inserted = 0;
          for (const row of seedData) {
            await pool.query(`INSERT INTO investment_tracker (
              id, property_id, asset_name, asset_type, tenure, guide_price, niy, eqy, sqft,
              wault_break, wault_expiry, current_rent, erv_pa, occupancy, capex_required,
              status, vendor, vendor_agent, notes, deal_id, agent_user_ids, fee, fee_type,
              marketing_date, bid_deadline, created_at, updated_at, board_type, client, buyer, address, client_contact
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
            ON CONFLICT (id) DO NOTHING`, [
              row.id, row.property_id, row.asset_name, row.asset_type, row.tenure, row.guide_price,
              row.niy, row.eqy, row.sqft, row.wault_break, row.wault_expiry, row.current_rent,
              row.erv_pa, row.occupancy, row.capex_required, row.status, row.vendor, row.vendor_agent,
              row.notes, row.deal_id, row.agent_user_ids, row.fee, row.fee_type, row.marketing_date,
              row.bid_deadline, row.created_at, row.updated_at, row.board_type, row.client, row.buyer,
              row.address, row.client_contact
            ]);
            inserted++;
          }
          console.log(`[seed] Auto-seeded ${inserted} investment tracker rows`);
        }
      }
    } catch (e: any) {
      console.error("[seed] Investment tracker auto-seed error:", e.message);
    }
  })();

  (async () => {
    try {
      const { crmDeals, availableUnits } = await import("@shared/schema");
      // Match both canonical and legacy strings — migration may not yet have run
      const NEGOTIATION_STATUSES = ["NEG", "Under Negotiation", "HOTs"];
      const negDeals = await db.select().from(crmDeals)
        .where(inArray(crmDeals.status, NEGOTIATION_STATUSES));

      if (negDeals.length === 0) return;

      const existingUnits = await db.select().from(availableUnits);
      const existingDealIds = new Set(existingUnits.filter(u => u.dealId).map(u => u.dealId));

      let migrated = 0;
      for (const deal of negDeals) {
        if (existingDealIds.has(deal.id)) continue;

        let useClass: string | null = deal.assetClass || null;
        if (deal.propertyId) {
          const prop = await storage.getCrmProperty(deal.propertyId);
          if (prop) useClass = useClass || prop.assetClass || null;
        }

        await storage.createAvailableUnit({
          propertyId: deal.propertyId || "",
          unitName: deal.name || "Unnamed Unit",
          floor: null,
          sqft: deal.totalAreaSqft || null,
          askingRent: deal.rentPa || null,
          ratesPa: null,
          serviceChargePa: null,
          useClass,
          condition: null,
          availableDate: null,
          marketingStatus: "Available",
          epcRating: null,
          notes: deal.comments || null,
          restrictions: null,
          fee: deal.fee || null,
          dealId: deal.id,
          agentUserIds: deal.internalAgent || null,
          viewingsCount: 0,
          lastViewingDate: null,
          marketingStartDate: null,
        });
        migrated++;
      }
      if (migrated > 0) {
        console.log(`[migration] Migrated ${migrated} letting tracker deals to available units`);
      }
    } catch (e: any) {
      console.error("[migration] Letting deals migration error:", e.message);
    }
  })();


  // Lazy-init the table on first hit. Same pattern as
  // brand_score_history in brand-triggers.ts — keeps deploys self-healing
  // when the table never made it into the migrations folder.
  let clientTemplatesTableEnsured = false;
  async function ensureClientTemplatesTable() {
    if (clientTemplatesTableEnsured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        company_name TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'document',
        preview_data JSONB,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_client_templates_company_id ON client_templates(company_id);
    `);
    clientTemplatesTableEnsured = true;
  }

  app.get("/api/client-templates", requireAuth, async (req, res) => {
    try {
      await ensureClientTemplatesTable();
      const { resolveCompanyScope } = await import("./company-scope");
      const scopeCompanyId = await resolveCompanyScope(req);

      if (scopeCompanyId) {
        const result = await pool.query(
          `SELECT * FROM client_templates WHERE company_id = $1 ORDER BY created_at DESC`,
          [scopeCompanyId]
        );
        return res.json(result.rows);
      }

      const result = await pool.query(`SELECT * FROM client_templates ORDER BY company_name, created_at DESC`);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/client-templates", requireAuth, async (req, res) => {
    try {
      await ensureClientTemplatesTable();
      const userId = req.session.userId!;
      const userResult = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      const email = userResult.rows[0]?.email?.toLowerCase() || "";
      if (!email.endsWith("@brucegillinghampollard.com")) {
        return res.status(403).json({ message: "Only BGP staff can create client templates" });
      }

      const { company_id, company_name, label, description, category, preview_data } = req.body;
      if (!company_id || !company_name || !label) {
        return res.status(400).json({ message: "company_id, company_name, and label are required" });
      }

      const result = await pool.query(
        `INSERT INTO client_templates (company_id, company_name, label, description, category, preview_data, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [company_id, company_name, label, description || "", category || "document", preview_data ? JSON.stringify(preview_data) : null, email]
      );
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/client-templates/:id", requireAuth, async (req, res) => {
    try {
      await ensureClientTemplatesTable();
      const userId = req.session.userId!;
      const userResult = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      const email = userResult.rows[0]?.email?.toLowerCase() || "";
      if (!email.endsWith("@brucegillinghampollard.com")) {
        return res.status(403).json({ message: "Only BGP staff can delete client templates" });
      }

      await pool.query(`DELETE FROM client_templates WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/client-templates/scope-info", requireAuth, async (req, res) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      const scopeCompanyId = await resolveCompanyScope(req);
      const userId = req.session.userId!;
      const userResult = await pool.query(`SELECT team, email FROM users WHERE id = $1`, [userId]);
      const { team, email } = userResult.rows[0] || {};
      const isBgpStaff = email?.toLowerCase()?.endsWith("@brucegillinghampollard.com");
      res.json({ isScoped: !!scopeCompanyId, companyId: scopeCompanyId, team, isBgpStaff });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/company-by-name/:name", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, name FROM crm_companies WHERE LOWER(name) = LOWER($1) LIMIT 1",
        [req.params.name]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Not found" });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: "Failed" });
    }
  });

  app.get("/api/company-portfolio/:companyId", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.params;

      const scopeCompanyId = await resolveCompanyScope(req);
      const userId = req.session?.userId || (req as any).tokenUserId;
      const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
      const userEmail = (userResult.rows[0]?.email || "").toLowerCase();
      const isStaff = userEmail.endsWith("@brucegillinghampollard.com");
      if (scopeCompanyId && scopeCompanyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!isStaff && !scopeCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // The client's portfolio = properties they own (landlord_id) PLUS any
      // explicitly linked to the company via crm_company_properties. Each row
      // appears once (OR-filter, no join), so no dedup needed.
      // latitude/longitude included so the client dashboard can render the
      // same portfolio map the landlord pages use.
      const propsResult = await pool.query(
        `SELECT id, name, address, status, asset_class,
                latitude AS lat, longitude AS lng
           FROM crm_properties
         WHERE landlord_id = $1
            OR id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1)
         ORDER BY name`,
        [companyId]
      );
      const properties = propsResult.rows;
      const propertyIds = properties.map((p: any) => p.id);
      // Client account name — lets synced team-diary events (tagged with the
      // client's name, not a specific property) surface on the events card.
      const cpCompanyName = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId])).rows[0]?.name || null;

      let totalUnits = 0, vacantUnits = 0, totalPassingRent = 0, rentRecordedUnits = 0;
      if (propertyIds.length > 0) {
        // Portfolio-overview stats come from the TENANCY schedule — the master
        // rent roll (every unit). The leasing board is only strategy + live
        // deals now, so it must NOT drive whole-portfolio counts.
        // rent_recorded = how many of those rows actually carry a rent — the
        // headline £ is a partial sum until data onboarding completes, and
        // the dashboard states that coverage rather than implying a total.
        const tenancyResult = await pool.query(
          `SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE status IN ('Vacant', 'Void', 'Available')) as vacant,
                  COALESCE(SUM(CASE WHEN passing_rent_pa IS NOT NULL THEN passing_rent_pa ELSE 0 END), 0) as passing_rent,
                  COUNT(*) FILTER (WHERE passing_rent_pa IS NOT NULL AND passing_rent_pa > 0
                                     AND status NOT IN ('Vacant', 'Void', 'Available')) as rent_recorded
           FROM tenancy_schedule_units WHERE property_id = ANY($1)`,
          [propertyIds]
        );
        totalUnits = parseInt(tenancyResult.rows[0]?.total || "0");
        vacantUnits = parseInt(tenancyResult.rows[0]?.vacant || "0");
        totalPassingRent = parseFloat(tenancyResult.rows[0]?.passing_rent || "0");
        rentRecordedUnits = parseInt(tenancyResult.rows[0]?.rent_recorded || "0");
      }

      // Deals belong to the client when the deal's landlord is the company,
      // OR it sits on one of the company's properties, OR its group carries
      // the client name — landlord_id alone missed nearly everything and the
      // portfolio showed "0 active deals" while the Deals board was full.
      const dealsResult = await pool.query(
        `SELECT COUNT(DISTINCT d.id) as total,
                COUNT(DISTINCT d.id) FILTER (WHERE d.status NOT IN ('WIT', 'COM', 'INV')) as active
         FROM crm_deals d
         LEFT JOIN crm_properties p ON d.property_id = p.id
         WHERE d.landlord_id = $1
            OR p.landlord_id = $1
            OR d.group_name ILIKE '%' || (SELECT name FROM crm_companies WHERE id = $1) || '%'`,
        [companyId]
      );

      // Distinct people, not raw rows — imports create duplicate contact
      // rows and the CRM page dedupes by name, so this count must match it.
      const contactsResult = await pool.query(
        "SELECT COUNT(DISTINCT lower(trim(name))) as total FROM crm_contacts WHERE company_id = $1",
        [companyId]
      );

      let upcomingEvents = 0;
      if (propertyIds.length > 0) {
        // Same filter + dedupe as the events list below, so the count on the
        // stats strip matches the number of events actually shown.
        const eventsResult = await pool.query(
          `SELECT COUNT(*) as total FROM (
             SELECT DISTINCT lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time
             FROM team_events
             WHERE (property_id = ANY($1) OR company_name = $2)
               AND start_time >= NOW()
               AND title NOT ILIKE 'cancelled:%'
               AND title NOT ILIKE '%team meeting (%'
               AND title NOT ILIKE '%weekly call%'
               AND title NOT ILIKE '%padel%'
           ) t`,
          [propertyIds, cpCompanyName]
        );
        upcomingEvents = parseInt(eventsResult.rows[0]?.total || "0");
      }

      const dealsListResult = await pool.query(
        `SELECT d.id, d.name, d.status, d.property_id, d.deal_type as "dealType", p.name as property_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON d.property_id = p.id
         WHERE d.landlord_id = $1 AND d.status NOT IN ('WIT', 'COM', 'INV')
         ORDER BY p.name, d.created_at DESC`,
        [companyId]
      );

      // The dashboard portfolio boards (Leasing Schedule overview, Lease Expiry
      // Timeline, Vacancy Pipeline) show EVERY unit across the portfolio, so
      // they read the tenancy schedule (master), not the trimmed leasing board.
      let leasingUnits: any[] = [];
      if (propertyIds.length > 0) {
        const leasingResult = await pool.query(
          `SELECT u.id, u.property_id, u.premises, u.unit_number, u.status, u.tenant_name, u.passing_rent_pa, u.lease_expiry, p.name as property_name
           FROM tenancy_schedule_units u
           LEFT JOIN crm_properties p ON u.property_id = p.id
           WHERE u.property_id = ANY($1)
           ORDER BY p.name, u.sort_order`,
          [propertyIds]
        );
        leasingUnits = leasingResult.rows;
      }

      let upcomingEventsList: any[] = [];
      let calendarEvents: any[] = [];
      if (propertyIds.length > 0) {
        // Client-facing events must be about the client's portfolio, not BGP's
        // own diary. Drop cancelled meetings, BGP-internal team calls/socials,
        // and de-duplicate the same meeting synced from several attendees'
        // calendars (same title + start slot).
        const eventsListResult = await pool.query(
          `SELECT DISTINCT ON (lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time)
                  id, regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i') AS title,
                  start_time, end_time, event_type, location, property_id
           FROM team_events
           WHERE (property_id = ANY($1) OR company_name = $2)
             AND start_time >= NOW()
             AND title NOT ILIKE 'cancelled:%'
             AND title NOT ILIKE '%team meeting (%'
             AND title NOT ILIKE '%weekly call%'
             AND title NOT ILIKE '%padel%'
           ORDER BY lower(regexp_replace(title, '^(FW:|RE:|FWD:)\\s*', '', 'i')), start_time, id`,
          [propertyIds, cpCompanyName]
        );
        // DISTINCT ON forces title ordering, so re-sort chronologically here.
        upcomingEventsList = eventsListResult.rows
          .sort((a: any, b: any) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
          .slice(0, 20);

        const calendarResult = await pool.query(
          `SELECT te.id, te.title, te.start_time, te.end_time, te.event_type, te.location, te.property_id, p.name as property_name
           FROM team_events te
           LEFT JOIN crm_properties p ON te.property_id = p.id
           WHERE (te.property_id = ANY($1) OR te.company_name = $2)
             AND te.start_time >= NOW() - INTERVAL '7 days'
             AND te.start_time <= NOW() + INTERVAL '30 days'
           ORDER BY te.start_time`,
          [propertyIds, cpCompanyName]
        );
        calendarEvents = calendarResult.rows;
      }

      const contactsListResult = await pool.query(
        `SELECT id, name, email, phone, role, avatar_url FROM crm_contacts WHERE company_id = $1 ORDER BY name`,
        [companyId]
      );

      const activityResult = await pool.query(
        `SELECT d.name as title, d.status, d.created_at, p.name as property_name, 'deal' as type
         FROM crm_deals d
         LEFT JOIN crm_properties p ON d.property_id = p.id
         WHERE d.landlord_id = $1
         ORDER BY d.created_at DESC LIMIT 8`,
        [companyId]
      );

      const companyResult = await pool.query(
        `SELECT name, domain_url, description, head_office_address, company_type,
                kyc_status, kyc_checked_at, bgp_contact_user_ids,
                companies_house_number, companies_house_data, parent_company_id,
                linkedin_url, phone, industry, employee_count
         FROM crm_companies WHERE id = $1`,
        [companyId]
      );
      const company = companyResult.rows[0] || null;

      let parentCompanyName = null;
      if (company?.parent_company_id && company.parent_company_id !== companyId) {
        const parentRes = await pool.query("SELECT name FROM crm_companies WHERE id = $1", [company.parent_company_id]);
        parentCompanyName = parentRes.rows[0]?.name || null;
      }

      let pscList: string[] = [];
      if (company?.companies_house_data?.persons_with_significant_control) {
        pscList = company.companies_house_data.persons_with_significant_control.map((p: any) => p.name || p.company_name || "Unknown");
      }

      if (pscList.length === 0 && company?.companies_house_number) {
        try {
          const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;
          if (chApiKey) {
            const pscRes = await fetch(`https://api.company-information.service.gov.uk/company/${company.companies_house_number}/persons-with-significant-control`, {
              headers: { Authorization: "Basic " + Buffer.from(chApiKey + ":").toString("base64") },
            });
            if (pscRes.ok) {
              const pscData = await pscRes.json();
              if (pscData.items?.length > 0) {
                pscList = pscData.items.map((p: any) => p.name || p.name_elements?.company_name || "Unknown");
                await pool.query(
                  "UPDATE crm_companies SET companies_house_data = COALESCE(companies_house_data, '{}'::jsonb) || jsonb_build_object('persons_with_significant_control', $1::jsonb) WHERE id = $2",
                  [JSON.stringify(pscData.items), companyId]
                );
              }
            }
          }
        } catch (e: any) {
          console.log("[company-portfolio] PSC fetch skipped:", e?.message);
        }
      }

      res.json({
        stats: {
          totalProperties: properties.length,
          totalUnits,
          vacantUnits,
          vacancyRate: totalUnits > 0 ? ((vacantUnits / totalUnits) * 100).toFixed(1) : "0",
          totalPassingRent,
          rentRecordedUnits,
          activeDeals: parseInt(dealsResult.rows[0]?.active || "0"),
          totalContacts: parseInt(contactsResult.rows[0]?.total || "0"),
          upcomingEvents,
        },
        company: company ? {
          name: company.name,
          website: company.domain_url,
          description: company.description,
          address: company.head_office_address,
          companyType: company.company_type,
          // KYC/AML status and PSC ownership are BGP's own compliance record
          // ON this client — never send them back to the client themselves.
          kycStatus: scopeCompanyId ? null : company.kyc_status,
          kycCheckedAt: scopeCompanyId ? null : company.kyc_checked_at,
          bgpContacts: company.bgp_contact_user_ids || [],
          companiesHouseNumber: company.companies_house_number,
          parentCompanyName,
          pscList: scopeCompanyId ? [] : pscList,
          linkedinUrl: company.linkedin_url,
          phone: company.phone,
          industry: company.industry,
          employeeCount: company.employee_count,
        } : null,
        properties,
        deals: dealsListResult.rows,
        leasingUnits,
        events: upcomingEventsList,
        calendarEvents,
        contacts: contactsListResult.rows,
        activity: activityResult.rows,
      });
    } catch (err: any) {
      console.error("[company-portfolio] Error:", err?.message);
      res.status(500).json({ message: "Failed to fetch portfolio" });
    }
  });

  const TEAM_FOLDERS = [
    "London F&B", "London Retail", "National Leasing", "Investment",
    "Tenant Rep", "Development", "Lease Advisory", "Office Corporate", "Admin"
  ];
  const CHATBGP_BASE = path.join(process.cwd(), "ChatBGP");

  TEAM_FOLDERS.forEach(t => {
    const dir = path.join(CHATBGP_BASE, t);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const teamFileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.get("/api/team-folders", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      const userResult = await pool.query(`SELECT team, is_admin FROM users WHERE id = $1`, [userId]);
      const user = userResult.rows[0];
      const isAdmin = user?.is_admin;
      const userTeam = user?.team || "";

      const folders = TEAM_FOLDERS.map(name => {
        const dir = path.join(CHATBGP_BASE, name);
        let files: string[] = [];
        try { files = fs.readdirSync(dir); } catch {}
        return { name, fileCount: files.length };
      });

      res.json({ folders, userTeam, isAdmin });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team-folders/:folder/files", requireAuth, async (req, res) => {
    try {
      const folderName = decodeURIComponent(req.params.folder as string);
      if (!TEAM_FOLDERS.includes(folderName)) return res.status(400).json({ error: "Invalid folder" });

      const dir = path.join(CHATBGP_BASE, folderName);
      if (!fs.existsSync(dir)) return res.json([]);

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = entries
        .filter(e => e.isFile())
        .map(e => {
          const stats = fs.statSync(path.join(dir, e.name));
          return { name: e.name, size: stats.size, modified: stats.mtime.toISOString() };
        })
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      res.json(files);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/team-folders/:folder/upload", requireAuth, teamFileUpload.single("file"), async (req, res) => {
    try {
      const folderName = decodeURIComponent(req.params.folder as string);
      if (!TEAM_FOLDERS.includes(folderName)) return res.status(400).json({ error: "Invalid folder" });

      const userId = req.session?.userId || (req as any).tokenUserId;
      const userResult = await pool.query(`SELECT team, is_admin FROM users WHERE id = $1`, [userId]);
      const user = userResult.rows[0];
      const isAdmin = user?.is_admin;
      const userTeam = (user?.team || "").toLowerCase();
      const folderLower = folderName.toLowerCase();

      const canWrite = isAdmin || userTeam === folderLower ||
        (folderLower === "office corporate" && userTeam === "office / corporate");

      if (!canWrite) return res.status(403).json({ error: "You can only upload to your own team folder" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const dir = path.join(CHATBGP_BASE, folderName);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, safeName), file.buffer);

      res.json({ name: safeName, size: file.size });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/team-folders/:folder/download/:filename", requireAuth, async (req, res) => {
    try {
      const folderName = decodeURIComponent(req.params.folder as string);
      const filename = req.params.filename as string;
      if (!TEAM_FOLDERS.includes(folderName)) return res.status(400).json({ error: "Invalid folder" });
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return res.status(400).json({ error: "Invalid filename" });

      const filePath = path.join(CHATBGP_BASE, folderName, filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

      res.download(filePath, filename.replace(/^\d+-/, ""));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/team-folders/:folder/:filename", requireAuth, async (req, res) => {
    try {
      const folderName = decodeURIComponent(req.params.folder as string);
      const filename = req.params.filename as string;
      if (!TEAM_FOLDERS.includes(folderName)) return res.status(400).json({ error: "Invalid folder" });
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return res.status(400).json({ error: "Invalid filename" });

      const userId = req.session?.userId || (req as any).tokenUserId;
      const userResult = await pool.query(`SELECT team, is_admin FROM users WHERE id = $1`, [userId]);
      const user = userResult.rows[0];
      const isAdmin = user?.is_admin;
      const userTeam = (user?.team || "").toLowerCase();
      const folderLower = folderName.toLowerCase();

      const canDelete = isAdmin || userTeam === folderLower ||
        (folderLower === "office corporate" && userTeam === "office / corporate");

      if (!canDelete) return res.status(403).json({ error: "You can only delete files from your own team folder" });

      const filePath = path.join(CHATBGP_BASE, folderName, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/activity-feed", requireAuth, async (req: Request, res: Response) => {
    try {
    // External client logins get no org-wide feed — their world is the
    // client-scoped briefing. (Landsec audit.)
    if (await (await import("./company-scope")).isClientRequestUser(req)) return res.json([]);

      const tableCheck = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_activity_log')`
      );
      if (!tableCheck.rows[0].exists) {
        return res.json([]);
      }
      const rows = await pool.query(
        `SELECT * FROM system_activity_log ORDER BY created_at DESC LIMIT 50`
      );
      res.json(rows.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/requirements/matches/:requirementId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { requirementId } = req.params;
      const reqType = (req.query.type as string) || "leasing";
      let requirement: any;
      if (reqType === "investment") {
        const rows = await pool.query(`SELECT *, use_types as use FROM crm_requirements_investment WHERE id = $1`, [requirementId]);
        requirement = rows.rows[0];
      } else {
        const rows = await pool.query(`SELECT * FROM crm_requirements_leasing WHERE id = $1`, [requirementId]);
        requirement = rows.rows[0];
      }
      if (!requirement) return res.json([]);

      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      const useArray = requirement.use;
      if (useArray && useArray.length > 0) {
        conditions.push(`au.use_class = ANY($${paramIndex})`);
        params.push(useArray);
        paramIndex++;
      }

      if (Array.isArray(requirement.requirement_locations) && requirement.requirement_locations.length > 0) {
        const locClauses = requirement.requirement_locations.map((_: any, i: number) => {
          params.push(`%${requirement.requirement_locations[i]}%`);
          return `au.location ILIKE $${paramIndex++}`;
        });
        conditions.push(`(${locClauses.join(" OR ")})`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        SELECT au.*, p.name as property_name, p.address as property_address 
        FROM available_units au 
        LEFT JOIN crm_properties p ON au.property_id = p.id
        ${whereClause}
        ORDER BY au.created_at DESC LIMIT 20
      `;
      const matches = await pool.query(query, params);
      res.json(matches.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/available-units/matches/:unitId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { unitId } = req.params;
      const unitRows = await pool.query(`SELECT * FROM available_units WHERE id = $1`, [unitId]);
      const unit = unitRows.rows[0];
      if (!unit) return res.json([]);

      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (unit.use_class) {
        conditions.push(`$${paramIndex} = ANY(r.use)`);
        params.push(unit.use_class);
        paramIndex++;
      }

      if (unit.location) {
        conditions.push(`r.requirement_locations IS NOT NULL AND array_length(r.requirement_locations, 1) > 0 AND EXISTS (SELECT 1 FROM unnest(r.requirement_locations) loc WHERE $${paramIndex} ILIKE '%' || loc || '%' OR loc ILIKE '%' || $${paramIndex} || '%')`);
        params.push(unit.location);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        SELECT r.*, c.name as company_name 
        FROM crm_requirements_leasing r
        LEFT JOIN crm_companies c ON r.company_id = c.id
        ${whereClause}
        ORDER BY r.created_at DESC LIMIT 20
      `;
      const matches = await pool.query(query, params);
      res.json(matches.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/deals/:dealId/timeline", requireAuth, async (req: Request, res: Response) => {
    try {
      const { dealId } = req.params;
      const timeline: any[] = [];

      const dealRows = await pool.query(`SELECT * FROM crm_deals WHERE id = $1`, [dealId]);
      const deal = dealRows.rows[0];
      if (!deal) return res.status(404).json({ error: "Deal not found" });

      if (deal.created_at) {
        timeline.push({ type: "deal_created", date: deal.created_at, detail: `Deal "${deal.name}" created`, icon: "plus" });
      }

      if (deal.instructed_at) {
        timeline.push({ type: "instructed", date: deal.instructed_at, detail: "Instructed", icon: "briefcase" });
      }
      if (deal.target_date) {
        timeline.push({ type: "target", date: deal.target_date, detail: "Target date", icon: "target" });
      }
      if (deal.kyc_approved && (deal.kyc_approved_at || deal.updated_at)) {
        timeline.push({ type: "kyc_approved", date: deal.kyc_approved_at || deal.updated_at, detail: `KYC approved by ${deal.kyc_approved_by || "system"}`, icon: "shield-check" });
      }
      if (deal.exchanged_at) {
        timeline.push({ type: "exchanged", date: deal.exchanged_at, detail: "Exchanged", icon: "handshake" });
      }
      if (deal.completed_at) {
        timeline.push({ type: "completion", date: deal.completed_at, detail: "Completed", icon: "check-circle" });
      }
      if (deal.invoiced_at) {
        timeline.push({ type: "invoiced", date: deal.invoiced_at, detail: "Invoiced", icon: "receipt" });
      }

      const reqRows = await pool.query(
        `SELECT id, name, created_at FROM crm_requirements_leasing WHERE deal_id = $1
         UNION ALL
         SELECT id, name, created_at FROM crm_requirements_investment WHERE deal_id = $1`,
        [dealId]
      );
      for (const r of reqRows.rows) {
        timeline.push({ type: "requirement_linked", date: r.created_at, detail: `Linked to requirement: ${r.name}`, icon: "link" });
      }

      const compRows = await pool.query(
        `SELECT id, name, created_at FROM crm_comps WHERE deal_id = $1`, [dealId]
      );
      for (const comp of compRows.rows) {
        timeline.push({ type: "comp_created", date: comp.created_at, detail: `Comp created: ${comp.name}`, icon: "bar-chart" });
      }

      const invoiceRows = await pool.query(
        `SELECT id, invoice_number, status, created_at FROM xero_invoices WHERE deal_id = $1`, [dealId]
      );
      for (const inv of invoiceRows.rows) {
        const invDetail = [inv.invoice_number, inv.status].filter(Boolean).join(" — ") || "Invoice created";
        timeline.push({ type: "invoice", date: inv.created_at, detail: `Invoice: ${invDetail}`, icon: "receipt" });
      }

      const companyIds = [deal.landlord_id, deal.tenant_id, deal.vendor_id, deal.purchaser_id].filter(Boolean);
      if (companyIds.length > 0) {
        const interactionRows = await pool.query(
          `SELECT ci.type, ci.subject, ci.interaction_date, cc.name as contact_name 
           FROM crm_interactions ci 
           LEFT JOIN crm_contacts cc ON ci.contact_id = cc.id
           WHERE ci.company_id = ANY($1) 
           ORDER BY ci.interaction_date DESC LIMIT 10`,
          [companyIds]
        );
        for (const i of interactionRows.rows) {
          timeline.push({ type: "interaction", date: i.interaction_date, detail: `${i.type}: ${i.subject || ""}${i.contact_name ? ` with ${i.contact_name}` : ""}`, icon: "message-circle" });
        }
      }

      timeline.sort((a, b) => {
        const ta = new Date(a.date).getTime();
        const tb = new Date(b.date).getTime();
        return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
      });
      res.json(timeline);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/properties/:propertyId/360", requireAuth, async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.params;

      const propRow = await pool.query(`SELECT name, address FROM crm_properties WHERE id = $1`, [propertyId]);
      if (!propRow.rows[0]) return res.json({ comps: [], deals: [], news: [], matchingRequirements: [] });
      const prop = propRow.rows[0];
      const propName = prop.name || "";
      const addr = prop.address || {};
      const addrStr = (addr.formatted || addr.address || addr.text || addr.street || "").trim();

      const newsConditions: string[] = [];
      const newsParams: any[] = [];
      let ni = 1;
      if (propName) {
        newsConditions.push(`title ILIKE $${ni}`);
        newsParams.push(`%${propName}%`);
        ni++;
      }
      if (addrStr) {
        newsConditions.push(`title ILIKE $${ni}`);
        newsParams.push(`%${addrStr}%`);
        ni++;
      }

      const newsQuery = newsConditions.length > 0
        ? pool.query(`SELECT id, title, summary, url, published_at, source_name FROM news_articles WHERE ${newsConditions.join(" OR ")} ORDER BY published_at DESC LIMIT 10`, newsParams)
        : Promise.resolve({ rows: [] });

      const [compsResult, dealsResult, newsResult, reqResult] = await Promise.all([
        pool.query(`SELECT id, name, tenant, headline_rent, area_sqft, completion_date, use_class FROM crm_comps WHERE property_id = $1 ORDER BY created_at DESC LIMIT 10`, [propertyId]),
        pool.query(`SELECT id, name, deal_type, status, rent_pa, fee, target_date, exchanged_at, completed_at FROM crm_deals WHERE property_id = $1 ORDER BY created_at DESC LIMIT 10`, [propertyId]),
        newsQuery,
        pool.query(`
          SELECT r.id, r.name, r.use, r.size, r.requirement_locations, c.name as company_name
          FROM crm_requirements_leasing r
          LEFT JOIN crm_companies c ON r.company_id = c.id
          WHERE EXISTS (
            SELECT 1 FROM available_units au 
            WHERE au.property_id = $1 
            AND (au.use_class = ANY(r.use) OR r.use IS NULL OR array_length(r.use, 1) IS NULL)
          )
          ORDER BY r.created_at DESC LIMIT 10
        `, [propertyId]),
      ]);

      res.json({
        comps: compsResult.rows,
        deals: dealsResult.rows,
        news: newsResult.rows,
        matchingRequirements: reqResult.rows,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const status = req.query.status as string | undefined;
      let query = `SELECT t.*, 
        d.name as deal_name, p.name as property_name, c.name as contact_name
        FROM user_tasks t 
        LEFT JOIN crm_deals d ON t.linked_deal_id = d.id
        LEFT JOIN crm_properties p ON t.linked_property_id = p.id
        LEFT JOIN crm_contacts c ON t.linked_contact_id = c.id
        WHERE t.user_id = $1`;
      const params: any[] = [userId];
      if (status && status !== "all") {
        query += ` AND t.status = $2`;
        params.push(status);
      }
      query += ` ORDER BY COALESCE(t.is_pinned, false) DESC, CASE t.priority
        WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST, t.sort_order ASC, t.created_at DESC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { title, description, dueDate, priority, category, linkedDealId, linkedPropertyId, linkedContactId,
              linkedOnenotePageId, linkedOnenotePageUrl, linkedEvernoteNoteId, linkedEvernoteNoteUrl,
              parentTaskId, isPinned, tags } = req.body;
      if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
      const result = await pool.query(
        `INSERT INTO user_tasks (user_id, title, description, due_date, priority, category, linked_deal_id, linked_property_id, linked_contact_id,
          linked_onenote_page_id, linked_onenote_page_url, linked_evernote_note_id, linked_evernote_note_url,
          parent_task_id, is_pinned, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [userId, title.trim(), description?.trim() || null, dueDate || null, priority || "medium", category || null,
         linkedDealId || null, linkedPropertyId || null, linkedContactId || null,
         linkedOnenotePageId || null, linkedOnenotePageUrl || null, linkedEvernoteNoteId || null, linkedEvernoteNoteUrl || null,
         parentTaskId || null, isPinned || false, tags || null]
      );
      res.json(result.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const taskId = req.params.id;
      const existing = await pool.query("SELECT * FROM user_tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Task not found" });

      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      const allowed = ["title", "description", "priority", "category", "status", "sortOrder",
        "linkedDealId", "linkedPropertyId", "linkedContactId",
        "linkedOnenotePageId", "linkedOnenotePageUrl", "linkedEvernoteNoteId", "linkedEvernoteNoteUrl",
        "parentTaskId", "isPinned", "tags"];
      const colMap: Record<string, string> = {
        title: "title", description: "description", priority: "priority", category: "category",
        status: "status", sortOrder: "sort_order", linkedDealId: "linked_deal_id",
        linkedPropertyId: "linked_property_id", linkedContactId: "linked_contact_id",
        linkedOnenotePageId: "linked_onenote_page_id", linkedOnenotePageUrl: "linked_onenote_page_url",
        linkedEvernoteNoteId: "linked_evernote_note_id", linkedEvernoteNoteUrl: "linked_evernote_note_url",
        parentTaskId: "parent_task_id", isPinned: "is_pinned", tags: "tags",
      };

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          fields.push(`${colMap[key]} = $${idx}`);
          values.push(req.body[key]);
          idx++;
        }
      }
      if (req.body.dueDate !== undefined) {
        fields.push(`due_date = $${idx}`);
        values.push(req.body.dueDate || null);
        idx++;
      }
      if (req.body.status === "done" && existing.rows[0].status !== "done") {
        fields.push(`completed_at = NOW()`);
      } else if (req.body.status && req.body.status !== "done") {
        fields.push(`completed_at = NULL`);
      }

      if (fields.length === 0) return res.json(existing.rows[0]);

      values.push(taskId, userId);
      const result = await pool.query(
        `UPDATE user_tasks SET ${fields.join(", ")} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
        values
      );
      res.json(result.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await pool.query("DELETE FROM user_tasks WHERE id = $1 AND user_id = $2", [req.params.id, userId]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tasks/reorder", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds)) return res.status(400).json({ error: "taskIds must be an array" });
      for (let i = 0; i < taskIds.length; i++) {
        await pool.query("UPDATE user_tasks SET sort_order = $1 WHERE id = $2 AND user_id = $3", [i, taskIds[i], userId]);
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/ai-briefing", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      // Read-through per-day cache: only the first open of the day generates
      // (or the 6am cron pre-generates it). ?refresh=1 forces a regenerate —
      // wired to the card's manual refresh button.
      const force = req.query.refresh === "1" || req.query.refresh === "true";
      // The briefing renders the user's PERSONAL calendar + inbox, so only
      // use a Microsoft token that genuinely belongs to this user. Without
      // this guard getValidMsToken's org-wide cache fallback would hand a
      // client (e.g. a Landsec login with no MS account) another user's
      // token — and their private diary with it.
      let msToken: string | null = null;
      try {
        const ownsMsIdentity = !!req.session.msTokens?.accessToken || (
          await pool.query("SELECT 1 FROM msal_token_cache WHERE user_id = $1 LIMIT 1", [userId])
        ).rows.length > 0;
        if (ownsMsIdentity) {
          const { getValidMsToken } = await import("./microsoft");
          msToken = await getValidMsToken(req);
        }
      } catch (e: any) { console.log("[ai-briefing] MS token fetch error:", e.message); }

      const { getOrCreateTodaysBriefing } = await import("./daily-briefing");
      const result = await getOrCreateTodaysBriefing(userId, msToken, { force });
      res.json(result);
    } catch (e: any) {
      console.error("[ai-briefing] Error:", e.message);
      // Missing/invalid AI credentials is an environment state, not a server
      // fault — return 503 with a clean message instead of a raw SDK error.
      if (/api ?key|authentication|authToken/i.test(e.message || "")) {
        return res.status(503).json({ error: "AI briefing unavailable — AI service is not configured" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/daily-digest", requireAuth, async (req: Request, res: Response) => {
    try {
    // External client logins get no org-wide feed — their world is the
    // client-scoped briefing. (Landsec audit.)
    if (await (await import("./company-scope")).isClientRequestUser(req)) return res.json([]);

      const alerts: any[] = [];

      const stuckDeals = await pool.query(
        `SELECT id, name, status, updated_at FROM crm_deals 
         WHERE status NOT IN ('COM', 'INV', 'WIT')
         AND updated_at < NOW() - INTERVAL '30 days'
         ORDER BY updated_at ASC LIMIT 10`
      );
      for (const d of stuckDeals.rows) {
        const ms = Date.now() - new Date(d.updated_at).getTime();
        const days = isNaN(ms) ? 30 : Math.floor(ms / 86400000);
        alerts.push({ type: "stuck_deal", severity: "warning", title: `Stuck deal: ${d.name}`, detail: `No update for ${days}+ days (status: ${d.status})`, entityId: d.id, entityType: "deal" });
      }

      const unmatchedReqs = await pool.query(
        `SELECT r.id, r.name, c.name as company_name FROM crm_requirements_leasing r
         LEFT JOIN crm_companies c ON r.company_id = c.id
         WHERE r.deal_id IS NULL AND r.under_offer = false
         ORDER BY r.created_at DESC LIMIT 10`
      );
      for (const r of unmatchedReqs.rows) {
        alerts.push({ type: "unmatched_requirement", severity: "info", title: `Open requirement: ${r.name}`, detail: `${r.company_name || "Unknown"} — no deal linked yet`, entityId: r.id, entityType: "requirement" });
      }

      const kycGaps = await pool.query(
        `SELECT id, name FROM crm_deals 
         WHERE kyc_approved = false 
         AND status IN ('SOLs', 'Exchanged', 'Completing')
         LIMIT 10`
      );
      for (const d of kycGaps.rows) {
        alerts.push({ type: "kyc_gap", severity: "critical", title: `KYC not approved: ${d.name}`, detail: "Deal is progressing but KYC has not been completed", entityId: d.id, entityType: "deal" });
      }

      const coolingContacts = await pool.query(
        `SELECT c.id, c.name, c.updated_at 
         FROM crm_contacts c 
         WHERE c.updated_at IS NOT NULL 
         AND c.updated_at < (NOW() - INTERVAL '90 days')
         AND EXISTS (SELECT 1 FROM crm_deals d WHERE d.tenant_id = c.company_id OR d.landlord_id = c.company_id)
         ORDER BY c.updated_at ASC LIMIT 10`
      );
      for (const c of coolingContacts.rows) {
        const ms = Date.now() - new Date(c.updated_at).getTime();
        const days = isNaN(ms) ? 90 : Math.floor(ms / 86400000);
        alerts.push({ type: "cooling_contact", severity: "warning", title: `Cooling relationship: ${c.name}`, detail: `No interaction for ${days}+ days`, entityId: c.id, entityType: "contact" });
      }

      res.json(alerts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Diagnostic: check OneNote token + scopes
  app.get("/api/tasks/onenote/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) {
        return res.json({ connected: false, error: "No Microsoft token — sign out and back in", hasSession: !!req.session?.msTokens });
      }
      // Decode JWT to check scopes (middle part is the payload)
      let scopes: string[] = [];
      try {
        const payload = JSON.parse(Buffer.from(msToken.split(".")[1], "base64").toString());
        scopes = (payload.scp || "").split(" ");
      } catch {}
      const hasNotes = scopes.some(s => s.toLowerCase().includes("notes"));
      // Test actual OneNote API call
      const testRes = await fetch("https://graph.microsoft.com/v1.0/me/onenote/notebooks?$top=1", {
        headers: { Authorization: `Bearer ${msToken}` }
      });
      const testBody = await testRes.text().catch(() => "");
      return res.json({
        connected: true,
        hasNotesScope: hasNotes,
        scopes,
        onenoteApiStatus: testRes.status,
        onenoteApiOk: testRes.ok,
        onenoteApiResponse: testBody.slice(0, 500),
      });
    } catch (e: any) {
      res.json({ connected: false, error: e.message });
    }
  });

  app.get("/api/tasks/import/onenote/notebooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) {
        return res.status(401).json({ error: "No Microsoft token available — please sign out and back in to reconnect Microsoft 365" });
      }
      const nbRes = await fetch("https://graph.microsoft.com/v1.0/me/onenote/notebooks?$select=id,displayName,lastModifiedDateTime&$orderby=lastModifiedDateTime desc&$top=20", {
        headers: { Authorization: `Bearer ${msToken}` }
      });
      if (!nbRes.ok) {
        const errText = await nbRes.text().catch(() => "");
        console.error("[onenote] API error:", nbRes.status, errText.slice(0, 500));
        if (nbRes.status === 401 || nbRes.status === 403) {
          return res.status(nbRes.status).json({ error: "OneNote access denied. Your Microsoft token may not include Notes permissions. Please sign out of BGP, then sign back in — you should see a consent prompt for OneNote access." });
        }
        return res.status(nbRes.status).json({ error: `OneNote API error (${nbRes.status}). ${errText.slice(0, 200)}` });
      }
      const data = await nbRes.json();
      const notebooks = (data.value || []).map((nb: any) => ({
        id: nb.id,
        name: nb.displayName,
        lastModified: nb.lastModifiedDateTime,
      }));
      res.json(notebooks);
    } catch (e: any) {
      console.error("[onenote] Error fetching notebooks:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/tasks/import/onenote/sections/:notebookId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ error: "No Microsoft token" });
      const secRes = await fetch(`https://graph.microsoft.com/v1.0/me/onenote/notebooks/${req.params.notebookId}/sections?$select=id,displayName`, {
        headers: { Authorization: `Bearer ${msToken}` }
      });
      if (!secRes.ok) return res.status(secRes.status).json({ error: "Failed to fetch sections" });
      const data = await secRes.json();
      res.json((data.value || []).map((s: any) => ({ id: s.id, name: s.displayName })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tasks/import/onenote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { sectionId, pageId } = req.body;
      if (!sectionId && !pageId) return res.status(400).json({ error: "sectionId or pageId required" });

      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ error: "No Microsoft token" });

      let pages: any[] = [];
      if (pageId) {
        pages = [{ id: pageId }];
      } else {
        const pagesRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages?$select=id,title,lastModifiedDateTime&$top=50&$orderby=lastModifiedDateTime desc`,
          { headers: { Authorization: `Bearer ${msToken}` } }
        );
        if (!pagesRes.ok) return res.status(pagesRes.status).json({ error: "Failed to fetch pages" });
        const pagesData = await pagesRes.json();
        pages = pagesData.value || [];
      }

      let imported = 0;
      for (const page of pages.slice(0, 30)) {
        try {
          const contentRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/onenote/pages/${page.id}/content`,
            { headers: { Authorization: `Bearer ${msToken}` } }
          );
          if (!contentRes.ok) continue;
          const html = await contentRes.text();
          const plainText = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .trim();

          const lines = plainText.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 2 && l.length < 200);
          const taskLines = lines.filter((l: string) =>
            /^[-\u2022*\u2610\u25A1\u25FB\u25CB]/.test(l) || /^(\d+[.)]\s)/.test(l) || /^\[[\sxX]\]/.test(l)
          );

          const linesToImport = taskLines.length > 0 ? taskLines : lines.slice(0, 10);
          const pageTitle = page.title || "OneNote";

          for (const line of linesToImport) {
            const cleanTitle = line.replace(/^[-\u2022*\u2610\u25A1\u25FB\u25CB[\]\s\d.]+/, "").trim();
            if (!cleanTitle || cleanTitle.length < 3) continue;
            const existing = await pool.query(
              "SELECT id FROM user_tasks WHERE user_id = $1 AND title = $2",
              [userId, cleanTitle]
            );
            if (existing.rows.length > 0) continue;
            await pool.query(
              `INSERT INTO user_tasks (user_id, title, description, priority, status, category) VALUES ($1, $2, $3, 'medium', 'todo', 'general')`,
              [userId, cleanTitle, `Imported from OneNote: ${pageTitle}`]
            );
            imported++;
          }
        } catch (pageErr: any) {
          console.error(`[onenote] Error processing page ${page.id}:`, pageErr.message);
        }
      }

      res.json({ imported, pagesScanned: pages.length });
    } catch (e: any) {
      console.error("[onenote] Import error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/tasks/import/evernote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "items array required (each with title, optional description)" });
      }

      let imported = 0;
      for (const item of items.slice(0, 50)) {
        const title = (item.title || "").trim();
        if (!title || title.length < 2) continue;
        const existing = await pool.query(
          "SELECT id FROM user_tasks WHERE user_id = $1 AND title = $2",
          [userId, title]
        );
        if (existing.rows.length > 0) continue;
        await pool.query(
          `INSERT INTO user_tasks (user_id, title, description, priority, status, category) VALUES ($1, $2, $3, 'medium', 'todo', 'general')`,
          [userId, title, item.description || "Imported from Evernote"]
        );
        imported++;
      }

      res.json({ imported, total: items.length });
    } catch (e: any) {
      console.error("[evernote] Import error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── OneNote: list pages in a section (for "link note" picker) ─────────────
  app.get("/api/tasks/onenote/pages/:sectionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ error: "No Microsoft token" });
      const pRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/onenote/sections/${req.params.sectionId}/pages?$select=id,title,links,lastModifiedDateTime&$top=50&$orderby=lastModifiedDateTime desc`,
        { headers: { Authorization: `Bearer ${msToken}` } }
      );
      if (!pRes.ok) return res.status(pRes.status).json({ error: "Failed to fetch pages" });
      const data = await pRes.json();
      res.json((data.value || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        webUrl: p.links?.oneNoteWebUrl?.href || null,
        lastModified: p.lastModifiedDateTime,
      })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── OneNote: link a page to a task ──────────────────────────────────────────
  app.post("/api/tasks/:id/link-onenote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { pageId, pageUrl } = req.body;
      if (!pageId) return res.status(400).json({ error: "pageId required" });
      const result = await pool.query(
        `UPDATE user_tasks SET linked_onenote_page_id = $1, linked_onenote_page_url = $2 WHERE id = $3 AND user_id = $4 RETURNING *`,
        [pageId, pageUrl || null, req.params.id, userId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Task not found" });
      res.json(result.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── OneNote: unlink a page from a task ──────────────────────────────────────
  app.delete("/api/tasks/:id/link-onenote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await pool.query(
        `UPDATE user_tasks SET linked_onenote_page_id = NULL, linked_onenote_page_url = NULL WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, userId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Task not found" });
      res.json(result.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── OneNote: export/push a task as a new OneNote page ───────────────────────
  app.post("/api/tasks/:id/export-onenote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { sectionId } = req.body;
      if (!sectionId) return res.status(400).json({ error: "sectionId required" });

      const task = await pool.query("SELECT * FROM user_tasks WHERE id = $1 AND user_id = $2", [req.params.id, userId]);
      if (!task.rows[0]) return res.status(404).json({ error: "Task not found" });
      const t = task.rows[0];

      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ error: "No Microsoft token" });

      const html = `<!DOCTYPE html><html><head><title>${t.title}</title></head><body>
<h1>${t.title}</h1>
<p><strong>Priority:</strong> ${t.priority} | <strong>Status:</strong> ${t.status}${t.due_date ? ` | <strong>Due:</strong> ${new Date(t.due_date).toLocaleDateString("en-GB")}` : ""}</p>
${t.description ? `<p>${t.description.replace(/\n/g, "<br/>")}</p>` : ""}
<p style="color:#888;font-size:12px;">Exported from BGP Tasks</p>
</body></html>`;

      const pageRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${msToken}`,
            "Content-Type": "application/xhtml+xml",
          },
          body: html,
        }
      );
      if (!pageRes.ok) {
        const err = await pageRes.text();
        console.error("[onenote-export]", err.slice(0, 300));
        return res.status(pageRes.status).json({ error: "Failed to create OneNote page" });
      }
      const page = await pageRes.json();
      const pageUrl = page.links?.oneNoteWebUrl?.href || null;

      await pool.query(
        `UPDATE user_tasks SET linked_onenote_page_id = $1, linked_onenote_page_url = $2 WHERE id = $3`,
        [page.id, pageUrl, req.params.id]
      );

      res.json({ pageId: page.id, pageUrl, title: page.title });
    } catch (e: any) {
      console.error("[onenote-export]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Evernote: link a note to a task ─────────────────────────────────────────
  app.post("/api/tasks/:id/link-evernote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { noteId, noteUrl } = req.body;
      if (!noteId) return res.status(400).json({ error: "noteId required" });
      const result = await pool.query(
        `UPDATE user_tasks SET linked_evernote_note_id = $1, linked_evernote_note_url = $2 WHERE id = $3 AND user_id = $4 RETURNING *`,
        [noteId, noteUrl || null, req.params.id, userId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Task not found" });
      res.json(result.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Evernote: unlink a note from a task ─────────────────────────────────────
  app.delete("/api/tasks/:id/link-evernote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await pool.query(
        `UPDATE user_tasks SET linked_evernote_note_id = NULL, linked_evernote_note_url = NULL WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, userId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Task not found" });
      res.json(result.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Evernote: export/push a task as a new Evernote note ─────────────────────
  app.post("/api/tasks/:id/export-evernote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { notebookId } = req.body;
      if (!notebookId) return res.status(400).json({ error: "notebookId required" });

      const task = await pool.query("SELECT * FROM user_tasks WHERE id = $1 AND user_id = $2", [req.params.id, userId]);
      if (!task.rows[0]) return res.status(404).json({ error: "Task not found" });
      const t = task.rows[0];

      const { evernoteApi } = await import("./evernote");
      const content = `Priority: ${t.priority} | Status: ${t.status}${t.due_date ? ` | Due: ${new Date(t.due_date).toLocaleDateString("en-GB")}` : ""}\n\n${t.description || ""}\n\nExported from BGP Tasks`;

      const note = await evernoteApi(req.session, `/v3/notebooks/${notebookId}/notes`, {
        method: "POST",
        body: JSON.stringify({ title: t.title, content }),
      });

      const noteId = note.id || note.guid;
      const noteUrl = note.webUrl || null;

      await pool.query(
        `UPDATE user_tasks SET linked_evernote_note_id = $1, linked_evernote_note_url = $2 WHERE id = $3`,
        [noteId, noteUrl, req.params.id]
      );

      res.json({ noteId, noteUrl, title: t.title });
    } catch (e: any) {
      console.error("[evernote-export]", e.message);
      if (e.message.includes("Not connected")) return res.status(401).json({ error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // === Landsec Portfolio Analytics ===
  app.get("/api/portfolio/landsec/analytics", requireAuth, async (req, res) => {
    try {
      // BGP staff or Landsec-scoped users only — this payload contains
      // Landsec fee totals + BGP per-agent splits, so other client teams
      // must not read it. (Landsec audit.)
      const scopeId = await resolveCompanyScope(req);
      if (scopeId) {
        const ls = await pool.query(
          `SELECT 1 FROM crm_companies WHERE id = $1 AND LOWER(name) = 'landsec' LIMIT 1`, [scopeId]);
        if (ls.rows.length === 0) return res.status(403).json({ error: "Not available for this account" });
      }
      // All deals where groupName contains "Landsec" (case-insensitive)
      const dealsResult = await pool.query(
        `SELECT id, name, group_name, deal_type, status, fee, internal_agent, created_at, updated_at
         FROM crm_deals
         WHERE group_name ILIKE '%Landsec%'
         ORDER BY COALESCE(updated_at, created_at) DESC`
      );
      const allDeals = dealsResult.rows;

      const totalDeals = allDeals.length;

      // Stage detection now uses canonical 10-code helper (legacy strings still mapped)
      const { legacyToCode } = await import("@shared/deal-status");
      const PIPELINE_STAGE_ORDER = ["REP", "SPEC", "LIVE", "AVA", "NEG", "SOL", "EXC", "COM", "INV"];

      let totalWIP = 0;
      let totalInvoiced = 0;
      let pipelineValue = 0;
      const byDealType: Record<string, { count: number; fees: number }> = {};
      const byStatus: Record<string, number> = {};
      const byAgent: Record<string, { count: number; fees: number }> = {};

      for (const deal of allDeals) {
        const fee = parseFloat(deal.fee) || 0;
        const status = (deal.status || "").trim();
        const code = legacyToCode(status);
        const dealType = deal.deal_type || "Other";

        // WIP vs Invoiced
        if (code === "INV") {
          totalInvoiced += fee;
        } else if (code !== "WIT") {
          totalWIP += fee;
        }

        // Pipeline value: anything still in lifecycle (not COM/INV/WIT)
        const isPreCompletion = code !== null && !["COM", "INV", "WIT"].includes(code);
        if (isPreCompletion) {
          pipelineValue += fee;
        }

        // By deal type
        if (!byDealType[dealType]) byDealType[dealType] = { count: 0, fees: 0 };
        byDealType[dealType].count += 1;
        byDealType[dealType].fees += fee;

        // By status
        byStatus[status || "Unknown"] = (byStatus[status || "Unknown"] || 0) + 1;

        // By agent (internal_agent is an array in the DB)
        const agents: string[] = Array.isArray(deal.internal_agent) ? deal.internal_agent : deal.internal_agent ? [deal.internal_agent] : [];
        for (const agent of agents) {
          const name = agent.trim();
          if (!name) continue;
          if (!byAgent[name]) byAgent[name] = { count: 0, fees: 0 };
          byAgent[name].count += 1;
          byAgent[name].fees += fee;
        }
      }

      // Recent activity: last 10 deals updated/created
      const recentActivity = allDeals.slice(0, 10).map(d => ({
        id: d.id,
        name: d.name,
        dealType: d.deal_type,
        status: d.status,
        fee: parseFloat(d.fee) || 0,
        agent: Array.isArray(d.internal_agent) ? d.internal_agent.join(", ") : d.internal_agent || "",
        updatedAt: d.updated_at || d.created_at,
      }));

      const totalFees = allDeals.reduce((s, d) => s + (parseFloat(d.fee) || 0), 0);
      const averageDealSize = totalDeals > 0 ? totalFees / totalDeals : 0;

      // Client logins may see their own portfolio shape but not BGP's fee
      // take or per-agent commission attribution. (Landsec audit.)
      const analyticsClient = await (await import("./company-scope")).isClientRequestUser(req);
      res.json({
        totalDeals,
        totalWIP: analyticsClient ? undefined : totalWIP,
        totalInvoiced: analyticsClient ? undefined : totalInvoiced,
        byDealType: analyticsClient
          ? Object.fromEntries(Object.entries(byDealType).map(([k, v]: [string, any]) => [k, { count: v.count }]))
          : byDealType,
        byStatus,
        byAgent: analyticsClient ? {} : byAgent,
        recentActivity: analyticsClient
          ? recentActivity.map(({ fee, agent, ...rest }) => rest)
          : recentActivity,
        pipelineValue: analyticsClient ? undefined : pipelineValue,
        averageDealSize: analyticsClient ? undefined : averageDealSize,
      });
    } catch (err: any) {
      console.error("[landsec-analytics] Error:", err?.message);
      res.status(500).json({ message: "Failed to fetch Landsec analytics" });
    }
  });

  // ===== Dashboard KPI Trends =====
  app.get("/api/dashboard/kpi-trends", requireAuth, async (req: Request, res: Response) => {
    try {
      // Firm-wide fee KPIs are BGP-internal. (Landsec audit.)
      if (await (await import("./company-scope")).isClientRequestUser(req)) return res.status(403).json({ error: "Not available for client accounts" });

      // Deals per month (last 6 months)
      const dealsPerMonthResult = await pool.query(`
        SELECT
          to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
          COUNT(*)::int as count,
          COALESCE(SUM(fee), 0)::float as total_fees
        FROM crm_deals
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY date_trunc('month', created_at)
        ORDER BY date_trunc('month', created_at) ASC
      `);

      // Properties per month (last 6 months)
      const propertiesPerMonthResult = await pool.query(`
        SELECT
          to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
          COUNT(*)::int as count
        FROM crm_properties
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY date_trunc('month', created_at)
        ORDER BY date_trunc('month', created_at) ASC
      `);

      // Contacts per month (last 6 months)
      const contactsPerMonthResult = await pool.query(`
        SELECT
          to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
          COUNT(*)::int as count
        FROM crm_contacts
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY date_trunc('month', created_at)
        ORDER BY date_trunc('month', created_at) ASC
      `);

      // Build 6-month arrays filling gaps with zero
      const months: string[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        months.push(d.toISOString().slice(0, 7));
      }

      const dealMap = new Map(dealsPerMonthResult.rows.map((r: any) => [r.month, { count: r.count, fees: r.total_fees }]));
      const propMap = new Map(propertiesPerMonthResult.rows.map((r: any) => [r.month, r.count]));
      const contactMap = new Map(contactsPerMonthResult.rows.map((r: any) => [r.month, r.count]));

      const dealsPerMonth = months.map(m => (dealMap.get(m) as any)?.count || 0);
      const feesPerMonth = months.map(m => (dealMap.get(m) as any)?.fees || 0);
      const propertiesPerMonth = months.map(m => propMap.get(m) || 0);
      const contactsPerMonth = months.map(m => contactMap.get(m) || 0);

      // Current totals
      const totalsResult = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM crm_deals) as total_deals,
          (SELECT COALESCE(SUM(fee), 0)::float FROM crm_deals) as total_fees,
          (SELECT COUNT(*)::int FROM crm_properties) as total_properties,
          (SELECT COUNT(*)::int FROM crm_contacts) as total_contacts
      `);
      const totals = totalsResult.rows[0];

      const calcChange = (arr: number[]) => {
        const curr = arr[arr.length - 1] || 0;
        const prev = arr[arr.length - 2] || 0;
        if (prev === 0) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 100);
      };

      res.json({
        months,
        dealsPerMonth,
        feesPerMonth,
        propertiesPerMonth,
        contactsPerMonth,
        totalDeals: totals.total_deals,
        totalFees: totals.total_fees,
        totalProperties: totals.total_properties,
        totalContacts: totals.total_contacts,
        dealsChange: calcChange(dealsPerMonth),
        feesChange: calcChange(feesPerMonth),
        propertiesChange: calcChange(propertiesPerMonth),
        contactsChange: calcChange(contactsPerMonth),
      });
    } catch (e: any) {
      console.error("[kpi-trends] Error:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ===== Notifications Center =====
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
    // External client logins get no org-wide feed — their world is the
    // client-scoped briefing. (Landsec audit.)
    if (await (await import("./company-scope")).isClientRequestUser(req)) return res.json([]);

      const notifications: any[] = [];

      // Deals stuck in same status > 30 days
      const stuckDeals = await pool.query(`
        SELECT id, name, status, updated_at FROM crm_deals
        WHERE status NOT IN ('COM', 'INV', 'WIT')
        AND updated_at < NOW() - INTERVAL '30 days'
        ORDER BY updated_at ASC LIMIT 20
      `);
      for (const d of stuckDeals.rows) {
        const ms = Date.now() - new Date(d.updated_at).getTime();
        const days = isNaN(ms) ? 30 : Math.floor(ms / 86400000);
        notifications.push({
          id: `stuck-${d.id}`,
          type: "stuck_deal",
          title: `${d.name} stuck in ${d.status || "Unknown"}`,
          description: `No update for ${days} days`,
          severity: days > 60 ? "urgent" : "warning",
          createdAt: d.updated_at,
          dealId: d.id,
        });
      }

      // Deals without fee allocated
      const noFeeResult = await pool.query(`
        SELECT COUNT(*)::int as count FROM crm_deals
        WHERE (fee IS NULL OR fee = 0)
        AND status NOT IN ('WIT', 'COM', 'INV')
      `);
      const noFeeCount = noFeeResult.rows[0]?.count || 0;
      if (noFeeCount > 0) {
        notifications.push({
          id: "no-fee-deals",
          type: "no_fee",
          title: `${noFeeCount} deal${noFeeCount !== 1 ? "s" : ""} with no fee set`,
          description: "Active deals without fee allocation need attention",
          severity: noFeeCount > 10 ? "urgent" : "warning",
          createdAt: new Date().toISOString(),
        });
      }

      // KYC not approved on progressing deals
      const kycGaps = await pool.query(`
        SELECT id, name, status FROM crm_deals
        WHERE kyc_approved = false
        AND status IN ('SOL', 'EXC', 'COM', 'NEG')
        LIMIT 10
      `);
      for (const d of kycGaps.rows) {
        notifications.push({
          id: `kyc-${d.id}`,
          type: "kyc_gap",
          title: `KYC not approved: ${d.name}`,
          description: `Deal in ${d.status} without KYC clearance`,
          severity: "urgent",
          createdAt: new Date().toISOString(),
          dealId: d.id,
        });
      }

      // Deals with stale target dates (overdue)
      const overdueDeals = await pool.query(`
        SELECT id, name, target_date, status FROM crm_deals
        WHERE target_date IS NOT NULL
        AND target_date < CURRENT_DATE
        AND status NOT IN ('COM', 'INV', 'WIT')
        AND exchanged_at IS NULL
        AND completed_at IS NULL
        ORDER BY target_date ASC
        LIMIT 10
      `);
      for (const d of overdueDeals.rows) {
        const targetStr = d.target_date ? new Date(d.target_date).toLocaleDateString("en-GB") : "";
        notifications.push({
          id: `overdue-${d.id}`,
          type: "overdue_completion",
          title: `Overdue target: ${d.name}`,
          description: `Target date ${targetStr} has passed`,
          severity: "warning",
          createdAt: d.target_date,
          dealId: d.id,
        });
      }

      // Sort: urgent first, then warning, then info
      const severityOrder: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
      notifications.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

      res.json(notifications);
    } catch (e: any) {
      console.error("[notifications] Error:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tenant Rep Status Board ─────────────────────────────────────────────
  app.get("/api/tenant-rep/searches", requireAuth, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT
          s.*,
          c.name AS company_name,
          c.domain AS company_domain,
          c.rollout_status,
          c.store_count,
          co.name AS contact_name,
          co.email AS contact_email,
          co.phone AS contact_phone,
          co.role AS contact_role,
          d.name AS deal_name
        FROM tenant_rep_searches s
        LEFT JOIN crm_companies c ON c.id = s.company_id
        LEFT JOIN crm_contacts co ON co.id = s.contact_id
        LEFT JOIN crm_deals d ON d.id = s.deal_id
        ORDER BY s.created_at DESC
      `);
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/tenant-rep/searches", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        clientName, companyId, contactId, dealId, status,
        targetUse, sizeMin, sizeMax, targetLocations,
        budgetMin, budgetMax, nextAction, nextActionDate, notes, assignedTo,
      } = req.body;
      const result = await pool.query(
        `INSERT INTO tenant_rep_searches
          (client_name, company_id, contact_id, deal_id, status,
           target_use, size_min, size_max, target_locations,
           budget_min, budget_max, next_action, next_action_date, notes, assigned_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          clientName, companyId || null, contactId || null, dealId || null,
          status || "Brief Received",
          targetUse || null, sizeMin || null, sizeMax || null,
          targetLocations || null, budgetMin || null, budgetMax || null,
          nextAction || null, nextActionDate || null, notes || null, assignedTo || null,
        ]
      );
      res.json(result.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/tenant-rep/searches/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const keyMap: Record<string, string> = {
        clientName: "client_name", companyId: "company_id", contactId: "contact_id",
        dealId: "deal_id", status: "status", notes: "notes",
        targetUse: "target_use", sizeMin: "size_min", sizeMax: "size_max",
        targetLocations: "target_locations", budgetMin: "budget_min", budgetMax: "budget_max",
        nextAction: "next_action", nextActionDate: "next_action_date", assignedTo: "assigned_to",
      };
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [camel, col] of Object.entries(keyMap)) {
        if (camel in req.body) { updates.push(`${col} = $${idx++}`); values.push(req.body[camel]); }
      }
      if (!updates.length) return res.json({ ok: true });
      updates.push(`updated_at = now()`);
      values.push(id);
      const result = await pool.query(
        `UPDATE tenant_rep_searches SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      res.json(result.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/tenant-rep/searches/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await pool.query("DELETE FROM tenant_rep_searches WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── ONS Inflation data (RPI + CPI annual averages) ───────────────────────
  // Fetches from ONS public API and caches for 12 hours so the RPI/CPI
  // calculator in comps always shows the latest published annual rates.
  // Falls back to hardcoded data if ONS API is unreachable.
  const INFLATION_FALLBACK = [
    { year: 2015, rpi: 1.0, cpi: 0.0 }, { year: 2016, rpi: 1.8, cpi: 0.7 },
    { year: 2017, rpi: 3.6, cpi: 2.7 }, { year: 2018, rpi: 3.3, cpi: 2.5 },
    { year: 2019, rpi: 2.6, cpi: 1.8 }, { year: 2020, rpi: 1.5, cpi: 0.9 },
    { year: 2021, rpi: 4.1, cpi: 2.6 }, { year: 2022, rpi: 11.6, cpi: 9.1 },
    { year: 2023, rpi: 9.7, cpi: 7.3 }, { year: 2024, rpi: 3.6, cpi: 2.5 },
    { year: 2025, rpi: 4.0, cpi: 2.6 },
  ];
  let inflationCache: { data: typeof INFLATION_FALLBACK; fetchedAt: number } | null = null;

  async function fetchOnsAnnualRates(): Promise<typeof INFLATION_FALLBACK> {
    // ONS mm23 dataset: D7BT = RPI 12-month rate, D7G7 = CPI 12-month rate
    const [rpiRes, cpiRes] = await Promise.all([
      fetch("https://api.ons.gov.uk/v1/datasets/mm23/timeseries/chaw/data"),
      fetch("https://api.ons.gov.uk/v1/datasets/mm23/timeseries/d7g7/data"),
    ]);
    if (!rpiRes.ok || !cpiRes.ok) throw new Error("ONS API unavailable");
    const [rpiJson, cpiJson]: any[] = await Promise.all([rpiRes.json(), cpiRes.json()]);

    // ONS returns annual data as array of { year, value }
    const rpiByYear = new Map<number, number>();
    for (const row of rpiJson.years || []) {
      const yr = parseInt(row.year); const val = parseFloat(row.value);
      if (!isNaN(yr) && !isNaN(val)) rpiByYear.set(yr, val);
    }
    const result: typeof INFLATION_FALLBACK = [];
    for (const row of cpiJson.years || []) {
      const yr = parseInt(row.year); const cpi = parseFloat(row.value);
      if (!isNaN(yr) && !isNaN(cpi) && yr >= 2015) {
        result.push({ year: yr, rpi: rpiByYear.get(yr) ?? cpi + 1.2, cpi });
      }
    }
    return result.sort((a, b) => a.year - b.year);
  }

  app.get("/api/inflation-data", requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      if (!inflationCache || now - inflationCache.fetchedAt > 12 * 3600 * 1000) {
        try {
          const fresh = await fetchOnsAnnualRates();
          if (fresh.length > 0) inflationCache = { data: fresh, fetchedAt: now };
        } catch {
          // ONS unreachable — use or keep cached/fallback data
        }
      }
      res.json({ data: inflationCache?.data ?? INFLATION_FALLBACK, source: inflationCache ? "ons" : "fallback" });
    } catch (e: any) {
      res.json({ data: INFLATION_FALLBACK, source: "fallback" });
    }
  });

  registerIngestRoutes(app);
  registerGenericCrmRoutes(app);
  setupStripeIssuingRoutes(app);
  registerExpenseAutoClassifyRoutes(app);
  registerMapAnnotationsRoutes(app);
  setupRevolutRoutes(app);
  setupRefreshImageRoutes(app);
  setupHrRoutes(app);
  setupWhyBuyDesignRoutes(app);
  setupDocumentPreferencesRoutes(app);
  setupDeckRoutes(app);
  setupDocumentRoutes(app);

  return httpServer;
}

