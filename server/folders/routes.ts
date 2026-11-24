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
import { Router, type Request, type RequestHandler, type Response } from "express";
import { isGraphId, itemNameProblem, folderTemplate } from "@shared/folders";
import { GraphError, createFolder, createFolderTree, folderPlaces, getEntry, listChildren, searchFolders } from "./graph";
import { folderRecord, folderStaff, type Db, type FolderStaff } from "./access";
import { addFolderLink, changeFolderLink, folderRefusal, logFolderAction, readRecordFolders, unlinkFolder } from "./links";

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
