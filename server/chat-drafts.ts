import { createHash } from "node:crypto";
import { Router, type Express, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { exportRichTextText, renderEmailHtml } from "../shared/chat-rich-text";
import { createChatDraftWord } from "./chat-drafts-word";
import { contentDispositionFor } from "./utils/http-headers";

export const CHAT_DRAFT_BODY_LIMIT = 120_000;
const plainText = z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value), "Unsupported control characters");
const exportShape = {
  subject: plainText.pipe(z.string().trim().min(1).max(200)).refine(value => !/[\r\n]/.test(value), "Subject must be one line"),
  bodyMarkdown: plainText.pipe(z.string().min(1).max(CHAT_DRAFT_BODY_LIMIT)).refine(value => value.trim().length > 0, "Body is required"),
  threadId: z.string().uuid().optional(),
};
export const chatWordSchema = z.object(exportShape).strict();
export const chatOutlookSchema = z.object({ ...exportShape, idempotencyKey: z.string().uuid() }).strict();
export type ChatDraftInput = z.infer<typeof chatOutlookSchema>;
export type DraftLink = { id: string; webLink: string };
export type DraftRecord = { request_hash: string; state: "pending" | "complete" | "rejected"; draft_id: string | null; error_code: string | null };
export interface ChatDraftDatabase {
  query(sql: string, values?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ChatDraftStore {
  reserve(userId: string, key: string, hash: string): Promise<{ created: boolean; record: DraftRecord }>;
  complete(userId: string, key: string, draftId: string): Promise<void>;
  reject(userId: string, key: string, code: string): Promise<void>;
}
export interface ChatDraftDependencies {
  db: ChatDraftDatabase;
  requireAuth: RequestHandler;
  getToken(userId: string): Promise<string | null>;
  fetchGraph?: typeof fetch;
  store?: ChatDraftStore;
}

export class ChatDraftError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const permissionRequired = () => new ChatDraftError(409, "MICROSOFT_DRAFT_PERMISSION_REQUIRED",
  "Connect your own Microsoft account with Mail.ReadWrite permission to create Outlook drafts. Your Microsoft administrator may need to approve this permission.");
const uncertainOutcome = () => new ChatDraftError(409, "DRAFT_OUTCOME_UNCERTAIN",
  "Outlook has not confirmed this draft yet. Check your Drafts folder before starting another export. Retrying this same request only checks the original attempt; it will not create another draft.");
const unavailableDraft = () => new ChatDraftError(409, "DRAFT_NO_LONGER_AVAILABLE",
  "The original Outlook message is no longer an available draft. No replacement was created.");

export async function ensureChatDraftSchema(db: ChatDraftDatabase): Promise<void> {
  // No message body, token, recipients or mailbox address is persisted here.
  // Retain uncertain keys indefinitely: expiring one could permit a duplicate.
  await db.query(`CREATE TABLE IF NOT EXISTS chat_draft_requests (
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'rejected')),
    draft_id TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
  )`);
}

export function createChatDraftStore(db: ChatDraftDatabase): ChatDraftStore {
  let schema: Promise<void> | undefined;
  const ready = () => schema ??= ensureChatDraftSchema(db).catch(error => { schema = undefined; throw error; });
  return {
    async reserve(userId, key, hash) {
      await ready();
      const inserted = await db.query(`INSERT INTO chat_draft_requests (user_id, idempotency_key, request_hash)
        VALUES ($1,$2,$3) ON CONFLICT (user_id, idempotency_key) DO NOTHING
        RETURNING request_hash, state, draft_id, error_code`, [userId, key, hash]);
      if (inserted.rows[0]) return { created: true, record: inserted.rows[0] };
      // A confirmed 401/403 means Graph did not create a message. After a fresh
      // delegated token was acquired, one caller may retry that rejected POST.
      // Never reopen a pending/uncertain request or a key for changed content.
      const retry = await db.query(`UPDATE chat_draft_requests SET state='pending', error_code=NULL, updated_at=now()
        WHERE user_id=$1 AND idempotency_key=$2 AND request_hash=$3 AND state='rejected'
          AND error_code='MICROSOFT_DRAFT_PERMISSION_REQUIRED'
        RETURNING request_hash, state, draft_id, error_code`, [userId, key, hash]);
      if (retry.rows[0]) return { created: true, record: retry.rows[0] };
      const existing = await db.query(`SELECT request_hash, state, draft_id, error_code
        FROM chat_draft_requests WHERE user_id=$1 AND idempotency_key=$2`, [userId, key]);
      if (!existing.rows[0]) throw new Error("Draft attempt could not be reserved");
      return { created: false, record: existing.rows[0] };
    },
    async complete(userId, key, draftId) {
      await db.query(`UPDATE chat_draft_requests SET state='complete', draft_id=$3, error_code=NULL, updated_at=now()
        WHERE user_id=$1 AND idempotency_key=$2`, [userId, key, draftId]);
    },
    async reject(userId, key, code) {
      await db.query(`UPDATE chat_draft_requests SET state='rejected', error_code=$3, updated_at=now()
        WHERE user_id=$1 AND idempotency_key=$2 AND state='pending'`, [userId, key, code]);
    },
  };
}

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0/me/messages";
// One stable named property; the value is an opaque hash of user + request key.
export const CHAT_DRAFT_PROPERTY = "String {f0e7bb21-8096-49f1-a998-b62561bd2107} Name ChatBGPDraftRequest";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const draftMarker = (userId: string, key: string) => digest(JSON.stringify([userId, key]));

function verifiedDraft(value: any): DraftLink | null {
  if (value?.isDraft !== true || typeof value.id !== "string" || !value.id || value.id.length > 4096 || typeof value.webLink !== "string") return null;
  try {
    const url = new URL(value.webLink);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["outlook.office.com", "outlook.office365.com", "outlook.live.com", "outlook.cloud.microsoft"].includes(url.hostname)) return null;
    return { id: value.id, webLink: value.webLink };
  } catch { return null; }
}

/** Only /me/messages is used. No shared mailbox, app token, send or reply API. */
export async function createOutlookDraft(
  userId: string, input: ChatDraftInput,
  deps: Pick<ChatDraftDependencies, "getToken" | "fetchGraph"> & { store: ChatDraftStore },
): Promise<DraftLink> {
  const token = await deps.getToken(userId);
  if (!token) throw permissionRequired();
  const html = renderEmailHtml(input.bodyMarkdown);
  if (Buffer.byteLength(html, "utf8") > 1_000_000) throw new ChatDraftError(413, "DRAFT_TOO_LARGE", "This draft is too large to export.");
  const hash = digest(JSON.stringify([input.subject, input.bodyMarkdown, input.threadId ?? null]));
  const reservation = await deps.store.reserve(userId, input.idempotencyKey, hash);
  if (reservation.record.request_hash !== hash) throw new ChatDraftError(409, "IDEMPOTENCY_CONFLICT",
    "This export key was already used for different content. Start a new export for the changed draft.");
  if (reservation.record.state === "rejected") {
    if (reservation.record.error_code === "MICROSOFT_DRAFT_PERMISSION_REQUIRED") throw permissionRequired();
    throw new ChatDraftError(409, "DRAFT_REQUEST_REJECTED", "Outlook rejected the original request. Review the draft before starting a new export.");
  }
  const fetchGraph = deps.fetchGraph ?? fetch;
  const request = (url: string, init: RequestInit = {}) => fetchGraph(url, {
    ...init, redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' },
  });
  const readDraft = async (id: string): Promise<DraftLink> => {
    let response: globalThis.Response;
    try { response = await request(`${GRAPH_ROOT}/${encodeURIComponent(id)}?$select=id,isDraft,webLink`); }
    catch { throw uncertainOutcome(); }
    if (response.status === 401 || response.status === 403) throw permissionRequired();
    if (response.status === 404) throw unavailableDraft();
    if (!response.ok) throw uncertainOutcome();
    const message = await response.json().catch(() => null);
    if (message?.isDraft === false) throw unavailableDraft();
    const draft = verifiedDraft(message);
    if (!draft) throw uncertainOutcome();
    return draft;
  };

  if (!reservation.created) {
    if (reservation.record.draft_id) return readDraft(reservation.record.draft_id);
    // A previous POST may have succeeded despite a lost response/server restart.
    // Reconcile with Graph, but never repeat POST after any uncertain attempt.
    const params = new URLSearchParams({
      "$filter": `singleValueExtendedProperties/Any(ep: ep/id eq '${CHAT_DRAFT_PROPERTY}' and ep/value eq '${draftMarker(userId, input.idempotencyKey)}')`,
      "$select": "id,isDraft,webLink", "$top": "2",
    });
    let response: globalThis.Response;
    try { response = await request(`${GRAPH_ROOT}?${params}`); } catch { throw uncertainOutcome(); }
    if (response.status === 401 || response.status === 403) throw permissionRequired();
    if (!response.ok) throw uncertainOutcome();
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.value) || data.value.length !== 1 || data["@odata.nextLink"]) throw uncertainOutcome();
    if (data.value[0]?.isDraft === false) throw unavailableDraft();
    const draft = verifiedDraft(data.value[0]);
    if (!draft) throw uncertainOutcome();
    await deps.store.complete(userId, input.idempotencyKey, draft.id);
    return draft;
  }

  let response: globalThis.Response;
  try {
    response = await request(GRAPH_ROOT, {
      method: "POST",
      body: JSON.stringify({
        subject: exportRichTextText(input.subject, false), body: { contentType: "HTML", content: html },
        // Recipients are intentionally empty: the user chooses them in Outlook.
        toRecipients: [], ccRecipients: [], bccRecipients: [],
        singleValueExtendedProperties: [{ id: CHAT_DRAFT_PROPERTY, value: draftMarker(userId, input.idempotencyKey) }],
      }),
    });
  } catch { throw uncertainOutcome(); }
  if (!response.ok) {
    // Only definitive client rejections can be marked rejected. 408/429/5xx
    // and unknown transport failures remain uncertain and cannot be retried.
    if ([400, 401, 403, 404, 405, 413, 415, 422].includes(response.status)) {
      const denied = response.status === 401 || response.status === 403;
      await deps.store.reject(userId, input.idempotencyKey, denied ? "MICROSOFT_DRAFT_PERMISSION_REQUIRED" : "DRAFT_REQUEST_REJECTED");
      if (denied) throw permissionRequired();
      throw new ChatDraftError(422, "DRAFT_REQUEST_REJECTED", "Outlook could not create this draft. Review the content before starting a new export.");
    }
    throw uncertainOutcome();
  }
  const created = await response.json().catch(() => null);
  if (typeof created?.id !== "string" || !created.id || created.id.length > 4096) throw uncertainOutcome();
  const draft = await readDraft(created.id);
  await deps.store.complete(userId, input.idempotencyKey, draft.id);
  return draft;
}

