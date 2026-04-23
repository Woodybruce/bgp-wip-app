import type { Express, Request, Response, NextFunction } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { chatbgpEmailLog, crmContacts, crmCompanies, crmInteractions, users } from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { getSharedMailboxMessages, getSharedMailboxMessageById, sendFromSharedMailbox, replyToSharedMailboxMessage, markMessageRead, getAppToken, EmailAttachment } from "./shared-mailbox";
import { callClaude, CHATBGP_HELPER_MODEL, safeParseJSON } from "./utils/anthropic-client";
import { generateAutonomousDocument, exportDocumentToPdf } from "./document-templates";

const SHARED_MAILBOX = "chatbgp@brucegillinghampollard.com";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Convert Microsoft Graph message HTML/text body to a plain-text string
// that preserves readable structure. The old extractor preferred
// bodyPreview (always just ~255 chars from Graph) or did a crude tag
// strip — result was empty or near-empty text for forwarded newsletters
// where the actual content sits in nested HTML.
function htmlToText(html: string): string {
  if (!html) return "";
  let s = html;
  // Drop scripts/styles entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Block-level and <br> tags become newlines BEFORE stripping remaining tags.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|article|section)\s*>/gi, "\n");
  s = s.replace(/<\s*hr\s*\/?\s*>/gi, "\n---\n");
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, " ");
  // Decode the common HTML entities. Anything else we leave — the classifier
  // can cope with a stray &mdash;.
  s = s.replace(/&nbsp;/g, " ")
       .replace(/&amp;/g, "&")
       .replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'")
       .replace(/&apos;/g, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
       .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Collapse runs of whitespace but keep paragraph breaks.
  s = s.replace(/[ \t]+/g, " ")
       .replace(/\n[ \t]+/g, "\n")
       .replace(/\n{3,}/g, "\n\n")
       .trim();
  return s;
}

// Pick the richest readable body for a Microsoft Graph message. Falls
// back through body.content → bodyPreview so forwarded newsletters
// (where the bulletin HTML is in body.content) no longer look blank.
function extractEmailBodyText(msg: any): string {
  const raw = msg?.body?.content || "";
  const type = (msg?.body?.contentType || "").toLowerCase();
  let text = "";
  if (raw) {
    text = type === "html" ? htmlToText(raw) : raw;
  }
  // If Graph gave us nothing useful but had a preview, use that so we
  // at least get SOMETHING through to the classifier.
  if (!text.trim() && msg?.bodyPreview) text = msg.bodyPreview;
  // Cap at 20k chars — classifier only reads ~6k, but we keep some
  // headroom so specialist prompts can see more context later.
  return text.slice(0, 20000);
}

let registeredUserEmails: Set<string> | null = null;
let registeredUsersCacheTime = 0;

async function isAppUser(email: string): Promise<boolean> {
  if (!registeredUserEmails || Date.now() - registeredUsersCacheTime > 5 * 60 * 1000) {
    const allUsers = await db.select({ email: users.email }).from(users);
    registeredUserEmails = new Set(allUsers.map(u => u.email?.toLowerCase()).filter(Boolean) as string[]);
    registeredUsersCacheTime = Date.now();
  }
  return registeredUserEmails.has(email.toLowerCase());
}

const BGP_DOMAIN = "@brucegillinghampollard.com";

const ADMIN_EMAILS = [
  "woody@brucegillinghampollard.com",
  "accounts@brucegillinghampollard.com",
  "charlotte@brucegillinghampollard.com",
  "jack@brucegillinghampollard.com",
  "rupert@brucegillinghampollard.com",
];

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) {
      return res.status(403).json({ message: "Access restricted to senior management" });
    }
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.email || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res.status(403).json({ message: "Access restricted to senior management" });
    }
    next();
  } catch {
    return res.status(403).json({ message: "Access restricted" });
  }
}

const BGP_STAFF_EMAILS = [
  "woody", "rupert", "lucy", "sohail", "tom", "ollie", "willp", "emily",
  "emilyc", "lizzie", "cara", "victoria", "bruce", "sophie", "alex",
  "charlie", "henry", "james", "george", "freddie", "nick", "max",
  "harry", "harrye", "will", "ed", "matt", "ben", "sam", "joe", "charlotte", "jack",
  "accounts", "harriette", "alext",
].map(n => `${n}${BGP_DOMAIN}`);

