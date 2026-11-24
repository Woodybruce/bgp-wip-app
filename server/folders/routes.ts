// The folder engine's routes (Woody, 24 November 2026: "go ahead with the
// folder suggestion"; docs/folders-review-2026-11-20.md, 4.4). Every route is
// BGP staff's, signed in as themselves, and every folder action runs on the
// person's own Microsoft 365 (decision 7): with none connected they are asked
// to connect, never given a colleague's token. The whole of /api/folders/ is
// refused to client logins at the client gateway (server/index.ts); their
// data room stays on /api/client/sharepoint/.
//
//   GET    /api/folders/places                         the BGP library ("BGP - Share Drive"), My OneDrive, followed folders
//   GET    /api/folders/browse?driveId=&itemId=        a folder's contents, folders first (&folders=1: folders only)
//   GET    /api/folders/search?q=&in=all|library|onedrive   folders by name
//   PATCH  /api/folders/links/:id                      label, colour, position
//   DELETE /api/folders/links/:id                      unlink (SharePoint untouched)
//   GET    /api/folders/:recordType/:recordId          the record's folders, then its property's
//   POST   /api/folders/:recordType/:recordId/links    link { driveId, itemId } or { url }; label, colour
//   POST   /api/folders/:recordType/:recordId/create   make { driveId, parentId, name, template? }, then link it
//
// Inside a folder (step 3), on the person's own Microsoft 365, each logged:
//   POST   /api/folders/items/:driveId/:itemId/folders      a new folder inside { name }
//   POST   /api/folders/items/:driveId/:itemId/rename       { name }
//   POST   /api/folders/items/:driveId/:itemId/move         { toDriveId, parentId } (the same library only)
//   POST   /api/folders/items/:driveId/:itemId/copy         { toDriveId, toParentId } → { jobId }
//   GET    /api/folders/copies/:jobId                       how far the copy has got
//   DELETE /api/folders/items/:driveId/:itemId              to the library's recycle bin
//   POST   /api/folders/items/:driveId/:itemId/upload       a file of up to 10 MB (multipart "file", "name")
//   POST   /api/folders/items/:driveId/:itemId/upload-session { name, size } → { sessionId, pieceSize }
//   PUT    /api/folders/uploads/:sessionId                  one piece (Content-Range), passed on with no token
//   DELETE /api/folders/uploads/:sessionId                  give up an upload
//   POST   /api/folders/items/:driveId/:itemId/share        { scope: anonymous|organization, edit } → a link
//   POST   /api/folders/items/:driveId/:itemId/invite       { emails, write, message }
//   POST   /api/folders/items/:driveId/:itemId/preview      → an address to show it in a frame
import { randomUUID } from "node:crypto";
import express, { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "../utils/upload";
import {
  SHARE_DRIVE_NAME, UPLOAD_PIECE, UPLOAD_PIECE_MAX, UPLOAD_SESSION_ABOVE, inviteEmails, isGraphId, itemNameProblem, folderTemplate,
  needsUploadSession, parseContentRange, pieceProblem, uploadProblem,
} from "@shared/folders";
import {
  GraphError, bgpLibrary, cancelUploadSession, copyProgress, createFolder, createFolderTree, deleteItem, folderPlaces, getEntry,
  invitePeople, itemForChange, listChildren, moveItem, previewUrl, renameItem, searchFolders, shareLink, startCopy, startUploadSession,
  uploadPiece, uploadSmall,
} from "./graph";
import { folderRecord, folderStaff, type Db, type FolderStaff } from "./access";
import { addFolderLink, changeFolderLink, folderRefusal, logFolderAction, readRecordFolders, unlinkFolder, type FolderActionEntry } from "./links";

export interface FolderRouteDeps {
  db: Db;
  auth: RequestHandler;
  staff: (req: Request) => Promise<FolderStaff | null>;
  /** The person's own Microsoft 365: their token and the account it is, or null. Never a colleague's. */
  microsoft: (userId: string) => Promise<{ token: string; account: string } | null>;
}

export const STAFF_ONLY = "Folders are BGP staff's, signed in as themselves.";
export const CONNECT_FIRST = "Connect your own Microsoft 365 first, on the SharePoint page: folder actions run as you, never as a colleague.";

type Ctx = { staff: FolderStaff; ms: { token: string; account: string } | null };
interface UploadSession { userId: string; account: string | null; uploadUrl: string; driveId: string; parentId: string; name: string; size: number; next: number; startedAt: number }
const COPY_KEEP_MS = 6 * 60 * 60_000;
const UPLOAD_KEEP_MS = 3 * 60 * 60_000;
type Need = "staff" | "maybe" | "microsoft";

/** Folders first, then by name as people read numbers. */
export function sortEntries<T extends { isFolder: boolean; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.isFolder ? -1 : 1));
}

