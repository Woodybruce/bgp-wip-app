import { getValidMsToken } from "../microsoft";
import { storage } from "../storage";
import { extractTextFromFile } from "./file-extractor";
import type { Request } from "express";

// SharePoint constants
export const BGP_KNOWLEDGE_FOLDERS = [
  {
    name: "BGP Business Context",
    url: "https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/woody_brucegillinghampollard_com/IgA5N1cspPKHTJ8tcCdA-cRUAXmCOETID8BfvH-bxBgLNRE?e=jmc26e",
  },
  {
    name: "BGP Shared Drive", 
    url: "https://brucegillinghampollardlimited.sharepoint.com/:f:/s/BGP/IgA_lPHJX3cQT6YBOeT3_Y5vAb-hiHkDENJFZylEDxpzbo8?e=PNilJl",
  },
];

/**
 * Resolve a OneDrive short link to its full URL
 */
export async function resolveOneDriveShortLink(url: string): Promise<string> {
  const resp = await fetch(url, { method: "HEAD", redirect: "manual" });
  return resp.headers.get("location") || url;
}

/**
 * Get SharePoint site drive ID
 */
export async function getSharePointDriveId(token: string): Promise<string | null> {
  try {
    const siteResp = await fetch(
      "https://graph.microsoft.com/v1.0/sites/brucegillinghampollardlimited.sharepoint.com:/sites/BGP",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!siteResp.ok) return null;
    const site = await siteResp.json();

    const driveResp = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${site.id}/drive`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (driveResp.ok) {
      const drive = await driveResp.json();
      return drive.id;
    }
  } catch (error) {
    console.error("[SharePoint] Error getting drive ID:", error);
  }
  return null;
}

/**
 * Create a SharePoint folder
 */
export async function executeCreateSharePointFolder(
  args: { folderName: string; parentPath?: string },
  req: Request
): Promise<any> {
  const token = await getValidMsToken(req);
  if (!token) throw new Error("Failed to authenticate with Microsoft");

  const driveId = await getSharePointDriveId(token);
  if (!driveId) throw new Error("Failed to access SharePoint site");

  let parentPath = args.parentPath || "";
  if (parentPath === "/" || !parentPath) parentPath = "";
  
  // Map team folder shortcuts
  const teamFolderMappings: Record<string, string> = {
    "Investment": "BGP share drive/Investment",
    "London": "BGP share drive/London Leasing",
    "London Leasing": "BGP share drive/London Leasing",
    "National": "BGP share drive/National Leasing",
    "National Leasing": "BGP share drive/National Leasing",
    "Development": "BGP share drive/Development & Re-purposing",
    "Tenant Rep": "BGP share drive/Tenant Rep",
    "Lease Advisory": "BGP share drive/Lease Advisory",
    "Office": "BGP share drive/Office - Corporate",
    "Corporate": "BGP share drive/Office - Corporate"
  };

  if (teamFolderMappings[parentPath]) {
    parentPath = teamFolderMappings[parentPath];
  } else if (parentPath && !parentPath.startsWith("BGP share drive")) {
    parentPath = `BGP share drive/${parentPath}`;
  }

  const fullPath = parentPath ? `${parentPath}/${args.folderName}` : args.folderName;
  const encodedParent = encodeURIComponent(parentPath);
  const encodedFullPath = encodeURIComponent(fullPath);

  // First: check if folder already exists at the exact path — if so, reuse it
  try {
    const lookup = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedFullPath}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (lookup.ok) {
      const existing = await lookup.json();
      if (existing?.folder) {
        return {
          success: true,
          folder: {
            name: existing.name,
            path: fullPath,
            webUrl: existing.webUrl,
            id: existing.id,
          },
          message: `Folder "${args.folderName}" already exists at: ${fullPath} — reusing`,
          existed: true,
        };
      }
    }
  } catch {
    // fall through to create
  }

  const createUrl = parentPath
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedParent}:/children`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
  const resp = await fetch(
    createUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: args.folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail"
      })
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create folder: ${text}`);
  }

  const result = await resp.json();
  return {
    success: true,
    folder: {
      name: result.name,
      path: fullPath,
      webUrl: result.webUrl,
      id: result.id
    },
    message: `Created folder "${args.folderName}" at: ${fullPath}`
  };
}

/**
 * Upload a file (Buffer) to SharePoint. Uses a direct PUT for files ≤4MB and
 * an upload session (chunked) for larger files. Returns the created drive item.
 */
export async function executeUploadFileToSharePoint(
  args: { folderPath: string; filename: string; content: Buffer; contentType?: string },
  req: Request
): Promise<{ success: boolean; file: { name: string; webUrl: string; id: string; path: string; sizeMB: number }; message: string }> {
  const token = await getValidMsToken(req);
  if (!token) throw new Error("Failed to authenticate with Microsoft");

  const driveId = await getSharePointDriveId(token);
  if (!driveId) throw new Error("Failed to access SharePoint site");

  // Apply the same team-folder prefix mapping as executeCreateSharePointFolder
  let folderPath = args.folderPath || "";
  const teamFolderMappings: Record<string, string> = {
    "Investment": "BGP share drive/Investment",
    "London": "BGP share drive/London Leasing",
    "London Leasing": "BGP share drive/London Leasing",
    "National": "BGP share drive/National Leasing",
    "National Leasing": "BGP share drive/National Leasing",
    "Development": "BGP share drive/Development & Re-purposing",
    "Tenant Rep": "BGP share drive/Tenant Rep",
    "Lease Advisory": "BGP share drive/Lease Advisory",
    "Office": "BGP share drive/Office - Corporate",
    "Corporate": "BGP share drive/Office - Corporate",
  };
  const firstSeg = folderPath.split("/")[0];
  if (teamFolderMappings[firstSeg]) {
    folderPath = teamFolderMappings[firstSeg] + folderPath.slice(firstSeg.length);
  } else if (folderPath && !folderPath.startsWith("BGP share drive")) {
    folderPath = `BGP share drive/${folderPath}`;
  }

  const filePath = `${folderPath}/${args.filename}`.replace(/\/{2,}/g, "/");
  const encodedFilePath = encodeURIComponent(filePath);

  const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB

  if (args.content.length <= SIMPLE_UPLOAD_LIMIT) {
    // Simple one-shot upload
    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedFilePath}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": args.contentType || "application/octet-stream",
        },
        body: args.content,
      }
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Upload failed (simple): ${resp.status} ${text.slice(0, 300)}`);
    }
    const result = await resp.json();
    return {
      success: true,
      file: {
        name: result.name,
        webUrl: result.webUrl,
        id: result.id,
        path: filePath,
        sizeMB: +(args.content.length / 1024 / 1024).toFixed(2),
      },
      message: `Uploaded ${args.filename} (${(args.content.length / 1024 / 1024).toFixed(1)}MB)`,
    };
  }

  // Chunked upload via upload session
  const sessionResp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedFilePath}:/createUploadSession`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "replace", name: args.filename },
      }),
    }
  );
  if (!sessionResp.ok) {
    const text = await sessionResp.text();
    throw new Error(`Failed to create upload session: ${sessionResp.status} ${text.slice(0, 300)}`);
  }
  const session = await sessionResp.json();
  const uploadUrl: string = session.uploadUrl;

  // Upload in 5 MB chunks (must be a multiple of 320 KiB per Graph docs)
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const total = args.content.length;
  let offset = 0;
  let finalItem: any = null;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total) - 1;
    const chunk = args.content.subarray(offset, end + 1);
    const chunkResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${end}/${total}`,
      },
      body: chunk,
    });
    if (chunkResp.status === 200 || chunkResp.status === 201) {
      finalItem = await chunkResp.json();
      break;
    }
    if (chunkResp.status !== 202) {
      const text = await chunkResp.text();
      // Best-effort abort of the session
      try { await fetch(uploadUrl, { method: "DELETE" }); } catch {}
      throw new Error(`Chunk upload failed at offset ${offset}: ${chunkResp.status} ${text.slice(0, 300)}`);
    }
    offset = end + 1;
  }

  if (!finalItem) {
    throw new Error("Upload session completed with no final item returned");
  }

  return {
    success: true,
    file: {
      name: finalItem.name,
      webUrl: finalItem.webUrl,
      id: finalItem.id,
      path: filePath,
      sizeMB: +(total / 1024 / 1024).toFixed(2),
    },
    message: `Uploaded ${args.filename} (${(total / 1024 / 1024).toFixed(1)}MB, chunked)`,
  };
}