const CLASSIFICATION_PROMPT = `You are an AI email classifier for ChatBGP, the AI assistant at Bruce Gillingham Pollard (BGP), a London property consultancy.

Analyse the incoming email and classify it into ONE of these categories:

1. **instruction** — A BGP team member is sending anything to ChatBGP: questions, requests, forwarded emails, FYIs, updates, "look at this", "deal with this", or anything that expects a response. If a BGP staff member sent the email, this is almost always the correct classification. Forwarded emails (Fw:/FW:) from BGP staff are instructions — the person is asking ChatBGP to review, track, or act on the forwarded content.
2. **cc_correspondence** — A BGP team member has CC'd ChatBGP (not sent TO it directly) on correspondence with an external contact. The email is primarily between other people and ChatBGP should just log the interaction.
3. **news** — Property market news, agent circulars, availability updates from EXTERNAL sources (not BGP staff). Newsletters, market reports, etc.
4. **document** — An email containing documents/attachments from external sources that need to be filed.
5. **auto_reply** — Automated messages, out-of-office replies, delivery receipts, bounce-backs, system notifications, or verification codes that need no action.
6. **unknown** — Cannot be classified. Use this ONLY for genuinely unclassifiable emails, NOT for emails from BGP staff (those should be "instruction").

Also extract:
- A brief summary of what the email is about (1-2 sentences)
- For "instruction" type: what specific action is being requested
- For "cc_correspondence" type: the external contact names and emails mentioned
- For "news" type: the property/area/opportunity mentioned
- Which BGP team member sent/forwarded it (if any)
- Any external contact names and email addresses
- Which BGP teams/departments should know about this email. Teams are: London Leasing, National Leasing, Investment, Tenant Rep, Development, Lease Advisory, Landsec, Office / Corporate, Accounts. Pick ALL relevant teams. For example: a retail availability in Mayfair → London Leasing; an investment opportunity → Investment; a lease renewal query → Lease Advisory; a nationwide requirement → National Leasing.
- A short "intelligence briefing" (1-2 sentences) explaining why this email matters and what BGP should do about it, written for a senior director.

You MUST return ONLY a valid JSON object with no additional text, explanation, or markdown formatting. Do not wrap in code fences.

{
  "classification": "instruction|cc_correspondence|news|document|auto_reply|unknown",
  "summary": "Brief summary",
  "bgpSender": "name@brucegillinghampollard.com or null",
  "externalContacts": [{"name": "John Smith", "email": "john@example.com", "company": "Company Ltd"}],
  "requestedAction": "description of what to do (for instructions)",
  "propertyContext": "property/area mentioned if any",
  "urgency": "high|normal|low",
  "relevantTeams": ["London Leasing", "Investment"],
  "briefing": "Short intelligence note for the team — why this matters and what to do"
}`;

const INSTRUCTION_PROMPT = `You are ChatBGP, the AI assistant for Bruce Gillingham Pollard (BGP). A team member has emailed you with an instruction. Process this instruction and determine what actions to take.

You have these capabilities:
- Search the CRM (deals, contacts, companies, properties)
- Create/update deals, contacts, companies
- Look up property information (EPC, price paid, flood risk, etc)
- Track interactions between BGP and external contacts
- Send emails from the ChatBGP mailbox
- Create notes and summaries
- **Generate professional documents** using Document Studio (Heads of Terms, Marketing Particulars, Pitch Presentations, Client Reports, Investment Memos, Leasing Strategies, Press Releases, Team CVs, Requirement Flyers, Tenant Handbooks, Rent Review Memos, Instruction Letters, and more)
- **Generate financial models** using Claude Studio (IRR analysis, yield calculations, investment appraisals)

DOCUMENT GENERATION: If the sender asks you to create, draft, write, prepare, or generate any professional document (HOTs, marketing details, pitch, report, memo, strategy, CV, press release, etc.), use the "generate_document" action type. Extract all relevant details from the email (property name, address, parties, terms, specifications, etc.) to include in the description. The document will be generated as a branded PDF and attached to your reply email.

DELIVERY OPTIONS: The sender may specify how to deliver the document:
- "email it back" / "send it to me" / "reply with it" → deliver: "email" (default)
- "save to SharePoint" / "store it" / "put it in the folder" → deliver: "sharepoint"
- "send it to [someone@email.com]" → deliver: "email", deliverTo: "someone@email.com"
- "WhatsApp it" → deliver: "whatsapp"

Based on the instruction, determine:
1. What CRM operations are needed (search, create, update)
2. What documents need to be generated
3. What information to look up
4. What to reply to the sender

Return JSON:
{
  "actions": [
    {"type": "search_crm", "query": "..."},
    {"type": "create_interaction", "contactEmail": "...", "summary": "..."},
    {"type": "update_contact", "email": "...", "fields": {}},
    {"type": "create_deal", "details": {}},
    {"type": "property_lookup", "query": "..."},
    {"type": "generate_document", "documentType": "Heads of Terms", "description": "Full description with all details from the email...", "deliver": "email", "deliverTo": "optional@email.com"},
    {"type": "note", "content": "..."}
  ],
  "replyToSender": "The response to email back to the team member (mention what docs were generated/attached)",
  "summary": "What was done"
}

REPLY STYLE — STRICT RULES (these are work emails, act accordingly):
- Professional, neutral tone. Plain business English.
- NO emojis. NO emoticons. NO exclamation marks except in direct quotes from the sender.
- NO jokes, banter, commentary, or colloquialisms (no "Ha!", "Nice try", "Enjoy the day off", "crack on", etc.).
- NO meta-commentary on whether the email "meets a threshold" or was "formal enough" — never lecture the sender.
- 1-3 short sentences. If you did actions, state them factually. If you did nothing because there was no actionable request, reply with: "Received. No action taken — no specific request identified. Reply with a clearer instruction if you need something done."
- Never infer personal context (leave, cover, social events) or reference it in the reply. Stick to what you actually did.
- Sign-off: no signature. The system appends "— ChatBGP" automatically.

interface EmailClassification {
  classification: string;
  summary: string;
  bgpSender: string | null;
  externalContacts: Array<{ name: string; email: string; company?: string }>;
  requestedAction?: string;
  propertyContext?: string;
  urgency: string;
  relevantTeams?: string[];
  briefing?: string;
}

interface ProcessedAction {
  type: string;
  result: string;
  success: boolean;
}

async function classifyEmail(subject: string, bodyText: string, from: string, to: string[], cc: string[]): Promise<EmailClassification> {
  const emailContent = `From: ${from}