function respondError(res: Response, error: unknown) {
  // Do not pass provider responses, request content, tokens or stack traces to
  // the client/global logger. Only our fixed user-facing errors are exposed.
  if (error instanceof ChatDraftError) return res.status(error.status).json({ error: error.message, code: error.code });
  return res.status(500).json({ error: "Unable to export this draft. Please try again.", code: "DRAFT_EXPORT_FAILED" });
}

export function createChatDraftRouter(deps: ChatDraftDependencies) {
  const router = Router();
  const store = deps.store ?? createChatDraftStore(deps.db);
  router.use((_req, res, next) => {
    res.set({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });
  router.use(deps.requireAuth);
  router.use(async (req, res, next) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      if (!userId) return void res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      const user = (await deps.db.query("SELECT email, role, is_active FROM users WHERE id=$1", [userId])).rows[0];
      if (!user) return void res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      if (user.is_active === false || String(user.role).trim().toLowerCase() === "client" ||
        !String(user.email ?? "").trim().toLowerCase().endsWith("@brucegillinghampollard.com")) {
        return void res.status(403).json({ error: "Draft exports are available to BGP staff only", code: "STAFF_REQUIRED" });
      }
      res.locals.chatDraftUserId = String(userId);
      next();
    } catch (error) { respondError(res, error); }
  });
  router.use((req, res, next) => {
    if (!req.is("application/json")) return void res.status(415).json({ error: "Send draft content as JSON", code: "JSON_REQUIRED" });
    const bearer = !!(req as any).tokenUserId && /^Bearer\s+\S+/i.test(req.get("authorization") ?? "");
    const site = req.get("sec-fetch-site"), origin = req.get("origin");
    if (!bearer && (site === "cross-site" || site === "same-site" || origin && origin !== `${req.protocol}://${req.get("host")}`)) {
      return void res.status(403).json({ error: "Draft exports must come from this application", code: "ORIGIN_REJECTED" });
    }
    next();
  });
  const authorizeThread = async (userId: string, threadId?: string) => {
    if (!threadId) return;
    const result = await deps.db.query(`SELECT t.id FROM chat_threads t WHERE t.id=$1 AND
      (t.created_by=$2 OR EXISTS (SELECT 1 FROM chat_thread_members m WHERE m.thread_id=t.id AND m.user_id=$2))`, [threadId, userId]);
    if (!result.rows[0]) throw new ChatDraftError(404, "THREAD_NOT_FOUND", "Chat not found");
  };
  router.post("/outlook", async (req, res) => {
    const parsed = chatOutlookSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Provide a subject, Markdown body and valid export key", code: "INVALID_DRAFT" });
    try {
      const userId = res.locals.chatDraftUserId;
      await authorizeThread(userId, parsed.data.threadId);
      res.json(await createOutlookDraft(userId, parsed.data, { ...deps, store }));
    } catch (error) { respondError(res, error); }
  });
  router.post("/word", async (req, res) => {
    const parsed = chatWordSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Provide a subject and Markdown body", code: "INVALID_DRAFT" });
    try {
      await authorizeThread(res.locals.chatDraftUserId, parsed.data.threadId);
      const buffer = await createChatDraftWord(parsed.data.subject, parsed.data.bodyMarkdown);
      const name = exportRichTextText(parsed.data.subject, false).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").slice(0, 100) || "ChatBGP draft";
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": contentDispositionFor(`${name}.docx`) });
      res.send(buffer);
    } catch (error) { respondError(res, error); }
  });
  return router;
}

export async function registerChatDraftRoutes(app: Express): Promise<void> {
  const [{ pool }, { requireAuth }, { getDelegatedGraphTokenForUser }] = await Promise.all([
    import("./db"), import("./auth"), import("./microsoft"),
  ]);
  app.use("/api/chat-drafts", createChatDraftRouter({ db: pool, requireAuth,
    getToken: userId => getDelegatedGraphTokenForUser(userId, ["Mail.ReadWrite"]),
  }));
}
