import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { z } from "zod";
import { autoProcessAndPush } from "./news-intelligence";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function getWhatsAppConfig() {
  const token = (process.env.WHATSAPP_TOKEN_V2 || process.env.WHATSAPP_ACCESS_TOKEN)?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  return { token, phoneNumberId, verifyToken, appSecret };
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

async function runChatBgpWhatsAppReply(
  messageBody: string,
  fromNumber: string,
  contactName: string | null,
  conversationId: string,
  config: ReturnType<typeof getWhatsAppConfig>,
): Promise<void> {
  if (!config.token || !config.phoneNumberId) return;
  if (!messageBody || messageBody === "[Media]") return;

  const startTime = Date.now();
  const TIMEOUT_MS = 90_000;
  const MAX_LOOPS = 10;
  const userId = `wa:${fromNumber}`;

  try {
    const chatbgp = await import("./chatbgp");

    const history = await storage.getWaMessages(conversationId);
    const recentHistory = history
      .slice(-20)
      .filter((m) => m.body && m.body.trim() && m.body !== "[Media]");
    const historyMessages = recentHistory.map((m) => ({
      role: m.direction === "outbound" ? ("assistant" as const) : ("user" as const),
      content: (m.body || "").trim(),
    }));

    const fakeReq = {
      session: { userId },
      headers: {},
    } as unknown as Request;

    const [systemPrompt, learnings, memoryContext, allTools, calendarContext] = await Promise.all([
      chatbgp
        .buildSystemPrompt()
        .catch(() => "You are ChatBGP, the AI assistant for Bruce Gillingham Pollard, a London commercial property agency."),
      chatbgp.getBusinessLearningsContext().catch(() => ""),
      chatbgp.getMemoryContext(userId).catch(() => ""),
      chatbgp.getAvailableTools().catch(() => ({ tools: [] as any[] })),
      chatbgp.getEmailAndCalendarContext(fakeReq).catch(() => ""),
    ]);

    const senderLabel = contactName ? `${contactName} (+${fromNumber})` : `+${fromNumber}`;
    const whatsappSystemPrompt =
      systemPrompt +
      learnings +
      memoryContext +
      calendarContext +
      `\n\n---\nIMPORTANT — WHATSAPP REPLY MODE\n` +
      `You are replying over WhatsApp to ${senderLabel}.\n` +
      `- Plain text only — no markdown headers, tables, or heavy bullet lists. Short paragraphs and simple line breaks read best on WhatsApp.\n` +
      `- Keep replies concise and conversational (2–5 sentences usually). If a longer answer is genuinely needed, send it, but stay under 3500 characters.\n` +
      `- You have access to the full ChatBGP toolset — use tools when the user asks for CRM, calendar, email, KYC, document or other lookups.\n` +
      `- If the user shares a useful insight, lesson, or correction worth remembering company-wide, call save_learning so future conversations benefit.\n` +
      `- If the message is purely a casual acknowledgement ("ok", "thanks", "got it") and no real reply is needed, respond with exactly __SKIP__ and nothing else.\n`;

    const completionOptions: any = {
      model: "claude-sonnet-4-6",
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

    let claudeResponse = (await withTimeout(chatbgp.callClaude(completionOptions))) as any;
    let currentMessage = claudeResponse.choices?.[0]?.message;
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
        const result = await chatbgp.handleCrmToolCall(
          fnName,
          fnArgs,
          fakeReq,
          completionOptions,
          currentMessage,
          toolCall,
        );
        if (result?.handled && result.response) {
          finalReply = result.response.reply || "";
          break;
        }
        completionOptions.messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
        completionOptions.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result?.response ?? { error: "Tool not handled" }),
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

async function sendWhatsAppDocument(config: ReturnType<typeof getWhatsAppConfig>, to: string, pdfBuffer: Buffer, filename: string, caption: string): Promise<boolean> {
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
    if (config.appSecret) {
      if (!verifyWebhookSignature(req, config.appSecret)) {
        console.warn("WhatsApp webhook signature verification failed");
        return res.sendStatus(403);
      }
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
              const messageBody = msg.text?.body || msg.type || "[Media]";

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

              if (messageBody && messageBody !== "[Media]") {
                const docHandled = messageBody.length > 10
                  ? await detectAndGenerateDocument(messageBody, fromNumber, config)
                  : false;
                if (docHandled) continue;

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