To: ${to.join(", ")}
CC: ${cc.join(", ")}
Subject: ${subject || "(no subject)"}

Body:
${(bodyText || "").slice(0, 6000)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT },
          { role: "user", content: emailContent + (attempt > 0 ? "\n\nIMPORTANT: Return ONLY a valid JSON object, no other text." : "") },
        ],
        max_completion_tokens: 1024,
      });

      const raw = completion.choices[0]?.message?.content || "";
      if (!raw || raw.trim().length === 0) {
        console.warn(`[email-processor] Classification returned empty response for "${subject}" (attempt ${attempt + 1})`);
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      }
      try {
        const result = safeParseJSON(raw);
        if (!result.classification) result.classification = "unknown";
        if (!result.summary) result.summary = subject;
        if (!result.urgency) result.urgency = "normal";
        if (!result.externalContacts) result.externalContacts = [];
        return result;
      } catch (parseErr: any) {
        console.warn(`[email-processor] Failed to parse classification for "${subject}" (attempt ${attempt + 1}). Raw:`, raw.slice(0, 300));
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      }
    } catch (apiErr: any) {
      console.error(`[email-processor] Classification API error for "${subject}" (attempt ${attempt + 1}):`, apiErr.message);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
    }
  }

  return {
    classification: "unknown",
    summary: "Failed to classify after retries",
    bgpSender: null,
    externalContacts: [],
    urgency: "normal",
  };
}

