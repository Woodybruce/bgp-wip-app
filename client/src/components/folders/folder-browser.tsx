// An open folder (docs/folders-review-2026-11-20.md, 4.5): where it sits, its
// folders and files, a filter and a sort, as a list or a grid. Folders open in
// place; a file opens in SharePoint. Each row has a menu that can always be
// seen (Open in SharePoint, Preview, Rename, Move, Copy to, Share, Delete);
// several can be ticked and moved, copied or deleted together; New folder and
// Upload (or drop files on it) put things in the folder being browsed. Read and
// changed on the person's own Microsoft 365.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight, Copy as CopyIcon, Eye, ExternalLink, FileText, Folder, FolderInput, FolderPlus, LayoutGrid, List, MoreVertical,
  Pencil, Share2, Trash2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import type { DriveEntry } from "@shared/folders";
import { FolderApiError, folderApi, refreshListings } from "./folder-api";
import {
  CopyProgress, DeleteItemsDialog, NewFolderDialog, PreviewItemDialog, RenameItemDialog, ShareItemDialog, UploadProgress, formatBytes,
  useCopies, useUploads,
} from "./folder-actions";
import { FolderPicker } from "./folder-picker";
import { FolderFollowMenuItem } from "./folder-share";

export { formatBytes } from "./folder-actions";
export interface FolderRoot { driveId: string; itemId: string; name: string; webUrl: string | null }
type Sort = "name" | "size" | "modified";

