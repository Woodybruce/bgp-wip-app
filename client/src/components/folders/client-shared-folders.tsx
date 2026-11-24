// Folders BGP staff shared with the client (Woody, 24 November 2026: decision
// 6 of docs/folders-review-2026-11-20.md), in the client's data room: a pill
// per shared folder and the open one below, read only, with a filter and
// A–Z / Largest / Newest. Read through /api/client/sharepoint/shared
// (server/client-sharepoint.ts) by the link and the names below it, never by a
// drive or item id; a client never calls /api/folders/. Draws nothing when
// nothing is shared, so the data room looks as it did.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileDown, FileText, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthHeaders } from "@/lib/queryClient";
import type { ClientSharedFolder, ClientSharedItem } from "@shared/folder-share";

type Sort = "name" | "size" | "modified";

async function readJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.message || "Couldn't read that folder");
  return data as T;
}

const formatSize = (bytes: number | null) => bytes == null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const contentHref = (linkId: string, path: string[]) => `/api/client/sharepoint/shared/${encodeURIComponent(linkId)}/content?path=${encodeURIComponent(path.join("/"))}`;

/**
 * The folders shared with the client: a property's (with `propertyId`: its
 * own and its transactions'), the company's own (`company`), or all of them.
 * `whenEmpty` shows instead when nothing is shared.
 */
export function ClientSharedFolders({ propertyId, company, whenEmpty = null, title = "Shared by BGP" }: { propertyId?: string | null; company?: boolean; whenEmpty?: ReactNode; title?: string }) {
  const query = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : company ? "?company=1" : "";
  const { data, isLoading } = useQuery<{ folders: ClientSharedFolder[] }>({
    queryKey: ["/api/client/sharepoint/shared", propertyId || null, !!company],
    queryFn: () => readJson(`/api/client/sharepoint/shared${query}`),
    retry: false,
    staleTime: 60_000,
  });
  const folders = data?.folders || [];
  const [openId, setOpenId] = useState<string | null>(null);
  const open = folders.find(f => f.id === openId) || folders[0] || null;
  if (isLoading) return null;
  if (!folders.length) return <>{whenEmpty}</>;
  return (
    <div className="space-y-2" data-testid="client-shared-folders">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">{title}</span>
        {folders.map(f => (
          <Pill key={f.id} active={open?.id === f.id} onClick={() => setOpenId(f.id)} title={f.recordType === "company" ? f.label : `${f.label} · ${f.recordName}`} className="max-w-[16rem]" data-testid={`client-shared-folder-${f.id}`}>
            <span className="truncate">{f.label}</span>
          </Pill>
        ))}
      </div>
      {open && <SharedFolderBrowser key={open.id} folder={open} showRecord={!propertyId} />}
    </div>
  );
}

function SharedFolderBrowser({ folder, showRecord }: { folder: ClientSharedFolder; showRecord: boolean }) {
  const [trail, setTrail] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  useEffect(() => { setFilter(""); }, [trail.length]);
  const path = trail.join("/");
  const listing = useQuery<{ items: ClientSharedItem[] }>({
    queryKey: ["/api/client/sharepoint/shared", folder.id, "list", path],
    queryFn: () => readJson(`/api/client/sharepoint/shared/${encodeURIComponent(folder.id)}/list?path=${encodeURIComponent(path)}`),
    retry: false,
    staleTime: 60_000,
  });
  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (listing.data?.items || [])
      .filter(i => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        if (sort === "size") return ((b.isFolder ? b.childCount : b.size) || 0) - ((a.isFolder ? a.childCount : a.size) || 0);
        if (sort === "modified") return new Date(b.lastModified || 0).getTime() - new Date(a.lastModified || 0).getTime();
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
  }, [listing.data, filter, sort]);

  return (
    <div className="space-y-2" data-testid="client-shared-browser">
      <div className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Folder path">
        <button type="button" onClick={() => setTrail([])} className={trail.length ? "text-primary hover:underline" : "font-medium text-foreground"} data-testid="client-shared-crumb-root">
          {folder.label}
        </button>
        {showRecord && folder.recordType !== "company" && <span className="text-muted-foreground">· {folder.recordName}</span>}
        {trail.map((name, i) => (
          <span key={`${name}-${i}`} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            <button type="button" onClick={() => setTrail(trail.slice(0, i + 1))} className={i === trail.length - 1 ? "truncate font-medium text-foreground" : "truncate text-primary hover:underline"}>{name}</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name…" className="h-7 text-xs flex-1 min-w-[8rem]" data-testid="client-shared-filter" />
        {([["name", "A–Z"], ["size", "Largest"], ["modified", "Newest"]] as const).map(([key, label]) => (
          <Pill key={key} active={sort === key} onClick={() => setSort(key)} data-testid={`client-shared-sort-${key}`}>{label}</Pill>
        ))}
      </div>
      {listing.isLoading ? (
        <div className="space-y-1">{[1, 2, 3].map(i => <Skeleton key={i} className="h-7" />)}</div>
      ) : listing.error ? (
        <p className="text-xs text-muted-foreground py-3">{(listing.error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">{filter.trim() ? "No files or folders match." : "This folder is empty."}</p>
      ) : (
        <div className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1" data-testid="client-shared-list">
          {items.map(item => item.isFolder ? (
            <button
              key={item.name}
              type="button"
              onClick={() => setTrail([...trail, item.name])}
              className="w-full flex items-center gap-2 px-2 py-1.5 min-h-[44px] sm:min-h-0 rounded-md hover:bg-muted/50 text-left min-w-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs truncate flex-1">{item.name}</span>
              {item.childCount != null && <span className="font-mono tabular-nums text-[10px] text-muted-foreground shrink-0">{item.childCount}</span>}
              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            </button>
          ) : (
            <a
              key={item.name}
              href={contentHref(folder.id, [...trail, item.name])}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 min-h-[44px] sm:min-h-0 rounded-md hover:bg-muted/50 min-w-0"
            >
              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs truncate flex-1">{item.name}</span>
              <span className="font-mono tabular-nums text-[10px] text-muted-foreground shrink-0">{formatSize(item.size)}</span>
              <FileDown className="w-3 h-3 text-muted-foreground shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