async function processInstruction(
  subject: string,
  bodyText: string,
  from: string,
  classification: EmailClassification
): Promise<{ actions: ProcessedAction[]; reply: string; attachments?: EmailAttachment[] }> {
  const allContacts = await db.select({
    id: crmContacts.id,
    name: crmContacts.name,
    email: crmContacts.email,
    companyId: crmContacts.companyId,
    companyName: crmContacts.companyName,
  }).from(crmContacts);

  const allCompanies = await db.select({
    id: crmCompanies.id,
    name: crmCompanies.name,
  }).from(crmCompanies);

  const crmContext = `Available CRM Data:
- ${allContacts.length} contacts in CRM
- ${allCompanies.length} companies in CRM
Sample contacts: ${allContacts.slice(0, 20).map(c => `${c.name} (${c.email || 'no email'}, ${c.companyName || 'no company'})`).join("; ")}
Sample companies: ${allCompanies.slice(0, 20).map(c => c.name).join("; ")}`;

  let parsed: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          { role: "system", content: INSTRUCTION_PROMPT + "\n\n" + crmContext },
          {
            role: "user",
            content: `Subject: ${subject}\nFrom: ${from}\n\nBody:\n${(bodyText || "").slice(0, 6000)}\n\nClassification context: ${JSON.stringify(classification)}` + (attempt > 0 ? "\n\nIMPORTANT: Return ONLY valid JSON." : ""),
          },
        ],
        max_completion_tokens: 2048,
      });

      const raw = completion.choices[0]?.message?.content || "";
      if (!raw || raw.trim().length === 0) {
        console.warn(`[email-processor] Instruction processing returned empty for "${subject}" (attempt ${attempt + 1})`);
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      }
      parsed = safeParseJSON(raw);
      break;
    } catch (err: any) {
      console.warn(`[email-processor] Instruction processing error for "${subject}" (attempt ${attempt + 1}):`, err.message);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      parsed = { actions: [], replyToSender: "I received your email but had trouble processing the instruction. Please try again or use the ChatBGP panel in the dashboard.", summary: "Parse error" };
    }
  }
  if (!parsed) {
    parsed = { actions: [], replyToSender: "I received your email but had trouble processing the instruction. Please try again or use the ChatBGP panel in the dashboard.", summary: "Parse error" };
  }

  const executedActions: ProcessedAction[] = [];
  const generatedAttachments: EmailAttachment[] = [];

  if (parsed.actions && Array.isArray(parsed.actions)) {
    for (const action of parsed.actions) {
      try {
        switch (action.type) {
          case "search_crm": {
            const query = (action.query || "").toLowerCase();
            const matchedContacts = allContacts.filter(c =>
              c.name.toLowerCase().includes(query) ||
              (c.email && c.email.toLowerCase().includes(query)) ||
              (c.companyName && c.companyName.toLowerCase().includes(query))
            );
            const matchedCompanies = allCompanies.filter(c =>
              c.name.toLowerCase().includes(query)
            );
            executedActions.push({
              type: "search_crm",
              result: `Found ${matchedContacts.length} contacts, ${matchedCompanies.length} companies matching "${action.query}"`,
              success: true,
            });
            break;
          }

          case "create_interaction": {
            const contactEmail = (action.contactEmail || "").toLowerCase();
            const matchedContact = allContacts.find(c => c.email && c.email.toLowerCase() === contactEmail);
            if (matchedContact) {
              await db.insert(crmInteractions).values({
                contactId: matchedContact.id,
                companyId: matchedContact.companyId,
                type: "email",
                direction: "outbound",
                subject: subject || "Email interaction",
                preview: (action.summary || classification.summary || "").slice(0, 500),
                interactionDate: new Date(),
                matchMethod: "chatbgp_email",
              });
              executedActions.push({
                type: "create_interaction",
                result: `Logged interaction for ${matchedContact.name}`,
                success: true,
              });
            } else {
              executedActions.push({
                type: "create_interaction",
                result: `Contact not found: ${contactEmail}`,
                success: false,
              });
            }
            break;
          }

          case "generate_document": {
            const docDescription = action.description || "";
            const docType = action.documentType || undefined;
            if (!docDescription) {
              executedActions.push({ type: "generate_document", result: "No document description provided", success: false });
              break;
            }
            console.log(`[email-processor] Generating document: ${docType || "auto"} — ${docDescription.slice(0, 100)}...`);
            const doc = await generateAutonomousDocument(docDescription, docType);
            const pdfBuffer = await exportDocumentToPdf(doc.content, doc.name);
            const filename = `${(doc.name || "BGP Document").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}.pdf`;

            generatedAttachments.push({
              name: filename,
              contentType: "application/pdf",
              contentBytes: pdfBuffer.toString("base64"),
            });

            const deliver = action.deliver || "email";
            let deliveryNote = `Document "${doc.name}" generated and attached as PDF`;

            if (deliver === "sharepoint") {
              try {
                const { uploadFileToSharePoint } = await import("./microsoft");
                await uploadFileToSharePoint(pdfBuffer, filename, "application/pdf");
                deliveryNote += " and saved to SharePoint";
              } catch (spErr: any) {
                deliveryNote += ` (SharePoint save failed: ${spErr?.message})`;
              }
            }

            if (deliver === "email" && action.deliverTo) {
              try {
                await sendFromSharedMailbox(
                  [action.deliverTo],
                  `${doc.name} — BGP Document`,
                  `<p>Please find the attached document generated by ChatBGP.</p><p style="color:#666;font-size:12px;">Bruce Gillingham Pollard</p>`,
                  undefined,
                  undefined,
                  [{ name: filename, contentType: "application/pdf", contentBytes: pdfBuffer.toString("base64") }]
                );
                deliveryNote += ` and sent to ${action.deliverTo}`;
              } catch (fwdErr: any) {
                deliveryNote += ` (forward to ${action.deliverTo} failed: ${fwdErr?.message})`;
              }
            }

            if (deliver === "whatsapp" && action.deliverTo) {
              try {
                const { sendWhatsAppDocument } = await import("./whatsapp");
                const waConfig = {
                  token: (process.env.WHATSAPP_TOKEN_V2 || process.env.WHATSAPP_ACCESS_TOKEN)?.trim() || null,
                  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
                };
                if (waConfig.token && waConfig.phoneNumberId) {
                  const waSent = await sendWhatsAppDocument(
                    waConfig as any,
                    action.deliverTo.replace(/[^0-9]/g, ""),
                    pdfBuffer,
                    filename,
                    doc.name
                  );
                  deliveryNote += waSent
                    ? ` and sent via WhatsApp to ${action.deliverTo}`
                    : ` (WhatsApp send to ${action.deliverTo} failed)`;
                } else {
                  deliveryNote += " (WhatsApp not configured)";
                }
              } catch (waErr: any) {
                deliveryNote += ` (WhatsApp delivery error: ${waErr?.message})`;
              }
            }

            console.log(`[email-processor] ${deliveryNote}`);
            executedActions.push({
              type: "generate_document",
              result: deliveryNote,
              success: true,
            });
            break;
          }

          case "note": {
            executedActions.push({
              type: "note",
              result: action.content || "Note recorded",
              success: true,
            });
            break;
          }

          default: {
            executedActions.push({
              type: action.type,
              result: `Action type "${action.type}" acknowledged — complex actions should be done via the ChatBGP dashboard`,
              success: true,
            });
          }
        }
      } catch (err: any) {
        executedActions.push({
          type: action.type,
          result: `Error: ${err.message}`,
          success: false,
        });
      }
    }
  }

  return {
    actions: executedActions,
    reply: parsed.replyToSender || "Your instruction has been received and processed.",
    attachments: generatedAttachments.length > 0 ? generatedAttachments : undefined,
  };
}

