import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { z } from "zod";
import { autoProcessAndPush } from "./news-intelligence";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";
import { ingestBytes } from "./universal-ingest";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function getWhatsAppConfig() {
  const token = (process.env.WHATSAPP_TOKEN_V2 || process.env.WHATSAPP_ACCESS_TOKEN)?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  return { token, phoneNumberId, verifyToken, appSecret };
}

export async function downloadWhatsAppMedia(mediaId: string, token: string): Promise<{ bytes: Buffer; filename: string; mimeType: string }> {
  // Step 1: get the media URL
  const metaRes = await fetch(`${GRAPH_API_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`WhatsApp media meta ${metaRes.status}`);
  const meta = await metaRes.json();
  const mediaUrl: string = meta.url;
  const mimeType: string = meta.mime_type || "application/octet-stream";
  // Step 2: download the actual bytes
  const dataRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!dataRes.ok) throw new Error(`WhatsApp media download ${dataRes.status}`);
  const arrayBuffer = await dataRes.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  // Derive filename from mime type
  const ext = mimeType.split("/").pop()?.replace("vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx")
    .replace("vnd.ms-excel", "xls") || "bin";
  const filename = `whatsapp_${mediaId}.${ext}`;
  return { bytes, filename, mimeType };
}

function verifyWebhookSignature(req: Request, appSecret: string): boolean {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature) return false;
  const rawBody = (req as any).rawBody;
  if (!rawBody) return false;
  const expectedSignature = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

const DOC_REQUEST_KEYWORDS = /\b(create|draft|write|prepare|generate|make|produce)\b.*\b(document|doc|HOTs|heads of terms|marketing particulars|pitch|report|memo|strategy|press release|letter|cv|brochure|presentation|proposal)\b/i;

async function detectAndGenerateDocument(messageBody: string, fromNumber: string, config: ReturnType<typeof getWhatsAppConfig>): Promise<boolean> {
  if (!DOC_REQUEST_KEYWORDS.test(messageBody)) return false;
  if (!config.token || !config.phoneNumberId) return false;

  try {
    const classification = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        { role: "system", content: `You classify WhatsApp messages to ChatBGP. Determine if the message is a document generation request. Return JSON: {"isDocRequest": true/false, "documentType": "type if applicable", "description": "full description for generation"}` },
        { role: "user", content: messageBody },
      ],
      max_completion_tokens: 512,
      temperature: 0,
    });
    const raw = classification?.choices?.[0]?.message?.content || "{}";
    let parsed: any;
    try { parsed = safeParseJSON(raw); } catch { return false; }

    if (!parsed.isDocRequest) return false;

    console.log(`[whatsapp] Document request detected from ${fromNumber}: ${parsed.documentType || "auto"}`);

    await sendWhatsAppText(config, fromNumber, `⏳ Generating your document — this may take a moment...`);

    const { generateAutonomousDocument, exportDocumentToPdf } = await import("./document-templates");
    const doc = await generateAutonomousDocument(parsed.description || messageBody, parsed.documentType);
    const pdfBuffer = await exportDocumentToPdf(doc.content, doc.name);

    const { saveFile } = await import("./file-storage");
    const filename = `${(doc.name || "Document").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}.pdf`;
    await saveFile(`chat-media/${filename}`, pdfBuffer, "application/pdf", filename);

    const sent = await sendWhatsAppDocument(config, fromNumber, pdfBuffer, filename, doc.name);
    if (!sent) {
      console.error(`[whatsapp] Failed to send document via WhatsApp media API to ${fromNumber}`);
      await sendWhatsAppText(config, fromNumber, `Your document "${doc.name}" was generated but could not be sent. Please download it from the ChatBGP dashboard.`);
      return false;
    }

    console.log(`[whatsapp] Document sent to ${fromNumber}: ${filename}`);
    return true;
  } catch (err: any) {
    console.error(`[whatsapp] Document generation error:`, err?.message);
    return false;
  }
}

export async function sendWhatsAppText(config: ReturnType<typeof getWhatsAppConfig>, to: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH_API_URL}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body: text } }),
    });
    return res.ok;
  } catch { return false; }
}

async function sendAndStoreReply(
  replyText: string,
  toNumber: string,
  conversationId: string,
  contactName: string | null,
  config: ReturnType<typeof getWhatsAppConfig>,
): Promise<void> {
  const MAX_LEN = 3900;
  const chunks: string[] = [];
  let remaining = replyText.trim();
  while (remaining.length > MAX_LEN) {
    let cutAt = remaining.lastIndexOf("\n", MAX_LEN);
    if (cutAt < MAX_LEN / 2) cutAt = remaining.lastIndexOf(" ", MAX_LEN);
    if (cutAt < MAX_LEN / 2) cutAt = MAX_LEN;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);

  for (const chunk of chunks) {
    const sent = await sendWhatsAppText(config, toNumber, chunk);
    if (!sent) {
      console.error(`[whatsapp-ai] Failed to send chunk to ${toNumber}`);
      continue;
    }
    await storage.createWaMessage({
      conversationId,
      direction: "outbound",
      fromNumber: config.phoneNumberId || "",
      toNumber,
      body: chunk,
      status: "sent",
      timestamp: new Date(),
    });
  }

  await storage.upsertWaConversation(toNumber, contactName, replyText.slice(0, 100));
}

async function resolveUserIdFromPhone(fromNumber: string): Promise<{ userId: string; matched: boolean; userName: string | null }> {
  const digits = fromNumber.replace(/[^0-9]/g, "");
  if (!digits) return { userId: `wa:${fromNumber}`, matched: false, userName: null };
  try {
    const { db } = await import("./db");
    const { users } = await import("@shared/schema");
    const allUsers = await db
      .select({ id: users.id, name: users.name, phone: users.phone })
      .from(users);
    for (const u of allUsers) {
      if (!u.phone) continue;
      const userDigits = String(u.phone).replace(/[^0-9]/g, "");
      if (!userDigits) continue;
      if (digits === userDigits || digits.endsWith(userDigits) || userDigits.endsWith(digits)) {
        return { userId: u.id, matched: true, userName: u.name };
      }
    }
  } catch (err: any) {
    console.error(`[whatsapp-ai] Phone-to-user lookup failed: ${err?.message}`);
  }
  return { userId: `wa:${digits}`, matched: false, userName: null };
}

// ── Fast contact-lookup lane (Woody, 2026-08-25: the team asks "does
// anyone have Roland from Watchouse direct?" on WhatsApp instead of the
// app). Staff texts that read like a contact/brand lookup get an instant
// card — name, role, mobile, email, brand, acting agents — from the same
// data as the phone Brand Intelligence search. Anything that isn't
// lookup-shaped, comes from a non-staff number, or finds no match falls
// through to the normal ChatBGP path unchanged.
const LOOKUP_INTENT = /\b(number|mobile|phone|email|contact|details?)\s+(for|of|at|on)\b|\w(?:'|\u2019)s\s+(number|mobile|phone|email|contact|details?)\b|\bwho\s+(has|reps?|represents|acts?|covers?|looks?\s+after)\b|\bdirect\b|\bagents?\s+for\b|\b(anyone|we)\s+(have|got)\b/i;

export async function tryWhatsAppContactLookup(
  messageBody: string,
  fromNumber: string,
  sendReply: (text: string) => Promise<void>,
): Promise<boolean> {
  const text = messageBody.trim();
  if (text.length < 3 || text.length > 140) return false;
  const wordCount = text.split(/\s+/).length;
  if (!LOOKUP_INTENT.test(text)) return false;
  if (/^(ok|okay|thanks|thank you|yes|no|hi|hello|hey|cheers)\b/i.test(text) && wordCount <= 3) return false;

  const resolved = await resolveUserIdFromPhone(fromNumber);
  if (!resolved.matched) return false; // staff numbers only — never serve CRM data to unknown senders

  // Strip the asking words down to the entity being looked for.
  let term = text
    .replace(/[?!.]+\s*$/g, "")
    .replace(/^(does\s+anyone\s+have|has\s+anyone\s+got|anyone\s+(have|got)|do\s+we\s+have|have\s+we\s+got|who\s+(has|reps?|represents|acts\s+for|covers|looks\s+after)|can\s+(i|someone)\s+(get|have)|i\s+need|need|what'?s|whats)\s+/i, "")
    .replace(/\b(the|a|an)\b/gi, " ")
    .replace(/\b(direct|number|mobile|phone|cell|email|contact|details?|dets|line|please|pls|plz|thanks|thank\s+you|for\s+me)\b/gi, " ")
    .replace(/(?:'|\u2019)s?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(for|of|at|on|to)\s+/i, "")
    .replace(/\s+(for|of|at|on|to)$/i, "")
    .trim();
  if (term.length < 3) return false;

  let personPart = term;
  let brandHint: string | null = null;
  const splitMatch = term.match(/^(.*?)\s+(?:from|at|@)\s+(.+)$/i);
  if (splitMatch && splitMatch[1].trim().length >= 2 && splitMatch[2].trim().length >= 2) {
    personPart = splitMatch[1].trim();
    brandHint = splitMatch[2].trim();
  }

  try {
    const { pool } = await import("./db");
    const esc = (s: string) => s.replace(/[%_\\]/g, "\\$&");
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

    // 1. Contacts at brands whose NAME matches the person part (brand hint narrows).
    const contactParams: any[] = [`%${esc(personPart)}%`];
    let contactBrandClause = "";
    if (brandHint) {
      contactParams.push(`%${esc(brandHint)}%`, `%${squash(brandHint)}%`);
      contactBrandClause = ` AND (c.name ILIKE $2 OR regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') LIKE $3)`;
    }
    let contacts = await pool.query(
      `SELECT ct.name, ct.role, ct.email,
              COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone) AS phone,
              c.name AS brand_name
         FROM crm_contacts ct
         JOIN crm_companies c ON c.id = ct.company_id
        WHERE c.merged_into_id IS NULL AND c.company_type ILIKE 'Tenant%'
          AND ct.name ILIKE $1${contactBrandClause}
        ORDER BY ct.name ASC LIMIT 5`, contactParams).then(r => r.rows);
    // Brand hint too strict (typo like "Watchouse")? Retry on name alone.
    if (contacts.length === 0 && brandHint) {
      contacts = await pool.query(
        `SELECT ct.name, ct.role, ct.email,
                COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone) AS phone,
                c.name AS brand_name
           FROM crm_contacts ct
           JOIN crm_companies c ON c.id = ct.company_id
          WHERE c.merged_into_id IS NULL AND c.company_type ILIKE 'Tenant%'
            AND ct.name ILIKE $1
          ORDER BY ct.name ASC LIMIT 5`, [`%${esc(personPart)}%`]).then(r => r.rows);
    }

    // 2. The term as a brand — its key contacts land in one card.
    const brandTerm = brandHint || term;
    const brands = await pool.query(
      `SELECT id, name, company_type
         FROM crm_companies
        WHERE merged_into_id IS NULL AND company_type ILIKE 'Tenant%'
          AND (name ILIKE $1 OR regexp_replace(lower(name), '[^a-z0-9]', '', 'g') LIKE $2)
        ORDER BY name ASC LIMIT 3`, [`%${esc(brandTerm)}%`, `%${squash(brandTerm)}%`]).then(r => r.rows);
    let brandContacts: any[] = [];
    if (contacts.length === 0 && brands.length > 0) {
      brandContacts = await pool.query(
        `SELECT ct.name, ct.role, ct.email,
                COALESCE(NULLIF(ct.phone_mobile, ''), ct.phone) AS phone,
                c.name AS brand_name
           FROM crm_contacts ct
           JOIN crm_companies c ON c.id = ct.company_id
          WHERE c.id = $1
          ORDER BY ct.name ASC LIMIT 4`, [brands[0].id]).then(r => r.rows);
    }

    // 3. Acting agents — firm name or a brand they act for.
    const agents = await pool.query(
      `SELECT a.name, array_agg(DISTINCT b.name ORDER BY b.name) AS brands
         FROM brand_agent_representations r
         JOIN crm_companies a ON a.id = r.agent_company_id
         JOIN crm_companies b ON b.id = r.brand_company_id
        WHERE r.end_date IS NULL AND a.merged_into_id IS NULL AND b.merged_into_id IS NULL
          AND (a.name ILIKE $1 OR b.name ILIKE $1)
        GROUP BY a.id, a.name ORDER BY a.name ASC LIMIT 4`, [`%${esc(brandTerm)}%`]).then(r => r.rows);

    const cardFor = (ct: any) => {
      const lines = [`${ct.name}${ct.role ? ` — ${ct.role}` : ""}`, ct.brand_name];
      if (ct.phone) lines.push(`📱 ${ct.phone}`);
      if (ct.email) lines.push(`✉️ ${ct.email}`);
      if (!ct.phone && !ct.email) lines.push(`No direct details on file — open ${ct.brand_name} in the app and hit Refresh contacts.`);
      return lines.join("\n");
    };

    const parts: string[] = [];
    const primary = contacts.length ? contacts : brandContacts;
    if (primary.length) parts.push(primary.map(cardFor).join("\n\n"));
    else if (brands.length) parts.push(`${brands[0].name} is in the CRM but has no contacts on file yet — open it in the app and hit Refresh contacts.`);
    if (agents.length) {
      parts.push("Acting agents:\n" + agents.map((a: any) =>
        `• ${a.name} — acts for ${a.brands.slice(0, 4).join(", ")}${a.brands.length > 4 ? ` +${a.brands.length - 4} more` : ""}`).join("\n"));
    }
    if (parts.length === 0) return false; // nothing found — let ChatBGP take it

    await sendReply(parts.join("\n\n"));
    console.log(`[whatsapp-lookup] answered "${text.slice(0, 60)}" for ${resolved.userName || fromNumber} (${primary.length} contact(s), ${agents.length} agent(s))`);
    return true;
  } catch (err: any) {
    console.error("[whatsapp-lookup] failed:", err?.message);
    return false; // never block the normal path on an error
  }
}

