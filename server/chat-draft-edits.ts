import { Router, type Express, type RequestHandler } from "express";
import { z } from "zod";
import { EMAIL_DRAFT_EDIT_NOTE, extractChatEmailDraft, hasEmailDraftEditNote } from "../shared/chat-email-draft";
import { chatWordSchema, type ChatDraftDatabase } from "./chat-drafts";

export { EMAIL_DRAFT_EDIT_NOTE } from "../shared/chat-email-draft";
const CHAT_MESSAGE_LIMIT = 500_000; // Same upper bound as chatbgp's message schema.
export const chatDraftEditSchema = chatWordSchema.extend({
  threadId: z.string().uuid(),
  messageId: z.string().uuid(),
  expectedContent: z.string().min(1).max(CHAT_MESSAGE_LIMIT),
}).strict();

export interface ChatDraftEditDependencies {
  db: ChatDraftDatabase;
  requireAuth: RequestHandler;
  emitMessageUpdated(threadId: string, messageId: string, content: string): void;
}

const messageColumns = `m.id, m.thread_id AS "threadId", m.role, m.content,
  m.user_id AS "userId", m.action_data AS "actionData", m.attachments, m.created_at AS "createdAt"`;
const accessPredicate = `EXISTS (SELECT 1 FROM chat_threads t WHERE t.id=m.thread_id AND
  (t.created_by=$3 OR EXISTS (SELECT 1 FROM chat_thread_members member
    WHERE member.thread_id=t.id AND member.user_id=$3)))`;

/** Edits only a recognised assistant email, never a tool result or user message. */
export function createChatDraftEditRouter(deps: ChatDraftEditDependencies) {
  const router = Router();
  router.post("/edit", deps.requireAuth, async (req, res) => {
    res.set({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" });
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return void res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      const user = (await deps.db.query("SELECT email, role, is_active FROM users WHERE id=$1", [userId])).rows[0];
      if (!user) return void res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      if (user.is_active === false || String(user.role).trim().toLowerCase() === "client" ||
        !String(user.email ?? "").trim().toLowerCase().endsWith("@brucegillinghampollard.com")) {
        return void res.status(403).json({ error: "Draft editing is available to BGP staff only", code: "STAFF_REQUIRED" });
      }
      if (!req.is("application/json")) return void res.status(415).json({ error: "Send draft content as JSON", code: "JSON_REQUIRED" });
      const bearer = !!(req as any).tokenUserId && /^Bearer\s+\S+/i.test(req.get("authorization") ?? "");
      const site = req.get("sec-fetch-site"), origin = req.get("origin");
      if (!bearer && (site === "cross-site" || site === "same-site" || origin && origin !== `${req.protocol}://${req.get("host")}`)) {
        return void res.status(403).json({ error: "Draft edits must come from this application", code: "ORIGIN_REJECTED" });
      }
      const parsed = chatDraftEditSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Provide a valid email draft and its original message", code: "INVALID_DRAFT" });
      const { threadId, messageId, expectedContent, subject, bodyMarkdown } = parsed.data;
      const original = (await deps.db.query(`SELECT ${messageColumns} FROM chat_messages m
        WHERE m.id=$1 AND m.thread_id=$2 AND ${accessPredicate}`, [messageId, threadId, userId])).rows[0];
      if (!original) return void res.status(404).json({ error: "Draft not found", code: "DRAFT_NOT_FOUND" });
      if (original.content !== expectedContent) return void res.status(409).json({ error: "This draft has changed. Reopen it before saving your edits.", code: "DRAFT_CHANGED" });
      const draft = original.role === "assistant" ? extractChatEmailDraft(original.content) : null;
      if (!draft) return void res.status(409).json({ error: "This message is not an editable email draft", code: "DRAFT_NOT_EDITABLE" });
      const before = hasEmailDraftEditNote(draft.before)
        ? draft.before : [draft.before, EMAIL_DRAFT_EDIT_NOTE].filter(Boolean).join("\n\n");
      const content = `${before}\n\nSubject: ${subject}\n\n${bodyMarkdown.trim()}`;
      if (content.length > CHAT_MESSAGE_LIMIT) return void res.status(400).json({ error: "This edited message is too large to save", code: "INVALID_DRAFT" });
      // The comparison and access recheck are part of the write itself. A
      // concurrent edit or membership revocation cannot be overwritten after
      // the initial read. All attachment/action/author fields stay untouched.
      const updated = (await deps.db.query(`UPDATE chat_messages m SET content=$5
        WHERE m.id=$1 AND m.thread_id=$2 AND m.role='assistant' AND m.content=$4
          AND ${accessPredicate}
          AND EXISTS (SELECT 1 FROM users u WHERE u.id=$3 AND u.is_active IS DISTINCT FROM FALSE
            AND lower(trim(coalesce(u.role, ''))) <> 'client'
            AND lower(trim(coalesce(u.email, ''))) LIKE '%@brucegillinghampollard.com')
        RETURNING ${messageColumns}`, [messageId, threadId, userId, expectedContent, content])).rows[0];
      if (!updated) return void res.status(409).json({ error: "This draft changed or is no longer available. Reopen the chat before saving.", code: "DRAFT_CHANGED" });
      // A socket failure must not turn a successful save into a false failure.
      try { deps.emitMessageUpdated(threadId, messageId, content); } catch { /* Reload still reads the saved message. */ }
      res.json(updated);
    } catch {
      res.status(500).json({ error: "Unable to save this draft. Reopen the chat to check its latest version before retrying.", code: "DRAFT_EDIT_FAILED" });
    }
  });
  return router;
}

export async function registerChatDraftEditRoutes(app: Express): Promise<void> {
  const [{ pool }, { requireAuth }, { emitMessageUpdated }] = await Promise.all([
    import("./db"), import("./auth"), import("./websocket"),
  ]);
  app.use("/api/chat-drafts", createChatDraftEditRouter({ db: pool, requireAuth, emitMessageUpdated }));
}
