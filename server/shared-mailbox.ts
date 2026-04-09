import { ConfidentialClientApplication } from "@azure/msal-node";
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const SHARED_MAILBOX = "chatbgp@brucegillinghampollard.com";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let appClient: ConfidentialClientApplication | null = null;
let cachedToken: { accessToken: string; expiresOn: Date } | null = null;

function getAppClient(): ConfidentialClientApplication {
  if (!appClient) {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
    const tenantId = process.env.AZURE_TENANT_ID;

    if (!clientId || !clientSecret || !tenantId) {
      throw new Error("Azure credentials not configured");
    }

    appClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }
  return appClient;
}

export async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresOn > new Date(Date.now() + 60000)) {
    return cachedToken.accessToken;
  }

  const client = getAppClient();
  let result: any;
  try {
    result = await client.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });
  } catch (msalErr: any) {
    console.error("[shared-mailbox] MSAL token error:", msalErr?.message, msalErr?.errorCode);
    appClient = null;
    cachedToken = null;
    throw new Error(`Microsoft authentication failed — please try again in a moment`);
  }

  if (!result?.accessToken) {
    throw new Error("Failed to acquire app-only token");
  }

  cachedToken = {
    accessToken: result.accessToken,
    expiresOn: result.expiresOn || new Date(Date.now() + 3600000),
  };

  return cachedToken.accessToken;
}

export async function graphRequest(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getAppToken();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return null;
}

export async function getSharedMailboxMessages(
  folderId?: string,
  top = 50,
  skip = 0
): Promise<any[]> {
  const folderPath = folderId
    ? `/users/${SHARED_MAILBOX}/mailFolders/${folderId}/messages`
    : `/users/${SHARED_MAILBOX}/messages`;
  const data = await graphRequest(
    `${folderPath}?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,body,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients`
  );
  const messages = data?.value || [];
  for (const msg of messages) {
    if (msg["@odata.type"] === "#microsoft.graph.eventMessage") {
      msg.meetingMessageType = msg.meetingMessageType || "meetingRequest";
    }
  }
  return messages;
}

export async function getSharedMailboxMessageById(messageId: string): Promise<any | null> {
  try {
    const data = await graphRequest(
      `/users/${SHARED_MAILBOX}/messages/${messageId}?$select=id,subject,bodyPreview,body,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients`
    );
    return data;
  } catch {
    return null;
  }
}

export async function getSharedMailboxFolders(): Promise<any[]> {
  const data = await graphRequest(
    `/users/${SHARED_MAILBOX}/mailFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount`
  );
  return data?.value || [];
}

export async function getSharedMailboxFolderChildren(folderId: string): Promise<any[]> {
  const data = await graphRequest(
    `/users/${SHARED_MAILBOX}/mailFolders/${folderId}/childFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount`
  );
  return data?.value || [];
}

export interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string;
}

export async function sendSharedMailboxEmail(opts: { to: string; subject: string; body: string; cc?: string; attachments?: EmailAttachment[] }): Promise<void> {
  const recipients = [opts.to];
  const ccRecipients = opts.cc ? [opts.cc] : undefined;
  return sendFromSharedMailbox(recipients, opts.subject, opts.body, ccRecipients, undefined, opts.attachments);
}

