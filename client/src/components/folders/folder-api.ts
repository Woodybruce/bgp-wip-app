// The folder engine's routes as the screens call them (server/folders/routes.ts).
// BGP staff only: a client login never calls these, it reads its data room
// through /api/client/sharepoint/ (ClientPropertyFoldersPanel).
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { contentRange, needsUploadSession, uploadPieces, uploadProblem, type DriveEntry } from "@shared/folders";

/** A refusal from the engine: its words, its status, and whether connecting Microsoft 365 would fix it. */
export class FolderApiError extends Error {
  constructor(message: string, readonly status: number, readonly connect: boolean) {
    super(message);
  }
}

export async function folderApi<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { ...getAuthHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new FolderApiError(data?.message || data?.error || `The folders answered ${res.status}.`, res.status, !!data?.connect);
  return data as T;
}

export const recordFoldersKey = (recordType: string, recordId: string) => ["/api/folders", recordType, recordId];

/** After a change: the record's folders, and any other record showing the same links. */
export function refreshFolders() {
  return queryClient.invalidateQueries({ predicate: q => q.queryKey[0] === "/api/folders" });
}

/** After a change inside a folder: every open folder's contents read again. */
export function refreshListings() {
  return queryClient.invalidateQueries({ predicate: q => q.queryKey[0] === "/api/folders/browse" });
}

/**
 * One file into a folder, as the person: up to 10 MB in one go, larger in
 * pieces through an upload session the server keeps (the address Microsoft
 * signs never reaches the browser). Progress is a percentage, or null while
 * a one-go upload is on its way.
 */
export async function folderUpload(target: { driveId: string; itemId: string }, file: File, onProgress: (percent: number | null) => void, cancelled: () => boolean): Promise<DriveEntry> {
  const problem = uploadProblem(file.name, file.size);
  if (problem) throw new FolderApiError(problem, 400, false);
  const base = `/api/folders/items/${encodeURIComponent(target.driveId)}/${encodeURIComponent(target.itemId)}`;
  if (!needsUploadSession(file.size)) {
    onProgress(null);
    const form = new FormData();
    form.append("name", file.name);
    form.append("file", file);
    const res = await fetch(`${base}/upload`, { method: "POST", credentials: "include", headers: getAuthHeaders(), body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new FolderApiError(data?.message || `The upload answered ${res.status}.`, res.status, !!data?.connect);
    onProgress(100);
    return data.item as DriveEntry;
  }
  const { sessionId } = await folderApi<{ sessionId: string }>("POST", `${base}/upload-session`, { name: file.name, size: file.size });
  for (const [start, end] of uploadPieces(file.size)) {
    if (cancelled()) {
      await folderApi("DELETE", `/api/folders/uploads/${encodeURIComponent(sessionId)}`).catch(() => undefined);
      throw new FolderApiError("Stopped.", 499, false);
    }
    const res = await fetch(`/api/folders/uploads/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      credentials: "include",
      headers: { ...getAuthHeaders(), "Content-Type": "application/octet-stream", "Content-Range": contentRange(start, end - start + 1, file.size) },
      body: file.slice(start, end + 1),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new FolderApiError(data?.message || `The upload answered ${res.status}.`, res.status, !!data?.connect);
    onProgress(Math.floor(((end + 1) / file.size) * 100));
    if (data?.item) return data.item as DriveEntry;
  }
  throw new FolderApiError("SharePoint did not say the file arrived: look in the folder.", 502, false);
}
