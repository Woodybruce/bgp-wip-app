// The folder picker (Woody, 24 November 2026: "go ahead with the folder
// suggestion"; docs/folders-review-2026-11-20.md, 4.5). Find a folder in BGP's
// SharePoint or your OneDrive by name, or browse to it from "BGP - Share
// Drive" (where it opens, decision 2), My OneDrive or the folders you follow;
// tick several and link them, make a new folder where you are browsing (empty,
// or the property folder's five folders, decision 3), or paste a link
// instead. It is the app's own picker on your own Microsoft 365 (decisions 7
// and 8): no Microsoft token reaches the browser.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, FolderPlus, Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { FOLDER_TEMPLATES, itemNameProblem, safeFolderName, type DriveEntry, type FolderPlaces, type FolderTemplateKey } from "@shared/folders";
import { FolderDialog } from "./folder-dialog";
import { FolderApiError, folderApi } from "./folder-api";

type Place = "share" | "onedrive" | "followed";

export interface FolderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Tick several and link them; otherwise choose the folder you are in. */
  multiple?: boolean;
  pickLabel?: (count: number, here: DriveEntry | null) => string;
  onPick: (folders: DriveEntry[]) => Promise<unknown>;
  /** "New folder here", made in the folder being browsed. */
  create?: { defaultName: string; defaultTemplate?: FolderTemplateKey; startOpen?: boolean; onCreate: (where: DriveEntry, name: string, template: FolderTemplateKey) => Promise<unknown> };
  /** "Paste a link instead". */
  onPaste?: (url: string) => Promise<unknown>;
  /** Only this library: a move cannot leave the library it is in. */
  driveId?: string;
  /** The folder to open on first, instead of "BGP - Share Drive". */
  start?: DriveEntry[];
  /** A line above the buttons, e.g. a transaction's "put it on the property instead". */
  extra?: ReactNode;
  /** Linking to a record: a library's or a OneDrive's top, and BGP - Share Drive itself, can't be chosen (the server refuses them too). */
  notTops?: boolean;
  testId?: string;
}

const libraryRoot = (p: FolderPlaces): DriveEntry | null => p.library ? {
  driveId: p.library.driveId, itemId: p.library.itemId, name: p.library.name, isFolder: true, childCount: null, size: null,
  modified: null, webUrl: p.library.webUrl, path: p.library.name, driveKind: "library", mimeType: null,
} : null;