export async function sendFromSharedMailbox(
  recipients: string[],
  subject: string,
  body: string,
  ccRecipients?: string[],
  bccRecipients?: string[],
  attachments?: EmailAttachment[]
): Promise<void> {
  const toArray = recipients.map((email) => ({
    emailAddress: { address: email },
  }));
  const ccArray = ccRecipients?.map((email) => ({
    emailAddress: { address: email },
  }));
  const bccArray = bccRecipients?.map((email) => ({
    emailAddress: { address: email },
  }));

  const graphAttachments = attachments?.map(a => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.name,
    contentType: a.contentType,
    contentBytes: a.contentBytes,
  }));

  await graphRequest(`/users/${SHARED_MAILBOX}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: body },
        toRecipients: toArray,
        ...(ccArray && { ccRecipients: ccArray }),
        ...(bccArray && { bccRecipients: bccArray }),
        ...(graphAttachments && graphAttachments.length > 0 && { attachments: graphAttachments }),
      },
      saveToSentItems: true,
    }),
  });
}

export async function replyToSharedMailboxMessage(
  messageId: string,
  body: string,
  ccRecipients?: string[],
  attachments?: EmailAttachment[]
): Promise<void> {
  const ccArray = ccRecipients?.map((email) => ({
    emailAddress: { address: email },
  }));

  const graphAttachments = attachments?.map(a => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.name,
    contentType: a.contentType,
    contentBytes: a.contentBytes,
  }));

  await graphRequest(`/users/${SHARED_MAILBOX}/messages/${messageId}/reply`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        body: { contentType: "HTML", content: body },
        ...(ccArray && ccArray.length > 0 && { ccRecipients: ccArray }),
        ...(graphAttachments && graphAttachments.length > 0 && { attachments: graphAttachments }),
      },
    }),
  });
}

export async function markMessageRead(messageId: string, isRead = true): Promise<void> {
  await graphRequest(`/users/${SHARED_MAILBOX}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

export async function getMessageDetail(messageId: string): Promise<any> {
  const msg = await graphRequest(
    `/users/${SHARED_MAILBOX}/messages/${messageId}?$select=id,subject,body,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients`
  );
  if (msg?.["@odata.type"] === "#microsoft.graph.eventMessage") {
    try {
      const detail = await graphRequest(`/users/${SHARED_MAILBOX}/messages/${messageId}?$select=meetingMessageType`);
      msg.meetingMessageType = detail?.meetingMessageType || "meetingRequest";
    } catch { msg.meetingMessageType = "meetingRequest"; }
  }
  return msg;
}

export async function respondToCalendarEvent(
  userEmail: string,
  messageId: string,
  response: "accept" | "decline" | "tentativelyAccept",
  comment?: string
): Promise<void> {
  const msg = await graphRequest(
    `/users/${userEmail}/messages/${messageId}?$expand=microsoft.graph.eventMessage/event`
  );
  const eventId = msg?.event?.id;
  if (!eventId) {
    throw new Error("No calendar event found for this message");
  }
  await graphRequest(`/users/${userEmail}/events/${eventId}/${response}`, {
    method: "POST",
    body: JSON.stringify({ comment: comment || "", sendResponse: true }),
  });
}

export async function getUserMailMessages(
  userEmail: string,
  folderId?: string,
  top = 50,
  skip = 0
): Promise<any[]> {
  const folderPath = folderId
    ? `/users/${userEmail}/mailFolders/${folderId}/messages`
    : `/users/${userEmail}/messages`;
  const data = await graphRequest(
    `${folderPath}?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,body,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients`
  );
  const messages = data?.value || [];
  for (const msg of messages) {
    if (msg["@odata.type"] === "#microsoft.graph.eventMessage") {
      msg.meetingMessageType = msg.meetingMessageType || "meetingRequest";
    }
  }
  return messages;
}

export async function getUserMailFolders(userEmail: string): Promise<any[]> {
  const data = await graphRequest(
    `/users/${userEmail}/mailFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount`
  );
  return data?.value || [];
}

export async function getUserMailFolderChildren(userEmail: string, folderId: string): Promise<any[]> {
  const data = await graphRequest(
    `/users/${userEmail}/mailFolders/${folderId}/childFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount`
  );
  return data?.value || [];
}

export async function getUserMessageDetail(userEmail: string, messageId: string): Promise<any> {
  const msg = await graphRequest(
    `/users/${userEmail}/messages/${messageId}?$select=id,subject,body,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance,toRecipients,ccRecipients`
  );
  if (msg?.["@odata.type"] === "#microsoft.graph.eventMessage") {
    try {
      const detail = await graphRequest(`/users/${userEmail}/messages/${messageId}?$select=meetingMessageType`);
      msg.meetingMessageType = detail?.meetingMessageType || "meetingRequest";
    } catch { msg.meetingMessageType = "meetingRequest"; }
  }
  return msg;
}

export async function markUserMessageRead(userEmail: string, messageId: string, isRead = true): Promise<void> {
  await graphRequest(`/users/${userEmail}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

async function getCurrentUserEmail(req: Request): Promise<string | null> {
  const userId = req.session.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.username || null;
}

export function setupSharedMailboxRoutes(app: Express) {
  app.get("/api/shared-mailbox/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      await getAppToken();
      res.json({ connected: true, email: SHARED_MAILBOX });
    } catch (err: any) {
      console.error("Shared mailbox status error:", err?.message);
      res.json({ connected: false, email: SHARED_MAILBOX, error: err?.message });
    }
  });

  app.get("/api/shared-mailbox/folders", requireAuth, async (_req: Request, res: Response) => {
    try {
      const folders = await getSharedMailboxFolders();
      res.json(folders);
    } catch (err: any) {
      console.error("Shared mailbox folders error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to fetch folders" });
    }
  });

  app.get("/api/shared-mailbox/folders/:folderId/children", requireAuth, async (req: Request, res: Response) => {
    try {
      const children = await getSharedMailboxFolderChildren(req.params.folderId);
      res.json(children);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch subfolders" });
    }
  });

  app.get("/api/shared-mailbox/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const folderId = req.query.folderId as string | undefined;
      const top = parseInt(req.query.top as string) || 50;
      const skip = parseInt(req.query.skip as string) || 0;
      const messages = await getSharedMailboxMessages(folderId, top, skip);
      res.json(messages);
    } catch (err: any) {
      console.error("Shared mailbox messages error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to fetch messages" });
    }
  });

  app.get("/api/shared-mailbox/messages/:messageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const msg = await getMessageDetail(req.params.messageId);
      res.json(msg);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch message" });
    }
  });

  app.patch("/api/shared-mailbox/messages/:messageId/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const isRead = req.body.isRead !== undefined ? req.body.isRead : true;
      await markMessageRead(req.params.messageId, isRead);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update message" });
    }
  });

  app.delete("/api/shared-mailbox/messages/:messageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = await getAppToken();
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${SHARED_MAILBOX}/messages/${req.params.messageId}/move`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ destinationId: "deleteditems" }),
        }
      );
      if (!graphRes.ok) {
        const err = await graphRes.text();
        throw new Error(`Graph API error: ${graphRes.status} - ${err}`);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete message" });
    }
  });

  app.get("/api/user-mail/status", requireAuth, async (req: Request, res: Response) => {
    try {
      await getAppToken();
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) {
        return res.json({ connected: false, error: "No email configured for current user" });
      }
      res.json({ connected: true, email: userEmail });
    } catch (err: any) {
      res.json({ connected: false, error: err?.message });
    }
  });

  app.get("/api/user-mail/folders", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const folders = await getUserMailFolders(userEmail);
      res.json(folders);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch folders" });
    }
  });

  app.get("/api/user-mail/folders/:folderId/children", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const children = await getUserMailFolderChildren(userEmail, req.params.folderId);
      res.json(children);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch subfolders" });
    }
  });

  app.get("/api/user-mail/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const folderId = req.query.folderId as string | undefined;
      const top = parseInt(req.query.top as string) || 50;
      const skip = parseInt(req.query.skip as string) || 0;
      const messages = await getUserMailMessages(userEmail, folderId, top, skip);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch messages" });
    }
  });

  app.get("/api/user-mail/messages/:messageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const msg = await getUserMessageDetail(userEmail, req.params.messageId);
      res.json(msg);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch message" });
    }
  });

  app.patch("/api/user-mail/messages/:messageId/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const isRead = req.body.isRead !== undefined ? req.body.isRead : true;
      await markUserMessageRead(userEmail, req.params.messageId, isRead);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to update message" });
    }
  });

  app.delete("/api/user-mail/messages/:messageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const token = await getAppToken();
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/messages/${req.params.messageId}/move`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ destinationId: "deleteditems" }),
        }
      );
      if (!graphRes.ok) {
        const err = await graphRes.text();
        throw new Error(`Graph API error: ${graphRes.status} - ${err}`);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to delete message" });
    }
  });

  app.post("/api/user-mail/messages/:messageId/calendar-respond", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const { response, comment } = req.body;
      if (!["accept", "decline", "tentativelyAccept"].includes(response)) {
        return res.status(400).json({ message: "Invalid response type" });
      }
      await respondToCalendarEvent(userEmail, req.params.messageId, response, comment);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to respond to calendar event" });
    }
  });

  app.post("/api/shared-mailbox/messages/:messageId/calendar-respond", requireAuth, async (req: Request, res: Response) => {
    try {
      const { response, comment } = req.body;
      if (!["accept", "decline", "tentativelyAccept"].includes(response)) {
        return res.status(400).json({ message: "Invalid response type" });
      }
      await respondToCalendarEvent(SHARED_MAILBOX, req.params.messageId, response, comment);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to respond to calendar event" });
    }
  });

  app.post("/api/user-mail/send", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const { recipients, subject, body, ccRecipients, bccRecipients } = req.body;
      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ message: "At least one recipient is required" });
      }
      if (!subject || typeof subject !== "string") {
        return res.status(400).json({ message: "Subject is required" });
      }
      if (!body || typeof body !== "string") {
        return res.status(400).json({ message: "Body is required" });
      }
      const token = await getAppToken();
      const toRecipients = recipients.map((r: string) => ({ emailAddress: { address: r } }));
      const message: any = {
        subject,
        body: { contentType: "HTML", content: body },
        toRecipients,
      };
      if (ccRecipients?.length) {
        message.ccRecipients = ccRecipients.map((r: string) => ({ emailAddress: { address: r } }));
      }
      if (bccRecipients?.length) {
        message.bccRecipients = bccRecipients.map((r: string) => ({ emailAddress: { address: r } }));
      }
      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/sendMail`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message, saveToSentItems: true }),
        }
      );
      if (!graphRes.ok) {
        const err = await graphRes.text();
        throw new Error(`Graph API error: ${graphRes.status} - ${err}`);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("User mail send error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to send email" });
    }
  });

  app.get("/api/shared-mailbox/messages/:messageId/attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = await getAppToken();
      const graphRes = await fetch(
        `${GRAPH_BASE}/users/${SHARED_MAILBOX}/messages/${req.params.messageId}/attachments?$select=id,name,contentType,size,isInline`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!graphRes.ok) throw new Error(`Graph API ${graphRes.status}`);
      const data = await graphRes.json();
      const attachments = (data.value || [])
        .filter((a: any) => !a.isInline)
        .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
      res.json(attachments);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch attachments" });
    }
  });

  app.get("/api/shared-mailbox/messages/:messageId/attachments/:attachmentId", requireAuth, async (req: Request, res: Response) => {
    try {
      const token = await getAppToken();
      const graphRes = await fetch(
        `${GRAPH_BASE}/users/${SHARED_MAILBOX}/messages/${req.params.messageId}/attachments/${req.params.attachmentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!graphRes.ok) throw new Error(`Graph API ${graphRes.status}`);
      const attachment = await graphRes.json();
      const buffer = Buffer.from(attachment.contentBytes, "base64");
      res.setHeader("Content-Type", attachment.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.name || "download")}"`);
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to download attachment" });
    }
  });

  app.get("/api/user-mail/messages/:messageId/attachments", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const token = await getAppToken();
      const graphRes = await fetch(
        `${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/messages/${req.params.messageId}/attachments?$select=id,name,contentType,size,isInline`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!graphRes.ok) throw new Error(`Graph API ${graphRes.status}`);
      const data = await graphRes.json();
      const attachments = (data.value || [])
        .filter((a: any) => !a.isInline)
        .map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size }));
      res.json(attachments);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to fetch attachments" });
    }
  });

  app.get("/api/user-mail/messages/:messageId/attachments/:attachmentId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userEmail = await getCurrentUserEmail(req);
      if (!userEmail) return res.status(400).json({ message: "No email for current user" });
      const token = await getAppToken();
      const graphRes = await fetch(
        `${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/messages/${req.params.messageId}/attachments/${req.params.attachmentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!graphRes.ok) throw new Error(`Graph API ${graphRes.status}`);
      const attachment = await graphRes.json();
      const buffer = Buffer.from(attachment.contentBytes, "base64");
      res.setHeader("Content-Type", attachment.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.name || "download")}"`);
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Failed to download attachment" });
    }
  });

  app.post("/api/shared-mailbox/send", requireAuth, async (req: Request, res: Response) => {
    try {
      const { recipients, subject, body, ccRecipients, bccRecipients } = req.body;

      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ message: "At least one recipient is required" });
      }
      if (!subject || typeof subject !== "string") {
        return res.status(400).json({ message: "Subject is required" });
      }
      if (!body || typeof body !== "string") {
        return res.status(400).json({ message: "Body is required" });
      }

      await sendFromSharedMailbox(recipients, subject, body, ccRecipients, bccRecipients);
      res.json({ success: true, message: `Email sent from ${SHARED_MAILBOX}` });
    } catch (err: any) {
      console.error("Shared mailbox send error:", err?.message);
      res.status(500).json({ message: err?.message || "Failed to send email" });
    }
  });
}