async function trackCcCorrespondence(
  subject: string,
  bodyText: string,
  from: string,
  toRecipients: string[],
  ccRecipients: string[],
  classification: EmailClassification,
  receivedAt: Date
): Promise<ProcessedAction[]> {
  const actions: ProcessedAction[] = [];

  const allContacts = await db.select({
    id: crmContacts.id,
    name: crmContacts.name,
    email: crmContacts.email,
    companyId: crmContacts.companyId,
    companyName: crmContacts.companyName,
  }).from(crmContacts);

  const allEmails = [...toRecipients, ...ccRecipients, from].filter(e =>
    e && !e.toLowerCase().endsWith(BGP_DOMAIN) && e.toLowerCase() !== SHARED_MAILBOX.toLowerCase()
  );

  const bgpSenderEmails = [from, ...toRecipients, ...ccRecipients].filter(e =>
    e && e.toLowerCase().endsWith(BGP_DOMAIN) && e.toLowerCase() !== SHARED_MAILBOX.toLowerCase()
  );

  const isBgpOutbound = from.toLowerCase().endsWith(BGP_DOMAIN);

  for (const extEmail of allEmails) {
    const normalized = extEmail.toLowerCase().trim();
    const matchedContact = allContacts.find(c => c.email && c.email.toLowerCase().trim() === normalized);

    if (matchedContact) {
      try {
        await db.insert(crmInteractions).values({
          contactId: matchedContact.id,
          companyId: matchedContact.companyId,
          type: "email",
          direction: isBgpOutbound ? "outbound" : "inbound",
          subject: subject || "Email correspondence",
          preview: (classification.summary || `Email ${isBgpOutbound ? "to" : "from"} ${matchedContact.name}`).slice(0, 500),
          interactionDate: receivedAt,
          matchMethod: "chatbgp_email",
          bgpUser: bgpSenderEmails[0] || null,
        });
        actions.push({
          type: "track_interaction",
          result: `Logged ${isBgpOutbound ? "outbound" : "inbound"} email interaction with ${matchedContact.name} (${matchedContact.companyName || "no company"})`,
          success: true,
        });
      } catch (err: any) {
        if (!err.message?.includes("duplicate")) {
          actions.push({
            type: "track_interaction",
            result: `Error logging interaction for ${matchedContact.name}: ${err.message}`,
            success: false,
          });
        }
      }
    } else {
      if (classification.externalContacts?.length) {
        const extContact = classification.externalContacts.find(
          ec => ec.email && ec.email.toLowerCase() === normalized
        );
        if (extContact) {
          actions.push({
            type: "suggest_contact",
            result: `Unknown contact: ${extContact.name} (${extContact.email}${extContact.company ? ", " + extContact.company : ""}) — consider adding to CRM`,
            success: true,
          });
        }
      }
    }
  }

  if (actions.length === 0) {
    actions.push({
      type: "track_interaction",
      result: "No CRM contacts matched the email participants",
      success: true,
    });
  }

  return actions;
}

async function sendReplyWithFallback(
  messageId: string,
  toEmail: string,
  subject: string,
  replyText: string,
  actions: ProcessedAction[],
  attachments?: EmailAttachment[]
): Promise<boolean> {
  try {
    const replyBody = formatReplyHtml(replyText, actions);
    const hasAttachments = attachments && attachments.length > 0;
    if (hasAttachments) {
      try {
        await replyToSharedMailboxMessage(messageId, replyBody, undefined, attachments);
        console.log(`[email-processor] Replied with ${attachments!.length} attachment(s) to ${toEmail}`);
        return true;
      } catch (replyErr: any) {
        console.error(`[email-processor] Reply API failed, using sendMail with attachments:`, replyErr.message);
        await sendFromSharedMailbox([toEmail], `Re: ${subject}`, replyBody, undefined, undefined, attachments);
        return true;
      }
    } else {
      try {
        await replyToSharedMailboxMessage(messageId, replyBody);
        return true;
      } catch (replyErr: any) {
        console.error(`[email-processor] Reply API failed, using sendMail:`, replyErr.message);
        await sendFromSharedMailbox([toEmail], `Re: ${subject}`, replyBody);
        return true;
      }
    }
  } catch (err: any) {
    console.error(`[email-processor] All reply methods failed for ${toEmail}:`, err.message);
    return false;
  }
}

const WOODY_EMAIL = "woody@brucegillinghampollard.com";