export function FolderPicker(props: FolderPickerProps) {
  const { open, onOpenChange, title, description, multiple = false, onPick, create, onPaste, driveId, start, extra, notTops = false, testId = "folder-picker" } = props;
  const [tab, setTab] = useState<"browse" | "search">("browse");
  const [place, setPlace] = useState<Place>("share");
  const [stack, setStack] = useState<DriveEntry[]>([]);
  const [selected, setSelected] = useState<Map<string, DriveEntry>>(new Map());
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<FolderTemplateKey>("empty");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");

  // A fresh picker each time it opens.
  const opened = useRef(false);
  useEffect(() => {
    if (!open) { opened.current = false; return; }
    setTab("browse"); setPlace("share"); setStack([]); setSelected(new Map());
    setQ(""); setQuery(""); setBusy(false); setProblem(null); setPasteOpen(false); setPasteUrl("");
    setNewOpen(!!create?.startOpen); setNewName(safeFolderName(create?.defaultName || "")); setNewTemplate(create?.defaultTemplate || "empty");
  }, [open]);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const places = useQuery<FolderPlaces, FolderApiError>({
    queryKey: ["/api/folders/places"],
    queryFn: () => folderApi("GET", "/api/folders/places"),
    enabled: open,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const connect = places.error?.connect;
  const goShareDrive = (p: FolderPlaces) => {
    const root = libraryRoot(p);
    const first = p.shareDrive ? [...(root ? [root] : []), p.shareDrive] : root ? [root] : p.oneDrive ? [p.oneDrive] : [];
    setPlace(p.shareDrive || root ? "share" : "onedrive");
    setStack(first);
  };
  // Opens in "BGP - Share Drive" (decision 2), or where the caller asked; once each time it opens.
  useEffect(() => {
    if (!open || opened.current) return;
    if (start && start.length) { opened.current = true; setPlace(start[0].driveKind === "onedrive" ? "onedrive" : "share"); setStack(start); return; }
    if (!places.data) return;
    opened.current = true;
    if (driveId && places.data.oneDrive?.driveId === driveId && places.data.library?.driveId !== driveId) { setPlace("onedrive"); setStack([places.data.oneDrive]); return; }
    goShareDrive(places.data);
  }, [open, places.data]);

  const here = place === "followed" ? null : stack[stack.length - 1] || null;
  const browse = useQuery<{ folder: DriveEntry; items: DriveEntry[] }, FolderApiError>({
    queryKey: ["/api/folders/browse", here?.driveId, here?.itemId, "folders"],
    queryFn: () => folderApi("GET", `/api/folders/browse?driveId=${encodeURIComponent(here!.driveId)}&itemId=${encodeURIComponent(here!.itemId)}&folders=1`),
    enabled: open && tab === "browse" && !!here,
    retry: false,
  });
  const search = useQuery<{ items: DriveEntry[] }, FolderApiError>({
    queryKey: ["/api/folders/search", query],
    queryFn: () => folderApi("GET", `/api/folders/search?q=${encodeURIComponent(query)}&in=all`),
    enabled: open && tab === "search" && query.length >= 2,
    retry: false,
  });

  const allowed = (e: DriveEntry) => !driveId || e.driveId === driveId;
  const rows: DriveEntry[] = useMemo(() => {
    if (tab === "search") return (search.data?.items || []).filter(allowed);
    if (place === "followed") return (places.data?.followed || []).filter(allowed);
    return browse.data?.items || [];
  }, [tab, place, search.data, places.data, browse.data, driveId]);

  const key = (e: DriveEntry) => `${e.driveId}|${e.itemId}`;
  const tops = useMemo(() => {
    const p = places.data;
    return new Set(p ? [libraryRoot(p), p.shareDrive, p.oneDrive].filter((e): e is DriveEntry => !!e).map(key) : []);
  }, [places.data]);
  const isTop = (e: DriveEntry | null) => !!e && notTops && tops.has(key(e));
  const toggle = (e: DriveEntry) => setSelected(prev => {
    const next = new Map(prev);
    if (next.has(key(e))) next.delete(key(e)); else next.set(key(e), e);
    return next;
  });
  const stepInto = (e: DriveEntry) => {
    if (tab === "search" || place === "followed") { setTab("browse"); setPlace(e.driveKind === "onedrive" ? "onedrive" : "share"); setStack([e]); return; }
    setStack(s => [...s, e]);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setProblem(null);
    try { await fn(); onOpenChange(false); }
    catch (e: any) { setProblem(e?.message || "That did not work."); }
    finally { setBusy(false); }
  };

  const picks = multiple ? [...selected.values()] : [];
  const hereTop = picks.length === 0 && isTop(here);
  const label = hereTop ? (multiple ? "Tick a folder, or open one" : "Open a folder")
    : props.pickLabel ? props.pickLabel(picks.length, here)
    : multiple ? (picks.length ? `Link ${picks.length} folder${picks.length === 1 ? "" : "s"}` : here ? `Link this folder: ${here.name}` : "Link")
    : here ? `Use this folder: ${here.name}` : "Use this folder";
  const canPick = !busy && (picks.length > 0 || (!!here && allowed(here) && !hereTop));
  const nameProblem = newOpen ? itemNameProblem(newName) : null;

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      <Button type="button" disabled={!canPick || !!connect} onClick={() => run(() => onPick(picks.length ? picks : [here!]))} data-testid={`${testId}-pick`}>
        {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}{label}
      </Button>
    </>
  );

  return (
    <FolderDialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o); }} title={title} description={description} footer={footer} testId={testId}>
      {places.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading your SharePoint…</div>
      ) : connect ? (
        <div className="py-6 text-center space-y-2" data-testid={`${testId}-connect`}>
          <p className="text-sm">Connect your own Microsoft 365 first: folder actions run as you, never as a colleague.</p>
          <Link href="/sharepoint" className="text-sm text-primary underline underline-offset-2">Open the SharePoint page to connect</Link>
        </div>
      ) : places.error ? (
        <p className="py-6 text-sm text-muted-foreground">{places.error.message}</p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill active={tab === "browse"} onClick={() => setTab("browse")} data-testid={`${testId}-tab-browse`}>Browse</Pill>
            <Pill active={tab === "search"} onClick={() => setTab("search")} data-testid={`${testId}-tab-search`}>Search</Pill>
            {tab === "browse" && (
              <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                {(places.data?.shareDrive || places.data?.library) && (!driveId || places.data?.library?.driveId === driveId) && (
                  <Pill active={place === "share"} onClick={() => places.data && goShareDrive(places.data)} data-testid={`${testId}-place-share`}>{places.data?.shareDrive ? "BGP - Share Drive" : places.data?.library?.name}</Pill>
                )}
                {places.data?.oneDrive && (!driveId || places.data.oneDrive.driveId === driveId) && (
                  <Pill active={place === "onedrive"} onClick={() => { setPlace("onedrive"); setStack([places.data!.oneDrive!]); }} data-testid={`${testId}-place-onedrive`}>My OneDrive</Pill>
                )}
                {!!places.data?.followed?.length && !driveId && (
                  <Pill active={place === "followed"} onClick={() => { setPlace("followed"); setStack([]); }} data-testid={`${testId}-place-followed`}>Followed</Pill>
                )}
              </span>
            )}
          </div>

          {tab === "search" ? (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a folder by name, in BGP's SharePoint and your OneDrive" className="pl-8 h-9 text-sm" data-testid={`${testId}-search`} />
            </div>
          ) : place !== "followed" ? (
            <nav className="flex flex-wrap items-center gap-1 text-xs" aria-label="Folder path" data-testid={`${testId}-crumbs`}>
              {stack.map((c, i) => (
                <span key={`${c.itemId}-${i}`} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
                  {i < stack.length - 1
                    ? <button type="button" className="truncate text-muted-foreground underline-offset-2 hover:underline hover:text-foreground" onClick={() => setStack(s => s.slice(0, i + 1))}>{c.name}</button>
                    : <span className="truncate font-medium">{c.name}</span>}
                </span>
              ))}
            </nav>
          ) : <p className="text-xs text-muted-foreground">The folders you follow in SharePoint and OneDrive.</p>}

          {tab === "browse" && here && create && allowed(here) && (
            newOpen ? (
              <div className="rounded-md border border-border p-2.5 space-y-2" data-testid={`${testId}-new`}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">New folder in {here.name}</div>
                <div className="flex flex-wrap gap-2">
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Folder name" className="h-9 text-sm flex-1 min-w-[10rem]" data-testid={`${testId}-new-name`} />
                  <select aria-label="What to make" className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={newTemplate} onChange={e => setNewTemplate(e.target.value as FolderTemplateKey)} data-testid={`${testId}-new-template`}>
                    {FOLDER_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.key === "property" ? `${t.label} (${t.folders.length} folders inside)` : t.label}</option>)}
                  </select>
                  <Button type="button" size="sm" className="h-9" disabled={busy || !!nameProblem} onClick={() => run(() => create.onCreate(here, newName.trim(), newTemplate))} data-testid={`${testId}-create`}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5 mr-1" />}Make it
                  </Button>
                </div>
                {newTemplate === "property" && <p className="text-[11px] text-muted-foreground">Inside it: {FOLDER_TEMPLATES.find(t => t.key === "property")!.folders.join(", ")}.</p>}
                {nameProblem && newName.trim() ? <p className="text-[11px] text-destructive">{nameProblem}</p> : null}
              </div>
            ) : (
              <button type="button" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline" onClick={() => setNewOpen(true)} data-testid={`${testId}-new-open`}>
                <FolderPlus className="w-3.5 h-3.5" />New folder here
              </button>
            )
          )}

          <div className="rounded-md border border-border" data-testid={`${testId}-list`}>
            {(tab === "browse" ? (place !== "followed" && (browse.isLoading || !here)) : search.isFetching && !search.data) ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading…</div>
            ) : (tab === "browse" ? browse.error : search.error) ? (
              <p className="p-3 text-sm text-muted-foreground">{(tab === "browse" ? browse.error : search.error)!.message}</p>
            ) : tab === "search" && query.length < 2 ? (
              <p className="p-3 text-sm text-muted-foreground">Type at least two letters of the folder's name.</p>
            ) : rows.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{tab === "search" ? "No folders of that name." : "No folders in here."}</p>
            ) : (
              <ul className="divide-y divide-border max-h-[45vh] overflow-y-auto">
                {rows.map(e => (
                  <li key={key(e)} className="flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] sm:min-h-0" data-testid={`${testId}-row-${e.itemId}`}>
                    {multiple && (
                      <Checkbox checked={selected.has(key(e))} disabled={isTop(e)} onCheckedChange={() => toggle(e)} aria-label={isTop(e) ? `${e.name}: open it and link a folder inside` : `Tick ${e.name}`} data-testid={`${testId}-tick-${e.itemId}`} />
                    )}
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => stepInto(e)} title={`Open ${e.name}`}>
                      <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{e.name}</span>
                        {(tab === "search" || place === "followed") && e.path && <span className="block truncate text-[11px] text-muted-foreground">{e.path}</span>}
                      </span>
                      {e.childCount != null && <span className="font-mono tabular-nums text-[11px] text-muted-foreground">{e.childCount}</span>}
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {multiple && selected.size > 0 && (
            <p className="text-[11px] text-muted-foreground" data-testid={`${testId}-ticked`}>
              Ticked: {[...selected.values()].map(e => e.name).join(", ")}
            </p>
          )}

          {onPaste && (
            pasteOpen ? (
              <div className="flex flex-wrap gap-2" data-testid={`${testId}-paste`}>
                <Input value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} placeholder="https://brucegillinghampollardlimited.sharepoint.com/…" className="h-9 text-sm flex-1 min-w-[12rem]" data-testid={`${testId}-paste-url`} />
                <Button type="button" size="sm" variant="outline" className="h-9" disabled={busy || !pasteUrl.trim()} onClick={() => run(() => onPaste(pasteUrl.trim()))} data-testid={`${testId}-paste-link`}>
                  <Link2 className="w-3.5 h-3.5 mr-1" />Link it
                </Button>
              </div>
            ) : (
              <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setPasteOpen(true)} data-testid={`${testId}-paste-open`}>
                Paste a link instead
              </button>
            )
          )}
          {extra}
          {problem && <p className="text-sm text-destructive" data-testid={`${testId}-problem`}>{problem}</p>}
        </div>
      )}
    </FolderDialog>
  );
}