/**
 * Move a SharePoint item
 */
export async function executeMoveSharePointItem(
  args: { sourcePath: string; destinationFolderPath: string; newName?: string },
  req: Request
): Promise<any> {
  const token = await getValidMsToken(req);
  if (!token) throw new Error("Failed to authenticate with Microsoft");

  const driveId = await getSharePointDriveId(token);
  if (!driveId) throw new Error("Failed to access SharePoint site");

  // Get source item
  const encodedSource = encodeURIComponent(args.sourcePath);
  const sourceResp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedSource}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!sourceResp.ok) {
    throw new Error(`Source item not found: ${args.sourcePath}`);
  }
  
  const sourceItem = await sourceResp.json();

  // Get destination folder
  let destPath = args.destinationFolderPath;
  if (!destPath || destPath === "/") {
    destPath = "BGP share drive";
  } else if (!destPath.startsWith("BGP share drive")) {
    destPath = `BGP share drive/${destPath}`;
  }

  const encodedDest = encodeURIComponent(destPath);
  const destResp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedDest}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!destResp.ok) {
    throw new Error(`Destination folder not found: ${destPath}`);
  }

  const destFolder = await destResp.json();

  // Prepare move operation
  const body: any = {
    parentReference: {
      driveId: driveId,
      id: destFolder.id
    }
  };

  if (args.newName) {
    body.name = args.newName;
  }

  // Execute move
  const moveResp = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${sourceItem.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!moveResp.ok) {
    const text = await moveResp.text();
    throw new Error(`Failed to move item: ${text}`);
  }

  const result = await moveResp.json();
  const newPath = `${destPath}/${result.name}`;

  return {
    success: true,
    item: {
      name: result.name,
      oldPath: args.sourcePath,
      newPath: newPath,
      webUrl: result.webUrl
    },
    message: `Moved "${sourceItem.name}" to: ${newPath}`
  };
}

