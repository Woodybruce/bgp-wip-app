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
