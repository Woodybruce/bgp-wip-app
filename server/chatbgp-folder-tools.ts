// ChatBGP's folder tools, on the folder engine (Woody, 24 November 2026: "go
// ahead with the folder suggestion"; docs/folders-review-2026-11-20.md, step
// 5). Until then they looked the BGP library up themselves on every call,
// worked by path under the retired "BGP share drive", only one of ChatBGP's
// two tool paths knew most of them, and they ran on a colleague's Microsoft
// token when the person asking had none.
//
//   browse_sharepoint_folder    what is in a folder
//   read_sharepoint_file        a file's text (or a file dropped in the chat)
//   create_sharepoint_folder    a new folder
//   move_sharepoint_item        a file or folder into another folder of the same library
//   upload_to_sharepoint        a file from the chat into a folder
//   copy_dropbox_to_sharepoint  files from Dropbox into a folder
//   get_record_folders          a property's, transaction's or company's folders (Folders on its page)
//   link_record_folder          link a folder to one of them
//   and download_email_attachment's save, through saveToShareDrive below.
//
// The rules: BGP staff signed in as themselves, each on their OWN Microsoft
// 365 (never a colleague's: with none connected they are told to connect);
// nothing runs from an automated run, since nobody is asking (reading a
// record's folders excepted, with no Microsoft call); a path starts inside
// BGP - Share Drive, never the old "BGP share drive"; a missing folder is
// made only below a top-level folder that is there; a name already there is
// never replaced; every folder made, file put, move, rename and link is a row
// of folder_actions. Both of ChatBGP's tool paths (executeCrmToolRaw and
// handleCrmToolCall) run this one file.
import type { Request } from "express";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  SHARE_DRIVE_NAME, bgpSharePointUrl, isGraphId, itemNameProblem, type DriveEntry, type FolderLinkView, type FolderRecordType,
} from "@shared/folders";
import {
  GraphError, bgpLibrary, createFolder, downloadFile, entryByPath, getEntry, itemForChange, listChildren, moveItem, openLink, renameItem,
} from "./folders/graph";
import { folderRecord, type Db, type FolderStaff } from "./folders/access";
import { addFolderLink, folderRefusal, logFolderAction, readRecordFolders, type FolderActionEntry, type FolderActor } from "./folders/links";
import { CONNECT_FIRST, STAFF_ONLY, sortEntries } from "./folders/routes";
import { folderAtPath, folderErrorWords, saveFileInto, shareDriveLabel, shareDrivePath, type FolderLog } from "./folders/by-path";

export const FOLDER_TOOLS = [
  "browse_sharepoint_folder", "read_sharepoint_file", "create_sharepoint_folder", "move_sharepoint_item",
  "upload_to_sharepoint", "copy_dropbox_to_sharepoint", "get_record_folders", "link_record_folder",
] as const;
export type FolderTool = (typeof FOLDER_TOOLS)[number];
/** The tools that only read: the single-step path summarises what they find. */
export const FOLDER_READ_TOOLS: readonly FolderTool[] = ["browse_sharepoint_folder", "read_sharepoint_file", "get_record_folders"];

export const AUTOMATED_REFUSAL = "Folder tools run only when a BGP person asks in their own chat, never from an automated run. Nothing was changed.";
const RECORD_REFUSAL = "Say which record: a property, a transaction or a company, with its id from search_crm.";

/** What the tools reach outside the engine; a test stands in for each. */
export interface FolderToolDeps {
  db: Db;
  internal: (req: Request) => boolean;
  staff: (req: Request) => Promise<FolderStaff | null>;
  microsoft: (userId: string) => Promise<{ token: string; account: string } | null>;
  extractText: (filePath: string, name: string) => Promise<string>;
  /** A file from the chat by its stored name; `loose` also finds it by the name it was uploaded with. */
  chatMedia: (name: string, loose: boolean) => Promise<{ data: Buffer; originalName: string | null } | null>;
  dropbox: (dropboxPath: string) => Promise<Buffer>;
}

async function appDeps(): Promise<FolderToolDeps> {
  const [{ pool }, { isInternalStaffRequest }, { folderStaff }, { getOwnMsAccess }] = await Promise.all([
    import("./db"), import("./chatbgp-internal"), import("./folders/access"), import("./microsoft"),
  ]);
  return {
    db: pool,
    internal: isInternalStaffRequest,
    staff: req => folderStaff(req, pool),
    microsoft: userId => getOwnMsAccess(userId),
    extractText: async (filePath, name) => (await import("./chatbgp")).extractTextFromFile(filePath, name),
    chatMedia: async (name, loose) => {
      try {
        return { data: await fs.promises.readFile(path.join(process.cwd(), "ChatBGP", "chat-media", name)), originalName: null };
      } catch { /* not on this machine's disk: the file store has it */ }
      const { getFile, findChatMediaByOriginalName } = await import("./file-storage");
      const stored = await getFile(`chat-media/${name}`);
      if (stored) return { data: stored.data, originalName: stored.originalName };
      const byName = loose ? await findChatMediaByOriginalName(name) : null;
      return byName ? { data: byName.data, originalName: byName.originalName } : null;
    },
    dropbox: async dropboxPath => (await import("./chatbgp-design-tools")).fetchDropboxPdf(dropboxPath),
  };
}