const formatDay = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).replace(/\bSept\b/, "Sep");
};
const keyOf = (e: { driveId: string; itemId: string }) => `${e.driveId}|${e.itemId}`;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");

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
  const { toast } = useToast();
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

  const [ticked, setTicked] = useState<Map<string, DriveEntry>>(new Map());
  useEffect(() => { setTicked(new Map()); }, [here.driveId, here.itemId]);
  const tick = (e: DriveEntry) => setTicked(prev => { const next = new Map(prev); if (next.has(keyOf(e))) next.delete(keyOf(e)); else next.set(keyOf(e), e); return next; });
  const tickedList = [...ticked.values()];

  const [newFolder, setNewFolder] = useState(false);
  const [renaming, setRenaming] = useState<DriveEntry | null>(null);
  const [deleting, setDeleting] = useState<DriveEntry[] | null>(null);
  const [sharing, setSharing] = useState<DriveEntry | null>(null);
  const [previewing, setPreviewing] = useState<DriveEntry | null>(null);
  const [moving, setMoving] = useState<DriveEntry[] | null>(null);
  const [copying, setCopying] = useState<DriveEntry[] | null>(null);
  const uploads = useUploads();
  const copies = useCopies();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const hereEntry: DriveEntry = listing.data?.folder || { driveId: here.driveId, itemId: here.itemId, name: here.name, isFolder: true, childCount: null, size: null, modified: null, webUrl: here.webUrl, path: here.name, driveKind: "library", mimeType: null };
  const rootEntry: DriveEntry = { driveId: root.driveId, itemId: root.itemId, name: root.name, isFolder: true, childCount: null, size: null, modified: null, webUrl: root.webUrl, path: root.name, driveKind: hereEntry.driveKind, mimeType: null };
  const stack = [rootEntry, ...trail];
  const take = (files: FileList | File[] | null) => {
    const list = Array.from(files || []);
    if (list.length) uploads.add(list, { driveId: here.driveId, itemId: here.itemId, name: here.name });
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    // A dropped folder is not a file: say so, and take the files.
    const entries = Array.from(e.dataTransfer.items || []).map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    const folders = entries.filter((x: any) => x.isDirectory).length;
    if (folders) toast({ title: `${folders} folder${folders === 1 ? "" : "s"} not uploaded`, description: "Make the folder with New folder, then drop its files in it." });
    const files = Array.from(e.dataTransfer.files).filter(f => !entries.some((x: any) => x.isDirectory && x.name === f.name));
    take(files);
  };
  const move = async (items: DriveEntry[], to: DriveEntry) => {
    const failed: string[] = [];
    let moved = 0;
    for (const it of items) {
      try { await folderApi("POST", `/api/folders/items/${encodeURIComponent(it.driveId)}/${encodeURIComponent(it.itemId)}/move`, { toDriveId: to.driveId, parentId: to.itemId }); moved++; }
      catch (e: any) { failed.push(`${it.name}: ${e?.message || "not moved"}`); }
    }
    await refreshListings();
    if (moved) { toast({ title: `${moved} moved`, description: `To ${to.name}.` }); setTicked(new Map()); }
    if (failed.length) throw new Error(failed.join(" "));
  };

  const menu = (item: DriveEntry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${item.name}: more`} data-testid={`${testId}-menu-${item.itemId}`}>
          <MoreVertical className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {item.isFolder && <DropdownMenuItem onClick={() => setTrail(t => [...t, item])}><Folder className="w-3.5 h-3.5 mr-2" />Open</DropdownMenuItem>}
        {item.webUrl && <DropdownMenuItem asChild><a href={item.webUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-2" />Open in SharePoint</a></DropdownMenuItem>}
        {item.isFolder && <FolderFollowMenuItem driveId={item.driveId} itemId={item.itemId} name={item.name} testId={`${testId}-follow-${item.itemId}`} />}
        {!item.isFolder && <DropdownMenuItem onClick={() => setPreviewing(item)} data-testid={`${testId}-preview-${item.itemId}`}><Eye className="w-3.5 h-3.5 mr-2" />Preview</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setRenaming(item)} data-testid={`${testId}-rename-${item.itemId}`}><Pencil className="w-3.5 h-3.5 mr-2" />Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMoving([item])} data-testid={`${testId}-move-${item.itemId}`}><FolderInput className="w-3.5 h-3.5 mr-2" />Move</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCopying([item])} data-testid={`${testId}-copy-${item.itemId}`}><CopyIcon className="w-3.5 h-3.5 mr-2" />Copy to</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setSharing(item)} data-testid={`${testId}-share-${item.itemId}`}><Share2 className="w-3.5 h-3.5 mr-2" />Share</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting([item])} data-testid={`${testId}-delete-${item.itemId}`}><Trash2 className="w-3.5 h-3.5 mr-2" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      className={`relative space-y-2 rounded-md [container-type:inline-size] ${dragging ? "outline outline-2 outline-dashed outline-border outline-offset-2" : ""}`}
      data-testid={testId}
      onDragEnter={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDragging(true); } }}
      onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
      onDragLeave={e => { if (hasFiles(e)) e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
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
        <button type="button" className="rounded p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setView(v => (v === "list" ? "grid" : "list"))} aria-label={view === "list" ? "Show as a grid" : "Show as a list"} title={view === "list" ? "Show as a grid" : "Show as a list"} data-testid={`${testId}-view`}>
          {view === "list" ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setNewFolder(true)} data-testid={`${testId}-new-folder`}><FolderPlus className="w-3.5 h-3.5 sm:mr-1" /><span className="max-sm:hidden">New folder</span></Button>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => fileInput.current?.click()} data-testid={`${testId}-upload`}><Upload className="w-3.5 h-3.5 sm:mr-1" /><span className="max-sm:hidden">Upload</span></Button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={e => { take(e.target.files); e.target.value = ""; }} data-testid={`${testId}-upload-input`} />
        </span>
      </div>

      {tickedList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs" data-testid={`${testId}-ticked`}>
          <span className="font-medium">{tickedList.length} ticked</span>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMoving(tickedList)} data-testid={`${testId}-ticked-move`}><FolderInput className="w-3.5 h-3.5 mr-1" />Move</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCopying(tickedList)} data-testid={`${testId}-ticked-copy`}><CopyIcon className="w-3.5 h-3.5 mr-1" />Copy to</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setDeleting(tickedList)} data-testid={`${testId}-ticked-delete`}><Trash2 className="w-3.5 h-3.5 mr-1" />Delete</Button>
          <button type="button" className="ml-auto text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setTicked(new Map())}>Clear</button>
        </div>
      )}

      <UploadProgress rows={uploads.rows} onStop={uploads.stop} onClear={uploads.clear} testId={`${testId}-uploads`} />
      <CopyProgress rows={copies.rows} onClear={copies.clear} testId={`${testId}-copies`} />

      {listing.isLoading ? (
        <div className="space-y-1.5" aria-label="Reading the folder">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : listing.error ? (
        <p className="py-4 text-sm text-muted-foreground">{listing.error.message}</p>
      ) : items.length === 0 ? (
        <div className="py-6 text-center space-y-2" data-testid={`${testId}-empty`}>
          <p className="text-sm text-muted-foreground">{filter.trim() ? "Nothing in here matches." : "Nothing in this folder yet: upload files, or drop them here."}</p>
          {!filter.trim() && <Button type="button" size="sm" onClick={() => fileInput.current?.click()}><Upload className="w-3.5 h-3.5 mr-1" />Upload</Button>}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid={`${testId}-grid`}>
          {items.map(item => (
            <div key={item.itemId} className="relative">
              <EntryTile item={item} onOpen={() => setTrail(t => [...t, item])} testId={testId} />
              <span className="absolute right-1 top-1">{menu(item)}</span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid={`${testId}-list`}>
          {items.map(item => (
            <li key={item.itemId} className="flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px]" data-testid={`${testId}-row-${item.itemId}`}>
              <Checkbox checked={ticked.has(keyOf(item))} onCheckedChange={() => tick(item)} aria-label={`Tick ${item.name}`} data-testid={`${testId}-tick-${item.itemId}`} />
              <EntryName item={item} onOpen={() => setTrail(t => [...t, item])} />
              <span className="hidden [@container(min-width:520px)]:inline font-mono tabular-nums text-[11px] text-muted-foreground w-16 text-right whitespace-nowrap">{item.isFolder ? (item.childCount ?? "") : formatBytes(item.size)}</span>
              <span className="hidden [@container(min-width:420px)]:inline font-mono tabular-nums text-[11px] text-muted-foreground w-20 text-right whitespace-nowrap">{formatDay(item.modified)}</span>
              {menu(item)}
            </li>
          ))}
        </ul>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-background/80 text-sm font-medium" data-testid={`${testId}-drop`}>
          Drop to upload into {here.name}
        </div>
      )}

      <NewFolderDialog here={here} open={newFolder} onOpenChange={setNewFolder} />
      <RenameItemDialog item={renaming} onClose={() => setRenaming(null)} />
      <DeleteItemsDialog items={deleting} onClose={() => setDeleting(null)} onDone={() => setTicked(new Map())} />
      <ShareItemDialog item={sharing} onClose={() => setSharing(null)} />
      <PreviewItemDialog item={previewing} onClose={() => setPreviewing(null)} />
      <FolderPicker
        open={!!moving}
        onOpenChange={o => { if (!o) setMoving(null); }}
        title={moving?.length === 1 ? `Move ${moving[0].name}` : `Move ${moving?.length || 0} items`}
        description="To another folder in the same library. To put them in another library, use Copy to."
        driveId={here.driveId}
        start={stack}
        pickLabel={(_n, to) => (to ? `Move here: ${to.name}` : "Move here")}
        onPick={([to]) => move(moving || [], to)}
        testId={`${testId}-move-picker`}
      />
      <FolderPicker
        open={!!copying}
        onOpenChange={o => { if (!o) setCopying(null); }}
        title={copying?.length === 1 ? `Copy ${copying[0].name} to` : `Copy ${copying?.length || 0} items to`}
        description="Any folder, in BGP's SharePoint or your OneDrive. SharePoint copies in the background; a name already there gets a number added."
        start={stack}
        pickLabel={(_n, to) => (to ? `Copy here: ${to.name}` : "Copy here")}
        onPick={async ([to]) => { await copies.start(copying || [], to); setTicked(new Map()); }}
        testId={`${testId}-copy-picker`}
      />
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
  const cls = "flex w-full flex-col items-center gap-1 rounded-md border border-border p-3 text-center hover:bg-muted/60";
  return item.isFolder
    ? <button type="button" className={cls} onClick={onOpen} data-testid={`${testId}-tile-${item.itemId}`}>{body}</button>
    : <a className={cls} href={item.webUrl || undefined} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-tile-${item.itemId}`}>{body}</a>;
}
