// An open folder (docs/folders-review-2026-11-20.md, 4.5): where it sits, its
// folders and files, a filter and a sort, as a list or a grid. Folders open in
// place; a file opens in SharePoint. Read on the person's own Microsoft 365.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, FileText, Folder, LayoutGrid, List, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import type { DriveEntry } from "@shared/folders";
import { FolderApiError, folderApi } from "./folder-api";

export interface FolderRoot { driveId: string; itemId: string; name: string; webUrl: string | null }
type Sort = "name" | "size" | "modified";

export const formatBytes = (n: number | null) => n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const formatDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).replace(/\bSept\b/, "Sep");
};

/** Folders first; then by name (numbers read as numbers), size or newest. */
export function sortListing(items: DriveEntry[], sort: Sort): DriveEntry[] {
  return [...items].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    if (sort === "size") return ((b.isFolder ? b.childCount : b.size) || 0) - ((a.isFolder ? a.childCount : a.size) || 0);
    if (sort === "modified") return new Date(b.modified || 0).getTime() - new Date(a.modified || 0).getTime();
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function useFolderListing(here: { driveId: string; itemId: string } | null, enabled = true) {
  return useQuery<{ folder: DriveEntry; items: DriveEntry[] }, FolderApiError>({
    queryKey: ["/api/folders/browse", here?.driveId, here?.itemId],
    queryFn: () => folderApi("GET", `/api/folders/browse?driveId=${encodeURIComponent(here!.driveId)}&itemId=${encodeURIComponent(here!.itemId)}`),
    enabled: enabled && !!here,
    retry: false,
  });
}

export function FolderBrowser({ root, testId = "folder-browser" }: { root: FolderRoot; testId?: string }) {
  const [trail, setTrail] = useState<DriveEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [view, setView] = useState<"list" | "grid">("list");
  const here = trail[trail.length - 1] || root;
  const listing = useFolderListing(here);
  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return sortListing((listing.data?.items || []).filter(i => !q || i.name.toLowerCase().includes(q)), sort);
  }, [listing.data, filter, sort]);

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs" aria-label="Folder path" data-testid={`${testId}-crumbs`}>
          <button type="button" onClick={() => setTrail([])} className={trail.length ? "text-primary hover:underline" : "font-medium"}>{root.name}</button>
          {trail.map((t, i) => (
            <span key={`${t.itemId}-${i}`} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => setTrail(trail.slice(0, i + 1))} className={i === trail.length - 1 ? "truncate font-medium" : "truncate text-primary hover:underline"}>{t.name}</button>
            </span>
          ))}
        </nav>
        {(listing.data?.folder.webUrl || here.webUrl) && (
          <a href={(listing.data?.folder.webUrl || here.webUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid={`${testId}-open-sharepoint`}>
            <ExternalLink className="w-3 h-3" />Open in SharePoint
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name…" className="h-8 text-xs flex-1 min-w-[8rem]" data-testid={`${testId}-filter`} />
        {([["name", "A–Z"], ["size", "Largest"], ["modified", "Newest"]] as const).map(([k, label]) => (
          <Pill key={k} active={sort === k} onClick={() => setSort(k)} data-testid={`${testId}-sort-${k}`}>{label}</Pill>
        ))}
        <button type="button" className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setView(v => (v === "list" ? "grid" : "list"))} aria-label={view === "list" ? "Show as a grid" : "Show as a list"} title={view === "list" ? "Show as a grid" : "Show as a list"} data-testid={`${testId}-view`}>
          {view === "list" ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
        </button>
      </div>
      {listing.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading the folder…</div>
      ) : listing.error ? (
        <p className="py-4 text-sm text-muted-foreground">{listing.error.message}</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{filter.trim() ? "Nothing in here matches." : "This folder is empty."}</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid={`${testId}-grid`}>
          {items.map(item => (
            <EntryTile key={item.itemId} item={item} onOpen={() => setTrail(t => [...t, item])} testId={testId} />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid={`${testId}-list`}>
          {items.map(item => (
            <li key={item.itemId} className="flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px]" data-testid={`${testId}-row-${item.itemId}`}>
              <EntryName item={item} onOpen={() => setTrail(t => [...t, item])} />
              <span className="hidden sm:inline font-mono tabular-nums text-[11px] text-muted-foreground w-16 text-right">{item.isFolder ? (item.childCount ?? "") : formatBytes(item.size)}</span>
              <span className="hidden sm:inline font-mono tabular-nums text-[11px] text-muted-foreground w-16 text-right">{formatDay(item.modified)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryName({ item, onOpen }: { item: DriveEntry; onOpen: () => void }) {
  const Icon = item.isFolder ? Folder : FileText;
  const inner = (
    <>
      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
    </>
  );
  return item.isFolder
    ? <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-primary" onClick={onOpen}>{inner}</button>
    : <a className="flex min-w-0 flex-1 items-center gap-2 hover:text-primary" href={item.webUrl || undefined} target="_blank" rel="noopener noreferrer">{inner}</a>;
}

function EntryTile({ item, onOpen, testId }: { item: DriveEntry; onOpen: () => void; testId: string }) {
  const Icon = item.isFolder ? Folder : FileText;
  const body = (
    <>
      <Icon className="w-7 h-7 text-muted-foreground" />
      <span className="w-full truncate text-xs">{item.name}</span>
      <span className="font-mono tabular-nums text-[10px] text-muted-foreground">{item.isFolder ? `${item.childCount ?? 0} items` : formatBytes(item.size)}</span>
    </>
  );
  const cls = "flex flex-col items-center gap-1 rounded-md border border-border p-3 text-center hover:bg-muted/60";
  return item.isFolder
    ? <button type="button" className={cls} onClick={onOpen} data-testid={`${testId}-tile-${item.itemId}`}>{body}</button>
    : <a className={cls} href={item.webUrl || undefined} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-tile-${item.itemId}`}>{body}</a>;
}
