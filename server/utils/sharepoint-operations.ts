// What is left of the old SharePoint helpers, on the folder engine
// (docs/folders-review-2026-11-20.md, step 5). Pathway's Stage 1 looks for a
// run's folder here before one is linked; delete this file once that lookup
// moves to the run's linked folders.
import type { Request } from "express";
import { SHARE_DRIVE_NAME } from "@shared/folders";
import { bgpLibrary, entryByPath } from "../folders/graph";
import { libraryPath, ownMicrosoft } from "../folders/by-path";

/**
 * The folder at `<parentPath>/<folderName>` in BGP - Share Drive, else in the
 * old "BGP share drive" tree where Pathway made its folders before, looked up
 * as the person asking on their own Microsoft 365. Nothing is made. Null when
 * neither is there.
 */
export async function lookupSharePointFolderIfExists(
  args: { folderName: string; parentPath?: string },
  req: Request,
): Promise<{ name: string; path: string; webUrl: string; id: string } | null> {
  const own = await ownMicrosoft(req);
  if (!own) return null;
  try {
    const lib = await bgpLibrary(own.token);
    for (const top of [SHARE_DRIVE_NAME, "BGP share drive"]) {
      const p = libraryPath([top, args.parentPath || "", args.folderName].join("/"));
      if ("problem" in p) return null;
      const path = p.parts.join("/");
      const item = await entryByPath(own.token, lib.driveId, path);
      if (item?.isFolder) return { name: item.name, path, webUrl: item.webUrl || "", id: item.itemId };
    }
  } catch {
    return null;
  }
  return null;
}