type ToolResult = { data: Record<string, any>; action?: any };
const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({ data: { success: false, error, message: error, ...extra } });
const GENERIC_FAULT = "SharePoint could not be reached just now.";

/** A file from the chat: a stored chat-media name, or its /api/chat-media/ address. Null for anything that could reach another file. */
export function chatMediaName(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  const name = /\/api\/chat-media\/([^?\s#]+)/.exec(text)?.[1] ?? text;
  if (!name || name.length > 300 || /[\/\\%]|\.\./.test(name)) return null;
  return name;
}

/** "property", "transaction" (or "deal") or "company", as the engine's record types. */
export function recordTypeOf(v: unknown): FolderRecordType | null {
  const t = String(v ?? "").trim().toLowerCase();
  if (t === "transaction" || t === "deal") return "deal";
  if (t === "property" || t === "company") return t;
  return null;
}
const RECORD_WORDS: Record<string, string> = { property: "property", deal: "transaction", company: "company" };

// Files whose text is read; anything else is offered as a link.
const READABLE = [".xlsx", ".xls", ".docx", ".pdf", ".pptx", ".csv", ".tsv", ".txt", ".md", ".markdown", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml", ".rtf"];
const TEXT_MAX = 30_000;
const BROWSE_MAX = 300;

async function textOf(deps: FolderToolDeps, bytes: Uint8Array, name: string): Promise<string> {
  const file = path.join(os.tmpdir(), `bgp-folder-read-${randomUUID()}${path.extname(name).toLowerCase()}`);
  await fs.promises.writeFile(file, bytes);
  try {
    return await deps.extractText(file, name);
  } finally {
    await fs.promises.unlink(file).catch(() => undefined);
  }
}
const cut = (text: string) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n\n[Only the first ${TEXT_MAX} of ${text.length} characters are shown.]` : text);

/** Who is acting, on which token, and which part of the app asked (logged as `via`). */
interface Ctx { deps: FolderToolDeps; staff: FolderStaff; token: string; actor: FolderActor; via: string }
const logOf = (ctx: Ctx, detail: Record<string, unknown> = {}): FolderLog => ({ db: ctx.deps.db, actor: ctx.actor, detail: { via: ctx.via, ...detail } });

/** A change logged whether it worked or not, as the folder routes log theirs. */
async function logged<T>(ctx: Ctx, entry: FolderActionEntry, run: () => Promise<T>): Promise<T> {
  const detail = { via: ctx.via, ...((entry.detail as Record<string, unknown>) || {}) };
  try {
    const out = await run();
    await logFolderAction(ctx.deps.db, ctx.actor, { ...entry, detail });
    return out;
  } catch (e: any) {
    await logFolderAction(ctx.deps.db, ctx.actor, { ...entry, detail, ok: false, error: e?.message || "failed" });
    throw e;
  }
}

/** A file or folder named by a link, a path inside BGP - Share Drive, or its ids. */
async function openTarget(ctx: Ctx, given: { url?: unknown; driveId?: unknown; itemId?: unknown }): Promise<DriveEntry> {
  if (given.driveId || given.itemId) {
    if (!isGraphId(given.driveId) || !isGraphId(given.itemId)) throw folderRefusal(400, "Give both driveId and itemId, from a browse_sharepoint_folder result.");
    return getEntry(ctx.token, given.driveId, given.itemId);
  }
  const raw = String(given.url ?? "").trim();
  if (/^https?:\/\//i.test(raw)) {
    if (!bgpSharePointUrl(raw)) throw folderRefusal(400, "That link isn't to BGP's SharePoint or OneDrive (their addresses start https://brucegillinghampollardlimited).");
    return openLink(ctx.token, raw);
  }
  const p = shareDrivePath(raw);
  if ("problem" in p) throw folderRefusal(400, p.problem);
  const lib = await bgpLibrary(ctx.token);
  const entry = await entryByPath(ctx.token, lib.driveId, [SHARE_DRIVE_NAME, ...p.parts].join("/"));
  if (!entry) throw folderRefusal(404, `Nothing is at "${shareDriveLabel(p.parts)}". Check the path with browse_sharepoint_folder.`);
  return entry;
}

/** The folder at a path inside BGP - Share Drive, made below its top-level folder where missing. */
async function folderForSaving(ctx: Ctx, folderPath: unknown, detail: Record<string, unknown>): Promise<DriveEntry> {
  const p = shareDrivePath(folderPath);
  if ("problem" in p) throw folderRefusal(400, p.problem);
  const lib = await bgpLibrary(ctx.token);
  return folderAtPath(ctx.token, lib, [SHARE_DRIVE_NAME, ...p.parts], { make: logOf(ctx, detail), keep: 2 });
}

const itemLine = (e: DriveEntry) => ({
  name: e.name, type: e.isFolder ? "folder" : "file", size: e.size ?? undefined, lastModified: e.modified ?? undefined,
  webUrl: e.webUrl ?? undefined, driveId: e.driveId, itemId: e.itemId,
});

async function browse(ctx: Ctx, args: any): Promise<ToolResult> {
  const folder = await openTarget(ctx, args);
  if (!folder.isFolder) return fail(`"${folder.name}" is a file, not a folder: read it with read_sharepoint_file.`);
  const items = sortEntries(await listChildren(ctx.token, folder.driveId, folder.itemId));
  const shown = items.slice(0, BROWSE_MAX);
  return { data: {
    success: true,
    folder: { name: folder.name, path: folder.path, webUrl: folder.webUrl, driveId: folder.driveId, itemId: folder.itemId },
    count: items.length,
    items: shown.map(itemLine),
    ...(items.length > shown.length ? { more: items.length - shown.length } : {}),
    message: `${items.length} item${items.length === 1 ? "" : "s"} in ${folder.path}${items.length > shown.length ? `; the first ${shown.length} are listed` : ""}.`,
  } };
}

async function read(ctx: Ctx, args: any): Promise<ToolResult> {
  if (!args.url && !args.driveId && !args.itemId) return fail("Give a SharePoint or OneDrive link, a path inside BGP - Share Drive, or the driveId and itemId from a browse result.");
  const entry = await openTarget(ctx, args);
  if (entry.isFolder) return fail(`"${entry.name}" is a folder: list it with browse_sharepoint_folder.`);
  const action = { type: "sharepoint_file", fileName: entry.name, webUrl: entry.webUrl };
  const ext = path.extname(entry.name).toLowerCase();
  if (!READABLE.includes(ext)) {
    return { data: { success: true, fileName: entry.name, webUrl: entry.webUrl, content: `${entry.name} is a ${ext || "file of unknown"} type that can't be read here. Open it in SharePoint: ${entry.webUrl}` }, action };
  }
  const { bytes } = await downloadFile(ctx.token, entry.driveId, entry.itemId);
  return { data: { success: true, fileName: entry.name, webUrl: entry.webUrl, path: entry.path, content: cut(await textOf(ctx.deps, bytes, entry.name)) }, action };
}

async function readChatFile(deps: FolderToolDeps, name: string): Promise<ToolResult> {
  const file = await deps.chatMedia(name, true);
  if (!file) return fail(`Chat file not found: ${name}. It may be from an earlier session that was not kept: ask for it to be uploaded again.`);
  const shownName = file.originalName || name.replace(/^\d+-(?:[a-f0-9]+-)?/, "");
  try {
    return { data: { success: true, fileName: shownName, content: cut(await textOf(deps, file.data, shownName)), webUrl: `/api/chat-media/${name}` } };
  } catch (e: any) {
    return fail(`${shownName} could not be read: ${e?.message || "its format isn't known"}`);
  }
}

async function create(ctx: Ctx, args: any): Promise<ToolResult> {
  const name = String(args.folderName ?? "").trim();
  const bad = itemNameProblem(name);
  if (bad) return fail(bad);
  const p = shareDrivePath(args.parentPath);
  if ("problem" in p) return fail(p.problem);
  const lib = await bgpLibrary(ctx.token);
  const parent = await folderAtPath(ctx.token, lib, [SHARE_DRIVE_NAME, ...p.parts]);
  let folder: DriveEntry;
  let existed = false;
  try {
    folder = await logged(ctx, { action: "create", driveId: parent.driveId, parentAfter: parent.itemId, nameAfter: name }, () => createFolder(ctx.token, parent.driveId, parent.itemId, name));
  } catch (e) {
    const there = e instanceof GraphError && e.status === 409 ? await entryByPath(ctx.token, lib.driveId, [SHARE_DRIVE_NAME, ...p.parts, name].join("/")) : null;
    if (!there?.isFolder) throw e;
    folder = there;
    existed = true;
  }
  const line = { success: true, name: folder.name, path: folder.path, webUrl: folder.webUrl };
  return {
    data: { ...line, driveId: folder.driveId, itemId: folder.itemId, existed, message: existed ? `${folder.path} was already there: nothing new was made.` : `Made ${folder.path}.` },
    action: { type: "sharepoint_folders", folders: [line] },
  };
}

async function move(ctx: Ctx, args: any): Promise<ToolResult> {
  const newName = String(args.newName ?? "").trim();
  const bad = newName ? itemNameProblem(newName) : null;
  if (bad) return fail(bad);
  const source = await openTarget(ctx, { url: args.sourcePath });
  const it = await itemForChange(ctx.token, source.driveId, source.itemId);
  const lib = await bgpLibrary(ctx.token);
  if (it.isRoot) return fail("That is the top of a library: it can't be moved.");
  if (it.entry.name === SHARE_DRIVE_NAME && it.entry.driveId === lib.driveId && it.parentId === lib.itemId) return fail(`${SHARE_DRIVE_NAME} itself can't be moved.`);
  const p = shareDrivePath(args.destinationFolderPath);
  if ("problem" in p) return fail(p.problem);
  const dest = await folderAtPath(ctx.token, lib, [SHARE_DRIVE_NAME, ...p.parts]);
  if (dest.driveId !== it.entry.driveId) return fail("A move stays in the same SharePoint library, and that file or folder is in another one (a OneDrive, say). Nothing was moved.");
  if (dest.itemId === it.entry.itemId) return fail("A folder can't go inside itself.");
  const moving = it.parentId !== dest.itemId;
  let item = it.entry;
  if (moving) {
    item = await logged(ctx, { action: "move", driveId: item.driveId, itemId: item.itemId, nameBefore: item.name, parentBefore: it.parentId, parentAfter: dest.itemId },
      () => moveItem(ctx.token, it.entry.driveId, it.entry.itemId, dest.itemId));
  }
  let renameError: string | null = null;
  if (newName && newName !== item.name) {
    const before = item;
    try {
      item = await logged(ctx, { action: "rename", driveId: before.driveId, itemId: before.itemId, nameBefore: before.name, nameAfter: newName, parentBefore: dest.itemId },
        () => renameItem(ctx.token, before.driveId, before.itemId, newName));
    } catch (e) {
      renameError = folderErrorWords(e);
    }
  }
  const line = { success: true, name: item.name, from: it.entry.path, to: dest.path, webUrl: item.webUrl };
  const said = `${moving ? `Moved ${it.entry.name} to ${dest.path}` : `${it.entry.name} was already in ${dest.path}`}${item.name !== it.entry.name ? `, now called ${item.name}` : ""}.`;
  return {
    data: { ...line, ...(renameError ? { renameError } : {}), message: renameError ? `${said} It could not be renamed: ${renameError}` : said },
    action: { type: "sharepoint_move", results: [line] },
  };
}

async function upload(ctx: Ctx, args: any): Promise<ToolResult> {
  const media = chatMediaName(args.chatMediaFilename);
  if (!media) return fail("Give the file's chat-media name (from its /api/chat-media/ address). For an email attachment use download_email_attachment with action 'save_to_sharepoint'.");
  const file = await ctx.deps.chatMedia(media, false);
  if (!file) {
    return fail(/^\d+-[a-f0-9]+-/.test(media)
      ? `File not found in chat-media: ${media}. It may have expired: make the file again and try once more.`
      : `File not found in chat-media: ${media}. That doesn't look like a file from this chat. If it is an email attachment, use download_email_attachment with action 'save_to_sharepoint' and the folderPath instead.`);
  }
  const name = String(args.fileName ?? "").trim() || file.originalName || media.replace(/^\d+-[a-f0-9]+-/, "");
  const folder = await folderForSaving(ctx, args.destinationFolderPath, { from: "chat" });
  const saved = await saveFileInto(ctx.token, folder, name, new Uint8Array(file.data), logOf(ctx, { from: "chat" }));
  return {
    data: {
      success: true, fileName: saved.name, webUrl: saved.webUrl, size: saved.size, folder: folder.path,
      message: `Put ${saved.name} in ${folder.path}${saved.name !== name ? ` (a file called ${name} was already there, so this one has a number added)` : ""}.`,
    },
    action: { type: "sharepoint_file", fileName: saved.name, webUrl: saved.webUrl },
  };
}

async function copyFromDropbox(ctx: Ctx, args: any): Promise<ToolResult> {
  const files = (Array.isArray(args.files) ? args.files : []).filter((f: any) => f && typeof f.dropboxPath === "string" && f.dropboxPath.trim());
  if (!files.length) return fail("Which Dropbox files? Give each one's dropboxPath.");
  const folder = await folderForSaving(ctx, args.destinationFolderPath, { from: "dropbox" });
  const uploaded: { fileName: string; size: number | null; webUrl: string | null }[] = [];
  const failures: { dropboxPath: string; error: string }[] = [];
  for (const f of files) {
    const dropboxPath = String(f.dropboxPath).trim();
    try {
      const bytes = await ctx.deps.dropbox(dropboxPath);
      const name = String(f.renameTo ?? "").trim() || dropboxPath.split("/").pop() || "file";
      const saved = await saveFileInto(ctx.token, folder, name, new Uint8Array(bytes), logOf(ctx, { from: "dropbox", dropboxPath }));
      uploaded.push({ fileName: saved.name, size: saved.size, webUrl: saved.webUrl });
    } catch (e: any) {
      // SharePoint's refusals in plain words; Dropbox's own words as they came.
      const sharePoints = e instanceof GraphError || (e?.status >= 400 && e?.status < 500);
      failures.push({ dropboxPath, error: sharePoints ? folderErrorWords(e) : String(e?.message || "the copy failed") });
    }
  }
  return { data: {
    success: uploaded.length > 0,
    uploaded: uploaded.length,
    failed: failures.length,
    folder: folder.path,
    files: uploaded,
    ...(failures.length ? { failures } : {}),
    message: `Copied ${uploaded.length} of ${files.length} file${files.length === 1 ? "" : "s"} from Dropbox to ${folder.path}.${failures.length ? ` ${failures.length} failed.` : ""}`,
  } };
}

const folderLine = (f: FolderLinkView) => ({
  label: f.label, folder: f.name ?? undefined, path: f.path ?? undefined, webUrl: f.webUrl ?? undefined, driveId: f.driveId ?? undefined, itemId: f.itemId ?? undefined,
  ...(f.status !== "ok" ? { status: f.status === "missing" ? "not in SharePoint any more" : f.status === "no_access" ? "no access" : "not checked" } : {}),
  ...(f.legacy ? { oldLink: true } : { linkId: f.id }),
});

async function recordFolders(deps: FolderToolDeps, args: any, staff: FolderStaff, token: string | null): Promise<ToolResult> {
  const type = recordTypeOf(args.recordType);
  if (!type) return fail(RECORD_REFUSAL);
  const record = await folderRecord(deps.db, type, String(args.recordId ?? "").trim());
  if (!record) return fail(`That ${RECORD_WORDS[type]} isn't in the CRM: find its id with search_crm.`);
  const view = await readRecordFolders(deps.db, record, { userId: staff.userId, token });
  const inherited = view.inherited.map(g => ({ from: `${RECORD_WORDS[g.from.type] || g.from.type} ${g.from.name}`, folders: g.folders.map(folderLine) }));
  const count = view.folders.length;
  return { data: {
    success: true,
    record: { type: RECORD_WORDS[type], id: record.id, name: record.name },
    folders: view.folders.map(folderLine),
    ...(inherited.length ? { fromProperty: inherited } : {}),
    message: count
      ? `${count} folder${count === 1 ? "" : "s"} on ${record.name}.`
      : `No folders are linked to ${record.name} yet${inherited.length ? " (its property has some)" : ""}: link one with link_record_folder, or under Folders on its page.`,
  } };
}

async function linkFolder(ctx: Ctx, args: any): Promise<ToolResult> {
  const type = recordTypeOf(args.recordType);
  if (!type) return fail(RECORD_REFUSAL);
  const record = await folderRecord(ctx.deps.db, type, String(args.recordId ?? "").trim());
  if (!record) return fail(`That ${RECORD_WORDS[type]} isn't in the CRM: find its id with search_crm.`);
  let input: { driveId?: string; itemId?: string; url?: string };
  if (args.driveId || args.itemId) {
    if (!isGraphId(args.driveId) || !isGraphId(args.itemId)) return fail("Give both driveId and itemId, from a browse_sharepoint_folder result.");
    input = { driveId: args.driveId, itemId: args.itemId };
  } else if (typeof args.url === "string" && /^https?:\/\//i.test(args.url.trim())) {
    input = { url: args.url.trim() };
  } else if (typeof args.folderPath === "string" && args.folderPath.trim()) {
    const folder = await openTarget(ctx, { url: args.folderPath });
    input = { driveId: folder.driveId, itemId: folder.itemId };
  } else {
    return fail("Which folder? Give its path inside BGP - Share Drive, its SharePoint link, or its driveId and itemId from a browse result.");
  }
  const link = await addFolderLink(ctx.deps.db, record, { ...ctx.actor, token: ctx.token }, { ...input, label: args.label });
  return {
    data: {
      success: true,
      linkId: link.id, label: link.label, folder: link.name, path: link.path, webUrl: link.webUrl,
      record: { type: RECORD_WORDS[type], id: record.id, name: record.name },
      message: `Linked ${link.path || link.name} to the ${RECORD_WORDS[type]} ${record.name}${link.label !== link.name ? `, labelled "${link.label}"` : ""}. It shows under Folders on its page; nothing in SharePoint was moved or changed.`,
    },
    action: { type: "crm_updated", entityType: type, id: record.id },
  };
}

/** The person asking, signed in as themselves; with `ms`, their own Microsoft 365. */
async function personFor(req: Request, deps: FolderToolDeps, wantToken: boolean): Promise<{ staff: FolderStaff; ms: { token: string; account: string } | null } | { refuse: string }> {
  let staff: FolderStaff | null;
  try { staff = await deps.staff(req); } catch { return { refuse: "Your account could not be checked just now. Nothing was changed." }; }
  if (!staff) return { refuse: STAFF_ONLY };
  return { staff, ms: wantToken ? await deps.microsoft(staff.userId).catch(() => null) : null };
}

/** One of ChatBGP's folder tools, for the person asking. */
export async function runFolderTool(tool: FolderTool, rawArgs: unknown, req: Request, given?: FolderToolDeps, via = "chatbgp"): Promise<ToolResult> {
  const deps = given || await appDeps();
  const args: any = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const automated = deps.internal(req);
  if (automated && tool !== "get_record_folders") return fail(AUTOMATED_REFUSAL);
  const chatFile = tool === "read_sharepoint_file" && typeof args.url === "string" && args.url.includes("/api/chat-media/");
  try {
    // An automated run reads a record's folders as the app last saw them, with no Microsoft call; a chat file needs none either.
    const who = await personFor(req, deps, !automated && !chatFile);
    if ("refuse" in who) return fail(who.refuse);
    if (chatFile) {
      const media = chatMediaName(args.url);
      return media ? await readChatFile(deps, media) : fail("That isn't a file from this chat.");
    }
    if (tool === "get_record_folders") return await recordFolders(deps, args, who.staff, who.ms?.token ?? null);
    if (!who.ms) return fail(CONNECT_FIRST, { connect: true });
    const ctx: Ctx = { deps, staff: who.staff, token: who.ms.token, actor: { userId: who.staff.userId, account: who.ms.account }, via };
    switch (tool) {
      case "browse_sharepoint_folder": return await browse(ctx, args);
      case "read_sharepoint_file": return await read(ctx, args);
      case "create_sharepoint_folder": return await create(ctx, args);
      case "move_sharepoint_item": return await move(ctx, args);
      case "upload_to_sharepoint": return await upload(ctx, args);
      case "copy_dropbox_to_sharepoint": return await copyFromDropbox(ctx, args);
      case "link_record_folder": return await linkFolder(ctx, args);
    }
    return fail("That folder tool isn't known.");
  } catch (e: any) {
    const words = folderErrorWords(e);
    if (words === GENERIC_FAULT) console.error(`[chatbgp-folder-tools] ${tool}:`, e?.message || e);
    return fail(FOLDER_READ_TOOLS.includes(tool) ? words : `${words.replace(/\.$/, "")}. Nothing more was changed.`);
  }
}

/** The person asking, ready to act on their own Microsoft 365; or the words for why not. */
async function contextFor(req: Request, deps: FolderToolDeps, via: string): Promise<{ ctx: Ctx } | { error: string }> {
  if (deps.internal(req)) return { error: AUTOMATED_REFUSAL };
  const who = await personFor(req, deps, true);
  if ("refuse" in who) return { error: who.refuse };
  if (!who.ms) return { error: CONNECT_FIRST };
  return { ctx: { deps, staff: who.staff, token: who.ms.token, actor: { userId: who.staff.userId, account: who.ms.account }, via } };
}

/**
 * download_email_attachment's save (and Model Studio's template upload): a
 * file into a folder in BGP - Share Drive, as the person asking, on their own
 * Microsoft 365, logged.
 */
export async function saveToShareDrive(
  req: Request, input: { folderPath: unknown; name: string; bytes: Uint8Array; from: string }, given?: FolderToolDeps, via = "chatbgp",
): Promise<{ success: true; fileName: string; path: string; webUrl: string | null; message: string } | { success: false; error: string }> {
  const deps = given || await appDeps();
  try {
    const got = await contextFor(req, deps, via);
    if ("error" in got) return { success: false, error: got.error };
    const folder = await folderForSaving(got.ctx, input.folderPath, { from: input.from });
    const saved = await saveFileInto(got.ctx.token, folder, input.name, input.bytes, logOf(got.ctx, { from: input.from }));
    return {
      success: true, fileName: saved.name, path: folder.path, webUrl: saved.webUrl,
      message: `Saved ${saved.name} to ${folder.path}${saved.name !== input.name ? ` (a file called ${input.name} was already there, so this one has a number added)` : ""}.`,
    };
  } catch (e: any) {
    const words = folderErrorWords(e);
    if (words === GENERIC_FAULT) console.error("[chatbgp-folder-tools] save:", e?.message || e);
    return { success: false, error: `${words.replace(/\.$/, "")}. Nothing was saved.` };
  }
}

/** A file's content for the person asking, by a link, a path inside BGP - Share Drive, or its ids: Model Studio reads workbooks with it. */
export async function readFileFor(
  req: Request, given: { url?: unknown; driveId?: unknown; itemId?: unknown }, deps0?: FolderToolDeps,
): Promise<{ entry: DriveEntry; bytes: Uint8Array } | { error: string }> {
  const deps = deps0 || await appDeps();
  try {
    const got = await contextFor(req, deps, "read");
    if ("error" in got) return { error: got.error };
    const entry = await openTarget(got.ctx, given);
    if (entry.isFolder) return { error: `"${entry.name}" is a folder, not a file.` };
    return await downloadFile(got.ctx.token, entry.driveId, entry.itemId);
  } catch (e: any) {
    const words = folderErrorWords(e);
    if (words === GENERIC_FAULT) console.error("[chatbgp-folder-tools] read:", e?.message || e);
    return { error: words };
  }
}

const WHO = "Runs as the person asking, on their own Microsoft 365 (if they have not connected it, they are told to, on the SharePoint page).";

/** The tool definitions, for BGP staff only: every one is on CLIENT_BLOCKED_TOOLS. */
export const FOLDER_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "browse_sharepoint_folder",
      description: `List what is in a folder in BGP's SharePoint or a OneDrive: its files and folders, folders first, each with its driveId and itemId. Use it whenever the user shares a SharePoint or OneDrive folder link or asks what is in a folder. Give the link, a path inside BGP - Share Drive, the team's SharePoint tree (for example 'Investment/Deal Files'; '' or '/' is the top of BGP - Share Drive), or the driveId and itemId of a folder from an earlier result, which is the surest way into a subfolder. ${WHO}`,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "A SharePoint or OneDrive folder link, or a path inside BGP - Share Drive such as 'Investment/Deal Files'. Leave out when giving driveId and itemId." },
          driveId: { type: "string", description: "The driveId of a folder from an earlier result, with itemId." },
          itemId: { type: "string", description: "The itemId of a folder from an earlier result, with driveId." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_sharepoint_file",
      description: `Read the text of a file in BGP's SharePoint or a OneDrive: Excel, Word, PowerPoint, PDF, CSV and text files (a file over 50 MB is opened in SharePoint instead). Use it whenever the user shares a SharePoint or OneDrive link to a file or asks you to open one. Give the link, a path inside BGP - Share Drive (for example 'Investment/Deal Files/report.xlsx'), or the driveId and itemId from a browse_sharepoint_folder result. A file dropped in this chat can be given as its /api/chat-media/ address. ${WHO}`,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "A SharePoint or OneDrive file link, a path inside BGP - Share Drive such as 'Investment/Deal Files/report.xlsx', or a file's /api/chat-media/ address. Leave out when giving driveId and itemId." },
          driveId: { type: "string", description: "The driveId from a browse_sharepoint_folder result, with itemId." },
          itemId: { type: "string", description: "The itemId from a browse_sharepoint_folder result, with driveId." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_sharepoint_folder",
      description: `Make a folder in BGP - Share Drive, the team's SharePoint tree (never the old "BGP share drive"). parentPath is the folder to make it in, as a path inside BGP - Share Drive (for example 'Investment' or 'Investment/10 Eaton Place'); '' or '/' makes it at the top of BGP - Share Drive, which only the user should ask for. The parent must already be there: call again for each level of a nested set. A folder of that name already there is used, never replaced. To show the new folder on a property, transaction or company, link it with link_record_folder. ${WHO} Logged.`,
      parameters: {
        type: "object",
        properties: {
          folderName: { type: "string", description: "The new folder's name" },
          parentPath: { type: "string", description: "The folder to make it in, as a path inside BGP - Share Drive, such as 'Investment/10 Eaton Place'" },
        },
        required: ["folderName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_sharepoint_item",
      description: `Move a file or folder into another folder of the same SharePoint library, and rename it if asked. A name already in the destination is refused, never replaced, and the top of a library and BGP - Share Drive itself are never moved. ${WHO} Logged.`,
      parameters: {
        type: "object",
        properties: {
          sourcePath: { type: "string", description: "The file or folder, as a path inside BGP - Share Drive such as 'Investment/Old Folder/report.xlsx', or its SharePoint link" },
          destinationFolderPath: { type: "string", description: "The folder to move it into, as a path inside BGP - Share Drive such as 'Investment/New Folder'; '/' is the top of BGP - Share Drive" },
          newName: { type: "string", description: "Optional: a new name for it" },
        },
        required: ["sourcePath", "destinationFolderPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upload_to_sharepoint",
      description: `Put a file that is ALREADY IN THIS CHAT (one the user dropped in, or one another tool made: export_to_excel, generate_word, generate_claude_designed_pdf and the like) into a folder in BGP - Share Drive. chatMediaFilename is the name from its /api/chat-media/ address (for example '1774348793476-f3ddbf080ba7fd73-Travelodge_Comps.xlsx'), not an email attachment's name. Missing folders below a top-level folder of BGP - Share Drive are made; a new top-level folder is not. A file of the same name already there is kept and this one gets a number. DO NOT USE for an email attachment: use download_email_attachment with action 'save_to_sharepoint'. ${WHO} Logged.`,
      parameters: {
        type: "object",
        properties: {
          chatMediaFilename: { type: "string", description: "The file's name from its /api/chat-media/ address" },
          destinationFolderPath: { type: "string", description: "The folder to put it in, as a path inside BGP - Share Drive, such as 'Investment/Deal Files'" },
          fileName: { type: "string", description: "Optional: the name to give it in SharePoint (its own name when left out)" },
        },
        required: ["chatMediaFilename", "destinationFolderPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_dropbox_to_sharepoint",
      description: `Copy files from Dropbox into a folder in BGP - Share Drive, as the files themselves (not just their text). Use when the user asks to pull Dropbox files into a SharePoint folder. Missing folders below a top-level folder of BGP - Share Drive are made. A file of the same name already there is kept and the new one gets a number. If a file fails, say exactly what came back. ${WHO} Logged.`,
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "array",
            description: "The Dropbox files to copy.",
            items: {
              type: "object",
              properties: {
                dropboxPath: { type: "string", description: "The Dropbox path, such as '/Brixton/Target Tenants/Prospectus/Brixton Master Plan.pdf'" },
                renameTo: { type: "string", description: "Optional: the name to give it in SharePoint" },
              },
              required: ["dropboxPath"],
            },
          },
          destinationFolderPath: { type: "string", description: "The folder to put them in, as a path inside BGP - Share Drive, such as 'Investment/Islington Square/Placemaking References'" },
        },
        required: ["files", "destinationFolderPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_record_folders",
      description: "The SharePoint and OneDrive folders linked to a property, a transaction or a company: what its page shows under Folders. A transaction also lists its property's folders. Each comes with its path, link, driveId and itemId, so it can be listed with browse_sharepoint_folder; an old link not yet moved over shows as an old link. Use the record's id from search_crm.",
      parameters: {
        type: "object",
        properties: {
          recordType: { type: "string", enum: ["property", "transaction", "company"], description: "Which kind of record" },
          recordId: { type: "string", description: "The record's id, from search_crm" },
        },
        required: ["recordType", "recordId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_record_folder",
      description: `Link a folder to a property, a transaction or a company, so it shows under Folders on its page (a transaction's page also shows its property's folders). Give the folder as a path inside BGP - Share Drive (for example 'Investment/10 Eaton Place'), a SharePoint or OneDrive link, or the driveId and itemId from a browse result. Linking never moves, renames or copies anything in SharePoint. The top of a library and the whole of BGP - Share Drive are never linked: link the folder inside it. Only when the user asks for it. ${WHO} Logged.`,
      parameters: {
        type: "object",
        properties: {
          recordType: { type: "string", enum: ["property", "transaction", "company"], description: "Which kind of record" },
          recordId: { type: "string", description: "The record's id, from search_crm" },
          folderPath: { type: "string", description: "The folder, as a path inside BGP - Share Drive" },
          url: { type: "string", description: "Or the folder's SharePoint or OneDrive link" },
          driveId: { type: "string", description: "Or the folder's driveId from a browse result, with itemId" },
          itemId: { type: "string", description: "Or the folder's itemId from a browse result, with driveId" },
          label: { type: "string", description: "Optional: the name shown on its chip (the folder's own name when left out)" },
        },
        required: ["recordType", "recordId"],
      },
    },
  },
];
