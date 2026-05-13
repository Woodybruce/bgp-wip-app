/**
 * Resolve a SharePoint / OneDrive share link to file bytes.
 *
 * Microsoft Graph supports an "encoded share URL" lookup at
 *   GET /shares/{shareIdOrEncodedUrl}/driveItem
 * where the encoded URL is base64url("u!" prefix). This works for any
 * SharePoint share link including the "anyone with the link" tenant ones
 * that the BGP team paste from SharePoint.
 *
 * Used by the universal-ingest engine: paste a share link in the import
 * dialog (or send via the ingest_anything ChatBGP tool) and we fetch the
 * file silently before parsing.
 */
import { graphRequest } from "./shared-mailbox";

function encodeShareUrl(shareUrl: string): string {
  const base64 = Buffer.from(shareUrl, "utf-8").toString("base64");
  const urlSafe = base64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `u!${urlSafe}`;
}

export interface ResolvedShareLink {
  filename: string;
  bytes: Buffer;
  isFolder: boolean;
  /** Children for folder links — caller can ingest each item separately. */
  folderChildren?: { filename: string; downloadUrl: string }[];
}

export async function resolveSharePointShareLink(shareUrl: string): Promise<ResolvedShareLink> {
  const encoded = encodeShareUrl(shareUrl);
  const driveItem: any = await graphRequest(`/shares/${encoded}/driveItem`);

  if (driveItem.folder) {
    // Folder — return list of children. Caller decides whether to recurse.
    const children: any = await graphRequest(`/shares/${encoded}/driveItem/children?$select=name,@microsoft.graph.downloadUrl,folder`);
    return {
      filename: driveItem.name,
      bytes: Buffer.alloc(0),
      isFolder: true,
      folderChildren: (children?.value || [])
        .filter((c: any) => !c.folder && c["@microsoft.graph.downloadUrl"])
        .map((c: any) => ({ filename: c.name, downloadUrl: c["@microsoft.graph.downloadUrl"] })),
    };
  }

  const downloadUrl = driveItem["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) throw new Error("Share link resolved but no download URL");
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const ab = await res.arrayBuffer();
  return { filename: driveItem.name, bytes: Buffer.from(ab), isFolder: false };
}

export async function downloadFolderChild(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Resolve a share link to the underlying driveItem metadata + (if a
 * file) a fresh @microsoft.graph.downloadUrl. Returns no bytes. Used
 * when the caller wants to stream the file to disk rather than buffer
 * the whole thing in memory — essential for files like HMLR's CCOD
 * (1.5 GB CSV) which would exhaust Node's heap if buffered.
 */
export async function resolveSharePointShareLinkMetadata(shareUrl: string): Promise<{
  isFolder: boolean;
  name: string;
  size?: number;
  downloadUrl?: string;
  children?: { filename: string; downloadUrl: string; size: number }[];
  /** Raw children count + first few filenames — populated even when
   *  the filtered children[] is empty, so callers can diagnose why
   *  nothing matched (permissions, sub-folders, etc.). */
  rawChildSummary?: { total: number; sample: string[] };
}> {
  const encoded = encodeShareUrl(shareUrl);
  const driveItem: any = await graphRequest(`/shares/${encoded}/driveItem`);
  if (driveItem.folder) {
    // No $select — Microsoft Graph treats @microsoft.graph.downloadUrl
    // as an instance annotation that gets stripped if you $select
    // explicit fields. The default response already includes it for
    // file children. Page through all children (folders > 200 items
    // would need this) — for HMLR's case it's only 2 files but cheap
    // to keep robust.
    let all: any[] = [];
    let next: string | null = `/shares/${encoded}/driveItem/children`;
    let hops = 0;
    while (next && hops < 50) {
      const page: any = await graphRequest(next);
      all = all.concat(page?.value || []);
      next = page?.["@odata.nextLink"] ? page["@odata.nextLink"].replace("https://graph.microsoft.com/v1.0", "") : null;
      hops++;
    }
    const childFiles = all.filter((c: any) => !c.folder && c["@microsoft.graph.downloadUrl"]);
    return {
      isFolder: true,
      name: driveItem.name,
      rawChildSummary: { total: all.length, sample: all.slice(0, 10).map((c) => `${c.name}${c.folder ? "/" : ""}`) },
      children: childFiles.map((c: any) => ({
        filename: c.name,
        downloadUrl: c["@microsoft.graph.downloadUrl"],
        size: c.size || 0,
      })),
    };
  }
  return {
    isFolder: false,
    name: driveItem.name,
    size: driveItem.size,
    downloadUrl: driveItem["@microsoft.graph.downloadUrl"],
  };
}

/**
 * Stream a download URL directly to disk so very large files don't
 * buffer in memory. Returns the local path.
 */
export async function streamUrlToFile(url: string, destPath: string): Promise<void> {
  const fs = await import("fs");
  const { pipeline } = await import("stream/promises");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Stream download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("Stream download had no response body");
  const out = fs.createWriteStream(destPath);
  await pipeline(res.body as any, out);
}