function sendError(res: Response, e: any) {
  if (e instanceof GraphError) {
    const status = e.status === 401 ? 403 : e.status === 429 ? 503 : e.status >= 500 && e.status !== 503 && e.status !== 507 ? 502 : e.status;
    return res.status(status).json({ message: e.message });
  }
  if (e?.status && e.status >= 400 && e.status < 500) return res.status(e.status).json({ message: e.message });
  console.error("[folders]", e?.message || e);
  res.status(500).json({ message: "The folders could not be read or changed." });
}

export function foldersRouter(deps: FolderRouteDeps): Router {
  const router = Router();
  const { db, auth } = deps;
  // The staff check comes first, before any Microsoft token is touched.
  const handle = (need: Need, fn: (req: Request, res: Response, ctx: Ctx) => Promise<unknown>): RequestHandler => async (req, res) => {
    try {
      const staff = await deps.staff(req);
      if (!staff) return res.status(403).json({ message: STAFF_ONLY });
      const ms = need === "staff" ? null : await deps.microsoft(staff.userId);
      if (need === "microsoft" && !ms) return res.status(428).json({ message: CONNECT_FIRST, connect: true });
      await fn(req, res, { staff, ms });
    } catch (e) {
      sendError(res, e);
    }
  };
  const actorOf = (ctx: Ctx) => ({ userId: ctx.staff.userId, account: ctx.ms?.account ?? null });
  // Copies being followed and uploads going up in pieces, in memory: a restart loses them, and the screens say so.
  const copies = new Map<string, { userId: string; monitor: string | null; startedAt: number; name: string }>();
  const uploads = new Map<string, UploadSession>();
  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of copies) if (now - v.startedAt > COPY_KEEP_MS) copies.delete(k);
    for (const [k, v] of uploads) if (now - v.startedAt > UPLOAD_KEEP_MS) uploads.delete(k);
  };

  router.get("/api/folders/places", auth, handle("microsoft", async (_req, res, { ms }) => {
    res.json(await folderPlaces(ms!.token));
  }));

  router.get("/api/folders/browse", auth, handle("microsoft", async (req, res, { ms }) => {
    const driveId = String(req.query.driveId || ""), itemId = String(req.query.itemId || "");
    if (!isGraphId(driveId) || !isGraphId(itemId)) throw folderRefusal(400, "Which folder?");
    const [folder, items] = await Promise.all([
      getEntry(ms!.token, driveId, itemId),
      listChildren(ms!.token, driveId, itemId, { foldersOnly: req.query.folders === "1" }),
    ]);
    if (!folder.isFolder) throw folderRefusal(400, "That is a file, not a folder.");
    res.json({ folder, items: sortEntries(items) });
  }));

  router.get("/api/folders/search", auth, handle("microsoft", async (req, res, { ms }) => {
    const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (q.length < 2) return res.json({ items: [] });
    const where = req.query.in === "library" || req.query.in === "onedrive" ? req.query.in : "all";
    res.json({ items: await searchFolders(ms!.token, q, where) });
  }));

  router.patch("/api/folders/links/:id", auth, handle("staff", async (req, res, ctx) => {
    res.json(await changeFolderLink(db, actorOf(ctx), String(req.params.id), req.body && typeof req.body === "object" ? req.body : {}));
  }));

  router.delete("/api/folders/links/:id", auth, handle("staff", async (req, res, ctx) => {
    res.json(await unlinkFolder(db, actorOf(ctx), String(req.params.id)));
  }));

  // ── Inside a folder ───────────────────────────────────────────────────
  const itemIds = (req: Request) => {
    const driveId = String(req.params.driveId || ""), itemId = String(req.params.itemId || "");
    if (!isGraphId(driveId) || !isGraphId(itemId)) throw folderRefusal(400, "Which file or folder?");
    return { driveId, itemId };
  };
  const bodyOf = (req: Request): Record<string, any> => (req.body && typeof req.body === "object" ? req.body : {});
  // The top of a library, and "BGP - Share Drive" itself, are never renamed, moved or deleted from the app.
  const changeable = async (token: string, driveId: string, itemId: string) => {
    const it = await itemForChange(token, driveId, itemId);
    if (it.isRoot) throw folderRefusal(400, "That is the top of a library: it can't be changed from the app.");
    if (it.entry.name === SHARE_DRIVE_NAME) {
      const lib = await bgpLibrary(token).catch(() => null);
      if (lib && lib.driveId === driveId && lib.itemId === it.parentId) throw folderRefusal(400, `${SHARE_DRIVE_NAME} can't be changed from the app.`);
    }
    return it;
  };
  // A failed action is logged too, then the refusal goes back.
  const logged = async <T>(ctx: Ctx, entry: FolderActionEntry, run: () => Promise<T>, after?: (out: T) => Partial<FolderActionEntry>): Promise<T> => {
    const actor = actorOf(ctx);
    try {
      const out = await run();
      await logFolderAction(db, actor, { ...entry, ...(after ? after(out) : {}) });
      return out;
    } catch (e: any) {
      await logFolderAction(db, actor, { ...entry, ok: false, error: e?.message || "failed" });
      throw e;
    }
  };

  router.post("/api/folders/items/:driveId/:itemId/folders", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const name = String(bodyOf(req).name ?? "").trim();
    const problem = itemNameProblem(name);
    if (problem) throw folderRefusal(400, problem);
    const item = await logged(ctx, { action: "create", driveId, parentAfter: itemId, nameAfter: name }, () => createFolder(ctx.ms!.token, driveId, itemId, name), made => ({ itemId: made.itemId }));
    res.json({ item });
  }));

  router.post("/api/folders/items/:driveId/:itemId/rename", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const name = String(bodyOf(req).name ?? "").trim();
    const problem = itemNameProblem(name);
    if (problem) throw folderRefusal(400, problem);
    const it = await changeable(ctx.ms!.token, driveId, itemId);
    const item = await logged(ctx, { action: "rename", driveId, itemId, nameBefore: it.entry.name, nameAfter: name, parentBefore: it.parentId }, () => renameItem(ctx.ms!.token, driveId, itemId, name));
    res.json({ item });
  }));

  router.post("/api/folders/items/:driveId/:itemId/move", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const body = bodyOf(req);
    if (!isGraphId(body.parentId)) throw folderRefusal(400, "Pick the folder to move it to.");
    if (body.toDriveId !== undefined && body.toDriveId !== driveId) throw folderRefusal(400, "A move stays in the same library. To put it in another library, copy it there.");
    if (body.parentId === itemId) throw folderRefusal(400, "A folder can't go inside itself.");
    const it = await changeable(ctx.ms!.token, driveId, itemId);
    if (it.parentId === body.parentId) return res.json({ item: it.entry, unchanged: true });
    const item = await logged(ctx, { action: "move", driveId, itemId, nameBefore: it.entry.name, parentBefore: it.parentId, parentAfter: body.parentId }, () => moveItem(ctx.ms!.token, driveId, itemId, body.parentId));
    res.json({ item });
  }));

  router.post("/api/folders/items/:driveId/:itemId/copy", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const body = bodyOf(req);
    if (!isGraphId(body.toDriveId) || !isGraphId(body.toParentId)) throw folderRefusal(400, "Pick the folder to copy it to.");
    const it = await itemForChange(ctx.ms!.token, driveId, itemId);
    if (it.isRoot) throw folderRefusal(400, "That is the top of a library: copy the folders inside it instead.");
    sweep();
    const jobId = randomUUID();
    const monitor = await logged(ctx, { action: "copy", driveId, itemId, nameBefore: it.entry.name, parentBefore: it.parentId, parentAfter: body.toParentId, detail: { toDriveId: body.toDriveId, jobId } },
      () => startCopy(ctx.ms!.token, driveId, itemId, body.toDriveId, body.toParentId));
    copies.set(jobId, { userId: ctx.staff.userId, monitor, startedAt: Date.now(), name: it.entry.name });
    const followed = monitor !== null;
    res.json({ jobId, name: it.entry.name, followed });
  }));

  router.get("/api/folders/copies/:jobId", auth, handle("staff", async (req, res, { staff }) => {
    sweep();
    const job = copies.get(String(req.params.jobId));
    if (!job || job.userId !== staff.userId) throw folderRefusal(404, "That copy isn't known any more: look in the folder it was copied to.");
    if (!job.monitor) return res.json({ name: job.name, state: "running", percent: null, unfollowed: true });
    const state = await copyProgress(job.monitor);
    if (state.state !== "running") copies.delete(String(req.params.jobId));
    res.json({ name: job.name, ...state });
  }));

  router.delete("/api/folders/items/:driveId/:itemId", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const it = await changeable(ctx.ms!.token, driveId, itemId);
    const linked = (await db.query(
      `SELECT count(*)::int AS n FROM record_folders WHERE drive_id = $1 AND item_id = $2 AND removed_at IS NULL`, [driveId, itemId],
    )).rows[0]?.n || 0;
    if (linked) throw folderRefusal(409, `It is linked to ${linked === 1 ? "a record" : `${linked} records`} in the app: unlink it there first.`);
    await logged(ctx, { action: "delete", driveId, itemId, nameBefore: it.entry.name, parentBefore: it.parentId }, () => deleteItem(ctx.ms!.token, driveId, itemId));
    res.json({ deleted: true, name: it.entry.name });
  }));

  const smallUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_SESSION_ABOVE, files: 1, fields: 4 } }).single("file");
  router.post("/api/folders/items/:driveId/:itemId/upload", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    // The file is read only after the staff check, and never over 10 MB.
    await new Promise<void>((done, fail) => smallUpload(req, res, (err: any) => (err ? fail(folderRefusal(400, err?.code === "LIMIT_FILE_SIZE" ? "Files over 10 MB go up in pieces: try again." : "The file did not arrive.")) : done())));
    const file = (req as any).file as { buffer: Buffer; originalname: string; size: number } | undefined;
    if (!file) throw folderRefusal(400, "Choose a file to upload.");
    const name = String(bodyOf(req).name || file.originalname || "").trim();
    const problem = uploadProblem(name, file.size);
    if (problem) throw folderRefusal(400, problem);
    const item = await logged(ctx, { action: "upload", driveId, parentAfter: itemId, nameAfter: name, detail: { size: file.size } }, () => uploadSmall(ctx.ms!.token, driveId, itemId, name, new Uint8Array(file.buffer)), made => ({ itemId: made.itemId, nameAfter: made.name }));
    res.json({ item });
  }));

  router.post("/api/folders/items/:driveId/:itemId/upload-session", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const body = bodyOf(req);
    const name = String(body.name ?? "").trim();
    const size = Number(body.size);
    const problem = uploadProblem(name, size);
    if (problem) throw folderRefusal(400, problem);
    if (!needsUploadSession(size)) throw folderRefusal(400, "Files of 10 MB or less go up in one go.");
    sweep();
    const session = await startUploadSession(ctx.ms!.token, driveId, itemId, name);
    const sessionId = randomUUID();
    uploads.set(sessionId, { userId: ctx.staff.userId, account: ctx.ms!.account, uploadUrl: session.uploadUrl, driveId, parentId: itemId, name, size, next: 0, startedAt: Date.now() });
    res.json({ sessionId, pieceSize: UPLOAD_PIECE });
  }));

  const pieceBody = express.raw({ type: () => true, limit: UPLOAD_PIECE_MAX + 1 });
  router.put("/api/folders/uploads/:sessionId", auth, handle("staff", async (req, res, ctx) => {
    const sessionId = String(req.params.sessionId);
    const session = uploads.get(sessionId);
    if (!session || session.userId !== ctx.staff.userId) throw folderRefusal(404, "That upload isn't going any more: start it again.");
    // The piece is read only after the staff check, and never over 10 MB.
    await new Promise<void>((done, fail) => pieceBody(req, res, (err: any) => (err ? fail(folderRefusal(413, "A piece can be at most 10 MB.")) : done())));
    const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
    const range = parseContentRange(req.headers["content-range"]);
    const problem = pieceProblem(range, bytes.length, session);
    if (problem) throw folderRefusal(400, problem);
    let out;
    try {
      out = await uploadPiece(session.uploadUrl, bytes, range!.start, session.size);
    } catch (e: any) {
      uploads.delete(sessionId);
      await cancelUploadSession(session.uploadUrl);
      await logFolderAction(db, { userId: session.userId, account: session.account }, { action: "upload", driveId: session.driveId, parentAfter: session.parentId, nameAfter: session.name, ok: false, error: e?.message || "failed", detail: { size: session.size, session: true } });
      throw e;
    }
    if (!out.done) {
      session.next = out.next;
      return res.json({ next: out.next });
    }
    uploads.delete(sessionId);
    await logFolderAction(db, { userId: session.userId, account: session.account }, { action: "upload", driveId: session.driveId, itemId: out.done.itemId, parentAfter: session.parentId, nameAfter: out.done.name, detail: { size: session.size, session: true } });
    res.json({ item: out.done });
  }));

  router.delete("/api/folders/uploads/:sessionId", auth, handle("staff", async (req, res, ctx) => {
    const sessionId = String(req.params.sessionId);
    const session = uploads.get(sessionId);
    if (session && session.userId === ctx.staff.userId) {
      uploads.delete(sessionId);
      await cancelUploadSession(session.uploadUrl);
    }
    res.json({ cancelled: true });
  }));

  router.post("/api/folders/items/:driveId/:itemId/share", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const body = bodyOf(req);
    const scope = body.scope === "organization" ? "organization" : "anonymous";
    const edit = body.edit === true;
    const link = await logged(ctx, { action: "share", driveId, itemId, detail: { scope, edit } }, () => shareLink(ctx.ms!.token, driveId, itemId, { scope, edit }), out => ({ detail: { scope: out.scope, edit, fellBack: out.fellBack } }));
    res.json(link);
  }));

  router.post("/api/folders/items/:driveId/:itemId/invite", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const body = bodyOf(req);
    const emails = inviteEmails(body.emails);
    if (!emails) throw folderRefusal(400, "Give up to 20 email addresses, separated by commas.");
    const write = body.write === true;
    const message = String(body.message ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || "Sharing this with you from Bruce Gillingham Pollard.";
    await logged(ctx, { action: "invite", driveId, itemId, detail: { emails, write } }, () => invitePeople(ctx.ms!.token, driveId, itemId, emails, write, message));
    res.json({ invited: emails });
  }));

  router.post("/api/folders/items/:driveId/:itemId/preview", auth, handle("microsoft", async (req, res, ctx) => {
    const { driveId, itemId } = itemIds(req);
    const url = await logged(ctx, { action: "preview", driveId, itemId }, () => previewUrl(ctx.ms!.token, driveId, itemId));
    res.json({ url });
  }));

  router.get("/api/folders/:recordType/:recordId", auth, handle("maybe", async (req, res, { staff, ms }) => {
    const record = await folderRecord(db, req.params.recordType, req.params.recordId);
    if (!record) throw folderRefusal(404, "Not found.");
    res.json(await readRecordFolders(db, record, { userId: staff.userId, token: ms?.token ?? null }));
  }));

  router.post("/api/folders/:recordType/:recordId/links", auth, handle("microsoft", async (req, res, ctx) => {
    const record = await folderRecord(db, req.params.recordType, req.params.recordId);
    if (!record) throw folderRefusal(404, "Not found.");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    res.json(await addFolderLink(db, record, { ...actorOf(ctx), token: ctx.ms!.token }, body));
  }));

  router.post("/api/folders/:recordType/:recordId/create", auth, handle("microsoft", async (req, res, ctx) => {
    const record = await folderRecord(db, req.params.recordType, req.params.recordId);
    if (!record) throw folderRefusal(404, "Not found.");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!isGraphId(body.driveId) || !isGraphId(body.parentId)) throw folderRefusal(400, "Pick where to make it.");
    const name = String(body.name ?? "").trim();
    const problem = itemNameProblem(name);
    if (problem) throw folderRefusal(400, problem);
    const template = folderTemplate(body.template);
    if (!template) throw folderRefusal(400, "Pick an empty folder or the property folder.");
    const actor = { ...actorOf(ctx), token: ctx.ms!.token };
    let made;
    try {
      made = template.length
        ? await createFolderTree(actor.token, body.driveId, body.parentId, name, template)
        : { root: await createFolder(actor.token, body.driveId, body.parentId, name), made: 1, failed: [] as string[] };
    } catch (e: any) {
      await logFolderAction(db, actor, { action: "create", recordType: record.type, recordId: record.id, driveId: body.driveId, parentAfter: body.parentId, nameAfter: name, ok: false, error: e?.message || "not made" });
      throw e;
    }
    await logFolderAction(db, actor, {
      action: "create", recordType: record.type, recordId: record.id, driveId: made.root.driveId, itemId: made.root.itemId,
      nameAfter: name, parentAfter: body.parentId, detail: { template: body.template || "empty", made: made.made, failed: made.failed },
    });
    const link = await addFolderLink(db, record, actor, { label: body.label }, made.root);
    res.json({ link, made: made.made, failed: made.failed });
  }));

  return router;
}

/** The router the app mounts, on the app's database and the person's own Microsoft 365. */
export async function appFoldersRouter(): Promise<Router> {
  const [{ pool }, { requireAuth }, { getOwnMsAccess }] = await Promise.all([import("../db"), import("../auth"), import("../microsoft")]);
  return foldersRouter({ db: pool, auth: requireAuth, staff: req => folderStaff(req, pool), microsoft: userId => getOwnMsAccess(userId) });
}