async function notifyRelevantTeamMembers(
  classification: EmailClassification,
  subject: string,
  fromEmail: string,
  fromName: string
): Promise<string[]> {
  const notifiedEmails: string[] = [];
  const teams = classification.relevantTeams;
  const briefing = classification.briefing || classification.summary;

  if (!teams || teams.length === 0 || !briefing) return notifiedEmails;
  if (classification.classification === "auto_reply") return notifiedEmails;

  try {
    const allUsers = await db.select({
      id: users.id,
      email: users.email,
      team: users.team,
      department: users.department,
      additionalTeams: users.additionalTeams,
    }).from(users);

    const matchedUserIds = new Set<string>();
    const matchedUsers: Array<{ id: string; email: string }> = [];

    for (const user of allUsers) {
      if (!user.email) continue;
      if (user.email.toLowerCase() === fromEmail.toLowerCase()) continue;

      const userTeams = [user.team, user.department, ...(user.additionalTeams || [])].filter(Boolean).map(t => t!.toLowerCase());
      const isMatch = teams.some(t => userTeams.includes(t.toLowerCase()));

      if (isMatch && !matchedUserIds.has(user.id)) {
        matchedUserIds.add(user.id);
        matchedUsers.push({ id: user.id, email: user.email });
      }
    }

    const woodyUser = allUsers.find(u => u.email?.toLowerCase() === WOODY_EMAIL);
    if (woodyUser && !matchedUserIds.has(woodyUser.id) && classification.urgency === "high") {
      matchedUsers.push({ id: woodyUser.id, email: woodyUser.email! });
    }

    if (matchedUsers.length === 0) return notifiedEmails;

    const urgencyLabel = classification.urgency === "high" ? "🔴 " : classification.urgency === "normal" ? "" : "";
    const emailSubject = `${urgencyLabel}ChatBGP Intel: ${subject}`;
    const propertyLine = classification.propertyContext ? `<p style="color:#555;font-size:14px;"><strong>Property/Area:</strong> ${classification.propertyContext}</p>` : "";
    const teamsLine = teams.length > 0 ? `<p style="color:#888;font-size:12px;">Flagged for: ${teams.join(", ")}</p>` : "";

    const emailBody = `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #333; max-width: 600px;">
        <p style="font-size:15px;">${briefing}</p>
        ${propertyLine}
        <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
        <p style="color:#666;font-size:13px;"><strong>Original email:</strong> "${subject}" from ${fromName || fromEmail}</p>
        ${teamsLine}
        <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
        <p style="color: #999; font-size: 11px;">This is an automated intelligence briefing from ChatBGP. <a href="https://bgp-wip-app-production-efac.up.railway.app/chatbgp">Open ChatBGP</a> for more detail.</p>
      </div>
    `;

    for (const user of matchedUsers) {
      try {
        await sendFromSharedMailbox([user.email], emailSubject, emailBody);
        notifiedEmails.push(user.email);
      } catch (sendErr: any) {
        console.error(`[email-processor] Failed to notify ${user.email}:`, sendErr.message);
      }
    }

    if (notifiedEmails.length > 0) {
      console.log(`[email-processor] Intel briefing sent to ${notifiedEmails.length} team members: ${notifiedEmails.join(", ")}`);
    }
  } catch (err: any) {
    console.error(`[email-processor] Team notification error:`, err.message);
  }

  return notifiedEmails;
}

