/**
 * Lease Advisory folder template applier — creates Tom + Pete's canonical
 * folder structure in SharePoint when a new PLA matter is opened.
 *
 *   BGP share drive/Lease Advisory/<property name>/
 *     ├── Lease Documents/  (Current Lease, Supplements, Licences)
 *     ├── Rent Review/      (Comparable Evidence, Valuation, Representations, Determination)
 *     ├── Lease Renewal/    (Section 25 Notice, Counter Notice, Heads of Terms)
 *     ├── Dilapidations/    (Schedule, Costings, Scott Schedule)
 *     ├── Service Charge/
 *     ├── Correspondence/
 *     └── Legal/
 *
 * The structure mirrors the TEAM_FOLDER_TREES["Lease Advisory"] entry in
 * server/microsoft.ts (Tom and Pete already use this template manually).
 *
 * Best-effort + idempotent — creating an existing folder is treated as
 * success (Graph returns 409 conflict). Failures are logged but never block
 * matter creation.
 */

import { getValidMsToken, SHAREPOINT_HOST, SHAREPOINT_SITE_PATH } from "./microsoft";
import { db } from "./db";
import { plaMatters } from "@shared/schema";
import { eq } from "drizzle-orm";

const SHAREPOINT_ROOT_FOLDER = "BGP share drive";
const LEASE_ADVISORY_TEAM = "Lease Advisory";

const LEASE_ADVISORY_TREE: string[] = [
  "Lease Documents",
  "Lease Documents/Current Lease",
  "Lease Documents/Supplements",
  "Lease Documents/Licences",
  "Rent Review",
  "Rent Review/Comparable Evidence",
  "Rent Review/Valuation",
  "Rent Review/Representations",
  "Rent Review/Determination",
  "Lease Renewal",
  "Lease Renewal/Section 25 Notice",
  "Lease Renewal/Counter Notice",
  "Lease Renewal/Heads of Terms",
  "Dilapidations",
  "Dilapidations/Schedule",
  "Dilapidations/Costings",
  "Dilapidations/Scott Schedule",
  "Service Charge",
  "Correspondence",
  "Legal",
];

async function getDriveId(token: string): Promise<{ driveId: string; siteId: string } | null> {
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}`;
  const siteRes = await fetch(siteUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!siteRes.ok) return null;
  const site = await siteRes.json();
  const drivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!drivesRes.ok) return null;
  const data = await drivesRes.json();
  const drive = data.value?.find((d: any) => d.name === "Documents" || d.name === "Shared Documents") || data.value?.[0];
  if (!drive) return null;
  return { driveId: drive.id, siteId: site.id };
}

async function createFolderByPath(
  token: string,
  driveId: string,
  parentPath: string,
  folderName: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleanPath = (parentPath || "").replace(/^\/+|\/+$/g, "");
  const url = cleanPath
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}:/children`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
  if (res.ok || res.status === 409) return { ok: true };
  const errText = await res.text().catch(() => "");
  return { ok: false, error: `${res.status}: ${errText.slice(0, 100)}` };
}

/**
 * Get the SharePoint web URL for a folder so the UI can link to it.
 */
async function getFolderWebUrl(token: string, driveId: string, folderPath: string): Promise<string | null> {
  const cleanPath = folderPath.replace(/^\/+|\/+$/g, "");
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const item = await res.json();
  return item.webUrl || null;
}

/**
 * Apply the canonical Lease Advisory folder template for a matter and
 * stamp the resulting SharePoint web URL on the matter row.
 *
 * Designed to run async / best-effort after matter creation — failures
 * are logged, never thrown back to the create endpoint.
 */
export async function applyLeaseAdvisoryFolderTemplate(
  matterId: string,
  propertyName: string,
  token: string,
): Promise<{ ok: boolean; folderUrl?: string; error?: string }> {
  try {
    if (!token) return { ok: false, error: "no Microsoft token" };
    if (!propertyName?.trim()) return { ok: false, error: "no property name" };

    const cleanName = propertyName.trim().replace(/[<>:"/\\|?*]+/g, "-").slice(0, 200);

    const drive = await getDriveId(token);
    if (!drive) return { ok: false, error: "could not resolve SharePoint drive" };

    const teamFolder = `${SHAREPOINT_ROOT_FOLDER}/${LEASE_ADVISORY_TEAM}`;
    const propertyRoot = `${teamFolder}/${cleanName}`;

    // 1. Create the property root (idempotent — 409 is fine).
    const rootRes = await createFolderByPath(token, drive.driveId, teamFolder, cleanName);
    if (!rootRes.ok) {
      console.warn(`[pla-folder-template] root create failed for "${cleanName}": ${rootRes.error}`);
      return { ok: false, error: rootRes.error };
    }

    // 2. Create every subfolder. We tolerate individual failures — the user
    // can re-run later or create missing ones manually.
    const failures: string[] = [];
    for (const subPath of LEASE_ADVISORY_TREE) {
      const parts = subPath.split("/");
      const folderName = parts[parts.length - 1];
      const parentSubPath = parts.slice(0, -1).join("/");
      const parentPath = parentSubPath ? `${propertyRoot}/${parentSubPath}` : propertyRoot;
      const r = await createFolderByPath(token, drive.driveId, parentPath, folderName);
      if (!r.ok) failures.push(`${subPath}: ${r.error}`);
    }
    if (failures.length > 0) {
      console.warn(`[pla-folder-template] ${failures.length}/${LEASE_ADVISORY_TREE.length} subfolders failed for "${cleanName}":`, failures.slice(0, 3));
    }

    // 3. Resolve the web URL for the root folder so the UI can link to it.
    const folderUrl = await getFolderWebUrl(token, drive.driveId, propertyRoot);

    // 4. Stamp the matter row.
    await db
      .update(plaMatters)
      .set({
        sharepointFolderUrl: folderUrl,
        folderTemplateApplied: true,
        updatedAt: new Date(),
      })
      .where(eq(plaMatters.id, matterId));

    console.log(`[pla-folder-template] applied for matter ${matterId} → ${folderUrl}`);
    return { ok: true, folderUrl: folderUrl || undefined };
  } catch (err: any) {
    console.error(`[pla-folder-template] error applying for matter ${matterId}:`, err);
    return { ok: false, error: err?.message || "apply failed" };
  }
}
