import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { requireAuth, getUserIdFromToken } from "./auth";
import { resolveCompanyScope } from "./company-scope";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { saveFile, getFile } from "./file-storage";
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
import { importTrlRequirement } from "./trl";
import { searchPipnetRequirements, searchPipnetProperties, importPipnetRequirements } from "./pipnet";
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
  limits: { fileSize: 25 * 1024 * 1024 },
});

const GROUP_CHAT_TOOLS = [
  "search_crm", "search_news", "query_wip", "create_deal", "update_deal",
  "create_contact", "update_contact", "create_company", "update_company",
  "create_property", "create_available_unit", "update_available_unit",
  "update_investment_tracker", "create_investment_tracker",
  "log_viewing", "log_offer", "create_requirement", "create_diary_entry",
  "delete_record", "web_search", "ingest_url", "property_lookup", "property_data_lookup",
  "tfl_nearby", "search_green_street", "query_xero", "scan_duplicates",
  "navigate_to", "send_email",
];

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

    const groupTools = (allTools as any).tools?.filter((t: any) =>
      GROUP_CHAT_TOOLS.includes(t.function?.name)
    ) || [];

    const lastUserMsg = recentMessages.filter(m => m.role === "user").pop()?.content || "";
    const mentionsChatBGP = /chat\s*bgp|@chat\s*bgp|@chat\b/i.test(lastUserMsg);

    const groupSystemPrompt = systemPrompt + learnings + calendarContext +
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
      (mentionsChatBGP
        ? `9. The user mentioned you by name — you MUST respond. Do NOT skip.`
        : `9. Only respond with exactly __SKIP__ if the conversation is clearly a private side-conversation between team members that has nothing to do with work, property, or anything you could help with. When in doubt, respond — it's better to be helpful than silent.`);

    console.log(`[ai-group] Prepared in ${Date.now() - startTime}ms (${groupTools.length} tools, mention=${mentionsChatBGP})`);

    const completionOptions: any = {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: groupSystemPrompt },
        ...recentMessages,
      ],
      max_completion_tokens: 2048,
      tools: groupTools.length > 0 ? groupTools : undefined,
    };

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI response timed out")), TIMEOUT_MS)
    );
    let claudeResponse = await Promise.race([callClaude(completionOptions), timeoutPromise]) as any;
    let currentMessage = claudeResponse.choices?.[0]?.message;
    let loopCount = 0;
    const maxLoops = 5;

    while (currentMessage?.tool_calls && currentMessage.tool_calls.length > 0 && loopCount < maxLoops) {
      loopCount++;
      const toolCall = currentMessage.tool_calls[0];
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments || "{}");

      try {
        const result = await chatbgp.handleCrmToolCall(fnName, fnArgs, req, completionOptions, currentMessage, toolCall);
        if (result?.handled && result.response) {
          const replyText = result.response.reply;
          if (replyText && replyText.trim() !== "__SKIP__") {
            const saved = await storage.createChatMessage({
              threadId,
              role: "assistant",
              content: replyText,
              userId: null,
              actionData: result.response.action ? JSON.stringify(result.response.action) : null,
              attachments: null,
            });
            emitNewMessage(threadId, saved, "ChatBGP");
          }
          if (io) io.to(`thread:${threadId}`).emit("stop_typing", { threadId, userId: "__chatbgp__" });
          console.log(`[ai-group] Responded in ${Date.now() - startTime}ms (${loopCount} tool calls)`);
          return;
        }

        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: "Tool not handled" }) });
        claudeResponse = await Promise.race([callClaude(completionOptions), timeoutPromise]) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
      } catch (toolErr: any) {
        console.error("[ai-group] Tool call error:", toolErr?.message);
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }) });
        claudeResponse = await Promise.race([callClaude(completionOptions), timeoutPromise]) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
      }
    }

    if (io) io.to(`thread:${threadId}`).emit("stop_typing", { threadId, userId: "__chatbgp__" });

    let replyText = currentMessage?.content;
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
      actionData: null,
      attachments: null,
    });
    emitNewMessage(threadId, saved, "ChatBGP");
    console.log(`[ai-group] Responded in ${Date.now() - startTime}ms`);
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

  const { registerIntegrationsStatusRoutes } = await import("./integrations-status");
  registerIntegrationsStatusRoutes(app);

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
      const filename = req.params.filename;
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
        res.set("Content-Disposition", `attachment; filename="${dlName}"`);
      }
      res.send(file.data);
    } catch (err: any) { console.error("[routes] File download error:", err?.message); res.status(500).end(); }
  });

  app.post("/api/chat/upload", requireAuth, chatMediaUpload.array("files", 10), async (req: Request, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }
      const uploaded = await Promise.all(files.map(async (f) => {
        const ext = path.extname(f.originalname).toLowerCase();
        const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
        await saveFile(`chat-media/${uniqueName}`, f.buffer, f.mimetype, f.originalname);
        return {
          url: `/api/chat-media/${uniqueName}`,
          name: f.originalname,
          size: f.size,
          type: f.mimetype,
        };
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGPDashboard/1.0)" },
        redirect: "follow",
      });
      clearTimeout(timeout);
      const finalUrl = resp.url || url;
      try {
        const finalHostname = new URL(finalUrl).hostname.toLowerCase();
        if (blockedPatterns.some(p => p.test(finalHostname))) {
          return res.status(400).json({ message: "URL not allowed" });
        }
      } catch {}
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

  app.get("/api/users", requireAuth, async (_req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
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
      const filename = req.params.filename;
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
      const result = await pool.query(
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

  app.patch("/api/team-members/:id/team", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { team } = req.body;
      if (!team || typeof team !== "string") {
        return res.status(400).json({ message: "Team is required" });
      }
      const validTeams = ["London Leasing", "National Leasing", "Investment", "Tenant Rep", "Development", "Lease Advisory", "Office / Corporate", "Landsec"];
      if (!validTeams.includes(team)) {
        return res.status(400).json({ message: "Invalid team" });
      }
      await db.update(users).set({ team }).where(eq(users.id, id as string));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update team" });
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
      const { threadId, messageId } = req.params;
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
      const { threadId, messageId } = req.params;
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
      const { location, minSize, maxSize, client, documentDate, allPages } = req.body;
      const result = await importPipnetRequirements({ location, minSize, maxSize, client, documentDate, allPages });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "PIPnet import failed" });
    }
  });

  app.delete("/api/external-requirements/:id", requireAuth, async (req, res) => {
    try {
      await db
        .delete(externalRequirements)
        .where(eq(externalRequirements.id, req.params.id));
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
        .where(eq(externalRequirements.id, req.params.id))
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
      const { id } = req.params;
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
      if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ message: "Invalid id" });
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
      if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ message: "Invalid id" });
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
      if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ message: "Invalid id" });
      const id = Number(req.params.id);
      await db.delete(chatbgpLearnings).where(eq(chatbgpLearnings.id, id));
      invalidateContextCache("businessLearnings");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/available-units", requireAuth, async (req, res) => {
    try {
      const { availableUnits, crmProperties } = await import("@shared/schema");
      const conditions: any[] = [];
      if (req.query.propertyId) conditions.push(eq(availableUnits.propertyId, req.query.propertyId as string));
      if (req.query.marketingStatus) conditions.push(eq(availableUnits.marketingStatus, req.query.marketingStatus as string));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await db
        .select({
          id: availableUnits.id,
          propertyId: availableUnits.propertyId,
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
          epcRating: availableUnits.epcRating,
          notes: availableUnits.notes,
          restrictions: availableUnits.restrictions,
          fee: availableUnits.fee,
          dealId: availableUnits.dealId,
          agentUserIds: availableUnits.agentUserIds,
          viewingsCount: availableUnits.viewingsCount,
          lastViewingDate: availableUnits.lastViewingDate,
          marketingStartDate: availableUnits.marketingStartDate,
          createdAt: availableUnits.createdAt,
          updatedAt: availableUnits.updatedAt,
          propertyName: crmProperties.name,
          propertyAddress: crmProperties.address,
        })
        .from(availableUnits)
        .leftJoin(crmProperties, eq(availableUnits.propertyId, crmProperties.id))
        .where(where)
        .orderBy(desc(availableUnits.createdAt));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch available units" });
    }
  });

  app.get("/api/available-units/all-files", requireAuth, async (req, res) => {
    try {
      const { unitMarketingFiles, availableUnits } = await import("@shared/schema");
      const rows = await db
        .select({
          id: unitMarketingFiles.id,
          unitId: unitMarketingFiles.unitId,
          fileName: unitMarketingFiles.fileName,
          filePath: unitMarketingFiles.filePath,
          fileType: unitMarketingFiles.fileType,
          fileSize: unitMarketingFiles.fileSize,
          mimeType: unitMarketingFiles.mimeType,
          createdAt: unitMarketingFiles.createdAt,
          unitName: availableUnits.unitName,
          propertyId: availableUnits.propertyId,
        })
        .from(unitMarketingFiles)
        .leftJoin(availableUnits, eq(unitMarketingFiles.unitId, availableUnits.id))
        .orderBy(unitMarketingFiles.createdAt);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch all files" });
    }
  });

  app.get("/api/available-units/all-viewings-counts", requireAuth, async (req, res) => {
    try {
      const rows = await db.execute(sql`SELECT unit_id, COUNT(*)::int as count FROM unit_viewings GROUP BY unit_id`);
      const counts: Record<string, number> = {};
      for (const r of rows.rows as any[]) counts[r.unit_id] = r.count;
      res.json(counts);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/all-offers-counts", requireAuth, async (req, res) => {
    try {
      const rows = await db.execute(sql`SELECT unit_id, COUNT(*)::int as count FROM unit_offers GROUP BY unit_id`);
      const counts: Record<string, number> = {};
      for (const r of rows.rows as any[]) counts[r.unit_id] = r.count;
      res.json(counts);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/all-viewings", requireAuth, async (req, res) => {
    try {
      const { unitViewings } = await import("@shared/schema");
      const rows = await db.select().from(unitViewings).orderBy(unitViewings.viewingDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/all-offers", requireAuth, async (req, res) => {
    try {
      const { unitOffers } = await import("@shared/schema");
      const rows = await db.select().from(unitOffers).orderBy(unitOffers.offerDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed" });
    }
  });

  app.get("/api/available-units/:id", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      res.json(unit);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch unit" });
    }
  });

  app.post("/api/available-units", requireAuth, async (req, res) => {
    try {
      const { insertAvailableUnitSchema } = await import("@shared/schema");
      const parsed = insertAvailableUnitSchema.parse(req.body);
      const unit = await storage.createAvailableUnit(parsed);
      res.json(unit);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to create unit" });
    }
  });

  app.patch("/api/available-units/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getAvailableUnit(req.params.id);
      if (!existing) return res.status(404).json({ message: "Unit not found" });
      const { insertAvailableUnitSchema } = await import("@shared/schema");
      const partial = insertAvailableUnitSchema.partial().parse(req.body);
      const unit = await storage.updateAvailableUnit(req.params.id, partial);
      res.json(unit);
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      res.status(500).json({ message: err?.message || "Failed to update unit" });
    }
  });

  app.delete("/api/available-units/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteAvailableUnit(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete unit" });
    }
  });

  app.post("/api/available-units/migrate-letting-deals", requireAuth, async (req, res) => {
    try {
      const { crmDeals, availableUnits } = await import("@shared/schema");
      const NEGOTIATION_STATUSES = ["Under Negotiation", "HOTs", "NEG"];
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

  app.post("/api/available-units/:id/link-deal", requireAuth, async (req, res) => {
    try {
      const { dealId } = req.body;
      if (!dealId) return res.status(400).json({ message: "dealId is required" });
      const existing = await storage.getAvailableUnit(req.params.id);
      if (!existing) return res.status(404).json({ message: "Unit not found" });
      const deal = await storage.getCrmDeal(dealId);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const unit = await storage.updateAvailableUnit(req.params.id, { dealId });
      res.json(unit);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to link deal" });
    }
  });

  app.post("/api/available-units/:id/create-deal", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      const property = await storage.getCrmProperty(unit.propertyId);
      const body = req.body || {};
      const deal = await storage.createCrmDeal({
        name: `${property?.name || "Property"} - ${unit.unitName}`,
        propertyId: unit.propertyId,
        status: "Under Offer",
        dealType: body.dealType || "Letting",
        groupName: "Leasing - Active",
        team: body.team || [],
        internalAgent: body.agent ? [body.agent] : [],
        fee: body.fee ? parseFloat(body.fee) : (unit.fee || undefined),
        feeAgreement: body.feeAgreement || undefined,
        rentPa: body.askingRent ? parseFloat(body.askingRent) : (unit.askingRent || undefined),
        totalAreaSqft: body.totalAreaSqft ? parseFloat(body.totalAreaSqft) : (unit.sqft || undefined),
        leaseLength: body.leaseLength ? parseFloat(body.leaseLength) : undefined,
        rentFree: body.rentFree ? parseFloat(body.rentFree) : undefined,
        comments: body.comments || undefined,
      });
      if (body.tenantName) {
        try {
          const { crmContacts } = await import("@shared/schema");
          const existing = await db.select().from(crmContacts).where(sql`LOWER(name) = LOWER(${body.tenantName})`).limit(1);
          if (existing.length > 0) {
            await storage.updateCrmDeal(deal.id, { tenantId: existing[0].id });
          }
        } catch (_) {}
      }
      await storage.updateAvailableUnit(req.params.id, { dealId: deal.id, marketingStatus: "Under Offer" });
      res.json({ deal, unit: { ...unit, dealId: deal.id, marketingStatus: "Under Offer" } });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to create deal" });
    }
  });

  app.get("/api/available-units/:id/files", requireAuth, async (req, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
      const { unitMarketingFiles } = await import("@shared/schema");
      const files = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.unitId, req.params.id)).orderBy(unitMarketingFiles.createdAt);
      res.json(files);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch files" });
    }
  });

  app.post("/api/available-units/:id/files", requireAuth, marketingUpload.single("file"), async (req: any, res) => {
    try {
      const unit = await storage.getAvailableUnit(req.params.id);
      if (!unit) return res.status(404).json({ message: "Unit not found" });
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
      res.json(file);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to upload file" });
    }
  });

  app.delete("/api/available-units/files/:fileId", requireAuth, async (req, res) => {
    try {
      const { unitMarketingFiles } = await import("@shared/schema");
      const [file] = await db.select().from(unitMarketingFiles).where(eq(unitMarketingFiles.id, req.params.fileId));
      if (!file) return res.status(404).json({ message: "File not found" });
      const fileName = file.filePath.split("/").pop();
      if (fileName) {
        const { deleteFile } = await import("./file-storage");
        await deleteFile(`marketing-files/${fileName}`);
      }
      const fullPath = path.join(process.cwd(), file.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await db.delete(unitMarketingFiles).where(eq(unitMarketingFiles.id, req.params.fileId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete file" });
    }
  });

  // --- Unit Viewings ---
  app.get("/api/available-units/:id/viewings", requireAuth, async (req, res) => {
    try {
      const { unitViewings } = await import("@shared/schema");
      const rows = await db.select().from(unitViewings).where(eq(unitViewings.unitId, req.params.id)).orderBy(unitViewings.viewingDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch viewings" });
    }
  });

  app.post("/api/available-units/:id/viewings", requireAuth, async (req, res) => {
    try {
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
      await db.delete(unitViewings).where(eq(unitViewings.id, req.params.viewingId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete viewing" });
    }
  });

  // --- Unit Offers ---
  app.get("/api/available-units/:id/offers", requireAuth, async (req, res) => {
    try {
      const { unitOffers } = await import("@shared/schema");
      const rows = await db.select().from(unitOffers).where(eq(unitOffers.unitId, req.params.id)).orderBy(unitOffers.offerDate);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch offers" });
    }
  });

  app.post("/api/available-units/:id/offers", requireAuth, async (req, res) => {
    try {
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
      await db.delete(unitOffers).where(eq(unitOffers.id, req.params.offerId));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete offer" });
    }
  });

  app.get("/uploads/marketing-files/:filename", requireAuth, async (req, res) => {
    try {
      const sanitized = path.basename(req.params.filename);
      const file = await getFile(`marketing-files/${sanitized}`);
      if (!file) {
        const diskPath = path.join(MARKETING_FILES_DIR, sanitized);
        if (fs.existsSync(diskPath)) return res.sendFile(diskPath);
        return res.status(404).json({ message: "File not found" });
      }
      const ext = path.extname(sanitized).toLowerCase();
      const viewable = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp"];
      if (req.query.view === "1" && viewable.includes(ext)) {
        res.setHeader("Content-Disposition", `inline; filename="${file.originalName || sanitized}"`);
      } else {
        res.setHeader("Content-Disposition", `attachment; filename="${file.originalName || sanitized}"`);
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
      const rows = await db.select().from(investmentMarketingFiles).where(eq(investmentMarketingFiles.trackerId, req.params.trackerId)).orderBy(desc(investmentMarketingFiles.createdAt));
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
      const [file] = await db.select().from(investmentMarketingFiles).where(eq(investmentMarketingFiles.id, req.params.id));
      if (file?.filePath) {
        const { deleteFile } = await import("./file-storage");
        await deleteFile(file.filePath);
      }
      await db.delete(investmentMarketingFiles).where(eq(investmentMarketingFiles.id, req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-marketing-files/:id/download", requireAuth, async (req, res) => {
    try {
      const [file] = await db.select().from(investmentMarketingFiles).where(eq(investmentMarketingFiles.id, req.params.id));
      if (!file) return res.status(404).json({ message: "Not found" });
      const stored = await getFile(file.filePath);
      if (!stored) {
        if (fs.existsSync(file.filePath)) return res.download(file.filePath, file.fileName);
        return res.status(404).json({ message: "File not found" });
      }
      res.set("Content-Type", stored.contentType);
      res.set("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.send(stored.data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/investment-tracker/:id", requireAuth, async (req, res) => {
    try {
      const [row] = await db.select().from(investmentTracker).where(eq(investmentTracker.id, req.params.id));
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
        "address", "notes", "dealId", "agentUserIds", "fee", "feeType", "marketingDate", "bidDeadline",
      ]);
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.has(key)) updates[key] = value;
      }

      const row = await db.transaction(async (tx) => {
        const [updated] = await tx.update(investmentTracker).set(updates).where(eq(investmentTracker.id, req.params.id)).returning();
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
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/investment-tracker/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentTracker).where(eq(investmentTracker.id, req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker/:id/link-deal", requireAuth, async (req, res) => {
    try {
      const { dealId } = req.body;
      const [row] = await db.update(investmentTracker).set({ dealId, updatedAt: new Date() }).where(eq(investmentTracker.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker/:id/unlink-deal", requireAuth, async (req, res) => {
    try {
      const [row] = await db.update(investmentTracker).set({ dealId: null, updatedAt: new Date() }).where(eq(investmentTracker.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/investment-tracker/:id/create-deal", requireAuth, async (req, res) => {
    try {
      const [item] = await db.select().from(investmentTracker).where(eq(investmentTracker.id, req.params.id));
      if (!item) return res.status(404).json({ message: "Not found" });
      const property = item.propertyId ? await storage.getCrmProperty(item.propertyId) : null;
      const deal = await storage.createCrmDeal({
        name: item.assetName || property?.name || "Investment Deal",
        propertyId: item.propertyId || undefined,
        status: "Under Offer",
        dealType: (item.boardType === "Sales") ? "Sale" : "Acquisition",
        groupName: "Investment - Active",
        team: ["Investment"],
        fee: item.fee || undefined,
      });
      await db.update(investmentTracker).set({ dealId: deal.id, updatedAt: new Date() }).where(eq(investmentTracker.id, req.params.id));
      res.json(deal);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // --- Investment Viewings ---
  app.get("/api/investment-tracker/:trackerId/viewings", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentViewings).where(eq(investmentViewings.trackerId, req.params.trackerId)).orderBy(desc(investmentViewings.viewingDate));
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
      const [row] = await db.update(investmentViewings).set({ ...allowed, updatedAt: new Date() }).where(eq(investmentViewings.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/investment-viewings/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentViewings).where(eq(investmentViewings.id, req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // --- Investment Offers ---
  app.get("/api/investment-tracker/:trackerId/offers", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentOffers).where(eq(investmentOffers.trackerId, req.params.trackerId)).orderBy(desc(investmentOffers.offerDate));
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
      const [row] = await db.update(investmentOffers).set({ ...allowed, updatedAt: new Date() }).where(eq(investmentOffers.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/investment-offers/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentOffers).where(eq(investmentOffers.id, req.params.id));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // --- Investment Distributions (Sent To tracking) ---
  app.get("/api/investment-tracker/:trackerId/distributions", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(investmentDistributions).where(eq(investmentDistributions.trackerId, req.params.trackerId)).orderBy(desc(investmentDistributions.sentDate));
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
      const [row] = await db.update(investmentDistributions).set({ ...allowed, updatedAt: new Date() }).where(eq(investmentDistributions.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.delete("/api/investment-distributions/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentDistributions).where(eq(investmentDistributions.id, req.params.id));
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
      const NEGOTIATION_STATUSES = ["Under Negotiation", "HOTs", "NEG"];
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

  app.post("/api/apollo/enrich-contact", requireAuth, async (req, res) => {
    try {
      const { contactId, force = false } = req.body;
      if (!contactId) return res.status(400).json({ error: "contactId required" });

      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Apollo API key not configured" });

      const [contact] = await pool.query(`SELECT * FROM crm_contacts WHERE id = $1`, [contactId]).then(r => r.rows);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const nameParts = (contact.name || "").trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      let companyDomain: string | undefined;
      let companyName: string | undefined;
      if (contact.company_id) {
        const [company] = await pool.query(`SELECT name, domain FROM crm_companies WHERE id = $1`, [contact.company_id]).then(r => r.rows);
        if (company) {
          companyName = company.name;
          companyDomain = company.domain || undefined;
        }
      }
      if (!companyDomain && contact.company_name) {
        companyName = contact.company_name;
      }

      // Build mixed_people/api_search body (replaces deprecated people/match)
      const body: Record<string, any> = {
        page: 1,
        per_page: 1,
      };
      if (contact.email) body.person_emails = [contact.email];
      if (companyDomain) body.q_organization_domains_list = [companyDomain];
      else if (companyName) body.organization_names = [companyName];
      if (firstName || lastName) body.q_keywords = `${firstName} ${lastName}`.trim();

      const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!apolloRes.ok) {
        const errText = await apolloRes.text();
        console.error("[apollo] API error:", apolloRes.status, errText);
        return res.status(apolloRes.status).json({ error: `Apollo API error: ${apolloRes.status}` });
      }

      const data = await apolloRes.json() as any;
      const person = (data.people || data.contacts || [])[0];

      if (!person) {
        return res.json({ success: false, message: "No match found in Apollo" });
      }

      const updates: Record<string, any> = {};
      const updatedFields: string[] = [];

      if (person.title && (force || !contact.role)) {
        updates.role = person.title;
        updatedFields.push("role");
      }

      if (person.linkedin_url && (force || !contact.linkedin_url)) {
        updates.linkedin_url = person.linkedin_url;
        updatedFields.push("linkedinUrl");
      }

      const phoneNumber = person.phone_numbers?.[0]?.sanitized_number ||
        person.phone_numbers?.[0]?.raw_number ||
        person.organization?.phone;
      if (phoneNumber && (force || !contact.phone)) {
        updates.phone = phoneNumber;
        updatedFields.push("phone");
      }

      if (person.email && (force || !contact.email)) {
        updates.email = person.email;
        updatedFields.push("email");
      }

      if (person.photo_url && (force || !contact.avatar_url)) {
        updates.avatar_url = person.photo_url;
        updatedFields.push("avatarUrl");
      }

      updates.last_enriched_at = new Date();
      updates.enrichment_source = "apollo";

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
        setClauses.push(`updated_at = NOW()`);
        const vals = Object.values(updates);
        await pool.query(
          `UPDATE crm_contacts SET ${setClauses.join(", ")} WHERE id = $1`,
          [contactId, ...vals]
        );
      }

      res.json({
        success: true,
        updatedFields,
        apolloData: {
          name: person.name,
          title: person.title,
          email: person.email,
          phone: phoneNumber || null,
          linkedinUrl: person.linkedin_url,
          photoUrl: person.photo_url,
          city: person.city,
          country: person.country,
          organization: person.organization?.name,
          organizationWebsite: person.organization?.website_url,
          headline: person.headline,
        },
      });
    } catch (err: any) {
      console.error("[apollo] Enrich error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/apollo/enrich-company", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: "companyId required" });

      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Apollo API key not configured" });

      const [company] = await pool.query(`SELECT * FROM crm_companies WHERE id = $1`, [companyId]).then(r => r.rows);
      if (!company) return res.status(404).json({ error: "Company not found" });

      let domain = company.domain || "";
      if (!domain && company.domain_url) {
        try {
          const url = company.domain_url.startsWith("http") ? company.domain_url : `https://${company.domain_url}`;
          domain = new URL(url).hostname.replace(/^www\./, "");
        } catch {}
      }

      // Apollo's /organizations/enrich requires a domain — passing `name` alone
      // returns 422. If we don't have a domain, try to discover one via the
      // mixed_companies/api_search endpoint first, then enrich.
      if (!domain) {
        try {
          const searchRes = await fetch(`https://api.apollo.io/api/v1/mixed_companies/api_search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-cache",
              "X-Api-Key": apiKey,
            },
            body: JSON.stringify({ q_organization_name: company.name, per_page: 1 }),
          });
          if (searchRes.ok) {
            const searchData: any = await searchRes.json();
            const first = searchData?.organizations?.[0] || searchData?.accounts?.[0];
            if (first?.primary_domain) domain = first.primary_domain;
            else if (first?.website_url) {
              try { domain = new URL(first.website_url).hostname.replace(/^www\./, ""); } catch {}
            }
          }
        } catch (err: any) {
          console.warn("[apollo] Pre-enrich search failed:", err?.message);
        }
      }

      if (!domain) {
        return res.status(400).json({
          error: `No domain available for "${company.name}". Apollo's enrich API requires a company website/domain. Add a domain to the company record and try again.`,
        });
      }

      const params = new URLSearchParams({ domain });
      const apolloRes = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?${params.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
        },
      });

      if (!apolloRes.ok) {
        const errText = await apolloRes.text();
        console.error("[apollo] Company API error:", apolloRes.status, errText);
        // Surface Apollo's own error message so the user understands what's wrong
        let apolloMsg = "";
        try { apolloMsg = JSON.parse(errText)?.error || JSON.parse(errText)?.errors?.[0] || ""; } catch {}
        return res.status(apolloRes.status).json({
          error: `Apollo ${apolloRes.status}: ${apolloMsg || errText.slice(0, 200) || "No details"}. Domain tried: ${domain}`,
        });
      }

      const data = await apolloRes.json() as any;
      const org = data.organization;

      if (!org) {
        return res.json({ success: false, message: "No match found in Apollo" });
      }

      const updates: Record<string, any> = {};
      const updatedFields: string[] = [];

      if (org.linkedin_url && !company.linkedin_url) {
        updates.linkedin_url = org.linkedin_url;
        updatedFields.push("linkedinUrl");
      }
      if (org.phone && !company.phone) {
        updates.phone = org.phone;
        updatedFields.push("phone");
      }
      if (org.industry && !company.industry) {
        updates.industry = org.industry;
        updatedFields.push("industry");
      }
      if (org.estimated_num_employees && !company.employee_count) {
        updates.employee_count = String(org.estimated_num_employees);
        updatedFields.push("employeeCount");
      }
      if (org.annual_revenue && !company.annual_revenue) {
        updates.annual_revenue = String(org.annual_revenue);
        updatedFields.push("annualRevenue");
      }
      if (org.founded_year && !company.founded_year) {
        updates.founded_year = String(org.founded_year);
        updatedFields.push("foundedYear");
      }
      if (org.website_url && !company.domain_url) {
        updates.domain_url = org.website_url;
        updatedFields.push("domainUrl");
      }
      if (org.short_description && !company.description) {
        updates.description = org.short_description;
        updatedFields.push("description");
      }
      let orgDomain = org.primary_domain || null;
      if (!orgDomain && org.website_url) {
        try {
          const u = org.website_url.startsWith("http") ? org.website_url : `https://${org.website_url}`;
          orgDomain = new URL(u).hostname.replace(/^www\./, "");
        } catch {}
      }
      if (orgDomain && !company.domain) {
        updates.domain = orgDomain;
        updatedFields.push("domain");
      }

      updates.last_enriched_at = new Date();
      updates.enrichment_source = "apollo";

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
        setClauses.push(`updated_at = NOW()`);
        const vals = Object.values(updates);
        await pool.query(
          `UPDATE crm_companies SET ${setClauses.join(", ")} WHERE id = $1`,
          [companyId, ...vals]
        );
      }

      res.json({
        success: true,
        updatedFields,
        apolloData: {
          name: org.name,
          domain: org.primary_domain,
          website: org.website_url,
          linkedinUrl: org.linkedin_url,
          phone: org.phone,
          industry: org.industry,
          employeeCount: org.estimated_num_employees,
          annualRevenue: org.annual_revenue,
          foundedYear: org.founded_year,
          description: org.short_description,
          city: org.city,
          country: org.country,
          logoUrl: org.logo_url,
        },
      });
    } catch (err: any) {
      console.error("[apollo] Company enrich error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/apollo/search-person", requireAuth, async (req, res) => {
    try {
      const { firstName, lastName, email, companyName, domain } = req.body;
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Apollo API key not configured" });

      // Build mixed_people/api_search body (replaces deprecated people/match)
      const body: Record<string, any> = {
        page: 1,
        per_page: 1,
      };
      if (email) body.person_emails = [email];
      if (domain) body.q_organization_domains_list = [domain];
      else if (companyName) body.organization_names = [companyName];
      if (firstName || lastName) body.q_keywords = `${firstName || ""} ${lastName || ""}`.trim();

      const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!apolloRes.ok) {
        return res.status(apolloRes.status).json({ error: `Apollo API error: ${apolloRes.status}` });
      }

      const data = await apolloRes.json() as any;
      res.json({ person: (data.people || data.contacts || [])[0] || null });
    } catch (err: any) {
      console.error("[apollo] Search error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk Apollo enrichment — processes all contacts with an email, with rate limiting
  app.post("/api/apollo/bulk-enrich", requireAuth, async (req, res) => {
    try {
      const { force = false, staleOnly = false, batchSize = 25, offset = 0 } = req.body || {};
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "Apollo API key not configured" });

      const limit = Math.min(Math.max(1, Number(batchSize) || 25), 50);
      const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

      let whereClause = `c.email IS NOT NULL AND c.email != ''`;
      if (staleOnly) {
        whereClause += ` AND (c.last_enriched_at IS NULL OR c.last_enriched_at < NOW() - INTERVAL '6 months')`;
      }

      const totalResult = await pool.query(`SELECT COUNT(*) as cnt FROM crm_contacts c WHERE ${whereClause}`);
      const totalEligible = parseInt(totalResult.rows[0].cnt);

      const contacts = await pool.query(`
        SELECT c.id, c.name, c.email, c.phone, c.role, c.linkedin_url, c.avatar_url, c.company_id, c.company_name
        FROM crm_contacts c
        WHERE ${whereClause}
        ORDER BY c.last_enriched_at ASC NULLS FIRST, c.name ASC
        LIMIT $1 OFFSET $2
      `, [limit, safeOffset]).then(r => r.rows);

      const total = contacts.length;
      const results = {
        total,
        enriched: 0,
        noMatch: 0,
        errors: 0,
        skipped: 0,
        noMatchContacts: [] as { id: string; name: string; email: string }[],
        enrichedContacts: [] as { id: string; name: string; fields: string[] }[],
      };

      for (const contact of contacts) {
        try {
          // Look up company domain for better matching
          let companyDomain: string | undefined;
          let companyName: string | undefined;
          if (contact.company_id) {
            const [company] = await pool.query(
              `SELECT name, domain FROM crm_companies WHERE id = $1`,
              [contact.company_id]
            ).then(r => r.rows);
            if (company) {
              companyName = company.name;
              companyDomain = company.domain || undefined;
            }
          }
          if (!companyDomain && contact.company_name) {
            companyName = contact.company_name;
          }

          const nameParts = (contact.name || "").trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          // Build mixed_people/api_search body (replaces deprecated people/match)
          const body: Record<string, any> = {
            page: 1,
            per_page: 1,
          };
          if (contact.email) body.person_emails = [contact.email];
          if (companyDomain) body.q_organization_domains_list = [companyDomain];
          else if (companyName) body.organization_names = [companyName];
          if (firstName || lastName) body.q_keywords = `${firstName} ${lastName}`.trim();

          const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-cache",
              "X-Api-Key": apiKey,
            },
            body: JSON.stringify(body),
          });

          if (!apolloRes.ok) {
            results.errors++;
            // Rate limit hit — pause and retry once
            if (apolloRes.status === 429) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }

          const data = await apolloRes.json() as any;
          const person = (data.people || data.contacts || [])[0];

          if (!person) {
            results.noMatch++;
            results.noMatchContacts.push({ id: contact.id, name: contact.name, email: contact.email });
            await new Promise(resolve => setTimeout(resolve, 250));
            continue;
          }

          const ALLOWED_CONTACT_COLUMNS = new Set(["role", "linkedin_url", "phone", "avatar_url"]);
          const updates: Record<string, any> = {};
          const updatedFields: string[] = [];

          if (person.title && (force || !contact.role)) {
            updates.role = person.title;
            updatedFields.push("role");
          }
          if (person.linkedin_url && (force || !contact.linkedin_url)) {
            updates.linkedin_url = person.linkedin_url;
            updatedFields.push("linkedIn");
          }
          const phoneNumber = person.phone_numbers?.[0]?.sanitized_number ||
            person.phone_numbers?.[0]?.raw_number ||
            person.organization?.phone;
          if (phoneNumber && (force || !contact.phone)) {
            updates.phone = phoneNumber;
            updatedFields.push("phone");
          }
          if (person.photo_url && (force || !contact.avatar_url)) {
            updates.avatar_url = person.photo_url;
            updatedFields.push("photo");
          }

          const ALLOWED_ENRICHMENT_COLUMNS = new Set(["role", "linkedin_url", "phone", "avatar_url", "last_enriched_at", "enrichment_source"]);
          updates.last_enriched_at = new Date();
          updates.enrichment_source = "apollo";
          const safeUpdates = Object.fromEntries(
            Object.entries(updates).filter(([k]) => ALLOWED_ENRICHMENT_COLUMNS.has(k))
          );

          if (Object.keys(safeUpdates).length > 0) {
            const setClauses = Object.keys(safeUpdates).map((k, i) => `${k} = $${i + 2}`);
            setClauses.push(`updated_at = NOW()`);
            await pool.query(
              `UPDATE crm_contacts SET ${setClauses.join(", ")} WHERE id = $1`,
              [contact.id, ...Object.values(safeUpdates)]
            );
            results.enriched++;
            results.enrichedContacts.push({ id: contact.id, name: contact.name, fields: updatedFields });
          } else {
            results.skipped++;
          }

          // Rate limit: ~250ms between calls = ~4 calls/sec, well within Apollo limits
          await new Promise(resolve => setTimeout(resolve, 250));

        } catch (err: any) {
          results.errors++;
          console.error(`[apollo] Bulk enrich error for ${contact.name}:`, err.message);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      const nextOffset = offset + limit;
      const hasMore = nextOffset < totalEligible;
      console.log(`[apollo] Batch enrichment complete (offset ${offset}, batch ${limit}): ${results.enriched} enriched, ${results.noMatch} no match, ${results.errors} errors, ${results.skipped} already complete`);
      res.json({ success: true, ...results, totalEligible, offset, hasMore, nextOffset });

    } catch (err: any) {
      console.error("[apollo] Bulk enrich fatal error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/client-templates", requireAuth, async (req, res) => {
    try {
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

      const propsResult = await pool.query(
        `SELECT id, name, address, status, asset_class FROM crm_properties WHERE landlord_id = $1 ORDER BY name`,
        [companyId]
      );
      const properties = propsResult.rows;
      const propertyIds = properties.map((p: any) => p.id);

      let totalUnits = 0, vacantUnits = 0, totalPassingRent = 0;
      if (propertyIds.length > 0) {
        const tenancyResult = await pool.query(
          `SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE status = 'Vacant' OR status = 'Available') as vacant,
                  COALESCE(SUM(CASE WHEN rent_pa IS NOT NULL THEN rent_pa ELSE 0 END), 0) as passing_rent
           FROM leasing_schedule_units WHERE property_id = ANY($1)`,
          [propertyIds]
        );
        totalUnits = parseInt(tenancyResult.rows[0]?.total || "0");
        vacantUnits = parseInt(tenancyResult.rows[0]?.vacant || "0");
        totalPassingRent = parseFloat(tenancyResult.rows[0]?.passing_rent || "0");
      }

      const dealsResult = await pool.query(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE status NOT IN ('Dead', 'Completed', 'Lost')) as active
         FROM crm_deals WHERE landlord_id = $1`,
        [companyId]
      );

      const contactsResult = await pool.query(
        "SELECT COUNT(*) as total FROM crm_contacts WHERE company_id = $1",
        [companyId]
      );

      let upcomingEvents = 0;
      if (propertyIds.length > 0) {
        const eventsResult = await pool.query(
          `SELECT COUNT(*) as total FROM team_events
           WHERE property_id = ANY($1) AND start_time >= NOW()`,
          [propertyIds]
        );
        upcomingEvents = parseInt(eventsResult.rows[0]?.total || "0");
      }

      const dealsListResult = await pool.query(
        `SELECT d.id, d.name, d.status, d.property_id, d.deal_type as "dealType", p.name as property_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON d.property_id = p.id
         WHERE d.landlord_id = $1 AND d.status NOT IN ('Dead', 'Completed', 'Lost')
         ORDER BY p.name, d.created_at DESC`,
        [companyId]
      );

      let leasingUnits: any[] = [];
      if (propertyIds.length > 0) {
        const leasingResult = await pool.query(
          `SELECT u.id, u.property_id, u.unit_name as premises, u.sort_order as unit_number, u.status, u.tenant_name, u.rent_pa as passing_rent_pa, u.lease_expiry, p.name as property_name
           FROM leasing_schedule_units u
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
        const eventsListResult = await pool.query(
          `SELECT id, title, start_time, end_time, event_type, location, property_id
           FROM team_events
           WHERE property_id = ANY($1) AND start_time >= NOW()
           ORDER BY start_time LIMIT 20`,
          [propertyIds]
        );
        upcomingEventsList = eventsListResult.rows;

        const calendarResult = await pool.query(
          `SELECT te.id, te.title, te.start_time, te.end_time, te.event_type, te.location, te.property_id, p.name as property_name
           FROM team_events te
           LEFT JOIN crm_properties p ON te.property_id = p.id
           WHERE te.property_id = ANY($1)
             AND te.start_time >= NOW() - INTERVAL '7 days'
             AND te.start_time <= NOW() + INTERVAL '30 days'
           ORDER BY te.start_time`,
          [propertyIds]
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
          kycStatus: company.kyc_status,
          kycCheckedAt: company.kyc_checked_at,
          bgpContacts: company.bgp_contact_user_ids || [],
          companiesHouseNumber: company.companies_house_number,
          parentCompanyName,
          pscList,
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
    "London Leasing", "National Leasing", "Investment",
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
      const folderName = decodeURIComponent(req.params.folder);
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
      const folderName = decodeURIComponent(req.params.folder);
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
      const folderName = decodeURIComponent(req.params.folder);
      const filename = req.params.filename;
      if (!TEAM_FOLDERS.includes(folderName)) return res.status(400).json({ error: "Invalid folder" });
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return res.status(400).json({ error: "Invalid filename" });

      const filePath = path.join(CHATBGP_BASE, folderName, filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

      res.download(filePath, filename.replace(/^\d+-/, ""));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/team-folders/:folder/:filename", requireAuth, async (req, res) => {
    try {
      const folderName = decodeURIComponent(req.params.folder);
      const filename = req.params.filename;
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

  app.get("/api/activity-feed", requireAuth, async (_req: Request, res: Response) => {
    try {
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

      if (deal.hots_completed_at) {
        timeline.push({ type: "hots_completed", date: deal.hots_completed_at, detail: "Heads of Terms completed", icon: "file-text" });
      }
      if (deal.kyc_approved && (deal.kyc_approved_at || deal.updated_at)) {
        timeline.push({ type: "kyc_approved", date: deal.kyc_approved_at || deal.updated_at, detail: `KYC approved by ${deal.kyc_approved_by || "system"}`, icon: "shield-check" });
      }
      if (deal.completion_date) {
        const compDate = new Date(deal.completion_date);
        if (!isNaN(compDate.getTime())) {
          timeline.push({ type: "completion", date: deal.completion_date, detail: "Deal completed", icon: "check-circle" });
        }
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
        pool.query(`SELECT id, name, deal_type, status, rent_pa, fee, completion_date FROM crm_deals WHERE property_id = $1 ORDER BY created_at DESC LIMIT 10`, [propertyId]),
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
      const userRow = await pool.query("SELECT name, team, email FROM users WHERE id = $1", [userId]);
      const userName = userRow.rows[0]?.name || "Team member";
      const userTeam = userRow.rows[0]?.team || "";
      const userEmail = userRow.rows[0]?.email || "";

      const tasks = await pool.query(
        `SELECT * FROM user_tasks WHERE user_id = $1 AND status != 'done' 
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC NULLS LAST`,
        [userId]
      );
      const overdueTasks = tasks.rows.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());
      const todayTasks = tasks.rows.filter((t: any) => {
        if (!t.due_date) return false;
        const d = new Date(t.due_date);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      });

      const recentDone = await pool.query(
        `SELECT * FROM user_tasks WHERE user_id = $1 AND status = 'done' AND completed_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      );

      const teamDeals = await pool.query(
        `SELECT d.id, d.name, d.status, p.name as property_name, tc.name as tenant_name, d.updated_at 
         FROM crm_deals d
         LEFT JOIN crm_properties p ON d.property_id = p.id
         LEFT JOIN crm_companies tc ON d.tenant_id = tc.id
         WHERE d.team @> ARRAY[$1]::text[] AND d.status NOT IN ('Dead', 'Withdrawn')
         ORDER BY d.updated_at DESC LIMIT 15`,
        [userTeam]
      );

      let calendarContext = "";
      let emailContext = "";
      try {
        const { getValidMsToken } = await import("./microsoft");
        const msToken = await getValidMsToken(req);
        if (msToken) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 2);

          try {
            const calRes = await fetch(
              `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${today.toISOString()}&endDateTime=${tomorrow.toISOString()}&$top=20&$orderby=start/dateTime&$select=subject,start,end,location,organizer,attendees`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
            if (calRes.ok) {
              const calData = await calRes.json();
              const events = (calData.value || []).map((e: any) => ({
                subject: e.subject,
                start: e.start?.dateTime,
                end: e.end?.dateTime,
                location: e.location?.displayName || "",
                organizer: e.organizer?.emailAddress?.name || "",
              }));
              if (events.length > 0) calendarContext = `Today's calendar (${events.length} events):\n${events.map((e: any) => `- ${new Date(e.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ${e.subject}${e.location ? ` (${e.location})` : ""}`).join("\n")}`;
            }
          } catch (e: any) { console.log("[ai-briefing] Calendar fetch error:", e.message); }

          try {
            const emailRes = await fetch(
              `https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,isRead,importance,bodyPreview`,
              { headers: { Authorization: `Bearer ${msToken}` } }
            );
            if (emailRes.ok) {
              const emailData = await emailRes.json();
              const emails = (emailData.value || []).filter((e: any) => !e.isRead).slice(0, 8);
              if (emails.length > 0) emailContext = `Unread emails (${emails.length}):\n${emails.map((e: any) => `- ${e.from?.emailAddress?.name || "Unknown"}: "${e.subject}" — ${(e.bodyPreview || "").slice(0, 80)}`).join("\n")}`;
            }
          } catch (e: any) { console.log("[ai-briefing] Email fetch error:", e.message); }
        }
      } catch (e: any) { console.log("[ai-briefing] MS token fetch error:", e.message); }

      const digestRes = await pool.query(
        `SELECT id, name, status, updated_at FROM crm_deals 
         WHERE status NOT IN ('Completed', 'Invoiced', 'Dead', 'Withdrawn')
         AND updated_at < NOW() - INTERVAL '14 days'
         AND team @> ARRAY[$1]::text[]
         ORDER BY updated_at ASC LIMIT 5`,
        [userTeam]
      );
      const stuckDeals = digestRes.rows;

      const today = new Date();
      const todayStr = today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

      const prompt = `You are the AI briefing assistant for ${userName} at Bruce Gillingham Pollard (BGP), a London commercial property agency. Today is ${todayStr}.

Generate a personalised daily briefing. Be concise, actionable, and warm. Structure it as:

1. **Good morning greeting** — Brief, warm, personalised. Reference the day/weather metaphorically if relevant.

2. **Today at a glance** — Quick bullet summary of what's ahead (meetings count, tasks count, urgent items).

3. **Priority actions** — What needs attention RIGHT NOW. Be specific and actionable. Include deadlines.

4. **Deal momentum** — Brief commentary on active deals, highlight any that need attention. Keep it punchy.

5. **Inbox intelligence** — If there are notable unread emails, flag the important ones with suggested actions.

6. **Looking ahead** — Any upcoming deadlines or things to prepare for.

Keep the entire briefing under 400 words. Use a professional but personable tone — like a brilliant PA who knows the business inside out.

Here is ${userName}'s context:

TASKS (${tasks.rows.length} open):
${overdueTasks.length > 0 ? `OVERDUE (${overdueTasks.length}): ${overdueTasks.map((t: any) => `"${t.title}" (due ${new Date(t.due_date).toLocaleDateString("en-GB")})`).join(", ")}` : "No overdue tasks."}
${todayTasks.length > 0 ? `DUE TODAY (${todayTasks.length}): ${todayTasks.map((t: any) => `"${t.title}"`).join(", ")}` : ""}
${tasks.rows.filter((t: any) => t.priority === "urgent" || t.priority === "high").map((t: any) => `[${t.priority.toUpperCase()}] "${t.title}"${t.due_date ? ` (due ${new Date(t.due_date).toLocaleDateString("en-GB")})` : ""}`).join("\n") || "No high-priority tasks."}

COMPLETED YESTERDAY: ${recentDone.rows.length > 0 ? recentDone.rows.map((t: any) => `"${t.title}"`).join(", ") : "None"}

${calendarContext || "No calendar data available."}

${emailContext || "No email data available."}

ACTIVE DEALS (${teamDeals.rows.length} for ${userTeam} team):
${teamDeals.rows.slice(0, 10).map((d: any) => `- ${d.name} — ${d.status}${d.property_name ? ` @ ${d.property_name}` : ""}${d.tenant_name ? ` (tenant: ${d.tenant_name})` : ""}`).join("\n") || "No active deals."}

${stuckDeals.length > 0 ? `DEALS NEEDING ATTENTION (no update 14+ days):\n${stuckDeals.map((d: any) => `- ${d.name} (${d.status}, last updated ${new Date(d.updated_at).toLocaleDateString("en-GB")})`).join("\n")}` : ""}`;

      const { callClaude } = await import("./utils/anthropic-client");
      const briefingResult = await callClaude({
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 1200,
        temperature: 0.7,
      });
      const briefingText = briefingResult?.choices?.[0]?.message?.content || "Unable to generate briefing at this time.";

      res.json({
        briefing: briefingText,
        generatedAt: new Date().toISOString(),
        stats: {
          openTasks: tasks.rows.length,
          overdueTasks: overdueTasks.length,
          todayTasks: todayTasks.length,
          completedYesterday: recentDone.rows.length,
          activeDeals: teamDeals.rows.length,
          stuckDeals: stuckDeals.length,
          unreadEmails: emailContext ? parseInt(emailContext.match(/\d+/)?.[0] || "0") : 0,
        }
      });
    } catch (e: any) {
      console.error("[ai-briefing] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/daily-digest", requireAuth, async (_req: Request, res: Response) => {
    try {
      const alerts: any[] = [];

      const stuckDeals = await pool.query(
        `SELECT id, name, status, updated_at FROM crm_deals 
         WHERE status NOT IN ('Completed', 'Invoiced', 'Dead', 'Withdrawn')
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
  app.get("/api/portfolio/landsec/analytics", requireAuth, async (_req, res) => {
    try {
      // All deals where groupName contains "Landsec" (case-insensitive)
      const dealsResult = await pool.query(
        `SELECT id, name, group_name, deal_type, status, fee, internal_agent, created_at, updated_at
         FROM crm_deals
         WHERE group_name ILIKE '%Landsec%'
         ORDER BY COALESCE(updated_at, created_at) DESC`
      );
      const allDeals = dealsResult.rows;

      const totalDeals = allDeals.length;

      // Pipeline statuses (not completed/invoiced/dead)
      const INVOICED_STATUSES = ["Invoiced"];
      const DEAD_STATUSES = ["Dead"];
      const PIPELINE_STAGE_ORDER = ["Targeting", "Available", "Marketing", "NEG", "HOTs", "SOLs", "Exchanged", "Completed", "Live", "Invoiced"];

      let totalWIP = 0;
      let totalInvoiced = 0;
      let pipelineValue = 0;
      const byDealType: Record<string, { count: number; fees: number }> = {};
      const byStatus: Record<string, number> = {};
      const byAgent: Record<string, { count: number; fees: number }> = {};

      for (const deal of allDeals) {
        const fee = parseFloat(deal.fee) || 0;
        const status = (deal.status || "").trim();
        const dealType = deal.deal_type || "Other";

        // WIP vs Invoiced
        if (INVOICED_STATUSES.includes(status)) {
          totalInvoiced += fee;
        } else if (!DEAD_STATUSES.includes(status)) {
          totalWIP += fee;
        }

        // Pipeline value: statuses before Completed/Invoiced
        const isPreCompletion = !["Completed", "Invoiced", "Dead", "Leasing Comps", "Investment Comps"].includes(status);
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

      res.json({
        totalDeals,
        totalWIP,
        totalInvoiced,
        byDealType,
        byStatus,
        byAgent,
        recentActivity,
        pipelineValue,
        averageDealSize,
      });
    } catch (err: any) {
      console.error("[landsec-analytics] Error:", err?.message);
      res.status(500).json({ message: "Failed to fetch Landsec analytics" });
    }
  });

  // ===== Dashboard KPI Trends =====
  app.get("/api/dashboard/kpi-trends", requireAuth, async (_req: Request, res: Response) => {
    try {
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
  app.get("/api/notifications", requireAuth, async (_req: Request, res: Response) => {
    try {
      const notifications: any[] = [];

      // Deals stuck in same status > 30 days
      const stuckDeals = await pool.query(`
        SELECT id, name, status, updated_at FROM crm_deals
        WHERE status NOT IN ('Completed', 'Invoiced', 'Dead', 'Withdrawn', 'Leasing Comps', 'Investment Comps')
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
        AND status NOT IN ('Dead', 'Withdrawn', 'Completed', 'Invoiced', 'Leasing Comps', 'Investment Comps')
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
        AND status IN ('SOLs', 'Exchanged', 'Completing', 'HOTs')
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

      // Deals with stale completion dates (overdue)
      const overdueDeals = await pool.query(`
        SELECT id, name, completion_date, status FROM crm_deals
        WHERE completion_date IS NOT NULL
        AND completion_date::date < CURRENT_DATE
        AND status NOT IN ('Completed', 'Invoiced', 'Dead', 'Withdrawn', 'Leasing Comps', 'Investment Comps')
        ORDER BY completion_date ASC
        LIMIT 10
      `);
      for (const d of overdueDeals.rows) {
        notifications.push({
          id: `overdue-${d.id}`,
          type: "overdue_completion",
          title: `Overdue completion: ${d.name}`,
          description: `Expected completion ${d.completion_date} has passed`,
          severity: "warning",
          createdAt: d.completion_date,
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

  return httpServer;
}