async function processNewEmails(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  try {
    const messages = await getSharedMailboxMessages(undefined, 20, 0);

    const unreadMessages = messages.filter((m: any) => !m.isRead);

    if (unreadMessages.length === 0) {
      return { processed: 0, errors: 0 };
    }

    console.log(`[email-processor] Found ${unreadMessages.length} unread messages`);

    for (const msg of unreadMessages) {
      const messageId = msg.id;

      const existing = await db.select({ id: chatbgpEmailLog.id })
        .from(chatbgpEmailLog)
        .where(eq(chatbgpEmailLog.messageId, messageId))
        .limit(1);

      if (existing.length > 0) {
        continue;
      }

      const fromEmail = msg.from?.emailAddress?.address || "";
      const fromName = msg.from?.emailAddress?.name || "";
      const subject = msg.subject || "";
      const bodyText = extractEmailBodyText(msg);
      const receivedAt = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
      const toRecipients = (msg.toRecipients || []).map((r: any) => r.emailAddress?.address || "");
      const ccRecipients = (msg.ccRecipients || []).map((r: any) => r.emailAddress?.address || "");

      try {
        const classification = await classifyEmail(subject, bodyText, fromEmail, toRecipients, ccRecipients);
        console.log(`[email-processor] ${subject} → ${classification.classification} (${classification.urgency})`);

        let actionsTaken: ProcessedAction[] = [];
        let replySent = false;

        const isRegisteredUser = await isAppUser(fromEmail);

        if (isRegisteredUser && (classification.classification === "unknown" || classification.classification === "document")) {
          classification.classification = "instruction";
          if (!classification.requestedAction) {
            classification.requestedAction = `Respond to this email from a BGP team member: "${subject}"`;
          }
        }

        switch (classification.classification) {
          case "instruction": {
            if (!isRegisteredUser) {
              actionsTaken.push({
                type: "instruction_ignored",
                result: `Email from non-registered sender ${fromEmail} — no reply sent`,
                success: true,
              });
              break;
            }

            const result = await processInstruction(subject, bodyText, fromEmail, classification);
            actionsTaken = result.actions;
            console.log(`[email-processor] Instruction processed for "${subject}": ${result.actions.length} actions, reply=${!!result.reply}`);

            const replyText = result.reply || `Hi — I've received your email "${subject}" and logged it. If you need me to take a specific action, try sending a more detailed instruction via the ChatBGP dashboard or email.`;
            replySent = await sendReplyWithFallback(messageId, fromEmail, subject, replyText, actionsTaken, result.attachments);
            break;
          }

          case "cc_correspondence": {
            actionsTaken = await trackCcCorrespondence(
              subject, bodyText, fromEmail, toRecipients, ccRecipients, classification, receivedAt
            );
            if (isRegisteredUser) {
              const ccReply = `Thanks — I've logged this correspondence against the relevant contacts in the CRM.`;
              replySent = await sendReplyWithFallback(messageId, fromEmail, subject, ccReply, actionsTaken);
            }
            break;
          }

          case "news": {
            const { processMessageWithAI } = await import("./news-intelligence");
            try {
              const leads = await processMessageWithAI(subject, bodyText);
              actionsTaken.push({
                type: "news_extraction",
                result: `Extracted ${leads.length} potential leads from news email`,
                success: true,
              });
            } catch (newsErr: any) {
              actionsTaken.push({
                type: "news_extraction",
                result: `News processing error: ${newsErr.message}`,
                success: false,
              });
            }
            break;
          }

          case "document": {
            actionsTaken.push({
              type: "document_received",
              result: `Document email noted: ${subject}. Attachments should be filed via the dashboard.`,
              success: true,
            });
            if (isRegisteredUser) {
              const docReply = `Thanks — I've received the document "${subject}". It's been noted and can be filed via the BGP dashboard.`;
              replySent = await sendReplyWithFallback(messageId, fromEmail, subject, docReply, actionsTaken);
            }
            break;
          }

          case "auto_reply": {
            actionsTaken.push({
              type: "auto_reply_ignored",
              result: "Automated message — no action needed",
              success: true,
            });
            break;
          }

          default: {
            if (isRegisteredUser) {
              const unknownReply = `Hi — I've received your email "${subject}". If you need me to take a specific action, try sending a more detailed instruction or use the ChatBGP dashboard.`;
              replySent = await sendReplyWithFallback(messageId, fromEmail, subject, unknownReply, actionsTaken);
            }
            actionsTaken.push({
              type: isRegisteredUser ? "acknowledged" : "no_action",
              result: isRegisteredUser ? "Email acknowledged with auto-reply" : `Email from non-registered sender — no reply sent`,
              success: true,
            });
          }
        }

        const skipNotify = classification.classification === "auto_reply"
          || (isRegisteredUser && classification.classification === "instruction");
        if (!skipNotify) {
          try {
            const notified = await notifyRelevantTeamMembers(classification, subject, fromEmail, fromName);
            if (notified.length > 0) {
              actionsTaken.push({
                type: "team_notified",
                result: `Intelligence briefing sent to ${notified.length} team member(s): ${notified.join(", ")}`,
                success: true,
              });
            }
          } catch (notifyErr: any) {
            console.error(`[email-processor] Team notification error:`, notifyErr.message);
          }
        }

        await db.insert(chatbgpEmailLog).values({
          messageId,
          subject,
          senderEmail: fromEmail,
          senderName: fromName,
          receivedAt,
          classification: classification.classification,
          actionsTaken: actionsTaken as any,
          aiSummary: classification.briefing || classification.summary,
          replySent,
        });

        try {
          await markMessageRead(messageId);
        } catch (markErr: any) {
          console.warn(`[email-processor] Failed to mark message ${messageId} as read:`, markErr.message);
        }

        processed++;
      } catch (err: any) {
        console.error(`[email-processor] Error processing email "${subject}":`, err.message);

        await db.insert(chatbgpEmailLog).values({
          messageId,
          subject,
          senderEmail: fromEmail,
          senderName: fromName,
          receivedAt,
          classification: "error",
          error: err.message,
        }).onConflictDoNothing();

        errors++;
      }
    }
  } catch (err: any) {
    console.error("[email-processor] Failed to fetch messages:", err.message);
    errors++;
  }

  if (processed > 0) {
    const { logActivity } = await import("./activity-logger");
    await logActivity("email-processor", "emails_processed", `${processed} emails processed, ${errors} errors`, processed);
  }

  return { processed, errors };
}