async function runChatBgpWhatsAppReply(
  messageBody: string,
  fromNumber: string,
  contactName: string | null,
  conversationId: string,
  config: ReturnType<typeof getWhatsAppConfig>,
  imageAttachment?: { mediaType: string; base64: string },
): Promise<void> {
  console.log(`[whatsapp-ai] ENTRY from=${fromNumber} body="${messageBody.slice(0, 80)}" convId=${conversationId} hasImage=${!!imageAttachment}`);
  if (!config.token || !config.phoneNumberId) {
    console.warn(`[whatsapp-ai] Skipped: config missing (token=${!!config.token}, phoneNumberId=${!!config.phoneNumberId})`);
    return;
  }
  if (!messageBody && !imageAttachment) {
    console.log(`[whatsapp-ai] Skipped: empty message and no attachment`);
    return;
  }
  if (messageBody === "[Media]" && !imageAttachment) {
    console.log(`[whatsapp-ai] Skipped: media-only message with no extracted attachment`);
    return;
  }

  const startTime = Date.now();
  const TIMEOUT_MS = 9 * 60 * 1000;     // 9 min — match the web ChatBGP budget so long multi-tool tasks (Why Buy, pathways) don't time out sooner over WhatsApp.
  const MAX_LOOPS = 30;                  // Was 10 — same reason. Hard ceiling guards against runaway loops.
  const resolved = await resolveUserIdFromPhone(fromNumber);
  const userId = resolved.userId;
  console.log(`[whatsapp-ai] Resolved userId=${userId} matched=${resolved.matched} userName=${resolved.userName ?? "—"}`);

  try {
    const chatbgp = await import("./chatbgp");

    const history = await storage.getWaMessages(conversationId);
    const recentHistory = history
      .slice(-20)
      .filter((m) => m.body && m.body.trim() && m.body !== "[Media]");
    let historyMessages: any[] = recentHistory.map((m) => ({
      role: m.direction === "outbound" ? ("assistant" as const) : ("user" as const),
      content: (m.body || "").trim(),
    }));
    while (historyMessages.length > 0 && historyMessages[0].role !== "user") {
      historyMessages.shift();
    }
    if (historyMessages.length === 0) {
      historyMessages = [{ role: "user", content: messageBody || "(image)" }];
    }
    if (imageAttachment) {
      const lastIdx = historyMessages.length - 1;
      const lastMsg = historyMessages[lastIdx];
      const lastText = typeof lastMsg.content === "string" ? lastMsg.content : "";
      historyMessages[lastIdx] = {
        role: "user",
        content: [
          { type: "text", text: lastText || "(see attached image)" },
          { type: "image_url", image_url: { url: `data:${imageAttachment.mediaType};base64,${imageAttachment.base64}` } },
        ],
      };
    }
    console.log(`[whatsapp-ai] History: ${historyMessages.length} messages, first role=${historyMessages[0]?.role}, last role=${historyMessages[historyMessages.length - 1]?.role}, image=${!!imageAttachment}`);

    const fakeReq = {
      session: { userId },
      headers: {},
    } as unknown as Request;

    console.log(`[whatsapp-ai] Loading prompt + tools + context...`);
    const [systemPrompt, learnings, memoryContext, allTools, calendarContext] = await Promise.all([
      chatbgp
        .buildSystemPrompt()
        .catch((e: any) => {
          console.error(`[whatsapp-ai] buildSystemPrompt failed: ${e?.message}`);
          return "You are ChatBGP, the AI assistant for Bruce Gillingham Pollard, a London commercial property agency.";
        }),
      chatbgp.getBusinessLearningsContext().catch((e: any) => {
        console.error(`[whatsapp-ai] getBusinessLearningsContext failed: ${e?.message}`);
        return "";
      }),
      chatbgp.getMemoryContext(userId).catch((e: any) => {
        console.error(`[whatsapp-ai] getMemoryContext failed: ${e?.message}`);
        return "";
      }),
      chatbgp.getAvailableTools().catch((e: any) => {
        console.error(`[whatsapp-ai] getAvailableTools failed: ${e?.message}`);
        return { tools: [] as any[] };
      }),
      chatbgp.getEmailAndCalendarContext(fakeReq).catch((e: any) => {
        console.error(`[whatsapp-ai] getEmailAndCalendarContext failed: ${e?.message}`);
        return "";
      }),
    ]);
    const toolCount = (allTools as any).tools?.length ?? 0;
    console.log(`[whatsapp-ai] Loaded: ${toolCount} tools, sysPrompt=${systemPrompt.length}c, learnings=${learnings.length}c, memories=${memoryContext.length}c, calendar=${calendarContext.length}c`);

    const senderLabel = contactName ? `${contactName} (+${fromNumber})` : `+${fromNumber}`;
    const whatsappSystemPrompt =
      systemPrompt +
      learnings +
      memoryContext +
      calendarContext +
      `\n\n---\nYou are replying over WhatsApp to ${senderLabel}. WhatsApp doesn't render markdown, so use plain text with simple line breaks. Write the full answer the user needs — long replies (lists of emails, multiple comps, a tenancy schedule, etc.) are automatically split into multiple WhatsApp messages on send. DO NOT self-truncate or say "let me know if you want more" when listing things; just list them. Hard ceiling is roughly 12,000 characters total per response, beyond which the messages get unwieldy. If a message is genuinely a no-reply ack ("ok", "thanks"), respond with exactly __SKIP__ to stay silent.\n` +
      `\nCRITICAL — TOOL ACCESS: You have the FULL ChatBGP toolset available here. send_whatsapp IS available and works — use it to send WhatsApp messages to contacts whenever asked. Do NOT claim send_whatsapp is blocked, restricted, or unavailable, and never tell the user to go to the dashboard to send one — just call the tool. HONESTY: only say a message was sent AFTER you have actually called send_whatsapp in THIS turn and seen success:true in the result. Never pre-announce "sent ✓"/"done" before calling it, and never claim it went through if the result is an error — report what actually happened. WhatsApp's rule: a free-form message only reaches someone who has messaged the BGP business number within the last 24 hours; a cold send (e.g. introducing yourself to a new contact who's never messaged us) comes back with an error — relay that error to the user plainly rather than claiming success.\n`;

    const completionOptions: any = {
      model: "claude-opus-4-8",   // parity with the web ChatBGP default (was claude-sonnet-4-6)
      messages: [
        { role: "system", content: whatsappSystemPrompt },
        ...historyMessages,
      ],
      max_completion_tokens: 2048,
      tools: (allTools as any).tools?.length ? (allTools as any).tools : undefined,
    };

    const withTimeout = <T,>(p: Promise<T>): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("WhatsApp AI reply timed out")), TIMEOUT_MS);
      });
      return Promise.race([p, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      }) as Promise<T>;
    };

    console.log(`[whatsapp-ai] Calling Claude (model=${completionOptions.model}, msgs=${completionOptions.messages.length}, tools=${completionOptions.tools?.length ?? 0})...`);
    let claudeResponse = (await withTimeout(chatbgp.callClaude(completionOptions))) as any;
    let currentMessage = claudeResponse.choices?.[0]?.message;
    console.log(`[whatsapp-ai] Claude returned in ${Date.now() - startTime}ms (tool_calls=${currentMessage?.tool_calls?.length ?? 0}, content=${(currentMessage?.content || "").slice(0, 100)})`);
    let loopCount = 0;
    let finalReply = "";

    while (
      currentMessage?.tool_calls &&
      currentMessage.tool_calls.length > 0 &&
      loopCount < MAX_LOOPS
    ) {
      loopCount++;
      const toolCall = currentMessage.tool_calls[0];
      const fnName = toolCall.function.name;
      console.log(`[whatsapp-ai] Tool call ${loopCount}: ${fnName}`);
      let fnArgs: any;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch (parseErr: any) {
        console.error("[whatsapp-ai] Bad tool args JSON:", parseErr?.message);
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Invalid JSON in tool arguments" }),
        });
        claudeResponse = (await withTimeout(chatbgp.callClaude(completionOptions))) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
        continue;
      }

      try {
        // Try the legacy CRM dispatcher first (handles a subset with friendly summaries),
        // then fall back to the unified raw executor (handles send_whatsapp, search_*,
        // KYC, calendar, email, SharePoint, file generation, web search, deep_investigate,
        // ingest, navigation — basically everything else). Without this fallback, anything
        // outside handleCrmToolCall returns "Tool not handled" and Claude wrongly believes
        // the tool is blocked over WhatsApp.
        let result: any = await chatbgp.handleCrmToolCall(
          fnName,
          fnArgs,
          fakeReq,
          completionOptions,
          currentMessage,
          toolCall,
        );
        if (result?.handled && result.response) {
          finalReply = result.response.reply || "";
          console.log(`[whatsapp-ai] Tool ${fnName} returned final reply (${finalReply.length}c)`);
          break;
        }
        if (!(result?.data !== undefined || result?.response !== undefined)) {
          // handleCrmToolCall returned { handled: false } — try the unified executor.
          console.log(`[whatsapp-ai] ${fnName} not in handleCrmToolCall, trying executeCrmToolRaw`);
          try {
            result = await chatbgp.executeCrmToolRaw(fnName, fnArgs, fakeReq);
          } catch (rawErr: any) {
            console.error(`[whatsapp-ai] executeCrmToolRaw failed for ${fnName}:`, rawErr?.message);
            result = { data: { error: rawErr?.message || "Tool execution failed" } };
          }
        }
        const toolResultPayload = result?.data !== undefined
          ? result.data
          : (result?.response ?? { error: "Tool returned no result" });
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResultPayload),
        });
        claudeResponse = (await withTimeout(chatbgp.callClaude(completionOptions))) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
      } catch (toolErr: any) {
        console.error("[whatsapp-ai] Tool error:", toolErr?.message);
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: toolErr?.message || "Tool execution failed" }),
        });
        claudeResponse = (await withTimeout(chatbgp.callClaude(completionOptions))) as any;
        currentMessage = claudeResponse.choices?.[0]?.message;
      }
    }

    if (!finalReply) finalReply = currentMessage?.content || "";

    if (!finalReply || finalReply.trim() === "__SKIP__") {
      console.log(`[whatsapp-ai] Skipped reply to ${fromNumber} in ${Date.now() - startTime}ms`);
      return;
    }

    await sendAndStoreReply(finalReply.trim(), fromNumber, conversationId, contactName, config);
    console.log(
      `[whatsapp-ai] Replied to ${fromNumber} in ${Date.now() - startTime}ms (${loopCount} tool calls)`,
    );

    chatbgp
      .extractAndSaveMemories(userId, messageBody, finalReply.trim())
      .catch((err: any) => console.error("[whatsapp-ai] Memory extraction error:", err?.message));
  } catch (err: any) {
    console.error("[whatsapp-ai] Reply failed:", err?.message);
  }
}

