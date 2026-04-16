import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { getSharedMailboxMessages, getAppToken } from "./shared-mailbox";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";

const SHARED_MAILBOX_EMAIL = "chatbgp@brucegillinghampollard.com";

const AI_EXTRACT_PROMPT = `You are a property news analyst for Bruce Gillingham Pollard (BGP), a leading property consultancy in London focusing on Belgravia, Mayfair, and Chelsea.

Analyse the following message for relevant commercial or residential property news. Extract potential leads.

For EACH relevant lead found, output a JSON object with these fields:
- title: Short headline for the lead (max 80 chars)
- summary: 2-3 sentence summary of the opportunity
- area: The London area (e.g. "Belgravia", "Mayfair", "Chelsea", "SW1", "W1", or other)
- propertyType: Type (e.g. "Retail", "Office", "Residential", "Mixed-use", "Restaurant", "F&B")
- opportunityType: What kind of opportunity (e.g. "New Letting", "Lease Expiry", "Assignment", "Development", "Acquisition", "Disposal")
- confidence: "high", "medium", or "low" - how relevant this is to BGP's focus areas
- suggestedAction: A brief recommended next step
- contactName: Name of the contact if mentioned (or null)
- contactPhone: Phone number if available (or null)
- contactEmail: Email address if available (or null)

If the message contains NO relevant property news for the Belgravia/Mayfair/Chelsea market, return an empty array.

IMPORTANT: Return ONLY valid JSON - an array of objects. No markdown, no explanation.`;

export async function processMessageWithAI(subject: string, bodyText: string): Promise<any[]> {
  const completion = await callClaude({
    model: CHATBGP_HELPER_MODEL,
    messages: [
      { role: "system", content: AI_EXTRACT_PROMPT },
      {
        role: "user",
        content: `Subject: ${subject || "(no subject)"}\n\nBody:\n${(bodyText || "").slice(0, 8000)}`,
      },
    ],
    max_completion_tokens: 2048,
  });

  const raw = completion.choices[0]?.message?.content || "[]";
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.error("Failed to parse AI response:", raw);
    return [];
  }
}

export async function autoProcessAndPush(
  sourceId: string,
  sourceType: "email" | "whatsapp",
  subject: string,
  bodyText: string,
  sourceLabel: string
): Promise<{ leads: any[] }> {
  const leads = await processMessageWithAI(subject, bodyText);
  const created = [];

  for (const lead of leads) {
    const saved = await storage.createLead({
      emailId: sourceId,
      title: lead.title || "Untitled Lead",
      summary: lead.summary || "",
      area: lead.area || null,
      propertyType: lead.propertyType || null,
      opportunityType: lead.opportunityType || null,
      confidence: lead.confidence || "medium",
      source: `${sourceType === "whatsapp" ? "WhatsApp: " : ""}${sourceLabel}`,
      suggestedAction: lead.suggestedAction || null,
      status: "draft",
    });
    created.push(saved);
  }

  return { leads: created };
}

export function setupNewsIntelligenceRoutes(app: Express) {
  app.get("/api/news-intel/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      await getAppToken();
      res.json({ connected: true, emailAddress: SHARED_MAILBOX_EMAIL });
    } catch (err: any) {
      console.error("News intel status error:", err?.message);
      res.json({ connected: false, error: err?.message });
    }
  });

  app.get("/api/news-intel/inbox", requireAuth, async (_req: Request, res: Response) => {
    try {
      const messages = await getSharedMailboxMessages(undefined, 100, 0);

      let newCount = 0;
      for (const msg of messages) {
        const graphId = msg.id;
        const existing = await storage.getEmailByMessageId(graphId);
        if (!existing) {
          const fromAddr = msg.from?.emailAddress?.address || "unknown";
          const subject = msg.subject || "(no subject)";
          const bodyPreview = msg.bodyPreview || "";
          const bodyText = msg.body?.content
            ? msg.body.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            : bodyPreview;

          await storage.createEmail({
            messageId: graphId,
            inboxId: SHARED_MAILBOX_EMAIL,
            fromAddress: fromAddr,
            subject,
            bodyPreview,
            bodyText,
            receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
            status: "new",
          });
          newCount++;
        }
      }

      const emails = await storage.getEmails();
      res.json({ emails, newCount });
    } catch (err: any) {
      console.error("Inbox fetch error:", err?.message);
      res.status(500).json({ message: "Failed to fetch inbox" });
    }
  });

  app.post("/api/news-intel/process/:emailId", requireAuth, async (req: Request, res: Response) => {
    try {
      const emailId = req.params.emailId as string;
      if (!emailId || !/^[a-zA-Z0-9-]+$/.test(emailId)) {
        return res.status(400).json({ message: "Invalid email ID" });
      }

      const emails = await storage.getEmails();
      const email = emails.find((e) => e.id === emailId);
      if (!email) {
        return res.status(404).json({ message: "Email not found" });
      }

      const result = await autoProcessAndPush(
        email.id,
        "email",
        email.subject || "",
        email.bodyText || email.bodyPreview || "",
        email.fromAddress
      );

      await storage.updateEmailStatus(email.id, "processed");

      res.json({
        message: `Processed ${result.leads.length} lead(s)`,
        leads: result.leads,
      });
    } catch (err: any) {
      console.error("Process email error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to process email" });
    }
  });

  app.get("/api/news-intel/leads", requireAuth, async (_req: Request, res: Response) => {
    try {
      const leads = await storage.getLeads();
      res.json(leads);
    } catch (err: any) {
      console.error("Leads fetch error:", err?.message);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.post("/api/news-intel/process-whatsapp/:conversationId", requireAuth, async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.conversationId as string;
      if (!conversationId || !/^[a-f0-9-]+$/.test(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      const conversation = await storage.getWaConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const messages = await storage.getWaMessages(conversationId);
      const inboundMessages = messages.filter((m) => m.direction === "inbound");
      if (inboundMessages.length === 0) {
        return res.json({ message: "No inbound messages to process", leads: [] });
      }

      const combinedBody = inboundMessages
        .map((m) => `[${new Date(m.timestamp!).toLocaleString()}] ${m.body}`)
        .join("\n\n");

      const contactLabel = conversation.contactName || conversation.waPhoneNumber;

      const result = await autoProcessAndPush(
        conversationId,
        "whatsapp",
        `WhatsApp from ${contactLabel}`,
        combinedBody,
        contactLabel
      );

      res.json({
        message: `Processed ${result.leads.length} lead(s) from WhatsApp`,
        leads: result.leads,
      });
    } catch (err: any) {
      console.error("Process WhatsApp error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to process WhatsApp messages" });
    }
  });
}
