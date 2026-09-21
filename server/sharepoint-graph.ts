// SharePoint Graph helpers (extracted from server/microsoft.ts for Delivery
// 5) — the BGP site/drive constants, drive resolution, folder creation and
// bounded-parallel tree creation. Previously closures inside
// setupMicrosoftRoutes; the durable client-folder jobs and the folder
// inventory need them outside the route registrar. Behaviour is unchanged.
//
// Everything here runs on the CALLER's delegated token — a durable job that
// resumes after restart takes a fresh token per resume call; tokens are
// never persisted.

export const SHAREPOINT_HOST = "brucegillinghampollardlimited.sharepoint.com";
export const SHAREPOINT_SITE_PATH = "/sites/BGP";
export const SHAREPOINT_ROOT_FOLDER = "BGP share drive";

export async function getSharePointDriveId(token: string): Promise<{ driveId: string; siteId: string } | null> {
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
  const siteRes = await fetch(siteUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!siteRes.ok) return null;
  const site = await siteRes.json();

  const drivesUrl = `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`;
  const drivesRes = await fetch(drivesUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!drivesRes.ok) return null;
  const drivesData = await drivesRes.json();
  const docsDrive = drivesData.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || drivesData.value?.[0];
  if (!docsDrive) return null;
  return { driveId: docsDrive.id, siteId: site.id };
}

export async function createFolderByPath(token: string, driveId: string, parentPath: string, folderName: string): Promise<{ success: boolean; name: string; error?: string }> {
  let createUrl: string;
  if (!parentPath || parentPath === "/") {
    createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
  } else {
    const cleanPath = parentPath.replace(/^\/+|\/+$/g, "");
    createUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}:/children`;
  }

  // SharePoint throttles bursts (429) — honour Retry-After a couple of
  // times before reporting failure, since folder setup now runs batches
  // of creates concurrently.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });

    if (response.ok || response.status === 409) {
      return { success: true, name: folderName };
    }
    if (response.status === 429 && attempt < 2) {
      const wait = Math.min(10, Number(response.headers.get("Retry-After")) || 2);
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }
    const errText = await response.text();
    return { success: false, name: folderName, error: `${response.status}: ${errText.slice(0, 100)}` };
  }
}

// Run async work over a list with bounded concurrency. Folder setup used
// to create every folder one Graph call at a time — a bulk client run
// (properties × ~20 folders each) took minutes and timed out the request.
export async function runChunked<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

// Create a folder tree under rootPath: parents must exist before children,
// so group the subpaths by depth and create each depth level in parallel.
export async function createTreeBatched(
  token: string,
  driveId: string,
  rootPath: string,
  subPaths: string[],
): Promise<{ path: string; success: boolean; error?: string }[]> {
  const byDepth = new Map<number, string[]>();
  for (const p of subPaths) {
    const d = p.split("/").length;
    byDepth.set(d, [...(byDepth.get(d) || []), p]);
  }
  const results: { path: string; success: boolean; error?: string }[] = [];
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const level = await runChunked(byDepth.get(depth)!, 5, async (subPath) => {
      const parts = subPath.split("/");
      const folderName = parts[parts.length - 1];
      const parentParts = parts.slice(0, -1);
      const parentPath = parentParts.length > 0 ? `${rootPath}/${parentParts.join("/")}` : rootPath;
      const r = await createFolderByPath(token, driveId, parentPath, folderName);
      return { path: `${rootPath}/${subPath}`, success: r.success, error: r.error };
    });
    results.push(...level);
  }
  return results;
}

// The Graph /shares/ id for a stored SharePoint webUrl — same encoding the
// client jail uses to resolve crm_companies.sharepoint_folder_url.
export function sharesId(url: string): string {
  const b64 = Buffer.from(url, "utf8").toString("base64")
    .replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `u!${b64}`;
}

export interface SharePointItemRef {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string | null;
  // Full lowercase path from the drive root, e.g. "/drives/b!x/root:/bgp share drive/landsec"
  fullPath: string;
}

export function itemFullPath(item: any): string {
  const parent = item?.parentReference?.path || "";
  return `${parent}/${item?.name || ""}`.toLowerCase();
}

// Resolve a stored SharePoint folder URL to its drive/item identity. Shared
// by the client jail (server/client-sharepoint.ts) and the folder
// inventory's root resolution. `graphGet` is injected so tests never fetch.
export async function resolveFolderUrlRef(
  url: string,
  graphGet: (path: string) => Promise<any>,
): Promise<SharePointItemRef | null> {
  const item = await graphGet(`/shares/${sharesId(url)}/driveItem?$select=id,name,webUrl,parentReference,folder`);
  if (!item?.id || !item?.parentReference?.driveId) return null;
  return {
    driveId: item.parentReference.driveId,
    itemId: item.id,
    name: item.name,
    webUrl: item.webUrl ?? null,
    fullPath: itemFullPath(item),
  };
}

// Legacy path probe: resolve `BGP share drive/{name}` (or any path under the
// drive root) to its item identity. Returns null when the path doesn't exist.
export async function resolveItemByPath(
  token: string,
  driveId: string,
  path: string,
): Promise<SharePointItemRef | null> {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const encoded = clean.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const item = await res.json();
  if (!item?.id) return null;
  return {
    driveId,
    itemId: item.id,
    name: item.name,
    webUrl: item.webUrl ?? null,
    fullPath: itemFullPath(item),
  };
}