export async function sendWhatsAppDocument(config: ReturnType<typeof getWhatsAppConfig>, to: string, pdfBuffer: Buffer, filename: string, caption: string): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), filename);
    formData.append("type", "application/pdf");

    const uploadRes = await fetch(`${GRAPH_API_URL}/${config.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      body: formData,
    });
    if (!uploadRes.ok) {
      console.error(`[whatsapp] Media upload failed: ${await uploadRes.text()}`);
      return false;
    }
    const media = await uploadRes.json();
    const mediaId = media.id;

    const sendRes = await fetch(`${GRAPH_API_URL}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: { id: mediaId, filename, caption: caption || "BGP Document" },
      }),
    });
    if (!sendRes.ok) {
      console.error(`[whatsapp] Document send failed: ${await sendRes.text()}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[whatsapp] Document send error: ${err?.message}`);
    return false;
  }
}

const sendMessageSchema = z.object({
  to: z.string().min(1, "Phone number is required").regex(/^\d+$/, "Phone number must contain only digits"),
  body: z.string().min(1, "Message body is required").max(4096, "Message too long"),
  contactName: z.string().optional(),
});

export function setupWhatsAppRoutes(app: Express) {
  app.get("/api/whatsapp/webhook", (req: Request, res: Response) => {
    const config = getWhatsAppConfig();
    const mode = req.query["hub.mode"] as string;
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"] as string;

    if (mode === "subscribe" && token === config.verifyToken) {
      console.log("WhatsApp webhook verified");
      return res.status(200).send(challenge);
    }

    console.warn("WhatsApp webhook verification failed");
    res.sendStatus(403);
  });

  app.post("/api/whatsapp/webhook", async (req: Request, res: Response) => {
    const config = getWhatsAppConfig();
    // Fail closed: without an app secret we can't verify the payload came
    // from Meta, so reject rather than ingest unsigned posts.
    if (!config.appSecret) {
      console.warn("WhatsApp webhook rejected: app secret not configured — set it to re-enable inbound messages");
      return res.sendStatus(403);
    }
    if (!verifyWebhookSignature(req, config.appSecret)) {
      console.warn("WhatsApp webhook signature verification failed");
      return res.sendStatus(403);
    }

    res.sendStatus(200);

    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== "messages") continue;
          const value = change.value;

          if (value.statuses) {
            for (const status of value.statuses) {
              console.log(`WhatsApp status update: ${status.id} -> ${status.status}`);
            }
          }

          if (value.messages) {
            for (const msg of value.messages) {
              const fromNumber = msg.from;
              const contactInfo = value.contacts?.[0];
              const contactName = contactInfo?.profile?.name || null;
              const mediaObj = msg.document || msg.image;
              const mediaCaption = (msg.document?.caption || msg.image?.caption || "").trim();
              // Store media with a descriptive body rather than a bare
              // "[Media]" — the latter is filtered out of ChatBGP history, so
              // a brochure/file event would otherwise vanish and the agent
              // loses continuity on follow-up messages.
              // Shared contact cards (msg.type === "contacts") used to fall
              // through as the bare word "contacts" — ChatBGP saw nothing to
              // act on (Woody, 2026-08-25). Parse the vCard payload into text
              // with a filing instruction so the card lands in the CRM.
              const sharedContacts: any[] | null = Array.isArray(msg.contacts) && msg.contacts.length ? msg.contacts : null;
              const sharedContactsBody = sharedContacts
                ? `[Shared WhatsApp contact card${sharedContacts.length > 1 ? "s" : ""}] ` +
                  sharedContacts.slice(0, 5).map((cc: any) => {
                    const nm = cc?.name?.formatted_name || [cc?.name?.first_name, cc?.name?.last_name].filter(Boolean).join(" ") || "Unknown";
                    const phones = (cc?.phones || []).map((p: any) => p.phone).filter(Boolean).join(", ");
                    const emails = (cc?.emails || []).map((e: any) => e.email).filter(Boolean).join(", ");
                    const org = cc?.org?.company;
                    return `${nm}${org ? ` (${org})` : ""}${phones ? ` — ${phones}` : ""}${emails ? ` — ${emails}` : ""}`;
                  }).join(" | ") +
                  ` — file into the CRM: create or update the contact, attach it to the matching company if the name fits one, then confirm exactly what was saved.`
                : null;
              const messageBody = msg.text?.body
                || sharedContactsBody
                || (msg.document ? `[Sent file: ${msg.document.filename || "document"}]${mediaCaption ? ` — "${mediaCaption}"` : ""}` : null)
                || (msg.image ? `[Sent an image]${mediaCaption ? ` — "${mediaCaption}"` : ""}` : null)
                || msg.type
                || "[Media]";

              const conversation = await storage.upsertWaConversation(
                fromNumber,
                contactName,
                messageBody
              );

              await storage.createWaMessage({
                conversationId: conversation.id,
                waMessageId: msg.id,
                direction: "inbound",
                fromNumber,
                toNumber: config.phoneNumberId || "",
                body: messageBody,
                status: "received",
                timestamp: new Date(parseInt(msg.timestamp) * 1000),
              });

              console.log(`WhatsApp message from ${fromNumber}: ${messageBody.slice(0, 50)}`);

              // Receipt-matching path — if the sender is a registered cardholder
              // and has a pending_receipt expense within the last 24h, treat this
              // photo/document as the receipt for that expense.
              if ((msg.type === "image" || msg.type === "document") && (msg.document || msg.image)?.id && config.token) {
                try {
                  const { tryMatchReceiptToExpense } = await import("./expense-receipt-handler");
                  const matched = await tryMatchReceiptToExpense({
                    fromNumber,
                    contactName: contactName || fromNumber,
                    mediaId: (msg.document || msg.image)!.id,
                    mediaType: msg.type,
                    caption: (msg.document?.caption || msg.image?.caption || "").trim(),
                    config,
                    sendReply: (text: string) => sendWhatsAppText(config, fromNumber, text),
                  });
                  if (matched) continue;
                } catch (err: any) {
                  console.error("[whatsapp-receipt]", err?.message);
                  // fall through to existing ingest / vision paths
                }
              }

              // Auto-ingest only fires when the caption clearly indicates intent
              // ("import this brochure", "this is a leasing schedule", etc.) — for
              // both images and documents. Without intent, route through ChatBGP
              // so it can read the file and respond conversationally, like on the
              // dashboard. The universal-ingest pipeline (built on the other
              // branch) is preserved and still triggered when intent is clear.
              const captionWantsImport = /\b(import|ingest|add|upload|save|file)\s+(this|that|it|the\s+\w+)\b|\b(this is|here'?s)\s+(a\s+)?(brochure|deal|property|leasing|rent|schedule|contact|company|list)\b/i.test(mediaCaption);
              const shouldAutoIngest = (msg.type === "document" || msg.type === "image") && captionWantsImport;

              if (shouldAutoIngest && mediaObj?.id && config.token) {
                (async () => {
                  try {
                    await sendWhatsAppText(config, fromNumber, "⏳ Processing your file — I'll import it and let you know what was found...");
                    const { bytes, filename } = await downloadWhatsAppMedia(mediaObj.id, config.token!);
                    const overrideName = msg.document?.filename || filename;
                    // Available-property (to-let) flyer? Route to external_properties
                    // (outside the CRM, deduped) so it lands on the Available
                    // Properties map. Anything else falls through to normal ingest.
                    const isPdfFlyer = /\.pdf$/i.test(overrideName) || /pdf/i.test(msg.document?.mime_type || "");
                    if (isPdfFlyer) {
                      try {
                        const { ingestAvailableProperty } = await import("./property-ingest");
                        const avail = await ingestAvailableProperty({ source: "WhatsApp", pdfBuffer: bytes, originalName: overrideName });
                        if (avail.ok && avail.confidence !== "low") {
                          await sendAndStoreReply(`✅ Added to Available Properties: ${avail.address}${avail.duplicate ? " (updated existing)" : ""}`, fromNumber, conversation.id, contactName, config);
                          return;
                        }
                      } catch (err: any) {
                        console.warn("[whatsapp-ingest] available-property ingest failed:", err?.message);
                      }
                    }
                    const result = await ingestBytes({ bytes, filename: overrideName, userId: fromNumber, userName: contactName || fromNumber });
                    const errCount = Array.isArray(result.errors) ? result.errors.length : 0;
                    const reply = `✅ Imported from ${overrideName}:\n${result.narrative}\n\n${result.written} record(s) written${errCount > 0 ? `, ${errCount} error(s)` : ""}.`;
                    await sendAndStoreReply(reply, fromNumber, conversation.id, contactName, config);
                    if (mediaCaption) {
                      const followUp = `${mediaCaption}\n\n[Context: I just imported the file "${overrideName}" — ${result.written} record(s) created. Reply to the user about their question or instruction above, in light of the import result.]`;
                      runChatBgpWhatsAppReply(followUp, fromNumber, contactName, conversation.id, config).catch(
                        (err: any) => console.error("[whatsapp-ai] Caption follow-up error:", err?.message),
                      );
                    }
                  } catch (err: any) {
                    console.error("[whatsapp-ingest]", err?.message);
                    await sendAndStoreReply(`❌ Couldn't import that file: ${err?.message || "unknown error"}. Try sending it via the BGP app instead.`, fromNumber, conversation.id, contactName, config).catch(() => {});
                  }
                })();
                continue;
              }

              // Plain image (no import-intent caption) — pass to ChatBGP with
              // vision so it can actually see and respond to the image content.
              if (msg.type === "image" && mediaObj?.id && config.token) {
                (async () => {
                  let imageAttachment: { mediaType: string; base64: string } | undefined;
                  try {
                    const { bytes, mimeType } = await downloadWhatsAppMedia(mediaObj.id, config.token!);
                    if (bytes && bytes.length > 0) {
                      // Persist the inbound photo to durable file_storage (same
                      // chat-media/ pattern as the document branch + ChatBGP
                      // uploads) so it's retrievable later instead of being lost
                      // after the transient vision pass.
                      try {
                        const imgExt = (mimeType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
                        const safeImgName = `${msg.image?.id || "image"}.${imgExt}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
                        const stamped = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeImgName}`;
                        const { saveFile } = await import("./file-storage");
                        await saveFile(`chat-media/${stamped}`, bytes, mimeType.startsWith("image/") ? mimeType : "image/jpeg", safeImgName);
                      } catch (saveErr: any) {
                        console.error(`[whatsapp-ai] Image save failed: ${saveErr?.message}`);
                      }
                    }
                    if (bytes && bytes.length > 0 && bytes.length < 5 * 1024 * 1024) {
                      imageAttachment = {
                        mediaType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
                        base64: bytes.toString("base64"),
                      };
                    } else if (bytes && bytes.length >= 5 * 1024 * 1024) {
                      console.warn(`[whatsapp-ai] Image too large for vision (${bytes.length}B), skipping`);
                    }
                  } catch (err: any) {
                    console.error(`[whatsapp-ai] Image download failed: ${err?.message}`);
                  }
                  const aiBody = mediaCaption || "(see attached image)";
                  runChatBgpWhatsAppReply(aiBody, fromNumber, contactName, conversation.id, config, imageAttachment).catch(
                    (err: any) => console.error("[whatsapp-ai] Image follow-up error:", err?.message),
                  );
                })();
                continue;
              }

              // Plain document (no import-intent caption) — first try the
              // direct brochure pipeline (PDF, 3+ pages → property
              // match-or-create + bespoke ingest). If it's not a
              // brochure, fall back to ChatBGP via read_document.
              if (msg.type === "document" && mediaObj?.id && config.token) {
                (async () => {
                  let docFilename = msg.document?.filename || `document`;
                  let bytes: Buffer | null = null;
                  let mimeType = "application/octet-stream";
                  try {
                    const dl = await downloadWhatsAppMedia(mediaObj.id, config.token!);
                    bytes = dl.bytes;
                    mimeType = dl.mimeType;
                    docFilename = msg.document?.filename || dl.filename;
                  } catch (err: any) {
                    console.error(`[whatsapp-ai] Document download failed: ${err?.message}`);
                  }

                  if (bytes) {
                    // Try direct brochure ingest (PDF + 3+ pages). Returns
                    // handled=true if we kicked off the bespoke pipeline;
                    // we then return without engaging ChatBGP.
                    try {
                      const { tryIngestBrochure } = await import("./whatsapp-brochure-pipeline");
                      const resolved = await resolveUserIdFromPhone(fromNumber);
                      const matchingUser = resolved.matched ? { id: resolved.userId, name: resolved.userName } : null;
                      const result = await tryIngestBrochure({
                        bytes,
                        mimeType,
                        filename: docFilename,
                        source: "whatsapp",
                        userId: matchingUser?.id || null,
                        caption: mediaCaption,
                        // Store every pipeline reply as an outbound message so
                        // ChatBGP reads "created Marylebone Village (Pipeline)
                        // from a brochure" on the next turn instead of losing
                        // the thread and confabulating a different property.
                        sendReply: (text) => sendAndStoreReply(text, fromNumber, conversation.id, contactName, config),
                      });
                      if (result.handled) return;
                    } catch (err: any) {
                      console.error(`[whatsapp-ai] Brochure pipeline failed: ${err?.message}`);
                    }
                  }

                  // Fallback — save to chat-media + hand to ChatBGP. The
                  // universal read_document tool then takes over.
                  let chatMediaKey: string | null = null;
                  if (bytes) {
                    try {
                      const safeName = docFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
                      const stamped = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`;
                      chatMediaKey = `chat-media/${stamped}`;
                      const { saveFile } = await import("./file-storage");
                      await saveFile(chatMediaKey, bytes, mimeType || "application/octet-stream", docFilename);
                    } catch (err: any) {
                      console.error(`[whatsapp-ai] Document save failed: ${err?.message}`);
                    }
                  }
                  const intro = mediaCaption || "(see attached document)";
                  const aiBody = chatMediaKey
                    ? `${intro}\n\n[Attached file: "${docFilename}" — saved at ${chatMediaKey}. Call read_document with chatMediaFilename="${chatMediaKey.replace(/^chat-media\//, "")}" to read it, then file anything useful into the CRM per the auto-ingest rules.]`
                    : `${intro}\n\n[Attached file: "${docFilename}" — couldn't be saved, skip.]`;
                  runChatBgpWhatsAppReply(aiBody, fromNumber, contactName, conversation.id, config).catch(
                    (err: any) => console.error("[whatsapp-ai] Document follow-up error:", err?.message),
                  );
                })();
                continue;
              }

              if (messageBody && messageBody !== "[Media]") {
                const docHandled = messageBody.length > 10
                  ? await detectAndGenerateDocument(messageBody, fromNumber, config)
                  : false;
                if (docHandled) continue;

                // Instant contact card for staff lookup texts — no-match
                // falls straight through to ChatBGP.
                const lookedUp = await tryWhatsAppContactLookup(
                  messageBody,
                  fromNumber,
                  (text) => sendAndStoreReply(text, fromNumber, conversation.id, contactName, config),
                ).catch((err: any) => { console.error("[whatsapp-lookup] top-level:", err?.message); return false; });
                if (lookedUp) continue;

                runChatBgpWhatsAppReply(messageBody, fromNumber, contactName, conversation.id, config).catch(
                  (err: any) => console.error("[whatsapp-ai] Top-level error:", err?.message),
                );
              }

              if (messageBody && messageBody !== "[Media]" && messageBody.length > 10) {
                try {
                  const existingLeads = await storage.getLeadsByEmailId(conversation.id);
                  const recentLeads = existingLeads.filter((l) => {
                    const created = l.createdAt ? new Date(l.createdAt).getTime() : 0;
                    return Date.now() - created < 60000;
                  });
                  if (recentLeads.length === 0) {
                    const contactLabel = contactName || fromNumber;
                    const result = await autoProcessAndPush(
                      conversation.id,
                      "whatsapp",
                      `WhatsApp from ${contactLabel}`,
                      messageBody,
                      contactLabel
                    );
                    if (result.leads.length > 0) {
                      console.log(`Auto-extracted ${result.leads.length} lead(s) from WhatsApp message`);
                    }
                  }
                } catch (aiErr) {
                  console.error("WhatsApp auto-process error (non-fatal):", aiErr);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("WhatsApp webhook processing error:", err);
    }
  });

  app.get("/api/whatsapp/status", requireAuth, async (_req: Request, res: Response) => {
    const config = getWhatsAppConfig();
    const connected = !!(config.token && config.phoneNumberId);
    if (!connected) return res.json({ connected: false, tokenValid: false });

    // Probe the Graph API to confirm the token actually works against this
    // phone number. Cheap GET, surfaces token expiry / number detachment /
    // permission issues without requiring a real send.
    try {
      const probe = await fetch(`${GRAPH_API_URL}/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (probe.ok) {
        const data = await probe.json().catch(() => ({}));
        return res.json({
          connected: true,
          tokenValid: true,
          displayPhoneNumber: data.display_phone_number,
          verifiedName: data.verified_name,
          qualityRating: data.quality_rating,
        });
      }
      const body: any = await probe.json().catch(() => ({}));
      return res.json({
        connected: true,
        tokenValid: false,
        error: {
          status: probe.status,
          code: body?.error?.code,
          subcode: body?.error?.error_subcode,
          message: body?.error?.message,
          type: body?.error?.type,
        },
      });
    } catch (err: any) {
      return res.json({ connected: true, tokenValid: false, error: { message: err?.message || "Probe failed" } });
    }
  });

  app.get("/api/whatsapp/conversations", requireAuth, async (_req: Request, res: Response) => {
    try {
      const conversations = await storage.getWaConversations();
      res.json(conversations);
    } catch (err) {
      console.error("Conversations error:", err);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/whatsapp/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      if (!/^[a-f0-9-]+$/.test(id)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      const conversation = await storage.getWaConversation(id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      await storage.markWaConversationRead(id);
      const messages = await storage.getWaMessages(id);
      res.json({ conversation, messages });
    } catch (err) {
      console.error("Messages error:", err);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/whatsapp/messages", requireAuth, async (req: Request, res: Response) => {
    const config = getWhatsAppConfig();
    if (!config.token || !config.phoneNumberId) {
      return res.status(400).json({ message: "WhatsApp is not configured" });
    }

    const result = sendMessageSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ message: result.error.errors[0]?.message || "Invalid input" });
    }

    const { to, body, contactName } = result.data;

    try {
      const response = await fetch(
        `${GRAPH_API_URL}/${config.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body },
          }),
        }
      );

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => null);
        console.error("WhatsApp send error:", response.status, errorData);
        const metaErr = errorData?.error || {};
        return res.status(response.status === 401 || response.status === 403 ? response.status : 502).json({
          message: metaErr.message || "Failed to send message",
          code: metaErr.code,
          subcode: metaErr.error_subcode,
          type: metaErr.type,
          status: response.status,
        });
      }

      const data = await response.json();
      const waMessageId = data.messages?.[0]?.id;

      const conversation = await storage.upsertWaConversation(to, contactName || null, body);

      if (conversation.unreadCount && conversation.unreadCount > 0) {
        await storage.markWaConversationRead(conversation.id);
      }

      const message = await storage.createWaMessage({
        conversationId: conversation.id,
        waMessageId,
        direction: "outbound",
        fromNumber: config.phoneNumberId,
        toNumber: to,
        body,
        status: "sent",
        timestamp: new Date(),
      });

      res.json({ message, conversation });
    } catch (err) {
      console.error("WhatsApp send error:", err);
      res.status(500).json({ message: "Failed to send message" });
    }
  });
}
