// The folder engine's routes as the screens call them (server/folders/routes.ts).
// BGP staff only: a client login never calls these, it reads its data room
// through /api/client/sharepoint/ (ClientPropertyFoldersPanel).
import { getAuthHeaders, queryClient } from "@/lib/queryClient";

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
