/**
 * microsoft-graph-pagination.ts — Graph drive-item listing pagination and
 * upload-destination resolution.
 *
 * Two SharePoint bugs this module fixes:
 *  (A) Drive-item children listings followed only the first Graph page —
 *      `@odata.nextLink` was ignored, so folders with more than one page of
 *      items silently truncated. `listAllChildren` follows nextLink until
 *      exhausted, bounded by a page cap with a warn-log.
 *  (B) The linked-folder upload path could fall back to the SharePoint root
 *      when a folder WAS selected but its drive/item IDs were missing.
 *      `resolveUploadDestination` makes that an explicit 4xx instead.
 *
 * Run tests with: node --import tsx --test server/microsoft-graph-pagination.test.ts
 */

// Bound pathological loops (a buggy or malicious nextLink cycle) — 50 pages
// at $top=100-200 is 5k-10k items, far beyond any real folder here.
export const GRAPH_LIST_PAGE_CAP = 50;

export interface GraphChildrenPage {
  value?: any[];
  "@odata.nextLink"?: string | null;
}

/**
 * Accumulate every page of a Graph collection listing, following
 * `@odata.nextLink` until it is absent. `fetchPage` receives the request URL
 * (the first-page URL, then each absolute nextLink) and must return the
 * parsed page or throw. Returns the concatenated `value` arrays; item shape
 * is untouched.
 */
export async function listAllChildren(
  fetchPage: (url: string) => Promise<GraphChildrenPage>,
  firstPageUrl: string,
  maxPages: number = GRAPH_LIST_PAGE_CAP,
): Promise<any[]> {
  const items: any[] = [];
  let url: string | null = firstPageUrl;
  let pages = 0;
  while (url) {
    const page = await fetchPage(url);
    pages++;
    items.push(...(page?.value || []));
    url = page?.["@odata.nextLink"] || null;
    if (url && pages >= maxPages) {
      console.warn(`[Graph pagination] page cap (${maxPages}) hit listing ${firstPageUrl.slice(0, 120)} — returning ${items.length} items, more may exist`);
      break;
    }
  }
  return items;
}

export interface UploadDestinationInput {
  driveId?: string | null;
  folderId?: string | null;
  folderPath?: string | null;
}

export type UploadDestination =
  // A specific folder was selected and both IDs are present — upload into it.
  | { kind: "folder"; driveId: string; folderId: string }
  // Path-based targeting (team/property path synthesis).
  | { kind: "path"; driveId?: string; folderPath: string }
  // A drive with no folder — the drive root (existing behaviour).
  | { kind: "drive-root"; driveId: string }
  // Nothing selected at all — the existing default (BGP share drive root).
  | { kind: "default" }
  // A folder WAS selected but its IDs are incomplete — refuse rather than
  // silently landing the file at the SharePoint root.
  | { kind: "error"; status: number; message: string };

/**
 * Decide where an upload goes. Pure — the route turns the result into a
 * Graph URL. The contract: an explicit folder selection with missing IDs is
 * a client error (4xx), never a silent root fallback; no selection at all
 * keeps the existing default.
 */
export function resolveUploadDestination(input: UploadDestinationInput): UploadDestination {
  const driveId = (input.driveId || "").trim();
  const folderId = (input.folderId || "").trim();
  const folderPath = (input.folderPath || "").trim();

  if (folderId) {
    if (!driveId) {
      return {
        kind: "error",
        status: 400,
        message: "A folder is selected but its drive ID is missing — re-load the folder listing and try again. The file was NOT uploaded (refusing to fall back to the SharePoint root).",
      };
    }
    return { kind: "folder", driveId, folderId };
  }
  if (folderPath) {
    return { kind: "path", driveId: driveId || undefined, folderPath };
  }
  if (driveId) {
    return { kind: "drive-root", driveId };
  }
  return { kind: "default" };
}