/**
 * Browse SharePoint folder contents
 */
export async function browseSharePointFolder(
  url: string,
  token: string
): Promise<{ files: any[]; folders: any[]; totalSize: number }> {
  // Handle different URL formats
  let apiUrl: string;
  
  if (url.includes("sharepoint.com/:f:")) {
    // Sharing URL - extract folder info
    const match = url.match(/\/personal\/([^/]+)\/(.+)$/);
    if (match) {
      const userEmail = match[1].replace(/_/g, "@");
      const pathPart = match[2];
      apiUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/drive/root:/${pathPart}:/children`;
    } else if (url.includes("/sites/")) {
      const siteMatch = url.match(/\/sites\/([^/]+)/);
      if (siteMatch) {
        apiUrl = `https://graph.microsoft.com/v1.0/sites/brucegillinghampollardlimited.sharepoint.com:/sites/${siteMatch[1]}:/drive/root/children`;
      } else {
        throw new Error("Could not parse SharePoint URL");
      }
    } else {
      throw new Error("Unsupported SharePoint URL format");
    }
  } else if (url === "/" || !url) {
    // Root of BGP SharePoint
    const driveId = await getSharePointDriveId(token);
    if (!driveId) throw new Error("Failed to access SharePoint");
    apiUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
  } else {
    // Folder path
    const driveId = await getSharePointDriveId(token);
    if (!driveId) throw new Error("Failed to access SharePoint");
    const encoded = encodeURIComponent(url);
    apiUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/children`;
  }

  const resp = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    throw new Error(`Failed to browse folder: ${await resp.text()}`);
  }

  const data = await resp.json();
  
  const files: any[] = [];
  const folders: any[] = [];
  let totalSize = 0;

  for (const item of data.value || []) {
    const entry = {
      name: item.name,
      id: item.id,
      size: item.size || 0,
      modified: item.lastModifiedDateTime,
      webUrl: item.webUrl
    };
    
    if (item.folder) {
      folders.push({ ...entry, childCount: item.folder.childCount || 0 });
    } else if (item.file) {
      files.push({ ...entry, mimeType: item.file.mimeType });
      totalSize += item.size || 0;
    }
  }

  return { files, folders, totalSize };
}

/**
 * Read and extract content from a SharePoint file
 */
export async function executeReadSharePointFile(
  args: { url: string },
  req: Request
): Promise<any> {
  const token = await getValidMsToken(req);
  if (!token) throw new Error("Failed to authenticate with Microsoft");

  // Handle different URL patterns
  let downloadUrl: string;
  
  if (args.url.startsWith("/api/chat-media/")) {
    // Local file upload
    const filename = args.url.replace("/api/chat-media/", "");
    const localPath = storage.getPath("chat-media", filename);
    const content = await extractTextFromFile(localPath, filename);
    return {
      success: true,
      filename,
      content,
      metadata: { source: "upload" }
    };
  } else if (args.url.includes("sharepoint.com")) {
    // SharePoint URL - construct download URL
    if (args.url.includes("/personal/")) {
      const match = args.url.match(/\/personal\/([^/]+)\/(.+)$/);
      if (match) {
        const userEmail = match[1].replace(/_/g, "@");
        downloadUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/drive/root:/${match[2]}:/content`;
      } else {
        throw new Error("Could not parse personal OneDrive URL");
      }
    } else {
      // Site SharePoint
      const driveId = await getSharePointDriveId(token);
      if (!driveId) throw new Error("Failed to access SharePoint");
      const encoded = encodeURIComponent(args.url);
      downloadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/content`;
    }
  } else {
    // Assume it's a path in BGP SharePoint
    const driveId = await getSharePointDriveId(token);
    if (!driveId) throw new Error("Failed to access SharePoint");
    const encoded = encodeURIComponent(args.url);
    downloadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/content`;
  }

  // Download file
  const resp = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    throw new Error(`Failed to download file: ${await resp.text()}`);
  }

  // Save temporarily and extract
  const buffer = Buffer.from(await resp.arrayBuffer());
  const filename = args.url.split("/").pop() || "download";
  const tempPath = storage.getPath("temp", `sp_${Date.now()}_${filename}`);
  
  await storage.uploadBuffer(buffer, "temp", tempPath.split("/").pop()!);
  const content = await extractTextFromFile(tempPath, filename);
  
  // Clean up
  try {
    await storage.delete("temp", tempPath.split("/").pop()!);
  } catch {}

  return {
    success: true,
    filename,
    content,
    metadata: { source: "sharepoint" }
  };
}