function formatReplyHtml(reply: string, actions: ProcessedAction[]): string {
  const actionList = actions
    .filter(a => a.success)
    .map(a => `<li>${a.result}</li>`)
    .join("");

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #333;">
      <p>${reply.replace(/\n/g, "<br>")}</p>
      ${actionList ? `
        <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
        <p style="color: #666; font-size: 13px;"><strong>Actions taken:</strong></p>
        <ul style="color: #666; font-size: 13px;">${actionList}</ul>
      ` : ""}
      <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
      <p style="color: #999; font-size: 11px;">This is an automated response from ChatBGP. For complex requests, please use the <a href="https://bgp-wip-app-production-efac.up.railway.app/chatbgp">ChatBGP dashboard</a>.</p>
    </div>
  `;
}

let processingInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
let processingStartedAt: number | null = null;

export function startEmailProcessor() {
  if (processingInterval) return;

  console.log("[email-processor] Starting email processor — checking every 2 minutes");

  setTimeout(async () => {
    if (!isProcessing) {
      isProcessing = true;
      processingStartedAt = Date.now();
      try {
        const result = await processNewEmails();
        if (result.processed > 0 || result.errors > 0) {
          console.log(`[email-processor] Processed: ${result.processed}, Errors: ${result.errors}`);
        }
      } catch (err: any) {
        console.error("[email-processor] Initial run error:", err.message);
      } finally {
        isProcessing = false;
        processingStartedAt = null;
      }
    }
  }, 15000);

  processingInterval = setInterval(async () => {
    if (isProcessing) {
      if (processingStartedAt && Date.now() - processingStartedAt > 10 * 60 * 1000) {
        console.error("[email-processor] Processing stuck for >10 minutes, resetting flag");
        isProcessing = false;
        processingStartedAt = null;
      }
      return;
    }
    isProcessing = true;
    processingStartedAt = Date.now();
    try {
      const result = await processNewEmails();
      if (result.processed > 0 || result.errors > 0) {
        console.log(`[email-processor] Processed: ${result.processed}, Errors: ${result.errors}`);
      }
    } catch (err: any) {
      console.error("[email-processor] Run error:", err.message);
    } finally {
      isProcessing = false;
      processingStartedAt = null;
    }
  }, 2 * 60 * 1000);
}

export function stopEmailProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    console.log("[email-processor] Stopped email processor");
  }
}

export function registerEmailProcessorRoutes(app: Express) {
  app.get("/api/email-processor/log", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const logs = await db.select()
        .from(chatbgpEmailLog)
        .orderBy(desc(chatbgpEmailLog.processedAt))
        .limit(100);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/email-processor/stats", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = await db.select({
        classification: chatbgpEmailLog.classification,
        count: sql<number>`count(*)::int`,
      })
        .from(chatbgpEmailLog)
        .groupBy(chatbgpEmailLog.classification);

      const total = stats.reduce((sum, s) => sum + s.count, 0);
      const repliesSent = await db.select({ count: sql<number>`count(*)::int` })
        .from(chatbgpEmailLog)
        .where(eq(chatbgpEmailLog.replySent, true));

      res.json({
        total,
        byClassification: Object.fromEntries(stats.map(s => [s.classification, s.count])),
        repliesSent: repliesSent[0]?.count || 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-processor/run", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      if (isProcessing) {
        return res.json({ message: "Already processing", status: "busy" });
      }
      isProcessing = true;
      processingStartedAt = Date.now();
      const result = await processNewEmails();
      isProcessing = false;
      processingStartedAt = null;
      res.json({ ...result, status: "complete" });
    } catch (err: any) {
      isProcessing = false;
      processingStartedAt = null;
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-processor/toggle", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const { enabled } = req.body;
    if (enabled) {
      startEmailProcessor();
      res.json({ status: "enabled", message: "Email processor started" });
    } else {
      stopEmailProcessor();
      res.json({ status: "disabled", message: "Email processor stopped" });
    }
  });

  app.post("/api/email-processor/reprocess/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const logId = parseInt(req.params.id);
      const [logEntry] = await db.select().from(chatbgpEmailLog).where(eq(chatbgpEmailLog.id, logId)).limit(1);
      if (!logEntry) return res.status(404).json({ message: "Log entry not found" });
      if (!logEntry.messageId) return res.status(400).json({ message: "No message ID to reprocess" });

      const msg = await getSharedMailboxMessageById(logEntry.messageId);
      if (!msg) return res.status(404).json({ message: "Original message not found in mailbox (may have been deleted)" });

      await db.delete(chatbgpEmailLog).where(eq(chatbgpEmailLog.id, logId));

      const fromEmail = msg.from?.emailAddress?.address || "";
      const fromName = msg.from?.emailAddress?.name || "";
      const subject = msg.subject || "";
      const bodyText = extractEmailBodyText(msg);
      const receivedAt = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
      const toRecipients = (msg.toRecipients || []).map((r: any) => r.emailAddress?.address || "");
      const ccRecipients = (msg.ccRecipients || []).map((r: any) => r.emailAddress?.address || "");

      const classification = await classifyEmail(subject, bodyText, fromEmail, toRecipients, ccRecipients);
      console.log(`[email-processor] Reprocess "${subject}" → ${classification.classification}`);

      let actionsTaken: ProcessedAction[] = [];
      let replySent = false;
      const isRegisteredUser = await isAppUser(fromEmail);
      if (isRegisteredUser && (classification.classification === "unknown" || classification.classification === "document")) {
        classification.classification = "instruction";
        if (!classification.requestedAction) {
          classification.requestedAction = `Respond to this email from a BGP team member: "${subject}"`;
        }
      }

      if (classification.classification === "instruction") {
        const result = await processInstruction(subject, bodyText, fromEmail, classification);
        actionsTaken = result.actions;
        const replyText = result.reply || `Hi — I've received your email "${subject}" and logged it. If you need me to take a specific action, try sending a more detailed instruction via the ChatBGP dashboard or email.`;
        replySent = await sendReplyWithFallback(logEntry.messageId, fromEmail, subject, replyText, actionsTaken, result.attachments);
      } else {
        actionsTaken.push({ type: "no_action", result: `Email reclassified as ${classification.classification}`, success: true });
      }

      await db.insert(chatbgpEmailLog).values({
        messageId: logEntry.messageId,
        subject,
        senderEmail: fromEmail,
        senderName: fromName,
        receivedAt,
        classification: classification.classification,
        actionsTaken: actionsTaken as any,
        aiSummary: classification.summary,
        replySent,
      });

      res.json({
        message: "Reprocessed successfully",
        classification: classification.classification,
        replySent,
        actions: actionsTaken.length,
      });
    } catch (err: any) {
      console.error(`[email-processor] Reprocess error:`, err.message);
      res.status(500).json({ message: err.message });
    }
  });
}
